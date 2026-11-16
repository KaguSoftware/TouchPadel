/**
 * 0443 ranks_touch_level + 0444 ranks_boards: the ranking rules (docs/design/ranks/plan-2026-11-13.md).
 *
 *   * the Touch Level moves by the result against what the pairs' levels expected: an upset moves
 *     both pairs (capped at max_move), an expected win moves nothing, a win never lowers a level
 *     and a loss never raises one; the same four players again count half, then nothing;
 *   * a Level check (staff_set_customer_level) sets the class's start level, once per check_days,
 *     only for roles the rules allow, at most check_max_change on a settled player; the checks list
 *     says which applied;
 *   * a void replays everyone (the level goes back);
 *   * the rules: owner only, unknown key / bad value / contradictions refused, a value equal to its
 *     default is not kept, the headline switch reaches the board;
 *   * the boards: the Touch Level board shows reliable players only, the Race counts the best N
 *     results, boosts stop at boost_max_per_season, my_ranks says "higher than X%";
 *   * results to check: the same two pairs with the winner flipped inside 7 days.
 *
 * Every case is one rolled-back psql transaction (stores-harness); without docker it skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { SETUP } from './matches-harness';
import { dockerReachable, Q, scenario, T, type Results } from './stores-harness';
import { answer, refusal } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** The leaderboard on, period all, the default rules; players with a sign-up level; a results writer. */
const TL = String.raw`
update ranks_settings set enabled = true, period = 'all', board_size = 10, count_reported = true,
                          count_tournaments = true, rules = '{}'::jsonb where id;
insert into pg_temp.vars values ('_tl', substr(md5(random()::text), 1, 5));

-- A guest with a username and a sign-up level, kept as <name>.
create function pg_temp.pl(p_name text, p_level text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  v := pg_temp.guest(p_name, jsonb_build_object('given', 'Tl' || p_name, 'family', 'Zed'));
  update profiles set username = 'tl' || pg_temp.var('_tl') || p_name, play_level = p_level where id = v;
  return v;
end $f$;

-- A confirmed desk result played p_days_ago days ago (the statement trigger replays the levels).
create function pg_temp.g(p_a1 text, p_a2 text, p_b1 text, p_b2 text, p_winner text, p_score text,
                          p_days_ago numeric) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into game_results (venue_id, source, status, a1, a2, b1, b2, winner, score, played_at, reported_by, decided_at)
  values (pg_temp.var('venue')::uuid, 'desk', 'confirmed', pg_temp.var(p_a1)::uuid, pg_temp.var(p_a2)::uuid,
          pg_temp.var(p_b1)::uuid, pg_temp.var(p_b2)::uuid, p_winner, p_score,
          now() - make_interval(secs => p_days_ago * 86400), pg_temp.var(p_a1)::uuid, now())
  returning id into v;
  return v;
end $f$;

-- A player's Touch Level now, rounded to 3 places.
create function pg_temp.lv(p_name text) returns jsonb language sql as $f$
  select to_jsonb(round(l.level, 3)) from ranks_player_levels l where l.profile_id = pg_temp.var(p_name)::uuid
$f$;
`;

const BASE = [SETUP, TL];
const PL = (name: string, level: string) => `select pg_temp.pl('${name}', '${level}');`;
const G = (a1: string, a2: string, b1: string, b2: string, winner: string, score: string | null, daysAgo: number) =>
  `select pg_temp.g('${a1}', '${a2}', '${b1}', '${b2}', '${winner}', ${score === null ? 'null' : `'${score}'`}, ${daysAgo});`;
const LV = (label: string, name: string) => Q(label, `select pg_temp.lv('${name}')`);
const RULES = (json: string) => `update ranks_settings set rules = '${json}'::jsonb where id; select app.ranks_rebuild();`;

