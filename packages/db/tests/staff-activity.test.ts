/**
 * staff activity monitor (0341): one row per staff member and app (operator |
 * mobile), read by the owner only.
 *
 *   * who: any active staff member pings their own row; only the owner reads
 *     the board; a bad surface or state is INVALID_ARGUMENT;
 *   * the ping: records state, screen and version, and is throttled to one
 *     write per 20 s per row unless the state or the screen changed;
 *   * status, by the server's clock: online (seen < 2 min, foreground), away
 *     (< 15 min, or in the background), offline (signed out, or older), and
 *     a null part for an app the person never used;
 *   * last action: an audit row stamps the actor's row of the app named by
 *     `x-touch-app`, or the operator when only `x-station-id` is present;
 *     a request that names neither, and a guest's audit row, stamp nothing;
 *     an action after signing out brings the row back to active;
 *   * the board: active staff at the branches in scope (owners always), name
 *     order, `onBreak` from an open staff_breaks row.
 *
 * HOW. As staff-rewards.test.ts: every scenario is ONE psql transaction that
 * is rolled back; each call runs with the caller's JWT claims. now() is fixed
 * inside a transaction, so "time passing" is a fixture write that moves
 * last_seen_at back. Without docker on PATH the suite skips itself.
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

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.fx(p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);  -- 0230: a fixture write, not a staff write
  execute pg_temp.sub(p_sql);
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role, p_venue boolean default true, p_active boolean default true)
returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'sa-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SA ' || p_name, p_role, p_active);
  -- A new staff row may already be given the only open branch; make it exact.
  if p_venue then
    insert into staff_venues (staff_id, venue_id, role)
    select v, val::uuid, p_role from pg_temp.vars where name = 'venue'
    on conflict do nothing;
  else
    delete from staff_venues where staff_id = v;
  end if;
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

/** A call as `authenticated` with the caller's claims. */
const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
/** A call with the caller's claims but as the definer's role (write_audit is not granted). */
const AS = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, null);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const FX = (sql: string) => `select pg_temp.fx($q$${sql}$q$);`;
const MK = (name: string, role: string, venue = true, active = true) =>
  `select pg_temp.mk('${name}', '${role}', ${venue}, ${active});`;
/** The request's headers, as PostgREST sets them. */
const HEADERS = (h: Record<string, string>) =>
  `select set_config('request.headers', '${JSON.stringify(h)}', true);`;

const ping = (label: string, who: string, surface: string, state = 'active', screen = 'null', ver = 'null') =>
  T(label, who, `select app.staff_activity_ping('${surface}', '${state}', ${screen}, ${ver})`);
const board = (label: string, who = 'owner') => T(label, who, `select app.staff_activity_board()`);
const audit = (label: string, who: string, action: string) =>
  AS(label, who, `select to_jsonb(app.write_audit('${action}', 'test', 'x'))`);
const row = (label: string, who: string, surface: string) =>
  Q(label, `select to_jsonb(a) from staff_activity a where a.staff_id = {{${who}}}::uuid and a.surface = '${surface}'`);

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
  return o!.code!;
}

interface Part {
  status: string;
  state: string;
  lastSeenAt: string;
  screen: string | null;
  appVersion: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
}
interface BoardRow {
  staffId: string;
  name: string;
  role: string;
  onBreak: boolean;
  operator: Part | null;
  mobile: Part | null;
}
interface Board {
  serverTime: string;
  rows: BoardRow[];
}
interface ActivityRow {
  state: string;
  last_seen_at: string;
  screen: string | null;
  app_version: string | null;
  last_action: string | null;
}

const ids = (r: Results, label: string) => ok<Board>(r, label).rows.map((x) => x.staffId);
const vars = (r: Results, name: string) => ok<string>(r, `var:${name}`);
const VAR = (name: string) => Q(`var:${name}`, `select to_jsonb({{${name}}}::text)`);

