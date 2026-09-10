/**
 * Secret-file history gate — Security Layer 1, Block 2 "Secrets".
 *
 * `.gitignore` stops a file being added TOMORROW. It says nothing about
 * yesterday, and a file committed once is in the history forever even after it
 * is deleted and ignored — `git show <old-sha>:path` still hands it over, and
 * so does every clone and every fork.
 *
 * This walks the full history (`--diff-filter=A` over `--all`, so every branch
 * and every file that was EVER added, not the current tree) and fails if any
 * path that should only ever have existed locally was committed at some point.
 *
 * `.env.example` files are the deliberate exception: they carry names with
 * placeholder values, which is exactly how a new developer learns what to set
 * without anyone pasting a real key into chat.
 *
 * Baseline 2026-09-04: clean. Four .env.example files and a root .npmrc holding
 * only pnpm settings — no credential in any revision of either.
 * 2026-09-06: `.pem` moved from the path list to the content list — see the note
 * on that rule. Re-verified clean: the one committed .pem is a public certificate.
 *
 * Usage:  node scripts/security/check-history-secrets.mjs   (exit 1 on violation)
 */
import { execFileSync } from 'node:child_process';

/** Paths that must never appear in history, with why each one matters. */
const FORBIDDEN = [
  { re: /(^|\/)\.env$/, what: 'a real .env file' },
  {
    re: /(^|\/)\.env\.(?!example$)[^/]+$/,
    what: 'an environment-specific .env file (.env.local, .env.remote, …)',
  },
  { re: /(^|\/)station\.json$/, what: 'a venue station config (station identity + pairing state)' },
  // .pem is NOT here — it is content-checked below. See the note on PEM_PRIVATE_KEY.
  { re: /\.p12$/, what: 'a signing keystore' },
  { re: /\.keystore$/, what: 'an Android signing keystore' },
  { re: /\.jks$/, what: 'a Java keystore' },
  { re: /(^|\/)service-account.*\.json$/, what: 'a cloud service-account key' },
];

/**
 * Paths that are fine to commit but whose CONTENT must be checked in every
 * historical version. A root `.npmrc` holding `node-linker=hoisted` is normal
 * and correct — the hazard is an `_authToken` line, which is a path rule away
 * from being either missed or a permanent false positive.
 */
const CONTENT_CHECKED = [
  {
    re: /(^|\/)\.npmrc$/,
    bad: /^\s*(?:\/\/.*:)?_(?:authToken|auth|password)\s*=\s*\S/m,
    what: 'an npm registry credential (_authToken / _auth / _password)',
  },
  /**
   * `.pem` used to be a PATH rule, and it went red on 2026-09-06 for
   * `apps/mobile/certs/certificate.pem` — the EAS Update signing CERTIFICATE,
   * committed deliberately in 91cf0dc with its own `!` exception in
   * `.gitignore:15`. That file is a public X.509 certificate
   * (`CN=Touch Padel OTA Updates`, valid 2026-09-04 to 2036-09-04) and contains
   * no key material: it has to ship inside the app binary, because verifying an
   * OTA manifest is the whole point of it. A path rule can only be satisfied by
   * an allowlist entry, and an allowlisted path is a permanently unguarded path.
   *
   * The content rule is strictly stronger, and it matters MOST at exactly that
   * path: `.gitignore` exempts it, so it is the one `.pem` in this repository
   * that ignore rules will not stop — and therefore the likeliest place for
   * `private-key.pem` to be pasted by mistake. A certificate passes; anything
   * carrying a PRIVATE KEY block fails, at any path, in any revision.
   *
   * Binary keystores (.p12 / .keystore / .jks) stay path-forbidden above: those
   * formats exist to hold a private key, so there is no benign version to admit.
   */
  {
    re: /\.pem$/,
    bad: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
    what: 'a PRIVATE KEY in a .pem file (a bare CERTIFICATE block is fine — it is public by design)',
  },
];

// Every path ever ADDED anywhere in the object graph, across all refs.
const added = new Set(
  execFileSync('git', ['log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean),
);

const violations = [];
for (const file of added) {
  const rule = FORBIDDEN.find((r) => r.re.test(file));
  if (rule) violations.push({ file, what: rule.what });
}

// Content-checked paths: read EVERY historical revision, not just the current
// one. A token added and removed three commits later is still in the history.
for (const file of added) {
  const rule = CONTENT_CHECKED.find((r) => r.re.test(file));
  if (!rule) continue;
  const revs = execFileSync('git', ['log', '--all', '--format=%h', '--', file], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  for (const rev of revs) {
    let body;
    try {
      body = execFileSync('git', ['show', `${rev}:${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      continue; // deleted at that revision
    }
    if (rule.bad.test(body)) {
      violations.push({ file, what: `${rule.what} — in revision ${rev}` });
      break;
    }
  }
}

if (violations.length === 0) {
  console.log(
    `PASS  no secret-bearing file was ever committed (${added.size} paths across all history).`,
  );
  process.exit(0);
}

console.error(`FAIL  ${violations.length} secret-bearing file(s) exist in git history:\n`);
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`      ${v.what}`);
  // The commits that introduced it — the reviewer needs these to judge exposure.
  const commits = execFileSync(
    'git',
    ['log', '--all', '--oneline', '--diff-filter=A', '--', v.file],
    {
      encoding: 'utf8',
    },
  ).trim();
  for (const line of commits.split('\n').slice(0, 5)) console.error(`      added in ${line}`);
  console.error('');
}
console.error('Deleting the file does NOT remove it — it stays reachable in every clone and fork.');
console.error(
  'ROTATE every credential the file contained first; scrubbing history is secondary and',
);
console.error('never sufficient on its own.');
process.exit(1);
