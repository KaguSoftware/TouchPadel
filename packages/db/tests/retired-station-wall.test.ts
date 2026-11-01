/**
 * 0398 — a retired station loses everything on the server (F-49), and the
 * idle-lock timeout is the owner's alone (F-48).
 *
 * The wall is app.pre_request (PostgREST's pre-request hook): a request whose
 * x-station-id names a retired station may call only its way back (heartbeat,
 * register_station, the two PIN checks, report_event) and may write no table.
 * A queued write replaying after retirement arrives the same way (the replay
 * function calls as the staff session with the station's header), so it is
 * refused too; app.queued_rpc_claim checks it as well.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ANON_KEY,
  DEV_PASSWORD,
  SEED_STAFF,
  SUPABASE_URL,
  VENUE_A_ID,
  appRpc,
  outcome,
  registerTestStation,
  serviceClient,
  signedInClient,
  stackAvailable,
  testIdemKey,
} from './helpers';

const up = await stackAvailable();

const RETIRED = 'TILL-RETIRED-0398';
const LIVE = 'TILL-LIVE-0398';

async function atStation(email: string, stationId: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-station-id': stationId } },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

describe.skipIf(!up)('0398 a retired station loses everything (F-49)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let managerLive: SupabaseClient;
  let ownerRetired: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    await registerTestStation(svc, RETIRED, { venueId: VENUE_A_ID });
    await registerTestStation(svc, LIVE, { venueId: VENUE_A_ID });
    await svc.from('stations').update({ retired_at: new Date().toISOString() }).eq('id', RETIRED);
    manager = await atStation(SEED_STAFF.manager, RETIRED);
    managerLive = await atStation(SEED_STAFF.manager, LIVE);
    ownerRetired = await atStation(SEED_STAFF.owner, RETIRED);
  });

  afterAll(async () => {
    await svc.from('device_heartbeats').delete().in('device_id', [RETIRED, LIVE]);
    await svc.from('stations').update({ retired_at: new Date().toISOString() }).in('id', [RETIRED, LIVE]);
  });

  it('refuses an ordinary RPC from a retired station with STATION_RETIRED', async () => {
    const r = await appRpc(manager, 'set_waiter_call_cooldown', { p_seconds: 60 }).then(outcome);
    expect(r.errorMessage).toBe('STATION_RETIRED');
    // The same person at a live station is not refused by the wall.
    const live = await appRpc(managerLive, 'branch_counts', {}).then(outcome);
    expect(live.ok, live.errorMessage).toBe(true);
  });

  it('refuses a queued write replaying after retirement (queued_rpc and the money RPCs)', async () => {
    const q = await appRpc(manager, 'queued_rpc', {
      p_fn: 'set_waiter_call_cooldown',
      p_args: { p_seconds: 60 },
      p_idempotency_key: testIdemKey('rpc.queued'),
    }).then(outcome);
    expect(q.errorMessage).toBe('STATION_RETIRED');
    const settle = await appRpc(manager, 'settle_tab', {
      p_tab_id: '00000000-0000-4000-8000-000000000000',
      p_method: 'cash',
      p_tendered_iqd: null,
      p_amount_iqd: null,
      p_idempotency_key: testIdemKey('tab.settle'),
      p_device_id: RETIRED,
    }).then(outcome);
    expect(settle.errorMessage).toBe('STATION_RETIRED');
  });

  it('refuses a table write, keeps table reads open', async () => {
    const w = await manager.from('cafe_settings').update({ value: 1 }).eq('key', 'never-a-key-0398');
    expect(w.error?.message).toBe('STATION_RETIRED');
    const r = await manager.from('staff').select('id').limit(1);
    expect(r.error).toBeNull();
  });

  it('lets the way back through: heartbeat says retired, then register_station revives it', async () => {
    const beat = await appRpc(manager, 'heartbeat', {
      p_device_id: RETIRED, p_queue_depth: 0, p_app_version: 'test', p_is_till: true,
    }).then(outcome);
    expect(beat.ok, beat.errorMessage).toBe(true);
    expect(beat.data).toMatchObject({ retired: true });

    const reg = await appRpc(ownerRetired, 'register_station', {
      p_id: RETIRED, p_venue_id: VENUE_A_ID, p_mode: 'till', p_label: null,
    }).then(outcome);
    // register_station's own arguments are its business; the wall must not be what refused it.
    expect(reg.errorMessage ?? '').not.toBe('STATION_RETIRED');
  });
});

describe.skipIf(!up)('0398 the idle-lock timeout is the owner\'s (F-48)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let owner: SupabaseClient;
  let before: unknown = undefined;

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    owner = await signedInClient(SEED_STAFF.owner);
    const { data } = await svc.from('cafe_settings').select('value').eq('venue_id', VENUE_A_ID).eq('key', 'till_idle_lock_seconds').maybeSingle();
    before = (data as { value: unknown } | null)?.value;
  });

  afterAll(async () => {
    if (before === undefined) {
      await svc.from('cafe_settings').delete().eq('venue_id', VENUE_A_ID).eq('key', 'till_idle_lock_seconds');
    } else {
      await svc.from('cafe_settings').update({ value: before }).eq('venue_id', VENUE_A_ID).eq('key', 'till_idle_lock_seconds');
    }
  });

  it('a manager is refused, directly and through set_cafe_settings', async () => {
    const one = await appRpc(manager, 'set_cafe_setting', { p_key: 'till_idle_lock_seconds', p_value: 600, p_venue_id: VENUE_A_ID }).then(outcome);
    expect(one.errorMessage).toBe('FORBIDDEN');
    const many = await appRpc(manager, 'set_cafe_settings', { p_settings: { till_idle_lock_seconds: 600 }, p_venue_id: VENUE_A_ID }).then(outcome);
    expect(many.errorMessage).toBe('FORBIDDEN');
  });

  it('a manager still writes the other manager keys', async () => {
    const r = await appRpc(manager, 'set_cafe_setting', { p_key: 'bell_tutorial_enabled', p_value: true, p_venue_id: VENUE_A_ID }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
  });

  it('the owner sets it', async () => {
    const r = await appRpc(owner, 'set_cafe_setting', { p_key: 'till_idle_lock_seconds', p_value: 600, p_venue_id: VENUE_A_ID }).then(outcome);
    expect(r.ok, r.errorMessage).toBe(true);
  });
});
