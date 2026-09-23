/**
 * 0155 + 0156 — six staff roles, and exactly the guards each one passes.
 *
 *   * head_barista, barista, head_chef and chef hold what prep holds: the
 *     any-staff baseline plus the kitchen board (tickets read,
 *     set_ticket_status, set_order_item_ready) and nothing past it;
 *   * driver and marketing hold the baseline only — no board, no stock, no
 *     money;
 *   * prep is soft-retired, not removed: it still passes the kitchen guard;
 *   * 0157: tabs, orders and order lines are read by the station roles only,
 *     never driver or marketing, and set_staff_role moves nobody onto prep.
 *
 * The baseline is what 0156 made role-agnostic (`app.staff_role() is null`):
 * breaks, the own-PIN check, the heartbeat, staff requests and the any-staff
 * reads. Where a read is also open to guests (menu_items, venues) the probe is
 * a row only the STAFF branch returns — an inactive item, venue_settings — and
 * an anonymous session is the control.
 *
 * Self-contained: one auth user + staff row per new role through the service
 * role (the 0123 trigger files each at venue A), deleted in afterAll with the
 * probe station, its heartbeat row, the requests and the attempt rows the PIN
 * checks wrote. The probe tab and ticket stay behind, as kds-item-ready's do.
 * tests/rls-matrix.ts keeps its eight principals; these roles are not in it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  testIdemKey,
  createTestMenuItem,
  createTestCafeTable,
  createTestIngredient,
  addStockBatch,
  ensureOpenDay,
  ensureTillFresh,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PASSWORD,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();

const KITCHEN = ['head_barista', 'barista', 'head_chef', 'chef'] as const;
const NO_STATION = ['driver', 'marketing'] as const;
const NEW_ROLES = [...KITCHEN, ...NO_STATION] as const;
type NewRole = (typeof NEW_ROLES)[number];

// Registered up front by the service role, so app.heartbeat never files it
// itself: a station the caller registered would pin the staff row
// (stations.registered_by) and afterAll could not delete it.
const STATION = 'NEWROLES-PROBE';
const OWN_PIN = '583920';

describe.skipIf(!up)('0155/0156/0157 new staff roles', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let cashier: SupabaseClient;
  let prep: SupabaseClient;
  let guest: SupabaseClient;

  const ids = {} as Record<NewRole, string>;
  const as = {} as Record<NewRole, SupabaseClient>;
  const requestIds: string[] = [];

  let ticketId: string;
  let orderItemId: string;
  let orderId: string;
  let tabId: string;
  let hiddenItemId: string;
  let ingredientId: string;
  let batchId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    cashier = await signedInClient(SEED_STAFF.cashier);
    prep = await signedInClient(SEED_STAFF.prep);
    guest = await anonymousSessionClient();

    const reg = await svc
      .from('stations')
      .upsert({ id: STATION, venue_id: VENUE_A_ID, is_till: false, retired_at: null }, { onConflict: 'id' });
    expect(reg.error).toBeNull();

    for (const role of NEW_ROLES) {
      const email = `newroles-${role}-${Date.now()}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({
        email,
        password: DEV_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      ids[role] = data.user.id;
      const ins = await svc
        .from('staff')
        .insert({ id: data.user.id, display_name: `Test ${role}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
      const pin = await appRpc(owner, 'set_staff_pin', { p_staff_id: data.user.id, p_pin: OWN_PIN });
      expect(pin.error, `set_staff_pin ${role}`).toBeNull();
      as[role] = await signedInClient(email);
    }

    // A real ticket on the board, placed the way the till places one.
    await ensureTillFresh(svc);
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      await ensureOpenDay(manager, svc);
    } finally {
      await manager.auth.signOut();
    }
    const item = await createTestMenuItem(svc, 'new-roles', 3000);
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'new-roles'),
      p_label: `new-roles-${Date.now()}`,
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
    orderId = (order.data as { order_id: string }).order_id;
    const { data: line, error: lineErr } = await svc
      .from('order_items')
      .select('id')
      .eq('order_id', (order.data as { order_id: string }).order_id)
      .single();
    if (lineErr) throw new Error(lineErr.message);
    orderItemId = (line as { id: string }).id;

    // Retired once ordered: from here only the staff branch of
    // menu_items_read returns it.
    hiddenItemId = item.itemId;
    const off = await svc.from('menu_items').update({ is_active: false }).eq('id', hiddenItemId);
    expect(off.error).toBeNull();

    ingredientId = await createTestIngredient(svc, 'مكون أدوار جديدة', 'g');
    batchId = await addStockBatch(svc, ingredientId, 500, 10);
  });

  afterAll(async () => {
    const staffIds = Object.values(ids);
    // Each delete is asserted: a cleanup that silently fails leaves a staff
    // row the next run trips over.
    let r = await svc.from('staff_requests').delete().in('staff_id', staffIds);
    expect(r.error).toBeNull();
    // The requests' insert and delete both enqueued an index row (0110);
    // the source rows are gone, so the queue rows are noise.
    r = await svc.from('assistant_index_queue').delete().eq('kind', 'request').in('ref', requestIds);
    expect(r.error).toBeNull();
    r = await svc.from('device_heartbeats').delete().eq('device_id', STATION);
    expect(r.error).toBeNull();
    r = await svc.from('stations').delete().eq('id', STATION);
    expect(r.error).toBeNull();
    for (const id of staffIds) {
      r = await svc.schema('app').from('pin_attempts').delete().like('device_id', `${id}:%`);
      expect(r.error).toBeNull();
    }
    if (batchId) await svc.from('stock_batches').delete().eq('id', batchId);
    if (ingredientId) await svc.from('ingredients').delete().eq('id', ingredientId);
    for (const role of NEW_ROLES) await as[role]?.auth.signOut();
    for (const id of staffIds) {
      r = await svc.from('staff').delete().eq('id', id);
      expect(r.error, `staff delete ${id}`).toBeNull();
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
    for (const c of [owner, cashier, prep, guest]) await c?.auth.signOut();
  });

  it('every new role holds the any-staff baseline', async () => {
    for (const role of NEW_ROLES) {
      const c = as[role];

      const brk = await appRpc(c, 'break_status', { p_device_id: STATION });
      expect(brk.error, `${role} break_status`).toBeNull();
      expect(typeof (brk.data as { allowance_seconds: number }).allowance_seconds).toBe('number');

      const own = await appRpc(c, 'verify_own_pin', { p_pin: OWN_PIN, p_device_id: STATION });
      expect(own.error, `${role} verify_own_pin`).toBeNull();
      expect(own.data, `${role} verify_own_pin`).toBe(true);

      const beat = await appRpc(c, 'heartbeat', {
        p_device_id: STATION,
        p_queue_depth: 0,
        p_app_version: 'test',
        p_is_till: false,
      });
      expect(beat.error, `${role} heartbeat`).toBeNull();
      expect((beat.data as { server_time: string }).server_time).toBeTruthy();

      const ask = await appRpc(c, 'submit_staff_request', {
        p_kind: 'leave',
        p_from: '2026-11-01',
        p_to: '2026-11-02',
        p_note: `new-roles ${role}`,
      });
      expect(ask.error, `${role} submit_staff_request`).toBeNull();
      requestIds.push(ask.data as string);

      const hidden = await c.from('menu_items').select('id').eq('id', hiddenItemId);
      expect(hidden.error).toBeNull();
      expect(hidden.data, `${role} reads an inactive menu item`).toHaveLength(1);

      const venue = await c.from('venues').select('id').eq('id', VENUE_A_ID);
      expect(venue.error).toBeNull();
      expect(venue.data, `${role} reads its venue`).toHaveLength(1);

      const settings = await c.from('venue_settings').select('venue_id');
      expect(settings.error).toBeNull();
      expect((settings.data ?? []).length, `${role} reads venue_settings`).toBeGreaterThan(0);
    }
  });

  it('a guest gets none of the staff branch (control)', async () => {
    const hidden = await guest.from('menu_items').select('id').eq('id', hiddenItemId);
    expect(hidden.data ?? []).toHaveLength(0);
    const settings = await guest.from('venue_settings').select('venue_id');
    expect(settings.data ?? []).toHaveLength(0);
    const brk = await appRpc(guest, 'break_status', { p_device_id: STATION });
    expect(brk.error?.message).toBe('FORBIDDEN');
    const beat = await appRpc(guest, 'heartbeat', { p_device_id: STATION });
    expect(beat.error?.message).toBe('FORBIDDEN');
  });

  it('the bar and kitchen roles work the board, as prep still does', async () => {
    const kitchen: [string, SupabaseClient][] = [
      ...KITCHEN.map((role) => [role, as[role]] as [string, SupabaseClient]),
      ['prep', prep],
    ];
    for (const [role, c] of kitchen) {
      const seen = await c.from('tickets').select('id').eq('id', ticketId);
      expect(seen.error).toBeNull();
      expect(seen.data, `${role} reads the ticket`).toHaveLength(1);

      // queued -> preparing for the first caller; an idempotent duplicate for
      // every one after it. Either way the guard let them through.
      const bump = await appRpc(c, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'preparing' });
      expect(bump.error, `${role} set_ticket_status`).toBeNull();
      expect((bump.data as { status: string }).status).toBe('preparing');

      const mark = await appRpc(c, 'set_order_item_ready', { p_order_item_id: orderItemId, p_ready: true });
      expect(mark.error, `${role} set_order_item_ready`).toBeNull();
    }
  });

  it('driver and marketing hold no station: no board, no stock', async () => {
    for (const role of NO_STATION) {
      const c = as[role];

      const seen = await c.from('tickets').select('id').eq('id', ticketId);
      expect(seen.error).toBeNull();
      expect(seen.data, `${role} reads no ticket`).toHaveLength(0);

      const bump = await appRpc(c, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'ready' });
      expect(bump.error?.message, `${role} set_ticket_status`).toBe('FORBIDDEN');
      const mark = await appRpc(c, 'set_order_item_ready', { p_order_item_id: orderItemId, p_ready: false });
      expect(mark.error?.message, `${role} set_order_item_ready`).toBe('FORBIDDEN');

      for (const [table, id] of [
        ['ingredients', ingredientId],
        ['stock_batches', batchId],
      ] as const) {
        const rows = await c.from(table).select('id').eq('id', id);
        expect(rows.error).toBeNull();
        expect(rows.data, `${role} reads no ${table}`).toHaveLength(0);
      }
      const moves = await c.from('stock_movements').select('id').limit(5);
      expect(moves.error).toBeNull();
      expect(moves.data, `${role} reads no stock_movements`).toHaveLength(0);
    }
    // The stock rows are there to be seen, by the people who may see them.
    const ownerSees = await owner.from('stock_batches').select('id').eq('id', batchId);
    expect(ownerSees.data).toHaveLength(1);
  });

  it('no new role takes money', async () => {
    for (const role of NEW_ROLES) {
      const c = as[role];
      const settle = await appRpc(c, 'settle_tab', {
        p_tab_id: tabId,
        p_method: 'cash',
        p_idempotency_key: testIdemKey('tab.settle'),
      });
      expect(settle.error?.message, `${role} settle_tab`).toBe('FORBIDDEN');
      const paid = await c.from('payments').select('id').eq('tab_id', tabId);
      expect(paid.error).toBeNull();
      expect(paid.data, `${role} reads no payments`).toHaveLength(0);
    }
  });

  it('0157: tabs, orders and order lines stay with the station roles', async () => {
    for (const role of NO_STATION) {
      const c = as[role];
      for (const [table, column, id] of [
        ['tabs', 'id', tabId],
        ['orders', 'id', orderId],
        ['order_items', 'id', orderItemId],
        ['order_item_modifiers', 'order_item_id', orderItemId],
      ] as const) {
        const rows = await c.from(table).select(column).eq(column, id);
        expect(rows.error).toBeNull();
        expect(rows.data, `${role} reads no ${table}`).toHaveLength(0);
      }
    }
    // The bar and kitchen board reads order lines, as prep always has.
    const station: [string, SupabaseClient][] = [
      ...KITCHEN.map((role) => [role, as[role]] as [string, SupabaseClient]),
      ['prep', prep],
      ['cashier', cashier],
    ];
    for (const [role, c] of station) {
      for (const [table, id] of [
        ['tabs', tabId],
        ['orders', orderId],
        ['order_items', orderItemId],
      ] as const) {
        const rows = await c.from(table).select('id').eq('id', id);
        expect(rows.error).toBeNull();
        expect(rows.data, `${role} reads the ${table} row`).toHaveLength(1);
      }
    }
  });

  it('0157: set_staff_role moves nobody onto prep', async () => {
    const onto = await appRpc(owner, 'set_staff_role', { p_staff_id: ids.chef, p_role: 'prep' });
    expect(onto.error?.message).toBe('ROLE_RETIRED');
    const still = await svc.from('staff').select('role').eq('id', ids.chef).single();
    expect((still.data as { role: string }).role).toBe('chef');

    // Moving between live roles is untouched, and so is saving a prep account
    // unchanged; moving off prep is the whole point of the retirement.
    const across = await appRpc(owner, 'set_staff_role', { p_staff_id: ids.chef, p_role: 'barista' });
    expect(across.error).toBeNull();
    const back = await appRpc(owner, 'set_staff_role', { p_staff_id: ids.chef, p_role: 'chef' });
    expect(back.error).toBeNull();
    const same = await appRpc(owner, 'set_staff_role', { p_staff_id: SEED_STAFF_IDS.prep, p_role: 'prep' });
    expect(same.error).toBeNull();
  });
});
