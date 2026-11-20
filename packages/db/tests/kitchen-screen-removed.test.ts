/**
 * 0447 kitchen_screen_removed: the kitchen screen (KDS) is gone, and so is what
 * only fed it.
 *
 *   * its six functions are no longer there (a call is PGRST202, "no function
 *     with that signature"), and tickets.kds_seen_at with them;
 *   * the 'kds' access area is gone from app.access_area_rpcs, from the CHECK
 *     on staff.blocked_areas and from set_staff_access, which now refuses it;
 *   * app.queueable_rpcs no longer lists recall_ticket;
 *   * app.ops_overview answers no kitchen ticket count;
 *   * what stays still works: a sent order still gets its ticket (queued), and
 *     the order's service is still the till's choice (0351), now read from the
 *     order itself.
 *
 * Probe rows stay behind, as the other order tests' do.
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
  ensureOpenDay,
  ensureTillFresh,
  SEED_STAFF,
} from './helpers';
import { docker, scenario, psql, T, MK } from './psql-scenario';

const up = await stackAvailable();
const NIL = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!up)('0447 kitchen screen removed: through the API', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
  let manager: SupabaseClient;
  let prep: SupabaseClient;
  let item: Awaited<ReturnType<typeof createTestMenuItem>>;
  let tableId: string;

  beforeAll(async () => {
    svc = serviceClient();
    cashier = await signedInClient(SEED_STAFF.cashier);
    manager = await signedInClient(SEED_STAFF.manager);
    prep = await signedInClient(SEED_STAFF.prep);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    item = await createTestMenuItem(svc, 'kitchen-removed', 3000);
    tableId = await createTestCafeTable(svc, 'kitchen-removed');
  });

  afterAll(async () => {
    for (const c of [cashier, manager, prep]) await c?.auth.signOut();
  });

  it('the screen’s functions are gone, for every caller', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['kitchen_board', {}],
      ['kds_ack_tickets', { p_ticket_ids: [NIL] }],
      ['recall_ticket', { p_ticket_id: NIL }],
      ['kitchen_reach', { p_since: null }],
      ['set_order_item_ready', { p_order_item_id: NIL, p_ready: true }],
      ['set_ticket_status', { p_ticket_id: NIL, p_status: 'ready' }],
    ];
    for (const [fn, args] of calls) {
      for (const [who, c] of [['prep', prep], ['cashier', cashier], ['manager', manager]] as const) {
        const res = await appRpc(c, fn, args);
        expect(res.error?.code, `${who} ${fn}`).toBe('PGRST202');
      }
    }
  });

  it('tickets has no kds_seen_at column', async () => {
    const res = await svc.from('tickets').select('kds_seen_at').limit(1);
    expect(res.error).not.toBeNull();
  });

  it('a sent order still gets its ticket, queued, and keeps the till’s service choice', async () => {
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: tableId,
      p_label: `kitchen-removed-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    expect(tab.error).toBeNull();
    const tabId = (tab.data as { tab_id: string }).tab_id;
    const sent = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
      p_service: 'pickup',
    });
    expect(sent.error).toBeNull();
    const { ticket_id, order_id } = sent.data as { ticket_id: string; order_id: string };
    const ticket = await svc.from('tickets').select('status, order_id').eq('id', ticket_id).single();
    expect(ticket.data).toEqual({ status: 'queued', order_id });
    const order = await svc.from('orders').select('service').eq('id', order_id).single();
    expect(order.data).toEqual({ service: 'pickup' });
  });

  it('ops_overview answers no kitchen ticket count', async () => {
    const res = await appRpc(manager, 'ops_overview', {});
    expect(res.error).toBeNull();
    const cafe = (res.data as { cafe: Record<string, unknown> }).cafe;
    expect(Object.keys(cafe).sort()).toEqual(['openTabs', 'ordersToday', 'waiterCallsOpen']);
  });
});

describe.skipIf(!docker)('0447 kitchen screen removed: the access area', () => {
  it('app.access_area_rpcs holds no kds row and refuses one', () => {
    expect(psql(`select count(*) from app.access_area_rpcs where area = 'kds'`)).toBe('0');
    expect(() => psql(`insert into app.access_area_rpcs (area, rpc) values ('kds', 'x_probe')`)).toThrow();
  });

  it('no staff row holds the word, and the CHECK refuses it', () => {
    expect(psql(`select count(*) from staff where 'kds' = any(blocked_areas)`)).toBe('0');
    const r = scenario([
      MK('c1', 'cashier'),
      T('kds', 'owner', `select app.set_staff_access({{c1}}::uuid, '{}', '{kds}')`),
      T('till', 'owner', `select app.set_staff_access({{c1}}::uuid, '{}', '{till}')->'blocked_areas'`),
    ]);
    expect(r.kds).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(r.till).toMatchObject({ ok: true, data: ['till'] });
  });

  it('recall_ticket is no longer queueable', () => {
    expect(psql(`select 'recall_ticket' = any (app.queueable_rpcs())`)).toBe('f');
    expect(psql(`select 'set_tab_customer' = any (app.queueable_rpcs())`)).toBe('t');
  });
});
