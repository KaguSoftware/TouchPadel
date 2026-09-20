/**
 * 0112 — the job state machine (plan §2.7, §6.4).
 *
 *   estimated → accepted → running → {reducing → done | over_estimate → running | failed | cancelled}
 *   estimated → cancelled, accepted → cancelled
 *
 * Every illegal move is INVALID_TRANSITION; the owner's cancel works from
 * any non-terminal state and nowhere else; the patch applies only known keys.
 */
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
