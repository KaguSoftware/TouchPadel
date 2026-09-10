import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../src/i18n/text';
import { supabase } from '../src/lib/supabase';
import { sendPhoneOtp, startPhoneLink } from '../src/features/auth/api';
import { mapOtpError, phoneOtpEnabled, validatePhoneInput } from '../src/features/auth/phoneOtp';
import { RequireNoSession } from '../src/features/auth/RequireNoSession';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, Field, FormScreen, Hint, Screen, Title } from '../src/components/ui';

type Mode = 'signin' | 'link';

/**
 * Phone number entry (phone OTP — DORMANT vendor-addition scaffold 2026-09-05;
 * docs/design/phone-otp-2026-09-05.md). Two modes:
 *
 *   signin  a signed-out guest: GoTrue signs in, or creates the account, on
 *           the code. No password exists for such an account.
 *   link    a signed-in email / social guest verifying their number so a later
 *           phone sign-in lands on THIS account (Profile → "Verify phone number").
 *
 * The prefix is fixed to +964: the venue's guests are local, the SMS gate
 * (0069) refuses other country codes anyway, and a code to a mistyped number
 * is money spent on nothing — so validation is strict (an Iraqi mobile in any
 * of its written shapes, Arabic-Indic digits included) before anything is sent.
 *
 * Unreachable while EXPO_PUBLIC_PHONE_OTP is off: the entry buttons are not
 * rendered and a direct navigation is redirected away.
 */
function PhoneSignInForm({ mode }: { mode: Mode }) {
  const { t } = useLocale();
  const router = useRouter();
  const { colors, fonts } = useTheme();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setFieldError(null);
    const { e164, error: invalid } = validatePhoneInput(raw);
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
        <Hint style={{ marginTop: 8 }}>
          {t(mode === 'link' ? 'auth.phoneLinkBody' : 'auth.phoneSignInBody')}
        </Hint>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          {/* Fixed country prefix; the field takes the national 07XX part (or +964 / 00964 — the normaliser folds them). */}
          <View
            style={{
              marginTop: space.sm,
              minHeight: 50,
              justifyContent: 'center',
              paddingStart: 14,
              paddingEnd: 14,
              borderRadius: radius.cell,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.sub,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.body600,
                fontSize: 14,
                color: colors.ink,
                writingDirection: 'ltr',
              }}
            >
              +964
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Field
              placeholder={t('auth.phoneNationalPlaceholder')}
              value={raw}
              onChangeText={setRaw}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoFocus
              error={fieldError}
              onSubmitEditing={() => void onSubmit()}
              returnKeyType="send"
            />
          </View>
        </View>
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
