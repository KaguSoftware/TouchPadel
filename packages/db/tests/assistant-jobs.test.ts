/**
 * 0112 — the job state machine (plan §2.7, §6.4).
 *
 *   estimated → accepted → running → {reducing → done | over_estimate → running | failed | cancelled}
 *   estimated → cancelled, accepted → cancelled
 *
 * Every illegal move is INVALID_TRANSITION; the owner's cancel works from
 * any non-terminal state and nowhere else; the patch applies only known keys.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, appRpc, outcome, SEED_STAFF, SEED_STAFF_IDS } from './helpers';

const up = await stackAvailable();

interface Job {
  id: string; status: string; mode: string | null; chunks_total: number | null; chunks_done: number;
  tokens: Record<string, number>; result: unknown; error: string | null; batch_id: string | null;
  started_at: string | null; finished_at: string | null;
}

describe.skipIf(!up)('0112 assistant jobs', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let conversationId: string;
  const jobIds: string[] = [];

  const newJob = async (): Promise<string> => {
    const { data, error } = await svc
      .from('assistant_jobs')
      .insert({ conversation_id: conversationId, plan: { question: 'all payments', calls: [] }, estimate: { rows: 1200, chunks: 3 } })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    jobIds.push(id);
    return id;
  };
  const move = (id: string, status: string, patch?: Record<string, unknown>) =>
    svc.schema('app').rpc('assistant_job_transition', { p_id: id, p_status: status, p_patch: patch ?? null }).then(outcome);

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const { data, error } = await svc
      .from('assistant_conversations')
      .insert({ owner_id: SEED_STAFF_IDS.owner, title: 'jobs probe' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    conversationId = (data as { id: string }).id;
  });

  afterAll(async () => {
    await svc.from('assistant_conversations').delete().eq('id', conversationId); // cascades to jobs
    await owner.auth.signOut();
  });

  it('walks the happy path and stamps started_at / finished_at', async () => {
    const id = await newJob();

    const skip = await move(id, 'running');
    expect(skip.ok).toBe(false);
    expect(skip.errorMessage).toMatch(/INVALID_TRANSITION/);

    const accepted = await move(id, 'accepted', { mode: 'live', chunks_total: 3 });
    expect(accepted.ok, accepted.errorMessage).toBe(true);
    expect((accepted.data as Job).mode).toBe('live');
    expect((accepted.data as Job).chunks_total).toBe(3);

    const running = await move(id, 'running');
    expect(running.ok).toBe(true);
    expect((running.data as Job).started_at).not.toBeNull();
    const startedAt = (running.data as Job).started_at;

    const over = await move(id, 'over_estimate', { chunks_done: 2, tokens: { total: 9000 } });
    expect(over.ok).toBe(true);
    expect((over.data as Job).chunks_done).toBe(2);
    expect((over.data as Job).tokens).toEqual({ total: 9000 });

    const resumed = await move(id, 'running');
    expect(resumed.ok).toBe(true);
    expect((resumed.data as Job).started_at).toBe(startedAt); // first start is kept

    const reducing = await move(id, 'reducing', { chunks_done: 3 });
    expect(reducing.ok).toBe(true);

    const done = await move(id, 'done', { result: { answer: 42 } });
    expect(done.ok).toBe(true);
    expect((done.data as Job).finished_at).not.toBeNull();
    expect((done.data as Job).result).toEqual({ answer: 42 });

    for (const s of ['running', 'accepted', 'cancelled', 'done']) {
      const again = await move(id, s);
      expect(again.ok, `done -> ${s}`).toBe(false);
      expect(again.errorMessage).toMatch(/INVALID_TRANSITION/);
    }
  });

  it('running may fail; failed is terminal', async () => {
    const id = await newJob();
    expect((await move(id, 'accepted')).ok).toBe(true);
    expect((await move(id, 'running')).ok).toBe(true);
    const failed = await move(id, 'failed', { error: 'provider timeout' });
    expect(failed.ok).toBe(true);
    expect((failed.data as Job).error).toBe('provider timeout');
    expect((failed.data as Job).finished_at).not.toBeNull();
    const again = await move(id, 'running');
    expect(again.ok).toBe(false);
    expect(again.errorMessage).toMatch(/INVALID_TRANSITION/);
  });

  it('refuses an unknown patch key, an unknown status and an unknown job', async () => {
    const id = await newJob();
    const badKey = await move(id, 'accepted', { plan: {} });
    expect(badKey.ok).toBe(false);
    expect(badKey.errorMessage).toMatch(/INVALID_ARGUMENT/);

    const badStatus = await move(id, 'paused');
    expect(badStatus.ok).toBe(false);
    expect(badStatus.errorMessage).toMatch(/INVALID_TRANSITION/);

    const missing = await move('00000000-0000-4000-8000-000000000000', 'accepted');
    expect(missing.ok).toBe(false);
    expect(missing.errorMessage).toMatch(/JOB_NOT_FOUND/);
  });

  it('the owner cancels from estimated, accepted, running and over_estimate — never from a terminal state', async () => {
    for (const path of [[], ['accepted'], ['accepted', 'running'], ['accepted', 'running', 'over_estimate']]) {
      const id = await newJob();
      for (const s of path) expect((await move(id, s)).ok, s).toBe(true);
      const res = await appRpc(owner, 'assistant_job_cancel', { p_id: id }).then(outcome);
      expect(res.ok, `${path.join('>') || 'estimated'}: ${res.errorMessage}`).toBe(true);
      expect((res.data as Job).status).toBe('cancelled');
      expect((res.data as Job).finished_at).not.toBeNull();

      const twice = await appRpc(owner, 'assistant_job_cancel', { p_id: id }).then(outcome);
      expect(twice.ok).toBe(false);
      expect(twice.errorMessage).toMatch(/INVALID_TRANSITION/);
    }
  });

  it('cancel is owner-only; transition is service-role only', async () => {
    const id = await newJob();
    const manager = await signedInClient(SEED_STAFF.manager);
    const denied = await appRpc(manager, 'assistant_job_cancel', { p_id: id }).then(outcome);
    expect(denied.ok).toBe(false);
    expect(denied.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();

    const res = await appRpc(owner, 'assistant_job_transition', { p_id: id, p_status: 'accepted' }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/permission denied|not find the function|PGRST202/i);

    // The owner reads the row under RLS.
    const { data, error } = await owner.from('assistant_jobs').select('status').eq('id', id).single();
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('estimated');
  });
});

// ---------------------------------------------------------------------------
// Stackless: every patch assistant-job hands app.assistant_job_transition stays
// inside the function's allowlist. Until 2026-10-01 the accept path passed
// `started_at` and done/failed passed `finished_at`; the allowlist (0112)
// refuses any other key with INVALID_ARGUMENT, so an accepted job stuck in
// 'accepted' and a finished one never landed. The SQL stamps both columns
// itself. This reads the source, so the class of bug cannot come back.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../supabase/migrations');
const JOB_INDEX = resolve(HERE, '../supabase/functions/assistant-job/index.ts');

/** The keys the LATEST body of app.assistant_job_transition admits. */
function transitionAllowlist(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let latest: string | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    const at = sql.search(/function\s+app\.assistant_job_transition\s*\(/);
    if (at >= 0) latest = sql.slice(at);
  }
  if (!latest) throw new Error('no migration defines app.assistant_job_transition');
  const m = latest.match(/k\s+not\s+in\s*\(([^)]*)\)/i);
  if (!m) throw new Error('app.assistant_job_transition has no `k not in (...)` allowlist');
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

