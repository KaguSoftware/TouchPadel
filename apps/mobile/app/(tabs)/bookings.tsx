import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';
import { Text } from '../../src/i18n/text';
import { useRouter } from 'expo-router';
import { useTabBarHeight } from '../../src/components/useTabBarHeight';
import { formatDate, formatTime, formatTimeRange, formatWeekdayShort } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useMyBookings, useReleaseHold } from '../../src/features/booking/hooks';
import {
  playedCount,
  secondsUntil,
  splitBookings,
  startProximity,
  visiblePast,
  type BookingRow,
  type StartProximity,
} from '../../src/features/booking/logic';
import { useHistoryClearedAt } from '../../src/features/booking/history';
import { mapErrorToKey } from '../../src/features/booking/errors';
import {
  useCourts,
  useCourtsBroadcast,
  useIsDegraded,
  useVenueSettings,
} from '../../src/features/availability/hooks';
import { venuePhoneOf } from '../../src/features/availability/assemble';
import { useAuth } from '../../src/features/auth/context';
import { requestBookingSheet } from '../../src/features/courtTransition/openIntent';
import { formatPrice } from '../../src/lib/price';
import { radius, space, useTheme } from '../../src/theme';
import { Screen, Title } from '../../src/components/ui';
import {
  DegradedBanner,
  HeldSlotCard,
  ListHeading,
  NextUpCard,
  PastBookingRow,
  StatChip,
  UpcomingBookingRow,
} from '../../src/components/booking';
import {
  CalendarIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  PadelBallIcon,
  StopwatchIcon,
} from '../../src/components/icons';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';

/**
 * How many past games the tab itself carries (owner, 2026-09-08). The tab is
 * for what is NEXT; two recent games are enough to say "and here is what you
 * have been playing", and the rest belong in Booking history rather than in a
 * scroll that grows for the life of the account.
 */
const PAST_PREVIEW = 2;

/**
 * My reservations tab (design 2026-08-31; "more life" pass 2026-09-05).
 *
 * Upcoming as date-badge cards, Past as a muted list, both routing into booking
 * detail — cancellation lives THERE now. Signed-out shows the empty state with
 * a sign-in path (browsing is public).
 *
 * PAST IS A PREVIEW, not the archive (owner, 2026-09-08): the two most recent
 * games, then a link into app/booking-history.tsx, which holds the whole list
 * and the only way to clear it. The heading's count and the link both speak of
 * the FULL history, so the number on screen never contradicts the list.
 *
 * Above them sits HELD: slots the guest has taken but not confirmed (0058).
 * Nothing in the app used to show a hold, so a guest who left Review had no way
 * to check what was still held in their name — the only symptom was the fourth
 * slot tap failing with HOLD_QUOTA_EXCEEDED. Each hold can be finished or
 * handed straight back from here.
 *
 * What the "more life" pass changed (owner: the screen "reads like just a
 * list"), all presentation, no behaviour:
 *
 *  - the FIRST upcoming booking is promoted to a hero carrying the Book tab's
 *    brand line pattern, a countdown chip and the metadata as icon pairs, so
 *    the top of the tab is the next match rather than row one of a table;
 *  - section headings gained an icon, a rule and a count;
 *  - Past hangs off a timeline rail whose node colour says which games were
 *    actually played;
 *  - the middot-separated metadata line became labelled icon pairs everywhere.
 *
 * The pattern is ON THE HERO, not behind the page (owner). It ran full-bleed
 * here for a moment: under an opaque list it only ever surfaced in the margins
 * and the 9 px between cards, which is a texture nobody asked a booking list
 * for. On the card it lands where the eye is already going, and the list below
 * is left alone to be a list.
 */

