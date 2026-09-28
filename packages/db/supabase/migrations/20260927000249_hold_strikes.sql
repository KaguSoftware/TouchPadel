-- 0249 hold_strikes — a guest who keeps holding courts and letting the hold
-- lapse is made to wait, then suspended.
--
-- THE ABUSE. A hold keeps a court dark for everyone else for hold_ttl_seconds
-- (300 by default). The 0048 cap limits how many a guest has AT ONCE, but a
-- guest can hold, let it lapse and hold again all day, so the court looks busy
-- and walk-up and app guests go elsewhere.
--
-- THE LADDER (Parsa and Kemal, 2026-09-27). Chain-wide: a strike at one
-- branch counts at every branch, the way the hold cap already does.
--   * A strike is a hold that lapsed, or one the guest released more than 90
--     seconds after taking it (backing out of Review at once is browsing, not
--     abuse), where the guest never started a Qi Card payment on it (a bank
--     page that fails or times out is not the guest's doing).
--   * 1st strike: nothing is refused; hold_slot answers hold_warning = true and
--     the app asks the guest, kindly, to take care.
--   * 2nd strike: no new hold for 2 hours.
--   * 3rd strike: no new hold for 1 day.
--   * 4th strike and on: 7 days, and the guest is listed for staff review in
--     the day close of the branch where the strike happened. Staff lift it or
--     ban for good (app.hold_standing_decide).
--   * Memory is one day: a strike more than a day after the later of the last
--     strike and the end of the last wait starts again from the 1st. Counting
--     from the end of the wait, not the strike, is what makes the 4th step
--     reachable at all: a plain rolling day would be emptied by the 1-day wait.
--   * A blocked guest gets no message of their own (Parsa): HOLD_COOLDOWN and
--     BOOKING_SUSPENDED map to the app's generic error.
--
-- WHO. A verified phone number (auth.users.phone with phone_confirmed_at) is
-- the identity, stored only as a SHA-256 of its digits, so a new account on the
-- same number inherits the standing and a deleted account's ban outlives it.
-- An account with no verified phone is its own identity. profiles.phone is NOT
-- used: it is typed by the guest, so anybody could type somebody else's number
-- and get it banned (and every test guest shares one).
--
-- WHEN. Strikes are settled from reservations, never on a timer of their own:
--   * release_hold writes the released hold's ledger row itself (it alone
--     knows the release time);
--   * expire_stale_holds() with no arguments (the tp_hold_sweep cron, every
--     minute) settles every lapsed hold;
--   * hold_slot settles the caller's own lapsed holds before its check, so a
--     guest is never let through in the minute before the sweep.
-- Only holds taken after platform_settings.hold_strikes_since count; the
-- migration sets it to now() so nobody is punished for holds taken before the
-- rule existed. NULL switches the whole thing off.
--
-- Objects:
--   platform_settings.hold_strikes_since
--   hold_standing, hold_strikes (RPC-only, no client grant)
--   app.hold_standing_key, app.hold_key_guests, app.hold_strike_apply,
--   app.hold_strikes_settle, app.hold_standing_json (internal)
--   app.hold_reviews, app.hold_standing_decide, app.guest_hold_standing (staff)
--   re-issued: app.hold_slot, app.release_hold, app.expire_stale_holds

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The switch, and the line under old holds.
-- ---------------------------------------------------------------------------
alter table platform_settings add column if not exists hold_strikes_since timestamptz;

update platform_settings set hold_strikes_since = now()
 where id and hold_strikes_since is null;

comment on column platform_settings.hold_strikes_since is
  '0249: holds taken from this moment on count toward the hold ladder (app.hold_strike_apply). NULL switches the ladder off. Set to the migration time so no hold taken before the rule counts.';

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------
create table if not exists hold_standing (
  id              uuid not null default gen_random_uuid() unique,
  key             text primary key
                  check (key ~ '^(p:[0-9a-f]{64}|u:[0-9a-f-]{36})$'),
  guest_id        uuid references profiles(id) on delete set null,
  strikes         int not null default 0 check (strikes >= 0),
  last_strike_at  timestamptz,
  blocked_until   timestamptz,
  suspended_at    timestamptz,
  needs_review    boolean not null default false,
  review_venue_id uuid references venues(id),
  banned_at       timestamptz,
  banned_by       uuid references staff(id),
  reviewed_at     timestamptz,
  reviewed_by     uuid references staff(id),
  updated_at      timestamptz not null default now()
);

