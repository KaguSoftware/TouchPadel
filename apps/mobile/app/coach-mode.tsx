import { useCallback, useMemo, useState } from 'react';
import { Modal, Platform, RefreshControl, ScrollView, SectionList, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localParts, wallTimeToUtc } from '@touch/core';
import { formatDayNumber, formatMonthShort, formatWeekdayShort, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, Screen, SegmentedControl } from '../src/components/ui';
import { ListHeading, MenuRow } from '../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import {
  CalendarIcon,
  ClockIcon,
  PlusSquareIcon,
  ReceiptIcon,
  TableIcon,
} from '../src/components/icons';
import {
  CoachAvatar,
  CoachBanners,
  CoachLessonRow,
  NightHeader,
  TimeOffBand,
} from '../src/components/coachMode';
import { RequireCoach } from '../src/features/coach/RequireCoach';
import { useCoachStatus } from '../src/features/coach/CoachStatusProvider';
import { useAcceptPublic, useCoachSchedule } from '../src/features/coach/hooks';
import { coachErrorText } from '../src/features/coach/errors';
import {
  DEFAULT_TZ,
  canBookOrCreate,
  coachPhotoUrl,
  pickName,
  scheduleSections,
  scheduleWindow,
  type CoachMe,
  type ScheduleItem,
  type ScheduleSection,
} from '../src/features/coach/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * Coach mode (docs/design/coaching/guest.md §4.13.2): the coach's own day.
 * Reached from Profile, or from the staff hub for staff who coach (C-27);
 * a root-stack push with the native back item.
 *
 * Top to bottom: the coach's card, the banners (paused, switched off at a
 * branch, not public yet), the branch picker, the schedule by trading night
 * (lessons and time off; a row opens its roster), then the actions. While the
 * profile is not public the screen opens on the accept sheet (R61, C-22).
 */
function CoachModeScreen() {
  const { status } = useCoachStatus();
  // RequireCoach renders this only for an active or paused coach.
  if (status.kind !== 'coach') return null;
  return <CoachModeBody coach={status.coach} />;
}

