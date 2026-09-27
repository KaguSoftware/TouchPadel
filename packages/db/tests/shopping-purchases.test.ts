/**
 * shopping_purchases (build-contracts-2026-09-23 §2.15, §2.21, §8.2): the
 * shopping list, the driver's purchases and the manager receiving them.
 *
 *   * the head barista, the head chef and MGMT add to the list; it goes
 *     straight to the drivers (one shopping_new push per driver in 15
 *     minutes); the chef's line waits for the head chef's OK instead
 *     (shopping_head_approval, tests/shopping-head-approval.test.ts); the bar
 *     and kitchen family, the driver and MGMT read it, with no price; the
 *     requester or MGMT takes a line off;
 *   * the driver records a purchase with a receipt photo: the list's lines
 *     become bought, the managers get purchase_to_receive, no stock moves and
 *     no till row is written; a retry with the same key records it once;
 *   * the manager receives it in one call (§8.2): a retry with the same key
 *     books the stock once, a second key is PURCHASE_ALREADY_RECEIVED, a
 *     receive that leaves out a stock line or names a non-stock one is
 *     refused; cost per base unit = price ÷ quantity; non-stock lines are
 *     acknowledged and the purchase is then done;
 *   * a stock line whose ingredient was switched off after the purchase is
 *     flagged to Goods in and stops the receive until it is acknowledged;
 *     then the rest is received and the purchase still ends done;
 *   * the driver reads their own purchases and prices only, marketing reads
 *     nothing, and no list read carries a price (§8.2 denials).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, ingredients and suppliers are
 * created inside it and each call runs as `authenticated` with the caller's
 * JWT claims. Nothing is committed: no list line, purchase, delivery, batch or
 * ledger row stays on the shared stack. Without docker on PATH the suite
 * skips itself.
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
  values (v, 'sp-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SP ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- An ingredient of the venue (or another), created as postgres.
create function pg_temp.ing(p_name text, p_unit stock_unit, p_active boolean, p_venue uuid) returns void
language plpgsql as $f$
declare v uuid;
begin
  insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id, pack_size, pack_cost_iqd)
  values ('purchased', 'SP ' || p_name, 'مادة ' || p_name, p_unit, p_active, p_venue, 1000, 12000)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A venue nobody here works at (inactive, so nothing else resolves to it).
insert into venues (id, slug, name_en, name_ar, is_active)
values ('00000000-0000-4000-8000-00000000c2c2', 'sp-other-venue', 'SP other', 'مكان آخر', false);
insert into vars values ('other_venue', '00000000-0000-4000-8000-00000000c2c2');
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
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const OTHER_VENUE = '00000000-0000-4000-8000-00000000c2c2';
const ING = (name: string, unit: 'g' | 'ml' | 'pc', active = true, venue = VENUE_A_ID) =>
  `select pg_temp.ing('${name}', '${unit}', ${active}, '${venue}');`;

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

/** Keys that would carry money or cost, at any depth. */
function moneyKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/_iqd$|^cost|price|margin/i.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

/** This transaction's pushes (created_at = now()) of one title to the named staff. */
const PUSHES = (label: string, titleKey: string, whos: string[]) =>
  Q(label, `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                                      order by o.id), '[]')
              from notification_outbox o
             where o.created_at = now()
               and o.payload->>'title_key' = '${titleKey}'
               and o.profile_id in (${whos.map((w) => `{{${w}}}::uuid`).join(', ')})`);

const add = (ingredient: string, label: string, qty: string, unit: string, extra = '') =>
  `select app.add_shopping_item({{venue}}, ${ingredient}, ${label}, ${qty}, '${unit}'${extra})`;

interface ListItem {
  id: string;
  ingredient_id: string | null;
  name_en: string | null;
  label: string | null;
  qty: number;
  unit: string;
  note: string | null;
  requested_by_name: string;
  status: string;
  mine: boolean;
}
interface Push {
  to: string;
  kind: string;
  payload: Record<string, unknown>;
}

