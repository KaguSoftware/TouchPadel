-- 0026_hardening_fixes — adversarial-review hardening sweep. Originals amended
-- in place (0004/0009/0011, 0008, 0015, 0021 — the 0009-0011 pattern); this
-- migration re-applies every changed body/signature for environments that
-- already ran them. Fresh resets apply the amended originals first, then this
-- file no-ops over identical definitions.
--
--  1. PIN brute-force (CRITICAL): verify_manager_pin rate-limit key was the
--     client-supplied p_device_id — rotating device ids gave unlimited guesses.
--     Attempts now keyed '{auth.uid()}:{device}'; failures COUNTED per caller.
--  2. app.assert_bookable — CLOSED_DATE + venue-local OUTSIDE_HOURS guard,
--     called first in hold_slot and staff_create_reservation (maintenance
--     exempt: blocking time on a closed day is legitimate).
--  3. staff_create_reservation: an unpriced booking raises NO_RATE instead of
--     silently storing price_iqd NULL; manager/owner may pass
--     p_price_override_iqd (audited, reason 'price_override').
--  4. Audit completeness: p_reason (default 'staff_op') on move/extend/mark
--     reservation audit rows; set_staff_pin writes 'staff.pin_set' (no PIN
--     material).
--  5. void_after_send: voiding below the net amount already paid raises
--     VOID_REQUIRES_REFUND (unwind path: app.refund). settle_tab counts paid
--     NET of refunds so the refund→void→settle-remainder unwind terminates
--     instead of dead-ending on ALREADY_PAID and blocking day close forever.
--  6. Degraded detection: device_heartbeats.is_till flag + app.heartbeat
--     p_is_till; is_degraded counts is_till OR the legacy 'TILL%' name prefix.
--  7. venue_settings.phone, surfaced through venue_settings_public (definer
--     view, anon+authenticated select — posture unchanged from 0006).
--
-- Signature changes (optional params appended) require DROP + CREATE: the old
-- overload would otherwise linger and make the RPC ambiguous. Grants re-issued.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PIN brute-force: per-caller rate-limit key (0004/0009/0011 amended)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := coalesce(auth.uid()::text, 'anon');
  v_key    text;
  v_fails  int;
  v_id     uuid;
begin
  -- RATE-LIMIT KEY (0026): p_device_id is client-supplied, so keying on it
  -- alone let a caller rotate device ids for unlimited guesses. Attempts are
  -- stored under '{caller}:{device}' and failures are COUNTED per caller
  -- (prefix match across all that caller's devices): 5 fails / 5 min / caller.
  v_key := v_caller || ':' || coalesce(p_device_id, 'unknown');

  select count(*) into v_fails
    from app.pin_attempts
   where device_id like v_caller || ':%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  select id into v_id
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash)
   limit 1;

  insert into app.pin_attempts (device_id, success) values (v_key, v_id is not null);

  -- Returns NULL on an invalid PIN instead of raising: a raise would roll back
  -- the attempt row above (PostgREST wraps each RPC in one transaction) and the
  -- 5-failure lockout could never engage. Callers treat NULL as PIN_INVALID;
  -- composite sensitive RPCs re-raise it themselves. Found by the RLS matrix
  -- suite against staging (lockout test).
  return v_id;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4b. set_staff_pin audit row (0004/0009 amended)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.set_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN_FORMAT' using errcode = 'P0001',
      hint = 'PIN must be 4-6 digits';
  end if;
  update staff
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   where id = p_staff_id and role in ('manager','owner') and is_active;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001',
      hint = 'PINs exist for active managers/owners only';
  end if;
  -- Audit the CHANGE, never the PIN (0026).
  perform app.write_audit('staff.pin_set', 'staff', p_staff_id::text,
                          null, jsonb_build_object('staff_id', p_staff_id));
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. app.assert_bookable — closed dates + venue-local opening hours (0008)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.assert_bookable(
  p_court_id uuid,
  p_start_at timestamptz,
  p_end_at   timestamptz
) returns void
language plpgsql stable security definer set search_path = public as $$
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
  select timezone, closed_dates, opening_hours into v_tz, v_closed, v_hours
    from venue_settings;
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
end $$;