/** Index of the bracket that closes the one at `open`, skipping strings and comments. */
function closeOf(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"' || c === '`') {
      i = stringEnd(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) return -1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stringEnd(src: string, start: number): number {
  const q = src[start];
  for (let j = start + 1; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
      j = closeOf(src, j + 1);
      continue;
    }
    if (src[j] === q) return j;
  }
  return src.length;
}

/** Split on the commas at depth 0. */
function topLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === "'" || c === '"' || c === '`') {
      i = stringEnd(inner, i);
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(inner.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(inner.slice(from));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Every `.transition(id, 'status', { ... })` call: its status and its patch's top-level keys. */
function transitionCalls(src: string): Array<{ status: string; keys: string[] }> {
  const out: Array<{ status: string; keys: string[] }> = [];
  for (const m of src.matchAll(/\.transition\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = closeOf(src, open);
    if (close < 0) throw new Error(`unclosed .transition( at ${m.index}`);
    const args = topLevel(src.slice(open + 1, close));
    const status = args[1]?.match(/^'([a-z_]+)'$/)?.[1];
    if (!status) throw new Error(`.transition( at ${m.index} does not name its status as a literal: ${args[1]}`);
    const patch = args[2];
    let keys: string[] = [];
    if (patch !== undefined) {
      if (!patch.startsWith('{') || !patch.endsWith('}')) throw new Error(`.transition(… '${status}', …) passes a non-literal patch: ${patch}`);
      keys = topLevel(patch.slice(1, -1)).map((entry) => {
        if (entry.startsWith('...')) throw new Error(`.transition(… '${status}', …) spreads into its patch: ${entry}`);
        const key = entry.match(/^['"]?([A-Za-z_$][\w$]*)['"]?\s*(?::|$)/)?.[1];
        if (!key) throw new Error(`cannot read a key in the '${status}' patch: ${entry}`);
        return key;
      });
    }
    out.push({ status, keys });
  }
  return out;
}

describe('assistant-job: transition patches stay inside the 0112 allowlist (stackless)', () => {
  const src = readFileSync(JOB_INDEX, 'utf8');
  const allow = transitionAllowlist();

  it('parses the allowlist from the migration', () => {
    expect(allow).toEqual(['mode', 'chunks_total', 'chunks_done', 'tokens', 'result', 'error', 'batch_id', 'estimate', 'message_id']);
  });

  it('finds every transition call, each with a literal status', () => {
    const calls = transitionCalls(src);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(new Set(calls.map((c) => c.status))).toEqual(new Set(['accepted', 'running', 'reducing', 'done', 'failed', 'over_estimate']));
  });

  it('passes only allowlisted keys (started_at and finished_at are the SQL’s to stamp)', () => {
    const offenders = transitionCalls(src).flatMap((c) =>
      c.keys.filter((k) => !allow.includes(k)).map((k) => `'${c.status}' patch passes ${k}`),
    );
    expect(offenders).toEqual([]);
  });

  it('reaches the RPC only through Book.transition', () => {
    expect(src.match(/rpc\(\s*'assistant_job_transition'/g)).toHaveLength(1);
  });

  it('the parser catches the bug it guards against', () => {
    const bad = `await book.transition(job.id, 'running', { started_at: new Date().toISOString(), chunks_total: n });`;
    expect(transitionCalls(bad)[0]).toEqual({ status: 'running', keys: ['started_at', 'chunks_total'] });
    expect(() => transitionCalls(`x.transition(id, 'done', { ...rest })`)).toThrow(/spreads/);
    expect(() => transitionCalls(`x.transition(id, 'done', patch)`)).toThrow(/non-literal/);
  });
});

// ---------------------------------------------------------------------------
// Stackless: the cheaper-jobs pass (2026-10-08). Chunk extraction runs on
// JOB_EXTRACT_MODEL (live and batch) and the reduce on the job's model, so
// every price, usage record and assistant_calls row must name the model of
// THAT call; `this.provider.model` in the bookkeeping would bill Sonnet calls
// at Opus rates (or the other way round). Reads the source, like the block above.
// ---------------------------------------------------------------------------

describe('assistant-job: every call is priced and recorded at its own model (stackless)', () => {
  const src = readFileSync(JOB_INDEX, 'utf8');
  const body = (name: string) => {
    const at = src.search(new RegExp(`\\n  async ${name}\\(`));
    expect(at, `Book.${name} not found`).toBeGreaterThan(0);
    // the body opens at the end of the signature line (a return type may hold braces of its own)
    return src.slice(at, closeOf(src, src.indexOf(' {\n', at) + 1) + 1);
  };

  it('price, record and account take the model as an argument and never read this.provider.model', () => {
    for (const fn of ['price', 'record', 'account']) {
      const b = body(fn);
      expect(b, fn).toMatch(/model: string\)/);
      expect(b, fn).not.toMatch(/this\.provider\.model/);
    }
    expect(body('price')).toMatch(/p_model: model/);
    expect(body('record')).toMatch(/p_model: model/);
  });

  it('chunk calls go through the extraction provider and are accounted at its model; the reduce at the job model', () => {
    expect(src).toMatch(/book\.extract\.stream\(/);
    expect(src).toMatch(/book\.extract\.batchCreate\(/);
    expect(src).not.toMatch(/provider\.stream\([\s\S]{0,400}buildChunkExtractPrompt/);
    expect(src).toMatch(/turn\.stop_reason, book\.extract\.model\)/);
    expect(src).toMatch(/r\.stop_reason, jb\.extract\.model\)/);
    expect(body('reduce')).toMatch(/turn\.stop_reason, this\.provider\.model\)/);
    expect(src).toMatch(/providerFromEnv\(\(n\) => Deno\.env\.get\(n\), JOB_EXTRACT_MODEL\)/);
  });

  it('live extraction runs through the bounded pool, and the tick reduces on the job model', () => {
    expect(src).toMatch(/runPool\(\{[\s\S]*concurrency: JOB_LIVE_CONCURRENCY/);
    expect(src).toMatch(/await jb\.reduce\(/);
    expect(src).not.toMatch(/await book\.reduce\(job, objects, spend, calls, null/);
  });

  // Review 2026-10-08: the launch cutoff equalled the request's abort, so a
  // wall-clock stop aborted every chunk in flight (generic TIMEOUT error, the
  // objects lost, no time for the reduce); and four begin()s could pass on one
  // month-to-date figure. The clock and the cap now live in pool.ts.
  it('live launches stop at liveClock().launchBy, chunks stream on a signal cut at extractBy, and the cap counts calls in flight', () => {
    const live = src.slice(src.indexOf('async function runLive('), src.indexOf('async function submitBatch('));
    expect(live).toMatch(/const clock = liveClock\(started, WALL_MS\)/);
    expect(live).toMatch(/Date\.now\(\) >= clock\.launchBy \? 'wall'/);
    expect(live).not.toMatch(/Date\.now\(\) - started > WALL_MS/);
    expect(live).toMatch(/setTimeout\(\(\) => cut\.abort\(\), [^)]*clock\.extractBy/);
    expect(live).toMatch(/book\.extract\.stream\(\{[\s\S]*?signal: extractSignal,/);
    expect(live).toMatch(/if \(extractSignal\.aborted\) return null;/);
    expect(live).toMatch(/budgetAllows\(reading, /);
    expect(live).toMatch(/const reading = await book\.begin\(\);/);
    expect(live).toMatch(/if \(overBudget\) throw new Error\('LLM_MONTHLY_CAP'\)/);
    // the reduce keeps the request's own signal (it has the reduce budget left)
    expect(live).toMatch(/book\.reduce\(job, objects, spend, calls, handles, signal\)/);
  });
});
