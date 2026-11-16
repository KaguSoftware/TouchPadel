-- ===========================================================================
-- 0442 staff_clock — staff log arriving and leaving with their phone at the
-- club, against a weekly plan of shifts; lateness records itself (Majed,
-- 2026-11-15).
--
-- Majed's calls (2026-11-15):
--   * every staff member logs "I started" and "I finished" from the staff
--     app, and it must be impossible from home: the phone's location must be
--     at the club AND the phone scans the QR on a desk station, whose 6-digit
--     code changes every 30 seconds;
--   * the QR shows on the operator as soon as it opens, before anyone signs
--     in, and again from a QR button for a colleague who arrives later; one
--     and the same QR logs arriving and leaving;
--   * each person has set hours per weekday, any number of shifts a day (two
--     shifts with an hour off between them, two jobs on one day); a shift may
--     name the job, so someone with a second job is a waiter at one time and
--     a cashier at another, with no scan at the switch: one QR per day;
--   * a gap between two shifts is not work and never counts against anyone;
--   * lateness and leaving early are recorded by themselves from the scans
--     (the owner chose "add start times, auto-late").
--
-- 1. staff_clock_places: per branch, the club's point (lat, lng), the radius
--    a phone must be inside (default 120 m) and the roughest location fix
--    accepted (default 60 m). Owner writes (set_clock_place).
-- 2. station_clock_keys: per desk station, a 20-byte secret. The station
--    computes the code itself (HMAC-SHA1 TOTP, 30 s steps, 6 digits, RFC
--    6238 truncation; @touch/core clockCode is the same function), so no API
--    ever hands a code out and the QR keeps working offline and before
--    anyone signs in. Issued by the owner or a manager at that station's
--    branch (issue_station_clock_key); the secret is returned once.
--    WHY NOT A CODE FROM THE SERVER: x-station-id is a request header any
--    staff session can send from home, so a server-issued code would prove
--    nothing about being at the desk.
-- 3. staff_shifts: the weekly plan, per person and branch: ISO weekday (1
--    Monday .. 7 Sunday), starts_at, ends_at (at or before starts_at = ends
--    the next day), the job (NULL = the main job). Written as a whole week by
--    set_staff_shifts (owner; a manager for anyone but themselves and the
--    owner). Shifts never overlap; touching shifts form one block.
-- 4. staff_clock_devices: the one phone a person logs with, bound on their
--    first accepted scan (sha256 of the app's device id). Another phone is
--    refused (WRONG_DEVICE) until a manager or the owner resets it.
-- 5. staff_clock_events: every attempt, accepted or refused with the reason,
--    with the fix (lat, lng, accuracy, age, mocked), the distance, the
--    station whose code matched, and for an accepted one the work day it
--    counts against and the minutes it added (late for in, early for out).
--    Refusals are answered as data, never raised, so the attempt is kept.
-- 6. Lateness. An accepted "in" is measured against the first planned shift
--    that has not ended and starts within 3 hours: late = minutes after that
--    shift's start. An accepted "out" closes the open "in" and is measured
--    against the end of the block (touching shifts) that "in" matched:
--    early = minutes before that end (the whole block when they leave before
--    it starts). Leaving at the end of a block before a gap costs nothing,
--    and coming back is measured against the next shift's start. The day's
--    staff_attendance row = the sum of its accepted scans' minutes, source
--    'clock', recorded_by NULL; a manager's own record of the day (source
--    'manual') is never overwritten, nor a row whose pay month is paid.
--    record_attendance (re-issued) turns a clock row into a manual one.
--
-- RPCs: my_clock, clock_punch (any staff but the owner, at a branch of
-- theirs); clock_setup, set_clock_place (owner), issue_station_clock_key,
-- staff_shifts_get, set_staff_shifts, clock_day, clock_reset_device (owner
-- and managers). Re-issued: record_attendance, attendance_month (each day
-- gains source).
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. staff_clock_places
-- ---------------------------------------------------------------------------
create table if not exists staff_clock_places (
  venue_id        uuid primary key references venues(id),
  lat             double precision not null,
  lng             double precision not null,
  radius_m        int not null default 120,
  max_accuracy_m  int not null default 60,
  updated_by      uuid references staff(id),
  updated_at      timestamptz not null default now(),
  constraint staff_clock_places_lat_chk check (lat between -90 and 90),
  constraint staff_clock_places_lng_chk check (lng between -180 and 180),
  constraint staff_clock_places_radius_chk check (radius_m between 20 and 2000),
  constraint staff_clock_places_accuracy_chk check (max_accuracy_m between 10 and 500)
);
comment on table staff_clock_places is
  'staff_clock_places (0442): where a branch is for staff logging in and out: the point, the radius a phone must be inside and the roughest location fix accepted. Owner writes through app.set_clock_place; read through app.clock_setup. No client grant.';
comment on column staff_clock_places.venue_id is 'The branch.';
comment on column staff_clock_places.lat is 'Latitude of the club, WGS84 degrees.';
comment on column staff_clock_places.lng is 'Longitude of the club, WGS84 degrees.';
comment on column staff_clock_places.radius_m is 'A phone further than this from the point is not at the club (20 to 2000 m).';
comment on column staff_clock_places.max_accuracy_m is 'A fix rougher than this is refused (10 to 500 m).';
comment on column staff_clock_places.updated_by is 'Who set it last.';
comment on column staff_clock_places.updated_at is 'When it was set last.';
alter table staff_clock_places enable row level security;
revoke all on staff_clock_places from anon, authenticated;
grant all on staff_clock_places to service_role;
drop trigger if exists zz_branch_guard on public.staff_clock_places;
create trigger zz_branch_guard before insert or update or delete on public.staff_clock_places
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 2. station_clock_keys
-- ---------------------------------------------------------------------------
create table if not exists station_clock_keys (
  station_id  text primary key references stations(id),
  venue_id    uuid not null references venues(id),
  secret      bytea not null,
  issued_by   uuid references staff(id),
  issued_at   timestamptz not null default now(),
  constraint station_clock_keys_secret_chk check (length(secret) = 20)
);
comment on table station_clock_keys is
  'station_clock_keys (0442): the secret a desk station makes its 30-second clock code from (HMAC-SHA1 TOTP, 6 digits). Issued by app.issue_station_clock_key, returned once; never readable by any client.';
comment on column station_clock_keys.station_id is 'The station.';
comment on column station_clock_keys.venue_id is 'The station''s branch when issued.';
comment on column station_clock_keys.secret is '20 random bytes. Never leaves the database except once, to the station it was issued to.';
comment on column station_clock_keys.issued_by is 'Who issued it.';
comment on column station_clock_keys.issued_at is 'When it was issued.';
alter table station_clock_keys enable row level security;
revoke all on station_clock_keys from anon, authenticated;
grant all on station_clock_keys to service_role;
drop trigger if exists zz_branch_guard on public.station_clock_keys;
create trigger zz_branch_guard before insert or update or delete on public.station_clock_keys
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 3. staff_shifts
-- ---------------------------------------------------------------------------
create table if not exists staff_shifts (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id),
  staff_id    uuid not null references staff(id),
  weekday     smallint not null,
  starts_at   time not null,
  ends_at     time not null,
  role        staff_role,
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),
  constraint staff_shifts_weekday_chk check (weekday between 1 and 7),
  constraint staff_shifts_span_chk check (starts_at <> ends_at),
  constraint staff_shifts_role_chk check (role is null or role <> 'owner')
);
comment on table staff_shifts is
  'staff_shifts (0442): a person''s set hours at a branch, per ISO weekday (1 Monday .. 7 Sunday). ends_at at or before starts_at means the shift ends the next day. role is the job of that shift (NULL = the main job). Shifts of one person never overlap; touching shifts form one block. Written as a whole week by app.set_staff_shifts; read through app.staff_shifts_get, app.my_clock and app.clock_day. No client grant.';
