import { describe, expect, it, vi } from 'vitest';

/**
 * Which guest writes may retry by themselves (lib/queryClient.ts). Asserted on
 * the app's REAL client, with the three native modules it touches at import
 * stubbed (as staff/__tests__/queryDefaults does).
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

const { queryClient } = await import('../../../lib/queryClient');
const { RequestTimeoutError } = await import('@touch/core');

type Retry = (n: number, e: unknown) => boolean;
const retryOf = (key: readonly unknown[]): unknown =>
  queryClient.getMutationDefaults(key).retry ?? queryClient.getDefaultOptions().mutations?.retry;

describe('guest write retries', () => {
  it('a write retries by itself only when it is safe to send twice', () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('cancel_reservation never retries: a repeat answers NOT_CANCELLABLE', () => {
    expect(retryOf(['cancel-reservation'])).toBe(false);
  });

  it('hold_slot (keyed) and confirm_booking (the hold id is its key) retry once, transient failures only', () => {
    for (const key of [['hold-slot'], ['confirm-booking']]) {
      const retry = retryOf(key) as Retry;
      expect(typeof retry).toBe('function');
      expect(retry(0, new TypeError('Network request failed'))).toBe(true);
      expect(retry(0, new RequestTimeoutError(15_000))).toBe(true);
      expect(retry(1, new TypeError('Network request failed'))).toBe(false);
      expect(retry(0, { message: 'SLOT_TAKEN', code: 'P0001' })).toBe(false);
      expect(retry(0, { message: 'HOLD_EXPIRED', code: 'P0001' })).toBe(false);
    }
  });
});

describe('query retries', () => {
  const retry = queryClient.getDefaultOptions().queries?.retry as Retry;

  it('retry transient failures, never a decision or a 4xx', () => {
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(0, { message: 'TimeoutError: Request timed out after 15000 ms', code: '' })).toBe(true);
    expect(retry(0, { message: 'deadlock detected', code: '40P01' })).toBe(true);
    expect(retry(3, new TypeError('Network request failed'))).toBe(false);
    expect(retry(0, { message: 'FORBIDDEN', code: 'P0001' })).toBe(false);
    // The old classifier retried anything that did not look like an app code.
    expect(retry(0, { message: 'permission denied for table profiles', code: '42501' })).toBe(false);
    expect(retry(0, { message: 'Could not find the function app.x', code: 'PGRST202' })).toBe(false);
  });
});
