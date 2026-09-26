/**
 * suggestions (build-contracts-2026-09-23 §2.24.4, §8.2): the staff suggestion
 * box.
 *
 *   * every role, the driver, marketing and prep included, posts and reads
 *     only its own, with whether it was seen;
 *   * the manager and the owner read every suggestion with its author and
 *     role, filter new, seen and all, and mark one seen (a repeat keeps the
 *     first mark); anyone else is refused both;
 *   * another venue's suggestion is REF_NOT_FOUND; the driver and marketing
 *     read no row of the table (§8.2);
 *   * app.assistant_readable_columns has no staff_suggestions row.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff and suggestions are created
 * inside it and each call runs as `authenticated` with the caller's JWT
 * claims. Nothing is committed. Without docker on PATH the suite skips itself.
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

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
// t() runs one statement as a staff member (as `authenticated`); as() runs it
// as the definer's caller (postgres, with the JWT claims set) for internal
// functions; q() reads as postgres; keep() stores a value; mk() makes an auth
// user + staff row (the 0123 trigger files a non-owner at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}');

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
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'sug-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SUG ' || p_name, p_role, true);
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

const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const OTHER_VENUE = '00000000-0000-4000-8000-00000000c5c5';
const ROLES = ['head_barista', 'barista', 'head_chef', 'chef', 'driver', 'marketing'] as const;
const EVERYONE = [...ROLES, 'cashier', 'desk', 'prep', 'manager', 'owner'] as const;

type Mine = { suggestions: Array<{ id: string; body: string; seen: boolean; seen_at: string | null }> };
type Page = { suggestions: Array<{ id: string; author_name: string; author_role: string; body: string;
                                   seen_by_name: string | null; seen_at: string | null }>;
              new_count: number; total: number };

describe.skipIf(!docker)('suggestions (rolled-back transactions)', () => {
  it('every role posts and reads its own; MGMT reads all with author and role and marks them seen', () => {
    const r = scenario([
      `delete from staff_suggestions;`,
      ...ROLES.map((role) => MK(role, role)),
      ...EVERYONE.map((who) => T(`add_${who}`, who, `select app.add_suggestion('  More shade on court 3 (${who})  ', {{venue}})`)),
      T('replay1', 'barista', `select app.add_suggestion('Once', null, 'SUG-KEY-1')`),
      T('replay2', 'barista', `select app.add_suggestion('Once', null, 'SUG-KEY-1')`),
      T('empty', 'driver', `select app.add_suggestion('   ')`),
      T('long', 'driver', `select app.add_suggestion(repeat('s', 1001))`),
      T('far', 'driver', `select app.add_suggestion('x', '${OTHER_VENUE}')`),
      ...EVERYONE.map((who) => T(`mine_${who}`, who, `select app.my_suggestions({{venue}})`)),
      RES('s_drv', 'add_driver', 'id'),
      RES('s_mkt', 'add_marketing', 'id'),
      T('page_new', 'manager', `select app.suggestions_page({{venue}})`),
      T('seen', 'manager', `select app.mark_suggestion_seen({{s_drv}})`),
      T('seen_again', 'owner', `select app.mark_suggestion_seen({{s_drv}})`),
      T('page_seen', 'owner', `select app.suggestions_page({{venue}}, 'seen')`),
      T('page_all', 'owner', `select app.suggestions_page(null, 'all', 3, 0)`),
      T('page_bad', 'manager', `select app.suggestions_page({{venue}}, 'old')`),
      T('mine_drv_after', 'driver', `select app.my_suggestions()`),
      ...(['head_barista', 'barista', 'head_chef', 'chef', 'driver', 'marketing', 'cashier', 'desk', 'prep'] as const)
        .flatMap((who) => [
          T(`page_${who}`, who, `select app.suggestions_page({{venue}})`),
          T(`markx_${who}`, who, `select app.mark_suggestion_seen({{s_mkt}})`),
        ]),
      T('mark_missing', 'manager', `select app.mark_suggestion_seen(gen_random_uuid())`),
      // §8.2: the table is MGMT's.
      ...(['driver', 'marketing', 'barista', 'manager'] as const).map((who) =>
        T(`read_${who}`, who, `select to_jsonb(count(*)) from staff_suggestions`)),
      Q('audit', `select to_jsonb(count(*)) from audit_log where at = now() and entity ilike '%suggestion%'`),
    ]);
    for (const who of EVERYONE) expect(ok<{ id: string }>(r, `add_${who}`).id, who).toMatch(/^[0-9a-f-]{36}$/);
    expect(ok(r, 'replay2')).toEqual({ id: ok<{ id: string }>(r, 'replay1').id, duplicate: true });
    expect(refused(r, 'empty')).toBe('TEXT_REQUIRED:body');
    expect(refused(r, 'long')).toBe('TEXT_TOO_LONG:body');
    expect(refused(r, 'far')).toBe('FORBIDDEN');
    for (const who of EVERYONE) {
      const mine = ok<Mine>(r, `mine_${who}`).suggestions;
      expect(mine.map((s) => s.body).sort(), who).toEqual(
        [`More shade on court 3 (${who})`, ...(who === 'barista' ? ['Once'] : [])].sort());
      expect(mine.every((s) => !s.seen), who).toBe(true);
    }
    const pageNew = ok<Page>(r, 'page_new');
    expect(pageNew.total).toBe(EVERYONE.length + 1);
    expect(pageNew.new_count).toBe(EVERYONE.length + 1);
    expect(pageNew.suggestions.find((s) => s.id === ok<{ id: string }>(r, 'add_driver').id))
      .toMatchObject({ author_name: 'SUG driver', author_role: 'driver', body: 'More shade on court 3 (driver)',
                       seen_by_name: null, seen_at: null });
    const first = ok<{ seen_at: string }>(r, 'seen').seen_at;
    expect(first).not.toBeNull();
    expect(ok<{ seen_at: string }>(r, 'seen_again').seen_at).toBe(first);
    const seen = ok<Page>(r, 'page_seen');
    expect(seen.suggestions.map((s) => [s.author_role, s.seen_by_name])).toEqual([['driver', 'Dev Manager']]);
    expect(seen.new_count).toBe(EVERYONE.length);
    const all = ok<Page>(r, 'page_all');
    expect(all.suggestions).toHaveLength(3);
    expect(all.total).toBe(EVERYONE.length + 1);
    expect(refused(r, 'page_bad')).toBe('INVALID_ARGUMENT:filter');
    expect(ok<Mine>(r, 'mine_drv_after').suggestions[0]).toMatchObject({ seen: true, seen_at: first });
    for (const who of ['head_barista', 'barista', 'head_chef', 'chef', 'driver', 'marketing', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `page_${who}`), who).toBe('FORBIDDEN');
      expect(refused(r, `markx_${who}`), who).toBe('FORBIDDEN');
    }
    expect(refused(r, 'mark_missing')).toBe('REF_NOT_FOUND:id');
    for (const who of ['driver', 'marketing', 'barista']) expect(ok<number>(r, `read_${who}`), who).toBe(0);
    expect(ok<number>(r, 'read_manager')).toBe(EVERYONE.length + 1);
    // Not audited (§2.22).
    expect(ok<number>(r, 'audit')).toBe(0);
  });

  it('answers REF_NOT_FOUND for another venue’s suggestion, and keeps the table from the owner assistant', () => {
    const r = scenario([
      `insert into venues (id, slug, name_en, name_ar, is_active)
       values ('${OTHER_VENUE}', 'sug-other-venue', 'SUG other', 'مكان آخر', false);`,
      KEEP('far', `insert into staff_suggestions (venue_id, author_id, body)
                   values ('${OTHER_VENUE}', {{cashier}}::uuid, 'Elsewhere') returning id::text`),
      T('mark_far', 'manager', `select app.mark_suggestion_seen({{far}})`),
      T('page_far', 'manager', `select app.suggestions_page('${OTHER_VENUE}')`),
      Q('readable', `select to_jsonb(count(*)) from app.assistant_readable_columns where table_name = 'staff_suggestions'`),
    ]);
    expect(refused(r, 'mark_far')).toBe('REF_NOT_FOUND:id');
    expect(refused(r, 'page_far')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'readable')).toBe(0);
  });
});
