/**
 * tournaments_lifecycle (docs/design/tournaments/build-contracts-2026-10-03.md §1.5, §1.6, §1.9,
 * §1.10, §1.12 S9–S13; plan §7 DB-B):
 *
 *   * publish: every refusal of §1.9 in its place (not done, already published, the capacity unit
 *     and count, the format of each variant, a fee without the owner's OK, no blocks, settings),
 *     the run's live blocks adopted, the answer's keys, the windows no block covers, the replay;
 *   * register, the waitlist, withdraw and the promotion it triggers (its push queued), the
 *     eligibility codes, the category, the cut-off; the desk's add and remove;
 *   * the sweep: the cut-off cancel (under_filled: blocks released, entries told, one per tick)
 *     and close (seeds stamped), deleted accounts, the finish;
 *   * the guard trigger against the desk's cancel, move, mark and extend of an adopted block,
 *     while the tournament's own cancel releases them;
 *   * block_courts_for_event (S10, S11): the combined R22 check with N courts and one waiting
 *     match, DEGRADED_LOCKOUT, an inactive court, a branch out of scope;
 *   * app.tournament_notify's c_keys equal the tournament keys of _shared/guest-push.json;
 *   * the switch, desk_tournaments and tournaments_public (its keys, off, mine, nothing private).
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker the suite skips.
 */
import { describe, expect, it } from 'vitest';
import {
  TOURNAMENT_SHAPES,
  TOUR_PUBLIC_FORBIDDEN_KEYS,
  tourMissingKeys,
} from '../../core/src/tournaments';
import guestPush from '../supabase/functions/_shared/guest-push.json';
import { stackAvailable } from './helpers';
import { E, GUEST } from './matches-harness';
import { dockerReachable, KEEP, MK, Q, RES, scenario, T, X } from './stores-harness';
import {
  answer,
  KEY,
  PUBLISH,
  refusal,
  ROUNDS,
  RUN,
  SETTINGS,
  TOUR_BRANCH,
  TOUR_SETUP,
} from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** Every key of a JSON value, at any depth. */
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  }
  return out;
}

const publish = (label: string, run: string, s: Record<string, unknown> = {}, who = 'manager') =>
  T(label, who, `select app.tournament_publish({{${run}}}, ${SETTINGS(run, s)}, ${KEY(label)})`);

