#!/usr/bin/env node
/**
 * Owner-assistant eval runner (plan §8 "Eval set", §4.5 the gate).
 *
 * Runs the 40 questions in tests/assistant-eval/cases.json against the local
 * stack's `assistant-chat` function as the seeded owner, one fresh
 * conversation per question, and scores each answer:
 *
 *   numeric  the SQL truth (run as postgres through the stack's container)
 *            appears in the answer — matched on parsed number tokens, so
 *            "228,000", "228000" and "٢٢٨٬٠٠٠" all count — AND the server's
 *            `gate` event says `ok` (no figure the tools did not return);
 *   where    any `contains_any` fragment (route or page title, EN or AR) appears;
 *   audit    one of `actor_any` AND one of `contains_any` appear.
 *
 * Summary: "N/40, unverified figures on numeric: M, median tokens per answer: T".
 * Exit 0 when N >= 36 and M == 0 (the ship gate), 1 otherwise, 2 when the run
 * could not happen (model not configured, quota, stack or docker missing) —
 * that is a state report, not a failure.
 *
 * The fixture rows the numeric and audit questions need are planted before the
 * run and removed after it (tests/assistant-eval/fixture.sql, through
 * `docker exec … psql` under session_replication_role=replica because
 * audit_log/payments/refunds are append-only). `--keep-fixture` leaves them.
 *
 * Usage:
 *   node scripts/assistant-eval.mjs [--only=<id-substring>] [--kind=numeric|where|audit]
 *        [--json=<out.json>] [--keep-fixture] [--no-fixture] [--timeout=90000] [--pace=<ms between questions>]
 * Env: SUPABASE_URL (default http://127.0.0.1:54321), SUPABASE_ANON_KEY,
 *      FUNCTIONS_URL (default <SUPABASE_URL>/functions/v1), EVAL_OWNER_EMAIL,
 *      EVAL_OWNER_PASSWORD, SUPABASE_DB_CONTAINER (default supabase_db_touchpadel).
 *      No ANTHROPIC key is read here — the function holds it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateAnswer, latinDigits, numbersIn, tokenizeNumbers } from '../supabase/functions/_shared/assistant/gate.ts';

const DB = path.resolve(import.meta.dirname, '..');
const CASES_PATH = path.join(DB, 'tests/assistant-eval/cases.json');
const FIXTURE_PATH = path.join(DB, 'tests/assistant-eval/fixture.sql');

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const FUNCTIONS_URL = (process.env.FUNCTIONS_URL ?? `${SUPABASE_URL}/functions/v1`).replace(/\/$/, '');
// Long-standing `supabase start` demo key (local only — no secret value).
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const OWNER_EMAIL = process.env.EVAL_OWNER_EMAIL ?? 'owner@dev.touch.local';
const OWNER_PASSWORD = process.env.EVAL_OWNER_PASSWORD ?? 'touch-dev-password';
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

const SHIP_GATE = 36;

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => flag(name)?.split('=')[1];
const ONLY = value('only');
const KIND = value('kind');
const JSON_OUT = value('json');
const KEEP_FIXTURE = Boolean(flag('keep-fixture'));
const NO_FIXTURE = Boolean(flag('no-fixture'));
const TIMEOUT_MS = Number(value('timeout') ?? 90_000);
/** Milliseconds to wait between questions — the free Groq tier meters 8k tokens a minute, so ~12000 keeps a run inside it. */
const PACE_MS = Number(value('pace') ?? 0);

// ── psql through the stack's container ────────────────────────────────────

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

function dockerReachable() {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}

/** The fixture's two sections, split on the `-- @section` markers. */
export function fixtureSections(text) {
  const cleanup = text.match(/^-- @section cleanup\s*\n([\s\S]*?)^-- @section plant/m)?.[1] ?? '';
  const plant = text.match(/^-- @section plant\s*\n([\s\S]*)$/m)?.[1] ?? '';
  return { cleanup, plant };
}

function applyFixture(sections, mode) {
  const body = mode === 'plant' ? sections.cleanup + '\n' + sections.plant : sections.cleanup;
  psql(`begin;\nset local session_replication_role = replica;\n${body}\ncommit;`);
}

// ── auth and the chat call ────────────────────────────────────────────────

