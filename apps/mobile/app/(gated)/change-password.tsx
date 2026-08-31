import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { supabase } from '../../src/lib/supabase';
import { signIn } from '../../src/features/auth/api';
import { changePassword } from '../../src/features/profile/api';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { space } from '../../src/theme';
import { Button, ErrorText, Field, Screen, ScreenHeader } from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';

/**
 * Change password (design 2026-08-31). The current password is verified by
 * re-authenticating before the update — supabase.auth.updateUser alone would
 * let anyone holding an unlocked phone rotate the password unchallenged.
 */
export default function ChangePasswordScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (!current || !next || !confirm) return setError(t('profile.fillAllFields'));
    if (next.length < 8) return setError(t('auth.passwordTooShort'));
    if (next !== confirm) return setError(t('auth.passwordMismatch'));
    const email = session?.user.email;
    if (!email) return setError(t('auth.sessionExpired'));

    setBusy(true);
    try {
      // Proof-of-knowledge: the current password must still sign in.
      try {
        await signIn(supabase, email, current);
      } catch {
        setBusy(false);
        return setError(t('auth.invalidCredentials'));
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
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader title={t('profile.changePassword')} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Field
          placeholder={t('profile.currentPassword')}
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
        />
        <Field
          placeholder={t('profile.newPasswordMin')}
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoComplete="new-password"
        />
        <Field
          placeholder={t('profile.confirmNewPassword')}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
        />
        <ErrorText>{error}</ErrorText>
        <Button
          label={t('profile.updatePassword')}
          variant="cta"
          busy={busy}
          onPress={() => void onSubmit()}
          style={{ marginTop: space.l }}
        />
      </ScrollView>
    </Screen>
  );
}