comment on column staff_shifts.id is 'Row id.';
comment on column staff_shifts.venue_id is 'The branch.';
comment on column staff_shifts.staff_id is 'The person.';
comment on column staff_shifts.weekday is 'ISO weekday the shift starts on: 1 Monday .. 7 Sunday.';
comment on column staff_shifts.starts_at is 'Start, branch local time.';
comment on column staff_shifts.ends_at is 'End, branch local time; at or before starts_at = the next day.';
comment on column staff_shifts.role is 'The job of this shift; NULL = the person''s main job.';
comment on column staff_shifts.created_by is 'Who wrote the week.';
comment on column staff_shifts.created_at is 'When the week was written.';
alter table staff_shifts enable row level security;
revoke all on staff_shifts from anon, authenticated;
grant all on staff_shifts to service_role;
drop trigger if exists zz_branch_guard on public.staff_shifts;
create trigger zz_branch_guard before insert or update or delete on public.staff_shifts
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 4. staff_clock_devices
-- ---------------------------------------------------------------------------
create table if not exists staff_clock_devices (
  staff_id     uuid primary key references staff(id),
  device_hash  text not null,
  platform     text not null,
  bound_at     timestamptz not null default now(),
  constraint staff_clock_devices_hash_chk check (device_hash ~ '^[0-9a-f]{64}$'),
  constraint staff_clock_devices_platform_chk check (platform in ('ios', 'android'))
);
comment on table staff_clock_devices is
  'staff_clock_devices (0442): the one phone a person logs in and out with (sha256 of the app''s device id), bound on their first accepted scan, removed by app.clock_reset_device. No client grant.';
comment on column staff_clock_devices.staff_id is 'The person.';
comment on column staff_clock_devices.device_hash is 'sha256 hex of the phone''s app device id; the id itself is never stored.';
comment on column staff_clock_devices.platform is 'ios or android.';
comment on column staff_clock_devices.bound_at is 'When the phone was bound.';
alter table staff_clock_devices enable row level security;
revoke all on staff_clock_devices from anon, authenticated;
grant all on staff_clock_devices to service_role;

-- ---------------------------------------------------------------------------
-- 5. staff_clock_events
-- ---------------------------------------------------------------------------
create table if not exists staff_clock_events (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id),
  staff_id       uuid not null references staff(id),
  kind           text not null,
  status         text not null,
  refusal        text,
  at             timestamptz not null default now(),
  work_date      date,
  late_minutes   int not null default 0,
  early_minutes  int not null default 0,
  in_event_id    uuid references staff_clock_events(id),
  lat            double precision,
  lng            double precision,
  accuracy_m     real,
  distance_m     int,
  fix_at         timestamptz,
  mocked         boolean,
  device_hash    text,
  platform       text,
  station_id     text references stations(id),
  constraint staff_clock_events_kind_chk check (kind in ('in', 'out')),
  constraint staff_clock_events_status_chk check (status in ('accepted', 'refused')),
  constraint staff_clock_events_refusal_chk check (
    (status = 'accepted' and refusal is null)
    or (status = 'refused' and refusal in ('TOO_MANY_TRIES', 'NO_PLACE', 'NO_STATION',
        'WRONG_DEVICE', 'LOCATION_STALE', 'MOCK_LOCATION', 'LOCATION_ROUGH', 'NOT_HERE',
        'CODE_WRONG', 'ALREADY_IN', 'NOT_IN'))),
  constraint staff_clock_events_minutes_chk
    check (late_minutes between 0 and 720 and early_minutes between 0 and 720),
  constraint staff_clock_events_platform_chk check (platform is null or platform in ('ios', 'android'))
);
comment on table staff_clock_events is
  'staff_clock_events (0442): every log-in or log-out attempt from a staff phone, accepted or refused with the reason, with the location fix, the distance from the club, the station whose code matched and, when accepted, the work day it counts against and the late or early minutes it added. Written only by app.clock_punch; read through app.my_clock and app.clock_day. No client grant.';
comment on column staff_clock_events.id is 'Row id.';
comment on column staff_clock_events.venue_id is 'The branch.';
comment on column staff_clock_events.staff_id is 'The person.';
comment on column staff_clock_events.kind is 'in (arrived) or out (left).';
comment on column staff_clock_events.status is 'accepted or refused.';
comment on column staff_clock_events.refusal is 'Why it was refused; NULL when accepted.';
comment on column staff_clock_events.at is 'Server time of the attempt.';
comment on column staff_clock_events.work_date is 'Accepted: the day of the planned shift it counts against (the local date for an unplanned scan).';
comment on column staff_clock_events.late_minutes is 'An accepted in: minutes after the matched shift started.';
comment on column staff_clock_events.early_minutes is 'An accepted out: minutes before the matched block ended.';
comment on column staff_clock_events.in_event_id is 'An accepted out: the in it closes.';
comment on column staff_clock_events.lat is 'The phone''s reported latitude.';
comment on column staff_clock_events.lng is 'The phone''s reported longitude.';
comment on column staff_clock_events.accuracy_m is 'The phone''s reported accuracy, metres.';
comment on column staff_clock_events.distance_m is 'Distance from the club''s point, metres.';
comment on column staff_clock_events.fix_at is 'When the phone took the fix.';
comment on column staff_clock_events.mocked is 'The phone''s operating system said the location was simulated.';
comment on column staff_clock_events.device_hash is 'sha256 hex of the phone''s app device id.';
comment on column staff_clock_events.platform is 'ios or android.';
comment on column staff_clock_events.station_id is 'The desk station whose code matched.';
alter table staff_clock_events enable row level security;
revoke all on staff_clock_events from anon, authenticated;
grant all on staff_clock_events to service_role;
drop trigger if exists zz_branch_guard on public.staff_clock_events;
create trigger zz_branch_guard before insert or update or delete on public.staff_clock_events
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 6. staff_attendance: a day can be recorded by the clock.
-- ---------------------------------------------------------------------------
alter table staff_attendance alter column recorded_by drop not null;
alter table staff_attendance add column if not exists source text not null default 'manual';
do $staff_attendance_source_chk_0442$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'staff_attendance_source_chk'
                    and conrelid = 'public.staff_attendance'::regclass) then
    alter table staff_attendance add constraint staff_attendance_source_chk
      check ((source = 'manual' and recorded_by is not null)
             or (source = 'clock' and recorded_by is null)) not valid;
  end if;
end $staff_attendance_source_chk_0442$;
alter table staff_attendance validate constraint staff_attendance_source_chk;
comment on column staff_attendance.source is
  '0442: manual (a manager or the owner recorded it) or clock (written from the person''s own scans against their set hours; recorded_by NULL).';
comment on column staff_attendance.recorded_by is
  'The manager or owner who recorded it; NULL for a day the clock recorded (source clock, 0442).';

-- ---------------------------------------------------------------------------
-- 7. Internal helpers.
-- ---------------------------------------------------------------------------

-- The 6-digit code of one 30-second step (RFC 6238 truncation over
-- HMAC-SHA1 of the step as 8 big-endian bytes). @touch/core clockCode is
-- the same function; tests/staff-clock.test.ts holds them equal.
create or replace function app.clock_code(p_secret bytea, p_step bigint) returns text
language plpgsql immutable security definer set search_path = public as $clock_code_0442$
declare
  v_h   bytea;
  v_off int;
  v_bin bigint;
begin
  v_h   := extensions.hmac(int8send(p_step), p_secret, 'sha1');
  v_off := get_byte(v_h, 19) & 15;
  v_bin := ((get_byte(v_h, v_off) & 127)::bigint << 24)
         | (get_byte(v_h, v_off + 1)::bigint << 16)
         | (get_byte(v_h, v_off + 2)::bigint << 8)
         |  get_byte(v_h, v_off + 3)::bigint;
  return lpad((v_bin % 1000000)::text, 6, '0');
