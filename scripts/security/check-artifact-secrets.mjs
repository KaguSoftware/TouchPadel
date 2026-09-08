/**
 * Built-artifact secret scan — Security Layer 1, Block 2 "Secrets".
 *
 *   "Code review is not evidence."
 *
 * Reading source tells you what the author meant to ship. This reads what the
 * bundler ACTUALLY produced, which is the only thing an attacker ever sees. The
 * gap between the two is where this class of bug lives: a value pulled in
 * through a re-export, a config object serialised whole into the client island,
 * a `.env` inlined by a build plugin nobody remembered adding.
 *
 * Targets all three clients:
 *   apps/web/.next                  Next.js — browser chunks AND server chunks
 *   apps/mobile/dist                Expo export — the JS pushed to every phone
 *   apps/operator-shell/release     Electron — app.asar (scanned as raw bytes;
 *                                   asar is a header plus concatenated files,
 *                                   so string matching works without unpacking)
 *
 * WHAT IT FAILS ON, and why not simply `grep service_role`:
 *
 * The obvious grep is unusable here. `@supabase/auth-js` contains the literal
 * string "service_role" in its own source, so it appears in every browser
 * bundle in this repo, harmlessly, today. A gate that fires on that gets
 * disabled within a day — which is worse than no gate.
 *
 * So the hard failures are the ones that cannot be a false positive:
 *
 *   1. A JWT whose DECODED payload claims role=service_role. Not the word — the
 *      actual credential. The published local-stack demo key (iss:
 *      supabase-demo) is exempt: it authorises a throwaway container.
 *   2. `sb_secret_*` — Supabase's server-only key format. No legitimate reason
 *      to exist in a client artifact in any form.
 *   3. A Supabase JWT for a real project whose role is neither anon nor
 *      service_role — i.e. something hand-minted and unexpected.
 *
 * Bare-word occurrences are still counted and printed, because a jump in that
 * count is worth a human glance, but they do not fail the build.
 *
 * IT ALSO FAILS WHEN NOTHING WAS BUILT. A scan of an empty directory passes
 * trivially and proves nothing; that green tick is precisely the lie this gate
 * exists to prevent. Pass --allow-missing locally when you have only built one
 * client on purpose.
 *
 * Usage:
 *   pnpm turbo build && node scripts/security/check-artifact-secrets.mjs
 *   node scripts/security/check-artifact-secrets.mjs --allow-missing
 *   node scripts/security/check-artifact-secrets.mjs --only=web,mobile
 *
 * `--only` exists because the three clients are built by three different CI
 * jobs on two operating systems, and building all three again in a fourth job
 * to scan them would roughly double the pipeline. Each job scans what it just
 * produced; between them the three cover everything. The missing-artifact
 * failure above still applies WITHIN the selection, so `--only=web` in a job
 * that forgot to build still fails.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ALLOW_MISSING = process.argv.includes('--allow-missing');

const ALL_TARGETS = [
  { id: 'web', client: 'web (Next.js)', dir: 'apps/web/.next', skip: ['cache'] },
  { id: 'mobile', client: 'mobile (Expo)', dir: 'apps/mobile/dist', skip: [] },
  { id: 'desktop', client: 'desktop (Electron)', dir: 'apps/operator-shell/release', skip: [] },
];

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg
  ? onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

if (only) {
  const unknown = only.filter((id) => !ALL_TARGETS.some((t) => t.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown --only target(s): ${unknown.join(', ')}`);
    console.error(`Valid targets: ${ALL_TARGETS.map((t) => t.id).join(', ')}`);
    process.exit(2);
  }
}

const TARGETS = only ? ALL_TARGETS.filter((t) => only.includes(t.id)) : ALL_TARGETS;

// Scan text-ish and archive-ish files. app.asar has no useful extension rule,
// so it is matched by name.
const SCANNABLE = /\.(js|mjs|cjs|json|map|html|css|txt|hbs|bundle)$|(^|\/)app\.asar$/;

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
const SB_SECRET = /sb_secret_[A-Za-z0-9_-]{20,}/g;
const BARE_WORD = /service_role/g;

const DEMO_ISSUER = 'supabase-demo';

function decodePayload(segment) {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    if (!json.startsWith('{')) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function* walk(dir, skip) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (skip.includes(e.name)) continue;
      yield* walk(path.join(dir, e.name), skip);
    } else if (e.isFile()) {
      yield path.join(dir, e.name);
    }
  }
}

const failures = [];
let bareWordHits = 0;
let filesScanned = 0;
let bytesScanned = 0;
const present = [];
const missing = [];

for (const { client, dir, skip } of TARGETS) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) {
    missing.push({ client, dir });
    continue;
  }
  present.push({ client, dir });

  for (const file of walk(abs, skip)) {
    if (!SCANNABLE.test(file)) continue;
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    filesScanned += 1;
    bytesScanned += buf.length;
    // latin1 keeps byte offsets meaningful inside asar and never throws on
    // binary padding, unlike utf8 decoding.
    const text = buf.toString('latin1');
    const rel = path.relative(ROOT, file);

    for (const [full, payloadSeg] of text.matchAll(JWT)) {
      const payload = decodePayload(payloadSeg);
      if (!payload || typeof payload.role !== 'string') continue;
      if (payload.iss === DEMO_ISSUER) continue; // published throwaway key
      if (payload.role === 'anon') continue; // public by design
      failures.push({
        kind: `JWT with role="${payload.role}"`,
        detail: payload.ref ? `project ref ${payload.ref}` : `iss ${payload.iss ?? '(none)'}`,
        file: rel,
        client,
        redacted: `${full.slice(0, 12)}…${full.slice(-6)}`,
      });
    }

    for (const [m] of text.matchAll(SB_SECRET)) {
      failures.push({
        kind: 'Supabase secret key',
        detail: 'sb_secret_* is server-only',
        file: rel,
        client,
        redacted: `${m.slice(0, 14)}…`,
      });
    }

    bareWordHits += [...text.matchAll(BARE_WORD)].length;
  }
}

// ---- report -----------------------------------------------------------------

console.log('Built-artifact secret scan');
for (const p of present) console.log(`  scanned   ${p.client.padEnd(20)} ${p.dir}`);
for (const m of missing) console.log(`  MISSING   ${m.client.padEnd(20)} ${m.dir}`);
console.log(
  `  ${filesScanned} files, ${(bytesScanned / 1024 / 1024).toFixed(1)} MB, ` +
    `${bareWordHits} bare "service_role" occurrence${bareWordHits === 1 ? '' : 's'} ` +
    `(informational — @supabase/auth-js contains this string in its own source)`,
);
console.log('');

if (failures.length > 0) {
  console.error(`FAIL  ${failures.length} credential(s) found in built client artifacts:\n`);
  for (const f of failures) {
    console.error(`  ${f.kind} — ${f.detail}`);
    console.error(`      client: ${f.client}`);
    console.error(`      file:   ${f.file}`);
    console.error(`      value:  ${f.redacted}`);
    console.error('');
  }
  console.error('These SHIP. Rotate the credential first, then find how it reached the bundle.');
  process.exit(1);
}

if (present.length === 0) {
  console.error('FAIL  no built artifacts found — this scan proved nothing.');
  console.error('      Run `pnpm turbo build` first, or pass --allow-missing if that is deliberate.');
  process.exit(1);
}

if (missing.length > 0 && !ALLOW_MISSING) {
  console.error(`FAIL  ${missing.length} of ${TARGETS.length} clients were not built:`);
  for (const m of missing) console.error(`      ${m.client} (${m.dir})`);
  console.error('');
  console.error('A partial scan reports green for a client it never opened. Build all three,');
  console.error('or pass --allow-missing to accept a partial result locally.');
  process.exit(1);
}

console.log(`PASS  no service_role JWT, sb_secret_* key, or unexpected project token in any built artifact.`);
process.exit(0);
