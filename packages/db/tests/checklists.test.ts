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
 *   * checklist_board and checklist_day_state are MGMT's (since 0323 the
 *     board opens today's lists; the day state creates nothing), and the day
 *     state lists only roles someone holds;
 *   * the driver and marketing read no row of the four tables and none of
 *     MGMT's reads (§8.2 denials).
 *
 * checklist_schedules (0323, docs/design/checklists/scheduled-checklists-
 * 2026-10-08.md §6): the schedule maths (weekdays, dates of the month, 31 in
 * February, the due time from the branch's hours), save_checklist and its
 * refusals, archive, the legacy save_checklist_template on the oldest live
 * list, shared / each / people copies with approved leave skipped, the person
 * guard, CHECKLIST_CLOSED, the sweep's due-soon and overdue pushes (once, to
 * the right people), create_branch's copy and the branch guard on
 * checklist_assignees. The review fixes (contract §8): an edit mid-occurrence
 * never closes the running copy nor backdates a new one, a new list starts on
 * its next day, day close has no entry for a list with no copy on purpose and
 * keeps namesakes apart, the board leads a role and slot with the list the
 * legacy save writes, and the sweep pushes only people still at the branch.
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

-- 0323: q() that records an error instead of aborting (a trigger's refusal).
create function pg_temp.tq(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb; v_msg text;
begin
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
delete from checklist_assignees;
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
      // One transaction: both rows share now(), so the id orders them.
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'after', a.after) order by a.at, a.id)
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
      Q('shift', `with x as (update checklist_runs set business_date = business_date - 1, period_end = period_end - 1
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

  it('the board and the day state are MGMT reads; the board opens today’s lists, the day state nothing; held roles only', () => {
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
      Q('runs_none', `select count(*)::text::jsonb from checklist_runs where venue_id = {{venue}}`),
      T('board_before', 'manager', `select app.checklist_board({{venue}})`),
      Q('runs_after_board', `select count(*)::text::jsonb from checklist_runs where venue_id = {{venue}}`),
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
    // 0323: the board for today opens the day's lists (a shared run each,
    // the chef's too: a shared list is opened whoever holds the role).
    expect(bar(ok<Board>(r, 'board_before')).today).toMatchObject({ done: 0, total: 3 });
    const before = ok<State>(r, 'state_before').lists.find((l) => l.role === 'barista')!;
    expect(before).toMatchObject({ slot: 'open', total: 3, done: 0 });
    expect(before.open_items.map((i) => i.text_en)).toEqual(OPEN_ITEMS.map(([en]) => en));
    expect(ok<State>(r, 'state_before').lists.some((l) => l.role === 'chef')).toBe(false);
    expect(ok<number>(r, 'runs_none')).toBe(0);
    expect(ok<number>(r, 'runs_after_board')).toBe(2);
    // The day state opened nothing.
    expect(ok<number>(r, 'runs_before')).toBe(2);

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

// ── checklist_schedules (0323, docs/design/checklists/scheduled-checklists-2026-10-08.md) ──
// A list is for a role (one shared copy, or everyone their own) or for named
// people, repeats on weekdays or dates of the month, and is due at opening,
// closing or a typed time. The sweep pushes before it is due and once it is
// overdue. Same rolled-back harness as above.

/** Postgres writes after a t() call: drop the last caller's JWT claims. */
const NOCLAIMS = `select set_config('request.jwt.claims', '', true);`;
const TODAY = `app.venue_business_date({{venue}})`;

const SCHED_LINES = [
  { text_en: 'Count the float', text_ar: 'عُدّ صندوق الفكة' },
  { text_en: 'Wipe the counter', text_ar: 'امسح الكاونتر' },
];
/** A save_checklist spec: a role's shared daily list due at opening, plus overrides. */
const base = (extra: Record<string, unknown> = {}) => ({
  name_en: 'Bar check',
  name_ar: 'فحص البار',
  audience: 'role',
  role: 'barista',
  copy_mode: 'shared',
  repeat_kind: 'weekdays',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  slot: 'open',
  items: SCHED_LINES,
  ...extra,
});
/** The spec as SQL: the JSON, with fields built in SQL (from vars) merged over it. */
const spec = (b: Record<string, unknown>, sqlFields: Record<string, string> = {}) => {
  const lit = `'${JSON.stringify(b).replace(/'/g, "''")}'::jsonb`;
  const extra = Object.entries(sqlFields).map(([k, v]) => `'${k}', ${v}`).join(', ');
  return extra ? `(${lit} || jsonb_build_object(${extra}))` : lit;
};
const saveList = (id: string | null, version: number | 'null', s: string) =>
  `select app.save_checklist({{venue}}, ${id ? `{{${id}}}::uuid` : 'null'}, ${version}, ${s})`;
const archive = (id: string, version: number) => `select app.archive_checklist({{${id}}}::uuid, ${version})`;
/** q() as postgres that records a refusal (a trigger's) instead of aborting. */
const TQ = (label: string, sql: string) => `select pg_temp.tq('${label}', $q$${sql}$q$);`;

interface SchedList extends List {
  template_id: string;
  audience: string;
  copy_mode: string;
  repeat_kind: string;
  weekdays: number[];
  month_days: number[] | null;
  period_start: string;
  period_end: string;
  due_at: string | null;
  overdue: boolean;
  assignee_id: string | null;
}
interface SchedToday {
  business_date: string;
  lists: SchedList[];
}
interface BoardRun {
  run_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  period_start: string;
  period_end: string;
  due_at: string | null;
  overdue: boolean;
  done: number;
  total: number;
  items: Item[];
}
interface BoardTemplate {
  template_id: string;
  role: string | null;
  slot: string;
  name_en: string;
  version: number;
  audience: string;
  copy_mode: string;
  repeat_kind: string;
  weekdays: number[];
  month_days: number[] | null;
  due_time: string | null;
  assignees: Array<{ id: string; display_name: string; role: string }>;
  runs: BoardRun[];
  today: BoardRun | null;
}
interface SchedBoard {
  business_date: string;
  templates: BoardTemplate[];
}

