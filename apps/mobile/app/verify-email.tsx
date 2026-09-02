import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { resendVerification, signOut } from '../src/features/auth/api';
import { verifyRedirect } from '../src/features/auth/redirects';
import { useAuth } from '../src/features/auth/context';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, Hint, Screen } from '../src/components/ui';
import { EnvelopeIcon } from '../src/components/icons';

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
    if (session) router.replace('/verify-result');
  }, [session]);

  // Tick only while a cooldown is actually running (it used to poll at 2 Hz forever).
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

  // Spec 05.5 onSignOut: an escape from an unverified account.
  const onSignOut = async () => {
    try {
      await signOut(supabase);
    } catch {
      // Nothing to lose here; leave regardless.
    }
    router.replace('/(tabs)');
  };

  const coolingDown = secondsLeft > 0;

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingStart: 28,
          paddingEnd: 28,
          paddingBottom: 20,
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
        {/* Design: three lines, the address in bold ink. */}
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
          {t('auth.checkEmailLead')}
          {'\n'}
          <Text style={{ fontFamily: fonts.body800, color: colors.ink }}>{email}</Text>
          {'\n'}
          {t('auth.checkEmailTail')}
        </Text>
        {notice ? <Hint style={{ textAlign: 'center' }}>{notice}</Hint> : null}
        <ErrorText>{error}</ErrorText>
        <Button
          label={
            coolingDown ? t('auth.resendIn', { seconds: secondsLeft }) : t('auth.resendLink')
          }
          onPress={() => void onResend()}
          busy={busy}
          disabled={!email || coolingDown}
          variant="secondary"
          size="medium"
          labelColor={coolingDown ? colors.fnt2 : colors.blue}
          style={{ marginTop: 22, alignSelf: 'stretch' }}
        />
        <Button
          label={t('auth.useDifferentEmail')}
          onPress={() => router.replace('/sign-up')}
          variant="ghost"
          labelColor={colors.fnt}
          style={{ marginTop: space.sm }}
        />
        <Button
          label={t('auth.signOut')}
          onPress={() => void onSignOut()}
          variant="ghost"
          labelColor={colors.fnt2}
        />
      </View>
    </Screen>
  );
}
