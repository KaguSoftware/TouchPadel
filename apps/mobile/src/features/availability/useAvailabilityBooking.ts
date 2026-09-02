/**
 * The availability + hold flow as ONE hook, shared by the standalone
 * Availability screen (app/availability.tsx) and the in-place booking sheet
 * that floats over the court on the Book tab (components/BookingSheet.tsx,
 * court → booking transition, design 2026-09-01).
 *
 * Extracted from the screen without behaviour change so both surfaces run the
 * same flow: merged capacity across courts, trading-night day chips, a guest
 * tap → Welcome with the slot kept as pending intent, an incomplete profile →
 * complete-profile, degraded → desk-only cells and refusals.
 *
 * Merged availability (design 2026-08-31): ONE timeline across both courts —
 * each hour shows capacity; the desk assigns the physical court. A day chip is
 * a TRADING NIGHT (09:00 through the small hours of the next date), not a
 * calendar day — see assembleTradingNight.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { isolate } from '@touch/i18n';
import { useLocale } from '../../i18n/LocaleProvider';
import {
  useCourts,
  useCourtsBroadcast,
  useDayGrid,
  useIsDegraded,
  useVenueSettings,
  type DayGrid,
} from './hooks';
import {
  DEFAULT_TZ,
  firstUpcomingIndex,
  hasAnySlots,
  listBookableDates,
  mergeAcrossCourts,
  protectedHorizonEnd,
  venuePhoneOf,
  type MergedCell,
} from './assemble';
import { useHoldSlot } from '../booking/hooks';
import { setPendingSlot, type SlotOrigin } from '../booking/pendingSlot';
import { isDegradedRefusal, mapErrorToKey } from '../booking/errors';
import { useAuth } from '../auth/context';
import { profileGateState } from '../auth/social';
import { useOwnProfile } from '../profile/hooks';
import { callPhone } from '../../lib/phone';
import { chunkArray } from '../../lib/chunk';
import { formatPrice } from '../../lib/price';
import { useToast } from '../../components/overlays';

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
  /** Offered durations across courts (falls back to 60/90). */
  durations: number[];
  day: DayGrid;
  cells: MergedCell[];
  /** Rows of two: an odd trailing cell stays half width (design `repeat(2, 1fr)`). */
  rows: MergedCell[][];
  /**
   * The row the grid should open on — the first one holding a time that has not
   * started yet. 0 on a future day (nothing is past) and whenever the whole
   * night has run out.
   */
  openRow: number;
  /** The venue does not trade that day (closed date, or a grid with no slots at all). */
  closedDay: boolean;
  isClosedDate: (date: string) => boolean;
  phone: string | null;
  degraded: boolean;
  /** How many courts the merged cells stand for (footer copy). */
  courtCount: number;
  notice: AvailabilityNotice;
  dismissNotice: () => void;
  /** Hold refusal, already translated. */
  error: string | null;
  holdPending: boolean;
  onTapCell: (cell: MergedCell) => void;
  /** Price when free; state label otherwise. */
  subFor: (cell: MergedCell) => string;
  /** "2 courts free" / "1 court left" — empty when not free. */
  capacityLineFor: (cell: MergedCell) => string;
  onCall: () => void;
}

export interface AvailabilityBookingOptions {
  /** Which surface mounts the hook — carried into Review and the pending slot so the flow returns here. */
  origin: SlotOrigin;
}