comment on table hold_standing is
  '0249. One row per guest identity that ever struck the hold ladder. key is p:<sha256 of the verified phone''s digits> or u:<profile id> (app.hold_standing_key). guest_id is the account last struck, for the desk to see a name. Written only by the 0249 functions.';

create table if not exists hold_strikes (
  reservation_id uuid primary key references reservations(id) on delete cascade,
  standing_key   text not null,
  counted        boolean not null,
  struck_at      timestamptz not null,
  created_at     timestamptz not null default now()
);

comment on table hold_strikes is
  '0249. The ledger: one row per hold the ladder has looked at, counted or not (a release inside 90 seconds, or a hold with a payment attempt, is recorded uncounted), so no hold is judged twice.';

alter table hold_standing enable row level security;
alter table hold_strikes enable row level security;
-- No policy and no client grant: staff read through app.hold_reviews and
-- app.guest_hold_standing; the service role bypasses RLS.
revoke all on hold_standing from anon, authenticated;
revoke all on hold_strikes from anon, authenticated;
grant all on hold_standing to service_role;
grant all on hold_strikes to service_role;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers.
-- ---------------------------------------------------------------------------
create or replace function app.hold_standing_key(p_guest_id uuid)
returns text
language sql stable security definer set search_path = public as $hold_standing_key_0249$
  select coalesce(
    (select 'p:' || encode(extensions.digest(d, 'sha256'), 'hex')
       from (select nullif(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), '') as d
               from auth.users u
              where u.id = p_guest_id and u.phone_confirmed_at is not null) x
      where d is not null),
    'u:' || p_guest_id::text)
$hold_standing_key_0249$;

comment on function app.hold_standing_key(uuid) is
  '0249. Internal. The hold-ladder identity of an account: p:<sha256 of its verified phone''s digits>, else u:<profile id>.';

revoke all on function app.hold_standing_key(uuid) from public, anon, authenticated;

create or replace function app.hold_key_guests(p_key text)
returns uuid[]
language sql stable security definer set search_path = public as $hold_key_guests_0249$
  select case
    when left(p_key, 2) = 'u:' then array[substr(p_key, 3)::uuid]
    else coalesce((
      select array_agg(u.id)
        from auth.users u
       where u.phone_confirmed_at is not null
         and encode(extensions.digest(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 'sha256'), 'hex')
             = substr(p_key, 3)), '{}'::uuid[])
  end
$hold_key_guests_0249$;

comment on function app.hold_key_guests(text) is
  '0249. Internal. Every account a hold-ladder key covers (all accounts verified on that phone).';

revoke all on function app.hold_key_guests(text) from public, anon, authenticated;

-- Applies ONE counted strike at p_at to the key's standing. The caller has
-- already written the hold_strikes row (that insert is the once-only guard).
create or replace function app.hold_strike_apply(
  p_key      text,
  p_guest_id uuid,
  p_venue_id uuid,
  p_at       timestamptz
) returns void
language plpgsql security definer set search_path = public as $hold_strike_apply_0249$
declare
  s       hold_standing%rowtype;
  v_until timestamptz;
begin
  insert into hold_standing (key) values (p_key) on conflict (key) do nothing;
  select * into s from hold_standing where key = p_key for update;

  -- A ban is final until staff lift it; keep the name current and stop.
  if s.banned_at is not null then
    update hold_standing
       set guest_id = coalesce(p_guest_id, guest_id), updated_at = now()
     where key = p_key;
    return;
  end if;

  -- One day of memory, counted from the end of the last wait.
  if s.strikes > 0
     and p_at >= greatest(s.last_strike_at, coalesce(s.blocked_until, s.last_strike_at))
                 + interval '1 day' then
    s.strikes := 0;
  end if;

  s.strikes := s.strikes + 1;
  v_until := case s.strikes
               when 1 then null
               when 2 then p_at + interval '2 hours'
               when 3 then p_at + interval '1 day'
               else        p_at + interval '7 days'
             end;

  update hold_standing
     set guest_id        = coalesce(p_guest_id, guest_id),
         strikes         = s.strikes,
         last_strike_at  = greatest(coalesce(s.last_strike_at, p_at), p_at),
         blocked_until   = case when v_until is null then s.blocked_until
                                else greatest(coalesce(s.blocked_until, v_until), v_until) end,
         suspended_at    = case when s.strikes >= 4 then now() else s.suspended_at end,
         needs_review    = case when s.strikes >= 4 then true else s.needs_review end,
         review_venue_id = case when s.strikes >= 4 then p_venue_id else s.review_venue_id end,
         reviewed_at     = case when s.strikes >= 4 then null else s.reviewed_at end,
         reviewed_by     = case when s.strikes >= 4 then null else s.reviewed_by end,
         updated_at      = now()
   where key = p_key;

  if s.strikes >= 4 then
    perform set_config('app.venue_id', p_venue_id::text, true);
    perform app.write_audit('guest.hold_suspended', 'hold_standing', s.id::text,
                            null, jsonb_build_object('strikes', s.strikes, 'blocked_until', v_until),
                            'hold_ladder');
  end if;
