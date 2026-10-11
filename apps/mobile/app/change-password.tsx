import { useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { isolate } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useBack } from '../src/navigation/back';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import { supabase } from '../src/lib/supabase';
import { sendSignInCode, signIn, signInWithPhone, verifyPhoneOtp } from '../src/features/auth/api';
import { OTP_LENGTH, mapOtpError, sanitizeOtpInput } from '../src/features/auth/phoneOtp';
import { useResendCooldown } from '../src/features/auth/useResendCooldown';
import { displayPhone } from '../src/features/profile/phone';
import { changePassword } from '../src/features/profile/api';
import { mapErrorToKey } from '../src/features/booking/errors';
import {
  classifySignInFailure,
  classifyUpdateFailure,
  passwordProofOf,
  type PasswordProof,
} from '../src/features/profile/changePasswordFlow';
import { captureException } from '../src/lib/telemetry';
import { useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Hint, LinkText, Screen } from '../src/components/ui';
import { CodeInput } from '../src/components/CodeInput';
import { useToast } from '../src/components/overlays';

/**
 * Change password (design 2026-08-31). The current password is verified by
 * re-authenticating before the update — supabase.auth.updateUser alone would
 * let anyone holding an unlocked phone rotate the password unchallenged.
 *
 * A phone account then proves the number too (owner, 2026-10-11): a code goes
 * to the account's phone and the update waits for it. The code is checked by
 * the server (verifyOtp signs the same account in again), not by this screen.
 * GoTrue's reauthenticate() nonce was not used: updateUser checks it only on
 * a session older than 24 hours, and the password proof above has just made a
 * new one, so a wrong code would have gone through. An email-only account
 * (staff, guests from before 2026-09-15) keeps the password proof alone: its
 * code would be a mail template the hosted project does not carry.
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
  // Set once the current password proved itself on a phone account and a code
  // went out: the screen asks for it and the update waits on it.
  const [codeFor, setCodeFor] = useState<Extract<PasswordProof, { kind: 'phone' }> | null>(null);

  const updateTo = async (password: string) => {
    try {
      await changePassword(supabase, password);
    } catch (err) {
      switch (classifyUpdateFailure(err)) {
        case 'same-password':
          setCodeFor(null);
          return setNextError(t('profile.newPasswordSame'));
        case 'weak-password':
          setCodeFor(null);
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
  };

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
    // Phone accounts prove it by number, older email accounts by email.
    const proof = passwordProofOf(session?.user);
    if (!proof) return setError(t('auth.sessionExpired'));

    setBusy(true);
    try {
      // Proof-of-knowledge: the current password must still sign in. Every
      // failure here used to read "Email or password is incorrect" — on a
      // screen with no email field, and for failures that were not the
      // password at all (changePasswordFlow.ts). Now each is named.
      try {
        if (proof.kind === 'phone') await signInWithPhone(supabase, proof.phone, current);
        else await signIn(supabase, proof.email, current);
      } catch (err) {
        switch (classifySignInFailure(err)) {
          case 'wrong-password':
            return setCurrentError(t('profile.currentPasswordWrong'));
          case 'email-not-confirmed':
            return setError(t('auth.verifyEmailSent', { email: proof.kind === 'email' ? proof.email : '' }));
          default:
            captureException(err, { label: 'changePassword.proof' });
            return setError(t(mapErrorToKey(err)));
        }
      }
      if (proof.kind === 'phone') {
        try {
          await sendSignInCode(supabase, proof.phone);
        } catch (err) {
          return setError(t(mapOtpError(err)));
        }
        setCodeFor(proof);
        return;
      }
      await updateTo(next);
    } finally {
      setBusy(false);
    }
  };

  if (codeFor) {
    return (
      <PasswordCodeStep
        phone={codeFor.phone}
        onVerified={() => updateTo(next)}
        onCancel={() => setCodeFor(null)}
        outerError={error}
      />
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('profile.changePassword') }} />
      <FormScreen contentStyle={{ paddingTop: 4 }}>
        <Field
          testID="change-password.current-password"
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
          testID="change-password.new-password"
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
          testID="change-password.confirm-password"
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
          testID="change-password.submit"
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
 * The second proof on a phone account: the code sent to its number. The
 * passwords stay in the parent, so a wrong code or a resend never asks for
 * them again; "Use a different number" is not offered (the number is the
 * account's), the back link returns to the form instead.
 */
function PasswordCodeStep({
  phone,
  onVerified,
  onCancel,
  outerError,
}: {
  phone: string;
  onVerified: () => Promise<void>;
  onCancel: () => void;
  outerError: string | null;
}) {
  const { t } = useLocale();
  const { colors } = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { secondsLeft, coolingDown, restart } = useResendCooldown();
  const submitted = useRef(false);

  const onSubmit = async (value = code) => {
    if (value.length !== OTP_LENGTH || busy || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      try {
        await verifyPhoneOtp(supabase, phone, value);
      } catch (err) {
        submitted.current = false;
        setCode('');
        return setError(t(mapOtpError(err)));
      }
      await onVerified();
      // A refusal the parent shows here (the update failed for a reason a
      // new code will not fix) leaves the guest free to try again.
      submitted.current = false;
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendSignInCode(supabase, phone);
      setNotice(t('auth.codeSentAgain'));
      restart();
    } catch (err) {
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('profile.changePassword') }} />
      <FormScreen contentStyle={{ paddingTop: 4 }}>
        <Hint>{t('auth.otpBody', { phone: isolate(displayPhone(phone)) })}</Hint>
        <CodeInput
          testID="change-password.code"
          label={t('auth.otpLabel')}
          value={code}
          onChangeText={(v) => {
            const nextCode = sanitizeOtpInput(v);
            setCode(nextCode);
            if (error) setError(null);
            if (nextCode.length === OTP_LENGTH) void onSubmit(nextCode);
          }}
          length={OTP_LENGTH}
          error={!!error}
          autoFocus
          onSubmitEditing={() => void onSubmit()}
        />
        {notice ? <Hint>{notice}</Hint> : null}
        <ErrorText>{error ?? outerError}</ErrorText>
        <Button
          testID="change-password.verify"
          label={t('profile.updatePassword')}
          variant="cta"
          busy={busy}
          disabled={code.length !== OTP_LENGTH}
          onPress={() => void onSubmit()}
          style={{ marginTop: 6 }}
        />
        <Button
          testID="change-password.resend"
          label={coolingDown ? t('auth.resendCodeIn', { seconds: secondsLeft }) : t('auth.resendCode')}
          onPress={() => void onResend()}
          disabled={busy || coolingDown}
          variant="secondary"
          size="medium"
          labelColor={coolingDown ? colors.fnt2 : colors.blue}
          style={{ marginTop: 12 }}
        />
        <LinkText
          testID="change-password.edit"
          label={t('common.back')}
          onPress={onCancel}
          style={{ marginTop: 14, paddingStart: 4 }}
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
