/**
 * 0396 — a ticket completed by mistake comes back for ten minutes (F-57), and
 * the kitchen board says which tickets it has shown (F-11, tickets.kds_seen_at).
 *
 *   recall_ticket   completed → ready within ten minutes; the order goes from
 *                   served back to ready; a second recall is {duplicate: true};
 *                   after ten minutes TICKET_RECALL_EXPIRED; a live ticket is
 *                   INVALID_TRANSITION; no ticket is TICKET_NOT_FOUND; the court
 *                   desk is FORBIDDEN.
 *   kds_ack_tickets stamps the first sighting once and keeps it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  testIdemKey,
  SEED_STAFF,
  createTestMenuItem,
  ensureOpenDay,
  ensureTillFresh,
  createTestCafeTable,
} from './helpers';

const up = await stackAvailable();
const NIL = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!up)('0396 kds recall and seen', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
  let prep: SupabaseClient;
  let desk: SupabaseClient;
  let item: Awaited<ReturnType<typeof createTestMenuItem>>;

  beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      await ensureOpenDay(manager, svc);
    } finally {
      await manager.auth.signOut();
    }
    cashier = await signedInClient(SEED_STAFF.cashier);
    prep = await signedInClient(SEED_STAFF.prep);
    desk = await signedInClient(SEED_STAFF.court_desk);
    item = await createTestMenuItem(svc, 'kds-recall', 3000);
  });

  afterAll(async () => {
    await cashier?.auth.signOut();
    await prep?.auth.signOut();
    await desk?.auth.signOut();
  });

  async function makeTicket(): Promise<{ ticketId: string; orderId: string }> {
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'kds-recall'),
      p_label: `kds-recall-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (tab.error) throw new Error(tab.error.message);
    const order = await appRpc(cashier, 'till_add_items', {
      p_tab_id: (tab.data as { tab_id: string }).tab_id,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (order.error) throw new Error(order.error.message);
    const o = order.data as { ticket_id: string; order_id: string };
    return { ticketId: o.ticket_id, orderId: o.order_id };
  }

  async function complete(ticketId: string): Promise<void> {
    for (const status of ['preparing', 'ready', 'completed']) {
      const res = await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: status });
      if (res.error) throw new Error(`bump to ${status}: ${res.error.message}`);
    }
  }

  async function row(ticketId: string) {
    const { data, error } = await svc
      .from('tickets')
      .select('status, completed_at, kds_seen_at, order:orders(status)')
      .eq('id', ticketId)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as {
      status: string;
      completed_at: string | null;
      kds_seen_at: string | null;
      order: { status: string };
    };
  }

  it('brings a just-completed ticket back to ready, and its order with it', async () => {
    const { ticketId } = await makeTicket();
    await complete(ticketId);
    expect((await row(ticketId)).order.status).toBe('served');

    const res = await appRpc(prep, 'recall_ticket', { p_ticket_id: ticketId, p_device_id: 'KDS-01' });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ duplicate: false, status: 'ready' });

    const after = await row(ticketId);
    expect(after.status).toBe('ready');
    expect(after.completed_at).toBeNull();
    expect(after.order.status).toBe('ready');

    // A replay of the queued recall, or a second screen: state-idempotent.
    const again = await appRpc(prep, 'recall_ticket', { p_ticket_id: ticketId });
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ duplicate: true, status: 'ready' });

    // And it can be completed again.
    const done = await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'completed' });
    expect(done.error).toBeNull();
  });

  it('refuses after ten minutes (TICKET_RECALL_EXPIRED)', async () => {
    const { ticketId } = await makeTicket();
    await complete(ticketId);
    const aged = await svc
      .from('tickets')
      .update({ completed_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      .eq('id', ticketId);
    expect(aged.error).toBeNull();
    const res = await appRpc(prep, 'recall_ticket', { p_ticket_id: ticketId });
    expect(res.error?.message).toContain('TICKET_RECALL_EXPIRED');
    expect((await row(ticketId)).status).toBe('completed');
  });

  it('refuses a ticket that is still live (INVALID_TRANSITION) and one that is not there', async () => {
    const { ticketId } = await makeTicket();
    const live = await appRpc(prep, 'recall_ticket', { p_ticket_id: ticketId });
    expect(live.error?.message).toContain('INVALID_TRANSITION');

    const missing = await appRpc(prep, 'recall_ticket', { p_ticket_id: NIL });
    expect(missing.error?.message).toContain('TICKET_NOT_FOUND');
  });

  it('is the kitchen list only: the court desk is FORBIDDEN', async () => {
    const { ticketId } = await makeTicket();
    await complete(ticketId);
    const res = await appRpc(desk, 'recall_ticket', { p_ticket_id: ticketId });
    expect(res.error?.message).toContain('FORBIDDEN');
    const ack = await appRpc(desk, 'kds_ack_tickets', { p_ticket_ids: [ticketId] });
    expect(ack.error?.message).toContain('FORBIDDEN');
  });

  it('kds_ack_tickets stamps the first sighting once and keeps it', async () => {
    const { ticketId } = await makeTicket();
    expect((await row(ticketId)).kds_seen_at).toBeNull();

    const first = await appRpc(prep, 'kds_ack_tickets', { p_ticket_ids: [ticketId, NIL] });
    expect(first.error).toBeNull();
    expect(first.data).toEqual({ acked: 1 });
    const seen = (await row(ticketId)).kds_seen_at;
    expect(seen).not.toBeNull();

    const second = await appRpc(prep, 'kds_ack_tickets', { p_ticket_ids: [ticketId] });
    expect(second.data).toEqual({ acked: 0 });
    expect((await row(ticketId)).kds_seen_at).toBe(seen);

    // A bump is not a sighting: a fresh ticket bumped at the till stays unseen.
    const bumped = await makeTicket();
    const r = await appRpc(cashier, 'set_ticket_status', { p_ticket_id: bumped.ticketId, p_status: 'ready' });
    expect(r.error).toBeNull();
    expect((await row(bumped.ticketId)).kds_seen_at).toBeNull();

    const empty = await appRpc(prep, 'kds_ack_tickets', { p_ticket_ids: [] });
    expect(empty.data).toEqual({ acked: 0 });
  });
});
