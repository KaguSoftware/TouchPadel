/**
 * checklist_photos (build-contracts-2026-09-23 §2.24.8, §8.2): a checklist
 * line may need a photo when it is ticked.
 *
 *   * the owner marks a line "Needs a photo" (a boolean, or nothing); the
 *     board shows the flag and the day's photos;
 *   * the day's list copies the flag, so an owner's edit in the middle of the
 *     day leaves today's snapshot as it was;
 *   * a flagged tick without a photo is refused RECORD_INVALID (hint
 *     photo_path); with the caller's own checklists slot it passes; another
 *     person's slot, or another folder's, is PHOTO_PATH_INVALID; an untick
 *     clears the photo and the same slot may be sent again;
 *   * an old three-argument call still works on a line without the flag, in
 *     SQL and through PostgREST;
 *   * the photo reads to the list's role, MGMT and its uploader; the driver
 *     and marketing see no other role's photos (§8.2).
 *
 * HOW. Every database scenario is ONE psql transaction that is rolled back
 * (the protocols-engine-flow.test.ts harness): staff, lists, slots and storage
 * rows are created inside it and each call runs as `authenticated` with the
 * caller's JWT claims. The PostgREST case calls with an unknown line and
 * writes nothing. Without docker on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, signedInClient, appRpc, SEED_STAFF, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

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
  values (v, 'cp-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'CP ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A photo: a slot minted by p_who in p_folder, and its storage object.
create function pg_temp.photo(p_name text, p_who text, p_folder text) returns void language plpgsql as $f$
declare v_uid uuid; v_path text;
begin
  select val::uuid into v_uid from pg_temp.vars where name = p_who;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_path := app.staff_media_slot('${VENUE_A_ID}', p_folder, 'jpg')->>'path';
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('staff-media', v_path, v_uid, v_uid::text);
  insert into pg_temp.vars values (p_name, v_path);
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
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
/** Through the staff_media_read storage policy, as the reader. */
const SEES = (label: string, who: string, photo: string) =>
  T(label, who, `select to_jsonb(count(*) = 1) from storage.objects where bucket_id = 'staff-media' and name = {{${photo}}}`);

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

// Every scenario starts from no lists at all, whatever another session has
// committed on the shared stack: removed inside the transaction, so the
// rollback puts them back (as checklists.test.ts).
const CLEAN = `delete from checklist_run_items; delete from checklist_runs;
delete from checklist_template_items; delete from checklist_templates;`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const save = (role: string, version: number, items: Array<Record<string, unknown>>) =>
  `select app.save_checklist_template({{venue}}, '${role}', 'close', ${version}, 'Closing', 'الإغلاق',
     '${JSON.stringify(items)}'::jsonb)`;
const tick = (item: string, extra = '') => `select app.mark_checklist_item({{${item}}}, true${extra})`;
const LINES = [
  { text_en: 'Photo of the clean bar', text_ar: 'صورة البار نظيفًا', photo_required: true },
  { text_en: 'Lock the fridge', text_ar: 'اقفل الثلاجة' },
  { text_en: 'Bins out', text_ar: 'أخرج النفايات', photo_required: null },
];

interface Item {
  id: string;
  text_en: string;
  done_at: string | null;
  done_by_name: string | null;
  photo_required: boolean;
  photo_path: string | null;
}
type Today = { lists: Array<{ items: Item[] }> };

