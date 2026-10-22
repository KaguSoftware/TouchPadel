/**
 * staff access (0345): second jobs and blocked pages, per person.
 *
 *   * who: only an owner saves (FORBIDDEN for MGMT and staff), never their own
 *     row (CANNOT_EDIT_SELF) nor an owner's (INVALID_ARGUMENT), STAFF_NOT_FOUND
 *     for an unknown id, INVALID_ARGUMENT for a job outside the front line or
 *     an area outside the list;
 *   * the save: both lists replaced, sorted, once each, without the main role;
 *     audited as staff.access_set;
 *   * the wall: app.is_staff counts a second job (and is_staff_at, which asks
 *     it), never for an inactive row, and still reads false (not NULL) for a
 *     guest; app.staff_ids_with_roles finds the second-job holder;
 *   * the person reads their own two columns (the apps need them);
 *   * the SQL lists equal packages/core/src/staff/access.ts (pure, always runs).
 *
 * HOW. As staff-activity.test.ts: every scenario is ONE psql transaction that
 * is rolled back; each call runs with the caller's JWT claims. Without docker
 * on PATH the stack part skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCESS_AREA_KEYS, SECOND_JOB_ROLES } from '../../core/src/staff/access';
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
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const FX = (sql: string) => `select pg_temp.fx($q$${sql}$q$);`;
const MK = (name: string, role: string, venue = true, active = true) =>
  `select pg_temp.mk('${name}', '${role}', ${venue}, ${active});`;

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20261016000345_staff_access.sql', import.meta.url)),
  'utf8',
);

// 0360 re-issued the CHECK and set_staff_access with the 'insights' area, so
// the area lists are read from it; the second-job lists from 0345 and 0360 alike.
const MIGRATION_0360 = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20261022000360_marketing_insights.sql', import.meta.url)),
  'utf8',
);

/** Every `array[...]::<cast>` literal of the migration with that cast, as lists. */
function sqlArrays(cast: string, sql = MIGRATION): string[][] {
  const re = new RegExp(`array\\[([^\\]]*)\\]::${cast}\\[\\]`, 'g');
  return [...sql.matchAll(re)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!));
}

describe('0345 lists match @touch/core', () => {
  it('second jobs: the CHECK and the RPC hold SECOND_JOB_ROLES', () => {
    const lists = sqlArrays('staff_role').filter((l) => l.length > 0);
    expect(lists.length).toBe(2);
    for (const l of lists) expect([...l].sort()).toEqual([...SECOND_JOB_ROLES].sort());
  });
  it('second jobs: 0360\'s re-issued RPC holds SECOND_JOB_ROLES', () => {
    const lists = sqlArrays('staff_role', MIGRATION_0360).filter((l) => l.length > 0);
    expect(lists.length).toBe(1);
    for (const l of lists) expect([...l].sort()).toEqual([...SECOND_JOB_ROLES].sort());
  });
  it('areas: the CHECK and the RPC (0360) hold ACCESS_AREA_KEYS', () => {
    const lists = sqlArrays('text', MIGRATION_0360).filter((l) => l.length > 0);
    expect(lists.length).toBe(2);
    for (const l of lists) expect([...l].sort()).toEqual([...ACCESS_AREA_KEYS].sort());
  });
});

const SET = (who: string, args: string) =>
  `select app.set_staff_access(${args})`;

