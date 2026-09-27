set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0229 (multi-venue audit, 2026-09-26; decision A1): a station is registered
-- on purpose only.
--
--   * app.heartbeat no longer registers or un-retires a machine. It used to
--     file every machine that beat, the owner's office PC included, as a
--     station of whichever branch resolved; a registered machine loses the
--     branch switcher, and a retired station came back on its next beat. A
--     machine that is not a live station now beats as a no-op and is told so
--     ({registered: false}); a till is registered in Settings > Venue details >
--     Stations (app.register_station).
--   * A live station beats only for staff of its own branch. A staffer at
--     another branch could keep a dead till "fresh" (hiding degraded mode),
--     overwrite its staff_id (breaking till shifts) or set its queue depth
--     (blocking or unblocking close_day).
--   * The beat sweeps only its own branch (app.sweep_degraded_period); the
--     minute cron still sweeps every branch, and now also ends a period left
--     open at a branch that is no longer open.
--   * The device_heartbeats trigger (0131) no longer registers or un-retires.
--   * register_station: an advisory lock on the id closes the first-register
--     race; moving a retired station to another branch clears its rota and is
--     refused with STATION_HAS_HISTORY once it has till shifts (their composite
--     FK pins the branch); a desk or kitchen screen drops the sticky till flag.
--   * retire_station clears the station's rota.
--   * set_station_staff works inside one branch: the caller manages it, the
--     staffer works there, and only that branch's rota rows are replaced. A
--     retired or other-branch station is refused instead of revived or moved.

-- One branch's degraded period, opened or closed to match its tills now.
create or replace function app.sweep_degraded_period(p_venue uuid) returns void
language plpgsql security definer set search_path = public as $sweep_degraded_period_0229$
begin
  if p_venue is null then
    return;
  end if;
  if exists (select 1 from venues where id = p_venue and is_active) and app.is_degraded(p_venue) then
    if not exists (select 1 from degraded_periods
                    where ended_at is null and venue_id = p_venue) then
      insert into degraded_periods (started_at, detected_by, venue_id)
      values (now(), 'heartbeat_timeout', p_venue);
    end if;
  else
    update degraded_periods set ended_at = now()
     where ended_at is null and venue_id = p_venue;
  end if;
end
$sweep_degraded_period_0229$;

comment on function app.sweep_degraded_period(uuid) is
  '0229. Opens or ends one branch''s degraded period to match its tills now; a branch that is not open has none. Internal (heartbeat, cron).';

revoke all on function app.sweep_degraded_period(uuid) from public, anon, authenticated;

-- sweep_degraded_periods: re-issued from 20260921000139_venue_axis_fixes.sql
create or replace function app.sweep_degraded_periods() returns void
language plpgsql security definer set search_path = public as $sweep_degraded_periods_0229$
declare
  v_venue uuid;
begin
  for v_venue in select id from venues where is_active order by created_at, id loop
    perform app.sweep_degraded_period(v_venue);
  end loop;
  -- 0229: a branch that stopped being open ends its period here.
  update degraded_periods d set ended_at = now()
   where d.ended_at is null
     and exists (select 1 from venues v where v.id = d.venue_id and not v.is_active);
end
$sweep_degraded_periods_0229$;

-- heartbeat: re-issued from 20260923000156_new_roles_access.sql:365
create or replace function app.heartbeat(p_device_id text, p_queue_depth integer default 0, p_app_version text default null, p_is_till boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $heartbeat_0229$
declare
  v_station stations%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id = '' then
    raise exception 'DEVICE_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0229 (A1): only a live station beats. Anything else (the owner's office
  -- PC, a till not registered yet, a retired station) is a no-op that says so.
  select * into v_station from stations where id = p_device_id and retired_at is null;
  if not found then
    return jsonb_build_object('registered', false, 'degraded', app.is_degraded(), 'server_time', now());
  end if;
  -- ...for staff of its own branch only.
  if not app.is_staff_at(v_station.venue_id, variadic enum_range(null::staff_role)) then
    return jsonb_build_object('registered', false, 'other_branch', true,
                              'degraded', app.is_degraded(), 'server_time', now());
  end if;

  -- Transaction-local: everything below this line, and every RPC that shares
  -- this transaction, resolves the venue from the device that is beating.
  perform set_config('app.station_id', p_device_id, true);

  -- Observe the branch as this beat FOUND it (0055): without this, a returning
  -- till erases the evidence of its own outage before anything records it.
  perform app.sweep_degraded_period(v_station.venue_id);

  insert into device_heartbeats (device_id, last_seen_at, queue_depth, app_version, is_till, staff_id, venue_id)
  values (p_device_id, now(), greatest(coalesce(p_queue_depth, 0), 0), p_app_version,
          coalesce(p_is_till, false) and v_station.mode is distinct from 'desk' and v_station.mode is distinct from 'kds',
          auth.uid(), v_station.venue_id)
  on conflict (device_id) do update
     set last_seen_at = excluded.last_seen_at,
         queue_depth  = excluded.queue_depth,
         app_version  = coalesce(excluded.app_version, device_heartbeats.app_version),
         -- Sticky (0026): once a device has identified as a till it stays one
         -- (register_station as a desk or kitchen screen clears it, 0229).
         is_till      = device_heartbeats.is_till or excluded.is_till,
         staff_id     = excluded.staff_id,
         venue_id     = excluded.venue_id;

  -- ...and again now that it is fresh, so recovery closes the period above
  -- rather than waiting for the cron.
  perform app.sweep_degraded_period(v_station.venue_id);

  return jsonb_build_object('registered', true, 'degraded', app.is_degraded(v_station.venue_id),
                            'server_time', now());
end
$heartbeat_0229$;

