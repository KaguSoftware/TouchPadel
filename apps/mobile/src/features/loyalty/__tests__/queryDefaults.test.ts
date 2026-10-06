import { describe, expect, it, vi } from 'vitest';

/**
 * The guest loyalty family's query defaults, set once in lib/queryClient.ts (loyalty plan §5.1).
 * Asserted on the app's REAL client, with the native modules it touches at import stubbed (as
 * tournaments/__tests__/queryDefaults does).
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
const { loyaltyKeys } = await import('../keys');

describe('loyalty writes', () => {
  it('"Get a new code" runs now or fails now, and is never sent again by itself', () => {
    const d = queryClient.getMutationDefaults(loyaltyKeys.mutation('rotate'));
    expect(d.networkMode).toBe('always');
    expect(d.retry).toBe(false);
  });
});

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({
      state: { status: 'success' },
      queryKey,
    });

  it('never writes the member card (its TOTP secret lives in SecureStore)', () => {
    expect(dehydrates(loyaltyKeys.card)).toBe(false);
  });

  it('keeps the balance read, so Profile offers the card on an offline cold start', () => {
    expect(dehydrates(loyaltyKeys.mine)).toBe(true);
  });
});
