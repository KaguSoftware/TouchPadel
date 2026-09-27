/**
 * stock_counts_by_location (docs/design/protocols/wave5-addendum-2026-09-25.md
 * §2.8 D7, §6.1): "stock control", each store counted on its own. The first
 * test that runs a count end to end.
 *
 *   * I9  a manager's count of the bakery adjusts only the bakery, and its
 *         variance row covers only the bakery and its own period: the cafe's
 *         sale is not in it, the bakery's waste and the move into it are
 *         (transfer_qty), and the waste before the last bakery count is not.
 *         start_count leaves another venue's ingredients out, and the bakery
 *         count leaves shop stock out;
 *   * the head chef and the chef count the bakery on the phone (the cafe is
 *     FORBIDDEN hint location); a second count of a store is
 *     COUNT_IN_PROGRESS while a cafe count runs alongside; a same-key submit
 *     counts once (I11); nothing the phone gets back carries a theoretical
 *     quantity or a variance;
 *   * a manager applies a phone count with edited lines, or discards it; a
 *     surplus in a store with no live batch is costed like the newest batch
 *     elsewhere; another venue's count is COUNT_NOT_FOUND; a phone count's
 *     variance period ends when it was counted, not when it was applied;
 *   * report_stock carries location and transferQty;
 *   * an operator count blocks Goods in at its store only, and a waiting
 *     phone count blocks nothing (V19);
 *   * (committed) a start_count waits on the count lock for a receipt into
 *     that store still in flight, and its snapshot includes it (M5);
 *   * every other role is refused.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, createTestIngredient, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';
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
const run = (body: string[]) => scenario('sc', body);

const DAY = 24 * 60;

describe.skipIf(!docker)('stores: counts (rolled-back transactions)', () => {
  it('a bakery count adjusts only the bakery, and its variance covers only the bakery’s period (I9)', () => {
    const r = run([
      ING('beans', 'purchased', 'g'),
      ING('ball', 'retail', 'pc'),
      ING('far', 'purchased', 'g', { venue: OTHER_VENUE }),
      BATCH('b_cafe', 'beans', 'cafe', 1000, 20, null, 4 * DAY),
      BATCH('b_bak', 'beans', 'bakery', 500, 20, null, 3 * DAY),
      BATCH('ball_cafe', 'ball', 'cafe', 12, 9000, null, 3 * DAY),
      // Waste before the last bakery count, which was two days ago.
      X(`update stock_batches set qty_remaining = qty_remaining - 5 where id = {{b_bak}}::uuid`),
      X(`insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd, reason_code, venue_id, at)
         values ({{beans}}::uuid, {{b_bak}}::uuid, 'waste_spill', -5, 20, 'old', {{venue}}::uuid, now() - interval '2 days 1 hour')`),
      KEEP('old_count', `insert into stock_counts (counted_by, venue_id, location, source, started_at, finalized_at)
                         values ({{manager}}::uuid, {{venue}}::uuid, 'bakery', 'operator',
                                 now() - interval '2 days', now() - interval '2 days')
                         returning id::text`),
      X(`insert into stock_count_lines (count_id, ingredient_id, theoretical_qty, counted_qty)
         values ({{old_count}}::uuid, {{beans}}::uuid, 495, 495)`),
      // The period: a cafe sale, bakery waste, and a move of 50 into the
      // bakery, booked as transfer_stock books one (stock_transfers).
      X(`select app.consume_fefo({{beans}}::uuid, 100, 'sale_consumption')`),
      T('waste', 'manager', `select to_jsonb(app.record_waste({{beans}}::uuid, 20, 'waste_spill', 'x', null, null, 'bakery'))`),
      X(`update stock_batches set qty_remaining = qty_remaining - 50 where id = {{b_cafe}}::uuid`),
      KEEP('b_copy', `insert into stock_batches (ingredient_id, received_at, expiry_date, qty_received, qty_remaining,
                                                 unit_cost_iqd, venue_id, location, origin_batch_id)
                      select ingredient_id, received_at, expiry_date, 50, 50, unit_cost_iqd, venue_id, 'bakery', id
                        from stock_batches where id = {{b_cafe}}::uuid
                      returning id::text`),
      X(`insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd, reason_code, venue_id)
         values ({{beans}}::uuid, {{b_cafe}}::uuid, 'transfer', -50, 20, 'transfer:probe', {{venue}}::uuid),
                ({{beans}}::uuid, {{b_copy}}::uuid, 'transfer', 50, 20, 'transfer:probe', {{venue}}::uuid)`),

      T('start', 'manager', `select app.start_count('bakery', {{venue}})`),
      RES('count', 'start', 'count_id'),
      T('again', 'owner', `select app.start_count('bakery')`),
      T('cafe', 'owner', `select app.start_count('cafe', {{venue}})`),
      RES('cafe_count', 'cafe', 'count_id'),
      T('bad_loc', 'manager', `select app.start_count('kitchen')`),
      T('far_venue', 'manager', `select app.start_count('bakery', {{other_venue}})`),
      Q('lines', `select jsonb_build_object(
                    'beans', (select theoretical_qty from stock_count_lines where count_id = {{count}}::uuid and ingredient_id = {{beans}}::uuid),
                    'ball', (select count(*) from stock_count_lines where count_id = {{count}}::uuid and ingredient_id = {{ball}}::uuid),
                    'far', (select count(*) from stock_count_lines l join stock_counts c on c.id = l.count_id
                             where c.id in ({{count}}::uuid, {{cafe_count}}::uuid) and l.ingredient_id = {{far}}::uuid),
                    'cafe_beans', (select theoretical_qty from stock_count_lines where count_id = {{cafe_count}}::uuid and ingredient_id = {{beans}}::uuid),
                    'cafe_ball', (select theoretical_qty from stock_count_lines where count_id = {{cafe_count}}::uuid and ingredient_id = {{ball}}::uuid),
                    'venues', (select count(distinct i.venue_id) from stock_count_lines l join ingredients i on i.id = l.ingredient_id
                                where l.count_id = {{count}}::uuid))`),
      Q('cafe_before', `select to_jsonb(qty_remaining) from stock_batches where id = {{b_cafe}}::uuid`),
      // Counted: 500 in the bakery, 25 short.
      T('fin', 'manager', `select app.finalize_count({{count}}::uuid,
                             jsonb_build_array(jsonb_build_object('ingredient_id', {{beans}}, 'counted_qty', 500)))`),
      Q('adjusted', `select jsonb_agg(jsonb_build_object(
                       'batch', (select v.name from pg_temp.vars v where v.val = m.batch_id::text),
                       'location', m.location, 'qty', m.qty_delta, 'reason', m.reason_code) order by m.id)
                       from stock_movements m where m.count_id = {{count}}::uuid`),
      Q('cafe_after', `select to_jsonb(qty_remaining) from stock_batches where id = {{b_cafe}}::uuid`),
      Q('variance', `select to_jsonb(v) from v_variance_report v
                      where v.count_id = {{count}}::uuid and v.ingredient_id = {{beans}}::uuid`),
      Q('old_period', `select to_jsonb(finalized_at) from stock_counts where id = {{old_count}}::uuid`),
      T('report', 'manager', `select (select e from jsonb_array_elements(app.report_stock(current_date - 1, current_date + 1,
                                        jsonb_build_object('ingredientId', {{beans}}))->'variance') e
                                where e->>'countId' = {{count}})`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'after', a.after) order by a.id) from audit_log a
                   where a.entity_id in ({{count}}, {{cafe_count}}) and a.at = now()`),
      T('fin_again', 'manager', `select app.finalize_count({{count}}::uuid)`),
      T('discard_cafe', 'owner', `select app.discard_count({{cafe_count}}::uuid)`),
    ]);
    expect(ok<{ location: string; lines: number }>(r, 'start')).toMatchObject({ location: 'bakery' });
    expect(refused(r, 'again')).toBe('COUNT_IN_PROGRESS');
    expect(ok<{ location: string }>(r, 'cafe').location).toBe('cafe');
    expect(refused(r, 'bad_loc')).toBe('INVALID_ARGUMENT:location');
    expect(refused(r, 'far_venue')).toBe('FORBIDDEN');
    // The bakery's ledger: 500 in, 5 and 20 wasted, 50 moved in.
    expect(ok(r, 'lines')).toEqual({ beans: 525, ball: 0, far: 0, cafe_beans: 850, cafe_ball: 12, venues: 1 });

    expect(ok<{ adjusted_lines: number; location: string }>(r, 'fin')).toMatchObject({ adjusted_lines: 1, location: 'bakery' });
    // The shortage is drawn from the bakery only, oldest first: the moved-in
    // copy keeps the cafe batch's older receipt.
    expect(ok(r, 'adjusted')).toEqual([{ batch: 'b_copy', location: 'bakery', qty: -25, reason: 'count_shortage' }]);
    expect(ok(r, 'cafe_after')).toEqual(ok(r, 'cafe_before'));

    const v = ok<Record<string, unknown>>(r, 'variance');
    expect(v).toMatchObject({
      location: 'bakery',
      theoretical_qty: 525,
      counted_qty: 500,
      variance_qty: -25,
      sold_qty: 0,            // the cafe's sale is not the bakery's
      recorded_waste_qty: 20, // the waste before the last bakery count is not in this period
      transfer_qty: 50,
      product_test_qty: 0,
    });
    expect(new Date(v.period_start as string).getTime()).toBe(new Date(ok<string>(r, 'old_period')).getTime());
    expect(ok<Record<string, unknown>>(r, 'report')).toMatchObject({ location: 'bakery', transferQty: 50, varianceQty: -25 });

    const audit = ok<Array<{ action: string; after: Record<string, unknown> | null }>>(r, 'audit');
    expect(audit.find((a) => a.action === 'stock.start_count')?.after).toMatchObject({ location: 'bakery' });
    expect(audit.find((a) => a.action === 'stock.finalize_count')?.after).toEqual({ adjusted_lines: 1, location: 'bakery' });
    expect(refused(r, 'fin_again')).toBe('COUNT_FINALIZED');
    expect(ok(r, 'discard_cafe')).toMatchObject({ discarded: true });
  });

  it('the kitchen counts the bakery on the phone; a manager applies it with edits, or discards it', () => {
    const r = run([
      MK('hc', 'head_chef'), MK('chef', 'chef'),
      ING('flour', 'purchased', 'g', { packSize: 1000 }),
      ING('dough', 'prepared', 'g'),
      ING('sugar', 'purchased', 'g'),
      ING('ball', 'retail', 'pc'),
      BATCH('f_bak', 'flour', 'bakery', 1000, 2),
      BATCH('f_cafe', 'flour', 'cafe', 300, 2),
      BATCH('s_bak', 'sugar', 'bakery', 40, 7),
      T('sub', 'chef', `select app.submit_stock_count('bakery', jsonb_build_array(
                          jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 0.9, 'unit', 'pack'),
                          jsonb_build_object('ingredient_id', {{dough}}, 'counted_qty', 5)), {{venue}}, 'SC-K1')`),
      T('sub_replay', 'chef', `select app.submit_stock_count('bakery', jsonb_build_array(
                          jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 0.9, 'unit', 'pack'),
                          jsonb_build_object('ingredient_id', {{dough}}, 'counted_qty', 5)), {{venue}}, 'SC-K1')`),
      RES('count', 'sub', 'count_id'),
      Q('waiting', `select jsonb_agg(jsonb_build_object('location', location, 'source', source,
                                                        'finalized', finalized_at is not null))
                      from stock_counts where id = {{count}}::uuid`),
      Q('snap', `select jsonb_object_agg((select v.name from pg_temp.vars v where v.val = l.ingredient_id::text),
                                         jsonb_build_array(l.theoretical_qty, l.counted_qty))
                   from stock_count_lines l where l.count_id = {{count}}::uuid`),
      T('second', 'hc', `select app.submit_stock_count(null, jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 1)))`),
      T('cafe_op', 'manager', `select app.start_count('cafe')`),
      RES('cafe_count', 'cafe_op', 'count_id'),
      T('chef_cafe', 'chef', `select app.submit_stock_count('cafe', jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 1)))`),
      T('ball_bak', 'manager', `select app.submit_stock_count('bakery', jsonb_build_array(jsonb_build_object('ingredient_id', {{ball}}, 'counted_qty', 1)))`),
      T('bad_qty', 'hc', `select app.submit_stock_count('bakery', jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', -1)))`),
      T('bad_unit', 'hc', `select app.submit_stock_count('bakery', jsonb_build_array(jsonb_build_object('ingredient_id', {{sugar}}, 'counted_qty', 1, 'unit', 'pack')))`),
      T('no_lines', 'hc', `select app.submit_stock_count('bakery', '[]'::jsonb)`),
      T('repeat', 'hc', `select app.submit_stock_count('bakery', jsonb_build_array(
                           jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 1),
                           jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 2)))`),
      T('unknown', 'hc', `select app.submit_stock_count('bakery', jsonb_build_array(
                            jsonb_build_object('ingredient_id', '00000000-0000-4000-8000-000000000000', 'counted_qty', 1)))`),
      // The manager applies it, correcting the flour to 950 (50 short): the
      // dough, never made, is a surplus of 5 at zero cost.
      T('apply', 'manager', `select app.finalize_count({{count}}::uuid,
                               jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 950)))`),
      Q('after', `select jsonb_build_object(
                    'f_bak', (select qty_remaining from stock_batches where id = {{f_bak}}::uuid),
                    'f_cafe', (select qty_remaining from stock_batches where id = {{f_cafe}}::uuid),
                    'dough', (select jsonb_agg(jsonb_build_object('location', location, 'qty', qty_remaining, 'cost', unit_cost_iqd))
                                from stock_batches where ingredient_id = {{dough}}::uuid))`),
      T('apply_again', 'manager', `select app.finalize_count({{count}}::uuid)`),
      T('discard_applied', 'manager', `select app.discard_count({{count}}::uuid)`),
      // The cafe count: sugar lives only in the bakery, and 10 are found in
      // the cafe: a new cafe batch costed like the bakery's.
      T('cafe_apply', 'owner', `select app.finalize_count({{cafe_count}}::uuid,
                                  jsonb_build_array(jsonb_build_object('ingredient_id', {{sugar}}, 'counted_qty', 10)))`),
      Q('sugar', `select jsonb_agg(jsonb_build_object('location', location, 'qty', qty_remaining, 'cost', unit_cost_iqd)
                                   order by location)
                    from stock_batches where ingredient_id = {{sugar}}::uuid`),
      // A second phone count, thrown away.
      T('sub2', 'hc', `select app.submit_stock_count('bakery', jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 1)))`),
      RES('count2', 'sub2', 'count_id'),
      T('discard', 'manager', `select app.discard_count({{count2}}::uuid)`),
      Q('gone', `select jsonb_build_object('counts', (select count(*) from stock_counts where id = {{count2}}::uuid),
                                           'lines', (select count(*) from stock_count_lines where count_id = {{count2}}::uuid))`),
      T('discard_again', 'manager', `select app.discard_count({{count2}}::uuid)`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'before', a.before, 'after', a.after) order by a.id)
                    from audit_log a where a.entity_id in ({{count}}, {{count2}}) and a.at = now()
                     and a.action in ('stock.submit_count', 'stock.discard_count')`),
      // Another venue's count.
      KEEP('far_count', `insert into stock_counts (counted_by, venue_id, location, source)
                         values ({{manager}}::uuid, {{other_venue}}::uuid, 'bakery', 'phone') returning id::text`),
      T('far_fin', 'owner', `select app.finalize_count({{far_count}}::uuid)`),
      T('far_discard', 'manager', `select app.discard_count({{far_count}}::uuid)`),
    ]);
    const sub = ok<Record<string, unknown>>(r, 'sub');
    expect(Object.keys(sub).sort()).toEqual(['count_id', 'lines', 'location']);
    expect(sub).toMatchObject({ location: 'bakery', lines: 2 });
    expect(moneyKeys(sub)).toEqual([]);
    expect(ok(r, 'sub_replay')).toEqual({ ...sub, duplicate: true });
    expect(ok(r, 'waiting')).toEqual([{ location: 'bakery', source: 'phone', finalized: false }]);
    // Theoretical is the bakery's ledger at submit; the pack became 900 g.
    expect(ok(r, 'snap')).toEqual({ flour: [1000, 900], dough: [0, 5] });

    expect(refused(r, 'second')).toBe('COUNT_IN_PROGRESS');
    ok(r, 'cafe_op');
    expect(refused(r, 'chef_cafe')).toBe('FORBIDDEN:location');
    expect(refused(r, 'ball_bak')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'bad_qty')).toBe('INVALID_QTY');
    expect(refused(r, 'bad_unit')).toBe('INVALID_ARGUMENT:unit');
    expect(refused(r, 'no_lines')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'repeat')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'unknown')).toBe('INGREDIENT_NOT_FOUND');

    expect(ok(r, 'apply')).toMatchObject({ adjusted_lines: 2, location: 'bakery' });
    expect(ok(r, 'after')).toEqual({ f_bak: 950, f_cafe: 300, dough: [{ location: 'bakery', qty: 5, cost: 0 }] });
    expect(refused(r, 'apply_again')).toBe('COUNT_FINALIZED');
    expect(refused(r, 'discard_applied')).toBe('COUNT_FINALIZED');
    expect(ok(r, 'cafe_apply')).toMatchObject({ location: 'cafe' });
    expect(ok(r, 'sugar')).toEqual([
      { location: 'cafe', qty: 10, cost: 7 },
      { location: 'bakery', qty: 40, cost: 7 },
    ]);

    expect(ok(r, 'discard')).toEqual({ count_id: ok<{ count_id: string }>(r, 'sub2').count_id, discarded: true });
    expect(ok(r, 'gone')).toEqual({ counts: 0, lines: 0 });
    expect(refused(r, 'discard_again')).toBe('COUNT_NOT_FOUND');
    const audit = ok<Array<{ action: string; before: unknown; after: unknown }>>(r, 'audit');
    expect(audit).toEqual([
      { action: 'stock.submit_count', before: null, after: { location: 'bakery', lines: 2 } },
      { action: 'stock.submit_count', before: null, after: { location: 'bakery', lines: 1 } },
      { action: 'stock.discard_count', before: { location: 'bakery', source: 'phone', lines: 1 }, after: null },
    ]);
    expect(refused(r, 'far_fin')).toBe('COUNT_NOT_FOUND');
    expect(refused(r, 'far_discard')).toBe('COUNT_NOT_FOUND');
  });

  it('a phone count’s variance ends when it was counted, not when a manager applied it', () => {
    const r = run([
      ING('rye', 'purchased', 'g'),
      BATCH('r_bak', 'rye', 'bakery', 1000, 3, null, 3 * DAY),
      // The chef counted 900 yesterday, when the bakery's ledger said 1000.
      KEEP('phone', `insert into stock_counts (counted_by, venue_id, location, source, started_at)
                     values ({{manager}}::uuid, {{venue}}::uuid, 'bakery', 'phone', now() - interval '1 day')
                     returning id::text`),
      X(`insert into stock_count_lines (count_id, ingredient_id, theoretical_qty, counted_qty)
         values ({{phone}}::uuid, {{rye}}::uuid, 1000, 900)`),
      // Waste after the count and before the manager applies it.
      X(`update stock_batches set qty_remaining = qty_remaining - 30 where id = {{r_bak}}::uuid`),
      X(`insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd, reason_code, venue_id, at)
         values ({{rye}}::uuid, {{r_bak}}::uuid, 'waste_spill', -30, 3, 'late', {{venue}}::uuid, now() - interval '12 hours')`),
      T('apply', 'manager', `select app.finalize_count({{phone}}::uuid)`),
      // The next count of the bakery, found as the ledger says.
      T('next', 'manager', `select app.start_count('bakery', {{venue}})`),
      RES('next', 'next', 'count_id'),
      T('next_fin', 'manager', `select app.finalize_count({{next}}::uuid)`),
      Q('variance', `select jsonb_object_agg(case when v.count_id = {{phone}}::uuid then 'phone' else 'next' end,
                                             jsonb_build_object('start', v.period_start, 'end', v.period_end,
                                                                'waste', v.recorded_waste_qty, 'variance', v.variance_qty))
                       from v_variance_report v
                      where v.count_id in ({{phone}}::uuid, {{next}}::uuid) and v.ingredient_id = {{rye}}::uuid`),
      Q('counted_at', `select to_jsonb(started_at) from stock_counts where id = {{phone}}::uuid`),
    ]);
    ok(r, 'apply');
    ok(r, 'next_fin');
    const counted = new Date(ok<string>(r, 'counted_at')).getTime();
    const v = ok<Record<'phone' | 'next', { start: string | null; end: string; waste: number; variance: number }>>(r, 'variance');
    // The phone count's period ends when it was counted, so the waste after it
    // is not one of its explanations; the next period starts there and has it.
    expect(new Date(v.phone.end).getTime()).toBe(counted);
    expect(v.phone).toMatchObject({ waste: 0, variance: -100 });
    expect(new Date(v.next.start!).getTime()).toBe(counted);
    expect(v.next).toMatchObject({ waste: 30, variance: 0 });
  });

  it('an operator count holds receipts out of its store only; a waiting phone count holds nothing (V19)', () => {
    const r = run([
      MK('hc', 'head_chef'),
      ING('milk', 'purchased', 'ml'),
      T('count', 'manager', `select app.start_count('bakery')`),
      RES('count_id', 'count', 'count_id'),
      T('gi_bak', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{milk}}', qty_received: 10, unit_cost_iqd: 1 }])},
                                null, null, null, null, null, 'bakery')`),
      T('gi_cafe', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{milk}}', qty_received: 10, unit_cost_iqd: 1 }])})`),
      T('discard', 'manager', `select app.discard_count({{count_id}}::uuid)`),
      T('phone', 'hc', `select app.submit_stock_count('bakery', jsonb_build_array(jsonb_build_object('ingredient_id', {{milk}}, 'counted_qty', 0)))`),
      T('gi_phone', 'manager', `select app.receive_delivery(${LINES([{ ingredient_id: '{{milk}}', qty_received: 10, unit_cost_iqd: 1 }])},
                                  null, null, null, null, null, 'bakery')`),
    ]);
    expect(refused(r, 'gi_bak')).toBe('STORE_BEING_COUNTED:bakery');
    ok(r, 'gi_cafe');
    ok(r, 'discard');
    ok(r, 'phone');
    ok(r, 'gi_phone');
  });

  it('refuses every other role', () => {
    const others = { hb: 'head_barista', bar: 'barista', ab: 'assistant_barista', wtr: 'waiter', drv: 'driver', mkt: 'marketing' };
    const r = run([
      ...Object.entries(others).map(([k, role]) => MK(k, role)),
      MK('hc', 'head_chef'), MK('chef', 'chef'),
      ING('flour', 'purchased', 'g'),
      KEEP('count', `insert into stock_counts (counted_by, venue_id, location, source)
                     values ({{manager}}::uuid, {{venue}}::uuid, 'bakery', 'phone') returning id::text`),
      ...[...Object.keys(others), 'cashier', 'desk', 'prep'].map((who) =>
        T(`sub_${who}`, who, `select app.submit_stock_count(null, jsonb_build_array(jsonb_build_object('ingredient_id', {{flour}}, 'counted_qty', 1)))`)),
      ...[...Object.keys(others), 'hc', 'chef', 'cashier', 'desk', 'prep'].flatMap((who) => [
        T(`start_${who}`, who, `select app.start_count('bakery')`),
        T(`fin_${who}`, who, `select app.finalize_count({{count}}::uuid)`),
        T(`discard_${who}`, who, `select app.discard_count({{count}}::uuid)`),
      ]),
    ]);
    for (const who of [...Object.keys(others), 'cashier', 'desk', 'prep']) {
      expect(refused(r, `sub_${who}`), who).toBe('FORBIDDEN');
    }
    for (const who of [...Object.keys(others), 'hc', 'chef', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `start_${who}`), who).toBe('FORBIDDEN');
      expect(refused(r, `fin_${who}`), who).toBe('FORBIDDEN');
      expect(refused(r, `discard_${who}`), who).toBe('FORBIDDEN');
    }
  });
});

// ── committed: two sessions at once ────────────────────────────────────────
describe.skipIf(!docker)('stores: the count lock (committed sessions)', () => {
  let svc: SupabaseClient;
  beforeAll(() => {
    svc = serviceClient();
  });

  it('a start_count waits for a receipt into its store still in flight, and counts it (M5, V19)', async () => {
    const tea = await createTestIngredient(svc, 'شاي العد', 'g');
    const lines = JSON.stringify([{ ingredient_id: tea, qty_received: 70, unit_cost_iqd: 3 }]);
    const receipt = psqlSession(`
set application_name = 'stores-race-receipt';
begin;
${asStaff(SEED_STAFF_IDS.manager, `select app.receive_delivery('${lines}'::jsonb, null, null, null, null, null, 'bakery')`)}
select pg_sleep(2);
commit;`);
    let countId: string | null = null;
    try {
      // The receipt holds the bakery's count lock (shared) until it commits.
      await waitFor(() => psql(`select count(*) from pg_stat_activity
                                 where application_name = 'stores-race-receipt' and query like '%pg_sleep%'`) === '1');
      const count = psqlSession(`
set application_name = 'stores-race-count';
begin;
${asStaff(SEED_STAFF_IDS.manager, `select app.start_count('bakery', '${VENUE_A_ID}')`)}
commit;`);
      await waitFor(() => psql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                                 where a.application_name = 'stores-race-count' and l.locktype = 'advisory'
                                   and not l.granted`) === '1');
      await receipt;
      const out = await count;
      const started = jsonLines(out).find((o) => 'count_id' in o) as { count_id?: string } | undefined;
      countId = started?.count_id ?? null;
      expect(countId).toBeTruthy();
      expect(psql(`select theoretical_qty from stock_count_lines where count_id = '${countId}' and ingredient_id = '${tea}'`)).toBe('70.000');
    } finally {
      await receipt.catch(() => undefined);
      // Never leave a count open: it would hold receipts out of the bakery.
      const open = countId ?? psql(`select id from stock_counts where venue_id = '${VENUE_A_ID}' and location = 'bakery'
                                     and finalized_at is null and started_at > now() - interval '1 minute' limit 1`);
      if (open) psql(`begin; ${asStaff(SEED_STAFF_IDS.manager, `select app.discard_count('${open}')`)} commit;`);
    }
  });
});

/** The JSON objects a -qAt session printed, one per line. */
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
