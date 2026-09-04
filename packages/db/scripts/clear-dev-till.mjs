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
 * WHICH PROJECT. It runs against whatever `supabase link` last wrote into
 * supabase/.temp/project-ref, and it deletes rows — so it now PRINTS that ref
 * before doing anything, and refuses to run if the ref does not match an
 * expectation you state:
 *
 *   pnpm db:clear-dev-till --project-ref=lczijabnorujcgmbuqlw
 *   TOUCH_EXPECTED_PROJECT_REF=lczijabnorujcgmbuqlw pnpm db:clear-dev-till
 *
 * A FRESH till row is not deleted, and that case is now reported loudly rather
 * than passing silently: if the venue reads degraded while a till is beating,
 * the cause is not a stale row (2026-09-04 — a dev operator was live against
 * the hosted project, beating every 10s and going quiet for ~48s whenever its
 * window was backgrounded, which crosses the 45s window). Clearing rows cannot
 * fix that; closing the offending app can.
 *
 * Usage (from packages/db — the CLI misbehaves from the repo root):
 *   pnpm db:clear-dev-till
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbDir = join(here, '..');

const refFile = join(dbDir, 'supabase', '.temp', 'project-ref');
let linkedRef;
try {
  linkedRef = readFileSync(refFile, 'utf8').trim();
} catch {
  console.error(`No linked project: ${refFile} is missing. Run \`supabase link\` first.`);
  process.exit(1);
}

const flag = process.argv.find((a) => a.startsWith('--project-ref='))?.split('=')[1];
const expected = (flag ?? process.env.TOUCH_EXPECTED_PROJECT_REF)?.trim();

console.log(`Linked project: ${linkedRef}`);
if (expected && expected !== linkedRef) {
  console.error(
    `REFUSING TO RUN. Expected project ${expected}, but ${linkedRef} is linked.\n` +
      'This script DELETES heartbeat rows — re-link, or correct the expectation.',
  );
  process.exit(1);
}
if (!expected) {
  console.warn(
    'No expected ref given. Pass --project-ref=<ref> (or set TOUCH_EXPECTED_PROJECT_REF)\n' +
      'to make this refuse an unexpected project instead of trusting the link file.',
  );
}

const run = (sql) =>
  execSync(`npx supabase db query --linked "${sql}"`, { stdio: 'inherit', cwd: dbDir });

// Show what is there BEFORE deleting anything: a fresh till row means the
// degraded state has a live cause that deleting rows cannot fix.
console.log('\n-- device_heartbeats before --');
run(
  "select device_id, is_till, app_version, last_seen_at, " +
    "(now() - last_seen_at) as age, (last_seen_at >= now() - interval '1 hour') as too_fresh_to_clear " +
    'from device_heartbeats order by last_seen_at desc;',
);

console.log('\n-- clearing stale dev tills (older than 1 hour) --');
run(
  "delete from device_heartbeats where (is_till or device_id like 'TILL%') and last_seen_at < now() - interval '1 hour'; " +
    'select app.sweep_degraded_periods(); ' +
    'select app.is_degraded() as degraded;',
);

console.log(
  '\nIf `degraded` is still true above, a till row is BEATING right now — something is\n' +
    'live against this project. Find and close it; no amount of clearing will help.',
);
