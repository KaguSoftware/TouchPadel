set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0263 match_reservation_triggers — open matches, lane DB: what happens to a
-- match when the courts around it change, and the sweep that finishes what no
-- request does (docs/design/open-matches/db.md §2.3, §2.5, §2.7, §3, §4.8;
-- build contracts §1.1, §1.2, §1.5, §1.8, §1.11; rulings R12, R13, R16, R18,
-- R22, R25, R36, R37; OM-13, DF-18, DF-19, DF-20).
--
--   1. app.trg_reservation_match      trigger reservations_match, one body for
--                                     both jobs: part A cascades a match's own
--                                     booking (cancelled, completed, moved;
--                                     no_show refused), part B bumps the
--                                     filling and waiting matches a newly firm
--                                     row leaves with no firm-free court
--   2. app.match_court_claimed        R22: a waiting match keeps its court
--                                     (not one the sweep will not book:
--                                     offline inside the protected horizon);
--      app.hold_slot                  re-issued from 0252 (the hold ladder)
--                                     with that check
--      app.staff_create_reservation   re-issued from 0217 with that check
--   3. app.match_sweep                service role: requests past their
--                                     cutoff, deleted and banned holders, the
--                                     fit backstop, deadlines and the -30 min
--                                     warning, waiting matches, late leaves at
--                                     the start, the end of play; then DF-20
--                                     refunds and the R36 report purge
--   4. cron tp_match_sweep            every 30 seconds (every minute where
--                                     pg_cron predates the seconds syntax)
--
-- Firm means a live row that is not a hold: kind booking or maintenance with
-- status pending, confirmed or arrived (R22). A hold never bumps a match
-- (OM-13): the trigger's WHEN keeps every hold write out.
--
-- Locks (db.md §2.3, §2.7). Part A waits for the branch mutex after the
-- writer's own row lock; nothing that holds the mutex ever waits for a
-- booking row (L2 bodies lock their booking before the mutex, the sweep never
-- locks one). Part B only try-locks the mutex and defers to the sweep, so the
-- writers that skip app.lock_court (event blocks, the deposit re-create)
-- cannot close a cycle with a body that holds every court. The sweep blocks on
-- its first branch only (courts -> stale holds -> mutex) and try-locks the
-- rest. From this file the lock gate expands the trigger under every
-- reservations writer: match_venue_advisory -> match_tickets after
-- reservations, in the declared order (Money's R15 hoist in 0258 keeps
-- deposit_apply in it).

-- ===========================================================================
-- 1. The reservation trigger (db.md §4.8.1)
-- ===========================================================================