end $hold_strike_apply_0249$;

comment on function app.hold_strike_apply(text, uuid, uuid, timestamptz) is
  '0249. Internal. One counted strike: 1st nothing, 2nd a 2-hour wait, 3rd a day, 4th and on 7 days plus staff review at p_venue_id. A strike a day after the later of the last strike and the end of the last wait starts from the 1st again. A banned standing only has its guest_id refreshed.';

revoke all on function app.hold_strike_apply(text, uuid, uuid, timestamptz) from public, anon, authenticated;

-- Settles lapsed holds into strikes, oldest first: all of them (p_guests NULL,
-- the sweep) or those of the given accounts (hold_slot). Released holds are
-- never found here: release_hold wrote their ledger row already.
create or replace function app.hold_strikes_settle(p_guests uuid[] default null)
returns int
language plpgsql security definer set search_path = public as $hold_strikes_settle_0249$
declare
  v_since timestamptz;
  v_key   text;
  v_count int := 0;
  r       record;
begin
  select hold_strikes_since into v_since from platform_settings where id;
  if v_since is null then
    return 0;
  end if;

  for r in
    select h.id, h.guest_id, h.venue_id, h.hold_expires_at
      from reservations h
     where h.kind = 'hold'
       and h.source = 'mobile'
       and h.status in ('pending', 'expired')
       and h.guest_id is not null
       and (p_guests is null or h.guest_id = any(p_guests))
       and h.created_at >= v_since
       and h.hold_expires_at < now()
       -- A lapse older than the longest memory can no longer change anything.
       and h.hold_expires_at > now() - interval '2 days'
       and not exists (select 1 from hold_strikes s where s.reservation_id = h.id)
     order by h.hold_expires_at, h.id
  loop
    v_key := app.hold_standing_key(r.guest_id);
    if exists (select 1 from booking_payments bp where bp.hold_id = r.id) then
      insert into hold_strikes (reservation_id, standing_key, counted, struck_at)
      values (r.id, v_key, false, r.hold_expires_at)
      on conflict (reservation_id) do nothing;
    else
      insert into hold_strikes (reservation_id, standing_key, counted, struck_at)
      values (r.id, v_key, true, r.hold_expires_at)
      on conflict (reservation_id) do nothing;
      if found then
        perform app.hold_strike_apply(v_key, r.guest_id, r.venue_id, r.hold_expires_at);
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end $hold_strikes_settle_0249$;

comment on function app.hold_strikes_settle(uuid[]) is
  '0249. Internal. Turns lapsed mobile holds (taken since hold_strikes_since, lapsed within 2 days, not yet in hold_strikes) into strikes, oldest first; a hold with any booking_payments attempt is recorded uncounted. NULL = every account (the sweep). Returns the strikes counted.';

revoke all on function app.hold_strikes_settle(uuid[]) from public, anon, authenticated;

