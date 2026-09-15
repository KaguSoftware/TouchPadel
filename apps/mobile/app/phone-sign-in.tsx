import { useState } from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { sendPhoneOtp, startPhoneLink } from '../src/features/auth/api';
import { mapOtpError, phoneOtpEnabled, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { RequireSession } from '../src/features/auth/RequireSession';
import { DEFAULT_ISO } from '../src/features/profile/phone';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import { PhoneField } from '../src/components/phone';
import { Button, ErrorText, FormScreen, Hint, Screen, Title } from '../src/components/ui';

type Mode = 'signin' | 'link';

/**
 * Phone number entry for phone OTP (docs/design/phone-otp-2026-09-05.md). Two modes:
 *
 *   signin  a signed-out guest: GoTrue signs in, or creates the account, on
 *           the code. No password exists for such an account.
 *   link    a signed-in email / social guest verifying their number so a later
 *           phone sign-in lands on THIS account (Profile → "Verify phone number").
 *
 * Any country (owner decision 2026-09-15; the SMS gate's allowed_prefixes is
 * open). The app's one phone input is used, so the country picker, digit
 * grouping and length cap match sign-up and edit-profile exactly; Iraq is the
 * default. A number that cannot be one is refused before a paid code is asked for.
 *
 * Unreachable while EXPO_PUBLIC_PHONE_OTP is off: the entry buttons are not
 * rendered and a direct navigation is redirected away.
 */
function PhoneSignInForm({ mode }: { mode: Mode }) {
  const { t } = useLocale();
  const router = useRouter();
  const [iso, setIso] = useState(DEFAULT_ISO);
  const [national, setNational] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setFieldError(null);
    const { e164, error: invalid } = validatePhoneInput(iso, national);
    if (!e164 || invalid) {
      setFieldError(t('auth.phoneOtpInvalid'));
      return;
    }
    setBusy(true);
    try {
      if (mode === 'link') await startPhoneLink(supabase, e164);
      else await sendPhoneOtp(supabase, e164);
      router.push({ pathname: '/verify-otp', params: { phone: e164, mode } });
    } catch (err) {
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.continueWithPhone') }} />
      <FormScreen>
        <Title plain>{t('auth.phoneSignInTitle')}</Title>
        <Hint style={{ marginTop: 8 }}>{t(mode === 'link' ? 'auth.phoneLinkBody' : 'auth.phoneSignInBody')}</Hint>
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
        <ErrorText>{error}</ErrorText>
        <Button
          label={t('auth.sendCode')}
          onPress={() => void onSubmit()}
          busy={busy}
          variant="primary"
          style={{ marginTop: space.l }}
        />
      </FormScreen>
    </Screen>
  );
}

export default function PhoneSignInScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = params.mode === 'link' ? 'link' : 'signin';
  if (!phoneOtpEnabled()) return <Redirect href={mode === 'link' ? '/(tabs)' : '/sign-in'} />;
  if (mode === 'link') {
    return (
      <RequireSession>
        <PhoneSignInForm mode="link" />
      </RequireSession>
    );
  }
  return (
    <RequireNoSession>
      <PhoneSignInForm mode="signin" />
    </RequireNoSession>
  );
}