end $clock_code_0442$;
comment on function app.clock_code(bytea, bigint) is
  '0442. Internal: the 6-digit clock code of a station secret for one 30-second step (floor(epoch / 30)); HMAC-SHA1, RFC 6238 truncation. Same as @touch/core clockCode.';
revoke all on function app.clock_code(bytea, bigint) from public, anon, authenticated;
grant execute on function app.clock_code(bytea, bigint) to service_role;

-- Great-circle distance in metres.
create or replace function app.clock_distance_m(p_lat1 double precision, p_lng1 double precision,
                                                p_lat2 double precision, p_lng2 double precision)
returns double precision
language plpgsql immutable security definer set search_path = public as $clock_distance_m_0442$
declare
  v_dlat double precision := radians(p_lat2 - p_lat1);
  v_dlng double precision := radians(p_lng2 - p_lng1);
  v_a    double precision;
begin
  v_a := sin(v_dlat / 2) ^ 2 + cos(radians(p_lat1)) * cos(radians(p_lat2)) * sin(v_dlng / 2) ^ 2;
  return 2 * 6371008.8 * asin(least(1, sqrt(v_a)));
end $clock_distance_m_0442$;
comment on function app.clock_distance_m(double precision, double precision, double precision, double precision) is
  '0442. Internal: haversine distance in metres between two WGS84 points.';
revoke all on function app.clock_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function app.clock_distance_m(double precision, double precision, double precision, double precision) to service_role;

-- The planned shifts of one person at one branch whose start falls on the
-- local days p_from .. p_to, as instants, each with the block (touching
-- shifts) it belongs to.
create or replace function app.clock_plan(p_staff uuid, p_venue uuid, p_from date, p_to date)
returns table (work_date date, starts timestamptz, ends timestamptz, role staff_role,
               block_starts timestamptz, block_ends timestamptz)
language plpgsql stable security definer set search_path = public as $clock_plan_0442$
declare
  v_tz text;
begin
  select coalesce(v.timezone, 'Asia/Baghdad') into v_tz from venues v where v.id = p_venue;
  return query
  with days as (
    select d::date as d from generate_series(p_from, p_to, interval '1 day') d
  ), shifts as (
    select days.d as wd,
           ((days.d + s.starts_at)::timestamp at time zone v_tz) as s_at,
           ((days.d + s.ends_at
             + case when s.ends_at <= s.starts_at then interval '1 day' else interval '0' end)::timestamp
            at time zone v_tz) as e_at,
           s.role as r
      from days
      join staff_shifts s on s.staff_id = p_staff and s.venue_id = p_venue
                         and s.weekday = extract(isodow from days.d)::int
  ), marked as (
    select sh.*,
           case when lag(sh.e_at) over (order by sh.s_at) >= sh.s_at then 0 else 1 end as brk
      from shifts sh
  ), grouped as (
    select m.*, sum(m.brk) over (order by m.s_at rows unbounded preceding) as grp
      from marked m
  )
  select g.wd, g.s_at, g.e_at, g.r,
         min(g.s_at) over (partition by g.grp),
         max(g.e_at) over (partition by g.grp)
    from grouped g
   order by g.s_at;
end $clock_plan_0442$;
comment on function app.clock_plan(uuid, uuid, date, date) is
  '0442. Internal: a person''s planned shifts at a branch starting on local days p_from..p_to, as instants in the branch''s timezone, each with the start and end of its block (touching shifts join into one block).';
revoke all on function app.clock_plan(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function app.clock_plan(uuid, uuid, date, date) to service_role;

-- The caller's active membership of a branch, never the owner.
create or replace function app.clock_member_guard(p_venue uuid) returns void
language plpgsql stable security definer set search_path = public as $clock_member_guard_0442$
begin
  if auth.uid() is null or app.staff_role() is null or app.staff_role() = 'owner' then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue is null
     or not exists (select 1 from staff_venues sv
                     join venues v on v.id = sv.venue_id and v.status <> 'closed'
                    where sv.staff_id = auth.uid() and sv.venue_id = p_venue) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'venue_id';
  end if;
end $clock_member_guard_0442$;
comment on function app.clock_member_guard(uuid) is
  '0442. Internal: raises FORBIDDEN unless the caller is active staff (not the owner) and a member of the branch, which is not closed.';
revoke all on function app.clock_member_guard(uuid) from public, anon, authenticated;
grant execute on function app.clock_member_guard(uuid) to service_role;

-- A manager or the owner at the branch.
create or replace function app.clock_mgmt_guard(p_venue uuid) returns void
language plpgsql stable security definer set search_path = public as $clock_mgmt_guard_0442$
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue is null
     or not (p_venue = any(app.staff_venue_ids()) and app.is_staff_at(p_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'venue_id';
  end if;
end $clock_mgmt_guard_0442$;
comment on function app.clock_mgmt_guard(uuid) is
  '0442. Internal: raises FORBIDDEN unless the caller is a manager or the owner at the branch.';
revoke all on function app.clock_mgmt_guard(uuid) from public, anon, authenticated;
grant execute on function app.clock_mgmt_guard(uuid) to service_role;

-- Writes a person's day from their accepted scans. Called under app.lock_wage.
create or replace function app.clock_attendance_sync(p_venue uuid, p_staff uuid, p_date date)
returns void
language plpgsql security definer set search_path = public as $clock_attendance_sync_0442$
declare
  v_late  int;
  v_early int;
  v_old   staff_attendance%rowtype;
  v_found boolean;
begin
  select least(720, coalesce(sum(e.late_minutes), 0)), least(720, coalesce(sum(e.early_minutes), 0))
    into v_late, v_early
    from staff_clock_events e
   where e.venue_id = p_venue and e.staff_id = p_staff and e.work_date = p_date
     and e.status = 'accepted';

  select * into v_old from staff_attendance a
   where a.venue_id = p_venue and a.staff_id = p_staff and a.work_date = p_date
   for update;
  v_found := found;

  -- A manager's record wins; a paid month is frozen.
  if v_found and (v_old.source = 'manual' or app.wage_month_paid(p_venue, p_staff, v_old.pay_month)) then
    return;
  end if;

  perform set_config('app.venue_id', p_venue::text, true);
  if v_late + v_early = 0 then
    if v_found then
      delete from staff_attendance where id = v_old.id;
    end if;
    return;
  end if;

  if v_found then
    update staff_attendance
       set late_minutes = v_late, early_leave_minutes = v_early, recorded_at = now()
     where id = v_old.id;
  else
    insert into staff_attendance (venue_id, staff_id, work_date, late_minutes, early_leave_minutes,
                                  grace_minutes, penalty_rule_iqd, pay_month, note, recorded_by, source)
    values (p_venue, p_staff, p_date, v_late, v_early,
            coalesce(app.cafe_setting_int('attendance_grace_minutes', p_venue), 0),
            coalesce(app.cafe_setting_int('attendance_penalty_iqd', p_venue), 0),
            app.wage_open_month(p_venue, p_staff, p_date), null, null, 'clock');
  end if;
end $clock_attendance_sync_0442$;
comment on function app.clock_attendance_sync(uuid, uuid, date) is
  '0442. Internal, under app.lock_wage: sets the person''s staff_attendance day to the sum of the day''s accepted scans (late from ins, early from outs, each capped at 720), source clock; removes a clock row that sums to 0. Never touches a manual row or a row whose pay month is paid.';
revoke all on function app.clock_attendance_sync(uuid, uuid, date) from public, anon, authenticated;
grant execute on function app.clock_attendance_sync(uuid, uuid, date) to service_role;

-- The caller's open "in" at a branch: the latest accepted in with no accepted
-- out after it, within 20 hours.
create or replace function app.clock_open_in(p_staff uuid, p_venue uuid)
returns staff_clock_events
language plpgsql stable security definer set search_path = public as $clock_open_in_0442$
declare
  v_row staff_clock_events%rowtype;
begin
  select * into v_row from staff_clock_events e
   where e.staff_id = p_staff and e.venue_id = p_venue and e.status = 'accepted'
   order by e.at desc, e.id desc
   limit 1;
  if found and v_row.kind = 'in' and v_row.at > now() - interval '20 hours' then
    return v_row;
  end if;
  return null;
end $clock_open_in_0442$;
comment on function app.clock_open_in(uuid, uuid) is
  '0442. Internal: the person''s open log-in at the branch (their latest accepted scan, when it is an in less than 20 hours old), else NULL. An in older than that is a day with no log-out.';
revoke all on function app.clock_open_in(uuid, uuid) from public, anon, authenticated;
grant execute on function app.clock_open_in(uuid, uuid) to service_role;

-- A day's plan as JSON for the clients.
create or replace function app.clock_plan_json(p_staff uuid, p_venue uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $clock_plan_json_0442$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('starts', p.starts, 'ends', p.ends, 'role', p.role,
                                        'block_starts', p.block_starts, 'block_ends', p.block_ends)
                     order by p.starts)
      from app.clock_plan(p_staff, p_venue, p_date, p_date) p), '[]'::jsonb);
end $clock_plan_json_0442$;
comment on function app.clock_plan_json(uuid, uuid, date) is
  '0442. Internal: the person''s shifts starting on one local day: [{starts, ends, role, block_starts, block_ends}].';
revoke all on function app.clock_plan_json(uuid, uuid, date) from public, anon, authenticated;
grant execute on function app.clock_plan_json(uuid, uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The phone: app.my_clock and app.clock_punch.
-- ---------------------------------------------------------------------------
create or replace function app.my_clock(p_venue_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $my_clock_0442$
declare
  v_tz     text;
  v_today  date;
  v_open   staff_clock_events%rowtype;
  v_now    jsonb;
  v_next   jsonb;
  v_recent jsonb;
begin
  perform app.clock_member_guard(p_venue_id);
  select coalesce(v.timezone, 'Asia/Baghdad') into v_tz from venues v where v.id = p_venue_id;
  v_today := (now() at time zone v_tz)::date;
  v_open  := app.clock_open_in(auth.uid(), p_venue_id);

  select jsonb_build_object('starts', p.starts, 'ends', p.ends, 'role', p.role) into v_now
    from app.clock_plan(auth.uid(), p_venue_id, v_today - 1, v_today) p
   where p.starts <= now() and p.ends > now()
   order by p.starts limit 1;
  select jsonb_build_object('starts', p.starts, 'ends', p.ends, 'role', p.role) into v_next
    from app.clock_plan(auth.uid(), p_venue_id, v_today, v_today + 7) p
   where p.starts > now()
   order by p.starts limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'status', e.status, 'refusal', e.refusal,
                                               'at', e.at, 'late_minutes', e.late_minutes,
                                               'early_minutes', e.early_minutes)
                            order by e.at desc), '[]'::jsonb)
    into v_recent
    from (select * from staff_clock_events e
           where e.staff_id = auth.uid() and e.venue_id = p_venue_id
           order by e.at desc limit 6) e;

  return jsonb_build_object(
    'now',          now(),
    'today',        v_today,
    'ready',        exists (select 1 from staff_clock_places cp where cp.venue_id = p_venue_id)
                    and exists (select 1 from station_clock_keys k join stations s on s.id = k.station_id
                                 where k.venue_id = p_venue_id and s.venue_id = p_venue_id
                                   and s.retired_at is null),
    'state',        case when v_open.id is null then 'out' else 'in' end,
    'since',        v_open.at,
    'device_bound', exists (select 1 from staff_clock_devices d where d.staff_id = auth.uid()),
    'shifts',       app.clock_plan_json(auth.uid(), p_venue_id, v_today),
    'current',      v_now,
    'next',         v_next,
    'recent',       v_recent);
