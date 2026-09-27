import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { dismissPaymentPage } from '../../src/features/deposit/browser';
import { rememberReturnRef } from '../../src/features/deposit/pendingPayment';
import { space, useTheme } from '../../src/theme';

/**
 * `touchpadel://pay/return?ref=<request_id>` — where Qi's return page sends the
 * browser (build-contracts-2026-09-27 §3, plan §5.2 path 1).
 *
 * It decides NOTHING. A return link is a hint to go and look, never a result:
 * the bank may still be working, and a URL anyone can type must not be able to
 * put "paid" on a screen. So this closes the payment sheet and hands the ref to
 * the one screen that asks the server, and renders a spinner for the frame or
 * two it lives.
 *
 * `dismissTo`, not `replace`: the payment screen is usually already mounted
 * underneath (Review opened it before the sheet), and a replace would stack a
 * second copy of it on top. dismissTo pops back to that one when it is there
 * and replaces this screen with a fresh one when it is not (a cold start from
 * the link). Both land on /pay/status with the ref.
 */
export default function PayReturnScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const params = useLocalSearchParams<{ ref?: string }>();
  const ref = typeof params.ref === 'string' ? params.ref.trim() : '';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await dismissPaymentPage();
      if (cancelled) return;
      // Signed out: the status screen's guard will send the guest to sign in
      // and the route (with the ref) is lost on the way. Keep it for the
      // post-auth continuation.
      if (!session && ref) rememberReturnRef(ref);
      // A link with no ref still lands there: the status screen's own
      // "nothing to show here" is the designed answer to a mangled link.
      router.dismissTo({ pathname: '/pay/status', params: { ref } });
    })();
    return () => {
      cancelled = true;
    };
    // Once per landing: the link is consumed on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      testID="pay-return.waiting"
      accessibilityRole="progressbar"
      accessibilityLabel={t('deposit.checkingTitle')}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        backgroundColor: colors.bg,
      }}
    >
      <ActivityIndicator color={colors.blue} size="large" />
      <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}>
        {t('deposit.checkingTitle')}
      </Text>
    </View>
  );
}
