/**
 * 0262 match_desk_money, lane DB's half: the desk's open-match RPCs
 * (docs/design/open-matches/db.md §4.7, operator.md §5.6 and §5.7; build
 * contracts §1.7, §1.8, R4, R9, R10, R12, R16, R19, R21, R35, R39, R40, R42).
 *
 * Rolled-back scenarios at a branch made inside the transaction (the 0261
 * harness: open, matches on, open all day, two courts), the seeded court desk
 * and manager filed there too, calling the RPCs as staff:
 *   * desk_start_match and desk_add_seat: every refusal in its order, a
 *     walk-in and a customer start, the fourth seat booking the court, R10,
 *     the desk's exemption from R41;
 *   * walk-ins on a booked match: a late leaver refilled, a no-show's number
 *     taken over after the start (R4, R21), a forfeited late leaver restored;
 *   * the removal table, desk_cancel_match;
 *   * the mark table while the business day is open: undo, corrections,
 *     ticket_used, replaced, paid, match_ended, day_closed, all-no-show and its
 *     reopening, court_reused;
 *   * call-off short (R12 every carrier marked first, R39 a late leaver
 *     counted absent, not_short, nobody_came);
 *   * chain-wide bans (R35, R40) with set_customer_flags carrying them over,
 *     the gender correction, the reports queue;
 *   * the read shapes key by key against operator.md §5.6, visibility
 *     (sandbox, another branch, VENUE_MISMATCH at a closed one);
 *   * mark_reservation's MATCH_MARK_SEATS and the customer_* counts.
 * pg_temp.ledger() (the ticket ledger rules a rolled-back scenario can check,
 * money.md §9 T5, T6, T8, T9) after every case that moves a ticket. One small
 * read over HTTP proves the grants.
 *
 * Money's figures (seats[].money, money) come from Part 1's app.match_money;
 * match-money.test.ts owns them. Here they are checked for shape and for the
 * flags the desk reads (take_share, write_off), and every scenario that
 * changes a booked match ends with the court-money invariants (money.md §9,
 * MONEY: pg_temp.money_of over every match of the branch with a booking).
 */
import { describe, expect, it } from 'vitest';
import { MATCH_MONEY_CHECK, SEED_STAFF, appRpc, guestClient, serviceClient, signedInClient, stackAvailable } from './helpers';
import { Q, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, MONEY, SETUP, START, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const NIL = '00000000-0000-4000-8000-000000000261';

/** A started match's start: half an hour ago, on the minute (it ends an hour from now). */
const STARTED = `(date_trunc('minute', now()) - interval '30 minutes')`;

/**
 * The desk's fixtures on top of the 0261 harness: the seeded court desk and
 * manager work at the branch too (the owner works at every open branch); a
 * second branch nobody here works at; more courts; a booked match with its
 * booking; the business day of a time; a paid seat; a request that reserves a
 * given ticket; a report; a mark planted as postgres.
 */
const DESK_SETUP = String.raw`
create function pg_temp.desk_staff() returns void language sql as $f$
  insert into staff_venues (staff_id, venue_id, role)
  values (pg_temp.var('desk')::uuid, pg_temp.var('v')::uuid, 'court_desk'),
         (pg_temp.var('manager')::uuid, pg_temp.var('v')::uuid, 'manager')
$f$;

create function pg_temp.branch2() returns void language plpgsql as $f$
declare v uuid; c uuid;
  v_all constant jsonb := '[["00:00","24:00"]]';
begin
  insert into venues (slug, name_en, name_ar, timezone, is_active)
  values ('m261-' || substr(md5(random()::text), 1, 8), 'M261 branch 2', 'فرع ٢٦١', 'Asia/Baghdad', true)
  returning id into v;
  insert into venue_settings (venue_id, venue_name, opening_hours, matches_enabled)
  values (v, 'M261 branch 2', jsonb_build_object('mon', v_all, 'tue', v_all, 'wed', v_all, 'thu', v_all,
                                                 'fri', v_all, 'sat', v_all, 'sun', v_all), true);
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'M261 court', 'ملعب', '{60,90,120}', 1, true) returning id into c;
  insert into pg_temp.vars values ('v2', v::text), ('c21', c::text);
end $f$;

-- Courts c3..c(n+2) at the branch (the all-day rule prices them).
create function pg_temp.courts(p_n int) returns void language plpgsql as $f$
declare c uuid; i int;
begin
  for i in 3 .. p_n + 2 loop
    insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
    values (pg_temp.var('v')::uuid, 'M261 court ' || i, 'ملعب', '{60,90,120}', i, true) returning id into c;
    insert into pg_temp.vars values ('c' || i, c::text);
  end loop;
end $f$;

-- A booked match (90 minutes, 40,000) with its confirmed booking on p_court.
create function pg_temp.mb(p_court text, p_start timestamptz, p jsonb default '{}') returns uuid
language plpgsql as $f$
declare v_res uuid := pg_temp.res(p_court, p_start, 90, 'booking', 'confirmed');
begin
  update reservations set price_iqd = 40000 where id = v_res;
  return pg_temp.m(jsonb_build_object('status', 'booked', 'start_at', p_start, 'reservation_id', v_res,
                                      'price_court_id', pg_temp.var(p_court)) || p);
end $f$;

-- The branch's business day of p_at, open or closed.
create function pg_temp.day(p_at timestamptz, p_status text default 'open') returns void language sql as $f$
  insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
  values (pg_temp.var('v')::uuid, app.venue_business_date(pg_temp.var('v')::uuid, p_at), p_status::day_status,
          pg_temp.var('manager')::uuid, 0)
$f$;

-- What match_seat_settle leaves behind, planted: a settled court tab of the
-- match's booking and a cash payment linked to seat p_seat.
create function pg_temp.paid(p_seat uuid, p_amount bigint default 10000) returns uuid language plpgsql as $f$
declare v_s match_seats; v_res uuid; v_day uuid; v_tab uuid; v_pay uuid;
begin
  select * into v_s from match_seats where id = p_seat;
  select m.reservation_id into v_res from matches m where m.id = v_s.match_id;
  select d.id into v_day from day_sessions d
   where d.venue_id = v_s.venue_id and d.status = 'open' order by d.business_date desc limit 1;
  insert into tabs (day_session_id, status, reservation_id, venue_id, kind, court_iqd, total_iqd, settled_at)
  values (v_day, 'settled', v_res, v_s.venue_id, 'cafe', p_amount, p_amount, now()) returning id into v_tab;
  insert into payments (tab_id, day_session_id, method, amount_iqd, recorded_by, venue_id)
  values (v_tab, v_day, 'cash', p_amount, pg_temp.var('desk')::uuid, v_s.venue_id) returning id into v_pay;
  insert into payment_match_seats (payment_id, match_seat_id, venue_id, amount_iqd, linked_by)
  values (v_pay, p_seat, v_s.venue_id, p_amount, pg_temp.var('desk')::uuid);
  return v_pay;
end $f$;

-- A pending request of p_guest at p_match holding the given (available) ticket.
create function pg_temp.reserve(p_match uuid, p_guest uuid, p_ticket uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into match_requests (venue_id, match_id, guest_id, seats_requested)
  values ((select mt.venue_id from matches mt where mt.id = p_match), p_match, p_guest, 1) returning id into v;
  if app.ticket_lock(array[p_ticket], null, v) <> 1 then
    raise exception 'reserve: the ticket was not reserved';
  end if;
  return v;
end $f$;

-- A pending request of p_guest at p_match on a fresh ticket.
create function pg_temp.req(p_match uuid, p_guest uuid) returns uuid language sql as $f$
  select pg_temp.reserve(p_match, p_guest,
                         pg_temp.ticket(p_guest, (select mt.sandbox from matches mt where mt.id = p_match)))
$f$;

create function pg_temp.report(p_match uuid, p_reporter uuid, p_reported uuid, p_seat uuid, p_reason text,
                               p_at timestamptz default now()) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, reason, created_at)
  values ((select mt.venue_id from matches mt where mt.id = p_match), p_match, p_reporter, p_reported, p_seat,
          p_reason, p_at)
  returning id into v;
  return v;
end $f$;

-- A mark planted as postgres, with the ticket move the desk's mark makes.
create function pg_temp.mark(p_seat uuid, p_status text) returns void language plpgsql as $f$
declare v_t uuid := (select s.ticket_id from match_seats s where s.id = p_seat);
begin
  if v_t is not null and p_status = 'attended' then
    perform app.ticket_release(array[v_t], 'attended', array[p_seat]);
  elsif v_t is not null and p_status = 'no_show' then
    perform app.ticket_forfeit(v_t, p_seat);
  end if;
  update match_seats set status = p_status, marked_at = now() where id = p_seat;
end $f$;
` + MATCH_MONEY_CHECK;

const q = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v}'`);
const ref = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `{{${v}}}`);
const KEPT = (name: string, label: string, path: string) =>
  K(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);

/** desk_start_match at the branch: defaults to court c1, three days out, 90 minutes, a walk-in "Walk In". */
function DSTART(o: {
  when?: string; dur?: number | null; category?: string; visibility?: string; policy?: string; customer?: string;
  name?: string | null; phone?: string; gender?: string; extra?: number; court?: string | null; venue?: string;
  key?: string | null;
} = {}): string {
  const key = o.key === undefined ? `'dk-${Math.random().toString(36).slice(2)}'` : q(o.key);
  const name = o.name === undefined ? (o.customer ? null : 'Walk In') : o.name;
  return `select app.desk_start_match(p_start_at => ${o.when ?? at(3)}, ` +
    `p_duration_min => ${o.dur === null ? 'null' : (o.dur ?? 90)}, p_category => '${o.category ?? 'open'}', ` +
    `p_visibility => '${o.visibility ?? 'public'}', p_join_policy => '${o.policy ?? 'open'}', ` +
    `p_customer_id => ${ref(o.customer)}, p_guest_name => ${q(name)}, p_guest_phone => ${q(o.phone)}, ` +
    `p_gender => ${q(o.gender)}, p_extra_seats => ${o.extra ?? 0}, ` +
    `p_court_id => ${o.court === null ? 'null' : `{{${o.court ?? 'c1'}}}`}, p_venue_id => ${ref(o.venue)}, ` +
    `p_idempotency_key => ${key})`;
}

/** desk_add_seat: defaults to a typed walk-in and a fresh key. */
function DADD(m: string, o: { customer?: string; name?: string | null; phone?: string; gender?: string; key?: string | null } = {}): string {
  const key = o.key === undefined ? `'da-${Math.random().toString(36).slice(2)}'` : q(o.key);
  const name = o.name === undefined ? (o.customer ? null : 'Desk Walkin') : o.name;
  return `select app.desk_add_seat(p_match_id => {{${m}}}, p_customer_id => ${ref(o.customer)}, ` +
    `p_guest_name => ${q(name)}, p_guest_phone => ${q(o.phone)}, p_gender => ${q(o.gender)}, ` +
    `p_idempotency_key => ${key})`;
}

const REMOVE = (seat: string, reason: string) => `select app.desk_remove_seat({{${seat}}}, '${reason}')`;
const CANCEL = (m: string, reason: string) => `select app.desk_cancel_match({{${m}}}, '${reason}')`;
const MARK = (seats: string[], attendance: string) =>
  `select app.mark_match_seats(array[${seats.map((s) => `{{${s}}}`).join(', ')}]::uuid[], '${attendance}')`;
const CALLOFF = (m: string) => `select app.desk_call_off_short({{${m}}})`;
const DETAIL = (m: string) => `select app.desk_match_detail({{${m}}})`;
const BAN = (c: string, banned: string, reason: string | null) =>
  `select app.set_match_ban({{${c}}}, ${banned}, ${q(reason)})`;
const GENDER = (c: string, g: string | null) => `select app.staff_set_customer_gender({{${c}}}, ${q(g)})`;
const RESOLVE = (r: string, outcome: string) => `select app.resolve_match_report({{${r}}}, '${outcome}')`;
const SEAT = (m: string, no: number, kind: string, who: string | null, status = 'in', p = '{}') =>
  `select pg_temp.seat({{${m}}}, ${no}, '${kind}', ${who ? `{{${who}}}` : 'null'}, '${status}', '${p}'::jsonb)`;
const WALKIN = '{"guest_name":"Walk In"}';

/** operator.md §5.6: the keys the operator builds against. */
const sorted = (xs: string[]) => [...xs].sort();
const keys = (o: unknown) => Object.keys(o as Json).sort();
const ENVELOPE_KEYS = sorted(['matches_enabled', 'fill_deadline_minutes', 'earliest_start_minutes', 'ticket_price_iqd',
  'server_now', 'matches']);
const OPEN_ROW_KEYS = sorted(['match_id', 'venue_id', 'status', 'start_at', 'end_at', 'duration_min', 'category',
  'join_policy', 'visibility', 'seats_taken', 'seats_left', 'requests_pending', 'fill_deadline_at', 'organised_by',
  'organiser', 'price_iqd', 'shares_iqd', 'courts_free_firm', 'courts_total']);
const STATE_KEYS = sorted(['match_id', 'status', 'category', 'label', 'organiser_customer_id', 'seats_in',
  'seats_attended', 'seats_no_show', 'seats_unmarked', 'seats_left_late', 'open_seats']);
const DETAIL_KEYS = sorted(['match', 'seats', 'requests', 'money', 'events']);
const MATCH_KEYS = sorted(['id', 'venue_id', 'status', 'ended_reason', 'start_at', 'end_at', 'duration_min', 'category',
  'join_policy', 'visibility', 'price_iqd', 'shares_iqd', 'fill_deadline_at', 'share_token', 'organised_by',
  'organiser_seat_id', 'organiser', 'reservation_id', 'reservation_status', 'court_id', 'court_name_en',
  'court_name_ar', 'sandbox', 'courts_free_firm', 'courts_total', 'started', 'marks_open', 'server_now', 'can']);
