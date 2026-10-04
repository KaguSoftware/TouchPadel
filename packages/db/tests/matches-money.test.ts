/**
 * 0262 match_desk_money, Money's part (docs/design/open-matches/money.md §6,
 * §8, §9, §10; build contracts §1.7, R1, R2, R19, R20, R21): the seat-money
 * engine, the court line it nets, Take share, Assign, the manager write-off,
 * booking_bill with its match block, and the DF-16 wall.
 *
 * Six rolled-back scenarios at a branch made inside the transaction (the
 * 0261 harness: open, matches on, two courts, 40,000 IQD a slot), calling the
 * RPCs as the seeded staff (who also work at that branch here):
 *   1. the engine over every court-money row of §10, DF-4 up and down,
 *      the sandbox and plain-booking walls (M8–M10), shares and the booking
 *      price (M1, M2), the court cap, booking_bill and booking_bill_states;
 *   2. match_seat_settle: every refusal in order, one seat, several seats, a
 *      part payment, adopting an empty tab against BOOKING_TAB_OPEN, replay,
 *      drift (SEAT_OWED_CHANGED), clearing a manual write-off;
 *   3. match_link_payment: closing a partly paid bill, [], over_paid, empty,
 *      already_linked, the over-allocation refusals, the organiser who paid
 *      for everyone made exact, a link on a no-show;
 *   4. match_seat_write_off with a manager PIN proved by the court desk,
 *      duplicate, not started, a no-show, a played match, collecting it back;
 *   5. the DF-16 wall (R20): an order, an adjustment, a discount, a merge and
 *      a moved order refused on a match booking's tab; a plain booking's tab
 *      untouched; the court-only bill still settles;
 *   6. the day close with a no-show, a write-off and a partly paid bill; a
 *      call-off with money taken (refund due); a paid seat never becomes a
 *      no-show (M12, DB's mark_match_seats in the same migration).
 * After every money- or ticket-moving step, pg_temp.check() reads the
 * in-transaction money invariants (M1, M3–M7, M11) and the ticket ledger
 * (pg_temp.ledger(), T5, T6, T8, T9).
 *
 * Then two committed races over two connections at venue A (the money lock,
 * R19): two Take shares on one seat take one payment; a Take share racing an
 * Assign never links more than the share.
 *
 * The report cases (day_close_online, reports_figures, report_courts.matches,
 * report_matches, unpaid_played_bookings) join this file with 0265.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { splitEvenly } from '../../core/src/money/split';
import {
  MATCH_MONEY_CHECK,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
  appRpc,
  assertMatchMoney,
  createTestCourt,
  ensureOpenDay,
  serviceClient,
  signedInClient,
  stackAvailable,
  testIdemKey,
} from './helpers';
import { MK, Q, RES, T, X, dockerReachable, psql, psqlSession, scenario, waitForSleeper, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const MANAGER_PIN = '380517';
const NIL = '00000000-0000-4000-8000-000000000261';

/** A start `d` days past the harness's three days out (not started). */
const FUT = (d: number) => at(3 + d);
/** A start `h` hours before the current hour (started; 90 minutes long). */
const PAST = (h: number) => `(date_trunc('hour', now()) - interval '${h} hours')`;

/**
 * Money's planting helpers, on top of the 0261 harness (SETUP): the staff at
 * the branch, its open day, a booked match with its booking, a seat in any
 * state with its ticket where it has one, the engine's figures of a match,
 * and the invariants of money.md §9 a rolled-back scenario can read.
 */
const MONEY = String.raw`
-- The seeded desk, cashier and manager work at the branch too (the owner
-- works everywhere). app.venue_id names the branch for the whole
-- transaction, as the station of a branch till would.
create function pg_temp.staff() returns void language plpgsql as $f$
begin
  insert into staff_venues (staff_id, venue_id, role)
  select s.id, pg_temp.var('v')::uuid, s.role
    from staff s
   where s.id in (pg_temp.var('desk')::uuid, pg_temp.var('cashier')::uuid, pg_temp.var('manager')::uuid)
  on conflict do nothing;
  perform set_config('app.venue_id', pg_temp.var('v'), true);
end $f$;

-- The branch's open day, today.
create function pg_temp.day() returns uuid language sql as $f$
  insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
  values (pg_temp.var('v')::uuid, app.venue_business_date(pg_temp.var('v')::uuid, now()), 'open',
          pg_temp.var('manager')::uuid, 0)
  returning id
$f$;

-- A match the desk started, booked on p_court at p_start (90 minutes) with its
-- booking ('Open match', guest_id NULL), kept as p_name and p_name_res. p:
-- price_iqd (the match, 40,000), booking_price_iqd (the booking after a DF-4
-- re-price), status (booked | played | no_show | cancelled).
create function pg_temp.mbook(p_name text, p_court text, p_start timestamptz, p jsonb default '{}') returns uuid
language plpgsql as $f$
declare
  v_price  bigint := coalesce((p->>'price_iqd')::bigint, 40000);
  v_status text := coalesce(p->>'status', 'booked');
  v_res    uuid;
  v        uuid;
begin
  insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source, price_iqd,
                            cancelled_at, cancelled_by, cancellation_reason)
  values (pg_temp.var('v')::uuid, pg_temp.var(p_court)::uuid, 'booking',
          (case v_status when 'booked' then 'confirmed' when 'played' then 'completed'
                         when 'no_show' then 'no_show' else 'cancelled' end)::reservation_status,
          p_start, p_start + interval '90 minutes', 'Open match', 'desk',
          coalesce((p->>'booking_price_iqd')::bigint, v_price),
          case when v_status in ('no_show', 'cancelled') then now() end,
          case when v_status = 'cancelled' then 'staff' end::cancellation_actor,
          case v_status when 'no_show' then 'all_no_show' when 'cancelled' then 'called_off_short' end)
  returning id into v_res;
  v := pg_temp.m(jsonb_build_object(
         'status', v_status, 'start_at', p_start, 'reservation_id', v_res, 'price_iqd', v_price,
         'shares_iqd', to_jsonb(app.match_shares(v_price)), 'price_court_id', pg_temp.var(p_court),
         'organiser_id', null, 'organised_by', 'desk', 'created_by_staff_id', pg_temp.var('desk'),
         'ended_at', case when v_status <> 'booked' then now() end,
         'ended_reason', case v_status when 'no_show' then 'all_no_show' when 'cancelled' then 'called_off_short' end));
  insert into pg_temp.vars values (p_name, v::text), (p_name || '_res', v_res::text);
  return v;
end $f$;

-- A seat of the match kept as p_match, kept as p_name. account and friend
-- seats hold a ticket of p_guest: in use while in or left_late, forfeited by
-- the seat on no_show, back to available otherwise (each move an event). A
-- desk seat is a typed walk-in (p guest_name). p replaces: the kept seat it
-- replaces (a refill, R4).
create function pg_temp.ms(p_name text, p_match text, p_no int, p_kind text, p_guest text default null,
                           p_status text default 'in', p jsonb default '{}') returns uuid
language plpgsql as $f$
declare
  v_m     uuid := pg_temp.var(p_match)::uuid;
  v_venue uuid := (select mt.venue_id from matches mt where mt.id = v_m);
  v_g     uuid := case when p_guest is null then null else pg_temp.var(p_guest)::uuid end;
  v_desk  uuid := pg_temp.var('desk')::uuid;
  v_t     uuid;
  v       uuid;
begin
  if p_kind in ('account', 'friend') then
    v_t := pg_temp.ticket(v_g, false);
  end if;
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, guest_name, status, ticket_id, share_iqd,
                           replaces_seat_id, created_by_staff_id, joined_at, ended_at, end_reason, marked_at,
                           marked_by_staff_id)
  values (v_venue, v_m, p_no, p_kind, v_g,
          case when p_kind = 'desk' then coalesce(p->>'guest_name', 'Walk-in ' || p_name) end,
          p_status, v_t, (select mt.shares_iqd[p_no] from matches mt where mt.id = v_m),
          case when p ? 'replaces' then pg_temp.var(p->>'replaces')::uuid end,
          case when p_kind = 'desk' then v_desk end, clock_timestamp(),
          case when p_status in ('left', 'removed', 'cancelled', 'left_late', 'refilled') then now() end,
          case p_status when 'left' then 'left' when 'removed' then 'removed_by_staff'
                        when 'cancelled' then 'match_ended' when 'left_late' then 'left'
                        when 'refilled' then 'refilled' end,
          case when p_status in ('attended', 'no_show') then now() end,
          case when p_status in ('attended', 'no_show') then v_desk end)
  returning id into v;
  if v_t is not null then
    update match_tickets set status = 'in_use', seat_id = v where id = v_t;
    insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
    values (v_t, v_g, 'locked', v_venue, v_m, v);
    if p_status = 'no_show' then
      update match_tickets
         set status = 'forfeited', seat_id = null, forfeited_at = now(), forfeited_venue_id = v_venue,
             forfeited_seat_id = v
       where id = v_t;
      insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
      values (v_t, v_g, 'forfeited', v_venue, v_m, v);
    elsif p_status not in ('in', 'left_late') then
      update match_tickets set status = 'available', seat_id = null where id = v_t;
      insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
      values (v_t, v_g, 'released', v_venue, v_m, v);
    end if;
  end if;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- A plain court booking (no match) on p_court.
create function pg_temp.plain(p_name text, p_court text, p_start timestamptz, p_price bigint) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source, price_iqd)
  values (pg_temp.var('v')::uuid, pg_temp.var(p_court)::uuid, 'booking', 'confirmed', p_start,
          p_start + interval '60 minutes', 'Plain booking', 'desk', p_price)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- The engine's figures of a match, compact, plus the booking's court_fee_*.
create function pg_temp.fig(p_match text) returns jsonb language sql as $f$
  with mm as (select app.match_money(pg_temp.var(p_match)::uuid, null) as j),
       rr as (select mt.reservation_id as id from matches mt where mt.id = pg_temp.var(p_match)::uuid)
  select jsonb_build_object(
    'phase', mm.j->'phase', 'owed', mm.j->'owed_iqd', 'wo', mm.j->'written_off_iqd', 'open', mm.j->'open_iqd',
    'delta', mm.j->'delta_owed_iqd', 'over', mm.j->'over_iqd', 'paid', mm.j->'paid_iqd',
    'desk_paid', mm.j->'desk_paid_iqd', 'price_delta', mm.j->'price_delta_iqd',
    'unassigned', mm.j->'unassigned_iqd', 'unassigned_rows', jsonb_array_length(mm.j->'unassigned'),
    'remaining', app.court_fee_remaining(rr.id), 'written_off', app.court_fee_written_off(rr.id),
    'seats', (select jsonb_agg(jsonb_build_object(
                       'no', (e->>'seat_no')::int, 'kind', e->>'kind', 'c', (e->>'carrying')::boolean,
                       'share', (e->>'share_iqd')::bigint, 'paid', (e->>'paid_desk_iqd')::bigint,
                       'credit', (e->>'credit_iqd')::bigint, 'owed', (e->>'owed_iqd')::bigint,
                       'wo', (e->>'written_off_iqd')::bigint, 'w', e->>'write_off',
                       'open', (e->>'open_iqd')::bigint, 'take', (e->>'take_iqd')::bigint) order by o)
                from jsonb_array_elements(mm.j->'seats') with ordinality as x(e, o)))
    from mm, rr
$f$;

-- The money invariants of one kept match (helpers.ts MATCH_MONEY_CHECK).
create function pg_temp.money(p_match text) returns jsonb language sql as $f$
  select pg_temp.money_of(pg_temp.var(p_match)::uuid)
$f$;

-- Money invariants of every kept match named, and the ticket ledger.
create function pg_temp.check(p_matches text[]) returns jsonb language sql as $f$
  select jsonb_build_object(
    'ledger', pg_temp.ledger(),
    'money', (select coalesce(jsonb_object_agg(n, pg_temp.money(n)) filter (where pg_temp.money(n) <> '[]'::jsonb),
                              '{}'::jsonb)
                from unnest(p_matches) n))
$f$;

-- The live tabs of a kept booking.
create function pg_temp.live_tabs(p_res text) returns int language sql as $f$
  select count(*)::int from tabs
   where reservation_id = pg_temp.var(p_res)::uuid and status in ('open', 'awaiting_payment')
$f$;

-- One tab, compact.
create function pg_temp.tab(p_tab text) returns jsonb language sql as $f$
  select jsonb_build_object('status', t.status, 'court', t.court_iqd, 'cap', t.court_cap_iqd, 'total', t.total_iqd,
                            'kind', t.kind, 'branch', t.venue_id = pg_temp.var('v')::uuid,
                            'links', (select coalesce(jsonb_agg(jsonb_build_object('seat', s.seat_no, 'amount', l.amount_iqd)
                                                                order by s.seat_no), '[]'::jsonb)
                                        from payment_match_seats l
                                        join payments p on p.id = l.payment_id
                                        join match_seats s on s.id = l.match_seat_id
                                       where p.tab_id = t.id))
    from tabs t where t.id = pg_temp.var(p_tab)::uuid
$f$;
`;

