/**
 * Owner analytics (0034): daily sales reconciliation, item rankings, basket
 * pairs, margin coverage, price bands, menu snapshot, the owner gate, the
 * LLM tables' RPCs and the app.normalize_finding <-> @touch/core parity.
 *
 * Seeds a real journey through the RPCs (guest order -> cash settle -> waiter
 * call) on the current business day, then reconciles the analytics output
 * against the raw rows the service role can read.
 *
 * Runs against the live local stack; skips itself when the stack is down.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  testIdemKey,
  outcome,
  SEED_STAFF,
  createTestMenuItem,
  createTestCafeTable,
  openGuestSession,
  ensureOpenDay,
  ensureTillFresh,
  setCafeSetting,
  snapshotCafeSettings,
} from './helpers';
import { normalizeFinding } from '../../core/src/analytics/insightsText';

const up = await stackAvailable();

const FIXTURE_CAPPUCCINO = 'f1f70000-0000-4000-8000-00000000e002'; // menu_item_costs 1100 (fixtures/menu.sql)

type Daily = {
  business_date: string;
  revenue_iqd: number;
  cash_iqd: number;
  card_iqd: number;
  tabs_settled: number;
  orders: number;
  items_qty: number;
  discount_iqd: number;
  tax_iqd: number;
  visits: number;
  guest_orders: number;
  till_orders: number;
  waiter_calls: number;
};

describe.skipIf(!up)('analytics (0034: owner sales analytics + LLM tables)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let restoreSettings: () => Promise<void>;

  let costed: { itemId: string; variantId: string }; // cost 900, list 4,000
  let uncosted: { itemId: string; variantId: string }; // no cost row, list 12,000
  let orderId: string;
  let tabId: string;
  let paymentAmount: number;
  let day: string; // business date of the seeded activity
  let from: string;
  let to: string;
  let window: { ts_from: string; ts_to: string };

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);

    restoreSettings = await snapshotCafeSettings(svc, owner);
    await setCafeSetting(owner, 'analytics_excluded_item_ids', []);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);

    costed = await createTestMenuItem(svc, 'an-costed', 4_000);
    uncosted = await createTestMenuItem(svc, 'an-uncosted', 12_000);
    const cost = await appRpc(owner, 'set_item_cost', { p_item_id: costed.itemId, p_cost_iqd: 900 }).then(outcome);
    if (!cost.ok) throw new Error(cost.errorMessage);

    const tableId = await createTestCafeTable(svc, 'AN');
    const guest = await openGuestSession(owner, tableId);

    // One basket holding BOTH items (the bought-together pair): 2 x costed + 1 x uncosted.
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: [
        { variant_id: costed.variantId, qty: 2 },
        { variant_id: uncosted.variantId, qty: 1 },
      ],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    if (!res.ok) throw new Error(`seed order failed: ${res.errorMessage}`);
    const d = res.data as { order_id: string; tab_id: string; total_iqd: number };
    orderId = d.order_id;
    tabId = d.tab_id;
    paymentAmount = Number(d.total_iqd); // 20,000

    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: paymentAmount,
      p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    if (!settled.ok) throw new Error(`seed settle failed: ${settled.errorMessage}`);

    const call = await appRpc(guest.client, 'raise_waiter_call', { p_reason: 'bill' }).then(outcome);
    if (!call.ok) throw new Error(`seed call failed: ${call.errorMessage}`);

    // The business day the seed landed on, and its exact timestamptz window.
    const bd = await svc.schema('app').rpc('business_date', { p_at: new Date().toISOString() });
    if (bd.error) throw new Error(bd.error.message);
    day = bd.data as string;
    from = shift(day, -1);
    to = shift(day, 1);
    const bounds = await svc.schema('app').rpc('analytics_bounds', { p_from: day, p_to: day });
    if (bounds.error) throw new Error(bounds.error.message);
    const b = (Array.isArray(bounds.data) ? bounds.data[0] : bounds.data) as { ts_from: string; ts_to: string };
    window = { ts_from: b.ts_from, ts_to: b.ts_to };
  });

  afterAll(async () => {
    await restoreSettings?.();
  });

  it('analytics_daily_sales: revenue reconciles with payments - refunds of the business day; calls / tabs / orders counted', async () => {
    const res = await appRpc(owner, 'analytics_daily_sales', { p_from: from, p_to: to }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const rows = res.data as Daily[];
    const today = rows.find((r) => r.business_date === day);
    expect(today, `no row for business day ${day}`).toBeDefined();

    // Raw truth for the same window (service role): every payment / refund,
    // whichever suite wrote it — revenue is revenue.
    const { data: pays } = await svc
      .from('payments')
      .select('id, amount_iqd, method')
      .gte('created_at', window.ts_from)
      .lt('created_at', window.ts_to);
    type Pay = { id: string; amount_iqd: number; method: string };
    const payRows = pays as Pay[];
    const { data: refs } = await svc
      .from('refunds')
      .select('amount_iqd, payment_id')
      .gte('created_at', window.ts_from)
      .lt('created_at', window.ts_to);
    const refRows = (refs ?? []) as { amount_iqd: number; payment_id: string }[];
    const paidBy = (m?: string) =>
      payRows.filter((p) => !m || p.method === m).reduce((s, p) => s + Number(p.amount_iqd), 0);
    const refundedBy = (m?: string) =>
      refRows
        .filter((r) => !m || payRows.find((p) => p.id === r.payment_id)?.method === m)
        .reduce((s, r) => s + Number(r.amount_iqd), 0);

    expect(Number(today!.revenue_iqd)).toBe(paidBy() - refundedBy());
    expect(Number(today!.cash_iqd)).toBe(paidBy('cash') - refundedBy('cash'));
    expect(Number(today!.card_iqd)).toBe(paidBy('card') - refundedBy('card'));
    expect(Number(today!.revenue_iqd)).toBeGreaterThanOrEqual(paymentAmount);
    expect(Number(today!.cash_iqd) + Number(today!.card_iqd)).toBeLessThanOrEqual(Number(today!.revenue_iqd) + refundedBy());

    const { count: calls } = await svc
      .from('waiter_calls')
      .select('id', { count: 'exact', head: true })
      .gte('raised_at', window.ts_from)
      .lt('raised_at', window.ts_to);
    expect(today!.waiter_calls).toBe(calls);
    expect(today!.waiter_calls).toBeGreaterThanOrEqual(1);

    const { count: settledTabs } = await svc
      .from('tabs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'settled')
      .gte('settled_at', window.ts_from)
      .lt('settled_at', window.ts_to);
    expect(today!.tabs_settled).toBe(settledTabs);
    expect(today!.orders).toBeGreaterThanOrEqual(1);
    expect(today!.guest_orders).toBeGreaterThanOrEqual(1);
    expect(today!.items_qty).toBeGreaterThanOrEqual(3);
    expect(today!.visits).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(today!.discount_iqd)).toBe(true);
    expect(Number.isInteger(today!.tax_iqd)).toBe(true);
    // Every row in the range is a business day inside [from, to], ascending.
    for (const r of rows) {
      expect(r.business_date >= from && r.business_date <= to).toBe(true);
    }
    expect(rows.map((r) => r.business_date)).toEqual([...rows.map((r) => r.business_date)].sort());
  });

  it('analytics_best_sellers / analytics_sold_items include the settled item (p_basis=settled); INVALID_ARGUMENT basis', async () => {
    const best = await appRpc(owner, 'analytics_best_sellers', {
      p_from: from,
      p_to: to,
      p_limit: 500,
      p_basis: 'settled',
    }).then(outcome);
    expect(best.ok, best.errorMessage).toBe(true);
    type Best = { menu_item_id: string; name_en: string; name_ar: string; qty: number; revenue_iqd: number; share_pct: number; orders: number };
    const rows = best.data as Best[];
    const mine = rows.find((r) => r.menu_item_id === costed.itemId);
    expect(mine).toBeDefined();
    expect(Number(mine!.qty)).toBeGreaterThanOrEqual(2);
    expect(Number(mine!.revenue_iqd)).toBeGreaterThanOrEqual(8_000);
    expect(mine!.orders).toBeGreaterThanOrEqual(1);
    expect(mine!.name_ar.length).toBeGreaterThan(0);
    const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
    expect(Number(mine!.share_pct)).toBeCloseTo((Number(mine!.qty) * 100) / totalQty, 0);
    // Sorted by qty desc.
    for (let i = 1; i < rows.length; i++) expect(Number(rows[i - 1]!.qty)).toBeGreaterThanOrEqual(Number(rows[i]!.qty));

    const sold = await appRpc(owner, 'analytics_sold_items', { p_from: from, p_to: to, p_basis: 'settled' }).then(outcome);
    expect(sold.ok, sold.errorMessage).toBe(true);
    type Sold = { business_date: string; menu_item_id: string; qty: number; revenue_iqd: number; list_revenue_iqd: number; discount_iqd: number };
    const soldRows = sold.data as Sold[];
    const c = soldRows.find((r) => r.menu_item_id === costed.itemId && r.business_date === day)!;
    const u = soldRows.find((r) => r.menu_item_id === uncosted.itemId && r.business_date === day)!;
    expect(c).toBeDefined();
    expect(u).toBeDefined();
    expect(Number(c.qty)).toBeGreaterThanOrEqual(2);
    expect(Number(u.qty)).toBeGreaterThanOrEqual(1);
    for (const r of [c, u]) {
      expect(Number(r.list_revenue_iqd)).toBe(Number(r.revenue_iqd) + Number(r.discount_iqd));
      expect(Number(r.discount_iqd)).toBe(0); // no promo on these items
    }

    const badBasis = await appRpc(owner, 'analytics_best_sellers', { p_from: from, p_to: to, p_basis: 'paid' }).then(outcome);
    expect(badBasis.errorMessage).toContain('INVALID_ARGUMENT');
    const badLimit = await appRpc(owner, 'analytics_best_sellers', { p_from: from, p_to: to, p_limit: 0 }).then(outcome);
    expect(badLimit.errorMessage).toContain('INVALID_ARGUMENT');
  });

  it('analytics_bought_together finds the seeded pair (p_min_support=1) with consistent counts', async () => {
    const res = await appRpc(owner, 'analytics_bought_together', {
      p_from: from,
      p_to: to,
      p_min_support: 1,
      p_limit: 500,
      p_scope: 'order',
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    type Pair = {
      item_a: string; item_b: string; both: number; count_a: number; count_b: number;
      confidence_ab: number; confidence_ba: number; lift: number; orders_total: number;
      name_a_en: string; name_b_ar: string;
    };
    const pairs = res.data as Pair[];
    const [lo, hi] = [costed.itemId, uncosted.itemId].sort();
    const pair = pairs.find((p) => p.item_a === lo && p.item_b === hi);
    expect(pair, 'seeded pair missing').toBeDefined();
    expect(pair!.both).toBeGreaterThanOrEqual(1);
    expect(pair!.count_a).toBeGreaterThanOrEqual(pair!.both);
    expect(pair!.count_b).toBeGreaterThanOrEqual(pair!.both);
    expect(Number(pair!.confidence_ab)).toBeCloseTo(pair!.both / pair!.count_a, 3);
    expect(Number(pair!.confidence_ba)).toBeCloseTo(pair!.both / pair!.count_b, 3);
    expect(Number(pair!.lift)).toBeCloseTo((pair!.both * pair!.orders_total) / (pair!.count_a * pair!.count_b), 2);
    expect(pair!.orders_total).toBeGreaterThanOrEqual(1);
    expect(pair!.name_a_en.length).toBeGreaterThan(0);
    expect(pair!.name_b_ar.length).toBeGreaterThan(0);
    // item_a < item_b invariant on every pair.
    for (const p of pairs) expect(p.item_a < p.item_b).toBe(true);

    const badScope = await appRpc(owner, 'analytics_bought_together', { p_from: from, p_to: to, p_scope: 'basket' }).then(outcome);
    expect(badScope.errorMessage).toContain('INVALID_ARGUMENT');
  });

  it('analytics_item_margins: NULL-cost item reported as has_cost=false (never 0) and coverage math holds', async () => {
    const res = await appRpc(owner, 'analytics_item_margins', { p_from: from, p_to: to, p_basis: 'settled' }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    type Item = {
      menu_item_id: string; qty: number; revenue_iqd: number; avg_price_iqd: number;
      cost_iqd: number | null; cost_total_iqd: number | null; margin_iqd: number | null;
      margin_pct: number | null; has_cost: boolean;
    };
    const d = res.data as { basis: string; cost_as_of: string; items: Item[]; coverage: { revenue_with_cost_pct: number; items_with_cost: number; items_total: number } };
    expect(d.basis).toBe('settled');
    expect(d.cost_as_of).toBeTruthy();

    const c = d.items.find((i) => i.menu_item_id === costed.itemId)!;
    const u = d.items.find((i) => i.menu_item_id === uncosted.itemId)!;
    expect(c).toBeDefined();
    expect(u).toBeDefined();

    expect(c.has_cost).toBe(true);
    expect(Number(c.cost_iqd)).toBe(900);
    expect(Number(c.cost_total_iqd)).toBe(900 * Number(c.qty));
    expect(Number(c.margin_iqd)).toBe(Number(c.revenue_iqd) - 900 * Number(c.qty));
    expect(Number(c.margin_pct)).toBeCloseTo((Number(c.margin_iqd) * 100) / Number(c.revenue_iqd), 1);
    expect(Number(c.avg_price_iqd)).toBe(Math.round(Number(c.revenue_iqd) / Number(c.qty)));

    expect(u.has_cost).toBe(false);
    expect(u.cost_iqd).toBeNull();
    expect(u.cost_total_iqd).toBeNull();
    expect(u.margin_iqd).toBeNull();
    expect(u.margin_pct).toBeNull();
    expect(Number(u.revenue_iqd)).toBeGreaterThanOrEqual(12_000);

    // Coverage recomputed from the item list.
    const withCost = d.items.filter((i) => i.has_cost);
    expect(d.coverage.items_total).toBe(d.items.length);
    expect(d.coverage.items_with_cost).toBe(withCost.length);
    expect(d.coverage.items_with_cost).toBeLessThan(d.coverage.items_total);
    const revTotal = d.items.reduce((s, i) => s + Number(i.revenue_iqd), 0);
    const revWith = withCost.reduce((s, i) => s + Number(i.revenue_iqd), 0);
    expect(Number(d.coverage.revenue_with_cost_pct)).toBeCloseTo((revWith * 100) / revTotal, 1);
  });

  it('analytics_price_bands returns the four bands in order; items land by default-variant list price', async () => {
    const res = await appRpc(owner, 'analytics_price_bands', { p_from: from, p_to: to, p_basis: 'settled' }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    type Band = { band: string; items: string[]; qty: number; revenue_iqd: number };
    const bands = res.data as Band[];
    expect(bands.map((b) => b.band)).toEqual(['lt3000', '3000_5999', '6000_9999', 'gte10000']);
    expect(bands[1]!.items).toContain(costed.itemId); // 4,000
    expect(bands[3]!.items).toContain(uncosted.itemId); // 12,000
    expect(Number(bands[1]!.qty)).toBeGreaterThanOrEqual(2);
    expect(Number(bands[3]!.revenue_iqd)).toBeGreaterThanOrEqual(12_000);
    for (const b of bands) {
      expect(Array.isArray(b.items)).toBe(true);
      expect(Number.isInteger(Number(b.qty))).toBe(true);
    }
  });

  it('analytics_menu_snapshot carries the current cost (NULL when unknown) and the 0027 flags', async () => {
    const res = await appRpc(owner, 'analytics_menu_snapshot', {}).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    type Snap = {
      menu_item_id: string; price_iqd: number; cost_iqd: number | null; is_active: boolean;
      sold_out: boolean; highlight: string; has_photo: boolean; category_name_ar: string;
    };
    const snap = res.data as Snap[];
    const c = snap.find((s) => s.menu_item_id === costed.itemId)!;
    expect(c).toBeDefined();
    expect(Number(c.price_iqd)).toBe(4_000);
    expect(Number(c.cost_iqd)).toBe(900);
    expect(c.is_active).toBe(true);
    expect(c.sold_out).toBe(false);
    expect(c.highlight).toBe('none');
    expect(c.has_photo).toBe(false);
    const u = snap.find((s) => s.menu_item_id === uncosted.itemId)!;
    expect(u.cost_iqd).toBeNull();

    // Costed FIXTURE item (fixtures/menu.sql) when the fixtures are loaded.
    const capp = snap.find((s) => s.menu_item_id === FIXTURE_CAPPUCCINO);
    if (capp) {
      expect(Number(capp.cost_iqd)).toBe(1_100);
      expect(capp.category_name_ar.length).toBeGreaterThan(0);
    }
  });

  it('analytics_hourly / analytics_promo answer for the range (shape only)', async () => {
    const hourly = await appRpc(owner, 'analytics_hourly', { p_from: from, p_to: to }).then(outcome);
    expect(hourly.ok, hourly.errorMessage).toBe(true);
    type Hour = { dow: number; hour: number; orders: number; qty: number; revenue_iqd: number };
    const h = hourly.data as Hour[];
    expect(h.length).toBeGreaterThan(0);
    for (const x of h) {
      expect(x.dow).toBeGreaterThanOrEqual(0);
      expect(x.dow).toBeLessThanOrEqual(6);
      expect(x.hour).toBeGreaterThanOrEqual(0);
      expect(x.hour).toBeLessThanOrEqual(23);
    }
    const promo = await appRpc(owner, 'analytics_promo', { p_from: from, p_to: to }).then(outcome);
    expect(promo.ok, promo.errorMessage).toBe(true);
    const p = promo.data as { qty: number; list_revenue_iqd: number; revenue_iqd: number; discount_iqd: number; by_day: unknown[] };
    expect(Number(p.list_revenue_iqd)).toBe(Number(p.revenue_iqd) + Number(p.discount_iqd));
    expect(Array.isArray(p.by_day)).toBe(true);
  });

  it('exclusions: analytics_excluded_item_ids drops an item from rankings but never from daily revenue', async () => {
    const before = await appRpc(owner, 'analytics_daily_sales', { p_from: from, p_to: to }).then(outcome);
    const revBefore = (before.data as Daily[]).find((r) => r.business_date === day)!.revenue_iqd;

    await setCafeSetting(owner, 'analytics_excluded_item_ids', [uncosted.itemId]);
    try {
      const best = await appRpc(owner, 'analytics_best_sellers', { p_from: from, p_to: to, p_limit: 500 }).then(outcome);
      expect(best.ok, best.errorMessage).toBe(true);
      const ids = (best.data as { menu_item_id: string }[]).map((r) => r.menu_item_id);
      expect(ids).not.toContain(uncosted.itemId);
      expect(ids).toContain(costed.itemId);

      const pairs = await appRpc(owner, 'analytics_bought_together', { p_from: from, p_to: to, p_min_support: 1, p_limit: 500 }).then(outcome);
      const touching = (pairs.data as { item_a: string; item_b: string }[]).filter(
        (p) => p.item_a === uncosted.itemId || p.item_b === uncosted.itemId,
      );
      expect(touching).toHaveLength(0);

      const after = await appRpc(owner, 'analytics_daily_sales', { p_from: from, p_to: to }).then(outcome);
      const revAfter = (after.data as Daily[]).find((r) => r.business_date === day)!.revenue_iqd;
      expect(Number(revAfter)).toBe(Number(revBefore)); // revenue is revenue
    } finally {
      await setCafeSetting(owner, 'analytics_excluded_item_ids', []);
    }
  });

  it('owner gate: manager / cashier get FORBIDDEN on every analytics surface; INVALID_RANGE', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['analytics_daily_sales', { p_from: from, p_to: to }],
      ['analytics_sold_items', { p_from: from, p_to: to }],
      ['analytics_best_sellers', { p_from: from, p_to: to }],
      ['analytics_bought_together', { p_from: from, p_to: to }],
      ['analytics_item_margins', { p_from: from, p_to: to }],
      ['analytics_price_bands', { p_from: from, p_to: to }],
      ['analytics_hourly', { p_from: from, p_to: to }],
      ['analytics_promo', { p_from: from, p_to: to }],
      ['analytics_menu_snapshot', {}],
      ['save_analytics_patterns', { p_range_from: from, p_range_to: to, p_locale: 'ar', p_patterns: [] }],
      ['reject_insight', { p_text: 'manager tries 1' }],
    ];
    for (const [fn, args] of calls) {
      const m = await appRpc(manager, fn, args).then(outcome);
      expect(m.ok, `${fn} as manager`).toBe(false);
      expect(m.errorMessage, `${fn} as manager`).toContain('FORBIDDEN');
      const c = await appRpc(cashier, fn, args).then(outcome);
      expect(c.errorMessage, `${fn} as cashier`).toContain('FORBIDDEN');
    }

    const inverted = await appRpc(owner, 'analytics_daily_sales', { p_from: to, p_to: from }).then(outcome);
    expect(inverted.errorMessage).toContain('INVALID_RANGE');
    const tooLong = await appRpc(owner, 'analytics_daily_sales', { p_from: '2020-01-01', p_to: '2021-06-01' }).then(outcome);
    expect(tooLong.errorMessage).toContain('INVALID_RANGE');

    // Internal helpers are not client-callable at all.
    const internal = await appRpc(owner, 'analytics_sales_lines', {
      p_basis: 'settled', p_ts_from: window.ts_from, p_ts_to: window.ts_to, p_tz: 'Asia/Baghdad', p_start_hour: 4,
    });
    expect(internal.error?.message).toMatch(/permission denied/i);
    const norm = await appRpc(owner, 'normalize_finding', { p_text: 'x' });
    expect(norm.error?.message).toMatch(/permission denied/i);
  });

  it('reject_insight dedupes on text_key (normalized); unreject removes it; owner-only reads', async () => {
    const stamp = Date.now();
    const a = `Latte sold 12,500 IQD on Friday — test ${stamp}!`;
    const b = `latte   SOLD ١٢٬٥٠٠ iqd on friday - TEST ${stamp}`;
    const first = await appRpc(owner, 'reject_insight', { p_text: a, p_reason: 'not true' }).then(outcome);
    expect(first.ok, first.errorMessage).toBe(true);
    const id = first.data as string;
    const second = await appRpc(owner, 'reject_insight', { p_text: b }).then(outcome);
    expect(second.ok, second.errorMessage).toBe(true);
    expect(second.data).toBe(id);

    const { data: rows } = await owner
      .from('analytics_insight_rejections')
      .select('id, text, text_key, reason')
      .eq('id', id);
    expect(rows).toHaveLength(1);
    const row = rows![0] as { text: string; text_key: string; reason: string };
    expect(row.text).toBe(a); // first wording kept
    expect(row.text_key).toBe(normalizeFinding(a));
    expect(row.text_key).toBe(normalizeFinding(b));
    expect(row.reason).toBe('not true');

    const mgr = await manager.from('analytics_insight_rejections').select('id').eq('id', id);
    expect(mgr.error).toBeNull();
    expect(mgr.data).toHaveLength(0);

    const empty = await appRpc(owner, 'reject_insight', { p_text: '!!! ??? ...' }).then(outcome);
    expect(empty.errorMessage).toContain('INVALID_ARGUMENT');

    const un = await appRpc(owner, 'unreject_insight', { p_id: id }).then(outcome);
    expect(un.ok, un.errorMessage).toBe(true);
    const { data: gone } = await svc.from('analytics_insight_rejections').select('id').eq('id', id);
    expect(gone).toHaveLength(0);
    const unAgain = await appRpc(owner, 'unreject_insight', { p_id: id }).then(outcome);
    expect(unAgain.errorMessage).toContain('REJECTION_NOT_FOUND');
  });

  it('app.normalize_finding (service role) equals core normalizeFinding on mixed Arabic / punctuation / Arabic-digit text', async () => {
    const samples = [
      'Latte sold 12,500 IQD on Friday!',
      'الكابتشينو ارتفعت مبيعاته ٢٥٪ — ١٢٬٥٠٠ د.ع (يوم الجمعة)',
      'قهـــوة مَرْحَبًا بِكُمْ في تتش كافيه',
      'Kunafa ۱۲۳ pieces; burger 4,000 IQD / day',
      '  a-b_c   D.E   (F)  ',
      'Iced   Latte\tsold\n9 times',
      'كرواسون & قهوة: 3 مرات بـ 15,000 دينار',
      'Ümlaut Straße café 7 IQD',
      '',
      '!!! ???',
    ];
    for (const s of samples) {
      const { data, error } = await svc.schema('app').rpc('normalize_finding', { p_text: s });
      expect(error, s).toBeNull();
      expect(data ?? '', JSON.stringify(s)).toBe(normalizeFinding(s));
    }
  });

  it('save_analytics_insights / save_analytics_patterns: owner writes, owner reads, manager gets silence; validation', async () => {
    const insights = [
      { text: 'اللاتيه هو الأكثر مبيعاً بـ 12 وحدة', kind: 'best_seller', subjects: [costed.itemId], metrics: { qty: 12 }, confidence: 'high' },
    ];
    const saved = await appRpc(owner, 'save_analytics_insights', {
      p_range_from: from,
      p_range_to: to,
      p_compare_basis: '4w',
      p_locale: 'ar',
      p_insights: insights,
    }).then(outcome);
    expect(saved.ok, saved.errorMessage).toBe(true);
    const id = saved.data as string;

    const own = await owner.from('analytics_insights').select('id, range_from, range_to, compare_basis, locale, insights, created_by').eq('id', id);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    const row = own.data![0] as { compare_basis: string; locale: string; insights: unknown; created_by: string | null };
    expect(row.compare_basis).toBe('4w');
    expect(row.locale).toBe('ar');
    expect(row.insights).toEqual(insights);
    expect(row.created_by).not.toBeNull();

    const mgr = await manager.from('analytics_insights').select('id').eq('id', id);
    expect(mgr.error).toBeNull();
    expect(mgr.data).toHaveLength(0);

    const badBasis = await appRpc(owner, 'save_analytics_insights', {
      p_range_from: from, p_range_to: to, p_compare_basis: '2w', p_locale: 'ar', p_insights: [],
    }).then(outcome);
    expect(badBasis.errorMessage).toContain('INVALID_ARGUMENT');
    const notArray = await appRpc(owner, 'save_analytics_insights', {
      p_range_from: from, p_range_to: to, p_compare_basis: 'prev', p_locale: 'en', p_insights: { text: 'x' },
    }).then(outcome);
    expect(notArray.errorMessage).toContain('INVALID_ARGUMENT');
    const badRange = await appRpc(owner, 'save_analytics_insights', {
      p_range_from: to, p_range_to: from, p_compare_basis: 'prev', p_locale: 'en', p_insights: [],
    }).then(outcome);
    expect(badRange.errorMessage).toContain('INVALID_RANGE');

    const patterns = await appRpc(owner, 'save_analytics_patterns', {
      p_range_from: from, p_range_to: to, p_locale: 'en', p_patterns: [{ text: 'Friday evenings peak at 20:00' }],
    }).then(outcome);
    expect(patterns.ok, patterns.errorMessage).toBe(true);
    const pat = await owner.from('analytics_patterns').select('id, patterns').eq('id', patterns.data as string);
    expect(pat.data).toHaveLength(1);
    const mgrPat = await manager.from('analytics_patterns').select('id').eq('id', patterns.data as string);
    expect(mgrPat.data).toHaveLength(0);
  });
});
