/**
 * Reads `supabase migration list --linked` output on stdin and answers the one
 * question deploy.yml asks before it requests an approval: is anything pending?
 *
 * Accepts both shapes the CLI prints — the markdown-ish table a CI runner gets
 * (`` `20260929000265` | ` ` | … ``) and the JSON a non-TTY local run gets
 * ({"migrations":[{"local":…,"remote":…}]}).
 *
 * Prints `pending=<n>` and `remote_only=<n>` lines (GITHUB_OUTPUT format) and
 * the pending versions on stderr. Exit 1 when a version exists on the hosted
 * ledger but not in the repository: that database has a migration nobody can
 * review here, and pushing on top of it is how the eight-migration drift began.
 * Exit 2 when nothing parsable came in — never read "no rows" as "nothing
 * pending".
 */
import { readFileSync } from 'node:fs';

const text = readFileSync(0, 'utf8');
let rows = [];

const json = text.indexOf('{"migrations"');
if (json >= 0) {
  const parsed = JSON.parse(text.slice(json, text.lastIndexOf('}') + 1));
  rows = parsed.migrations.map((m) => ({ local: m.local || null, remote: m.remote || null }));
} else {
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.replace(/`/g, '').trim());
    if (cells.length < 2) continue;
    const local = /^\d{14}$/.test(cells[0]) ? cells[0] : null;
    const remote = /^\d{14}$/.test(cells[1]) ? cells[1] : null;
    if (local || remote) rows.push({ local, remote });
  }
}

if (rows.length === 0) {
  console.error('pending-migrations: could not read a single migration row from the CLI output.');
  process.exit(2);
}

const pending = rows.filter((r) => r.local && !r.remote).map((r) => r.local);
const remoteOnly = rows.filter((r) => r.remote && !r.local).map((r) => r.remote);

console.log(`pending=${pending.length}`);
console.log(`remote_only=${remoteOnly.length}`);
if (pending.length) console.error(`pending: ${pending.join(', ')}`);
if (remoteOnly.length) {
  console.error(`ON THE HOSTED LEDGER BUT NOT IN THE REPO: ${remoteOnly.join(', ')}`);
  process.exit(1);
}
