import { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localParts, wallTimeToUtc } from '@touch/core';
import {
  countPhrase,
  formatDayNumber,
  formatMonthShort,
  formatNumber,
  formatWeekdayShort,
  isolate,
  isolateLtr,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../src/theme';
import { Button, Card, Screen, SectionLabel, SegmentedControl } from '../../src/components/ui';
import { ListHeading } from '../../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';
import {
  CalendarBookIcon,
  CalendarIcon,
  ChevronIcon,
  ClipboardIcon,
  ClockIcon,
  RoundedPlusIcon,
  SlipIcon,
} from '../../src/components/icons';
import {
  CoachAvatar,
  CoachBanners,
  CoachLessonRow,
  NightHeader,
  SHEET_RADIUS,
  TimeOffBand,
} from '../../src/components/coachMode';
import { RequireCoach } from '../../src/features/coach/RequireCoach';
import { useCoachStatus } from '../../src/features/coach/CoachStatusProvider';
import { useAcceptPublic, useCoachSchedule } from '../../src/features/coach/hooks';
import { coachErrorText } from '../../src/features/coach/errors';
import {
  DEFAULT_TZ,
  canBookOrCreate,
  coachPhotoUrl,
  pickName,
  scheduleSections,
  scheduleSummary,
  scheduleWindow,
  type CoachMe,
  type ScheduleItem,
  type ScheduleSection,
} from '../../src/features/coach/logic';
import { useBlueHeaderOptions } from '../../src/navigation/blueHeader';
import { usePullRefresh } from '../../src/lib/usePullRefresh';

/**
 * Coach mode (docs/design/coaching/guest.md §4.13.2): the coach's own day.
 * Reached from Profile, or from the staff hub for staff who coach (C-27);
 * the first screen of coach mode's own stack (app/(coach-mode)/_layout.tsx),
 * whose native back button leaves the group.
 *
 * Top to bottom: a brand-blue hero carried down from the bar (the coach, today,
 * and the counts: today's lessons, the next seven days', the students booked
 * in them), then the page's ground as a sheet with rounded top corners over it:
 * the banners (paused, switched off at a branch, not public yet), the branch
 * picker, the students still to mark, the schedule by trading night (lessons
 * and time off; a row opens its roster), then the actions as tiles. While the
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
  const headerOptions = useBlueHeaderOptions(t('coaching.coach.home.title'));

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
  const summary = useMemo(() => scheduleSummary(sections, new Date()), [sections]);

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

  const dayLabel = (night: string) => {
    const noon = wallTimeToUtc(night, 12 * 60, tz);
    return t('coaching.coach.home.day', {
      weekday: formatWeekdayShort(noon, locale, tz),
      day: formatDayNumber(noon, locale, tz),
      month: formatMonthShort(noon, locale, tz),
    });
  };
  const nightLabel = (s: ScheduleSection) => {
    if (s.offset === 0) return t('coaching.coach.home.tonight');
    if (s.offset === 1) return t('coaching.coach.home.tomorrow');
    if (s.offset === -1) return t('coaching.coach.home.yesterday');
    return dayLabel(s.night);
  };
  const openLesson = (lessonId: string) =>
    router.push({ pathname: '/coach-mode-lesson', params: { id: lessonId } });

  const gutter = { paddingStart: space.l, paddingEnd: space.l } as const;

  const renderItem = ({ item, section }: { item: ScheduleItem; section: ScheduleSection }) => (
    <View style={gutter}>
      {item.type === 'lesson' ? (
        <CoachLessonRow
          testID={`coach-mode.lesson.${item.lesson.lessonId}`}
          lesson={item.lesson}
          tz={coach.branches.find((b) => b.venueId === item.lesson.venueId)?.timezone ?? tz}
          now={now}
          highlight={section.offset === 0}
          onPress={() => openLesson(item.lesson.lessonId)}
        />
      ) : (
        <TimeOffBand
          testID={`coach-mode.time-off.${item.band.id}`}
          startsAt={item.band.startsAt}
          endsAt={item.band.endsAt}
          tz={tz}
        />
      )}
    </View>
  );

  const stats = [
    { key: 'today', value: summary.today, label: t('coaching.coach.home.tonight') },
    { key: 'week', value: summary.week, label: t('coaching.coach.home.week') },
    { key: 'students', value: summary.students, label: t('coaching.coach.home.students') },
  ];

  const listHeader = (
    <View>
      {/* The hero: the bar's blue carried down into the page. The block above
      it fills the pull-to-refresh overscroll, so the blue never parts from the bar. */}
      <View
        style={{
          backgroundColor: brand.blue,
          ...gutter,
          paddingTop: space.s,
          paddingBottom: space.l + SHEET_RADIUS,
          gap: space.l,
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            start: 0,
            end: 0,
            top: -1000,
            height: 1000,
            backgroundColor: brand.blue,
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <CoachAvatar name={name} photoUrl={photoUrl} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{
                fontFamily: fonts.body600,
                fontSize: 12.5,
                color: brand.white,
                opacity: 0.8,
              }}
            >
              {dayLabel(today)}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontFamily: fonts.display800, fontSize: 20, color: brand.white }}
            >
              {isolate(name)}
            </Text>
          </View>
          {coach.status === 'paused' ? (
            <View
              style={{
                backgroundColor: colors.amb,
                borderRadius: radius.pill,
                paddingStart: 10,
                paddingEnd: 10,
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.ambtext }}>
                {t('coaching.coach.home.paused')}
              </Text>
            </View>
          ) : null}
        </View>
        <View testID="coach-mode.stats" style={{ flexDirection: 'row', gap: space.s }}>
          {stats.map((s) => (
            <View
              key={s.key}
              testID={`coach-mode.stats.${s.key}`}
              style={{
                flex: 1,
                backgroundColor: brand.navyLine,
                borderRadius: radius.card,
                padding: space.sm,
                gap: 2,
              }}
            >
              <Text style={{ fontFamily: fonts.display800, fontSize: 24, color: brand.white }}>
                {isolateLtr(formatNumber(s.value, locale))}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: fonts.body700,
                  fontSize: 11.5,
                  color: brand.white,
                  opacity: 0.8,
                }}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* The sheet: the page's own ground, rounded where it meets the blue. */}
      <View
        style={{
          marginTop: -SHEET_RADIUS,
          backgroundColor: colors.bg,
          borderTopStartRadius: SHEET_RADIUS,
          borderTopEndRadius: SHEET_RADIUS,
          ...gutter,
          paddingTop: space.l,
          gap: space.sm,
        }}
      >
        <CoachBanners
          testID="coach-mode.banner"
          coach={coach}
          onReview={() => setSheetClosed(false)}
        />
        {coach.branches.length > 1 ? (
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
        ) : null}
        {summary.toMark ? (
          <Pressable
            testID="coach-mode.to-mark"
            accessibilityRole="button"
            onPress={() => summary.toMark && openLesson(summary.toMark.lessonId)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: colors.amb,
              borderWidth: 1,
              borderColor: colors.ambline,
              borderRadius: radius.card,
              padding: space.m,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.card,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ClipboardIcon size={20} color={colors.ambstrong} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ambtext }}>
                {countPhrase('coaching.coach.count.toMark', summary.toMark.students, locale)}
              </Text>
              <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.ambtext }}>
                {t('coaching.coach.home.toMarkBody')}
              </Text>
            </View>
            <ChevronIcon size={16} color={colors.ambstrong} />
          </Pressable>
        ) : null}
        <ListHeading
          icon={CalendarIcon}
          label={t('coaching.coach.home.schedule')}
          style={{ marginTop: space.s }}
        />
      </View>
    </View>
  );

  const empty = (
    <View style={gutter}>
      {schedule.isError ? (
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
      )}
    </View>
  );

  const actions: { key: string; icon: typeof ClockIcon; label: string; href: Href }[] = [
    ...(creates
      ? [
          {
            key: 'new',
            icon: RoundedPlusIcon,
            label: t('coaching.coach.home.new'),
            href: '/coach-mode-new' as const,
          },
          {
            key: 'book',
            icon: CalendarBookIcon,
            label: t('coaching.coach.home.book'),
            href: '/coach-mode-book' as const,
          },
        ]
      : []),
    {
      key: 'hours',
      icon: ClockIcon,
      label: t('coaching.coach.home.hours'),
      href: '/coach-mode-hours',
    },
    {
      key: 'statements',
      icon: SlipIcon,
      label: t('coaching.coach.home.statements'),
      href: '/coach-mode-statements',
    },
  ];
  const actionRows: (typeof actions)[] = [];
  for (let i = 0; i < actions.length; i += 2) actionRows.push(actions.slice(i, i + 2));

  const footer = (
    <View style={{ ...gutter, marginTop: space.l, gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <SectionLabel>{t('coaching.coach.home.actions')}</SectionLabel>
        <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />
      </View>
      {actionRows.map((row) => (
        <View key={row.map((a) => a.key).join('.')} style={{ flexDirection: 'row', gap: space.s }}>
          {row.map((a) => (
            <Pressable
              key={a.key}
              testID={`coach-mode.${a.key}`}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              onPress={() => router.push(a.href)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 96,
                backgroundColor: pressed ? colors.sub : colors.card,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.card,
                padding: space.m,
                gap: space.xxl + space.s,
                justifyContent: 'space-between',
              })}
            >
              {/* The staff hub's tile icon: green glyph on its green tint. */}
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: colors.gtint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <a.icon size={20} color={colors.gstrong} />
              </View>
              <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>
                {a.label}
              </Text>
            </Pressable>
          ))}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );

  return (
    <Screen edges={[]} padded={false}>
      <Stack.Screen options={headerOptions} />
      <SectionList<ScheduleItem, ScheduleSection>
        testID="coach-mode.schedule"
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={gutter}>
            <NightHeader label={nightLabel(section)} />
          </View>
        )}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={brand.white}
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
