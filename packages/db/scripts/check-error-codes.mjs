#!/usr/bin/env node
/**
 * check-error-codes — every error code a migration raises reaches staff and
 * guests as words, not "Something went wrong".
 *
 * A code is `raise exception 'CODE'` in any migration. It is covered when a
 * client maps it: the operator's MAPPED_CODES (apps/operator/src/lib/errors.ts),
 * the phone's CODE_TO_KEY (apps/mobile/src/features/booking/errors.ts) or the
 * web's RPC_ERROR_KEYS (apps/web/src/lib/appRpc.ts). The codes nobody mapped
 * before this gate existed (2026-09-27, the scanned-paper audit, which found
 * DAY_CLOSED, EMPTY_DELIVERY and INVALID_LINE reaching the till as a generic
 * error) are listed in fixtures/error-codes-unmapped.json; the list only
 * shrinks.
 *
 *   FAIL  a code raised by a migration, mapped by no client and not listed:
 *         map it (both catalogs) in the same commit as the migration.
 *   FAIL  a listed code that is now mapped, or no longer raised: rerun with
 *         --update to take it off the list.
 *
 * Usage: node scripts/check-error-codes.mjs [--update]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MIG_DIR = path.join(ROOT, 'packages/db/supabase/migrations');
const FIXTURE = path.join(ROOT, 'packages/db/fixtures/error-codes-unmapped.json');
const CODE = /^[A-Z][A-Z0-9_]+$/;

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The text between `open` and the first `close` after it. */
function block(src, open, close, file) {
  const at = src.indexOf(open);
  if (at < 0) throw new Error(`${file}: "${open}" not found; the gate needs updating`);
  const end = src.indexOf(close, at + open.length);
  return src.slice(at + open.length, end < 0 ? undefined : end);
}

function raised() {
  const codes = new Set();
  for (const f of readdirSync(MIG_DIR).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(path.join(MIG_DIR, f), 'utf8');
    for (const m of sql.matchAll(/raise\s+exception\s+'([A-Z][A-Z0-9_]+)'/gi)) codes.add(m[1]);
  }
  return codes;
}

function mapped() {
  const codes = new Set();
  const op = 'apps/operator/src/lib/errors.ts';
  for (const m of block(read(op), 'MAPPED_CODES: ReadonlySet<string> = new Set([', ']);', op).matchAll(/'([A-Z][A-Z0-9_]+)'/g)) {
    codes.add(m[1]);
  }
  for (const [file, open] of [
    ['apps/mobile/src/features/booking/errors.ts', 'const CODE_TO_KEY = {'],
    ['apps/web/src/lib/appRpc.ts', 'const RPC_ERROR_KEYS: Record<string, MessageKey> = {'],
  ]) {
    for (const m of block(read(file), open, '\n};', file).matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*:/gm)) codes.add(m[1]);
  }
  return codes;
}

const isRaised = raised();
const isMapped = mapped();
const unmapped = [...isRaised].filter((c) => !isMapped.has(c)).sort();

if (process.argv.includes('--update')) {
  writeFileSync(
    FIXTURE,
    JSON.stringify(
      {
        _readme:
          'check-error-codes.mjs: codes a migration raises that no client maps (they show a generic error). The list only shrinks: map a code in a client and both catalogs, then rerun with --update. Never add to it by hand.',
        unmapped,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${path.relative(ROOT, FIXTURE)}: ${unmapped.length} unmapped code(s)`);
  process.exit(0);
}

const listed = new Set(JSON.parse(readFileSync(FIXTURE, 'utf8')).unmapped ?? []);
for (const c of listed) {
  if (!CODE.test(c)) throw new Error(`fixture: "${c}" is not an error code`);
}
const fresh = unmapped.filter((c) => !listed.has(c));
const stale = [...listed].filter((c) => !unmapped.includes(c)).sort();

if (fresh.length > 0) {
  console.error(`FAIL  ${fresh.length} error code(s) raised by a migration reach no client as words:`);
  for (const c of fresh) console.error(`        ${c}`);
  console.error(
    '\n      Map each where it can surface (apps/operator/src/lib/errors.ts MAPPED_CODES,\n' +
      '      apps/mobile/src/features/booking/errors.ts CODE_TO_KEY or apps/web/src/lib/appRpc.ts\n' +
      '      RPC_ERROR_KEYS) with its line in both catalogs, in the same commit as the migration.',
  );
}
if (stale.length > 0) {
  console.error(`FAIL  ${stale.length} listed code(s) are mapped now, or no longer raised:`);
  for (const c of stale) console.error(`        ${c}`);
  console.error('\n      Rerun with --update to take them off fixtures/error-codes-unmapped.json.');
}
if (fresh.length > 0 || stale.length > 0) process.exit(1);
console.log(
  `PASS  ${isRaised.size} raised codes: ${isRaised.size - unmapped.length} mapped by a client, ${unmapped.length} on the shrinking list.`,
);
