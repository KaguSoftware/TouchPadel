import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { supabase } from '../../src/lib/supabase';
import { signIn } from '../../src/features/auth/api';
import { changePassword } from '../../src/features/profile/api';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { Button, ErrorText, Field, FormScreen, Screen, ScreenHeader } from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';

/**
 * Change password (design 2026-08-31). The current password is verified by
 * re-authenticating before the update — supabase.auth.updateUser alone would
 * let anyone holding an unlocked phone rotate the password unchallenged.
 */
export default function ChangePasswordScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const { session } = useAuth();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setCurrentError(null);
    setNextError(null);
    setConfirmError(null);
    if (!current || !next || !confirm) return setError(t('profile.fillAllFields'));
    if (next.length < 8) return setNextError(t('auth.passwordTooShort'));
    if (next !== confirm) return setConfirmError(t('auth.passwordMismatch'));
    const email = session?.user.email;
    if (!email) return setError(t('auth.sessionExpired'));

    setBusy(true);
    try {
      // Proof-of-knowledge: the current password must still sign in.
      try {
        await signIn(supabase, email, current);
      } catch {
        setBusy(false);
        return setCurrentError(t('auth.invalidCredentials'));
      }
      await changePassword(supabase, next);
      toast(t('auth.passwordUpdated'));
      router.back();
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title={t('profile.changePassword')} />
      <FormScreen contentStyle={{ paddingTop: 4 }}>
        <Field
          placeholder={t('profile.currentPassword')}
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          dense
          error={currentError}
        />
        <Field
          placeholder={t('profile.newPasswordMin')}
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          dense
          error={nextError}
        />
        <Field
          placeholder={t('profile.confirmNewPassword')}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          dense
          error={confirmError}
        />
        <ErrorText>{error}</ErrorText>
        <Button
          label={t('profile.updatePassword')}
          variant="cta"
          busy={busy}
          onPress={() => void onSubmit()}
          style={{ marginTop: 6 }}
        />
      </FormScreen>
    </Screen>
  );
}