describe.skipIf(!docker)('staff activity (0341)', () => {
  it('lets any staff member ping their own row and only the owner read the board', () => {
    const r = scenario([
      MK('waiter', 'waiter'),
      ping('waiter-ping', 'waiter', 'mobile', 'active', `'/staff-order'`, `'1.4.0'`),
      row('waiter-row', 'waiter', 'mobile'),
      ping('bad-surface', 'waiter', 'web'),
      ping('bad-state', 'waiter', 'mobile', 'asleep'),
      board('board-cashier', 'cashier'),
      board('board-manager', 'manager'),
      board('board-owner'),
    ]);
    ok(r, 'waiter-ping');
    const w = ok<ActivityRow>(r, 'waiter-row');
    expect(w.state).toBe('active');
    expect(w.screen).toBe('/staff-order');
    expect(w.app_version).toBe('1.4.0');
    expect(refused(r, 'bad-surface')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'bad-state')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'board-cashier')).toBe('FORBIDDEN');
    expect(refused(r, 'board-manager')).toBe('FORBIDDEN');
    expect(ok<Board>(r, 'board-owner').serverTime).toBeTruthy();
  });

  it('throttles a repeat ping, but never a change of state or screen', () => {
    const r = scenario([
      MK('w', 'waiter'),
      ping('first', 'w', 'operator', 'active', `'/till/tabs'`),
      FX(`update staff_activity set last_seen_at = now() - interval '10 seconds' where staff_id = {{w}}::uuid`),
      ping('repeat', 'w', 'operator', 'active', `'/till/tabs'`),
      Q('after-repeat', `select to_jsonb(last_seen_at < now()) from staff_activity where staff_id = {{w}}::uuid`),
      ping('new-screen', 'w', 'operator', 'active', `'/kds'`),
      Q('after-screen', `select to_jsonb(last_seen_at = now()) from staff_activity where staff_id = {{w}}::uuid`),
      FX(`update staff_activity set last_seen_at = now() - interval '10 seconds' where staff_id = {{w}}::uuid`),
      ping('background', 'w', 'operator', 'background'),
      row('after-bg', 'w', 'operator'),
      FX(`update staff_activity set last_seen_at = now() - interval '30 seconds' where staff_id = {{w}}::uuid`),
      ping('stale', 'w', 'operator', 'background'),
      Q('after-stale', `select to_jsonb(last_seen_at = now()) from staff_activity where staff_id = {{w}}::uuid`),
    ]);
    expect(ok<boolean>(r, 'after-repeat')).toBe(true);
    expect(ok<boolean>(r, 'after-screen')).toBe(true);
    const bg = ok<ActivityRow>(r, 'after-bg');
    expect(bg.state).toBe('background');
    // A ping without a screen keeps the last one.
    expect(bg.screen).toBe('/kds');
    expect(ok<boolean>(r, 'after-stale')).toBe(true);
  });

  it('works out each app\'s status by the server clock, and null for an app never used', () => {
    const r = scenario([
      MK('online', 'waiter'),
      MK('idle', 'waiter'),
      MK('bg', 'waiter'),
      MK('gone', 'waiter'),
      MK('out', 'waiter'),
      ping('p1', 'online', 'operator'),
      ping('p2', 'idle', 'operator'),
      ping('p3', 'bg', 'mobile', 'background'),
      ping('p4', 'gone', 'mobile'),
      ping('p5', 'out', 'operator', 'signed_out'),
      FX(`update staff_activity set last_seen_at = now() - interval '5 minutes' where staff_id = {{idle}}::uuid`),
      FX(`update staff_activity set last_seen_at = now() - interval '30 minutes' where staff_id = {{gone}}::uuid`),
      board('board'),
      VAR('online'), VAR('idle'), VAR('bg'), VAR('gone'), VAR('out'),
    ]);
    const rows = ok<Board>(r, 'board').rows;
    const by = (name: string) => rows.find((x) => x.staffId === vars(r, name))!;
    expect(by('online').operator?.status).toBe('online');
    expect(by('online').mobile).toBeNull();
    expect(by('idle').operator?.status).toBe('away');
    expect(by('bg').mobile?.status).toBe('away');
    expect(by('bg').operator).toBeNull();
    expect(by('gone').mobile?.status).toBe('offline');
    expect(by('out').operator?.status).toBe('offline');
    expect(by('out').operator?.state).toBe('signed_out');
  });

  it('stamps the last action on the app the request came from', () => {
    const r = scenario([
      MK('w', 'waiter'),
      HEADERS({ 'x-touch-app': 'mobile' }),
      audit('a-mobile', 'w', 'order.place'),
      HEADERS({ 'x-station-id': 'DEV1' }),
      audit('a-station', 'w', 'discount.apply'),
      HEADERS({ 'x-touch-app': 'operator', 'x-station-id': 'DEV1' }),
      audit('a-operator', 'w', 'tab.settle'),
      HEADERS({}),
      audit('a-none', 'w', 'stock.waste'),
      row('mobile', 'w', 'mobile'),
      row('operator', 'w', 'operator'),
    ]);
    ok(r, 'a-mobile');
    ok(r, 'a-none');
    expect(ok<ActivityRow>(r, 'mobile').last_action).toBe('order.place');
    // The station-only request, then the named one; the header-less one changes nothing.
    expect(ok<ActivityRow>(r, 'operator').last_action).toBe('tab.settle');
  });

  it('never stamps a guest\'s audit row, and an action after signing out is active again', () => {
    const r = scenario([
      MK('w', 'waiter'),
      ping('out', 'w', 'mobile', 'signed_out'),
      HEADERS({ 'x-touch-app': 'mobile' }),
      audit('act', 'w', 'order.place'),
      row('after', 'w', 'mobile'),
      FX(`insert into audit_log (actor_id, actor_role, action, entity, entity_id)
          values (gen_random_uuid(), 'guest', 'reservation.hold', 'reservation', 'x')`),
      Q('guest-rows', `select to_jsonb(count(*)) from staff_activity a
                        where not exists (select 1 from staff s where s.id = a.staff_id)`),
    ]);
    const after = ok<ActivityRow>(r, 'after');
    expect(after.state).toBe('active');
    expect(after.last_action).toBe('order.place');
    expect(ok<number>(r, 'guest-rows')).toBe(0);
  });

  it('lists active staff of the branches in scope, owners always, with breaks', () => {
    const r = scenario([
      MK('here', 'waiter'),
      MK('nowhere', 'waiter', false),
      MK('retired', 'waiter', true, false),
      FX(`insert into staff_breaks (staff_id, station_id, business_date, venue_id)
          values ({{here}}::uuid, 'DEV1', current_date, {{venue}}::uuid)`),
      board('board'),
      VAR('here'), VAR('nowhere'), VAR('retired'), VAR('owner'),
    ]);
    const list = ids(r, 'board');
    expect(list).toContain(vars(r, 'here'));
    expect(list).toContain(vars(r, 'owner'));
    expect(list).not.toContain(vars(r, 'nowhere'));
    expect(list).not.toContain(vars(r, 'retired'));
    const rows = ok<Board>(r, 'board').rows;
    expect(rows.find((x) => x.staffId === vars(r, 'here'))!.onBreak).toBe(true);
  });
});
