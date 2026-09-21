/**
 * 0108–0112 — who may touch the assistant's tables and RPCs.
 *
 * Owner-only, by decision 5. Guest (anonymous session), cashier and manager
 * see RLS silence on the four tables and FORBIDDEN from every granted RPC;
 * the owner reads, inserts a conversation, archives it, sets scopes, and may
 * call each granted function. Messages and calls have no update/delete grant
 * for anyone; jobs are written by the service role only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
} from './helpers';

const up = await stackAvailable();
const NIL = '00000000-0000-4000-8000-000000000000';
const TABLES = ['assistant_conversations', 'assistant_messages', 'assistant_calls', 'assistant_jobs'] as const;

/** Every function 0108–0112 grants to authenticated, with owner-safe arguments. */
const GRANTED: { name: string; args: Record<string, unknown>; ownerOk: RegExp | null }[] = [
  { name: 'assistant_archive_conversation', args: { p_id: NIL }, ownerOk: /CONVERSATION_NOT_FOUND/ },
  { name: 'assistant_set_scopes', args: { p_id: NIL, p_scopes: ['howto'] }, ownerOk: /CONVERSATION_NOT_FOUND/ },
  { name: 'assistant_run_tool', args: { p_tool: 'list_staff', p_args: {} }, ownerOk: null },
  { name: 'assistant_count', args: { p_tool: 'list_staff', p_args: {} }, ownerOk: null },
  { name: 'assistant_search', args: { p_query: 'day close', p_embedding: null, p_kinds: null, p_limit: 3 }, ownerOk: null },
  { name: 'llm_price_micros', args: { p_model: 'claude-opus-5', p_input: 1, p_cache_write: 0, p_cache_read: 0, p_output: 0 }, ownerOk: null },
  { name: 'assistant_usage', args: {}, ownerOk: null },
  { name: 'assistant_job_cancel', args: { p_id: NIL }, ownerOk: /JOB_NOT_FOUND/ },
];

