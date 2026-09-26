-- 0098 — stored AI sets keyed by court.
--
-- The Courts tab has a court filter (0093/0097). A set of findings generated
-- with court A selected is about court A, and showed up under "all courts"
-- (and under court B) because the stored row carried only (range, basis,
-- locale, scope). This adds the court to the key:
--
--   1. analytics_insights.court_id / analytics_patterns.court_id — nullable,
--      references courts, cascades with the court; NULL = the venue-wide set.
--      The FK and the scope check are added NOT VALID then VALIDATED, the
--      two-step this repo uses for constraints on live tables.
--   2. check: a court key is only meaningful on the courts scope.
--   3. app.save_analytics_insights / app.save_analytics_patterns — dropped by
--      their exact 0094 signature and recreated with `p_court_id uuid default
--      null` appended. INVALID_ARGUMENT when the court is given with a scope
--      other than courts, or names no court. Bodies are the 0094 bodies plus
--      that check and the column; grants restated on the new signatures.
--
-- Reads stay owner-RLS on the tables; the operator filters court_id itself
-- (= the selected court, or IS NULL for the venue-wide set).

-- ---------------------------------------------------------------------------
-- 1 + 2. the column and its constraints
-- ---------------------------------------------------------------------------
alter table analytics_insights add column if not exists court_id uuid;
alter table analytics_patterns add column if not exists court_id uuid;

alter table analytics_insights
  add constraint analytics_insights_court_id_fkey
  foreign key (court_id) references courts(id) on delete cascade not valid;
alter table analytics_insights validate constraint analytics_insights_court_id_fkey;

alter table analytics_patterns
  add constraint analytics_patterns_court_id_fkey
  foreign key (court_id) references courts(id) on delete cascade not valid;
alter table analytics_patterns validate constraint analytics_patterns_court_id_fkey;

alter table analytics_insights
  add constraint analytics_insights_court_scope_check
  check (court_id is null or scope = 'courts') not valid;
alter table analytics_insights validate constraint analytics_insights_court_scope_check;

alter table analytics_patterns
  add constraint analytics_patterns_court_scope_check
  check (court_id is null or scope = 'courts') not valid;
alter table analytics_patterns validate constraint analytics_patterns_court_scope_check;

comment on column analytics_insights.court_id is
  '0098: the court the set was generated for (the Courts tab filter); NULL = venue-wide. Only with scope = courts.';
comment on column analytics_patterns.court_id is
  '0098: the court the set was generated for (the Courts tab filter); NULL = venue-wide. Only with scope = courts.';

-- ---------------------------------------------------------------------------
-- 3a. app.save_analytics_insights: 0094 body + p_court_id.
--     NEW SIGNATURE: p_court_id appended (7 args). Old 6-arg signature dropped.
-- ---------------------------------------------------------------------------
drop function if exists app.save_analytics_insights(date, date, text, text, jsonb, text);

create or replace function app.save_analytics_insights(
  p_range_from    date,
  p_range_to      date,
  p_compare_basis text,
  p_locale        text,
  p_insights      jsonb,
  p_scope         text default 'cafe',
  p_court_id      uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_analytics_insights_0098$
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
  -- 0098: which court, when the Courts tab was filtered to one.
  if p_court_id is not null then
    if p_scope <> 'courts' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'p_court_id', hint = 'a court key needs scope courts';
    end if;
    if not exists (select 1 from courts c where c.id = p_court_id) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'p_court_id', hint = 'unknown court';
    end if;
  end if;

  insert into analytics_insights (range_from, range_to, compare_basis, locale, insights, created_by, scope, court_id)
  values (p_range_from, p_range_to, p_compare_basis, p_locale, p_insights, auth.uid(), p_scope, p_court_id)
  returning * into v_row;

  perform app.write_audit('analytics.insights.save', 'analytics_insights', v_row.id::text,
                          null,
                          jsonb_build_object('range_from', v_row.range_from, 'range_to', v_row.range_to,
                                             'compare_basis', v_row.compare_basis, 'locale', v_row.locale,
                                             'scope', v_row.scope, 'court_id', v_row.court_id,
                                             'count', jsonb_array_length(v_row.insights)));
  return v_row.id;
end $fn_save_analytics_insights_0098$;

revoke all on function app.save_analytics_insights(date, date, text, text, jsonb, text, uuid) from public, anon;
grant execute on function app.save_analytics_insights(date, date, text, text, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. app.save_analytics_patterns: 0094 body + p_court_id.
--     NEW SIGNATURE: p_court_id appended (6 args). Old 5-arg signature dropped.
-- ---------------------------------------------------------------------------
drop function if exists app.save_analytics_patterns(date, date, text, jsonb, text);

create or replace function app.save_analytics_patterns(
  p_range_from date,
  p_range_to   date,
  p_locale     text,
  p_patterns   jsonb,
  p_scope      text default 'cafe',
  p_court_id   uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_analytics_patterns_0098$
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
  -- 0098: which court, when the Courts tab was filtered to one.
  if p_court_id is not null then
    if p_scope <> 'courts' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'p_court_id', hint = 'a court key needs scope courts';
    end if;
    if not exists (select 1 from courts c where c.id = p_court_id) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'p_court_id', hint = 'unknown court';
    end if;
  end if;

  insert into analytics_patterns (range_from, range_to, locale, patterns, created_by, scope, court_id)
  values (p_range_from, p_range_to, p_locale, p_patterns, auth.uid(), p_scope, p_court_id)
  returning * into v_row;

  perform app.write_audit('analytics.patterns.save', 'analytics_patterns', v_row.id::text,
                          null,
                          jsonb_build_object('range_from', v_row.range_from, 'range_to', v_row.range_to,
                                             'locale', v_row.locale,
                                             'scope', v_row.scope, 'court_id', v_row.court_id,
                                             'count', jsonb_array_length(v_row.patterns)));
  return v_row.id;
end $fn_save_analytics_patterns_0098$;

revoke all on function app.save_analytics_patterns(date, date, text, jsonb, text, uuid) from public, anon;
grant execute on function app.save_analytics_patterns(date, date, text, jsonb, text, uuid) to authenticated;
