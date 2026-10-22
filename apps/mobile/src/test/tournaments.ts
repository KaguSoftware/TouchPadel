import { afterAll, beforeAll, vi } from 'vitest';

/**
 * Turn the tournaments build switch ON for one vitest file (features/tournaments/shipped.ts).
 * The production build ships it "off", and so does the test env by default; the suites that test
 * tournament behaviour call this at the top, as `onlinePaymentsOn` does for payments.
 */
export function tournamentsOn(): void {
  beforeAll(() => {
    vi.stubEnv('EXPO_PUBLIC_TOURNAMENTS', 'on');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}