-- The standing as staff see it, with the day of memory applied.
create or replace function app.hold_standing_json(s hold_standing)
returns jsonb
language sql stable security definer set search_path = public as $hold_standing_json_0249$
  select case when s.key is null then null else jsonb_build_object(
    'id',             s.id,
    'strikes',        case when s.banned_at is not null then s.strikes
                           when s.last_strike_at is null
                             or now() >= greatest(s.last_strike_at, coalesce(s.blocked_until, s.last_strike_at))
                                         + interval '1 day' then 0
                           else s.strikes end,
    'status',         case when s.banned_at is not null then 'banned'
                           when s.blocked_until > now() and s.strikes >= 4 then 'suspended'
                           when s.blocked_until > now() then 'cooldown'
                           when s.strikes > 0 and s.last_strike_at is not null
                            and now() < greatest(s.last_strike_at, coalesce(s.blocked_until, s.last_strike_at))
                                        + interval '1 day' then 'warned'
                           else 'clear' end,
    'last_strike_at', s.last_strike_at,
    'blocked_until',  s.blocked_until,
    'suspended_at',   s.suspended_at,
    'needs_review',   s.needs_review,
    'banned_at',      s.banned_at,
    'guest_id',       s.guest_id,
    'guest_name',     p.full_name,
    'guest_phone',    p.phone) end
    from (select 1) one
    left join profiles p on p.id = s.guest_id
$hold_standing_json_0249$;

comment on function app.hold_standing_json(hold_standing) is
  '0249. Internal. {id, strikes (0 once the day of memory is over), status clear|warned|cooldown|suspended|banned, last_strike_at, blocked_until, suspended_at, needs_review, banned_at, guest_id, guest_name, guest_phone}.';

revoke all on function app.hold_standing_json(hold_standing) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staff: the day close list, the decision, the customer record.
-- ---------------------------------------------------------------------------
create or replace function app.hold_reviews(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $hold_reviews_0249$
declare
  v_venue uuid;
  v_out   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(app.hold_standing_json(s) order by s.suspended_at), '[]'::jsonb)
    into v_out
    from hold_standing s
   where s.needs_review
     and s.review_venue_id = v_venue;
  return v_out;
end $hold_reviews_0249$;

comment on function app.hold_reviews(uuid) is
  '0249. Manager, owner, at the branch. The guests the hold ladder suspended at this branch that no one has decided on yet (day close). Rows are app.hold_standing_json.';

revoke all on function app.hold_reviews(uuid) from public, anon;
grant execute on function app.hold_reviews(uuid) to authenticated;