async function signIn() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`owner sign-in failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.access_token;
}

/** Parse complete SSE frames from a buffer; returns events and the unparsed tail. */
export function parseSse(buffer) {
  const events = [];
  const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event = null;
    const data = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue; // heartbeat comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (event === null && data.length === 0) continue; // a comment-only frame is not an event
    event ??= 'message';
    let parsed = null;
    try {
      parsed = data.length ? JSON.parse(data.join('\n')) : null;
    } catch {
      parsed = data.join('\n');
    }
    events.push({ event, data: parsed });
  }
  return { events, rest };
}

/**
 * One question → the answer text, the tool names from `sources`, the `gate`
 * and `usage` payloads, or a `{ http, code, message }` refusal.
 */
async function ask(token, c) {
  const body = { conversation_id: null, text: c.question, lang: c.lang, scopes: c.scopes, range: c.range ?? null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${FUNCTIONS_URL}/assistant-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let json = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { message: text.slice(0, 300) };
      }
      return { refused: { http: res.status, code: json.code ?? json.error ?? `HTTP_${res.status}`, message: json.message ?? '' } };
    }
    const out = { text: '', tools: [], gate: null, usage: null, error: null, done: null, job: null, events: 0 };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      const { events, rest } = parseSse(buffer);
      buffer = rest;
      for (const ev of events) {
        out.events++;
        switch (ev.event) {
          case 'delta':
            if (ev.data?.reset) out.text = '';
            out.text += ev.data?.text ?? '';
            break;
          case 'sources':
            out.tools = (ev.data?.items ?? []).map((i) => i.name);
            out.sources = ev.data?.items ?? [];
            break;
          case 'gate':
            out.gate = ev.data; // the last one is the final verdict
            break;
          case 'usage':
            out.usage = ev.data;
            break;
          case 'job_estimate':
            out.job = ev.data;
            break;
          case 'error':
            out.error = ev.data;
            break;
          case 'done':
            out.done = ev.data;
            break;
          default:
            break;
        }
      }
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// ── scoring ───────────────────────────────────────────────────────────────

const ZERO_WORDS = /\b(none|zero|no\b|nothing)\b|لا يوجد|لا شيء|صفر|لا توجد|ولا/i;

/** The SQL truth appears in the text as a number token (any digit set, any separators). */
export function textHasNumber(text, expected) {
  const decimals = Number.isInteger(expected) ? 0 : 2;
  const tol = decimals === 0 ? 0.5 : 0.005;
  const hit = tokenizeNumbers(text).some((t) => Math.abs(t.value - expected) <= tol);
  if (hit) return true;
  if (expected === 0) return ZERO_WORDS.test(text);
  return false;
}

function containsAny(text, fragments) {
  const hay = latinDigits(text).toLowerCase();
  return (fragments ?? []).some((f) => hay.includes(latinDigits(f).toLowerCase()));
}

export function scoreCase(c, answer, truth) {
  const text = answer.text ?? '';
  const gateOk = answer.gate ? answer.gate.status === 'ok' : true; // no gate event = no figures were checked
  const toolHit = !c.expect.tools_any_of || c.expect.tools_any_of.some((t) => answer.tools.includes(t));
  let pass = false;
  let why = '';
  if (c.kind === 'numeric') {
    const found = truth !== null && textHasNumber(text, truth);
    pass = found && gateOk;
    why = !found ? `truth ${truth} not in answer` : !gateOk ? `gate ${answer.gate?.status}` : '';
  } else if (c.kind === 'where') {
    pass = containsAny(text, c.expect.contains_any);
    why = pass ? '' : `none of ${c.expect.contains_any.join(' | ')}`;
  } else {
    const actor = containsAny(text, c.expect.actor_any);
    const action = containsAny(text, c.expect.contains_any);
    pass = actor && action;
    why = !actor ? `actor ${c.expect.actor_any[0]} missing` : !action ? 'action fragment missing' : '';
  }
  if (pass && !toolHit) why = `passed without ${c.expect.tools_any_of.join('/')} (tools: ${answer.tools.join(',') || 'none'})`;
  // Local view of the gate against the SQL truth alone (numbers the owner
  // typed are allowed, like the function does).
  const local = c.kind === 'numeric' && truth !== null ? gateAnswer(text, [truth], numbersIn(c.question)) : null;
  return { pass, why, gateOk, toolHit, local };
}

function tokensOf(usage) {
  if (!usage) return null;
  return (usage.input ?? 0) + (usage.cache_write ?? 0) + (usage.cache_read ?? 0) + (usage.output ?? 0);
}

function median(nums) {
  const s = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function truthFor(c) {
  if (c.kind !== 'numeric' || !c.expect.sql) return null;
  const raw = psql(c.expect.sql);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${c.id}: sql returned ${JSON.stringify(raw)}`);
  return n;
}

// ── main ──────────────────────────────────────────────────────────────────

function exitState(reason) {
  console.log(`\nSTATE  ${reason}`);
  console.log('0/40 run — nothing to score.');
  process.exit(2);
}

