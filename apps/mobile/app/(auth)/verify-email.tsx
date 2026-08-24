import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { resendVerification } from '../../src/features/auth/api';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { Button, ErrorText, Hint, LinkText, Screen, Title } from '../../src/components/ui';

/** Pending-verification screen: shown after sign-up until the email link is clicked. */
export default function VerifyEmailScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onResend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resendVerification(supabase, email);
      setNotice(t('auth.resendEmailDone'));
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('auth.verifyEmailTitle')}</Title>
      <Hint>{t('auth.verifyEmailSent', { email })}</Hint>
      {notice ? <Hint>{notice}</Hint> : null}
      <ErrorText>{error}</ErrorText>
      <Button label={t('auth.resendEmail')} onPress={() => void onResend()} busy={busy} disabled={!email} />
      <LinkText label={t('auth.backToSignIn')} onPress={() => router.replace('/(auth)/sign-in')} />
    </Screen>
  );
}
