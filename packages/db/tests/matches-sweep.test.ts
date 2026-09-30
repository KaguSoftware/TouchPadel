/**
 * 0263 match_sweep: what no request does, every 30 seconds (docs/design/
 * open-matches/db.md §3, §4.8.3, §6 situations 4, 13, 27, 33, 36–38, 43, 46,
 * 48; build contracts R12, R13, R16, R18, R25, R36, R37, DF-18, DF-19,
 * DF-20).
 *
 * Rolled-back scenarios at a branch made inside each (two courts):
 *   * every step once, in one run scoped to the branch: a request past the
 *     deadline and one past the start (closed); deleted and banned holders
 *     of a filling match (left, removed) and a banned requester; a deleted
 *     holder of a booked match (a late leave, ticket still held); the fit
 *     backstop (a closed date: cancelled venue_closed; a length no court
 *     offers: bumped no_court; no firm-free court: bumped); the fill
 *     deadline (expired); the -30 min warning, once; a waiting match booked
 *     once its blocking hold is stale, and one expired no_court at its start;
 *     a late leave forfeited at the start and a deleted holder's released;
 *     the end of play three hours on (played with auto-attend, R37; no_show
 *     when nobody can be attended) and a sandbox match at its end (DF-19); a
 *     healthy match untouched; then a second run that changes nothing;
 *   * one bad match (a trigger stands in for a corrupt row) does not stop the
 *     rest: its changes roll back, it is counted, the next run finishes it;
 *   * a waiting match is not booked while the branch trades offline inside
 *     the protected horizon (0210), and is once the switch is off;
 *   * a chain-wide run's Phase 3: DF-20 refunds a deleted guest's purchase
 *     once the sweep released its last seat in the same run (R13), and match
 *     reports older than 12 months are purged (R36);
 * pg_temp.ledger() after every run. Then the cron row (tp_match_sweep) and the
 * grants (the sweep the service role's, the trigger and match_court_claimed
 * nobody's, hold_slot and staff_create_reservation as before), and, over two
 * sessions: a branch whose
 * mutex another session holds is skipped when it is not the run's first,
 * never waited on (C21), and waited for when the rotation puts it first.
 */
