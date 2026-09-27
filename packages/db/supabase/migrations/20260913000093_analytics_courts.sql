-- 0093_analytics_courts: the Courts analytics tab. Five owner-only jsonb RPCs
-- (summary, demand, endings, guests, cafe) plus one internal helper
-- (app.analytics_open_cells) that opens the venue's hours per weekday x hour.
--
-- Posture
--  * Every client RPC is (p_from date, p_to date, p_court_id uuid default null),
--    `plpgsql stable security definer set search_path = public`, and runs the
--    0034 prologue: app.analytics_guard() FIRST (FORBIDDEN unless owner), then
--    app.analytics_bounds() (INVALID_RANGE), then aggregate. Nothing here
--    writes: no audit rows, no side effects.
--  * p_court_id narrows every section to one court. An unknown uuid yields
--    empty sections and zero counts, not an error. A malformed value never
--    reaches a body: the parameter is typed uuid, so PostgREST refuses it
--    before the call (report_courts takes text inside jsonb and has to raise
--    INVALID_ARGUMENT itself; a typed parameter makes that branch unreachable).
--  * Basis conventions (shared with 0068 report_courts where they overlap):
--      live booking    kind = 'booking' and status in (confirmed, arrived, completed)
--      booked_total    live + cancelled + no_show; the denominator of every rate
--      selection       start_at in [ts_from, ts_to): the slot's business day,
--                      for every status
--      day buckets     the 3-arg app.business_date(start_at, tz, start_hour)
--      heat cells      calendar-local (dow 0 = Sunday .. 6 = Saturday, hour) of
--                      start_at. A booking's MINUTES are split across every
--                      hour cell it overlaps; its count, money and endings sit
--                      in its start cell
--      open minutes    app.reports_available_minutes(p_from, p_to) is the
--                      venue-wide figure for one court; the venue KPI is that
--                      times courts_count. Per cell: app.analytics_open_cells
--                      over the same [ts_from, ts_to) window as the bookings,
--                      so post-midnight cells at both range edges line up
--      rates           NULL, never 0, when the denominator is 0
--      court money     coalesce(price_iqd, 0) of live bookings
--      cafe money      settled linked tabs as total_iqd - court_iqd (0053/0068)
--      linked tab      reservation_id is not null and status <> 'void' and
--                      merged_into_tab_id is null
--      hold funnel     MOBILE only: expired mobile holds against mobile
--                      bookings (released holds are written as expired, so
--                      they count as ended)
--      lead time       series_id is null only: an occurrence inherits the
--                      series' created_at, so its lead time says nothing.
--                      created_hour / created_dow follow the same rule
--      courts_count    active courts plus inactive ones with bookings in range
--      breakdown rows  {key text, n, bookings_total}; the key is always text
--                      so one row shape serves every dimension
--  * SEC-29 (scripts/check-analytics-payload.mjs): these payloads are POSTed
--    to a third-party LLM. No function emits a guest identifier. Guest
--    identity is computed ONLY inside a CTE (an account id or a canonical
--    phone number, prefixed so the two namespaces never collide), used for
--    counting, and never reaches a JSON key or value. No quoted literal in
--    any body names an identity column; returning / new / unidentified are
--    the only per-guest words that leave.
--
-- Depends on: 0034 (analytics_guard, analytics_bounds, business_date/3,
-- analytics_excluded), 0065 (phone_canon), 0068 (reports_available_minutes),
-- 0088 (cancelled_by), 0092 (players). Additive only: new app.* functions,
-- no tables, no enum edits. Every error is
-- `raise exception '<CODE>' using errcode = 'P0001'`.
--
-- covered by tests/analytics-courts.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.analytics_open_cells: open minutes per (calendar-local dow, hour)
--    across [p_ts_from, p_ts_to). Walks every venue-local hour of the window,
--    reads that CALENDAR day's opening windows (venue_settings.opening_hours
--    keyed mon..sun, windows measured from local midnight, so a day may open
--    as [["00:00","02:00"],["09:00","24:00"]]), skips closed_dates, and sums
--    the overlap of [h, h+1) with the windows. open_days = distinct calendar
--    days that contributed minutes to the cell. Same arithmetic as
--    reports_available_minutes (0068), one level finer. Service role only.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_open_cells(
  p_ts_from timestamptz,
  p_ts_to   timestamptz,
  p_tz      text
) returns table (dow int, hour int, open_minutes bigint, open_days int)
language sql stable security definer set search_path = public as $fn_analytics_open_cells_0093$
  with hours as (
    select gs as h
      from generate_series(date_trunc('hour', p_ts_from at time zone p_tz),
                           p_ts_to at time zone p_tz,
                           interval '1 hour') gs
     where gs < (p_ts_to at time zone p_tz)),
  cells as (
    select h.h::date                    as d,
           extract(dow from h.h)::int   as dow,
           extract(hour from h.h)::int  as hour,
           greatest(0,
             least(extract(hour from h.h) + 1, extract(epoch from (w ->> 1)::interval) / 3600)
             - greatest(extract(hour from h.h), extract(epoch from (w ->> 0)::interval) / 3600)) * 60 as mins
      from hours h
      cross join venue_settings vs
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(vs.opening_hours -> lower(to_char(h.h, 'Dy'))) = 'array'
             then vs.opening_hours -> lower(to_char(h.h, 'Dy'))
             else '[]'::jsonb end) w
     where not (h.h::date = any (coalesce(vs.closed_dates, '{}'))))
  select c.dow,
         c.hour,
         round(sum(c.mins))::bigint                          as open_minutes,
         count(distinct c.d) filter (where c.mins > 0)::int  as open_days
    from cells c
   group by c.dow, c.hour
  having sum(c.mins) > 0
