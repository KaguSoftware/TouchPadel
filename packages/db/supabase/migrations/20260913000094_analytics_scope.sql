-- 0094_analytics_scope: which tab an AI insight set or a mined-pattern set
-- belongs to. The Courts analytics tab (0093) produces its own insights and
-- patterns, stored in the same two tables the cafe tab has used since 0034,
-- so each row now says which surface it is for.
--
-- WHAT. `scope text not null default 'cafe'` on analytics_insights and on
-- analytics_patterns, checked to 'cafe' | 'courts'. Every existing row is the
-- cafe's (nothing else wrote these tables before 0093), which the default
-- states. The two writers, app.save_analytics_insights and
-- app.save_analytics_patterns, take a trailing `p_scope text default 'cafe'`,
-- validate it (INVALID_ARGUMENT) and store it. Readers filter by scope on the
-- client; the existing analytics_*_range indexes stay as they are (tens of
-- rows, scope is a residual predicate).
--
-- WHY DROP AND RE-CREATE. Adding a defaulted parameter with `create or
-- replace` leaves the old signature in place as a second overload, and
-- PostgREST then refuses BOTH to a caller that omits p_scope (PGRST203).
-- Each function is dropped by its exact 0034 signature and re-created with
-- the 0034 body verbatim plus the parameter, the check and the column.
--
-- GRANTS. A freshly created function is EXECUTE-able by PUBLIC by default,
-- so both get the revoke-then-grant they had (0034 section 7).
--
-- Posture: `add column ... default 'cafe'` is a catalog-only change on
-- PG 11+ (no rewrite); the CHECKs go in NOT VALID and are validated
-- separately in an idempotent block (0071 / 0092 precedent).
--
-- covered by tests/analytics.test.ts (scope round-trip)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table analytics_insights add column if not exists scope text not null default 'cafe';
alter table analytics_patterns add column if not exists scope text not null default 'cafe';

comment on column analytics_insights.scope is
  '0094. Which analytics tab this insight set belongs to: cafe (0034 sales insights) or courts (0093). Rows written before 0094 are the cafe''s.';
comment on column analytics_patterns.scope is
  '0094. Which analytics tab this pattern set belongs to: cafe (0034) or courts (0093). Rows written before 0094 are the cafe''s.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'analytics_insights_scope_check') then
    alter table analytics_insights
      add constraint analytics_insights_scope_check
      check (scope in ('cafe', 'courts')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analytics_patterns_scope_check') then
    alter table analytics_patterns
      add constraint analytics_patterns_scope_check
      check (scope in ('cafe', 'courts')) not valid;
  end if;
end $$;

alter table analytics_insights validate constraint analytics_insights_scope_check;
alter table analytics_patterns validate constraint analytics_patterns_scope_check;

-- ---------------------------------------------------------------------------
-- 2. app.save_analytics_insights: 0034 body verbatim + p_scope.
--    NEW SIGNATURE: p_scope appended (6 args). Old 5-arg signature dropped.
-- ---------------------------------------------------------------------------
drop function if exists app.save_analytics_insights(date, date, text, text, jsonb);

create or replace function app.save_analytics_insights(
  p_range_from    date,
  p_range_to      date,
  p_compare_basis text,
  p_locale        text,
  p_insights      jsonb,
  p_scope         text default 'cafe'
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_analytics_insights_0094$
declare
  v_row analytics_insights%rowtype;
begin
  perform app.analytics_guard();
  if p_range_from is null or p_range_to is null or p_range_to < p_range_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  if p_compare_basis is null or p_compare_basis not in ('prev', '4w', '52w') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare_basis', hint = 'one of prev, 4w, 52w';
  end if;
  if p_locale is null or p_locale not in ('ar', 'en') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_locale', hint = 'one of ar, en';
  end if;
  if p_insights is null or jsonb_typeof(p_insights) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_insights', hint = 'a JSON array of findings';
  end if;
  -- 0094: which tab the set belongs to.
  if p_scope is null or p_scope not in ('cafe', 'courts') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_scope', hint = 'one of cafe, courts';
  end if;

  insert into analytics_insights (range_from, range_to, compare_basis, locale, insights, created_by, scope)
  values (p_range_from, p_range_to, p_compare_basis, p_locale, p_insights, auth.uid(), p_scope)
  returning * into v_row;

  perform app.write_audit('analytics.insights.save', 'analytics_insights', v_row.id::text,
                          null,
                          jsonb_build_object('range_from', v_row.range_from, 'range_to', v_row.range_to,
                                             'compare_basis', v_row.compare_basis, 'locale', v_row.locale,
                                             'scope', v_row.scope,
                                             'count', jsonb_array_length(v_row.insights)));
  return v_row.id;
end $fn_save_analytics_insights_0094$;

revoke all on function app.save_analytics_insights(date, date, text, text, jsonb, text) from public, anon;
grant execute on function app.save_analytics_insights(date, date, text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.save_analytics_patterns: 0034 body verbatim + p_scope.
--    NEW SIGNATURE: p_scope appended (5 args). Old 4-arg signature dropped.
-- ---------------------------------------------------------------------------
drop function if exists app.save_analytics_patterns(date, date, text, jsonb);

create or replace function app.save_analytics_patterns(
  p_range_from date,
  p_range_to   date,
  p_locale     text,
  p_patterns   jsonb,
  p_scope      text default 'cafe'
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_analytics_patterns_0094$
declare
  v_row analytics_patterns%rowtype;
begin
  perform app.analytics_guard();
  if p_range_from is null or p_range_to is null or p_range_to < p_range_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  if p_locale is null or p_locale not in ('ar', 'en') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_locale', hint = 'one of ar, en';
  end if;
  if p_patterns is null or jsonb_typeof(p_patterns) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_patterns', hint = 'a JSON array of patterns';
  end if;
  -- 0094: which tab the set belongs to.
  if p_scope is null or p_scope not in ('cafe', 'courts') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_scope', hint = 'one of cafe, courts';
  end if;

  insert into analytics_patterns (range_from, range_to, locale, patterns, created_by, scope)
  values (p_range_from, p_range_to, p_locale, p_patterns, auth.uid(), p_scope)
  returning * into v_row;

  perform app.write_audit('analytics.patterns.save', 'analytics_patterns', v_row.id::text,
                          null,
                          jsonb_build_object('range_from', v_row.range_from, 'range_to', v_row.range_to,
                                             'locale', v_row.locale,
                                             'scope', v_row.scope,
                                             'count', jsonb_array_length(v_row.patterns)));
  return v_row.id;
end $fn_save_analytics_patterns_0094$;

revoke all on function app.save_analytics_patterns(date, date, text, jsonb, text) from public, anon;
grant execute on function app.save_analytics_patterns(date, date, text, jsonb, text) to authenticated;
