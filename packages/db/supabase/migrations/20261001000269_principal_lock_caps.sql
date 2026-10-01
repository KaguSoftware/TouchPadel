set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0269 principal_lock_caps — a cap that is counted and then inserted is
-- counted under a lock on whoever it caps.
--
-- Three caps counted their rows and then inserted with nothing held between
-- the two, so N parallel calls each counted fewer than the cap and all
-- inserted (the 2026-10-01 review, P4):
--   * hold_slot: HOLD_QUOTA_EXCEEDED, live holds per account across every
--     court — the very abuse the cap exists for (0048 C1). The per-court lock
--     comes after the count and is per court, so ten parallel holds on ten
--     courts all passed a cap of 3;
--   * scan_take_reading: SCAN_USER_DAILY_LIMIT, paid readings per person;
--   * trg_guest_order_rate_limit: TOO_MANY_ORDERS, guest orders per session
--     per minute.
-- app.lock_principal(kind, id) takes a transaction advisory lock on
-- (kind, id): the second call by the same account / person / session waits
-- for the first to commit, then counts the row it wrote.
--
-- Lock order. Each key is taken at exactly one point in one function, by
-- nothing else, so it cannot close a cycle: hold_slot takes it first of all
-- (before the hold ladder's hold_standing and before lock_court);
-- scan_take_reading after its caller's paper-row lock; the order trigger
-- after whatever its writer holds. check-lock-order expands the helper and
-- sees no ranked lock in it, which is correct.
--
-- Not changed: the open-match caps (MATCH_LIMIT_REACHED in match_start and in
-- match_join_refusal, REQUEST_LIMIT, the message and report RATE_LIMITED).
-- match_start documents its count as deliberately unlocked (OM-37), and a
-- principal lock there would sit beside the host's approve path, which counts
-- the same guest's matches under the match lock: a new cycle. They stay as
-- designed until the open-match lock contract takes the key in.
--
-- Re-issued from their latest bodies, each with one marked 0269 line:
--   hold_slot                    20260929000263_match_reservation_triggers.sql:233
--   scan_take_reading            20260927000240_scan_hardening.sql:135
--   trg_guest_order_rate_limit   20260926000211_cafe_settings_readers_per_venue.sql:315

-- ---------------------------------------------------------------------------
-- 1. app.lock_principal
-- ---------------------------------------------------------------------------
create or replace function app.lock_principal(p_kind text, p_id uuid) returns void
language sql volatile security definer set search_path = public as $lock_principal_0269$
  select pg_advisory_xact_lock(hashtextextended('principal:' || p_kind || ':' || p_id::text, 0));
$lock_principal_0269$;

comment on function app.lock_principal(text, uuid) is
  '0269. Internal. A transaction advisory lock on (p_kind, p_id): taken right before a cap is counted, so the next call by the same principal counts the row this one inserts. Each kind is taken at one point in one function.';

revoke all on function app.lock_principal(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.hold_slot — re-issued from 20260929000263_match_reservation_triggers.sql:233
-- ---------------------------------------------------------------------------
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $hold_slot_0269$
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
  v_key       text;
  v_standing  jsonb;
  v_warning   boolean := false;
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

  -- 0269: one hold_slot at a time per account, so the live-hold cap below is
  -- counted under the lock and cannot be outrun by parallel calls. First lock
  -- the call takes.
  perform app.lock_principal('hold_slot', v_uid);

  -- 0252: the hold ladder, chain-wide, on the caller's identity (verified
  -- phone, else account). The caller's own lapsed holds are settled first so
  -- the minute before the sweep is no loophole. A refusal rolls the settling
  -- back with it; the sweep writes the same strikes (they are dated by the
  -- hold, not by who settles them).
  if (select hold_strikes_since from platform_settings where id) is not null then
    v_key := app.hold_standing_key(v_uid);
    perform app.hold_strikes_settle(app.hold_key_guests(v_key));
    select app.hold_standing_json(s) into v_standing from hold_standing s where s.key = v_key;
    if v_standing is not null then
      if v_standing->>'status' in ('banned', 'suspended') then
        raise exception 'BOOKING_SUSPENDED' using errcode = 'P0001',
          detail = coalesce(v_standing->>'blocked_until', ''),
          hint = 'this account may not hold courts in the app';
      elsif v_standing->>'status' = 'cooldown' then
        raise exception 'HOLD_COOLDOWN' using errcode = 'P0001',
          detail = v_standing->>'blocked_until',
          hint = 'too many holds lapsed; try again later';
      end if;
      v_warning := (v_standing->>'strikes')::int >= 1;
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

  -- 0263 (R22, C9): an open match waiting for a court keeps it. Checked after
  -- the lazy expiry above, so a stale hold on the court no longer counts.
  if app.match_court_claimed(p_court_id, v_period) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'match_waiting',
      hint = 'a full open match is waiting for this court';
  end if;

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
    'hold_expires_at', v_res.hold_expires_at, 'rate_rule_id', v_rule, 'price_iqd', v_price,
    'hold_warning', v_warning);