$fn_analytics_open_cells_0093$;

revoke all on function app.analytics_open_cells(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function app.analytics_open_cells(timestamptz, timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.analytics_courts_summary: KPIs, per court, per business day, heatmap.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_summary_0093$
declare
  v_b     record;
  v_avail bigint;
  v_out   jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_avail := app.reports_available_minutes(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.players,
           coalesce(r.price_iqd, 0)::bigint                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int   as mins,
           r.start_at at time zone v_b.tz                            as s_local,
           r.end_at at time zone v_b.tz                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)     as d,
           extract(dow from (r.start_at at time zone v_b.tz))::int   as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int  as hour,
           r.status in ('confirmed','arrived','completed')           as live,
           r.status = 'cancelled'                                    as cancelled,
           r.status = 'no_show'                                      as no_show
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  holds as (
    select extract(dow from (r.start_at at time zone v_b.tz))::int   as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int  as hour
      from reservations r
     where r.kind = 'hold' and r.status = 'expired' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           count(b.id) filter (where b.live)                              as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint         as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint    as revenue_iqd,
           count(b.id) filter (where b.cancelled)                         as cancellations,
           count(b.id) filter (where b.no_show)                           as no_shows,
           count(b.id) filter (where b.live and b.source = 'mobile')      as mobile_bookings,
           count(b.id) filter (where b.live and b.source = 'desk')        as desk_bookings,
           avg(b.mins) filter (where b.live)                              as avg_duration_min,
           count(b.id) filter (where b.live and b.players is not null)    as players_known,
           avg(b.players) filter (where b.live)                           as players_avg
      from courts_in c
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active),
  tot as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           (count(*) * v_avail)::bigint                     as open_minutes
      from per_court pc),
  days as (
    select gs::date as d
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs),
  by_day as (
    select d.d,
           coalesce((select case when jsonb_typeof(vs.opening_hours -> lower(to_char(d.d, 'Dy'))) = 'array'
                                  then jsonb_array_length(vs.opening_hours -> lower(to_char(d.d, 'Dy')))
                                  else 0 end = 0
                            or d.d = any (coalesce(vs.closed_dates, '{}'))
                       from venue_settings vs limit 1), true)         as closed,
           count(b.id) filter (where b.live)                           as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint      as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as revenue_iqd,
           count(b.id) filter (where b.cancelled)                      as cancellations,
           count(b.id) filter (where b.no_show)                        as no_shows
      from days d
      left join b on b.d = d.d
     group by d.d),
  split as (
    select extract(dow from gs)::int   as dow,
           extract(hour from gs)::int  as hour,
           sum(extract(epoch from (least(b.e_local, gs + interval '1 hour') - greatest(b.s_local, gs))) / 60) as booked_minutes
      from b
      cross join lateral generate_series(date_trunc('hour', b.s_local), b.e_local, interval '1 hour') gs
     where b.live and gs < b.e_local
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
    select oc.dow, oc.hour, oc.open_minutes, oc.open_days
      from app.analytics_open_cells(v_b.ts_from, v_b.ts_to, v_b.tz) oc),
  keys as (
    select oc.dow, oc.hour from open_cells oc
    union select sp.dow, sp.hour from split sp
    union select st.dow, st.hour from starts st
    union select hc.dow, hc.hour from hold_cells hc),
  heat as (
    select k.dow, k.hour,
           coalesce(oc.open_minutes, 0)::bigint            as open_minutes,
           coalesce(oc.open_days, 0)                       as open_days,
           coalesce(round(sp.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(st.bookings, 0)                        as bookings,
           coalesce(st.revenue_iqd, 0)                     as revenue_iqd,
           coalesce(st.cancellations, 0)                   as cancellations,
           coalesce(st.no_shows, 0)                        as no_shows,
           coalesce(hc.holds_expired, 0)                   as holds_expired
      from keys k
      left join open_cells oc on oc.dow = k.dow and oc.hour = k.hour
      left join split sp      on sp.dow = k.dow and sp.hour = k.hour
      left join starts st     on st.dow = k.dow and st.hour = k.hour
      left join hold_cells hc on hc.dow = k.dow and hc.hour = k.hour)
  select jsonb_build_object(
    'range',        jsonb_build_object('from', p_from, 'to', p_to),
    'courts_count', t.courts_count,
    'open_minutes', t.open_minutes,
    'kpis', jsonb_build_object(
      'bookings',                  t.bookings,
      'booked_minutes',            t.booked_minutes,
      'occupancy_pct',             case when t.open_minutes > 0 then round(t.booked_minutes * 100.0 / t.open_minutes, 1) end,
      'revenue_iqd',               t.revenue_iqd,
      'rev_per_open_hour_iqd',     case when t.open_minutes > 0 then round(t.revenue_iqd * 60.0 / t.open_minutes)::bigint end,
      'price_per_booked_hour_iqd', case when t.booked_minutes > 0 then round(t.revenue_iqd * 60.0 / t.booked_minutes)::bigint end,
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
               'open_minutes',          v_avail,
               'occupancy_pct',         case when v_avail > 0 then round(pc.booked_minutes * 100.0 / v_avail, 1) end,
               'revenue_iqd',           pc.revenue_iqd,
               'rev_per_open_hour_iqd', case when v_avail > 0 then round(pc.revenue_iqd * 60.0 / v_avail)::bigint end,
               'cancellations',         pc.cancellations,
               'no_shows',              pc.no_shows,
               'booked_total',          pc.bookings + pc.cancellations + pc.no_shows,
               'cancellation_rate_pct', case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'no_show_rate_pct',      case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'mobile_bookings',       pc.mobile_bookings,
               'desk_bookings',         pc.desk_bookings,
               'avg_duration_min',      round(pc.avg_duration_min, 1),
               'players_known',         pc.players_known,
               'players_avg',           round(pc.players_avg, 2)
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'business_date',  x.d,
               'closed',         x.closed,
               'bookings',       x.bookings,
               'booked_minutes', x.booked_minutes,
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
end $fn_analytics_courts_summary_0093$;

-- ---------------------------------------------------------------------------
-- 3. app.analytics_courts_demand: durations, lead time, when bookings are
--    made, sources, the mobile hold funnel, group size, standing bookings.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_demand(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_demand_0093$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.players, r.series_id,
           coalesce(r.price_iqd, 0)::bigint                            as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int     as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60        as lead_min,
           extract(hour from (r.created_at at time zone v_b.tz))::int  as c_hour,
           extract(dow from (r.created_at at time zone v_b.tz))::int   as c_dow,
           r.status in ('confirmed','arrived','completed')             as live,
           r.status = 'cancelled'                                      as cancelled,
           r.status = 'no_show'                                        as no_show
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  -- lead time and creation clock: live, single (non-series) bookings only
  lb as (
    select b.*,
           case when b.lead_min < 120   then 'lt2h'
                when b.lead_min < 360   then '2_6h'
                when b.lead_min < 1440  then '6_24h'
                when b.lead_min < 4320  then '1_3d'
                when b.lead_min < 10080 then '3_7d'
                else '7d_plus' end as lead_bucket
      from b
     where b.live and b.series_id is null),
  lead_keys as (
    select k.bucket, k.ord
      from (values ('lt2h', 1), ('2_6h', 2), ('6_24h', 3), ('1_3d', 4), ('3_7d', 5), ('7d_plus', 6)) k(bucket, ord)),
  src_keys as (
    select s.source from (values ('mobile'), ('desk')) s(source)),
  holds as (
    select count(*) filter (where r.status = 'expired')  as expired,
           count(*) filter (where r.status = 'pending')  as pending
      from reservations r
     where r.kind = 'hold' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  converted as (
    select count(*) as n from b where b.source = 'mobile')
  select jsonb_build_object(
    'durations', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'duration_min',         x.mins,
               'bookings',             x.n,
               'booked_minutes',       x.bm,
               'revenue_iqd',          x.rev,
               'revenue_per_hour_iqd', case when x.bm > 0 then round(x.rev * 60.0 / x.bm)::bigint end
             ) order by x.mins), '[]'::jsonb)
        from (select b.mins, count(*) as n, sum(b.mins)::bigint as bm, sum(b.price_iqd)::bigint as rev
                from b where b.live group by b.mins) x),
    'lead_time', jsonb_build_object(
      'median_min', (select round(percentile_cont(0.5) within group (order by lb.lead_min::double precision))::int from lb),
      'buckets', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',   k.bucket,
                 'bookings', coalesce(x.n, 0),
                 'mobile',   coalesce(x.m, 0),
                 'desk',     coalesce(x.d, 0)
               ) order by k.ord)
          from lead_keys k
          left join (select lb.lead_bucket, count(*) as n,
                            count(*) filter (where lb.source = 'mobile') as m,
                            count(*) filter (where lb.source = 'desk')   as d
                       from lb group by lb.lead_bucket) x on x.lead_bucket = k.bucket)),
    'created_hour', (
      select jsonb_agg(jsonb_build_object('hour', gs, 'bookings', (select count(*) from lb where lb.c_hour = gs)) order by gs)
        from generate_series(0, 23) gs),
    'created_dow', (
      select jsonb_agg(jsonb_build_object('dow', gs, 'bookings', (select count(*) from lb where lb.c_dow = gs)) order by gs)
        from generate_series(0, 6) gs),
    'sources', (
      select jsonb_agg(jsonb_build_object(
               'source',           s.source,
               'bookings',         coalesce(x.n, 0),
               'revenue_iqd',      coalesce(x.rev, 0),
               'cancellations',    coalesce(x.canc, 0),
               'no_shows',         coalesce(x.ns, 0),
               'avg_duration_min', x.avg_dur
             ) order by s.source)
        from src_keys s
        left join (select b.source,
                          count(*) filter (where b.live)                              as n,
                          coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as rev,
                          count(*) filter (where b.cancelled)                         as canc,
                          count(*) filter (where b.no_show)                           as ns,
                          round(avg(b.mins) filter (where b.live), 1)                 as avg_dur
                     from b group by b.source) x on x.source = s.source),
    'hold_funnel', jsonb_build_object(
      'holds_ended',    h.expired + c.n,
      'converted',      c.n,
      'pending',        h.pending,
      'conversion_pct', case when h.expired + c.n > 0 then round(c.n * 100.0 / (h.expired + c.n), 1) end),
    'players', jsonb_build_object(
      'known',   (select count(*) from b where b.live and b.players is not null),
      'unknown', (select count(*) from b where b.live and b.players is null),
      'avg',     (select round(avg(b.players), 2) from b where b.live),
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'players',          x.players,
                 'bookings',         x.n,
                 'revenue_iqd',      x.rev,
                 'avg_duration_min', x.avg_dur,
                 'mobile',           x.m,
                 'desk',             x.d
               ) order by x.players nulls last), '[]'::jsonb)
          from (select b.players, count(*) as n, sum(b.price_iqd)::bigint as rev,
                       round(avg(b.mins), 1) as avg_dur,
                       count(*) filter (where b.source = 'mobile') as m,
                       count(*) filter (where b.source = 'desk')   as d
                  from b where b.live group by b.players) x)),
    'players_by_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id', x.court_id, 'players', x.players, 'bookings', x.n
             ) order by x.court_id, x.players nulls last), '[]'::jsonb)
        from (select b.court_id, b.players, count(*) as n from b where b.live group by b.court_id, b.players) x),
    'series', (
      select jsonb_build_object(
               'series_bookings',    count(*) filter (where b.series_id is not null),
               'single_bookings',    count(*) filter (where b.series_id is null),
               'series_pct',         case when count(*) > 0
                                          then round(count(*) filter (where b.series_id is not null) * 100.0 / count(*), 1) end,
               'series_revenue_iqd', coalesce(sum(b.price_iqd) filter (where b.series_id is not null), 0)::bigint)
        from b where b.live))
    into v_out
    from holds h, converted c;

  return v_out;
