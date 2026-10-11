/**
 * reward wages (0333): a reward reached in a business month becomes a bonus on
 * the person's wage once the month ends, and the person hears when they reach
 * one.
 *
 *   * month close: app.reward_sweep turns every reward active at any moment of
 *     the month that ended, whose target that month's count reached, into one
 *     staff_reward_earnings row (amount and prize copied, prize-only rows
 *     too), paid in the first unpaid wage month from the month after (a paid
 *     month is frozen, so it lands in the next one); idempotent, and frozen
 *     after a later void;
 *   * the wage: app.wage_line adds the bonuses whose pay month it is
 *     (bonuses_iqd, bonus_count, bonuses[]), the net is salary - deductions -
 *     penalties + bonuses, app.mark_wage_paid snapshots them and refuses a
 *     net that left them out (WAGE_CHANGED), and the wage_payments CHECK holds
 *     the new net;
 *   * my_rewards: last month's reached rewards carry pay_month, NULL until the
 *     month is closed, then built from the frozen earnings;
 *   * the push: the first time in a business month a person's count reaches
 *     an active reward, one reward_unlocked push to that person only, with no
 *     amount, prize, name or id; never twice for the same reward and month;
 *   * who: reward_sweep is the service role's alone; the owner reads the
 *     earnings, nobody else does, and no client reads the unlocks;
 *   * the LLM wall: no assistant_readable_columns row for either table.
 *
 * HOW. As staff-rewards.test.ts: every scenario is ONE psql transaction that
 * is rolled back; staff, a day, tabs and orders are created inside it, each
 * client call runs as `authenticated` with the caller's JWT claims, and the
 * sweep runs as `service_role` with no claims (the cron's caller). Without
 * docker on PATH the suite skips itself.
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
/**
 * The first business day of a month: the month that just ended is not closed
 * yet (the boundary's open orders may still be voided), so the cases that
 * close last month run on any other day and the grace case runs on this one.
 */
const day1 = docker
  && psql(`select app.venue_business_date('${VENUE_A_ID}'::uuid)
                = date_trunc('month', app.venue_business_date('${VENUE_A_ID}'::uuid))::date`) === 't';

// ── the in-transaction harness (as staff-rewards.test.ts) ───────────────────
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('venue', '${VENUE_A_ID}');

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

