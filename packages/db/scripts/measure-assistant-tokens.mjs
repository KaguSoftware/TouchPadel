#!/usr/bin/env node
/**
 * Token measurement for the owner assistant — the numbers the job estimator
 * multiplies (plan §6.2, §11.8; contracts "Lane B").
 *
 * For every LIST tool in the catalog it:
 *   1. calls app.assistant_run_tool as the seeded owner on the local stack with
 *      a wide default range and a 50-row page;
 *   2. cleans the result exactly as the chat does, through
 *      _shared/assistant/clean.ts (pure; imported dynamically — when Lane C's
 *      file is missing it counts the raw JSON instead and says so);
 *   3. counts the tokens of the cleaned text — with ANTHROPIC_API_KEY set,
 *      through POST /v1/messages/count_tokens (exact for the chat model);
 *      without it, bytes / 4, labelled as an estimate;
 *   4. prints tokens_per_row per tool and a patch suggestion for tools.ts.
 *
 * It also counts the compact map prefix (fixtures/assistant-map-compact.md),
 * which is what the cached system prompt carries on every turn.
 *
 * It never edits tools.ts: the measured constants are pasted by a human so the
 * diff is reviewed (the catalog is copied byte-for-byte into the edge bundle).
 *
 * Env: SUPABASE_URL (default http://127.0.0.1:54321), SUPABASE_ANON_KEY,
 *      ANTHROPIC_API_KEY (optional), ANTHROPIC_MODEL (default claude-opus-5).
 *
 * Usage:  node scripts/measure-assistant-tokens.mjs [--rows 50] [--from YYYY-MM-DD --to YYYY-MM-DD]
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { PATHS, DB } from './build-assistant-map.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const ROWS = Number(flag('rows', '50'));
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const TO = flag('to', iso(today));
const FROM = flag('from', iso(new Date(today.getTime() - 365 * 86_400_000)));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const OWNER = { email: 'owner@dev.touch.local', password: 'touch-dev-password' }; // tests/helpers.ts SEED_STAFF
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const catalog = await import(PATHS.catalog);

// ── token counting ────────────────────────────────────────────────────────────
let countMode = API_KEY ? `count_tokens (${MODEL})` : 'bytes / 4 (no ANTHROPIC_API_KEY — an estimate, not a measurement)';
async function countTokens(text) {
  if (!API_KEY) return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: text }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`count_tokens ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.input_tokens;
}

// ── the cleaner (Lane C), when present ────────────────────────────────────────
let cleaner = null;
let cleanNote = '';
const cleanPath = path.join(DB, 'supabase/functions/_shared/assistant/clean.ts');
const handlesPath = path.join(DB, 'supabase/functions/_shared/assistant/handles.ts');
if (existsSync(cleanPath) && existsSync(handlesPath)) {
  try {
    const cleanMod = await import(cleanPath);
    const handlesMod = await import(handlesPath);
    if (typeof cleanMod.clean === 'function' && typeof cleanMod.sourceForTool === 'function' && typeof handlesMod.newHandleTable === 'function') {
      cleaner = { ...cleanMod, newHandleTable: handlesMod.newHandleTable };
      cleanNote = 'cleaned through _shared/assistant/clean.ts';
    } else cleanNote = 'clean.ts found but does not export clean()/sourceForTool() — counting raw JSON';
  } catch (e) {
    cleanNote = `clean.ts could not be imported (${String(e.message).split('\n')[0]}) — counting raw JSON`;
  }
} else {
  cleanNote = '_shared/assistant/clean.ts is missing (Lane C not landed) — counting raw JSON';
}

function shape(tool, data, tz) {
  if (!cleaner) {
    const text = JSON.stringify(data);
    return { text, rows: rowsIn(data, tool.result.rows_path), mode: 'raw json' };
  }
  const columns = data && typeof data === 'object' && Array.isArray(data.columns) ? data.columns : null;
  const source = cleaner.sourceForTool(tool, columns);
  const cleaned = cleaner.clean(source, data, { tz, lang: 'en', handles: cleaner.newHandleTable(null), total: data?.total ?? null });
  return { text: cleaned.text, rows: cleaned.stats?.rows_in ?? rowsIn(data, tool.result.rows_path), mode: 'cleaned' };
}

function rowsIn(data, rowsPath) {
  if (rowsPath === '$') return Array.isArray(data) ? data.length : 0;
  if (rowsPath && data && Array.isArray(data[rowsPath])) return data[rowsPath].length;
  return data && typeof data === 'object' ? 1 : 0;
}

// ── default arguments per tool ────────────────────────────────────────────────
function defaultInput(tool) {
  const input = {};
  for (const [name, arg] of Object.entries(tool.args)) {
    if (name === 'from') input.from = FROM;
    else if (name === 'to') input.to = TO;
    else if (name === 'limit') input.limit = Math.min(ROWS, arg.max ?? ROWS);
    else if (name === 'offset') input.offset = 0;
    else if (arg.required) {
      if (arg.type === 'enum') input[name] = arg.values[0];
      else if (arg.type === 'string') input[name] = name === 'table' ? 'reservations' : name === 'view' ? 'on_hand' : name === 'figure' ? 'revenue' : name === 'query' || name === 'q' ? 'a' : 'x';
      else if (arg.type === 'date') input[name] = TO;
      else if (arg.type === 'timestamp') input[name] = `${TO}T00:00:00Z`;
      else if (arg.type === 'integer') input[name] = arg.min ?? 1;
      else if (arg.type === 'boolean') input[name] = false;
    }
  }
  return input;
}

// ── run ───────────────────────────────────────────────────────────────────────
console.log('Assistant token measurement\n');
console.log(`  counting     ${countMode}`);
console.log(`  shaping      ${cleanNote}`);
console.log(`  range        ${FROM} → ${TO}, ${ROWS} rows per list tool\n`);

// The compact prefix first: it needs no database.
const compact = existsSync(PATHS.compact) ? readFileSync(PATHS.compact, 'utf8') : null;
if (compact) {
  const t = await countTokens(compact);
  console.log(`  compact map  ${Buffer.byteLength(compact).toLocaleString()} bytes → ${t.toLocaleString()} tokens ${API_KEY ? '' : '(estimate)'}`);
} else console.log('  compact map  missing — run scripts/build-assistant-map.mjs first');

let stack = false;
try {
  stack = (await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY }, signal: AbortSignal.timeout(3_000) })).ok;
} catch {
  stack = false;
}
if (!stack) {
  console.log(`\n  local stack not answering at ${SUPABASE_URL} — no tool was measured. Start it (pnpm db:start) and re-run.`);
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: signInError } = await supabase.auth.signInWithPassword(OWNER);
if (signInError) {
  console.error(`\nFAIL  owner sign-in failed: ${signInError.message} (seeded owner missing? see tests/helpers.ts)`);
  process.exit(1);
}
const { data: venue } = await supabase.from('platform_settings').select('timezone').eq('id', true).maybeSingle();
const tz = venue?.timezone ?? 'Asia/Baghdad';

const listTools = catalog.ASSISTANT_TOOLS.filter((t) => t.kind === 'list' && t.rpc);
const results = [];
const unmeasured = [];
let rpcMissing = false;
for (const tool of listTools) {
  const input = defaultInput(tool);
  const problems = catalog.validateToolInput(tool, input);
  if (problems.length) {
    unmeasured.push({ tool: tool.name, why: `default args invalid: ${problems.join('; ')}` });
    continue;
  }
  const p_args = catalog.rpcArgs(tool, input);
  // The dispatcher's `case` is over the catalog's RPC names (contracts 0109), not tool names.
  const { data, error } = await supabase.schema('app').rpc('assistant_run_tool', { p_tool: tool.rpc, p_args });
  if (error) {
    if (/PGRST202|Could not find the function/i.test(error.message)) rpcMissing = true;
    unmeasured.push({ tool: tool.name, why: error.message.split('\n')[0] });
    continue;
  }
  // The dispatcher wraps: {tool, data, row_count, truncated}. Accept a bare payload too.
  const payload = data && typeof data === 'object' && 'data' in data && 'tool' in data ? data.data : data;
  const shaped = shape(tool, payload, tz);
  const tokens = await countTokens(shaped.text);
  const rawBytes = Buffer.byteLength(JSON.stringify(payload));
  results.push({
    tool: tool.name,
    rows: shaped.rows,
    raw_bytes: rawBytes,
    shaped_bytes: Buffer.byteLength(shaped.text),
    tokens,
    tokens_per_row: shaped.rows > 0 ? Math.ceil(tokens / shaped.rows) : null,
    current: tool.tokens_per_row,
    mode: shaped.mode,
  });
}

if (results.length) {
  console.log('\n  tokens_per_row');
  console.log(`  ${'tool'.padEnd(28)} ${'rows'.padStart(5)} ${'raw B'.padStart(8)} ${'shaped B'.padStart(9)} ${'tokens'.padStart(7)} ${'per row'.padStart(8)} ${'in catalog'.padStart(11)}  mode`);
  for (const r of results) {
    console.log(
      `  ${r.tool.padEnd(28)} ${String(r.rows).padStart(5)} ${r.raw_bytes.toLocaleString().padStart(8)} ${r.shaped_bytes.toLocaleString().padStart(9)} ${r.tokens.toLocaleString().padStart(7)} ${String(r.tokens_per_row ?? '—').padStart(8)} ${String(r.current ?? 'null').padStart(11)}  ${r.mode}`,
    );
  }
  const measured = results.filter((r) => r.tokens_per_row !== null);
  if (measured.length) {
    console.log('\n  Patch suggestion for packages/core/src/assistant/tools.ts (and its _shared copy) — paste by hand:');
    for (const r of measured) console.log(`    ${r.tool.padEnd(28)} tokens_per_row: ${r.tokens_per_row},${r.rows < 20 ? `   // only ${r.rows} rows in the seed — re-measure on real data` : ''}`);
    if (!API_KEY) console.log('    (bytes / 4 — set ANTHROPIC_API_KEY for exact counts before pasting)');
  }
  const noRows = results.filter((r) => r.tokens_per_row === null);
  if (noRows.length) console.log(`\n  No rows returned (nothing to measure): ${noRows.map((r) => r.tool).join(', ')}`);
}
if (unmeasured.length) {
  console.log(`\n  Could not measure ${unmeasured.length} tool(s):`);
  for (const u of unmeasured) console.log(`    ${u.tool.padEnd(28)} ${u.why}`);
  if (rpcMissing) console.log('\n  app.assistant_run_tool is not deployed on this stack (migration 0109). Apply it and re-run.');
}
await supabase.auth.signOut();
