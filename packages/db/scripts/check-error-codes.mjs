#!/usr/bin/env node
/**
 * check-error-codes — every error code a migration raises reaches staff and
 * guests as words, not "Something went wrong".
 *
 * A code is `raise exception 'CODE'` in any migration. It is covered when the
 * one error catalogue has it: ERROR_CODE_KEYS in packages/i18n/src/errors.ts,
 * which the operator (lib/errors.ts), the phone (features/booking/errors.ts)
 * and the web (lib/appRpc.ts) all resolve through. Until 2026-10-01 each app
 * kept its own map and a code counted as covered when ANY of them had it, so
 * 82 codes sat on fixtures/error-codes-unmapped.json and read as the generic
 * line everywhere. That list is empty now and only shrinks: --update takes
 * codes off it and never puts one on.
 *
 *   FAIL  a code raised by a migration that is not in ERROR_CODE_KEYS: add it
 *         there with its line in both catalogs, in the same commit as the
 *         migration.
 *   FAIL  a listed code that is in the catalogue now, or no longer raised:
 *         rerun with --update to take it off the list.
 *   FAIL  a catalogue line (an ERROR_CODE_KEYS or SQLSTATE_KEYS value) with no
 *         English, no Arabic, Arabic with no Arabic letters in it, or Arabic
 *         that is the English copied.
 *   FAIL  a code on `errors.generic` that GENERIC_BY_DECISION does not name.
 *
 * Stackless: Node loads the catalogue and the message catalogs as they are
 * (erasable TypeScript; a resolve hook adds the `.ts` or `/index.ts` that the
 * catalogs' extensionless imports leave out). Runs in root `pnpm security`.
 *
 * Usage: node --experimental-strip-types scripts/check-error-codes.mjs [--update]
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MIG_DIR = path.join(ROOT, 'packages/db/supabase/migrations');
const FIXTURE = path.join(ROOT, 'packages/db/fixtures/error-codes-unmapped.json');
const I18N = path.join(ROOT, 'packages/i18n/src');
const CODE = /^[A-Z][A-Z0-9_]+$/;
const ARABIC = /[؀-ۿ]/;
const README =
  'check-error-codes.mjs: codes a migration raises that are not in the error catalogue (packages/i18n/src/errors.ts ERROR_CODE_KEYS); they would show a generic error. Empty since 2026-10-01 and it only shrinks: add a new code to the catalogue with its line in both catalogs instead. --update takes codes off; nothing ever goes on.';

/** `./ws` → `./ws/index.ts`, `./en` → `./en.ts`, for imports made from a .ts file. */
function resolveTs(specifier, parentURL) {
  if (!specifier.startsWith('.') || !parentURL?.startsWith('file:') || !parentURL.endsWith('.ts'))
    return null;
  const base = path.resolve(path.dirname(fileURLToPath(parentURL)), specifier);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return pathToFileURL(candidate).href;
  }
  return null;
}

if (typeof module.registerHooks === 'function') {
  module.registerHooks({
    resolve: (specifier, context, next) =>
      next(resolveTs(specifier, context.parentURL) ?? specifier, context),
  });
} else {
  // Node before 22.15 has only the asynchronous hooks, which run off-thread.
  const hook = `
    import { existsSync, statSync } from 'node:fs';
    import path from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    ${resolveTs.toString()}
    export async function resolve(specifier, context, next) {
      return next(resolveTs(specifier, context.parentURL) ?? specifier, context);
    }`;
  module.register(`data:text/javascript,${encodeURIComponent(hook)}`);
}

async function load(rel) {
  try {
    return await import(pathToFileURL(path.join(I18N, rel)).href);
  } catch (err) {
    console.error(
      `FAIL  could not load packages/i18n/src/${rel}: ${err instanceof Error ? err.message : err}`,
    );
    console.error(
      '      Run with Node 22.18+ (or pass --experimental-strip-types); the catalogue must stay erasable TypeScript.',
    );
    process.exit(1);
  }
}

function raised() {
  const codes = new Set();
  for (const f of readdirSync(MIG_DIR).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(path.join(MIG_DIR, f), 'utf8');
    for (const m of sql.matchAll(/raise\s+exception\s+'([A-Z][A-Z0-9_]+)'/gi)) codes.add(m[1]);
  }
  return codes;
}

const lookup = (catalog, key) =>
  key
    .split('.')
    .reduce(
      (node, part) => (node !== null && typeof node === 'object' ? node[part] : undefined),
      catalog,
    );