import { describe, expect, it } from 'vitest';
import { MATCH_MONEY_CHECK, stackAvailable } from './helpers';
import { Q, T, X, dockerReachable, psql, psqlSession, scenario, waitForSleeper, type Results } from './stores-harness';
import { GUEST, K, MONEY, SETUP, at, data } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** This suite's planting helpers, on top of matches-harness's SETUP. */
const MORE = String.raw`
-- A match planted (pg_temp.m with p) and kept under p_name.
create function pg_temp.plant(p_name text, p jsonb) returns uuid language plpgsql as $f$
declare v uuid := pg_temp.m(p);
begin
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- A seat by names (pg_temp.seat: a fresh ticket of the holder, in use while
-- in or left_late).
create function pg_temp.at_seat(p_match text, p_no int, p_kind text, p_guest text, p_status text default 'in')
returns uuid language sql as $f$
  select pg_temp.seat(pg_temp.var(p_match)::uuid, p_no, p_kind, pg_temp.var(p_guest)::uuid, p_status)
$f$;

-- A filling (or p's status) match at p_when with three seats in: the
-- organiser p_org with a friend, and p_other.
create function pg_temp.three(p_name text, p_when timestamptz, p_org text, p_other text, p jsonb default '{}')
returns uuid language plpgsql as $f$
declare v uuid := pg_temp.plant(p_name, jsonb_build_object('start_at', p_when, 'organiser_id', pg_temp.var(p_org)) || p);
begin
  perform pg_temp.at_seat(p_name, 1, 'account', p_org);
  perform pg_temp.at_seat(p_name, 2, 'friend', p_org);
  perform pg_temp.at_seat(p_name, 3, 'account', p_other);
  return v;
end $f$;

-- A booked match at p_when on court p_court with its booking (kept as
-- r_<name>) and four seats in: p_a with a friend, p_b, p_c.
create function pg_temp.booked(p_name text, p_when timestamptz, p_court text, p_a text, p_b text, p_c text)
returns uuid language plpgsql as $f$
declare r uuid := pg_temp.res(p_court, p_when, 90); v uuid;
begin
  -- The match's price and rule, as match_try_book stamps them on the booking.
  update reservations set price_iqd = 40000, rate_rule_id = pg_temp.var('rule')::uuid where id = r;
  v := pg_temp.plant(p_name, jsonb_build_object('status', 'booked', 'reservation_id', r, 'start_at', p_when,
                                                'organiser_id', pg_temp.var(p_a),
                                                'price_court_id', pg_temp.var(p_court)));
  perform pg_temp.at_seat(p_name, 1, 'account', p_a);
  perform pg_temp.at_seat(p_name, 2, 'friend', p_a);
  perform pg_temp.at_seat(p_name, 3, 'account', p_b);
  perform pg_temp.at_seat(p_name, 4, 'account', p_c);
  insert into pg_temp.vars values ('r_' || p_name, r::text);
  return v;
end $f$;

-- A pending request of p_guest for p_seats seats, its tickets reserved.
create function pg_temp.req(p_name text, p_match text, p_guest text, p_seats int default 1)
returns uuid language plpgsql as $f$
declare
  v_m matches;
  v_g uuid := pg_temp.var(p_guest)::uuid;
  v_t uuid[] := '{}';
  v   uuid;
  i   int;
begin
  select * into v_m from matches where id = pg_temp.var(p_match)::uuid;
  insert into match_requests (venue_id, match_id, guest_id, seats_requested)
  values (v_m.venue_id, v_m.id, v_g, p_seats) returning id into v;
  for i in 1 .. p_seats loop
    v_t := v_t || pg_temp.ticket(v_g, v_m.sandbox);
  end loop;
  perform app.ticket_lock(v_t, null, v);
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- The seat of a match on a number (its latest).
create function pg_temp.s(p_match text, p_no int) returns uuid language sql as $f$
  select s.id from match_seats s where s.match_id = pg_temp.var(p_match)::uuid and s.seat_no = p_no
   order by s.joined_at desc, s.id desc limit 1
$f$;

-- A mark as the desk leaves it: attended (ticket released), no_show (ticket
-- forfeited), late (a late leave its start forfeited), left_late (a late
-- leave still holding its ticket).
create function pg_temp.mark(p_match text, p_no int, p_to text) returns void language plpgsql as $f$
declare v_s uuid := pg_temp.s(p_match, p_no); v_t uuid := (select ticket_id from match_seats where id = v_s);
begin
  if p_to = 'attended' then
    perform app.ticket_release(array[v_t], 'attended', array[v_s]);
    update match_seats set status = 'attended', marked_at = now() where id = v_s;
  elsif p_to = 'no_show' then
    update match_seats set status = 'no_show', marked_at = now() where id = v_s;
    perform app.ticket_forfeit(v_t, v_s);
  else
    update match_seats set status = 'left_late', ended_at = now(), end_reason = 'left' where id = v_s;
    if p_to = 'late' then
      perform app.ticket_forfeit(v_t, v_s);
    end if;
  end if;
end $f$;

-- A succeeded ticket purchase of p_n tickets, all available; succeeded long
-- ago, so DF-20's queue (oldest first, 50 a call) reaches it first.
create function pg_temp.purchase(p_name text, p_guest text, p_n int) returns uuid language plpgsql as $f$
declare v uuid; v_g uuid := pg_temp.var(p_guest)::uuid; t uuid; i int;
begin
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, ticket_count, status, succeeded_at, deadline_at)
  values (null, null, null, v_g, 'ticket', 'fake', false, gen_random_uuid(), 10000 * p_n, 10000, p_n, 'succeeded',
          now() - interval '10 years', now() + interval '15 minutes')
  returning id into v;
  for i in 1 .. p_n loop
    insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox)
    values (v_g, 'available', 10000, v, false) returning id into t;
    insert into match_ticket_events (ticket_id, guest_id, type, payment_id) values (t, v_g, 'bought', v);
  end loop;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- A match's seats as "no:status/ticket", and its events as "type:code".
create function pg_temp.seats(p_match text) returns jsonb language sql as $f$
  select jsonb_agg(s.seat_no || ':' || s.status || '/' || coalesce(k.status, '-') order by s.seat_no, s.joined_at)
    from match_seats s left join match_tickets k on k.id = s.ticket_id where s.match_id = pg_temp.var(p_match)::uuid
$f$;
create function pg_temp.events(p_match text) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(e.type || coalesce(':' || e.code, '') order by e.id), '[]'::jsonb)
    from match_events e where e.match_id = pg_temp.var(p_match)::uuid
$f$;
create function pg_temp.status(p_match text) returns text language sql as $f$
  select status || coalesce(':' || ended_reason, '') from matches where id = pg_temp.var(p_match)::uuid
$f$;
` + MATCH_MONEY_CHECK;

const SWEEP = (venue = '{{v}}') => `select app.match_sweep(${venue})`;
/** Every count of a sweep answer, zero. */
const ZERO = {
  booked: 0, awaiting_expired: 0, bumped: 0, expired: 0, cancelled: 0, warned: 0, requests_expired: 0,
  left_deleted: 0, removed_banned: 0, forfeited: 0, played: 0, no_show: 0, refunds_started: 0, reports_purged: 0,
  errors: 0,
};

// ── 1. Every step, then a second run ─────────────────────────────────────────

