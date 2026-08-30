import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Locale } from '@touch/i18n';
import { supabase } from '../../src/lib/supabase';
import { signUp, validateSignUp } from '../../src/features/auth/api';
import { verifyRedirect } from '../../src/features/auth/redirects';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { theme } from '../../src/theme';
import { Button, ErrorText, Field, LinkText, Screen, Title } from '../../src/components/ui';

export default function SignUpScreen() {
  const { t, setLocale } = useLocale();
  const router = useRouter();
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

  const langChoice = (value: Locale, label: string) => (
    <Text
      onPress={() => setPreferredLang(value)}
      style={[styles.langOption, preferredLang === value && styles.langOptionActive]}
    >
      {label}
    </Text>
  );

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Title>{t('auth.signUp')}</Title>
        <Field label={t('auth.fullNameLabel')} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
        <Field
          label={t('auth.emailLabel')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.placeholder')}
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          label={t('auth.phoneLabel')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        <Field label={t('auth.passwordLabel')} value={password} onChangeText={setPassword} secureTextEntry />
        <Field
          label={t('auth.confirmPasswordLabel')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
        <Text style={styles.langLabel}>{t('auth.preferredLanguage')}</Text>
        <View style={styles.langRow}>
          {langChoice('en', t('settings.english'))}
          {langChoice('ar', t('settings.arabic'))}
        </View>
        <ErrorText>{error}</ErrorText>
        <Button label={t('auth.signUp')} onPress={() => void onSubmit()} busy={busy} />
        <LinkText label={t('auth.haveAccount')} onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  langLabel: { fontSize: 13, fontWeight: '600', color: theme.mutedFg, marginTop: 12 },
  langRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  langOption: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingStart: 14,
    paddingEnd: 14,
    paddingTop: 8,
    paddingBottom: 8,
    color: theme.fg,
    overflow: 'hidden',
  },
  langOptionActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
    color: theme.accentContrast,
  },
});
