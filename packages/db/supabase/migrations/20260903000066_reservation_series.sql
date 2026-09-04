-- 0066_reservation_series — recurring bookings (spec 06.5 RecurringSeriesCreate,
-- 06.6 SeriesDetail; build plan 2026-09-03 §4 "0066 series").
--
-- A series is a PLAN (court, pattern, wall-clock time, date range, guest); its
-- occurrences are ordinary `reservations` rows tagged with `series_id`. Nothing
-- here inserts into reservations directly: every occurrence goes through
-- app.staff_create_reservation (0048 body), so the exclusion constraint, the
-- booking-hours guard, pricing provenance, the court lock and the per-row
-- audit all apply exactly as they do for a single desk booking. Build plan §0:
-- "the exclusion constraint remains the guard" -- flagged for Parsa review.
--
--   1. reservation_series + reservations.series_id. RLS: staff read
--      (court_desk, cashier, manager, owner) + the owning guest; writes are
--      RPC-only for everyone.
--   2. app.series_occurrences   INTERNAL: pattern -> dated occurrences in the
--                               VENUE timezone (venue_settings.timezone, the
--                               0026/0041 convention). Cap 200 (SERIES_TOO_LONG).
--   3. app.series_slot_conflict INTERNAL: the constraint's own `&&` test, minus
--                               stale holds (which every writer sweeps first).
--   4. app.preview_series       STABLE, no locks. Every occurrence with its
--                               conflict (SLOT_TAKEN | CLOSED_DATE |
--                               OUTSIDE_HOURS | NO_RATE), whether it is
--                               resolvable by moving court, and to which courts.
--   5. app.create_series        ONE transaction. Pre-locks every court the
--                               series can touch in sorted id order (0042 total
--                               order; advisory xact locks are re-entrant, so
--                               staff_create_reservation's own lock_court is a
--                               no-op inside), then creates occurrence by
--                               occurrence. Any occurrence still conflicting
--                               after the resolutions -> SERIES_UNRESOLVED_CONFLICTS
--                               and the whole series rolls back. Idempotent on
--                               p_idempotency_key (0048/H3 caller-scoped replay).
--   6. app.series_detail        staff, or the owning guest.
--   7. app.cancel_series        'future' | 'all'; REASON_REQUIRED; each row goes
--                               through app.cancel_reservation so its audit row
--                               carries the reason; a row whose end_at < now()
--                               is never touched (spec 06.6: played occurrences
--                               are untouchable).
--
-- Error codes: SERIES_UNRESOLVED_CONFLICTS, SERIES_TOO_LONG, SERIES_EMPTY,
-- SERIES_NOT_FOUND, INVALID_PATTERN, INVALID_WEEKDAYS, INVALID_RESOLUTION,
-- INVALID_SCOPE, REASON_REQUIRED (+ the existing COURT_NOT_FOUND,
-- GUEST_REQUIRED, GUEST_NOT_FOUND, INVALID_RANGE, INVALID_DURATION,
-- IDEMPOTENCY_CONFLICT, FORBIDDEN, AUTH_REQUIRED, ACCOUNT_REQUIRED).
--
-- covered by packages/db/tests/series.test.ts; rls-matrix.ts drop 5 rules.

