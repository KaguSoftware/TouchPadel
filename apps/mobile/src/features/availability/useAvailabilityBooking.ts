/**
 * The availability + hold flow as ONE hook, behind the in-place booking sheet
 * that floats over the court on the Book tab (components/BookingSheet.tsx,
 * court → booking transition, design 2026-09-01). It was shared with a
 * standalone Availability screen until that was removed (owner, 2026-09-26);
 * every way in now opens the sheet.
 *
 * Extracted from that screen without behaviour change, so the sheet runs the
 * same flow: merged capacity across courts, trading-night day chips, a guest
 * tap → Welcome with the slot kept as pending intent, an incomplete profile →
 * complete-profile, degraded → desk-only cells and refusals.
 *
 * Merged availability (design 2026-08-31): ONE timeline across both courts —
 * each hour shows capacity; the desk assigns the physical court. A day chip is
 * a TRADING NIGHT (09:00 through the small hours of the next date), not a
 * calendar day — see assembleTradingNight.
 *
 * Open matches (docs/design/open-matches/guest.md §4.11) sit BESIDE the grid,
 * never in it: while the branch has them on and the sheet is open, one light
 * `match_slots` query feeds the chips (`matchLineFor`), the entry row and the
 * Book / Start / Join choice a tap on a free time may raise. With the switch
 * off none of it runs, and a tap holds exactly as before.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { pickLocale } from '@touch/core';
import {
  formatDayNumber,
  formatMonthShort,
  formatTime,
  formatWeekdayShort,
  isolate,
} from '@touch/i18n';
import { useLocale } from '../../i18n/LocaleProvider';
import {
  useCourts,
  useCourtsBroadcast,
  useDayGrid,
  useGuestVenue,
  useIsDegraded,
  useWarmDayGrids,
  useVenueSettings,
  type DayGrid,
} from './hooks';
import {
  DEFAULT_TZ,
  upcomingOnly,
  hasAnySlots,
  listBookableDates,
  mergeAcrossCourts,
  protectedHorizonEnd,
  venuePhoneOf,
  type MergedCell,
} from './assemble';
import {
  chipLines,
  entryLabelOf,
  joinableAhead,
  matchTargetOf,
  slotChoiceOptions,
} from './matchChips';
import { useHoldSlot } from '../booking/hooks';
import { type SlotOrigin } from '../booking/pendingSlot';
import { setOnlyPendingJoin, setOnlyPendingSlot } from '../booking/pendingIntent';
import { isDegradedRefusal, mapErrorToKey } from '../booking/errors';
import { useAuth } from '../auth/context';
import { bookingGateHref, bookingGateState } from '../auth/social';
import { useOwnProfile } from '../profile/hooks';
import { useFindMatchesAt, useMatchSlots } from '../matches/hooks';
import {
  canStartAt,
  chipKey,
  freeCourtsAt,
  matchesEnabled,
  slotActions,
  type SlotMatch,
} from '../matches/logic';
import { matchErrorText } from '../matches/errors';
import { pendingJoinHref, type PendingJoin } from '../matches/pendingJoin';
import { callPhone } from '../../lib/phone';
import { formatPrice } from '../../lib/price';
import { useToast } from '../../components/overlays';
import { nativeChoice } from '../../components/nativeChoice';

export type AvailabilityNotice = 'blocked' | 'horizon' | null;

export interface AvailabilityBooking {
  /** Venue timezone (day chips are venue-local). */
  tz: string;
  /** The strip: venue-local today + 6, led by a still-trading night. */
  tzDates: string[];
  date: string;
  /** A user pick — pins the selection so venue hours arriving later don't move it. */
  selectDate: (date: string) => void;
  durationMin: number;
  setDurationMin: (minutes: number) => void;
  /**
   * Identity of the grid ON SCREEN — the day and duration `cells` was actually
   * built for. Screens reset the grid's scroll offset on it, so the list goes
   * back to the top when the day or the duration changes.
   */
  gridKey: string;
  /** Offered durations across courts (falls back to 60/90). */
  durations: number[];
  day: DayGrid;
  cells: MergedCell[];
  /**
   * One lane per court, in the venue's court order: the court's name and its
   * own times, laid out horizontally ("Court 1: 1pm 2pm 3pm"). A tap on a lane
   * cell holds THAT court.
   */
  lanes: CourtLane[];
  /** The venue does not trade that day (closed date, or a grid with no slots at all). */
  closedDay: boolean;
  isClosedDate: (date: string) => boolean;
  phone: string | null;
  degraded: boolean;
  /** How many courts the merged cells stand for (footer copy). */
  courtCount: number;
  notice: AvailabilityNotice;
  dismissNotice: () => void;
  /** Clear the booking error once its alert has been dismissed. */
  dismissError: () => void;
  /** Hold refusal, already translated. */
  error: string | null;
  holdPending: boolean;
  onTapCell: (cell: MergedCell) => void;
  /** Price when free; state label otherwise. */
  subFor: (cell: MergedCell) => string;
  /** "2 courts free" / "1 court left" — empty when not free. */
  capacityLineFor: (cell: MergedCell) => string;
  onCall: () => void;
  /**
   * The open-match chip of a lane cell ('' for none), or undefined while the
   * branch has open matches off. Its identity follows the chips' answer and
   * the lanes, never the tap handler's.
   */
  matchLineFor: ((cell: MergedCell) => string) | undefined;
  /** The entry row under the courts, or null while the branch has open matches off. */
  matchEntry: { label: string; onPress: () => void } | null;
}

