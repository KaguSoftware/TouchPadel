/**
 * 0143–0146 — Touch Shop (Phase 2 item 5).
 *
 * A retail product is a menu item in a kind = 'shop' section; each size owns
 * one `retail` ingredient (unit pc) and a qty-1 recipe line. These cases pin
 * the rules that model depends on: the one-ingredient-per-variant invariant,
 * per-venue barcode / SKU uniqueness, idempotent goods-in with a supplier,
 * the counter sale with no table, the no-kitchen-ticket sale path, the
 * mixed-basket and guest refusals, restock on void and on return, the
 * any-size-in-stock availability rule and the "of which shop" revenue line.
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
  DEV_PINS,
  SEED_TAX_GROUP_STANDARD,
  VENUE_A_ID,
  createTestMenuItem,
  createTestCafeTable,
  openGuestSession,
  ensureOpenDay,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0143–0146 Touch Shop', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  const categories: string[] = [];
  const suppliers: string[] = [];
  let n = 0;

  /** A fresh, empty section switched to shop through the RPC under test. */
  async function shopSection(tag: string): Promise<string> {
    const { data, error } = await svc
      .from('menu_categories')
      .insert({
        name_en: `Shop ${tag}-${n}`,
        name_ar: `متجر ${tag}-${n++}`,
        tax_group_id: SEED_TAX_GROUP_STANDARD,
        is_active: true,
        venue_id: VENUE_A_ID,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    categories.push(id);
    const set = await appRpc(manager, 'set_category_kind', { p_id: id, p_kind: 'shop' }).then(outcome);
    expect(set.ok, set.errorMessage).toBe(true);
    return id;
  }

  async function shopItem(categoryId: string, tag: string): Promise<string> {
    const { data, error } = await svc
      .from('menu_items')
      .insert({
        category_id: categoryId,
        name_en: `Racket ${tag}`,
        name_ar: `مضرب ${tag}`,
        is_active: true,
        venue_id: VENUE_A_ID,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function retailVariant(
    itemId: string,
    over: Record<string, unknown> = {},
  ): Promise<{ variantId: string; ingredientId: string }> {
    const res = await appRpc(manager, 'upsert_retail_variant', {
      p_item_id: itemId,
      p_name_en: 'M',
      p_name_ar: 'وسط',
      p_price_iqd: 50_000,
      ...over,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { variant_id: string; ingredient_id: string };
    return { variantId: d.variant_id, ingredientId: d.ingredient_id };
  }

  async function receive(ingredientId: string, qty: number, key = testIdemKey('receive')) {
    return appRpc(manager, 'receive_delivery', {
      p_lines: [{ ingredient_id: ingredientId, qty_received: qty, unit_cost_iqd: 30_000 }],
      p_idempotency_key: key,
    }).then(outcome);
  }

  async function onHand(ingredientId: string): Promise<number> {
    const { data } = await svc
      .from('stock_batches')
      .select('qty_remaining')
      .eq('ingredient_id', ingredientId);
    return (data as { qty_remaining: number }[]).reduce((s, r) => s + Number(r.qty_remaining), 0);
  }

  async function counterTab(label = `Walk-in ${n++}`): Promise<string> {
    const res = await appRpc(cashier, 'open_tab', {
      p_label: label,
      p_kind: 'shop',
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
    await ensureOpenDay(manager, svc);
  });

  afterAll(async () => {
    if (categories.length > 0) {
      await svc.from('menu_items').update({ is_active: false }).in('category_id', categories);
      await svc.from('menu_categories').update({ is_active: false }).in('id', categories);
    }
    if (suppliers.length > 0) {
      await svc.from('suppliers').update({ is_active: false }).in('id', suppliers);
    }
    await owner.auth.signOut();
    await manager.auth.signOut();
    await cashier.auth.signOut();
  });

  it('switches a section to shop only while it is empty, manager+ only', async () => {
    const cafe = await createTestMenuItem(svc, 'SHOPK', 1_000);
    categories.push(cafe.categoryId);
    const notEmpty = await appRpc(manager, 'set_category_kind', {
      p_id: cafe.categoryId,
      p_kind: 'shop',
    }).then(outcome);
    expect(notEmpty.errorMessage).toContain('CATEGORY_NOT_EMPTY');

    const id = await shopSection('K');
    const { data } = await svc.from('menu_categories').select('kind').eq('id', id).single();
    expect((data as { kind: string }).kind).toBe('shop');

    const cashierTry = await appRpc(cashier, 'set_category_kind', { p_id: id, p_kind: 'cafe' }).then(outcome);
    expect(cashierTry.errorMessage).toContain('FORBIDDEN');
  });

  it('gives every retail size exactly one pc ingredient and one qty-1 recipe line', async () => {
    const item = await shopItem(await shopSection('V'), 'V');
    const first = await retailVariant(item, { p_sku: 'RKT-V-M', p_barcode: `62${Date.now()}` });

    const { data: ing } = await svc
      .from('ingredients')
      .select('kind, unit, variant_id, venue_id')
      .eq('id', first.ingredientId)
      .single();
    expect(ing).toMatchObject({ kind: 'retail', unit: 'pc', variant_id: first.variantId, venue_id: VENUE_A_ID });
    const { data: lines } = await svc
      .from('recipe_lines')
      .select('ingredient_id, qty')
      .eq('variant_id', first.variantId);
    expect(lines).toEqual([{ ingredient_id: first.ingredientId, qty: 1 }]);

    // An edit keeps the same stock row.
    const again = await retailVariant(item, { p_id: first.variantId, p_price_iqd: 55_000 });
    expect(again.ingredientId).toBe(first.ingredientId);

    const cafe = await createTestMenuItem(svc, 'SHOPV', 1_000);
    categories.push(cafe.categoryId);
    const wrong = await appRpc(manager, 'upsert_retail_variant', {
      p_item_id: cafe.itemId,
      p_name_en: 'M',
      p_name_ar: 'وسط',
      p_price_iqd: 1_000,
    }).then(outcome);
    expect(wrong.errorMessage).toContain('NOT_SHOP_CATEGORY');

    const cashierTry = await appRpc(cashier, 'upsert_retail_variant', {
      p_item_id: item,
      p_name_en: 'L',
      p_name_ar: 'كبير',
      p_price_iqd: 1_000,
    }).then(outcome);
    expect(cashierTry.errorMessage).toContain('FORBIDDEN');
  });

  it('refuses a second barcode or SKU at the same venue', async () => {
    const item = await shopItem(await shopSection('B'), 'B');
    const code = `63${Date.now()}`;
    await retailVariant(item, { p_barcode: code, p_sku: `SKU-${code}` });
    const dupCode = await appRpc(manager, 'upsert_retail_variant', {
      p_item_id: item,
      p_name_en: 'L',
      p_name_ar: 'كبير',
      p_price_iqd: 1_000,
      p_barcode: code,
    }).then(outcome);
    expect(dupCode.errorMessage).toContain('BARCODE_TAKEN');
    const dupSku = await appRpc(manager, 'upsert_retail_variant', {
      p_item_id: item,
      p_name_en: 'L',
      p_name_ar: 'كبير',
      p_price_iqd: 1_000,
      p_sku: `sku-${code}`,
    }).then(outcome);
    expect(dupSku.errorMessage).toContain('SKU_TAKEN');
  });

  it('keeps one live supplier per spelling and hides suppliers from a cashier', async () => {
    const name = `Rafidain Sports ${Date.now()}`;
    const made = await appRpc(manager, 'upsert_supplier', { p_name: name }).then(outcome);
    expect(made.ok, made.errorMessage).toBe(true);
    suppliers.push(made.data as string);
    const dup = await appRpc(manager, 'upsert_supplier', { p_name: `  ${name.toUpperCase()} ` }).then(outcome);
    expect(dup.errorMessage).toContain('SUPPLIER_EXISTS');

    const cashierTry = await appRpc(cashier, 'upsert_supplier', { p_name: 'x' }).then(outcome);
    expect(cashierTry.errorMessage).toContain('FORBIDDEN');
    const { data: seen } = await cashier.from('suppliers').select('id').eq('id', made.data as string);
    expect(seen).toEqual([]);
    const { data: mgr } = await manager.from('suppliers').select('id').eq('id', made.data as string);
    expect(mgr).toHaveLength(1);
  });

  it('receives retail stock once per idempotency key, with the supplier recorded', async () => {
    const item = await shopItem(await shopSection('R'), 'R');
    const v = await retailVariant(item);
    const sup = await appRpc(manager, 'upsert_supplier', { p_name: `Goods-in ${Date.now()}` }).then(outcome);
    suppliers.push(sup.data as string);

    const key = testIdemKey('receive');
    const args = {
      p_lines: [{ ingredient_id: v.ingredientId, qty_received: 6, unit_cost_iqd: 30_000 }],
      p_supplier_id: sup.data,
      p_idempotency_key: key,
    };
    const one = await appRpc(manager, 'receive_delivery', args).then(outcome);
    expect(one.ok, one.errorMessage).toBe(true);
    const two = await appRpc(manager, 'receive_delivery', args).then(outcome);
    expect(two.ok, two.errorMessage).toBe(true);
    expect((two.data as { duplicate?: boolean; delivery_id: string }).duplicate).toBe(true);
    expect((two.data as { delivery_id: string }).delivery_id).toBe(
      (one.data as { delivery_id: string }).delivery_id,
    );
    expect(await onHand(v.ingredientId)).toBe(6);

    const { data: del } = await svc
      .from('deliveries')
      .select('supplier_id, supplier_name')
      .eq('id', (one.data as { delivery_id: string }).delivery_id)
      .single();
    expect((del as { supplier_id: string }).supplier_id).toBe(sup.data);
    expect((del as { supplier_name: string }).supplier_name).toMatch(/^Goods-in /);
  });

  it('opens a counter sale without a table only for a labelled shop tab', async () => {
    const noLabel = await appRpc(cashier, 'open_tab', { p_kind: 'shop' }).then(outcome);
    expect(noLabel.errorMessage).toContain('LABEL_REQUIRED');
    const cafeTab = await appRpc(cashier, 'open_tab', { p_label: 'Ali' }).then(outcome);
    expect(cafeTab.errorMessage).toContain('TAB_ANCHOR_REQUIRED');
    const tabId = await counterTab();
    const { data } = await svc.from('tabs').select('kind, table_id, reservation_id').eq('id', tabId).single();
    expect(data).toMatchObject({ kind: 'shop', table_id: null, reservation_id: null });
  });

  it('sells shop lines with no kitchen ticket, taking stock and serving the order', async () => {
    const item = await shopItem(await shopSection('S'), 'S');
    const v = await retailVariant(item);
    expect((await receive(v.ingredientId, 5)).ok).toBe(true);

    const tabId = await counterTab();
    const sold = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: v.variantId, qty: 2 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    expect(sold.ok, sold.errorMessage).toBe(true);
    const d = sold.data as { order_id: string; ticket_id: string | null; kind?: string };
    expect(d.ticket_id).toBeNull();
    expect(d.kind).toBe('shop');

    const { data: tickets } = await svc.from('tickets').select('id').eq('order_id', d.order_id);
    expect(tickets).toEqual([]);
    const { data: order } = await svc.from('orders').select('status').eq('id', d.order_id).single();
    expect((order as { status: string }).status).toBe('served');
    expect(await onHand(v.ingredientId)).toBe(3);
  });

  it('refuses a basket that mixes café and shop lines, writing nothing', async () => {
    const item = await shopItem(await shopSection('M'), 'M');
    const v = await retailVariant(item);
    const cafe = await createTestMenuItem(svc, 'SHOPM', 2_000);
    categories.push(cafe.categoryId);
    const tabId = await counterTab();

    const mixed = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [
        { variant_id: cafe.variantId, qty: 1 },
        { variant_id: v.variantId, qty: 1 },
      ],
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    expect(mixed.errorMessage).toContain('MIXED_BASKET');
    const { data: orders } = await svc.from('orders').select('id').eq('tab_id', tabId);
    expect(orders).toEqual([]);
  });

  it('refuses a shop item on a guest cafe order', async () => {
    const item = await shopItem(await shopSection('G'), 'G');
    const v = await retailVariant(item);
    const tableId = await createTestCafeTable(svc, 'SHOPG');
    const guest = await openGuestSession(owner, tableId);
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: [{ variant_id: v.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res.errorMessage).toContain('SHOP_ITEM_NOT_ORDERABLE');
  });

  it('puts a voided retail line back on the shelf, and a refund never restocks it twice', async () => {
    const item = await shopItem(await shopSection('X'), 'X');
    const v = await retailVariant(item);
    expect((await receive(v.ingredientId, 4)).ok).toBe(true);
    const tabId = await counterTab();
    const sold = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: v.variantId, qty: 1 }, { variant_id: v.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    expect(sold.ok, sold.errorMessage).toBe(true);
    expect(await onHand(v.ingredientId)).toBe(2);
    const { data: rows } = await svc
      .from('order_items')
      .select('id')
      .eq('order_id', (sold.data as { order_id: string }).order_id)
      .order('line_no');
    const [lineA, lineB] = (rows as { id: string }[]).map((r) => r.id);

    const voided = await appRpc(manager, 'void_after_send', {
      p_order_item_id: lineA,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
    }).then(outcome);
    expect(voided.ok, voided.errorMessage).toBe(true);
    expect(await onHand(v.ingredientId)).toBe(3);
    const { data: waste } = await svc
      .from('stock_movements')
      .select('id')
      .eq('order_item_id', lineA)
      .eq('movement_type', 'void_after_send');
    expect(waste).toEqual([]);

    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 100_000,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
    const paymentId = (settled.data as { payment_id: string }).payment_id;

    // Refund against the voided line: already restocked, so no change.
    const onVoided = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 1_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
      p_items: [{ order_item_id: lineA, qty: 1 }],
      p_idempotency_key: testIdemKey('payment.refund'),
    }).then(outcome);
    expect(onVoided.ok, onVoided.errorMessage).toBe(true);
    expect(await onHand(v.ingredientId)).toBe(3);

    // A customer return of the live line restocks it.
    const back = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 40_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'retail_return',
      p_items: [{ order_item_id: lineB, qty: 1 }],
      p_idempotency_key: testIdemKey('payment.refund'),
    }).then(outcome);
    expect(back.ok, back.errorMessage).toBe(true);
    expect(await onHand(v.ingredientId)).toBe(4);
  });

  it('keeps an item orderable while any size is on the shelf', async () => {
    const item = await shopItem(await shopSection('A'), 'A');
    const m = await retailVariant(item, { p_name_en: 'M', p_name_ar: 'وسط' });
    const l = await retailVariant(item, { p_name_en: 'L', p_name_ar: 'كبير' });
    const orderable = async () => {
      const { data } = await manager.from('menu_item_availability').select('orderable').eq('item_id', item).single();
      return (data as { orderable: boolean }).orderable;
    };
    expect(await orderable()).toBe(false);
    expect((await receive(m.ingredientId, 1)).ok).toBe(true);
    expect(await orderable()).toBe(true);
    void l;
  });

  it('reports the shop share of settled money as "of which shop"', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const read = async () => {
      const res = await appRpc(owner, 'report_revenue', { p_from: today, p_to: today }).then(outcome);
      expect(res.ok, res.errorMessage).toBe(true);
      const d = res.data as { totals: { shopIqd: number }; columns: { key: string }[] };
      expect(d.columns.map((c) => c.key)).toContain('shopIqd');
      return Number(d.totals.shopIqd);
    };
    const before = await read();

    const item = await shopItem(await shopSection('P'), 'P');
    const v = await retailVariant(item, { p_price_iqd: 70_000 });
    expect((await receive(v.ingredientId, 2)).ok).toBe(true);
    const tabId = await counterTab();
    expect(
      (
        await appRpc(cashier, 'till_add_items', {
          p_tab_id: tabId,
          p_items: [{ variant_id: v.variantId, qty: 1 }],
          p_idempotency_key: testIdemKey('order.add_items'),
        }).then(outcome)
      ).ok,
    ).toBe(true);
    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'card',
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);

    expect((await read()) - before).toBe(70_000);
  });
});
