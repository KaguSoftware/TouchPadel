-- 0097_courts_active_window — honest court denominators, one guest identity,
-- the venue's own cancellation policy.
--
-- The 2026-09-14 critique of the Courts analytics tab:
--   * occupancy ignored maintenance blocks and courts added or retired
--     mid-range: a court retired in week 2 kept accruing open minutes for the
--     whole month, so the venue looked emptier than it was;
--   * a heat cell's open_minutes was ONE court's, the client had to multiply
--     by the court count, and the pattern miner (which did not) reported
--     occupancy up to N× too high;
--   * the "late cancellation" threshold was a hard-coded 6 hours while the
--     venue's policy (venue_settings.cancellation_window_hours) is 4, and the
--     notice buckets could not show where the policy line falls;
--   * a guest who booked once in the app and once at the desk with the same
--     phone counted as two people;
--   * weekday keys mixed calendar and business weekdays.
--
-- WHAT
--   1. courts.active_from / active_to (dates, inclusive). A court accrues
--      open minutes only on days inside its window. Inactive courts are
--      backfilled with active_to = today: a retired court stops accruing from
--      the day of the change, NOT retroactively (known, deliberate).
--   2. app.upsert_court: DROP + CREATE with p_active_from / p_active_to
--      appended (PGRST203 rule); true→false auto-stamps active_to = today,
--      false→true clears an unchanged stamp; INVALID_ACTIVE_WINDOW.
--   3. Indexes: reservations(start_at), reservations(cancelled_at) where
--      cancelled. MIGRATION-RISK-ACCEPTED: single-venue tables of thousands
--      of rows. (No expression index on profiles(phone_canon(phone)): an
--      index expression runs as the writer, and app.phone_canon is revoked
--      from every client role, so the index would refuse every phone update.)
--   4. app.analytics_open_minutes(ts_from, ts_to, tz, start_hour, court_id)
--      REPLACES app.analytics_open_cells: per (court, business dow, hour)
--      open minutes over the BUSINESS window, opening windows per calendar
--      day (0093 arithmetic), courts within their active window, maintenance
--      reservations subtracted inside the open part of the hour. Every open
--      figure on the tab is a SUM over this helper, so Σ heatmap open minutes
--      = Σ per-court open minutes = the KPI, by construction.
--   5. app.analytics_guest_ident(guest_id, guest_phone): one identity for
--      an account and for the desk bookings that carry its phone.
--   6. The five analytics_courts_* RPCs (same signatures, guard first, SEC-29
--      kept) and app.report_courts rebuilt on the above. Every dow is the
--      BUSINESS weekday (0 = Sunday). heatmap[].open_minutes is VENUE-WIDE.
--   7. app.reports_available_minutes is kept for callers outside this
--      migration and marked deprecated: it knows nothing about courts,
--      maintenance or active windows.
--
-- covered by tests/analytics-courts.test.ts, tests/courts-admin.test.ts,
-- tests/reports.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. courts.active_from / active_to
-- ---------------------------------------------------------------------------
alter table courts add column if not exists active_from date;
alter table courts add column if not exists active_to   date;

comment on column courts.active_from is
  '0097: first day (inclusive) the court counts as open for occupancy. NULL = since forever.';
comment on column courts.active_to is
  '0097: last day (inclusive) the court counts as open for occupancy. NULL = still open. Stamped with the current date when a court is deactivated; a court retired before 0097 was stamped at migration time, not retroactively.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courts_active_window_chk') then
    alter table courts
      add constraint courts_active_window_chk
      check (active_from is null or active_to is null or active_to >= active_from) not valid;
  end if;
end $$;

alter table courts validate constraint courts_active_window_chk;

update courts
   set active_to = current_date
 where not is_active
   and active_to is null;

-- ---------------------------------------------------------------------------
-- 2. app.upsert_court — 0062 body + the active window. DROP + CREATE: a
--    defaulted parameter added with `create or replace` leaves the old
--    signature as a second overload and PostgREST refuses both (PGRST203).
-- ---------------------------------------------------------------------------
drop function if exists app.upsert_court(text, text, boolean, text, text, text, int[], int, boolean, uuid);