export function useAvailabilityBooking(
  { origin }: AvailabilityBookingOptions = { origin: 'screen' },
): AvailabilityBooking {
  const { t, locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { session } = useAuth();
  // D3: a profile without a phone cannot book; the gate reuses the guest flow
  // (pending slot -> complete-profile -> hold). 'unknown' proceeds — Review re-checks.
  const profile = useOwnProfile(!!session);
  const profileGate = profileGateState(profile);
  const courts = useCourts();
  const venueSettings = useVenueSettings();
  const degraded = useIsDegraded();

  // One minute tick drives "past" cells and the day strip. The heavy grid
  // build (useDayGrid) is data-driven only; applying the clock is O(cells).
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
    () => listBookableDates(now, tz, 6, venueSettings.data),
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

  const [durationMin, setDurationMin] = useState(60);
  const day = useDayGrid(date);
  useCourtsBroadcast(); // live slot_changed -> availability invalidation

  const [notice, setNotice] = useState<AvailabilityNotice>(null);
  const [error, setError] = useState<string | null>(null);
  const hold = useHoldSlot();

  // Transient state belongs to the day/duration it happened on.
  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [date, durationMin]);

  const phone = venuePhoneOf(day.settings);

  const durations = useMemo(() => {
    const set = new Set<number>();
    for (const c of courts.data ?? []) for (const d of c.duration_options) set.add(d);
    const out = [...set].sort((a, b) => a - b);
    return out.length > 0 ? out : [60, 90];
  }, [courts.data]);

  // Degraded desk-only window. Read from venue_settings.protected_horizon_hours,
  // because that is the exact column app.assert_not_degraded_for (0008) refuses
  // on: a client window narrower than the server's shows slots as free that the
  // server then refuses with DEGRADED_LOCKOUT the moment they are tapped.
  const horizonEnd = useMemo(
    () => (degraded ? protectedHorizonEnd(now, venueSettings.data) : null),
    [degraded, now, venueSettings.data],
  );

  const cells = useMemo(
    () => mergeAcrossCourts(day.grid, durationMin, horizonEnd, now),
    [day.grid, durationMin, horizonEnd, now],
  );
  // Rows of two: an odd trailing cell stays half width (design `repeat(2, 1fr)`).
  const rows = useMemo(() => chunkArray(cells, 2), [cells]);
  // Two cells to a row, so the cell index halves into a row index. The minute
  // tick can move this by a row; the surfaces only ever act on it when the day
  // or the duration changes, so the list is never yanked under a reading guest.
  const openRow = useMemo(() => Math.floor(firstUpcomingIndex(cells) / 2), [cells]);

  // "Closed" means the venue does not trade that day. A duration that simply
  // has no priced slots is "no times", not "closed" — the old check compared
  // the COURT count, so picking 90 min on a 60-only tariff said VENUE CLOSED.
  const closedDay =
    (day.settings?.closed_dates ?? []).includes(date) ||
    (!day.isLoading && !day.isError && day.grid.length > 0 && !hasAnySlots(day.grid));

  const isClosedDate = (d: string) => (day.settings?.closed_dates ?? []).includes(d);

  const onTapCell = (cell: MergedCell) => {
    if (hold.isPending) return; // one hold at a time — no double-tap races
    setError(null);
    if (cell.state === 'blocked') return setNotice('blocked');
    if (cell.state === 'horizon') return setNotice('horizon');
    if (cell.state !== 'free' || !cell.courtId) return;

    const court = courts.data?.find((c) => c.id === cell.courtId);
    if (!session) {
      // Guest browsing: keep the intent, ask for an account, finish the hold
      // right after auth (pendingSlot flow).
      setPendingSlot({
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
    if (profileGate === 'incomplete') {
      setPendingSlot({
        courtId: cell.courtId,
        startAt: cell.startAt.toISOString(),
        durationMin,
        priceIqd: cell.priceIqd,
        courtNameEn: court?.name_en ?? '',
        courtNameAr: court?.name_ar ?? '',
        origin,
      });
      router.push({ pathname: '/complete-profile', params: { returnTo: 'continue' } });
      return;
    }

    hold.mutate(
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
          day.refetch();
        },
      },
    );
  };

  const subFor = (cell: MergedCell): string => {
    switch (cell.state) {
      case 'free':
        return formatPrice(cell.priceIqd, locale) ?? t('booking.noRate');
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
  };

  const capacityLineFor = (cell: MergedCell): string =>
    cell.state === 'free'
      ? cell.freeCount > 1
        ? t('booking.capacityFree', { count: cell.freeCount })
        : t('booking.capacityOne')
      : '';

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
    durations,
    day,
    cells,
    rows,
    openRow,
    closedDay,
    isClosedDate,
    phone,
    degraded,
    courtCount: courts.data?.length ?? 2,
    notice,
    dismissNotice: () => setNotice(null),
    error,
    holdPending: hold.isPending,
    onTapCell,
    subFor,
    capacityLineFor,
    onCall,
  };
}
