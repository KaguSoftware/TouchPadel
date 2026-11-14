#!/usr/bin/env node
/**
 * Owner-assistant route and cost report. READ-ONLY: it issues GET requests and
 * nothing else. It is also the "re-measure the cost profile" instrument: the
 * 2026-10-16 profile predates the 2026-11-09 batch (router tiers, one streaming
 * client, the cost ceilings), so run it again once real traffic has built up.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
 *     node scripts/assistant-route-report.mjs [--days=14] [--limit=15] [--no-text]
 *
 * The service-role key comes from the environment, falling back to
 * scripts/.env.local (git-ignored). Never apps/web/.env.local: the key never
 * reaches the web package (apps/web/CLAUDE.md, "Data"; commit 2768a2aa).
 * There is NO default key and NO default URL: the script refuses to run
 * without both, and prints the project URL it is pointed at before it reads.
 *
 * What it reads (public schema, service role):
 *   assistant_messages  role=assistant rows: tokens {route, route_reason, effort,
 *                       model, cost_micros, calls, web_searches, cost_capped,
 *                       reused_from} (persist.ts), gate {status, retried}, sources
 *                       [{name, row_count, error?}] (turn.ts SourceItem).
 *   assistant_calls     one row per model call: call_no, model, cost_micros,
 *                       web_searches, stop_reason.
 *   platform_settings   llm_web_search_micros (the CURRENT per-search price).
 *   assistant_messages  role=user, only for the misroute candidates, to show the
 *                       owner's words (omit with --no-text).
 *
 * Tiers (mirrors _shared/assistant/route.ts; keep DEEP_REASONS in step):
 *   lookup            tokens.route = 'lookup'
 *   cheap analysis    route 'analysis' and route_reason NOT in DEEP_REASONS
 *                     (plain figure or compare/trend questions, Sonnet tier)
 *   deep              route 'analysis' and route_reason in DEEP_REASONS
 *                     (advice, why, outside, long question: the chat default model)
 *   unrouted          no tokens.route (pre-batch rows)
 *   reused            tokens.reused_from set: no model call, no cost
 */
import { existsSync, readFileSync } from 'node:fs';

// Same set as route.ts DEEP_REASONS. A copy, not an import: that file is Deno-side and
// this script must run on a laptop with nothing but node.
const DEEP_REASONS = new Set(['advice-signal', 'why-signal', 'outside-signal', 'long-question', 'empty']);
// Tools that find or explain pages; they carry no business figure. Everything else is a data tool.
const NAV_TOOLS = new Set(['search', 'describe', 'page_lookup', 'usage', 'web_search']);
// A single call of one of these is "one aggregate" (a cheap-tier-sized read).
const AGGREGATE = /^(panel_headline|report_(?!drill)|analytics_(?!bought_together|menu_snapshot)|history_figures|history_courts|history_staff|history_items|ops_overview|marketing_overview|loyalty_summary|tournaments_summary|courts_and_rates|system_status)/;

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : fallback;
};
const DAYS = Number(opt('days', 14));
const LIST_LIMIT = Number(opt('limit', 15));
const SHOW_TEXT = !argv.includes('--no-text');
if (!Number.isFinite(DAYS) || DAYS <= 0) fail('--days must be a positive number');

function fail(msg) {
  console.error(`assistant-route-report: ${msg}`);
  process.exit(2);
}

