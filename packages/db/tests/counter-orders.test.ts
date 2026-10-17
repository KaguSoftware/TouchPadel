/**
 * counter_orders (0352): order first, the table after.
 *
 *   * app.open_tab opens a café tab with no table and no booking (a counter
 *     tab), labelled with the name given or the day's next "#<n>".
 *   * app.till_add_items on a counter tab defaults to pick up (0351).
 *   * app.order_set_delivery sets pick up or bring it, to a table, to a
 *     booking's court, or to nowhere yet, at any time after the order was
 *     placed; its refusals; audited; cashier and MGMT only.
 *   * app.kitchen_board carries order.deliver_table / order.deliver_court to
 *     every board role.
 *   * orders_deliver_spot holds the shape for every writer.
 *
 * Probe rows stay behind, as kitchen-board.test.ts's do.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  testIdemKey,
  createTestMenuItem,
  createTestCafeTable,
  createTestCourt,
  ensureOpenDay,
  ensureTillFresh,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

interface BoardOrder {
  id: string;
  service: string;
  deliver_table: { table_number: string } | null;
  deliver_court: { name_en: string; name_ar: string } | null;
}

describe.skipIf(!up)('counter_orders (0352)', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
  let manager: SupabaseClient;
  let prep: SupabaseClient;
  let item: { itemId: string; variantId: string };
  let tableId: string;
  let tableNumber: string;
  let reservationId: string;
  let courtName: string;

  async function counterTab(label?: string): Promise<{ tabId: string; label: string }> {
    const res = await appRpc(cashier, 'open_tab', {
      ...(label === undefined ? {} : { p_label: label }),
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (res.error) throw new Error(`open_tab: ${res.error.message}`);
    const d = res.data as { tab_id: string; label: string };
    return { tabId: d.tab_id, label: d.label };
  }

  async function send(tabId: string, service?: string): Promise<{ order_id: string; ticket_id: string; service: string }> {
    const res = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
      ...(service ? { p_service: service } : {}),
    });
    if (res.error) throw new Error(`till_add_items: ${res.error.message}`);
    return res.data as { order_id: string; ticket_id: string; service: string };
  }

  async function setDelivery(c: SupabaseClient, args: Record<string, unknown>) {
    return appRpc(c, 'order_set_delivery', args);
  }

  async function row(orderId: string) {
    const r = await svc.from('orders').select('service, deliver_table_id, deliver_reservation_id').eq('id', orderId).single();
    if (r.error) throw new Error(r.error.message);
    return r.data as { service: string; deliver_table_id: string | null; deliver_reservation_id: string | null };
  }

  async function boardOrder(c: SupabaseClient, ticketId: string): Promise<BoardOrder | undefined> {
    const res = await appRpc(c, 'kitchen_board', {});
    if (res.error) throw new Error(`kitchen_board: ${res.error.message}`);
    return (res.data as { tickets: { id: string; order: BoardOrder }[] }).tickets.find((t) => t.id === ticketId)?.order;
  }

  beforeAll(async () => {
    svc = serviceClient();
    cashier = await signedInClient(SEED_STAFF.cashier);
    manager = await signedInClient(SEED_STAFF.manager);
    prep = await signedInClient(SEED_STAFF.prep);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    item = await createTestMenuItem(svc, 'counter-orders', 3000);
    tableId = await createTestCafeTable(svc, 'counter-orders');
    const t = await svc.from('cafe_tables').select('table_number').eq('id', tableId).single();
    if (t.error) throw new Error(t.error.message);
    tableNumber = (t.data as { table_number: string }).table_number;

    courtName = `Counter Orders ${Date.now()}`;
    const courtId = await createTestCourt(svc, courtName);
    const start = new Date(Date.now() + 61 * 86_400_000);
    start.setUTCHours(12, 0, 0, 0);
    const booking = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
        guest_name: 'Counter Orders Guest',
        price_iqd: 30_000,
      })
      .select('id')
      .single();
    if (booking.error) throw new Error(booking.error.message);
    reservationId = (booking.data as { id: string }).id;
  });

  afterAll(async () => {
    for (const c of [cashier, manager, prep]) await c?.auth.signOut();
  });

  describe('the counter tab', () => {
    it('opens with no table and no booking, on the name given', async () => {
      const name = `Ali ${Date.now()}`;
      const { tabId, label } = await counterTab(name);
      expect(label).toBe(name);
      const r = await svc.from('tabs').select('kind, table_id, reservation_id, label').eq('id', tabId).single();
      expect(r.data).toMatchObject({ kind: 'cafe', table_id: null, reservation_id: null, label: name });
    });

    it('with no name takes the next counter number of the day', async () => {
      const a = await counterTab();
      const b = await counterTab();
      expect(a.label).toMatch(/^#\d+$/);
      expect(Number(b.label.slice(1))).toBe(Number(a.label.slice(1)) + 1);
    });

    it('sends as a pick up unless the till chose to bring it', async () => {
      const { tabId } = await counterTab();
      expect((await send(tabId)).service).toBe('pickup');
      const bring = await send(tabId, 'deliver');
      expect(await row(bring.order_id)).toEqual({ service: 'deliver', deliver_table_id: null, deliver_reservation_id: null });
    });
  });

  describe('app.order_set_delivery', () => {
    it('attaches a table after the order was placed, and every board role reads it', async () => {
      const { tabId } = await counterTab();
      const sent = await send(tabId);
      const res = await setDelivery(cashier, { p_order_id: sent.order_id, p_service: 'deliver', p_table_id: tableId });
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({ service: 'deliver', deliver_table_id: tableId, deliver_reservation_id: null });
      expect(await row(sent.order_id)).toEqual({ service: 'deliver', deliver_table_id: tableId, deliver_reservation_id: null });
      for (const [who, c] of [['prep', prep], ['cashier', cashier]] as const) {
        const o = await boardOrder(c, sent.ticket_id);
        expect(o?.deliver_table, who).toEqual({ table_number: tableNumber });
        expect(o?.deliver_court, who).toBeNull();
      }
      const audit = await svc.from('audit_log').select('action').eq('entity_id', sent.order_id).eq('action', 'order.delivery');
      expect(audit.data ?? []).toHaveLength(1);
    });

    it("moves it to a booking's court, to nowhere yet, and back to pick up", async () => {
      const { tabId } = await counterTab();
      const sent = await send(tabId, 'deliver');
      expect((await setDelivery(manager, { p_order_id: sent.order_id, p_service: 'deliver', p_reservation_id: reservationId })).error).toBeNull();
      expect((await boardOrder(prep, sent.ticket_id))?.deliver_court).toEqual({ name_en: courtName, name_ar: `ملعب اختبار ${courtName}` });
      expect((await setDelivery(cashier, { p_order_id: sent.order_id, p_service: 'deliver' })).error).toBeNull();
      expect(await row(sent.order_id)).toEqual({ service: 'deliver', deliver_table_id: null, deliver_reservation_id: null });
      expect((await setDelivery(cashier, { p_order_id: sent.order_id, p_service: 'pickup' })).error).toBeNull();
      expect((await boardOrder(prep, sent.ticket_id))?.service).toBe('pickup');
    });

    it('refuses a bad shape: an unknown service, two spots, a pick up with a spot', async () => {
      const { tabId } = await counterTab();
      const { order_id } = await send(tabId);
      for (const [args, hint] of [
        [{ p_service: 'drone' }, 'service'],
        [{ p_service: 'deliver', p_table_id: tableId, p_reservation_id: reservationId }, 'one spot'],
        [{ p_service: 'pickup', p_table_id: tableId }, 'a pick up has no spot'],
      ] as const) {
        const res = await setDelivery(cashier, { p_order_id: order_id, ...args });
        expect(res.error?.message, hint).toBe('INVALID_ARGUMENT');
        expect(res.error?.hint, hint).toBe(hint);
      }
      expect((await row(order_id)).service).toBe('pickup');
    });

    it('refuses a table that is not active, a booking that is not live, and an order that is gone', async () => {
      const { tabId } = await counterTab();
      const { order_id } = await send(tabId);
      const retired = await createTestCafeTable(svc, 'counter-orders-retired');
      await svc.from('cafe_tables').update({ is_active: false }).eq('id', retired);
      expect((await setDelivery(cashier, { p_order_id: order_id, p_service: 'deliver', p_table_id: retired })).error?.message).toBe('TABLE_NOT_FOUND');

      const cancelled = await svc
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', reservationId)
        .select('id');
      expect(cancelled.error).toBeNull();
      try {
        const res = await setDelivery(cashier, { p_order_id: order_id, p_service: 'deliver', p_reservation_id: reservationId });
        expect(res.error?.message).toBe('RESERVATION_NOT_LIVE');
      } finally {
        await svc.from('reservations').update({ status: 'confirmed' }).eq('id', reservationId);
      }

      const missing = await setDelivery(cashier, { p_order_id: '00000000-0000-4000-8000-000000000352', p_service: 'pickup' });
      expect(missing.error?.message).toBe('ORDER_NOT_FOUND');
    });

    it('is the till and MGMT only', async () => {
      const { tabId } = await counterTab();
      const { order_id } = await send(tabId);
      const res = await setDelivery(prep, { p_order_id: order_id, p_service: 'deliver', p_table_id: tableId });
      expect(res.error?.message).toBe('FORBIDDEN');
      expect((await row(order_id)).deliver_table_id).toBeNull();
    });
  });

  it('orders_deliver_spot holds the shape for every writer', async () => {
    const { tabId } = await counterTab();
    const { order_id } = await send(tabId);
    const pickupWithTable = await svc.from('orders').update({ deliver_table_id: tableId }).eq('id', order_id);
    expect(pickupWithTable.error?.message).toMatch(/orders_deliver_spot/);
    const both = await svc
      .from('orders')
      .update({ service: 'deliver', deliver_table_id: tableId, deliver_reservation_id: reservationId })
      .eq('id', order_id);
    expect(both.error?.message).toMatch(/orders_deliver_spot/);
  });
});
