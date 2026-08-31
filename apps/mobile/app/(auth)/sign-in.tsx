import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { signIn } from '../../src/features/auth/api';
import { linkErrorParam } from '../../src/features/auth/deepLink';
import { usePostAuthContinue } from '../../src/features/booking/usePostAuthContinue';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space, useTheme } from '../../src/theme';
import { Button, ErrorText, Field, Screen, ScreenHeader, Title } from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';

export default function SignInScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
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
      toast(t('auth.welcomeBack'), 'info');
      // Pending slot -> hold + Review; otherwise the tabs.
      continueAfterAuth();
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
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Title squiggle={false}>{t('auth.signIn')}</Title>
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
          autoComplete="password"
        />
        <ErrorText>{error ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button
          label={t('auth.signIn')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <Button
          label={t('auth.forgotPassword')}
          onPress={() => router.push('/(auth)/forgot-password')}
          variant="ghost"
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
            onPress={() => router.push('/(auth)/sign-up')}
            style={{ fontFamily: fonts.body800, color: colors.blue }}
          >
            {t('auth.noAccount')}
          </Text>
        </Text>
      </ScrollView>
    </Screen>
  );
}
