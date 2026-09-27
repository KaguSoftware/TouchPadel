import { useState } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { startPhoneLink } from '../src/features/auth/api';
import { mapOtpError, phoneOtpEnabled, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { RequireSession } from '../src/features/auth/RequireSession';
import { DEFAULT_ISO } from '../src/features/profile/phone';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space } from '../src/theme';
import { PhoneField } from '../src/components/phone';
import { Button, ErrorText, FormScreen, Hint, Screen, Title } from '../src/components/ui';

/**
 * Link a phone number to a signed-in account (Profile → "Verify phone
 * number"): a social guest proves the number so the account's phone is one
 * they hold. The file keeps its old route name; the signed-out code-only
 * sign-in it used to serve was removed 2026-09-15 — accounts are now created
 * with phone + password (app/sign-up.tsx) and signed into with a password.
 *
 * Any country (owner decision 2026-09-15; the SMS gate's allowed_prefixes is
 * open). The app's one phone input is used, so the country picker, digit
 * grouping and length cap match sign-up and edit-profile exactly; Iraq is the
 * default. A number that cannot be one is refused before a paid code is asked for.
 *
 * Unreachable while EXPO_PUBLIC_PHONE_OTP is off: the Profile row is not
 * rendered and a direct navigation is redirected away.
 */
function PhoneLinkForm() {
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
      await startPhoneLink(supabase, e164);
      router.push({ pathname: '/verify-otp', params: { phone: e164, mode: 'link' } });
    } catch (err) {
      setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.verifyPhoneRow') }} />
      <FormScreen>
        <Title plain>{t('auth.phoneSignInTitle')}</Title>
        <Hint style={{ marginTop: 8 }}>{t('auth.phoneLinkBody')}</Hint>
        <PhoneField
          testID="phone-sign-in.phone"
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
          testID="phone-sign-in.send-code"
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
  if (!phoneOtpEnabled()) return <Redirect href="/(tabs)" />;
  return (
    <RequireSession>
      <PhoneLinkForm />
    </RequireSession>
  );
}
