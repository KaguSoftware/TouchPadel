set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0214_analytics_stock_settings_per_venue — multi-venue slice 2, step 4 (the
-- analytics helpers and the expiry readers).
--
-- These bodies read venue_settings with `limit 1`, as a scalar subquery, or by
-- a bare `cross join venue_settings`. With one settings row per branch (0208)
-- the first picks an arbitrary branch, the second raises "more than one row",
-- and the third counts every opening-hours cell once per branch. Each is
-- re-issued from its latest body:
--   analytics_bounds (0034)           timezone and start hour of the analysis branch
--   analytics_open_minutes (0174)     opening hours of the analysis branch, and only
--                                     that branch's courts
--   analytics_courts_summary (0174)   closed days of the analysis branch
--   analytics_courts_endings (0154)   cancellation window of the analysis branch
--   reports_available_minutes (0068)  opening hours of the analysis branch
--   v_expiring_soon (0019)            each batch against its own branch's window;
--                                     venue_id appended
--   flag_expired_batches (0021)       each batch against its own branch's window, the
--                                     alert filed at the batch's branch
--
-- The report scope (new here, used by slice 3's reports axis):
--   app.report_venues()   the branches a report covers: for the owner the
--                         x-venue-scope request header (a branch id, or 'all'),
--                         default every branch; for anyone else only branches
--                         they work at (the header's if it is one of theirs,
--                         else the resolved venue, else all of their own); with
--                         no caller (service role, cron) every branch.
--   app.analysis_venue()  the ONE branch a clock-and-hours computation uses: the
--                         scope's branch when the scope is one branch, else the
--                         caller's resolved venue, else the default branch.
-- The analytics helpers below compute opening hours, business days and courts
-- for app.analysis_venue(), resolved once per call.

-- ---------------------------------------------------------------------------
-- The report scope
-- ---------------------------------------------------------------------------
create or replace function app.report_venues() returns uuid[]
language plpgsql stable security definer set search_path = public as $report_venues_0214$
declare
  v_raw  text;
  v_one  uuid;
  v_mine uuid[];
begin
  -- No caller (service role, cron): every branch.
  if auth.uid() is null then
    return coalesce((select array_agg(v.id order by v.created_at, v.id) from venues v), '{}'::uuid[]);
  end if;
  v_mine := app.staff_venue_ids();

  -- The operator's branch switcher names the scope on every request.
  begin
    v_raw := nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-venue-scope'), '');
  exception when others then
    v_raw := null;
  end;
  if v_raw is not null and v_raw <> 'all' then
    begin
      v_one := v_raw::uuid;
    exception when others then
      v_one := null;
    end;
    if v_one is not null and v_one = any (v_mine) then
      return array[v_one];
    end if;
  end if;

  -- The owner: every branch (MV8, "All branches").
  if app.is_staff('owner') then
    return v_mine;
  end if;

  -- Anyone else: the branch they are working at, else all of their own.
  v_one := app.resolve_venue();
  if v_one is not null and v_one = any (v_mine) then
    return array[v_one];
  end if;
  return v_mine;
end
$report_venues_0214$;

comment on function app.report_venues() is
  '0214 (multi-venue). The branches a report or analytics read covers. Owner: the x-venue-scope request header (a branch id, or all), default every branch. Anyone else: only branches they work at. No caller: every branch. Internal (definer bodies only).';

revoke all on function app.report_venues() from public, anon, authenticated;

create or replace function app.analysis_venue() returns uuid
language sql stable security definer set search_path = public as $analysis_venue_0214$
  select case when cardinality(s.r) = 1 then s.r[1] else app.current_venue_or_default() end
    from (select app.report_venues() as r) s
$analysis_venue_0214$;

comment on function app.analysis_venue() is
  '0214 (multi-venue). The one branch whose clock, business day, opening hours and courts an analytics computation uses: the report scope''s branch when it is one, else the caller''s resolved venue, else the default branch. Internal.';

revoke all on function app.analysis_venue() from public, anon, authenticated;

-- analytics_bounds: re-issued from 20260825000034_analytics.sql:107
create or replace function app.analytics_bounds(
  p_from date,
  p_to   date,
  out tz         text,
  out start_hour int,
  out ts_from    timestamptz,
  out ts_to      timestamptz
) language plpgsql stable security definer set search_path = public as $analytics_bounds_0214$
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001',
      detail = format('from %s to %s', coalesce(p_from::text, 'null'), coalesce(p_to::text, 'null')),
      hint = 'p_from <= p_to and at most 400 days apart';
  end if;
  tz         := coalesce((select vs.timezone from venue_settings vs where vs.venue_id = app.analysis_venue()), 'Asia/Baghdad');
  start_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', app.analysis_venue()), 4);
  ts_from    := (p_from::timestamp + make_interval(hours => start_hour)) at time zone tz;
  ts_to      := ((p_to + 1)::timestamp + make_interval(hours => start_hour)) at time zone tz;
end $analytics_bounds_0214$;

-- analytics_open_minutes: re-issued from 20260925000174_event_court_blocks.sql:906
create or replace function app.analytics_open_minutes(
  p_ts_from    timestamptz,
  p_ts_to      timestamptz,
  p_tz         text,
  p_start_hour int,
  p_court_id   uuid default null
) returns table (court_id uuid, dow int, hour int, open_minutes bigint, open_days int, event_minutes int)
language sql stable security definer set search_path = public as $analytics_open_minutes_0214$
  with av as materialized (select app.analysis_venue() as venue_id),
  hours as (
    select gs as h
      from generate_series(date_trunc('hour', p_ts_from at time zone p_tz),
                           p_ts_to at time zone p_tz,
                           interval '1 hour') gs
     where gs < (p_ts_to at time zone p_tz)),
  cells as (
    -- One row per (hour, opening window) with the open part of the hour as a
    -- local [os, oe) interval.
    select h.h,
           h.h::date                                             as d,
           (h.h - make_interval(hours => p_start_hour))::date    as bd,
           extract(hour from h.h)::int                           as hour,
           h.h::date + make_interval(secs => greatest(extract(epoch from h.h::time), extract(epoch from (w ->> 0)::interval))) as os,
           h.h::date + make_interval(secs => least(extract(epoch from h.h::time) + 3600, extract(epoch from (w ->> 1)::interval)))  as oe
      from hours h
      cross join (select vs0.* from venue_settings vs0 join av on vs0.venue_id = av.venue_id) vs
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(vs.opening_hours -> lower(to_char(h.h, 'Dy'))) = 'array'
             then vs.opening_hours -> lower(to_char(h.h, 'Dy'))
             else '[]'::jsonb end) w
     where not (h.h::date = any (coalesce(vs.closed_dates, '{}')))),
  open_cells as (
    select c.h, c.d, c.bd, c.hour, c.os, c.oe
      from cells c
     where c.oe > c.os),
  court_cells as (
    select ct.id as court_id, oc.h, oc.d, oc.bd, oc.hour, oc.os, oc.oe
      from open_cells oc
      cross join courts ct
     where (p_court_id is null or ct.id = p_court_id)
       and ct.venue_id = (select av.venue_id from av)
       and (ct.is_active or ct.active_to is not null)
       and (ct.active_from is null or oc.d >= ct.active_from)
       and (ct.active_to   is null or oc.d <= ct.active_to)),
  maint as (
    -- One pass over the blocks: maintenance that is not an event is closed
    -- time; an event block is open time the venue gave to a tournament.
    select cc.court_id, cc.h, cc.os,
           sum(extract(epoch from (least(cc.oe, r.end_at at time zone p_tz) - greatest(cc.os, r.start_at at time zone p_tz))))
             filter (where r.block_purpose is distinct from 'event') as secs,
           sum(extract(epoch from (least(cc.oe, r.end_at at time zone p_tz) - greatest(cc.os, r.start_at at time zone p_tz))))
             filter (where r.block_purpose = 'event') as ev_secs
      from court_cells cc
      join reservations r
        on r.court_id = cc.court_id
       and r.kind = 'maintenance'
       and r.status not in ('cancelled','expired')
       and (r.start_at at time zone p_tz) < cc.oe
       and (r.end_at   at time zone p_tz) > cc.os
     group by cc.court_id, cc.h, cc.os),
  net as (
    select cc.court_id, cc.bd, cc.hour,
           greatest(extract(epoch from (cc.oe - cc.os)) - coalesce(m.secs, 0), 0) / 60 as mins,
           least(coalesce(m.ev_secs, 0), greatest(extract(epoch from (cc.oe - cc.os)) - coalesce(m.secs, 0), 0)) / 60 as ev_mins
      from court_cells cc
      left join maint m on m.court_id = cc.court_id and m.h = cc.h and m.os = cc.os)
  select n.court_id,
         extract(dow from n.bd)::int                           as dow,
         n.hour,
         round(sum(n.mins))::bigint                            as open_minutes,
         count(distinct n.bd) filter (where n.mins > 0)::int   as open_days,
         round(sum(n.ev_mins))::int                            as event_minutes
    from net n
   group by n.court_id, extract(dow from n.bd), n.hour
  having sum(n.mins) > 0
