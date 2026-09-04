/**
 * Dependency audit gate — Security Layer 1, Block 2 "Secrets".
 *
 * `pnpm audit --audit-level=high` on its own is unusable as a merge gate on this
 * repo: it reports 14 high and 2 critical advisories today, so it would land red
 * on `main`, and a gate that is red on arrival gets ignored within a day and
 * deleted within a week. The same reasoning the migrations gate uses applies —
 * grandfather what is already committed, guard what arrives.
 *
 * So this wraps the audit with a waiver file (.security/audit-waivers.json) and
 * three properties that keep the waiver from becoming a permanent silence:
 *
 *   1. An advisory NOT waived, at high or critical, FAILS. That is the gate: a
 *      new vulnerable dependency cannot merge.
 *   2. A waiver carries an `expires` date, and an EXPIRED waiver fails. The
 *      backlog therefore has a deadline; nobody has to remember to revisit it.
 *   3. A waiver that no longer matches anything is reported as stale, so the
 *      file shrinks as upgrades land instead of accumulating dead entries.
 *
 * Waivers are keyed by GitHub advisory ID (GHSA-…) because that is stable
 * across pnpm versions and registries — the numeric `id` is not.
 *
 * Usage:
 *   node scripts/security/check-dependency-audit.mjs
 *   node scripts/security/check-dependency-audit.mjs --level=moderate
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WAIVERS = path.join(ROOT, '.security/audit-waivers.json');

const levelArg = process.argv.find((a) => a.startsWith('--level='));
const LEVEL = levelArg ? levelArg.split('=')[1] : 'high';
const ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const MIN = ORDER.indexOf(LEVEL);
if (MIN < 0) {
  console.error(`Unknown --level=${LEVEL}. Use one of: ${ORDER.join(', ')}`);
  process.exit(2);
}

// `pnpm audit` exits non-zero when it finds anything, which is the whole point —
// so the exit code is not an error condition here, only the absence of output is.
let raw;
try {
  raw = execFileSync('pnpm', ['audit', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (err) {
  raw = err.stdout ?? '';
}
if (!raw.trim()) {
  console.error('FAIL  `pnpm audit --json` produced no output — the registry may be unreachable.');
  console.error('      Treating this as a failure on purpose: an audit that did not run is not a pass.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('FAIL  could not parse `pnpm audit --json` output.');
  process.exit(1);
}

const advisories = Object.values(report.advisories ?? {}).filter((a) => ORDER.indexOf(a.severity) >= MIN);

const waiverDoc = existsSync(WAIVERS) ? JSON.parse(readFileSync(WAIVERS, 'utf8')) : { waivers: [] };
const waivers = new Map((waiverDoc.waivers ?? []).map((w) => [w.id, w]));

const today = new Date().toISOString().slice(0, 10);

const blocking = [];
const waived = [];
const expired = [];

for (const a of advisories) {
  const key = a.github_advisory_id;
  const w = waivers.get(key);
  if (!w) {
    blocking.push(a);
  } else if (typeof w.expires === 'string' && w.expires < today) {
    expired.push({ advisory: a, waiver: w });
  } else {
    waived.push({ advisory: a, waiver: w });
  }
}

const matched = new Set([...waived, ...expired].map((x) => x.advisory.github_advisory_id));
const stale = [...waivers.values()].filter((w) => !matched.has(w.id));

// ---- report -----------------------------------------------------------------

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `Dependency audit (level=${LEVEL}+): ` +
    ORDER.map((s) => `${counts[s] ?? 0} ${s}`).join(', '),
);
console.log(
  `  ${advisories.length} at or above ${LEVEL} — ${blocking.length} blocking, ` +
    `${waived.length} waived, ${expired.length} expired.\n`,
);

const describe = (a) =>
  `  ${a.severity.toUpperCase().padEnd(8)} ${a.module_name.padEnd(20)} ${a.github_advisory_id}\n` +
  `           ${a.title}\n` +
  `           installed: vulnerable ${a.vulnerable_versions} · fixed in ${a.patched_versions || 'NO FIX AVAILABLE'}`;

if (stale.length > 0) {
  console.log('Stale waivers — these no longer match any advisory and should be deleted:');
  for (const w of stale) console.log(`  ${w.id}  (${w.module ?? '?'}) — ${w.reason ?? ''}`);
  console.log('');
}

if (expired.length > 0) {
  console.error(`FAIL  ${expired.length} waiver(s) have EXPIRED:\n`);
  for (const { advisory, waiver } of expired) {
    console.error(describe(advisory));
    console.error(`           waiver expired ${waiver.expires}, owner: ${waiver.owner ?? 'unassigned'}`);
    console.error(`           reason was: ${waiver.reason}`);
    console.error('');
  }
  console.error('Either do the upgrade, or extend the waiver with a new date and a fresh justification.');
}

if (blocking.length > 0) {
  console.error(`FAIL  ${blocking.length} un-waived advisor${blocking.length === 1 ? 'y' : 'ies'} at ${LEVEL} or above:\n`);
  for (const a of blocking) {
    console.error(describe(a));
    const paths = (a.findings ?? []).flatMap((f) => f.paths ?? []).slice(0, 3);
    for (const p of paths) console.error(`           via ${p}`);
    console.error('');
  }
  console.error('Upgrade it, or add a waiver to .security/audit-waivers.json with a reason,');
  console.error('an owner and an expiry date. A waiver is a decision, not a mute button.');
}

if (blocking.length > 0 || expired.length > 0) process.exit(1);

console.log(`PASS  no un-waived advisory at ${LEVEL} or above.`);
process.exit(0);