create function app.upsert_court(
  p_name_en          text,
  p_name_ar          text,
  p_indoor           boolean,
  p_description_en   text    default null,
  p_description_ar   text    default null,
  p_photo_path       text    default null,
  p_duration_options int[]   default '{60,90,120}',
  p_sort_order       int     default null,
  p_is_active        boolean default true,
  p_id               uuid    default null,
  p_active_from      date    default null,
  p_active_to        date    default null
) returns uuid
language plpgsql security definer set search_path = public as $upsert_court_0097$
declare
  v_before    jsonb;
  v_row       courts%rowtype;
  v_opt       int;
  v_active_to date;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_name_en), '') = '' or coalesce(btrim(p_name_ar), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001',
      hint = 'both English and Arabic names';
  end if;

  if p_duration_options is null or coalesce(array_length(p_duration_options, 1), 0) = 0 then
    raise exception 'INVALID_DURATIONS' using errcode = 'P0001',
      hint = 'at least one duration option';
  end if;
  foreach v_opt in array p_duration_options loop
    if v_opt < 30 or v_opt > 300 or v_opt % 15 <> 0 then
      raise exception 'INVALID_DURATIONS' using errcode = 'P0001',
        detail = format('%s min', v_opt),
        hint = '30-300 minutes in 15-minute steps';
    end if;
  end loop;

  -- Photos live under one folder so the storage policy stays a closed set.
  if p_photo_path is not null and p_photo_path !~ '^courts/' then
    raise exception 'INVALID_PHOTO_PATH' using errcode = 'P0001',
      hint = 'court photos live under courts/';
  end if;

  -- 0097: the window must not end before it starts.
  if p_active_from is not null and p_active_to is not null and p_active_to < p_active_from then
    raise exception 'INVALID_ACTIVE_WINDOW' using errcode = 'P0001',
      detail = format('%s to %s', p_active_from, p_active_to),
      hint = 'active_to must not be before active_from';
  end if;

  if p_id is null then
    -- A court created inactive is retired from day one.
    v_active_to := case when not p_is_active and p_active_to is null then current_date else p_active_to end;
    insert into courts (name_en, name_ar, indoor, description_en, description_ar,
                        photo_path, duration_options, sort_order, is_active, active_from, active_to)
    values (btrim(p_name_en), btrim(p_name_ar), p_indoor, p_description_en, p_description_ar,
            p_photo_path, p_duration_options,
            coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 1 from courts)),
            p_is_active, p_active_from, v_active_to)
    returning * into v_row;
    perform app.write_audit('courts.create', 'courts', v_row.id::text, null, to_jsonb(v_row));
    return v_row.id;
  end if;

  select * into v_row from courts where id = p_id for update;
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  -- Deactivating a court with future live bookings would orphan them behind a
  -- greyed-out row while they still occupy the exclusion constraint. The desk
  -- resolves the bookings first; this refusal names the count.
  if v_row.is_active and not p_is_active then
    if exists (select 1 from reservations
                where court_id = p_id
                  and status in ('pending','confirmed','arrived')
                  and end_at > now()) then
      raise exception 'COURT_HAS_FUTURE_RESERVATIONS' using errcode = 'P0001',
        detail = (select count(*)::text from reservations
                   where court_id = p_id
                     and status in ('pending','confirmed','arrived')
                     and end_at > now()),
        hint = 'move or cancel the bookings at the desk first';
    end if;
  end if;

  -- 0097: retiring stamps today unless the caller chose a date; bringing a
  -- court back clears a stamp the caller did not change.
  v_active_to := p_active_to;
  if v_row.is_active and not p_is_active and p_active_to is null then
    v_active_to := current_date;
  elsif not v_row.is_active and p_is_active and p_active_to is not distinct from v_row.active_to then
    v_active_to := null;
  end if;

  update courts
     set name_en          = btrim(p_name_en),
         name_ar          = btrim(p_name_ar),
         indoor           = p_indoor,
         description_en   = p_description_en,
         description_ar   = p_description_ar,
         photo_path       = p_photo_path,
         duration_options = p_duration_options,
         sort_order       = coalesce(p_sort_order, v_row.sort_order),
         is_active        = p_is_active,
         active_from      = p_active_from,
         active_to        = v_active_to
   where id = p_id
   returning * into v_row;

  perform app.write_audit('courts.update', 'courts', p_id::text, v_before, to_jsonb(v_row));
  return v_row.id;
