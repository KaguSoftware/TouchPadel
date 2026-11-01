/**
 * Dev monitoring (0392/0393): app.monitoring_events, app.report_event,
 * app.monitor, the panel's reads, the cron watcher and the retention.
 *
 *   * report_event: anon and authenticated may call it; it never raises,
 *     whatever it is handed; a client may claim only operator, mobile or web
 *     (the service role any source); PINs, tokens, phones and emails are
 *     dropped or masked; the message is capped at 1,000 chars and the detail at
 *     8 KB; 30 events per caller in 10 minutes, and 10 more pressed by a person.
 *   * RLS: the dev role and the owner read the table; a manager or a cashier
 *     reads nothing; no client writes it.
 *   * monitoring_events_page / monitoring_summary: dev and owner, FORBIDDEN
 *     for the rest.
 *   * app.monitor: no client grant; never raises.
 *   * monitoring_prune drops events older than 90 days.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (as
 * staff-activity.test.ts). Without docker on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
function ready(): boolean {
  try {
    return psql("select to_regprocedure('app.report_event(text,text,text,text,jsonb,text,boolean)') is not null") === 't';
  } catch {
    return false;
  }
}
const docker = up && ready();

const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create function pg_temp.as_who(p_role text, p_sub text, p_ip text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then jsonb_build_object('role', p_role)
         else jsonb_build_object('sub', p_sub, 'role', p_role) end::text, true);
  perform set_config('request.headers', jsonb_build_object('x-forwarded-for', coalesce(p_ip, '10.0.0.1'))::text, true);
end $f$;
create function pg_temp.run(p_label text, p_role text, p_sub text, p_sql text, p_ip text default null) returns void
language plpgsql as $f$
declare v jsonb; v_msg text;
begin
  perform pg_temp.as_who(p_role, p_sub, p_ip);
  execute 'set local role ' || p_role;
  begin
    execute p_sql into v;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', false, 'code', v_msg));
  end;
  perform set_config('request.jwt.claims', '', true);
end $f$;
create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  execute p_sql into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;
-- Start every scenario from an empty table (rolled back with the rest).
delete from app.monitoring_events where id > 0;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
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

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** report_event as `role` (anon | authenticated | service_role), returning nothing. */
const REPORT = (label: string, role: string, sub: string | null, args: string, ip?: string) =>
  `select pg_temp.run(${lit(label)}, ${lit(role)}, ${sub ? lit(sub) : 'null'}, ${lit(
    `select to_jsonb(app.report_event(${args})::text)`,
  )}, ${ip ? lit(ip) : 'null'});`;
const AS = (label: string, role: string, sub: string | null, sql: string) =>
  `select pg_temp.run(${lit(label)}, ${lit(role)}, ${sub ? lit(sub) : 'null'}, ${lit(sql)});`;
const Q = (label: string, sql: string) => `select pg_temp.q(${lit(label)}, ${lit(sql)});`;
const COUNT = (label: string, where = 'true') =>
  Q(label, `select to_jsonb(count(*)) from app.monitoring_events where ${where}`);

