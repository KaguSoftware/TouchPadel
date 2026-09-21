/**
 * 0110 — the assistant's text layer: chunks, hybrid search, the index queue
 * and the freshness triggers (plan §2.4, §2.5).
 *
 *   * a page chunk planted in English and one in Arabic each come back for a
 *     query in their language with p_embedding null (full text only — the
 *     degraded mode every stack without an embedding provider runs in);
 *   * p_kinds filters; a query that matches nothing returns [];
 *   * inserting, editing and deleting a customer note enqueues (note, id, op)
 *     — and when the queue table is missing the note is still written,
 *     because the trigger swallows its own failure;
 *   * claim / fail / done behave like the push outbox lease;
 *   * chunk_source projects the row and answers null for a deleted one.
 *
 * The queue-table rename is DDL, so it goes through the container like the
 * check scripts do; that case skips itself without docker.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, appRpc, outcome, SEED_STAFF, SEED_STAFF_IDS } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
const REF = '/assistant-search-test/day-close';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

interface Hit { id: number; kind: string; ref: string; lang: string; title: string; snippet: string; route: string; score: number }

describe.skipIf(!up)('0110 assistant search and index queue', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let profileId: string;

  const upsert = (p: Record<string, unknown>) => svc.schema('app').rpc('assistant_upsert_chunk', { p }).then(outcome);
  const search = (q: string, kinds: string[] | null = null) =>
    appRpc(owner, 'assistant_search', { p_query: q, p_embedding: null, p_kinds: kinds, p_limit: 10 }).then(outcome);

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const { data } = await svc.from('profiles').select('id').is('deleted_at', null).limit(1);
    profileId = (data?.[0] as { id: string }).id;

    expect((await upsert({
      kind: 'page', ref: REF, lang: 'en', title: 'Day close',
      body: 'Close the trading day: count the drawer against the expected cash, record the card terminal batch, sign off.',
      route: '/admin/day-close', source_updated_at: new Date().toISOString(),
    })).ok).toBe(true);
    expect((await upsert({
      kind: 'page', ref: REF, lang: 'ar', title: 'إغلاق اليوم',
      body: 'أغلق يوم التداول: عدّ الدرج مقابل النقد المتوقع، سجّل دفعة جهاز البطاقات، ثم وقّع.',
      route: '/admin/day-close',
    })).ok).toBe(true);
  });

  afterAll(async () => {
    await svc.schema('app').rpc('assistant_delete_chunk', { p_kind: 'page', p_ref: REF });
    await svc.from('customer_notes').delete().like('body', 'assistant-search-test%');
    await svc.from('assistant_index_queue').delete().eq('kind', 'note').eq('ref', 'search-test-manual');
    await owner.auth.signOut();
  });

  // ── search ────────────────────────────────────────────────────────────────

  it('finds the English chunk for an English query with no embedding', async () => {
    const res = await search('count the drawer');
    expect(res.ok, res.errorMessage).toBe(true);
    const hits = res.data as Hit[];
    const hit = hits.find((h) => h.ref === REF && h.lang === 'en');
    expect(hit, JSON.stringify(hits)).toBeDefined();
    expect(hit!.route).toBe('/admin/day-close');
    expect(hit!.snippet.length).toBeLessThanOrEqual(300);
    expect(hit!.score).toBeGreaterThan(0);
  });

  it('finds the Arabic chunk for an Arabic query', async () => {
    const res = await search('عدّ الدرج');
    expect(res.ok, res.errorMessage).toBe(true);
    const hits = res.data as Hit[];
    expect(hits.some((h) => h.ref === REF && h.lang === 'ar')).toBe(true);
  });

  it('filters by kind and returns [] for nothing', async () => {
    const wrongKind = await search('count the drawer', ['rpc']);
    expect(wrongKind.ok).toBe(true);
    expect((wrongKind.data as Hit[]).some((h) => h.ref === REF)).toBe(false);

    const rightKind = await search('count the drawer', ['page', 'nav']);
    expect((rightKind.data as Hit[]).some((h) => h.ref === REF)).toBe(true);

    const nothing = await search('zqxjv-nonexistent-token-77');
    expect(nothing.ok).toBe(true);
    expect(nothing.data).toEqual([]);

    const empty = await appRpc(owner, 'assistant_search', { p_query: '', p_embedding: null }).then(outcome);
    expect(empty.ok).toBe(true);
    expect(empty.data).toEqual([]);
  });

  it('upsert rewrites in place (one row per kind, ref, lang)', async () => {
    const again = await upsert({ kind: 'page', ref: REF, lang: 'en', title: 'Day close (edited)', body: 'Close the day: count the drawer.' });
    expect(again.ok).toBe(true);
    const { data } = await svc.from('assistant_chunks').select('id, title').eq('kind', 'page').eq('ref', REF).eq('lang', 'en');
    expect(data).toHaveLength(1);
    expect((data![0] as { title: string }).title).toBe('Day close (edited)');
  });

  it('refuses a chunk without kind/ref/lang/body', async () => {
    const res = await upsert({ kind: 'page', ref: REF });
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/INVALID_ARGUMENT/);
  });

  // ── the queue and the triggers ────────────────────────────────────────────

  it('a customer note insert, edit and delete each enqueue (note, id, op)', async () => {
    const { data: note, error } = await svc
      .from('customer_notes')
      .insert({ customer_id: profileId, body: 'assistant-search-test note body', author_id: SEED_STAFF_IDS.owner })
      .select('id')
      .single();
    expect(error).toBeNull();
    const id = (note as { id: string }).id;

    const rows = async () =>
      (await svc.from('assistant_index_queue').select('op').eq('kind', 'note').eq('ref', id).order('id')).data as { op: string }[];
    expect((await rows()).map((r) => r.op)).toEqual(['upsert']);

    await svc.from('customer_notes').update({ body: 'assistant-search-test note edited' }).eq('id', id);
    expect((await rows()).map((r) => r.op)).toEqual(['upsert', 'upsert']);

    // chunk_source projects the row: body, names, no secrets
    const src = await svc.schema('app').rpc('assistant_chunk_source', { p_kind: 'note', p_ref: id }).then(outcome);
    expect(src.ok, src.errorMessage).toBe(true);
    const s = src.data as Record<string, unknown>;
    expect(s.kind).toBe('note');
    expect(s.body).toBe('assistant-search-test note edited');
    expect(s.author_name).toBe('Dev Owner');
    expect(s).not.toHaveProperty('author_id');

    await svc.from('customer_notes').delete().eq('id', id);
    expect((await rows()).map((r) => r.op)).toEqual(['upsert', 'upsert', 'delete']);

    const gone = await svc.schema('app').rpc('assistant_chunk_source', { p_kind: 'note', p_ref: id }).then(outcome);
    expect(gone.ok).toBe(true);
    expect(gone.data).toBeNull();

    // done removes what the indexer handled
    const ids = (await svc.from('assistant_index_queue').select('id').eq('ref', id)).data!.map((r) => (r as { id: number }).id);
    const done = await svc.schema('app').rpc('assistant_index_done', { p_ids: ids }).then(outcome);
    expect(done.ok).toBe(true);
    expect(done.data).toBe(3);
    expect(await rows()).toHaveLength(0);
  });

  it('claim leases for 60 s, fail releases the lease and keeps the row', async () => {
    const { data: q } = await svc
      .from('assistant_index_queue')
      .insert({ kind: 'note', ref: 'search-test-manual', op: 'upsert' })
      .select('id')
      .single();
    const qid = (q as { id: number }).id;

    const claim = await svc.schema('app').rpc('claim_due_index', { p_limit: 500 }).then(outcome);
    expect(claim.ok, claim.errorMessage).toBe(true);
    const mine = (claim.data as { id: number; attempts: number; claimed_at: string }[]).find((r) => r.id === qid);
    expect(mine).toBeDefined();
    expect(mine!.attempts).toBe(1);
    expect(mine!.claimed_at).not.toBeNull();

    // Claimed a moment ago: a second claim skips it.
    const again = await svc.schema('app').rpc('claim_due_index', { p_limit: 500 }).then(outcome);
    expect((again.data as { id: number }[]).some((r) => r.id === qid)).toBe(false);

    const fail = await svc.schema('app').rpc('assistant_index_fail', { p_id: qid, p_error: 'embedding provider down' }).then(outcome);
    expect(fail.ok).toBe(true);
    const { data: row } = await svc.from('assistant_index_queue').select('claimed_at, last_error, attempts').eq('id', qid).single();
    expect((row as { claimed_at: string | null }).claimed_at).toBeNull();
    expect((row as { last_error: string }).last_error).toBe('embedding provider down');

    const third = await svc.schema('app').rpc('claim_due_index', { p_limit: 500 }).then(outcome);
    expect((third.data as { id: number }[]).some((r) => r.id === qid)).toBe(true);

    await svc.schema('app').rpc('assistant_index_done', { p_ids: [qid] });
  });

  it('the owner cannot claim, upsert or delete chunks; the guest cannot search', async () => {
    for (const [fn, args] of [
      ['claim_due_index', { p_limit: 1 }],
      ['assistant_upsert_chunk', { p: { kind: 'page', ref: 'x', lang: 'en', body: 'x' } }],
      ['assistant_delete_chunk', { p_kind: 'page', p_ref: REF }],
      ['assistant_index_done', { p_ids: [] }],
    ] as const) {
      const res = await appRpc(owner, fn, args as Record<string, unknown>).then(outcome);
      expect(res.ok, fn).toBe(false);
      expect(res.errorMessage, fn).toMatch(/permission denied|not find the function|PGRST202/i);
    }
    const manager = await signedInClient(SEED_STAFF.manager);
    const res = await appRpc(manager, 'assistant_search', { p_query: 'drawer', p_embedding: null }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();
  });

  describe.skipIf(!docker)('the trigger never fails the parent write (needs docker)', () => {
    it('a note is still written while the queue table is missing', async () => {
      psql('alter table public.assistant_index_queue rename to assistant_index_queue_hidden;');
      try {
        const { data, error } = await svc
          .from('customer_notes')
          .insert({ customer_id: profileId, body: 'assistant-search-test without queue', author_id: SEED_STAFF_IDS.owner })
          .select('id')
          .single();
        expect(error, 'the business write must survive a missing queue').toBeNull();
        expect(data).not.toBeNull();
      } finally {
        psql('alter table public.assistant_index_queue_hidden rename to assistant_index_queue;');
      }
    });
  });
});
