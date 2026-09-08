/**
 * 0061 — KDS item-ready marks live server-side (operator audit M1, SOW L460-462).
 * The marks used to be a component useState<Set>: a reload lost them, a second
 * prep station never saw them, and prep time was stamped at completion.
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
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0061 kds item ready', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
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
    item = await createTestMenuItem(svc, 'kds-ready', 4000);
  });

  afterAll(async () => {
    await cashier.auth.signOut();
  });

  async function makeTicket(): Promise<{ ticketId: string; itemIds: string[] }> {
    const tab = await appRpc(cashier, 'open_tab', {
      p_label: `kds-ready-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (tab.error) throw new Error(tab.error.message);
    const order = await appRpc(cashier, 'till_add_items', {
      p_tab_id: (tab.data as { tab_id: string }).tab_id,
      p_items: [
        { variant_id: item.variantId, qty: 1 },
        { variant_id: item.variantId, qty: 2 },
      ],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (order.error) throw new Error(order.error.message);
    const { data } = await svc
      .from('order_items')
      .select('id')
      .eq('order_id', (order.data as { order_id: string }).order_id)
      .order('id');
    return {
      ticketId: (order.data as { ticket_id: string }).ticket_id,
      itemIds: (data as { id: string }[]).map((r) => r.id),
    };
  }

  it('marks persist, all_items_ready flips on the last item, unmark reverses', async () => {
    const { itemIds } = await makeTicket();
    const first = await appRpc(cashier, 'set_order_item_ready', {
      p_order_item_id: itemIds[0],
      p_ready: true,
    });
    expect(first.error).toBeNull();
    expect((first.data as { all_items_ready: boolean }).all_items_ready).toBe(false);

    const second = await appRpc(cashier, 'set_order_item_ready', {
      p_order_item_id: itemIds[1],
      p_ready: true,
    });
    expect((second.data as { all_items_ready: boolean }).all_items_ready).toBe(true);

    const undone = await appRpc(cashier, 'set_order_item_ready', {
      p_order_item_id: itemIds[1],
      p_ready: false,
    });
    expect((undone.data as { ready_at: string | null }).ready_at).toBeNull();
    expect((undone.data as { all_items_ready: boolean }).all_items_ready).toBe(false);
  });

  it('is idempotent — a double-tap keeps the first timestamp', async () => {
    const { itemIds } = await makeTicket();
    const a = await appRpc(cashier, 'set_order_item_ready', {
      p_order_item_id: itemIds[0],
      p_ready: true,
    });
    const b = await appRpc(cashier, 'set_order_item_ready', {
      p_order_item_id: itemIds[0],
      p_ready: true,
    });
    expect((b.data as { ready_at: string }).ready_at).toBe(
      (a.data as { ready_at: string }).ready_at,
    );
  });

  it('refuses marks on a finished ticket (TICKET_CLOSED)', async () => {
    const { ticketId, itemIds } = await makeTicket();
    for (const status of ['preparing', 'ready', 'completed']) {
      const res = await appRpc(cashier, 'set_ticket_status', {
        p_ticket_id: ticketId,
        p_status: status,
      });
      expect(res.error, `bump to ${status}`).toBeNull();
    }
    const refused = await appRpc(cashier, 'set_order_item_ready', {
      p_order_item_id: itemIds[0],
      p_ready: false,
    });
    expect(refused.error?.message).toContain('TICKET_CLOSED');
  });

  it('stamps actual_prep_seconds at READY, not completion (SOW L462)', async () => {
    const { ticketId } = await makeTicket();
    await appRpc(cashier, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'preparing' });
    const ready = await appRpc(cashier, 'set_ticket_status', {
      p_ticket_id: ticketId,
      p_status: 'ready',
    });
    expect(ready.error).toBeNull();
    expect((ready.data as { actual_prep_seconds: number }).actual_prep_seconds).toBeTypeOf(
      'number',
    );
    const { data } = await svc
      .from('tickets')
      .select('actual_prep_seconds, completed_at')
      .eq('id', ticketId)
      .single();
    expect((data as { actual_prep_seconds: number }).actual_prep_seconds).not.toBeNull();
    expect((data as { completed_at: string | null }).completed_at).toBeNull();
  });

  it('a ticket bumped to ready marks every live item ready (unchanged 0015 behaviour)', async () => {
    const { ticketId, itemIds } = await makeTicket();
    await appRpc(cashier, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'ready' });
    const { data } = await svc
      .from('order_items')
      .select('id, ready_at')
      .in('id', itemIds);
    for (const row of data as { ready_at: string | null }[]) {
      expect(row.ready_at).not.toBeNull();
    }
  });
});