-- The cron's caller: the service role, no JWT claims.
create function pg_temp.svc(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb; v_msg text; v_sql text := pg_temp.sub(p_sql);
begin
  perform set_config('request.jwt.claims', '', true);
  set local role service_role;
  begin
    execute v_sql into v;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', false, 'code', v_msg));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

-- q() that records an error instead of aborting (a CHECK's refusal).
create function pg_temp.tq(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb; v_msg text;
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    execute pg_temp.sub(p_sql) into v;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', false, 'code', v_msg));
  end;
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);  -- 0230: a fixture write, not a staff write
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'rw-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'RW ' || p_name, p_role, true);
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
const TQ = (label: string, sql: string) => `select pg_temp.tq('${label}', $q$${sql}$q$);`;
const SWEEP = (label: string) => `select pg_temp.svc('${label}', $q$select app.reward_sweep()$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;

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

/** The branch's business months as the RPCs bound them (0332). */
const MONTHS = [
  KEEP('today', `select app.venue_business_date({{venue}}::uuid)::text`),
  KEEP('month', `select date_trunc('month', app.venue_business_date({{venue}}::uuid))::date::text`),
  KEEP('last_month', `select (date_trunc('month', app.venue_business_date({{venue}}::uuid)) - interval '1 month')::date::text`),
  KEEP('next_month', `select (date_trunc('month', app.venue_business_date({{venue}}::uuid)) + interval '1 month')::date::text`),
  KEEP('hour', `select coalesce(app.cafe_setting_int('analytics_business_day_start_hour', {{venue}}::uuid), 4)::text`),
  KEEP('tz', `select coalesce((select timezone from venues where id = {{venue}}::uuid), 'Asia/Baghdad')`),
  KEEP('ts_from', `select ((({{month}})::date::timestamp + make_interval(hours => {{hour}}::int)) at time zone {{tz}})::text`),
  KEEP('ts_last', `select ((({{last_month}})::date::timestamp + make_interval(hours => {{hour}}::int)) at time zone {{tz}})::text`),
];

/** A day and a café tab at the branch, written as fixtures. */
const TAB = [
  KEEP('tab_day', `insert into day_sessions (venue_id, business_date, opened_by, opening_float_iqd)
                   values ({{venue}}, date '3000-01-01' + (random() * 900000)::int, {{owner}}::uuid, 0)
                   returning id::text`),
  KEEP('tab', `insert into tabs (venue_id, day_session_id, label, kind)
               values ({{venue}}, {{tab_day}}::uuid, 'RW tab', 'cafe') returning id::text`),
];
/** `n` orders by a person at `at`. */
const ORDERS = (key: string, who: string, n: number, at: string) =>
  KEEP(key, `with i as (
               insert into orders (tab_id, source, venue_id, placed_by_staff_id, status, placed_at)
               select {{tab}}::uuid, 'till', {{venue}}, {{${who}}}::uuid, 'served', ${at}
                 from generate_series(1, ${n})
               returning 1)
             select count(*)::text from i`);

const set = (label: string, target: string, n: number, iqd: number, prize = 'null') =>
  T(label, 'owner', `select to_jsonb(app.set_staff_reward({{venue}}::uuid, {{${target}}}::uuid, ${n}, ${iqd}, ${prize}))`);
/** Moves rewards' set_at to ten days before this month began: active all of last month. */
const BACKDATE = (key: string, ids: string[]) =>
  KEEP(key, `with u as (
               update staff_rewards set set_at = {{ts_from}}::timestamptz - interval '10 days'
                where id in (${ids.map((i) => `{{${i}}}::uuid`).join(', ')})
               returning 1)
             select count(*)::text from u`);
const setWage = (label: string, target: string, salary: number) =>
  T(label, 'owner', `select app.set_staff_wage({{${target}}}::uuid, ${salary}, 28, {{month}}::date)`);
const line = (label: string, target: string, month: string) =>
  T(label, 'owner', `select p from jsonb_array_elements(app.wages_month({{venue}}, ${month})->'people') p
                      where p->>'staff_id' = {{${target}}}`);

interface Earning {
  target: number;
  reward_iqd: number;
  prize: string | null;
  earned_month: string;
  pay_month: string;
}
interface Line {
  status: string;
  bonus_only: boolean;
  salary_iqd: number;
  deductions_iqd: number;
  penalties_iqd: number;
  bonuses_iqd: number;
  bonus_count: number;
  bonuses: Array<{ id: string; earned_month: string; target: number; reward_iqd: number; prize: string | null }>;
  net_iqd: number;
}
interface Reached {
  target: number;
  reward_iqd: number;
  prize: string | null;
  pay_month: string | null;
}

describe.skipIf(!docker)('reward wages (rolled-back transactions)', () => {
  it.skipIf(day1)('a closed month turns reached rewards into bonuses on the next unpaid wage', () => {
    const earnings = (label: string, who: string) =>
      Q(label, `select coalesce(jsonb_agg(jsonb_build_object('target', target, 'reward_iqd', reward_iqd, 'prize', prize,
                                                          'earned_month', earned_month, 'pay_month', pay_month)
                                        order by target), '[]'::jsonb)
                  from staff_reward_earnings where staff_id = {{${who}}}::uuid`);
    const r = scenario([
      ...MONTHS,
      MK('w1', 'waiter'), MK('w2', 'waiter'),
      ...TAB,
      setWage('wage_w1', 'w1', 500000),
      setWage('wage_w2', 'w2', 400000),
      // Last month: w1 and w2 placed 5 orders each; this month w1 placed 1.
      ORDERS('w1_last', 'w1', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      ORDERS('w2_last', 'w2', 5, `{{ts_from}}::timestamptz - interval '2 hours'`),
      ORDERS('w1_now', 'w1', 1, 'now()'),
      // a 3 <= 5, b prize only 5 <= 5, c 6 > 5, d set this month (not active last month).
      set('a', 'w1', 3, 30000), ID('a', 'a'),
      set('b', 'w1', 5, 0, `'Cinema'`), ID('b', 'b'),
      set('c', 'w1', 6, 60000), ID('c', 'c'),
      set('d', 'w1', 1, 10000),
      set('e', 'w2', 4, 40000), ID('e', 'e'),
      BACKDATE('back', ['a', 'b', 'c', 'e']),
      // w2's wage for this month is already paid: the bonus goes to next month.
      T('pay_w2_first', 'owner', `select app.mark_wage_paid({{w2}}::uuid, {{month}}::date, 400000)`),
      T('mine_open', 'w1', `select app.my_rewards({{venue}})`),
      // Nobody but the service role runs the sweep.
      T('sweep_owner', 'owner', `select app.reward_sweep()`),
      SWEEP('sweep1'),
      earnings('w1_rows', 'w1'),
      earnings('w2_rows', 'w2'),
      SWEEP('sweep2'),
      // A later void never takes a bonus back.
      KEEP('void', `with u as (update orders set status = 'voided'
                                where placed_by_staff_id = {{w1}}::uuid and tab_id = {{tab}}::uuid
                               returning 1)
                    select count(*)::text from u`),
      SWEEP('sweep3'),
      earnings('w1_rows_after', 'w1'),
      T('mine_closed', 'w1', `select app.my_rewards({{venue}})`),
      // The wage.
      line('line_w1', 'w1', '{{month}}::date'),
      line('line_w2_next', 'w2', '{{next_month}}::date'),
      T('totals', 'owner', `select app.wages_month({{venue}}, {{month}}::date)->'totals'`),
      T('pay_stale', 'owner', `select app.mark_wage_paid({{w1}}::uuid, {{month}}::date, 500000)`),
      T('pay_w1', 'owner', `select app.mark_wage_paid({{w1}}::uuid, {{month}}::date, 530000)`),
      Q('snap', `select jsonb_build_object('bonuses_iqd', bonuses_iqd, 'bonus_count', bonus_count,
                                           'net_iqd', net_iqd, 'paid_iqd', paid_iqd)
                   from wage_payments where staff_id = {{w1}}::uuid and pay_month = {{month}}::date`),
      line('line_w1_paid', 'w1', '{{month}}::date'),
      // The table: the owner reads it; nobody else, and no client writes it.
      T('read_owner', 'owner', `select to_jsonb(count(*)) from staff_reward_earnings where staff_id = {{w1}}::uuid`),
      T('read_manager', 'manager', `select to_jsonb(count(*)) from staff_reward_earnings`),
      T('read_w1', 'w1', `select to_jsonb(count(*)) from staff_reward_earnings`),
      T('write_owner', 'owner', `insert into staff_reward_earnings (venue_id, staff_id, reward_id, earned_month, target,
                                                                    reward_iqd, pay_month)
                                 values ({{venue}}::uuid, {{w1}}::uuid, {{c}}::uuid, {{last_month}}::date, 6, 1,
                                         {{next_month}}::date) returning to_jsonb(id)`),
      // The net CHECK holds the bonuses.
      TQ('chk_bad', `insert into wage_payments (venue_id, staff_id, pay_month, due_date, salary_iqd, deductions_iqd,
                                                deduction_count, penalties_iqd, penalty_days, bonuses_iqd, bonus_count,
                                                net_iqd, paid_iqd, paid_by)
                     values ({{venue}}::uuid, {{w2}}::uuid, {{last_month}}::date, {{last_month}}::date, 1000, 0, 0, 0, 0,
                             500, 1, 1000, 1000, {{owner}}::uuid) returning to_jsonb(id)`),
      TQ('chk_good', `insert into wage_payments (venue_id, staff_id, pay_month, due_date, salary_iqd, deductions_iqd,
                                                 deduction_count, penalties_iqd, penalty_days, bonuses_iqd, bonus_count,
                                                 net_iqd, paid_iqd, paid_by)
                      values ({{venue}}::uuid, {{w2}}::uuid, {{last_month}}::date, {{last_month}}::date, 1000, 200, 1, 0, 0,
                              500, 1, 1300, 1300, {{owner}}::uuid) returning to_jsonb(id)`),
      Q('who', `select jsonb_build_object('month', {{month}}, 'last_month', {{last_month}}, 'next_month', {{next_month}})`),
    ]);
    const who = ok<{ month: string; last_month: string; next_month: string }>(r, 'who');
    ok(r, 'wage_w1');
    ok(r, 'wage_w2');
    ok(r, 'pay_w2_first');

    // Before the sweep closed the month, reached is live and has no pay month.
    expect(ok<{ last_month: { reached: Reached[] } }>(r, 'mine_open').last_month.reached).toEqual([
      { target: 3, reward_iqd: 30000, prize: null, pay_month: null },
      { target: 5, reward_iqd: 0, prize: 'Cinema', pay_month: null },
    ]);

    expect(refused(r, 'sweep_owner')).toMatch(/permission denied/);
    expect(ok(r, 'sweep1')).toMatchObject({ earnings: 3 });
    expect(ok<Earning[]>(r, 'w1_rows')).toEqual([
      { target: 3, reward_iqd: 30000, prize: null, earned_month: who.last_month, pay_month: who.month },
      { target: 5, reward_iqd: 0, prize: 'Cinema', earned_month: who.last_month, pay_month: who.month },
    ]);
    // M+1 was paid already: the next unpaid month.
    expect(ok<Earning[]>(r, 'w2_rows')).toEqual([
      { target: 4, reward_iqd: 40000, prize: null, earned_month: who.last_month, pay_month: who.next_month },
    ]);
    expect(ok(r, 'sweep2')).toMatchObject({ earnings: 0 });
    expect(ok(r, 'sweep3')).toMatchObject({ earnings: 0 });
    expect(ok<Earning[]>(r, 'w1_rows_after')).toEqual(ok<Earning[]>(r, 'w1_rows'));

    const closed = ok<{ count: number; last_month: { count: number; reached: Reached[] } }>(r, 'mine_closed');
    expect(closed.last_month.count).toBe(0); // the live count moved; the earnings did not
    expect(closed.last_month.reached).toEqual([
      { target: 3, reward_iqd: 30000, prize: null, pay_month: who.month },
      { target: 5, reward_iqd: 0, prize: 'Cinema', pay_month: who.month },
    ]);

    const w1 = ok<Line>(r, 'line_w1');
    expect(w1).toMatchObject({ salary_iqd: 500000, deductions_iqd: 0, penalties_iqd: 0,
                               bonuses_iqd: 30000, bonus_count: 1, bonus_only: false, net_iqd: 530000 });
    expect(w1.bonuses.map((b) => [b.earned_month, b.target, b.reward_iqd, b.prize])).toEqual([
      [who.last_month, 3, 30000, null],
      [who.last_month, 5, 0, 'Cinema'],
    ]);
    expect(Object.keys(w1.bonuses[0]!).sort()).toEqual(['earned_month', 'id', 'prize', 'reward_iqd', 'target']);
    expect(ok<Line>(r, 'line_w2_next')).toMatchObject({ salary_iqd: 400000, bonuses_iqd: 40000, bonus_count: 1, net_iqd: 440000 });
    expect(ok(r, 'totals')).toMatchObject({ bonuses_iqd: 30000 });

    expect(refused(r, 'pay_stale')).toBe('WAGE_CHANGED');
    expect(ok(r, 'pay_w1')).toMatchObject({ status: 'paid', net_iqd: 530000, paid_iqd: 530000 });
    expect(ok(r, 'snap')).toEqual({ bonuses_iqd: 30000, bonus_count: 1, net_iqd: 530000, paid_iqd: 530000 });
    const paid = ok<Line>(r, 'line_w1_paid');
    expect(paid).toMatchObject({ status: 'paid', bonuses_iqd: 30000, bonus_count: 1, net_iqd: 530000 });
    expect(paid.bonuses).toHaveLength(2);

    expect(ok<number>(r, 'read_owner')).toBe(2);
    expect(ok<number>(r, 'read_manager')).toBe(0);
    expect(ok<number>(r, 'read_w1')).toBe(0);
    expect(refused(r, 'write_owner')).toMatch(/permission denied/);

    expect(refused(r, 'chk_bad')).toMatch(/wage_payments_net_chk/);
    ok(r, 'chk_good');
  });

  it('pushes an unlocked reward once, to the person only, with no amount', () => {
    const pushes = (label: string) =>
      Q(label, `select coalesce(jsonb_agg(jsonb_build_object('to', profile_id, 'kind', kind, 'payload', payload)
                                        order by payload->>'dedupe'), '[]'::jsonb)
                  from notification_outbox
                 where payload->>'title_key' = 'reward_unlocked'
                   and profile_id in ({{w1}}::uuid, {{w2}}::uuid, {{owner}}::uuid, {{manager}}::uuid)`);
    const r = scenario([
      ...MONTHS,
      MK('w1', 'waiter'), MK('w2', 'waiter'),
      ...TAB,
      ORDERS('w1_now', 'w1', 3, 'now()'),
      ORDERS('w2_now', 'w2', 1, 'now()'),
      set('r1', 'w1', 2, 20000), ID('r1', 'r1'),
      set('r2', 'w1', 3, 0, `'Dinner for two'`), ID('r2', 'r2'),
      set('r3', 'w1', 10, 99000),
      set('r4', 'w2', 2, 20000),
      // An ended reward is never pushed, reached or not.
      set('r5', 'w1', 1, 5000), ID('r5', 'r5'),
      T('end5', 'owner', `select 'true'::jsonb from app.end_staff_reward({{r5}}::uuid)`),
      SWEEP('sweep1'),
      pushes('after1'),
      Q('unlocks', `select coalesce(jsonb_agg(jsonb_build_object('reward', reward_id, 'month', business_month, 'staff', staff_id)
                                            order by reward_id), '[]'::jsonb)
                      from staff_reward_unlocks where staff_id in ({{w1}}::uuid, {{w2}}::uuid)`),
      // Past the outbox's 15-minute dedupe, the unlock row still stops a second push.
      KEEP('age', `with u as (update notification_outbox set created_at = now() - interval '1 hour'
                               where payload->>'title_key' = 'reward_unlocked' returning 1)
                   select count(*)::text from u`),
      SWEEP('sweep2'),
      pushes('after2'),
      T('unlocks_owner', 'owner', `select to_jsonb(count(*)) from staff_reward_unlocks`),
      T('unlocks_w1', 'w1', `select to_jsonb(count(*)) from staff_reward_unlocks`),
      Q('columns', `select to_jsonb(count(*)) from app.assistant_readable_columns
                     where table_name in ('staff_reward_earnings', 'staff_reward_unlocks')`),
      Q('who', `select jsonb_build_object('month', {{month}}, 'w1', {{w1}}, 'r1', {{r1}}, 'r2', {{r2}})`),
    ]);
    const who = ok<{ month: string; w1: string; r1: string; r2: string }>(r, 'who');
    expect(ok(r, 'sweep1')).toMatchObject({ unlocks: 2, pushes: 2 });
    const rows = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'after1');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.to).toBe(who.w1);
      expect(row.kind).toBe('staff_info');
      expect(Object.keys(row.payload).sort()).toEqual(['dedupe', 'route', 'title_key']);
      expect(row.payload).toMatchObject({ route: 'staff-rewards', title_key: 'reward_unlocked' });
    }
    expect(JSON.stringify(rows)).not.toMatch(/20000|Dinner|RW w1/);
    expect(ok<Array<{ reward: string; month: string; staff: string }>>(r, 'unlocks')
      .map((u) => [u.reward, u.month, u.staff]).sort()).toEqual(
      [[who.r1, who.month, who.w1], [who.r2, who.month, who.w1]].sort(),
    );
    expect(ok(r, 'sweep2')).toMatchObject({ unlocks: 0, pushes: 0 });
    expect(ok<unknown[]>(r, 'after2')).toHaveLength(2);
    expect(refused(r, 'unlocks_owner')).toMatch(/permission denied/);
    expect(refused(r, 'unlocks_w1')).toMatch(/permission denied/);
    expect(ok<number>(r, 'columns')).toBe(0);
  });
  it.skipIf(day1)('a reward removed and set again at the same target pays once, the one set last', () => {
    const r = scenario([
      ...MONTHS,
      MK('w1', 'waiter'),
      ...TAB,
      setWage('wage_w1', 'w1', 500000),
      ORDERS('w1_last', 'w1', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      // The owner changes the amount the only way the screens offer: remove, add.
      set('old', 'w1', 3, 30000), ID('old', 'old'),
      T('end_old', 'owner', `select 'true'::jsonb from app.end_staff_reward({{old}}::uuid)`),
      set('new', 'w1', 3, 50000), ID('new', 'new'),
      // Both were active during last month: the old one first, then the new one.
      KEEP('back', `with u as (
                      update staff_rewards
                         set set_at   = case when id = {{old}}::uuid then {{ts_from}}::timestamptz - interval '20 days'
                                             else {{ts_from}}::timestamptz - interval '10 days' end,
                             ended_at = case when id = {{old}}::uuid then {{ts_from}}::timestamptz - interval '10 days'
                                             else ended_at end
                       where id in ({{old}}::uuid, {{new}}::uuid)
                      returning 1)
                    select count(*)::text from u`),
      T('mine_open', 'w1', `select app.my_rewards({{venue}})`),
      SWEEP('sweep1'),
      SWEEP('sweep2'),
      Q('rows', `select coalesce(jsonb_agg(jsonb_build_object('reward', reward_id, 'target', target,
                                                           'reward_iqd', reward_iqd) order by reward_id), '[]'::jsonb)
                   from staff_reward_earnings where staff_id = {{w1}}::uuid`),
      T('mine_closed', 'w1', `select app.my_rewards({{venue}})`),
      line('line_w1', 'w1', '{{month}}::date'),
      Q('who', `select jsonb_build_object('new', {{new}})`),
    ]);
    const who = ok<{ new: string }>(r, 'who');
    expect(ok<{ last_month: { reached: Reached[] } }>(r, 'mine_open').last_month.reached).toEqual([
      { target: 3, reward_iqd: 50000, prize: null, pay_month: null },
    ]);
    expect(ok(r, 'sweep1')).toMatchObject({ earnings: 1 });
    expect(ok(r, 'sweep2')).toMatchObject({ earnings: 0 });
    expect(ok(r, 'rows')).toEqual([{ reward: who.new, target: 3, reward_iqd: 50000 }]);
    expect(ok<{ last_month: { reached: Reached[] } }>(r, 'mine_closed').last_month.reached).toHaveLength(1);
    expect(ok<Line>(r, 'line_w1')).toMatchObject({ salary_iqd: 500000, bonuses_iqd: 50000, bonus_count: 1,
                                                   net_iqd: 550000 });
  });

  it('a reward removed and set again at the same target is announced once in a month', () => {
    const r = scenario([
      ...MONTHS,
      MK('w1', 'waiter'),
      ...TAB,
      ORDERS('w1_now', 'w1', 5, 'now()'),
      set('old', 'w1', 3, 30000), ID('old', 'old'),
      SWEEP('sweep1'),
      T('end_old', 'owner', `select 'true'::jsonb from app.end_staff_reward({{old}}::uuid)`),
      set('new', 'w1', 3, 50000),
      KEEP('age', `with u as (update notification_outbox set created_at = now() - interval '1 hour'
                               where payload->>'title_key' = 'reward_unlocked' returning 1)
                   select count(*)::text from u`),
      SWEEP('sweep2'),
      Q('pushes', `select to_jsonb(count(*)) from notification_outbox
                    where payload->>'title_key' = 'reward_unlocked' and profile_id = {{w1}}::uuid`),
    ]);
    expect(ok(r, 'sweep1')).toMatchObject({ unlocks: 1, pushes: 1 });
    expect(ok(r, 'sweep2')).toMatchObject({ unlocks: 0, pushes: 0 });
    expect(ok<number>(r, 'pushes')).toBe(1);
  });

  it.skipIf(day1)('a bonus for someone who left is paid without a salary for a month not worked', () => {
    const r = scenario([
      ...MONTHS,
      MK('gone', 'waiter'), MK('back', 'waiter'),
      ...TAB,
      setWage('wage_gone', 'gone', 500000),
      setWage('wage_back', 'back', 500000),
      ORDERS('gone_last', 'gone', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      ORDERS('back_last', 'back', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      // back worked this month too (an order), then both left the branch.
      ORDERS('back_now', 'back', 1, 'now()'),
      set('g', 'gone', 3, 30000), ID('g', 'g'),
      set('b', 'back', 3, 30000), ID('b', 'b'),
      BACKDATE('backdate', ['g', 'b']),
      KEEP('leave', `with u as (update staff set is_active = false
                                 where id in ({{gone}}::uuid, {{back}}::uuid) returning 1)
                     select count(*)::text from u`),
      KEEP('leave_sv', `with d as (delete from staff_venues
                                    where staff_id in ({{gone}}::uuid, {{back}}::uuid) returning 1)
                        select count(*)::text from d`),
      line('before', 'gone', '{{month}}::date'),
      SWEEP('sweep'),
      line('gone_line', 'gone', '{{month}}::date'),
      line('back_line', 'back', '{{month}}::date'),
      T('totals', 'owner', `select app.wages_month({{venue}}, {{month}}::date)->'totals'`),
      T('pay_gone', 'owner', `select app.mark_wage_paid({{gone}}::uuid, {{month}}::date, 30000)`),
      Q('snap', `select jsonb_build_object('salary_iqd', salary_iqd, 'bonuses_iqd', bonuses_iqd,
                                           'net_iqd', net_iqd, 'paid_iqd', paid_iqd)
                   from wage_payments where staff_id = {{gone}}::uuid and pay_month = {{month}}::date`),
    ]);
    ok(r, 'wage_gone');
    ok(r, 'wage_back');
    // Before the bonus landed, the leaver is not on this month's page at all.
    expect(ok(r, 'before')).toBeNull();
    expect(ok(r, 'sweep')).toMatchObject({ earnings: 2 });
    expect(ok<Line>(r, 'gone_line')).toMatchObject({ bonus_only: true, salary_iqd: 0, bonuses_iqd: 30000,
                                                     net_iqd: 30000 });
    // An order this month is work this month: the salary stays.
    expect(ok<Line>(r, 'back_line')).toMatchObject({ bonus_only: false, salary_iqd: 500000, bonuses_iqd: 30000,
                                                     net_iqd: 530000 });
    expect(ok(r, 'pay_gone')).toMatchObject({ status: 'paid', net_iqd: 30000, paid_iqd: 30000 });
    expect(ok(r, 'snap')).toEqual({ salary_iqd: 0, bonuses_iqd: 30000, net_iqd: 30000, paid_iqd: 30000 });
  });

  it.skipIf(day1)('a month with no salary but a bonus is paid for the bonus alone', () => {
    const r = scenario([
      ...MONTHS,
      MK('unset', 'waiter'), MK('zero', 'waiter'), MK('prize', 'waiter'),
      ...TAB,
      setWage('wage_zero', 'zero', 0),
      ORDERS('unset_last', 'unset', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      ORDERS('zero_last', 'zero', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      ORDERS('prize_last', 'prize', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      set('u', 'unset', 3, 30000), ID('u', 'u'),
      set('z', 'zero', 3, 20000), ID('z', 'z'),
      set('p', 'prize', 3, 0, `'Cinema'`), ID('p', 'p'),
      BACKDATE('backdate', ['u', 'z', 'p']),
      SWEEP('sweep'),
      line('unset_line', 'unset', '{{month}}::date'),
      T('pay_unset', 'owner', `select app.mark_wage_paid({{unset}}::uuid, {{month}}::date, 30000)`),
      T('pay_zero', 'owner', `select app.mark_wage_paid({{zero}}::uuid, {{month}}::date, 20000)`),
      T('pay_prize', 'owner', `select app.mark_wage_paid({{prize}}::uuid, {{month}}::date)`),
      Q('snap', `select jsonb_build_object('salary_iqd', salary_iqd, 'bonuses_iqd', bonuses_iqd, 'net_iqd', net_iqd,
                                           'paid_iqd', paid_iqd, 'due_date', due_date)
                   from wage_payments where staff_id = {{unset}}::uuid and pay_month = {{month}}::date`),
      line('unset_paid', 'unset', '{{month}}::date'),
      Q('open', `select to_jsonb(app.wage_open_month({{venue}}::uuid, {{unset}}::uuid, {{month}}::date))`),
      Q('who', `select jsonb_build_object('month_end', (({{month}})::date + interval '1 month')::date - 1,
                                          'next_month', {{next_month}})`),
    ]);
    const who = ok<{ month_end: string; next_month: string }>(r, 'who');
    expect(ok(r, 'sweep')).toMatchObject({ earnings: 3 });
    expect(ok<Line>(r, 'unset_line')).toMatchObject({ status: 'unset', salary_iqd: 0, bonuses_iqd: 30000,
                                                      net_iqd: 30000 });
    expect(ok(r, 'pay_unset')).toMatchObject({ status: 'paid', net_iqd: 30000, paid_iqd: 30000 });
    expect(ok(r, 'pay_zero')).toMatchObject({ status: 'paid', net_iqd: 20000, paid_iqd: 20000 });
    // A prize has no money to pay: nothing to mark paid.
    expect(refused(r, 'pay_prize')).toBe('WAGE_NOT_SET');
    expect(ok(r, 'snap')).toEqual({ salary_iqd: 0, bonuses_iqd: 30000, net_iqd: 30000, paid_iqd: 30000,
                                    due_date: who.month_end });
    expect(ok<Line>(r, 'unset_paid')).toMatchObject({ status: 'paid', bonuses_iqd: 30000 });
    expect(ok(r, 'open')).toBe(who.next_month);
  });

  it('closes a month the sweep missed entirely', () => {
    const r = scenario([
      ...MONTHS,
      KEEP('m2', `select (({{last_month}})::date - interval '1 month')::date::text`),
      MK('w1', 'waiter'),
      ...TAB,
      // No later month closed at the branch yet (a fixture: the rollback restores it).
      KEEP('clear', `with d as (delete from staff_reward_earnings where venue_id = {{venue}}::uuid returning 1)
                     select count(*)::text from d`),
      // Two months ago: 5 orders, a reward at 3 active all through it.
      ORDERS('w1_m2', 'w1', 5, `{{ts_last}}::timestamptz - interval '1 hour'`),
      set('a', 'w1', 3, 30000), ID('a', 'a'),
      KEEP('back', `with u as (update staff_rewards set set_at = {{ts_last}}::timestamptz - interval '40 days'
                                where id = {{a}}::uuid returning 1)
                    select count(*)::text from u`),
      SWEEP('sweep1'),
      SWEEP('sweep2'),
      Q('rows', `select coalesce(jsonb_agg(jsonb_build_object('earned_month', earned_month, 'pay_month', pay_month,
                                                           'reward_iqd', reward_iqd)), '[]'::jsonb)
                   from staff_reward_earnings where staff_id = {{w1}}::uuid`),
      Q('who', `select jsonb_build_object('m2', {{m2}}, 'last_month', {{last_month}})`),
    ]);
    const who = ok<{ m2: string; last_month: string }>(r, 'who');
    expect(ok(r, 'sweep1')).toMatchObject({ earnings: 1 });
    expect(ok(r, 'sweep2')).toMatchObject({ earnings: 0 });
    // Paid in the first unpaid month after the month it was reached in.
    expect(ok(r, 'rows')).toEqual([{ earned_month: who.m2, pay_month: who.last_month, reward_iqd: 30000 }]);
  });

  it.runIf(day1)('on the first business day the month that just ended is not closed yet', () => {
    const r = scenario([
      ...MONTHS,
      MK('w1', 'waiter'),
      ...TAB,
      ORDERS('w1_last', 'w1', 5, `{{ts_from}}::timestamptz - interval '1 hour'`),
      set('a', 'w1', 3, 30000), ID('a', 'a'),
      BACKDATE('back', ['a']),
      SWEEP('sweep'),
      T('mine', 'w1', `select app.my_rewards({{venue}})`),
    ]);
    expect(ok(r, 'sweep')).toMatchObject({ earnings: 0 });
    expect(ok<{ last_month: { reached: Reached[] } }>(r, 'mine').last_month.reached).toEqual([
      { target: 3, reward_iqd: 30000, prize: null, pay_month: null },
    ]);
  });
});
