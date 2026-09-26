-- ===========================================================================
-- 0108 — owner assistant: conversations, messages, calls, jobs.
--
-- docs/design/assistant/owner-assistant-plan-2026-09-20.md §2.1, §2.7 and
-- docs/design/assistant/build-contracts-2026-09-20.md "Lane A · 0108 tables".
--
-- WHAT THESE TABLES ARE. The memory of the owner's chat with the assistant:
-- one row per conversation, one per message (the provider's content blocks
-- stored VERBATIM so the next turn replays them unchanged), one per model call
-- (the four token kinds, so the meter and the spend cap price by kind), and
-- one per proposed job (the estimate the owner accepted and how far it got).
--
-- WHAT THEY ARE NOT. They are not business ledgers. Nothing here moves money
-- or stock, so the two RPCs below audit nothing, and there is no venue column
-- because the venue has one owner account.
--
-- WHO WRITES. The assistant-chat edge function writes conversations, messages
-- and calls through the service role (RLS bypassed) once the owner's session
-- has been checked; the UI may insert a conversation and update its scopes
-- directly under RLS. Jobs are written by the edge function only and read by
-- the owner. Nobody deletes: archiving is an RPC that stamps archived_at.
--
-- INDEXES. Four plain `create index` statements below run on brand-new, empty
-- tables: no writer exists yet, so the SHARE lock the migration lint warns
-- about holds nothing up (0072, 0073 and 0105 set the same precedent).
-- MIGRATION-RISK-ACCEPTED: plain indexes on freshly created empty tables.
--
-- REALTIME. The repository subscribes to no postgres_changes channel anywhere
-- (grep: none), so assistant_jobs / assistant_calls are NOT added to the
-- supabase_realtime publication; the UI polls a running job every 2 s.
--
-- covered by packages/db/tests/assistant-rls.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. assistant_conversations
-- ---------------------------------------------------------------------------
create table if not exists assistant_conversations (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references staff(id),
  title       text,
  scopes      text[] not null default '{howto}',
  range       jsonb,
  handles     jsonb not null default '{}'::jsonb,
  tokens      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

comment on table assistant_conversations is
  '0108. One owner chat with the assistant. scopes = the context checkboxes (plan §5.5); range = the date range the checkboxes read; handles = the short-id table (r1, c2, …) the edge function owns; tokens = rolled-up counts. Archived rows keep their messages.';
comment on column assistant_conversations.owner_id is 'The owner account that opened the chat (staff.id = auth.uid()).';
comment on column assistant_conversations.title is 'First 60 characters of the first question; the UI shows it in the list.';
comment on column assistant_conversations.scopes is 'Context scopes this chat may read: cafe, courts, money, stock, staff, customers, audit, marketing, settings, system, howto, docs, tables. Validated by app.assistant_set_scopes.';
comment on column assistant_conversations.range is 'Optional {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"} the context packs and default tool ranges use.';
comment on column assistant_conversations.handles is 'Handle table {"r1": "<uuid>", "c2": "<uuid>", …, "_next": {"r": 2, "c": 3}} — the edge function owns the format; the database stores it.';
comment on column assistant_conversations.tokens is 'Rolled-up token counts for the chat: {"input", "cache_write", "cache_read", "output", "cost_micros"}.';
comment on column assistant_conversations.archived_at is 'Set by app.assistant_archive_conversation; the UI hides archived chats. Never deleted.';

create index if not exists assistant_conversations_owner_updated_idx
  on assistant_conversations (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- 2. assistant_messages
-- ---------------------------------------------------------------------------
create table if not exists assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  seq             int not null,
  role            text not null check (role in ('user', 'assistant')),
  content         jsonb not null,
  sources         jsonb not null default '[]'::jsonb,
  gate            jsonb,
  tokens          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq)
);

comment on table assistant_messages is
  '0108. One turn of a chat. content holds the provider''s content blocks verbatim (text, tool_use, tool_result, thinking) because the next turn must replay them unchanged; sources is the UI list of tool calls and cited chunks; gate is what the answer gate found (plan §4.5).';
comment on column assistant_messages.seq is 'Position in the conversation, 1-based, unique per conversation.';
comment on column assistant_messages.role is 'user or assistant.';
comment on column assistant_messages.content is 'Provider content blocks, verbatim. Never rewritten.';
comment on column assistant_messages.sources is '[{call_id, name, args, row_count, ms, route, stats, error?}] — every tool call behind this answer, so the owner can open the page with the same figure.';
comment on column assistant_messages.gate is '{status: ok|unverified, unverified: [{raw, value}], checked, retried} — the number gate''s verdict on this answer.';
comment on column assistant_messages.tokens is 'Token counts for this message: {"input", "cache_write", "cache_read", "output", "cost_micros"}.';

