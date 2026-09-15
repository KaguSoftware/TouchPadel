import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { resendSignUpCode, signInWithPhone } from '../src/features/auth/api';
import { linkErrorParam } from '../src/features/auth/deepLink';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { classifyPhoneSignIn, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { SocialSignInBlock } from '../src/components/social';
import { PhoneField } from '../src/components/phone';
import { DEFAULT_ISO } from '../src/features/profile/phone';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FooterLink,
  FormScreen,
  LabeledDivider,
  LinkText,
  Screen,
  Title,
} from '../src/components/ui';
import { useToast } from '../src/components/overlays';

/**
 * Sign in: phone + password (owner decision 2026-09-15; email sign-in removed).
 * No code is sent here — the number was confirmed once, at sign-up. Errors are
 * distinguished (spec 05.4): wrong credentials render on the password field; a
 * number whose sign-up code was never entered gets a fresh code and goes to
 * the code step; anything else renders below.
 *
 * Continue with Apple / Google sit above the form (vendor addition 2026-09-01).
 * Hidden where unavailable (Google in Expo Go).
 */
function SignInScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // useAuthDeepLink lands here when an old emailed link is dead, so the user is
  // told why instead of finding themselves back on sign-in for no visible reason.
  const linkError = linkErrorParam(useLocalSearchParams<{ authError?: string }>().authError);
  // Same landing as the phone path: welcome-back toast, then the pending slot
  // (hold + Review) or the tabs. A phone-less first social sign-in is routed to
  // complete-profile by the hook instead.
  const social = useSocialSignIn({
    onComplete: () => {
      toast(t('auth.welcomeBack'), 'info');
      continueAfterAuth();
    },
    disabled: busy || holdBusy,
  });

  const onSubmit = async () => {
    setError(null);
    setPhoneError(null);
    setPasswordError(null);
    social.clearError();
    const { e164 } = validatePhoneInput(iso, national);
    if (!e164) return setPhoneError(t(national.trim() ? 'auth.phoneOtpInvalid' : 'auth.phoneRequired'));
    if (!password) return setPasswordError(t('auth.passwordRequired'));
    setBusy(true);
    try {
      await signInWithPhone(supabase, e164, password);
      toast(t('auth.welcomeBack'), 'info');
      // Pending slot -> hold + Review; otherwise the tabs.
      continueAfterAuth();
    } catch (err) {
      switch (classifyPhoneSignIn(err)) {
        case 'wrong-credentials':
          setPasswordError(t('auth.invalidCredentials'));
          break;
        case 'phone-not-confirmed':
          // The sign-up's code was never entered. The password was right (GoTrue
          // checks it first), so finishing the confirmation is all that is owed.
          try {
            await resendSignUpCode(supabase, e164);
            router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'signup' } });
          } catch (resendErr) {
            setError(t(mapOtpError(resendErr)));
          }
          break;
        default:
          setError(t(mapErrorToKey(err)));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <FormScreen>
        <Title plain>{t('auth.signIn')}</Title>
        <SocialSignInBlock
          available={social.available}
          busyProvider={social.busyProvider}
          disabled={busy || holdBusy}
          onPress={(provider) => void social.signInWith(provider)}
          style={{ marginTop: 14 }}
        />
        {hasSocial(social.available) ? (
          <LabeledDivider label={t('auth.orContinueWithPhone')} style={{ marginTop: 18, marginBottom: 4 }} />
        ) : null}
        <PhoneField
          placeholder={t('auth.phoneLabel')}
          iso={iso}
          onChangeIso={setIso}
          national={national}
          onChangeNational={setNational}
          error={phoneError}
        />
        <Field
          placeholder={t('auth.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          error={passwordError}
          onSubmitEditing={() => void onSubmit()}
        />
        <ErrorText>{error ?? social.errorText ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button
          label={t('auth.signIn')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <LinkText
          label={t('auth.forgotPassword')}
          onPress={() => router.push('/forgot-password')}
          style={{ marginTop: 12, paddingStart: 4 }}
        />
        <FooterLink
          lead={t('auth.newHereLead')}
          label={t('auth.createAccountLink')}
          onPress={() => router.push('/sign-up')}
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