function CoachModeBody({ coach }: { coach: CoachMe }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { retry } = useCoachStatus();

  const [venue, setVenue] = useState<string>('all');
  const venueId = venue === 'all' ? null : venue;
  const tz =
    coach.branches.find((b) => b.venueId === venueId)?.timezone ??
    coach.branches[0]?.timezone ??
    DEFAULT_TZ;

  // Whole local days, so the key holds for the day and a refocus reuses it.
  const today = localParts(new Date(), tz).date;
  const window = useMemo(() => scheduleWindow(wallTimeToUtc(today, 12 * 60, tz), tz), [today, tz]);
  const schedule = useCoachSchedule(window);
  const now = new Date();
  const sections = useMemo(
    () => (schedule.data ? scheduleSections(schedule.data, { now: new Date(), tz, venueId }) : []),
    [schedule.data, tz, venueId],
  );

  const refresh = useCallback(async () => {
    retry();
    await schedule.refetch();
  }, [retry, schedule]);
  const pull = usePullRefresh(refresh);

  const [sheetClosed, setSheetClosed] = useState(false);
  const sheetOpen = !coach.publicAccepted && !sheetClosed;

  const name = pickName(coach.displayNameEn, coach.displayNameAr, locale);
  const photoUrl = coachPhotoUrl(coach.photoPath, process.env.EXPO_PUBLIC_SUPABASE_URL);
  const creates = canBookOrCreate(coach);

  const nightLabel = (s: ScheduleSection) => {
    if (s.offset === 0) return t('coaching.coach.home.tonight');
    if (s.offset === 1) return t('coaching.coach.home.tomorrow');
    if (s.offset === -1) return t('coaching.coach.home.yesterday');
    const noon = wallTimeToUtc(s.night, 12 * 60, tz);
    return t('coaching.coach.home.day', {
      weekday: formatWeekdayShort(noon, locale, tz),
      day: formatDayNumber(noon, locale, tz),
      month: formatMonthShort(noon, locale, tz),
    });
  };

  const renderItem = ({ item }: { item: ScheduleItem }) =>
    item.type === 'lesson' ? (
      <CoachLessonRow
        testID={`coach-mode.lesson.${item.lesson.lessonId}`}
        lesson={item.lesson}
        tz={coach.branches.find((b) => b.venueId === item.lesson.venueId)?.timezone ?? tz}
        now={now}
        onPress={() =>
          router.push({ pathname: '/coach-mode-lesson', params: { id: item.lesson.lessonId } })
        }
      />
    ) : (
      <TimeOffBand
        testID={`coach-mode.time-off.${item.band.id}`}
        startsAt={item.band.startsAt}
        endsAt={item.band.endsAt}
        tz={tz}
      />
    );

  const header = (
    <View style={{ gap: space.sm, paddingTop: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <CoachAvatar name={name} photoUrl={photoUrl} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.display800, fontSize: 20, color: colors.ink }}
          >
            {isolate(name)}
          </Text>
          {coach.status === 'paused' ? (
            <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.ambtext }}>
              {t('coaching.coach.home.paused')}
            </Text>
          ) : null}
        </View>
      </View>
      <CoachBanners
        testID="coach-mode.banner"
        coach={coach}
        onReview={() => setSheetClosed(false)}
      />
      {coach.branches.length > 1 ? (
        <Card style={{ padding: space.m }}>
          <SegmentedControl<string>
            testID="coach-mode.branch"
            options={[
              { value: 'all', label: t('coaching.coach.home.allBranches') },
              ...coach.branches.map((b) => ({
                value: b.venueId,
                label: pickName(b.nameEn, b.nameAr, locale),
              })),
            ]}
            value={venue}
            onChange={setVenue}
          />
        </Card>
      ) : null}
      <ListHeading
        icon={CalendarIcon}
        label={t('coaching.coach.home.schedule')}
        style={{ marginTop: space.s }}
      />
    </View>
  );

  const empty = schedule.isError ? (
    <ErrorState
      testID="coach-mode.error"
      title={t('errors.loadFailedTitle')}
      message={coachErrorText(schedule.error, t, { locale })}
      retryLabel={t('common.retry')}
      onRetry={() => void schedule.refetch()}
      busy={schedule.isRefetching}
    />
  ) : !schedule.data ? (
    <SkeletonList rows={3} height={76} />
  ) : (
    <EmptyState
      testID="coach-mode.empty"
      title={t('coaching.coach.home.emptyTitle')}
      message={t('coaching.coach.home.empty')}
    />
  );

  const footer = (
    <View style={{ marginTop: space.l, gap: space.xs }}>
      <ListHeading icon={ClockIcon} label={t('coaching.coach.home.actions')} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <MenuRow
          testID="coach-mode.hours"
          icon={<ClockIcon size={15} color={colors.gstrong} />}
          label={t('coaching.coach.home.hours')}
          onPress={() => router.push('/coach-mode-hours')}
        />
        {creates ? (
          <MenuRow
            testID="coach-mode.new"
            icon={<PlusSquareIcon size={15} color={colors.gstrong} />}
            label={t('coaching.coach.home.new')}
            onPress={() => router.push('/coach-mode-new')}
          />
        ) : null}
        {creates ? (
          <MenuRow
            testID="coach-mode.book"
            icon={<TableIcon size={15} color={colors.gstrong} />}
            label={t('coaching.coach.home.book')}
            onPress={() => router.push('/coach-mode-book')}
          />
        ) : null}
        <MenuRow
          testID="coach-mode.statements"
          icon={<ReceiptIcon size={15} color={colors.gstrong} />}
          label={t('coaching.coach.home.statements')}
          onPress={() => router.push('/coach-mode-statements')}
          last
        />
      </Card>
    </View>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('coaching.coach.home.title') }} />
      <SectionList<ScheduleItem, ScheduleSection>
        testID="coach-mode.schedule"
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => <NightHeader label={nightLabel(section)} />}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.blue}
          />
        }
      />
      <AcceptSheet coach={coach} visible={sheetOpen} onClose={() => setSheetClosed(true)} />
    </Screen>
  );
}

