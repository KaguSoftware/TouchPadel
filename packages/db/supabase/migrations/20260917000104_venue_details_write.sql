-- ===========================================================================
-- 0104 — the owner can edit the venue's contact details and booking rules.
--
-- Until now nothing wrote venue_name, phone or the booking rules: the Venue
-- details tab could only print them with a note that they were "fixed at
-- setup". The owner's call (2026-09-17): contact details and booking rules
-- become editable; timezone, currency and tax stay fixed, because changing
-- them rewrites how every past business day and amount is read.
--
-- One function, one patch object, one audit row per save. Only the keys named
-- below are accepted — an unknown key is refused rather than ignored, so a
-- client that believes it changed the timezone finds out that it did not.
--
-- Ranges are the ones the rest of the schema already relies on:
--   hold_ttl_seconds            60..3600  a booking hold between 1 minute and 1 hour
--   cancellation_window_hours   0..168    up to a week; 0 = guests can always cancel
--   max_booking_horizon_days    0..730    0 disables the horizon (0048/C1)
--   max_live_holds_per_guest    1..10     the tight abuse bound (0048/C1)
-- ===========================================================================

create or replace function app.set_venue_details(p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $set_venue_details_0104$
declare
  v_allowed text[] := array['venue_name','phone','hold_ttl_seconds','cancellation_window_hours',
                            'max_booking_horizon_days','max_live_holds_per_guest'];
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
  if p_patch ? 'max_live_holds_per_guest' then
    v_int := app.venue_patch_int(p_patch, 'max_live_holds_per_guest', 1, 10);
  end if;

  select jsonb_build_object(
           'venue_name', venue_name, 'phone', phone,
           'hold_ttl_seconds', hold_ttl_seconds,
           'cancellation_window_hours', cancellation_window_hours,
           'max_booking_horizon_days', max_booking_horizon_days,
           'max_live_holds_per_guest', max_live_holds_per_guest)
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
                                          then (p_patch->>'max_live_holds_per_guest')::int else max_live_holds_per_guest end
   where id;

  select jsonb_build_object(
           'venue_name', venue_name, 'phone', phone,
           'hold_ttl_seconds', hold_ttl_seconds,
           'cancellation_window_hours', cancellation_window_hours,
           'max_booking_horizon_days', max_booking_horizon_days,
           'max_live_holds_per_guest', max_live_holds_per_guest)
    into v_after from venue_settings where id;

  perform app.write_audit('settings.venue_details', 'venue_settings', 'singleton', v_before, v_after);
  return v_after;
end $set_venue_details_0104$;

-- A whole number within range, or INVALID_ARGUMENT naming the field. Internal:
-- not granted to any client role.
create or replace function app.venue_patch_int(p_patch jsonb, p_key text, p_min int, p_max int)
returns int
language plpgsql immutable set search_path = public as $venue_patch_int_0104$
declare
  v_raw text := p_patch->>p_key;
  v     int;
begin
  if v_raw is null or v_raw !~ '^\d+$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = p_key;
  end if;
  v := v_raw::int;
  if v < p_min or v > p_max then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = p_key,
      hint = format('between %s and %s', p_min, p_max);
  end if;
  return v;
end $venue_patch_int_0104$;

revoke all on function app.venue_patch_int(jsonb, text, int, int) from public, anon, authenticated;

revoke all on function app.set_venue_details(jsonb) from public, anon;
grant execute on function app.set_venue_details(jsonb) to authenticated;
