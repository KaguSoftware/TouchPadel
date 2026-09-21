import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../src/i18n/text';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { supabase } from '../src/lib/supabase';
import { sendPasswordReset, sendPasswordResetCode } from '../src/features/auth/api';
import { resetRedirect } from '../src/features/auth/redirects';
import { linkErrorParam } from '../src/features/auth/deepLink';
import { isNoAccountForPhone, mapOtpError, validatePhoneInput } from '../src/features/auth/phoneOtp';
import {
  isValidEmail,
  mapEmailAuthError,
  parseAuthMethod,
  type AuthMethod,
} from '../src/features/auth/emailAuth';
import { DEFAULT_ISO } from '../src/features/profile/phone';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { PhoneField } from '../src/components/phone';
import { Button, ErrorText, Field, FormScreen, Screen, SegmentedControl, Title } from '../src/components/ui';

/**
 * Forgot password, by phone (default segment, 2026-09-15) or by email
 * (restored 2026-09-20, Phase 2 plan O2).
 *
 *   phone  a code to the account's number (WhatsApp, else SMS) signs the guest
 *          in (app/verify-otp.tsx, mode reset) and marks the recovery session;
 *          app/reset-password.tsx then sets the new password on it. A number
 *          no account uses is said plainly: sign-up already refuses a taken
 *          number, so hiding it here would protect nothing and strand a guest
 *          who picked the wrong country code.
 *   email  a recovery link; useAuthDeepLink exchanges it and marks the
 *          recovery session. The submitted state deliberately does NOT
 *          disclose whether the account exists (spec 05.7): GoTrue answers
 *          success either way, and so does this screen.
 */
function ForgotPasswordScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ authError?: string; method?: string }>();
  const [method, setMethod] = useState<AuthMethod>(() => parseAuthMethod(params.method));
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where useAuthDeepLink sends a dead recovery link — a new one is one tap away.
  const linkError = linkErrorParam(params.authError);

  const onSubmitPhone = async () => {
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

  const onSubmitEmail = async () => {
    setError(null);
    setFieldError(null);
    if (!email.trim()) return setFieldError(t('auth.emailRequired'));
    if (!isValidEmail(email)) return setFieldError(t('auth.emailInvalid'));
    setBusy(true);
    try {
      await sendPasswordReset(supabase, email, resetRedirect());
      setSent(true);
    } catch (err) {
      setError(t(mapEmailAuthError(err)));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = method === 'email' ? onSubmitEmail : onSubmitPhone;

  return (
    <Screen gutter={20} edges={[]}>
      <FormScreen>
        <Title plain size={24}>
          {t('auth.resetPasswordTitle')}
        </Title>
        {sent ? (
          <>
            <View
              style={{
                marginTop: space.m,
                backgroundColor: colors.gtint,
                borderWidth: 1,
                borderColor: colors.gline,
                borderRadius: radius.button,
                padding: space.m,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 13,
                  lineHeight: 21,
                  color: colors.gtext2,
                }}
              >
                {t('auth.resetSubmitted')}
              </Text>
            </View>
            <Button
              testID="forgot-password.back-to-sign-in"
              label={t('auth.backToSignIn')}
              variant="secondary"
              size="medium"
              // A dead recovery link lands here with no history beneath it.
              onPress={() => router.replace({ pathname: '/sign-in', params: { method: 'email' } })}
              style={{ marginTop: space.sm }}
            />
          </>
        ) : (
          <>
            <View style={{ marginTop: 10 }}>
              <SegmentedControl<AuthMethod>
                testID="forgot-password.method"
                options={[
                  { value: 'phone', label: t('auth.phoneLabel') },
                  { value: 'email', label: t('auth.emailLabel') },
                ]}
                value={method}
                onChange={(next) => {
                  setMethod(next);
                  setFieldError(null);
                  setError(null);
                }}
              />
            </View>
            <Text
              style={{
                fontFamily: fonts.body400,
                fontSize: 13,
                lineHeight: 20,
                color: colors.mut,
                marginTop: 12,
              }}
            >
              {t(method === 'email' ? 'auth.forgotIntroEmail' : 'auth.forgotIntro')}
            </Text>
            {method === 'email' ? (
              <Field
                testID="forgot-password.email"
                placeholder={t('auth.emailLabel')}
                value={email}
                onChangeText={(next) => {
                  setEmail(next);
                  setFieldError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                error={fieldError}
                style={{ marginTop: 2 }}
                onSubmitEditing={() => void onSubmit()}
              />
            ) : (
              <PhoneField
                testID="forgot-password.phone"
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
            )}
            <ErrorText>{error ?? (linkError ? t(linkError) : null)}</ErrorText>
            <Button
              testID="forgot-password.submit"
              label={t(method === 'email' ? 'auth.sendResetLink' : 'auth.sendCode')}
              onPress={() => void onSubmit()}
              busy={busy}
              variant="primary"
              style={{ marginTop: space.sm }}
            />
          </>
        )}
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
