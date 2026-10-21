set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0353 analytics_compare_bases — "Compare with" is last month, last year or a
-- window the owner picks (owner, 2026-10-22).
--
-- The analytics page compared with "the previous period", "4 weeks earlier"
-- or "52 weeks earlier". The names read as jargon, and a 28-day shift of a
-- 30- or 90-day range overlapped the range itself. The page now offers the
-- same dates a month earlier, the same dates a year earlier, or a custom
-- window, and files its AI findings under:
--
--   month | year | custom:<from>:<to>
--
-- A custom window carries its own dates in the tag, so two different custom
-- comparisons of one period never share a stored set of findings, and no
-- signature or column changes (analytics_insights is keyed by range, basis,
-- locale, scope and court; the tag widens the basis, nothing else).
--
--   1. app.analytics_compare_basis_ok(text): the one test, IMMUTABLE, used by
--      the CHECK and the RPC. prev | 4w | 52w stay valid: rows already stored
--      under them, and an operator build before this one still saving them.
--   2. analytics_insights.compare_basis: the CHECK (0034, inline, so
--      analytics_insights_compare_basis_check) is re-made on that function,
--      NOT VALID then validated (every stored row is one of the old three).
--   3. app.save_analytics_insights (latest 0098): the same signature and
--      body, the basis test widened. The analytics-insights edge function
--      takes the same set.

-- ===========================================================================
-- 1. The test
-- ===========================================================================
create or replace function app.analytics_compare_basis_ok(p_basis text)
returns boolean
language plpgsql immutable set search_path = public as $analytics_compare_basis_ok_0353$
declare
  v_from date;
  v_to   date;
begin
  if p_basis is null then
    return false;
  end if;
  if p_basis in ('month', 'year', 'prev', '4w', '52w') then
    return true;
  end if;
  if p_basis !~ '^custom:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  begin
    v_from := to_date(substr(p_basis, 8, 10), 'YYYY-MM-DD');
    v_to   := to_date(substr(p_basis, 19, 10), 'YYYY-MM-DD');
  exception when others then
    return false;  -- 2026-02-30 has the shape and is no date
  end;
  return v_from <= v_to;
end $analytics_compare_basis_ok_0353$;

comment on function app.analytics_compare_basis_ok(text) is
  '0353. True for an analytics comparison tag: month | year | custom:<from>:<to> (two real YYYY-MM-DD dates, from <= to), or the pre-0353 prev | 4w | 52w. Used by the analytics_insights CHECK and save_analytics_insights.';

-- No client grant: clients write analytics_insights only through the
-- security-definer RPC, which runs it as the owner. The service role keeps it
-- for a direct insert (the stack tests' fixtures), where the CHECK runs as it.
revoke all on function app.analytics_compare_basis_ok(text) from public, anon, authenticated;
grant execute on function app.analytics_compare_basis_ok(text) to service_role;

-- ===========================================================================
-- 2. The CHECK
-- ===========================================================================
alter table analytics_insights drop constraint if exists analytics_insights_compare_basis_check;
alter table analytics_insights add constraint analytics_insights_compare_basis_check
  check (app.analytics_compare_basis_ok(compare_basis)) not valid;
alter table analytics_insights validate constraint analytics_insights_compare_basis_check;

-- ===========================================================================
-- 3. app.save_analytics_insights: 0098 body, the basis test widened.
-- ===========================================================================
create or replace function app.save_analytics_insights(
  p_range_from    date,
  p_range_to      date,
  p_compare_basis text,
  p_locale        text,
  p_insights      jsonb,
  p_scope         text default 'cafe',
  p_court_id      uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_analytics_insights_0353$
declare
  v_row analytics_insights%rowtype;
begin
  perform app.analytics_guard();
  if p_range_from is null or p_range_to is null or p_range_to < p_range_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  -- 0353: month | year | custom:<from>:<to> (an ordered pair of real dates);
  -- prev | 4w | 52w still pass for an operator build before it.
  if not app.analytics_compare_basis_ok(p_compare_basis) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare_basis', hint = 'one of month, year, custom:<from>:<to>';
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
end $fn_save_analytics_insights_0353$;

revoke all on function app.save_analytics_insights(date, date, text, text, jsonb, text, uuid) from public, anon;
grant execute on function app.save_analytics_insights(date, date, text, text, jsonb, text, uuid) to authenticated;
