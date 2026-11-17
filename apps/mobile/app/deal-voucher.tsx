import { useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QR_INK, QR_PAPER, formatDealVoucherCode, type DealVoucher } from '@touch/core/loyalty';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { mapErrorToKey } from '../src/features/booking/errors';
import {
  useCancelDealVoucher,
  useMyDealVouchers,
  useMyDeals,
  useRedeemDeal,
} from '../src/features/loyalty/hooks';
import { DealArt } from '../src/features/loyalty/DealArt';
import { liveDealVoucher } from '../src/features/loyalty/dealVouchers';
import { dealValueText } from '../src/features/loyalty/dealText';
import { QrMark } from '../src/features/loyalty/QrMark';
import { DrainBar, VoucherOutcome } from '../src/features/loyalty/VoucherParts';
import {
  formatCountdown,
  voucherMsLeft,
  voucherPhase,
  type VoucherPhase,
} from '../src/features/loyalty/vouchers';
import { useBack } from '../src/navigation/back';
import { palettes, radius, space, useTheme } from '../src/theme';
import { Button, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ConfirmAlert, useToast } from '../src/components/overlays';

/** The widest the QR is drawn: past this a phone held over the counter gains nothing. */
const QR_MAX = 280;

/**
 * A deal redeemed in the app (0445, Majed 2026-11-15: "its own QR code with a 15-minute
 * countdown, just like rewards"): the reward code's screen for a deal. One fixed QR for that one
 * code, the code under it in groups (TPD-XXXX-XXXX-XXXX) for a till that types it, and the 15
 * minutes as a large time and a bar that empties, amber in the last two. No points are involved.
 *
 * It asks the server every 4 s while open, so a till's scan turns it to "Used at the counter" by
 * itself. Expired and cancelled offer a new code (`redeem_deal` again, which replaces this
 * screen's id), unless the deal is known to be locked or spent, or a newer code for it is live
 * (then "Show code" goes to that one instead of cancelling it with a fresh Redeem).
 *
 * The deal's picture is drawn only once the code has ended, in place of the clock: while the code
 * is live the QR and the time own the screen. It comes from the deals list, and is skipped when
 * the deal is not in it.
 */
function DealVoucherScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const back = useBack({ pathname: '/club' });
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useAuth();
  const member = !!session && !session.user.is_anonymous;
  const list = useMyDealVouchers(member, true);
  const deals = useMyDeals(member);
  const cancel = useCancelDealVoucher();
  const redeem = useRedeemDeal();
  const [asking, setAsking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // When this code was opened: a list read before then may not hold a code just redeemed.
  const [opened, setOpened] = useState(() => ({ id, at: now }));
  if (opened.id !== id) setOpened({ id, at: now });

  // One tick a second for the time; the bar runs on its own between ticks.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const voucher: DealVoucher | null = list.data?.vouchers.find((v) => v.id === id) ?? null;
  const readAt = list.dataUpdatedAt || now;
  const msLeft = voucher && list.data ? voucherMsLeft(voucher.expires_at, list.data.now, readAt, now) : 0;
  const phase: VoucherPhase | null = voucher ? voucherPhase(voucher.status, msLeft) : null;
  const name = voucher ? (locale === 'ar' ? voucher.name_ar || voucher.name_en : voucher.name_en) : '';

  const deal = voucher ? deals.data?.deals.find((d) => d.id === voucher.promotion_id) : undefined;
  const newer = voucher && voucher.status !== 'active' ? liveDealVoucher(list.data, voucher.promotion_id) : null;
  // Unknown deal: offer it and let the server say why not.
  const canAgain = !deal || deal.state === 'open';

  const again = () => {
    if (!voucher || redeem.isPending) return;
    redeem.mutate(voucher.promotion_id, {
      onSuccess: (r) => router.replace({ pathname: '/deal-voucher', params: { id: r.voucher.id } }),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };
  const showNewer = () => {
    if (newer) router.replace({ pathname: '/deal-voucher', params: { id: newer.id } });
  };
  const doCancel = () => {
    setAsking(false);
    if (!voucher || cancel.isPending) return;
    // The screen itself turns to "Code cancelled"; only a refusal needs a word.
    cancel.mutate(voucher.id, { onError: (err) => toast(t(mapErrorToKey(err)), 'error') });
  };

  const body = (() => {
    if (list.isPending || (!voucher && !list.isError && list.dataUpdatedAt < opened.at)) {
      return <SkeletonList rows={2} height={160} />;
    }
    if (list.isError && !voucher) {
      return (
        <ErrorState
          testID="deal-voucher.error"
          title={t('loyalty.guest.dealVoucher.title')}
          message={t(mapErrorToKey(list.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void list.refetch()}
          busy={list.isRefetching}
        />
      );
    }
    if (!voucher || !phase) {
      return (
        <EmptyState
          testID="deal-voucher.missing"
          title={t('loyalty.guest.dealVoucher.title')}
          message={t('loyalty.guest.dealVoucher.missing')}
          actionLabel={t('loyalty.guest.dealVoucher.done')}
          actionTestID="deal-voucher.done"
          onAction={back}
        />
      );
    }

    const qrSize = Math.min(QR_MAX, width - space.l * 2 - space.m * 2);
    const live = phase === 'active' || phase === 'urgent';
    const urgent = phase === 'urgent';
    const offerAgain = phase !== 'collected' && !newer && canAgain;

    return (
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.m,
          alignItems: 'stretch',
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* What it is, first: the deal's name, then what it is worth. */}
        <View style={{ gap: 2, alignItems: 'center' }}>
          <Text
            testID="deal-voucher.name"
            style={{
              fontFamily: fonts.display900,
              fontSize: 28,
              lineHeight: 34,
              color: colors.ink,
              textAlign: 'center',
            }}
          >
            {name}
          </Text>
          <Text
            testID="deal-voucher.value"
            style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut, textAlign: 'center' }}
          >
            {dealValueText(voucher, t, locale)}
          </Text>
        </View>

        {live ? (
          <>
            {/* The code on its own white paper in both themes: the scanner needs the contrast. */}
            <View
              style={{
                alignSelf: 'center',
                alignItems: 'center',
                gap: space.sm,
                padding: space.m,
                borderRadius: radius.card,
                backgroundColor: QR_PAPER,
                borderWidth: 1,
                borderColor: palettes.light.line,
              }}
            >
              <View style={{ direction: 'ltr' }}>
                <QrMark testID="deal-voucher.qr" value={voucher.code} size={qrSize} />
              </View>
              <Text
                testID="deal-voucher.code"
                selectable
                style={{
                  writingDirection: 'ltr',
                  fontFamily: fonts.display800,
                  fontSize: 19,
                  letterSpacing: 1.5,
                  color: QR_INK,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatDealVoucherCode(voucher.code)}
              </Text>
            </View>

            {/* The time: large and still, the bar doing the moving. */}
            <View style={{ alignItems: 'center', gap: 4 }}>
              <MicroLabel>{t('loyalty.guest.dealVoucher.timeLeft')}</MicroLabel>
              <Text
                testID="deal-voucher.time"
                accessibilityLabel={t('loyalty.guest.dealVoucher.a11yLeft', { time: formatCountdown(msLeft) })}
                accessibilityLiveRegion="polite"
                style={{
                  writingDirection: 'ltr',
                  fontFamily: fonts.display900,
                  fontSize: 52,
                  lineHeight: 60,
                  color: urgent ? colors.ambtext : colors.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatCountdown(msLeft)}
              </Text>
              <DrainBar
                testID="deal-voucher.bar"
                msLeft={msLeft}
                expiresAt={voucher.expires_at}
                readAt={readAt}
                color={urgent ? colors.ambstrong : colors.blue}
                track={colors.line}
              />
            </View>

            <View style={{ gap: 4, alignItems: 'center', paddingHorizontal: space.s }}>
              <Text
                style={{
                  fontFamily: fonts.body700,
                  fontSize: 15,
                  color: colors.ink,
                  textAlign: 'center',
                }}
              >
                {t('loyalty.guest.dealVoucher.show')}
              </Text>
              <Hint style={{ textAlign: 'center' }}>{t('loyalty.guest.dealVoucher.bearer')}</Hint>
            </View>

            <Button
              testID="deal-voucher.cancel"
              variant="secondary"
              label={t('loyalty.guest.dealVoucher.cancel')}
              busy={cancel.isPending}
              onPress={() => setAsking(true)}
            />
            <ConfirmAlert
              visible={asking}
              title={t('loyalty.guest.dealVoucher.cancelTitle')}
              body={t('loyalty.guest.dealVoucher.cancelBody')}
              confirmLabel={t('loyalty.guest.dealVoucher.cancelConfirm')}
              cancelLabel={t('loyalty.guest.dealVoucher.keep')}
              destructive
              onConfirm={doCancel}
              onDismiss={() => setAsking(false)}
            />
          </>
        ) : (
          <VoucherOutcome
            testID={`deal-voucher.${phase}`}
            phase={phase}
            title={t(
              phase === 'collected'
                ? 'loyalty.guest.dealVoucher.collectedTitle'
                : phase === 'cancelled'
                  ? 'loyalty.guest.dealVoucher.cancelledTitle'
                  : 'loyalty.guest.dealVoucher.expiredTitle',
            )}
            body={
              phase === 'collected'
                ? t('loyalty.guest.dealVoucher.collectedBody', { deal: name })
                : newer
                  ? t('loyalty.guest.dealVoucher.newerBody')
                  : t(
                      phase === 'cancelled'
                        ? 'loyalty.guest.dealVoucher.cancelledBody'
                        : 'loyalty.guest.dealVoucher.expiredBody',
                    )
            }
            art={
              deal ? (
                <View style={{ alignSelf: 'stretch', borderRadius: radius.card, overflow: 'hidden' }}>
                  <DealArt deal={deal} height={150} dimmed={!offerAgain && !newer} />
                </View>
              ) : undefined
            }
          >
            {phase !== 'collected' && newer ? (
              <Button
                testID="deal-voucher.current"
                label={t('loyalty.guest.deals.showCode')}
                onPress={showNewer}
              />
            ) : offerAgain ? (
              <Button
                testID="deal-voucher.again"
                label={t('loyalty.guest.dealVoucher.again')}
                busy={redeem.isPending}
                onPress={again}
              />
            ) : null}
            <Button
              testID="deal-voucher.done"
              variant={phase === 'collected' || (!newer && !offerAgain) ? 'primary' : 'secondary'}
              label={t('loyalty.guest.dealVoucher.done')}
              onPress={back}
            />
          </VoucherOutcome>
        )}
      </ScrollView>
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('loyalty.guest.dealVoucher.title') }} />
      {body}
    </Screen>
  );
}

/** Signed-in only: a code belongs to an account (RequireSession). */
export default function GuardedDealVoucherScreen() {
  return (
    <RequireSession>
      <DealVoucherScreen />
    </RequireSession>
  );
}
