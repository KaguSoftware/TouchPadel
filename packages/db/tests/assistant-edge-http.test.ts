/**
 * The three assistant edge functions over HTTP, against the locally served
 * runtime (`supabase functions serve`; the CI db job serves them). Every case
 * here stops BEFORE a model call, so it runs the same with or without
 * ANTHROPIC_API_KEY / GROQ_API_KEY in the runtime's env and never spends:
 *
 *   * assistant-chat: the refusals come before the paid quota
 *     (app.llm_begin_request, which bumps llm_usage.requests) and before any
 *     write — no session 401, a non-owner 403, an unpriced model 400, an
 *     unknown conversation 404 NOT_FOUND, another account's conversation 403,
 *     and (only when the runtime has no key) NOT_CONFIGURED 503; the model
 *     check comes before the conversation check; a malformed venue_scope is
 *     400 on the main path AND the re-check path; the re-check over HTTP
 *     (400, 404, 403 on another's message) spends and writes nothing;
 *   * assistant-job: a missing or malformed job_id is 400 INVALID_REQUEST, an
 *     unknown job 404, another's job 403, a non-owner 403, a tick without the
 *     service role 403; cancel moves an estimated job to cancelled, a second
 *     cancel is INVALID_TRANSITION, and accepting a job that is no longer
 *     estimated is 409 INVALID_TRANSITION with or without a model key
 *     (the state check answers before the provider check), job unmoved;
 *   * assistant-free: no session 401, a non-staff session 403, a staff
 *     session with a malformed body 400.
 *
 * Skipped (visibly) when the stack is down or the edge runtime is not serving
 * (the same readiness rule as ci.yml: `replay` answers 401). What this file
 * cannot reach without a model — a streamed turn, assistant-job's live and
 * batch runs, assistant-free's stream and its 429s — is listed in the
 * assistant test-coverage report, not faked here: the runtime's env is fixed
 * when `functions serve` starts, so no test can point it at a fake vendor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ANON_KEY, SEED_STAFF, SEED_STAFF_IDS, SUPABASE_URL, anonymousSessionClient, serviceClient, signedInClient, stackAvailable } from './helpers';

const up = await stackAvailable();

/** The edge runtime is serving: ci.yml's readiness rule (replay answers 401 without a session). */
async function edgeRuntimeServes(): Promise<boolean> {
  if (!up) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/replay`, { method: 'POST', signal: AbortSignal.timeout(5_000) });
    await res.text();
    return res.status === 401;
  } catch {
    return false;
  }
}
const served = await edgeRuntimeServes();

const fn = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;
const NIL = 'ffffffff-0000-4000-8000-00000000dead';

async function tokenOf(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error('no session');
  return t;
}

async function post(name: string, token: string | null, body: unknown, method = 'POST'): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: ANON_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(fn(name), {
    method,
    headers,
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

describe.skipIf(!served)('assistant edge functions over HTTP (served runtime)', () => {
  let svc: SupabaseClient;
  let owner: string;
  let manager: string;
  let cashier: string;
  /** True when the runtime can build a provider (ANTHROPIC_API_KEY set): the dry run then measures a start size. */
  let providerConfigured = false;
  const conversations: string[] = [];

  /** Every request the paid quota has counted, all days. */
  const quotaRequests = async (): Promise<number> => {
    const { data, error } = await svc.from('llm_usage').select('requests');
    if (error) throw new Error(error.message);
    return ((data ?? []) as { requests: number }[]).reduce((n, r) => n + Number(r.requests ?? 0), 0);
  };
  const conversationCount = async (): Promise<number> => {
    const { count, error } = await svc.from('assistant_conversations').select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const plantConversation = async (ownerId: string): Promise<string> => {
    const { data, error } = await svc.from('assistant_conversations').insert({ owner_id: ownerId, title: 'edge http probe', scopes: ['money', 'howto'] }).select('id').single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    conversations.push(id);
    return id;
  };
  const plantMessage = async (conversationId: string, seq: number, role: 'user' | 'assistant'): Promise<string> => {
    const { data, error } = await svc
      .from('assistant_messages')
      .insert({
        conversation_id: conversationId,
        seq,
        role,
        content: [{ type: 'text', text: role === 'user' ? 'How much revenue this week?' : 'Revenue was 4,250,000 IQD.' }],
        sources: role === 'assistant' ? [{ call_id: 't1', name: 'report_revenue', args: { from: '2026-11-01', to: '2026-11-07' }, row_count: 1, ms: 1, route: null, stats: null }] : [],
        gate: role === 'assistant' ? { status: 'ok', unverified: [], checked: 1, numbers: [4_250_000] } : null,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  };
  const plantJob = async (conversationId: string, status = 'estimated'): Promise<string> => {
    const estimate = {
      rows: 10, chunks: 1, per_tool: [{ tool: 'bookings_list', rows: 10, chunk_rows: 250, tokens_per_row: 25, measured: false }],
      tokens: { input: 1, cache_read: 0, output: 1, total: 2 }, tokens_high: { input: 1, cache_read: 0, output: 1, total: 2 },
      modes: { aggregate: null, live: { allowed: true }, batch: { allowed: true } }, assumptions: [], first_chunk_exact: null,
    };
    const { data, error } = await svc
      .from('assistant_jobs')
      .insert({ conversation_id: conversationId, status, plan: { question: 'edge http probe', calls: [{ tool: 'bookings_list', args: { from: '2026-11-01', to: '2026-11-07' } }] }, estimate, chunks_total: 1 })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  };
  const jobStatus = async (id: string): Promise<string> => {
    const { data, error } = await svc.from('assistant_jobs').select('status').eq('id', id).single();
    if (error) throw new Error(error.message);
    return (data as { status: string }).status;
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await tokenOf(await signedInClient(SEED_STAFF.owner));
    manager = await tokenOf(await signedInClient(SEED_STAFF.manager));
    cashier = await tokenOf(await signedInClient(SEED_STAFF.cashier));
    // The dry run (no model, no quota, no write) answers start: null when the runtime has no key.
    const dry = await post('assistant-chat', owner, { conversation_id: null, text: '', lang: 'en', scopes: ['howto'], dry_run: true });
    if (dry.status !== 200) throw new Error(`assistant-chat dry run answered ${dry.status}: ${JSON.stringify(dry.json)}`);
    providerConfigured = dry.json.start !== null;
  });

  afterAll(async () => {
    if (conversations.length) await svc.from('assistant_conversations').delete().in('id', conversations); // cascades to messages and jobs
  });

  // ── assistant-chat ────────────────────────────────────────────────────────
  describe('assistant-chat: every refusal before the paid quota and before any write', () => {
    const turn = (extra: Record<string, unknown> = {}) => ({ conversation_id: null, text: 'How much revenue did we make this week?', lang: 'en', ...extra });

    it('no session is 401 AUTH_REQUIRED; a GET is 405', async () => {
      const r = await post('assistant-chat', null, turn());
      expect(r.status).toBe(401);
      expect(r.json.error).toBe('AUTH_REQUIRED');
      const g = await post('assistant-chat', owner, null, 'GET');
      expect(g.status).toBe(405);
    });

    it('a manager is refused 403 FORBIDDEN: no quota debited, no conversation created', async () => {
      const [q0, c0] = [await quotaRequests(), await conversationCount()];
      const r = await post('assistant-chat', manager, turn());
      expect(r.status).toBe(403);
      expect(r.json.error).toBe('FORBIDDEN');
      expect(await quotaRequests()).toBe(q0);
      expect(await conversationCount()).toBe(c0);
    });

    it('an unknown conversation is 404 NOT_FOUND with its code, before the quota', async () => {
      const q0 = await quotaRequests();
      const r = await post('assistant-chat', owner, turn({ conversation_id: NIL }));
      expect(r).toEqual({ status: 404, json: { error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'conversation not found' } });
      expect(await quotaRequests()).toBe(q0);
    });

    it('another account\'s conversation is 403 FORBIDDEN, before the quota, and nothing is written into it', async () => {
      const theirs = await plantConversation(SEED_STAFF_IDS.manager);
      const q0 = await quotaRequests();
      const r = await post('assistant-chat', owner, turn({ conversation_id: theirs }));
      expect(r).toEqual({ status: 403, json: { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your conversation' } });
      expect(await quotaRequests()).toBe(q0);
      const { count } = await svc.from('assistant_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', theirs);
      expect(count).toBe(0);
    });

    it('an unpriced model is 400 ASSISTANT_MODEL_NOT_PRICED, checked before the conversation and before the quota', async () => {
      const theirs = await plantConversation(SEED_STAFF_IDS.manager);
      const [q0, c0] = [await quotaRequests(), await conversationCount()];
      const r = await post('assistant-chat', owner, turn({ model: 'claude-unpriced-0-1', conversation_id: theirs }));
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ error: 'ASSISTANT_MODEL_NOT_PRICED', code: 'ASSISTANT_MODEL_NOT_PRICED' });
      expect(await quotaRequests()).toBe(q0);
      expect(await conversationCount()).toBe(c0);
    });

    it('a malformed body is 400 INVALID_REQUEST with its code: bad JSON, no text, a bad conversation id', async () => {
      for (const body of ['{not json', turn({ text: '   ' }), turn({ conversation_id: 'chat-1' })]) {
        const r = await post('assistant-chat', owner, body);
        expect(r.status, JSON.stringify(body)).toBe(400);
        expect(r.json, JSON.stringify(body)).toMatchObject({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST' });
      }
    });

    it('a malformed venue_scope is 400 on the main path and on the re-check path alike', async () => {
      const main = await post('assistant-chat', owner, turn({ venue_scope: 'branch-a' }));
      expect(main).toEqual({ status: 400, json: { error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'venue_scope must be a uuid' } });
      const recheck = await post('assistant-chat', owner, { recheck: { message_id: NIL }, venue_scope: 'branch-a' });
      expect(recheck).toEqual({ status: 400, json: { error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'venue_scope must be a uuid' } });
    });

    it('the re-check over HTTP: a malformed id 400, an unknown one 404, another account\'s answer 403; no quota, no write', async () => {
      const theirs = await plantConversation(SEED_STAFF_IDS.manager);
      await plantMessage(theirs, 1, 'user');
      const answer = await plantMessage(theirs, 2, 'assistant');
      const q0 = await quotaRequests();
      const bad = await post('assistant-chat', owner, { recheck: { message_id: 'm1' } });
      expect(bad).toEqual({ status: 400, json: { error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'recheck.message_id must be a uuid' } });
      const unknown = await post('assistant-chat', owner, { recheck: { message_id: NIL } });
      expect(unknown).toEqual({ status: 404, json: { error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'assistant message not found' } });
      const other = await post('assistant-chat', owner, { recheck: { message_id: answer } });
      expect(other).toEqual({ status: 403, json: { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your conversation' } });
      expect(await quotaRequests()).toBe(q0);
      const { count } = await svc.from('assistant_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', theirs);
      expect(count).toBe(2);
    });

    it('the re-check of the owner\'s own answer runs its tools as the owner: 200 with the diff, no quota debited', async () => {
      const mine = await plantConversation(SEED_STAFF_IDS.owner);
      await plantMessage(mine, 1, 'user');
      const answer = await plantMessage(mine, 2, 'assistant');
      const q0 = await quotaRequests();
      const r = await post('assistant-chat', owner, { recheck: { message_id: answer } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json).toMatchObject({ message_id: answer, baseline: true });
      const tools = r.json.tools as { name: string; error?: string }[];
      expect(tools.map((t) => t.name)).toEqual(['report_revenue']);
      expect(tools[0]!.error, tools[0]!.error).toBeUndefined();
      expect(await quotaRequests()).toBe(q0);
    });

    it('with no model key in the runtime, a valid turn is 503 NOT_CONFIGURED before the quota and before any write', async (ctx) => {
      if (providerConfigured) ctx.skip(); // with a key this request would start a paid turn
      const [q0, c0] = [await quotaRequests(), await conversationCount()];
      const r = await post('assistant-chat', owner, turn());
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED' });
      expect(await quotaRequests()).toBe(q0);
      expect(await conversationCount()).toBe(c0);
    });
  });

  // ── assistant-job ─────────────────────────────────────────────────────────
  describe('assistant-job: refusals and the state machine without a model', () => {
    it('a missing or malformed job_id is 400 INVALID_REQUEST; an unknown action too', async () => {
      const missing = await post('assistant-job', owner, { action: 'accept', mode: 'live' });
      expect(missing).toEqual({ status: 400, json: { error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'job_id is required' } });
      const malformed = await post('assistant-job', owner, { action: 'accept', job_id: 'job-1', mode: 'live' });
      expect(malformed).toEqual({ status: 400, json: { error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'job_id must be a uuid' } });
      const action = await post('assistant-job', owner, { action: 'run', job_id: NIL });
      expect(action.status).toBe(400);
      expect(action.json.code).toBe('INVALID_REQUEST');
    });

    it('an unknown job is 404 NOT_FOUND; a manager 403; a tick without the service role 403', async () => {
      const unknown = await post('assistant-job', owner, { action: 'accept', job_id: NIL, mode: 'live' });
      expect(unknown).toEqual({ status: 404, json: { error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'job not found' } });
      const mgr = await post('assistant-job', manager, { action: 'cancel', job_id: NIL });
      expect(mgr.status).toBe(403);
      expect(mgr.json.error).toBe('FORBIDDEN');
      const tick = await post('assistant-job', owner, { action: 'tick' });
      expect(tick).toEqual({ status: 403, json: { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'tick is for the service role' } });
    });

    it('a job in another account\'s conversation is 403 and does not move', async () => {
      const theirs = await plantConversation(SEED_STAFF_IDS.manager);
      const job = await plantJob(theirs);
      const r = await post('assistant-job', owner, { action: 'cancel', job_id: job });
      expect(r).toEqual({ status: 403, json: { error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your job' } });
      expect(await jobStatus(job)).toBe('estimated');
    });

    it('cancel moves an estimated job to cancelled; a second cancel is INVALID_TRANSITION', async () => {
      const mine = await plantConversation(SEED_STAFF_IDS.owner);
      const job = await plantJob(mine);
      const first = await post('assistant-job', owner, { action: 'cancel', job_id: job });
      expect(first).toEqual({ status: 200, json: { job_id: job, status: 'cancelled' } });
      expect(await jobStatus(job)).toBe('cancelled');
      const again = await post('assistant-job', owner, { action: 'cancel', job_id: job });
      expect(again.status).toBe(400);
      expect(again.json.error).toBe('INVALID_TRANSITION');
    });

    it('accepting a job that is no longer estimated is 409 INVALID_TRANSITION, with or without a model key; the job does not move', async () => {
      const mine = await plantConversation(SEED_STAFF_IDS.owner);
      for (const status of ['cancelled', 'running']) {
        const job = await plantJob(mine, status);
        const r = await post('assistant-job', owner, { action: 'accept', job_id: job, mode: 'live' });
        // The state check answers before the provider check (review 2026-11-09),
        // so the 409 is the same on a runtime with no ANTHROPIC_API_KEY.
        expect(r, status).toEqual({ status: 409, json: { error: 'INVALID_TRANSITION', code: 'INVALID_TRANSITION', message: `job is ${status}` } });
        expect(await jobStatus(job)).toBe(status);
      }
    });
  });

  // ── assistant-free ────────────────────────────────────────────────────────
  describe('assistant-free: staff only, and the body checked before the key', () => {
    it('no session is 401; a signed-in guest who is not staff is 403 FORBIDDEN', async () => {
      const none = await post('assistant-free', null, { text: 'Where do I close a tab?', lang: 'en', app: 'operator' });
      expect(none.status).toBe(401);
      expect(none.json.error).toBe('AUTH_REQUIRED');
      const guest = await anonymousSessionClient();
      const r = await post('assistant-free', await tokenOf(guest), { text: 'Where do I close a tab?', lang: 'en', app: 'operator' });
      expect(r.status).toBe(403);
      expect(r.json.error).toBe('FORBIDDEN');
      await guest.auth.signOut();
    });

    it('a staff member with a malformed body is 400 INVALID_REQUEST with its code; the free tier never touches the paid quota', async () => {
      const q0 = await quotaRequests();
      for (const body of ['{oops', { text: '', lang: 'en', app: 'operator' }, { text: 'hi', lang: 'en', app: 'fridge' }]) {
        const r = await post('assistant-free', cashier, body);
        expect(r.status, JSON.stringify(body)).toBe(400);
        expect(r.json, JSON.stringify(body)).toMatchObject({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST' });
      }
      expect(await quotaRequests()).toBe(q0);
    });
  });
});
