import { useState } from 'react';
import { Stack } from 'expo-router';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useBack } from '../src/navigation/back';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import { supabase } from '../src/lib/supabase';
import { signIn } from '../src/features/auth/api';
import { changePassword } from '../src/features/profile/api';
import { mapErrorToKey } from '../src/features/booking/errors';
import {
  classifySignInFailure,
  classifyUpdateFailure,
} from '../src/features/profile/changePasswordFlow';
import { captureException } from '../src/lib/telemetry';
import { Button, ErrorText, Field, FormScreen, Screen } from '../src/components/ui';
import { useToast } from '../src/components/overlays';

/**
 * Change password (design 2026-08-31). The current password is verified by
 * re-authenticating before the update — supabase.auth.updateUser alone would
 * let anyone holding an unlocked phone rotate the password unchallenged.
 */
function ChangePasswordScreen() {
  const { t } = useLocale();
  const back = useBack();
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
    // The server refuses an unchanged password too (same_password); saying so
    // here saves the round trip and the vaguer message.
    if (next === current) return setNextError(t('profile.newPasswordSame'));
    const email = session?.user.email;
    if (!email) return setError(t('auth.sessionExpired'));

    setBusy(true);
    try {
      // Proof-of-knowledge: the current password must still sign in. Every
      // failure here used to read "Email or password is incorrect" — on a
      // screen with no email field, and for failures that were not the
      // password at all (changePasswordFlow.ts). Now each is named.
      try {
        await signIn(supabase, email, current);
      } catch (err) {
        switch (classifySignInFailure(err)) {
          case 'wrong-password':
            return setCurrentError(t('profile.currentPasswordWrong'));
          case 'email-not-confirmed':
            return setError(t('auth.verifyEmailSent', { email }));
          default:
            captureException(err, { label: 'changePassword.proof' });
            return setError(t(mapErrorToKey(err)));
        }
      }
      try {
        await changePassword(supabase, next);
      } catch (err) {
        switch (classifyUpdateFailure(err)) {
          case 'same-password':
            return setNextError(t('profile.newPasswordSame'));
          case 'weak-password':
            return setNextError(t('auth.passwordTooShort'));
          case 'reauthentication':
            // The project's "secure password change" setting wants an emailed
            // nonce this screen does not collect; the reset-link flow is the
            // path that works regardless.
            captureException(err, { label: 'changePassword.reauth' });
            return setError(t('profile.passwordChangeUnavailable'));
          default:
            captureException(err, { label: 'changePassword.update' });
            return setError(t(mapErrorToKey(err)));
        }
      }
      toast(t('auth.passwordUpdated'));
      back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('profile.changePassword') }} />
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

/**
 * This screen lives on the ROOT stack rather than in the `(gated)` group, so
 * that a push from the Profile tab leaves real history beneath it and UIKit
 * draws its own (animated) back item. The group's layout guard does not apply
 * here, so the session requirement is declared explicitly — same three states,
 * same redirect.
 */
export default function GuardedChangePasswordScreen() {
  return (
    <RequireSession>
      <ChangePasswordScreen />
    </RequireSession>
  );
}