describe.skipIf(!docker)('shopping list and purchases (rolled-back transactions)', () => {
  it('the heads and MGMT add, straight to the drivers; the list carries no price; the requester or MGMT cancels', () => {
    const r = scenario([
      MK('hc', 'head_chef'), MK('hb', 'head_barista'), MK('bar', 'barista'), MK('chef', 'chef'),
      MK('drv', 'driver'), MK('drv2', 'driver'), MK('mkt', 'marketing'),
      ING('flour', 'g'), ING('milk', 'ml'), ING('retired', 'g', false), ING('elsewhere', 'g', true, OTHER_VENUE),

      T('add_flour', 'hc', add('{{flour}}', 'null', '5000', 'g', `, '  the fine one  '`)),
      T('add_soap', 'hb', add('null', `'  Dish soap  '`, '2', 'pc')),
      T('add_milk_packs', 'manager', add('{{milk}}', 'null', '3', 'pack')),
      PUSHES('pushes', 'shopping_new', ['drv', 'drv2', 'hc', 'hb']),
      T('replay1', 'hc', add('{{flour}}', 'null', '1', 'g', `, null, 'SP-KEY-ADD'`)),
      T('replay2', 'hc', add('{{flour}}', 'null', '1', 'g', `, null, 'SP-KEY-ADD'`)),
      Q('replay_rows', `select count(*)::text::jsonb from shopping_items
                         where requested_by = {{hc}}::uuid and qty = 1 and ingredient_id = {{flour}}::uuid`),

      ...(['bar', 'drv', 'mkt', 'cashier', 'desk', 'prep'] as const).map((who) =>
        T(`add_${who}`, who, add('null', `'Ice'`, '1', 'pc'))),
      // The chef's line waits for the head chef (shopping_head_approval).
      T('add_chef', 'chef', add('null', `'Ice'`, '1', 'pc')),
      RES('chef_line', 'add_chef', 'id'),
      Q('chef_line_status', `select to_jsonb(status) from shopping_items where id = {{chef_line}}::uuid`),
      T('no_what', 'hc', add('null', `'   '`, '1', 'pc')),
      T('retired', 'hc', add('{{retired}}', 'null', '1', 'g')),
      T('elsewhere', 'hc', add('{{elsewhere}}', 'null', '1', 'g')),
      T('qty_zero', 'hc', add('null', `'Ice'`, '0', 'pc')),
      T('qty_tiny', 'hc', add('null', `'Ice'`, '0.0001', 'pc')),
      T('qty_huge', 'hc', add('null', `'Ice'`, '1000000000', 'pc')),
      T('unit_kg', 'hc', add('null', `'Ice'`, '1', 'kg')),
      T('unit_mismatch', 'hc', add('{{flour}}', 'null', '1', 'ml')),
      T('label_long', 'hc', add('null', `repeat('x', 81)`, '1', 'pc')),
      T('note_long', 'hc', add('null', `'Ice'`, '1', 'pc', `, repeat('n', 201)`)),
      T('other_venue', 'hc', `select app.add_shopping_item({{other_venue}}, null, 'Ice', 1, 'pc')`),

      ...(['bar', 'chef', 'drv', 'hc', 'manager', 'owner'] as const).map((who) =>
        T(`list_${who}`, who, `select app.shopping_list({{venue}})`)),
      ...(['mkt', 'cashier', 'desk', 'prep'] as const).map((who) =>
        T(`list_${who}`, who, `select app.shopping_list({{venue}})`)),
      T('list_bad_status', 'drv', `select app.shopping_list({{venue}}, 'lost')`),

      RES('soap', 'add_soap', 'id'),
      RES('flour_item', 'add_flour', 'id'),
      T('cancel_other', 'bar', `select 'true'::jsonb from (select app.cancel_shopping_item({{soap}})) x`),
      T('cancel_drv', 'drv', `select 'true'::jsonb from (select app.cancel_shopping_item({{soap}})) x`),
      T('cancel_own', 'hb', `select 'true'::jsonb from (select app.cancel_shopping_item({{soap}})) x`),
      T('cancel_again', 'hb', `select 'true'::jsonb from (select app.cancel_shopping_item({{soap}})) x`),
      T('cancel_mgr', 'manager', `select 'true'::jsonb from (select app.cancel_shopping_item({{flour_item}})) x`),
      T('cancel_missing', 'hc',
        `select 'true'::jsonb from (select app.cancel_shopping_item('00000000-0000-4000-8000-000000000000')) x`),
      T('list_cancelled', 'hc', `select app.shopping_list({{venue}}, 'cancelled')`),
      Q('audit', `select jsonb_agg(a.action order by a.action) from audit_log a
                   where a.entity = 'shopping_item' and a.at = now()
                     and a.entity_id in ({{soap}}, {{flour_item}})`),
    ]);

    expect(ok<{ id: string }>(r, 'add_flour').id).toMatch(/^[0-9a-f-]{36}$/);
    ok(r, 'add_soap');
    ok(r, 'add_milk_packs');
    // Straight to the drivers: one push each however many lines went on.
    const pushes = ok<Push[]>(r, 'pushes');
    expect(pushes).toHaveLength(2);
    for (const p of pushes) {
      expect(p.kind).toBe('staff_task');
      expect(p.payload).toEqual({ route: 'staff-shopping', title_key: 'shopping_new', params: {},
                                  dedupe: `shopping:${VENUE_A_ID}` });
    }
    // A retried add under one key is one line.
    expect(ok<{ id: string }>(r, 'replay2').id).toBe(ok<{ id: string }>(r, 'replay1').id);
    expect(ok<{ duplicate?: boolean }>(r, 'replay2').duplicate).toBe(true);
    expect(ok<number>(r, 'replay_rows')).toBe(1);

    for (const who of ['bar', 'drv', 'mkt', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `add_${who}`), who).toBe('FORBIDDEN');
    }
    expect(ok<string>(r, 'chef_line_status')).toBe('pending');
    expect(refused(r, 'no_what')).toBe('SHOPPING_LABEL_REQUIRED');
    expect(refused(r, 'retired')).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'elsewhere')).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'qty_zero')).toBe('INVALID_QTY');
    expect(refused(r, 'qty_tiny')).toBe('INVALID_QTY');
    expect(refused(r, 'qty_huge')).toBe('INVALID_QTY');
    expect(refused(r, 'unit_kg')).toBe('INVALID_ARGUMENT:unit');
    expect(refused(r, 'unit_mismatch')).toBe('INVALID_ARGUMENT:unit');
    expect(refused(r, 'label_long')).toBe('TEXT_TOO_LONG:label');
    expect(refused(r, 'note_long')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'other_venue')).toBe('FORBIDDEN');

    for (const who of ['bar', 'chef', 'drv', 'hc', 'manager', 'owner']) {
      const list = ok<{ items: ListItem[]; open_count: number }>(r, `list_${who}`);
      expect(moneyKeys(list), who).toEqual([]);
      const flour = list.items.find((i) => i.id === ok<{ id: string }>(r, 'add_flour').id)!;
      expect(flour).toMatchObject({ name_en: 'SP flour', label: null, qty: 5000, unit: 'g', note: 'the fine one',
                                    requested_by_name: 'SP hc', status: 'open', mine: who === 'hc' });
      const soap = list.items.find((i) => i.id === ok<{ id: string }>(r, 'add_soap').id)!;
      expect(soap).toMatchObject({ ingredient_id: null, name_en: null, label: 'Dish soap', qty: 2, unit: 'pc' });
      expect(list.open_count).toBeGreaterThanOrEqual(4);
    }
    for (const who of ['mkt', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `list_${who}`), who).toBe('FORBIDDEN');
    }
    expect(refused(r, 'list_bad_status')).toBe('INVALID_ARGUMENT:status');

    expect(refused(r, 'cancel_other')).toBe('FORBIDDEN');
    expect(refused(r, 'cancel_drv')).toBe('FORBIDDEN');
    ok(r, 'cancel_own');
    expect(refused(r, 'cancel_again')).toBe('SHOPPING_ITEM_NOT_OPEN');
    ok(r, 'cancel_mgr');
    expect(refused(r, 'cancel_missing')).toBe('SHOPPING_ITEM_NOT_OPEN');
    const cancelled = ok<{ items: ListItem[] }>(r, 'list_cancelled').items
      .filter((i) => [ok<{ id: string }>(r, 'add_soap').id, ok<{ id: string }>(r, 'add_flour').id].includes(i.id));
    expect(cancelled.map((i) => i.status)).toEqual(['cancelled', 'cancelled']);
    expect(ok<string[]>(r, 'audit')).toEqual(['shopping.add', 'shopping.add', 'shopping.cancel', 'shopping.cancel']);
  });

  it('the driver records a purchase; the manager receives it in one call and acknowledges what is not stock', () => {
    // The driver's four lines: three from the list (flour and sugar in grams,
    // the base unit; the soap is not stock) and one bought on the spot.
    const LINES = `jsonb_build_array(
      jsonb_build_object('shopping_item_id', {{flour_item}}, 'qty', 5000, 'price_iqd', 60000),
      jsonb_build_object('shopping_item_id', {{sugar_item}}, 'qty', 2000, 'price_iqd', 5000),
      jsonb_build_object('shopping_item_id', {{soap_item}}, 'qty', 2, 'price_iqd', 3000),
      jsonb_build_object('label', 'Ice bags', 'qty', 1, 'price_iqd', 1000))`;
    const r = scenario([
      MK('hc', 'head_chef'), MK('drv', 'driver'), MK('drv2', 'driver'), MK('mkt', 'marketing'),
      ING('flour', 'g'), ING('sugar', 'g'),
      KEEP('supplier', `insert into suppliers (venue_id, name) values ({{venue}}, 'SP Mill') returning id::text`),
      KEEP('far_supplier', `insert into suppliers (venue_id, name) values ({{other_venue}}, 'SP Far') returning id::text`),
      T('a1', 'hc', add('{{flour}}', 'null', '5000', 'g')),
      T('a2', 'hc', add('{{sugar}}', 'null', '2', 'pack')),
      T('a3', 'hc', add('null', `'Dish soap'`, '2', 'pc')),
      RES('flour_item', 'a1', 'id'), RES('sugar_item', 'a2', 'id'), RES('soap_item', 'a3', 'id'),
      T('slot', 'drv', `select app.staff_media_slot({{venue}}, 'receipts', 'jpg')`),
      T('slot_steps', 'drv', `select app.staff_media_slot({{venue}}, 'steps', 'jpg')`),
      T('slot_hc', 'hc', `select app.staff_media_slot({{venue}}, 'receipts', 'jpg')`),
      RES('receipt', 'slot', 'path'), RES('receipt_steps', 'slot_steps', 'path'), RES('receipt_hc', 'slot_hc', 'path'),
      Q('moves_before', `select count(*)::text::jsonb from stock_movements where ingredient_id in ({{flour}}, {{sugar}})`),

      // Refusals first: none of them leaves a purchase or a bought line.
      T('rec_empty', 'drv', `select app.record_purchase({{venue}}, '[]'::jsonb, 0, null, null)`),
      T('rec_qty', 'drv', `select app.record_purchase({{venue}}, '[{"label":"x","qty":-1,"price_iqd":1}]'::jsonb, 1, null, null)`),
      T('rec_price', 'drv', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1.5}]'::jsonb, 1, null, null)`),
      T('rec_total', 'drv', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1}]'::jsonb, -1, null, null)`),
      T('rec_nothing', 'drv', `select app.record_purchase({{venue}}, '[{"qty":1,"price_iqd":1}]'::jsonb, 1, null, null)`),
      T('rec_future', 'drv', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1}]'::jsonb, 1, null, null,
                                now() + interval '1 day')`),
      T('rec_shop', 'drv', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1}]'::jsonb, 1,
                              repeat('s', 81), null)`),
      T('rec_foreign_receipt', 'drv', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1}]'::jsonb, 1,
                                         null, {{receipt_hc}})`),
      T('rec_wrong_folder', 'drv', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1}]'::jsonb, 1,
                                      null, {{receipt_steps}})`),
      T('rec_hc', 'hc', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1}]'::jsonb, 1, null, null)`),
      T('rec_mkt', 'mkt', `select app.record_purchase({{venue}}, '[{"label":"x","qty":1,"price_iqd":1}]'::jsonb, 1, null, null)`),

      T('rec', 'drv', `select app.record_purchase({{venue}}, ${LINES}, 69000, '  Al-Rasheed market ', {{receipt}},
                         now() - interval '1 hour', 'SP-KEY-BUY')`),
      T('rec_replay', 'drv', `select app.record_purchase({{venue}}, ${LINES}, 69000, 'Al-Rasheed market', {{receipt}},
                                now() - interval '1 hour', 'SP-KEY-BUY')`),
      T('rec_twice', 'drv', `select app.record_purchase({{venue}}, ${LINES}, 69000, null, null)`),
      RES('purchase', 'rec', 'purchase_id'),
      Q('items_after_buy', `select jsonb_object_agg(s.label_or, s.status) from (
                              select coalesce(i.name_en, si.label) as label_or, si.status || ':' ||
                                     (si.purchase_id = {{purchase}}::uuid)::text as status
                                from shopping_items si left join ingredients i on i.id = si.ingredient_id
                               where si.id in ({{flour_item}}, {{sugar_item}}, {{soap_item}})) s`),
      Q('purchases_by_drv', `select count(*)::text::jsonb from purchases where staff_id = {{drv}}::uuid`),
      Q('slot_used', `select to_jsonb(used_by) from staff_media_uploads where path = {{receipt}}`),
      Q('moves_after_buy', `select count(*)::text::jsonb from stock_movements where ingredient_id in ({{flour}}, {{sugar}})`),
      PUSHES('buy_pushes', 'purchase_to_receive', ['manager', 'drv', 'hc']),

      // What each role reads.
      T('mine_drv', 'drv', `select app.my_purchases({{venue}})`),
      T('mine_drv2', 'drv2', `select app.my_purchases({{venue}})`),
      T('mine_mgr', 'manager', `select app.my_purchases({{venue}}, 500)`),
      T('mine_hc', 'hc', `select app.my_purchases({{venue}})`),
      T('mine_mkt', 'mkt', `select app.my_purchases({{venue}})`),
      ...(['drv', 'drv2', 'mkt', 'hc', 'manager'] as const).flatMap((who) =>
        ['shopping_items', 'purchases', 'purchase_lines'].map((tbl) =>
          T(`read_${who}_${tbl}`, who, `select count(*)::text::jsonb from ${tbl}`))),
      T('to_receive', 'manager', `select app.purchases_to_receive({{venue}})`),
      T('to_receive_drv', 'drv', `select app.purchases_to_receive({{venue}})`),
      T('to_receive_hc', 'hc', `select app.purchases_to_receive({{venue}})`),

      // Receiving.
      KEEP('l_flour', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid and ingredient_id = {{flour}}::uuid`),
      KEEP('l_sugar', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid and ingredient_id = {{sugar}}::uuid`),
      KEEP('l_soap', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid and label = 'Dish soap'`),
      KEEP('l_ice', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid and label = 'Ice bags'`),
      T('recv_short_list', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000)))`),
      T('recv_nonstock', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000),
         jsonb_build_object('purchase_line_id', {{l_sugar}}, 'qty_received', 2000),
         jsonb_build_object('purchase_line_id', {{l_soap}}, 'qty_received', 2)))`),
      T('recv_repeat', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000),
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000)))`),
      T('recv_negative', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', -1),
         jsonb_build_object('purchase_line_id', {{l_sugar}}, 'qty_received', 2000)))`),
      T('recv_far_supplier', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000),
         jsonb_build_object('purchase_line_id', {{l_sugar}}, 'qty_received', 2000)), {{far_supplier}})`),
      T('recv_drv', 'drv', `select app.receive_purchase({{purchase}}, '[]'::jsonb)`),
      T('recv_missing', 'manager', `select app.receive_purchase('00000000-0000-4000-8000-000000000000', '[]'::jsonb)`),
      T('ack_stock', 'manager', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_flour}})) x`),
      Q('line_ids', `select jsonb_agg(x order by x) from unnest(array[{{l_flour}}, {{l_sugar}}]) x`),
      T('recv', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000, 'expiry_date', '2026-12-31'),
         jsonb_build_object('purchase_line_id', {{l_sugar}}, 'qty_received', 1500)), {{supplier}}, null, 'SP-KEY-RECV')`),
      T('recv_replay', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000, 'expiry_date', '2026-12-31'),
         jsonb_build_object('purchase_line_id', {{l_sugar}}, 'qty_received', 1500)), {{supplier}}, null, 'SP-KEY-RECV')`),
      T('recv_second_key', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000),
         jsonb_build_object('purchase_line_id', {{l_sugar}}, 'qty_received', 1500)), null, null, 'SP-KEY-RECV-2')`),
      Q('booked', `select jsonb_agg(jsonb_build_object('ing', m.ingredient_id, 'type', m.movement_type, 'qty', m.qty_delta,
                                                      'unit_cost', m.unit_cost_iqd, 'venue', m.venue_id) order by m.qty_delta desc)
                     from stock_movements m where m.ingredient_id in ({{flour}}, {{sugar}})`),
      Q('batches', `select jsonb_agg(jsonb_build_object('qty', b.qty_remaining, 'expiry', b.expiry_date, 'venue', b.venue_id)
                                     order by b.qty_remaining desc)
                      from stock_batches b where b.ingredient_id in ({{flour}}, {{sugar}})`),
      Q('delivery', `select jsonb_build_object('supplier_id', d.supplier_id, 'supplier_name', d.supplier_name,
                                               'venue', d.venue_id, 'received_by', d.received_by,
                                               'lines', (select jsonb_agg(jsonb_build_object('expected', dl.qty_expected,
                                                          'received', dl.qty_received) order by dl.qty_expected desc)
                                                           from delivery_lines dl where dl.delivery_id = d.id))
                       from deliveries d join purchases p on p.delivery_id = d.id where p.id = {{purchase}}::uuid`),
      Q('after_recv', `select jsonb_build_object('status', p.status, 'received_by', p.received_by,
                          'lines', (select jsonb_object_agg(coalesce(i.name_en, pl.label), pl.status)
                                      from purchase_lines pl left join ingredients i on i.id = pl.ingredient_id
                                     where pl.purchase_id = p.id),
                          'items', (select jsonb_object_agg(coalesce(i.name_en, si.label), si.status)
                                      from shopping_items si left join ingredients i on i.id = si.ingredient_id
                                     where si.purchase_id = p.id))
                         from purchases p where p.id = {{purchase}}::uuid`),
      T('ack_soap', 'manager', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_soap}})) x`),
      T('ack_soap_again', 'manager', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_soap}})) x`),
      T('ack_drv', 'drv', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_ice}})) x`),
      T('ack_ice', 'owner', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_ice}})) x`),
      Q('done', `select jsonb_build_object('status', p.status, 'received_by', p.received_by,
                   'soap_item', (select status from shopping_items where id = {{soap_item}}::uuid))
                   from purchases p where p.id = {{purchase}}::uuid`),
      T('to_receive_after', 'manager', `select app.purchases_to_receive({{venue}})`),
      Q('audit', `select jsonb_agg(a.action order by a.action) from audit_log a
                   where a.entity = 'purchase' and a.entity_id = {{purchase}}`),
      Q('till', `select jsonb_build_object('payments', (select count(*) from payments where created_at = now()),
                                           'tabs', (select count(*) from tabs where opened_at = now()))`),
    ]);

    // Refusals.
    expect(refused(r, 'rec_empty')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'rec_qty')).toBe('INVALID_QTY');
    expect(refused(r, 'rec_price')).toBe('INVALID_AMOUNT:price_iqd');
    expect(refused(r, 'rec_total')).toBe('INVALID_AMOUNT:total_iqd');
    expect(refused(r, 'rec_nothing')).toBe('SHOPPING_LABEL_REQUIRED');
    expect(refused(r, 'rec_future')).toBe('INVALID_ARGUMENT:bought_at');
    expect(refused(r, 'rec_shop')).toBe('TEXT_TOO_LONG:shop');
    expect(refused(r, 'rec_foreign_receipt')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'rec_wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'rec_hc')).toBe('FORBIDDEN');
    expect(refused(r, 'rec_mkt')).toBe('FORBIDDEN');

    // Recorded once; the list's lines are bought; no stock moved yet.
    const purchase = ok<{ purchase_id: string }>(r, 'rec').purchase_id;
    expect(ok<{ purchase_id: string; duplicate: boolean }>(r, 'rec_replay'))
      .toEqual({ purchase_id: purchase, duplicate: true });
    expect(refused(r, 'rec_twice')).toBe('SHOPPING_ITEM_NOT_OPEN');
    expect(ok<number>(r, 'purchases_by_drv')).toBe(1);
    expect(ok<Record<string, string>>(r, 'items_after_buy')).toEqual({
      'SP flour': 'bought:true', 'SP sugar': 'bought:true', 'Dish soap': 'bought:true',
    });
    expect(ok<string>(r, 'slot_used')).toBe(`purchase:${purchase}`);
    expect(ok<number>(r, 'moves_after_buy')).toBe(ok<number>(r, 'moves_before'));
    const buyPushes = ok<Push[]>(r, 'buy_pushes');
    expect(buyPushes).toEqual([{ to: SEED_STAFF_IDS.manager, kind: 'staff_task',
                                 payload: { route: 'staff', title_key: 'purchase_to_receive', params: {} } }]);

    // The driver reads their own purchase with its prices; nobody else's.
    type Mine = { purchases: Array<{ id: string; total_iqd: number; shop_name: string; status: string;
                                     lines: Array<{ name_en: string | null; label: string | null; qty: number;
                                                    unit: string | null; price_iqd: number }> }> };
    const mine = ok<Mine>(r, 'mine_drv').purchases;
    expect(mine.map((p) => p.id)).toEqual([purchase]);
    expect(mine[0]).toMatchObject({ total_iqd: 69000, shop_name: 'Al-Rasheed market', status: 'to_receive' });
    expect(mine[0]!.lines.find((l) => l.name_en === 'SP flour')).toMatchObject({ qty: 5000, unit: 'g', price_iqd: 60000 });
    expect(mine[0]!.lines.find((l) => l.label === 'Dish soap')).toMatchObject({ unit: 'pc', price_iqd: 3000 });
    expect(ok<Mine>(r, 'mine_drv2').purchases).toEqual([]);
    expect(ok<Mine>(r, 'mine_mgr').purchases.map((p) => p.id)).toContain(purchase);
    expect(refused(r, 'mine_hc')).toBe('FORBIDDEN');
    expect(refused(r, 'mine_mkt')).toBe('FORBIDDEN');
    const read = (who: string, tbl: string) => ok<number>(r, `read_${who}_${tbl}`);
    expect([read('drv', 'shopping_items'), read('drv', 'purchases'), read('drv', 'purchase_lines')]).toEqual([0, 1, 4]);
    for (const who of ['drv2', 'mkt', 'hc']) {
      for (const tbl of ['shopping_items', 'purchases', 'purchase_lines']) expect(read(who, tbl), `${who} ${tbl}`).toBe(0);
    }
    for (const tbl of ['shopping_items', 'purchases', 'purchase_lines']) expect(read('manager', tbl)).toBeGreaterThan(0);

    type ToReceive = { count: number; purchases: Array<{ id: string; staff_name: string; receipt_path: string;
      lines: Array<{ id: string; name_en: string | null; unit: string | null; pack_size: number | null;
                     qty: number; price_iqd: number; status: string }> }> };
    const tr = ok<ToReceive>(r, 'to_receive');
    const mineTr = tr.purchases.find((p) => p.id === purchase)!;
    expect(tr.count).toBe(tr.purchases.length);
    expect(mineTr).toMatchObject({ staff_name: 'SP drv', receipt_path: ok<{ path: string }>(r, 'slot').path });
    expect(mineTr.lines.find((l) => l.name_en === 'SP flour')).toMatchObject({ unit: 'g', pack_size: 1000, qty: 5000 });
    expect(refused(r, 'to_receive_drv')).toBe('FORBIDDEN');
    expect(refused(r, 'to_receive_hc')).toBe('FORBIDDEN');

    // Receiving: every stock line, and only stock lines.
    expect(refused(r, 'recv_short_list')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'recv_nonstock')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'recv_repeat')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'recv_negative')).toBe('INVALID_QTY:qty_received');
    expect(refused(r, 'recv_far_supplier')).toBe('SUPPLIER_NOT_FOUND');
    expect(refused(r, 'recv_drv')).toBe('FORBIDDEN');
    expect(refused(r, 'recv_missing')).toBe('PURCHASE_NOT_FOUND');
    expect(refused(r, 'ack_stock')).toBe('INVALID_ARGUMENT:line');

    // Received once: a retry under the key replays, a second key is refused.
    const recv = ok<{ delivery_id: string; received_line_ids: string[] }>(r, 'recv');
    expect([...recv.received_line_ids].sort()).toEqual(ok<string[]>(r, 'line_ids'));
    expect(ok<{ delivery_id: string; duplicate: boolean }>(r, 'recv_replay'))
      .toMatchObject({ delivery_id: recv.delivery_id, duplicate: true });
    expect(refused(r, 'recv_second_key')).toBe('PURCHASE_ALREADY_RECEIVED');
    // Booked once, at price ÷ quantity per base unit, at the purchase's venue.
    expect(ok<unknown[]>(r, 'booked')).toEqual([
      { ing: expect.any(String), type: 'goods_in', qty: 5000, unit_cost: 12, venue: VENUE_A_ID },
      { ing: expect.any(String), type: 'goods_in', qty: 1500, unit_cost: 2.5, venue: VENUE_A_ID },
    ]);
    expect(ok<unknown[]>(r, 'batches')).toEqual([
      { qty: 5000, expiry: '2026-12-31', venue: VENUE_A_ID },
      { qty: 1500, expiry: null, venue: VENUE_A_ID },
    ]);
    expect(ok<Record<string, unknown>>(r, 'delivery')).toMatchObject({
      supplier_name: 'SP Mill', venue: VENUE_A_ID, received_by: SEED_STAFF_IDS.manager,
      lines: [{ expected: 5000, received: 5000 }, { expected: 2000, received: 1500 }],
    });
    // Still to receive: the soap and the ice are not stock.
    expect(ok<Record<string, unknown>>(r, 'after_recv')).toEqual({
      status: 'to_receive', received_by: SEED_STAFF_IDS.manager,
      lines: { 'SP flour': 'received', 'SP sugar': 'received', 'Dish soap': 'to_receive', 'Ice bags': 'to_receive' },
      items: { 'SP flour': 'received', 'SP sugar': 'received', 'Dish soap': 'bought' },
    });
    ok(r, 'ack_soap');
    expect(refused(r, 'ack_soap_again')).toBe('PURCHASE_ALREADY_RECEIVED');
    expect(refused(r, 'ack_drv')).toBe('FORBIDDEN');
    ok(r, 'ack_ice');
    expect(ok<Record<string, unknown>>(r, 'done')).toEqual({
      status: 'done', received_by: SEED_STAFF_IDS.manager, soap_item: 'acknowledged',
    });
    expect(ok<ToReceive>(r, 'to_receive_after').purchases.map((p) => p.id)).not.toContain(purchase);
    expect(ok<string[]>(r, 'audit')).toEqual(['purchase.acknowledge', 'purchase.acknowledge', 'purchase.receive',
                                              'purchase.record']);
    // Nothing touched the till.
    expect(ok<Record<string, number>>(r, 'till')).toEqual({ payments: 0, tabs: 0 });
  });

  it('a stock line whose ingredient was switched off after the purchase is acknowledged, then the rest received', () => {
    const r = scenario([
      MK('drv', 'driver'),
      ING('milk', 'ml'), ING('flour', 'g'),
      T('rec', 'drv', `select app.record_purchase({{venue}}, jsonb_build_array(
         jsonb_build_object('ingredient_id', {{milk}}, 'qty', 2000, 'price_iqd', 6000),
         jsonb_build_object('ingredient_id', {{flour}}, 'qty', 500, 'price_iqd', 1000),
         jsonb_build_object('label', 'Straws', 'qty', 1, 'price_iqd', 500)), 7500, null, null)`),
      RES('purchase', 'rec', 'purchase_id'),
      KEEP('l_milk', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid and ingredient_id = {{milk}}::uuid`),
      KEEP('l_flour', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid and ingredient_id = {{flour}}::uuid`),
      KEEP('l_straws', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid and label = 'Straws'`),
      Q('switch_off', `update ingredients set is_active = false where id = {{flour}}::uuid returning to_jsonb(true)`),
      T('to_receive', 'manager', `select app.purchases_to_receive({{venue}})`),

      // Named or left out, the switched-off line stops the receive, and says which.
      T('recv_named', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_milk}}, 'qty_received', 2000),
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 0)))`),
      T('recv_left_out', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_milk}}, 'qty_received', 2000)))`),
      // An active stock line is still received, never acknowledged.
      T('ack_milk', 'manager', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_milk}})) x`),
      T('ack_flour', 'manager', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_flour}})) x`),
      T('recv', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_milk}}, 'qty_received', 2000)))`),
      T('ack_straws', 'manager', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{l_straws}})) x`),
      Q('after', `select jsonb_build_object('status', p.status,
                    'lines', (select jsonb_object_agg(coalesce(i.name_en, pl.label), pl.status)
                                from purchase_lines pl left join ingredients i on i.id = pl.ingredient_id
                               where pl.purchase_id = p.id),
                    'booked', (select jsonb_agg(m.ingredient_id) from stock_movements m
                                where m.ingredient_id in ({{milk}}::uuid, {{flour}}::uuid)))
                    from purchases p where p.id = {{purchase}}::uuid`),
    ]);

    ok(r, 'rec');
    // Goods in sees which line to acknowledge.
    type Line = { ingredient_active: boolean | null; name_en: string | null; label: string | null };
    const lines = ok<{ purchases: Array<{ id: string; lines: Line[] }> }>(r, 'to_receive').purchases
      .find((p) => p.id === ok<{ purchase_id: string }>(r, 'rec').purchase_id)!.lines;
    expect(Object.fromEntries(lines.map((l) => [l.name_en ?? l.label, l.ingredient_active]))).toEqual({
      'SP milk': true, 'SP flour': false, Straws: null,
    });
    expect(refused(r, 'recv_named')).toBe('INGREDIENT_NOT_FOUND:lines');
    expect(refused(r, 'recv_left_out')).toBe('INGREDIENT_NOT_FOUND:lines');
    expect(refused(r, 'ack_milk')).toBe('INVALID_ARGUMENT:line');
    ok(r, 'ack_flour');
    ok(r, 'recv');
    ok(r, 'ack_straws');
    const after = ok<{ status: string; lines: Record<string, string>; booked: string[] }>(r, 'after');
    expect(after.status).toBe('done');
    expect(after.lines).toEqual({ 'SP milk': 'received', 'SP flour': 'acknowledged', Straws: 'acknowledged' });
    expect(after.booked).toHaveLength(1);
  });

  it('a purchase with nothing in stock is acknowledged line by line, never received', () => {
    const r = scenario([
      MK('drv', 'driver'),
      T('rec', 'drv', `select app.record_purchase(null, '[{"label":"Bin bags","qty":3,"price_iqd":1500}]'::jsonb, 1500,
                         null, null)`),
      RES('purchase', 'rec', 'purchase_id'),
      KEEP('line', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid`),
      T('recv', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{line}}, 'qty_received', 3)))`),
      T('ack', 'manager', `select 'true'::jsonb from (select app.acknowledge_purchase_line({{line}})) x`),
      Q('done', `select to_jsonb(status || ':' || (delivery_id is null)::text) from purchases where id = {{purchase}}::uuid`),
      T('recv_after', 'manager', `select app.receive_purchase({{purchase}}, '[]'::jsonb)`),
    ]);
    ok(r, 'rec');
    expect(refused(r, 'recv')).toBe('INVALID_ARGUMENT:lines');
    ok(r, 'ack');
    expect(ok<string>(r, 'done')).toBe('done:true');
    expect(refused(r, 'recv_after')).toBe('PURCHASE_ALREADY_RECEIVED');
  });

  // Wave 5 (wave5-addendum-2026-09-25 §2.8 D4, lane S): the manager picks the
  // store a driver's purchase goes into; the cafe unless told otherwise. Shop
  // stock at the bakery is refused (stock-logs.test.ts, I16).
  it('receives a driver’s purchase into the store the manager picks', () => {
    const r = scenario([
      MK('drv', 'driver'),
      ING('flour', 'g'),
      T('rec', 'drv', `select app.record_purchase({{venue}}, jsonb_build_array(
         jsonb_build_object('ingredient_id', {{flour}}, 'qty', 1000, 'price_iqd', 3000)), 3000, null, null)`),
      RES('purchase', 'rec', 'purchase_id'),
      KEEP('l_flour', `select id::text from purchase_lines where purchase_id = {{purchase}}::uuid`),
      T('recv_bad', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 1000)), null, null, null, 'kitchen')`),
      T('recv', 'manager', `select app.receive_purchase({{purchase}}, jsonb_build_array(
         jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 1000)), null, null, null, 'bakery')`),
      Q('booked', `select jsonb_build_object('delivery', d.location, 'source', d.source, 'batch', b.location,
                                             'move', m.location, 'cost', b.unit_cost_iqd)
                     from purchases p
                     join deliveries d on d.id = p.delivery_id
                     join delivery_lines dl on dl.delivery_id = d.id
                     join stock_batches b on b.delivery_line_id = dl.id
                     join stock_movements m on m.batch_id = b.id and m.movement_type = 'goods_in'
                    where p.id = {{purchase}}::uuid`),
      Q('audit', `select to_jsonb(after->>'location') from audit_log
                   where action = 'purchase.receive' and entity_id = {{purchase}}`),
    ]);
    ok(r, 'rec');
    expect(refused(r, 'recv_bad')).toBe('INVALID_ARGUMENT:location');
    ok(r, 'recv');
    expect(ok(r, 'booked')).toEqual({ delivery: 'bakery', source: 'goods_in', batch: 'bakery', move: 'bakery', cost: 3 });
    expect(ok(r, 'audit')).toBe('bakery');
  });
});
