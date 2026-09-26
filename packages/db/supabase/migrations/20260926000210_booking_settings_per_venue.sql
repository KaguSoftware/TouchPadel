set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0210_booking_settings_per_venue — multi-venue slice 2, step 4 (booking family).
--
-- Every booking body that read venue_settings unqualified now reads the row of
-- the branch the court (or reservation) belongs to. Each is re-issued from its
-- latest body with that one change:
--   price_slot (0139)            timezone of the court's branch
--   assert_bookable (0026)       hours, closed dates, timezone of the court's branch
--   assert_not_degraded_for      gains p_venue (default: the caller's resolved
--     (0008)                     venue, else the default branch); reads that
--                                branch's degraded state and horizon
--   hold_slot (0117)             hold TTL and horizon of the court's branch, the
--                                chain's per-guest hold cap (platform_settings,
--                                0207), the degraded check at the court's branch,
--                                and the hold row names the court's venue (a guest
--                                has no station or membership, so with two open
--                                branches the column default could not resolve)
--   confirm_booking (0147)       the degraded check at the reservation's branch
--   staff_create_reservation     hold TTL of the court's branch
--     (0147)
--   cancel_reservation (0088)    cancellation window of the reservation's branch
--   series_occurrences (0066)    gains p_venue for the branch timezone
--   preview_series (0066),       pass the court's branch to series_occurrences
--   create_series (0147)

-- price_slot: re-issued from 20260921000139_venue_axis_fixes.sql:155
create or replace function app.price_slot(p_court_id uuid, p_start_at timestamptz, p_duration_min int)
returns table (rule_id uuid, price_iqd bigint)
language sql stable security definer set search_path = public as $price_slot_0210$
  with loc as (
    select p_start_at at time zone coalesce((select vs.timezone from venue_settings vs where vs.venue_id = (select c.venue_id from courts c where c.id = p_court_id)), 'Asia/Baghdad') as lts
  )
  select r.id, (p.price_iqd)::bigint
    from rate_rules r
    join rate_rule_prices p on p.rule_id = r.id and p.duration_min = p_duration_min
    cross join loc
   where r.is_active
     and r.venue_id = (select c.venue_id from courts c where c.id = p_court_id)
     and (r.court_id is null or r.court_id = p_court_id)
     and extract(dow from loc.lts)::int = any (r.days_of_week)
     and ( (r.start_time <= r.end_time and loc.lts::time >= r.start_time and loc.lts::time < r.end_time)
        or (r.start_time >  r.end_time and (loc.lts::time >= r.start_time or loc.lts::time < r.end_time)) )
     and (r.valid_from is null or loc.lts::date >= r.valid_from)
     and (r.valid_to   is null or loc.lts::date <= r.valid_to)
   order by (r.court_id is not null) desc, r.priority desc, r.id
   limit 1
$price_slot_0210$;

-- assert_bookable: re-issued from 20260824000026_hardening_fixes.sql:103
create or replace function app.assert_bookable(
  p_court_id uuid,
  p_start_at timestamptz,
  p_end_at   timestamptz
) returns void
language plpgsql stable security definer set search_path = public as $assert_bookable_0210$
declare
  v_tz      text;
  v_closed  date[];
  v_hours   jsonb;
  v_ls      timestamp;                          -- venue-local wall clock
  v_le      timestamp;
  v_day     date;
  v_seg_s   interval;                           -- segment bounds since local midnight
  v_seg_e   interval;
  v_win     jsonb;
  v_ok      boolean;