export interface CourtLane {
  courtId: string;
  /** Localised court name. */
  name: string;
  indoor: boolean;
  cells: MergedCell[];
}

export interface AvailabilityBookingOptions {
  /** Which surface mounts the hook — carried into Review and the pending slot so the flow returns here. */
  origin: SlotOrigin;
  /**
   * The sheet is open. The open-match chips are read only then (§4.11 rule
   * 3): a prewarmed, closed sheet polls nothing for them.
   */
  open?: boolean;
}

/** No chips: the stable answer while nothing is loaded. */
const NO_SLOT_MATCHES: readonly SlotMatch[] = [];

export function useAvailabilityBooking(
  { origin, open = false }: AvailabilityBookingOptions = { origin: 'sheet' },
): AvailabilityBooking {
  const { t, locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  // D3: a profile without a phone cannot book; the gate reuses the guest flow
  // (pending slot -> complete-profile -> hold). Neither can one whose phone was
  // never verified by a code (pending slot -> phone-sign-in -> verify-otp ->
  // hold). 'unknown' proceeds — Review re-checks.
  const profile = useOwnProfile(!!session);
  const profileGate = bookingGateState(profile, session?.user);
  const profilePhone = profile.data?.phone ?? '';
  // The branch the guest books at (multi-venue slice 4): its courts, its
  // settings, its degraded flag and its phone. hold_slot needs no branch — the
  // server takes it from the court.
  const { venueId } = useGuestVenue();
  const courts = useCourts(venueId);
  const venueSettings = useVenueSettings(venueId);
  const degraded = useIsDegraded(venueId);

  // One minute tick drives "past" cells and the day strip. The heavy grid
  // build (useDayGrid) is data-driven only; applying the clock is O(cells).
  //
  // NOT in a transition, for the reason the grid is not deferred either — see
  // the long note below: transition work on this screen waits out a five-second
  // deadline behind the rally's frame loop, and a clock that is five seconds
  // late is worse than one dropped frame a minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const tz = venueSettings.data?.timezone ?? DEFAULT_TZ;
  // Venue-local today + 6 days, re-derived every minute so an app left open
  // past midnight does not keep offering yesterday as "today" — except while
  // yesterday's night is still trading (until 02:00), when it leads the strip.
  const tzDates = useMemo(
    () => listBookableDates(now, tz, 6, venueSettings.data ?? undefined),
    [now, tz, venueSettings.data],
  );
  const [date, setDate] = useState<string>(() => tzDates[0] ?? '');
  // Until the guest picks a chip, the strip's first entry is the selection —
  // so the still-running night takes over once venue hours arrive (a cold
  // start used to land on today and a warm one, from the persisted cache, on
  // last night), and a date that drops off the strip falls back the same way.
  const picked = useRef(false);
  useEffect(() => {
    const first = tzDates[0];
    if (first === undefined) return;
    if (!tzDates.includes(date) || (!picked.current && date !== first)) setDate(first);
  }, [tzDates, date]);

  const durations = useMemo(() => {
    const set = new Set<number>();
    for (const c of courts.data ?? []) for (const d of c.duration_options) set.add(d);
    const out = [...set].sort((a, b) => a - b);
    return out.length > 0 ? out : [60, 90];
  }, [courts.data]);

  const [durationChoice, setDurationMin] = useState(60);
  // A branch whose courts do not offer the chosen length plays its shortest one
  // (the guest's pick comes back if they switch to a branch that offers it).
  const durationMin =
    courts.isSuccess && !durations.includes(durationChoice) ? (durations[0] ?? 60) : durationChoice;

  /**
   * THE GRID IS BUILT ON THE TAP, NOT DEFERRED. A note, because the obvious
   * React answer here is wrong on this screen and was tried.
   *
   * `date` and `durationMin` were briefly fed through `useDeferredValue`, so
   * that the chip lit up at once and the expensive half — assembling a trading
   * night, merging both courts, laying out every cell — followed at TRANSITION
   * priority, time-sliced, leaving frames for the court's rally (Court3D draws
   * it from a rAF loop on this same thread).
   *
   * That reasoning assumes the host eventually gives React's scheduler a clear
   * window, and a self-rescheduling frame loop did not: the new day's times
   * arrived a full five seconds after the chip was tapped (owner, 2026-09-10).
   * Smooth, and useless.
   *
   * The five seconds were not a coincidence and the mechanism is worth naming,
   * because it governs everything else on this tab: React's scheduler here is
   * the native RuntimeScheduler, whose queue is a min-heap on task expiry —
   * ImmediatePriority (every timer, and `requestAnimationFrame` IS a timer in
   * bridgeless RN) expires at once, NormalPriority (transitions, passive
   * effects, any setState off a promise) in five seconds. A frame loop that
   * always had its next timer queued therefore held the head of that queue
   * until the expiry. Court3D's `startLoop` no longer does that — it asks for
   * the next frame after drawing this one, which leaves the queue empty for the
   * gap — and its header carries the full story.
   *
   * A tap is still the right place for this work regardless: a touch is a
   * DISCRETE event, so what it sets renders synchronously and is never in that
   * queue at all.
   *
   * So the selection drives the grid directly and the work lands on the tap,
   * where it can be seen and measured. What made that affordable is everything
   * else: the ICU caching in @touch/core's `localParts` (620 formatToParts per
   * night down to 41), memoised cells that a re-render skips, the strip's rows
   * in one request, and `useWarmDayGrids` building every other chip ahead of
   * time — so the usual tap finds its grid already assembled and does nothing
   * at all. The rally rides the rest out on its capped clock (rallyClock.ts):
   * a frame or two dropped, never a jump.
   */
  // The strip goes in whole: its busy ranges come down in ONE request, so
  // moving between chips is never a round trip.
  const day = useDayGrid(date, tzDates);
  // And every OTHER chip's grid is assembled while the guest is reading this
  // one, so the tap that follows is neither a fetch nor a build.
  useWarmDayGrids(tzDates, date);
  useCourtsBroadcast(venueId); // live slot_changed -> availability invalidation

  const [notice, setNotice] = useState<AvailabilityNotice>(null);
  const [error, setError] = useState<string | null>(null);
  const hold = useHoldSlot();
  // Pulled out as their own values: `hold` and `day` are rebuilt by react-query
  // on every render, so depending on the objects would give `onTapCell` a new
  // identity each time — and a stable identity is what lets the memoised cells
  // skip a re-render (see onTapCell).
  const holdPending = hold.isPending;
  const holdMutate = hold.mutate;
  const refetchDay = day.refetch;

  // Transient state belongs to the branch, day and duration it happened on (a
  // refusal naming one branch's phone must not follow the guest to another).
  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [venueId, date, durationMin]);

  const phone = venuePhoneOf(day.settings);


  // Degraded desk-only window. Read from venue_settings.protected_horizon_hours,
  // because that is the exact column app.assert_not_degraded_for (0008) refuses
  // on: a client window narrower than the server's shows slots as free that the
  // server then refuses with DEGRADED_LOCKOUT the moment they are tapped.
  const horizonEnd = useMemo(
    () => (degraded ? protectedHorizonEnd(now, venueSettings.data ?? undefined) : null),
    [degraded, now, venueSettings.data],
  );

  // An hour that has already started is dropped, not greyed: the grid opens on
  // tonight's first bookable time and there is nothing above it to scroll back
  // to. The minute tick retires them one by one.
  const cells = useMemo(
    () => upcomingOnly(mergeAcrossCourts(day.grid, durationMin, horizonEnd, now), now),
    [day.grid, durationMin, horizonEnd, now],
  );
  // Per-court lanes (owner, 2026-09-26: show both courts separately). Each is
  // the same merge run over ONE court, so a cell's state, price and `courtId`
  // are that court's own, and the tap holds exactly the court it sits under.
  const lanes = useMemo((): CourtLane[] => {
    const byId = new Map(day.grid.map((c) => [c.courtId, c]));
    const ordered = [...(courts.data ?? [])].sort((x, y) => x.sort_order - y.sort_order);
    const out: CourtLane[] = [];
    for (const court of ordered) {
      const slots = byId.get(court.id);
      if (!slots) continue;
      const laneCells = upcomingOnly(mergeAcrossCourts([slots], durationMin, horizonEnd, now), now);
      if (laneCells.length === 0) continue;
      out.push({
        courtId: court.id,
        name: pickLocale({ en: court.name_en, ar: court.name_ar }, locale),
        indoor: court.indoor,
        cells: laneCells,
      });
    }
    return out;
  }, [day.grid, courts.data, durationMin, horizonEnd, now, locale]);

  // "Closed" means the venue does not trade that day. A duration that simply
  // has no priced slots is "no times", not "closed" — the old check compared
  // the COURT count, so picking 90 min on a 60-only tariff said VENUE CLOSED.
  const closedDay =
    (day.settings?.closed_dates ?? []).includes(date) ||
    (!day.isLoading && !day.isError && day.grid.length > 0 && !hasAnySlots(day.grid));

  const isClosedDate = (d: string) => (day.settings?.closed_dates ?? []).includes(d);

  // ── Open matches (guest.md §4.11) ─────────────────────────────────────────
  // The branch's switch, off the settings row this hook already reads (0257's
  // two knobs are declared on `VenueSettingsPublic`).
  const matchSettings = venueSettings.data;
  const matchesOn = matchesEnabled(matchSettings);
  const slots = useMatchSlots(venueId, { enabled: matchesOn && open, timezone: tz });
  // A disabled query still hands back what it cached: a switch turned off
  // since then shows nothing all the same (rule 1).
  const byStart = matchesOn ? slots.data : undefined;
  const refetchSlots = slots.refetch;
  const findMatchesAt = useFindMatchesAt();
  const chips = useMemo(
    () => (byStart ? chipLines(lanes, byStart, t, locale) : null),
    [lanes, byStart, t, locale],
  );
  const matchLineFor = useMemo(
    () =>
      chips
        ? (cell: MergedCell) =>
            cell.courtId ? (chips.get(chipKey(cell.courtId, cell.startAt.getTime())) ?? '') : ''
        : undefined,
    [chips],
  );
  /**
   * What a tap needs to know about matches, behind a ref (rule 6): the answer,
   * the lanes and the settings change with every poll and every minute, and as
   * dependencies of `onTapCell` they would hand all ~34 memoised cells a new
   * handler each time.
   */
  const live = useRef({ byStart, lanes, settings: matchSettings });
  useEffect(() => {
    live.current = { byStart, lanes, settings: matchSettings };
  }, [byStart, lanes, matchSettings]);
  /** One `open_matches` lookup at a time: a second tap waits for the first. */
  const finding = useRef(false);

  /** Today's path for a free time: hold it and go to Review. */
  const bookCell = useCallback((cell: MergedCell) => {
    if (!cell.courtId) return;
    const court = courts.data?.find((c) => c.id === cell.courtId);
    if (!session) {
      // Guest browsing: keep the intent, ask for an account, finish the hold
      // right after auth (pendingSlot flow). The latest intent is the one the
      // auth flow continues, so an older open-match or lesson one goes (MB-04).
      setOnlyPendingSlot({
        courtId: cell.courtId,
        startAt: cell.startAt.toISOString(),
        durationMin,
        priceIqd: cell.priceIqd,
        courtNameEn: court?.name_en ?? '',
        courtNameAr: court?.name_ar ?? '',
        origin,
      });
      router.push('/welcome');
      return;
    }
    const stop = bookingGateHref(profileGate, profilePhone);
    if (stop) {
      setOnlyPendingSlot({
        courtId: cell.courtId,
        startAt: cell.startAt.toISOString(),
        durationMin,
        priceIqd: cell.priceIqd,
        courtNameEn: court?.name_en ?? '',
        courtNameAr: court?.name_ar ?? '',
        origin,
      });
      router.push(stop);
      return;
    }

    holdMutate(
      { courtId: cell.courtId, startAt: cell.startAt, durationMin },
      {
        onSuccess: (result) => {
          router.push({
            pathname: '/review',
            params: {
              holdId: result.reservationId,
              // '' = no deadline (duplicate replay of a hold we already have).
              expiresAt: result.holdExpiresAt ?? '',
              priceIqd: String(result.priceIqd ?? cell.priceIqd ?? ''),
              // Both names: Review / Success pick at render, so a language
              // switch mid-checkout renames the court with the rest of the screen.
              courtNameEn: court?.name_en ?? '',
              courtNameAr: court?.name_ar ?? '',
              startAt: cell.startAt.toISOString(),
              durationMin: String(durationMin),
              origin,
              // 0252: Review shows the kind hold warning.
              holdWarning: result.holdWarning ? '1' : '',
            },
          });
        },
        onError: (err) => {
          if (isDegradedRefusal(err.message)) {
            // Latin digits inside an Arabic sentence: isolated, or the bidi
            // algorithm reorders the number's groups (here and in onCall).
            setError(
              phone
                ? t('degraded.bookingRefused', { phone: isolate(phone) })
                : t('degraded.bookingRefusedShort'),
            );
          } else {
            setError(t(mapErrorToKey(err)));
          }
          refetchDay();
        },
      },
    );
  }, [
    holdMutate,
    durationMin,
    courts.data,
    session,
    profileGate,
    profilePhone,
    origin,
    phone,
    refetchDay,
    router,
    t,
  ]);

  /**
   * "Join", "Your open match" or "Start an open match" on a free time. Signed
   * out, or signed in with no phone, the intent waits in `pendingJoin` for the
   * auth flow, which opens its screen and never joins by itself (§4.18).
   *
   * A start and a join end in a court booking, so a phone nobody has verified
   * stops them as it stops a hold (owner, 2026-09-29): /phone-sign-in in
   * continue mode, the intent still pending, exactly as `bookCell` does. The
   * guest's own match books nothing; only a missing phone stops it, as before.
   */
  const matchCell = useCallback(
    (action: 'join' | 'view-mine' | 'start', cell: MergedCell) => {
      if (!venueId || !cell.courtId) return;
      const startAt = cell.startAt.toISOString();
      const intent: PendingJoin =
        action === 'start'
          ? {
              kind: 'start',
              venueId,
              courtId: cell.courtId,
              startAt,
              durationMin,
              priceIqd: cell.priceIqd,
            }
          : { kind: 'slot', venueId, startAt };
      const stop = !session
        ? '/welcome'
        : action === 'view-mine' && profileGate !== 'incomplete'
          ? null
          : bookingGateHref(profileGate, profilePhone);
      if (stop) {
        setOnlyPendingJoin(intent);
        router.push(stop);
        return;
      }
      // A start holds nothing (OM-13): the form re-quotes, and the server decides.
      if (action === 'start') {
        router.push(pendingJoinHref(intent));
        return;
      }
      // `match_slots` carries no ids, so the minute is read once to find the match.
      if (finding.current) return;
      finding.current = true;
      findMatchesAt(venueId, cell.startAt)
        .then(
          (found) => {
            const target = matchTargetOf(action, found);
            if (target === null) {
              // Gone since the chip was drawn: say so, and redraw the chips.
              setError(t('matches.errors.notFound'));
              void refetchSlots();
            } else if (target === 'list') {
              router.push(pendingJoinHref(intent));
            } else {
              router.push({ pathname: '/match/[id]', params: { id: target.matchId } });
            }
          },
          (err: unknown) => setError(matchErrorText(err, t, { locale, timezone: tz, phone })),
        )
        .finally(() => {
          finding.current = false;
        });
    },
    [
      venueId,
      durationMin,
      session,
      profileGate,
      profilePhone,
      router,
      findMatchesAt,
      refetchSlots,
      t,
      locale,
      tz,
      phone,
    ],
  );

  /**
   * STABLE across renders, deliberately — `SlotCell` is memoised and takes this
   * function itself rather than a per-cell closure, so a re-render of the
   * surface (the day strip's selection moving, the minute tick, a refetch flag,
   * an open-match poll) skips all ~34 cells instead of re-running them. A new
   * identity here would quietly undo that; see the note on SlotCell. What it
   * reads about open matches comes through `live`, never as a dependency.
   *
   * With open matches on, a free time that has a match to join, or room to
   * start one, asks first in the platform's own sheet (§4.11: `slotActions`,
   * `nativeChoice`); `['book']` alone skips the sheet and holds as before.
   */
  const onTapCell = useCallback(
    (cell: MergedCell) => {
      if (holdPending) return; // one hold at a time — no double-tap races
      setError(null);
      if (cell.state === 'blocked') return setNotice('blocked');
      if (cell.state === 'horizon') return setNotice('horizon');
      if (cell.state !== 'free' || !cell.courtId) return;
      if (!matchesOn) return bookCell(cell);

      const ms = cell.startAt.getTime();
      const { byStart: known, lanes: shown, settings } = live.current;
      const slotMatches = known?.get(ms) ?? NO_SLOT_MATCHES;
      const actions = slotActions({
        slotMatches,
        canStart: canStartAt(settings, cell.startAt, new Date()),
        freeCourts: freeCourtsAt(shown, ms),
      });
      if (actions.length === 1) return bookCell(cell);

      const day = [
        formatWeekdayShort(cell.startAt, locale, tz),
        formatDayNumber(cell.startAt, locale, tz),
        formatMonthShort(cell.startAt, locale, tz),
      ].join(' ');
      void nativeChoice({
        title: t('matches.book.choiceTitle', { time: formatTime(cell.startAt, locale, tz), day }),
        message: actions.includes('start') ? t('matches.book.choiceMessage') : undefined,
        options: slotChoiceOptions(actions, slotMatches, t, locale),
        cancelLabel: t('common.cancel'),
      }).then((pick) => {
        if (pick === 'book') bookCell(cell);
        else if (pick) matchCell(pick, cell);
      });
    },
    [holdPending, matchesOn, bookCell, matchCell, t, locale, tz],
  );

  // The entry row (§4.11): the list on the selected night, or sign-in first.
  const joinable = useMemo(
    () => (byStart ? joinableAhead(byStart, now.getTime()) : 0),
    [byStart, now],
  );
  const signedIn = !!session;
  const onOpenMatches = useCallback(() => {
    if (!venueId) return;
    const intent: PendingJoin = { kind: 'list', venueId, date };
    if (!signedIn) {
      setOnlyPendingJoin(intent);
      router.push('/welcome');
      return;
    }
    router.push(pendingJoinHref(intent));
  }, [venueId, date, signedIn, router]);
  const matchEntry = useMemo(
    () =>
      matchesOn
        ? { label: entryLabelOf({ signedIn, joinable }, t, locale), onPress: onOpenMatches }
        : null,
    [matchesOn, signedIn, joinable, t, locale, onOpenMatches],
  );

  const subFor = useCallback((cell: MergedCell): string => {
    switch (cell.state) {
      case 'free':
        // A free slot with no price cannot be taken online, but the desk can
        // still book it — so the card says so rather than "Unavailable", which
        // would read as gone. `noRate`'s full sentence is written for the ERROR
        // path (NO_RATE) and truncated to "This slot cannot be..." here, where
        // the sibling states are all short labels.
        return formatPrice(cell.priceIqd, locale) ?? t('booking.callOnly');
      case 'booked':
        return t('booking.stateBooked');
      case 'held':
        return t('booking.stateHeld');
      case 'blocked':
        return t('booking.stateBlocked');
      case 'horizon':
        return t('booking.deskOnly');
      default:
        return '—';
    }
  }, [locale, t]);

  const capacityLineFor = useCallback(
    (cell: MergedCell): string =>
      cell.state === 'free'
        ? cell.freeCount > 1
          ? t('booking.capacityFree', { count: cell.freeCount })
          : t('booking.capacityOne')
        : '',
    [t],
  );

  const onCall = () => {
    if (!phone) return;
    void callPhone(phone).then((ok) => {
      if (!ok) toast(t('errors.callFailed', { phone: isolate(phone) }), 'error');
    });
  };

  return {
    tz,
    tzDates,
    date,
    selectDate: (d) => {
      picked.current = true;
      setDate(d);
    },
    durationMin,
    setDurationMin,
    gridKey: `${date}|${durationMin}`,
    durations,
    day,
    cells,
    lanes,
    closedDay,
    isClosedDate,
    phone,
    degraded,
    courtCount: courts.data?.length ?? 2,
    notice,
    dismissNotice: () => setNotice(null),
    dismissError: () => setError(null),
    error,
    holdPending: hold.isPending,
    onTapCell,
    subFor,
    capacityLineFor,
    onCall,
    matchLineFor,
    matchEntry,
  };
}