const SEAT_KEYS = sorted(['seat_id', 'seat_no', 'kind', 'status', 'end_reason', 'carrying', 'customer_id', 'full_name',
  'display_name', 'phone', 'holder_seat_id', 'holder_name', 'companion_no', 'gender', 'gender_source', 'vouched',
  'flags', 'is_organiser', 'joined_at', 'ended_at', 'marked_at', 'marked_by_name', 'replaces_seat_id',
  'replaced_by_seat_id', 'ticket', 'write_off_reason', 'money', 'can']);
const SEAT_CAN_KEYS = sorted(['mark_attended', 'mark_no_show', 'unmark', 'remove_reasons', 'take_share', 'write_off',
  'replace']);
const SEAT_MONEY_KEYS = sorted(['share_iqd', 'paid_desk_iqd', 'credit_iqd', 'owed_iqd', 'written_off_iqd', 'write_off',
  'open_iqd', 'take_iqd']);
const REQUEST_KEYS = sorted(['request_id', 'customer_id', 'full_name', 'phone', 'flags', 'seats_requested',
  'friend_genders', 'games_played', 'no_shows', 'created_at']);
const MONEY_KEYS = sorted(['phase', 'price_iqd', 'booking_price_iqd', 'price_delta_iqd', 'paid_iqd', 'live_tab_paid_iqd',
  'desk_paid_iqd', 'unassigned_iqd', 'delta_owed_iqd', 'owed_iqd', 'written_off_iqd', 'open_iqd', 'over_iqd',
  'vacant', 'unassigned']);
const EVENT_KEYS = sorted(['at', 'type', 'actor', 'actor_name', 'seat_no', 'code']);
const REPORT_KEYS = sorted(['report_id', 'reason', 'created_at', 'match', 'reported', 'reporter']);
const ALL_REASONS = ['customer_request', 'conduct', 'staff_error', 'duplicate', 'other'];

type Seat = Json & { seat_id: string; can: Json; money: Json | null; ticket: Json | null };
const seatOf = (d: Json, id: string) => (d.seats as Seat[]).find((s) => s.seat_id === id)!;

// ── 1. desk_start_match and desk_add_seat ──────────────────────────────────

