/**
 * No silent skips in the CI db job.
 *
 * WHY. 143 of the 173 db test files decide at import time whether the stack is
 * up (`stackAvailable()`, a `docker exec psql`, a probe of a served function)
 * and `describe.skipIf(!up)` themselves when it is not. That is right on a
 * laptop without Docker and wrong in CI: one slow probe under load turned a
 * whole file into "skipped" and the job stayed green, and the served-function
 * suites skipped on EVERY run because the db job never served functions
 * (2026-10-01 review). In CI, where the stack is the point, a skip is a
 * failure unless fixtures/test-skip-allowlist.json says why it is by design.
 *
 * Reads the vitest JSON report (`--reporter=json --outputFile.json=<file>`).
 * Fails on: a skipped/pending/todo test not on the allowlist, and a report with
 * no tests at all. An allowlist entry that did not skip is printed as stale.
 *
 * Usage:  node scripts/check-no-skips.mjs <vitest-report.json>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALLOW = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'test-skip-allowlist.json'), 'utf8')).tests;

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: node scripts/check-no-skips.mjs <vitest-report.json>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const skipped = [];
let total = 0;
for (const file of report.testResults ?? []) {
  const rel = `tests/${file.name.replace(/\\/g, '/').split('/tests/').pop()}`;
  for (const t of file.assertionResults ?? []) {
    total++;
    if (t.status === 'passed' || t.status === 'failed') continue;
    skipped.push(`${rel} :: ${t.fullName}`);
  }
}

if (total === 0) {
  console.error('check-no-skips: the report holds no tests at all.');
  process.exit(1);
}

const unexpected = skipped.filter((k) => !(k in ALLOW));
const stale = Object.keys(ALLOW).filter((k) => !skipped.includes(k));
for (const k of stale) console.log(`check-no-skips: allowlisted but did not skip (stale entry?): ${k}`);

if (unexpected.length) {
  console.error(`check-no-skips: ${unexpected.length} test(s) skipped in a job where the stack is up:`);
  for (const k of unexpected) console.error(`  - ${k}`);
  console.error('A skip here means a probe failed (stack, docker exec, served function, env var).');
  console.error('Fix the cause; only a skip that is correct BY DESIGN goes on fixtures/test-skip-allowlist.json.');
  process.exit(1);
}
console.log(`check-no-skips: ${total} test(s), ${skipped.length} allowlisted skip(s), none unexpected.`);
