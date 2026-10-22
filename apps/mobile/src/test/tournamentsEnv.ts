import { afterAll, beforeAll } from '@jest/globals';

/**
 * Turn the tournaments build switch ON for one jest-expo smoke file
 * (features/tournaments/shipped.ts), the way `onlinePaymentsOnForFile` does for payments. The
 * production build ships it "off" and the jest env defaults to unset (off); the suites that
 * render tournament screens call this at the top.
 */
export function tournamentsOnForFile(): void {
  const before = process.env.EXPO_PUBLIC_TOURNAMENTS;
  beforeAll(() => {
    process.env.EXPO_PUBLIC_TOURNAMENTS = 'on';
  });
  afterAll(() => {
    if (before === undefined) delete process.env.EXPO_PUBLIC_TOURNAMENTS;
    else process.env.EXPO_PUBLIC_TOURNAMENTS = before;
  });
}
