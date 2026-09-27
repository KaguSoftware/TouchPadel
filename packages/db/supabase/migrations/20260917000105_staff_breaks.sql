-- ===========================================================================
-- 0105 — staff breaks with cover: "Go on break" on the station rail.
--
-- The ask (owner, 2026-09-17): a worker at a till can take several breaks a
-- day that add up to an allowance (an hour by default); starting or ending one
-- takes their own quick PIN; while they are away the station shows the other
-- people assigned to it, and one of them can take the till over with THEIR PIN
-- until the first person is back.
--
-- ---------------------------------------------------------------------------
-- 1. EVERY STAFF ROLE MAY HOLD A PIN
-- ---------------------------------------------------------------------------
--
-- A PIN used to exist for managers and owners only, because its one job was
-- APPROVING money moves (0004/0026). A break is the first thing a cashier
-- needs a PIN for, so app.set_staff_pin now accepts any active staff row and
-- app.set_staff_role stops clearing the PIN on a demotion.
--
-- This does NOT widen what a PIN can approve. app.verify_manager_pin (0086)
-- scans `role in ('manager','owner')` and is untouched: a cashier's PIN can
-- never satisfy a discount, void, refund or override, structurally. One PIN
-- per person, rather than a second "break PIN" beside the manager one — 0087
-- already spelled out why two similar secrets on one keypad is worse.
--
-- A welcome side effect: the idle lock (0064/0087) can now be unlocked by a
-- cashier's own PIN instead of their password.
--
-- ---------------------------------------------------------------------------
-- 2. THE MODEL
-- ---------------------------------------------------------------------------
--
--   station_staff   who is assigned to which station (owner/manager-managed).
--                   Managers and owners can cover ANY station without a row.
--   staff_breaks    one row per break; ended_at null = still away. covered_by
--                   is whoever took the till over, verified by their PIN.
--
-- The Supabase session on the machine stays the FIRST person's, as the idle
-- lock already keeps it (0064): the cover is recorded on the break row and in
-- the audit log, and the shell shows who is at the till. Minting a session
-- from a PIN would make every PIN a login credential, which is a decision the
-- owner has not made.
--
-- The allowance is `break_allowance_minutes` (cafe_setting_specs; manager;
-- 0..480; default 60) and counts per business date (app.business_date, so a
-- night shift that crosses midnight is one day). A break that runs over is
-- not cut short — nobody can be stopped from coming back late — but the row
-- and the audit say by how much.
--
-- PIN outcomes are RETURNED as {ok:false, code:'PIN_INVALID'} rather than
-- raised, for the 0011 reason: a raise rolls back the pin_attempts row and the
-- five-failure lockout can never engage. Business refusals raise as usual.
--
-- The two indexes below are created inline on brand-new, empty tables: no
-- writer exists yet, so the SHARE lock the migration lint warns about holds
-- nothing up. (0072 and 0073 set the same precedent.)
--
-- covered by packages/db/tests/staff-breaks.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1a. app.set_staff_pin — any active staff member (was managers/owners only)
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public as $set_staff_pin_0105$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_pin !~ '^[0-9]{6,12}$' then
    raise exception 'PIN_FORMAT' using errcode = 'P0001',
      hint = 'PIN must be 6-12 digits';
  end if;

  if app.pin_is_weak(p_pin) then
    raise exception 'PIN_WEAK' using errcode = 'P0001',
      hint = 'not a repeated digit and not a sequential run';
  end if;

  -- 0105: no role filter. A cashier's PIN starts and ends a break and unlocks
  -- the idle lock; verify_manager_pin still ignores it for approvals.
  update staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_staff_id and is_active;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001',
      hint = 'PINs exist for active staff only';
  end if;

  -- Audit the CHANGE, never the PIN (0026).
  perform app.write_audit('staff.pin_set', 'staff', p_staff_id::text,
                          null, jsonb_build_object('staff_id', p_staff_id));
end $set_staff_pin_0105$;

