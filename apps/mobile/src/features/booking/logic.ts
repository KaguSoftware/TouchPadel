/**
 * Pure booking helpers — no RN / supabase imports (unit-tested under node).
 */
import { localParts } from '@touch/core';

/** Shape of the jsonb returned by app.hold_slot (migration 0008). */
export interface HoldResult {
  duplicate: boolean;
  reservationId: string;
  holdExpiresAt: string | null;
  rateRuleId: string | null;
  priceIqd: number | null;
}

/** Parse app.hold_slot's jsonb payload. Throws on malformed payloads. */
export function parseHoldResult(json: unknown): HoldResult {
  if (!json || typeof json !== 'object') throw new Error('MALFORMED_HOLD_RESULT');
  const o = json as Record<string, unknown>;
  if (typeof o.reservation_id !== 'string') throw new Error('MALFORMED_HOLD_RESULT');
  return {
    duplicate: o.duplicate === true,
    reservationId: o.reservation_id,
    holdExpiresAt: typeof o.hold_expires_at === 'string' ? o.hold_expires_at : null,
    rateRuleId: typeof o.rate_rule_id === 'string' ? o.rate_rule_id : null,
    priceIqd: typeof o.price_iqd === 'number' ? o.price_iqd : null,
  };
}

/**
 * Whole seconds remaining until an ISO timestamp; never negative. `null` means
 * "no deadline" — distinct from 0 ("deadline passed"). app.hold_slot returns
 * hold_expires_at = null on its duplicate-replay path (re-tapping a slot you
 * already hold), and conflating the two rendered that Review screen as
 * "HOLD EXPIRED" the instant it opened.
 */
export function secondsUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** Own-reservation row subset used by the bookings screen. */
export interface BookingRow {
  id: string;
  court_id: string;
  kind: string;
  status: string;
  start_at: string;
  end_at: string;
  price_iqd: number | null;
  /** kind='hold' only; the TTL deadline (0008). Absent on bookings. */
  hold_expires_at?: string | null;
  /**
   * Who cancelled it (0088): 'guest' — this account, in the app — or 'staff',
   * meaning the desk. Null on anything that was not cancelled, AND on a
   * cancellation older than 0088 whose actor nobody recorded, which is why
   * every reader here treats null as "not known" rather than as a value.
   */
  cancelled_by?: string | null;
  /**
   * The court fee already settled on this booking, and what is still owed
   * (app.my_reservations, 0150). Optional because a row that came from
   * somewhere else — a fixture, an older cached payload — simply does not
   * know, and "does not know" must not read as "paid".
   */
  court_paid_iqd?: number | null;
  court_remaining_iqd?: number | null;
  /**
   * When the booking stopped being live — cancelled, marked no-show, or
   * closed as played (0075 sets it for all three). This is the moment it
   * BECAME history, which is a different question from when its slot ends.
   */
  cancelled_at?: string | null;
}

/**
 * The court fee on this booking has been settled in full.
 *
 * BOTH figures are required, and this is the reason: `court_fee_remaining`
 * returns 0 for a booking that is only `pending` — nobody owes anything on a
 * slot that was never confirmed — so "nothing remaining" on its own would put
 * "payment received" on a booking no one has paid for. Something must also have
 * been taken.
 *
 * Unknown (either figure absent) is NOT paid: the guest sees how to pay, which
 * is the safe way to be wrong.
 */
export function isCourtFeePaid(row: BookingRow): boolean {
  const paid = row.court_paid_iqd;
  const remaining = row.court_remaining_iqd;
  if (typeof paid !== 'number' || typeof remaining !== 'number') return false;
  return remaining === 0 && paid > 0;
}

/** Which half of the day the VENUE is in — the clock the guest will be standing in. */
export type DayPart = 'day' | 'evening';

/**
 * Venue-local time of day, for a sign-off that matches the room.
 *
 * The venue's zone, not the device's, for the same reason `startProximity`
 * counts days in it: a guest reading this may be in another zone entirely, and
 * "good evening" should mean evening at the court. 17:00 is the turn.
 */
