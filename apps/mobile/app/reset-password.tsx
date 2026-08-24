import { useState } from 'react';
import { useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { updatePassword } from '../src/features/auth/api';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { Button, ErrorText, Field, Hint, Screen, Title } from '../src/components/ui';

/**
 * Reached via the touchpadel://reset-password deep link from the recovery
 * email (which signs the user into a recovery session). Lives OUTSIDE the
 * (auth) group so the its signed-in redirect cannot bounce us away.
 */
export default function ResetPasswordScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (password.length < 8) return setError(t('auth.passwordTooShort'));
    if (password !== confirm) return setError(t('auth.passwordMismatch'));
    setBusy(true);
    try {
      await updatePassword(supabase, password);
      setDone(true);
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('auth.resetPasswordTitle')}</Title>
      {done ? (
        <>
          <Hint>{t('auth.passwordUpdated')}</Hint>
          <Button label={t('common.ok')} onPress={() => router.replace('/(app)')} />
        </>
      ) : (
        <>
          <Field
            label={t('auth.newPasswordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Field
            label={t('auth.confirmPasswordLabel')}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
          />
          <ErrorText>{error}</ErrorText>
          <Button label={t('common.save')} onPress={() => void onSubmit()} busy={busy} />
        </>
      )}
    </Screen>
  );
}