/**
 * R61, C-22: before the profile goes public the coach accepts it, on the
 * platform's own sheet (a form sheet on iOS, a full-screen modal on Android).
 * "Not now" closes it for this visit; the "Not public yet" banner stays.
 */
function AcceptSheet({
  coach,
  visible,
  onClose,
}: {
  coach: CoachMe;
  visible: boolean;
  onClose: () => void;
}) {
  const { t, locale, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const accept = useAcceptPublic();
  const name = pickName(coach.displayNameEn, coach.displayNameAr, locale);
  const bio = pickName(coach.bioEn, coach.bioAr, locale);
  const types = coach.lessonTypes.filter((lt) => lt.isActive);
  const typeNames = [...new Set(types.map((lt) => pickName(lt.nameEn, lt.nameAr, locale)))];

  const onAccept = () =>
    accept.mutate(undefined, {
      onSuccess: () => {
        toast(t('coaching.coach.accept.done'), 'success');
        onClose();
      },
      onError: (err) => toast(coachErrorText(err, t, { locale }), 'error'),
    });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'formSheet' : undefined}
      onRequestClose={onClose}
    >
      <View
        testID="coach-mode.accept-sheet"
        style={{ flex: 1, direction: dir, backgroundColor: colors.bg }}
      >
        <ScrollView
          contentContainerStyle={{
            paddingStart: space.xl,
            paddingEnd: space.xl,
            paddingTop: space.xxl,
            paddingBottom: 40 + insets.bottom,
            gap: space.m,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.display800,
              fontSize: 22,
              lineHeight: 28,
              color: colors.ink,
            }}
          >
            {t('coaching.coach.accept.title')}
          </Text>
          <Text
            style={{ fontFamily: fonts.body600, fontSize: 14, lineHeight: 21, color: colors.mut2 }}
          >
            {t('coaching.coach.accept.body')}
          </Text>
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 12.5,
              color: colors.fnt,
              marginTop: space.s,
            }}
          >
            {t('coaching.coach.accept.preview')}
          </Text>
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <CoachAvatar
                name={name}
                photoUrl={coachPhotoUrl(coach.photoPath, process.env.EXPO_PUBLIC_SUPABASE_URL)}
              />
              <Text style={{ flex: 1, fontFamily: fonts.body800, fontSize: 16, color: colors.ink }}>
                {isolate(name)}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: fonts.body400,
                fontSize: 13,
                lineHeight: 19,
                color: colors.mut2,
              }}
            >
              {bio ? isolate(bio) : t('coaching.coach.accept.noBio')}
            </Text>
            {typeNames.length > 0 ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut }}>
                  {t('coaching.coach.accept.lessonTypes')}
                </Text>
                {typeNames.map((n) => (
                  <Text
                    key={n}
                    style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.ink }}
                  >
                    {`· ${isolate(n)}`}
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>
          <Text
            style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}
          >
            {t('coaching.coach.accept.venueEdits')}
          </Text>
          <Button
            testID="coach-mode.accept"
            label={t('coaching.coach.accept.accept')}
            variant="cta"
            busy={accept.isPending}
            onPress={onAccept}
            style={{ marginTop: space.s }}
          />
          <Button
            testID="coach-mode.accept-later"
            label={t('coaching.coach.accept.later')}
            variant="secondary"
            size="medium"
            onPress={onClose}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function CoachModeRoute() {
  return (
    <RequireCoach>
      <CoachModeScreen />
    </RequireCoach>
  );
}
