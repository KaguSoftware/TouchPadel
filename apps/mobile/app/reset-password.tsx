import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { updatePassword } from '../src/features/auth/api';
import { useAuth } from '../src/features/auth/context';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import {
  Button,
  ErrorText,
  Field,
  FormScreen,
  Hint,
  Screen,
  ScreenHeader,
  Title,
} from '../src/components/ui';

/** How long we give the recovery link's session exchange before calling the link dead. */
const LINK_GRACE_MS = 4000;

/**
 * Reached via the touchpadel://reset-password deep link from the recovery
 * email (which signs the user into a recovery session). Lives OUTSIDE the
 * (auth) group so its signed-in redirect cannot bounce us away.
 *
 * States (spec 05.8): ready · busy · invalidLink · error · success. The form
 * used to render unconditionally; with no recovery session the update failed
 * with a generic message and the guest never learned the LINK was the problem.
 */
export default function ResetPasswordScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const { session, initializing } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graceOver, setGraceOver] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setGraceOver(true), LINK_GRACE_MS);
    return () => clearTimeout(id);
  }, []);
  const invalidLink = !initializing && !session && graceOver;

  const onSubmit = async () => {
    setError(null);
    setPasswordError(null);
    setConfirmError(null);
    if (password.length < 8) return setPasswordError(t('auth.passwordTooShort'));
    if (password !== confirm) return setConfirmError(t('auth.passwordMismatch'));
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
    <Screen gutter={20}>
      <ScreenHeader />
      <FormScreen>
        <Title plain size={24}>
          {t('auth.resetPasswordTitle')}
        </Title>
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
        ) : invalidLink ? (
          <>
            <View
              style={{
                marginTop: space.m,
                backgroundColor: colors.redtint,
                borderWidth: 1,
                borderColor: colors.redline,
                borderRadius: radius.button,
                padding: space.m,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  color: colors.redtext,
                }}
              >
                {t('auth.invalidResetLinkTitle')}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12.5,
                  lineHeight: 19,
                  color: colors.redtext2,
                  marginTop: 4,
                }}
              >
                {t('auth.invalidResetLinkBody')}
              </Text>
            </View>
            <Button
              label={t('auth.requestNewLink')}
              variant="primary"
              onPress={() => router.replace('/(auth)/forgot-password')}
              style={{ marginTop: space.sm }}
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
              textContentType="newPassword"
              error={passwordError}
              style={{ marginTop: 6 }}
            />
            <Field
              placeholder={t('auth.confirmPasswordLabel')}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              error={confirmError}
            />
            <ErrorText>{error}</ErrorText>
            <Button
              label={t('common.save')}
              variant="primary"
              onPress={() => void onSubmit()}
              busy={busy || (initializing && !session)}
              style={{ marginTop: space.l }}
            />
          </>
        )}
      </FormScreen>
    </Screen>
  );
}