function envFromFile(url) {
  const out = {};
  if (!existsSync(url)) return out;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = envFromFile(new URL('./.env.local', import.meta.url));
const BASE = (process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!BASE || !KEY) {
  fail('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment, or scripts/.env.local). No defaults: this reads real owner conversations.');
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function getAll(table, query, max = 50_000) {
  const rows = [];
  const page = 1000;
  for (let from = 0; from < max; from += page) {
    const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, { headers: { ...headers, Range: `${from}-${from + page - 1}`, 'Range-Unit': 'items' } });
    if (!res.ok) fail(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const part = await res.json();
    rows.push(...part);
    if (part.length < page) return rows;
  }
  console.error(`warning: ${table} stopped at ${max} rows; narrow --days`);
  return rows;
}

// ── formatting ────────────────────────────────────────────────────────────
const usd = (micros) => `$${(micros / 1e6).toFixed(micros >= 1e6 ? 2 : 3)}`;
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
function table(head, rows) {
  const all = [head, ...rows].map((r) => r.map(String));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  console.log(line(all[0]));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const r of all.slice(1)) console.log(line(r));
}
const section = (t) => console.log(`\n${t}\n${'='.repeat(t.length)}`);

// ── main ──────────────────────────────────────────────────────────────────
console.log(`assistant-route-report  project: ${BASE}`);
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
console.log(`window: last ${DAYS} day(s), since ${since}`);

const messages = await getAll(
  'assistant_messages',
  `select=id,conversation_id,seq,created_at,tokens,gate,sources&role=eq.assistant&created_at=gte.${since}&order=created_at.asc,id.asc`,
);
const calls = await getAll('assistant_calls', `select=message_id,call_no,model,cost_micros,web_searches,stop_reason&created_at=gte.${since}&order=id.asc`);
const ps = await getAll('platform_settings', 'select=llm_web_search_micros&id=eq.true').catch(() => []);
const searchMicros = Number(ps[0]?.llm_web_search_micros ?? 10_000);

const callsBy = new Map();
for (const c of calls) {
  if (!callsBy.has(c.message_id)) callsBy.set(c.message_id, []);
  callsBy.get(c.message_id).push(c);
}

function tierOf(m) {
  const t = m.tokens ?? {};
  if (t.reused_from) return 'reused';
  if (t.route === 'lookup') return 'lookup';
  if (t.route === 'analysis') return DEEP_REASONS.has(t.route_reason) ? 'deep' : 'cheap analysis';
  return 'unrouted';
}
const costOf = (m) => Number(m.tokens?.cost_micros ?? 0);
const TIERS = ['lookup', 'cheap analysis', 'deep', 'unrouted', 'reused'];

if (!messages.length) {
  console.log('\nNo assistant messages in this window. Nothing to report.');
  process.exit(0);
}

const byTier = new Map(TIERS.map((t) => [t, []]));
for (const m of messages) byTier.get(tierOf(m)).push(m);
const totalCost = messages.reduce((n, m) => n + costOf(m), 0);

section('1. Messages per tier');
table(
  ['tier', 'messages', 'share', 'model calls', 'calls/msg'],
  [
    ...TIERS.map((t) => {
      const ms = byTier.get(t);
      const nc = ms.reduce((n, m) => n + Number(m.tokens?.calls ?? callsBy.get(m.id)?.length ?? 0), 0);
      return [t, ms.length, pct(ms.length, messages.length), nc, ms.length ? (nc / ms.length).toFixed(2) : '-'];
    }),
    ['total', messages.length, '100%', '', ''],
  ],
);

section('2. Cost per tier (USD, from tokens.cost_micros per message; searches included)');
table(
  ['tier', 'sum', 'share of $', 'median/msg', 'p95/msg', 'max/msg', 'cost-capped'],
  TIERS.map((t) => {
    const ms = byTier.get(t);
    const s = ms.map(costOf).sort((a, b) => a - b);
    const sum = s.reduce((n, x) => n + x, 0);
    return [t, usd(sum), pct(sum, totalCost), usd(quantile(s, 0.5)), usd(quantile(s, 0.95)), usd(s[s.length - 1] ?? 0), ms.filter((m) => m.tokens?.cost_capped).length];
  }).concat([['total', usd(totalCost), '100%', '', '', '', messages.filter((m) => m.tokens?.cost_capped).length]]),
);
const callCostSum = calls.reduce((n, c) => n + Number(c.cost_micros ?? 0), 0);
console.log(`cross-check: sum of assistant_calls.cost_micros = ${usd(callCostSum)} over ${calls.length} calls (messages ${usd(totalCost)}; a gap means calls rows are missing or the window edge split a turn).`);
const byModel = new Map();
for (const c of calls) {
  const k = c.model;
  const e = byModel.get(k) ?? { n: 0, cost: 0 };
  e.n++;
  e.cost += Number(c.cost_micros ?? 0);
  byModel.set(k, e);
}
if (byModel.size) {
  console.log('\nby model (calls):');
  table(['model', 'calls', 'cost', 'share of $'], [...byModel].map(([k, e]) => [k, e.n, usd(e.cost), pct(e.cost, callCostSum)]));
}

section('3. Web searches');
const searchMsgs = messages.filter((m) => Number(m.tokens?.web_searches ?? 0) > 0);
const searches = messages.reduce((n, m) => n + Number(m.tokens?.web_searches ?? 0), 0);
console.log(`searches: ${searches} across ${searchMsgs.length} message(s) (${pct(searchMsgs.length, messages.length)} of messages)`);
console.log(`search cost: ${usd(searches * searchMicros)} at the CURRENT price ${usd(searchMicros)}/search (platform_settings.llm_web_search_micros; a price changed inside the window is not reconstructed).`);
console.log(`share of total spend: ${pct(searches * searchMicros, totalCost)}`);
table(
  ['tier', 'messages that searched', 'searches'],
  TIERS.map((t) => {
    const ms = byTier.get(t).filter((m) => Number(m.tokens?.web_searches ?? 0) > 0);
    return [t, ms.length, ms.reduce((n, m) => n + Number(m.tokens.web_searches), 0)];
  }),
);

section('4. Gate outcomes (assistant_messages.gate)');
const gated = messages.filter((m) => m.gate && typeof m.gate === 'object');
const ok = gated.filter((m) => m.gate.status === 'ok');
const bad = gated.filter((m) => m.gate.status === 'unverified');
const retried = gated.filter((m) => m.gate.retried);
const retriedOk = retried.filter((m) => m.gate.status === 'ok');
table(
  ['outcome', 'messages', 'share of gated'],
  [
    ['verified (ok)', ok.length, pct(ok.length, gated.length)],
    ['unverified (figure shown flagged)', bad.length, pct(bad.length, gated.length)],
    ['retried', retried.length, pct(retried.length, gated.length)],
    ['  retried then verified', retriedOk.length, pct(retriedOk.length, retried.length)],
    ['no gate verdict (errors, job estimates, reused)', messages.length - gated.length, pct(messages.length - gated.length, messages.length)],
  ],
);

// ── misroute candidates ────────────────────────────────────────────────────
const dataTools = (m) => (Array.isArray(m.sources) ? m.sources : []).filter((s) => s && !NAV_TOOLS.has(s.name) && !s.error);
const textCache = new Map();
async function ownerWords(m) {
  if (!SHOW_TEXT) return '';
  const key = `${m.conversation_id}:${m.seq - 1}`;
  if (textCache.has(key)) return textCache.get(key);
  let out = '';
  try {
    const rows = await getAll('assistant_messages', `select=content&conversation_id=eq.${m.conversation_id}&seq=eq.${m.seq - 1}&role=eq.user`, 1);
    const block = Array.isArray(rows[0]?.content) ? rows[0].content.find((b) => b?.type === 'text') : null;
    out = String(block?.text ?? '').replace(/\s+/g, ' ').slice(0, 70);
  } catch {
    out = '';
  }
  textCache.set(key, out);
  return out;
}
async function listCandidates(list, describe) {
  if (!list.length) return console.log('  none');
  const rows = [];
  for (const m of list.slice(0, LIST_LIMIT)) {
    rows.push([m.created_at.slice(0, 16).replace('T', ' '), m.id.slice(0, 8), m.tokens?.route_reason ?? '-', describe(m), usd(costOf(m)), await ownerWords(m)]);
  }
  table(['when (UTC)', 'message', 'route_reason', 'evidence', 'cost', 'owner words'], rows);
  if (list.length > LIST_LIMIT) console.log(`  … ${list.length - LIST_LIMIT} more (raise --limit)`);
}

section('5a. Misroute candidates: lookup route, but data tools ran');
const lookupWithData = byTier.get('lookup').filter((m) => dataTools(m).length > 0);
console.log(`${lookupWithData.length} of ${byTier.get('lookup').length} lookup messages (${pct(lookupWithData.length, byTier.get('lookup').length)}) show a non-navigation tool in sources.`);
await listCandidates(lookupWithData, (m) => dataTools(m).map((s) => s.name).join('+'));
console.log(`  can see:    the stored route and reason, and every executed tool in sources (name, error). Navigation tools (${[...NAV_TOOLS].join(', ')}) are ignored.`);
console.log('  cannot see: whether the data tool was NEEDED. A lookup that reads one figure to answer "where is X" is fine; the sources do not say what the');
console.log('              answer used. Also not derivable: the route the router WOULD pick today (rows keep only the stored verdict), and a model that a warm-cache');
console.log('              sticky route kept from the previous turn (turnPolicy keepWarmRoute): tokens.model is the model that ran, not the router\'s own pick.');
console.log('              Tool calls that threw are in sources with an error and are excluded here; a message cut off before persist leaves no row at all.');

section('5b. Misroute candidates: deep route, one round, one aggregate tool (cheap-tier candidates)');
const deepOne = byTier.get('deep').filter((m) => {
  const cs = callsBy.get(m.id) ?? [];
  const nCalls = cs.length || Number(m.tokens?.calls ?? 0);
  const data = dataTools(m);
  const searched = Number(m.tokens?.web_searches ?? 0) > 0;
  return nCalls > 0 && nCalls <= 2 && data.length === 1 && AGGREGATE.test(data[0].name) && !searched;
});
console.log(`${deepOne.length} of ${byTier.get('deep').length} deep messages (${pct(deepOne.length, byTier.get('deep').length)}): at most 2 model calls (one tool round), exactly one aggregate tool, no web search.`);
await listCandidates(deepOne, (m) => {
  const d = dataTools(m)[0];
  return `${d.name} calls=${(callsBy.get(m.id) ?? []).length || m.tokens?.calls}`;
});
const potential = deepOne.reduce((n, m) => n + costOf(m), 0);
console.log(`  spend on these ${deepOne.length}: ${usd(potential)} (${pct(potential, totalCost)} of all spend); the cheap tier would cost less, by the Opus:Sonnet price ratio in platform_settings.llm_pricing.`);
console.log('  can see:    round count (assistant_calls), tool names and errors, whether a search ran, the deep-tier reason (advice/why/outside/long-question).');
console.log('  cannot see: answer quality, so "could Sonnet have answered this as well" stays a human judgement; read the owner words before moving a rule.');
console.log('              The aggregate-tool list is a name pattern in this script (AGGREGATE); a new tool is treated as non-aggregate until added.');
console.log('              A deep reason such as "advice-signal" is the router doing its job even when one tool answered; the candidates show where the');
console.log('              signal words were weak, not that the route was wrong.');

console.log('\ndone (read-only).');
