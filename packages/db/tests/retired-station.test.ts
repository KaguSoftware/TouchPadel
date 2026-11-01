import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_STAFF, VENUE_A_ID, appRpc, outcome, registerTestStation, serviceClient, signedInClient, stackAvailable } from './helpers';

/**
 * 0397 (F-49) — a retired station learns it was retired.
 *
 * app.retire_station stamps retired_at and drops the heartbeat row; the
 * machine's next beat used to answer exactly what the owner's never-registered
 * office PC hears ({registered: false}), so the till kept trading. The beat
 * now says `retired: true` for a retired id, and nothing for any other.
 *
 * F-48 rides on the same beat: `idle_lock_seconds` is the branch's
 * till_idle_lock_seconds (null when never set), because cafe_settings is
 * unreadable for a cashier and their till ran the client default.
 */
const up = await stackAvailable();

const DEVICE = 'TILL-RETIRED-0397';
const NEVER = 'PC-NEVER-0397';

describe.skipIf(!up)('0397 heartbeat names a retired station (F-49)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let cashier: SupabaseClient;

  const beat = (c: SupabaseClient, id: string) =>
    appRpc(c, 'heartbeat', { p_device_id: id, p_queue_depth: 0, p_app_version: 'test', p_is_till: true }).then(outcome);

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    await svc.from('device_heartbeats').delete().eq('device_id', DEVICE);
    await svc.from('stations').update({ retired_at: new Date().toISOString() }).eq('id', DEVICE);
    await owner.auth.signOut();
    await cashier.auth.signOut();
  });

  it('a live station beats as registered, with no retired flag', async () => {
    await registerTestStation(svc, DEVICE, { venueId: VENUE_A_ID });
    const r = await beat(cashier, DEVICE);
    expect(r.ok, r.errorMessage).toBe(true);
    expect(r.data).toMatchObject({ registered: true });
    expect((r.data as Record<string, unknown>).retired).toBeUndefined();
  });

  it('once retired, its next beat says so and records nothing', async () => {
    await registerTestStation(svc, DEVICE, { venueId: VENUE_A_ID });
    const retired = await appRpc(owner, 'retire_station', { p_id: DEVICE }).then(outcome);
    expect(retired.ok, retired.errorMessage).toBe(true);
    const r = await beat(cashier, DEVICE);
    expect(r.ok, r.errorMessage).toBe(true);
    expect(r.data).toMatchObject({ registered: false, retired: true });
    const { data } = await svc.from('device_heartbeats').select('device_id').eq('device_id', DEVICE);
    expect(data).toHaveLength(0);
  });

  it('a machine that was never a station is not called retired', async () => {
    const r = await beat(cashier, NEVER);
    expect(r.ok, r.errorMessage).toBe(true);
    expect(r.data).toMatchObject({ registered: false, retired: false });
  });

  it('every beat carries the branch idle-lock timeout, null when never set (F-48)', async () => {
    const { data: before } = await svc
      .from('cafe_settings')
      .select('value')
      .eq('venue_id', VENUE_A_ID)
      .eq('key', 'till_idle_lock_seconds')
      .maybeSingle();
    try {
      await svc.from('cafe_settings').delete().eq('venue_id', VENUE_A_ID).eq('key', 'till_idle_lock_seconds');
      await registerTestStation(svc, DEVICE, { venueId: VENUE_A_ID });
      const unset = await beat(cashier, DEVICE);
      expect((unset.data as Record<string, unknown>).idle_lock_seconds).toBeNull();
      const set = await svc
        .from('cafe_settings')
        .upsert({ venue_id: VENUE_A_ID, key: 'till_idle_lock_seconds', value: 600, is_public: false }, { onConflict: 'venue_id,key' });
      expect(set.error).toBeNull();
      const r = await beat(cashier, DEVICE);
      expect(r.data).toMatchObject({ registered: true, idle_lock_seconds: 600 });
    } finally {
      await svc.from('cafe_settings').delete().eq('venue_id', VENUE_A_ID).eq('key', 'till_idle_lock_seconds');
      if (before) {
        await svc
          .from('cafe_settings')
          .upsert({ venue_id: VENUE_A_ID, key: 'till_idle_lock_seconds', value: before.value, is_public: false }, { onConflict: 'venue_id,key' });
      }
    }
  });

  it('registered again, it beats as a live station', async () => {
    await registerTestStation(svc, DEVICE, { venueId: VENUE_A_ID });
    const r = await beat(cashier, DEVICE);
    expect(r.data).toMatchObject({ registered: true });
  });
});
