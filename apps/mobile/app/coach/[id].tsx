import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wallTimeToUtc } from '@touch/core';
import {
  countPhrase,
  formatDate,
  formatDayNumber,
  formatIQD,
  formatMonthShort,
  formatTime,
  formatWeekdayShort,
  isolate,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import {
  useGuestVenue,
  useIsDegraded,
  useVenueSettings,
} from '../../src/features/availability/hooks';
import { venuePhoneOf, type MergedCell } from '../../src/features/availability/assemble';
import { useCoachProfile } from '../../src/features/coaching/hooks';
import { useLessonBooking } from '../../src/features/coaching/useLessonBooking';
import { lessonErrorCode, lessonErrorText } from '../../src/features/coaching/errors';
import { coachShareUrl, isCoachId } from '../../src/features/coaching/links';
import { setOnlyPendingLesson } from '../../src/features/booking/pendingIntent';
import {
  classTarget,
  coachBranch,
  displayCoachName,
  pick,
  type ProfileOffer,
} from '../../src/features/coaching/logic';
import { useCoachStatus } from '../../src/features/coach/useCoachStatus';
import { callPhone } from '../../src/lib/phone';
import { brand, radius, shadows, space, useTheme } from '../../src/theme';
import { Button, Hint, Screen } from '../../src/components/ui';
import { DegradedBanner, slotTestID } from '../../src/components/booking';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { MatchNotice, MatchSectionTitle, ShareGlyph } from '../../src/components/match';
import { ClassRow, CoachHero, LessonTimePill, OfferRow } from '../../src/components/coaching';
import { useToast } from '../../src/components/overlays';

/** How far the name card rides up over the hero (Figma "D · Profile": the card overlaps the band). */
const CARD_OVERLAP = 56;
/** The hero's height below the status bar (Figma "D · Profile": 340 with the bar). */
const HERO_HEIGHT = 290;
/** Day cards shown at first, and how many more each "See more days" adds. */
const NIGHTS_STEP = 3;
/** The book bar's height above the home indicator (Figma "Book bar"). */
const BOOK_BAR_HEIGHT = 66;

/**
 * A coach's page (docs/design/coaching/guest.md §4.8.3): the card, the
 * lessons they offer at a branch, the private-lesson grid, their group
 * sessions and courses with places, and the branch's phone.
 *
 * The branch is the `venueId` param, else the guest's when the coach teaches
 * there, else the coach's first (R17: the `/c/<id>` link names none, so the
 * first read is the card with its branches, and the second the branch). The
 * choice is this screen's only: it never writes the stored branch.
 *
 * Layout is the Figma "D · Profile" frame: the photo full width under a
 * transparent native header, the name card over it, the lessons, then the free
 * times as one card per open night (three, then three more per "See more
 * days"). Tapping a time picks it; the book bar at the foot books it.
 *
 * Browsing is public: a signed-out Book keeps the intent (`pendingLesson`)
 * and opens the welcome. The grid is `useLessonBooking`'s;
 * only the server's free starts are cells, so nothing is greyed out. A paused
 * coach, the switch off, and the coach looking at their own page (R56) show a
 * line instead of the grid.
 */
export default function CoachDetailScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const params = useLocalSearchParams<{
    id?: string;
    venueId?: string;
    typeId?: string;
    date?: string;
  }>();
  const id = typeof params.id === 'string' && isCoachId(params.id) ? params.id : null;
  const venueParam = typeof params.venueId === 'string' && params.venueId ? params.venueId : null;
  const guest = useGuestVenue();
  // A reader while signed in, so coach_me is read here too: until it answers,
  // whether the viewer is this coach (R56: no grid on their own page) is not
  // known, and the grid waits behind a skeleton (MB-18).
  const me = useCoachStatus({ read: !!session });
  const meReading = !!session && me.status.kind === 'pending';

  // The first read: with the param's branch, or the link's read with none (R17).
  const first = useCoachProfile(id, venueParam);
  const firstVenue = first.data?.venue ?? null;
  const branchId =
    venueParam ??
    firstVenue?.venueId ??
    (first.data?.coach ? coachBranch(null, guest.venueId, first.data.coach.venueIds) : null);
  // The second read, only when the first named no branch.
  const second = useCoachProfile(
    !venueParam && first.data && !firstVenue && !first.data.off && branchId ? id : null,
    branchId,
  );
  const profile = firstVenue || venueParam ? first : second;
  const data = profile.data ?? null;
  const settings = useVenueSettings(branchId);
  const degraded = useIsDegraded(branchId);
  const venue = data?.venue ?? null;
  const phone = venue?.phone ?? venuePhoneOf(settings.data);
  const branchLabel = venue ? pick(venue.nameEn, venue.nameAr, locale) : '';
  const tz = venue?.timezone ?? settings.data?.timezone ?? 'Asia/Baghdad';

  const booking = useLessonBooking({
    coachId: id,
    settings: settings.data,
    timezone: venue?.timezone,
    offers: data?.offers ?? [],
    preselectTypeId: typeof params.typeId === 'string' ? params.typeId : null,
    preselectDate: typeof params.date === 'string' ? params.date : null,
  });

  const [bioOpen, setBioOpen] = useState(false);
  const [pickedAt, setPickedAt] = useState<number | null>(null);
  const [nightsShown, setNightsShown] = useState(NIGHTS_STEP);
  const scrollRef = useRef<ScrollView>(null);
  const sessionsY = useRef(0);

  const coach = data?.coach ?? first.data?.coach ?? null;
  const name = displayCoachName(coach, locale);
  const self = !!coach && me.coach?.id === coach.id;
  const paused = coach?.status === 'paused' || booking.status === 'paused';
  // coach_slots answering {off: true} is the profile's off, read later (MB-12).
  const off = !!data?.off || booking.status === 'off';
  const otherBranch = !!branchId && !!guest.venueId && branchId !== guest.venueId;
  const money = (n: number | null) => (n === null ? null : isolate(formatIQD(n, locale)));

  const callBranch = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  const onShare = () => {
    if (!coach) return;
    void Share.share({
      message: t('coaching.guest.coach.shareMessage', {
        name: isolate(name),
        url: coachShareUrl(coach.id),
      }),
    }).catch(() => {});
  };

  const onTime = (cell: MergedCell) => {
    if (!id || !branchId || !booking.typeId) return;
    const startAt = cell.startAt.toISOString();
    const priceIqd = booking.offer?.priceIqd ?? null;
    if (!session) {
      setOnlyPendingLesson({
        kind: 'private',
        coachId: id,
        lessonTypeId: booking.typeId,
        venueId: branchId,
        startAt,
        priceIqd,
      });
      router.push('/welcome');
      return;
    }
    router.push({
      pathname: '/lesson-review',
      params: {
        coachId: id,
        lessonTypeId: booking.typeId,
        venueId: branchId,
        startAt,
        ...(priceIqd !== null ? { priceIqd: String(priceIqd) } : {}),
      },
    });
  };

  const offerMeta = (o: ProfileOffer): string => {
    const parts = [t('coaching.common.durationMin', { minutes: o.durationMin })];
    if (o.kind === 'private') {
      parts.push(
        t('coaching.common.upTo', {
          people: countPhrase('coaching.common.count.people', o.maxPlaces, locale),
        }),
      );
    } else if (o.kind === 'group') {
      parts.push(countPhrase('coaching.common.count.places', o.maxPlaces, locale));
    } else if (o.kind === 'course' && o.sessionsCount !== null) {
      parts.push(countPhrase('coaching.common.count.sessions', o.sessionsCount, locale));
    }
    return parts.join(' · ');
  };

  // Over the photo the Android toolbar has no glass item, so its back arrow and
  // the share glyph go white; iOS 26 wraps both in Liquid Glass circles.
  const overPhoto = Platform.OS === 'android' ? brand.white : colors.blue;
  const headerFor = (transparent: boolean) => (
    <Stack.Screen
      options={{
        title: transparent ? '' : name || t('coaching.guest.coach.title'),
        headerTransparent: transparent,
        ...(transparent ? { headerTintColor: overPhoto } : {}),
        headerRight: coach
          ? () => (
              <Pressable
                testID="coach-detail.share"
                accessibilityRole="button"
                accessibilityLabel={t('coaching.guest.coach.share')}
                hitSlop={10}
                onPress={onShare}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.6 : 1,
                  paddingStart: 6,
                  paddingEnd: 6,
                })}
              >
                <ShareGlyph color={transparent ? overPhoto : colors.blue} />
              </Pressable>
            )
          : undefined,
      }}
    />
  );
  const header = headerFor(false);

  const notFound = (
    <EmptyState
      testID="coach-detail.not-found"
      actionTestID="coach-detail.see-all"
      fill
      title={t('coaching.guest.coach.notFound')}
      actionLabel={t('coaching.guest.coach.seeAll')}
      onAction={() => router.replace('/coaches')}
    />
  );

  if (!id) {
    return (
      <Screen edges={[]}>
        {header}
        {notFound}
      </Screen>
    );
  }

  const failed = profile.error ?? first.error;
  if (!data) {
    if (failed) {
      const code = lessonErrorCode(failed);
      return (
        <Screen edges={[]}>
          {header}
          {code === 'COACH_NOT_FOUND' ||
          code === 'COACH_NOT_AT_BRANCH' ||
          code === 'INVALID_ARGUMENT' ? (
            notFound
          ) : (
            <ErrorState
              testID="coach-detail.error"
              title={t('errors.loadFailedTitle')}
              message={lessonErrorText(failed, t, { locale, phone })}
              retryLabel={t('common.retry')}
              onRetry={() => {
                void first.refetch();
                void second.refetch();
              }}
            />
          )}
        </Screen>
      );
    }
    if (first.data?.off) {
      return (
        <Screen edges={[]}>
          {header}
          <View testID="coach-detail.off" style={{ paddingTop: space.m }}>
            <MatchNotice text={t('coaching.common.errors.off')} />
          </View>
        </Screen>
      );
    }
    return (
      <Screen edges={[]}>
        {header}
        <SkeletonList rows={3} height={96} />
      </Screen>
    );
  }

  const bio = coach ? pick(coach.bioEn, coach.bioAr, locale) : '';
  const showGrid = !off && !paused && !self && booking.types.length > 0;
  const todayLabel = formatDate(new Date(), locale, booking.tz);
  const nightLabel = (date: string) => {
    const noon = wallTimeToUtc(date, 12 * 60, booking.tz);
    const day = `${formatWeekdayShort(noon, locale, booking.tz)} ${formatDayNumber(noon, locale, booking.tz)} ${formatMonthShort(noon, locale, booking.tz)}`;
    return formatDate(noon, locale, booking.tz) === todayLabel
      ? `${t('common.today')} · ${day}`
      : day;
  };
  // A preselected date (a deep link) is always among the cards shown.
  const preIndex =
    typeof params.date === 'string'
      ? booking.nights.findIndex((n) => n.date === params.date)
      : -1;
  const nightsVisible = booking.nights.slice(0, Math.max(nightsShown, preIndex + 1));
  const pickedNight =
    pickedAt === null || !showGrid
      ? null
      : (booking.nights.find((n) => n.cells.some((c) => c.startAt.getTime() === pickedAt)) ??
        null);
  const picked = pickedNight?.cells.find((c) => c.startAt.getTime() === pickedAt) ?? null;
  const onPill = (cell: MergedCell) => {
    const at = cell.startAt.getTime();
    setPickedAt((cur) => (cur === at ? null : at));
  };

  const grid = (() => {
    if (!showGrid) return null;
    if (meReading) return <SkeletonList rows={2} height={60} />;
    return (
      <View style={{ gap: 10 }}>
        <MatchSectionTitle>{t('coaching.guest.coach.grid')}</MatchSectionTitle>
        {booking.status === 'loading' ? <SkeletonList rows={2} height={94} /> : null}
        {booking.status === 'error' ? (
          <ErrorState
            testID="coach-detail.slots-error"
            title={t('errors.loadFailedTitle')}
            message={t('coaching.guest.coach.error')}
            retryLabel={t('common.retry')}
            onRetry={booking.refetch}
          />
        ) : null}
        {booking.status === 'empty' ||
        (booking.status === 'ready' && booking.nights.length === 0) ? (
          <Hint>
            {phone
              ? t('coaching.guest.coach.noTimes', { branch: isolate(branchLabel) })
              : t('coaching.guest.coach.noTimesNoPhone')}
          </Hint>
        ) : null}
        {/* Figma "D · Profile": one white card per open night, headed by the
          day, its free starts as round pills. */}
        {nightsVisible.map((n) => (
          <View
            key={n.date}
            testID={`coach-detail.night.${n.date}`}
            style={{
              backgroundColor: colors.card,
              borderRadius: radius.card,
              paddingTop: space.sm,
              paddingBottom: space.sm,
              paddingStart: space.m,
              paddingEnd: space.m,
              gap: 10,
            }}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.mut }}>
              {nightLabel(n.date)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {n.cells.map((cell) => (
                <LessonTimePill
                  key={cell.startAt.getTime()}
                  testID={slotTestID('coach-detail.slot', cell)}
                  cell={cell}
                  time={formatTime(cell.startAt, locale, booking.tz)}
                  selected={cell.startAt.getTime() === pickedAt}
                  onPress={onPill}
                />
              ))}
            </View>
          </View>
        ))}
        {booking.nights.length > nightsVisible.length ? (
          <Pressable
            testID="coach-detail.more-days"
            accessibilityRole="button"
            onPress={() => setNightsShown(nightsVisible.length + NIGHTS_STEP)}
            style={({ pressed }) => ({
              alignSelf: 'center',
              minHeight: 44,
              justifyContent: 'center',
              paddingStart: space.l,
              paddingEnd: space.l,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: pressed ? colors.sub : colors.card,
            })}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.blue }}>
              {t('coaching.guest.coach.moreDays')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  })();

  return (
    <Screen edges={[]} padded={false}>
      {headerFor(true)}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingBottom: 40 + insets.bottom + (picked ? BOOK_BAR_HEIGHT : 0),
        }}
      >
        <CoachHero
          testID="coach-detail.hero"
          photoPath={coach?.photoPath ?? null}
          name={name}
          height={insets.top + HERO_HEIGHT}
        />
        <View style={{ paddingStart: space.l, paddingEnd: space.l, gap: space.sm }}>
          {/* The name card rides up over the hero (Figma "D · Profile"): name,
            branch, the "Taking bookings" badge while the grid is open, and the
            bio with More / Less. Not pressable (§4.8.3 item 1). */}
          <View
            style={{
              marginTop: -CARD_OVERLAP,
              backgroundColor: colors.card,
              borderRadius: radius.sheet,
              paddingTop: space.l,
              paddingBottom: space.l,
              paddingStart: space.l,
              paddingEnd: space.l,
              gap: space.sm,
              boxShadow: shadows.card,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: fonts.display800, fontSize: 22, color: colors.ink }}>
                  {name}
                </Text>
                {branchLabel ? (
                  <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
                    {otherBranch
                      ? t('coaching.common.atBranch', { branch: isolate(branchLabel) })
                      : branchLabel}
                  </Text>
                ) : null}
              </View>
              {showGrid && !meReading ? (
                <View
                  style={{
                    backgroundColor: colors.gtint,
                    borderRadius: 10,
                    paddingTop: 6,
                    paddingBottom: 6,
                    paddingStart: 10,
                    paddingEnd: 10,
                  }}
                >
                  <Text style={{ fontFamily: fonts.body700, fontSize: 12, color: colors.gtext }}>
                    {t('coaching.guest.coach.taking')}
                  </Text>
                </View>
              ) : null}
            </View>
            {bio ? (
              <View style={{ gap: 4 }}>
                <Text
                  numberOfLines={bioOpen ? undefined : 3}
                  style={{
                    fontFamily: fonts.body400,
                    fontSize: 14,
                    lineHeight: 21,
                    color: colors.mut2,
                  }}
                >
                  {bio}
                </Text>
                <Pressable
                  testID="coach-detail.bio-more"
                  accessibilityRole="button"
                  hitSlop={14}
                  onPress={() => setBioOpen((v) => !v)}
                  style={{ alignSelf: 'flex-start', minHeight: 24, justifyContent: 'center' }}
                >
                  <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.blue }}>
                    {t(bioOpen ? 'coaching.guest.coach.less' : 'coaching.guest.coach.more')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {degraded && phone ? (
            <DegradedBanner
              testID="coach-detail.degraded"
              tight
              message={t('degraded.bannerAvailability', { phone: isolate(phone) })}
              phone={phone}
            />
          ) : null}

          {off ? <MatchNotice text={t('coaching.common.errors.off')} /> : null}
          {paused ? <MatchNotice text={t('coaching.guest.coach.paused')} /> : null}
          {self ? <MatchNotice text={t('coaching.guest.coach.self')} /> : null}

          <View testID="coach-detail.offers" style={{ gap: space.s }}>
            <MatchSectionTitle>{t('coaching.guest.coach.offers')}</MatchSectionTitle>
            {data.offers
              .filter((o) => o.kind !== null)
              .map((o) => (
                <OfferRow
                  key={o.lessonTypeId}
                  testID={`coach-detail.offer.${o.lessonTypeId}`}
                  name={pick(o.nameEn, o.nameAr, locale)}
                  kind={t(`coaching.common.kinds.${o.kind!}`)}
                  meta={offerMeta(o)}
                  price={money(o.priceIqd)}
                  selected={o.kind === 'private' && o.lessonTypeId === booking.typeId && showGrid}
                  onPress={() => {
                    if (o.kind === 'private') {
                      // Another lesson type has its own starts and price.
                      if (o.lessonTypeId !== booking.typeId) setPickedAt(null);
                      booking.setTypeId(o.lessonTypeId);
                    }
                    else scrollRef.current?.scrollTo({ y: sessionsY.current, animated: true });
                  }}
                />
              ))}
          </View>

          {grid}

          {data.sessions.length > 0 ? (
            <View
              style={{ gap: space.s }}
              onLayout={(e) => {
                sessionsY.current = e.nativeEvent.layout.y;
              }}
            >
              <MatchSectionTitle>{t('coaching.guest.coach.sessions')}</MatchSectionTitle>
              {data.sessions.map((s) => {
                const target = classTarget(s);
                if (!target) return null;
                const type = data.offers.find((o) => o.lessonTypeId === s.lessonTypeId);
                const start = new Date(s.startAt);
                return (
                  <ClassRow
                    key={target.id}
                    testID={`coach-detail.session.${target.id}`}
                    kind={t(`coaching.common.kinds.${s.kind}`)}
                    title={
                      pick(s.titleEn, s.titleAr, locale) ||
                      (type ? pick(type.nameEn, type.nameAr, locale) : '')
                    }
                    coach={name}
                    when={`${formatWeekdayShort(start, locale, tz)} ${formatDate(start, locale, tz)} · ${formatTime(start, locale, tz)}`}
                    places={countPhrase('coaching.common.count.placesLeft', s.placesLeft, locale)}
                    price={money(s.priceIqd)}
                    onPress={() => router.push({ pathname: '/class/[id]', params: target })}
                  />
                );
              })}
            </View>
          ) : null}

          {phone && branchLabel ? (
            <Button
              testID="coach-detail.call-venue"
              label={t('coaching.guest.coach.questions', { branch: isolate(branchLabel) })}
              variant="ghost"
              onPress={callBranch}
              style={{ marginTop: space.m }}
            />
          ) : null}
        </View>
      </ScrollView>
      {picked && pickedNight ? (
        // Figma "Book bar": the picked time and the lesson's price, and Book.
        <View
          style={{
            position: 'absolute',
            start: 0,
            end: 0,
            bottom: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            paddingTop: space.m,
            paddingBottom: space.m + insets.bottom,
            paddingStart: space.l,
            paddingEnd: space.l,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
              {`${nightLabel(pickedNight.date)} · ${formatTime(picked.startAt, locale, booking.tz)}`}
            </Text>
            {booking.offer?.priceIqd != null ? (
              <Text style={{ fontFamily: fonts.display800, fontSize: 16, color: colors.gtext }}>
                {money(booking.offer.priceIqd)}
              </Text>
            ) : null}
          </View>
          <Button
            testID="coach-detail.book"
            label={t('coaching.guest.coach.bookLesson')}
            size="compact"
            onPress={() => onTime(picked)}
            style={{ borderRadius: radius.pill, paddingStart: space.xxl, paddingEnd: space.xxl }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
