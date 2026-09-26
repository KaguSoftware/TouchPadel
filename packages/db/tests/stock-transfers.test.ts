/**
 * stock_transfers (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8
 * D6, §6.1): Hasan moves stock between the cafe and the bakery.
 *
 *   * both directions, split FEFO over the source's batches, one zero-sum
 *     movement pair per slice; a ping-pong keeps origin_batch_id at the root;
 *   * I1  the ledger is the truth: every transfer:<id> group sums to 0, and
 *         the stores' ledgers sum to the venue's;
 *   * I4  a move changes neither the venue's on-hand nor its stock value,
 *         and a move past the source's batches (TRANSFER_SHORT) writes
 *         nothing;
 *   * I8  a move keeps expiry, received_at and unit cost, so margins
 *         (v_item_cogs), a release's cost (release_cost) and the latest-batch
 *         cost that price_promo_numbers reads are the same before and after;
 *   * I11 a same-key move changes stock once;
 *   * I14 nothing moves into or out of a store, and no Goods in or driver
 *         receipt lands there, while a manager counts it; a waiting phone
 *         count holds nothing;
 *   * shop stock, the same store, an unknown store and bad lines are refused;
 *     the waiter, the manager and the owner move; everyone else is refused;
 *     the moves are MGMT's to read;
 *   * (committed) a two-line move listed against ingredient_id order runs
 *     beside two-ingredient sales with no deadlock (I5, V15); a sale that
 *     waits for a move in flight takes the moved stock and never overdraws
 *     while the venue holds it (I6); a two-item order whose items run against
 *     ingredient order meets a two-line move with no deadlock (V15); and a
 *     start_count waits on the count lock for a move in flight (M5).
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
  SEED_STAFF_IDS,
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
  asStaff,
  dockerReachable,
  moneyKeys,
  ok,
  psql,
  psqlSession,
  refused,
  scenario,
} from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();
const run = (body: string[]) => scenario('st', body);

const move = (from: string, to: string, lines: string, key = 'null') =>
  `select app.transfer_stock('${from}', '${to}', ${lines}, {{venue}}, ${key})`;
const ONE = (ing: string, qty: number | string, extra = '') =>
  `jsonb_build_array(jsonb_build_object('ingredient_id', {{${ing}}}, 'qty', ${qty}${extra}))`;
/** Venue totals: on-hand and stock value (qty_remaining × unit cost). */
const TOTALS = (label: string, ing: string) =>
  Q(label, `select jsonb_build_object('on_hand', coalesce(sum(qty_remaining), 0),
                                      'value', coalesce(sum(qty_remaining * unit_cost_iqd), 0))
              from stock_batches where ingredient_id = {{${ing}}}::uuid and qty_remaining > 0`);

