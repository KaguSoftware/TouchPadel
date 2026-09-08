/**
 * Public-env naming gate — Security Layer 1, Block 2 "Secrets".
 *
 * `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` are not configuration. They are an
 * INSTRUCTION to the bundler: inline this value into JavaScript that ships to
 * every phone and browser. Nothing behind such a name is ever secret again, and
 * the mistake is invisible in review because the code reading it looks exactly
 * like the code reading a private variable.
 *
 * So the gate is on the NAME, not the value: any public-prefixed name matching
 * /SECRET|KEY|TOKEN|PIN|HMAC/ fails. That is deliberately over-broad — several
 * legitimately public values are called "…KEY" — and each of those is
 * allowlisted below BY EXACT NAME with a reason. An allowlist entry is a
 * security decision: it asserts the value may appear in a client bundle.
 *
 * Usage:  node scripts/security/check-public-env-names.mjs   (exit 1 on violation)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DANGEROUS = /SECRET|KEY|TOKEN|PIN|HMAC/;
const PUBLIC_NAME = /\b((?:NEXT|EXPO)_PUBLIC_[A-Z0-9_]+)\b/g;

/**
 * Public-prefixed names that trip the pattern but ARE safe to ship, each with
 * the reason it is safe. Adding a name here asserts: this value is compiled
 * into a public client binary and that is correct.
 */
const ALLOWED = new Map([
  // Supabase's client half. Designed to be public — it identifies the project
  // and carries the `anon` role; RLS is what protects the data, not this string.
  // It is already inside every shipped app bundle by construction.
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase anon key — public by design; RLS is the control.'],
  ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'Supabase anon key — public by design; RLS is the control.'],
  // The successor format for the same thing. "Publishable" is Supabase's own
  // word for "safe in a browser".
  ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'Supabase publishable key — the client half of the new key format.'],
  // PostHog's project API key is a write-only ingest identifier; it cannot read
  // any analytics data back. NOTE: whether PostHog belongs on the guest cafe app
  // at all is an open contract question (SOW Module 6 excludes analytics) —
  // that is tracked separately and is not what this gate decides.
  ['NEXT_PUBLIC_POSTHOG_KEY', 'PostHog project API key — write-only ingest identifier, not a read credential.'],
]);

// Track the whole repo as git sees it, so build output, node_modules and
// untracked local .env files are excluded without maintaining a path list.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean)
  // Lockfiles and this script itself both legitimately contain the strings.
  .filter((f) => !/pnpm-lock\.yaml$|package-lock\.json$/.test(f))
  .filter((f) => f !== 'scripts/security/check-public-env-names.mjs');

const violations = [];
const seen = new Set();

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable — no env names in it
  }
  if (!text.includes('_PUBLIC_')) continue;

  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    for (const [, name] of line.matchAll(PUBLIC_NAME)) {
      if (!DANGEROUS.test(name)) continue;
      if (ALLOWED.has(name)) {
        seen.add(name);
        continue;
      }
      violations.push({ name, file, line: i + 1 });
    }
  }
}

// Report each offending NAME once, listing where it appears — a name used in
// twelve files is one decision to make, not twelve.
const byName = new Map();
for (const v of violations) {
  if (!byName.has(v.name)) byName.set(v.name, []);
  byName.get(v.name).push(`${v.file}:${v.line}`);
}

if (byName.size === 0) {
  console.log(
    `PASS  no client-bundled env name looks like a secret ` +
      `(${seen.size} allowlisted public name${seen.size === 1 ? '' : 's'} in use).`,
  );
  process.exit(0);
}

console.error('FAIL  public-prefixed env names that look like secrets:\n');
for (const [name, sites] of byName) {
  console.error(`  ${name}`);
  for (const s of sites.slice(0, 8)) console.error(`      ${s}`);
  if (sites.length > 8) console.error(`      … and ${sites.length - 8} more`);
  console.error('');
}
console.error(
  'A NEXT_PUBLIC_/EXPO_PUBLIC_ value is inlined into shipped client JavaScript.\n' +
    'Either rename it without the public prefix and read it server-side, or — if it\n' +
    'genuinely is public — add it to ALLOWED in this script with the reason why.',
);
process.exit(1);