describe.skipIf(!docker)('checklist_photos (rolled-back transactions)', () => {
  it('a flagged line is ticked only with a photo of the caller’s own slot; an untick clears it', () => {
    const r = scenario([
      CLEAN,
      MK('bar1', 'barista'), MK('bar2', 'barista'), MK('drv', 'driver'), MK('mkt', 'marketing'),
      T('tpl', 'owner', save('barista', 0, LINES)),
      T('bad_flag', 'owner', save('barista', 1, [{ text_en: 'x', text_ar: 'س', photo_required: 'yes' }])),
      T('today', 'bar1', `select app.my_checklists_today({{venue}})`),
      RES('i_photo', 'today', 'lists,0,items,0,id'),
      RES('i_plain', 'today', 'lists,0,items,1,id'),
      PHOTO('p1', 'bar1', 'checklists'),
      PHOTO('p_steps', 'bar1', 'steps'),
      PHOTO('p_bar2', 'bar2', 'checklists'),
      T('no_photo', 'bar1', tick('i_photo')),
      T('blank_photo', 'bar1', tick('i_photo', `, null, '  '`)),
      T('wrong_folder', 'bar1', tick('i_photo', `, null, {{p_steps}}`)),
      T('foreign', 'bar1', tick('i_photo', `, null, {{p_bar2}}`)),
      T('with_photo', 'bar1', tick('i_photo', `, 'clean', {{p1}}`)),
      Q('claimed', `select to_jsonb(used_by) from staff_media_uploads where path = {{p1}}`),
      // Another holder of the role re-ticks: the first ticker and the photo stay.
      T('retick', 'bar2', tick('i_photo')),
      ...(['bar1', 'bar2', 'manager', 'owner', 'drv', 'mkt', 'cashier'] as const).map((who) =>
        SEES(`sees_${who}`, who, 'p1')),
      T('untick', 'bar1', `select app.mark_checklist_item({{i_photo}}, false, null, {{p1}})`),
      T('no_photo_again', 'bar1', tick('i_photo')),
      T('same_slot_again', 'bar1', tick('i_photo', `, null, {{p1}}`)),
      T('plain_tick', 'bar2', tick('i_plain')),
      T('plain_photo', 'bar2', tick('i_plain', `, null, {{p_bar2}}`)),
      T('drv_tick', 'drv', tick('i_plain', `, null, {{p_bar2}}`)),
      T('mkt_tick', 'mkt', tick('i_plain')),
      T('board', 'manager', `select app.checklist_board({{venue}})`),
      Q('db_chk', `select to_jsonb(count(*)) from pg_constraint
                    where conname = 'checklist_run_items_photo_chk' and convalidated
                      and conrelid = 'public.checklist_run_items'::regclass`),
    ]);
    ok(r, 'tpl');
    expect(refused(r, 'bad_flag')).toBe('INVALID_ARGUMENT:items');
    const items = ok<Today>(r, 'today').lists[0]!.items;
    expect(items.map((i) => [i.text_en, i.photo_required, i.photo_path])).toEqual([
      ['Photo of the clean bar', true, null], ['Lock the fridge', false, null], ['Bins out', false, null],
    ]);
    expect(refused(r, 'no_photo')).toBe('RECORD_INVALID:photo_path');
    expect(refused(r, 'blank_photo')).toBe('RECORD_INVALID:photo_path');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'foreign')).toBe('PHOTO_PATH_INVALID');
    const ticked = ok<Item & { note: string }>(r, 'with_photo');
    expect(ticked).toMatchObject({ done_by_name: 'CP bar1', note: 'clean', photo_required: true,
                                   photo_path: expect.stringMatching(/\/checklists\//) });
    expect(ok<string>(r, 'claimed')).toBe(`checklist_item:${items[0]!.id}`);
    expect(ok<Item>(r, 'retick')).toMatchObject({ done_by_name: 'CP bar1', photo_path: ticked.photo_path });
    for (const who of ['bar1', 'bar2', 'manager', 'owner']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(true);
    for (const who of ['drv', 'mkt', 'cashier']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);
    expect(ok<Item>(r, 'untick')).toMatchObject({ done_at: null, photo_path: null });
    expect(refused(r, 'no_photo_again')).toBe('RECORD_INVALID:photo_path');
    expect(ok<Item>(r, 'same_slot_again').photo_path).toBe(ticked.photo_path);
    expect(ok<Item>(r, 'plain_tick')).toMatchObject({ photo_required: false, photo_path: null });
    expect(ok<Item>(r, 'plain_photo').photo_path).toMatch(/\/checklists\//);
    expect(refused(r, 'drv_tick')).toBe('FORBIDDEN');
    expect(refused(r, 'mkt_tick')).toBe('FORBIDDEN');
    type Board = { templates: Array<{ role: string; items: Array<{ photo_required: boolean }>;
                                      today: { items: Array<{ photo_required: boolean; photo_path: string | null }> } }> };
    const bar = ok<Board>(r, 'board').templates.find((t) => t.role === 'barista')!;
    expect(bar.items.map((i) => i.photo_required)).toEqual([true, false, false]);
    expect(bar.today.items.map((i) => [i.photo_required, i.photo_path !== null])).toEqual([
      [true, true], [false, true], [false, false],
    ]);
    expect(ok<number>(r, 'db_chk')).toBe(1);
  });

  it('an owner edit in the middle of the day leaves today’s snapshot as it was', () => {
    const r = scenario([
      CLEAN,
      MK('bar1', 'barista'),
      T('tpl', 'owner', save('barista', 0, [LINES[1]!])),
      T('today', 'bar1', `select app.my_checklists_today({{venue}})`),
      RES('item', 'today', 'lists,0,items,0,id'),
      T('edit', 'owner', save('barista', 1, [{ ...LINES[1]!, photo_required: true }])),
      T('today_after', 'bar1', `select app.my_checklists_today({{venue}})`),
      T('tick', 'bar1', tick('item')),
      Q('shift', `with x as (update checklist_runs set business_date = business_date - 1
                   where venue_id = {{venue}} and role = 'barista' returning 1) select to_jsonb(count(*)) from x`),
      T('tomorrow', 'bar1', `select app.my_checklists_today({{venue}})`),
      RES('item2', 'tomorrow', 'lists,0,items,0,id'),
      T('tick_tomorrow', 'bar1', tick('item2')),
    ]);
    expect(ok<Today>(r, 'today_after').lists[0]!.items[0]!.photo_required).toBe(false);
    expect(ok<Item>(r, 'tick').done_at).not.toBeNull();
    expect(ok<Today>(r, 'tomorrow').lists[0]!.items[0]!.photo_required).toBe(true);
    expect(refused(r, 'tick_tomorrow')).toBe('RECORD_INVALID:photo_path');
  });

  it('an old three-argument call still resolves, by position and by name', () => {
    const r = scenario([
      CLEAN,
      MK('bar1', 'barista'),
      T('tpl', 'owner', save('barista', 0, [LINES[1]!])),
      T('today', 'bar1', `select app.my_checklists_today({{venue}})`),
      RES('item', 'today', 'lists,0,items,0,id'),
      T('positional', 'bar1', `select app.mark_checklist_item({{item}}, true, 'done')`),
      T('named', 'bar1', `select app.mark_checklist_item(p_item_id => {{item}}, p_done => false, p_note => '')`),
      Q('sigs', `select jsonb_agg(oid::regprocedure::text) from pg_proc where proname = 'mark_checklist_item'`),
    ]);
    expect(ok<Item & { note: string }>(r, 'positional')).toMatchObject({ note: 'done', photo_path: null });
    expect(ok<Item & { note: string | null }>(r, 'named')).toMatchObject({ done_at: null, note: null });
    expect(ok<string[]>(r, 'sigs')).toEqual(['app.mark_checklist_item(uuid,boolean,text,text)']);
  });
});

describe.skipIf(!up)('checklist_photos through PostgREST', () => {
  let cashier: SupabaseClient;
  beforeAll(async () => {
    cashier = await signedInClient(SEED_STAFF.cashier);
  });
  afterAll(async () => {
    await cashier?.auth.signOut();
  });

  it('resolves a three-named-argument call to the new function', async () => {
    const three = await appRpc(cashier, 'mark_checklist_item', {
      p_item_id: '00000000-0000-4000-8000-000000000000', p_done: true, p_note: null,
    });
    expect(three.error?.message).toBe('CHECKLIST_NOT_FOUND');
    const four = await appRpc(cashier, 'mark_checklist_item', {
      p_item_id: '00000000-0000-4000-8000-000000000000', p_done: true, p_note: null, p_photo_path: null,
    });
    expect(four.error?.message).toBe('CHECKLIST_NOT_FOUND');
  });
});
