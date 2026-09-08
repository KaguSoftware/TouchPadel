-- 0058_release_hold — a guest can hand an unconfirmed hold back.
--
-- FINDING (from a device, 2026-09-01). Tapping three different times on
-- Availability and backing out of Review each time leaves THREE live holds:
-- Review's back is a plain pop, so nothing releases the slot. The per-account
-- cap from 0048/C1 (venue_settings.max_live_holds_per_guest, default 3) then
-- refuses the fourth tap with HOLD_QUOTA_EXCEEDED, and the guest cannot book
-- anything at all until hold_ttl_seconds runs out — while three slots sit dark
-- for every other guest.
--
-- WHY NO EXISTING RPC COULD DO IT. app.cancel_reservation (0008:601-605)
-- applies venue_settings.cancellation_window_hours (default 12) to every
-- non-staff caller, so releasing a hold for tonight raises CANCELLATION_WINDOW.
-- That policy protects a CONFIRMED booking the venue has promised someone; an
-- unconfirmed hold is checkout state and needs its own verb. This is the
-- HANDOFF gap "needs a new app.release_hold()".
--
-- SHAPE, and the reason for each line:
--   * HOLDS ONLY. A confirmed booking still goes through cancel_reservation and
--     its window — this is not a way around that policy.
--   * OWN holds, and only for a real account. Mirrors 0048/C1: an anonymous
--     session can never own a hold, and the ACCOUNT_REQUIRED refusal is also
--     what scripts/check-rpc-authz.mjs's null-argument sweep asserts.
--   * IDEMPOTENT. The client releases on unmount, which races the countdown and
--     the pg_cron sweep, and can re-fire on a transport retry. A hold that is
--     already expired/cancelled returns its status instead of raising, so the
--     guest never sees an error for work that is already done.
--   * status = 'expired', matching app.expire_stale_holds. An abandoned hold is
--     not a cancelled BOOKING and must not read as one in desk history or in
--     analytics; the audit action 'reservation.release' is what separates a
--     deliberate hand-back from the TTL sweep.
--   * NO app.lock_court(). Status-only write by primary key that LEAVES the
--     exclusion set, exactly like cancel_reservation and expire_stale_holds —
--     0042's stated exemption, listed in scripts/check-lock-order.mjs.
--
-- The reservations_rt trigger (0022) fires on the status change, so the slot
-- returns to every open grid over realtime without any extra plumbing.

create or replace function app.release_hold(p_reservation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $release_hold_0058$
declare
  v_uid    uuid := auth.uid();
  v        reservations%rowtype;
  v_before jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0048/C1 parity: only an account can own a hold, so only an account can
  -- release one. Checked BEFORE the argument is used (check-rpc-authz.mjs).
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001',
      hint = 'releasing a hold requires a signed-in account';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Ownership before kind: a caller must never learn what someone else's
  -- reservation is by the shape of the refusal (0038 #7 / 0048 H3).
  if v.guest_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v.kind <> 'hold' then
    raise exception 'NOT_A_HOLD' using errcode = 'P0001',
      hint = 'confirmed bookings are cancelled through cancel_reservation';
  end if;

  -- Already gone (swept, released twice, or cancelled at the desk): report the
  -- state, do not raise. Releasing is idempotent by design.
  if v.status <> 'pending' then
    return jsonb_build_object('reservation_id', v.id, 'status', v.status,
      'released', false);
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = 'expired'
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.release', 'reservations', v.id::text,
                          v_before, to_jsonb(v), 'guest_released');

  return jsonb_build_object('reservation_id', v.id, 'status', v.status,
    'released', true);
end $release_hold_0058$;

comment on function app.release_hold(uuid) is
  '0058: guest hands back an OWN unconfirmed hold (kind=hold, status=pending) -> expired. Idempotent. Not a path around cancellation_window_hours: confirmed bookings still go through app.cancel_reservation.';

revoke all on function app.release_hold(uuid) from public, anon;
grant execute on function app.release_hold(uuid) to authenticated;
