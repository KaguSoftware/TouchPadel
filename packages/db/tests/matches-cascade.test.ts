/**
 * 0263 match_reservation_triggers, part A: a booked match follows its own
 * booking (docs/design/open-matches/db.md §3.1, §3.3, §4.8.1, §6 situations
 * 21, 25, 28, 29; build contracts R12, R16, R37, DF-4).
 *
 * One rolled-back scenario at a branch made inside it (two courts, the desk
 * working there, an open business day for the matches already started), the
 * booked matches planted with their booking and four seats on tickets:
 *   * cancel: the desk cancels the booking; the match is cancelled
 *     (reservation_cancelled, actor staff), every in ticket comes back;
 *   * cancel after marks: an attended seat, a no-show and a late leave whose
 *     tickets were forfeited, an unmarked seat: every ticket comes back (the
 *     venue cancelled, nobody loses a ticket inside the marks window);
 *   * complete: mark_reservation completed plays the match (R37: unmarked
 *     carriers attended, auto) and forfeits the unrefilled late leave;
 *   * move and extend: the match's times, length and the moved court follow
 *     (event moved), even to before the old fill deadline;
 *   * MATCH_MARK_SEATS: a booking-level no-show is refused, through
 *     mark_reservation (0262's re-issue) and as a bare row update (the
 *     trigger's backstop); nothing moves;
 *   * all four no-show (0262's mark_match_seats): the match ends no_show,
 *     then the booking; the trigger neither refuses nor ends it twice; a
 *     correction reopens both; a court re-sold meanwhile keeps it closed
 *     (SEAT_MARK_LOCKED court_reused).
 * pg_temp.ledger() after every ticket move.
 */
