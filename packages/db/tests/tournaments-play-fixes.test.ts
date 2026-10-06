/**
 * 0311 tournaments_play_fixes (plan go-over-the-backend-partitioned-metcalfe §0311), one case per
 * finding:
 *
 *   * c32 a substitute takes the sit-out of a round already in play, and its credit;
 *   * c34 the swap moves the swapped match's revision: a score from the old screen is 'changed';
 *   * c33 a no-show without a substitute whose own match is scored while another court plays;
 *   * c35 a finished tournament's scores: a manager, a reason, within 48 hours;
 *   * c36 a Mexicano correction after the sweep's finish deletes no later round;
 *   * c37 a null expected revision, and points past smallint;
 *   * c38 a waitlisted substitute banned or deleted; starting below min_entries;
 *   * c26 set_rounds check 12 sit_out, inside a payload and against the rounds before it;
 *   * c27 a no-show leader ranks after every registered entry; the public row says withdrawn.
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker it skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { GUEST } from './matches-harness';
import { dockerReachable, KEEP, Q, scenario, T, X } from './stores-harness';
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

/** The id of round `round`'s match on the n-th court (court-id order), as text. */
const MATCH = (name: string, tour: string, round: number, nth = 0) =>
  KEEP(
    name,
    `select id::text from tournament_matches where tournament_id = {{${tour}}}::uuid and round_no = ${round}
      order by court_id offset ${nth} limit 1`,
  );

/** set_rounds as the desk with pg_temp.simple_rounds rewritten by `edit` (SQL over p). */
const EDITED = (label: string, tour: string, from: number, n: number, edit: string) => [
  KEEP(
    `${label}_p`,
    `select (select ${edit} from (select pg_temp.simple_rounds('${tour}', ${from}, ${n}) as p) x)::text`,
  ),
  T(
    label,
    'desk',
    `select app.tournament_set_rounds({{${tour}}}, {{${label}_p}}::jsonb, ${KEY(label)})`,
  ),
];

describe.skipIf(!docker)('mark_no_show (0311: c32, c33, c34, c38)', () => {
  it('c32/c34: the substitute takes a sit-out in play and its credit; the old screen is stale', () => {
    const r = scenario('tpf-sub', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 9 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 2 }),
      `select pg_temp.field('t1', 9, 'p');`,
      GUEST('w1'),
      T('w1_reg', 'w1', `select app.tournament_register({{t1}})`),
      KEEP('w1_e', `select id::text from tournament_entries where guest_id = {{w1}}::uuid`),
      `select pg_temp.close('t1');`,
      // 9 on 2 courts: round 1 sits p9, round 2 sits p1, round 3 sits p2.
      ...ROUNDS('sched', 't1', 1, 3),
      Q(
        'p1_sits_2',
        `select to_jsonb({{p1_e}}::uuid = any (bye_entry_ids)) from tournament_rounds
          where tournament_id = {{t1}}::uuid and round_no = 2`,
      ),
      // Round 2 is in play: one court scored.
      MATCH('m2a', 't1', 2),
      T(
        'score2a',
        'desk',
        `select app.tournament_score({{m2a}}, 12::smallint, 12::smallint, 0, null)`,
      ),
      // p1's round-3 match as a screen shows it before the swap.
      KEEP(
        'm3',
        `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 3
          and {{p1_e}}::uuid in (a1, a2, b1, b2)`,
      ),
      KEEP('m3_rev', `select revision::text from tournament_matches where id = {{m3}}::uuid`),
      T('sub', 'desk', `select app.tournament_mark_no_show({{p1_e}}, {{w1_e}}, null)`),
      Q(
        'round2_byes',
        `select jsonb_build_object('p1', {{p1_e}}::uuid = any (bye_entry_ids), 'w1', {{w1_e}}::uuid = any (bye_entry_ids))
           from tournament_rounds where tournament_id = {{t1}}::uuid and round_no = 2`,
      ),
      T(
        'stale',
        'desk',
        `select app.tournament_score({{m3}}, 20::smallint, 4::smallint, {{m3_rev}}::int, null)`,
      ),
      Q('rest2', `select to_jsonb(pg_temp.score_round('t1', 2, 10))`),
      Q(
        'credit',
        `select jsonb_object_agg(case s.entry_id when {{p1_e}}::uuid then 'p1' else 'w1' end, s.sat_out)
           from app.tournament_standings({{t1}}::uuid) s
          where s.entry_id in ({{p1_e}}::uuid, {{w1_e}}::uuid)`,
      ),
    ]);
    expect(answer(r, 'p1_sits_2')).toBe(true);
    expect(answer(r, 'score2a')).toMatchObject({ status: 'running' });
    expect(answer(r, 'sub')).toMatchObject({ status: 'no_show' });
    expect(answer(r, 'round2_byes')).toEqual({ p1: false, w1: true });
    expect(refusal(r, 'stale')).toBe('TOURNAMENT_SCORE_REFUSED:changed');
    expect(answer(r, 'rest2')).toBe(1);
    // p1 played round 1 (unscored), so it has no row; w1 holds the round-2 sit-out.
    expect(answer(r, 'credit')).toEqual({ w1: 1 });
  });

  it('c33: own match scored while another court plays: the later rounds go, no refusal', () => {
    const r = scenario('tpf-noshow', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('sched', 't1', 1, 3),
      KEEP(
        'm1',
        `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 1
          and {{p1_e}}::uuid in (a1, a2, b1, b2)`,
      ),
      T(
        'score1',
        'desk',
        `select app.tournament_score({{m1}}, 14::smallint, 10::smallint, 0, null)`,
      ),
      T('gone', 'desk', `select app.tournament_mark_no_show({{p1_e}}, null, null)`),
      Q(
        'rounds',
        `select jsonb_agg(round_no order by round_no) from tournament_rounds where tournament_id = {{t1}}::uuid`,
      ),
    ]);
    expect(answer(r, 'score1')).toMatchObject({ status: 'running' });
    expect(answer(r, 'gone')).toMatchObject({ status: 'no_show', removed_from_round: 2 });
    expect(answer(r, 'rounds')).toEqual([1]);
  });

  it('c38: a waitlisted substitute banned or deleted since joining is refused', () => {
    const r = scenario('tpf-subcheck', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { waitlist_max: 4 }),
      `select pg_temp.field('t1', 8, 'p');`,
      GUEST('w1'),
      GUEST('w2'),
      T('w1_reg', 'w1', `select app.tournament_register({{t1}})`),
      T('w2_reg', 'w2', `select app.tournament_register({{t1}})`),
      KEEP('w1_e', `select id::text from tournament_entries where guest_id = {{w1}}::uuid`),
      KEEP('w2_e', `select id::text from tournament_entries where guest_id = {{w2}}::uuid`),
      `select pg_temp.close('t1');`,
      ...ROUNDS('sched', 't1', 1, 2),
      `select pg_temp.ban('w1');`,
      X(`update profiles set deleted_at = now() where id = {{w2}}::uuid`),
      T('banned', 'desk', `select app.tournament_mark_no_show({{p1_e}}, {{w1_e}}, null)`),
      T('deleted', 'desk', `select app.tournament_mark_no_show({{p1_e}}, {{w2_e}}, null)`),
    ]);
    expect(refusal(r, 'banned')).toBe('MATCH_BANNED');
    expect(refusal(r, 'deleted')).toBe('INVALID_ARGUMENT:p_substitute_entry_id');
  });
});

