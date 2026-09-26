-- ===========================================================================
-- 0110 — owner assistant: text search (pgvector + full text), the index queue,
--        freshness triggers, the nudge and the cron sweep.
--
-- docs/design/assistant/owner-assistant-plan-2026-09-20.md §2.4, §2.5, §3.3,
-- §3.5 and build-contracts-2026-09-20.md "Lane A · 0110".
--
-- WHAT IS INDEXED. Text, never numbers: the system map (pages, labels, RPC
-- descriptions, table and column comments, settings, enums, rules, docs) and
-- the free text people write into the venue (customer notes, staff requests,
-- manager alerts, analytics findings and rejections, menu items, promotions).
-- Numbers stay live behind app.assistant_run_tool (0109).
--
-- TWO RANKED LISTS, ONE ANSWER. app.assistant_search fuses cosine distance on
-- a 1024-dim embedding with ts_rank on a `simple`-config tsvector by
-- reciprocal rank fusion (k = 60). Postgres ships no Arabic stemmer, so the
-- multilingual embedding carries Arabic recall and `simple` carries exact
-- tokens (a route, a function name, a code). With no embedding provider
-- configured the caller passes p_embedding = null and the search is full
-- text only — degraded, never broken.
--
-- FRESHNESS. AFTER triggers on the seven free-text tables enqueue (kind, ref,
-- op); the whole trigger body is wrapped so an indexing failure can never fail
-- a business write. app.claim_due_index leases rows exactly like
-- claim_due_notifications (0090: 60 s lease, FOR UPDATE SKIP LOCKED);
-- app.assistant_index_nudge posts to the assistant-index function through
-- pg_net when configured; cron tp_assistant_index_sweep is the fallback and
-- tp_assistant_index_prune clears claimed rows older than a week.
--
-- EXTENSIONS. `vector` lands in schema `extensions` (Supabase convention and
-- the local stack's default; checked). The type is written extensions.vector
-- everywhere and the search function's search_path includes `extensions` so
-- the <=> operator resolves. pg_net is NOT installed here: the nudge checks
-- for the `net` schema at run time, as push_nudge and telegram_nudge do.
--
-- INDEXES. HNSW on embedding and GIN on tsv are created inline on a brand-new,
-- empty table; no writer exists yet. MIGRATION-RISK-ACCEPTED: plain indexes on
-- freshly created empty tables (assistant_chunks, assistant_index_queue).
--
-- covered by packages/db/tests/assistant-search.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. assistant_chunks — the text index
-- ---------------------------------------------------------------------------
create table if not exists assistant_chunks (
  id                bigint generated always as identity primary key,
  kind              text not null check (kind in (
                      'page','nav','rpc','action','table','column','setting','enum','label','rule','doc','system',
                      'note','request','alert','finding','rejection','menu_item','promotion')),
  ref               text not null,
  lang              text not null check (lang in ('en', 'ar')),
  title             text,
  body              text not null,
  route             text,
  embedding         extensions.vector(1024),
  tsv               tsvector generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || body)) stored,
  source_updated_at timestamptz,
  indexed_at        timestamptz not null default now(),
  unique (kind, ref, lang)
);

comment on table assistant_chunks is
  '0110. One searchable piece of text the assistant may cite: a system-map entry (page, nav, rpc, action, table, column, setting, enum, label, rule, doc, system) or a free-text row (note, request, alert, finding, rejection, menu_item, promotion). Written by the assistant-index edge function under the service role; read through app.assistant_search.';