export function dayPart(now: Date, tz: string): DayPart {
  return localParts(now, tz).minutesOfDay >= 17 * 60 ? 'evening' : 'day';
}

/** The two actors app.cancel_reservation can stamp (0088). */
export type CancelActor = 'guest' | 'staff';

const LIVE_STATUSES = new Set(['pending', 'confirmed', 'arrived']);

/**
 * A hold that is still running: unconfirmed, not swept, deadline in the future.
 *
 * A hold whose TTL has passed is live to the DATABASE until the sweep runs
 * (the constraint predicate cannot reference now(), 0008), so status alone is
 * not enough — a stale-but-pending row would otherwise show the guest a slot
 * they no longer have. A hold with no deadline cannot be reasoned about and is
 * treated as gone.
 */
export function isLiveHold(row: BookingRow, now: Date): boolean {
  if (row.kind !== 'hold' || row.status !== 'pending') return false;
  if (!row.hold_expires_at) return false;
  const ms = new Date(row.hold_expires_at).getTime();
  return Number.isFinite(ms) && ms > now.getTime();
}

/**
 * Split own reservations into holds (checkout in progress), upcoming (still
 * live and not ended) and past (ended or terminal), each usefully ordered:
 * holds and upcoming soonest-first, past most-recent-first.
 *
 * Holds used to be dropped here as "internal plumbing". They are not: a hold
 * occupies a real slot and one of the guest's three hold allowances, so a
 * guest who backed out of Review had no way to see — let alone release — what
 * was still held in their name, and hit HOLD_QUOTA_EXCEEDED with no
 * explanation. Only LIVE holds surface; spent ones (expired, released,
 * confirmed away) stay out of both lists, since a hold is never itself a
 * booking to look back on.
 */
export function splitBookings(
  rows: readonly BookingRow[],
  now: Date,
): { holds: BookingRow[]; upcoming: BookingRow[]; past: BookingRow[] } {
  const holds: BookingRow[] = [];
  const upcoming: BookingRow[] = [];
  const past: BookingRow[] = [];
  for (const r of rows) {
    if (r.kind === 'hold') {
      if (isLiveHold(r, now)) holds.push(r);
      continue;
    }
    const ended = new Date(r.end_at).getTime() <= now.getTime();
    if (!ended && LIVE_STATUSES.has(r.status)) upcoming.push(r);
    else past.push(r);
  }
  holds.sort((a, b) => a.start_at.localeCompare(b.start_at));
  upcoming.sort((a, b) => a.start_at.localeCompare(b.start_at));
  past.sort((a, b) => b.start_at.localeCompare(a.start_at));
  return { holds, upcoming, past };
}

/**
 * Who ended a cancelled booking — or null when that is not known.
 *
 * Null covers three different rows and must not be collapsed with either
 * actor: a booking that was never cancelled, a cancellation stamped before
 * 0088 added the column, and a value the server one day starts sending that
 * this build has never heard of. Everything downstream renders nothing at all
 * for null, so an unknown actor reads as the old wording rather than as a
 * guess about the venue or about the guest.
 *
 * Not derivable client-side: 'cancelled' says the slot went back, never who
 * put it back, and `cancellation_reason` is optional desk text that the guest
 * path does not write. Only the RPC's own staff check knows (0088).
 */
export function cancelActor(row: BookingRow): CancelActor | null {
  if (row.status !== 'cancelled') return null;
  return row.cancelled_by === 'guest' || row.cancelled_by === 'staff' ? row.cancelled_by : null;
}

/**
 * The caption under a cancelled row in a list — "Cancelled by you" or
 * "Cancelled by the venue" — or null when the actor is unknown, where the
 * status badge alone is already the whole truth.
 */