describe.skipIf(!docker)('tournament_score (0311: c35, c36, c37)', () => {
  it('after the finish: a manager with a reason within 48 hours; no Mexicano round deleted', () => {
    const r = scenario('tpf-finished', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { format: 'mexicano', count: 8 }),
      ...PUBLISH('pub', 'r1', 't1', { rounds: 3, points_target: 24 }),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('rd1', 't1', 1, 1),
      Q('s1', `select to_jsonb(pg_temp.score_round('t1', 1, 14))`),
      ...ROUNDS('rd2', 't1', 2, 1),
      MATCH('m1', 't1', 1),
      // c37 while running.
      T(
        'null_rev',
        'desk',
        `select app.tournament_score({{m1}}, 12::smallint, 12::smallint, null, 'x')`,
      ),
      MATCH('m2', 't1', 2),
      T(
        'overflow',
        'desk',
        `select app.tournament_score({{m2}}, 32767::smallint, 1::smallint, 0, null)`,
      ),
      // The sweep's finish: round 2 drawn, unscored.
      X(`update tournaments set status = 'finished', finished_at = now() where id = {{t1}}::uuid`),
      T(
        'desk',
        'desk',
        `select app.tournament_score({{m1}}, 15::smallint, 9::smallint, 1, 'typo')`,
      ),
      T(
        'no_reason',
        'manager',
        `select app.tournament_score({{m1}}, 15::smallint, 9::smallint, 1, null)`,
      ),
      T(
        'fix',
        'manager',
        `select app.tournament_score({{m1}}, 15::smallint, 9::smallint, 1, 'typo')`,
      ),
      Q(
        'rounds',
        `select jsonb_agg(round_no order by round_no) from tournament_rounds where tournament_id = {{t1}}::uuid`,
      ),
      X(`update tournaments set finished_at = now() - interval '49 hours' where id = {{t1}}::uuid`),
      T(
        'late',
        'manager',
        `select app.tournament_score({{m1}}, 16::smallint, 8::smallint, 2, 'late')`,
      ),
    ]);
    expect(answer(r, 's1')).toBe(2);
    expect(refusal(r, 'null_rev')).toBe('INVALID_ARGUMENT:p_expected_revision');
    expect(refusal(r, 'overflow')).toBe('TOURNAMENT_SCORE_REFUSED:invalid');
    expect(refusal(r, 'desk')).toBe('FORBIDDEN:finished');
    expect(refusal(r, 'no_reason')).toBe('REASON_REQUIRED');
    expect(answer(r, 'fix')).toMatchObject({ status: 'finished', removed_from_round: null });
    expect(answer(r, 'rounds')).toEqual([1, 2]);
    expect(refusal(r, 'late')).toBe('TOURNAMENT_SCORE_REFUSED:closed');
  });
});