end $upsert_court_0097$;

revoke all on function app.upsert_court(text, text, boolean, text, text, text, int[], int, boolean, uuid, date, date)
  from public, anon;
grant execute on function app.upsert_court(text, text, boolean, text, text, text, int[], int, boolean, uuid, date, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Indexes. MIGRATION-RISK-ACCEPTED: single-venue tables of thousands of rows.
-- ---------------------------------------------------------------------------
create index if not exists reservations_start_at_idx on reservations (start_at);
create index if not exists reservations_cancelled_at_idx on reservations (cancelled_at) where status = 'cancelled';

-- ---------------------------------------------------------------------------
-- 4. app.analytics_open_minutes — replaces app.analytics_open_cells.
--    Per (court, business dow, local hour) over [p_ts_from, p_ts_to):
--      * walks every venue-local hour of the window;
--      * reads THAT CALENDAR DAY's opening windows (venue_settings.opening_hours
--        keyed mon..sun, measured from local midnight, so a day may open as
--        [["00:00","02:00"],["09:00","24:00"]]), skips closed_dates, and takes
--        the overlap of the hour with each window (0093 arithmetic);
--      * crosses the courts that are inside their active window on that
--        calendar day (an inactive court with no window is never open);
--      * subtracts maintenance reservations (kind 'maintenance', not
--        cancelled/expired) where they overlap the OPEN part of the hour;
--      * keys dow to the BUSINESS weekday of the hour (start-hour shifted);
--        open_days = distinct business days that contributed minutes.
--    Service role only. p_court_id narrows to one court.
-- ---------------------------------------------------------------------------
drop function if exists app.analytics_open_cells(timestamptz, timestamptz, text);

create or replace function app.analytics_open_minutes(
  p_ts_from    timestamptz,
  p_ts_to      timestamptz,
  p_tz         text,
  p_start_hour int,
  p_court_id   uuid default null
) returns table (court_id uuid, dow int, hour int, open_minutes bigint, open_days int)
language sql stable security definer set search_path = public as $fn_analytics_open_minutes_0097$
  with hours as (
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
      cross join venue_settings vs
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
       and (ct.is_active or ct.active_to is not null)
       and (ct.active_from is null or oc.d >= ct.active_from)
       and (ct.active_to   is null or oc.d <= ct.active_to)),
  maint as (
    select cc.court_id, cc.h, cc.os,
           sum(extract(epoch from (least(cc.oe, r.end_at at time zone p_tz) - greatest(cc.os, r.start_at at time zone p_tz)))) as secs
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
           greatest(extract(epoch from (cc.oe - cc.os)) - coalesce(m.secs, 0), 0) / 60 as mins
      from court_cells cc
      left join maint m on m.court_id = cc.court_id and m.h = cc.h and m.os = cc.os)
  select n.court_id,
         extract(dow from n.bd)::int                           as dow,
         n.hour,
         round(sum(n.mins))::bigint                            as open_minutes,
         count(distinct n.bd) filter (where n.mins > 0)::int   as open_days
    from net n
   group by n.court_id, extract(dow from n.bd), n.hour
  having sum(n.mins) > 0
$fn_analytics_open_minutes_0097$;

revoke all on function app.analytics_open_minutes(timestamptz, timestamptz, text, int, uuid) from public, anon, authenticated;
grant execute on function app.analytics_open_minutes(timestamptz, timestamptz, text, int, uuid) to service_role;

comment on function app.reports_available_minutes(date, date) is
  'DEPRECATED since 0097: venue-wide minutes for ONE court from opening hours alone. Knows nothing about courts, maintenance or active windows. Use app.analytics_open_minutes.';

-- ---------------------------------------------------------------------------
-- 5. app.analytics_guest_ident — one anonymous identity per person. An
--    account is `u:<profile id>`; a desk booking whose phone matches a
--    profile's phone is that SAME account; a phone nobody registered is
--    `p:<canonical digits>`. Used only inside CTEs to count; never emitted.
--    Service role only.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_guest_ident(p_guest_id uuid, p_guest_phone text)
returns text
language sql stable security definer set search_path = public as $fn_analytics_guest_ident_0097$
  select case
           when p_guest_id is not null then 'u:' || p_guest_id::text
           when app.phone_canon(p_guest_phone) is null then null
           else coalesce(
                  (select 'u:' || p.id::text
                     from profiles p
                    where p.phone is not null
                      and app.phone_canon(p.phone) = app.phone_canon(p_guest_phone)
                    order by p.created_at, p.id
                    limit 1),
                  'p:' || app.phone_canon(p_guest_phone))
         end
