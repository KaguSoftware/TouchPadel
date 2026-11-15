import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
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
  useMyDeals,
  useMyLoyalty,
  useMyRewardVouchers,
  usePickDeal,
  useRedeemReward,
} from '../src/features/loyalty/hooks';
import { activeVouchers, formatCountdown } from '../src/features/loyalty/vouchers';
import { DealsSection } from '../src/features/loyalty/DealCards';
import { NextCardBlock } from '../src/features/loyalty/NextCardBlock';
import { TierLadder } from '../src/features/loyalty/TierLadder';
import { useBack, useReturnTo } from '../src/navigation/back';
import {
  LEDGER_KIND_KEYS,
  rewardName,
  signedPoints,
  tierName,
} from '../src/features/loyalty/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { radius, space, useTheme } from '../src/theme';
import { Button, Card, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ConfirmAlert, useToast } from '../src/components/overlays';

/**
 * Points and rewards (loyalty plan §5.1; build contracts §1.3 `my_loyalty`; 0410 `my_deals`), in
 * the order a guest asks about them: the balance (a number: the card is the Club tab's), the way to
 * the next card and what that card gives, the deals to use at the cashier, the rewards the points
 * reach, every card from the base up, and the last 50 ledger rows.
 *
 * A ready reward is redeemed here (0415, Majed 2026-11-13): Redeem, the phone's own alert to
 * confirm, and the points leave at once for a QR of that one reward (app/reward-voucher.tsx) that
 * the cashier scans within 15 minutes. Codes not yet collected head the screen ("Ready to
 * collect"), so a guest who closed one finds it again. A DEAL (0410) is picked here too:
 * "Use at the cashier" picks it (`pick_deal`) and takes them to their member card, where the
 * cashier's scan applies it. While the owner has loyalty switched off (`enabled` false, L-1) the
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
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const member = !!session && !session.user.is_anonymous;
  const mine = useMyLoyalty(member);
  // 0410. A server without deals, or a read that failed, is simply no deals to show.
  const deals = useMyDeals(member);
  // 0415: the rewards redeemed here and not yet collected.
  const vouchers = useMyRewardVouchers(member);
  const pick = usePickDeal();
  const toast = useToast();
  const refetchMine = mine.refetch;
  const refetchDeals = deals.refetch;
  const refetchVouchers = vouchers.refetch;
  const pull = usePullRefresh(() => Promise.all([refetchMine(), refetchDeals(), refetchVouchers()]));
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

  // "Use at the cashier": the pick lands on the member card, so that is where the guest goes.
  const pickForCashier = (id: string) => {
    if (pick.isPending) return;
    pick.mutate(id, {
      onSuccess: showCard,
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };
  const unpick = () => {
    if (pick.isPending) return;
    pick.mutate(null, {
      onSuccess: () => toast(t('loyalty.guest.deals.cleared'), 'info'),
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
      <ScrollView
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
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

        {/* 2. The way to the next card and what it gives (0410), in that card's own colour. */}
        <NextCardBlock testID={l.next_tier ? 'loyalty.next-card' : 'loyalty.top-card'} loyalty={l} />

        {/* 3. Deals (0410): picked here, applied by the cashier's scan of the member card. */}
        <DealsSection
          testID="loyalty"
          deals={deals.data}
          points12m={l.points_12m}
          tz={tz}
          pending={pick.isPending ? pick.variables : undefined}
          onUse={pickForCashier}
          onShowCard={showCard}
          onClear={unpick}
        />

        {/* 4. Rewards: a ready one is redeemed here for a code the cashier scans (0415). */}
        <View style={{ gap: 7, marginTop: space.s }}>
          <MicroLabel>{t('loyalty.guest.rewards.title')}</MicroLabel>
          <View
            accessibilityLabel={l.rewards.length === 0 ? t('loyalty.guest.rewards.empty') : undefined}
            style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm }}
          >
            {l.rewards.length === 0
              ? [0, 1].map((i) => (
                  <View
                    key={i}
                    testID={`loyalty.reward-soon.${i}`}
                    style={{
                      width: '48%',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 14,
                      paddingHorizontal: 8,
                      borderRadius: radius.card,
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: colors.line,
                    }}
                  >
                    <View
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: 30,
                        borderWidth: 5,
                        borderColor: colors.line,
                      }}
                    />
                    <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                      {t('loyalty.guest.rewards.soon')}
                    </Text>
                  </View>
                ))
              : l.rewards.map((r) => {
                  const fraction = r.cost_points > 0 ? Math.min(1, l.balance / r.cost_points) : 1;
                  const ready = fraction >= 1;
                  const stroke = ready ? colors.gstrong : colors.blue;
                  return (
                    <View
                      key={r.id}
                      testID={`loyalty.reward.${r.id}`}
                      style={{
                        width: '48%',
                        alignItems: 'center',
                        gap: 7,
                        paddingVertical: 14,
                        paddingHorizontal: 8,
                        borderRadius: radius.card,
                        borderWidth: 1,
                        borderColor: ready ? colors.gstrong : colors.line,
                        backgroundColor: ready ? colors.gtint : colors.card,
                      }}
                    >
                      <View style={{ width: 60, height: 60, alignItems: 'center', justifyContent: 'center' }}>
                        <Svg width={60} height={60} style={{ position: 'absolute' }}>
                          <Circle cx={30} cy={30} r={27.5} stroke={colors.line} strokeWidth={5} fill="none" />
                          {fraction > 0 ? (
                            <Circle
                              cx={30}
                              cy={30}
                              r={27.5}
                              stroke={stroke}
                              strokeWidth={5}
                              fill="none"
                              strokeLinecap="round"
                              strokeDasharray={`${2 * Math.PI * 27.5 * fraction} ${2 * Math.PI * 27.5}`}
                              rotation={-90}
                              origin="30, 30"
                            />
                          ) : null}
                        </Svg>
                        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                          <Path
                            d={
                              r.kind === 'court_hour'
                                ? // 0403: a free court hour: a court seen from above, net across the middle.
                                  'M5 3h14v18H5zM5 12h14M9 3v4.5M15 3v4.5M9 16.5V21M15 16.5V21'
                                : 'M4 9h16v4H4zM6 13h12v7H6zM12 9v11M12 9c-2-4-6-3-5 0M12 9c2-4 6-3 5 0'
                            }
                            stroke={colors.ink}
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </Svg>
                      </View>
                      <Text
                        style={{
                          fontFamily: fonts.body700,
                          fontSize: 12,
                          lineHeight: 15,
                          textAlign: 'center',
                          color: colors.ink,
                        }}
                      >
                        {rewardName(r, locale)}
                      </Text>
                      <Text
                        style={{
                          fontFamily: fonts.display800,
                          fontSize: 13,
                          color: colors.ink,
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {t('loyalty.guest.rewards.pts', { points: points(r.cost_points) })}
                      </Text>
                      <Text
                        style={{
                          fontFamily: ready ? fonts.body700 : fonts.body400,
                          fontSize: 11,
                          color: ready ? colors.gtext : colors.mut,
                        }}
                      >
                        {ready
                          ? t('loyalty.guest.rewards.ready')
                          : t('loyalty.guest.rewards.toGo', {
                              points: points(r.cost_points - l.balance),
                            })}
                      </Text>
                      {ready ? (
                        <Button
                          testID={`loyalty.reward.${r.id}.redeem`}
                          size="compact"
                          label={t('loyalty.guest.rewards.redeem')}
                          busy={redeem.isPending && redeem.variables === r.id}
                          disabled={redeem.isPending}
                          style={{ alignSelf: 'stretch', marginTop: 2 }}
                          onPress={() =>
                            setConfirming({ id: r.id, name: rewardName(r, locale), points: r.cost_points })
                          }
                        />
                      ) : null}
                    </View>
                  );
                })}
          </View>
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

        {/* 5. The cards (0410): every tier from the base up, the member's own marked. */}
        <TierLadder testID="loyalty" loyalty={l} />

        {/* 6. History: the 50 newest ledger rows, newest first, as the server sends them. With
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
