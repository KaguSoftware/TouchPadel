-- 0071 — Phase 2: booking and money integrity (docs/security/security-general.md §06)
--
-- Layer 1 is the floor; this is the first slice that sits on it. Four items,
-- each one a box in §06 that migrations 0048/0049 did NOT close:
--
--   SEC-07  a LIVE hold must belong to an account          (structural, not just RPC)
--   SEC-10  rate_rule_prices: positive price, sane minutes (only start<end existed)
--   SEC-09  a move/extend that CHANGES the price needs a reason, and the audit
--           row carries both prices as first-class fields
--   SEC-11  ★ a reservation that has not started cannot be marked no_show or
--           completed — the two transitions that FREE the slot for resale
--
-- Ordering inside the file is cheapest-first: data cleanup, then NOT VALID
-- constraints, then VALIDATE, then function bodies. Nothing here takes a lock
-- on `reservations` for longer than a primary-key update.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. SEC-07 — a live hold belongs to an account
--
-- 0048/C1 made app.hold_slot refuse an anonymous identity (ACCOUNT_REQUIRED),
-- which stops NEW orphan holds arriving through the guest path. It did not say
-- anything about rows already in the table, and it is a guard in one function
-- rather than a property of the data.
--
-- WHY AN ORPHAN HOLD IS WORSE THAN IT LOOKS. A hold with guest_id IS NULL sits
-- in the exclusion set (status 'pending'), so the court reads as busy to every
-- other guest — and NOBODY can hand it back: app.release_hold (0060) matches on
-- `guest_id = auth.uid()`, which no caller can satisfy. It occupies the slot
-- until its TTL runs out and the sweep notices.
--
-- SCOPE OF THE CONSTRAINT: `status <> 'pending'`, deliberately. A hold is only
-- ever pending while it is live — app.confirm_booking rewrites kind to
-- 'booking' on the way through (0008:321) — so expired and cancelled holds are
-- immutable history. Constraining them would mean rewriting the record of what
-- happened in order to satisfy a rule invented afterwards, and VALIDATE would
-- fail on the first legacy row rather than telling us anything true.
-- ═══════════════════════════════════════════════════════════════════════════

-- Clean first: expire any live orphan. Status-only write by id, leaving the
-- exclusion set — the same shape as app.expire_stale_holds, so it cannot create
-- an overlap and needs no court lock.
update reservations
   set status = 'expired'
 where kind = 'hold'
   and status = 'pending'
   and guest_id is null;

do $orphan_holds$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_live_hold_has_guest') then
    alter table reservations
      add constraint reservations_live_hold_has_guest
      check (kind <> 'hold' or status <> 'pending' or guest_id is not null) not valid;
  end if;
end $orphan_holds$;

alter table reservations validate constraint reservations_live_hold_has_guest;

-- ---------------------------------------------------------------------------
-- app.expire_stale_holds — 0042 body, widened to sweep orphans.
--
-- Same signature, same contract, same deterministic `order by id ... for
-- update` lock sequence (0042's whole point: the scoped RPC sweeps and the
-- unfiltered tp_hold_sweep cron take row locks in the same order and queue
-- instead of deadlocking). The only change is the predicate.
--
-- An orphan is swept ON SIGHT rather than at its TTL, because there is no
-- caller who could release it and no guest whose checkout it belongs to. It is
-- pure slot occupancy. The constraint above means new ones cannot appear, so
-- this branch exists for rows written before the constraint and for anything
-- that reaches the table outside the RPCs.
-- ---------------------------------------------------------------------------
create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $sweep_0071$
declare v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select id from reservations
      where kind = 'hold' and status = 'pending'
        and (hold_expires_at < now() or guest_id is null)   -- 0071 (SEC-07): orphans too
        and (p_court_id is null or court_id = p_court_id)
        and (p_period is null or period && p_period)
      order by id
      for update
   );
  get diagnostics v_count = row_count;
  return v_count;
end $sweep_0071$;

comment on function app.expire_stale_holds(uuid, tstzrange) is
  '0071: expires holds past their TTL AND orphan holds (guest_id is null), which no caller can release through app.release_hold and which would otherwise occupy the court until TTL.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SEC-10 — rate_rule_prices: a positive price and a sane duration
