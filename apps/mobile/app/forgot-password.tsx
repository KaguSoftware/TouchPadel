import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../src/i18n/text';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { supabase } from '../src/lib/supabase';
import { sendPasswordResetCode } from '../src/features/auth/api';
import { linkErrorParam } from '../src/features/auth/deepLink';
import { isNoAccountForPhone, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { DEFAULT_ISO } from '../src/features/profile/phone';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { PhoneField } from '../src/components/phone';
import { Button, ErrorText, FormScreen, Screen, Title } from '../src/components/ui';

/**
 * Forgot password, by phone (2026-09-15; the emailed reset link went with
 * email sign-in). A code to the account's number (WhatsApp, else SMS) signs the guest in
 * (app/verify-otp.tsx, mode reset), and app/reset-password.tsx then sets the
 * new password on that session. Also how an account made by the old
 * code-only phone sign-in gets its first password.
 *
 * A number no account uses is said plainly: sign-up already refuses a taken
 * number, so hiding it here would protect nothing and strand a guest who
 * picked the wrong country code.
 */
function ForgotPasswordScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where useAuthDeepLink sends a dead recovery link from an old email.
  const linkError = linkErrorParam(useLocalSearchParams<{ authError?: string }>().authError);

  const onSubmit = async () => {
    setError(null);
    setFieldError(null);
    const { e164 } = validatePhoneInput(iso, national);
    if (!e164) return setFieldError(t(national.trim() ? 'auth.phoneOtpInvalid' : 'auth.phoneRequired'));
    setBusy(true);
    try {
      await sendPasswordResetCode(supabase, e164);
      router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'reset' } });
    } catch (err) {
      if (isNoAccountForPhone(err)) setFieldError(t('auth.resetNoAccount'));
      else setError(t(mapOtpError(err)));
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
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 13,
            lineHeight: 20,
            color: colors.mut,
            marginTop: 8,
          }}
        >
          {t('auth.forgotIntro')}
        </Text>
        <PhoneField
          placeholder={t('auth.phoneLabel')}
          iso={iso}
          onChangeIso={(next) => {
            setIso(next);
            setFieldError(null);
          }}
          national={national}
          onChangeNational={(next) => {
            setNational(next);
            setFieldError(null);
          }}
          error={fieldError}
        />
        <ErrorText>{error ?? (linkError ? t(linkError) : null)}</ErrorText>
        <Button
          label={t('auth.sendCode')}
          onPress={() => void onSubmit()}
          busy={busy}
          variant="primary"
          style={{ marginTop: space.sm }}
        />
      </FormScreen>
    </Screen>
  );
}

/**
 * Signed-out only, on the ROOT stack. The `(auth)` group carried this rule in
 * its layout; flattening it is what lets UIKit draw its own back item here
 * instead of a JS stand-in. See RequireNoSession for the pending-slot
 * exemption that keeps the post-auth booking continuation working.
 */
export default function GuardedForgotPasswordScreen() {
  return (
    <RequireNoSession>
      <ForgotPasswordScreen />
    </RequireNoSession>
  );
}
