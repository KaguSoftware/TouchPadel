/**
 * RPC registry + authorization-coverage gate — Security Layer 1, Block 2 (SEC-12).
 *
 * TWO PROPERTIES, one script:
 *
 * 1. EVERY client-callable RPC IS CLASSIFIED.
 *    `check-rpc-authz.mjs` proves that the RPCs it knows about refuse a guest.
 *    It could not tell you about one it had never heard of — the exemption list
 *    was a hardcoded JS `Set`, so a newly granted RPC was simply absent from
 *    every check and shipped unguarded by default. Here, absence is a FAILURE.
 *    Silence stops being a pass.
 *
 * 2. COVERAGE ONLY GOES UP.
 *    `tests/rls-matrix.ts` is the multi-principal authorization sign-off. It
 *    covers 60 of the 127 client-callable RPCs; 67 are asserted by nobody,
 *    including `override_price`, `void_after_send`, `apply_pct_discount`,
 *    `merge_tabs` and `split_by_item` — the money-adjustment family. Raising
 *    that to 127 is real work and not a prerequisite for landing this gate, so
 *    the floor starts where the repo actually is and RATCHETS: adding an RPC
 *    without covering it lowers the ratio and fails the build.
 *
 * WHY STATIC, when check-rpc-authz.mjs reads the catalog:
 *    The client-callable surface is defined by `grant execute on function app.*`
 *    in the migrations — that grant IS the exposure. Reading it from source
 *    means this gate runs on a pull request with no database, so a new RPC is
 *    caught in the fast job rather than only after the stack boots. The
 *    executing sweep still runs against the catalog and remains the proof.
 *
 * Usage:
 *   node scripts/check-rpc-registry.mjs
 *   node scripts/check-rpc-registry.mjs --update-floor   # after raising coverage
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DB = path.resolve(import.meta.dirname, '..');
const MIGRATIONS = path.join(DB, 'supabase/migrations');
const REGISTRY = path.join(DB, 'fixtures/rpc-allowlist.json');
const MATRIX = path.join(DB, 'tests/rls-matrix.ts');
const FLOOR_FILE = path.join(DB, 'fixtures/rpc-coverage-floor.json');

const UPDATE_FLOOR = process.argv.includes('--update-floor');

// ── the exposed surface, from the grants themselves ───────────────────────────
const GRANT = /grant\s+execute\s+on\s+function\s+app\.([a-z0-9_]+)\s*\(([^)]*)\)\s*to\s+([a-z_,\s]+);/gi;

const grantedTo = new Map();
for (const file of readdirSync(MIGRATIONS).sort()) {
  if (!file.endsWith('.sql')) continue;
  const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
  for (const m of sql.matchAll(GRANT)) {
    const name = m[1].toLowerCase();
    const roles = m[3].split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
    if (!grantedTo.has(name)) grantedTo.set(name, new Set());
    for (const r of roles) grantedTo.get(name).add(r);
  }
}

// `anon` and `authenticated` are both reachable by anyone who scans a table QR:
// an anonymous sign-in makes a guest `authenticated`, exactly as staff are.
const clientCallable = [...grantedTo.entries()]
  .filter(([, roles]) => roles.has('anon') || roles.has('authenticated'))
  .map(([name]) => name)
  .sort();

// ── the registry ──────────────────────────────────────────────────────────────
const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const publicByDesign = registry.publicByDesign ?? {};
const guarded = new Set(registry.guarded ?? []);
const classified = new Set([...Object.keys(publicByDesign), ...guarded]);

const unclassified = clientCallable.filter((n) => !classified.has(n));
const stale = [...classified].filter((n) => !clientCallable.includes(n));
const reasonless = Object.entries(publicByDesign)
  .filter(([, why]) => typeof why !== 'string' || why.trim().length < 10)
  .map(([n]) => n);

// ── coverage ──────────────────────────────────────────────────────────────────
const matrix = readFileSync(MATRIX, 'utf8');
const covered = new Set();
for (const m of matrix.matchAll(/kind:\s*'rpc',[\s\S]{0,160}?name:\s*'([a-z0-9_]+)'/g)) {
  covered.add(m[1]);
}
const coveredHere = clientCallable.filter((n) => covered.has(n));
const uncovered = clientCallable.filter((n) => !covered.has(n));

let floor = { covered: 0, total: 0 };
try {
  floor = JSON.parse(readFileSync(FLOOR_FILE, 'utf8'));
} catch {
  /* first run — written below */
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('RPC registry + authorization coverage\n');
console.log(`  client-callable RPCs   ${clientCallable.length}  (granted to anon or authenticated)`);
console.log(`  public by design       ${Object.keys(publicByDesign).length}`);
console.log(`  guarded                ${guarded.size}`);
console.log(
  `  covered by rls-matrix  ${coveredHere.length}/${clientCallable.length}` +
    `  (floor: ${floor.covered}/${floor.total})`,
);
console.log('');

