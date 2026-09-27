#!/usr/bin/env node
/**
 * Load the system map into the assistant's search index after a deploy
 * (plan §3.2, §4.2). Every chunk of fixtures/assistant-map.json is POSTED to
 * the `assistant-index` function in small batches (`{mode:'map', chunks}`),
 * then one `{mode:'prune', kinds, keep}` call per run drops refs the fixture
 * no longer has. Small batches on purpose: with EMBEDDING_PROVIDER=local the
 * function embeds inside the edge worker, whose CPU and memory limits killed a
 * single 1,155-chunk invocation (546 WORKER_LIMIT, 2026-09-20); 32 texts per
 * request stays well inside them. The bundled `{mode:'map'}` load without a
 * body remains for the owner's in-app button and for a vendor embedder.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/assistant-index-map.mjs
 *   FUNCTIONS_URL defaults to the local stack (http://127.0.0.1:54321/functions/v1).
 *   --batch=8 chunks per posted request (default 8; the built-in embedder has a 2 s CPU budget per request, about 60 ms a text).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { embedLocal, MODEL as LOCAL_MODEL } from './assistant-embed-local.mjs';
// The runtime embeds a chunk's CLEANED text (functions/assistant-index/index.ts
// `prepare`), so the vectors posted from here must be computed on the same
// bytes: same clean(), same source spec, same venue timezone constant.
import { clean, sourceForChunk } from '../supabase/functions/_shared/assistant/clean.ts';
import { newHandleTable } from '../supabase/functions/_shared/assistant/handles.ts';
const TZ = 'Asia/Baghdad';
function cleanedText(c) {
  return clean(sourceForChunk(c.kind), { title: c.title, body: c.body, route: c.route, lang: c.lang }, { tz: TZ, lang: 'en', handles: newHandleTable(null) }).text;
}

const DB = path.resolve(import.meta.dirname, '..');
const FIXTURE = path.join(DB, 'fixtures/assistant-map.json');
const BASE = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(/\/$/, '');
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  // Long-standing `supabase start` demo key (local only — no secret value).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const BATCH = Number(process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] ?? 8);
/**
 * --embed=gte-small (default) computes every chunk's vector here with the same
 * model the runtime uses and posts it; the function stores it when its own
 * provider is `local` and ignores it otherwise (a vendor's vectors would not be
 * comparable). --embed=none posts text only and lets the function embed.
 */
const EMBED = process.argv.find((a) => a.startsWith('--embed='))?.split('=')[1] ?? 'gte-small';
/** Batches that carry vectors do no model work in the worker, so they can be larger. */
const EMBEDDED_BATCH = Number(process.argv.find((a) => a.startsWith('--embedded-batch='))?.split('=')[1] ?? 50);


async function call(body, attempt = 0) {
  const res = await fetchWithRetry(body, attempt);
  const text = await res.text();
  // With the built-in embedder the worker's CPU budget is cumulative: after a
  // few batches the runtime kills it (546 WORKER_LIMIT) and the replacement pays
  // the model load on its first request. Back off and retry; the caller also
  // halves the batch when a slice keeps failing.
  if ((res.status === 503 || res.status === 546) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return call(body, attempt + 1);
  }
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

function fetchWithRetry(body) {
  return fetch(`${BASE}/assistant-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
}

async function main() {
  const map = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  let chunks = map.chunks;
  const kinds = [...new Set(chunks.map((c) => c.kind))];
  let batch = BATCH;
  if (EMBED === 'gte-small') {
    const t0 = Date.now();
    const vectors = await embedLocal(chunks.map((c) => cleanedText(c)));
    chunks = chunks.map((c, i) => ({ ...c, embedding: vectors[i] }));
    batch = EMBEDDED_BATCH;
    console.log(`  embedded ${chunks.length} chunks with ${LOCAL_MODEL} in ${Math.round((Date.now() - t0) / 1000)} s`);
  } else if (EMBED !== 'none') {
    throw new Error(`--embed must be gte-small or none, got ${EMBED}`);
  }
  console.log(`assistant-index at ${BASE}: ${chunks.length} chunks, ${kinds.length} kinds, ${batch} per request`);

  let processed = 0;
  let failed = 0;
  const started = Date.now();
  /** Post one slice; when it keeps failing, split it and post the halves (down to single chunks). */
  async function post(slice) {
    try {
      const r = await call({ mode: 'map', chunks: slice });
      processed += r.processed ?? 0;
      failed += r.failed ?? 0;
      return r;
    } catch (e) {
      if (slice.length === 1) throw e;
      const mid = Math.ceil(slice.length / 2);
      console.log(`  splitting a batch of ${slice.length} after: ${e.message.slice(0, 120)}`);
      await post(slice.slice(0, mid));
      return post(slice.slice(mid));
    }
  }
  for (let i = 0; i < chunks.length; i += batch) {
    const r = await post(chunks.slice(i, i + batch));
    if ((i / batch) % 10 === 0 || i + batch >= chunks.length) {
      console.log(`  ${Math.min(i + batch, chunks.length)}/${chunks.length}  (${r.ms} ms, provider ${r.provider}${r.precomputed ? `, ${r.precomputed} vectors precomputed` : ''})`);
    }
  }

  const pruned = await call({ mode: 'prune', kinds, keep: chunks.map((c) => c.ref) });
  console.log(`  processed ${processed}, failed ${failed}, pruned ${pruned.deleted} stale, ${Math.round((Date.now() - started) / 1000)} s`);
  if (failed > 0) {
    console.error('\nFAIL  some chunks were refused; see the function logs.');
    process.exit(1);
  }
  console.log('\nPASS  map indexed.');
}

await main();