-- ---------------------------------------------------------------------------
-- 1. Table + reservations.series_id
-- ---------------------------------------------------------------------------
create table if not exists reservation_series (
  id                  uuid primary key default gen_random_uuid(),
  court_id            uuid not null references courts(id),
  pattern             text not null check (pattern in ('weekly','fortnightly','weekdays')),
  weekdays            int[] not null default '{}',      -- 0 = Sunday; 'weekdays' pattern only
  start_time          time not null,                     -- venue-local wall clock
  duration_min        int  not null check (duration_min > 0),
  starts_on           date not null,
  ends_on             date not null,
  guest_id            uuid references profiles(id),
  guest_name          text,
  guest_phone         text,
  notes               text,
  created_by_staff_id uuid references staff(id),
  idempotency_key     text unique,                       -- '{station}:{mutation_type}:{ulid}' (override #2)
  created_at          timestamptz not null default now(),
  cancelled_at        timestamptz,
  cancelled_reason    text,
  check (ends_on >= starts_on),
  check (guest_id is not null or guest_name is not null)
);

comment on table reservation_series is
  '0066: a recurring-booking plan. Occurrences are reservations rows with series_id set; they are created ONLY through app.create_series -> app.staff_create_reservation.';

create index if not exists reservation_series_court on reservation_series (court_id, starts_on);
create index if not exists reservation_series_guest on reservation_series (guest_id) where guest_id is not null;

alter table reservations add column if not exists series_id uuid references reservation_series(id);
create index if not exists reservations_series on reservations (series_id) where series_id is not null;

alter table reservation_series enable row level security;
revoke all on table reservation_series from public, anon, authenticated;
grant select on reservation_series to authenticated;

drop policy if exists reservation_series_staff_read on reservation_series;
create policy reservation_series_staff_read on reservation_series for select to authenticated
  using (app.is_staff('court_desk','cashier','manager','owner'));
drop policy if exists reservation_series_guest_read on reservation_series;
create policy reservation_series_guest_read on reservation_series for select to authenticated
  using (guest_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. app.series_occurrences — INTERNAL. The one place a pattern becomes dates.
--
-- Venue-local: `date + time` is a naive wall-clock timestamp; `at time zone
-- venue_settings.timezone` turns it into the instant the exclusion constraint
-- and assert_bookable reason about. weekly = every 7 days from starts_on,
-- fortnightly = every 14, weekdays = each listed weekday inside the range.
-- ---------------------------------------------------------------------------
create or replace function app.series_occurrences(
  p_pattern      text,
  p_weekdays     int[],
  p_start_time   time,
  p_duration_min int,
  p_starts_on    date,
  p_ends_on      date
) returns table (occ_date date, start_at timestamptz, end_at timestamptz)
language plpgsql stable security definer set search_path = public as $series_occ_0066$
declare
  v_tz    text;
  v_dates date[];
  v_wd    int;
begin
  if p_pattern is null or p_pattern not in ('weekly','fortnightly','weekdays') then
    raise exception 'INVALID_PATTERN' using errcode = 'P0001',
      hint = 'pattern: weekly | fortnightly | weekdays';
  end if;
  if p_pattern = 'weekdays' then
    if p_weekdays is null or coalesce(array_length(p_weekdays, 1), 0) = 0 then
      raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001',
        hint = 'weekdays: 0=Sun..6=Sat, at least one';
    end if;
    foreach v_wd in array p_weekdays loop
      if v_wd is null or v_wd < 0 or v_wd > 6 then
        raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001',
          detail = coalesce(v_wd::text, 'null'), hint = 'weekdays: 0=Sun..6=Sat';
      end if;
    end loop;
  end if;
  if p_start_time is null or p_starts_on is null or p_ends_on is null then
    raise exception 'INVALID_RANGE' using errcode = 'P0001',
      hint = 'start_time, starts_on and ends_on are required';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'INVALID_RANGE' using errcode = 'P0001',
      hint = 'ends_on must not precede starts_on';
  end if;
  if p_duration_min is null or p_duration_min <= 0 then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;
  -- Coarse bound BEFORE generating anything: even the sparsest pattern
  -- (fortnightly) exceeds the cap past this span, so no caller can make the
  -- generator walk years of days.
  if (p_ends_on - p_starts_on) >= 200 * 14 then
    raise exception 'SERIES_TOO_LONG' using errcode = 'P0001',
      hint = 'at most 200 occurrences per series';
  end if;

  select timezone into v_tz from venue_settings;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');

  select array_agg(g.d::date order by g.d) into v_dates
    from generate_series(p_starts_on::timestamp, p_ends_on::timestamp,
                         case p_pattern when 'weekly'      then interval '7 days'
                                        when 'fortnightly' then interval '14 days'
                                        else                    interval '1 day' end) as g(d)
   where p_pattern <> 'weekdays' or extract(dow from g.d)::int = any (p_weekdays);

  if coalesce(array_length(v_dates, 1), 0) = 0 then
    raise exception 'SERIES_EMPTY' using errcode = 'P0001',
      hint = 'no date inside the range matches the pattern';
  end if;
  if array_length(v_dates, 1) > 200 then
    raise exception 'SERIES_TOO_LONG' using errcode = 'P0001',
      detail = array_length(v_dates, 1)::text, hint = 'at most 200 occurrences per series';
  end if;

  return query
    select u.d,
           ((u.d + p_start_time)::timestamp at time zone v_tz),
           ((u.d + p_start_time)::timestamp at time zone v_tz) + make_interval(mins => p_duration_min)
      from unnest(v_dates) as u(d)
     order by u.d;
end $series_occ_0066$;

revoke all on function app.series_occurrences(text, int[], time, int, date, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.series_slot_conflict — INTERNAL. The exclusion constraint's own test
--    (court =, period &&, live statuses), minus holds already past their TTL:
--    every writer sweeps those before inserting, so they never block a write.
-- ---------------------------------------------------------------------------
create or replace function app.series_slot_conflict(
  p_court_id uuid,
  p_start_at timestamptz,
  p_end_at   timestamptz
) returns table (reservation_id uuid, kind reservation_kind)
language sql stable security definer set search_path = public as $series_conflict_0066$
  select r.id, r.kind
    from reservations r
   where r.court_id = p_court_id
     and r.status in ('pending','confirmed','arrived')
     and (r.kind <> 'hold' or r.hold_expires_at > now())
     and r.period && tstzrange(p_start_at, p_end_at, '[)')
   order by r.start_at, r.id
   limit 1
$series_conflict_0066$;

revoke all on function app.series_slot_conflict(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.preview_series — read-only, STABLE, no locks.
--
-- {occurrences:[{date, startsAt, endsAt, courtId,
--                conflict: null | {existingReservationId, existingKind, reason,
--                                  resolvable, alternativeCourtIds}}]}
--
-- reason: SLOT_TAKEN (a live reservation or maintenance block overlaps),
--         CLOSED_DATE / OUTSIDE_HOURS (app.assert_bookable would refuse it),
--         NO_RATE (no rate rule prices this court/slot/duration, so
--         staff_create_reservation would refuse it).
-- resolvable = at least one OTHER active court is free AND priced for the slot.
-- Hours failures are venue-wide, so they are never resolvable by moving court.
-- ---------------------------------------------------------------------------
create or replace function app.preview_series(
  p_court_id     uuid,
  p_pattern      text,
  p_weekdays     int[],
  p_start_time   time,
  p_duration_min int,
  p_starts_on    date,
  p_ends_on      date
) returns jsonb
language plpgsql stable security definer set search_path = public as $preview_series_0066$
declare
  v_occ      record;
  v_hit      record;
  v_reason   text;
  v_alts     uuid[];
  v_conflict jsonb;
  v_out      jsonb := '[]'::jsonb;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from courts where id = p_court_id and is_active) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_occ in
    select o.occ_date, o.start_at, o.end_at
      from app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                  p_starts_on, p_ends_on) o
     order by o.occ_date
  loop
    v_reason   := null;
    v_conflict := null;

    -- The same guard staff_create_reservation applies, asked instead of raised.
    begin
      perform app.assert_bookable(p_court_id, v_occ.start_at, v_occ.end_at);
    exception
      when raise_exception then
        if sqlerrm in ('CLOSED_DATE', 'OUTSIDE_HOURS') then
          v_reason := sqlerrm;
        else
          raise;
        end if;
    end;

    if v_reason is not null then
      v_conflict := jsonb_build_object(
        'existingReservationId', null,
        'existingKind',          null,
        'reason',                v_reason,
        'resolvable',            false,
        'alternativeCourtIds',   '[]'::jsonb);
    else
      select c.reservation_id, c.kind into v_hit
        from app.series_slot_conflict(p_court_id, v_occ.start_at, v_occ.end_at) c;
      if found then
        v_reason := 'SLOT_TAKEN';
      elsif not exists (select 1 from app.price_slot(p_court_id, v_occ.start_at, p_duration_min)) then
        v_reason := 'NO_RATE';
      end if;

      if v_reason is not null then
        select coalesce(array_agg(c.id order by c.sort_order, c.id), '{}'::uuid[]) into v_alts
          from courts c
         where c.is_active
           and c.id <> p_court_id
           and not exists (select 1 from app.series_slot_conflict(c.id, v_occ.start_at, v_occ.end_at))
           and exists (select 1 from app.price_slot(c.id, v_occ.start_at, p_duration_min));
        v_conflict := jsonb_build_object(
          'existingReservationId', case when v_reason = 'SLOT_TAKEN' then v_hit.reservation_id end,
          'existingKind',          case when v_reason = 'SLOT_TAKEN' then v_hit.kind::text end,
          'reason',                v_reason,
          'resolvable',            coalesce(array_length(v_alts, 1), 0) > 0,
          'alternativeCourtIds',   to_jsonb(v_alts));
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'date',     v_occ.occ_date,
      'startsAt', v_occ.start_at,
      'endsAt',   v_occ.end_at,
      'courtId',  p_court_id,
      'conflict', v_conflict);
  end loop;

  return jsonb_build_object('occurrences', v_out, 'count', jsonb_array_length(v_out));
end $preview_series_0066$;

revoke all on function app.preview_series(uuid, text, int[], time, int, date, date) from public, anon;
grant execute on function app.preview_series(uuid, text, int[], time, int, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.create_series — the whole series in ONE transaction.
--
-- p_resolutions: [{date: 'YYYY-MM-DD', action: 'skip' | 'moveCourt', courtId}]
-- Returns {seriesId, created: uuid[], skipped: date[], duplicate}.
--
-- LOCK ORDER (0042 / check-lock-order.mjs): every court this series can write
-- to is locked up front, in ascending id order, BEFORE the first occurrence is
-- created. staff_create_reservation re-takes lock_court per occurrence; a
-- transaction-level advisory lock already held by this transaction is granted
-- immediately, so the per-occurrence order cannot invert the pre-lock order.
-- The pre-locks are taken OUTSIDE any exception block on purpose: a lock taken
-- inside a subtransaction is released when that subtransaction aborts.
-- ---------------------------------------------------------------------------
create or replace function app.create_series(
  p_court_id        uuid,
  p_pattern         text,
  p_weekdays        int[],
  p_start_time      time,
  p_duration_min    int,
  p_starts_on       date,
  p_ends_on         date,
  p_guest_id        uuid  default null,
  p_guest_name      text  default null,
  p_guest_phone     text  default null,
  p_notes           text  default null,
  p_resolutions     jsonb default '[]'::jsonb,
  p_idempotency_key text  default null,
  p_device_id       text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_series_0066$
declare
  v_uid         uuid := auth.uid();
  v_resolutions jsonb := coalesce(p_resolutions, '[]'::jsonb);
  v_existing    reservation_series%rowtype;
  v_series      reservation_series%rowtype;
  v_r           jsonb;
  v_action      text;
  v_target      uuid;
  v_court       uuid;
  v_courts      uuid[];
  v_occ         record;
  v_res         jsonb;
  v_key         text;
  v_created     uuid[] := '{}'::uuid[];
  v_skipped     date[] := '{}'::date[];
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Idempotent replay, scoped to the staff member who created it (0048/H3).
  if p_idempotency_key is not null then
    select * into v_existing from reservation_series where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.created_by_staff_id is distinct from v_uid then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another series';
      end if;
      select coalesce(array_agg(r.id order by r.start_at, r.id), '{}'::uuid[]) into v_created
        from reservations r
       where r.series_id = v_existing.id;
      select coalesce(array_agg(o.occ_date order by o.occ_date), '{}'::date[]) into v_skipped
        from app.series_occurrences(v_existing.pattern, v_existing.weekdays, v_existing.start_time,
                                    v_existing.duration_min, v_existing.starts_on, v_existing.ends_on) o
       where not exists (select 1 from reservations r
                          where r.idempotency_key = p_idempotency_key || ':' || o.occ_date::text);
      return jsonb_build_object('duplicate', true, 'seriesId', v_existing.id,
        'created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
    end if;
  end if;

  if not exists (select 1 from courts where id = p_court_id and is_active) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_guest_id is null and coalesce(btrim(p_guest_name), '') = '' then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001',
      hint = 'a series needs guest_id or guest_name';
  end if;
  if p_guest_id is not null and not exists (select 1 from profiles where id = p_guest_id) then
    raise exception 'GUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Resolutions: shape-checked in full before anything is locked or written.
  if jsonb_typeof(v_resolutions) <> 'array' then
    raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
      hint = 'p_resolutions: [{date, action: skip | moveCourt, courtId}]';
  end if;
  for v_r in select * from jsonb_array_elements(v_resolutions) loop
    v_action := v_r ->> 'action';
    if jsonb_typeof(v_r) <> 'object' or v_action is null or v_action not in ('skip', 'moveCourt') then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'action: skip | moveCourt';
    end if;
    begin
      perform (v_r ->> 'date')::date;
    exception when others then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'date: YYYY-MM-DD';
    end;
    if v_r ->> 'date' is null then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'date: YYYY-MM-DD';
    end if;
    if v_action = 'moveCourt' then
      begin
        v_target := (v_r ->> 'courtId')::uuid;
      exception when others then
        v_target := null;
      end;
      if v_target is null or not exists (select 1 from courts where id = v_target and is_active) then
        raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
          detail = v_r::text, hint = 'moveCourt needs the id of an active court';
      end if;
    end if;
  end loop;

  -- Validate the pattern (INVALID_PATTERN / INVALID_WEEKDAYS / INVALID_RANGE /
  -- SERIES_EMPTY / SERIES_TOO_LONG) before the series row and before any lock.
  perform app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                 p_starts_on, p_ends_on);

  -- SERIALIZE (0042): every court this series may write to, ascending, first.
  select array_agg(s.c order by s.c) into v_courts
    from (select p_court_id as c
          union
          select (r ->> 'courtId')::uuid
            from jsonb_array_elements(v_resolutions) r
           where r ->> 'action' = 'moveCourt') s;
  foreach v_court in array v_courts loop
    perform app.lock_court(v_court);
  end loop;

  -- The series row goes in FIRST so a concurrent replay of the same key queues
  -- on the unique index and then reads this series back instead of writing a
  -- second one.
  begin
    insert into reservation_series
      (court_id, pattern, weekdays, start_time, duration_min, starts_on, ends_on,
       guest_id, guest_name, guest_phone, notes, created_by_staff_id, idempotency_key)
    values
      (p_court_id, p_pattern, coalesce(p_weekdays, '{}'::int[]), p_start_time, p_duration_min,
       p_starts_on, p_ends_on, p_guest_id, nullif(btrim(p_guest_name), ''),
       nullif(btrim(p_guest_phone), ''), p_notes, v_uid, p_idempotency_key)
    returning * into v_series;
  exception
    when unique_violation then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'a series with this key was created concurrently - replay the call';
  end;

  for v_occ in
    select o.occ_date, o.start_at, o.end_at,
           (select r from jsonb_array_elements(v_resolutions) r
             where (r ->> 'date')::date = o.occ_date
             limit 1) as res
      from app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                  p_starts_on, p_ends_on) o
     order by o.occ_date
  loop
    v_action := v_occ.res ->> 'action';
    if v_action = 'skip' then
      v_skipped := v_skipped || v_occ.occ_date;
      continue;
    end if;
    v_target := case when v_action = 'moveCourt' then (v_occ.res ->> 'courtId')::uuid
                     else p_court_id end;
    v_key := case when p_idempotency_key is null then null
                  else p_idempotency_key || ':' || v_occ.occ_date::text end;

    -- THE insert path. Its refusals are this series' unresolved conflicts; any
    -- other error is a real fault and propagates unchanged.
    begin
      v_res := app.staff_create_reservation(
        p_court_id           => v_target,
        p_kind               => 'booking',
        p_start_at           => v_occ.start_at,
        p_end_at             => v_occ.end_at,
        p_guest_name         => v_series.guest_name,
        p_guest_phone        => v_series.guest_phone,
        p_guest_id           => v_series.guest_id,
        p_notes              => v_series.notes,
        p_idempotency_key    => v_key,
        p_client_ref         => null,
        p_device_id          => p_device_id,
        p_price_override_iqd => null);
    exception
      when raise_exception then
        if sqlerrm in ('SLOT_TAKEN', 'CLOSED_DATE', 'OUTSIDE_HOURS', 'NO_RATE') then
          raise exception 'SERIES_UNRESOLVED_CONFLICTS' using errcode = 'P0001',
            detail = v_occ.occ_date::text,
            hint = format('%s on %s - skip that date or move it to another court',
                          sqlerrm, v_occ.occ_date);
        end if;
        raise;
    end;

    -- A "duplicate" here means the per-occurrence key exists with no series
    -- behind it (a desk booking reused the key). Refuse rather than adopt it.
    if coalesce((v_res ->> 'duplicate')::boolean, false) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        detail = v_occ.occ_date::text,
        hint = 'an occurrence key already belongs to a reservation outside this series';
    end if;
    v_created := v_created || (v_res ->> 'reservation_id')::uuid;
  end loop;

  if coalesce(array_length(v_created, 1), 0) = 0 then
    raise exception 'SERIES_EMPTY' using errcode = 'P0001',
      hint = 'every occurrence was skipped';
  end if;

  update reservations
     set series_id = v_series.id
   where id = any (v_created);

  perform app.write_audit('series.create', 'reservation_series', v_series.id::text,
                          null,
                          to_jsonb(v_series)
                            || jsonb_build_object('created',     to_jsonb(v_created),
                                                  'skipped',     to_jsonb(v_skipped),
                                                  'resolutions', v_resolutions),
                          null, null, p_device_id);

  return jsonb_build_object('duplicate', false, 'seriesId', v_series.id,
    'created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
end $create_series_0066$;

revoke all on function app.create_series(uuid, text, int[], time, int, date, date, uuid, text, text, text, jsonb, text, text)
  from public, anon;
grant execute on function app.create_series(uuid, text, int[], time, int, date, date, uuid, text, text, text, jsonb, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.series_detail — staff (court_desk, cashier, manager, owner) or the
--    owning guest. A series the caller may not see reads as SERIES_NOT_FOUND.
--
-- {series:{...row, court_name_en, court_name_ar},
--  occurrences:[{id, court_id, court_name_en, court_name_ar, start_at, end_at,
--                status, kind, price_iqd, cancelled_at, cancellation_reason,
--                played}]}
-- ---------------------------------------------------------------------------
create or replace function app.series_detail(p_series_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $series_detail_0066$
declare
  v_uid    uuid := auth.uid();
  v_staff  boolean;
  v_series reservation_series%rowtype;
  v_court  courts%rowtype;
  v_occ    jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  v_staff := app.is_staff('court_desk','cashier','manager','owner');
  -- An anonymous cafe session is `authenticated` with no profile (0048/C1):
  -- it can own nothing here, so it is refused before any lookup.
  if not v_staff and not exists (select 1 from profiles where id = v_uid) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_series
    from reservation_series
   where id = p_series_id
     and (v_staff or guest_id = v_uid);
  if not found then
    raise exception 'SERIES_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_court from courts where id = v_series.court_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  r.id,
           'court_id',            r.court_id,
           'court_name_en',       c.name_en,
           'court_name_ar',       c.name_ar,
           'start_at',            r.start_at,
           'end_at',              r.end_at,
           'status',              r.status,
           'kind',                r.kind,
           'price_iqd',           r.price_iqd,
           'cancelled_at',        r.cancelled_at,
           'cancellation_reason', r.cancellation_reason,
           'played',              r.end_at < now()
         ) order by r.start_at, r.id), '[]'::jsonb)
    into v_occ
    from reservations r
    join courts c on c.id = r.court_id
   where r.series_id = v_series.id;

  return jsonb_build_object(
    'series', to_jsonb(v_series)
                || jsonb_build_object('court_name_en', v_court.name_en,
                                      'court_name_ar', v_court.name_ar),
    'occurrences', v_occ);
end $series_detail_0066$;

revoke all on function app.series_detail(uuid) from public, anon;
grant execute on function app.series_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.cancel_series — 'future' (start_at > now()) or 'all' (every
--    not-yet-played one). A row whose end_at < now() is NEVER touched, whatever
--    its status. Each row goes through app.cancel_reservation, so it gets the
--    same status transition, the same audit row and the same reason as a
--    single desk cancel. Returns {cancelled: uuid[], seriesCancelledAt}.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_series(
  p_series_id   uuid,
  p_scope       text,
  p_reason_code text
) returns jsonb
language plpgsql security definer set search_path = public as $cancel_series_0066$
declare
  v_series    reservation_series%rowtype;
  v_before    jsonb;
  v_id        uuid;
  v_cancelled uuid[] := '{}'::uuid[];
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason_code), '') = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_scope is null or p_scope not in ('future', 'all') then
    raise exception 'INVALID_SCOPE' using errcode = 'P0001',
      hint = 'scope: future | all';
  end if;

  select * into v_series from reservation_series where id = p_series_id for update;
  if not found then
    raise exception 'SERIES_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_series);

  -- Status-only writes by primary key (0042's exemption): nothing here moves a
  -- reservation in time or across courts, so no court lock is needed.
  for v_id in
    select r.id
      from reservations r
     where r.series_id = p_series_id
       and r.status in ('pending', 'confirmed')
       and r.end_at >= now()                          -- played rows are untouchable (spec 06.6)
       and (p_scope = 'all' or r.start_at > now())
     order by r.start_at, r.id
  loop
    perform app.cancel_reservation(v_id, p_reason_code);
    v_cancelled := v_cancelled || v_id;
  end loop;

  -- The plan itself is closed once nothing live is left ahead of it.
  if not exists (select 1
                   from reservations r
                  where r.series_id = p_series_id
                    and r.status in ('pending', 'confirmed', 'arrived')
                    and r.end_at > now()) then
    update reservation_series
       set cancelled_at     = coalesce(cancelled_at, now()),
           cancelled_reason = coalesce(cancelled_reason, p_reason_code)
     where id = p_series_id
     returning * into v_series;
  end if;

  perform app.write_audit('series.cancel', 'reservation_series', p_series_id::text,
                          v_before,
                          to_jsonb(v_series)
                            || jsonb_build_object('scope', p_scope,
                                                  'cancelled', to_jsonb(v_cancelled)),
                          p_reason_code);

  return jsonb_build_object('cancelled', to_jsonb(v_cancelled),
                            'seriesCancelledAt', v_series.cancelled_at);
end $cancel_series_0066$;

revoke all on function app.cancel_series(uuid, text, text) from public, anon;
grant execute on function app.cancel_series(uuid, text, text) to authenticated;
