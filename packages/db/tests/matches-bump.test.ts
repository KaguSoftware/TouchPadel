/**
 * 0263 match_reservation_triggers, part B: a firm row bumps the filling and
 * waiting matches it leaves with no firm-free court (docs/design/open-matches/
 * db.md §3.1, §4.8.1, §4.8.2, §6 situations 3–11 and 30–31; build contracts
 * OM-13, DF-18, R22, C14).
 *
 * One rolled-back scenario at a branch made inside it (two courts, both
 * offering 60/90/120), the matches planted with three seats on tickets (the
 * fourth, where it matters, joined through match_join so match_try_book runs):
 *   * two courts: a booking on court 1 leaves court 2 firm-free, nothing
 *     happens; a booking on court 2 bumps the match, its tickets and its
 *     pending request's tickets come back;
 *   * holds never bump; a hold the guest confirms is firm and does;
 *   * awaiting_court (DF-18): the fourth seat finds only a hold in the way;
 *     R22 refuses a fresh hold and a desk create of every kind on the court
 *     the match waits for (SLOT_TAKEN detail match_waiting), not a hold at
 *     another time; the sweep books the court once the hold is stale; a hold
 *     that confirms instead bumps the waiting match;
 *   * an event block (maintenance rows on every court, one statement, no
 *     court lock), a series (create_series through staff_create_reservation)
 *     and a desk move into the period each bump;
 *   * two filling matches and one firm-free court: neither is bumped until
 *     one books; then the other is;
 *   * the deposit paths: a hold its deposit confirms, and a swept hold its
 *     late deposit re-creates (a firm row written by a Money body), bump;
 * pg_temp.ledger() (the ticket ledger rules a rolled-back scenario can check)
 * after every ticket move.
 *
 * Then, committed and over two connections: two tills book the last two
 * courts at the same moment. The first trigger to hold the mutex cannot see
 * the other's uncommitted row, the second is deferred (try-lock), so the
 * match is bumped exactly once, by a trigger or by the next sweep, never
 * twice (§6 situation 7).
 */
