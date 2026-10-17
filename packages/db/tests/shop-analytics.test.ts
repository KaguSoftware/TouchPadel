/**
 * 0346 — Touch Shop in the owner's analytics, counted as padel revenue.
 *
 * app.analytics_shop summarises the analysed branch's shop sales (a settled
 * kind 'shop' tab) for a business-day range, and app.analytics_daily_sales is
 * café only from 0346: a shop sale moves from café to padel, it is never
 * counted twice. Owner only, like every analytics_* RPC.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  testIdemKey,
  SEED_STAFF,
  SEED_TAX_GROUP_STANDARD,
  VENUE_A_ID,
  createStaffOfRole,
  ensureOpenDay,
} from './helpers';

const up = await stackAvailable();

interface ShopKpis {
  sales: number;
  net_iqd: number;
  gross_iqd: number;
  refunds_iqd: number;
  units: number;
  avg_sale_iqd: number | null;
  costed_units: number;
  cost_iqd: number;
  margin_iqd: number | null;
  margin_pct: number | null;
  cash_iqd: number;
  card_iqd: number;
}
interface ShopItem {
  menu_item_id: string;
  variant_id: string;
  name_en: string;
  variant_en: string | null;
  units: number;
  sales: number;
  net_iqd: number;
  costed_units: number;
  margin_iqd: number | null;
}
interface ShopPayload {
  range: { from: string; to: string };
  kpis: ShopKpis;
  by_day: { business_date: string; sales: number; net_iqd: number; units: number }[];
  by_hour: { hour: number; sales: number; net_iqd: number }[];
  items: ShopItem[];
  categories: { category_id: string; name_en: string; units: number; net_iqd: number }[];
}
interface DailyRow {
  revenue_iqd: number;
  cash_iqd: number;
  card_iqd: number;
  tabs_settled: number;
  orders: number;
  items_qty: number;
}

// The settle lands on the venue's business day, which does not turn over at
// UTC midnight: a window of the UTC day either side always holds it, and the
// before/after differences keep every check exact.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const RANGE = { p_from: day(-1), p_to: day(1) };

describe.skipIf(!up)('0346 shop analytics', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let shop: SupabaseClient;
  let shopId: string;
  let categoryId: string;

  async function readShop(): Promise<ShopPayload> {
    const res = await appRpc(owner, 'analytics_shop', RANGE).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return res.data as ShopPayload;
  }
  async function readCafe(): Promise<DailyRow> {
    const res = await appRpc(owner, 'analytics_daily_sales', RANGE).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const rows = res.data as DailyRow[];
    const sum = (k: keyof DailyRow) => rows.reduce((s, r) => s + Number(r[k]), 0);
    return {
      revenue_iqd: sum('revenue_iqd'),
      cash_iqd: sum('cash_iqd'),
      card_iqd: sum('card_iqd'),
      tabs_settled: sum('tabs_settled'),
      orders: sum('orders'),
      items_qty: sum('items_qty'),
    };
  }

  /** One sale at the shop desk: a shop tab, the lines, settled by `method`. */
  async function sell(lines: { variant_id: string; qty: number }[], method: 'cash' | 'card'): Promise<void> {
    const tab = await appRpc(shop, 'open_tab', {
      p_label: `Sale ${Date.now()}`,
      p_kind: 'shop',
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(tab.ok, tab.errorMessage).toBe(true);
    const tabId = (tab.data as { tab_id: string }).tab_id;
    const add = await appRpc(shop, 'till_add_items', {
      p_tab_id: tabId,
      p_items: lines,
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    expect(add.ok, add.errorMessage).toBe(true);
    const settled = await appRpc(shop, 'settle_tab', {
      p_tab_id: tabId,
      p_method: method,
      ...(method === 'cash' ? { p_tendered_iqd: 1_000_000 } : {}),
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
  }

  async function product(tag: string, priceIqd: number): Promise<{ itemId: string; variantId: string }> {
    const { data, error } = await svc
      .from('menu_items')
      .insert({ category_id: categoryId, name_en: `Ball tube ${tag}`, name_ar: `علبة كرات ${tag}`, is_active: true, venue_id: VENUE_A_ID })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const itemId = (data as { id: string }).id;
    const v = await appRpc(owner, 'upsert_retail_variant', {
      p_item_id: itemId,
      p_name_en: 'Tube',
      p_name_ar: 'علبة',
      p_price_iqd: priceIqd,
    }).then(outcome);
    expect(v.ok, v.errorMessage).toBe(true);
    const d = v.data as { variant_id: string; ingredient_id: string };
    const got = await appRpc(manager, 'receive_delivery', {
      p_lines: [{ ingredient_id: d.ingredient_id, qty_received: 10, unit_cost_iqd: 6_000 }],
      p_idempotency_key: testIdemKey('receive'),
      p_location: 'shop',
    }).then(outcome);
    expect(got.ok, got.errorMessage).toBe(true);
    return { itemId, variantId: d.variant_id };
  }

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    const made = await createStaffOfRole(svc, 'shop_staff', 'shopanalytics');
    shop = made.client;
    shopId = made.id;
    await ensureOpenDay(manager, svc);
    const { data, error } = await svc
      .from('menu_categories')
      .insert({ name_en: `Shop analytics ${Date.now()}`, name_ar: 'تحليلات المتجر', tax_group_id: SEED_TAX_GROUP_STANDARD, is_active: true, venue_id: VENUE_A_ID })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    categoryId = (data as { id: string }).id;
    const set = await appRpc(manager, 'set_category_kind', { p_id: categoryId, p_kind: 'shop' }).then(outcome);
    expect(set.ok, set.errorMessage).toBe(true);
  });

  afterAll(async () => {
    if (categoryId) {
      await svc.from('menu_items').update({ is_active: false }).eq('category_id', categoryId);
      await svc.from('menu_categories').update({ is_active: false }).eq('id', categoryId);
    }
    await owner?.auth.signOut();
    await manager?.auth.signOut();
    await shop?.auth.signOut();
    if (shopId) await svc.from('staff').update({ is_active: false }).eq('id', shopId);
  });

  it('is the owner\'s alone', async () => {
    const res = await appRpc(manager, 'analytics_shop', RANGE).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('FORBIDDEN');
  });

  it('refuses a backwards range', async () => {
    const res = await appRpc(owner, 'analytics_shop', { p_from: day(1), p_to: day(-1) }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('INVALID_RANGE');
  });

  it('counts a shop sale in the shop figures and takes it out of the café', async () => {
    const shopBefore = await readShop();
    const cafeBefore = await readCafe();
    const a = await product('A', 10_000);
    const b = await product('B', 25_000);

    await sell([{ variant_id: a.variantId, qty: 2 }, { variant_id: b.variantId, qty: 1 }], 'cash');
    await sell([{ variant_id: a.variantId, qty: 1 }], 'card');

    const shopAfter = await readShop();
    const cafeAfter = await readCafe();
    const k0 = shopBefore.kpis;
    const k1 = shopAfter.kpis;

    // Two sales, 45,000 + 10,000, four units at a 6,000 cost each.
    expect(k1.sales - k0.sales).toBe(2);
    expect(k1.net_iqd - k0.net_iqd).toBe(55_000);
    expect(k1.units - k0.units).toBe(4);
    expect(k1.cash_iqd - k0.cash_iqd).toBe(45_000);
    expect(k1.card_iqd - k0.card_iqd).toBe(10_000);
    expect(k1.costed_units - k0.costed_units).toBe(4);
    expect(k1.cost_iqd - k0.cost_iqd).toBe(24_000);
    expect(k1.margin_iqd).not.toBeNull();
    expect(k1.avg_sale_iqd).not.toBeNull();

    const itemA = shopAfter.items.find((i) => i.menu_item_id === a.itemId);
    expect(itemA).toMatchObject({ units: 3, sales: 2, net_iqd: 30_000, costed_units: 3, margin_iqd: 12_000, variant_en: 'Tube' });
    const itemB = shopAfter.items.find((i) => i.menu_item_id === b.itemId);
    expect(itemB).toMatchObject({ units: 1, sales: 1, net_iqd: 25_000, margin_iqd: 19_000 });
    const cat = shopAfter.categories.find((c) => c.category_id === categoryId);
    expect(cat).toMatchObject({ units: 4, net_iqd: 55_000 });

    const sumDays = (p: ShopPayload) => p.by_day.reduce((s, d) => s + Number(d.net_iqd), 0);
    expect(sumDays(shopAfter) - sumDays(shopBefore)).toBe(55_000);
    const sumHours = (p: ShopPayload) => p.by_hour.reduce((s, h) => s + Number(h.sales), 0);
    expect(sumHours(shopAfter) - sumHours(shopBefore)).toBe(2);

    // Café money, payments, tabs, orders and lines do not move: the shop
    // sale is padel revenue now, never café as well.
    expect(cafeAfter).toEqual(cafeBefore);
  });

  it('returns counts, money and product names only', async () => {
    const p = await readShop();
    expect(Object.keys(p).sort()).toEqual(['by_day', 'by_hour', 'categories', 'items', 'kpis', 'range']);
    expect(Object.keys(p.kpis).sort()).toEqual(
      [
        'avg_sale_iqd',
        'card_iqd',
        'cash_iqd',
        'cost_iqd',
        'costed_units',
        'discount_iqd',
        'gross_iqd',
        'margin_iqd',
        'margin_pct',
        'net_iqd',
        'refunded_sales',
        'refunds_iqd',
        'sales',
        'units',
      ].sort(),
    );
    const text = JSON.stringify(p);
    for (const k of ['staff', 'customer', 'phone', 'profile', 'guest']) expect(text).not.toContain(`"${k}`);
  });
});