begin
  -- 0210: the court's own branch (hours and closed dates are per venue since 0208).
  select timezone, closed_dates, opening_hours into v_tz, v_closed, v_hours
    from venue_settings
   where venue_id = (select c.venue_id from courts c where c.id = p_court_id);
  v_ls := p_start_at at time zone coalesce(v_tz, 'Asia/Baghdad');
  v_le := p_end_at   at time zone coalesce(v_tz, 'Asia/Baghdad');

  for v_day in
    select d::date
      from generate_series(v_ls::date, (v_le - interval '1 microsecond')::date,
                           interval '1 day') d
  loop
    if v_day = any (coalesce(v_closed, '{}')) then
      raise exception 'CLOSED_DATE' using errcode = 'P0001',
        detail = v_day::text, hint = 'the venue is closed on this date';
    end if;

    v_seg_s := greatest(v_ls, v_day::timestamp) - v_day::timestamp;
    v_seg_e := least(v_le, (v_day + 1)::timestamp) - v_day::timestamp;

    v_ok := false;
    for v_win in
      select * from jsonb_array_elements(
        coalesce(v_hours -> lower(to_char(v_day, 'Dy')), '[]'::jsonb))
    loop
      if v_seg_s >= (v_win ->> 0)::interval and v_seg_e <= (v_win ->> 1)::interval then
        v_ok := true;
        exit;
      end if;
    end loop;
    if not v_ok then
      raise exception 'OUTSIDE_HOURS' using errcode = 'P0001',
        detail = format('%s local %s-%s', v_day, v_seg_s, v_seg_e),
        hint = 'outside venue opening hours';
    end if;
  end loop;
end $assert_bookable_0210$;

-- assert_not_degraded_for: re-issued from 20260824000008_reservations.sql:62 with p_venue
drop function if exists app.assert_not_degraded_for(timestamptz);

create or replace function app.assert_not_degraded_for(p_start_at timestamptz, p_venue uuid default null)
returns void
language plpgsql security definer set search_path = public as $assert_not_degraded_for_0210$
declare
  v_venue   uuid := coalesce(p_venue, app.current_venue_or_default());
  v_horizon int;
begin
  if app.is_degraded(v_venue) then
    select protected_horizon_hours into v_horizon from venue_settings where venue_id = v_venue;
    if p_start_at < now() + make_interval(hours => coalesce(v_horizon, 48)) then
      raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
        hint = 'venue is trading offline; bookings inside the protected horizon are desk-only';
    end if;
  end if;
end $assert_not_degraded_for_0210$;

revoke all on function app.assert_not_degraded_for(timestamptz, uuid) from public, anon, authenticated;

-- hold_slot: re-issued from 20260920000117_quote_is_charge.sql:44
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $hold_slot_0210$
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

  select * into v_court from courts where id = p_court_id and is_active;
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
end $hold_slot_0210$;

