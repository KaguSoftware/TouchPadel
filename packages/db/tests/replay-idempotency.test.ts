/**
 * 0049 — a replayed mutation must apply exactly once.
 *
 * functions/replay/index.ts applies the RPC (:303) and only then records
 * sync_replays (:313). If that second statement fails, or the response is lost
 * on the way back to the till, the till's retry (:272-280) finds no record and
 * dispatches the SAME mutation again. Seven routed RPCs already carried
 * p_idempotency_key; these three did not, and two of them are money.
 *
 * Each test replays the identical call and asserts the EFFECT happened once,
 * not merely that the second call returned something.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  createTestMenuItem,
  createTestCafeTable,
  openGuestSession,
  openFreshDay,
  forceCloseAllDays,
  ensureTillFresh,
  createTestIngredient,
  addStockBatch,
  testIdemKey,
  outcome,
  SEED_STAFF,
  DEV_PINS,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0049 replay idempotency', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let coffee: { variantId: string; categoryId: string };

  const freshTab = async () => {
    const tableId = await createTestCafeTable(svc, 'RP');
    const guest = await openGuestSession(owner, tableId);
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: [{ variant_id: coffee.variantId, qty: 2 }],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return (res.data as { tab_id: string }).tab_id;
  };

  const adjustments = async (tabId: string) => {
    const { data } = await svc.from('tab_adjustments').select('id').eq('tab_id', tabId);
    return (data ?? []).length;
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    await ensureTillFresh(svc);
    await forceCloseAllDays(svc);
    await openFreshDay(manager, 100_000);
    coffee = await createTestMenuItem(svc, 'replay-coffee', 10_000);
  });

  it('apply_discount: a replayed discount is applied ONCE', async () => {
    const tabId = await freshTab();
    const args = {
      p_tab_id: tabId,
      p_kind: 'discount_percent',
      p_value: 5_000, // basis points = 50%
      p_pin: DEV_PINS.manager,
      p_reason_code: 'replay-test',
      p_idempotency_key: testIdemKey('adjustment.apply'),
    };

    const first = await appRpc(manager, 'apply_discount', args).then(outcome);
    const second = await appRpc(manager, 'apply_discount', args).then(outcome);

    expect(first.ok, first.errorMessage).toBe(true);
    expect(second.ok, second.errorMessage).toBe(true);
    expect(second.duplicate).toBe(true);
    // Same adjustment echoed back, and only ONE row exists on the tab.
    expect((second.data as { adjustment_id: string }).adjustment_id).toBe(
      (first.data as { adjustment_id: string }).adjustment_id,
    );
    expect(await adjustments(tabId)).toBe(1);
  });

  it('apply_discount: without a key the old double-apply still happens (the bug being fixed)', async () => {
    const tabId = await freshTab();
    const args = {
      p_tab_id: tabId,
      p_kind: 'discount_amount',
      p_value: 1_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'replay-test',
    };
    await appRpc(manager, 'apply_discount', args).then(outcome);
    await appRpc(manager, 'apply_discount', args).then(outcome);
    // Documents WHY replay/index.ts must send the key: unkeyed calls are, and
    // remain, genuinely repeatable (the till applies two deliberate discounts
    // exactly this way).
    expect(await adjustments(tabId)).toBe(2);
  });

  it('apply_discount: another principal cannot replay your key', async () => {
    const tabId = await freshTab();
    const key = testIdemKey('adjustment.apply');
    const args = {
      p_tab_id: tabId,
      p_kind: 'discount_amount',
      p_value: 1_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'replay-test',
      p_idempotency_key: key,
    };
    const mine = await appRpc(manager, 'apply_discount', args).then(outcome);
    expect(mine.ok, mine.errorMessage).toBe(true);

    const theirs = await appRpc(owner, 'apply_discount', {
      ...args,
      p_pin: DEV_PINS.owner,
    }).then(outcome);
    expect(theirs.ok).toBe(false);
    expect(theirs.errorMessage).toContain('IDEMPOTENCY_CONFLICT');
  });

  it('record_waste: a replayed waste deducts stock ONCE', async () => {
    const ing = await createTestIngredient(svc, 'replay-waste', 'g');
    await addStockBatch(svc, ing, 100, 500);

    const onHand = async () => {
      const { data } = await svc
        .from('stock_batches')
        .select('qty_remaining')
        .eq('ingredient_id', ing);
      return (data ?? []).reduce((a, r) => a + Number((r as { qty_remaining: number }).qty_remaining), 0);
    };
    const before = await onHand();

    const args = {
      p_ingredient_id: ing,
      p_qty: 10,
      p_movement_type: 'waste_spill',
      p_reason_code: 'replay-test',
      p_idempotency_key: testIdemKey('stock.waste'),
    };
    const first = await appRpc(manager, 'record_waste', args).then(outcome);
    const second = await appRpc(manager, 'record_waste', args).then(outcome);

    expect(first.ok, first.errorMessage).toBe(true);
    expect(second.ok, second.errorMessage).toBe(true);
    // The ledger is append-only: a double deduction has no undo.
    expect(await onHand()).toBe(before - 10);
  });

  // ── Item 9 / C3 (0120): the till's money corrections join the queue ────────
  // refund, settle_zero_tab and cancel_tab gained p_idempotency_key + claim_replay;
  // void_after_send did not (void_order_item_internal is state-idempotent, 0039).
  // The helper verifies the manager PIN before refund / void_after_send (0115).

  const lineOf = async (tabId: string) => {
    const { data: orders } = await svc.from('orders').select('id').eq('tab_id', tabId);
    const { data: items } = await svc
      .from('order_items')
      .select('id')
      .in('order_id', (orders ?? []).map((o) => o.id))
      .eq('voided', false)
      .limit(1);
    return items![0]!.id;
  };

  const emptyTab = async () => {
    const tableId = await createTestCafeTable(svc, 'RP0');
    const res = await appRpc(manager, 'open_tab', {
      p_table_id: tableId,
      p_label: 'rp-empty',
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return (res.data as { tab_id: string }).tab_id;
  };

  it('refund: a replayed refund refunds ONCE and echoes the same refund_id', async () => {
    const tabId = await freshTab();
    const paid = await appRpc(manager, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 100_000,
      p_idempotency_key: testIdemKey('tab.settle'),
    }).then(outcome);
    expect(paid.ok, paid.errorMessage).toBe(true);
    const paymentId = (paid.data as { payment_id: string }).payment_id;

    const args = {
      p_payment_id: paymentId,
      p_amount_iqd: 5_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'replay-test',
      p_device_id: 'TILL-RP',
      p_idempotency_key: testIdemKey('payment.refund'),
    };
    const first = await appRpc(manager, 'refund', args).then(outcome);
    const second = await appRpc(manager, 'refund', args).then(outcome);
    expect(first.ok, first.errorMessage).toBe(true);
    expect(second.ok, second.errorMessage).toBe(true);
    expect(second.duplicate).toBe(true);
    expect((second.data as { refund_id: string }).refund_id).toBe((first.data as { refund_id: string }).refund_id);
    const { data: refunds } = await svc.from('refunds').select('id').eq('payment_id', paymentId);
    expect(refunds).toHaveLength(1);
  });

  it('refund: another principal cannot replay your key', async () => {
    const tabId = await freshTab();
    const paid = await appRpc(manager, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 100_000,
      p_idempotency_key: testIdemKey('tab.settle'),
    }).then(outcome);
    expect(paid.ok, paid.errorMessage).toBe(true);
    const paymentId = (paid.data as { payment_id: string }).payment_id;
    const key = testIdemKey('payment.refund');
    const mine = await appRpc(manager, 'refund', {
      p_payment_id: paymentId, p_amount_iqd: 1_000, p_pin: DEV_PINS.manager, p_reason_code: 'replay-test', p_idempotency_key: key,
    }).then(outcome);
    expect(mine.ok, mine.errorMessage).toBe(true);
    const theirs = await appRpc(owner, 'refund', {
      p_payment_id: paymentId, p_amount_iqd: 1_000, p_pin: DEV_PINS.owner, p_reason_code: 'replay-test', p_idempotency_key: key,
    }).then(outcome);
    expect(theirs.ok).toBe(false);
    expect(theirs.errorMessage).toContain('IDEMPOTENCY_CONFLICT');
  });

  it('void_after_send: a repeated void answers duplicate:true with no key (state-idempotent)', async () => {
    const tabId = await freshTab();
    const args = { p_order_item_id: await lineOf(tabId), p_pin: DEV_PINS.manager, p_reason_code: 'replay-test', p_device_id: 'TILL-RP' };
    const first = await appRpc(manager, 'void_after_send', args).then(outcome);
    const second = await appRpc(manager, 'void_after_send', args).then(outcome);
    expect(first.ok, first.errorMessage).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second.ok, second.errorMessage).toBe(true);
    expect(second.duplicate).toBe(true);
  });

  it('settle_zero_tab: a replayed zero close closes ONCE, with one audit row', async () => {
    const tabId = await freshTab();
    // Void the only line: the tab has been used (not TAB_EMPTY) and owes nothing.
    const voided = await appRpc(manager, 'void_after_send', {
      p_order_item_id: await lineOf(tabId), p_pin: DEV_PINS.manager, p_reason_code: 'replay-test', p_device_id: 'TILL-RP',
    }).then(outcome);
    expect(voided.ok, voided.errorMessage).toBe(true);

    const args = { p_tab_id: tabId, p_reason_code: 'nothing_owed', p_device_id: 'TILL-RP', p_idempotency_key: testIdemKey('tab.settle_zero') };
    const first = await appRpc(manager, 'settle_zero_tab', args).then(outcome);
    const second = await appRpc(manager, 'settle_zero_tab', args).then(outcome);
    expect(first.ok, first.errorMessage).toBe(true);
    expect((first.data as { status: string }).status).toBe('settled');
    expect(second.ok, second.errorMessage).toBe(true);
    expect(second.duplicate).toBe(true);
    const { data: audit } = await svc.from('audit_log').select('action').eq('entity_id', tabId).eq('action', 'tab.settle');
    expect(audit).toHaveLength(1);
  });

  it('cancel_tab: a replayed removal voids ONCE, and the audit row now carries the device', async () => {
    const tabId = await emptyTab();
    const args = { p_tab_id: tabId, p_reason_code: 'duplicate', p_device_id: 'TILL-RP-0120', p_idempotency_key: testIdemKey('tab.cancel') };
    const first = await appRpc(manager, 'cancel_tab', args).then(outcome);
    const second = await appRpc(manager, 'cancel_tab', args).then(outcome);
    expect(first.ok, first.errorMessage).toBe(true);
    expect((first.data as { status: string }).status).toBe('void');
    expect(second.ok, second.errorMessage).toBe(true);
    expect(second.duplicate).toBe(true);
    const { data: audit } = await svc.from('audit_log').select('device_id').eq('entity_id', tabId).eq('action', 'tab.cancel');
    expect(audit).toEqual([{ device_id: 'TILL-RP-0120' }]);
  });

  it('cancel_tab: another principal cannot replay your key', async () => {
    const tabId = await emptyTab();
    const key = testIdemKey('tab.cancel');
    const mine = await appRpc(manager, 'cancel_tab', { p_tab_id: tabId, p_reason_code: 'duplicate', p_idempotency_key: key }).then(outcome);
    expect(mine.ok, mine.errorMessage).toBe(true);
    const theirs = await appRpc(owner, 'cancel_tab', { p_tab_id: tabId, p_reason_code: 'duplicate', p_idempotency_key: key }).then(outcome);
    expect(theirs.ok).toBe(false);
    expect(theirs.errorMessage).toContain('IDEMPOTENCY_CONFLICT');
  });
});
