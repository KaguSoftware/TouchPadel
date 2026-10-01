import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  countPhrase,
  formatDate,
  formatIQD,
  formatTime,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { BranchPicker } from '../src/features/availability/BranchPicker';
import { DEFAULT_TZ } from '../src/features/availability/assemble';
import { useCoachingBranch, useCoachingPublic } from '../src/features/coaching/hooks';
import {
  classRows,
  classTarget,
  displayCoachName,
  pick,
  type ClassFilter,
  type ClassRowData,
} from '../src/features/coaching/logic';
import { lessonErrorText } from '../src/features/coaching/errors';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { space, useTheme } from '../src/theme';
import { Screen, SegmentedControl } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { MatchNotice } from '../src/components/match';
import { ClassRow } from '../src/components/coaching';

/**
 * Group sessions and courses with places (docs/design/coaching/guest.md
 * §4.8.4) at the guest's branch, soonest first, with the coach and the lesson
 * type joined in. A course reads "Starts {date}" before its first session and
 * "Next {date} · {n} of {total}" once running. Public; switched off at the
 * branch, no work and the notice.
 */
export default function ClassesScreen() {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { guest, settings, on } = useCoachingBranch();
  const venueId = guest.venueId;
  const pub = useCoachingPublic(on ? venueId : null);
  const pull = usePullRefresh(pub.refetch);
  const [filter, setFilter] = useState<ClassFilter>('all');
  const tz = settings.data?.timezone ?? DEFAULT_TZ;

  const rows = useMemo(
    () => (pub.data && venueId && !pub.data.off ? classRows(pub.data, venueId, filter) : []),
    [pub.data, venueId, filter],
  );

  const whenOf = (r: ClassRowData): string => {
    const start = new Date(r.session.startAt);
    const day = `${formatWeekdayShort(start, locale, tz)} ${formatDate(start, locale, tz)}`;
    const s = r.session;
    if (s.kind === 'course' && s.sessionsCount !== null && s.sessionsLeft !== null) {
      if (s.sessionsLeft >= s.sessionsCount)
        return t('coaching.guest.classes.starts', { date: day });
      return t('coaching.guest.classes.next', {
        date: `${day} · ${formatTime(start, locale, tz)}`,
        n: isolateLtr(String(s.sessionsCount - s.sessionsLeft + 1)),
        total: isolateLtr(String(s.sessionsCount)),
      });
    }
    return `${day} · ${formatTime(start, locale, tz)}`;
  };

  const picker = (
    <BranchPicker testID="classes.branch" style={{ marginTop: space.s, marginBottom: space.s }} />
  );
  const header = (
    <View style={{ paddingTop: space.sm, gap: space.sm, marginBottom: space.sm }}>
      {picker}
      <SegmentedControl<ClassFilter>
        testID="classes.filter"
        options={[
          { value: 'all', label: t('coaching.guest.classes.filterAll') },
          { value: 'group', label: t('coaching.guest.classes.filterGroup') },
          { value: 'course', label: t('coaching.guest.classes.filterCourse') },
        ]}
        value={filter}
        onChange={setFilter}
        activeColor={colors.gstrong}
      />
    </View>
  );

  const body = (() => {
    if (!venueId || !settings.data) {
      if (guest.query.isError || settings.isError) {
        return (
          <ErrorState
            testID="classes.error"
            title={t('errors.loadFailedTitle')}
            message={t('coaching.guest.classes.error')}
            retryLabel={t('common.retry')}
            onRetry={() => {
              void guest.query.refetch();
              void settings.refetch();
            }}
          />
        );
      }
      return <SkeletonList rows={3} height={96} />;
    }
    if (!on || pub.data?.off) {
      return (
        <View testID="classes.off" style={{ paddingTop: space.sm }}>
          {picker}
          <MatchNotice text={t('coaching.common.errors.off')} />
        </View>
      );
    }
    if (!pub.data) {
      if (pub.isError) {
        return (
          <ErrorState
            testID="classes.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(pub.error, t, { locale })}
            retryLabel={t('common.retry')}
            onRetry={() => void pub.refetch()}
            busy={pub.isRefetching}
          />
        );
      }
      return <SkeletonList rows={3} height={96} />;
    }
    return (
      <FlatList
        testID="classes.list"
        data={rows}
        keyExtractor={(r) => classTarget(r.session)?.id ?? r.session.startAt}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            testID="classes.empty"
            title={t('coaching.guest.classes.emptyTitle')}
            message={t('coaching.guest.classes.empty')}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: space.s }} />}
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
        renderItem={({ item: r }) => {
          const target = classTarget(r.session);
          if (!target) return null;
          const title =
            pick(r.session.titleEn, r.session.titleAr, locale) ||
            (r.type ? pick(r.type.nameEn, r.type.nameAr, locale) : '');
          const price = r.type?.priceIqd ?? null;
          return (
            <ClassRow
              testID={`classes.row.${target.id}`}
              kind={t(`coaching.common.kinds.${r.session.kind}`)}
              title={title}
              coach={displayCoachName(r.coach, locale)}
              when={whenOf(r)}
              places={countPhrase('coaching.common.count.placesLeft', r.session.placesLeft, locale)}
              price={price !== null ? isolate(formatIQD(price, locale)) : null}
              onPress={() => router.push({ pathname: '/class/[id]', params: target })}
            />
          );
        }}
      />
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.guest.classes.title') }} />
      {body}
    </Screen>
  );
}
