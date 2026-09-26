import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../src/lib/supabase';
import { resendSignUpCode, signIn, signInWithPhone } from '../src/features/auth/api';
import { linkErrorParam } from '../src/features/auth/deepLink';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { clearPendingSlot, getPendingSlot } from '../src/features/booking/pendingSlot';
import { readOwnStaffRow } from '../src/features/staff/api';
import { writeStaffHint } from '../src/features/staff/hint';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { postSignInStep } from '../src/features/auth/social';
import { classifyPhoneSignIn, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { isValidEmail, parseAuthMethod, type AuthMethod } from '../src/features/auth/emailAuth';
import { classifySignInFailure } from '../src/features/profile/changePasswordFlow';
import { fetchOwnProfile } from '../src/features/profile/api';
import { profileKeys } from '../src/features/profile/hooks';
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
  SegmentedControl,
  Title,
} from '../src/components/ui';
import { useToast } from '../src/components/overlays';

/**
 * Sign in: a password, with the account's phone number (default segment,
 * owner decision 2026-09-15) or its email (restored beside phone 2026-09-20,
 * Phase 2 plan O2 — the SOW's M1 names email). No code is sent here — a
 * number is confirmed once, at sign-up. Errors are distinguished (spec 05.4):
 * wrong credentials render on the password field; a number whose sign-up code
 * was never entered gets a fresh code and goes to the code step; an email
 * whose link was never opened goes to verify-email and its resend button;
 * anything else renders below.
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
  const queryClient = useQueryClient();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const params = useLocalSearchParams<{ authError?: string; method?: string }>();
  // A screen that sent the guest here (sign-up's footer, a dead email link)
  // says which segment to open on, so the method never flips under them.
  const [method, setMethod] = useState<AuthMethod>(() => parseAuthMethod(params.method));
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [email, setEmail] = useState('');
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

  const onSubmitEmail = async () => {
    clearErrors();
    if (!email.trim()) return setEmailError(t('auth.emailRequired'));
    if (!isValidEmail(email)) return setEmailError(t('auth.emailInvalid'));
    if (!password) return setPasswordError(t('auth.passwordRequired'));
    setBusy(true);
    try {
      const { user } = await signIn(supabase, email, password);
      // Staff sign in here (build-contracts-2026-09-23 §6.6). The row is read
      // under the status provider's own key, so it asks nothing twice, and
      // alongside the profile, because RequireNoSession waits for both. A read
      // that fails is no answer: the guest path runs, and the provider routes
      // a staff account to Today once its own read lands.
      const staffRead = user ? readOwnStaffRow(queryClient, user.id).catch(() => null) : Promise.resolve(null);
      // Same cache entry RequireNoSession's useOwnProfile observes: one request.
      const profile = await queryClient.fetchQuery({
        queryKey: profileKeys.own,
        queryFn: () => fetchOwnProfile(supabase),
        staleTime: 0,
      });
      const staffRow = await staffRead;
      switch (postSignInStep(profile, getPendingSlot() !== null, staffRow)) {
        case 'staff':
          // A staff account books nothing: the slot a guest tapped is dropped.
          clearPendingSlot();
          if (user) await writeStaffHint(user.id);
          toast(t('auth.welcomeBack'), 'info');
          router.replace('/staff');
          return;
        case 'complete-profile':
          router.replace({ pathname: '/complete-profile', params: { returnTo: 'continue' } });
          return;
        case 'await-gate':
          // RequireNoSession routes the incomplete profile there itself.
          return;
        default:
          toast(t('auth.welcomeBack'), 'info');
          continueAfterAuth();
      }
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
      <FormScreen>
        <Title plain>{t('auth.signIn')}</Title>
        <SocialSignInBlock
          testID="sign-in.social"
          available={social.available}
          busyProvider={social.busyProvider}
          disabled={busy || holdBusy}
          onPress={(provider) => void social.signInWith(provider)}
          style={{ marginTop: 14 }}
        />
        {hasSocial(social.available) ? (
          <LabeledDivider label={t('auth.orContinueWithPassword')} style={{ marginTop: 18, marginBottom: 4 }} />
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
        ) : (
          <PhoneField
            testID="sign-in.phone"
            placeholder={t('auth.phoneLabel')}
            iso={iso}
            onChangeIso={setIso}
            national={national}
            onChangeNational={setNational}
            error={phoneError}
          />
        )}
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
        <ErrorText>{error ?? social.errorText ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button
          testID="sign-in.submit"
          label={t('auth.signIn')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <LinkText
          testID="sign-in.forgot-password"
          label={t('auth.forgotPassword')}
          onPress={() => router.push({ pathname: '/forgot-password', params: { method } })}
          style={{ marginTop: 12, paddingStart: 4 }}
        />
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
