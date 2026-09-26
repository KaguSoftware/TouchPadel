-- ===========================================================================
-- 0117 — quote = charge on the guest booking path (C5).
--
-- THE DEFECT. app.hold_slot priced the slot (app.price_slot), returned that
-- price to the app, and stored NEITHER rate_rule_id NOR price_iqd on the hold
-- (0048:342-351). app.confirm_booking then re-resolved the rate from scratch
-- (0092:545-551) and stamped whatever it found. A rate rule edited, retired or
-- added between the two calls charged the guest an amount they had not seen —
-- and there was no error code for it, so nothing in the app could say so.
--
-- THE FIX.
--   * hold_slot (re-issued from 0048 verbatim) stamps rate_rule_id and price_iqd
--     on the hold row at insert. Same columns a confirmed booking uses, so a
--     hold now explains its own price.
--   * confirm_booking (re-issued from 0092 verbatim) still re-prices — the rule
--     is the source of truth for what is CHARGED — but if the hold carries a
--     stamp and the two disagree, a GUEST is refused with PRICE_CHANGED (detail:
--     quoted vs current, so the app can show both) instead of being charged
--     silently. Staff confirming at the desk are exempt: they see the live
--     price on screen. A hold created before this migration has no stamp and
--     behaves as before; the sweep clears those within their TTL anyway.
--
-- Milestone 2 (online deposits) depends on this: the amount a guest pays is
-- the amount the hold was quoted at, and confirm_hold_internal will honour it.
--
-- Nothing else changes: signatures, grants (create or replace keeps them), the
-- lock order (lock_court before the insert, as 0042/0048), the sweep, the
-- idempotency branches.
--
-- Clients: apps/mobile maps PRICE_CHANGED to a "price changed, hold again"
-- message on the review screen; MAPPED_CODES in the operator is untouched
-- (staff never receive it).
--
-- covered by packages/db/tests/booking-quote.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.hold_slot — re-issued IN FULL from 20260827000048_booking_hardening.sql ($hold_0048$); the insert
-- gains rate_rule_id + price_iqd. Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $hold_slot_0117$
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

  select hold_ttl_seconds, max_live_holds_per_guest, max_booking_horizon_days
    into v_ttl, v_max_holds, v_horizon
    from venue_settings;

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

  perform app.assert_not_degraded_for(p_start_at);

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
      (court_id, kind, status, start_at, end_at, guest_id, source,
       hold_expires_at, device_id, idempotency_key, client_ref,
       rate_rule_id, price_iqd)
    values
      (p_court_id, 'hold', 'pending', p_start_at, v_end,
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
end $hold_slot_0117$;

-- ---------------------------------------------------------------------------
-- app.confirm_booking — re-issued IN FULL from 20260913000092_reservation_players.sql
-- ($confirm_booking_0092$); the PRICE_CHANGED guard is added after the re-price.
-- Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.confirm_booking(
  p_hold_id     uuid,
  p_guest_name  text default null,
  p_guest_phone text default null,
  p_players     int  default null
) returns jsonb
language plpgsql security definer set search_path = public as $confirm_booking_0117$
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
  -- 0092: group size is 1..8 or unknown (NULL). Refused before the row lock.
  if p_players is not null and (p_players < 1 or p_players > 8) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_players';
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
    perform app.assert_not_degraded_for(v.start_at);
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
         players         = coalesce(p_players, players),
         hold_expires_at = null
   where id = p_hold_id
   returning * into v;

  perform app.write_audit('reservation.confirm', 'reservations', v.id::text,
                          v_before, to_jsonb(v), null, null, v.device_id);

  return jsonb_build_object('duplicate', false, 'reservation_id', v.id,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
end $confirm_booking_0117$;
