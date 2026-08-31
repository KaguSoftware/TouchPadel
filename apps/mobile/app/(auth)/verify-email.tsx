import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { resendVerification } from '../../src/features/auth/api';
import { verifyRedirect } from '../../src/features/auth/redirects';
import { useAuth } from '../../src/features/auth/context';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, ErrorText, Hint, Screen } from '../../src/components/ui';
import { EnvelopeIcon } from '../../src/components/icons';

const RESEND_COOLDOWN_S = 30;

/**
 * Pending-verification (design 2026-08-31): centered envelope moment with a
 * cooldown on resend. When the emailed link lands a session (useAuthDeepLink
 * exchanges it), this screen advances itself to the verified-result screen —
 * the (auth) layout deliberately does not bounce these two routes.
 */
export default function VerifyEmailScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const [busy, setBusy] = useState(false);
  const [cooldownEnd, setCooldownEnd] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The emailed link signed us in -> show the verified state.
  useEffect(() => {
    if (session) router.replace('/(auth)/verify-result');
  }, [session, router]);

  useEffect(() => {
    const id = setInterval(
      () => setSecondsLeft(Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000))),
      500,
    );
    return () => clearInterval(id);
  }, [cooldownEnd]);

  const onResend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resendVerification(supabase, email, verifyRedirect());
      setNotice(t('auth.resendEmailDone'));
      setCooldownEnd(Date.now() + RESEND_COOLDOWN_S * 1000);
      setSecondsLeft(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(t(mapErrorToKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const coolingDown = secondsLeft > 0;

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: 28,
          paddingEnd: 28,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 20,
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.pill,
            backgroundColor: colors.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <EnvelopeIcon size={26} color={colors.blue} />
        </View>
        <Text
          style={{
            fontFamily: fonts.display900,
            fontSize: 21,
            textTransform: 'uppercase',
            color: colors.ink,
            marginTop: 18,
            textAlign: 'center',
          }}
        >
          {t('auth.checkEmailTitle')}
        </Text>
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 13,
            lineHeight: 21,
            color: colors.mut,
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          {t('auth.checkEmailBody', { email })}
        </Text>
        {notice ? <Hint>{notice}</Hint> : null}
        <ErrorText>{error}</ErrorText>
        <Button
          label={
            coolingDown ? t('auth.resendIn', { seconds: secondsLeft }) : t('auth.resendLink')
          }
          onPress={() => void onResend()}
          busy={busy}
          disabled={!email || coolingDown}
          variant="secondary"
          labelColor={coolingDown ? colors.fnt2 : colors.blue}
          style={{ marginTop: 22, alignSelf: 'stretch' }}
        />
        <Button
          label={t('auth.useDifferentEmail')}
          onPress={() => router.replace('/(auth)/sign-up')}
          variant="ghost"
          style={{ marginTop: space.sm }}
        />
      </View>
    </Screen>
  );
}
