-- 0042_booking_serialization — kill the 40P01 in the reservation write path.
--
-- SYMPTOM (CI run #17, tests/concurrency.test.ts case 2):
--   AssertionError: expected 'deadlock detected' to contain 'SLOT_TAKEN'
--
-- CAUSE. `reservations_no_overlap` (0008) is a GiST EXCLUSION constraint.
--   Unlike a unique index — which uses speculative-insertion tokens so a loser
--   is arbitrated deterministically — an exclusion check inserts the heap tuple
--   FIRST and only then scans the index, doing XactLockTableWait() on any
--   conflicting *uncommitted* tuple. Two overlapping inserters can therefore
--   each land a tuple and each end up waiting on the other's xid: a genuine
--   lock cycle, resolved by the deadlock detector shooting one of them with
--   40P01. 40P01 is not 23P01, so the `when exclusion_violation` handler never
--   runs and the caller sees the raw 'deadlock detected' instead of the
--   contractual SLOT_TAKEN (design-data.md §6.1 case 1).
--   Nothing serialized the writers: hold_slot / staff_create_reservation ran
--   validate -> expire_stale_holds -> INSERT with no advisory lock and no row
--   lock on anything court-shaped.
--
--   Second, smaller window: app.expire_stale_holds (0008) is a bare UPDATE with
--   no deterministic row order, and the per-minute pg_cron sweep (tp_hold_sweep,
--   0021) runs the same UPDATE unfiltered over the whole table. Two unordered
--   multi-row UPDATEs over the same rows can cycle on their own.
--
-- FIX.
--   1. app.lock_court(uuid) — a transaction-scoped advisory lock keyed on the
--      court. Every writer that can enter the exclusion window takes it BEFORE
--      touching a reservation row, so at most one such transaction per court is
--      ever inside the window. The loser then meets a COMMITTED conflicting row
--      and gets a clean 23P01 -> SLOT_TAKEN.
--   2. app.expire_stale_holds — locks its victims in `id` order, so the RPC
--      sweeps and the cron sweep can only block each other, never cycle.
--   3. hold_slot / staff_create_reservation / move_reservation /
--      extend_reservation re-issued with the lock taken first. move/extend used
--      to take `SELECT ... FOR UPDATE` on the row before expire_stale_holds —
--      the opposite order from the create paths — so they are restructured to
--      take the court lock first (both courts, least/greatest, on a cross-court
--      move: the merge_tabs idiom from 0015).
--   confirm_booking / cancel_reservation / mark_reservation are untouched: they
--   mutate `status` by primary key and never move `period`, so they cannot
--   enter the exclusion window.
--
--   Signatures are unchanged throughout (create or replace preserves grants;
--   no types.gen.ts drift). Cost: writes on ONE court serialize for the length
--   of one transaction — single-digit ms, against a handful of courts.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. app.lock_court — the serialization point
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.lock_court(p_court_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_court_id is not null then
    -- Namespaced key: nothing else in this schema uses advisory locks.
    -- xact-scoped => released on COMMIT or ROLLBACK, no leak path.
    perform pg_advisory_xact_lock(hashtextextended('app.reservations:court:' || p_court_id::text, 0));
  end if;
end $$;

revoke all on function app.lock_court(uuid) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. app.expire_stale_holds — same contract, deterministic lock order
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  -- Ordered FOR UPDATE: the scoped RPC sweeps and the unfiltered pg_cron sweep
  -- (tp_hold_sweep) now take row locks in the same sequence, so they queue
  -- instead of deadlocking.
  update reservations
     set status = 'expired'
   where id in (
     select id from reservations
      where kind = 'hold' and status = 'pending'
        and hold_expires_at < now()
        and (p_court_id is null or court_id = p_court_id)
        and (p_period is null or period && p_period)
      order by id
      for update
   );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. hold_slot — 0026 body + the court lock (signature unchanged)
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
-- 4. staff_create_reservation — 0026 body + the court lock (signature unchanged)
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- SERIALIZE (0042): same point in the sequence as hold_slot — the desk and
  -- the guest app now queue for one court instead of racing into the GiST
  -- exclusion check and deadlocking there.
  perform app.lock_court(p_court_id);

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
-- staff_create_reservation grants unchanged (0026): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. move_reservation — court lock BEFORE the row lock (signature unchanged)
-- ═══════════════════════════════════════════════════════════════════════════
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
  v_from    uuid;
  v_court   uuid;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042). Unlocked peek first, only to learn which court(s) this
  -- move touches; every guard below still runs against the FOR UPDATE read.
  select court_id into v_from from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_court := coalesce(p_court_id, v_from);

  -- Cross-court move touches two exclusion scopes: take them in a total order
  -- so two opposing moves queue instead of deadlocking (merge_tabs, 0015).
  if v_court = v_from then
    perform app.lock_court(v_from);
  else
    perform app.lock_court(least(v_from, v_court));
    perform app.lock_court(greatest(v_from, v_court));
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_MOVABLE' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v);
  -- Re-resolve against the locked row. v.court_id cannot differ from the peek:
  -- changing it requires the advisory lock this transaction is holding.
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
-- move_reservation grants unchanged (0026): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. extend_reservation — court lock BEFORE the row lock (signature unchanged)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.extend_reservation(
  p_reservation_id uuid,
  p_new_end_at     timestamptz,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_from   uuid;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042): same order as every other writer — court, then row.
  select court_id into v_from from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.lock_court(v_from);

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
-- extend_reservation grants unchanged (0026): replace preserves them.