$analytics_open_minutes_0214$;

-- analytics_courts_summary: re-issued from 20260925000174_event_court_blocks.sql:991
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_summary_0214$
declare
  v_b   record;
  v_out jsonb;
  v_av  uuid := app.analysis_venue();
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

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
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  holds as (
    select extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.kind = 'hold' and r.status = 'expired' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, o.dow, o.hour, o.open_minutes, o.open_days, o.event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id),
  court_open as (
    select oc.court_id, sum(oc.open_minutes)::bigint as open_minutes, sum(oc.event_minutes)::bigint as event_minutes
      from oc group by oc.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(co.open_minutes, 0)::bigint                           as open_minutes,
           coalesce(co.event_minutes, 0)::bigint                          as event_minutes,
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
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, co.open_minutes, co.event_minutes),
  tot as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           coalesce(sum(pc.open_minutes), 0)::bigint       as open_minutes,
           coalesce(sum(pc.event_minutes), 0)::bigint      as event_minutes
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
                       from venue_settings vs where vs.venue_id = v_av), true) as closed,
           count(b.id) filter (where b.live)                           as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint      as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as revenue_iqd,
           count(b.id) filter (where b.cancelled)                      as cancellations,
           count(b.id) filter (where b.no_show)                        as no_shows
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
    'range',         jsonb_build_object('from', p_from, 'to', p_to),
    'courts_count',  t.courts_count,
    'open_minutes',  t.open_minutes,
    'event_minutes', t.event_minutes,
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
               'open_minutes',          pc.open_minutes,
               'occupancy_pct',         case when pc.open_minutes > 0 then round(pc.booked_minutes * 100.0 / pc.open_minutes, 1) end,
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
end $analytics_courts_summary_0214$;

