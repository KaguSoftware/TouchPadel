import { useState } from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { startPhoneLink } from '../src/features/auth/api';
import {
  isPhoneTaken,
  mapOtpError,
  parseLinkReturnTo,
  phoneOtpEnabled,
  validatePhoneInput,
  type LinkReturnTo,
} from '../src/features/auth/phoneOtp';
import { RequireSession } from '../src/features/auth/RequireSession';
import { clearPendingIntents } from '../src/features/booking/pendingIntent';
import { DEFAULT_ISO, parsePhone } from '../src/features/profile/phone';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useBackGuard } from '../src/navigation/back';
import { space } from '../src/theme';
import { PhoneField } from '../src/components/phone';
import { Button, ErrorText, FormScreen, Hint, Screen, Title } from '../src/components/ui';

/**
 * Link a phone number to a signed-in account: the guest proves the number so
 * the account's phone is one they hold. The file keeps its old route name; the
 * signed-out code-only sign-in it used to serve was removed 2026-09-15 —
 * accounts are now created with phone + password (app/sign-up.tsx) and signed
 * into with a password.
 *
 * Three ways in, told apart by `returnTo`:
 *
 *   (none)    Profile → "Verify phone number". Unreachable while
 *             EXPO_PUBLIC_PHONE_OTP is off: the row is not rendered and a
 *             direct navigation is redirected away.
 *   continue  A booking with a slot pending (owner, 2026-09-27: no reservation
 *             without a verified phone): the slot tap or the post-auth
 *             continuation sends an unverified guest here, and verify-otp
 *             holds the slot once the code lands. An open match's start or
 *             join rides the same way (owner, 2026-09-29), and verify-otp
 *             opens its screen.
 *   back      Review's "Verify phone number", or Start / Join on a match
 *             screen: verify-otp pops back to it.
 *
 * The booking modes ignore the flag — the requirement cannot be switched off
 * with the screen that meets it — and prefill `phone`, the profile's number.
 *
 * Any country (owner decision 2026-09-15; the SMS gate's allowed_prefixes is
 * open). The app's one phone input is used, so the country picker, digit
 * grouping and length cap match sign-up and edit-profile exactly; Iraq is the
 * default. A number that cannot be one is refused before a paid code is asked for.
 */
function PhoneLinkForm({ returnTo, initialPhone }: { returnTo: LinkReturnTo; initialPhone: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [iso, setIso] = useState(() => (initialPhone ? parsePhone(initialPhone).iso : DEFAULT_ISO));
  const [national, setNational] = useState(() => (initialPhone ? parsePhone(initialPhone).national : ''));
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Continue mode carries a pending slot or open-match intent: leaving without
  // a code drops it, so a later sign-in does not hold a slot (or open a match)
  // the guest walked away from. The step forward to the code is a replace (see
  // onSubmit) and lifts the guard first.
  const leave = useBackGuard({
    when: returnTo === 'continue',
    onBlocked: (go) => {
      clearPendingIntents();
      go();
    },
  });

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
      const next = { pathname: '/verify-otp', params: { phone: e164, mode: 'link', returnTo: returnTo ?? '' } } as const;
      // The booking modes swap this screen for the code step, so Review never
      // has a spent form beneath it; "Use a different number" swaps it back.
      if (returnTo) leave(() => router.replace(next));
      else router.push(next);
    } catch (err) {
      if (isPhoneTaken(err)) setFieldError(t('auth.phoneLinkTaken'));
      else setError(t(mapOtpError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gutter={20} edges={[]}>
      <Stack.Screen options={{ title: t('auth.verifyPhoneRow') }} />
      <FormScreen>
        <Title plain>{t('auth.phoneSignInTitle')}</Title>
        <Hint style={{ marginTop: 8 }}>{t(returnTo ? 'auth.phoneVerifyToBookBody' : 'auth.phoneLinkBody')}</Hint>
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
  const params = useLocalSearchParams<{ returnTo?: string; phone?: string }>();
  const returnTo = parseLinkReturnTo(params.returnTo);
  if (!returnTo && !phoneOtpEnabled()) return <Redirect href="/(tabs)" />;
  return (
    <RequireSession>
      <PhoneLinkForm returnTo={returnTo} initialPhone={typeof params.phone === 'string' ? params.phone : ''} />
    </RequireSession>
  );
}