revoke all on function app.set_staff_pin(uuid, text) from public, anon;
grant execute on function app.set_staff_pin(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. app.set_staff_role — 0051 body, minus the PIN clearing on demotion
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_role(
  p_staff_id    uuid,
  p_role        staff_role,
  p_reason_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_role_0105$
declare
  v_before staff%rowtype;
  v_after  staff%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'CANNOT_EDIT_SELF' using errcode = 'P0001',
      hint = 'another owner must change your own role';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_before.role = 'owner' and p_role <> 'owner' and app.other_active_owners(p_staff_id) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001',
      hint = 'promote another owner first';
  end if;

  -- 0105: the PIN stays. It is the person's PIN now, not the role's; a demoted
  -- manager's PIN simply stops approving anything, because verify_manager_pin
  -- filters on the role at verification time.
  update staff
     set role = p_role
   where id = p_staff_id
   returning * into v_after;

  perform app.write_audit('staff.role_set', 'staff', p_staff_id::text,
                          jsonb_build_object('role', v_before.role,
                                             'had_pin', v_before.pin_hash is not null),
                          jsonb_build_object('role', v_after.role,
                                             'had_pin', v_after.pin_hash is not null),
                          p_reason_code);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'is_active', v_after.is_active);
end $set_role_0105$;

revoke all on function app.set_staff_role(uuid, staff_role, text) from public, anon;
grant execute on function app.set_staff_role(uuid, staff_role, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. break_allowance_minutes — full re-create of the 0064 VALUES list + 1 row
-- ---------------------------------------------------------------------------
create or replace function app.cafe_setting_specs()
returns table (key text, is_public boolean, jtype text, min_role staff_role, default_value jsonb)
language sql stable security definer set search_path = public as $cafe_specs_0105$
  select v.key, v.is_public, v.jtype, v.min_role, v.default_value
    from (values
      -- public + manager|owner (guest-visible content)
      ('hero_mode',                         true,  'enum(none|media|featured)', 'manager'::staff_role, '"none"'::jsonb),
      ('hero_media_path',                   true,  'media_path(hero)',          'manager'::staff_role, 'null'::jsonb),
      ('hero_media_kind',                   true,  'enum(image|video)',         'manager'::staff_role, '"image"'::jsonb),
      ('featured_item_id',                  true,  'active_item_id',            'manager'::staff_role, 'null'::jsonb),
      ('featured_label_en',                 true,  'text(200)',                 'manager'::staff_role, '""'::jsonb),
      ('featured_label_ar',                 true,  'text(200)',                 'manager'::staff_role, '""'::jsonb),
      ('featured_badge_en',                 true,  'text(60)',                  'manager'::staff_role, '""'::jsonb),
      ('featured_badge_ar',                 true,  'text(60)',                  'manager'::staff_role, '""'::jsonb),
      ('featured_discount_pct',             true,  'int(0,99)',                 'manager'::staff_role, '0'::jsonb),
      ('ticker_en',                         true,  'text_array(12,120)',        'manager'::staff_role, '[]'::jsonb),
      ('ticker_ar',                         true,  'text_array(12,120)',        'manager'::staff_role, '[]'::jsonb),
      ('bell_tutorial_enabled',             true,  'bool',                      'manager'::staff_role, 'true'::jsonb),
      -- private + manager (station behaviour)
      ('till_idle_lock_seconds',            false, 'int(0,3600)',               'manager'::staff_role, '300'::jsonb),
      -- 0105: minutes of break per person per business day; 0 = no breaks.
      ('break_allowance_minutes',           false, 'int(0,480)',                'manager'::staff_role, '60'::jsonb),
      -- private + owner (operational / secrets-adjacent)
      ('telegram_enabled',                  false, 'bool',                      'owner'::staff_role,   'false'::jsonb),
      ('telegram_chat_id',                  false, 'chat_id',                   'owner'::staff_role,   'null'::jsonb),
      ('telegram_lang',                     false, 'enum(ar|en)',               'owner'::staff_role,   '"ar"'::jsonb),
      ('telegram_last_callback_at',         false, 'timestamp',                 'owner'::staff_role,   'null'::jsonb),
      ('analytics_business_day_start_hour', false, 'int(0,12)',                 'owner'::staff_role,   '4'::jsonb),
      ('analytics_excluded_item_ids',       false, 'uuid_array',                'owner'::staff_role,   '[]'::jsonb),
      ('analytics_engagement_floor',        false, 'date',                      'owner'::staff_role,   'null'::jsonb)
    ) as v(key, is_public, jtype, min_role, default_value)
$cafe_specs_0105$;

-- ---------------------------------------------------------------------------
-- 3. station_staff — who is assigned to which station
-- ---------------------------------------------------------------------------
create table if not exists station_staff (
  station_id text not null,                    -- device_heartbeats.device_id shape: 'TILL-01'
  staff_id   uuid not null references staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references staff(id),
  primary key (station_id, staff_id),
  constraint station_staff_id_chk check (station_id ~ '^[A-Z][A-Z0-9-]{0,31}$')
);

comment on table station_staff is
  '0105: staff assigned to a station, i.e. who is offered as cover on its break screen. '
  'Managers and owners may cover any station without a row. Written only through '
  'app.set_station_staff.';

alter table station_staff enable row level security;
grant select on station_staff to authenticated;

drop policy if exists station_staff_read_mgmt on station_staff;
create policy station_staff_read_mgmt on station_staff
  for select to authenticated
  using (app.is_staff('manager','owner'));
-- A till learns its own cover list through app.break_status; no self policy.

-- ---------------------------------------------------------------------------
-- 4. staff_breaks
-- ---------------------------------------------------------------------------
create table if not exists staff_breaks (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references staff(id),
  station_id       text not null,
  business_date    date not null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  covered_by       uuid references staff(id),
  cover_started_at timestamptz,
  constraint staff_breaks_order_chk check (ended_at is null or ended_at >= started_at),
  constraint staff_breaks_cover_chk check ((covered_by is null) = (cover_started_at is null)),
  constraint staff_breaks_not_self_cover_chk check (covered_by is null or covered_by <> staff_id)
);

comment on table staff_breaks is
  '0105: one row per break. ended_at null = still away. covered_by is who took the '
  'station over meanwhile, verified by their own PIN (app.cover_station). Written only '
  'through app.start_break / app.end_break / app.cover_station.';

-- One open break per person, whatever station they used.
create unique index if not exists staff_breaks_open_idx
  on staff_breaks (staff_id) where ended_at is null;
-- The allowance read: today's rows for one person.
create index if not exists staff_breaks_day_idx
  on staff_breaks (staff_id, business_date);

alter table staff_breaks enable row level security;
grant select on staff_breaks to authenticated;

drop policy if exists staff_breaks_read_own on staff_breaks;
create policy staff_breaks_read_own on staff_breaks
  for select to authenticated
  using (staff_id = auth.uid() or covered_by = auth.uid());

drop policy if exists staff_breaks_read_mgmt on staff_breaks;
create policy staff_breaks_read_mgmt on staff_breaks
  for select to authenticated
  using (app.is_staff('manager','owner'));

-- ---------------------------------------------------------------------------
-- 5. Internal helpers (definer-only; no client grant)
-- ---------------------------------------------------------------------------
create or replace function app.break_allowance_seconds() returns int
language sql stable security definer set search_path = public as $break_allow_0105$
  select coalesce(app.cafe_setting_int('break_allowance_minutes'), 60) * 60
$break_allow_0105$;

/** Seconds of break taken by one person on one business date, an open break counted to now(). */
create or replace function app.break_used_seconds(p_staff_id uuid, p_date date) returns int
language sql stable security definer set search_path = public as $break_used_0105$
  select coalesce(sum(extract(epoch from coalesce(ended_at, now()) - started_at))::int, 0)
    from staff_breaks
   where staff_id = p_staff_id and business_date = p_date
$break_used_0105$;

/** Who may take a station over: assigned staff first, then any manager/owner; all with a PIN, all active. */
create or replace function app.break_cover_candidates(p_station_id text, p_for uuid) returns jsonb
language sql stable security definer set search_path = public as $break_cands_0105$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'display_name', s.display_name, 'role', s.role, 'assigned', a.staff_id is not null)
           order by (a.staff_id is not null) desc, s.display_name), '[]'::jsonb)
    from staff s
    left join station_staff a on a.staff_id = s.id and a.station_id = p_station_id
   where s.is_active
     and s.pin_hash is not null
     and s.id <> p_for
     and (a.staff_id is not null or s.role in ('manager','owner'))
