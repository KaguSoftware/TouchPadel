/**
 * checklist_day_state_asof (wave 3 review R7; build-contracts-2026-09-23
 * §2.14, plan §7.3): day close's checklist warning for a PAST business day
 * counts only the lists and lines that stood at the end of that day.
 *
 *   * a list first saved after the day is left out; a list that stood counts
 *     with its lines, as before;
 *   * the day's end is the venue's business-day boundary (its timezone and
 *     start hour, never venue_settings' through the one-argument 0034 form):
 *     saved a second before it counts, saved at it does not;
 *   * a list saved since counts with the line count its last save by then
 *     recorded (the last, not the first or the largest; that save's audit
 *     row is dated by the same venue boundary) and names no lines; one that
 *     had no lines then is left out;
 *   * a list opened that day reads from its run, whatever the template did
 *     later;
 *   * today, the default day and a later day are unchanged: the 0165 body,
 *     rebuilt from its migration inside the transaction, returns the same
 *     payload;
 *   * the signature, guard, grants and shape are 0165's; the read creates
 *     nothing; and day close still closes over an unfinished list (warns,
 *     never blocks).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * checklists.test.ts harness): staff, lists, runs, audit rows and the day
 * session are created inside it and each client call runs as `authenticated`
 * with the caller's JWT claims, as PostgREST runs it. A list "saved days ago"
 * is its template's updated_at moved back, and, where the scenario needs the
 * save's audit row, that row written with its time (audit_log is append-only,
 * so the RPC's own row cannot be moved). Nothing is committed. Without docker
 * on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// The 0165 body, the one this re-issue replaces, as the reference for "today
// is unchanged": rebuilt as pg_temp.day_state_0165 inside each transaction.
const MIGRATION_0165 = fileURLToPath(
  new URL('../supabase/migrations/20260925000165_checklists.sql', import.meta.url),
);
function body0165(): string {
  const sql = readFileSync(MIGRATION_0165, 'utf8');
  const m = /\$checklist_day_state_0165\$([\s\S]*?)\$checklist_day_state_0165\$/.exec(sql);
  if (!m) throw new Error('0165 checklist_day_state body not found');
  return m[1]!;
}

// ── the in-transaction harness (as checklists.test.ts) ─────────────────────
// {{name}} in a statement becomes the quoted value of a var; t() runs one
// call as a staff member (as `authenticated`); as() runs it as postgres with
// the caller's JWT claims (for the pg_temp reference, a definer body either
// way); q() reads as postgres; keep() stores a value; mk() makes an auth
// user + staff row (the 0123 trigger files a non-owner at venue A).
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
  values (v, 'cds-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'CDS ' || p_name, p_role, true);
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

// Every scenario starts from no lists at all, whatever another session has
// committed on the shared stack (removed inside the transaction, so the
// rollback puts them back), and with the 0165 reference body in pg_temp.
const CLEAN = `
delete from checklist_run_items; delete from checklist_runs;
delete from checklist_template_items; delete from checklist_templates;
`;
function reference(): string {
  return `
create function pg_temp.day_state_0165(p_venue_id uuid default null, p_business_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public
as $ref_0165$${body0165()}$ref_0165$;
`;
}

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\nset local lock_timeout = '10s';\n${PRELUDE}\n${CLEAN}\n${reference()}\n${body.join('\n')}\n` +
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
const AS = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, null);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
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

const save = (role: string, slot: string, version: number, nameEn: string, lines: string[]) =>
  `select app.save_checklist_template({{venue}}, '${role}', '${slot}', ${version}, '${nameEn}', 'قائمة ${nameEn}',
     '${JSON.stringify(lines.map((en, i) => ({ text_en: en, text_ar: `سطر ${i + 1}` })))}'::jsonb)`;

/** Move a list's last save back: its template's updated_at, as postgres. */
const backdate = (label: string, role: string, slot: string, at: string) =>
  Q(label, `with x as (update checklist_templates set updated_at = ${at}
                        where venue_id = {{venue}} and role = '${role}' and slot = '${slot}' returning 1)
            select count(*)::text::jsonb from x`);

/**
 * A list first saved three days ago with `lines` lines, as the owner's save
 * would have left it that day: the template row, its lines and the save's
 * audit row, all dated then. Keeps the template id as `name`.
 */
