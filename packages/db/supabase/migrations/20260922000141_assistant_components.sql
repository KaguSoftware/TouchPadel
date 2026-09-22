-- ===========================================================================
-- 0141 — owner assistant: analytics components and their cache.
--
-- docs/design/assistant/owner-assistant-plan-2026-09-20.md §2.8 (tables and
-- app.analytics_component), §4.4 (the assistant-component edge function),
-- §5.4 (the cards, the six built-ins, pinning), DECIDE 12 (press + nightly
-- pre-warm, never on page open) and DECIDE 13 (pinning ships).
--
-- WHAT A COMPONENT IS. A fixed question, the tools that answer it, and a JSON
-- schema the model must fill. The six built-ins are seeded here; a pinned one
-- is a chat answer the owner wanted on the analytics page (kind = 'pinned').
--
-- WHAT THE CACHE IS. One row per (component, params_hash, inputs_fingerprint).
-- params_hash is md5 of the canonical parameters (jsonb text is canonical:
-- key order never matters, nulls are stripped) and is ALWAYS computed here,
-- never by a client. inputs_fingerprint is sha256 of the CLEANED tool results
-- the edge function read before spending a token, so a closed range generates
-- once and a live range regenerates only when its numbers moved. A row is
-- live until it is superseded (a newer generation for the same params, or the
-- edge function found the numbers moved) or expired.
--
-- WHO WRITES. The assistant-component edge function only, through two
-- service-role functions (upsert, supersede). The owner reads through
-- app.analytics_component, which never calls a model. Pin and archive are
-- owner RPCs. Nothing here is a business ledger; nothing is audited.
--
-- PRE-WARM. app.assistant_prewarm_nudge posts {prewarm:true} to the edge
-- function once a day at 03:30 VENUE time: cron.timezone is GMT on Supabase,
-- so the job runs at :30 every hour and the function posts only when the
-- venue's local hour is 3. Guarded exactly like 0113: silent without pg_net,
-- the two secrets or pg_cron. The pre-warm has no owner JWT, so it runs the
-- read tools through app.assistant_run_tool_prewarm (service role only),
-- which stamps the venue owner's uid on the transaction and calls the 0109
-- read-only wall unchanged.
--
-- INDEXES. One plain `create index` on a brand-new, empty table (0108 precedent).
-- MIGRATION-RISK-ACCEPTED: plain index on a freshly created empty table.
--
-- covered by packages/db/tests/assistant-components.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. assistant_components
-- ---------------------------------------------------------------------------
create table if not exists assistant_components (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  kind           text not null check (kind in ('builtin', 'pinned')),
  question       text not null check (length(question) between 1 and 4000),
  output_schema  jsonb not null,
  tools          text[] not null check (cardinality(tools) between 1 and 12),
  default_params jsonb not null default '{}'::jsonb,
  created_by     uuid references staff(id),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);

comment on table assistant_components is
  '0141. An analytics card the assistant pipeline fills (plan §5.4): a fixed question, the catalog tools that answer it and the JSON schema the model must return. builtin rows are seeded by migration; pinned rows come from app.assistant_pin_component. Archived rows stay for their cache history.';
comment on column assistant_components.key is 'Stable id used by the page and the cache: cafe_findings, courts_findings, week_paragraph, what_changed, stock_watch, staff_note, or a pinned key.';
comment on column assistant_components.kind is 'builtin (seeded) or pinned (owner pressed "Pin to Analytics" on a chat answer).';
comment on column assistant_components.question is 'The single user turn the model answers, in English; the answer is written in the page language.';
comment on column assistant_components.output_schema is 'JSON schema for output_config.format (strict: every property required, additionalProperties false). The card renders content against it.';
comment on column assistant_components.tools is 'Catalog tool names (packages/core/src/assistant/tools.ts), each optionally followed by one space and a JSON object of fixed arguments, e.g. stock_view {"view":"expiring_soon","limit":50}. Range, compare, court and language come from the card''s parameters.';
comment on column assistant_components.default_params is 'Parameters merged UNDER the request''s: {"scope": "cafe", "compare": "previousPeriod"}. The page''s own range always wins.';
comment on column assistant_components.created_by is 'The owner who pinned it; null for built-ins.';
comment on column assistant_components.archived_at is 'Set by app.assistant_archive_component; the page hides archived cards.';