-- Part A (an UPDATE of a match's own booking) waits for the branch mutex and
-- lets every error through: a desk cancel either cascades or fails with a
-- mapped code, never half-done. Part B (a row that is newly firm or moved)
-- never waits: it try-locks the mutex, swallows its errors, and leaves a busy
-- branch to the next sweep run. app.venue_id is set to the row's branch before
-- any match write (a staff member confirming their own hold passes the branch
-- guard) and put back on the way out.
create or replace function app.trg_reservation_match() returns trigger
language plpgsql security definer set search_path = public as $trg_reservation_match_0263$
declare
  v_saved   text := current_setting('app.venue_id', true);
  -- match_try_book (0260) names the match it is booking: never judged against
  -- its own new row.
  v_booking uuid := nullif(current_setting('app.match_booking', true), '')::uuid;
  v_moved   boolean := false;
  v_match   uuid;
  v_venue   uuid;
  v_m       matches%rowtype;
  v_c       record;
begin
  perform set_config('app.venue_id', new.venue_id::text, true);

  if tg_op = 'UPDATE' then
    v_moved := new.court_id is distinct from old.court_id
            or new.start_at is distinct from old.start_at
            or new.end_at is distinct from old.end_at;

    -- Part A. 1: the match this row books (matches_reservation_key).
    select mt.id, mt.venue_id into v_match, v_venue from matches mt where mt.reservation_id = new.id;
    if v_match is not null then
      -- 2. Blocking, then read again. Call-off, all-no-show and sandbox
      --    already wrote the match: only a booked one follows its booking.
      perform app.lock_match_venue(v_venue);
      select * into v_m from matches where id = v_match;
      if v_m.status = 'booked' then
        -- 3. The status.
        if new.status is distinct from old.status then
          if new.status = 'cancelled' then
            perform app.match_end(v_m.id, 'cancelled', 'reservation_cancelled',
                                  case when new.cancelled_by = 'staff' then 'staff' else 'system' end);
          elsif new.status = 'no_show' then
            -- The seats carry the no-shows: mark_match_seats (0262) ends the
            -- match before it writes the booking.
            raise exception 'MATCH_MARK_SEATS' using errcode = 'P0001';
          elsif new.status = 'completed' then
            -- R37: unmarked carriers are attended when the booking completes.
            perform app.match_end(v_m.id, 'played', null, 'staff');
          end if;
          select * into v_m from matches where id = v_match;
        end if;
        -- 4. A desk move or extend: the match follows its booking; the shares
        --    stay stamped (DF-4) and matches_deadline binds only while filling.
        if v_m.status = 'booked' and v_moved then
          update matches
             set start_at     = new.start_at,
                 end_at       = new.end_at,
                 duration_min = (extract(epoch from (new.end_at - new.start_at)) / 60)::int,
                 updated_at   = now()
           where id = v_m.id;
          perform app.match_event(v_m.id, v_m.venue_id, 'moved', 'staff', null, null, null,
                                  jsonb_build_object('court_id', new.court_id));
        end if;
      end if;
    end if;
  end if;

  -- Part B. 1: newly firm or moved (a new row, a hold becoming a booking, a
  -- row coming back to life, a move or extend), and live now. 2: a cheap
  -- unlocked look for a match it could bump.
  if new.status in ('pending', 'confirmed', 'arrived')
     and (tg_op = 'INSERT'
          or old.kind is distinct from new.kind
          or old.status not in ('pending', 'confirmed', 'arrived')
          or v_moved)
     and exists (select 1 from matches mt
                  where mt.venue_id = new.venue_id
                    and mt.status in ('filling', 'awaiting_court')
                    and not mt.sandbox
                    and mt.period && new.period
                    and mt.id is distinct from v_booking) then
    -- 3. Never waits; the sweep is the backstop.
    begin
      if not app.try_lock_match_venue(new.venue_id) then
        raise warning 'match bump deferred: branch % busy, the sweep follows', new.venue_id;
      else
        -- A new statement under the mutex: a fresh snapshot sees every
        -- booking the mutex's previous holder committed (C14).
        for v_c in
          select mt.id, mt.venue_id, mt.period, mt.duration_min
            from matches mt
           where mt.venue_id = new.venue_id
             and mt.status in ('filling', 'awaiting_court')
             and not mt.sandbox
             and mt.period && new.period
             and mt.id is distinct from v_booking
           order by mt.id
        loop
          if not app.match_court_free_firm(v_c.venue_id, v_c.period, v_c.duration_min, 1) then
            perform app.match_end(v_c.id, 'bumped', 'bumped', 'system');
          end if;
        end loop;
      end if;
    exception when others then
      raise warning 'match bump deferred: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  perform set_config('app.venue_id', coalesce(v_saved, ''), true);
  return null;
end $trg_reservation_match_0263$;

comment on function app.trg_reservation_match() is
  '0263. Internal (db.md §4.8.1). Trigger reservations_match, after insert or update of kind, status, court_id, start_at, end_at on a booking or maintenance row. Part A, a match''s own booking (UPDATE; waits for the branch mutex; errors propagate): cancelled -> match_end cancelled (reservation_cancelled; actor staff when cancelled_by is staff), completed -> match_end played (R37 auto-attend), no_show -> MATCH_MARK_SEATS, moved or extended -> the match''s times follow (event moved {court_id}). Part B, a newly firm or moved live row: the branch''s non-sandbox filling and awaiting_court matches over its period with no firm-free court left are bumped (match_end bumped), except the match app.match_booking names; the mutex is only try-locked, a busy branch and any error are a warning and the sweep follows (D-2). Sets app.venue_id to the row''s branch and restores it.';

revoke all on function app.trg_reservation_match() from public, anon, authenticated;

drop trigger if exists reservations_match on reservations;
create trigger reservations_match
  after insert or update of kind, status, court_id, start_at, end_at on reservations
  for each row when (new.kind in ('booking', 'maintenance'))
  execute function app.trg_reservation_match();

-- ===========================================================================
-- 2. R22: a waiting match keeps its court (db.md §4.8.2)
-- ===========================================================================

-- True when the court's branch has a non-sandbox awaiting_court match M over
-- p_period whose length the court offers, the court is one M could still
-- book (active, no live row over M's period: "this court included"), and the
-- branch's courts offering M's length with no live row over M's period are no
-- more than the awaiting_court matches over it. A waiting match the sweep will
-- not book claims nothing and is not counted: while its branch trades offline
-- with the start inside the protected horizon (sweep step 6), the desk books
-- the court and trigger part B bumps the match. A plain read: the sweep is the
-- backstop.
create or replace function app.match_court_claimed(p_court_id uuid, p_period tstzrange) returns boolean
language sql stable security definer set search_path = public as $match_court_claimed_0263$
  select exists (
    select 1
      from courts c
      join matches m on m.venue_id = c.venue_id
     where c.id = p_court_id
       and c.is_active
       and m.status = 'awaiting_court'
       and not m.sandbox
       and m.period && p_period
       and m.duration_min = any (c.duration_options)
       and not (app.is_degraded(m.venue_id)
                and m.start_at < now() + make_interval(hours => coalesce(
                      (select vs.protected_horizon_hours from venue_settings vs where vs.venue_id = m.venue_id),
                      48)))
       and not exists (select 1 from reservations r
                        where r.court_id = c.id
                          and r.status in ('pending', 'confirmed', 'arrived')
                          and r.period && m.period)
       and (select count(*)
              from courts c2
             where c2.venue_id = m.venue_id
               and c2.is_active
               and m.duration_min = any (c2.duration_options)
               and not exists (select 1 from reservations r2
                                where r2.court_id = c2.id
                                  and r2.status in ('pending', 'confirmed', 'arrived')
                                  and r2.period && m.period))
           <= (select count(*)
                 from matches x
                where x.venue_id = m.venue_id
                  and x.status = 'awaiting_court'
                  and not x.sandbox
                  and x.period && m.period
                  and not (app.is_degraded(x.venue_id)
                           and x.start_at < now() + make_interval(hours => coalesce(
                                 (select vs.protected_horizon_hours from venue_settings vs
                                   where vs.venue_id = x.venue_id), 48)))))
$match_court_claimed_0263$;

comment on function app.match_court_claimed(uuid, tstzrange) is
  '0263. Internal (R22, C9). True when a non-sandbox awaiting_court match over p_period, whose length the court offers, could still book this court (active, no live row over the match''s period) and the branch''s courts offering that length with no live row over the match''s period number no more than its awaiting_court matches over that period. A waiting match the sweep will not book (its branch degraded, the start inside protected_horizon_hours: sweep step 6) neither claims nor counts, so the desk can book the court and trigger part B bumps the match. hold_slot and staff_create_reservation refuse a claimed court SLOT_TAKEN detail match_waiting, right after their lazy hold expiry. A plain read; the sweep is the backstop.';

revoke all on function app.match_court_claimed(uuid, tstzrange) from public, anon, authenticated;

-- hold_slot: re-issued from 20260929000252_hold_strikes.sql:420 (the hold ladder) with the R22 check (0263)
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $hold_slot_0263$
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
end $hold_slot_0263$;

comment on function app.hold_slot(uuid, timestamptz, int, text, text, text) is
  '0008, re-issued by 0048, 0117, 0210, 0225, 0252 and 0263. Guest: holds a court for the hold TTL of its branch at the stamped quote (0117), after the account check, the replay lookup, the hold ladder (0252: the caller''s lapsed holds settled first, then BOOKING_SUSPENDED or HOLD_COOLDOWN; hold_warning in the answer after a strike) and the open-branch, duration, horizon, hours, past, degraded and live-hold-cap checks; serialised on the court (0042) with lazy hold expiry. 0263 (R22): a court an awaiting_court open match could still book is refused SLOT_TAKEN detail match_waiting (app.match_court_claimed). SLOT_TAKEN detail reservations_no_overlap on an overlap; a replayed key answers duplicate.';

revoke all on function app.hold_slot(uuid, timestamptz, int, text, text, text) from public, anon;
grant execute on function app.hold_slot(uuid, timestamptz, int, text, text, text) to authenticated;

-- staff_create_reservation: re-issued from 20260926000217_cross_venue_guards.sql:1367 with the R22 check (0263)
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
language plpgsql security definer set search_path = public as $staff_create_reservation_0263$
declare
  v_venue uuid;
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
  -- 0217: the court's branch decides the day, the rows written and who may act.
  v_venue := (select c.venue_id from courts c where c.id = p_court_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
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

  -- 0263 (R22, C9): an open match waiting for a court keeps it, whatever the
  -- kind (series go through here). After the lazy expiry above. Not while the
  -- branch trades offline inside the protected horizon: the sweep does not
  -- book the match there, so the desk may take the court (part B bumps it).
  if app.match_court_claimed(p_court_id, tstzrange(p_start_at, p_end_at, '[)')) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'match_waiting',
      hint = 'a full open match is waiting for this court';
  end if;

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
end $staff_create_reservation_0263$;

comment on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint, int) is
  'Desk (court_desk, manager, owner at the court''s branch, 0217): creates a booking, hold or maintenance row; serialised on the court (0042) with lazy hold expiry; a booking is priced by its rate rule, or by p_price_override_iqd (manager, owner; audited). 0263 (R22): a court an awaiting_court open match could still book is refused SLOT_TAKEN detail match_waiting (app.match_court_claimed), for every kind, so series (create_series) too; not while the branch is degraded with the match inside protected_horizon_hours (the sweep does not book it there; the new row bumps it instead). p_players is accepted and ignored (0147).';

revoke all on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint, int) from public, anon;
grant execute on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint, int) to authenticated;