import { describe, expect, it } from 'vitest';
import { MATCH_MONEY_CHECK, stackAvailable } from './helpers';
import { Q, T, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, MONEY, SETUP, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** This suite's planting helpers, on top of matches-harness's SETUP. */
const MORE = String.raw`
-- A booked match planted at p_when on court p_court with its booking (the
-- row kept as r_<name>, priced by the match's rule as match_try_book stamps it)
-- and four seats in: p_a with a friend, p_b, p_c, each on a fresh ticket of
-- its holder.
create function pg_temp.booked(p_name text, p_when timestamptz, p_court text, p_a text, p_b text, p_c text)
returns uuid language plpgsql as $f$
declare v uuid; r uuid := pg_temp.res(p_court, p_when, 90);
begin
  update reservations set price_iqd = 40000, rate_rule_id = pg_temp.var('rule')::uuid where id = r;
  v := pg_temp.m(jsonb_build_object('status', 'booked', 'reservation_id', r, 'start_at', p_when,
                                    'organiser_id', pg_temp.var(p_a), 'price_court_id', pg_temp.var(p_court)));
  perform pg_temp.seat(v, 1, 'account', pg_temp.var(p_a)::uuid);
  perform pg_temp.seat(v, 2, 'friend', pg_temp.var(p_a)::uuid);
  perform pg_temp.seat(v, 3, 'account', pg_temp.var(p_b)::uuid);
  perform pg_temp.seat(v, 4, 'account', pg_temp.var(p_c)::uuid);
  insert into pg_temp.vars values (p_name, v::text), ('r_' || p_name, r::text);
  return v;
end $f$;

-- The seat of a match on a number (its latest).
create function pg_temp.s(p_match text, p_no int) returns uuid language sql as $f$
  select s.id from match_seats s where s.match_id = pg_temp.var(p_match)::uuid and s.seat_no = p_no
   order by s.joined_at desc, s.id desc limit 1
$f$;

-- A mark as the desk leaves it (planted: the desk's RPC is 0262's):
-- attended (ticket released), no_show (ticket forfeited), late (a left_late
-- seat whose ticket the start forfeited).
create function pg_temp.mark(p_match text, p_no int, p_to text) returns void language plpgsql as $f$
declare v_s uuid := pg_temp.s(p_match, p_no); v_t uuid := (select ticket_id from match_seats where id = v_s);
begin
  if p_to = 'attended' then
    perform app.ticket_release(array[v_t], 'attended', array[v_s]);
    update match_seats set status = 'attended', marked_at = now() where id = v_s;
  elsif p_to = 'no_show' then
    update match_seats set status = 'no_show', marked_at = now() where id = v_s;
    perform app.ticket_forfeit(v_t, v_s);
  elsif p_to = 'late' then
    update match_seats set status = 'left_late', ended_at = now(), end_reason = 'left' where id = v_s;
    perform app.ticket_forfeit(v_t, v_s);
  elsif p_to = 'left_late' then
    update match_seats set status = 'left_late', ended_at = now(), end_reason = 'left' where id = v_s;
  end if;
end $f$;
` + MATCH_MONEY_CHECK;

/** A match's seats as "no:status/ticket". */
const SEATS = (m: string) =>
  `select jsonb_agg(s.seat_no || ':' || s.status || '/' || coalesce(k.status, '-') order by s.seat_no, s.joined_at)
     from match_seats s left join match_tickets k on k.id = s.ticket_id where s.match_id = {{${m}}}`;
const MATCH = (m: string) =>
  `select to_jsonb(status || coalesce(':' || ended_reason, '')) from matches where id = {{${m}}}`;
const BOOKING = (m: string) =>
  `select to_jsonb(r.status || coalesce(':' || r.cancellation_reason, ''))
     from matches mt join reservations r on r.id = mt.reservation_id where mt.id = {{${m}}}`;
const EVENTS = (m: string) =>
  `select jsonb_agg(e.type || coalesce(':' || e.code, '') || '@' || e.actor order by e.id)
     from match_events e where e.match_id = {{${m}}}`;
const MARK = (seats: string[], to: string) =>
  `select app.mark_match_seats(array[${seats.map((s) => `{{${s}}}`).join(', ')}]::uuid[], '${to}')`;

describe.skipIf(!docker)('the cascade half of the reservation trigger (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m262c', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      X(`insert into staff_venues (staff_id, venue_id, role) values ({{desk}}, {{v}}, 'court_desk')`),
      // The marks window (R13): the business days of the started matches open.
      X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
         select distinct {{v}}::uuid, app.venue_business_date({{v}}, t), 'open'::day_status, {{manager}}::uuid, 0
           from unnest(array[now() - interval '7 hours', now() - interval '5 hours', now() - interval '1 hour']) t
         on conflict (venue_id, business_date) do nothing`),
      GUEST('pa'), GUEST('pb'), GUEST('pc'),

      // K1. The desk cancels a future booked match's booking.
      `select pg_temp.booked('k1', ${at(3)}, 'c1', 'pa', 'pb', 'pc');`,
      T('cancel_k1', 'desk', `select app.cancel_reservation({{r_k1}}, 'M262 cancel')`),
      Q('k1', `select pg_temp.state('k1')`),
      Q('k1_events', EVENTS('k1')),
      Q('ledger_k1', `select pg_temp.ledger()`),

      // K2. Cancelled after marks: 1 attended, 2 unmarked, 3 no-show, 4 a
      //     late leave forfeited at the start.
      `select pg_temp.booked('k2', now() - interval '1 hour', 'c2', 'pa', 'pb', 'pc');`,
      `select pg_temp.mark('k2', 1, 'attended');`,
      `select pg_temp.mark('k2', 3, 'no_show');`,
      `select pg_temp.mark('k2', 4, 'late');`,
      Q('k2_marked', SEATS('k2')),
      T('cancel_k2', 'desk', `select app.cancel_reservation({{r_k2}}, 'M262 cancel after marks')`),
      Q('k2', MATCH('k2')),
      Q('k2_seats', SEATS('k2')),
      Q('k2_restored', `select count(*) from match_ticket_events x
                         where x.match_id = {{k2}} and x.type = 'restored'`),
      Q('ledger_k2', `select pg_temp.ledger()`),

      // K3. The desk completes a booking that ended: unmarked carriers are
      //     attended (R37), the unrefilled late leave loses its ticket.
      `select pg_temp.booked('k3', now() - interval '2 hours', 'c1', 'pa', 'pb', 'pc');`,
      `select pg_temp.mark('k3', 3, 'attended');`,
      `select pg_temp.mark('k3', 4, 'left_late');`,
      T('complete_k3', 'desk', `select app.mark_reservation({{r_k3}}, 'completed', null)`),
      Q('k3', MATCH('k3')),
      Q('k3_booking', BOOKING('k3')),
      Q('k3_seats', SEATS('k3')),
      Q('k3_events', EVENTS('k3')),
      Q('ledger_k3', `select pg_temp.ledger()`),

      // K4. A desk move to the other court, three hours earlier (before the
      //     old fill deadline), then an extend.
      `select pg_temp.booked('k4', ${at(4)}, 'c1', 'pa', 'pb', 'pc');`,
      T('move_k4', 'desk', `select app.move_reservation({{r_k4}}, {{c2}}, ${at(4, -3)}, ${at(4, -3)} + interval '90 minutes', 'M262 court swap')`),
      Q('k4_moved', `select jsonb_build_object('status', m.status, 'start_ok', m.start_at = ${at(4, -3)},
                                               'end_ok', m.end_at = ${at(4, -3)} + interval '90 minutes',
                                               'duration_min', m.duration_min,
                                               'before_old_deadline', m.start_at < m.fill_deadline_at,
                                               'shares', m.shares_iqd)
                       from matches m where m.id = {{k4}}`),
      T('extend_k4', 'desk', `select app.extend_reservation({{r_k4}}, ${at(4, -3)} + interval '120 minutes', 'M262 extend')`),
      Q('k4_extended', `select jsonb_build_object('duration_min', m.duration_min,
                                                  'end_ok', m.end_at = ${at(4, -3)} + interval '120 minutes')
                          from matches m where m.id = {{k4}}`),
      Q('k4_events', `select jsonb_agg(jsonb_build_object('type', e.type, 'actor', e.actor,
                                                          'court_is_c2', (e.data->>'court_id')::uuid = {{c2}}) order by e.id)
                        from match_events e where e.match_id = {{k4}}`),
      Q('k4_seats', SEATS('k4')),

      // K5. A booking-level no-show on a match booking.
      `select pg_temp.booked('k5', now() - interval '20 minutes', 'c1', 'pa', 'pb', 'pc');`,
      T('k5_mark_reservation', 'desk', `select app.mark_reservation({{r_k5}}, 'no_show', null)`),
      E('k5_row', null, `with u as (update reservations set status = 'no_show' where id = {{r_k5}} returning id)
                         select to_jsonb(count(*)) from u`),
      Q('k5', MATCH('k5')),
      Q('k5_booking', BOOKING('k5')),
      Q('k5_seats', SEATS('k5')),
      Q('ledger_k5', `select pg_temp.ledger()`),

      // K6. All four marked no-show at the desk (0262), then one corrected.
      `select pg_temp.booked('k6', now() - interval '5 hours', 'c1', 'pa', 'pb', 'pc');`,
      K('k6s1', `select pg_temp.s('k6', 1)`), K('k6s2', `select pg_temp.s('k6', 2)`),
      K('k6s3', `select pg_temp.s('k6', 3)`), K('k6s4', `select pg_temp.s('k6', 4)`),
      T('k6_all', 'desk', MARK(['k6s1', 'k6s2', 'k6s3', 'k6s4'], 'no_show')),
      Q('k6', MATCH('k6')),
      Q('k6_booking', BOOKING('k6')),
      Q('k6_seats', SEATS('k6')),
      Q('k6_events', EVENTS('k6')),
      Q('ledger_k6', `select pg_temp.ledger()`),
      T('k6_reopen', 'desk', MARK(['k6s1'], 'attended')),
      Q('k6_reopened', `select jsonb_build_object('match', (${MATCH('k6')}), 'booking', (${BOOKING('k6')}))`),
      Q('k6_seats_reopened', SEATS('k6')),
      Q('ledger_k6_reopen', `select pg_temp.ledger()`),

      // K7. All four no-show, the court re-sold, then a correction.
      `select pg_temp.booked('k7', now() - interval '7 hours', 'c2', 'pa', 'pb', 'pc');`,
      K('k7s1', `select pg_temp.s('k7', 1)`), K('k7s2', `select pg_temp.s('k7', 2)`),
      K('k7s3', `select pg_temp.s('k7', 3)`), K('k7s4', `select pg_temp.s('k7', 4)`),
      T('k7_all', 'desk', MARK(['k7s1', 'k7s2', 'k7s3', 'k7s4'], 'no_show')),
      X(`select pg_temp.res('c2', now() - interval '7 hours', 90)`),
      T('k7_reopen', 'desk', MARK(['k7s1'], 'attended')),
      Q('k7', MATCH('k7')),
      Q('k7_seats', SEATS('k7')),
      Q('ledger_end', `select pg_temp.ledger()`),
      MONEY('money_c'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_c')).toEqual({});
  });

  it('cancel: the match ends reservation_cancelled with the desk as actor; every ticket is back', () => {
    expect(data<Json>(r, 'cancel_k1')).toMatchObject({ status: 'cancelled', cancelled_by: 'staff' });
    expect(data<Json>(r, 'k1')).toMatchObject({ match: { status: 'cancelled', ended_reason: 'reservation_cancelled' } });
    expect(((data<Json>(r, 'k1').seats as Json[]).map((s) => `${s.status}/${s.ticket}`))).toEqual([
      'cancelled/available', 'cancelled/available', 'cancelled/available', 'cancelled/available',
    ]);
    expect(data(r, 'k1_events')).toEqual(['cancelled:reservation_cancelled@staff']);
    expect(data(r, 'ledger_k1')).toEqual([]);
  });

  it('cancel after marks: forfeits restored, in tickets released, nobody loses a ticket', () => {
    expect(data(r, 'k2_marked')).toEqual(['1:attended/available', '2:in/in_use', '3:no_show/forfeited', '4:left_late/forfeited']);
    expect(data(r, 'k2')).toBe('cancelled:reservation_cancelled');
    expect(data(r, 'k2_seats')).toEqual([
      '1:cancelled/available', '2:cancelled/available', '3:cancelled/available', '4:cancelled/available',
    ]);
    expect(data(r, 'k2_restored')).toBe(2);
    expect(data(r, 'ledger_k2')).toEqual([]);
  });

  it('complete: played, unmarked carriers attended (auto, R37), the unrefilled late leave forfeited', () => {
    expect(data<Json>(r, 'complete_k3')).toMatchObject({ status: 'completed' });
    expect(data(r, 'k3')).toBe('played');
    expect(data(r, 'k3_booking')).toBe('completed');
    expect(data(r, 'k3_seats')).toEqual(['1:attended/available', '2:attended/available', '3:attended/available',
                                         '4:left_late/forfeited']);
    expect(data(r, 'k3_events')).toEqual(['seat_attended:auto@staff', 'seat_attended:auto@staff', 'played@staff']);
    expect(data(r, 'ledger_k3')).toEqual([]);
  });

  it('move and extend: the match follows its booking; shares stay stamped; the deadline binds only while filling', () => {
    expect(data<Json>(r, 'move_k4')).toMatchObject({ price_changed: true });
    expect(data(r, 'k4_moved')).toEqual({
      status: 'booked', start_ok: true, end_ok: true, duration_min: 90, before_old_deadline: true,
      shares: [10000, 10000, 10000, 10000],
    });
    expect(data(r, 'k4_extended')).toEqual({ duration_min: 120, end_ok: true });
    expect(data(r, 'k4_events')).toEqual([
      { type: 'moved', actor: 'staff', court_is_c2: true },
      { type: 'moved', actor: 'staff', court_is_c2: true },
    ]);
    expect(data(r, 'k4_seats')).toEqual(['1:in/in_use', '2:in/in_use', '3:in/in_use', '4:in/in_use']);
  });

  it('MATCH_MARK_SEATS: a booking-level no-show is refused through the RPC and as a bare row update', () => {
    expect(failed(r, 'k5_mark_reservation').code).toBe('MATCH_MARK_SEATS');
    expect(failed(r, 'k5_row').code).toBe('MATCH_MARK_SEATS');
    expect(data(r, 'k5')).toBe('booked');
    expect(data(r, 'k5_booking')).toBe('confirmed');
    expect(data(r, 'k5_seats')).toEqual(['1:in/in_use', '2:in/in_use', '3:in/in_use', '4:in/in_use']);
    expect(data(r, 'ledger_k5')).toEqual([]);
  });

  it('all four no-show: the match ends first, the booking follows, the trigger stays out; a correction reopens both', () => {
    expect(data<Json>(r, 'k6_all')).toMatchObject({ match_status: 'no_show', reservation_status: 'no_show' });
    expect(data(r, 'k6')).toBe('no_show:all_no_show');
    expect(data(r, 'k6_booking')).toBe('no_show:all_no_show');
    expect(data(r, 'k6_seats')).toEqual(['1:no_show/forfeited', '2:no_show/forfeited', '3:no_show/forfeited',
                                         '4:no_show/forfeited']);
    // One ending, written by the desk's call; the trigger added nothing.
    expect((data<string[]>(r, 'k6_events')).filter((e) => e.startsWith('no_show'))).toEqual(['no_show:all_no_show@staff']);
    expect(data(r, 'ledger_k6')).toEqual([]);
    expect(data<Json>(r, 'k6_reopen')).toMatchObject({ match_status: 'booked', reservation_status: 'arrived' });
    expect(data(r, 'k6_reopened')).toEqual({ match: 'booked', booking: 'arrived' });
    expect(data(r, 'k6_seats_reopened')).toEqual(['1:attended/available', '2:no_show/forfeited', '3:no_show/forfeited',
                                                  '4:no_show/forfeited']);
    expect(data(r, 'ledger_k6_reopen')).toEqual([]);
  });

  it('all four no-show and the court re-sold: the correction is refused court_reused, nothing moves', () => {
    expect(data<Json>(r, 'k7_all')).toMatchObject({ match_status: 'no_show' });
    expect(failed(r, 'k7_reopen')).toMatchObject({ code: 'SEAT_MARK_LOCKED', detail: 'court_reused' });
    expect(data(r, 'k7')).toBe('no_show:all_no_show');
    expect(data(r, 'k7_seats')).toEqual(['1:no_show/forfeited', '2:no_show/forfeited', '3:no_show/forfeited',
                                         '4:no_show/forfeited']);
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});