async function main() {
  const file = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
  let cases = file.cases;
  if (KIND) cases = cases.filter((c) => c.kind === KIND);
  if (ONLY) cases = cases.filter((c) => c.id.includes(ONLY));
  const total = file.cases.length;

  if (!dockerReachable()) exitState(`docker container ${CONTAINER} is not reachable; the numeric truths run through it (is the local stack up?)`);

  const sections = fixtureSections(readFileSync(FIXTURE_PATH, 'utf8'));
  if (!NO_FIXTURE) applyFixture(sections, 'plant');

  let token;
  try {
    token = await signIn();
  } catch (e) {
    if (!NO_FIXTURE && !KEEP_FIXTURE) applyFixture(sections, 'cleanup');
    exitState(e.message);
  }

  console.log(`assistant-chat at ${FUNCTIONS_URL}; ${cases.length} of ${total} cases; owner ${OWNER_EMAIL}`);
  const results = [];
  const started = Date.now();
  // A state that ends the run (model not configured, quota): remembered here
  // and reported AFTER the fixture cleanup — process.exit inside the loop
  // would skip the finally block and leave the eval rows behind.
  let state = null;
  try {
    let first = true;
    for (const c of cases) {
      if (!first && PACE_MS > 0) await new Promise((r) => setTimeout(r, PACE_MS));
      first = false;
      const truth = truthFor(c);
      const t0 = Date.now();
      const answer = await ask(token, c);
      const ms = Date.now() - t0;
      if (answer.refused) {
        const { http, code, message } = answer.refused;
        if (http === 503 && code === 'NOT_CONFIGURED') {
          state = `model not configured — assistant-chat answered 503 NOT_CONFIGURED (${message || 'ANTHROPIC_API_KEY is not set'}). Set the key in supabase/functions/.env and serve the functions again.`;
          break;
        }
        if (http === 429) {
          state = `spend cap or daily quota reached — assistant-chat answered 429 ${code} (${message})`;
          break;
        }
        results.push({ id: c.id, kind: c.kind, lang: c.lang, pass: false, why: `${http} ${code} ${message}`.trim(), truth, tools: [], tokens: null, ms, text: '' });
        console.log(`  FAIL  ${c.id}  ${http} ${code}`);
        continue;
      }
      const score = scoreCase(c, answer, truth);
      const tokens = tokensOf(answer.usage);
      const row = {
        id: c.id, kind: c.kind, lang: c.lang, pass: score.pass, why: score.why, truth,
        gate: answer.gate?.status ?? null, gate_unverified: answer.gate?.unverified ?? [], local_unverified: score.local?.unverified ?? [],
        tools: answer.tools, tokens, cost_micros: answer.usage?.cost_micros ?? null, model: answer.usage?.model ?? null, ms,
        error: answer.error, job: answer.job ? { rows: answer.job.rows, chunks: answer.job.chunks } : null, text: answer.text,
      };
      results.push(row);
      const mark = score.pass ? 'PASS' : 'FAIL';
      console.log(`  ${mark}  ${c.id.padEnd(28)} gate=${(row.gate ?? '-').padEnd(10)} tokens=${String(tokens ?? '-').padStart(6)} ${ms} ms  ${score.why}`);
    }
  } finally {
    if (!NO_FIXTURE && !KEEP_FIXTURE) applyFixture(sections, 'cleanup');
  }
  if (state) exitState(state);

  // ── table and summary ───────────────────────────────────────────────────
  console.log('\nid                            kind     lang  result  gate        tokens  tools');
  for (const r of results) {
    console.log(
      `${r.id.padEnd(30)}${r.kind.padEnd(9)}${r.lang.padEnd(6)}${(r.pass ? 'pass' : 'FAIL').padEnd(8)}${String(r.gate ?? '-').padEnd(12)}${String(r.tokens ?? '-').padStart(6)}  ${r.tools.join(',') || '-'}`,
    );
  }
  const passed = results.filter((r) => r.pass).length;
  const numeric = results.filter((r) => r.kind === 'numeric');
  const unverified = numeric.filter((r) => r.gate === 'unverified').length;
  const med = median(results.map((r) => r.tokens));
  const cost = results.reduce((n, r) => n + (r.cost_micros ?? 0), 0);
  console.log(`\n${passed}/${total}, unverified figures on numeric: ${unverified}, median tokens per answer: ${med}`);
  console.log(`(${results.length} run, ${Math.round((Date.now() - started) / 1000)} s, ≈ $${(cost / 1e6).toFixed(3)} at the venue's price table)`);
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ ran_at: new Date().toISOString(), passed, total, unverified, median_tokens: med, results }, null, 2));
    console.log(`wrote ${JSON_OUT}`);
  }

  const partial = results.length < total;
  if (partial) console.log(`\nNOTE  a filtered run (${results.length}/${total}); the ship gate is judged on the full set.`);
  if (passed < SHIP_GATE || unverified > 0) {
    console.log(`\nFAIL  ship gate is ≥ ${SHIP_GATE}/${total} with zero unverified figures on the numeric set.`);
    process.exit(1);
  }
  console.log('\nPASS  ship gate met.');
}

// Run only as the entry file, so the parser and scorers above stay importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
