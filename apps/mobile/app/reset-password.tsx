import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../src/lib/supabase';
import { updatePassword } from '../src/features/auth/api';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import { Button, ErrorText, Field, Hint, Screen, ScreenHeader, Title } from '../src/components/ui';

/**
 * Reached via the touchpadel://reset-password deep link from the recovery
 * email (which signs the user into a recovery session). Lives OUTSIDE the
 * (auth) group so its signed-in redirect cannot bounce us away.
 */
export default function ResetPasswordScreen() {
  const { t } = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    <Screen style={{ paddingTop: insets.top }}>
      <ScreenHeader />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Title squiggle={false}>{t('auth.resetPasswordTitle')}</Title>
        {done ? (
          <>
            <Hint>{t('auth.passwordUpdated')}</Hint>
            <Button
              label={t('common.ok')}
              variant="primary"
              onPress={() => router.replace('/(tabs)')}
              style={{ marginTop: space.l }}
            />
          </>
        ) : (
          <>
            <Field
              placeholder={t('auth.newPasswordLabel')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
            />
            <Field
              placeholder={t('auth.confirmPasswordLabel')}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
            />
            <ErrorText>{error}</ErrorText>
            <Button
              label={t('common.save')}
              variant="primary"
              onPress={() => void onSubmit()}
              busy={busy}
              style={{ marginTop: space.l }}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
