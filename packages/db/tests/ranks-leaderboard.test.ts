/**
 * 0364 ranks_leaderboard: the players' leaderboard.
 *
 *   * a player report waits for an opponent: confirmed, it gives win or loss points to all four;
 *     turned down, nothing; lapsed, it reads expired and a late confirm marks it expired; only
 *     side B may answer (the partner and the reporter are RANKS_NOT_YOURS);
 *   * the booker of a played booking inside report_hours only (RANKS_NOT_ELIGIBLE), known
 *     usernames (RANKS_PLAYER_NOT_FOUND), four different people (RANKS_PLAYERS_INVALID), one live
 *     result a booking (RANKS_ALREADY_REPORTED), a well-formed score (INVALID_VALUE);
 *   * the desk's word replaces a pending report and is confirmed at once; a void by a manager or
 *     the owner takes the points off again (the ledger nets to zero), never the desk's;
 *   * the board returns at most board_size rows and never a player below them, anon included;
 *     my_ranks is the player's own and anon has no grant; the owner's settings and levels are
 *     validated; a rule change applies only to results confirmed after it;
 *   * a scored tournament match records a confirmed tournament result, and a correction voids it
 *     and records the new score;
 *   * the account merge re-points a player's games and points, and a game both accounts sat on
 *     keeps the dropped seat (and its points) instead of failing the merge.
 *
 * Every case is one rolled-back psql transaction (stores-harness), so nothing is left behind
 * (ranks_ledger is append-only); without docker it skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { SETUP } from './matches-harness';
import { dockerReachable, KEEP, Q, RES, scenario, T, X, type Results } from './stores-harness';
import { answer, PUBLISH, refusal, ROUNDS, RUN, TOUR_BRANCH, TOUR_SETUP } from './tournaments-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

/**
 * On top of SETUP (or TOUR_SETUP): the leaderboard at its defaults with period all (so a game
 * played just before a month turned still counts), a court at venue A, players with usernames,
 * bookings, an anon caller and the points each player holds on one result.
 */
const RANKS = String.raw`
update ranks_settings
   set enabled = true, win_points = 2, loss_points = 1, draw_points = 1, period = 'all', board_size = 10,
       count_reported = true, count_tournaments = true, report_hours = 48
 where id;
insert into pg_temp.vars values ('_rk', substr(md5(random()::text), 1, 5));
-- A court desk of this run's own (filed at venue A by the 0123 trigger), so the case does not
-- depend on what other suites did to the seeded desk account.
select pg_temp.mk('rk_desk', 'court_desk');
update pg_temp.vars set val = (select v.val from pg_temp.vars v where v.name = 'rk_desk') where name = 'desk';

create function pg_temp.rk_court() returns void language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (pg_temp.var('venue')::uuid, 'RK court ' || pg_temp.var('_rk'), 'ملعب الترتيب', '{60,90,120}', 990, true)
  returning id into v;
  insert into pg_temp.vars values ('court', v::text);
end $f$;

-- A guest with a username (rk<run><name>), kept as <name> and <name>_u.
create function pg_temp.player(p_name text, p_given text default null, p_family text default 'Zed')
returns uuid language plpgsql as $f$
declare v uuid; u text := 'rk' || pg_temp.var('_rk') || p_name;
begin
  perform set_config('request.jwt.claims', '', true);
  v := pg_temp.guest(p_name, jsonb_build_object('given', coalesce(p_given, 'Rk' || p_name), 'family', p_family));
  update profiles set username = u where id = v;
  insert into pg_temp.vars values (p_name || '_u', u);
  return v;
end $f$;

-- A confirmed one-hour booking of <guest> on the court starting at p_start, kept as <name>.
create function pg_temp.bk(p_name text, p_guest text, p_start timestamptz) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into pg_temp.vars values (p_name, pg_temp.res('court', p_start, 60, 'booking', 'confirmed', p_guest)::text);
end $f$;

-- One statement as anon (no grant beyond anon's), recorded like t().
create function pg_temp.ta(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', false, 'code', v_msg));
  end;
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- {player name: net points} on one result (or, with null, on adjusts), from the ledger.
create function pg_temp.pts(p_result uuid) returns jsonb language sql as $f$
  select coalesce(jsonb_object_agg(v.name, s.d), '{}'::jsonb)
    from (select l.profile_id, sum(l.delta)::int as d from ranks_ledger l
           where l.result_id is not distinct from p_result group by l.profile_id) s
    join pg_temp.vars v on v.val = s.profile_id::text and v.name !~ '_u$'
$f$;
`;

