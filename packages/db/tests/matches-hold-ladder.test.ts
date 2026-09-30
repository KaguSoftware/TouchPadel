/**
 * The hold ladder (0252) and open matches (0253–0264) together, after the
 * 2026-09-29 sync (docs/design/open-matches/CONTINUE.md, "Parallel run").
 *
 * 0263 re-issues app.hold_slot from 0252's body with the R22 check, and 0260's
 * app.match_expire_holds (the branch twin of expire_stale_holds, run when a
 * match books: match_lock, match_try_book, the sweep's first branch) expires
 * holds the way expire_stale_holds does with arguments: it never settles a
 * strike. Neither does the lazy expiry of hold_slot or staff_create_reservation.
 * A lapse is settled later, dated by the hold, by whichever comes first: the
 * guest's own next hold_slot, or tp_hold_sweep (expire_stale_holds() with no
 * arguments). This suite proves it.
 *
 * One rolled-back scenario at a branch made inside it (two courts), the ladder
 * line moved an hour back:
 *   * a verified phone's standing outlives the account: two strikes, then
 *     delete_my_account (0264), and a new account verified on the same number
 *     is still waiting (HOLD_COOLDOWN);
 *   * four matches waiting for court 2 (DF-18), each held off it by a hold
 *     taken through hold_slot: one lapses, one lapses and its guest comes back
 *     before the hold sweep, one is released after 90 seconds (release_hold
 *     writes its strike), one lapses after a failed deposit attempt;
 *   * at the claimed court, the ladder refuses before R22 (HOLD_COOLDOWN),
 *     and R22's refusal (SLOT_TAKEN match_waiting) rolls the caller's own
 *     settle back with it, as every 0252 refusal does;
 *   * the match sweep books all four and writes no ledger row; the guest who
 *     comes back is warned; the hold sweep then settles the rest exactly as it
 *     settles a hold expire_stale_holds expired lazily (the control): counted,
 *     dated at the lapse, on the guest's key; the deposit attempt uncounted.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { Q, RES, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, K, SETUP, at, data, failed } from './matches-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const MORE = String.raw`
-- A filling match planted at p_when with three seats in (the organiser's
-- account and friend seats, and p_other's), each on a fresh ticket.
create function pg_temp.three(p_name text, p_when timestamptz, p_org text, p_other text)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.m(jsonb_build_object('start_at', p_when, 'organiser_id', pg_temp.var(p_org)));
  perform pg_temp.seat(v, 1, 'account', pg_temp.var(p_org)::uuid);
  perform pg_temp.seat(v, 2, 'friend', pg_temp.var(p_org)::uuid);
  perform pg_temp.seat(v, 3, 'account', pg_temp.var(p_other)::uuid);
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- The account's phone becomes verified: the ladder's identity (0252).
create function pg_temp.verify(p_name text, p_phone text) returns void language sql as $f$
  update auth.users set phone = p_phone, phone_confirmed_at = now() where id = pg_temp.var(p_name)::uuid
$f$;

-- The hold ran out a minute ago.
create function pg_temp.lapse(p_hold text) returns void language sql as $f$
  update reservations set hold_expires_at = now() - interval '1 minute' where id = pg_temp.var(p_hold)::uuid
$f$;

-- A hold's ledger row: counted, dated at its lapse, on its guest's key (null
-- when the ladder has not judged it yet).
create function pg_temp.strike(p_hold text) returns jsonb language sql as $f$
  select coalesce((select jsonb_build_object('counted', s.counted,
                                             'at_lapse', s.struck_at = r.hold_expires_at,
                                             'key', s.standing_key = app.hold_standing_key(r.guest_id))
                     from hold_strikes s join reservations r on r.id = s.reservation_id
                    where s.reservation_id = pg_temp.var(p_hold)::uuid), 'null'::jsonb)
$f$;

-- A guest's standing: strikes, and whether a wait is running (null: none).
create function pg_temp.standing(p_name text) returns jsonb language sql as $f$
  select coalesce((select jsonb_build_object('strikes', s.strikes, 'waiting', coalesce(s.blocked_until > now(), false))
                     from hold_standing s where s.key = app.hold_standing_key(pg_temp.var(p_name)::uuid)),
                  'null'::jsonb)
$f$;
`;

const HOLD = (court: string, when: string, dur = 90) => `select app.hold_slot({{${court}}}, ${when}, ${dur}, null, null, null)`;
const JOIN = (m: string) => `select app.match_join({{${m}}}, '[]'::jsonb, null)`;
const STATUSES = (...names: string[]) =>
  `select jsonb_build_object(${names.map((n) => `'${n}', (select status from matches where id = {{${n}}})`).join(', ')})`;
const HOLDS = (...names: string[]) =>
  `select jsonb_build_object(${names.map((n) => `'${n}', (select status from reservations where id = {{${n}}})`).join(', ')})`;
const STRIKES = (...holds: string[]) =>
  `select jsonb_build_object(${holds.map((h) => `'${h}', pg_temp.strike('${h}')`).join(', ')})`;
const STANDINGS = (...guests: string[]) =>
  `select jsonb_build_object(${guests.map((g) => `'${g}', pg_temp.standing('${g}')`).join(', ')})`;

/** A waiting match at `when`: court 1 booked, court 2 held by `holder` through hold_slot, `joiner` the fourth. */
const WAITING = (m: string, when: string, holder: string, hold: string, joiner: string) => [
  `select pg_temp.three('${m}', ${when}, 'o1', 'p1');`,
  X(`select pg_temp.res('c1', ${when}, 90)`),
  E(`hold_${m}`, holder, HOLD('c2', when)),
  RES(hold, `hold_${m}`, 'reservation_id'),
  E(`join_${m}`, joiner, JOIN(m)),
];

