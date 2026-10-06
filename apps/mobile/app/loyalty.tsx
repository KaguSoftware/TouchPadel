import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, formatIQD, formatNumber, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useAuth } from '../src/features/auth/context';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useVenueSettings } from '../src/features/availability/hooks';
import { DEFAULT_TZ } from '../src/features/availability/assemble';
import { useMyLoyalty } from '../src/features/loyalty/hooks';
import {
  LEDGER_KIND_KEYS,
  rewardName,
  signedPoints,
  tierName,
  tierProgress,
} from '../src/features/loyalty/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { radius, space, useTheme } from '../src/theme';
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
  const router = useRouter();
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
        {/* 1. The balance, and the one action: the card the till scans. */}
        <Card>
          <MicroLabel>{t('loyalty.guest.home.balance')}</MicroLabel>
          <Text
            testID="loyalty.balance"
            style={{
              marginTop: 4,
              fontFamily: fonts.display900,
              fontSize: 40,
              color: colors.ink,
              fontVariant: ['tabular-nums'],
            }}
          >
            {points(l.balance)}
          </Text>
          {l.balance > 0 && l.point_value_iqd > 0 ? (
            <Text style={lineStyle}>
              {t('loyalty.guest.home.worth', {
                amount: isolate(formatIQD(l.balance * l.point_value_iqd, locale)),
              })}
            </Text>
          ) : null}
          {l.min_redeem_points > 0 ? (
            <Text style={[lineStyle, { marginTop: 2, fontFamily: fonts.body400 }]}>
              {t('loyalty.guest.home.minRedeem', { points: points(l.min_redeem_points) })}
            </Text>
          ) : null}
          <Button
            testID="loyalty.show-card"
            label={t('loyalty.guest.home.showCard')}
            variant="primary"
            onPress={() => router.push('/member-card')}
            style={{ marginTop: space.m }}
          />
        </Card>

        {/* 2. The tier, and how far the next one is (points from the last 12 months). */}
        {l.tier ? (
          <Card>
            <MicroLabel>{t('loyalty.guest.tier.label')}</MicroLabel>
            <Text
              testID="loyalty.tier"
              style={{
                marginTop: 4,
                fontFamily: fonts.display800,
                fontSize: 18,
                color: colors.ink,
              }}
            >
              {tierName(l.tier, locale)}
            </Text>
            {progress && l.next_tier ? (
              <>
                <View
                  style={{
                    marginTop: space.sm,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: colors.line,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    testID="loyalty.tier-progress"
                    style={{
                      height: 6,
                      width: `${Math.round(progress.fraction * 100)}%`,
                      backgroundColor: colors.gstrong,
                    }}
                  />
                </View>
                <Text style={[lineStyle, { marginTop: 6 }]}>
                  {t('loyalty.guest.tier.next', { tier: tierName(l.next_tier, locale) })}
                </Text>
                <Text style={[lineStyle, { fontFamily: fonts.body400 }]}>
                  {t('loyalty.guest.tier.needed', { points: points(progress.remaining) })}
                </Text>
              </>
            ) : (
              <Text style={[lineStyle, { marginTop: 6 }]}>{t('loyalty.guest.tier.top')}</Text>
            )}
            <Hint>{t('loyalty.guest.tier.window')}</Hint>
          </Card>
        ) : null}

        {/* 3. Rewards: shown, never redeemed here; the till does that against the card. */}
        <View style={{ gap: 7, marginTop: 4 }}>
          <MicroLabel>{t('loyalty.guest.rewards.title')}</MicroLabel>
          {l.rewards.length === 0 ? (
            <Text style={lineStyle}>{t('loyalty.guest.rewards.empty')}</Text>
          ) : (
            l.rewards.map((r) => (
              <View
                key={r.id}
                testID={`loyalty.reward.${r.id}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.cell,
                  paddingStart: space.sm,
                  paddingEnd: space.sm,
                  paddingTop: 12,
                  paddingBottom: 12,
                }}
              >
                <Text
                  style={{ flex: 1, fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}
                >
                  {rewardName(r, locale)}
                </Text>
                <Text style={[lineStyle, { fontVariant: ['tabular-nums'] }]}>
                  {t('loyalty.guest.rewards.cost', { points: points(r.cost_points) })}
                </Text>
              </View>
            ))
          )}
          {l.rewards.length > 0 ? <Hint>{t('loyalty.guest.rewards.note')}</Hint> : null}
        </View>

        {/* 4. History: the 50 newest ledger rows, newest first, as the server sends them. */}
        <View style={{ gap: 7, marginTop: 4 }}>
          <MicroLabel>{t('loyalty.guest.home.historyTitle')}</MicroLabel>
          {l.history.length === 0 ? (
            <Text testID="loyalty.history-empty" style={lineStyle}>
              {t('loyalty.guest.home.historyEmpty')}
            </Text>
          ) : (
            l.history.map((row) => (
              <View
                key={row.id}
                testID={`loyalty.history.${row.id}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.cell,
                  paddingStart: space.sm,
                  paddingEnd: space.sm,
                  paddingTop: 10,
                  paddingBottom: 10,
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
            ))
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