end $hold_slot_0269$;

comment on function app.hold_slot(uuid, timestamptz, int, text, text, text) is
  '0008, re-issued by 0048, 0117, 0210, 0225, 0252 and 0263. Guest: holds a court for the hold TTL of its branch at the stamped quote (0117), after the account check, the replay lookup, the hold ladder (0252: the caller''s lapsed holds settled first, then BOOKING_SUSPENDED or HOLD_COOLDOWN; hold_warning in the answer after a strike) and the open-branch, duration, horizon, hours, past, degraded and live-hold-cap checks; serialised on the court (0042) with lazy hold expiry. 0263 (R22): a court an awaiting_court open match could still book is refused SLOT_TAKEN detail match_waiting (app.match_court_claimed). SLOT_TAKEN detail reservations_no_overlap on an overlap; a replayed key answers duplicate.';

revoke all on function app.hold_slot(uuid, timestamptz, int, text, text, text) from public, anon;
grant execute on function app.hold_slot(uuid, timestamptz, int, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.scan_take_reading — re-issued from 20260927000240_scan_hardening.sql:135
-- ---------------------------------------------------------------------------
create or replace function app.scan_take_reading(
  p_kind         text,
  p_paper        uuid,
  p_venue        uuid,
  p_requested_by uuid
) returns uuid
language plpgsql security definer set search_path = public as $scan_take_reading_0269$
declare
  c_per_paper  constant int := 3;
  c_per_person constant int := 100;
  v_role staff_role;
  v_n    int;
  v_id   uuid;
begin
  select count(*) into v_n from scan_reads where paper_id = p_paper;
  if v_n >= c_per_paper then
    raise exception 'SCAN_REREAD_LIMIT' using errcode = 'P0001';
  end if;
  if p_requested_by is not null then
    select s.role into v_role from staff s where s.id = p_requested_by;
    if v_role is null or v_role not in ('manager','owner') then
      -- 0269: the per-person count, under a lock on the person.
      perform app.lock_principal('scan_reader', p_requested_by);
      select count(*) into v_n
        from scan_reads
       where requested_by = p_requested_by and created_at > now() - interval '24 hours';
      if v_n >= c_per_person then
        raise exception 'SCAN_USER_DAILY_LIMIT' using errcode = 'P0001';
      end if;
    end if;
  end if;
  insert into scan_reads (venue_id, kind, paper_id, requested_by)
  values (p_venue, p_kind, p_paper, p_requested_by)
  returning id into v_id;
  return v_id;
end $scan_take_reading_0269$;

comment on function app.scan_take_reading(text, uuid, uuid, uuid) is
  'scan_hardening (0240). Internal: records one reading of a paper and returns its lease token. SCAN_REREAD_LIMIT when the paper was read three times already; SCAN_USER_DAILY_LIMIT when the person asking (not a manager or the owner) asked for 100 readings in the last 24 hours.';

revoke all on function app.scan_take_reading(text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.trg_guest_order_rate_limit — re-issued from 20260926000211_cafe_settings_readers_per_venue.sql:315
-- ---------------------------------------------------------------------------
create or replace function app.trg_guest_order_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $trg_guest_order_rate_limit_0269$
declare
  v_limit  int;
  v_recent int;
begin
  -- Staff-created orders are not rate-limited: a busy till legitimately fires
  -- faster than any guest, and the actor there is identified and audited.
  if new.guest_session_id is null then
    return new;
  end if;

  select guest_orders_per_minute into v_limit from venue_settings where venue_id = new.venue_id;
  if v_limit is null then
    return new;                                  -- no settings row: do not invent a limit
  end if;

  -- 0269: the count, under a lock on the guest session.
  perform app.lock_principal('guest_order_session', new.guest_session_id);

  select count(*) into v_recent
    from orders
   where guest_session_id = new.guest_session_id
     and placed_at > now() - interval '1 minute';

  if v_recent >= v_limit then
    raise exception 'TOO_MANY_ORDERS' using errcode = 'P0001',
      detail = format('%s orders in the last minute, limit %s', v_recent, v_limit),
      hint = 'please wait a moment, or ask a member of staff';
  end if;

  return new;
end $trg_guest_order_rate_limit_0269$;