describe.skipIf(!docker)('the hold ladder and open matches (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('m263h', [
      SETUP,
      MORE,
      `select pg_temp.branch();`,
      // Every hold here is younger than the line.
      X(`update platform_settings set hold_strikes_since = now() - interval '1 hour' where id`),
      GUEST('o1'), GUEST('p1'), GUEST('j1'), GUEST('j2'), GUEST('j3'), GUEST('j4'),
      GUEST('hl'), GUEST('hb'), GUEST('hr'), GUEST('hd'), GUEST('hc'), GUEST('hw'), GUEST('ph'),
      `select pg_temp.tickets('j1', 1);`,
      `select pg_temp.tickets('j2', 1);`,
      `select pg_temp.tickets('j3', 1);`,
      `select pg_temp.tickets('j4', 1);`,

      // 1. A verified phone's standing outlives the account (0252 with 0264).
      K('phone', `select '9647' || lpad(floor(random() * 1e9)::bigint::text, 9, '0')`),
      X(`select pg_temp.verify('ph', {{phone}})`),
      E('ph_hold1', 'ph', HOLD('c1', at(2))),
      RES('ph1', 'ph_hold1', 'reservation_id'),
      X(`select pg_temp.lapse('ph1')`),
      E('ph_hold2', 'ph', HOLD('c1', at(2, 3))),
      RES('ph2h', 'ph_hold2', 'reservation_id'),
      X(`select pg_temp.lapse('ph2h')`),
      Q('ph_sweep', `select to_jsonb(app.expire_stale_holds())`),
      K('ph_key', `select app.hold_standing_key({{ph}})`),
      Q('ph_standing', `select jsonb_build_object('phone_key', left(s.key, 2), 'strikes', s.strikes,
                                                  'waiting', s.blocked_until > now())
                          from hold_standing s where s.key = {{ph_key}}`),
      E('ph_delete', 'ph', `select app.delete_my_account('DELETE')`),
      Q('ph_after_delete', `select jsonb_build_object('strikes', s.strikes, 'on_tombstone', s.guest_id = {{ph}},
                                                      'name', p.full_name,
                                                      'account_gone', not exists (select 1 from auth.users u where u.id = {{ph}}))
                              from hold_standing s join profiles p on p.id = s.guest_id
                             where s.key = {{ph_key}}`),
      GUEST('ph2'),
      X(`select pg_temp.verify('ph2', {{phone}})`),
      Q('ph2_same_key', `select to_jsonb(app.hold_standing_key({{ph2}}) = {{ph_key}})`),
      E('ph2_hold', 'ph2', HOLD('c1', at(2, 6))),

      // 2. Four matches waiting for court 2 (DF-18).
      ...WAITING('ma', at(5), 'hl', 'ha', 'j1'),
      ...WAITING('mb', at(6), 'hb', 'hbh', 'j2'),
      ...WAITING('mc', at(7), 'hr', 'hrh', 'j3'),
      ...WAITING('md', at(8), 'hd', 'hdh', 'j4'),
      Q('waiting', STATUSES('ma', 'mb', 'mc', 'md')),

      // hl's and hb's holds lapse; hr releases after two minutes; hd tried a
      // deposit that failed, then let the hold lapse.
      X(`select pg_temp.lapse('ha')`),
      X(`select pg_temp.lapse('hbh')`),
      X(`update reservations set created_at = now() - interval '2 minutes' where id = {{hrh}}`),
      E('release_mc', 'hr', `select app.release_hold({{hrh}})`),
      X(`insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox,
                                        request_id, amount_iqd, quoted_price_iqd, status, failed_at, deadline_at)
         values ({{v}}, {{hdh}}, {{hdh}}, {{hd}}, 'deposit', 'fake', false, gen_random_uuid(), 10000, 48000,
                 'failed', now() - interval '20 minutes', now() - interval '15 minutes')`),
      X(`select pg_temp.lapse('hdh')`),

      // 3. At the claimed court: hw has an unsettled lapse (a 1st strike, a
      //    warning), so R22 is what refuses; ph2 waits, so the ladder refuses
      //    first.
      E('hold_hw', 'hw', HOLD('c1', at(3))),
      RES('hwh', 'hold_hw', 'reservation_id'),
      X(`select pg_temp.lapse('hwh')`),
      E('hw_claimed', 'hw', HOLD('c2', at(5))),
      Q('hw_strike_after_refusal', `select pg_temp.strike('hwh')`),
      E('ph2_claimed', 'ph2', HOLD('c2', at(5))),
      Q('strikes_before', STRIKES('ha', 'hbh', 'hdh')),
      Q('strike_released', `select jsonb_build_object('counted', s.counted, 'at_release', s.struck_at = now(),
                                                      'key', s.standing_key = app.hold_standing_key({{hr}}))
                              from hold_strikes s where s.reservation_id = {{hrh}}`),

      // 4. The match sweep: match_expire_holds, then match_try_book.
      Q('sweep', `select app.match_sweep({{v}})`),
      Q('booked', STATUSES('ma', 'mb', 'mc', 'md')),
      Q('holds_after_sweep', HOLDS('ha', 'hbh', 'hrh', 'hdh')),
      Q('strikes_after_match_sweep', STRIKES('ha', 'hbh', 'hdh')),

      // 5. hb comes back before the hold sweep: hold_slot settles the lapse.
      E('hb_next', 'hb', HOLD('c1', at(9))),
      Q('strike_hb', `select pg_temp.strike('hbh')`),

      // 6. The control: a lapse expired lazily, as hold_slot and the desk do.
      E('hold_ctl', 'hc', HOLD('c1', at(10))),
      RES('hch', 'hold_ctl', 'reservation_id'),
      X(`select pg_temp.lapse('hch')`),
      Q('lazy', `select to_jsonb(app.expire_stale_holds({{c1}}, tstzrange(${at(10)}, ${at(10)} + interval '90 minutes', '[)')))`),
      Q('strike_ctl_before', `select pg_temp.strike('hch')`),

      // 7. tp_hold_sweep's call.
      Q('hold_sweep', `select to_jsonb(app.expire_stale_holds())`),
      Q('strikes_after_hold_sweep', STRIKES('ha', 'hch', 'hdh', 'hwh')),
      Q('standings', STANDINGS('hl', 'hc', 'hb', 'hr', 'hd', 'hw')),
      E('hl_next', 'hl', HOLD('c1', at(11))),
      E('hc_next', 'hc', HOLD('c1', at(12))),
      E('hd_next', 'hd', HOLD('c1', at(13))),
      Q('ledger', `select pg_temp.ledger()`),
    ]);
  });

  it('a verified phone carries its standing past delete_my_account to a new account', () => {
    expect(data<Json>(r, 'ph_hold1')).toMatchObject({ duplicate: false, hold_warning: false });
    // The second hold settles the first lapse: a warning, nothing refused.
    expect(data<Json>(r, 'ph_hold2')).toMatchObject({ duplicate: false, hold_warning: true });
    expect(data(r, 'ph_standing')).toEqual({ phone_key: 'p:', strikes: 2, waiting: true });
    expect(data<Json>(r, 'ph_delete')).toMatchObject({ deleted: true });
    expect(data(r, 'ph_after_delete')).toEqual({
      strikes: 2, on_tombstone: true, name: 'Deleted account', account_gone: true,
    });
    expect(data(r, 'ph2_same_key')).toBe(true);
    expect(failed(r, 'ph2_hold').code).toBe('HOLD_COOLDOWN');
  });

  it('at a court a waiting match keeps, the ladder refuses first, and R22 rolls its caller\'s settle back', () => {
    expect(data(r, 'waiting')).toEqual({
      ma: 'awaiting_court', mb: 'awaiting_court', mc: 'awaiting_court', md: 'awaiting_court',
    });
    for (const m of ['ma', 'mb', 'mc', 'md']) {
      expect(data<Json>(r, `hold_${m}`), m).toMatchObject({ duplicate: false, hold_warning: false });
      expect(data<Json>(r, `join_${m}`), m).toMatchObject({ match_status: 'awaiting_court' });
    }
    expect(data<Json>(r, 'release_mc')).toMatchObject({ released: true, status: 'expired' });
    // hw has one strike to settle: the ladder lets the call through to R22.
    expect(failed(r, 'hw_claimed')).toMatchObject({ code: 'SLOT_TAKEN', detail: 'match_waiting' });
    expect(data(r, 'hw_strike_after_refusal')).toBeNull();
    expect(failed(r, 'ph2_claimed').code).toBe('HOLD_COOLDOWN');
    expect(data(r, 'strikes_before')).toEqual({ ha: null, hbh: null, hdh: null });
    // release_hold writes the released hold's strike itself (after 90 s).
    expect(data(r, 'strike_released')).toEqual({ counted: true, at_release: true, key: true });
  });

  it('the match sweep books every waiting match and leaves the strikes to the hold sweep', () => {
    expect(data<Json>(r, 'sweep')).toMatchObject({ venues_swept: 1, booked: 4, bumped: 0, errors: 0 });
    expect(data(r, 'booked')).toEqual({ ma: 'booked', mb: 'booked', mc: 'booked', md: 'booked' });
    expect(data(r, 'holds_after_sweep')).toEqual({ ha: 'expired', hbh: 'expired', hrh: 'expired', hdh: 'expired' });
    // match_expire_holds expired the three lapsed holds and judged none.
    expect(data(r, 'strikes_after_match_sweep')).toEqual({ ha: null, hbh: null, hdh: null });
    expect(data(r, 'ledger')).toEqual([]);
  });

  it('a lapse the twin expired settles like any other: on the guest\'s next hold, or at the hold sweep', () => {
    // The guest came back first: hold_slot settled it, and warns.
    expect(data<Json>(r, 'hb_next')).toMatchObject({ duplicate: false, hold_warning: true });
    expect(data(r, 'strike_hb')).toEqual({ counted: true, at_lapse: true, key: true });

    // The control: expire_stale_holds with arguments never settles either.
    expect(data(r, 'lazy')).toBe(1);
    expect(data(r, 'strike_ctl_before')).toBeNull();

    // The hold sweep: the twin's lapse and the lazy one are judged alike; the
    // failed deposit attempt makes a hold uncounted, as 0252 decides.
    expect(data(r, 'strikes_after_hold_sweep')).toEqual({
      ha: { counted: true, at_lapse: true, key: true },
      hch: { counted: true, at_lapse: true, key: true },
      hdh: { counted: false, at_lapse: true, key: true },
      hwh: { counted: true, at_lapse: true, key: true },
    });
    expect(data(r, 'standings')).toEqual({
      hl: { strikes: 1, waiting: false },
      hc: { strikes: 1, waiting: false },
      hb: { strikes: 1, waiting: false },
      hr: { strikes: 1, waiting: false },
      hd: null,
      hw: { strikes: 1, waiting: false },
    });
    expect(data<Json>(r, 'hl_next')).toMatchObject({ hold_warning: true });
    expect(data<Json>(r, 'hc_next')).toMatchObject({ hold_warning: true });
    expect(data<Json>(r, 'hd_next')).toMatchObject({ hold_warning: false });
  });
});
