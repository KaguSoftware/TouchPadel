/**
 * staff rewards (0332): the owner sets a standing bonus or prize per person
 * for a number of orders placed in a business month; each person reads only
 * their own progress.
 *
 *   * who: only the owner sets, ends and reads rewards and the board; any
 *     active staff member reads their own app.my_rewards, never anyone
 *     else's count; rewards are for waiters, cashiers and managers at the
 *     branch, never an owner or another role;
 *   * the limits: target 1 to 100,000, bonus 0 to 10,000,000 IQD, prize at
 *     most 80 characters (trimmed), a bonus or a prize, one active reward
 *     per target, at most 5 active per person; an ended reward is gone
 *     (REF_NOT_FOUND) and frees its target;
 *   * the count: the person's own orders at the branch, voided ones excluded,
 *     inside the branch's business month (the start hour bounds it), never
 *     another person's or another branch's;
 *   * last month: rewards active at any moment of it whose target is at most
 *     its count;
 *   * the board is by name, never by count;
 *   * the LLM wall: no assistant_readable_columns row, and every
 *     staff.reward.% audit row carries {status} only.
 *
 * HOW. As wages.test.ts: every scenario is ONE psql transaction that is
 * rolled back; staff, a day, tabs and orders are created inside it and each
 * call runs as `authenticated` with the caller's JWT claims. Without docker on
 * PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

// ── the in-transaction harness (as wages.test.ts) ───────────────────────────
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('prep', '${SEED_STAFF_IDS.prep}'),
  ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.run(p_label text, p_who text, p_sql text, p_role text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if p_role is not null then execute 'set local role ' || p_role; end if;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, '')));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);  -- 0230: a fixture write, not a staff write
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role, p_active boolean default true) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'sr-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SR ' || p_name, p_role, p_active);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
}
type Results = Record<string, Outcome>;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${body.join('\n')}\n` +
      `select label || E'\\t' || res::text from pg_temp.out order by seq;\nrollback;\n`,
  );
  const results: Results = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    results[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1)) as Outcome;
  }
  return results;
}

const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string, active = true) => `select pg_temp.mk('${name}', '${role}', ${active});`;

function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}
function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.hint ? `${o!.code}:${o!.hint}` : o!.code!;
}

/** The id a T(...) call returned, kept under `name`. */
const ID = (name: string, label: string) => KEEP(name, `select res->>'data' from pg_temp.out where label = '${label}'`);

const OTHER_VENUE = '00000000-0000-4000-8000-00000000d5d5';
/**
 * The branch's business month as the RPCs bound it: today, the month, its
 * last day, and the timestamps where this month and last month begin.
 */
const MONTHS = [
  KEEP('today', `select app.venue_business_date({{venue}}::uuid)::text`),
  KEEP('month', `select date_trunc('month', app.venue_business_date({{venue}}::uuid))::date::text`),
  KEEP('last_month', `select (date_trunc('month', app.venue_business_date({{venue}}::uuid)) - interval '1 month')::date::text`),
  KEEP('month_end', `select ((date_trunc('month', app.venue_business_date({{venue}}::uuid)) + interval '1 month')::date - 1)::text`),
  KEEP('hour', `select coalesce(app.cafe_setting_int('analytics_business_day_start_hour', {{venue}}::uuid), 4)::text`),
  KEEP('tz', `select coalesce((select timezone from venues where id = {{venue}}::uuid), 'Asia/Baghdad')`),
  KEEP('ts_from', `select ((({{month}})::date::timestamp + make_interval(hours => {{hour}}::int)) at time zone {{tz}})::text`),
  KEEP('ts_last', `select ((({{last_month}})::date::timestamp + make_interval(hours => {{hour}}::int)) at time zone {{tz}})::text`),
];

/** A day and a café tab at a branch, written as fixtures. */
const TAB = (name: string, venue: string) => [
  KEEP(`${name}_day`, `insert into day_sessions (venue_id, business_date, opened_by, opening_float_iqd)
                       values (${venue}, date '3000-01-01' + (random() * 900000)::int, {{owner}}::uuid, 0)
                       returning id::text`),
  KEEP(name, `insert into tabs (venue_id, day_session_id, label, kind)
              values (${venue}, {{${name}_day}}::uuid, 'SR tab', 'cafe') returning id::text`),
];
/** `n` orders on a tab by a person at `at`, with a status. */
const ORDERS = (key: string, tab: string, venue: string, who: string, n: number, at: string, status = 'sent') =>
  KEEP(key, `with i as (
               insert into orders (tab_id, source, venue_id, placed_by_staff_id, status, placed_at)
               select {{${tab}}}::uuid, 'till', ${venue}, {{${who}}}::uuid, '${status}', ${at}
                 from generate_series(1, ${n})
               returning 1)
             select count(*)::text from i`);

