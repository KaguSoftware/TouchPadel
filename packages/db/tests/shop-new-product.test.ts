/**
 * 0389 (F-36, Majed 2026-11-01): the shop's products are never lost.
 *
 *   * a driver purchase with a shop product is received (its line goes into
 *     the shop store), never refused INVALID_ARGUMENT hint kind; a mixed
 *     purchase makes a shop delivery beside the café one;
 *   * create_shop_product makes the product and its first size in one call,
 *     and a retry under the same key makes nothing twice;
 *   * a new product a driver bought (a line with a name, no product) is
 *     approved by a manager: it becomes the product, its quantity lands in the
 *     shop store at the price paid, the line is received; a shop assistant
 *     cannot approve; a second approval is REQUEST_NOT_PENDING;
 *   * a shop product (or one of its sizes) is never deleted.
 *
 * A manager's new product is saved hidden (0246: a manager launches through the
 * product protocol), as ProductsAdmin sends it.
 *
 * One rolled-back psql transaction per case (stores-harness).
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, T, Q, X, KEEP, MK, ING, ok, refused } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

const SHOP_CAT = KEEP(
  'cat',
  `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id, kind)
   values ('SNP Rackets', 'مضارب', {{tax}}::uuid, {{venue}}::uuid, 'shop') returning id::text`,
);
const CREATE = (label: string, who: string, name: string, key: string, line = 'null') =>
  T(
    label,
    who,
    `select app.create_shop_product({{cat}}::uuid, '${name}', '${name} ع', 'One size', 'مقاس واحد', 25000,
       null, null, null, 15000, null, ${who === 'manager' ? 'false' : 'true'}, ${line}, '${key}')`,
  );

describe.skipIf(!docker)('0389 shop products are never lost (rolled-back transactions)', () => {
  it('a driver purchase with a shop product is received; a new product is approved into the shop store', () => {
    const r = scenario('snp389a', [
      SHOP_CAT,
      MK('drv', 'driver'),
      MK('shop1', 'shop_staff'),
      // A product the shop already sells, made in one call.
      CREATE('made', 'manager', 'SNP Grip', 'snp:make:1'),
      CREATE('made_again', 'manager', 'SNP Grip', 'snp:make:1'),
      Q('made_items', `select to_jsonb(count(*)) from menu_items where name_en = 'SNP Grip'`),
      KEEP('grip_ing', `select res #>> '{data,ingredient_id}' from pg_temp.out where label = 'made'`),
      ING('flour', 'purchased', 'g'),
      // The driver's purchase: the grip (a shop product), flour (the café's) and a new racket (a name only).
      KEEP(
        'pur',
        `insert into purchases (venue_id, staff_id, bought_at, shop_name, total_iqd)
         values ({{venue}}::uuid, {{drv}}::uuid, now(), 'Sport souq', 205000) returning id::text`,
      ),
      KEEP('l_grip', `insert into purchase_lines (purchase_id, ingredient_id, qty, price_iqd)
                      values ({{pur}}::uuid, {{grip_ing}}::uuid, 4, 60000) returning id::text`),
      KEEP('l_flour', `insert into purchase_lines (purchase_id, ingredient_id, qty, price_iqd)
                       values ({{pur}}::uuid, {{flour}}::uuid, 5000, 25000) returning id::text`),
      KEEP('l_new', `insert into purchase_lines (purchase_id, label, qty, price_iqd)
                     values ({{pur}}::uuid, 'Bullpadel Vertex', 2, 120000) returning id::text`),
      T(
        'receive',
        'manager',
        `select app.receive_purchase({{pur}}::uuid, jsonb_build_array(
            jsonb_build_object('purchase_line_id', {{l_grip}}, 'qty_received', 4),
            jsonb_build_object('purchase_line_id', {{l_flour}}, 'qty_received', 5000)), null, null, 'snp:recv:1', 'cafe')`,
      ),
      Q(
        'stores',
        `select jsonb_object_agg(i.kind::text, b.location::text) from stock_batches b join ingredients i on i.id = b.ingredient_id
          where b.ingredient_id in ({{grip_ing}}::uuid, {{flour}}::uuid)`,
      ),
      Q('pur_status', `select to_jsonb(status) from purchases where id = {{pur}}::uuid`),
      // The new racket: a shop assistant may not approve a purchase; the manager does.
      CREATE('shop_approve', 'shop1', 'Bullpadel Vertex', 'snp:new:0', `{{l_new}}::uuid`),
      CREATE('approve', 'manager', 'Bullpadel Vertex', 'snp:new:1', `{{l_new}}::uuid`),
      CREATE('approve_retry', 'manager', 'Bullpadel Vertex', 'snp:new:1', `{{l_new}}::uuid`),
      CREATE('approve_twice', 'manager', 'Bullpadel Vertex', 'snp:new:2', `{{l_new}}::uuid`),
      KEEP('new_ing', `select res #>> '{data,ingredient_id}' from pg_temp.out where label = 'approve'`),
      Q(
        'new_stock',
        `select jsonb_build_object('qty', sum(qty_remaining), 'cost', max(unit_cost_iqd), 'store', max(location::text))
           from stock_batches where ingredient_id = {{new_ing}}::uuid`,
      ),
      Q('line', `select jsonb_build_object('status', status, 'linked', ingredient_id = {{new_ing}}::uuid)
                   from purchase_lines where id = {{l_new}}::uuid`),
      Q('pur_done', `select to_jsonb(status) from purchases where id = {{pur}}::uuid`),
      Q('vertex_items', `select to_jsonb(count(*)) from menu_items where name_en = 'Bullpadel Vertex'`),
    ]);

    expect(ok<{ variant_id: string }>(r, 'made').variant_id).toBeTruthy();
    expect(ok(r, 'made_again')).toEqual({ ...ok<object>(r, 'made'), duplicate: true });
    expect(ok<number>(r, 'made_items')).toBe(1);
    const rec = ok<{ delivery_id: string; received_line_ids: string[] }>(r, 'receive');
    expect(rec.received_line_ids).toHaveLength(2);
    expect(ok(r, 'stores')).toEqual({ retail: 'shop', purchased: 'cafe' });
    // The new racket is still to approve.
    expect(ok<string>(r, 'pur_status')).toBe('to_receive');
    expect(refused(r, 'shop_approve')).toBe('FORBIDDEN:purchase');
    expect(ok(r, 'approve')).toMatchObject({ purchase_id: expect.any(String), delivery_id: expect.any(String) });
    expect(ok(r, 'approve_retry')).toEqual({ ...ok<object>(r, 'approve'), duplicate: true });
    expect(refused(r, 'approve_twice')).toBe('REQUEST_NOT_PENDING');
    expect(ok(r, 'new_stock')).toEqual({ qty: 2, cost: 60000, store: 'shop' });
    expect(ok(r, 'line')).toEqual({ status: 'received', linked: true });
    expect(ok<string>(r, 'pur_done')).toBe('done');
    expect(ok<number>(r, 'vertex_items')).toBe(1);
  });

  it('a shop product and its sizes are never deleted; a café item still is', () => {
    const made = [SHOP_CAT, CREATE('made', 'manager', 'SNP Balls', 'snp:make:b'),
      KEEP('item', `select res #>> '{data,item_id}' from pg_temp.out where label = 'made'`),
      KEEP('variant', `select res #>> '{data,variant_id}' from pg_temp.out where label = 'made'`)];
    // As the table owner: no RPC deletes a product, and the trigger holds even there.
    expect(() => scenario('snp389b', [...made, X(`delete from menu_item_variants where id = {{variant}}::uuid`)])).toThrow(/FORBIDDEN/);
    expect(() => scenario('snp389c', [...made, X(`delete from menu_items where id = {{item}}::uuid`)])).toThrow(/FORBIDDEN/);
    const cafe = scenario('snp389d', [
      KEEP('ccat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
                    values ('SNP Drinks', 'مشروبات', {{tax}}::uuid, {{venue}}::uuid) returning id::text`),
      KEEP('citem', `insert into menu_items (category_id, name_en, name_ar, venue_id) values ({{ccat}}::uuid, 'SNP Tea', 'شاي', {{venue}}::uuid) returning id::text`),
      X(`delete from menu_items where id = {{citem}}::uuid`),
      Q('gone', `select to_jsonb(count(*)) from menu_items where id = {{citem}}::uuid`),
    ]);
    expect(ok<number>(cafe, 'gone')).toBe(0);
  });
});
