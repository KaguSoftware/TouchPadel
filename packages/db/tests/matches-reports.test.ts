/**
 * 0265 match_reports: the money outside the drawer and the open-match reports
 * (docs/design/open-matches/money.md §7, §9 M3 M8 M10; operator.md §5.6.4,
 * §5.18, §5.19; build contracts §1.5, §1.7, §1.8, MD-16, DF-19).
 *
 * One rolled-back scenario. A branch made inside the transaction (v: two
 * courts, the matches-harness branch) and a second one (w: one court), and a
 * business day, 2020-03-10, far from anything another suite writes, planted as
 * that day would have left it:
 *   * online deposits at v: received, refunded, kept for a no-show, a refund
 *     still waiting, one received at 03:30 the next morning (still the day), one
 *     at 03:59 that morning (the day before), a sandbox one; one at w;
 *   * ticket purchases (chain): sold, cashed out at v and refunded, cashed out
 *     at w with the refund failed, an amount mismatch (never a sale), a payer
 *     deleted at SUCCESS (refunded, no ticket), one bought the day before, a
 *     sandbox one; forfeits at v and at w, a forfeit restored at v;
 *   * open matches at v starting that day: played and paid by the three who
 *     came with the no-show written off (M1, approve mode); called off short
 *     (M2); bumped (M3); expired (M4); sandbox (M5); women, played and unpaid
 *     with a refilled late leave and a vacant number (M6); all no-show (M7);
 *     and one at w (Mw); plus an ordinary unpaid booking (R0).
 * Every figure is checked against that ledger: ticket_money_figures (the one
 * helper, MD-16), day_close_online, reports_figures through panel_headline,
 * report_courts' matches block, unpaid_played_bookings and report_matches;
 * chain-wide ticket figures as deltas over a baseline read in the same
 * transaction. Then sandbox, branch scoping (a manager of v only, the owner by
 * scope header, a manager of another branch) and the role walls.
 * pg_temp.ledger() (T5, T6, T8, T9) holds after the planting and at the end,
 * and helpers.ts MATCH_MONEY_CHECK (M1, M3–M7, M11) over every planted match:
 * nothing here moves money or tickets.
 *
 * Needs 0262 (court_fee_written_off, match_money, court_fee_remaining netting
 * write-offs) on the stack.
 */
import { describe, expect, it } from 'vitest';
import { MATCH_MONEY_CHECK, stackAvailable } from './helpers';
import { MK, Q, T, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const DAY = '2020-03-10';
/** A Baghdad wall-clock time as a SQL literal. */
const ts = (hhmm: string, day = DAY) => `'${day} ${hhmm}+03'`;

const TMF = (from: string, to: string, venues: string) =>
  `select app.ticket_money_figures(${from}::timestamptz, ${to}::timestamptz, ${venues}::uuid[])`;
const PANEL = `select app.panel_headline('${DAY}', '${DAY}', 'none')`;
const RM = (filters = `'{}'::jsonb`) => `select app.report_matches('${DAY}', '${DAY}', ${filters})`;
const RC = (filters = `'{}'::jsonb`) => `select app.report_courts('${DAY}', '${DAY}', ${filters})`;
const HEADERS = (scope: string) =>
  X(`select set_config('request.headers', json_build_object('x-venue-scope', ${scope})::text, true)`);

/** The planting helpers of this suite (the matches-harness SETUP comes first). */
const PLANT = String.raw`
-- A reservation at a kept court. A booking without a guest carries p_label
-- ('Open match' for a match booking); a hold or a guest's booking p_guest.
create function pg_temp.rv(p_name text, p_court text, p_start timestamptz, p_dur int, p_status text,
                           p_price bigint, p_label text default 'Open match', p_kind text default 'booking',
                           p_guest text default null) returns void language plpgsql as $f$
declare v uuid; v_court uuid := pg_temp.var(p_court)::uuid;
begin
  insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source,
                            price_iqd, hold_expires_at)
  values ((select c.venue_id from courts c where c.id = v_court), v_court, p_kind::reservation_kind,
          p_status::reservation_status, p_start, p_start + make_interval(mins => p_dur),
          pg_temp.var(p_guest)::uuid, case when p_guest is null then p_label end, 'desk', p_price,
          case when p_kind = 'hold' then p_start end)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- An online deposit at a kept branch, on a kept hold and booking; p overrides
-- (status, refund_*, forfeited_at, sandbox).
create function pg_temp.dep(p_name text, p_venue text, p_hold text, p_res text, p_amount bigint,
                            p_at timestamptz, p jsonb default '{}') returns void language plpgsql as $f$
declare r booking_payments; v uuid;
begin
  r := jsonb_populate_record(null::booking_payments, jsonb_build_object(
         'venue_id', pg_temp.var(p_venue), 'hold_id', pg_temp.var(p_hold), 'reservation_id', pg_temp.var(p_res),
         'guest_id', pg_temp.var('g1'), 'purpose', 'deposit', 'provider', 'fake', 'sandbox', false,
         'request_id', gen_random_uuid(), 'amount_iqd', p_amount, 'quoted_price_iqd', p_amount,
         'status', 'succeeded', 'succeeded_at', p_at, 'deadline_at', p_at, 'created_at', p_at) || p);
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, status, succeeded_at, deadline_at, forfeited_at,
                                refund_reason, refund_amount_iqd, refund_requested_at, refunded_at, created_at)
  values (r.venue_id, r.reservation_id, r.hold_id, r.guest_id, r.purpose, r.provider, r.sandbox, r.request_id,
          r.amount_iqd, r.quoted_price_iqd, r.status, r.succeeded_at, r.deadline_at, r.forfeited_at,
          r.refund_reason, r.refund_amount_iqd, r.refund_requested_at, r.refunded_at, r.created_at)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A ticket purchase at p_at (chain: no branch) and its tickets, each bought at
-- p_at, kept as <p_name>_1 .. _n. p overrides the row (sandbox, status,
-- refund_*); no_tickets: none were made (an amount mismatch, a payer deleted
-- at SUCCESS).
create function pg_temp.buy(p_name text, p_guest text, p_count int, p_price bigint, p_at timestamptz,
                            p jsonb default '{}') returns void language plpgsql as $f$
declare r booking_payments; v uuid; t uuid; i int; v_g uuid := pg_temp.var(p_guest)::uuid;
begin
  r := jsonb_populate_record(null::booking_payments, jsonb_build_object(
         'guest_id', v_g, 'purpose', 'ticket', 'provider', 'fake', 'sandbox', false, 'request_id', gen_random_uuid(),
         'amount_iqd', p_count * p_price, 'quoted_price_iqd', p_price, 'ticket_count', p_count,
         'status', 'succeeded', 'succeeded_at', p_at, 'deadline_at', p_at + interval '15 minutes',
         'created_at', p_at) || (p - 'no_tickets'));
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, ticket_count, status, succeeded_at, deadline_at,
                                refund_reason, refund_amount_iqd, refund_requested_at, refunded_at, created_at)
  values (null, null, null, r.guest_id, r.purpose, r.provider, r.sandbox, r.request_id,
          r.amount_iqd, r.quoted_price_iqd, r.ticket_count, r.status, r.succeeded_at, r.deadline_at,
          r.refund_reason, r.refund_amount_iqd, r.refund_requested_at, r.refunded_at, r.created_at)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  if not coalesce((p->>'no_tickets')::boolean, false) then
    for i in 1 .. p_count loop
      insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox, created_at)
      values (v_g, 'available', p_price, v, r.sandbox, p_at) returning id into t;
      insert into match_ticket_events (ticket_id, guest_id, type, payment_id, at) values (t, v_g, 'bought', v, p_at);
      insert into pg_temp.vars values (p_name || '_' || i, t::text);
    end loop;
  end if;
end $f$;

-- One ledger event of a kept ticket (branch, match and seat kept names or null).
create function pg_temp.tev(p_ticket text, p_type text, p_at timestamptz, p_venue text default null,
                            p_match text default null, p_seat text default null) returns void language sql as $f$
  insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id, payment_id, at)
  select t.id, t.guest_id, p_type, pg_temp.var(p_venue)::uuid, pg_temp.var(p_match)::uuid, pg_temp.var(p_seat)::uuid,
         case when p_type in ('bought', 'cashed_out') then t.purchase_payment_id end, p_at
    from match_tickets t where t.id = pg_temp.var(p_ticket)::uuid
$f$;

-- A seat as the match left it (marked 15 minutes after the start; an ended
-- seat ended an hour before it). p: ticket, name (a typed walk-in), replaces
-- (kept names).
create function pg_temp.st(p_name text, p_match text, p_no int, p_kind text, p_holder text, p_status text,
                           p jsonb default '{}') returns void language plpgsql as $f$
declare m matches; v uuid;
begin
  select * into m from matches where id = pg_temp.var(p_match)::uuid;
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, guest_name, status, ticket_id, share_iqd,
                           replaces_seat_id, created_by_staff_id, joined_at, ended_at, end_reason,
                           marked_by_staff_id, marked_at)
  values (m.venue_id, m.id, p_no, p_kind, pg_temp.var(p_holder)::uuid, p->>'name', p_status,
          pg_temp.var(p->>'ticket')::uuid, m.shares_iqd[p_no], pg_temp.var(p->>'replaces')::uuid,
          case when p_kind = 'desk' then pg_temp.var('desk')::uuid end,
          m.start_at - interval '1 day',
          case when p_status in ('left', 'removed', 'cancelled', 'left_late', 'refilled') then m.start_at - interval '1 hour' end,
          case p_status when 'cancelled' then 'match_ended' when 'left_late' then 'removed_by_staff'
                        when 'refilled' then 'refilled' end,
          case when p_status in ('attended', 'no_show') then pg_temp.var('desk')::uuid end,
          case when p_status in ('attended', 'no_show') then m.start_at + interval '15 minutes' end)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;
`;

/** after − before, key by key (the chain-wide figures are read as deltas). */
function minus(after: Json, before: Json): Record<string, number> {
  return Object.fromEntries(Object.keys(after).map((k) => [k, Number(after[k]) - Number(before[k] ?? 0)]));
}
const figures = (p: Json): Record<string, number> =>
  Object.fromEntries((p.figures as Json[]).map((f) => [f.key as string, Number(f.value)]));
const pick = (o: Record<string, number>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));

