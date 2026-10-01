/**
 * Open matches on the phone, decided in PURE code (no RN / expo / supabase
 * imports, so vitest runs it under plain node).
 *
 * Binding shapes: docs/design/open-matches/guest.md §4.3 (the read contracts,
 * R31) and §1.3 of build-contracts-2026-09-27.md (the vocabularies).
 *
 * THE RULE THIS FILE KEEPS (guest.md §4.0 rule 4): the phone never computes a
 * price, a share, a permission or a refusal. It renders what the server sent
 * (`share_iqd`, the wallet counts, `me.can`, `me.refusal`) and parses every
 * enum defensively: an unknown value falls back and never throws, as
 * `parseDepositStatus` does (features/deposit/logic.ts). The helpers below
 * only arrange what the server already decided: which seat reads how, which
 * lane carries a chip, which trading night a match belongs to.
 */
import {
  isOvernightTail,
  localParts,
  parseHHMM,
  wallTimeToUtc,
  type OpeningHours,
} from '@touch/core';
import { isolate, isolateLtr, type MessageKey, type TParams } from '@touch/i18n';
import {
  cancelledBookings,
  playedGames,
  splitBookings,
  visiblePast,
  type BookingRow,
} from '../booking/logic';
import { guestStateOf, stateInputOfMine, stateSection, type GuestState } from './state';

// ── Server vocabulary (build-contracts §1.3) ────────────────────────────────

export const MATCH_CATEGORIES = ['open', 'women', 'men'] as const;
export type MatchCategory = (typeof MATCH_CATEGORIES)[number];