create or replace function app.hold_standing_decide(p_standing_id uuid, p_decision text)
returns jsonb
language plpgsql security definer set search_path = public as $hold_standing_decide_0249$
declare
  s        hold_standing%rowtype;
  v_before jsonb;
  v_staff  uuid := auth.uid();
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_decision is null or p_decision not in ('lift', 'ban') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_decision';
  end if;

  select * into s from hold_standing where id = p_standing_id for update;
  if not found then
    raise exception 'HOLD_STANDING_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- The standing is the chain's; a manager decides at the branch it was
  -- raised at (or their own, for one never raised), the owner anywhere.
  if not app.is_staff_at(coalesce(s.review_venue_id, app.current_venue()), 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', coalesce(s.review_venue_id, app.current_venue())::text, true);

  v_before := app.hold_standing_json(s);

  if p_decision = 'lift' then
    update hold_standing
       set strikes = 0, blocked_until = null, banned_at = null, banned_by = null,
           needs_review = false, reviewed_at = now(), reviewed_by = v_staff, updated_at = now()
     where id = s.id
     returning * into s;
  else
    update hold_standing
       set banned_at = now(), banned_by = v_staff,
           needs_review = false, reviewed_at = now(), reviewed_by = v_staff, updated_at = now()
     where id = s.id
     returning * into s;
  end if;

  perform app.write_audit('guest.hold_standing', 'hold_standing', s.id::text,
                          v_before, app.hold_standing_json(s), p_decision);

  return app.hold_standing_json(s);
end $hold_standing_decide_0249$;

comment on function app.hold_standing_decide(uuid, text) is
  '0249. Manager, owner. lift: the guest may hold again at once (strikes, wait and ban cleared); ban: no hold ever again until lifted. Either takes the guest off the day close list. A manager decides at the branch the suspension was raised at. INVALID_ARGUMENT (detail p_decision), HOLD_STANDING_NOT_FOUND. Audited guest.hold_standing with the decision as reason.';

revoke all on function app.hold_standing_decide(uuid, text) from public, anon;
grant execute on function app.hold_standing_decide(uuid, text) to authenticated;

create or replace function app.guest_hold_standing(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $guest_hold_standing_0249$
declare
  s hold_standing%rowtype;
begin
  if not app.is_staff('court_desk', 'cashier', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into s from hold_standing where key = app.hold_standing_key(p_customer_id);
  if not found then
    return null;
  end if;
  return app.hold_standing_json(s);
end $guest_hold_standing_0249$;

comment on function app.guest_hold_standing(uuid) is
  '0249. The customer record''s staff (court desk, cashier, manager, owner). The customer''s hold-ladder standing (app.hold_standing_json), or null when they never struck.';

revoke all on function app.guest_hold_standing(uuid) from public, anon;
grant execute on function app.guest_hold_standing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. hold_slot: re-issued from 20260926000225_guest_reads_open_branches.sql:62,
--    plus the ladder check after the replay lookup and hold_warning.
-- ---------------------------------------------------------------------------
create or replace function app.hold_slot(
  p_court_id        uuid,
  p_start_at        timestamptz,
  p_duration_min    int,
  p_idempotency_key text default null,
  p_client_ref      text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $hold_slot_0249$
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

  -- 0249: the hold ladder, chain-wide, on the caller's identity (verified
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
end $hold_slot_0249$;

-- ---------------------------------------------------------------------------
-- 6. release_hold: re-issued from 20260927000242_online_deposit_rpcs.sql:1425,
--    plus the ledger row for the released hold.
-- ---------------------------------------------------------------------------
create or replace function app.release_hold(p_reservation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $release_hold_0249$
declare
  v_uid     uuid := auth.uid();
  v         reservations%rowtype;
  v_before  jsonb;
  v_since   timestamptz;
  v_key     text;
  v_counted boolean;
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

  -- 0242: the guest may already have paid at the bank; the slot waits for
  -- the payment's answer.
  if exists (select 1 from booking_payments
              where hold_id = v.id and status in ('created', 'pending')) then
    return jsonb_build_object('reservation_id', v.id, 'status', v.status,
      'released', false, 'payment_in_progress', true);
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = 'expired'
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.release', 'reservations', v.id::text,
                          v_before, to_jsonb(v), 'guest_released');

  -- 0249: the hold ladder. Only this function knows when a hold was handed
  -- back, so it writes the ledger row: a strike when the hold was kept more
  -- than 90 seconds and no payment was ever started on it, else uncounted
  -- (backing out of Review is browsing). A hold already past its TTL is left
  -- to the settle, which dates it by the lapse.
  select hold_strikes_since into v_since from platform_settings where id;
  if v_since is not null and v.source = 'mobile' and v.created_at >= v_since
     and v.hold_expires_at > now() then
    v_key := app.hold_standing_key(v_uid);
    v_counted := now() - v.created_at > interval '90 seconds'
                 and not exists (select 1 from booking_payments bp where bp.hold_id = v.id);
    insert into hold_strikes (reservation_id, standing_key, counted, struck_at)
    values (v.id, v_key, v_counted, now())
    on conflict (reservation_id) do nothing;
    if found and v_counted then
      perform app.hold_strike_apply(v_key, v_uid, v.venue_id, now());
    end if;
  end if;

  return jsonb_build_object('reservation_id', v.id, 'status', v.status,
    'released', true);
end $release_hold_0249$;

-- ---------------------------------------------------------------------------
-- 7. expire_stale_holds: re-issued from 20260927000242_online_deposit_rpcs.sql:1495,
--    plus: the whole-table sweep (no arguments: the tp_hold_sweep cron)
--    settles lapsed holds into strikes afterwards.
-- ---------------------------------------------------------------------------
create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $sweep_0249$
declare v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or r.guest_id is null)   -- 0071 (SEC-07): orphans too
        and (p_court_id is null or r.court_id = p_court_id)
        and (p_period is null or r.period && p_period)
        and not exists (select 1 from booking_payments bp
                         where bp.hold_id = r.id
                           and bp.status in ('created', 'pending')
                           and bp.deadline_at > now() - interval '10 minutes')
      order by r.id
      for update of r
   );
  get diagnostics v_count = row_count;

  if p_court_id is null and p_period is null then
    perform app.hold_strikes_settle(null);
  end if;

  return v_count;
end $sweep_0249$;
comment on function app.expire_stale_holds(uuid, tstzrange) is
  '0071: expires holds past their TTL AND orphan holds (guest_id is null), which no caller can release through app.release_hold and which would otherwise occupy the court until TTL. 0242: skips a hold whose online payment is still open, until ten minutes after that payment''s deadline. 0249: with no arguments (the cron sweep) it also settles lapsed holds into hold-ladder strikes.';
