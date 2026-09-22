/**
 * Pure helpers behind Today's board and the booking detail screen.
 *
 * Everything here compares timestamps and maps statuses; nothing computes a
 * price, a duration or a total. The board renders what the server returned.
 */
import type { BookingStatus } from '../../components/kit';
import type { ReservationRow } from './deskTypes';

/** Statuses that occupy a court (the exclusion constraint's own set). */
export const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['pending', 'confirmed', 'arrived']);

/** A booking the desk can still act on. */
export function isLive(status: string): boolean {
  return BLOCKING_STATUSES.has(status);
}

/**
 * Who the booking is for. The desk types a name into `guest_name`; a booking
 * made from the app carries only `guest_id`, and the name lives on the joined
 * profile. Reading `guest_name` alone labelled every account booking a walk-in.
 * Null here means a genuine nameless walk-in.
 */
export function guestNameOf(r: Pick<ReservationRow, 'guest_name' | 'guest'> | null | undefined): string | null {
  return r?.guest_name ?? r?.guest?.full_name ?? null;
}

const KNOWN: readonly BookingStatus[] = ['pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show', 'expired'];

/** Server status → the seven-state indicator. Unknown strings render as-is via the indicator. */
export function toBookingStatus(status: string): BookingStatus | string {
  return (KNOWN as readonly string[]).includes(status) ? (status as BookingStatus) : status;
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

/** Latest start first, courts still in order within a start: the day's list reads newest to oldest. */
export function sortByStartDesc<T extends { start_at: string; court_id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.start_at.localeCompare(a.start_at) || a.court_id.localeCompare(b.court_id));
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

export interface ArrivalsDue<T> {
  /** Already started and still not marked arrived — the guest is late, or never came. */
  late: T[];
  /** Starting between now and the horizon, not yet arrived. */
  soon: T[];
}

/**
 * The desk's to-do list for the door. Arrivals that already happened are NOT
 * here: the old panel listed them beside the ones still to come, so the one
 * list a clerk scans between guests was half things already done. A booking
 * that started and is still `confirmed` is split out as late, because that is
 * the question the desk has to answer next (still coming, or a no-show?).
 */
export function arrivalsDue(reservations: readonly ReservationRow[], nowIso: string, horizonIso: string): ArrivalsDue<ReservationRow> {
  const late: ReservationRow[] = [];
  const soon: ReservationRow[] = [];
  for (const r of sortByStart(reservations)) {
    if (r.kind !== 'booking' || r.status !== 'confirmed') continue;
    if (r.start_at <= nowIso && r.end_at > nowIso) late.push(r);
    else if (r.start_at > nowIso && r.start_at <= horizonIso) soon.push(r);
  }
  return { late, soon };
}

export interface NightSummary {
  bookings: number;
  arrived: number;
  /** Confirmed bookings that have not started yet. */
  toCome: number;
}

/** The three counts the board's subtitle states. Holds and blocks are not bookings. */
export function nightSummary(reservations: readonly ReservationRow[], nowIso: string): NightSummary {
  let bookings = 0;
  let arrived = 0;
  let toCome = 0;
  for (const r of reservations) {
    if (r.kind !== 'booking') continue;
    bookings += 1;
    if (r.status === 'arrived' || r.status === 'completed') arrived += 1;
    else if (r.status === 'confirmed' && r.start_at > nowIso) toCome += 1;
  }
  return { bookings, arrived, toCome };
}

/**
 * Whether [startMs, endMs) on `courtId` overlaps a reservation that occupies
 * the court. The server's exclusion constraint is the control; this only keeps
 * the create dialog from offering a start time it already knows is taken.
 */
export function slotTaken(
  reservations: readonly Pick<ReservationRow, 'id' | 'court_id' | 'status' | 'start_at' | 'end_at'>[],
  courtId: string,
  startMs: number,
  endMs: number,
  ignoreId?: string,
): boolean {
  return reservations.some(
    (r) =>
      r.court_id === courtId &&
      r.id !== ignoreId &&
      BLOCKING_STATUSES.has(r.status) &&
      new Date(r.start_at).getTime() < endMs &&
      new Date(r.end_at).getTime() > startMs,
  );
}

/**
 * The transitions mark_reservation accepts (0026), narrowed by the temporal
 * guard 0071 added (SEC-11): what the UI may offer.
 *
 * `no_show` and `completed` sit OUTSIDE the reservation exclusion predicate, so
 * writing either frees the court for resale. On a booking that has not started
 * yet that is a paid Friday slot marked absent on Tuesday and sold twice, so
 * the server refuses both before `start_at` with RESERVATION_NOT_STARTED.
 * `arrived` stays inside the predicate and frees nothing, so an early check-in
 * is still offered.
 *
 * This mirrors the server rule rather than replacing it — the RPC is the
 * control. The point of mirroring is that the desk never sees a button that
 * cannot work: a refusal the UI could have predicted reads to staff as the
 * software being broken, and that is how workarounds get invented.
 *
 * `startAt`/`now` are optional so existing callers keep compiling; without them
 * the function returns what the server accepts on a STARTED booking, which is
 * the wider set. Pass both wherever the reservation's start time is to hand.
 */
export function allowedMarks(
  status: string,
  startAt?: string,
  now: Date = new Date(),
): readonly ('arrived' | 'completed' | 'no_show')[] {
  const notStarted = startAt !== undefined && now.getTime() < new Date(startAt).getTime();
  switch (status) {
    case 'confirmed':
      return notStarted ? ['arrived'] : ['arrived', 'completed', 'no_show'];
    case 'arrived':
      // A booking cannot be 'arrived' before it starts unless the desk checked
      // the guest in early, and a guest standing at the desk has arrived — so
      // 'completed' stays available here only once the slot is running.
      return notStarted ? [] : ['completed'];
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
  'RESERVATION_NOT_STARTED',
  // 0150: the start would land before now. A rule, not a failure — the booking
  // stays where it is and the control stays on screen.
  'RESERVATION_IN_PAST',
]);

export function isOverrideRefusal(code: string | undefined): boolean {
  return code !== undefined && OVERRIDE_REFUSAL_CODES.has(code);
}

/*
 * A phone box takes numbers. Letters used to type straight into it and came
 * back only as a server INVALID_PHONE at the end of a long form; they are now
 * not typeable at all. Arabic-Indic and Persian digits are folded to the ASCII
 * the API stores, so an Arabic keyboard needs no second thought — the low
 * nibble of each of those code points IS the digit.
 */
const PHONE_STRIP = /[^\d+()\-\s]/g;
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** The typeable subset of a phone number: digits and the punctuation around them. */
export function sanitizePhone(raw: string): string {
  return raw.replace(EASTERN_DIGITS, (d) => String(d.charCodeAt(0) & 0xf)).replace(PHONE_STRIP, '');
}

/** How many actual digits a phone box holds — what "too short to be a number" is measured on. */
export function phoneDigitCount(raw: string): number {
  return raw.replace(/\D/g, '').length;
}

/*
 * The mirror image of the rule above, on the box beside it: a name is not a
 * number. Digits landed in the name field either by a slip of the hand one key
 * to the left, or by a phone typed into the wrong box entirely — and the name
 * is what the desk calls out at the court, so it is the one field where a
 * stray "0770" is silent damage. Every digit the two keyboards can produce.
 */
const NAME_DIGITS = /[\d٠-٩۰-۹]/g;

/** A name with the digits taken out. Letters, spaces and punctuation are untouched. */
export function sanitizeName(raw: string): string {
  return raw.replace(NAME_DIGITS, '');
}

/*
 * The customer search takes a name OR a number, and the walk-in form has a box
 * for each, so a query that finds no account is split between them rather than
 * retyped. Sanitizing alone is not enough to decide which box a query belongs
 * in: the hyphen in "Al-Rawi" is legal phone punctuation and survived into the
 * phone box, and the spaces in "0770 123 4567" survived into the name box. A
 * half is only carried across if it actually contains one — a letter, a digit.
 */
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /[\d٠-٩۰-۹]/;

/** The name half of a search query, or '' if it holds no name. */
export function nameFromQuery(query: string): string {
  const name = sanitizeName(query).trim();
  return HAS_LETTER.test(name) ? name : '';
}

/** The phone half of a search query, or '' if it holds no number. */
export function phoneFromQuery(query: string): string {
  if (!HAS_DIGIT.test(query)) return '';
  // Punctuation stranded by the letters around it goes with them. A leading
  // "+" is the one mark that belongs to the number rather than to the name.
  return sanitizePhone(query)
    .replace(/^[^\d+]+/, '')
    .replace(/\D+$/, '');
}
