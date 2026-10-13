import { afterAll, beforeAll } from '@jest/globals';

/**
 * Turn the store-build switch ON for one jest-expo smoke file
 * (features/deposit/enabled.ts), the way auth.smoke.test.tsx toggles
 * EXPO_PUBLIC_PHONE_OTP. Production builds ship it "off" and the jest env
 * defaults to unset (off); the suites that render payment or open-match
 * screens call this at the top. Set for the whole file and restored after:
 * the screens read it during render.
 */
export function onlinePaymentsOnForFile(): void {
  const before = process.env.EXPO_PUBLIC_ONLINE_PAYMENTS;
  beforeAll(() => {
    process.env.EXPO_PUBLIC_ONLINE_PAYMENTS = 'on';
  });
  afterAll(() => {
    if (before === undefined) delete process.env.EXPO_PUBLIC_ONLINE_PAYMENTS;
    else process.env.EXPO_PUBLIC_ONLINE_PAYMENTS = before;
  });
}