$break_cands_0105$;

create or replace function app.break_row_json(p_row staff_breaks) returns jsonb
language sql stable security definer set search_path = public as $break_json_0105$
  select jsonb_build_object(
    'id', p_row.id,
    'station_id', p_row.station_id,
    'business_date', p_row.business_date,
    'started_at', p_row.started_at,
    'ended_at', p_row.ended_at,
    'cover', case when p_row.covered_by is null then null else
      (select jsonb_build_object('id', c.id, 'display_name', c.display_name, 'role', c.role,
                                 'since', p_row.cover_started_at)
         from staff c where c.id = p_row.covered_by) end)
$break_json_0105$;

revoke all on function app.break_allowance_seconds() from public, anon, authenticated;
revoke all on function app.break_used_seconds(uuid, date) from public, anon, authenticated;
revoke all on function app.break_cover_candidates(text, uuid) from public, anon, authenticated;
revoke all on function app.break_row_json(staff_breaks) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.break_status — everything the rail and the break screen need, in one
--    call: allowance, what is used today, the open break (with cover) and who
--    can take this station over.
-- ---------------------------------------------------------------------------
create or replace function app.break_status(p_device_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $break_status_0105$
declare
  v_caller uuid := auth.uid();
  v_date   date;
  v_allow  int;
  v_used   int;
  v_open   staff_breaks%rowtype;
begin
  if v_caller is null or not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001',
      hint = 'capitals, digits and dashes, starting with a letter';
  end if;

  v_date  := app.business_date(now());
  v_allow := app.break_allowance_seconds();
  v_used  := app.break_used_seconds(v_caller, v_date);
  select * into v_open from staff_breaks where staff_id = v_caller and ended_at is null;

  return jsonb_build_object(
    'now', now(),
    'business_date', v_date,
    'allowance_seconds', v_allow,
    'used_seconds', v_used,
    'remaining_seconds', greatest(0, v_allow - v_used),
    'open', case when v_open.id is null then null else app.break_row_json(v_open) end,
    'candidates', app.break_cover_candidates(p_device_id, v_caller)
  );
end $break_status_0105$;

revoke all on function app.break_status(text) from public, anon;
grant execute on function app.break_status(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.start_break — own PIN, allowance permitting
-- ---------------------------------------------------------------------------
create or replace function app.start_break(p_pin text, p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $start_break_0105$
declare
  v_caller uuid := auth.uid();
  v_date   date;
  v_allow  int;
  v_used   int;
  v_row    staff_breaks%rowtype;
begin
  if v_caller is null or not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001',
      hint = 'a break is taken from a named station';
  end if;
  if exists (select 1 from staff_breaks where staff_id = v_caller and ended_at is null) then
    raise exception 'BREAK_ALREADY_OPEN' using errcode = 'P0001';
  end if;

  v_date  := app.business_date(now());
  v_allow := app.break_allowance_seconds();
  v_used  := app.break_used_seconds(v_caller, v_date);
  -- Less than a minute left is nothing to take.
  if v_allow - v_used < 60 then
    raise exception 'BREAK_ALLOWANCE_USED' using errcode = 'P0001',
      hint = format('%s of %s seconds used today', v_used, v_allow);
  end if;

  -- The person's own PIN, with the 0064/0086 limiter (':self:' namespace).
  -- Raises PIN_LOCKED / NO_PIN_SET itself; a plain wrong PIN comes back false
  -- and is RETURNED, so the attempt row it wrote survives (0011).
  if not app.verify_own_pin(p_pin, p_device_id) then
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  insert into staff_breaks (staff_id, station_id, business_date)
  values (v_caller, p_device_id, v_date)
  returning * into v_row;

  perform app.write_audit('staff.break_start', 'staff_break', v_row.id::text, null,
                          jsonb_build_object('staff_id', v_caller, 'station_id', p_device_id,
                                             'business_date', v_date,
                                             'remaining_seconds', v_allow - v_used),
                          null, null, p_device_id);

  return jsonb_build_object(
    'ok', true,
    'break', app.break_row_json(v_row),
    'allowance_seconds', v_allow,
    'used_seconds', v_used,
    'remaining_seconds', v_allow - v_used
  );
end $start_break_0105$;

revoke all on function app.start_break(text, text) from public, anon;
grant execute on function app.start_break(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.end_break — the person is back; own PIN
-- ---------------------------------------------------------------------------
create or replace function app.end_break(p_pin text, p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $end_break_0105$
declare
  v_caller   uuid := auth.uid();
  v_row      staff_breaks%rowtype;
  v_allow    int;
  v_used     int;
  v_duration int;
begin
  if v_caller is null or not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from staff_breaks where staff_id = v_caller and ended_at is null for update;
  if not found then
    raise exception 'BREAK_NOT_OPEN' using errcode = 'P0001';
  end if;

  if not app.verify_own_pin(p_pin, p_device_id) then
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  update staff_breaks set ended_at = now() where id = v_row.id returning * into v_row;
  v_duration := extract(epoch from v_row.ended_at - v_row.started_at)::int;
  v_allow    := app.break_allowance_seconds();
  v_used     := app.break_used_seconds(v_caller, v_row.business_date);

  perform app.write_audit('staff.break_end', 'staff_break', v_row.id::text, null,
                          jsonb_build_object('staff_id', v_caller, 'station_id', v_row.station_id,
                                             'duration_seconds', v_duration,
                                             'used_seconds', v_used,
                                             'allowance_seconds', v_allow,
                                             'overran', v_used > v_allow,
                                             'covered_by', v_row.covered_by),
                          null, v_row.covered_by, p_device_id);

  return jsonb_build_object(
    'ok', true,
    'break', app.break_row_json(v_row),
    'duration_seconds', v_duration,
    'allowance_seconds', v_allow,
    'used_seconds', v_used,
    'remaining_seconds', greatest(0, v_allow - v_used)
  );
end $end_break_0105$;

revoke all on function app.end_break(text, text) from public, anon;
grant execute on function app.end_break(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.cover_station — somebody else takes the till while the caller is
--    away. The CALLER is the signed-in session on the machine (the person on
--    break); p_staff_id + p_pin name and prove who is stepping in.
--
--    Limiter: '{caller}:cover:{device}', 5 failures / 5 min per caller, same
--    padding as 0086. It is one more place a specific manager's PIN can be
--    guessed at, but no wider than verify_manager_pin already is, and the
--    target must be eligible cover for THIS station.
--
--    Idempotent for the same cover: calling it again with the same person and
--    PIN re-verifies them (the idle lock uses that while they hold the till)
--    and writes no second audit row.
-- ---------------------------------------------------------------------------
create or replace function app.cover_station(p_staff_id uuid, p_pin text, p_device_id text)
returns jsonb
language plpgsql security definer set search_path = public as $cover_station_0105$
declare
  v_started timestamptz := clock_timestamp();
  v_caller  uuid := auth.uid();
  v_row     staff_breaks%rowtype;
  v_target  staff%rowtype;
  v_key     text;
  v_fails   int;
  v_ok      boolean;
begin
  if v_caller is null or not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001';
  end if;

  select * into v_row
    from staff_breaks
   where staff_id = v_caller and ended_at is null and station_id = p_device_id
     for update;
  if not found then
    raise exception 'BREAK_NOT_OPEN' using errcode = 'P0001',
      hint = 'cover is only offered while the signed-in person is on a break at this station';
  end if;

  if p_staff_id is null or p_staff_id = v_caller then
    raise exception 'COVER_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  select * into v_target from staff where id = p_staff_id and is_active;
  if not found or v_target.pin_hash is null then
    raise exception 'COVER_NOT_ALLOWED' using errcode = 'P0001',
      hint = 'not active staff, or no PIN set';
  end if;
  if v_target.role not in ('manager','owner')
     and not exists (select 1 from station_staff
                      where station_id = p_device_id and staff_id = p_staff_id) then
    raise exception 'COVER_NOT_ALLOWED' using errcode = 'P0001',
      hint = 'not assigned to this station';
  end if;

  v_key := v_caller::text || ':cover:' || p_device_id;
  select count(*) into v_fails
    from app.pin_attempts
   where device_id like v_caller::text || ':cover:%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    perform app.pin_pad_to_floor(v_started);
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  v_ok := v_target.pin_hash = extensions.crypt(p_pin, v_target.pin_hash);
  insert into app.pin_attempts (device_id, success) values (v_key, v_ok);

  if not v_ok then
    if v_fails + 1 >= 5 then
      perform app.write_audit('staff.pin_locked', 'staff', v_caller::text, null,
                              jsonb_build_object('scope', 'cover', 'fails', v_fails + 1,
                                                 'window', '5 minutes'),
                              null, null, p_device_id);
    end if;
    perform app.pin_pad_to_floor(v_started);
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  if v_row.covered_by is distinct from p_staff_id then
    update staff_breaks
       set covered_by = p_staff_id, cover_started_at = now()
     where id = v_row.id
     returning * into v_row;
    perform app.write_audit('staff.break_cover', 'staff_break', v_row.id::text,
                            null,
                            jsonb_build_object('staff_id', v_caller, 'station_id', p_device_id,
                                               'covered_by', p_staff_id),
                            null, p_staff_id, p_device_id);
  end if;

  perform app.pin_pad_to_floor(v_started);
  return jsonb_build_object('ok', true, 'break', app.break_row_json(v_row));
end $cover_station_0105$;

revoke all on function app.cover_station(uuid, text, text) from public, anon;
grant execute on function app.cover_station(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.set_station_staff — replace one person's station assignments.
--     Manager or owner: assigning cover is a floor matter, not an account one.
-- ---------------------------------------------------------------------------
create or replace function app.set_station_staff(p_staff_id uuid, p_station_ids text[])
returns jsonb
language plpgsql security definer set search_path = public as $set_station_staff_0105$
declare
  v_ids    text[];
  v_before text[];
  v_id     text;
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
end $set_station_staff_0105$;

revoke all on function app.set_station_staff(uuid, text[]) from public, anon;
grant execute on function app.set_station_staff(uuid, text[]) to authenticated;
