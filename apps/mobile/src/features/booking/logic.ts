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
}

const LIVE_STATUSES = new Set(['pending', 'confirmed', 'arrived']);

/**
 * Split own reservations into upcoming (still live and not ended) and past
 * (ended or terminal), both usefully ordered: upcoming soonest-first, past
 * most-recent-first. Pending HOLD rows are internal plumbing — hidden.
 */
export function splitBookings(
  rows: readonly BookingRow[],
  now: Date,
): { upcoming: BookingRow[]; past: BookingRow[] } {
  const upcoming: BookingRow[] = [];
  const past: BookingRow[] = [];
  for (const r of rows) {
    if (r.kind === 'hold') continue;
    const ended = new Date(r.end_at).getTime() <= now.getTime();
    if (!ended && LIVE_STATUSES.has(r.status)) upcoming.push(r);
    else past.push(r);
  }
  upcoming.sort((a, b) => a.start_at.localeCompare(b.start_at));
  past.sort((a, b) => b.start_at.localeCompare(a.start_at));
  return { upcoming, past };
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
