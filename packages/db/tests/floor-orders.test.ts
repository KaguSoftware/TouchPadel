/**
 * floor orders (0251, owner 2026-09-28): the staff phone's "Place an order".
 *
 *   * floor_tables and floor_menu read to the waiter, the cashier and MGMT,
 *     and to nobody else (a barista, the driver, marketing, another branch);
 *     the tables come with their open tabs of the day and what is on them,
 *     never money; the menu lists active items only, marks the sold out, and
 *     carries sizes, options and the groups an option reveals;
 *   * place_floor_order opens a named tab on a table with the first items, the
 *     order going to the kitchen as the till's does (an order and its ticket);
 *     a retry under one key is one tab and one order; adding to that tab, and
 *     opening a second, empty tab on the same table, work; the till's checks
 *     come through (a required option, a sold-out item); a tab is never taken
 *     from another table, and an existing tab needs items.
 *
 * HOW. The order-slips.test.ts harness: every scenario is ONE psql
 * transaction that is rolled back; an open day is made inside it when the
 * branch has none. Without docker on PATH the suite skips itself.
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

const OTHER_VENUE = '00000000-0000-4000-8000-00000000c5c5';
const TABLE_NO = '8741';

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
  values (v, 'fo-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'FO ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

select pg_temp.mk('wtr', 'waiter');
select pg_temp.mk('drv', 'driver');
select pg_temp.mk('mkt', 'marketing');
select pg_temp.mk('bar', 'barista');

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
  values ('FO drinks', 'مشروبات', '${SEED_TAX_GROUP_STANDARD}', '${VENUE_A_ID}', 'cafe') returning id)
insert into vars select 'cat', id::text from c;
insert into menu_items (category_id, name_en, name_ar, venue_id)
select val::uuid, 'Zanzibar Flat White', 'فلات وايت زنجبار', '${VENUE_A_ID}' from vars where name = 'cat';
insert into vars select 'latte', id::text from menu_items where name_en = 'Zanzibar Flat White' and venue_id = '${VENUE_A_ID}';
insert into menu_items (category_id, name_en, name_ar, venue_id)
select val::uuid, 'Qarmat Chai', 'شاي قرمطي', '${VENUE_A_ID}' from vars where name = 'cat';
insert into vars select 'karak', id::text from menu_items where name_en = 'Qarmat Chai' and venue_id = '${VENUE_A_ID}';
insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default, sort_order)
select (select val::uuid from vars where name = 'latte'), 'Regular', 'عادي', 4000, true, 1
union all select (select val::uuid from vars where name = 'latte'), 'Large', 'كبير', 5000, false, 2
union all select (select val::uuid from vars where name = 'karak'), 'Regular', 'عادي', 2000, true, 1;
insert into vars select 'latte_r', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'latte') and is_default;
insert into vars select 'latte_l', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'latte') and not is_default;
insert into vars select 'karak_r', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'karak');
-- Karak needs one sugar choice (min_select 1).
insert into modifier_groups (name_en, name_ar, min_select, max_select, venue_id) values ('FO sugar', 'سكر', 1, 1, '${VENUE_A_ID}');
insert into vars select 'sugar_grp', id::text from modifier_groups where name_en = 'FO sugar';
insert into modifiers (group_id, name_en, name_ar) select val::uuid, 'No sugar', 'بدون سكر' from vars where name = 'sugar_grp';
insert into vars select 'no_sugar', id::text from modifiers where name_en = 'No sugar' and group_id = (select val::uuid from vars where name = 'sugar_grp');
insert into menu_item_modifier_groups (item_id, group_id) select (select val::uuid from vars where name = 'karak'), val::uuid from vars where name = 'sugar_grp';
insert into cafe_tables (table_number, venue_id) values ('T${TABLE_NO}', '${VENUE_A_ID}'), ('T${TABLE_NO}2', '${VENUE_A_ID}');
insert into vars select 'table', id::text from cafe_tables where table_number = 'T${TABLE_NO}';
insert into vars select 'table2', id::text from cafe_tables where table_number = 'T${TABLE_NO}2';
-- An iced option that reveals an ice group (depth 1), on the flat white.
insert into modifier_groups (name_en, name_ar, min_select, max_select, venue_id) values ('FO temp', 'حرارة', 0, 1, '${VENUE_A_ID}');
insert into vars select 'temp_grp', id::text from modifier_groups where name_en = 'FO temp';
insert into modifiers (group_id, name_en, name_ar, price_delta_iqd, sort_order) select val::uuid, 'Iced', 'مثلج', 500, 1 from vars where name = 'temp_grp';
insert into vars select 'iced', id::text from modifiers where name_en = 'Iced' and group_id = (select val::uuid from vars where name = 'temp_grp');
insert into modifier_groups (name_en, name_ar, min_select, max_select, venue_id) values ('FO ice', 'ثلج', 1, 1, '${VENUE_A_ID}');
insert into vars select 'ice_grp', id::text from modifier_groups where name_en = 'FO ice';
insert into modifiers (group_id, name_en, name_ar) select val::uuid, 'Light ice', 'ثلج خفيف' from vars where name = 'ice_grp';
insert into vars select 'light_ice', id::text from modifiers where name_en = 'Light ice' and group_id = (select val::uuid from vars where name = 'ice_grp');
insert into modifier_reveals (modifier_id, group_id) select (select val::uuid from vars where name = 'iced'), val::uuid from vars where name = 'ice_grp';
insert into menu_item_modifier_groups (item_id, group_id) select (select val::uuid from vars where name = 'latte'), val::uuid from vars where name = 'temp_grp';
-- A sold-out item and a retired one.
insert into menu_items (category_id, name_en, name_ar, venue_id, sold_out)
select val::uuid, 'FO Sold Out Scone', 'سكون', '${VENUE_A_ID}', true from vars where name = 'cat';
insert into menu_items (category_id, name_en, name_ar, venue_id, is_active)
select val::uuid, 'FO Retired Bun', 'كعكة', '${VENUE_A_ID}', false from vars where name = 'cat';

insert into venues (id, slug, name_en, name_ar, is_active)
values ('${OTHER_VENUE}', 'fo-other-venue', 'FO other', 'فرع آخر', false);
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
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
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

interface FloorLine {
  name_en: string;
  size_en: string | null;
  qty: number;
}
interface FloorTab {
  id: string;
  label: string | null;
  mine: boolean;
  lines: FloorLine[];
}
interface FloorTable {
  id: string;
  table_number: string;
  tabs: FloorTab[];
}
interface Group {
  id: string;
  min_select: number;
  max_select: number;
  modifiers: Array<{ id: string; name_en: string; price_delta_iqd: number; reveals: Group[] }>;
}
interface MenuItem {
  id: string;
  name_en: string;
  orderable: boolean;
  variants: Array<{ id: string; name_en: string; price_iqd: number; is_default: boolean }>;
  groups: Group[];
}

/** Keys that would carry money, at any depth. */
function moneyKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/_iqd$|^total|^subtotal|price|^cost/i.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