end $fn_analytics_courts_demand_0093$;

-- ---------------------------------------------------------------------------
-- 4. app.analytics_courts_endings: cancellations and no-shows, broken down.
--    Every by_* row is {key, n, bookings_total}: n endings of that kind out
--    of bookings_total booked slots in the same segment. by_court rows also
--    carry court_id / name_en / name_ar. by_type classifies the booking's
--    guest as returning (a live booking earlier, within a 180-day lookback
--    before the range), new (identified, none earlier) or unidentified.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_endings(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_endings_0093$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.players, r.series_id, r.start_at,
           coalesce(r.price_iqd, 0)::bigint                            as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int     as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60        as lead_min,
           extract(epoch from (r.start_at - r.cancelled_at)) / 60      as notice_min,
           coalesce(r.cancelled_by::text, 'unknown')                   as actor,
           extract(dow from (r.start_at at time zone v_b.tz))::int     as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int    as hour,
           r.status = 'cancelled'                                      as cancelled,
           r.status = 'no_show'                                        as no_show,
           case when r.guest_id is not null then 'u:' || r.guest_id::text
                when app.phone_canon(r.guest_phone) is not null then 'p:' || app.phone_canon(r.guest_phone)
           end                                                         as ident
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when app.phone_canon(r.guest_phone) is not null then 'p:' || app.phone_canon(r.guest_phone)
           end          as ident,
           r.start_at
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  typed as (
    select b.*,
           case when b.ident is null then 'unidentified'
                when exists (select 1 from hist h where h.ident = b.ident and h.start_at < b.start_at) then 'returning'
                else 'new' end as typ,
           case when b.series_id is not null then null
                when b.lead_min < 120   then 'lt2h'
                when b.lead_min < 360   then '2_6h'
                when b.lead_min < 1440  then '6_24h'
                when b.lead_min < 4320  then '1_3d'
                when b.lead_min < 10080 then '3_7d'
                else '7d_plus' end as lead_bucket,
           case when b.notice_min is null then null
                when b.notice_min < 0    then 'after_start'
                when b.notice_min < 120  then 'lt2h'
                when b.notice_min < 360  then '2_6h'
                when b.notice_min < 1440 then '6_24h'
                when b.notice_min < 4320 then '1_3d'
                else '3d_plus' end as notice_bucket
      from b),
  segs as (
    select t.id, t.cancelled, t.no_show, x.dim, x.key, x.ord
      from typed t
      cross join lateral (values
        ('hour',      t.hour::text,                                                   t.hour),
        ('dow',       t.dow::text,                                                    t.dow),
        ('court',     t.court_id::text,                                               0),
        ('source',    t.source,                                                       0),
        ('duration',  t.mins::text,                                                   t.mins),
        ('lead_time', t.lead_bucket,                                                  case t.lead_bucket
                                                                                        when 'lt2h' then 1 when '2_6h' then 2 when '6_24h' then 3
                                                                                        when '1_3d' then 4 when '3_7d' then 5 else 6 end),
        ('series',    case when t.series_id is null then 'single' else 'series' end,  0),
        ('type',      t.typ,                                                          case t.typ when 'returning' then 1 when 'new' then 2 else 3 end),
        ('players',   coalesce(t.players::text, 'unknown'),                           coalesce(t.players, 99))
      ) x(dim, key, ord)
     where x.key is not null),
  agg as (
    select s.dim, s.key, min(s.ord) as ord,
           count(*) filter (where s.cancelled) as canc,
           count(*) filter (where s.no_show)   as ns,
           count(*)                            as total
      from segs s
     group by s.dim, s.key),
  rows_c as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.canc, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  rows_n as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.ns, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  notice_keys as (
    select k.bucket, k.ord
      from (values ('after_start', 1), ('lt2h', 2), ('2_6h', 3), ('6_24h', 4), ('1_3d', 5), ('3d_plus', 6)) k(bucket, ord)),
  actor_keys as (
    select k.actor, k.ord
      from (values ('guest', 1), ('staff', 2), ('unknown', 3)) k(actor, ord))
  select jsonb_build_object(
    'cancellations', jsonb_build_object(
      'total',             (select count(*) from b where b.cancelled),
      'revenue_iqd',       (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.cancelled),
      'late_revenue_iqd',  (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.cancelled and b.notice_min < 360),
      'median_notice_min', (select round(percentile_cont(0.5) within group (order by b.notice_min::double precision))::int
                              from b where b.cancelled and b.notice_min is not null),
      'by_notice', (
        select jsonb_agg(jsonb_build_object('bucket', k.bucket, 'n', coalesce(x.n, 0)) order by k.ord)
          from notice_keys k
          left join (select t.notice_bucket, count(*) as n from typed t where t.cancelled group by t.notice_bucket) x
                 on x.notice_bucket = k.bucket),
      'by_actor', (
        select jsonb_agg(jsonb_build_object('actor', k.actor, 'n', coalesce(x.n, 0)) order by k.ord)
          from actor_keys k
          left join (select b.actor, count(*) as n from b where b.cancelled group by b.actor) x on x.actor = k.actor),
      'by_hour',      coalesce((select rc.rows from rows_c rc where rc.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rc.rows from rows_c rc where rc.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rc.rows from rows_c rc where rc.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rc.rows from rows_c rc where rc.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rc.rows from rows_c rc where rc.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rc.rows from rows_c rc where rc.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rc.rows from rows_c rc where rc.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rc.rows from rows_c rc where rc.dim = 'type'),      '[]'::jsonb)),
    'no_shows', jsonb_build_object(
      'total',        (select count(*) from b where b.no_show),
      'revenue_iqd',  (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.no_show),
      'by_hour',      coalesce((select rn.rows from rows_n rn where rn.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rn.rows from rows_n rn where rn.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rn.rows from rows_n rn where rn.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rn.rows from rows_n rn where rn.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rn.rows from rows_n rn where rn.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rn.rows from rows_n rn where rn.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rn.rows from rows_n rn where rn.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rn.rows from rows_n rn where rn.dim = 'type'),      '[]'::jsonb),
      'by_players',   coalesce((select rn.rows from rows_n rn where rn.dim = 'players'),   '[]'::jsonb)))
    into v_out;

  return v_out;
end $fn_analytics_courts_endings_0093$;

-- ---------------------------------------------------------------------------
-- 5. app.analytics_courts_guests: anonymous guest counts. An identity is an
--    account id or a canonical phone number, prefixed; it is used to count
--    and to compare, and never emitted. Live bookings only.
--      returning   the identity had a live booking earlier (180-day lookback
--                  before the range, venue-wide)
--      regular     an identity with >= 3 live bookings in the 90 days ending
--                  at ts_to (court filter applied)
--      lapsing     a regular whose last live booking is >= 28 days before
--                  least(ts_to, now())
--      fixed slot  a regular whose modal (dow, hour) holds >= 60% of its
--                  bookings in that window
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_guests(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_guests_0093$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.start_at,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)      as d,
           case when r.guest_id is not null then 'u:' || r.guest_id::text
                when app.phone_canon(r.guest_phone) is not null then 'p:' || app.phone_canon(r.guest_phone)
           end                                                         as ident
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when app.phone_canon(r.guest_phone) is not null then 'p:' || app.phone_canon(r.guest_phone)
           end          as ident,
           r.start_at
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  typed as (
    select b.*,
           exists (select 1 from hist h where h.ident = b.ident and h.start_at < b.start_at) as returning
      from b
     where b.ident is not null),
  per_ident as (
    select t.ident, count(*) as n from typed t group by t.ident),
  visit_keys as (
    select k.bucket, k.ord, k.lo, k.hi
      from (values ('1', 1, 1, 1), ('2_3', 2, 2, 3), ('4_6', 3, 4, 6), ('7_plus', 4, 7, 2147483647)) k(bucket, ord, lo, hi)),
  reg_src as (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when app.phone_canon(r.guest_phone) is not null then 'p:' || app.phone_canon(r.guest_phone)
           end                                                        as ident,
           r.start_at,
           extract(dow from (r.start_at at time zone v_b.tz))::int    as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int   as hour
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_to - interval '90 days' and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)
       and (r.guest_id is not null or r.guest_phone is not null)),
  regs as (
    select s.ident, count(*) as n, max(s.start_at) as last_at
      from reg_src s
     where s.ident is not null
     group by s.ident
    having count(*) >= 3),
  reg_slots as (
    select s.ident, max(x.cnt) as top, sum(x.cnt) as total
      from (select s2.ident, s2.dow, s2.hour, count(*) as cnt
              from reg_src s2
             where s2.ident in (select rg.ident from regs rg)
             group by s2.ident, s2.dow, s2.hour) x
      join regs s on s.ident = x.ident
     group by s.ident),
  weeks as (
    select date_trunc('week', t.d)::date as week_start, t.ident, bool_or(not t.returning) as is_new
      from typed t
     group by 1, t.ident),
  week_rows as (
    select w.week_start,
           count(*) filter (where w.is_new)      as new_identities,
           count(*) filter (where not w.is_new)  as returning_identities
      from weeks w
     group by w.week_start),
  week_all as (
    select date_trunc('week', b.d)::date as week_start, count(*) as bookings
      from b group by 1)
  select jsonb_build_object(
    'lookback_days',        180,
    'regular_window_days',  90,
    'lapse_days',           28,
    'identified_bookings',   (select count(*) from typed),
    'unidentified_bookings', (select count(*) from b where b.ident is null),
    'identities',            (select count(*) from per_ident),
    'returning_bookings',    (select count(*) from typed t where t.returning),
    'new_bookings',          (select count(*) from typed t where not t.returning),
    'returning_pct',         (select case when count(*) > 0 then round(count(*) filter (where t.returning) * 100.0 / count(*), 1) end from typed t),
    'visit_buckets', (
      select jsonb_agg(jsonb_build_object(
               'bucket',     k.bucket,
               'identities', (select count(*) from per_ident p where p.n between k.lo and k.hi),
               'bookings',   (select coalesce(sum(p.n), 0)::bigint from per_ident p where p.n between k.lo and k.hi)
             ) order by k.ord)
        from visit_keys k),
    'regulars',          (select count(*) from regs),
    'lapsing_regulars',  (select count(*) from regs rg
                           where rg.last_at <= least(v_b.ts_to, now()) - interval '28 days'),
    'regulars_bookings_pct', (
      select case when count(*) > 0
                  then round(count(*) filter (where b.ident in (select rg.ident from regs rg)) * 100.0 / count(*), 1) end
        from b),
    'regulars_fixed_slot_pct', (
      select case when count(*) > 0
                  then round(count(*) filter (where rs.top * 100.0 / rs.total >= 60) * 100.0 / count(*), 1) end
        from reg_slots rs),
    'by_week', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start',           wa.week_start,
               'new_identities',       coalesce(wr.new_identities, 0),
               'returning_identities', coalesce(wr.returning_identities, 0),
               'bookings',             wa.bookings
             ) order by wa.week_start), '[]'::jsonb)
        from week_all wa
        left join week_rows wr on wr.week_start = wa.week_start))
    into v_out;

  return v_out;