export default function BookingsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const router = useRouter();
  const tabBarHeight = useTabBarHeight();
  const { session } = useAuth();
  const bookings = useMyBookings();
  const courts = useCourts();
  const settings = useVenueSettings();
  const degraded = useIsDegraded();
  // Closed by the guest, not by a timer or a refetch — see `notice` below.
  const [noticeClosed, setNoticeClosed] = useState(false);
  const release = useReleaseHold();
  const cleared = useHistoryClearedAt();
  const toast = useToast();
  useCourtsBroadcast(); // desk moves/cancels reflect live

  // The upcoming/past boundary follows the clock, not the last data change —
  // a booking that ended while the screen was open used to stay "Upcoming".
  // The hero's countdown rides the same minute tick.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // "Book your next game →": the Book tab owns the day picker now, so hand it
  // the intent and switch tabs — it plays the court → booking transition on
  // focus instead of stack-pushing the standalone grid over this screen.
  const bookNext = useCallback(() => {
    requestBookingSheet();
    router.navigate('/(tabs)');
  }, [router]);

  const { holds, upcoming, past } = useMemo(
    () => splitBookings(bookings.data ?? [], now),
    [bookings.data, now],
  );
  // Everything below counts the VISIBLE past, so a cleared history takes the
  // "N played" chip and the empty state with it rather than leaving numbers
  // that describe a list nobody can see.
  const history = useMemo(() => visiblePast(past, cleared.data ?? null), [past, cleared.data]);
  const pastPreview = useMemo(() => history.slice(0, PAST_PREVIEW), [history]);
  const played = useMemo(() => playedCount(history), [history]);

  // A hold's countdown has to move every second, but re-splitting the whole
  // list that often is waste — so the seconds tick is its own state and runs
  // ONLY while a hold is on screen. It stops on its own when the last one goes.
  const [holdNow, setHoldNow] = useState(() => new Date());
  const hasHolds = holds.length > 0;
  useEffect(() => {
    if (!hasHolds) return;
    setHoldNow(new Date());
    const id = setInterval(() => setHoldNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, [hasHolds]);

  // An expiring countdown must not just freeze at 0:00: the row is gone
  // server-side, so re-split (and refetch, which also frees the grid view).
  useEffect(() => {
    if (holds.some((h) => secondsUntil(h.hold_expires_at ?? null, holdNow) === 0)) {
      setNow(new Date());
      void bookings.refetch();
    }
    // `bookings` is a stable query object; the tick is what drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdNow, holds]);

  // O(1) lookup instead of a per-row find.
  const courtNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courts.data ?? []) {
      m.set(c.id, pickLocale({ en: c.name_en, ar: c.name_ar }, locale));
    }
    return m;
  }, [courts.data, locale]);

  const sections = useMemo(
    () => [
      { title: t('booking.upcoming'), key: 'upcoming', data: upcoming },
      { title: t('booking.past'), key: 'past', data: pastPreview },
    ],
    [t, upcoming, pastPreview],
  );

  // Pick the hold back up where Review left it. Everything the screen needs is
  // on the row, so this never depends on the tap that created the hold.
  const resumeHold = (row: BookingRow) =>
    router.push({
      pathname: '/review',
      params: {
        holdId: row.id,
        expiresAt: row.hold_expires_at ?? '',
        priceIqd: row.price_iqd == null ? '' : String(row.price_iqd),
        courtName: courtNames.get(row.court_id) ?? '',
        startAt: row.start_at,
        durationMin: String(
          Math.round(
            (new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000,
          ),
        ),
      },
    });

  const releaseHold = (row: BookingRow) =>
    release.mutate(row.id, {
      onSuccess: () => toast(t('booking.holdReleasedToast'), 'info'),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });

  const heldSection = holds.length > 0 && (
    <View>
      <ListHeading
        icon={StopwatchIcon}
        label={t('booking.heldSection')}
        count={holds.length}
        style={{ marginTop: 6 }}
      />
      {holds.map((row) => {
        const left = secondsUntil(row.hold_expires_at ?? null, holdNow) ?? 0;
        const start = new Date(row.start_at);
        return (
          <HeldSlotCard
            key={row.id}
            courtName={courtNames.get(row.court_id) ?? ''}
            when={`${formatDate(start, locale)} · ${formatTimeRange(start, new Date(row.end_at), locale)}`}
            price={formatPrice(row.price_iqd, locale)}
            countdown={`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
            urgent={left <= 60}
            busy={release.isPending && release.variables === row.id}
            onResume={() => resumeHold(row)}
            onRelease={() => releaseHold(row)}
          />
        );
      })}
      <Text
        style={{
          marginTop: 8,
          fontFamily: fonts.body400,
          fontSize: 11.5,
          lineHeight: 17,
          color: colors.fnt,
        }}
      >
        {t('booking.heldSectionBody')}
      </Text>
    </View>
  );

  // Two counted facts under the title. "Played" counts only the games the guest
  // turned up for — a tally that included cancellations would be the one number
  // on the screen that lies.
  const stats =
    upcoming.length > 0 || played > 0 ? (
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 2, marginBottom: 4 }}
      >
        {upcoming.length > 0 ? (
          <StatChip
            icon={CalendarIcon}
            label={t('booking.upcomingCount', { count: upcoming.length })}
            accent
          />
        ) : null}
        {played > 0 ? (
          <StatChip icon={CheckIcon} label={t('booking.playedCount', { count: played })} />
        ) : null}
      </View>
    ) : null;

  const phone = venuePhoneOf(settings.data);

  /**
   * The venue notice sits in flow under the heading and stays until the guest
   * closes it — a refetch flipping `degraded` back on must not resurrect one
   * they have already dealt with. It rides inside the header, so it survives
   * the screen flipping between loading, error, empty and list.
   */
  const notice =
    degraded && !noticeClosed ? (
      <View style={{ marginTop: 2, marginBottom: space.s }}>
        <DegradedBanner
          lead={t('degraded.leadConnectionLost')}
          message={t('degraded.bannerBookings', { phone: phone ?? '' })}
          phone={phone}
          blockLead
          onDismiss={() => setNoticeClosed(true)}
        />
      </View>
    ) : null;

  const header = (
    <View style={{ paddingTop: space.l }}>
      <Title>{t('booking.myBookings')}</Title>
      {notice}
      {stats}
      {heldSection}
    </View>
  );

  const bottomPad = { paddingBottom: tabBarHeight + 24 };

  // "Book your next game" in dark mode (owner, 2026-09-08). Light draws it as a
  // dashed placeholder on a white card — a shape waiting to be filled. In blue
  // mode that same recipe is a navy card inside a navy page with the brand blue
  // as its dashes: the one action on an empty tab came out as a dark rectangle.
  // So dark grounds it in the green tint the CTA already owns and puts the
  // brand green on the words — the ball above them was green all along.
  const dark = appearance === 'dark';
  const emptyLink = dark
    ? { bg: colors.gtint, border: colors.gline, lead: colors.gtext2, cta: colors.gtext }
    : { bg: colors.card, border: colors.line2, lead: colors.mut, cta: colors.mut };

  // Signed-out: same empty state, with the sign-in path.
  if (!session) {
    return (
      <Screen>
        {header}
        <View style={[{ flex: 1 }, bottomPad]}>
          <EmptyState
            fill
            title={t('booking.noBookingsTitle')}
            message={t('auth.signedOutPitch')}
            actionLabel={t('auth.signIn')}
            onAction={() => router.push('/welcome')}
          />
        </View>
      </Screen>
    );
  }

  if (bookings.isLoading) {
    return (
      <Screen>
        {header}
        <SkeletonList rows={3} height={78} />
      </Screen>
    );
  }

  // An error is never presented as "no bookings" — that lie shipped once.
  if (bookings.isError) {
    return (
      <Screen>
        {header}
        <View style={[{ flex: 1 }, bottomPad]}>
          <ErrorState
            title={t('errors.loadFailedTitle')}
            message={t(mapErrorToKey(bookings.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void bookings.refetch()}
            busy={bookings.isRefetching}
          />
        </View>
      </Screen>
    );
  }

  // A held slot counts: showing "No bookings yet" over a live hold is exactly
  // the blind spot this section exists to close.
  const noBookings = holds.length === 0 && upcoming.length === 0 && history.length === 0;

  // "In 2 days" / "On now" for the hero's chip. The unit steps hand off exactly
  // (see startProximity), so there is no gap that renders an empty chip; days
  // takes a singular of its own because the catalogs carry no plural rules.
  const proximityLabel = (p: StartProximity) => {
    switch (p.unit) {
      case 'live':
        return t('booking.onNow');
      case 'now':
        return t('booking.startsNow');
      case 'minutes':
        return t('booking.startsInMinutes', { count: p.value });
      case 'hours':
        return t('booking.startsInHours', { count: p.value });
      case 'days':
        return p.value === 1
          ? t('booking.startsInDay')
          : t('booking.startsInDays', { count: p.value });
    }
  };

  const openBooking = (id: string) =>
    router.push({ pathname: '/booking/[id]', params: { id } });

  const durationLabel = (row: BookingRow) =>
    t('booking.durationMinutes', {
      minutes: Math.round(
        (new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000,
      ),
    });

  // The hero: the very next game, out of the list and onto the brand's navy.
  const renderHero = (item: BookingRow) => {
    const start = new Date(item.start_at);
    const proximity = startProximity(item, now);
    return (
      <NextUpCard
        label={t('booking.nextUp')}
        courtName={courtNames.get(item.court_id) ?? ''}
        status={item.status}
        when={`${formatWeekdayShort(start, locale)} · ${formatDate(start, locale)}`}
        timeRange={formatTimeRange(start, new Date(item.end_at), locale)}
        // A slot with no price still has a duration: the footer row never
        // renders an orphaned tag glyph with nothing beside it.
        price={formatPrice(item.price_iqd, locale) ?? durationLabel(item)}
        proximity={proximityLabel(proximity)}
        imminent={proximity.unit !== 'hours' && proximity.unit !== 'days'}
        ctaLabel={t('booking.viewBooking')}
        onPress={() => openBooking(item.id)}
      />
    );
  };

  const renderUpcoming = (item: BookingRow) => {
    const start = new Date(item.start_at);
    return (
      <UpcomingBookingRow
        date={start}
        courtName={courtNames.get(item.court_id) ?? ''}
        // The date badge already carries month and day; the row adds the
        // weekday, which is the part of "when" a badge cannot show.
        weekday={formatWeekdayShort(start, locale)}
        timeRange={formatTimeRange(start, new Date(item.end_at), locale)}
        price={formatPrice(item.price_iqd, locale)}
        status={item.status}
        onPress={() => openBooking(item.id)}
      />
    );
  };

  const renderPast = (item: BookingRow, index: number, total: number) => {
    const start = new Date(item.start_at);
    return (
      <PastBookingRow
        courtName={courtNames.get(item.court_id) ?? ''}
        when={`${formatDate(start, locale)} · ${formatTime(start, locale)}`}
        price={formatPrice(item.price_iqd, locale)}
        status={item.status}
        first={index === 0}
        last={index === total - 1}
        onPress={() => openBooking(item.id)}
      />
    );
  };

  return (
    <Screen>
      {noBookings ? (
        <>
          {header}
          <View style={[{ flex: 1 }, bottomPad]}>
            <EmptyState
              fill
              title={t('booking.noBookingsTitle')}
              message={t('booking.noBookingsBody')}
              actionLabel={t('booking.title')}
              onAction={() => router.push('/availability')}
            />
          </View>
        </>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={bottomPad}
          refreshControl={
            <RefreshControl
              refreshing={bookings.isRefetching}
              onRefresh={() => void bookings.refetch()}
              tintColor={colors.blue}
            />
          }
          renderSectionHeader={({ section }) =>
            section.data.length > 0 || section.key === 'upcoming' ? (
              <ListHeading
                icon={section.key === 'past' ? ClockIcon : CalendarIcon}
                label={section.title}
                count={section.key === 'past' ? history.length : section.data.length}
                style={{ marginTop: section.key === 'past' ? 22 : 6 }}
              />
            ) : null
          }
          renderSectionFooter={({ section }) =>
            section.key === 'past' ? (
              history.length > PAST_PREVIEW ? (
                // Indented past the rail so the link starts where the cards do
                // and the timeline reads as ending above it, not through it.
                <Pressable
                  accessibilityRole="link"
                  onPress={() => router.push('/booking-history')}
                  style={({ pressed }) => ({
                    marginStart: 22,
                    marginTop: 2,
                    backgroundColor: pressed ? colors.sub : colors.card,
                    borderWidth: 1,
                    borderColor: colors.line,
                    borderRadius: radius.cell,
                    paddingStart: space.sm,
                    paddingEnd: space.sm,
                    paddingTop: 12,
                    paddingBottom: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s,
                  })}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: fonts.body700,
                      fontSize: 12.5,
                      color: colors.mut2,
                    }}
                  >
                    {t('booking.viewAllPast', { count: history.length })}
                  </Text>
                  <ChevronIcon size={15} color={colors.fnt2} />
                </Pressable>
              ) : null
            ) : section.data.length === 0 && section.key === 'upcoming' ? (
              <Pressable
                accessibilityRole="link"
                onPress={bookNext}
                style={({ pressed }) => ({
                  marginTop: 9,
                  backgroundColor: emptyLink.bg,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: emptyLink.border,
                  borderRadius: radius.button,
                  paddingStart: space.l,
                  paddingEnd: space.l,
                  paddingTop: 18,
                  paddingBottom: 18,
                  alignItems: 'center',
                  gap: 8,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <PadelBallIcon size={30} opacity={0.9} />
                <Text
                  style={{
                    fontFamily: fonts.body400,
                    fontSize: 12.5,
                    color: emptyLink.lead,
                    textAlign: 'center',
                  }}
                >
                  {t('booking.emptyUpcoming')}{' '}
                  <Text style={{ fontFamily: fonts.body800, color: emptyLink.cta }}>
                    {t('booking.bookNext')}
                  </Text>
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item, index, section }) =>
            section.key === 'upcoming'
              ? index === 0
                ? renderHero(item)
                : renderUpcoming(item)
              : renderPast(item, index, section.data.length)
          }
        />
      )}
    </Screen>
  );
}
