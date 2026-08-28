#!/usr/bin/env node
// Applies seeds/touch-cafe-menu.sql — the REAL Touch Cafe menu — to a stack.
// Same psql-or-docker strategy as db-fixtures.mjs (Windows dev machines rarely
// have psql). Point DATABASE_URL at staging/production to load it there.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'seeds', 'touch-cafe-menu.sql');
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function hasPsql() {
  const r = spawnSync('psql', ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

if (hasPsql()) {
  execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: 'inherit' });
} else {
  const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
  const r = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: readFileSync(file, 'utf8'), stdio: ['pipe', 'inherit', 'inherit'] },
  );
  if (r.status !== 0) {
    console.error(`[db-menu] docker exec failed (container ${container}); is the stack running?`);
    process.exit(r.status ?? 1);
  }
}
console.log('[db-menu] Touch Cafe menu loaded (13 categories, 72 items)');
