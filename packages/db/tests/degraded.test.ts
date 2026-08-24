/**
 * Degraded mode (0021): stale TILL heartbeats flip app.is_degraded(); guest
 * writes are then refused — hold_slot only INSIDE the protected horizon
 * (venue_settings.protected_horizon_hours, default 48h), cafe ordering and
 * waiter calls outright (DEGRADED_LOCKOUT, errcode P0001) — and a fresh
 * app.heartbeat recovers everything immediately.
 *
 * The suite manipulates device_heartbeats with the service client and always
 * leaves the venue healthy (fresh heartbeat) at the end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  anonClient,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  testIdemKey,
  outcome,
  SEED_STAFF,
  createTestMenuItem,
  createTestCafeTable,
  openGuestSession,
  ensureOpenDay,
  ensureTillFresh,
} from './helpers';

const up = await stackAvailable();

const TILL_DEVICE = 'TILL-01';

describe.skipIf(!up)('degraded mode: heartbeat staleness + guest lockout (0021)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let courtId: string;
  let staleSeconds: number;
  let horizonHours: number;

  async function makeDegraded(): Promise<void> {
    const stale = new Date(Date.now() - (staleSeconds + 120) * 1000).toISOString();
    // Ensure at least one TILL device exists (bootstrap deviation: a venue that
    // never heartbeated is NOT degraded), then stale every TILL.
    const { error: upErr } = await svc
      .from('device_heartbeats')
      .upsert(
        { device_id: TILL_DEVICE, last_seen_at: stale, queue_depth: 0 },
        { onConflict: 'device_id' },
      );
    if (upErr) throw new Error(`heartbeat upsert failed: ${upErr.message}`);
    const { error } = await svc
      .from('device_heartbeats')
      .update({ last_seen_at: stale, queue_depth: 0 })
      .like('device_id', 'TILL%');
    if (error) throw new Error(`heartbeat stale update failed: ${error.message}`);
  }

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'DEGRADED');

    const { data: settings, error } = await svc
      .from('venue_settings')
      .select('heartbeat_stale_seconds, protected_horizon_hours')
      .single();
    if (error) throw new Error(`venue_settings read failed: ${error.message}`);
    staleSeconds = (settings as { heartbeat_stale_seconds: number }).heartbeat_stale_seconds;
    horizonHours = (settings as { protected_horizon_hours: number }).protected_horizon_hours;
  });

  afterAll(async () => {
    // Never leave the venue degraded for later suites / reruns.
    if (svc) await ensureTillFresh(svc);
  });

  it('stale TILL heartbeats -> app.is_degraded() = true', async () => {
    await makeDegraded();
    const { data, error } = await appRpc(anonClient(), 'is_degraded', {});
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('guest hold INSIDE the protected horizon is refused with DEGRADED_LOCKOUT', async () => {
    await makeDegraded();
    const guest = await anonymousSessionClient();
    const insideHorizon = new Date(Date.now() + Math.min(2, horizonHours - 1) * 3600_000);
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: insideHorizon.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('DEGRADED_LOCKOUT');
  });

  it('guest hold OUTSIDE the protected horizon still succeeds while degraded', async () => {
    await makeDegraded();
    const guest = await anonymousSessionClient();
    const slot = futureSlot(); // ≥ 7 days out — far beyond the 48h horizon
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect((res.data as { reservation_id: string }).reservation_id).toBeTruthy();
  });

  it('create_guest_order and raise_waiter_call are blocked OUTRIGHT while degraded', async () => {
    await makeDegraded();
    const guest = await anonymousSessionClient();

    // Blocked before any session/day/menu validation — lockout is the first gate.
    const order = await appRpc(guest, 'create_guest_order', {
      p_items: [{ variant_id: '00000000-0000-4000-8000-000000000000', qty: 1 }],
    }).then(outcome);
    expect(order.ok).toBe(false);
    expect(order.errorMessage).toContain('DEGRADED_LOCKOUT');

    const call = await appRpc(guest, 'raise_waiter_call', { p_reason: 'water' }).then(outcome);
    expect(call.ok).toBe(false);
    expect(call.errorMessage).toContain('DEGRADED_LOCKOUT');
  });

  it('fresh app.heartbeat recovers: is_degraded false, guest writes work again', async () => {
    await makeDegraded();

    const hb = await appRpc(cashier, 'heartbeat', {
      p_device_id: TILL_DEVICE,
      p_queue_depth: 0,
      p_app_version: 'test',
    }).then(outcome);
    expect(hb.ok, hb.errorMessage).toBe(true);
    expect((hb.data as { degraded: boolean }).degraded).toBe(false);

    const { data: degraded } = await appRpc(anonClient(), 'is_degraded', {});
    expect(degraded).toBe(false);

    // Full guest write path is live again: session -> order -> waiter call.
    await ensureOpenDay(manager, svc);
    const tableId = await createTestCafeTable(svc, 'DEGR');
    const menu = await createTestMenuItem(svc, 'degraded-recovery', 4_000);
    const guest = await openGuestSession(manager, tableId);

    const order = await appRpc(guest.client, 'create_guest_order', {
      p_items: [{ variant_id: menu.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(order.ok, order.errorMessage).toBe(true);
    expect(Number((order.data as { total_iqd: number }).total_iqd)).toBe(4_000);

    const call = await appRpc(guest.client, 'raise_waiter_call', { p_reason: 'order' }).then(
      outcome,
    );
    expect(call.ok, call.errorMessage).toBe(true);
    // Tidy up: resolve so the table's one-open-call slot is freed for reruns.
    const resolve = await appRpc(cashier, 'resolve_waiter_call', {
      p_call_id: (call.data as { call_id: string }).call_id,
    }).then(outcome);
    expect(resolve.ok, resolve.errorMessage).toBe(true);
  });
});