const savedDaysAgo = (name: string, role: string, slot: string, nameEn: string, lines: number) => [
  KEEP(name, `with t as (insert into checklist_templates (venue_id, role, slot, name_en, name_ar, version, updated_by, updated_at)
                         values ({{venue}}::uuid, '${role}', '${slot}', '${nameEn}', 'قائمة ${nameEn}', 1, {{owner}}::uuid,
                                 now() - interval '3 days')
                         returning id),
                   i as (insert into checklist_template_items (template_id, position, text_en, text_ar)
                         select t.id, g, 'Old line ' || g, 'سطر قديم ' || g from t, generate_series(1, ${lines}) g
                         returning 1)
              select t.id::text from t`),
  Q(`${name}_audit`, `with a as (insert into audit_log (at, actor_id, actor_role, action, entity, entity_id, before, after, venue_id)
                                values (now() - interval '3 days', {{owner}}::uuid, 'owner', 'checklist.template.save',
                                        'checklist_template', {{${name}}}, '{"version": 0}'::jsonb,
                                        jsonb_build_object('role', '${role}', 'slot', '${slot}', 'version', 1, 'items', ${lines}),
                                        {{venue}}::uuid)
                                returning 1)
                      select count(*)::text::jsonb from a`),
];

interface DayList {
  role: string;
  slot: string;
  name_en: string;
  name_ar: string;
  total: number;
  done: number;
  open_items: Array<{ text_en: string; text_ar: string }>;
}
interface DayState {
  business_date: string;
  lists: DayList[];
}
const byKey = (s: DayState) => Object.fromEntries(s.lists.map((l) => [`${l.role}:${l.slot}`, l]));
/** role:slot → [total, done, the open lines' English text]. */
const summary = (s: DayState): Record<string, [number, number, string[]]> =>
  Object.fromEntries(
    s.lists.map((l) => [`${l.role}:${l.slot}`, [l.total, l.done, l.open_items.map((i) => i.text_en)]] as const),
  );

const BAR_OPEN = ['Turn on the grinder', 'Check the milk', 'Wipe the bar'];
const CASH_OPEN = ['Count the float', 'Print the Z report', 'Wipe the counter'];

