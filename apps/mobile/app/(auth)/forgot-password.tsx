import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { sendPasswordReset } from '../../src/features/auth/api';
import { resetRedirect } from '../../src/features/auth/redirects';
import { linkErrorParam } from '../../src/features/auth/deepLink';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { Button, ErrorText, Field, Hint, LinkText, Screen, Title } from '../../src/components/ui';

export default function ForgotPasswordScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where useAuthDeepLink sends a dead recovery link — a new one is one tap away.
  const linkError = linkErrorParam(useLocalSearchParams<{ authError?: string }>().authError);

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(supabase, email, resetRedirect());
      setSent(true);
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('auth.resetPasswordTitle')}</Title>
      {sent ? (
        <Hint>{t('auth.resetEmailSent', { email })}</Hint>
      ) : (
        <>
          <Field
            label={t('auth.emailLabel')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.placeholder')}
            keyboardType="email-address"
            autoComplete="email"
          />
          <ErrorText>{error ?? (linkError ? t(linkError) : null)}</ErrorText>
          <Button label={t('auth.sendResetLink')} onPress={() => void onSubmit()} busy={busy} />
        </>
      )}
      <LinkText label={t('auth.backToSignIn')} onPress={() => router.back()} />
    </Screen>
  );
}
