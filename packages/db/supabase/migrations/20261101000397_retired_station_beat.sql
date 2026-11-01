set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0397 retired_station_beat — a retired station learns it was retired (Majed,
-- 2026-11-01, launch finding F-49: "a retired station loses all functions,
-- absolutely everything; nothing works until re-registered").
--
-- app.retire_station (0229) stamps stations.retired_at and drops the device's
-- heartbeat row; the machine itself was never told. Its next beat got the
-- same answer as the owner's office PC that was never registered
-- ({registered: false}), so it kept selling with nothing on its screen to say
-- otherwise. app.heartbeat now adds `retired: true` when the beating id names
-- a retired station; the operator (apps/operator/src/lib/stationRetired.ts)
-- replaces its whole screen with "This station was retired" until a manager
-- or the owner registers it again (app.register_station clears retired_at).
--
-- What this does NOT do: refuse writes that name a retired station. A retired
-- id is "not an assertion" for app.resolve_venue (0228), so a write from it
-- resolves through the switcher or the person's branch like any unregistered
-- machine's. The lockout is the operator's; a server wall is a later call.
--
-- F-48 rides on the same beat: the answer carries `idle_lock_seconds`, the
-- branch's till_idle_lock_seconds when one was set (else null). The owner sets
-- it on Settings › Cashier computers, but cafe_settings is readable by
-- managers and owners only, so a cashier's session never saw it and every
-- till ran the operator's built-in 15 minutes.
--
-- Signature, grants and the staff guard are unchanged (0156/0229), so the RPC
-- registry, the authz gate and the rls-matrix row stand as they are.
--
-- covered by packages/db/tests/retired-station.test.ts

-- heartbeat: re-issued from 20260926000229_stations_on_purpose.sql:73, two additions (the
-- 'retired' key on the not-a-live-station answer, 'idle_lock_seconds' on every answer).
create or replace function app.heartbeat(p_device_id text, p_queue_depth integer default 0, p_app_version text default null, p_is_till boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $heartbeat_0397$
declare
  v_station stations%rowtype;
  v_lock    int;
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

  -- 0397 (F-48): the idle-lock timeout the owner set for the branch this
  -- session works for, so every staff session gets it: cafe_settings is
  -- readable by managers and owners only, and a cashier's till ran the client
  -- default whatever the owner chose. NULL when the branch never set it (the
  -- client keeps its default). A live station's own branch; anything else, the
  -- branch the caller resolves to (never another branch's station).
  select case when jsonb_typeof(cs.value) = 'number' then (cs.value #>> '{}')::numeric::int end
    into v_lock
    from cafe_settings cs
   where cs.key = 'till_idle_lock_seconds'
     and cs.venue_id = case
           when v_station.id is not null
            and app.is_staff_at(v_station.venue_id, variadic enum_range(null::staff_role))
           then v_station.venue_id
           else app.resolve_venue()
         end;

  if v_station.id is null then
    -- 0397 (F-49): say whether the machine is a RETIRED station, so it can
    -- stop trading on its own screen until it is registered again.
    return jsonb_build_object('registered', false,
                              'retired', exists (select 1 from stations
                                                  where id = p_device_id and retired_at is not null),
                              'idle_lock_seconds', v_lock,
                              'degraded', app.is_degraded(), 'server_time', now());
  end if;
  -- ...for staff of its own branch only.
  if not app.is_staff_at(v_station.venue_id, variadic enum_range(null::staff_role)) then
    return jsonb_build_object('registered', false, 'other_branch', true,
                              'idle_lock_seconds', v_lock,
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
                            'idle_lock_seconds', v_lock, 'server_time', now());
end
$heartbeat_0397$;

comment on function app.heartbeat(text, int, text, boolean) is
  'Station heartbeat (SOW L666). A live, registered station of the caller''s branch records its beat and sweeps that branch''s degraded period; anything else is a no-op answering {registered: false}, with retired: true when the id is a retired station (0397, F-49). Every answer carries idle_lock_seconds, the branch''s till_idle_lock_seconds or null when never set (0397, F-48). Staff only.';
