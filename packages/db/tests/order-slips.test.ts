/**
 * order_slip (0238/0239, Phase 2 Milestone 4b): waiters' handwritten order
 * slips, read by a model, matched to the menu, sent to the kitchen from the
 * till.
 *
 *   * the waiter, the cashier and MGMT file a slip from their own unclaimed
 *     upload in the new slips folder; a retry files it once; the driver,
 *     marketing and another branch are refused; the cashier (and nobody else
 *     new) reads a slip's photo through staff_media_visible;
 *   * the reading functions are the service role's alone; a reading takes the
 *     slip (a second is SLIP_BUSY), stores the lines, finds the table by the
 *     digits of its number, and matches: the Arabic item name to its default
 *     variant, item + variant ("... كبير") to that variant, a shortened name by
 *     word similarity, a stranger to nothing;
 *   * the cashier's send is ONE order through app.till_add_items onto the
 *     table's only open tab (or a new one), with the kitchen ticket; a retry
 *     returns the first; a second send is SLIP_ALREADY_DONE; the wording is
 *     learned and the next slip matches it at confidence 1; a changed pick is
 *     manual; the till's own refusals (a required option missing) come through;
 *   * the waiter follows their own slips (my_order_slips), the driver their
 *     receipts (my_receipts); the till lists the branch's slips; reject works.
 *
 * HOW. The receipts.test.ts harness: every scenario is ONE psql transaction
 * that is rolled back; an open day is made inside it when the branch has none.
 * Without docker on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, SEED_TAX_GROUP_STANDARD, VENUE_A_ID } from './helpers';

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

const OTHER_VENUE = '00000000-0000-4000-8000-00000000c4c4';
const TABLE_NO = '8731';

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

create function pg_temp.svc(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  set local role service_role;
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

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'os-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'OS ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

select pg_temp.mk('wtr', 'waiter');
select pg_temp.mk('drv', 'driver');
select pg_temp.mk('mkt', 'marketing');

-- An open day at venue A (inside this transaction only).
do $d$
begin
  if not exists (select 1 from day_sessions where venue_id = '${VENUE_A_ID}' and status in ('open','closing')) then
    insert into day_sessions (business_date, opened_by, opening_float_iqd, venue_id)
    values (date '3000-01-01' + (random() * 300000)::int, '${SEED_STAFF_IDS.owner}', 0, '${VENUE_A_ID}');
  end if;
end $d$;

-- A menu of our own, with words nothing else on the menu uses.
with c as (
  insert into menu_categories (name_en, name_ar, tax_group_id, venue_id, kind)
  values ('OS drinks', 'مشروبات', '${SEED_TAX_GROUP_STANDARD}', '${VENUE_A_ID}', 'cafe') returning id)
insert into vars select 'cat', id::text from c;
insert into menu_items (category_id, name_en, name_ar, venue_id)
select val::uuid, 'Zanzibar Latte', 'لاتيه زنجبار', '${VENUE_A_ID}' from vars where name = 'cat';
insert into vars select 'latte', id::text from menu_items where name_en = 'Zanzibar Latte' and venue_id = '${VENUE_A_ID}';
insert into menu_items (category_id, name_en, name_ar, venue_id)
select val::uuid, 'Qarmat Karak', 'كرك قرمطي', '${VENUE_A_ID}' from vars where name = 'cat';
insert into vars select 'karak', id::text from menu_items where name_en = 'Qarmat Karak' and venue_id = '${VENUE_A_ID}';
insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default, sort_order)
select (select val::uuid from vars where name = 'latte'), 'Regular', 'عادي', 4000, true, 1
union all select (select val::uuid from vars where name = 'latte'), 'Large', 'كبير', 5000, false, 2
union all select (select val::uuid from vars where name = 'karak'), 'Regular', 'عادي', 2000, true, 1;
insert into vars select 'latte_r', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'latte') and is_default;
insert into vars select 'latte_l', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'latte') and not is_default;
insert into vars select 'karak_r', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'karak');
-- Karak needs one sugar choice (min_select 1).
insert into modifier_groups (name_en, name_ar, min_select, max_select, venue_id) values ('OS sugar', 'سكر', 1, 1, '${VENUE_A_ID}');
insert into vars select 'sugar_grp', id::text from modifier_groups where name_en = 'OS sugar';
insert into modifiers (group_id, name_en, name_ar) select val::uuid, 'No sugar', 'بدون سكر' from vars where name = 'sugar_grp';
insert into vars select 'no_sugar', id::text from modifiers where name_en = 'No sugar' and group_id = (select val::uuid from vars where name = 'sugar_grp');
insert into menu_item_modifier_groups (item_id, group_id) select (select val::uuid from vars where name = 'karak'), val::uuid from vars where name = 'sugar_grp';
insert into cafe_tables (table_number, venue_id) values ('T${TABLE_NO}', '${VENUE_A_ID}');
insert into vars select 'table', id::text from cafe_tables where table_number = 'T${TABLE_NO}';

insert into venues (id, slug, name_en, name_ar, is_active)
values ('${OTHER_VENUE}', 'os-other-venue', 'OS other', 'فرع آخر', false);
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

const T = (label: string, who: string, sql: string) => `select pg_temp.t('${label}', '${who}', $q$${sql}$q$);`;
const SVC = (label: string, sql: string) => `select pg_temp.svc('${label}', $q$${sql}$q$);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const SLOT = (name: string, who: string, folder = 'slips') => [
  T(`slot_${name}`, who, `select app.staff_media_slot({{venue}}, '${folder}', 'jpg')`),
  RES(name, `slot_${name}`, 'path'),
];
const VOID = (sql: string) => `select 'true'::jsonb from (select ${sql}) x`;
/** File a slip as `who`, take it for a reading and store `reading`. */
const READ_SLIP = (name: string, who: string, reading: object) => [
  ...SLOT(`p_${name}`, who),
  T(`create_${name}`, who, `select app.create_order_slip({{venue}}, {{p_${name}}})`),
  RES(name, `create_${name}`, 'id'),
  SVC(`begin_${name}`, `select app.slip_begin_reading({{${name}}})`),
  SVC(`store_${name}`, `select app.slip_store_reading({{${name}}}, '${JSON.stringify(reading)}', 'fake-receipt-reader')`),
];

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

