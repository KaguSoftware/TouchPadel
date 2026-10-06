import { describe, expect, it, vi } from 'vitest';

/**
 * The guest tournament family's query defaults, set once in lib/queryClient.ts (plan §5.2).
 * Asserted on the app's REAL client, with the native modules it touches at import stubbed (as
 * coaching/__tests__/queryDefaults does).
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
const { tournamentKeys } = await import('../keys');

type Retry = (n: number, e: unknown) => boolean;

describe('tournament writes', () => {
  it('never pause offline: run now or fail now', () => {
    for (const name of ['register', 'withdraw'] as const) {
      expect(queryClient.getMutationDefaults(tournamentKeys.mutation(name)).networkMode, name).toBe(
        'always',
      );
    }
  });

  it('retry once on a dropped connection, never a refusal the server made', () => {
    const retry = queryClient.getMutationDefaults(tournamentKeys.mutation('register'))
      .retry as Retry;
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
    expect(retry(0, { message: 'TOURNAMENT_FULL' })).toBe(false);
  });
});

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({
      state: { status: 'success' },
      queryKey,
    });

  it('keeps every tournament read off the disk', () => {
    expect(dehydrates(tournamentKeys.list)).toBe(false);
    expect(dehydrates(tournamentKeys.one('t'))).toBe(false);
  });

  it('still keeps the branch list', () => {
    expect(dehydrates(['availability', 'branches'])).toBe(true);
  });
});
