-- 0008_reservations — THE contractual core.
--
--  * exclusion constraint: no two live reservations overlap on one court, enforced
--    by the database, not by application code.
--  * holds: TTL rows, lazily expired inside every writing RPC (the constraint
--    predicate cannot reference now()), swept by pg_cron from 0017.
--  * hold -> booking is an UPDATE in place, so exclusion protection is continuous.
--  * every mutating function: SECURITY DEFINER, search_path pinned, revoke from
--    public, explicit grants; audit rows written atomically.
--  * app.is_degraded() is a STUB (false) until 0017; the guard is already wired
--    INLINE into guest write RPCs (resolved override #5).

create table reservations (
  id                  uuid primary key default gen_random_uuid(),
  court_id            uuid not null references courts(id),
  kind                reservation_kind not null,
  status              reservation_status not null default 'pending',
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  period              tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  guest_id            uuid references profiles(id),
  guest_name          text,                    -- walk-in without account
  guest_phone         text,
  created_by_staff_id uuid references staff(id),
  source              reservation_source not null,
  rate_rule_id        uuid references rate_rules(id),  -- PRICE PROVENANCE
  price_iqd           iqd,                             -- snapshot at confirm; explainable forever
  hold_expires_at     timestamptz,                     -- kind='hold' only
  cancelled_at        timestamptz,
  cancellation_reason text,
  notes               text,
  device_id           text,
  idempotency_key     text unique,                     -- '{station}:{mutation_type}:{ulid}' (override #2)
  client_ref          text unique,                     -- '{station}-{ulid}' client entity ref (override #2)
  created_at          timestamptz not null default now(),
  check (end_at > start_at),
  check (kind <> 'hold' or hold_expires_at is not null),
  check (kind <> 'booking' or (guest_id is not null or guest_name is not null))
);

-- THE contractual constraint, exactly:
alter table reservations
  add constraint reservations_no_overlap
  exclude using gist (court_id with =, period with &&)
  where (status in ('pending','confirmed','arrived'));

create index reservations_court_start on reservations (court_id, start_at);
create index reservations_guest on reservations (guest_id) where guest_id is not null;
create index reservations_stale_holds on reservations (hold_expires_at)
  where kind = 'hold' and status = 'pending';

-- ---------------------------------------------------------------------------
-- app.is_degraded — STUB. Real implementation (device_heartbeats vs
-- venue_settings.heartbeat_stale_seconds) lands in 0017_degraded_sync.sql via
-- CREATE OR REPLACE. Every guest write RPC below already calls the guard.
-- ---------------------------------------------------------------------------
create or replace function app.is_degraded() returns boolean
language sql stable security definer set search_path = public as $$
  select false
$$;

create or replace function app.assert_not_degraded_for(p_start_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_horizon int;
begin
  if app.is_degraded() then
    select protected_horizon_hours into v_horizon from venue_settings;
    if p_start_at < now() + make_interval(hours => coalesce(v_horizon, 48)) then
      raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
        hint = 'venue is trading offline; bookings inside the protected horizon are desk-only';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- app.expire_stale_holds — flips expired-but-not-swept holds out of the
-- exclusion predicate. Called FIRST inside every writing RPC (same transaction:
-- a fresh writer always clears the corpse before inserting); pg_cron (0017)
-- runs the unfiltered sweep proactively.
-- ---------------------------------------------------------------------------
create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update reservations
     set status = 'expired'
   where kind = 'hold' and status = 'pending'
     and hold_expires_at < now()
     and (p_court_id is null or court_id = p_court_id)
     and (p_period is null or period && p_period);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- app.hold_slot — guest (mobile) creates a TTL hold on a slot.
-- Exactly one concurrent caller wins: exclusion violation is mapped to SLOT_TAKEN.
-- ---------------------------------------------------------------------------
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
  if p_start_at <= now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0001';
  end if;

  perform app.assert_not_degraded_for(p_start_at);

  v_end := p_start_at + make_interval(mins => p_duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');

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

-- ---------------------------------------------------------------------------
-- app.confirm_booking — hold -> booking, UPDATE IN PLACE (never delete+insert:
-- exclusion protection is continuous). Stamps rate_rule_id + price_iqd.
-- Confirm-vs-expire race: row lock serializes against the sweeper; a hold past
-- its TTL cleanly fails HOLD_EXPIRED, never both outcomes.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- app.staff_create_reservation — desk creates booking / hold / maintenance.
-- ---------------------------------------------------------------------------
create or replace function app.staff_create_reservation(
  p_court_id        uuid,
  p_kind            reservation_kind,
  p_start_at        timestamptz,
  p_end_at          timestamptz,
  p_guest_name      text default null,
  p_guest_phone     text default null,
  p_guest_id        uuid default null,
  p_notes           text default null,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
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
    -- Desk may book durations no rule prices (odd ranges): price stays null and
    -- the audit row records it; a price override RPC lands with the till drop.
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

  return jsonb_build_object('duplicate', false, 'reservation_id', v_res.id,
    'status', v_res.status, 'rate_rule_id', v_rule, 'price_iqd', v_price);
end $$;

-- ---------------------------------------------------------------------------
-- app.move_reservation — change court and/or time IN PLACE; exclusion re-checks.
-- ---------------------------------------------------------------------------
create or replace function app.move_reservation(
  p_reservation_id uuid,
  p_court_id       uuid default null,
  p_start_at       timestamptz default null,
  p_end_at         timestamptz default null
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
                          v_before, to_jsonb(v));

  return jsonb_build_object('reservation_id', v.id, 'court_id', v.court_id,
    'start_at', v.start_at, 'end_at', v.end_at);
end $$;

-- ---------------------------------------------------------------------------
-- app.extend_reservation — push end_at out (e.g. players keep playing).
-- ---------------------------------------------------------------------------
create or replace function app.extend_reservation(
  p_reservation_id uuid,
  p_new_end_at     timestamptz
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
                          v_before, to_jsonb(v));

  return jsonb_build_object('reservation_id', v.id, 'end_at', v.end_at);
end $$;

-- ---------------------------------------------------------------------------
-- app.cancel_reservation — guest cancels own booking inside policy; staff always.
-- Terminal statuses fall out of the exclusion predicate: the slot frees instantly.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_reservation(
  p_reservation_id uuid,
  p_reason         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
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
    select cancellation_window_hours into v_window from venue_settings;
    if v.start_at < now() + make_interval(hours => coalesce(v_window, 12)) then
      raise exception 'CANCELLATION_WINDOW' using errcode = 'P0001',
        hint = 'inside the cancellation window — contact the venue';
    end if;
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.cancel', 'reservations', v.id::text,
                          v_before, to_jsonb(v), p_reason);

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $$;

-- ---------------------------------------------------------------------------
-- app.mark_reservation — desk lifecycle: arrived / no_show / completed.
-- A no_show frees the remaining slot the moment it is marked.
-- ---------------------------------------------------------------------------
create or replace function app.mark_reservation(
  p_reservation_id uuid,
  p_status         reservation_status
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
                          v.id::text, v_before, to_jsonb(v));

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $$;

-- ---------------------------------------------------------------------------
-- Availability surface for the guest grid: which slots are busy, ZERO PII.
-- Reads filter holds by TTL so an unswept corpse never blocks the UI.
-- ---------------------------------------------------------------------------
create view court_availability with (security_invoker = off) as
select court_id, start_at, end_at, kind
  from reservations
 where status in ('pending','confirmed','arrived')
   and (kind <> 'hold' or hold_expires_at > now());

-- ---------------------------------------------------------------------------
-- Grants + RLS (matrix §3.2): guests SELECT own rows; court_desk/manager/owner
-- SELECT all; NO direct INSERT/UPDATE/DELETE for anyone — RPC-only writes.
-- ---------------------------------------------------------------------------
alter table reservations enable row level security;

grant select on reservations to authenticated;
grant select on court_availability to anon, authenticated;

create policy reservations_guest_read on reservations for select to authenticated
  using (guest_id = auth.uid());
create policy reservations_staff_read on reservations for select to authenticated
  using (app.is_staff('court_desk','manager','owner'));

-- Function grants: guests get the guest paths; staff role checks live inside.
revoke all on function app.is_degraded() from public;
grant execute on function app.is_degraded() to anon, authenticated;

revoke all on function app.assert_not_degraded_for(timestamptz) from public, anon, authenticated;

revoke all on function app.expire_stale_holds(uuid, tstzrange) from public, anon;
grant execute on function app.expire_stale_holds(uuid, tstzrange) to authenticated;

revoke all on function app.hold_slot(uuid, timestamptz, int, text, text, text) from public, anon;
grant execute on function app.hold_slot(uuid, timestamptz, int, text, text, text) to authenticated;

revoke all on function app.confirm_booking(uuid, text, text) from public, anon;
grant execute on function app.confirm_booking(uuid, text, text) to authenticated;

revoke all on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text) from public, anon;
grant execute on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text) to authenticated;

revoke all on function app.move_reservation(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.move_reservation(uuid, uuid, timestamptz, timestamptz) to authenticated;

revoke all on function app.extend_reservation(uuid, timestamptz) from public, anon;
grant execute on function app.extend_reservation(uuid, timestamptz) to authenticated;

revoke all on function app.cancel_reservation(uuid, text) from public, anon;
grant execute on function app.cancel_reservation(uuid, text) to authenticated;

revoke all on function app.mark_reservation(uuid, reservation_status) from public, anon;
grant execute on function app.mark_reservation(uuid, reservation_status) to authenticated;
