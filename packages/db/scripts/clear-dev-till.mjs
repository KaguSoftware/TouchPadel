/**
 * Clear stale DEV till heartbeats on the HOSTED project — the 0057 data fix,
 * re-runnable on demand.
 *
 * Why this exists. app.is_degraded() (0026) is "a till row exists in
 * device_heartbeats AND none of them is fresh". No till is installed at the
 * venue yet, so running the operator app against the hosted project and
 * closing it leaves a stale till row behind; 45 s later the venue flips
 * degraded and EVERY guest — mobile and web — sees the amber "Venue connection
 * lost" banner, with holds refused as DEGRADED_LOCKOUT. This bit twice
 * (2026-08-31 → migration 0057, and again 2026-09-02 from a DEV1 session), so
 * the fix is now one command instead of hand-written SQL.
 *
 * A till that has beaten within the last hour is never touched, so a live
 * station cannot be wiped. Once a real till is installed and heartbeating,
 * this script is a no-op. Delete it when the venue goes live.
 *
 * Usage (from packages/db — the CLI misbehaves from the repo root):
 *   pnpm db:clear-dev-till
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sql =
  "delete from device_heartbeats where (is_till or device_id like 'TILL%') and last_seen_at < now() - interval '1 hour'; " +
  'select app.sweep_degraded_periods(); ' +
  'select app.is_degraded() as degraded;';

// cwd pinned to packages/db: the supabase CLI must never run from the repo root.
execSync(`npx supabase db query --linked "${sql}"`, {
  stdio: 'inherit',
  cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
});