/** Run a check of the named matches under `label`. */
const CHECK = (label: string, matches: string[]) =>
  Q(`check_${label}`, `select pg_temp.check(array[${matches.map((m) => `'${m}'`).join(', ')}])`);

/** Every CHECK of a scenario reads clean: no broken money rule, no broken ledger rule. */
function expectChecksClean(r: Results) {
  const labels = Object.keys(r).filter((k) => k.startsWith('check_'));
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(r[label]!.ok, label).toBe(true);
    expect(r[label]!.data, label).toEqual({ ledger: [], money: {} });
  }
}

/** match_seat_settle as SQL. */
const SETTLE = (seats: string[], method: string, expected: number | null, o: {
  tendered?: number | null; amount?: number | null; key?: string | null; device?: string | null;
} = {}) =>
  `select app.match_seat_settle(array[${seats.map((s) => `{{${s}}}`).join(', ')}]::uuid[], ` +
  `${method === 'null' ? 'null' : `'${method}'`}, ${expected ?? 'null'}, ${o.tendered ?? 'null'}, ${o.amount ?? 'null'}, ` +
  `${o.key === null ? 'null' : `'${o.key ?? `k-${Math.random().toString(36).slice(2)}`}'`}, ` +
  `${o.device ? `'${o.device}'` : 'null'})`;

/** match_link_payment as SQL: allocations as [seat, amount] pairs, or raw jsonb. */
const LINK = (payment: string, alloc: Array<[string, number]> | string, key: string | null) =>
  `select app.match_link_payment({{${payment}}}, ` +
  (typeof alloc === 'string'
    ? `'${alloc}'::jsonb`
    : `jsonb_build_array(${alloc.map(([s, a]) => `jsonb_build_object('seat_id', {{${s}}}, 'amount_iqd', ${a})`).join(', ')})`) +
  `, ${key === null ? 'null' : `'${key}'`})`;

/** The booking's normal bill (open_tab) and a payment on it (settle_tab), kept as <name>_tab and <name>_pay. */
const BILL = (name: string, res: string, method: 'cash' | 'card', amount: number | null, who = 'desk') => [
  T(`open_${name}`, who, `select app.open_tab(null, null, {{${res}}}, 'k-open-${name}', null)`),
  RES(`${name}_tab`, `open_${name}`, 'tab_id'),
  T(`pay_${name}`, who, `select app.settle_tab({{${name}_tab}}, '${method}', ${method === 'cash' ? amount : 'null'}, ` +
    `${amount ?? 'null'}, 'k-pay-${name}', null, null)`),
  RES(`${name}_pay`, `pay_${name}`, 'payment_id'),
];

/** A fresh manager-PIN grant for `who` (verify_manager_pin's row), without the PIN round trip. */
const GRANT = (who: string) =>
  X(`insert into app.pin_grants (caller_id, authorizer_id) values ({{${who}}}, {{manager}})`);

/**
 * A staff member of venue A only. The 0123 trigger files a new staff member at
 * the resolved branch, which app.venue_id names here (pg_temp.staff()), so the
 * row is moved to venue A.
 */
const OUTSIDER = (name: string, role: string) => [
  MK(name, role),
  X(`update staff_venues set venue_id = {{venue}} where staff_id = {{${name}}}`),
];

const BASE = [SETUP, MATCH_MONEY_CHECK, MONEY, `select pg_temp.branch();`, `select pg_temp.staff();`];

type Seat = { no: number; kind: string; c: boolean; share: number; paid: number; credit: number; owed: number;
              wo: number; w: string | null; open: number; take: number };
type Fig = { phase: string; owed: number; wo: number; open: number; delta: number; over: number; paid: number;
             desk_paid: number; price_delta: number; unassigned: number; unassigned_rows: number;
             remaining: number; written_off: number; seats: Seat[] };
const fig = (r: Results, label: string) => data<Fig>(r, label);

// ── 1. The engine: §10's court-money rows, M1–M4, M7–M10, reads ────────────