describe.skipIf(!docker)('0265 reports: day close online, report figures, report_matches (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m265r', [
      SETUP,
      MATCH_MONEY_CHECK,
      PLANT,
      `select pg_temp.branch();`,
      K('w', `insert into venues (slug, name_en, name_ar, timezone, is_active)
              values ('m265w-' || substr(md5(random()::text), 1, 8), 'M265 branch W', 'فرع و', 'Asia/Baghdad', true)
              returning id`),
      K('wc', `insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
               values ({{w}}, 'M265 W court', 'ملعب و', '{60,90,120}', 1, true) returning id`),
      // bm: a manager of branch v and nowhere else.
      MK('bm', 'manager'),
      X(`delete from staff_venues where staff_id = {{bm}}`),
      X(`insert into staff_venues (staff_id, venue_id, role) values ({{bm}}, {{v}}, 'manager')`),
      GUEST('g1'), GUEST('g2'), GUEST('g3'), GUEST('g4'), GUEST('g5'), GUEST('g6'),
      GUEST('sb', '{"sandbox":true}'),

      // The business day's bounds (venue_business_date's rule, 0211) and its edges.
      K('d_from', `select ('${DAY}'::date::timestamp
                           + make_interval(hours => coalesce(app.cafe_setting_int('analytics_business_day_start_hour', {{v}}), 4)))
                          at time zone 'Asia/Baghdad'`),
      K('d_to', `select {{d_from}}::timestamptz + interval '1 day'`),
      K('d09_from', `select {{d_from}}::timestamptz - interval '1 day'`),
      Q('edges', `select jsonb_build_object(
                    'next_0330', app.venue_business_date({{v}}, ${ts('03:30', '2020-03-11')}),
                    'this_0359', app.venue_business_date({{v}}, ${ts('03:59')}))`),

      // Baselines, read before anything is planted: the chain-wide figures
      // are checked as what this scenario added to them.
      E('base_tmf', null, TMF('{{d_from}}', '{{d_to}}', 'array[{{v}}]')),
      E('base_tmf_w', null, TMF('{{d_from}}', '{{d_to}}', 'array[{{w}}]')),
      E('base_tmf_vw', null, TMF('{{d_from}}', '{{d_to}}', 'array[{{v}}, {{w}}]')),
      E('base_tmf_2030', null, TMF('{{d_from}}', ts('20:30'), 'array[{{v}}]')),
      E('base_tmf_2100', null, TMF(ts('21:00'), ts('21:00'), 'array[{{v}}]')),
      E('base_tmf_09', null, TMF('{{d09_from}}', '{{d_from}}', 'array[{{v}}]')),
      HEADERS('{{v}}'),
      E('base_panel_v', 'owner', PANEL),
      E('base_rm', 'bm', RM()),
      HEADERS(`'all'`),
      E('base_panel_all', 'owner', PANEL),

      // ── Reservations (every one in a final status, so no trigger acts) ──
      `select pg_temp.rv('r0', 'c1', ${ts('10:00')}, 90, 'completed', 40000, 'Walk-in fixture');`,
      `select pg_temp.rv('r1', 'c1', ${ts('18:00')}, 90, 'completed', 40000);`,
      `select pg_temp.rv('r2', 'c2', ${ts('20:00')}, 90, 'cancelled', 48000);`,
      `select pg_temp.rv('r6', 'c2', ${ts('16:00')}, 90, 'completed', 40000);`,
      `select pg_temp.rv('r7', 'c1', ${ts('21:00')}, 90, 'no_show', 40000);`,
      `select pg_temp.rv('rw', 'wc', ${ts('18:30')}, 90, 'completed', 40000);`,
      `select pg_temp.rv('hv', 'c1', ${ts('10:00', '2020-02-01')}, 90, 'expired', null, null, 'hold', 'g1');`,
      `select pg_temp.rv('bv', 'c1', ${ts('10:00', '2020-02-01')}, 90, 'completed', 20000, null, 'booking', 'g1');`,
      `select pg_temp.rv('hw', 'wc', ${ts('10:00', '2020-02-01')}, 90, 'expired', null, null, 'hold', 'g1');`,
      `select pg_temp.rv('bw', 'wc', ${ts('10:00', '2020-02-01')}, 90, 'completed', 20000, null, 'booking', 'g1');`,
      K('day', `insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd, opened_at,
                                          closed_at, closed_by)
                values ({{v}}, '${DAY}', 'closed', {{bm}}, 0, ${ts('08:00')}, ${ts('21:00')}, {{bm}}) returning id`),

      // ── Open matches ──
      K('m1', `select pg_temp.m(jsonb_build_object('start_at', ${ts('18:00')}, 'status', 'played', 'ended_at', ${ts('19:30')},
                                                  'reservation_id', {{r1}}, 'join_policy', 'approve'))`),
      K('m2', `select pg_temp.m(jsonb_build_object('start_at', ${ts('20:00')}, 'status', 'cancelled',
                                                  'ended_reason', 'called_off_short', 'ended_at', ${ts('21:10')},
                                                  'reservation_id', {{r2}}, 'price_court_id', {{c2}}, 'price_iqd', 48000,
                                                  'shares_iqd', jsonb_build_array(12000, 12000, 12000, 12000)))`),
      K('m3', `select pg_temp.m(jsonb_build_object('start_at', ${ts('21:00')}, 'status', 'bumped', 'ended_reason', 'bumped',
                                                  'ended_at', ${ts('16:00')}, 'organiser_id', {{g3}}))`),
      K('m4', `select pg_temp.m(jsonb_build_object('start_at', ${ts('22:00')}, 'status', 'expired', 'ended_reason', 'deadline',
                                                  'ended_at', ${ts('20:00')}, 'organiser_id', null, 'organised_by', 'desk',
                                                  'created_by_staff_id', {{desk}}))`),
      K('m5', `select pg_temp.m(jsonb_build_object('start_at', ${ts('18:00')}, 'status', 'played', 'ended_at', ${ts('19:30')},
                                                  'sandbox', true, 'organiser_id', {{sb}}))`),
      K('m6', `select pg_temp.m(jsonb_build_object('start_at', ${ts('16:00')}, 'status', 'played', 'ended_at', ${ts('17:30')},
                                                  'reservation_id', {{r6}}, 'price_court_id', {{c2}}, 'category', 'women',
                                                  'organiser_id', null, 'organised_by', 'desk', 'created_by_staff_id', {{desk}}))`),
      K('m7', `select pg_temp.m(jsonb_build_object('start_at', ${ts('21:00')}, 'status', 'no_show', 'ended_reason', 'all_no_show',
                                                  'ended_at', ${ts('22:40')}, 'reservation_id', {{r7}}, 'organiser_id', null,
                                                  'organised_by', 'desk', 'created_by_staff_id', {{desk}}))`),
      K('mw', `select pg_temp.m(jsonb_build_object('venue_id', {{w}}, 'start_at', ${ts('18:30')}, 'status', 'played',
                                                  'ended_at', ${ts('20:00')}, 'reservation_id', {{rw}}, 'price_court_id', {{wc}},
                                                  'rate_rule_id', null, 'organiser_id', {{g6}}))`),

      // ── Ticket purchases (chain) ──
      `select pg_temp.buy('p1', 'g1', 3, 10000, ${ts('10:00')});`,
      `select pg_temp.buy('p2', 'g2', 2, 10000, ${ts('11:00')},
         '{"status":"refunded","refund_reason":"ticket_cashout","refund_amount_iqd":20000,
           "refund_requested_at":"${DAY} 20:00+03","refunded_at":"${DAY} 21:00+03"}');`,
      `select pg_temp.buy('p3', 'g3', 1, 12000, ${ts('12:00')});`,
      `select pg_temp.buy('p4', 'g4', 2, 10000, ${ts('12:30')},
         '{"status":"refund_failed","refund_reason":"ticket_cashout","refund_amount_iqd":20000,
           "refund_requested_at":"${DAY} 22:00+03"}');`,
      `select pg_temp.buy('p5', 'g3', 1, 10000, ${ts('13:00')},
         '{"status":"refunded","refund_reason":"amount_mismatch","refund_amount_iqd":10000,
           "refunded_at":"${DAY} 13:05+03","no_tickets":true}');`,
      `select pg_temp.buy('p6', 'sb', 2, 10000, ${ts('14:00')}, '{"sandbox":true}');`,
      `select pg_temp.buy('p7', null, 2, 10000, ${ts('15:00')},
         '{"status":"refunded","refund_reason":"account_deleted","refund_amount_iqd":20000,
           "refunded_at":"${DAY} 15:30+03","no_tickets":true}');`,
      `select pg_temp.buy('p8', 'g1', 1, 10000, ${ts('12:00', '2020-03-09')});`,
      `select pg_temp.buy('p9', 'g5', 1, 10000, ${ts('09:00')});`,
      `select pg_temp.buy('p10', 'g6', 1, 10000, ${ts('09:15')});`,

      // ── Seats ──
      // M1: g1 and g1's friend (on g1's ticket bought the day before), g2
      // came; g5 did not.
      `select pg_temp.st('m1s1', 'm1', 1, 'account', 'g1', 'attended', '{"ticket":"p1_1"}');`,
      `select pg_temp.st('m1s2', 'm1', 2, 'friend', 'g1', 'attended', '{"ticket":"p8_1"}');`,
      `select pg_temp.st('m1s3', 'm1', 3, 'account', 'g2', 'attended', '{"ticket":"p2_1"}');`,
      `select pg_temp.st('m1s4', 'm1', 4, 'account', 'g5', 'no_show', '{"ticket":"p9_1"}');`,
      // M2: called off with two desk no-shows (R12: every carrier marked).
      `select pg_temp.st('m2s1', 'm2', 1, 'account', 'g1', 'attended', '{"ticket":"p1_3"}');`,
      `select pg_temp.st('m2s2', 'm2', 2, 'desk', null, 'attended', '{"name":"Desk Two B"}');`,
      `select pg_temp.st('m2s3', 'm2', 3, 'desk', null, 'no_show', '{"name":"Desk Two C"}');`,
      `select pg_temp.st('m2s4', 'm2', 4, 'desk', null, 'no_show');`,
      `select pg_temp.st('m3s1', 'm3', 1, 'account', 'g3', 'cancelled', '{"ticket":"p3_1"}');`,
      `select pg_temp.st('m4s1', 'm4', 1, 'desk', null, 'cancelled', '{"name":"Desk Four"}');`,
      `select pg_temp.st('m5s1', 'm5', 1, 'account', 'sb', 'attended', '{"ticket":"p6_1"}');`,
      `select pg_temp.st('m5s2', 'm5', 2, 'friend', 'sb', 'no_show', '{"ticket":"p6_2"}');`,
      // M6: two came (one a linked customer), a late leaver refilled by a
      // walk-in who came, number 4 vacant; nobody paid.
      `select pg_temp.st('m6s1', 'm6', 1, 'desk', null, 'attended', '{"name":"Desk One"}');`,
      `select pg_temp.st('m6s2', 'm6', 2, 'desk', 'g4', 'attended');`,
      `select pg_temp.st('m6s3a', 'm6', 3, 'desk', null, 'refilled', '{"name":"Desk Three Left"}');`,
      `select pg_temp.st('m6s3b', 'm6', 3, 'desk', null, 'attended', '{"name":"Desk Three","replaces":"m6s3a"}');`,
      `select pg_temp.st('m7s1', 'm7', 1, 'desk', null, 'no_show', '{"name":"Desk Seven A"}');`,
      `select pg_temp.st('m7s2', 'm7', 2, 'desk', null, 'no_show', '{"name":"Desk Seven B"}');`,
      `select pg_temp.st('m7s3', 'm7', 3, 'desk', null, 'left_late', '{"name":"Desk Seven C"}');`,
      `select pg_temp.st('mws1', 'mw', 1, 'account', 'g6', 'no_show', '{"ticket":"p10_1"}');`,
      `select pg_temp.st('mws2', 'mw', 2, 'desk', null, 'attended', '{"name":"W Desk"}');`,

      // ── The ticket ledger of the day ──
      `select pg_temp.tev('p1_1', 'locked', ${ts('17:00')}, 'v', 'm1', 'm1s1');`,
      `select pg_temp.tev('p1_1', 'released', ${ts('19:30')}, 'v', 'm1', 'm1s1');`,
      `select pg_temp.tev('p8_1', 'locked', ${ts('17:00')}, 'v', 'm1', 'm1s2');`,
      `select pg_temp.tev('p8_1', 'forfeited', ${ts('18:15')}, 'v', 'm1', 'm1s2');`,
      `select pg_temp.tev('p8_1', 'restored', ${ts('18:30')}, 'v', 'm1', 'm1s2');`,
      `select pg_temp.tev('p2_1', 'locked', ${ts('17:00')}, 'v', 'm1', 'm1s3');`,
      `select pg_temp.tev('p2_1', 'released', ${ts('19:30')}, 'v', 'm1', 'm1s3');`,
      `select pg_temp.tev('p2_1', 'cashed_out', ${ts('20:00')}, 'v');`,
      `select pg_temp.tev('p2_2', 'cashed_out', ${ts('20:00')}, 'v');`,
      `select pg_temp.tev('p9_1', 'locked', ${ts('17:00')}, 'v', 'm1', 'm1s4');`,
      `select pg_temp.tev('p9_1', 'forfeited', ${ts('18:15')}, 'v', 'm1', 'm1s4');`,
      `select pg_temp.tev('p1_3', 'locked', ${ts('19:00')}, 'v', 'm2', 'm2s1');`,
      `select pg_temp.tev('p1_3', 'released', ${ts('20:10')}, 'v', 'm2', 'm2s1');`,
      `select pg_temp.tev('p3_1', 'locked', ${ts('12:10')}, 'v', 'm3', 'm3s1');`,
      `select pg_temp.tev('p3_1', 'released', ${ts('16:00')}, 'v', 'm3', 'm3s1');`,
      `select pg_temp.tev('p4_1', 'cashed_out', ${ts('22:00')}, 'w');`,
      `select pg_temp.tev('p4_2', 'cashed_out', ${ts('22:00')}, 'w');`,
      `select pg_temp.tev('p6_1', 'locked', ${ts('17:00')}, 'v', 'm5', 'm5s1');`,
      `select pg_temp.tev('p6_1', 'released', ${ts('19:30')}, 'v', 'm5', 'm5s1');`,
      `select pg_temp.tev('p6_2', 'locked', ${ts('17:00')}, 'v', 'm5', 'm5s2');`,
      `select pg_temp.tev('p6_2', 'forfeited', ${ts('18:20')}, 'v', 'm5', 'm5s2');`,
      `select pg_temp.tev('p10_1', 'locked', ${ts('17:00')}, 'w', 'mw', 'mws1');`,
      `select pg_temp.tev('p10_1', 'forfeited', ${ts('19:00')}, 'w', 'mw', 'mws1');`,
      X(`update match_tickets set status = 'cashed_out', cashed_out_at = ${ts('20:00')}, cashout_payment_id = purchase_payment_id
          where purchase_payment_id = {{p2}}`),
      X(`update match_tickets set status = 'cashed_out', cashed_out_at = ${ts('22:00')}, cashout_payment_id = purchase_payment_id
          where purchase_payment_id = {{p4}}`),
      X(`update match_tickets set status = 'forfeited', forfeited_venue_id = {{v}}, forfeited_seat_id = {{m1s4}},
                                  forfeited_at = ${ts('18:15')} where id = {{p9_1}}`),
      X(`update match_tickets set status = 'forfeited', forfeited_venue_id = {{v}}, forfeited_seat_id = {{m5s2}},
                                  forfeited_at = ${ts('18:20')} where id = {{p6_2}}`),
      X(`update match_tickets set status = 'forfeited', forfeited_venue_id = {{w}}, forfeited_seat_id = {{mws1}},
                                  forfeited_at = ${ts('19:00')} where id = {{p10_1}}`),

      // ── Seat money: M1's three who came paid 30,000 in cash on one tab ──
      K('tab1', `insert into tabs (venue_id, day_session_id, reservation_id, status, kind, court_iqd, court_cap_iqd,
                                   total_iqd, opened_by_staff_id, opened_at, settled_at)
                 values ({{v}}, {{day}}, {{r1}}, 'settled', 'cafe', 30000, 30000, 30000, {{desk}}, ${ts('19:35')},
                         ${ts('19:40')}) returning id`),
      K('pay1', `insert into payments (tab_id, day_session_id, method, amount_iqd, recorded_by, venue_id, created_at)
                 values ({{tab1}}, {{day}}, 'cash', 30000, {{desk}}, {{v}}, ${ts('19:40')}) returning id`),
      X(`insert into payment_match_seats (payment_id, match_seat_id, venue_id, amount_iqd, linked_by, created_at)
         select {{pay1}}, s.id, {{v}}, 10000, {{desk}}, ${ts('19:40')}
           from match_seats s where s.id in ({{m1s1}}, {{m1s2}}, {{m1s3}})`),

      // ── Online deposits ──
      `select pg_temp.dep('dep1', 'v', 'hv', 'bv', 10000, ${ts('09:00')});`,
      `select pg_temp.dep('dep2', 'v', 'hv', 'bv', 10000, ${ts('09:30')},
         '{"status":"refunded","refund_reason":"guest_cancel","refund_amount_iqd":10000,
           "refund_requested_at":"${DAY} 12:30+03","refunded_at":"${DAY} 13:00+03"}');`,
      `select pg_temp.dep('dep3', 'v', 'hv', 'bv', 10000, ${ts('12:00', '2020-03-09')}, '{"forfeited_at":"${DAY} 12:00+03"}');`,
      `select pg_temp.dep('dep4', 'v', 'hv', 'bv', 15000, ${ts('03:30', '2020-03-11')},
         '{"status":"refund_failed","refund_reason":"staff_cancel","refund_amount_iqd":15000,
           "refund_requested_at":"2020-03-11 03:40+03"}');`,
      `select pg_temp.dep('dep5', 'v', 'hv', 'bv', 10000, ${ts('10:00')}, '{"sandbox":true}');`,
      `select pg_temp.dep('dep_edge', 'v', 'hv', 'bv', 5000, ${ts('03:59')});`,
      `select pg_temp.dep('dep_w', 'w', 'hw', 'bw', 10000, ${ts('10:00')});`,

      Q('ledger', `select pg_temp.ledger()`),
      Q('money', `select jsonb_object_agg(n, pg_temp.money_of(pg_temp.var(n)::uuid))
                    from unnest(array['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'mw']) n`),
      Q('day_id', `select to_jsonb({{day}}::text)`),
      Q('v_id', `select to_jsonb({{v}}::text)`),

      // ── ticket_money_figures (internal) ──
      E('tmf', null, TMF('{{d_from}}', '{{d_to}}', 'array[{{v}}]')),
      E('tmf_w', null, TMF('{{d_from}}', '{{d_to}}', 'array[{{w}}]')),
      E('tmf_vw', null, TMF('{{d_from}}', '{{d_to}}', 'array[{{v}}, {{w}}]')),
      E('tmf_2030', null, TMF('{{d_from}}', ts('20:30'), 'array[{{v}}]')),
      E('tmf_2100', null, TMF(ts('21:00'), ts('21:00'), 'array[{{v}}]')),
      E('tmf_09', null, TMF('{{d09_from}}', '{{d_from}}', 'array[{{v}}]')),
      T('tmf_owner', 'owner', TMF('{{d_from}}', '{{d_to}}', 'array[{{v}}]')),

      // ── Reads at branch v ──
      HEADERS('{{v}}'),
      T('dco', 'bm', `select app.day_close_online({{day}})`),
      T('dco_default', 'bm', `select app.day_close_online()`),
      T('dco_owner', 'owner', `select app.day_close_online({{day}})`),
      T('dco_unknown', 'bm', `select app.day_close_online('00000000-0000-4000-8000-000000000000')`),
      T('dco_cashier', 'cashier', `select app.day_close_online({{day}})`),
      T('dco_desk', 'desk', `select app.day_close_online({{day}})`),
      T('dco_guest', 'g1', `select app.day_close_online({{day}})`),
      E('dco_anon', null, `select app.day_close_online({{day}})`),
      T('upb', 'bm', `select app.unpaid_played_bookings({{day}})`),
      Q('g4_name', `select to_jsonb(p.full_name) from profiles p where p.id = {{g4}}`),
      Q('m3_identity', `select jsonb_agg(jsonb_build_object('price', r.price_iqd, 'paid', app.court_fee_paid(r.id, null),
                                                             'written_off', app.court_fee_written_off(r.id, null),
                                                             'remaining', app.court_fee_remaining(r.id, null))
                                          order by r.start_at)
                          from reservations r where r.id in ({{r1}}, {{r6}})`),
      T('rc', 'bm', RC()),
      T('rc_c2', 'bm', RC(`jsonb_build_object('courtId', {{c2}})`)),
      T('rm', 'bm', RM()),
      T('rm_owner', 'owner', RM()),
      T('rm_women', 'bm', RM(`'{"category":"women"}'::jsonb`)),
      T('rm_approve', 'bm', RM(`'{"joinPolicy":"approve"}'::jsonb`)),
      T('rm_null_category', 'bm', RM(`'{"category":null}'::jsonb`)),
      T('rm_bad_category', 'bm', RM(`'{"category":"mixed"}'::jsonb`)),
      T('rm_bad_policy', 'bm', RM(`'{"joinPolicy":1}'::jsonb`)),
      T('rm_bad_key', 'bm', RM(`'{"courtId":null}'::jsonb`)),
      T('rm_not_object', 'bm', RM(`'[]'::jsonb`)),
      T('rm_range', 'bm', `select app.report_matches('${DAY}', '2020-03-09', '{}')`),
      T('rm_cashier', 'cashier', RM()),
      T('rm_desk', 'desk', RM()),
      T('rm_guest', 'g1', RM()),
      T('panel_v', 'owner', PANEL),
      T('panel_bm', 'bm', PANEL),
      // The owner at branch w, then across every branch.
      HEADERS('{{w}}'),
      T('rm_owner_w', 'owner', RM()),
      HEADERS(`'all'`),
      T('panel_all', 'owner', PANEL),
      // A manager of another branch, working where they work.
      X(`select set_config('request.headers', '', true)`),
      T('dco_other_manager', 'manager', `select app.day_close_online({{day}})`),
      T('rm_other_manager', 'manager', RM()),
      // An open day at v (dated the day before) is the default over the closed one.
      K('day09', `insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd, opened_at)
                  values ({{v}}, '2020-03-09', 'open', {{bm}}, 0, ${ts('08:00', '2020-03-09')}) returning id`),
      T('dco_open', 'bm', `select app.day_close_online()`),

      Q('ledger_end', `select pg_temp.ledger()`),
    ]);
  });

  it('plants a consistent day: the business-day edges, the ticket ledger (T5, T6, T8, T9) and the court money (M1, M3–M7, M11) hold', () => {
    expect(data(r, 'edges')).toEqual({ next_0330: DAY, this_0359: '2020-03-09' });
    expect(data(r, 'ledger')).toEqual([]);
    expect(data(r, 'ledger_end')).toEqual([]);
    const money = data<Record<string, string[]>>(r, 'money');
    expect(Object.keys(money).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'mw']);
    for (const [m, broken] of Object.entries(money)) expect(broken, m).toEqual([]);
  });

  it('ticket_money_figures: every figure of §7.1 against the ledger, sandbox left out (MD-16, M10)', () => {
    expect(minus(data<Json>(r, 'tmf'), data<Json>(r, 'base_tmf'))).toEqual({
      // P1 30,000/3, P2 20,000/2, P3 12,000/1, P4 20,000/2, P7 20,000/2, P9 and
      // P10 10,000/1 each; not P5 (amount mismatch), P6 (sandbox) or P8 (the day before).
      soldIqd: 122000, soldTickets: 12, purchases: 7,
      // P2's cash-out refund and P7 (payer deleted at SUCCESS); not P5.
      refundedIqd: 40000, refundedTickets: 4,
      // P4's failed refund: chain-wide and now.
      refundsWaitingIqd: 20000, refundsWaitingCount: 1,
      // g5's no-show at v; not g1's friend's (restored), sb's (sandbox) or w's.
      forfeitsIqd: 10000, forfeitedTickets: 1,
      restoredTickets: 1,
      // P2 was cashed out at v; P4 at w.
      cashoutsHereIqd: 20000, cashoutsHereTickets: 2,
      // At the day's end: g1's three tickets, g3's (12,000) and the restored one.
      liabilityIqd: 52000, liabilityTickets: 5,
      sandboxExcluded: 1,
    });
    // The branch figures follow p_venues; the chain figures do not.
    const w = minus(data<Json>(r, 'tmf_w'), data<Json>(r, 'base_tmf_w'));
    expect(pick(w, ['forfeitsIqd', 'forfeitedTickets', 'restoredTickets', 'cashoutsHereIqd', 'cashoutsHereTickets', 'soldIqd']))
      .toEqual({ forfeitsIqd: 10000, forfeitedTickets: 1, restoredTickets: 0, cashoutsHereIqd: 20000, cashoutsHereTickets: 2, soldIqd: 122000 });
    const vw = minus(data<Json>(r, 'tmf_vw'), data<Json>(r, 'base_tmf_vw'));
    expect(pick(vw, ['forfeitsIqd', 'forfeitedTickets', 'restoredTickets', 'cashoutsHereIqd', 'cashoutsHereTickets']))
      .toEqual({ forfeitsIqd: 20000, forfeitedTickets: 2, restoredTickets: 1, cashoutsHereIqd: 40000, cashoutsHereTickets: 4 });
  });

  it('the liability is an exact replay of the ledger at p_ts_to', () => {
    // At 20:30 P2 is cashed out and g5's ticket lost, P4 not yet cashed out:
    // g1's three, g3's, the restored one and P4's two are owed.
    const cut = minus(data<Json>(r, 'tmf_2030'), data<Json>(r, 'base_tmf_2030'));
    expect(pick(cut, ['liabilityIqd', 'liabilityTickets', 'refundedIqd', 'refundedTickets', 'forfeitsIqd', 'cashoutsHereIqd']))
      .toEqual({ liabilityIqd: 72000, liabilityTickets: 7, refundedIqd: 20000, refundedTickets: 2, forfeitsIqd: 10000, cashoutsHereIqd: 20000 });
    const at21 = minus(data<Json>(r, 'tmf_2100'), data<Json>(r, 'base_tmf_2100'));
    expect(pick(at21, ['liabilityIqd', 'liabilityTickets', 'soldIqd'])).toEqual({ liabilityIqd: 72000, liabilityTickets: 7, soldIqd: 0 });
  });

  it('day_close_online: deposits, tickets here and chain-wide, the day\'s matches (M3), sandbox tallies', () => {
    const d = data<Json>(r, 'dco');
    expect(d).toMatchObject({ day_session_id: data(r, 'day_id'), venue_id: data(r, 'v_id'), business_date: DAY });
    expect(typeof d.as_of).toBe('string');
    // Received: 09:00, 09:30 and 03:30 the next morning; not 03:59 that
    // morning (the day before), the sandbox one or w's.
    expect(d.deposits).toEqual({
      received_iqd: 35000, received_count: 3, refunded_iqd: 10000, refunded_count: 1,
      forfeited_iqd: 10000, forfeited_count: 1, refunds_waiting_iqd: 15000, refunds_waiting_count: 1,
    });
    expect(d.tickets_here).toEqual({
      forfeited_iqd: 10000, forfeited_count: 1, restored_count: 1, cashouts_iqd: 20000, cashouts_count: 2,
    });
    const base = data<Json>(r, 'base_tmf');
    const base21 = data<Json>(r, 'base_tmf_2100');
    const chain = d.tickets_chain as Json;
    expect({
      sold_iqd: Number(chain.sold_iqd) - Number(base.soldIqd),
      sold_tickets: Number(chain.sold_tickets) - Number(base.soldTickets),
      purchases: Number(chain.purchases) - Number(base.purchases),
      refunded_iqd: Number(chain.refunded_iqd) - Number(base.refundedIqd),
      refunded_tickets: Number(chain.refunded_tickets) - Number(base.refundedTickets),
      refunds_waiting_iqd: Number(chain.refunds_waiting_iqd) - Number(base.refundsWaitingIqd),
      refunds_waiting_count: Number(chain.refunds_waiting_count) - Number(base.refundsWaitingCount),
      // As of the close (21:00), not the day's end: P4's tickets were still owed.
      liability_iqd: Number(chain.liability_iqd) - Number(base21.liabilityIqd),
      liability_tickets: Number(chain.liability_tickets) - Number(base21.liabilityTickets),
    }).toEqual({
      sold_iqd: 122000, sold_tickets: 12, purchases: 7, refunded_iqd: 40000, refunded_tickets: 4,
      refunds_waiting_iqd: 20000, refunds_waiting_count: 1, liability_iqd: 72000, liability_tickets: 7,
    });
    // M1 (paid 30,000, no-show written off) and M6 (nothing paid, vacant
    // number written off) are the live match bookings; M2 called off; the
    // no-show carriers of M1, M2 and M7; M5 (sandbox) nowhere.
    expect(d.matches).toEqual({
      bookings: 2, price_iqd: 80000, desk_paid_iqd: 30000, written_off_iqd: 20000, owed_iqd: 30000,
      called_off: 1, no_show_seats: 5,
    });
    const m = d.matches as { price_iqd: number; desk_paid_iqd: number; written_off_iqd: number; owed_iqd: number };
    expect(m.desk_paid_iqd + m.written_off_iqd + m.owed_iqd).toBe(m.price_iqd);
    expect(Number((d.sandbox_excluded as Json).deposits)).toBe(1);
    expect(Number((d.sandbox_excluded as Json).tickets) - Number(base.sandboxExcluded)).toBe(1);
    // The owner at that branch reads the same card.
    expect(data<Json>(r, 'dco_owner')).toMatchObject({ deposits: d.deposits, matches: d.matches, tickets_here: d.tickets_here });
  });

  it('day_close_online picks the branch\'s open day, else its latest; another branch\'s day is not found', () => {
    expect((data<Json>(r, 'dco_default')).day_session_id).toBe((data<Json>(r, 'dco')).day_session_id);
    const open = data<Json>(r, 'dco_open');
    expect(open).toMatchObject({ business_date: '2020-03-09' });
    expect(open.day_session_id).not.toBe((data<Json>(r, 'dco')).day_session_id);
    // Received that day: 12:00 (kept on the 10th) and 03:59 on the 10th.
    expect(open.deposits).toMatchObject({ received_iqd: 15000, received_count: 2, forfeited_iqd: 0, refunded_iqd: 0 });
    const chain = open.tickets_chain as Json;
    expect(Number(chain.sold_iqd) - Number(data<Json>(r, 'base_tmf_09').soldIqd)).toBe(10000);
    expect(failed(r, 'dco_unknown').code).toBe('DAY_NOT_FOUND');
    expect(failed(r, 'dco_other_manager').code).toBe('DAY_NOT_FOUND');
  });

  it('role walls: day_close_online and report_matches are manager and owner; the helper is nobody\'s', () => {
    for (const label of ['dco_cashier', 'dco_desk', 'dco_guest', 'dco_anon', 'rm_cashier', 'rm_desk', 'rm_guest', 'panel_bm']) {
      expect(failed(r, label).code, label).toBe('FORBIDDEN');
    }
    expect(failed(r, 'tmf_owner').code).toMatch(/permission denied for function ticket_money_figures/);
  });

  it('unpaid_played_bookings: match rows name the seats that owe; a paid match with its no-show written off drops off', () => {
    const rows = data<Json[]>(r, 'upb');
    // R0 (no match) and M6's booking; not M1's (paid + written off = price),
    // M7's (no_show) or M2's (cancelled).
    expect(rows.map((x) => x.remaining_iqd)).toEqual([40000, 30000]);
    expect(rows[0]).toMatchObject({ guest_name: 'Walk-in fixture', match_id: null, owed_by_seats_iqd: null,
                                     delta_owed_iqd: null, seats_owing: null });
    expect(rows[1]).toMatchObject({ guest_name: 'Open match', owed_by_seats_iqd: 30000, delta_owed_iqd: 0 });
    expect(rows[1]!.match_id).toBeTruthy();
    expect(rows[1]!.seats_owing).toEqual([
      { seat_no: 1, label: 'Desk One', owed_iqd: 10000 },
      { seat_no: 2, label: data(r, 'g4_name'), owed_iqd: 10000 },
      { seat_no: 3, label: 'Desk Three', owed_iqd: 10000 },
    ]);
    // M3 on both match bookings: paid + written off + remaining = price.
    expect(data(r, 'm3_identity')).toEqual([
      { price: 40000, paid: 0, written_off: 10000, remaining: 30000 },
      { price: 40000, paid: 30000, written_off: 10000, remaining: 0 },
    ]);
  });

  it('report_courts: the matches block, branch-wide whatever the court filter; match bookings stay in the rows', () => {
    const rc = data<Json>(r, 'rc');
    expect(rc.matches).toEqual({
      bookings: 2, bookedIqd: 80000, deskPaidIqd: 30000, writtenOffIqd: 20000, noShowSeats: 5, calledOffShort: 1,
      ticketForfeitsIqd: 10000,
    });
    const rows = (rc.rows as Json[]).map((x) => [x.courtNameEn, x.bookings, x.cancellations, x.noShows]);
    expect(rows).toEqual([['M260 court 1', 2, 0, 1], ['M260 court 2', 1, 1, 0]]);
    expect(rc.totals).toMatchObject({ bookings: 3, revenueIqd: 120000 });
    const c2 = data<Json>(r, 'rc_c2');
    expect(c2.matches).toEqual(rc.matches);
    expect((c2.rows as Json[]).map((x) => x.courtNameEn)).toEqual(['M260 court 2']);
  });

  it('report_matches: totals, tickets, by day and columns for the branch; filters; no person in it', () => {
    const rm = data<Json>(r, 'rm');
    expect(rm.period).toEqual({ from: DAY, to: DAY });
    expect(rm.totals).toEqual({
      started: 6, booked: 4, played: 2, bumped: 1, expired: 1, cancelled: 0, calledOffShort: 1, allNoShow: 1,
      fillRatePct: 66.7, seatsFilled: 17, accountSeats: 5, friendSeats: 1, deskSeats: 11, attendedSeats: 8,
      noShowSeats: 5, leftLateSeats: 1, refilledSeats: 1, bookedIqd: 80000, deskPaidIqd: 30000, writtenOffIqd: 20000,
      ticketForfeitsIqd: 10000, sandboxExcluded: 1,
    });
    const tickets = rm.tickets as Json;
    expect(tickets.chainWide).toEqual(['soldIqd', 'soldTickets', 'refundedIqd', 'refundedTickets', 'liabilityIqd', 'liabilityTickets']);
    const counted = (o: Json) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'chainWide'));
    expect(minus(counted(tickets), counted((data<Json>(r, 'base_rm')).tickets as Json))).toEqual({
      soldIqd: 122000, soldTickets: 12, refundedIqd: 40000, refundedTickets: 4, forfeitsIqd: 10000,
      forfeitedTickets: 1, liabilityIqd: 52000, liabilityTickets: 5,
    });
    expect(rm.byDay).toEqual([{ date: DAY, started: 6, booked: 4, bookedIqd: 80000, writtenOffIqd: 20000, noShowSeats: 5 }]);
    expect((rm.columns as Json[]).map((c) => [c.key, c.kind])).toEqual([
      ['date', 'date'], ['started', 'count'], ['booked', 'count'], ['bookedIqd', 'money'], ['writtenOffIqd', 'money'],
      ['noShowSeats', 'count'],
    ]);
    for (const c of rm.columns as Json[]) expect(c.labelEn && c.labelAr, String(c.key)).toBeTruthy();
    // G6a: no name, phone or id of a person anywhere in the payload.
    expect(JSON.stringify(rm)).not.toMatch(/Desk One|Desk Three|Test g|customer_id|guest_id|full_name|phone/);
    // The owner scoped to v reads the same report.
    expect(data<Json>(r, 'rm_owner').totals).toEqual(rm.totals);
  });

  it('report_matches filters: category and joinPolicy; anything else is INVALID_ARGUMENT naming the key', () => {
    expect(data<Json>(r, 'rm_women').totals).toMatchObject({
      started: 1, booked: 1, played: 1, fillRatePct: 100, seatsFilled: 4, deskSeats: 4, attendedSeats: 3,
      refilledSeats: 1, bookedIqd: 40000, deskPaidIqd: 0, writtenOffIqd: 10000, sandboxExcluded: 0,
    });
    expect(data<Json>(r, 'rm_approve').totals).toMatchObject({
      started: 1, booked: 1, played: 1, accountSeats: 3, friendSeats: 1, noShowSeats: 1, bookedIqd: 40000,
      deskPaidIqd: 30000, writtenOffIqd: 10000,
    });
    expect(data<Json>(r, 'rm_null_category').totals).toEqual(data<Json>(r, 'rm').totals);
    expect(failed(r, 'rm_bad_category')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'category' });
    expect(failed(r, 'rm_bad_policy')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'joinPolicy' });
    expect(failed(r, 'rm_bad_key')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'courtId' });
    expect(failed(r, 'rm_not_object')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_filters' });
    expect(failed(r, 'rm_range').code).toBe('INVALID_RANGE');
  });

  it('branch scoping: w\'s match only at w; another branch\'s manager sees none of v\'s', () => {
    expect(data<Json>(r, 'rm_owner_w').totals).toMatchObject({
      started: 1, booked: 1, played: 1, bookedIqd: 40000, deskPaidIqd: 0, writtenOffIqd: 30000, noShowSeats: 1,
      ticketForfeitsIqd: 10000,
    });
    expect(data<Json>(r, 'rm_other_manager').totals).toMatchObject({ started: 0, bookedIqd: 0, ticketForfeitsIqd: 0 });
  });

  it('panel_headline: the seven keys last; ticket money is never cash or revenue (M8); all branches add w', () => {
    const p = data<Json>(r, 'panel_v');
    expect((p.figures as Json[]).map((f) => f.key)).toEqual([
      'revenue', 'padelRevenue', 'cafeRevenue', 'cafeNet', 'cash', 'card', 'bookings', 'orders', 'avgOrderValue',
      'discounts', 'refunds', 'waste', 'noShows',
      'onlineDeposits', 'depositForfeits', 'ticketSales', 'ticketRefunds', 'ticketForfeits', 'ticketLiability',
      'matchWrittenOff',
      // 0285 (coaching, money.md §8.2): lesson revenue as its own line, and the coaches' share.
      'lessonRevenue', 'owedToCoaches',
    ]);
    const v = minus(figures(p), figures(data<Json>(r, 'base_panel_v')));
    expect(pick(v, ['onlineDeposits', 'depositForfeits', 'ticketSales', 'ticketRefunds', 'ticketForfeits',
                    'ticketLiability', 'matchWrittenOff'])).toEqual({
      onlineDeposits: 25000, depositForfeits: 10000, ticketSales: 122000, ticketRefunds: 40000, ticketForfeits: 10000,
      ticketLiability: 52000, matchWrittenOff: 20000,
    });
    // M8: the one payment is M1's 30,000 in cash; padel revenue is the three
    // live bookings' prices; no ticket or deposit money in either.
    expect(pick(v, ['cash', 'card', 'padelRevenue', 'bookings', 'noShows']))
      .toEqual({ cash: 30000, card: 0, padelRevenue: 120000, bookings: 3, noShows: 1 });
    const all = minus(figures(data<Json>(r, 'panel_all')), figures(data<Json>(r, 'base_panel_all')));
    expect(pick(all, ['onlineDeposits', 'depositForfeits', 'ticketSales', 'ticketForfeits', 'ticketLiability', 'matchWrittenOff']))
      .toEqual({ onlineDeposits: 35000, depositForfeits: 10000, ticketSales: 122000, ticketForfeits: 20000,
                 ticketLiability: 52000, matchWrittenOff: 50000 });
  });
});
