import { describe, expect, it, vi } from 'vitest';

/**
 * The guest's own profile stays off the plaintext disk cache (pentest 2026-10): the row carries
 * full_name, phone and gender, and AsyncStorage is readable from a backup or a seized device.
 * Asserted on the app's REAL client, with the native modules it touches at import stubbed (as
 * loyalty/__tests__/queryDefaults does).
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
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

const { persistOptions } = await import('../../../lib/queryClient');
const { profileKeys } = await import('../hooks');

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({
      state: { status: 'success' },
      queryKey,
    });

  it('never writes the profile row or the consent row', () => {
    expect(dehydrates(profileKeys.own)).toBe(false);
    expect(dehydrates(profileKeys.consent('00000000-0000-0000-0000-000000000001'))).toBe(false);
  });

  it('still writes the frame picker, which carries nothing personal', () => {
    expect(dehydrates(profileKeys.frames)).toBe(true);
  });
});
