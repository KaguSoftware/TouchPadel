-- ===========================================================================
-- 0124 — stations: the device registry the venue axis resolves through
-- (multi-venue slice 1).
--
-- WHY. Today a "device" is a free-text id a client POSTs to app.heartbeat
-- (0107): device_heartbeats.device_id, station_staff.station_id and
-- staff_breaks.station_id are three independent text columns with no table
-- behind them, and nothing says which venue a till belongs to. From 0125 on,
-- the FIRST question app.resolve_venue() asks is "which venue is this station
-- at", so the station has to be a row, with a venue, that can be retired.
--
-- 0118 already said this would happen ("multi-venue replaces the free-text
-- device id with a stations registry; retire_device becomes retire station"),
-- and named retire_device so it would survive the change. It still does: 0131
-- points device_heartbeats and station_staff at this table, and turning
-- retire_device into "retire the station" is slice 3.
--
-- THE PRE-FLIGHT. station_staff has carried a CHECK on the id shape since
-- 0105, but device_heartbeats and staff_breaks never did — device_heartbeats
-- takes whatever the client sends. So the seed below could meet an id that the
-- new CHECK rejects, and the failure would be a constraint violation in the
-- middle of a hosted apply with no explanation. Instead the DO block runs the
-- same test FIRST and raises STATION_ID_UNSUPPORTED with the offending ids in
-- DETAIL. Run it against hosted read-only before the push:
--
--   select device_id from device_heartbeats where device_id !~ '^[A-Z][A-Z0-9-]{0,31}$'
--   union select station_id from station_staff  where station_id !~ '^[A-Z][A-Z0-9-]{0,31}$'
--   union select station_id from staff_breaks   where station_id !~ '^[A-Z][A-Z0-9-]{0,31}$';
--
-- and clear anything it returns with app.retire_device (0118) before applying.
--
-- NO `mode` COLUMN. A station's mode (till / desk / KDS) never reaches the
-- server today — the operator decides it client-side from the id prefix — so
-- a column here would be a field nothing writes and nothing reads. is_till is
-- different: 0026 made it sticky and app.is_degraded() reasons over it, so it
-- is seeded from both the explicit flag and the historical 'TILL%' naming.
--
-- Next in this slice: 0125 the resolver (reads this table first), 0130
-- auto-registers unknown stations from app.heartbeat, 0131 the FKs.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Pre-flight: refuse loudly, with the offenders, rather than fail on the
--    CHECK halfway through the seed.
-- ---------------------------------------------------------------------------
do $preflight_0124$
declare
  v_bad text;
begin
  select string_agg(s.id, ', ' order by s.id) into v_bad
    from (select device_id  as id from device_heartbeats
          union
          select station_id as id from station_staff
          union
          select station_id as id from staff_breaks) s
   where s.id !~ '^[A-Z][A-Z0-9-]{0,31}$';

  if v_bad is not null then
    raise exception 'STATION_ID_UNSUPPORTED'
      using errcode = 'P0001',
            detail  = v_bad,
            hint    = 'Retire these devices with app.retire_device (0118), or correct the id, then re-apply 0124.';
  end if;
end
$preflight_0124$;

-- ---------------------------------------------------------------------------
-- 2. The table. id is the client-supplied station name, kept as the key so the
--    three existing text columns can point at it without a rewrite (0131).
--    A retired station keeps its row: history (staff_breaks, audit_log) names
--    it, and 0130 un-retires it if it beats again.
-- ---------------------------------------------------------------------------
create table if not exists stations (
  id            text primary key,
  venue_id      uuid not null references venues(id),
  is_till       boolean not null default false,
  registered_at timestamptz not null default now(),
  registered_by uuid references staff(id),
  retired_at    timestamptz,
  constraint stations_id_chk check (id ~ '^[A-Z][A-Z0-9-]{0,31}$')
);

comment on table stations is
  '0124 (multi-venue slice 1): one row per physical device — till, desk, KDS. The venue axis '
  'resolves through it: app.resolve_venue() (0125) reads the asserted station first. Rows are '
  'written by app.heartbeat (0130) on first beat and by app.set_station_staff; retired_at is set '
  'instead of deleting, because staff_breaks and audit_log name the id forever. No mode column: '
  'the mode never reaches the server.';

-- ---------------------------------------------------------------------------
-- 3. Seed from the three places a station id lives today, at the default
--    venue. registered_at takes the oldest evidence the database holds of the
--    device rather than now(), so the registry does not claim every till was
--    installed on migration day.
--    is_till: the explicit flag OR the historical 'TILL%' naming (0026).
-- ---------------------------------------------------------------------------
insert into stations (id, venue_id, is_till, registered_at)
select s.id,
       app.default_venue(),
       bool_or(s.is_till),
       min(s.seen_at)
  from (select device_id  as id, (is_till or device_id like 'TILL%') as is_till, last_seen_at as seen_at
          from device_heartbeats
         union all
        select station_id, station_id like 'TILL%', created_at
          from station_staff
         union all
        select station_id, station_id like 'TILL%', started_at
          from staff_breaks) s
 where app.default_venue() is not null
 group by s.id
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Reads. Staff only — a station id is operational detail, never guest-
--    visible. Writes are app.heartbeat / app.set_station_staff (0130) and
--    migrations; no client grant beyond SELECT.
-- ---------------------------------------------------------------------------
alter table stations enable row level security;

grant select on stations to authenticated;

drop policy if exists stations_read_staff on stations;
create policy stations_read_staff on stations
  for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));