-- confirm_booking: re-issued from 20260922000147_drop_reservation_players.sql:431
create or replace function app.confirm_booking(
  p_hold_id     uuid,
  p_guest_name  text default null,
  p_guest_phone text default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a phone on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players     int  default null
) returns jsonb
language plpgsql security definer set search_path = public as $confirm_booking_0210$
declare
  v_uid    uuid := auth.uid();
  v        reservations%rowtype;
  v_before jsonb;
  v_rule   uuid;
  v_price  bigint;
  v_dur    int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_hold_id for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not app.is_staff('court_desk','manager','owner')
     and v.guest_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Idempotent confirm.
  if v.kind = 'booking' and v.status = 'confirmed' then
    return jsonb_build_object('duplicate', true, 'reservation_id', v.id,
      'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
  end if;

  if v.kind <> 'hold' or v.status <> 'pending' or v.hold_expires_at < now() then
    raise exception 'HOLD_EXPIRED' using errcode = 'P0001';
  end if;

  -- DEGRADED GUARD (0021): guests cannot confirm inside the protected horizon
  -- while the venue trades offline; staff paths are unaffected.
  if not app.is_staff('court_desk','manager','owner') then
    perform app.assert_not_degraded_for(v.start_at, v.venue_id);
  end if;

  -- 0059: spec 05.3 makes the phone a required PROFILE field and the desk
  -- relies on it to reach a guest about their booking. Enforced only in the app
  -- until now; a social sign-in creates a phone-less profile, so the write path
  -- refuses too. Staff paths pass p_guest_phone and are exempt.
  if not app.is_staff('court_desk','manager','owner')
     and not exists (select 1 from profiles
                      where id = v_uid and nullif(btrim(phone), '') is not null) then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
      hint = 'add a phone number to your profile before confirming';
  end if;

  if v.guest_id is null and coalesce(p_guest_name, v.guest_name) is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001',
      hint = 'a booking needs guest_id or guest_name';
  end if;

  v_before := to_jsonb(v);
  v_dur := (extract(epoch from (v.end_at - v.start_at)) / 60)::int;

  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(v.court_id, v.start_at, v_dur) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001';
  end if;

  -- 0117 (C5): quote = charge. The hold carries the price the guest was shown
  -- (stamped by hold_slot since 0117). If the rate rules moved underneath the
  -- hold, refuse rather than charge an amount nobody agreed to; the app shows
  -- the new price and asks again. A hold from before 0117 has no stamp and
  -- keeps the old behaviour. Staff paths are exempt: the desk sees the current
  -- price on screen as it confirms.
  if v.price_iqd is not null and v.price_iqd <> v_price
     and not app.is_staff('court_desk','manager','owner') then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001',
      detail = jsonb_build_object('quoted_iqd', v.price_iqd, 'current_iqd', v_price,
                                  'rate_rule_id', v_rule)::text,
      hint = 'the price of this slot changed after it was held; hold it again to see the new price';
  end if;

  update reservations
     set kind            = 'booking',
         status          = 'confirmed',
         rate_rule_id    = v_rule,
         price_iqd       = v_price,
         guest_name      = coalesce(p_guest_name, guest_name),
         guest_phone     = coalesce(p_guest_phone, guest_phone),
         hold_expires_at = null
   where id = p_hold_id
   returning * into v;

  perform app.write_audit('reservation.confirm', 'reservations', v.id::text,
                          v_before, to_jsonb(v), null, null, v.device_id);

  return jsonb_build_object('duplicate', false, 'reservation_id', v.id,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
end $confirm_booking_0210$;

-- staff_create_reservation: re-issued from 20260922000147_drop_reservation_players.sql:56
create or replace function app.staff_create_reservation(
  p_court_id           uuid,
  p_kind               reservation_kind,
  p_start_at           timestamptz,
  p_end_at             timestamptz,
  p_guest_name         text default null,
  p_guest_phone        text default null,
  p_guest_id           uuid default null,
  p_notes              text default null,
  p_idempotency_key    text default null,
  p_client_ref         text default null,
  p_device_id          text default null,
  p_price_override_iqd bigint default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a till on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players            int default null
) returns jsonb
language plpgsql security definer set search_path = public as $staff_create_reservation_0210$
declare
  v_status   reservation_status;
  v_ttl      int;
  v_expires  timestamptz;
  v_rule     uuid;
  v_price    bigint;
  v_dur      int;
  v_existing reservations%rowtype;
  v_res      reservations%rowtype;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_end_at <= p_start_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from reservations where idempotency_key = p_idempotency_key;
    if found then
      -- 0048 (H3): scoped to the staff member who created it.
      if v_existing.created_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another reservation';
      end if;
      return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
        'status', v_existing.status);
    end if;
  end if;

  -- BOOKING-HOURS GUARD (0026): maintenance is exempt -- blocking time on a
  -- closed day (repairs, private events) is legitimate.
  if p_kind <> 'maintenance' then
    perform app.assert_bookable(p_court_id, p_start_at, p_end_at);
  end if;

  if p_kind = 'booking' and p_guest_id is null and p_guest_name is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042): same point in the sequence as hold_slot -- the desk and
  -- the guest app now queue for one court instead of racing into the GiST
  -- exclusion check and deadlocking there.
  perform app.lock_court(p_court_id);

  perform app.expire_stale_holds(p_court_id, tstzrange(p_start_at, p_end_at, '[)'));

  v_status := case when p_kind = 'hold' then 'pending' else 'confirmed' end;
  if p_kind = 'hold' then
    select hold_ttl_seconds into v_ttl from venue_settings where venue_id = (select c.venue_id from courts c where c.id = p_court_id);
    v_expires := now() + make_interval(secs => coalesce(v_ttl, 300));
  end if;

  if p_kind = 'booking' then
    v_dur := (extract(epoch from (p_end_at - p_start_at)) / 60)::int;
    select ps.rule_id, ps.price_iqd into v_rule, v_price
      from app.price_slot(p_court_id, p_start_at, v_dur) ps;
    if p_price_override_iqd is not null then
      -- Explicit price under manager/owner authority (odd ranges no rule
      -- prices, or a deliberate override). Audited below.
      if not app.is_staff('manager','owner') then
        raise exception 'FORBIDDEN' using errcode = 'P0001',
          hint = 'price overrides are manager/owner only';
      end if;
      if p_price_override_iqd < 0 then
        raise exception 'INVALID_PRICE' using errcode = 'P0001';
      end if;
      v_price := p_price_override_iqd;
      v_rule  := null;                          -- 0048: mark it as an override for H1
    elsif v_rule is null then
      -- 0026: an unpriced booking is never stored silently any more.
      raise exception 'NO_RATE' using errcode = 'P0001',
        hint = 'no rate rule prices this range - a manager/owner may pass p_price_override_iqd';
    end if;
  end if;

  begin
    insert into reservations
      (court_id, kind, status, start_at, end_at, guest_id, guest_name, guest_phone,
       created_by_staff_id, source, rate_rule_id, price_iqd, hold_expires_at,
       notes, device_id, idempotency_key, client_ref)
    values
      (p_court_id, p_kind, v_status, p_start_at, p_end_at, p_guest_id, p_guest_name,
       p_guest_phone, auth.uid(), 'desk', v_rule, v_price, v_expires,
       p_notes, p_device_id, p_idempotency_key, p_client_ref)
    returning * into v_res;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
    when unique_violation then
      if p_idempotency_key is not null then
        select * into v_existing from reservations where idempotency_key = p_idempotency_key;
        if found then
          if v_existing.created_by_staff_id is distinct from auth.uid() then
            raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
              hint = 'that key belongs to another reservation';
          end if;
          return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
            'status', v_existing.status);
        end if;
      end if;
      raise;
  end;

  perform app.write_audit('reservation.create', 'reservations', v_res.id::text,
                          null, to_jsonb(v_res), null, null, p_device_id);

  if p_kind = 'booking' and p_price_override_iqd is not null then
    perform app.write_audit('reservation.price_override', 'reservations', v_res.id::text,
                            null,
                            jsonb_build_object('price_override_iqd', p_price_override_iqd,
                                               'applied_by', auth.uid(),
                                               'rate_rule_id', v_rule),
                            'price_override', null, p_device_id);
  end if;

  return jsonb_build_object('duplicate', false, 'reservation_id', v_res.id,
    'status', v_res.status, 'rate_rule_id', v_rule, 'price_iqd', v_price);
