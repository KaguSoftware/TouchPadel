import { useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useRouter } from '../src/navigation/useRouter';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  QR_INK,
  QR_PAPER,
  formatVoucherCode,
  type RewardVoucher,
} from '@touch/core/loyalty';
import { formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { mapErrorToKey } from '../src/features/booking/errors';
import {
  useCancelRewardVoucher,
  useMyLoyalty,
  useMyRewardVouchers,
  useRedeemReward,
} from '../src/features/loyalty/hooks';
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
 * A reward redeemed in the app (0415, Majed 2026-11-13): one fixed QR for that one reward, the
 * code under it in groups for a till that types it, and the 15 minutes it lives as a calm
 * countdown: a large time and a bar that empties, the member card's bar run the other way. The
 * last two minutes go amber. The guest may cancel it (the points come back).
 *
 * The screen asks the server every few seconds while it is open, so when the till scans the code
 * it turns to "Collected" by itself: the one motion here, because the server did it, not the
 * guest's finger. Expired and cancelled say the points are back and offer to redeem again.
 *
 * The QR and the code are LTR in both languages: they are marks, not prose.
 */
function RewardVoucherScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const back = useBack({ pathname: '/loyalty' });
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useAuth();
  const member = !!session && !session.user.is_anonymous;
  const list = useMyRewardVouchers(member, true);
  const mine = useMyLoyalty(member);
  const cancel = useCancelRewardVoucher();
  const redeem = useRedeemReward();
  const [asking, setAsking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // One tick a second for the time; the bar runs on its own between ticks.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const voucher: RewardVoucher | null = list.data?.vouchers.find((v) => v.id === id) ?? null;
  const readAt = list.dataUpdatedAt || now;
  const msLeft = voucher && list.data ? voucherMsLeft(voucher.expires_at, list.data.now, readAt, now) : 0;
  const phase: VoucherPhase | null = voucher ? voucherPhase(voucher.status, msLeft) : null;
  const name = voucher ? (locale === 'ar' ? voucher.name_ar : voucher.name_en) : '';
  const pts = (n: number) => isolateLtr(formatNumber(n, locale));

  // The reward again, while it is still offered and the balance reaches it.
  const reward = voucher ? mine.data?.rewards.find((r) => r.id === voucher.reward_id) : undefined;
  const canAgain = !!reward && (mine.data?.balance ?? 0) >= reward.cost_points;
  const again = () => {
    if (!voucher || redeem.isPending) return;
    redeem.mutate(voucher.reward_id, {
      onSuccess: (v) => router.replace({ pathname: '/reward-voucher', params: { id: v.id } }),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };
  const doCancel = () => {
    setAsking(false);
    if (!voucher || cancel.isPending) return;
    cancel.mutate(voucher.id, {
      onSuccess: () => toast(t('loyalty.guest.voucher.cancelled', { points: pts(voucher.points) }), 'info'),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };

  const body = (() => {
    if (list.isPending) return <SkeletonList rows={2} height={160} />;
    if (list.isError) {
      return (
        <ErrorState
          testID="reward-voucher.error"
          title={t('loyalty.guest.voucher.title')}
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
          testID="reward-voucher.missing"
          title={t('loyalty.guest.voucher.title')}
          message={t('loyalty.guest.voucher.missing')}
          actionLabel={t('loyalty.guest.voucher.done')}
          actionTestID="reward-voucher.done"
          onAction={back}
        />
      );
    }

    const qrSize = Math.min(QR_MAX, width - space.l * 2 - space.m * 2);
    const live = phase === 'active' || phase === 'urgent';
    const urgent = phase === 'urgent';

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
        {/* What it is, first: the reward's name is the screen's subject. */}
        <View style={{ gap: 2, alignItems: 'center' }}>
          <Text
            testID="reward-voucher.name"
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
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut }}>
            {t('loyalty.guest.voucher.pts', { points: pts(voucher.points) })}
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
                <QrMark testID="reward-voucher.qr" value={voucher.code} size={qrSize} />
              </View>
              <Text
                testID="reward-voucher.code"
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
                {formatVoucherCode(voucher.code)}
              </Text>
            </View>

            {/* The time: large and still, the bar doing the moving. */}
            <View style={{ alignItems: 'center', gap: 4 }}>
              <MicroLabel>{t('loyalty.guest.voucher.timeLeft')}</MicroLabel>
              <Text
                testID="reward-voucher.time"
                accessibilityLabel={t('loyalty.guest.voucher.a11yLeft', { time: formatCountdown(msLeft) })}
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
                testID="reward-voucher.bar"
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
                {t('loyalty.guest.voucher.show')}
              </Text>
              <Hint style={{ textAlign: 'center' }}>{t('loyalty.guest.voucher.bearer')}</Hint>
            </View>

            <Button
              testID="reward-voucher.cancel"
              variant="secondary"
              label={t('loyalty.guest.voucher.cancel')}
              busy={cancel.isPending}
              onPress={() => setAsking(true)}
            />
            <ConfirmAlert
              visible={asking}
              title={t('loyalty.guest.voucher.cancelTitle')}
              body={t('loyalty.guest.voucher.cancelBody', { points: pts(voucher.points) })}
              confirmLabel={t('loyalty.guest.voucher.cancelConfirm')}
              cancelLabel={t('loyalty.guest.voucher.keep')}
              destructive
              onConfirm={doCancel}
              onDismiss={() => setAsking(false)}
            />
          </>
        ) : (
          <VoucherOutcome
            testID={`reward-voucher.${phase}`}
            phase={phase}
            title={t(
              phase === 'collected'
                ? 'loyalty.guest.voucher.collectedTitle'
                : phase === 'cancelled'
                  ? 'loyalty.guest.voucher.cancelledTitle'
                  : 'loyalty.guest.voucher.expiredTitle',
            )}
            body={
              phase === 'collected'
                ? t('loyalty.guest.voucher.collectedBody', { reward: name })
                : t(
                    phase === 'cancelled'
                      ? 'loyalty.guest.voucher.cancelledBody'
                      : 'loyalty.guest.voucher.expiredBody',
                    { points: pts(voucher.points) },
                  )
            }
          >
            {phase !== 'collected' && canAgain ? (
              <Button
                testID="reward-voucher.again"
                label={t('loyalty.guest.voucher.again')}
                busy={redeem.isPending}
                onPress={again}
              />
            ) : null}
            <Button
              testID="reward-voucher.done"
              variant={phase === 'collected' || !canAgain ? 'primary' : 'secondary'}
              label={t('loyalty.guest.voucher.done')}
              onPress={back}
            />
          </VoucherOutcome>
        )}
      </ScrollView>
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('loyalty.guest.voucher.title') }} />
      {body}
    </Screen>
  );
}

/** Signed-in only: a voucher belongs to an account (RequireSession). */
export default function GuardedRewardVoucherScreen() {
  return (
    <RequireSession>
      <RewardVoucherScreen />
    </RequireSession>
  );
}
