-- ===========================================================================
-- 0405 — assistant concurrency: no client UPDATE on a chat, an atomic chat
--        persist, and a claim on the batch-job tick (review 2026-11-09).
--
-- A. assistant_conversations loses its client UPDATE. 0108:172 granted
--    `update (title, scopes, range, handles, tokens, updated_at)` to
--    authenticated, with policy assistant_conversations_update_owner (0108:181,
--    re-issued by 0234 with the initplan wrapper). No client uses it: the
--    operator and the phone only SELECT the table (scopes and range move
--    through app.assistant_set_scopes, the model through assistant_set_model,
--    archiving through assistant_archive_conversation, all definer bodies), and
--    every other write is the service client in assistant-chat / assistant-job.
--    Left open, an owner session could rewrite `tokens` (the chat's spend the
--    usage page shows) or `handles` (the r1/c2 → uuid table the model's tool
--    calls resolve through) straight over PostgREST. Same class as 0329
--    (messages and calls). The service role keeps its own grants and bypasses
--    RLS, so nothing it does changes.
--
-- B. app.assistant_conversation_persist — the end of a chat turn in ONE
--    UPDATE. assistant-chat read conv.tokens when the turn started and wrote
--    prev + delta when it ended: two turns of one chat running together (seq.ts
--    lets them) lost one turn's spend. The increment now happens in SQL on the
--    row it locks: tokens.<k> = stored + delta for input, cache_write,
--    cache_read, output, cost_micros, calls, web_searches; any other key the
--    row holds is kept. A concurrent persist waits on the row lock and, under
--    READ COMMITTED, re-evaluates against the committed row, so both deltas
--    land. handles stay last-writer-wins (the turn's whole table, as before);
--    title is set only while the row has none (NULL or '', JavaScript's falsy
--    test the edge used) and p_title is given; context only when p_context is
--    given (the edge decides whether this turn's frozen context is storable).
--
-- C. assistant_jobs.tick_claimed_until + app.assistant_job_claim_tick — the
--    minute cron (tp_assistant_job_tick, 0113) only nudges the assistant-job
--    function; its tick iterated every running batch job with no claim, so two
--    overlapping ticks (a slow vendor read past the next minute, or a retried
--    nudge) both collected one batch's results and ran llm_record_usage per
--    chunk twice: assistant_calls rows and the monthly spend counted double,
--    and the reducing / failed transitions raced. The tick now claims first:
--    the jobs the nudge looks for (status = 'running' and mode = 'batch' and
--    batch_id is not null, 0113's predicate verbatim) whose claim is NULL or
--    expired, FOR UPDATE SKIP LOCKED, stamped now() + p_seconds, and processes
--    only what it got back. The edge clears its own claim (matched on the
--    stamp it was handed) when a batch is still in flight, so the next minute
--    polls it again; a job that leaves 'running' (reducing, over_estimate,
--    done, failed, cancelled) keeps a stale stamp, which is harmless: every
--    reader filters on status first, and over_estimate → running waits at most
--    p_seconds for the stamp to lapse. A tick that dies mid-job leaves the
--    stamp to lapse the same way, so the job is retried, never stuck.
--    app.assistant_job_transition (0112) is NOT re-issued: the claim is never
--    a transition patch key, and tests/assistant-jobs.test.ts holds the
--    allowlist to 0112's nine keys.
--    tick_claimed_until is an internal lease: not added to
--    app.assistant_readable_columns (table_read never returns it), like 0325's
--    context column.
--
-- Both functions are service-role only (revoked from public, anon,
-- authenticated; granted to service_role), like llm_record_web_search (0324),
-- so neither joins the rpc registry; fixtures/assistant-coverage.json lists
-- them as excluded. No new error code: INVALID_ARGUMENT and
-- CONVERSATION_NOT_FOUND exist already.
--
-- covered by packages/db/tests/assistant-concurrency.test.ts,
-- tests/assistant-rls.test.ts and the rls-matrix update rule for
-- assistant_conversations.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- A. No client UPDATE on assistant_conversations
-- ---------------------------------------------------------------------------
-- revoke update covers the 0108 column grant too (a table-level REVOKE removes
-- column privileges of the same kind). delete is named so a later grant cannot
-- slip in unnoticed; 0108 never granted it. anon never had either.
revoke update, delete on public.assistant_conversations from authenticated, anon;

-- With no UPDATE grant left the policy can never admit a row; drop it so nobody
-- reads it as a live path. Unpaired on purpose, as 0329's (check-migrations
-- flags it): RLS stays on and no UPDATE policy remains, so the table closes
-- twice over rather than opens; the SELECT and INSERT policies are untouched.
drop policy if exists assistant_conversations_update_owner on public.assistant_conversations;

comment on table public.assistant_conversations is
  '0108, 0405. One chat with the owner assistant. The owner reads it and inserts it (by column, 0325) under RLS; scopes, range, model and archiving move through definer RPCs; every other write is the assistant-chat / assistant-job edge function under the service role (0405 revoked the client UPDATE 0108 granted: tokens and handles were writable by any owner session). The end of a turn goes through app.assistant_conversation_persist, which adds the turn''s spend in SQL.';

-- ---------------------------------------------------------------------------
-- B. app.assistant_conversation_persist — service role only
-- ---------------------------------------------------------------------------
create or replace function app.assistant_conversation_persist(
  p_conversation_id uuid,
  p_handles         jsonb,
  p_usage           jsonb,
  p_title           text  default null,
  p_context         jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $assistant_conversation_persist_0405$
declare
  -- The chat's rolled-up counters (assistant-chat's `usage` event, 0324's
  -- web_searches). Every one is a whole number; a fraction is rounded.
  c_keys   constant text[] := array['input', 'cache_write', 'cache_read', 'output',
                                    'cost_micros', 'calls', 'web_searches'];
  v_bad    text;
  v_tokens jsonb;
begin
  if p_conversation_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_conversation_id';
  end if;
  if p_handles is null or jsonb_typeof(p_handles) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_handles', hint = 'an object';
  end if;
  if p_usage is null or jsonb_typeof(p_usage) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_usage', hint = 'an object';
  end if;
  if p_context is not null and jsonb_typeof(p_context) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_context', hint = 'an object or null';
  end if;
  -- A delta is a non-negative number or absent (absent adds 0). Unknown keys
  -- are ignored, never stored: the counters are this fixed list.
  select k into v_bad
    from unnest(c_keys) k
   -- CASE, not AND/OR: the planner may reorder quals, and a cast of a string
   -- value would raise 22P02 instead of INVALID_ARGUMENT.
   where case coalesce(jsonb_typeof(p_usage -> k), 'null')
           when 'null'   then false
           when 'number' then (p_usage ->> k)::numeric < 0
           else true
         end
   limit 1;
  if v_bad is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_usage.' || v_bad,
      hint = 'a non-negative number';
  end if;

  -- One statement: the row lock serialises concurrent persists of one chat,
  -- and the SET list is evaluated on the row as committed by the one before
  -- (READ COMMITTED re-check), so every turn's delta lands.
  update assistant_conversations c
     set handles    = p_handles,
         tokens     = (case when jsonb_typeof(c.tokens) = 'object' then c.tokens else '{}'::jsonb end)
                      || (select jsonb_object_agg(
                                   k,
                                   round(case when jsonb_typeof(c.tokens -> k) = 'number'
                                              then (c.tokens ->> k)::numeric else 0 end)::bigint
                                   + round(case when jsonb_typeof(p_usage -> k) = 'number'
                                                then (p_usage ->> k)::numeric else 0 end)::bigint)
                            from unnest(c_keys) k),
         title      = case when coalesce(c.title, '') = '' and p_title is not null then p_title else c.title end,
         context    = coalesce(p_context, c.context),
         updated_at = now()
   where c.id = p_conversation_id
  returning c.tokens into v_tokens;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_tokens;
end $assistant_conversation_persist_0405$;

comment on function app.assistant_conversation_persist(uuid, jsonb, jsonb, text, jsonb) is
  '0405. Service role only. The end of one assistant-chat turn in one UPDATE: replaces handles, adds p_usage (this turn''s delta) to tokens in SQL for input, cache_write, cache_read, output, cost_micros, calls, web_searches (other keys kept), sets title only while the row has none and p_title is given, context only when p_context is given, stamps updated_at; returns the new tokens. INVALID_ARGUMENT for a missing id, a non-object handles/usage/context or a negative or non-numeric delta; CONVERSATION_NOT_FOUND for an unknown chat.';

revoke all on function app.assistant_conversation_persist(uuid, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function app.assistant_conversation_persist(uuid, jsonb, jsonb, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- C. The tick claim
-- ---------------------------------------------------------------------------
-- Nullable, no default: a metadata-only ADD COLUMN, no rewrite.
alter table public.assistant_jobs
  add column if not exists tick_claimed_until timestamptz;

comment on column public.assistant_jobs.tick_claimed_until is
  '0405. The batch tick''s lease: app.assistant_job_claim_tick stamps it (now() + p_seconds) on the running batch jobs one tick works, and a later tick skips a job until it lapses; the tick clears its own stamp when the batch is still in flight. A stale stamp on a job that left running is harmless (readers filter on status). Not readable by the assistant (not in app.assistant_readable_columns).';

create or replace function app.assistant_job_claim_tick(p_seconds int default 120)
returns table (job_id uuid, claimed_until timestamptz)
language plpgsql security definer set search_path = public as $assistant_job_claim_tick_0405$
begin
  -- The claim must outlast the edge's 50 s wall (assistant-job WALL_MS) and
  -- never pin a job for long: 1..900 seconds.
  if p_seconds is null or p_seconds < 1 or p_seconds > 900 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seconds', hint = '1 to 900';
  end if;

  -- 0113's predicate (assistant_job_tick_nudge) plus "unclaimed or lapsed".
  -- SKIP LOCKED: a job another tick is claiming right now is skipped, never
  -- waited on; one whose claim committed meanwhile fails the re-checked WHERE.
  return query
  with due as (
    select j.id
      from assistant_jobs j
     where j.status = 'running'
       and j.mode = 'batch'
       and j.batch_id is not null
       and (j.tick_claimed_until is null or j.tick_claimed_until <= now())
     order by j.id
       for update of j skip locked
  )
  update assistant_jobs j
     set tick_claimed_until = now() + make_interval(secs => p_seconds)
    from due
   where j.id = due.id
  returning j.id, j.tick_claimed_until;
end $assistant_job_claim_tick_0405$;

comment on function app.assistant_job_claim_tick(int) is
  '0405. Service role only. Claims the running batch jobs (status running, mode batch, batch_id set: 0113''s predicate) whose tick_claimed_until is NULL or lapsed, FOR UPDATE SKIP LOCKED, stamps tick_claimed_until = now() + p_seconds (1..900, default 120) and returns (job_id, claimed_until). Two concurrent ticks never get the same job. INVALID_ARGUMENT for p_seconds out of range.';

revoke all on function app.assistant_job_claim_tick(int) from public, anon, authenticated;
grant execute on function app.assistant_job_claim_tick(int) to service_role;