function code(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail: ${JSON.stringify(o!.data)}`).toBe(false);
  return o!.code!;
}

describe.skipIf(!docker)('0443 Touch Level: how a game moves it', () => {
  it('an upset moves both pairs, an expected win moves nothing, wins never lower and losses never raise', () => {
    const r = scenario('tl-move', [
      ...BASE,
      PL('s1', 'advanced'), PL('s2', 'advanced'), PL('w1', 'beginner'), PL('w2', 'beginner'),
      PL('u1', 'beginner'), PL('u2', 'beginner'),
      // The strong pair beats a weak pair as expected (a 75% games share, below the 99% expected).
      G('s1', 's2', 'w1', 'w2', 'a', '6-2, 6-2', 3),
      LV('s1_after_win', 's1'), LV('w1_after_loss', 'w1'),
      // A weak pair beats the strong pair: the biggest move, capped at max_move 0.25.
      G('u1', 'u2', 's1', 's2', 'a', '7-6, 7-6', 2),
      LV('u1', 'u1'), LV('s1', 's1'),
      Q('scores', `select jsonb_agg(jsonb_build_object('won', s.won, 'before', s.level_before, 'after', s.level_after)
                                     order by s.played_at)
                     from ranks_result_scores s where s.profile_id = pg_temp.var('s1')::uuid`),
    ]);
    expect(answer(r, 's1_after_win')).toBe(4.5);
    expect(answer(r, 'w1_after_loss')).toBe(2);
    expect(answer(r, 'u1')).toBe(2.25);
    expect(answer(r, 's1')).toBe(4.25);
    expect(answer(r, 'scores')).toEqual([
      { won: 'won', before: 4.5, after: 4.5 },
      { won: 'lost', before: 4.5, after: 4.25 },
    ]);
  });

  it('the same four players again count half from the 3rd game and nothing from the 5th', () => {
    const r = scenario('tl-repeat', [
      ...BASE,
      PL('a', 'intermediate'), PL('b', 'intermediate'), PL('c', 'intermediate'), PL('d', 'intermediate'),
      // Settled K so no game hits max_move: provisional_games 0, settling_games 0.
      RULES('{"provisional_games": 0, "settling_games": 0, "k_settled": 0.2}'),
      G('a', 'b', 'c', 'd', 'a', null, 6), G('a', 'b', 'c', 'd', 'a', null, 5), G('a', 'b', 'c', 'd', 'a', null, 4),
      G('a', 'b', 'c', 'd', 'a', null, 3), G('a', 'b', 'c', 'd', 'a', null, 2),
      Q('gains', `select jsonb_agg(round(s.level_after - s.level_before, 3) order by s.played_at)
                    from ranks_result_scores s where s.profile_id = pg_temp.var('a')::uuid`),
    ]);
    const g = answer<number[]>(r, 'gains');
    expect(g).toHaveLength(5);
    expect(g[0]).toBeGreaterThan(0);
    expect(g[1]).toBeGreaterThan(0);
    // Half the K from the 3rd game (the gap has grown since, so a little less than half of game 2's).
    expect(g[2]).toBeGreaterThan(0);
    expect(g[2]).toBeLessThan(g[1]! * 0.6);
    expect(g[3]).toBeGreaterThan(0);
    expect(g[4]).toBe(0);
  });

  it('a void replays everyone: the level goes back', () => {
    const r = scenario('tl-void', [
      ...BASE,
      PL('s1', 'advanced'), PL('s2', 'advanced'), PL('u1', 'beginner'), PL('u2', 'beginner'),
      `insert into pg_temp.vars values ('upset', pg_temp.g('u1', 'u2', 's1', 's2', 'a', '7-6, 7-6', 1)::text);`,
      LV('before', 'u1'),
      T('void', 'manager', `select app.ranks_void({{upset}}, 'entered twice')`),
      Q('after', `select coalesce(pg_temp.lv('u1'), 'null'::jsonb)`),
    ]);
    expect(answer(r, 'before')).toBe(2.25);
    expect(answer(r, 'void')).toMatchObject({ status: 'voided' });
    // No confirmed game left: the player has no rated level any more.
    expect(answer(r, 'after')).toBeNull();
  });
});

describe.skipIf(!docker)('0443 Level checks', () => {
  it('sets the class start, once per check_days, only allowed roles, capped on a settled player', () => {
    const r = scenario('tl-check', [
      ...BASE,
      PL('p', 'beginner'), PL('q', 'beginner'), PL('x', 'beginner'), PL('y', 'beginner'),
      T('chk1', 'desk', `select app.staff_set_customer_level({{p}}, 'advanced', 'plays like an A')`),
      LV('p_after_check', 'p'),
      // A second check inside check_days is kept but does not move the level.
      T('chk2', 'manager', `select app.staff_set_customer_level({{p}}, 'intermediate', null)`),
      LV('p_after_second', 'p'),
      T('list', 'manager', `select app.ranks_level_checks_list(10)`),
      T('list_desk', 'desk', `select app.ranks_level_checks_list(10)`),
      // q is settled (6 games), so a check moves it at most check_max_change (0.5).
      G('q', 'x', 'y', 'p', 'a', null, 9), G('q', 'x', 'y', 'p', 'b', null, 8), G('q', 'y', 'x', 'p', 'a', null, 7),
      G('q', 'y', 'x', 'p', 'b', null, 6), G('q', 'p', 'x', 'y', 'a', null, 5), G('q', 'p', 'x', 'y', 'b', null, 4),
      LV('q_before', 'q'),
      T('chk_q', 'desk', `select app.staff_set_customer_level({{q}}, 'advanced', null)`),
      LV('q_after', 'q'),
      // The owner takes the court desk off the checkers: the desk's check no longer applies.
      RULES('{"check_roles": ["coach", "manager", "owner"]}'),
      LV('q_desk_off', 'q'),
    ]);
    expect(answer(r, 'chk1')).toMatchObject({ level_confirmed: 'advanced' });
    // p played no game: the check's level is their level (ranks_player_levels has them from the check).
    expect(answer(r, 'p_after_check')).toBe(4.5);
    expect(answer(r, 'p_after_second')).toBe(4.5);
    const list = answer<Array<{ class: string; applied: boolean; role: string; level_set: number | null }>>(r, 'list');
    const mine = list.filter((x) => x.class === 'A' || x.class === 'B').slice(0, 2);
    expect(mine).toEqual([
      expect.objectContaining({ class: 'B', applied: false, role: 'manager' }),
      expect.objectContaining({ class: 'A', applied: true, role: 'court_desk', level_set: 4.5 }),
    ]);
    expect(code(r, 'list_desk')).toBe('FORBIDDEN');
    const qBefore = answer<number>(r, 'q_before');
    expect(answer<number>(r, 'q_after')).toBeCloseTo(qBefore + 0.5, 3);
    expect(answer<number>(r, 'q_desk_off')).toBeCloseTo(qBefore, 3);
  });
});

describe.skipIf(!docker)('0444 the rules, the boards and the page', () => {
  it('rules: owner only, validated, defaults not kept, the headline switch reaches the board', () => {
    const r = scenario('tl-rules', [
      ...BASE,
      T('mgr', 'manager', `select app.set_ranks_rules('{"headline": "level"}')`),
      T('bogus', 'owner', `select app.set_ranks_rules('{"bogus": 1}')`),
      T('range', 'owner', `select app.set_ranks_rules('{"k_settled": 5}')`),
      T('whole', 'owner', `select app.set_ranks_rules('{"improved_days": 30.5}')`),
      T('type', 'owner', `select app.set_ranks_rules('{"headline": "points"}')`),
      T('bands', 'owner', `select app.set_ranks_rules('{"class_a_from": 2.0}')`),
      T('places', 'owner', `select app.set_ranks_rules('{"t_second": 500}')`),
      T('offpeak', 'owner', `select app.set_ranks_rules('{"offpeak": [{"days": [7], "from": "10:00", "to": "12:00"}]}')`),
      T('roles', 'owner', `select app.set_ranks_rules('{"check_roles": ["cashier"]}')`),
      T('ok', 'owner', `select app.set_ranks_rules('{"headline": "level", "race_win": 10, "show_level": false}')`),
      T('board', 'owner', `select app.ranks_board()`),
      T('admin', 'manager', `select app.ranks_admin()`),
    ]);
    expect(code(r, 'mgr')).toBe('FORBIDDEN');
    expect(refusal(r, 'bogus')).toBe('INVALID_ARGUMENT:bogus');
    expect(refusal(r, 'range')).toBe('INVALID_VALUE:k_settled');
    expect(refusal(r, 'whole')).toBe('INVALID_VALUE:improved_days');
    expect(refusal(r, 'type')).toBe('INVALID_VALUE:headline');
    expect(refusal(r, 'bands')).toBe('INVALID_VALUE:class_a_from');
    expect(refusal(r, 'places')).toBe('INVALID_VALUE:t_first');
    expect(refusal(r, 'offpeak')).toBe('INVALID_VALUE:offpeak');
    expect(refusal(r, 'roles')).toBe('INVALID_VALUE:check_roles');
    // race_win 10 is its default, so only the two real changes are kept.
    expect(answer(r, 'ok')).toMatchObject({ overrides: { headline: 'level', show_level: false } });
    expect(Object.keys(answer<{ overrides: object }>(r, 'ok').overrides).sort()).toEqual(['headline', 'show_level']);
    expect(answer(r, 'board')).toMatchObject({ headline: 'level', show_level: false });
    expect(answer(r, 'admin')).toMatchObject({ rules: { headline: 'level', race_win: 10 }, defaults: { headline: 'race' } });
  });

  it('boards: reliable players on the level board, best N in the Race, boosts capped, "higher than X%"', () => {
    const r = scenario('tl-boards', [
      ...BASE,
      PL('a', 'intermediate'), PL('b', 'intermediate'), PL('c', 'intermediate'), PL('d', 'intermediate'),
      PL('e', 'intermediate'), PL('f', 'intermediate'),
      // Small gates so the case stays short; every hour off-peak, one boost a season; one match counts.
      RULES(`{"reliable_games": 3, "reliable_opponents": 3, "provisional_games": 0, "race_best_matches": 1,
              "boost_welcome": 1, "boost_max_per_season": 1,
              "offpeak": [{"days": [0,1,2,3,4,5,6], "from": "00:00", "to": "24:00"}]}`),
      // a plays three games against three different pairs; e and f play once.
      G('a', 'b', 'c', 'd', 'a', null, 5), G('a', 'c', 'b', 'd', 'a', null, 4), G('a', 'd', 'e', 'f', 'a', null, 3),
      T('board', 'e', `select app.ranks_board()`),
      T('page_a', 'a', `select app.my_ranks()`),
      T('page_e', 'e', `select app.my_ranks()`),
      Q('boosted', `select jsonb_agg(s.boost_kind order by s.played_at) from ranks_result_scores s
                     where s.profile_id = pg_temp.var('a')::uuid`),
    ]);
    const board = answer<{ level: Array<{ name: string }>; race: Array<{ name: string; points: number; rank: number }> }>(r, 'board');
    // a and d each played 3 games against at least 3 different people; b, c, e, f did not.
    expect(board.level.map((x) => x.name)).toEqual(['Tla Z.', 'Tld Z.']);
    // a's three wins: one counts (race_best_matches 1), the first carries the one boost (x1.5 = 15);
    // b, c and d also hold one boosted result, so the top shares 15.
    expect(board.race.find((x) => x.name === 'Tla Z.')).toMatchObject({ rank: 1, points: 15 });
    expect(answer(r, 'boosted')).toEqual(['offpeak', null, null]);
    const a = answer<{ touch: Record<string, unknown>; race: Record<string, unknown> }>(r, 'page_a');
    expect(a.touch).toMatchObject({ reliable: true, rank: 1, needs_games: 0 });
    expect(a.race).toMatchObject({ points: 15, rank: 1, matches: 3, matches_counted: 1, boosts_used: 1, boosts_max: 1 });
    expect(a.touch.higher_than_pct).toEqual(expect.any(Number));
    const e = answer<{ touch: Record<string, unknown> }>(r, 'page_e');
    expect(e.touch).toMatchObject({ reliable: false, needs_games: 2, needs_opponents: 1 });
  });

  it('results to check: the same two pairs with the winner flipped inside 7 days', () => {
    const r = scenario('tl-flip', [
      ...BASE,
      PL('a', 'intermediate'), PL('b', 'intermediate'), PL('c', 'intermediate'), PL('d', 'intermediate'),
      G('a', 'b', 'c', 'd', 'a', '6-0, 6-0', 3),
      G('c', 'd', 'b', 'a', 'a', '6-0, 6-0', 2),
      T('flips', 'desk', `select app.ranks_results_to_check(30)`),
      T('flips_guest', 'a', `select app.ranks_results_to_check(30)`),
    ]);
    const flips = answer<Array<{ first: { score: string }; second: { score: string } }>>(r, 'flips');
    expect(flips.length).toBeGreaterThanOrEqual(1);
    expect(code(r, 'flips_guest')).toBe('FORBIDDEN');
  });
});

/** A court at venue A (kept as court) and a played one-hour booking of <guest>, kept as <name>. */
const COURT = String.raw`
create function pg_temp.tl_court() returns void language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (pg_temp.var('venue')::uuid, 'TL court ' || pg_temp.var('_tl'), 'ملعب', '{60,90,120}', 991, true)
  returning id into v;
  insert into pg_temp.vars values ('court', v::text);
end $f$;
select pg_temp.tl_court();
`;
const BOOK = (name: string, guest: string, hoursAgo: number) =>
  `insert into pg_temp.vars values ('${name}', pg_temp.res('court', now() - interval '${hoursAgo} hours', 60, 'booking', 'confirmed', '${guest}')::text);`;
const USER = (name: string) => `{{${name}_u}}`;
const KEEPU = (name: string) =>
  `insert into pg_temp.vars values ('${name}_u', (select username from profiles where id = pg_temp.var('${name}')::uuid));`;

describe.skipIf(!docker)('0444 who writes what: players write, the desk confirms / edits / sets, a coach sets', () => {
  it('results: the desk confirms a waiting report and edits a result; a coach enters one', () => {
    const r = scenario('tl-write', [
      ...BASE, COURT,
      PL('a1', 'intermediate'), PL('a2', 'intermediate'), PL('b1', 'intermediate'), PL('b2', 'intermediate'),
      PL('k', 'advanced'),
      KEEPU('a1'), KEEPU('a2'), KEEPU('b1'), KEEPU('b2'),
      BOOK('bk', 'a1', 3),
      T('rep', 'a1', `select app.ranks_report({{bk}}, ${USER('a2')}, ${USER('b1')}, ${USER('b2')}, true, '6-4, 6-4')`),
      `insert into pg_temp.vars values ('rep_id', (select id::text from game_results where reservation_id = pg_temp.var('bk')::uuid));`,
      T('conf_guest', 'b1', `select app.ranks_staff_confirm({{rep_id}})`),
      T('conf', 'desk', `select app.ranks_staff_confirm({{rep_id}})`),
      T('conf_again', 'desk', `select app.ranks_staff_confirm({{rep_id}})`),
      LV('a1_won', 'a1'),
      // The desk flips the winner: the old result is voided with the reason, the new one confirmed.
      T('edit_noreason', 'desk', `select app.ranks_edit_result({{rep_id}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'b', '4-6, 4-6', '')`),
      T('edit', 'desk', `select app.ranks_edit_result({{rep_id}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'b', '4-6, 4-6', 'wrong side won')`),
      Q('old', `select jsonb_build_object('status', status, 'reason', void_reason) from game_results where id = pg_temp.var('rep_id')::uuid`),
      LV('a1_lost', 'a1'),
      // A coach enters a game they watched; a guest who is not a coach cannot.
      `select pg_temp.x($q$insert into coaches (profile_id, display_name_en, display_name_ar, public_accepted_at)
                         values (pg_temp.var('k')::uuid, 'Coach K', 'المدرّب', now())$q$);`,
      T('coach_not', 'b2', `select app.ranks_coach_record(${USER('a1')}, ${USER('a2')}, ${USER('b1')}, ${USER('b2')}, 'a', null)`),
      T('coach', 'k', `select app.ranks_coach_record(${USER('a1')}, ${USER('a2')}, ${USER('b1')}, ${USER('b2')}, 'a', '6-3, 6-3')`),
      T('coach_bad', 'k', `select app.ranks_coach_record(${USER('a1')}, 'tl-nobody-zz', ${USER('b1')}, ${USER('b2')}, 'a', null)`),
    ]);
    expect(code(r, 'conf_guest')).toBe('FORBIDDEN');
    expect(answer(r, 'conf')).toMatchObject({ status: 'confirmed' });
    expect(code(r, 'conf_again')).toBe('RANKS_RESULT_CLOSED');
    expect(code(r, 'edit_noreason')).toBe('REASON_REQUIRED');
    expect(answer(r, 'edit')).toMatchObject({ status: 'confirmed' });
    expect(answer(r, 'old')).toEqual({ status: 'voided', reason: 'edited: wrong side won' });
    expect(answer<number>(r, 'a1_won')).toBeGreaterThan(3.2);
    expect(answer<number>(r, 'a1_lost')).toBeLessThan(3.2);
    expect(code(r, 'coach_not')).toBe('FORBIDDEN');
    expect(answer(r, 'coach')).toMatchObject({ status: 'confirmed' });
    expect(code(r, 'coach_bad')).toBe('RANKS_PLAYER_NOT_FOUND');
  });

  it('levels: the player picks their own type until a check counts; my_ranks says who set it', () => {
    const r = scenario('tl-self', [
      ...BASE,
      PL('p', 'beginner'),
      T('pick', 'p', `select app.set_my_play_level('advanced')`),
      T('pick_bad', 'p', `select app.set_my_play_level('pro')`),
      T('page1', 'p', `select app.my_ranks()`),
      T('chk', 'desk', `select app.staff_set_customer_level({{p}}, 'intermediate', null)`),
      T('pick_locked', 'p', `select app.set_my_play_level('advanced')`),
      T('page2', 'p', `select app.my_ranks()`),
    ]);
    expect(answer(r, 'pick')).toEqual({ play_level: 'advanced' });
    expect(refusal(r, 'pick_bad')).toBe('INVALID_PLAY_PROFILE:p_level');
    expect(answer<{ touch: object }>(r, 'page1').touch).toMatchObject({
      self_type: 'advanced', checked: null, can_change_type: true, level: 4.5 });
    expect(code(r, 'pick_locked')).toBe('RANKS_LEVEL_LOCKED');
    expect(answer<{ touch: object }>(r, 'page2').touch).toMatchObject({
      self_type: 'advanced', checked: { type: 'intermediate', role: 'court_desk' }, can_change_type: false, level: 3.2 });
  });
});
