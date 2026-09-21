import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { isPhoneTaken, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import {
  isEmailTaken,
  mapEmailAuthError,
  parseAuthMethod,
  signUpHidExistingEmail,
  type AuthMethod,
} from '../src/features/auth/emailAuth';
import type { Locale } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import { signUpWithEmail, signUpWithPhone, validateSignUp } from '../src/features/auth/api';
import { verifyRedirect } from '../src/features/auth/redirects';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { classifyUpdateFailure } from '../src/features/profile/changePasswordFlow';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import { legalUrl } from '../src/lib/legal';
import {
  Button,
  ErrorText,
  Field,
  FooterLink,
  FormScreen,
  LabeledDivider,
  MicroLabel,
  Screen,
  SegmentedControl,
  Title,
} from '../src/components/ui';
import { PhoneField } from '../src/components/phone';
import { DEFAULT_ISO } from '../src/features/profile/phone';
import { SocialSignInBlock } from '../src/components/social';
import { useToast } from '../src/components/overlays';

type FieldErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  password?: string;
};

/**
 * Create account: first name · surname · (email) · phone · password ·
 * preferred language, with a password proved by the phone number (default
 * segment, owner decision 2026-09-15) or by an email address (restored beside
 * phone 2026-09-20, Phase 2 plan O2). Validation renders on the field it
 * concerns, in the form's order.
 *
 *   phone  submitting sends ONE code — WhatsApp, or SMS when the number has no
 *          WhatsApp — to confirm the number (app/verify-otp.tsx, mode signup);
 *          every later sign-in is phone + password with no code.
 *   email  submitting mails ONE link; app/verify-email.tsx waits for it and
 *          useAuthDeepLink exchanges it. The phone is still required (spec
 *          05.3: the desk calls it), so an email guest never meets
 *          PHONE_REQUIRED at confirm_booking; complete-profile remains the
 *          backstop for accounts that lack one.
 *
 * Continue with Apple / Google sit above the form (vendor addition 2026-09-01).
 * A social sign-up has no phone, so complete-profile collects one before the
 * first booking.
 */
function SignUpScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ method?: string }>();
  const [method, setMethod] = useState<AuthMethod>(() => parseAuthMethod(params.method));
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  // Country + national digits; the API receives the composed E.164.
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [password, setPassword] = useState('');
  const [preferredLang, setPreferredLang] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const social = useSocialSignIn({
    onComplete: () => {
      toast(t('auth.welcomeBack'), 'info');
      continueAfterAuth();
    },
    disabled: busy,
  });

  /** Shared field checks; the E.164 or null when something is wrong (already rendered). */
  const validate = (): string | null => {
    const invalid = validateSignUp({
      firstName,
      lastName,
      email: method === 'email' ? email : undefined,
      phoneNational: national,
      password,
    });
    if (invalid === 'FIRST_NAME_REQUIRED') {
      setFieldErrors({ firstName: t('auth.firstNameRequired') });
      return null;
    }
    if (invalid === 'LAST_NAME_REQUIRED') {
      setFieldErrors({ lastName: t('auth.lastNameRequired') });
      return null;
    }
    if (invalid === 'EMAIL_INVALID') {
      setFieldErrors({ email: t(email.trim() ? 'auth.emailInvalid' : 'auth.emailRequired') });
      return null;
    }
    if (invalid === 'PHONE_REQUIRED') {
      setFieldErrors({ phone: t('auth.phoneRequired') });
      return null;
    }
    const { e164 } = validatePhoneInput(iso, national);
    // A code to a number that cannot be one is paid for; stop at the field.
    if (!e164) {
      setFieldErrors({ phone: t('auth.phoneOtpInvalid') });
      return null;
    }
    if (invalid === 'PASSWORD_TOO_SHORT') {
      setFieldErrors({ password: t('auth.passwordTooShort') });
      return null;
    }
    return e164;
  };

  const onSubmit = async () => {
    setError(null);
    setFieldErrors({});
    social.clearError();
    const e164 = validate();
    if (!e164) return;
    setBusy(true);
    try {
      if (method === 'email') {
        const data = await signUpWithEmail(
          supabase,
          { firstName, lastName, email, phone: e164, password, preferredLang },
          verifyRedirect(),
        );
        if (signUpHidExistingEmail(data)) return setFieldErrors({ email: t('auth.emailTaken') });
      } else {
        await signUpWithPhone(supabase, { firstName, lastName, phone: e164, password, preferredLang });
      }
      // The chosen language becomes the app language — strings, faces and
      // layout direction switch in one commit, under a short crossfade, before
      // the code / check-your-email screen comes up.
      await setLocale(preferredLang);
      if (method === 'email') {
        // Confirmations on: no session yet, verify-email waits for the link.
        // Off: the session has landed and verify-email's own session effect
        // advances to verify-result.
        router.replace({ pathname: '/verify-email', params: { email: email.trim() } });
      } else {
        router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'signup' } });
      }
    } catch (err) {
      if (method === 'email' && isEmailTaken(err)) return setFieldErrors({ email: t('auth.emailTaken') });
      if (method === 'phone' && isPhoneTaken(err)) return setFieldErrors({ phone: t('auth.phoneTaken') });
      if (classifyUpdateFailure(err) === 'weak-password') {
        return setFieldErrors({ password: t('auth.passwordTooShort') });
      }
      setError(t(method === 'email' ? mapEmailAuthError(err) : mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <FormScreen contentStyle={{ flexGrow: 1 }}>
        <Title plain>{t('auth.signUp')}</Title>
        <SocialSignInBlock
          testID="sign-up.social"
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
            testID="sign-up.method"
            options={[
              { value: 'phone', label: t('auth.phoneLabel') },
              { value: 'email', label: t('auth.emailLabel') },
            ]}
            value={method}
            onChange={(next) => {
              setMethod(next);
              setFieldErrors({});
              setError(null);
            }}
          />
        </View>
        <Field
          testID="sign-up.first-name"
          placeholder={t('auth.firstNameLabel')}
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          error={fieldErrors.firstName}
          style={{ marginTop: 6 }}
        />
        <Field
          testID="sign-up.last-name"
          placeholder={t('auth.lastNameLabel')}
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          error={fieldErrors.lastName}
        />
        {method === 'email' ? (
          <Field
            testID="sign-up.email"
            placeholder={t('auth.emailLabel')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            error={fieldErrors.email}
          />
        ) : null}
        <PhoneField
          testID="sign-up.phone"
          placeholder={t('auth.phoneLabel')}
          iso={iso}
          onChangeIso={setIso}
          national={national}
          onChangeNational={setNational}
          error={fieldErrors.phone}
        />
        <Field
          testID="sign-up.password"
          placeholder={t('auth.passwordMinPlaceholder')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          error={fieldErrors.password}
        />
        <View style={{ marginTop: space.sm }}>
          <MicroLabel style={{ marginBottom: 5 }}>{t('auth.preferredLanguage')}</MicroLabel>
          <SegmentedControl<Locale>
            testID="sign-up.language"
            options={[
              { value: 'en', label: t('settings.english') },
              { value: 'ar', label: t('settings.arabic') },
            ]}
            value={preferredLang}
            onChange={setPreferredLang}
            pinOrder
          />
        </View>
        <ErrorText>{error ?? social.errorText}</ErrorText>
        <Button
          testID="sign-up.submit"
          label={t('auth.signUp')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <FooterLink
          testID="sign-up.sign-in"
          lead={t('auth.alreadyLead')}
          label={t('auth.signIn')}
          // Reached from Profile as well as Welcome — always land on sign-in,
          // on the segment the guest was using here.
          onPress={() => router.replace({ pathname: '/sign-in', params: { method } })}
          style={{ marginTop: 18 }}
        />
        {/* Pushed to the bottom of the screen (flexGrow content) so it reads
            as a persistent footer instead of crowding the Sign in link. */}
        <FooterLink
          testID="sign-up.privacy-policy"
          label={t('settings.privacyPolicy')}
          onPress={() =>
            void Linking.openURL(legalUrl('privacy', locale)).catch(() => toast(t('settings.linkFailed'), 'error'))
          }
          style={{ marginTop: 'auto', paddingTop: 14 }}
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
export default function GuardedSignUpScreen() {
  return (
    <RequireNoSession>
      <SignUpScreen />
    </RequireNoSession>
  );
}