describe.skipIf(!docker)('tournament_publish (T-6, §1.9)', () => {
  it('refuses in the order of §1.9, adopts the live blocks, answers the shape, replays and refuses a second publish', () => {
    const r = scenario('tl-pub', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { days: 3 }),
      RUN('r_active', { days: 4, status: 'active' }),
      RUN('r_pairs', { days: 5, unit: 'pairs' }),
      RUN('r_small', { days: 6, count: 3 }),
      RUN('r_fee', { days: 7, fee: 25000, owner_ok: false }),
      RUN('r_fee_ok', { days: 8, fee: 25000 }),
      RUN('r_t2', { days: 9, variant: 'type2' }),
      RUN('r_knock', { days: 10, format: 'knockout' }),
      RUN('r_noblk', { days: 11, blocks: false }),
      RUN('r_mex', { days: 12, format: 'mexicano' }),
      RUN('r_big', { days: 13, count: 200 }),
      MK('mgr_a', 'manager'),

      T('desk', 'desk', `select app.tournament_publish({{r1}}, '{}'::jsonb, ${KEY('d')})`),
      T(
        'nil',
        'manager',
        `select app.tournament_publish('00000000-0000-4000-8000-000000000000', '{}'::jsonb, ${KEY('n')})`,
      ),
      T('no_key', 'manager', `select app.tournament_publish({{r1}}, '{}'::jsonb, null)`),
      T(
        'bad_settings',
        'manager',
        `select app.tournament_publish({{r1}}, '[]'::jsonb, ${KEY('b')})`,
      ),
      // A manager of venue A only: the branch is not in scope.
      publish('scope', 'r1', {}, 'mgr_a'),
      publish('not_done', 'r_active'),
      publish('pairs', 'r_pairs'),
      publish('small', 'r_small'),
      publish('fee', 'r_fee'),
      publish('knock', 'r_knock'),
      publish('t2_none', 'r_t2'),
      publish('t2_mex', 'r_t2', { format: 'mexicano' }),
      publish('noblk', 'r_noblk'),
      publish('fmt_diff', 'r1', { format: 'mexicano' }),
      publish('unknown', 'r1', { bogus: 1 }),
      publish('points', 'r1', { points_target: 7 }),
      publish('min', 'r1', { min_entries: 17 }),
      publish('wait', 'r1', { waitlist_max: 65 }),
      publish('category', 'r1', { category: 'mixed' }),
      publish('prize', 'r1', { prize_en: 'x'.repeat(201) }),
      publish('mex_rounds', 'r_mex'),
      T(
        'closes_none',
        'manager',
        `select app.tournament_publish({{r1}}, '{}'::jsonb, ${KEY('c0')})`,
      ),
      T(
        'closes_late',
        'manager',
        `select app.tournament_publish({{r1}},
         jsonb_build_object('registration_closes_at', ({{r1_from}})::timestamptz + interval '1 minute'), ${KEY('c1')})`,
      ),
      T(
        'closes_past',
        'manager',
        `select app.tournament_publish({{r1}},
         jsonb_build_object('registration_closes_at', now() - interval '1 minute'), ${KEY('c2')})`,
      ),
      // The switch off refuses before anything else of the run is judged.
      X(`update venue_settings set tournaments_enabled = false where venue_id = {{v}}::uuid`),
      publish('off', 'r1'),
      X(`update venue_settings set tournaments_enabled = true where venue_id = {{v}}::uuid`),

      KEEP('k1', `select 'tl-pub-k1-' || gen_random_uuid()`),
      T(
        'ok',
        'manager',
        `select app.tournament_publish({{r1}}, ${SETTINGS('r1', {
          category: 'men',
          points_target: 32,
          min_entries: 8,
          waitlist_max: 4,
          prize_en: 'Trophy',
          prize_ar: 'كأس',
        })}, {{k1}})`,
      ),
      T('replay', 'manager', `select app.tournament_publish({{r1}}, ${SETTINGS('r1')}, {{k1}})`),
      publish('again', 'r1'),
      RES('t1', 'ok', 'tournament_id'),
      Q(
        'row',
        `select to_jsonb(t) - 'id' - 'created_at' - 'updated_at' - 'registration_closes_at' - 'published_by'
                  from tournaments t where t.id = {{t1}}::uuid`,
      ),
      Q(
        'audit',
        `select to_jsonb(count(*)) from audit_log where action = 'tournament.publish' and entity_id = {{t1}}`,
      ),
      publish('fee_ok', 'r_fee_ok'),
      RES('t_fee', 'fee_ok', 'tournament_id'),
      Q(
        'fee_row',
        `select jsonb_build_object('fee', entry_fee_iqd, 'max', max_entries) from tournaments where id = {{t_fee}}::uuid`,
      ),
      publish('t2_ok', 'r_t2', { format: 'americano' }),
      publish('big', 'r_big'),
      RES('t_big', 'big', 'tournament_id'),
      Q('big_row', `select to_jsonb(max_entries) from tournaments where id = {{t_big}}::uuid`),
      // One of the Mexicano run's blocks is gone: three adopted, its window reported.
      X(`update reservations set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff'
          where protocol_run_id = {{r_mex}}::uuid and court_id = {{c4}}::uuid`),
      publish('mex', 'r_mex', { rounds: 5 }),
      RES('t_mex', 'mex', 'tournament_id'),
      Q(
        'mex_row',
        `select jsonb_build_object('rounds', rounds_planned, 'format', format) from tournaments where id = {{t_mex}}::uuid`,
      ),
    ]);

    expect(refusal(r, 'desk')).toBe('FORBIDDEN');
    expect(refusal(r, 'nil')).toBe('PROTOCOL_NOT_FOUND');
    expect(refusal(r, 'no_key')).toBe('INVALID_ARGUMENT:p_idempotency_key');
    expect(refusal(r, 'bad_settings')).toBe('INVALID_ARGUMENT:p_settings');
    expect(refusal(r, 'scope')).toBe('PROTOCOL_NOT_FOUND');
    expect(refusal(r, 'not_done')).toBe('TOURNAMENT_PUBLISH_REFUSED:not_done');
    expect(refusal(r, 'pairs')).toBe('TOURNAMENT_PUBLISH_REFUSED:capacity_unit');
    expect(refusal(r, 'small')).toBe('TOURNAMENT_PUBLISH_REFUSED:capacity_count');
    expect(refusal(r, 'fee')).toBe('TOURNAMENT_PUBLISH_REFUSED:fee_not_approved');
    expect(refusal(r, 'knock')).toBe('TOURNAMENT_PUBLISH_REFUSED:format');
    expect(refusal(r, 't2_none')).toBe('TOURNAMENT_PUBLISH_REFUSED:format');
    expect(refusal(r, 't2_mex')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:rounds');
    expect(refusal(r, 'noblk')).toBe('TOURNAMENT_PUBLISH_REFUSED:no_blocks');
    expect(refusal(r, 'fmt_diff')).toBe('TOURNAMENT_PUBLISH_REFUSED:format');
    expect(refusal(r, 'unknown')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:bogus');
    expect(refusal(r, 'points')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:points_target');
    expect(refusal(r, 'min')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:min_entries');
    expect(refusal(r, 'wait')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:waitlist_max');
    expect(refusal(r, 'category')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:category');
    expect(refusal(r, 'prize')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:prize_en');
    expect(refusal(r, 'mex_rounds')).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:rounds');
    for (const l of ['closes_none', 'closes_late', 'closes_past']) {
      expect(refusal(r, l), l).toBe('TOURNAMENT_PUBLISH_REFUSED:settings:registration_closes_at');
    }
    expect(refusal(r, 'off')).toBe('TOURNAMENTS_OFF');

    const ok = answer(r, 'ok');
    expect(tourMissingKeys(ok, TOURNAMENT_SHAPES.tournament_publish)).toEqual([]);
    expect(ok).toMatchObject({ duplicate: false, status: 'open', unblocked_windows: [] });
    expect((ok.blocks as unknown[]).length).toBe(4);
    expect(answer(r, 'replay')).toMatchObject({ duplicate: true, tournament_id: ok.tournament_id });
    expect(refusal(r, 'again')).toBe('TOURNAMENT_PUBLISH_REFUSED:already_published');
    expect(answer(r, 'row')).toMatchObject({
      name_en: 'Summer Cup',
      name_ar: 'كأس الصيف',
      format: 'americano',
      category: 'men',
      class: 'A',
      points_target: 32,
      rounds_planned: null,
      max_entries: 16,
      min_entries: 8,
      waitlist_max: 4,
      entry_fee_iqd: 0,
      prize_en: 'Trophy',
      prize_ar: 'كأس',
      status: 'open',
      revision: 0,
    });
    expect(answer(r, 'audit')).toBe(1);
    expect(answer(r, 'fee_row')).toEqual({ fee: 25000, max: 16 });
    expect(answer(r, 't2_ok')).toMatchObject({ status: 'open' });
    expect(answer(r, 'big_row')).toBe(64);
    const mex = answer<{ blocks: unknown[]; unblocked_windows: Array<{ court_id: string }> }>(
      r,
      'mex',
    );
    expect(mex.blocks).toHaveLength(3);
    expect(mex.unblocked_windows).toHaveLength(1);
    expect(answer(r, 'mex_row')).toEqual({ rounds: 5, format: 'mexicano' });
  });
});

describe.skipIf(!docker)('register, waitlist, withdraw, promote (T-4, T-7)', () => {
  it('registers to capacity, waitlists, refuses when full, promotes on a withdrawal and tells the promoted guest', () => {
    const r = scenario('tl-reg', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 4 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 1 }),
      RUN('r_w', { days: 5 }),
      ...PUBLISH('pub_w', 'r_w', 'tw', { category: 'women' }),
      ...['g1', 'g2', 'g3', 'g4', 'g6'].map((g) => GUEST(g)),
      GUEST('g5', '{"push": "ExponentPushToken[tl-reg-g5]"}'),
      GUEST('no_phone', '{"phone": null}'),
      GUEST('no_gender', '{"gender": null}'),
      GUEST('banned'),
      GUEST('man', '{"gender": "male"}'),
      `select pg_temp.ban('banned');`,
      ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((g) =>
        T(`reg_${g}`, g, `select app.tournament_register({{t1}})`),
      ),
      T('dup', 'g1', `select app.tournament_register({{t1}})`),
      T('no_phone', 'no_phone', `select app.tournament_register({{t1}})`),
      T('no_gender', 'no_gender', `select app.tournament_register({{t1}})`),
      T('banned', 'banned', `select app.tournament_register({{t1}})`),
      T('man_w', 'man', `select app.tournament_register({{tw}})`),
      T('nil', 'g1', `select app.tournament_register('00000000-0000-4000-8000-000000000000')`),
      T('pub_g1', 'g1', `select app.tournaments_public(null)`),
      E('pub_anon', null, `select app.tournaments_public(null)`),
      E('one_anon', null, `select app.tournament_public({{t1}})`),
      T('one_g5', 'g5', `select app.tournament_public({{t1}})`),

      T('w_g2', 'g2', `select app.tournament_withdraw({{t1}})`),
      T('w_g2_again', 'g2', `select app.tournament_withdraw({{t1}})`),
      T('w_none', 'man', `select app.tournament_withdraw({{t1}})`),
      Q(
        'after_w',
        `select jsonb_object_agg(v.name, e.status) from tournament_entries e
                      join pg_temp.vars v on v.val = e.guest_id::text where e.tournament_id = {{t1}}::uuid`,
      ),
      Q(
        'push',
        `select coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'payload', o.payload - 'dedupe')), '[]')
                   from notification_outbox o where o.profile_id = {{g5}}::uuid`,
      ),
      // g2 comes back: the places are taken again, so the waitlist.
      T('rereg_g2', 'g2', `select app.tournament_register({{t1}})`),
      // The cut-off passes.
      X(
        `update tournaments set registration_closes_at = now() - interval '1 second' where id = {{t1}}::uuid`,
      ),
      T('late_reg', 'g6', `select app.tournament_register({{t1}})`),
      T('late_w', 'g1', `select app.tournament_withdraw({{t1}})`),
    ]);

    for (const g of ['g1', 'g2', 'g3', 'g4']) {
      expect(answer(r, `reg_${g}`), g).toMatchObject({
        status: 'registered',
        waitlist_position: null,
        duplicate: false,
      });
    }
    expect(tourMissingKeys(answer(r, 'reg_g1'), TOURNAMENT_SHAPES.tournament_register)).toEqual([]);
    expect(answer(r, 'reg_g5')).toMatchObject({ status: 'waitlisted', waitlist_position: 1 });
    expect(refusal(r, 'reg_g6')).toBe('TOURNAMENT_FULL');
    expect(answer(r, 'dup')).toMatchObject({ status: 'registered', duplicate: true });
    expect(refusal(r, 'no_phone')).toBe('PHONE_REQUIRED');
    expect(refusal(r, 'no_gender')).toBe('GENDER_REQUIRED');
    expect(refusal(r, 'banned')).toBe('MATCH_BANNED');
    expect(refusal(r, 'man_w')).toBe('TOURNAMENT_CATEGORY_MISMATCH');
    expect(refusal(r, 'nil')).toBe('TOURNAMENT_NOT_FOUND');

    const list = answer<{ tournaments: Array<Record<string, unknown>> }>(r, 'pub_g1');
    expect(tourMissingKeys(list, TOURNAMENT_SHAPES.tournaments_public)).toEqual([]);
    const row = list.tournaments.find((t) => t.max_entries === 4)!;
    expect(row).toMatchObject({
      places_left: 0,
      waitlist_open: false,
      mine: { status: 'registered' },
    });
    const anon = answer<{ tournaments: Array<Record<string, unknown>> }>(r, 'pub_anon');
    expect(anon.tournaments.every((t) => t.mine === null)).toBe(true);
    for (const label of ['pub_anon', 'pub_g1', 'one_anon', 'one_g5']) {
      const keys = keysOf(answer(r, label));
      for (const k of TOUR_PUBLIC_FORBIDDEN_KEYS) expect(keys, `${label} ${k}`).not.toContain(k);
    }
    expect(answer(r, 'one_anon')).toMatchObject({
      missing: false,
      me: null,
      entries_count: 4,
      rounds: [],
    });
    expect(answer(r, 'one_g5')).toMatchObject({
      me: { status: 'waitlisted', waitlist_position: 1, owed_iqd: 0 },
    });

    expect(answer(r, 'w_g2')).toMatchObject({
      status: 'withdrawn',
      refund_due_iqd: 0,
      duplicate: false,
    });
    expect(tourMissingKeys(answer(r, 'w_g2'), TOURNAMENT_SHAPES.tournament_withdraw)).toEqual([]);
    expect(answer(r, 'w_g2_again')).toMatchObject({ status: 'withdrawn', duplicate: true });
    expect(refusal(r, 'w_none')).toBe('TOURNAMENT_ENTRY_NOT_FOUND');
    expect(answer(r, 'after_w')).toEqual({
      g1: 'registered',
      g2: 'withdrawn',
      g3: 'registered',
      g4: 'registered',
      g5: 'registered',
    });
    const push = answer<Array<{ kind: string; payload: Record<string, unknown> }>>(r, 'push');
    expect(push).toHaveLength(1);
    expect(push[0]).toMatchObject({
      kind: 'tournament_update',
      payload: { route: 'tournament', title_key: 'tournament.promoted', params: {} },
    });
    expect(answer(r, 'rereg_g2')).toMatchObject({
      status: 'waitlisted',
      waitlist_position: 1,
      duplicate: false,
    });
    expect(refusal(r, 'late_reg')).toBe('TOURNAMENT_NOT_OPEN:cutoff');
    expect(refusal(r, 'late_w')).toBe('TOURNAMENT_NOT_OPEN:cutoff');
  });

  it('the desk adds a walk-in, promotes a waitlisted guest when a place frees, removes before play', () => {
    const r = scenario('tl-desk', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 4 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      ...['g1', 'g2', 'g3', 'g4', 'g5'].map((g) => GUEST(g)),
      GUEST('walk', '{"phone": null, "terms": null, "gender": null}'),
      GUEST('banned'),
      `select pg_temp.ban('banned');`,
      ...['g1', 'g2', 'g3', 'g4'].map((g) =>
        T(`reg_${g}`, g, `select app.tournament_register({{t1}})`),
      ),
      T('cashier', 'cashier', `select app.tournament_add_entry({{t1}}, {{walk}})`),
      T('walk', 'desk', `select app.tournament_add_entry({{t1}}, {{walk}})`),
      T('walk_again', 'desk', `select app.tournament_add_entry({{t1}}, {{walk}})`),
      T('banned', 'desk', `select app.tournament_add_entry({{t1}}, {{banned}})`),
      T(
        'nobody',
        'desk',
        `select app.tournament_add_entry({{t1}}, '00000000-0000-4000-8000-000000000000')`,
      ),
      KEEP('g1_e', `select id::text from tournament_entries where guest_id = {{g1}}::uuid`),
      T('rm_blank', 'desk', `select app.tournament_remove_entry({{g1_e}}, '  ')`),
      T('rm', 'desk', `select app.tournament_remove_entry({{g1_e}}, 'asked by phone')`),
      Q(
        'after',
        `select jsonb_object_agg(v.name, e.status) from tournament_entries e
                    join pg_temp.vars v on v.val = e.guest_id::text where e.tournament_id = {{t1}}::uuid`,
      ),
      // Closed: a walk-in takes the next seed and moves the revision.
      `select pg_temp.close('t1');`,
      T('late_walk', 'desk', `select app.tournament_add_entry({{t1}}, {{g5}})`),
      Q(
        'closed',
        `select jsonb_build_object('revision', t.revision,
                     'seed', (select e.seed_no from tournament_entries e where e.guest_id = {{g5}}::uuid
                                and e.tournament_id = t.id))
                     from tournaments t where t.id = {{t1}}::uuid`,
      ),
      X(`update tournaments set status = 'running' where id = {{t1}}::uuid`),
      KEEP('g2_e', `select id::text from tournament_entries where guest_id = {{g2}}::uuid`),
      T('rm_running', 'desk', `select app.tournament_remove_entry({{g2_e}}, 'left')`),
    ]);
    expect(refusal(r, 'cashier')).toBe('FORBIDDEN');
    expect(answer(r, 'walk')).toMatchObject({
      status: 'waitlisted',
      waitlist_position: 1,
      duplicate: false,
    });
    expect(tourMissingKeys(answer(r, 'walk'), TOURNAMENT_SHAPES.tournament_add_entry)).toEqual([]);
    expect(answer(r, 'walk_again')).toMatchObject({ status: 'waitlisted', duplicate: true });
    expect(refusal(r, 'banned')).toBe('MATCH_BANNED');
    expect(refusal(r, 'nobody')).toBe('INVALID_ARGUMENT:p_guest_id');
    expect(refusal(r, 'rm_blank')).toBe('REASON_REQUIRED');
    expect(answer(r, 'rm')).toMatchObject({ status: 'withdrawn', refund_due_iqd: 0 });
    expect(tourMissingKeys(answer(r, 'rm'), TOURNAMENT_SHAPES.tournament_remove_entry)).toEqual([]);
    // The walk-in was first on the waitlist: the freed place is theirs.
    expect(answer(r, 'after')).toMatchObject({ g1: 'withdrawn', walk: 'registered' });
    expect(answer(r, 'late_walk')).toMatchObject({ status: 'waitlisted' });
    expect(refusal(r, 'rm_running')).toBe('TOURNAMENT_NOT_OPEN:status');
  });
});

describe.skipIf(!docker)('the sweep (§3.7)', () => {
  it('cancels one under-filled tournament per tick (blocks released, entries told), closes the full one with seeds, withdraws deleted accounts, finishes the old', () => {
    const r = scenario('tl-sweep', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('ra', { days: 3 }),
      ...PUBLISH('pa', 'ra', 'ta', { min_entries: 4 }),
      RUN('rb', { days: 4 }),
      ...PUBLISH('pb', 'rb', 'tb', { min_entries: 4 }),
      RUN('rc', { days: 5 }),
      ...PUBLISH('pc', 'rc', 'tc', { min_entries: 4 }),
      RUN('rd', { days: 6, count: 4 }),
      ...PUBLISH('pd', 'rd', 'td'),
      `select pg_temp.field('ta', 2, 'sa');`,
      `select pg_temp.field('tb', 4, 'sb');`,
      `select pg_temp.field('tc', 1, 'sc');`,
      `select pg_temp.field('td', 4, 'sd');`,
      X(
        `update profiles set expo_push_token = 'ExponentPushToken[tl-sweep-sa1]' where id = {{sa1}}::uuid`,
      ),
      // td: one of its guests deleted their account; a waitlisted guest waits.
      GUEST('dw'),
      T('dw_reg', 'dw', `select app.tournament_register({{td}})`),
      X(`update profiles set deleted_at = now() where id = {{sd2}}::uuid`),
      // Distinct cut-offs, so the sweep meets them in a known order: ta, tb, tc.
      X(
        `update tournaments set registration_closes_at = now() - interval '3 seconds' where id = {{ta}}::uuid`,
      ),
      X(
        `update tournaments set registration_closes_at = now() - interval '2 seconds' where id = {{tb}}::uuid`,
      ),
      X(
        `update tournaments set registration_closes_at = now() - interval '1 second' where id = {{tc}}::uuid`,
      ),
      Q('sweep', `select app.tournament_sweep()`),
      Q(
        'states',
        `select jsonb_object_agg(v.name, jsonb_build_object('status', t.status, 'reason', t.cancel_reason))
                     from tournaments t join pg_temp.vars v on v.val = t.id::text
                    where v.name in ('ta', 'tb', 'tc', 'td')`,
      ),
      Q(
        'blocks_a',
        `select jsonb_agg(distinct r.status) from reservations r where r.protocol_run_id = {{ra}}::uuid`,
      ),
      Q(
        'seeds_b',
        `select jsonb_agg(e.seed_no order by e.entered_at) from tournament_entries e where e.tournament_id = {{tb}}::uuid`,
      ),
      Q(
        'push_a1',
        `select coalesce(jsonb_agg(o.payload->>'title_key'), '[]') from notification_outbox o where o.profile_id = {{sa1}}::uuid`,
      ),
      Q(
        'td_entries',
        `select jsonb_object_agg(v.name, jsonb_build_object('status', e.status, 'why', e.withdrawn_reason))
                         from tournament_entries e join pg_temp.vars v on v.val = e.guest_id::text
                        where e.tournament_id = {{td}}::uuid and v.name in ('sd2', 'dw')`,
      ),
      Q('sweep2', `select app.tournament_sweep()`),
      // tb is played (its first round drawn); te closed and nothing was ever drawn.
      ...ROUNDS('tb_r', 'tb', 1, 1),
      RUN('re', { days: 7 }),
      ...PUBLISH('pe', 're', 'te'),
      `select pg_temp.field('te', 4, 'se');`,
      `select pg_temp.close('te');`,
      // Both ended long ago: tb is finished, te (never played) cancelled.
      X(`update tournaments set starts_at = now() - interval '2 days', ends_at = now() - interval '7 hours',
                                registration_closes_at = now() - interval '3 days'
          where id in ({{tb}}::uuid, {{te}}::uuid)`),
      Q('sweep3', `select app.tournament_sweep()`),
      Q('tb_status', `select to_jsonb(status) from tournaments where id = {{tb}}::uuid`),
      Q(
        'te_state',
        `select jsonb_build_object('status', t.status, 'reason', t.cancel_reason,
                                   'note', (select a.after->>'note' from audit_log a
                                             where a.action = 'tournament.cancel' and a.entity_id = t.id::text))
           from tournaments t where t.id = {{te}}::uuid`,
      ),
    ]);
    expect(answer(r, 'sweep')).toMatchObject({
      cancelled: 1,
      closed: 1,
      withdrawn: 1,
      deferred: 1,
      errors: 0,
    });
    const states = answer<Record<string, { status: string; reason: string | null }>>(r, 'states');
    expect(states.ta).toEqual({ status: 'cancelled', reason: 'under_filled' });
    expect(states.tb).toEqual({ status: 'closed', reason: null });
    expect(states.tc).toEqual({ status: 'open', reason: null });
    expect(answer(r, 'blocks_a')).toEqual(['cancelled']);
    expect(answer(r, 'seeds_b')).toEqual([1, 2, 3, 4]);
    expect(answer(r, 'push_a1')).toEqual(['tournament.cancelled']);
    expect(answer(r, 'td_entries')).toEqual({
      sd2: { status: 'withdrawn', why: 'account_deleted' },
      dw: { status: 'registered', why: null },
    });
    expect(answer(r, 'sweep2')).toMatchObject({ cancelled: 1, closed: 0, deferred: 0 });
    expect(answer(r, 'tb_r')).toMatchObject({ status: 'running' });
    expect(answer(r, 'sweep3')).toMatchObject({
      finished: 1,
      cancelled: 1,
      deferred: 0,
      errors: 0,
    });
    expect(answer(r, 'tb_status')).toBe('finished');
    expect(answer(r, 'te_state')).toEqual({
      status: 'cancelled',
      reason: 'staff',
      note: 'not played (no round drawn by the finish)',
    });
  });
});

