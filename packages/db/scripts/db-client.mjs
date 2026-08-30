#!/usr/bin/env node
// Loads packages/db/client-data/*.sql — Touch's OWN business data, derived from the intake packs.
//
// Deliberately NOT part of `db:fixtures`: as of the 2026-08-29 pack Touch has sent courts but no
// rate rules, so the real courts price as NO_RATE and nothing can be booked on them. The f1f7
// fixtures stay the dev/test default until rates arrive. See ../client-data/README.md.
//
// Same psql-or-docker strategy as db-fixtures.mjs, including the guard that refuses to run when
// DATABASE_URL points somewhere the docker fallback cannot reach — the fallback execs psql INSIDE
// the local Supabase container, so without the guard it silently loads the local database and
// reports success while the intended target is untouched.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Order matters: courts before rates before anything that references them.
const ORDER = ['courts.sql', 'rates.sql', 'menu.sql', 'recipes.sql', 'staff.sql'];
const files = ORDER.map((f) => join(root, 'client-data', f)).filter(existsSync);
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (files.length === 0) {
  console.error('[db-client] no client-data/*.sql to load — has an intake pack been landed yet?');
  process.exit(1);
}

function hasPsql() {
  const r = spawnSync('psql', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

function isLocalTarget(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false; // unparseable: treat as remote and refuse rather than guess
  }
}

if (hasPsql()) {
  const args = [DB_URL, '-v', 'ON_ERROR_STOP=1', ...files.flatMap((f) => ['-f', f])];
  execFileSync('psql', args, { stdio: 'inherit' });
} else {
  if (!isLocalTarget(DB_URL)) {
    console.error(
      `[db-client] refusing to run: DATABASE_URL points at ${new URL(DB_URL).host}, but psql\n` +
        `            is not installed, and the docker fallback can only reach the LOCAL\n` +
        `            container. Loading the client's data into the wrong database is worse\n` +
        `            than the no-op you asked for. Install psql to proceed.`,
    );
    process.exit(1);
  }
  const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
  const sql = files.map((f) => `-- client-data: ${f}\n${readFileSync(f, 'utf8')}`).join('\n');
  const r = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  if (r.status !== 0) {
    console.error(`[db-client] docker exec failed (container ${container}); is the local stack running?`);
    process.exit(r.status ?? 1);
  }
}
console.log('[db-client] loaded', files.length, 'client-data file(s):', files.map((f) => f.split(/[\\/]/).pop()).join(', '));