const set = (label: string, who: string, target: string, n: number | string, iqd: number | string, prize = 'null', venue = '{{venue}}') =>
  T(label, who, `select to_jsonb(app.set_staff_reward(${venue}::uuid, {{${target}}}::uuid, ${n}, ${iqd}, ${prize}))`);
const end = (label: string, who: string, id: string) =>
  T(label, who, `select 'true'::jsonb from app.end_staff_reward(${id}::uuid)`);

interface Mine {
  month: string;
  month_end: string;
  days_left: number;
  count: number;
  rewards: Array<{ id: string; target: number; reward_iqd: number; prize: string | null }>;
  last_month: { month: string; count: number; reached: Array<{ target: number; reward_iqd: number; prize: string | null; pay_month: string | null }> };
}
interface Board {
  month: string;
  month_end: string;
  days_left: number;
  people: Array<{
    staff_id: string;
    name: string;
    role: string;
    count: number;
    last_month_count: number;
    rewards: Array<{ id: string; target: number; reward_iqd: number; prize: string | null; set_at: string }>;
  }>;
}

describe.skipIf(!docker)('staff rewards (rolled-back transactions)', () => {
  it('only the owner sets and ends rewards; the limits hold', () => {
    const r = scenario([
      MK('w1', 'waiter'), MK('bar', 'barista'), MK('gone', 'waiter', false),
      set('set1', 'owner', 'w1', 100, 50000), ID('r1', 'set1'),
      set('prize', 'owner', 'w1', 200, 0, `'  Dinner for two  '`), ID('r2', 'prize'),
      set('mgr', 'owner', 'manager', 50, 10000),
      set('cash', 'owner', 'cashier', 50, 10000),
      // The person.
      set('bar', 'owner', 'bar', 10, 1000),
      set('gone', 'owner', 'gone', 10, 1000),
      set('owner_target', 'owner', 'owner', 10, 1000),
      set('prep_target', 'owner', 'prep', 10, 1000),
      T('nobody', 'owner', `select to_jsonb(app.set_staff_reward({{venue}}::uuid, gen_random_uuid(), 10, 1000))`),
      // The values.
      set('t0', 'owner', 'w1', 0, 1000),
      set('t_big', 'owner', 'w1', 100001, 1000),
      set('neg', 'owner', 'w1', 10, -1),
      set('rich', 'owner', 'w1', 10, 10000001),
      set('long', 'owner', 'w1', 10, 0, `repeat('x', 81)`),
      set('empty', 'owner', 'w1', 10, 0, `'   '`),
      set('nothing', 'owner', 'w1', 10, 'null'),
      set('max', 'owner', 'w1', 100000, 10000000, `repeat('y', 80)`),
      // One per target, five per person.
      set('taken', 'owner', 'w1', 100, 1000),
      set('r4', 'owner', 'w1', 300, 1000),
      set('r5', 'owner', 'w1', 400, 1000),
      set('sixth', 'owner', 'w1', 500, 1000),
      // Ending frees the target and a place.
      end('end1', 'owner', '{{r1}}'),
      end('end_again', 'owner', '{{r1}}'),
      end('end_missing', 'owner', 'gen_random_uuid()'),
      set('sixth_after', 'owner', 'w1', 500, 1000),
      set('full_again', 'owner', 'w1', 600, 1000),
      end('end2', 'owner', '{{r2}}'),
      set('reuse_target', 'owner', 'w1', 100, 2000),
      // Everyone else is refused.
      set('by_manager', 'manager', 'w1', 10, 1000),
      set('by_waiter', 'w1', 'w1', 10, 1000),
      set('by_cashier', 'cashier', 'w1', 10, 1000),
      end('end_manager', 'manager', '{{r2}}'),
      end('end_waiter', 'w1', '{{r2}}'),
      T('board_manager', 'manager', `select app.staff_rewards_board({{venue}})`),
      T('board_waiter', 'w1', `select app.staff_rewards_board({{venue}})`),
      T('board_cashier', 'cashier', `select app.staff_rewards_board({{venue}})`),
      // The table: the owner reads it; nobody writes it.
      T('read_owner', 'owner', `select to_jsonb(count(*)) from staff_rewards where staff_id = {{w1}}::uuid`),
      T('read_manager', 'manager', `select to_jsonb(count(*)) from staff_rewards`),
      T('read_waiter', 'w1', `select to_jsonb(count(*)) from staff_rewards`),
      T('write_owner', 'owner', `insert into staff_rewards (venue_id, staff_id, target, reward_iqd, set_by)
                                 values ({{venue}}::uuid, {{w1}}::uuid, 999, 1, {{owner}}::uuid) returning to_jsonb(id)`),
      Q('row_prize', `select to_jsonb(prize) from staff_rewards where id = {{r2}}::uuid`),
      Q('row_ended', `select jsonb_build_object('by', ended_by, 'at', ended_at is not null) from staff_rewards where id = {{r1}}::uuid`),
    ]);
    for (const l of ['set1', 'prize', 'mgr', 'cash', 'max', 'r4', 'r5', 'end1', 'sixth_after', 'end2', 'reuse_target']) ok(r, l);
    expect(ok<string>(r, 'row_prize')).toBe('Dinner for two');
    expect(ok(r, 'row_ended')).toEqual({ by: SEED_STAFF_IDS.owner, at: true });
    for (const l of ['bar', 'gone', 'owner_target', 'prep_target', 'nobody']) {
      expect(refused(r, l), l).toBe('REWARD_STAFF_INVALID');
    }
    expect(refused(r, 't0')).toBe('REWARD_INVALID:target');
    expect(refused(r, 't_big')).toBe('REWARD_INVALID:target');
    expect(refused(r, 'neg')).toBe('REWARD_INVALID:reward_iqd');
    expect(refused(r, 'rich')).toBe('REWARD_INVALID:reward_iqd');
    expect(refused(r, 'long')).toBe('REWARD_INVALID:prize');
    expect(refused(r, 'empty')).toBe('REWARD_INVALID:empty');
    expect(refused(r, 'nothing')).toBe('REWARD_INVALID:empty');
    expect(refused(r, 'taken')).toBe('REWARD_TARGET_TAKEN');
    expect(refused(r, 'sixth')).toBe('REWARD_LIMIT');
    expect(refused(r, 'full_again')).toBe('REWARD_LIMIT');
    expect(refused(r, 'end_again')).toBe('REF_NOT_FOUND:id');
    expect(refused(r, 'end_missing')).toBe('REF_NOT_FOUND:id');
    for (const l of ['by_manager', 'by_waiter', 'by_cashier', 'end_manager', 'end_waiter',
                     'board_manager', 'board_waiter', 'board_cashier']) {
      expect(refused(r, l), l).toBe('FORBIDDEN');
    }
    // set1, prize, max, r4, r5, sixth_after, reuse_target.
    expect(ok<number>(r, 'read_owner')).toBe(7);
    expect(ok<number>(r, 'read_manager')).toBe(0);
    expect(ok<number>(r, 'read_waiter')).toBe(0);
    expect(refused(r, 'write_owner')).toMatch(/permission denied/);
  });

  it('a person reads only their own count: voided, other people and other branches excluded', () => {
    const r = scenario([
      ...MONTHS,
      `insert into venues (id, slug, name_en, name_ar, is_active)
         values ('${OTHER_VENUE}', 'sr-other-venue', 'SR other', 'فرع آخر', false);`,
      // A reward set on the seed cashier by hand on the local stack must not
      // decide the board's "nobody set" row below (rolled back with the rest).
      `update staff_rewards set ended_at = now(), ended_by = set_by
        where staff_id = '${SEED_STAFF_IDS.cashier}' and ended_at is null;`,
      MK('w1', 'waiter'), MK('w2', 'waiter'), MK('bar', 'barista'),
      ...TAB('tab', '{{venue}}'),
      ...TAB('far_tab', `'${OTHER_VENUE}'::uuid`),
      // w1 this month: 3 live now, 1 voided, 1 at the very start of the month.
      ORDERS('o1', 'tab', '{{venue}}', 'w1', 3, 'now()'),
      ORDERS('o2', 'tab', '{{venue}}', 'w1', 1, 'now()', 'voided'),
      ORDERS('o3', 'tab', '{{venue}}', 'w1', 1, '{{ts_from}}::timestamptz', 'served'),
      // w1 last month: one a second before this month began; one before last month.
      ORDERS('o4', 'tab', '{{venue}}', 'w1', 1, `{{ts_from}}::timestamptz - interval '1 second'`, 'served'),
      ORDERS('o5', 'tab', '{{venue}}', 'w1', 1, `{{ts_last}}::timestamptz - interval '1 second'`, 'served'),
      // w1 at another branch; w2 more than w1 at this one.
      ORDERS('o6', 'far_tab', `'${OTHER_VENUE}'::uuid`, 'w1', 4, 'now()'),
      ORDERS('o7', 'tab', '{{venue}}', 'w2', 6, 'now()', 'preparing'),
      set('w1_r', 'owner', 'w1', 200, 50000, `'Dinner for two'`),
      set('w1_r2', 'owner', 'w1', 10, 5000),
      set('w2_r', 'owner', 'w2', 300, 70000),
      T('mine_w1', 'w1', `select app.my_rewards({{venue}})`),
      T('mine_w1_default', 'w1', `select app.my_rewards()`),
      T('mine_w2', 'w2', `select app.my_rewards({{venue}})`),
      T('mine_owner', 'owner', `select app.my_rewards({{venue}})`),
      T('mine_bar', 'bar', `select app.my_rewards({{venue}})`),
      T('mine_far', 'w1', `select app.my_rewards('${OTHER_VENUE}')`),
      T('board', 'owner', `select app.staff_rewards_board({{venue}})`),
      Q('who', `select jsonb_build_object('month', {{month}}, 'last_month', {{last_month}}, 'month_end', {{month_end}},
                                          'days_left', ({{month_end}}::date - {{today}}::date + 1))`),
    ]);
    const who = ok<{ month: string; last_month: string; month_end: string; days_left: number }>(r, 'who');
    const w1 = ok<Mine>(r, 'mine_w1');
    expect(w1).toMatchObject({ month: who.month, month_end: who.month_end, days_left: who.days_left, count: 4 });
    expect(w1.rewards.map((x) => [x.target, x.reward_iqd, x.prize])).toEqual([[10, 5000, null], [200, 50000, 'Dinner for two']]);
    expect(Object.keys(w1.rewards[0]!).sort()).toEqual(['id', 'prize', 'reward_iqd', 'target']);
    expect(w1.last_month).toEqual({ month: who.last_month, count: 1, reached: [] });
    expect(ok<Mine>(r, 'mine_w1_default').count).toBe(4);
    // Nothing about anyone else reaches a person.
    // (ids left out: a random uuid may well contain "300").
    expect(JSON.stringify({ ...w1, rewards: w1.rewards.map(({ id: _id, ...x }) => x) })).not.toMatch(/300|70000/);
    const w2 = ok<Mine>(r, 'mine_w2');
    expect(w2.count).toBe(6);
    expect(w2.rewards.map((x) => x.target)).toEqual([300]);
    expect(ok<Mine>(r, 'mine_owner')).toMatchObject({ count: 0, rewards: [], last_month: { count: 0, reached: [] } });
    expect(ok<Mine>(r, 'mine_bar')).toMatchObject({ count: 0, rewards: [] });
    expect(refused(r, 'mine_far')).toBe('FORBIDDEN');

    const board = ok<Board>(r, 'board');
    expect(board).toMatchObject({ month: who.month, month_end: who.month_end, days_left: who.days_left });
    const ids = board.people.map((p) => p.staff_id);
    const of = (id: string) => board.people.find((p) => p.staff_id === id);
    // Waiters, cashiers and managers only: never the owner, the prep or a barista.
    expect(ids).toContain(SEED_STAFF_IDS.cashier);
    expect(ids).toContain(SEED_STAFF_IDS.manager);
    expect(ids).not.toContain(SEED_STAFF_IDS.owner);
    expect(ids).not.toContain(SEED_STAFF_IDS.prep);
    const w1Row = board.people.find((p) => p.name === 'SR w1')!;
    const w2Row = board.people.find((p) => p.name === 'SR w2')!;
    expect(board.people.find((p) => p.name === 'SR bar')).toBeUndefined();
    expect(w1Row).toMatchObject({ role: 'waiter', count: 4, last_month_count: 1 });
    expect(w1Row.rewards.map((x) => x.target)).toEqual([10, 200]);
    expect(Object.keys(w1Row.rewards[0]!).sort()).toEqual(['id', 'prize', 'reward_iqd', 'set_at', 'target']);
    expect(w2Row).toMatchObject({ count: 6, last_month_count: 0 });
    expect(of(SEED_STAFF_IDS.cashier)!.rewards).toEqual([]);
    // By name, not by count: w2 placed more and still comes after w1.
    expect(ids.indexOf(w1Row.staff_id)).toBeLessThan(ids.indexOf(w2Row.staff_id));
  });

  it('last month: the rewards active in it whose target its count reached', () => {
    const r = scenario([
      ...MONTHS,
      MK('w1', 'waiter'),
      ...TAB('tab', '{{venue}}'),
      ORDERS('last', 'tab', '{{venue}}', 'w1', 5, `{{ts_from}}::timestamptz - interval '1 hour'`, 'served'),
      ORDERS('now', 'tab', '{{venue}}', 'w1', 2, 'now()'),
      // a: active all along, 3 <= 5. b: ended inside last month, 5 <= 5.
      // c: 6 > 5. d: set this month. e: ended before last month began.
      set('a', 'owner', 'w1', 3, 30000), ID('a', 'a'),
      set('b', 'owner', 'w1', 5, 0, `'Cinema'`), ID('b', 'b'),
      set('c', 'owner', 'w1', 6, 60000), ID('c', 'c'),
      set('d', 'owner', 'w1', 2, 20000), ID('d', 'd'),
      set('e', 'owner', 'w1', 1, 10000), ID('e', 'e'),
      KEEP('back', `with u as (
                      update staff_rewards
                         set set_at = {{ts_from}}::timestamptz - interval '10 days'
                       where id in ({{a}}::uuid, {{b}}::uuid, {{c}}::uuid)
                      returning 1)
                    select count(*)::text from u`),
      KEEP('b_end', `with u as (
                       update staff_rewards
                          set ended_by = {{owner}}::uuid, ended_at = {{ts_from}}::timestamptz - interval '1 day'
                        where id = {{b}}::uuid
                       returning 1)
                     select count(*)::text from u`),
      KEEP('e_end', `with u as (
                       update staff_rewards
                          set set_at = {{ts_last}}::timestamptz - interval '20 days',
                              ended_by = {{owner}}::uuid, ended_at = {{ts_last}}::timestamptz - interval '1 day'
                        where id = {{e}}::uuid
                       returning 1)
                     select count(*)::text from u`),
      T('mine', 'w1', `select app.my_rewards({{venue}})`),
    ]);
    const mine = ok<Mine>(r, 'mine');
    expect(mine.count).toBe(2);
    expect(mine.rewards.map((x) => x.target)).toEqual([2, 3, 6]);
    expect(mine.last_month.count).toBe(5);
    // pay_month stays NULL until app.reward_sweep closes the month (0333,
    // reward-wages.test.ts).
    expect(mine.last_month.reached).toEqual([
      { target: 3, reward_iqd: 30000, prize: null, pay_month: null },
      { target: 5, reward_iqd: 0, prize: 'Cinema', pay_month: null },
    ]);
  });

  it('keeps rewards from the owner assistant: no readable column, and audit rows carry {status} only', () => {
    const r = scenario([
      MK('w1', 'waiter'),
      set('set', 'owner', 'w1', 250, 75000, `'Weekend trip'`), ID('r', 'set'),
      end('end', 'owner', '{{r}}'),
      Q('columns', `select to_jsonb(count(*)) from app.assistant_readable_columns where table_name = 'staff_rewards'`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'entity', a.entity, 'before', a.before,
                                                      'after', a.after, 'reason_code', a.reason_code) order by a.id)
                    from audit_log a
                   where a.action like 'staff.reward.%' and a.entity_id = {{r}}`),
    ]);
    ok(r, 'set');
    ok(r, 'end');
    expect(ok<number>(r, 'columns')).toBe(0);
    const audit = ok<Array<{ action: string; entity: string; before: object | null; after: object; reason_code: null }>>(r, 'audit');
    expect(audit.map((a) => [a.action, a.entity])).toEqual([
      ['staff.reward.set', 'staff_reward'],
      ['staff.reward.end', 'staff_reward'],
    ]);
    for (const a of audit) {
      expect(a.reason_code).toBeNull();
      for (const side of [a.before, a.after]) {
        if (side !== null) expect(Object.keys(side)).toEqual(['status']);
      }
    }
    expect(JSON.stringify(audit)).not.toMatch(/250|75000|Weekend|SR w1/);
  });
});
