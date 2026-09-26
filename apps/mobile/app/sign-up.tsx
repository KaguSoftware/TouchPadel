import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import type { Locale } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import { signUp, validateSignUp } from '../src/features/auth/api';
import { verifyRedirect } from '../src/features/auth/redirects';
import { hasSocial, useSocialSignIn } from '../src/features/auth/useSocialSignIn';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
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
  MicroLabel,
  Screen,
  SegmentedControl,
  Title,
} from '../src/components/ui';
import { PhoneField } from '../src/components/phone';
import { composePhone, DEFAULT_ISO, validatePhone } from '../src/features/profile/phone';
import { SocialSignInBlock } from '../src/components/social';
import { useToast } from '../src/components/overlays';

/**
 * Create account (design 2026-08-31): name · email · password · phone ·
 * preferred language — four fields in the design's order, no confirm-password
 * (spec 05.3). Validation renders on the field it concerns.
 *
 * Continue with Apple / Google sit above the form (vendor addition 2026-09-01;
 * SOW L259-260 lists social sign-in as not included). A social sign-up needs no
 * email verification — provider emails are verified — so it never lands on
 * verify-email; a missing phone is collected on complete-profile instead.
 */
function SignUpScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Country + national digits; `signUp` receives the composed E.164.
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [preferredLang, setPreferredLang] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    phone?: string;
  }>({});
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
    const phone = composePhone(iso, national);
    const invalid = validateSignUp({ fullName, email, password, phone });
    if (invalid === 'NAME_REQUIRED') return setFieldErrors({ name: t('auth.nameRequired') });
    if (invalid === 'EMAIL_INVALID') return setFieldErrors({ email: t('auth.emailInvalid') });
    if (invalid === 'PASSWORD_TOO_SHORT') return setFieldErrors({ password: t('auth.passwordTooShort') });
    if (invalid === 'PHONE_REQUIRED') return setFieldErrors({ phone: t('auth.phoneRequired') });
    if (invalid) return setError(t('errors.validation'));
    // Length check runs LAST so the field order of the form is the order the
    // guest is corrected in — name, email, password, then the phone.
    if (validatePhone(iso, national)) return setFieldErrors({ phone: t('auth.phoneInvalid') });
    setBusy(true);
    try {
      await signUp(supabase, { fullName, email, phone, password, preferredLang }, verifyRedirect());
      // The chosen language becomes the app language — strings, faces and
      // layout direction switch in one commit, under a short crossfade, before
      // the verify screen comes up.
      await setLocale(preferredLang);
      router.replace({ pathname: '/verify-email', params: { email } });
    } catch (err) {
      setError(t(mapErrorToKey(err)));
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
          <LabeledDivider label={t('auth.orContinueWithEmail')} style={{ marginTop: 18, marginBottom: 4 }} />
        ) : null}
        <Field
          placeholder={t('auth.fullNameLabel')}
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          error={fieldErrors.name}
          style={{ marginTop: 6 }}
        />
        <Field
          placeholder={t('auth.emailLabel')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          importantForAutofill="yes"
          autoCorrect={false}
          spellCheck={false}
          secureTextEntry={false}
          error={fieldErrors.email}
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
        <PhoneField
          placeholder={t('auth.phoneLabel')}
          iso={iso}
          onChangeIso={setIso}
          national={national}
          onChangeNational={setNational}
          error={fieldErrors.phone}
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