end $staff_create_reservation_0210$;

-- cancel_reservation: re-issued from 20260911000088_cancelled_by.sql:114
create or replace function app.cancel_reservation(
  p_reservation_id uuid,
  p_reason         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $cancel_reservation_0210$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_staff  boolean;
  v_window int;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_CANCELLABLE' using errcode = 'P0001';
  end if;

  v_staff := app.is_staff('court_desk','manager','owner');
  if not v_staff then
    if v.guest_id is distinct from auth.uid() then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    select cancellation_window_hours into v_window from venue_settings where venue_id = v.venue_id;
    if v.start_at < now() + make_interval(hours => coalesce(v_window, 12)) then
      raise exception 'CANCELLATION_WINDOW' using errcode = 'P0001',
        hint = 'inside the cancellation window — contact the venue';
    end if;
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = p_reason,
         -- The SAME branch the policy above turned on: a staff caller reaches
         -- this line without owning the row or clearing the window, a guest
         -- only after proving both. Recording it costs nothing here and is
         -- unrecoverable afterwards from the reservation alone.
         cancelled_by = (case when v_staff then 'staff' else 'guest' end)::cancellation_actor
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.cancel', 'reservations', v.id::text,
                          v_before, to_jsonb(v), p_reason);

  return jsonb_build_object('reservation_id', v.id, 'status', v.status,
                            'cancelled_by', v.cancelled_by);