$fn_analytics_guest_ident_0097$;

revoke all on function app.analytics_guest_ident(uuid, text) from public, anon, authenticated;
grant execute on function app.analytics_guest_ident(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6.1 app.analytics_courts_summary — open minutes from the helper (per court
--     and venue-wide), business weekdays everywhere.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_summary_0097$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.players,
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
    select o.court_id, o.dow, o.hour, o.open_minutes, o.open_days
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id),
  court_open as (
    select oc.court_id, sum(oc.open_minutes)::bigint as open_minutes from oc group by oc.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(co.open_minutes, 0)::bigint                           as open_minutes,
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
      left join court_open co on co.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, co.open_minutes),
  tot as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           coalesce(sum(pc.open_minutes), 0)::bigint       as open_minutes
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
end $fn_analytics_courts_summary_0097$;

-- ---------------------------------------------------------------------------
-- 6.2 app.analytics_courts_demand — 0093 body, created_dow = business weekday.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_demand(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_demand_0097$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.players, r.series_id,
           coalesce(r.price_iqd, 0)::bigint                                              as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                       as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                          as lead_min,
           extract(hour from (r.created_at at time zone v_b.tz))::int                    as c_hour,
           extract(dow from app.business_date(r.created_at, v_b.tz, v_b.start_hour))::int as c_dow,
           r.status in ('confirmed','arrived','completed')                               as live,
           r.status = 'cancelled'                                                        as cancelled,
           r.status = 'no_show'                                                          as no_show
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
end $fn_analytics_courts_demand_0097$;

-- ---------------------------------------------------------------------------
-- 6.3 app.analytics_courts_endings — the venue's own policy window; notice
--     buckets with the policy edge marked; what happened to the slot after a
--     late cancellation; cancellations by the day they were cancelled.
--       policy_window_min    venue_settings.cancellation_window_hours × 60
--       late_revenue_iqd     cancelled with less notice than the policy
--       by_notice[]          {bucket, lo_min, hi_min, n, policy_edge} over the
--                            boundaries {0,120,360,1440,4320} ∪ {policy};
--                            'after_start' holds cancellations after the slot
--                            began; policy_edge marks the bucket that starts
--                            at the policy line
--       cancelled_in_period  {n, revenue_iqd} by cancelled_at (the other
--                            figures sit on the SLOT's day)
--       resold               late cancellations whose court period was booked
--                            again by a live booking created after the
--                            cancellation: {cancelled, resold_n, recovered_iqd,
--                            empty_n, lost_iqd}
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_endings(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_endings_0097$
declare
  v_b          record;
  v_policy_min int;
  v_out        jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_policy_min := coalesce((select vs.cancellation_window_hours from venue_settings vs limit 1), 12) * 60;

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.players, r.series_id, r.start_at, r.end_at, r.cancelled_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                      as lead_min,
           extract(epoch from (r.start_at - r.cancelled_at)) / 60                    as notice_min,
           coalesce(r.cancelled_by::text, 'unknown')                                 as actor,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show,
           app.analytics_guest_ident(r.guest_id, r.guest_phone)                     as ident
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as (
    select app.analytics_guest_ident(r.guest_id, r.guest_phone) as ident,
           r.start_at
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
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
                else (select k.bucket from notice_keys k
                       where k.lo is not null and b.notice_min >= k.lo and (k.hi is null or b.notice_min < k.hi)
                       limit 1) end as notice_bucket
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
      'by_type',      coalesce((select rn.rows from rows_n rn where rn.dim = 'type'),      '[]'::jsonb),
      'by_players',   coalesce((select rn.rows from rows_n rn where rn.dim = 'players'),   '[]'::jsonb)))
    into v_out;

  return v_out;
end $fn_analytics_courts_endings_0097$;

-- ---------------------------------------------------------------------------
-- 6.4 app.analytics_courts_guests — 0093 body on the shared identity.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_guests(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_guests_0097$
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
           app.analytics_guest_ident(r.guest_id, r.guest_phone)      as ident
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as (
    select app.analytics_guest_ident(r.guest_id, r.guest_phone) as ident,
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
    select app.analytics_guest_ident(r.guest_id, r.guest_phone)                   as ident,
           r.start_at,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
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
end $fn_analytics_courts_guests_0097$;

-- ---------------------------------------------------------------------------
-- 6.5 app.analytics_courts_cafe — cafe money NET via the shared helpers, open
--     minutes from the helper, business weekday in attach_cells.
--       cafe_iqd        Σ cafe_net of the settled linked tabs (was total − court)
--       cafe_gross_iqd  Σ cafe_gross (the old figure, kept for reconciliation)
--       refunds_iqd     Σ their refunds
--       item revenue    net line revenue (app.cafe_net_lines), units net
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_cafe(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_cafe_0097$
declare
  v_b     record;
  v_ex    uuid[];
  v_out   jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_ex    := app.analytics_excluded();

  with
  b as (
    select r.id, r.court_id, r.players, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
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
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  lt as (
    select t.id as tab_id, t.reservation_id, t.status
      from tabs t
      join b on b.id = t.reservation_id
     where t.status <> 'void' and t.merged_into_tab_id is null),
  lm as (
    select s.tab_id, s.reservation_id, s.cafe_gross_iqd, s.refunds_iqd, s.cafe_net_iqd
      from app.cafe_settled_tabs(null, null) s
      join b on b.id = s.reservation_id),
  per_b as (
    select b.*,
           exists (select 1 from lt where lt.reservation_id = b.id)                                   as linked,
           exists (select 1 from lm where lm.reservation_id = b.id)                                   as settled,
           (select coalesce(sum(lm.cafe_net_iqd), 0)   from lm where lm.reservation_id = b.id)::bigint as cafe_iqd,
           (select coalesce(sum(lm.cafe_gross_iqd), 0) from lm where lm.reservation_id = b.id)::bigint as cafe_gross_iqd,
           (select coalesce(sum(lm.refunds_iqd), 0)    from lm where lm.reservation_id = b.id)::bigint as refunds_iqd
      from b),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order,
           coalesce(oc.open_minutes, 0)::bigint          as open_minutes,
           count(p.id)                                   as live_bookings,
           count(p.id) filter (where p.linked)           as linked_bookings,
           count(p.id) filter (where p.settled)          as settled_linked,
           coalesce(sum(p.cafe_iqd), 0)::bigint          as cafe_iqd,
           coalesce(sum(p.cafe_gross_iqd), 0)::bigint    as cafe_gross_iqd,
           coalesce(sum(p.refunds_iqd), 0)::bigint       as refunds_iqd,
           coalesce(sum(p.price_iqd), 0)::bigint         as court_iqd,
           coalesce(sum(p.mins), 0)::bigint              as booked_minutes
      from courts_in c
      left join oc on oc.court_id = c.id
      left join per_b p on p.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, oc.open_minutes),
  tot as (
    select coalesce(sum(pc.live_bookings), 0)::bigint    as live_bookings,
           coalesce(sum(pc.linked_bookings), 0)::bigint  as linked_bookings,
           coalesce(sum(pc.settled_linked), 0)::bigint   as settled_linked,
           coalesce(sum(pc.cafe_iqd), 0)::bigint         as cafe_iqd,
           coalesce(sum(pc.cafe_gross_iqd), 0)::bigint   as cafe_gross_iqd,
           coalesce(sum(pc.refunds_iqd), 0)::bigint      as refunds_iqd,
           coalesce(sum(pc.court_iqd), 0)::bigint        as court_iqd,
           coalesce(sum(pc.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(sum(pc.open_minutes), 0)::bigint     as open_minutes
      from per_court pc),
  nl as (
    select * from app.cafe_net_lines((select coalesce(array_agg(lt.tab_id), '{}'::uuid[]) from lt))),
  lo as (
    select o.id as order_id, o.placed_at, p.court_id, p.start_at, p.end_at
      from orders o
      join lt on lt.tab_id = o.tab_id
      join per_b p on p.id = lt.reservation_id
     where o.status <> 'voided'),
  li as (
    select lo.court_id, lo.order_id, nl.menu_item_id,
           (nl.qty - nl.refund_qty) as qty, nl.net_iqd
      from nl
      join lo on lo.order_id = nl.order_id
     where nl.menu_item_id <> all (v_ex)),
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
                   sum(li.net_iqd)::bigint         as revenue_iqd,
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
           (select coalesce(sum(nl.net_iqd), 0) from nl where nl.order_id = lo.order_id)::bigint as revenue_iqd
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
      'cafe_gross_iqd',               t.cafe_gross_iqd,
      'refunds_iqd',                  t.refunds_iqd,
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
               'cafe_gross_iqd',               pc.cafe_gross_iqd,
               'refunds_iqd',                  pc.refunds_iqd,
               'cafe_per_linked_iqd',          case when pc.settled_linked > 0 then round(pc.cafe_iqd * 1.0 / pc.settled_linked)::bigint end,
               'cafe_per_booking_iqd',         case when pc.live_bookings > 0 then round(pc.cafe_iqd * 1.0 / pc.live_bookings)::bigint end,
               'court_iqd',                    pc.court_iqd,
               'booked_minutes',               pc.booked_minutes,
               'open_minutes',                 pc.open_minutes,
               'combined_per_booked_hour_iqd', case when pc.booked_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.booked_minutes)::bigint end,
               'combined_per_open_hour_iqd',   case when pc.open_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.open_minutes)::bigint end
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
end $fn_analytics_courts_cafe_0097$;

-- ---------------------------------------------------------------------------
-- 7. app.report_courts — available minutes PER COURT from the helper.
-- ---------------------------------------------------------------------------
create or replace function app.report_courts(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_courts_0097$
declare
  v_b       record;
  v_court   uuid;
  v_rows    jsonb;
  v_totals  jsonb;
  v_by_hour jsonb;
  v_trend   jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'courtId' and jsonb_typeof(p_filters -> 'courtId') <> 'null' then
    begin
      v_court := (p_filters ->> 'courtId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'courtId';
    end;
  end if;

  with
  b as (
    select r.id, r.court_id, r.status, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                   as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int            as mins,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)              as d,
           extract(hour from (r.start_at at time zone v_b.tz))::int           as hour,
           r.status in ('confirmed','arrived','completed')                    as live,
           rp.price_iqd                                                       as rule_price,
           (select max(p2.price_iqd)
              from rate_rules rr
              join rate_rule_prices p2 on p2.rule_id = rr.id
             where rr.is_active
               and (rr.court_id is null or rr.court_id = r.court_id)
               and p2.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int) as max_price
      from reservations r
      left join rate_rule_prices rp
             on rp.rule_id = r.rate_rule_id
            and rp.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int
     where r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_court is null or r.court_id = v_court)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where (v_court is null or c.id = v_court)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, v_court) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(oc.open_minutes, 0)::bigint                                as avail,
           count(b.id) filter (where b.live)                                   as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint              as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint         as revenue_iqd,
           count(b.id) filter (where b.status = 'cancelled')                   as cancellations,
           count(b.id) filter (where b.status = 'no_show')                     as no_shows,
           count(b.id) filter (where b.live and b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price) as peak,
           count(b.id) filter (where b.live and not (b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price)) as off_peak
      from courts_in c
      left join oc on oc.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, oc.open_minutes)
  select coalesce(jsonb_agg(jsonb_build_object(
           'courtId',                    pc.id,
           'courtNameEn',                pc.name_en,
           'courtNameAr',                pc.name_ar,
           'isActive',                   pc.is_active,
           'bookings',                   pc.bookings,
           'bookedMinutes',              pc.booked_minutes,
           'availableMinutes',           pc.avail,
           'occupancyPct',               case when pc.avail > 0 then round(pc.booked_minutes * 100.0 / pc.avail, 1) end,
           'revenueIqd',                 pc.revenue_iqd,
           'revenuePerAvailableHourIqd', case when pc.avail > 0 then round(pc.revenue_iqd * 60.0 / pc.avail)::bigint end,
           'cancellations',              pc.cancellations,
           'noShows',                    pc.no_shows,
           'cancellationRatePct',        case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'noShowRatePct',              case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'peakBookings',               pc.peak,
           'offPeakBookings',            pc.off_peak
         ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb),
         jsonb_build_object(
           'bookings',         coalesce(sum(pc.bookings), 0)::bigint,
           'bookedMinutes',    coalesce(sum(pc.booked_minutes), 0)::bigint,
           'availableMinutes', coalesce(sum(pc.avail), 0)::bigint,
           'occupancyPct',     case when coalesce(sum(pc.avail), 0) > 0
                                    then round(coalesce(sum(pc.booked_minutes), 0) * 100.0 / sum(pc.avail), 1) end,
           'revenueIqd',       coalesce(sum(pc.revenue_iqd), 0)::bigint,
           'cancellations',    coalesce(sum(pc.cancellations), 0)::bigint,
           'noShows',          coalesce(sum(pc.no_shows), 0)::bigint,
           'peakBookings',     coalesce(sum(pc.peak), 0)::bigint,
           'offPeakBookings',  coalesce(sum(pc.off_peak), 0)::bigint)
    into v_rows, v_totals
    from per_court pc;

  -- byHour: every venue-local hour 0..23 (a chart wants the full axis).
  select jsonb_agg(jsonb_build_object('hour', h.hour, 'bookings', coalesce(x.n, 0)) order by h.hour)
    into v_by_hour
    from generate_series(0, 23) as h(hour)
    left join (
      select extract(hour from (r.start_at at time zone v_b.tz))::int as hour, count(*) as n
        from reservations r
       where r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x on x.hour = h.hour;

  -- trend: one entry per business day that had a live booking.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', x.d, 'bookings', x.n, 'revenueIqd', x.rev) order by x.d), '[]'::jsonb)
    into v_trend
    from (
      select app.business_date(r.start_at, v_b.tz, v_b.start_hour) as d,
             count(*)                                             as n,
             coalesce(sum(r.price_iqd), 0)::bigint                as rev
        from reservations r
       where r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x;

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','courtNameEn',                'labelEn','Court',               'labelAr','الملعب',                 'kind','text'),
      jsonb_build_object('key','bookings',                   'labelEn','Bookings',            'labelAr','الحجوزات',               'kind','count'),
      jsonb_build_object('key','bookedMinutes',              'labelEn','Booked minutes',      'labelAr','الدقائق المحجوزة',       'kind','count'),
      jsonb_build_object('key','availableMinutes',           'labelEn','Available minutes',   'labelAr','الدقائق المتاحة',        'kind','count'),
      jsonb_build_object('key','occupancyPct',               'labelEn','Occupancy',           'labelAr','الإشغال',                'kind','pct'),
      jsonb_build_object('key','revenueIqd',                 'labelEn','Revenue',             'labelAr','الإيراد',                'kind','money'),
      jsonb_build_object('key','revenuePerAvailableHourIqd', 'labelEn','Revenue / open hour', 'labelAr','الإيراد لكل ساعة متاحة', 'kind','money'),
      jsonb_build_object('key','cancellations',              'labelEn','Cancellations',       'labelAr','الإلغاءات',              'kind','count'),
      jsonb_build_object('key','noShows',                    'labelEn','No-shows',            'labelAr','عدم الحضور',             'kind','count'),
      jsonb_build_object('key','cancellationRatePct',        'labelEn','Cancellation rate',   'labelAr','نسبة الإلغاء',           'kind','pct'),
      jsonb_build_object('key','noShowRatePct',              'labelEn','No-show rate',        'labelAr','نسبة عدم الحضور',        'kind','pct'),
      jsonb_build_object('key','peakBookings',               'labelEn','Peak',                'labelAr','وقت الذروة',             'kind','count'),
      jsonb_build_object('key','offPeakBookings',            'labelEn','Off-peak',            'labelAr','خارج الذروة',            'kind','count')),
    'rows',       v_rows,
    'totals',     v_totals,
    'byHour',     coalesce(v_by_hour, '[]'::jsonb),
    'trend',      v_trend,
    'comparison', null);
end $fn_report_courts_0097$;

-- ---------------------------------------------------------------------------
-- 8. Grants restated.
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

revoke all on function app.report_courts(date, date, jsonb) from public, anon;
grant execute on function app.report_courts(date, date, jsonb) to authenticated;
