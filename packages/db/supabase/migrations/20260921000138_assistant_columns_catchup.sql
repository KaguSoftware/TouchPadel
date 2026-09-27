-- ===========================================================================
-- 0138 — the assistant's column allowlist catches up with the venue axis.
--
-- app.assistant_readable_columns (0109:94) is what app.assistant_table_read
-- builds its SELECT from, and what describe() reads back to the owner. It is
-- seeded BY MIGRATION and never by the model: a column that is not in the
-- table cannot be named, which is the whole safety property. So a column added
-- after 0109 is invisible to the assistant until a migration re-runs the seed
-- — and slice 1 added 39 of them: venue_id on 35 scoped tables, venue_id on
-- venue_settings, and every column of the three new tables (venues,
-- staff_venues, stations). Without this file the owner could ask "which venue
-- is this booking at?" and be told the column does not exist.
--
-- The statement below is the 0109:120-146 seed VERBATIM — the same secret-name
-- predicate, the same is_default rule, the same data_type / ordinal / comment
-- capture. Not a variation on it: if the two ever disagree, the allowlist
-- means two different things depending on which migration last touched a
-- table, and that is not a property anybody can reason about. Re-running the
-- whole seed also picks up any other column added between 0109 and now.
--
-- IDEMPOTENT BY `on conflict (table_name, column_name) do nothing`, which the
-- original already carries: existing rows keep the data_type, ordinal and note
-- they were seeded with, and only genuinely new (table, column) pairs are
-- inserted. That is the wanted behaviour — this file adds, it never rewrites
-- what an earlier seed decided.
--
-- The three new tables also need their `table_read` entries in
-- fixtures/assistant-coverage.json, in this same commit; check:assistant-coverage
-- re-derives the inventory from the migrations and fails on a missing key.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   -- Secrets never enter the allowlist. The name patterns also match token
   -- COUNTERS (llm_usage.prompt_tokens, cafe_tables.token_version,
   -- venue_settings.table_token_ttl_minutes); a secret is text, a counter is
   -- a number, so numeric and boolean columns are kept.
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
