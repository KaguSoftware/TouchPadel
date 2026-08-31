import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Locale } from '@touch/i18n';
import { supabase } from '../../src/lib/supabase';
import { signUp, validateSignUp } from '../../src/features/auth/api';
import { verifyRedirect } from '../../src/features/auth/redirects';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space, useTheme } from '../../src/theme';
import {
  Button,
  ErrorText,
  Field,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Title,
} from '../../src/components/ui';

export default function SignUpScreen() {
  const { t, setLocale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [preferredLang, setPreferredLang] = useState<Locale>('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    const invalid = validateSignUp({ fullName, email, password, confirmPassword });
    if (invalid === 'PASSWORD_MISMATCH') return setError(t('auth.passwordMismatch'));
    if (invalid === 'PASSWORD_TOO_SHORT') return setError(t('auth.passwordTooShort'));
    if (invalid) return setError(t('errors.validation'));
    // Phone is required from day one (spec 05.3 — profile field, not identity).
    if (!phone.trim()) return setError(t('errors.validation'));
    setBusy(true);
    try {
      await signUp(supabase, { fullName, email, phone, password, preferredLang }, verifyRedirect());
      // The chosen language becomes the app language right away.
      await setLocale(preferredLang);
      router.replace({ pathname: '/(auth)/verify-email', params: { email } });
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Title squiggle={false}>{t('auth.signUp')}</Title>
        <Field
          placeholder={t('auth.fullNameLabel')}
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />
        <Field
          placeholder={t('auth.emailLabel')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          placeholder={t('auth.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
        />
        <Field
          placeholder={t('auth.confirmPasswordLabel')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
        />
        <Field
          placeholder={t('auth.phoneLabel')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        <View style={{ marginTop: space.sm }}>
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 11,
              letterSpacing: 0.66,
              textTransform: 'uppercase',
              color: colors.mut,
              marginBottom: 5,
            }}
          >
            {t('auth.preferredLanguage')}
          </Text>
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
        <Text
          style={{
            textAlign: 'center',
            fontFamily: fonts.body400,
            fontSize: 12.5,
            color: colors.mut,
            marginTop: space.l,
          }}
        >
          <Text
            onPress={() => router.back()}
            style={{ fontFamily: fonts.body800, color: colors.blue }}
          >
            {t('auth.haveAccount')}
          </Text>
        </Text>
      </ScrollView>
    </Screen>
  );
}