export function cancelActorLabel(
  row: BookingRow,
): 'booking.cancelledByYou' | 'booking.cancelledByVenue' | null {
  const actor = cancelActor(row);
  if (!actor) return null;
  return actor === 'guest' ? 'booking.cancelledByYou' : 'booking.cancelledByVenue';
}

/**
 * The line that explains why a booking is over — or null while it is still
 * live. Detail rendered it for `cancelled` only, so the two endings the guest
 * did NOT ask for said nothing at all: a no-show closed by the desk (0075) and
 * a hold that lapsed before it was confirmed both left a booking that had
 * quietly stopped meaning anything, with no way to tell that from a booking
 * still standing.
 *
 * A cancellation now names its ACTOR when one was recorded (0088). "This
 * booking was cancelled" is true of both endings and useful for neither: a
 * guest who cancelled it themselves is being told something they already know,
 * and a guest whose court the venue took back is being told nothing at all —
 * the one reading that sends someone to the desk. `by` null keeps the original
 * sentence, which is the honest answer for a cancellation predating the column.
 *
 * `completed` gets no notice: the guest played, and there is nothing to say.
 */
export function endedNotice(
  status: string,
  by?: string | null,
):
  | 'booking.cancelledNotice'
  | 'booking.cancelledByYouNotice'
  | 'booking.cancelledByVenueNotice'
  | 'booking.noShowNotice'
  | 'booking.expiredNotice'
  | null {
  switch (status) {
    case 'cancelled':
      if (by === 'guest') return 'booking.cancelledByYouNotice';
      if (by === 'staff') return 'booking.cancelledByVenueNotice';
      return 'booking.cancelledNotice';
    case 'no_show':
      return 'booking.noShowNotice';
    case 'expired':
      return 'booking.expiredNotice';
    default:
      return null;
  }
}

/**
 * Guest-side cancellability mirror of app.cancel_reservation's policy: live
 * status and outside the cancellation window. The RPC remains the authority.
 */
export function canCancel(row: BookingRow, cancellationWindowHours: number, now: Date): boolean {
  if (!LIVE_STATUSES.has(row.status)) return false;
  const cutoff = now.getTime() + cancellationWindowHours * 3_600_000;
  return new Date(row.start_at).getTime() >= cutoff;
}

/**
 * Human-facing booking reference (design 2026-08-31 shows "REF TP-2411").
 * `reservations` has no reference column; derive a short, stable one from the
 * UUID. Presentational only — support/desk lookups still use the full id.
 */