describe.skipIf(!docker)('0262 the seat-money engine (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('m261e', [
      ...BASE,
      K('day', `select pg_temp.day()`),
      GUEST('g1'), GUEST('g2'), GUEST('g3'), GUEST('g4'), GUEST('g5'), GUEST('g6'),

      // #8 the fourth seat booked: every carrier owes its share (an account,
      // a friend on the holder's ticket, a desk walk-in).
      X(`select pg_temp.mbook('e8', 'c1', ${FUT(0)})`),
      X(`select pg_temp.ms('e8a', 'e8', 1, 'account', 'g1')`),
      X(`select pg_temp.ms('e8b', 'e8', 2, 'account', 'g2')`),
      X(`select pg_temp.ms('e8c', 'e8', 3, 'friend', 'g2')`),
      X(`select pg_temp.ms('e8d', 'e8', 4, 'desk')`),
      Q('e8', `select pg_temp.fig('e8')`),
      // #9 a late leave before the start: its share is open.
      X(`select pg_temp.mbook('e9', 'c1', ${FUT(1)})`),
      ...[1, 2, 3].map((n) => X(`select pg_temp.ms('e9${n}', 'e9', ${n}, 'desk')`)),
      X(`select pg_temp.ms('e9d', 'e9', 4, 'account', 'g3', 'left_late')`),
      Q('e9', `select pg_temp.fig('e9')`),
      // #10 the late leave refilled: the refill owes, the leaver carries nothing.
      X(`select pg_temp.mbook('e10', 'c1', ${FUT(2)})`),
      ...[1, 2, 3].map((n) => X(`select pg_temp.ms('e10${n}', 'e10', ${n}, 'desk')`)),
      X(`select pg_temp.ms('e10d', 'e10', 4, 'account', 'g3', 'refilled')`),
      X(`select pg_temp.ms('e10r', 'e10', 4, 'desk', null, 'in', '{"replaces":"e10d"}')`),
      Q('e10', `select pg_temp.fig('e10')`),
      // #11 started with the late leave unrefilled: written off (left_late).
      X(`select pg_temp.mbook('e11', 'c1', ${PAST(3)})`),
      ...[1, 2, 3].map((n) => X(`select pg_temp.ms('e11${n}', 'e11', ${n}, 'desk', null, 'attended')`)),
      X(`select pg_temp.ms('e11d', 'e11', 4, 'account', 'g4', 'left_late')`),
      Q('e11', `select pg_temp.fig('e11')`),
      // #12 a seat removed after booking, not refilled: open before the start,
      // written off (vacant) after.
      X(`select pg_temp.mbook('e12a', 'c1', ${FUT(3)})`),
      ...[1, 2, 3].map((n) => X(`select pg_temp.ms('e12a${n}', 'e12a', ${n}, 'desk')`)),
      X(`select pg_temp.ms('e12ax', 'e12a', 4, 'desk', null, 'removed')`),
      Q('e12a', `select pg_temp.fig('e12a')`),
      X(`select pg_temp.mbook('e12b', 'c1', ${PAST(6)})`),
      ...[1, 2, 3].map((n) => X(`select pg_temp.ms('e12b${n}', 'e12b', ${n}, 'desk', null, 'attended')`)),
      X(`select pg_temp.ms('e12bx', 'e12b', 4, 'desk', null, 'removed')`),
      Q('e12b', `select pg_temp.fig('e12b')`),
      // #13, #14, #16: attended players owe, an account no-show and a desk
      // walk-in no-show are written off.
      X(`select pg_temp.mbook('e13', 'c2', ${PAST(3)})`),
      X(`select pg_temp.ms('e13a', 'e13', 1, 'account', 'g1', 'attended')`),
      X(`select pg_temp.ms('e13b', 'e13', 2, 'account', 'g2', 'no_show')`),
      X(`select pg_temp.ms('e13c', 'e13', 3, 'desk', null, 'no_show')`),
      X(`select pg_temp.ms('e13d', 'e13', 4, 'desk', null, 'attended', '{"guest_name":"Nour Four"}')`),
      Q('e13', `select pg_temp.fig('e13')`),
      // M8: the guests hold ticket purchases; none of them is court money.
      T('bill_e13', 'cashier', `select app.booking_bill({{e13_res}})`),
      X(`select pg_temp.plain('plain', 'c2', ${FUT(7)}, 30000)`),
      T('states', 'desk', `select app.booking_bill_states(array[{{e13_res}}, {{plain}}]::uuid[])`),
      T('bill_plain', 'desk', `select app.booking_bill({{plain}})`),
      Q('ticket_money', `select jsonb_build_object(
          'purchases', (select count(*) from booking_payments bp join pg_temp.guests g on g.id = bp.guest_id
                         where bp.purpose = 'ticket'),
          'deposit_net', app.deposit_net_paid({{e13_res}}), 'court_paid', app.court_fee_paid({{e13_res}}))`),
      // #17 the account no-show corrected to attended while marks are open:
      // the ticket restored, the share owed again.
      X(`update match_seats set status = 'attended' where id = {{e13b}}`),
      X(`update match_tickets set status = 'available', forfeited_at = null, forfeited_venue_id = null,
                                  forfeited_seat_id = null
          where id = (select ticket_id from match_seats where id = {{e13b}})`),
      X(`insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
         select s.ticket_id, s.guest_id, 'restored', s.venue_id, s.match_id, s.id from match_seats s where s.id = {{e13b}}`),
      Q('e13_corrected', `select pg_temp.fig('e13')`),
      // #15 a walk-in takes a no-show's number after the start (R4): the
      // walk-in owes the share, nothing is written off for that number.
      X(`select pg_temp.mbook('e15', 'c2', ${PAST(6)})`),
      X(`select pg_temp.ms('e15a', 'e15', 1, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('e15b', 'e15', 2, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('e15c', 'e15', 3, 'account', 'g5', 'no_show')`),
      X(`select pg_temp.ms('e15w', 'e15', 3, 'desk', null, 'in', '{"replaces":"e15c"}')`),
      X(`select pg_temp.ms('e15d', 'e15', 4, 'desk', null, 'attended')`),
      Q('e15', `select pg_temp.fig('e15')`),
      // #26 all four no-show: the booking is not live, nobody owes, nothing
      // is written off (M7).
      X(`select pg_temp.mbook('e26', 'c2', ${PAST(9)}, '{"status":"no_show"}')`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('e26${n}', 'e26', ${n}, 'desk', null, 'no_show')`)),
      Q('e26', `select pg_temp.fig('e26')`),
      // #23 DF-4 up: the rise is booking money (delta), the shares stay; down:
      // the fall credits collectable seats from the highest number (MD-9).
      X(`select pg_temp.mbook('up', 'c1', ${FUT(4)}, '{"booking_price_iqd":45000}')`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('up${n}', 'up', ${n}, 'desk')`)),
      Q('up', `select pg_temp.fig('up')`),
      X(`select pg_temp.mbook('down', 'c1', ${FUT(5)}, '{"booking_price_iqd":36000}')`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('down${n}', 'down', ${n}, 'desk')`)),
      Q('down', `select pg_temp.fig('down')`),
      // M10 a sandbox match never books, so it is never court money.
      K('sb', `select pg_temp.m(jsonb_build_object('status', 'booked', 'sandbox', true, 'start_at', ${FUT(6)}))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('sb${n}', 'sb', ${n}, 'desk')`)),
      Q('sb', `select pg_temp.fig('sb')`),
      // M1 + M2: an awkward price split exactly, booked at that price.
      K('odd', `select pg_temp.m(jsonb_build_object('start_at', ${FUT(8)}, 'price_iqd', 40001,
                                                    'shares_iqd', to_jsonb(app.match_shares(40001))))`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('odd${n}', 'odd', ${n}, 'account', 'g${n}')`)),
      E('odd_lock', null, `select to_jsonb((app.match_lock({{odd}})).status)`),
      E('odd_book', null, `select to_jsonb(app.match_try_book({{odd}}))`),
      Q('odd_booking', `select jsonb_build_object('price', r.price_iqd, 'guest_id', r.guest_id, 'name', r.guest_name,
                                                  'shares', m.shares_iqd)
                          from matches m join reservations r on r.id = m.reservation_id where m.id = {{odd}}`),
      Q('odd', `select pg_temp.fig('odd')`),
      // §6.3 the court cap: a capped tab bills at most its cap; a normal bill
      // on a match booking bills what the booking still owes.
      K('cap_tab', `insert into tabs (venue_id, day_session_id, reservation_id, kind, court_cap_iqd)
                    values ({{v}}, {{day}}, {{e8_res}}, 'cafe', 15000) returning id`),
      Q('cap_15000', `select to_jsonb(t) from app.compute_tab_totals({{cap_tab}}) t`),
      X(`update tabs set court_cap_iqd = 50000 where id = {{cap_tab}}`),
      Q('cap_50000', `select to_jsonb(t) from app.compute_tab_totals({{cap_tab}}) t`),
      X(`update tabs set court_cap_iqd = null, status = 'void' where id = {{cap_tab}}`),
      T('open_e13', 'desk', `select app.open_tab(null, null, {{e13_res}}, 'k-open-e13', null)`),
      RES('e13_tab', 'open_e13', 'tab_id'),
      Q('normal_bill', `select to_jsonb(t) from app.compute_tab_totals({{e13_tab}}) t`),
      T('bill_live', 'desk', `select app.booking_bill({{e13_res}})`),
      X(`update tabs set status = 'void' where id = {{e13_tab}}`),
      Q('seat_money', `select jsonb_agg(to_jsonb(s) order by s.seat_no, s.carrying desc) from app.match_seat_money({{e10}}) s`),
      CHECK('engine', ['e8', 'e9', 'e10', 'e11', 'e12a', 'e12b', 'e13', 'e15', 'e26', 'up', 'down', 'sb', 'odd']),
    ]);
  });

  const owedAll = (f: Fig) => f.seats.slice(0, 4).map((s) => s.owed);

  it('#8: every carrier of a booked match owes its share, nothing is written off or open', () => {
    const f = fig(r, 'e8');
    expect(f).toMatchObject({ phase: 'booked', owed: 40000, wo: 0, open: 0, delta: 0, over: 0, paid: 0,
                              remaining: 40000, written_off: 0 });
    expect(f.seats.map((s) => [s.no, s.kind, s.c, s.owed, s.take])).toEqual([
      [1, 'account', true, 10000, 10000], [2, 'account', true, 10000, 10000],
      [3, 'friend', true, 10000, 10000], [4, 'desk', true, 10000, 10000],
    ]);
  });

  it('#9, #10: a late leave is open before the start; its refill owes and the leaver carries nothing', () => {
    const f9 = fig(r, 'e9');
    expect(f9).toMatchObject({ owed: 30000, open: 10000, wo: 0, remaining: 40000 });
    expect(f9.seats[3]).toMatchObject({ no: 4, kind: 'account', c: true, owed: 0, open: 10000, take: 0, w: null });
    const f10 = fig(r, 'e10');
    expect(f10).toMatchObject({ owed: 40000, open: 0, wo: 0, remaining: 40000 });
    expect(f10.seats).toHaveLength(5);
    expect(f10.seats[3]).toMatchObject({ no: 4, kind: 'desk', c: true, owed: 10000 });
    expect(f10.seats[4]).toMatchObject({ no: 4, kind: 'account', c: false, owed: 0, paid: 0, take: 0 });
    // match_seat_money is the same rows as a table.
    const rows = data<Json[]>(r, 'seat_money');
    expect(rows).toHaveLength(5);
    expect(rows.find((s) => s.carrying === false)).toMatchObject({ seat_no: 4, kind: 'account', owed_iqd: 0 });
  });

  it('#11, #12: after the start an unrefilled late leave and a vacant number are written off; before it, vacant is open', () => {
    expect(fig(r, 'e11')).toMatchObject({ phase: 'started', owed: 30000, wo: 10000, open: 0, remaining: 30000,
                                          written_off: 10000 });
    expect(fig(r, 'e11').seats[3]).toMatchObject({ kind: 'account', wo: 10000, w: 'left_late', take: 0 });
    const a = fig(r, 'e12a');
    expect(a).toMatchObject({ owed: 30000, open: 10000, wo: 0, remaining: 40000 });
    expect(a.seats[3]).toMatchObject({ no: 4, kind: 'vacant', c: false, open: 10000 });
    expect(a.seats[4]).toMatchObject({ no: 4, kind: 'desk', c: false });
    const b = fig(r, 'e12b');
    expect(b).toMatchObject({ owed: 30000, open: 0, wo: 10000, remaining: 30000, written_off: 10000 });
    expect(b.seats[3]).toMatchObject({ kind: 'vacant', wo: 10000, w: 'vacant' });
  });

  it('#13, #14, #16, #17: attended players owe, no-shows (account or walk-in) are written off, a correction owes again', () => {
    const f = fig(r, 'e13');
    expect(f).toMatchObject({ phase: 'started', owed: 20000, wo: 20000, open: 0, remaining: 20000, written_off: 20000 });
    expect(f.seats.map((s) => [s.no, s.w, s.owed, s.wo])).toEqual([
      [1, null, 10000, 0], [2, 'no_show', 0, 10000], [3, 'no_show', 0, 10000], [4, null, 10000, 0],
    ]);
    // court_fee_remaining nets the written-off shares (§6.3).
    expect(fig(r, 'e13_corrected')).toMatchObject({ owed: 30000, wo: 10000, remaining: 30000, written_off: 10000 });
  });

  it('#15: a walk-in on a no-show\'s number owes the share and nothing is written off for it (R4)', () => {
    const f = fig(r, 'e15');
    expect(f).toMatchObject({ owed: 40000, wo: 0, remaining: 40000 });
    expect(owedAll(f)).toEqual([10000, 10000, 10000, 10000]);
    expect(f.seats[2]).toMatchObject({ no: 3, kind: 'desk', c: true });
    expect(f.seats[4]).toMatchObject({ no: 3, kind: 'account', c: false, wo: 0 });
  });

  it('#26 and M7: an all no-show booking is not live: nothing owed, nothing written off', () => {
    expect(fig(r, 'e26')).toMatchObject({ phase: 'not_live', owed: 0, wo: 0, open: 0, delta: 0, remaining: 0,
                                          written_off: 0, paid: 0 });
    expect(fig(r, 'e26').seats.every((s) => s.owed === 0 && s.wo === 0 && s.credit === 0 && s.take === 0)).toBe(true);
  });

  it('#23 DF-4: a rise is booking money (delta), a fall credits the highest seats first (MD-9)', () => {
    expect(fig(r, 'up')).toMatchObject({ owed: 40000, delta: 5000, price_delta: 5000, remaining: 45000 });
    const d = fig(r, 'down');
    expect(d).toMatchObject({ owed: 36000, delta: 0, price_delta: -4000, remaining: 36000, over: 0 });
    expect(d.seats.map((s) => [s.credit, s.owed])).toEqual([[0, 10000], [0, 10000], [0, 10000], [4000, 6000]]);
  });

  it('M10: a sandbox match has no booking and every figure is 0', () => {
    expect(fig(r, 'sb')).toMatchObject({ phase: 'not_live', owed: 0, wo: 0, open: 0, paid: 0, remaining: 0,
                                         written_off: 0 });
  });

  it('M1 + M2: shares are core splitEvenly, and the booking is made at the match price', () => {
    expect(data(r, 'odd_book')).toBe('booked');
    const b = data<Json>(r, 'odd_booking');
    expect(b).toMatchObject({ price: 40001, guest_id: null, name: 'Open match' });
    expect(b.shares).toEqual(splitEvenly(40001, 4));
    expect(owedAll(fig(r, 'odd'))).toEqual(splitEvenly(40001, 4));
  });

  it('§6.3: a capped tab bills at most its cap; a match booking\'s normal bill bills what is still owed', () => {
    expect(data<Json>(r, 'cap_15000')).toMatchObject({ court_iqd: 15000, total_iqd: 15000, subtotal_iqd: 0 });
    expect(data<Json>(r, 'cap_50000')).toMatchObject({ court_iqd: 40000, total_iqd: 40000 });
    expect(data<Json>(r, 'normal_bill')).toMatchObject({ court_iqd: 30000, total_iqd: 30000 });
    expect(data<Json>(r, 'bill_live')).toMatchObject({ live_tab: { court_iqd: 30000, due_iqd: 30000 } });
  });

  it('booking_bill on a match booking: the match block, staff labels, ticket states, and no ticket money (M8)', () => {
    const b = data<Json>(r, 'bill_e13');
    expect(b).toMatchObject({
      live: true, court_paid_iqd: 0, court_remaining_iqd: 20000, court_written_off_iqd: 20000,
      online_paid_iqd: 0, online_payments: [],
      match: { status: 'booked', phase: 'started', price_iqd: 40000, booking_price_iqd: 40000, owed_iqd: 20000,
               written_off_iqd: 20000, open_iqd: 0, delta_owed_iqd: 0, paid_iqd: 0, desk_paid_iqd: 0,
               unassigned_iqd: 0, unassigned: [] },
    });
    const seats = b.seats as Json[];
    expect(seats.map((s) => [s.seat_no, s.label, s.ticket, s.write_off, s.write_off_reason])).toEqual([
      [1, 'Test g1', 'released', null, null], [2, 'Test g2', 'forfeited', 'no_show', null],
      [3, 'Walk-in e13c', 'none', 'no_show', null], [4, 'Nour Four', 'none', null, null],
    ]);
    // No phone ever reaches a cashier's read.
    expect(JSON.stringify(b)).not.toMatch(/\+964|phone/);
    expect(data<Json>(r, 'ticket_money')).toEqual({ purchases: expect.any(Number), deposit_net: 0, court_paid: 0 });
    expect((data<Json>(r, 'ticket_money').purchases as number) > 0).toBe(true);
  });

  it('M9: a booking with no match reads as before, with the new keys empty', () => {
    expect(data<Json>(r, 'bill_plain')).toMatchObject({
      match: null, seats: null, court_written_off_iqd: 0, court_remaining_iqd: 30000, court_paid_iqd: 0,
    });
    const states = data<Json[]>(r, 'states');
    const plain = states.find((s) => s.court_remaining_iqd === 30000)!;
    expect(plain).toMatchObject({ state: 'none', match_id: null, court_written_off_iqd: 0, seats_owing: null,
                                  seats_paid: null, seats_owed_iqd: null });
    const match = states.find((s) => s.match_id !== null)!;
    expect(match).toMatchObject({ state: 'none', court_remaining_iqd: 20000, court_written_off_iqd: 20000,
                                  seats_owing: 2, seats_paid: 0, seats_owed_iqd: 20000 });
  });

  it('every money invariant and the ticket ledger hold across the engine scenario', () => {
    expectChecksClean(r);
  });
});