end $my_clock_0442$;
comment on function app.my_clock(uuid) is
  '0442. Any staff member but the owner, at a branch of theirs: {now, today, ready (the club''s place is set and a live desk station has a code), state in|out, since (the open log-in), device_bound, shifts (today''s: [{starts, ends, role, block_starts, block_ends}]), current ({starts, ends, role} of the shift running now, or null), next (the next shift within a week, or null), recent (the last six attempts: [{kind, status, refusal, at, late_minutes, early_minutes}])}. FORBIDDEN (hint venue_id).';
revoke all on function app.my_clock(uuid) from public, anon;
grant execute on function app.my_clock(uuid) to authenticated;

create or replace function app.clock_punch(
  p_venue_id   uuid,
  p_kind       text,
  p_code       text,
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision,
  p_fix_at     timestamptz,
  p_mocked     boolean,
  p_device_id  text,
  p_platform   text
) returns jsonb
language plpgsql security definer set search_path = public as $clock_punch_0442$
declare
  v_me       uuid := auth.uid();
  v_tz       text;
  v_place    staff_clock_places%rowtype;
  v_hash     text;
  v_bound    text;
  v_dist     double precision;
  v_step     bigint;
  v_station  text;
  v_open     staff_clock_events%rowtype;
  v_refusal  text;
  v_today    date;
  v_work     date;
  v_late     int := 0;
  v_early    int := 0;
  v_shift    record;
  v_in_shift record;
  v_cut      timestamptz;
  v_row      staff_clock_events%rowtype;
  v_extra    jsonb := '{}'::jsonb;
