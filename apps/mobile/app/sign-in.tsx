import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { sendSignInCode, signIn } from '../src/features/auth/api';
import { linkErrorParam } from '../src/features/auth/deepLink';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { useFinishSignIn } from '../src/features/auth/useFinishSignIn';
import { isNoAccountForPhone, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { isValidEmail, parseAuthMethod, type AuthMethod } from '../src/features/auth/emailAuth';
import { classifySignInFailure } from '../src/features/profile/changePasswordFlow';
import { SocialSignInBlock } from '../src/components/social';
import { PhoneField } from '../src/components/phone';
import { parsePhone } from '../src/features/profile/phone';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FooterLink,
  FormScreen,
  Hint,
  LabeledDivider,
  LinkText,
  Screen,
  SegmentedControl,
} from '../src/components/ui';
import { useToast } from '../src/components/overlays';

/**
 * Sign in with the account's phone number (default segment, owner decision
 * 2026-09-15) or its email (restored beside phone 2026-09-20, Phase 2 plan O2
 * — the SOW's M1 names email).
 *
 *   phone  a code, no password (owner, 2026-10-11): the number gets a code and
 *          app/verify-otp.tsx (mode signin) signs the guest in with it. Only an
 *          existing account gets one; a number nobody uses is told so on the
 *          field. A number whose sign-up code was never entered is confirmed
 *          by this code too.
 *   email  email + password. Wrong credentials render on the password field;
 *          an address whose link was never opened goes to verify-email and its
 *          resend button. Forgot password sits under this segment only.
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
  // A screen that sent the guest here (sign-up's footer, a dead email link)
  // says which segment to open on, so the method never flips under them.
  const [method, setMethod] = useState<AuthMethod>(() => parseAuthMethod(params.method));
  // Sign-up finding the number or address already taken passes it on, so the
  // guest only asks for the code (or types the password).
  const [iso, setIso] = useState(() => parsePhone(typeof params.phone === 'string' ? params.phone : '').iso);
  const [national, setNational] = useState(
    () => parsePhone(typeof params.phone === 'string' ? params.phone : '').national,
  );
  const [email, setEmail] = useState(() => (typeof params.email === 'string' ? params.email : ''));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
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
    setPhoneError(null);
    setEmailError(null);
    setPasswordError(null);
    social.clearError();
  };

  const onSubmitPhone = async () => {
    clearErrors();
    const { e164 } = validatePhoneInput(iso, national);
    if (!e164) return setPhoneError(t(national.trim() ? 'auth.phoneOtpInvalid' : 'auth.phoneRequired'));
    setBusy(true);
    try {
      await sendSignInCode(supabase, e164);
      // verify-otp signs in, then lands like the email path: staff, an
      // incomplete profile, the pending slot, or the tabs.
      router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'signin' } });
    } catch (err) {
      if (isNoAccountForPhone(err)) setPhoneError(t('auth.resetNoAccount'));
      else setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitEmail = async () => {
    clearErrors();
    if (!email.trim()) return setEmailError(t('auth.emailRequired'));
    if (!isValidEmail(email)) return setEmailError(t('auth.emailInvalid'));
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

  const onSubmit = method === 'email' ? onSubmitEmail : onSubmitPhone;

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
          style={{ marginTop: 14 }}
        />
        {hasSocial(social.available) ? (
          <LabeledDivider label={t('auth.orContinueWithPhoneOrEmail')} style={{ marginTop: 18, marginBottom: 4 }} />
        ) : null}
        <View style={{ marginTop: 6 }}>
          <SegmentedControl<AuthMethod>
            testID="sign-in.method"
            options={[
              { value: 'phone', label: t('auth.phoneLabel') },
              { value: 'email', label: t('auth.emailLabel') },
            ]}
            value={method}
            onChange={(next) => {
              setMethod(next);
              clearErrors();
            }}
          />
        </View>
        {method === 'email' ? (
          <>
            <Field
              testID="sign-in.email"
              placeholder={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              error={emailError}
              style={{ marginTop: 6 }}
            />
            <Field
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
          </>
        ) : (
          // Same 6pt the email Field takes, so the fields below sit at one
          // height whichever segment is selected.
          <View style={{ marginTop: 6 }}>
            <PhoneField
              testID="sign-in.phone"
              placeholder={t('auth.phoneLabel')}
              iso={iso}
              onChangeIso={setIso}
              national={national}
              onChangeNational={setNational}
              error={phoneError}
            />
            <Hint style={{ marginTop: 8 }}>{t('auth.signInCodeHint')}</Hint>
          </View>
        )}
        <ErrorText>{error ?? social.errorText ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button
          testID="sign-in.submit"
          label={t(method === 'email' ? 'auth.signIn' : 'auth.sendCode')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        {/* A phone sign-in has no password to forget. */}
        {method === 'email' ? (
          <LinkText
            testID="sign-in.forgot-password"
            label={t('auth.forgotPassword')}
            onPress={() => router.push({ pathname: '/forgot-password', params: { method: 'email' } })}
            style={{ marginTop: 12, paddingStart: 4 }}
          />
        ) : null}
        <FooterLink
          testID="sign-in.create-account"
          lead={t('auth.newHereLead')}
          label={t('auth.createAccountLink')}
          onPress={() => router.push({ pathname: '/sign-up', params: { method } })}
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