--
-- `price_iqd` is the `iqd` domain, `bigint check (value >= 0)` (0002:26). Zero
-- therefore passes, and a zero-priced rule is not a free court — it is a rule
-- that silently wins the price_slot resolution (court-specificity → priority →
-- id) and charges nothing, with no error anywhere to notice it by. The money
-- path is exact integers with no float, so "0" survives every downstream
-- calculation looking perfectly valid.
--
-- `duration_min` had no bound at all: 0 and negative values were insertable,
-- and app.price_slot joins on `p.duration_min = p_duration_min`, so a garbage
-- row is dead weight rather than an error — a rule that looks configured in the
-- admin UI and prices nothing.
--
-- Bounds: 15 minutes to 8 hours, on a 5-minute grid. `courts.duration_options`
-- defaults to {60,90,120} and every seeded and fixture price is 60/90/120, so
-- this is generous rather than tight — it exists to reject 0, negatives and
-- typo'd magnitudes, not to encode the venue's product.
-- ═══════════════════════════════════════════════════════════════════════════

do $rate_price_guards$
begin
  if not exists (select 1 from pg_constraint where conname = 'rate_rule_prices_price_positive') then
    alter table rate_rule_prices
      add constraint rate_rule_prices_price_positive check (price_iqd > 0) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'rate_rule_prices_duration_bounds') then
    alter table rate_rule_prices
      add constraint rate_rule_prices_duration_bounds
      check ((duration_min between 15 and 480) and (duration_min % 5 = 0)) not valid;
  end if;
end $rate_price_guards$;

alter table rate_rule_prices validate constraint rate_rule_prices_price_positive;
alter table rate_rule_prices validate constraint rate_rule_prices_duration_bounds;

-- ---------------------------------------------------------------------------
-- app.upsert_rate_rule — 0048 body + named errors for the two new constraints.
--
-- The constraints are the control; these raises are the ERROR SURFACE. Without
-- them a manager saving a typo'd price gets a raw 23514 naming
-- `rate_rule_prices_price_positive`, which is both unreadable and a disclosure
-- of the schema (SEC-36's quiet-error rule). With them the admin UI shows
-- INVALID_PRICES and the hint says what to type instead.
--
-- The existing `^[0-9]+$` regex is kept and still runs first: it rejects a
-- non-numeric or negative literal before anything is cast, so the cast below
-- cannot raise 22P02 on hostile input. The new checks run on the CAST values,
-- because that is the only place "0" and "7" are distinguishable from "60".
-- ---------------------------------------------------------------------------
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
language plpgsql security definer set search_path = public as $rate_0071$
declare
  v_before jsonb;
  v_row    rate_rules%rowtype;
  v_kv     record;
  v_dur    int;
  v_price  bigint;
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

  -- 0071 (SEC-10): validate the WHOLE price map before any write. A rule whose
  -- durations are half-written is worse than one that was refused — the admin
  -- UI replaces prices wholesale (the delete below), so a mid-loop failure
  -- would leave the rule priced for fewer durations than it had before.
  for v_kv in select key, value from jsonb_each_text(p_prices) loop
    if v_kv.key !~ '^[0-9]+$' or v_kv.value !~ '^[0-9]+$' then
      raise exception 'INVALID_PRICES' using errcode = 'P0001',
        detail = format('bad entry %s: %s', v_kv.key, v_kv.value);
    end if;
    v_dur   := v_kv.key::int;
    v_price := v_kv.value::bigint;
    if v_price <= 0 then
      raise exception 'INVALID_PRICES' using errcode = 'P0001',
        detail = format('duration %s', v_dur),
        hint = 'a price must be greater than zero; use is_active = false to retire a rule';
    end if;
    if v_dur < 15 or v_dur > 480 or v_dur % 5 <> 0 then
      raise exception 'INVALID_DURATION' using errcode = 'P0001',
        detail = format('duration %s', v_dur),
        hint = 'duration_min: 15 to 480 minutes, in steps of 5';
    end if;
  end loop;

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
    insert into rate_rule_prices (rule_id, duration_min, price_iqd)
    values (v_row.id, v_kv.key::int, v_kv.value::bigint);
  end loop;

  perform app.write_audit(
    case when v_before is null then 'rates.rule.create' else 'rates.rule.update' end,
    'rate_rules', v_row.id::text, v_before,
    to_jsonb(v_row) || jsonb_build_object('prices', p_prices));

  return v_row.id;
end $rate_0071$;
-- upsert_rate_rule grants unchanged (0013:588): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SEC-09 — a move or extend that CHANGES the price needs a reason
--
-- 0048/H1 made both functions re-price. That closed the money hole (a desk move
-- from off-peak to peak used to keep the cheap price) and opened a smaller one:
-- the re-price is silent. `p_reason` defaults to 'staff_op', so a booking whose
-- price moved by 20,000 IQD is auditable only by DIFFING the before/after JSON
-- blobs, under a reason code that says nothing.
--
-- Two changes, both narrow:
--
--   a) When and only when the resolved price DIFFERS from the stored one, a real
--      reason is required. 'staff_op' is the ABSENCE of a reason spelled as a
--      default, so it is rejected alongside null and blank. The operator UI
--      already sends one of OVERRIDE_REASONS on every path
--      (ReservationActionsDialog.tsx:26) and already renders REASON_REQUIRED as
--      a refusal rather than a failure (deskLogic.ts OVERRIDE_REFUSAL_CODES), so
--      no client changes behaviour — this closes the RPC, not the button.
--
--   b) The audit `after` payload carries price_before / price_after / rate_rule_
--      before / rate_rule_after as named fields. write_audit already stores the
--      whole row twice; the point is that "show me every move that changed a
--      price" becomes a query on named keys instead of a JSON diff performed by
--      whoever is reading.
--
-- A MANUAL OVERRIDE still cannot be re-priced (0048/H1) and therefore never
-- triggers this: v_price is copied from the row, so it cannot differ.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- app.reason_given — is this a reason, or the absence of one?
--
-- `p_reason text default 'staff_op'` means every caller that says nothing still
-- writes a reason code, so "did a person explain this?" cannot be answered by
-- `p_reason is not null`. This is the one place that judgement lives, so the
-- move and extend paths cannot drift apart on it.
--
-- Rejects: null, blank or whitespace, the literal default, and anything shorter
-- than three characters (a single keystroke is a way past the prompt, not an
-- explanation). Every code the operator offers — OVERRIDE_REASONS and
-- CANCEL_REASONS in ReservationActionsDialog.tsx — passes.
--
-- Not a client-callable RPC: no grant, so it never appears in the RPC registry.
-- ---------------------------------------------------------------------------
create or replace function app.reason_given(p_reason text) returns boolean
language sql immutable set search_path = public as $reason_given_0071$
  select p_reason is not null
     and btrim(p_reason) <> ''
     and lower(btrim(p_reason)) <> 'staff_op'
     and length(btrim(p_reason)) >= 3
