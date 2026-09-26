set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0208_venue_settings_per_venue — multi-venue slice 2, step 2.
--
-- venue_settings stops being a singleton. Its key moves from the boolean `id`
-- (0006) to `venue_id` (0126, present by the validated CHECK of 0139), so the
-- second branch can have its own row, with its own hours, policies and
-- thresholds. Nothing creates that row here: app.create_branch does, at the end
-- of the milestone. Until then there is still exactly one row and every reader
-- not yet re-issued keeps reading it.
--
--   * venues gains the public address a branch shows guests: address_en,
--     address_ar, map_url (the club site's Visit block and jsonLd read them in
--     slice 4, instead of the hard-coded address).
--   * venue_settings: the boolean primary key is dropped and a unique index on
--     venue_id takes its place. `id` stays (always true) so a body not yet
--     re-issued that says `where id` still compiles; no new code may use it.
--   * venue_settings_public gains venue_id, the branch's slug, both names and
--     the address, joined from venues, and lists active branches only.
--   * The three writers take the branch: set_opening_hours (0052),
--     set_waiter_call_cooldown (0052) and set_venue_details (0118) gain
--     p_venue_id (default: the caller's resolved venue), guard with
--     app.is_staff_at, write that branch's row only and audit at that branch.
--     set_venue_details also keeps venues (name, phone, address) in step, since
--     venues and venue_settings both carry name and phone (slice-1 gap), and
--     sends max_live_holds_per_guest to platform_settings (0207, MV5).
--
-- MIGRATION-RISK-ACCEPTED: one non-concurrent unique index on venue_settings,
-- which holds one row on every database this runs on; the SHARE lock lasts
-- microseconds. Recorded in PHASE-2-CHECKLIST.md with the slice-2 waiver.

-- ---------------------------------------------------------------------------
-- 1. venues: the public address
-- ---------------------------------------------------------------------------
alter table venues add column if not exists address_en text;
alter table venues add column if not exists address_ar text;
alter table venues add column if not exists map_url    text;

comment on column venues.address_en is '0208. The branch''s street address as guests read it (club site, jsonLd). Optional.';
comment on column venues.address_ar is '0208. The branch''s street address in Arabic. Optional.';
comment on column venues.map_url    is '0208. A https map link for the branch (Google Maps or similar). Optional.';

do $venues_addr$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'venues_address_en_len' and conrelid = 'venues'::regclass) then
    alter table venues add constraint venues_address_en_len
      check (address_en is null or char_length(address_en) between 2 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'venues_address_ar_len' and conrelid = 'venues'::regclass) then
    alter table venues add constraint venues_address_ar_len
      check (address_ar is null or char_length(address_ar) between 2 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'venues_map_url_chk' and conrelid = 'venues'::regclass) then
    alter table venues add constraint venues_map_url_chk
      check (map_url is null or (map_url ~ '^https://' and char_length(map_url) <= 500)) not valid;
  end if;
end
$venues_addr$;

alter table venues validate constraint venues_address_en_len;
alter table venues validate constraint venues_address_ar_len;
alter table venues validate constraint venues_map_url_chk;

-- ---------------------------------------------------------------------------
-- 2. venue_settings: keyed by venue
-- ---------------------------------------------------------------------------
alter table venue_settings drop constraint if exists venue_settings_pkey;

create unique index if not exists venue_settings_venue_id_key on venue_settings (venue_id);

alter table venue_settings alter column id set default true;

comment on column venue_settings.id is
  'DEPRECATED 0208: the 0006 singleton key. Always true; no longer unique. Kept so a body not yet re-issued still compiles. Never use it in new code: key by venue_id.';
comment on column venue_settings.venue_id is
  '0126, key since 0208 (unique index venue_settings_venue_id_key; not null by the validated CHECK venue_settings_venue_id_present of 0139). One row per branch.';
comment on table venue_settings is
  '0006, per branch since 0208. One row per venue: opening hours, closed dates, booking and degraded-mode thresholds, guest cafe limits, tax and rounding. The chain''s settings live in platform_settings (0207).';

-- ---------------------------------------------------------------------------
-- 3. venue_settings_public: one row per active branch, with its identity
-- ---------------------------------------------------------------------------
-- create or replace can only APPEND columns (0026/0048 order kept).
create or replace view venue_settings_public with (security_invoker = off) as
select vs.venue_name,
       vs.currency,
       vs.timezone,
       vs.opening_hours,
       vs.closed_dates,
       vs.protected_horizon_hours,
       vs.cancellation_window_hours,
       vs.table_token_ttl_minutes,
       vs.phone,
       vs.max_booking_horizon_days,
       vs.venue_id,
       v.slug       as venue_slug,
       v.name_en    as venue_name_en,
       v.name_ar    as venue_name_ar,
       v.address_en,
       v.address_ar,
       v.map_url
  from venue_settings vs
  join venues v on v.id = vs.venue_id and v.is_active;

grant select on venue_settings_public to anon, authenticated;

comment on view venue_settings_public is
  '0006/0048, per branch since 0208. The guest-safe settings of every active branch, with its id, slug, names and address. The ONLY settings surface for anon.';

-- ---------------------------------------------------------------------------
-- 4. The writers take the branch
-- ---------------------------------------------------------------------------
drop function if exists app.set_opening_hours(jsonb, date[]);

