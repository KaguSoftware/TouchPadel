import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { isPhoneTaken, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import type { Locale } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import { signUpWithPhone, validateSignUp } from '../src/features/auth/api';
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

type FieldErrors = { firstName?: string; lastName?: string; phone?: string; password?: string };

/**
 * Create account. Phone is the only way to make one (owner decision
 * 2026-09-15; email sign-up removed): first name · surname · phone · password
 * · preferred language. Submitting sends ONE code — WhatsApp, or SMS when the
 * number has no WhatsApp — to confirm the
 * number (app/verify-otp.tsx, mode signup); every later sign-in is phone +
 * password with no code. Validation renders on the field it concerns, in the
 * form's order.
 *
 * Continue with Apple / Google sit above the form (vendor addition 2026-09-01).
 * A social sign-up has no phone, so complete-profile collects one before the
 * first booking.
 */
function SignUpScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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

  const onSubmit = async () => {
    setError(null);
    setFieldErrors({});
    social.clearError();
    const invalid = validateSignUp({ firstName, lastName, phoneNational: national, password });
    if (invalid === 'FIRST_NAME_REQUIRED') return setFieldErrors({ firstName: t('auth.firstNameRequired') });
    if (invalid === 'LAST_NAME_REQUIRED') return setFieldErrors({ lastName: t('auth.lastNameRequired') });
    if (invalid === 'PHONE_REQUIRED') return setFieldErrors({ phone: t('auth.phoneRequired') });
    const { e164 } = validatePhoneInput(iso, national);
    // A code to a number that cannot be one is paid for; stop at the field.
    if (!e164) return setFieldErrors({ phone: t('auth.phoneOtpInvalid') });
    if (invalid === 'PASSWORD_TOO_SHORT') return setFieldErrors({ password: t('auth.passwordTooShort') });
    setBusy(true);
    try {
      await signUpWithPhone(supabase, { firstName, lastName, phone: e164, password, preferredLang });
      // The chosen language becomes the app language — strings, faces and
      // layout direction switch in one commit, under a short crossfade, before
      // the code screen comes up.
      await setLocale(preferredLang);
      router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'signup' } });
    } catch (err) {
      if (isPhoneTaken(err)) return setFieldErrors({ phone: t('auth.phoneTaken') });
      if (classifyUpdateFailure(err) === 'weak-password') {
        return setFieldErrors({ password: t('auth.passwordTooShort') });
      }
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <FormScreen>
        <Title plain>{t('auth.signUp')}</Title>
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
        <Field
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
          placeholder={t('auth.lastNameLabel')}
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          error={fieldErrors.lastName}
        />
        <PhoneField
          placeholder={t('auth.phoneLabel')}
          iso={iso}
          onChangeIso={setIso}
          national={national}
          onChangeNational={setNational}
          error={fieldErrors.phone}
        />
        <Field
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
          label={t('auth.signUp')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={social.busyProvider !== null}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <FooterLink
          lead={t('auth.alreadyLead')}
          label={t('auth.signIn')}
          // Reached from Profile as well as Welcome — always land on sign-in.
          onPress={() => router.replace('/sign-in')}
          style={{ marginTop: 18 }}
        />
        <FooterLink
          lead={t('auth.privacyLead')}
          label={t('settings.privacyPolicy')}
          onPress={() =>
            void Linking.openURL(legalUrl('privacy', locale)).catch(() => toast(t('settings.linkFailed'), 'error'))
          }
          style={{ marginTop: 14 }}
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