const problems = [];

if (unclassified.length > 0) {
  problems.push(
    `${unclassified.length} RPC(s) are callable by a guest and appear in NO registry entry:\n` +
      unclassified.map((n) => `        app.${n}`).join('\n') +
      '\n\n' +
      '      A guest holds `authenticated` exactly as staff do, so the guard on the first\n' +
      '      line of the function body is the only thing protecting it.\n' +
      '      FIX: add each to packages/db/fixtures/rpc-allowlist.json —\n' +
      '        "guarded"        it refuses a guest (check:authz then PROVES that), or\n' +
      '        "publicByDesign" a guest may call it, with the reason written down.',
  );
}

if (reasonless.length > 0) {
  problems.push(
    `${reasonless.length} publicByDesign entr(y/ies) have no real reason recorded:\n` +
      reasonless.map((n) => `        app.${n}`).join('\n') +
      '\n\n' +
      '      Every name in that list asserts "a stranger with a phone may call this".\n' +
      '      That assertion needs a sentence a reviewer can disagree with.',
  );
}

if (coveredHere.length / Math.max(clientCallable.length, 1) <
    floor.covered / Math.max(floor.total, 1) - 1e-9) {
  problems.push(
    `authorization coverage REGRESSED: ${coveredHere.length}/${clientCallable.length} ` +
      `(was ${floor.covered}/${floor.total}).\n\n` +
      '      A new RPC was added without a rule in tests/rls-matrix.ts. Extend the pass\n' +
      '      that already exists — do not write a second one — then re-run with\n' +
      '      --update-floor to ratchet the floor up.',
  );
}

if (stale.length > 0) {
  console.log('Stale registry entries — no longer granted to a client role:');
  for (const n of stale) console.log(`        app.${n}`);
  console.log('  (harmless; remove them so the registry keeps meaning something.)\n');
}

if (UPDATE_FLOOR) {
  writeFileSync(
    FLOOR_FILE,
    JSON.stringify(
      {
        _readme:
          'Authorization-coverage ratchet for check-rpc-registry.mjs. Raise it by covering ' +
          'more RPCs in tests/rls-matrix.ts and re-running with --update-floor. Never lower ' +
          'it by hand: that is the one edit this file exists to make visible in review.',
        covered: coveredHere.length,
        total: clientCallable.length,
        updated: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Floor updated to ${coveredHere.length}/${clientCallable.length}.`);
}

if (problems.length === 0) {
  console.log(`PASS  every client-callable RPC is classified; coverage has not regressed.`);
  if (uncovered.length > 0) {
    console.log('');
    console.log(`      ${uncovered.length} RPC(s) still have no rls-matrix rule. Not a failure —`);
    console.log('      the ratchet only forbids going backwards — but this is the real gap:');
    for (const n of uncovered.slice(0, 12)) console.log(`        app.${n}`);
    if (uncovered.length > 12) console.log(`        … and ${uncovered.length - 12} more`);
  }
  process.exit(0);
}

for (const p of problems) console.error(`FAIL  ${p}\n`);
process.exit(1);