-- analytics_courts_endings: re-issued from 20260923000154_analytics_returning_guest.sql:50
create or replace function app.analytics_courts_endings(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_endings_0214$
declare
  v_b          record;
  v_policy_min int;
  v_out        jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_policy_min := coalesce((select vs.cancellation_window_hours from venue_settings vs
                             where vs.venue_id = app.analysis_venue()), 12) * 60;

  with
  -- 0154: app.analytics_guest_ident, set-based. The phone -> account map is
  -- built once (earliest profile per canonical phone, as its LIMIT 1 picks)
  -- instead of one profiles scan per phone-only row.
  phone_owner as materialized (
    select distinct on (x.canon) x.canon, 'u:' || x.id::text as ident
      from (select app.phone_canon(p.phone) as canon, p.id, p.created_at
              from profiles p
             where p.phone is not null) x
     where x.canon is not null
     order by x.canon, x.created_at, x.id),
  b as materialized (
    select r.id, r.court_id, r.source::text as source, r.series_id, r.start_at, r.end_at, r.cancelled_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                      as lead_min,
           extract(epoch from (r.start_at - r.cancelled_at)) / 60                    as notice_min,
           coalesce(r.cancelled_by::text, 'unknown')                                 as actor,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show,
           case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as materialized (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident,
           r.start_at
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  -- 0154: an earlier same-ident row exists  <=>  the ident's earliest start is
  -- earlier. Both strict, so two rows at the same instant are not each other's
  -- history. One hash aggregate instead of a correlated SubPlan per booking.
  first_seen as materialized (
    select h.ident, min(h.start_at) as first_at
      from hist h
     where h.ident is not null
     group by h.ident),
  bounds as (
    select distinct v from unnest(array[0, 120, 360, 1440, 4320, v_policy_min]) as v),
  edges as (
    select v as lo, lead(v) over (order by v) as hi, row_number() over (order by v) as ord
      from bounds),
  notice_keys as (
    select null::int as lo, 0 as hi, 0::bigint as ord, 'after_start'::text as bucket, false as policy_edge
    union all
    select e.lo, e.hi, e.ord,
           case when e.hi is null then e.lo::text || '_plus' else e.lo::text || '_' || e.hi::text end,
           e.lo = v_policy_min
      from edges e),
  typed as (
    select b.*,
           case when b.ident is null then 'unidentified'
                when coalesce(fs.first_at < b.start_at, false) then 'returning'
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
                else (select k.bucket from notice_keys k
                       where k.lo is not null and b.notice_min >= k.lo and (k.hi is null or b.notice_min < k.hi)
                       limit 1) end as notice_bucket
      from b
      left join first_seen fs on fs.ident = b.ident),
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
        ('type',      t.typ,                                                          case t.typ when 'returning' then 1 when 'new' then 2 else 3 end)
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
  actor_keys as (
    select k.actor, k.ord
      from (values ('guest', 1), ('staff', 2), ('unknown', 3)) k(actor, ord)),
  -- Late cancellations and what became of the slot.
  late as (
    select t.id, t.court_id, t.start_at, t.end_at, t.cancelled_at, t.price_iqd
      from typed t
     where t.cancelled and t.notice_min is not null and t.notice_min < v_policy_min),
  resold as (
    select lc.id, lc.price_iqd,
           (select r2.price_iqd
              from reservations r2
             where r2.court_id = lc.court_id
               and r2.kind = 'booking'
               and r2.status in ('confirmed','arrived','completed')
               and r2.id <> lc.id
               and r2.created_at > lc.cancelled_at
               and r2.start_at < lc.end_at and r2.end_at > lc.start_at
             order by r2.created_at, r2.id
             limit 1) as replacement_iqd
      from late lc),
  in_period as (
    select count(*) as n, coalesce(sum(r.price_iqd), 0)::bigint as revenue_iqd
      from reservations r
     where r.kind = 'booking'
       and r.status = 'cancelled'
       and r.cancelled_at >= v_b.ts_from and r.cancelled_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id))
  select jsonb_build_object(
    'policy_window_min', v_policy_min,
    'cancellations', jsonb_build_object(
      'total',             (select count(*) from b where b.cancelled),
      'revenue_iqd',       (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.cancelled),
      'late_revenue_iqd',  (select coalesce(sum(lc.price_iqd), 0)::bigint from late lc),
      'median_notice_min', (select round(percentile_cont(0.5) within group (order by b.notice_min::double precision))::int
                              from b where b.cancelled and b.notice_min is not null),
      'by_notice', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'lo_min',      k.lo,
                 'hi_min',      k.hi,
                 'n',           coalesce(x.n, 0),
                 'policy_edge', k.policy_edge
               ) order by k.ord)
          from notice_keys k
          left join (select t.notice_bucket, count(*) as n from typed t where t.cancelled group by t.notice_bucket) x
                 on x.notice_bucket = k.bucket),
      'by_actor', (
        select jsonb_agg(jsonb_build_object('actor', k.actor, 'n', coalesce(x.n, 0)) order by k.ord)
          from actor_keys k
          left join (select b.actor, count(*) as n from b where b.cancelled group by b.actor) x on x.actor = k.actor),
      'cancelled_in_period', (select jsonb_build_object('n', ip.n, 'revenue_iqd', ip.revenue_iqd) from in_period ip),
      'resold', (
        select jsonb_build_object(
                 'cancelled',     count(*),
                 'resold_n',      count(*) filter (where rs.replacement_iqd is not null),
                 'recovered_iqd', coalesce(sum(rs.replacement_iqd), 0)::bigint,
                 'empty_n',       count(*) filter (where rs.replacement_iqd is null),
                 'lost_iqd',      coalesce(sum(rs.price_iqd) filter (where rs.replacement_iqd is null), 0)::bigint)
          from resold rs),
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
      'by_type',      coalesce((select rn.rows from rows_n rn where rn.dim = 'type'),      '[]'::jsonb)))
    into v_out;

  return v_out;
