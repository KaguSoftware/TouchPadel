set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0420 assistant_history_reports: the owner assistant's history tools count
-- the pre-system monthly reports the way the pages do, and a new tool reads
-- bookings played but not paid (review 2026-11-12: tools that contradicted
-- the pages, and a prompt priority no tool returned).
--
-- 1. history_figures. June to September 2026 padel figures exist only as the
--    monthly reports (legacy_reports, 0331/0348). Since 0349 panel_headline
--    and analytics_courts_summary count a report whose WHOLE period lies in
--    the range (app.legacy_report_totals, latest body 0357, and
--    app.legacy_add_to_figures); app.assistant_history_figures (0330) read
--    reports_figures and the day cache only, so "how was August?" had no
--    padel revenue while the panel showed 5,087,250. Its totals now add the
--    reports exactly as panel_headline does (revenue, padelRevenue, bookings,
--    noShows); with group month a counted report inside one calendar month
--    adds to that month's row, day and week rows stay the system's own
--    (0349's rule: nothing is split into days); `history` carries the
--    legacy_report_totals object plus inRows. reports_figures is unchanged
--    and the day cache tables never hold report figures.
-- 2. history_courts. Gains the same `history` object, never added into its
--    numbers (the reports have no minutes). Two corrections so it matches
--    the courts page (analytics_courts_summary, latest body 0349):
--      * occupancy was booked / open minutes; the page has used
--        (booked + lesson) / open since 0288. Total and rows now use the
--        page's formula, and the total's is null while a report month is
--        counted, as the page shows it. The hour cells stored in
--        assistant_day_detail carry no lesson minutes, so the hour key is
--        renamed booked_pct (bookings alone) rather than misnamed.
--      * app.assistant_detail_compute's courts family read kpis, which since
--        0349 include the reports when a live run holds a whole report month
--        (cache off, or days never stored), so a live range and a stored range
--        disagreed. It now sums per_court, the system's own rows; a stored
--        single day is unaffected (no report is one day long), so no stored
--        row needs recomputing.
-- 3. New tool unpaid_played_bookings: app.assistant_unpaid_played_bookings
--    (p_from, p_to, p_limit), owner only, STABLE, SECURITY DEFINER, no client
--    grant, app.unpaid_played_bookings' predicate (latest body 0265) over a
--    business-date range of at most 92 days at the branches in
--    app.report_venues(), with the total count and remaining IQD over every
--    match. An `aggregate` tool with a row limit, not a countable `list`:
--    a list tool would need app.assistant_count re-issued (0109) and the
--    catalog test taught to find its newest body, and nobody pages this.
--
-- Re-issued verbatim from their latest bodies except the lines marked 0420:
--   app.assistant_history_figures  20261009000330_assistant_day_cache.sql:118
--   app.assistant_detail_compute   20261009000330_assistant_day_cache.sql:273
--   app.assistant_history_courts   20261009000330_assistant_day_cache.sql:499
--   app.assistant_run_tool         20261020000354_venue_files.sql:685
--                                  (+ the one branch for the new tool)
-- Same signatures, STABLE, SECURITY DEFINER, search_path, guards and grants.
--
-- covered by packages/db/tests/assistant-history-reports.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app.assistant_history_figures: + the pre-system monthly reports
-- ---------------------------------------------------------------------------
create or replace function app.assistant_history_figures(
  p_from  date,
  p_to    date,
  p_group text default 'day',
  p_extra boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_history_figures_0420$
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

  return jsonb_build_object(
    'group', v_group,
    'from',  p_from,
    'to',    p_to,
    'cache', jsonb_build_object('on', v_enabled, 'days_from_cache', v_cached, 'days_read_live', v_days - v_cached, 'newest_cached_day', v_newest),
    'rows',  coalesce(v_rows, '[]'::jsonb),
    'totals', coalesce(v_tot, '{}'::jsonb),
    -- 0420: null when no report touches the range; inRows: the rows carry every counted report.
    'history', case when jsonb_array_length(v_lg -> 'included') + jsonb_array_length(v_lg -> 'partial') > 0
                    then v_lg || jsonb_build_object('inRows', v_inrows = jsonb_array_length(v_lg -> 'included')) end);
end $assistant_history_figures_0420$;

comment on function app.assistant_history_figures(date, date, text, boolean) is
  '0330, 0420. Owner-only, read-only, reached through app.assistant_run_tool (tool history_figures). The headline figures of a business-day range in day, week or month buckets (at most 31) with totals and avgOrderValue (cafeRevenue per order). Days at least freeze_days old are read from assistant_day_facts when the cache is on and has them; every other day goes through app.reports_figures. p_extra adds deposits, ticket, match write-off and lesson keys. cache says how many days came from where. 0420: totals include the pre-system monthly reports whose whole period lies in the range (app.legacy_report_totals + app.legacy_add_to_figures: revenue, padelRevenue, bookings, noShows), so they equal panel_headline for the same range; with p_group month a counted report inside one calendar month is in that month''s row too, day and week rows are the system''s own. history: null when no report touches the range, else the legacy_report_totals object (included, partial, revenueApproximate, the summed figures) plus inRows (true when the rows carry every counted report). The day cache never holds report figures. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.assistant_history_figures(date, date, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.assistant_detail_compute: the courts family is the system's own
-- ---------------------------------------------------------------------------
create or replace function app.assistant_detail_compute(p_family text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_detail_compute_0420$
declare
  v jsonb;
  c jsonb;
begin
  if p_family = 'items' then
    select coalesce(jsonb_agg(jsonb_build_object('i', t.id, 'n', t.n, 'a', t.a, 'q', t.q, 'r', t.r) order by t.r desc, t.id), '[]'::jsonb)
      into v
      from (select e ->> 'menu_item_id' as id, max(e ->> 'name_en') as n, max(e ->> 'name_ar') as a,
                   sum((e ->> 'qty')::bigint) as q, sum((e ->> 'revenue_iqd')::bigint) as r
              from jsonb_array_elements(app.analytics_sold_items(p_from, p_to, 'settled')) e
             group by 1) t;
  elsif p_family = 'courts' then
    c := app.analytics_courts_summary(p_from, p_to, null);
    -- 0420: bk, ns, cx and rev are summed over per_court, the system's own
    -- bookings: since 0349 kpis add the pre-system monthly reports when the
    -- run holds a whole report month, which made a live run and a stored day
    -- disagree. booked and lesson minutes in kpis were live-only already.
    v := jsonb_build_object(
           'bk',  (select coalesce(sum((e ->> 'bookings')::bigint), 0) from jsonb_array_elements(c -> 'per_court') e),
           'ns',  (select coalesce(sum((e ->> 'no_shows')::bigint), 0) from jsonb_array_elements(c -> 'per_court') e),
           'cx',  (select coalesce(sum((e ->> 'cancellations')::bigint), 0) from jsonb_array_elements(c -> 'per_court') e),
           'bm',  coalesce((c #>> '{kpis,booked_minutes}')::bigint, 0),
           'lm',  coalesce((c #>> '{kpis,lesson_minutes}')::bigint, 0),
           'rev', (select coalesce(sum((e ->> 'revenue_iqd')::bigint), 0) from jsonb_array_elements(c -> 'per_court') e),
           'om',  coalesce((c ->> 'open_minutes')::bigint, 0),
           'hours', coalesce((select jsonb_agg(jsonb_build_object('h', x.h, 'bk', x.bk, 'bm', x.bm, 'om', x.om, 'rev', x.rev) order by x.h)
                                from (select (e ->> 'hour')::int as h, sum((e ->> 'bookings')::bigint) as bk,
                                             sum((e ->> 'booked_minutes')::bigint) as bm, sum((e ->> 'open_minutes')::bigint) as om,
                                             sum((e ->> 'revenue_iqd')::bigint) as rev
                                        from jsonb_array_elements(c -> 'heatmap') e group by 1) x), '[]'::jsonb));
  elsif p_family = 'staff' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'i', e ->> 'staffId', 'n', e ->> 'name', 'ro', e ->> 'role',
             'dc', coalesce((e #>> '{discounts,count}')::bigint, 0), 'di', coalesce((e #>> '{discounts,amountIqd}')::bigint, 0),
             'vc', coalesce((e #>> '{voids,count}')::bigint, 0),     'vi', coalesce((e #>> '{voids,amountIqd}')::bigint, 0),
             'rc', coalesce((e #>> '{refunds,count}')::bigint, 0),   'ri', coalesce((e #>> '{refunds,amountIqd}')::bigint, 0),
             'o',  coalesce((e ->> 'ordersTaken')::bigint, 0), 'p', coalesce((e ->> 'paymentsTaken')::bigint, 0),
             'b',  coalesce((e ->> 'bookingsCreated')::bigint, 0))), '[]'::jsonb)
      into v
      from jsonb_array_elements(app.report_staff_activity(p_from, p_to, null) -> 'rows') e
     where coalesce((e #>> '{discounts,count}')::bigint, 0) + coalesce((e #>> '{voids,count}')::bigint, 0)
         + coalesce((e #>> '{refunds,count}')::bigint, 0) + coalesce((e ->> 'ordersTaken')::bigint, 0)
         + coalesce((e ->> 'paymentsTaken')::bigint, 0) + coalesce((e ->> 'bookingsCreated')::bigint, 0) > 0;
  else
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_family';
  end if;
  return v;
end $assistant_detail_compute_0420$;

comment on function app.assistant_detail_compute(text, date, date) is
  '0330, 0420 (courts: bookings, no-shows, cancellations and revenue from per_court, the system''s own, never the pre-system reports). Internal. The compact additive form of one detail family (items, courts, staff) for a business-day range, from the same report RPC the pages use, at the report scope of the caller. Used by the read path for days not kept and by app.assistant_cache_fill for the days it keeps.';

revoke all on function app.assistant_detail_compute(text, date, date) from public, anon, authenticated;
grant execute on function app.assistant_detail_compute(text, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_history_courts: the page's occupancy, + history
-- ---------------------------------------------------------------------------
create or replace function app.assistant_history_courts(p_from date, p_to date, p_group text default 'range', p_hours boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_history_courts_0420$
declare
  c jsonb;
  t jsonb;
  v_lg  jsonb;    -- 0420: the pre-system monthly reports of the analysed branch
  v_any boolean;  -- 0420: a report is counted in the range (the page then shows no occupancy)
begin
  c := app.assistant_detail_collect('courts', p_from, p_to, coalesce(p_group, 'range'));
  t := c -> 'total';
  -- 0420: the branch analytics_courts_summary reads (assistant_detail_compute's source).
  v_lg  := app.legacy_report_totals(array[app.analysis_venue()], p_from, p_to);
  v_any := jsonb_array_length(v_lg -> 'included') > 0;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'group', coalesce(p_group, 'range'),
    'cache', c -> 'cache',
    'total', jsonb_build_object(
      'bookings', t -> 'bk', 'no_shows', t -> 'ns', 'cancellations', t -> 'cx',
      'booked_hours', round(((t ->> 'bm')::numeric) / 60, 1), 'lesson_hours', round(((t ->> 'lm')::numeric) / 60, 1),
      'open_hours', round(((t ->> 'om')::numeric) / 60, 1),
      -- 0420: booked + lesson minutes over open minutes, as analytics_courts_summary (0288); null with a report month in, as the page.
      'occupancy_pct', case when v_any then null when (t ->> 'om')::bigint > 0 then round(((t ->> 'bm')::numeric + (t ->> 'lm')::numeric) * 100 / (t ->> 'om')::numeric, 1) else 0 end,
      'revenue_iqd', t -> 'rev',
      'iqd_per_booked_hour', case when (t ->> 'bm')::bigint > 0 then round((t ->> 'rev')::numeric * 60 / (t ->> 'bm')::numeric)::bigint else 0 end),
    'rows', case when coalesce(p_group, 'range') = 'range' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                'period', b.b, 'days', b.days,
                'bookings', b.data -> 'bk', 'no_shows', b.data -> 'ns', 'cancellations', b.data -> 'cx',
                'booked_hours', round(((b.data ->> 'bm')::numeric) / 60, 1),
                -- 0420: booked + lesson minutes over open minutes, as the courts page.
                'occupancy_pct', case when (b.data ->> 'om')::bigint > 0 then round(((b.data ->> 'bm')::numeric + coalesce((b.data ->> 'lm')::numeric, 0)) * 100 / (b.data ->> 'om')::numeric, 1) else 0 end,
                'revenue_iqd', b.data -> 'rev') order by b.b)
              from jsonb_to_recordset(c -> 'buckets') as b(b date, days int, data jsonb)), '[]'::jsonb) end,
    'hours', case when coalesce(p_hours, false) then
               coalesce((select jsonb_agg(jsonb_build_object(
                           'hour', h.h, 'bookings', h.bk, 'booked_hours', round(h.bm / 60.0, 1),
                           -- 0420: renamed from occupancy_pct: bookings alone, the stored hour cells carry no lesson minutes.
                           'booked_pct', case when h.om > 0 then round(h.bm * 100.0 / h.om, 1) else 0 end,
                           'revenue_iqd', h.rev) order by h.h)
                         from jsonb_to_recordset(t -> 'hours') as h(h int, bk bigint, bm bigint, om bigint, rev bigint)
                        where h.om > 0), '[]'::jsonb) end,
    -- 0420: null when no report touches the range. Never in total or rows (the reports have no minutes, no courts, no days).
    'history', case when v_any or jsonb_array_length(v_lg -> 'partial') > 0
                    then v_lg || jsonb_build_object('inRows', false) end);
end $assistant_history_courts_0420$;

comment on function app.assistant_history_courts(date, date, text, boolean) is
  '0330, 0420. Owner-only, read-only, reached through app.assistant_run_tool (tool history_courts). Court use over a business-day range, the courts analytics_courts_summary reads (the analysed branch): bookings, no-shows, cancellations, booked, lesson and open hours, occupancy and revenue per bucket (range, day, week or month; at most 31) with totals, and with p_hours bookings, booked hours, booked_pct (booked over open minutes, bookings alone) and revenue by hour of the day. Kept days come from assistant_day_detail, the rest live. 0420: occupancy is booked + lesson minutes over open minutes, as analytics_courts_summary computes it since 0288 (it was booked minutes alone), and the total''s is null when a pre-system monthly report is counted in the range, as the page shows it; every number is the system''s own: the reports are never added (they have no minutes), and history (null when none touches the range) is the app.legacy_report_totals object with inRows false.';

revoke all on function app.assistant_history_courts(date, date, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.assistant_unpaid_played_bookings (new, tool unpaid_played_bookings)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_unpaid_played_bookings(
  p_from  date,
  p_to    date,
  p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_unpaid_played_bookings_0420$
declare
  v_b   record;
  v_rv  uuid[];
  v_n   int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_out jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 92 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 92 days';
  end if;
  v_rv := app.report_venues();  -- the branches in scope, as the reports and 0406's list tools read them
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  -- Each branch's own business-day rule (app.venue_business_date: its clock and day start).
  vv as materialized (
    select v.id,
           coalesce(v.timezone, 'Asia/Baghdad') as tz,
           coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v.id), 4) as start_hour
      from venues v
     where v.id = any(v_rv)),
  -- unpaid_played_bookings' predicate (0265), over a range instead of one day
  -- session. A sargable window a day wider on each side than the analysed
  -- branch's bounds, then the exact business date per row; court_fee_remaining
  -- runs once per played, priced row and never on the rest.
  played as materialized (
    select r.id, r.court_id, r.status, r.start_at, r.end_at, r.price_iqd, r.guest_id, r.guest_name,
           app.business_date(r.start_at, vv.tz, vv.start_hour) as d
      from reservations r
      join vv on vv.id = r.venue_id
     where r.kind = 'booking'
       and r.start_at >= v_b.ts_from - interval '1 day'
       and r.start_at <  v_b.ts_to + interval '1 day'
       and r.price_iqd > 0
       and (r.status in ('arrived','completed') or (r.status = 'confirmed' and r.end_at <= now()))),
  owed as materialized (
    select p.*, app.court_fee_remaining(p.id, null) as remaining
      from played p
     where p.d between p_from and p_to),
  due as (select * from owed where remaining > 0)
  select jsonb_build_object(
           'from',          p_from,
           'to',            p_to,
           'total',         (select count(*) from due),
           'remaining_iqd', (select coalesce(sum(remaining), 0) from due),
           'limit',         v_n,
           'rows', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id',            x.id,
                      'business_date', x.d,
                      'start_at',      x.start_at,
                      'end_at',        x.end_at,
                      'status',        x.status,
                      'court_name_en', c.name_en,
                      'court_name_ar', c.name_ar,
                      'guest_name',    coalesce(x.guest_name, pr.full_name),
                      'price_iqd',     x.price_iqd,
                      'remaining_iqd', x.remaining)
                    order by x.remaining desc, x.start_at, x.id)
               from (select * from due order by remaining desc, start_at, id limit v_n) x
               left join courts   c  on c.id  = x.court_id
               left join profiles pr on pr.id = x.guest_id), '[]'::jsonb))
    into v_out;

  return v_out;
end $assistant_unpaid_played_bookings_0420$;

comment on function app.assistant_unpaid_played_bookings(date, date, int) is
  '0420. Owner-only, read-only, reached through app.assistant_run_tool (tool unpaid_played_bookings). app.unpaid_played_bookings'' predicate over a business-day range of at most 92 days instead of one day session: bookings (kind booking) of the branches in app.report_venues() that were played (arrived, completed, or confirmed and already over) and still owe court fee (app.court_fee_remaining > 0, which nets paid court lines, the deposit, written-off match shares, the customer court discount and a loyalty court hour), each on its own branch''s business date. {from, to, total (every match), remaining_iqd (summed over every match), limit, rows [{id, business_date, start_at, end_at, status, court_name_en, court_name_ar, guest_name, price_iqd, remaining_iqd}]}, the largest remaining first, p_limit 1..200 (default 50). FORBIDDEN, INVALID_RANGE.';

revoke all on function app.assistant_unpaid_played_bookings(date, date, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.assistant_run_tool: + assistant_unpaid_played_bookings
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_0420$
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
end $assistant_run_tool_0420$;

comment on function app.assistant_run_tool(text, jsonb) is
  '0109, 0328, 0330, 0354, 0420. Owner-only. THE read-only wall for the assistant: turns transaction_read_only on, then dispatches over the fixed catalog of read RPC names (packages/core/src/assistant/tools.ts DISPATCHED_RPCS) with arguments pulled from p_args by p_* name. Unknown names raise ASSISTANT_UNKNOWN_TOOL. Returns {tool, data, row_count, truncated}. Called with the owner''s JWT by the assistant-chat edge function.';

revoke all on function app.assistant_run_tool(text, jsonb) from public, anon;
grant execute on function app.assistant_run_tool(text, jsonb) to authenticated;
