/**
 * The venue heartbeat — SOW L666-670.
 *
 *   "The desktop app sends a heartbeat to the server on a short interval. When
 *    it stops, the venue is marked degraded and guest writes are refused
 *    server-side — not hidden in the interface. Normal operation resumes on the
 *    first successful heartbeat; every degraded period is logged with its
 *    start, end and duration."
 *
 * THIS HAS NEVER WORKED. `operator-shell/src/main/heartbeat.ts` POSTed to
 * `${SUPABASE_URL}/functions/v1/heartbeat` — an edge function that does not
 * exist and never did — with no Authorization header (while `app.heartbeat`
 * opens with a staff guard), no `p_is_till`, and an early return when
 * `SUPABASE_URL` is unset, which it always is in a packaged build. Every error,
 * 404 included, went into a bare `catch {}`.
 *
 * So the only writer of `device_heartbeats` in the entire repository was the
 * e2e helper. `app.is_degraded()` is
 *
 *     exists(any till row) AND NOT exists(a fresh one)
 *
 * and with the table empty it is permanently FALSE — every guest-write outage
 * guard already wired into the booking and ordering RPCs was inert. The
 * contract's most-emphasised safety property, "so nothing can be sold twice"
 * (L723-736), did not exist in the shipped product.
 *
 * WHY THE RENDERER SENDS IT, not the Electron main process as design-arch.md
 * §3.5 sketched: `app.heartbeat` requires a STAFF session, and the session
 * lives here. The main process has no Supabase client, no JWT and no refresh
 * loop, so putting the sender there means inventing a token-forwarding channel
 * before the contract's cheapest safety property can work at all. It also means
 * the heartbeat works in browser mode, which is how the operator is developed
 * and demonstrated today.
 *
 * The queue depth still comes from the main process when there is one — it is
 * the number `close_day` refuses on (0020) and the banner shows.
 */
import { useEffect, useRef } from 'react';
import { appRpc } from './appRpc';
import { touch } from '../ipc/bridge';
import { captureException } from './telemetry';

/**
 * Ten seconds, against `venue_settings.heartbeat_stale_seconds` (45 by
 * default). Four missed beats before the venue is called degraded: enough that
 * one slow request does not lock guests out, short enough that the window in
 * which a slot can be sold twice stays seconds rather than minutes — the
 * contract's "one honest limit" (L650-658).
 */
export const HEARTBEAT_INTERVAL_MS = 10_000;

export interface HeartbeatResult {
  degraded: boolean;
  server_time: string;
}

export interface HeartbeatState {
  /** The venue as the SERVER sees it — not a local guess. */
  degraded: boolean;
  /** Mutations waiting in the station's durable queue. */
  queueDepth: number;
  /** Set when the beat itself failed: the station cannot reach the server. */
  error: unknown;
  lastOkAt: number | null;
}

export async function sendHeartbeat(
  stationId: string,
  isTill: boolean,
  queueDepth: number,
  appVersion: string,
): Promise<HeartbeatResult> {
  return appRpc<HeartbeatResult>('heartbeat', {
    p_device_id: stationId,
    p_queue_depth: queueDepth,
    p_app_version: appVersion,
    // Explicit rather than relying on the `TILL%` name-prefix back-compat in
    // app.is_degraded(): a station called DESK-01 that is in fact the till
    // would otherwise never be recognised, and the venue would never be
    // detected as degraded at all.
    p_is_till: isTill,
  });
}

/**
 * Beat while a staff member is signed in, and report what the server says.
 *
 * `enabled` is the caller's "is anyone signed in" — an unauthenticated beat
 * would just be refused, and a station sitting on the sign-in screen is not
 * trading.
 */
export function useHeartbeat({
  enabled,
  appVersion,
  onState,
}: {
  enabled: boolean;
  appVersion: string;
  onState(state: HeartbeatState): void;
}): void {
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    if (!enabled) return;

    const station = touch.getStation();
    const isTill = station.mode === 'till';
    let queueDepth = 0;
    let cancelled = false;

    // Depth comes from the main process when the app is running inside
    // Electron; in browser mode there is no durable queue and it stays 0.
    const unsubscribe = touch.onQueueUpdate((s) => {
      queueDepth = s.depth;
    });

    async function beat() {
      try {
        const res = await sendHeartbeat(station.stationId, isTill, queueDepth, appVersion);
        if (cancelled) return;
        onStateRef.current({
          degraded: res.degraded,
          queueDepth,
          error: null,
          lastOkAt: Date.now(),
        });
      } catch (error) {
        if (cancelled) return;
        // NOT swallowed. A silent catch here is precisely how this went
        // unnoticed for a week; the station shows it and telemetry records it.
        captureException(error, { label: 'heartbeat' });
        onStateRef.current({ degraded: false, queueDepth, error, lastOkAt: null });
      }
    }

    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [enabled, appVersion]);
}
