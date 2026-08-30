import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { signIn } from '../../src/features/auth/api';
import { linkErrorParam } from '../../src/features/auth/deepLink';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { Button, ErrorText, Field, LinkText, Screen, Title } from '../../src/components/ui';

export default function SignInScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // useAuthDeepLink lands here when a verification link is dead, so the user is
  // told why instead of finding themselves back on sign-in for no visible reason.
  const linkError = linkErrorParam(useLocalSearchParams<{ authError?: string }>().authError);

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(supabase, email, password);
      router.replace('/(app)');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (/invalid login credentials/i.test(message)) {
        setError(t('auth.invalidCredentials'));
      } else if (/email not confirmed/i.test(message)) {
        router.push({ pathname: '/(auth)/verify-email', params: { email } });
      } else {
        setError(t(mapErrorToKey(err)));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Title>{t('auth.signIn')}</Title>
        <Field
          label={t('auth.emailLabel')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.placeholder')}
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          label={t('auth.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
        />
        <ErrorText>{error ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button label={t('auth.signIn')} onPress={() => void onSubmit()} busy={busy} />
        <LinkText
          label={t('auth.forgotPassword')}
          onPress={() => router.push('/(auth)/forgot-password')}
        />
        <LinkText label={t('auth.noAccount')} onPress={() => router.push('/(auth)/sign-up')} />
      </ScrollView>
    </Screen>
  );
}
