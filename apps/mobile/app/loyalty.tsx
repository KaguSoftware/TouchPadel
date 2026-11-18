import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TIER_SWATCH } from '@touch/core/loyalty';
import { formatDate, formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useVenueSettings } from '../src/features/availability/hooks';
import { DEFAULT_TZ } from '../src/features/availability/assemble';
import {
  useMyCardExtras,
  useMyLoyalty,
  useMyRewardVouchers,
  useRedeemReward,
} from '../src/features/loyalty/hooks';
import { activeVouchers, formatCountdown } from '../src/features/loyalty/vouchers';
import { NextCardBlock } from '../src/features/loyalty/NextCardBlock';
import { DrinkCard } from '../src/features/loyalty/DrinkCard';
import { useCardRedeem } from '../src/features/loyalty/useCardRedeem';
import { drinkCardView } from '../src/features/loyalty/extras';
import { RewardTiles } from '../src/features/loyalty/RewardTiles';
import { useBack, useReturnTo } from '../src/navigation/back';
import {
  LEDGER_KIND_KEYS,
  rewardName,
  signedPoints,
  tierName,
} from '../src/features/loyalty/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { usePullBall } from '../src/components/PullBall';
import { radius, space, useTheme } from '../src/theme';
import { Card, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ConfirmAlert, useToast } from '../src/components/overlays';

/**
 * Points and rewards (loyalty plan §5.1; build contracts §1.3 `my_loyalty`), in the order a guest
 * asks about them: the balance (a number: the card is the Club tab's), the way to the next card
 * and what that card gives (the drink card's stamps between them since 0445), the rewards the
 * points reach, every card from the base up, and the last 50 ledger rows. No deals here (Majed,
 * 2026-11-15: "strictly rewards and the upcoming cards"): they live on the Club tab.
 *
 * A ready reward is redeemed here (0415, Majed 2026-11-13): Redeem, the phone's own alert to
 * confirm, and the points leave at once for a QR of that one reward (app/reward-voucher.tsx) that
 * the cashier scans within 15 minutes. Codes not yet collected head the screen ("Ready to
 * collect"), so a guest who closed one finds it again. While the owner has loyalty switched off (`enabled` false, L-1) the
 * screen says so and offers nothing.
 */
function LoyaltyScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const returnTo = useReturnTo();
  const back = useBack({ pathname: '/club', params: { show: 'card' } });
  // The member card is the Club tab's. Opened from there, it is the screen underneath, so the
  // button goes back to it; from anywhere else (Profile) it switches to that tab on the card.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const showCard = () =>
    from === 'club'
      ? back()
      : returnTo({ pathname: '/club', params: { show: 'card' } }, '(tabs)');
  // 2026-11-15: the free drink's Redeem; once it holds, the member card is where the cashier scans.
  const cardRedeem = useCardRedeem(showCard);
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const member = !!session && !session.user.is_anonymous;
  const mine = useMyLoyalty(member);
  // 0415: the rewards redeemed here and not yet collected.
  const vouchers = useMyRewardVouchers(member);
  // 0445: the drink card, shown under the points while the owner has it on.
  const extras = useMyCardExtras(member && mine.data?.enabled === true);
  const toast = useToast();
  const refetchMine = mine.refetch;
  const refetchVouchers = vouchers.refetch;
  const refetchExtras = extras.refetch;
  const pull = usePullRefresh(() =>
    Promise.all([refetchMine(), refetchVouchers(), refetchExtras()]),
  );
  const ball = usePullBall(pull);
  const tz = useVenueSettings().data?.timezone ?? DEFAULT_TZ;
  // 0415: rewards redeemed here, and the one being confirmed.
  const router = useRouter();
  const redeem = useRedeemReward();
  const [confirming, setConfirming] = useState<{ id: string; name: string; points: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const waiting = vouchers.data ? activeVouchers(vouchers.data, vouchers.dataUpdatedAt || now, now) : [];
  // The strip's minutes move only while it has something to count.
  const counting = waiting.length > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  const openVoucher = (id: string) => router.push({ pathname: '/reward-voucher', params: { id } });
  const confirmRedeem = () => {
    const c = confirming;
    setConfirming(null);
    if (!c || redeem.isPending) return;
    redeem.mutate(c.id, {
      onSuccess: (v) => openVoucher(v.id),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };

  const points = (n: number) => isolateLtr(formatNumber(n, locale));

  const body = (() => {
    if (mine.isPending) return <SkeletonList rows={3} height={96} />;
    if (mine.isError || !mine.data) {
      return (
        <ErrorState
          testID="loyalty.error"
          title={t('loyalty.guest.home.error')}
          message={t(mapErrorToKey(mine.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void mine.refetch()}
          busy={mine.isRefetching}
        />
      );
    }
    const l = mine.data;
    if (!l.enabled) {
      return (
        <EmptyState
          testID="loyalty.off"
          title={t('loyalty.guest.home.title')}
          message={t('loyalty.guest.off')}
        />
      );
    }
    const lineStyle = {
      fontFamily: fonts.body600,
      fontSize: 13,
      lineHeight: 19,
      color: colors.mut,
    } as const;
    // How far the balance is to the smallest use at the cashier; no bar when there is no minimum.
    // 0403: the smallest use only means something while points can be spent as money off; with
    // rewards only (the default), the reward rings below show what the balance reaches.
    const min = l.points_off_enabled ? l.min_redeem_points : 0;
    const usable = min > 0 ? Math.min(1, l.balance / min) : 1;
    return (
      <View style={{ flex: 1 }} {...ball.wrapHandlers}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
        onScroll={ball.onScroll}
        bounces={ball.bounces}
        scrollEventThrottle={16}
        refreshControl={ball.refreshControl}
      >
        {/* 0. Ready to collect (0415): rewards redeemed here and not yet scanned, soonest to end
            first. Green, as everything ready on this screen is. */}
        {waiting.length > 0 ? (
          <View testID="loyalty.vouchers" style={{ gap: 7 }}>
            <MicroLabel>{t('loyalty.guest.voucher.readyTitle')}</MicroLabel>
            {waiting.map((v) => (
              <Pressable
                key={v.id}
                testID={`loyalty.voucher.${v.id}`}
                accessibilityRole="button"
                onPress={() => openVoucher(v.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingVertical: 12,
                  paddingHorizontal: space.m,
                  borderRadius: radius.card,
                  borderWidth: 1,
                  borderColor: colors.gstrong,
                  backgroundColor: colors.gtint,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z"
                    stroke={colors.ink}
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                  />
                </Svg>
                <Text style={{ flex: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
                  {locale === 'ar' ? v.name_ar : v.name_en}
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.display800,
                    fontSize: 13,
                    color: colors.gtext,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {t('loyalty.guest.voucher.readyRow', { time: isolateLtr(formatCountdown(v.msLeft)) })}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* 1. The points, as a number (Majed, 2026-11-13): the card itself is the Club tab's, and
            this screen does not draw it again. The tier beside it, in its own colour (0376). */}
        <View testID="loyalty.points" style={{ gap: 2 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space.sm,
            }}
          >
            <MicroLabel>{t('loyalty.guest.home.balance')}</MicroLabel>
            {l.tier ? (
              <View
                testID="loyalty.tier"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  borderRadius: radius.pill,
                  backgroundColor: colors.tint,
                  paddingVertical: 5,
                  paddingStart: 7,
                  paddingEnd: 11,
                }}
              >
                {/* Ringed, so a black or white tier's dot holds on either page. */}
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: TIER_SWATCH[l.tier.color],
                    borderWidth: 1,
                    borderColor: colors.line,
                  }}
                />
                <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.ink }}>
                  {tierName(l.tier, locale)}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            testID="loyalty.balance"
            style={{
              fontFamily: fonts.display900,
              fontSize: 56,
              lineHeight: 64,
              color: colors.ink,
              fontVariant: ['tabular-nums'],
            }}
          >
            {points(l.balance)}
          </Text>
        </View>
        <View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: space.s,
              marginBottom: min > 0 ? 6 : 0,
            }}
          >
            <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 12, color: colors.mut }}>
              {t(l.points_off_enabled ? 'loyalty.guest.home.useAtCashier' : 'loyalty.guest.home.rewardsAtCashier')}
            </Text>
            {min > 0 ? (
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 12,
                  color: colors.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {points(Math.min(l.balance, min))} / {points(min)}
              </Text>
            ) : null}
          </View>
          {min > 0 ? (
            <View
              style={{
                height: 9,
                borderRadius: 5,
                backgroundColor: colors.line,
                overflow: 'hidden',
              }}
            >
              <View
                testID="loyalty.use-progress"
                style={{
                  height: 9,
                  width: `${Math.round(usable * 100)}%`,
                  borderRadius: 5,
                  backgroundColor: colors.gstrong,
                }}
              />
            </View>
          ) : null}
        </View>

        {/* 1b. The drink card (0445): the stamps to a free drink, or that the next one is on us. */}
        {drinkCardView(extras.data?.stamps) ? (
          <View style={{ marginTop: space.s }}>
            <DrinkCard
              testID="loyalty.drink-card"
              stamps={extras.data?.stamps}
              tz={tz}
              busy={cardRedeem.drinkBusy}
              onRedeem={cardRedeem.redeemDrink}
              onShowCode={showCard}
            />
          </View>
        ) : null}

        {/* 2. The way to the next card in that card's own colour, and every card under it with
            what each gives, the next one in full (0410; one part since 2026-11-15). */}
        <NextCardBlock
          testID={l.next_tier ? 'loyalty.next-card' : 'loyalty.top-card'}
          route="loyalty"
          loyalty={l}
        />

        {/* 3. Rewards (0415; "AD-1", Majed 2026-11-16): two a row, cheapest first, the "You"
            line between what the balance covers and what is next, each tile filling with green
            as the points come in. A ready one is redeemed here for a code the cashier scans. */}
        <View style={{ gap: 7, marginTop: space.s }}>
          <MicroLabel>{t('loyalty.guest.rewards.title')}</MicroLabel>
          <RewardTiles
            rewards={l.rewards}
            balance={l.balance}
            busyId={redeem.isPending ? (redeem.variables ?? null) : null}
            disabled={redeem.isPending}
            onRedeem={(r) => setConfirming({ id: r.id, name: rewardName(r, locale), points: r.cost_points })}
          />
          {l.rewards.length > 0 ? <Hint>{t('loyalty.guest.rewards.note')}</Hint> : null}
          <ConfirmAlert
            visible={confirming !== null}
            title={t('loyalty.guest.voucher.confirmTitle', { reward: confirming?.name ?? '' })}
            body={t('loyalty.guest.voucher.confirmBody', { points: points(confirming?.points ?? 0) })}
            confirmLabel={t('loyalty.guest.voucher.confirm')}
            onConfirm={confirmRedeem}
            onDismiss={() => setConfirming(null)}
          />
        </View>

        {/* 5. History: the 50 newest ledger rows, newest first, as the server sends them. With
            none yet, the three steps that start it. */}
        <View style={{ gap: 7, marginTop: space.s }}>
          <MicroLabel>
            {l.history.length === 0
              ? t('loyalty.guest.home.earnTitle')
              : t('loyalty.guest.home.historyTitle')}
          </MicroLabel>
          {l.history.length === 0 ? (
            <View testID="loyalty.history-empty">
            <Card style={{ gap: space.sm, padding: space.m }}>
              {(['earn1', 'earn2', 'earn3'] as const).map((k, i) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: colors.tint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: fonts.display800, fontSize: 11, color: colors.ink }}>
                      {formatNumber(i + 1, locale)}
                    </Text>
                  </View>
                  <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 12.5, color: colors.ink }}>
                    {t(`loyalty.guest.home.${k}`)}
                  </Text>
                </View>
              ))}
            </Card>
            </View>
          ) : (
            <Card style={{ paddingVertical: 4, paddingHorizontal: space.m }}>
              {l.history.map((row, i) => (
                <View
                  key={row.id}
                  testID={`loyalty.history.${row.id}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s,
                    paddingVertical: 9,
                    borderBottomWidth: i === l.history.length - 1 ? 0 : 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
                      {t(LEDGER_KIND_KEYS[row.kind])}
                    </Text>
                    {row.created_at ? (
                      <Text style={[lineStyle, { fontSize: 12, fontFamily: fonts.body400 }]}>
                        {formatDate(new Date(row.created_at), locale, tz)}
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    style={{
                      fontFamily: fonts.display800,
                      fontSize: 15,
                      color: row.delta >= 0 ? colors.gstrong : colors.redtext,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {isolateLtr(signedPoints(row.delta, (n) => formatNumber(n, locale)))}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
      {ball.overlay}
      </View>
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('loyalty.guest.home.title') }} />
      {body}
    </Screen>
  );
}

/** Signed-in only: points belong to an account (RequireSession). */
export default function GuardedLoyaltyScreen() {
  return (
    <RequireSession>
      <LoyaltyScreen />
    </RequireSession>
  );
}