begin
  perform app.clock_member_guard(p_venue_id);
  if p_kind is null or p_kind not in ('in', 'out') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
  end if;
  if p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 100000 or p_fix_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
  end if;
  if p_device_id is null or length(p_device_id) not between 8 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'device_id';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'platform';
  end if;

  perform set_config('app.venue_id', p_venue_id::text, true);
  -- One person's scans and pay at a branch are serialised by the wage lock.
  perform app.lock_wage(p_venue_id, v_me);

  select coalesce(v.timezone, 'Asia/Baghdad') into v_tz from venues v where v.id = p_venue_id;
  v_hash := encode(extensions.digest(convert_to(p_device_id, 'utf8'), 'sha256'), 'hex');
  select * into v_place from staff_clock_places cp where cp.venue_id = p_venue_id;
  if found then
    v_dist := app.clock_distance_m(v_place.lat, v_place.lng, p_lat, p_lng);
  end if;

  -- The checks, in order; the first that fails is the answer.
  if (select count(*) from staff_clock_events e
       where e.staff_id = v_me and e.status = 'refused' and e.at > now() - interval '1 hour') >= 8 then
    v_refusal := 'TOO_MANY_TRIES';
  elsif v_place.venue_id is null then
    v_refusal := 'NO_PLACE';
  elsif not exists (select 1 from station_clock_keys k join stations s on s.id = k.station_id
                     where k.venue_id = p_venue_id and s.venue_id = p_venue_id and s.retired_at is null) then
    v_refusal := 'NO_STATION';
  end if;

  if v_refusal is null then
    select d.device_hash into v_bound from staff_clock_devices d where d.staff_id = v_me;
    if v_bound is not null and v_bound <> v_hash then
      v_refusal := 'WRONG_DEVICE';
    elsif p_fix_at < now() - interval '2 minutes' or p_fix_at > now() + interval '1 minute' then
      v_refusal := 'LOCATION_STALE';
    elsif coalesce(p_mocked, false) then
      v_refusal := 'MOCK_LOCATION';
    elsif p_accuracy_m > v_place.max_accuracy_m then
      v_refusal := 'LOCATION_ROUGH';
    elsif v_dist > v_place.radius_m then
      v_refusal := 'NOT_HERE';
    end if;
  end if;

  -- The desk's code: any live station of the branch, this step or the two
  -- before it (a scan at the end of a step, a slow phone) or the next (a
  -- station clock a little fast).
  if v_refusal is null then
    v_step := floor(extract(epoch from now()) / 30)::bigint;
    if p_code is not null and p_code ~ '^[0-9]{6}$' then
      select k.station_id into v_station
        from station_clock_keys k
        join stations s on s.id = k.station_id and s.venue_id = p_venue_id and s.retired_at is null
        cross join generate_series(v_step - 2, v_step + 1) st
       where k.venue_id = p_venue_id
         and app.clock_code(k.secret, st) = p_code
       order by k.station_id
       limit 1;
    end if;
    if v_station is null then
      v_refusal := 'CODE_WRONG';
    end if;
  end if;

  if v_refusal is null then
    v_open := app.clock_open_in(v_me, p_venue_id);
    if p_kind = 'in' and v_open.id is not null then
      v_refusal := 'ALREADY_IN';
    elsif p_kind = 'out' and v_open.id is null then
      v_refusal := 'NOT_IN';
    end if;
  end if;

  if v_refusal is not null then
    insert into staff_clock_events (venue_id, staff_id, kind, status, refusal, lat, lng, accuracy_m,
                                    distance_m, fix_at, mocked, device_hash, platform, station_id)
    values (p_venue_id, v_me, p_kind, 'refused', v_refusal, p_lat, p_lng, p_accuracy_m,
            round(v_dist)::int, p_fix_at, coalesce(p_mocked, false), v_hash, p_platform, v_station);
    if v_refusal = 'NOT_HERE' then
      v_extra := jsonb_build_object('distance_m', round(v_dist)::int, 'radius_m', v_place.radius_m);
    elsif v_refusal = 'LOCATION_ROUGH' then
      v_extra := jsonb_build_object('accuracy_m', round(p_accuracy_m)::int,
                                    'max_accuracy_m', v_place.max_accuracy_m);
    end if;
    return jsonb_build_object('status', 'refused', 'reason', v_refusal) || v_extra;
  end if;

  -- Accepted. Work out the shift it counts against.
  v_today := (now() at time zone v_tz)::date;
  if p_kind = 'in' then
    select * into v_shift
      from app.clock_plan(v_me, p_venue_id, v_today - 1, v_today + 1) p
     where p.ends > now() and p.starts <= now() + interval '3 hours'
     order by p.starts limit 1;
    if found then
      v_work := v_shift.work_date;
      v_late := least(720, greatest(0, floor(extract(epoch from (now() - v_shift.starts)) / 60)::int));
    else
      v_work := v_today;
    end if;
  else
    v_work := v_open.work_date;
    -- The block the open "in" matched: the first block that had not ended
    -- when they arrived and starts within 3 hours of it.
    select * into v_in_shift
      from app.clock_plan(v_me, p_venue_id, v_open.work_date - 1, v_open.work_date + 1) p
     where p.ends > v_open.at and p.starts <= v_open.at + interval '3 hours'
     order by p.starts limit 1;
    if found and now() < v_in_shift.block_ends then
      v_cut  := greatest(now(), v_in_shift.block_starts);
      v_early := least(720, greatest(0, ceil(extract(epoch from (v_in_shift.block_ends - v_cut)) / 60)::int));
    end if;
  end if;

  insert into staff_clock_events (venue_id, staff_id, kind, status, work_date, late_minutes, early_minutes,
                                  in_event_id, lat, lng, accuracy_m, distance_m, fix_at, mocked,
                                  device_hash, platform, station_id)
  values (p_venue_id, v_me, p_kind, 'accepted', v_work, v_late, v_early,
          case when p_kind = 'out' then v_open.id end, p_lat, p_lng, p_accuracy_m, round(v_dist)::int,
          p_fix_at, false, v_hash, p_platform, v_station)
  returning * into v_row;

  if v_bound is null then
    insert into staff_clock_devices (staff_id, device_hash, platform) values (v_me, v_hash, p_platform)
    on conflict (staff_id) do nothing;
  end if;

  perform app.clock_attendance_sync(p_venue_id, v_me, v_work);

  perform app.write_audit('staff.clock.' || p_kind, 'staff_clock_events', v_row.id::text, null,
                          jsonb_build_object('status', 'accepted', 'station_id', v_station));

  return jsonb_build_object('status', 'accepted', 'kind', p_kind, 'at', v_row.at,
                            'work_date', v_work, 'late_minutes', v_late, 'early_minutes', v_early);
end $clock_punch_0442$;
comment on function app.clock_punch(uuid, text, text, double precision, double precision, double precision, timestamptz, boolean, text, text) is
  '0442. Any staff member but the owner, at a branch of theirs, logs arriving (p_kind in) or leaving (out) with the desk station''s 6-digit code and the phone''s location fix. Checks in order, the first failure answered as data {status: refused, reason} and kept in staff_clock_events: TOO_MANY_TRIES (8 refusals in the last hour), NO_PLACE, NO_STATION, WRONG_DEVICE (another phone is bound), LOCATION_STALE (fix older than 2 minutes), MOCK_LOCATION, LOCATION_ROUGH (+accuracy_m, max_accuracy_m), NOT_HERE (+distance_m, radius_m), CODE_WRONG (no live station of the branch has that code in steps -2..+1), ALREADY_IN, NOT_IN. Accepted: {status: accepted, kind, at, work_date, late_minutes, early_minutes}; binds the phone on the first accepted scan and writes the day''s staff_attendance from the scans (source clock). Raises FORBIDDEN (hint venue_id), INVALID_ARGUMENT (hint kind, location, device_id, platform). Audit staff.clock.in / staff.clock.out.';