// ── 2. match_seat_settle (Take share) ──────────────────────────────────────

describe.skipIf(!docker)('0262 match_seat_settle (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('m261s', [
      ...BASE,
      MK('shop', 'shop_staff'),
      ...OUTSIDER('outsider', 'cashier'),
      GUEST('g1'), GUEST('g2'),
      X(`select pg_temp.mbook('s1', 'c1', ${FUT(0)})`),
      X(`select pg_temp.ms('s1a', 's1', 1, 'account', 'g1')`),
      X(`select pg_temp.ms('s1b', 's1', 2, 'friend', 'g1')`),
      X(`select pg_temp.ms('s1c', 's1', 3, 'desk')`),
      X(`select pg_temp.ms('s1d', 's1', 4, 'desk')`),
      X(`select pg_temp.mbook('s2', 'c1', ${FUT(1)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('s2${'abcd'[n - 1]}', 's2', ${n}, 'desk')`)),
      X(`select pg_temp.mbook('s3', 'c1', ${FUT(2)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('s3${'abcd'[n - 1]}', 's3', ${n}, 'desk')`)),
      X(`select pg_temp.mbook('s4', 'c2', ${PAST(3)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('s4${'abcd'[n - 1]}', 's4', ${n}, 'desk', null, 'attended')`)),
      X(`select pg_temp.mbook('s5', 'c1', ${FUT(3)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('s5${'abcd'[n - 1]}', 's5', ${n}, 'desk')`)),
      X(`select pg_temp.mbook('odd', 'c2', ${FUT(4)}, '{"price_iqd":40001}')`),
      X(`select pg_temp.ms('odda', 'odd', 1, 'desk')`),
      K('sf', `select pg_temp.m(jsonb_build_object('start_at', ${FUT(5)}, 'organiser_id', null, 'organised_by', 'desk',
                                                   'created_by_staff_id', {{desk}}))`),
      X(`select pg_temp.ms('sfa', 'sf', 1, 'desk')`),
      K('sb', `select pg_temp.m(jsonb_build_object('status', 'booked', 'sandbox', true, 'start_at', ${FUT(6)}))`),
      X(`select pg_temp.ms('sba', 'sb', 1, 'desk')`),
      X(`select pg_temp.mbook('sx', 'c2', ${PAST(6)}, '{"status":"cancelled"}')`),
      X(`select pg_temp.ms('sxa', 'sx', 1, 'desk', null, 'attended')`),

      // No open day yet.
      T('no_day', 'desk', SETTLE(['s1a'], 'cash', 10000, { tendered: 10000, key: 'k-no-day' })),
      K('day', `select pg_temp.day()`),

      // The guard, then the arguments.
      E('anon', null, SETTLE(['s1a'], 'cash', 10000, { tendered: 10000 })),
      E('guest', 'g2', SETTLE(['s1a'], 'cash', 10000, { tendered: 10000 })),
      T('shop', 'shop', SETTLE(['s1a'], 'cash', 10000, { tendered: 10000 })),
      T('no_seats', 'desk', `select app.match_seat_settle('{}'::uuid[], 'cash', 10000, 10000, null, 'k-ns', null)`),
      T('five', 'desk', SETTLE(['s1a', 's1b', 's1c', 's1d', 's2a'], 'card', 50000)),
      T('dup', 'desk', SETTLE(['s1a', 's1a'], 'card', 20000)),
      T('no_method', 'desk', SETTLE(['s1a'], 'null', 10000)),
      T('no_expected', 'desk', SETTLE(['s1a'], 'card', null)),
      T('zero_amount', 'desk', SETTLE(['s1a'], 'card', 10000, { amount: 0 })),
      T('no_key', 'desk', SETTLE(['s1a'], 'card', 10000, { key: null })),
      T('unknown', 'desk', `select app.match_seat_settle(array['${NIL}']::uuid[], 'card', 10000, null, null, 'k-u', null)`),
      T('two_matches', 'desk', SETTLE(['s1a', 's2a'], 'card', 20000)),
      T('sandbox', 'desk', SETTLE(['sba'], 'card', 10000)),
      T('outsider', 'outsider', SETTLE(['s1a'], 'card', 10000)),
      T('filling', 'desk', SETTLE(['sfa'], 'card', 10000)),
      T('cancelled', 'desk', SETTLE(['sxa'], 'card', 10000)),

      // One seat, cash with change: one capped tab, settled, one link.
      T('one', 'desk', SETTLE(['s1a'], 'cash', 10000, { tendered: 20000, key: 'k-one', device: 'M261-DESK' })),
      RES('one_tab', 'one', 'tab_id'),
      Q('one_tab', `select pg_temp.tab('one_tab')`),
      Q('one_live', `select to_jsonb(pg_temp.live_tabs('s1_res'))`),
      Q('one_payment', `select jsonb_build_object('method', p.method, 'amount', p.amount_iqd, 'tendered', p.tendered_iqd,
                                                  'change', p.change_iqd, 'day', p.day_session_id = {{day}},
                                                  'device', p.device_id, 'by_desk', p.recorded_by = {{desk}})
                          from payments p where p.tab_id = {{one_tab}}`),
      CHECK('one', ['s1']),
      // A replay answers the stored result; the key under another caller is a conflict.
      T('one_again', 'desk', SETTLE(['s1a'], 'cash', 10000, { tendered: 20000, key: 'k-one', device: 'M261-DESK' })),
      T('one_conflict', 'cashier', SETTLE(['s1a'], 'cash', 10000, { tendered: 20000, key: 'k-one' })),
      // The paid seat owes nothing; a stale expected sum is refused with both figures.
      T('paid_seat', 'desk', SETTLE(['s1a'], 'cash', 10000, { tendered: 10000 })),
      T('changed', 'desk', SETTLE(['s1b', 's1c'], 'card', 25000)),
      T('too_much', 'desk', SETTLE(['s1b'], 'card', 10000, { amount: 15000 })),
      // Several seats, by a cashier, by card.
      T('several', 'cashier', SETTLE(['s1b', 's1c'], 'card', 20000, { key: 'k-several' })),
      CHECK('several', ['s1']),
      // The till's refusals come through.
      T('short', 'desk', SETTLE(['s1d'], 'cash', 10000, { tendered: 5000 })),
      T('card_tendered', 'desk', SETTLE(['s1d'], 'card', 10000, { tendered: 10000 })),
      // A part payment settles its own tab; the seat owes the rest.
      T('part', 'desk', SETTLE(['s1d'], 'card', 10000, { amount: 4000, key: 'k-part' })),
      RES('part_tab', 'part', 'tab_id'),
      Q('part_tab', `select pg_temp.tab('part_tab')`),
      CHECK('part', ['s1']),
      T('bill_s1', 'cashier', `select app.booking_bill({{s1_res}})`),

      // An empty normal bill is adopted (MD-8) ...
      T('open_s2', 'desk', `select app.open_tab(null, null, {{s2_res}}, 'k-open-s2', null)`),
      RES('s2_tab', 'open_s2', 'tab_id'),
      T('adopt', 'desk', SETTLE(['s2a', 's2b'], 'cash', 20000, { tendered: 20000, key: 'k-adopt' })),
      Q('adopt_tab', `select pg_temp.tab('s2_tab')`),
      Q('adopt_live', `select to_jsonb(pg_temp.live_tabs('s2_res'))`),
      CHECK('adopt', ['s2']),
      // ... a paid one is refused: it is closed through Assign first.
      ...BILL('s3', 's3_res', 'card', 5000),
      T('tab_open', 'desk', SETTLE(['s3a'], 'card', 10000)),
      CHECK('tab_open', ['s3']),

      // MD-11: collecting a manually written-off share clears the write-off.
      X(`update match_seats set written_off_by_staff_id = {{desk}}, written_off_at = now(), write_off_reason = 'walked_out'
          where id = {{s4a}}`),
      Q('s4_before', `select pg_temp.fig('s4')`),
      T('collect', 'desk', SETTLE(['s4a'], 'cash', 10000, { tendered: 10000, key: 'k-collect' })),
      Q('s4_seat', `select jsonb_build_object('at', written_off_at, 'by', written_off_by_staff_id, 'reason', write_off_reason)
                      from match_seats where id = {{s4a}}`),
      Q('s4_audit', `select jsonb_build_object(
          'cleared', (select count(*) from audit_log where action = 'match.seat_write_off_cleared' and entity_id = {{s4a}}::text),
          'settled', (select count(*) from audit_log where action = 'match.seat_settle' and entity_id = {{s4}}::text))`),
      Q('s4_after', `select pg_temp.fig('s4')`),
      CHECK('collect', ['s4']),

      // Drift: the booking was re-priced (DF-4 fall) since the desk read it.
      X(`update reservations set price_iqd = 36000 where id = {{s5_res}}`),
      T('drift', 'desk', SETTLE(['s5d'], 'card', 10000)),
      T('drift_ok', 'desk', SETTLE(['s5d'], 'card', 6000, { key: 'k-drift-ok' })),
      CHECK('drift', ['s5']),

      // An awkward price: seat 1 owes 10,001 (DF-3).
      T('odd', 'desk', SETTLE(['odda'], 'card', 10001, { key: 'k-odd' })),
      CHECK('odd', ['odd']),
      Q('settle_audits', `select to_jsonb(count(*)) from audit_log where action = 'match.seat_settle' and entity_id = {{s1}}::text`),
    ]);
  });

  it('refuses in the §6.4 order: no open day, the guard, every argument, the seats', () => {
    expect(failed(r, 'no_day').code).toBe('NO_OPEN_DAY');
    expect(failed(r, 'anon').code).toBe('FORBIDDEN');
    expect(failed(r, 'guest').code).toBe('FORBIDDEN');
    expect(failed(r, 'shop').code).toBe('FORBIDDEN');
    for (const l of ['no_seats', 'five', 'dup']) {
      expect(failed(r, l), l).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_seat_ids' });
    }
    expect(failed(r, 'no_method')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_method' });
    expect(failed(r, 'no_expected')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_expected_owed_iqd' });
    expect(failed(r, 'zero_amount')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_amount_iqd' });
    expect(failed(r, 'no_key')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_idempotency_key' });
    for (const l of ['unknown', 'two_matches', 'sandbox', 'outsider']) {
      expect(failed(r, l).code, l).toBe('SEAT_NOT_FOUND');
    }
    expect(failed(r, 'filling').code).toBe('MATCH_NOT_BOOKED');
    expect(failed(r, 'cancelled').code).toBe('MATCH_NOT_BOOKED');
  });

  it('one seat: one fresh tab at the match\'s branch and day, capped and settled, one link (M5)', () => {
    const one = data<Json>(r, 'one');
    expect(one).toMatchObject({
      duplicate: false, amount_iqd: 10000, change_iqd: 10000, cleared_write_offs: [], booking_remaining_iqd: 30000,
      seats: [{ seat_no: 1, applied_iqd: 10000, owed_iqd: 0 }],
    });
    expect(data(r, 'one_tab')).toEqual({ status: 'settled', court: 10000, cap: 10000, total: 10000, kind: 'cafe',
                                         branch: true, links: [{ seat: 1, amount: 10000 }] });
    expect(data(r, 'one_live')).toBe(0);
    expect(data(r, 'one_payment')).toEqual({ method: 'cash', amount: 10000, tendered: 20000, change: 10000, day: true,
                                             device: 'M261-DESK', by_desk: true });
  });

  it('a replay answers the stored result; the key under another caller is IDEMPOTENCY_CONFLICT', () => {
    const again = data<Json>(r, 'one_again');
    expect(again).toMatchObject({ duplicate: true, payment_id: data<Json>(r, 'one').payment_id });
    expect(failed(r, 'one_conflict').code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('NOTHING_OWED names the seat; SEAT_OWED_CHANGED says expected and now; INVALID_AMOUNT above the sum', () => {
    const one = data<Json>(r, 'one');
    expect(failed(r, 'paid_seat')).toMatchObject({ code: 'NOTHING_OWED' });
    expect(failed(r, 'paid_seat').detail).toBe((one.seats as Json[])[0]!.seat_id);
    expect(failed(r, 'changed')).toMatchObject({ code: 'SEAT_OWED_CHANGED', detail: 'expected 25000, now 20000' });
    expect(failed(r, 'too_much').code).toBe('INVALID_AMOUNT');
  });

  it('several seats in one payment, spread in the order given', () => {
    expect(data<Json>(r, 'several')).toMatchObject({
      duplicate: false, amount_iqd: 20000, change_iqd: null, booking_remaining_iqd: 10000,
      seats: [{ seat_no: 2, applied_iqd: 10000, owed_iqd: 0 }, { seat_no: 3, applied_iqd: 10000, owed_iqd: 0 }],
    });
  });

  it('the till\'s own refusals: TENDER_SHORT, TENDER_CARD', () => {
    expect(failed(r, 'short').code).toBe('TENDER_SHORT');
    expect(failed(r, 'card_tendered').code).toBe('TENDER_CARD');
  });

  it('a part payment settles its tab in full; the seat owes the rest', () => {
    expect(data<Json>(r, 'part')).toMatchObject({
      amount_iqd: 4000, booking_remaining_iqd: 6000, seats: [{ seat_no: 4, applied_iqd: 4000, owed_iqd: 6000 }],
    });
    expect(data(r, 'part_tab')).toMatchObject({ status: 'settled', court: 4000, cap: 4000, total: 4000,
                                                links: [{ seat: 4, amount: 4000 }] });
    const bill = data<Json>(r, 'bill_s1');
    expect(bill).toMatchObject({ court_paid_iqd: 34000, court_remaining_iqd: 6000, live_tab: null,
                                 match: { owed_iqd: 6000, paid_iqd: 34000, desk_paid_iqd: 34000 } });
    // One transaction: the three tabs share settled_at, so their order is not asserted.
    const pays = (bill.settled_tabs as Json[]).map((t) => (t.payments as Json[])[0]!.seats);
    expect(pays).toHaveLength(3);
    expect(pays).toEqual(expect.arrayContaining([
      [{ seat_no: 1, amount_iqd: 10000 }],
      [{ seat_no: 2, amount_iqd: 10000 }, { seat_no: 3, amount_iqd: 10000 }],
      [{ seat_no: 4, amount_iqd: 4000 }],
    ]));
    expect(data(r, 'settle_audits')).toBe(3);
  });

  it('MD-8: an empty live bill is adopted and capped; a paid one is BOOKING_TAB_OPEN with its id', () => {
    const adopt = data<Json>(r, 'adopt');
    expect(adopt.tab_id).toBe(data<Json>(r, 'open_s2').tab_id);
    expect(data(r, 'adopt_tab')).toMatchObject({ status: 'settled', court: 20000, cap: 20000, total: 20000 });
    expect(data(r, 'adopt_live')).toBe(0);
    expect(failed(r, 'tab_open')).toMatchObject({ code: 'BOOKING_TAB_OPEN', detail: data<Json>(r, 'open_s3').tab_id });
  });

  it('MD-11: Take share collects a manually written-off share and clears the write-off', () => {
    expect(fig(r, 's4_before').seats[0]).toMatchObject({ w: 'manual', wo: 10000, owed: 0, take: 10000 });
    expect(data<Json>(r, 'collect')).toMatchObject({ amount_iqd: 10000,
                                                     cleared_write_offs: [expect.any(String)] });
    expect(data(r, 's4_seat')).toEqual({ at: null, by: null, reason: null });
    expect(data(r, 's4_audit')).toEqual({ cleared: 1, settled: 1 });
    expect(fig(r, 's4_after').seats[0]).toMatchObject({ w: null, wo: 0, owed: 0, paid: 10000 });
  });

  it('drift: a re-price since the read is SEAT_OWED_CHANGED; the new figure settles', () => {
    expect(failed(r, 'drift')).toMatchObject({ code: 'SEAT_OWED_CHANGED', detail: 'expected 10000, now 6000' });
    expect(data<Json>(r, 'drift_ok')).toMatchObject({ amount_iqd: 6000, booking_remaining_iqd: 30000 });
  });

  it('an awkward price: the first seat owes one dinar more (DF-3)', () => {
    expect(data<Json>(r, 'odd')).toMatchObject({ amount_iqd: 10001, booking_remaining_iqd: 30000 });
  });

  it('every money invariant and the ticket ledger hold after each settle', () => {
    expectChecksClean(r);
  });
});

// ── 3. match_link_payment (Assign) ─────────────────────────────────────────

describe.skipIf(!docker)('0262 match_link_payment (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('m261l', [
      ...BASE,
      MK('shop', 'shop_staff'),
      ...OUTSIDER('outsider', 'cashier'),
      K('day', `select pg_temp.day()`),
      X(`select pg_temp.mbook('l1', 'c1', ${FUT(0)})`),
      X(`select pg_temp.ms('l1x', 'l1', 4, 'desk', null, 'left')`),     // left before booking: carries nothing
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('l1${'abcd'[n - 1]}', 'l1', ${n}, 'desk')`)),
      X(`select pg_temp.mbook('l2', 'c1', ${FUT(1)})`),
      X(`select pg_temp.ms('l2a', 'l2', 1, 'desk')`),
      X(`select pg_temp.mbook('l3', 'c1', ${FUT(2)}, '{"booking_price_iqd":45000}')`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('l3${'abcd'[n - 1]}', 'l3', ${n}, 'desk')`)),
      X(`select pg_temp.mbook('l4', 'c1', ${FUT(3)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('l4${'abcd'[n - 1]}', 'l4', ${n}, 'desk')`)),
      X(`select pg_temp.mbook('l5', 'c2', ${PAST(3)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('l5${'abcd'[n - 1]}', 'l5', ${n}, 'desk', null, 'attended')`)),
      X(`select pg_temp.mbook('l6', 'c2', ${PAST(6)})`),
      X(`select pg_temp.ms('l6a', 'l6', 1, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('l6b', 'l6', 2, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('l6c', 'l6', 3, 'desk', null, 'no_show')`),
      X(`select pg_temp.ms('l6d', 'l6', 4, 'desk', null, 'attended')`),
      X(`select pg_temp.mbook('l7', 'c1', ${FUT(5)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('l7${'abcd'[n - 1]}', 'l7', ${n}, 'desk')`)),
      X(`select pg_temp.plain('plain', 'c2', ${FUT(4)}, 30000)`),

      // A partly paid normal bill on l1 (the offline path).
      ...BILL('l1', 'l1_res', 'card', 15000),

      // The guard, then the arguments.
      T('shop', 'shop', LINK('l1_pay', '[]', 'k-shop')),
      T('no_key', 'desk', LINK('l1_pay', '[]', null)),
      T('not_array', 'desk', LINK('l1_pay', '{}', 'k-na')),
      T('five', 'desk', LINK('l1_pay', [['l1a', 1], ['l1b', 1], ['l1c', 1], ['l1d', 1], ['l2a', 1]], 'k-five')),
      T('zero', 'desk', LINK('l1_pay', [['l1a', 0]], 'k-zero')),
      T('dup', 'desk', LINK('l1_pay', [['l1a', 1], ['l1a', 1]], 'k-dup')),
      T('nil', 'desk', `select app.match_link_payment('${NIL}', '[]'::jsonb, 'k-nil')`),
      T('outsider', 'outsider', LINK('l1_pay', [['l1a', 1000]], 'k-out')),
      ...BILL('plain', 'plain', 'card', null),
      T('not_on_match', 'desk', LINK('plain_pay', [['l1a', 1000]], 'k-nom')),
      T('other_seat', 'desk', LINK('l1_pay', [['l2a', 1000]], 'k-os')),

      // #22: the partly paid bill closed at what was paid, the payment assigned.
      T('close_l1', 'desk', LINK('l1_pay', [['l1a', 10000], ['l1b', 5000]], 'k-close-l1')),
      Q('l1_tab', `select pg_temp.tab('l1_tab')`),
      Q('l1_after', `select pg_temp.fig('l1')`),
      Q('l1_live', `select to_jsonb(pg_temp.live_tabs('l1_res'))`),
      CHECK('close_l1', ['l1']),
      T('close_l1_again', 'desk', LINK('l1_pay', [['l1a', 10000], ['l1b', 5000]], 'k-close-l1')),
      T('already', 'desk', LINK('l1_pay', [['l1a', 1]], 'k-already')),
      T('over_alloc', 'desk', LINK('l1_pay', [['l1c', 1]], 'k-over-alloc')),
      // A second bill: a refusal leaves it open (the close rolls back with it).
      ...BILL('l1b', 'l1_res', 'cash', 5000),
      T('over_seat', 'desk', LINK('l1b_pay', [['l1a', 1]], 'k-over-seat')),
      T('left_seat', 'desk', LINK('l1b_pay', [['l1x', 1000]], 'k-left-seat')),
      Q('l1b_still_live', `select to_jsonb(pg_temp.live_tabs('l1_res'))`),
      T('close_l1b', 'desk', LINK('l1b_pay', [['l1c', 5000]], 'k-close-l1b')),
      Q('l1_final', `select pg_temp.fig('l1')`),
      CHECK('close_l1b', ['l1']),

      // #23: a price rise taken on the normal bill, closed with [] (C22).
      ...BILL('l3', 'l3_res', 'card', 5000),
      Q('l3_before', `select pg_temp.fig('l3')`),
      T('rise', 'desk', LINK('l3_pay', '[]', 'k-rise')),
      Q('l3_after', `select pg_temp.fig('l3')`),
      T('rise_again', 'desk', LINK('l3_pay', '[]', 'k-rise-again')),
      CHECK('rise', ['l3']),

      // over_paid: more was paid on the bill than the booking now owes.
      T('l4_settle', 'desk', SETTLE(['l4a', 'l4b', 'l4c'], 'card', 30000, { key: 'k-l4-settle' })),
      ...BILL('l4', 'l4_res', 'card', 8000),
      X(`update reservations set price_iqd = 32000 where id = {{l4_res}}`),
      T('over_paid', 'desk', LINK('l4_pay', '[]', 'k-over-paid')),
      X(`update reservations set price_iqd = 40000 where id = {{l4_res}}`),
      T('l4_close', 'desk', LINK('l4_pay', [['l4d', 8000]], 'k-l4-close')),
      Q('l4_after', `select pg_temp.fig('l4')`),
      CHECK('l4', ['l4']),

      // #21: the organiser paid everyone on the normal bill: the pool credits
      // every seat; Assign makes it exact.
      ...BILL('l5', 'l5_res', 'card', null),
      Q('l5_pool', `select pg_temp.fig('l5')`),
      T('l5_states', 'desk', `select app.booking_bill_states(array[{{l5_res}}]::uuid[])`),
      T('assign_l5', 'desk', LINK('l5_pay', [['l5a', 10000], ['l5b', 10000], ['l5c', 10000], ['l5d', 10000]], 'k-l5')),
      Q('l5_exact', `select pg_temp.fig('l5')`),
      T('l5_states_after', 'desk', `select app.booking_bill_states(array[{{l5_res}}]::uuid[])`),
      CHECK('l5', ['l5']),

      // A link on a no-show is allowed: the organiser paid for the absent friend.
      ...BILL('l6', 'l6_res', 'cash', 10000),
      T('no_show_link', 'desk', LINK('l6_pay', [['l6c', 10000]], 'k-l6')),
      Q('l6_after', `select pg_temp.fig('l6')`),
      CHECK('l6', ['l6']),

      // empty: the only payment on the live bill was refunded.
      ...BILL('l7', 'l7_res', 'card', 5000),
      X(`insert into refunds (payment_id, amount_iqd, reason_code, refunded_by, venue_id)
         values ({{l7_pay}}, 5000, 'fixture', {{manager}}, {{v}})`),
      T('empty', 'desk', LINK('l7_pay', '[]', 'k-empty')),
      CHECK('l7', ['l7']),
      Q('link_audits', `select to_jsonb(count(*)) from audit_log where action = 'match.payment_link'
                         and entity_id in ({{l1_pay}}::text, {{l1b_pay}}::text)`),
    ]);
  });

  it('refuses in the §6.5 order', () => {
    expect(failed(r, 'shop').code).toBe('FORBIDDEN');
    expect(failed(r, 'no_key')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_idempotency_key' });
    for (const l of ['not_array', 'five', 'zero', 'dup']) {
      expect(failed(r, l), l).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_allocations' });
    }
    expect(failed(r, 'nil').code).toBe('PAYMENT_NOT_FOUND');
    expect(failed(r, 'outsider').code).toBe('PAYMENT_NOT_FOUND');
    expect(data<Json>(r, 'pay_plain')).toMatchObject({ status: 'settled' });
    expect(failed(r, 'not_on_match').code).toBe('PAYMENT_NOT_ON_MATCH');
    expect(failed(r, 'other_seat').code).toBe('SEAT_NOT_FOUND');
  });

  it('#22: a partly paid bill closes at what was paid and the payment goes to the seats named (R2)', () => {
    expect(data<Json>(r, 'pay_l1')).toMatchObject({ status: 'awaiting_payment' });
    expect(data<Json>(r, 'close_l1')).toMatchObject({
      duplicate: false, tab_closed: true, unassigned_iqd: 0,
      links: [{ seat_no: 1, amount_iqd: 10000 }, { seat_no: 2, amount_iqd: 5000 }],
    });
    expect(data(r, 'l1_tab')).toMatchObject({ status: 'settled', court: 15000, cap: 15000, total: 15000 });
    expect(data(r, 'l1_live')).toBe(0);
    const f = fig(r, 'l1_after');
    expect(f).toMatchObject({ owed: 25000, remaining: 25000, paid: 15000 });
    expect(f.seats.slice(0, 4).map((s) => [s.paid, s.owed])).toEqual([[10000, 0], [5000, 5000], [0, 10000], [0, 10000]]);
    expect(f.seats[4]).toMatchObject({ kind: 'desk', c: false, paid: 0 });
    expect(data<Json>(r, 'close_l1_again')).toMatchObject({ duplicate: true });
  });

  it('already_linked, PAYMENT_OVER_ALLOCATED, AMOUNT_OVER_SEAT, a non-carrier; a refusal leaves the bill open', () => {
    expect(failed(r, 'already')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'already_linked' });
    expect(failed(r, 'over_alloc').code).toBe('PAYMENT_OVER_ALLOCATED');
    expect(failed(r, 'over_seat').code).toBe('AMOUNT_OVER_SEAT');
    expect(failed(r, 'left_seat').code).toBe('NOTHING_OWED');
    expect(data(r, 'l1b_still_live')).toBe(1);
    expect(data<Json>(r, 'close_l1b')).toMatchObject({ tab_closed: true, links: [{ seat_no: 3, amount_iqd: 5000 }] });
    expect(fig(r, 'l1_final')).toMatchObject({ owed: 20000, remaining: 20000, paid: 20000 });
    expect(data(r, 'link_audits')).toBe(2);
  });

  it('#23: [] closes the bill that paid a price rise; [] on a closed bill is refused', () => {
    expect(fig(r, 'l3_before')).toMatchObject({ delta: 5000, owed: 40000, remaining: 45000 });
    expect(data<Json>(r, 'rise')).toMatchObject({ tab_closed: true, links: [], unassigned_iqd: 5000 });
    expect(fig(r, 'l3_after')).toMatchObject({ delta: 0, owed: 40000, remaining: 40000, paid: 5000 });
    expect(failed(r, 'rise_again')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_allocations' });
  });

  it('over_paid: a bill paid beyond what the booking now owes is PAYMENT_STATE over_paid', () => {
    expect(failed(r, 'over_paid')).toMatchObject({ code: 'PAYMENT_STATE', detail: 'over_paid' });
    expect(data<Json>(r, 'l4_close')).toMatchObject({ tab_closed: true });
    expect(fig(r, 'l4_after')).toMatchObject({ owed: 2000, remaining: 2000 });
  });

  it('#21: the pool credits every seat of a bill the organiser paid; Assign makes it exact', () => {
    const pool = fig(r, 'l5_pool');
    expect(pool).toMatchObject({ owed: 0, remaining: 0, paid: 40000, unassigned: 40000, unassigned_rows: 1 });
    expect(pool.seats.map((s) => [s.paid, s.credit, s.owed])).toEqual([
      [0, 10000, 0], [0, 10000, 0], [0, 10000, 0], [0, 10000, 0],
    ]);
    expect(data<Json[]>(r, 'l5_states')[0]).toMatchObject({ state: 'paid', seats_owing: 0, seats_paid: 0 });
    expect(data<Json>(r, 'assign_l5')).toMatchObject({ tab_closed: false, unassigned_iqd: 0 });
    const exact = fig(r, 'l5_exact');
    expect(exact).toMatchObject({ owed: 0, unassigned: 0, unassigned_rows: 0 });
    expect(exact.seats.map((s) => [s.paid, s.credit])).toEqual([[10000, 0], [10000, 0], [10000, 0], [10000, 0]]);
    expect(data<Json[]>(r, 'l5_states_after')[0]).toMatchObject({ seats_paid: 4, seats_owing: 0 });
  });

  it('a link on a no-show lowers what is written off', () => {
    const f = fig(r, 'l6_after');
    expect(f).toMatchObject({ wo: 0, owed: 30000, remaining: 30000, paid: 10000 });
    expect(f.seats[2]).toMatchObject({ no: 3, paid: 10000, wo: 0, w: null });
  });

  it('a live bill whose payment was refunded is PAYMENT_STATE empty', () => {
    expect(failed(r, 'empty')).toMatchObject({ code: 'PAYMENT_STATE', detail: 'empty' });
  });

  it('every money invariant and the ticket ledger hold after each Assign', () => {
    expectChecksClean(r);
  });
});

