/**
 * Pure booking helpers — no RN / supabase imports (unit-tested under node).
 */

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
}

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
 * The line that explains why a booking is over — or null while it is still
 * live. Detail rendered it for `cancelled` only, so the two endings the guest
 * did NOT ask for said nothing at all: a no-show closed by the desk (0075) and
 * a hold that lapsed before it was confirmed both left a booking that had
 * quietly stopped meaning anything, with no way to tell that from a booking
 * still standing.
 *
 * `completed` gets no notice: the guest played, and there is nothing to say.
 */
export function endedNotice(
  status: string,
): 'booking.cancelledNotice' | 'booking.noShowNotice' | 'booking.expiredNotice' | null {
  switch (status) {
    case 'cancelled':
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
 * Deliberately unit-based and NOT calendar-based: "Tomorrow" is a venue-timezone
 * day boundary, and every cheap way to compute it here (device midnight, a
 * 24-hour offset) is wrong for someone travelling or booking near midnight.
 * Elapsed time has no such trap, so the hero counts down in minutes, hours and
 * days and never claims a day name it cannot prove.
 *
 * The steps hand off exactly — 60 rounded minutes becomes 1 hour, 24 rounded
 * hours becomes 1 day — so no gap between them can render an empty chip.
 */
export type StartProximity =
  /** Started already and not yet ended: the guest is on court. */
  | { unit: 'live' }
  | { unit: 'now' }
  | { unit: 'minutes'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'days'; value: number };

export function startProximity(row: BookingRow, now: Date): StartProximity {
  const ms = new Date(row.start_at).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { unit: 'live' };
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', value: minutes };
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return { unit: 'hours', value: hours };
  return { unit: 'days', value: Math.max(1, Math.round(ms / 86_400_000)) };
}

/**
 * Past bookings the guest actually turned up for — the "N played" chip under
 * the title. Cancellations, no-shows and expiries are history but not games,
 * and counting them would inflate the one number on the screen that is a small
 * point of pride.
 */
export function playedCount(past: readonly BookingRow[]): number {
  return past.filter((r) => r.status === 'completed' || r.status === 'arrived').length;
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
 * The comparison is on `end_at` for the same reason the split is: a game that
 * had not finished when history was cleared is not history yet.
 */
export function visiblePast(past: readonly BookingRow[], clearedAt: string | null): BookingRow[] {
  if (!clearedAt) return [...past];
  const cutoff = new Date(clearedAt).getTime();
  if (!Number.isFinite(cutoff)) return [...past];
  return past.filter((r) => new Date(r.end_at).getTime() > cutoff);
}
