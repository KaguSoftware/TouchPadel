import { useEffect, useRef, useState } from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatIraqiNational } from '@touch/core';
import { isolate } from '@touch/i18n';
import { supabase } from '../src/lib/supabase';
import { resendPhoneLink, sendPhoneOtp, verifyPhoneLink, verifyPhoneOtp } from '../src/features/auth/api';
import {
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
  mapOtpError,
  phoneOtpEnabled,
  sanitizeOtpInput,
} from '../src/features/auth/phoneOtp';
import { needsProfileCompletion } from '../src/features/auth/social';
import { useAuth } from '../src/features/auth/context';
import { RequireSession } from '../src/features/auth/RequireSession';
import { fetchOwnProfile, updateOwnProfile } from '../src/features/profile/api';
import { profileKeys } from '../src/features/profile/hooks';
import { usePostAuthContinue } from '../src/features/booking/usePostAuthContinue';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Hint, LinkText, Screen, Title } from '../src/components/ui';
import { useToast } from '../src/components/overlays';

type Mode = 'signin' | 'link';

/**
 * Code entry (phone OTP — DORMANT vendor-addition scaffold 2026-09-05). Reached
 * from phone-sign-in with the E.164 number and the mode; a code was JUST sent,
 * so the resend cooldown starts on mount (same 30 s pattern as verify-email).
 *
 *   signin  verifyOtp(type 'sms') -> the same post-auth continuation the email
 *           and social paths use, except a profile with no name (a first phone
 *           sign-up — the trigger has no email local part to fall back on) is
 *           routed to complete-profile first, exactly like a phone-less Apple
 *           sign-in (D3). No RequireNoSession here on purpose: the session
 *           lands mid-screen and the redirect would race the continuation
 *           (the verify-email precedent).
 *   link    verifyOtp(type 'phone_change') on a signed-in account, then the
 *           verified number is written to profiles.phone too — it is the one
 *           the desk should be calling.
 *
 * iOS fills the field from Messages (textContentType oneTimeCode); Android
 * needs the SMS Retriever hash in the message body for auto-read, which would
 * push the template past one segment — manual entry / paste there.
 */
function VerifyOtpForm({ mode, phone }: { mode: Mode; phone: string }) {
  const { t } = useLocale();
  const router = useRouter();
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
        toast(t('auth.phoneVerified'), 'info');
        router.replace('/(tabs)/profile');
        return;
      }
      await verifyPhoneOtp(supabase, phone, value);
      const profile = await queryClient.fetchQuery({
        queryKey: profileKeys.own,
        queryFn: () => fetchOwnProfile(supabase),
        staleTime: 0,
      });
      if (needsProfileCompletion(profile)) {
        // First phone sign-up: no name yet. complete-profile's 'continue' mode
        // runs continueAfterAuth() itself after the save (pending slot included).
        toast(t('auth.welcomeToApp'), 'info');
        router.replace({ pathname: '/complete-profile', params: { returnTo: 'continue' } });
        return;
      }
      toast(t('auth.welcomeBack'), 'info');
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
      else await sendPhoneOtp(supabase, phone);
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
        <Hint style={{ marginTop: 8 }}>{t('auth.otpBody', { phone: isolate(formatIraqiNational(phone)) })}</Hint>
        <Field
          label={t('auth.otpLabel')}
          value={code}
          onChangeText={(v) => {
            const next = sanitizeOtpInput(v);
            setCode(next);
            if (next.length === OTP_LENGTH) void onSubmit(next);
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={OTP_LENGTH}
          autoFocus
          onSubmitEditing={() => void onSubmit()}
        />
        {notice ? <Hint>{notice}</Hint> : null}
        <ErrorText>{error}</ErrorText>
        <Button
          label={t('auth.continueCta')}
          onPress={() => void onSubmit()}
          busy={busy || holdBusy}
          disabled={code.length !== OTP_LENGTH}
          variant="primary"
          style={{ marginTop: space.l }}
        />
        <Button
          label={coolingDown ? t('auth.resendCodeIn', { seconds: secondsLeft }) : t('auth.resendCode')}
          onPress={() => void onResend()}
          disabled={busy || coolingDown}
          variant="secondary"
          size="medium"
          labelColor={coolingDown ? colors.fnt2 : colors.blue}
          style={{ marginTop: 12 }}
        />
        <LinkText
          label={t('auth.changeNumber')}
          onPress={() => router.back()}
          style={{ marginTop: 14, paddingStart: 4 }}
        />
      </FormScreen>
    </Screen>
  );
}

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const { session, initializing } = useAuth();
  const mode: Mode = params.mode === 'link' ? 'link' : 'signin';
  const phone = typeof params.phone === 'string' ? params.phone : '';
  if (!phoneOtpEnabled() || !phone) return <Redirect href={mode === 'link' ? '/(tabs)' : '/sign-in'} />;
  if (mode === 'link') {
    return (
      <RequireSession>
        <VerifyOtpForm mode="link" phone={phone} />
      </RequireSession>
    );
  }
  // Deliberately ungated (see the header); only a user who already holds a
  // session BEFORE arriving is sent on — that is not this flow.
  if (!initializing && session && !params.phone) return <Redirect href="/(tabs)" />;
  return <VerifyOtpForm mode="signin" phone={phone} />;
}