describe.skipIf(!docker)('match_sweep: every step once, scoped to a branch (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m262s', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      GUEST('o1'), GUEST('o2'), GUEST('p1'), GUEST('p2'), GUEST('asker'), GUEST('asker2'),
      GUEST('dd'), GUEST('bb'), GUEST('bq'), GUEST('lt'), GUEST('h1'),
      GUEST('s1', '{"sandbox":true}'), GUEST('s2', '{"sandbox":true}'),

      // Step 1 + 4. W1: the deadline passed ten minutes ago, a request pending.
      `select pg_temp.three('w1', now() + interval '3 hours', 'o1', 'p1',
                            jsonb_build_object('fill_deadline_at', now() - interval '10 minutes'));`,
      `select pg_temp.req('w1q', 'w1', 'asker');`,
      // Step 2. F2: a deleted and a banned holder, a banned requester.
      `select pg_temp.plant('f2', jsonb_build_object('start_at', ${at(3)}, 'organiser_id', pg_temp.var('o2')));`,
      `select pg_temp.at_seat('f2', 1, 'account', 'o2'), pg_temp.at_seat('f2', 2, 'account', 'dd'),
              pg_temp.at_seat('f2', 3, 'account', 'bb');`,
      `select pg_temp.req('f2q', 'f2', 'bq');`,
      // Step 2 (booked). B2: a deleted holder's seat before the start.
      `select pg_temp.booked('b2', ${at(4)}, 'c1', 'o2', 'dd', 'p1');`,
      // Step 1 + 7. B3: started half an hour ago; two late leaves still
      // holding their tickets (one a deleted holder's); a request pending.
      `select pg_temp.booked('b3', now() - interval '30 minutes', 'c2', 'o1', 'lt', 'dd');`,
      `select pg_temp.mark('b3', 3, 'left_late'), pg_temp.mark('b3', 4, 'left_late');`,
      `select pg_temp.req('b3q', 'b3', 'asker2');`,
      // Step 3. F3a on a date the branch closes; F3b 30 minutes long (no
      // court offers it); F3c at a time both courts are booked.
      `select pg_temp.three('f3a', ${at(12)}, 'o1', 'p1');`,
      X(`update venue_settings set closed_dates = array[(${at(12)} at time zone 'Asia/Baghdad')::date] where venue_id = {{v}}`),
      `select pg_temp.three('f3b', ${at(5)}, 'o1', 'p1', '{"duration_min":30}');`,
      X(`select pg_temp.res('c1', ${at(6)}, 90)`),
      X(`select pg_temp.res('c2', ${at(6)}, 90)`),
      `select pg_temp.three('f3c', ${at(6)}, 'o1', 'p1');`,
      // Step 5. F5: the deadline 20 minutes away.
      `select pg_temp.three('f5', now() + interval '4 hours', 'o1', 'p1',
                            jsonb_build_object('fill_deadline_at', now() + interval '20 minutes'));`,
      // Step 6. A6a waits on a hold gone stale; A6b is still waiting at its start.
      X(`select pg_temp.res('c1', ${at(7)}, 90)`),
      K('h6', `select pg_temp.res('c2', ${at(7)}, 90, 'hold', 'pending', 'h1')`),
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id = {{h6}}`),
      `select pg_temp.three('a6a', ${at(7)}, 'o1', 'p1', '{"status":"awaiting_court"}');`,
      `select pg_temp.at_seat('a6a', 4, 'account', 'p2');`,
      `select pg_temp.three('a6b', now() - interval '10 minutes', 'o2', 'p2', '{"status":"awaiting_court"}');`,
      `select pg_temp.at_seat('a6b', 4, 'account', 'p1');`,
      // Step 8. E8a ended three and a half hours ago (two carriers unmarked);
      // E8b nobody can be attended; E8c a sandbox match ended 30 minutes ago.
      `select pg_temp.booked('e8a', now() - interval '5 hours', 'c1', 'o1', 'p1', 'p2');`,
      `select pg_temp.mark('e8a', 3, 'attended'), pg_temp.mark('e8a', 4, 'no_show');`,
      `select pg_temp.booked('e8b', now() - interval '7 hours', 'c1', 'o2', 'p1', 'p2');`,
      `select pg_temp.mark('e8b', 1, 'no_show'), pg_temp.mark('e8b', 2, 'no_show'), pg_temp.mark('e8b', 3, 'late'),
              pg_temp.mark('e8b', 4, 'no_show');`,
      `select pg_temp.plant('e8c', jsonb_build_object('status', 'booked', 'sandbox', true, 'start_at', now() - interval '2 hours',
                                                     'organiser_id', pg_temp.var('s1')));`,
      `select pg_temp.at_seat('e8c', 1, 'account', 's1'), pg_temp.at_seat('e8c', 2, 'friend', 's1'),
              pg_temp.at_seat('e8c', 3, 'account', 's2');`,
      // Nothing due: a healthy filling match.
      `select pg_temp.three('f0', ${at(8)}, 'o1', 'p1');`,
      // Last, so every seat above was taken while they could play.
      X(`update profiles set deleted_at = now() where id = {{dd}}`),
      `select pg_temp.ban('bb'), pg_temp.ban('bq');`,
      Q('ledger_before', `select pg_temp.ledger()`),

      Q('sweep1', SWEEP()),
      Q('after', `select jsonb_build_object(
          'w1', pg_temp.status('w1'), 'f2', pg_temp.status('f2'), 'b2', pg_temp.status('b2'), 'b3', pg_temp.status('b3'),
          'f3a', pg_temp.status('f3a'), 'f3b', pg_temp.status('f3b'), 'f3c', pg_temp.status('f3c'),
          'f5', pg_temp.status('f5'), 'a6a', pg_temp.status('a6a'), 'a6b', pg_temp.status('a6b'),
          'e8a', pg_temp.status('e8a'), 'e8b', pg_temp.status('e8b'), 'e8c', pg_temp.status('e8c'),
          'f0', pg_temp.status('f0'))`),
      Q('w1', `select jsonb_build_object('seats', pg_temp.seats('w1'), 'events', pg_temp.events('w1'),
                                         'request', (select status from match_requests where id = {{w1q}}),
                                         'asker', pg_temp.wallet('asker'))`),
      Q('f2', `select jsonb_build_object('seats', pg_temp.seats('f2'), 'events', pg_temp.events('f2'),
                                         'request', (select status from match_requests where id = {{f2q}}),
                                         'bq', pg_temp.wallet('bq'))`),
      Q('b2', `select jsonb_build_object('seats', pg_temp.seats('b2'), 'events', pg_temp.events('b2'),
                                         'dd_seat', (select end_reason from match_seats where id = pg_temp.s('b2', 3)))`),
      Q('b3', `select jsonb_build_object('seats', pg_temp.seats('b3'), 'events', pg_temp.events('b3'),
                                         'request', (select status from match_requests where id = {{b3q}}),
                                         'codes', (select jsonb_agg(x.type || ':' || x.code order by x.id)
                                                     from match_ticket_events x
                                                    where x.match_id = {{b3}} and x.type in ('forfeited', 'released')))`),
      Q('f5', `select jsonb_build_object('warned', m.deadline_warned_at is not null, 'events', pg_temp.events('f5'),
                                         'data', (select e.data from match_events e where e.match_id = m.id
                                                    and e.type = 'deadline_warning'))
                 from matches m where m.id = {{f5}}`),
      Q('a6a', `select jsonb_build_object('court_is_c2', r.court_id = {{c2}}, 'guest_name', r.guest_name,
                                          'h6', (select status from reservations where id = {{h6}}),
                                          'events', pg_temp.events('a6a'))
                  from matches m join reservations r on r.id = m.reservation_id where m.id = {{a6a}}`),
      Q('e8', `select jsonb_build_object('e8a', pg_temp.seats('e8a'), 'e8b', pg_temp.seats('e8b'), 'e8c', pg_temp.seats('e8c'),
                                         'e8a_events', pg_temp.events('e8a'),
                                         'e8a_booking', (select status from reservations where id = {{r_e8a}}))`),
      Q('f0', `select jsonb_build_object('seats', pg_temp.seats('f0'), 'events', pg_temp.events('f0'))`),
      Q('ledger_after', `select pg_temp.ledger()`),

      // Idempotency: the same run again changes nothing.
      Q('sweep2', SWEEP()),
      Q('events_total', `select count(*) from match_events e join matches m on m.id = e.match_id where m.venue_id = {{v}}`),
      Q('sweep3', SWEEP()),
      Q('events_total_again', `select count(*) from match_events e join matches m on m.id = e.match_id where m.venue_id = {{v}}`),
      Q('ledger_end', `select pg_temp.ledger()`),
      MONEY('money_s'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_s')).toEqual({});
  });

  it('counts every step once, and leaves the healthy match alone', () => {
    expect(data(r, 'ledger_before')).toEqual([]);
    expect(data(r, 'sweep1')).toEqual({
      ...ZERO, venues_swept: 1, venues_skipped: 0,
      requests_expired: 2, left_deleted: 2, removed_banned: 1, cancelled: 1, bumped: 2, expired: 1, warned: 1,
      booked: 1, awaiting_expired: 1, forfeited: 1, played: 2, no_show: 1,
    });
    expect(data(r, 'after')).toEqual({
      w1: 'expired:deadline', f2: 'filling', b2: 'booked', b3: 'booked',
      f3a: 'cancelled:venue_closed', f3b: 'bumped:no_court', f3c: 'bumped:bumped',
      f5: 'filling', a6a: 'booked', a6b: 'expired:no_court',
      e8a: 'played', e8b: 'no_show:all_no_show', e8c: 'played', f0: 'filling',
    });
    expect(data(r, 'f0')).toEqual({ seats: ['1:in/in_use', '2:in/in_use', '3:in/in_use'], events: [] });
    expect(data(r, 'ledger_after')).toEqual([]);
  });

  it('steps 1 and 4: the request past the deadline closes first, then the match expires; every ticket is back', () => {
    expect(data(r, 'w1')).toEqual({
      seats: ['1:cancelled/available', '2:cancelled/available', '3:cancelled/available'],
      events: ['request_expired:closed', 'expired:deadline'],
      request: 'expired',
      asker: { available: 1 },
    });
  });

  it('step 2: a deleted holder leaves and a banned one is removed; the banned requester\'s request expires', () => {
    const f2 = data<Json>(r, 'f2');
    expect(f2.seats).toEqual(['1:in/in_use', '2:left/available', '3:removed/available']);
    expect([...(f2.events as string[])].sort()).toEqual(['left:account_deleted', 'removed:banned', 'request_expired:banned']);
    expect(f2.request).toBe('expired');
    expect(f2.bq).toEqual({ available: 1 });
  });

  it('step 2, booked: a deleted holder\'s seat becomes a late leave; its ticket stays held until the start (R18)', () => {
    expect(data(r, 'b2')).toEqual({
      seats: ['1:in/in_use', '2:in/in_use', '3:left_late/in_use', '4:in/in_use'],
      events: ['left_late:account_deleted'],
      dd_seat: 'account_deleted',
    });
  });

  it('steps 1 and 7: at the start the late leave is forfeited, the deleted holder\'s released; the request closes', () => {
    expect(data(r, 'b3')).toEqual({
      seats: ['1:in/in_use', '2:in/in_use', '3:left_late/forfeited', '4:left_late/available'],
      events: ['request_expired:closed'],
      request: 'expired',
      // The request's reserved ticket (step 1), then the start (step 7).
      codes: ['released:closed', 'forfeited:late_leave', 'released:account_deleted'],
    });
  });

  it('step 5: the warning once, with the seats taken', () => {
    expect(data(r, 'f5')).toEqual({ warned: true, events: ['deadline_warning'], data: { seats_taken: 3 } });
  });

  it('step 6: the stale hold expired by the first branch\'s lock, the waiting match booked on its court', () => {
    expect(data(r, 'a6a')).toEqual({ court_is_c2: true, guest_name: 'Open match', h6: 'expired', events: ['booked'] });
  });

  it('step 8: auto-attend at end + 3 h (R37), no_show when nobody can be, a sandbox match at its end', () => {
    expect(data(r, 'e8')).toEqual({
      e8a: ['1:attended/available', '2:attended/available', '3:attended/available', '4:no_show/forfeited'],
      e8b: ['1:no_show/forfeited', '2:no_show/forfeited', '3:left_late/forfeited', '4:no_show/forfeited'],
      e8c: ['1:attended/available', '2:attended/available', '3:attended/available'],
      e8a_events: ['seat_attended:auto', 'seat_attended:auto', 'played'],
      // The sweep never writes the booking row.
      e8a_booking: 'confirmed',
    });
  });

  it('a second run changes nothing', () => {
    expect(data(r, 'sweep2')).toEqual({ ...ZERO, venues_swept: 0, venues_skipped: 0 });
    expect(data(r, 'sweep3')).toEqual({ ...ZERO, venues_swept: 0, venues_skipped: 0 });
    expect(data(r, 'events_total_again')).toBe(data(r, 'events_total'));
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});

// ── 2. One bad match ─────────────────────────────────────────────────────────

describe.skipIf(!docker)('match_sweep: one bad match does not stop the rest (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m262e', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      GUEST('o1'), GUEST('p1'),
      `select pg_temp.three('good', now() + interval '3 hours', 'o1', 'p1',
                            jsonb_build_object('fill_deadline_at', now() - interval '5 minutes'));`,
      `select pg_temp.three('bad', now() + interval '5 hours', 'o1', 'p1',
                            jsonb_build_object('fill_deadline_at', now() - interval '5 minutes'));`,
      // A corrupt row stood in for: any event of the bad match fails.
      X(`create function pg_temp.boom() returns trigger language plpgsql as $b$ begin raise exception 'BOOM'; end $b$`),
      X(`create trigger zz_m262_boom before insert on match_events for each row
           when (new.match_id = {{bad}}::uuid) execute function pg_temp.boom()`),
      Q('sweep1', SWEEP()),
      Q('after1', `select jsonb_build_object('good', pg_temp.status('good'), 'bad', pg_temp.status('bad'),
                                             'bad_seats', pg_temp.seats('bad'))`),
      Q('ledger1', `select pg_temp.ledger()`),
      X(`drop trigger zz_m262_boom on match_events`),
      Q('sweep2', SWEEP()),
      Q('after2', `select jsonb_build_object('good', pg_temp.status('good'), 'bad', pg_temp.status('bad'),
                                             'bad_seats', pg_temp.seats('bad'))`),
      Q('ledger2', `select pg_temp.ledger()`),
      MONEY('money_e'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_e')).toEqual({});
  });

  it('the bad match rolls back alone and is counted; the good one is done; the next run finishes the bad one', () => {
    expect(data(r, 'sweep1')).toEqual({ ...ZERO, venues_swept: 1, venues_skipped: 0, expired: 1, errors: 1 });
    expect(data(r, 'after1')).toEqual({
      good: 'expired:deadline', bad: 'filling', bad_seats: ['1:in/in_use', '2:in/in_use', '3:in/in_use'],
    });
    expect(data(r, 'ledger1')).toEqual([]);
    expect(data(r, 'sweep2')).toEqual({ ...ZERO, venues_swept: 1, venues_skipped: 0, expired: 1 });
    expect(data(r, 'after2')).toEqual({
      good: 'expired:deadline', bad: 'expired:deadline',
      bad_seats: ['1:cancelled/available', '2:cancelled/available', '3:cancelled/available'],
    });
    expect(data(r, 'ledger2')).toEqual([]);
  });
});

// ── 3. Offline inside the protected horizon ──────────────────────────────────

describe.skipIf(!docker)('match_sweep: a waiting match is not booked while the branch trades offline (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m262d', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      GUEST('o1'), GUEST('p1'), GUEST('p2'), GUEST('h1'),
      // Degraded (0247/0248): the switch on, a till gone quiet, the day open.
      X(`update venue_settings set offline_mode_enabled = true where venue_id = {{v}}`),
      X(`insert into stations (id, venue_id, is_till, mode) values ('TILL-M262', {{v}}, true, 'till')`),
      X(`insert into device_heartbeats (device_id, venue_id, is_till, last_seen_at)
         values ('TILL-M262', {{v}}, true, now() - interval '10 minutes')`),
      X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
         values ({{v}}, app.venue_business_date({{v}}, now()), 'open', {{manager}}, 0)`),
      Q('degraded', `select to_jsonb(app.is_degraded({{v}}))`),
      // Five hours out: inside the 48-hour protected horizon.
      X(`select pg_temp.res('c1', now() + interval '5 hours', 90)`),
      K('hw', `select pg_temp.res('c2', now() + interval '5 hours', 90, 'hold', 'pending', 'h1')`),
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id = {{hw}}`),
      `select pg_temp.three('aw', now() + interval '5 hours', 'o1', 'p1', '{"status":"awaiting_court"}');`,
      `select pg_temp.at_seat('aw', 4, 'account', 'p2');`,
      Q('sweep_offline', SWEEP()),
      Q('aw_offline', `select jsonb_build_object('status', pg_temp.status('aw'),
                                                 'hw', (select status from reservations where id = {{hw}}))`),
      X(`update venue_settings set offline_mode_enabled = false where venue_id = {{v}}`),
      Q('sweep_online', SWEEP()),
      Q('aw_online', `select to_jsonb(pg_temp.status('aw'))`),
      Q('ledger', `select pg_temp.ledger()`),
    ]);
  });

  it('offline: the stale hold still expires, the booking waits for the desk\'s side; back online, it books', () => {
    expect(data(r, 'degraded')).toBe(true);
    expect(data(r, 'sweep_offline')).toEqual({ ...ZERO, venues_swept: 1, venues_skipped: 0 });
    expect(data(r, 'aw_offline')).toEqual({ status: 'awaiting_court', hw: 'expired' });
    expect(data(r, 'sweep_online')).toEqual({ ...ZERO, venues_swept: 1, venues_skipped: 0, booked: 1 });
    expect(data(r, 'aw_online')).toBe('booked');
    expect(data(r, 'ledger')).toEqual([]);
  });
});

describe.skipIf(!docker)('match_sweep offline: a waiting match the sweep will not book frees its court; one losing a holder refills (rolled back)', () => {
  let r: Results;
  // On the hour, so the desk's create lands on the match's exact period.
  const W = `(date_trunc('hour', now()) + interval '5 hours')`;

  it('runs the scenario', () => {
    r = scenario('m263o', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      X(`insert into staff_venues (staff_id, venue_id, role) values ({{desk}}, {{v}}, 'court_desk')`),
      GUEST('o1'), GUEST('p1'), GUEST('p2'), GUEST('h1'), GUEST('o2'), GUEST('q1'), GUEST('q2'),
      // Degraded (0247/0248), as above.
      X(`update venue_settings set offline_mode_enabled = true where venue_id = {{v}}`),
      X(`insert into stations (id, venue_id, is_till, mode) values ('TILL-M263', {{v}}, true, 'till')`),
      X(`insert into device_heartbeats (device_id, venue_id, is_till, last_seen_at)
         values ('TILL-M263', {{v}}, true, now() - interval '10 minutes')`),
      X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
         values ({{v}}, app.venue_business_date({{v}}, now()), 'open', {{manager}}, 0)`),
      Q('degraded', `select to_jsonb(app.is_degraded({{v}}))`),

      // AW waits five hours out (inside the protected horizon): court 1 is
      // booked, court 2 held by a hold that goes stale.
      X(`select pg_temp.res('c1', ${W}, 90)`),
      K('hw', `select pg_temp.res('c2', ${W}, 90, 'hold', 'pending', 'h1')`),
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id = {{hw}}`),
      `select pg_temp.three('aw', ${W}, 'o1', 'p1', '{"status":"awaiting_court"}');`,
      `select pg_temp.at_seat('aw', 4, 'account', 'p2');`,
      // AB waits eight hours out with a banned holder; AC three hours out, its
      // fill deadline passed, with the same banned holder. Both lose one.
      X(`select pg_temp.res('c1', ${W} + interval '3 hours', 90)`),
      X(`select pg_temp.res('c2', ${W} + interval '3 hours', 90, 'hold', 'pending', 'h1')`),
      `select pg_temp.three('ab', ${W} + interval '3 hours', 'o2', 'q1', '{"status":"awaiting_court"}');`,
      `select pg_temp.at_seat('ab', 4, 'account', 'q2');`,
      X(`select pg_temp.res('c1', ${W} - interval '2 hours', 90)`),
      X(`select pg_temp.res('c2', ${W} - interval '2 hours', 90, 'hold', 'pending', 'h1')`),
      `select pg_temp.three('ac', ${W} - interval '2 hours', 'o2', 'q1',
                            jsonb_build_object('status', 'awaiting_court', 'fill_deadline_at', now() - interval '5 minutes'));`,
      `select pg_temp.at_seat('ac', 4, 'account', 'q2');`,
      `select pg_temp.ban('q2');`,

      Q('sweep_offline', SWEEP()),
      Q('after', `select jsonb_build_object('aw', pg_temp.status('aw'), 'ab', pg_temp.status('ab'),
                                            'ac', pg_temp.status('ac'),
                                            'hw', (select status from reservations where id = {{hw}}),
                                            'ab_carriers', (select count(*) from app.match_carriers(pg_temp.var('ab')::uuid) c
                                                             where c.seat_id is not null))`),
      Q('claimed', `select to_jsonb(app.match_court_claimed({{c2}}, tstzrange(${W}, ${W} + interval '90 minutes', '[)')))`),
      // The desk takes AW's court: not refused while the sweep will not book
      // AW, and the new booking bumps AW (trigger part B).
      T('desk_takes', 'desk', `select app.staff_create_reservation({{c2}}, 'booking', ${W}, ${W} + interval '90 minutes', 'M263 walk-in')`),
      Q('aw_after_desk', `select to_jsonb(pg_temp.status('aw'))`),
      Q('ledger', `select pg_temp.ledger()`),
    ]);
  });

  it('a waiting match losing a holder goes back to filling (3/4), or expires once past its deadline', () => {
    expect(data(r, 'degraded')).toBe(true);
    expect(data(r, 'sweep_offline')).toEqual({ ...ZERO, venues_swept: 1, venues_skipped: 0, removed_banned: 2, expired: 1 });
    expect(data(r, 'after')).toEqual({ aw: 'awaiting_court', ab: 'filling', ac: 'expired:deadline', hw: 'expired',
                                       ab_carriers: 3 });
  });

  it('R22 yields offline inside the horizon: the court is not claimed, the desk books it, the match is bumped', () => {
    expect(data(r, 'claimed')).toBe(false);
    expect(data<Json>(r, 'desk_takes')).toBeTruthy();
    expect(data(r, 'aw_after_desk')).toBe('bumped:bumped');
    expect(data(r, 'ledger')).toEqual([]);
  });
});

describe.skipIf(!docker)('match_sweep: a first branch with only booked work expires no holds (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m263h', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      GUEST('a1'), GUEST('b1'), GUEST('c1g'), GUEST('h1'),
      // A booked match that ended four hours ago (step 8 is due), and a stale
      // hold next week that no due match overlaps.
      `select pg_temp.booked('bk', now() - interval '5 hours 30 minutes', 'c1', 'a1', 'b1', 'c1g');`,
      K('hs', `select pg_temp.res('c2', ${at(7)}, 90, 'hold', 'pending', 'h1')`),
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id = {{hs}}`),
      Q('sweep', SWEEP()),
      Q('after', `select jsonb_build_object('bk', pg_temp.status('bk'),
                                            'hs', (select status from reservations where id = {{hs}}))`),
      Q('ledger', `select pg_temp.ledger()`),
    ]);
  });

  it('plays the booked match and leaves the unrelated stale hold to its own sweep', () => {
    expect(data(r, 'sweep')).toEqual({ ...ZERO, venues_swept: 1, venues_skipped: 0, played: 1 });
    expect(data(r, 'after')).toEqual({ bk: 'played', hs: 'pending' });
    expect(data(r, 'ledger')).toEqual([]);
  });
});

