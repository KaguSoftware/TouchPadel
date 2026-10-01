/**
 * Every guest state of an open match, and the dead ends closed (R32;
 * docs/design/open-matches/guest.md §4.15). PURE, shared by the lists (My
 * Reservations, booking history) and the match screen.
 *
 * `guestStateOf` walks the §4.15 table top to bottom and the FIRST matching
 * row wins; `__tests__/state.test.ts` holds every row. Its inputs are only what
 * the server sent: the guest's own seat (the latest of their account seats and
 * the desk seats linked to them), that seat's ticket status (NULL for a desk
 * seat, which drops every ticket phrase), the request, the role, the match's
 * status and ending. The phone decides nothing here that the server did not.
 *
 * `actionCardOf` is the match screen's action card (§4.14): which card a
 * viewer, a requester or a member sees, from `me.can`, `me.refusal` and the
 * guest's own seat.
 */
import { countPhrase, formatIQD, formatTime, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import {
  byCategory,
  SEATS_TOTAL,
  seatsOfLabel,
  type EndedReason,
  type MatchCategory,
  type MatchDetail,
  type MatchRole,
  type MatchStatus,
  type MyMatchRow,
  type MyRequest,
  type MySeat,
  type SeatEndReason,
} from './logic';

export type GuestState =
  | 'requested'
  | 'declined'
  | 'withdrawn'
  | 'requestExpired'
  | 'approvedIn'
  | 'in'
  | 'awaitingCourt'
  | 'booked'
  | 'checkedIn'
  | 'leftLate'
  | 'removedLate'
  | 'leftLateLost'
  | 'leftDesk'
  | 'refilled'
  | 'calledOff'
  | 'played'
  | 'noShow'
  | 'left'
  | 'removed'
  | 'removedByVenue'
  | 'banned'
  | 'bumped'
  | 'expired'
  | 'noCourt'
  | 'cancelledByOrganiser'
  | 'cancelledByVenue'
  | 'closedEmpty'
  | 'unknown';

/** What `guestStateOf` reads: the same few fields from `match_detail` or a `my_matches` row. */
export interface StateInput {
  status: MatchStatus | null;
  endedReason: EndedReason | null;
  role: MatchRole | null;
  /** Every seat the guest holds in the match, in `joined_at, seat_no` order. */
  seats: readonly MySeat[];
  request: MyRequest | null;
}

export interface GuestStateResult {
  state: GuestState;
  /** The §4.15 row that matched (1..28), for tests and telemetry. */
  row: number;
  /** The guest's own seat (account, or desk linked to them), or null. */
  seat: MySeat | null;
  /** The own seat is a desk seat: no ticket phrase. */
  desk: boolean;
  /** How many tickets the line speaks of (0 for a desk seat): the party's seats, or a request's. */
  tickets: number;
  /** The own seat's end reason, for the variants of rows 12. */
  endReason: SeatEndReason | null;
}

export function stateInputOfDetail(d: MatchDetail): StateInput {
  return { status: d.status, endedReason: d.endedReason, role: d.me.role, seats: d.me.seats, request: d.me.request };
}

export function stateInputOfMine(r: MyMatchRow): StateInput {
  return { status: r.status, endedReason: r.endedReason, role: r.myRole, seats: r.mySeats, request: r.request };
}

/**
 * The guest's own seat (§4.15): the LATEST of their account seats and the desk
 * seats linked to them. `match_my_seats` orders by `joined_at, seat_no`, so it
 * is the last such seat in the list. Friend seats are never "own".
 */
export function ownSeatOf(seats: readonly MySeat[]): MySeat | null {
  for (let i = seats.length - 1; i >= 0; i--) {
    const s = seats[i]!;
    if (s.kind === 'account' || s.kind === 'desk') return s;
  }
  return null;
}

const VENUE_CANCELS: ReadonlySet<EndedReason> = new Set<EndedReason>([
  'staff_cancelled',
  'reservation_cancelled',
  'venue_closed',
]);

export function guestStateOf(input: StateInput): GuestStateResult {
  const seat = ownSeatOf(input.seats);
  const desk = seat?.kind === 'desk';
  // One ticket per seat of the guest's party in the state the own seat is in:
  // their own and the friend seats that moved with it. A desk seat holds none.
  const partySeats = seat
    ? 1 + input.seats.filter((s) => s.kind === 'friend' && s.status === seat.status).length
    : 0;
  const result = (row: number, state: GuestState, tickets = desk ? 0 : partySeats): GuestStateResult => ({
    state,
    row,
    seat,
    desk,
    tickets,
    endReason: seat?.endReason ?? null,
  });

  if (!seat) {
    const req = input.request;
    const n = req?.seatsRequested ?? 0;
    switch (req?.status) {
      case 'pending':
        return result(1, 'requested', n);
      case 'declined':
        return result(2, 'declined', n);
      case 'withdrawn':
        return result(3, 'withdrawn', n);
      case 'expired':
        return result(4, 'requestExpired', n);
      default:
        return result(28, 'unknown', 0);
    }
  }

  const status = input.status;
  const ended = input.endedReason;
  const ticket = seat.ticketStatus;
  switch (seat.status) {
    case 'in':
      if (status === 'filling') return seat.requestId ? result(5, 'approvedIn') : result(6, 'in');
      if (status === 'awaiting_court') return result(7, 'awaitingCourt');
      if (status === 'booked') return result(8, 'booked');
      break;
    case 'attended':
      if (status === 'booked') return result(9, 'checkedIn');
      if (status === 'cancelled' || ended === 'called_off_short') return result(15, 'calledOff');
      return result(16, 'played');
    case 'left_late':
      if (seat.endReason === 'left' && ticket === 'in_use') return result(10, 'leftLate');
      if (seat.endReason === 'removed_by_staff' && ticket === 'in_use') return result(11, 'removedLate');
      if (ticket === 'forfeited') return result(12, 'leftLateLost');
      // A desk seat holds no ticket, so rows 11 and 12 never match it: the
      // venue's removal still reads as the venue's, never "You left" (R32 item 3).
      if (desk && seat.endReason === 'removed_by_staff') return result(20, 'removedByVenue');
      if (desk) return result(13, 'leftDesk');
      break;
    case 'refilled':
      return result(14, 'refilled');
    case 'no_show':
      return result(17, 'noShow');
    case 'left':
      return result(18, 'left');
    case 'removed':
      if (seat.endReason === 'removed_by_organiser') return result(19, 'removed');
      if (seat.endReason === 'removed_by_staff') return result(20, 'removedByVenue');
      if (seat.endReason === 'banned') return result(21, 'banned');
      break;
    case 'cancelled':
      if (ended === 'bumped') return result(22, 'bumped');
      if (ended === 'deadline') return result(23, 'expired');
      if (ended === 'no_court') return result(24, 'noCourt');
      if (ended === 'organiser_cancelled') return result(25, 'cancelledByOrganiser');
      if (ended !== null && VENUE_CANCELS.has(ended)) return result(26, 'cancelledByVenue');
      if (ended === 'empty') return result(27, 'closedEmpty');
      break;
    default:
      break;
  }
  return result(28, 'unknown');
}

// ── Where a state is listed (§4.15 "Where", §4.16) ──────────────────────────

export type StateSection = 'open' | 'upcoming' | 'played' | 'cancelled' | 'history';

/**
 * The list a state belongs in. A late leaver's seat stays under Open matches
 * until the start (it may still be refilled); a booked match stays under
 * Upcoming until it ends.
 */
export function stateSection(
  state: GuestState,
  at: { startAt: string; endAt: string; now: Date },
): StateSection {
  const now = at.now.getTime();
  switch (state) {
    case 'requested':
    case 'approvedIn':
    case 'in':
    case 'awaitingCourt':
      return 'open';
    case 'leftLate':
    case 'removedLate':
      return Date.parse(at.startAt) > now ? 'open' : 'history';
    case 'booked':
    case 'checkedIn':
      return Date.parse(at.endAt) > now ? 'upcoming' : 'history';
    case 'played':
      return 'played';
    case 'calledOff':
    case 'bumped':
    case 'expired':
    case 'noCourt':
    case 'cancelledByOrganiser':
    case 'cancelledByVenue':
      return 'cancelled';
    default:
      return 'history';
  }
}

// ── The line (§4.15 EN / AR) ────────────────────────────────────────────────

export interface StateLineContext {
  t: (key: MessageKey, params?: TParams) => string;
  locale: Locale;
  category: MatchCategory;
  /** The branch timezone, for "fills by {time}" and "didn't fill by {time}". */
  timezone: string;
  /** The guest organises this match: row 25 reads "You cancelled this match". */
  isOrganiser: boolean;
  seatsTaken: number;
  fillDeadlineAt: string | null;
}

/**
 * What the guest's party owes at the desk (rows 8 and 9): their own seat's
 * share and their friends' seats that are still in or attended. The server's
 * `share_iqd`, summed; nothing is priced here.
 */
export function partyShareIqd(result: GuestStateResult, seats: readonly MySeat[]): number | null {
  if (!result.seat) return null;
  let sum = 0;
  let any = false;
  for (const s of seats) {
    const counts =
      s.seatId === result.seat.seatId ||
      (s.kind === 'friend' && (s.status === 'in' || s.status === 'attended'));
    if (counts && s.shareIqd !== null) {
      sum += s.shareIqd;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * The §4.15 line for a state, its parts joined with " · ". The ticket phrase
 * is a counted key (one ticket reads "ticket back", two "tickets back") and is
 * dropped for a desk seat. `share` is `partyShareIqd`, for rows 8 and 9.
 */
export function stateLine(result: GuestStateResult, ctx: StateLineContext, share: number | null = null): string {
  const { t, locale, category } = ctx;
  const time = ctx.fillDeadlineAt ? formatTime(new Date(ctx.fillDeadlineAt), locale, ctx.timezone) : '';
  const back = result.tickets > 0 ? countPhrase('matches.count.ticketsBack', result.tickets, locale) : null;
  const lost = result.tickets > 0 ? countPhrase('matches.count.ticketsLost', result.tickets, locale) : null;
  const inWallet = back ? t('matches.states.inWallet', { tickets: back }) : null;
  const atDesk = share !== null ? t('matches.common.shareAtDesk', { share: formatIQD(share, locale) }) : null;
  const parts: (string | null)[] = (() => {
    switch (result.state) {
      case 'requested':
        return [t(byCategory(category, 'matches.states.requested'))];
      case 'declined':
        return [t('matches.states.declined'), inWallet];
      case 'withdrawn':
        return [t('matches.states.withdrawn'), back];
      case 'requestExpired':
        return [t('matches.states.requestExpired'), back];
      case 'approvedIn':
        return [t('matches.states.approvedIn', { seats: seatsOfLabel(ctx.seatsTaken, t) })];
      case 'in':
        return [
          t('matches.states.in', {
            players: countPhrase(
              byCategory(category, 'matches.count.playersNeeded'),
              Math.max(0, SEATS_TOTAL - ctx.seatsTaken),
              locale,
            ),
            time,
          }),
        ];
      case 'awaitingCourt':
        return [t('matches.states.awaitingCourt')];
      case 'booked':
        return [t('matches.states.booked'), atDesk];
      case 'checkedIn':
        return [t('matches.states.checkedIn'), back, atDesk];
      case 'leftLate':
        return [t('matches.states.leftLate')];
      case 'removedLate':
        return [t('matches.states.removedLate')];
      case 'leftLateLost':
        return [
          t(
            result.endReason === 'removed_by_staff'
              ? 'matches.states.removedLateLost'
              : 'matches.states.leftLateLost',
          ),
        ];
      case 'leftDesk':
        return [t('matches.states.leftDesk')];
      case 'refilled':
        return [t(byCategory(category, 'matches.states.refilled')), back];
      case 'calledOff':
        return [t('matches.states.calledOff'), back, t('matches.states.nothingToPay')];
      case 'played':
        return [t('matches.states.played'), inWallet];
      case 'noShow':
        return [t('matches.states.noShow'), lost];
      case 'left':
        return [t('matches.states.left'), back];
      case 'removed':
        return [t(byCategory(category, 'matches.states.removed')), back, t('matches.states.cantRejoin')];
      case 'removedByVenue':
        return [t('matches.states.removedByVenue'), back];
      case 'banned':
        return [t('matches.states.banned')];
      case 'bumped':
        return [t('matches.states.bumped'), back];
      case 'expired':
        return [t('matches.states.expired', { time }), back];
      case 'noCourt':
        return [t('matches.states.noCourt'), back];
      case 'cancelledByOrganiser':
        return [
          ctx.isOrganiser
            ? t('matches.states.cancelledByMe')
            : t(byCategory(category, 'matches.states.cancelledByOrganiser')),
          back,
        ];
      case 'cancelledByVenue':
        return [t('matches.states.cancelledByVenue'), back];
      case 'closedEmpty':
        return [t('matches.states.closedEmpty')];
      case 'unknown':
        return [t('matches.states.unknown')];
    }
  })();
  return parts.filter((p): p is string => !!p).join(' · ');
}

// ── The match screen's action card (§4.14) ──────────────────────────────────

export type ActionCard =
  /** The organiser removed the viewer (OM-44): no button. */
  | { kind: 'excluded' }
  /** A pending request: "Request sent · {tickets} held…", Withdraw. */
  | { kind: 'requested'; tickets: number }
  /** In a filling match: "You're in · waiting for {players}", Leave. */
  | { kind: 'in'; approved: boolean }
  /** Four in, no court yet: Leave. */
  | { kind: 'awaitingCourt' }
  /** Booked, before the start: "Booked · {court} · pay {share} at the desk", Leave. */
  | { kind: 'booked' }
  /** The seat stepper and Join (enough tickets for one seat). */
  | { kind: 'join'; maxSeats: number }
  /** Ask to join (enough tickets for one seat). */
  | { kind: 'ask'; maxSeats: number }
  /** Too few tickets: "Buy {tickets} and join" (or "…and ask"). */
  | { kind: 'buy'; mode: 'join' | 'ask'; missing: number; maxSeats: number }
  /** The one-time gender ask (OM-28, DF-10). */
  | { kind: 'gender' }
  /** Any other refusal: that code's copy, no button. */
  | { kind: 'refusal'; code: string }
  /** Anything else: the §4.15 line. */
  | { kind: 'state' };

/**
 * The action card for the viewer (§4.14 table), first row that applies:
 * excluded; a pending request; the guest's own seat still `in` (filling,
 * waiting for a court, booked before the start); then, for someone who can
 * join or ask, the gender ask while their gender is unset, the buy card when
 * their wallet cannot cover one seat, else Join / Ask; then the refusal; then
 * the state line. `nowMs` is the server's clock (`serverNowMs`).
 */
export function actionCardOf(
  detail: MatchDetail,
  opts: { genderUnset: boolean; nowMs: number },
): ActionCard {
  const me = detail.me;
  if (me.excluded) return { kind: 'excluded' };
  const seat = ownSeatOf(me.seats);
  if (me.request?.status === 'pending' && (!seat || seat.status !== 'in')) {
    return { kind: 'requested', tickets: me.request.seatsRequested };
  }
  if (seat?.status === 'in') {
    if (detail.status === 'filling') return { kind: 'in', approved: seat.requestId !== null };
    if (detail.status === 'awaiting_court') return { kind: 'awaitingCourt' };
    if (detail.status === 'booked' && Date.parse(detail.startAt) > opts.nowMs) return { kind: 'booked' };
  }
  const maxSeats = Math.max(1, Math.min(3, detail.seatsLeft));
  if (me.can.join || me.can.request) {
    if (opts.genderUnset || me.refusal === 'GENDER_REQUIRED') return { kind: 'gender' };
    const mode = me.can.join ? 'join' : 'ask';
    const missing = Math.min(3, Math.max(0, me.ticketsNeeded, 1 - me.ticketsAvailable));
    if (missing > 0) return { kind: 'buy', mode, missing, maxSeats };
    return mode === 'join' ? { kind: 'join', maxSeats } : { kind: 'ask', maxSeats };
  }
  if (me.refusal === 'GENDER_REQUIRED') return { kind: 'gender' };
  if (me.refusal) return { kind: 'refusal', code: me.refusal };
  return { kind: 'state' };
}

/** The leave confirmation the detail shows (§4.14 Confirms), from the server's `leave_outcome`. */
export function leaveConfirm(detail: MatchDetail): {
  outcome: 'release' | 'locked_until_refill';
  withFriends: boolean;
  organiser: boolean;
} | null {
  const outcome = detail.me.leaveOutcome;
  if (outcome === 'none') return null;
  const withFriends = detail.me.seats.some((s) => s.kind === 'friend' && s.status === 'in');
  return { outcome, withFriends, organiser: detail.me.role === 'organiser' };
}