describe.skipIf(!docker)('desk_start_match and desk_add_seat (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261a', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.branch2();`,
      K('nil', `select '${NIL}'`),
      GUEST('g1', '{"given":"Sara","family":"Karim","phone":"+9647711110001"}'),
      GUEST('gm', '{"gender":"male"}'),
      GUEST('gu', '{"gender":null}'),
      GUEST('gb'), `select pg_temp.ban('gb');`,
      GUEST('gd'), X(`update profiles set deleted_at = now() where id = {{gd}}`),
      `select pg_temp.tickets('g1', 2);`,

      // desk_start_match: every refusal, in the §4.7.4 order.
      E('s_guest', 'g1', DSTART()),
      E('s_cashier', 'cashier', DSTART()),
      E('s_other_branch', 'desk', DSTART({ venue: 'v2', court: null })),
      E('s_no_time', 'desk', DSTART({ when: 'null' })),
      E('s_no_key', 'desk', DSTART({ key: null })),
      E('s_category', 'desk', DSTART({ category: 'mixed' })),
      E('s_gender_value', 'desk', DSTART({ gender: 'x' })),
      E('s_phone', 'desk', DSTART({ phone: '12' })),
      E('s_approve_walkin', 'desk', DSTART({ policy: 'approve' })),
      E('s_extra', 'desk', DSTART({ extra: 3 })),
      E('s_nobody', 'desk', DSTART({ name: null })),
      E('s_unknown', 'desk', DSTART({ customer: 'nil' })),
      E('s_deleted', 'desk', DSTART({ customer: 'gd' })),
      E('s_banned', 'desk', DSTART({ customer: 'gb' })),
      X(`update venue_settings set matches_enabled = false where venue_id = {{v}}`),
      E('s_off', 'desk', DSTART()),
      X(`update venue_settings set matches_enabled = true where venue_id = {{v}}`),
      E('s_court', 'desk', DSTART({ venue: 'v', court: 'c21' })),
      E('s_duration', 'desk', DSTART({ dur: 45 })),
      E('s_duration_any', 'desk', DSTART({ dur: 45, court: null, venue: 'v' })),
      X(`update venue_settings set closed_dates = array[(${at(5)} at time zone 'Asia/Baghdad')::date] where venue_id = {{v}}`),
      E('s_closed', 'desk', DSTART({ when: at(5) })),
      X(`update venue_settings set closed_dates = '{}' where venue_id = {{v}}`),
      E('s_too_late', 'desk', DSTART({ when: `now() + interval '150 minutes'` })),
      E('s_past', 'desk', DSTART({ when: at(-1) })),
      E('s_gender_customer', 'desk', DSTART({ category: 'men', customer: 'g1' })),
      E('s_gender_walkin', 'desk', DSTART({ category: 'women' })),
      E('s_gender_extra', 'desk', DSTART({ category: 'women', customer: 'g1', extra: 1 })),
      X(`select pg_temp.res('c1', ${at(4)}, 90)`),
      X(`select pg_temp.res('c2', ${at(4)}, 90)`),
      E('s_taken', 'desk', DSTART({ when: at(4) })),
      E('s_one', 'desk', DSTART({ when: at(6), key: 'dk-one' })),
      X(`select pg_temp.res('c2', ${at(6)}, 90)`),
      E('s_slot_full', 'desk', DSTART({ when: at(6) })),
      X(`update rate_rules set is_active = false where venue_id = {{v}}`),
      E('s_no_rate', 'desk', DSTART({ when: at(7) })),
      X(`update rate_rules set is_active = true where venue_id = {{v}}`),

      // A walk-in with two companions, then its replay and a conflict.
      E('walkin', 'desk', DSTART({ name: 'Omar Khalid', phone: '+9647712345678', gender: 'male', extra: 2, key: 'dk-walkin' })),
      KEPT('mw', 'walkin', 'match_id'),
      Q('mw_row', `select jsonb_build_object('status', m.status, 'organised_by', m.organised_by,
          'organiser_id', m.organiser_id, 'by_desk', m.created_by_staff_id = {{desk}}, 'sandbox', m.sandbox,
          'price_iqd', m.price_iqd, 'join_policy', m.join_policy, 'court_c1', m.price_court_id = {{c1}},
          'deadline_ok', m.fill_deadline_at = m.start_at - interval '120 minutes')
          from matches m where m.id = {{mw}}`),
      Q('mw_seats', `select jsonb_agg(jsonb_build_object('no', s.seat_no, 'kind', s.kind, 'guest_id', s.guest_id,
          'name', s.guest_name, 'phone', s.guest_phone, 'gender', s.gender, 'ticket', s.ticket_id,
          'vouched', s.vouched, 'share', s.share_iqd) order by s.seat_no)
          from match_seats s where s.match_id = {{mw}}`),
      Q('mw_trail', `select jsonb_build_object(
          'events', (select jsonb_agg(e.type || ':' || e.actor order by e.id) from match_events e where e.match_id = {{mw}}),
          'audit', (select jsonb_agg(a.action order by a.at, a.id) from audit_log a where a.entity_id = {{mw}}))`),
      E('walkin_replay', 'desk', DSTART({ name: 'Omar Khalid', phone: '+9647712345678', gender: 'male', extra: 2, key: 'dk-walkin' })),
      E('walkin_conflict', 'manager', DSTART({ key: 'dk-walkin' })),

      // For a customer: organiser, approve mode, a women's match.
      E('cust', 'desk', DSTART({ customer: 'g1', category: 'women', policy: 'approve', extra: 1, gender: 'female',
                                  when: at(3, 3), key: 'dk-cust' })),
      KEPT('mc', 'cust', 'match_id'),
      Q('mc_row', `select jsonb_build_object('organiser_is_g1', m.organiser_id = {{g1}}, 'policy', m.join_policy,
          'seats', (select jsonb_agg(jsonb_build_object('no', s.seat_no, 'linked', s.guest_id = {{g1}},
                                                        'name', s.guest_name, 'gender', s.gender) order by s.seat_no)
                      from match_seats s where s.match_id = m.id))
          from matches m where m.id = {{mc}}`),

      // desk_add_seat: every refusal, in the §4.7.5 order.
      K('msb', `select pg_temp.m(jsonb_build_object('sandbox', true, 'start_at', ${at(8)}))`),
      K('mo', `select pg_temp.m(jsonb_build_object('venue_id', {{v2}}, 'price_court_id', {{c21}}, 'rate_rule_id', null,
                                                    'start_at', ${at(8)}))`),
      K('mlate', `select pg_temp.m(jsonb_build_object('start_at', now() + interval '1 hour',
                                                       'fill_deadline_at', now() - interval '1 hour'))`),
      K('mwait', `select pg_temp.m(jsonb_build_object('status', 'awaiting_court', 'start_at', ${at(9)}))`),
      E('a_cashier', 'cashier', DADD('mw')),
      E('a_unknown', 'desk', DADD('nil')),
      E('a_sandbox', 'desk', DADD('msb')),
      E('a_other', 'desk', DADD('mo')),
      E('a_no_key', 'desk', DADD('mw', { key: null })),
      E('a_nobody', 'desk', DADD('mw', { name: null })),
      E('a_deleted', 'desk', DADD('mw', { customer: 'gd' })),
      E('a_banned', 'desk', DADD('mw', { customer: 'gb' })),
      E('a_already', 'desk', DADD('mc', { customer: 'g1' })),
      E('a_gender', 'desk', DADD('mc', { customer: 'gm' })),
      E('a_gender_walkin', 'desk', DADD('mc')),
      E('a_undeclared', 'desk', DADD('mc', { customer: 'gu', gender: 'female' })),
      E('a_late', 'desk', DADD('mlate')),
      E('a_waiting', 'desk', DADD('mwait')),

      // R10: matches off, the desk still fills a started match; the fourth
      // seat books the court.
      X(`update venue_settings set matches_enabled = false where venue_id = {{v}}`),
      E('a_fourth', 'desk', DADD('mw', { name: 'Ali Hasan', key: 'da-fourth' })),
      X(`update venue_settings set matches_enabled = true where venue_id = {{v}}`),
      Q('mw_booked', `select jsonb_build_object('status', m.status, 'guest_id', r.guest_id, 'guest_name', r.guest_name,
          'booking_status', r.status, 'source', r.source, 'price_iqd', r.price_iqd, 'court_c1', r.court_id = {{c1}},
          'by_desk', r.created_by_staff_id = {{desk}})
          from matches m join reservations r on r.id = m.reservation_id where m.id = {{mw}}`),
      E('a_fourth_replay', 'desk', DADD('mw', { name: 'Ali Hasan', key: 'da-fourth' })),
      E('a_full', 'desk', DADD('mw', { name: 'Someone Else' })),

      // R41 does not bind the desk: g1 starts a match of her own, then the desk
      // seats her in another one over the same time.
      E('mx_start', 'desk', DSTART({ when: at(10), key: 'dk-mx' })),
      KEPT('mx', 'mx_start', 'match_id'),
      E('g1_start', 'g1', START({ when: at(10), key: 'k-g1' })),
      E('a_clash_exempt', 'desk', DADD('mx', { customer: 'g1' })),
      Q('ledger', `select pg_temp.ledger()`),
      MONEY('money_a'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_a')).toEqual({});
  });

  it('refuses a start in the §4.7.4 order, each code with its detail', () => {
    expect(failed(r, 's_guest').code).toBe('FORBIDDEN');
    expect(failed(r, 's_cashier').code).toBe('FORBIDDEN');
    expect(failed(r, 's_other_branch').code).toBe('VENUE_MISMATCH');
    expect(failed(r, 's_no_time')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_start_at' });
    expect(failed(r, 's_no_key')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_idempotency_key' });
    expect(failed(r, 's_category')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_category' });
    expect(failed(r, 's_gender_value')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_gender' });
    expect(failed(r, 's_phone')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_guest_phone' });
    expect(failed(r, 's_approve_walkin')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_join_policy' });
    expect(failed(r, 's_extra').code).toBe('MATCH_SEAT_LIMIT');
    expect(failed(r, 's_nobody').code).toBe('GUEST_REQUIRED');
    expect(failed(r, 's_unknown').code).toBe('CUSTOMER_NOT_FOUND');
    expect(failed(r, 's_deleted').code).toBe('CUSTOMER_NOT_FOUND');
    expect(failed(r, 's_banned').code).toBe('MATCH_BANNED');
    expect(failed(r, 's_off').code).toBe('MATCHES_OFF');
    expect(failed(r, 's_court').code).toBe('COURT_NOT_FOUND');
    expect(failed(r, 's_duration').code).toBe('INVALID_DURATION');
    expect(failed(r, 's_duration_any').code).toBe('INVALID_DURATION');
    expect(failed(r, 's_closed').code).toBe('CLOSED_DATE');
    // OM-43 with the default 120-minute deadline: 180 minutes' notice; the past too.
    expect(failed(r, 's_too_late')).toMatchObject({ code: 'MATCH_TOO_LATE', detail: '180' });
    expect(failed(r, 's_past')).toMatchObject({ code: 'MATCH_TOO_LATE', detail: '180' });
    for (const l of ['s_gender_customer', 's_gender_walkin', 's_gender_extra']) {
      expect(failed(r, l)).toMatchObject({ code: 'MATCH_GENDER_MISMATCH', detail: 'p_gender' });
    }
    expect(failed(r, 's_taken').code).toBe('SLOT_TAKEN');
    expect(data<Json>(r, 's_one')).toMatchObject({ duplicate: false, status: 'filling' });
    expect(failed(r, 's_slot_full')).toMatchObject({ code: 'MATCH_SLOT_FULL', detail: '1' });
    expect(failed(r, 's_no_rate').code).toBe('NO_RATE');
  });

  it('starts a walk-in match: desk seats, no tickets, the stamped price; a replay is the same match', () => {
    const w = data<Json>(r, 'walkin');
    expect(w).toMatchObject({ duplicate: false, status: 'filling', price_iqd: 40000, shares_iqd: [10000, 10000, 10000, 10000] });
    expect((w.seats as Json[]).map((s) => [s.seat_no, s.kind])).toEqual([[1, 'desk'], [2, 'desk'], [3, 'desk']]);
    expect(Object.keys(w).sort()).toEqual(sorted(['duplicate', 'match_id', 'status', 'share_token', 'seats', 'price_iqd',
      'shares_iqd', 'fill_deadline_at']));
    expect(data(r, 'mw_row')).toEqual({
      status: 'filling', organised_by: 'desk', organiser_id: null, by_desk: true, sandbox: false, price_iqd: 40000,
      join_policy: 'open', court_c1: true, deadline_ok: true,
    });
    expect(data(r, 'mw_seats')).toEqual([
      { no: 1, kind: 'desk', guest_id: null, name: 'Omar Khalid', phone: '+9647712345678', gender: 'male', ticket: null, vouched: true, share: 10000 },
      { no: 2, kind: 'desk', guest_id: null, name: null, phone: null, gender: 'male', ticket: null, vouched: true, share: 10000 },
      { no: 3, kind: 'desk', guest_id: null, name: null, phone: null, gender: 'male', ticket: null, vouched: true, share: 10000 },
    ]);
    expect(data(r, 'mw_trail')).toEqual({ events: ['started:staff'], audit: ['match.desk_start'] });
    expect(data<Json>(r, 'walkin_replay')).toMatchObject({ duplicate: true, match_id: w.match_id, status: 'filling' });
    expect((data<Json>(r, 'walkin_replay').seats as Json[]).length).toBe(3);
    expect(failed(r, 'walkin_conflict').code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('starts a match for a customer: they organise it, seat 1 is theirs, approve mode allowed', () => {
    expect(data(r, 'mc_row')).toEqual({
      organiser_is_g1: true, policy: 'approve',
      seats: [{ no: 1, linked: true, name: null, gender: 'female' }, { no: 2, linked: null, name: null, gender: 'female' }],
    });
  });

  it('refuses an added seat in the §4.7.5 order', () => {
    expect(failed(r, 'a_cashier').code).toBe('FORBIDDEN');
    for (const l of ['a_unknown', 'a_sandbox', 'a_other']) expect(failed(r, l).code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'a_no_key')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_idempotency_key' });
    expect(failed(r, 'a_nobody').code).toBe('GUEST_REQUIRED');
    expect(failed(r, 'a_deleted').code).toBe('CUSTOMER_NOT_FOUND');
    expect(failed(r, 'a_banned').code).toBe('MATCH_BANNED');
    expect(failed(r, 'a_already').code).toBe('MATCH_ALREADY_IN');
    expect(failed(r, 'a_gender')).toMatchObject({ code: 'MATCH_GENDER_MISMATCH', detail: 'p_gender' });
    expect(failed(r, 'a_gender_walkin')).toMatchObject({ code: 'MATCH_GENDER_MISMATCH', detail: 'p_gender' });
    expect(data<Json>(r, 'a_undeclared')).toMatchObject({ duplicate: false, seat_no: 3, match_status: 'filling', replaced_seat_id: null });
    expect(failed(r, 'a_late').code).toBe('MATCH_NOT_FILLING');
    expect(failed(r, 'a_waiting').code).toBe('MATCH_FULL');
  });

  it('the fourth seat books the court, matches off or not (R10); a replay answers the same seat', () => {
    const f = data<Json>(r, 'a_fourth');
    expect(f).toMatchObject({ duplicate: false, seat_no: 4, match_status: 'booked', replaced_seat_id: null });
    expect(f.reservation_id).toEqual(expect.any(String));
    expect(data(r, 'mw_booked')).toEqual({
      status: 'booked', guest_id: null, guest_name: 'Open match', booking_status: 'confirmed', source: 'desk',
      price_iqd: 40000, court_c1: true, by_desk: true,
    });
    expect(data<Json>(r, 'a_fourth_replay')).toMatchObject({ duplicate: true, seat_id: f.seat_id, seat_no: 4 });
    expect(failed(r, 'a_full').code).toBe('MATCH_FULL');
  });

  it('desk seats are exempt from R41, and no ticket moved wrongly', () => {
    expect(data<Json>(r, 'g1_start')).toMatchObject({ status: 'filling' });
    expect(data<Json>(r, 'a_clash_exempt')).toMatchObject({ duplicate: false, seat_no: 2, match_status: 'filling' });
    expect(data(r, 'ledger')).toEqual([]);
  });
});

// ── 2. Walk-ins on a booked match (R4, R21, OM-11) ─────────────────────────

describe.skipIf(!docker)('desk_add_seat on a booked match: refills and a no-show taken over (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261b', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.courts(2);`,
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((g) => GUEST(g)),
      `select pg_temp.day(${STARTED});`,

      // BF: booked, three days out; g3 leaves after the booking (left_late).
      K('bf', `select pg_temp.mb('c1', ${at(3)})`),
      K('bf1', SEAT('bf', 1, 'account', 'g1')),
      K('bf2', SEAT('bf', 2, 'account', 'g2')),
      K('bf3', SEAT('bf', 3, 'account', 'g3')),
      K('bf4', SEAT('bf', 4, 'friend', 'g1')),
      E('bf_leave', 'g3', `select app.match_leave({{bf}})`),
      E('bf_add', 'desk', DADD('bf', { name: 'Walk In Three', key: 'da-bf' })),
      Q('ids_b', `select jsonb_build_object('bf3', {{bf3}})`),
      Q('bf_after', `select jsonb_build_object('state', pg_temp.state('bf'), 'wallet_g3', pg_temp.wallet('g3'),
          'events', (select jsonb_agg(e.type || ':' || e.actor order by e.id) from match_events e
                      where e.match_id = {{bf}} and e.type in ('refilled', 'joined')))`),
      Q('ledger_bf', `select pg_temp.ledger()`),

      // SB: started; g5 is marked no-show and a walk-in takes number 2.
      K('sb', `select pg_temp.mb('c2', ${STARTED})`),
      K('sb1', SEAT('sb', 1, 'account', 'g4')),
      K('sb2', SEAT('sb', 2, 'account', 'g5')),
      K('sb3', SEAT('sb', 3, 'account', 'g6')),
      K('sb4', SEAT('sb', 4, 'account', 'g7')),
      E('sb_mark', 'desk', MARK(['sb2'], 'no_show')),
      E('sb_detail_before', 'desk', DETAIL('sb')),
      E('sb_add', 'desk', DADD('sb', { name: 'Walk In Two', key: 'da-sb' })),
      E('sb_undo_replaced', 'desk', MARK(['sb2'], 'in')),
      E('sb_fix_replaced', 'desk', MARK(['sb2'], 'attended')),
      E('sb_detail_after', 'desk', DETAIL('sb')),
      Q('sb_state', `select jsonb_build_object('state', pg_temp.state('sb'), 'wallet_g5', pg_temp.wallet('g5'))`),
      Q('ledger_sb', `select pg_temp.ledger()`),

      // SL: started; g2's late leave was forfeited at the start; the desk
      // seats a walk-in in that place and the ticket comes back (situation 19).
      K('sl', `select pg_temp.mb('c3', ${STARTED})`),
      K('sl1', SEAT('sl', 1, 'account', 'g8')),
      K('sl2', SEAT('sl', 2, 'account', 'g2', 'left_late')),
      X(`select app.ticket_forfeit((select ticket_id from match_seats where id = {{sl2}}), {{sl2}})`),
      Q('sl_wallet_before', `select pg_temp.wallet('g2')`),
      E('sl_add', 'desk', DADD('sl', { name: 'Walk In Late', key: 'da-sl' })),
      Q('sl_after', `select jsonb_build_object('state', pg_temp.state('sl'), 'wallet_g2', pg_temp.wallet('g2'))`),
      Q('ledger_sl', `select pg_temp.ledger()`),

      // BO: booked, four days out; the organiser g6 leaves late, keeps the
      // organiser's part while the number is theirs, and the desk refills it:
      // the earliest account carrier left (g7, seated first) takes over (OM-34).
      K('bo', `select pg_temp.mb('c4', ${at(4)}, jsonb_build_object('organiser_id', {{g6}}))`),
      K('bo1', SEAT('bo', 1, 'account', 'g6')),
      K('bo2', SEAT('bo', 2, 'account', 'g7')),
      K('bo3', SEAT('bo', 3, 'account', 'g8')),
      K('bo4', SEAT('bo', 4, 'account', 'g4')),
      E('bo_leave', 'g6', `select app.match_leave({{bo}})`),
      Q('bo_org_late', `select to_jsonb(organiser_id = {{g6}}) from matches where id = {{bo}}`),
      E('bo_add', 'desk', DADD('bo', { name: 'Walk In Org', key: 'da-bo' })),
      Q('bo_after', `select jsonb_build_object('org_is_g7', (select organiser_id = {{g7}} from matches where id = {{bo}}),
          'events', (select jsonb_agg(e.type order by e.id) from match_events e where e.match_id = {{bo}}),
          'handover', (select e.data from match_events e where e.match_id = {{bo}} and e.type = 'organiser_changed'))`),
      Q('bo_ids', `select jsonb_build_object('g6', {{g6}}, 'g7', {{g7}})`),
      Q('ledger_bo', `select pg_temp.ledger()`),
      MONEY('money_b'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_b')).toEqual({});
  });

  it('OM-34: the desk refilling the organiser\'s late-left number hands the organiser\'s part over', () => {
    expect(data<Json>(r, 'bo_leave')).toMatchObject({ match_status: 'booked', organiser_changed: false });
    expect(data(r, 'bo_org_late')).toBe(true);
    expect(data<Json>(r, 'bo_add')).toMatchObject({ seat_no: 1, match_status: 'booked' });
    const after = data<{ org_is_g7: boolean; events: string[]; handover: Json }>(r, 'bo_after');
    const ids = data<Record<string, string>>(r, 'bo_ids');
    expect(after.org_is_g7).toBe(true);
    expect(after.events).toEqual(['left_late', 'refilled', 'joined', 'organiser_changed']);
    expect(after.handover).toEqual({ from_guest_id: ids.g6, to_guest_id: ids.g7 });
    expect(data(r, 'ledger_bo')).toEqual([]);
  });

  it('refills a late leaver before the start: the leaver is refilled and gets the ticket back (OM-11)', () => {
    expect(data<Json>(r, 'bf_leave')).toMatchObject({ match_status: 'booked' });
    const add = data<Json>(r, 'bf_add');
    expect(add).toMatchObject({ duplicate: false, seat_no: 3, match_status: 'booked' });
    expect(add.replaced_seat_id).toBe(data<Record<string, string>>(r, 'ids_b').bf3);
    const after = data<{ state: { seats: Json[] }; wallet_g3: Json; events: string[] }>(r, 'bf_after');
    // One transaction: the RPC's seat is stamped now() (the transaction's
    // start), the planted ones clock_timestamp(), so compare as a set.
    const three = after.state.seats.filter((s) => s.no === 3);
    expect(three).toHaveLength(2);
    expect(three).toEqual(expect.arrayContaining([
      { no: 3, kind: 'account', status: 'refilled', end_reason: 'refilled', ticket: 'available', guest: 'g3' },
      { no: 3, kind: 'desk', status: 'in', end_reason: null, ticket: null, guest: null },
    ]));
    expect(after.wallet_g3).toEqual({ available: 1 });
    expect(after.events).toEqual(['refilled:staff', 'joined:staff']);
    expect(data(r, 'ledger_bf')).toEqual([]);
  });

  it('after the start a walk-in takes a no-show\'s number: the no-show keeps its status and forfeit (R4, R21)', () => {
    const before = data<Json>(r, 'sb_detail_before');
    const noShow = (before.seats as Seat[]).find((s) => s.seat_no === 2 && s.status === 'no_show')!;
    expect(noShow).toMatchObject({ carrying: true, replaced_by_seat_id: null });
    expect(noShow.can).toMatchObject({ replace: true, mark_attended: true, unmark: true });
    expect((before.match as Json).can).toMatchObject({ add_seat: true });

    const add = data<Json>(r, 'sb_add');
    expect(add).toMatchObject({ duplicate: false, seat_no: 2, match_status: 'booked', replaced_seat_id: noShow.seat_id });
    expect(failed(r, 'sb_undo_replaced')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'replaced' });
    expect(failed(r, 'sb_fix_replaced')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'replaced' });

    const after = data<Json>(r, 'sb_detail_after');
    const old = seatOf(after, noShow.seat_id);
    expect(old).toMatchObject({ status: 'no_show', carrying: false, replaced_by_seat_id: add.seat_id });
    expect(old.can).toMatchObject({ replace: false, mark_attended: false, unmark: false });
    expect(seatOf(after, add.seat_id as string)).toMatchObject({ seat_no: 2, kind: 'desk', carrying: true, replaces_seat_id: noShow.seat_id });
    expect((after.match as Json).can).toMatchObject({ add_seat: false });
    expect(data<Json>(r, 'sb_state')).toMatchObject({ wallet_g5: { forfeited: 1 } });
    expect(data(r, 'ledger_sb')).toEqual([]);
  });

  it('a late leaver forfeited at the start is restored when the desk refills the seat (situation 19)', () => {
    expect(data(r, 'sl_wallet_before')).toEqual({ in_use: 1, forfeited: 1 });
    expect(data<Json>(r, 'sl_add')).toMatchObject({ seat_no: 2, match_status: 'booked' });
    const after = data<{ state: { seats: Json[] }; wallet_g2: Json }>(r, 'sl_after');
    expect(after.state.seats.filter((s) => s.no === 2).map((s) => [s.kind, s.status, s.ticket]).sort()).toEqual([
      ['account', 'refilled', 'available'], ['desk', 'in', null],
    ]);
    expect(after.wallet_g2).toEqual({ in_use: 1, available: 1 });
    expect(data(r, 'ledger_sl')).toEqual([]);
  });
});