-- ---------------------------------------------------------------------------
-- 2. assistant_component_cache
-- ---------------------------------------------------------------------------
create table if not exists assistant_component_cache (
  id                 bigint generated always as identity primary key,
  component_key      text not null references assistant_components(key) on delete cascade,
  params_hash        text not null,
  inputs_fingerprint text not null,
  content            jsonb not null,
  sources            jsonb not null default '[]'::jsonb,
  gate               jsonb,
  tokens             jsonb not null default '{}'::jsonb,
  generated_at       timestamptz not null default now(),
  expires_at         timestamptz,
  superseded_at      timestamptz,
  unique (component_key, params_hash, inputs_fingerprint)
);

comment on table assistant_component_cache is
  '0141. One generated answer of a component for one parameter set and one state of its inputs (plan §2.8). Served by app.analytics_component while superseded_at is null and expires_at has not passed. Written only by the assistant-component edge function through app.assistant_component_upsert.';
comment on column assistant_component_cache.params_hash is 'md5 of the canonical parameters (app.assistant_params_hash): range, compare basis, scope, court, language.';
comment on column assistant_component_cache.inputs_fingerprint is 'sha256 of the cleaned tool results the answer read. Same numbers, same fingerprint, no new generation.';
comment on column assistant_component_cache.content is 'The model''s answer, shaped by the component''s output_schema.';
comment on column assistant_component_cache.sources is '[{name, args, row_count, ms, route, stats}] — every tool call behind the answer.';
comment on column assistant_component_cache.gate is 'The number gate''s verdict on the answer (plan §4.5).';
comment on column assistant_component_cache.tokens is '{"model", "input", "cache_write", "cache_read", "output", "cost_micros"} — what this generation cost; the card prints it.';
comment on column assistant_component_cache.generated_at is 'When the model wrote it; the card always prints this line.';
comment on column assistant_component_cache.expires_at is 'Optional hard expiry; null means "until superseded".';
comment on column assistant_component_cache.superseded_at is 'Set when a newer generation landed for the same parameters or the edge function saw the numbers move. The card shows a superseded row greyed as "the last answer".';

create index if not exists assistant_component_cache_lookup_idx
  on assistant_component_cache (component_key, params_hash, generated_at desc);

-- ---------------------------------------------------------------------------
-- 3. RLS — owner reads, nobody else; writes are service role only.
-- ---------------------------------------------------------------------------
alter table assistant_components      enable row level security;
alter table assistant_component_cache enable row level security;

grant select on assistant_components      to authenticated;
grant select on assistant_component_cache to authenticated;

create policy assistant_components_select_owner on assistant_components
  for select to authenticated using (app.is_staff('owner'));
create policy assistant_component_cache_select_owner on assistant_component_cache
  for select to authenticated using (app.is_staff('owner'));

-- table_read knows the new tables (0109 seeded before they existed).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'table', c.data_type <> 'jsonb', c.data_type, c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in ('assistant_components', 'assistant_component_cache')
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 4. app.assistant_params_hash — the ONE place a params hash is computed
-- ---------------------------------------------------------------------------
create or replace function app.assistant_params_hash(p_params jsonb)
returns text
language sql immutable parallel safe as $assistant_params_hash_0141$
  -- jsonb text is canonical (keys sorted, one spacing), so {"to":…,"from":…}
  -- and {"from":…,"to":…} hash alike; nulls are stripped so an absent key and
  -- an explicit null are the same parameter set.
  select md5(jsonb_strip_nulls(coalesce(p_params, '{}'::jsonb))::text)
$assistant_params_hash_0141$;

comment on function app.assistant_params_hash(jsonb) is
  '0141. md5 of the canonical parameter object (jsonb text, nulls stripped). Definer-only helper; a client never computes a params hash.';