end $cancel_reservation_0210$;

-- series_occurrences: re-issued from 20260903000066_reservation_series.sql:101 with p_venue
drop function if exists app.series_occurrences(text, int[], time, int, date, date);

create or replace function app.series_occurrences(
  p_pattern      text,
  p_weekdays     int[],
  p_start_time   time,
  p_duration_min int,
  p_starts_on    date,
  p_ends_on      date,
  p_venue        uuid default null
) returns table (occ_date date, start_at timestamptz, end_at timestamptz)
language plpgsql stable security definer set search_path = public as $series_occurrences_0210$
declare
  v_tz    text;
  v_dates date[];
  v_wd    int;
begin
  if p_pattern is null or p_pattern not in ('weekly','fortnightly','weekdays') then
    raise exception 'INVALID_PATTERN' using errcode = 'P0001',
      hint = 'pattern: weekly | fortnightly | weekdays';
  end if;
  if p_pattern = 'weekdays' then
    if p_weekdays is null or coalesce(array_length(p_weekdays, 1), 0) = 0 then
      raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001',
        hint = 'weekdays: 0=Sun..6=Sat, at least one';
    end if;
    foreach v_wd in array p_weekdays loop
      if v_wd is null or v_wd < 0 or v_wd > 6 then
        raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001',
          detail = coalesce(v_wd::text, 'null'), hint = 'weekdays: 0=Sun..6=Sat';
      end if;
    end loop;
  end if;
  if p_start_time is null or p_starts_on is null or p_ends_on is null then
    raise exception 'INVALID_RANGE' using errcode = 'P0001',
      hint = 'start_time, starts_on and ends_on are required';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'INVALID_RANGE' using errcode = 'P0001',
      hint = 'ends_on must not precede starts_on';
  end if;
  if p_duration_min is null or p_duration_min <= 0 then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;
  -- Coarse bound BEFORE generating anything: even the sparsest pattern
  -- (fortnightly) exceeds the cap past this span, so no caller can make the
  -- generator walk years of days.
  if (p_ends_on - p_starts_on) >= 200 * 14 then
    raise exception 'SERIES_TOO_LONG' using errcode = 'P0001',
      hint = 'at most 200 occurrences per series';
  end if;

  select timezone into v_tz from venue_settings
   where venue_id = coalesce(p_venue, app.current_venue_or_default());
  v_tz := coalesce(v_tz, 'Asia/Baghdad');

  select array_agg(g.d::date order by g.d) into v_dates
    from generate_series(p_starts_on::timestamp, p_ends_on::timestamp,
                         case p_pattern when 'weekly'      then interval '7 days'
                                        when 'fortnightly' then interval '14 days'
                                        else                    interval '1 day' end) as g(d)
   where p_pattern <> 'weekdays' or extract(dow from g.d)::int = any (p_weekdays);

  if coalesce(array_length(v_dates, 1), 0) = 0 then
    raise exception 'SERIES_EMPTY' using errcode = 'P0001',
      hint = 'no date inside the range matches the pattern';
  end if;
  if array_length(v_dates, 1) > 200 then
    raise exception 'SERIES_TOO_LONG' using errcode = 'P0001',
      detail = array_length(v_dates, 1)::text, hint = 'at most 200 occurrences per series';
  end if;

  return query
    select u.d,
           ((u.d + p_start_time)::timestamp at time zone v_tz),
           ((u.d + p_start_time)::timestamp at time zone v_tz) + make_interval(mins => p_duration_min)
      from unnest(v_dates) as u(d)
     order by u.d;