// ── 4. match_seat_write_off (R1) ───────────────────────────────────────────

describe.skipIf(!docker)('0262 match_seat_write_off (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('m261w', [
      ...BASE,
      ...OUTSIDER('outdesk', 'court_desk'),
      GUEST('g1'),
      K('day', `select pg_temp.day()`),
      X(`select pg_temp.mbook('w1', 'c1', ${PAST(3)})`),
      X(`select pg_temp.ms('w1a', 'w1', 1, 'desk')`),
      X(`select pg_temp.ms('w1b', 'w1', 2, 'account', 'g1', 'attended')`),
      X(`select pg_temp.ms('w1c', 'w1', 3, 'desk', null, 'no_show')`),
      X(`select pg_temp.ms('w1d', 'w1', 4, 'desk')`),
      X(`select pg_temp.mbook('w2', 'c1', ${FUT(0)})`),
      X(`select pg_temp.ms('w2a', 'w2', 1, 'desk')`),
      X(`select pg_temp.mbook('w3', 'c2', ${PAST(3)}, '{"status":"played"}')`),
      X(`select pg_temp.ms('w3a', 'w3', 1, 'desk', null, 'attended')`),
      X(`select pg_temp.mbook('w4', 'c2', ${PAST(6)}, '{"status":"cancelled"}')`),
      X(`select pg_temp.ms('w4a', 'w4', 1, 'desk', null, 'attended')`),

      T('cashier', 'cashier', `select app.match_seat_write_off({{w1a}}, 'walked_out', '${MANAGER_PIN}')`),
      T('no_reason', 'desk', `select app.match_seat_write_off({{w1a}}, '', '${MANAGER_PIN}')`),
      T('bad_reason', 'desk', `select app.match_seat_write_off({{w1a}}, 'lazy', '${MANAGER_PIN}')`),
      T('nil', 'desk', `select app.match_seat_write_off('${NIL}', 'walked_out', '${MANAGER_PIN}')`),
      T('outdesk', 'outdesk', `select app.match_seat_write_off({{w1a}}, 'walked_out', '${MANAGER_PIN}')`),
      T('no_grant', 'desk', `select app.match_seat_write_off({{w1a}}, 'walked_out', '${MANAGER_PIN}')`),

      // The court desk proves the manager's PIN, then writes off.
      T('pin', 'desk', `select to_jsonb(app.verify_manager_pin('${MANAGER_PIN}'))`),
      T('write_off', 'desk', `select app.match_seat_write_off({{w1a}}, 'walked_out', '${MANAGER_PIN}', 'M261-DESK')`),
      Q('w1a_seat', `select jsonb_build_object('by_desk', written_off_by_staff_id = {{desk}}, 'reason', write_off_reason,
                                               'at', written_off_at is not null) from match_seats where id = {{w1a}}`),
      Q('w1_audit', `select jsonb_build_object('authorizer_is_manager', authorizer_id = {{manager}}, 'reason', reason_code,
                                               'device', device_id, 'after', after)
                       from audit_log where action = 'match.seat_write_off' and entity_id = {{w1a}}::text`),
      Q('w1_grants', `select to_jsonb(count(*)) from app.pin_grants where caller_id = {{desk}} and consumed_at is null`),
      Q('w1_after', `select pg_temp.fig('w1')`),
      CHECK('write_off', ['w1']),

      // Already written off: answered before a grant is spent.
      GRANT('desk'),
      T('again', 'desk', `select app.match_seat_write_off({{w1a}}, 'walked_out', '${MANAGER_PIN}')`),
      // Only this scenario's grants: `desk` is the seeded account, and committed
      // suites leave their own unspent grants on it, so a bare count drifted
      // with test order (10 instead of 1 on a second local run). The scenario is
      // one transaction, so its inserts carry now().
      Q('grants_after_again', `select to_jsonb(count(*)) from app.pin_grants
                                 where caller_id = {{desk}} and consumed_at is null and created_at = now()`),
      T('not_started', 'desk', `select app.match_seat_write_off({{w2a}}, 'walked_out', '${MANAGER_PIN}')`),
      T('no_show', 'desk', `select app.match_seat_write_off({{w1c}}, 'walked_out', '${MANAGER_PIN}')`),
      T('cancelled', 'desk', `select app.match_seat_write_off({{w4a}}, 'walked_out', '${MANAGER_PIN}')`),
      // C22: a played match's share can be forgiven too (a manager, their own PIN).
      GRANT('manager'),
      T('played', 'manager', `select app.match_seat_write_off({{w3a}}, 'staff_error', '${MANAGER_PIN}')`),
      CHECK('played', ['w3']),

      // MD-11: the player comes back and pays; Take share clears it.
      T('collect', 'desk', SETTLE(['w1a'], 'cash', 10000, { tendered: 10000, key: 'k-w1a' })),
      Q('w1_collected', `select pg_temp.fig('w1')`),
      CHECK('collect', ['w1']),
    ]);
  });

  it('refuses in the §6.6 order, before any grant is spent', () => {
    expect(failed(r, 'cashier').code).toBe('FORBIDDEN');
    expect(failed(r, 'no_reason').code).toBe('REASON_REQUIRED');
    expect(failed(r, 'bad_reason').code).toBe('REASON_REQUIRED');
    expect(failed(r, 'nil').code).toBe('SEAT_NOT_FOUND');
    expect(failed(r, 'outdesk').code).toBe('SEAT_NOT_FOUND');
    expect(failed(r, 'no_grant').code).toBe('PIN_GRANT_REQUIRED');
  });

  it('R1: the court desk writes off with a manager\'s PIN; the manager is the authoriser; the grant is spent', () => {
    expect(data(r, 'pin')).toBe(SEED_STAFF_IDS.manager);
    expect(data<Json>(r, 'write_off')).toMatchObject({ duplicate: false, seat_no: 1, written_off_iqd: 10000,
                                                       booking_remaining_iqd: 20000 });
    expect(data(r, 'w1a_seat')).toEqual({ by_desk: true, reason: 'walked_out', at: true });
    expect(data<Json>(r, 'w1_audit')).toMatchObject({ authorizer_is_manager: true, reason: 'walked_out',
                                                      device: 'M261-DESK', after: { written_off_iqd: 10000 } });
    expect(data(r, 'w1_grants')).toBe(0);
    const f = fig(r, 'w1_after');
    expect(f).toMatchObject({ owed: 20000, wo: 20000, remaining: 20000, written_off: 20000 });
    expect(f.seats[0]).toMatchObject({ w: 'manual', wo: 10000, owed: 0, take: 10000 });
  });

  it('duplicate spends no grant; not started, a no-show and a cancelled match are refused', () => {
    expect(data<Json>(r, 'again')).toMatchObject({ duplicate: true, seat_no: 1, written_off_iqd: 10000 });
    expect(data(r, 'grants_after_again')).toBe(1);
    expect(failed(r, 'not_started').code).toBe('SEAT_NOT_STARTED');
    expect(failed(r, 'no_show').code).toBe('NOTHING_OWED');
    expect(failed(r, 'cancelled').code).toBe('MATCH_NOT_BOOKED');
  });

  it('C22: a played match\'s share is forgiven too', () => {
    // One seat of four: the three vacant numbers are written off on their own.
    expect(data<Json>(r, 'played')).toMatchObject({ duplicate: false, written_off_iqd: 10000, booking_remaining_iqd: 0 });
  });

  it('MD-11: collecting the share clears the write-off', () => {
    expect(data<Json>(r, 'collect')).toMatchObject({ cleared_write_offs: [expect.any(String)], booking_remaining_iqd: 20000 });
    expect(fig(r, 'w1_collected').seats[0]).toMatchObject({ w: null, wo: 0, paid: 10000 });
  });

  it('every money invariant and the ticket ledger hold', () => {
    expectChecksClean(r);
  });
});

