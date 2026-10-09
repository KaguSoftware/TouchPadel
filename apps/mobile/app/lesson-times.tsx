import { useContext, useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dayOfWeekOfDate, wallTimeToUtc } from '@touch/core';
import {
  countPhrase,
  formatDate,
  formatDayNumber,
  formatIQD,
  formatMonthShort,
  formatTime,
  formatWeekdayLong,
  formatWeekdayShort,
  isolate,
} from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { useAuth } from '../src/features/auth/context';
import { useIsDegraded, useVenueSettings } from '../src/features/availability/hooks';
import { addDays, venuePhoneOf, type MergedCell } from '../src/features/availability/assemble';
import { useCoachProfile } from '../src/features/coaching/hooks';
import { useLessonBooking } from '../src/features/coaching/useLessonBooking';
import { lessonErrorText } from '../src/features/coaching/errors';
import { setOnlyPendingLesson } from '../src/features/booking/pendingIntent';
import { classTarget, displayCoachName, pick } from '../src/features/coaching/logic';
import { useCoachStatus } from '../src/features/coach/useCoachStatus';
import { brand, radius, shadows, space, useTheme } from '../src/theme';
import { Button, Hint, Screen } from '../src/components/ui';
import { DegradedBanner, slotTestID } from '../src/components/booking';
import { ErrorState, SkeletonList } from '../src/components/states';
import { MatchNotice, MatchSectionTitle } from '../src/components/match';
import { ClassRow, CoachAvatar } from '../src/components/coaching';
import {
  BackChevronIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronIcon,
} from '../src/components/icons';
import { DateWheelSheet } from '../src/components/DateWheelSheet';
import { useReduceMotion } from '../src/lib/useReduceMotion';
import { liquidGlass } from '../src/lib/liquidGlass';

/** Room the floating book bar takes over the list's foot, above the home indicator. */
const BOOK_BAR_SPACE = 92;
/** Times in view at once in a scrolling row. */
const TIMES_IN_VIEW = 3;
/** Days in the "Next 3 days" list. */
const NEXT_DAYS = 3;
/** How far the light sheet rides up over the blue header. */
const SHEET_OVERLAP = 28;
/** A row opening or closing, a day or week changing: one short ease. */
const EASE_MS = 220;

/**
 * One lesson a coach offers (docs/design/coaching/guest.md §4.8.3), opened
 * from its card on the coach's page.
 *
 * A private lesson (design "E"): a brand-blue header under a transparent
 * native bar (the coach's avatar and name, the lesson, chips for its length,
 * group size and price), then a light sheet with:
 *  - "Pick a time": a week of the booking window, with arrows between weeks
 *    and the week's label opening the date-of-birth wheel (`DateWheelSheet`:
 *    the native sheet on iOS, the system dialog on Android) for any night in
 *    the window; the chosen night's free
 *    starts in a sideways row, three in view;
 *  - "Next 3 days": the first three nights with free times, one row each, a row
 *    opening to its starts in the same kind of row.
 * One time is picked across both; the floating book bar books it, through the
 * review signed in or the welcome (keeping the intent) signed out.
 *
 * A group or course lesson shows its upcoming sessions with places, from the
 * profile read, each opening `/class/[id]` where it is joined.
 *
 * Params: `coachId`, `venueId`, `typeId` (the lesson type), and an optional
 * `date` (the night to start on). The coach's profile read is the coach
 * page's, so it is usually cached already. A paused coach, the switch off, and
 * the coach on their own lesson (R56) show a line instead of the times.
 */