function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''}`).toBe(true);
  return o!.data as T;
}

const OWNER = SEED_STAFF_IDS.owner;
const MANAGER = SEED_STAFF_IDS.manager;
const CASHIER = SEED_STAFF_IDS.cashier;

describe.skipIf(!docker)('app.report_event (0393)', () => {
  it('stores a scrubbed event from anon and from a signed-in caller, and never raises', () => {
    const r = scenario([
      REPORT('anon', 'anon', null, `'mobile', 'error', 'crash', 'boom for a@b.com +964 770 123 4567', '{"pin":"1234","p_pin":"1","phone":"0770","nested":{"token":"x","note":"call 07701234567"},"route":"/book"}'::jsonb, '1.1.0', true`),
      REPORT('authed', 'authenticated', CASHIER, `'operator', 'warn', 'print_failed', 'no paper', '{}'::jsonb`),
      REPORT('nulls', 'anon', null, `null, null, null, null, null, null, null`),
      REPORT('garbage', 'anon', null, `'web', 'LOUD', 'Not A Kind', '', '[1,2,3]'::jsonb, repeat('v', 99), null`),
      Q('rows', `select jsonb_agg(jsonb_build_object('source', source, 'level', level, 'kind', kind, 'message', message, 'detail', detail, 'user', user_reported, 'staff', staff_id, 'version', app_version) order by id) from app.monitoring_events`),
    ]);
    for (const l of ['anon', 'authed', 'nulls', 'garbage']) ok(r, l);
    const rows = ok<Array<Record<string, unknown>>>(r, 'rows');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      source: 'mobile',
      level: 'error',
      kind: 'crash',
      message: 'boom for [email] [number]',
      detail: { route: '/book', nested: { note: 'call [number]' } },
      user: true,
      staff: null,
      version: '1.1.0',
    });
    expect(rows[1]).toMatchObject({ source: 'operator', level: 'warn', kind: 'print_failed', staff: CASHIER, user: false });
    expect(rows[2]).toMatchObject({ source: 'web', level: 'error', kind: 'unknown', message: 'unknown', detail: { value: [1, 2, 3] } });
    expect((rows[2]!.version as string).length).toBe(40);
  });

  it('keeps a digit-heavy UUID and an ISO date whole in the message and the detail, and still masks a phone', () => {
    const r = scenario([
      REPORT('ids', 'anon', null, `'web', 'error', 'web_error', 'branch c0000000-0000-4000-8000-000000000001 on 2026-11-01 call +964 770 123 4567', '{"venue":"c0000000-0000-4000-8000-000000000001","note":"11111111-2222-4333-8444-555555555555 rang 07701234567","card":"x"}'::jsonb`),
      Q('row', `select jsonb_build_object('message', message, 'detail', detail) from app.monitoring_events`),
    ]);
    ok(r, 'ids');
    expect(ok(r, 'row')).toEqual({
      message: 'branch c0000000-0000-4000-8000-000000000001 on 2026-11-01 call [number]',
      detail: { venue: 'c0000000-0000-4000-8000-000000000001', note: '11111111-2222-4333-8444-555555555555 rang [number]' },
    });
  });

  it('lets only the service role claim edge, db or cron', () => {
    const r = scenario([
      REPORT('anon-edge', 'anon', null, `'edge', 'error', 'crash', 'fake', '{}'::jsonb`),
      REPORT('authed-cron', 'authenticated', CASHIER, `'cron', 'error', 'crash', 'fake', '{}'::jsonb`),
      REPORT('svc-edge', 'service_role', null, `'edge', 'error', 'edge_error', 'real', '{"function":"replay"}'::jsonb`),
      Q('sources', `select jsonb_agg(source order by id) from app.monitoring_events`),
    ]);
    ok(r, 'anon-edge');
    ok(r, 'authed-cron');
    ok(r, 'svc-edge');
    expect(ok(r, 'sources')).toEqual(['edge']);
  });

  it('caps the message and the detail, and drops a body that is plainly too big', () => {
    const big = `jsonb_build_object(${Array.from({ length: 30 }, (_, i) => `'k${i}', repeat('v', 400)`).join(', ')})`;
    const r = scenario([
      REPORT('long', 'anon', null, `'web', 'error', 'web_error', repeat('m', 5000), ${big}`),
      REPORT('huge', 'anon', null, `'web', 'error', 'web_error', repeat('m', 30000), '{}'::jsonb`),
      Q('rows', `select jsonb_agg(jsonb_build_object('len', char_length(message), 'truncated', detail->'truncated', 'keys', jsonb_array_length(detail->'keys'))) from app.monitoring_events`),
    ]);
    ok(r, 'long');
    ok(r, 'huge');
    expect(ok(r, 'rows')).toEqual([{ len: 1000, truncated: true, keys: 30 }]);
  });

  it('rate-limits a caller: 30 in 10 minutes, and 10 more pressed by a person', () => {
    const body: string[] = [];
    for (let i = 0; i < 35; i++) body.push(REPORT(`a${i}`, 'anon', null, `'mobile', 'error', 'crash', 'loop ${i}', '{}'::jsonb`, '203.0.113.7'));
    for (let i = 0; i < 12; i++) body.push(REPORT(`u${i}`, 'anon', null, `'mobile', 'error', 'crash', 'pressed ${i}', '{}'::jsonb, null, true`, '203.0.113.7'));
    // Another caller is not held by the first one's limit.
    body.push(REPORT('other', 'anon', null, `'mobile', 'error', 'crash', 'other', '{}'::jsonb`, '198.51.100.9'));
    body.push(COUNT('auto', 'not user_reported'), COUNT('pressed', 'user_reported'));
    const r = scenario(body);
    for (let i = 0; i < 35; i++) ok(r, `a${i}`);
    expect(ok(r, 'auto')).toBe(31);
    expect(ok(r, 'pressed')).toBe(10);
  });
});

describe.skipIf(!docker)('who reads monitoring (0393)', () => {
  const seed = [
    REPORT('seed', 'anon', null, `'web', 'error', 'web_error', 'menu failed', '{}'::jsonb`),
    REPORT('seed2', 'anon', null, `'mobile', 'warn', 'crash', 'pressed', '{}'::jsonb, null, true`),
  ];

  it('RLS: the owner and the dev role read the table, a manager and a cashier read nothing, nobody writes it', () => {
    const r = scenario([
      ...seed,
      // A dev account for this transaction only: the seeded cashier, moved to dev.
      Q('mkdev', `with u as (update staff set role = 'dev' where id = '${CASHIER}' returning id) select to_jsonb(count(*)) from u`),
      AS('owner', 'authenticated', OWNER, `select to_jsonb(count(*)) from app.monitoring_events`),
      AS('dev', 'authenticated', CASHIER, `select to_jsonb(count(*)) from app.monitoring_events`),
      AS('manager', 'authenticated', MANAGER, `select to_jsonb(count(*)) from app.monitoring_events`),
      AS('anon', 'anon', null, `select to_jsonb(count(*)) from app.monitoring_events`),
      AS('insert', 'authenticated', OWNER, `insert into app.monitoring_events (source, level, kind, message) values ('web','error','x','y') returning to_jsonb(id)`),
    ]);
    expect(ok(r, 'mkdev')).toBe(1);
    expect(ok(r, 'owner')).toBe(2);
    expect(ok(r, 'dev')).toBe(2);
    expect(ok(r, 'manager')).toBe(0);
    expect(r.anon!.ok).toBe(false);
    expect(r.insert!.ok).toBe(false);
  });

  it('the panel reads: dev and owner, FORBIDDEN for a manager; filters and paging', () => {
    const r = scenario([
      ...seed,
      Q('mkdev', `with u as (update staff set role = 'dev' where id = '${CASHIER}' returning id) select to_jsonb(count(*)) from u`),
      AS('page-owner', 'authenticated', OWNER, `select app.monitoring_events_page()`),
      AS('page-dev', 'authenticated', CASHIER, `select app.monitoring_events_page(p_user_reported => true)`),
      AS('page-small', 'authenticated', OWNER, `select app.monitoring_events_page(p_limit => 1)`),
      AS('page-manager', 'authenticated', MANAGER, `select app.monitoring_events_page()`),
      AS('sum-owner', 'authenticated', OWNER, `select app.monitoring_summary(p_bucket => 'day')`),
      AS('sum-manager', 'authenticated', MANAGER, `select app.monitoring_summary()`),
    ]);
    const page = ok<{ rows: Array<{ kind: string; userReported: boolean }>; nextBeforeId: number | null }>(r, 'page-owner');
    expect(page.rows.map((e) => e.kind)).toEqual(['crash', 'web_error']);
    expect(page.nextBeforeId).toBeNull();
    const dev = ok<{ rows: Array<{ userReported: boolean }> }>(r, 'page-dev');
    expect(dev.rows).toHaveLength(1);
    expect(dev.rows[0]!.userReported).toBe(true);
    const small = ok<{ rows: unknown[]; nextBeforeId: number | null }>(r, 'page-small');
    expect(small.rows).toHaveLength(1);
    expect(small.nextBeforeId).not.toBeNull();
    expect(r['page-manager']).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const sum = ok<{ bucket: string; totals: Record<string, number>; kinds: unknown[] }>(r, 'sum-owner');
    expect(sum.bucket).toBe('day');
    expect(sum.totals).toMatchObject({ total: 2, error: 1, warn: 1, userReported: 1 });
    expect(sum.kinds).toHaveLength(2);
    expect(r['sum-manager']).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe.skipIf(!docker)('app.monitor, the cron watcher and retention (0393)', () => {
  it('app.monitor stores from SQL, is not granted to clients, and never raises', () => {
    const r = scenario([
      Q('monitor', `select to_jsonb(app.monitor('cron', 'error', 'cron_failed', 'tp_x failed', '{"job":"tp_x","secret":"s"}'::jsonb)::text)`),
      Q('bad', `select to_jsonb(app.monitor(null, null, null, null, null)::text)`),
      AS('client', 'authenticated', OWNER, `select to_jsonb(app.monitor('db', 'error', 'x', 'y')::text)`),
      Q('rows', `select jsonb_agg(jsonb_build_object('source', source, 'kind', kind, 'detail', detail) order by id) from app.monitoring_events`),
    ]);
    ok(r, 'monitor');
    ok(r, 'bad');
    expect(r.client!.ok).toBe(false);
    expect(ok(r, 'rows')).toEqual([
      { source: 'cron', kind: 'cron_failed', detail: { job: 'tp_x' } },
      { source: 'db', kind: 'unknown', detail: {} },
    ]);
  });

  it('the cron watcher runs and bookmarks; retention drops events older than 90 days', () => {
    const r = scenario([
      Q('watch', `select to_jsonb(app.monitor_cron_failures())`),
      Q('checked', `select to_jsonb(checked_at is not null) from app.monitoring_cursor`),
      Q('old', `insert into app.monitoring_events (at, source, level, kind, message) values (now() - interval '91 days', 'web', 'error', 'x', 'old'), (now() - interval '89 days', 'web', 'error', 'x', 'kept') returning to_jsonb(id)`),
      Q('prune', `select to_jsonb(app.monitoring_prune())`),
      Q('left', `select jsonb_agg(message) from app.monitoring_events where kind = 'x'`),
    ]);
    expect(typeof ok(r, 'watch')).toBe('number');
    expect(ok(r, 'checked')).toBe(true);
    expect(ok(r, 'prune')).toBe(1);
    expect(ok(r, 'left')).toEqual(['kept']);
  });
});

// 0394: the sweeps that catch a branch's error and carry on report it.
describe('cron sweeps that catch their errors report them (0394)', () => {
  const dir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const latestBody = (name: string): string => {
    for (const f of [...files].reverse()) {
      const sql = readFileSync(dir + f, 'utf8');
      const hits = [...sql.matchAll(new RegExp(`create (or replace )?function app\\.${name}\\(`, 'g'))];
      if (hits.length === 0) continue;
      const at = hits.at(-1)!.index!;
      const tag = sql.slice(at).match(/as (\$[a-z_0-9]+\$)/)![1]!;
      const start = sql.indexOf(tag, at) + tag.length;
      return sql.slice(start, sql.indexOf(tag, start));
    }
    throw new Error(`no body for ${name}`);
  };
  it.each(['protocol_remind_sweep', 'reward_sweep', 'shop_reward_sweep'])('%s calls app.monitor in its branch handler', (name) => {
    const body = latestBody(name);
    const handler = body.slice(body.indexOf('exception when others then'));
    expect(handler).toMatch(/raise warning/);
    expect(handler).toMatch(/perform app\.monitor\('cron', 'error', 'cron_failed'/);
  });

  it.skipIf(!docker)('the three sweeps still run', () => {
    const r = scenario([
      Q('remind', `select to_jsonb(app.protocol_remind_sweep())`),
      Q('reward', `select app.reward_sweep()`),
      Q('shop', `select app.shop_reward_sweep()`),
    ]);
    ok(r, 'remind');
    ok(r, 'reward');
    ok(r, 'shop');
  });
});
