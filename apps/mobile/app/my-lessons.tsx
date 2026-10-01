import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useBranches } from '../src/features/availability/hooks';
import { branchName } from '../src/features/availability/branch';
import { useConfirmLessonLink, useMyLessons } from '../src/features/coaching/hooks';
import { lessonErrorCode, lessonErrorText } from '../src/features/coaching/errors';
import { lessonStateOf, moneyLineOf, stateLine } from '../src/features/coaching/state';
import {
  DEFAULT_TZ,
  displayCoachName,
  holdLive,
  lessonTitle,
  type MyLessonRow,
} from '../src/features/coaching/logic';
import type { LessonScope } from '../src/features/coaching/keys';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { space, useTheme } from '../src/theme';
import { Screen, SegmentedControl } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { LessonRow, LinkConfirmCard } from '../src/components/coaching';
import { ConfirmAlert, useToast } from '../src/components/overlays';

/**
 * My lessons (docs/design/coaching/guest.md §4.8.8): Upcoming, Past and
 * Cancelled, one `my_lessons` read each. The one place past and cancelled
 * lessons are listed (Bookings keeps the upcoming ones beside the courts), and
 * the place C-21's question is asked: on Upcoming, every lesson a coach or the
 * desk linked by a typed phone is an "Is this you?" card above the list,
 * never a plain row (R44).
 */
function MyLessonsScreen() {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<LessonScope>('upcoming');
  const mine = useMyLessons(scope);
  const pull = usePullRefresh(mine.refetch);
  const branches = useBranches();
  const confirm = useConfirmLessonLink();
  const [removing, setRemoving] = useState<string | null>(null);

  const rows = mine.data ?? [];
  const confirms = scope === 'upcoming' ? rows.filter((r) => r.confirmNeeded) : [];
  const list = rows.filter((r) => !r.confirmNeeded);
  const now = new Date();

  const branchOf = (venueId: string | null) => {
    const b = branches.data?.find((x) => x.venue_id === venueId);
    return b ? branchName(b, locale) : '';
  };
  const tzOf = (venueId: string | null) =>
    branches.data?.find((x) => x.venue_id === venueId)?.timezone ?? DEFAULT_TZ;

  const onConfirm = (enrolmentId: string, yes: boolean) => {
    confirm.mutate(
      { enrolmentId, yes },
      {
        onSuccess: () =>
          toast(
            t(yes ? 'coaching.guest.confirm.added' : 'coaching.guest.confirm.removed'),
            'success',
          ),
        onError: (err) => {
          // A repeated "Not me" answers ENROLMENT_NOT_FOUND: it is done either way.
          if (!yes && lessonErrorCode(err) === 'ENROLMENT_NOT_FOUND') {
            toast(t('coaching.guest.confirm.removed'), 'success');
            return;
          }
          toast(lessonErrorText(err, t, { locale }), 'error');
        },
      },
    );
  };

  const filter = (
    <SegmentedControl<LessonScope>
      testID="my-lessons.filter"
      options={[
        { value: 'upcoming', label: t('coaching.guest.mine.upcoming') },
        { value: 'past', label: t('coaching.guest.mine.past') },
        { value: 'cancelled', label: t('coaching.guest.mine.cancelled') },
      ]}
      value={scope}
      onChange={setScope}
      activeColor={colors.gstrong}
    />
  );

  const confirmCards = confirms.map((r) => (
    <LinkConfirmCard
      key={r.enrolmentId}
      testID={`my-lessons.confirm.${r.enrolmentId}`}
      body={t(
        r.bookedBy === 'staff'
          ? 'coaching.guest.confirm.byStaff'
          : 'coaching.guest.confirm.byCoach',
      )}
      details={[
        displayCoachName(r.coach, locale),
        lessonTitle(r, locale),
        formatDateTime(new Date(r.startAt), locale, tzOf(r.venueId)),
        branchOf(r.venueId),
      ]}
      yesLabel={t('coaching.guest.confirm.yes')}
      noLabel={t('coaching.guest.confirm.no')}
      busy={
        confirm.isPending && confirm.variables?.enrolmentId === r.enrolmentId
          ? confirm.variables.yes
            ? 'yes'
            : 'no'
          : null
      }
      onYes={() => onConfirm(r.enrolmentId, true)}
      onNo={() => setRemoving(r.enrolmentId)}
    />
  ));

  const emptyLine =
    scope === 'past'
      ? t('coaching.guest.mine.emptyPast')
      : scope === 'cancelled'
        ? t('coaching.guest.mine.emptyCancelled')
        : t('coaching.guest.mine.emptyUpcoming');

  const renderRow = (r: MyLessonRow) => {
    const tz = tzOf(r.venueId);
    const state = lessonStateOf(r, now);
    const action = holdLive(r, now.getTime()) ? t('coaching.guest.bookings.finish') : null;
    return (
      <LessonRow
        testID={`my-lessons.row.${r.enrolmentId}`}
        title={lessonTitle(r, locale)}
        coachName={displayCoachName(r.coach, locale)}
        photoPath={r.coach?.photoPath ?? null}
        when={formatDateTime(new Date(r.startAt), locale, tz)}
        state={stateLine(state, { t, locale, tz, now })}
        money={moneyLineOf(r, state, { t, locale })}
        action={action}
        onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: r.enrolmentId } })}
      />
    );
  };

  const body = (() => {
    if (!mine.data) {
      if (mine.isError) {
        return (
          <ErrorState
            testID="my-lessons.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(mine.error, t, { locale })}
            retryLabel={t('common.retry')}
            onRetry={() => void mine.refetch()}
            busy={mine.isRefetching}
          />
        );
      }
      return <SkeletonList rows={3} height={84} />;
    }
    return (
      <FlatList
        data={list}
        keyExtractor={(r) => r.enrolmentId}
        ListHeaderComponent={
          confirmCards.length > 0 ? (
            <View style={{ gap: space.s, marginBottom: space.sm }}>{confirmCards}</View>
          ) : null
        }
        ListEmptyComponent={
          confirmCards.length > 0 ? null : (
            <EmptyState
              testID="my-lessons.empty"
              actionTestID="my-lessons.find"
              title={t('coaching.guest.mine.emptyTitle')}
              message={emptyLine}
              actionLabel={t('coaching.guest.mine.find')}
              onAction={() => router.push('/coaches')}
            />
          )
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
        renderItem={({ item }) => renderRow(item)}
      />
    );
  })();

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.guest.mine.title') }} />
      <View style={{ paddingTop: space.sm, paddingBottom: space.sm }}>{filter}</View>
      {body}
      <ConfirmAlert
        visible={removing !== null}
        title={t('coaching.guest.confirm.removeTitle')}
        body={t('coaching.guest.confirm.removeBody')}
        confirmLabel={t('coaching.guest.confirm.remove')}
        destructive
        onConfirm={() => {
          const id = removing;
          setRemoving(null);
          if (id) onConfirm(id, false);
        }}
        onDismiss={() => setRemoving(null)}
      />
    </Screen>
  );
}

/** Session-gated: the guest's own lessons (RequireSession). */
export default function GuardedMyLessonsScreen() {
  return (
    <RequireSession>
      <MyLessonsScreen />
    </RequireSession>
  );
}