-- ---------------------------------------------------------------------------
-- 3. assistant_calls — one row per model call, priced by kind
-- ---------------------------------------------------------------------------
create table if not exists assistant_calls (
  id                 bigint generated always as identity primary key,
  message_id         uuid not null references assistant_messages(id) on delete cascade,
  call_no            int not null,
  model              text not null,
  input_tokens       bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  output_tokens      bigint not null default 0,
  cost_micros        bigint not null default 0,
  ms                 int,
  stop_reason        text,
  created_at         timestamptz not null default now()
);

comment on table assistant_calls is
  '0108. One model call inside one assistant message (a turn can take up to 8 tool rounds). The four token kinds are what the price depends on (venue_settings.llm_pricing, 0111); cost_micros is what app.llm_price_micros said at the time.';
comment on column assistant_calls.call_no is '1-based round number within the message.';
comment on column assistant_calls.model is 'Provider model id the call actually ran on (after any server-side fallback).';
comment on column assistant_calls.input_tokens is 'Uncached input tokens.';
comment on column assistant_calls.cache_write_tokens is 'Input tokens written to the prompt cache.';
comment on column assistant_calls.cache_read_tokens is 'Input tokens served from the prompt cache.';
comment on column assistant_calls.output_tokens is 'Output tokens, thinking included.';
comment on column assistant_calls.cost_micros is 'USD micros for this call from the pricing map in force at the time.';
comment on column assistant_calls.ms is 'Wall-clock milliseconds of the call.';
comment on column assistant_calls.stop_reason is 'Provider stop reason: end_turn, tool_use, max_tokens, …';

create index if not exists assistant_calls_message_idx on assistant_calls (message_id);

