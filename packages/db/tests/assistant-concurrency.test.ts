/**
 * 0405 — assistant concurrency (review 2026-11-09).
 *
 *   * app.assistant_conversation_persist adds a turn's delta to the chat's
 *     tokens IN SQL on the locked row: concurrent turns of one chat all land
 *     (assistant-chat used to write prev + delta and lost one); title only
 *     while the row has none, context only when given, other keys kept;
 *   * app.assistant_job_claim_tick hands each eligible batch job (running,
 *     batch, batch_id set: 0113's predicate) to exactly one tick, skips a live
 *     claim, re-claims a lapsed one and never returns another job; the edge's
 *     release (matched on the stamp) clears only its own claim;
 *   * both are service-role only.
 *
 * The client UPDATE revoke (part A) is proven by tests/assistant-rls.test.ts
 * and the rls-matrix rule `update assistant_conversations`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, appRpc, outcome, SEED_STAFF, SEED_STAFF_IDS } from './helpers';

const up = await stackAvailable();
const NIL = '00000000-0000-4000-8000-000000000000';

type Claim = { job_id: string; claimed_until: string };

describe.skipIf(!up)('0405 assistant concurrency', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  const conversationIds: string[] = [];

  const newConversation = async (fields: Record<string, unknown> = {}): Promise<string> => {
    const { data, error } = await svc
      .from('assistant_conversations')
      .insert({ owner_id: SEED_STAFF_IDS.owner, title: null, ...fields })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    conversationIds.push(id);
    return id;
  };

  const persist = (c: SupabaseClient, args: Record<string, unknown>) =>
    c.schema('app').rpc('assistant_conversation_persist', args).then(outcome);

  const claim = async (c: SupabaseClient, seconds?: number): Promise<Claim[]> => {
    const { data, error } = await c.schema('app').rpc('assistant_job_claim_tick', seconds === undefined ? {} : { p_seconds: seconds });
    if (error) throw new Error(error.message);
    return (data ?? []) as Claim[];
  };

  const newJob = async (conversationId: string, fields: Record<string, unknown>): Promise<string> => {
    const { data, error } = await svc
      .from('assistant_jobs')
      .insert({ conversation_id: conversationId, plan: { question: 'claim probe', calls: [] }, estimate: { rows: 1 }, ...fields })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  };

  const runningBatch = (conversationId: string, extra: Record<string, unknown> = {}) =>
    newJob(conversationId, { status: 'running', mode: 'batch', batch_id: `msgbatch_0405_${Math.random().toString(36).slice(2)}`, ...extra });

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
  });

  afterAll(async () => {
    if (conversationIds.length) await svc.from('assistant_conversations').delete().in('id', conversationIds); // cascades to jobs
    await owner.auth.signOut();
  });

  // ── B. the atomic persist ────────────────────────────────────────────────

  it('two concurrent persists of one chat both land: tokens are the sum of both deltas', async () => {
    const id = await newConversation({ tokens: { input: 5, cost_micros: 100, legacy_note: 'kept' } });
    const a = serviceClient();
    const b = serviceClient();
    const deltaA = { input: 1000, cache_write: 10, cache_read: 300, output: 200, cost_micros: 4500, calls: 2, web_searches: 1 };
    const deltaB = { input: 70, cache_write: 0, cache_read: 30, output: 25, cost_micros: 999, calls: 1, web_searches: 0 };
    const [ra, rb] = await Promise.all([
      persist(a, { p_conversation_id: id, p_handles: { r1: NIL, _next: { r: 2 } }, p_usage: deltaA }),
      persist(b, { p_conversation_id: id, p_handles: { c1: NIL, _next: { c: 2 } }, p_usage: deltaB }),
    ]);
    expect(ra.ok, ra.errorMessage).toBe(true);
    expect(rb.ok, rb.errorMessage).toBe(true);

    const { data } = await svc.from('assistant_conversations').select('tokens').eq('id', id).single();
    expect((data as { tokens: Record<string, unknown> }).tokens).toEqual({
      input: 5 + 1000 + 70,
      cache_write: 10,
      cache_read: 330,
      output: 225,
      cost_micros: 100 + 4500 + 999,
      calls: 3,
      web_searches: 1,
      legacy_note: 'kept',
    });
  });

  it('many concurrent persists of one chat lose nothing', async () => {
    const id = await newConversation();
    const clients = Array.from({ length: 4 }, () => serviceClient());
    const n = 12;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        persist(clients[i % clients.length]!, {
          p_conversation_id: id,
          p_handles: { _next: {} },
          p_usage: { input: i + 1, output: 2, cost_micros: 10, calls: 1 },
        }),
      ),
    );
    for (const r of results) expect(r.ok, r.errorMessage).toBe(true);
    const { data } = await svc.from('assistant_conversations').select('tokens').eq('id', id).single();
    const tokens = (data as { tokens: Record<string, number> }).tokens;
    expect(tokens.input).toBe((n * (n + 1)) / 2);
    expect(tokens.output).toBe(2 * n);
    expect(tokens.cost_micros).toBe(10 * n);
    expect(tokens.calls).toBe(n);
    expect(tokens.web_searches).toBe(0);
  });

  it('sets handles always, title only while the chat has none, context only when given', async () => {
    const id = await newConversation({ title: '' });
    const first = await persist(svc, {
      p_conversation_id: id, p_handles: { r1: NIL, _next: { r: 2 } }, p_usage: { calls: 1 },
      p_title: 'first question', p_context: { v: 1, text: 'frozen' },
    });
    expect(first.ok, first.errorMessage).toBe(true);
    expect((first.data as Record<string, number>).calls).toBe(1);

    const second = await persist(svc, {
      p_conversation_id: id, p_handles: { r1: NIL, r2: NIL, _next: { r: 3 } }, p_usage: { calls: 1 },
      p_title: 'a later question', p_context: null,
    });
    expect(second.ok, second.errorMessage).toBe(true);

    const { data } = await svc.from('assistant_conversations').select('title, context, handles, tokens, updated_at').eq('id', id).single();
    const row = data as { title: string; context: unknown; handles: Record<string, unknown>; tokens: Record<string, number> };
    expect(row.title).toBe('first question'); // '' counted as none, then kept
    expect(row.context).toEqual({ v: 1, text: 'frozen' }); // a null p_context keeps it
    expect(row.handles).toEqual({ r1: NIL, r2: NIL, _next: { r: 3 } }); // the turn's whole table
    expect(row.tokens.calls).toBe(2);
  });

  it('refuses bad arguments with INVALID_ARGUMENT and an unknown chat with CONVERSATION_NOT_FOUND', async () => {
    const id = await newConversation();
    for (const [args, detail] of [
      [{ p_conversation_id: null, p_handles: {}, p_usage: {} }, 'p_conversation_id'],
      [{ p_conversation_id: id, p_handles: null, p_usage: {} }, 'p_handles'],
      [{ p_conversation_id: id, p_handles: [], p_usage: {} }, 'p_handles'],
      [{ p_conversation_id: id, p_handles: {}, p_usage: 5 }, 'p_usage'],
      [{ p_conversation_id: id, p_handles: {}, p_usage: { input: -1 } }, 'p_usage.input'],
      [{ p_conversation_id: id, p_handles: {}, p_usage: { output: 'lots' } }, 'p_usage.output'],
      [{ p_conversation_id: id, p_handles: {}, p_usage: {}, p_context: 'text' }, 'p_context'],
    ] as const) {
      const { error } = await svc.schema('app').rpc('assistant_conversation_persist', args);
      expect(error?.message, JSON.stringify(args)).toMatch(/INVALID_ARGUMENT/);
      expect(error?.details, JSON.stringify(args)).toBe(detail);
    }
    const missing = await persist(svc, { p_conversation_id: NIL, p_handles: {}, p_usage: {} });
    expect(missing.ok).toBe(false);
    expect(missing.errorMessage).toMatch(/CONVERSATION_NOT_FOUND/);
    // Nothing was written by the refusals.
    const { data } = await svc.from('assistant_conversations').select('tokens').eq('id', id).single();
    expect((data as { tokens: unknown }).tokens).toEqual({});
  });

  // ── C. the tick claim ────────────────────────────────────────────────────

  it('two concurrent claims over the same eligible jobs: each job goes to exactly one tick', async () => {
    const conv = await newConversation();
    const mine = await Promise.all(Array.from({ length: 8 }, () => runningBatch(conv)));
    const [c1, c2] = await Promise.all([claim(serviceClient()), claim(serviceClient())]);
    for (const id of mine) {
      const hits = [...c1, ...c2].filter((c) => c.job_id === id).length;
      expect(hits, `job ${id} claimed ${hits} times`).toBe(1);
    }
    // A third tick inside the claim gets none of them.
    const c3 = await claim(svc);
    expect(c3.filter((c) => mine.includes(c.job_id))).toEqual([]);

    const { data } = await svc.from('assistant_jobs').select('id, tick_claimed_until').in('id', mine);
    for (const row of (data ?? []) as { id: string; tick_claimed_until: string | null }[]) {
      expect(row.tick_claimed_until, row.id).not.toBeNull();
      expect(Date.parse(row.tick_claimed_until!)).toBeGreaterThan(Date.now() + 60_000); // default 120 s
    }
  });

  it('a lapsed claim is claimed again; a live one is not', async () => {
    const conv = await newConversation();
    const lapsed = await runningBatch(conv, { tick_claimed_until: new Date(Date.now() - 1000).toISOString() });
    const live = await runningBatch(conv, { tick_claimed_until: new Date(Date.now() + 600_000).toISOString() });
    const got = (await claim(svc, 30)).map((c) => c.job_id);
    expect(got).toContain(lapsed);
    expect(got).not.toContain(live);
    const { data } = await svc.from('assistant_jobs').select('tick_claimed_until').eq('id', lapsed).single();
    const until = Date.parse((data as { tick_claimed_until: string }).tick_claimed_until);
    expect(until).toBeGreaterThan(Date.now() + 10_000);
    expect(until).toBeLessThan(Date.now() + 60_000); // p_seconds = 30
  });

  it('never returns a job that is not a running batch with a batch id', async () => {
    const conv = await newConversation();
    const others = await Promise.all([
      newJob(conv, { status: 'estimated' }),
      newJob(conv, { status: 'running', mode: 'live' }),
      newJob(conv, { status: 'running', mode: 'batch', batch_id: null }),
      newJob(conv, { status: 'reducing', mode: 'batch', batch_id: 'msgbatch_0405_reducing' }),
      newJob(conv, { status: 'over_estimate', mode: 'batch', batch_id: 'msgbatch_0405_over' }),
      newJob(conv, { status: 'done', mode: 'batch', batch_id: 'msgbatch_0405_done' }),
      newJob(conv, { status: 'cancelled', mode: 'batch', batch_id: 'msgbatch_0405_cancelled' }),
    ]);
    const got = (await claim(svc)).map((c) => c.job_id);
    expect(got.filter((id) => others.includes(id))).toEqual([]);
    const { data } = await svc.from('assistant_jobs').select('tick_claimed_until').in('id', others);
    for (const row of (data ?? []) as { tick_claimed_until: string | null }[]) expect(row.tick_claimed_until).toBeNull();
  });

  it("the edge's release clears only its own claim (matched on the returned stamp)", async () => {
    const conv = await newConversation();
    const id = await runningBatch(conv);
    const got = (await claim(svc)).find((c) => c.job_id === id);
    expect(got).toBeDefined();

    // A stale stamp (another tick's) leaves the claim in place.
    const stale = await svc.from('assistant_jobs').update({ tick_claimed_until: null }).eq('id', id).eq('tick_claimed_until', new Date(Date.now() - 5000).toISOString());
    expect(stale.error).toBeNull();
    const { data: still } = await svc.from('assistant_jobs').select('tick_claimed_until').eq('id', id).single();
    expect((still as { tick_claimed_until: string | null }).tick_claimed_until).not.toBeNull();

    // The same filter assistant-job's releaseClaim sends, with the stamp the claim returned.
    const own = await svc.from('assistant_jobs').update({ tick_claimed_until: null }).eq('id', id).eq('tick_claimed_until', got!.claimed_until).select('id');
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect((await claim(svc)).map((c) => c.job_id)).toContain(id); // the next tick polls it again
  });

  it('refuses p_seconds out of range', async () => {
    for (const s of [0, -5, 901]) {
      const { error } = await svc.schema('app').rpc('assistant_job_claim_tick', { p_seconds: s });
      expect(error?.message, String(s)).toMatch(/INVALID_ARGUMENT/);
    }
  });

  // ── both service-role only ──────────────────────────────────────────────

  it('neither function is reachable by the owner', async () => {
    const id = await newConversation();
    for (const [fn, args] of [
      ['assistant_conversation_persist', { p_conversation_id: id, p_handles: {}, p_usage: { input: 1 } }],
      ['assistant_job_claim_tick', { p_seconds: 60 }],
    ] as const) {
      const res = await appRpc(owner, fn, args as Record<string, unknown>).then(outcome);
      expect(res.ok, `${fn} must not be callable by the owner`).toBe(false);
      expect(res.errorMessage, fn).toMatch(/permission denied|not find the function|PGRST202/i);
    }
    const { data } = await svc.from('assistant_conversations').select('tokens').eq('id', id).single();
    expect((data as { tokens: unknown }).tokens).toEqual({});
  });
});