revoke all on function app.assert_bookable(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2b. hold_slot — booking-hours guard wired in (0008 amended; signature same)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_court    courts%rowtype;
  v_end      timestamptz;
  v_period   tstzrange;
  v_ttl      int;
  v_rule     uuid;
  v_price    bigint;
  v_existing reservations%rowtype;
  v_res      reservations%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- Idempotent replay: same key => same answer, no second row.
  if p_idempotency_key is not null then
    select * into v_existing from reservations where idempotency_key = p_idempotency_key;
    if found then
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

  v_end := p_start_at + make_interval(mins => p_duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');

  -- BOOKING-HOURS GUARD (0026): closed dates + venue-local opening hours,
  -- ahead of every other business gate.
  perform app.assert_bookable(p_court_id, p_start_at, v_end);

  if p_start_at <= now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0001';
  end if;

  perform app.assert_not_degraded_for(p_start_at);

  -- Lazy expiry: clear any expired-hold corpse in this range before inserting.
  perform app.expire_stale_holds(p_court_id, v_period);

  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(p_court_id, p_start_at, p_duration_min) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001',
      hint = 'no active rate rule prices this slot/duration';
  end if;

  select hold_ttl_seconds into v_ttl from venue_settings;

  begin
    insert into reservations
      (court_id, kind, status, start_at, end_at, guest_id, source,
       hold_expires_at, device_id, idempotency_key, client_ref)
    values
      (p_court_id, 'hold', 'pending', p_start_at, v_end,
       (select id from profiles where id = v_uid),          -- null for anonymous sessions
       'mobile',
       now() + make_interval(secs => coalesce(v_ttl, 300)),
       p_device_id, p_idempotency_key, p_client_ref)
    returning * into v_res;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
    when unique_violation then
      -- Concurrent replay of the same idempotency key lost the insert race.
      if p_idempotency_key is not null then
        select * into v_existing from reservations where idempotency_key = p_idempotency_key;
        if found then
          return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
            'status', v_existing.status, 'hold_expires_at', v_existing.hold_expires_at);
        end if;
      end if;
      raise;
  end;

  return jsonb_build_object('duplicate', false, 'reservation_id', v_res.id,
    'hold_expires_at', v_res.hold_expires_at, 'rate_rule_id', v_rule, 'price_iqd', v_price);
end $$;
-- hold_slot grants unchanged (0008): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. staff_create_reservation — hours guard + NO_RATE / price override
--    (0008 amended; NEW SIGNATURE: p_price_override_iqd appended)
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text);

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
  p_price_override_iqd bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
      return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
        'status', v_existing.status);
    end if;
  end if;

  -- BOOKING-HOURS GUARD (0026): maintenance is exempt — blocking time on a
  -- closed day (repairs, private events) is legitimate.
  if p_kind <> 'maintenance' then
    perform app.assert_bookable(p_court_id, p_start_at, p_end_at);
  end if;

  if p_kind = 'booking' and p_guest_id is null and p_guest_name is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001';
  end if;

  perform app.expire_stale_holds(p_court_id, tstzrange(p_start_at, p_end_at, '[)'));

  v_status := case when p_kind = 'hold' then 'pending' else 'confirmed' end;
  if p_kind = 'hold' then
    select hold_ttl_seconds into v_ttl from venue_settings;
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
end $$;

revoke all on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint) from public, anon;
grant execute on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. move / extend / mark — p_reason recorded in the audit row
--    (0008 amended; NEW SIGNATURES: p_reason appended, default 'staff_op')
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists app.move_reservation(uuid, uuid, timestamptz, timestamptz);

