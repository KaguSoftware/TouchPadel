/**
 * Pure rules behind every open-match surface at the desk
 * (docs/design/open-matches/operator.md §5.8–§5.22). No React, no fetches.
 *
 * The server is the wall: a row's buttons follow the `can` objects of
 * app.desk_match_detail, and every figure is the server's. What lives here is
 * the reading of those answers (which line a seat shows, which buttons it
 * offers, what a refusal's detail means) and the few client mirrors the
 * contract asks for (the bump warning, the call-off state), each tested
 * against the table it mirrors.
 *
 * Words: a function whose words live in this lane's own groups
 * (ws.matches.common / count / errors / offline) returns a MessageKey or,
 * given `tr`, a string. The seat lines, the history sentences and the
 * calendar chip are worded in the match-screen and desk groups
 * (ws.matches.seat / events / chip), so for those this module returns an id
 * and the key's shape (`seatLineKey`, `eventKey`), and the owning lane's
 * catalog makes the key real.
 */
import { formatIQD, formatTime, isolate, isolateLtr, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { errorToMessageKey } from '../../lib/errors';
import type { CourtRow } from '../../lib/queries';
import { resolveGuestSiteUrl } from '../admin/qr/qrCardGeometry';
import { isLessonLiteral } from '../coaching/lessonLogic';
import { BLOCKING_STATUSES, guestNameOf } from '../desk/deskLogic';
import type { ReservationRow } from '../desk/deskTypes';
import type { MatchDetail, MatchInfo, MatchSeat, MatchState, OpenMatch, OpenMatches } from './matchPayloads';

export type Tr = (key: MessageKey, params?: TParams) => string;

/** The four seats of every match (OM-3). */
export const MATCH_SEATS = 4;

// ---------------------------------------------------------------------------
// The booking a match makes (§5.8)
// ---------------------------------------------------------------------------

/**
 * `reservations.guest_name` of a match booking: the DB literal written by
 * app.match_try_book (0260). Must equal it byte for byte.
 */
export const MATCH_RESERVATION_NAME = 'Open match';

/** A match booking read straight from `reservations`: no account and the literal name. */
export function isMatchLiteral(r: Pick<ReservationRow, 'guest_id' | 'guest_name'> | null | undefined): boolean {
  return !!r && r.guest_id === null && r.guest_name === MATCH_RESERVATION_NAME;
}

/**
 * The name a booking shows on the calendar, the board and the booking screen.
 * A match state names the organiser (or the first desk seat); a match booking
 * without one reads "Open match" in the screen's language rather than the
 * English literal; any other booking is `guestNameOf` as before (null for a
 * nameless walk-in).
 */
export function bookingLabel(
  r: Pick<ReservationRow, 'guest_id' | 'guest_name' | 'guest'>,
  state: MatchState | null | undefined,
  tr: Tr,
): string | null {
  if (state) return state.label ?? tr('ws.matches.common.openMatch');
  if (isMatchLiteral(r)) return tr('ws.matches.common.openMatch');
  return guestNameOf(r);
}

/**
 * A booking's name on a screen with no match state to hand (observation,
 * open tabs, day close; §5.27: the operator's own screens translate the
 * literal): "Open match" in the screen's language for a match booking, else
 * its guest name (null when it has none). The row needs `guest_id` for the
 * literal to be recognised; a row without it reads its name as stored.
 *
 * A lesson's court row (coaching operator.md §5.8: kind 'lesson', or no
 * account and the literal 'Lesson' on a row that is not a booking) reads
 * "Lesson" in the screen's language the same way.
 */
export function reservationNameOf(
  r:
    | (Pick<ReservationRow, 'guest_name'> & { guest_id?: string | null; guest?: { full_name: string | null } | null; kind?: string })
    | null
    | undefined,
  tr: Tr,
): string | null {
  if (!r) return null;
  if (r.guest_id === null && r.guest_name === MATCH_RESERVATION_NAME) return tr('ws.matches.common.openMatch');
  if (isLessonLiteral(r)) return tr('ws.coaching.common.lesson');
  return r.guest_name ?? r.guest?.full_name ?? null;
}

// ---------------------------------------------------------------------------
// Words picked by category (§5.13.2)
// ---------------------------------------------------------------------------

/**
 * A third-person line about a player in a women's match reads its feminine
 * key (`…F`); EN repeats the text so the catalogs keep parity.
 */
export function byCategory<K extends string>(category: string, key: K): K | `${K}F` {
  return category === 'women' ? (`${key}F` as const) : key;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Has the game started? The server's `started` at its `server_now`, or the
 * payload's clock past `start_at` (`elapsedMs` = time since it was fetched,
 * so a screen left open does not wait for the next poll). Never the station
 * clock alone (§5.1).
 */
export function isStarted(match: Pick<MatchInfo, 'started' | 'start_at' | 'server_now'>, elapsedMs = 0): boolean {
  if (match.started) return true;
  const now = ms(match.server_now);
  const start = ms(match.start_at);
  return now !== null && start !== null && now + elapsedMs >= start;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // Half-open [start, end): touching ends do not overlap, as tstzrange '[)'.
  return aStart < bEnd && bStart < aEnd;
}

// ---------------------------------------------------------------------------
// Seats: who is on which number (R4, R21)
// ---------------------------------------------------------------------------

/**
 * The Players panel's rows: one per number 1..4 with its carrier (or none:
 * an open seat), then every seat that no longer carries one (left, refilled,
 * removed, cancelled, a re-seated no-show) under "Earlier in this match".
 */
export function seatRows(seats: readonly MatchSeat[]): {
  numbered: { seatNo: number; seat: MatchSeat | null }[];
  earlier: MatchSeat[];
} {
  const numbered = Array.from({ length: MATCH_SEATS }, (_, i) => ({
    seatNo: i + 1,
    seat: seats.find((s) => s.carrying && s.seat_no === i + 1) ?? null,
  }));
  const carrying = new Set(numbered.flatMap((n) => (n.seat ? [n.seat.seat_id] : [])));
  const earlier = seats.filter((s) => !carrying.has(s.seat_id)).sort((a, b) => a.seat_no - b.seat_no);
  return { numbered, earlier };
}

/** The numbers with no carrier (the server fills the lowest first). */
export function openSeatNumbers(seats: readonly MatchSeat[]): number[] {
  return seatRows(seats)
    .numbered.filter((n) => n.seat === null)
    .map((n) => n.seatNo);
}

/**
 * A seat's name as staff read it: its own name; a friend or a nameless desk
 * extra as "{holder} +1"; a nameless desk seat with no holder as "Desk player
 * {seat}". Isolated, so it can sit inside any sentence.
 */
export function seatLabelOf(seat: Pick<MatchSeat, 'full_name' | 'holder_name' | 'companion_no' | 'seat_no'>, tr: Tr): string {
  if (seat.full_name) return isolate(seat.full_name);
  if (seat.holder_name) {
    const plus = seat.companion_no !== null ? ` ${isolateLtr(`+${seat.companion_no}`)}` : '';
    return `${isolate(seat.holder_name)}${plus}`;
  }
  return tr('ws.matches.common.deskPlayer', { seat: isolateLtr(String(seat.seat_no)) });
}

// ---------------------------------------------------------------------------
// The seat chip on a match booking (§5.8), from app.desk_match_states
// ---------------------------------------------------------------------------

export type SeatChip =
  /** Before any mark: `3/4` (LTR-isolated). */
  | { kind: 'fill'; text: string; taken: number; total: number }
  /** Once marking starts: "Here 2 · Missing 1" (the desk lane's `chip` words). */
  | { kind: 'marks'; here: number; missing: number; taken: number; total: number };

/**
 * Has the game of this state started? The server's own signs first: an `in`
 * carrier counted as unmarked (it is only counted after the start), a no-show
 * (only marked after it), a played match. Otherwise the caller's word
 * (`started`: the booking's start against the screen's clock), which is the
 * only way to tell a match where everyone left has arrived and one left late
 * before the start from one where it happened after.
 */
function stateStarted(state: MatchState, started: boolean): boolean {
  return started || (state.seats_unmarked ?? 0) > 0 || (state.seats_no_show ?? 0) > 0 || state.status === 'played';
}

/**
 * null when the state has no seat count (the chip is left out, never
 * guessed). After the start an unrefilled late leaver is missing too (R39: a
 * match with one is short); before it the seat is held and can be refilled.
 */
export function seatChipOf(state: MatchState, started = false): SeatChip | null {
  if (state.open_seats === null) return null;
  const taken = Math.max(0, MATCH_SEATS - state.open_seats);
  const here = state.seats_attended ?? 0;
  const missing = (state.seats_no_show ?? 0) + (stateStarted(state, started) ? (state.seats_left_late ?? 0) : 0);
  if (here + missing > 0) return { kind: 'marks', here, missing, taken, total: MATCH_SEATS };
  return { kind: 'fill', text: isolateLtr(`${taken}/${MATCH_SEATS}`), taken, total: MATCH_SEATS };
}

// ---------------------------------------------------------------------------
// A seat's ticket chip (§5.13.2): words in ws.matches.common.ticket
// ---------------------------------------------------------------------------

export interface KeyedText {
  key: MessageKey;
  params?: TParams;
}

/** null for a seat state the table does not name (the row shows its raw status instead). */
export function ticketChipOf(seat: MatchSeat, match: Pick<MatchInfo, 'status' | 'started' | 'start_at' | 'server_now'>): KeyedText | null {
  if (seat.kind === 'desk') return { key: 'ws.matches.common.ticket.none' };
  const filling = match.status === 'filling' || match.status === 'awaiting_court';
  switch (seat.status) {
    case 'in':
      if (filling && seat.kind === 'friend' && seat.holder_name) {
        return { key: 'ws.matches.common.ticket.onHolder', params: { holder: isolate(seat.holder_name) } };
      }
      return { key: 'ws.matches.common.ticket.inUse' };
    case 'attended':
    case 'refilled':
    case 'removed':
    case 'left':
      return { key: 'ws.matches.common.ticket.back' };
    case 'no_show':
      return { key: 'ws.matches.common.ticket.lost' };
    case 'left_late':
      return { key: isStarted(match) ? 'ws.matches.common.ticket.lost' : 'ws.matches.common.ticket.held' };
    case 'cancelled':
      return { key: seat.ticket?.status === 'forfeited' ? 'ws.matches.common.ticket.lost' : 'ws.matches.common.ticket.back' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// A seat's money line (§5.13.2): words in ws.matches.seat (the Players lane)
// ---------------------------------------------------------------------------

/** Every line of the §5.13.2 table, by id. */
export const SEAT_LINE_IDS = [
  'fillingAccount',
  'fillingFriend',
  'fillingDesk',
  'bookedBeforeStart',
  'notMarked',
  'cameOwes',
  'camePaid',
  'cameWrittenOff',
  'noShow',
  'noShowReseated',
  'leftLateBeforeStart',
  'leftLateAfterStart',
  'refilled',
  'removed',
  'left',
  'matchEnded',
  'calledOff',
  'openFilling',
  'openBookedBeforeStart',
  'openAfterStart',
  'unknown',
] as const;
export type SeatLineId = (typeof SEAT_LINE_IDS)[number];

/** The lines about a player in the third person: each has a `…F` key used in a women's match. */
export const GENDERED_SEAT_LINES = [
  'cameOwes',
  'camePaid',
  'cameWrittenOff',
  'noShow',
  'noShowReseated',
  'leftLateBeforeStart',
  'leftLateAfterStart',
  'refilled',
  'removed',
  'left',
] as const satisfies readonly SeatLineId[];
export type GenderedSeatLineId = (typeof GENDERED_SEAT_LINES)[number];

export interface SeatLine {
  id: SeatLineId;
  /** Server figures (IQD) and codes, formatted by `seatLineParams`. */
  params: {
    share?: number | null;
    owed?: number | null;
    paid?: number | null;
    amount?: number | null;
    /** A write-off reason code (op.reasons) or a seat's end reason. */
    reason?: string | null;
    /** The seat that took this number, for "{name} took the seat". */
    taker?: MatchSeat | null;
    /** The raw status, for `unknown`. */
    status?: string;
  };
}

/** The catalog key of a seat line: `ws.matches.seat.<id>`, feminine in a women's match. */
export type SeatLineKey = `ws.matches.seat.${SeatLineId}` | `ws.matches.seat.${GenderedSeatLineId}F`;

export function seatLineKey(line: Pick<SeatLine, 'id'>, category: string): SeatLineKey {
  const gendered = (GENDERED_SEAT_LINES as readonly string[]).includes(line.id);
  const id = gendered ? byCategory(category, line.id) : line.id;
  return `ws.matches.seat.${id}` as SeatLineKey;
}

function shareOf(seatNo: number, match: Pick<MatchInfo, 'shares_iqd'>, money?: { share_iqd: number | null } | null): number | null {
  return money?.share_iqd ?? match.shares_iqd[seatNo - 1] ?? null;
}

/**
 * The line under a seat, read from the server's statuses and figures
 * (§5.13.2). "Started" is the payload's (`isStarted`), `elapsedMs` after it
 * was fetched.
 */
export function seatLineOf(seat: MatchSeat, detail: Pick<MatchDetail, 'match' | 'seats'>, elapsedMs = 0): SeatLine {
  const m = detail.match;
  const started = isStarted(m, elapsedMs);
  const share = shareOf(seat.seat_no, m, seat.money);
  const taker = seat.replaced_by_seat_id ? (detail.seats.find((s) => s.seat_id === seat.replaced_by_seat_id) ?? null) : null;
  const filling = m.status === 'filling' || m.status === 'awaiting_court';
  switch (seat.status) {
    case 'in':
      if (filling) {
        if (seat.kind === 'account') return { id: 'fillingAccount', params: { share } };
        if (seat.kind === 'friend') return { id: 'fillingFriend', params: { share } };
        if (seat.kind === 'desk') return { id: 'fillingDesk', params: { share } };
        return { id: 'unknown', params: { status: seat.status } };
      }
      return started ? { id: 'notMarked', params: {} } : { id: 'bookedBeforeStart', params: { share } };
    case 'attended': {
      if (m.status === 'cancelled' && m.ended_reason === 'called_off_short') return { id: 'calledOff', params: {} };
      const money = seat.money;
      if (money?.write_off === 'manual' && (money.written_off_iqd ?? 0) > 0) {
        return { id: 'cameWrittenOff', params: { amount: money.written_off_iqd, reason: seat.write_off_reason } };
      }
      if ((money?.owed_iqd ?? 0) > 0) return { id: 'cameOwes', params: { owed: money!.owed_iqd } };
      const paid = money ? (money.paid_desk_iqd ?? 0) + (money.credit_iqd ?? 0) : null;
      return { id: 'camePaid', params: { paid } };
    }
    case 'no_show':
      return taker ? { id: 'noShowReseated', params: { taker } } : { id: 'noShow', params: {} };
    case 'left_late':
      return started ? { id: 'leftLateAfterStart', params: {} } : { id: 'leftLateBeforeStart', params: {} };
    case 'refilled':
      return { id: 'refilled', params: { taker } };
    case 'removed':
      return { id: 'removed', params: { reason: seat.end_reason } };
    case 'left':
      return { id: 'left', params: {} };
    case 'cancelled':
      return { id: 'matchEnded', params: {} };
    default:
      return { id: 'unknown', params: { status: seat.status } };
  }
}

/** The line of a number nobody carries (§5.13.2, the three "open seat" rows). */
export function openSeatLineOf(seatNo: number, detail: Pick<MatchDetail, 'match'>, elapsedMs = 0): SeatLine {
  const m = detail.match;
  if (m.status === 'filling' || m.status === 'awaiting_court') return { id: 'openFilling', params: {} };
  if (isStarted(m, elapsedMs)) return { id: 'openAfterStart', params: {} };
  return { id: 'openBookedBeforeStart', params: { share: shareOf(seatNo, m) } };
}

/**
 * A seat line's params as the catalog reads them: money through formatIQD
 * (Latin digits in both languages), the taker's name isolated, a write-off
 * reason through op.reasons when it is one of its codes. A figure the server
 * did not send is "—".
 */
export function seatLineParams(line: SeatLine, locale: Locale, tr: Tr): TParams {
  const money = (n: number | null | undefined) => (typeof n === 'number' && Number.isInteger(n) ? formatIQD(n, locale) : '—');
  const p = line.params;
  const out: Record<string, string> = {};
  if ('share' in p) out.share = money(p.share);
  if ('owed' in p) out.owed = money(p.owed);
  if ('paid' in p) out.paid = money(p.paid);
  if ('amount' in p) out.amount = money(p.amount);
  if ('reason' in p) out.reason = reasonText(p.reason, tr);
  if ('taker' in p) out.name = p.taker ? seatLabelOf(p.taker, tr) : '—';
  if ('status' in p) out.status = p.status ?? '—';
  return out;
}

/** The seat reason codes op.reasons words: write-off (R1) and desk remove codes. */
const REASON_KEYS = {
  walked_out: 'op.reasons.walked_out',
  staff_error: 'op.reasons.staff_error',
  other: 'op.reasons.other',
  customer_request: 'op.reasons.customer_request',
  conduct: 'op.reasons.conduct',
  duplicate: 'op.reasons.duplicate',
  court_needed: 'op.reasons.court_needed',
  no_shows: 'op.reasons.no_shows',
  reported: 'op.reasons.reported',
} as const satisfies Record<string, MessageKey>;

/**
 * A seat's end reason (`match_seats.end_reason`, 0258) and the code of a
 * `removed` event that is not a desk reason: the organiser's removal, the ban
 * sweep, a deleted account (ws.matches.seat.endReason).
 */
const END_REASON_KEYS = {
  removed_by_organiser: 'ws.matches.seat.endReason.removed_by_organiser',
  removed_by_staff: 'ws.matches.seat.endReason.removed_by_staff',
  banned: 'ws.matches.seat.endReason.banned',
  account_deleted: 'ws.matches.seat.endReason.account_deleted',
} as const satisfies Record<string, MessageKey>;

function has<T extends object>(table: T, code: string): code is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(table, code);
}

/**
 * A reason code in words: a write-off or desk remove code through op.reasons,
 * a seat's end reason through ws.matches.seat.endReason. A code this build
 * does not know prints as sent.
 */
export function reasonText(code: string | null | undefined, tr: Tr): string {
  if (!code) return '—';
  if (has(REASON_KEYS, code)) return tr(REASON_KEYS[code]);
  if (has(END_REASON_KEYS, code)) return tr(END_REASON_KEYS[code]);
  return code;
}

/** A quick message's code (app.post_match_message, 0261) in the words the players picked it by. */
const MESSAGE_KEYS = {
  on_my_way: 'matches.messages.onMyWay',
  running_late: 'matches.messages.runningLate',
  cant_make_it: 'matches.messages.cantMakeIt',
  bring_balls: 'matches.messages.bringBalls',
} as const satisfies Record<string, MessageKey>;

/** The `{code}` of a `message` history row: the message's words, or the code as sent when unknown. */
export function messageCodeText(code: string | null | undefined, tr: Tr): string {
  if (!code) return '—';
  return has(MESSAGE_KEYS, code) ? tr(MESSAGE_KEYS[code]) : code;
}

// ---------------------------------------------------------------------------
// A seat's buttons (§5.13.3–§5.13.9)
// ---------------------------------------------------------------------------

/** Why a shown control is disabled: offline (DF-11), or a no-show before the start. */
export type ActionBlock = 'offline' | 'notStarted';

export interface SeatAction {
  show: boolean;
  blockedBy: ActionBlock | null;
}

export interface SeatActions {
  arrived: SeatAction;
  noShow: SeatAction;
  undo: SeatAction;
  noShowInstead: SeatAction;
  arrivedInstead: SeatAction;
  takeShare: SeatAction;
  writeOff: SeatAction;
  remove: SeatAction;
  /** "Add player here" on a no-show's row; the caller also needs `openSeatNumbers` to be exactly one. */
  replace: SeatAction;
}

/** The screen-level capabilities (lib/auth.tsx CAPABILITY_ROLES) the rows need. */
export interface MatchCaps {
  runMatches: boolean;
  takeSeatPayment: boolean;
  writeOffSeat: boolean;
}

const HIDDEN: SeatAction = { show: false, blockedBy: null };

/**
 * A seat's buttons: the server's `can` answers, gated by the caller's
 * capabilities, disabled offline with the reason. The one client mirror is a
 * no-show before the start, shown disabled (SEAT_NOT_STARTED). A sandbox
 * match offers nothing.
 */
export function seatActionsOf(
  seat: MatchSeat,
  match: Pick<MatchInfo, 'status' | 'sandbox' | 'started' | 'start_at' | 'server_now'>,
  reachable: boolean,
  caps: MatchCaps,
  elapsedMs = 0,
): SeatActions {
  const none: SeatActions = {
    arrived: HIDDEN,
    noShow: HIDDEN,
    undo: HIDDEN,
    noShowInstead: HIDDEN,
    arrivedInstead: HIDDEN,
    takeShare: HIDDEN,
    writeOff: HIDDEN,
    remove: HIDDEN,
    replace: HIDDEN,
  };
  if (match.sandbox) return none;
  const started = isStarted(match, elapsedMs);
  const on = (show: boolean, block: ActionBlock | null = null): SeatAction =>
    show ? { show: true, blockedBy: reachable ? block : 'offline' } : HIDDEN;
  const run = caps.runMatches;
  const carrierIn = seat.carrying && seat.status === 'in';
  return {
    arrived: on(run && carrierIn && seat.can.mark_attended),
    // Before the start the server answers false; the button stays, disabled, with the reason.
    noShow: on(run && carrierIn && match.status === 'booked' && (seat.can.mark_no_show || !started), started ? null : 'notStarted'),
    // R16: undo only while the match is booked.
    undo: on(run && (seat.status === 'attended' || seat.status === 'no_show') && match.status === 'booked' && seat.can.unmark),
    noShowInstead: on(run && seat.status === 'attended' && seat.can.mark_no_show),
    arrivedInstead: on(run && seat.status === 'no_show' && seat.can.mark_attended),
    takeShare: on(caps.takeSeatPayment && seat.can.take_share),
    writeOff: on(caps.writeOffSeat && seat.can.write_off),
    remove: on(run && seat.can.remove_reasons.length > 0),
    replace: on(run && seat.can.replace),
  };
}

/** The match's own buttons: Add player (footer), Cancel match, Copy invite link. */
export function matchActionsOf(
  match: Pick<MatchInfo, 'sandbox' | 'can' | 'share_token'>,
  reachable: boolean,
  caps: Pick<MatchCaps, 'runMatches'>,
): { addSeat: SeatAction; cancel: SeatAction; copyLink: SeatAction } {
  if (match.sandbox || !caps.runMatches) return { addSeat: HIDDEN, cancel: HIDDEN, copyLink: HIDDEN };
  const on = (show: boolean): SeatAction => (show ? { show: true, blockedBy: reachable ? null : 'offline' } : HIDDEN);
  // Copying a link needs no server, so it is never blocked offline.
  return { addSeat: on(match.can.add_seat), cancel: on(match.can.cancel), copyLink: match.share_token ? { show: true, blockedBy: null } : HIDDEN };
}

/** "Mark all arrived": every carrier still `in` that may be marked arrived, in seat order. */
export function markAllArrivedIds(seats: readonly MatchSeat[]): string[] {
  return seats
    .filter((s) => s.carrying && s.status === 'in' && s.can.mark_attended)
    .sort((a, b) => a.seat_no - b.seat_no)
    .map((s) => s.seat_id);
}

// ---------------------------------------------------------------------------
// Taking shares (§5.13.4–§5.13.5)
// ---------------------------------------------------------------------------

function takeOf(seat: MatchSeat): number {
  const take = seat.money?.take_iqd ?? 0;
  return seat.can.take_share && take > 0 ? take : 0;
}

/**
 * The seats picked for one payment, in seat order (the server spreads the
 * money in that order), and what they owe between them: Σ the server's
 * `take_iqd`, sent back as `p_expected_owed_iqd`. A seat that cannot be taken
 * now is dropped.
 */
export function owingPick(seats: readonly MatchSeat[], ids: Iterable<string>): { seatIds: string[]; due: number } {
  const picked = new Set(ids);
  const rows = seats.filter((s) => picked.has(s.seat_id) && takeOf(s) > 0).sort((a, b) => a.seat_no - b.seat_no);
  return { seatIds: rows.map((s) => s.seat_id), due: rows.reduce((sum, s) => sum + takeOf(s), 0) };
}

export interface OwingGroup {
  holderSeatId: string;
  /** The holder's label, for "Take {name}'s group · {amount}". */
  holderName: string;
  seatIds: string[];
  due: number;
}

/**
 * "Take {name}'s group": a holder whose friend seats (or nameless desk
 * extras) owe, with the holder's own share when it owes too. Only groups of
 * two or more seats; one seat is plain Take share.
 */
export function groupOwingByHolder(seats: readonly MatchSeat[], tr: Tr): OwingGroup[] {
  const groups: OwingGroup[] = [];
  for (const holder of [...seats].sort((a, b) => a.seat_no - b.seat_no)) {
    const friends = seats.filter((s) => s.holder_seat_id === holder.seat_id && s.seat_id !== holder.seat_id && takeOf(s) > 0);
    if (friends.length === 0) continue;
    const pick = owingPick(seats, [holder.seat_id, ...friends.map((f) => f.seat_id)]);
    if (pick.seatIds.length < 2) continue;
    groups.push({ holderSeatId: holder.seat_id, holderName: seatLabelOf(holder, tr), seatIds: pick.seatIds, due: pick.due });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Call off short (§5.13.10; R12, R39)
// ---------------------------------------------------------------------------

export type CallOffState =
  /** Not a started booked match (or a sandbox one): no button. */
  | { state: 'hidden' }
  /** A carrier is still unmarked: shown disabled, "Mark every player first ({players} not marked)". */
  | { state: 'needsMarks'; unmarked: number }
  /** Everyone is marked and nobody is missing: no button. */
  | { state: 'notShort' }
  /** Short and the server allows it. */
  | { state: 'enabled' }
  /** Short, but the server refuses it now; `reason` is the sentence to show. */
  | { state: 'blocked'; reason: MessageKey };

/**
 * Carriers only (R21): a no-show whose number was re-seated no longer
 * counts. After the start a late leaver nobody replaced counts as absent
 * (R39), so the match is short.
 */
export function callOffState(detail: Pick<MatchDetail, 'match' | 'seats'>, elapsedMs = 0): CallOffState {
  const m = detail.match;
  if (m.sandbox || m.status !== 'booked' || !isStarted(m, elapsedMs)) return { state: 'hidden' };
  const carriers = detail.seats.filter((s) => s.carrying);
  const unmarked = carriers.filter((s) => s.status === 'in').length;
  if (unmarked > 0) return { state: 'needsMarks', unmarked };
  const short = carriers.some((s) => s.status === 'no_show' || s.status === 'left_late');
  if (!short) return { state: 'notShort' };
  if (m.can.call_off) return { state: 'enabled' };
  if (!carriers.some((s) => s.status === 'attended')) return { state: 'blocked', reason: 'ws.matches.errors.transition.nobody_came' };
  if (!m.marks_open) return { state: 'blocked', reason: 'ws.matches.errors.markLocked.day_closed' };
  return { state: 'blocked', reason: 'op.errors.INVALID_TRANSITION' };
}

/** The call-off confirmation's two lists: who came, and who did not (no-shows and unreplaced late leavers). */
export function callOffNames(seats: readonly MatchSeat[], tr: Tr): { came: string[]; missing: string[] } {
  const carriers = seats.filter((s) => s.carrying).sort((a, b) => a.seat_no - b.seat_no);
  return {
    came: carriers.filter((s) => s.status === 'attended').map((s) => seatLabelOf(s, tr)),
    missing: carriers.filter((s) => s.status === 'no_show' || s.status === 'left_late').map((s) => seatLabelOf(s, tr)),
  };
}

// ---------------------------------------------------------------------------
// The Today group (§5.9)
// ---------------------------------------------------------------------------

export type NeedsPlayersTag = 'approve' | 'link' | 'lastCourt' | 'waitingCourt' | 'bookedSeatFree';

export interface NeedsPlayersRow {
  match: OpenMatch;
  /** Seats taken of four; null when the server did not say. */
  taken: number | null;
  requests: number;
  /** "Closes 19:00": a filling match only. */
  deadlineAt: string | null;
  /** Under 30 minutes to the deadline (warn tone). */
  deadlineWarn: boolean;
  tags: NeedsPlayersTag[];
  /** Add player: not while a match waits for a court. */
  canAddPlayer: boolean;
}

const DEADLINE_WARN_MS = 30 * 60_000;

/** Filling and awaiting matches, and booked ones with a free seat, by start. */
export function needsPlayersRows(open: OpenMatches | null | undefined, serverNow?: string | null): NeedsPlayersRow[] {
  if (!open) return [];
  const now = ms(serverNow ?? open.server_now);
  return open.matches
    .filter((m) => m.status === 'filling' || m.status === 'awaiting_court' || (m.status === 'booked' && (m.seats_left ?? 0) > 0))
    .sort((a, b) => a.start_at.localeCompare(b.start_at) || a.match_id.localeCompare(b.match_id))
    .map((m) => {
      const filling = m.status === 'filling';
      const deadline = filling ? m.fill_deadline_at : null;
      const deadlineMs = ms(deadline);
      const tags: NeedsPlayersTag[] = [];
      if (m.join_policy === 'approve') tags.push('approve');
      if (m.visibility === 'link') tags.push('link');
      if (filling && m.courts_free_firm === 1) tags.push('lastCourt');
      if (m.status === 'awaiting_court') tags.push('waitingCourt');
      if (m.status === 'booked') tags.push('bookedSeatFree');
      return {
        match: m,
        taken: m.seats_taken,
        requests: m.requests_pending ?? 0,
        deadlineAt: deadline,
        deadlineWarn: deadlineMs !== null && now !== null && deadlineMs - now < DEADLINE_WARN_MS,
        tags,
        canAddPlayer: m.status !== 'awaiting_court',
      };
    });
}

// ---------------------------------------------------------------------------
// The new-booking dialog's client mirrors (§5.10; OM-12, OM-13, R22)
// ---------------------------------------------------------------------------

export interface BookingDraft {
  courtId: string;
  startAt: string;
  endAt: string;
  kind: string;
}

/** A row that holds a court firmly: every live row but a hold (R22). A pending booking is firm. */
function isFirm(r: Pick<ReservationRow, 'status' | 'kind'>): boolean {
  return BLOCKING_STATUSES.has(r.status) && r.kind !== 'hold';
}

/**
 * The filling matches a firm booking of this court and time would cancel:
 * the match overlaps the draft, has one firm-free court left
 * (`courts_free_firm = 1`), the court offers the match's length, and the
 * court has no firm row over the match's time, so it is that last court. The
 * server decides; this only warns (Create stays enabled, OM-13).
 */
export function matchesBumpedBy(
  openMatches: readonly OpenMatch[] | null | undefined,
  reservations: readonly Pick<ReservationRow, 'id' | 'court_id' | 'status' | 'kind' | 'start_at' | 'end_at'>[],
  courts: readonly Pick<CourtRow, 'id' | 'duration_options'>[],
  draft: BookingDraft,
): OpenMatch[] {
  if (!openMatches || (draft.kind !== 'booking' && draft.kind !== 'maintenance')) return [];
  const pStart = ms(draft.startAt);
  const pEnd = ms(draft.endAt);
  const court = courts.find((c) => c.id === draft.courtId);
  if (pStart === null || pEnd === null || !court) return [];
  return openMatches.filter((m) => {
    const mStart = ms(m.start_at);
    const mEnd = ms(m.end_at);
    if (m.status !== 'filling' || mStart === null || mEnd === null) return false;
    if (!overlaps(pStart, pEnd, mStart, mEnd)) return false;
    if (m.courts_free_firm !== 1) return false;
    if (m.duration_min === null || !court.duration_options.includes(m.duration_min)) return false;
    return !reservations.some((r) => {
      if (r.court_id !== court.id || !isFirm(r)) return false;
      const rStart = ms(r.start_at);
      const rEnd = ms(r.end_at);
      return rStart !== null && rEnd !== null && overlaps(rStart, rEnd, mStart, mEnd);
    });
  });
}

/** The matches waiting for a court at this time (R22): a court here is kept for one of them. */
export function awaitingCourtOverlap(
  openMatches: readonly OpenMatch[] | null | undefined,
  draft: Pick<BookingDraft, 'startAt' | 'endAt'>,
): OpenMatch[] {
  const pStart = ms(draft.startAt);
  const pEnd = ms(draft.endAt);
  if (!openMatches || pStart === null || pEnd === null) return [];
  return openMatches.filter((m) => {
    const mStart = ms(m.start_at);
    const mEnd = ms(m.end_at);
    return m.status === 'awaiting_court' && mStart !== null && mEnd !== null && overlaps(pStart, pEnd, mStart, mEnd);
  });
}

// ---------------------------------------------------------------------------
// The invite link (§5.12)
// ---------------------------------------------------------------------------

/**
 * `<guest site>/m/<share_token>`: the same origin rule the QR cards use
 * (a production build never links to localhost). Callers pass
 * `import.meta.env.VITE_GUEST_SITE_URL` and `import.meta.env.PROD`.
 */
export function inviteUrl(shareToken: string, siteUrl: string | undefined, isProduction: boolean): string {
  return `${resolveGuestSiteUrl(siteUrl, isProduction)}/m/${encodeURIComponent(shareToken)}`;
}

// ---------------------------------------------------------------------------
// Ended matches and the history (§5.12.1, §5.12.2)
// ---------------------------------------------------------------------------

const ENDED_SENTENCES = {
  'played:': 'ws.matches.common.endedReason.played',
  'no_show:all_no_show': 'ws.matches.common.endedReason.allNoShow',
  'no_show:': 'ws.matches.common.endedReason.allNoShow',
  'cancelled:organiser_cancelled': 'ws.matches.common.endedReason.organiserCancelled',
  'cancelled:staff_cancelled': 'ws.matches.common.endedReason.staffCancelled',
  'cancelled:reservation_cancelled': 'ws.matches.common.endedReason.reservationCancelled',
  'cancelled:called_off_short': 'ws.matches.common.endedReason.calledOffShort',
  'cancelled:empty': 'ws.matches.common.endedReason.empty',
  'cancelled:venue_closed': 'ws.matches.common.endedReason.venueClosed',
  'bumped:bumped': 'ws.matches.common.endedReason.bumped',
  'bumped:no_court': 'ws.matches.common.endedReason.bumpedNoCourt',
  'expired:deadline': 'ws.matches.common.endedReason.deadline',
  'expired:no_court': 'ws.matches.common.endedReason.expiredNoCourt',
} as const satisfies Record<string, MessageKey>;

/**
 * The sentence of an ended (or played) match. null for a live status, and for
 * a pairing the table does not name: the screen then shows the raw status,
 * neutral.
 */
export function endedSentenceKey(status: string, endedReason: string | null | undefined): MessageKey | null {
  if (status === 'played') return ENDED_SENTENCES['played:'];
  const exact = `${status}:${endedReason ?? ''}` as keyof typeof ENDED_SENTENCES;
  if (exact in ENDED_SENTENCES) return ENDED_SENTENCES[exact];
  // A match that reached no_show has only one reason; read it even if the reason is missing.
  if (status === 'no_show') return ENDED_SENTENCES['no_show:'];
  return null;
}

/** matches.status values the common catalog words; anything else prints raw. */
const MATCH_STATUSES = ['filling', 'awaiting_court', 'booked', 'played', 'no_show', 'cancelled', 'bumped', 'expired'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** The status badge's words, or null for a status this build does not know. */
export function matchStatusKey(status: string): MessageKey | null {
  return (MATCH_STATUSES as readonly string[]).includes(status) ? (`ws.matches.common.status.${status as MatchStatus}` as const) : null;
}

/** match_events.type (§1.3), each worded in ws.matches.events (the match-screen lane). */
export const MATCH_EVENT_TYPES = [
  'started',
  'requested',
  'approved',
  'declined',
  'withdrawn',
  'request_expired',
  'joined',
  'left',
  'left_late',
  'refilled',
  'removed',
  'organiser_changed',
  'awaiting_court',
  'booked',
  'bumped',
  'expired',
  'cancelled',
  'moved',
  'deadline_warning',
  'message',
  'seat_attended',
  'seat_no_show',
  'seat_unmarked',
  'called_off_short',
  'played',
  'no_show',
] as const;
export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

/** `ws.matches.events.<type>`, or null for a type this build does not know (the row prints the raw word). */
export function eventKey(type: string): `ws.matches.events.${MatchEventType}` | null {
  return (MATCH_EVENT_TYPES as readonly string[]).includes(type) ? `ws.matches.events.${type as MatchEventType}` : null;
}

// ---------------------------------------------------------------------------
// Refusals read from their detail (§5.20)
// ---------------------------------------------------------------------------

const MARK_LOCKED = {
  day_closed: 'ws.matches.errors.markLocked.day_closed',
  ticket_used: 'ws.matches.errors.markLocked.ticket_used',
  court_reused: 'ws.matches.errors.markLocked.court_reused',
  replaced: 'ws.matches.errors.markLocked.replaced',
  paid: 'ws.matches.errors.markLocked.paid',
  match_ended: 'ws.matches.errors.markLocked.match_ended',
} as const satisfies Record<string, MessageKey>;

const TRANSITION = {
  marked: 'ws.matches.errors.transition.marked',
  not_carrier: 'ws.matches.errors.transition.not_carrier',
  use_attendance: 'ws.matches.errors.transition.use_attendance',
  not_short: 'ws.matches.errors.transition.not_short',
  nobody_came: 'ws.matches.errors.transition.nobody_came',
  match_ended: 'ws.matches.errors.transition.match_ended',
  ended: 'ws.matches.errors.transition.ended',
} as const satisfies Record<string, MessageKey>;

const PAYMENT_STATE = {
  empty: 'ws.matches.errors.paymentState.empty',
  over_paid: 'ws.matches.errors.paymentState.over_paid',
  ticket: 'ws.matches.errors.paymentState.ticket',
} as const satisfies Record<string, MessageKey>;

const TICKET_IN_USE = {
  in_use: 'ws.matches.errors.ticketInUse.in_use',
  reserved: 'ws.matches.errors.ticketInUse.reserved',
  restorable: 'ws.matches.errors.ticketInUse.restorable',
} as const satisfies Record<string, MessageKey>;

function pick<T extends Record<string, MessageKey>>(table: T, detail: string | undefined): MessageKey | null {
  return detail !== undefined && Object.prototype.hasOwnProperty.call(table, detail) ? table[detail as keyof T]! : null;
}

/**
 * The TICKET_IN_USE detail: Money's JSON text `{reason, count, until_at}`
 * (money.md §5.8). null when it is not that shape.
 */
export function ticketInUseDetail(details: string | undefined): { reason: string; count: number | null; untilAt: string | null } | null {
  if (!details) return null;
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    if (typeof d.reason !== 'string') return null;
    return {
      reason: d.reason,
      count: typeof d.count === 'number' ? d.count : null,
      untilAt: typeof d.until_at === 'string' ? d.until_at : null,
    };
  } catch {
    return null;
  }
}

/** SEAT_OWED_CHANGED's detail `expected X, now Y`: the new owed (Y), or null. */
export function seatOwedNow(error: unknown): number | null {
  if (!(error instanceof AppRpcError) || error.code !== 'SEAT_OWED_CHANGED' || !error.details) return null;
  const m = error.details.match(/now\s+(-?\d+)/);
  return m ? Number(m[1]) : null;
}

export interface MatchErrorContext {
  /** The payload's server_now: MATCH_TOO_LATE's detail is minutes from it. */
  serverNow?: string | null;
  /** The start of the match a SLOT_TAKEN `match_waiting` court is kept for (awaitingCourtOverlap). */
  waitingStartAt?: string | null;
}

/**
 * A refusal's words: the ws.matches.errors key its detail names, else the
 * code's own op.errors line (`errorToMessageKey`). `timeAt` is the instant
 * the sentence's {time} shows, when it has one.
 */
export function matchErrorKey(error: unknown, ctx: MatchErrorContext = {}): { key: MessageKey; timeAt?: string } {
  const fallback = { key: errorToMessageKey(error) };
  if (!(error instanceof AppRpcError)) return fallback;
  const detail = error.details?.trim() || undefined;
  switch (error.code) {
    case 'SEAT_MARK_LOCKED': {
      const key = pick(MARK_LOCKED, detail);
      return key ? { key } : fallback;
    }
    case 'INVALID_TRANSITION': {
      const key = pick(TRANSITION, detail);
      return key ? { key } : fallback;
    }
    case 'FORBIDDEN':
      return detail === 'manager_required' ? { key: 'ws.matches.errors.managerRequired' } : fallback;
    case 'PAYMENT_STATE': {
      const key = pick(PAYMENT_STATE, detail);
      return key ? { key } : fallback;
    }
    case 'INVALID_ARGUMENT':
      return detail === 'already_linked' ? { key: 'ws.matches.errors.alreadyLinked' } : fallback;
    case 'SLOT_TAKEN':
      return detail === 'match_waiting' && ctx.waitingStartAt ? { key: 'ws.matches.errors.slotKept', timeAt: ctx.waitingStartAt } : fallback;
    case 'TICKET_IN_USE': {
      const d = ticketInUseDetail(error.details);
      const key = d ? pick(TICKET_IN_USE, d.reason) : null;
      if (!d || !key) return fallback;
      if (d.reason === 'restorable') return { key };
      return d.untilAt ? { key, timeAt: d.untilAt } : fallback;
    }
    case 'MATCH_TOO_LATE': {
      const minutes = detail !== undefined ? Number(detail) : NaN;
      const now = ms(ctx.serverNow);
      if (!Number.isFinite(minutes) || now === null) return fallback;
      return { key: 'ws.matches.errors.tooLateAt', timeAt: new Date(now + minutes * 60_000).toISOString() };
    }
    default:
      return fallback;
  }
}

/** matchErrorKey in words, {time} in the branch's timezone. For ErrorText's `message`. */
export function matchErrorText(error: unknown, opts: MatchErrorContext & { tr: Tr; locale: Locale; tz?: string }): string {
  const { key, timeAt } = matchErrorKey(error, opts);
  return timeAt ? opts.tr(key, { time: formatTime(new Date(timeAt), opts.locale, opts.tz) }) : opts.tr(key);
}

/**
 * RPC_MISSING (PGRST202): the server has no matches yet. A match read that
 * meets it renders nothing, never "needs a connection" (§5.5).
 */
export function isMatchesAbsent(error: unknown): boolean {
  return error instanceof AppRpcError && error.code === 'RPC_MISSING';
}

// ---------------------------------------------------------------------------
// A match read's state on screen (§5.5)
// ---------------------------------------------------------------------------

export type MatchReadStatus<T> =
  /** First load: a skeleton, or nothing. */
  | { kind: 'loading' }
  /** RPC_MISSING: this server has no matches; render no match UI. */
  | { kind: 'absent' }
  /** The first read failed: the refused presenter (wifiOff) with Retry. Nothing disappears silently. */
  | { kind: 'failed'; error: unknown }
  /**
   * Data to show. `stale` when the last refetch failed, the station is
   * offline, or it is the previous key's data while a new one loads: add the
   * muted "Last updated {time}" line (`updatedAt`).
   */
  | { kind: 'ready'; data: T; stale: boolean; updatedAt: number };

/** The query shape `matchReadStatus` reads (a TanStack UseQueryResult fits). */
export interface MatchReadQuery<T> {
  data: T | null | undefined;
  error: unknown;
  isError: boolean;
  isPlaceholderData: boolean;
  dataUpdatedAt: number;
}

/** One reading of a match query, so every surface treats absent, failed and stale alike. */
export function matchReadStatus<T>(q: MatchReadQuery<T>, reachable: boolean): MatchReadStatus<T> {
  if (q.data === null) return { kind: 'absent' };
  if (q.data === undefined) {
    if (q.isError) return isMatchesAbsent(q.error) ? { kind: 'absent' } : { kind: 'failed', error: q.error };
    return { kind: 'loading' };
  }
  return { kind: 'ready', data: q.data, stale: q.isError || !reachable || q.isPlaceholderData, updatedAt: q.dataUpdatedAt };
}
