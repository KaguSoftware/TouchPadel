set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0424 assistant_cafe_history: the owner assistant's figures follow 0412,
-- which put the old café till's days (Morabaa, 2 June to 31 October 2026,
-- legacy_cafe_days) into analytics_daily_sales, analytics_hourly and
-- panel_headline. The history_figures tool and its prompt promise "totals
-- equal panel_headline"; after 0412 they did not (a range over October read
-- 11,275,847 against the panel's 24,472,347), and costs_summary gave a cash
-- result over revenue that has no costs behind it.
--
-- 1. history_figures. Totals add app.legacy_cafe_totals through
--    app.legacy_cafe_add_to_figures, as panel_headline does (0412:547), so
--    they equal the panel again for any range: revenue and cafeNet + the old
--    till's net, cafeRevenue + its gross, orders, discounts, avgOrderValue
--    recomputed; cash, card, refunds and waste get nothing. The till has days,
--    so the ROWS gain it too, in every group (day, week, month), each bucket
--    clipped to the range. Cost: one legacy_cafe_totals call for the range,
--    and only when that finds old-till days, one more per bucket (at most 31,
--    each a primary-key range read of legacy_cafe_hours over at most a month
--    of one branch). `history` gains `cafe`: the legacy_cafe_totals object
--    plus inRows (true: the rows carry it), null when the range holds no
--    old-till day; history itself is now also present when only the café
--    touches the range. 0420's padel-report behaviour is unchanged. Nothing is
--    written to the day cache tables: the stored days stay reports_figures and
--    the old till is added at read time.
--    Unchanged and system-only on purpose: app.assistant_history_items and the
--    detail families (assistant_detail_compute 0420) rank menu items by id
--    from analytics_sold_items; the old till's products are its own names,
--    never menu items, so they are answered by the cafe_history tool instead.
-- 2. costs_summary. No cash result (null, the note says why) when the range's
--    revenue holds old café till days (panel_headline history.period.cafe.days
--    > 0), as already when it holds a padel monthly report: both are revenue
--    with no costs. totals gain old_till_revenue_iqd (history.period.cafe.net,
--    0 without old-till days), read from the panel object already fetched.
-- 3. New tool cafe_history: app.analytics_cafe_history (0412:599) dispatched
--    directly. Its guard is analytics_guard (owner, or marketing only while
--    marketing_insights holds its transaction-local assertion; the
--    dispatcher's owner check comes first), its branches are
--    app.report_venues() (the reports' rule, as 0406's tools) and
--    analytics_bounds only picks the clock, so no one-branch
--    app.current_venue() and no wider admission than the dispatcher's: no
--    wrapper is needed, unlike the 0421 tools.
--
-- Re-issued verbatim from their latest bodies except the lines marked 0424:
--   app.assistant_history_figures  20261114000420_assistant_history_reports.sql:61
--   app.assistant_costs_summary    20261114000421_assistant_money_staff_tools.sql:234
--   app.assistant_run_tool         20261114000421_assistant_money_staff_tools.sql:703
--                                  (+ the one branch for the new tool)
-- Same signatures, STABLE, SECURITY DEFINER, search_path, guards and grants.
-- Needs 0412 (app.legacy_cafe_totals, app.legacy_cafe_add_to_figures,
-- app.analytics_cafe_history, panel_headline's history.period.cafe).
--
-- covered by packages/db/tests/assistant-cafe-history.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app.assistant_history_figures: + the old café till, totals and rows
-- ---------------------------------------------------------------------------
create or replace function app.assistant_history_figures(
  p_from  date,
  p_to    date,
  p_group text default 'day',
  p_extra boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_history_figures_0424$
declare
  v_rv      uuid[];
  v_scope   text;
  v_cfg     assistant_cache_config%rowtype;
  v_enabled boolean;
  v_edge    date;
  v_group   text := coalesce(p_group, 'day');
  v_keys    text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','bookings','orders','discounts','refunds','waste','noShows'];
  v_more    text[] := array['onlineDeposits','depositForfeits','ticketSales','ticketRefunds','ticketForfeits','matchWrittenOff','lessonRevenue','owedToCoaches'];
  v_live    jsonb := '[]'::jsonb;
  isl       record;
  v_buckets int;
  v_days    int;
  v_cached  int;
  v_newest  date;
  v_rows    jsonb;
  v_tot     jsonb;
  v_lg      jsonb;  -- 0420: the pre-system monthly reports, as panel_headline reads them
  v_inrows  int := 0;  -- 0420: how many of them the rows carry
  v_lc      jsonb;     -- 0424: the old café till's days in the range, as panel_headline reads them
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  if v_group not in ('day', 'week', 'month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_group', hint = 'day, week or month';
  end if;
  if coalesce(p_extra, false) then
    v_keys := v_keys || v_more;
  end if;

  select count(distinct case v_group when 'day' then d::date
                                     when 'week' then date_trunc('week', d)::date
                                     else date_trunc('month', d)::date end)
    into v_buckets
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;
  if v_buckets > 31 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = format('%s buckets; at most 31 (use group week or month for a longer range)', v_buckets);
  end if;

  v_rv    := app.report_venues();
  v_scope := app.assistant_cache_scope(v_rv);
  select * into v_cfg from assistant_cache_config where id;
  v_enabled := coalesce(v_cfg.enabled, false);
  v_edge    := app.business_date(now()) - coalesce(v_cfg.freeze_days, 3);

  -- The days not kept (cache off, empty, or inside the freeze lag), in runs
  -- per bucket: each run is one reports_figures call.
  for isl in
    select x.b, min(x.d) as lo, max(x.d) as hi, count(*)::int as n
      from (select c.b, c.d, c.d - (row_number() over (partition by c.b order by c.d))::int as g
              from (select gr.d, gr.b, f.facts
                      from (select d::date as d,
                                   case v_group when 'day' then d::date
                                                when 'week' then date_trunc('week', d)::date
                                                else date_trunc('month', d)::date end as b
                              from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d) gr
                      left join assistant_day_facts f
                        on v_enabled and f.scope = v_scope and f.business_date = gr.d and gr.d <= v_edge) c
             where c.facts is null) x
     group by x.b, x.g
  loop
    v_live := v_live || jsonb_build_array(jsonb_build_object('b', isl.b, 'n', isl.n, 'facts', app.reports_figures(isl.lo, isl.hi)));
  end loop;

  with cached as (
    select gr.d, gr.b, f.facts
      from (select d::date as d,
                   case v_group when 'day' then d::date
                                when 'week' then date_trunc('week', d)::date
                                else date_trunc('month', d)::date end as b
              from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d) gr
      left join assistant_day_facts f
        on v_enabled and f.scope = v_scope and f.business_date = gr.d and gr.d <= v_edge),
  parts as (
    select c.b, 1 as n, c.facts from cached c where c.facts is not null
    union all
    select (e ->> 'b')::date, (e ->> 'n')::int, e -> 'facts' from jsonb_array_elements(v_live) e),
  per_key as (
    select p.b, k.key, sum((p.facts ->> k.key)::bigint) as v
      from parts p cross join unnest(v_keys) as k(key)
     group by p.b, k.key),
  per_b as (select p.b, sum(p.n)::int as days from parts p group by p.b),
  rowsq as (
    select pb.b, pb.days, jsonb_object_agg(pk.key, pk.v) as vals
      from per_b pb join per_key pk on pk.b = pb.b
     group by pb.b, pb.days),
  tot as (select jsonb_object_agg(t.key, t.v) as vals from (select key, sum(v) as v from per_key group by key) t)
  select (select coalesce(jsonb_agg(jsonb_build_object('period', r.b, 'days', r.days) || r.vals
                 || jsonb_build_object('avgOrderValue', case when (r.vals ->> 'orders')::bigint > 0
                                                              then round((r.vals ->> 'cafeRevenue')::numeric / (r.vals ->> 'orders')::bigint)::bigint
                                                              else 0 end)
                 order by r.b), '[]'::jsonb) from rowsq r),
         (select t.vals || jsonb_build_object('avgOrderValue', case when (t.vals ->> 'orders')::bigint > 0
                                                                     then round((t.vals ->> 'cafeRevenue')::numeric / (t.vals ->> 'orders')::bigint)::bigint
                                                                     else 0 end) from tot t),
         (select count(*)::int from cached c where c.facts is not null),
         (select max(c.d) from cached c where c.facts is not null),
         (select count(*)::int from cached c)
    into v_rows, v_tot, v_cached, v_newest, v_days;

  -- 0420: the pre-system monthly reports whose whole period lies in the range
  -- count in the totals exactly as in panel_headline (0349). With group month a
  -- counted report inside one calendar month also counts in that month's row;
  -- day and week rows stay the system's own (nothing is split into days).
  v_lg  := app.legacy_report_totals(v_rv, p_from, p_to);
  v_tot := app.legacy_add_to_figures(v_tot, v_lg);
  if v_group = 'month' and jsonb_array_length(v_lg -> 'included') > 0 then
    select coalesce(jsonb_agg(app.legacy_add_to_figures(r.e, m.lg) order by r.ord), '[]'::jsonb),
           coalesce(sum(jsonb_array_length(m.lg -> 'included')), 0)::int
      into v_rows, v_inrows
      from jsonb_array_elements(v_rows) with ordinality as r(e, ord)
      cross join lateral (
        select app.legacy_report_totals(v_rv, greatest(p_from, (r.e ->> 'period')::date),
                                        least(p_to, ((r.e ->> 'period')::date + interval '1 month' - interval '1 day')::date)) as lg) m;
  end if;

  -- 0424: the old café till's days (0412) count in the totals exactly as in
  -- panel_headline (0412:547), day by day, so a range may cut a month. The
  -- till has days, so every row gains its own bucket's days too, the bucket
  -- clipped to the range; one helper call per bucket, and none at all when
  -- the range holds no old-till day.
  v_lc  := app.legacy_cafe_totals(v_rv, p_from, p_to);
  v_tot := app.legacy_cafe_add_to_figures(v_tot, v_lc);
  if coalesce((v_lc ->> 'days')::int, 0) > 0 then
    select coalesce(jsonb_agg(app.legacy_cafe_add_to_figures(r.e, app.legacy_cafe_totals(v_rv, k.lo, k.hi)) order by r.ord), '[]'::jsonb)
      into v_rows
      from jsonb_array_elements(v_rows) with ordinality as r(e, ord)
      cross join lateral (
        select greatest(p_from, (r.e ->> 'period')::date) as lo,
               least(p_to, case v_group when 'day'  then (r.e ->> 'period')::date
                                        when 'week' then (r.e ->> 'period')::date + 6
                                        else ((r.e ->> 'period')::date + interval '1 month' - interval '1 day')::date end) as hi) k;
  end if;

  return jsonb_build_object(
    'group', v_group,
    'from',  p_from,
    'to',    p_to,
    'cache', jsonb_build_object('on', v_enabled, 'days_from_cache', v_cached, 'days_read_live', v_days - v_cached, 'newest_cached_day', v_newest),
    'rows',  coalesce(v_rows, '[]'::jsonb),
    'totals', coalesce(v_tot, '{}'::jsonb),
    -- 0420: null when no report touches the range; inRows: the rows carry every counted report.
    -- 0424: also present when only old café till days are in the range; cafe is
    -- the legacy_cafe_totals object plus inRows (always true: every row carries
    -- its bucket's old-till days), null when the range holds none.
    'history', case when jsonb_array_length(v_lg -> 'included') + jsonb_array_length(v_lg -> 'partial') > 0
                         or coalesce((v_lc ->> 'days')::int, 0) > 0   -- 0424
                    then v_lg || jsonb_build_object('inRows', v_inrows = jsonb_array_length(v_lg -> 'included'))
                         || jsonb_build_object('cafe', case when coalesce((v_lc ->> 'days')::int, 0) > 0   -- 0424
                                                            then v_lc || jsonb_build_object('inRows', true) end) end);
end $assistant_history_figures_0424$;

comment on function app.assistant_history_figures(date, date, text, boolean) is
  '0330, 0420, 0424. Owner-only, read-only, reached through app.assistant_run_tool (tool history_figures). The headline figures of a business-day range in day, week or month buckets (at most 31) with totals and avgOrderValue (cafeRevenue per order). Days at least freeze_days old are read from assistant_day_facts when the cache is on and has them; every other day goes through app.reports_figures. p_extra adds deposits, ticket, match write-off and lesson keys. cache says how many days came from where. 0420: totals include the pre-system monthly reports whose whole period lies in the range (app.legacy_report_totals + app.legacy_add_to_figures: revenue, padelRevenue, bookings, noShows), so they equal panel_headline for the same range; with p_group month a counted report inside one calendar month is in that month''s row too, day and week rows are the system''s own. history: null when no report touches the range, else the legacy_report_totals object (included, partial, revenueApproximate, the summed figures) plus inRows (true when the rows carry every counted report). The day cache never holds report figures. 0424: totals and every row (day, week or month, the bucket clipped to the range) also include the old café till''s days (app.legacy_cafe_totals + app.legacy_cafe_add_to_figures: revenue, cafeRevenue, cafeNet, orders, discounts, avgOrderValue recomputed; cash, card, refunds and waste nothing), so totals equal panel_headline again; history is also present when only old-till days touch the range, and history.cafe is the legacy_cafe_totals object plus inRows (true), null without old-till days. The old till is added at read time, never stored in the day cache. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.assistant_history_figures(date, date, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.assistant_costs_summary: no cash result over old café till days
-- ---------------------------------------------------------------------------
create or replace function app.assistant_costs_summary(
  p_from  date,
  p_to    date,
  p_group text default 'month'
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_costs_summary_0424$
declare
  v_rv       uuid[];
  v_group    text := coalesce(p_group, 'month');
  v_buckets  int;
  v_ph       jsonb;
  v_revenue  bigint;
  v_legacy   boolean;
  v_oldtill  bigint;   -- 0424: the old café till's net inside v_revenue (null: no old-till day)
  v_since    date;
  v_out      jsonb;
  v_note     text;
  -- 0343's categories, in the Safe page's order
  v_cats     text[] := array['shopping','supplier','rent','bills','repairs','marketing','other','wages','advance','coach_pay'];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  if v_group not in ('day', 'week', 'month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_group', hint = 'day, week or month';
  end if;
  select count(distinct case v_group when 'day' then d::date
                                     when 'week' then date_trunc('week', d)::date
                                     else date_trunc('month', d)::date end)
    into v_buckets
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;
  if v_buckets > 31 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = format('%s buckets; at most 31 (use group week or month for a longer range)', v_buckets);
  end if;
  v_rv := app.report_venues();

  -- Revenue exactly as the management panel shows it for the same range and branches.
  v_ph := app.panel_headline(p_from, p_to, 'none');
  select (f ->> 'value')::bigint into v_revenue
    from jsonb_array_elements(v_ph -> 'figures') f
   where f ->> 'key' = 'revenue';
  v_legacy := jsonb_array_length(coalesce(v_ph #> '{history,period,included}', '[]'::jsonb)) > 0;
  -- 0424: the old café till's days (0412) are revenue with no costs, like the reports.
  v_oldtill := case when coalesce((v_ph #>> '{history,period,cafe,days}')::int, 0) > 0
                    then (v_ph #>> '{history,period,cafe,net}')::bigint end;
  select min(e.occurred_on) into v_since from main_cash_entries e where e.venue_id = any(v_rv);

  with
  pay as materialized (
    select e.*, v.name_en as branch,
           case v_group when 'day' then e.occurred_on
                        when 'week' then date_trunc('week', e.occurred_on)::date
                        else date_trunc('month', e.occurred_on)::date end as b
      from main_cash_entries e
      join venues v on v.id = e.venue_id
     where e.venue_id = any(v_rv)
       and e.kind = 'payment' and e.voided_at is null and e.paid_from in ('safe', 'bank')
       and e.occurred_on between p_from and p_to),
  buckets as (
    select distinct case v_group when 'day' then d::date
                                 when 'week' then date_trunc('week', d)::date
                                 else date_trunc('month', d)::date end as b
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d)
  select jsonb_build_object(
    'from',  p_from,
    'to',    p_to,
    'group', v_group,
    'basis', 'cash',
    'totals', jsonb_build_object(
      'total_iqd',      (select coalesce(sum(amount_iqd), 0) from pay),
      'from_safe_iqd',  (select coalesce(sum(amount_iqd), 0) from pay where paid_from = 'safe'),
      'from_bank_iqd',  (select coalesce(sum(amount_iqd), 0) from pay where paid_from = 'bank'),
      'count',          (select count(*) from pay),
      'revenue_iqd',    v_revenue,
      'old_till_revenue_iqd', coalesce(v_oldtill, 0),   -- 0424
      -- No cost recorded at all for these branches: revenue minus nothing is not a
      -- result, so none is given (the note says why).
      'cash_result_iqd', case when v_legacy or v_oldtill is not null or v_revenue is null or v_since is null then null   -- 0424: + v_oldtill
                              else v_revenue - (select coalesce(sum(amount_iqd), 0) from pay) end),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', c.cat, 'total_iqd', c.total, 'count', c.n)
                                              order by c.ord), '[]'::jsonb)
                      from (select u.cat, u.ord, sum(p.amount_iqd)::bigint as total, count(*)::int as n
                              from unnest(v_cats) with ordinality as u(cat, ord)
                              join pay p on p.category = u.cat
                             group by u.cat, u.ord) c),
    'by_branch', (select coalesce(jsonb_agg(jsonb_build_object('branch', x.branch, 'total_iqd', x.total)
                                            order by x.branch), '[]'::jsonb)
                    from (select branch, sum(amount_iqd)::bigint as total from pay group by branch) x),
    'by_bucket', (select coalesce(jsonb_agg(jsonb_build_object(
                           'period', bk.b,
                           'total_iqd', coalesce((select sum(p.amount_iqd) from pay p where p.b = bk.b), 0))
                           order by bk.b), '[]'::jsonb)
                    from buckets bk),
    'costs_recorded_from', v_since)
    into v_out;

  if v_legacy then
    v_note := 'revenue_iqd includes pre-system monthly reports, which carry revenue but no costs, so no cash result is given for this range';
  end if;
  if v_oldtill is not null then   -- 0424
    v_note := concat_ws('; ', v_note,
      'revenue_iqd includes the old café till''s days (2 June to 31 October 2026, old_till_revenue_iqd), which carry revenue but no costs, so no cash result is given for this range');
  end if;
  if v_since is null or v_since > p_from then
    v_note := concat_ws('; ', v_note,
      case when v_since is null then 'no cost is recorded in the safe for these branches yet, so no cash result is given'
           else format('costs are recorded in the safe from %s; earlier days in the range have revenue but no recorded costs', v_since) end);
  end if;
  if v_note is not null then
    v_out := v_out || jsonb_build_object('note', v_note);
  end if;

  return v_out;
end $assistant_costs_summary_0424$;

comment on function app.assistant_costs_summary(date, date, text) is
  '0421, 0424. Owner-only, read-only, reached through app.assistant_run_tool (tool costs_summary). Cash basis: the live payments (main_cash_entries kind payment, not voided) paid from the safe or the bank at the branches in app.report_venues() with occurred_on in p_from..p_to (at most 400 days, at most 31 buckets of p_group day | week | month, default month). Deliveries and supplier receipts are stock coming in, not costs here. {from, to, group, basis: cash, totals {total_iqd, from_safe_iqd, from_bank_iqd, count, revenue_iqd (app.panel_headline revenue for the same range), cash_result_iqd (revenue_iqd - total_iqd; null when panel_headline counts a pre-system monthly report or, 0424, old café till days, which carry revenue but no costs), old_till_revenue_iqd (0424: the old café till''s part of revenue_iqd, panel_headline history.period.cafe.net)}, by_category [{category, total_iqd, count}] (0343 order, categories with a payment only), by_branch [{branch, total_iqd}], by_bucket [{period, total_iqd}] (every bucket), costs_recorded_from (the first safe row at these branches), note (why cash_result_iqd is null, or that the range starts before costs were recorded)}. A cash result, never accounting profit. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.assistant_costs_summary(date, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_run_tool: + analytics_cafe_history (tool cafe_history)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_0424$
declare
  a           jsonb := coalesce(p_args, '{}'::jsonb);
  v_result    jsonb;
  v_path      text;                 -- the catalog's rows_path for this tool
  v_count     int;
  v_truncated boolean;
  v_scope     text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The wall. STABLE is a promise; this is the enforcement: from here to the
  -- end of the transaction any INSERT/UPDATE/DELETE/DDL reached through a
  -- dispatched RPC fails with 25006 read_only_sql_transaction.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '8000', true);

  if jsonb_typeof(a) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_args', hint = 'an object of p_* keys';
  end if;

  case p_tool
    -- ── Money and headline ────────────────────────────────────────────────
    when 'panel_headline' then
      v_path := 'figures';
      v_result := app.panel_headline((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_compare', 'none'));
    when 'report_revenue' then
      v_path := 'rows';
      v_result := app.report_revenue((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     coalesce(a ->> 'p_group', 'day'), coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_compare' then
      v_result := app.report_compare(a ->> 'p_report', (a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     a ->> 'p_compare', coalesce(a ->> 'p_group', 'day'),
                                     coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_drill' then
      -- The RPC's row array is 'transactions' (the catalog says 'rows'; the
      -- dispatcher follows the RPC so row_count is real, and the mismatch is
      -- reported to the catalog's owner).
      v_path := 'transactions';
      v_result := app.report_drill(a ->> 'p_figure', a ->> 'p_key', (a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'assistant_payments_list' then
      v_path := 'rows';
      v_result := app.assistant_payments_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_method',
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    -- 0421: day closes, costs and the cash result, the safe
    when 'assistant_cash_closes' then
      v_path := 'days';
      v_result := app.assistant_cash_closes((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_detail', 'days'));
    when 'assistant_costs_summary' then
      v_path := 'by_category';
      v_result := app.assistant_costs_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_group', 'month'));
    when 'assistant_safe_summary' then
      v_path := 'rows';
      v_result := app.assistant_safe_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce((a ->> 'p_rows')::boolean, false));

    -- ── Cafe ──────────────────────────────────────────────────────────────
    when 'report_cafe' then
      v_result := app.report_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_daily_sales' then
      v_path := '$';
      v_result := app.analytics_daily_sales((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_sold_items' then
      v_path := '$';
      v_result := app.analytics_sold_items((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_best_sellers' then
      v_path := '$';
      v_result := app.analytics_best_sellers((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                             coalesce((a ->> 'p_limit')::int, 20), coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_item_margins' then
      v_result := app.analytics_item_margins((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_price_bands' then
      v_path := '$';
      v_result := app.analytics_price_bands((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_hourly' then
      v_path := '$';
      v_result := app.analytics_hourly((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_bought_together' then
      v_path := '$';
      -- The RPC's basket scope is 'order' | 'tab'; anything else falls back to
      -- its default rather than failing the whole turn.
      v_scope := case when a ->> 'p_scope' in ('order', 'tab') then a ->> 'p_scope' else 'order' end;
      v_result := app.analytics_bought_together((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce((a ->> 'p_min_support')::int, 3),
                                                coalesce((a ->> 'p_limit')::int, 30), v_scope);
    when 'analytics_menu_snapshot' then
      v_result := app.analytics_menu_snapshot();
    when 'analytics_cafe_history' then   -- 0424: the old café till (0412)
      v_path := 'products';
      v_result := app.analytics_cafe_history((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'assistant_tabs_list' then
      v_path := 'rows';
      v_result := app.assistant_tabs_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_status',
                                          (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Courts ────────────────────────────────────────────────────────────
    when 'report_courts' then
      v_result := app.report_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_courts_summary' then
      v_result := app.analytics_courts_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_demand' then
      v_result := app.analytics_courts_demand((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_endings' then
      v_result := app.analytics_courts_endings((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_guests' then
      v_result := app.analytics_courts_guests((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_cafe' then
      v_result := app.analytics_courts_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'assistant_bookings_list' then
      v_path := 'rows';
      v_result := app.assistant_bookings_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid,
                                              a ->> 'p_status', (a ->> 'p_customer_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    when 'assistant_unpaid_played_bookings' then   -- 0420
      v_path := 'rows';
      v_result := app.assistant_unpaid_played_bookings((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_limit')::int);
    when 'booking_bill' then
      v_result := app.booking_bill((a ->> 'p_reservation_id')::uuid);
    when 'series_detail' then
      v_result := app.series_detail((a ->> 'p_series_id')::uuid);
    when 'assistant_courts_and_rates' then
      v_result := app.assistant_courts_and_rates();

    -- ── Stock ─────────────────────────────────────────────────────────────
    when 'report_stock' then
      v_result := app.report_stock((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_stock_view' then
      v_path := 'rows';
      v_result := app.assistant_stock_view(a ->> 'p_view', (a ->> 'p_limit')::int, (a ->> 'p_offset')::int);

    -- ── Staff and ops ─────────────────────────────────────────────────────
    when 'ops_overview' then
      v_result := app.ops_overview();
    when 'list_staff' then
      v_path := '$';
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_result from app.list_staff() s;
    when 'staff_requests_page' then
      v_path := 'requests';   -- the RPC returns {requests, total, pending}; the catalog says the same
      v_result := app.staff_requests_page(a ->> 'p_status', coalesce((a ->> 'p_limit')::int, 50),
                                          coalesce((a ->> 'p_offset')::int, 0));
    when 'report_staff_activity' then
      v_path := 'rows';
      v_result := app.report_staff_activity((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid);
    when 'assistant_break_history' then
      v_path := 'rows';
      v_result := app.assistant_break_history((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    -- 0421: wages and attendance
    when 'assistant_wages_summary' then
      v_path := 'people';
      v_result := app.assistant_wages_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce((a ->> 'p_detail')::boolean, false));
    when 'assistant_attendance_summary' then
      v_path := 'people';
      v_result := app.assistant_attendance_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Audit ─────────────────────────────────────────────────────────────
    when 'assistant_audit_page' then
      v_path := 'rows';
      v_result := app.assistant_audit_page((a ->> 'p_from')::timestamptz, (a ->> 'p_to')::timestamptz,
                                           (a ->> 'p_actor_id')::uuid, a ->> 'p_action_prefix', a ->> 'p_text',
                                           (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Customers ─────────────────────────────────────────────────────────
    when 'customer_search' then
      v_path := '$';
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result
        from app.customer_search(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 12)) x;
    when 'customer_record' then
      v_result := app.customer_record((a ->> 'p_customer_id')::uuid);

    -- ── Marketing ─────────────────────────────────────────────────────────
    when 'analytics_promo' then
      v_result := app.analytics_promo((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'marketing_overview' then
      v_result := app.marketing_overview();
    when 'marketing_campaign_performance' then
      v_result := app.marketing_campaign_performance((a ->> 'p_campaign')::uuid);

    -- ── Tournaments, open matches, loyalty (0328) ────────────────────────
    when 'assistant_tournaments_summary' then
      v_path := 'tournaments';
      v_result := app.assistant_tournaments_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'report_matches' then
      v_path := 'byDay';
      v_result := app.report_matches((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_loyalty_summary' then
      v_path := 'tiers';
      v_result := app.assistant_loyalty_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Stored daily figures (0330) ───────────────────────────────────────
    when 'assistant_history_figures' then
      v_path := 'rows';
      v_result := app.assistant_history_figures((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce(a ->> 'p_group', 'day'), coalesce((a ->> 'p_extra')::boolean, false));
    when 'assistant_history_items' then
      v_path := 'rows';
      v_result := app.assistant_history_items((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                              coalesce((a ->> 'p_limit')::int, 10), coalesce(a ->> 'p_order', 'revenue'));
    when 'assistant_history_courts' then
      v_path := 'rows';
      v_result := app.assistant_history_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                               coalesce(a ->> 'p_group', 'range'), coalesce((a ->> 'p_hours')::boolean, false));
    when 'assistant_history_staff' then
      v_path := 'rows';
      v_result := app.assistant_history_staff((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Files (0354) ──────────────────────────────────────────────────────
    when 'assistant_files_list' then
      v_path := 'files';
      v_result := app.assistant_files_list(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 50));
    when 'assistant_file_get' then
      v_result := app.assistant_file_get((a ->> 'p_file_id')::uuid);

    -- ── Settings, system, any table ───────────────────────────────────────
    when 'assistant_settings_read' then
      v_result := app.assistant_settings_read();
    when 'assistant_system_status' then
      v_result := app.assistant_system_status();
    when 'assistant_table_read' then
      v_path := 'rows';
      v_result := app.assistant_table_read(
                    a ->> 'p_table',
                    case when a ? 'p_columns' and jsonb_typeof(a -> 'p_columns') = 'array'
                         then array(select jsonb_array_elements_text(a -> 'p_columns')) end,
                    a -> 'p_filters', a ->> 'p_order',
                    (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Meter (0111) ──────────────────────────────────────────────────────
    when 'assistant_usage' then
      v_path := 'days';
      v_result := app.assistant_usage((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    else
      raise exception 'ASSISTANT_UNKNOWN_TOOL' using errcode = 'P0001', detail = coalesce(p_tool, 'null');
  end case;

  -- row_count: the length of the array rows_path points at, when known.
  v_count := case
               when v_path = '$' and jsonb_typeof(v_result) = 'array' then jsonb_array_length(v_result)
               when v_path is not null and v_path <> '$' and jsonb_typeof(v_result -> v_path) = 'array'
                 then jsonb_array_length(v_result -> v_path)
             end;
  -- truncated: a paged list whose total exceeds what this page returned.
  v_truncated := case
                   when v_count is not null and jsonb_typeof(v_result) = 'object' and (v_result ->> 'total') ~ '^\d+$'
                     then (v_result ->> 'total')::bigint > coalesce((v_result ->> 'offset')::bigint, coalesce((a ->> 'p_offset')::bigint, 0)) + v_count
                   else false
                 end;

  return jsonb_build_object('tool', p_tool, 'data', v_result, 'row_count', v_count, 'truncated', v_truncated);
end $assistant_run_tool_0424$;

comment on function app.assistant_run_tool(text, jsonb) is
  '0109, 0328, 0330, 0354, 0420, 0421, 0424. Owner-only. THE read-only wall for the assistant: turns transaction_read_only on, then dispatches over the fixed catalog of read RPC names (packages/core/src/assistant/tools.ts DISPATCHED_RPCS) with arguments pulled from p_args by p_* name. Unknown names raise ASSISTANT_UNKNOWN_TOOL. Returns {tool, data, row_count, truncated}. Called with the owner''s JWT by the assistant-chat edge function.';

revoke all on function app.assistant_run_tool(text, jsonb) from public, anon;
grant execute on function app.assistant_run_tool(text, jsonb) to authenticated;
