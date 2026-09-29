/**
 * The open-match reads the desk consumes, typed and parsed defensively
 * (docs/design/open-matches/operator.md §5.6, R31). Pure; no React.
 *
 * The `reportPayloads.ts` style: a missing or mistyped key is null (a figure
 * the screen prints as "—"), an empty list, or false for a `can` flag, never
 * a made-up zero and never a throw. The server builds every figure; nothing
 * here computes money.
 */
import type { CustomerFlag } from '../desk/deskTypes';

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null;
}
function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj).filter((r): r is Raw => r !== null) : [];
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // bigint columns come back as JSON numbers, but a numeric may arrive as text.
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
/** A `can` flag or a server boolean: only a real `true` is true. */
function flag(v: unknown): boolean {
  return v === true;
}
function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function nums(v: unknown): number[] {
  return Array.isArray(v) ? v.map(num).filter((x): x is number => x !== null) : [];
}
function flags(v: unknown): CustomerFlag[] {
  return list(v).flatMap((f) => {
    const type = str(f.type);
    return type ? [{ type, label: str(f.label) }] : [];
  });
}

// ---------------------------------------------------------------------------
// app.desk_open_matches(p_from, p_to) → envelope (§5.6.1)
// ---------------------------------------------------------------------------

export interface MatchPerson {
  customer_id: string | null;
  full_name: string | null;
  phone: string | null;
}

export interface OpenMatch {
  match_id: string;
  venue_id: string | null;
  /** `filling`, `awaiting_court`, or `booked` with an open seat number. */
  status: string;
  start_at: string;
  end_at: string;
  duration_min: number | null;
  category: string;
  join_policy: string;
  visibility: string;
  seats_taken: number | null;
  seats_left: number | null;
  requests_pending: number | null;
  fill_deadline_at: string | null;
  organised_by: string | null;
  organiser: MatchPerson | null;
  price_iqd: number | null;
  shares_iqd: number[];
  /** Courts offering this length with no firm row over its time (the bump mirror reads 1). */
  courts_free_firm: number | null;
  courts_total: number | null;
}

export interface OpenMatches {
  matches_enabled: boolean;
  fill_deadline_minutes: number | null;
  /** fill deadline + 60 (OM-43): the Start dialog's earliest start is server_now + this. */
  earliest_start_minutes: number | null;
  ticket_price_iqd: number | null;
  server_now: string | null;
  matches: OpenMatch[];
}

function person(v: unknown): MatchPerson | null {
  const p = obj(v);
  if (!p) return null;
  return { customer_id: str(p.customer_id), full_name: str(p.full_name), phone: str(p.phone) };
}

export function readOpenMatch(r: Raw): OpenMatch | null {
  const id = str(r.match_id);
  const start = str(r.start_at);
  const end = str(r.end_at);
  if (!id || !start || !end) return null;
  return {
    match_id: id,
    venue_id: str(r.venue_id),
    status: str(r.status) ?? '',
    start_at: start,
    end_at: end,
    duration_min: num(r.duration_min),
    category: str(r.category) ?? 'open',
    join_policy: str(r.join_policy) ?? 'open',
    visibility: str(r.visibility) ?? 'public',
    seats_taken: num(r.seats_taken),
    seats_left: num(r.seats_left),
    requests_pending: num(r.requests_pending),
    fill_deadline_at: str(r.fill_deadline_at),
    organised_by: str(r.organised_by),
    organiser: person(r.organiser),
    price_iqd: num(r.price_iqd),
    shares_iqd: nums(r.shares_iqd),
    courts_free_firm: num(r.courts_free_firm),
    courts_total: num(r.courts_total),
  };
}

export function readOpenMatches(raw: unknown): OpenMatches {
  const r = obj(raw) ?? {};
  return {
    matches_enabled: flag(r.matches_enabled),
    fill_deadline_minutes: num(r.fill_deadline_minutes),
    earliest_start_minutes: num(r.earliest_start_minutes),
    ticket_price_iqd: num(r.ticket_price_iqd),
    server_now: str(r.server_now),
    matches: list(r.matches)
      .map(readOpenMatch)
      .filter((m): m is OpenMatch => m !== null),
  };
}