describe.skipIf(!docker)('the guard trigger and tournament_cancel (T-3, S9)', () => {
  it('refuses the desk cancel, move, mark and extend of an adopted block; the tournament cancel releases them', () => {
    const r = scenario('tl-guard', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r0', { days: 3 }),
      KEEP(
        'b0',
        `select id::text from reservations where protocol_run_id = {{r0}}::uuid and court_id = {{c1}}::uuid`,
      ),
      // Before publish the run's own blocks are the desk's to move.
      T('pre_cancel', 'desk', `select app.cancel_reservation({{b0}}, 'moved to Friday')`),
      RUN('r1', { days: 4 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 4, 'p');`,
      KEEP(
        'b1',
        `select id::text from reservations where protocol_run_id = {{r1}}::uuid and court_id = {{c1}}::uuid`,
      ),
      T('cancel', 'desk', `select app.cancel_reservation({{b1}}, 'nope')`),
      T(
        'move',
        'desk',
        `select app.move_reservation({{b1}}, {{c1}}, ({{r1_from}})::timestamptz + interval '1 day',
                                                    ({{r1_to}})::timestamptz + interval '1 day', 'nope')`,
      ),
      // No RPC marks a future block; a direct status write meets the trigger all the same.
      E(
        'mark',
        null,
        `with u as (update reservations set status = 'no_show' where id = {{b1}}::uuid returning id)
                       select to_jsonb(count(*)) from u`,
      ),
      T(
        'extend',
        'desk',
        `select app.extend_reservation({{b1}}, ({{r1_to}})::timestamptz + interval '1 hour', 'nope')`,
      ),
      T('t_cancel_desk', 'desk', `select app.tournament_cancel({{t1}}, 'rain')`),
      T('t_cancel_blank', 'manager', `select app.tournament_cancel({{t1}}, '')`),
      T('t_cancel', 'manager', `select app.tournament_cancel({{t1}}, 'Rain all weekend')`),
      T('t_cancel_again', 'manager', `select app.tournament_cancel({{t1}}, 'again')`),
      Q(
        'blocks',
        `select jsonb_agg(distinct r.status) from reservations r where r.protocol_run_id = {{r1}}::uuid`,
      ),
      Q(
        'audit',
        `select jsonb_build_object('reason', a.reason_code, 'note', a.after->>'note') from audit_log a
                   where a.action = 'tournament.cancel' and a.entity_id = {{t1}}`,
      ),
      T('post_cancel', 'desk', `select app.cancel_reservation({{b1}}, 'already gone')`),
    ]);
    expect(answer(r, 'pre_cancel')).toBeTruthy();
    for (const l of ['cancel', 'move', 'mark', 'extend'])
      expect(refusal(r, l), l).toBe('TOURNAMENT_VIA_EVENTS');
    expect(refusal(r, 't_cancel_desk')).toBe('FORBIDDEN');
    expect(refusal(r, 't_cancel_blank')).toBe('REASON_REQUIRED');
    const c = answer(r, 't_cancel');
    expect(tourMissingKeys(c, TOURNAMENT_SHAPES.tournament_cancel)).toEqual([]);
    expect(c).toMatchObject({ status: 'cancelled', refunds_due: [] });
    expect(refusal(r, 't_cancel_again')).toBe('TOURNAMENT_NOT_OPEN:status');
    expect(answer(r, 'blocks')).toEqual(['cancelled']);
    expect(answer(r, 'audit')).toEqual({ reason: 'staff', note: 'Rain all weekend' });
  });
});

describe.skipIf(!docker)('block_courts_for_event (S10, S11)', () => {
  /** An active run of the branch with its courts step open (no blocks yet). */
  const ACTIVE = [
    RUN('ra', { days: 3, status: 'active', blocks: false }),
    X(`insert into protocol_run_steps (run_id, position, step_key, name_en, name_ar, actor_roles, needs_owner_ok,
                                       optional, status, round, opened_at)
       values ({{ra}}::uuid, 3, 'courts', 'Courts', 'الملاعب', '{court_desk}', false, false, 'open', 1, now())`),
  ];
  const block = (
    courts: string[],
    from = `({{ra_from}})::timestamptz`,
    to = `({{ra_to}})::timestamptz`,
  ) =>
    `jsonb_build_array(${courts
      .map((c) => `jsonb_build_object('court_id', {{${c}}}, 'start_at', ${from}, 'end_at', ${to})`)
      .join(', ')})`;

  it('refuses blocks that would leave a waiting match no court, counting the whole request', () => {
    const r = scenario('tl-r22', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      ...ACTIVE,
      GUEST('g1'),
      KEEP(
        'm1',
        `select pg_temp.m(jsonb_build_object('status', 'awaiting_court',
                    'start_at', ({{ra_from}})::timestamptz + interval '1 hour', 'duration_min', 90))::text`,
      ),
      T(
        'all4',
        'desk',
        `select app.block_courts_for_event({{ra}}, ${block(['c1', 'c2', 'c3', 'c4'])}, ${KEY('a')})`,
      ),
      Q(
        'written',
        `select to_jsonb(count(*)) from reservations where protocol_run_id = {{ra}}::uuid`,
      ),
      T(
        'three',
        'desk',
        `select app.block_courts_for_event({{ra}}, ${block(['c1', 'c2', 'c3'])}, ${KEY('b')})`,
      ),
      // A second waiting match over the same window: three blocks now starve one.
      KEEP(
        'm2',
        `select pg_temp.m(jsonb_build_object('status', 'awaiting_court',
                    'start_at', ({{ra_from}})::timestamptz + interval '2 hours', 'duration_min', 90))::text`,
      ),
      T(
        'one_more',
        'desk',
        `select app.block_courts_for_event({{ra}}, ${block(['c4'])}, ${KEY('c')})`,
      ),
      Q(
        'm_status',
        `select jsonb_agg(status order by id) from matches where id in ({{m1}}::uuid, {{m2}}::uuid)`,
      ),
    ]);
    const all4 = answer<{ blocked: unknown[]; conflicts: Array<Record<string, unknown>> }>(
      r,
      'all4',
    );
    expect(all4.blocked).toEqual([]);
    expect(all4.conflicts).toHaveLength(4);
    for (const c of all4.conflicts) {
      expect(c).toMatchObject({
        reservation_id: null,
        kind: 'match_waiting',
        status: 'awaiting_court',
      });
    }
    expect(answer(r, 'written')).toBe(0);
    const three = answer<{ blocked: unknown[]; conflicts: unknown[] }>(r, 'three');
    expect(three.conflicts).toEqual([]);
    expect(three.blocked).toHaveLength(3);
    const more = answer<{ blocked: unknown[]; conflicts: Array<Record<string, unknown>> }>(
      r,
      'one_more',
    );
    expect(more.blocked).toEqual([]);
    expect(more.conflicts).toEqual([
      expect.objectContaining({ kind: 'match_waiting', reservation_id: null }),
    ]);
    expect(answer(r, 'm_status')).toEqual(['awaiting_court', 'awaiting_court']);
  });

  it("refuses a block only on a court that could book the waiting match (match_court_claimed's own test)", () => {
    // The match waits because c1, the one court offering 90 minutes, is held
    // by someone else's unpaid hold: no court is free for it either way. c2
    // and c3 offer 60 only, so blocking them starves nothing; c4 offers 90
    // and is free, so blocking it does.
    const r = scenario('tl-r22-own', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      ...ACTIVE,
      X(
        `update courts set duration_options = '{60}' where id in ({{c2}}::uuid, {{c3}}::uuid, {{c4}}::uuid)`,
      ),
      GUEST('holder'),
      X(
        `select pg_temp.res('c1', ({{ra_from}})::timestamptz + interval '1 hour', 90, 'hold', 'pending', 'holder')`,
      ),
      KEEP(
        'm1',
        `select pg_temp.m(jsonb_build_object('status', 'awaiting_court',
                    'start_at', ({{ra_from}})::timestamptz + interval '1 hour', 'duration_min', 90))::text`,
      ),
      T(
        'short',
        'desk',
        `select app.block_courts_for_event({{ra}}, ${block(['c2', 'c3'])}, ${KEY('s')})`,
      ),
      X(`update courts set duration_options = '{60,90,120}' where id = {{c4}}::uuid`),
      T(
        'can_host',
        'desk',
        `select app.block_courts_for_event({{ra}}, ${block(['c4'])}, ${KEY('h')})`,
      ),
      Q('m_status', `select to_jsonb(status) from matches where id = {{m1}}::uuid`),
    ]);
    const short = answer<{ blocked: unknown[]; conflicts: unknown[] }>(r, 'short');
    expect(short.conflicts).toEqual([]);
    expect(short.blocked).toHaveLength(2);
    const host = answer<{ blocked: unknown[]; conflicts: Array<Record<string, unknown>> }>(
      r,
      'can_host',
    );
    expect(host.blocked).toEqual([]);
    expect(host.conflicts).toEqual([
      expect.objectContaining({ kind: 'match_waiting', reservation_id: null }),
    ]);
    expect(answer(r, 'm_status')).toBe('awaiting_court');
  });

  it('DEGRADED_LOCKOUT inside the horizon; an inactive court; a branch out of scope', () => {
    const r = scenario('tl-deg', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      ...ACTIVE,
      MK('desk_a', 'court_desk'),
      T(
        'scope',
        'desk_a',
        `select app.block_courts_for_event({{ra}}, ${block(['c1'])}, ${KEY('s')})`,
      ),
      X(`update courts set is_active = false where id = {{c4}}::uuid`),
      T(
        'inactive',
        'desk',
        `select app.block_courts_for_event({{ra}}, ${block(['c4'])}, ${KEY('i')})`,
      ),
      // The branch trades offline: the switch on, its till quiet, a day open.
      X(
        `update venue_settings set offline_mode_enabled = true, protected_horizon_hours = 48 where venue_id = {{v}}::uuid`,
      ),
      X(
        `insert into stations (id, venue_id, is_till, mode) values ('TILL-TLDEG-' || upper(left({{v}}, 8)), {{v}}::uuid, true, 'till')`,
      ),
      X(`insert into device_heartbeats (device_id, venue_id, is_till, last_seen_at)
         values ('TILL-TLDEG-' || upper(left({{v}}, 8)), {{v}}::uuid, true, now() - interval '10 minutes')`),
      X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
         values ({{v}}::uuid, date '4999-12-31', 'open', {{manager}}::uuid, 0)`),
      Q('degraded', `select to_jsonb(app.is_degraded({{v}}::uuid))`),
      T(
        'soon',
        'desk',
        `select app.block_courts_for_event({{ra}},
          ${block(['c1'], `now() + interval '1 day'`, `now() + interval '1 day 2 hours'`)}, ${KEY('d')})`,
      ),
      T(
        'later',
        'desk',
        `select app.block_courts_for_event({{ra}}, ${block(['c1'])}, ${KEY('l')})`,
      ),
    ]);
    expect(refusal(r, 'scope')).toBe('PROTOCOL_NOT_FOUND');
    expect(refusal(r, 'inactive')).toBe('COURT_NOT_FOUND');
    expect(answer(r, 'degraded')).toBe(true);
    expect(refusal(r, 'soon')).toBe('DEGRADED_LOCKOUT');
    expect(answer<{ blocked: unknown[] }>(r, 'later').blocked).toHaveLength(1);
  });
});