comment on column assistant_chunks.kind is 'What the chunk describes; the scope checkboxes map to kinds (catalog SCOPE_CHUNK_KINDS).';
comment on column assistant_chunks.ref is 'Stable identity of the source: a route, a function name, table.column, or a row id.';
comment on column assistant_chunks.lang is 'en or ar. Map entries exist in both where an Arabic label exists.';
comment on column assistant_chunks.body is 'The cleaned text (phones and emails already pseudonymised by the cleaning function).';
comment on column assistant_chunks.route is 'Where the thing lives in the operator app, so an answer can link to it.';
comment on column assistant_chunks.embedding is '1024-dim embedding from the configured provider (voyage / openai / local zero-padded); null when the provider is none.';
comment on column assistant_chunks.tsv is 'Generated: simple-config tsvector over title and body.';
comment on column assistant_chunks.source_updated_at is 'When the source row or file last changed, so an answer can say how old a text hit is.';
comment on column assistant_chunks.indexed_at is 'When this chunk was last (re)written.';

create index if not exists assistant_chunks_embedding_idx on assistant_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists assistant_chunks_tsv_idx on assistant_chunks using gin (tsv);
create index if not exists assistant_chunks_kind_idx on assistant_chunks (kind);

alter table assistant_chunks enable row level security;
grant select on assistant_chunks to authenticated;
create policy assistant_chunks_select_owner on assistant_chunks
  for select to authenticated using (app.is_staff('owner'));

-- ---------------------------------------------------------------------------
-- 2. assistant_index_queue — what needs (re)indexing
-- ---------------------------------------------------------------------------
create table if not exists assistant_index_queue (
  id          bigint generated always as identity primary key,
  kind        text not null,
  ref         text not null,
  op          text not null check (op in ('upsert', 'delete')),
  enqueued_at timestamptz not null default now(),
  claimed_at  timestamptz,
  attempts    int not null default 0,
  last_error  text
);

comment on table assistant_index_queue is
  '0110. Outbox for the text index: one row per source change (kind, ref, op). Filled by the after-triggers below, leased by app.claim_due_index (60 s), deleted by app.assistant_index_done; failures keep the row with last_error for up to 5 attempts; tp_assistant_index_prune removes claimed leftovers after 7 days.';
comment on column assistant_index_queue.op is 'upsert (re-read the source and rewrite the chunk) or delete (the source row is gone).';
comment on column assistant_index_queue.claimed_at is 'Lease stamp: a row claimed within the last 60 s is skipped by the next claim and by the nudge.';
comment on column assistant_index_queue.attempts is 'Claims so far; rows stop being offered at 5.';

create index if not exists assistant_index_queue_due_idx on assistant_index_queue (enqueued_at)
  where claimed_at is null;

alter table assistant_index_queue enable row level security;
grant select on assistant_index_queue to authenticated;
create policy assistant_index_queue_select_owner on assistant_index_queue
  for select to authenticated using (app.is_staff('owner'));

-- The two new tables join the table_read allowlist (0109 seeded before they
-- existed). embedding and tsv are readable when named, never by default.
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'table',
       c.column_name not in ('embedding', 'tsv'),
       c.data_type, c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name in ('assistant_chunks', 'assistant_index_queue')
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_search — RRF over cosine and full text (plan §2.4)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_search(
  p_query     text,
  p_embedding extensions.vector(1024) default null,
  p_kinds     text[] default null,
  p_limit     int default 12
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $assistant_search_0110$
declare
  v_q     tsquery;
  v_limit int := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_out   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_query), '') is not null then
    v_q := websearch_to_tsquery('simple', p_query);
  end if;
  if v_q is null and p_embedding is null then
    return '[]'::jsonb;
  end if;

  with sem as (
    select c.id, row_number() over (order by c.embedding <=> p_embedding) as rnk
      from assistant_chunks c
     where p_embedding is not null and c.embedding is not null
       and (p_kinds is null or c.kind = any (p_kinds))
     order by c.embedding <=> p_embedding
     limit 50
  ), lex as (
    select c.id, row_number() over (order by ts_rank(c.tsv, v_q) desc, c.id) as rnk
      from assistant_chunks c
     where v_q is not null and c.tsv @@ v_q
       and (p_kinds is null or c.kind = any (p_kinds))
     order by ts_rank(c.tsv, v_q) desc, c.id
     limit 50
  ), fused as (
    select id, sum(1.0 / (60 + rnk)) as score
      from (select id, rnk from sem union all select id, rnk from lex) u
     group by id
     order by score desc, id
     limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                c.id,
           'kind',              c.kind,
           'ref',               c.ref,
           'lang',              c.lang,
           'title',             c.title,
           'snippet',           left(c.body, 300),
           'route',             c.route,
           'score',             round(f.score::numeric, 6),
           'source_updated_at', c.source_updated_at
         ) order by f.score desc, c.id), '[]'::jsonb)
    into v_out
    from fused f
    join assistant_chunks c on c.id = f.id;

  return v_out;
