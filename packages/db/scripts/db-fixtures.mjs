#!/usr/bin/env node
// Loads packages/db/fixtures/*.sql into the LOCAL stack. Uses `psql` when it is on PATH, otherwise
// pipes the files through the Supabase Postgres container (Windows dev machines rarely have psql).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['courts.sql', 'menu.sql', 'tables.sql', 'stock.sql'].map((f) => join(root, 'fixtures', f));
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function hasPsql() {
  const r = spawnSync('psql', ['--version'], { stdio: 'ignore'});
  return r.status === 0;
}

if (hasPsql()) {
  const args = [DB_URL, '-v', 'ON_ERROR_STOP=1', ...files.flatMap((f) => ['-f', f])];
  execFileSync('psql', args, { stdio: 'inherit'});
} else {
  const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
  const sql = files.map((f) => `-- fixture: ${f}\n${readFileSync(f, 'utf8')}`).join('\n');
  const r = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, stdio: ['pipe', 'inherit', 'inherit']},
  );
  if (r.status !== 0) {
    console.error(`[db-fixtures] docker exec failed (container ${container}); is the local stack running?`);
    process.exit(r.status ?? 1);
  }
}
console.log('[db-fixtures] loaded', files.length, 'fixture files');
