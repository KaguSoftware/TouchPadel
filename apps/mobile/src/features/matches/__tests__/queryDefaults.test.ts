import { describe, expect, it, vi } from 'vitest';

/**
 * The open-match family's query defaults, set once in lib/queryClient.ts
 * (docs/design/open-matches/guest.md §4.23): nothing under `['match']` is
 * written to disk, every write runs now or fails now, and the Book tab's
 * chips fail fast. Asserted on the app's REAL client, with the three native
 * modules it touches at import stubbed (as deposit/__tests__/queryDefaults does).
 */
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { configure: () => {}, addEventListener: () => () => {} },
}));

const { queryClient, persistOptions } = await import('../../../lib/queryClient');
const { matchKeys } = await import('../keys');

type Retry = (n: number, e: unknown) => boolean;

describe('match writes', () => {
  it('never pause offline: run now or fail now (DF-11)', () => {
    for (const name of ['start', 'join', 'request', 'leave', 'buy', 'gender'] as const) {
      expect(queryClient.getMutationDefaults(matchKeys.mutation(name)).networkMode, name).toBe('always');
    }
  });

  it('retry once, and never a refusal the server already made', () => {
    const retry = queryClient.getMutationDefaults(matchKeys.mutation('join')).retry as Retry;
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
    expect(retry(0, { message: 'MATCH_FULL' })).toBe(false);
    expect(retry(0, { message: 'NEED_TICKETS' })).toBe(false);
  });
});

describe('the Book tab’s chips', () => {
  it('fail fast on anything but a dropped connection', () => {
    const retry = queryClient.getQueryDefaults(matchKeys.slots('v', 'f', 't')).retry as Retry;
    expect(retry(0, { message: 'Could not find the function app.match_slots' })).toBe(false);
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
  });

  it('leave the other match reads on the app defaults', () => {
    expect(queryClient.getQueryDefaults(matchKeys.one('m')).retry).toBeUndefined();
  });
});

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({ state: { status: 'success' }, queryKey });

  it('never writes a match read or the wallet to disk (§1.11)', () => {
    expect(dehydrates(matchKeys.one('m', 't'))).toBe(false);
    expect(dehydrates(matchKeys.mine('upcoming'))).toBe(false);
    expect(dehydrates(matchKeys.tickets)).toBe(false);
    expect(dehydrates(matchKeys.slots('v', 'f', 't'))).toBe(false);
    expect(dehydrates(matchKeys.blocks)).toBe(false);
  });

  it('still persists the guest’s ordinary reads', () => {
    expect(dehydrates(['courts'])).toBe(true);
  });
});

describe('matchKeys', () => {
  it('keeps every key under the one root, the wallet included', () => {
    expect(matchKeys.tickets[0]).toBe('match');
    expect(matchKeys.one('m')).toEqual(['match', 'one', 'm', '']);
    expect(matchKeys.quote('v', 'c', 's', 90)).toEqual(['match', 'quote', 'v', 'c', 's', 90]);
    expect(matchKeys.mutation('buy')).toEqual(['match', 'mutation', 'buy']);
  });
});