describe.skipIf(!docker)('checklist_day_state as of the end of a past business day (rolled-back transactions)', () => {
  it('counts only the lists and lines that stood at the end of the day; today is 0165’s payload', () => {
    const r = scenario([
      MK('bar1', 'barista'),
      MK('chef1', 'chef'),
      MK('hc1', 'head_chef'),
      MK('hb1', 'head_barista'),
      MK('cash1', 'cashier'),
      KEEP('d0', `select app.venue_business_date({{venue}})::text`),
      KEEP('y', `select (app.venue_business_date({{venue}}) - 1)::text`),
      KEEP('later', `select (app.venue_business_date({{venue}}) + 7)::text`),
      // b0: the instant business day d0 starts at the venue, from the venue's
      // own timezone and the start-hour setting.
      KEEP('b0', `select (({{d0}}::date::timestamp
                            + make_interval(hours => coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4)))
                           at time zone (select v.timezone from venues v where v.id = {{venue}}::uuid))::text`),
      Q('dates', `select jsonb_build_object('d0', {{d0}}::text, 'y', {{y}}::text)`),
      Q('b0_sides', `select jsonb_build_array(app.venue_business_date({{venue}}, {{b0}}::timestamptz)::text,
                                              app.venue_business_date({{venue}}, {{b0}}::timestamptz - interval '1 second')::text)`),
      // venue_settings moved far west: the unqualified one-argument form now
      // puts b0 in yesterday; the venue's own boundary must not move.
      Q('vs_tz', `with x as (update venue_settings set timezone = 'Pacific/Pago_Pago' where timezone is not null returning 1)
                  select count(*)::text::jsonb from x`),
      Q('unqualified_b0', `select to_jsonb(app.business_date({{b0}}::timestamptz)::text)`),

      // 1. Written today: did not exist yesterday.
      T('new', 'owner', save('barista', 'open', 0, 'Bar opening', BAR_OPEN)),
      // 2. Saved three days ago and not since: stood yesterday, lines and all.
      T('stood', 'owner', save('barista', 'close', 0, 'Bar closing', ['Lock the fridge'])),
      backdate('stood_back', 'barista', 'close', `now() - interval '3 days'`),
      // 3, 4. The boundary: a second before d0 starts is yesterday; d0's first
      // instant is not.
      T('edge_before', 'owner', save('chef', 'open', 0, 'Kitchen opening', ['Light the grill'])),
      backdate('edge_before_back', 'chef', 'open', `{{b0}}::timestamptz - interval '1 second'`),
      T('edge_at', 'owner', save('chef', 'close', 0, 'Kitchen closing', ['Clean the fryer'])),
      backdate('edge_at_back', 'chef', 'close', `{{b0}}::timestamptz`),
      // 5. Saved three days ago with 2 lines, again two and a half days ago
      // with 5, again two days ago with 3, then edited today to 4. By
      // yesterday's end the counts went 2, then 5, then 3: the LAST save
      // counts, not the first and not the largest.
      ...savedDaysAgo('hc_tpl', 'head_chef', 'close', 'Head chef closing', 2),
      Q('hc_audit2', `with a as (insert into audit_log (at, actor_id, actor_role, action, entity, entity_id, before, after, venue_id)
                                 values (now() - interval '2 days 12 hours', {{owner}}::uuid, 'owner', 'checklist.template.save',
                                         'checklist_template', {{hc_tpl}}, '{"version": 1}'::jsonb, '{"items": 5}'::jsonb,
                                         {{venue}}::uuid),
                                        (now() - interval '2 days', {{owner}}::uuid, 'owner', 'checklist.template.save',
                                         'checklist_template', {{hc_tpl}}, '{"version": 2}'::jsonb, '{"items": 3}'::jsonb,
                                         {{venue}}::uuid)
                                 returning 1)
                       select count(*)::text::jsonb from a`),
      T('edited', 'owner', save('head_chef', 'close', 1, 'Head chef closing',
        ['Check the walk-in', 'Sign the temperature log', 'Lock the store', 'Switch off the hood'])),
      // 6. Saved three days ago with no lines, given 2 today.
      ...savedDaysAgo('hb_tpl', 'head_barista', 'open', 'Head bar opening', 0),
      T('filled', 'owner', save('head_barista', 'open', 1, 'Head bar opening', ['Calibrate the grinder', 'Taste the shot'])),
      // 7. Opened and one line ticked (the run moved to yesterday), then the
      // template cut to one line today.
      T('cash_list', 'owner', save('cashier', 'open', 0, 'Till opening', CASH_OPEN)),
      T('cash_today', 'cash1', `select app.my_checklists_today({{venue}})`),
      RES('ci1', 'cash_today', 'lists,0,items,0,id'),
      T('cash_tick', 'cash1', `select app.mark_checklist_item({{ci1}}, true)`),
      Q('cash_shift', `with x as (update checklist_runs set business_date = business_date - 1
                                   where venue_id = {{venue}} and role = 'cashier' returning 1)
                       select count(*)::text::jsonb from x`),
      T('cash_cut', 'owner', save('cashier', 'open', 1, 'Till opening', ['Count the float'])),
      // 8. The boundary on the save's audit row, not only on updated_at: saved
      // today with 3 lines, with a save of 1 line a second before d0 began
      // (yesterday's, by the venue's day) and one of 7 at d0's first instant
      // (not yesterday's, whatever the UTC date or venue_settings say).
      T('cc_list', 'owner', save('cashier', 'close', 0, 'Till closing', ['Lock the drawer', 'Log out', 'Lights off'])),
      KEEP('cc_tpl', `select id::text from checklist_templates where venue_id = {{venue}}::uuid and role = 'cashier' and slot = 'close'`),
      Q('cc_audit', `with a as (insert into audit_log (at, actor_id, actor_role, action, entity, entity_id, before, after, venue_id)
                                values ({{b0}}::timestamptz - interval '1 second', {{owner}}::uuid, 'owner', 'checklist.template.save',
                                        'checklist_template', {{cc_tpl}}, '{"version": 0}'::jsonb, '{"items": 1}'::jsonb, {{venue}}::uuid),
                                       ({{b0}}::timestamptz, {{owner}}::uuid, 'owner', 'checklist.template.save',
                                        'checklist_template', {{cc_tpl}}, '{"version": 1}'::jsonb, '{"items": 7}'::jsonb, {{venue}}::uuid)
                                returning 1)
                      select count(*)::text::jsonb from a`),
      Q('runs_before', `select count(*)::text::jsonb from checklist_runs`),

      T('y_state', 'manager', `select app.checklist_day_state({{venue}}, {{y}}::date)`),
      AS('y_state_0165', 'manager', `select pg_temp.day_state_0165({{venue}}, {{y}}::date)`),
      T('d0_state', 'manager', `select app.checklist_day_state({{venue}}, {{d0}}::date)`),
      AS('d0_state_0165', 'manager', `select pg_temp.day_state_0165({{venue}}, {{d0}}::date)`),
      T('default_state', 'owner', `select app.checklist_day_state()`),
      AS('default_state_0165', 'owner', `select pg_temp.day_state_0165()`),
      T('later_state', 'manager', `select app.checklist_day_state({{venue}}, {{later}}::date)`),
      AS('later_state_0165', 'manager', `select pg_temp.day_state_0165({{venue}}, {{later}}::date)`),
      Q('runs_after', `select count(*)::text::jsonb from checklist_runs`),
    ]);

    const dates = ok<{ d0: string; y: string }>(r, 'dates');
    // b0 is d0's first instant at the venue; the second before it is yesterday's.
    expect(ok<[string, string]>(r, 'b0_sides')).toEqual([dates.d0, dates.y]);
    expect(ok<DayState>(r, 'd0_state').business_date).toBe(dates.d0);
    expect(ok<DayState>(r, 'y_state').business_date).toBe(dates.y);
    // The unqualified form read venue_settings, which this transaction moved, and
    // called d0's first instant yesterday. Since 0211 (multi-venue slice 2) it
    // delegates to venue_business_date at the caller's branch, so moving
    // venue_settings no longer moves it either.
    expect(ok<string>(r, 'unqualified_b0')).toBe(dates.d0);

    for (const label of ['new', 'stood', 'edge_before', 'edge_at', 'edited', 'filled', 'cash_list', 'cash_cut', 'cash_tick', 'cc_list']) {
      ok(r, label);
    }

    // Yesterday: only what stood at its end.
    const y = ok<DayState>(r, 'y_state');
    expect(summary(y)).toEqual({
      // opened that day: the run, as before (3 lines, 1 ticked), not today's
      // one-line template
      'cashier:open': [3, 1, ['Print the Z report', 'Wipe the counter']],
      // saved since: the 1 line of its save a second before d0 began, none
      // named (the save at d0's first instant and today's are not yesterday's)
      'cashier:close': [1, 0, []],
      // saved three days ago and not since: the template's lines
      'barista:close': [1, 0, ['Lock the fridge']],
      // saved since: the 3 lines its LAST save by then recorded (two days
      // ago; not the first save's 2 nor the largest, 5), none named
      'head_chef:close': [3, 0, []],
      // saved a second before d0 began: yesterday's
      'chef:open': [1, 0, ['Light the grill']],
    });
    // Left out: written today (barista open), saved at d0's first instant
    // (chef close), no lines at yesterday's end (head_barista open).
    expect(Object.keys(byKey(y)).sort()).toEqual(
      ['barista:close', 'cashier:close', 'cashier:open', 'chef:open', 'head_chef:close'],
    );
    // Order as 0165: role, then open before close.
    expect(y.lists.map((l) => `${l.role}:${l.slot}`)).toEqual(
      ['cashier:open', 'cashier:close', 'barista:close', 'head_chef:close', 'chef:open'],
    );
    expect(byKey(y)['head_chef:close']).toMatchObject({ name_en: 'Head chef closing', name_ar: 'قائمة Head chef closing' });

    // The bug R7 fixes: 0165 counted today's templates for yesterday.
    const old = summary(ok<DayState>(r, 'y_state_0165'));
    expect(old['barista:open']).toEqual([3, 0, BAR_OPEN]);
    expect(old['chef:close']).toEqual([1, 0, ['Clean the fryer']]);
    expect(old['head_chef:close']![0]).toBe(4);
    expect(old['head_barista:open']![0]).toBe(2);

    // Today, the default day and a later day: exactly 0165's payload.
    expect(ok(r, 'd0_state')).toEqual(ok(r, 'd0_state_0165'));
    expect(ok(r, 'default_state')).toEqual(ok(r, 'default_state_0165'));
    expect(ok(r, 'later_state')).toEqual(ok(r, 'later_state_0165'));
    expect(ok(r, 'default_state')).toEqual(ok(r, 'd0_state'));
    expect(summary(ok<DayState>(r, 'd0_state'))).toEqual({
      'cashier:open': [1, 0, ['Count the float']],
      'cashier:close': [3, 0, ['Lock the drawer', 'Log out', 'Lights off']],
      'barista:open': [3, 0, BAR_OPEN],
      'barista:close': [1, 0, ['Lock the fridge']],
      'head_barista:open': [2, 0, ['Calibrate the grinder', 'Taste the shot']],
      'head_chef:close': [4, 0, ['Check the walk-in', 'Sign the temperature log', 'Lock the store', 'Switch off the hood']],
      'chef:open': [1, 0, ['Light the grill']],
      'chef:close': [1, 0, ['Clean the fryer']],
    });

    // A read: no run was opened by any of the eight calls.
    expect(ok<number>(r, 'runs_after')).toBe(ok<number>(r, 'runs_before'));
  });

  it('keeps 0165’s signature, guard, grants and shape', () => {
    const r = scenario([
      MK('bar1', 'barista'),
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      T('stood', 'owner', save('barista', 'close', 0, 'Bar closing', ['Lock the fridge', 'Empty the bins'])),
      backdate('stood_back', 'barista', 'close', `now() - interval '3 days'`),
      ...savedDaysAgo('bo_tpl', 'barista', 'open', 'Bar opening', 2),
      T('edited', 'owner', save('barista', 'open', 1, 'Bar opening', BAR_OPEN)),
      T('today', 'bar1', `select app.my_checklists_today({{venue}})`),
      RES('i1', 'today', 'lists,0,items,0,id'),
      T('tick', 'bar1', `select app.mark_checklist_item({{i1}}, true)`),
      KEEP('y', `select (app.venue_business_date({{venue}}) - 1)::text`),
      Q('y_val', `select to_jsonb({{y}}::text)`),

      Q('fn', `select jsonb_build_object(
                 'count',    count(*),
                 'args',     max(pg_get_function_arguments(p.oid)),
                 'returns',  max(pg_get_function_result(p.oid)),
                 'definer',  bool_and(p.prosecdef),
                 'volatile', max(p.provolatile::text),
                 'config',   max(array_to_string(p.proconfig, ',')),
                 'lang',     max(l.lanname),
                 'acl',      max(p.proacl::text),
                 'anon',     bool_and(has_function_privilege('anon', p.oid, 'execute')),
                 'auth',     bool_and(has_function_privilege('authenticated', p.oid, 'execute')))
                 from pg_proc p join pg_language l on l.oid = p.prolang
                where p.pronamespace = 'app'::regnamespace and p.proname = 'checklist_day_state'`),

      // The guard, new body and 0165 body, principal by principal.
      ...(['bar1', 'drv', 'mkt', 'cashier'] as const).flatMap((who) => [
        T(`g_${who}`, who, `select app.checklist_day_state({{venue}})`),
        AS(`g_${who}_0165`, who, `select pg_temp.day_state_0165({{venue}})`),
      ]),
      T('g_other_venue', 'manager', `select app.checklist_day_state('00000000-0000-4000-8000-00000000c1c1')`),
      AS('g_other_venue_0165', 'manager', `select pg_temp.day_state_0165('00000000-0000-4000-8000-00000000c1c1')`),

      T('today_state', 'manager', `select app.checklist_day_state({{venue}})`),
      T('y_state', 'owner', `select app.checklist_day_state({{venue}}, {{y}}::date)`),
    ]);

    expect(ok(r, 'fn')).toEqual({
      count: 1,
      args: 'p_venue_id uuid DEFAULT NULL::uuid, p_business_date date DEFAULT NULL::date',
      returns: 'jsonb',
      definer: true,
      volatile: 's',
      config: 'search_path=public',
      lang: 'plpgsql',
      acl: '{postgres=X/postgres,authenticated=X/postgres}',
      anon: false,
      auth: true,
    });

    for (const who of ['bar1', 'drv', 'mkt', 'cashier', 'other_venue']) {
      expect(refused(r, `g_${who}`), who).toBe('FORBIDDEN');
      expect(refused(r, `g_${who}_0165`), `${who} (0165)`).toBe('FORBIDDEN');
    }

    // The payload's keys, on each kind of list: from the run (today's
    // barista open), from the template (barista close), from the audit count
    // (yesterday's barista open).
    const LIST_KEYS = ['done', 'name_ar', 'name_en', 'open_items', 'role', 'slot', 'total'];
    for (const label of ['today_state', 'y_state']) {
      const s = ok<DayState>(r, label);
      expect(Object.keys(s).sort(), label).toEqual(['business_date', 'lists']);
      expect(s.lists.length, label).toBe(2);
      for (const l of s.lists) {
        expect(Object.keys(l).sort(), `${label} ${l.slot}`).toEqual(LIST_KEYS);
        expect(typeof l.total).toBe('number');
        expect(typeof l.done).toBe('number');
        for (const i of l.open_items) expect(Object.keys(i).sort()).toEqual(['text_ar', 'text_en']);
      }
    }
    expect(ok<DayState>(r, 'y_state').business_date).toBe(ok<string>(r, 'y_val'));
    expect(summary(ok<DayState>(r, 'today_state'))).toEqual({
      'barista:open': [3, 1, ['Check the milk', 'Wipe the bar']],
      'barista:close': [2, 0, ['Lock the fridge', 'Empty the bins']],
    });
    expect(summary(ok<DayState>(r, 'y_state'))).toEqual({
      'barista:open': [2, 0, []],
      'barista:close': [2, 0, ['Lock the fridge', 'Empty the bins']],
    });
  });

  it('day close warns about yesterday’s unfinished list and still closes the day (never a block)', () => {
    const r = scenario([
      MK('bar1', 'barista'),
      KEEP('y', `select (app.venue_business_date({{venue}}) - 1)::text`),
      T('stood', 'owner', save('barista', 'close', 0, 'Bar closing', ['Lock the fridge'])),
      backdate('stood_back', 'barista', 'close', `now() - interval '3 days'`),
      // The only open day is yesterday's (any other open session and any
      // queued till writes are set aside inside this transaction).
      Q('others', `with x as (update day_sessions set status = 'closed', closed_at = now()
                               where status in ('open', 'closing') returning 1)
                   select count(*)::text::jsonb from x`),
      Q('queues', `with x as (update device_heartbeats set queue_depth = 0 where queue_depth > 0 returning 1)
                   select count(*)::text::jsonb from x`),
      KEEP('day', `insert into day_sessions (business_date, opened_by, opening_float_iqd, venue_id, opened_at)
                   values ({{y}}::date, {{manager}}::uuid, 0, {{venue}}::uuid, now() - interval '20 hours')
                   on conflict (venue_id, business_date)
                   do update set status = 'open', closed_at = null, closed_by = null, opened_at = excluded.opened_at
                   returning id::text`),
      T('warn', 'manager', `select app.checklist_day_state({{venue}}, {{y}}::date)`),
      T('close', 'manager', `select app.close_day(0)`),
      Q('closed', `select to_jsonb(status::text) from day_sessions where id = {{day}}::uuid`),
      T('warn_after', 'manager', `select app.checklist_day_state({{venue}}, {{y}}::date)`),
      Q('close_src', `select to_jsonb(position('checklist' in p.prosrc) = 0)
                        from pg_proc p where p.oid = 'app.close_day(bigint,bigint,text,text,uuid)'::regprocedure`),
    ]);

    expect(summary(ok<DayState>(r, 'warn'))).toEqual({ 'barista:close': [1, 0, ['Lock the fridge']] });
    ok(r, 'close');
    expect(ok<string>(r, 'closed')).toBe('closed');
    expect(ok(r, 'warn_after')).toEqual(ok(r, 'warn'));
    // close_day never reads the checklists.
    expect(ok<boolean>(r, 'close_src')).toBe(true);
  });
});