// ── 5. The DF-16 wall (R20) ────────────────────────────────────────────────

describe.skipIf(!docker)('0262 the DF-16 wall (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('m261d', [
      ...BASE,
      K('day', `select pg_temp.day()`),
      X(`select pg_temp.mbook('d1', 'c1', ${FUT(0)})`),
      ...[1, 2, 3, 4].map((n) => X(`select pg_temp.ms('d1${'abcd'[n - 1]}', 'd1', ${n}, 'desk')`)),
      X(`select pg_temp.plain('plain', 'c2', ${FUT(1)}, 30000)`),
      // The court-only bill (the offline path) opens.
      T('open_d1', 'desk', `select app.open_tab(null, null, {{d1_res}}, 'k-open-d1', null)`),
      RES('d1_tab', 'open_d1', 'tab_id'),
      // Every café path writes orders or tab_adjustments: a till item, a floor
      // order, a queued order.create (orders); a discount, a promotion, a
      // queued adjustment.apply (tab_adjustments); a merge moves both.
      E('order', null, `insert into orders (tab_id, source, venue_id) values ({{d1_tab}}, 'till', {{v}}) returning to_jsonb(id)`),
      E('adjustment', null, `insert into tab_adjustments (tab_id, kind, value, amount_iqd, applied_by, authorized_by, reason_code)
                             values ({{d1_tab}}, 'discount_amount', 1000, 1000, {{manager}}, {{manager}}, 'fixture')
                             returning to_jsonb(id)`),
      GRANT('manager'),
      T('discount', 'manager', `select app.apply_discount({{d1_tab}}, 'discount_amount', 1000, '${MANAGER_PIN}', 'goodwill',
                                                          null, null, 'k-discount')`),
      K('donor', `insert into tabs (venue_id, day_session_id, label, kind) values ({{v}}, {{day}}, 'M261 donor', 'cafe')
                  returning id`),
      K('donor_order', `insert into orders (tab_id, source, venue_id) values ({{donor}}, 'till', {{v}}) returning id`),
      T('merge', 'desk', `select app.merge_tabs({{donor}}, {{d1_tab}})`),
      E('move', null, `update orders set tab_id = {{d1_tab}} where id = {{donor_order}} returning to_jsonb(id)`),
      Q('donor_order_tab', `select to_jsonb(tab_id = {{donor}}) from orders where id = {{donor_order}}`),
      // Only a match booking is walled: a plain booking's bill takes café orders.
      T('open_plain', 'desk', `select app.open_tab(null, null, {{plain}}, 'k-open-plain', null)`),
      RES('plain_tab', 'open_plain', 'tab_id'),
      E('plain_order', null, `insert into orders (tab_id, source, venue_id) values ({{plain_tab}}, 'till', {{v}}) returning to_jsonb(true)`),
      // The court-only bill still settles, as booking money the pool credits.
      T('pay_d1', 'desk', `select app.settle_tab({{d1_tab}}, 'card', null, null, 'k-pay-d1', null, null)`),
      Q('d1_after', `select pg_temp.fig('d1')`),
      CHECK('wall', ['d1']),
    ]);
  });

  it('R20: an order, an adjustment, a discount, a merge and a moved order are refused on a match booking\'s tab', () => {
    for (const l of ['order', 'adjustment', 'discount', 'merge', 'move']) {
      expect(failed(r, l), l).toMatchObject({ code: 'MATCH_BOOKING_NO_CAFE',
                                              hint: "a match player's café order goes on a café bill of its own" });
    }
    expect(data(r, 'donor_order_tab')).toBe(true);
  });

  it('a plain booking\'s bill is untouched, and the court-only bill settles (M11)', () => {
    expect(data(r, 'plain_order')).toBe(true);
    expect(data<Json>(r, 'pay_d1')).toMatchObject({ status: 'settled', court_iqd: 40000, total_iqd: 40000 });
    expect(fig(r, 'd1_after')).toMatchObject({ owed: 0, remaining: 0, paid: 40000, unassigned: 40000 });
    expectChecksClean(r);
  });
});

