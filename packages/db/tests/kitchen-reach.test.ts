/**
 * 0399 — "not received by the kitchen" on every station (F-11).
 *
 * app.kitchen_reach is the read the operator's flag uses on any station: any
 * active staff member (the court desk too, whom tickets_staff_read leaves
 * out) sees the branch's recent tickets with when a kitchen screen first drew
 * them (kds_seen_at, 0396), and nothing else about the order.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  testIdemKey,
  SEED_STAFF,
  createTestMenuItem,
  ensureOpenDay,
  ensureTillFresh,
  createTestCafeTable,
} from './helpers';

const up = await stackAvailable();

interface ReachRow {
  id: string;
  status: string;
  created_at: string;
  kds_seen_at: string | null;
  tab_id: string | null;
  idempotency_key: string | null;
}

describe.skipIf(!up)('0399 kitchen_reach', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
  let prep: SupabaseClient;
  let desk: SupabaseClient;
  let ticketId = '';
  let tabId = '';

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
    const item = await createTestMenuItem(svc, 'kitchen-reach', 2500);
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'kitchen-reach'),
      p_label: `kitchen-reach-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (tab.error) throw new Error(tab.error.message);
    tabId = (tab.data as { tab_id: string }).tab_id;
    const order = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (order.error) throw new Error(order.error.message);
    ticketId = (order.data as { ticket_id: string }).ticket_id;
  });

  afterAll(async () => {
    await cashier?.auth.signOut();
    await prep?.auth.signOut();
    await desk?.auth.signOut();
  });

  const read = async (c: SupabaseClient) => {
    const r = await appRpc(c, 'kitchen_reach', { p_since: new Date(Date.now() - 3_600_000).toISOString() }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
    return r.data as ReachRow[];
  };

  it('the court desk sees an unseen ticket with its tab, though it cannot read tickets', async () => {
    const direct = await desk.from('tickets').select('id').eq('id', ticketId);
    expect(direct.data ?? []).toHaveLength(0);
    const row = (await read(desk)).find((r) => r.id === ticketId);
    expect(row).toMatchObject({ tab_id: tabId, kds_seen_at: null, status: 'queued' });
    expect(Object.keys(row!).sort()).toEqual(['created_at', 'id', 'idempotency_key', 'kds_seen_at', 'status', 'tab_id']);
  });

  it('once a kitchen screen draws it, every station reads it as seen', async () => {
    const ack = await appRpc(prep, 'kds_ack_tickets', { p_ticket_ids: [ticketId] }).then(outcome);
    expect(ack.ok, ack.errorMessage).toBe(true);
    for (const c of [desk, cashier]) {
      const row = (await read(c)).find((r) => r.id === ticketId);
      expect(row?.kds_seen_at).not.toBeNull();
    }
  });

  it('a guest is refused', async () => {
    const guest = await anonymousSessionClient();
    const r = await appRpc(guest, 'kitchen_reach', {}).then(outcome);
    expect(r.errorMessage).toBe('FORBIDDEN');
    await guest.auth.signOut();
  });
});
