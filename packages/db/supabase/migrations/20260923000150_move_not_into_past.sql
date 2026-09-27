-- 0150_move_not_into_past — app.move_reservation refuses a start that has
-- already passed (Parsa, 2026-09-23).
--
-- WHAT HAPPENED
--
-- A guest booked 00:00-01:00 from the phone. The desk dragged the block "half
-- an hour earlier" on the calendar grid and it landed at 22:30 — in the past.
-- move_reservation had no opinion about that: assert_bookable checks opening
-- hours and closed dates, price_slot checks that a rate prices the slot, the
-- exclusion constraint checks the court is free. None of them look at the
-- clock. So the move was taken, the desk kept showing 'confirmed', and the
-- guest's app — which splits its list at "has this ended?" — dropped the
-- booking out of Upcoming and into a history tab that only shows games that
-- were played or cancelled. From the guest's side the booking vanished.
--
-- The calendar was fixed the same day (the drag now keeps the grab offset,
-- draws the destination before the release, and refuses a past target), but
-- the desk is not the only caller and a client guard is not a wall. This is
-- the wall.
--
-- WHAT IS REFUSED
--
--   RESERVATION_IN_PAST  the start time CHANGES and the new one is < now()
--
-- A move that leaves start_at alone is untouched: that is a court change on a
-- game that is already running, which the desk does whenever a court floods or
-- a light fails, and it is the reason this is not simply 'v_start < now()'.
--
-- No schema change; one function, re-issued verbatim from 0071 with the guard
-- added after the INVALID_RANGE check and before assert_bookable, so a refused
-- move does no pricing work and leaves the row exactly as it was. The
-- signature is unchanged, so 0026's grants carry over.

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.move_reservation(
  p_reservation_id uuid,
  p_court_id       uuid default null,
  p_start_at       timestamptz default null,
  p_end_at         timestamptz default null,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $move_0150$
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

  -- 0150: a start MOVED into the past strands the booking. On 2026-09-23 a
  -- 00:00-01:00 booking made from the app was dragged "half an hour earlier"
  -- on the desk grid and landed at 22:30: this function took it, the desk went
  -- on calling it confirmed, and on the guest's phone it left Upcoming and
  -- appeared in no list at all. Nothing downstream can repair that, so it is
  -- refused here.
  --
  -- A start that does NOT move is not this: carrying a game already running
  -- across to another court is a normal desk act and only the court changes.
  -- Shortening and extending go through extend_reservation, not this function,
  -- so neither is caught by the guard.
  if v_start is distinct from v.start_at and v_start < now() then
    raise exception 'RESERVATION_IN_PAST' using errcode = 'P0001',
      detail = format('%s -> %s', v.start_at, v_start),
      hint = 'a booking cannot be moved to a start time that has already passed';
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
end $move_0150$;
-- move_reservation grants unchanged (0026): create or replace preserves them.