revoke all on function app.clock_punch(uuid, text, text, double precision, double precision, double precision, timestamptz, boolean, text, text) from public, anon;
grant execute on function app.clock_punch(uuid, text, text, double precision, double precision, double precision, timestamptz, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Setup: the place (owner) and the station keys (owner, managers).
-- ---------------------------------------------------------------------------
create or replace function app.clock_setup(p_venue_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $clock_setup_0442$
declare
  v_place jsonb;
  v_st    jsonb;
begin
  perform app.clock_mgmt_guard(p_venue_id);
  select jsonb_build_object('lat', cp.lat, 'lng', cp.lng, 'radius_m', cp.radius_m,
                            'max_accuracy_m', cp.max_accuracy_m, 'updated_at', cp.updated_at,
                            'updated_by_name', s.display_name)
    into v_place
    from staff_clock_places cp left join staff s on s.id = cp.updated_by
   where cp.venue_id = p_venue_id;
  select coalesce(jsonb_agg(jsonb_build_object('station_id', st.id, 'is_till', st.is_till,
                                               'has_key', k.station_id is not null,
                                               'issued_at', k.issued_at, 'issued_by_name', s.display_name)
                            order by st.id), '[]'::jsonb)
    into v_st
    from stations st
    left join station_clock_keys k on k.station_id = st.id and k.venue_id = st.venue_id
    left join staff s on s.id = k.issued_by
   where st.venue_id = p_venue_id and st.retired_at is null;
  return jsonb_build_object('place', v_place, 'stations', v_st, 'can_edit_place', app.is_staff('owner'));
end $clock_setup_0442$;
comment on function app.clock_setup(uuid) is
  '0442. A manager or the owner at the branch: {place: {lat, lng, radius_m, max_accuracy_m, updated_at, updated_by_name} or null, stations: [{station_id, is_till, has_key, issued_at, issued_by_name}] (live stations), can_edit_place (owner)}. Never a secret. FORBIDDEN (hint venue_id).';
revoke all on function app.clock_setup(uuid) from public, anon;
grant execute on function app.clock_setup(uuid) to authenticated;

create or replace function app.set_clock_place(
  p_venue_id       uuid,
  p_lat            double precision,
  p_lng            double precision,
  p_radius_m       int default 120,
  p_max_accuracy_m int default 60
) returns jsonb
language plpgsql security definer set search_path = public as $set_clock_place_0442$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform app.clock_mgmt_guard(p_venue_id);
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or (p_lat = 0 and p_lng = 0) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
  end if;
  if p_radius_m is null or p_radius_m not between 20 and 2000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'radius_m';
  end if;
  if p_max_accuracy_m is null or p_max_accuracy_m not between 10 and 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'max_accuracy_m';
  end if;
  perform set_config('app.venue_id', p_venue_id::text, true);
  insert into staff_clock_places (venue_id, lat, lng, radius_m, max_accuracy_m, updated_by, updated_at)
  values (p_venue_id, p_lat, p_lng, p_radius_m, p_max_accuracy_m, auth.uid(), now())
  on conflict (venue_id) do update
     set lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m,
         max_accuracy_m = excluded.max_accuracy_m, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at;
  perform app.write_audit('staff.clock.place', 'staff_clock_places', p_venue_id::text, null,
                          jsonb_build_object('radius_m', p_radius_m, 'max_accuracy_m', p_max_accuracy_m));
  return jsonb_build_object('status', 'saved');
end $set_clock_place_0442$;
comment on function app.set_clock_place(uuid, double precision, double precision, int, int) is
  '0442. The owner sets where a branch is for staff logging in and out: the point, the radius (20 to 2000 m, default 120) and the roughest fix accepted (10 to 500 m, default 60). Returns {status: saved}. FORBIDDEN, INVALID_ARGUMENT (hint location, radius_m, max_accuracy_m). Audit staff.clock.place.';
revoke all on function app.set_clock_place(uuid, double precision, double precision, int, int) from public, anon;
grant execute on function app.set_clock_place(uuid, double precision, double precision, int, int) to authenticated;

create or replace function app.issue_station_clock_key(p_station_id text) returns jsonb
language plpgsql security definer set search_path = public as $issue_station_clock_key_0442$
declare
  v_venue  uuid;
  v_secret bytea := extensions.gen_random_bytes(20);
  v_id     text := upper(btrim(coalesce(p_station_id, '')));
  v_had    boolean;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select s.venue_id into v_venue from stations s where s.id = v_id and s.retired_at is null;
  if v_venue is null then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'station_id';
  end if;
  perform app.clock_mgmt_guard(v_venue);
  perform set_config('app.venue_id', v_venue::text, true);
  v_had := exists (select 1 from station_clock_keys k where k.station_id = v_id);
  insert into station_clock_keys (station_id, venue_id, secret, issued_by, issued_at)
  values (v_id, v_venue, v_secret, auth.uid(), now())
  on conflict (station_id) do update
     set venue_id = excluded.venue_id, secret = excluded.secret,
         issued_by = excluded.issued_by, issued_at = excluded.issued_at;
  perform app.write_audit('staff.clock.station_key', 'station_clock_keys', v_id,
                          case when v_had then jsonb_build_object('status', 'replaced') end,
                          jsonb_build_object('status', 'issued'));
  return jsonb_build_object('station_id', v_id, 'secret', encode(v_secret, 'hex'),
                            'step_seconds', 30, 'digits', 6, 'replaced', v_had);
end $issue_station_clock_key_0442$;
comment on function app.issue_station_clock_key(text) is
  '0442. A manager or the owner at the station''s branch issues the desk station a new clock secret (replacing any old one, whose QR stops working at once). Returns {station_id, secret (40 hex chars, shown this once), step_seconds: 30, digits: 6, replaced}. REF_NOT_FOUND (hint station_id: unknown or retired), FORBIDDEN. Audit staff.clock.station_key.';
revoke all on function app.issue_station_clock_key(text) from public, anon;
grant execute on function app.issue_station_clock_key(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Set hours: app.staff_shifts_get, app.set_staff_shifts.
-- ---------------------------------------------------------------------------
create or replace function app.staff_shifts_get(p_venue_id uuid, p_staff_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $staff_shifts_get_0442$
begin
  perform app.clock_mgmt_guard(p_venue_id);
  if not exists (select 1 from staff s where s.id = p_staff_id and s.role <> 'owner'
                   and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = p_venue_id)) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'staff_id';
  end if;
  return jsonb_build_object(
    'staff_id', p_staff_id,
    'roles', (select to_jsonb(array[s.role] || array(select distinct r from unnest(s.extra_roles) r
                                                       where r <> s.role order by r))
                from staff s where s.id = p_staff_id),
    'can_edit', app.is_staff('owner') or p_staff_id <> auth.uid(),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('weekday', sh.weekday,
                                                            'starts_at', to_char(sh.starts_at, 'HH24:MI'),
                                                            'ends_at', to_char(sh.ends_at, 'HH24:MI'),
                                                            'role', sh.role)
                                         order by sh.weekday, sh.starts_at)
                          from staff_shifts sh
                         where sh.staff_id = p_staff_id and sh.venue_id = p_venue_id), '[]'::jsonb));
end $staff_shifts_get_0442$;
comment on function app.staff_shifts_get(uuid, uuid) is
  '0442. A manager or the owner at the branch: a person''s set hours there: {staff_id, roles (main job first, then second jobs), can_edit, shifts: [{weekday 1..7, starts_at HH:MI, ends_at HH:MI, role}]}. REF_NOT_FOUND (hint staff_id), FORBIDDEN.';
revoke all on function app.staff_shifts_get(uuid, uuid) from public, anon;
grant execute on function app.staff_shifts_get(uuid, uuid) to authenticated;

create or replace function app.set_staff_shifts(p_venue_id uuid, p_staff_id uuid, p_shifts jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $set_staff_shifts_0442$
declare
  v_roles staff_role[];
  v_el    jsonb;
  v_wd    int;
  v_s     time;
  v_e     time;
  v_role  staff_role;
  v_n     int := 0;
begin
  perform app.clock_mgmt_guard(p_venue_id);
  select array[s.role] || s.extra_roles into v_roles
    from staff s
   where s.id = p_staff_id and s.is_active and s.role <> 'owner'
     and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = p_venue_id);
  if v_roles is null then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'staff_id';
  end if;
  if p_staff_id = auth.uid() and not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'staff_id';
  end if;
  if p_shifts is null or jsonb_typeof(p_shifts) <> 'array' or jsonb_array_length(p_shifts) > 42 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'shifts';
  end if;

  perform set_config('app.venue_id', p_venue_id::text, true);
  perform app.lock_wage(p_venue_id, p_staff_id);

  create temporary table if not exists pg_temp.clock_week (wd int, s time, e time, r staff_role) on commit drop;
  delete from pg_temp.clock_week where true;

  for v_el in select * from jsonb_array_elements(p_shifts) loop
    begin
      v_wd := (v_el ->> 'weekday')::int;
      v_s  := (v_el ->> 'starts_at')::time;
      v_e  := (v_el ->> 'ends_at')::time;
      v_role := nullif(v_el ->> 'role', '')::staff_role;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'shifts';
    end;
    if v_wd is null or v_wd not between 1 and 7 or v_s is null or v_e is null or v_s = v_e then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'shifts';
    end if;
    -- At most 16 hours.
    if (v_e - v_s + case when v_e <= v_s then interval '24 hours' else interval '0' end) > interval '16 hours' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'shift_length';
    end if;
    if v_role is not null and not (v_role = any(v_roles)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'role';
    end if;
    insert into pg_temp.clock_week values (v_wd, v_s, v_e, v_role);
    v_n := v_n + 1;
  end loop;

  -- No two shifts overlap on the week's circle (a Sunday night shift runs
  -- into Monday). Minutes from Monday 00:00; touching is fine.
  if exists (
    with w as (
      select (wd - 1) * 1440 + extract(epoch from s)::int / 60 as a,
             (wd - 1) * 1440 + extract(epoch from s)::int / 60
               + (extract(epoch from (e - s))::int / 60 + case when e <= s then 1440 else 0 end) as b
        from pg_temp.clock_week
    ), ww as (
      select row_number() over () as k, z.a, z.b
        from (select a, b from w union all select a + 10080, b + 10080 from w) z
    )
    select 1 from ww x join ww y on x.k < y.k
     where x.a < y.b and y.a < x.b
  ) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'overlap';
  end if;

  delete from staff_shifts where staff_id = p_staff_id and venue_id = p_venue_id;
  insert into staff_shifts (venue_id, staff_id, weekday, starts_at, ends_at, role, created_by)
  select p_venue_id, p_staff_id, wd, s, e, r, auth.uid() from pg_temp.clock_week;

  perform app.write_audit('staff.shifts.set', 'staff', p_staff_id::text, null,
                          jsonb_build_object('shifts', v_n, 'venue_id', p_venue_id));
  return jsonb_build_object('status', 'saved', 'shifts', v_n);
