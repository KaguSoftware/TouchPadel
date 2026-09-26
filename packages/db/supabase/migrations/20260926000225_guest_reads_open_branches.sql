set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0225_guest_reads_open_branches — multi-venue slice 4 (server), step 4.
--
-- A branch in 'preparing' (0222) is being set up: its courts, rates and menu
-- are real rows marked active so the owner can check them, but guests must not
-- see or book them until "Open to guests" (0223). Slice 1 left the guest branch
-- of the shared read policies on is_active alone (a known gap, slice-1 doc),
-- and hold_slot / open_table_session looked at the court or table only.
--
--   * app.open_venue_ids(): the ids of the open branches (venues.is_active since
--     0222 means exactly status = 'open'); granted to every reading role,
--     because the policies below call it.
--   * The guest branch of courts_read, rate_rules_read, menu_items_read,
--     menu_categories_read and tax_groups_read now also requires the row's
--     branch to be open (`venue_id = any((select app.open_venue_ids())::uuid[])`,
--     one evaluation per query). The staff branch is unchanged.
--   * hold_slot (0210) refuses a court at a branch that is not open
--     (COURT_NOT_FOUND, as for an inactive court); open_table_session (0211)
--     refuses a table there (TABLE_NOT_FOUND) and returns the table's venue_id;
--     app.table_branch(p_token) names a valid token's open branch before any
--     session (the website's server render).

create or replace function app.open_venue_ids() returns uuid[]
language sql stable security definer set search_path = public as $open_venue_ids_0225$
  select coalesce(array_agg(v.id order by v.created_at, v.id), '{}'::uuid[]) from venues v where v.is_active
$open_venue_ids_0225$;

comment on function app.open_venue_ids() is
  '0225. The branches open to guests (venues.is_active, i.e. status = ''open'' since 0222). Called by the guest branch of the shared read policies, so granted to every reading role.';

revoke all on function app.open_venue_ids() from public;
grant execute on function app.open_venue_ids() to anon, authenticated, service_role;

drop policy if exists courts_read on courts;
create policy courts_read on courts for select to anon, authenticated
  using ((is_active and venue_id = any((select app.open_venue_ids())::uuid[]))
         or (app.staff_role() is not null and venue_id = any(app.staff_venue_ids())));

drop policy if exists rate_rules_read on rate_rules;
create policy rate_rules_read on rate_rules for select to anon, authenticated
  using ((is_active and venue_id = any((select app.open_venue_ids())::uuid[]))
         or (app.staff_role() is not null and venue_id = any(app.staff_venue_ids())));

drop policy if exists menu_items_read on menu_items;
create policy menu_items_read on menu_items for select to anon, authenticated
  using ((is_active and venue_id = any((select app.open_venue_ids())::uuid[]))
         or (app.staff_role() is not null and venue_id = any(app.staff_venue_ids())));

drop policy if exists menu_categories_read on menu_categories;
create policy menu_categories_read on menu_categories for select to anon, authenticated
  using ((is_active and venue_id = any((select app.open_venue_ids())::uuid[]))
         or (app.staff_role() is not null and venue_id = any(app.staff_venue_ids())));

drop policy if exists tax_groups_read on tax_groups;
create policy tax_groups_read on tax_groups for select to anon, authenticated
  using ((is_active and venue_id = any((select app.open_venue_ids())::uuid[]))
         or (app.staff_role() is not null and venue_id = any(app.staff_venue_ids())));

-- hold_slot: re-issued from 20260926000210_booking_settings_per_venue.sql:130
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $hold_slot_0225$
declare
  v_uid       uuid := auth.uid();
  v_court     courts%rowtype;
  v_end       timestamptz;
  v_period    tstzrange;
  v_ttl       int;
  v_rule      uuid;
  v_price     bigint;
  v_existing  reservations%rowtype;
  v_res       reservations%rowtype;
  v_horizon   int;
  v_max_holds int;
  v_live      int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0048 (C1): an anonymous session has no profiles row, so the old body wrote
  -- guest_id = NULL and produced a hold nobody could confirm, cancel or read --
  -- while it still occupied the exclusion constraint against real guests.
  -- Refuse with a distinct code instead of writing the orphan.
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001',
      hint = 'booking a court requires a signed-in account';
  end if;

  -- 0048 (H3): a replay must belong to this caller. The old lookup was by key
  -- alone and returned the found row's id + status -- a read RLS forbids.
  -- The raise deliberately carries no ids (0038 #7).
  if p_idempotency_key is not null then
    select * into v_existing from reservations where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.guest_id is distinct from v_uid then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another reservation';
      end if;
      return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
        'status', v_existing.status, 'hold_expires_at', v_existing.hold_expires_at);
    end if;
  end if;

  -- 0225: and at a branch that is open to guests.
  select * into v_court from courts
   where id = p_court_id and is_active
     and venue_id = any(app.open_venue_ids());
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (p_duration_min = any (v_court.duration_options)) then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;

  -- 0210: the court's branch for its TTL and horizon; the hold cap is the
  -- chain's (platform_settings, 0207), because the guest is.
  select hold_ttl_seconds, max_booking_horizon_days
    into v_ttl, v_horizon
    from venue_settings
   where venue_id = v_court.venue_id;
  select max_live_holds_per_guest into v_max_holds from platform_settings where id;
  perform set_config('app.venue_id', v_court.venue_id::text, true);

  -- 0048 (C1): the old body checked only `p_start_at > now()`, so a script
  -- could hold every court arbitrarily far into the future.
  if coalesce(v_horizon, 0) > 0
     and p_start_at > now() + make_interval(days => v_horizon) then
    raise exception 'BEYOND_HORIZON' using errcode = 'P0001',
      detail = v_horizon::text,
      hint = 'that date is further ahead than the venue takes bookings';
  end if;

  v_end := p_start_at + make_interval(mins => p_duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');

  -- BOOKING-HOURS GUARD (0026): closed dates + venue-local opening hours,
  -- ahead of every other business gate.
  perform app.assert_bookable(p_court_id, p_start_at, v_end);

  if p_start_at <= now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0001';
  end if;

  perform app.assert_not_degraded_for(p_start_at, v_court.venue_id);

  -- 0048 (C1): cap concurrent live holds per caller. `hold_expires_at > now()`
  -- excludes stale holds without depending on the sweep having run, and is not
  -- court-scoped -- the abuse is one identity holding across ALL courts.
  if coalesce(v_max_holds, 0) > 0 then
    select count(*) into v_live
      from reservations
     where guest_id = v_uid
       and kind = 'hold'
       and status = 'pending'
       and hold_expires_at > now();
    if v_live >= v_max_holds then
      raise exception 'HOLD_QUOTA_EXCEEDED' using errcode = 'P0001',
        detail = v_max_holds::text,
        hint = 'confirm or cancel an existing hold first';
    end if;
  end if;

  -- SERIALIZE (0042): last thing before the first write. Every cheap reject
  -- above returns without ever holding the lock; from here the critical
  -- section is sweep -> price -> insert -> AFTER triggers.
  perform app.lock_court(p_court_id);

  -- Lazy expiry: clear any expired-hold corpse in this range before inserting.
  perform app.expire_stale_holds(p_court_id, v_period);

  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(p_court_id, p_start_at, p_duration_min) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001',
      hint = 'no active rate rule prices this slot/duration';
  end if;

  begin
    -- 0117 (C5): the quote is STAMPED on the hold. Until now hold_slot returned a
    -- price and stored nothing, and confirm_booking re-resolved the rate, so a
    -- rule edited between the two charged the guest an amount they never saw.
    insert into reservations
      (venue_id, court_id, kind, status, start_at, end_at, guest_id, source,
       hold_expires_at, device_id, idempotency_key, client_ref,
       rate_rule_id, price_iqd)
    values
      (v_court.venue_id, p_court_id, 'hold', 'pending', p_start_at, v_end,
       v_uid,                                               -- 0048 (C1): guaranteed to exist
       'mobile',
       now() + make_interval(secs => coalesce(v_ttl, 300)),
       p_device_id, p_idempotency_key, p_client_ref,
       v_rule, v_price)
    returning * into v_res;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
    when unique_violation then
      -- Concurrent replay of the same idempotency key lost the insert race.
      if p_idempotency_key is not null then
        select * into v_existing from reservations where idempotency_key = p_idempotency_key;
        if found then
          if v_existing.guest_id is distinct from v_uid then
            raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
              hint = 'that key belongs to another reservation';
          end if;
          return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
            'status', v_existing.status, 'hold_expires_at', v_existing.hold_expires_at);
        end if;
      end if;
      raise;
  end;

  -- 0048 (C1): holds were the only reservation event with no attribution, so
  -- an abuse run left nothing to investigate.
  perform app.write_audit('reservation.hold', 'reservations', v_res.id::text,
                          null, to_jsonb(v_res), null, null, p_device_id);

  return jsonb_build_object('duplicate', false, 'reservation_id', v_res.id,
    'hold_expires_at', v_res.hold_expires_at, 'rate_rule_id', v_rule, 'price_iqd', v_price);
end $hold_slot_0225$;

-- open_table_session: re-issued from 20260926000211_cafe_settings_readers_per_venue.sql:49
create or replace function app.open_table_session(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $open_table_session_0225$
declare
  v_uid      uuid := auth.uid();
  v_table_id uuid;
  v_table    cafe_tables%rowtype;
  v_ttl      int;
  v_sess     guest_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001',
      hint = 'sign in anonymously before opening a table session';
  end if;

  v_table_id := app.verify_table_token(p_token);
  if v_table_id is null then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001',
      hint = 'ask staff for a fresh QR';
  end if;

  select * into v_table from cafe_tables where id = v_table_id;
  -- 0225: a table at a branch that is not open to guests is not a table yet.
  if v_table.id is null or not (v_table.venue_id = any(app.open_venue_ids())) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0211: the table's branch, for its TTL and for the session row's venue.
  select table_token_ttl_minutes into v_ttl from venue_settings where venue_id = v_table.venue_id;
  perform set_config('app.venue_id', v_table.venue_id::text, true);

  -- One live session per auth user: refresh on the same table, replace on a
  -- table switch (guest moved seats / rescanned another QR).
  select * into v_sess
    from guest_sessions
   where auth_user_id = v_uid and closed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;

  if found and v_sess.table_id = v_table_id then
    update guest_sessions
       set last_activity_at = now(),
           expires_at = now() + make_interval(mins => coalesce(v_ttl, 90))
     where id = v_sess.id
     returning * into v_sess;
  else
    if found then
      update guest_sessions set closed_at = now() where id = v_sess.id;
    end if;
    insert into guest_sessions (table_id, auth_user_id, linked_profile_id, expires_at)
    values (v_table_id, v_uid,
            (select id from profiles where id = v_uid),   -- null for anonymous users
            now() + make_interval(mins => coalesce(v_ttl, 90)))
    returning * into v_sess;
  end if;

  return jsonb_build_object(
    'session_id',   v_sess.id,
    'table_id',     v_table.id,
    'table_number', v_table.table_number,
    'bell_enabled', v_table.bell_enabled,
    'expires_at',   v_sess.expires_at,
    'venue_id',     v_table.venue_id);   -- 0225: the table's branch (the web menu follows it)
end $open_table_session_0225$;

create or replace function app.table_branch(p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $table_branch_0225$
declare
  v_table uuid;
begin
  v_table := app.verify_table_token(p_token);
  if v_table is null then
    return null;
  end if;
  return (select t.venue_id from cafe_tables t
           where t.id = v_table and t.is_active
             and t.venue_id = any(app.open_venue_ids()));
end
$table_branch_0225$;

comment on function app.table_branch(text) is
  '0225. The open branch a valid table QR token belongs to, or NULL (invalid token, inactive table, branch not open). Carries no guest data; the website''s server render uses it to show the right branch''s menu before the guest session binds.';

revoke all on function app.table_branch(text) from public;
grant execute on function app.table_branch(text) to anon, authenticated;

