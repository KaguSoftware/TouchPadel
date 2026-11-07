import { useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { sendSignInCode, signIn } from '../src/features/auth/api';
import { linkErrorParam } from '../src/features/auth/deepLink';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { useFinishSignIn } from '../src/features/auth/useFinishSignIn';
import { isNoAccountForPhone, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { isValidEmail } from '../src/features/auth/emailAuth';
import { identifierKind, phoneFromIdentifier } from '../src/features/auth/identifier';
import { IdentifierField } from '../src/components/IdentifierField';
import { Reveal } from '../src/components/Reveal';
import { FloatingField } from '../src/components/FloatingLabel';
import { classifySignInFailure } from '../src/features/profile/changePasswordFlow';
import { SocialSignInBlock } from '../src/components/social';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import {
  Button,
  ErrorText,
  FooterLink,
  FormScreen,
  Hint,
  LabeledDivider,
  LinkText,
  Screen,
} from '../src/components/ui';
import { useToast } from '../src/components/overlays';

/**
 * Sign in through ONE field that takes the account's email or its phone
 * number; what was typed decides the rest (features/auth/identifier.ts):
 *
 *   phone  a code, no password (owner, 2026-10-11): the number gets a code and
 *          app/verify-otp.tsx (mode signin) signs the guest in with it. Only an
 *          existing account gets one; a number nobody uses is told so on the
 *          field. A number whose sign-up code was never entered is confirmed
 *          by this code too.
 *   email  email + password (the password field appears once an address is
 *          typed). Wrong credentials render on the password field; an address
 *          whose link was never opened goes to verify-email and its resend
 *          button. Forgot password shows under an email only.
 *
 * Anything else renders below (spec 05.4).
 *
 * An email account may predate the phone requirement and lack a phone. Such a
 * guest is routed through complete-profile before anything else — the same
 * postSignInStep decision the social path takes — so 0059's PHONE_REQUIRED at
 * confirm_booking is met before Review, not discovered there.
 *
 * Continue with Apple / Google sit above the form (vendor addition 2026-09-01).
 * Hidden where unavailable (Google in Expo Go).
 */
function SignInScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const finishSignIn = useFinishSignIn(continueAfterAuth);
  const params = useLocalSearchParams<{ authError?: string; method?: string; phone?: string; email?: string }>();
  // A screen that sent the guest here (a dead email link, a sign-up that found
  // the number or address taken) passes it on, so the field arrives filled.
  const [identifier, setIdentifier] = useState(() =>
    typeof params.email === 'string' ? params.email : typeof params.phone === 'string' ? params.phone : '',
  );
  const kind = identifierKind(identifier);
  const email = identifier;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // useAuthDeepLink lands here when an emailed link is dead, so the user is
  // told why instead of finding themselves back on sign-in for no visible reason.
  const linkError = linkErrorParam(params.authError);
  // Same landing as the password paths: welcome-back toast, then the pending
  // slot (hold + Review) or the tabs. A phone-less first social sign-in is
  // routed to complete-profile by the hook instead.
  const social = useSocialSignIn({
    onComplete: () => {
      toast(t('auth.welcomeBack'), 'info');
      continueAfterAuth();
    },
    disabled: busy || holdBusy,
  });

  const clearErrors = () => {
    setError(null);
    setIdentifierError(null);
    setPasswordError(null);
    social.clearError();
  };

  const onSubmitPhone = async () => {
    clearErrors();
    const { iso, national, plausible } = phoneFromIdentifier(identifier);
    const { e164 } = validatePhoneInput(iso, national);
    if (!e164 || !plausible) return setIdentifierError(t('auth.phoneOtpInvalid'));
    setBusy(true);
    try {
      await sendSignInCode(supabase, e164);
      // verify-otp signs in, then lands like the email path: staff, an
      // incomplete profile, the pending slot, or the tabs.
      router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'signin' } });
    } catch (err) {
      if (isNoAccountForPhone(err)) setIdentifierError(t('auth.resetNoAccount'));
      else setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitEmail = async () => {
    clearErrors();
    if (!isValidEmail(email)) return setIdentifierError(t('auth.emailInvalid'));
    if (!password) return setPasswordError(t('auth.passwordRequired'));
    setBusy(true);
    try {
      const { user } = await signIn(supabase, email, password);
      await finishSignIn(user);
    } catch (err) {
      switch (classifySignInFailure(err)) {
        case 'wrong-password':
          setPasswordError(t('auth.invalidEmailCredentials'));
          break;
        case 'email-not-confirmed':
          // The sign-up's link was never opened. The password was right, so
          // verify-email (with its resend button) is all that is owed.
          router.push({ pathname: '/verify-email', params: { email: email.trim() } });
          break;
        default:
          setError(t(mapErrorToKey(err)));
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = () => {
    if (kind === 'none') {
      clearErrors();
      return setIdentifierError(t('auth.identifierRequired'));
    }
    return kind === 'email' ? onSubmitEmail() : onSubmitPhone();
  };

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.signIn') }} />
      <FormScreen>
        <SocialSignInBlock
          testID="sign-in.social"
          available={social.available}
          busyProvider={social.busyProvider}
          disabled={busy || holdBusy}
          onPress={(provider) => void social.signInWith(provider)}
          googleBrowserOffer={social.googleBrowserOffer}
          onGoogleBrowser={() => void social.signInWith('google', 'browser')}
          style={{ marginTop: 14 }}
        />
        {hasSocial(social.available) ? (
          <LabeledDivider label={t('auth.orContinueWithPhoneOrEmail')} style={{ marginTop: 18, marginBottom: 4 }} />
        ) : null}
        <IdentifierField
          testID="sign-in.identifier"
          placeholder={t('auth.identifierLabel')}
          value={identifier}
          onChangeText={(v) => {
            setIdentifier(v);
            if (identifierError) setIdentifierError(null);
          }}
          error={identifierError}
          style={{ marginTop: 6 }}
          onSubmitEditing={() => void onSubmit()}
        />
        {/* The password field stays mounted until a phone number is typed: iOS/Android
            autofill looks for the password field when the username is filled, and a field
            that only appears once an email is typed is not there to receive it. */}
        <Reveal show={kind !== 'phone'}>
          <FloatingField
            testID="sign-in.password"
            placeholder={t('auth.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            error={passwordError}
            onSubmitEditing={() => void onSubmit()}
          />
        </Reveal>
        <Reveal show={kind === 'phone'}>
          <Hint style={{ marginTop: 8 }}>{t('auth.signInCodeHint')}</Hint>
        </Reveal>
        <ErrorText>{error ?? social.errorText ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button
          testID="sign-in.submit"
          label={t(kind === 'email' ? 'auth.signIn' : kind === 'phone' ? 'auth.sendCode' : 'auth.continueCta')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        {/* A phone sign-in has no password to forget. */}
        <Reveal show={kind === 'email'}>
          <LinkText
            testID="sign-in.forgot-password"
            label={t('auth.forgotPassword')}
            onPress={() => router.push({ pathname: '/forgot-password', params: { method: 'email' } })}
            style={{ marginTop: 12, paddingStart: 4 }}
          />
        </Reveal>
        <FooterLink
          testID="sign-in.create-account"
          lead={t('auth.newHereLead')}
          label={t('auth.createAccountLink')}
          onPress={() => router.replace('/sign-up')}
          style={{ marginTop: 18 }}
        />
      </FormScreen>
    </Screen>
  );
}

/**
 * Signed-out only, on the ROOT stack. The `(auth)` group carried this rule in
 * its layout; flattening it is what lets UIKit draw its own back item here
 * instead of a JS stand-in. See RequireNoSession for the pending-slot
 * exemption that keeps the post-auth booking continuation working.
 */
export default function GuardedSignInScreen() {
  return (
    <RequireNoSession>
      <SignInScreen />
    </RequireNoSession>
  );
}