describe.skipIf(!docker)('checklist_schedules (0323, rolled-back transactions)', () => {
  it('the schedule maths: weekdays, dates of the month, 31 as the last day, and the due time', () => {
    const occ = (label: string, kind: string, wd: string, md: string, day: string) =>
      Q(label, `select to_jsonb(o) from app.checklist_occurrence('${kind}', '${wd}'::smallint[], ${md}, '${day}') o`);
    // Due times against hours set inside the transaction: windows per calendar
    // day, a night past midnight split in two (seed.sql "HOURS").
    const HOURS = {
      thu: [['00:00', '02:00'], ['09:00', '24:00']],
      fri: [['00:00', '02:00'], ['10:00', '24:00']],
      sat: [['12:00', '23:00']],
      sun: [['18:00', '01:00']],
    };
    const due = (label: string, slot: string, time: string, day: string, wantLocal: string) =>
      Q(label, `select jsonb_build_object(
                  'got',  app.checklist_due_at({{venue}}, '${slot}', ${time}, '${day}'),
                  'want', (${wantLocal}) at time zone v.timezone)
                  from venues v where v.id = {{venue}}`);
    const H = `coalesce(app.cafe_setting_int('analytics_business_day_start_hour', {{venue}}), 4)`;
    const r = scenario([
      occ('m31_feb27', 'monthdays', '{0}', "'{31}'", '2027-02-27'),
      occ('m31_feb28', 'monthdays', '{0}', "'{31}'", '2027-02-28'),
      occ('m31_leap', 'monthdays', '{0}', "'{31}'", '2028-02-29'),
      occ('m3031_feb28', 'monthdays', '{0}', "'{30,31}'", '2027-02-28'),
      occ('m1_15_mar1', 'monthdays', '{0}', "'{1,15}'", '2027-03-01'),
      occ('m1_15_mar20', 'monthdays', '{0}', "'{1,15}'", '2027-03-20'),
      occ('m31_apr', 'monthdays', '{0}', "'{31}'", '2027-04-29'),
      occ('sun_thu', 'weekdays', '{0}', 'null', '2026-10-08'),
      occ('sun_sun', 'weekdays', '{0}', 'null', '2026-10-11'),
      occ('tuefri_thu', 'weekdays', '{2,5}', 'null', '2026-10-08'),
      occ('tuefri_fri', 'weekdays', '{2,5}', 'null', '2026-10-09'),
      occ('daily', 'weekdays', '{0,1,2,3,4,5,6}', 'null', '2026-10-08'),
      Q('sched_apr30', `select to_jsonb(app.checklist_is_scheduled('monthdays', '{0}', '{31}', '2027-04-30'))`),
      Q('sched_apr29', `select to_jsonb(app.checklist_is_scheduled('monthdays', '{0}', '{31}', '2027-04-29'))`),

      NOCLAIMS,
      Q('hours', `with x as (update venue_settings set opening_hours = '${JSON.stringify(HOURS)}'::jsonb
                              where venue_id = {{venue}} returning 1) select to_jsonb(count(*)) from x`),
      due('thu_open', 'open', 'null', '2026-10-08', `timestamp '2026-10-08 09:00'`),
      // Open to midnight: the night closes at the next day's 00:00-02:00 tail.
      due('thu_close', 'close', 'null', '2026-10-08', `timestamp '2026-10-09 02:00'`),
      due('sat_open', 'open', 'null', '2026-10-10', `timestamp '2026-10-10 12:00'`),
      due('sat_close', 'close', 'null', '2026-10-10', `timestamp '2026-10-10 23:00'`),
      // An end before its start is after midnight.
      due('sun_close', 'close', 'null', '2026-10-11', `timestamp '2026-10-12 01:00'`),
      // No hours that day: the business day's edges.
      due('wed_open', 'open', 'null', '2026-10-07', `timestamp '2026-10-07 00:00' + make_interval(hours => ${H})`),
      due('wed_close', 'close', 'null', '2026-10-07',
          `timestamp '2026-10-08 00:00' + make_interval(hours => ${H}) - interval '1 minute'`),
      // A typed time on the day; before the start hour it is after midnight.
      due('typed', 'open', `'07:30'`, '2026-10-08', `timestamp '2026-10-08 07:30'`),
      due('typed_night', 'close', `'00:30'`, '2026-10-08',
          `timestamp '2026-10-08 00:30' + case when ${H} > 0 then interval '1 day' else interval '0' end`),

      // The helpers are internal.
      T('client_occ', 'owner', `select to_jsonb(o) from app.checklist_occurrence('weekdays', '{0}', null, '2026-10-08') o`),
      T('client_due', 'owner', `select to_jsonb(app.checklist_due_at({{venue}}, 'open', null, '2026-10-08'))`),
      T('client_mat', 'owner', `select to_jsonb(app.checklist_materialize({{venue}}, '2026-10-08'))`),
      T('client_sweep', 'owner', `select to_jsonb(app.checklist_sweep())`),
    ]);

    const span = (label: string) => ok<{ period_start: string; period_end: string }>(r, label);
    // "31" is the month's last day: 28 February, and 29 in a leap year.
    expect(span('m31_feb27')).toEqual({ period_start: '2027-01-31', period_end: '2027-02-27' });
    expect(span('m31_feb28')).toEqual({ period_start: '2027-02-28', period_end: '2027-03-30' });
    expect(span('m31_leap')).toEqual({ period_start: '2028-02-29', period_end: '2028-03-30' });
    // 30 and 31 both fall on 28 February: one day, not two.
    expect(span('m3031_feb28')).toEqual({ period_start: '2027-02-28', period_end: '2027-03-29' });
    expect(span('m1_15_mar1')).toEqual({ period_start: '2027-03-01', period_end: '2027-03-14' });
    expect(span('m1_15_mar20')).toEqual({ period_start: '2027-03-15', period_end: '2027-03-31' });
    expect(span('m31_apr')).toEqual({ period_start: '2027-03-31', period_end: '2027-04-29' });
    // A Sunday list runs Sunday to Saturday (2026-10-04 is a Sunday).
    expect(span('sun_thu')).toEqual({ period_start: '2026-10-04', period_end: '2026-10-10' });
    expect(span('sun_sun')).toEqual({ period_start: '2026-10-11', period_end: '2026-10-17' });
    expect(span('tuefri_thu')).toEqual({ period_start: '2026-10-06', period_end: '2026-10-08' });
    expect(span('tuefri_fri')).toEqual({ period_start: '2026-10-09', period_end: '2026-10-12' });
    expect(span('daily')).toEqual({ period_start: '2026-10-08', period_end: '2026-10-08' });
    expect(ok<boolean>(r, 'sched_apr30')).toBe(true);
    expect(ok<boolean>(r, 'sched_apr29')).toBe(false);

    expect(ok<number>(r, 'hours')).toBe(1);
    for (const label of ['thu_open', 'thu_close', 'sat_open', 'sat_close', 'sun_close', 'wed_open', 'wed_close',
                         'typed', 'typed_night']) {
      const d = ok<{ got: string; want: string }>(r, label);
      expect(new Date(d.got).toISOString(), label).toBe(new Date(d.want).toISOString());
    }
    for (const label of ['client_occ', 'client_due', 'client_mat', 'client_sweep']) {
      expect(refused(r, label), label).toMatch(/permission denied/);
    }
  });

  it('save_checklist: the owner writes who, how it repeats and when it is due; every field is checked', () => {
    const bad = (label: string, extra: Record<string, unknown>, sql: Record<string, string> = {}) =>
      T(label, 'owner', saveList(null, 0, spec(base(extra), sql)));
    const r = scenario([
      MK('away', 'cashier'),
      MK('gone', 'cashier'),
      NOCLAIMS,
      Q('away_off', `with x as (delete from staff_venues where staff_id = {{away}} returning 1)
                     select to_jsonb(count(*)) from x`),
      Q('gone_off', `with x as (update staff set is_active = false where id = {{gone}} returning 1)
                     select to_jsonb(count(*)) from x`),
      T('new', 'owner', saveList(null, 0, spec(base({
        repeat_kind: 'monthdays', month_days: [31, 1], slot: 'time', due_time: '15:30',
      })))),
      RES('tpl', 'new', 'template_id'),
      Q('row_new', `select jsonb_build_object('slot', slot, 'due_time', due_time, 'repeat_kind', repeat_kind,
                      'weekdays', weekdays, 'month_days', month_days, 'audience', audience, 'copy_mode', copy_mode,
                      'role', role, 'version', version)
                      from checklist_templates where id = {{tpl}}::uuid`),
      T('stale', 'owner', saveList('tpl', 7, spec(base()))),
      T('edit', 'owner', saveList('tpl', 1, spec(base({ copy_mode: 'each', weekdays: [3, 1], slot: 'close' })))),
      Q('row_edit', `select jsonb_build_object('slot', slot, 'due_time', due_time, 'repeat_kind', repeat_kind,
                       'weekdays', weekdays, 'month_days', month_days, 'copy_mode', copy_mode)
                       from checklist_templates where id = {{tpl}}::uuid`),
      // A people list, then the same list for a role: the people go.
      T('people', 'owner', saveList(null, 0, spec(base({ audience: 'people', role: undefined, copy_mode: 'each' }),
        { staff_ids: `jsonb_build_array({{cashier}}, {{owner}}, {{cashier}})` }))),
      RES('ppl', 'people', 'template_id'),
      Q('people_rows', `select to_jsonb(count(*)) from checklist_assignees where template_id = {{ppl}}::uuid`),
      T('people_to_role', 'owner', saveList('ppl', 1, spec(base({ role: 'cashier' })))),
      Q('people_rows_after', `select to_jsonb(count(*)) from checklist_assignees where template_id = {{ppl}}::uuid`),
      // A second list for the same role and slot: (venue, role, slot) is no longer unique.
      T('second', 'owner', saveList(null, 'null', spec(base({ name_en: 'Bar check 2' })))),

      T('no_spec', 'owner', saveList(null, 0, `'{}'::jsonb`)),
      T('spec_array', 'owner', saveList(null, 0, `'[]'::jsonb`)),
      bad('audience', { audience: 'team' }),
      bad('role_bad', { role: 'wizard' }),
      bad('role_none', { role: undefined }),
      bad('prep', { role: 'prep' }),
      bad('copy_bad', { copy_mode: 'some' }),
      bad('people_shared', { audience: 'people', role: undefined, copy_mode: 'shared' },
        { staff_ids: `jsonb_build_array({{cashier}})` }),
      bad('people_none', { audience: 'people', role: undefined, copy_mode: 'each', staff_ids: [] }),
      bad('people_junk', { audience: 'people', role: undefined, copy_mode: 'each', staff_ids: ['nope'] }),
      bad('people_away', { audience: 'people', role: undefined, copy_mode: 'each' },
        { staff_ids: `jsonb_build_array({{cashier}}, {{away}})` }),
      bad('people_gone', { audience: 'people', role: undefined, copy_mode: 'each' },
        { staff_ids: `jsonb_build_array({{gone}})` }),
      bad('kind', { repeat_kind: 'yearly' }),
      bad('wd_empty', { weekdays: [] }),
      bad('wd_range', { weekdays: [7] }),
      bad('wd_dupe', { weekdays: [1, 1] }),
      bad('wd_text', { weekdays: ['1'] }),
      bad('md_none', { repeat_kind: 'monthdays' }),
      bad('md_five', { repeat_kind: 'monthdays', month_days: [1, 2, 3, 4, 5] }),
      bad('md_zero', { repeat_kind: 'monthdays', month_days: [0] }),
      bad('md_32', { repeat_kind: 'monthdays', month_days: [32] }),
      bad('slot', { slot: 'noon' }),
      bad('time_none', { slot: 'time' }),
      bad('time_bad', { slot: 'time', due_time: '24:00' }),
      bad('name_one', { name_ar: '  ' }),
      bad('name_long', { name_en: 'x'.repeat(121) }),
      bad('lines_long', { items: Array.from({ length: 31 }, (_, i) => ({ text_en: `L${i}`, text_ar: `س${i}` })) }),
      bad('line_one', { items: [{ text_en: 'Only English', text_ar: '' }] }),
      bad('line_photo', { items: [{ text_en: 'a', text_ar: 'ب', photo_required: 'yes' }] }),
      T('new_nonzero', 'owner', saveList(null, 3, spec(base()))),
      T('manager', 'manager', saveList(null, 0, spec(base()))),
      T('cashier', 'cashier', saveList(null, 0, spec(base()))),
      T('unknown', 'owner', `select app.save_checklist({{venue}}, '00000000-0000-4000-8000-000000000000', 1, ${spec(base())})`),

      // Archive: owner only, versioned, then the list is gone for writes.
      T('archive_mgr', 'manager', archive('tpl', 2)),
      T('archive_stale', 'owner', archive('tpl', 1)),
      T('archive', 'owner', archive('tpl', 2)),
      T('archive_again', 'owner', archive('tpl', 3)),
      T('edit_archived', 'owner', saveList('tpl', 3, spec(base()))),
      T('archive_unknown', 'owner', `select app.archive_checklist('00000000-0000-4000-8000-000000000000', 1)`),

      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'after', a.after) order by a.at, a.id)
                    from audit_log a
                   where a.entity = 'checklist_template' and a.entity_id = {{tpl}}`),
    ]);

    expect(ok<{ template_id: string; version: number }>(r, 'new').version).toBe(1);
    // A typed time is stored with a derived slot (14:00 and later: close); the dates sorted.
    expect(ok(r, 'row_new')).toEqual({
      slot: 'close', due_time: '15:30:00', repeat_kind: 'monthdays', weekdays: [0, 1, 2, 3, 4, 5, 6],
      month_days: [1, 31], audience: 'role', copy_mode: 'shared', role: 'barista', version: 1,
    });
    expect(refused(r, 'stale')).toBe('TEMPLATE_CHANGED');
    expect(ok<{ version: number }>(r, 'edit')).toMatchObject({ template_id: ok<{ template_id: string }>(r, 'new').template_id, version: 2 });
    expect(ok(r, 'row_edit')).toEqual({
      slot: 'close', due_time: null, repeat_kind: 'weekdays', weekdays: [1, 3], month_days: null, copy_mode: 'each',
    });
    // The people are replaced whole (a duplicate counted once), and dropped with a role.
    expect(ok<number>(r, 'people_rows')).toBe(2);
    expect(ok<{ version: number }>(r, 'people_to_role').version).toBe(2);
    expect(ok<number>(r, 'people_rows_after')).toBe(0);
    expect(ok<{ version: number }>(r, 'second').version).toBe(1);

    expect(refused(r, 'no_spec')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:name');
    expect(refused(r, 'spec_array')).toBe('INVALID_ARGUMENT:spec');
    expect(refused(r, 'audience')).toBe('INVALID_ARGUMENT:audience');
    expect(refused(r, 'role_bad')).toBe('INVALID_ARGUMENT:role');
    expect(refused(r, 'role_none')).toBe('INVALID_ARGUMENT:role');
    expect(refused(r, 'prep')).toBe('INVALID_ROLE:role');
    expect(refused(r, 'copy_bad')).toBe('INVALID_ARGUMENT:copy_mode');
    expect(refused(r, 'people_shared')).toBe('INVALID_ARGUMENT:copy_mode');
    expect(refused(r, 'people_none')).toBe('INVALID_ARGUMENT:staff_ids');
    expect(refused(r, 'people_junk')).toBe('INVALID_ARGUMENT:staff_ids');
    expect(refused(r, 'people_away')).toBe('ASSIGNEE_NOT_AT_BRANCH:staff_ids');
    expect(refused(r, 'people_gone')).toBe('ASSIGNEE_NOT_AT_BRANCH:staff_ids');
    expect(refused(r, 'kind')).toBe('INVALID_ARGUMENT:repeat_kind');
    for (const label of ['wd_empty', 'wd_range', 'wd_dupe', 'wd_text']) {
      expect(refused(r, label), label).toBe('INVALID_ARGUMENT:weekdays');
    }
    for (const label of ['md_none', 'md_five', 'md_zero', 'md_32']) {
      expect(refused(r, label), label).toBe('INVALID_ARGUMENT:month_days');
    }
    expect(refused(r, 'slot')).toBe('INVALID_ARGUMENT:slot');
    expect(refused(r, 'time_none')).toBe('INVALID_ARGUMENT:due_time');
    expect(refused(r, 'time_bad')).toBe('INVALID_ARGUMENT:due_time');
    expect(refused(r, 'name_one')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:name');
    expect(refused(r, 'name_long')).toBe('TEXT_TOO_LONG:name');
    expect(refused(r, 'lines_long')).toBe('LIST_TOO_LONG:items');
    expect(refused(r, 'line_one')).toBe('TEXT_BOTH_LANGUAGES_REQUIRED:items');
    expect(refused(r, 'line_photo')).toBe('INVALID_ARGUMENT:items');
    expect(refused(r, 'new_nonzero')).toBe('TEMPLATE_CHANGED');
    expect(refused(r, 'manager')).toBe('FORBIDDEN');
    expect(refused(r, 'cashier')).toBe('FORBIDDEN');
    expect(refused(r, 'unknown')).toBe('CHECKLIST_NOT_FOUND');

    expect(refused(r, 'archive_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'archive_stale')).toBe('TEMPLATE_CHANGED');
    expect(ok<{ version: number; archived_at: string }>(r, 'archive')).toMatchObject({ version: 3 });
    expect(ok<{ archived_at: string | null }>(r, 'archive').archived_at).not.toBeNull();
    // Archiving an archived list answers as it is.
    expect(ok<{ version: number }>(r, 'archive_again').version).toBe(3);
    expect(refused(r, 'edit_archived')).toBe('CHECKLIST_NOT_FOUND');
    expect(refused(r, 'archive_unknown')).toBe('CHECKLIST_NOT_FOUND');

    // Audited with the schedule and counts, never the text.
    const audit = ok<Array<{ action: string; after: Record<string, unknown> }>>(r, 'audit');
    expect(audit.map((a) => a.action)).toEqual(['checklist.save', 'checklist.save', 'checklist.archive']);
    expect(audit[0]!.after).toEqual({
      audience: 'role', role: 'barista', copy_mode: 'shared', repeat_kind: 'monthdays',
      weekdays: [0, 1, 2, 3, 4, 5, 6], month_days: [1, 31], slot: 'close', due_time: '15:30', version: 1,
      items: 2, people: 0,
    });
    expect(audit[2]!.after).toEqual({ version: 3, archived: true });
  });

  it('the legacy save_checklist_template keeps working: the oldest live role list, its schedule kept', () => {
    const r = scenario([
      T('l1', 'owner', save('barista', 'open', 0, 'Bar opening', OPEN_ITEMS)),
      RES('lt', 'l1', 'template_id'),
      T('l2', 'owner', save('barista', 'open', 1, 'Bar opening 2', OPEN_ITEMS.slice(0, 2))),
      Q('row_new', `select jsonb_build_object('audience', audience, 'copy_mode', copy_mode, 'repeat_kind', repeat_kind,
                      'weekdays', weekdays, 'due_time', due_time, 'archived_at', archived_at)
                      from checklist_templates where id = {{lt}}::uuid`),
      // The new editor puts it on Fridays, everyone their own copy.
      T('sched', 'owner', saveList('lt', 2, spec(base({ name_en: 'Bar opening', weekdays: [5], copy_mode: 'each' })))),
      // An old station saves the same list again: the same row, its schedule kept.
      T('l3', 'owner', save('barista', 'open', 3, 'Bar opening 3', OPEN_ITEMS)),
      Q('row_l3', `select jsonb_build_object('name_en', name_en, 'weekdays', weekdays, 'copy_mode', copy_mode,
                     'version', version, 'lines', (select count(*) from checklist_template_items i where i.template_id = t.id))
                     from checklist_templates t where id = {{lt}}::uuid`),
      // A newer list for the same role and slot is not the one an old station edits.
      T('newer', 'owner', saveList(null, 0, spec(base({ name_en: 'Bar opening (newer)' })))),
      RES('nt', 'newer', 'template_id'),
      NOCLAIMS,
      Q('age', `with x as (update checklist_templates set created_at = created_at + interval '1 second'
                            where id = {{nt}}::uuid returning 1) select to_jsonb(count(*)) from x`),
      T('l4', 'owner', save('barista', 'open', 4, 'Bar opening 4', OPEN_ITEMS)),
      // Once the oldest is archived, the next one is.
      T('arch', 'owner', archive('lt', 5)),
      T('l5_stale', 'owner', save('barista', 'open', 5, 'Bar opening 5', OPEN_ITEMS)),
      T('l5', 'owner', save('barista', 'open', 1, 'Bar opening 5', OPEN_ITEMS)),
      // A role list the old build never had: created shared, every day, due at closing.
      T('fresh', 'owner', save('cashier', 'close', 0, 'Till closing', OPEN_ITEMS)),
      RES('ft', 'fresh', 'template_id'),
      Q('row_fresh', `select jsonb_build_object('audience', audience, 'copy_mode', copy_mode, 'repeat_kind', repeat_kind,
                        'weekdays', weekdays, 'month_days', month_days, 'due_time', due_time, 'slot', slot)
                        from checklist_templates where id = {{ft}}::uuid`),
    ]);

    const id = ok<{ template_id: string }>(r, 'l1').template_id;
    expect(ok(r, 'l2')).toEqual({ template_id: id, version: 2 });
    expect(ok(r, 'row_new')).toEqual({
      audience: 'role', copy_mode: 'shared', repeat_kind: 'weekdays', weekdays: [0, 1, 2, 3, 4, 5, 6],
      due_time: null, archived_at: null,
    });
    expect(ok(r, 'sched')).toEqual({ template_id: id, version: 3 });
    expect(ok(r, 'l3')).toEqual({ template_id: id, version: 4 });
    expect(ok(r, 'row_l3')).toEqual({ name_en: 'Bar opening 3', weekdays: [5], copy_mode: 'each', version: 4, lines: 3 });
    expect(ok(r, 'l4')).toEqual({ template_id: id, version: 5 });
    expect(ok<{ version: number }>(r, 'arch').version).toBe(6);
    expect(refused(r, 'l5_stale')).toBe('TEMPLATE_CHANGED');
    expect(ok(r, 'l5')).toEqual({ template_id: ok<{ template_id: string }>(r, 'newer').template_id, version: 2 });
    expect(ok(r, 'row_fresh')).toEqual({
      audience: 'role', copy_mode: 'shared', repeat_kind: 'weekdays', weekdays: [0, 1, 2, 3, 4, 5, 6],
      month_days: null, due_time: null, slot: 'close',
    });
  });

  it('shared, each and people lists: who gets a copy, leave, the payload, the order and who may tick', () => {
    const r = scenario([
      NOCLAIMS,
      // Only this test's baristas hold the role at the branch.
      Q('no_baristas', `with x as (update staff set is_active = false where role = 'barista' and is_active returning 1)
                        select to_jsonb(count(*)) from x`),
      MK('bar1', 'barista'),
      MK('bar2', 'barista'),
      MK('bar3', 'barista'),
      MK('cash1', 'cashier'),
      NOCLAIMS,
      KEEP('today', `select ${TODAY}::text`),
      // bar3 is on approved leave around today.
      Q('leave', `with x as (insert into staff_requests (staff_id, kind, status, from_date, to_date, decided_by, decided_at)
                              values ({{bar3}}, 'leave', 'approved', {{today}}::date - 3, {{today}}::date + 1, {{owner}}, now())
                              returning 1) select to_jsonb(count(*)) from x`),
      // Two days ago's weekday, so the weekly list's occurrence began then.
      KEEP('wd2', `select ((extract(dow from {{today}}::date)::int + 5) % 7)::text`),
      Q('own_name', `select to_jsonb(display_name) from staff where id = {{owner}}::uuid`),

      T('l_shared', 'owner', saveList(null, 0, spec(base({ name_en: 'Shared daily' })))),
      RES('ls', 'l_shared', 'template_id'),
      T('l_each', 'owner', saveList(null, 0, spec(base({ name_en: 'Each weekly', copy_mode: 'each' }),
        { weekdays: `jsonb_build_array({{wd2}}::int)` }))),
      RES('le', 'l_each', 'template_id'),
      T('l_people', 'owner', saveList(null, 0, spec(base({ name_en: 'People daily', audience: 'people', role: undefined,
        copy_mode: 'each', slot: 'time', due_time: '13:00' }),
        { staff_ids: `jsonb_build_array({{bar1}}, {{cash1}}, {{owner}}, {{bar3}})` }))),
      RES('lp', 'l_people', 'template_id'),

      NOCLAIMS,
      // The weekly list was saved before its occurrence began two days ago (a
      // list saved after it would start on its next day).
      Q('each_age', `with x as (update checklist_templates set updated_at = now() - interval '7 days'
                                 where id = {{le}}::uuid returning 1) select to_jsonb(count(*)) from x`),
      Q('mat', `select to_jsonb(app.checklist_materialize({{venue}}, {{today}}::date))`),
      Q('mat_again', `select to_jsonb(app.checklist_materialize({{venue}}, {{today}}::date))`),
      Q('runs', `select jsonb_agg(jsonb_build_object('t', t.name_en, 'who', s.display_name, 'start', r.business_date,
                   'end', r.period_end, 'role', r.role) order by t.name_en, s.display_name nulls first)
                   from checklist_runs r join checklist_templates t on t.id = r.template_id
                   left join staff s on s.id = r.assignee_id where r.venue_id = {{venue}}`),
      // Fix the clock-dependent due times: the weekly list (due two days ago)
      // stays overdue; the people list is due in an hour, the shared one in three.
      Q('due_fix', `with x as (update checklist_runs
                                  set due_at = now() + case template_id when {{lp}}::uuid then interval '1 hour'
                                                                        else interval '3 hours' end
                                where template_id in ({{ls}}::uuid, {{lp}}::uuid) returning 1)
                    select to_jsonb(count(*)) from x`),

      T('bar1_today', 'bar1', `select app.my_checklists_today({{venue}})`),
      T('bar2_today', 'bar2', `select app.my_checklists_today({{venue}})`),
      T('bar3_today', 'bar3', `select app.my_checklists_today({{venue}})`),
      T('cash1_today', 'cash1', `select app.my_checklists_today({{venue}})`),
      T('owner_today', 'owner', `select app.my_checklists_today({{venue}})`),
      T('mgr_today', 'manager', `select app.my_checklists_today({{venue}})`),

      KEEP('e1', `select i.id::text from checklist_run_items i join checklist_runs r on r.id = i.run_id
                   where r.template_id = {{le}}::uuid and r.assignee_id = {{bar1}}::uuid order by i.position limit 1`),
      KEEP('p_cash', `select i.id::text from checklist_run_items i join checklist_runs r on r.id = i.run_id
                       where r.template_id = {{lp}}::uuid and r.assignee_id = {{cash1}}::uuid order by i.position limit 1`),
      KEEP('p_own', `select i.id::text from checklist_run_items i join checklist_runs r on r.id = i.run_id
                      where r.template_id = {{lp}}::uuid and r.assignee_id = {{owner}}::uuid order by i.position limit 1`),
      KEEP('s1', `select i.id::text from checklist_run_items i join checklist_runs r on r.id = i.run_id
                   where r.template_id = {{ls}}::uuid order by i.position limit 1`),
      T('tick_other', 'bar2', `select app.mark_checklist_item({{e1}}, true)`),
      T('tick_role_other', 'cash1', `select app.mark_checklist_item({{e1}}, true)`),
      T('tick_own', 'bar1', `select app.mark_checklist_item({{e1}}, true)`),
      T('tick_mgr', 'manager', `select app.mark_checklist_item({{p_cash}}, true)`),
      T('tick_people_other', 'bar1', `select app.mark_checklist_item({{p_cash}}, false)`),
      T('tick_owner_own', 'owner', `select app.mark_checklist_item({{p_own}}, true)`),
      T('tick_shared', 'bar3', `select app.mark_checklist_item({{s1}}, true)`),

      T('board', 'manager', `select app.checklist_board({{venue}})`),
      T('state', 'manager', `select app.checklist_day_state({{venue}})`),
      T('options', 'manager', `select app.checklist_staff_options({{venue}})`),
      T('options_bar', 'bar1', `select app.checklist_staff_options({{venue}})`),
      T('assignees_mgr', 'manager', `select to_jsonb(count(*)) from checklist_assignees`),
      T('assignees_bar', 'bar1', `select to_jsonb(count(*)) from checklist_assignees`),
      T('assignees_write', 'manager', `with x as (insert into checklist_assignees (template_id, staff_id, venue_id)
                                         values ({{lp}}::uuid, {{bar2}}::uuid, {{venue}}::uuid) returning 1)
                                       select to_jsonb(count(*)) from x`),

      // The owner turns the shared list into everyone's own copy mid-occurrence:
      // today's shared run stays until the occurrence ends.
      T('to_each', 'owner', saveList('ls', 1, spec(base({ name_en: 'Shared daily', copy_mode: 'each' })))),
      NOCLAIMS,
      Q('mat_shape', `select to_jsonb(app.checklist_materialize({{venue}}, {{today}}::date))`),
      T('bar2_after_edit', 'bar2', `select app.my_checklists_today({{venue}})`),

      // A run whose occurrence ended takes no tick; the next one is the edited list.
      NOCLAIMS,
      Q('shift', `with x as (update checklist_runs set business_date = business_date - 2, period_end = period_end - 2
                              where template_id = {{ls}}::uuid returning 1) select to_jsonb(count(*)) from x`),
      T('tick_closed', 'bar1', `select app.mark_checklist_item({{s1}}, false)`),
      T('bar2_next', 'bar2', `select app.my_checklists_today({{venue}})`),

      // Archived: hidden everywhere at once, open runs included.
      T('arch', 'owner', archive('lp', 1)),
      T('cash1_archived', 'cash1', `select app.my_checklists_today({{venue}})`),
      T('tick_archived', 'owner', `select app.mark_checklist_item({{p_own}}, false)`),
      T('board_archived', 'owner', `select app.checklist_board({{venue}})`),
      T('state_archived', 'owner', `select app.checklist_day_state({{venue}})`),
    ]);

    const today = ok<SchedToday>(r, 'bar1_today').business_date;
    const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const wd2 = (new Date(`${today}T00:00:00Z`).getUTCDay() + 5) % 7;

    // One shared run; a copy per active barista except the one on leave; a
    // copy per named person except the one on leave. Idempotent.
    expect(ok<number>(r, 'mat')).toBe(1 + 2 + 3);
    expect(ok<number>(r, 'mat_again')).toBe(0);
    type Run = { t: string; who: string | null; start: string; end: string; role: string | null };
    const runs = ok<Run[]>(r, 'runs');
    const ownName = ok<string>(r, 'own_name');
    expect(runs.filter((x) => x.t === 'Each weekly').map((x) => [x.who, x.start, x.end, x.role])).toEqual([
      ['CL bar1', plus(today, -2), plus(today, 4), 'barista'],
      ['CL bar2', plus(today, -2), plus(today, 4), 'barista'],
    ]);
    expect(runs.filter((x) => x.t === 'People daily').map((x) => [x.who, x.start, x.end, x.role])).toEqual(
      [['CL bar1', today, today, null], ['CL cash1', today, today, null], [ownName, today, today, null]],
    );
    expect(runs.filter((x) => x.t === 'Shared daily').map((x) => [x.who, x.start, x.end])).toEqual([[null, today, today]]);

    // bar1: their weekly copy (overdue) first, then their people copy (due in
    // an hour), then the shared list (in three).
    const b1 = ok<SchedToday>(r, 'bar1_today');
    expect(b1.lists.map((l) => [l.name_en, l.assignee_id === null ? 'shared' : 'own', l.overdue])).toEqual([
      ['Each weekly', 'own', true],
      ['People daily', 'own', false],
      ['Shared daily', 'shared', false],
    ]);
    expect(Object.keys(b1.lists[0]!).sort()).toEqual([
      'assignee_id', 'audience', 'copy_mode', 'done', 'due_at', 'due_time', 'items', 'month_days', 'name_ar', 'name_en',
      'overdue', 'period_end', 'period_start', 'repeat_kind', 'role', 'run_id', 'slot', 'template_id', 'total', 'weekdays',
    ]);
    expect(b1.lists[0]).toMatchObject({
      audience: 'role', copy_mode: 'each', repeat_kind: 'weekdays', weekdays: [wd2], month_days: null,
      period_start: plus(today, -2), period_end: plus(today, 4), role: 'barista', total: 2, done: 0,
    });
    // A typed due time rides along (the phone then drops the derived "Opening" label).
    expect(b1.lists[1]).toMatchObject({ audience: 'people', copy_mode: 'each', role: null, slot: 'open', total: 2,
                                        due_time: '13:00' });
    expect(b1.lists[2]).toMatchObject({ audience: 'role', copy_mode: 'shared', assignee_id: null, total: 2, due_time: null });
    // bar2 has their own weekly copy (another run) and the shared list.
    const b2 = ok<SchedToday>(r, 'bar2_today');
    expect(b2.lists.map((l) => l.name_en)).toEqual(['Each weekly', 'Shared daily']);
    expect(b2.lists[0]!.run_id).not.toBe(b1.lists[0]!.run_id);
    expect(b2.lists[1]!.run_id).toBe(b1.lists[2]!.run_id);
    // bar3 is on leave: no copy of their own, the role's shared list still.
    expect(ok<SchedToday>(r, 'bar3_today').lists.map((l) => l.name_en)).toEqual(['Shared daily']);
    expect(ok<SchedToday>(r, 'cash1_today').lists.map((l) => l.name_en)).toEqual(['People daily']);
    expect(ok<SchedToday>(r, 'owner_today').lists.map((l) => l.name_en)).toEqual(['People daily']);
    expect(ok<SchedToday>(r, 'mgr_today').lists).toEqual([]);

    // A person's copy: that person or MGMT; a shared list: its role.
    expect(refused(r, 'tick_other')).toBe('FORBIDDEN');
    expect(refused(r, 'tick_role_other')).toBe('FORBIDDEN');
    expect(ok<Item>(r, 'tick_own').done_by_name).toBe('CL bar1');
    expect(ok<Item>(r, 'tick_mgr').done_by_name).toBe('Dev Manager');
    expect(refused(r, 'tick_people_other')).toBe('FORBIDDEN');
    expect(ok<Item>(r, 'tick_owner_own').done_by_name).toBe(ownName);
    expect(ok<Item>(r, 'tick_shared').done_by_name).toBe('CL bar3');

    // The board: the schedule, the people and every current run.
    const board = ok<SchedBoard>(r, 'board');
    const tpl = (name: string) => board.templates.find((t) => t.name_en === name)!;
    expect(Object.keys(tpl('Each weekly')).sort()).toEqual([
      'assignees', 'audience', 'copy_mode', 'due_time', 'items', 'month_days', 'name_ar', 'name_en', 'repeat_kind',
      'role', 'runs', 'slot', 'template_id', 'today', 'version', 'weekdays',
    ]);
    expect(Object.keys(tpl('Each weekly').runs[0]!).sort()).toEqual([
      'assignee_id', 'assignee_name', 'done', 'due_at', 'items', 'overdue', 'period_end', 'period_start', 'run_id',
      'total',
    ]);
    expect(tpl('Each weekly').runs.map((x) => [x.assignee_name, x.done, x.overdue])).toEqual([
      ['CL bar1', 1, true],
      ['CL bar2', 0, true],
    ]);
    // Old builds read `today`: the shared run, else the first.
    expect(tpl('Each weekly').today!.run_id).toBe(tpl('Each weekly').runs[0]!.run_id);
    expect(tpl('Shared daily').today).toMatchObject({ assignee_id: null, done: 1, total: 2 });
    expect(tpl('People daily')).toMatchObject({ audience: 'people', role: null, due_time: '13:00', copy_mode: 'each' });
    expect(tpl('People daily').assignees.map((a) => a.display_name).sort()).toEqual(
      ['CL bar1', 'CL bar3', 'CL cash1', ownName].sort(),
    );
    expect(tpl('People daily').runs).toHaveLength(3);

    // The day state: one entry per current run, the person named.
    type StateEntry = { name_en: string; assignee_name: string | null; overdue: boolean; template_id: string;
                        period_start: string; period_end: string; due_at: string | null; done: number; total: number };
    const state = ok<{ lists: StateEntry[] }>(r, 'state').lists;
    expect(state.filter((l) => l.name_en === 'Each weekly').map((l) => [l.assignee_name, l.overdue, l.period_start])).toEqual([
      ['CL bar1', true, plus(today, -2)],
      ['CL bar2', true, plus(today, -2)],
    ]);
    expect(state.filter((l) => l.name_en === 'People daily')).toHaveLength(3);
    expect(state.filter((l) => l.name_en === 'Shared daily').map((l) => l.assignee_name)).toEqual([null]);

    // The picker: active staff at the branch plus the owners; MGMT only.
    const options = ok<Array<{ id: string; display_name: string; role: string }>>(r, 'options');
    expect(options.map((o) => o.display_name)).toEqual(expect.arrayContaining(['CL bar1', 'CL bar2', 'CL bar3', 'CL cash1', 'Dev Manager']));
    expect(options.some((o) => o.role === 'owner')).toBe(true);
    expect(options.every((o) => Object.keys(o).sort().join() === 'display_name,id,role')).toBe(true);
    expect(refused(r, 'options_bar')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'assignees_mgr')).toBe(4);
    expect(ok<number>(r, 'assignees_bar')).toBe(0);
    expect(refused(r, 'assignees_write')).toMatch(/permission denied/);

    // The edit to everyone's own copy waits for the next occurrence.
    expect(ok<{ version: number }>(r, 'to_each').version).toBe(2);
    expect(ok<number>(r, 'mat_shape')).toBe(0);
    expect(ok<SchedToday>(r, 'bar2_after_edit').lists.find((l) => l.name_en === 'Shared daily')).toMatchObject({
      assignee_id: null, copy_mode: 'each',
    });
    expect(refused(r, 'tick_closed')).toBe('CHECKLIST_CLOSED');
    const next = ok<SchedToday>(r, 'bar2_next').lists.find((l) => l.name_en === 'Shared daily')!;
    expect(next.assignee_id).not.toBeNull();
    expect(next.period_start).toBe(today);

    expect(ok<{ version: number }>(r, 'arch').version).toBe(2);
    expect(ok<SchedToday>(r, 'cash1_archived').lists).toEqual([]);
    expect(refused(r, 'tick_archived')).toBe('CHECKLIST_CLOSED');
    expect(ok<SchedBoard>(r, 'board_archived').templates.some((t) => t.name_en === 'People daily')).toBe(false);
    expect(ok<{ lists: StateEntry[] }>(r, 'state_archived').lists.some((l) => l.name_en === 'People daily')).toBe(false);
  });

  it('a monthly list materialises the right occurrence and due time on any date', () => {
    const r = scenario([
      T('m', 'owner', saveList(null, 0, spec(base({ name_en: 'Month end', repeat_kind: 'monthdays', month_days: [31],
        slot: 'time', due_time: '08:00' })))),
      NOCLAIMS,
      Q('feb27', `select to_jsonb(app.checklist_materialize({{venue}}, '2027-02-27'))`),
      Q('feb27_again', `select to_jsonb(app.checklist_materialize({{venue}}, '2027-02-27'))`),
      Q('feb28', `select to_jsonb(app.checklist_materialize({{venue}}, '2027-02-28'))`),
      Q('runs', `select jsonb_agg(jsonb_build_object('start', r.business_date, 'end', r.period_end,
                   'due_ok', r.due_at = ((r.business_date + time '08:00') at time zone v.timezone),
                   'lines', (select count(*) from checklist_run_items i where i.run_id = r.id),
                   'pushed', r.due_pushed_at is not null or r.overdue_pushed_at is not null)
                   order by r.business_date)
                   from checklist_runs r join venues v on v.id = r.venue_id where r.venue_id = {{venue}}`),
    ]);
    expect(ok<number>(r, 'feb27')).toBe(1);
    expect(ok<number>(r, 'feb27_again')).toBe(0);
    expect(ok<number>(r, 'feb28')).toBe(1);
    expect(ok(r, 'runs')).toEqual([
      { start: '2027-01-31', end: '2027-02-27', due_ok: true, lines: 2, pushed: false },
      { start: '2027-02-28', end: '2027-03-30', due_ok: true, lines: 2, pushed: false },
    ]);
  });

  it('the sweep pushes due-soon and overdue once each, to the right people', () => {
    const OUTBOX = `select coalesce(jsonb_agg(jsonb_build_object(
                       'to', s.display_name, 'role', s.role, 'key', o.payload->>'title_key', 'list', t.name_en,
                       'kind', o.kind, 'route', o.payload->>'route', 'step', o.payload->'params'->'step',
                       'dedupe', o.payload->>'dedupe' = 'checklist:' || r.id || ':' || (o.payload->>'title_key'))
                       order by t.name_en, o.payload->>'title_key', s.display_name), '[]'::jsonb)
                      from notification_outbox o
                      join checklist_runs r on r.id::text = o.payload->>'id'
                      join checklist_templates t on t.id = r.template_id
                      join staff s on s.id = o.profile_id
                     where o.payload->>'route' = 'staff-checklist'`;
    const r = scenario([
      NOCLAIMS,
      Q('no_baristas', `with x as (update staff set is_active = false where role = 'barista' and is_active returning 1)
                        select to_jsonb(count(*)) from x`),
      MK('bar1', 'barista'),
      MK('bar2', 'barista'),
      MK('bar3', 'barista'),
      MK('cash1', 'cashier'),
      NOCLAIMS,
      KEEP('today', `select ${TODAY}::text`),
      // bar3 is on approved leave today: no copy of a list that starts today,
      // and no push.
      Q('leave', `with x as (insert into staff_requests (staff_id, kind, status, from_date, to_date, decided_by, decided_at)
                              values ({{bar3}}, 'leave', 'approved', {{today}}::date, {{today}}::date, {{owner}}, now())
                              returning 1) select to_jsonb(count(*)) from x`),
      T('shared', 'owner', saveList(null, 0, spec(base({ name_en: 'S shared' })))),
      RES('ls', 'shared', 'template_id'),
      T('people', 'owner', saveList(null, 0, spec(base({ name_en: 'P people', audience: 'people', role: undefined,
        copy_mode: 'each' }), { staff_ids: `jsonb_build_array({{cash1}}, {{bar3}})` }))),
      RES('lp', 'people', 'template_id'),
      T('owners', 'owner', saveList(null, 0, spec(base({ name_en: 'O owners', role: 'owner' })))),
      RES('lo', 'owners', 'template_id'),
      T('done', 'owner', saveList(null, 0, spec(base({ name_en: 'F finished', audience: 'people', role: undefined,
        copy_mode: 'each' }), { staff_ids: `jsonb_build_array({{cash1}})` }))),
      RES('lf', 'done', 'template_id'),
      NOCLAIMS,
      Q('mat', `select to_jsonb(app.checklist_materialize({{venue}}, {{today}}::date))`),
      // Due soon (in ten minutes), past due, past due but finished.
      Q('due_fix', `with x as (update checklist_runs
                                  set due_at = now() + case template_id when {{ls}}::uuid then interval '10 minutes'
                                                                        else interval '-1 minute' end
                                where venue_id = {{venue}} returning 1) select to_jsonb(count(*)) from x`),
      Q('finish', `with x as (update checklist_run_items i set done_at = now(), done_by = {{cash1}}::uuid
                               from checklist_runs r where r.id = i.run_id and r.template_id = {{lf}}::uuid
                               returning 1) select to_jsonb(count(*)) from x`),
      Q('sweep1', `select to_jsonb(app.checklist_sweep())`),
      Q('out1', OUTBOX),
      Q('stamps1', `select jsonb_object_agg(t.name_en, jsonb_build_object('due', r.due_pushed_at is not null,
                                                                          'overdue', r.overdue_pushed_at is not null))
                      from checklist_runs r join checklist_templates t on t.id = r.template_id
                     where r.template_id in ({{ls}}::uuid, {{lp}}::uuid)`),
      Q('sweep2', `select to_jsonb(app.checklist_sweep())`),
      // The shared list passes its due time: one overdue push more.
      Q('past', `with x as (update checklist_runs set due_at = now() - interval '1 minute'
                             where template_id = {{ls}}::uuid returning 1) select to_jsonb(count(*)) from x`),
      Q('sweep3', `select to_jsonb(app.checklist_sweep())`),
      Q('sweep4', `select to_jsonb(app.checklist_sweep())`),
      Q('out2', OUTBOX),
    ]);

    type Push = { to: string; role: string; key: string; list: string; kind: string; route: string;
                  step: { en: string; ar: string }; dedupe: boolean };
    const out1 = ok<Push[]>(r, 'out1');
    // The shared list's role holders (not the one on leave, not the owner),
    // the people list's person (bar3 on leave got no copy), every owner for
    // the owners' list; nothing for the finished list.
    expect(out1.filter((p) => p.list === 'S shared').map((p) => [p.to, p.key])).toEqual([
      ['CL bar1', 'checklist_due'],
      ['CL bar2', 'checklist_due'],
    ]);
    expect(out1.filter((p) => p.list === 'P people').map((p) => [p.to, p.key])).toEqual([['CL cash1', 'checklist_overdue']]);
    const owners = out1.filter((p) => p.list === 'O owners');
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.every((p) => p.role === 'owner' && p.key === 'checklist_overdue')).toBe(true);
    expect(out1.some((p) => p.list === 'F finished')).toBe(false);
    expect(ok<number>(r, 'sweep1')).toBe(out1.length);
    for (const p of out1) {
      expect(p).toMatchObject({ kind: 'staff_task', route: 'staff-checklist', dedupe: true });
      expect(p.step.en).toBe(p.list);
      expect(p.step.ar).toBe('فحص البار');
    }
    const stamps = ok<Record<string, { due: boolean; overdue: boolean }>>(r, 'stamps1');
    expect(stamps['S shared']).toEqual({ due: true, overdue: false });
    // Created after its due time: only the overdue push.
    expect(stamps['P people']).toEqual({ due: false, overdue: true });

    // Once each: a second run sends nothing; the shared list's overdue push once.
    expect(ok<number>(r, 'sweep2')).toBe(0);
    expect(ok<number>(r, 'sweep3')).toBe(2);
    expect(ok<number>(r, 'sweep4')).toBe(0);
    const out2 = ok<Push[]>(r, 'out2');
    expect(out2.filter((p) => p.list === 'S shared').map((p) => [p.to, p.key])).toEqual([
      ['CL bar1', 'checklist_due'],
      ['CL bar2', 'checklist_due'],
      ['CL bar1', 'checklist_overdue'],
      ['CL bar2', 'checklist_overdue'],
    ]);
    expect(out2).toHaveLength(out1.length + 2);
  });

  // ── the 0323 review (2026-10-08): edits, new lists, leave, old builds, the push ──

  /** The runs of one list (a var holding its template id), as {start, end, current on `day`}. */
  const runsOf = (label: string, tpl: string, day: string) =>
    Q(label, `select coalesce(jsonb_agg(jsonb_build_object('start', r.business_date, 'end', r.period_end,
                'who', r.assignee_id,
                'current', app.checklist_current(r.template_id, r.business_date, r.period_end, ${day}))
                order by r.business_date, r.assignee_id), '[]'::jsonb)
                from checklist_runs r where r.template_id = {{${tpl}}}::uuid`);
  const mat = (label: string, day: string) => Q(label, `select to_jsonb(app.checklist_materialize({{venue}}, ${day}))`);
  type RunRow = { start: string; end: string; who: string | null; current: boolean };
  type StateRow = { name_en: string; assignee_name: string | null; assignee_id: string | null; run_id: string | null;
                    done: number; total: number; period_start: string | null; overdue: boolean };

  it('an edit mid-occurrence applies from the next occurrence: a Sunday list, Wednesday added on Thursday', () => {
    // 2027-01-03 is a Sunday. The list is saved today (2026), before all of these days.
    const r = scenario([
      T('sun', 'owner', saveList(null, 0, spec(base({ name_en: 'Sunday deep clean', role: 'cashier', weekdays: [0] })))),
      RES('ls', 'sun', 'template_id'),
      NOCLAIMS,
      mat('m_sun', `'2027-01-03'`),
      // Half ticked on Sunday.
      Q('half', `with x as (update checklist_run_items i set done_at = now(), done_by = {{cashier}}::uuid
                              from checklist_runs r
                             where r.id = i.run_id and r.template_id = {{ls}}::uuid and i.position = 1
                            returning 1) select to_jsonb(count(*)) from x`),
      mat('m_thu_before', `'2027-01-07'`),
      // Thursday: the owner adds Wednesday.
      T('add_wed', 'owner', saveList('ls', 1, spec(base({ name_en: 'Sunday deep clean', role: 'cashier', weekdays: [0, 3] })))),
      NOCLAIMS,
      mat('m_thu', `'2027-01-07'`),
      runsOf('runs_thu', 'ls', `'2027-01-07'`),
      T('state_thu', 'manager', `select app.checklist_day_state({{venue}}, '2027-01-07')`),
      mat('m_sat', `'2027-01-09'`),
      // The next Sunday the new rule starts: Sunday to Tuesday, then Wednesday to Saturday.
      mat('m_sun2', `'2027-01-10'`),
      runsOf('runs_sun2', 'ls', `'2027-01-10'`),
      mat('m_wed2', `'2027-01-13'`),
      runsOf('runs_wed2', 'ls', `'2027-01-13'`),
    ]);
    expect(ok<number>(r, 'm_sun')).toBe(1);
    expect(ok<number>(r, 'm_thu_before')).toBe(0);
    expect(ok<{ version: number }>(r, 'add_wed').version).toBe(2);
    // Before the fix: a copy born on Wednesday, overdue at once, and Sunday's
    // half-ticked copy closed (CHECKLIST_CLOSED).
    expect(ok<number>(r, 'm_thu')).toBe(0);
    expect(ok<RunRow[]>(r, 'runs_thu').map((x) => [x.start, x.end, x.current])).toEqual([['2027-01-03', '2027-01-09', true]]);
    const thu = ok<{ lists: StateRow[] }>(r, 'state_thu').lists.filter((l) => l.name_en === 'Sunday deep clean');
    expect(thu.map((l) => [l.period_start, l.done, l.total])).toEqual([['2027-01-03', 1, 2]]);
    expect(ok<number>(r, 'm_sat')).toBe(0);
    expect(ok<number>(r, 'm_sun2')).toBe(1);
    expect(ok<RunRow[]>(r, 'runs_sun2').map((x) => [x.start, x.end, x.current])).toEqual([
      ['2027-01-03', '2027-01-09', false],
      ['2027-01-10', '2027-01-12', true],
    ]);
    expect(ok<number>(r, 'm_wed2')).toBe(1);
    expect(ok<RunRow[]>(r, 'runs_wed2').map((x) => [x.start, x.end, x.current])).toEqual([
      ['2027-01-03', '2027-01-09', false],
      ['2027-01-10', '2027-01-12', false],
      ['2027-01-13', '2027-01-16', true],
    ]);
  });

  it('a list moved to an earlier start day keeps its copy, then has none until its next day, and day close does not warn', () => {
    // A daily list, changed on Wednesday 2027-01-06 to Sundays only.
    const r = scenario([
      T('daily', 'owner', saveList(null, 0, spec(base({ name_en: 'Till wipe', role: 'cashier' })))),
      RES('ld', 'daily', 'template_id'),
      NOCLAIMS,
      mat('m_wed', `'2027-01-06'`),
      T('to_sun', 'owner', saveList('ld', 1, spec(base({ name_en: 'Till wipe', role: 'cashier', weekdays: [0] })))),
      NOCLAIMS,
      mat('m_wed_again', `'2027-01-06'`),
      mat('m_thu', `'2027-01-07'`),
      runsOf('runs_thu', 'ld', `'2027-01-07'`),
      T('state_wed', 'manager', `select app.checklist_day_state({{venue}}, '2027-01-06')`),
      T('state_thu', 'manager', `select app.checklist_day_state({{venue}}, '2027-01-07')`),
      T('state_sat', 'manager', `select app.checklist_day_state({{venue}}, '2027-01-09')`),
      mat('m_sun', `'2027-01-10'`),
      runsOf('runs_sun', 'ld', `'2027-01-10'`),
    ]);
    const mine = (label: string) => ok<{ lists: StateRow[] }>(r, label).lists.filter((l) => l.name_en === 'Till wipe');
    expect(ok<number>(r, 'm_wed')).toBe(1);
    expect(ok<number>(r, 'm_wed_again')).toBe(0);
    expect(ok<number>(r, 'm_thu')).toBe(0);
    expect(ok<RunRow[]>(r, 'runs_thu').map((x) => [x.start, x.end, x.current])).toEqual([['2027-01-06', '2027-01-06', false]]);
    // Wednesday's copy is the day's; Thursday to Saturday there is none, and
    // (before the fix) day close warned "0 of 2, overdue since Sunday".
    expect(mine('state_wed').map((l) => [l.period_start, l.run_id !== null])).toEqual([['2027-01-06', true]]);
    expect(mine('state_thu')).toEqual([]);
    expect(mine('state_sat')).toEqual([]);
    expect(ok<number>(r, 'm_sun')).toBe(1);
    expect(ok<RunRow[]>(r, 'runs_sun').map((x) => [x.start, x.end, x.current])).toEqual([
      ['2027-01-06', '2027-01-06', false],
      ['2027-01-10', '2027-01-16', true],
    ]);
  });

  it('a list saved after its occurrence began starts on its next day; a person added mid-occurrence gets the next copy', () => {
    const r = scenario([
      NOCLAIMS,
      KEEP('today', `select ${TODAY}::text`),
      KEEP('wdy', `select extract(dow from {{today}}::date - 1)::int::text`),
      KEEP('mdy', `select extract(day from {{today}}::date - 1)::int::text`),
      KEEP('wd2', `select extract(dow from {{today}}::date - 2)::int::text`),
      // A weekly list whose day was yesterday and a monthly one whose date was
      // yesterday, both made today.
      T('weekly', 'owner', saveList(null, 0, spec(base({ name_en: 'New weekly', role: 'cashier' }),
        { weekdays: `jsonb_build_array({{wdy}}::int)` }))),
      RES('lw', 'weekly', 'template_id'),
      T('monthly', 'owner', saveList(null, 0, spec(base({ name_en: 'New monthly', role: 'cashier', repeat_kind: 'monthdays' }),
        { month_days: `jsonb_build_array({{mdy}}::int)` }))),
      RES('lm', 'monthly', 'template_id'),
      NOCLAIMS,
      mat('m_today', `{{today}}::date`),
      runsOf('runs_w', 'lw', `{{today}}::date`),
      runsOf('runs_m', 'lm', `{{today}}::date`),
      T('state_today', 'manager', `select app.checklist_day_state({{venue}})`),
      Q('sweep', `select to_jsonb(app.checklist_sweep())`),
      Q('pushes', `select to_jsonb(count(*)) from notification_outbox o
                    where o.payload->>'route' = 'staff-checklist'
                      and exists (select 1 from checklist_runs r where r.id::text = o.payload->>'id'
                                   and r.template_id in ({{lw}}::uuid, {{lm}}::uuid))`),
      mat('m_next_w', `{{today}}::date + 6`),
      runsOf('runs_w_next', 'lw', `{{today}}::date + 6`),
      mat('m_next_m', `({{today}}::date - 1 + interval '1 month')::date`),
      runsOf('runs_m_next', 'lm', `({{today}}::date - 1 + interval '1 month')::date`),

      // A people list that began two days ago (saved a week ago) for the
      // cashier; the owner adds the manager today.
      T('people', 'owner', saveList(null, 0, spec(base({ name_en: 'People weekly', audience: 'people', role: undefined,
        copy_mode: 'each' }), { weekdays: `jsonb_build_array({{wd2}}::int)`, staff_ids: `jsonb_build_array({{cashier}})` }))),
      RES('lp', 'people', 'template_id'),
      NOCLAIMS,
      Q('age', `with t as (update checklist_templates set updated_at = now() - interval '7 days'
                            where id = {{lp}}::uuid returning 1),
                     a as (update checklist_assignees set created_at = now() - interval '7 days'
                            where template_id = {{lp}}::uuid returning 1)
                select to_jsonb((select count(*) from t) + (select count(*) from a))`),
      mat('m_people', `{{today}}::date`),
      T('add_mgr', 'owner', saveList('lp', 1, spec(base({ name_en: 'People weekly', audience: 'people', role: undefined,
        copy_mode: 'each' }), { weekdays: `jsonb_build_array({{wd2}}::int)`,
        staff_ids: `jsonb_build_array({{cashier}}, {{manager}})` }))),
      NOCLAIMS,
      Q('kept', `select jsonb_object_agg(case staff_id when {{cashier}}::uuid then 'cashier' else 'manager' end,
                                         created_at < now() - interval '1 day')
                   from checklist_assignees where template_id = {{lp}}::uuid`),
      mat('m_people_again', `{{today}}::date`),
      runsOf('runs_p', 'lp', `{{today}}::date`),
      mat('m_people_next', `{{today}}::date + 5`),
      runsOf('runs_p_next', 'lp', `{{today}}::date + 5`),
    ]);
    const today = ok<{ business_date: string }>(r, 'state_today').business_date;
    const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    // Before the fix: two copies born overdue (since yesterday), and a push.
    expect(ok<number>(r, 'm_today')).toBe(0);
    expect(ok<RunRow[]>(r, 'runs_w')).toEqual([]);
    expect(ok<RunRow[]>(r, 'runs_m')).toEqual([]);
    expect(ok<{ lists: StateRow[] }>(r, 'state_today').lists.filter((l) => l.name_en.startsWith('New '))).toEqual([]);
    expect(ok<number>(r, 'pushes')).toBe(0);
    expect(ok<number>(r, 'm_next_w')).toBe(1);
    expect(ok<RunRow[]>(r, 'runs_w_next').map((x) => [x.start, x.current])).toEqual([[plus(today, 6), true]]);
    // (That day also opens the weekly list's later occurrence, so the count is not checked.)
    expect(ok<number>(r, 'm_next_m')).toBeGreaterThanOrEqual(1);
    expect(ok<RunRow[]>(r, 'runs_m_next')).toHaveLength(1);
    expect(ok<RunRow[]>(r, 'runs_m_next')[0]!.current).toBe(true);

    expect(ok<number>(r, 'age')).toBe(2);
    expect(ok<number>(r, 'm_people')).toBe(1);
    expect(ok<{ version: number }>(r, 'add_mgr').version).toBe(2);
    // The cashier stayed on the list, so their row (and its date) is kept.
    expect(ok(r, 'kept')).toEqual({ cashier: true, manager: false });
    expect(ok<number>(r, 'm_people_again')).toBe(0);
    expect(ok<RunRow[]>(r, 'runs_p').map((x) => [x.start, x.who])).toEqual([[plus(today, -2), SEED_STAFF_IDS.cashier]]);
    expect(ok<number>(r, 'm_people_next')).toBe(2);
    expect(ok<RunRow[]>(r, 'runs_p_next').filter((x) => x.current).map((x) => x.start)).toEqual([plus(today, 5), plus(today, 5)]);
  });

  it('day close: no entry for lists whose people are on leave; one entry per copy, two people of one name kept apart', () => {
    const r = scenario([
      NOCLAIMS,
      Q('quiet', `with x as (update staff set is_active = false
                              where role in ('barista', 'head_barista') and is_active returning 1)
                  select to_jsonb(count(*)) from x`),
      MK('ali1', 'barista'),
      MK('ali2', 'barista'),
      MK('hb1', 'head_barista'),
      MK('cash1', 'cashier'),
      NOCLAIMS,
      Q('names', `with x as (update staff set display_name = 'CL Ali' where id in ({{ali1}}::uuid, {{ali2}}::uuid) returning 1)
                  select to_jsonb(count(*)) from x`),
      KEEP('today', `select ${TODAY}::text`),
      // hb1 and cash1 are on approved leave today.
      Q('leave', `with x as (insert into staff_requests (staff_id, kind, status, from_date, to_date, decided_by, decided_at)
                              values ({{hb1}}, 'leave', 'approved', {{today}}::date, {{today}}::date + 2, {{owner}}, now()),
                                     ({{cash1}}, 'leave', 'approved', {{today}}::date - 1, {{today}}::date, {{owner}}, now())
                              returning 1) select to_jsonb(count(*)) from x`),
      T('l_ali', 'owner', saveList(null, 0, spec(base({ name_en: 'Ali each', copy_mode: 'each' })))),
      T('l_hb', 'owner', saveList(null, 0, spec(base({ name_en: 'Each on leave', role: 'head_barista', copy_mode: 'each' })))),
      T('l_pl', 'owner', saveList(null, 0, spec(base({ name_en: 'People on leave', audience: 'people', role: undefined,
        copy_mode: 'each' }), { staff_ids: `jsonb_build_array({{cash1}})` }))),
      T('l_pp', 'owner', saveList(null, 0, spec(base({ name_en: 'People present', audience: 'people', role: undefined,
        copy_mode: 'each' }), { staff_ids: `jsonb_build_array({{cashier}})` }))),
      T('state_before', 'manager', `select app.checklist_day_state({{venue}})`),
      NOCLAIMS,
      mat('m', `{{today}}::date`),
      Q('ali_runs', `select jsonb_agg(jsonb_build_object('run', r.id, 'who', r.assignee_id) order by r.id)
                       from checklist_runs r join checklist_templates t on t.id = r.template_id
                      where t.name_en = 'Ali each'`),
      T('state_after', 'manager', `select app.checklist_day_state({{venue}})`),
    ]);
    const names = (label: string) => ok<{ lists: StateRow[] }>(r, label).lists.map((l) => l.name_en).sort();
    // Before the fix both on-leave lists showed as "0 done", overdue later in
    // the day, though nobody had a copy.
    expect(names('state_before')).toEqual(['Ali each', 'People present']);
    const before = ok<{ lists: StateRow[] }>(r, 'state_before').lists;
    expect(before.every((l) => l.run_id === null && l.assignee_id === null)).toBe(true);
    expect(ok<number>(r, 'm')).toBe(3);
    expect(names('state_after')).toEqual(['Ali each', 'Ali each', 'People present']);
    const ali = ok<{ lists: StateRow[] }>(r, 'state_after').lists.filter((l) => l.name_en === 'Ali each');
    expect(ali.map((l) => l.assignee_name)).toEqual(['CL Ali', 'CL Ali']);
    const runs = ok<Array<{ run: string; who: string }>>(r, 'ali_runs');
    expect(ali.map((l) => l.run_id).sort()).toEqual(runs.map((x) => x.run).sort());
    expect(new Set(ali.map((l) => l.assignee_id)).size).toBe(2);
    expect(ali.map((l) => l.assignee_id).sort()).toEqual(runs.map((x) => x.who).sort());
  });

  it('an old build edits the list the legacy save writes: the board leads each role and slot with the oldest list', () => {
    const r = scenario([
      T('old', 'owner', save('barista', 'open', 0, 'Opening checks', OPEN_ITEMS)),
      RES('lo', 'old', 'template_id'),
      NOCLAIMS,
      Q('age', `with x as (update checklist_templates set created_at = now() - interval '10 days'
                            where id = {{lo}}::uuid returning 1) select to_jsonb(count(*)) from x`),
      // A second barista list due at 10:00 (slot open), alphabetically first.
      T('new', 'owner', saveList(null, 0, spec(base({ name_en: 'Bar setup', slot: 'time', due_time: '10:00' })))),
      RES('ln', 'new', 'template_id'),
      T('board', 'owner', `select app.checklist_board({{venue}})`),
      // The old build opens the first barista/open list it reads and saves it.
      T('legacy', 'owner', save('barista', 'open', 1, 'Opening checks EDITED', OPEN_ITEMS.slice(0, 1))),
      Q('rows', `select jsonb_object_agg(id::text, jsonb_build_object('name', name_en, 'version', version))
                   from checklist_templates where id in ({{lo}}::uuid, {{ln}}::uuid)`),
    ]);
    const board = ok<SchedBoard>(r, 'board');
    const first = board.templates.find((t) => t.role === 'barista' && t.slot === 'open')!;
    const oldId = ok<{ template_id: string }>(r, 'old').template_id;
    const newId = ok<{ template_id: string }>(r, 'new').template_id;
    expect(first.template_id).toBe(oldId);
    expect(ok(r, 'legacy')).toEqual({ template_id: first.template_id, version: 2 });
    expect(ok(r, 'rows')).toEqual({
      [oldId]: { name: 'Opening checks EDITED', version: 2 },
      [newId]: { name: 'Bar setup', version: 1 },
    });
  });

  it('the sweep pushes a person’s copy only while they still work at the branch', () => {
    const r = scenario([
      MK('cash1', 'cashier'),
      MK('cash2', 'cashier'),
      T('people', 'owner', saveList(null, 0, spec(base({ name_en: 'Moved away', audience: 'people', role: undefined,
        copy_mode: 'each' }), { staff_ids: `jsonb_build_array({{cash1}}, {{cash2}})` }))),
      RES('lp', 'people', 'template_id'),
      NOCLAIMS,
      KEEP('today', `select ${TODAY}::text`),
      mat('m', `{{today}}::date`),
      Q('past', `with x as (update checklist_runs set due_at = now() - interval '1 minute'
                             where template_id = {{lp}}::uuid returning 1) select to_jsonb(count(*)) from x`),
      // cash2 is moved to another branch mid-occurrence.
      Q('moved', `with x as (delete from staff_venues where staff_id = {{cash2}}::uuid returning 1)
                  select to_jsonb(count(*)) from x`),
      Q('sweep', `select to_jsonb(app.checklist_sweep())`),
      Q('out', `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'key', o.payload->>'title_key')
                                          order by o.profile_id), '[]'::jsonb)
                  from notification_outbox o
                  join checklist_runs r on r.id::text = o.payload->>'id'
                 where o.payload->>'route' = 'staff-checklist' and r.template_id = {{lp}}::uuid`),
      Q('c1', `select to_jsonb({{cash1}}::text)`),
    ]);
    expect(ok<number>(r, 'm')).toBe(2);
    expect(ok<number>(r, 'moved')).toBeGreaterThan(0);
    // cash1 still works here and is pushed; cash2 left and is not.
    expect(ok<Array<{ to: string; key: string }>>(r, 'out')).toEqual([{ to: ok<string>(r, 'c1'), key: 'checklist_overdue' }]);
  });

  it('create_branch copies role lists with their schedule, not people or archived lists; the branch guard holds', () => {
    const slug = `cl-sched-${Math.random().toString(36).slice(2, 10)}`;
    const r = scenario([
      T('role_each', 'owner', saveList(null, 0, spec(base({ name_en: 'Copied', copy_mode: 'each', weekdays: [1, 3],
        slot: 'time', due_time: '10:15' })))),
      T('monthly', 'owner', saveList(null, 0, spec(base({ name_en: 'Copied monthly', role: 'cashier',
        repeat_kind: 'monthdays', month_days: [1, 15], slot: 'close' })))),
      T('people', 'owner', saveList(null, 0, spec(base({ name_en: 'People stay', audience: 'people', role: undefined,
        copy_mode: 'each' }), { staff_ids: `jsonb_build_array({{cashier}})` }))),
      RES('lp', 'people', 'template_id'),
      T('archived', 'owner', saveList(null, 0, spec(base({ name_en: 'Archived stays' })))),
      RES('la', 'archived', 'template_id'),
      T('arch', 'owner', archive('la', 1)),
      T('branch', 'owner', `select app.create_branch({{venue}}, '${slug}', 'CL Sched', 'فرع الجدولة')`),
      RES('nv', 'branch', 'venue_id'),
      Q('copied', `select jsonb_agg(jsonb_build_object('name', t.name_en, 'role', t.role, 'slot', t.slot,
                     'audience', t.audience, 'copy_mode', t.copy_mode, 'repeat_kind', t.repeat_kind,
                     'weekdays', t.weekdays, 'month_days', t.month_days, 'due_time', t.due_time,
                     'archived', t.archived_at is not null,
                     'lines', (select count(*) from checklist_template_items i where i.template_id = t.id))
                     order by t.name_en)
                     from checklist_templates t where t.venue_id = {{nv}}::uuid`),
      // zz_branch_guard: a person row names its list's branch.
      NOCLAIMS,
      TQ('guard_bad', `with x as (insert into checklist_assignees (template_id, staff_id, venue_id)
                                  values ({{lp}}::uuid, {{owner}}::uuid, {{nv}}::uuid) returning 1)
                                select to_jsonb(count(*)) from x`),
      TQ('guard_ok', `with x as (insert into checklist_assignees (template_id, staff_id, venue_id)
                                 values ({{lp}}::uuid, {{owner}}::uuid, {{venue}}::uuid) returning 1)
                               select to_jsonb(count(*)) from x`),
    ]);

    expect(ok<{ counts: Record<string, number> }>(r, 'branch').counts.checklist_templates).toBe(2);
    expect(ok(r, 'copied')).toEqual([
      { name: 'Copied', role: 'barista', slot: 'open', audience: 'role', copy_mode: 'each', repeat_kind: 'weekdays',
        weekdays: [1, 3], month_days: null, due_time: '10:15:00', archived: false, lines: 2 },
      { name: 'Copied monthly', role: 'cashier', slot: 'close', audience: 'role', copy_mode: 'shared',
        repeat_kind: 'monthdays', weekdays: [0, 1, 2, 3, 4, 5, 6], month_days: [1, 15], due_time: null,
        archived: false, lines: 2 },
    ]);
    expect(refused(r, 'guard_bad')).toBe('VENUE_MISMATCH');
    expect(ok<number>(r, 'guard_ok')).toBe(1);
  });
});
