import { useEffect, useRef, useState } from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { displayPhone } from '../src/features/profile/phone';
import { isolate } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import {
  resendPhoneLink,
  resendSignUpCode,
  sendPasswordResetCode,
  verifyPhoneLink,
  verifyPhoneOtp,
} from '../src/features/auth/api';
import {
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
  mapOtpError,
  phoneOtpEnabled,
  sanitizeOtpInput,
} from '../src/features/auth/phoneOtp';
import { useAuth } from '../src/features/auth/context';
import { markRecoverySession } from '../src/features/auth/recovery';
import { RequireSession } from '../src/features/auth/RequireSession';
import { updateOwnProfile } from '../src/features/profile/api';
import { profileKeys } from '../src/features/profile/hooks';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useBack } from '../src/navigation/back';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, FormScreen, Hint, LinkText, Screen, Title } from '../src/components/ui';
import { CodeInput } from '../src/components/CodeInput';
import { useToast } from '../src/components/overlays';

type Mode = 'signup' | 'reset' | 'link';

/**
 * Code entry. Reached with the E.164 number and the mode; a code was JUST
 * sent, so the resend cooldown starts on mount (same 30 s pattern as
 * verify-email).
 *
 *   signup  verifyOtp(type 'sms') confirms the number of a phone + password
 *           sign-up (app/sign-up.tsx, or sign-in finding it unconfirmed) and
 *           returns the session -> the same post-auth continuation every other
 *           path uses. The name and language came with the sign-up, so there
 *           is no complete-profile step. This is the ONLY code a guest spends
 *           to get in; later sign-ins are phone + password.
 *   reset   verifyOtp(type 'sms') on a recovery code (app/forgot-password.tsx)
 *           signs the guest in, then app/reset-password.tsx sets the new
 *           password on that session.
 *   link    verifyOtp(type 'phone_change') on a signed-in account, then the
 *           verified number is written to profiles.phone too — it is the one
 *           the desk should be calling. Reached from Profile ("Verify phone
 *           number") and, with `from=edit`, from Edit profile's Save when the
 *           guest CHANGED their number — that save is not committed until the
 *           code lands here, so this write is what completes it.
 *
 * signup / reset carry no RequireNoSession on purpose: the session lands
 * mid-screen and the redirect would race the continuation (the verify-email
 * precedent).
 *
 * iOS fills the field from Messages (textContentType oneTimeCode); Android
 * needs the SMS Retriever hash in the message body for auto-read, which would
 * push the template past one segment — manual entry / paste there.
 */
function VerifyOtpForm({ mode, phone, from }: { mode: Mode; phone: string; from?: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const back = useBack();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState(() => Date.now() + RESEND_COOLDOWN_S * 1000);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_S);
  const submitted = useRef(false);

  // Tick only while a cooldown is running (verify-email's pattern).
  useEffect(() => {
    if (cooldownEnd === 0) return;
    const update = () => {
      const left = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) setCooldownEnd(0);
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [cooldownEnd]);

  const onSubmit = async (value = code) => {
    if (value.length !== OTP_LENGTH || busy || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'link') {
        const { user } = await verifyPhoneLink(supabase, phone, value);
        if (user) {
          // profiles.phone is a profile field the desk dials (spec 05.3); the
          // number that just proved itself is the right value for it.
          await updateOwnProfile(supabase, user.id, { phone });
          void queryClient.invalidateQueries({ queryKey: profileKeys.own });
        }
        toast(t(from === 'edit' ? 'profile.phoneUpdated' : 'auth.phoneVerified'), 'info');
        // From Edit profile the guest came THROUGH that form, so land back on
        // the Profile tab rather than leaving the half-finished editor on the
        // stack for a back-swipe to return to.
        router.replace('/(tabs)/profile');
        return;
      }
      await verifyPhoneOtp(supabase, phone, value);
      // The profile row was written at sign-up; drop any signed-out cache of it.
      void queryClient.invalidateQueries({ queryKey: profileKeys.own });
      if (mode === 'reset') {
        // The code just proved the guest holds the account's number: this is
        // what lets reset-password render its form (S6). Marked before the
        // navigation so the screen never mounts in its "link expired" state.
        markRecoverySession();
        router.replace('/reset-password');
        return;
      }
      toast(t('auth.welcomeToApp'), 'info');
      continueAfterAuth();
    } catch (err) {
      submitted.current = false;
      setCode('');
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'link') await resendPhoneLink(supabase, phone);
      else if (mode === 'reset') await sendPasswordResetCode(supabase, phone);
      else await resendSignUpCode(supabase, phone);
      setNotice(t('auth.codeSentAgain'));
      setCooldownEnd(Date.now() + RESEND_COOLDOWN_S * 1000);
      setSecondsLeft(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  const coolingDown = secondsLeft > 0;

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.otpTitle') }} />
      <FormScreen>
        <Title plain>{t('auth.otpTitle')}</Title>
        <Hint style={{ marginTop: 8 }}>{t('auth.otpBody', { phone: isolate(displayPhone(phone)) })}</Hint>
        <CodeInput
          testID="verify-otp.code"
          label={t('auth.otpLabel')}
          value={code}
          onChangeText={(v) => {
            const next = sanitizeOtpInput(v);
            setCode(next);
            // A wrong code leaves its message on screen; the moment the guest
            // starts correcting it, the red boxes go back to neutral.
            if (error) setError(null);
            if (next.length === OTP_LENGTH) void onSubmit(next);
          }}
          length={OTP_LENGTH}
          error={!!error}
          autoFocus
          onSubmitEditing={() => void onSubmit()}
        />
        {notice ? <Hint>{notice}</Hint> : null}
        <ErrorText>{error}</ErrorText>
        <Button
          testID="verify-otp.continue"
          label={t('auth.continueCta')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={code.length !== OTP_LENGTH}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <Button
          testID="verify-otp.resend"
          label={coolingDown ? t('auth.resendCodeIn', { seconds: secondsLeft }) : t('auth.resendCode')}
          onPress={() => void onResend()}
          disabled={busy || coolingDown}
          variant="secondary"
          size="medium"
          labelColor={coolingDown ? colors.fnt2 : colors.blue}
          style={{ marginTop: 12 }}
        />
        <LinkText
          testID="verify-otp.change-number"
          label={t('auth.changeNumber')}
          onPress={back}
          style={{ marginTop: 14, paddingStart: 4 }}
        />
      </FormScreen>
    </Screen>
  );
}

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ phone?: string; mode?: string; from?: string }>();
  const { session, initializing } = useAuth();
  const mode: Mode = params.mode === 'link' ? 'link' : params.mode === 'reset' ? 'reset' : 'signup';
  const phone = typeof params.phone === 'string' ? params.phone : '';
  if (mode === 'link') {
    if (!phoneOtpEnabled() || !phone) return <Redirect href="/(tabs)" />;
    return (
      <RequireSession>
        <VerifyOtpForm mode="link" phone={phone} from={params.from} />
      </RequireSession>
    );
  }
  if (!phone) return <Redirect href={!initializing && session ? '/(tabs)' : '/sign-in'} />;
  // Deliberately ungated otherwise (see the header): the session lands here.
  return <VerifyOtpForm mode={mode} phone={phone} />;
}
