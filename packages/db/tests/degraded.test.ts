/**
 * Degraded mode (0021): stale TILL heartbeats flip app.is_degraded() while the
 * branch has an open business day (0247); guest
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
  guestClient,
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
  forceCloseAllDays,
  ensureTillFresh,
  VENUE_A_ID,
  registerTestStation,
  setOfflineMode,
} from './helpers';

const up = await stackAvailable();

// Deliberately NOT 'TILL%'-prefixed: degraded detection must key off the
// explicit is_till flag (0026); the name prefix is only legacy back-compat.
const TILL_DEVICE = 'REG-01';
const DESK_DEVICE = 'DESK-DEGRADED-PROBE';

describe.skipIf(!up)('degraded mode: heartbeat staleness + guest lockout (0021)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let courtId: string;
  let staleSeconds: number;
  let horizonHours: number;

  async function makeDegraded(): Promise<void> {
    // 0247: only a trading branch can be degraded.
    await ensureOpenDay(manager, svc);
    const stale = new Date(Date.now() - (staleSeconds + 120) * 1000).toISOString();
    // Ensure at least one till device exists (bootstrap deviation: a venue that
    // never heartbeated is NOT degraded), then stale every till — flag or
    // legacy 'TILL%' name (0026).
    await registerTestStation(svc, TILL_DEVICE); // 0229: a heartbeat row needs a live station
    const { error: upErr } = await svc
      .from('device_heartbeats')
      .upsert(
        { device_id: TILL_DEVICE, last_seen_at: stale, queue_depth: 0, is_till: true },
        { onConflict: 'device_id' },
      );
    if (upErr) throw new Error(`heartbeat upsert failed: ${upErr.message}`);
    const { error } = await svc
      .from('device_heartbeats')
      .update({ last_seen_at: stale, queue_depth: 0 })
      .or('is_till.eq.true,device_id.like.TILL*');
    if (error) throw new Error(`heartbeat stale update failed: ${error.message}`);
  }

  /** A slot inside the protected horizon AND inside opening hours: the next
   *  07:00 UTC (= 10:00 venue-local) is always < 24h out — well inside the
   *  default 48h horizon — and always bookable per app.assert_bookable. */
  function insideHorizonOpenSlot(): Date {
    const d = new Date();
    d.setUTCHours(7, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    // 0248: offline mode is off by default; this suite is about it being on.
    await setOfflineMode(svc, true);
    // Single-till invariant for the recovery test: drop till rows left over
    // from earlier runs (flagged or legacy-named) so ONE fresh heartbeat
    // un-degrades the venue.
    const { error: delErr } = await svc
      .from('device_heartbeats')
      .delete()
      .or('is_till.eq.true,device_id.like.TILL*');
    if (delErr) throw new Error(`till cleanup failed: ${delErr.message}`);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'DEGRADED');

    const { data: settings, error } = await svc
      .from('venue_settings')
      .select('heartbeat_stale_seconds, protected_horizon_hours').eq('venue_id', VENUE_A_ID)
      .single();
    if (error) throw new Error(`venue_settings read failed: ${error.message}`);
    staleSeconds = (settings as { heartbeat_stale_seconds: number }).heartbeat_stale_seconds;
    horizonHours = (settings as { protected_horizon_hours: number }).protected_horizon_hours;
  });

  afterAll(async () => {
    // Never leave the venue degraded for later suites / reruns.
    if (svc) {
      await ensureTillFresh(svc);
      await setOfflineMode(svc, false);
    }
  });

  it('stale is_till-flagged heartbeats -> app.is_degraded() = true (0026 flag, non-TILL name)', async () => {
    await makeDegraded();
    const { data, error } = await appRpc(anonClient(), 'is_degraded', {});
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('legacy TILL%-named device without the flag still counts (back-compat)', async () => {
    // Make the un-flagged, legacy-named device the ONLY till: its staleness
    // alone must flip degraded (proving the name-prefix path still detects).
    const { error: delAll } = await svc
      .from('device_heartbeats')
      .delete()
      .or('is_till.eq.true,device_id.like.TILL*');
    expect(delAll).toBeNull();
    const stale = new Date(Date.now() - (staleSeconds + 120) * 1000).toISOString();
    // 0229: a heartbeat row needs a live station; a legacy one, not flagged a till.
    await registerTestStation(svc, 'TILL-LEGACY', { isTill: false });
    const { error } = await svc
      .from('device_heartbeats')
      .insert({ device_id: 'TILL-LEGACY', last_seen_at: stale, queue_depth: 0, is_till: false });
    expect(error).toBeNull();
    const { data } = await appRpc(anonClient(), 'is_degraded', {});
    expect(data).toBe(true);
    // Remove the legacy probe so the single-till invariant holds again.
    const { error: delErr } = await svc
      .from('device_heartbeats')
      .delete()
      .eq('device_id', 'TILL-LEGACY');
    expect(delErr).toBeNull();
  });

  it('guest hold INSIDE the protected horizon is refused with DEGRADED_LOCKOUT', async () => {
    await makeDegraded();
    expect(horizonHours).toBeGreaterThanOrEqual(24); // insideHorizonOpenSlot() assumption
    const guest = await guestClient(svc, 'degraded-inside');
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: insideHorizonOpenSlot().toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('DEGRADED_LOCKOUT');
  });

  it('guest hold OUTSIDE the protected horizon still succeeds while degraded', async () => {
    await makeDegraded();
    const guest = await guestClient(svc, 'degraded-outside');
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

  it('0247: a stale till with no open day is NOT degraded, and closing the day ends the period', async () => {
    await makeDegraded();
    // The minute cron is not running here; a desk beat sweeps this branch.
    await registerTestStation(svc, DESK_DEVICE, { isTill: false });
    const sweep = async () => {
      const beat = await appRpc(cashier, 'heartbeat', { p_device_id: DESK_DEVICE, p_is_till: false });
      expect(beat.error).toBeNull();
    };
    await sweep();
    const open = await svc.from('degraded_periods').select('id').eq('venue_id', VENUE_A_ID).is('ended_at', null);
    expect(open.data ?? [], 'trading with a silent till opens a period').toHaveLength(1);

    // The night: the day is closed and the till is switched off.
    await forceCloseAllDays(svc);
    const { data: degraded } = await appRpc(anonClient(), 'is_degraded', {});
    expect(degraded).toBe(false);
    await sweep();
    const stillOpen = await svc.from('degraded_periods').select('id').eq('venue_id', VENUE_A_ID).is('ended_at', null);
    expect(stillOpen.data ?? [], 'no open day, no degraded period').toHaveLength(0);

    // Guests book inside the protected horizon again.
    const guest = await guestClient(svc, 'degraded-closed-day');
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: insideHorizonOpenSlot().toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);

    await svc.from('device_heartbeats').delete().eq('device_id', DESK_DEVICE);
  });

  it('0248: the owner switches offline mode off and the venue is online at once', async () => {
    await makeDegraded();
    expect((await appRpc(anonClient(), 'is_degraded', {})).data).toBe(true);

    const owner = await signedInClient(SEED_STAFF.owner);
    const managerTry = await appRpc(manager, 'set_venue_details', { p_patch: { offline_mode_enabled: false } }).then(outcome);
    expect(managerTry.errorMessage).toContain('FORBIDDEN');
    const bad = await appRpc(owner, 'set_venue_details', { p_patch: { offline_mode_enabled: 'no' } }).then(outcome);
    expect(bad.errorMessage).toContain('INVALID_ARGUMENT');

    const off = await appRpc(owner, 'set_venue_details', { p_patch: { offline_mode_enabled: false } }).then(outcome);
    expect(off.ok, off.errorMessage).toBe(true);
    expect((off.data as { offline_mode_enabled: boolean }).offline_mode_enabled).toBe(false);
    expect((await appRpc(anonClient(), 'is_degraded', {})).data).toBe(false);
    const open = await svc.from('degraded_periods').select('id').eq('venue_id', VENUE_A_ID).is('ended_at', null);
    expect(open.data ?? [], 'switching off ends the logged period').toHaveLength(0);

    // Guests order again with the till still silent.
    const guest = await anonymousSessionClient();
    const order = await appRpc(guest, 'create_guest_order', {
      p_items: [{ variant_id: '00000000-0000-4000-8000-000000000000', qty: 1 }],
    }).then(outcome);
    expect(order.errorMessage ?? '').not.toContain('DEGRADED_LOCKOUT');

    const on = await appRpc(owner, 'set_venue_details', { p_patch: { offline_mode_enabled: true } }).then(outcome);
    expect(on.ok, on.errorMessage).toBe(true);
    expect((await appRpc(anonClient(), 'is_degraded', {})).data).toBe(true);
    await owner.auth.signOut();
  });

  it('fresh app.heartbeat recovers: is_degraded false, guest writes work again', async () => {
    await makeDegraded();

    const hb = await appRpc(cashier, 'heartbeat', {
      p_device_id: TILL_DEVICE,
      p_queue_depth: 0,
      p_app_version: 'test',
      p_is_till: true, // 0026 explicit flag — the device name carries no TILL prefix
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