import { describe, expect, it } from 'vitest';
import { MATCH_MONEY_CHECK, SEED_STAFF_IDS, stackAvailable } from './helpers';
import { Q, T, X, dockerReachable, psql, psqlSession, scenario, type Results } from './stores-harness';
import { E, GUEST, K, MONEY, SETUP, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** This suite's planting helpers, on top of matches-harness's SETUP. */
const MORE = String.raw`
-- A filling match planted at p_when with three seats in: the organiser p_org
-- (an account seat and a friend seat) and p_other, each on a fresh ticket of
-- its holder. p overrides the match (pg_temp.m).
create function pg_temp.three(p_name text, p_when timestamptz, p_org text, p_other text, p jsonb default '{}')
returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.m(jsonb_build_object('start_at', p_when, 'organiser_id', pg_temp.var(p_org)) || p);
  perform pg_temp.seat(v, 1, 'account', pg_temp.var(p_org)::uuid);
  perform pg_temp.seat(v, 2, 'friend', pg_temp.var(p_org)::uuid);
  perform pg_temp.seat(v, 3, 'account', pg_temp.var(p_other)::uuid);
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;
` + MATCH_MONEY_CHECK;

const JOIN = (m: string) => `select app.match_join({{${m}}}, '[]'::jsonb, null)`;
const STATUS = (m: string) => `select to_jsonb(status || coalesce(':' || ended_reason, '')) from matches where id = {{${m}}}`;
const HOLD = (court: string, when: string, dur = 90) => `select app.hold_slot({{${court}}}, ${when}, ${dur}, null, null, null)`;
const WALLETS = (...names: string[]) =>
  `select jsonb_build_object(${names.map((n) => `'${n}', pg_temp.wallet('${n}')`).join(', ')})`;
/** A match's seats as "no:status/ticket". */
const SEATS = (m: string) =>
  `select jsonb_agg(s.seat_no || ':' || s.status || '/' || coalesce(k.status, '-') order by s.seat_no, s.joined_at)
     from match_seats s left join match_tickets k on k.id = s.ticket_id where s.match_id = {{${m}}}`;

describe.skipIf(!docker)('the bump half of the reservation trigger, and R22 (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m262b', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      X(`insert into staff_venues (staff_id, venue_id, role) values ({{desk}}, {{v}}, 'court_desk')`),
      GUEST('o1'), GUEST('o2'), GUEST('p1'), GUEST('p2'), GUEST('asker'),
      GUEST('h1'), GUEST('h2'), GUEST('j1'), GUEST('j2'), GUEST('j3'),
      `select pg_temp.tickets('asker', 2);`,
      `select pg_temp.tickets('j1', 1);`,
      `select pg_temp.tickets('j2', 1);`,
      `select pg_temp.tickets('j3', 1);`,

      // 1. Two courts. MA asks for approval, so a pending request is in play.
      `select pg_temp.three('ma', ${at(3)}, 'o1', 'p1', '{"join_policy":"approve"}');`,
      E('request_ma', 'asker', `select app.match_request({{ma}}, '[]'::jsonb, null)`),
      Q('wallet_asker_req', `select pg_temp.wallet('asker')`),
      X(`select pg_temp.res('c1', ${at(3)}, 90)`),
      Q('ma_court1', STATUS('ma')),
      X(`select pg_temp.res('c2', ${at(3)}, 90)`),
      Q('ma_bumped', `select pg_temp.state('ma')`),
      Q('ma_seats', SEATS('ma')),
      Q('wallets_ma', WALLETS('o1', 'p1', 'asker')),
      Q('ledger_ma', `select pg_temp.ledger()`),

      // 2. Holds never bump; a hold the guest confirms is firm.
      `select pg_temp.three('mb', ${at(4)}, 'o1', 'p1');`,
      K('hb1', `select pg_temp.res('c1', ${at(4)}, 90, 'hold', 'pending', 'h1')`),
      K('hb2', `select pg_temp.res('c2', ${at(4)}, 90, 'hold', 'pending', 'h2')`),
      Q('mb_held', STATUS('mb')),
      E('confirm_hb2', 'h2', `select app.confirm_booking({{hb2}})`),
      Q('mb_one_firm', STATUS('mb')),
      E('confirm_hb1', 'h1', `select app.confirm_booking({{hb1}})`),
      Q('mb_bumped', `select pg_temp.state('mb')`),
      Q('ledger_mb', `select pg_temp.ledger()`),

      // 3. awaiting_court (DF-18), R22, then booked by the sweep.
      `select pg_temp.three('mc', ${at(5)}, 'o1', 'p1');`,
      X(`select pg_temp.res('c1', ${at(5)}, 90)`),
      K('hc', `select pg_temp.res('c2', ${at(5)}, 90, 'hold', 'pending', 'h1')`),
      E('join_mc', 'j1', JOIN('mc')),
      Q('mc_waiting', `select pg_temp.state('mc')`),
      Q('ledger_mc_waiting', `select pg_temp.ledger()`),
      // The hold goes stale: each writer's own lazy expiry now leaves the
      // court with no live row, and the waiting match claims it.
      X(`update reservations set hold_expires_at = now() - interval '1 minute' where id = {{hc}}`),
      E('hold_claimed', 'h2', HOLD('c2', at(5))),
      T('desk_claimed', 'desk', `select app.staff_create_reservation({{c2}}, 'booking', ${at(5)}, ${at(5)} + interval '90 minutes', 'M262 walk-in')`),
      T('desk_block_claimed', 'desk', `select app.staff_create_reservation({{c2}}, 'maintenance', ${at(5)}, ${at(5)} + interval '90 minutes', 'M262 repairs')`),
      E('hold_later', 'h2', HOLD('c2', at(5, 4), 60)),
      Q('hc_still_pending', `select to_jsonb(status) from reservations where id = {{hc}}`),
      Q('sweep_c', `select app.match_sweep({{v}})`),
      Q('mc_booked', `select pg_temp.state('mc')`),
      Q('mc_booking', `select jsonb_build_object('court_is_c2', r.court_id = {{c2}}, 'guest_name', r.guest_name,
                                                 'guest_id', r.guest_id, 'status', r.status)
                         from matches m join reservations r on r.id = m.reservation_id where m.id = {{mc}}`),
      Q('hc_expired', `select to_jsonb(status) from reservations where id = {{hc}}`),
      Q('ledger_mc', `select pg_temp.ledger()`),

      // 4. Waiting, and the hold confirms instead: bumped (R22's other end).
      `select pg_temp.three('md', ${at(6)}, 'o1', 'p1');`,
      X(`select pg_temp.res('c1', ${at(6)}, 90)`),
      K('hd', `select pg_temp.res('c2', ${at(6)}, 90, 'hold', 'pending', 'h1')`),
      E('join_md', 'j2', JOIN('md')),
      Q('md_waiting', STATUS('md')),
      E('confirm_hd', 'h1', `select app.confirm_booking({{hd}})`),
      Q('md_bumped', `select pg_temp.state('md')`),
      Q('wallets_md', WALLETS('j2')),
      Q('ledger_md', `select pg_temp.ledger()`),

      // 5. An event block: maintenance on every court in one statement, no
      //    court lock (0174's shape).
      `select pg_temp.three('me', ${at(7)}, 'o1', 'p1');`,
      X(`insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source, block_purpose)
         select {{v}}, c.id, 'maintenance', 'confirmed', ${at(7)}, ${at(7)} + interval '90 minutes', 'M262 event', 'desk', 'event'
           from courts c where c.venue_id = {{v}} order by c.id`),
      Q('me_bumped', STATUS('me')),
      Q('me_events', `select jsonb_agg(e.type || ':' || e.code || ':' || e.actor order by e.id) from match_events e where e.match_id = {{me}}`),

      // 6. A series: one weekly occurrence on court 2, through
      //    staff_create_reservation.
      `select pg_temp.three('mf', ${at(8)}, 'o1', 'p1');`,
      X(`select pg_temp.res('c1', ${at(8)}, 90)`),
      T('series', 'desk', `select app.create_series({{c2}}, 'weekly', null, (${at(8)} at time zone 'Asia/Baghdad')::time, 90,
                                                   (${at(8)} at time zone 'Asia/Baghdad')::date,
                                                   (${at(8)} at time zone 'Asia/Baghdad')::date, null, 'M262 series')`),
      Q('mf_bumped', STATUS('mf')),

      // 7. A desk move of another booking into the period.
      `select pg_temp.three('mg', ${at(9)}, 'o1', 'p1');`,
      X(`select pg_temp.res('c1', ${at(9)}, 90)`),
      K('rg', `select pg_temp.res('c2', ${at(9, 4)}, 90)`),
      Q('mg_before', STATUS('mg')),
      T('move', 'desk', `select app.move_reservation({{rg}}, null, ${at(9)}, ${at(9)} + interval '90 minutes', 'M262 move')`),
      Q('mg_bumped', STATUS('mg')),

      // 8. Two filling matches, one firm-free court.
      `select pg_temp.three('mh1', ${at(10)}, 'o1', 'p1');`,
      `select pg_temp.three('mh2', ${at(10)}, 'o2', 'p2');`,
      X(`select pg_temp.res('c1', ${at(10)}, 90)`),
      Q('mh_before', `select jsonb_build_object('mh1', (select status from matches where id = {{mh1}}),
                                                'mh2', (select status from matches where id = {{mh2}}))`),
      E('join_mh1', 'j3', JOIN('mh1')),
      Q('mh_after', `select jsonb_build_object('mh1', (select status from matches where id = {{mh1}}),
                                               'mh2', (select status || ':' || ended_reason from matches where id = {{mh2}}),
                                               'mh1_court_is_c2', (select r.court_id = {{c2}} from matches m
                                                                     join reservations r on r.id = m.reservation_id
                                                                    where m.id = {{mh1}}))`),
      Q('mh2_seats', SEATS('mh2')),

      // 9. The deposit paths (0258's deposit_settle_success, as a SUCCESS
      //    reaches it through deposit_apply): a hold its deposit confirms,
      //    and a swept hold its late deposit re-creates as a booking.
      `select pg_temp.three('mi', ${at(11)}, 'o1', 'p1');`,
      X(`select pg_temp.res('c1', ${at(11)}, 90)`),
      K('hi', `select pg_temp.res('c2', ${at(11)}, 90, 'hold', 'pending', 'h1')`),
      K('pi', `insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox,
                                             request_id, amount_iqd, quoted_price_iqd, status, deadline_at)
               values ({{v}}, {{hi}}, {{hi}}, {{h1}}, 'deposit', 'fake', false, gen_random_uuid(), 10000, 48000,
                       'pending', now() + interval '15 minutes') returning id`),
      Q('mi_before', STATUS('mi')),
      Q('settle_hi', `select to_jsonb(app.deposit_settle_success({{pi}}))`),
      Q('mi_bumped', STATUS('mi')),
      `select pg_temp.three('mj', ${at(12)}, 'o1', 'p1');`,
      X(`select pg_temp.res('c1', ${at(12)}, 90)`),
      K('hj', `select pg_temp.res('c2', ${at(12)}, 90, 'hold', 'pending', 'h2')`),
      X(`update reservations set status = 'expired' where id = {{hj}}`),
      K('pj', `insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox,
                                             request_id, amount_iqd, quoted_price_iqd, status, deadline_at)
               values ({{v}}, {{hj}}, {{hj}}, {{h2}}, 'deposit', 'fake', false, gen_random_uuid(), 10000, 48000,
                       'pending', now() + interval '15 minutes') returning id`),
      Q('mj_before', STATUS('mj')),
      Q('settle_hj', `select to_jsonb(app.deposit_settle_success({{pj}}))`),
      Q('mj_bumped', `select jsonb_build_object('match', (${STATUS('mj')}),
                                                'booking', (select r.kind || ':' || r.status || ':' || (r.id <> {{hj}})
                                                              from booking_payments p join reservations r on r.id = p.reservation_id
                                                             where p.id = {{pj}}))`),
      Q('ledger_end', `select pg_temp.ledger()`),
      MONEY('money_b'),
    ]);
  });

  it('the court-money invariants hold for every booked match (money.md §9)', () => {
    expect(data(r, 'money_b')).toEqual({});
  });

  it('two courts: court 1 booked leaves the match filling; court 2 booked bumps it, tickets and the request back', () => {
    expect(data<Json>(r, 'request_ma')).toMatchObject({ status: 'pending', tickets_reserved: 1 });
    expect(data(r, 'wallet_asker_req')).toEqual({ reserved: 1, available: 1 });
    expect(data(r, 'ma_court1')).toBe('filling');
    expect(data<Json>(r, 'ma_bumped')).toMatchObject({
      match: { status: 'bumped', ended_reason: 'bumped', reservation_id: null },
      requests: [{ status: 'expired' }],
      events: ['requested', 'request_expired:bumped', 'bumped:bumped'],
    });
    expect(data(r, 'ma_seats')).toEqual(['1:cancelled/available', '2:cancelled/available', '3:cancelled/available']);
    expect(data(r, 'wallets_ma')).toEqual({ o1: { available: 2 }, p1: { available: 1 }, asker: { available: 2 } });
    expect(data(r, 'ledger_ma')).toEqual([]);
  });

  it('holds never bump (OM-13); the confirm that leaves no firm-free court does', () => {
    expect(data(r, 'mb_held')).toBe('filling');
    expect(data<Json>(r, 'confirm_hb2')).toMatchObject({ duplicate: false });
    // Court 1 still only held: one firm-free court left.
    expect(data(r, 'mb_one_firm')).toBe('filling');
    expect(data<Json>(r, 'confirm_hb1')).toMatchObject({ duplicate: false });
    expect(data<Json>(r, 'mb_bumped')).toMatchObject({
      match: { status: 'bumped', ended_reason: 'bumped' },
      seats: [{ status: 'cancelled', ticket: 'available' }, { status: 'cancelled', ticket: 'available' },
              { status: 'cancelled', ticket: 'available' }],
      events: ['bumped:bumped'],
    });
    expect(data(r, 'ledger_mb')).toEqual([]);
  });

  it('awaiting_court: R22 keeps the court from a fresh hold and from every desk create, then the sweep books it', () => {
    expect(data<Json>(r, 'join_mc')).toMatchObject({ match_status: 'awaiting_court' });
    expect(data<Json>(r, 'mc_waiting')).toMatchObject({
      match: { status: 'awaiting_court', reservation_id: null },
      events: ['joined', 'awaiting_court'],
    });
    expect(data(r, 'ledger_mc_waiting')).toEqual([]);
    for (const label of ['hold_claimed', 'desk_claimed', 'desk_block_claimed']) {
      expect(failed(r, label), label).toMatchObject({ code: 'SLOT_TAKEN', detail: 'match_waiting' });
    }
    // Another time on the same court is free to hold.
    expect(data<Json>(r, 'hold_later')).toMatchObject({ duplicate: false });
    // A refused call rolls its own lazy expiry back.
    expect(data(r, 'hc_still_pending')).toBe('pending');

    expect(data<Json>(r, 'sweep_c')).toMatchObject({
      venues_swept: 1, venues_skipped: 0, booked: 1, bumped: 0, awaiting_expired: 0, errors: 0,
    });
    expect(data<Json>(r, 'mc_booked')).toMatchObject({
      match: { status: 'booked' },
      seats: [{ status: 'in', ticket: 'in_use' }, { status: 'in', ticket: 'in_use' }, { status: 'in', ticket: 'in_use' },
              { status: 'in', ticket: 'in_use', guest: 'j1' }],
      events: ['joined', 'awaiting_court', 'booked'],
    });
    expect(data(r, 'mc_booking')).toEqual({ court_is_c2: true, guest_name: 'Open match', guest_id: null, status: 'confirmed' });
    expect(data(r, 'hc_expired')).toBe('expired');
    expect(data(r, 'ledger_mc')).toEqual([]);
  });

  it('awaiting_court, and the blocking hold confirms: bumped, all four tickets back', () => {
    expect(data(r, 'md_waiting')).toBe('awaiting_court');
    expect(data<Json>(r, 'confirm_hd')).toMatchObject({ duplicate: false });
    expect(data<Json>(r, 'md_bumped')).toMatchObject({
      match: { status: 'bumped', ended_reason: 'bumped' },
      events: ['joined', 'awaiting_court', 'bumped:bumped'],
    });
    expect((data<Json>(r, 'md_bumped').seats as Json[]).map((s) => `${s.status}/${s.ticket}`)).toEqual([
      'cancelled/available', 'cancelled/available', 'cancelled/available', 'cancelled/available',
    ]);
    expect(data(r, 'wallets_md')).toEqual({ j2: { available: 1 } });
    expect(data(r, 'ledger_md')).toEqual([]);
  });

  it('an event block, a series and a move into the period each bump the match, once', () => {
    expect(data(r, 'me_bumped')).toBe('bumped:bumped');
    expect(data(r, 'me_events')).toEqual(['bumped:bumped:system']);
    expect(data<Json>(r, 'series')).toMatchObject({ duplicate: false });
    expect((data<Json>(r, 'series').created as string[]).length).toBe(1);
    expect(data(r, 'mf_bumped')).toBe('bumped:bumped');
    expect(data(r, 'mg_before')).toBe('filling');
    // Priced for the first time on the move (the planted row had no price).
    expect(data<Json>(r, 'move')).toMatchObject({ price_iqd: 48000 });
    expect(data(r, 'mg_bumped')).toBe('bumped:bumped');
  });

  it('two filling matches, one firm-free court: the first to fill books it and the other is bumped', () => {
    expect(data(r, 'mh_before')).toEqual({ mh1: 'filling', mh2: 'filling' });
    expect(data<Json>(r, 'join_mh1')).toMatchObject({ match_status: 'booked' });
    expect(data(r, 'mh_after')).toEqual({ mh1: 'booked', mh2: 'bumped:bumped', mh1_court_is_c2: true });
    expect(data(r, 'mh2_seats')).toEqual(['1:cancelled/available', '2:cancelled/available', '3:cancelled/available']);
  });

  it('the deposit paths: a hold its deposit confirms, and a swept hold re-created, each bump the match', () => {
    expect(data(r, 'mi_before')).toBe('filling');
    expect(data(r, 'settle_hi')).toBe('succeeded');
    expect(data(r, 'mi_bumped')).toBe('bumped:bumped');
    expect(data(r, 'mj_before')).toBe('filling');
    expect(data(r, 'settle_hj')).toBe('succeeded');
    expect(data(r, 'mj_bumped')).toEqual({ match: 'bumped:bumped', booking: 'booking:confirmed:true' });
    expect(data(r, 'ledger_end')).toEqual([]);
  });
});

