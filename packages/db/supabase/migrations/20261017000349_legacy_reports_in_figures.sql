-- 0349 legacy_reports_in_figures — the pre-system monthly padel reports (0331,
-- rows 0348) count in the figures the owner already reads: the management
-- panel and Analytics › Courts (Majed 2026-10-17: "connect them to what is
-- currently there", no new page).
--
-- The calls (Majed 2026-10-17):
--   * the summary figures count (source 'summary'). In all four reports the
--     summary and the chart agree; where the table disagrees (August's
--     cancelled 207 vs 105, September's 61 cancelled vs no-show) the summary
--     and chart win: August cancelled 105, September 61 no-shows.
--   * a report counts only when its whole month lies inside the picked range;
--     a range that cuts a report month leaves that report out and says so
--     ('partial'). Nothing is split into days, so nothing is invented.
--   * the money is padel court revenue from desk reservations: it adds into
--     padelRevenue (and so revenue, "Earned"). August's says "approximately"
--     itself, and revenueApproximate carries that.
-- Mapping: completed -> bookings (desk bookings in analytics), cancelled ->
-- cancellations, no_show -> noShows, training -> lessons, revenue_amount ->
-- padel revenue. not_completed, not_booked, free and total have no slot and
-- stay in the report tables. Cash, card, minutes, occupancy, per court, by day
-- and the heatmap get nothing: the reports do not have them, so with a report
-- month in the range occupancy, revenue per open hour and price per booked
-- hour are null (unknown), never a number computed from missing hours.
--
-- New internal helpers: app.legacy_report_totals, app.legacy_add_to_figures.
-- Re-issued from their latest bodies (20261001000288_lesson_reports.sql),
-- verbatim except the marked 0349 lines: app.panel_headline (+ figures with
-- the reports, + 'history') and app.analytics_courts_summary (+ kpis with the
-- reports, + 'history'). Same signatures and grants. app.reports_figures is
-- NOT changed: report_revenue and the day-close figures stay pinned equal to
-- it, and the assistant reads the report tables directly.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.legacy_report_totals: the reports of p_venues whose whole period lies
--    in [p_from, p_to], summed from their summary figures, plus the reports
--    the range only cuts.
-- ---------------------------------------------------------------------------
create or replace function app.legacy_report_totals(p_venues uuid[], p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $legacy_report_totals_0349$
declare
  v_out jsonb;
begin
  with
  inc as (
    select lr.* from legacy_reports lr
     where lr.venue_id = any(coalesce(p_venues, '{}'::uuid[]))
       and lr.period_from >= p_from and lr.period_to <= p_to),
  part as (
    select lr.* from legacy_reports lr
     where lr.venue_id = any(coalesce(p_venues, '{}'::uuid[]))
       and lr.period_from <= p_to and lr.period_to >= p_from
       and not (lr.period_from >= p_from and lr.period_to <= p_to)),
  fig as (
    select f.category, sum(f.count)::bigint as n
      from legacy_report_figures f
      join inc on inc.id = f.report_id
     where f.source = 'summary'
     group by f.category)
  select jsonb_build_object(
    'bookings',      (select n from fig where category = 'completed'),
    'cancellations', (select n from fig where category = 'cancelled'),
    'noShows',       (select n from fig where category = 'no_show'),
    'lessons',       (select n from fig where category = 'training'),
    'revenue',       (select sum(revenue_amount)::bigint from inc),
    'revenueApproximate', coalesce((select bool_or(revenue_approximate) from inc where revenue_amount is not null), false),
    'included', coalesce((select jsonb_agg(jsonb_build_object(
                    'from', inc.period_from, 'to', inc.period_to, 'department', inc.department,
                    'revenue', inc.revenue_amount, 'revenueApproximate', inc.revenue_approximate)
                    order by inc.period_from) from inc), '[]'::jsonb),
    'partial',  coalesce((select jsonb_agg(jsonb_build_object(
                    'from', part.period_from, 'to', part.period_to, 'department', part.department)
                    order by part.period_from) from part), '[]'::jsonb))
    into v_out;
  return v_out;
end $legacy_report_totals_0349$;

comment on function app.legacy_report_totals(uuid[], date, date) is
  '0349. Internal (read by panel_headline and analytics_courts_summary). The pre-system monthly reports (legacy_reports) of p_venues whose WHOLE period lies in [p_from, p_to], summed from their summary figures (Majed 2026-10-17: summary and chart win over a disagreeing table): bookings (completed), cancellations (cancelled), noShows (no_show), lessons (training), revenue (revenue_amount, padel court money from desk reservations) and revenueApproximate (a report calls its amount approximate); null where no included report has that figure. included: those reports {from, to, department, revenue, revenueApproximate}; partial: the reports the range overlaps but does not wholly contain (left out, never split into days).';

revoke all on function app.legacy_report_totals(uuid[], date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.legacy_add_to_figures: a reports_figures object plus the reports.
-- ---------------------------------------------------------------------------
create or replace function app.legacy_add_to_figures(p_fig jsonb, p_lg jsonb)
returns jsonb
language plpgsql immutable set search_path = public as $legacy_add_to_figures_0349$
declare
  v_rev bigint := coalesce((p_lg ->> 'revenue')::bigint, 0);
begin
  if p_fig is null or p_lg is null or jsonb_array_length(coalesce(p_lg -> 'included', '[]'::jsonb)) = 0 then
    return p_fig;
  end if;
  return p_fig
    || jsonb_build_object(
         'revenue',      (p_fig ->> 'revenue')::bigint + v_rev,
         'padelRevenue', (p_fig ->> 'padelRevenue')::bigint + v_rev,
         'bookings',     (p_fig ->> 'bookings')::bigint + coalesce((p_lg ->> 'bookings')::bigint, 0),
         'noShows',      (p_fig ->> 'noShows')::bigint + coalesce((p_lg ->> 'noShows')::bigint, 0));
end $legacy_add_to_figures_0349$;

comment on function app.legacy_add_to_figures(jsonb, jsonb) is
  '0349. Internal: an app.reports_figures object with app.legacy_report_totals added: revenue and padelRevenue + the reports'' revenue, bookings + their completed, noShows + their no-shows. Every other key (cash, card, café, online, lessons money) unchanged: the reports do not have them.';

revoke all on function app.legacy_add_to_figures(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. panel_headline: re-issued from 20261001000288_lesson_reports.sql:334.
-- ---------------------------------------------------------------------------
create or replace function app.panel_headline(p_from date, p_to date, p_compare text default 'none')
returns jsonb
language plpgsql stable security definer set search_path = public as $panel_headline_0349$
declare
  v_b        record;
  v_cur      jsonb;
  v_prev     jsonb;
  v_cmp_from date;
  v_cmp_to   date;
  v_len      int;
  -- 0265: the seven online-money and open-match keys go last (money.md §7.3),
  -- so every existing position is unchanged. 0288: the two coaching keys
  -- after them (money.md §8.2).
  v_keys     text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','bookings',
                             'orders','avgOrderValue','discounts','refunds','waste','noShows',
                             'onlineDeposits','depositForfeits','ticketSales','ticketRefunds',
                             'ticketForfeits','ticketLiability','matchWrittenOff',
                             'lessonRevenue','owedToCoaches'];
  v_figures  jsonb;
  -- 0349: the pre-system monthly reports whose whole month lies in the range.
  v_rv       uuid[] := app.report_venues();
  v_lg       jsonb;
  v_lgp      jsonb;
begin
  perform app.reports_guard(true);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_compare is null or p_compare not in ('previousPeriod','sameLastYear','none') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare', hint = 'p_compare must be ''previousPeriod'', ''sameLastYear'' or ''none''';
  end if;

  v_cur := app.reports_figures(p_from, p_to);
  v_lg  := app.legacy_report_totals(v_rv, p_from, p_to);
  v_cur := app.legacy_add_to_figures(v_cur, v_lg);

  if p_compare = 'previousPeriod' then
    v_len      := (p_to - p_from) + 1;
    v_cmp_to   := p_from - 1;
    v_cmp_from := p_from - v_len;
  elsif p_compare = 'sameLastYear' then
    v_cmp_from := (p_from - interval '1 year')::date;
    v_cmp_to   := (p_to   - interval '1 year')::date;
  end if;

  if v_cmp_from is not null then
    v_prev := app.reports_figures(v_cmp_from, v_cmp_to);
    v_lgp  := app.legacy_report_totals(v_rv, v_cmp_from, v_cmp_to);
    v_prev := app.legacy_add_to_figures(v_prev, v_lgp);
  end if;

  select jsonb_agg(jsonb_build_object(
           'key',       k,
           'value',     (v_cur ->> k)::bigint,
           'previous',  (v_prev ->> k)::bigint,
           'changeAbs', case when v_prev is not null
                             then (v_cur ->> k)::bigint - (v_prev ->> k)::bigint end,
           'changePct', case when v_prev is not null and (v_prev ->> k)::bigint > 0
                             then round(((v_cur ->> k)::bigint - (v_prev ->> k)::bigint) * 100.0
                                        / (v_prev ->> k)::bigint, 1) end
         ) order by ord)
    into v_figures
    from unnest(v_keys) with ordinality as u(k, ord);

  return jsonb_build_object(
    'period',     jsonb_build_object('from', p_from, 'to', p_to),
    'comparison', case when v_cmp_from is not null
                       then jsonb_build_object('from', v_cmp_from, 'to', v_cmp_to) end,
    'figures',    coalesce(v_figures, '[]'::jsonb),
    -- 0349: which monthly reports are in the figures, and which the range cuts.
    'history',    jsonb_build_object('period', v_lg, 'comparison', v_lgp));
end $panel_headline_0349$;

comment on function app.panel_headline(date, date, text) is
  '0349, from 0288 (0265). Owner only (reports_guard(true)): the management panel headline for a business-day range, {period, comparison, figures [{key, value, previous, changeAbs, changePct}]} in a fixed key order: revenue, padelRevenue, cafeRevenue, cafeNet, cash, card, bookings, orders, avgOrderValue, discounts, refunds, waste, noShows, then onlineDeposits, depositForfeits, ticketSales, ticketRefunds, ticketForfeits, ticketLiability, matchWrittenOff (money.md §7.3; ticketSales, ticketRefunds and ticketLiability are chain-wide), then lessonRevenue and owedToCoaches (coaching, money.md §8.2: lesson money in revenue as its own line, C-18; the coaches'' share, information only). p_compare: none, previousPeriod or sameLastYear. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT. 0349: period and comparison figures include the pre-system monthly reports whose whole month lies in that window (app.legacy_report_totals: bookings, noShows, padelRevenue, revenue), and history {period, comparison} names the reports included and the ones the window cuts.';

revoke all on function app.panel_headline(date, date, text) from public, anon;
grant execute on function app.panel_headline(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. analytics_courts_summary: re-issued from 20261001000288_lesson_reports.sql:958.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_summary_0349$
declare
  v_b   record;
  v_out jsonb;
  v_av  uuid := app.analysis_venue();
  v_lg  jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  -- 0349: the pre-system monthly reports (whole months in the range only).
  -- They name no court, so a one-court view leaves them out.
  v_lg := case when p_court_id is null
               then app.legacy_report_totals(array[v_av], p_from, p_to)
               else app.legacy_report_totals('{}'::uuid[], p_from, p_to) end;

  with
  b as (
    select r.id, r.court_id, r.source::text as source,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           r.start_at at time zone v_b.tz                                            as s_local,
           r.end_at at time zone v_b.tz                                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)                     as d,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status in ('confirmed','arrived','completed')                           as live,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show
      from reservations r
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  -- 0288 (CM-14): a lesson's live court rows, occupied time.
  ls as (
    select r.id, r.court_id,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           r.start_at at time zone v_b.tz                                            as s_local,
           r.end_at at time zone v_b.tz                                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)                     as d
      from reservations r
     where r.venue_id = v_av and r.kind = 'lesson'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  holds as (
    select extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.venue_id = v_av and r.kind = 'hold' and r.status = 'expired' and r.source = 'mobile'
       -- 0288: a lapsed online lesson payment is not a lapsed court hold.
       and r.lesson_id is null
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where c.venue_id = v_av and (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id)
            or exists (select 1 from ls where ls.court_id = c.id))),
  oc as (
    select o.court_id, o.dow, o.hour, o.open_minutes, o.open_days, o.event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id),
  court_open as (
    select oc.court_id, sum(oc.open_minutes)::bigint as open_minutes, sum(oc.event_minutes)::bigint as event_minutes
      from oc group by oc.court_id),
  lc as (
    select ls.court_id, count(*)::bigint as lessons, coalesce(sum(ls.mins), 0)::bigint as lesson_minutes
      from ls group by ls.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(co.open_minutes, 0)::bigint                           as open_minutes,
           coalesce(co.event_minutes, 0)::bigint                          as event_minutes,
           coalesce(lc.lessons, 0)::bigint                                as lessons,
           coalesce(lc.lesson_minutes, 0)::bigint                         as lesson_minutes,
           count(b.id) filter (where b.live)                              as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint         as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint    as revenue_iqd,
           count(b.id) filter (where b.cancelled)                         as cancellations,
           count(b.id) filter (where b.no_show)                           as no_shows,
           count(b.id) filter (where b.live and b.source = 'mobile')      as mobile_bookings,
           count(b.id) filter (where b.live and b.source = 'desk')        as desk_bookings,
           avg(b.mins) filter (where b.live)                              as avg_duration_min
      from courts_in c
      left join court_open co on co.court_id = c.id
      left join lc on lc.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, co.open_minutes, co.event_minutes,
              lc.lessons, lc.lesson_minutes),
  lg as (
    select coalesce((v_lg ->> 'bookings')::bigint, 0)      as bookings,
           coalesce((v_lg ->> 'cancellations')::bigint, 0) as cancellations,
           coalesce((v_lg ->> 'noShows')::bigint, 0)       as no_shows,
           coalesce((v_lg ->> 'lessons')::bigint, 0)       as lessons,
           coalesce((v_lg ->> 'revenue')::bigint, 0)       as revenue_iqd,
           jsonb_array_length(v_lg -> 'included') > 0      as any_month),
  tot_live as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.lessons), 0)::bigint            as lessons,
           coalesce(sum(pc.lesson_minutes), 0)::bigint     as lesson_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           coalesce(sum(pc.open_minutes), 0)::bigint       as open_minutes,
           coalesce(sum(pc.event_minutes), 0)::bigint      as event_minutes
      from per_court pc),
  -- 0349: the totals with the reports' months added. The reports were taken
  -- at the desk (Majed 2026-10-17), so their bookings are desk bookings. They
  -- carry no minutes: booked and lesson minutes stay live-only.
  tot as (
    select tl.courts_count,
           tl.bookings + lg.bookings               as bookings,
           tl.booked_minutes,
           tl.lessons + lg.lessons                 as lessons,
           tl.lesson_minutes,
           tl.revenue_iqd + lg.revenue_iqd         as revenue_iqd,
           tl.cancellations + lg.cancellations     as cancellations,
           tl.no_shows + lg.no_shows               as no_shows,
           tl.mobile_bookings,
           tl.desk_bookings + lg.bookings          as desk_bookings,
           tl.open_minutes,
           tl.event_minutes,
           lg.any_month
      from tot_live tl, lg),
  days as (
    select gs::date as d
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs),
  by_day as (
    select d.d,
           coalesce((select case when jsonb_typeof(vs.opening_hours -> lower(to_char(d.d, 'Dy'))) = 'array'
                                  then jsonb_array_length(vs.opening_hours -> lower(to_char(d.d, 'Dy')))
                                  else 0 end = 0
                            or d.d = any (coalesce(vs.closed_dates, '{}'))
                       from venue_settings vs where vs.venue_id = v_av), true) as closed,
           count(b.id) filter (where b.live)                           as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint      as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as revenue_iqd,
           count(b.id) filter (where b.cancelled)                      as cancellations,
           count(b.id) filter (where b.no_show)                        as no_shows,
           (select coalesce(sum(ls.mins), 0) from ls where ls.d = d.d)::bigint as lesson_minutes
      from days d
      left join b on b.d = d.d
     group by d.d),
  split as (
    select extract(dow from (gs - make_interval(hours => v_b.start_hour))::date)::int as dow,
           extract(hour from gs)::int                                                 as hour,
           sum(extract(epoch from (least(b.e_local, gs + interval '1 hour') - greatest(b.s_local, gs))) / 60) as booked_minutes
      from b
      cross join lateral generate_series(date_trunc('hour', b.s_local), b.e_local, interval '1 hour') gs
     where b.live and gs < b.e_local
     group by 1, 2),
  -- 0288: lesson minutes split per hour as the bookings are.
  lsplit as (
    select extract(dow from (gs - make_interval(hours => v_b.start_hour))::date)::int as dow,
           extract(hour from gs)::int                                                 as hour,
           sum(extract(epoch from (least(ls.e_local, gs + interval '1 hour') - greatest(ls.s_local, gs))) / 60) as lesson_minutes
      from ls
      cross join lateral generate_series(date_trunc('hour', ls.s_local), ls.e_local, interval '1 hour') gs
     where gs < ls.e_local
     group by 1, 2),
  starts as (
    select b.dow, b.hour,
           count(*) filter (where b.live)                               as bookings,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint  as revenue_iqd,
           count(*) filter (where b.cancelled)                          as cancellations,
           count(*) filter (where b.no_show)                            as no_shows
      from b
     group by b.dow, b.hour),
  hold_cells as (
    select h.dow, h.hour, count(*) as holds_expired from holds h group by h.dow, h.hour),
  open_cells as (
    -- VENUE-WIDE: every court in courts_in, summed per cell.
    select oc.dow, oc.hour, sum(oc.open_minutes)::bigint as open_minutes, max(oc.open_days)::int as open_days
      from oc
     group by oc.dow, oc.hour),
  keys as (
    select oc.dow, oc.hour from open_cells oc
    union select sp.dow, sp.hour from split sp
    union select lsp.dow, lsp.hour from lsplit lsp
    union select st.dow, st.hour from starts st
    union select hc.dow, hc.hour from hold_cells hc),
  heat as (
    select k.dow, k.hour,
           coalesce(oc.open_minutes, 0)::bigint            as open_minutes,
           coalesce(oc.open_days, 0)                       as open_days,
           coalesce(round(sp.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(round(lsp.lesson_minutes), 0)::bigint  as lesson_minutes,
           coalesce(st.bookings, 0)                        as bookings,
           coalesce(st.revenue_iqd, 0)                     as revenue_iqd,
           coalesce(st.cancellations, 0)                   as cancellations,
           coalesce(st.no_shows, 0)                        as no_shows,
           coalesce(hc.holds_expired, 0)                   as holds_expired
      from keys k
      left join open_cells oc on oc.dow = k.dow and oc.hour = k.hour
      left join split sp      on sp.dow = k.dow and sp.hour = k.hour
      left join lsplit lsp    on lsp.dow = k.dow and lsp.hour = k.hour
      left join starts st     on st.dow = k.dow and st.hour = k.hour
      left join hold_cells hc on hc.dow = k.dow and hc.hour = k.hour)
  select jsonb_build_object(
    'range',         jsonb_build_object('from', p_from, 'to', p_to),
    -- 0349: which monthly reports are in kpis, and which the range cuts.
    'history',       v_lg,
    'courts_count',  t.courts_count,
    'open_minutes',  t.open_minutes,
    'event_minutes', t.event_minutes,
    'kpis', jsonb_build_object(
      'bookings',                  t.bookings,
      'booked_minutes',            t.booked_minutes,
      'lessons',                   t.lessons,
      'lesson_minutes',            t.lesson_minutes,
      -- 0349: the reports have no hours, so these are unknown with one in.
      'occupancy_pct',             case when t.any_month then null when t.open_minutes > 0 then round((t.booked_minutes + t.lesson_minutes) * 100.0 / t.open_minutes, 1) end,
      'revenue_iqd',               t.revenue_iqd,
      'rev_per_open_hour_iqd',     case when t.any_month then null when t.open_minutes > 0 then round(t.revenue_iqd * 60.0 / t.open_minutes)::bigint end,
      'price_per_booked_hour_iqd', case when t.any_month then null when t.booked_minutes > 0 then round(t.revenue_iqd * 60.0 / t.booked_minutes)::bigint end,
      'cancellations',             t.cancellations,
      'no_shows',                  t.no_shows,
      'booked_total',              t.bookings + t.cancellations + t.no_shows,
      'cancellation_rate_pct',     case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.cancellations * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'no_show_rate_pct',          case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.no_shows * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'mobile_bookings',           t.mobile_bookings,
      'desk_bookings',             t.desk_bookings,
      'holds_expired',             (select count(*) from holds),
      'booking_days',              (select count(distinct b.d) from b where b.live)),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',              pc.id,
               'name_en',               pc.name_en,
               'name_ar',               pc.name_ar,
               'is_active',             pc.is_active,
               'bookings',              pc.bookings,
               'booked_minutes',        pc.booked_minutes,
               'lessons',               pc.lessons,
               'lesson_minutes',        pc.lesson_minutes,
               'open_minutes',          pc.open_minutes,
               'occupancy_pct',         case when pc.open_minutes > 0 then round((pc.booked_minutes + pc.lesson_minutes) * 100.0 / pc.open_minutes, 1) end,
               'revenue_iqd',           pc.revenue_iqd,
               'rev_per_open_hour_iqd', case when pc.open_minutes > 0 then round(pc.revenue_iqd * 60.0 / pc.open_minutes)::bigint end,
               'cancellations',         pc.cancellations,
               'no_shows',              pc.no_shows,
               'booked_total',          pc.bookings + pc.cancellations + pc.no_shows,
               'cancellation_rate_pct', case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'no_show_rate_pct',      case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'mobile_bookings',       pc.mobile_bookings,
               'desk_bookings',         pc.desk_bookings,
               'avg_duration_min',      round(pc.avg_duration_min, 1)
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'business_date',  x.d,
               'closed',         x.closed,
               'bookings',       x.bookings,
               'booked_minutes', x.booked_minutes,
               'lesson_minutes', x.lesson_minutes,
               'revenue_iqd',    x.revenue_iqd,
               'cancellations',  x.cancellations,
               'no_shows',       x.no_shows
             ) order by x.d), '[]'::jsonb)
        from by_day x),
    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',            h.dow,
               'hour',           h.hour,
               'open_minutes',   h.open_minutes,
               'open_days',      h.open_days,
               'booked_minutes', h.booked_minutes,
               'lesson_minutes', h.lesson_minutes,
               'bookings',       h.bookings,
               'revenue_iqd',    h.revenue_iqd,
               'cancellations',  h.cancellations,
               'no_shows',       h.no_shows,
               'holds_expired',  h.holds_expired
             ) order by h.dow, h.hour), '[]'::jsonb)
        from heat h))
    into v_out
    from tot t;

  return v_out;
end $analytics_courts_summary_0349$;

comment on function app.analytics_courts_summary(date, date, uuid) is
  '0349, from 0288 (0219, 0214). Owner analytics (analytics_guard): the analysed branch''s courts for a business-day range (p_court_id narrows): kpis, per_court, by_day and heatmap. 0288 (money.md §8.5, CM-14): a lesson''s live court rows are occupied time: lessons and lesson_minutes in kpis and per_court, lesson_minutes in by_day and heatmap (split per hour as bookings are), and every occupancy_pct over booked + lesson minutes; bookings, revenue and the rates stay bookings only; holds_expired leaves out a lapsed lesson payment''s hold (lesson_id set). Branch aggregates only. 0349: with no court filter, kpis include the pre-system monthly reports whose whole month lies in the range (bookings and desk_bookings + completed, cancellations, no_shows, lessons + training, revenue_iqd; the rates over those sums); occupancy_pct, rev_per_open_hour_iqd and price_per_booked_hour_iqd are null with a report month in (no hours in the reports); per_court, by_day and heatmap stay live; history names the reports included and the ones the range cuts.';

revoke all on function app.analytics_courts_summary(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_summary(date, date, uuid) to authenticated;
