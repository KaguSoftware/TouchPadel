set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0222_venue_status_and_stations — multi-venue slice 4 (server), step 1.
--
-- (a) Venue status (plan MV4). A branch is 'preparing' (created by the owner,
--     being set up: staff, tills, menu, hours, rates; invisible to guests),
--     'open' (trading) or 'closed' (never deleted, slice-1 R6). venues.is_active
--     keeps its meaning for every guest-facing reader: open to guests. A trigger
--     keeps the two in step both ways (a write to is_active, as the test suite's
--     venue-B probe does, moves status too).
--     Staff visibility moves from is_active to "not closed", so the owner and a
--     preparing branch's members can work in it before it opens:
--       staff_venue_ids (0123), is_staff_at (0139) and steps 1-3 of
--       resolve_venue (0215) accept a preparing branch; step 4 (the only open
--       venue) and default_venue() stay on is_active, so a guest write never
--       resolves to a branch that is not open.
--
-- (b) Stations get registered on purpose. Until now a station existed once its
--     first heartbeat auto-registered it (0130), and the id was free text typed
--     on the machine. stations gains mode (till | desk | kds);
--     app.register_station(p_id, p_venue_id, p_mode) lets a manager or owner at
--     the branch register or re-register one, and app.retire_station(p_id)
--     retires it (the registry row stays, stamped; its heartbeat row goes, as
--     retire_device did). The Devices screen (slice 4 operator) calls both.

-- ---------------------------------------------------------------------------
-- 1. venues.status
-- ---------------------------------------------------------------------------
do $venue_status_type$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'venue_status' and n.nspname = 'public') then
    create type venue_status as enum ('preparing', 'open', 'closed');
  end if;
end
$venue_status_type$;

alter table venues add column if not exists status venue_status not null default 'open';

update venues set status = case when is_active then 'open'::venue_status else 'closed'::venue_status end
 where status is distinct from (case when is_active then 'open'::venue_status else 'closed'::venue_status end);

comment on column venues.status is
  '0222 (MV4). preparing: created by the owner, being set up, invisible to guests; open: trading (is_active true); closed: stopped, never deleted. Kept in step with is_active by trg_venue_status_sync.';
comment on column venues.is_active is
  '0122; since 0222 exactly status = ''open'' (kept in step by trg_venue_status_sync). Every guest-facing read filters on it.';

