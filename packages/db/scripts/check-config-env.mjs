/**
 * config.toml env-substitution gate — S10 (Phase 2, Milestone 0).
 *
 * WHAT IT GUARDS. `supabase/config.toml` used to carry the test-OTP pair as a
 * literal: `9647700000001 = "123456"`. That is a working credential for a
 * real-format Iraqi number, sitting in a repository, and the activation runbook
 * told the owner to add the SAME pair to the hosted project so App Store and
 * Play reviewers could sign in. `supabase config push` was then run against the
 * client's project on 2026-08-24, which is how a committed pair reached a live
 * auth configuration (docs/security/security-audit-2026-09-13.md:191, M8).
 *
 * THE FIX THIS GATE ENFORCES. Every value under `[auth.sms.test_otp]` is an
 * `env(NAME)` reference, never a literal. The Supabase CLI substitutes those at
 * `supabase start` (verified on CLI 2.115.0: `docker exec supabase_auth_touchpadel
 * env | grep TEST_OTP` prints the resolved pair). The code then lives in
 * `packages/db/.env` locally and in a GitHub repository variable in CI — in
 * neither case in a tracked file.
 *
 * A SECOND STATIC RULE, file-wide: any key whose NAME looks like a credential
 * (`secret`, `password`, `token`, `api_key`, `*_secret`, `*_key`, …) may hold
 * `""` or an `env(NAME)` reference and nothing else. The test_otp section was
 * the one that leaked; this rule is for the next key that would.
 *
 * TWO MODES.
 *   (default)          STATIC. No stack, no `.env`, no Docker. Parses the file
 *                      and fails on any literal, and on an `env(NAME)` whose
 *                      NAME is not declared in `.env.example` — an undeclared
 *                      name is a blank the next person cannot know to fill, and
 *                      the CLI substitutes an empty string for it silently.
 *                      This is the mode `pnpm security` runs, so it must stay
 *                      stackless and must pass with no `.env` present.
 *   --require-values   Additionally loads `packages/db/.env` and requires every
 *                      NAME referenced inside ENV_ONLY_SECTIONS to be non-empty.
 *                      This is the mode `pnpm db:start` runs, because a stack
 *                      that starts with an empty test_otp code is a stack whose
 *                      phone tests fail much later and much less legibly. An
 *                      `env(NAME)` outside those sections that resolves to
 *                      nothing is reported as a note, not a failure: the CLI
 *                      substitutes an empty string, which for an optional
 *                      provider secret is exactly what an unset value means.
 *
 * `123456` is refused outright: it is in this repository's git history, so it
 * is not a value anyone should still be typing.
 *
 * Usage:  node scripts/check-config-env.mjs                 (static, exit 1 on violation)
 *         node scripts/check-config-env.mjs --require-values
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const CONFIG = path.join(PKG, 'supabase', 'config.toml');
const ENV_EXAMPLE = path.join(PKG, '.env.example');
const ENV_FILE = path.join(PKG, '.env');

/** Relative paths in messages: the reader is standing in the repo, not in packages/db. */
const rel = (p) => path.relative(path.resolve(PKG, '..', '..'), p).replace(/\\/g, '/');

const requireValues = process.argv.slice(2).includes('--require-values');

/** Sections whose every value must be an env() reference. */
const ENV_ONLY_SECTIONS = ['auth.sms.test_otp'];

/**
 * Keys that, anywhere in the file, may carry only `""` or `env(NAME)`. Matched
 * against the bare key, case-insensitively: `secret`, `auth_token` does NOT
 * match (`token` is anchored) but `client_secret`, `service_key` and `api_key` do.
 */
const SECRET_KEY = /^(secret|pass|password|token|key|api_key|client_secret|.*_secret|.*_key)$/i;
/**
 * The one literal a secret-shaped key may hold: the marker the local stack uses
 * for a provider whose secret is never exercised locally (Apple / Google sign-in
 * exchange happens in the browser against the HOSTED project). The CLI rejects
 * an empty secret for an enabled provider, so it cannot be "". Anything else
 * — a real-looking value, a test pair, a token — fails.
 */
const PLACEHOLDER_LITERALS = new Set(['local-dev-unused']);

/** The one value that must never come back, whatever it is set to. */
const BURNED = new Map([['SUPABASE_AUTH_SMS_TEST_OTP_CODE', '123456']]);

const ENV_REF = /^env\([A-Z0-9_]+\)$/;
const ENV_REF_ANY = /env\(([A-Z0-9_]+)\)/g;

const fail = (lines) => {
  console.error(`FAIL  ${rel(CONFIG)}\n`);
  for (const l of lines) console.error(`  ${l}`);
  process.exit(1);
};

if (!existsSync(CONFIG)) fail([`the file does not exist — run this from packages/db.`]);
const source = readFileSync(CONFIG, 'utf8');
const lines = source.split('\n');

// ── parse: every `key = "string"` assignment, with its section ───────────────
// A deliberately small parser. config.toml is hand-written, flat, and this gate
// has to be readable by whoever it fails on; a TOML dependency here would buy
// nothing but a dependency.
const problems = [];
const notes = [];
let section = null;
/** [{ key, value, line }] for every key in an ENV_ONLY_SECTIONS section. */
const guarded = [];
/** [{ section, key, value, line }] for every string-valued key anywhere. */
const strings = [];