// ── 3. Removals and cancel (the §4.7.6 table, §4.7.7) ──────────────────────

describe.skipIf(!docker)('desk_remove_seat and desk_cancel_match (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261c', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.courts(2);`,
      K('nil', `select '${NIL}'`),
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((g) => GUEST(g)),
      `select pg_temp.tickets('g1', 2);`, `select pg_temp.tickets('g2', 1);`,
      `select pg_temp.day(${STARTED});`,

      // F: g1 with a friend, g2 joined (filling).
      E('f_start', 'g1', START({ friends: '[{}]', key: 'k-f' })),
      KEPT('f', 'f_start', 'match_id'),
      E('f_join', 'g2', `select app.match_join({{f}})`),
      K('f1', `select id from match_seats where match_id = {{f}} and guest_id = {{g1}} and kind = 'account'`),
      K('f3', `select id from match_seats where match_id = {{f}} and guest_id = {{g2}}`),
      E('r_reason', 'desk', REMOVE('f3', 'rude')),
      E('r_long', 'desk', REMOVE('f3', `conduct: ${'x'.repeat(201)}`)),
      E('r_unknown', 'desk', REMOVE('nil', 'other')),
      E('r_cashier', 'cashier', REMOVE('f3', 'other')),
      E('r_conduct', 'desk', REMOVE('f1', 'conduct: shouting at the desk')),
      E('r_conduct_again', 'desk', REMOVE('f1', 'conduct')),
      Q('f_after', `select jsonb_build_object('state', pg_temp.state('f'), 'wallet_g1', pg_temp.wallet('g1'),
          'excluded', exists (select 1 from match_exclusions x where x.match_id = {{f}} and x.guest_id = {{g1}}
                                                               and x.reason = 'removed_by_staff'),
          'organiser_is_g2', (select m.organiser_id = {{g2}} from matches m where m.id = {{f}}),
          'audit', (select jsonb_agg(jsonb_build_object('reason', a.reason_code, 'code', a.after->>'reason'))
                      from audit_log a where a.action = 'match.desk_remove_seat' and a.entity_id = {{f1}}))`),
      E('f_rejoin', 'g1', `select app.match_join({{f}})`),
      Q('ledger_f', `select pg_temp.ledger()`),

      // W: waiting for a court; a removal sends it back to filling.
      K('w', `select pg_temp.m(jsonb_build_object('status', 'awaiting_court', 'start_at', ${at(5)}, 'organiser_id', {{g4}}))`),
      K('w1', SEAT('w', 1, 'account', 'g4')),
      K('w2', SEAT('w', 2, 'account', 'g5')),
      K('w3', SEAT('w', 3, 'account', 'g6')),
      K('w4', SEAT('w', 4, 'account', 'g7')),
      E('r_waiting', 'desk', REMOVE('w2', 'customer_request')),
      Q('w_after', `select jsonb_build_object('state', pg_temp.state('w'), 'wallet_g5', pg_temp.wallet('g5'))`),

      // E: the organiser's only seat; nobody is left and it ends (empty).
      K('e', `select pg_temp.m(jsonb_build_object('start_at', ${at(6)}, 'organiser_id', {{g8}}))`),
      K('e1', SEAT('e', 1, 'account', 'g8')),
      E('r_last', 'desk', REMOVE('e1', 'other')),
      Q('e_after', `select pg_temp.state('e')`),

      // BK: booked, before the start.
      K('bk', `select pg_temp.mb('c1', ${at(4)})`),
      K('bk1', SEAT('bk', 1, 'account', 'g1')),
      K('bk2', SEAT('bk', 2, 'account', 'g3')),
      K('bk3', SEAT('bk', 3, 'friend', 'g3')),
      K('bk4', SEAT('bk', 4, 'desk', null, 'in', WALKIN)),
      E('rb_late', 'desk', REMOVE('bk1', 'customer_request')),
      E('rb_late_again', 'desk', REMOVE('bk1', 'other')),
      E('rb_desk_error', 'desk', REMOVE('bk2', 'staff_error')),
      E('rb_mgr_error', 'manager', REMOVE('bk2', 'staff_error: booked twice')),
      E('rb_walkin', 'desk', REMOVE('bk4', 'other')),
      Q('bk_after', `select jsonb_build_object('state', pg_temp.state('bk'), 'wallet_g1', pg_temp.wallet('g1'),
          'wallet_g3', pg_temp.wallet('g3'))`),

      // SR: booked and started; PL: played.
      K('sr', `select pg_temp.mb('c2', ${STARTED})`),
      K('sr1', SEAT('sr', 1, 'account', 'g2')),
      K('sr2', SEAT('sr', 2, 'account', 'g4')),
      K('sr3', SEAT('sr', 3, 'account', 'g5', 'left')),
      E('rs_other', 'desk', REMOVE('sr1', 'other')),
      E('rs_ended', 'desk', REMOVE('sr3', 'other')),
      E('rs_mark', 'desk', MARK(['sr2'], 'attended')),
      E('rs_marked', 'manager', REMOVE('sr2', 'duplicate')),
      E('rs_dup', 'manager', REMOVE('sr1', 'duplicate')),
      K('pl', `select pg_temp.mb('c3', ${at(-5)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('pl1', SEAT('pl', 1, 'desk', null, 'in', WALKIN)),
      E('rs_match_ended', 'desk', REMOVE('pl1', 'other')),
      Q('ledger_rm', `select pg_temp.ledger()`),

      // desk_cancel_match on F (g2 still in, g6 asking to join).
      K('fq', `select pg_temp.req({{f}}, {{g6}})`),
      E('c_reason', 'desk', CANCEL('f', 'bored')),
      E('c_unknown', 'desk', CANCEL('nil', 'other')),
      E('c_booked', 'desk', CANCEL('bk', 'court_needed')),
      E('c_ok', 'desk', CANCEL('f', 'court_needed: the owner needs the court')),
      E('c_again', 'desk', CANCEL('f', 'other')),
      Q('c_after', `select jsonb_build_object('state', pg_temp.state('f'), 'wallet_g2', pg_temp.wallet('g2'),
          'wallet_g6', pg_temp.wallet('g6'),
          'audit', (select jsonb_agg(jsonb_build_object('reason', a.reason_code, 'after', a.after))
                      from audit_log a where a.action = 'match.desk_cancel' and a.entity_id = {{f}}))`),
      Q('ledger_end', `select pg_temp.ledger()`),
      MONEY('money_c'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_c')).toEqual({});
  });

  it('refuses a bad reason, a note over 200, an unknown seat, a cashier (R42)', () => {
    expect(failed(r, 'r_reason').code).toBe('REASON_REQUIRED');
    expect(failed(r, 'r_long')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_reason' });
    expect(failed(r, 'r_unknown').code).toBe('SEAT_NOT_FOUND');
    expect(failed(r, 'r_cashier').code).toBe('FORBIDDEN');
  });

  it('filling: the account seat takes its friend; tickets back; conduct excludes; handover; a replay', () => {
    const rm = data<Json>(r, 'r_conduct');
    expect(rm).toMatchObject({ duplicate: false, match_status: 'filling', ticket: 'released' });
    expect((rm.removed as Json[]).map((s) => s.status)).toEqual(['removed', 'removed']);
    expect(data<Json>(r, 'r_conduct_again')).toMatchObject({ duplicate: true, ticket: 'released' });
    expect((data<Json>(r, 'r_conduct_again').removed as Json[]).length).toBe(2);
    const after = data<{ state: { seats: Json[]; events: string[] }; wallet_g1: Json; excluded: boolean;
                         organiser_is_g2: boolean; audit: Json[] }>(r, 'f_after');
    expect(after.state.seats.filter((s) => s.guest === 'g1').map((s) => [s.kind, s.status, s.end_reason, s.ticket])).toEqual([
      ['account', 'removed', 'removed_by_staff', 'available'], ['friend', 'removed', 'removed_by_staff', 'available'],
    ]);
    expect(after.wallet_g1).toEqual({ available: 2 });
    expect(after.excluded).toBe(true);
    expect(after.organiser_is_g2).toBe(true);
    expect(after.state.events).toContain('removed:conduct');
    // R42: the code on the row, the event and the audit's after; the whole text in the audit row.
    expect(after.audit).toEqual([{ reason: 'conduct: shouting at the desk', code: 'conduct' }]);
    expect(failed(r, 'f_rejoin').code).toBe('MATCH_UNAVAILABLE');
    expect(data(r, 'ledger_f')).toEqual([]);
  });

  it('a removal sends a waiting match back to filling; the last seat out ends it (empty)', () => {
    expect(data<Json>(r, 'r_waiting')).toMatchObject({ match_status: 'filling', ticket: 'released' });
    expect(data<Json>(r, 'w_after')).toMatchObject({ state: { match: { status: 'filling' } }, wallet_g5: { available: 1 } });
    expect(data<Json>(r, 'r_last')).toMatchObject({ match_status: 'cancelled' });
    expect(data<Json>(r, 'e_after')).toMatchObject({ match: { status: 'cancelled', ended_reason: 'empty' } });
  });

  it('booked before the start: a late leave, a manager-only staff error, a walk-in with no ticket', () => {
    expect(data<Json>(r, 'rb_late')).toMatchObject({ duplicate: false, match_status: 'booked', ticket: 'locked_until_refill',
      removed: [{ status: 'left_late' }] });
    expect(data<Json>(r, 'rb_late_again')).toMatchObject({ duplicate: true, ticket: 'locked_until_refill' });
    expect(failed(r, 'rb_desk_error')).toMatchObject({ code: 'FORBIDDEN', detail: 'manager_required' });
    expect(data<Json>(r, 'rb_mgr_error')).toMatchObject({ ticket: 'released', removed: [{ status: 'removed' }, { status: 'removed' }] });
    expect(data<Json>(r, 'rb_walkin')).toMatchObject({ ticket: 'none', removed: [{ status: 'left_late' }] });
    const after = data<{ state: { seats: Json[] }; wallet_g1: Json; wallet_g3: Json }>(r, 'bk_after');
    expect(after.state.seats.map((s) => [s.no, s.status, s.end_reason])).toEqual([
      [1, 'left_late', 'removed_by_staff'], [2, 'removed', 'removed_by_staff'], [3, 'removed', 'removed_by_staff'],
      [4, 'left_late', 'removed_by_staff'],
    ]);
    // g1's ticket stays in use until a refill or the start; g3's come back.
    expect(after.wallet_g1).toEqual({ in_use: 1, available: 2 });
    expect(after.wallet_g3).toEqual({ available: 2 });
  });

  it('after the start: attendance, not removal, unless a manager fixes an error; marked, ended, match ended', () => {
    expect(failed(r, 'rs_other')).toMatchObject({ code: 'INVALID_TRANSITION', detail: 'use_attendance' });
    expect(failed(r, 'rs_ended')).toMatchObject({ code: 'INVALID_TRANSITION', detail: 'ended' });
    expect(failed(r, 'rs_marked')).toMatchObject({ code: 'INVALID_TRANSITION', detail: 'marked' });
    expect(data<Json>(r, 'rs_dup')).toMatchObject({ ticket: 'released', removed: [{ status: 'removed' }] });
    expect(failed(r, 'rs_match_ended')).toMatchObject({ code: 'INVALID_TRANSITION', detail: 'match_ended' });
    expect(data(r, 'ledger_rm')).toEqual([]);
  });

  it('desk_cancel_match: a filling match ends staff_cancelled, tickets and requests back; booked is refused', () => {
    expect(failed(r, 'c_reason').code).toBe('REASON_REQUIRED');
    expect(failed(r, 'c_unknown').code).toBe('MATCH_NOT_FOUND');
    expect(failed(r, 'c_booked').code).toBe('MATCH_NOT_FILLING');
    expect(data(r, 'c_ok')).toEqual({ match_id: data<Json>(r, 'f_start').match_id, status: 'cancelled', duplicate: false });
    expect(data<Json>(r, 'c_again')).toMatchObject({ status: 'cancelled', duplicate: true });
    const after = data<{ state: Json; wallet_g2: Json; wallet_g6: Json; audit: Json[] }>(r, 'c_after');
    expect(after.state).toMatchObject({ match: { status: 'cancelled', ended_reason: 'staff_cancelled' },
      requests: [{ status: 'expired' }] });
    // g2's own ticket back from F, and the one of the seat a manager removed in SR.
    expect(after.wallet_g2).toEqual({ available: 2 });
    // g6's request ticket is back; the one of g6's seat in W is still in use.
    expect(after.wallet_g6).toEqual({ in_use: 1, available: 1 });
    expect(after.audit).toEqual([{ reason: 'court_needed: the owner needs the court',
      after: { status: 'cancelled', reason: 'court_needed' } }]);
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});

// ── 4. Marks (the §4.7.8 table) ────────────────────────────────────────────

describe.skipIf(!docker)('mark_match_seats: marks, undo and corrections while the day is open (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261d', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.courts(2);`,
      K('nil', `select '${NIL}'`),
      ...['g1', 'g2', 'g3', 'g4', 'g5'].map((g) => GUEST(g)),
      `select pg_temp.day(${STARTED});`,
      `select pg_temp.day(${at(-2)}, 'closed');`,

      // MM: started: g1 and her friend, g2, a walk-in.
      K('mm', `select pg_temp.mb('c1', ${STARTED})`),
      K('m1', SEAT('mm', 1, 'account', 'g1')),
      K('m2', SEAT('mm', 2, 'friend', 'g1')),
      K('m3', SEAT('mm', 3, 'account', 'g2')),
      K('m4', SEAT('mm', 4, 'desk', null, 'in', WALKIN)),
      K('mfut', `select pg_temp.mb('c2', ${at(3)})`),
      K('mfut1', SEAT('mfut', 1, 'account', 'g3')),
      K('mfill', `select pg_temp.m(jsonb_build_object('start_at', ${at(4)}))`),
      K('mfill1', SEAT('mfill', 1, 'account', 'g4')),
      K('mpl', `select pg_temp.mb('c3', ${at(-5)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('mpl1', SEAT('mpl', 1, 'desk', null, 'in', WALKIN)),
      X(`select pg_temp.mark({{mpl1}}, 'attended')`),
      K('mcl', `select pg_temp.mb('c4', ${at(-2)})`),
      K('mcl1', SEAT('mcl', 1, 'desk', null, 'in', WALKIN)),

      // The refusals, in order.
      E('k_attendance', 'desk', MARK(['m1'], 'late')),
      E('k_empty', 'desk', `select app.mark_match_seats('{}'::uuid[], 'attended')`),
      E('k_five', 'desk', MARK(['m1', 'm2', 'm3', 'm4', 'mfut1'], 'attended')),
      E('k_dup', 'desk', MARK(['m1', 'm1'], 'attended')),
      E('k_two', 'desk', MARK(['m1', 'mfut1'], 'attended')),
      E('k_unknown', 'desk', MARK(['nil'], 'attended')),
      E('k_cashier', 'cashier', MARK(['m1'], 'attended')),
      E('k_filling', 'desk', MARK(['mfill1'], 'attended')),
      E('k_not_started', 'desk', MARK(['mfut1'], 'no_show')),
      E('k_day_closed', 'desk', MARK(['mcl1'], 'attended')),
      E('k_played_undo', 'desk', MARK(['mpl1'], 'in')),

      // Arrived, again (a no-op), undo.
      E('k_arrive', 'desk', MARK(['m1'], 'attended')),
      Q('k_arrive_state', `select jsonb_build_object('state', pg_temp.state('mm'), 'ledger', pg_temp.ledger(),
          'booking', (select r.status from reservations r join matches m on m.reservation_id = r.id where m.id = {{mm}}))`),
      E('k_arrive_again', 'desk', MARK(['m1'], 'attended')),
      E('k_undo', 'desk', MARK(['m1'], 'in')),
      Q('k_undo_state', `select jsonb_build_object('ledger', pg_temp.ledger(),
          'seat', (select jsonb_build_object('status', s.status, 'marked_at', s.marked_at, 'marked_by', s.marked_by_staff_id,
                                             'ticket', k.status)
                     from match_seats s join match_tickets k on k.id = s.ticket_id where s.id = {{m1}}),
          'events', (select jsonb_agg(e.type || ':' || coalesce(e.code, '-') order by e.id) from match_events e
                      where e.match_id = {{mm}} and e.seat_id = {{m1}}))`),

      // No-show, corrections both ways, the undo of a no-show.
      E('k_no_show', 'desk', MARK(['m3'], 'no_show')),
      E('k_fix', 'desk', MARK(['m3'], 'attended')),
      E('k_no_show_again', 'desk', MARK(['m3'], 'no_show')),
      E('k_undo_no_show', 'desk', MARK(['m3'], 'in')),
      Q('k_m3', `select jsonb_build_object('ledger', pg_temp.ledger(),
          'tickets', (select jsonb_agg(e.type || coalesce(':' || e.code, '') order by e.id) from match_ticket_events e
                       where e.ticket_id = (select ticket_id from match_seats where id = {{m3}})))`),

      // C18: a seat with a payment linked is never a no-show.
      X(`select pg_temp.paid({{m4}})`),
      E('k_paid', 'desk', MARK(['m4'], 'no_show')),
      E('k_m4_arrive', 'desk', MARK(['m4'], 'attended')),

      // R9: the ticket that came back is reserved elsewhere.
      E('k_arrive_both', 'desk', MARK(['m1', 'm2'], 'attended')),
      K('other', `select pg_temp.m(jsonb_build_object('start_at', ${at(8)}, 'organiser_id', {{g2}}, 'join_policy', 'approve'))`),
      K('oq', `select pg_temp.reserve({{other}}, {{g1}}, (select ticket_id from match_seats where id = {{m1}}))`),
      E('k_used_undo', 'desk', MARK(['m1'], 'in')),
      E('k_used_no_show', 'desk', MARK(['m1'], 'no_show')),
      E('k_detail', 'desk', DETAIL('mm')),
      Q('k_ledger', `select pg_temp.ledger()`),

      // MN: all no-show ends the match and its booking; a correction reopens
      // both; a court re-sold since refuses the reopening.
      K('mn', `select pg_temp.mb('c2', ${STARTED})`),
      K('n1', SEAT('mn', 1, 'account', 'g5')),
      K('n2', SEAT('mn', 2, 'desk', null, 'in', WALKIN)),
      E('n_all', 'desk', MARK(['n1', 'n2'], 'no_show')),
      Q('n_all_state', `select jsonb_build_object('state', pg_temp.state('mn'), 'wallet_g5', pg_temp.wallet('g5'),
          'booking', (select jsonb_build_object('status', r.status, 'reason', r.cancellation_reason, 'ended', r.cancelled_at is not null)
                        from reservations r join matches m on m.reservation_id = r.id where m.id = {{mn}}))`),
      E('n_reopen', 'desk', MARK(['n2'], 'attended')),
      Q('n_reopen_state', `select jsonb_build_object('state', pg_temp.state('mn'),
          'booking', (select jsonb_build_object('status', r.status, 'reason', r.cancellation_reason, 'ended', r.cancelled_at is not null)
                        from reservations r join matches m on m.reservation_id = r.id where m.id = {{mn}}),
          'data', (select e.data from match_events e where e.match_id = {{mn}} and e.type = 'seat_attended' order by e.id desc limit 1))`),
      E('n_all_again', 'desk', MARK(['n2'], 'no_show')),
      X(`select pg_temp.res('c2', ${STARTED}, 90)`),
      E('n_reused', 'desk', MARK(['n1'], 'attended')),
      Q('n_reused_state', `select jsonb_build_object('match', (select m.status from matches m where m.id = {{mn}}),
          'seat', (select s.status from match_seats s where s.id = {{n1}}), 'wallet_g5', pg_temp.wallet('g5'))`),
      Q('ledger_end', `select pg_temp.ledger()`),
      MONEY('money_d'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_d')).toEqual({});
  });

  it('refuses in the §4.7.8 order, each code with its detail', () => {
    expect(failed(r, 'k_attendance')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_attendance' });
    for (const l of ['k_empty', 'k_five', 'k_dup', 'k_two']) {
      expect(failed(r, l)).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_seat_ids' });
    }
    expect(failed(r, 'k_unknown').code).toBe('SEAT_NOT_FOUND');
    expect(failed(r, 'k_cashier').code).toBe('FORBIDDEN');
    expect(failed(r, 'k_filling').code).toBe('MATCH_NOT_BOOKED');
    expect(failed(r, 'k_not_started').code).toBe('SEAT_NOT_STARTED');
    expect(failed(r, 'k_day_closed')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'day_closed' });
    // R16: no undo once the match has ended.
    expect(failed(r, 'k_played_undo')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'match_ended' });
  });

  it('arrived releases the ticket and turns the booking arrived; again is a no-op; undo locks it again (R9)', () => {
    const a = data<Json>(r, 'k_arrive');
    expect(a).toMatchObject({ match_status: 'booked', reservation_status: 'arrived' });
    expect(a.seats).toEqual([{ seat_id: expect.any(String), status: 'attended', ticket_status: 'released' }]);
    const st = data<{ state: { seats: Json[] }; ledger: string[]; booking: string }>(r, 'k_arrive_state');
    expect(st.state.seats[0]).toMatchObject({ no: 1, status: 'attended', ticket: 'available' });
    expect(st.booking).toBe('arrived');
    expect(st.ledger).toEqual([]);
    expect(data<Json>(r, 'k_arrive_again')).toMatchObject({ seats: [{ status: 'attended' }] });
    expect(data<Json>(r, 'k_undo')).toMatchObject({ reservation_status: 'arrived', seats: [{ status: 'in', ticket_status: 'in_use' }] });
    expect(data(r, 'k_undo_state')).toMatchObject({
      ledger: [], seat: { status: 'in', marked_at: null, marked_by: null, ticket: 'in_use' },
      // one seat_attended for the first mark (the second was a no-op), one seat_unmarked
      events: ['seat_attended:in', 'seat_unmarked:attended'],
    });
  });

  it('no-show forfeits; corrections restore and forfeit again; the undo of a no-show locks it back', () => {
    expect(data<Json>(r, 'k_no_show')).toMatchObject({ seats: [{ status: 'no_show', ticket_status: 'forfeited' }] });
    expect(data<Json>(r, 'k_fix')).toMatchObject({ seats: [{ status: 'attended', ticket_status: 'released' }] });
    expect(data<Json>(r, 'k_no_show_again')).toMatchObject({ seats: [{ status: 'no_show', ticket_status: 'forfeited' }] });
    expect(data<Json>(r, 'k_undo_no_show')).toMatchObject({ seats: [{ status: 'in', ticket_status: 'in_use' }] });
    expect(data(r, 'k_m3')).toEqual({
      ledger: [],
      tickets: ['bought', 'locked', 'forfeited:no_show', 'restored', 'forfeited:no_show', 'restored:relocked'],
    });
  });

  it('refuses a paid seat as a no-show (C18) and a ticket used elsewhere (R9, situation 15)', () => {
    expect(failed(r, 'k_paid')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'paid' });
    expect(data<Json>(r, 'k_m4_arrive')).toMatchObject({ seats: [{ status: 'attended', ticket_status: null }] });
    expect(failed(r, 'k_used_undo')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'ticket_used' });
    expect(failed(r, 'k_used_no_show')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'ticket_used' });
    expect(data(r, 'k_ledger')).toEqual([]);
  });

  it('the seat can flags follow the marks (operator.md §5.6.3)', () => {
    const d = data<Json>(r, 'k_detail');
    const byNo = (no: number) => (d.seats as Seat[]).find((s) => s.seat_no === no && s.carrying)!;
    expect(byNo(1)).toMatchObject({ status: 'attended', ticket: { status: 'released' } });
    expect(byNo(1).can).toMatchObject({ mark_attended: false, mark_no_show: false, unmark: false, replace: false,
      remove_reasons: [], take_share: true, write_off: true });
    expect(byNo(2)).toMatchObject({ kind: 'friend', status: 'attended' });
    expect(byNo(2).can).toMatchObject({ mark_no_show: true, unmark: true });
    expect(byNo(3)).toMatchObject({ status: 'in', ticket: { status: 'in_use' } });
    expect(byNo(3).can).toMatchObject({ mark_attended: true, mark_no_show: true, unmark: false, remove_reasons: [] });
    expect(byNo(4)).toMatchObject({ kind: 'desk', status: 'attended', ticket: null });
    expect(byNo(4).can).toMatchObject({ mark_no_show: false, unmark: true, take_share: false });
    expect(byNo(4).money).toMatchObject({ paid_desk_iqd: 10000, owed_iqd: 0 });
    expect(d.match).toMatchObject({ status: 'booked', started: true, marks_open: true, reservation_status: 'arrived',
      can: { add_seat: false, cancel: false, call_off: false } });
  });

  it('all no-show ends the match and its booking; a correction reopens both; a re-sold court refuses it', () => {
    expect(data<Json>(r, 'n_all')).toMatchObject({ match_status: 'no_show', reservation_status: 'no_show' });
    expect(data(r, 'n_all_state')).toMatchObject({
      state: { match: { status: 'no_show', ended_reason: 'all_no_show' },
               events: ['seat_no_show:in', 'seat_no_show:in', 'no_show:all_no_show'] },
      wallet_g5: { forfeited: 1 },
      booking: { status: 'no_show', reason: 'all_no_show', ended: true },
    });
    expect(data<Json>(r, 'n_reopen')).toMatchObject({ match_status: 'booked', reservation_status: 'arrived' });
    expect(data(r, 'n_reopen_state')).toMatchObject({
      state: { match: { status: 'booked', ended_reason: null } },
      booking: { status: 'arrived', reason: null, ended: false },
      data: { reopened: true },
    });
    expect(data<Json>(r, 'n_all_again')).toMatchObject({ match_status: 'no_show' });
    expect(failed(r, 'n_reused')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'court_reused' });
    expect(data(r, 'n_reused_state')).toEqual({ match: 'no_show', seat: 'no_show', wallet_g5: { forfeited: 1 } });
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});

