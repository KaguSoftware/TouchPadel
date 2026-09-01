-- 0059 — confirm_booking: a guest needs a phone on their profile (spec 05.3).
--
-- BEHAVIOUR CHANGE ON A CONTRACTUAL RPC (app.confirm_booking, 0008 -> 0021).
-- Kept in its own file, apart from 0058, so it gets an independent SEC
-- line-review and can be deferred or reverted on its own: 0058 is a pure
-- bootstrap fix; this one refuses a write that used to succeed.
--
-- WHY: design spec 05.3 makes the phone a REQUIRED profile field -- the desk
-- relies on it to reach a guest about their booking. Until now the rule lived
-- only in the mobile app (validateSignUp), and the profile-edit screen could
-- clear it. With social sign-in (0058) a profile is created with NO phone at
-- all, so the write path has to hold the rule too: confirm_booking refuses a
-- non-staff caller whose profile carries no phone with PHONE_REQUIRED.
-- hold_slot is untouched -- a hold still needs only an account
-- (ACCOUNT_REQUIRED, 0048/C1) so the app can take the slot first and ask for
-- the phone while the hold ticks; the booking is refused, never the hold.
--
-- Staff paths (court_desk / manager / owner) are exempt: they confirm on the
-- guest's behalf and pass p_guest_phone / p_guest_name directly.
--
-- Guard order (unchanged ahead of the addition):
--   AUTH_REQUIRED -> HOLD_NOT_FOUND -> FORBIDDEN (ownership) -> idempotent
--   duplicate return -> HOLD_EXPIRED -> DEGRADED (0021) -> PHONE_REQUIRED (new)
--   -> GUEST_REQUIRED -> NO_RATE.
-- The ownership refusal and the idempotent replay stay ahead of the new guard:
-- a non-owner learns FORBIDDEN and nothing else (check-rpc-authz ownership
-- stage), and a duplicate confirm of an already-confirmed booking still returns
-- {duplicate:true} even if the guest has since cleared their phone.
--
-- Safety: same signature (uuid, text, text), so the 0008:704-705 grants and
-- types.gen.ts are unaffected. The body is the 0021 L217-291 body VERBATIM
-- plus the one guard; the degraded guard (0021) and the idempotent
-- duplicate-confirm return (0008) are preserved. No lock beyond the function's
-- own, no table rewrite, no backfill.
--
-- PRE-PUSH CHECK on the hosted project (expect ~0 -- every existing account
-- came through email/password sign-up, where the app requires the phone):
--   select count(*) from profiles where nullif(btrim(phone), '') is null;
-- A non-zero count is the number of guests who will see PHONE_REQUIRED until
-- they add a phone in the app. That is the intended product behaviour, but the
-- number must be known before this ships.
--
-- Rollback: re-run the 0021 L217-291 body.

create or replace function app.confirm_booking(
  p_hold_id     uuid,
  p_guest_name  text default null,
  p_guest_phone text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
end $$;
-- confirm_booking grants unchanged (0008:704-705): replace preserves them.