create or replace function app.move_reservation(
  p_reservation_id uuid,
  p_court_id       uuid default null,
  p_start_at       timestamptz default null,
  p_end_at         timestamptz default null,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v         reservations%rowtype;
  v_before  jsonb;
  v_court   uuid;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_MOVABLE' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v);
  v_court := coalesce(p_court_id, v.court_id);
  v_start := coalesce(p_start_at, v.start_at);
  v_end   := coalesce(p_end_at, v.end_at);
  if v_end <= v_start then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  perform app.expire_stale_holds(v_court, tstzrange(v_start, v_end, '[)'));

  begin
    update reservations
       set court_id = v_court, start_at = v_start, end_at = v_end
     where id = p_reservation_id
     returning * into v;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
  end;

  perform app.write_audit('reservation.move', 'reservations', v.id::text,
                          v_before, to_jsonb(v), coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'court_id', v.court_id,
    'start_at', v.start_at, 'end_at', v.end_at);
end $$;

revoke all on function app.move_reservation(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function app.move_reservation(uuid, uuid, timestamptz, timestamptz, text) to authenticated;

drop function if exists app.extend_reservation(uuid, timestamptz);

create or replace function app.extend_reservation(
  p_reservation_id uuid,
  p_new_end_at     timestamptz,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        reservations%rowtype;
  v_before jsonb;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_EXTENDABLE' using errcode = 'P0001';
  end if;
  if p_new_end_at <= v.start_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v);

  perform app.expire_stale_holds(v.court_id, tstzrange(v.start_at, p_new_end_at, '[)'));

  begin
    update reservations
       set end_at = p_new_end_at
     where id = p_reservation_id
     returning * into v;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
  end;

  perform app.write_audit('reservation.extend', 'reservations', v.id::text,
                          v_before, to_jsonb(v), coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'end_at', v.end_at);
end $$;

revoke all on function app.extend_reservation(uuid, timestamptz, text) from public, anon;
grant execute on function app.extend_reservation(uuid, timestamptz, text) to authenticated;

drop function if exists app.mark_reservation(uuid, reservation_status);

create or replace function app.mark_reservation(
  p_reservation_id uuid,
  p_status         reservation_status,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_ok     boolean;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_ok := (p_status = 'arrived'   and v.status = 'confirmed')
       or (p_status = 'no_show'   and v.status = 'confirmed')
       or (p_status = 'completed' and v.status in ('confirmed','arrived'));
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  v_before := to_jsonb(v);

  update reservations set status = p_status
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.mark_' || p_status::text, 'reservations',
                          v.id::text, v_before, to_jsonb(v),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $$;

revoke all on function app.mark_reservation(uuid, reservation_status, text) from public, anon;
grant execute on function app.mark_reservation(uuid, reservation_status, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. void_after_send — VOID_REQUIRES_REFUND guard; settle_tab pays NET of
--    refunds (0015 amended; signatures unchanged)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.settle_tab(
  p_tab_id          uuid,
  p_method          payment_method,
  p_tendered_iqd    bigint default null,
  p_amount_iqd      bigint default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tab      tabs%rowtype;
  v_totals   record;
  v_paid     bigint;
  v_due      bigint;
  v_amount   bigint;
  v_change   bigint;
  v_payment  payments%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_payment from payments where idempotency_key = p_idempotency_key;
    if found then
      select * into v_tab from tabs where id = v_payment.tab_id;
      return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
        'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
    end if;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  -- Compute once; re-stamp (identical inputs => identical stamp) so a
  -- split-payment sequence keeps one consistent bill.
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         total_iqd    = v_totals.total_iqd
   where id = p_tab_id
   returning * into v_tab;

  -- Paid NET of refunds (0026): a refunded payment no longer counts toward the
  -- bill, so the refund-then-void unwind path can settle the remainder instead
  -- of dead-ending on ALREADY_PAID.
  select coalesce(sum(p.amount_iqd), 0)
       - coalesce((select sum(r.amount_iqd)
                     from refunds r
                     join payments p2 on p2.id = r.payment_id
                    where p2.tab_id = p_tab_id), 0)
    into v_paid
    from payments p where p.tab_id = p_tab_id;
  v_due := v_tab.total_iqd - v_paid;
  if v_due <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  v_amount := coalesce(p_amount_iqd, v_due);
  if v_amount < 1 or v_amount > v_due then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001',
      detail = format('due %s, got %s', v_due, v_amount);
  end if;

  if p_method = 'cash' then
    if p_tendered_iqd is null or p_tendered_iqd < v_amount then
      raise exception 'TENDER_SHORT' using errcode = 'P0001';
    end if;
    v_change := p_tendered_iqd - v_amount;     -- exact: cash_rounding_iqd default 1 = off
  else
    if p_tendered_iqd is not null then
      raise exception 'TENDER_CARD' using errcode = 'P0001',
        hint = 'tendered/change are cash-only fields';
    end if;
    v_change := null;
  end if;

  begin
    insert into payments (tab_id, day_session_id, method, amount_iqd, tendered_iqd,
                          change_iqd, recorded_by, device_id, idempotency_key)
    values (p_tab_id, v_tab.day_session_id, p_method, v_amount, p_tendered_iqd,
            v_change, auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_payment;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_payment from payments where idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
          'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
      end if;
    end if;
    raise;
  end;

  if v_paid + v_amount >= v_tab.total_iqd then
    update tabs set status = 'settled', settled_at = now()
     where id = p_tab_id returning * into v_tab;
    perform app.write_audit('tab.settle', 'tabs', v_tab.id::text,
                            null, to_jsonb(v_tab), null, null, p_device_id);
  else
    update tabs set status = 'awaiting_payment'
     where id = p_tab_id returning * into v_tab;
  end if;

  return jsonb_build_object('duplicate', false, 'payment_id', v_payment.id,
    'tab_id', v_tab.id, 'status', v_tab.status,
    'subtotal_iqd', v_tab.subtotal_iqd, 'discount_iqd', v_tab.discount_iqd,
    'tax_iqd', v_tab.tax_iqd, 'total_iqd', v_tab.total_iqd,
    'amount_iqd', v_amount, 'change_iqd', v_change,
    'remaining_iqd', greatest(v_tab.total_iqd - v_paid - v_amount, 0));
end $$;

create or replace function app.void_after_send(
  p_order_item_id uuid,
  p_pin           text,
  p_reason_code   text,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_auth      uuid;
  v_oi        order_items%rowtype;
  v_order     orders%rowtype;
  v_tab       tabs%rowtype;
  v_before    jsonb;
  v_paid      bigint;
  v_new_total bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  select * into v_oi from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    return jsonb_build_object('duplicate', true, 'order_item_id', v_oi.id);
  end if;

  select * into v_order from orders where id = v_oi.order_id for update;
  select * into v_tab from tabs where id = v_order.tab_id;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001',
      hint = 'a settled line comes back via app.refund';
  end if;

  v_before := to_jsonb(v_oi);

  update order_items
     set voided = true, void_reason_code = p_reason_code
   where id = p_order_item_id
   returning * into v_oi;

  -- VOID-AFTER-PAYMENT GUARD (0026): with the line struck, the tab total must
  -- still cover what has already been paid net of refunds — otherwise raise
  -- (rolling the void back). app.refund is the unwind path.
  select coalesce(sum(p.amount_iqd), 0)
       - coalesce((select sum(r.amount_iqd)
                     from refunds r
                     join payments p2 on p2.id = r.payment_id
                    where p2.tab_id = v_tab.id), 0)
    into v_paid
    from payments p where p.tab_id = v_tab.id;
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(v_tab.id) t;
    if v_new_total < v_paid then
      raise exception 'VOID_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-void total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before voiding';
    end if;
  end if;

  -- STOCK HOOK (0018): a 'void_after_send' waste movement per consumed
  -- ingredient of this line is wired here by the stock drop (the food was
  -- already made — it is waste, not a stock reversal).

  if not exists (select 1 from order_items
                  where order_id = v_order.id and not voided) then
    update orders set status = 'voided' where id = v_order.id;
    update tickets set status = 'voided' where order_id = v_order.id
       and status <> 'voided';
  end if;

  perform app.write_audit('order_item.void', 'order_items', v_oi.id::text,
                          v_before, to_jsonb(v_oi), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('duplicate', false, 'order_item_id', v_oi.id);
end $$;
-- settle_tab / void_after_send grants unchanged (0015): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Degraded detection: is_till flag (0021 amended)
-- ═══════════════════════════════════════════════════════════════════════════
alter table device_heartbeats
  add column if not exists is_till boolean not null default false;

create or replace function app.is_degraded() returns boolean
language sql stable security definer set search_path = public as $$
  -- A till is a row flagged is_till (0026) OR named 'TILL%' (back-compat with
  -- clients that predate the flag).
  select exists (select 1 from device_heartbeats
                  where is_till or device_id like 'TILL%')
     and not exists (
       select 1 from device_heartbeats
        where (is_till or device_id like 'TILL%')
          and last_seen_at > now() - make_interval(
                secs => (select heartbeat_stale_seconds from venue_settings))
     )
$$;

revoke all on function app.is_degraded() from public;
grant execute on function app.is_degraded() to anon, authenticated;

drop function if exists app.heartbeat(text, int, text);

create or replace function app.heartbeat(
  p_device_id   text,
  p_queue_depth int default 0,
  p_app_version text default null,
  p_is_till     boolean default false           -- 0026: explicit till identification
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_device_id is null or p_device_id = '' then
    raise exception 'DEVICE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into device_heartbeats (device_id, last_seen_at, queue_depth, app_version, is_till)
  values (p_device_id, now(), greatest(coalesce(p_queue_depth, 0), 0), p_app_version,
          coalesce(p_is_till, false))
  on conflict (device_id) do update
     set last_seen_at = excluded.last_seen_at,
         queue_depth  = excluded.queue_depth,
         app_version  = coalesce(excluded.app_version, device_heartbeats.app_version),
         -- Sticky: once a device has identified as a till it stays one — an
         -- older client build omitting the flag must not undo detection.
         is_till      = device_heartbeats.is_till or excluded.is_till;

  perform app.sweep_degraded_periods();

  return jsonb_build_object('degraded', app.is_degraded(), 'server_time', now());
end $$;

revoke all on function app.heartbeat(text, int, text, boolean) from public, anon;
grant execute on function app.heartbeat(text, int, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Venue phone for the degraded message (0006 view re-issued here only —
--    CREATE OR REPLACE appends the column; posture identical: definer view,
--    anon + authenticated select, base table stays staff-read behind RLS)
-- ═══════════════════════════════════════════════════════════════════════════
alter table venue_settings add column if not exists phone text;

create or replace view venue_settings_public with (security_invoker = off) as
select venue_name,
       currency,
       timezone,
       opening_hours,
       closed_dates,
       protected_horizon_hours,
       cancellation_window_hours,
       table_token_ttl_minutes,
       phone
  from venue_settings;

grant select on venue_settings_public to anon, authenticated;
