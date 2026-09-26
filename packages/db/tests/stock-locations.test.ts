/**
 * stock_locations (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8,
 * §6.1): two stores at every venue, the cafe and the bakery.
 *
 *   * I3  a movement is at its batch's store: a service-role insert naming
 *         the wrong store comes back corrected; a batch-less row keeps its own;
 *   * I6  each use draws its preferred store first (a sale the cafe, a
 *         production the bakery, waste the named store or the caller's home)
 *         and overdraws only when the whole venue is short: with the cafe
 *         empty and the bakery stocked a sale writes no batch-less row and no
 *         alert;
 *   * I7  with all stock in the cafe a sale books exactly what 0018 booked:
 *         the 0018 body, kept here verbatim as pg_temp.fefo_0018, and the
 *         new app.consume_fefo run on twin ingredients write the same rows;
 *   * I10 a transfer never raises low stock (a waste does);
 *   * I2  every batch holds what its movements say, through receipts,
 *         sales, production, waste and a transfer;
 *   * I5  (committed, over HTTP) 10 cafe sales and 10 bakery batches of one
 *         ingredient in Promise.all: no deadlock, exact sums, one overdraft
 *         row and one alert when the venue runs out;
 *   * (committed, two psql sessions) a production costs only what it
 *     consumed, even while another production of the same ingredient waits
 *     on it;
 *   * production lands in the bakery; Goods in and waste name their store;
 *     another venue's ingredient is refused; the refund restock prefers a
 *     cafe batch (committed, over HTTP); v_stock_by_location is MGMT only and
 *     sums to v_ingredient_on_hand; the new columns rewrite nothing.
 *
 * The product test's store is in product-release.test.ts and the driver
 * receipt's in shopping-purchases.test.ts, beside their flows.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  testIdemKey,
  createTestMenuItem,
  createTestIngredient,
  addRecipeLine,
  createTestCafeTable,
  ensureOpenDay,
  ensureTillFresh,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PINS,
  VENUE_A_ID,
} from './helpers';
import {
  BATCH,
  ING,
  KEEP,
  LINES,
  MK,
  OTHER_VENUE,
  Q,
  T,
  X,
  XAS,
  asStaff,
  dockerReachable,
  ok,
  psql,
  psqlSession,
  refused,
  scenario,
} from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();
const run = (body: string[]) => scenario('sl', body);

type Move = { batch: string | null; location: string; qty: number; type?: string };
/** The ingredient's movements of one type, oldest first, each batch named by its label. */
const MOVES = (label: string, ing: string, type: string) =>
  Q(label, `select coalesce(jsonb_agg(jsonb_build_object(
              'batch', (select v.name from pg_temp.vars v where v.val = m.batch_id::text),
              'location', m.location, 'qty', m.qty_delta) order by m.id), '[]')
              from stock_movements m
             where m.ingredient_id = {{${ing}}}::uuid and m.movement_type = '${type}'`);
const ALERTS = (label: string, ing: string, kind = 'negative_stock') =>
  Q(label, `select coalesce(jsonb_agg(a.payload order by a.created_at), '[]')
              from manager_alerts a
             where a.kind = '${kind}' and a.payload->>'ingredient_id' = {{${ing}}}
               and a.acknowledged_at is null`);

