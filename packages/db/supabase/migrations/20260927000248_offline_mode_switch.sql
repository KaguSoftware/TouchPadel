set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0248_offline_mode_switch — the owner can switch offline (degraded) mode off
-- for a branch.
--
-- Owner, 2026-09-27: "I want the venue to be always on." With the switch off,
-- app.is_degraded(branch) is false whatever the tills report, so no app shows
-- "Venue offline mode" and guests book and order online at all times. The
-- cost is the protection itself: a till that really loses the server can take
-- desk bookings the server does not know about, and a guest may book the same
-- slot online meanwhile; the till's replay then meets it as a conflict.
--
-- venue_settings.offline_mode_enabled, per branch, default FALSE (the owner's
-- choice for every branch, new ones included). Settings > Venue details >
-- Offline mode turns it back on through app.set_venue_details, the owner-only
-- allowlisted writer that already carries the two offline thresholds (0118).

alter table venue_settings
  add column if not exists offline_mode_enabled boolean not null default false;

comment on column venue_settings.offline_mode_enabled is
  '0248. Offline (degraded) mode for this branch. False: app.is_degraded is always false (the owner''s default). Owner-writable via app.set_venue_details.';

-- is_degraded: re-issued from 20260927000247_degraded_only_while_trading.sql:33
create or replace function app.is_degraded(p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $is_degraded_0248$
  -- 0248: only where the owner has offline mode switched on.
  select coalesce((select offline_mode_enabled from venue_settings where venue_id = p_venue), false)
     and exists (select 1 from device_heartbeats
                  where venue_id = p_venue
                    and (is_till or device_id like 'TILL%'))
     and not exists (
       select 1 from device_heartbeats
        where venue_id = p_venue
          and (is_till or device_id like 'TILL%')
          and last_seen_at > now() - make_interval(
                secs => coalesce(
                  (select heartbeat_stale_seconds from venue_settings where venue_id = p_venue),
                  45))
     )
     -- 0247: only while the branch trades.
     and exists (select 1 from day_sessions
                  where venue_id = p_venue
                    and status in ('open', 'closing'))
$is_degraded_0248$;

comment on function app.is_degraded(uuid) is
  '0137, 0212, 0247, 0248. True while the branch has offline mode on, has an open business day, has a till, and no till has beaten inside heartbeat_stale_seconds.';

revoke all on function app.is_degraded(uuid) from public;
grant execute on function app.is_degraded(uuid) to anon, authenticated;

-- set_venue_details: re-issued from 20260926000208_venue_settings_per_venue.sql:205
-- with the offline_mode_enabled key.
create or replace function app.set_venue_details(p_patch jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_venue_details_0248$
declare
  v_allowed text[] := array['venue_name','phone','hold_ttl_seconds','cancellation_window_hours',
                            'max_booking_horizon_days','max_live_holds_per_guest',
                            -- 0118 (C2): the degraded-mode thresholds, owner-writable at last.
                            'heartbeat_stale_seconds','protected_horizon_hours',
                            -- 0208: the branch's Arabic name and public address (venues).
                            'venue_name_ar','address_en','address_ar','map_url',
                            -- 0248: offline mode on or off.
                            'offline_mode_enabled'];
  v_venue   uuid;
  v_key     text;
  v_before  jsonb;
  v_after   jsonb;
  v_name    text;
  v_name_ar text;
  v_phone   text;
  v_addr_en text;
  v_addr_ar text;
  v_map     text;
  v_int     int;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key,
        hint = 'only contact details and booking rules can be changed';
    end if;
  end loop;

  -- Validate everything before writing anything.
  if p_patch ? 'venue_name' then
    v_name := btrim(p_patch->>'venue_name');
    if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'venue_name';
    end if;
  end if;
  if p_patch ? 'venue_name_ar' then
    v_name_ar := btrim(p_patch->>'venue_name_ar');
    if v_name_ar is null or char_length(v_name_ar) < 2 or char_length(v_name_ar) > 80 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'venue_name_ar';
    end if;
  end if;
  if p_patch ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_patch->>'phone', '')), '');
    if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,20}$' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'phone';
    end if;
  end if;
  if p_patch ? 'address_en' then
    v_addr_en := nullif(btrim(coalesce(p_patch->>'address_en', '')), '');
    if v_addr_en is not null and char_length(v_addr_en) not between 2 and 200 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'address_en';
    end if;
  end if;
  if p_patch ? 'address_ar' then
    v_addr_ar := nullif(btrim(coalesce(p_patch->>'address_ar', '')), '');
    if v_addr_ar is not null and char_length(v_addr_ar) not between 2 and 200 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'address_ar';
    end if;
  end if;
  if p_patch ? 'map_url' then
    v_map := nullif(btrim(coalesce(p_patch->>'map_url', '')), '');
    if v_map is not null and (v_map !~ '^https://' or char_length(v_map) > 500) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'map_url';
    end if;
  end if;
  if p_patch ? 'hold_ttl_seconds' then
    v_int := app.venue_patch_int(p_patch, 'hold_ttl_seconds', 60, 3600);
  end if;
  if p_patch ? 'cancellation_window_hours' then
    v_int := app.venue_patch_int(p_patch, 'cancellation_window_hours', 0, 168);
  end if;
  if p_patch ? 'max_booking_horizon_days' then
    v_int := app.venue_patch_int(p_patch, 'max_booking_horizon_days', 0, 730);
  end if;
  if p_patch ? 'heartbeat_stale_seconds' then
    -- 0118: the till beats every 10 s (apps/operator/src/lib/heartbeat.ts); below
    -- 15 s a single dropped beat would trip degraded mode, above 10 minutes a
    -- dead till trades on paper for too long.
    v_int := app.venue_patch_int(p_patch, 'heartbeat_stale_seconds', 15, 600);
  end if;
  if p_patch ? 'protected_horizon_hours' then
    v_int := app.venue_patch_int(p_patch, 'protected_horizon_hours', 0, 168);
  end if;
  if p_patch ? 'max_live_holds_per_guest' then
    v_int := app.venue_patch_int(p_patch, 'max_live_holds_per_guest', 1, 10);
  end if;
  if p_patch ? 'offline_mode_enabled' and jsonb_typeof(p_patch->'offline_mode_enabled') <> 'boolean' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'offline_mode_enabled';
  end if;

  perform set_config('app.venue_id', v_venue::text, true);

  select jsonb_build_object(
           'venue_name', vs.venue_name, 'venue_name_ar', v.name_ar, 'phone', vs.phone,
           'address_en', v.address_en, 'address_ar', v.address_ar, 'map_url', v.map_url,
           'hold_ttl_seconds', vs.hold_ttl_seconds,
           'cancellation_window_hours', vs.cancellation_window_hours,
           'max_booking_horizon_days', vs.max_booking_horizon_days,
           'max_live_holds_per_guest', (select ps.max_live_holds_per_guest from platform_settings ps where ps.id),
           'heartbeat_stale_seconds', vs.heartbeat_stale_seconds,
           'protected_horizon_hours', vs.protected_horizon_hours,
           'offline_mode_enabled', vs.offline_mode_enabled)
    into v_before
    from venue_settings vs join venues v on v.id = vs.venue_id
   where vs.venue_id = v_venue;
  if v_before is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  update venue_settings
     set venue_name                = case when p_patch ? 'venue_name' then v_name else venue_name end,
         phone                     = case when p_patch ? 'phone' then v_phone else phone end,
         hold_ttl_seconds          = case when p_patch ? 'hold_ttl_seconds'
                                          then (p_patch->>'hold_ttl_seconds')::int else hold_ttl_seconds end,
         cancellation_window_hours = case when p_patch ? 'cancellation_window_hours'
                                          then (p_patch->>'cancellation_window_hours')::int else cancellation_window_hours end,
         max_booking_horizon_days  = case when p_patch ? 'max_booking_horizon_days'
                                          then (p_patch->>'max_booking_horizon_days')::int else max_booking_horizon_days end,
         heartbeat_stale_seconds   = case when p_patch ? 'heartbeat_stale_seconds'
                                          then (p_patch->>'heartbeat_stale_seconds')::int else heartbeat_stale_seconds end,
         protected_horizon_hours   = case when p_patch ? 'protected_horizon_hours'
                                          then (p_patch->>'protected_horizon_hours')::int else protected_horizon_hours end,
         offline_mode_enabled      = case when p_patch ? 'offline_mode_enabled'
                                          then (p_patch->>'offline_mode_enabled')::boolean else offline_mode_enabled end
   where venue_id = v_venue;

  -- venues carries the same name and phone (slice-1 gap); this is their one
  -- writer, so the two copies move together.
  update venues
     set name_en    = case when p_patch ? 'venue_name' then v_name else name_en end,
         name_ar    = case when p_patch ? 'venue_name_ar' then v_name_ar else name_ar end,
         phone      = case when p_patch ? 'phone' then v_phone else phone end,
         address_en = case when p_patch ? 'address_en' then v_addr_en else address_en end,
         address_ar = case when p_patch ? 'address_ar' then v_addr_ar else address_ar end,
         map_url    = case when p_patch ? 'map_url' then v_map else map_url end
   where id = v_venue;

  -- The per-guest hold cap is the chain's (0207, MV5).
  if p_patch ? 'max_live_holds_per_guest' then
    update platform_settings
       set max_live_holds_per_guest = (p_patch->>'max_live_holds_per_guest')::int,
           updated_at = now()
     where id;
  end if;

  -- 0248: switching offline mode off (or on) moves the branch's logged
  -- degraded period with it, now rather than at the next minute's sweep.
  if p_patch ? 'offline_mode_enabled' then
    perform app.sweep_degraded_period(v_venue);
  end if;

  select jsonb_build_object(
           'venue_name', vs.venue_name, 'venue_name_ar', v.name_ar, 'phone', vs.phone,
           'address_en', v.address_en, 'address_ar', v.address_ar, 'map_url', v.map_url,
           'hold_ttl_seconds', vs.hold_ttl_seconds,
           'cancellation_window_hours', vs.cancellation_window_hours,
           'max_booking_horizon_days', vs.max_booking_horizon_days,
           'max_live_holds_per_guest', (select ps.max_live_holds_per_guest from platform_settings ps where ps.id),
           'heartbeat_stale_seconds', vs.heartbeat_stale_seconds,
           'protected_horizon_hours', vs.protected_horizon_hours,
           'offline_mode_enabled', vs.offline_mode_enabled)
    into v_after
    from venue_settings vs join venues v on v.id = vs.venue_id
   where vs.venue_id = v_venue;

  perform app.write_audit('settings.venue_details', 'venue_settings', v_venue::text, v_before, v_after);
  return v_after;
end $set_venue_details_0248$;

comment on function app.set_venue_details(jsonb, uuid) is
  '0104/0118, 0208, 0248. Owner-only: patch one branch''s contact details, booking rules and offline mode (allowlisted keys; everything validated before anything is written). p_venue_id defaults to the caller''s resolved venue. Name, phone and address are also written to venues; max_live_holds_per_guest goes to platform_settings (the chain''s). Audited as settings.venue_details at the branch.';

revoke all on function app.set_venue_details(jsonb, uuid) from public, anon;
grant execute on function app.set_venue_details(jsonb, uuid) to authenticated;

-- Every branch is off now (the column default), so end the open periods.
select app.sweep_degraded_periods();
