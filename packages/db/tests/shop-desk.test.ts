/**
 * 0243–0246 — Touch Shop as its own desk (Parsa, 2026-09-27: "the touch shop
 * has its own desk, its own stock, its own items").
 *
 * Pins the rules that make the shop separate from the café:
 *   * the tab kind decides who works it: the shop assistant shop tabs only,
 *     the café cashier and the court desk café tabs only, MGMT both
 *     (TAB_KIND_FORBIDDEN); a shop sale carries no table or booking
 *     (SHOP_TAB_NO_ANCHOR), never meets a café line (TAB_KIND_MISMATCH) and is
 *     never merged with a café bill;
 *   * the shop store: goods in by the shop assistant lands there and nowhere
 *     else, shop stock is refused in the café and the bakery, nothing moves in
 *     or out of it, a sale draws from it and a return restocks it;
 *   * the shop assistant reads the shop's rows and none of the café's;
 *   * the shop's own sections, products and prices, set directly by the shop
 *     assistant (no price protocol) and never a café item;
 *   * the shop PC (station mode shop) has its own drawer, and the day close's
 *     Shop block (app.day_close_shop) adds up the shop's money and drawer.
 * shop.test.ts keeps the product model's own rules (0143–0146).
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
  DEV_PINS,
  createTestMenuItem,
  createTestCafeTable,
  createStaffOfRole,
  ensureOpenDay,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0243–0246 Touch Shop own desk', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let desk: SupabaseClient;
  let shop: SupabaseClient;
  let shopId: string;
  const categories: string[] = [];
  const STATION = `SHOPDESK-${Date.now().toString(36).toUpperCase()}`;
  let n = 0;

  async function shopProduct(tag: string, price = 20_000): Promise<{ itemId: string; variantId: string; ingredientId: string; categoryId: string }> {
    const cat = await appRpc(shop, 'upsert_shop_category', {
      p_name_en: `Desk ${tag}-${n}`,
      p_name_ar: `مكتب ${tag}-${n++}`,
      p_tax_group_id: SEED_TAX_GROUP_STANDARD,
    }).then(outcome);
    expect(cat.ok, cat.errorMessage).toBe(true);
    const categoryId = cat.data as string;
    categories.push(categoryId);
    const item = await appRpc(shop, 'upsert_menu_item', {
      p_category_id: categoryId,
      p_name_en: `Racket ${tag}`,
      p_name_ar: `مضرب ${tag}`,
      p_is_active: true,
    }).then(outcome);
    expect(item.ok, item.errorMessage).toBe(true);
    const size = await appRpc(shop, 'upsert_retail_variant', {
      p_item_id: item.data as string,
      p_name_en: 'One size',
      p_name_ar: 'مقاس واحد',
      p_price_iqd: price,
    }).then(outcome);
    expect(size.ok, size.errorMessage).toBe(true);
    const d = size.data as { variant_id: string; ingredient_id: string };
    return { itemId: item.data as string, variantId: d.variant_id, ingredientId: d.ingredient_id, categoryId };
  }

  async function receiveAsShop(ingredientId: string, qty: number, location?: string) {
    return appRpc(shop, 'receive_delivery', {
      p_lines: [{ ingredient_id: ingredientId, qty_received: qty, unit_cost_iqd: 10_000 }],
      p_idempotency_key: testIdemKey('receive'),
      ...(location ? { p_location: location } : {}),
    }).then(outcome);
  }

  async function onHandAt(ingredientId: string): Promise<Record<string, number>> {
    const { data } = await svc.from('stock_batches').select('location, qty_remaining').eq('ingredient_id', ingredientId);
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as { location: string; qty_remaining: number }[]) {
      out[r.location] = (out[r.location] ?? 0) + Number(r.qty_remaining);
    }
    return out;
  }

  async function shopSale(label = `Sale ${n++}`): Promise<string> {
    const res = await appRpc(shop, 'open_tab', {
      p_kind: 'shop',
      p_label: label,
      p_device_id: STATION,
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return (res.data as { tab_id: string }).tab_id;
  }

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    desk = await signedInClient(SEED_STAFF.court_desk);
    const made = await createStaffOfRole(svc, 'shop_staff', 'shopdesk');
    shop = made.client;
    shopId = made.id;
    await ensureOpenDay(manager, svc);
  });

  afterAll(async () => {
    if (categories.length > 0) {
      await svc.from('menu_items').update({ is_active: false }).in('category_id', categories);
      await svc.from('menu_categories').update({ is_active: false }).in('id', categories);
    }
    await svc.from('stations').update({ retired_at: new Date().toISOString() }).eq('id', STATION);
    for (const c of [owner, manager, cashier, desk, shop]) await c.auth.signOut();
    await svc.from('staff').update({ is_active: false }).eq('id', shopId);
  });

  it('lets each role work only its own kind of tab', async () => {
    // The shop assistant: shop sales yes, café bills no.
    const tableId = await createTestCafeTable(svc, 'SHOPDESK');
    const shopCafe = await appRpc(shop, 'open_tab', { p_table_id: tableId }).then(outcome);
    expect(shopCafe.errorMessage).toContain('TAB_KIND_FORBIDDEN');
    const sale = await shopSale();

    // The café cashier and the court desk: no shop sale, and no hands on one.
    for (const c of [cashier, desk]) {
      const opened = await appRpc(c, 'open_tab', { p_kind: 'shop', p_label: 'x' }).then(outcome);
      expect(opened.errorMessage).toContain('TAB_KIND_FORBIDDEN');
    }
    const p = await shopProduct('K');
    const cashierAdds = await appRpc(cashier, 'till_add_items', {
      p_tab_id: sale,
      p_items: [{ variant_id: p.variantId, qty: 1 }],
    }).then(outcome);
    expect(cashierAdds.errorMessage).toContain('TAB_KIND_FORBIDDEN');
    const cashierSettles = await appRpc(cashier, 'settle_tab', { p_tab_id: sale, p_method: 'card' }).then(outcome);
    expect(cashierSettles.errorMessage).toContain('TAB_KIND_FORBIDDEN');
    const cashierCancels = await appRpc(cashier, 'cancel_tab', { p_tab_id: sale, p_reason_code: 'x' }).then(outcome);
    expect(cashierCancels.errorMessage).toContain('TAB_KIND_FORBIDDEN');

    // MGMT works both.
    const mgrShop = await appRpc(manager, 'open_tab', { p_kind: 'shop', p_label: 'Manager sale' }).then(outcome);
    expect(mgrShop.ok, mgrShop.errorMessage).toBe(true);
    const mgrCafe = await appRpc(manager, 'open_tab', { p_table_id: tableId }).then(outcome);
    expect(mgrCafe.ok, mgrCafe.errorMessage).toBe(true);

    // The shop assistant cancels their own empty sale.
    const cancelled = await appRpc(shop, 'cancel_tab', { p_tab_id: sale, p_reason_code: 'test' }).then(outcome);
    expect(cancelled.ok, cancelled.errorMessage).toBe(true);
  });

  it('keeps a shop sale off tables, bookings and café bills', async () => {
    const tableId = await createTestCafeTable(svc, 'SHOPDESK2');
    const onTable = await appRpc(manager, 'open_tab', { p_kind: 'shop', p_label: 'x', p_table_id: tableId }).then(outcome);
    expect(onTable.errorMessage).toContain('SHOP_TAB_NO_ANCHOR');

    // A shop item on a café bill, and a café item on a shop sale.
    const p = await shopProduct('M');
    const cafe = await createTestMenuItem(svc, 'SHOPDESKM', 2_000);
    categories.push(cafe.categoryId);
    const cafeTab = await appRpc(cashier, 'open_tab', { p_table_id: tableId }).then(outcome);
    expect(cafeTab.ok, cafeTab.errorMessage).toBe(true);
    const cafeTabId = (cafeTab.data as { tab_id: string }).tab_id;
    const shopOnCafe = await appRpc(cashier, 'till_add_items', {
      p_tab_id: cafeTabId,
      p_items: [{ variant_id: p.variantId, qty: 1 }],
    }).then(outcome);
    expect(shopOnCafe.errorMessage).toContain('TAB_KIND_MISMATCH');
    const sale = await shopSale();
    const cafeOnShop = await appRpc(shop, 'till_add_items', {
      p_tab_id: sale,
      p_items: [{ variant_id: cafe.variantId, qty: 1 }],
    }).then(outcome);
    expect(cafeOnShop.errorMessage).toContain('TAB_KIND_MISMATCH');

    // Never one bill.
    const merged = await appRpc(manager, 'merge_tabs', { p_donor_tab_id: sale, p_survivor_tab_id: cafeTabId }).then(outcome);
    expect(merged.errorMessage).toContain('TAB_KIND_MISMATCH');
  });

  it('keeps shop stock in the shop store: goods in, sale, return; never the café or the bakery', async () => {
    const p = await shopProduct('S', 25_000);
    const beans = await createTestMenuItem(svc, 'SHOPDESKS', 1_000);
    categories.push(beans.categoryId);

    // The shop assistant receives into the shop store by default, and nowhere else.
    const got = await receiveAsShop(p.ingredientId, 4);
    expect(got.ok, got.errorMessage).toBe(true);
    expect((got.data as { location?: string }).location ?? 'shop').toBe('shop');
    expect(await onHandAt(p.ingredientId)).toEqual({ shop: 4 });
    const toCafe = await receiveAsShop(p.ingredientId, 1, 'cafe');
    expect(toCafe.errorMessage).toContain('FORBIDDEN');
    // A manager may not put shop stock in the café or the bakery either.
    for (const location of ['cafe', 'bakery']) {
      const res = await appRpc(manager, 'receive_delivery', {
        p_lines: [{ ingredient_id: p.ingredientId, qty_received: 1, unit_cost_iqd: 1 }],
        p_location: location,
      }).then(outcome);
      expect(res.errorMessage, location).toContain('INVALID_ARGUMENT');
    }
    // Nothing moves in or out of the shop store.
    const moved = await appRpc(manager, 'transfer_stock', {
      p_from: 'shop',
      p_to: 'cafe',
      p_lines: [{ ingredient_id: p.ingredientId, qty: 1 }],
    }).then(outcome);
    expect(moved.errorMessage).toContain('INVALID_ARGUMENT');

    // A sale draws from the shop store; a return goes back there.
    const sale = await shopSale();
    const sold = await appRpc(shop, 'till_add_items', {
      p_tab_id: sale,
      p_items: [{ variant_id: p.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
      p_device_id: STATION,
    }).then(outcome);
    expect(sold.ok, sold.errorMessage).toBe(true);
    expect(await onHandAt(p.ingredientId)).toEqual({ shop: 3 });
    const { data: moves } = await svc
      .from('stock_movements')
      .select('location')
      .eq('ingredient_id', p.ingredientId)
      .eq('movement_type', 'sale_consumption');
    expect((moves as { location: string }[]).map((m) => m.location)).toEqual(['shop']);

    const settled = await appRpc(shop, 'settle_tab', {
      p_tab_id: sale,
      p_method: 'cash',
      p_tendered_iqd: 30_000,
      p_device_id: STATION,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
    const { data: line } = await svc
      .from('order_items')
      .select('id')
      .eq('order_id', (sold.data as { order_id: string }).order_id)
      .single();
    const back = await appRpc(manager, 'refund', {
      p_payment_id: (settled.data as { payment_id: string }).payment_id,
      p_amount_iqd: 25_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'retail_return',
      p_items: [{ order_item_id: (line as { id: string }).id, qty: 1 }],
      p_idempotency_key: testIdemKey('payment.refund'),
    }).then(outcome);
    expect(back.ok, back.errorMessage).toBe(true);
    expect(await onHandAt(p.ingredientId)).toEqual({ shop: 4 });
  });

  it('shows the shop assistant the shop and nothing of the café', async () => {
    const tableId = await createTestCafeTable(svc, 'SHOPDESK3');
    const cafeTab = await appRpc(cashier, 'open_tab', { p_table_id: tableId }).then(outcome);
    const cafeTabId = (cafeTab.data as { tab_id: string }).tab_id;
    const sale = await shopSale();
    const p = await shopProduct('R');

    const { data: tabs } = await shop.from('tabs').select('id, kind').in('id', [sale, cafeTabId]);
    expect(tabs).toEqual([{ id: sale, kind: 'shop' }]);
    const { data: cafeSeen } = await cashier.from('tabs').select('id').eq('id', cafeTabId);
    expect(cafeSeen).toHaveLength(1);

    const cafeIng = await createTestMenuItem(svc, 'SHOPDESKR', 1_000);
    categories.push(cafeIng.categoryId);
    const { data: ings } = await shop.from('ingredients').select('id, kind').eq('id', p.ingredientId);
    expect(ings).toEqual([{ id: p.ingredientId, kind: 'retail' }]);
    const { data: purchased } = await shop.from('ingredients').select('id').neq('kind', 'retail').limit(1);
    expect(purchased).toEqual([]);
  });

  it('lets the shop assistant keep shop products and prices, and never a café item', async () => {
    const p = await shopProduct('P', 40_000);
    // A price change on a product already on sale goes straight through for
    // the shop assistant (Parsa, 2026-09-27); a manager's still goes through a
    // price change.
    const repriced = await appRpc(shop, 'upsert_retail_variant', {
      p_item_id: p.itemId,
      p_id: p.variantId,
      p_name_en: 'One size',
      p_name_ar: 'مقاس واحد',
      p_price_iqd: 45_000,
    }).then(outcome);
    expect(repriced.ok, repriced.errorMessage).toBe(true);
    const { data: v } = await svc.from('menu_item_variants').select('price_iqd').eq('id', p.variantId).single();
    expect((v as { price_iqd: number }).price_iqd).toBe(45_000);
    const mgr = await appRpc(manager, 'upsert_retail_variant', {
      p_item_id: p.itemId,
      p_id: p.variantId,
      p_name_en: 'One size',
      p_name_ar: 'مقاس واحد',
      p_price_iqd: 50_000,
    }).then(outcome);
    expect(mgr.errorMessage).toContain('PRICE_VIA_PROTOCOL');

    // Never the café: its categories, items and sizes are out of reach.
    const cafe = await createTestMenuItem(svc, 'SHOPDESKP', 3_000);
    categories.push(cafe.categoryId);
    const cafeCat = await appRpc(shop, 'upsert_shop_category', {
      p_id: cafe.categoryId,
      p_name_en: 'x',
      p_name_ar: 'x',
      p_tax_group_id: SEED_TAX_GROUP_STANDARD,
    }).then(outcome);
    expect(cafeCat.errorMessage).toContain('FORBIDDEN');
    const cafeItem = await appRpc(shop, 'upsert_menu_item', {
      p_category_id: cafe.categoryId,
      p_name_en: 'Latte',
      p_name_ar: 'لاتيه',
    }).then(outcome);
    expect(cafeItem.errorMessage).toContain('FORBIDDEN');
    const cafePrice = await appRpc(shop, 'upsert_variant', {
      p_item_id: cafe.itemId,
      p_id: cafe.variantId,
      p_name_en: 'Regular',
      p_name_ar: 'عادي',
      p_price_iqd: 1,
    }).then(outcome);
    expect(cafePrice.errorMessage).toContain('FORBIDDEN');
    const { data: kind } = await svc.from('menu_categories').select('kind').eq('id', p.categoryId).single();
    expect((kind as { kind: string }).kind).toBe('shop');

    // Suppliers are the shop assistant's too; the cashier still has none.
    const sup = await appRpc(shop, 'upsert_supplier', { p_name: `Desk supplier ${Date.now()}` }).then(outcome);
    expect(sup.ok, sup.errorMessage).toBe(true);
    await svc.from('suppliers').update({ is_active: false }).eq('id', sup.data as string);
  });

  it('gives the shop PC its own drawer, and the day close a Shop block', async () => {
    const reg = await appRpc(manager, 'register_station', { p_id: STATION, p_venue_id: VENUE_A_ID, p_mode: 'shop' }).then(outcome);
    expect(reg.ok, reg.errorMessage).toBe(true);
    expect((reg.data as { mode: string; is_till: boolean })).toMatchObject({ mode: 'shop', is_till: false });

    const beat = await appRpc(shop, 'heartbeat', {
      p_device_id: STATION,
      p_queue_depth: 0,
      p_app_version: 'shop-desk-test',
      p_is_till: false,
    }).then(outcome);
    expect(beat.ok, beat.errorMessage).toBe(true);
    const opened = await appRpc(shop, 'open_till_shift', {
      p_opening_float_iqd: 50_000,
      p_device_id: STATION,
      p_idempotency_key: `till_shift.open:${crypto.randomUUID()}`,
    }).then(outcome);
    expect(opened.ok, opened.errorMessage).toBe(true);
    const shiftId = (opened.data as { till_shift: { id: string } }).till_shift.id;

    const before = await appRpc(shop, 'day_close_shop', {}).then(outcome);
    expect(before.ok, before.errorMessage).toBe(true);
    const was = before.data as { sales_iqd: number; by_method: Record<string, number> };

    const p = await shopProduct('D', 15_000);
    expect((await receiveAsShop(p.ingredientId, 2)).ok).toBe(true);
    const sale = await shopSale();
    const sold = await appRpc(shop, 'till_add_items', {
      p_tab_id: sale,
      p_items: [{ variant_id: p.variantId, qty: 1 }],
      p_device_id: STATION,
    }).then(outcome);
    expect(sold.ok, sold.errorMessage).toBe(true);
    const settled = await appRpc(shop, 'settle_tab', {
      p_tab_id: sale,
      p_method: 'cash',
      p_tendered_iqd: 20_000,
      p_device_id: STATION,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
    const { data: pay } = await svc
      .from('payments')
      .select('till_shift_id, amount_iqd')
      .eq('id', (settled.data as { payment_id: string }).payment_id)
      .single();
    expect(pay).toMatchObject({ till_shift_id: shiftId });

    const after = await appRpc(shop, 'day_close_shop', {}).then(outcome);
    expect(after.ok, after.errorMessage).toBe(true);
    const now = after.data as {
      sales_iqd: number;
      by_method: Record<string, number>;
      open_sales: { tab_id: string }[];
      shifts: { till_shift_id: string; station_id: string }[];
    };
    const paid = Number((pay as { amount_iqd: number }).amount_iqd);
    expect(Number(now.sales_iqd) - Number(was.sales_iqd)).toBe(paid);
    expect(Number(now.by_method.cash ?? 0) - Number(was.by_method.cash ?? 0)).toBe(paid);
    expect(now.shifts.map((s) => s.till_shift_id)).toContain(shiftId);
    expect(now.open_sales.map((t) => t.tab_id)).not.toContain(sale);

    // The café cashier does not read the shop's block.
    const cashierRead = await appRpc(cashier, 'day_close_shop', {}).then(outcome);
    expect(cashierRead.errorMessage).toContain('FORBIDDEN');

    // The shift closes with a manager's grant (the test account has no PIN).
    await svc.from('till_shifts').update({ closed_at: new Date().toISOString(), closed_via: 'day_close' }).eq('id', shiftId);
  });
});