const place = (who: string, label: string, args: string) =>
  T(label, who, `select app.place_floor_order(${args})`);

describe.skipIf(!docker)('floor orders (rolled-back transactions)', () => {
  it('reads the floor and the menu to the floor roles only, with no money on a tab', () => {
    const r = scenario([
      ...(['wtr', 'cashier', 'manager', 'owner'] as const).flatMap((who) => [
        T(`tables_${who}`, who, `select app.floor_tables({{venue}})`),
        T(`menu_${who}`, who, `select app.floor_menu({{venue}})`),
      ]),
      ...(['bar', 'drv', 'mkt'] as const).flatMap((who) => [
        T(`tables_${who}`, who, `select app.floor_tables({{venue}})`),
        T(`menu_${who}`, who, `select app.floor_menu({{venue}})`),
      ]),
      T('tables_far', 'wtr', `select app.floor_tables('${OTHER_VENUE}')`),
      T('menu_far', 'wtr', `select app.floor_menu('${OTHER_VENUE}')`),
    ]);
    for (const who of ['wtr', 'cashier', 'manager', 'owner']) {
      const floor = ok<{ day_open: boolean; tables: FloorTable[] }>(r, `tables_${who}`);
      expect(floor.day_open, who).toBe(true);
      const mine = floor.tables.filter((t) => t.table_number.startsWith(`T${TABLE_NO}`));
      // In number order: 8741 before 87412.
      expect(mine.map((t) => t.table_number), who).toEqual([`T${TABLE_NO}`, `T${TABLE_NO}2`]);
      expect(mine.every((t) => t.tabs.length === 0), who).toBe(true);
      ok(r, `menu_${who}`);
    }
    for (const who of ['bar', 'drv', 'mkt']) {
      expect(refused(r, `tables_${who}`), who).toBe('FORBIDDEN');
      expect(refused(r, `menu_${who}`), who).toBe('FORBIDDEN');
    }
    expect(refused(r, 'tables_far')).toBe('FORBIDDEN');
    expect(refused(r, 'menu_far')).toBe('FORBIDDEN');

    const cats = ok<{ categories: Array<{ id: string; items: MenuItem[] }> }>(r, 'menu_wtr').categories;
    const items = cats.find((c) => c.items.some((i) => i.name_en === 'Zanzibar Flat White'))!.items;
    // Equal sort orders fall back to the name; the retired bun is not there.
    expect(items.map((i) => [i.name_en, i.orderable])).toEqual([
      ['FO Sold Out Scone', false], ['Qarmat Chai', true], ['Zanzibar Flat White', true],
    ]);
    const flat = items.find((i) => i.name_en === 'Zanzibar Flat White')!;
    expect(flat.variants.map((v) => [v.name_en, v.price_iqd, v.is_default])).toEqual([
      ['Regular', 4000, true], ['Large', 5000, false],
    ]);
    // The temperature group, whose Iced option reveals the ice group (depth 1).
    expect(flat.groups).toHaveLength(1);
    const iced = flat.groups[0]!.modifiers[0]!;
    expect([iced.name_en, iced.price_delta_iqd]).toEqual(['Iced', 500]);
    expect(iced.reveals.map((g) => [g.min_select, g.max_select, g.modifiers.map((m) => m.name_en)])).toEqual([
      [1, 1, ['Light ice']],
    ]);
    expect(iced.reveals[0]!.modifiers[0]!.reveals).toEqual([]);
    expect(items.find((i) => i.name_en === 'Qarmat Chai')!.groups[0]).toMatchObject({ min_select: 1, max_select: 1 });
  });

  it('opens a tab with the first order, adds to it, and keeps to the table', () => {
    const LATTE_ICED = `jsonb_build_array(jsonb_build_object('variant_id', {{latte_l}}, 'qty', 2,
                          'modifiers', jsonb_build_array(jsonb_build_object('modifier_id', {{iced}}),
                                                         jsonb_build_object('modifier_id', {{light_ice}}))))`;
    const r = scenario([
      place('wtr', 'open', `{{table}}, null, '  Ali  ', ${LATTE_ICED}, 'FO-KEY-1'`),
      place('wtr', 'open_again', `{{table}}, null, '  Ali  ', ${LATTE_ICED}, 'FO-KEY-1'`),
      RES('tab', 'open', 'tab_id'),
      RES('order1', 'open', 'order_id'),
      Q('tabs_on_table', `select to_jsonb(count(*)) from tabs where table_id = {{table}}::uuid and status = 'open'`),
      Q('tab_row', `select jsonb_build_object('label', label, 'kind', kind, 'by', opened_by_staff_id, 'device', device_id)
                      from tabs where id = {{tab}}::uuid`),
      Q('order_row', `select jsonb_build_object('source', o.source, 'by', o.placed_by_staff_id, 'status', o.status,
                                                'tickets', (select count(*) from tickets t where t.order_id = o.id),
                                                'lines', (select jsonb_agg(jsonb_build_object('qty', oi.qty, 'unit', oi.unit_price_iqd,
                                                                                             'total', oi.line_total_iqd))
                                                            from order_items oi where oi.order_id = o.id))
                        from orders o where o.id = {{order1}}::uuid`),
      // The cashier adds a chai with its sugar to the waiter's tab.
      place('cashier', 'add', `{{table}}, {{tab}}, null,
            jsonb_build_array(jsonb_build_object('variant_id', {{karak_r}}, 'modifiers',
                              jsonb_build_array(jsonb_build_object('modifier_id', {{no_sugar}}))))`),
      place('wtr', 'no_sugar', `{{table}}, {{tab}}, null, jsonb_build_array(jsonb_build_object('variant_id', {{karak_r}}))`),
      place('wtr', 'ice_unrevealed', `{{table}}, {{tab}}, null,
            jsonb_build_array(jsonb_build_object('variant_id', {{latte_r}}, 'modifiers',
                              jsonb_build_array(jsonb_build_object('modifier_id', {{light_ice}}))))`),
      KEEP('scone_v', `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                       select id, 'One', 'واحد', 3000, true from menu_items where name_en = 'FO Sold Out Scone'
                       returning id::text`),
      place('wtr', 'sold_out', `{{table}}, {{tab}}, null, jsonb_build_array(jsonb_build_object('variant_id', {{scone_v}}))`),
      place('wtr', 'empty_add', `{{table}}, {{tab}}, null, '[]'`),
      place('wtr', 'other_table', `{{table2}}, {{tab}}, null, jsonb_build_array(jsonb_build_object('variant_id', {{latte_r}}))`),
      // A second, empty tab on the same table, and a name that is too long.
      place('wtr', 'second', `{{table}}, null, null, '[]'`),
      place('wtr', 'long_label', `{{table}}, null, repeat('n', 41), '[]'`),
      place('wtr', 'bad_items', `{{table}}, null, null, '{}'`),
      place('wtr', 'no_table', `gen_random_uuid(), null, null, '[]'`),
      place('bar', 'barista', `{{table}}, null, null, '[]'`),
      place('drv', 'driver', `{{table}}, null, null, '[]'`),
      T('floor', 'wtr', `select app.floor_tables({{venue}})`),
      T('floor_cashier', 'cashier', `select app.floor_tables({{venue}})`),
      Q('audit', `select jsonb_agg(a.after->'opened' order by a.id) from audit_log a
                   where a.action = 'floor.order' and a.entity_id in
                         (select id::text from tabs where table_id = {{table}}::uuid)`),
    ]);

    const opened = ok<{ tab_id: string; opened: boolean; order_id: string; ticket_id: string }>(r, 'open');
    expect(opened.opened).toBe(true);
    expect(opened.ticket_id).toEqual(expect.any(String));
    expect(Object.keys(opened).sort()).toEqual(['opened', 'order_id', 'tab_id', 'ticket_id']);
    expect(ok(r, 'open_again')).toEqual({ ...opened, duplicate: true });
    expect(ok(r, 'tab_row')).toMatchObject({ label: 'Ali', kind: 'cafe', device: 'phone' });
    // The server prices it: large 5000 + iced 500, twice; one ticket for the kitchen.
    expect(ok(r, 'order_row')).toMatchObject({ source: 'till', status: 'sent', tickets: 1,
                                              lines: [{ qty: 2, unit: 5000, total: 11000 }] });

    expect(ok<{ opened: boolean; tab_id: string }>(r, 'add')).toMatchObject({ opened: false, tab_id: opened.tab_id });
    expect(refused(r, 'no_sugar').split(':')[0]).toBe('MODIFIER_SELECTION');
    expect(refused(r, 'ice_unrevealed').split(':')[0]).toBe('MODIFIER_INVALID');
    expect(refused(r, 'sold_out')).toBe('ITEM_UNAVAILABLE');
    expect(refused(r, 'empty_add')).toBe('EMPTY_ORDER');
    expect(refused(r, 'other_table')).toBe('INVALID_ARGUMENT:tab');
    const second = ok<{ opened: boolean; order_id: string | null; ticket_id: string | null }>(r, 'second');
    expect(second).toMatchObject({ opened: true, order_id: null, ticket_id: null });
    expect(refused(r, 'long_label')).toBe('TEXT_TOO_LONG:label');
    expect(refused(r, 'bad_items')).toBe('INVALID_ARGUMENT:items');
    expect(refused(r, 'no_table')).toBe('TABLE_NOT_FOUND');
    expect(refused(r, 'barista')).toBe('FORBIDDEN');
    expect(refused(r, 'driver')).toBe('FORBIDDEN');

    const table = ok<{ tables: FloorTable[] }>(r, 'floor').tables.find((t) => t.table_number === `T${TABLE_NO}`)!;
    // Both opened in this one transaction (the same opened_at), so by name.
    expect(table.tabs).toHaveLength(2);
    expect(table.tabs.map((t) => [t.label, t.mine])).toEqual(expect.arrayContaining([['Ali', true], [null, true]]));
    const ali = table.tabs.find((t) => t.label === 'Ali')!.lines.map((l) => [l.name_en, l.size_en, l.qty]);
    expect(ali).toHaveLength(2);
    expect(ali).toEqual(expect.arrayContaining([['Zanzibar Flat White', 'Large', 2], ['Qarmat Chai', null, 1]]));
    expect(moneyKeys(ok(r, 'floor'))).toEqual([]);
    const cashierView = ok<{ tables: FloorTable[] }>(r, 'floor_cashier').tables.find((t) => t.table_number === `T${TABLE_NO}`)!;
    expect(cashierView.tabs.map((t) => t.mine)).toEqual([false, false]);
    expect(ok(r, 'audit')).toEqual([true, false, true]);
  });
});