// ── 5. Call-off short (OM-47, R12, R39) ─────────────────────────────────────

describe.skipIf(!docker)('desk_call_off_short (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261e', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.courts(2);`,
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9'].map((g) => GUEST(g)),
      `select pg_temp.day(${STARTED});`,
      `select pg_temp.day(${at(-2)}, 'closed');`,

      // C1: two came, one no-show, one not marked yet.
      K('c1m', `select pg_temp.mb('c1', ${STARTED})`),
      K('c1s1', SEAT('c1m', 1, 'account', 'g1')),
      K('c1s2', SEAT('c1m', 2, 'account', 'g2')),
      K('c1s3', SEAT('c1m', 3, 'account', 'g3')),
      K('c1s4', SEAT('c1m', 4, 'account', 'g4')),
      E('co_mark_a', 'desk', MARK(['c1s1', 'c1s2'], 'attended')),
      E('co_mark_n', 'desk', MARK(['c1s3'], 'no_show')),
      E('co_unmarked', 'desk', CALLOFF('c1m')),
      E('co_detail_before', 'desk', DETAIL('c1m')),
      E('co_mark_last', 'desk', MARK(['c1s4'], 'attended')),
      E('co_detail', 'desk', DETAIL('c1m')),
      E('co_ok', 'desk', CALLOFF('c1m')),
      Q('co_state', `select jsonb_build_object('state', pg_temp.state('c1m'),
          'booking', (select jsonb_build_object('status', r.status, 'by', r.cancelled_by, 'reason', r.cancellation_reason,
                                                'ended', r.cancelled_at is not null)
                        from reservations r join matches m on m.reservation_id = r.id where m.id = {{c1m}}),
          'wallets', jsonb_build_array(pg_temp.wallet('g1'), pg_temp.wallet('g2'), pg_temp.wallet('g3'), pg_temp.wallet('g4')),
          'audit', (select count(*) from audit_log a where a.action = 'match.call_off_short' and a.entity_id = {{c1m}}))`),
      E('co_again', 'desk', CALLOFF('c1m')),
      Q('co_ledger', `select pg_temp.ledger()`),

      // C2 (R39): three came, the fourth left late and nobody took the seat.
      K('c2m', `select pg_temp.mb('c2', ${STARTED})`),
      K('c2s1', SEAT('c2m', 1, 'account', 'g5')),
      K('c2s2', SEAT('c2m', 2, 'account', 'g6')),
      K('c2s3', SEAT('c2m', 3, 'account', 'g7')),
      K('c2s4', SEAT('c2m', 4, 'account', 'g8', 'left_late')),
      E('co2_mark', 'desk', MARK(['c2s1', 'c2s2', 'c2s3'], 'attended')),
      E('co2_ok', 'desk', CALLOFF('c2m')),
      Q('co2_state', `select jsonb_build_object('wallet_g8', pg_temp.wallet('g8'),
          'g8_last', (select e.type || ':' || e.code from match_ticket_events e
                       where e.ticket_id = (select ticket_id from match_seats where id = {{c2s4}}) order by e.id desc limit 1))`),
      Q('co2_ledger', `select pg_temp.ledger()`),

      // C3: everyone who carries a seat came (two numbers vacant): not short.
      K('c3m', `select pg_temp.mb('c3', ${STARTED})`),
      K('c3s1', SEAT('c3m', 1, 'desk', null, 'in', WALKIN)),
      K('c3s2', SEAT('c3m', 2, 'desk', null, 'in', WALKIN)),
      E('co3_mark', 'desk', MARK(['c3s1', 'c3s2'], 'attended')),
      E('co3_not_short', 'desk', CALLOFF('c3m')),

      // C4: only a late leaver carries: nobody came.
      K('c4m', `select pg_temp.mb('c4', ${STARTED})`),
      K('c4s1', SEAT('c4m', 1, 'account', 'g9', 'left_late')),
      E('co4_nobody', 'desk', CALLOFF('c4m')),

      // Not booked, not started, day closed.
      K('c5m', `select pg_temp.m(jsonb_build_object('start_at', ${at(4)}))`),
      E('co5_filling', 'desk', CALLOFF('c5m')),
      K('c6m', `select pg_temp.mb('c1', ${at(4)})`),
      E('co6_future', 'desk', CALLOFF('c6m')),
      K('c7m', `select pg_temp.mb('c2', ${at(-2)})`),
      E('co7_closed', 'desk', CALLOFF('c7m')),
      MONEY('money_e'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_e')).toEqual({});
  });

  it('R12: every carrier is marked first; then the match and its booking are called off', () => {
    expect(failed(r, 'co_unmarked')).toMatchObject({ code: 'MATCH_MARK_SEATS', detail: '1' });
    expect((data<Json>(r, 'co_detail_before').match as Json).can).toMatchObject({ call_off: false });
    const d = data<Json>(r, 'co_detail');
    expect((d.match as Json).can).toMatchObject({ call_off: true, add_seat: true });
    expect((d.money as Json).phase).toBe('started');
    expect(data(r, 'co_ok')).toEqual({ match_id: data<Json>(r, 'co_ok').match_id, status: 'cancelled',
      reservation_status: 'cancelled', attended: 3, no_show: 1, duplicate: false });
    expect(data(r, 'co_state')).toMatchObject({
      state: { match: { status: 'cancelled', ended_reason: 'called_off_short' } },
      booking: { status: 'cancelled', by: 'staff', reason: 'called_off_short', ended: true },
      // OM-47: those who came keep their tickets; the no-show lost theirs at the mark.
      wallets: [{ available: 1 }, { available: 1 }, { forfeited: 1 }, { available: 1 }],
      audit: 1,
    });
    expect(data<Json>(r, 'co_again')).toMatchObject({ status: 'cancelled', duplicate: true, attended: 3, no_show: 1 });
    expect(data(r, 'co_ledger')).toEqual([]);
  });

  it('R39: a late leaver nobody replaced counts as absent; match_end forfeits the ticket', () => {
    expect(data<Json>(r, 'co2_ok')).toMatchObject({ status: 'cancelled', attended: 3, no_show: 1 });
    expect(data(r, 'co2_state')).toEqual({ wallet_g8: { forfeited: 1 }, g8_last: 'forfeited:late_leave' });
    expect(data(r, 'co2_ledger')).toEqual([]);
  });

  it('refuses not short, nobody came, not booked, not started, a closed day', () => {
    expect(failed(r, 'co3_not_short')).toMatchObject({ code: 'INVALID_TRANSITION', detail: 'not_short' });
    expect(failed(r, 'co4_nobody')).toMatchObject({ code: 'INVALID_TRANSITION', detail: 'nobody_came' });
    expect(failed(r, 'co5_filling').code).toBe('MATCH_NOT_BOOKED');
    expect(failed(r, 'co6_future').code).toBe('MATCH_NOT_STARTED');
    expect(failed(r, 'co7_closed')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'day_closed' });
  });
});

// ── 6. Bans (R35, R40), flags, gender ──────────────────────────────────────

describe.skipIf(!docker)('set_match_ban, set_customer_flags, staff_set_customer_gender (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261f', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.branch2();`,
      K('nil', `select '${NIL}'`),
      GUEST('g1', '{"given":"Sara","family":"Karim"}'),
      GUEST('gu', '{"gender":null}'),
      GUEST('gd'), X(`update profiles set deleted_at = now() where id = {{gd}}`),
      `select pg_temp.tickets('g1', 2);`,
      K('mt', `select pg_temp.m(jsonb_build_object('start_at', ${at(3)}, 'organiser_id', {{gu}}))`),
      K('mt1', SEAT('mt', 1, 'account', 'g1', 'in', '{"gender":"female"}')),

      E('b_desk', 'desk', BAN('g1', 'true', 'conduct')),
      E('b_null', 'manager', BAN('g1', 'null', 'conduct')),
      E('b_long', 'manager', BAN('g1', 'true', `conduct: ${'x'.repeat(201)}`)),
      E('b_unknown', 'manager', BAN('nil', 'true', 'conduct')),
      E('b_deleted', 'manager', BAN('gd', 'true', 'conduct')),
      E('b_reason', 'manager', BAN('g1', 'true', 'rude')),
      E('b_ok', 'manager', BAN('g1', 'true', 'no_shows: missed three games')),
      Q('b_audit', `select jsonb_agg(jsonb_build_object('reason', a.reason_code, 'after', a.after))
          from audit_log a where a.action = 'customer.match_ban' and a.entity_id = {{g1}}`),
      E('b_again', 'owner', BAN('g1', 'true', 'conduct')),
      // R40: every branch, from the next statement.
      E('b_start_v', 'g1', START({ key: 'k-b1' })),
      E('b_start_v2', 'g1', `select app.match_start({{v2}}, {{c21}}, ${at(3)}, 90, 'open', 'public', 'open', '[]'::jsonb, 40000, 'k-b2')`),
      // A desk flag edit never lifts a ban; the ban is not a desk flag.
      E('f_desk', 'desk', `select app.set_customer_flags({{g1}}, '[{"type":"vip","label":"Regular"}]'::jsonb)`),
      E('f_ban', 'desk', `select app.set_customer_flags({{g1}}, '[{"type":"match_ban","label":"other"}]'::jsonb)`),
      E('f_clear', 'desk', `select app.set_customer_flags({{g1}}, '[]'::jsonb)`),
      E('b_lift', 'manager', BAN('g1', 'false', null)),
      E('b_lift_again', 'manager', BAN('g1', 'false', null)),

      E('gd_cashier', 'cashier', GENDER('gu', 'male')),
      E('gd_value', 'desk', GENDER('gu', 'x')),
      E('gd_unknown', 'desk', GENDER('nil', 'male')),
      E('gd_deleted', 'desk', GENDER('gd', 'male')),
      E('gd_set', 'desk', GENDER('gu', 'male')),
      Q('gd_profile', `select jsonb_build_object('gender', p.gender, 'by', p.gender_set_by, 'at', p.gender_set_at is not null)
          from profiles p where p.id = {{gu}}`),
      E('gd_same', 'manager', GENDER('gu', 'male')),
      E('gd_g1', 'desk', GENDER('g1', 'male')),
      Q('gd_seat', `select to_jsonb(s.gender) from match_seats s where s.id = {{mt1}}`),
      E('gd_clear', 'desk', GENDER('gu', null)),
      Q('gd_cleared', `select jsonb_build_object('gender', p.gender, 'by', p.gender_set_by, 'at', p.gender_set_at is not null)
          from profiles p where p.id = {{gu}}`),
      Q('gd_audit', `select to_jsonb(count(*)) from audit_log a where a.action = 'customer.gender_set' and a.entity_id = {{gu}}`),
      // The audit rows say who set it, never the value: audit_log is
      // append-only and outlives an account deletion (R29, 0256's rule).
      Q('gd_audit_rows', `select jsonb_agg(jsonb_build_object('before', a.before, 'after', a.after) order by a.at, a.id)
          from audit_log a where a.action = 'customer.gender_set' and a.entity_id in ({{gu}}, {{g1}})`),
      Q('gd_audit_values', `select to_jsonb(count(*)) from audit_log a
          where a.entity_id in ({{gu}}, {{g1}})
            and (a.before ? 'gender' or a.after ? 'gender' or a.before::text ~ 'male' or a.after::text ~ 'male')`),
    ]);
  });

  it('refuses in the §4.7.10 order', () => {
    expect(failed(r, 'b_desk').code).toBe('FORBIDDEN');
    expect(failed(r, 'b_null')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_banned' });
    expect(failed(r, 'b_long')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_reason' });
    expect(failed(r, 'b_unknown').code).toBe('CUSTOMER_NOT_FOUND');
    expect(failed(r, 'b_deleted').code).toBe('CUSTOMER_NOT_FOUND');
    expect(failed(r, 'b_reason').code).toBe('REASON_REQUIRED');
  });

  it('bans with the code on the flag and the whole text in the audit row (R35, R42); the same state is a duplicate', () => {
    expect(data<Json>(r, 'b_ok')).toMatchObject({ banned: true, duplicate: false,
      flags: [{ type: 'match_ban', label: 'no_shows' }] });
    expect(data(r, 'b_audit')).toEqual([{ reason: 'no_shows: missed three games',
      after: { banned: true, reason: 'no_shows' } }]);
    expect(data<Json>(r, 'b_again')).toMatchObject({ banned: true, duplicate: true });
  });

  it('R40: the ban holds at every branch', () => {
    expect(failed(r, 'b_start_v').code).toBe('MATCH_BANNED');
    expect(failed(r, 'b_start_v2').code).toBe('MATCH_BANNED');
  });

  it('set_customer_flags carries the ban over and refuses to write one', () => {
    expect(data(r, 'f_desk')).toEqual([{ type: 'match_ban', label: 'no_shows' }, { type: 'vip', label: 'Regular' }]);
    expect(failed(r, 'f_ban')).toMatchObject({ code: 'INVALID_FLAG', detail: 'match_ban', hint: 'use set_match_ban' });
    expect(data(r, 'f_clear')).toEqual([{ type: 'match_ban', label: 'no_shows' }]);
    expect(data<Json>(r, 'b_lift')).toMatchObject({ banned: false, duplicate: false, flags: [] });
    expect(data<Json>(r, 'b_lift_again')).toMatchObject({ banned: false, duplicate: true });
  });

  it('the desk corrects a gender (all three columns), clears it, and seats keep what they were stamped with', () => {
    expect(failed(r, 'gd_cashier').code).toBe('FORBIDDEN');
    expect(failed(r, 'gd_value')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_gender' });
    expect(failed(r, 'gd_unknown').code).toBe('CUSTOMER_NOT_FOUND');
    expect(failed(r, 'gd_deleted').code).toBe('CUSTOMER_NOT_FOUND');
    expect(data(r, 'gd_set')).toEqual({ customer_id: expect.any(String), gender: 'male', gender_set_by: 'staff', duplicate: false });
    expect(data(r, 'gd_profile')).toEqual({ gender: 'male', by: 'staff', at: true });
    expect(data<Json>(r, 'gd_same')).toMatchObject({ gender: 'male', duplicate: true });
    expect(data<Json>(r, 'gd_g1')).toMatchObject({ gender: 'male', duplicate: false });
    expect(data(r, 'gd_seat')).toBe('female');
    expect(data<Json>(r, 'gd_clear')).toMatchObject({ gender: null, gender_set_by: null, duplicate: false });
    expect(data(r, 'gd_cleared')).toEqual({ gender: null, by: null, at: false });
    expect(data(r, 'gd_audit')).toBe(2);
  });

  it('the gender audit rows carry who set it, never the value (R29)', () => {
    expect(data(r, 'gd_audit_rows')).toEqual(expect.arrayContaining([
      { before: { gender_set_by: null, had_gender: false }, after: { gender_set_by: 'staff', cleared: false } },
      { before: { gender_set_by: 'guest', had_gender: true }, after: { gender_set_by: 'staff', cleared: false } },
      { before: { gender_set_by: 'staff', had_gender: true }, after: { gender_set_by: null, cleared: true } },
    ]));
    expect(data(r, 'gd_audit_rows')).toHaveLength(3);
    expect(data(r, 'gd_audit_values')).toBe(0);
  });
});

// ── 7. The reports queue (§4.7.12) ─────────────────────────────────────────

describe.skipIf(!docker)('match_reports_open and resolve_match_report (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261g', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.branch2();`,
      K('nil', `select '${NIL}'`),
      GUEST('g1'),
      GUEST('rep1', '{"given":"Noor","family":"Salem","phone":"+9647711110009"}'),
      GUEST('rep2'),
      GUEST('bad', '{"given":"Omar","family":"Khalid","phone":"+9647711110010"}'),
      GUEST('bad2'),
      K('m1', `select pg_temp.m(jsonb_build_object('start_at', ${at(3)}, 'organiser_id', {{rep1}}))`),
      K('m1s', SEAT('m1', 1, 'account', 'bad')),
      K('msb', `select pg_temp.m(jsonb_build_object('start_at', ${at(4)}, 'organiser_id', {{rep1}}, 'sandbox', true))`),
      K('msbs', SEAT('msb', 1, 'account', 'bad')),
      K('mo', `select pg_temp.m(jsonb_build_object('venue_id', {{v2}}, 'price_court_id', {{c21}}, 'rate_rule_id', null,
                                                    'start_at', ${at(3)}, 'organiser_id', {{rep1}}))`),
      K('mos', SEAT('mo', 1, 'account', 'bad2')),
      K('r_old', `select pg_temp.report({{m1}}, {{rep1}}, {{bad}}, {{m1s}}, 'harassment', now() - interval '2 hours')`),
      K('r_new', `select pg_temp.report({{m1}}, {{rep2}}, {{bad}}, {{m1s}}, 'no_show', now() - interval '1 hour')`),
      K('r_sb', `select pg_temp.report({{msb}}, {{rep1}}, {{bad}}, {{msbs}}, 'other')`),
      K('r_v2', `select pg_temp.report({{mo}}, {{rep1}}, {{bad2}}, {{mos}}, 'other')`),

      E('q_desk', 'desk', `select app.match_reports_open({{v}})`),
      E('q_other', 'manager', `select app.match_reports_open({{v2}})`),
      E('q_list', 'manager', `select app.match_reports_open({{v}})`),
      E('x_outcome', 'manager', RESOLVE('r_old', 'ban')),
      E('x_unknown', 'manager', RESOLVE('nil', 'dismissed')),
      E('x_sandbox', 'manager', RESOLVE('r_sb', 'dismissed')),
      E('x_other', 'manager', RESOLVE('r_v2', 'dismissed')),
      E('x_desk', 'desk', RESOLVE('r_old', 'dismissed')),
      E('x_dismiss', 'manager', RESOLVE('r_old', 'dismissed')),
      E('x_dismiss_again', 'manager', RESOLVE('r_old', 'dismissed')),
      E('x_closed', 'owner', RESOLVE('r_old', 'banned')),
      E('x_ban', 'manager', RESOLVE('r_new', 'banned')),
      E('x_ban_again', 'owner', RESOLVE('r_new', 'banned')),
      Q('x_rows', `select jsonb_agg(jsonb_build_object('status', r.status, 'by_manager', r.reviewed_by = {{manager}},
          'at', r.reviewed_at is not null) order by r.created_at) from match_reports r where r.id in ({{r_old}}, {{r_new}})`),
      Q('x_flag', `select app.customer_flags_json({{bad}})`),
      E('q_after', 'manager', `select app.match_reports_open({{v}})`),
    ]);
  });

  it('the queue: manager and owner, the branch only, oldest first, sandbox never, operator.md §5.6.4 keys', () => {
    expect(failed(r, 'q_desk').code).toBe('FORBIDDEN');
    expect(failed(r, 'q_other').code).toBe('FORBIDDEN');
    const list = data<Json[]>(r, 'q_list');
    expect(list.map((x) => x.reason)).toEqual(['harassment', 'no_show']);
    for (const x of list) expect(keys(x)).toEqual(REPORT_KEYS);
    const first = list[0]!;
    expect(keys(first.match)).toEqual(sorted(['id', 'start_at', 'category', 'status', 'reservation_id']));
    expect(keys(first.reported)).toEqual(sorted(['customer_id', 'full_name', 'phone', 'flags', 'banned', 'reports_90d', 'no_shows']));
    expect(keys(first.reporter)).toEqual(sorted(['customer_id', 'full_name']));
    expect(first).toMatchObject({
      reported: { full_name: 'Omar Khalid', phone: '+9647711110010', flags: [], banned: false, reports_90d: 2, no_shows: 0 },
      reporter: { full_name: 'Noor Salem' },
      match: { status: 'filling', category: 'open', reservation_id: null },
    });
  });

  it('resolves: refusals, dismiss, duplicate, closed, ban with reason reported', () => {
    expect(failed(r, 'x_outcome')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_outcome' });
    for (const l of ['x_unknown', 'x_sandbox', 'x_other']) expect(failed(r, l).code).toBe('REPORT_NOT_FOUND');
    expect(failed(r, 'x_desk').code).toBe('FORBIDDEN');
    expect(data<Json>(r, 'x_dismiss')).toMatchObject({ status: 'dismissed', duplicate: false, banned: false });
    expect(data<Json>(r, 'x_dismiss_again')).toMatchObject({ status: 'dismissed', duplicate: true });
    expect(failed(r, 'x_closed')).toMatchObject({ code: 'REPORT_CLOSED', detail: 'dismissed' });
    expect(data<Json>(r, 'x_ban')).toMatchObject({ status: 'actioned', duplicate: false, banned: true });
    expect(data<Json>(r, 'x_ban_again')).toMatchObject({ status: 'actioned', duplicate: true, banned: true });
    expect(data(r, 'x_rows')).toEqual([{ status: 'dismissed', by_manager: true, at: true }, { status: 'actioned', by_manager: true, at: true }]);
    expect(data(r, 'x_flag')).toEqual([{ type: 'match_ban', label: 'reported' }]);
    expect(data(r, 'q_after')).toEqual([]);
  });
});

// ── 8. The read shapes (operator.md §5.6) and visibility ────────────────────

describe.skipIf(!docker)('desk_open_matches, desk_match_states, desk_match_detail (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261h', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.branch2();`,
      K('nil', `select '${NIL}'`),
      ...['g1', 'g2', 'g3', 'g4', 'g5'].map((g) => GUEST(g)),
      `select pg_temp.day(${STARTED});`,
      X(`select set_config('app.venue_id', {{v}}, true)`),

      E('h_start', 'desk', DSTART({ when: at(1), name: 'Walk In', phone: '+9647712345670', gender: 'male', extra: 1, key: 'dk-h' })),
      KEPT('hf', 'h_start', 'match_id'),
      K('hw', `select pg_temp.m(jsonb_build_object('status', 'awaiting_court', 'start_at', ${at(1, 3)}))`),
      K('hb', `select pg_temp.mb('c1', ${at(2)})`),
      K('hb1', SEAT('hb', 1, 'account', 'g1')),
      K('hb2', SEAT('hb', 2, 'friend', 'g1')),
      K('hb3', SEAT('hb', 3, 'account', 'g3')),
      K('hb4', SEAT('hb', 4, 'account', 'g4', 'left_late')),
      K('hfull', `select pg_temp.mb('c2', ${at(2, 3)})`),
      X(`select ${[1, 2, 3, 4].map((n) => `pg_temp.seat({{hfull}}, ${n}, 'desk', null, 'in', '${WALKIN}'::jsonb)`).join(', ')}`),
      K('hstarted', `select pg_temp.mb('c1', ${STARTED})`),
      K('hs1', SEAT('hstarted', 1, 'account', 'g2')),
      K('hs2', SEAT('hstarted', 2, 'desk', null, 'in', WALKIN)),
      K('hr', `select pg_temp.m(jsonb_build_object('start_at', ${at(1, 12)}, 'join_policy', 'approve'))`),
      K('hr1', SEAT('hr', 1, 'account', 'g1')),
      K('hrq', `select pg_temp.req({{hr}}, {{g5}})`),
      K('hsb', `select pg_temp.m(jsonb_build_object('sandbox', true, 'start_at', ${at(1, 6)}))`),
      K('hv2', `select pg_temp.m(jsonb_build_object('venue_id', {{v2}}, 'price_court_id', {{c21}}, 'rate_rule_id', null,
                                                     'start_at', ${at(1)}))`),
      K('hout', `select pg_temp.m(jsonb_build_object('start_at', ${at(5)}))`),
      K('hcx', `select pg_temp.m(jsonb_build_object('status', 'cancelled', 'ended_at', now(), 'ended_reason', 'organiser_cancelled',
                                                     'start_at', ${at(1, 9)}))`),
      K('plain', `select pg_temp.res('c2', ${at(1, 12)}, 90)`),

      // desk_open_matches.
      E('o_cashier', 'cashier', `select app.desk_open_matches(now(), now() + interval '1 day')`),
      E('o_null', 'desk', `select app.desk_open_matches(null, now())`),
      E('o_long', 'desk', `select app.desk_open_matches(now(), now() + interval '4 days')`),
      E('o_list', 'desk', `select app.desk_open_matches(now() - interval '12 hours', now() + interval '60 hours')`),

      // desk_match_states.
      E('st_many', 'desk', `select app.desk_match_states(array(select gen_random_uuid() from generate_series(1, 501)))`),
      E('st', 'desk', `select app.desk_match_states(array[
          (select reservation_id from matches where id = {{hb}}), (select reservation_id from matches where id = {{hstarted}}),
          {{plain}}]::uuid[])`),
      // booking_bill_states: another branch's booking gets no row (0262).
      K('plain2', `select pg_temp.res('c21', ${at(1, 12)}, 90)`),
      E('bbs', 'desk', `select app.booking_bill_states(array[
          (select reservation_id from matches where id = {{hb}}), {{plain2}}]::uuid[])`),
      Q('bbs_ids', `select jsonb_build_object('hb', (select reservation_id from matches where id = {{hb}}),
                                              'plain2', {{plain2}})`),

      // desk_match_detail.
      E('d_cashier', 'cashier', DETAIL('hf')),
      E('d_guest', 'g1', DETAIL('hf')),
      E('d_unknown', 'desk', DETAIL('nil')),
      E('d_sandbox', 'desk', DETAIL('hsb')),
      E('d_other', 'desk', DETAIL('hv2')),
      E('d_filling', 'desk', DETAIL('hf')),
      E('d_booked', 'desk', DETAIL('hb')),
      E('d_booked_mgr', 'manager', DETAIL('hb')),
      E('d_started', 'desk', DETAIL('hstarted')),
      E('d_started_mgr', 'manager', DETAIL('hstarted')),
      E('d_requests', 'desk', DETAIL('hr')),

      // A write at a branch the caller reads but no longer works at: the
      // owner's "All branches" scope over a closed branch.
      X(`update venues set status = 'closed' where id = {{v2}}`),
      X(`select set_config('request.headers', '{"x-venue-scope":"all"}', true)`),
      E('d_owner_closed', 'owner', DETAIL('hv2')),
      E('w_owner_closed', 'owner', CANCEL('hv2', 'other')),
      X(`select set_config('request.headers', '', true)`),
      MONEY('money_h'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_h')).toEqual({});
  });

  it('desk_open_matches: refusals, the envelope, the rows and which matches are listed (§5.6.1)', () => {
    expect(failed(r, 'o_cashier').code).toBe('FORBIDDEN');
    expect(failed(r, 'o_null')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_from' });
    expect(failed(r, 'o_long')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_to' });
    const env = data<Json>(r, 'o_list');
    expect(keys(env)).toEqual(ENVELOPE_KEYS);
    expect(env).toMatchObject({ matches_enabled: true, fill_deadline_minutes: 120, earliest_start_minutes: 180 });
    expect(typeof env.ticket_price_iqd).toBe('number');
    const rows = env.matches as Json[];
    for (const row of rows) expect(keys(row)).toEqual(OPEN_ROW_KEYS);
    const ids = rows.map((x) => x.match_id);
    const hf = data<Json>(r, 'h_start').match_id as string;
    const row = (mid: string) => rows.find((x) => x.match_id === mid)!;
    expect(ids).toContain(hf);
    expect(row(hf)).toMatchObject({ status: 'filling', organised_by: 'desk', organiser: null, seats_taken: 2, seats_left: 2,
      requests_pending: 0, courts_free_firm: 2, courts_total: 2, price_iqd: 40000 });
    const booked = rows.find((x) => x.status === 'booked' && x.seats_left === 1)!;
    expect(booked).toMatchObject({ seats_taken: 3, courts_free_firm: 1, courts_total: 2 });
    expect(keys(booked.organiser)).toEqual(sorted(['customer_id', 'full_name', 'phone']));
    // filling, waiting, booked with a seat open (the late leaver's; the started one's vacant numbers), the approve match.
    expect(rows.map((x) => x.status).sort()).toEqual(['awaiting_court', 'booked', 'booked', 'filling', 'filling']);
    expect(rows.find((x) => x.join_policy === 'approve')).toMatchObject({ requests_pending: 1 });
  });

  it('desk_match_states: an object keyed by booking, match bookings only (§5.6.2)', () => {
    expect(failed(r, 'st_many')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_reservation_ids' });
    const st = data<Record<string, Json>>(r, 'st');
    expect(Object.keys(st)).toHaveLength(2);
    for (const v of Object.values(st)) expect(keys(v)).toEqual(STATE_KEYS);
    const byStatus = Object.values(st);
    expect(byStatus.find((x) => x.seats_left_late === 1)).toMatchObject({
      status: 'booked', category: 'open', label: 'Test g1', seats_in: 3, seats_attended: 0, seats_no_show: 0,
      seats_unmarked: 0, open_seats: 1,
    });
    expect(byStatus.find((x) => x.seats_left_late === 0)).toMatchObject({ seats_in: 2, seats_unmarked: 2, open_seats: 2 });
  });

  it('booking_bill_states: a booking of a branch the desk does not see gets no row (0262)', () => {
    const ids = data<Record<string, string>>(r, 'bbs_ids');
    const rows = data<Json[]>(r, 'bbs');
    expect(rows.map((x) => x.reservation_id)).toEqual([ids.hb]);
    expect(rows[0]).toMatchObject({ match_id: expect.any(String), seats_owing: expect.any(Number) });
  });

  it('desk_match_detail: refusals and visibility (C20, D-10)', () => {
    expect(failed(r, 'd_cashier').code).toBe('FORBIDDEN');
    expect(failed(r, 'd_guest').code).toBe('FORBIDDEN');
    for (const l of ['d_unknown', 'd_sandbox', 'd_other']) expect(failed(r, l).code).toBe('MATCH_NOT_FOUND');
    expect(data<Json>(r, 'd_owner_closed')).toHaveProperty('match');
    expect(failed(r, 'w_owner_closed').code).toBe('VENUE_MISMATCH');
  });

  it('desk_match_detail: every key of §5.6.3 on a filling desk match; holder and companion of an extra', () => {
    const d = data<Json>(r, 'd_filling');
    expect(keys(d)).toEqual(DETAIL_KEYS);
    expect(keys(d.match)).toEqual(MATCH_KEYS);
    expect(keys((d.match as Json).can)).toEqual(sorted(['add_seat', 'cancel', 'call_off']));
    expect(d.match).toMatchObject({ status: 'filling', organiser: null, organiser_seat_id: null, reservation_id: null,
      reservation_status: null, court_id: null, started: false, marks_open: false, courts_free_firm: 2, courts_total: 2,
      can: { add_seat: true, cancel: true, call_off: false } });
    expect(d.money).toBeNull();
    expect(d.requests).toEqual([]);
    const seats = d.seats as Seat[];
    for (const s of seats) {
      expect(keys(s)).toEqual(SEAT_KEYS);
      expect(keys(s.can)).toEqual(SEAT_CAN_KEYS);
      expect(s.money).toBeNull();
    }
    const [s1, s2] = seats as [Seat, Seat];
    expect(s1).toMatchObject({ seat_no: 1, kind: 'desk', carrying: true, customer_id: null, full_name: 'Walk In',
      display_name: 'Walk I.', phone: '+9647712345670', holder_seat_id: null, gender: 'male', gender_source: 'desk',
      vouched: true, is_organiser: false, ticket: null });
    expect(s1.can).toMatchObject({ remove_reasons: ALL_REASONS, mark_attended: false, mark_no_show: false });
    expect(s2).toMatchObject({ seat_no: 2, full_name: null, display_name: null, phone: null,
      holder_seat_id: s1.seat_id, holder_name: 'Walk In', companion_no: 1 });
    const ev = d.events as Json[];
    expect(ev).toHaveLength(1);
    const e0 = ev[0]!;
    expect(keys(e0)).toEqual(EVENT_KEYS);
    expect(e0).toMatchObject({ type: 'started', actor: 'staff', seat_no: 1, code: null });
    expect(typeof e0.actor_name).toBe('string');
  });

  it('desk_match_detail on a booked match: a friend under its holder, remove reasons by role (§5.13.8)', () => {
    const d = data<Json>(r, 'd_booked');
    const byNo = (x: Json, no: number) => (x.seats as Seat[]).find((s) => s.seat_no === no && s.carrying)!;
    expect(byNo(d, 2)).toMatchObject({ kind: 'friend', full_name: null, phone: null, holder_seat_id: byNo(d, 1).seat_id,
      holder_name: 'Test g1', companion_no: 1 });
    expect(byNo(d, 1)).toMatchObject({ is_organiser: true, ticket: { status: 'in_use' } });
    expect(byNo(d, 1).can.remove_reasons).toEqual(['customer_request', 'conduct', 'other']);
    expect(byNo(data<Json>(r, 'd_booked_mgr'), 1).can.remove_reasons).toEqual(ALL_REASONS);
    expect(byNo(d, 4)).toMatchObject({ status: 'left_late', carrying: true });
    expect(byNo(d, 4).can.remove_reasons).toEqual([]);
    expect(d.match).toMatchObject({ status: 'booked', reservation_status: 'confirmed', court_name_en: 'M260 court 1',
      started: false, can: { add_seat: true, cancel: false, call_off: false } });
    expect(keys(d.money)).toEqual(MONEY_KEYS);
    expect((d.money as Json).phase).toBe('booked');
    for (const s of d.seats as Seat[]) if (s.money) expect(keys(s.money)).toEqual(SEAT_MONEY_KEYS);
  });

  it('desk_match_detail after the start: vacant numbers written off, staff errors by a manager only', () => {
    const d = data<Json>(r, 'd_started');
    const money = d.money as Json;
    expect(money.phase).toBe('started');
    expect((money.vacant as Json[]).map((v) => v.seat_no)).toEqual([3, 4]);
    for (const v of money.vacant as Json[]) expect(keys(v)).toEqual(sorted(['seat_no', 'open_iqd', 'written_off_iqd']));
    const s1 = (d.seats as Seat[]).find((s) => s.seat_no === 1)!;
    expect(s1.can).toMatchObject({ remove_reasons: [], mark_attended: true, mark_no_show: true, take_share: true,
      write_off: true });
    const m1 = (data<Json>(r, 'd_started_mgr').seats as Seat[]).find((s) => s.seat_no === 1)!;
    expect(m1.can.remove_reasons).toEqual(['staff_error', 'duplicate']);
    expect(d.match).toMatchObject({ started: true, marks_open: true, can: { add_seat: true, call_off: false } });
  });

  it('desk_match_detail lists pending requests with the requester\'s record (OM-41)', () => {
    const d = data<Json>(r, 'd_requests');
    const req = d.requests as Json[];
    expect(req).toHaveLength(1);
    expect(keys(req[0])).toEqual(REQUEST_KEYS);
    expect(req[0]).toMatchObject({ full_name: 'Test g5', seats_requested: 1, friend_genders: [], games_played: 0,
      no_shows: 0, flags: [] });
    expect(d.match).toMatchObject({ join_policy: 'approve', organiser: { full_name: 'Test g1' } });
    expect(keys((d.match as Json).organiser)).toEqual(sorted(['customer_id', 'full_name', 'phone', 'flags']));
  });
});

// ── 9. mark_reservation and the customer re-issues (§4.7.13) ───────────────

describe.skipIf(!docker)('mark_reservation MATCH_MARK_SEATS and the customer_* counts (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m261i', [
      SETUP, DESK_SETUP,
      `select pg_temp.branch();`, `select pg_temp.desk_staff();`, `select pg_temp.courts(2);`,
      GUEST('gc', '{"given":"Rana","family":"Kareem","phone":"+9647711110020"}'),
      GUEST('g1'), GUEST('g2'),
      `select pg_temp.day(${STARTED});`,

      // mark_reservation on a match booking: no-show refused, arrived allowed.
      K('mr', `select pg_temp.mb('c1', ${STARTED})`),
      K('mr_res', `select reservation_id from matches where id = {{mr}}`),
      E('mr_no_show', 'desk', `select app.mark_reservation({{mr_res}}, 'no_show')`),
      E('mr_arrived', 'desk', `select app.mark_reservation({{mr_res}}, 'arrived')`),
      K('mp', `select pg_temp.mb('c2', ${at(-3)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('mp_res', `select reservation_id from matches where id = {{mp}}`),
      E('mr_played', 'desk', `select app.mark_reservation({{mp_res}}, 'no_show')`),
      K('plain', `select pg_temp.res('c3', ${STARTED}, 60, 'booking', 'confirmed', 'g2')`),
      E('mr_plain', 'desk', `select app.mark_reservation({{plain}}, 'no_show')`),

      // gc's history: a booking no-show and a future booking; seats played,
      // no-shows (account, friend on the holder, linked desk), a sandbox
      // no-show, a called-off match, a late leave.
      X(`select pg_temp.res('c4', ${at(-10)}, 60, 'booking', 'no_show', 'gc')`),
      X(`select pg_temp.res('c4', ${at(10)}, 60, 'booking', 'confirmed', 'gc')`),
      K('p1', `select pg_temp.mb('c1', ${at(-5)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('p1s', SEAT('p1', 1, 'account', 'gc')), X(`select pg_temp.mark({{p1s}}, 'attended')`),
      K('p2', `select pg_temp.mb('c2', ${at(-6)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('p2s', SEAT('p2', 1, 'desk', 'gc')), X(`select pg_temp.mark({{p2s}}, 'attended')`),
      K('p3', `select pg_temp.mb('c3', ${at(-7)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('p3s', SEAT('p3', 2, 'friend', 'gc')), X(`select pg_temp.mark({{p3s}}, 'attended')`),
      K('n1', `select pg_temp.mb('c1', ${at(-8)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('n1s', SEAT('n1', 1, 'account', 'gc')), X(`select pg_temp.mark({{n1s}}, 'no_show')`),
      K('n2', `select pg_temp.mb('c2', ${at(-9)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('n2s', SEAT('n2', 2, 'friend', 'gc')), X(`select pg_temp.mark({{n2s}}, 'no_show')`),
      K('n3', `select pg_temp.mb('c3', ${at(-10)}, jsonb_build_object('status', 'played', 'ended_at', now()))`),
      K('n3s', SEAT('n3', 1, 'desk', 'gc')), X(`select pg_temp.mark({{n3s}}, 'no_show')`),
      K('nsb', `select pg_temp.m(jsonb_build_object('status', 'played', 'ended_at', now(), 'sandbox', true, 'start_at', ${at(-4)}))`),
      K('nsbs', SEAT('nsb', 1, 'account', 'gc')), X(`select pg_temp.mark({{nsbs}}, 'no_show')`),
      K('cx', `select pg_temp.mb('c4', ${at(-11)}, jsonb_build_object('status', 'cancelled', 'ended_at', now(),
                                                                        'ended_reason', 'called_off_short'))`),
      K('cxs', SEAT('cx', 1, 'account', 'gc')), X(`select pg_temp.mark({{cxs}}, 'attended')`),
      K('ll', `select pg_temp.mb('c4', ${at(3)})`),
      K('lls', SEAT('ll', 1, 'account', 'gc', 'left_late')),

      Q('counts', `select app.customer_counts({{gc}})`),
      E('record', 'desk', `select app.customer_record({{gc}})`),
      E('record_cashier', 'cashier', `select app.customer_record({{gc}})`),
      // The directory stops at 5,000 names: a stack full of other suites'
      // guests may truncate it before gc.
      E('directory', 'desk', `select jsonb_build_object(
          'row', (select x from jsonb_array_elements(d->'rows') x where x->>'id' = {{gc}}), 'truncated', d->'truncated')
          from (select app.customer_directory(5000) as d) s`),
      E('search', 'desk', `select jsonb_agg(x) from app.customer_search('Rana Kareem', 12) x where x->>'id' = {{gc}}`),
      MONEY('money_i'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_i')).toEqual({});
  });

  it('mark_reservation refuses a match booking\'s no-show whatever the match\'s status; arrived and plain no-shows pass', () => {
    expect(failed(r, 'mr_no_show').code).toBe('MATCH_MARK_SEATS');
    expect(data<Json>(r, 'mr_arrived')).toMatchObject({ status: 'arrived' });
    expect(failed(r, 'mr_played').code).toBe('MATCH_MARK_SEATS');
    expect(data<Json>(r, 'mr_plain')).toMatchObject({ status: 'no_show' });
  });

  it('customer_counts: seat no-shows join the no-show total (DF-12, DF-15); played, match no-shows, late leaves', () => {
    expect(data(r, 'counts')).toEqual({
      bookings: 1, cancellations: 0, noShows: 4, matchesPlayed: 2, matchNoShows: 3, lateLeaves: 1,
    });
  });

  it('customer_record: gender, the last matches at every branch (sandbox never), the counts', () => {
    const rec = data<Json>(r, 'record');
    expect(rec.customer).toMatchObject({ full_name: 'Rana Kareem', gender: 'female', gender_set_by: 'guest' });
    expect(rec.counts).toEqual(data(r, 'counts'));
    const ms = rec.matches as Json[];
    expect(ms).toHaveLength(8);
    for (const m of ms) {
      expect(keys(m)).toEqual(sorted(['match_id', 'reservation_id', 'venue_id', 'status', 'start_at', 'end_at', 'category',
        'seat_status', 'kind']));
    }
    expect(ms.map((m) => [m.status, m.seat_status, m.kind])).toEqual([
      ['booked', 'left_late', 'account'],
      ['played', 'attended', 'account'], ['played', 'attended', 'desk'], ['played', 'attended', 'friend'],
      ['played', 'no_show', 'account'], ['played', 'no_show', 'friend'], ['played', 'no_show', 'desk'],
      ['cancelled', 'attended', 'account'],
    ]);
    expect(data<Json>(r, 'record_cashier')).toHaveProperty('matches');
  });

  it('customer_directory and customer_search carry the new figures', () => {
    const dir = data<{ row: Json | null; truncated: boolean }>(r, 'directory');
    if (dir.row) expect(dir.row).toMatchObject({ counts: { noShows: 4 } });
    else expect(dir.truncated).toBe(true);
    const rows = data<Json[]>(r, 'search');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: 'Rana Kareem', gender: 'female', counts: { noShows: 4, matchesPlayed: 2 } });
  });
});

// ── 10. The grants, over HTTP (read only) ──────────────────────────────────

describe.skipIf(!up)('the desk reads over HTTP', () => {
  it('a court desk reads the envelope; a guest is refused before anything is read', async () => {
    const desk = await signedInClient(SEED_STAFF.court_desk);
    const from = new Date();
    const to = new Date(from.getTime() + 24 * 3600_000);
    const res = await appRpc(desk, 'desk_open_matches', { p_from: from.toISOString(), p_to: to.toISOString() });
    expect(res.error).toBeNull();
    expect(keys(res.data)).toEqual(ENVELOPE_KEYS);
    const guest = await guestClient(serviceClient(), 'm261');
    const refused = await appRpc(guest, 'desk_match_detail', { p_match_id: NIL });
    expect(refused.error?.message).toBe('FORBIDDEN');
  });
});