describe.skipIf(!docker)('push keys, the switch, the desk list', () => {
  it("app.tournament_notify's c_keys are the tournament keys of _shared/guest-push.json", () => {
    const r = scenario('tl-keys', [
      Q(
        'src',
        `select to_jsonb(prosrc) from pg_proc where proname = 'tournament_notify'
                  and pronamespace = 'app'::regnamespace`,
      ),
    ]);
    const src = answer<string>(r, 'src');
    const m = /c_keys constant jsonb := '(\{[^']*\})'/.exec(src);
    expect(m, 'c_keys literal').not.toBeNull();
    const keys = JSON.parse(m![1]!) as Record<string, string>;
    const json = Object.fromEntries(
      Object.entries(guestPush.title_keys as Record<string, string>).filter(
        ([, kind]) => kind === 'tournament_update',
      ),
    );
    expect(keys).toEqual(json);
    expect(Object.keys(keys).sort()).toEqual(['tournament.cancelled', 'tournament.promoted']);
  });

  it('the owner switches a branch; the desk lists its tournaments with their blocks; the public list goes off', () => {
    const r = scenario('tl-switch', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { days: 3 }),
      ...PUBLISH('pub', 'r1', 't1'),
      T('mgr', 'manager', `select app.set_tournaments_enabled({{v}}, false)`),
      T('null', 'owner', `select app.set_tournaments_enabled({{v}}, null)`),
      T(
        'nil',
        'owner',
        `select app.set_tournaments_enabled('00000000-0000-4000-8000-000000000000', true)`,
      ),
      T(
        'desk_list',
        'prep',
        `select app.desk_tournaments({{v}}, now(), now() + interval '7 days')`,
      ),
      T(
        'desk_list_d',
        'desk',
        `select app.desk_tournaments({{v}}, now(), now() + interval '7 days')`,
      ),
      T('bad_range', 'desk', `select app.desk_tournaments({{v}}, now(), now() - interval '1 day')`),
      T('off', 'owner', `select app.set_tournaments_enabled({{v}}, false)`),
      E('pub_off', null, `select app.tournaments_public({{v}})`),
      E('one_off', null, `select app.tournament_public({{t1}})`),
      Q(
        'view',
        `select to_jsonb(tournaments_enabled) from venue_settings_public where venue_id = {{v}}::uuid`,
      ),
      T('on', 'owner', `select app.set_tournaments_enabled({{v}}, true)`),
      E('pub_on', null, `select app.tournaments_public({{v}})`),
    ]);
    expect(refusal(r, 'mgr')).toBe('FORBIDDEN');
    expect(refusal(r, 'null')).toBe('INVALID_ARGUMENT:p_enabled');
    expect(refusal(r, 'nil')).toBe('VENUE_MISMATCH');
    // prep has no staff_venues row at the branch: not in scope.
    expect(refusal(r, 'desk_list')).toBe('VENUE_MISMATCH');
    const list = answer(r, 'desk_list_d');
    expect(tourMissingKeys(list, TOURNAMENT_SHAPES.desk_tournaments)).toEqual([]);
    expect(list).toMatchObject({ tournaments_enabled: true });
    const rows = (list as { tournaments: Array<{ blocks: unknown[] }> }).tournaments;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.blocks).toHaveLength(4);
    expect(refusal(r, 'bad_range')).toBe('INVALID_ARGUMENT:p_to');
    expect(answer(r, 'off')).toEqual({ venue_id: expect.any(String), tournaments_enabled: false });
    expect(tourMissingKeys(answer(r, 'off'), TOURNAMENT_SHAPES.set_tournaments_enabled)).toEqual(
      [],
    );
    expect(answer(r, 'pub_off')).toEqual({ off: true });
    expect(answer(r, 'one_off')).toEqual({ missing: true });
    expect(answer(r, 'view')).toBe(false);
    expect(answer(r, 'pub_on')).toMatchObject({ off: false });
  });
});