end $series_occurrences_0210$;

revoke all on function app.series_occurrences(text, int[], time, int, date, date, uuid)
  from public, anon, authenticated;

-- preview_series: re-issued from 20260903000066_reservation_series.sql:218
create or replace function app.preview_series(
  p_court_id     uuid,
  p_pattern      text,
  p_weekdays     int[],
  p_start_time   time,
  p_duration_min int,
  p_starts_on    date,
  p_ends_on      date
) returns jsonb
language plpgsql stable security definer set search_path = public as $preview_series_0210$
declare
  v_occ      record;
  v_hit      record;
  v_reason   text;
  v_alts     uuid[];
  v_conflict jsonb;
  v_out      jsonb := '[]'::jsonb;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from courts where id = p_court_id and is_active) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_occ in
    select o.occ_date, o.start_at, o.end_at
      from app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                  p_starts_on, p_ends_on, (select c.venue_id from courts c where c.id = p_court_id)) o
     order by o.occ_date
  loop
    v_reason   := null;
    v_conflict := null;

    -- The same guard staff_create_reservation applies, asked instead of raised.
    begin
      perform app.assert_bookable(p_court_id, v_occ.start_at, v_occ.end_at);
    exception
      when raise_exception then
        if sqlerrm in ('CLOSED_DATE', 'OUTSIDE_HOURS') then
          v_reason := sqlerrm;
        else
          raise;
        end if;
    end;

    if v_reason is not null then
      v_conflict := jsonb_build_object(
        'existingReservationId', null,
        'existingKind',          null,
        'reason',                v_reason,
        'resolvable',            false,
        'alternativeCourtIds',   '[]'::jsonb);
    else
      select c.reservation_id, c.kind into v_hit
        from app.series_slot_conflict(p_court_id, v_occ.start_at, v_occ.end_at) c;
      if found then
        v_reason := 'SLOT_TAKEN';
      elsif not exists (select 1 from app.price_slot(p_court_id, v_occ.start_at, p_duration_min)) then
        v_reason := 'NO_RATE';
      end if;

      if v_reason is not null then
        select coalesce(array_agg(c.id order by c.sort_order, c.id), '{}'::uuid[]) into v_alts
          from courts c
         where c.is_active
           and c.id <> p_court_id
           and not exists (select 1 from app.series_slot_conflict(c.id, v_occ.start_at, v_occ.end_at))
           and exists (select 1 from app.price_slot(c.id, v_occ.start_at, p_duration_min));
        v_conflict := jsonb_build_object(
          'existingReservationId', case when v_reason = 'SLOT_TAKEN' then v_hit.reservation_id end,
          'existingKind',          case when v_reason = 'SLOT_TAKEN' then v_hit.kind::text end,
          'reason',                v_reason,
          'resolvable',            coalesce(array_length(v_alts, 1), 0) > 0,
          'alternativeCourtIds',   to_jsonb(v_alts));
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'date',     v_occ.occ_date,
      'startsAt', v_occ.start_at,
      'endsAt',   v_occ.end_at,
      'courtId',  p_court_id,
      'conflict', v_conflict);
  end loop;

  return jsonb_build_object('occurrences', v_out, 'count', jsonb_array_length(v_out));
end $preview_series_0210$;