export const JOIN_POLICIES = ['open', 'approve'] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export const VISIBILITIES = ['public', 'link'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MATCH_STATUSES = [
  'filling',
  'awaiting_court',
  'booked',
  'played',
  'no_show',
  'cancelled',
  'bumped',
  'expired',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** The statuses a match is still live in (a seat can change, a push can land). */
export const LIVE_MATCH_STATUSES: readonly MatchStatus[] = ['filling', 'awaiting_court', 'booked'];

export const ENDED_REASONS = [
  'organiser_cancelled',
  'staff_cancelled',
  'reservation_cancelled',
  'called_off_short',
  'bumped',
  'deadline',
  'empty',
  'venue_closed',
  'no_court',
  'all_no_show',
] as const;
export type EndedReason = (typeof ENDED_REASONS)[number];

export const SEAT_KINDS = ['account', 'friend', 'desk'] as const;
export type SeatKind = (typeof SEAT_KINDS)[number];

export const SEAT_STATUSES = [
  'in',
  'left',
  'removed',
  'cancelled',
  'left_late',
  'refilled',
  'attended',
  'no_show',
] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const SEAT_END_REASONS = [
  'left',
  'removed_by_organiser',
  'removed_by_staff',
  'match_ended',
  'refilled',
  'banned',
  'account_deleted',
] as const;
export type SeatEndReason = (typeof SEAT_END_REASONS)[number];

export const REQUEST_STATUSES = ['pending', 'approved', 'declined', 'withdrawn', 'expired'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const TICKET_STATUSES = ['available', 'reserved', 'in_use', 'forfeited', 'cashed_out'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** What a seat's own ticket did, as `match_my_seats` reports it (NULL for a desk seat). */
export const SEAT_TICKET_STATUSES = ['available', 'in_use', 'forfeited'] as const;
export type SeatTicketStatus = (typeof SEAT_TICKET_STATUSES)[number];

export const MATCH_ROLES = ['organiser', 'player', 'requester', 'removed', 'viewer'] as const;
export type MatchRole = (typeof MATCH_ROLES)[number];

/** The four preset messages (§4.17), in the order the bar shows them. */
export const MESSAGE_CODES = ['on_my_way', 'running_late', 'cant_make_it', 'bring_balls'] as const;
export type MessageCode = (typeof MESSAGE_CODES)[number];

/** `match_reports.reason`, in the §1.3 order the report screen lists them. */
export const REPORT_REASONS = [
  'offensive_name',
  'abusive_behaviour',
  'harassment',
  'unsafe_play',
  'no_show',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The organiser's cancel reasons (§1.3), in the order the native choice offers them. */
export const ORGANISER_CANCEL_REASONS = ['not_enough_players', 'plans_changed', 'other'] as const;
export type OrganiserCancelReason = (typeof ORGANISER_CANCEL_REASONS)[number];

/** The three refusals a restricted link viewer gets (R32). */
export const RESTRICTED_REFUSALS = ['MATCH_BANNED', 'MATCH_GENDER_MISMATCH', 'MATCH_UNAVAILABLE'] as const;
export type RestrictedRefusal = (typeof RESTRICTED_REFUSALS)[number];

export type Gender = 'female' | 'male';
export type LeaveOutcome = 'release' | 'locked_until_refill' | 'none';

/** Seats in a match (OM-9): always four. */
export const SEATS_TOTAL = 4;
/** One guest takes at most three seats: the last is always for another player (OM-20). */
export const SEATS_MAX = 3;
/** The guest read windows are capped at 16 days (R27); the phone never asks for more. */
export const GUEST_WINDOW_DAYS = 16;
/** `venue_settings.match_fill_deadline_minutes` when a branch's row does not carry it (0257's default). */
export const DEFAULT_FILL_DEADLINE_MINUTES = 120;

// ── Parsing primitives ──────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const objOrNull = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const bool = (v: unknown): boolean => v === true;

/** An integer (count or IQD amount), whether jsonb sent a number or PostgREST a numeric string. */
function int(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

/** A category this build does not know reads as the open one: never a gendered form by accident. */
const categoryOf = (v: unknown): MatchCategory => oneOf(MATCH_CATEGORIES, v) ?? 'open';
const policyOf = (v: unknown): JoinPolicy => oneOf(JOIN_POLICIES, v) ?? 'open';
const genderOf = (v: unknown): Gender | null => (v === 'female' || v === 'male' ? v : null);

// ── app.match_slots (anon and authenticated; no ids, names or money) ────────

export interface SlotMatch {
  startAt: string;
  endAt: string;
  durationMin: number;
  category: MatchCategory;
  joinPolicy: JoinPolicy;
  seatsLeft: number;
  /** The caller is seated or asking (always false signed out). */
  mine: boolean;
}

export function parseMatchSlots(json: unknown): SlotMatch[] {
  const out: SlotMatch[] = [];
  for (const raw of arr(json)) {
    const o = obj(raw);
    const startAt = str(o.start_at);
    const endAt = str(o.end_at);
    if (!startAt || !endAt || !Number.isFinite(Date.parse(startAt))) continue;
    out.push({
      startAt,
      endAt,
      durationMin: int(o.duration_min) ?? 0,
      category: categoryOf(o.category),
      joinPolicy: policyOf(o.join_policy),
      seatsLeft: Math.max(0, int(o.seats_left) ?? 0),
      mine: bool(o.mine),
    });
  }
  return out;
}

/**
 * The Book tab's lookup (guest.md §4.11 rule 3): `match_slots` keyed by the
 * epoch ms of each start. Built once per data reference (it is the query's
 * `select`, a module-level function so TanStack keeps its result while the
 * data is unchanged), never an input of the day grid.
 */
export function slotMatchesByStart(slots: readonly SlotMatch[]): Map<number, SlotMatch[]> {
  const map = new Map<number, SlotMatch[]>();
  for (const s of slots) {
    const ms = Date.parse(s.startAt);
    if (!Number.isFinite(ms)) continue;
    const list = map.get(ms);
    if (list) list.push(s);
    else map.set(ms, [s]);
  }
  return map;
}

// ── app.open_matches (no names, D14) ────────────────────────────────────────

export interface OpenMatch {
  matchId: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  category: MatchCategory;
  joinPolicy: JoinPolicy;
  /** `filling`, or `booked` with a seat open before the start (`refill`). */
  status: MatchStatus | null;
  seatsTaken: number;
  seatsLeft: number;
  refill: boolean;
  fillDeadlineAt: string | null;
  /** The next open seat's share, paid at the desk. */
  shareIqd: number | null;
  mine: 'seated' | 'requested' | null;
}

export interface OpenMatches {
  /** A banned caller gets `true` and no rows (the list shows `matches.errors.banned`). */
  banned: boolean;
  matches: OpenMatch[];
}

export function parseOpenMatches(json: unknown): OpenMatches {
  const o = obj(json);
  const matches: OpenMatch[] = [];
  for (const raw of arr(o.matches)) {
    const m = obj(raw);
    const matchId = str(m.match_id);
    const startAt = str(m.start_at);
    if (!matchId || !startAt) continue;
    matches.push({
      matchId,
      startAt,
      endAt: str(m.end_at) ?? startAt,
      durationMin: int(m.duration_min) ?? 0,
      category: categoryOf(m.category),
      joinPolicy: policyOf(m.join_policy),
      status: oneOf(MATCH_STATUSES, m.status),
      seatsTaken: int(m.seats_taken) ?? 0,
      seatsLeft: Math.max(0, int(m.seats_left) ?? 0),
      refill: bool(m.refill),
      fillDeadlineAt: str(m.fill_deadline_at),
      shareIqd: int(m.share_iqd),
      mine: m.mine === 'seated' || m.mine === 'requested' ? m.mine : null,
    });
  }
  return { banned: bool(o.banned), matches };
}

// ── app.match_detail ────────────────────────────────────────────────────────

export interface SeatCan {
  remove: boolean;
  report: boolean;
  block: boolean;
}

/** One carrier seat as the players see it (§4.3): never a phone, never another player's id. */
export interface MatchSeat {
  seatId: string;
  seatNo: number;
  kind: SeatKind | null;
  status: SeatStatus | null;
  /** "First I."; a friend seat carries its HOLDER's name. Null for an open or unnamed seat. */
  name: string | null;
  /** The account behind it was deleted: "Former player". */
  former: boolean;
  /** A friend seat's holder's seat number. */
  holderSeatNo: number | null;
  /** The viewer's own account (or linked desk) seat. */
  isMe: boolean;
  /** Any seat the viewer holds, friends' included. */
  isMine: boolean;
  shareIqd: number | null;
  /** A late leaver's seat that a player can still take before the start. */
  open: boolean;
  can: SeatCan;
}

/** One of the viewer's own seats (`match_my_seats`), any status. */
export interface MySeat {
  seatId: string;
  seatNo: number;
  kind: SeatKind | null;
  status: SeatStatus | null;
  endReason: SeatEndReason | null;
  shareIqd: number | null;
  /** Set when the seat came from an approved request. */
  requestId: string | null;
  /** NULL for a desk seat, which holds no ticket. */
  ticketStatus: SeatTicketStatus | null;
}

export interface MyRequest {
  requestId: string;
  status: RequestStatus | null;
  seatsRequested: number;
  /** `my_matches` only. */
  decidedAt: string | null;
}

export interface MatchCan {
  join: boolean;
  request: boolean;
  withdraw: boolean;
  leave: boolean;
  cancel: boolean;
  remove: boolean;
  decide: boolean;
  message: boolean;
  report: boolean;
  block: boolean;
  share: boolean;
}

export interface MatchMe {
  role: MatchRole;
  seats: MySeat[];
  request: MyRequest | null;
  /** The organiser removed the viewer (OM-44): no rejoining this match. */
  excluded: boolean;
  /** The code a join or request would raise now; never NEED_TICKETS (D13). */
  refusal: string | null;
  ticketsAvailable: number;
  /** Tickets the viewer lacks for one seat. */
  ticketsNeeded: number;
  leaveOutcome: LeaveOutcome;
  can: MatchCan;
}

export interface MatchRequestRow {
  requestId: string;
  name: string | null;
  former: boolean;
  seatsRequested: number;
  friendGenders: (Gender | null)[];
  gamesPlayed: number;
  noShows: number;
  createdAt: string | null;
}

export interface MatchMessage {
  /** Null for a code this build does not know: the feed skips it. */
  code: MessageCode | null;
  seatNo: number | null;
  name: string | null;
  former: boolean;
  isMe: boolean;
  at: string | null;
}

export interface MatchOrganiser {
  name: string | null;
  former: boolean;
  isMe: boolean;
}

export interface MatchDetail {
  restricted: false;
  id: string;
  venueId: string | null;
  status: MatchStatus | null;
  endedReason: EndedReason | null;
  startAt: string;
  endAt: string;
  durationMin: number;
  category: MatchCategory;
  visibility: Visibility;
  joinPolicy: JoinPolicy;
  priceIqd: number | null;
  sharesIqd: number[];
  fillDeadlineAt: string | null;
  seatsTaken: number;
  seatsLeft: number;
  seatsTotal: number;
  /** The booked court (booked matches only). */
  courtId: string | null;
  organiser: MatchOrganiser | null;
  seats: MatchSeat[];
  me: MatchMe;
  /** The organiser's pending requests (OM-41). */
  requests: MatchRequestRow[];
  /** The last 20 preset messages, oldest first (participants only). */
  messages: MatchMessage[];
  /** The organiser's and seated players' invite token. */
  shareToken: string | null;
  serverNow: string | null;
}

/** A link viewer who may not join (banned, the other gender, a block either way; R32): no ids, no names. */
export interface MatchRestricted {
  restricted: true;
  status: MatchStatus | null;
  startAt: string;
  endAt: string;
  durationMin: number;
  category: MatchCategory;
  joinPolicy: JoinPolicy;
  seatsLeft: number;
  venue: { nameEn: string | null; nameAr: string | null } | null;
  timezone: string | null;
  refusal: RestrictedRefusal;
  serverNow: string | null;
}

export type MatchView = MatchDetail | MatchRestricted;

const NO_CAN: MatchCan = {
  join: false,
  request: false,
  withdraw: false,
  leave: false,
  cancel: false,
  remove: false,
  decide: false,
  message: false,
  report: false,
  block: false,
  share: false,
};

function parseMySeats(v: unknown): MySeat[] {
  const out: MySeat[] = [];
  for (const raw of arr(v)) {
    const s = obj(raw);
    const seatId = str(s.seat_id);
    if (!seatId) continue;
    out.push({
      seatId,
      seatNo: int(s.seat_no) ?? 0,
      kind: oneOf(SEAT_KINDS, s.kind),
      status: oneOf(SEAT_STATUSES, s.status),
      endReason: oneOf(SEAT_END_REASONS, s.end_reason),
      shareIqd: int(s.share_iqd),
      requestId: str(s.request_id),
      ticketStatus: oneOf(SEAT_TICKET_STATUSES, s.ticket_status),
    });
  }
  return out;
}

function parseRequest(v: unknown): MyRequest | null {
  const r = objOrNull(v);
  const requestId = r ? str(r.request_id) : null;
  if (!r || !requestId) return null;
  return {
    requestId,
    status: oneOf(REQUEST_STATUSES, r.status),
    seatsRequested: Math.max(1, int(r.seats_requested) ?? 1),
    decidedAt: str(r.decided_at),
  };
}

function parseSeat(v: unknown): MatchSeat | null {
  const s = obj(v);
  const seatId = str(s.seat_id);
  if (!seatId) return null;
  const can = obj(s.can);
  return {
    seatId,
    seatNo: int(s.seat_no) ?? 0,
    kind: oneOf(SEAT_KINDS, s.kind),
    status: oneOf(SEAT_STATUSES, s.status),
    name: str(s.name),
    former: bool(s.former),
    holderSeatNo: int(s.holder_seat_no),
    isMe: bool(s.is_me),
    isMine: bool(s.is_mine),
    shareIqd: int(s.share_iqd),
    open: bool(s.open),
    can: { remove: bool(can.remove), report: bool(can.report), block: bool(can.block) },
  };
}

function parseCan(v: unknown): MatchCan {
  const c = obj(v);
  const out = { ...NO_CAN };
  for (const k of Object.keys(NO_CAN) as (keyof MatchCan)[]) out[k] = bool(c[k]);
  return out;
}

/**
 * app.match_detail, either shape. Throws only when there is no match to show
 * at all (no id on a full answer), which the screen treats as a failed read.
 */
export function parseMatchView(json: unknown): MatchView {
  const o = obj(json);
  if (o.restricted === true) {
    const venue = objOrNull(o.venue);
    const me = obj(o.me);
    return {
      restricted: true,
      status: oneOf(MATCH_STATUSES, o.status),
      startAt: str(o.start_at) ?? '',
      endAt: str(o.end_at) ?? '',
      durationMin: int(o.duration_min) ?? 0,
      category: categoryOf(o.category),
      joinPolicy: policyOf(o.join_policy),
      seatsLeft: Math.max(0, int(o.seats_left) ?? 0),
      venue: venue ? { nameEn: str(venue.name_en), nameAr: str(venue.name_ar) } : null,
      timezone: str(o.timezone),
      // An unknown refusal reads as the neutral one: it names no reason.
      refusal: oneOf(RESTRICTED_REFUSALS, me.refusal) ?? 'MATCH_UNAVAILABLE',
      serverNow: str(o.server_now),
    };
  }
  const id = str(o.id);
  const startAt = str(o.start_at);
  if (!id || !startAt) throw new Error('MALFORMED_MATCH_DETAIL');
  const me = obj(o.me);
  const org = objOrNull(o.organiser);
  const seats = arr(o.seats)
    .map(parseSeat)
    .filter((s): s is MatchSeat => s !== null)
    .sort((a, b) => a.seatNo - b.seatNo);
  const requests: MatchRequestRow[] = [];
  for (const raw of arr(o.requests)) {
    const r = obj(raw);
    const requestId = str(r.request_id);
    if (!requestId) continue;
    requests.push({
      requestId,
      name: str(r.name),
      former: bool(r.former),
      seatsRequested: Math.max(1, int(r.seats_requested) ?? 1),
      friendGenders: arr(r.friend_genders).map(genderOf),
      gamesPlayed: Math.max(0, int(r.games_played) ?? 0),
      noShows: Math.max(0, int(r.no_shows) ?? 0),
      createdAt: str(r.created_at),
    });
  }
  const messages: MatchMessage[] = arr(o.messages).map((raw) => {
    const m = obj(raw);
    return {
      code: oneOf(MESSAGE_CODES, m.code),
      seatNo: int(m.seat_no),
      name: str(m.name),
      former: bool(m.former),
      isMe: bool(m.is_me),
      at: str(m.at),
    };
  });
  const leave = me.leave_outcome;
  return {
    restricted: false,
    id,
    venueId: str(o.venue_id),
    status: oneOf(MATCH_STATUSES, o.status),
    endedReason: oneOf(ENDED_REASONS, o.ended_reason),
    startAt,
    endAt: str(o.end_at) ?? startAt,
    durationMin: int(o.duration_min) ?? 0,
    category: categoryOf(o.category),
    visibility: oneOf(VISIBILITIES, o.visibility) ?? 'public',
    joinPolicy: policyOf(o.join_policy),
    priceIqd: int(o.price_iqd),
    sharesIqd: arr(o.shares_iqd).map((v) => int(v) ?? 0),
    fillDeadlineAt: str(o.fill_deadline_at),
    seatsTaken: int(o.seats_taken) ?? 0,
    seatsLeft: Math.max(0, int(o.seats_left) ?? 0),
    seatsTotal: int(o.seats_total) ?? SEATS_TOTAL,
    courtId: str(o.court_id),
    organiser: org ? { name: str(org.name), former: bool(org.former), isMe: bool(org.is_me) } : null,
    seats,
    me: {
      role: oneOf(MATCH_ROLES, me.role) ?? 'viewer',
      seats: parseMySeats(me.seats),
      request: parseRequest(me.request),
      excluded: bool(me.excluded),
      refusal: str(me.refusal),
      ticketsAvailable: Math.max(0, int(me.tickets_available) ?? 0),
      ticketsNeeded: Math.max(0, int(me.tickets_needed) ?? 0),
      leaveOutcome: leave === 'release' || leave === 'locked_until_refill' ? leave : 'none',
      can: parseCan(me.can),
    },
    requests,
    messages,
    shareToken: str(o.share_token),
    serverNow: str(o.server_now),
  };
}

// ── app.my_matches ──────────────────────────────────────────────────────────

export interface MyMatchRow {
  matchId: string;
  venueId: string | null;
  status: MatchStatus | null;
  endedReason: EndedReason | null;
  startAt: string;
  endAt: string;
  durationMin: number;
  category: MatchCategory;
  joinPolicy: JoinPolicy;
  visibility: Visibility;
  seatsTaken: number;
  courtId: string | null;
  fillDeadlineAt: string | null;
  isOrganiser: boolean;
  myRole: MatchRole;
  mySeats: MySeat[];
  request: MyRequest | null;
  myTickets: { locked: number; released: number; forfeited: number };
}

export function parseMyMatches(json: unknown): MyMatchRow[] {
  const out: MyMatchRow[] = [];
  for (const raw of arr(json)) {
    const o = obj(raw);
    const matchId = str(o.match_id);
    const startAt = str(o.start_at);
    if (!matchId || !startAt) continue;
    const t = obj(o.my_tickets);
    out.push({
      matchId,
      venueId: str(o.venue_id),
      status: oneOf(MATCH_STATUSES, o.status),
      endedReason: oneOf(ENDED_REASONS, o.ended_reason),
      startAt,
      endAt: str(o.end_at) ?? startAt,
      durationMin: int(o.duration_min) ?? 0,
      category: categoryOf(o.category),
      joinPolicy: policyOf(o.join_policy),
      visibility: oneOf(VISIBILITIES, o.visibility) ?? 'public',
      seatsTaken: int(o.seats_taken) ?? 0,
      courtId: str(o.court_id),
      fillDeadlineAt: str(o.fill_deadline_at),
      isOrganiser: bool(o.is_organiser),
      myRole: oneOf(MATCH_ROLES, o.my_role) ?? 'player',
      mySeats: parseMySeats(o.my_seats),
      request: parseRequest(o.request),
      myTickets: {
        locked: Math.max(0, int(t.locked) ?? 0),
        released: Math.max(0, int(t.released) ?? 0),
        forfeited: Math.max(0, int(t.forfeited) ?? 0),
      },
    });
  }
  return out;
}

// ── app.my_match_blocks ─────────────────────────────────────────────────────

export interface MatchBlock {
  blockId: string;
  name: string | null;
  former: boolean;
  createdAt: string | null;
}

export function parseMatchBlocks(json: unknown): MatchBlock[] {
  const out: MatchBlock[] = [];
  for (const raw of arr(json)) {
    const o = obj(raw);
    const blockId = str(o.block_id);
    if (!blockId) continue;
    out.push({ blockId, name: str(o.name), former: bool(o.former), createdAt: str(o.created_at) });
  }
  return out;
}

// ── app.match_quote ─────────────────────────────────────────────────────────

export interface MatchQuote {
  enabled: boolean;
  /** Null on NO_RATE. */
  priceIqd: number | null;
  sharesIqd: number[] | null;
  durationMin: number;
  fillDeadlineAt: string | null;
  earliestStartAt: string | null;
  /** The categories the caller may start (DF-10: all three while the gender is unset). */
  categories: MatchCategory[];
  myGender: Gender | null;
  ticketsAvailable: number;
  ticketPriceIqd: number | null;
  seatsMax: number;
  fillingAtTime: number;
  courtsFree: number;
  /** The first refusal a start would raise now; never GENDER_REQUIRED or NEED_TICKETS. */
  refusal: string | null;
}

export function parseMatchQuote(json: unknown): MatchQuote {
  const o = obj(json);
  const categories = arr(o.categories)
    .map((c) => oneOf(MATCH_CATEGORIES, c))
    .filter((c): c is MatchCategory => c !== null);
  const shares = Array.isArray(o.shares_iqd) ? o.shares_iqd.map((v) => int(v) ?? 0) : null;
  return {
    enabled: bool(o.enabled),
    priceIqd: int(o.price_iqd),
    sharesIqd: shares,
    durationMin: int(o.duration_min) ?? 0,
    fillDeadlineAt: str(o.fill_deadline_at),
    earliestStartAt: str(o.earliest_start_at),
    categories: categories.length > 0 ? categories : ['open'],
    myGender: genderOf(o.my_gender),
    ticketsAvailable: Math.max(0, int(o.tickets_available) ?? 0),
    ticketPriceIqd: int(o.ticket_price_iqd),
    seatsMax: Math.min(SEATS_MAX, Math.max(1, int(o.seats_max) ?? SEATS_MAX)),
    fillingAtTime: Math.max(0, int(o.filling_at_time) ?? 0),
    courtsFree: Math.max(0, int(o.courts_free) ?? 0),
    refusal: str(o.refusal),
  };
}

// ── app.match_invite (anon and authenticated; DF-9) ─────────────────────────

export type MatchInvite =
  | { status: 'closed' }
  | {
      status: 'open' | 'full';
      startAt: string;
      endAt: string;
      timezone: string | null;
      category: MatchCategory;
      joinPolicy: JoinPolicy;
      seatsLeft: number;
      venue: { nameEn: string | null; nameAr: string | null };
    };

/** Every miss, and anything this build cannot read, is `closed` (the RPC is no oracle either). */
export function parseMatchInvite(json: unknown): MatchInvite {
  const o = obj(json);
  const startAt = str(o.start_at);
  if ((o.status !== 'open' && o.status !== 'full') || !startAt) return { status: 'closed' };
  const venue = obj(o.venue);
  return {
    status: o.status,
    startAt,
    endAt: str(o.end_at) ?? startAt,
    timezone: str(o.timezone),
    category: categoryOf(o.category),
    joinPolicy: policyOf(o.join_policy),
    seatsLeft: Math.max(0, int(o.seats_left) ?? 0),
    venue: { nameEn: str(venue.name_en), nameAr: str(venue.name_ar) },
  };
}

// ── app.my_tickets (money.md §5.7 + guest.md §4.3) ──────────────────────────

export interface WalletTicket {
  id: string;
  status: TicketStatus | null;
  priceIqd: number | null;
  sandbox: boolean;
  boughtAt: string | null;
  purchasePaymentId: string | null;
  /** The request's (reserved), the seat's (in_use) or the forfeiting seat's (forfeited) match. */
  match: { matchId: string; startAt: string | null; venueId: string | null; status: MatchStatus | null } | null;
  forfeitedAt: string | null;
  cashedOutAt: string | null;
}

export interface TicketPurchase {
  requestId: string;
  status: string | null;
  ticketCount: number;
  unitPriceIqd: number | null;
  amountIqd: number | null;
  boughtAt: string | null;
  refundReason: string | null;
  refundAmountIqd: number | null;
  refundedAt: string | null;
}

export interface PendingPurchase {
  requestId: string;
  status: string | null;
  ticketCount: number;
  amountIqd: number | null;
  formUrl: string | null;
  deadlineAt: string | null;
}

export interface TicketWallet {
  /** Today's ticket price. */
  priceIqd: number | null;
  /** Money's wallet cap (MD-6): available tickets never exceed it. */
  maxAvailable: number;
  available: number;
  reserved: number;
  inUse: number;
  /** The profile's `payment_sandbox`: "Test tickets". */
  sandbox: boolean;
  /** Live tickets first, then the last 50 ended ones. */
  tickets: WalletTicket[];
  purchases: TicketPurchase[];
  /** A purchase in progress (rules review §4.1 item 9). */
  pending: PendingPurchase | null;
  serverNow: string | null;
}

export function parseTicketWallet(json: unknown): TicketWallet {
  const o = obj(json);
  const tickets: WalletTicket[] = [];
  for (const raw of arr(o.tickets)) {
    const k = obj(raw);
    const id = str(k.id);
    if (!id) continue;
    const m = objOrNull(k.match);
    const matchId = m ? str(m.match_id) : null;
    tickets.push({
      id,
      status: oneOf(TICKET_STATUSES, k.status),
      priceIqd: int(k.price_iqd),
      sandbox: bool(k.sandbox),
      boughtAt: str(k.bought_at),
      purchasePaymentId: str(k.purchase_payment_id),
      match:
        m && matchId
          ? {
              matchId,
              startAt: str(m.start_at),
              venueId: str(m.venue_id),
              status: oneOf(MATCH_STATUSES, m.status),
            }
          : null,
      forfeitedAt: str(k.forfeited_at),
      cashedOutAt: str(k.cashed_out_at),
    });
  }
  const purchases: TicketPurchase[] = [];
  for (const raw of arr(o.purchases)) {
    const p = obj(raw);
    const requestId = str(p.request_id);
    if (!requestId) continue;
    purchases.push({
      requestId,
      status: str(p.status),
      ticketCount: Math.max(0, int(p.ticket_count) ?? 0),
      unitPriceIqd: int(p.unit_price_iqd),
      amountIqd: int(p.amount_iqd),
      boughtAt: str(p.bought_at),
      refundReason: str(p.refund_reason),
      refundAmountIqd: int(p.refund_amount_iqd),
      refundedAt: str(p.refunded_at),
    });
  }
  const pend = objOrNull(o.pending);
  const pendingId = pend ? str(pend.request_id) : null;
  return {
    priceIqd: int(o.price_iqd),
    maxAvailable: Math.max(0, int(o.max_available) ?? 0),
    available: Math.max(0, int(o.available) ?? 0),
    reserved: Math.max(0, int(o.reserved) ?? 0),
    inUse: Math.max(0, int(o.in_use) ?? 0),
    sandbox: bool(o.sandbox),
    tickets,
    purchases,
    pending:
      pend && pendingId
        ? {
            requestId: pendingId,
            status: str(pend.status),
            ticketCount: Math.max(0, int(pend.ticket_count) ?? 0),
            amountIqd: int(pend.amount_iqd),
            formUrl: str(pend.form_url),
            deadlineAt: str(pend.deadline_at),
          }
        : null,
    serverNow: str(o.server_now),
  };
}

/** One purchase is 1..3 tickets (`TICKET_COUNT_INVALID` otherwise). */
export const MAX_TICKETS_PER_PURCHASE = 3;

/**
 * The counts the buy stepper offers (§4.10.1): 1..3, and no more than the
 * wallet cap leaves room for (`max_available − available`). Empty means the
 * wallet is full: the screen shows `matches.errors.walletLimit` in place of
 * the buy card. The server still decides (`TICKET_COUNT_INVALID` detail
 * `wallet_limit`).
 */
export function buyCounts(wallet: Pick<TicketWallet, 'maxAvailable' | 'available'>): number[] {
  const room = Math.min(MAX_TICKETS_PER_PURCHASE, wallet.maxAvailable - wallet.available);
  const out: number[] = [];
  for (let n = 1; n <= room; n++) out.push(n);
  return out;
}

/**
 * How many tickets to buy before an action that needs `seats` of them
 * (§4.10.3): 0 when the wallet already covers it, otherwise the shortfall
 * clamped to 1..3 (one purchase).
 */
export function missingTickets(available: number, seats: number): number {
  const short = Math.max(0, seats) - Math.max(0, available);
  if (short <= 0) return 0;
  return Math.min(MAX_TICKETS_PER_PURCHASE, short);
}

// ── Write results (§4.3: the phone reads these and refetches the rest) ──────

export interface StartResult {
  matchId: string;
  /** R24: a replay of the same key answers the first match. */
  duplicate: boolean;
  shareToken: string | null;
}

export function parseStartResult(json: unknown): StartResult {
  const o = obj(json);
  const matchId = str(o.match_id);
  if (!matchId) throw new Error('MALFORMED_MATCH_START');
  return { matchId, duplicate: bool(o.duplicate), shareToken: str(o.share_token) };
}

export interface JoinResult {
  matchId: string;
  matchStatus: MatchStatus | null;
  duplicate: boolean;
}

export function parseJoinResult(json: unknown, fallbackMatchId: string): JoinResult {
  const o = obj(json);
  return {
    matchId: str(o.match_id) ?? fallbackMatchId,
    matchStatus: oneOf(MATCH_STATUSES, o.match_status),
    duplicate: bool(o.duplicate),
  };
}

export interface RequestResult {
  requestId: string | null;
  duplicate: boolean;
}

export function parseRequestResult(json: unknown): RequestResult {
  const o = obj(json);
  return { requestId: str(o.request_id), duplicate: bool(o.duplicate) };
}

/** Every other write answers `{…, duplicate}`; the phone only needs to know it landed. */
export function parseDuplicate(json: unknown): { duplicate: boolean } {
  return { duplicate: bool(obj(json).duplicate) };
}

// ── The edge `ticket-begin` (§4.3) ──────────────────────────────────────────

export interface TicketBegin {
  /** The attempt's request_id: what `deposit-status` and the pointer follow. */
  ref: string;
  formUrl: string;
  amountIqd: number | null;
  ticketCount: number;
  unitPriceIqd: number | null;
  deadlineAt: string | null;
  /** A live attempt answered again (a double tap, or the app coming back). */
  reused: boolean;
}

export function parseTicketBegin(json: unknown): TicketBegin {
  const o = obj(json);
  const ref = str(o.request_id);
  const formUrl = str(o.form_url);
  if (!ref || !formUrl) throw new Error('MALFORMED_TICKET_BEGIN');
  return {
    ref,
    formUrl,
    amountIqd: int(o.amount_iqd),
    ticketCount: Math.max(0, int(o.ticket_count) ?? 0),
    unitPriceIqd: int(o.unit_price_iqd),
    deadlineAt: str(o.deadline_at),
    reused: bool(o.reused),
  };
}

// ── Friends (OM-20, OM-39) ──────────────────────────────────────────────────

/** One `p_friends` element. */
export interface FriendSeat {
  gender: Gender | null;
}

/**
 * `p_friends` for `seats` seats in a match of `category` (§4.13 item 7): one
 * element per friend (seats − 1, at most two). A women's or men's match
 * declares its own gender for every friend (the guest's switch, OM-39); an
 * open match sends null.
 */
export function friendsFor(category: MatchCategory, seats: number): FriendSeat[] {
  const n = Math.max(0, Math.min(SEATS_MAX, seats) - 1);
  const gender: Gender | null = category === 'women' ? 'female' : category === 'men' ? 'male' : null;
  return Array.from({ length: n }, () => ({ gender }));
}

/** A gendered match with friends needs the friends-gender switch on before the call (OM-39). */
export function needsFriendsDeclaration(category: MatchCategory, seats: number): boolean {
  return category !== 'open' && seats > 1;
}

// ── How the phone prints a player (§4.9) ────────────────────────────────────

/**
 * The feminine twin of a third-person key in a `women` match (§4.24 rule 1):
 * `byCategory('women', 'matches.common.player')` is `'matches.common.playerF'`.
 * Both spellings must be catalog keys (the call site's `t()` checks the union);
 * a counted key works the same way with `countPhrase`.
 */
export function byCategory<K extends string>(
  category: MatchCategory | null | undefined,
  key: K,
): K | `${K}F` {
  return category === 'women' ? (`${key}F` as `${K}F`) : key;
}

type T = (key: MessageKey, params?: TParams) => string;

type SeatLike = Pick<MatchSeat, 'seatId' | 'seatNo' | 'kind' | 'name' | 'former' | 'holderSeatNo' | 'open'>;

/**
 * Which "+k" a friend seat is (§4.9): its holder's friend seats numbered in
 * `seat_no` order, 1-based. Seats that name no holder count as their own group.
 */
export function friendIndexOf(seat: SeatLike, seats: readonly SeatLike[]): number {
  const group = seats
    .filter((s) => s.kind === 'friend' && s.holderSeatNo === seat.holderSeatNo)
    .sort((a, b) => a.seatNo - b.seatNo);
  const i = group.findIndex((s) => s.seatId === seat.seatId);
  return i >= 0 ? i + 1 : 1;
}

/**
 * One seat as the grid prints it (§4.9, §4.14):
 *  - a late leaver's seat still open before the start → "Open seat · taking a player";
 *  - a deleted account → "Former player" (feminine in a women's match);
 *  - no name → "Player";
 *  - a friend seat → "Ahmed K. +1", the name isolated and "+1" LTR-isolated so
 *    it never flips to "1+" in Arabic (GD-9);
 *  - otherwise the isolated name.
 * `seats` is the whole grid, for the friend's number; without it a friend is "+1".
 */
export function displaySeat(
  seat: SeatLike,
  category: MatchCategory | null | undefined,
  t: T,
  seats?: readonly SeatLike[],
): string {
  if (seat.open) return t(byCategory(category, 'matches.common.openSeatTaking'));
  if (seat.former) return t(byCategory(category, 'matches.common.formerPlayer'));
  if (!seat.name) return t(byCategory(category, 'matches.common.player'));
  if (seat.kind === 'friend') {
    const k = seats ? friendIndexOf(seat, seats) : 1;
    return t('matches.common.friendSeat', { name: isolate(seat.name), extra: isolateLtr(`+${k}`) });
  }
  return isolate(seat.name);
}

/** A name line from a request, a message or the organiser: former, unnamed or the isolated name. */
export function displayName(
  who: { name: string | null; former: boolean },
  category: MatchCategory | null | undefined,
  t: T,
): string {
  if (who.former) return t(byCategory(category, 'matches.common.formerPlayer'));
  if (!who.name) return t(byCategory(category, 'matches.common.player'));
  return isolate(who.name);
}

/**
 * "3/4", LTR-isolated as ONE unit (§4.24 bidi, R38). Isolating each number
 * alone leaves the slash to the paragraph's direction, and an Arabic line then
 * shows "4/3".
 */
export function seatsOfLabel(taken: number, t: T, total = SEATS_TOTAL): string {
  return isolateLtr(t('matches.common.seatsOf', { taken: String(taken), total: String(total) }));
}

/** The category pill's words. */
export function categoryKey(category: MatchCategory): MessageKey {
  switch (category) {
    case 'women':
      return 'matches.common.categoryWomen';
    case 'men':
      return 'matches.common.categoryMen';
    default:
      return 'matches.common.categoryOpen';
  }
}

// ── Windows and trading nights ──────────────────────────────────────────────

/**
 * The guest read window (§4.11 rule 3, R27): from the start of today,
 * venue-local, to 16 days on. It covers the Book tab's whole strip (today +
 * 14, and today+14's trading night) and keeps the query key stable for a day.
 */
export function guestWindow(now: Date, tz: string): { from: string; to: string } {
  const start = wallTimeToUtc(localParts(now, tz).date, 0, tz);
  const end = new Date(start.getTime() + GUEST_WINDOW_DAYS * 86_400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * The window of one start minute (§4.11): `match_slots` has no ids, so a
 * signed-in tap on a chip reads `open_matches` for `[startAt, startAt + 1 min)`
 * to learn which match it was.
 */
export function minuteWindow(startAt: string | Date): { from: string; to: string } {
  const ms = typeof startAt === 'string' ? Date.parse(startAt) : startAt.getTime();
  return { from: new Date(ms).toISOString(), to: new Date(ms + 60_000).toISOString() };
}

/**
 * The trading night a match belongs to (§4.12), 'YYYY-MM-DD': its own local
 * date, or the day before when it starts inside that day's post-midnight tail
 * (a 00:30 match on a branch open until 02:00 is last night's).
 */
export function tradingNightOf(
  startAt: string | Date,
  settings: { timezone?: string | null; opening_hours?: unknown },
): string {
  const tz = settings.timezone ?? 'Asia/Baghdad';
  const at = localParts(typeof startAt === 'string' ? new Date(startAt) : startAt, tz);
  const key = DAY_KEYS[at.dayOfWeek];
  const hours = (settings.opening_hours ?? null) as OpeningHours | null;
  const tail = key ? (hours?.[key] ?? []).find(isOvernightTail) : undefined;
  if (tail !== undefined && at.minutesOfDay < parseHHMM(tail[1])) return shiftDate(at.date, -1);
  return at.date;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const out = new Date(Date.UTC(y!, m! - 1, d!) + n * 86_400_000);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${out.getUTCFullYear()}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())}`;
}

// ── The Book tab (§4.11) ────────────────────────────────────────────────────

/** The two branch knobs the phone reads from `venue_settings_public` (0257). */
export interface MatchBranchSettings {
  matches_enabled?: boolean | null;
  match_fill_deadline_minutes?: number | null;
}

/** The branch has open matches switched on (rule 1: off means no work at all). */
export function matchesEnabled(settings: MatchBranchSettings | null | undefined): boolean {
  return settings?.matches_enabled === true;
}

/**
 * "Start an open match" is offered (OM-43 hint): the switch is on and the
 * start is at least the fill deadline plus an hour away. The server's
 * `MATCH_TOO_LATE` decides.
 */
export function canStartAt(
  settings: MatchBranchSettings | null | undefined,
  startAt: Date,
  now: Date,
): boolean {
  if (!matchesEnabled(settings)) return false;
  const deadline = settings?.match_fill_deadline_minutes ?? DEFAULT_FILL_DEADLINE_MINUTES;
  return startAt.getTime() - now.getTime() >= (deadline + 60) * 60_000;
}

export type SlotAction = 'view-mine' | 'join' | 'book' | 'start';

/**
 * The choice sheet's buttons, in order (§4.11): `view-mine` when a match at
 * that minute is the guest's, else `join` when one has a seat; then `book`;
 * then `start` when starting is allowed and fewer matches fill at that minute
 * than courts are free (an OM-42 hint; `MATCH_SLOT_FULL` decides). At most
 * three, so Android's `Alert` can carry them. `['book']` alone means no sheet.
 */
export function slotActions(args: {
  slotMatches: readonly Pick<SlotMatch, 'mine' | 'seatsLeft'>[];
  canStart: boolean;
  freeCourts: number;
}): SlotAction[] {
  const out: SlotAction[] = [];
  if (args.slotMatches.some((m) => m.mine)) out.push('view-mine');
  else if (args.slotMatches.some((m) => m.seatsLeft > 0)) out.push('join');
  out.push('book');
  if (args.canStart && args.slotMatches.length < args.freeCourts) out.push('start');
  return out;
}

/** A lane as the Book tab builds it: a court and its cells (features/availability). */
export interface ChipLane {
  courtId: string;
  cells: readonly { startAt: Date; state: string }[];
}

/** The key of one lane cell: `${courtId}|${epochMs}`. */
export const chipKey = (courtId: string, startMs: number): string => `${courtId}|${startMs}`;

/**
 * Where the chips go (§4.11 rule 5, GD-6): one per time, on the FIRST lane
 * whose cell at that minute is free, so two courts never read as two matches.
 * A time with no free cell carries no chip.
 */
export function chipCellKeys(
  lanes: readonly ChipLane[],
  byStart: ReadonlyMap<number, readonly unknown[]>,
): Set<string> {
  const out = new Set<string>();
  for (const ms of byStart.keys()) {
    for (const lane of lanes) {
      const cell = lane.cells.find((c) => c.startAt.getTime() === ms);
      if (cell && cell.state === 'free') {
        out.add(chipKey(lane.courtId, ms));
        break;
      }
    }
  }
  return out;
}

/** How many lanes have a free cell at that minute (`slotActions`' `freeCourts`). */
export function freeCourtsAt(lanes: readonly ChipLane[], startMs: number): number {
  let n = 0;
  for (const lane of lanes) {
    if (lane.cells.some((c) => c.startAt.getTime() === startMs && c.state === 'free')) n++;
  }
  return n;
}

/** The one start intent `matchIntentKey` memoises (§4.23). */
export function matchStartIntent(args: {
  venueId: string;
  courtId: string;
  startAt: string;
  durationMin: number;
}): string {
  return `start:${args.venueId}|${args.courtId}|${args.startAt}|${args.durationMin}`;
}

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
