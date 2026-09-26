import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_STAFF, appRpc, outcome, serviceClient, signedInClient, stackAvailable,
  VENUE_A_ID,
} from './helpers';

/**
 * 0118 (C2) — degraded mode gets an off switch.
 *
 * A stale till row keeps the whole venue in degraded mode and nothing could
 * remove it. app.retire_device (owner only) deletes the row, sweeps the
 * degraded period in the same transaction and audits what it removed.
 * set_venue_details accepts the two thresholds.
 *
 * Assertions stay local to the probe device: other suites keep their own till
 * rows fresh, so the venue-wide is_degraded() value is not asserted here.
 */
const up = await stackAvailable();

const DEVICE = 'TILL-RETIRE-PROBE';

describe.skipIf(!up)('0118 retire_device + degraded thresholds (C2)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  async function auditMax(): Promise<number> {
    const { data } = await svc.from('audit_log').select('id').order('id', { ascending: false }).limit(1);
    return ((data ?? [])[0] as { id: number } | undefined)?.id ?? 0;
  }

  async function plantStaleTill(): Promise<void> {
    // app.heartbeat is the only writer; beat once as staff, then age the row.
    const beat = await appRpc(cashier, 'heartbeat', {
      p_device_id: DEVICE, p_queue_depth: 0, p_app_version: 'test', p_is_till: true,
    }).then(outcome);
    if (!beat.ok) throw new Error(`heartbeat: ${beat.errorMessage}`);
    const aged = await svc
      .from('device_heartbeats')
      .update({ last_seen_at: new Date(Date.now() - 30 * 60_000).toISOString() })
      .eq('device_id', DEVICE);
    if (aged.error) throw new Error(`age row: ${aged.error.message}`);
  }

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    await svc.from('device_heartbeats').delete().eq('device_id', DEVICE);
    await owner.auth.signOut();
    await manager.auth.signOut();
    await cashier.auth.signOut();
  });

  it('only the owner may retire a device', async () => {
    await plantStaleTill();
    for (const c of [manager, cashier]) {
      const r = await appRpc(c, 'retire_device', { p_device_id: DEVICE }).then(outcome);
      expect(r.ok).toBe(false);
      expect(r.errorMessage).toBe('FORBIDDEN');
    }
    const { data } = await svc.from('device_heartbeats').select('device_id').eq('device_id', DEVICE);
    expect(data).toHaveLength(1);
  });

  it('retiring removes the row, audits it and reports the venue state', async () => {
    await plantStaleTill();
    const mark = await auditMax();
    const r = await appRpc(owner, 'retire_device', { p_device_id: DEVICE }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
    const out = r.data as { device_id: string; was_till: boolean; degraded: boolean };
    expect(out.device_id).toBe(DEVICE);
    expect(out.was_till).toBe(true);
    expect(typeof out.degraded).toBe('boolean');

    const { data } = await svc.from('device_heartbeats').select('device_id').eq('device_id', DEVICE);
    expect(data).toEqual([]);

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, entity, entity_id, before')
      .gt('id', mark)
      .eq('action', 'device.retired');
    expect(audit).toHaveLength(1);
    const row = (audit ?? [])[0] as { entity: string; entity_id: string; before: { device_id: string; is_till: boolean } };
    expect(row.entity).toBe('device_heartbeats');
    expect(row.entity_id).toBe(DEVICE);
    expect(row.before.device_id).toBe(DEVICE);
    expect(row.before.is_till).toBe(true);
  });

  it('an unknown device is DEVICE_NOT_FOUND; a blank id is INVALID_ARGUMENT', async () => {
    const gone = await appRpc(owner, 'retire_device', { p_device_id: 'TILL-NEVER-EXISTED' }).then(outcome);
    expect(gone.errorMessage).toBe('DEVICE_NOT_FOUND');
    const blank = await appRpc(owner, 'retire_device', { p_device_id: '  ' }).then(outcome);
    expect(blank.errorMessage).toBe('INVALID_ARGUMENT');
  });

  it('a retired device that beats again simply re-registers', async () => {
    await plantStaleTill();
    const r = await appRpc(owner, 'retire_device', { p_device_id: DEVICE }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
    const beat = await appRpc(cashier, 'heartbeat', { p_device_id: DEVICE, p_queue_depth: 0, p_app_version: 'test', p_is_till: true }).then(outcome);
    expect(beat.ok, beat.errorMessage).toBe(true);
    const { data } = await svc.from('device_heartbeats').select('device_id, is_till').eq('device_id', DEVICE);
    expect(data).toEqual([{ device_id: DEVICE, is_till: true }]);
  });

  it('the owner can set the two degraded-mode thresholds within their ranges, and nobody else can', async () => {
    const { data: before } = await svc.from('venue_settings').select('heartbeat_stale_seconds, protected_horizon_hours').eq('venue_id', VENUE_A_ID).single();
    const b = before as { heartbeat_stale_seconds: number; protected_horizon_hours: number };
    try {
      const ok = await appRpc(owner, 'set_venue_details', { p_patch: { heartbeat_stale_seconds: 90, protected_horizon_hours: 24 } }).then(outcome);
      expect(ok.ok, ok.errorMessage).toBe(true);
      const after = ok.data as { heartbeat_stale_seconds: number; protected_horizon_hours: number };
      expect(after.heartbeat_stale_seconds).toBe(90);
      expect(after.protected_horizon_hours).toBe(24);

      const low = await appRpc(owner, 'set_venue_details', { p_patch: { heartbeat_stale_seconds: 5 } }).then(outcome);
      expect(low.errorMessage).toBe('INVALID_ARGUMENT');
      const high = await appRpc(owner, 'set_venue_details', { p_patch: { protected_horizon_hours: 999 } }).then(outcome);
      expect(high.errorMessage).toBe('INVALID_ARGUMENT');

      const mgr = await appRpc(manager, 'set_venue_details', { p_patch: { heartbeat_stale_seconds: 60 } }).then(outcome);
      expect(mgr.errorMessage).toBe('FORBIDDEN');
    } finally {
      await appRpc(owner, 'set_venue_details', {
        p_patch: { heartbeat_stale_seconds: b.heartbeat_stale_seconds, protected_horizon_hours: b.protected_horizon_hours },
      });
    }
  });
});
