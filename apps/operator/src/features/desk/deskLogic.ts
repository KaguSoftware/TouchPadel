/**
 * Pure helpers behind Today's board and the booking detail screen.
 *
 * Everything here compares timestamps and maps statuses; nothing computes a
 * price, a duration or a total. The board renders what the server returned.
 */
import type { BookingStatus, PaymentStatus } from '../../components/kit';
import type { ReservationRow, TabLinkRow } from './deskTypes';

/** Statuses that occupy a court (the exclusion constraint's own set). */
export const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['pending', 'confirmed', 'arrived']);

/** A booking the desk can still act on. */
export function isLive(status: string): boolean {
  return BLOCKING_STATUSES.has(status);
}

const KNOWN: readonly BookingStatus[] = ['pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show', 'expired'];

/** Server status → the seven-state indicator. Unknown strings render as-is via the indicator. */
export function toBookingStatus(status: string): BookingStatus | string {
  return (KNOWN as readonly string[]).includes(status) ? (status as BookingStatus) : status;
}

/**
 * Payment status is never computed here: a booking is `paid` only when the
 * server holds a settled tab that charges it. No tab → unknown, not unpaid.
 */
export function paymentStatusFor(
  reservation: Pick<ReservationRow, 'id' | 'price_iqd' | 'kind'>,
  tabs: readonly TabLinkRow[] | undefined,
): PaymentStatus {
  if (reservation.kind !== 'booking') return 'unknown';
  if (reservation.price_iqd == null || tabs === undefined) return 'unknown';
  const linked = tabs.filter((t) => t.reservation_id === reservation.id && t.status !== 'void');
  if (linked.length === 0) return 'unknown';
  if (linked.some((t) => t.status === 'settled')) return 'paid';
  return 'unpaid';
}

/**
 * Hide what the calendar hides: cancelled/expired/no-show rows and holds
 * whose expiry has passed (comparison against `nowMs`, no arithmetic).
 */
export function isVisible(r: ReservationRow, nowMs: number): boolean {
  if (r.status === 'cancelled' || r.status === 'expired' || r.status === 'no_show') return false;
  if (r.kind === 'hold' && r.hold_expires_at && new Date(r.hold_expires_at).getTime() <= nowMs) return false;
  return true;
}

/** Sort by start, then by court so the board reads top to bottom through the night. */
export function sortByStart<T extends { start_at: string; court_id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.start_at.localeCompare(b.start_at) || a.court_id.localeCompare(b.court_id));
}

export interface TimeGroup<T> {
  /** ISO instant of the first booking in the group — the caller formats it. */
  startAt: string;
  rows: T[];
}

/** Bookings grouped by identical start instant, in order. */
export function groupByStart<T extends { start_at: string; court_id: string }>(rows: readonly T[]): TimeGroup<T>[] {
  const groups: TimeGroup<T>[] = [];
  for (const r of sortByStart(rows)) {
    const last = groups[groups.length - 1];
    if (last && last.startAt === r.start_at) last.rows.push(r);
    else groups.push({ startAt: r.start_at, rows: [r] });
  }
  return groups;
}

export type CourtAvailability =
  | { courtId: string; state: 'free'; nextStartAt: string | null }
  | { courtId: string; state: 'busy'; kind: 'booking' | 'hold' | 'maintenance'; untilAt: string; reservationId: string };

/**
 * What each court is doing right now, from rows already on screen. A court is
 * busy when a blocking reservation spans `now`; otherwise free, with the next
 * blocking start after `now` if there is one.
 */
export function courtAvailability(
  courtIds: readonly string[],
  reservations: readonly ReservationRow[],
  nowIso: string,
): CourtAvailability[] {
  return courtIds.map((courtId) => {
    const own = reservations.filter((r) => r.court_id === courtId && BLOCKING_STATUSES.has(r.status));
    const current = own.find((r) => r.start_at <= nowIso && r.end_at > nowIso);
    if (current) {
      return { courtId, state: 'busy', kind: current.kind, untilAt: current.end_at, reservationId: current.id };
    }
    const upcoming = own.filter((r) => r.start_at > nowIso).sort((a, b) => a.start_at.localeCompare(b.start_at));
    return { courtId, state: 'free', nextStartAt: upcoming[0]?.start_at ?? null };
  });
}

/**
 * The arrivals panel: bookings starting between `now` and `horizonIso`
 * that have not arrived yet, plus everything already marked arrived.
 */
export function arrivals(reservations: readonly ReservationRow[], nowIso: string, horizonIso: string): ReservationRow[] {
  return sortByStart(
    reservations.filter((r) => {
      if (r.kind !== 'booking') return false;
      if (r.status === 'arrived') return true;
      if (r.status !== 'confirmed') return false;
      return r.start_at >= nowIso && r.start_at <= horizonIso;
    }),
  );
}

/** The transitions mark_reservation accepts (0026): what the UI may offer. */
export function allowedMarks(status: string): readonly ('arrived' | 'completed' | 'no_show')[] {
  switch (status) {
    case 'confirmed':
      return ['arrived', 'completed', 'no_show'];
    case 'arrived':
      return ['completed'];
    default:
      return [];
  }
}

/** Server codes that mean "refused by rule", not "failed": rendered as a refusal, control stays. */
export const OVERRIDE_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'FORBIDDEN',
  'NOT_MOVABLE',
  'NOT_EXTENDABLE',
  'NOT_CANCELLABLE',
  'INVALID_TRANSITION',
  'CANCELLATION_WINDOW',
  'REASON_REQUIRED',
]);

export function isOverrideRefusal(code: string | undefined): boolean {
  return code !== undefined && OVERRIDE_REFUSAL_CODES.has(code);
}
