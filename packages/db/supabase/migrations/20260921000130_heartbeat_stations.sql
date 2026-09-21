-- ===========================================================================
-- 0130 — the heartbeat files itself under a station, and the station under a
-- venue (Phase 2, milestone 1, slice 1).
--
-- WHAT WAS WRONG WITH FREE TEXT. device_heartbeats is keyed by whatever string
-- the till sends (0021), station_staff by whatever string a manager typed
-- (0105), and neither knew which building the device stands in. With one venue
-- that was merely untidy; with two it is unanswerable — "is the venue
-- degraded?" has no subject, and a till at Karrada could be assigned cover
-- from the other site by a typo.
--
-- 0124 gives the ids a home: stations(id, venue_id, is_till, retired_at). This
-- file makes the two writers that MINT ids keep that registry honest, and
-- nothing else. The other 41 RPCs that take a p_device_id are slice 3.
--
--   * app.heartbeat (0107 body VERBATIM) gains, after the DEVICE_REQUIRED
--     guard, a registry branch: a device id the registry has never seen — or
--     one that was retired and has come back, which 0118 explicitly designed
--     for — is validated against the station id shape (INVALID_STATION, the
--     code app.set_station_staff already raises and the operator already maps)
--     and then registered at app.resolve_venue().
--   * THE REFUSAL RULE IS "THE VENUE IS UNKNOWABLE", NOT "TWO VENUES EXIST"
--     (decision R2). resolve_venue is called with NO station argument — the
--     station is precisely what we do not have yet — and only a NULL answer
--     raises STATION_UNKNOWN. A cashier or a manager who belongs to exactly
--     one venue therefore registers a new till by plugging it in, exactly as
--     today; tests/degraded.test.ts, heartbeat-liveness.test.ts and
--     retire-device.test.ts all beat as that cashier and stay green the moment
--     venue B exists. The refusal is still provable: the owner belongs to
--     every venue, so with two of them active resolve_venue returns NULL and
--     an owner cannot register a station by accident.
--   * perform set_config('app.station_id', p_device_id, true) — transaction
--     local, so the rest of this call (and only this call) resolves its venue
--     from the device that is beating. The heartbeat row is written with that
--     venue explicitly rather than left to the column default, because the
--     row is an UPSERT and a device moved between venues must move with it.
--   * app.set_station_staff (0105:570-611 body VERBATIM) registers an unknown
--     station inside its existing foreach loop, after the regex check that is
--     already there, at app.current_venue() — the manager doing the assigning.
--     Without this the composite FK in 0133 (station_staff(station_id,
--     venue_id) -> stations) would refuse every assignment to a station that
--     has not beaten yet, which is the normal order of work: a manager sets
--     up the rota before the new till is switched on.
--
-- NOT CHANGED. is_till stays sticky (0026) in both the registry and the
-- heartbeat row; the 'TILL%' name prefix still makes a till, in the registry
-- too, so is_degraded keeps seeing what it saw. The two sweep calls, the
-- return shape and the grants are the 0107 ones. app.retire_device (0118)
-- still deletes the heartbeat row only — retiring the STATION is slice 3,
-- which is why retired_at exists here and nothing sets it yet.
--
-- covered by packages/db/tests/multi-venue.test.ts (case 10), and by the three
-- R2 canaries above.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.heartbeat — 0107 verbatim + the registry branch, the station GUC and
--    venue_id in the upsert.
-- ---------------------------------------------------------------------------
create or replace function app.heartbeat(
  p_device_id   text,
  p_queue_depth int default 0,
  p_app_version text default null,
  p_is_till     boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $fn_heartbeat_0130$
declare
  v_venue   uuid;
  v_is_till boolean;
begin
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id = '' then
    raise exception 'DEVICE_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0130: an id the registry does not hold as a live station. A retired row
  -- counts as absent on purpose (0118: "if it beats again it simply
  -- re-registers"), which is what the on-conflict clause below settles.
  if not exists (select 1 from stations where id = p_device_id and retired_at is null) then
    if p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
      raise exception 'INVALID_STATION' using errcode = 'P0001',
        hint = 'capitals, digits and dashes, starting with a letter';
    end if;
    -- No station argument: the station is what we are trying to learn. R2.
    v_venue := app.resolve_venue();
    if v_venue is null then
      raise exception 'STATION_UNKNOWN' using errcode = 'P0001',
        detail = p_device_id,
        hint = 'sign in as staff of the venue this device belongs to, or register the station first';
    end if;
    v_is_till := coalesce(p_is_till, false) or p_device_id like 'TILL%';
    insert into stations (id, venue_id, is_till, registered_by)
    values (p_device_id, v_venue, v_is_till, auth.uid())
    on conflict (id) do update
       set retired_at = null,
           is_till    = stations.is_till or excluded.is_till;
    perform app.write_audit('station.registered', 'stations', p_device_id,
                            null,
                            jsonb_build_object('venue_id', v_venue, 'is_till', v_is_till,
                                               'via', 'heartbeat'),
                            null, null, p_device_id);
  end if;

  -- Transaction-local: everything below this line, and every RPC that shares
  -- this transaction, resolves the venue from the device that is beating.
  perform set_config('app.station_id', p_device_id, true);

  -- Observe the venue as this beat FOUND it (0055): without this, a returning
  -- till erases the evidence of its own outage before anything records it.
  perform app.sweep_degraded_periods();

  insert into device_heartbeats (device_id, last_seen_at, queue_depth, app_version, is_till, staff_id, venue_id)
  values (p_device_id, now(), greatest(coalesce(p_queue_depth, 0), 0), p_app_version,
          coalesce(p_is_till, false), auth.uid(), app.current_venue(p_device_id))
  on conflict (device_id) do update
     set last_seen_at = excluded.last_seen_at,
         queue_depth  = excluded.queue_depth,
         app_version  = coalesce(excluded.app_version, device_heartbeats.app_version),
         -- Sticky (0026): once a device has identified as a till it stays one.
         is_till      = device_heartbeats.is_till or excluded.is_till,
         staff_id     = excluded.staff_id,
         -- 0130: a device that moved buildings moves its row with it.
         venue_id     = excluded.venue_id;

  -- ...and again now that it is fresh, so recovery closes the period above
  -- rather than waiting for whatever beats next.
  perform app.sweep_degraded_periods();

  return jsonb_build_object('degraded', app.is_degraded(), 'server_time', now());
end $fn_heartbeat_0130$;

revoke all on function app.heartbeat(text, int, text, boolean) from public, anon;
grant execute on function app.heartbeat(text, int, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.set_station_staff — 0105:570-611 verbatim + auto-registration inside
--    the loop that already validates each id.
-- ---------------------------------------------------------------------------
create or replace function app.set_station_staff(p_staff_id uuid, p_station_ids text[])
returns jsonb
language plpgsql security definer set search_path = public as $set_station_staff_0130$
declare
  v_ids    text[];
  v_before text[];
  v_id     text;
  v_venue  uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from staff where id = p_staff_id) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_ids
    from unnest(coalesce(p_station_ids, '{}')) as x;
  foreach v_id in array v_ids loop
    if v_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
      raise exception 'INVALID_STATION' using errcode = 'P0001',
        hint = 'capitals, digits and dashes, starting with a letter';
    end if;
    -- 0130: the rota is usually written before the till is switched on, so a
    -- station named here that the registry has never seen is registered at
    -- the venue of the manager doing the assigning. current_venue, not
    -- resolve_venue: a manager who cannot say which venue they mean must be
    -- told (VENUE_REQUIRED) rather than have a station filed somewhere.
    if not exists (select 1 from stations where id = v_id and retired_at is null) then
      v_venue := app.current_venue();
      insert into stations (id, venue_id, is_till, registered_by)
      values (v_id, v_venue, v_id like 'TILL%', auth.uid())
      on conflict (id) do update
         set retired_at = null,
             is_till    = stations.is_till or excluded.is_till;
      perform app.write_audit('station.registered', 'stations', v_id,
                              null,
                              jsonb_build_object('venue_id', v_venue, 'is_till', v_id like 'TILL%',
                                                 'via', 'set_station_staff'),
                              null, null, null);
    end if;
  end loop;

  select coalesce(array_agg(station_id order by station_id), '{}')
    into v_before
    from station_staff where staff_id = p_staff_id;

  delete from station_staff where staff_id = p_staff_id;
  insert into station_staff (station_id, staff_id, created_by)
  select x, p_staff_id, auth.uid() from unnest(v_ids) as x;

  if v_before is distinct from v_ids then
    perform app.write_audit('staff.stations_set', 'staff', p_staff_id::text,
                            jsonb_build_object('station_ids', to_jsonb(v_before)),
                            jsonb_build_object('station_ids', to_jsonb(v_ids)));
  end if;

  return jsonb_build_object('staff_id', p_staff_id, 'station_ids', to_jsonb(v_ids));
end $set_station_staff_0130$;

revoke all on function app.set_station_staff(uuid, text[]) from public, anon;
grant execute on function app.set_station_staff(uuid, text[]) to authenticated;