$reason_given_0071$;

revoke all on function app.reason_given(text) from public, anon, authenticated;

create or replace function app.move_reservation(
  p_reservation_id uuid,
  p_court_id       uuid default null,
  p_start_at       timestamptz default null,
  p_end_at         timestamptz default null,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $move_0071$
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
  v_was      bigint;
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

  -- 0048 (H5): the lock set above was chosen from an UNLOCKED peek. Two
  -- concurrent movers hold DIFFERENT pairs, so the locked court can differ from
  -- the peek; writing anyway would enter the exclusion window holding no lock on
  -- the court we write. 40001 is retryable, which is what the caller should do.
  if v.court_id is distinct from v_from then
    raise exception 'RESERVATION_MOVED' using errcode = '40001',
      hint = 'the reservation changed court while locks were acquired - retry';
  end if;

  v_before := to_jsonb(v);
  v_was    := v.price_iqd;
  v_court  := coalesce(p_court_id, v.court_id);
  v_start  := coalesce(p_start_at, v.start_at);
  v_end    := coalesce(p_end_at, v.end_at);
  if v_end <= v_start then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  -- 0048 (H2): re-validate opening hours and closed dates. Maintenance is
  -- exempt for the same reason it is in staff_create_reservation.
  if v.kind <> 'maintenance' then
    perform app.assert_bookable(v_court, v_start, v_end);
  end if;

  perform app.expire_stale_holds(v_court, tstzrange(v_start, v_end, '[)'));

  -- 0048 (H1): re-price. A MANUAL OVERRIDE is preserved: rate_rule_id null with
  -- a price set means a manager priced this deliberately
  -- (staff_create_reservation, p_price_override_iqd).
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

  -- 0071 (SEC-09): the money changed, so a person has to say why. Checked
  -- BEFORE the write, so a refused move leaves the reservation exactly as it
  -- was rather than moved-but-unexplained.
  if v_price is distinct from v_was and not app.reason_given(p_reason) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      detail = format('price %s -> %s', coalesce(v_was::text, 'null'), coalesce(v_price::text, 'null')),
      hint = 'a move that changes the price needs an explicit reason';
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

  -- 0071 (SEC-09): both prices as NAMED fields, not only as a diff of two row
  -- snapshots. "every move that changed a price" is then a query, not a read.
  perform app.write_audit('reservation.move', 'reservations', v.id::text,
                          v_before,
                          to_jsonb(v) || jsonb_build_object(
                            'price_before',     v_was,
                            'price_after',      v.price_iqd,
                            'price_changed',    (v.price_iqd is distinct from v_was),
                            'rate_rule_before', v_before ->> 'rate_rule_id',
                            'rate_rule_after',  v.rate_rule_id),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'court_id', v.court_id,
    'start_at', v.start_at, 'end_at', v.end_at,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd,
    'price_before', v_was, 'price_changed', (v.price_iqd is distinct from v_was));
end $move_0071$;
-- move_reservation grants unchanged (0026): replace preserves them.

create or replace function app.extend_reservation(
  p_reservation_id uuid,
  p_new_end_at     timestamptz,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $extend_0071$
declare
  v          reservations%rowtype;
  v_before   jsonb;
  v_from     uuid;
  v_dur      int;
  v_rule     uuid;
  v_price    bigint;
  v_override boolean;
  v_was      bigint;
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

  -- 0048 (H5): see move_reservation.
  if v.court_id is distinct from v_from then
    raise exception 'RESERVATION_MOVED' using errcode = '40001',
      hint = 'the reservation changed court while locks were acquired - retry';
  end if;

  v_before := to_jsonb(v);
  v_was    := v.price_iqd;

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

  -- 0071 (SEC-09): an extend almost ALWAYS re-prices (60 -> 120 minutes is a
  -- different price row), so this is the path the rule was written for.
  if v_price is distinct from v_was and not app.reason_given(p_reason) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      detail = format('price %s -> %s', coalesce(v_was::text, 'null'), coalesce(v_price::text, 'null')),
      hint = 'an extend that changes the price needs an explicit reason';
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
                          v_before,
                          to_jsonb(v) || jsonb_build_object(
                            'price_before',     v_was,
                            'price_after',      v.price_iqd,
                            'price_changed',    (v.price_iqd is distinct from v_was),
                            'rate_rule_before', v_before ->> 'rate_rule_id',
                            'rate_rule_after',  v.rate_rule_id),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'end_at', v.end_at,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd,
    'price_before', v_was, 'price_changed', (v.price_iqd is distinct from v_was));
end $extend_0071$;
-- extend_reservation grants unchanged (0026): replace preserves them.

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SEC-11 ★ — a reservation that has not started cannot be freed for resale
--
-- THE HOLE. app.mark_reservation (0026) accepts no_show and completed from
-- 'confirmed' with no reference to the clock. Both statuses are OUTSIDE the
-- exclusion predicate (`status in ('pending','confirmed','arrived')`), so the
-- moment either is written the court is free and the slot can be sold again —
-- for a booking three days away, with the guest's confirmation email in their
-- inbox and their money already taken.
--
-- That is not a hypothetical staff mistake. It is the shape of the fraud: mark
-- a paid Friday-night booking no_show on Tuesday, resell the slot, and the
-- ledger shows an unremarkable no-show. 'arrived' is deliberately NOT guarded —
-- it stays INSIDE the exclusion set, so an early check-in frees nothing.
--
-- THE LEGITIMATE PATH REMAINS OPEN, which is what makes this safe to enforce:
-- app.cancel_reservation takes a reason, applies
-- venue_settings.cancellation_window_hours to guests, and is the audited verb
-- for "this booking is not going to happen". A desk that genuinely needs the
-- slot back early cancels it. The difference is that a cancellation says so.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.mark_reservation(
  p_reservation_id uuid,
  p_status         reservation_status,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $mark_0071$
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

  -- 0071 (SEC-11): the two transitions that LEAVE the exclusion set may not be
  -- applied to a reservation that has not started yet. Checked against the
  -- FOR UPDATE read, so it cannot race a concurrent move that shifted start_at.
  if p_status in ('no_show','completed') and now() < v.start_at then
    raise exception 'RESERVATION_NOT_STARTED' using errcode = 'P0001',
      detail = format('starts at %s', v.start_at),
      hint = 'a future booking is cancelled through cancel_reservation with a reason, not marked no_show';
  end if;

  v_before := to_jsonb(v);

  update reservations set status = p_status
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.mark_' || p_status::text, 'reservations',
                          v.id::text, v_before, to_jsonb(v),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $mark_0071$;

comment on function app.mark_reservation(uuid, reservation_status, text) is
  '0071: desk lifecycle arrived/no_show/completed. no_show and completed leave the exclusion set and so are refused before start_at (RESERVATION_NOT_STARTED) — a future booking is cancelled, not marked absent.';
-- mark_reservation grants unchanged (0026): replace preserves them.