interface SlipLine {
  id: string;
  line_no: number;
  text_read: string;
  qty_read: number | null;
  notes_read: string | null;
  variant_id: string | null;
  match_source: string;
  confidence: number | null;
  flags: string[];
}
interface Detail {
  status: string;
  table_id: string | null;
  table_number: string | null;
  table_number_read: string | null;
  lines: SlipLine[];
}

const SLIP = {
  table_number: TABLE_NO,
  lines: [
    { text: 'لاتيه زنجبار', qty: 2, notes: 'بدون سكر', flags: [] },
    { text: 'لاتيه زنجبار كبير', qty: 1, flags: [] },
    { text: 'قرمطي', flags: ['NO_QTY', 'UNCLEAR'] },
    { text: 'Xqwz vbnm', qty: 1, flags: [] },
    { text: '  ', qty: 1 },
  ],
};

describe.skipIf(!docker)('order slips (rolled-back transactions)', () => {
  it('the floor files slips; the uploader and the till read them; reading is the service role\'s', () => {
    const r = scenario([
      ...SLOT('p1', 'wtr'),
      T('create_wtr', 'wtr', `select app.create_order_slip({{venue}}, {{p1}}, 'OS-KEY-1')`),
      T('create_again', 'wtr', `select app.create_order_slip({{venue}}, {{p1}}, 'OS-KEY-1')`),
      RES('s1', 'create_wtr', 'id'),
      T('claimed_twice', 'cashier', `select app.create_order_slip({{venue}}, {{p1}})`),
      ...SLOT('rc', 'wtr', 'receipts'),
      T('wrong_folder', 'wtr', `select app.create_order_slip({{venue}}, {{rc}})`),
      ...SLOT('p2', 'cashier'),
      T('create_cashier', 'cashier', `select app.create_order_slip({{venue}}, {{p2}})`),
      T('create_drv', 'drv', `select app.create_order_slip({{venue}}, {{p2}})`),
      T('create_mkt', 'mkt', `select app.create_order_slip({{venue}}, {{p2}})`),
      T('other_branch', 'wtr', `select app.create_order_slip('${OTHER_VENUE}', {{p2}})`),

      T('photo_cashier', 'cashier', `select to_jsonb(app.staff_media_visible({{p1}}))`),
      T('photo_drv', 'drv', `select to_jsonb(app.staff_media_visible({{p1}}))`),
      T('photo_mkt', 'mkt', `select to_jsonb(app.staff_media_visible({{p1}}))`),

      T('detail_wtr', 'wtr', `select app.slip_detail({{s1}})`),
      T('detail_cashier', 'cashier', `select app.slip_detail({{s1}})`),
      T('detail_drv', 'drv', `select app.slip_detail({{s1}})`),
      T('till_cashier', 'cashier', `select app.slips_to_send({{venue}})`),
      T('till_wtr', 'wtr', `select app.slips_to_send({{venue}})`),
      T('mine', 'wtr', `select app.my_order_slips({{venue}})`),
      T('mine_drv', 'drv', `select app.my_order_slips({{venue}})`),

      T('begin_cashier', 'cashier', `select app.slip_begin_reading({{s1}})`),
      T('send_wtr', 'wtr', `select app.send_order_slip({{s1}}, '[]')`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'order_slip.create' and entity_id = {{s1}}`),
    ]);

    const id = ok<{ id: string }>(r, 'create_wtr').id;
    expect(ok<{ id: string; duplicate?: boolean }>(r, 'create_again')).toMatchObject({ id, duplicate: true });
    expect(refused(r, 'claimed_twice')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    ok(r, 'create_cashier');
    expect(refused(r, 'create_drv')).toBe('FORBIDDEN');
    expect(refused(r, 'create_mkt')).toBe('FORBIDDEN');
    expect(refused(r, 'other_branch')).toBe('FORBIDDEN');

    expect(ok<boolean>(r, 'photo_cashier')).toBe(true);
    expect(ok<boolean>(r, 'photo_drv')).toBe(false);
    expect(ok<boolean>(r, 'photo_mkt')).toBe(false);

    expect(ok<Detail>(r, 'detail_wtr')).toMatchObject({ status: 'uploaded', lines: [] });
    ok(r, 'detail_cashier');
    expect(refused(r, 'detail_drv')).toBe('SLIP_NOT_FOUND');
    const till = ok<{ slips: { id: string; uploaded_by_name: string }[] }>(r, 'till_cashier').slips;
    expect(till.find((s) => s.id === id)).toMatchObject({ uploaded_by_name: 'OS wtr' });
    expect(refused(r, 'till_wtr')).toBe('FORBIDDEN');
    expect(ok<{ slips: { id: string }[] }>(r, 'mine').slips.map((s) => s.id)).toEqual([id]);
    expect(ok<{ slips: unknown[] }>(r, 'mine_drv').slips).toEqual([]);

    expect(refused(r, 'begin_cashier')).toMatch(/^permission denied for function/);
    expect(refused(r, 'send_wtr')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'audit')).toBe(1);
  });

  it('a reading finds the table and matches the menu; the send is one till order; the wording is learned', () => {
    const r = scenario([
      ...READ_SLIP('s', 'wtr', SLIP),
      Q('ids', `select jsonb_object_agg(name, val) from pg_temp.vars where name in ('latte_r', 'latte_l', 'karak_r')`),
      T('detail', 'cashier', `select app.slip_detail({{s}})`),
      KEEP('l1', `select id::text from order_slip_lines where slip_id = {{s}}::uuid and line_no = 1`),
      KEEP('l2', `select id::text from order_slip_lines where slip_id = {{s}}::uuid and line_no = 2`),
      KEEP('l3', `select id::text from order_slip_lines where slip_id = {{s}}::uuid and line_no = 3`),

      // Karak's sugar is required: the till's own refusal comes through, nothing is sent.
      T('send_missing_option', 'cashier', `select app.send_order_slip({{s}}, jsonb_build_array(
          jsonb_build_object('line_id', {{l3}}, 'variant_id', {{karak_r}}, 'qty', 1)), null, {{table}})`),
      T('send_no_anchor', 'cashier', `select app.send_order_slip({{s}}, jsonb_build_array(
          jsonb_build_object('variant_id', {{latte_r}}, 'qty', 1)))`),
      T('send', 'cashier', `select app.send_order_slip({{s}}, jsonb_build_array(
          jsonb_build_object('line_id', {{l1}}, 'variant_id', {{latte_r}}, 'qty', 2, 'notes', 'بدون سكر'),
          jsonb_build_object('line_id', {{l2}}, 'variant_id', {{latte_r}}, 'qty', 1),
          jsonb_build_object('line_id', {{l3}}, 'variant_id', {{karak_r}}, 'qty', 1,
                             'modifiers', jsonb_build_array(jsonb_build_object('modifier_id', {{no_sugar}}, 'qty', 1)))),
        null, {{table}}, 'OS-SEND-1', 'TEST-DEVICE')`),
      T('send_retry', 'cashier', `select app.send_order_slip({{s}}, '[{"variant_id":"00000000-0000-4000-8000-000000000000"}]', null, {{table}}, 'OS-SEND-1')`),
      T('send_again', 'cashier', `select app.send_order_slip({{s}}, jsonb_build_array(
          jsonb_build_object('variant_id', {{latte_r}}, 'qty', 1)), null, {{table}})`),
      SVC('begin_done', `select app.slip_begin_reading({{s}})`),
      RES('order', 'send', 'order_id'),
      Q('order_row', `select jsonb_build_object('source', o.source,
                              'ticket', exists (select 1 from tickets k where k.order_id = o.id),
                              'lines', (select jsonb_agg(jsonb_build_object('qty', oi.qty, 'notes', oi.notes)
                                                         order by oi.qty desc)
                                          from order_items oi where oi.order_id = o.id))
                         from orders o where o.id = {{order}}::uuid`),
      Q('slip_row', `select jsonb_build_object('status', status, 'order_id', order_id, 'tab_id', tab_id)
                       from order_slips where id = {{s}}::uuid`),
      Q('line2', `select jsonb_build_object('src', match_source, 'conf', confidence) from order_slip_lines where id = {{l2}}::uuid`),

      // The next slip: the wording a cashier sent matches at confidence 1, and
      // it lands on the table's one open tab rather than a new one.
      ...READ_SLIP('s2', 'wtr', { lines: [{ text: 'لاتيه زنجبار كبير', qty: 1, flags: [] }] }),
      T('detail2', 'cashier', `select app.slip_detail({{s2}})`),
      T('send2', 'cashier', `select app.send_order_slip({{s2}}, jsonb_build_array(
          jsonb_build_object('variant_id', {{latte_l}}, 'qty', 1)), null, {{table}})`),
      Q('tabs_on_table', `select to_jsonb(count(*)) from tabs where table_id = {{table}}::uuid and status = 'open'`),
      Q('audit', `select jsonb_agg(action order by action) from audit_log
                   where entity = 'order_slips' and entity_id = {{s}} and at = now()`),
    ]);

    expect(ok<{ menu_names: string[] }>(r, 'begin_s').menu_names).toContain('Zanzibar Latte / لاتيه زنجبار');
    expect(ok<{ lines: number; matched: number }>(r, 'store_s')).toMatchObject({ lines: 4, matched: 3 });

    const d = ok<Detail>(r, 'detail');
    expect(d).toMatchObject({ status: 'read', table_number_read: TABLE_NO, table_number: `T${TABLE_NO}` });
    const [a, b, c, x] = d.lines;
    expect(a).toMatchObject({ qty_read: 2, notes_read: 'بدون سكر', match_source: 'trigram' });
    expect(b).toMatchObject({ qty_read: 1, match_source: 'trigram' });
    expect(c).toMatchObject({ qty_read: null, match_source: 'trigram', flags: ['NO_QTY', 'UNCLEAR'] });
    expect(x).toMatchObject({ match_source: 'none', variant_id: null });
    // The item's own name is its default size; item + size is that size; a
    // shortened name finds its item by word similarity.
    const ids = ok<Record<string, string>>(r, 'ids');
    expect([a!.variant_id, b!.variant_id, c!.variant_id]).toEqual([ids.latte_r, ids.latte_l, ids.karak_r]);

    expect(refused(r, 'send_missing_option')).toMatch(/^MODIFIER_SELECTION/);
    expect(refused(r, 'send_no_anchor')).toBe('TAB_ANCHOR_REQUIRED');
    const sent = ok<{ order_id: string; tab_id: string; ticket_id: string }>(r, 'send');
    expect(sent.ticket_id).toBeTruthy();
    expect(ok<{ order_id: string; duplicate?: boolean }>(r, 'send_retry')).toMatchObject({ order_id: sent.order_id, duplicate: true });
    expect(refused(r, 'send_again')).toBe('SLIP_ALREADY_DONE');
    expect(refused(r, 'begin_done')).toBe('SLIP_ALREADY_DONE');

    const order = ok<{ source: string; ticket: boolean; lines: { qty: number; notes: string | null }[] }>(r, 'order_row');
    expect(order).toMatchObject({ source: 'till', ticket: true });
    expect(order.lines).toHaveLength(3);
    expect(order.lines.map((l) => l.notes)).toContain('بدون سكر');
    expect(ok(r, 'slip_row')).toMatchObject({ status: 'sent', order_id: sent.order_id, tab_id: sent.tab_id });
    // Line 2 was read as the Large latte and sent as Regular: a manual pick.
    expect(ok(r, 'line2')).toEqual({ src: 'manual', conf: null });

    const d2 = ok<Detail>(r, 'detail2');
    expect(d2.lines[0]).toMatchObject({ match_source: 'alias', confidence: 1 });
    expect(ok<{ tab_id: string }>(r, 'send2').tab_id).toBe(sent.tab_id);
    expect(ok<number>(r, 'tabs_on_table')).toBe(1);
    expect(ok<string[]>(r, 'audit')).toEqual(['order_slip.create', 'order_slip.read', 'order_slip.send']);
  });

  it('no model: typed by hand; reject; the phone keeps its own logs', () => {
    const r = scenario([
      ...SLOT('p1', 'wtr'),
      T('create', 'wtr', `select app.create_order_slip({{venue}}, {{p1}})`),
      RES('s', 'create', 'id'),
      SVC('begin', `select app.slip_begin_reading({{s}})`),
      SVC('begin_busy', `select app.slip_begin_reading({{s}})`),
      SVC('gave_up', VOID(`app.slip_fail_reading({{s}}, 'READER_NOT_CONFIGURED', 'uploaded')`)),
      T('detail', 'cashier', `select app.slip_detail({{s}})`),
      T('reject_wtr', 'wtr', VOID(`app.reject_order_slip({{s}}, 'no')`)),
      T('reject_long', 'cashier', VOID(`app.reject_order_slip({{s}}, repeat('x', 201))`)),
      T('reject', 'cashier', VOID(`app.reject_order_slip({{s}}, '  Already rung up  ')`)),
      T('send_rejected', 'cashier', `select app.send_order_slip({{s}}, jsonb_build_array(
          jsonb_build_object('variant_id', {{latte_r}}, 'qty', 1)), null, {{table}})`),
      T('mine', 'wtr', `select app.my_order_slips({{venue}})`),

      ...SLOT('p2', 'wtr'),
      T('create2', 'wtr', `select app.create_order_slip({{venue}}, {{p2}})`),
      RES('s2', 'create2', 'id'),
      T('by_hand', 'cashier', `select app.send_order_slip({{s2}}, jsonb_build_array(
          jsonb_build_object('variant_id', {{latte_r}}, 'qty', 3)), null, {{table}})`),
      T('till', 'cashier', `select app.slips_to_send({{venue}})`),

      ...SLOT('rp', 'drv', 'receipts'),
      T('receipt', 'drv', `select app.create_receipt({{venue}}, {{rp}}, 'phone')`),
      T('my_receipts', 'drv', `select app.my_receipts({{venue}})`),
      T('my_receipts_wtr', 'wtr', `select app.my_receipts({{venue}})`),
    ]);

    ok(r, 'begin');
    expect(refused(r, 'begin_busy')).toBe('SLIP_BUSY');
    expect(ok<Detail & { error_code: string }>(r, 'detail'))
      .toMatchObject({ status: 'uploaded', error_code: 'READER_NOT_CONFIGURED', lines: [] });
    expect(refused(r, 'reject_wtr')).toBe('FORBIDDEN');
    expect(refused(r, 'reject_long')).toBe('TEXT_TOO_LONG:reason');
    ok(r, 'reject');
    expect(refused(r, 'send_rejected')).toBe('SLIP_ALREADY_DONE');
    expect(ok<{ slips: { status: string; rejected_reason: string }[] }>(r, 'mine').slips[0])
      .toMatchObject({ status: 'rejected', rejected_reason: 'Already rung up' });

    expect(ok<{ order_id: string }>(r, 'by_hand').order_id).toBeTruthy();
    const till = ok<{ slips: { id: string; status: string }[] }>(r, 'till').slips;
    const ids = [ok<{ id: string }>(r, 'create').id, ok<{ id: string }>(r, 'create2').id];
    expect(till.filter((x) => ids.includes(x.id)).map((x) => x.status).sort()).toEqual(['rejected', 'sent']);

    const receipts = ok<{ receipts: { id: string }[] }>(r, 'my_receipts').receipts;
    expect(receipts.map((x) => x.id)).toEqual([ok<{ id: string }>(r, 'receipt').id]);
    expect(ok<{ receipts: unknown[] }>(r, 'my_receipts_wtr').receipts).toEqual([]);
  });
});
