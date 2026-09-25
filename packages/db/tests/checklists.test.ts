/**
 * checklists (build-contracts-2026-09-23 §2.14, §8.2): the daily open and
 * close lists per role.
 *
 *   * the owner writes a role's list (versioned, both languages, at most 30
 *     lines, never prep); a manager cannot;
 *   * the first read of the day snapshots the list, so everyone holding the
 *     role ticks the same lines and an owner's edit mid-day reaches tomorrow's
 *     list only; a repeat tick keeps the first ticker; another role cannot
 *     tick, MGMT can;
 *   * checklist_board and checklist_day_state are MGMT's, create nothing, and
 *     the day state lists only roles someone holds;
 *   * the driver and marketing read no row of the four tables and none of
 *     MGMT's reads (§8.2 denials).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff are created inside it and each
 * call runs as `authenticated` with the caller's JWT claims, as PostgREST runs
 * it. Nothing is committed, so the shared stack keeps no list, run or tick.
 * Without docker on PATH the suite skips itself.
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
// {{name}} in a statement becomes the quoted value of a var; t() runs one
// call as a staff member and records its result or error; q() reads as
// postgres; keep() stores a value; mk() makes an auth user + staff row (the
// 0123 trigger files a non-owner at venue A).
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

create function pg_temp.t(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
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
  values (v, 'cl-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'CL ' || p_name, p_role, true);
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
// committed on the shared stack: removed inside the transaction, so the
// rollback puts them back.
const CLEAN = `
delete from checklist_run_items; delete from checklist_runs;
delete from checklist_template_items; delete from checklist_templates;
`;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${CLEAN}\n${body.join('\n')}\n` +
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

const T = (label: string, who: string, sql: string) => `select pg_temp.t('${label}', '${who}', $q$${sql}$q$);`;
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

const save = (role: string, slot: string, version: number | 'null', nameEn: string, items: Array<[string, string]>) =>
  `select app.save_checklist_template({{venue}}, '${role}', '${slot}', ${version}, '${nameEn}', 'قائمة ${nameEn}',
     '${JSON.stringify(items.map(([en, ar]) => ({ text_en: en, text_ar: ar })))}'::jsonb)`;

interface Item {
  id: string;
  position: number;
  text_en: string;
  text_ar: string;
  done_by_name: string | null;
  done_at: string | null;
  note: string | null;
}
interface List {
  run_id: string;
  role: string;
  slot: string;
  name_en: string;
  done: number;
  total: number;
  items: Item[];
}
interface Today {
  business_date: string;
  lists: List[];
}

const OPEN_ITEMS: Array<[string, string]> = [
  ['Turn on the grinder', 'شغّل المطحنة'],
  ['Check the milk', 'افحص الحليب'],
  ['Wipe the bar', 'امسح البار'],
];

describe.skipIf(!docker)('checklists (rolled-back transactions)', () => {
  it('the owner writes a role’s lists; versions, languages, lengths and prep are checked; a manager cannot', () => {
    const r = scenario([
      T('open', 'owner', save('barista', 'open', 0, 'Bar opening', OPEN_ITEMS)),
      T('close', 'owner', save('barista', 'close', 'null', 'Bar closing', [['Lock the fridge', 'اقفل الثلاجة']])),
      T('stale_new', 'owner', save('barista', 'open', 0, 'Bar opening', OPEN_ITEMS)),
      T('stale_edit', 'owner', save('barista', 'open', 7, 'Bar opening', OPEN_ITEMS)),
      T('new_nonzero', 'owner', save('chef', 'open', 3, 'Kitchen', OPEN_ITEMS)),
      T('edit', 'owner', save('barista', 'open', 1, 'Bar opening 2', OPEN_ITEMS.slice(0, 2))),
      T('prep', 'owner', save('prep', 'open', 0, 'Prep', OPEN_ITEMS)),
      T('slot', 'owner', save('barista', 'noon', 0, 'Noon', OPEN_ITEMS)),
      T('one_lang', 'owner',
        `select app.save_checklist_template({{venue}}, 'barista', 'open', 2, 'Bar', '  ', '[]'::jsonb)`),
      T('item_one_lang', 'owner', save('barista', 'open', 2, 'Bar', [['Only English', ' ']])),
      T('too_many', 'owner', save('barista', 'open', 2, 'Bar',
        Array.from({ length: 31 }, (_, i): [string, string] => [`Line ${i}`, `سطر ${i}`]))),
      T('item_long', 'owner', save('barista', 'open', 2, 'Bar', [['x'.repeat(201), 'ع']])),
      T('manager', 'manager', save('cashier', 'open', 0, 'Till', OPEN_ITEMS)),
      T('other_venue', 'owner',
        `select app.save_checklist_template('00000000-0000-4000-8000-00000000c1c1', 'barista', 'open', 0, 'x', 'x', '[]'::jsonb)`),
      Q('lines', `select jsonb_agg(i.text_en order by i.position) from checklist_template_items i
                   join checklist_templates t on t.id = i.template_id
                  where t.venue_id = {{venue}} and t.role = 'barista' and t.slot = 'open'`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'after', a.after) order by a.at)
                    from audit_log a
                   where a.entity = 'checklist_template'
                     and a.entity_id = (select id::text from checklist_templates
                                         where venue_id = {{venue}} and role = 'barista' and slot = 'open')`),
    ]);

    expect(ok<{ version: number }>(r, 'open').version).toBe(1);
    expect(ok<{ version: number }>(r, 'close').version).toBe(1);
    expect(refused(r, 'stale_new')).toBe('TEMPLATE_CHANGED');
    expect(refused(r, 'stale_edit')).toBe('TEMPLATE_CHANGED');
    expect(refused(r, 'new_nonzero')).toBe('TEMPLATE_CHANGED');
    expect(ok<{ version: number }>(r, 'edit').version).toBe(2);
    expect(refused(r, 'prep')).toBe('INVALID_ROLE:role');
    expect(refused(r, 'slot')).toBe('INVALID_ARGUMENT:slot');
    expect(refused(r, 'one_lang')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:name');
    expect(refused(r, 'item_one_lang')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:items');
    expect(refused(r, 'too_many')).toBe('LIST_TOO_LONG:items');
    expect(refused(r, 'item_long')).toBe('TEXT_TOO_LONG:items');
    expect(refused(r, 'manager')).toBe('FORBIDDEN');
    expect(refused(r, 'other_venue')).toBe('FORBIDDEN');
    // The lines are replaced whole, in order.
    expect(ok<string[]>(r, 'lines')).toEqual(['Turn on the grinder', 'Check the milk']);
    // Audited with counts, never the text.
    const audit = ok<Array<{ action: string; after: Record<string, unknown> }>>(r, 'audit');
    expect(audit.map((a) => a.action)).toEqual(['checklist.template.save', 'checklist.template.save']);
    expect(audit[1]!.after).toEqual({ role: 'barista', slot: 'open', version: 2, items: 2 });
  });

  it('one shared list per role and day: a snapshot, ticks that keep their first ticker, MGMT may tick', () => {
    const r = scenario([
      MK('bar1', 'barista'),
      MK('bar2', 'barista'),
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      MK('hc', 'head_chef'),
      T('open', 'owner', save('barista', 'open', 0, 'Bar opening', OPEN_ITEMS)),
      T('close', 'owner', save('barista', 'close', 0, 'Bar closing', [['Lock the fridge', 'اقفل الثلاجة']])),
      // An empty list is saved but never opened.
      T('empty', 'owner', save('driver', 'open', 0, 'Van', [])),

      T('today1', 'bar1', `select app.my_checklists_today({{venue}})`),
      T('today2', 'bar2', `select app.my_checklists_today()`),
      Q('runs_after_two_reads', `select count(*)::text::jsonb from checklist_runs where venue_id = {{venue}}
                                   and role = 'barista' and business_date = app.venue_business_date({{venue}})`),
      Q('bdate', `select to_jsonb(app.venue_business_date({{venue}}))`),
      RES('i1', 'today1', 'lists,0,items,0,id'),
      RES('i2', 'today1', 'lists,0,items,1,id'),
      RES('i3', 'today1', 'lists,0,items,2,id'),

      T('tick1', 'bar1', `select app.mark_checklist_item({{i1}}, true)`),
      T('retick1', 'bar2', `select app.mark_checklist_item({{i1}}, true)`),
      T('tick2', 'bar2', `select app.mark_checklist_item({{i2}}, true, '  milk is low  ')`),
      T('keep_note', 'bar2', `select app.mark_checklist_item({{i2}}, true)`),
      T('long_note', 'bar1', `select app.mark_checklist_item({{i2}}, true, repeat('n', 301))`),
      T('drv_tick', 'drv', `select app.mark_checklist_item({{i3}}, true)`),
      T('hc_tick', 'hc', `select app.mark_checklist_item({{i3}}, true)`),
      T('mgr_tick', 'manager', `select app.mark_checklist_item({{i3}}, true)`),
      T('untick1', 'bar1', `select app.mark_checklist_item({{i1}}, false)`),
      T('clear_note', 'bar1', `select app.mark_checklist_item({{i2}}, true, '')`),
      T('missing', 'bar1', `select app.mark_checklist_item('00000000-0000-4000-8000-000000000000', true)`),
      T('drv_today', 'drv', `select app.my_checklists_today({{venue}})`),
      T('other_venue', 'bar1', `select app.my_checklists_today('00000000-0000-4000-8000-00000000c1c1')`),

      // The owner shortens the list mid-day: today's run keeps its snapshot.
      T('edit', 'owner', save('barista', 'open', 1, 'Bar opening', OPEN_ITEMS.slice(0, 1))),
      T('today_after_edit', 'bar1', `select app.my_checklists_today({{venue}})`),
      // Tomorrow (today's runs moved a day back) the new list is snapshotted.
      Q('shift', `with x as (update checklist_runs set business_date = business_date - 1
                   where venue_id = {{venue}} and role = 'barista' returning 1) select count(*)::text::jsonb from x`),
      T('tomorrow', 'bar2', `select app.my_checklists_today({{venue}})`),
    ]);

    const t1 = ok<Today>(r, 'today1');
    expect(t1.business_date).toBe(ok<string>(r, 'bdate'));
    expect(t1.lists.map((l) => [l.slot, l.name_en, l.total, l.done])).toEqual([
      ['open', 'Bar opening', 3, 0],
      ['close', 'Bar closing', 1, 0],
    ]);
    expect(t1.lists[0]!.items.map((i) => i.text_en)).toEqual(OPEN_ITEMS.map(([en]) => en));
    expect(Object.keys(t1.lists[0]!.items[0]!).sort()).toEqual(
      ['done_at', 'done_by_name', 'id', 'note', 'photo_path', 'photo_required', 'position', 'text_ar', 'text_en'],
    );
    // One run per list and day, whoever reads first: both baristas see it.
    const t2 = ok<Today>(r, 'today2');
    expect(t2.lists.map((l) => l.run_id)).toEqual(t1.lists.map((l) => l.run_id));
    expect(ok<number>(r, 'runs_after_two_reads')).toBe(2);

    expect(ok<Item>(r, 'tick1').done_by_name).toBe('CL bar1');
    // A repeat tick by someone else keeps the first ticker.
    expect(ok<Item>(r, 'retick1').done_by_name).toBe('CL bar1');
    expect(ok<Item>(r, 'tick2')).toMatchObject({ done_by_name: 'CL bar2', note: 'milk is low' });
    expect(ok<Item>(r, 'keep_note').note).toBe('milk is low');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'drv_tick')).toBe('FORBIDDEN');
    expect(refused(r, 'hc_tick')).toBe('FORBIDDEN');
    expect(ok<Item>(r, 'mgr_tick').done_by_name).toBe('Dev Manager');
    expect(ok<Item>(r, 'untick1')).toMatchObject({ done_by_name: null, done_at: null });
    expect(ok<Item>(r, 'clear_note').note).toBeNull();
    expect(refused(r, 'missing')).toBe('CHECKLIST_NOT_FOUND');
    // The driver's list has no lines, so nothing is opened for them.
    expect(ok<Today>(r, 'drv_today').lists).toEqual([]);
    expect(refused(r, 'other_venue')).toBe('FORBIDDEN');

    expect(ok<Today>(r, 'today_after_edit').lists[0]!.total).toBe(3);
    const tomorrow = ok<Today>(r, 'tomorrow');
    expect(tomorrow.lists[0]!.items.map((i) => i.text_en)).toEqual(['Turn on the grinder']);
    expect(tomorrow.lists[0]!.done).toBe(0);
  });

  it('the board and the day state are MGMT reads that create nothing; the day state names held roles only', () => {
    const r = scenario([
      MK('bar1', 'barista'),
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      T('open', 'owner', save('barista', 'open', 0, 'Bar opening', OPEN_ITEMS)),
      // A role nobody at the venue holds (every chef switched off in this
      // transaction only) is left out of the day state.
      Q('no_chefs', `with x as (update staff set is_active = false where role = 'chef' and is_active returning 1)
                     select count(*)::text::jsonb from x`),
      T('chef_list', 'owner', save('chef', 'close', 0, 'Kitchen closing', [['Clean the fryer', 'نظّف القلاية']])),
      T('board_before', 'manager', `select app.checklist_board({{venue}})`),
      T('state_before', 'manager', `select app.checklist_day_state({{venue}})`),
      Q('runs_before', `select count(*)::text::jsonb from checklist_runs where venue_id = {{venue}}`),

      T('today', 'bar1', `select app.my_checklists_today({{venue}})`),
      RES('i1', 'today', 'lists,0,items,0,id'),
      T('tick', 'bar1', `select app.mark_checklist_item({{i1}}, true, 'done early')`),
      MK('chef1', 'chef'),
      T('board', 'owner', `select app.checklist_board({{venue}})`),
      T('state', 'owner', `select app.checklist_day_state()`),
      KEEP('yday', `select (app.venue_business_date({{venue}}) - 1)::text`),
      T('state_yesterday', 'manager', `select app.checklist_day_state({{venue}}, {{yday}}::date)`),
      // The internal day helper is no client's to call.
      T('helper', 'manager', `select to_jsonb(app.venue_business_date({{venue}}))`),

      T('bar_board', 'bar1', `select app.checklist_board({{venue}})`),
      T('bar_state', 'bar1', `select app.checklist_day_state({{venue}})`),
      T('cashier_board', 'cashier', `select app.checklist_board({{venue}})`),
      T('drv_board', 'drv', `select app.checklist_board({{venue}})`),
      T('drv_state', 'drv', `select app.checklist_day_state({{venue}})`),
      T('mkt_board', 'mkt', `select app.checklist_board({{venue}})`),
      T('mkt_state', 'mkt', `select app.checklist_day_state({{venue}})`),
      T('drv_save', 'drv', save('driver', 'open', 0, 'Van', [])),
      T('mkt_save', 'mkt', save('marketing', 'open', 0, 'Posts', [])),

      // §8.2: no read of the four tables for the driver and marketing (nor
      // for a barista, who reads through my_checklists_today); MGMT reads.
      ...(['drv', 'mkt', 'bar1', 'manager'] as const).flatMap((who) =>
        ['checklist_templates', 'checklist_template_items', 'checklist_runs', 'checklist_run_items'].map((tbl) =>
          T(`read_${who}_${tbl}`, who, `select count(*)::text::jsonb from ${tbl}`),
        ),
      ),
    ]);

    type Board = {
      templates: Array<{ role: string; slot: string; version: number; items: unknown[]; today: null | {
        done: number; total: number; items: Array<{ done_by_name: string | null; note: string | null }> } }>;
    };
    type State = { lists: Array<{ role: string; slot: string; total: number; done: number;
                                  open_items: Array<{ text_en: string }> }> };
    const bar = (b: Board) => b.templates.find((t) => t.role === 'barista' && t.slot === 'open')!;
    expect(bar(ok<Board>(r, 'board_before')).today).toBeNull();
    const before = ok<State>(r, 'state_before').lists.find((l) => l.role === 'barista')!;
    expect(before).toMatchObject({ slot: 'open', total: 3, done: 0 });
    expect(before.open_items.map((i) => i.text_en)).toEqual(OPEN_ITEMS.map(([en]) => en));
    expect(ok<State>(r, 'state_before').lists.some((l) => l.role === 'chef')).toBe(false);
    // Neither read opened a list.
    expect(ok<number>(r, 'runs_before')).toBe(0);

    const board = bar(ok<Board>(r, 'board'));
    expect(board.version).toBe(1);
    expect(board.items).toHaveLength(3);
    expect(board.today).toMatchObject({ done: 1, total: 3 });
    expect(board.today!.items[0]).toMatchObject({ done_by_name: 'CL bar1', note: 'done early' });
    const state = ok<State>(r, 'state').lists;
    expect(state.find((l) => l.role === 'barista')).toMatchObject({ total: 3, done: 1 });
    expect(state.find((l) => l.role === 'barista')!.open_items.map((i) => i.text_en))
      .toEqual(['Check the milk', 'Wipe the bar']);
    // Now that a chef holds the role, the kitchen's list is due, unopened.
    expect(state.find((l) => l.role === 'chef')).toMatchObject({ slot: 'close', total: 1, done: 0 });
    // Yesterday the bar's list did not exist yet (saved today): nothing to warn
    // about for that day (R7, checklist-day-state.test.ts).
    expect(ok<State>(r, 'state_yesterday').lists.find((l) => l.role === 'barista')).toBeUndefined();
    expect(refused(r, 'helper')).toMatch(/permission denied/);

    for (const label of ['bar_board', 'bar_state', 'cashier_board', 'drv_board', 'drv_state', 'mkt_board',
                         'mkt_state', 'drv_save', 'mkt_save']) {
      expect(refused(r, label), label).toBe('FORBIDDEN');
    }
    for (const tbl of ['checklist_templates', 'checklist_template_items', 'checklist_runs', 'checklist_run_items']) {
      for (const who of ['drv', 'mkt', 'bar1']) {
        expect(ok<number>(r, `read_${who}_${tbl}`), `${who} reads ${tbl}`).toBe(0);
      }
      expect(ok<number>(r, `read_manager_${tbl}`), `manager reads ${tbl}`).toBeGreaterThan(0);
    }
  });
});
