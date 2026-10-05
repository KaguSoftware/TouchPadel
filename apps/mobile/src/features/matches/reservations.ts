/**
 * My Reservations (§4.16): bookings and matches merged into one list. Lives
 * apart from `logic.ts` because it needs `state.ts`, which itself imports
 * `logic.ts` (a require cycle otherwise).
 */
import {
  cancelledBookings,
  playedGames,
  splitBookings,
  visiblePast,
  type BookingRow,
} from '../booking/logic';
import type { MyMatchRow } from './logic';
import { guestStateOf, stateInputOfMine, stateSection, type GuestState } from './state';

// ── My Reservations (§4.16) ─────────────────────────────────────────────────

export type ReservationItem =
  | { kind: 'booking'; startAt: string; row: BookingRow }
  | { kind: 'match'; startAt: string; row: MyMatchRow; state: GuestState };

export interface MergedReservations {
  /** Live holds (bookings only). */
  holds: BookingRow[];
  /** The OPEN MATCHES section: requested, approved, in, waiting for a court, left or removed late (until the start). */
  openMatches: { row: MyMatchRow; state: GuestState }[];
  /** Bookings and booked or checked-in matches, by start. */
  upcoming: ReservationItem[];
  /** Everything past, newest first, with "Clear history" applied. */
  past: ReservationItem[];
  /** The Played chip: played bookings and played matches (a no-show never is). */
  played: ReservationItem[];
  /** The Cancelled chip: cancelled bookings and called-off, bumped, expired, no-court and cancelled matches. */
  cancelled: ReservationItem[];
}

const CANCELLED_STATES: ReadonlySet<GuestState> = new Set<GuestState>([
  'calledOff',
  'bumped',
  'expired',
  'noCourt',
  'cancelledByOrganiser',
  'cancelledByVenue',
]);

/**
 * The moment a match row became history, for "Clear history" (the bookings'
 * `enteredHistoryAt` rule). `my_matches` carries no `ended_at`, so a request
 * that was answered is judged on `decided_at` and everything else on its end.
 */
function matchEnteredHistoryAt(row: MyMatchRow): number {
  const end = Date.parse(row.endAt);
  const decided = row.request?.decidedAt ? Date.parse(row.request.decidedAt) : NaN;
  if (row.mySeats.length === 0 && Number.isFinite(decided)) return Math.min(decided, end);
  return end;
}

/**
 * Bookings and matches in one My Reservations (§4.16). A match booking has
 * `guest_id` NULL, so it never comes back from `my_reservations` and needs no
 * dedupe. `bookings` are `my_reservations` rows; `matches` any `my_matches`
 * rows (either scope, or both concatenated; a match id appears once).
 */
export function mergeReservationLists(
  bookings: readonly BookingRow[],
  matches: readonly MyMatchRow[],
  now: Date,
  clearedAt: string | null,
): MergedReservations {
  const split = splitBookings(bookings, now);
  const openMatches: { row: MyMatchRow; state: GuestState }[] = [];
  const upcoming: ReservationItem[] = split.upcoming.map((row) => ({
    kind: 'booking',
    startAt: row.start_at,
    row,
  }));
  const pastMatches: { row: MyMatchRow; state: GuestState }[] = [];
  const seen = new Set<string>();
  for (const row of matches) {
    if (seen.has(row.matchId)) continue;
    seen.add(row.matchId);
    const { state } = guestStateOf(stateInputOfMine(row));
    const section = stateSection(state, { startAt: row.startAt, endAt: row.endAt, now });
    if (section === 'open') openMatches.push({ row, state });
    else if (section === 'upcoming') upcoming.push({ kind: 'match', startAt: row.startAt, row, state });
    else pastMatches.push({ row, state });
  }
  upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));
  openMatches.sort((a, b) => a.row.startAt.localeCompare(b.row.startAt));

  const cutoff = clearedAt ? Date.parse(clearedAt) : NaN;
  const visibleMatches = Number.isFinite(cutoff)
    ? pastMatches.filter((m) => matchEnteredHistoryAt(m.row) > cutoff)
    : pastMatches;
  const pastBookings = visiblePast(split.past, clearedAt);
  const playedIds = new Set(playedGames(pastBookings).map((r) => r.id));
  const cancelledIds = new Set(cancelledBookings(pastBookings).map((r) => r.id));

  const past: ReservationItem[] = [
    ...pastBookings.map((row): ReservationItem => ({ kind: 'booking', startAt: row.start_at, row })),
    ...visibleMatches.map(
      ({ row, state }): ReservationItem => ({ kind: 'match', startAt: row.startAt, row, state }),
    ),
  ].sort((a, b) => b.startAt.localeCompare(a.startAt));

  return {
    holds: split.holds,
    openMatches,
    upcoming,
    past,
    played: past.filter((i) =>
      i.kind === 'booking' ? playedIds.has(i.row.id) : i.state === 'played',
    ),
    cancelled: past.filter((i) =>
      i.kind === 'booking' ? cancelledIds.has(i.row.id) : CANCELLED_STATES.has(i.state),
    ),
  };
}
