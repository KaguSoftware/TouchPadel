#!/usr/bin/env node
/**
 * Load the system map into the assistant's search index after a deploy
 * (plan §3.2, §4.2). Three calls to the `assistant-index` function:
 *
 *   1. `{mode:'map'}` — the function indexes the map bundled inside it (every
 *      kind except `doc`) and sweeps stale refs of those kinds.
 *   2. `{mode:'map', chunks:[…]}` × N — the `doc` chunks from
 *      fixtures/assistant-map.json, posted in batches, because 1.9 MB of repo
 *      prose has no business inside a function bundle.
 *   3. `{mode:'prune', kinds:['doc'], keep:[…]}` — drop doc refs the fixture no
 *      longer has.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/assistant-index-map.mjs
 *   FUNCTIONS_URL defaults to the local stack (http://127.0.0.1:54321/functions/v1).
 *   --batch=100 rows per posted request (default 100).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DB = path.resolve(import.meta.dirname, '..');
const FIXTURE = path.join(DB, 'fixtures/assistant-map.json');
const BASE = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(/\/$/, '');
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Long-standing `supabase start` demo key (local only — no secret value).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const BATCH = Number(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? 100);

/** The kinds the edge copy leaves out — keep in step with EDGE_EXCLUDED_KINDS in build-assistant-map.mjs. */
const POSTED_KINDS = ['doc'];

async function call(body) {
  const res = await fetch(`${BASE}/assistant-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok || parsed.ok === false) {
    throw new Error(`assistant-index ${body.mode}${body.chunks ? ` (${body.chunks.length} chunks)` : ''} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return parsed;
}

async function main() {
  const map = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const posted = map.chunks.filter((c) => POSTED_KINDS.includes(c.kind));
  console.log(`assistant-index at ${BASE}`);

  const bundled = await call({ mode: 'map' });
  console.log(`  bundled map: processed ${bundled.processed}, failed ${bundled.failed}, stale deleted ${bundled.deleted}, provider ${bundled.provider}, ${bundled.ms} ms`);

  let processed = 0;
  let failed = 0;
  for (let i = 0; i < posted.length; i += BATCH) {
    const slice = posted.slice(i, i + BATCH);
    const r = await call({ mode: 'map', chunks: slice });
    processed += r.processed ?? 0;
    failed += r.failed ?? 0;
    console.log(`  docs ${i + slice.length}/${posted.length}: +${r.processed} (${r.ms} ms)`);
  }

  const pruned = await call({ mode: 'prune', kinds: POSTED_KINDS, keep: posted.map((c) => c.ref) });
  console.log(`  docs total: processed ${processed}, failed ${failed}; pruned ${pruned.deleted} stale`);
  if (failed > 0 || bundled.failed > 0) {
    console.error('\nFAIL  some chunks were refused; see the function logs.');
    process.exit(1);
  }
  console.log('\nPASS  map indexed.');
}

await main();
