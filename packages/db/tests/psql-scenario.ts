/**
 * One rolled-back psql transaction per scenario, each call made as
 * `authenticated` with the caller's JWT claims: the harness of
 * staff-access.test.ts (0345), shared by the 0380–0386 tests
 * (branch-isolation, second-jobs, blocked-areas, setup-checks, prune-jobs).
 * Nothing a scenario writes survives it. Without docker on PATH, `docker` is
 * false and the stack parts skip themselves.
 */
import { execFileSync } from 'node:child_process';
import { stackAvailable, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

export function psql(sql: string): string {
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

export const docker = (await stackAvailable()) && dockerReachable();

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
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text; v_detail text;
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
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, ''),
                                        'detail', nullif(v_detail, '')));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb; v_msg text; v_detail text;
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    execute pg_temp.sub(p_sql) into v;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'detail', nullif(v_detail, '')));
  end;
end $f$;

create function pg_temp.fx(p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);  -- 0230: a fixture write, not a staff write
  execute pg_temp.sub(p_sql);
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role, p_venue_var text default 'venue', p_active boolean default true)
returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'ldb-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'LDB ' || p_name, p_role, p_active);
  delete from staff_venues where staff_id = v;
  if p_venue_var is not null then
    insert into staff_venues (staff_id, venue_id, role)
    select v, val::uuid, p_role from pg_temp.vars where name = p_venue_var
    on conflict do nothing;
  end if;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;
`;

export interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
  detail?: string | null;
}
export type Results = Record<string, Outcome>;

export function scenario(body: string[]): Results {
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
export const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
/** A read as postgres (no claims). */
export const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
/** A fixture write as postgres (no claims). */
export const FX = (sql: string) => `select pg_temp.fx($q$${sql}$q$);`;
/** A new active staff member `name` with `role`, filed at the branch held in var `venueVar` (null: none). */
export const MK = (name: string, role: string, venueVar: string | null = 'venue', active = true) =>
  `select pg_temp.mk('${name}', '${role}', ${venueVar === null ? 'null' : `'${venueVar}'`}, ${active});`;
/** Bind var `name` to the text result of a postgres query. */
export const LET = (name: string, sql: string) =>
  FX(`with v(val) as (${sql}) insert into pg_temp.vars select '${name}', val::text from v`);