-- create_series: re-issued from 20260922000147_drop_reservation_players.sql:203
create or replace function app.create_series(
  p_court_id        uuid,
  p_pattern         text,
  p_weekdays        int[],
  p_start_time      time,
  p_duration_min    int,
  p_starts_on       date,
  p_ends_on         date,
  p_guest_id        uuid  default null,
  p_guest_name      text  default null,
  p_guest_phone     text  default null,
  p_notes           text  default null,
  p_resolutions     jsonb default '[]'::jsonb,
  p_idempotency_key text  default null,
  p_device_id       text  default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a till on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players         int   default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_series_0210$
declare
  v_uid         uuid := auth.uid();
  v_resolutions jsonb := coalesce(p_resolutions, '[]'::jsonb);
  v_existing    reservation_series%rowtype;
  v_series      reservation_series%rowtype;
  v_r           jsonb;
  v_action      text;
  v_target      uuid;
  v_court       uuid;
  v_courts      uuid[];
  v_occ         record;
  v_res         jsonb;
  v_key         text;
  v_created     uuid[] := '{}'::uuid[];
  v_skipped     date[] := '{}'::date[];
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Idempotent replay, scoped to the staff member who created it (0048/H3).
  if p_idempotency_key is not null then
    select * into v_existing from reservation_series where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.created_by_staff_id is distinct from v_uid then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another series';
      end if;
      select coalesce(array_agg(r.id order by r.start_at, r.id), '{}'::uuid[]) into v_created
        from reservations r
       where r.series_id = v_existing.id;
      select coalesce(array_agg(o.occ_date order by o.occ_date), '{}'::date[]) into v_skipped
        from app.series_occurrences(v_existing.pattern, v_existing.weekdays, v_existing.start_time,
                                    v_existing.duration_min, v_existing.starts_on, v_existing.ends_on,
                                    v_existing.venue_id) o
       where not exists (select 1 from reservations r
                          where r.idempotency_key = p_idempotency_key || ':' || o.occ_date::text);
      return jsonb_build_object('duplicate', true, 'seriesId', v_existing.id,
        'created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
    end if;
  end if;

  if not exists (select 1 from courts where id = p_court_id and is_active) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_guest_id is null and coalesce(btrim(p_guest_name), '') = '' then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001',
      hint = 'a series needs guest_id or guest_name';
  end if;
  if p_guest_id is not null and not exists (select 1 from profiles where id = p_guest_id) then
    raise exception 'GUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Resolutions: shape-checked in full before anything is locked or written.
  if jsonb_typeof(v_resolutions) <> 'array' then
    raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
      hint = 'p_resolutions: [{date, action: skip | moveCourt, courtId}]';
  end if;
  for v_r in select * from jsonb_array_elements(v_resolutions) loop
    v_action := v_r ->> 'action';
    if jsonb_typeof(v_r) <> 'object' or v_action is null or v_action not in ('skip', 'moveCourt') then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'action: skip | moveCourt';
    end if;
    begin
      perform (v_r ->> 'date')::date;
    exception when others then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'date: YYYY-MM-DD';
    end;
    if v_r ->> 'date' is null then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'date: YYYY-MM-DD';
    end if;
    if v_action = 'moveCourt' then
      begin
        v_target := (v_r ->> 'courtId')::uuid;
      exception when others then
        v_target := null;
      end;
      if v_target is null or not exists (select 1 from courts where id = v_target and is_active) then
        raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
          detail = v_r::text, hint = 'moveCourt needs the id of an active court';
      end if;
    end if;
  end loop;

  -- Validate the pattern (INVALID_PATTERN / INVALID_WEEKDAYS / INVALID_RANGE /
  -- SERIES_EMPTY / SERIES_TOO_LONG) before the series row and before any lock.
  perform app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                 p_starts_on, p_ends_on, (select c.venue_id from courts c where c.id = p_court_id));

  -- SERIALIZE (0042): every court this series may write to, ascending, first.
  select array_agg(s.c order by s.c) into v_courts
    from (select p_court_id as c
          union
          select (r ->> 'courtId')::uuid
            from jsonb_array_elements(v_resolutions) r
           where r ->> 'action' = 'moveCourt') s;
  foreach v_court in array v_courts loop
    perform app.lock_court(v_court);
  end loop;

  -- The series row goes in FIRST so a concurrent replay of the same key queues
  -- on the unique index and then reads this series back instead of writing a
  -- second one.
  begin
    insert into reservation_series
      (court_id, pattern, weekdays, start_time, duration_min, starts_on, ends_on,
       guest_id, guest_name, guest_phone, notes, created_by_staff_id, idempotency_key)
    values
      (p_court_id, p_pattern, coalesce(p_weekdays, '{}'::int[]), p_start_time, p_duration_min,
       p_starts_on, p_ends_on, p_guest_id, nullif(btrim(p_guest_name), ''),
       nullif(btrim(p_guest_phone), ''), p_notes, v_uid, p_idempotency_key)
    returning * into v_series;
  exception
    when unique_violation then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'a series with this key was created concurrently - replay the call';
  end;

  for v_occ in
    select o.occ_date, o.start_at, o.end_at,
           (select r from jsonb_array_elements(v_resolutions) r
             where (r ->> 'date')::date = o.occ_date
             limit 1) as res
      from app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                  p_starts_on, p_ends_on) o
     order by o.occ_date
  loop
    v_action := v_occ.res ->> 'action';
    if v_action = 'skip' then
      v_skipped := v_skipped || v_occ.occ_date;
      continue;
    end if;
    v_target := case when v_action = 'moveCourt' then (v_occ.res ->> 'courtId')::uuid
                     else p_court_id end;
    v_key := case when p_idempotency_key is null then null
                  else p_idempotency_key || ':' || v_occ.occ_date::text end;

    -- THE insert path. Its refusals are this series' unresolved conflicts; any
    -- other error is a real fault and propagates unchanged.
    begin
      v_res := app.staff_create_reservation(
        p_court_id           => v_target,
        p_kind               => 'booking',
        p_start_at           => v_occ.start_at,
        p_end_at             => v_occ.end_at,
        p_guest_name         => v_series.guest_name,
        p_guest_phone        => v_series.guest_phone,
        p_guest_id           => v_series.guest_id,
        p_notes              => v_series.notes,
        p_idempotency_key    => v_key,
        p_client_ref         => null,
        p_device_id          => p_device_id,
        p_price_override_iqd => null);
    exception
      when raise_exception then
        if sqlerrm in ('SLOT_TAKEN', 'CLOSED_DATE', 'OUTSIDE_HOURS', 'NO_RATE') then
          raise exception 'SERIES_UNRESOLVED_CONFLICTS' using errcode = 'P0001',
            detail = v_occ.occ_date::text,
            hint = format('%s on %s - skip that date or move it to another court',
                          sqlerrm, v_occ.occ_date);
        end if;
        raise;
    end;

    -- A "duplicate" here means the per-occurrence key exists with no series
    -- behind it (a desk booking reused the key). Refuse rather than adopt it.
    if coalesce((v_res ->> 'duplicate')::boolean, false) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        detail = v_occ.occ_date::text,
        hint = 'an occurrence key already belongs to a reservation outside this series';
    end if;
    v_created := v_created || (v_res ->> 'reservation_id')::uuid;
  end loop;

  if coalesce(array_length(v_created, 1), 0) = 0 then
    raise exception 'SERIES_EMPTY' using errcode = 'P0001',
      hint = 'every occurrence was skipped';
  end if;

  update reservations
     set series_id = v_series.id
   where id = any (v_created);

  perform app.write_audit('series.create', 'reservation_series', v_series.id::text,
                          null,
                          to_jsonb(v_series)
                            || jsonb_build_object('created',     to_jsonb(v_created),
                                                  'skipped',     to_jsonb(v_skipped),
                                                  'resolutions', v_resolutions),
                          null, null, p_device_id);

  return jsonb_build_object('duplicate', false, 'seriesId', v_series.id,
    'created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
end $create_series_0210$;