revoke all on function app.assistant_params_hash(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The lookup (definer-only) and its owner face app.analytics_component
-- ---------------------------------------------------------------------------
create or replace function app.assistant_component_lookup(p_key text, p_params jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_component_lookup_0141$
declare
  v_hash text;
  v_live assistant_component_cache%rowtype;
  v_last assistant_component_cache%rowtype;
begin
  if p_key is null or not exists (select 1 from assistant_components c where c.key = p_key and c.archived_at is null) then
    raise exception 'COMPONENT_NOT_FOUND' using errcode = 'P0001', detail = coalesce(p_key, 'null');
  end if;
  if p_params is not null and jsonb_typeof(p_params) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_params', hint = 'an object';
  end if;

  v_hash := app.assistant_params_hash(p_params);

  select * into v_live
    from assistant_component_cache
   where component_key = p_key and params_hash = v_hash
     and superseded_at is null
     and (expires_at is null or expires_at > now())
   order by generated_at desc
   limit 1;

  if found then
    return jsonb_build_object(
      'hit',                true,
      'key',                p_key,
      'params_hash',        v_hash,
      'inputs_fingerprint', v_live.inputs_fingerprint,
      'content',            v_live.content,
      'sources',            v_live.sources,
      'gate',               v_live.gate,
      'generated_at',       v_live.generated_at,
      'tokens',             v_live.tokens);
  end if;

  select * into v_last
    from assistant_component_cache
   where component_key = p_key and params_hash = v_hash
   order by generated_at desc
   limit 1;

  return jsonb_build_object(
    'hit',         false,
    'key',         p_key,
    'params_hash', v_hash,
    'last', case when v_last.id is null then null else jsonb_build_object(
      'inputs_fingerprint', v_last.inputs_fingerprint,
      'content',            v_last.content,
      'sources',            v_last.sources,
      'gate',               v_last.gate,
      'generated_at',       v_last.generated_at,
      'tokens',             v_last.tokens) end);
end $assistant_component_lookup_0141$;

comment on function app.assistant_component_lookup(text, jsonb) is
  '0141. Definer-only: the cache read behind app.analytics_component and the edge function''s pre-warm (which has no owner session). Never calls a model.';

revoke all on function app.assistant_component_lookup(text, jsonb) from public, anon, authenticated;
grant execute on function app.assistant_component_lookup(text, jsonb) to service_role;

create or replace function app.analytics_component(p_key text, p_params jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_component_0141$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.assistant_component_lookup(p_key, p_params);
end $analytics_component_0141$;

comment on function app.analytics_component(text, jsonb) is
  '0141. Owner-only, STABLE, never calls a model. {hit:true, content, sources, gate, generated_at, tokens, inputs_fingerprint, params_hash} when a live cache row exists for the component and these parameters, else {hit:false, params_hash, last:{…}|null} with the most recent superseded answer for the card to grey out. params_hash is computed here from the canonical parameters.';

revoke all on function app.analytics_component(text, jsonb) from public, anon;
grant execute on function app.analytics_component(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Writes: upsert and supersede (service role only — the edge function)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_component_upsert(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $assistant_component_upsert_0141$
declare
  v_key  text := p ->> 'key';
  v_hash text;
  v_fp   text := p ->> 'inputs_fingerprint';
  v_row  assistant_component_cache%rowtype;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p', hint = '{key, params, inputs_fingerprint, content, sources?, gate?, tokens?, expires_at?}';
  end if;
  if v_key is null or not exists (select 1 from assistant_components c where c.key = v_key) then
    raise exception 'COMPONENT_NOT_FOUND' using errcode = 'P0001', detail = coalesce(v_key, 'null');
  end if;
  if v_fp is null or v_fp = '' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'inputs_fingerprint';
  end if;
  if p -> 'content' is null or jsonb_typeof(p -> 'content') <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'content', hint = 'an object shaped by output_schema';
  end if;

  v_hash := app.assistant_params_hash(p -> 'params');

  insert into assistant_component_cache
         (component_key, params_hash, inputs_fingerprint, content, sources, gate, tokens, generated_at, expires_at, superseded_at)
  values (v_key, v_hash, v_fp, p -> 'content',
          coalesce(p -> 'sources', '[]'::jsonb), p -> 'gate', coalesce(p -> 'tokens', '{}'::jsonb),
          now(), (p ->> 'expires_at')::timestamptz, null)
      on conflict (component_key, params_hash, inputs_fingerprint) do update set
         content       = excluded.content,
         sources       = excluded.sources,
         gate          = excluded.gate,
         tokens        = excluded.tokens,
         generated_at  = now(),
         expires_at    = excluded.expires_at,
         superseded_at = null
  returning * into v_row;

  -- Exactly one live row per (component, params): every other one is history.
  update assistant_component_cache
     set superseded_at = now()
   where component_key = v_key and params_hash = v_hash
     and id <> v_row.id and superseded_at is null;

  return to_jsonb(v_row);
end $assistant_component_upsert_0141$;

comment on function app.assistant_component_upsert(jsonb) is
  '0141. Service role only (the assistant-component edge function). Stores one generation {key, params, inputs_fingerprint, content, sources, gate, tokens, expires_at?}, computing params_hash here, and supersedes every other row for the same component and parameters. Returns the row.';

revoke all on function app.assistant_component_upsert(jsonb) from public, anon, authenticated;
grant execute on function app.assistant_component_upsert(jsonb) to service_role;

create or replace function app.assistant_component_supersede(p_key text, p_params_hash text)
returns int
language plpgsql security definer set search_path = public as $assistant_component_supersede_0141$
declare
  v_n int;
begin
  if p_key is null or p_params_hash is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_key, p_params_hash';
  end if;
  update assistant_component_cache
     set superseded_at = now()
   where component_key = p_key and params_hash = p_params_hash and superseded_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $assistant_component_supersede_0141$;

comment on function app.assistant_component_supersede(text, text) is
  '0141. Service role only. Marks every live cache row of a component for one parameter set superseded (the edge function saw the numbers move and could not regenerate, or a rejection forced a rewrite). Returns how many rows it stamped.';

revoke all on function app.assistant_component_supersede(text, text) from public, anon, authenticated;
grant execute on function app.assistant_component_supersede(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. app.assistant_run_tool_prewarm — the nightly pre-warm's read path
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool_prewarm(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_prewarm_0141$
declare
  v_owner uuid;
begin
  -- Only the service role reaches this (grant below); it must still name a
  -- real owner, because the 0109 wall and every dispatched RPC check the role.
  select id into v_owner from staff where role = 'owner' and is_active order by created_at limit 1;
  if v_owner is null then
    raise exception 'OWNER_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  return app.assistant_run_tool(p_tool, p_args);
end $assistant_run_tool_prewarm_0141$;

comment on function app.assistant_run_tool_prewarm(text, jsonb) is
  '0141. Service role only: the nightly pre-warm has no owner session, so this stamps the venue owner''s uid on the transaction and calls app.assistant_run_tool unchanged (read-only wall, same catalog, same guards). Reads only; every dispatched RPC still sees an owner.';

revoke all on function app.assistant_run_tool_prewarm(text, jsonb) from public, anon, authenticated;
grant execute on function app.assistant_run_tool_prewarm(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Pin and archive (owner RPCs)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_pin_component(
  p_key            text,
  p_question       text,
  p_tools          text[],
  p_output_schema  jsonb,
  p_default_params jsonb default '{}'::jsonb
) returns assistant_components
language plpgsql security definer set search_path = public as $assistant_pin_component_0141$
declare
  v_row assistant_components%rowtype;
  v_t   text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_key', hint = 'lowercase letters, digits and underscores, 3–64 chars';
  end if;
  if p_question is null or btrim(p_question) = '' or length(p_question) > 4000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_question';
  end if;
  if p_tools is null or cardinality(p_tools) = 0 or cardinality(p_tools) > 12 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_tools', hint = '1–12 catalog tool names';
  end if;
  foreach v_t in array p_tools loop
    if v_t is null or v_t !~ '^[a-z][a-z0-9_]{1,63}( \{.*\})?$' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_tools', hint = format('%s is not a tool name (optionally followed by a JSON object)', coalesce(v_t, 'null'));
    end if;
  end loop;
  if p_output_schema is null or jsonb_typeof(p_output_schema) <> 'object' or (p_output_schema ->> 'type') <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_output_schema', hint = 'a JSON schema of type object';
  end if;
  if p_default_params is not null and jsonb_typeof(p_default_params) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_default_params';
  end if;
  if exists (select 1 from assistant_components c where c.key = p_key and c.kind = 'builtin') then
    raise exception 'COMPONENT_KEY_TAKEN' using errcode = 'P0001', detail = p_key, hint = 'a built-in card has this key';
  end if;

  insert into assistant_components (key, kind, question, output_schema, tools, default_params, created_by)
  values (p_key, 'pinned', btrim(p_question), p_output_schema, p_tools, coalesce(p_default_params, '{}'::jsonb), auth.uid())
      on conflict (key) do update set
         question       = excluded.question,
         output_schema  = excluded.output_schema,
         tools          = excluded.tools,
         default_params = excluded.default_params,
         created_by     = excluded.created_by,
         archived_at    = null
  returning * into v_row;

  return v_row;
end $assistant_pin_component_0141$;

comment on function app.assistant_pin_component(text, text, text[], jsonb, jsonb) is
  '0141. Owner-only. "Pin to Analytics": stores (or replaces) a pinned component from a chat answer — its question, the tools that answered it and a schema inferred from its figures. Re-pinning an archived key revives it. A built-in key cannot be taken. Audits nothing.';

revoke all on function app.assistant_pin_component(text, text, text[], jsonb, jsonb) from public, anon;
grant execute on function app.assistant_pin_component(text, text, text[], jsonb, jsonb) to authenticated;

create or replace function app.assistant_archive_component(p_key text)
returns assistant_components
language plpgsql security definer set search_path = public as $assistant_archive_component_0141$
declare
  v_row assistant_components%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_key';
  end if;
  select * into v_row from assistant_components where key = p_key;
  if v_row.key is null then
    raise exception 'COMPONENT_NOT_FOUND' using errcode = 'P0001', detail = p_key;
  end if;
  if v_row.kind = 'builtin' then
    raise exception 'COMPONENT_BUILTIN' using errcode = 'P0001', detail = p_key, hint = 'built-in cards are not archived';
  end if;
  update assistant_components
     set archived_at = coalesce(archived_at, now())
   where key = p_key
  returning * into v_row;
  return v_row;
end $assistant_archive_component_0141$;

comment on function app.assistant_archive_component(text) is
  '0141. Owner-only. Stamps archived_at on a pinned component (idempotent); the page hides it and its cache rows stay. Built-ins refuse with COMPONENT_BUILTIN.';

revoke all on function app.assistant_archive_component(text) from public, anon;
grant execute on function app.assistant_archive_component(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The six built-ins (plan §5.4). Re-running refreshes a built-in's
--    definition; pinned rows are never touched.
-- ---------------------------------------------------------------------------
insert into assistant_components (key, kind, question, output_schema, tools, default_params)
values
  ('cafe_findings', 'builtin',
   'Read the cafe figures for this range and write at most five findings, one per angle and only where the data supports it: (1) profit — which items earn the margin and which lose money; (2) conversion and movement — what sells, what stalls, what moved against the comparison period; (3) pricing — average order value, discounts and refunds against sales; (4) mix — best sellers and the hours that carry the day; (5) structure — tabs against orders, waste and voids. Each finding is one plain sentence with its figures, a kind, the subjects it names, its metrics and a confidence. Skip an angle rather than guess. Never restate a rejected finding.',
   $schema$
   {"type":"object","additionalProperties":false,"required":["findings"],"properties":{"findings":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["text","kind","confidence","subjects","metrics","sample"],"properties":{"text":{"type":"string"},"kind":{"type":"string","enum":["profit","conversion","pricing","movement","structural","occupancy","reliability","demand","attach","summary"]},"confidence":{"type":"string","enum":["high","medium","low"]},"subjects":{"type":"array","items":{"type":"string"}},"metrics":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["name","value"],"properties":{"name":{"type":"string"},"value":{"type":"string"}}}},"sample":{"type":["integer","null"]}}}}}}
   $schema$::jsonb,
   array['report_cafe', 'analytics_best_sellers {"limit":10}', 'analytics_item_margins', 'analytics_hourly', 'report_compare {"report":"cafe"}'],
   '{"scope":"cafe","compare":"previousPeriod"}'::jsonb),

  ('courts_findings', 'builtin',
   'Read the courts figures for this range and write at most five findings, one per angle and only where the data supports it: (1) occupancy — which courts, weekdays and hours fill and which stay empty; (2) reliability — cancellations and no-shows, where they cluster; (3) demand — how far ahead people book, durations, the app against the desk; (4) guests — new against returning, regulars, players per booking; (5) attach — cafe spend on court bookings. Each finding is one plain sentence with its figures, a kind, the subjects it names, its metrics and a confidence. Skip an angle rather than guess. Never restate a rejected finding.',
   $schema$
   {"type":"object","additionalProperties":false,"required":["findings"],"properties":{"findings":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["text","kind","confidence","subjects","metrics","sample"],"properties":{"text":{"type":"string"},"kind":{"type":"string","enum":["profit","conversion","pricing","movement","structural","occupancy","reliability","demand","attach","summary"]},"confidence":{"type":"string","enum":["high","medium","low"]},"subjects":{"type":"array","items":{"type":"string"}},"metrics":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["name","value"],"properties":{"name":{"type":"string"},"value":{"type":"string"}}}},"sample":{"type":["integer","null"]}}}}}}
   $schema$::jsonb,
   array['analytics_courts_summary', 'analytics_courts_endings', 'analytics_courts_demand', 'analytics_courts_guests', 'analytics_courts_cafe', 'report_compare {"report":"courts"}'],
   '{"scope":"courts","compare":"previousPeriod"}'::jsonb),

  ('week_paragraph', 'builtin',
   'Write one paragraph, at most four sentences, that tells the owner how this range went: revenue and what carried it (courts or cafe), bookings and orders, and the one figure that moved most against the comparison period. Then list the headline figures you used, each with its label, value and the page route it comes from. Every number must appear in the data.',
   $schema$
   {"type":"object","additionalProperties":false,"required":["paragraph","figures"],"properties":{"paragraph":{"type":"string"},"figures":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["label","value","route"],"properties":{"label":{"type":"string"},"value":{"type":"string"},"route":{"type":"string"}}}}}}
   $schema$::jsonb,
   array['panel_headline'],
   '{"compare":"previousPeriod"}'::jsonb),

  ('what_changed', 'builtin',
   'From the comparison report only, list the figures that changed most between this range and the comparison period: the figure''s name, its value now, its value before, the change in percent (null when the previous value was zero) and the page route. At most eight rows, largest absolute change first. Use only numbers in the data.',
   $schema$
   {"type":"object","additionalProperties":false,"required":["rows"],"properties":{"rows":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["figure","value","previous","change_pct","route"],"properties":{"figure":{"type":"string"},"value":{"type":"string"},"previous":{"type":"string"},"change_pct":{"type":["number","null"]},"route":{"type":"string"}}}}}}
   $schema$::jsonb,
   array['report_compare'],
   '{"compare":"previousPeriod"}'::jsonb),

  ('stock_watch', 'builtin',
   'From the stock views and the stock report, write three short lists: batches expiring soon that matter (name, quantity, when), counted variances worth a look (name, expected against counted), and write-offs in this range (name, quantity or value). One plain sentence per entry, at most five per list, empty list when there is nothing. Use only numbers in the data.',
   $schema$
   {"type":"object","additionalProperties":false,"required":["expiring","variance","writeoffs"],"properties":{"expiring":{"type":"array","items":{"type":"string"}},"variance":{"type":"array","items":{"type":"string"}},"writeoffs":{"type":"array","items":{"type":"string"}}}}
   $schema$::jsonb,
   array['stock_view {"view":"expiring_soon","limit":50}', 'stock_view {"view":"variance","limit":50}', 'report_stock'],
   '{}'::jsonb),

  ('staff_note', 'builtin',
   'Write one paragraph, at most four sentences, on staff activity in this range: who handled the most tabs and payments, where discounts, refunds and voids concentrate, and anything that stands out against the rest of the team. Name staff by the name in the data. Use only numbers in the data; say plainly when the range has too little to judge.',
   $schema$
   {"type":"object","additionalProperties":false,"required":["paragraph"],"properties":{"paragraph":{"type":"string"}}}
   $schema$::jsonb,
   array['report_staff_activity'],
   '{}'::jsonb)