// ── 6. The day close, a call-off with money taken, a paid seat (M12) ─────

describe.skipIf(!docker)('0262 the day close and the call-off (rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('m261c', [
      ...BASE,
      K('day', `select pg_temp.day()`),
      X(`select pg_temp.mbook('dc', 'c1', ${PAST(3)})`),
      X(`select pg_temp.ms('dca', 'dc', 1, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('dcb', 'dc', 2, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('dcc', 'dc', 3, 'desk', null, 'no_show')`),
      X(`select pg_temp.ms('dcd', 'dc', 4, 'desk', null, 'attended')`),
      X(`select pg_temp.mbook('co', 'c2', ${PAST(3)})`),
      X(`select pg_temp.ms('coa', 'co', 1, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('cob', 'co', 2, 'desk', null, 'no_show')`),
      X(`select pg_temp.ms('coc', 'co', 3, 'desk', null, 'attended')`),
      X(`select pg_temp.ms('cod', 'co', 4, 'desk', null, 'attended')`),

      T('dca', 'desk', SETTLE(['dca'], 'cash', 10000, { tendered: 10000, key: 'k-dca' })),
      T('dcb', 'desk', SETTLE(['dcb'], 'card', 10000, { key: 'k-dcb' })),
      // A partly paid normal bill blocks the day close ...
      ...BILL('dc', 'dc_res', 'cash', 4000),
      T('close_blocked', 'manager', `select app.close_day(14000, 10000, null, null, {{v}})`),
      // ... until Assign closes it; the rest is forgiven with the PIN.
      T('assign_dc', 'desk', LINK('dc_pay', [['dcd', 4000]], 'k-assign-dc')),
      GRANT('desk'),
      T('write_off_dc', 'desk', `select app.match_seat_write_off({{dcd}}, 'walked_out', '${MANAGER_PIN}')`),
      Q('dc_after', `select pg_temp.fig('dc')`),
      T('dc_states', 'desk', `select app.booking_bill_states(array[{{dc_res}}]::uuid[])`),
      // M12 (C18): a seat with a payment never becomes a no-show (DB's marks,
      // same migration, under the money lock).
      T('mark_paid', 'desk', `select app.mark_match_seats(array[{{dca}}]::uuid[], 'no_show')`),
      CHECK('dc', ['dc']),

      // #24: the match called off short after a share was taken: the booking
      // is not live, nobody owes, and the money taken is due back.
      T('coa', 'desk', SETTLE(['coa'], 'cash', 10000, { tendered: 10000, key: 'k-coa' })),
      X(`update matches set status = 'cancelled', ended_at = now(), ended_reason = 'called_off_short' where id = {{co}}`),
      X(`update reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
                                 cancellation_reason = 'called_off_short' where id = {{co_res}}`),
      Q('co_after', `select pg_temp.fig('co')`),
      T('co_bill', 'cashier', `select app.booking_bill({{co_res}})`),
      T('co_settle', 'desk', SETTLE(['coc'], 'cash', 10000, { tendered: 10000 })),
      CHECK('co', ['co']),

      // The day closes: every bill of both bookings is settled.
      T('close', 'manager', `select app.close_day(24000, 10000, null, null, {{v}})`),
    ]);
  });

  it('a live court-only bill blocks the day close until Assign closes it', () => {
    expect(failed(r, 'close_blocked').code).toBe('DAY_OPEN_TABS');
    expect(data<Json>(r, 'assign_dc')).toMatchObject({ tab_closed: true });
    expect(data<Json>(r, 'write_off_dc')).toMatchObject({ written_off_iqd: 6000, booking_remaining_iqd: 0 });
    expect(fig(r, 'dc_after')).toMatchObject({ owed: 0, wo: 16000, remaining: 0, paid: 24000, written_off: 16000 });
    expect(data<Json[]>(r, 'dc_states')[0]).toMatchObject({ state: 'paid', seats_owing: 0, seats_paid: 3,
                                                            seats_owed_iqd: 0, court_written_off_iqd: 16000 });
  });

  it('M12: a paid seat is never marked a no-show (SEAT_MARK_LOCKED paid)', () => {
    expect(failed(r, 'mark_paid')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'paid' });
  });

  it('#24: a call-off leaves nothing owed or written off (M7); the money taken is due back', () => {
    expect(fig(r, 'co_after')).toMatchObject({ phase: 'not_live', owed: 0, wo: 0, remaining: 0, written_off: 0,
                                               paid: 10000, desk_paid: 10000 });
    expect(data<Json>(r, 'co_bill')).toMatchObject({
      live: false, court_remaining_iqd: 0, court_written_off_iqd: 0, court_refund_due_iqd: 10000,
      match: { status: 'cancelled', phase: 'not_live', desk_paid_iqd: 10000, owed_iqd: 0 },
    });
    expect(failed(r, 'co_settle').code).toBe('MATCH_NOT_BOOKED');
  });

  it('the day closes with a no-show, a write-off and a call-off on it; cash and card are the seat payments', () => {
    expect(data<Json>(r, 'close')).toMatchObject({ cash_expected_iqd: 24000, card_expected_iqd: 10000,
                                                   cash_variance_iqd: 0 });
    expectChecksClean(r);
  });
});