describe.skipIf(!docker)('stores: locations (rolled-back transactions)', () => {
  it('a movement is at its batch’s store, whatever the writer names (I3)', () => {
    const r = run([
      ING('flour', 'purchased', 'g'),
      BATCH('b_bak', 'flour', 'bakery', 100, 2),
      XAS('service_role', `insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd,
                                                        venue_id, location)
                           values ({{flour}}::uuid, {{b_bak}}::uuid, 'count_adjustment', 1, 2, {{venue}}::uuid, 'cafe')`),
      XAS('service_role', `insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd,
                                                        venue_id, location)
                           values ({{flour}}::uuid, null, 'count_adjustment', -1, 2, {{venue}}::uuid, 'bakery')`),
      MOVES('adjustments', 'flour', 'count_adjustment'),
      MOVES('goods_in', 'flour', 'goods_in'),
    ]);
    expect(ok<Move[]>(r, 'adjustments')).toEqual([
      { batch: 'b_bak', location: 'bakery', qty: 1 },
      { batch: null, location: 'bakery', qty: -1 },
    ]);
    // The planted receipt names no store: the trigger took the batch's.
    expect(ok<Move[]>(r, 'goods_in')).toEqual([{ batch: 'b_bak', location: 'bakery', qty: 100 }]);
  });

  it('each use draws its preferred store first, and overdraws only when the whole venue is short (D3, I6)', () => {
    const r = run([
      // The bakery's flour expires first; a sale still takes the cafe's.
      ING('flour', 'purchased', 'g'),
      BATCH('f_cafe', 'flour', 'cafe', 100, 2, 10, 60),
      BATCH('f_bak', 'flour', 'bakery', 100, 3, 1, 30),
      X(`select app.consume_fefo({{flour}}::uuid, 150, 'sale_consumption')`),
      X(`select app.consume_fefo_at('bakery', {{flour}}::uuid, 10, 'waste_spill')`),
      MOVES('flour_sale', 'flour', 'sale_consumption'),
      MOVES('flour_waste', 'flour', 'waste_spill'),
      ALERTS('flour_alerts', 'flour'),
      // The cafe is empty and the bakery stocked: the sale is served there,
      // with no overdraft and no alert (I6). Past the venue's stock, one
      // batch-less row at the preferred store and one alert that names it.
      ING('sugar', 'purchased', 'g'),
      BATCH('s_bak', 'sugar', 'bakery', 50, 1),
      X(`select app.consume_fefo({{sugar}}::uuid, 30, 'sale_consumption')`),
      ALERTS('sugar_alerts_1', 'sugar'),
      X(`select app.consume_fefo({{sugar}}::uuid, 100, 'sale_consumption')`),
      MOVES('sugar_sale', 'sugar', 'sale_consumption'),
      ALERTS('sugar_alerts_2', 'sugar'),
      // Preferring the bakery: its batches, then the cafe's, then the rest there.
      ING('salt', 'purchased', 'g'),
      BATCH('t_cafe', 'salt', 'cafe', 10, 1, null, 60),
      BATCH('t_bak', 'salt', 'bakery', 10, 1, null, 30),
      X(`select app.consume_fefo_at('bakery', {{salt}}::uuid, 30, 'production_consume')`),
      MOVES('salt_prod', 'salt', 'production_consume'),
      ALERTS('salt_alerts', 'salt'),
      T('internal', 'manager', `select to_jsonb(app.consume_fefo_at('cafe', {{salt}}::uuid, 1, 'waste_spill'))`),
    ]);
    expect(ok<Move[]>(r, 'flour_sale')).toEqual([
      { batch: 'f_cafe', location: 'cafe', qty: -100 },
      { batch: 'f_bak', location: 'bakery', qty: -50 },
    ]);
    expect(ok<Move[]>(r, 'flour_waste')).toEqual([{ batch: 'f_bak', location: 'bakery', qty: -10 }]);
    expect(ok<unknown[]>(r, 'flour_alerts')).toEqual([]);

    expect(ok<unknown[]>(r, 'sugar_alerts_1')).toEqual([]);
    expect(ok<Move[]>(r, 'sugar_sale')).toEqual([
      { batch: 's_bak', location: 'bakery', qty: -30 },
      { batch: 's_bak', location: 'bakery', qty: -20 },
      { batch: null, location: 'cafe', qty: -80 },
    ]);
    expect(ok<Array<Record<string, unknown>>>(r, 'sugar_alerts_2')).toEqual([
      expect.objectContaining({ shortfall: 80, location: 'cafe' }),
    ]);

    expect(ok<Move[]>(r, 'salt_prod')).toEqual([
      { batch: 't_bak', location: 'bakery', qty: -10 },
      { batch: 't_cafe', location: 'cafe', qty: -10 },
      { batch: null, location: 'bakery', qty: -10 },
    ]);
    expect(ok<Array<Record<string, unknown>>>(r, 'salt_alerts')).toEqual([
      expect.objectContaining({ shortfall: 10, location: 'bakery' }),
    ]);
    expect(refused(r, 'internal')).toMatch(/permission denied/);
  });

  it('with all stock in the cafe a sale books exactly what 0018 booked (I7)', () => {
    // 0018:83-122 verbatim, renamed. Twin ingredients get the same batches,
    // the old body runs on one and the new consume_fefo on the other.
    const FEFO_0018 = `
create function pg_temp.fefo_0018(
  p_ingredient uuid, p_qty numeric, p_type movement_type,
  p_order_item uuid default null, p_ticket uuid default null,
  p_staff uuid default null, p_device text default null,
  p_reason_code text default null
) returns void language plpgsql as $g$
declare v_left numeric := p_qty; v_batch record; v_take numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;

  for v_batch in
    select id, qty_remaining, unit_cost_iqd
      from stock_batches
     where ingredient_id = p_ingredient and qty_remaining > 0
     order by expiry_date asc nulls last, received_at asc
     for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_batch.qty_remaining);
    update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (p_ingredient, v_batch.id, p_type, -v_take,
            v_batch.unit_cost_iqd, p_order_item, p_ticket, p_staff, p_device, p_reason_code);
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (p_ingredient, null, p_type, -v_left,
            (select unit_cost_iqd from stock_batches where ingredient_id = p_ingredient
              order by received_at desc limit 1),
            p_order_item, p_ticket, p_staff, p_device, p_reason_code);
    insert into manager_alerts (kind, payload)
    values ('negative_stock', jsonb_build_object('ingredient_id', p_ingredient,
            'shortfall', v_left, 'order_item_id', p_order_item));
  end if;
end $g$;`;
    const twin = (p: 'a' | 'b') => [
      ING(`${p}`, 'purchased', 'g'),
      BATCH(`${p}_b1`, p, 'cafe', 100, 3, 5, 40),
      BATCH(`${p}_b2`, p, 'cafe', 80, 4, null, 50),
      BATCH(`${p}_b3`, p, 'cafe', 60, 5, 2, 10),
      BATCH(`${p}_b4`, p, 'cafe', 70, 6, 5, 30),
    ];
    const ROWS = (label: string, p: string) =>
      Q(label, `select jsonb_agg(jsonb_build_object(
                  'batch', replace((select v.name from pg_temp.vars v where v.val = m.batch_id::text), '${p}_', ''),
                  'type', m.movement_type, 'qty', m.qty_delta, 'cost', m.unit_cost_iqd, 'staff', m.staff_id,
                  'device', m.device_id, 'reason', m.reason_code, 'location', m.location) order by m.id)
                  from stock_movements m where m.ingredient_id = {{${p}}}::uuid and m.movement_type <> 'goods_in'`);
    const LEFT = (label: string, p: string) =>
      Q(label, `select jsonb_object_agg(replace(v.name, '${p}_', ''), b.qty_remaining)
                  from stock_batches b join pg_temp.vars v on v.val = b.id::text
                 where b.ingredient_id = {{${p}}}::uuid`);
    const r = run([
      FEFO_0018,
      ...twin('a'),
      ...twin('b'),
      X(`select pg_temp.fefo_0018({{a}}::uuid, 150, 'sale_consumption', null, null, {{manager}}::uuid, 'DEV', 'r1')`),
      X(`select app.consume_fefo({{b}}::uuid, 150, 'sale_consumption', null, null, {{manager}}::uuid, 'DEV', 'r1')`),
      X(`select pg_temp.fefo_0018({{a}}::uuid, 200, 'sale_consumption', null, null, {{manager}}::uuid, 'DEV', 'r2')`),
      X(`select app.consume_fefo({{b}}::uuid, 200, 'sale_consumption', null, null, {{manager}}::uuid, 'DEV', 'r2')`),
      ROWS('rows_a', 'a'),
      ROWS('rows_b', 'b'),
      LEFT('left_a', 'a'),
      LEFT('left_b', 'b'),
      ALERTS('alerts_a', 'a'),
      ALERTS('alerts_b', 'b'),
    ]);
    const rowsA = ok<Array<Record<string, unknown>>>(r, 'rows_a');
    const rowsB = ok<Array<Record<string, unknown>>>(r, 'rows_b');
    expect(rowsB).toEqual(rowsA);
    // FEFO, oldest expiry first, nulls last; the overdraft costed at the newest batch.
    expect(rowsA.map((x) => [x.batch, x.qty])).toEqual([
      ['b3', -60], ['b1', -90], ['b1', -10], ['b4', -70], ['b2', -80], [null, -40],
    ]);
    expect(rowsA[rowsA.length - 1]).toMatchObject({ cost: 5, location: 'cafe' });
    expect(ok(r, 'left_b')).toEqual(ok(r, 'left_a'));
    const [alertA] = ok<Array<Record<string, unknown>>>(r, 'alerts_a');
    const [alertB] = ok<Array<Record<string, unknown>>>(r, 'alerts_b');
    const { location, ...restB } = alertB!;
    expect(location).toBe('cafe');
    expect({ ...restB, ingredient_id: null }).toEqual({ ...alertA!, ingredient_id: null });
  });

  it('production draws the bakery first and lands there; the manager may name the cafe', () => {
    const r = run([
      MK('hc', 'head_chef'),
      ING('flour', 'purchased', 'g'),
      BATCH('f_cafe', 'flour', 'cafe', 1000, 2, null, 60),
      BATCH('f_bak', 'flour', 'bakery', 200, 3, null, 30),
      ING('dough', 'prepared', 'g'),
      X(`insert into recipe_lines (output_ingredient_id, ingredient_id, qty) values ({{dough}}::uuid, {{flour}}::uuid, 1)`),
      T('batch', 'hc', `select app.record_batch({{dough}}::uuid, 300, null, {{venue}}::uuid)`),
      T('rp_cafe', 'manager', `select app.record_production({{dough}}::uuid, 100, null, null, 'cafe')`),
      T('rp_default', 'manager', `select app.record_production({{dough}}::uuid, 50)`),
      T('rp_bad', 'manager', `select app.record_production({{dough}}::uuid, 1, null, null, 'kitchen')`),
      MOVES('consumed', 'flour', 'production_consume'),
      Q('made', `select jsonb_agg(jsonb_build_object('location', b.location, 'qty', b.qty_remaining,
                                                     'cost', b.unit_cost_iqd) order by b.qty_remaining desc)
                   from stock_batches b where b.ingredient_id = {{dough}}::uuid`),
      Q('made_moves', `select jsonb_agg(m.location order by m.id) from stock_movements m
                        where m.ingredient_id = {{dough}}::uuid and m.movement_type = 'production_in'`),
      Q('audit', `select jsonb_agg(a.after->>'location' order by a.id) from audit_log a
                   where a.action = 'stock.record_production' and a.entity_id = {{dough}} and a.at = now()`),
    ]);
    ok(r, 'batch');
    ok(r, 'rp_cafe');
    ok(r, 'rp_default');
    expect(refused(r, 'rp_bad')).toBe('INVALID_ARGUMENT:location');
    expect(ok<Move[]>(r, 'consumed')).toEqual([
      { batch: 'f_bak', location: 'bakery', qty: -200 },
      { batch: 'f_cafe', location: 'cafe', qty: -100 },
      { batch: 'f_cafe', location: 'cafe', qty: -100 },
      { batch: 'f_cafe', location: 'cafe', qty: -50 },
    ]);
    expect(ok(r, 'made')).toEqual([
      // (200 g at 3 + 100 g at 2) / 300 g, to four places.
      { location: 'bakery', qty: 300, cost: 2.6667 },
      { location: 'cafe', qty: 100, cost: 2 },
      { location: 'bakery', qty: 50, cost: 2 },
    ]);
    expect(ok(r, 'made_moves')).toEqual(['bakery', 'cafe', 'bakery']);
    expect(ok(r, 'audit')).toEqual(['bakery', 'cafe', 'bakery']);
  });

  it('waste and Goods in name their store; another venue’s ingredient is refused', () => {
    const r = run([
      ING('milk', 'purchased', 'ml'),
      ING('far', 'purchased', 'ml', { venue: OTHER_VENUE }),
      BATCH('m_cafe', 'milk', 'cafe', 100, 2, null, 60),
      BATCH('m_bak', 'milk', 'bakery', 100, 2, null, 30),
      T('w_bak', 'manager', `select to_jsonb(app.record_waste({{milk}}::uuid, 10, 'waste_spill', 'spilt', null, 'SL-W1', 'bakery'))`),
      T('w_home', 'cashier', `select to_jsonb(app.record_waste({{milk}}::uuid, 5, 'waste_spoilage', 'sour'))`),
      T('w_bad', 'manager', `select to_jsonb(app.record_waste({{milk}}::uuid, 1, 'waste_spill', 'x', null, null, 'kitchen'))`),
      MOVES('spill', 'milk', 'waste_spill'),
      MOVES('spoil', 'milk', 'waste_spoilage'),
      Q('w_audit', `select jsonb_agg(a.after->>'location' order by a.id) from audit_log a
                     where a.action = 'stock.record_waste' and a.entity_id = {{milk}} and a.at = now()`),
      T('gi_bak', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{milk}}', qty_received: 500, unit_cost_iqd: 2 }])},
                                null, null, null, null, 'SL-GI1', 'bakery')`),
      T('gi_cafe', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{milk}}', qty_received: 300, unit_cost_iqd: 2 }])})`),
      T('gi_far', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{far}}', qty_received: 1, unit_cost_iqd: 2 }])})`),
      T('gi_loc', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{milk}}', qty_received: 1, unit_cost_iqd: 2 }])},
                               null, null, null, null, null, 'kitchen')`),
      Q('deliveries', `select jsonb_agg(jsonb_build_object('location', d.location, 'source', d.source,
                                                           'batch', b.location, 'move', m.location, 'qty', dl.qty_received)
                                        order by dl.qty_received desc)
                         from delivery_lines dl
                         join deliveries d on d.id = dl.delivery_id
                         join stock_batches b on b.delivery_line_id = dl.id
                         join stock_movements m on m.batch_id = b.id and m.movement_type = 'goods_in'
                        where dl.ingredient_id = {{milk}}::uuid`),
      Q('gi_audit', `select jsonb_agg(a.after->>'location' order by a.id) from audit_log a
                      where a.action = 'stock.receive_delivery' and a.at = now()
                        and a.after->'lines'->0->>'ingredient_id' = {{milk}}`),
    ]);
    ok(r, 'w_bak');
    ok(r, 'w_home');
    expect(refused(r, 'w_bad')).toBe('INVALID_ARGUMENT:location');
    expect(ok<Move[]>(r, 'spill')).toEqual([{ batch: 'm_bak', location: 'bakery', qty: -10 }]);
    // The cashier's home store is the cafe.
    expect(ok<Move[]>(r, 'spoil')).toEqual([{ batch: 'm_cafe', location: 'cafe', qty: -5 }]);
    expect(ok(r, 'w_audit')).toEqual(['bakery', 'cafe']);

    ok(r, 'gi_bak');
    ok(r, 'gi_cafe');
    expect(refused(r, 'gi_far')).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'gi_loc')).toBe('INVALID_ARGUMENT:location');
    expect(ok(r, 'deliveries')).toEqual([
      { location: 'bakery', source: 'goods_in', batch: 'bakery', move: 'bakery', qty: 500 },
      { location: 'cafe', source: 'goods_in', batch: 'cafe', move: 'cafe', qty: 300 },
    ]);
    expect(ok(r, 'gi_audit')).toEqual(['bakery', 'cafe']);
  });

  it('v_stock_by_location is MGMT only and sums to v_ingredient_on_hand', () => {
    const r = run([
      MK('hc', 'head_chef'), MK('wtr', 'waiter'),
      ING('beans', 'purchased', 'g'),
      BATCH('b_cafe', 'beans', 'cafe', 300, 20),
      BATCH('b_bak', 'beans', 'bakery', 120, 20),
      X(`select app.consume_fefo({{beans}}::uuid, 500, 'sale_consumption')`),
      ...(['manager', 'owner'] as const).map((who) =>
        T(`view_${who}`, who, `select jsonb_agg(jsonb_build_object('location', v.location, 'on_hand', v.on_hand,
                                                                   'theoretical', v.theoretical) order by v.location)
                                 from v_stock_by_location v where v.ingredient_id = {{beans}}::uuid`)),
      Q('venue', `select jsonb_build_object('on_hand', v.on_hand, 'theoretical', v.theoretical)
                    from v_ingredient_on_hand v where v.ingredient_id = {{beans}}::uuid`),
      ...(['hc', 'wtr', 'cashier', 'desk'] as const).map((who) =>
        T(`view_${who}`, who, `select to_jsonb(count(*)) from v_stock_by_location`)),
    ]);
    for (const who of ['manager', 'owner']) {
      expect(ok(r, `view_${who}`), who).toEqual([
        { location: 'cafe', on_hand: 0, theoretical: -80 },
        { location: 'bakery', on_hand: 0, theoretical: 0 },
      ]);
    }
    const rows = ok<Array<{ on_hand: number; theoretical: number }>>(r, 'view_manager');
    const venue = ok<{ on_hand: number; theoretical: number }>(r, 'venue');
    expect(rows.reduce((s, x) => s + Number(x.on_hand), 0)).toBe(Number(venue.on_hand));
    expect(rows.reduce((s, x) => s + Number(x.theoretical), 0)).toBe(Number(venue.theoretical));
    for (const who of ['hc', 'wtr', 'cashier', 'desk']) expect(ok<number>(r, `view_${who}`), who).toBe(0);
  });

  it('a transfer never raises low stock; a waste does (I10)', () => {
    const r = run([
      ING('oat', 'purchased', 'ml', { threshold: 500 }),
      BATCH('o_cafe', 'oat', 'cafe', 400, 3),
      // A transfer pair as transfer_stock books one (stock_transfers).
      X(`update stock_batches set qty_remaining = qty_remaining - 100 where id = {{o_cafe}}::uuid`),
      KEEP('o_bak', `insert into stock_batches (ingredient_id, received_at, qty_received, qty_remaining, unit_cost_iqd,
                                                venue_id, location, origin_batch_id)
                     select ingredient_id, received_at, 100, 100, unit_cost_iqd, venue_id, 'bakery', id
                       from stock_batches where id = {{o_cafe}}::uuid
                     returning id::text`),
      X(`insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd, reason_code, venue_id)
         values ({{oat}}::uuid, {{o_cafe}}::uuid, 'transfer', -100, 3, 'transfer:probe', {{venue}}::uuid),
                ({{oat}}::uuid, {{o_bak}}::uuid, 'transfer', 100, 3, 'transfer:probe', {{venue}}::uuid)`),
      ALERTS('after_move', 'oat', 'low_stock'),
      X(`select app.consume_fefo({{oat}}::uuid, 1, 'waste_spill')`),
      ALERTS('after_waste', 'oat', 'low_stock'),
      MOVES('pair', 'oat', 'transfer'),
    ]);
    expect(ok<Move[]>(r, 'pair')).toEqual([
      { batch: 'o_cafe', location: 'cafe', qty: -100 },
      { batch: 'o_bak', location: 'bakery', qty: 100 },
    ]);
    expect(ok<unknown[]>(r, 'after_move')).toEqual([]);
    expect(ok<Array<Record<string, unknown>>>(r, 'after_waste')).toEqual([
      expect.objectContaining({ on_hand: 399, threshold: 500, out: false }),
    ]);
  });

  it('every batch holds what its movements say, through each writer (I2)', () => {
    const r = run([
      MK('hc', 'head_chef'),
      ING('flour', 'purchased', 'g'),
      ING('dough', 'prepared', 'g'),
      X(`insert into recipe_lines (output_ingredient_id, ingredient_id, qty) values ({{dough}}::uuid, {{flour}}::uuid, 2)`),
      T('gi', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{flour}}', qty_received: 1000, unit_cost_iqd: 2 }])})`),
      T('gi_bak', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{flour}}', qty_received: 400, unit_cost_iqd: 3 }])},
                                null, null, null, null, null, 'bakery')`),
      X(`select app.consume_fefo({{flour}}::uuid, 250, 'sale_consumption')`),
      T('batch', 'hc', `select app.record_batch({{dough}}::uuid, 300, null, {{venue}}::uuid)`),
      T('waste', 'manager', `select to_jsonb(app.record_waste({{flour}}::uuid, 30, 'waste_spill', 'x', null, null, 'bakery'))`),
      X(`select app.consume_fefo({{dough}}::uuid, 120, 'sale_consumption')`),
      Q('drift', `select coalesce(jsonb_agg(jsonb_build_object('batch', b.id, 'remaining', b.qty_remaining, 'ledger', m.sum)), '[]')
                    from stock_batches b
                    cross join lateral (select coalesce(sum(qty_delta), 0) as sum from stock_movements where batch_id = b.id) m
                   where b.ingredient_id in ({{flour}}::uuid, {{dough}}::uuid) and b.qty_remaining <> m.sum`),
      Q('batches', `select to_jsonb(count(*)) from stock_batches where ingredient_id in ({{flour}}::uuid, {{dough}}::uuid)`),
    ]);
    for (const label of ['gi', 'gi_bak', 'batch', 'waste']) ok(r, label);
    expect(ok<number>(r, 'batches')).toBe(3);
    expect(ok<unknown[]>(r, 'drift')).toEqual([]);
  });

  it('the new columns rewrite nothing: the same DDL keeps relfilenode (§7.4)', () => {
    const r = run([
      KEEP('rfn_batches', `select relfilenode::text from pg_class where oid = 'public.stock_batches'::regclass`),
      KEEP('rfn_moves', `select relfilenode::text from pg_class where oid = 'public.stock_movements'::regclass`),
      X(`alter table stock_batches add column probe_location stock_location not null default 'bakery'`),
      X(`alter table stock_movements add column probe_location stock_location not null default 'bakery'`),
      X(`alter table stock_batches add constraint probe_location_chk check (probe_location <> 'cafe') not valid`),
      X(`alter table stock_batches validate constraint probe_location_chk`),
      Q('after', `select jsonb_build_object(
                    'batches', (select relfilenode::text = {{rfn_batches}} from pg_class where oid = 'public.stock_batches'::regclass),
                    'moves', (select relfilenode::text = {{rfn_moves}} from pg_class where oid = 'public.stock_movements'::regclass))`),
      Q('columns', `select jsonb_object_agg(c.table_name || '.' || c.column_name, c.column_default)
                      from information_schema.columns c
                     where c.table_schema = 'public'
                       and (c.table_name, c.column_name) in (('stock_batches', 'location'), ('stock_movements', 'location'),
                                                            ('stock_counts', 'location'), ('stock_counts', 'source'),
                                                            ('deliveries', 'location'), ('deliveries', 'source'),
                                                            ('delivery_lines', 'cost_source'))`),
    ]);
    expect(ok(r, 'after')).toEqual({ batches: true, moves: true });
    expect(ok(r, 'columns')).toEqual({
      'stock_batches.location': "'cafe'::stock_location",
      'stock_movements.location': "'cafe'::stock_location",
      'stock_counts.location': "'cafe'::stock_location",
      'stock_counts.source': "'operator'::text",
      'deliveries.location': "'cafe'::stock_location",
      'deliveries.source': "'goods_in'::text",
      'delivery_lines.cost_source': "'entered'::text",
    });
  });
});

// ── committed, over HTTP: two transactions at once ─────────────────────────
describe.skipIf(!up)('stores: locations under load (committed)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
  });

  /** A live batch at a store with its goods_in movement, as a receipt books it. */
  async function batchAt(ingredientId: string, location: 'cafe' | 'bakery', qty: number, cost: number, ageMinutes: number) {
    const receivedAt = new Date(Date.now() - ageMinutes * 60_000).toISOString();
    const { data, error } = await svc
      .from('stock_batches')
      .insert({ ingredient_id: ingredientId, received_at: receivedAt, qty_received: qty, qty_remaining: qty,
                unit_cost_iqd: cost, venue_id: VENUE_A_ID, location })
      .select('id')
      .single();
    if (error) throw new Error(`batch failed: ${error.message}`);
    const id = (data as { id: string }).id;
    const mv = await svc.from('stock_movements').insert({ ingredient_id: ingredientId, batch_id: id, movement_type: 'goods_in',
                                                         qty_delta: qty, unit_cost_iqd: cost, venue_id: VENUE_A_ID, at: receivedAt });
    if (mv.error) throw new Error(`goods_in failed: ${mv.error.message}`);
    return id;
  }

  async function openTab(tag: string): Promise<string> {
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, tag),
      p_label: `stores-${tag}-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(tab.ok, tab.errorMessage).toBe(true);
    return (tab.data as { tab_id: string }).tab_id;
  }

  it('10 cafe sales and 10 bakery batches of one ingredient at once: no deadlock, exact sums, one overdraft (I5)', async () => {
    // 760 g in two stores, 800 g wanted: the last of the twenty overdraws 40.
    const flour = await createTestIngredient(svc, 'طحين المخزنين', 'g');
    const batches = [await batchAt(flour, 'cafe', 380, 2, 60), await batchAt(flour, 'bakery', 380, 3, 30)];
    const menu = await createTestMenuItem(svc, 'stores-bread', 2_000);
    await addRecipeLine(svc, { variantId: menu.variantId }, flour, 40);
    const { data: dough, error: dErr } = await svc
      .from('ingredients')
      .insert({ kind: 'prepared', name_en: `Stores dough ${Date.now()}`, name_ar: 'عجينة', unit: 'g', venue_id: VENUE_A_ID })
      .select('id')
      .single();
    if (dErr) throw new Error(dErr.message);
    const doughId = (dough as { id: string }).id;
    const rl = await svc.from('recipe_lines').insert({ output_ingredient_id: doughId, ingredient_id: flour, qty: 40 });
    expect(rl.error).toBeNull();
    const tabId = await openTab('I5');

    const results = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        appRpc(cashier, 'till_add_items', {
          p_tab_id: tabId,
          p_items: [{ variant_id: menu.variantId, qty: 1 }],
          p_idempotency_key: testIdemKey('order.add'),
        }).then(outcome)),
      ...Array.from({ length: 10 }, () =>
        appRpc(manager, 'record_batch', {
          p_ingredient_id: doughId,
          p_qty: 1,
          p_venue_id: VENUE_A_ID,
          p_idempotency_key: testIdemKey('record_batch'),
        }).then(outcome)),
    ]);
    const failed = results.filter((x) => !x.ok).map((x) => x.errorMessage);
    expect(failed, 'no call fails, and none on a deadlock (40P01)').toEqual([]);

    const { data: moves } = await svc
      .from('stock_movements')
      .select('batch_id, qty_delta, movement_type, location')
      .eq('ingredient_id', flour)
      .neq('movement_type', 'goods_in');
    const m = moves as Array<{ batch_id: string | null; qty_delta: number; movement_type: string; location: string }>;
    expect(m.reduce((s, x) => s + Number(x.qty_delta), 0)).toBe(-800);
    expect(m.filter((x) => x.movement_type === 'sale_consumption').reduce((s, x) => s + Number(x.qty_delta), 0)).toBe(-400);
    expect(m.filter((x) => x.movement_type === 'production_consume').reduce((s, x) => s + Number(x.qty_delta), 0)).toBe(-400);
    const overdraft = m.filter((x) => x.batch_id === null);
    expect(overdraft.map((x) => Number(x.qty_delta))).toEqual([-40]);

    const { data: left } = await svc.from('stock_batches').select('id, qty_remaining').in('id', batches);
    for (const b of left as Array<{ qty_remaining: number }>) expect(Number(b.qty_remaining)).toBe(0);
    // I2 on committed rows: each batch holds what its movements say.
    for (const id of batches) {
      const { data: rows } = await svc.from('stock_movements').select('qty_delta').eq('batch_id', id);
      expect((rows as Array<{ qty_delta: number }>).reduce((s, x) => s + Number(x.qty_delta), 0), id).toBe(0);
    }

    const { data: alerts } = await svc
      .from('manager_alerts')
      .select('payload')
      .eq('kind', 'negative_stock')
      .eq('payload->>ingredient_id', flour);
    expect(alerts).toHaveLength(1);
    expect(Number((alerts![0] as { payload: { shortfall: number } }).payload.shortfall)).toBe(40);

    const settle = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId, p_method: 'cash', p_tendered_iqd: 20_000, p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(settle.ok, settle.errorMessage).toBe(true);
  });

  it.skipIf(!docker)('a production costs only what it consumed, even beside another production of the same ingredient', async () => {
    // Two doughs of 10 g flour each, flour at 5 IQD/g: each batch costs 50.
    const flour = await createTestIngredient(svc, 'طحين التكلفة', 'g');
    await batchAt(flour, 'bakery', 1000, 5, 60);
    const doughs: string[] = [];
    for (const n of ['a', 'b']) {
      const { data, error } = await svc
        .from('ingredients')
        .insert({ kind: 'prepared', name_en: `Stores cost dough ${n} ${Date.now()}`, name_ar: 'عجينة', unit: 'g', venue_id: VENUE_A_ID })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      doughs.push((data as { id: string }).id);
      const rl = await svc.from('recipe_lines').insert({ output_ingredient_id: (data as { id: string }).id, ingredient_id: flour, qty: 10 });
      expect(rl.error).toBeNull();
    }
    const produce = (dough: string) =>
      asStaff(SEED_STAFF_IDS.manager, `select app.record_production('${dough}', 1, null, null, 'bakery')`);
    const first = psqlSession(`
set application_name = 'stores-race-produce';
begin;
${produce(doughs[0]!)}
select pg_sleep(2);
commit;`);
    let second: Promise<string> | null = null;
    try {
      await waitFor(() => psql(`select count(*) from pg_stat_activity
                                 where application_name = 'stores-race-produce' and query like '%pg_sleep%'`) === '1');
      second = psqlSession(`
set application_name = 'stores-race-produce-2';
begin;
${produce(doughs[1]!)}
commit;`);
      await waitFor(() => psql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                                 where a.application_name = 'stores-race-produce-2' and not l.granted`) === '1');
      await first;
      await second;
    } finally {
      await first.catch(() => undefined);
      await second?.catch(() => undefined);
    }
    const { data: made } = await svc.from('stock_batches').select('ingredient_id, unit_cost_iqd').in('ingredient_id', doughs);
    expect((made as Array<{ unit_cost_iqd: number }>).map((b) => Number(b.unit_cost_iqd))).toEqual([50, 50]);
  });

  it('a refund goes back into the newest cafe batch, not a newer bakery one (D3, V20)', async () => {
    const syrup = await createTestIngredient(svc, 'شراب المخزنين', 'ml');
    const cafeBatch = await batchAt(syrup, 'cafe', 100, 5, 120);
    const bakeryBatch = await batchAt(syrup, 'bakery', 100, 9, 60);
    const menu = await createTestMenuItem(svc, 'stores-refund', 2_000);
    await addRecipeLine(svc, { variantId: menu.variantId }, syrup, 10);
    const tabId = await openTab('V20');
    const sale = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId, p_items: [{ variant_id: menu.variantId, qty: 1 }], p_idempotency_key: testIdemKey('order.add'),
    }).then(outcome);
    expect(sale.ok, sale.errorMessage).toBe(true);
    const { data: line } = await svc.from('order_items').select('id')
      .eq('order_id', (sale.data as { order_id: string }).order_id).single();
    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId, p_method: 'cash', p_tendered_iqd: 2_000, p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
    const refund = await appRpc(manager, 'refund', {
      p_payment_id: (settled.data as { payment_id: string }).payment_id,
      p_amount_iqd: 2_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'stores-test',
      p_items: [{ order_item_id: (line as { id: string }).id, qty: 1 }],
    }).then(outcome);
    expect(refund.ok, refund.errorMessage).toBe(true);

    const { data: back } = await svc.from('stock_movements')
      .select('batch_id, qty_delta, unit_cost_iqd, location')
      .eq('ingredient_id', syrup).eq('movement_type', 'refund_reversal');
    expect(back).toEqual([{ batch_id: cafeBatch, qty_delta: 10, unit_cost_iqd: 5, location: 'cafe' }]);
    const { data: batches } = await svc.from('stock_batches').select('id, qty_remaining').in('id', [cafeBatch, bakeryBatch]);
    const left = Object.fromEntries((batches as Array<{ id: string; qty_remaining: number }>).map((b) => [b.id, Number(b.qty_remaining)]));
    expect(left).toEqual({ [cafeBatch]: 100, [bakeryBatch]: 100 });
  });
});

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('waitFor: timed out');
}
