import type { StationConfig } from './station';

/**
 * The heartbeat does NOT live here any more. This module is kept as a marker so
 * the next person to look for it finds the reasoning rather than re-adding the
 * bug.
 *
 * What used to be here POSTed to `${SUPABASE_URL}/functions/v1/heartbeat`:
 *
 *   - that edge function does not exist and never did (config.toml registers
 *     six, none of them heartbeat);
 *   - it sent no Authorization header, while `app.heartbeat` opens with a staff
 *     guard;
 *   - it omitted `p_is_till`, so `app.is_degraded()` would only have recognised
 *     the station through the `TILL%` name-prefix back-compat, by accident;
 *   - it returned early when `process.env.SUPABASE_URL` was unset, which it
 *     always is in a packaged build;
 *   - and it swallowed every error, 404 included, in a bare `catch {}`.
 *
 * The consequence was not a missing feature but an inert safety property: with
 * `device_heartbeats` never written, `app.is_degraded()` is permanently false
 * and every guest-write outage guard in the booking and ordering RPCs does
 * nothing. SOW L666-670 and L723-736 describe the one thing that stops a slot
 * being sold twice during an outage.
 *
 * It now lives in `apps/operator/src/lib/heartbeat.ts`, in the RENDERER,
 * because `app.heartbeat` requires a staff session and the session is there.
 * The main process has no Supabase client, no JWT and no refresh loop; putting
 * the sender here means building a token-forwarding channel before the
 * contract's cheapest safety property can work at all. The queue depth the
 * renderer reports still comes from this process, over `IPC.queueUpdate`.
 *
 * If this ever moves back — for instance so a station keeps beating while the
 * renderer is reloading — it needs the staff JWT forwarded over IPC, and it
 * must call `app.heartbeat` over PostgREST, not an edge function.
 */
export function startHeartbeat(_station: StationConfig): null {
  // Deliberately nothing. See above.
  return null;
}
