/**
 * tournaments_play (docs/design/tournaments/build-contracts-2026-10-03.md §1.5, §1.6, §1.8, §1.9,
 * §1.10; TD-7–TD-11):
 *
 *   * tournament_set_rounds: one refusal per detail of §1.9 in its order (and the payload shape),
 *     the Americano schedule (seeds, rounds_planned, running, the revision), a regeneration, the
 *     Mexicano one round at a time after a scored round;
 *   * tournament_score: the sum rule, a changed revision, a correction's reason, the audit rows,
 *     the Mexicano correction that deletes the unscored later rounds or is locked by a scored
 *     one, the finish that frees the future blocks, corrections after it;
 *   * tournament_mark_no_show with a waitlisted substitute (swapped in place), with none (the
 *     unplayed rounds deleted, or refused once one has a score), its argument refusals;
 *   * the reads: desk_tournament_detail and tournament_public against TOURNAMENT_SHAPES, the
 *     public "First I." names, "Player n" for a desk-added profile without terms, nothing private.
 *
 * Standings parity with core's rankStandings is tournament-rounds.test.ts. Every case is one
 * rolled-back psql transaction (stores-harness); without docker the suite skips.
 */
import { describe, expect, it } from 'vitest';
import {
  TOURNAMENT_SHAPES,
  TOUR_PUBLIC_FORBIDDEN_KEYS,
  tourMissingKeys,
} from '../../core/src/tournaments';
import { stackAvailable } from './helpers';
import { E, GUEST } from './matches-harness';
import { dockerReachable, KEEP, MK, Q, scenario, T, X } from './stores-harness';
import {
  answer,
  KEY,
  PUBLISH,
  refusal,
  ROUNDS,
  RUN,
  TOUR_BRANCH,
  TOUR_SETUP,
} from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();
const NIL = '00000000-0000-4000-8000-000000000000';

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

/** set_rounds with a payload kept as `payload`, rewritten by `edit` (SQL over p). */
const SUBMIT = (label: string, tour: string, payload: string, edit = 'p', who = 'desk') =>
  T(
    label,
    who,
    `select app.tournament_set_rounds({{${tour}}},
    (select ${edit} from (select ({{${payload}}})::jsonb as p) x), ${KEY(label)})`,
  );