describe.skipIf(!docker)('tournament_set_rounds (0311: c26, c38)', () => {
  it('c26: a round sits out an entry who has sat out more than a player, in the payload or before it', () => {
    const r = scenario('tpf-sitout', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 6, 'p');`,
      `select pg_temp.close('t1');`,
      // Americano, 6 on 1 court: round 2 repeats round 1's two sit-outs.
      ...EDITED(
        'am_twice',
        't1',
        1,
        2,
        `jsonb_set(p, '{rounds,1}', jsonb_set(p->'rounds'->0, '{round_no}', '2'))`,
      ),
      ...ROUNDS('am_ok', 't1', 1, 3),
      // Mexicano, 5 on 1 court: round 2 sits round 1's sit-out again (counted from the table).
      RUN('r2', { format: 'mexicano', count: 8, days: 5 }),
      ...PUBLISH('pub2', 'r2', 't2', { rounds: 2 }),
      `select pg_temp.field('t2', 5, 'q');`,
      `select pg_temp.close('t2');`,
      ...ROUNDS('mx1', 't2', 1, 1),
      Q('mx_s1', `select to_jsonb(pg_temp.score_round('t2', 1, 12))`),
      KEEP(
        'mx1_round',
        `select jsonb_build_object('round_no', 2, 'sit_out', to_jsonb(r.bye_entry_ids),
                  'matches', (select jsonb_agg(jsonb_build_object('court_id', m.court_id, 'a', jsonb_build_array(m.a1, m.a2),
                                                                  'b', jsonb_build_array(m.b1, m.b2)))
                                from tournament_matches m where m.round_id = r.id))::text
           from tournament_rounds r where r.tournament_id = {{t2}}::uuid and r.round_no = 1`,
      ),
      ...EDITED('mx_again', 't2', 2, 1, `jsonb_set(p, '{rounds,0}', ({{mx1_round}})::jsonb)`),
      ...ROUNDS('mx2', 't2', 2, 1),
    ]);
    expect(refusal(r, 'am_twice')).toBe('TOURNAMENT_ROUNDS_INVALID:sit_out');
    expect(answer(r, 'am_ok')).toMatchObject({ rounds_planned: 3 });
    expect(answer(r, 'mx_s1')).toBe(1);
    expect(refusal(r, 'mx_again')).toBe('TOURNAMENT_ROUNDS_INVALID:sit_out');
    expect(answer(r, 'mx2')).toMatchObject({ rounds_planned: 2 });
  });

  it('c38: a closed tournament thinned below min_entries does not start', () => {
    const r = scenario('tpf-under', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 12 }),
      ...PUBLISH('pub', 'r1', 't1', { min_entries: 8 }),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      T('remove', 'desk', `select app.tournament_remove_entry({{p8_e}}, 'left')`),
      ...ROUNDS('start', 't1', 1, 2),
    ]);
    expect(answer(r, 'remove')).toBeTruthy();
    expect(refusal(r, 'start')).toBe('TOURNAMENT_UNDER_FILLED:7/8');
  });
});

describe.skipIf(!docker)('standings (0311: c27)', () => {
  it('a no-show leader ranks after every registered entry; the public row says withdrawn', () => {
    const r = scenario('tpf-rank', [
      TOUR_SETUP,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('sched', 't1', 1, 2),
      Q('s1', `select to_jsonb(pg_temp.score_round('t1', 1, 20))`),
      KEEP(
        'leader',
        `select entry_id::text from app.tournament_standings({{t1}}::uuid) order by rank, entry_id limit 1`,
      ),
      X(
        `update tournament_entries set status = 'no_show', no_show_at = now() where id = {{leader}}::uuid`,
      ),
      Q(
        'ranks',
        `select jsonb_agg(jsonb_build_object('rank', s.rank, 'leader', s.entry_id = {{leader}}::uuid,
                                             'withdrawn', s.withdrawn) order by x.ord)
           from app.tournament_standings({{t1}}::uuid) with ordinality x(entry_id, rank, points_won, points_against,
                                                                         diff, h2h, played, sat_out, withdrawn, ord)
           cross join lateral (select x.entry_id, x.rank, x.withdrawn) s`,
      ),
      T('public', 'p1', `select app.tournament_public({{t1}})`),
    ]);
    expect(answer(r, 's1')).toBe(2);
    const ranks = answer<Array<{ rank: number; leader: boolean; withdrawn: boolean }>>(r, 'ranks');
    expect(ranks).toHaveLength(8);
    expect(ranks[7]).toEqual({ rank: 8, leader: true, withdrawn: true });
    expect(ranks[0]!.rank).toBe(1);
    expect(ranks.slice(0, 7).every((x) => !x.withdrawn && x.rank <= 7)).toBe(true);
    const pub = answer<{ standings: Array<{ rank: number; withdrawn: boolean }> }>(r, 'public');
    expect(pub.standings.at(-1)).toMatchObject({ rank: 8, withdrawn: true });
  });
});