on conflict (key) do update set
  question       = excluded.question,
  output_schema  = excluded.output_schema,
  tools          = excluded.tools,
  default_params = excluded.default_params
where assistant_components.kind = 'builtin';

-- ---------------------------------------------------------------------------
-- 10. Nightly pre-warm: cron → pg_net → /assistant-component {prewarm:true}
-- ---------------------------------------------------------------------------
create or replace function app.assistant_prewarm_nudge()
returns void
language plpgsql security definer set search_path = public as $assistant_prewarm_nudge_0141$
declare
  v_base text;
  v_key  text;
  v_tz   text;
begin
  begin
    select timezone into v_tz from venue_settings limit 1;
    -- 03:30 VENUE time: cron.timezone is GMT, so the row fires every hour at
    -- :30 and only the venue's own 3 o'clock posts.
    if extract(hour from (now() at time zone coalesce(v_tz, 'Asia/Baghdad'))) <> 3 then
      return;
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/assistant-component',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"prewarm":true}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'assistant_prewarm_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $assistant_prewarm_nudge_0141$;

comment on function app.assistant_prewarm_nudge() is
  '0141. Hourly at :30; posts {prewarm:true} to the assistant-component edge function only when the venue''s local hour is 3 (DECIDE 12: the three default ranges are pre-warmed nightly, never generated on page open). Silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.assistant_prewarm_nudge() from public, anon, authenticated;

do $assistant_cron_0141$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - assistant pre-warm skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_assistant_prewarm not scheduled';
    return;
  end if;

  -- cron.schedule upserts by job name (0021). Hourly at :30; the function
  -- keeps the venue's 03:30 (see app.assistant_prewarm_nudge).
  perform cron.schedule('tp_assistant_prewarm', '30 * * * *', 'select app.assistant_prewarm_nudge();');
end $assistant_cron_0141$;
