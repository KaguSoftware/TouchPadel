/**
 * 0422 assistant_feedback: the owner's thumbs up or down on one answer.
 *
 * Part 1, ONE rolled-back psql transaction (tests/psql-scenario.ts), nothing
 * survives it:
 *   * app.assistant_rate_message's guards in order: FORBIDDEN for every
 *     non-owner (manager, cashier, dev); ASSISTANT_MESSAGE_NOT_FOUND for a
 *     missing id AND for another owner's answer (its id is not confirmed);
 *     ASSISTANT_NOT_RATEABLE for a question, a failed turn (tokens.error_code)
 *     and a job's answer (sources[].job_id); INVALID_ARGUMENT for a rating
 *     other than -1, 0, 1 (detail p_rating) and a note over 280 characters
 *     (detail p_note);
 *   * up, down, toggle and clear (0 deletes; clearing twice is fine); the note
 *     goes through app.safe_line, is kept only with -1, and a blank one is null;
 *   * RLS: each owner reads only the rows they rated, a manager reads none;
 *     a client INSERT, UPDATE or DELETE is refused (42501: no write grant);
 *   * deleting the message deletes its rating (on delete cascade).
 * Part 2, the PostgREST embed the clients use on their message select,
 * `feedback:assistant_feedback(rating,note)`: an object for a rated answer,
 * null for an unrated one (one-to-one, the FK is the primary key). It needs
 * PostgREST, so it plants committed rows under the service role and deletes
 * them in afterAll.
 *
 * Both parts need migration 0422 applied (CI applies it); they skip when the
 * stack is down.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appRpc, SEED_STAFF, SEED_STAFF_IDS, serviceClient, signedInClient, stackAvailable } from './helpers';
import { docker, FX, LET, MK, Q, scenario, T, type Results } from './psql-scenario';

const up = await stackAvailable();

const LONG = 'x'.repeat(281);
const MAX = 'y'.repeat(280);

const PLANT = [
  MK('owner2', 'owner', null),
  MK('dev1', 'dev', null),
  LET('c1', `insert into assistant_conversations (owner_id, title) values ({{owner}}::uuid, 'fb probe') returning id`),
  LET('c2', `insert into assistant_conversations (owner_id, title) values ({{owner2}}::uuid, 'fb probe 2') returning id`),
  LET('q1', `insert into assistant_messages (conversation_id, seq, role, content) values ({{c1}}::uuid, 1, 'user', '[{"type":"text","text":"q"}]') returning id`),
  LET('a1', `insert into assistant_messages (conversation_id, seq, role, content, tokens) values ({{c1}}::uuid, 2, 'assistant', '[{"type":"text","text":"a"}]', '{"stop_reason":"end_turn"}') returning id`),
  LET('af', `insert into assistant_messages (conversation_id, seq, role, content, tokens) values ({{c1}}::uuid, 3, 'assistant', '[{"type":"text","text":""}]', '{"stop_reason":"UPSTREAM","error_code":"UPSTREAM"}') returning id`),
  LET('aj', `insert into assistant_messages (conversation_id, seq, role, content, sources) values ({{c1}}::uuid, 4, 'assistant', '[{"type":"text","text":"job"}]', '[{"job_id":"cccccccc-0000-4000-8000-000000000003","chunks":2}]') returning id`),
  LET('as', `insert into assistant_messages (conversation_id, seq, role, content, tokens) values ({{c1}}::uuid, 5, 'assistant', '[{"type":"text","text":"half"}]', '{"stop_reason":"stopped"}') returning id`),
  LET('a2', `insert into assistant_messages (conversation_id, seq, role, content) values ({{c2}}::uuid, 1, 'assistant', '[{"type":"text","text":"b"}]') returning id`),
];

const rate = (msg: string, rating: string, note = 'null') => `select app.assistant_rate_message({{${msg}}}::uuid, ${rating}, ${note})`;
const row = (label: string, msg: string) =>
  Q(label, `select to_jsonb(f) - 'created_at' - 'updated_at' from assistant_feedback f where f.message_id = {{${msg}}}::uuid`);

const CALLS = [
  // Guards, in order.
  T('forbid_manager', 'manager', rate('a1', '1')),
  T('forbid_cashier', 'cashier', rate('a1', '1')),
  T('forbid_dev', 'dev1', rate('a1', '1')),
  T('nf_missing', 'owner', `select app.assistant_rate_message(gen_random_uuid(), 1, null)`),
  T('nf_other', 'owner', rate('a2', '1')),
  T('nf_other_bad_rating', 'owner', rate('a2', '7')),
  T('nr_question', 'owner', rate('q1', '1')),
  T('nr_failed', 'owner', rate('af', '-1')),
  T('nr_job', 'owner', rate('aj', '1')),
  T('bad_rating', 'owner', rate('a1', '2')),
  T('null_rating', 'owner', rate('a1', 'null')),
  // Up with a note: the note is dropped.
  T('up', 'owner', rate('a1', '1', `'great'`)),
  row('row_up', 'a1'),
  // Down with a messy note: one line, controls and bidi marks gone.
  T('down', 'owner', rate('a1', '-1', `E'  the figure\\n is \\u200Bwrong  '`)),
  row('row_down', 'a1'),
  // Toggle back up: the note goes.
  T('toggle', 'owner', rate('a1', '1')),
  row('row_toggle', 'a1'),
  T('long', 'owner', rate('a1', '-1', `'${LONG}'`)),
  T('max', 'owner', rate('a1', '-1', `'${MAX}'`)),
  T('blank', 'owner', rate('as', '-1', `'   '`)),
  row('row_blank', 'as'),
  // A stopped answer is rateable.
  T('stopped_ok', 'owner', rate('as', '1')),
  T('clear', 'owner', rate('as', '0')),
  row('row_cleared', 'as'),
  T('clear_again', 'owner', rate('as', '0')),
  // owner2 rates their own answer.
  T('owner2_up', 'owner2', rate('a2', '-1', `'off by one'`)),
  // RLS: who reads what.
  T('rls_owner', 'owner', `select coalesce(jsonb_agg(message_id), '[]') from assistant_feedback where message_id in ({{a1}}::uuid, {{a2}}::uuid)`),
  T('rls_owner2', 'owner2', `select coalesce(jsonb_agg(message_id), '[]') from assistant_feedback where message_id in ({{a1}}::uuid, {{a2}}::uuid)`),
  T('rls_manager', 'manager', `select to_jsonb(count(*)) from assistant_feedback`),
  T('rls_dev', 'dev1', `select to_jsonb(count(*)) from assistant_feedback`),
  // Client writes: no grant.
  T('w_insert', 'owner', `insert into assistant_feedback (message_id, rated_by, rating) values ({{as}}::uuid, {{owner}}::uuid, 1) returning to_jsonb(message_id)`),
  T('w_update', 'owner', `with u as (update assistant_feedback set rating = -1 where message_id = {{a1}}::uuid returning 1) select to_jsonb(count(*)) from u`),
  T('w_delete', 'owner', `with d as (delete from assistant_feedback where message_id = {{a1}}::uuid returning 1) select to_jsonb(count(*)) from d`),
  row('row_after_writes', 'a1'),
  // Cascade.
  FX(`delete from assistant_messages where id = {{a1}}::uuid`),
  Q('after_cascade', `select to_jsonb(count(*)) from assistant_feedback where message_id = {{a1}}::uuid`),
  Q('ids', `select jsonb_object_agg(name, val) from pg_temp.vars`),
];

function fails(r: Results, label: string, code: string, detail?: string) {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} should fail with ${code}, got ${JSON.stringify(o!.data)}`).toBe(false);
  expect(o!.code, label).toBe(code);
  if (detail !== undefined) expect(o!.detail, label).toBe(detail);
}
function ok(r: Results, label: string): unknown {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''}`).toBe(true);
  return o!.data;
}

describe.skipIf(!up || !docker)('0422 app.assistant_rate_message and assistant_feedback (rolled back)', () => {
  let r: Results = {};
  let ids: Record<string, string> = {};

  beforeAll(() => {
    r = scenario([...PLANT, ...CALLS]);
    ids = ok(r, 'ids') as Record<string, string>;
  });

  it('FORBIDDEN for anyone but the owner, before anything is read', () => {
    fails(r, 'forbid_manager', 'FORBIDDEN');
    fails(r, 'forbid_cashier', 'FORBIDDEN');
    fails(r, 'forbid_dev', 'FORBIDDEN');
  });

  it("a missing message and another owner's answer are both ASSISTANT_MESSAGE_NOT_FOUND (even with a bad rating)", () => {
    fails(r, 'nf_missing', 'ASSISTANT_MESSAGE_NOT_FOUND');
    fails(r, 'nf_other', 'ASSISTANT_MESSAGE_NOT_FOUND');
    fails(r, 'nf_other_bad_rating', 'ASSISTANT_MESSAGE_NOT_FOUND');
  });

  it('a question, a failed turn and a job answer are ASSISTANT_NOT_RATEABLE; a stopped answer is rateable', () => {
    fails(r, 'nr_question', 'ASSISTANT_NOT_RATEABLE');
    fails(r, 'nr_failed', 'ASSISTANT_NOT_RATEABLE');
    fails(r, 'nr_job', 'ASSISTANT_NOT_RATEABLE');
    expect(ok(r, 'stopped_ok')).toEqual({ messageId: ids.as, rating: 1, note: null });
  });

  it('a rating other than -1, 0 or 1 is INVALID_ARGUMENT detail p_rating', () => {
    fails(r, 'bad_rating', 'INVALID_ARGUMENT', 'p_rating');
    fails(r, 'null_rating', 'INVALID_ARGUMENT', 'p_rating');
  });

  it('up drops the note; down keeps it as one clean line; toggling back up drops it again', () => {
    expect(ok(r, 'up')).toEqual({ messageId: ids.a1, rating: 1, note: null });
    expect(ok(r, 'row_up')).toEqual({ message_id: ids.a1, rated_by: ids.owner, rating: 1, note: null });
    expect(ok(r, 'down')).toEqual({ messageId: ids.a1, rating: -1, note: 'the figure is wrong' });
    expect(ok(r, 'row_down')).toEqual({ message_id: ids.a1, rated_by: ids.owner, rating: -1, note: 'the figure is wrong' });
    expect(ok(r, 'toggle')).toEqual({ messageId: ids.a1, rating: 1, note: null });
    expect(ok(r, 'row_toggle')).toMatchObject({ rating: 1, note: null });
  });

  it('a note of 281 characters is INVALID_ARGUMENT detail p_note; 280 is kept; a blank one is null', () => {
    fails(r, 'long', 'INVALID_ARGUMENT', 'p_note');
    expect(ok(r, 'max')).toEqual({ messageId: ids.a1, rating: -1, note: MAX });
    expect(ok(r, 'blank')).toEqual({ messageId: ids.as, rating: -1, note: null });
    expect(ok(r, 'row_blank')).toMatchObject({ rating: -1, note: null });
  });

  it('0 clears the rating (the row goes), and clearing again is fine', () => {
    expect(ok(r, 'clear')).toEqual({ messageId: ids.as, rating: 0, note: null });
    expect(ok(r, 'row_cleared')).toBeNull();
    expect(ok(r, 'clear_again')).toEqual({ messageId: ids.as, rating: 0, note: null });
  });

  it('RLS: each owner reads only the rows they rated; a manager and the dev read none', () => {
    expect(ok(r, 'owner2_up')).toEqual({ messageId: ids.a2, rating: -1, note: 'off by one' });
    expect(ok(r, 'rls_owner')).toEqual([ids.a1]);
    expect(ok(r, 'rls_owner2')).toEqual([ids.a2]);
    expect(ok(r, 'rls_manager')).toBe(0);
    expect(ok(r, 'rls_dev')).toBe(0);
  });

  it('client INSERT, UPDATE and DELETE are refused (42501, no write grant); the row is unchanged', () => {
    for (const label of ['w_insert', 'w_update', 'w_delete']) {
      const o = r[label]!;
      expect(o.ok, label).toBe(false);
      expect(o.code, label).toMatch(/permission denied for table assistant_feedback/);
    }
    expect(ok(r, 'row_after_writes')).toMatchObject({ rating: -1, note: MAX });
  });

  it('deleting the message deletes its rating', () => {
    expect(ok(r, 'after_cascade')).toBe(0);
  });
});

describe.skipIf(!up)('0422 the clients embed the rating on their message select (PostgREST, one-to-one)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let conversationId = '';
  let rated = '';
  let unrated = '';

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    const conv = await svc.from('assistant_conversations').insert({ owner_id: SEED_STAFF_IDS.owner, title: 'fb embed probe' }).select('id').single();
    if (conv.error) throw new Error(conv.error.message);
    conversationId = (conv.data as { id: string }).id;
    const msgs = await svc
      .from('assistant_messages')
      .insert([
        { conversation_id: conversationId, seq: 1, role: 'user', content: [{ type: 'text', text: 'q' }] },
        { conversation_id: conversationId, seq: 2, role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        { conversation_id: conversationId, seq: 3, role: 'assistant', content: [{ type: 'text', text: 'b' }] },
      ])
      .select('id, seq');
    if (msgs.error) throw new Error(msgs.error.message);
    const bySeq = new Map((msgs.data as { id: string; seq: number }[]).map((m) => [m.seq, m.id]));
    rated = bySeq.get(2)!;
    unrated = bySeq.get(3)!;
  });

  afterAll(async () => {
    if (conversationId) await svc.from('assistant_conversations').delete().eq('id', conversationId); // cascades to messages and feedback
    await owner?.auth.signOut();
  });

  it('a rated answer embeds {rating, note}; an unrated one embeds null; the owner reads it under RLS', async () => {
    const res = await appRpc(owner, 'assistant_rate_message', { p_message_id: rated, p_rating: -1, p_note: 'the total is wrong' });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ messageId: rated, rating: -1, note: 'the total is wrong' });

    const { data, error } = await owner
      .from('assistant_messages')
      .select('id, seq, role, feedback:assistant_feedback(rating,note)')
      .eq('conversation_id', conversationId)
      .order('seq');
    expect(error).toBeNull();
    expect(data).toEqual([
      { id: expect.any(String), seq: 1, role: 'user', feedback: null },
      { id: rated, seq: 2, role: 'assistant', feedback: { rating: -1, note: 'the total is wrong' } },
      { id: unrated, seq: 3, role: 'assistant', feedback: null },
    ]);
  });

  it('a manager sees neither the messages nor the rating', async () => {
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      const { data, error } = await manager.from('assistant_feedback').select('message_id').eq('message_id', rated);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    } finally {
      await manager.auth.signOut();
    }
  });
});