describe.skipIf(!up)('assistant tables and RPCs are owner-only', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let guest: SupabaseClient;
  let conversationId: string;
  let jobId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    guest = await anonymousSessionClient();

    // Plant one of everything under the service role so "silence" is provable.
    const { data: conv, error: cErr } = await svc
      .from('assistant_conversations')
      .insert({ owner_id: SEED_STAFF_IDS.owner, title: 'rls probe', scopes: ['howto'] })
      .select('id')
      .single();
    if (cErr) throw new Error(cErr.message);
    conversationId = (conv as { id: string }).id;

    const { data: msg, error: mErr } = await svc
      .from('assistant_messages')
      .insert({ conversation_id: conversationId, seq: 1, role: 'user', content: [{ type: 'text', text: 'hi' }] })
      .select('id')
      .single();
    if (mErr) throw new Error(mErr.message);
    const messageId = (msg as { id: string }).id;

    const { error: kErr } = await svc
      .from('assistant_calls')
      .insert({ message_id: messageId, call_no: 1, model: 'claude-opus-5', input_tokens: 10, output_tokens: 5 });
    if (kErr) throw new Error(kErr.message);

    const { data: job, error: jErr } = await svc
      .from('assistant_jobs')
      .insert({ conversation_id: conversationId, message_id: messageId, plan: { question: 'q', calls: [] }, estimate: { rows: 0 } })
      .select('id')
      .single();
    if (jErr) throw new Error(jErr.message);
    jobId = (job as { id: string }).id;
  });

  afterAll(async () => {
    await svc.from('assistant_conversations').delete().eq('id', conversationId); // cascades
    await svc.from('assistant_conversations').delete().eq('title', 'rls owner insert');
    await Promise.all([owner, manager, cashier, guest].map((c) => c.auth.signOut()));
  });

  // ── tables ────────────────────────────────────────────────────────────────

  for (const table of TABLES) {
    it(`${table}: guest, cashier and manager get RLS silence; the owner sees rows`, async () => {
      for (const [who, c] of [['guest', guest], ['cashier', cashier], ['manager', manager]] as const) {
        const { data, error } = await c.from(table).select('id');
        expect(error, `${who} ${table}`).toBeNull();
        expect(data ?? [], `${who} ${table} should be empty`).toHaveLength(0);
      }
      const { data, error } = await owner.from(table).select('id');
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  }

  it('the manager cannot insert a conversation; the owner can, for their own account only', async () => {
    const { error: mErr } = await manager
      .from('assistant_conversations')
      .insert({ owner_id: SEED_STAFF_IDS.manager, title: 'rls manager insert' });
    expect(mErr).not.toBeNull();

    const { error: forgedErr } = await owner
      .from('assistant_conversations')
      .insert({ owner_id: SEED_STAFF_IDS.manager, title: 'rls forged owner' });
    expect(forgedErr, 'owner_id must be the caller').not.toBeNull();

    const { data, error } = await owner
      .from('assistant_conversations')
      .insert({ owner_id: SEED_STAFF_IDS.owner, title: 'rls owner insert' })
      .select('id, scopes')
      .single();
    expect(error).toBeNull();
    expect((data as { scopes: string[] }).scopes).toEqual(['howto']);
  });

  it("the owner may update a conversation's scopes directly but not delete it", async () => {
    const { error: uErr } = await owner
      .from('assistant_conversations')
      .update({ scopes: ['howto', 'money'] })
      .eq('id', conversationId);
    expect(uErr).toBeNull();
    const { error: dErr, count } = await owner
      .from('assistant_conversations')
      .delete({ count: 'exact' })
      .eq('id', conversationId);
    // No delete grant: PostgREST answers permission denied.
    expect(dErr !== null || count === 0).toBe(true);
    const { data } = await svc.from('assistant_conversations').select('id').eq('id', conversationId);
    expect(data).toHaveLength(1);
  });

  it('messages and calls cannot be updated or deleted by the owner; jobs cannot be inserted', async () => {
    const { error: mErr } = await owner.from('assistant_messages').update({ seq: 99 }).eq('conversation_id', conversationId);
    expect(mErr).not.toBeNull();
    const { error: kErr } = await owner.from('assistant_calls').delete().gt('id', 0);
    expect(kErr).not.toBeNull();
    const { error: jErr } = await owner
      .from('assistant_jobs')
      .insert({ conversation_id: conversationId, plan: {}, estimate: {} });
    expect(jErr).not.toBeNull();
  });

  it('app.assistant_readable_columns is readable by the owner and silent for the manager', async () => {
    const { data: ownerRows, error } = await owner.schema('app').from('assistant_readable_columns').select('table_name').limit(5);
    expect(error).toBeNull();
    expect((ownerRows ?? []).length).toBeGreaterThan(0);
    const { data: mgrRows, error: mErr } = await manager.schema('app').from('assistant_readable_columns').select('table_name').limit(5);
    expect(mErr).toBeNull();
    expect(mgrRows ?? []).toHaveLength(0);
  });

  // ── granted RPCs ──────────────────────────────────────────────────────────

  for (const fn of GRANTED) {
    it(`app.${fn.name}: guest, cashier and manager get FORBIDDEN; the owner passes the guard`, async () => {
      for (const [who, c] of [['guest', guest], ['cashier', cashier], ['manager', manager]] as const) {
        const res = await appRpc(c, fn.name, fn.args).then(outcome);
        expect(res.ok, `${who} must not pass ${fn.name}`).toBe(false);
        expect(res.errorMessage, `${who} ${fn.name}`).toMatch(/FORBIDDEN/);
      }
      const res = await appRpc(owner, fn.name, fn.args).then(outcome);
      if (fn.ownerOk) {
        expect(res.ok).toBe(false);
        expect(res.errorMessage).toMatch(fn.ownerOk);
      } else {
        expect(res.ok, res.errorMessage).toBe(true);
      }
    });
  }

  it('assistant_set_scopes validates scopes and returns the row; archive stamps archived_at', async () => {
    const bad = await appRpc(owner, 'assistant_set_scopes', { p_id: conversationId, p_scopes: ['money', 'everything'] }).then(outcome);
    expect(bad.ok).toBe(false);
    expect(bad.errorMessage).toMatch(/ASSISTANT_UNKNOWN_SCOPE/);

    const badRange = await appRpc(owner, 'assistant_set_scopes', {
      p_id: conversationId, p_scopes: ['money'], p_range: { from: '2026-09-10', to: '2026-09-01' },
    }).then(outcome);
    expect(badRange.ok).toBe(false);
    expect(badRange.errorMessage).toMatch(/INVALID_RANGE/);

    const ok = await appRpc(owner, 'assistant_set_scopes', {
      p_id: conversationId, p_scopes: ['money', 'cafe', 'money'], p_range: { from: '2026-09-01', to: '2026-09-10' },
    }).then(outcome);
    expect(ok.ok, ok.errorMessage).toBe(true);
    const row = ok.data as { id: string; scopes: string[]; range: { from: string } };
    expect(row.id).toBe(conversationId);
    expect(row.scopes).toEqual(['cafe', 'money']);
    expect(row.range.from).toBe('2026-09-01');

    const arch = await appRpc(owner, 'assistant_archive_conversation', { p_id: conversationId }).then(outcome);
    expect(arch.ok, arch.errorMessage).toBe(true);
    expect((arch.data as { archived_at: string | null }).archived_at).not.toBeNull();
  });

  it('the service-only functions are not reachable by the owner', async () => {
    for (const [fn, args] of [
      ['assistant_job_transition', { p_id: jobId, p_status: 'accepted' }],
      ['claim_due_index', { p_limit: 1 }],
      ['assistant_upsert_chunk', { p: {} }],
      ['assistant_chunk_source', { p_kind: 'note', p_ref: NIL }],
      ['llm_record_usage', { p_model: 'x', p_input: 1, p_cache_write: 0, p_cache_read: 0, p_output: 0, p_model_calls: 1 }],
      ['assistant_bookings_list', { p_from: '2026-09-01', p_to: '2026-09-02' }],
      ['assistant_table_read', { p_table: 'courts' }],
    ] as const) {
      const res = await appRpc(owner, fn, args as Record<string, unknown>).then(outcome);
      expect(res.ok, `${fn} must not be callable by the owner directly`).toBe(false);
      expect(res.errorMessage, fn).toMatch(/permission denied|not find the function|PGRST202/i);
    }
  });
});