-- ---------------------------------------------------------------------------
-- 4. assistant_jobs — estimate-then-run reads over many rows (plan §2.7, §6)
-- ---------------------------------------------------------------------------
create table if not exists assistant_jobs (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references assistant_conversations(id) on delete cascade,
  message_id      uuid references assistant_messages(id) on delete set null,
  status          text not null default 'estimated'
                  check (status in ('estimated','accepted','running','reducing','done','failed','cancelled','over_estimate')),
  plan            jsonb not null,
  estimate        jsonb not null,
  mode            text check (mode in ('live', 'batch')),
  chunks_total    int,
  chunks_done     int not null default 0,
  tokens          jsonb not null default '{}'::jsonb,
  result          jsonb,
  error           text,
  batch_id        text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

comment on table assistant_jobs is
  '0108. A proposed read over more rows than a chat turn may hold (plan §6). estimate holds the numbers the owner accepted; the state machine lives in app.assistant_job_transition (0112). Written by the assistant-job edge function under the service role; the owner reads it and may cancel.';
comment on column assistant_jobs.status is 'estimated → accepted → running → {reducing → done | over_estimate → running | failed | cancelled}; estimated/accepted → cancelled.';
comment on column assistant_jobs.plan is 'The JobPlan the model proposed: question, list-tool calls without paging, extract and reduce instructions.';
comment on column assistant_jobs.estimate is 'The JobEstimate shown to the owner: rows, chunks, tokens by kind, the price at the time, assumptions.';
comment on column assistant_jobs.mode is 'live (runs inside the function call) or batch (submitted to the provider''s batch API and polled by cron).';
comment on column assistant_jobs.chunks_total is 'How many row chunks the plan pages through.';
comment on column assistant_jobs.chunks_done is 'Chunks finished so far; the UI polls this at 2 s.';
comment on column assistant_jobs.tokens is 'Actual spend so far, four kinds plus cost_micros; over_estimate when it passes estimate × 1.25.';
comment on column assistant_jobs.result is 'The reduced answer object once done.';
comment on column assistant_jobs.error is 'Why it failed, when it did.';
comment on column assistant_jobs.batch_id is 'Provider batch id for mode = batch.';

create index if not exists assistant_jobs_conversation_idx on assistant_jobs (conversation_id, created_at desc);
create index if not exists assistant_jobs_status_idx on assistant_jobs (status) where status in ('accepted','running','reducing','over_estimate');

-- ---------------------------------------------------------------------------
-- 5. RLS — owner only. The service role bypasses RLS by definition.
-- ---------------------------------------------------------------------------
alter table assistant_conversations enable row level security;
alter table assistant_messages      enable row level security;
alter table assistant_calls         enable row level security;
alter table assistant_jobs          enable row level security;

grant select, insert on assistant_conversations to authenticated;
grant update (title, scopes, range, handles, tokens, updated_at) on assistant_conversations to authenticated;
grant select, insert on assistant_messages to authenticated;
grant select, insert on assistant_calls to authenticated;
grant select on assistant_jobs to authenticated;

create policy assistant_conversations_select_owner on assistant_conversations
  for select to authenticated using (app.is_staff('owner'));
create policy assistant_conversations_insert_owner on assistant_conversations
  for insert to authenticated with check (app.is_staff('owner') and owner_id = auth.uid());
create policy assistant_conversations_update_owner on assistant_conversations
  for update to authenticated using (app.is_staff('owner')) with check (app.is_staff('owner'));

create policy assistant_messages_select_owner on assistant_messages
  for select to authenticated using (app.is_staff('owner'));
create policy assistant_messages_insert_owner on assistant_messages
  for insert to authenticated with check (app.is_staff('owner'));

create policy assistant_calls_select_owner on assistant_calls
  for select to authenticated using (app.is_staff('owner'));
create policy assistant_calls_insert_owner on assistant_calls
  for insert to authenticated with check (app.is_staff('owner'));

create policy assistant_jobs_select_owner on assistant_jobs
  for select to authenticated using (app.is_staff('owner'));

-- ---------------------------------------------------------------------------
-- 6. app.assistant_archive_conversation — archiving is a stamp, not a delete
-- ---------------------------------------------------------------------------
create or replace function app.assistant_archive_conversation(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $assistant_archive_conversation_0108$
declare
  v_row assistant_conversations%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_id';
  end if;

  update assistant_conversations
     set archived_at = coalesce(archived_at, now()),
         updated_at  = now()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return to_jsonb(v_row);
end $assistant_archive_conversation_0108$;

comment on function app.assistant_archive_conversation(uuid) is
  '0108. Owner-only. Stamps archived_at on a chat (idempotent) and returns the row. Nothing is deleted and nothing is audited: chats are not a business ledger.';

revoke all on function app.assistant_archive_conversation(uuid) from public, anon;
grant execute on function app.assistant_archive_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.assistant_set_scopes — the context checkboxes, validated
-- ---------------------------------------------------------------------------
create or replace function app.assistant_set_scopes(p_id uuid, p_scopes text[], p_range jsonb default null)
returns assistant_conversations
language plpgsql security definer set search_path = public as $assistant_set_scopes_0108$
declare
  -- The catalog's ASSISTANT_SCOPES (packages/core/src/assistant/tools.ts), in order.
  v_known text[] := array['cafe','courts','money','stock','staff','customers','audit',
                          'marketing','settings','system','howto','docs','tables'];
  v_bad   text;
  v_row   assistant_conversations%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_id';
  end if;
  if p_scopes is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_scopes';
  end if;

  select s into v_bad from unnest(p_scopes) s where s is null or not (s = any (v_known)) limit 1;
  if v_bad is not null or exists (select 1 from unnest(p_scopes) s where s is null) then
    raise exception 'ASSISTANT_UNKNOWN_SCOPE' using errcode = 'P0001',
      detail = coalesce(v_bad, 'null'),
      hint   = 'one of ' || array_to_string(v_known, ', ');
  end if;

  if p_range is not null then
    if jsonb_typeof(p_range) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_range',
        hint = '{"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}';
    end if;
    begin
      if (p_range ->> 'from') is not null and (p_range ->> 'to') is not null
         and (p_range ->> 'to')::date < (p_range ->> 'from')::date then
        raise exception 'INVALID_RANGE' using errcode = 'P0001';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_range',
        hint = 'dates as YYYY-MM-DD';
    end;
  end if;

  update assistant_conversations
     set scopes     = (select coalesce(array_agg(distinct s order by s), '{}') from unnest(p_scopes) s),
         range      = p_range,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return v_row;
end $assistant_set_scopes_0108$;

comment on function app.assistant_set_scopes(uuid, text[], jsonb) is
  '0108. Owner-only. Replaces a chat''s context scopes (validated against the catalog list; ASSISTANT_UNKNOWN_SCOPE otherwise) and its optional date range, and returns the row. Audits nothing.';

revoke all on function app.assistant_set_scopes(uuid, text[], jsonb) from public, anon;
grant execute on function app.assistant_set_scopes(uuid, text[], jsonb) to authenticated;