end $analytics_courts_endings_0214$;

-- reports_available_minutes: re-issued from 20260903000068_reports.sql:98
create or replace function app.reports_available_minutes(p_from date, p_to date)
returns bigint
language sql stable security definer set search_path = public as $reports_available_minutes_0214$
  with av as materialized (select app.analysis_venue() as venue_id)
  select coalesce(sum(
           (extract(epoch from (w ->> 1)::interval) - extract(epoch from (w ->> 0)::interval)) / 60
         ), 0)::bigint
    from venue_settings vs
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    cross join lateral jsonb_array_elements(
      coalesce(vs.opening_hours -> lower(to_char(d, 'Dy')), '[]'::jsonb)) w
   where vs.venue_id = (select av.venue_id from av)
     and not (d::date = any (coalesce(vs.closed_dates, '{}')))
$reports_available_minutes_0214$;

-- v_expiring_soon: re-issued from 20260824000019_counts_variance.sql:272
-- (create or replace can only APPEND a column: venue_id goes last).
create or replace view v_expiring_soon with (security_invoker = on) as
select b.id as batch_id, b.ingredient_id, i.name_en, i.name_ar, i.unit,
       b.qty_remaining, b.unit_cost_iqd, b.expiry_date,
       b.expiry_date - current_date as days_left,
       b.venue_id
  from stock_batches b
  join ingredients i on i.id = b.ingredient_id
 where b.qty_remaining > 0
   and b.expiry_date is not null
   and b.expiry_date >= current_date
   and b.expiry_date <= current_date + coalesce(
         (select vs.expiring_soon_days from venue_settings vs where vs.venue_id = b.venue_id), 3);

