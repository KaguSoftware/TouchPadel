/**
 * Tab-totals correctness and the adjustment guards (0036 / 0037), plus the
 * concurrency and idempotency-scoping fixes that protect them (0038).
 *
 * Each defect below shipped in 0015-0032 and was found by reading the money
 * path end to end; every `it` here fails against the pre-0036 functions.
 *
 * Totals are read through `settle_tab`'s return value rather than by calling
 * `app.compute_tab_totals` directly: the RPC is internal (revoked from every
 * client role), and the settle result is the number the guest is actually
 * charged — which is the thing worth asserting.
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
  DEV_PINS,
  createTestMenuItem,
  createTestCafeTable,
  openGuestSession,
  openFreshDay,
  forceCloseAllDays,
  ensureTillFresh,
  type GuestSession,
} from './helpers';

const up = await stackAvailable();

const TAX_STANDARD_0 = 'b0000000-0000-4000-8000-000000000001'; // active, 0%
const TAX_RESTAURANT_10 = 'b0000000-0000-4000-8000-000000000002'; // INACTIVE, 1000 bp

interface Bill {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: string;
}

describe.skipIf(!up)('tab totals + adjustment guards (0036/0037/0038)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  let coffee: { categoryId: string; itemId: string; variantId: string };
  let cake: { categoryId: string; itemId: string; variantId: string };

  /**
   * A guest order on a table of its very own.
   *
   * `create_guest_order` reuses the table's open tab for the day, so tests
   * that shared a table would silently share money state.
   */
  const freshTab = async (items: { variant_id: string; qty: number }[]) => {
    const tableId = await createTestCafeTable(svc, 'MN');
    const guest = await openGuestSession(owner, tableId);
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: items,
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { tab_id: string; order_id: string };
    return { tabId: d.tab_id, orderId: d.order_id, guest };
  };

  /** Settle the tab in full and report the bill the guest was handed. */
  const settleAndRead = async (tabId: string, tendered = 1_000_000): Promise<Bill> => {
    const res = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: tendered,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as Record<string, number | string>;
    return {
      subtotal: Number(d.subtotal_iqd),
      discount: Number(d.discount_iqd),
      tax: Number(d.tax_iqd),
      total: Number(d.total_iqd),
      status: String(d.status),
    };
  };

  const lineIds = async (orderId: string) => {
    const { data } = await svc
      .from('order_items')
      .select('id, line_no')
      .eq('order_id', orderId)
      .order('line_no');
    return (data as { id: string }[]).map((r) => r.id);
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);

    await ensureTillFresh(svc);
    await forceCloseAllDays(svc);
    await openFreshDay(manager, 100_000);

    coffee = await createTestMenuItem(svc, 'money-coffee', 10_000);
    cake = await createTestMenuItem(svc, 'money-cake', 10_000);
  });

  // -------------------------------------------------------------------------
  // 0036 #1 — tax base
  // -------------------------------------------------------------------------
  it('taxes the POST-discount base, not the gross subtotal', async () => {
    await svc.from('tax_groups').update({ is_active: true }).eq('id', TAX_RESTAURANT_10);
    await svc.from('menu_categories').update({ tax_group_id: TAX_RESTAURANT_10 }).eq('id', coffee.categoryId);
    try {
      // Control: no discount, 10% on 20,000.
      const plain = await freshTab([{ variant_id: coffee.variantId, qty: 2 }]);
      expect(await settleAndRead(plain.tabId)).toMatchObject({
        subtotal: 20_000,
        tax: 2_000,
        total: 22_000,
      });

      // Same tab shape, 50% off the whole tab.
      const discounted = await freshTab([{ variant_id: coffee.variantId, qty: 2 }]);
      const disc = await appRpc(manager, 'apply_discount', {
        p_tab_id: discounted.tabId,
        p_kind: 'discount_percent',
        p_value: 5_000, // basis points
        p_pin: DEV_PINS.manager,
        p_reason_code: 'test',
      }).then(outcome);
      expect(disc.ok, disc.errorMessage).toBe(true);

      // Pre-0036 the tax was still 2,000: the guest paid tax on money they
      // were never charged.
      expect(await settleAndRead(discounted.tabId)).toMatchObject({
        subtotal: 20_000,
        discount: 10_000,
        tax: 1_000,
        total: 11_000,
      });
    } finally {
      await svc.from('menu_categories').update({ tax_group_id: TAX_STANDARD_0 }).eq('id', coffee.categoryId);
      await svc.from('tax_groups').update({ is_active: false }).eq('id', TAX_RESTAURANT_10);
    }
  });

  // -------------------------------------------------------------------------
  // 0036 #2 — inactive tax groups
  // -------------------------------------------------------------------------
  it('bills nothing for a category on an INACTIVE tax group', async () => {
    // seed.sql ships 'Restaurant 10%' inactive on purpose; before 0036 nothing
    // in the codebase read is_active, so pointing a category at it silently
    // taxed every tab 10% anyway.
    await svc.from('menu_categories').update({ tax_group_id: TAX_RESTAURANT_10 }).eq('id', cake.categoryId);
    try {
      const { tabId } = await freshTab([{ variant_id: cake.variantId, qty: 1 }]);
      expect(await settleAndRead(tabId)).toMatchObject({ subtotal: 10_000, tax: 0, total: 10_000 });
    } finally {
      await svc.from('menu_categories').update({ tax_group_id: TAX_STANDARD_0 }).eq('id', cake.categoryId);
    }
  });

  // -------------------------------------------------------------------------
  // 0036 #3 — a line discount dies with its line
  // -------------------------------------------------------------------------
  it('drops a line-scoped discount when that line is voided', async () => {
    const { tabId, orderId } = await freshTab([
      { variant_id: coffee.variantId, qty: 1 },
      { variant_id: cake.variantId, qty: 1 },
    ]);
    const [first] = await lineIds(orderId);

    const disc = await appRpc(manager, 'apply_discount', {
      p_tab_id: tabId,
      p_kind: 'discount_amount',
      p_value: 5_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
      p_order_item_id: first,
    }).then(outcome);
    expect(disc.ok, disc.errorMessage).toBe(true);

    const voided = await appRpc(manager, 'void_after_send', {
      p_order_item_id: first,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
    }).then(outcome);
    expect(voided.ok, voided.errorMessage).toBe(true);

    // Pre-0036: the subtotal dropped to 10,000 but the 5,000 discount stayed,
    // so the guest paid 5,000 for a 10,000 cake.
    expect(await settleAndRead(tabId)).toMatchObject({
      subtotal: 10_000,
      discount: 0,
      total: 10_000,
    });
  });

  // -------------------------------------------------------------------------
  // 0037 #4 — no adjustment may strand a tab below what was already paid
  // -------------------------------------------------------------------------
  it('refuses a discount that would drop the total below what is already paid', async () => {
    const { tabId } = await freshTab([{ variant_id: coffee.variantId, qty: 2 }]); // 20,000

    const part = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 10_000,
      p_amount_iqd: 10_000,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);
    expect(part.ok, part.errorMessage).toBe(true);
    expect((part.data as { status: string }).status).toBe('awaiting_payment');

    const bad = await appRpc(manager, 'apply_discount', {
      p_tab_id: tabId,
      p_kind: 'discount_amount',
      p_value: 15_000, // would make the total 5,000 against 10,000 already paid
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
    });
    expect(bad.error?.message).toBe('DISCOUNT_REQUIRES_REFUND');

    // Rolled back, and the tab is still settleable for the remaining 10,000.
    // Pre-0037 the total became 5,000, settle raised ALREADY_PAID forever, and
    // close_day could never close the day.
    const rest = await settleAndRead(tabId);
    expect(rest.discount).toBe(0);
    expect(rest.total).toBe(20_000);
    expect(rest.status).toBe('settled');
  });

  it('refuses a price override that would drop the total below what is already paid', async () => {
    const { tabId, orderId } = await freshTab([{ variant_id: coffee.variantId, qty: 2 }]);
    const [first] = await lineIds(orderId);

    await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 15_000,
      p_amount_iqd: 15_000,
      p_idempotency_key: testIdemKey('settle'),
    }).then(outcome);

    const bad = await appRpc(manager, 'override_price', {
      p_order_item_id: first,
      p_new_unit_price_iqd: 1_000, // line falls to 2,000 => total 2,000 vs 15,000 paid
      p_pin: DEV_PINS.manager,
      p_reason_code: 'test',
    });
    expect(bad.error?.message).toBe('OVERRIDE_REQUIRES_REFUND');

    const { data: line } = await svc
      .from('order_items')
      .select('unit_price_iqd')
      .eq('id', first)
      .single();
    expect(Number((line as { unit_price_iqd: number }).unit_price_iqd)).toBe(10_000);
  });

  // -------------------------------------------------------------------------
  // 0038 #7 — an idempotency key is scoped to its owner
  // -------------------------------------------------------------------------
  it("refuses another session's idempotency key without leaking the order", async () => {
    const key = testIdemKey('order.create');
    const mineTable = await createTestCafeTable(svc, 'MN-A');
    const mineGuest = await openGuestSession(owner, mineTable);
    const mine = await appRpc(mineGuest.client, 'create_guest_order', {
      p_items: [{ variant_id: coffee.variantId, qty: 1 }],
      p_idempotency_key: key,
    }).then(outcome);
    expect(mine.ok, mine.errorMessage).toBe(true);

    // The same guest replaying the same key still gets their own order back.
    const replay = await appRpc(mineGuest.client, 'create_guest_order', {
      p_items: [{ variant_id: coffee.variantId, qty: 1 }],
      p_idempotency_key: key,
    }).then(outcome);
    expect(replay.ok, replay.errorMessage).toBe(true);
    expect((replay.data as { duplicate: boolean }).duplicate).toBe(true);

    // A DIFFERENT guest supplying that key gets nothing at all. Pre-0038 they
    // got the order id, tab id and status back — a read orders_guest_read
    // otherwise forbids.
    const otherTable = await createTestCafeTable(svc, 'MN-B');
    const other = await openGuestSession(owner, otherTable);
    const stolen = await appRpc(other.client, 'create_guest_order', {
      p_items: [{ variant_id: coffee.variantId, qty: 1 }],
      p_idempotency_key: key,
    });
    expect(stolen.error?.message).toBe('IDEMPOTENCY_CONFLICT');
    expect(JSON.stringify(stolen.data ?? {})).not.toContain(
      (mine.data as { order_id: string }).order_id,
    );
  });

  // -------------------------------------------------------------------------
  // 0038 #6 — an order may not land on a day that has closed
  // -------------------------------------------------------------------------
  it('never leaves an open tab on a closed day', async () => {
    const table = await createTestCafeTable(svc, 'MN-DAY');
    const guest = await openGuestSession(owner, table);

    // Settle every live tab so the day is allowed to close.
    const { data: openTabs } = await svc
      .from('tabs')
      .select('id')
      .in('status', ['open', 'awaiting_payment']);
    for (const t of (openTabs ?? []) as { id: string }[]) {
      await appRpc(cashier, 'settle_tab', {
        p_tab_id: t.id,
        p_method: 'card',
        p_idempotency_key: testIdemKey('settle'),
      });
    }
    const closed = await appRpc(manager, 'close_day', { p_cash_counted_iqd: 0 });
    expect(closed.error?.message ?? 'ok').not.toBe('DAY_OPEN_TABS');

    // With no open day, a guest order is refused outright. Pre-0038 the day was
    // resolved through an unlocked read, so an in-flight order could commit
    // onto a day that had just closed — an open tab outside cash_expected_iqd
    // that could never be settled into any day.
    const orphan = await appRpc(guest.client, 'create_guest_order', {
      p_items: [{ variant_id: coffee.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.create'),
    });
    expect(orphan.error?.message).toBe('CAFE_CLOSED');

    const { data: stranded } = await svc
      .from('tabs')
      .select('id')
      .in('status', ['open', 'awaiting_payment']);
    expect(stranded ?? []).toHaveLength(0);

    await openFreshDay(manager, 100_000);
  });
});