// ── two tills, two connections, committed ────────────────────────────────────

describe.skipIf(!docker)('two tills book the last two courts at the same moment (committed, two connections)', () => {
  it('the match is bumped exactly once, by a trigger or by the next sweep', async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const venue = crypto.randomUUID();
    const courts = [crypto.randomUUID(), crypto.randomUUID()];
    const match = crypto.randomUUID();
    const token = crypto.randomUUID().replaceAll('-', '').slice(0, 22);
    // One start for every session: the next whole hour, six days out.
    const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 6 * 86_400_000);
    const atMin = (min: number) => `'${new Date(start.getTime() + min * 60_000).toISOString()}'::timestamptz`;
    const desk = SEED_STAFF_IDS.court_desk;

    // A branch of its own, two courts, one filling desk match (a walk-in seat,
    // no ticket). Nothing overlaps it yet.
    psql(`begin;
select set_config('request.jwt.claims', '', true);
insert into venues (id, slug, name_en, name_ar, timezone, is_active)
values ('${venue}', 'm262-race-${tag}', 'M262 race', 'سباق ٢٦٢', 'Asia/Baghdad', true);
insert into venue_settings (venue_id, venue_name, opening_hours, matches_enabled)
select '${venue}', 'M262 race', jsonb_object_agg(d, '[["00:00","24:00"]]'::jsonb), true
  from unnest(array['mon','tue','wed','thu','fri','sat','sun']) d;
insert into courts (id, venue_id, name_en, name_ar, duration_options, sort_order, is_active)
values ('${courts[0]}', '${venue}', 'M262 race 1', 'ملعب ١', '{60,90,120}', 1, true),
       ('${courts[1]}', '${venue}', 'M262 race 2', 'ملعب ٢', '{60,90,120}', 2, true);
insert into matches (id, venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                     price_iqd, shares_iqd, price_court_id, fill_deadline_at, share_token, organised_by,
                     created_by_staff_id)
values ('${match}', '${venue}', 'filling', ${atMin(0)}, ${atMin(90)}, 90, 'public', 'open', 'open', 40000,
        '{10000,10000,10000,10000}', '${courts[0]}', ${atMin(-120)}, '${token}', 'desk', '${desk}');
insert into match_seats (venue_id, match_id, seat_no, kind, guest_name, share_iqd, created_by_staff_id)
values ('${venue}', '${match}', 1, 'desk', 'M262 walk-in', 10000, '${desk}');
commit;`);

    const state = () =>
      psql(`select m.status || ':' || (select count(*) from match_events e where e.match_id = m.id and e.type = 'bumped')
              from matches m where m.id = '${match}';`);
    try {
      // Each till: its row, then two seconds before the commit, so both
      // triggers run while the other's row is still uncommitted.
      const till = (court: string) =>
        psqlSession(`begin;
select set_config('request.jwt.claims', '', true);
insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source)
values ('${venue}', '${court}', 'booking', 'confirmed', ${atMin(0)}, ${atMin(90)}, 'M262 till', 'desk');
select pg_sleep(2);
commit;`);
      await Promise.all([till(courts[0]!), till(courts[1]!)]);

      // The first trigger to try the mutex saw no other booking; the second
      // could not take it. Unless the cron's sweep was quicker, the match is
      // still filling here, with no bump written twice either way.
      expect(['filling:0', 'bumped:1']).toContain(state());
      psql(`select app.match_sweep('${venue}');`);
      expect(state()).toBe('bumped:1');
      psql(`select app.match_sweep('${venue}');`);
      expect(state()).toBe('bumped:1');
      expect(psql(`select status || '/' || end_reason from match_seats where match_id = '${match}';`)).toBe('cancelled/match_ended');
    } finally {
      // Leave nothing live behind: the rows off the courts, the courts and the
      // branch inactive, matches off again (match-settings reads every
      // branch), so no later suite picks them up.
      psql(`begin;
select set_config('request.jwt.claims', '', true);
update reservations set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'M262 cleanup'
 where venue_id = '${venue}' and status in ('pending', 'confirmed', 'arrived');
update courts set is_active = false where venue_id = '${venue}';
update venue_settings set matches_enabled = false where venue_id = '${venue}';
update venues set is_active = false where id = '${venue}';
commit;`);
    }
  }, 30_000);
});