// ── 7. The money lock over two connections (committed, venue A) ──────────

describe.skipIf(!docker)('0262 the money lock (R19), two connections', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
  let desk: SupabaseClient;
  const made: Array<{ match: string; res: string }> = [];

  /** A booked desk match at venue A on a fresh court, far out, with four walk-in seats. */
  async function plant(court: string, days: number): Promise<{ match: string; res: string; seats: string[] }> {
    const match = crypto.randomUUID();
    const res = crypto.randomUUID();
    const seats = [1, 2, 3, 4].map(() => crypto.randomUUID());
    const token = crypto.randomUUID().replaceAll('-', '').slice(0, 22);
    psql(`select set_config('request.jwt.claims', '', false);
insert into reservations (id, venue_id, court_id, kind, status, start_at, end_at, guest_name, source, price_iqd)
values ('${res}', '${VENUE_A_ID}', '${court}', 'booking', 'confirmed', date_trunc('hour', now()) + interval '${days} days',
        date_trunc('hour', now()) + interval '${days} days 90 minutes', 'Open match', 'desk', 40000);
insert into matches (id, venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category, price_iqd,
                     shares_iqd, price_court_id, fill_deadline_at, share_token, organised_by, created_by_staff_id,
                     reservation_id)
values ('${match}', '${VENUE_A_ID}', 'booked', date_trunc('hour', now()) + interval '${days} days',
        date_trunc('hour', now()) + interval '${days} days 90 minutes', 90, 'public', 'open', 'open', 40000,
        '{10000,10000,10000,10000}', '${court}', date_trunc('hour', now()) + interval '${days - 1} days', '${token}',
        'desk', '${SEED_STAFF_IDS.court_desk}', '${res}');
${seats.map((s, i) => `insert into match_seats (id, venue_id, match_id, seat_no, kind, guest_name, status, share_iqd,
                     created_by_staff_id)
values ('${s}', '${VENUE_A_ID}', '${match}', ${i + 1}, 'desk', 'M261 race ${i + 1}', 'in', 10000, '${SEED_STAFF_IDS.court_desk}');`).join('\n')}`);
    made.push({ match, res });
    return { match, res, seats };
  }

  /** One statement as the court desk in its own connection, held open `holdS` seconds before the commit. */
  const held = (sql: string, holdS = 3) => psqlSession(`set application_name = 'm262-money-held';
begin;
select set_config('request.jwt.claims', '${JSON.stringify({ sub: SEED_STAFF_IDS.court_desk, role: 'authenticated' })}', true);
set local role authenticated;
${sql};
select pg_sleep(${holdS});
reset role;
commit;`);

  const links = (seat: string) =>
    psql(`select coalesce(sum(amount_iqd), 0) || ':' || count(*) from payment_match_seats where match_seat_id = '${seat}'`);

  beforeAll(async () => {
    svc = serviceClient();
    cashier = await signedInClient(SEED_STAFF.cashier);
    desk = await signedInClient(SEED_STAFF.court_desk);
    const manager = await signedInClient(SEED_STAFF.manager);
    await ensureOpenDay(manager, svc);
  });

  afterAll(() => {
    // Nothing of these stays live: open bills voided, the matches and bookings cancelled.
    for (const m of made) {
      psql(`select set_config('request.jwt.claims', '', false);
update tabs set status = 'void' where reservation_id = '${m.res}' and status in ('open', 'awaiting_payment');
update matches set status = 'cancelled', ended_at = now(), ended_reason = 'staff_cancelled' where id = '${m.match}';
update reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff' where id = '${m.res}';`);
    }
  });

  it('two Take shares on one seat take one payment: the second waits and finds nothing owed', async () => {
    const court = await createTestCourt(svc, 'M261 race one');
    const { match, res, seats } = await plant(court, 41);
    const first = held(`select app.match_seat_settle(array['${seats[0]}']::uuid[], 'cash', 10000, 10000, null,
                                                     '${testIdemKey('match.settle')}', null)`);
    await waitForSleeper('m262-money-held');
    const second = await appRpc(cashier, 'match_seat_settle', {
      p_seat_ids: [seats[0]], p_method: 'card', p_expected_owed_iqd: 10000,
      p_idempotency_key: testIdemKey('match.settle'),
    });
    const out = await first;
    expect(JSON.parse(out.split('\n').find((l) => l.includes('"payment_id"'))!))
      .toMatchObject({ duplicate: false, amount_iqd: 10000 });
    expect(second.error?.message).toBe('NOTHING_OWED');
    expect(second.error?.details).toBe(seats[0]);
    expect(links(seats[0]!)).toBe('10000:1');
    expect(psql(`select (app.match_money('${match}', null)->>'owed_iqd') || ':' || app.court_fee_remaining('${res}')`))
      .toBe('30000:30000');
    expect(assertMatchMoney(match)).toEqual([]);
  }, 30_000);

  it('a Take share racing an Assign never links more than the share', async () => {
    const court = await createTestCourt(svc, 'M261 race two');
    const { match, res, seats } = await plant(court, 43);
    const opened = await appRpc(desk, 'open_tab', { p_reservation_id: res, p_idempotency_key: testIdemKey('tab.open') });
    expect(opened.error).toBeNull();
    const tab = (opened.data as { tab_id: string }).tab_id;
    const paid = await appRpc(desk, 'settle_tab', {
      p_tab_id: tab, p_method: 'card', p_amount_iqd: 10000, p_idempotency_key: testIdemKey('tab.settle'),
    });
    expect(paid.error).toBeNull();
    const payment = (paid.data as { payment_id: string }).payment_id;
    const assign = held(`select app.match_link_payment('${payment}',
                          jsonb_build_array(jsonb_build_object('seat_id', '${seats[1]}', 'amount_iqd', 10000)),
                          '${testIdemKey('match.link')}')`);
    await waitForSleeper('m262-money-held');
    const settle = await appRpc(cashier, 'match_seat_settle', {
      p_seat_ids: [seats[1]], p_method: 'card', p_expected_owed_iqd: 10000,
      p_idempotency_key: testIdemKey('match.settle'),
    });
    await assign;
    expect(settle.error?.message).toBe('NOTHING_OWED');
    expect(links(seats[1]!)).toBe('10000:1');
    expect(psql(`select count(*) from tabs where reservation_id = '${res}' and status in ('open', 'awaiting_payment')`))
      .toBe('0');
    expect(psql(`select (app.match_money('${match}', null)->>'owed_iqd') || ':' || app.court_fee_remaining('${res}')`))
      .toBe('30000:30000');
    expect(assertMatchMoney(match)).toEqual([]);
  }, 30_000);
});