end $fn_analytics_courts_guests_0093$;

-- ---------------------------------------------------------------------------
-- 6. app.analytics_courts_cafe: court-to-cafe attach. A booking is "linked"
--    when a non-void, non-merged tab carries its reservation_id; cafe money
--    is total_iqd - court_iqd of its SETTLED linked tabs. Items honour
--    app.analytics_excluded(); order timing is placed_at against the slot.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_cafe(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_cafe_0093$
declare
  v_b     record;
  v_avail bigint;
  v_ex    uuid[];
  v_out   jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_avail := app.reports_available_minutes(p_from, p_to);
  v_ex    := app.analytics_excluded();

  with
  b as (
    select r.id, r.court_id, r.players, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                            as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int     as mins,
           extract(dow from (r.start_at at time zone v_b.tz))::int     as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int    as hour
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order
      from courts c
     where (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  lt as (
    select t.id as tab_id, t.reservation_id, t.status,
           (t.total_iqd - coalesce(t.court_iqd, 0))::bigint as cafe_iqd
      from tabs t
      join b on b.id = t.reservation_id
     where t.status <> 'void' and t.merged_into_tab_id is null),
  per_b as (
    select b.*,
           exists (select 1 from lt where lt.reservation_id = b.id)                                         as linked,
           exists (select 1 from lt where lt.reservation_id = b.id and lt.status = 'settled')               as settled,
           (select coalesce(sum(lt.cafe_iqd), 0) from lt where lt.reservation_id = b.id and lt.status = 'settled')::bigint as cafe_iqd
      from b),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order,
           count(p.id)                                   as live_bookings,
           count(p.id) filter (where p.linked)           as linked_bookings,
           count(p.id) filter (where p.settled)          as settled_linked,
           coalesce(sum(p.cafe_iqd), 0)::bigint          as cafe_iqd,
           coalesce(sum(p.price_iqd), 0)::bigint         as court_iqd,
           coalesce(sum(p.mins), 0)::bigint              as booked_minutes
      from courts_in c
      left join per_b p on p.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order),
  tot as (
    select coalesce(sum(pc.live_bookings), 0)::bigint    as live_bookings,
           coalesce(sum(pc.linked_bookings), 0)::bigint  as linked_bookings,
           coalesce(sum(pc.settled_linked), 0)::bigint   as settled_linked,
           coalesce(sum(pc.cafe_iqd), 0)::bigint         as cafe_iqd,
           coalesce(sum(pc.court_iqd), 0)::bigint        as court_iqd,
           coalesce(sum(pc.booked_minutes), 0)::bigint   as booked_minutes,
           (count(*) * v_avail)::bigint                   as open_minutes
      from per_court pc),
  lo as (
    select o.id as order_id, o.placed_at, p.court_id, p.start_at, p.end_at
      from orders o
      join lt on lt.tab_id = o.tab_id
      join per_b p on p.id = lt.reservation_id
     where o.status <> 'voided'),
  li as (
    select lo.court_id, lo.order_id, oi.menu_item_id, oi.qty, oi.line_total_iqd
      from order_items oi
      join lo on lo.order_id = oi.order_id
     where not oi.voided and oi.menu_item_id <> all (v_ex)),
  ao as (
    select o.id as order_id
      from orders o
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'),
  ai as (
    select oi.menu_item_id, oi.order_id
      from order_items oi
      join ao on ao.order_id = oi.order_id
     where not oi.voided and oi.menu_item_id <> all (v_ex)),
  top_items as (
    select x.*, row_number() over (partition by x.court_id order by x.qty desc, x.revenue_iqd desc, x.item_id) as rn
      from (select li.court_id, li.menu_item_id as item_id,
                   sum(li.qty)::bigint             as qty,
                   sum(li.line_total_iqd)::bigint  as revenue_iqd,
                   count(distinct li.order_id)     as linked_orders
              from li group by li.court_id, li.menu_item_id) x),
  items as (
    select coalesce(l.item_id, a.item_id) as item_id, coalesce(l.n, 0) as linked_n, coalesce(a.n, 0) as all_n
      from (select li.menu_item_id as item_id, count(distinct li.order_id) as n from li group by li.menu_item_id) l
      full join (select ai.menu_item_id as item_id, count(distinct ai.order_id) as n from ai group by ai.menu_item_id) a
             on a.item_id = l.item_id),
  timing as (
    select lo.order_id,
           extract(epoch from (lo.placed_at - lo.start_at)) / 60 as offset_min,
           case when lo.placed_at < lo.start_at - interval '30 minutes'            then 'before_30plus'
                when lo.placed_at < lo.start_at                                    then 'before_0_30'
                when lo.placed_at < lo.start_at + (lo.end_at - lo.start_at) / 2    then 'first_half'
                when lo.placed_at < lo.end_at                                      then 'second_half'
                when lo.placed_at < lo.end_at + interval '30 minutes'              then 'after_0_30'
                else 'after_30plus' end as bucket,
           (select coalesce(sum(oi.line_total_iqd), 0) from order_items oi
             where oi.order_id = lo.order_id and not oi.voided)::bigint as revenue_iqd
      from lo),
  timing_keys as (
    select k.bucket, k.ord
      from (values ('before_30plus', 1), ('before_0_30', 2), ('first_half', 3),
                   ('second_half', 4), ('after_0_30', 5), ('after_30plus', 6)) k(bucket, ord))
  select jsonb_build_object(
    'attach', jsonb_build_object(
      'live_bookings',                t.live_bookings,
      'linked_bookings',              t.linked_bookings,
      'attach_pct',                   case when t.live_bookings > 0 then round(t.linked_bookings * 100.0 / t.live_bookings, 1) end,
      'settled_linked',               t.settled_linked,
      'cafe_iqd',                     t.cafe_iqd,
      'cafe_per_linked_iqd',          case when t.settled_linked > 0 then round(t.cafe_iqd * 1.0 / t.settled_linked)::bigint end,
      'cafe_per_booking_iqd',         case when t.live_bookings > 0 then round(t.cafe_iqd * 1.0 / t.live_bookings)::bigint end,
      'court_iqd',                    t.court_iqd,
      'booked_minutes',               t.booked_minutes,
      'open_minutes',                 t.open_minutes,
      'combined_per_booked_hour_iqd', case when t.booked_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.booked_minutes)::bigint end,
      'combined_per_open_hour_iqd',   case when t.open_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.open_minutes)::bigint end),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                     pc.id,
               'name_en',                      pc.name_en,
               'name_ar',                      pc.name_ar,
               'live_bookings',                pc.live_bookings,
               'linked_bookings',              pc.linked_bookings,
               'attach_pct',                   case when pc.live_bookings > 0 then round(pc.linked_bookings * 100.0 / pc.live_bookings, 1) end,
               'settled_linked',               pc.settled_linked,
               'cafe_iqd',                     pc.cafe_iqd,
               'cafe_per_linked_iqd',          case when pc.settled_linked > 0 then round(pc.cafe_iqd * 1.0 / pc.settled_linked)::bigint end,
               'cafe_per_booking_iqd',         case when pc.live_bookings > 0 then round(pc.cafe_iqd * 1.0 / pc.live_bookings)::bigint end,
               'court_iqd',                    pc.court_iqd,
               'booked_minutes',               pc.booked_minutes,
               'open_minutes',                 v_avail,
               'combined_per_booked_hour_iqd', case when pc.booked_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.booked_minutes)::bigint end,
               'combined_per_open_hour_iqd',   case when v_avail > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / v_avail)::bigint end
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                ti.court_id,
               'item_id',                 ti.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'qty',                     ti.qty,
               'revenue_iqd',             ti.revenue_iqd,
               'linked_orders_with_item', ti.linked_orders
             ) order by ti.court_id, ti.rn), '[]'::jsonb)
        from top_items ti
        join menu_items mi on mi.id = ti.item_id
       where ti.rn <= 5),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'item_id',                 i.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'linked_orders_with_item', i.linked_n,
               'all_orders_with_item',    i.all_n
             ) order by i.linked_n desc, i.all_n desc, mi.name_en, i.item_id), '[]'::jsonb)
        from items i
        join menu_items mi on mi.id = i.item_id),
    'linked_orders_total', (select count(*) from lo),
    'all_orders_total',    (select count(*) from ao),
    'order_timing', jsonb_build_object(
      'median_offset_min', (select round(percentile_cont(0.5) within group (order by tm.offset_min::double precision))::int from timing tm),
      'buckets', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'orders',      coalesce(x.n, 0),
                 'revenue_iqd', coalesce(x.rev, 0)
               ) order by k.ord)
          from timing_keys k
          left join (select tm.bucket, count(*) as n, sum(tm.revenue_iqd)::bigint as rev from timing tm group by tm.bucket) x
                 on x.bucket = k.bucket)),
    'attach_cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',             x.dow,
               'hour',            x.hour,
               'live_bookings',   x.n,
               'linked_bookings', x.linked
             ) order by x.dow, x.hour), '[]'::jsonb)
        from (select p.dow, p.hour, count(*) as n, count(*) filter (where p.linked) as linked
                from per_b p group by p.dow, p.hour) x),
    'by_players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'players',  x.players,
               'bookings', x.n,
               'linked',   x.linked,
               'cafe_iqd', x.cafe_iqd
             ) order by x.players nulls last), '[]'::jsonb)
        from (select p.players, count(*) as n, count(*) filter (where p.linked) as linked,
                     coalesce(sum(p.cafe_iqd), 0)::bigint as cafe_iqd
                from per_b p group by p.players) x),
    'by_duration', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'duration_min', x.mins,
               'bookings',     x.n,
               'linked',       x.linked,
               'cafe_iqd',     x.cafe_iqd
             ) order by x.mins), '[]'::jsonb)
        from (select p.mins, count(*) as n, count(*) filter (where p.linked) as linked,
                     coalesce(sum(p.cafe_iqd), 0)::bigint as cafe_iqd
                from per_b p group by p.mins) x))
    into v_out
    from tot t;

  return v_out;
end $fn_analytics_courts_cafe_0093$;

-- ---------------------------------------------------------------------------
-- 7. Grants. The helper is service-role only (above); the five surfaces go to
--    authenticated, and app.analytics_guard inside decides.
-- ---------------------------------------------------------------------------
revoke all on function app.analytics_courts_summary(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_summary(date, date, uuid) to authenticated;

revoke all on function app.analytics_courts_demand(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_demand(date, date, uuid) to authenticated;

revoke all on function app.analytics_courts_endings(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_endings(date, date, uuid) to authenticated;

revoke all on function app.analytics_courts_guests(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_guests(date, date, uuid) to authenticated;

revoke all on function app.analytics_courts_cafe(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_cafe(date, date, uuid) to authenticated;
