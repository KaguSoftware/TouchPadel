/**
 * The ten auth screens, rendered in both languages.
 *
 * WHAT A CASE ASSERTS, AND WHY IT IS THOSE THREE THINGS:
 *  1. the screen mounts at all — this app had ZERO component tests before
 *     2026-09-21, so until today a screen that threw on mount was found by
 *     opening it;
 *  2. its PRIMARY action is on screen, by testID — the one control the screen
 *     exists for;
 *  3. the direction the tree resolved to matches the locale, AND the primary's
 *     label is the one `makeT(locale)` gives. The second half is what makes
 *     the AR cases mean anything: a screen that mirrored correctly but
 *     rendered English strings would pass on direction alone.
 *
 * The runner itself lives in `src/test/smokeCase.tsx`; this file is the LIST.
 */
// From '@jest/globals', not the ambient globals: @types/jest is not installed
// (nothing in this repo used jest before today), and the vitest suites next
// door import their own the same way. Same runtime objects either way.
import { afterAll, beforeAll } from '@jest/globals';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { profileFixture } from '../test/fixtures';
import { profileKeys } from '../features/profile/hooks';
import { clearRecoverySession, markRecoverySession } from '../features/auth/recovery';
import WelcomeScreen from '../../app/welcome';
import SignInScreen from '../../app/sign-in';
import SignUpScreen from '../../app/sign-up';
import ForgotPasswordScreen from '../../app/forgot-password';
import ResetPasswordScreen from '../../app/reset-password';
import VerifyEmailScreen from '../../app/verify-email';
import VerifyOtpScreen from '../../app/verify-otp';
import VerifyResultScreen from '../../app/verify-result';
import PhoneSignInScreen from '../../app/phone-sign-in';
import CompleteProfileScreen from '../../app/complete-profile';

/**
 * phone-sign-in and verify-otp are behind the phone-OTP flag, which
 * `phoneOtpEnabled()` reads from `process.env.EXPO_PUBLIC_PHONE_OTP` AT CALL
 * TIME (src/features/auth/phoneOtp.ts says so explicitly, so a test cannot
 * freeze it). Off, both screens are a `Redirect` and nothing else. Set for the
 * whole file and restored after, rather than per case: the screens read it
 * during render, not in an effect.
 */
const PHONE_OTP = process.env.EXPO_PUBLIC_PHONE_OTP;
beforeAll(() => {
  process.env.EXPO_PUBLIC_PHONE_OTP = 'on';
});
afterAll(() => {
  process.env.EXPO_PUBLIC_PHONE_OTP = PHONE_OTP;
});

const CASES: SmokeCase[] = [
  { route: 'welcome', Component: WelcomeScreen, primary: 'welcome.sign-in', labelKey: 'auth.signIn' },
  { route: 'sign-in', Component: SignInScreen, primary: 'sign-in.submit', labelKey: 'auth.signIn' },
  { route: 'sign-up', Component: SignUpScreen, primary: 'sign-up.submit', labelKey: 'auth.signUp' },
  {
    route: 'forgot-password',
    Component: ForgotPasswordScreen,
    primary: 'forgot-password.submit',
    // The method segment defaults to PHONE (`parseAuthMethod` treats anything
    // but the literal 'email' as phone), so the CTA sends a code, not a link.
    labelKey: 'auth.sendCode',
  },
  {
    route: 'reset-password',
    Component: ResetPasswordScreen,
    primary: 'reset-password.save',
    labelKey: 'common.save',
    // S6: the form renders ONLY while an in-session recovery marker is set AND
    // a session exists — anything else is a spinner for four seconds and then
    // "link expired". That is the guard doing its job, so the case arms it the
    // way the deep-link handler does rather than working around it.
    options: { session: 'in', params: { code: 'test-recovery-code' } },
    arrange: () => {
      markRecoverySession();
      return clearRecoverySession;
    },
  },
  {
    route: 'verify-email',
    Component: VerifyEmailScreen,
    primary: 'verify-email.resend',
    labelKey: 'auth.resendLink',
    options: { params: { email: 'guest@example.test' } },
  },
  {
    route: 'verify-otp',
    Component: VerifyOtpScreen,
    primary: 'verify-otp.continue',
    labelKey: 'auth.continueCta',
    options: { session: 'in', params: { phone: '+9647700000000', mode: 'signup' } },
  },
  {
    route: 'verify-result',
    Component: VerifyResultScreen,
    primary: 'verify-result.continue',
    labelKey: 'auth.continueCta',
  },
  {
    route: 'phone-sign-in',
    Component: PhoneSignInScreen,
    primary: 'phone-sign-in.send-code',
    labelKey: 'auth.sendCode',
    options: { session: 'in', params: { mode: 'link' } },
  },
  {
    route: 'complete-profile',
    Component: CompleteProfileScreen,
    primary: 'complete-profile.submit',
    labelKey: 'auth.completeProfileCta',
    // Without a profile row the screen is a skeleton: it renders the form only
    // once `useOwnProfile` has settled. Seeded rather than fetched, so the
    // assertion is about the form and not about a request's timing.
    options: { session: 'in', queryData: [[profileKeys.own, profileFixture({ phone: null })]] },
  },
];

runSmokeCases('auth screens', CASES);
