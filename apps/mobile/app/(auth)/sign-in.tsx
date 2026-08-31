import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { signIn } from '../../src/features/auth/api';
import { linkErrorParam } from '../../src/features/auth/deepLink';
import { usePostAuthContinue } from '../../src/features/booking/usePostAuthContinue';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { space } from '../../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FooterLink,
  FormScreen,
  LinkText,
  Screen,
  ScreenHeader,
  Title,
} from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';

/**
 * Sign in (design 2026-08-31). Errors are distinguished (spec 05.4): invalid
 * credentials render on the password field, an unverified email forwards to
 * the verification screen, and a transport failure renders as such below.
 */
export default function SignInScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // useAuthDeepLink lands here when a verification link is dead, so the user is
  // told why instead of finding themselves back on sign-in for no visible reason.
  const linkError = linkErrorParam(useLocalSearchParams<{ authError?: string }>().authError);

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    setPasswordError(null);
    try {
      await signIn(supabase, email, password);
      toast(t('auth.welcomeBack'), 'info');
      // Pending slot -> hold + Review; otherwise the tabs.
      continueAfterAuth();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (/invalid login credentials/i.test(message)) {
        setPasswordError(t('auth.invalidCredentials'));
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
    <Screen gutter={20}>
      <ScreenHeader />
      <FormScreen>
        <Title plain>{t('auth.signIn')}</Title>
        <Field
          placeholder={t('auth.emailLabel')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          style={{ marginTop: 6 }}
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
        <ErrorText>{error ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button
          label={t('auth.signIn')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <LinkText
          label={t('auth.forgotPassword')}
          onPress={() => router.push('/(auth)/forgot-password')}
          style={{ marginTop: 12, paddingStart: 4 }}
        />
        <FooterLink
          lead={t('auth.newHereLead')}
          label={t('auth.createAccountLink')}
          onPress={() => router.push('/(auth)/sign-up')}
          style={{ marginTop: 18 }}
        />
      </FormScreen>
    </Screen>
  );
}
