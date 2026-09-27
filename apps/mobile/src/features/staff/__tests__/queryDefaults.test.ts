import { describe, expect, it, vi } from 'vitest';

/**
 * Staff writes run now or fail now, and staff reads never touch the disk
 * (build-contracts-2026-09-23 §6.4). Asserted on the app's REAL query client,
 * with the three native modules it touches at import stubbed (AppState,
 * AsyncStorage and NetInfo have nothing to do with the defaults under test).
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
const { staffKeys } = await import('../keys');
const { clearStaffIntentKey, staffIdemKey, staffIntentKey } = await import('../../../lib/idempotency');

describe('staff mutation defaults', () => {
  it('never pause a staff write offline to fire it later', () => {
    expect(queryClient.getMutationDefaults(['staff', 'mutation', 'submit']).networkMode).toBe('always');
    expect(queryClient.getMutationDefaults(staffKeys.mutation('decide')).networkMode).toBe('always');
  });

  it('leave every other write on the app default', () => {
    expect(queryClient.getMutationDefaults(['hold']).networkMode).toBeUndefined();
    expect(queryClient.getDefaultOptions().mutations?.networkMode).toBe('offlineFirst');
  });

  it('retry once, and never a decision the server already made', () => {
    const retry = queryClient.getMutationDefaults(staffKeys.mutation('submit')).retry as (
      n: number,
      e: unknown,
    ) => boolean;
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
    expect(retry(0, { message: 'STEP_NOT_OPEN' })).toBe(false);
  });
});

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({ state: { status: 'success' }, queryKey });

  it('keeps every staff query in memory only', () => {
    expect(dehydrates(staffKeys.status('u-1'))).toBe(false);
    expect(dehydrates(staffKeys.requests('u-1'))).toBe(false);
    expect(dehydrates(staffKeys.work('v-1'))).toBe(false);
  });

  it('still persists the guest’s reads as before', () => {
    expect(dehydrates(['courts'])).toBe(true);
    expect(dehydrates(['my-bookings'])).toBe(false);
  });
});

describe('staffKeys', () => {
  it('keeps every key under the one staff root', () => {
    const samples = [
      staffKeys.status('u'),
      staffKeys.venues('u'),
      staffKeys.work('v'),
      staffKeys.runs('v', 'mine'),
      staffKeys.step('s'),
      staffKeys.context('courts', 'r'),
      staffKeys.priceTargets('v', 'price'),
      staffKeys.candidates('r'),
      staffKeys.mutation('launch'),
    ];
    for (const key of samples) expect(key[0]).toBe('staff');
  });
});

describe('staff idempotency keys', () => {
  it('mint MOBILE:staff.<mutation>:<ulid>', () => {
    expect(staffIdemKey('submit')).toMatch(/^MOBILE:staff\.submit:[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(staffIdemKey('shopping.add')).toMatch(/^MOBILE:staff\.shopping\.add:[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('reuse one key per intent until it is cleared', () => {
    const a = staffIntentKey('submit:rs-1', 'submit');
    expect(staffIntentKey('submit:rs-1', 'submit')).toBe(a);
    expect(staffIntentKey('submit:rs-2', 'submit')).not.toBe(a);
    clearStaffIntentKey('submit:rs-1');
    expect(staffIntentKey('submit:rs-1', 'submit')).not.toBe(a);
  });
});