describe.skipIf(!docker)('0345 set_staff_access', () => {
  it('only an owner saves, and never their own row or an owner\'s', () => {
    const r = scenario([
      MK('c1', 'cashier'),
      MK('o2', 'owner'),
      T('mgr', 'manager', SET('manager', `{{c1}}::uuid, '{court_desk}', '{}'`)),
      T('cash', 'cashier', SET('cashier', `{{c1}}::uuid, '{court_desk}', '{}'`)),
      T('self', 'owner', SET('owner', `{{owner}}::uuid, '{court_desk}', '{}'`)),
      T('owner2', 'owner', SET('owner', `{{o2}}::uuid, '{court_desk}', '{}'`)),
      T('missing', 'owner', SET('owner', `gen_random_uuid(), '{court_desk}', '{}'`)),
      T('mgrJob', 'owner', SET('owner', `{{c1}}::uuid, '{manager}', '{}'`)),
      T('headJob', 'owner', SET('owner', `{{c1}}::uuid, '{head_chef}', '{}'`)),
      T('badArea', 'owner', SET('owner', `{{c1}}::uuid, '{}', '{nope}'`)),
    ]);
    expect(r.mgr).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(r.cash).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(r.self).toMatchObject({ ok: false, code: 'CANNOT_EDIT_SELF' });
    expect(r.owner2).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(r.missing).toMatchObject({ ok: false, code: 'STAFF_NOT_FOUND' });
    expect(r.mgrJob).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', hint: 'extra_roles' });
    expect(r.headJob).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', hint: 'extra_roles' });
    expect(r.badArea).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', hint: 'blocked_areas' });
  });

  it('saves both lists sorted, once each, without the main role, and audits it', () => {
    const r = scenario([
      MK('c1', 'cashier'),
      T('save', 'owner', SET('owner', `{{c1}}::uuid, '{waiter,court_desk,cashier,court_desk}', '{reports,till,reports}'`)),
      Q('row', `select jsonb_build_object('extra', extra_roles, 'blocked', blocked_areas) from staff where id = {{c1}}::uuid`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'staff.access_set' and entity_id = {{c1}}`),
      T('clear', 'owner', SET('owner', `{{c1}}::uuid, null, null`)),
      Q('cleared', `select jsonb_build_object('extra', extra_roles, 'blocked', blocked_areas) from staff where id = {{c1}}::uuid`),
    ]);
    expect(r.save?.ok).toBe(true);
    expect(r.row?.data).toEqual({ extra: ['court_desk', 'waiter'], blocked: ['reports', 'till'] });
    expect(r.audit?.data).toBe(1);
    expect(r.cleared?.data).toEqual({ extra: [], blocked: [] });
  });

  it('a second job opens that job\'s guards and pushes, and nothing above it', () => {
    const r = scenario([
      MK('c1', 'cashier'),
      MK('off', 'cashier', true, false),
      FX(`insert into pg_temp.vars values ('guest', gen_random_uuid()::text)`),
      T('before', 'c1', `select to_jsonb(app.is_staff('court_desk', 'manager', 'owner'))`),
      T('save', 'owner', SET('owner', `{{c1}}::uuid, '{court_desk}', '{}'`)),
      FX(`update staff set extra_roles = '{court_desk}' where id = {{off}}::uuid`),
      T('desk', 'c1', `select to_jsonb(app.is_staff('court_desk', 'manager', 'owner'))`),
      T('deskAt', 'c1', `select to_jsonb(app.is_staff_at({{venue}}::uuid, 'court_desk'))`),
      T('own', 'c1', `select to_jsonb(app.is_staff('cashier'))`),
      T('mgmt', 'c1', `select to_jsonb(app.is_staff('manager', 'owner'))`),
      T('inactive', 'off', `select to_jsonb(app.is_staff('court_desk'))`),
      T('guest', 'guest', `select to_jsonb(app.is_staff('court_desk'))`),
      Q('push', `select to_jsonb({{c1}}::uuid = any(app.staff_ids_with_roles({{venue}}::uuid, '{court_desk}')))`),
      Q('pushOff', `select to_jsonb({{off}}::uuid = any(app.staff_ids_with_roles({{venue}}::uuid, '{court_desk}')))`),
      T('read', 'c1', `select jsonb_build_object('extra', extra_roles, 'blocked', blocked_areas) from staff where id = auth.uid()`),
    ]);
    expect(r.before?.data).toBe(false);
    expect(r.save?.ok).toBe(true);
    expect(r.desk?.data).toBe(true);
    expect(r.deskAt?.data).toBe(true);
    expect(r.own?.data).toBe(true);
    expect(r.mgmt?.data).toBe(false);
    expect(r.inactive?.data).toBe(false);
    expect(r.guest?.data).toBe(false);
    expect(r.push?.data).toBe(true);
    expect(r.pushOff?.data).toBe(false);
    expect(r.read).toMatchObject({ ok: true, data: { extra: ['court_desk'], blocked: [] } });
  });
});
