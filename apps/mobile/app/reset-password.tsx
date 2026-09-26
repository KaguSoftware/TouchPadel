import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../src/i18n/text';
import { useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { updatePassword } from '../src/features/auth/api';
import { useAuth } from '../src/features/auth/context';
import { clearRecoverySession, useRecoverySession } from '../src/features/auth/recovery';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Hint, Loading, Screen, Title } from '../src/components/ui';

/** How long we give a recovery link's session exchange before calling the link dead. */
const LINK_GRACE_MS = 4000;

/**
 * Sets a new password on a RECOVERY session: reached from app/verify-otp.tsx
 * (mode reset) once the phone code has signed the guest in, or from the
 * touchpadel://reset-password email link once useAuthDeepLink has exchanged
 * its code. Ungated so a signed-in redirect cannot bounce us away.
 *
 * The form renders ONLY while features/auth/recovery.ts says a recovery
 * session was established in this app session (S6, 2026-09-20). Before that,
 * `updateUser({ password })` ran against whatever session was signed in, so
 * anyone holding an unlocked phone could rotate the guest's password by
 * opening a stale link or navigating here. Now:
 *
 *   waiting   no marker yet, grace running: the link is still being exchanged
 *   ready     marker set and a session exists: the form
 *   expired   grace over, no marker: "open the email link again"
 *   done      password set; the marker is cleared so a back-swipe cannot
 *             bring the form back on the same session
 *
 * States per spec 05.8: ready · busy · invalidLink · error · success.
 */
export default function ResetPasswordScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const recovery = useRecoverySession();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
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
  // The marker wins over the grace: a slow exchange that lands after 4 s still
  // gets its form rather than a "link expired" it has to back out of.
  const ready = recovery && session !== null;
  const invalidLink = !ready && graceOver;

  const onSubmit = async () => {
    setError(null);
    setPasswordError(null);
    setConfirmError(null);
    if (password.length < 8) return setPasswordError(t('auth.passwordTooShort'));
    if (password !== confirm) return setConfirmError(t('auth.passwordMismatch'));
    setBusy(true);
    try {
      await updatePassword(supabase, password);
      // Spent: the same recovery session must not set a second password later.
      clearRecoverySession();
      setDone(true);
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <FormScreen>
        <Title plain size={24}>
          {t('auth.resetPasswordTitle')}
        </Title>
        {done ? (
          <>
            <Hint>{t('auth.passwordUpdated')}</Hint>
            <Button
              testID="reset-password.done"
              label={t('common.ok')}
              variant="primary"
              // A slot tapped before signing in is still held for them.
              onPress={continueAfterAuth}
              busy={holdBusy}
              style={{ marginTop: space.l }}
            />
          </>
        ) : ready ? (
          <>
            <Field
              testID="reset-password.password"
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
              testID="reset-password.confirm-password"
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
              testID="reset-password.save"
              label={t('common.save')}
              variant="primary"
              onPress={() => void onSubmit()}
              busy={busy}
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
              testID="reset-password.request-new-link"
              label={t('auth.requestNewLink')}
              variant="primary"
              onPress={() => router.replace('/forgot-password')}
              style={{ marginTop: space.sm }}
            />
          </>
        ) : (
          // The exchange is in flight: nothing to type into yet.
          <Loading />
        )}
      </FormScreen>
    </Screen>
  );
}