// ── 4. Phase 3, chain-wide ───────────────────────────────────────────────────

describe.skipIf(!docker)('match_sweep: a chain-wide run refunds (DF-20) and purges old reports (R36) (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m262p', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      GUEST('o1'), GUEST('p1'), GUEST('gone'), GUEST('gone2'),
      // gone: one purchase of two tickets, one of them on a filling seat.
      `select pg_temp.purchase('pz', 'gone', 2);`,
      `select pg_temp.three('fz', ${at(3)}, 'o1', 'p1');`,
      K('tz', `select id from match_tickets where purchase_payment_id = {{pz}} order by id limit 1`),
      K('sz', `insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd)
               values ({{v}}, {{fz}}, 4, 'account', {{gone}}, {{tz}}, 10000) returning id`),
      X(`update match_tickets set status = 'in_use', seat_id = {{sz}} where id = {{tz}}`),
      X(`insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id)
         values ({{tz}}, {{gone}}, 'locked', {{v}}, {{fz}}, {{sz}})`),
      // gone2: one purchase, unused.
      `select pg_temp.purchase('pz2', 'gone2', 1);`,
      X(`update profiles set deleted_at = now() where id in ({{gone}}, {{gone2}})`),
      // Two reports: one 13 months old, one from yesterday.
      K('old_report', `insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, reason, created_at)
                       values ({{v}}, {{fz}}, {{o1}}, {{p1}}, pg_temp.s('fz', 3), 'other', now() - interval '13 months')
                       returning id`),
      K('new_report', `insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, reason, created_at)
                       values ({{v}}, {{fz}}, {{p1}}, {{o1}}, pg_temp.s('fz', 1), 'other', now() - interval '1 day')
                       returning id`),
      Q('blocked_before', `select to_jsonb(app.ticket_cashout_block({{pz}}) is not null)`),
      Q('chain', SWEEP('')),
      Q('after', `select jsonb_build_object(
          'fz_gone_seat', (select status || '/' || end_reason from match_seats where id = {{sz}}),
          'pz', (select status || '/' || refund_reason || '/' || refund_amount_iqd from booking_payments where id = {{pz}}),
          'pz2', (select status || '/' || refund_reason || '/' || refund_amount_iqd from booking_payments where id = {{pz2}}),
          'gone', pg_temp.wallet('gone'), 'gone2', pg_temp.wallet('gone2'),
          'old_report', (select count(*) from match_reports where id = {{old_report}}),
          'new_report', (select count(*) from match_reports where id = {{new_report}}))`),
      Q('ledger', `select pg_temp.ledger()`),
    ]);
  });

  it('the seat is left in Phase 2, then the purchase refunds in Phase 3 of the same run; the old report goes', () => {
    // Held by the filling seat, the purchase cannot be refunded yet (R13).
    expect(data(r, 'blocked_before')).toBe(true);
    const chain = data<Json>(r, 'chain');
    expect(chain.refunds_started as number).toBeGreaterThanOrEqual(2);
    expect(chain.reports_purged as number).toBeGreaterThanOrEqual(1);
    expect(chain.left_deleted as number).toBeGreaterThanOrEqual(1);
    expect(data(r, 'after')).toEqual({
      fz_gone_seat: 'left/account_deleted',
      pz: 'refund_pending/account_deleted/20000',
      pz2: 'refund_pending/account_deleted/10000',
      gone: { cashed_out: 2 },
      gone2: { cashed_out: 1 },
      old_report: 0,
      new_report: 1,
    });
    expect(data(r, 'ledger')).toEqual([]);
  });
});