create or replace function app.trg_venue_status_sync() returns trigger
language plpgsql security definer set search_path = public as $trg_venue_status_sync_0222$
begin
  if tg_op = 'INSERT' then
    -- status defaults to 'open'; an insert that says is_active = false (an old
    -- script, a fixture) means a closed venue. An explicit other status wins.
    if new.status = 'open' and new.is_active is false then
      new.status := 'closed';
    end if;
    new.is_active := (new.status = 'open');
  elsif new.is_active is distinct from old.is_active
        and new.status is not distinct from old.status then
    -- A direct write to is_active (the test suite's venue-B probe, an old script).
    new.status := case when new.is_active then 'open'::venue_status else 'closed'::venue_status end;
  else
    new.is_active := (new.status = 'open');
  end if;
  return new;
end
$trg_venue_status_sync_0222$;

revoke all on function app.trg_venue_status_sync() from public, anon, authenticated;

drop trigger if exists venues_status_sync on venues;
create trigger venues_status_sync
  before insert or update of status, is_active on venues
  for each row execute function app.trg_venue_status_sync();

-- ---------------------------------------------------------------------------
-- 2. Staff see and work in every branch that is not closed
-- ---------------------------------------------------------------------------

-- staff_venue_ids: re-issued from 20260921000123_staff_venues.sql:131
create or replace function app.staff_venue_ids() returns uuid[]
language sql stable security definer set search_path = public as $staff_venue_ids_0222$
  select case
    when app.is_staff('owner') then
      coalesce((select array_agg(v.id order by v.created_at, v.id)
                  from venues v
                 where v.status <> 'closed'), '{}'::uuid[])
    else
      coalesce((select array_agg(sv.venue_id order by sv.venue_id)
                  from staff_venues sv
                  join venues v on v.id = sv.venue_id and v.status <> 'closed'
                 where sv.staff_id = auth.uid()), '{}'::uuid[])
  end
$staff_venue_ids_0222$;

-- is_staff_at: re-issued from 20260921000139_venue_axis_fixes.sql:269
create or replace function app.is_staff_at(p_venue uuid, variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $is_staff_at_0222$
  select case
    when not app.is_staff(variadic roles) then false
    when app.is_staff('owner') then true
    else exists (select 1
                   from staff_venues sv
                   join venues v on v.id = sv.venue_id and v.status <> 'closed'
                  where sv.staff_id = auth.uid()
                    and sv.venue_id = p_venue)
  end
$is_staff_at_0222$;

-- resolve_venue: re-issued from 20260926000215_station_header_venue.sql:32
create or replace function app.resolve_venue(p_station_id text default null) returns uuid
language plpgsql stable security definer set search_path = public as $resolve_venue_0222$
declare
  v_station text;
  v_raw     text;
  v_cast    uuid;
  v_venue   uuid;
  v_count   int;
  v_hdr     text;
begin
  -- (1) the asserted station.
  v_station := nullif(coalesce(p_station_id, current_setting('app.station_id', true)), '');
  if v_station is not null then
    select s.venue_id into v_venue
      from stations s
      join venues v on v.id = s.venue_id and v.status <> 'closed'
     where s.id = v_station
       and s.retired_at is null;
    if v_venue is not null then
      return v_venue;
    end if;
  end if;

  -- (2) the asserted venue. A GUC is text, so a malformed value must degrade to
  -- "not asserted" rather than blow up a guest insert.
  v_raw := nullif(current_setting('app.venue_id', true), '');
  if v_raw is not null then
    begin
      v_cast := v_raw::uuid;
    exception when invalid_text_representation then
      v_cast := null;
    end;
    if v_cast is not null then
      select v.id into v_venue from venues v where v.id = v_cast and v.status <> 'closed';
      if v_venue is not null then
        return v_venue;
      end if;
    end if;
  end if;

  -- (2b) 0215: the station the operator names on every request (x-station-id,
  -- exposed by PostgREST in request.headers). Counted only for the owner or a
  -- member of that station's branch.
  begin
    v_hdr := nullif(btrim(nullif(current_setting('request.headers', true), '')::json ->> 'x-station-id'), '');
  exception when others then
    v_hdr := null;
  end;
  if v_hdr is not null and auth.uid() is not null then
    select s.venue_id into v_venue
      from stations s
      join venues v on v.id = s.venue_id and v.status <> 'closed'
     where s.id = v_hdr
       and s.retired_at is null;
    if v_venue is not null
       and (app.is_staff('owner')
            or exists (select 1 from staff_venues sv
                        where sv.staff_id = auth.uid() and sv.venue_id = v_venue)) then
      return v_venue;
    end if;
    v_venue := null;
  end if;

  -- (3) the caller's memberships. Exactly one is an answer; more than one is an
  -- ambiguity the caller has to resolve, so stop here rather than fall through
  -- to (4) and pick the oldest venue for a manager who works at two.
  if auth.uid() is not null then
    select count(*), min(sv.venue_id::text)::uuid into v_count, v_venue
      from staff_venues sv
      join venues v on v.id = sv.venue_id and v.status <> 'closed'
     where sv.staff_id = auth.uid();
    if v_count = 1 then
      return v_venue;
    end if;
    if v_count > 1 then
      return null;
    end if;
  end if;

  -- (4) one active venue in the database: production, all of slice 1.
  select count(*), min(v.id::text)::uuid into v_count, v_venue
    from venues v
   where v.is_active;
  if v_count = 1 then
    return v_venue;
  end if;

  return null;
end
$resolve_venue_0222$;

-- ---------------------------------------------------------------------------
-- 3. Stations: mode, register, retire
-- ---------------------------------------------------------------------------
alter table stations add column if not exists mode text;

do $stations_mode$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'stations_mode_chk' and conrelid = 'stations'::regclass) then
    alter table stations add constraint stations_mode_chk
      check (mode is null or mode in ('till', 'desk', 'kds')) not valid;
  end if;
end
$stations_mode$;
alter table stations validate constraint stations_mode_chk;

comment on column stations.mode is
  '0222. What the machine is: till, desk or kds, as registered by app.register_station. NULL for a station that only ever registered itself by heartbeat (0130).';

create or replace function app.register_station(p_id text, p_venue_id uuid, p_mode text)
returns stations
language plpgsql security definer set search_path = public as $register_station_0222$
declare
  v_id  text := upper(btrim(coalesce(p_id, '')));
  v_old stations%rowtype;
  v_row stations%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is null or not app.is_staff_at(p_venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('till', 'desk', 'kds') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_mode';
  end if;

  select * into v_old from stations where id = v_id for update;
  if found and v_old.retired_at is null and v_old.venue_id <> p_venue_id then
    raise exception 'STATION_OTHER_BRANCH' using errcode = 'P0001',
      hint = 'this station name is in use at another branch; retire it there first or pick another name';
  end if;

  perform set_config('app.venue_id', p_venue_id::text, true);
  insert into stations (id, venue_id, is_till, registered_by, mode)
  values (v_id, p_venue_id, p_mode = 'till', auth.uid(), p_mode)
  on conflict (id) do update
     set venue_id      = excluded.venue_id,
         is_till       = excluded.is_till,
         mode          = excluded.mode,
         registered_by = excluded.registered_by,
         registered_at = now(),
         retired_at    = null
  returning * into v_row;

  perform app.write_audit('station.register', 'stations', v_id,
                          case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_row));
  return v_row;
end $register_station_0222$;

comment on function app.register_station(text, uuid, text) is
  '0222. Manager or owner at the branch: register (or re-register, or un-retire) a station there with its mode (till, desk, kds). A live station name at another branch is STATION_OTHER_BRANCH. Audited as station.register.';

revoke all on function app.register_station(text, uuid, text) from public, anon;
grant execute on function app.register_station(text, uuid, text) to authenticated;

create or replace function app.retire_station(p_id text)
returns stations
language plpgsql security definer set search_path = public as $retire_station_0222$
declare
  v_old stations%rowtype;
  v_row stations%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_old from stations where id = upper(btrim(coalesce(p_id, ''))) for update;
  if not found then
    raise exception 'STATION_UNKNOWN' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_old.venue_id, 'manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_old.venue_id::text, true);

  update stations set retired_at = coalesce(retired_at, now())
   where id = v_old.id
  returning * into v_row;
  -- Its heartbeat goes too (the 0118 retire_device behaviour), so it stops
  -- counting towards degraded mode and the day close's unsynced check.
  delete from device_heartbeats where device_id = v_old.id;

  perform app.write_audit('station.retire', 'stations', v_old.id, to_jsonb(v_old), to_jsonb(v_row));
  return v_row;
end $retire_station_0222$;

comment on function app.retire_station(text) is
  '0222. Manager or owner at the station''s branch: retire it (the registry row stays, stamped retired_at; its heartbeat row is deleted). A retired station name can be registered again. Audited as station.retire.';

revoke all on function app.retire_station(text) from public, anon;
grant execute on function app.retire_station(text) to authenticated;