end $set_staff_shifts_0442$;
comment on function app.set_staff_shifts(uuid, uuid, jsonb) is
  '0442. The owner, or a manager for anyone but themselves, at the branch: replaces a person''s whole week of set hours there with p_shifts [{weekday 1..7, starts_at HH:MI, ends_at HH:MI (at or before the start = the next day), role (one of the person''s jobs, or null for the main job)}], at most 42, each at most 16 hours, none overlapping (touching is one block; a gap between two is time off). An empty array clears the week. Returns {status: saved, shifts}. REF_NOT_FOUND (hint staff_id: not active staff of the branch, or the owner), FORBIDDEN (hint staff_id: a manager''s own hours), INVALID_ARGUMENT (hint shifts, shift_length, role, overlap). Audit staff.shifts.set.';
revoke all on function app.set_staff_shifts(uuid, uuid, jsonb) from public, anon;
grant execute on function app.set_staff_shifts(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The day board and the phone reset (owner, managers).
-- ---------------------------------------------------------------------------
create or replace function app.clock_day(p_venue_id uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $clock_day_0442$
declare
  v_tz    text;
  v_today date;
  v_date  date;
  v_out   jsonb;
begin
  perform app.clock_mgmt_guard(p_venue_id);
  select coalesce(v.timezone, 'Asia/Baghdad') into v_tz from venues v where v.id = p_venue_id;
  v_today := (now() at time zone v_tz)::date;
  v_date  := coalesce(p_date, v_today);
  if v_date > v_today or v_date < v_today - 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'date';
  end if;

  with people as (
    select s.id, s.display_name, s.role
      from staff s
     where s.is_active and s.role <> 'owner' and s.id <> auth.uid()
       and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = p_venue_id)
  ), rows as (
    select p.id, p.display_name, p.role,
           app.clock_plan_json(p.id, p_venue_id, v_date) as shifts,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', e.id, 'kind', e.kind, 'status', e.status, 'refusal', e.refusal,
                       'at', e.at, 'late_minutes', e.late_minutes, 'early_minutes', e.early_minutes,
                       'distance_m', e.distance_m, 'accuracy_m', round(e.accuracy_m)::int,
                       'mocked', e.mocked, 'station_id', e.station_id)
                     order by e.at)
                       from staff_clock_events e
                      where e.staff_id = p.id and e.venue_id = p_venue_id
                        and (e.work_date = v_date
                             or (e.status = 'refused' and (e.at at time zone v_tz)::date = v_date))),
                    '[]'::jsonb) as events,
           (app.clock_open_in(p.id, p_venue_id)).at as in_since,
           (select jsonb_build_object('id', a.id, 'late_minutes', a.late_minutes,
                                      'early_leave_minutes', a.early_leave_minutes,
                                      'penalty_iqd', a.penalty_iqd, 'source', a.source)
              from staff_attendance a
             where a.venue_id = p_venue_id and a.staff_id = p.id and a.work_date = v_date) as attendance,
           exists (select 1 from staff_clock_devices d where d.staff_id = p.id) as device_bound
      from people p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'staff_id', r.id, 'display_name', r.display_name, 'role', r.role,
           'shifts', r.shifts, 'events', r.events, 'in_since', r.in_since,
           'attendance', r.attendance, 'device_bound', r.device_bound)
           order by r.display_name, r.id), '[]'::jsonb)
    into v_out
    from rows r
   where jsonb_array_length(r.shifts) > 0 or jsonb_array_length(r.events) > 0 or r.in_since is not null;

  return jsonb_build_object('date', v_date, 'today', v_today, 'now', now(), 'people', v_out);
end $clock_day_0442$;
comment on function app.clock_day(uuid, date) is
  '0442. A manager or the owner at the branch: one local day (default today, up to 60 days back) of logging in and out: {date, today, now, people: [{staff_id, display_name, role, shifts ([{starts, ends, role, block_starts, block_ends}]), events ([{id, kind, status, refusal, at, late_minutes, early_minutes, distance_m, accuracy_m, mocked, station_id}]: accepted ones counted against the day, refused ones made that day), in_since (an open log-in now), attendance ({id, late_minutes, early_leave_minutes, penalty_iqd, source} or null), device_bound}]} for everyone with hours, an attempt or an open log-in that day; never the caller. INVALID_ARGUMENT (hint date), FORBIDDEN.';
revoke all on function app.clock_day(uuid, date) from public, anon;
grant execute on function app.clock_day(uuid, date) to authenticated;

create or replace function app.clock_reset_device(p_venue_id uuid, p_staff_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $clock_reset_device_0442$
declare
  v_had boolean;
begin
  perform app.clock_mgmt_guard(p_venue_id);
  if p_staff_id is null or p_staff_id = auth.uid()
     or not exists (select 1 from staff s where s.id = p_staff_id and s.role <> 'owner'
                      and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = p_venue_id)) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'staff_id';
  end if;
  delete from staff_clock_devices where staff_id = p_staff_id;
  v_had := found;
  perform app.write_audit('staff.clock.device_reset', 'staff', p_staff_id::text,
                          jsonb_build_object('bound', v_had), jsonb_build_object('bound', false));
  return jsonb_build_object('status', 'reset', 'had_device', v_had);
end $clock_reset_device_0442$;
comment on function app.clock_reset_device(uuid, uuid) is
  '0442. A manager or the owner at the branch unbinds a person''s logging phone, so their next accepted scan binds the phone they use then. Never their own. Returns {status: reset, had_device}. REF_NOT_FOUND (hint staff_id), FORBIDDEN. Audit staff.clock.device_reset.';