create or replace function app.set_opening_hours(
  p_opening_hours jsonb default null,
  p_closed_dates  date[] default null,
  p_venue_id      uuid default null
) returns void
language plpgsql security definer set search_path = public as $set_hours_0208$
declare
  v_venue  uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_opening_hours is not null and jsonb_typeof(p_opening_hours) <> 'object' then
    raise exception 'INVALID_HOURS' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates))
    into v_before from venue_settings where venue_id = v_venue;
  if v_before is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  update venue_settings
     set opening_hours = coalesce(p_opening_hours, opening_hours),
         closed_dates  = coalesce(p_closed_dates, closed_dates)
   where venue_id = v_venue;

  select jsonb_build_object('opening_hours', opening_hours, 'closed_dates', to_jsonb(closed_dates))
    into v_after from venue_settings where venue_id = v_venue;

  perform app.write_audit('settings.opening_hours', 'venue_settings', v_venue::text,
                          v_before, v_after);
end $set_hours_0208$;

comment on function app.set_opening_hours(jsonb, date[], uuid) is
  '0052, 0208. Manager or owner at the branch: set that branch''s opening hours and/or closed dates (null keeps the current value). p_venue_id defaults to the caller''s resolved venue (VENUE_REQUIRED when ambiguous). Audited as settings.opening_hours at the branch.';

revoke all on function app.set_opening_hours(jsonb, date[], uuid) from public, anon;
grant execute on function app.set_opening_hours(jsonb, date[], uuid) to authenticated;

drop function if exists app.set_waiter_call_cooldown(int);

create or replace function app.set_waiter_call_cooldown(p_seconds int, p_venue_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $set_cooldown_0208$
declare
  v_venue  uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_seconds is null or p_seconds < 30 or p_seconds > 600 then
    raise exception 'INVALID_COOLDOWN' using errcode = 'P0001',
      hint = 'cooldown must be between 30 and 600 seconds';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  select jsonb_build_object('waiter_call_cooldown_seconds', waiter_call_cooldown_seconds)
    into v_before from venue_settings where venue_id = v_venue;
  if v_before is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  update venue_settings set waiter_call_cooldown_seconds = p_seconds where venue_id = v_venue;

  select jsonb_build_object('waiter_call_cooldown_seconds', waiter_call_cooldown_seconds)
    into v_after from venue_settings where venue_id = v_venue;

  perform app.write_audit('settings.waiter_cooldown', 'venue_settings', v_venue::text,
                          v_before, v_after);
end $set_cooldown_0208$;

comment on function app.set_waiter_call_cooldown(int, uuid) is
  '0031/0052, 0208. Manager or owner at the branch: that branch''s waiter-call cooldown, 30–600 s. p_venue_id defaults to the caller''s resolved venue.';

revoke all on function app.set_waiter_call_cooldown(int, uuid) from public, anon;
grant execute on function app.set_waiter_call_cooldown(int, uuid) to authenticated;

drop function if exists app.set_venue_details(jsonb);

create or replace function app.set_venue_details(p_patch jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_venue_details_0208$
declare
  v_allowed text[] := array['venue_name','phone','hold_ttl_seconds','cancellation_window_hours',
                            'max_booking_horizon_days','max_live_holds_per_guest',
                            -- 0118 (C2): the degraded-mode thresholds, owner-writable at last.
                            'heartbeat_stale_seconds','protected_horizon_hours',
                            -- 0208: the branch's Arabic name and public address (venues).
                            'venue_name_ar','address_en','address_ar','map_url'];
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

  perform set_config('app.venue_id', v_venue::text, true);

  select jsonb_build_object(
           'venue_name', vs.venue_name, 'venue_name_ar', v.name_ar, 'phone', vs.phone,
           'address_en', v.address_en, 'address_ar', v.address_ar, 'map_url', v.map_url,
           'hold_ttl_seconds', vs.hold_ttl_seconds,
           'cancellation_window_hours', vs.cancellation_window_hours,
           'max_booking_horizon_days', vs.max_booking_horizon_days,
           'max_live_holds_per_guest', (select ps.max_live_holds_per_guest from platform_settings ps where ps.id),
           'heartbeat_stale_seconds', vs.heartbeat_stale_seconds,
           'protected_horizon_hours', vs.protected_horizon_hours)
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
                                          then (p_patch->>'protected_horizon_hours')::int else protected_horizon_hours end
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

  select jsonb_build_object(
           'venue_name', vs.venue_name, 'venue_name_ar', v.name_ar, 'phone', vs.phone,
           'address_en', v.address_en, 'address_ar', v.address_ar, 'map_url', v.map_url,
           'hold_ttl_seconds', vs.hold_ttl_seconds,
           'cancellation_window_hours', vs.cancellation_window_hours,
           'max_booking_horizon_days', vs.max_booking_horizon_days,
           'max_live_holds_per_guest', (select ps.max_live_holds_per_guest from platform_settings ps where ps.id),
           'heartbeat_stale_seconds', vs.heartbeat_stale_seconds,
           'protected_horizon_hours', vs.protected_horizon_hours)
    into v_after
    from venue_settings vs join venues v on v.id = vs.venue_id
   where vs.venue_id = v_venue;

  perform app.write_audit('settings.venue_details', 'venue_settings', v_venue::text, v_before, v_after);
  return v_after;
end $set_venue_details_0208$;

comment on function app.set_venue_details(jsonb, uuid) is
  '0104/0118, 0208. Owner-only: patch one branch''s contact details and booking rules (allowlisted keys; everything validated before anything is written). p_venue_id defaults to the caller''s resolved venue. Name, phone and address are also written to venues; max_live_holds_per_guest goes to platform_settings (the chain''s). Audited as settings.venue_details at the branch.';

revoke all on function app.set_venue_details(jsonb, uuid) from public, anon;
grant execute on function app.set_venue_details(jsonb, uuid) to authenticated;
