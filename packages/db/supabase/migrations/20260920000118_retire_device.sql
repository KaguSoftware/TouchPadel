-- ===========================================================================
-- 0118 — degraded mode gets an off switch (C2).
--
-- THE DEFECT. Degraded mode (0021) is one global boolean computed from
-- device_heartbeats: "some till row exists AND none is fresh". The row is keyed
-- by a client-supplied device id; is_till is sticky (0026); a 'TILL%' name makes
-- a till; nothing retires a row. Rename a till, replace its PC, or run the e2e
-- suite against the wrong project (three times, in dev, against production) and
-- a stale till row locks every guest out of booking inside the protected
-- horizon — with no button anywhere to end it. The two thresholds that decide
-- it, heartbeat_stale_seconds and protected_horizon_hours, were not writable by
-- any RPC either.
--
-- THE FIX.
--   * app.retire_device(p_device_id) — owner only. Deletes the heartbeat row,
--     re-runs app.sweep_degraded_periods() so an open degraded period closes in
--     the same transaction, audits device.retired with the row it removed, and
--     returns the venue's degraded state afterwards. Deleting is the honest
--     model: is_degraded reasons over rows that exist, and a retired device is
--     one that should not exist. If it beats again it simply re-registers
--     (app.heartbeat upserts), which is also the right answer.
--   * app.set_venue_details (re-issued from 0104 verbatim) accepts
--     heartbeat_stale_seconds (15..600) and protected_horizon_hours (0..168).
--     venue_settings_public already exposes protected_horizon_hours (0006:52),
--     so the guest apps see a change on their next poll.
--   * The owner screen (apps/operator, Settings → Venue details) lists devices
--     with their last beat and offers Retire; the two thresholds join the
--     booking rules there.
--
-- Multi-venue (milestone 1) replaces the free-text device id with a stations
-- registry; retire_device becomes "retire station" then. The RPC name and the
-- audit action are chosen to survive that.
--
-- covered by packages/db/tests/retire-device.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.retire_device
-- ---------------------------------------------------------------------------
create or replace function app.retire_device(p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $retire_device_0118$
declare
  v_row device_heartbeats%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or btrim(p_device_id) = '' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_device_id';
  end if;

  select * into v_row from device_heartbeats where device_id = p_device_id for update;
  if not found then
    raise exception 'DEVICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  delete from device_heartbeats where device_id = p_device_id;

  -- The sweep reads is_degraded() over the rows that remain: an open degraded
  -- period caused by this device closes here, not on the next cron tick.
  perform app.sweep_degraded_periods();

  perform app.write_audit('device.retired', 'device_heartbeats', p_device_id,
                          to_jsonb(v_row), null, null, null, p_device_id);

  return jsonb_build_object(
    'device_id', p_device_id,
    'was_till', (v_row.is_till or v_row.device_id like 'TILL%'),
    'degraded', app.is_degraded());
end $retire_device_0118$;

comment on function app.retire_device(text) is
  '0118/C2. Owner only. Removes a device''s heartbeat row so a renamed, replaced or misconfigured till stops holding the venue in degraded mode; sweeps the degraded period in the same transaction; audits device.retired. A device that beats again re-registers through app.heartbeat.';

revoke all on function app.retire_device(text) from public, anon;
grant execute on function app.retire_device(text) to authenticated;

-- ---------------------------------------------------------------------------
-- app.set_venue_details — re-issued IN FULL from 20260917000104_venue_details_write.sql
-- ($set_venue_details_0104$) plus the two degraded-mode thresholds.
-- Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.set_venue_details(p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $set_venue_details_0118$
declare
  v_allowed text[] := array['venue_name','phone','hold_ttl_seconds','cancellation_window_hours',
                            'max_booking_horizon_days','max_live_holds_per_guest',
                            -- 0118 (C2): the degraded-mode thresholds, owner-writable at last.
                            'heartbeat_stale_seconds','protected_horizon_hours'];
  v_key     text;
  v_before  jsonb;
  v_after   jsonb;
  v_name    text;
  v_phone   text;
  v_int     int;
begin
  if not app.is_staff('owner') then
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
  if p_patch ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_patch->>'phone', '')), '');
    if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,20}$' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'phone';
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

  select jsonb_build_object(
           'venue_name', venue_name, 'phone', phone,
           'hold_ttl_seconds', hold_ttl_seconds,
           'cancellation_window_hours', cancellation_window_hours,
           'max_booking_horizon_days', max_booking_horizon_days,
           'max_live_holds_per_guest', max_live_holds_per_guest,
           'heartbeat_stale_seconds', heartbeat_stale_seconds,
           'protected_horizon_hours', protected_horizon_hours)
    into v_before from venue_settings where id;

  -- `where id`: safeupdate refuses an unqualified update on PostgREST
  -- connections (see 0052).
  update venue_settings
     set venue_name                = case when p_patch ? 'venue_name' then v_name else venue_name end,
         phone                     = case when p_patch ? 'phone' then v_phone else phone end,
         hold_ttl_seconds          = case when p_patch ? 'hold_ttl_seconds'
                                          then (p_patch->>'hold_ttl_seconds')::int else hold_ttl_seconds end,
         cancellation_window_hours = case when p_patch ? 'cancellation_window_hours'
                                          then (p_patch->>'cancellation_window_hours')::int else cancellation_window_hours end,
         max_booking_horizon_days  = case when p_patch ? 'max_booking_horizon_days'
                                          then (p_patch->>'max_booking_horizon_days')::int else max_booking_horizon_days end,
         max_live_holds_per_guest  = case when p_patch ? 'max_live_holds_per_guest'
                                          then (p_patch->>'max_live_holds_per_guest')::int else max_live_holds_per_guest end,
         heartbeat_stale_seconds   = case when p_patch ? 'heartbeat_stale_seconds'
                                          then (p_patch->>'heartbeat_stale_seconds')::int else heartbeat_stale_seconds end,
         protected_horizon_hours   = case when p_patch ? 'protected_horizon_hours'
                                          then (p_patch->>'protected_horizon_hours')::int else protected_horizon_hours end
   where id;

  select jsonb_build_object(
           'venue_name', venue_name, 'phone', phone,
           'hold_ttl_seconds', hold_ttl_seconds,
           'cancellation_window_hours', cancellation_window_hours,
           'max_booking_horizon_days', max_booking_horizon_days,
           'max_live_holds_per_guest', max_live_holds_per_guest,
           'heartbeat_stale_seconds', heartbeat_stale_seconds,
           'protected_horizon_hours', protected_horizon_hours)
    into v_after from venue_settings where id;

  perform app.write_audit('settings.venue_details', 'venue_settings', 'singleton', v_before, v_after);
  return v_after;
end $set_venue_details_0118$;
