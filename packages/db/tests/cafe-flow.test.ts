/**
 * End-to-end DB-level cafe journey (Drops 2+3):
 *   owner signs a table QR token -> anonymous guest opens a session ->
 *   guest order with modifiers (server-side price snapshot) -> KDS ticket
 *   lifecycle -> FEFO stock consumption (modifier-aware) -> cash settle with
 *   change -> day close guards + cash reconciliation. Plus waiter-call
 *   rate limiting, token rotation, and split_evenly parity with @touch/core.
 *
 * Runs against a live local stack; skips itself cleanly when the stack is down.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  testIdemKey,
  outcome,
  SEED_STAFF,
  createTestMenuItem,
  addModifierToItem,
  createTestIngredient,
  addRecipeLine,
  addStockBatch,
  createTestCafeTable,
  openGuestSession,
  openFreshDay,
  forceCloseAllDays,
  ensureTillFresh,
  type GuestSession,
} from './helpers';
import { splitEvenly } from '../../core/src/money/split';

const up = await stackAvailable();

const OPENING_FLOAT = 100_000;

describe.skipIf(!up)('cafe flow (QR -> order -> KDS -> stock -> settle -> day close)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let prep: SupabaseClient;

  let tableId: string;
  let guest: GuestSession;
  let dayId: string;

  // Menu under test
  let latte: { itemId: string; variantId: string };
  let croissant: { itemId: string; variantId: string };
  let oatMilkModifierId: string;

  // Stock under test
  let milkId: string;
  let coffeeId: string;
  let oatId: string;
  let croissantIngId: string;
  let milkBatchA: string; // 150 ml, expires soonest — FEFO drains it first
  let milkBatchB: string; // 1000 ml

  // Flow state
  let tabId: string;
  let orderId: string;
  let ticketId: string;
  let latteOrderItemId: string;
  let croissantOrderItemId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    prep = await signedInClient(SEED_STAFF.prep);

    await ensureTillFresh(svc); // a stale TILL heartbeat would block guest writes
    await forceCloseAllDays(svc); // pristine day => deterministic cash reconciliation

    // Menu: latte 5,000 IQD (+ oat milk 1,000) and croissant 3,000 IQD.
    latte = await createTestMenuItem(svc, 'latte', 5_000);
    await svc.from('menu_items').update({ name_ar: 'لاتيه' }).eq('id', latte.itemId);
    const oat = await addModifierToItem(svc, latte.itemId, 'حليب الشوفان', 1_000);
    oatMilkModifierId = oat.modifierId;
    croissant = await createTestMenuItem(svc, 'croissant', 3_000);
    await svc.from('menu_items').update({ name_ar: 'كرواسون' }).eq('id', croissant.itemId);

    // BOM: latte = 200ml milk + 18g coffee; oat-milk modifier = 200ml oat milk;
    // croissant = 1pc frozen croissant.
    milkId = await createTestIngredient(svc, 'حليب طازج', 'ml');
    coffeeId = await createTestIngredient(svc, 'قهوة مطحونة', 'g');
    oatId = await createTestIngredient(svc, 'حليب الشوفان', 'ml');
    croissantIngId = await createTestIngredient(svc, 'كرواسون مجمد', 'pc');
    await addRecipeLine(svc, { variantId: latte.variantId }, milkId, 200);
    await addRecipeLine(svc, { variantId: latte.variantId }, coffeeId, 18);
    await addRecipeLine(svc, { modifierId: oatMilkModifierId }, oatId, 200);
    await addRecipeLine(svc, { variantId: croissant.variantId }, croissantIngId, 1);

    // Batches: milk split across two so a single latte spans a FEFO boundary.
    milkBatchA = await addStockBatch(svc, milkId, 150, 2, 2); // expires in 2 days
    milkBatchB = await addStockBatch(svc, milkId, 1_000, 2, 10);
    await addStockBatch(svc, coffeeId, 1_000, 30, 30);
    await addStockBatch(svc, oatId, 500, 4, 5);
    await addStockBatch(svc, croissantIngId, 10, 1_500, 7);

    tableId = await createTestCafeTable(svc, 'FLOW');
    dayId = await openFreshDay(manager, OPENING_FLOAT);
  });

  it('owner-signed QR token opens an anonymous guest session', async () => {
    guest = await openGuestSession(owner, tableId);
    expect(guest.sessionId).toBeTruthy();
    expect(guest.tableId).toBe(tableId);
  });

  it('guest order: server-side price snapshot, integer line totals, ticket auto-created', async () => {
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: [
        {
          variant_id: latte.variantId,
          qty: 1,
          // client-supplied prices must be IGNORED — the server snapshots from the menu
          price_iqd: 1,
          modifiers: [{ modifier_id: oatMilkModifierId, qty: 1, price_delta_iqd: 1 }],
        },
        { variant_id: croissant.variantId, qty: 2, notes: 'بدون تسخين' },
      ],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.duplicate).toBe(false);

    const d = res.data as { order_id: string; tab_id: string; ticket_id: string; total_iqd: number };
    orderId = d.order_id;
    tabId = d.tab_id;
    ticketId = d.ticket_id;
    // (5000 + 1000)*1 + 3000*2 — snapshot prices, not the client's lies.
    expect(Number(d.total_iqd)).toBe(12_000);

    const { data: items } = await svc
      .from('order_items')
      .select('id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd')
      .eq('order_id', orderId);
    expect(items).toHaveLength(2);
    type Item = {
      id: string;
      menu_item_id: string;
      qty: number;
      unit_price_iqd: number;
      line_total_iqd: number;
    };
    const latteLine = (items as Item[]).find((i) => i.menu_item_id === latte.itemId)!;
    const croissantLine = (items as Item[]).find((i) => i.menu_item_id === croissant.itemId)!;
    latteOrderItemId = latteLine.id;
    croissantOrderItemId = croissantLine.id;

    expect(latteLine.unit_price_iqd).toBe(5_000); // menu snapshot, not 1
    expect(latteLine.line_total_iqd).toBe(6_000); // (5000 + 1000) * 1
    expect(croissantLine.unit_price_iqd).toBe(3_000);
    expect(croissantLine.line_total_iqd).toBe(6_000); // 3000 * 2
    for (const i of items as Item[]) {
      expect(Number.isInteger(i.unit_price_iqd)).toBe(true);
      expect(Number.isInteger(i.line_total_iqd)).toBe(true);
    }

    const { data: mods } = await svc
      .from('order_item_modifiers')
      .select('modifier_id, qty, price_delta_iqd')
      .eq('order_item_id', latteOrderItemId);
    expect(mods).toHaveLength(1);
    expect((mods![0] as { price_delta_iqd: number }).price_delta_iqd).toBe(1_000);

    // Ticket was created atomically with the order.
    const { data: ticket } = await svc
      .from('tickets')
      .select('status, order_id')
      .eq('id', ticketId)
      .single();
    expect((ticket as { status: string; order_id: string }).order_id).toBe(orderId);
    expect((ticket as { status: string }).status).toBe('queued');
  });

  it('prep runs the ticket ready -> completed; actual_prep_seconds stamped', async () => {
    const ready = await appRpc(prep, 'set_ticket_status', {
      p_ticket_id: ticketId,
      p_status: 'ready',
    }).then(outcome);
    expect(ready.ok, ready.errorMessage).toBe(true);

    const done = await appRpc(prep, 'set_ticket_status', {
      p_ticket_id: ticketId,
      p_status: 'completed',
    }).then(outcome);
    expect(done.ok, done.errorMessage).toBe(true);
    const secs = (done.data as { actual_prep_seconds: number }).actual_prep_seconds;
    expect(Number.isInteger(secs)).toBe(true);
    expect(secs).toBeGreaterThanOrEqual(0);

    const { data: t } = await svc
      .from('tickets')
      .select('status, ready_at, completed_at, actual_prep_seconds')
      .eq('id', ticketId)
      .single();
    const tt = t as { status: string; ready_at: string; completed_at: string; actual_prep_seconds: number };
    expect(tt.status).toBe('completed');
    expect(tt.ready_at).not.toBeNull();
    expect(tt.completed_at).not.toBeNull();
    expect(tt.actual_prep_seconds).not.toBeNull();

    // Mirrored onto the order for the guest status page.
    const { data: o } = await svc.from('orders').select('status').eq('id', orderId).single();
    expect((o as { status: string }).status).toBe('served');
  });

  it('stock consumed FEFO and modifier-aware (oat milk row present)', async () => {
    const { data: moves } = await svc
      .from('stock_movements')
      .select('ingredient_id, batch_id, movement_type, qty_delta')
      .in('order_item_id', [latteOrderItemId, croissantOrderItemId])
      .eq('movement_type', 'sale_consumption');
    type Move = { ingredient_id: string; batch_id: string | null; qty_delta: number };
    const m = moves as Move[];

    const sumFor = (ing: string) =>
      m.filter((x) => x.ingredient_id === ing).reduce((s, x) => s + Number(x.qty_delta), 0);
    expect(sumFor(milkId)).toBe(-200);
    expect(sumFor(coffeeId)).toBe(-18);
    expect(sumFor(oatId)).toBe(-200); // MODIFIER-AWARE: oat milk consumed
    expect(sumFor(croissantIngId)).toBe(-2); // qty 2 croissants

    // FEFO: the soon-expiring milk batch drained first, remainder from batch B.
    const milkMoves = m.filter((x) => x.ingredient_id === milkId);
    expect(milkMoves).toHaveLength(2);
    expect(milkMoves.find((x) => x.batch_id === milkBatchA)?.qty_delta).toBe(-150);
    expect(milkMoves.find((x) => x.batch_id === milkBatchB)?.qty_delta).toBe(-50);
    expect(m.every((x) => x.batch_id !== null)).toBe(true); // no overdraft happened

    const { data: batches } = await svc
      .from('stock_batches')
      .select('id, qty_remaining')
      .in('id', [milkBatchA, milkBatchB]);
    const remaining = Object.fromEntries(
      (batches as { id: string; qty_remaining: number }[]).map((b) => [b.id, Number(b.qty_remaining)]),
    );
    expect(remaining[milkBatchA]).toBe(0);
    expect(remaining[milkBatchB]).toBe(950);
  });

  it('day close BLOCKED while the tab is open; cash settle with change; then reconciles', async () => {
    // Guard: DAY_OPEN_TABS while our tab is open.
    const blocked = await appRpc(manager, 'close_day', { p_cash_counted_iqd: 0 }).then(outcome);
    expect(blocked.ok).toBe(false);
    expect(blocked.errorMessage).toContain('DAY_OPEN_TABS');

    // Cashier settles cash: 12,000 due, 20,000 tendered -> 8,000 change.
    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 20_000,
      p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
    const s = settled.data as {
      status: string;
      total_iqd: number;
      tax_iqd: number;
      change_iqd: number;
      payment_id: string;
      remaining_iqd: number;
    };
    expect(s.status).toBe('settled');
    expect(Number(s.total_iqd)).toBe(12_000); // Standard tax group = 0%
    expect(Number(s.tax_iqd)).toBe(0);
    expect(Number(s.change_iqd)).toBe(8_000);
    expect(Number(s.remaining_iqd)).toBe(0);

    const { data: pay } = await svc
      .from('payments')
      .select('method, amount_iqd, tendered_iqd, change_iqd, day_session_id')
      .eq('id', s.payment_id)
      .single();
    const p = pay as { method: string; amount_iqd: number; change_iqd: number; day_session_id: string };
    expect(p.method).toBe('cash');
    expect(p.amount_iqd).toBe(12_000);
    expect(p.change_iqd).toBe(8_000);
    expect(p.day_session_id).toBe(dayId);

    const { data: tab } = await svc.from('tabs').select('status, settled_at').eq('id', tabId).single();
    expect((tab as { status: string }).status).toBe('settled');
    expect((tab as { settled_at: string }).settled_at).not.toBeNull();

    // Close now succeeds and cash_expected = opening float + cash payments.
    const closed = await appRpc(manager, 'close_day', {
      p_cash_counted_iqd: OPENING_FLOAT + 12_000,
    }).then(outcome);
    expect(closed.ok, closed.errorMessage).toBe(true);
    const c = closed.data as {
      day_session_id: string;
      cash_expected_iqd: number;
      cash_counted_iqd: number;
      cash_variance_iqd: number;
      card_expected_iqd: number;
    };
    expect(c.day_session_id).toBe(dayId);
    expect(Number(c.cash_expected_iqd)).toBe(OPENING_FLOAT + 12_000);
    expect(Number(c.cash_variance_iqd)).toBe(0);
    expect(Number(c.card_expected_iqd)).toBe(0);

    const { data: day } = await svc
      .from('day_sessions')
      .select('status, cash_expected_iqd')
      .eq('id', dayId)
      .single();
    expect((day as { status: string }).status).toBe('closed');
    expect((day as { cash_expected_iqd: number }).cash_expected_iqd).toBe(OPENING_FLOAT + 12_000);
  });

  it('waiter call: raise -> cooldown -> ALREADY_NOTIFIED -> ack -> resolve', async () => {
    const raised = await appRpc(guest.client, 'raise_waiter_call', { p_reason: 'water' }).then(
      outcome,
    );
    expect(raised.ok, raised.errorMessage).toBe(true);
    const callId = (raised.data as { call_id: string }).call_id;

    // Immediate re-raise: the SOFT limit (cooldown) fires first.
    const tooSoon = await appRpc(guest.client, 'raise_waiter_call', { p_reason: 'bill' }).then(
      outcome,
    );
    expect(tooSoon.ok).toBe(false);
    expect(tooSoon.errorMessage).toContain('CALL_COOLDOWN');

    // Age the call past the cooldown while it is still open: the HARD stop
    // (one live call per table) maps to ALREADY_NOTIFIED.
    const { error: ageErr } = await svc
      .from('waiter_calls')
      .update({ raised_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      .eq('id', callId);
    expect(ageErr).toBeNull();
    const dup = await appRpc(guest.client, 'raise_waiter_call', { p_reason: 'assistance' }).then(
      outcome,
    );
    expect(dup.ok).toBe(false);
    expect(dup.errorMessage).toContain('ALREADY_NOTIFIED');

    // Floor staff acknowledge (idempotent) then resolve.
    const ack = await appRpc(cashier, 'ack_waiter_call', { p_call_id: callId }).then(outcome);
    expect(ack.ok, ack.errorMessage).toBe(true);
    expect(ack.duplicate).toBe(false);
    const ack2 = await appRpc(cashier, 'ack_waiter_call', { p_call_id: callId }).then(outcome);
    expect(ack2.duplicate).toBe(true);

    const resolved = await appRpc(cashier, 'resolve_waiter_call', { p_call_id: callId }).then(
      outcome,
    );
    expect(resolved.ok, resolved.errorMessage).toBe(true);
    const { data: final } = await svc
      .from('waiter_calls')
      .select('status, acknowledged_by, resolved_by')
      .eq('id', callId)
      .single();
    expect((final as { status: string }).status).toBe('resolved');
  });

  it('token rotation kills every printed QR for the table', async () => {
    const rotated = await appRpc(owner, 'rotate_table_token', { p_table_id: tableId }).then(
      outcome,
    );
    expect(rotated.ok, rotated.errorMessage).toBe(true);
    expect(Number(rotated.data)).toBeGreaterThanOrEqual(2);

    // A fresh guest scanning the OLD printed QR is refused.
    const lateGuest = await anonymousSessionClient();
    const stale = await appRpc(lateGuest, 'open_table_session', { p_token: guest.token }).then(
      outcome,
    );
    expect(stale.ok).toBe(false);
    expect(stale.errorMessage).toContain('TOKEN_INVALID');

    // A re-generated token (current version) works immediately.
    const fresh = await openGuestSession(owner, tableId);
    expect(fresh.tableId).toBe(tableId);
  });

  it('app.split_evenly parity with @touch/core splitEvenly (exact largest-remainder)', async () => {
    // The real settled tab: 12,000 across 3.
    const flowSplit = await appRpc(cashier, 'split_evenly', { p_tab_id: tabId, p_n: 3 }).then(
      outcome,
    );
    expect(flowSplit.ok, flowSplit.errorMessage).toBe(true);
    expect((flowSplit.data as number[]).map(Number)).toEqual(splitEvenly(12_000, 3).map(Number));

    // Awkward totals × counts: DB and core must agree bit-for-bit.
    const totals = [10_001, 99_998, 7, 250_001];
    const counts = [1, 2, 3, 7, 50];
    for (const total of totals) {
      const { data: tab, error } = await svc
        .from('tabs')
        .insert({
          day_session_id: dayId,
          status: 'settled',
          label: `فاتورة تقسيم ${total}`,
          opened_by_staff_id: null,
          subtotal_iqd: total,
          tax_iqd: 0,
          discount_iqd: 0,
          total_iqd: total,
          settled_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      expect(error).toBeNull();
      const syntheticTab = (tab as { id: string }).id;

      for (const n of counts) {
        const res = await appRpc(cashier, 'split_evenly', {
          p_tab_id: syntheticTab,
          p_n: n,
        }).then(outcome);
        expect(res.ok, `${total}/${n}: ${res.errorMessage}`).toBe(true);
        const dbShares = (res.data as (number | string)[]).map(Number);
        const coreShares = splitEvenly(total, n).map(Number);
        expect(dbShares).toEqual(coreShares);
        expect(dbShares.reduce((s, x) => s + x, 0)).toBe(total); // Σ shares === total
        expect(Math.max(...dbShares) - Math.min(...dbShares)).toBeLessThanOrEqual(1);
      }
    }
  });
});
