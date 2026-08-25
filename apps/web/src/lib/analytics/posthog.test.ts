import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetAnalyticsForTests, capture, isDisabled, isEnabled, registerSuperProps } from './posthog';

/**
 * These guard the two promises the guest app makes about analytics:
 *  1. no key / kill switch  -> nothing runs, nothing throws;
 *  2. capture() before the SDK loads is a silent no-op (never a crash).
 */

const store = new Map<string, string>();

function stubBrowser(search = ''): void {
  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  });
}

beforeEach(() => {
  store.clear();
  __resetAnalyticsForTests();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('guest analytics gating', () => {
  it('is disabled on the server (no window)', () => {
    expect(isDisabled()).toBe(true);
    expect(isEnabled()).toBe(false);
  });

  it('is disabled without a PostHog key even in a browser', () => {
    stubBrowser();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    expect(isEnabled()).toBe(false);
  });

  it('?analytics=off persists the kill switch and disables tracking', () => {
    stubBrowser('?analytics=off');
    expect(isDisabled()).toBe(true);
    expect(store.get('tp-analytics')).toBe('off');
    // sticky on later visits without the query param
    stubBrowser('');
    expect(isDisabled()).toBe(true);
  });

  it('capture() and registerSuperProps() are no-ops before the SDK loads', () => {
    stubBrowser();
    expect(() => capture('item_viewed', { item_id: 'x' })).not.toThrow();
    expect(() => registerSuperProps({ locale: 'ar' })).not.toThrow();
  });
});
