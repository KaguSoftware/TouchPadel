import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useVenueSettings } from '../src/features/availability/hooks';
import { DEFAULT_TZ } from '../src/features/availability/assemble';
import { useMyLoyalty } from '../src/features/loyalty/hooks';
import { useBack, useReturnTo } from '../src/navigation/back';
import {
  LEDGER_KIND_KEYS,
  rewardName,
  signedPoints,
  tierName,
  tierProgress,
} from '../src/features/loyalty/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { brand, radius, space, useTheme, withAlpha } from '../src/theme';
import { BrandPattern } from '../src/components/BrandPattern';
import { Button, Card, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';

/**
 * Points and rewards (loyalty plan §5.1; build contracts §1.3 `my_loyalty`): the balance and what
 * it is worth, the tier with the way to the next one, the rewards the till can give, and the
 * last 50 ledger rows.
 *
 * Nothing is spent here: points and rewards are used at the till, by staff, against the member
 * card (L-5), so every reward reads "show at the till" and the one action is the card. While the
 * owner has loyalty switched off (`enabled` false, L-1) the screen says so and offers nothing.
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
  const mine = useMyLoyalty(!!session && !session.user.is_anonymous);
  const pull = usePullRefresh(mine.refetch);
  const tz = useVenueSettings().data?.timezone ?? DEFAULT_TZ;

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
    const progress = tierProgress(l);
    const lineStyle = {
      fontFamily: fonts.body600,
      fontSize: 13,
      lineHeight: 19,
      color: colors.mut,
    } as const;
    // How far the balance is to the smallest use at the cashier; no bar when there is no minimum.
    const min = l.min_redeem_points;
    const usable = min > 0 ? Math.min(1, l.balance / min) : 1;
    const onCard = brand.navyText;
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
        {/* 1. The points, the tier, and the one action: the card the till scans. It wears the
            member card's own navy, so the two read as one thing. */}
        <View
          style={{
            borderRadius: 22,
            overflow: 'hidden',
            padding: space.l,
            gap: space.sm,
            backgroundColor: brand.navy,
          }}
        >
          <LinearGradient
            colors={[brand.navy, brand.navyCard, brand.navyLine]}
            locations={[0, 0.55, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <BrandPattern opacity={0.16} />
          <LinearGradient
            colors={[withAlpha(brand.white, 0.1), withAlpha(brand.white, 0)]}
            locations={[0, 0.5]}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <MicroLabel style={{ color: onCard }}>{t('loyalty.guest.home.balance')}</MicroLabel>
            {l.tier ? (
              <View
                testID="loyalty.tier"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  borderRadius: radius.pill,
                  backgroundColor: withAlpha(brand.white, 0.14),
                  paddingVertical: 5,
                  paddingStart: 7,
                  paddingEnd: 11,
                }}
              >
                <View
                  style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: brand.green }}
                />
                <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: brand.white }}>
                  {tierName(l.tier, locale)}
                </Text>
              </View>
            ) : null}
          </View>
          <Text
            testID="loyalty.balance"
            style={{
              fontFamily: fonts.display900,
              fontSize: 68,
              lineHeight: 76,
              color: brand.white,
              fontVariant: ['tabular-nums'],
            }}
          >
            {points(l.balance)}
          </Text>
          <View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: space.s,
                marginBottom: 6,
              }}
            >
              <Text style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 12, color: onCard }}>
                {t('loyalty.guest.home.useAtCashier')}
              </Text>
              {min > 0 ? (
                <Text
                  style={{
                    fontFamily: fonts.display800,
                    fontSize: 12,
                    color: onCard,
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
                  backgroundColor: withAlpha(brand.white, 0.18),
                  overflow: 'hidden',
                }}
              >
                <View
                  testID="loyalty.use-progress"
                  style={{
                    height: 9,
                    width: `${Math.round(usable * 100)}%`,
                    borderRadius: 5,
                    backgroundColor: brand.green,
                  }}
                />
              </View>
            ) : null}
          </View>
          <Button
            testID="loyalty.show-card"
            label={t('loyalty.guest.home.showCard')}
            variant="primary"
            onPress={showCard}
            style={{ backgroundColor: brand.white }}
            labelColor={brand.navy}
            pressedBg="#E6E9F0"
          />
        </View>

        {/* 2. Where the tier stands, under the card (points from the last 12 months). */}
        {l.tier ? (
          <View style={{ gap: 2 }}>
            {progress && l.next_tier ? (
              <>
                <Text style={[lineStyle, { textAlign: 'center' }]}>
                  {t('loyalty.guest.tier.next', { tier: tierName(l.next_tier, locale) })}
                </Text>
                <Text style={[lineStyle, { textAlign: 'center', fontFamily: fonts.body400 }]}>
                  {t('loyalty.guest.tier.needed', { points: points(progress.remaining) })}
                </Text>
              </>
            ) : (
              <Text style={[lineStyle, { textAlign: 'center' }]}>
                {t('loyalty.guest.tier.top')} {t('loyalty.guest.tier.window')}
              </Text>
            )}
            {progress && l.next_tier ? (
              <Text style={[lineStyle, { textAlign: 'center', fontFamily: fonts.body400 }]}>
                {t('loyalty.guest.tier.window')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* 3. Rewards: shown, never redeemed here; the till does that against the card. */}
        <View style={{ gap: 7, marginTop: 4 }}>
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
                            d="M4 9h16v4H4zM6 13h12v7H6zM12 9v11M12 9c-2-4-6-3-5 0M12 9c2-4 6-3 5 0"
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
                    </View>
                  );
                })}
          </View>
          {l.rewards.length > 0 ? <Hint>{t('loyalty.guest.rewards.note')}</Hint> : null}
        </View>

        {/* 4. History: the 50 newest ledger rows, newest first, as the server sends them. With
            none yet, the three steps that start it. */}
        <View style={{ gap: 7, marginTop: 4 }}>
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