end $assistant_search_0110$;

comment on function app.assistant_search(text, extensions.vector, text[], int) is
  '0110. Owner-only, read-only. Hybrid search over assistant_chunks: top-50 by cosine on p_embedding (skipped when null) and top-50 by ts_rank(simple) on p_query, fused by reciprocal rank (k = 60), filtered to p_kinds when given. Returns [{id, kind, ref, lang, title, snippet, route, score, source_updated_at}].';

revoke all on function app.assistant_search(text, extensions.vector, text[], int) from public, anon;
grant execute on function app.assistant_search(text, extensions.vector, text[], int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Service-role RPCs for the assistant-index function
-- ---------------------------------------------------------------------------
create or replace function app.claim_due_index(p_limit int default 50)
returns setof assistant_index_queue
language sql security definer set search_path = public as $claim_due_index_0110$
  update assistant_index_queue q
     set attempts   = q.attempts + 1,
         claimed_at = now()
    from (
      select id from assistant_index_queue
       where attempts < 5
         and (claimed_at is null or claimed_at <= now() - interval '60 seconds')
       order by enqueued_at
       for update skip locked
       limit p_limit
    ) due
   where q.id = due.id
  returning q.*;
$claim_due_index_0110$;

comment on function app.claim_due_index(int) is
  '0110. Service role only. Leases up to p_limit due queue rows for 60 s (same lease as claim_due_notifications, 0090) and bumps attempts. Rows stop being offered after 5 attempts.';

revoke all on function app.claim_due_index(int) from public, anon, authenticated;
grant execute on function app.claim_due_index(int) to service_role;

create or replace function app.assistant_index_done(p_ids bigint[])
returns int
language plpgsql security definer set search_path = public as $assistant_index_done_0110$
declare
  v_n int;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  delete from assistant_index_queue where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $assistant_index_done_0110$;

comment on function app.assistant_index_done(bigint[]) is
  '0110. Service role only. Removes queue rows the index function has finished; returns how many.';

revoke all on function app.assistant_index_done(bigint[]) from public, anon, authenticated;
grant execute on function app.assistant_index_done(bigint[]) to service_role;

create or replace function app.assistant_index_fail(p_id bigint, p_error text)
returns void
language plpgsql security definer set search_path = public as $assistant_index_fail_0110$
begin
  -- Release the lease so the next sweep retries (until attempts reaches 5).
  update assistant_index_queue
     set last_error = left(coalesce(p_error, 'unknown'), 500),
         claimed_at = null
   where id = p_id;
end $assistant_index_fail_0110$;

comment on function app.assistant_index_fail(bigint, text) is
  '0110. Service role only. Records why a queue row could not be indexed and releases its lease for a retry.';

revoke all on function app.assistant_index_fail(bigint, text) from public, anon, authenticated;
grant execute on function app.assistant_index_fail(bigint, text) to service_role;

-- The cleaned-by-projection source row for one chunk: only the columns the
-- plan lists per kind, never secrets, never redeemable codes. NULL when the
-- row is gone (the caller then deletes the chunk).
create or replace function app.assistant_chunk_source(p_kind text, p_ref text)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_chunk_source_0110$
declare
  v_id  uuid;
  v_out jsonb;
begin
  begin
    v_id := p_ref::uuid;
  exception when invalid_text_representation then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_ref', hint = 'a row uuid';
  end;

  case p_kind
    when 'note' then
      select jsonb_build_object(
               'kind', 'note', 'ref', n.id, 'route', '/desk/customers',
               'source_updated_at', coalesce(n.edited_at, n.created_at),
               'customer_id', n.customer_id, 'customer_name', pr.full_name,
               'body', n.body, 'author_name', s.display_name,
               'created_at', n.created_at, 'edited_at', n.edited_at)
        into v_out
        from customer_notes n
        left join profiles pr on pr.id = n.customer_id
        left join staff s on s.id = n.author_id
       where n.id = v_id;
    when 'request' then
      select jsonb_build_object(
               'kind', 'request', 'ref', r.id, 'route', '/observation/requests',
               'source_updated_at', coalesce(r.decided_at, r.created_at),
               'staff_name', s.display_name, 'request_kind', r.kind, 'status', r.status,
               'from_date', r.from_date, 'to_date', r.to_date, 'amount_iqd', r.amount_iqd,
               'note', r.note, 'decided_by_name', d.display_name, 'decision_note', r.decision_note,
               'created_at', r.created_at, 'decided_at', r.decided_at)
        into v_out
        from staff_requests r
        left join staff s on s.id = r.staff_id
        left join staff d on d.id = r.decided_by
       where r.id = v_id;
    when 'alert' then
      select jsonb_build_object(
               'kind', 'alert', 'ref', a.id, 'route', '/stock/alerts',
               'source_updated_at', coalesce(a.acknowledged_at, a.created_at),
               'alert_kind', a.kind, 'payload', a.payload,
               'ingredient_name_en', i.name_en, 'ingredient_name_ar', i.name_ar,
               'created_at', a.created_at, 'acknowledged_at', a.acknowledged_at,
               'acknowledged_by_name', s.display_name)
        into v_out
        from manager_alerts a
        left join ingredients i on i.id::text = a.payload ->> 'ingredient_id'
        left join staff s on s.id = a.acknowledged_by
       where a.id = v_id;
    when 'finding' then
      select jsonb_build_object(
               'kind', 'finding', 'ref', f.id,
               'route', case when f.scope = 'courts' then '/analytics/courts' else '/analytics/cafe' end,
               'source_updated_at', f.created_at,
               'range_from', f.range_from, 'range_to', f.range_to, 'compare_basis', f.compare_basis,
               'locale', f.locale, 'scope', f.scope, 'court_id', f.court_id,
               'insights', f.insights, 'created_at', f.created_at)
        into v_out
        from analytics_insights f
       where f.id = v_id;
    when 'rejection' then
      select jsonb_build_object(
               'kind', 'rejection', 'ref', r.id, 'route', '/analytics/cafe',
               'source_updated_at', r.created_at,
               'text', r.text, 'reason', r.reason, 'created_at', r.created_at)
        into v_out
        from analytics_insight_rejections r
       where r.id = v_id;
    when 'menu_item' then
      select jsonb_build_object(
               'kind', 'menu_item', 'ref', m.id, 'route', '/admin/menu',
               'source_updated_at', null,
               'name_en', m.name_en, 'name_ar', m.name_ar,
               'description_en', m.description_en, 'description_ar', m.description_ar,
               'hook_en', m.hook_en, 'hook_ar', m.hook_ar, 'highlight', m.highlight,
               'category_name_en', c.name_en, 'category_name_ar', c.name_ar,
               'is_active', m.is_active, 'sold_out', m.sold_out, 'serve_temp', m.serve_temp)
        into v_out
        from menu_items m
        left join menu_categories c on c.id = m.category_id
       where m.id = v_id;
    when 'promotion' then
      -- public_code is a redeemable coupon: not indexed.
      select jsonb_build_object(
               'kind', 'promotion', 'ref', p.id, 'route', '/admin/promotions',
               'source_updated_at', coalesce(p.updated_at, p.created_at),
               'name_en', p.name_en, 'name_ar', p.name_ar, 'type', p.type, 'value', p.value,
               'starts_at', p.starts_at, 'ends_at', p.ends_at, 'weekdays', p.weekdays,
               'hour_from', p.hour_from, 'hour_to', p.hour_to, 'scope', p.scope, 'limits', p.limits,
               'auto', p.auto, 'enabled', p.enabled)
        into v_out
        from promotions p
       where p.id = v_id;
    else
      raise exception 'INVALID_KIND' using errcode = 'P0001', detail = coalesce(p_kind, 'null'),
        hint = 'note, request, alert, finding, rejection, menu_item, promotion';
  end case;

  return v_out;   -- null when the row no longer exists
end $assistant_chunk_source_0110$;

comment on function app.assistant_chunk_source(text, text) is
  '0110. Service role only. The projected source row for one free-text chunk kind (note, request, alert, finding, rejection, menu_item, promotion): only the columns the plan lists, no secrets, no coupon codes. NULL when the row is gone.';

revoke all on function app.assistant_chunk_source(text, text) from public, anon, authenticated;
grant execute on function app.assistant_chunk_source(text, text) to service_role;

create or replace function app.assistant_upsert_chunk(p jsonb)
returns bigint
language plpgsql security definer set search_path = public, extensions as $assistant_upsert_chunk_0110$
declare
  v_id  bigint;
  v_emb extensions.vector(1024);
begin
  if p is null or jsonb_typeof(p) <> 'object'
     or nullif(p ->> 'kind', '') is null or nullif(p ->> 'ref', '') is null
     or nullif(p ->> 'lang', '') is null or (p ->> 'body') is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p',
      hint = '{kind, ref, lang, title?, body, route?, embedding?, source_updated_at?}';
  end if;
  if p -> 'embedding' is not null and jsonb_typeof(p -> 'embedding') = 'array' then
    v_emb := (p ->> 'embedding')::extensions.vector(1024);
  end if;

  insert into assistant_chunks as c (kind, ref, lang, title, body, route, embedding, source_updated_at, indexed_at)
  values (p ->> 'kind', p ->> 'ref', p ->> 'lang', p ->> 'title', p ->> 'body', p ->> 'route',
          v_emb, (p ->> 'source_updated_at')::timestamptz, now())
      on conflict (kind, ref, lang) do update set
        title             = excluded.title,
        body              = excluded.body,
        route             = excluded.route,
        embedding         = excluded.embedding,
        source_updated_at = excluded.source_updated_at,
        indexed_at        = now()
  returning c.id into v_id;
  return v_id;
end $assistant_upsert_chunk_0110$;

comment on function app.assistant_upsert_chunk(jsonb) is
  '0110. Service role only. Inserts or rewrites one chunk keyed by (kind, ref, lang); embedding is a JSON array of 1024 numbers or absent. Returns the chunk id.';

revoke all on function app.assistant_upsert_chunk(jsonb) from public, anon, authenticated;
grant execute on function app.assistant_upsert_chunk(jsonb) to service_role;

create or replace function app.assistant_delete_chunk(p_kind text, p_ref text)
returns int
language plpgsql security definer set search_path = public as $assistant_delete_chunk_0110$
declare
  v_n int;
begin
  delete from assistant_chunks where kind = p_kind and ref = p_ref;
  get diagnostics v_n = row_count;
  return v_n;
end $assistant_delete_chunk_0110$;

comment on function app.assistant_delete_chunk(text, text) is
  '0110. Service role only. Removes every language variant of one chunk; returns how many rows went.';

revoke all on function app.assistant_delete_chunk(text, text) from public, anon, authenticated;
grant execute on function app.assistant_delete_chunk(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.assistant_index_nudge — pg_net post, guarded like push_nudge (0090)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_index_nudge()
returns void
language plpgsql security definer set search_path = public as $assistant_index_nudge_0110$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from assistant_index_queue
                    where attempts < 5
                      and (claimed_at is null or claimed_at <= now() - interval '60 seconds')) then
      return;
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed: cron sweep only
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/assistant-index',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'assistant_index_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $assistant_index_nudge_0110$;

comment on function app.assistant_index_nudge() is
  '0110. Asks the assistant-index edge function to drain the queue now, through pg_net, when anything is due and unclaimed. Silent without pg_net or without the functions_base_url / service_role_key secrets; swallows its own errors so it can never fail a caller.';

revoke all on function app.assistant_index_nudge() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The freshness triggers — never fail the parent write
-- ---------------------------------------------------------------------------
create or replace function app.assistant_enqueue_index()
returns trigger
language plpgsql security definer set search_path = public as $assistant_enqueue_index_0110$
declare
  v_kind text;
  v_ref  text;
begin
  begin
    v_kind := case tg_table_name
                when 'customer_notes'               then 'note'
                when 'staff_requests'               then 'request'
                when 'manager_alerts'               then 'alert'
                when 'analytics_insights'           then 'finding'
                when 'analytics_insight_rejections' then 'rejection'
                when 'menu_items'                   then 'menu_item'
                when 'promotions'                   then 'promotion'
              end;
    if v_kind is null then
      return null;
    end if;
    v_ref := case when tg_op = 'DELETE' then old.id::text else new.id::text end;

    insert into assistant_index_queue (kind, ref, op)
    values (v_kind, v_ref, case when tg_op = 'DELETE' then 'delete' else 'upsert' end);

    perform app.assistant_index_nudge();
  exception when others then
    -- An indexing hiccup is never a reason to refuse a note, a request or a
    -- menu edit. The cron sweep and the deploy-time map run catch up.
    null;
  end;
  return null;
end $assistant_enqueue_index_0110$;

comment on function app.assistant_enqueue_index() is
  '0110. AFTER INSERT/UPDATE/DELETE trigger on the seven free-text tables: queues (kind, ref, op) for the text index and nudges the indexer. The whole body is wrapped; it can never fail the business write that fired it.';

revoke all on function app.assistant_enqueue_index() from public, anon, authenticated;

drop trigger if exists assistant_index_customer_notes on customer_notes;
create trigger assistant_index_customer_notes
  after insert or update or delete on customer_notes
  for each row execute function app.assistant_enqueue_index();

drop trigger if exists assistant_index_staff_requests on staff_requests;
create trigger assistant_index_staff_requests
  after insert or update or delete on staff_requests
  for each row execute function app.assistant_enqueue_index();

drop trigger if exists assistant_index_manager_alerts on manager_alerts;
create trigger assistant_index_manager_alerts
  after insert or update or delete on manager_alerts
  for each row execute function app.assistant_enqueue_index();

drop trigger if exists assistant_index_analytics_insights on analytics_insights;
create trigger assistant_index_analytics_insights
  after insert or update or delete on analytics_insights
  for each row execute function app.assistant_enqueue_index();

drop trigger if exists assistant_index_analytics_insight_rejections on analytics_insight_rejections;
create trigger assistant_index_analytics_insight_rejections
  after insert or update or delete on analytics_insight_rejections
  for each row execute function app.assistant_enqueue_index();

drop trigger if exists assistant_index_menu_items on menu_items;
create trigger assistant_index_menu_items
  after insert or update or delete on menu_items
  for each row execute function app.assistant_enqueue_index();

drop trigger if exists assistant_index_promotions on promotions;
create trigger assistant_index_promotions
  after insert or update or delete on promotions
  for each row execute function app.assistant_enqueue_index();

-- ---------------------------------------------------------------------------
-- 7. Cron: the sweep every minute, the prune nightly. Guarded like 0032.
-- ---------------------------------------------------------------------------
do $assistant_cron_0110$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - assistant index jobs skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_assistant_index_sweep / tp_assistant_index_prune not scheduled';
    return;
  end if;

  -- cron.schedule upserts by job name (0021).
  perform cron.schedule('tp_assistant_index_sweep', '* * * * *', 'select app.assistant_index_nudge();');
  perform cron.schedule('tp_assistant_index_prune', '45 3 * * *',
    $prune$delete from public.assistant_index_queue where claimed_at is not null and claimed_at < now() - interval '7 days';$prune$);
end $assistant_cron_0110$;
