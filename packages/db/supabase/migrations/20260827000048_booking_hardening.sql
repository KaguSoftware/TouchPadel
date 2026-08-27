-- ===========================================================================
-- 0048 — booking hardening: C1 + H1..H5 from the 2026-08-27 padel audit
--
-- Every finding below was REPRODUCED against a live stack in
-- docs/design/padel-backend-audit-2026-08-27.md; that document is report-only
-- ("nothing below was implemented", :453) and no SQL shipped after it. This is
-- that implementation, plus the one table the RLS sweep missed.
--
--   C1  An anonymous session can block any court, unconfirmably.
--       app.handle_new_user (0004:35) returns early for is_anonymous, so an
--       anonymous caller has NO profiles row. hold_slot is granted to
--       `authenticated`, and Supabase anonymous sign-ins ARE `authenticated`,
--       so the hold landed with guest_id = NULL -- inside the
--       reservations_no_overlap exclusion constraint, and therefore blocking a
--       real guest -- while its own creator could not read it, confirm it or
--       cancel it (all three gate on `guest_id is distinct from auth.uid()`,
--       which is TRUE against NULL). Only the desk could clear it, one row at
--       a time. Reproduced: ONE anonymous identity took 12/12 holds in 127ms,
--       with no quota, no rate limit, no booking horizon and no audit row.
--       Fix: refuse the call outright (ACCOUNT_REQUIRED), cap live holds per
--       caller, enforce a booking horizon, and audit hold creation.
--
--   H1  move_reservation / extend_reservation never re-price. A desk move from
--       off-peak to peak kept the cheaper price. Real money, every day, with
--       no tooling to detect it. Fix: re-resolve app.price_slot on the written
--       range. A manual price override (rate_rule_id null, price_iqd set) is
--       deliberately PRESERVED -- re-pricing it would silently discard a
--       manager decision.
--
--   H2  Neither function called app.assert_bookable, so a move onto a closed
--       date or outside opening hours was accepted outright -- guards hold_slot
--       and staff_create_reservation have applied since 0026. Fix: call it.
--
--   H3  hold_slot / staff_create_reservation looked up an idempotency replay by
--       KEY ALONE and returned the found row's id + status. Reproduced: guest B
--       replayed guest A's key on a different court and received A's
--       reservation_id -- a read RLS correctly refuses (direct table read by B:
--       0 rows). 0038 fixed exactly this class for the cafe (#7) and never
--       touched the booking side. Fix: port 0038's caller-scoped check.
--
--   H4  rate_rules had ZERO check constraints, so start_time > end_time was
--       creatable from the admin UI's two free <input type="time">. SQL wraps
--       such a window (price_slot, 0007:60); packages/core/src/pricing/
--       rateRules.ts:79 refuses it (`if (end <= start) return false`).
--       Reproduced: a 22:00->02:00 rule made the app display 60 000 IQD while
--       hold_slot charged 90 000 -- a 30 000 IQD quote-vs-charge gap from a
--       configuration change alone. Fix: constrain start_time < end_time, which
--       is the semantic TS already assumes, and validate it at the RPC too.
--
--   H5  move/extend take lock_court on an UNLOCKED peek of court_id, then
--       re-resolve the court from the freshly-locked row. The deployed comment
--       asserts the two cannot differ; they can, because two concurrent movers
--       hold DIFFERENT lock pairs (T_a holds {C1,C2}, T_b peeked C1 and holds
--       {C1,C3}; after T_a commits, T_b re-reads C2 and writes it holding
--       neither C2 lock). The write then enters the exclusion window
--       unserialized against a hold_slot that DOES hold lock_court(C2) -- the
--       raw 40P01 that 0042 exists to eliminate. Not reproduced (needs a
--       three-way sub-millisecond interleave), but every step of the path is in
--       the deployed bodies. Fix: after FOR UPDATE, verify the row's court is
--       the one we locked; if not, raise 40001 so the caller retries.
--
--   +   app.pin_attempts was the ONLY table in the database without RLS. It is
--       not currently readable by a client (its sole grant is to service_role),
--       so this is a missing defence-in-depth layer rather than an open hole --
--       but it is a PIN-attempt oracle sitting in a PostgREST-exposed schema,
--       and it slipped through because Supabase's rls_auto_enable event trigger
--       only enforces the `public` schema.
--
--   +   The send-push cron was documented (0024:163-172, README:100-119) but
--       lived in NO migration, which is exactly why it was never scheduled --
--       verified live: notification_outbox has never been drained on the hosted
--       project. It is scheduled here, project-ref-free, via the same
--       app.secret() indirection app.telegram_nudge already uses (0032:258).
--
-- Signatures are unchanged throughout, so grants survive `create or replace`
-- and types.gen.ts sees no drift.
-- ===========================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Settings behind the C1 limits — tunable by the desk, no deploy needed
-- ═══════════════════════════════════════════════════════════════════════════
alter table venue_settings
  add column if not exists max_live_holds_per_guest int not null default 3,
  add column if not exists max_booking_horizon_days int not null default 180;

comment on column venue_settings.max_live_holds_per_guest is
  '0048/C1: cap on unexpired pending holds per auth.uid(). 0 disables the cap.';
comment on column venue_settings.max_booking_horizon_days is
  '0048/C1: how far ahead a guest may hold a slot. 0 disables the horizon. Default 180 is deliberately generous -- it exists to bound the C1 abuse (holds arbitrarily far out, forever), not to shorten the venue booking window; max_live_holds_per_guest is the tight constraint. Tighten here if Touch wants a shorter window.';

-- The guest app needs the horizon to stop rendering dates it cannot book.
-- create or replace can only APPEND a column, so it goes last (0026 order).
create or replace view venue_settings_public with (security_invoker = off) as
select venue_name,
       currency,
       timezone,
       opening_hours,
       closed_dates,
       protected_horizon_hours,
       cancellation_window_hours,
       table_token_ttl_minutes,
       phone,
       max_booking_horizon_days
  from venue_settings;

grant select on venue_settings_public to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. app.pin_attempts — RLS on, no policy (definer-only, as app.secrets 0014:357)
-- ═══════════════════════════════════════════════════════════════════════════
alter table app.pin_attempts enable row level security;
revoke all on table app.pin_attempts from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. H4 — rate_rules may not describe a midnight-crossing window
--
-- Added NOT VALID then validated separately so the push can never fail
-- half-way on the hosted project: if a violating row ever exists the VALIDATE
-- is the only thing that fails, and the constraint is already protecting new
-- writes by then. Verified 2026-08-27: zero violating rows locally or hosted.
-- ═══════════════════════════════════════════════════════════════════════════
do $rr$
begin
  if not exists (select 1 from pg_constraint where conname = 'rate_rules_time_order') then
    alter table rate_rules
      add constraint rate_rules_time_order check (start_time < end_time) not valid;
  end if;
end $rr$;

alter table rate_rules validate constraint rate_rules_time_order;

-- app.upsert_rate_rule — 0013 body + the time-order guard. Raising a named
-- error here means the admin UI shows "start must be before end" instead of a
-- raw 23514 from the constraint.
create or replace function app.upsert_rate_rule(
  p_name         text,
  p_days_of_week int[],
  p_start_time   time,
  p_end_time     time,
  p_prices       jsonb,
  p_id           uuid default null,
  p_court_id     uuid default null,
  p_priority     int default 0,
  p_valid_from   date default null,
  p_valid_to     date default null,
  p_is_active    boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $rate_0048$
declare
  v_before jsonb;
  v_row    rate_rules%rowtype;
  v_kv     record;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_court_id is not null and not exists (select 1 from courts where id = p_court_id) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_days_of_week is null or cardinality(p_days_of_week) = 0
     or exists (select 1 from unnest(p_days_of_week) d where d < 0 or d > 6) then
    raise exception 'INVALID_DAYS' using errcode = 'P0001',
      hint = 'days_of_week: 0=Sun..6=Sat, at least one';
  end if;

  -- 0048 (H4): a midnight-crossing window is priced by SQL (price_slot wraps)
  -- and refused by @touch/core (rateRules.ts:79), so the guest sees one price
  -- and is charged another. One semantic, enforced at the source.
  if p_start_time is null or p_end_time is null or p_start_time >= p_end_time then
    raise exception 'INVALID_TIME_RANGE' using errcode = 'P0001',
      hint = 'start_time must be before end_time; split an overnight window into two rules';
  end if;

  if p_prices is null or jsonb_typeof(p_prices) <> 'object' or p_prices = '{}'::jsonb then
    raise exception 'INVALID_PRICES' using errcode = 'P0001',
      hint = 'prices: {"<duration_min>": <price_iqd>, ...}';
  end if;

  if p_id is null then
    insert into rate_rules (name, court_id, days_of_week, start_time, end_time,
                            priority, valid_from, valid_to, is_active)
    values (p_name, p_court_id, p_days_of_week, p_start_time, p_end_time,
            p_priority, p_valid_from, p_valid_to, p_is_active)
    returning * into v_row;
  else
    select * into v_row from rate_rules where id = p_id for update;
    if not found then
      raise exception 'RULE_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update rate_rules
       set name = p_name, court_id = p_court_id, days_of_week = p_days_of_week,
           start_time = p_start_time, end_time = p_end_time, priority = p_priority,
           valid_from = p_valid_from, valid_to = p_valid_to, is_active = p_is_active
     where id = p_id
     returning * into v_row;
  end if;

  -- Replace per-duration prices wholesale.
  delete from rate_rule_prices where rule_id = v_row.id;
  for v_kv in select key, value from jsonb_each_text(p_prices) loop
    if v_kv.key !~ '^[0-9]+$' or v_kv.value !~ '^[0-9]+$' then
      raise exception 'INVALID_PRICES' using errcode = 'P0001',
        detail = format('bad entry %s: %s', v_kv.key, v_kv.value);
    end if;
    insert into rate_rule_prices (rule_id, duration_min, price_iqd)
    values (v_row.id, v_kv.key::int, v_kv.value::bigint);
  end loop;

  perform app.write_audit(
    case when v_before is null then 'rates.rule.create' else 'rates.rule.update' end,
    'rate_rules', v_row.id::text, v_before,
    to_jsonb(v_row) || jsonb_build_object('prices', p_prices));

  return v_row.id;
end $rate_0048$;
-- upsert_rate_rule grants unchanged (0013:588): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. C1 + H3 — hold_slot: account required, quota, horizon, audit, scoped replay
--
-- 0042 body, unchanged in structure and in lock ordering (every cheap reject
-- still returns before lock_court is ever taken). The four new guards are the
-- cheapest ones in the function and sit ahead of the lock too.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $hold_0048$
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
    insert into reservations
      (court_id, kind, status, start_at, end_at, guest_id, source,
       hold_expires_at, device_id, idempotency_key, client_ref)
    values
      (p_court_id, 'hold', 'pending', p_start_at, v_end,
       v_uid,                                               -- 0048 (C1): guaranteed to exist
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
end $hold_0048$;
-- hold_slot grants unchanged (0008): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. H3 — staff_create_reservation: caller-scoped replay
--
-- 0042 body verbatim apart from the two replay lookups. A desk key leaks less
-- than a guest key (staff RLS already permits reading reservations), but a
-- cashier replaying another cashier's key still got a nonsense "duplicate"
-- instead of an error -- 0038 gave that case the same treatment and so does
-- this.
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
language plpgsql security definer set search_path = public as $staff_0048$
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
end $staff_0048$;
-- staff_create_reservation grants unchanged (0026): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. H1 + H2 + H5 — move_reservation
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.move_reservation(
  p_reservation_id uuid,
  p_court_id       uuid default null,
  p_start_at       timestamptz default null,
  p_end_at         timestamptz default null,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $move_0048$
declare
  v          reservations%rowtype;
  v_before   jsonb;
  v_from     uuid;
  v_court    uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_dur      int;
  v_rule     uuid;
  v_price    bigint;
  v_override boolean;
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

  -- 0048 (H5): the lock set above was chosen from an UNLOCKED peek. The
  -- previous body asserted the locked court could not differ from that peek;
  -- it can, because two concurrent movers hold DIFFERENT pairs. Writing anyway
  -- would enter the exclusion window holding no lock on the court we write --
  -- the raw 40P01 that 0042 exists to eliminate. 40001 is retryable, which is
  -- exactly what the caller should do.
  if v.court_id is distinct from v_from then
    raise exception 'RESERVATION_MOVED' using errcode = '40001',
      hint = 'the reservation changed court while locks were acquired - retry';
  end if;

  v_before := to_jsonb(v);
  v_court := coalesce(p_court_id, v.court_id);
  v_start := coalesce(p_start_at, v.start_at);
  v_end   := coalesce(p_end_at, v.end_at);
  if v_end <= v_start then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  -- 0048 (H2): the previous body never re-validated, so a one-click desk move
  -- onto a closed date or outside opening hours was accepted outright --
  -- guards every other write path has honoured since 0026. Maintenance is
  -- exempt for the same reason it is in staff_create_reservation.
  if v.kind <> 'maintenance' then
    perform app.assert_bookable(v_court, v_start, v_end);
  end if;

  perform app.expire_stale_holds(v_court, tstzrange(v_start, v_end, '[)'));

  -- 0048 (H1): the previous body never re-priced, so moving a booking from
  -- off-peak to peak kept the cheaper price. A MANUAL OVERRIDE is preserved:
  -- rate_rule_id null with a price set means a manager priced this deliberately
  -- (staff_create_reservation, p_price_override_iqd) and re-pricing would
  -- silently discard that decision.
  v_override := (v.kind = 'booking' and v.rate_rule_id is null and v.price_iqd is not null);
  if v.kind = 'booking' and not v_override then
    v_dur := (extract(epoch from (v_end - v_start)) / 60)::int;
    select ps.rule_id, ps.price_iqd into v_rule, v_price
      from app.price_slot(v_court, v_start, v_dur) ps;
    if v_rule is null then
      raise exception 'NO_RATE' using errcode = 'P0001',
        hint = 'no rate rule prices the destination slot/duration';
    end if;
  else
    v_rule  := v.rate_rule_id;
    v_price := v.price_iqd;
  end if;

  begin
    update reservations
       set court_id = v_court, start_at = v_start, end_at = v_end,
           rate_rule_id = v_rule, price_iqd = v_price
     where id = p_reservation_id
     returning * into v;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
  end;

  -- write_audit already carries before/after, so the re-price is auditable.
  perform app.write_audit('reservation.move', 'reservations', v.id::text,
                          v_before, to_jsonb(v), coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'court_id', v.court_id,
    'start_at', v.start_at, 'end_at', v.end_at,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
end $move_0048$;
-- move_reservation grants unchanged (0026): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. H1 + H2 + H5 — extend_reservation
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.extend_reservation(
  p_reservation_id uuid,
  p_new_end_at     timestamptz,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $extend_0048$
declare
  v          reservations%rowtype;
  v_before   jsonb;
  v_from     uuid;
  v_dur      int;
  v_rule     uuid;
  v_price    bigint;
  v_override boolean;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042): same order as every other writer -- court, then row.
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

  -- 0048 (H5): see move_reservation. A concurrent move can have changed this
  -- reservation court out from under the peek that chose our lock.
  if v.court_id is distinct from v_from then
    raise exception 'RESERVATION_MOVED' using errcode = '40001',
      hint = 'the reservation changed court while locks were acquired - retry';
  end if;

  v_before := to_jsonb(v);

  -- 0048 (H2): extending past closing time was accepted outright.
  if v.kind <> 'maintenance' then
    perform app.assert_bookable(v.court_id, v.start_at, p_new_end_at);
  end if;

  perform app.expire_stale_holds(v.court_id, tstzrange(v.start_at, p_new_end_at, '[)'));

  -- 0048 (H1): extending a 60-minute booking to 120 kept the 60-minute price.
  -- Manual overrides are preserved, as in move_reservation.
  v_override := (v.kind = 'booking' and v.rate_rule_id is null and v.price_iqd is not null);
  if v.kind = 'booking' and not v_override then
    v_dur := (extract(epoch from (p_new_end_at - v.start_at)) / 60)::int;
    select ps.rule_id, ps.price_iqd into v_rule, v_price
      from app.price_slot(v.court_id, v.start_at, v_dur) ps;
    if v_rule is null then
      raise exception 'NO_RATE' using errcode = 'P0001',
        hint = 'no rate rule prices the extended duration';
    end if;
  else
    v_rule  := v.rate_rule_id;
    v_price := v.price_iqd;
  end if;

  begin
    update reservations
       set end_at = p_new_end_at, rate_rule_id = v_rule, price_iqd = v_price
     where id = p_reservation_id
     returning * into v;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
  end;

  perform app.write_audit('reservation.extend', 'reservations', v.id::text,
                          v_before, to_jsonb(v), coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'end_at', v.end_at,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
end $extend_0048$;
-- extend_reservation grants unchanged (0026): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. app.push_nudge + its cron job — the sender that was never scheduled
--
-- 0024:163-172 left this "configured at deploy, not in a migration" and
-- README:100-119 gave the SQL. Verified live on 2026-08-27: it was never run,
-- so notification_outbox has never been drained on the hosted project and no
-- booking notification has ever sent. The reason it was missed is that it
-- lived only in prose, so it lands here instead.
--
-- Project-ref-free, exactly as app.telegram_nudge (0032:258): the base URL and
-- the service-role key come from app.secret() (Vault first, app.secrets
-- fallback), so no migration references an environment. Unset => no-op, and
-- the outbox simply waits, which is the same degradation telegram_nudge has.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.push_nudge() returns void
language plpgsql security definer set search_path = public as $push_nudge$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from notification_outbox
                    where sent_at is null and attempts < 5 and scheduled_for <= now()) then
      return;
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/send-push',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'push_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $push_nudge$;

revoke all on function app.push_nudge() from public, anon, authenticated;

-- Same best-effort guard as 0021/0032: a local stack without pg_cron still resets.
do $push_cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_push_sweep not scheduled';
    return;
  end if;
  perform cron.schedule('tp_push_sweep', '* * * * *', 'select app.push_nudge();');
end $push_cron$;