describe.skipIf(!docker)('stores: transfers (rolled-back transactions)', () => {
  it('moves both ways, split FEFO, one zero-sum pair per slice (I1, I4, I11)', () => {
    const r = run([
      MK('wtr', 'waiter'),
      ING('milk', 'purchased', 'ml', { packSize: 1000 }),
      BATCH('m1', 'milk', 'cafe', 100, 2, 3, 120),
      BATCH('m2', 'milk', 'cafe', 300, 3, 5, 60),
      TOTALS('before', 'milk'),
      T('move', 'wtr', move('cafe', 'bakery', ONE('milk', 250), `'ST-1'`)),
      T('replay', 'wtr', move('cafe', 'bakery', ONE('milk', 250), `'ST-1'`)),
      RES('t1', 'move', 'transfer_id'),
      T('back', 'manager', move('bakery', 'cafe', ONE('milk', 120))),
      RES('t2', 'back', 'transfer_id'),
      T('pack', 'owner', move('cafe', 'bakery', ONE('milk', 0.1, `, 'unit', 'pack'`))),
      TOTALS('after', 'milk'),
      Q('batches', `select jsonb_agg(jsonb_build_object(
                      'label', (select v.name from pg_temp.vars v where v.val = b.id::text),
                      'root', (select v.name from pg_temp.vars v where v.val = b.origin_batch_id::text),
                      'location', b.location, 'qty', b.qty_remaining, 'cost', b.unit_cost_iqd,
                      'same_dates', (b.expiry_date is not distinct from o.expiry_date and b.received_at = o.received_at))
                      order by b.location, b.qty_received desc, b.id)
                      from stock_batches b
                      left join stock_batches o on o.id = coalesce(b.origin_batch_id, b.id)
                     where b.ingredient_id = {{milk}}::uuid`),
      Q('pairs', `select coalesce(jsonb_agg(x), '[]') from (select reason_code, sum(qty_delta) as s from stock_movements
                   where ingredient_id = {{milk}}::uuid and movement_type = 'transfer'
                   group by reason_code having sum(qty_delta) <> 0) x`),
      Q('first_move', `select jsonb_agg(jsonb_build_object(
                         'batch', (select v.name from pg_temp.vars v where v.val = m.batch_id::text),
                         'location', m.location, 'qty', m.qty_delta) order by m.id)
                         from stock_movements m where m.reason_code = 'transfer:' || {{t1}}`),
      Q('ledger', `select jsonb_build_object(
                     'venue', (select sum(qty_delta) from stock_movements where ingredient_id = {{milk}}::uuid),
                     'stores', (select sum(theoretical) from v_stock_by_location where ingredient_id = {{milk}}::uuid),
                     'bakery', (select sum(qty_delta) from stock_movements where ingredient_id = {{milk}}::uuid and location = 'bakery'))`),
      Q('rows', `select jsonb_build_object(
                   'transfers', (select jsonb_agg(jsonb_build_object('from', t.from_location, 'to', t.to_location) order by x.n)
                                   from stock_transfers t
                                   join (values ({{t1}}::uuid, 1), ({{t2}}::uuid, 2)) x(id, n) on x.id = t.id),
                   'lines', (select jsonb_agg(qty order by qty) from stock_transfer_lines where transfer_id in ({{t1}}::uuid, {{t2}}::uuid)))`),
      Q('audit', `select jsonb_agg(after order by id) from audit_log where action = 'stock.transfer' and entity_id = {{t1}}`),
      // Past what the source's batches hold: refused, and nothing written.
      Q('n_before', `select jsonb_build_array((select count(*) from stock_transfers), (select count(*) from stock_movements),
                                              (select sum(qty_remaining) from stock_batches where ingredient_id = {{milk}}::uuid))`),
      T('short', 'wtr', move('bakery', 'cafe', ONE('milk', 1000))),
      Q('milk_id', `select to_jsonb({{milk}}::text)`),
      Q('n_after', `select jsonb_build_array((select count(*) from stock_transfers), (select count(*) from stock_movements),
                                             (select sum(qty_remaining) from stock_batches where ingredient_id = {{milk}}::uuid))`),
    ]);
    const first = ok<Record<string, unknown>>(r, 'move');
    expect(Object.keys(first).sort()).toEqual(['from', 'lines', 'moved_at', 'to', 'transfer_id']);
    expect(first).toMatchObject({ from: 'cafe', to: 'bakery', lines: [{ qty: 250 }] });
    expect(moneyKeys(first)).toEqual([]);
    expect(ok(r, 'replay')).toEqual({ ...first, duplicate: true });
    ok(r, 'back');
    ok(r, 'pack');
    // I4: the venue's on-hand and stock value are the same.
    expect(ok(r, 'after')).toEqual(ok(r, 'before'));
    // FEFO: all of m1 (expiring first), then 150 of m2; minus at the cafe, plus at the bakery.
    expect(ok<Array<{ batch: string | null; location: string; qty: number }>>(r, 'first_move').map((m) => [m.location, m.qty]))
      .toEqual([['cafe', -100], ['bakery', 100], ['cafe', -150], ['bakery', 150]]);
    expect(ok<Array<{ batch: string }>>(r, 'first_move')[0]!.batch).toBe('m1');
    // I1: every move sums to 0, and the stores' ledgers are the venue's.
    expect(ok(r, 'pairs')).toEqual([]);
    const ledger = ok<{ venue: number; stores: number; bakery: number }>(r, 'ledger');
    expect(Number(ledger.stores)).toBe(Number(ledger.venue));
    expect(Number(ledger.bakery)).toBe(250 - 120 + 100);
    // Every copy keeps its root's dates and cost, and names the root even
    // after a round trip (the bakery copy of m1 came back to the cafe).
    const batches = ok<Array<{ label: string | null; root: string | null; location: string; qty: number; cost: number; same_dates: boolean }>>(r, 'batches');
    expect(batches.every((b) => b.same_dates)).toBe(true);
    expect(batches.filter((b) => b.label === null).map((b) => b.root).sort()).toEqual(['m1', 'm1', 'm1', 'm2', 'm2']);
    expect(batches.filter((b) => b.root === 'm1').every((b) => Number(b.cost) === 2)).toBe(true);
    expect(batches.filter((b) => b.root === 'm2').every((b) => Number(b.cost) === 3)).toBe(true);
    expect(ok(r, 'rows')).toEqual({
      transfers: [{ from: 'cafe', to: 'bakery' }, { from: 'bakery', to: 'cafe' }],
      lines: [120, 250],
    });
    expect(ok(r, 'audit')).toEqual([{ from: 'cafe', to: 'bakery', lines: 1, batches: 2 }]);
    // The bakery holds 250 - 120 + 100: the detail says so, for the phone.
    expect(refused(r, 'short')).toBe(`TRANSFER_SHORT:${ok<string>(r, 'milk_id')}`);
    expect(r.short!.detail).toBe('230');
    expect(ok(r, 'n_after')).toEqual(ok(r, 'n_before'));
  });

  it('refuses shop stock, the same store, bad lines, and everyone but the waiter and MGMT', () => {
    const others = { hb: 'head_barista', bar: 'barista', ab: 'assistant_barista', hc: 'head_chef', chef: 'chef',
                     drv: 'driver', mkt: 'marketing' };
    const r = run([
      MK('wtr', 'waiter'),
      ...Object.entries(others).map(([k, role]) => MK(k, role)),
      ING('ball', 'retail', 'pc'),
      ING('flour', 'purchased', 'g'),
      ING('dough', 'prepared', 'g'),
      ING('far', 'purchased', 'g', { venue: OTHER_VENUE }),
      BATCH('ball_c', 'ball', 'cafe', 10, 9000),
      BATCH('flour_c', 'flour', 'cafe', 100, 2),
      BATCH('dough_b', 'dough', 'bakery', 40, 5),
      T('retail', 'wtr', move('cafe', 'bakery', ONE('ball', 1))),
      T('same', 'wtr', move('cafe', 'cafe', ONE('flour', 1))),
      T('unknown', 'wtr', move('cafe', 'kitchen', ONE('flour', 1))),
      T('no_from', 'wtr', `select app.transfer_stock(null, 'bakery', ${ONE('flour', 1)})`),
      T('empty', 'wtr', move('cafe', 'bakery', `'[]'::jsonb`)),
      T('too_many', 'wtr', move('cafe', 'bakery', `(select jsonb_agg(jsonb_build_object('ingredient_id', {{flour}}, 'qty', 1)) from generate_series(1, 51))`)),
      T('repeat', 'wtr', move('cafe', 'bakery', `jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'qty', 1),
                                                                   jsonb_build_object('ingredient_id', {{flour}}, 'qty', 2))`)),
      T('not_object', 'wtr', move('cafe', 'bakery', `'[1]'::jsonb`)),
      T('bad_unit', 'wtr', move('cafe', 'bakery', ONE('flour', 1, `, 'unit', 'kg'`))),
      T('no_pack', 'wtr', move('cafe', 'bakery', ONE('flour', 1, `, 'unit', 'pack'`))),
      T('zero', 'wtr', move('cafe', 'bakery', ONE('flour', 0))),
      T('huge', 'wtr', move('cafe', 'bakery', ONE('flour', 1000000000))),
      T('text_qty', 'wtr', move('cafe', 'bakery', ONE('flour', `'1'`))),
      T('far', 'wtr', move('cafe', 'bakery', ONE('far', 1))),
      T('not_uuid', 'wtr', move('cafe', 'bakery', `'[{"ingredient_id": "flour", "qty": 1}]'::jsonb`)),
      T('far_venue', 'manager', `select app.transfer_stock('cafe', 'bakery', ${ONE('flour', 1)}, {{other_venue}})`),
      // Prepared stock moves (the bakery's desserts to the display).
      T('prepared', 'wtr', move('bakery', 'cafe', ONE('dough', 10))),
      ...[...Object.keys(others), 'cashier', 'desk', 'prep'].map((who) => T(`deny_${who}`, who, move('cafe', 'bakery', ONE('flour', 1)))),
      T('mgr', 'manager', move('cafe', 'bakery', ONE('flour', 1))),
      T('own', 'owner', move('cafe', 'bakery', ONE('flour', 1))),
      T('read_wtr', 'wtr', `select to_jsonb(count(*)) from stock_transfers`),
      T('read_wtr_lines', 'wtr', `select to_jsonb(count(*)) from stock_transfer_lines`),
      T('read_mgr', 'manager', `select to_jsonb(count(*)) from stock_transfers t where t.moved_by = {{wtr}}::uuid`),
      T('read_mgr_lines', 'manager', `select to_jsonb(count(*)) from stock_transfer_lines l join stock_transfers t on t.id = l.transfer_id
                                       where t.moved_by = {{wtr}}::uuid`),
      T('write_mgr', 'manager', `insert into stock_transfers (venue_id, from_location, to_location, moved_by)
                                 values ({{venue}}::uuid, 'cafe', 'bakery', {{manager}}::uuid) returning to_jsonb(id)`),
    ]);
    expect(refused(r, 'retail')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'same')).toBe('INVALID_ARGUMENT:location');
    expect(refused(r, 'unknown')).toBe('INVALID_ARGUMENT:location');
    expect(refused(r, 'no_from')).toBe('INVALID_ARGUMENT:location');
    for (const label of ['empty', 'too_many', 'repeat', 'not_object']) expect(refused(r, label), label).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'bad_unit')).toBe('INVALID_ARGUMENT:unit');
    expect(refused(r, 'no_pack')).toBe('INVALID_ARGUMENT:unit');
    for (const label of ['zero', 'huge', 'text_qty']) expect(refused(r, label), label).toBe('INVALID_QTY');
    expect(refused(r, 'far')).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'not_uuid')).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'far_venue')).toBe('FORBIDDEN');
    expect(ok(r, 'prepared')).toMatchObject({ from: 'bakery', to: 'cafe' });
    for (const who of [...Object.keys(others), 'cashier', 'desk', 'prep']) expect(refused(r, `deny_${who}`), who).toBe('FORBIDDEN');
    ok(r, 'mgr');
    ok(r, 'own');
    expect(ok(r, 'read_wtr')).toBe(0);
    expect(ok(r, 'read_wtr_lines')).toBe(0);
    expect(ok(r, 'read_mgr')).toBe(1);
    expect(ok(r, 'read_mgr_lines')).toBe(1);
    expect(refused(r, 'write_mgr')).toMatch(/permission denied/);
  });

  it('nothing moves or lands in a store a manager is counting; a waiting phone count holds nothing (I14)', () => {
    const r = run([
      MK('wtr', 'waiter'), MK('hc', 'head_chef'), MK('drv', 'driver'),
      ING('flour', 'purchased', 'g'),
      BATCH('f_cafe', 'flour', 'cafe', 500, 2),
      BATCH('f_bak', 'flour', 'bakery', 200, 2),
      // A driver's purchase of flour, waiting to be received.
      KEEP('purchase', `insert into purchases (venue_id, staff_id, bought_at, total_iqd)
                        values ({{venue}}::uuid, {{drv}}::uuid, now(), 2000) returning id::text`),
      KEEP('pline', `insert into purchase_lines (purchase_id, ingredient_id, qty, price_iqd)
                     values ({{purchase}}::uuid, {{flour}}::uuid, 1000, 2000) returning id::text`),
      T('count', 'manager', `select app.start_count('bakery')`),
      RES('count_id', 'count', 'count_id'),
      T('into', 'wtr', move('cafe', 'bakery', ONE('flour', 10))),
      T('out_of', 'wtr', move('bakery', 'cafe', ONE('flour', 10))),
      T('gi', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{flour}}', qty_received: 10, unit_cost_iqd: 2 }])},
                            null, null, null, null, null, 'bakery')`),
      T('driver', 'manager', `select app.receive_purchase({{purchase}}::uuid,
                                jsonb_build_array(jsonb_build_object('purchase_line_id', {{pline}}, 'qty_received', 1000)),
                                null, null, null, 'bakery')`),
      T('gi_cafe', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{flour}}', qty_received: 10, unit_cost_iqd: 2 }])})`),
      T('discard', 'manager', `select app.discard_count({{count_id}}::uuid)`),
      T('phone', 'hc', `select app.submit_stock_count('bakery', ${ONE('flour', 0).replace("'qty'", "'counted_qty'")})`),
      T('into_phone', 'wtr', move('cafe', 'bakery', ONE('flour', 10))),
      T('driver_phone', 'manager', `select app.receive_purchase({{purchase}}::uuid,
                                      jsonb_build_array(jsonb_build_object('purchase_line_id', {{pline}}, 'qty_received', 1000)),
                                      null, null, null, 'bakery')`),
    ]);
    expect(refused(r, 'into')).toBe('STORE_BEING_COUNTED:bakery');
    expect(refused(r, 'out_of')).toBe('STORE_BEING_COUNTED:bakery');
    expect(refused(r, 'gi')).toBe('STORE_BEING_COUNTED:bakery');
    expect(refused(r, 'driver')).toBe('STORE_BEING_COUNTED:bakery');
    ok(r, 'gi_cafe');
    ok(r, 'discard');
    ok(r, 'phone');
    ok(r, 'into_phone');
    ok(r, 'driver_phone');
  });

  it('a move keeps expiry, cost and FEFO position: margins and costs are unchanged (I8)', () => {
    const lastCost = `(select b.unit_cost_iqd from stock_batches b where b.ingredient_id = {{milk}}::uuid
                        order by b.received_at desc, b.id desc limit 1)`;
    const r = run([
      MK('hc', 'head_chef'),
      ING('milk', 'purchased', 'g'),
      BATCH('m_old', 'milk', 'cafe', 1000, 2, 20, 120),
      BATCH('m_new', 'milk', 'cafe', 500, 3, 30, 60),
      KEEP('cat', `insert into menu_categories (name_en, name_ar, tax_group_id, is_active, venue_id, kind)
                   values ('ST drinks', 'مشروبات', {{tax}}, true, {{venue}}, 'cafe') returning id::text`),
      KEEP('item', `insert into menu_items (category_id, name_en, name_ar, is_active, venue_id)
                    values ({{cat}}::uuid, 'ST latte', 'لاتيه', true, {{venue}}) returning id::text`),
      KEEP('size', `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                    values ({{item}}::uuid, 'Regular', 'عادي', 5000, true) returning id::text`),
      X(`insert into recipe_lines (variant_id, ingredient_id, qty) values ({{size}}::uuid, {{milk}}::uuid, 200)`),
      // A release under way whose recipe uses the same milk.
      T('start', 'hc', `select app.start_protocol('product_release', null, 'ST rose', null, '{}'::jsonb,
                          jsonb_build_object('name_en', 'ST rose', 'item_kind', 'drink',
                            'lines', jsonb_build_array(jsonb_build_object('ingredient_id', {{milk}}, 'qty', 150, 'unit', 'g')),
                            'sizes', jsonb_build_array(jsonb_build_object('name_ar', 'عادي')), 'link', 'https://example.com/st'),
                          '{}'::text[], {{venue}}::uuid, null)`),
      RES('run', 'start', 'run_id'),
      RES('sub', 'start', 'submission_id'),
      T('accept', 'manager', `select app.decide_step({{sub}}::uuid, 'approve', null, null, jsonb_build_object('category_id', {{cat}}))`),
      Q('cogs_before', `select to_jsonb(cogs_iqd) from v_item_cogs where variant_id = {{size}}::uuid`),
      T('release_before', 'manager', `select app.release_cost({{run}}::uuid)`),
      Q('last_before', `select to_jsonb(${lastCost})`),
      // All of the old batch and part of the newest, whose copy then ties
      // with it on received_at.
      T('move', 'manager', move('cafe', 'bakery', ONE('milk', 1200))),
      Q('cogs_after', `select to_jsonb(cogs_iqd) from v_item_cogs where variant_id = {{size}}::uuid`),
      T('release_after', 'manager', `select app.release_cost({{run}}::uuid)`),
      Q('last_after', `select to_jsonb(${lastCost})`),
      // FEFO across the stores is unchanged: a bakery-first draw still takes
      // the oldest expiry, now in the bakery.
      X(`select app.consume_fefo_at('bakery', {{milk}}::uuid, 50, 'production_consume')`),
      Q('drawn', `select jsonb_agg(jsonb_build_object('root', (select v.name from pg_temp.vars v
                                                               where v.val = coalesce(b.origin_batch_id, b.id)::text),
                                                      'location', m.location, 'qty', m.qty_delta) order by m.id)
                    from stock_movements m join stock_batches b on b.id = m.batch_id
                   where m.ingredient_id = {{milk}}::uuid and m.movement_type = 'production_consume'`),
    ]);
    ok(r, 'accept');
    ok(r, 'move');
    expect(ok(r, 'cogs_after')).toEqual(ok(r, 'cogs_before'));
    expect(ok(r, 'release_after')).toEqual(ok(r, 'release_before'));
    expect(ok(r, 'last_after')).toEqual(ok(r, 'last_before'));
    expect(Number(ok(r, 'last_before'))).toBe(3);
    expect(ok(r, 'drawn')).toEqual([{ root: 'm_old', location: 'bakery', qty: -50 }]);
  });
});

