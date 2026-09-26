/**
 * stock_logs (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8 D4-D5,
 * §6.1): "Log stock", staff add what arrived to a store and never see a
 * cost; a manager prices it afterwards.
 *
 *   * the kinds and stores per role: the heads log what they buy (the head
 *     chef into the bakery by default), the desk the shop's stock in the cafe
 *     only, the cashier and MGMT both; prepared stock is never logged; the
 *     pack conversion; a same-key log counts once (I11);
 *   * I12 nothing a log returns carries money;
 *   * I15 cost_source is honest and the batch costs what was estimated: the
 *         last POSITIVE batch cost (a zero-cost synthetic batch after it is
 *         skipped), else the pack cost, else 0 marked none;
 *   * M6  bad lines are INVALID_ARGUMENT or INVALID_QTY before the internal
 *         is reached, never EMPTY_DELIVERY or INVALID_LINE;
 *   * I13 price_logged_stock revalues the line, its batch and its moved
 *         copies, not the movements already booked, and never touches a
 *         Goods in delivery (REF_NOT_FOUND hint delivery);
 *   * I16 shop stock never enters the bakery: a log, Goods in and a driver
 *         receipt all refuse it and write nothing;
 *   * V19 a log or a Goods in receipt into a store a manager is counting is
 *         STORE_BEING_COUNTED;
 *   * the audit carries counts only; barista, chef, waiter, assistant
 *     barista, driver, marketing and prep are refused;
 *   * (committed) a move listed against ingredient_id order, a
 *     price_logged_stock over both ingredients and two-ingredient sales run
 *     at once with no deadlock (I5, V15).
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
  DEV_PASSWORD,
  SEED_STAFF,
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
  RES,
  T,
  X,
  dockerReachable,
  moneyKeys,
  ok,
  refused,
  scenario,
} from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();
const run = (body: string[]) => scenario('sg', body);

const log = (location: string | null, lines: string, extra = '') =>
  `select app.log_stock(${location === null ? 'null' : `'${location}'`}, ${lines}${extra})`;
const ONE = (ing: string, qty: number | string, more = '') =>
  `jsonb_build_array(jsonb_build_object('ingredient_id', {{${ing}}}, 'qty', ${qty}${more}))`;

interface Logged {
  delivery_id: string;
  location: string;
  lines: Array<{ ingredient_id: string; qty: number; expiry_date: string | null }>;
}

describe.skipIf(!docker)('stores: logs (rolled-back transactions)', () => {
  it('each role logs its kinds into its stores, costed by estimate, and sees no cost (I11, I12, I15)', () => {
    const r = run([
      MK('hb', 'head_barista'), MK('hc', 'head_chef'),
      ING('beans', 'purchased', 'g', { packSize: 1000, packCost: 25000 }),
      ING('milk', 'purchased', 'ml'),
      ING('sugar', 'purchased', 'g', { packSize: 1000, packCost: 9000 }),
      ING('ball', 'retail', 'pc'),
      ING('dough', 'prepared', 'g'),
      // Sugar's last real cost is 4; a zero-cost batch (a refund restock or a
      // count surplus) came in after it.
      BATCH('sugar_old', 'sugar', 'cafe', 100, 4, null, 120),
      BATCH('sugar_zero', 'sugar', 'cafe', 10, 0, null, 10),
      T('hb', 'hb', log(null, `jsonb_build_array(
            jsonb_build_object('ingredient_id', {{beans}}, 'qty', 2, 'unit', 'pack'),
            jsonb_build_object('ingredient_id', {{milk}}, 'qty', 500),
            jsonb_build_object('ingredient_id', {{sugar}}, 'qty', 50, 'expiry_date', (current_date + 3)::text))`,
          `, 'from the market', {{venue}}, 'SG-1'`)),
      T('hb_replay', 'hb', log(null, `jsonb_build_array(
            jsonb_build_object('ingredient_id', {{beans}}, 'qty', 2, 'unit', 'pack'),
            jsonb_build_object('ingredient_id', {{milk}}, 'qty', 500),
            jsonb_build_object('ingredient_id', {{sugar}}, 'qty', 50, 'expiry_date', (current_date + 3)::text))`,
          `, 'from the market', {{venue}}, 'SG-1'`)),
      RES('d_hb', 'hb', 'delivery_id'),
      Q('booked', `select jsonb_agg(jsonb_build_object(
                     'ing', (select v.name from pg_temp.vars v where v.val = dl.ingredient_id::text),
                     'qty', dl.qty_received, 'cost', dl.unit_cost_iqd, 'source', dl.cost_source,
                     'batch_cost', b.unit_cost_iqd, 'batch_at', b.location, 'moved', m.unit_cost_iqd)
                     order by (select v.name from pg_temp.vars v where v.val = dl.ingredient_id::text))
                     from delivery_lines dl
                     join stock_batches b on b.delivery_line_id = dl.id
                     join stock_movements m on m.batch_id = b.id and m.movement_type = 'goods_in'
                    where dl.delivery_id = {{d_hb}}::uuid`),
      Q('delivery', `select jsonb_build_object('location', location, 'source', source, 'notes', notes,
                                               'deliveries', (select count(*) from deliveries d2 where d2.notes = 'from the market'))
                       from deliveries where id = {{d_hb}}::uuid`),
      Q('audit', `select jsonb_agg(jsonb_build_object('after', after, 'reason', reason_code)) from audit_log
                   where action = 'stock.log' and entity_id = {{d_hb}}`),
      T('hc', 'hc', log(null, ONE('milk', 100))),
      T('hc_cafe', 'hc', log(`cafe`, ONE('milk', 10))),
      T('cashier', 'cashier', log(null, ONE('ball', 6))),
      T('cashier_bak', 'cashier', log('bakery', ONE('beans', 1))),
      T('desk', 'desk', log(null, ONE('ball', 3))),
      T('mgr', 'manager', log(null, `jsonb_build_array(jsonb_build_object('ingredient_id', {{ball}}, 'qty', 1),
                                                       jsonb_build_object('ingredient_id', {{beans}}, 'qty', 1))`)),
      T('desk_bak', 'desk', log('bakery', ONE('ball', 3))),
      T('desk_beans', 'desk', log(null, ONE('beans', 1))),
      T('hb_ball', 'hb', log(null, ONE('ball', 1))),
      T('cashier_ball_bak', 'cashier', log('bakery', ONE('ball', 6))),
      T('mgr_ball_bak', 'manager', log('bakery', ONE('ball', 1))),
      T('prepared', 'manager', log(null, ONE('dough', 1))),
    ]);
    const hb = ok<Logged>(r, 'hb');
    expect(Object.keys(hb).sort()).toEqual(['delivery_id', 'lines', 'location']);
    expect(hb.location).toBe('cafe');
    expect(hb.lines.map((l) => Object.keys(l).sort())).toEqual(Array(3).fill(['expiry_date', 'ingredient_id', 'qty']));
    expect(ok(r, 'hb_replay')).toEqual({ ...hb, duplicate: true });
    expect(ok(r, 'booked')).toEqual([
      // Two packs of 1000 g at the pack cost, 25000 / 1000.
      { ing: 'beans', qty: 2000, cost: 25, source: 'pack', batch_cost: 25, batch_at: 'cafe', moved: 25 },
      { ing: 'milk', qty: 500, cost: 0, source: 'none', batch_cost: 0, batch_at: 'cafe', moved: 0 },
      // The last positive cost, not the newer zero one, nor the pack cost.
      { ing: 'sugar', qty: 50, cost: 4, source: 'last_batch', batch_cost: 4, batch_at: 'cafe', moved: 4 },
    ]);
    expect(ok(r, 'delivery')).toEqual({ location: 'cafe', source: 'staff_log', notes: 'from the market', deliveries: 1 });
    expect(ok(r, 'audit')).toEqual([{
      after: { location: 'cafe', lines: 3, cost_sources: { last_batch: 1, pack: 1, none: 1 } },
      reason: null,
    }]);

    expect(ok<Logged>(r, 'hc').location).toBe('bakery');
    expect(ok<Logged>(r, 'hc_cafe').location).toBe('cafe');
    expect(ok<Logged>(r, 'cashier').location).toBe('cafe');
    expect(ok<Logged>(r, 'cashier_bak').location).toBe('bakery');
    expect(ok<Logged>(r, 'desk').location).toBe('cafe');
    expect(ok<Logged>(r, 'mgr').lines).toHaveLength(2);
    for (const label of ['hb', 'hc', 'hc_cafe', 'cashier', 'cashier_bak', 'desk', 'mgr']) {
      expect(moneyKeys(ok(r, label)), label).toEqual([]);
    }
    expect(refused(r, 'desk_bak')).toBe('FORBIDDEN:location');
    for (const label of ['desk_beans', 'hb_ball', 'cashier_ball_bak', 'mgr_ball_bak', 'prepared']) {
      expect(refused(r, label), label).toBe('INVALID_ARGUMENT:kind');
    }
  });

  it('bad lines stop before the internal: never EMPTY_DELIVERY or INVALID_LINE (M6); other roles are refused', () => {
    const others = { bar: 'barista', chef: 'chef', wtr: 'waiter', ab: 'assistant_barista', drv: 'driver', mkt: 'marketing' };
    const r = run([
      MK('hb', 'head_barista'),
      ...Object.entries(others).map(([k, role]) => MK(k, role)),
      ING('beans', 'purchased', 'g'),
      ING('far', 'purchased', 'g', { venue: OTHER_VENUE }),
      KEEP('off', `insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
                   values ('purchased', 'SG off', 'متوقف', 'g', false, {{venue}}) returning id::text`),
      T('empty', 'hb', log(null, `'[]'::jsonb`)),
      T('null', 'hb', `select app.log_stock()`),
      T('scalar', 'hb', log(null, `'{}'::jsonb`)),
      T('too_many', 'hb', log(null, `(select jsonb_agg(jsonb_build_object('ingredient_id', {{beans}}, 'qty', 1)) from generate_series(1, 51))`)),
      T('repeat', 'hb', log(null, `jsonb_build_array(jsonb_build_object('ingredient_id', {{beans}}, 'qty', 1),
                                                     jsonb_build_object('ingredient_id', {{beans}}, 'qty', 1))`)),
      T('not_object', 'hb', log(null, `'["x"]'::jsonb`)),
      T('bad_unit', 'hb', log(null, ONE('beans', 1, `, 'unit', 'kg'`))),
      T('no_pack', 'hb', log(null, ONE('beans', 1, `, 'unit', 'pack'`))),
      T('zero', 'hb', log(null, ONE('beans', 0))),
      T('negative', 'hb', log(null, ONE('beans', -5))),
      T('huge', 'hb', log(null, ONE('beans', 1000000000))),
      T('text_qty', 'hb', log(null, ONE('beans', `'5'`))),
      T('bad_date', 'hb', log(null, ONE('beans', 1, `, 'expiry_date', 'soon'`))),
      T('old_date', 'hb', log(null, ONE('beans', 1, `, 'expiry_date', (current_date - 1)::text`))),
      T('far', 'hb', log(null, ONE('far', 1))),
      T('off', 'hb', log(null, ONE('off', 1))),
      T('not_uuid', 'hb', log(null, `'[{"ingredient_id": "beans", "qty": 1}]'::jsonb`)),
      T('long_note', 'hb', log(null, ONE('beans', 1), `, repeat('x', 201)`)),
      T('bad_loc', 'hb', log('kitchen', ONE('beans', 1))),
      T('far_venue', 'manager', log(null, ONE('beans', 1), `, null, {{other_venue}}`)),
      ...[...Object.keys(others), 'prep'].map((who) => T(`deny_${who}`, who, log(null, ONE('beans', 1)))),
      Q('written', `select to_jsonb(count(*)) from delivery_lines where ingredient_id = {{beans}}::uuid`),
    ]);
    for (const label of ['empty', 'null', 'scalar', 'too_many', 'repeat', 'not_object']) {
      expect(refused(r, label), label).toBe('INVALID_ARGUMENT:lines');
    }
    expect(refused(r, 'bad_unit')).toBe('INVALID_ARGUMENT:unit');
    expect(refused(r, 'no_pack')).toBe('INVALID_ARGUMENT:unit');
    for (const label of ['zero', 'negative', 'huge', 'text_qty']) expect(refused(r, label), label).toBe('INVALID_QTY');
    expect(refused(r, 'bad_date')).toBe('INVALID_ARGUMENT:expiry_date');
    expect(refused(r, 'old_date')).toBe('INVALID_ARGUMENT:expiry_date');
    for (const label of ['far', 'off', 'not_uuid']) expect(refused(r, label), label).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'bad_loc')).toBe('INVALID_ARGUMENT:location');
    expect(refused(r, 'far_venue')).toBe('FORBIDDEN');
    for (const who of [...Object.keys(others), 'prep']) expect(refused(r, `deny_${who}`), who).toBe('FORBIDDEN');
    expect(ok(r, 'written')).toBe(0);
  });

  it('a manager prices a staff log: the line, its batch and its moved copies, never a Goods in delivery (I13)', () => {
    const r = run([
      MK('hb', 'head_barista'), MK('wtr', 'waiter'),
      ING('beans', 'purchased', 'g'),
      T('log', 'hb', log(null, ONE('beans', 1000))),
      RES('d_log', 'log', 'delivery_id'),
      KEEP('line', `select id::text from delivery_lines where delivery_id = {{d_log}}::uuid`),
      KEEP('root', `select b.id::text from stock_batches b where b.delivery_line_id = {{line}}::uuid`),
      T('move', 'wtr', `select app.transfer_stock('cafe', 'bakery', ${ONE('beans', 300)}, {{venue}})`),
      X(`select app.consume_fefo({{beans}}::uuid, 100, 'sale_consumption')`),
      T('price', 'manager', `select app.price_logged_stock({{d_log}}::uuid,
                               jsonb_build_array(jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', 12.5)))`),
      T('price_again', 'owner', `select app.price_logged_stock({{d_log}}::uuid,
                                   jsonb_build_array(jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', 12.5)))`),
      Q('after', `select jsonb_build_object(
                    'line', (select jsonb_build_array(unit_cost_iqd, cost_source) from delivery_lines where id = {{line}}::uuid),
                    'batches', (select jsonb_agg(jsonb_build_array(location, unit_cost_iqd) order by location)
                                  from stock_batches where id = {{root}}::uuid or origin_batch_id = {{root}}::uuid),
                    'booked', (select jsonb_agg(distinct unit_cost_iqd) from stock_movements where ingredient_id = {{beans}}::uuid))`),
      Q('audit', `select jsonb_agg(jsonb_build_object('before', before, 'after', after) order by id) from audit_log
                   where action = 'stock.price_log' and entity_id = {{d_log}}`),
      // Goods in is not a staff log.
      T('gi', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{beans}}', qty_received: 10, unit_cost_iqd: 9 }])})`),
      RES('d_gi', 'gi', 'delivery_id'),
      KEEP('gi_line', `select id::text from delivery_lines where delivery_id = {{d_gi}}::uuid`),
      T('price_gi', 'manager', `select app.price_logged_stock({{d_gi}}::uuid,
                                  jsonb_build_array(jsonb_build_object('delivery_line_id', {{gi_line}}, 'unit_cost_iqd', 1)))`),
      T('other_line', 'manager', `select app.price_logged_stock({{d_log}}::uuid,
                                    jsonb_build_array(jsonb_build_object('delivery_line_id', {{gi_line}}, 'unit_cost_iqd', 1)))`),
      T('unknown', 'manager', `select app.price_logged_stock('00000000-0000-4000-8000-000000000000'::uuid, '[]'::jsonb)`),
      KEEP('d_far', `insert into deliveries (venue_id, received_by, location, source)
                     values ({{other_venue}}::uuid, {{manager}}::uuid, 'cafe', 'staff_log') returning id::text`),
      T('far', 'owner', `select app.price_logged_stock({{d_far}}::uuid, '[]'::jsonb)`),
      T('empty', 'manager', `select app.price_logged_stock({{d_log}}::uuid, '[]'::jsonb)`),
      T('repeat', 'manager', `select app.price_logged_stock({{d_log}}::uuid, jsonb_build_array(
                                jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', 1),
                                jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', 2)))`),
      T('negative', 'manager', `select app.price_logged_stock({{d_log}}::uuid,
                                  jsonb_build_array(jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', -1)))`),
      T('huge', 'manager', `select app.price_logged_stock({{d_log}}::uuid,
                              jsonb_build_array(jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', 1000000000)))`),
      T('text_cost', 'manager', `select app.price_logged_stock({{d_log}}::uuid,
                                   jsonb_build_array(jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', '5')))`),
      ...(['hb', 'wtr', 'cashier', 'desk'] as const).map((who) =>
        T(`deny_${who}`, who, `select app.price_logged_stock({{d_log}}::uuid,
                                jsonb_build_array(jsonb_build_object('delivery_line_id', {{line}}, 'unit_cost_iqd', 1)))`)),
    ]);
    ok(r, 'move');
    expect(ok(r, 'price')).toMatchObject({ updated: 1 });
    expect(ok(r, 'price_again')).toMatchObject({ updated: 1 });
    // The shelf is revalued, the ledger keeps what was booked at the time.
    expect(ok(r, 'after')).toEqual({
      line: [12.5, 'entered'],
      batches: [['cafe', 12.5], ['bakery', 12.5]],
      booked: [0],
    });
    expect(ok(r, 'audit')).toEqual([
      { before: { lines: [{ delivery_line_id: expect.any(String), unit_cost_iqd: 0 }] },
        after: { lines: [{ delivery_line_id: expect.any(String), unit_cost_iqd: 12.5 }] } },
      { before: { lines: [{ delivery_line_id: expect.any(String), unit_cost_iqd: 12.5 }] },
        after: { lines: [{ delivery_line_id: expect.any(String), unit_cost_iqd: 12.5 }] } },
    ]);
    expect(refused(r, 'price_gi')).toBe('REF_NOT_FOUND:delivery');
    expect(refused(r, 'other_line')).toBe('REF_NOT_FOUND:lines');
    expect(refused(r, 'unknown')).toBe('REF_NOT_FOUND:delivery');
    expect(refused(r, 'far')).toBe('REF_NOT_FOUND:delivery');
    expect(refused(r, 'empty')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'repeat')).toBe('INVALID_ARGUMENT:lines');
    for (const label of ['negative', 'huge', 'text_cost']) {
      expect(refused(r, label), label).toBe('INVALID_ARGUMENT:unit_cost_iqd');
    }
    for (const who of ['hb', 'wtr', 'cashier', 'desk']) expect(refused(r, `deny_${who}`), who).toBe('FORBIDDEN');
  });

  it('shop stock never enters the bakery: a log, Goods in and a driver receipt refuse it and write nothing (I16)', () => {
    const r = run([
      MK('drv', 'driver'),
      ING('ball', 'retail', 'pc'),
      KEEP('purchase', `insert into purchases (venue_id, staff_id, bought_at, total_iqd)
                        values ({{venue}}::uuid, {{drv}}::uuid, now(), 9000) returning id::text`),
      KEEP('pline', `insert into purchase_lines (purchase_id, ingredient_id, qty, price_iqd)
                     values ({{purchase}}::uuid, {{ball}}::uuid, 3, 9000) returning id::text`),
      T('log', 'manager', log('bakery', ONE('ball', 3))),
      T('gi', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{ball}}', qty_received: 3, unit_cost_iqd: 3000 }])},
                            null, null, null, null, null, 'bakery')`),
      T('driver', 'manager', `select app.receive_purchase({{purchase}}::uuid,
                                jsonb_build_array(jsonb_build_object('purchase_line_id', {{pline}}, 'qty_received', 3)),
                                null, null, null, 'bakery')`),
      Q('written', `select jsonb_build_array((select count(*) from delivery_lines where ingredient_id = {{ball}}::uuid),
                                             (select count(*) from stock_batches where ingredient_id = {{ball}}::uuid),
                                             (select status from purchases where id = {{purchase}}::uuid))`),
      T('driver_cafe', 'manager', `select app.receive_purchase({{purchase}}::uuid,
                                     jsonb_build_array(jsonb_build_object('purchase_line_id', {{pline}}, 'qty_received', 3)),
                                     null, null, null, 'cafe')`),
      Q('received', `select jsonb_build_array((select location from stock_batches where ingredient_id = {{ball}}::uuid),
                                              (select after->>'location' from audit_log where action = 'purchase.receive'
                                                  and entity_id = {{purchase}}))`),
    ]);
    for (const label of ['log', 'gi', 'driver']) expect(refused(r, label), label).toBe('INVALID_ARGUMENT:kind');
    expect(ok(r, 'written')).toEqual([0, 0, 'to_receive']);
    ok(r, 'driver_cafe');
    expect(ok(r, 'received')).toEqual(['cafe', 'cafe']);
  });

  it('a log or a Goods in receipt into a store a manager is counting is refused (V19)', () => {
    const r = run([
      MK('hb', 'head_barista'),
      ING('beans', 'purchased', 'g'),
      T('count', 'manager', `select app.start_count('cafe')`),
      RES('count_id', 'count', 'count_id'),
      T('log_cafe', 'hb', log(null, ONE('beans', 1))),
      T('log_bakery', 'hb', log('bakery', ONE('beans', 1))),
      T('gi_cafe', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{beans}}', qty_received: 1, unit_cost_iqd: 1 }])})`),
      T('discard', 'manager', `select app.discard_count({{count_id}}::uuid)`),
      T('log_after', 'hb', log(null, ONE('beans', 1))),
    ]);
    expect(refused(r, 'log_cafe')).toBe('STORE_BEING_COUNTED:cafe');
    ok(r, 'log_bakery');
    expect(refused(r, 'gi_cafe')).toBe('STORE_BEING_COUNTED:cafe');
    ok(r, 'discard');
    ok(r, 'log_after');
  });
});

// ── committed, over HTTP: every writer at once ─────────────────────────────
describe.skipIf(!up)('stores: logs under load (committed)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let waiter: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    const email = `stores-log-waiter-${Date.now()}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const ins = await svc.from('staff').insert({ id: data.user.id, display_name: 'Stores log waiter', role: 'waiter', is_active: true });
    if (ins.error) throw new Error(ins.error.message);
    waiter = await signedInClient(email);
  });

  it('a move against ingredient order, a price over both and two-ingredient sales at once: no deadlock (I5, V15)', async () => {
    const a = await createTestIngredient(svc, 'بن السجل', 'g');
    const b = await createTestIngredient(svc, 'هيل السجل', 'g');
    const [lo, hi] = [a, b].sort();
    // All the stock is one staff log, so the price, the moves and the sales
    // all reach the same batches.
    const logged = await appRpc(manager, 'log_stock', {
      p_lines: [{ ingredient_id: hi, qty: 10_000 }, { ingredient_id: lo, qty: 10_000 }],
      p_venue_id: VENUE_A_ID,
      p_idempotency_key: testIdemKey('stock.log'),
    }).then(outcome);
    expect(logged.ok, logged.errorMessage).toBe(true);
    const deliveryId = (logged.data as { delivery_id: string }).delivery_id;
    const { data: lines } = await svc.from('delivery_lines').select('id, ingredient_id').eq('delivery_id', deliveryId);
    const lineOf = Object.fromEntries((lines as Array<{ id: string; ingredient_id: string }>).map((l) => [l.ingredient_id, l.id]));
    const menu = await createTestMenuItem(svc, 'stores-log-two', 2_000);
    await addRecipeLine(svc, { variantId: menu.variantId }, hi!, 10);
    await addRecipeLine(svc, { variantId: menu.variantId }, lo!, 10);
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'V15-log'), p_label: `stores-V15-log-${Date.now()}`, p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(tab.ok, tab.errorMessage).toBe(true);
    const tabId = (tab.data as { tab_id: string }).tab_id;

    const results = await Promise.all([
      ...Array.from({ length: 4 }, () =>
        appRpc(waiter, 'transfer_stock', {
          p_from: 'cafe', p_to: 'bakery',
          p_lines: [{ ingredient_id: hi, qty: 100 }, { ingredient_id: lo, qty: 100 }],
          p_venue_id: VENUE_A_ID, p_idempotency_key: testIdemKey('stock.move'),
        }).then(outcome)),
      ...Array.from({ length: 4 }, (_, i) =>
        appRpc(manager, 'price_logged_stock', {
          p_delivery_id: deliveryId,
          p_lines: [{ delivery_line_id: lineOf[hi!], unit_cost_iqd: 3 + i }, { delivery_line_id: lineOf[lo!], unit_cost_iqd: 4 + i }],
        }).then(outcome)),
      ...Array.from({ length: 10 }, () =>
        appRpc(cashier, 'till_add_items', {
          p_tab_id: tabId, p_items: [{ variant_id: menu.variantId, qty: 1 }], p_idempotency_key: testIdemKey('order.add'),
        }).then(outcome)),
    ]);
    expect(results.filter((x) => !x.ok).map((x) => x.errorMessage), 'none fails, and none on a deadlock (40P01)').toEqual([]);

    for (const id of [lo!, hi!]) {
      const { data } = await svc.from('stock_movements').select('qty_delta, location').eq('ingredient_id', id);
      const m = data as Array<{ qty_delta: number; location: string }>;
      expect(m.reduce((s, x) => s + Number(x.qty_delta), 0)).toBe(10_000 - 100);
      expect(m.filter((x) => x.location === 'bakery').reduce((s, x) => s + Number(x.qty_delta), 0)).toBe(400);
      // One price wins for the line, its batch and every copy.
      const { data: batches } = await svc.from('stock_batches').select('unit_cost_iqd').eq('ingredient_id', id);
      expect(new Set((batches as Array<{ unit_cost_iqd: number }>).map((x) => Number(x.unit_cost_iqd))).size).toBe(1);
    }
    const settle = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId, p_method: 'cash', p_tendered_iqd: 20_000, p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(settle.ok, settle.errorMessage).toBe(true);
  });
});