// ── 5. The schedule and the walls ────────────────────────────────────────────

describe.skipIf(!docker)('tp_match_sweep and who may call what', () => {
  it('the cron job runs the sweep every 30 seconds (every minute where pg_cron predates the seconds syntax)', () => {
    const job = psql(`select schedule || ' | ' || command from cron.job where jobname = 'tp_match_sweep';`);
    expect(['30 seconds | select app.match_sweep();', '* * * * * | select app.match_sweep();']).toContain(job);
  });

  it('the sweep is the service role\'s; the trigger and match_court_claimed nobody\'s; the re-issues keep their grants', () => {
    const can = (role: string, fn: string) => psql(`select has_function_privilege('${role}', '${fn}', 'execute');`);
    for (const role of ['anon', 'authenticated']) {
      expect(can(role, 'app.match_sweep(uuid)'), role).toBe('f');
      expect(can(role, 'app.trg_reservation_match()'), role).toBe('f');
      expect(can(role, 'app.match_court_claimed(uuid, tstzrange)'), role).toBe('f');
    }
    expect(can('service_role', 'app.match_sweep(uuid)')).toBe('t');
    expect(can('authenticated', 'app.hold_slot(uuid, timestamptz, int, text, text, text)')).toBe('t');
    expect(can('anon', 'app.hold_slot(uuid, timestamptz, int, text, text, text)')).toBe('f');
    expect(can('authenticated', 'app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint, int)')).toBe('t');
  });
});