export function displayRef(reservationId: string): string {
  return `TP-${reservationId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

/**
 * How close the next booking's start is, for the "next up" hero on My bookings.
 *
 * Minutes and hours are elapsed time — below a day, that is the quantity a
 * guest is actually counting. Days are VENUE CALENDAR days, because the card
 * prints the date on the same row through `formatDate`, which is venue-local.
 * Elapsed days disagreed with it: a booking on the 24th, seen at 23:30 on the
 * 22nd, is 34.5 h out, and `Math.round(34.5 / 24)` is 1 — so the row read
 * "In 1 day" beside "24 Sep" (device testing, 2026-09-22).
 *
 * This used to be deliberately unit-based on the grounds that a day boundary
 * could not be proved here. It can: `tz` is the venue's own zone, the same one
 * the badge formats in, so the day counted is the day printed. The guest's
 * device zone is not an input and never was.
 *
 * The steps hand off exactly — 60 rounded minutes becomes 1 hour, 24 rounded
 * hours becomes a day — so no gap between them can render an empty chip.
 */
export type StartProximity =
  /** Started already and not yet ended: the guest is on court. */
  | { unit: 'live' }
  | { unit: 'now' }
  | { unit: 'minutes'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'days'; value: number };

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whole days from one 'YYYY-MM-DD' to another.
 *
 * Both sides are anchored to UTC midnight before subtracting, so the machine's
 * own zone cannot tilt the result — the dates have already been resolved in
 * the venue's zone by the caller, and this step is pure calendar arithmetic.
 */
export function calendarDaysBetween(from: string, to: string): number {
  const a = ISO_DATE_RE.exec(from);
  const b = ISO_DATE_RE.exec(to);
  if (!a || !b) return 0;
  const ms =
    Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) -
    Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.round(ms / 86_400_000);
}

export function startProximity(row: BookingRow, now: Date, tz: string): StartProximity {
  const start = new Date(row.start_at);
  const ms = start.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { unit: 'live' };
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', value: minutes };
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return { unit: 'hours', value: hours };
  // Past 24 h the label becomes a day count, so it has to agree with the date
  // the card prints: both are resolved in the venue's zone.
  const days = calendarDaysBetween(localParts(now, tz).date, localParts(start, tz).date);
  return { unit: 'days', value: Math.max(1, days) };
}

/**
 * Past bookings the guest actually turned up for: the games the desk closed as
 * played ('completed') and the ones it checked in and never reopened
 * ('arrived'). Cancellations, no-shows and expiries are history but not games.
 *
 * This is both the "N played" tally under the title and the list that tab
 * shows, so the number and the rows under it can never disagree.
 */
export function playedGames(past: readonly BookingRow[]): BookingRow[] {
  return past.filter((r) => r.status === 'completed' || r.status === 'arrived');
}

/**
 * How many of those there are — the "N played" tab under the title.
 */
export function playedCount(past: readonly BookingRow[]): number {
  return playedGames(past).length;
}

/**
 * Bookings that were CANCELLED — by the guest here, or by the desk — and gave
 * their slot back. The third tab on My reservations.
 *
 * Deliberately status === 'cancelled' and nothing else. A no-show is a booking
 * the guest kept and did not turn up for, and an expired row is a hold that ran
 * out before it was ever confirmed; neither was cancelled by anyone, and
 * sweeping them in here to pad the tab would put a "No-show" badge under a
 * heading that says Cancelled. They stay in Booking history, which is the
 * complete past and is linked from under this list.
 */
export function cancelledBookings(past: readonly BookingRow[]): BookingRow[] {
  return past.filter((r) => r.status === 'cancelled');
}

/**
 * The moment a booking BECAME history — the instant `splitBookings` would
 * first have filed it under past.
 *
 * That happens on whichever came first: its slot ended, or the desk ended it.
 * `cancelled_at` carries the second (0075 sets it for cancelled, no_show and
 * completed), and a booking with neither is simply judged on its end.
 */
export function enteredHistoryAt(row: BookingRow): number {
  const ended = new Date(row.end_at).getTime();
  const closed = row.cancelled_at ? new Date(row.cancelled_at).getTime() : NaN;
  if (!Number.isFinite(closed)) return ended;
  if (!Number.isFinite(ended)) return closed;
  return Math.min(ended, closed);
}

/**
 * Past games still visible after "Clear history" (Booking history panel).
 *
 * Clearing hides, it does not delete: a reservation is the VENUE's record too,
 * so the app has no business destroying one to tidy a list. The cut is stored
 * per user on the device (features/booking/history.ts) and applied here, so a
 * cleared game is gone from every derived number as well as the list — the
 * "N played" chip included, which would otherwise keep counting games the guest
 * has just asked to stop seeing.
 *
 * The comparison is against when a booking ENTERED history, not when its slot
 * ends. Those are the same date for a game that was played, and very different
 * for one that was cancelled: `splitBookings` files a cancelled booking under
 * past the moment it is cancelled, however far off the slot was, so judging the
 * cut on `end_at` alone meant a booking cancelled for next Tuesday could never
 * be cleared at all — tapping the button did nothing, twice (reported
 * 2026-09-23). The two functions have to agree on what "past" means.
 */
export function visiblePast(past: readonly BookingRow[], clearedAt: string | null): BookingRow[] {
  if (!clearedAt) return [...past];
  const cutoff = new Date(clearedAt).getTime();
  if (!Number.isFinite(cutoff)) return [...past];
  return past.filter((r) => enteredHistoryAt(r) > cutoff);
}