for (const [i, raw] of lines.entries()) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const header = /^\[([^\]]+)\]/.exec(line);
  if (header) {
    section = header[1];
    continue;
  }
  const kv = /^([^=]+?)\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line);
  if (kv) strings.push({ section, key: kv[1].trim(), value: kv[2], line: i + 1 });
  if (!ENV_ONLY_SECTIONS.includes(section)) continue;
  if (!kv) {
    problems.push(
      `${i + 1}: cannot read this line as key = "value" under [${section}]: ${line.slice(0, 80)}`,
    );
    continue;
  }
  guarded.push({ key: kv[1].trim(), value: kv[2], line: i + 1 });
}

for (const s of ENV_ONLY_SECTIONS) {
  if (!lines.some((l) => l.trim().startsWith(`[${s}]`))) {
    problems.push(`[${s}] is gone. This gate exists to guard it — restore it or update ENV_ONLY_SECTIONS.`);
  }
}

for (const { key, value, line } of guarded) {
  if (ENV_REF.test(value)) continue;
  problems.push(
    `${line}: ${key} = "${value}" is a literal. Write ` +
      `${key} = "env(SUPABASE_AUTH_SMS_TEST_OTP_CODE)" and put the code in ` +
      `${rel(ENV_FILE)} (copy ${rel(ENV_EXAMPLE)}).`,
  );
}

// ── no secret-shaped key holds a literal, anywhere in the file ───────────────
// The value itself is not echoed: a gate that prints the credential it found
// into a CI log has only moved the leak.
const secretLiterals = strings.filter(
  ({ key, value }) =>
    SECRET_KEY.test(key) && value !== '' && !ENV_REF.test(value) && !PLACEHOLDER_LITERALS.has(value),
);
for (const { section: s, key, line } of secretLiterals) {
  const dotted = s ? `${s}.${key}` : key;
  problems.push(
    `${line}: ${dotted} is a literal (secret-shaped key). Only "" or "env(NAME)" is allowed here — ` +
      `move the value to ${rel(ENV_FILE)} and declare NAME in ${rel(ENV_EXAMPLE)}.`,
  );
}

// ── every env(NAME) anywhere in the file is declared in .env.example ────────
if (!existsSync(ENV_EXAMPLE)) {
  problems.push(`${rel(ENV_EXAMPLE)} is missing — it is the declaration list this gate checks against.`);
}
const declared = existsSync(ENV_EXAMPLE)
  ? new Set(
      readFileSync(ENV_EXAMPLE, 'utf8')
        .split('\n')
        .map((l) => /^\s*([A-Z0-9_]+)\s*=/.exec(l)?.[1])
        .filter(Boolean),
    )
  : new Set();

/** NAME -> first line it appears on. */
const referenced = new Map();
for (const [i, raw] of lines.entries()) {
  if (raw.trim().startsWith('#')) continue;
  for (const m of raw.matchAll(ENV_REF_ANY)) {
    if (!referenced.has(m[1])) referenced.set(m[1], i + 1);
  }
}

/** The names referenced inside ENV_ONLY_SECTIONS: the only ones --require-values insists on. */
const mandatory = new Set();
for (const { value } of guarded) {
  for (const m of value.matchAll(ENV_REF_ANY)) mandatory.add(m[1]);
}

for (const [name, line] of referenced) {
  if (declared.has(name)) continue;
  problems.push(
    `${line}: env(${name}) is not declared in ${rel(ENV_EXAMPLE)}. ` +
      `Add a \`${name}=\` line with a comment saying what it is — the CLI substitutes ` +
      `an empty string for an unset name without a word of warning.`,
  );
}

// ── --require-values: the mandatory names actually carry a usable value ─────
if (requireValues && problems.length === 0) {
  const dotenv = await import('dotenv');
  const parsed = existsSync(ENV_FILE) ? dotenv.parse(readFileSync(ENV_FILE)) : {};
  const value = (name) => process.env[name] ?? parsed[name] ?? '';

  // The environment wins over the file on purpose: CI has no `.env` at all and
  // passes the value as a repository variable, so a missing file is only a
  // problem when a name is left unresolved by it.
  const howToSet = existsSync(ENV_FILE)
    ? `Set ${'%s'}= in ${rel(ENV_FILE)}.`
    : `Copy ${rel(ENV_EXAMPLE)} to ${rel(ENV_FILE)} and set ${'%s'}= there.`;
  for (const [name, line] of referenced) {
    const v = value(name).trim();
    if (!v) {
      if (mandatory.has(name)) {
        problems.push(`${line}: env(${name}) resolves to nothing. ${howToSet.replace('%s', name)}`);
      } else {
        notes.push(
          `${line}: env(${name}) resolves to nothing (outside [${ENV_ONLY_SECTIONS.join('], [')}] — ` +
            `the CLI substitutes ""; set it only if that section is meant to work).`,
        );
      }
      continue;
    }
    if (BURNED.get(name) === v) {
      problems.push(
        `${line}: ${name}=${v} — that code is in this repository's git history; pick another.`,
      );
      continue;
    }
    if (name === 'SUPABASE_AUTH_SMS_TEST_OTP_CODE' && !/^\d{6}$/.test(v)) {
      problems.push(
        `${line}: ${name} must be exactly six digits (GoTrue's OTP length); got ${JSON.stringify(v)}.`,
      );
    }
  }
}

if (problems.length > 0) fail(problems);

for (const n of notes) console.log(`NOTE  ${n}`);

console.log(
  `PASS  ${rel(CONFIG)}: ${guarded.length} test_otp value(s) via env(), ` +
    `${referenced.size} name(s) declared in ${rel(ENV_EXAMPLE)}, ` +
    `no secret-shaped literal` +
    (requireValues ? `, ${mandatory.size} required name(s) set` : ''),
);
