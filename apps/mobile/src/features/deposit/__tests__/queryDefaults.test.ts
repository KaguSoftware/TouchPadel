import { describe, expect, it, vi } from 'vitest';

/**
 * The deposit family's query defaults, set once in lib/queryClient.ts
 * (build-contracts-2026-09-27 §4): `begin` runs now or fails now, the quote
 * fails fast to Review's plain Confirm, and no payment state is ever written
 * to the disk cache. Asserted on the app's REAL client, with the three native
 * modules it touches at import stubbed (as staff/__tests__/queryDefaults does).
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
const { depositKeys } = await import('../keys');

type Retry = (n: number, e: unknown) => boolean;

describe('deposit-begin', () => {
  it('never pauses offline to open a payment page minutes after the tap', () => {
    expect(queryClient.getMutationDefaults(depositKeys.mutation('begin')).networkMode).toBe('always');
  });

  it('retries once, and never a refusal the server already made', () => {
    const retry = queryClient.getMutationDefaults(depositKeys.mutation('begin')).retry as Retry;
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
    expect(retry(0, { message: 'PROVIDER_UNAVAILABLE' })).toBe(false);
    expect(retry(0, { message: 'TOO_MANY_ATTEMPTS' })).toBe(false);
  });
});

describe('the deposit quote', () => {
  it('fails fast on anything but a dropped connection', () => {
    const retry = queryClient.getQueryDefaults(depositKeys.quote('hold-1')).retry as Retry;
    // An older server answers PGRST202 ("could not find the function"):
    // Review must fall back to Confirm at once, not after three backed-off tries.
    expect(retry(0, { message: 'Could not find the function app.deposit_quote(p_hold_id)' })).toBe(false);
    expect(retry(0, { message: 'FORBIDDEN' })).toBe(false);
    expect(retry(0, new TypeError('Network request failed'))).toBe(true);
    expect(retry(1, new TypeError('Network request failed'))).toBe(false);
  });

  it('leaves the status read on the app defaults', () => {
    expect(queryClient.getQueryDefaults(depositKeys.status('r-1')).retry).toBeUndefined();
  });
});

describe('the disk cache', () => {
  const dehydrates = (queryKey: readonly unknown[]) =>
    persistOptions.dehydrateOptions.shouldDehydrateQuery({ state: { status: 'success' }, queryKey });

  it('never writes a payment’s state to disk', () => {
    expect(dehydrates(depositKeys.quote('hold-1'))).toBe(false);
    expect(dehydrates(depositKeys.status('r-1'))).toBe(false);
  });

  it('still persists the guest’s ordinary reads', () => {
    expect(dehydrates(['courts'])).toBe(true);
  });
});
