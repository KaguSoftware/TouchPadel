import { useRef, useState } from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { displayPhone } from '../src/features/profile/phone';
import { isolate } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import {
  resendPhoneLink,
  resendSignUpCode,
  sendPasswordResetCode,
  sendSignInCode,
  verifyPhoneLink,
  verifyPhoneOtp,
} from '../src/features/auth/api';
import {
  OTP_LENGTH,
  mapOtpError,
  parseLinkReturnTo,
  phoneOtpEnabled,
  sanitizeOtpInput,
  type LinkReturnTo,
} from '../src/features/auth/phoneOtp';
import { phoneTakenKey } from '../src/features/loyalty/errors';
import { useAuth } from '../src/features/auth/context';
import { markRecoverySession } from '../src/features/auth/recovery';
import { RequireSession } from '../src/features/auth/RequireSession';
import { updateOwnProfile } from '../src/features/profile/api';
import { profileKeys } from '../src/features/profile/hooks';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { useFinishSignIn } from '../src/features/auth/useFinishSignIn';
import { useResendCooldown } from '../src/features/auth/useResendCooldown';
import { clearPendingIntents } from '../src/features/booking/pendingIntent';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useBack, useBackGuard, useReturnTo } from '../src/navigation/back';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, FormScreen, Hint, LinkText, Screen, Title } from '../src/components/ui';
import { CodeInput } from '../src/components/CodeInput';
import { useToast } from '../src/components/overlays';

type Mode = 'signup' | 'signin' | 'reset' | 'link';

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
 *           to confirm the number.
 *   signin  verifyOtp(type 'sms') on a sign-in code (app/sign-in.tsx, the
 *           phone segment: code-only since 2026-10-11, owner) and lands the
 *           way the email sign-in does (useFinishSignIn): staff to Today, an
 *           incomplete profile to complete-profile, else the continuation.
 *   reset   verifyOtp(type 'sms') on a recovery code (app/forgot-password.tsx)
 *           signs the guest in, then app/reset-password.tsx sets the new
 *           password on that session.
 *   link    verifyOtp(type 'phone_change') on a signed-in account, then the
 *           verified number is written to profiles.phone too — it is the one
 *           the desk should be calling. Reached from Profile ("Verify phone
 *           number") and, with `from=edit`, from Edit profile's Save when the
 *           guest CHANGED their number — that save is not committed until the
 *           code lands here, so this write is what completes it.
 *           With `returnTo` it serves a booking (owner, 2026-09-27: no
 *           reservation without a verified phone; app/phone-sign-in.tsx):
 *           `continue` holds the pending slot (or opens the pending open
 *           match's screen) through the post-auth continuation, `back` pops
 *           to Review or the match screen. phone-sign-in REPLACED itself
 *           with this screen there, so "Use a different number" swaps it back.
 *
 * signup / signin / reset carry no RequireNoSession on purpose: the session lands
 * mid-screen and the redirect would race the continuation (the verify-email
 * precedent).
 *
 * iOS fills the field from Messages (textContentType oneTimeCode); Android
 * needs the SMS Retriever hash in the message body for auto-read, which would
 * push the template past one segment — manual entry / paste there.
 */
function VerifyOtpForm({
  mode,
  phone,
  from,
  returnTo = null,
}: {
  mode: Mode;
  phone: string;
  from?: string;
  returnTo?: LinkReturnTo;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const returnToTab = useReturnTo();
  const back = useBack();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { continueAfterAuth, holdBusy } = usePostAuthContinue();
  const finishSignIn = useFinishSignIn(continueAfterAuth);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { secondsLeft, coolingDown, restart: restartCooldown } = useResendCooldown();
  const submitted = useRef(false);

  // A booking's pending slot, or an open match's pending intent, rides on this
  // screen (continue mode): leaving without a code drops it. The two ways
  // forward lift the guard themselves.
  const leave = useBackGuard({
    when: returnTo === 'continue',
    onBlocked: (go) => {
      clearPendingIntents();
      go();
    },
    onDismissed: clearPendingIntents,
  });
  const changeNumber = () => {
    if (!returnTo) return back();
    leave(() => router.replace({ pathname: '/phone-sign-in', params: { returnTo, phone } }));
  };

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
        if (returnTo === 'continue') {
          // The continuation re-reads the account, finds the number verified,
          // and holds the slot (or explains that it went), or opens the
          // pending open match's screen.
          leave(continueAfterAuth);
          return;
        }
        if (returnTo === 'back') {
          back();
          return;
        }
        // From Edit profile the guest came THROUGH that form, so land back on
        // the account page rather than leaving the half-finished editor on the
        // stack for a back-swipe to return to.
        returnToTab('/profile', 'profile');
        return;
      }
      const { user } = await verifyPhoneOtp(supabase, phone, value);
      if (mode === 'signin') {
        // Reads the profile fresh (staleTime 0), so no invalidation first.
        await finishSignIn(user);
        return;
      }
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
      // Link mode writes profiles.phone after the code: PHONE_TAKEN (loyalty L-3) means another
      // live account holds the number, and reads the catalogue's line, not a code failure.
      setError(t(phoneTakenKey(err) ?? mapOtpError(err)));
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
      else if (mode === 'signin') await sendSignInCode(supabase, phone);
      else await resendSignUpCode(supabase, phone);
      setNotice(t('auth.codeSentAgain'));
      restartCooldown();
    } catch (err) {
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

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
          onPress={changeNumber}
          style={{ marginTop: 14, paddingStart: 4 }}
        />
      </FormScreen>
    </Screen>
  );
}

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ phone?: string; mode?: string; from?: string; returnTo?: string }>();
  const { session, initializing } = useAuth();
  const mode: Mode =
    params.mode === 'link' || params.mode === 'reset' || params.mode === 'signin' ? params.mode : 'signup';
  const phone = typeof params.phone === 'string' ? params.phone : '';
  if (mode === 'link') {
    // The booking modes work whatever the flag says (app/phone-sign-in.tsx).
    const returnTo = parseLinkReturnTo(params.returnTo);
    if ((!returnTo && !phoneOtpEnabled()) || !phone) return <Redirect href="/(tabs)" />;
    return (
      <RequireSession>
        <VerifyOtpForm mode="link" phone={phone} from={params.from} returnTo={returnTo} />
      </RequireSession>
    );
  }
  if (!phone) return <Redirect href={!initializing && session ? '/(tabs)' : '/sign-in'} />;
  // Deliberately ungated otherwise (see the header): the session lands here.
  return <VerifyOtpForm mode={mode} phone={phone} />;
}
