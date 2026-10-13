import { afterAll, beforeAll, vi } from 'vitest';

/**
 * Turn the store-build switch ON for one vitest file (features/deposit/enabled.ts).
 * Production builds ship it "off", and so does the test env by default; the
 * suites that test payment or open-match behaviour call this at the top.
 */
export function onlinePaymentsOn(): void {
  beforeAll(() => {
    vi.stubEnv('EXPO_PUBLIC_ONLINE_PAYMENTS', 'on');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}
