import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, formatMonthYear, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Card, Hint, Screen } from '../src/components/ui';
import { FilterChip, ListHeading } from '../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { CalendarIcon, ReceiptIcon } from '../src/components/icons';
import { StatementCard } from '../src/components/coachMode';
import { RequireCoach } from '../src/features/coach/RequireCoach';
import { useCoachStatus } from '../src/features/coach/CoachStatusProvider';
import { useMyCoachStatements } from '../src/features/coach/hooks';
import { coachErrorText } from '../src/features/coach/errors';
import { pickName, type CoachMe, type CoachMeRetired } from '../src/features/coach/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * The coach's statements (docs/design/coaching/guest.md §4.13.7; C-12, CM-12):
 * approved and paid statements only, one card per branch for the month picked
 * (the last twelve months with one, newest first), with each lesson's line.
 * The money is the server's; the phone computes none of it. "This month so
 * far" is the server's estimate and not a statement; it is not shown to a
 * retired coach, for whom this is the one coach-mode screen (C-25, R45).
 */
function CoachStatementsScreen() {
  const { status } = useCoachStatus();
  if (status.kind !== 'coach' && status.kind !== 'retired') return null;
  return <CoachStatementsBody coach={status.coach} />;
}

/** 'YYYY-MM-01' as "September 2026", read at noon UTC so no zone moves the month. */
function monthLabel(month: string, locale: 'en' | 'ar'): string {
  return formatMonthYear(new Date(`${month}T12:00:00Z`), locale, 'UTC');
}

function CoachStatementsBody({ coach }: { coach: CoachMe | CoachMeRetired }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const retired = coach.status === 'retired';

  const summaries = useMyCoachStatements(null);
  const months = summaries.data?.months ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? months[0] ?? null;
  const detail = useMyCoachStatements(month, month !== null);
  const pull = usePullRefresh(async () => {
    await Promise.all([summaries.refetch(), month ? detail.refetch() : Promise.resolve()]);
  });

  const statements =
    detail.data?.statements ?? (summaries.data?.statements ?? []).filter((s) => s.month === month);
  const branchCount = new Set(statements.map((s) => s.venueId)).size;
  const estimates = retired ? [] : (summaries.data?.currentMonth ?? []);
  const branchName = (venueId: string) => {
    const b =
      coach.status === 'retired' ? undefined : coach.branches.find((x) => x.venueId === venueId);
    return b ? pickName(b.nameEn, b.nameAr, locale) : null;
  };
  const money = (n: number) => isolateLtr(formatIQD(n, locale));
  const empty = summaries.data !== undefined && months.length === 0 && estimates.length === 0;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.coach.statements.title') }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.sm,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
      >
        <ListHeading icon={ReceiptIcon} label={t('coaching.coach.statements.title')} />
        <ScrollView
          testID="coach-mode-statements.month"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 7, paddingTop: 2, paddingBottom: 2 }}
        >
          {months.map((m) => (
            <FilterChip
              key={m}
              testID={`coach-mode-statements.month.${m.slice(0, 7)}`}
              icon={CalendarIcon}
              label={monthLabel(m, locale)}
              selected={m === month}
              onPress={() => setPicked(m)}
            />
          ))}
        </ScrollView>

        {!summaries.data ? (
          summaries.isError ? (
            <ErrorState
              testID="coach-mode-statements.error"
              title={t('errors.loadFailedTitle')}
              message={coachErrorText(summaries.error, t, { locale })}
              retryLabel={t('common.retry')}
              onRetry={() => void summaries.refetch()}
              busy={summaries.isRefetching}
            />
          ) : (
            <SkeletonList rows={2} height={160} />
          )
        ) : null}

        {estimates.map((e) => {
          const name = branchName(e.venueId);
          return (
            <Card key={`estimate.${e.venueId}`} style={{ gap: 4 }}>
              <Text style={{ fontFamily: fonts.body800, fontSize: 13.5, color: colors.ink }}>
                {t('coaching.coach.statements.thisMonth')}
              </Text>
              {name && estimates.length > 1 ? (
                <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
                  {isolate(name)}
                </Text>
              ) : null}
              <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut2 }}>
                {countPhrase('coaching.coach.count.lessons', e.lessons, locale)}
              </Text>
              <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.mut2 }}>
                {t('coaching.coach.statements.collected', { amount: money(e.collectedIqd) })}
              </Text>
              <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>
                {t('coaching.coach.statements.estimateShare', { amount: money(e.coachIqd) })}
              </Text>
            </Card>
          );
        })}

        {month ? (
          <View style={{ gap: space.sm }}>
            {statements.map((s) => (
              <StatementCard
                key={s.id}
                testID={`coach-mode-statements.statement.${s.id}`}
                linesTestID="coach-mode-statements.line"
                statement={s}
                showBranch={branchCount > 1 || statements.length > 1}
              />
            ))}
            {detail.isPending && statements.length === 0 ? (
              <SkeletonList rows={1} height={160} />
            ) : null}
          </View>
        ) : null}

        {empty ? (
          <EmptyState
            testID="coach-mode-statements.empty"
            title={t('coaching.coach.statements.emptyTitle')}
            message={t('coaching.coach.statements.empty')}
          />
        ) : null}

        <Hint>{t('coaching.coach.statements.note')}</Hint>
      </ScrollView>
    </Screen>
  );
}

export default function CoachModeStatementsRoute() {
  return (
    <RequireCoach allowRetired>
      <CoachStatementsScreen />
    </RequireCoach>
  );
}
