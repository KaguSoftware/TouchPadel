-- ===========================================================================
-- 0327 — owner assistant: stop pre-warming analytics cards nobody opens.
--
-- The nightly pre-warm (0141 §10, cron tp_assistant_prewarm, the
-- assistant-component edge function's {prewarm:true} path) generated every
-- built-in × the three default ranges × ASSISTANT_PREWARM_LANGS whether or not
-- the owner ever looked at the card: a billed model call per card per night
-- whenever its numbers moved. Now a card earns its pre-warm by being read.
--
-- WHAT THIS ADDS.
--   1. public.assistant_components.last_viewed_at (timestamptz, nullable): the
--      last time the owner's card read the component. Backfilled to now() for
--      every non-archived built-in, so the pre-warm keeps its full set for the
--      first week and only then drops the cards nobody opened.
--   2. app.analytics_component re-issued from its latest body (0141:210)
--      VOLATILE instead of STABLE, with a throttled stamp after the lookup:
--      last_viewed_at moves only when it is null or older than one hour, so a
--      page that re-reads a card every minute writes once an hour. VOLATILE is
--      what lets the write run: PostgREST executes a STABLE function in a
--      read-only transaction. Every caller POSTs (supabase-js .rpc() without
--      {get:true}: the operator's useAssistantComponent through lib/appRpc.ts,
--      the edge function's ownerReader.lookup, tests/assistant-components.test.ts),
--      so nothing reached it by GET. The owner-initiated generate path of
--      assistant-component reads the cache through this RPC with the owner's
--      JWT before it spends a token (fill → reader.lookup), so a Refresh or a
--      rejection stamps too; the pre-warm reads through
--      app.assistant_component_lookup and never counts as a view.
--   The function stays security definer (owned by postgres, RLS bypassed for
--   its own update); the owner guard is still the first statement, the stamp
--   runs only after the lookup has accepted the key (an unknown or archived
--   key still raises COMPONENT_NOT_FOUND and writes nothing), and it writes
--   one column of one row. Grants unchanged (owner via authenticated).
--
-- The edge function pre-warms only components with last_viewed_at within
-- PREWARM_VIEWED_DAYS (7) and reports the skipped keys
-- (supabase/functions/assistant-component/index.ts).
--
-- No index: assistant_components holds six built-ins plus the owner's pins.
-- covered by packages/db/tests/assistant-components.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. assistant_components.last_viewed_at
-- ---------------------------------------------------------------------------
alter table public.assistant_components
  add column if not exists last_viewed_at timestamptz;

comment on column public.assistant_components.last_viewed_at is
  '0327. When the owner''s card last read this component through app.analytics_component (stamped at most once an hour). The nightly pre-warm generates only components viewed in the last 7 days (PREWARM_VIEWED_DAYS); null means never viewed since 0327, so never pre-warmed until the owner opens it.';

-- The first week behaves as before: every live built-in counts as just seen.
update public.assistant_components
   set last_viewed_at = now()
 where kind = 'builtin'
   and archived_at is null
   and last_viewed_at is null;

-- table_read knows the new column (the 0141 statement, limited to it).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'table', c.data_type <> 'jsonb', c.data_type, c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name = 'assistant_components'
   and c.column_name = 'last_viewed_at'
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. app.analytics_component — 0141's body, VOLATILE, plus the view stamp
-- ---------------------------------------------------------------------------
create or replace function app.analytics_component(p_key text, p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $analytics_component_0327$
declare
  v_out jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Raises COMPONENT_NOT_FOUND / INVALID_ARGUMENT before anything is written.
  v_out := app.assistant_component_lookup(p_key, p_params);

  -- The owner read this card: stamp it, at most once an hour.
  update assistant_components
     set last_viewed_at = now()
   where key = p_key
     and archived_at is null
     and (last_viewed_at is null or last_viewed_at < now() - interval '1 hour');

  return v_out;
end $analytics_component_0327$;

comment on function app.analytics_component(text, jsonb) is
  '0141, re-issued by 0327. Owner-only, never calls a model. {hit:true, content, sources, gate, generated_at, tokens, inputs_fingerprint, params_hash} when a live cache row exists for the component and these parameters, else {hit:false, params_hash, last:{…}|null} with the most recent superseded answer for the card to grey out. params_hash is computed here from the canonical parameters. VOLATILE since 0327: it stamps assistant_components.last_viewed_at (at most once an hour), which decides what the nightly pre-warm generates.';

revoke all on function app.analytics_component(text, jsonb) from public, anon;
grant execute on function app.analytics_component(text, jsonb) to authenticated;