-- trg_device_heartbeats_station: re-issued from 20260921000131_station_fks.sql.
-- A heartbeat row belongs to a live station and takes its branch; it never
-- registers or revives one (0229).
create or replace function app.trg_device_heartbeats_station() returns trigger
language plpgsql security definer set search_path = public as $trg_device_heartbeats_station_0229$
declare
  v_venue uuid;
begin
  select s.venue_id into v_venue from stations s where s.id = new.device_id and s.retired_at is null;
  if v_venue is null then
    raise exception 'STATION_UNKNOWN' using errcode = 'P0001', detail = new.device_id,
      hint = 'register the station first (app.register_station)';
  end if;
  new.venue_id := v_venue;
  return new;
end
$trg_device_heartbeats_station_0229$;

-- register_station: re-issued from 20260926000222_venue_status_and_stations.sql:218
create or replace function app.register_station(p_id text, p_venue_id uuid, p_mode text)
returns stations
language plpgsql security definer set search_path = public as $register_station_0229$
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

  -- 0229: FOR UPDATE locks nothing while the row does not exist yet; two first
  -- registrations of one name at two branches meet here instead.
  perform pg_advisory_xact_lock(hashtextextended('station:' || v_id, 0));

  select * into v_old from stations where id = v_id for update;
  if found and v_old.retired_at is null and v_old.venue_id <> p_venue_id then
    raise exception 'STATION_OTHER_BRANCH' using errcode = 'P0001',
      hint = 'this station name is in use at another branch; retire it there first or pick another name';
  end if;
  if found and v_old.venue_id <> p_venue_id then
    -- A retired name moving branch: its till shifts pin it where it was.
    if exists (select 1 from till_shifts t where t.station_id = v_id) then
      raise exception 'STATION_HAS_HISTORY' using errcode = 'P0001',
        hint = 'this station name has till shifts at another branch; pick another name';
    end if;
    delete from station_staff where station_id = v_id;
    delete from device_heartbeats where device_id = v_id;
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

  -- A desk or kitchen screen is not a till, whatever it said when it beat.
  if p_mode <> 'till' then
    update device_heartbeats set is_till = false where device_id = v_id and is_till;
  end if;

  perform app.write_audit('station.register', 'stations', v_id,
                          case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_row));
  return v_row;
end
$register_station_0229$;

-- retire_station: re-issued from 20260926000222_venue_status_and_stations.sql:265
create or replace function app.retire_station(p_id text) returns stations
language plpgsql security definer set search_path = public as $retire_station_0229$
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
  -- counting towards degraded mode and the day close's unsynced check; and its
  -- rota (0229), so nobody is assigned to a station that is gone.
  delete from device_heartbeats where device_id = v_old.id;
  delete from station_staff where station_id = v_old.id;

  perform app.write_audit('station.retire', 'stations', v_old.id, to_jsonb(v_old), to_jsonb(v_row));
  return v_row;
end
$retire_station_0229$;

-- set_station_staff: re-issued from 20260921000139_venue_axis_fixes.sql:303
create or replace function app.set_station_staff(p_staff_id uuid, p_station_ids text[]) returns jsonb
language plpgsql security definer set search_path = public as $set_station_staff_0229$
declare
  v_ids    text[];
  v_before text[];
  v_id     text;
  v_venue  uuid;
  v_st     stations%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0139: the venue guard is the second statement, before any write.
  v_venue := app.current_venue();
  -- 0229: the caller manages that branch, and the staffer works there.
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from staff where id = p_staff_id) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from staff_venues sv where sv.staff_id = p_staff_id and sv.venue_id = v_venue)
     and not exists (select 1 from staff s where s.id = p_staff_id and s.role = 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001',
      hint = 'this person does not work at this branch';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_ids
    from unnest(coalesce(p_station_ids, '{}')) as x;
  foreach v_id in array v_ids loop
    if v_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
      raise exception 'INVALID_STATION' using errcode = 'P0001',
        hint = 'capitals, digits and dashes, starting with a letter';
    end if;
    select * into v_st from stations where id = v_id;
    if not found then
      -- 0130: the rota is usually written before the till is switched on, so a
      -- name the registry has never seen is registered at this branch.
      insert into stations (id, venue_id, is_till, registered_by)
      values (v_id, v_venue, v_id like 'TILL%', auth.uid());
      perform app.write_audit('station.registered', 'stations', v_id,
                              null,
                              jsonb_build_object('venue_id', v_venue, 'is_till', v_id like 'TILL%',
                                                 'via', 'set_station_staff'),
                              null, null, null);
    elsif v_st.retired_at is not null then
      -- 0229: a retired station stays retired; registering it again is on purpose.
      raise exception 'STATION_RETIRED' using errcode = 'P0001', detail = v_id;
    elsif v_st.venue_id <> v_venue then
      raise exception 'STATION_OTHER_BRANCH' using errcode = 'P0001', detail = v_id;
    end if;
  end loop;

  select coalesce(array_agg(station_id order by station_id), '{}')
    into v_before
    from station_staff where staff_id = p_staff_id and venue_id = v_venue;

  delete from station_staff where staff_id = p_staff_id and venue_id = v_venue;
  insert into station_staff (station_id, staff_id, created_by, venue_id)
  select x, p_staff_id, auth.uid(), v_venue from unnest(v_ids) as x;

  if v_before is distinct from v_ids then
    perform app.write_audit('staff.stations_set', 'staff', p_staff_id::text,
                            jsonb_build_object('station_ids', to_jsonb(v_before)),
                            jsonb_build_object('station_ids', to_jsonb(v_ids)));
  end if;

  return jsonb_build_object('staff_id', p_staff_id, 'station_ids', to_jsonb(v_ids));
end
$set_station_staff_0229$;