// ── committed: two transactions at once ────────────────────────────────────
describe.skipIf(!docker)('stores: transfers under load (committed)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let waiter: SupabaseClient;
  let waiterId: string;

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    const email = `stores-waiter-${Date.now()}@test.touch.local`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    waiterId = data.user.id;
    const ins = await svc.from('staff').insert({ id: waiterId, display_name: 'Stores waiter', role: 'waiter', is_active: true });
    if (ins.error) throw new Error(ins.error.message);
    waiter = await signedInClient(email);
  });

  async function stocked(nameAr: string, qty: number): Promise<string> {
    const id = await createTestIngredient(svc, nameAr, 'g');
    const receivedAt = new Date(Date.now() - 3_600_000).toISOString();
    const { data, error } = await svc.from('stock_batches')
      .insert({ ingredient_id: id, received_at: receivedAt, qty_received: qty, qty_remaining: qty, unit_cost_iqd: 2,
                venue_id: VENUE_A_ID, location: 'cafe' })
      .select('id').single();
    if (error) throw new Error(error.message);
    const mv = await svc.from('stock_movements').insert({ ingredient_id: id, batch_id: (data as { id: string }).id,
      movement_type: 'goods_in', qty_delta: qty, unit_cost_iqd: 2, venue_id: VENUE_A_ID, at: receivedAt });
    if (mv.error) throw new Error(mv.error.message);
    return id;
  }

  it('a two-line move listed against ingredient order runs beside two-ingredient sales: no deadlock (I5, V15)', async () => {
    const a = await stocked('حليب النقل', 10_000);
    const b = await stocked('سكر النقل', 10_000);
    const [lo, hi] = [a, b].sort();
    const menu = await createTestMenuItem(svc, 'stores-two', 2_000);
    await addRecipeLine(svc, { variantId: menu.variantId }, hi!, 10);
    await addRecipeLine(svc, { variantId: menu.variantId }, lo!, 10);
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'V15'), p_label: `stores-V15-${Date.now()}`, p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(tab.ok, tab.errorMessage).toBe(true);
    const tabId = (tab.data as { tab_id: string }).tab_id;

    const results = await Promise.all([
      ...Array.from({ length: 5 }, () =>
        appRpc(waiter, 'transfer_stock', {
          p_from: 'cafe', p_to: 'bakery',
          p_lines: [{ ingredient_id: hi, qty: 100 }, { ingredient_id: lo, qty: 100 }],
          p_venue_id: VENUE_A_ID, p_idempotency_key: testIdemKey('stock.move'),
        }).then(outcome)),
      ...Array.from({ length: 10 }, () =>
        appRpc(cashier, 'till_add_items', {
          p_tab_id: tabId, p_items: [{ variant_id: menu.variantId, qty: 1 }], p_idempotency_key: testIdemKey('order.add'),
        }).then(outcome)),
    ]);
    expect(results.filter((x) => !x.ok).map((x) => x.errorMessage), 'none fails, and none on a deadlock (40P01)').toEqual([]);

    for (const id of [lo!, hi!]) {
      const { data } = await svc.from('stock_movements').select('qty_delta, movement_type, location').eq('ingredient_id', id);
      const m = data as Array<{ qty_delta: number; movement_type: string; location: string }>;
      const sum = (f: (x: (typeof m)[number]) => boolean) => m.filter(f).reduce((s, x) => s + Number(x.qty_delta), 0);
      expect(sum(() => true)).toBe(10_000 - 100);
      expect(sum((x) => x.movement_type === 'transfer')).toBe(0);
      expect(sum((x) => x.location === 'bakery')).toBe(500);
    }
    const settle = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId, p_method: 'cash', p_tendered_iqd: 20_000, p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(settle.ok, settle.errorMessage).toBe(true);
  });

  it('a sale that waits for a move in flight takes the moved stock: no overdraft while the venue holds it (I6, V15)', async () => {
    const milk = await stocked('حليب الانتظار', 1000);
    const lines = JSON.stringify([{ ingredient_id: milk, qty: 1000 }]);
    const moving = psqlSession(`
set application_name = 'stores-race-move-all';
begin;
${asStaff(waiterId, `select app.transfer_stock('cafe', 'bakery', '${lines}'::jsonb, '${VENUE_A_ID}')`)}
select pg_sleep(2);
commit;`);
    let selling: Promise<string> | null = null;
    try {
      await waitFor(() => psql(`select count(*) from pg_stat_activity
                                 where application_name = 'stores-race-move-all' and query like '%pg_sleep%'`) === '1');
      // The sale starts while the whole cafe batch is moving to the bakery.
      selling = psqlSession(`
set application_name = 'stores-race-sale';
begin;
select app.consume_fefo('${milk}', 5, 'sale_consumption');
commit;`);
      await waitFor(() => psql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                                 where a.application_name = 'stores-race-sale' and not l.granted`) === '1');
      await moving;
      await selling;
    } finally {
      await moving.catch(() => undefined);
      await selling?.catch(() => undefined);
    }
    const { data: sold } = await svc.from('stock_movements').select('batch_id, location, qty_delta')
      .eq('ingredient_id', milk).eq('movement_type', 'sale_consumption');
    const rows = sold as Array<{ batch_id: string | null; location: string; qty_delta: number }>;
    expect(rows.map((m) => ({ ...m, qty_delta: Number(m.qty_delta), batch: m.batch_id !== null })))
      .toEqual([expect.objectContaining({ location: 'bakery', qty_delta: -5, batch: true })]);
    const { data: alerts } = await svc.from('manager_alerts').select('id')
      .eq('kind', 'negative_stock').eq('payload->>ingredient_id', milk);
    expect(alerts).toEqual([]);
    // The batches hold what the ledger says (I2).
    expect(psql(`select (select sum(qty_remaining) from stock_batches where ingredient_id = '${milk}')
                      = (select sum(qty_delta) from stock_movements where ingredient_id = '${milk}')`)).toBe('t');
  });

  it('a two-item order against a two-line move: the order takes its ingredients first, so neither deadlocks (V15)', async () => {
    const x = await stocked('حليب الطلب', 1000);
    const y = await stocked('طحين الطلب', 1000);
    const [lo, hi] = [x, y].sort();
    // The first item is made from the later ingredient: item order against
    // ingredient order, as a latte rung up before a cookie.
    const first = await createTestMenuItem(svc, 'stores-order-first', 2_000);
    await addRecipeLine(svc, { variantId: first.variantId }, hi!, 10);
    const second = await createTestMenuItem(svc, 'stores-order-second', 1_000);
    await addRecipeLine(svc, { variantId: second.variantId }, lo!, 10);
    const tab = crypto.randomUUID();
    const order = crypto.randomUUID();
    const item = (variantId: string) => `(select id from order_items where order_id = '${order}' and variant_id = '${variantId}')`;
    // Rolled back: the order, its tab and its stock rows are gone after.
    const ordering = psqlSession(`
set application_name = 'stores-race-order';
begin;
insert into tabs (id, day_session_id, venue_id)
values ('${tab}', (select id from day_sessions where venue_id = '${VENUE_A_ID}' and status = 'open'
                    order by opened_at desc limit 1), '${VENUE_A_ID}');
insert into orders (id, tab_id, source, venue_id) values ('${order}', '${tab}', 'till', '${VENUE_A_ID}');
insert into order_items (order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd)
values ('${order}', '${first.itemId}', '${first.variantId}', 1, 2000, 2000);
insert into order_items (order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd)
values ('${order}', '${second.itemId}', '${second.variantId}', 1, 1000, 1000);
select app.consume_for_order_item(${item(first.variantId)});
select pg_sleep(2);
select app.consume_for_order_item(${item(second.variantId)});
rollback;`);
    let moving: Promise<string> | null = null;
    try {
      await waitFor(() => psql(`select count(*) from pg_stat_activity
                                 where application_name = 'stores-race-order' and query like '%pg_sleep%'`) === '1');
      const lines = JSON.stringify([{ ingredient_id: hi, qty: 10 }, { ingredient_id: lo, qty: 10 }]);
      moving = psqlSession(`
set application_name = 'stores-race-order-move';
begin;
${asStaff(waiterId, `select app.transfer_stock('cafe', 'bakery', '${lines}'::jsonb, '${VENUE_A_ID}')`)}
rollback;`);
      const settled = await Promise.allSettled([ordering, moving]);
      expect(settled.map((s) => (s.status === 'rejected' ? String(s.reason) : 'ok')), 'no 40P01').toEqual(['ok', 'ok']);
    } finally {
      await ordering.catch(() => undefined);
      await moving?.catch(() => undefined);
    }
  });

  it('a start_count waits for a move into its store still in flight, and counts it (M5)', async () => {
    const oil = await stocked('زيت النقل', 500);
    const lines = JSON.stringify([{ ingredient_id: oil, qty: 60 }]);
    const moving = psqlSession(`
set application_name = 'stores-race-move';
begin;
${asStaff(waiterId, `select app.transfer_stock('cafe', 'bakery', '${lines}'::jsonb, '${VENUE_A_ID}')`)}
select pg_sleep(2);
commit;`);
    let countId: string | null = null;
    try {
      await waitFor(() => psql(`select count(*) from pg_stat_activity
                                 where application_name = 'stores-race-move' and query like '%pg_sleep%'`) === '1');
      const counting = psqlSession(`
set application_name = 'stores-race-move-count';
begin;
${asStaff(SEED_STAFF_IDS.manager, `select app.start_count('bakery', '${VENUE_A_ID}')`)}
commit;`);
      await waitFor(() => psql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                                 where a.application_name = 'stores-race-move-count' and l.locktype = 'advisory'
                                   and not l.granted`) === '1');
      await moving;
      const out = await counting;
      countId = (jsonLines(out).find((o) => 'count_id' in o)?.count_id as string | undefined) ?? null;
      expect(countId).toBeTruthy();
      expect(psql(`select theoretical_qty from stock_count_lines where count_id = '${countId}' and ingredient_id = '${oil}'`)).toBe('60.000');
    } finally {
      await moving.catch(() => undefined);
      const open = countId ?? psql(`select id from stock_counts where venue_id = '${VENUE_A_ID}' and location = 'bakery'
                                     and finalized_at is null and started_at > now() - interval '1 minute' limit 1`);
      if (open) psql(`begin; ${asStaff(SEED_STAFF_IDS.manager, `select app.discard_count('${open}')`)} commit;`);
    }
  });
});

function jsonLines(out: string): Array<Record<string, unknown>> {
  return out.split('\n').flatMap((l) => {
    try {
      const v = JSON.parse(l) as unknown;
      return v && typeof v === 'object' ? [v as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('waitFor: timed out');
}