const { ERROR_CODE_KEYS, SQLSTATE_KEYS, GENERIC_BY_DECISION } = await load('errors.ts');
const { en } = await load('catalogs/en.ts');
const { ar } = await load('catalogs/ar.ts');

const catalogue = new Set(Object.keys(ERROR_CODE_KEYS));
const isRaised = raised();
const unmapped = [...isRaised].filter((c) => !catalogue.has(c)).sort();

const listedRaw = JSON.parse(readFileSync(FIXTURE, 'utf8')).unmapped ?? [];
for (const c of listedRaw) {
  if (!CODE.test(c)) throw new Error(`fixture: "${c}" is not an error code`);
}
const listed = new Set(listedRaw);
const fresh = unmapped.filter((c) => !listed.has(c));
const stale = [...listed].filter((c) => !unmapped.includes(c)).sort();

if (process.argv.includes('--update')) {
  // Only ever shrinks: the codes still listed AND still unmapped stay.
  const kept = [...listed].filter((c) => unmapped.includes(c)).sort();
  writeFileSync(FIXTURE, JSON.stringify({ _readme: README, unmapped: kept }, null, 2) + '\n');
  console.log(
    `wrote ${path.relative(ROOT, FIXTURE)}: ${kept.length} listed code(s), ${stale.length} taken off`,
  );
  if (fresh.length > 0) {
    console.error(
      `FAIL  --update never adds a code; map these in packages/i18n/src/errors.ts: ${fresh.join(', ')}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

const problems = [];
if (fresh.length > 0) {
  problems.push(
    `${fresh.length} error code(s) raised by a migration are not in the error catalogue:\n` +
      fresh.map((c) => `        ${c}`).join('\n') +
      '\n\n      Add each to ERROR_CODE_KEYS (packages/i18n/src/errors.ts) with its line in both\n' +
      '      catalogs (an op.errors.* pair, or an existing line that says it), in the same\n' +
      '      commit as the migration. An app that needs other words passes an override.',
  );
}
if (stale.length > 0) {
  problems.push(
    `${stale.length} listed code(s) are in the catalogue now, or no longer raised:\n` +
      stale.map((c) => `        ${c}`).join('\n') +
      '\n\n      Rerun with --update to take them off fixtures/error-codes-unmapped.json.',
  );
}

// Every line the catalogue can show exists in both languages, and the Arabic is Arabic.
const lines = new Map(); // key -> first code (or SQLSTATE) that uses it
for (const [code, key] of [...Object.entries(ERROR_CODE_KEYS), ...Object.entries(SQLSTATE_KEYS)]) {
  if (!lines.has(key)) lines.set(key, code);
}
const missing = [];
for (const [key, code] of lines) {
  const enText = lookup(en, key);
  const arText = lookup(ar, key);
  if (typeof enText !== 'string' || enText.trim() === '')
    missing.push(`${code} → ${key}: no English line`);
  if (typeof arText !== 'string' || arText.trim() === '')
    missing.push(`${code} → ${key}: no Arabic line`);
  else if (!ARABIC.test(arText))
    missing.push(`${code} → ${key}: the Arabic line has no Arabic in it`);
  else if (arText === enText)
    missing.push(`${code} → ${key}: the Arabic line is the English copied`);
}
if (missing.length > 0) {
  problems.push(
    `${missing.length} catalogue line(s) are not in both languages:\n` +
      missing.map((m) => `        ${m}`).join('\n'),
  );
}

const generic = Object.entries(ERROR_CODE_KEYS)
  .filter(([code, key]) => key === 'errors.generic' && !GENERIC_BY_DECISION.includes(code))
  .map(([code]) => code);
if (generic.length > 0) {
  problems.push(
    `${generic.length} code(s) are mapped to the generic line without a decision:\n` +
      generic.map((c) => `        ${c}`).join('\n') +
      '\n\n      Give each its own line, or name it in GENERIC_BY_DECISION with the decision.',
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL  ${p}\n`);
  process.exit(1);
}
console.log(
  `PASS  ${isRaised.size} raised codes, all in the error catalogue (${catalogue.size} codes, ` +
    `${Object.keys(SQLSTATE_KEYS).length} SQLSTATEs); ${lines.size} lines, each in English and Arabic; ` +
    `${listed.size} on the shrinking list.`,
);