// ── 6. A busy branch, two sessions ───────────────────────────────────────────

describe.skipIf(!docker)('match_sweep: a busy branch is skipped unless it is the run\'s first (two sessions)', () => {
  it('skips it without waiting, or, first in the rotation, waits for it and sweeps it', async () => {
    const busy = crypto.randomUUID();
    const court = crypto.randomUUID();
    // Another session holds the busy branch's mutex for eight seconds (the setup below must not outlast it).
    const holder = psqlSession(`set application_name = 'm263-sweep-busy';
begin;
select pg_advisory_xact_lock(hashtextextended('app.matches:venue:${busy}', 0));
select pg_sleep(8);
rollback;`);
    await waitForSleeper('m263-sweep-busy');
    const r = scenario('m262k', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      X(`insert into venues (id, slug, name_en, name_ar, timezone, is_active)
         values ('${busy}', 'm262-busy-${busy.slice(0, 8)}', 'M262 busy', 'فرع مشغول', 'Asia/Baghdad', true)`),
      X(`insert into venue_settings (venue_id, venue_name, opening_hours, matches_enabled)
         select '${busy}', 'M262 busy', jsonb_object_agg(d, '[["00:00","24:00"]]'::jsonb), true
           from unnest(array['mon','tue','wed','thu','fri','sat','sun']) d`),
      X(`insert into courts (id, venue_id, name_en, name_ar, duration_options, sort_order, is_active)
         values ('${court}', '${busy}', 'M262 busy 1', 'ملعب ١', '{60,90,120}', 1, true)`),
      GUEST('o1'), GUEST('p1'),
      // One match past its deadline at each branch.
      `select pg_temp.three('free', now() + interval '3 hours', 'o1', 'p1',
                            jsonb_build_object('fill_deadline_at', now() - interval '5 minutes'));`,
      `select pg_temp.three('held', now() + interval '6 hours', 'o1', 'p1',
                            jsonb_build_object('fill_deadline_at', now() - interval '5 minutes', 'venue_id', '${busy}',
                                               'price_court_id', '${court}', 'rate_rule_id', null));`,
      Q('t0', `select to_jsonb(extract(epoch from clock_timestamp()))`),
      Q('sweep', SWEEP('')),
      Q('t1', `select to_jsonb(extract(epoch from clock_timestamp()))`),
      Q('after', `select jsonb_build_object('free', pg_temp.status('free'), 'held', pg_temp.status('held'))`),
      Q('ledger', `select pg_temp.ledger()`),
    ]);
    await holder;
    const waited = (Number(data(r, 't1')) - Number(data(r, 't0'))) * 1000;
    const sweep = data<Json>(r, 'sweep');
    const after = data<Json>(r, 'after');
    expect(after.free).toBe('expired:deadline');
    if (after.held === 'filling') {
      // A later branch in the rotation: try-locked, skipped, never waited on.
      expect(sweep.venues_skipped as number).toBeGreaterThanOrEqual(1);
      expect(waited).toBeLessThan(2_500);
    } else {
      // The rotation put it first: the first branch blocks, then is swept.
      expect(after.held).toBe('expired:deadline');
      expect(waited).toBeGreaterThanOrEqual(1_500);
    }
    expect(data(r, 'ledger')).toEqual([]);
  }, 30_000);
});