// ---------------------------------------------------------------------------
// app.desk_match_states(p_reservation_ids) → object keyed by reservation id (§5.6.2)
// ---------------------------------------------------------------------------

export interface MatchState {
  reservation_id: string;
  match_id: string;
  status: string;
  category: string;
  /** The organiser's full name, else the first desk seat's typed name, else null ("Open match"). */
  label: string | null;
  organiser_customer_id: string | null;
  seats_in: number | null;
  seats_attended: number | null;
  seats_no_show: number | null;
  seats_unmarked: number | null;
  seats_left_late: number | null;
  open_seats: number | null;
}

/** Keyed by reservation id; a row without a match id is dropped. */
export function readMatchStates(raw: unknown): Record<string, MatchState> {
  const r = obj(raw);
  const out: Record<string, MatchState> = {};
  if (!r) return out;
  for (const [reservationId, v] of Object.entries(r)) {
    const s = obj(v);
    const matchId = s && str(s.match_id);
    if (!s || !matchId) continue;
    out[reservationId] = {
      reservation_id: reservationId,
      match_id: matchId,
      status: str(s.status) ?? '',
      category: str(s.category) ?? 'open',
      label: str(s.label),
      organiser_customer_id: str(s.organiser_customer_id),
      seats_in: num(s.seats_in),
      seats_attended: num(s.seats_attended),
      seats_no_show: num(s.seats_no_show),
      seats_unmarked: num(s.seats_unmarked),
      seats_left_late: num(s.seats_left_late),
      open_seats: num(s.open_seats),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// app.desk_match_detail(p_match_id) (§5.6.3; rules §5 D20)
// ---------------------------------------------------------------------------

export interface MatchCan {
  add_seat: boolean;
  cancel: boolean;
  call_off: boolean;
}

export interface MatchInfo {
  id: string;
  venue_id: string | null;
  status: string;
  ended_reason: string | null;
  start_at: string;
  end_at: string;
  duration_min: number | null;
  category: string;
  join_policy: string;
  visibility: string;
  price_iqd: number | null;
  shares_iqd: number[];
  fill_deadline_at: string | null;
  share_token: string | null;
  organised_by: string | null;
  organiser_seat_id: string | null;
  organiser: (MatchPerson & { flags: CustomerFlag[] }) | null;
  reservation_id: string | null;
  reservation_status: string | null;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
  sandbox: boolean;
  courts_free_firm: number | null;
  courts_total: number | null;
  /** The server's answer to "has the game started", at server_now. */
  started: boolean;
  /** The day of the game is open, so marks can still change (R13, R16). */
  marks_open: boolean;
  server_now: string | null;
  can: MatchCan;
}

export interface SeatMoney {
  share_iqd: number | null;
  paid_desk_iqd: number | null;
  credit_iqd: number | null;
  owed_iqd: number | null;
  written_off_iqd: number | null;
  /** null, or why the share is written off: `manual`, `no_show`, `left_late`, `vacant`. */
  write_off: string | null;
  open_iqd: number | null;
  /** What Take share collects: the owed amount, or a manual write-off (MD-11). */
  take_iqd: number | null;
}

export interface SeatCan {
  mark_attended: boolean;
  mark_no_show: boolean;
  unmark: boolean;
  /** The desk remove reasons the caller may use now (§5.13.8). */
  remove_reasons: string[];
  take_share: boolean;
  write_off: boolean;
  replace: boolean;
}

export interface MatchSeat {
  seat_id: string;
  seat_no: number;
  /** `account`, `friend`, `desk`. */
  kind: string;
  /** `in`, `left`, `removed`, `cancelled`, `left_late`, `refilled`, `attended`, `no_show`. */
  status: string;
  end_reason: string | null;
  /** This seat carries its number now (R4, R21). */
  carrying: boolean;
  /** Account: the player; friend: the holder; desk: the linked customer or null. */
  customer_id: string | null;
  /** Own name when known; null for a friend seat and a nameless desk extra. */
  full_name: string | null;
  /** What players see ("Sara K.", "Former player"). */
  display_name: string | null;
  phone: string | null;
  holder_seat_id: string | null;
  holder_name: string | null;
  /** 1..2 for a friend seat or a nameless desk extra. */
  companion_no: number | null;
  gender: string | null;
  /** `guest`, `holder`, `desk` or null. */
  gender_source: string | null;
  vouched: boolean;
  flags: CustomerFlag[];
  is_organiser: boolean;
  joined_at: string | null;
  ended_at: string | null;
  marked_at: string | null;
  marked_by_name: string | null;
  replaces_seat_id: string | null;
  replaced_by_seat_id: string | null;
  /** null for desk seats. */
  ticket: { ticket_id: string | null; status: string | null } | null;
  write_off_reason: string | null;
  /** Money's seat row; null while filling. */
  money: SeatMoney | null;
  can: SeatCan;
}

export interface MatchRequest {
  request_id: string;
  customer_id: string | null;
  full_name: string | null;
  phone: string | null;
  flags: CustomerFlag[];
  seats_requested: number | null;
  friend_genders: string[];
  games_played: number | null;
  no_shows: number | null;
  created_at: string | null;
}

export interface UnassignedPayment {
  payment_id: string;
  tab_id: string | null;
  /** On a live court-only tab: Assign may also "Keep on the booking" (C22). */
  tab_live: boolean;
  method: string | null;
  amount_iqd: number | null;
  unassigned_iqd: number | null;
  created_at: string | null;
}

export interface MatchMoney {
  phase: string | null;
  price_iqd: number | null;
  booking_price_iqd: number | null;
  price_delta_iqd: number | null;
  paid_iqd: number | null;
  live_tab_paid_iqd: number | null;
  desk_paid_iqd: number | null;
  unassigned_iqd: number | null;
  delta_owed_iqd: number | null;
  owed_iqd: number | null;
  written_off_iqd: number | null;
  open_iqd: number | null;
  over_iqd: number | null;
  vacant: { seat_no: number; open_iqd: number | null; written_off_iqd: number | null }[];
  unassigned: UnassignedPayment[];
}

export interface MatchEvent {
  at: string | null;
  type: string;
  /** A staff or guest id, or null / 'system' for the automatic ones. */
  actor: string | null;
  actor_name: string | null;
  seat_no: number | null;
  code: string | null;
}

export interface MatchDetail {
  match: MatchInfo;
  seats: MatchSeat[];
  requests: MatchRequest[];
  /** null while the match has no reservation. */
  money: MatchMoney | null;
  /** The last 50, newest first. */
  events: MatchEvent[];
}

function readMatchInfo(m: Raw): MatchInfo | null {
  const id = str(m.id);
  const start = str(m.start_at);
  const end = str(m.end_at);
  if (!id || !start || !end) return null;
  const org = obj(m.organiser);
  const can = obj(m.can) ?? {};
  return {
    id,
    venue_id: str(m.venue_id),
    status: str(m.status) ?? '',
    ended_reason: str(m.ended_reason),
    start_at: start,
    end_at: end,
    duration_min: num(m.duration_min),
    category: str(m.category) ?? 'open',
    join_policy: str(m.join_policy) ?? 'open',
    visibility: str(m.visibility) ?? 'public',
    price_iqd: num(m.price_iqd),
    shares_iqd: nums(m.shares_iqd),
    fill_deadline_at: str(m.fill_deadline_at),
    share_token: str(m.share_token),
    organised_by: str(m.organised_by),
    organiser_seat_id: str(m.organiser_seat_id),
    organiser: org ? { ...(person(org) as MatchPerson), flags: flags(org.flags) } : null,
    reservation_id: str(m.reservation_id),
    reservation_status: str(m.reservation_status),
    court_id: str(m.court_id),
    court_name_en: str(m.court_name_en),
    court_name_ar: str(m.court_name_ar),
    sandbox: flag(m.sandbox),
    courts_free_firm: num(m.courts_free_firm),
    courts_total: num(m.courts_total),
    started: flag(m.started),
    marks_open: flag(m.marks_open),
    server_now: str(m.server_now),
    can: { add_seat: flag(can.add_seat), cancel: flag(can.cancel), call_off: flag(can.call_off) },
  };
}

function readSeatMoney(v: unknown): SeatMoney | null {
  const m = obj(v);
  if (!m) return null;
  return {
    share_iqd: num(m.share_iqd),
    paid_desk_iqd: num(m.paid_desk_iqd),
    credit_iqd: num(m.credit_iqd),
    owed_iqd: num(m.owed_iqd),
    written_off_iqd: num(m.written_off_iqd),
    write_off: str(m.write_off),
    open_iqd: num(m.open_iqd),
    take_iqd: num(m.take_iqd),
  };
}

function readSeat(s: Raw): MatchSeat | null {
  const id = str(s.seat_id);
  const no = num(s.seat_no);
  if (!id || no === null) return null;
  const can = obj(s.can) ?? {};
  const ticket = obj(s.ticket);
  return {
    seat_id: id,
    seat_no: no,
    kind: str(s.kind) ?? '',
    status: str(s.status) ?? '',
    end_reason: str(s.end_reason),
    carrying: flag(s.carrying),
    customer_id: str(s.customer_id),
    full_name: str(s.full_name),
    display_name: str(s.display_name),
    phone: str(s.phone),
    holder_seat_id: str(s.holder_seat_id),
    holder_name: str(s.holder_name),
    companion_no: num(s.companion_no),
    gender: str(s.gender),
    gender_source: str(s.gender_source),
    vouched: flag(s.vouched),
    flags: flags(s.flags),
    is_organiser: flag(s.is_organiser),
    joined_at: str(s.joined_at),
    ended_at: str(s.ended_at),
    marked_at: str(s.marked_at),
    marked_by_name: str(s.marked_by_name),
    replaces_seat_id: str(s.replaces_seat_id),
    replaced_by_seat_id: str(s.replaced_by_seat_id),
    ticket: ticket ? { ticket_id: str(ticket.ticket_id), status: str(ticket.status) } : null,
    write_off_reason: str(s.write_off_reason),
    money: readSeatMoney(s.money),
    can: {
      mark_attended: flag(can.mark_attended),
      mark_no_show: flag(can.mark_no_show),
      unmark: flag(can.unmark),
      remove_reasons: strs(can.remove_reasons),
      take_share: flag(can.take_share),
      write_off: flag(can.write_off),
      replace: flag(can.replace),
    },
  };
}

function readMoney(v: unknown): MatchMoney | null {
  const m = obj(v);
  if (!m) return null;
  return {
    phase: str(m.phase),
    price_iqd: num(m.price_iqd),
    booking_price_iqd: num(m.booking_price_iqd),
    price_delta_iqd: num(m.price_delta_iqd),
    paid_iqd: num(m.paid_iqd),
    live_tab_paid_iqd: num(m.live_tab_paid_iqd),
    desk_paid_iqd: num(m.desk_paid_iqd),
    unassigned_iqd: num(m.unassigned_iqd),
    delta_owed_iqd: num(m.delta_owed_iqd),
    owed_iqd: num(m.owed_iqd),
    written_off_iqd: num(m.written_off_iqd),
    open_iqd: num(m.open_iqd),
    over_iqd: num(m.over_iqd),
    vacant: list(m.vacant).flatMap((r) => {
      const no = num(r.seat_no);
      return no === null ? [] : [{ seat_no: no, open_iqd: num(r.open_iqd), written_off_iqd: num(r.written_off_iqd) }];
    }),
    unassigned: list(m.unassigned).flatMap((r) => {
      const id = str(r.payment_id);
      return id
        ? [
            {
              payment_id: id,
              tab_id: str(r.tab_id),
              tab_live: flag(r.tab_live),
              method: str(r.method),
              amount_iqd: num(r.amount_iqd),
              unassigned_iqd: num(r.unassigned_iqd),
              created_at: str(r.created_at),
            },
          ]
        : [];
    }),
  };
}

/** null when the payload has no readable `match` (the screen shows not found). */
export function readMatchDetail(raw: unknown): MatchDetail | null {
  const r = obj(raw);
  const match = r && obj(r.match) && readMatchInfo(obj(r.match) as Raw);
  if (!r || !match) return null;
  return {
    match,
    seats: list(r.seats)
      .map(readSeat)
      .filter((s): s is MatchSeat => s !== null),
    requests: list(r.requests).flatMap((q) => {
      const id = str(q.request_id);
      return id
        ? [
            {
              request_id: id,
              customer_id: str(q.customer_id),
              full_name: str(q.full_name),
              phone: str(q.phone),
              flags: flags(q.flags),
              seats_requested: num(q.seats_requested),
              friend_genders: strs(q.friend_genders),
              games_played: num(q.games_played),
              no_shows: num(q.no_shows),
              created_at: str(q.created_at),
            },
          ]
        : [];
    }),
    money: readMoney(r.money),
    events: list(r.events).flatMap((e) => {
      const type = str(e.type);
      return type
        ? [
            {
              at: str(e.at),
              type,
              actor: str(e.actor),
              actor_name: str(e.actor_name),
              seat_no: num(e.seat_no),
              code: str(e.code),
            },
          ]
        : [];
    }),
  };
}

// ---------------------------------------------------------------------------
// app.guest_tickets(p_customer_id) (Money, §5.6.4; money.md §5.7)
// ---------------------------------------------------------------------------

export interface GuestTicket {
  id: string;
  /** `available`, `reserved`, `in_use`, `forfeited`, `cashed_out`. */
  status: string;
  price_iqd: number | null;
  sandbox: boolean;
  bought_at: string | null;
  purchase_payment_id: string | null;
  match: { match_id: string | null; start_at: string | null; venue_id: string | null } | null;
  forfeited_at: string | null;
  forfeited_venue_id: string | null;
  cashed_out_at: string | null;
}

export interface TicketCashout {
  allowed: boolean;
  /** null, `in_use`, `reserved`, `restorable`, `none_unused`, `not_succeeded`, `done` (R13). */
  reason: string | null;
  tickets: number | null;
  amount_iqd: number | null;
  until_at: string | null;
}

export interface TicketPurchase {
  payment_id: string;
  request_id: string | null;
  status: string | null;
  ticket_count: number | null;
  unit_price_iqd: number | null;
  amount_iqd: number | null;
  bought_at: string | null;
  refund_reason: string | null;
  refund_amount_iqd: number | null;
  refunded_at: string | null;
  sandbox: boolean;
  cashout: TicketCashout | null;
}

export interface GuestTickets {
  customer_id: string | null;
  /** Today's ticket price (chain-wide). */
  price_iqd: number | null;
  available: number | null;
  reserved: number | null;
  in_use: number | null;
  /** Top-level counts: `tickets` holds only the live and the last 50 ended tickets. */
  forfeited: number | null;
  cashed_out: number | null;
  tickets: GuestTicket[];
  purchases: TicketPurchase[];
  /** The live purchase attempt ("Payment in progress"), or null. */
  pending: { request_id: string | null; status: string | null; ticket_count: number | null; amount_iqd: number | null } | null;
  server_now: string | null;
}

export function readGuestTickets(raw: unknown): GuestTickets {
  const r = obj(raw) ?? {};
  const pending = obj(r.pending);
  return {
    customer_id: str(r.customer_id),
    price_iqd: num(r.price_iqd),
    available: num(r.available),
    reserved: num(r.reserved),
    in_use: num(r.in_use),
    forfeited: num(r.forfeited),
    cashed_out: num(r.cashed_out),
    tickets: list(r.tickets).flatMap((t) => {
      const id = str(t.id);
      if (!id) return [];
      const m = obj(t.match);
      return [
        {
          id,
          status: str(t.status) ?? '',
          price_iqd: num(t.price_iqd),
          sandbox: flag(t.sandbox),
          bought_at: str(t.bought_at),
          purchase_payment_id: str(t.purchase_payment_id),
          match: m ? { match_id: str(m.match_id), start_at: str(m.start_at), venue_id: str(m.venue_id) } : null,
          forfeited_at: str(t.forfeited_at),
          forfeited_venue_id: str(t.forfeited_venue_id),
          cashed_out_at: str(t.cashed_out_at),
        },
      ];
    }),
    purchases: list(r.purchases).flatMap((p) => {
      const id = str(p.payment_id);
      if (!id) return [];
      const c = obj(p.cashout);
      return [
        {
          payment_id: id,
          request_id: str(p.request_id),
          status: str(p.status),
          ticket_count: num(p.ticket_count),
          unit_price_iqd: num(p.unit_price_iqd),
          amount_iqd: num(p.amount_iqd),
          bought_at: str(p.bought_at),
          refund_reason: str(p.refund_reason),
          refund_amount_iqd: num(p.refund_amount_iqd),
          refunded_at: str(p.refunded_at),
          sandbox: flag(p.sandbox),
          cashout: c
            ? { allowed: flag(c.allowed), reason: str(c.reason), tickets: num(c.tickets), amount_iqd: num(c.amount_iqd), until_at: str(c.until_at) }
            : null,
        },
      ];
    }),
    pending: pending
      ? { request_id: str(pending.request_id), status: str(pending.status), ticket_count: num(pending.ticket_count), amount_iqd: num(pending.amount_iqd) }
      : null,
    server_now: str(r.server_now),
  };
}

// ---------------------------------------------------------------------------
// app.match_settings(p_venue_id) (DB, §5.6.4)
// ---------------------------------------------------------------------------

export interface MatchSettings {
  venue_id: string | null;
  matches_enabled: boolean;
  match_fill_deadline_minutes: number | null;
  earliest_start_minutes: number | null;
  /** All branches. */
  match_ticket_price_iqd: number | null;
  /** All branches. */
  max_filling_matches_per_guest: number | null;
}

export function readMatchSettings(raw: unknown): MatchSettings {
  const r = obj(raw) ?? {};
  return {
    venue_id: str(r.venue_id),
    matches_enabled: flag(r.matches_enabled),
    match_fill_deadline_minutes: num(r.match_fill_deadline_minutes),
    earliest_start_minutes: num(r.earliest_start_minutes),
    match_ticket_price_iqd: num(r.match_ticket_price_iqd),
    max_filling_matches_per_guest: num(r.max_filling_matches_per_guest),
  };
}

// ---------------------------------------------------------------------------
// app.match_reports_open(p_venue_id) (DB, §5 D24 pick), oldest first
// ---------------------------------------------------------------------------

export interface MatchReport {
  report_id: string;
  /** `offensive_name`, `abusive_behaviour`, `harassment`, `unsafe_play`, `no_show`, `other`. */
  reason: string;
  created_at: string | null;
  match: { id: string | null; start_at: string | null; category: string | null; status: string | null; reservation_id: string | null } | null;
  reported: (MatchPerson & { flags: CustomerFlag[]; banned: boolean; reports_90d: number | null; no_shows: number | null }) | null;
  reporter: { customer_id: string | null; full_name: string | null } | null;
}

export function readMatchReports(raw: unknown): MatchReport[] {
  return list(raw).flatMap((r) => {
    const id = str(r.report_id);
    if (!id) return [];
    const m = obj(r.match);
    const who = obj(r.reported);
    const by = obj(r.reporter);
    return [
      {
        report_id: id,
        reason: str(r.reason) ?? 'other',
        created_at: str(r.created_at),
        match: m
          ? { id: str(m.id), start_at: str(m.start_at), category: str(m.category), status: str(m.status), reservation_id: str(m.reservation_id) }
          : null,
        reported: who
          ? {
              ...(person(who) as MatchPerson),
              flags: flags(who.flags),
              banned: flag(who.banned),
              reports_90d: num(who.reports_90d),
              no_shows: num(who.no_shows),
            }
          : null,
        reporter: by ? { customer_id: str(by.customer_id), full_name: str(by.full_name) } : null,
      },
    ];
  });
}