-- ===========================================================================
-- 3. The sweep (db.md §4.8.3)
-- ===========================================================================

-- Phase 1 finds the branches with work, without a lock. Phase 2 locks the
-- first branch by blocking, in the LS order (courts -> the stale holds of its
-- due matches' span -> the mutex), and every later branch by try-lock only
-- (the mutex, then the courts, C21; busy -> skipped this run, no hold expiry
-- there), then works each due match in its own exception block, at most 200 a
-- run across branches. Phase 3 (a chain-wide run only) starts Money's DF-20
-- refunds and purges reports older than 12 months (R36). Every step selects
-- only rows that still need the change, and every change is one-way or a
-- stamp, so a second run in the same second does nothing. The booking row is
-- never written here.
create or replace function app.match_sweep(p_venue_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $match_sweep_0263$
declare
  c_zero    constant jsonb := '{"booked": 0, "awaiting_expired": 0, "bumped": 0, "expired": 0, "cancelled": 0,
                                "warned": 0, "requests_expired": 0, "left_deleted": 0, "removed_banned": 0,
                                "forfeited": 0, "played": 0, "no_show": 0}';
  v_c       jsonb := c_zero;   -- the run's counts
  v_snap    jsonb;             -- the counts before the match in hand (an error rolls it back)
  v_swept   int := 0;
  v_skipped int := 0;
  v_errors  int := 0;
  v_refunds int := 0;
  v_purged  int := 0;
  v_budget  int := 200;
  v_ids     uuid[] := '{}'::uuid[];
  v_venues  uuid[] := '{}'::uuid[];
  v_row     record;
  v_due     boolean;
  v_n       int;
  v_off     int := 0;
  v_i       int;
  v_v       uuid;
  v_lo      timestamptz;
  v_hi      timestamptz;
  v_mid     uuid;
  v_m       matches%rowtype;
  v_req     record;
  v_holder  record;
  v_code    text;
  v_fit     text;
  v_status  text;
  v_tickets uuid[];
  v_seats   uuid[];
  v_k       int;
  v_del     int;
  v_ban     int;
begin
  -- Phase 1: the due matches and their branches (no locks).
  for v_row in
    select mt.id, mt.venue_id, mt.status, mt.sandbox, mt.price_court_id, mt.start_at, mt.end_at,
           case
             when mt.status = 'awaiting_court' then true
             when mt.status = 'filling' then
                  now() >= mt.fill_deadline_at
               or (now() >= mt.fill_deadline_at - interval '30 minutes' and mt.deadline_warned_at is null)
               or exists (select 1 from match_seats s join profiles p on p.id = s.guest_id
                           where s.match_id = mt.id and s.status = 'in'
                             and (p.deleted_at is not null
                                  or exists (select 1 from customer_flags f
                                              where f.customer_id = s.guest_id and f.type = 'match_ban')))
               or exists (select 1 from match_requests q join profiles p on p.id = q.guest_id
                           where q.match_id = mt.id and q.status = 'pending'
                             and (p.deleted_at is not null
                                  or exists (select 1 from customer_flags f
                                              where f.customer_id = q.guest_id and f.type = 'match_ban')))
               -- It no longer fits: the branch, or no firm-free court offering
               -- the length (none offering it at all included).
               or (not mt.sandbox
                   and (not (mt.venue_id = any (app.open_venue_ids()))
                        or not app.match_court_free_firm(mt.venue_id, mt.period, mt.duration_min, 1)))
             when mt.status = 'booked' then
                  now() >= mt.end_at + (case when mt.sandbox then interval '0 minutes' else interval '3 hours' end)
               or (now() < mt.start_at
                   and exists (select 1 from app.match_carriers(mt.id) c
                                 join match_seats s on s.id = c.seat_id
                                 join profiles p on p.id = s.guest_id
                                where c.status = 'in' and p.deleted_at is not null))
               or (now() >= mt.start_at
                   and exists (select 1 from app.match_carriers(mt.id) c
                                 join match_seats s on s.id = c.seat_id
                                 join match_tickets k on k.id = s.ticket_id
                                where c.status = 'left_late' and k.status = 'in_use' and k.seat_id = s.id))
               or (now() >= mt.start_at
                   and exists (select 1 from match_requests q where q.match_id = mt.id and q.status = 'pending'))
             -- Ended with a pending request left behind.
             else true
           end as due
      from matches mt
     where (p_venue_id is null or mt.venue_id = p_venue_id)
       and (mt.status in ('filling', 'awaiting_court', 'booked')
            or mt.id in (select q.match_id from match_requests q where q.status = 'pending'))
     order by mt.venue_id, mt.start_at, mt.id
  loop
    v_due := v_row.due;
    -- The branch's hours and closed dates: assert_bookable only raises.
    if not v_due and v_row.status = 'filling' and not v_row.sandbox then
      begin
        perform app.assert_bookable(v_row.price_court_id, v_row.start_at, v_row.end_at);
      exception when sqlstate 'P0001' then
        v_due := true;
      end;
    end if;
    if v_due then
      v_ids := v_ids || v_row.id;
      if not (v_row.venue_id = any (v_venues)) then
        v_venues := v_venues || v_row.venue_id;
      end if;
    end if;
  end loop;

  -- Phase 2: per branch, from a rotating offset so no branch is always last.
  v_n := cardinality(v_venues);
  if v_n > 0 then
    v_off := floor(extract(epoch from now()) / 30)::int % v_n;
  end if;
  for v_i in 0 .. v_n - 1 loop
    exit when v_budget <= 0;
    v_v := v_venues[((v_off + v_i) % v_n) + 1];
    perform set_config('app.venue_id', v_v::text, true);
    if v_i = 0 then
      -- The first branch waits for its locks (LS).
      perform app.match_lock_courts(v_v);
      -- No filling or waiting match due here (only booked work): no span, so
      -- no hold expiry. tstzrange(NULL, NULL) is the unbounded range, never
      -- NULL, so the bounds are tested, not the range.
      select min(mt.start_at), max(mt.end_at) into v_lo, v_hi
        from matches mt
       where mt.id = any (v_ids) and mt.venue_id = v_v and mt.status in ('filling', 'awaiting_court');
      if v_lo is not null and v_hi is not null then
        perform app.match_expire_holds(v_v, tstzrange(v_lo, v_hi, '[)'));
      end if;
      perform app.lock_match_venue(v_v);
    elsif not app.try_lock_match_venue(v_v, true) then
      -- A later branch is never waited on (C21): skipped this run.
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_swept := v_swept + 1;

    for v_mid in
      select mt.id from matches mt
       where mt.id = any (v_ids) and mt.venue_id = v_v
       order by mt.start_at, mt.id
    loop
      exit when v_budget <= 0;
      v_budget := v_budget - 1;
      v_snap := v_c;
      begin
        select * into v_m from matches where id = v_mid;

        -- 1. Requests past their cutoff (filling or waiting: the deadline;
        --    booked: the start; code closed), or left on an ended match (code
        --    its ended_reason).
        for v_req in
          select q.id from match_requests q
           where q.match_id = v_m.id and q.status = 'pending'
             and (v_m.status not in ('filling', 'awaiting_court', 'booked')
                  or (v_m.status in ('filling', 'awaiting_court') and now() >= v_m.fill_deadline_at)
                  or (v_m.status = 'booked' and now() >= v_m.start_at))
           order by q.id
        loop
          v_code := case when v_m.status in ('filling', 'awaiting_court', 'booked') then 'closed'
                         else coalesce(v_m.ended_reason, 'match_ended') end;
          select array_agg(k.id order by k.id) into v_tickets
            from match_tickets k where k.request_id = v_req.id and k.status = 'reserved';
          perform app.ticket_release(v_tickets, v_code, null, v_req.id);
          update match_requests set status = 'expired', decided_at = now() where id = v_req.id;
          perform app.match_event(v_m.id, v_m.venue_id, 'request_expired', 'system', null, v_req.id, v_code,
                                  '{}'::jsonb);
          v_c := v_c || jsonb_build_object('requests_expired', (v_c->>'requests_expired')::int + 1);
        end loop;

        -- 2. Deleted and banned holders (R18, C5).
        if v_m.status in ('filling', 'awaiting_court') then
          select count(*) filter (where p.deleted_at is not null), count(*) filter (where p.deleted_at is null)
            into v_del, v_ban
            from match_seats s join profiles p on p.id = s.guest_id
           where s.match_id = v_m.id and s.status = 'in'
             and (p.deleted_at is not null
                  or exists (select 1 from customer_flags f where f.customer_id = s.guest_id and f.type = 'match_ban'));
          if app.match_drop_ineligible(v_m.id) > 0 then
            v_c := v_c || jsonb_build_object('left_deleted', (v_c->>'left_deleted')::int + v_del,
                                             'removed_banned', (v_c->>'removed_banned')::int + v_ban);
            -- A waiting match left with fewer than four goes back to filling
            -- (db.md §3.1, as match_try_book step 3 does): step 6 may not
            -- run (offline inside the horizon), and a waiting match at 3/4
            -- would keep claiming a court (R22) that the desk cannot fill.
            select * into v_m from matches where id = v_mid;
            if v_m.status = 'awaiting_court'
               and (select count(*) from app.match_carriers(v_m.id) c where c.seat_id is not null) < 4 then
              update matches set status = 'filling', updated_at = now() where id = v_m.id;
            end if;
          end if;
        elsif v_m.status = 'booked' and now() < v_m.start_at then
          -- A deleted holder's booked seats become late leaves (DF-20): open
          -- for a refill, their tickets released at the start and never
          -- forfeited (step 7, ticket_forfeit, R18). A banned holder's booked
          -- seats are left to the desk.
          v_k := 0;
          for v_holder in
            select s.guest_id
              from app.match_carriers(v_m.id) c
              join match_seats s on s.id = c.seat_id
              join profiles p on p.id = s.guest_id
             where c.status = 'in' and p.deleted_at is not null
             group by s.guest_id
             order by s.guest_id
          loop
            select array_agg(s.id order by (s.kind = 'account') desc, s.seat_no, s.id) into v_seats
              from match_seats s
             where s.match_id = v_m.id and s.status = 'in' and s.guest_id = v_holder.guest_id;
            update match_seats set status = 'left_late', ended_at = now(), end_reason = 'account_deleted'
             where id = any (v_seats);
            perform app.match_event(v_m.id, v_m.venue_id, 'left_late', 'system', v_seats[1], null, 'account_deleted',
                                    jsonb_build_object('seats', to_jsonb(v_seats),
                                                       'seats_taken', (select count(*) from app.match_carriers(v_m.id) c
                                                                        where c.status in ('in', 'attended'))));
            v_c := v_c || jsonb_build_object('left_deleted', (v_c->>'left_deleted')::int + cardinality(v_seats));
            v_k := v_k + 1;
          end loop;
          if v_k > 0 then
            perform app.match_recompute_organiser(v_m.id);
          end if;
        end if;
        select * into v_m from matches where id = v_mid;

        -- 3. The fit backstop: the branch trades, its hours and dates allow
        --    the time, a court still offers the length, one is firm-free.
        --    A sandbox match books no court (DF-19).
        if v_m.status in ('filling', 'awaiting_court') and not v_m.sandbox then
          v_fit := null;
          if not (v_m.venue_id = any (app.open_venue_ids())) then
            v_fit := 'venue_closed';
          else
            begin
              perform app.assert_bookable(v_m.price_court_id, v_m.start_at, v_m.end_at);
            exception when sqlstate 'P0001' then
              if sqlerrm not in ('CLOSED_DATE', 'OUTSIDE_HOURS') then
                raise;
              end if;
              v_fit := 'venue_closed';
            end;
          end if;
          if v_fit is null
             and not exists (select 1 from courts c
                              where c.venue_id = v_m.venue_id and c.is_active
                                and v_m.duration_min = any (c.duration_options)) then
            v_fit := 'no_court';
          elsif v_fit is null
                and not app.match_court_free_firm(v_m.venue_id, v_m.period, v_m.duration_min, 1) then
            v_fit := 'bumped';
          end if;
          if v_fit = 'venue_closed' then
            perform app.match_end(v_m.id, 'cancelled', 'venue_closed', 'system');
            v_c := v_c || jsonb_build_object('cancelled', (v_c->>'cancelled')::int + 1);
          elsif v_fit is not null then
            perform app.match_end(v_m.id, 'bumped', v_fit, 'system');
            v_c := v_c || jsonb_build_object('bumped', (v_c->>'bumped')::int + 1);
          end if;
          select * into v_m from matches where id = v_mid;
        end if;

        -- 4. The fill deadline.
        if v_m.status = 'filling' and now() >= v_m.fill_deadline_at then
          perform app.match_end(v_m.id, 'expired', 'deadline', 'system');
          v_c := v_c || jsonb_build_object('expired', (v_c->>'expired')::int + 1);
          select * into v_m from matches where id = v_mid;
        end if;

        -- 5. The warning, once, inside the last 30 minutes before the deadline.
        if v_m.status = 'filling' and now() >= v_m.fill_deadline_at - interval '30 minutes'
           and v_m.deadline_warned_at is null then
          update matches set deadline_warned_at = now(), updated_at = now() where id = v_m.id;
          perform app.match_event(v_m.id, v_m.venue_id, 'deadline_warning', 'system', null, null, null,
                                  jsonb_build_object('seats_taken', (select count(*) from app.match_carriers(v_m.id) c
                                                                      where c.seat_id is not null)));
          v_c := v_c || jsonb_build_object('warned', (v_c->>'warned')::int + 1);
        end if;

        -- 6. Waiting for a court (DF-18): expired at the start, else booked
        --    now if the blocking hold is gone (bumped if it confirmed). Not
        --    while the branch trades offline with the start inside the
        --    protected horizon (the desk books there, 0210).
        if v_m.status = 'awaiting_court' then
          if now() >= v_m.start_at then
            perform app.match_end(v_m.id, 'expired', 'no_court', 'system');
            v_c := v_c || jsonb_build_object('awaiting_expired', (v_c->>'awaiting_expired')::int + 1);
          elsif not (app.is_degraded(v_m.venue_id)
                     and v_m.start_at < now() + make_interval(hours => coalesce(
                           (select vs.protected_horizon_hours from venue_settings vs where vs.venue_id = v_m.venue_id),
                           48))) then
            v_status := app.match_try_book(v_m.id);
            if v_status = 'booked' then
              v_c := v_c || jsonb_build_object('booked', (v_c->>'booked')::int + 1);
            elsif v_status = 'bumped' then
              v_c := v_c || jsonb_build_object('bumped', (v_c->>'bumped')::int + 1);
            elsif v_status = 'cancelled' then
              v_c := v_c || jsonb_build_object('cancelled', (v_c->>'cancelled')::int + 1);
            end if;
          end if;
          select * into v_m from matches where id = v_mid;
        end if;

        -- 7. The start: an unrefilled late leave loses its ticket (a deleted
        --    holder's is released instead, R18). The tickets are locked first
        --    in one id-ordered statement (db.md §2.4).
        if v_m.status = 'booked' and now() >= v_m.start_at then
          select array_agg(s.id order by s.seat_no, s.id), array_agg(s.ticket_id order by s.seat_no, s.id)
            into v_seats, v_tickets
            from app.match_carriers(v_m.id) c
            join match_seats s on s.id = c.seat_id
            join match_tickets k on k.id = s.ticket_id
           where c.status = 'left_late' and k.status = 'in_use' and k.seat_id = s.id;
          if v_tickets is not null then
            perform 1 from match_tickets where id = any (v_tickets) order by id for update;
            for v_k in 1 .. cardinality(v_tickets) loop
              if app.ticket_forfeit(v_tickets[v_k], v_seats[v_k]) then
                v_c := v_c || jsonb_build_object('forfeited', (v_c->>'forfeited')::int + 1);
              end if;
            end loop;
          end if;
        end if;

        -- 8. The end of play, 3 hours after end_at (a sandbox match at
        --    end_at): unmarked carriers attended (R37), or no_show when no
        --    carrier is in or attended.
        if v_m.status = 'booked'
           and now() >= v_m.end_at + (case when v_m.sandbox then interval '0 minutes' else interval '3 hours' end) then
          if exists (select 1 from app.match_carriers(v_m.id) c where c.status in ('in', 'attended')) then
            perform app.match_end(v_m.id, 'played', null, 'system');
            v_c := v_c || jsonb_build_object('played', (v_c->>'played')::int + 1);
          else
            perform app.match_end(v_m.id, 'no_show', 'all_no_show', 'system');
            v_c := v_c || jsonb_build_object('no_show', (v_c->>'no_show')::int + 1);
          end if;
        end if;
      exception when others then
        -- One bad match never stops the rest: its changes roll back, it is
        -- counted, and the next run tries again.
        v_c := v_snap;
        v_errors := v_errors + 1;
        raise warning 'match_sweep: match % left for the next run: % (%)', v_mid, sqlerrm, sqlstate;
      end;
    end loop;
  end loop;

  -- Phase 3: chain-wide, each step on its own. A branch-scoped call (a manual
  -- rerun, a test) never touches other branches' guests or reports.
  if p_venue_id is null then
    begin
      v_refunds := coalesce(app.ticket_refund_deleted(null), 0);
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'match_sweep: DF-20 refunds left for the next run: % (%)', sqlerrm, sqlstate;
    end;
    begin
      delete from match_reports where created_at < now() - interval '12 months';
      get diagnostics v_purged = row_count;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'match_sweep: report purge left for the next run: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  return jsonb_build_object('venues_swept', v_swept, 'venues_skipped', v_skipped)
         || v_c
         || jsonb_build_object('refunds_started', v_refunds, 'reports_purged', v_purged, 'errors', v_errors);
end $match_sweep_0263$;

comment on function app.match_sweep(uuid) is
  '0263. Internal, service role (db.md §4.8.3; cron tp_match_sweep every 30 s). Finds the branches with due matches (all, or p_venue_id) without a lock, from a rotating offset; blocks on the first (courts -> the stale holds over its due filling and waiting matches, none when it has only booked work -> the branch mutex) and try-locks every later one (mutex, then courts, all or nothing; busy -> skipped, nothing held). Per match, in its own exception block, at most 200 a run: 1 pending requests past the deadline (filling, waiting) or the start (booked), code closed, or on an ended match, code its ended_reason; 2 deleted and banned holders (filling, waiting: match_drop_ineligible, and a waiting match left under four goes back to filling; booked before the start: a deleted holder''s seats -> left_late account_deleted); 3 the fit backstop (branch closed or hours/dates -> cancelled venue_closed; no court offers the length -> bumped no_court; none firm-free -> bumped); 4 the fill deadline -> expired; 5 the deadline_warning event at deadline - 30 min, once; 6 waiting: expired no_court at the start, else match_try_book (not while degraded inside the protected horizon); 7 at the start an unrefilled late leave''s ticket is forfeited (a deleted holder''s released); 8 at end_at + 3 h (sandbox: end_at) played with auto-attend (R37), or no_show. A chain-wide run then calls ticket_refund_deleted(null) (DF-20) and deletes match_reports older than 12 months (R36). Returns {venues_swept, venues_skipped, booked, awaiting_expired, bumped, expired, cancelled, warned, requests_expired, left_deleted, removed_banned, forfeited, played, no_show, refunds_started, reports_purged, errors}.';

revoke all on function app.match_sweep(uuid) from public, anon, authenticated;
grant execute on function app.match_sweep(uuid) to service_role;

-- ===========================================================================
-- 4. tp_match_sweep: every 30 seconds (every minute where pg_cron predates the
--    seconds syntax). Guarded like 0242's tp_deposit_sweep. After a hosted
--    push, cron.job must have the row (packages/db/CLAUDE.md).
-- ===========================================================================
do $match_cron_0263$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_match_sweep not scheduled';
    return;
  end if;
  begin
    perform cron.schedule('tp_match_sweep', '30 seconds', 'select app.match_sweep();');
  exception when others then
    raise notice 'pg_cron seconds syntax unsupported (%) - tp_match_sweep every minute', sqlerrm;
    perform cron.schedule('tp_match_sweep', '* * * * *', 'select app.match_sweep();');
  end;
end $match_cron_0263$;