export default function LessonTimesScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    coachId?: string;
    venueId?: string;
    typeId?: string;
    date?: string;
  }>();
  const coachId = typeof params.coachId === 'string' && params.coachId ? params.coachId : null;
  const venueId = typeof params.venueId === 'string' && params.venueId ? params.venueId : null;
  const typeId = typeof params.typeId === 'string' && params.typeId ? params.typeId : null;
  const date = typeof params.date === 'string' ? params.date : null;

  // Until coach_me answers, whether the viewer is this coach is not known,
  // and the grid waits behind a skeleton (MB-18).
  const me = useCoachStatus({ read: !!session });
  const meReading = !!session && me.status.kind === 'pending';

  const profile = useCoachProfile(coachId, venueId);
  const data = profile.data ?? null;
  const settings = useVenueSettings(venueId);
  const degraded = useIsDegraded(venueId);
  const venue = data?.venue ?? null;
  const phone = venue?.phone ?? venuePhoneOf(settings.data);
  const branchLabel = venue ? pick(venue.nameEn, venue.nameAr, locale) : '';

  const offer = data?.offers.find((o) => o.lessonTypeId === typeId && o.kind !== null) ?? null;
  const isPrivate = offer?.kind === 'private';
  // Only this lesson, so the hook never falls back to another private one,
  // and a group or course lesson reads no slots at all.
  const booking = useLessonBooking({
    coachId,
    settings: settings.data,
    timezone: venue?.timezone,
    offers: offer && isPrivate ? [offer] : [],
    preselectTypeId: typeId,
    preselectDate: date,
  });

  const [pickedAt, setPickedAt] = useState<number | null>(null);
  // The week strip's night (unset: the link's date, else the first with free
  // times) and its week (unset: the night's own).
  const [dayPicked, setDayPicked] = useState<string | null>(null);
  const [weekPicked, setWeekPicked] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The "Next 3 days" row that is open, if any.
  const [openRow, setOpenRow] = useState<string | null>(null);
  // The native bar as the navigator measured it, for the header's top.
  const headerHeight = useContext(HeaderHeightContext);
  const reduceMotion = useReduceMotion();
  // The next layout change eases (rows growing, the rows below moving down,
  // times fading in); under Reduce Motion it lands at once.
  const ease = () => {
    if (reduceMotion) return;
    LayoutAnimation.configureNext(
      LayoutAnimation.create(EASE_MS, LayoutAnimation.Types.easeInEaseOut, 'opacity'),
    );
  };

  const coach = data?.coach ?? null;
  const name = displayCoachName(coach, locale);
  const self = !!coach && me.coach?.id === coach.id;
  const paused = coach?.status === 'paused' || booking.status === 'paused';
  const off = !!data?.off || booking.status === 'off';

  // The root layout makes this route's bar transparent from the first frame
  // (the private header runs under it); every other state takes a plain bar.
  const header = (
    <Stack.Screen
      options={{
        title: offer ? pick(offer.nameEn, offer.nameAr, locale) : t('coaching.guest.coach.grid'),
        headerTransparent: false,
        headerStyle: { backgroundColor: colors.bg },
      }}
    />
  );

  if (!coachId || !venueId || !typeId) {
    return (
      <Screen edges={[]}>
        {header}
        <View style={{ paddingTop: space.m }}>
          <MatchNotice text={t('coaching.common.errors.typeNotFound')} />
        </View>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen edges={[]}>
        {header}
        {profile.error ? (
          <ErrorState
            testID="lesson-times.error"
            title={t('errors.loadFailedTitle')}
            message={lessonErrorText(profile.error, t, { locale, phone })}
            retryLabel={t('common.retry')}
            onRetry={() => void profile.refetch()}
          />
        ) : (
          <View style={{ paddingTop: space.m }}>
            <SkeletonList rows={3} height={94} />
          </View>
        )}
      </Screen>
    );
  }

  if (!offer) {
    return (
      <Screen edges={[]}>
        {header}
        <View style={{ paddingTop: space.m }}>
          <MatchNotice text={t('coaching.common.errors.typeNotFound')} />
        </View>
      </Screen>
    );
  }

  const tz = booking.tz;
  const money = (n: number | null) => (n === null ? null : isolate(formatIQD(n, locale)));
  const metaParts = [name, t('coaching.common.durationMin', { minutes: offer.durationMin })];
  if (offer.kind === 'private') {
    metaParts.push(
      t('coaching.common.upTo', {
        people: countPhrase('coaching.common.count.people', offer.maxPlaces, locale),
      }),
    );
  } else if (offer.kind === 'group') {
    metaParts.push(countPhrase('coaching.common.count.places', offer.maxPlaces, locale));
  } else if (offer.kind === 'course' && offer.sessionsCount !== null) {
    metaParts.push(countPhrase('coaching.common.count.sessions', offer.sessionsCount, locale));
  }
  const meta = metaParts.filter(Boolean).join(' · ');
  const summary = (
    <View style={{ gap: 3 }}>
      <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>{meta}</Text>
      {offer.priceIqd != null ? (
        <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.gstrong }}>
          {money(offer.priceIqd)}
        </Text>
      ) : null}
    </View>
  );
  const notices = (
    <>
      {degraded && phone ? (
        <DegradedBanner
          testID="lesson-times.degraded"
          tight
          message={t('degraded.bannerAvailability', { phone: isolate(phone) })}
          phone={phone}
        />
      ) : null}
      {off ? <MatchNotice text={t('coaching.common.errors.off')} /> : null}
      {paused ? <MatchNotice text={t('coaching.guest.coach.paused')} /> : null}
    </>
  );

  if (!isPrivate) {
    const sessions = data.sessions.filter((x) => x.lessonTypeId === typeId);
    return (
      <Screen edges={[]} padded={false}>
        {header}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingStart: space.l,
            paddingEnd: space.l,
            paddingTop: space.m,
            paddingBottom: 40 + insets.bottom,
            gap: space.sm,
          }}
        >
          {summary}
          {notices}
          {!off ? (
            <View testID="lesson-times.dates" style={{ gap: space.s }}>
              <MatchSectionTitle>{t('coaching.guest.coach.dates')}</MatchSectionTitle>
              {sessions.length === 0 ? <Hint>{t('coaching.guest.coach.noDates')}</Hint> : null}
              {sessions.map((x) => {
                const target = classTarget(x);
                if (!target) return null;
                const start = new Date(x.startAt);
                return (
                  <ClassRow
                    key={target.id}
                    testID={`lesson-times.session.${target.id}`}
                    kind={t(`coaching.common.kinds.${x.kind}`)}
                    title={
                      pick(x.titleEn, x.titleAr, locale) || pick(offer.nameEn, offer.nameAr, locale)
                    }
                    coach={name}
                    when={`${formatWeekdayShort(start, locale, tz)} ${formatDate(start, locale, tz)} · ${formatTime(start, locale, tz)}`}
                    places={countPhrase('coaching.common.count.placesLeft', x.placesLeft, locale)}
                    price={money(x.priceIqd)}
                    onPress={() => router.push({ pathname: '/class/[id]', params: target })}
                  />
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  const onTime = (cell: MergedCell) => {
    const startAt = cell.startAt.toISOString();
    const priceIqd = offer.priceIqd ?? null;
    if (!session) {
      setOnlyPendingLesson({
        kind: 'private',
        coachId,
        lessonTypeId: typeId,
        venueId,
        startAt,
        priceIqd,
      });
      router.push('/welcome');
      return;
    }
    router.push({
      pathname: '/lesson-review',
      params: {
        coachId,
        lessonTypeId: typeId,
        venueId,
        startAt,
        ...(priceIqd !== null ? { priceIqd: String(priceIqd) } : {}),
      },
    });
  };

  const showTimes = !off && !paused && !self;
  const noonOf = (night: string) => wallTimeToUtc(night, 12 * 60, tz);
  const todayLabel = formatDate(new Date(), locale, tz);
  const isToday = (night: string) => formatDate(noonOf(night), locale, tz) === todayLabel;
  const dayNum = (night: string) => formatDayNumber(noonOf(night), locale, tz);
  const month = (night: string) => formatMonthShort(noonOf(night), locale, tz);
  const nightLabel = (night: string) => {
    const day = `${formatWeekdayShort(noonOf(night), locale, tz)} ${dayNum(night)} ${month(night)}`;
    return isToday(night) ? `${t('common.today')} · ${day}` : day;
  };
  const freeLine = (cells: MergedCell[]) =>
    [
      countPhrase('coaching.common.count.freeTimes', cells.length, locale),
      cells[0]
        ? t('coaching.guest.coach.fromTime', {
            time: isolate(formatTime(cells[0].startAt, locale, tz)),
          })
        : '',
    ]
      .filter(Boolean)
      .join(' · ');

  // The week strip: calendar weeks, Monday to Sunday, over the window's
  // nights; a day before or after the window shows greyed and takes no tap.
  const dates = booking.dates;
  const cellsOf = new Map(booking.nights.map((n) => [n.date, n.cells]));
  const day =
    (dayPicked && dates.includes(dayPicked) ? dayPicked : null) ??
    (date && cellsOf.has(date) ? date : null) ??
    booking.nights[0]?.date ??
    dates[0] ??
    null;
  const calendar = (() => {
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (!first || !last) return [];
    // dayOfWeekOfDate: 0 = Sunday, so Monday is 1 and Sunday counts as 7.
    const from = addDays(first, -((dayOfWeekOfDate(first) + 6) % 7));
    const to = addDays(last, 6 - ((dayOfWeekOfDate(last) + 6) % 7));
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  })();
  const weekOf = (night: string) => Math.max(0, Math.floor(calendar.indexOf(night) / 7));
  const weekCount = Math.max(1, Math.ceil(calendar.length / 7));
  const week = Math.min(weekCount - 1, Math.max(0, weekPicked ?? (day ? weekOf(day) : 0)));
  const weekDays = calendar.slice(week * 7, week * 7 + 7);
  const weekLabel = (() => {
    const a = weekDays[0];
    const b = weekDays[weekDays.length - 1];
    if (!a || !b) return '';
    return month(a) === month(b)
      ? `${dayNum(a)} – ${dayNum(b)} ${month(b)}`
      : `${dayNum(a)} ${month(a)} – ${dayNum(b)} ${month(b)}`;
  })();
  const chooseDay = (night: string) => {
    ease();
    setDayPicked(night);
    setWeekPicked(weekOf(night));
  };
  const dayCells = (day && cellsOf.get(day)) || [];

  const picked =
    pickedAt === null || !showTimes
      ? null
      : (booking.nights.flatMap((n) => n.cells).find((c) => c.startAt.getTime() === pickedAt) ??
        null);
  const pickedNight = picked
    ? (booking.nights.find((n) => n.cells.includes(picked))?.date ?? null)
    : null;
  const onPill = (cell: MergedCell) => {
    const at = cell.startAt.getTime();
    setPickedAt((cur) => (cur === at ? null : at));
  };

  // Design E's header: the coach, the lesson, and chips for its facts.
  const chip = (label: string, strong = false) => (
    <View
      style={{
        backgroundColor: strong ? brand.green : 'rgba(255,255,255,0.16)',
        borderRadius: radius.pill,
        paddingTop: 4,
        paddingBottom: 4,
        paddingStart: 9,
        paddingEnd: 9,
      }}
    >
      <Text
        style={{
          fontFamily: strong ? fonts.display800 : fonts.body700,
          fontSize: 12,
          color: strong ? brand.greenInk : brand.white,
        }}
      >
        {label}
      </Text>
    </View>
  );
  const hero = (
    <View
      testID="lesson-times.hero"
      style={{
        backgroundColor: brand.blue,
        paddingTop: (headerHeight ?? insets.top + 52) + space.s,
        paddingBottom: space.l + SHEET_OVERLAP,
        paddingStart: space.l,
        paddingEnd: space.l,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.m,
      }}
    >
      <View style={{ borderRadius: 40, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)' }}>
        <CoachAvatar photoPath={coach?.photoPath ?? null} name={name} size={64} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body700, fontSize: 13, color: brand.navyText }}
        >
          {name}
        </Text>
        <Text style={{ fontFamily: fonts.display800, fontSize: 24, color: brand.white }}>
          {pick(offer.nameEn, offer.nameAr, locale)}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          {chip(t('coaching.common.durationMin', { minutes: offer.durationMin }))}
          {chip(
            t('coaching.common.upTo', {
              people: countPhrase('coaching.common.count.people', offer.maxPlaces, locale),
            }),
          )}
          {offer.priceIqd != null ? chip(money(offer.priceIqd) ?? '', true) : null}
        </View>
      </View>
    </View>
  );

  // The week's arrows and its date pill: iOS's Liquid Glass where the system
  // has it (interactive, so a tap gets the system's own press), else a flat
  // fill. Nothing over them fades, so the glass always draws (see the Book
  // tab's header: glass under an alpha < 1 draws nothing).
  const glass = (shape: number) =>
    liquidGlass ? (
      <GlassView
        pointerEvents="none"
        isInteractive
        colorScheme={appearance === 'dark' ? 'dark' : 'light'}
        glassEffectStyle="regular"
        style={[StyleSheet.absoluteFill, { borderRadius: shape }]}
      />
    ) : null;

  const weekArrow = (dir: -1 | 1) => {
    const can = dir < 0 ? week > 0 : week < weekCount - 1;
    const Icon = dir < 0 ? BackChevronIcon : ChevronIcon;
    return (
      <Pressable
        testID={dir < 0 ? 'lesson-times.week-prev' : 'lesson-times.week-next'}
        accessibilityRole="button"
        accessibilityLabel={t(
          dir < 0 ? 'coaching.guest.coach.prevWeek' : 'coaching.guest.coach.nextWeek',
        )}
        accessibilityState={{ disabled: !can }}
        disabled={!can}
        hitSlop={8}
        onPress={() => {
          ease();
          setWeekPicked(week + dir);
        }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: liquidGlass ? 'transparent' : colors.sub,
        }}
      >
        {glass(18)}
        <Icon size={15} color={can ? colors.blue : colors.fnt3} strokeWidth={2.6} />
      </Pressable>
    );
  };

  const weekCard = (
    <View
      testID="lesson-times.week"
      style={{
        backgroundColor: colors.card,
        borderRadius: radius.sheet,
        padding: space.sm,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {weekArrow(-1)}
        <Pressable
          testID="lesson-times.pick-date"
          accessibilityRole="button"
          accessibilityLabel={`${t('coaching.guest.coach.pickDate')}, ${weekLabel}`}
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: 36,
            paddingStart: space.sm,
            paddingEnd: space.sm,
            borderRadius: radius.pill,
            overflow: 'hidden',
            backgroundColor: liquidGlass ? 'transparent' : pressed ? colors.seg : colors.tint,
          })}
        >
          {glass(radius.pill)}
          <CalendarIcon size={15} color={colors.blue} />
          <Text style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.ink }}>
            {weekLabel}
          </Text>
          <ChevronDownIcon size={12} color={colors.blue} strokeWidth={2.8} />
        </Pressable>
        {weekArrow(1)}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {weekDays.map((d) => {
          const has = cellsOf.has(d);
          const on = d === day;
          // Past or after the window: greyed. In the window but full: crossed out.
          const full = !has && dates.includes(d);
          return (
            <Pressable
              key={d}
              testID={`lesson-times.day.${d}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: !has }}
              accessibilityLabel={nightLabel(d)}
              disabled={!has}
              onPress={() => chooseDay(d)}
              style={{
                flex: 1,
                height: 64,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                backgroundColor: on ? colors.blue : 'transparent',
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: fonts.body700,
                  fontSize: 11,
                  color: on ? colors.card : has ? colors.fnt : colors.fnt3,
                }}
              >
                {formatWeekdayShort(noonOf(d), locale, tz)}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 17,
                  color: on ? colors.card : has ? colors.ink : colors.fnt3,
                  textDecorationLine: full ? 'line-through' : 'none',
                }}
              >
                {dayNum(d)}
              </Text>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: has ? (on ? brand.green : colors.gstrong) : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </View>
      {day ? (
        // A hairline between the week's days and the chosen day's times.
        <View
          style={{
            gap: space.s,
            paddingTop: space.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.line2,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: space.s,
            }}
          >
            <Text
              style={{
                flexShrink: 1,
                fontFamily: fonts.display800,
                fontSize: 14,
                color: colors.ink,
              }}
            >
              {`${formatWeekdayLong(noonOf(day), locale, tz)} ${dayNum(day)} ${month(day)}`}
            </Text>
            <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>
              {countPhrase('coaching.common.count.freeTimes', dayCells.length, locale)}
            </Text>
          </View>
          {dayCells.length > 0 ? (
            <TimeRow
              testID="lesson-times.slot"
              cells={dayCells}
              pickedAt={pickedAt}
              onPick={onPill}
              label={(c) => formatTime(c.startAt, locale, tz)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const dayRow = (n: { date: string; cells: MergedCell[] }) => {
    const open = n.date === openRow;
    return (
      <View
        key={n.date}
        style={{
          backgroundColor: colors.card,
          borderRadius: radius.card,
          borderWidth: 2,
          borderColor: open ? colors.blue : colors.card,
          // Clips the times to the row while it grows open, so they never
          // hang past its outline mid-animation.
          overflow: 'hidden',
        }}
      >
        <Pressable
          testID={`lesson-times.night.${n.date}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${nightLabel(n.date)}, ${freeLine(n.cells)}`}
          onPress={() => {
            ease();
            setOpenRow(open ? null : n.date);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            minHeight: 60,
            paddingTop: space.sm,
            paddingBottom: space.sm,
            paddingStart: space.m,
            paddingEnd: space.m,
          }}
        >
          {/* The operator's tournament date tile on a solid block, brand
            blue, and green for today: weekday ("Today"), day, month. */}
          <View
            style={{
              width: 50,
              height: 58,
              borderRadius: radius.cell,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isToday(n.date) ? brand.green : colors.blue,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: fonts.body700,
                fontSize: 10.5,
                lineHeight: 13,
                color: isToday(n.date) ? brand.greenInk : colors.card,
              }}
            >
              {isToday(n.date) ? t('common.today') : formatWeekdayShort(noonOf(n.date), locale, tz)}
            </Text>
            <Text
              style={{
                fontFamily: fonts.display800,
                fontSize: 20,
                lineHeight: 24,
                color: isToday(n.date) ? brand.greenInk : colors.card,
              }}
            >
              {dayNum(n.date)}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: fonts.body700,
                fontSize: 10.5,
                lineHeight: 13,
                color: isToday(n.date) ? brand.greenInk : colors.card,
              }}
            >
              {month(n.date)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontFamily: fonts.display800, fontSize: 15, color: colors.ink }}>
              {formatWeekdayLong(noonOf(n.date), locale, tz)}
            </Text>
            <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>
              {freeLine(n.cells)}
            </Text>
          </View>
          <RowChevron
            open={open}
            reduceMotion={reduceMotion}
            color={open ? colors.blue : colors.fnt}
          />
        </Pressable>
        {open ? (
          <View style={{ paddingStart: space.m, paddingEnd: space.m, paddingBottom: space.m }}>
            <TimeRow
              testID="lesson-times.row-slot"
              cells={n.cells}
              pickedAt={pickedAt}
              onPick={onPill}
              label={(c) => formatTime(c.startAt, locale, tz)}
            />
          </View>
        ) : null}
      </View>
    );
  };

  const sectionTitle = (title: string, sub?: string) => (
    <View style={{ gap: 2 }}>
      <Text style={{ fontFamily: fonts.display800, fontSize: 18, color: colors.ink }}>{title}</Text>
      {sub ? (
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>{sub}</Text>
      ) : null}
    </View>
  );

  const times = (() => {
    if (meReading) return <SkeletonList rows={2} height={64} />;
    if (booking.status === 'loading') return <SkeletonList rows={3} height={64} />;
    if (booking.status === 'error') {
      return (
        <ErrorState
          testID="lesson-times.slots-error"
          title={t('errors.loadFailedTitle')}
          message={t('coaching.guest.coach.error')}
          retryLabel={t('common.retry')}
          onRetry={booking.refetch}
        />
      );
    }
    if (booking.nights.length === 0) {
      return (
        <Hint>
          {phone
            ? t('coaching.guest.coach.noTimes', { branch: isolate(branchLabel) })
            : t('coaching.guest.coach.noTimesNoPhone')}
        </Hint>
      );
    }
    return (
      // The page holds still: "Pick a time" is fixed, and only the next days
      // scroll, in the room left under it (a short phone, or a row open).
      <View testID="lesson-times.grid" style={{ flex: 1, minHeight: 0, gap: space.l }}>
        <View style={{ gap: space.sm }}>
          {sectionTitle(t('coaching.guest.coach.pickTime'))}
          {weekCard}
        </View>
        <View style={{ flex: 1, minHeight: 0, gap: space.s }}>
          {sectionTitle(t('coaching.guest.coach.nextThreeDays'), t('coaching.guest.coach.tapDay'))}
          <ScrollView
            testID="lesson-times.next-days"
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              gap: space.s,
              paddingBottom: space.l + insets.bottom + (picked ? BOOK_BAR_SPACE : 0),
            }}
          >
            {booking.nights.slice(0, NEXT_DAYS).map(dayRow)}
          </ScrollView>
        </View>
      </View>
    );
  })();

  const first = dates[0];
  const last = dates[dates.length - 1];

  return (
    <Screen edges={[]} padded={false}>
      <Stack.Screen
        options={{
          title: '',
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: brand.white,
        }}
      />
      <View style={{ flex: 1 }}>
        {hero}
        <View
          style={{
            flex: 1,
            minHeight: 0,
            marginTop: -SHEET_OVERLAP,
            backgroundColor: colors.bg,
            borderTopStartRadius: SHEET_OVERLAP,
            borderTopEndRadius: SHEET_OVERLAP,
            paddingTop: space.l,
            paddingStart: space.l,
            paddingEnd: space.l,
            gap: space.m,
          }}
        >
          {notices}
          {self ? <MatchNotice text={t('coaching.guest.coach.self')} /> : null}
          {showTimes ? times : null}
        </View>
      </View>
      {first && last ? (
        // The date-of-birth wheel (Edit profile): Apple's wheel in the native
        // sheet on iOS, the system date dialog on Android; any night in the window.
        <DateWheelSheet
          testID="lesson-times.date-sheet"
          visible={pickerOpen}
          title={t('coaching.guest.coach.pickDate')}
          value={day ?? first}
          min={first}
          max={last}
          confirmLabel={t('common.done')}
          onConfirm={(night) => {
            if (dates.includes(night)) chooseDay(night);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <BookBar
        visible={!!(picked && pickedNight)}
        when={
          picked && pickedNight
            ? `${nightLabel(pickedNight)} · ${formatTime(picked.startAt, locale, tz)}`
            : null
        }
        price={offer.priceIqd != null ? money(offer.priceIqd) : null}
        bookLabel={t('coaching.guest.coach.bookLesson')}
        onBook={() => {
          if (picked) onTime(picked);
        }}
        bottom={insets.bottom + space.s}
        reduceMotion={reduceMotion}
      />
    </Screen>
  );
}

/**
 * A night's free starts in one sideways row, sized so three are in view and
 * snapping a whole time at a time. Ids are `slotTestID(testID, cell)`.
 */
function TimeRow({
  testID,
  cells,
  pickedAt,
  onPick,
  label,
}: {
  testID: string;
  cells: MergedCell[];
  pickedAt: number | null;
  onPick: (cell: MergedCell) => void;
  label: (cell: MergedCell) => string;
}) {
  const { colors, fonts } = useTheme();
  const [width, setWidth] = useState(0);
  const chipWidth = width > 0 ? (width - space.s * (TIMES_IN_VIEW - 1)) / TIMES_IN_VIEW : 96;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={chipWidth + space.s}
        decelerationRate="fast"
        contentContainerStyle={{ gap: space.s }}
      >
        {cells.map((cell) => {
          const on = cell.startAt.getTime() === pickedAt;
          return (
            <Pressable
              key={cell.startAt.getTime()}
              testID={slotTestID(testID, cell)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onPick(cell)}
              style={({ pressed }) => ({
                width: chipWidth,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.cell,
                backgroundColor: on ? colors.blue : pressed ? colors.seg : colors.sub,
              })}
            >
              <Text
                style={{
                  fontFamily: fonts.body700,
                  fontSize: 14,
                  color: on ? colors.card : colors.ink,
                }}
              >
                {label(cell)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** A row's arrow, turning from down to up as the row opens. */
function RowChevron({
  open,
  reduceMotion,
  color,
}: {
  open: boolean;
  reduceMotion: boolean;
  color: string;
}) {
  const [turn] = useState(() => new Animated.Value(open ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) {
      turn.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: EASE_MS,
      useNativeDriver: true,
    }).start();
  }, [open, reduceMotion, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <ChevronDownIcon size={18} color={color} strokeWidth={2.4} />
    </Animated.View>
  );
}

/** How long the book bar takes to rise in or sink away. */
const BAR_MS = 280;

/**
 * Design B's book bar: floating navy, the picked time, the price and Book. It
 * rises in (slides up, fades in, grows a touch) when a time is picked and
 * sinks away when it is unpicked, keeping its last words until it is gone.
 * Under Reduce Motion it appears and leaves at once.
 */
function BookBar({
  visible,
  when,
  price,
  bookLabel,
  onBook,
  bottom,
  reduceMotion,
}: {
  visible: boolean;
  when: string | null;
  price: string | null;
  bookLabel: string;
  onBook: () => void;
  bottom: number;
  reduceMotion: boolean;
}) {
  const { fonts } = useTheme();
  const [shown] = useState(() => new Animated.Value(visible ? 1 : 0));
  const [mounted, setMounted] = useState(visible);
  // The words it shows: the latest while visible, the last ones while leaving.
  const [words, setWords] = useState({ when, price });
  if (visible && !mounted) setMounted(true);
  if (visible && when && (when !== words.when || price !== words.price)) {
    setWords({ when, price });
  }

  useEffect(() => {
    Animated.timing(shown, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : BAR_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, reduceMotion, shown]);

  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={{
        position: 'absolute',
        start: space.sm,
        end: space.sm,
        bottom,
        opacity: shown,
        transform: [
          { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) },
          { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: brand.navy,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: brand.navyLine,
        paddingTop: space.sm,
        paddingBottom: space.sm,
        paddingStart: space.l,
        paddingEnd: space.sm,
        boxShadow: shadows.dialog,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body400, fontSize: 12.5, color: brand.navyText }}
        >
          {words.when}
        </Text>
        {words.price ? (
          <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: brand.white }}>
            {words.price}
          </Text>
        ) : null}
      </View>
      <Button
        testID="lesson-times.book"
        label={bookLabel}
        variant="cta"
        size="compact"
        onPress={onBook}
        style={{ borderRadius: radius.pill, paddingStart: space.xl, paddingEnd: space.xl }}
      />
    </Animated.View>
  );
}
