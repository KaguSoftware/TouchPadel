import { app } from 'electron';
import type { StationConfig } from './station';
import { queueStatus } from './queue';

// Heartbeat (plan override #5): the TILL POSTs every 10 s. Staleness threshold is
// venue_settings.heartbeat_stale_seconds (default 45), enforced INLINE in the guest
// write RPCs — pg_cron only logs degraded periods + sweeps holds. Recovery: guest
// writes inside the protected horizon stay refused until queue_depth = 0 is reported
// (design-arch.md §3.5).

const HEARTBEAT_INTERVAL_MS = 10_000;

export function startHeartbeat(station: StationConfig): NodeJS.Timeout {
  const timer = setInterval(() => void sendHeartbeat(station), HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

async function sendHeartbeat(station: StationConfig): Promise<void> {
  // TODO(W2): resolve the Supabase URL from a proper config source (station.json or a
  // packaged env), not a raw process env; add the station's auth token header.
  const base = process.env.SUPABASE_URL;
  if (!base) return;
  try {
    await fetch(`${base}/functions/v1/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        station_id: station.stationId,
        queue_depth: queueStatus().depth,
        app_version: app.getVersion(),
      }),
    });
  } catch {
    // Offline — expected during outages; the SQLite queue keeps trading and this
    // silence is exactly what flips the venue to degraded (design-arch.md §3).
  }
}