revoke all on function app.clock_reset_device(uuid, uuid) from public, anon;
grant execute on function app.clock_reset_device(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Re-issued from 0271: record_attendance makes a day manual;
--     attendance_month shows each day's source.
-- ---------------------------------------------------------------------------
create or replace function app.record_attendance(
  p_staff_id            uuid,
  p_date                date,
  p_late_minutes        int,
  p_early_leave_minutes int,
  p_note                text default null,
  p_venue_id            uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $record_attendance_0442$
declare
  v_venue  uuid;
  v_today  date;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_old    staff_attendance%rowtype;
  v_row    staff_attendance%rowtype;
  v_grace  int;
  v_rule   bigint;
  v_found  boolean;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_today := app.venue_business_date(v_venue);
  if p_date is null or p_date > v_today or p_date < v_today - 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'date';
  end if;
  if p_late_minutes is null or p_late_minutes < 0 or p_late_minutes > 720 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'late_minutes';
  end if;
  if p_early_leave_minutes is null or p_early_leave_minutes < 0 or p_early_leave_minutes > 720 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'early_leave_minutes';
  end if;
  if p_late_minutes + p_early_leave_minutes = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'minutes';
  end if;
  if v_note is not null and length(v_note) > 300 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  if p_staff_id is null
     or p_staff_id = auth.uid()
     or not exists (select 1 from staff s
                     where s.id = p_staff_id and s.is_active and s.role <> 'owner'
                       and exists (select 1 from staff_venues sv
                                    where sv.staff_id = s.id and sv.venue_id = v_venue)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'staff_id';
  end if;

  perform app.lock_wage(v_venue, p_staff_id);

  select * into v_old
    from staff_attendance a
   where a.venue_id = v_venue and a.staff_id = p_staff_id and a.work_date = p_date
   for update;
  v_found := found;
  if v_found and app.wage_month_paid(v_venue, p_staff_id, v_old.pay_month) then
    raise exception 'WAGE_ALREADY_PAID' using errcode = 'P0001';
  end if;

  v_grace := coalesce(app.cafe_setting_int('attendance_grace_minutes', v_venue), 0);
  v_rule  := coalesce(app.cafe_setting_int('attendance_penalty_iqd', v_venue), 0);

  if v_found then
    update staff_attendance
       set late_minutes        = p_late_minutes,
           early_leave_minutes = p_early_leave_minutes,
           grace_minutes       = v_grace,
           penalty_rule_iqd    = v_rule,
           note                = v_note,
           recorded_by         = auth.uid(),
           recorded_at         = now(),
           source              = 'manual'
     where id = v_old.id
     returning * into v_row;
  else
    insert into staff_attendance (venue_id, staff_id, work_date, late_minutes, early_leave_minutes,
                                  grace_minutes, penalty_rule_iqd, pay_month, note, recorded_by, source)
    values (v_venue, p_staff_id, p_date, p_late_minutes, p_early_leave_minutes,
            v_grace, v_rule, app.wage_open_month(v_venue, p_staff_id, p_date), v_note, auth.uid(), 'manual')
    returning * into v_row;
  end if;

  perform app.write_audit('staff.attendance.record', 'staff_attendance', v_row.id::text,
                          case when v_found then jsonb_build_object('status', 'recorded', 'source', v_old.source) end,
                          jsonb_build_object('status', 'recorded'));

  return jsonb_build_object('id', v_row.id, 'penalty_iqd', v_row.penalty_iqd,
                            'pay_month', v_row.pay_month, 'replaced', v_found);
end $record_attendance_0442$;
comment on function app.record_attendance(uuid, date, int, int, text, uuid) is
  'wages (0271, 0442). A manager or the owner at the branch: records minutes late and minutes left early (each 0 to 720, not both 0) on a work day within the 60 days up to the branch''s business date, with an optional note (at most 300), for someone active at the branch but an owner and themselves. One row per person and day: recording the day again replaces it, unless its pay month is paid; a day the clock recorded becomes manual (0442) and the clock never changes it again. The branch''s rule (attendance_grace_minutes, attendance_penalty_iqd) is copied onto the row; a new row''s pay month is the day''s month, or the person''s next unpaid one. Returns {id, penalty_iqd, pay_month, replaced}. INVALID_ARGUMENT (hint date, late_minutes, early_leave_minutes, minutes), TEXT_TOO_LONG (hint note), FORBIDDEN (hint staff_id), WAGE_ALREADY_PAID. Audit staff.attendance.record {status}.';
revoke all on function app.record_attendance(uuid, date, int, int, text, uuid) from public, anon;
grant execute on function app.record_attendance(uuid, date, int, int, text, uuid) to authenticated;

create or replace function app.attendance_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $attendance_month_0442$
declare
  v_venue   uuid;
  v_today   date;
  v_current date;
  v_month   date;
  v_targets jsonb;
  v_people  jsonb;
  v_totals  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_today   := app.venue_business_date(v_venue);
  v_current := date_trunc('month', v_today)::date;
  v_month   := coalesce(date_trunc('month', p_month)::date, v_current);

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'role', s.role)
                            order by s.display_name, s.id), '[]'::jsonb)
    into v_targets
    from staff s
   where s.is_active and s.role <> 'owner' and s.id <> auth.uid()
     and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = v_venue);

  with days as (
    select a.*, r.display_name as recorded_by_name,
           app.wage_month_paid(a.venue_id, a.staff_id, a.pay_month) as locked
      from staff_attendance a
      left join staff r on r.id = a.recorded_by
     where a.venue_id = v_venue
       and a.staff_id is distinct from auth.uid()
       and a.work_date >= v_month
       and a.work_date < (v_month + interval '1 month')::date
  ), people as (
    select d.staff_id, s.display_name, s.role, s.is_active,
           count(*)                                   as days,
           count(*) filter (where d.penalty_iqd > 0)  as penalty_days,
           coalesce(sum(d.penalty_iqd), 0)            as penalties_iqd,
           coalesce(sum(d.late_minutes), 0)           as late_minutes,
           coalesce(sum(d.early_leave_minutes), 0)    as early_leave_minutes,
           jsonb_agg(jsonb_build_object(
             'id',                  d.id,
             'work_date',           d.work_date,
             'late_minutes',        d.late_minutes,
             'early_leave_minutes', d.early_leave_minutes,
             'grace_minutes',       d.grace_minutes,
             'penalty_rule_iqd',    d.penalty_rule_iqd,
             'penalty_iqd',         d.penalty_iqd,
             'pay_month',           d.pay_month,
             'locked',              d.locked,
             'note',                d.note,
             'recorded_by_name',    d.recorded_by_name,
             'recorded_at',         d.recorded_at,
             'source',              d.source)
             order by d.work_date, d.id) as days_list
      from days d
      join staff s on s.id = d.staff_id
     group by d.staff_id, s.display_name, s.role, s.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'staff_id',            p.staff_id,
           'display_name',        p.display_name,
           'role',                p.role,
           'is_active',           p.is_active,
           'day_count',           p.days,
           'penalty_days',        p.penalty_days,
           'penalties_iqd',       p.penalties_iqd,
           'late_minutes',        p.late_minutes,
           'early_leave_minutes', p.early_leave_minutes,
           'days',                p.days_list)
           order by p.display_name, p.staff_id), '[]'::jsonb),
         jsonb_build_object(
           'days',          coalesce(sum(p.days), 0),
           'penalty_days',  coalesce(sum(p.penalty_days), 0),
           'penalties_iqd', coalesce(sum(p.penalties_iqd), 0),
           'people',        count(*))
    into v_people, v_totals
    from people p;

  return jsonb_build_object(
    'month',         v_month,
    'current_month', v_current,
    'today',         v_today,
    'window_days',   60,
    'rule',          jsonb_build_object(
                       'grace_minutes', coalesce(app.cafe_setting_int('attendance_grace_minutes', v_venue), 0),
                       'penalty_iqd',   coalesce(app.cafe_setting_int('attendance_penalty_iqd', v_venue), 0)),
    'staff',         v_targets,
    'totals',        v_totals,
    'people',        v_people);
end $attendance_month_0442$;
comment on function app.attendance_month(uuid, date) is
  'wages (0271, 0442). A manager or the owner at the branch: {month, current_month, today, window_days, rule: {grace_minutes, penalty_iqd}, staff: [{id, display_name, role}] (who the caller may record a day for), totals: {days, penalty_days, penalties_iqd, people}, people: [{staff_id, display_name, role, is_active, day_count, penalty_days, penalties_iqd, late_minutes, early_leave_minutes, days: [{id, work_date, late_minutes, early_leave_minutes, grace_minutes, penalty_rule_iqd, penalty_iqd, pay_month, locked, note, recorded_by_name (null for a clock day), recorded_at, source (manual | clock, 0442)}]}]} for the work days of p_month (NULL: the branch''s current business month), never a day about the caller. locked: its pay month is paid. FORBIDDEN for anyone else.';
revoke all on function app.attendance_month(uuid, date) from public, anon;
grant execute on function app.attendance_month(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. The pages an owner can block (0384): the day board and set hours are
--     on Attendance and on the Staff page (admin); setup is admin's. The
--     phone's my_clock and clock_punch belong to no page: nobody's own
--     logging is ever blocked.
-- ---------------------------------------------------------------------------
insert into app.access_area_rpcs (area, rpc) values
  ('attendance', 'clock_day'), ('attendance', 'clock_reset_device'),
  ('attendance', 'staff_shifts_get'), ('attendance', 'set_staff_shifts'),
  ('admin', 'staff_shifts_get'), ('admin', 'set_staff_shifts'), ('admin', 'clock_reset_device'),
  ('admin', 'clock_setup'), ('admin', 'set_clock_place'), ('admin', 'issue_station_clock_key')
on conflict do nothing;