describe.skipIf(!docker)('tournament_set_rounds (§1.9)', () => {
  it('refuses one detail at a time in order, writes the Americano schedule and regenerates', () => {
    const r = scenario('tp-rounds', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 12 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 9, 'p');`,
      KEEP('open_p', `select pg_temp.simple_rounds('t1', 1, 8)::text`),
      SUBMIT('open', 't1', 'open_p'),
      `select pg_temp.close('t1');`,
      KEEP('p8', `select pg_temp.simple_rounds('t1', 1, 8)::text`),
      T(
        'cashier',
        'cashier',
        `select app.tournament_set_rounds({{t1}}, {{p8}}::jsonb, ${KEY('c')})`,
      ),
      T('nil', 'desk', `select app.tournament_set_rounds('${NIL}', {{p8}}::jsonb, ${KEY('n')})`),
      T('no_key', 'desk', `select app.tournament_set_rounds({{t1}}, {{p8}}::jsonb, null)`),
      T('shape', 'desk', `select app.tournament_set_rounds({{t1}}, '{}'::jsonb, ${KEY('s')})`),
      SUBMIT('shape_team', 't1', 'p8', `jsonb_set(p, '{rounds,0,matches,0,a}', '["x"]')`),
      SUBMIT('stale', 't1', 'p8', `jsonb_set(p, '{based_on_revision}', '7')`),
      SUBMIT('engine', 't1', 'p8', `jsonb_set(p, '{engine}', '"tp-tour-0"')`),
      SUBMIT('format', 't1', 'p8', `jsonb_set(p, '{format}', '"mexicano"')`),
      SUBMIT('numbering', 't1', 'p8', `jsonb_set(p, '{from_round}', '2')`),
      SUBMIT('numbering_gap', 't1', 'p8', `jsonb_set(p, '{rounds,1,round_no}', '5')`),
      SUBMIT('seat', 't1', 'p8', `jsonb_set(p, '{rounds,0,sit_out}', jsonb_build_array('${NIL}'))`),
      SUBMIT(
        'seat_dup',
        't1',
        'p8',
        `jsonb_set(p, '{rounds,2,sit_out}', p->'rounds'->2->'matches'->0->'a'->0 || '[]'::jsonb)`,
      ),
      SUBMIT('court', 't1', 'p8', `jsonb_set(p, '{rounds,0,matches,0,court_id}', '"${NIL}"')`),
      SUBMIT(
        'court_dup',
        't1',
        'p8',
        `jsonb_set(p, '{rounds,0,matches,1,court_id}', p->'rounds'->0->'matches'->0->'court_id')`,
      ),
      // Everyone sits out round 1 (built as postgres: the caller reads no table).
      KEEP(
        'p_cu',
        `select jsonb_set(({{p8}})::jsonb, '{rounds,0}', jsonb_build_object('round_no', 1, 'matches', '[]'::jsonb,
          'sit_out', (select jsonb_agg(e.id) from tournament_entries e where e.tournament_id = {{t1}}::uuid
                                                                   and e.status = 'registered')))::text`,
      ),
      SUBMIT('courts_used', 't1', 'p_cu'),
      KEEP('k1', `select 'tp-rounds-k1-' || gen_random_uuid()`),
      T('ok', 'desk', `select app.tournament_set_rounds({{t1}}, {{p8}}::jsonb, {{k1}})`),
      T('replay', 'desk', `select app.tournament_set_rounds({{t1}}, {{p8}}::jsonb, {{k1}})`),
      Q(
        'after',
        `select jsonb_build_object(
                    'status', t.status, 'revision', t.revision, 'planned', t.rounds_planned,
                    'rounds', (select count(*) from tournament_rounds r where r.tournament_id = t.id),
                    'matches', (select count(*) from tournament_matches m where m.tournament_id = t.id),
                    'seeds', (select jsonb_agg(e.seed_no order by e.seed_no) from tournament_entries e
                               where e.tournament_id = t.id))
                    from tournaments t where t.id = {{t1}}::uuid`,
      ),
      Q('score1', `select to_jsonb(pg_temp.score_round('t1', 1, 14))`),
      ...ROUNDS('played', 't1', 1, 8),
      ...ROUNDS('regen', 't1', 3, 5),
      Q(
        'regen_after',
        `select jsonb_build_object('planned', t.rounds_planned,
                          'rounds', (select jsonb_agg(r.round_no order by r.round_no) from tournament_rounds r
                                      where r.tournament_id = t.id))
                          from tournaments t where t.id = {{t1}}::uuid`,
      ),
    ]);
    expect(refusal(r, 'open')).toBe('TOURNAMENT_ROUNDS_INVALID:status');
    expect(refusal(r, 'cashier')).toBe('FORBIDDEN');
    expect(refusal(r, 'nil')).toBe('TOURNAMENT_NOT_FOUND');
    expect(refusal(r, 'no_key')).toBe('INVALID_ARGUMENT:p_idempotency_key');
    expect(refusal(r, 'shape')).toBe('INVALID_ARGUMENT:p_payload');
    expect(refusal(r, 'shape_team')).toBe('INVALID_ARGUMENT:p_payload');
    for (const d of ['stale', 'engine', 'format', 'numbering', 'seat', 'court', 'courts_used']) {
      expect(refusal(r, d), d).toBe(`TOURNAMENT_ROUNDS_INVALID:${d}`);
    }
    expect(refusal(r, 'numbering_gap')).toBe('TOURNAMENT_ROUNDS_INVALID:numbering');
    expect(refusal(r, 'seat_dup')).toBe('TOURNAMENT_ROUNDS_INVALID:seat');
    expect(refusal(r, 'court_dup')).toBe('TOURNAMENT_ROUNDS_INVALID:court');

    const ok = answer(r, 'ok');
    expect(tourMissingKeys(ok, TOURNAMENT_SHAPES.tournament_set_rounds)).toEqual([]);
    expect(ok).toMatchObject({
      duplicate: false,
      revision: 1,
      rounds_planned: 8,
      status: 'running',
    });
    expect(answer(r, 'replay')).toMatchObject({ duplicate: true, revision: 1 });
    expect(answer(r, 'after')).toEqual({
      status: 'running',
      revision: 1,
      planned: 8,
      rounds: 8,
      matches: 16,
      seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });
    expect(answer(r, 'score1')).toBe(2);
    expect(refusal(r, 'played')).toBe('TOURNAMENT_ROUNDS_INVALID:played');
    expect(answer(r, 'regen')).toMatchObject({ rounds_planned: 7, status: 'running' });
    expect(answer(r, 'regen_after')).toEqual({ planned: 7, rounds: [1, 2, 3, 4, 5, 6, 7] });
  });

  it('Mexicano: one round at a time, within the plan, after a fully scored round', () => {
    const r = scenario('tp-mex', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { format: 'mexicano', count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { rounds: 2 }),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('two', 't1', 1, 2),
      ...ROUNDS('r1', 't1', 1, 1),
      ...ROUNDS('r2_open', 't1', 2, 1),
      Q('s1', `select to_jsonb(pg_temp.score_round('t1', 1, 15))`),
      ...ROUNDS('r2', 't1', 2, 1),
      ...ROUNDS('r3', 't1', 3, 1),
    ]);
    expect(refusal(r, 'two')).toBe('TOURNAMENT_ROUNDS_INVALID:mexicano_one');
    expect(answer(r, 'r1')).toMatchObject({ rounds_planned: 2, status: 'running' });
    expect(refusal(r, 'r2_open')).toBe('TOURNAMENT_ROUNDS_INVALID:round_open');
    expect(answer(r, 's1')).toBe(2);
    expect(answer(r, 'r2')).toMatchObject({ rounds_planned: 2 });
    expect(refusal(r, 'r3')).toBe('TOURNAMENT_ROUNDS_INVALID:mexicano_one');
  });
});

describe.skipIf(!docker)('tournament_score (T-5, TD-9, TD-11)', () => {
  it('scores, corrects with a reason, removes later Mexicano rounds or locks, and finishes', () => {
    const r = scenario('tp-score', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { format: 'mexicano', count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { rounds: 2, points_target: 24 }),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('r1', 't1', 1, 1),
      KEEP(
        'm1',
        `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 1
                   order by court_id limit 1`,
      ),
      KEEP(
        'm1b',
        `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 1
                    order by court_id offset 1 limit 1`,
      ),
      T(
        'cashier',
        'cashier',
        `select app.tournament_score({{m1}}, 12::smallint, 12::smallint, 0, null)`,
      ),
      T(
        'nil',
        'desk',
        `select app.tournament_score('${NIL}', 12::smallint, 12::smallint, 0, null)`,
      ),
      T('sum', 'desk', `select app.tournament_score({{m1}}, 12::smallint, 11::smallint, 0, null)`),
      T(
        'neg',
        'desk',
        `select app.tournament_score({{m1}}, (-1)::smallint, 25::smallint, 0, null)`,
      ),
      T(
        'changed',
        'desk',
        `select app.tournament_score({{m1}}, 12::smallint, 12::smallint, 3, null)`,
      ),
      T('first', 'desk', `select app.tournament_score({{m1}}, 16::smallint, 8::smallint, 0, null)`),
      T(
        'no_reason',
        'desk',
        `select app.tournament_score({{m1}}, 15::smallint, 9::smallint, 1, null)`,
      ),
      T(
        'second',
        'desk',
        `select app.tournament_score({{m1b}}, 0::smallint, 24::smallint, 0, null)`,
      ),
      ...ROUNDS('r2', 't1', 2, 1),
      // A correction of round 1 while round 2 is unscored: round 2 goes.
      T('fix', 'desk', `select app.tournament_score({{m1}}, 15::smallint, 9::smallint, 1, 'typo')`),
      Q(
        'rounds_after_fix',
        `select jsonb_agg(round_no order by round_no) from tournament_rounds where tournament_id = {{t1}}::uuid`,
      ),
      Q(
        'events',
        `select jsonb_agg(jsonb_build_object('before', points_a_before, 'a', points_a, 'reason', reason)
                                    order by points_a_before is not null, at)
                     from tournament_score_events where match_id = {{m1}}::uuid`,
      ),
      ...ROUNDS('r2b', 't1', 2, 1),
      Q('s2', `select to_jsonb(pg_temp.score_round('t1', 2, 13))`),
      Q(
        'finished',
        `select jsonb_build_object('status', t.status, 'finished', t.finished_at is not null,
                       'blocks', (select jsonb_agg(distinct r.status) from reservations r
                                   where r.protocol_run_id = t.protocol_run_id))
                       from tournaments t where t.id = {{t1}}::uuid`,
      ),
      // Round 2 has scores: a correction of round 1 is locked; round 2 itself may still be corrected.
      KEEP('m1_rev', `select revision::text from tournament_matches where id = {{m1}}::uuid`),
      T(
        'locked',
        'desk',
        `select app.tournament_score({{m1}}, 14::smallint, 10::smallint, {{m1_rev}}::int, 'late fix')`,
      ),
      KEEP(
        'm2',
        `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 2
                   order by court_id limit 1`,
      ),
      KEEP('m2_rev', `select revision::text from tournament_matches where id = {{m2}}::uuid`),
      T(
        'after_finish',
        'desk',
        `select app.tournament_score({{m2}}, 20::smallint, 4::smallint, {{m2_rev}}::int, 'scorer')`,
      ),
      Q('standings', `select jsonb_agg(to_jsonb(s)) from app.tournament_standings({{t1}}::uuid) s`),
      X(`update tournaments set status = 'closed' where id = {{t1}}::uuid`),
      T('status', 'desk', `select app.tournament_score({{m2}}, 20::smallint, 4::smallint, 2, 'x')`),
    ]);
    expect(refusal(r, 'cashier')).toBe('FORBIDDEN');
    expect(refusal(r, 'nil')).toBe('TOURNAMENT_NOT_FOUND');
    expect(refusal(r, 'sum')).toBe('TOURNAMENT_SCORE_REFUSED:invalid');
    expect(refusal(r, 'neg')).toBe('TOURNAMENT_SCORE_REFUSED:invalid');
    expect(refusal(r, 'changed')).toBe('TOURNAMENT_SCORE_REFUSED:changed');
    const first = answer(r, 'first');
    expect(tourMissingKeys(first, TOURNAMENT_SHAPES.tournament_score)).toEqual([]);
    expect(first).toMatchObject({
      revision: 1,
      tournament_revision: 2,
      removed_from_round: null,
      status: 'running',
    });
    expect(refusal(r, 'no_reason')).toBe('REASON_REQUIRED');
    expect(answer(r, 'second')).toMatchObject({ revision: 1, status: 'running' });
    expect(answer(r, 'fix')).toMatchObject({ revision: 2, removed_from_round: 2 });
    expect(answer(r, 'rounds_after_fix')).toEqual([1]);
    expect(answer(r, 'events')).toEqual([
      { before: null, a: 16, reason: null },
      { before: 16, a: 15, reason: 'typo' },
    ]);
    expect(answer(r, 's2')).toBe(2);
    expect(answer(r, 'finished')).toEqual({
      status: 'finished',
      finished: true,
      blocks: ['cancelled'],
    });
    expect(refusal(r, 'locked')).toBe('TOURNAMENT_SCORE_REFUSED:locked');
    expect(answer(r, 'after_finish')).toMatchObject({ status: 'finished' });
    const st = answer<Array<{ rank: number; points_won: number; played: number }>>(r, 'standings');
    expect(st).toHaveLength(8);
    for (const row of st)
      expect(
        tourMissingKeys(row, TOURNAMENT_SHAPES.desk_tournament_detail.nested['standings[]']),
      ).toEqual([]);
    expect(st.every((x) => x.played === 2)).toBe(true);
    expect(refusal(r, 'status')).toBe('TOURNAMENT_SCORE_REFUSED:status');
  });
});

describe.skipIf(!docker)('tournament_mark_no_show (T-7)', () => {
  it('swaps a waitlisted substitute into the unplayed matches; without one, deletes the unplayed rounds or refuses', () => {
    const r = scenario('tp-noshow', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      `select pg_temp.field('t1', 8, 'p');`,
      GUEST('w1'),
      T('w1_reg', 'w1', `select app.tournament_register({{t1}})`),
      KEEP('w1_e', `select id::text from tournament_entries where guest_id = {{w1}}::uuid`),
      `select pg_temp.close('t1');`,
      T('both', 'desk', `select app.tournament_mark_no_show({{p1_e}}, {{w1_e}}, {{w1}})`),
      T('nil', 'desk', `select app.tournament_mark_no_show('${NIL}', null, null)`),
      T('not_reg', 'desk', `select app.tournament_mark_no_show({{w1_e}}, null, null)`),
      T('bad_sub', 'desk', `select app.tournament_mark_no_show({{p1_e}}, {{p2_e}}, null)`),
      ...ROUNDS('sched', 't1', 1, 5),
      Q('s1', `select to_jsonb(pg_temp.score_round('t1', 1, 12))`),
      T('sub', 'desk', `select app.tournament_mark_no_show({{p1_e}}, {{w1_e}}, null)`),
      Q(
        'p1_left',
        `select jsonb_build_object(
                      'played', (select count(*) from tournament_matches m where m.tournament_id = {{t1}}::uuid
                                   and {{p1_e}}::uuid in (m.a1, m.a2, m.b1, m.b2) and m.points_a is not null),
                      'unplayed', (select count(*) from tournament_matches m where m.tournament_id = {{t1}}::uuid
                                     and {{p1_e}}::uuid in (m.a1, m.a2, m.b1, m.b2) and m.points_a is null),
                      'sub_in', (select count(*) from tournament_matches m where m.tournament_id = {{t1}}::uuid
                                   and {{w1_e}}::uuid in (m.a1, m.a2, m.b1, m.b2)),
                      'sub', (select jsonb_build_object('status', e.status, 'for', e.substitute_for = {{p1_e}}::uuid,
                                                        'seed', e.seed_no)
                                from tournament_entries e where e.id = {{w1_e}}::uuid))`,
      ),
      // Without a substitute: p2 sits in rounds 2..5 (unscored): they go.
      T('no_sub', 'desk', `select app.tournament_mark_no_show({{p2_e}}, null, null)`),
      Q(
        'rounds',
        `select jsonb_agg(round_no order by round_no) from tournament_rounds where tournament_id = {{t1}}::uuid`,
      ),
      // A round with a score after the entry's first unplayed one: refused.
      ...ROUNDS('sched2', 't1', 2, 2),
      KEEP(
        'm3',
        `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 3
                   order by court_id limit 1`,
      ),
      T(
        'score3',
        'desk',
        `select app.tournament_score({{m3}}, 12::smallint, 12::smallint, 0, null)`,
      ),
      KEEP(
        'who2',
        `select x.id::text from tournament_entries x
                     where x.tournament_id = {{t1}}::uuid and x.status = 'registered'
                       and exists (select 1 from tournament_matches m where m.tournament_id = x.tournament_id
                                     and m.round_no = 2 and x.id in (m.a1, m.a2, m.b1, m.b2))
                     order by x.seed_no limit 1`,
      ),
      T('played', 'desk', `select app.tournament_mark_no_show({{who2}}, null, null)`),
    ]);
    expect(refusal(r, 'both')).toBe('INVALID_ARGUMENT:substitute');
    expect(refusal(r, 'nil')).toBe('TOURNAMENT_ENTRY_NOT_FOUND');
    expect(refusal(r, 'not_reg')).toBe('INVALID_ARGUMENT:entry_status');
    expect(refusal(r, 'bad_sub')).toBe('TOURNAMENT_ENTRY_NOT_FOUND');
    expect(answer(r, 's1')).toBe(2);
    const sub = answer(r, 'sub');
    expect(tourMissingKeys(sub, TOURNAMENT_SHAPES.tournament_mark_no_show)).toEqual([]);
    expect(sub).toMatchObject({ status: 'no_show', removed_from_round: null });
    const left = answer<{
      played: number;
      unplayed: number;
      sub_in: number;
      sub: Record<string, unknown>;
    }>(r, 'p1_left');
    expect(left.unplayed).toBe(0);
    expect(left.sub_in).toBeGreaterThan(0);
    expect(left.sub).toEqual({ status: 'registered', for: true, seed: 9 });
    expect(answer(r, 'no_sub')).toMatchObject({
      status: 'no_show',
      substitute_entry_id: null,
      removed_from_round: 2,
    });
    expect(answer(r, 'rounds')).toEqual([1]);
    expect(answer(r, 'score3')).toMatchObject({ status: 'running' });
    expect(refusal(r, 'played')).toBe('TOURNAMENT_ROUNDS_INVALID:played');
  });
});

describe.skipIf(!docker)('the reads (§1.8)', () => {
  it('desk_tournament_detail and tournament_public carry their keys; public names are First I., never private', () => {
    const r = scenario('tp-reads', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8, fee: 10000 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 7, 'p');`,
      GUEST('walk', '{"phone": null, "terms": null, "gender": null}'),
      T('walk', 'desk', `select app.tournament_add_entry({{t1}}, {{walk}})`),
      E('before', null, `select app.tournament_public({{t1}})`),
      `select pg_temp.close('t1');`,
      ...ROUNDS('sched', 't1', 1, 3),
      Q('s1', `select to_jsonb(pg_temp.score_round('t1', 1, 14))`),
      T('detail', 'cashier', `select app.desk_tournament_detail({{t1}})`),
      T('detail_mgr', 'manager', `select app.desk_tournament_detail({{t1}})`),
      T('detail_nil', 'desk', `select app.desk_tournament_detail('${NIL}')`),
      // The entries carry names and phones: the till and court roles only (desk_lesson_detail's).
      MK('prep_x', 'prep'),
      MK('driver_x', 'driver'),
      T('detail_prep', 'prep_x', `select app.desk_tournament_detail({{t1}})`),
      T('detail_driver', 'driver_x', `select app.desk_tournament_detail({{t1}})`),
      // The function's own order (ties by seed), as postgres.
      Q('fn_order', `select jsonb_agg(s.entry_id) from app.tournament_standings({{t1}}::uuid) s`),
      E('anon', null, `select app.tournament_public({{t1}})`),
      T('p1', 'p1', `select app.tournament_public({{t1}})`),
      E('nil', null, `select app.tournament_public('${NIL}')`),
      E('null', null, `select app.tournament_public(null)`),
    ]);
    const before = answer<{ rounds: unknown[]; standings: unknown[] }>(r, 'before');
    expect(before.rounds).toEqual([]);
    expect(before.standings).toEqual([]);

    const detail = answer<Record<string, unknown>>(r, 'detail');
    expect(tourMissingKeys(detail, TOURNAMENT_SHAPES.desk_tournament_detail)).toEqual([]);
    expect(detail.can).toEqual({
      add: false,
      set_rounds: false,
      score: false,
      cancel: false,
      close: false,
      finish: false,
      settle: true,
    });
    expect(answer(r, 'detail_mgr')).toMatchObject({
      // 0310 (c25): no desk add while running; a manager may finish it early (c28).
      can: {
        add: false,
        set_rounds: true,
        score: true,
        cancel: true,
        close: false,
        finish: true,
        settle: true,
      },
    });
    const entries = detail.entries as Array<{ owed_iqd: number; seed_no: number; status: string }>;
    expect(entries).toHaveLength(8);
    expect(entries.map((e) => e.seed_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(entries.every((e) => e.owed_iqd === 10000)).toBe(true);
    expect((detail.rounds as unknown[]).length).toBe(3);
    expect((detail.courts as unknown[]).length).toBe(4);
    expect(refusal(r, 'detail_nil')).toBe('TOURNAMENT_NOT_FOUND');
    expect(refusal(r, 'detail_prep')).toBe('FORBIDDEN');
    expect(refusal(r, 'detail_driver')).toBe('FORBIDDEN');
    // Round 1 scored: partners tie on every key, so their order is the seed's, as in the function.
    const standings = detail.standings as Array<{ entry_id: string; rank: number }>;
    expect(standings.map((s) => s.entry_id)).toEqual(answer(r, 'fn_order'));
    const seedOf = new Map(
      (detail.entries as Array<{ entry_id: string; seed_no: number }>).map((e) => [
        e.entry_id,
        e.seed_no,
      ]),
    );
    const ties = standings.filter((s, i) => i > 0 && s.rank === standings[i - 1]!.rank);
    expect(ties.length).toBeGreaterThan(0);
    for (const [i, s] of standings.entries()) {
      if (i > 0 && s.rank === standings[i - 1]!.rank) {
        expect(seedOf.get(s.entry_id)!).toBeGreaterThan(seedOf.get(standings[i - 1]!.entry_id)!);
      }
    }

    const pub = answer<{
      rounds: Array<{
        matches: Array<{ court_no: number; a: Array<{ name: string | null; no: number }> }>;
      }>;
      standings: Array<{ player: { name: string | null; former: boolean; no: number } }>;
      me: unknown;
    }>(r, 'anon');
    expect(tourMissingKeys(pub, TOURNAMENT_SHAPES.tournament_public)).toEqual([]);
    expect(pub.me).toBeNull();
    const keys = keysOf(pub);
    for (const k of TOUR_PUBLIC_FORBIDDEN_KEYS) expect(keys, k).not.toContain(k);
    expect(pub.rounds[0]!.matches.map((m) => m.court_no)).toEqual([1, 2]);
    const names = pub.standings.map((s) => s.player);
    expect(names).toHaveLength(8);
    // The public order is the desk's (no is the seed).
    expect(names.map((p) => p.no)).toEqual(standings.map((s) => seedOf.get(s.entry_id)));
    // The seven field entries are "PlayerN F."; the desk's walk-in has no terms: name null.
    expect(names.filter((p) => p.name !== null).every((p) => /^Player\d F\.$/.test(p.name!))).toBe(
      true,
    );
    expect(names.filter((p) => p.name === null)).toEqual([
      { name: null, former: false, no: expect.any(Number) },
    ]);
    expect(answer(r, 'p1')).toMatchObject({ me: { status: 'registered', owed_iqd: 10000 } });
    expect(answer(r, 'nil')).toEqual({ missing: true });
    expect(answer(r, 'null')).toEqual({ missing: true });
    expect(answer(r, 'walk')).toMatchObject({ status: 'registered' });
  });
});