const BASE = [SETUP, RANKS, `select pg_temp.rk_court();`];
const PLAYERS = (...names: string[]) => names.map((n) => `select pg_temp.player('${n}');`);
const BK = (name: string, guest: string, start: string) => `select pg_temp.bk('${name}', '${guest}', ${start});`;
const AGO = (hours: number) => `now() - interval '${hours} hours'`;
const REPORT = (label: string, who: string, bk: string, won = true, score = 'null') =>
  T(label, who, `select app.ranks_report({{${bk}}}, {{a2_u}}, {{b1_u}}, {{b2_u}}, ${won}, ${score})`);
const PTS = (label: string, result: string) => Q(label, `select pg_temp.pts({{${result}}}::uuid)`);
const STATUS = (label: string, result: string) =>
  Q(label, `select to_jsonb(status) from game_results where id = {{${result}}}::uuid`);
const TA = (label: string, sql: string) => `select pg_temp.ta('${label}', $q$${sql}$q$);`;

function code(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail: ${JSON.stringify(o!.data)}`).toBe(false);
  return o!.code!;
}

describe.skipIf(!docker)('0364 ranks: a player report and its answer', () => {
  it('confirm awards all four, reject awards nothing, a lapse reads and ends expired, only side B answers', () => {
    const r = scenario('rk-report', [
      ...BASE,
      ...PLAYERS('a1', 'a2', 'b1', 'b2', 'x'),
      BK('bk1', 'a1', AGO(3)),
      BK('bk2', 'a1', AGO(5)),
      BK('bk3', 'a1', AGO(7)),
      REPORT('rep1', 'a1', 'bk1', true, `'6-4, 6-3'`),
      RES('rep1_id', 'rep1', 'id'),
      T('c_partner', 'a2', `select app.ranks_confirm({{rep1_id}}, true)`),
      T('c_reporter', 'a1', `select app.ranks_confirm({{rep1_id}}, true)`),
      T('c_outsider', 'x', `select app.ranks_confirm({{rep1_id}}, true)`),
      PTS('pts_pending', 'rep1_id'),
      T('c_b2', 'b2', `select app.ranks_confirm({{rep1_id}}, true)`),
      PTS('pts1', 'rep1_id'),
      T('c_again', 'b1', `select app.ranks_confirm({{rep1_id}}, false)`),
      REPORT('dup', 'a1', 'bk1'),
      // Turned down: nothing awarded.
      REPORT('rep2', 'a1', 'bk2', false),
      RES('rep2_id', 'rep2', 'id'),
      T('rej', 'b1', `select app.ranks_confirm({{rep2_id}}, false)`),
      PTS('pts2', 'rep2_id'),
      // Lapsed: reads expired, and a confirm after it marks it so and awards nothing.
      REPORT('rep3', 'a1', 'bk3'),
      RES('rep3_id', 'rep3', 'id'),
      X(`update game_results set expires_at = now() - interval '1 minute' where id = {{rep3_id}}::uuid`),
      T('b1_page', 'b1', `select app.my_ranks()`),
      T('c_late', 'b1', `select app.ranks_confirm({{rep3_id}}, true)`),
      STATUS('st3', 'rep3_id'),
      PTS('pts3', 'rep3_id'),
      // A lapsed report no longer stands in the way of a new one.
      REPORT('rep3b', 'a1', 'bk3'),
      T('a1_page', 'a1', `select app.my_ranks()`),
    ]);
    const rep1 = answer<Record<string, unknown>>(r, 'rep1');
    expect(rep1).toMatchObject({ source: 'player', status: 'pending', outcome: 'won', score: '6-4, 6-3',
                                 reported_by_me: true, can_confirm: false, points: 0 });
    expect(code(r, 'c_partner')).toBe('RANKS_NOT_YOURS');
    expect(code(r, 'c_reporter')).toBe('RANKS_NOT_YOURS');
    expect(code(r, 'c_outsider')).toBe('RANKS_NOT_YOURS');
    expect(answer(r, 'pts_pending')).toEqual({});
    expect(answer(r, 'c_b2')).toMatchObject({ status: 'confirmed', outcome: 'lost', points: 1 });
    expect(answer(r, 'pts1')).toEqual({ a1: 2, a2: 2, b1: 1, b2: 1 });
    expect(code(r, 'c_again')).toBe('RANKS_RESULT_CLOSED');
    expect(code(r, 'dup')).toBe('RANKS_ALREADY_REPORTED');

    expect(answer(r, 'rej')).toMatchObject({ status: 'rejected' });
    expect(answer(r, 'pts2')).toEqual({});

    const b1Page = answer<{ results: Array<{ id: string; status: string; can_confirm: boolean }> }>(r, 'b1_page');
    const rep3Id = (answer<{ id: string }>(r, 'rep3')).id;
    expect(b1Page.results.find((x) => x.id === rep3Id)).toMatchObject({ status: 'expired', can_confirm: false });
    expect(answer(r, 'c_late')).toMatchObject({ status: 'expired', points: 0 });
    expect(answer(r, 'st3')).toBe('expired');
    expect(answer(r, 'pts3')).toEqual({});
    expect(answer(r, 'rep3b')).toMatchObject({ status: 'pending' });

    const a1 = answer<Record<string, unknown>>(r, 'a1_page');
    expect(a1).toMatchObject({ enabled: true, period: 'all', points: 2, lifetime: 2 });
    expect(a1.rank).toEqual(expect.any(Number));
    // The players on a result are names and usernames, never an id or a phone.
    const seats = (a1.results as Array<{ us: unknown[]; them: unknown[] }>).flatMap((x) => [...x.us, ...x.them]);
    expect(seats.length).toBeGreaterThan(0);
    for (const p of seats) expect(Object.keys(p as object).sort()).toEqual(['former', 'me', 'name', 'username']);
  });

  it('refuses what cannot be reported', () => {
    const r = scenario('rk-refuse', [
      ...BASE,
      ...PLAYERS('a1', 'a2', 'b1', 'b2'),
      BK('mine', 'a1', AGO(3)),
      BK('theirs', 'b1', AGO(3) + ` - interval '2 hours'`),
      BK('later', 'a1', `now() + interval '1 hour'`),
      BK('just', 'a1', `now() - interval '10 minutes'`),
      BK('old', 'a1', AGO(60)),
      REPORT('not_booker', 'a1', 'theirs'),
      REPORT('not_played', 'a1', 'later'),
      REPORT('not_yet_30', 'a1', 'just'),
      REPORT('too_old', 'a1', 'old'),
      REPORT('partner_of_b1', 'a2', 'mine'),
      T('unknown', 'a1', `select app.ranks_report({{mine}}, 'rk-nobody-zz', {{b1_u}}, {{b2_u}}, true, null)`),
      T('self', 'a1', `select app.ranks_report({{mine}}, {{a1_u}}, {{b1_u}}, {{b2_u}}, true, null)`),
      T('twice', 'a1', `select app.ranks_report({{mine}}, {{a2_u}}, {{b1_u}}, {{b1_u}}, true, null)`),
      T('score', 'a1', `select app.ranks_report({{mine}}, {{a2_u}}, {{b1_u}}, {{b2_u}}, true, '6 to 4')`),
      T('no_won', 'a1', `select app.ranks_report({{mine}}, {{a2_u}}, {{b1_u}}, {{b2_u}}, null, null)`),
      T('find', 'a1', `select app.ranks_find_player(upper({{b1_u}}))`),
      T('find_none', 'a1', `select app.ranks_find_player('rk-nobody-zz')`),
      // Off: the board and the page say so, a report is RANKS_OFF.
      `update ranks_settings set count_reported = false where id;`,
      REPORT('reports_off', 'a1', 'mine'),
      `update ranks_settings set enabled = false where id;`,
      T('page_off', 'a1', `select app.my_ranks()`),
      TA('board_off', `select app.ranks_board()`),
    ]);
    expect(code(r, 'not_booker')).toBe('RANKS_NOT_ELIGIBLE');
    expect(code(r, 'not_played')).toBe('RANKS_NOT_ELIGIBLE');
    expect(code(r, 'not_yet_30')).toBe('RANKS_NOT_ELIGIBLE');
    expect(code(r, 'too_old')).toBe('RANKS_NOT_ELIGIBLE');
    expect(code(r, 'partner_of_b1')).toBe('RANKS_NOT_ELIGIBLE');
    expect(code(r, 'unknown')).toBe('RANKS_PLAYER_NOT_FOUND');
    expect(code(r, 'self')).toBe('RANKS_PLAYERS_INVALID');
    expect(code(r, 'twice')).toBe('RANKS_PLAYERS_INVALID');
    expect(refusal(r, 'score')).toBe('INVALID_VALUE:p_score');
    expect(refusal(r, 'no_won')).toBe('INVALID_ARGUMENT:p_won');
    expect(answer(r, 'find')).toMatchObject({ name: 'Rkb1 Z.', me: false });
    expect(answer(r, 'find_none')).toBeNull();
    expect(code(r, 'reports_off')).toBe('RANKS_OFF');
    expect(answer(r, 'page_off')).toEqual({ enabled: false });
    expect(answer(r, 'board_off')).toEqual({ enabled: false });
  });
});

describe.skipIf(!docker)('0364 ranks: the desk and the void', () => {
  it('the desk replaces a pending report, confirmed at once; a void nets to zero and is the manager\'s', () => {
    const r = scenario('rk-desk', [
      ...BASE,
      ...PLAYERS('a1', 'a2', 'b1', 'b2'),
      BK('bk1', 'a1', AGO(3)),
      REPORT('rep', 'a1', 'bk1'),
      RES('rep_id', 'rep', 'id'),
      T('guest_desk', 'a1', `select app.ranks_desk_record({{bk1}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'b', null)`),
      T('cashier_desk', 'cashier',
        `select app.ranks_desk_record({{bk1}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'b', null)`),
      T('desk', 'desk', `select app.ranks_desk_record({{bk1}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'b', '6-2, 6-1')`),
      RES('desk_id', 'desk', 'id'),
      Q('replaced', `select jsonb_build_object('status', status, 'reason', void_reason)
                       from game_results where id = {{rep_id}}::uuid`),
      PTS('pts', 'desk_id'),
      T('again', 'desk', `select app.ranks_desk_record({{bk1}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'a', null)`),
      T('same_twice', 'desk', `select app.ranks_desk_record(null, {{a1}}, {{a1}}, {{b1}}, null, 'a', null)`),
      T('walkin', 'desk', `select app.ranks_desk_record(null, {{a1}}, null, {{b1}}, null, 'draw', null)`),
      RES('walkin_id', 'walkin', 'id'),
      PTS('pts_walkin', 'walkin_id'),
      T('list', 'desk', `select app.ranks_desk_results('confirmed', 10)`),
      T('void_desk', 'desk', `select app.ranks_void({{desk_id}}, 'wrong winner')`),
      T('void_guest', 'a1', `select app.ranks_void({{desk_id}}, 'wrong winner')`),
      T('void_short', 'manager', `select app.ranks_void({{desk_id}}, 'x')`),
      T('void', 'manager', `select app.ranks_void({{desk_id}}, 'wrong winner')`),
      PTS('pts_void', 'desk_id'),
      Q('ledger_void', `select jsonb_agg(jsonb_build_object('kind', kind, 'delta', delta) order by kind, delta)
                          from ranks_ledger where result_id = {{desk_id}}::uuid and profile_id = {{b1}}::uuid`),
      T('void_again', 'owner', `select app.ranks_void({{desk_id}}, 'wrong winner')`),
      // Voided, the booking takes a new result.
      T('redo', 'desk', `select app.ranks_desk_record({{bk1}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'a', null)`),
      Q('audit', `select to_jsonb(array_agg(action order by action)) from audit_log
                   where entity = 'game_results' and entity_id = {{desk_id}}`),
      // The ledger refuses a direct update or delete.
      X(`create temp table blocked (what text, msg text)`),
      `do $$ begin
         begin update ranks_ledger set delta = 99 where result_id = pg_temp.var('desk_id')::uuid;
         exception when others then insert into pg_temp.blocked values ('update', sqlerrm); end;
         begin delete from ranks_ledger where result_id = pg_temp.var('desk_id')::uuid;
         exception when others then insert into pg_temp.blocked values ('delete', sqlerrm); end;
       end $$;`,
      Q('blocked', `select jsonb_object_agg(what, msg) from pg_temp.blocked`),
    ]);
    expect(code(r, 'guest_desk')).toBe('FORBIDDEN');
    expect(code(r, 'cashier_desk')).toBe('FORBIDDEN');
    expect(answer(r, 'desk')).toMatchObject({ status: 'confirmed' });
    expect(answer(r, 'replaced')).toEqual({ status: 'rejected', reason: 'replaced at the desk' });
    expect(answer(r, 'pts')).toEqual({ a1: 1, a2: 1, b1: 2, b2: 2 });
    expect(code(r, 'again')).toBe('RANKS_ALREADY_REPORTED');
    expect(code(r, 'same_twice')).toBe('RANKS_PLAYERS_INVALID');
    expect(answer(r, 'walkin')).toMatchObject({ status: 'confirmed' });
    expect(answer(r, 'pts_walkin')).toEqual({ a1: 1, b1: 1 });
    const list = answer<Array<{ id: string; a: unknown[] }>>(r, 'list');
    const deskId = answer<{ id: string }>(r, 'desk').id;
    expect(list.find((x) => x.id === deskId)).toMatchObject({ status: 'confirmed', winner: 'b', score: '6-2, 6-1' });
    expect(code(r, 'void_desk')).toBe('FORBIDDEN');
    expect(code(r, 'void_guest')).toBe('FORBIDDEN');
    expect(code(r, 'void_short')).toBe('REASON_REQUIRED');
    expect(answer(r, 'void')).toMatchObject({ status: 'voided' });
    expect(answer(r, 'pts_void')).toEqual({ a1: 0, a2: 0, b1: 0, b2: 0 });
    expect(answer(r, 'ledger_void')).toEqual([{ kind: 'void', delta: -2 }, { kind: 'win', delta: 2 }]);
    expect(code(r, 'void_again')).toBe('RANKS_RESULT_CLOSED');
    expect(answer(r, 'redo')).toMatchObject({ status: 'confirmed' });
    expect(answer(r, 'audit')).toEqual(['ranks.record', 'ranks.void']);
    expect(answer(r, 'blocked')).toEqual({ update: 'FORBIDDEN', delete: 'FORBIDDEN' });
  });
});

describe.skipIf(!docker)('0364 ranks: the board, the page and the owner\'s rules', () => {
  it('board_size rows and nobody below; anon reads the board, never my_ranks; settings and levels', () => {
    const r = scenario('rk-board', [
      ...BASE,
      `select pg_temp.player('p1', 'Pone'); select pg_temp.player('p2', 'Ptwo'); select pg_temp.player('p3', 'Pthree');`,
      `select pg_temp.player('p4', 'Pfour'); select pg_temp.player('p5', 'Pfive');`,
      ...PLAYERS('a1', 'a2', 'b1', 'b2'),
      T('set_mgr', 'manager', `select app.set_ranks_settings('{"board_size": 3}')`),
      T('set_small', 'owner', `select app.set_ranks_settings('{"board_size": 2}')`),
      T('set_key', 'owner', `select app.set_ranks_settings('{"bogus": 1}')`),
      T('set_type', 'owner', `select app.set_ranks_settings('{"period": "week"}')`),
      T('set', 'owner', `select app.set_ranks_settings('{"board_size": 3}')`),
      T('adj_mgr', 'manager', `select app.ranks_adjust({{p1}}, 900, 'season start')`),
      T('adj1', 'owner', `select app.ranks_adjust({{p1}}, 900, 'season start')`),
      T('adj2', 'owner', `select app.ranks_adjust({{p2}}, 800, 'season start')`),
      T('adj3', 'owner', `select app.ranks_adjust({{p3}}, 700, 'season start')`),
      T('adj4', 'owner', `select app.ranks_adjust({{p4}}, 600, 'season start')`),
      T('adj5', 'owner', `select app.ranks_adjust({{p5}}, 500, 'season start')`),
      T('adj_zero', 'owner', `select app.ranks_adjust({{p5}}, 0, 'season start')`),
      TA('board_anon', `select app.ranks_board()`),
      T('board_p4', 'p4', `select app.ranks_board()`),
      TA('mine_anon', `select app.my_ranks()`),
      T('mine_p4', 'p4', `select app.my_ranks()`),
      // Levels: one must start at 0, no two at the same points; the owner's alone.
      T('lv_mgr', 'manager', `select app.set_ranks_levels('[{"name_en":"A","name_ar":"أ","min_points":0}]')`),
      T('lv_base', 'owner', `select app.set_ranks_levels('[{"name_en":"A","name_ar":"أ","min_points":5}]')`),
      T('lv_dup', 'owner', `select app.set_ranks_levels(
         '[{"name_en":"A","name_ar":"أ","min_points":0},{"name_en":"B","name_ar":"ب","min_points":0}]')`),
      T('lv_empty', 'owner', `select app.set_ranks_levels('[]')`),
      T('lv', 'owner', `select app.set_ranks_levels(
         '[{"name_en":"Bronze","name_ar":"برونزي","min_points":0},{"name_en":"Gold","name_ar":"ذهبي","min_points":850}]')`),
      T('admin', 'manager', `select app.ranks_admin()`),
      T('admin_desk', 'desk', `select app.ranks_admin()`),
      TA('board_lv', `select app.ranks_board()`),
      // A rule change applies to results confirmed after it, never to earlier ones.
      BK('g1', 'a1', AGO(3)),
      BK('g2', 'a1', AGO(5)),
      T('d1', 'desk', `select app.ranks_desk_record({{g1}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'a', null)`),
      RES('d1_id', 'd1', 'id'),
      REPORT('rep2', 'a1', 'g2'),
      RES('rep2_id', 'rep2', 'id'),
      T('rules', 'owner', `select app.set_ranks_settings('{"win_points": 5, "loss_points": 0}')`),
      T('c2', 'b1', `select app.ranks_confirm({{rep2_id}}, true)`),
      PTS('pts1', 'd1_id'),
      PTS('pts2', 'rep2_id'),
    ]);
    expect(code(r, 'set_mgr')).toBe('FORBIDDEN');
    expect(refusal(r, 'set_small')).toMatch(/^INVALID_VALUE:/);
    expect(refusal(r, 'set_key')).toBe('INVALID_ARGUMENT:bogus');
    expect(refusal(r, 'set_type')).toMatch(/^INVALID_VALUE:/);
    expect(answer(r, 'set')).toMatchObject({ board_size: 3, period: 'all' });
    expect(code(r, 'adj_mgr')).toBe('FORBIDDEN');
    expect(refusal(r, 'adj_zero')).toBe('INVALID_VALUE:p_delta');

    const board = answer<{ enabled: boolean; size: number; rows: Array<Record<string, unknown>> }>(r, 'board_anon');
    expect(board).toMatchObject({ enabled: true, size: 3, period: 'all', from: null });
    expect(board.rows).toEqual([
      { rank: 1, name: 'Pone Z.', points: 900, level: expect.any(Object), mine: false },
      { rank: 2, name: 'Ptwo Z.', points: 800, level: expect.any(Object), mine: false },
      { rank: 3, name: 'Pthree Z.', points: 700, level: expect.any(Object), mine: false },
    ]);
    const asP4 = answer<{ rows: Array<{ name: string; mine: boolean }> }>(r, 'board_p4');
    expect(asP4.rows.map((x) => x.name)).toEqual(['Pone Z.', 'Ptwo Z.', 'Pthree Z.']);
    expect(asP4.rows.some((x) => x.mine)).toBe(false);
    expect(code(r, 'mine_anon')).toMatch(/permission denied for function my_ranks/);
    expect(answer(r, 'mine_p4')).toMatchObject({ points: 600, lifetime: 600, rank: 4, size: 3 });

    expect(code(r, 'lv_mgr')).toBe('FORBIDDEN');
    expect(refusal(r, 'lv_base')).toBe('INVALID_VALUE:base');
    expect(refusal(r, 'lv_dup')).toMatch(/^INVALID_VALUE:/);
    expect(refusal(r, 'lv_empty')).toBe('INVALID_VALUE:count');
    expect(answer(r, 'lv')).toEqual([
      { name_en: 'Bronze', name_ar: 'برونزي', min_points: 0 },
      { name_en: 'Gold', name_ar: 'ذهبي', min_points: 850 },
    ]);
    expect(answer(r, 'admin')).toMatchObject({ settings: { board_size: 3 }, levels: expect.any(Array) });
    expect(code(r, 'admin_desk')).toBe('FORBIDDEN');
    const lv = answer<{ rows: Array<{ name: string; level: { name_en: string } }> }>(r, 'board_lv');
    expect(lv.rows.map((x) => x.level.name_en)).toEqual(['Gold', 'Bronze', 'Bronze']);

    expect(answer(r, 'rules')).toMatchObject({ win_points: 5, loss_points: 0 });
    expect(answer(r, 'pts1')).toEqual({ a1: 2, a2: 2, b1: 1, b2: 1 });
    expect(answer(r, 'pts2')).toEqual({ a1: 5, a2: 5, b1: 0, b2: 0 });
  });
});

describe.skipIf(!docker)('0364 ranks: tournament matches feed the board', () => {
  it('a score records a confirmed tournament result; a correction voids it and records the new one', () => {
    const r = scenario('rk-tour', [
      TOUR_SETUP,
      RANKS,
      ...TOUR_BRANCH,
      RUN('r1', { count: 8 }),
      ...PUBLISH('pub', 'r1', 't1'),
      `select pg_temp.field('t1', 8, 'p');`,
      `select pg_temp.close('t1');`,
      ...ROUNDS('sched', 't1', 1, 1),
      KEEP('m1', `select id::text from tournament_matches where tournament_id = {{t1}}::uuid and round_no = 1
                   order by court_id limit 1`),
      Q('seats', `select jsonb_build_object(
                    'a', (select jsonb_agg(e.guest_id order by e.guest_id) from tournament_entries e
                           join tournament_matches m on e.id in (m.a1, m.a2) where m.id = {{m1}}::uuid),
                    'b', (select jsonb_agg(e.guest_id order by e.guest_id) from tournament_entries e
                           join tournament_matches m on e.id in (m.b1, m.b2) where m.id = {{m1}}::uuid))`),
      T('score', 'desk', `select app.tournament_score({{m1}}, 14::smallint, 10::smallint, 0, null)`),
      KEEP('g1', `select id::text from game_results where tournament_match_id = {{m1}}::uuid and status = 'confirmed'`),
      Q('g1_row', `select jsonb_build_object('source', source, 'winner', winner, 'score', score,
                     'a', (select jsonb_agg(x order by x) from unnest(array[a1, a2]) x),
                     'b', (select jsonb_agg(x order by x) from unnest(array[b1, b2]) x))
                     from game_results where id = {{g1}}::uuid`),
      Q('g1_pts', `select jsonb_agg(s.d order by s.d) from (select sum(delta)::int d from ranks_ledger
                     where result_id = {{g1}}::uuid group by profile_id) s`),
      T('fix', 'desk', `select app.tournament_score({{m1}}, 10::smallint, 14::smallint, 1, 'typed the wrong way')`),
      STATUS('g1_after', 'g1'),
      KEEP('g2', `select id::text from game_results where tournament_match_id = {{m1}}::uuid and status = 'confirmed'`),
      Q('g2_row', `select jsonb_build_object('winner', winner, 'score', score) from game_results where id = {{g2}}::uuid`),
      Q('net', `select jsonb_object_agg(s.side, s.pts) from (
                  select case when l.profile_id in (g.a1, g.a2) then 'a' else 'b' end as side, sum(l.delta)::int as pts
                    from ranks_ledger l join game_results g on g.id = {{g2}}::uuid
                   where l.profile_id in (g.a1, g.a2, g.b1, g.b2)
                     and l.result_id in ({{g1}}::uuid, {{g2}}::uuid)
                   group by 1) s`),
      // count_tournaments off: a correction still takes the old points off, and records nothing new.
      `update ranks_settings set count_tournaments = false where id;`,
      T('fix2', 'desk', `select app.tournament_score({{m1}}, 12::smallint, 12::smallint, 2, 'a draw after all')`),
      Q('live', `select to_jsonb(count(*)) from game_results where tournament_match_id = {{m1}}::uuid and status = 'confirmed'`),
      Q('net_off', `select to_jsonb(coalesce(sum(l.delta), 0)::int) from ranks_ledger l
                     join game_results g on g.id = l.result_id where g.tournament_match_id = {{m1}}::uuid`),
    ]);
    answer(r, 'score');
    const seats = answer<{ a: string[]; b: string[] }>(r, 'seats');
    expect(answer(r, 'g1_row')).toEqual({ source: 'tournament', winner: 'a', score: '14-10', a: seats.a, b: seats.b });
    expect(answer(r, 'g1_pts')).toEqual([1, 1, 2, 2]);
    answer(r, 'fix');
    expect(answer(r, 'g1_after')).toBe('voided');
    expect(answer(r, 'g2_row')).toEqual({ winner: 'b', score: '10-14' });
    // a: 2 for the first score, -2 for its void, 1 for the loss; b: 1 - 1 + 2 each.
    expect(answer(r, 'net')).toEqual({ a: 2, b: 4 });
    answer(r, 'fix2');
    expect(answer(r, 'live')).toBe(0);
    expect(answer(r, 'net_off')).toBe(0);
  });
});

describe.skipIf(!docker)('0364 ranks: the account merge', () => {
  it('re-points games and points; a game both accounts sat on keeps the dropped seat', () => {
    const r = scenario('rk-merge', [
      ...BASE,
      ...PLAYERS('a1', 'a2', 'b1', 'b2', 'k'),
      BK('bk1', 'a1', AGO(3)),
      BK('bk2', 'a1', AGO(5)),
      // a2 and k are one person: k also played bk2, against a2.
      T('d1', 'desk', `select app.ranks_desk_record({{bk1}}, {{a1}}, {{a2}}, {{b1}}, {{b2}}, 'a', null)`),
      RES('d1_id', 'd1', 'id'),
      T('d2', 'desk', `select app.ranks_desk_record({{bk2}}, {{a1}}, {{a2}}, {{k}}, {{b2}}, 'b', null)`),
      RES('d2_id', 'd2', 'id'),
      X(`select app.merge_profiles_internal({{k}}::uuid, {{a2}}::uuid, 'test')`),
      Q('seats1', `select jsonb_build_object('a2_is_k', a2 = {{k}}::uuid) from game_results where id = {{d1_id}}::uuid`),
      Q('seats2', `select jsonb_build_object('a2_is_drop', a2 = {{a2}}::uuid, 'b1_is_k', b1 = {{k}}::uuid)
                     from game_results where id = {{d2_id}}::uuid`),
      PTS('pts1', 'd1_id'),
      PTS('pts2', 'd2_id'),
    ]);
    expect(answer(r, 'seats1')).toEqual({ a2_is_k: true });
    expect(answer(r, 'seats2')).toEqual({ a2_is_drop: true, b1_is_k: true });
    expect(answer(r, 'pts1')).toEqual({ a1: 2, k: 2, b1: 1, b2: 1 });
    expect(answer(r, 'pts2')).toEqual({ a1: 1, a2: 1, k: 2, b2: 2 });
  });
});
