import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import type { Locale } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import { signUp, validateSignUp } from '../src/features/auth/api';
import { verifyRedirect } from '../src/features/auth/redirects';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FooterLink,
  FormScreen,
  MicroLabel,
  Screen,
  SegmentedControl,
  Title,
} from '../src/components/ui';

/**
 * Create account (design 2026-08-31): name · email · password · phone ·
 * preferred language — four fields in the design's order, no confirm-password
 * (spec 05.3). Validation renders on the field it concerns.
 */
function SignUpScreen() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredLang, setPreferredLang] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    phone?: string;
  }>({});
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setFieldErrors({});
    const invalid = validateSignUp({ fullName, email, password, phone });
    if (invalid === 'NAME_REQUIRED') return setFieldErrors({ name: t('auth.nameRequired') });
    if (invalid === 'EMAIL_INVALID') return setFieldErrors({ email: t('auth.emailInvalid') });
    if (invalid === 'PASSWORD_TOO_SHORT') return setFieldErrors({ password: t('auth.passwordTooShort') });
    if (invalid === 'PHONE_REQUIRED') return setFieldErrors({ phone: t('auth.phoneRequired') });
    if (invalid) return setError(t('errors.validation'));
    setBusy(true);
    try {
      await signUp(supabase, { fullName, email, phone, password, preferredLang }, verifyRedirect());
      // The chosen language becomes the app language; direction is reconciled
      // on the next launch rather than flipped under the verify screen.
      await setLocale(preferredLang, { flip: false });
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
        <Field
          placeholder={t('auth.phoneLabel')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
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
          />
        </View>
        <ErrorText>{error}</ErrorText>
        <Button
          label={t('auth.signUp')}
          onPress={() => void onSubmit()}
          busy={busy}
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
