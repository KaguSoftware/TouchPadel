import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, formatMonthLong } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { MicroLabel, Screen } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { CheckIcon } from '../../src/components/icons';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../../src/features/staff/keys';
import { Tag } from '../../src/features/staff/checklists/parts';
import { fetchMyRewards, type MyReward } from '../../src/features/staff/rewards/api';
import { RewardTrack } from '../../src/features/staff/rewards/RewardTrack';
import { trackModel } from '../../src/features/staff/rewards/logic';
import { usePullRefresh } from '../../src/lib/usePullRefresh';

/**
 * The person's own rewards (0332), opened from the track on Today: the track,
 * each reward this month with what is left, last month's result (with the wage
 * month each bonus is paid in, 0333), and how the count works. Only the caller's
 * own figures; nothing here names anybody else.
 */

const T = 'staff-rewards';

const dayOf = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** One reward as a row: the target, the bonus and prize, and where it stands. */
function RewardRow({
  testID,
  reward,
  reached,
  toGo,
  payMonth,
  last,
}: {
  testID: string;
  reward: Pick<MyReward, 'target' | 'reward_iqd' | 'prize'>;
  reached: boolean;
  /** Orders left; null on last month's list, where every row was reached. */
  toGo: number | null;
  /**
   * Last month's rows only: the wage month the bonus is added to, once the
   * server wrote it down. A prize-only row has no money to add and says nothing.
   */
  payMonth?: string | null;
  last: boolean;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const orders = (n: number) => countPhrase('staff.rewards.orders', n, locale);
  const what = [reward.reward_iqd > 0 ? formatIQD(reward.reward_iqd, locale) : null, reward.prize]
    .filter(Boolean)
    .join(' · ');
  const inWage =
    reward.reward_iqd > 0 && payMonth
      ? t('staff.rewards.mine.inWage', { month: formatMonthLong(dayOf(payMonth), locale) })
      : null;
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: 12,
        paddingHorizontal: space.l,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: reached ? colors.gtint : colors.sub,
          borderWidth: 1,
          borderColor: reached ? colors.gline : colors.line,
        }}
      >
        {reached ? <CheckIcon size={12} color={colors.gstrong} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink }}>
          {t('staff.rewards.mine.at', { orders: orders(reward.target) })}
        </Text>
        <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.gtext }}>{what}</Text>
        {inWage ? (
          <Text
            testID={`${testID}.in-wage`}
            style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}
          >
            {inWage}
          </Text>
        ) : null}
      </View>
      {reached ? (
        <Tag label={t('staff.rewards.mine.reached')} tone="good" />
      ) : toGo !== null ? (
        <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
          {t('staff.rewards.mine.toGo', { orders: orders(toGo) })}
        </Text>
      ) : null}
    </View>
  );
}

function List({ testID, children }: { testID: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function MyRewardsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { status, venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const query = useQuery({
    queryKey: staffKeys.myRewards(venue),
    queryFn: () => fetchMyRewards(venue),
    enabled: venueId !== null,
  });
  const pull = usePullRefresh(async () => {
    await query.refetch();
  });
  if (status.kind !== 'staff') return null;
  const data = query.data;
  const model = data ? trackModel(data.rewards, data.count) : null;
  const orders = (n: number) => countPhrase('staff.rewards.orders', n, locale);
  const nothing = data && data.rewards.length === 0 && data.last_month.reached.length === 0;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.rewards.mine.title') }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
      >
        {query.isPending && venueId !== null ? <SkeletonList rows={3} height={72} /> : null}
        {query.isError ? (
          <ErrorState
            testID={`${T}.error`}
            title={t('errors.loadFailedTitle')}
            message={t('staff.rewards.mine.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {nothing ? (
          <EmptyState testID={`${T}.empty`} title={t('staff.rewards.mine.empty')} />
        ) : null}

        {data && model && data.rewards.length > 0 ? (
          <>
            <RewardTrack
              testID={`${T}.track`}
              data={data}
              staffId={status.staff.id}
              venueId={venue}
            />
            <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
              {t('staff.rewards.mine.thisMonth')}
            </MicroLabel>
            <List testID={`${T}.this-month`}>
              {model.points.map((p, i) => (
                <RewardRow
                  key={p.reward.id}
                  testID={`${T}.reward.${p.reward.id}`}
                  reward={p.reward}
                  reached={p.reached}
                  toGo={p.reached ? null : p.reward.target - data.count}
                  last={i === model.points.length - 1}
                />
              ))}
            </List>
          </>
        ) : null}

        {data && (data.last_month.count > 0 || data.last_month.reached.length > 0) ? (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                paddingStart: 4,
                paddingEnd: 4,
                marginTop: space.s,
              }}
            >
              <MicroLabel>{t('staff.rewards.mine.lastMonth')}</MicroLabel>
              <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
                {t('staff.rewards.mine.lastMonthCount', { orders: orders(data.last_month.count) })}
              </Text>
            </View>
            {data.last_month.reached.length > 0 ? (
              <List testID={`${T}.last-month`}>
                {data.last_month.reached.map((r, i) => (
                  <RewardRow
                    key={r.target}
                    testID={`${T}.last-month.${r.target}`}
                    reward={r}
                    reached
                    toGo={null}
                    payMonth={r.pay_month}
                    last={i === data.last_month.reached.length - 1}
                  />
                ))}
              </List>
            ) : (
              <Text
                style={{
                  paddingStart: 4,
                  fontFamily: fonts.body400,
                  fontSize: 13,
                  color: colors.mut,
                }}
              >
                {t('staff.rewards.mine.lastMonthNone')}
              </Text>
            )}
          </>
        ) : null}

        {/* How the count works: always here, so the number is never a mystery. */}
        <View
          testID={`${T}.how`}
          style={{ gap: 4, paddingStart: 4, paddingEnd: 4, marginTop: space.m }}
        >
          <MicroLabel>{t('staff.rewards.mine.howTitle')}</MicroLabel>
          <Text
            style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}
          >
            {t('staff.rewards.mine.how')}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function StaffRewardsRoute() {
  return (
    <RequireStaff>
      <MyRewardsScreen />
    </RequireStaff>
  );
}
