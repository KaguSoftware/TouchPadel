#!/usr/bin/env node
/**
 * Assistant coverage gate — "knows everything" as a test, not a sentence
 * (plan §3.4, contracts "Lane B").
 *
 * fixtures/assistant-coverage.json lists every source the repo contains and
 * the path it reaches the assistant by:
 *
 *   tables / views      "table_read" | "tool:<name>" | "excluded: <reason>"
 *   functions           "tool:<name>" | "map:action"  | "excluded: <reason>"
 *   routes              "map:page"
 *   edge_functions      "map:system"  | "excluded: <reason>"
 *   cron_jobs           "map:system"  | "excluded: <reason>"
 *   docs                "index:doc"   | "excluded: <reason>"
 *
 * This script re-derives every inventory from the code on each run — tables
 * and views from `create table` / `create view` in the migrations, functions
 * from `grant execute`, routes from ROUTE_ROLES + SUB_ROUTES, edge functions
 * from supabase/functions/*, cron jobs from `cron.schedule(`, docs from the
 * tree — and FAILS on:
 *   * a source with no fixture entry (a new table, RPC, route, function, job
 *     or document cannot land without deciding how the assistant sees it);
 *   * a fixture entry whose source no longer exists (the fixture must not rot);
 *   * a business table (schema public) marked excluded without a reason;
 *   * a `tool:` naming a tool that is not in the catalog, or — for a function —
 *     a tool whose `rpc` is a different function;
 *   * a `map:` or `index:` kind the generator has no renderer for;
 *   * when the local stack answers AND app.assistant_readable_columns exists:
 *     a table_name in that table that the fixture does not know.
 *
 * Runs with no database (the stack check is additive). Wired into
 * `pnpm security` next to check:rpc-registry.
 *
 * Usage:
 *   node scripts/check-assistant-coverage.mjs
 *   node scripts/check-assistant-coverage.mjs --update   # add missing keys with
 *        default paths, drop stale keys, then review the file by hand
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  CHUNK_KINDS,
  PATHS,
  inventoryCron,
  inventoryDocs,
  inventoryEdgeFunctions,
  inventoryFunctions,
  inventoryRoutes,
  inventorySchema,
  readMigrations,
} from './build-assistant-map.mjs';

const UPDATE = process.argv.includes('--update');
const INDEX_KINDS = ['doc', 'menu_item', 'alert', 'note', 'promotion', 'finding', 'rejection', 'request'];

// ── inventories from the code ─────────────────────────────────────────────────
const migrations = readMigrations();
const { tables, views } = inventorySchema(migrations);
const fns = inventoryFunctions(migrations);
const { routeRoles, subRoutes } = inventoryRoutes();
const edge = inventoryEdgeFunctions();
const cron = inventoryCron(migrations);
const docs = inventoryDocs();

const catalog = await import(PATHS.catalog);
const toolByName = new Map(catalog.ASSISTANT_TOOLS.map((t) => [t.name, t]));
const toolByRpc = new Map(catalog.ASSISTANT_TOOLS.filter((t) => t.rpc).map((t) => [t.rpc, t]));

const inventory = {
  tables: [...tables.keys()].sort(),
  views: [...views.keys()].sort(),
  functions: [...fns.keys()].sort(),
  routes: [...new Set([...routeRoles.keys(), ...[...subRoutes.values()].flat()])].sort(),
  edge_functions: [...edge.keys()].sort(),
  cron_jobs: [...cron.keys()].sort(),
  docs,
};

// ── defaults for --update (reviewed by a human afterwards) ────────────────────
function defaultFor(section, name) {
  switch (section) {
    case 'tables':
      return name.startsWith('app.') ? 'excluded: internal schema `app` — REVIEW: write the real reason' : 'table_read';
    case 'views':
      return 'table_read';
    case 'functions': {
      const f = fns.get(name);
      if (toolByRpc.has(name)) return `tool:${toolByRpc.get(name).name}`;
      if (f?.clientCallable) return 'map:action';
      return 'excluded: service_role only — an internal helper reached by other RPCs, edge functions or cron, never by a client';
    }
    case 'routes':
      return 'map:page';
    case 'edge_functions':
    case 'cron_jobs':
      return 'map:system';
    case 'docs':
      return 'index:doc';
  }
  return 'excluded: REVIEW';
}

// ── the fixture ───────────────────────────────────────────────────────────────
let fixture = { _readme: undefined };
if (existsSync(PATHS.coverage)) fixture = JSON.parse(readFileSync(PATHS.coverage, 'utf8'));
for (const section of Object.keys(inventory)) fixture[section] ??= {};

const problems = [];
const notes = [];
const changes = [];

for (const [section, names] of Object.entries(inventory)) {
  const entries = fixture[section];
  const have = new Set(Object.keys(entries));
  const want = new Set(names);
  for (const n of names) {
    if (!have.has(n)) {
      if (UPDATE) {
        entries[n] = defaultFor(section, n);
        changes.push(`+ ${section}.${n} = ${entries[n]}`);
      } else problems.push(`${section}: "${n}" exists in the code but has no fixture entry`);
    }
  }
  for (const n of have) {
    if (!want.has(n)) {
      if (UPDATE) {
        delete entries[n];
        changes.push(`- ${section}.${n} (no longer in the code)`);
      } else problems.push(`${section}: "${n}" is in the fixture but no longer in the code`);
    }
  }
}

// ── validate values ───────────────────────────────────────────────────────────
const isReason = (v) => /^excluded:\s*\S.{9,}/.test(v) && !/REVIEW/.test(v);
for (const [section, entries] of Object.entries(fixture)) {
  if (section.startsWith('_')) continue;
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value !== 'string') {
      problems.push(`${section}.${name}: value must be a string`);
      continue;
    }
    if (value.startsWith('excluded')) {
      if (!isReason(value)) problems.push(`${section}.${name}: excluded without a written reason (at least ten characters, no REVIEW marker)`);
      if (section === 'tables' && !name.startsWith('app.') && !isReason(value)) problems.push(`${section}.${name}: a business table may be excluded only with a reason a reviewer can disagree with`);
      continue;
    }
    if (value.startsWith('tool:')) {
      const toolName = value.slice(5);
      const tool = toolByName.get(toolName);
      if (!tool) problems.push(`${section}.${name}: "${value}" names a tool that is not in the catalog`);
      else if (section === 'functions' && tool.rpc !== name) problems.push(`${section}.${name}: tool ${toolName} is served by app.${tool.rpc}, not app.${name}`);
      continue;
    }
    if (value.startsWith('map:')) {
      if (!CHUNK_KINDS.includes(value.slice(4))) problems.push(`${section}.${name}: "${value}" — no chunk kind "${value.slice(4)}" in the generator`);
      if (section === 'routes' && value !== 'map:page') problems.push(`${section}.${name}: a route is always "map:page"`);
      continue;
    }
    if (value.startsWith('index:')) {
      if (!INDEX_KINDS.includes(value.slice(6))) problems.push(`${section}.${name}: "${value}" — unknown index kind`);
      continue;
    }
    if (value === 'table_read') {
      if (section !== 'tables' && section !== 'views') problems.push(`${section}.${name}: table_read applies to tables and views only`);
      if (name.startsWith('app.')) problems.push(`${section}.${name}: schema app is never readable; mark it excluded with a reason`);
      continue;
    }
    problems.push(`${section}.${name}: unrecognised path "${value}"`);
  }
}

// Every catalog tool with an rpc must point at a function the fixture knows as a tool.
for (const t of catalog.ASSISTANT_TOOLS) {
  if (!t.rpc) continue;
  const v = fixture.functions[t.rpc];
  if (v === undefined) {
    // Dispatcher-internal RPCs (assistant_*) are not granted, so they are not
    // in the grant inventory; the dispatcher reaches them as definer.
    if (!fns.has(t.rpc)) notes.push(`tool ${t.name} → app.${t.rpc} is not granted to any role (reached through the dispatcher only)`);
    continue;
  }
  if (v !== `tool:${t.name}`) problems.push(`functions.${t.rpc}: catalog tool ${t.name} uses it, but the fixture says "${v}"`);
}

// ── live cross-check: assistant_readable_columns, when the stack answers ──────
async function stackUp() {
  try {
    const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
    const res = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}
if (await stackUp()) {
  const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
  const r = spawnSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'select distinct table_name from app.assistant_readable_columns order by 1'], { encoding: 'utf8' });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim();
    if (/does not exist/i.test(err)) notes.push('stack is up but app.assistant_readable_columns does not exist yet (migration 0109 not applied) — readable-columns cross-check skipped');
    else notes.push(`stack is up but psql via docker failed (${err.split('\n')[0] || 'no output'}) — readable-columns cross-check skipped`);
  } else {
    const known = new Set([...inventory.tables, ...inventory.views]);
    const live = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    const unknown = live.filter((t) => !known.has(t) && !known.has(`public.${t}`));
    if (unknown.length) problems.push(`app.assistant_readable_columns names ${unknown.length} table(s) the fixture does not know: ${unknown.join(', ')}`);
    else notes.push(`readable-columns cross-check: ${live.length} table_name(s) in app.assistant_readable_columns, all in the fixture`);
    const readableFixture = [...inventory.tables, ...inventory.views].filter((t) => !t.startsWith('app.') && fixture[inventory.tables.includes(t) ? 'tables' : 'views'][t] === 'table_read');
    const missingLive = readableFixture.filter((t) => !live.includes(t));
    if (missingLive.length) notes.push(`${missingLive.length} table_read source(s) have no row in app.assistant_readable_columns yet: ${missingLive.slice(0, 8).join(', ')}${missingLive.length > 8 ? ', …' : ''}`);
  }
} else {
  notes.push('local stack not answering — readable-columns cross-check skipped (static checks only)');
}

// ── write / report ────────────────────────────────────────────────────────────
if (UPDATE) {
  fixture._readme =
    'Assistant coverage (plan §3.4). Every table, view, granted app.* function, operator route, edge function, ' +
    'cron job and markdown document, with the path it reaches the owner assistant by: table_read, tool:<name>, ' +
    'map:<chunk kind>, index:<chunk kind>, or "excluded: <reason>". check-assistant-coverage.mjs re-derives the ' +
    'inventory from the code and fails on any missing or extra key. `--update` adds new keys with defaults; ' +
    'entries containing REVIEW must be rewritten by hand before the check passes.';
  const ordered = { _readme: fixture._readme };
  for (const section of Object.keys(inventory)) ordered[section] = Object.fromEntries(Object.entries(fixture[section]).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(PATHS.coverage, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`Fixture updated: ${changes.length} change(s)`);
  for (const c of changes) console.log(`  ${c}`);
  console.log('');
}

const excluded = [];
for (const [section, entries] of Object.entries(fixture)) {
  if (section.startsWith('_')) continue;
  for (const [n, v] of Object.entries(entries)) if (String(v).startsWith('excluded')) excluded.push(`${section}.${n} — ${String(v).slice(9).trim()}`);
}

console.log('Assistant coverage\n');
for (const [section, names] of Object.entries(inventory)) console.log(`  ${section.padEnd(15)} ${String(names.length).padStart(4)}`);
console.log(`  ${'excluded'.padEnd(15)} ${String(excluded.length).padStart(4)}`);
if (excluded.length) {
  console.log('\nExcluded, with reasons:');
  for (const e of excluded) console.log(`  ${e}`);
}
if (notes.length) {
  console.log('\nNotes:');
  for (const n of notes) console.log(`  ${n}`);
}
console.log('');

if (problems.length === 0) {
  console.log('PASS  every source has a coverage path; every path resolves.');
  process.exit(0);
}
console.error(`FAIL  ${problems.length} problem(s):`);
for (const p of problems) console.error(`  ${p}`);
console.error('\n  FIX: edit packages/db/fixtures/assistant-coverage.json (or run with --update, then review the REVIEW entries).');
process.exit(1);
