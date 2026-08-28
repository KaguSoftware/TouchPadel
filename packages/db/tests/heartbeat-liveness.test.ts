/**
 * The venue heartbeat, exercised the way the operator now sends it.
 *
 * SOW L666-670. Until 2026-08-28 the ONLY writer of `device_heartbeats` in the
 * whole repository was `e2e/tests/helpers.ts` — the shell POSTed to an edge
 * function that does not exist, unauthenticated, and swallowed the 404. With
 * the table never written, `app.is_degraded()` —
 *
 *     exists(any till row) AND NOT exists(a fresh one)
 *
 * — is permanently FALSE, so every guest-write outage guard already wired into
 * the booking and ordering RPCs was inert. This suite is the regression test
 * for that: it calls `app.heartbeat` as a staff client, exactly as
 * `apps/operator/src/lib/heartbeat.ts` does, and asserts the degraded machinery
 * actually moves.
 *
 * It deliberately uses its OWN till device id and restores the fixture till
 * afterwards, so it cannot leave other suites trading in degraded mode.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  ensureTillFresh,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

const PROBE_TILL = 'TILL-HEARTBEAT-PROBE';
const PROBE_DESK = 'DESK-HEARTBEAT-PROBE';

describe.skipIf(!up)('venue heartbeat liveness', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
  let staleSeconds: number;

  async function isDegraded(): Promise<boolean> {
    // Through a signed-in client, not the service role: app.is_degraded is
    // granted to anon and authenticated only — it is the function guests hit.
    const { data, error } = await cashier.schema('app').rpc('is_degraded');
    if (error) throw new Error(error.message);
    return data as boolean;
  }

  beforeAll(async () => {
    svc = serviceClient();
    cashier = await signedInClient(SEED_STAFF.cashier);
    const { data: settings } = await svc
      .from('venue_settings')
      .select('heartbeat_stale_seconds')
      .single();
    staleSeconds = (settings as { heartbeat_stale_seconds: number }).heartbeat_stale_seconds;
  });

  afterAll(async () => {
    await svc.from('device_heartbeats').delete().in('device_id', [PROBE_TILL, PROBE_DESK]);
    // REFRESH the real tills rather than restoring the timestamps this suite
    // snapshotted: those were already several seconds old when it started, and
    // putting them back can leave the venue degraded for whichever suite runs
    // next — which is exactly what happened the first time.
    await ensureTillFresh(svc);
    await cashier.auth.signOut();
  });

  it('records a beat from a signed-in station', async () => {
    // The call the shell was never able to make: staff JWT, PostgREST, no edge
    // function anywhere in it.
    const res = await appRpc(cashier, 'heartbeat', {
      p_device_id: PROBE_TILL,
      p_queue_depth: 0,
      p_app_version: 'test',
      p_is_till: true,
    });
    expect(res.error).toBeNull();
    expect(res.data).toHaveProperty('degraded');
    expect(res.data).toHaveProperty('server_time');

    const { data } = await svc
      .from('device_heartbeats')
      .select('device_id, is_till, app_version')
      .eq('device_id', PROBE_TILL)
      .single();
    expect((data as { is_till: boolean }).is_till).toBe(true);
    expect((data as { app_version: string }).app_version).toBe('test');
  });

  it('refuses an unauthenticated caller, which is why the old sender failed', async () => {
    // The shell sent no Authorization header at all. Even if the endpoint had
    // existed, this is what it would have got.
    const guest = await anonymousSessionClient();
    const res = await appRpc(guest, 'heartbeat', { p_device_id: PROBE_TILL, p_is_till: true });
    expect(res.error?.message).toBe('FORBIDDEN');
  });

  it('requires a device id', async () => {
    const res = await appRpc(cashier, 'heartbeat', { p_device_id: '' });
    expect(res.error?.message).toBe('DEVICE_REQUIRED');
  });

  it('a stale till makes the venue degraded, and a fresh beat clears it', async () => {
    // This is the whole contract in three steps (L667-669), and none of it
    // could ever run before, because nothing wrote the table.
    await appRpc(cashier, 'heartbeat', { p_device_id: PROBE_TILL, p_is_till: true });

    // Age every till past the staleness threshold.
    const stale = new Date(Date.now() - (staleSeconds + 30) * 1000).toISOString();
    await svc.from('device_heartbeats').update({ last_seen_at: stale }).eq('is_till', true);
    expect(await isDegraded()).toBe(true);

    // "Normal operation resumes on the first successful heartbeat."
    const res = await appRpc(cashier, 'heartbeat', { p_device_id: PROBE_TILL, p_is_till: true });
    expect(res.error).toBeNull();
    expect((res.data as { degraded: boolean }).degraded).toBe(false);
    expect(await isDegraded()).toBe(false);
  });

  it('a desk station beating does NOT keep the venue out of degraded mode', async () => {
    // Only a till counts. A desk machine that is still online while the till is
    // down must not mask the outage — the till is what sells.
    await appRpc(cashier, 'heartbeat', { p_device_id: PROBE_DESK, p_is_till: false });
    const stale = new Date(Date.now() - (staleSeconds + 30) * 1000).toISOString();
    await svc.from('device_heartbeats').update({ last_seen_at: stale }).eq('is_till', true);

    expect(await isDegraded()).toBe(true);

    await appRpc(cashier, 'heartbeat', { p_device_id: PROBE_TILL, p_is_till: true });
    expect(await isDegraded()).toBe(false);
  });

  it('logs the degraded period with a start and an end', async () => {
    // "every degraded period is logged with its start, end and duration" (L670).
    const stale = new Date(Date.now() - (staleSeconds + 30) * 1000).toISOString();
    await svc.from('device_heartbeats').update({ last_seen_at: stale }).eq('is_till', true);
    // The sweep runs inside heartbeat(); a beat from any station triggers it.
    await appRpc(cashier, 'heartbeat', { p_device_id: PROBE_TILL, p_is_till: true });

    const { data } = await svc
      .from('degraded_periods')
      .select('started_at, ended_at')
      .order('started_at', { ascending: false })
      .limit(1);
    const rows = (data ?? []) as { started_at: string; ended_at: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.started_at).toBeTruthy();
  });

  it('keeps the till flag sticky once set', async () => {
    // An older client build that omits p_is_till must not un-identify the till
    // and quietly switch degraded detection off (0026).
    await appRpc(cashier, 'heartbeat', { p_device_id: PROBE_TILL, p_is_till: true });
    await appRpc(cashier, 'heartbeat', { p_device_id: PROBE_TILL, p_is_till: false });
    const { data } = await svc
      .from('device_heartbeats')
      .select('is_till')
      .eq('device_id', PROBE_TILL)
      .single();
    expect((data as { is_till: boolean }).is_till).toBe(true);
  });

  it('reports the queue depth the day close refuses on', async () => {
    // close_day Guard 2 (0020) blocks while queue_depth > 0; that guard was
    // inert for the same reason everything else here was.
    await appRpc(cashier, 'heartbeat', {
      p_device_id: PROBE_TILL,
      p_queue_depth: 4,
      p_is_till: true,
    });
    const { data } = await svc
      .from('device_heartbeats')
      .select('queue_depth')
      .eq('device_id', PROBE_TILL)
      .single();
    expect((data as { queue_depth: number }).queue_depth).toBe(4);

    // Leave it at zero so the afterAll restore does not hand the next suite a
    // till that cannot close its day.
    await appRpc(cashier, 'heartbeat', {
      p_device_id: PROBE_TILL,
      p_queue_depth: 0,
      p_is_till: true,
    });
  });
});
