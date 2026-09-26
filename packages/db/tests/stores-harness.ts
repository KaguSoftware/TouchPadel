/**
 * The shared harness of the wave-5 store suites (stock-locations,
 * stock-counts, stock-transfers, stock-logs and stock-store-reads .test.ts;
 * docs/design/protocols/wave5-addendum-2026-09-25.md §2.8, §6.1).
 *
 * Two ways in:
 *
 *   * scenario() — ONE psql transaction that is rolled back (the
 *     protocols-engine-flow.test.ts harness): staff, ingredients and batches
 *     are created inside it, each call runs as `authenticated` with the
 *     caller's JWT claims, and nothing is committed. This is where almost
 *     every invariant is checked; stock_movements is append-only, so a
 *     committed scenario would leave its rows behind for good.
 *   * psqlSession() — a psql session of its own, run in the background and
 *     committed, for the cases that need two transactions at once: an
 *     advisory lock held while another call waits on it. The HTTP clients of
 *     helpers.ts carry the Promise.all concurrency cases.
 *
 * Without docker on PATH the suites skip themselves.
 */
import { execFileSync, spawn } from 'node:child_process';
import { expect } from 'vitest';
import { SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

export const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

/** A venue nobody here works at (inactive, so nothing else resolves to it). */
export const OTHER_VENUE = '00000000-0000-4000-8000-00000000c5c5';

export const TAX = 'b0000000-0000-4000-8000-000000000001';

export function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

export function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}

/**
 * A psql session of its own, in the background: resolves with its output
 * once it ends (committed or not), rejects when psql fails.
 */
export function psqlSession(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exited ${code}`))));
    child.stdin.end(sql);
  });
}

/** The SQL that runs one statement as a staff member inside a committed session. */
export const asStaff = (staffId: string, sql: string) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: staffId, role: 'authenticated' })}', true);
set local role authenticated;
${sql};
reset role;`;

// ── the in-transaction harness ─────────────────────────────────────────────
// t() runs one statement as a staff member (as `authenticated`); q() reads as
// postgres; x() runs as postgres, or as the role named by xas(); keep() stores
// a value; mk() makes an auth user and a staff row (the 0123 trigger files a
// non-owner at venue A); ing() an ingredient; batch() a live batch with the
// goods_in movement a receipt would have written, so a batch always holds
// what its movements say (I2).
function prelude(tag: string): string {
  return `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}'), ('other_venue', '${OTHER_VENUE}'),
  ('tax', '${TAX}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.t(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text; v_detail text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.x(p_sql text) returns void language plpgsql as $f$
begin
  execute pg_temp.sub(p_sql);
end $f$;

create function pg_temp.xas(p_role text, p_sql text) returns void language plpgsql as $f$
declare v_sql text := pg_temp.sub(p_sql);
begin
  execute 'set local role ' || p_role;
  execute v_sql;
  reset role;
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, '${tag}-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, '${tag.toUpperCase()} ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

create function pg_temp.ing(p_name text, p_kind ingredient_kind, p_unit stock_unit, p_venue uuid,
                            p_pack_size numeric, p_pack_cost bigint, p_threshold numeric)
returns void language plpgsql as $f$
declare v uuid;
begin
  insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id, pack_size, pack_cost_iqd,
                           low_stock_threshold)
  values (p_kind, '${tag.toUpperCase()} ' || p_name, 'مادة ' || p_name, p_unit, true, p_venue, p_pack_size,
          p_pack_cost, p_threshold)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

create function pg_temp.batch(p_label text, p_ing text, p_location stock_location, p_qty numeric, p_cost numeric,
                              p_expiry_days int, p_age_minutes int)
returns void language plpgsql as $f$
declare v_ing uuid := (select val::uuid from pg_temp.vars where name = p_ing); v uuid;
        v_at timestamptz := now() - make_interval(mins => p_age_minutes);
        v_venue uuid := (select venue_id from ingredients where id = v_ing);
begin
  insert into stock_batches (ingredient_id, received_at, expiry_date, qty_received, qty_remaining, unit_cost_iqd,
                             venue_id, location)
  values (v_ing, v_at, case when p_expiry_days is null then null else current_date + p_expiry_days end,
          p_qty, p_qty, p_cost, v_venue, p_location)
  returning id into v;
  insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd, venue_id, at)
  values (v_ing, v, 'goods_in', p_qty, p_cost, v_venue, v_at);
  insert into pg_temp.vars values (p_label, v::text);
end $f$;

insert into venues (id, slug, name_en, name_ar, is_active)
values ('${OTHER_VENUE}', '${tag}-other-venue', '${tag.toUpperCase()} other', 'مكان آخر', false);
`;
}

export interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
  detail?: string | null;
}
export type Results = Record<string, Outcome>;

/** One rolled-back transaction: the prelude, the body, then every recorded result. */
export function scenario(tag: string, body: string[]): Results {
  const raw = psql(
    `begin;\n${prelude(tag)}\n${body.join('\n')}\n` +
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

export const T = (label: string, who: string, sql: string) => `select pg_temp.t('${label}', '${who}', $q$${sql}$q$);`;
export const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
export const X = (sql: string) => `select pg_temp.x($q$${sql}$q$);`;
export const XAS = (role: string, sql: string) => `select pg_temp.xas('${role}', $q$${sql}$q$);`;
export const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
export const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
export const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;

export interface IngOpts {
  venue?: string;
  packSize?: number | null;
  packCost?: number | null;
  threshold?: number | null;
}
export const ING = (name: string, kind: 'purchased' | 'prepared' | 'retail', unit: 'g' | 'ml' | 'pc', o: IngOpts = {}) =>
  `select pg_temp.ing('${name}', '${kind}', '${unit}', '${o.venue ?? VENUE_A_ID}', ${o.packSize ?? 'null'}, ` +
  `${o.packCost ?? 'null'}, ${o.threshold ?? 'null'});`;

/** A live batch at a store, received `ageMinutes` ago, expiring in `expiryDays` (null: no expiry). */
export const BATCH = (label: string, ing: string, location: 'cafe' | 'bakery', qty: number, cost: number,
                      expiryDays: number | null = null, ageMinutes = 60) =>
  `select pg_temp.batch('${label}', '${ing}', '${location}', ${qty}, ${cost}, ${expiryDays ?? 'null'}, ${ageMinutes});`;

/** A JSON array of lines, e.g. LINES([['milk', 'qty', 100]]) -> jsonb_build_array(jsonb_build_object(...)). */
export const LINES = (lines: Array<Record<string, string | number>>) =>
  `jsonb_build_array(${lines
    .map((l) => `jsonb_build_object(${Object.entries(l)
      .map(([k, v]) => `'${k}', ${typeof v === 'number' ? v : v.startsWith('{{') ? v : `'${v}'`}`)
      .join(', ')})`)
    .join(', ')})`;

export function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}

/** The refusal as CODE or CODE:hint. */
export function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.hint ? `${o!.code}:${o!.hint}` : o!.code!;
}

/**
 * I12: staff never see money. Every key, at any depth, that ends in _iqd or
 * starts with cost, price or supplier.
 */
export function moneyKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/_iqd$|^cost|^price|^supplier/i.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}