comment on view v_expiring_soon is
  '0019, 0214. Batches with stock left that expire within their own branch''s expiring_soon_days (per branch since 0208). Invoker rights: a staff read sees its own branches through stock_batches RLS.';

-- flag_expired_batches: re-issued from 20260824000021_degraded_sync.sql:186
create or replace function app.flag_expired_batches() returns void
language plpgsql security definer set search_path = public as $flag_expired_batches_0214$
begin
  -- 0214: each batch against its own branch's window; the alert is filed there.

  insert into manager_alerts (venue_id, kind, payload)
  select b.venue_id,
         'expiring_soon',
         jsonb_build_object(
           'batch_id', b.id,
           'ingredient_id', b.ingredient_id,
           'expiry_date', b.expiry_date,
           'qty_remaining', b.qty_remaining,
           'expired', b.expiry_date < current_date)
    from stock_batches b
   where b.qty_remaining > 0
     and b.expiry_date is not null
     and b.expiry_date <= current_date + coalesce(
           (select vs.expiring_soon_days from venue_settings vs where vs.venue_id = b.venue_id), 3)
     and not exists (
       select 1 from manager_alerts a
        where a.kind = 'expiring_soon'
          and a.acknowledged_at is null
          and a.payload->>'batch_id' = b.id::text);
end $flag_expired_batches_0214$;

