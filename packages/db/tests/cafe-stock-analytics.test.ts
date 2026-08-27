/**
 * Stock reversal and analytics visits (0043).
 *
 * Two defects that quietly corrupted numbers rather than failing loudly:
 *   #10 a refund restocked a line that void_after_send had already written off
 *       as waste, so on-hand drifted up by that line's BOM every time;
 *   #12 `visits` counted distinct guest_session_id, which is NULL for every
 *       till order — so a day of pure walk-in trade reported zero footfall.
 *
 * Runs against a live local stack; skips itself cleanly when the stack is down.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  testIdemKey,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PINS,
  createTestMenuItem,
  createTestIngredient,
  addRecipeLine,
  addStockBatch,
  createTestCafeTable,
  openGuestSession,
  openFreshDay,
  forceCloseAllDays,
  ensureTillFresh,
} from './helpers';

const up = await stackAvailable();

/** g of the test ingredient consumed by one unit of the test item. */
const PER_UNIT_G = 10;

describe.skipIf(!up)('stock reversal + analytics visits (0043)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  let item: { categoryId: string; itemId: string; variantId: string };
  let ingredientId: string;

  const onHand = async (): Promise<number> => {
    const { data, error } = await svc
      .from('stock_batches')
      .select('qty_remaining')
      .eq('ingredient_id', ingredientId)
      .gt('qty_remaining', 0);
    if (error) throw new Error(error.message);
    return (data as { qty_remaining: number }[]).reduce((s, b) => s + Number(b.qty_remaining), 0);
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);

    await ensureTillFresh(svc);
    await forceCloseAllDays(svc);
    await openFreshDay(manager, 100_000);

    item = await createTestMenuItem(svc, 'stock-item', 10_000);
    ingredientId = await createTestIngredient(svc, 'مكوّن الفحص', 'g');
    await addRecipeLine(svc, { variantId: item.variantId }, ingredientId, PER_UNIT_G);
    await addStockBatch(svc, ingredientId, 1_000, 5);
  });

  // -------------------------------------------------------------------------
  // 0043 #10 — a voided-as-waste line does not come back as stock
  // -------------------------------------------------------------------------
  it('does not restock a line that was already written off by void_after_send', async () => {
    const tableId = await createTestCafeTable(svc, 'ST');
    const guest = await openGuestSession(owner, tableId);

    // Two separate lines of the same item, so voiding one leaves the tab
    // settleable (a fully voided tab has nothing to pay and nothing to refund).
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: [
        { variant_id: item.variantId, qty: 1 },
        { variant_id: item.variantId, qty: 1 },
      ],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const { tab_id: tabId, order_id: orderId } = res.data as { tab_id: string; order_id: string };

    const afterConsumption = await onHand();
    expect(afterConsumption).toBe(1_000 - 2 * PER_UNIT_G);

    const { data: rows } = await svc
      .from('order_items')
      .select('id, line_no')
      .eq('order_id', orderId)
      .order('line_no');
    const [lineA, lineB] = (rows as { id: string }[]).map((r) => r.id);

    // Void line A: the food was already made, so the ledger reclassifies it as
    // waste. qty_remaining is deliberately untouched — the stock is gone.
    const voided = await appRpc(manager, 'void_after_send', {
      p_order_item_id: lineA,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
    }).then(outcome);
    expect(voided.ok, voided.errorMessage).toBe(true);
    expect(await onHand()).toBe(afterConsumption);

    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 10_000,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
    const paymentId = (settled.data as { payment_id: string }).payment_id;

    // Refund against the VOIDED line. Pre-0043 this credited its BOM back into
    // the newest live batch, so on-hand climbed by 10g of stock that had
    // already been thrown away.
    const refunded = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 1_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
      p_items: [{ order_item_id: lineA, qty: 1 }],
    }).then(outcome);
    expect(refunded.ok, refunded.errorMessage).toBe(true);
    expect(await onHand()).toBe(afterConsumption);

    // A live line still restocks normally — the guard is narrow.
    const backInStock = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 1_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
      p_items: [{ order_item_id: lineB, qty: 1 }],
    }).then(outcome);
    expect(backInStock.ok, backInStock.errorMessage).toBe(true);
    expect(await onHand()).toBe(afterConsumption + PER_UNIT_G);
  });

  it('refuses to refund more units than the line holds', async () => {
    const tableId = await createTestCafeTable(svc, 'ST2');
    const guest = await openGuestSession(owner, tableId);
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const { tab_id: tabId, order_id: orderId } = res.data as { tab_id: string; order_id: string };

    const { data: rows } = await svc.from('order_items').select('id').eq('order_id', orderId);
    const line = (rows as { id: string }[])[0]!.id;

    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 10_000,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    const paymentId = (settled.data as { payment_id: string }).payment_id;

    const first = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 1_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
      p_items: [{ order_item_id: line, qty: 1 }],
    }).then(outcome);
    expect(first.ok, first.errorMessage).toBe(true);

    // app.refund checks qty against the line PER CALL, never cumulatively —
    // so before 0043 the same unit could be refunded (and restocked) forever.
    const again = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 1_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
      p_items: [{ order_item_id: line, qty: 1 }],
    });
    expect(again.error?.message).toBe('REFUND_QTY_EXCEEDS_LINE');
  });

  // -------------------------------------------------------------------------
  // 0043 #12 — a till-only day still has visitors
  // -------------------------------------------------------------------------
  it('counts till tabs as visits on a day with no guest-web orders', async () => {
    // Build an isolated historical business day directly, so the assertion is
    // not diluted by whatever else the suite has written today.
    const day = '2026-07-14';
    const at = `${day}T09:00:00.000Z`; // 12:00 Asia/Baghdad — safely inside the 04:00-start day
    const ids = {
      day: '0a11b71c-0000-4000-8000-000000000001',
      tab: '0a11b71c-0000-4000-8000-000000000002',
      order: '0a11b71c-0000-4000-8000-000000000003',
      line: '0a11b71c-0000-4000-8000-000000000004',
      payment: '0a11b71c-0000-4000-8000-000000000005',
    };

    await svc.from('day_sessions').upsert({
      id: ids.day, business_date: day, status: 'closed',
      opened_at: at, opened_by: SEED_STAFF_IDS.manager, opening_float_iqd: 0,
      closed_at: at, closed_by: SEED_STAFF_IDS.manager,
    });
    await svc.from('tabs').upsert({
      id: ids.tab, day_session_id: ids.day, status: 'settled', label: 'walk-in',
      opened_by_staff_id: SEED_STAFF_IDS.cashier, opened_at: at, settled_at: at,
      subtotal_iqd: 10_000, tax_iqd: 0, discount_iqd: 0, total_iqd: 10_000,
    });
    await svc.from('orders').upsert({
      id: ids.order, tab_id: ids.tab, source: 'till', status: 'served',
      placed_by_staff_id: SEED_STAFF_IDS.cashier, placed_at: at,
    });
    await svc.from('order_items').upsert({
      id: ids.line, order_id: ids.order, menu_item_id: item.itemId,
      variant_id: item.variantId, qty: 1, unit_price_iqd: 10_000, line_total_iqd: 10_000,
    });
    await svc.from('payments').upsert({
      id: ids.payment, tab_id: ids.tab, day_session_id: ids.day, method: 'cash',
      amount_iqd: 10_000, tendered_iqd: 10_000, change_iqd: 0,
      recorded_by: SEED_STAFF_IDS.cashier, created_at: at,
    });

    const res = await appRpc(owner, 'analytics_daily_sales', { p_from: day, p_to: day }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const rows = res.data as { business_date: string; orders: number; till_orders: number; guest_orders: number; visits: number }[];
    const row = rows.find((r) => r.business_date === day);
    expect(row, `no analytics row for ${day}`).toBeDefined();
    expect(row!.till_orders).toBeGreaterThanOrEqual(1);
    expect(row!.guest_orders).toBe(0);
    // Pre-0043 this was 0 — a full day of trade reported as zero footfall.
    expect(row!.visits).toBeGreaterThanOrEqual(1);
  });

  it('0047: one tab with BOTH a guest order and a till order is ONE visit', async () => {
    // The normal upsell: a QR party orders from the phone, then the waiter adds
    // a forgotten item at the till against that same tab. 0043 keyed visits on
    // coalesce(guest_session_id, 'till:'||tab_id), which mixes two identifier
    // spaces in one distinct — so this single party counted as TWO visits.
    const day = '2026-07-15';
    const at = `${day}T09:00:00.000Z`; // 12:00 Asia/Baghdad, inside the 04:00-start day
    const ids = {
      day: '0a11b71d-0000-4000-8000-000000000001',
      table: '0a11b71d-0000-4000-8000-000000000002',
      session: '0a11b71d-0000-4000-8000-000000000003',
      tab: '0a11b71d-0000-4000-8000-000000000004',
      guestOrder: '0a11b71d-0000-4000-8000-000000000005',
      tillOrder: '0a11b71d-0000-4000-8000-000000000006',
      user: '0a11b71d-0000-4000-8000-000000000007',
    };

    await svc.from('day_sessions').upsert({
      id: ids.day, business_date: day, status: 'closed',
      opened_at: at, opened_by: SEED_STAFF_IDS.manager, opening_float_iqd: 0,
      closed_at: at, closed_by: SEED_STAFF_IDS.manager,
    });
    await svc.from('cafe_tables').upsert({
      id: ids.table, table_number: `MIX-${day}`, capacity: 4, is_active: true,
    });
    // guest_sessions.auth_user_id references auth.users, so mint a real one.
    const { data: created } = await svc.auth.admin.createUser({
      email: `mixed-${day}@test.touch.local`, password: 'touch-dev-password', email_confirm: true,
    });
    const authUserId = created?.user?.id ?? ids.user;
    await svc.from('guest_sessions').upsert({
      id: ids.session, table_id: ids.table, auth_user_id: authUserId,
      created_at: at, last_activity_at: at, expires_at: `${day}T23:00:00.000Z`,
    });
    await svc.from('tabs').upsert({
      id: ids.tab, day_session_id: ids.day, table_id: ids.table, status: 'settled',
      opened_at: at, settled_at: at,
      subtotal_iqd: 20_000, tax_iqd: 0, discount_iqd: 0, total_iqd: 20_000,
    });
    await svc.from('orders').upsert([
      {
        id: ids.guestOrder, tab_id: ids.tab, source: 'guest_web', status: 'served',
        guest_session_id: ids.session, placed_at: at,
      },
      {
        id: ids.tillOrder, tab_id: ids.tab, source: 'till', status: 'served',
        placed_by_staff_id: SEED_STAFF_IDS.cashier, placed_at: at,
      },
    ]);

    const res = await appRpc(owner, 'analytics_daily_sales', { p_from: day, p_to: day }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const rows = res.data as { business_date: string; orders: number; visits: number }[];
    const row = rows.find((r) => r.business_date === day);
    expect(row, `no analytics row for ${day}`).toBeDefined();
    expect(row!.orders).toBe(2); // two orders...
    expect(row!.visits).toBe(1); // ...but one tab, one bill, one party. Pre-0047: 2.
  });
});
