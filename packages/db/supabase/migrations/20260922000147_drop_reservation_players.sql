-- ===========================================================================
-- 0147 — drop the group size ("players") from bookings and every reader.
--
-- WHAT
--   * reservations.players and reservation_series.players (0092) are dropped;
--     their CHECKs (reservations_players_range,
--     reservation_series_players_range) go with them.
--   * app.staff_create_reservation, app.create_series (latest 0092) and
--     app.confirm_booking (latest 0117) are re-issued VERBATIM minus the
--     players range check and the players write. create_series no longer
--     passes p_players => p_players to staff_create_reservation.
--   * app.analytics_courts_summary, _demand, _endings, _cafe (latest 0097) and
--     app.assistant_bookings_list (0109) are re-issued VERBATIM minus every
--     players-derived output key and every r.players select:
--       summary  per_court[].players_known, per_court[].players_avg
--       demand   players {known, unknown, avg, rows[]}, players_by_court[]
--       endings  no_shows.by_players[]
--       cafe     by_players[]
--       bookings_list  rows[].players
--   * The two app.assistant_readable_columns rows for the columns are deleted
--     (0109 seeded them from information_schema), so table_read and describe()
--     stop offering a column that no longer exists.
--   * The courts_findings built-in (0141) stops asking about players per
--     booking; its live cached answers are superseded so none that talk about
--     group size is served again.
--
-- WHY. Owner decision 2026-09-22: padel is always exactly four players, so a
-- recorded group size carries no information. The desk dialogs and the mobile
-- review screen stop asking in the same release.
--
-- COMPATIBILITY. The three write RPCs KEEP their signatures, trailing
-- `p_players int default null` included, and IGNORE it: a till or phone in
-- the field on an older build still sends p_players, and a dropped parameter
-- would turn every one of those calls into PGRST202 the moment this reaches
-- hosted. A later migration drops the parameter (drop by exact signature,
-- recreate, re-grant) once every till and app build is past this release.
-- Signatures unchanged, so every function here is `create or replace` with no
-- drop, and the revoke/grant lines are re-issued anyway.
--
-- Posture: `drop column` is a catalog-only change (no rewrite) under a brief
-- ACCESS EXCLUSIVE lock, bounded by lock_timeout; the functions that read the
-- columns are replaced first in the same transaction, so nothing that runs
-- after commit can name them. No view, policy or trigger references either
-- column (checked against pg_depend / pg_proc on the local stack).
--
-- covered by packages/db/tests/players.test.ts, tests/analytics-courts.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.staff_create_reservation — 0092 body verbatim minus the p_players
--    range check and the players column in the insert. Signature unchanged.
-- ---------------------------------------------------------------------------
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
language plpgsql security definer set search_path = public as $staff_0147$
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
end $staff_0147$;

revoke all on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint, int) from public, anon;
grant execute on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.create_series — 0092 body verbatim minus the p_players range check,
--    the players column in the series insert and the p_players => p_players
--    argument to staff_create_reservation. Signature unchanged.
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
  p_device_id       text  default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a till on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players         int   default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_series_0147$
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
end $create_series_0147$;

revoke all on function app.create_series(uuid, text, int[], time, int, date, date, uuid, text, text, text, jsonb, text, text, int)
  from public, anon;
grant execute on function app.create_series(uuid, text, int[], time, int, date, date, uuid, text, text, text, jsonb, text, text, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.confirm_booking — 0117 body verbatim minus the p_players range
--    check and the players line in the update. Signature unchanged; the
--    PRICE_CHANGED guard (0117) and the guard order are untouched.
-- ---------------------------------------------------------------------------
create or replace function app.confirm_booking(
  p_hold_id     uuid,
  p_guest_name  text default null,
  p_guest_phone text default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a phone on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players     int  default null
) returns jsonb
language plpgsql security definer set search_path = public as $confirm_booking_0147$
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

  -- DEGRADED GUARD (0021): guests cannot confirm inside the protected horizon
  -- while the venue trades offline; staff paths are unaffected.
  if not app.is_staff('court_desk','manager','owner') then
    perform app.assert_not_degraded_for(v.start_at);
  end if;

  -- 0059: spec 05.3 makes the phone a required PROFILE field and the desk
  -- relies on it to reach a guest about their booking. Enforced only in the app
  -- until now; a social sign-in creates a phone-less profile, so the write path
  -- refuses too. Staff paths pass p_guest_phone and are exempt.
  if not app.is_staff('court_desk','manager','owner')
     and not exists (select 1 from profiles
                      where id = v_uid and nullif(btrim(phone), '') is not null) then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
      hint = 'add a phone number to your profile before confirming';
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

  -- 0117 (C5): quote = charge. The hold carries the price the guest was shown
  -- (stamped by hold_slot since 0117). If the rate rules moved underneath the
  -- hold, refuse rather than charge an amount nobody agreed to; the app shows
  -- the new price and asks again. A hold from before 0117 has no stamp and
  -- keeps the old behaviour. Staff paths are exempt: the desk sees the current
  -- price on screen as it confirms.
  if v.price_iqd is not null and v.price_iqd <> v_price
     and not app.is_staff('court_desk','manager','owner') then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001',
      detail = jsonb_build_object('quoted_iqd', v.price_iqd, 'current_iqd', v_price,
                                  'rate_rule_id', v_rule)::text,
      hint = 'the price of this slot changed after it was held; hold it again to see the new price';
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
end $confirm_booking_0147$;

revoke all on function app.confirm_booking(uuid, text, text, int) from public, anon;
grant execute on function app.confirm_booking(uuid, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.analytics_courts_summary — 0097 body verbatim minus r.players and
--    per_court[].players_known / players_avg.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_summary_0147$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           r.start_at at time zone v_b.tz                                            as s_local,
           r.end_at at time zone v_b.tz                                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)                     as d,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status in ('confirmed','arrived','completed')                           as live,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  holds as (
    select extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.kind = 'hold' and r.status = 'expired' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, o.dow, o.hour, o.open_minutes, o.open_days
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id),
  court_open as (
    select oc.court_id, sum(oc.open_minutes)::bigint as open_minutes from oc group by oc.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(co.open_minutes, 0)::bigint                           as open_minutes,
           count(b.id) filter (where b.live)                              as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint         as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint    as revenue_iqd,
           count(b.id) filter (where b.cancelled)                         as cancellations,
           count(b.id) filter (where b.no_show)                           as no_shows,
           count(b.id) filter (where b.live and b.source = 'mobile')      as mobile_bookings,
           count(b.id) filter (where b.live and b.source = 'desk')        as desk_bookings,
           avg(b.mins) filter (where b.live)                              as avg_duration_min
      from courts_in c
      left join court_open co on co.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, co.open_minutes),
  tot as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           coalesce(sum(pc.open_minutes), 0)::bigint       as open_minutes
      from per_court pc),
  days as (
    select gs::date as d
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs),
  by_day as (
    select d.d,
           coalesce((select case when jsonb_typeof(vs.opening_hours -> lower(to_char(d.d, 'Dy'))) = 'array'
                                  then jsonb_array_length(vs.opening_hours -> lower(to_char(d.d, 'Dy')))
                                  else 0 end = 0
                            or d.d = any (coalesce(vs.closed_dates, '{}'))
                       from venue_settings vs limit 1), true)         as closed,
           count(b.id) filter (where b.live)                           as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint      as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as revenue_iqd,
           count(b.id) filter (where b.cancelled)                      as cancellations,
           count(b.id) filter (where b.no_show)                        as no_shows
      from days d
      left join b on b.d = d.d
     group by d.d),
  split as (
    select extract(dow from (gs - make_interval(hours => v_b.start_hour))::date)::int as dow,
           extract(hour from gs)::int                                                 as hour,
           sum(extract(epoch from (least(b.e_local, gs + interval '1 hour') - greatest(b.s_local, gs))) / 60) as booked_minutes
      from b
      cross join lateral generate_series(date_trunc('hour', b.s_local), b.e_local, interval '1 hour') gs
     where b.live and gs < b.e_local
     group by 1, 2),
  starts as (
    select b.dow, b.hour,
           count(*) filter (where b.live)                               as bookings,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint  as revenue_iqd,
           count(*) filter (where b.cancelled)                          as cancellations,
           count(*) filter (where b.no_show)                            as no_shows
      from b
     group by b.dow, b.hour),
  hold_cells as (
    select h.dow, h.hour, count(*) as holds_expired from holds h group by h.dow, h.hour),
  open_cells as (
    -- VENUE-WIDE: every court in courts_in, summed per cell.
    select oc.dow, oc.hour, sum(oc.open_minutes)::bigint as open_minutes, max(oc.open_days)::int as open_days
      from oc
     group by oc.dow, oc.hour),
  keys as (
    select oc.dow, oc.hour from open_cells oc
    union select sp.dow, sp.hour from split sp
    union select st.dow, st.hour from starts st
    union select hc.dow, hc.hour from hold_cells hc),
  heat as (
    select k.dow, k.hour,
           coalesce(oc.open_minutes, 0)::bigint            as open_minutes,
           coalesce(oc.open_days, 0)                       as open_days,
           coalesce(round(sp.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(st.bookings, 0)                        as bookings,
           coalesce(st.revenue_iqd, 0)                     as revenue_iqd,
           coalesce(st.cancellations, 0)                   as cancellations,
           coalesce(st.no_shows, 0)                        as no_shows,
           coalesce(hc.holds_expired, 0)                   as holds_expired
      from keys k
      left join open_cells oc on oc.dow = k.dow and oc.hour = k.hour
      left join split sp      on sp.dow = k.dow and sp.hour = k.hour
      left join starts st     on st.dow = k.dow and st.hour = k.hour
      left join hold_cells hc on hc.dow = k.dow and hc.hour = k.hour)
  select jsonb_build_object(
    'range',        jsonb_build_object('from', p_from, 'to', p_to),
    'courts_count', t.courts_count,
    'open_minutes', t.open_minutes,
    'kpis', jsonb_build_object(
      'bookings',                  t.bookings,
      'booked_minutes',            t.booked_minutes,
      'occupancy_pct',             case when t.open_minutes > 0 then round(t.booked_minutes * 100.0 / t.open_minutes, 1) end,
      'revenue_iqd',               t.revenue_iqd,
      'rev_per_open_hour_iqd',     case when t.open_minutes > 0 then round(t.revenue_iqd * 60.0 / t.open_minutes)::bigint end,
      'price_per_booked_hour_iqd', case when t.booked_minutes > 0 then round(t.revenue_iqd * 60.0 / t.booked_minutes)::bigint end,
      'cancellations',             t.cancellations,
      'no_shows',                  t.no_shows,
      'booked_total',              t.bookings + t.cancellations + t.no_shows,
      'cancellation_rate_pct',     case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.cancellations * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'no_show_rate_pct',          case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.no_shows * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'mobile_bookings',           t.mobile_bookings,
      'desk_bookings',             t.desk_bookings,
      'holds_expired',             (select count(*) from holds),
      'booking_days',              (select count(distinct b.d) from b where b.live)),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',              pc.id,
               'name_en',               pc.name_en,
               'name_ar',               pc.name_ar,
               'is_active',             pc.is_active,
               'bookings',              pc.bookings,
               'booked_minutes',        pc.booked_minutes,
               'open_minutes',          pc.open_minutes,
               'occupancy_pct',         case when pc.open_minutes > 0 then round(pc.booked_minutes * 100.0 / pc.open_minutes, 1) end,
               'revenue_iqd',           pc.revenue_iqd,
               'rev_per_open_hour_iqd', case when pc.open_minutes > 0 then round(pc.revenue_iqd * 60.0 / pc.open_minutes)::bigint end,
               'cancellations',         pc.cancellations,
               'no_shows',              pc.no_shows,
               'booked_total',          pc.bookings + pc.cancellations + pc.no_shows,
               'cancellation_rate_pct', case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'no_show_rate_pct',      case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'mobile_bookings',       pc.mobile_bookings,
               'desk_bookings',         pc.desk_bookings,
               'avg_duration_min',      round(pc.avg_duration_min, 1)
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'business_date',  x.d,
               'closed',         x.closed,
               'bookings',       x.bookings,
               'booked_minutes', x.booked_minutes,
               'revenue_iqd',    x.revenue_iqd,
               'cancellations',  x.cancellations,
               'no_shows',       x.no_shows
             ) order by x.d), '[]'::jsonb)
        from by_day x),
    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',            h.dow,
               'hour',           h.hour,
               'open_minutes',   h.open_minutes,
               'open_days',      h.open_days,
               'booked_minutes', h.booked_minutes,
               'bookings',       h.bookings,
               'revenue_iqd',    h.revenue_iqd,
               'cancellations',  h.cancellations,
               'no_shows',       h.no_shows,
               'holds_expired',  h.holds_expired
             ) order by h.dow, h.hour), '[]'::jsonb)
        from heat h))
    into v_out
    from tot t;

  return v_out;
end $fn_analytics_courts_summary_0147$;

revoke all on function app.analytics_courts_summary(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_summary(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.analytics_courts_demand — 0097 body verbatim minus r.players, the
--    players {known, unknown, avg, rows} object and players_by_court.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_demand(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_demand_0147$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.series_id,
           coalesce(r.price_iqd, 0)::bigint                                              as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                       as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                          as lead_min,
           extract(hour from (r.created_at at time zone v_b.tz))::int                    as c_hour,
           extract(dow from app.business_date(r.created_at, v_b.tz, v_b.start_hour))::int as c_dow,
           r.status in ('confirmed','arrived','completed')                               as live,
           r.status = 'cancelled'                                                        as cancelled,
           r.status = 'no_show'                                                          as no_show
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  -- lead time and creation clock: live, single (non-series) bookings only
  lb as (
    select b.*,
           case when b.lead_min < 120   then 'lt2h'
                when b.lead_min < 360   then '2_6h'
                when b.lead_min < 1440  then '6_24h'
                when b.lead_min < 4320  then '1_3d'
                when b.lead_min < 10080 then '3_7d'
                else '7d_plus' end as lead_bucket
      from b
     where b.live and b.series_id is null),
  lead_keys as (
    select k.bucket, k.ord
      from (values ('lt2h', 1), ('2_6h', 2), ('6_24h', 3), ('1_3d', 4), ('3_7d', 5), ('7d_plus', 6)) k(bucket, ord)),
  src_keys as (
    select s.source from (values ('mobile'), ('desk')) s(source)),
  holds as (
    select count(*) filter (where r.status = 'expired')  as expired,
           count(*) filter (where r.status = 'pending')  as pending
      from reservations r
     where r.kind = 'hold' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  converted as (
    select count(*) as n from b where b.source = 'mobile')
  select jsonb_build_object(
    'durations', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'duration_min',         x.mins,
               'bookings',             x.n,
               'booked_minutes',       x.bm,
               'revenue_iqd',          x.rev,
               'revenue_per_hour_iqd', case when x.bm > 0 then round(x.rev * 60.0 / x.bm)::bigint end
             ) order by x.mins), '[]'::jsonb)
        from (select b.mins, count(*) as n, sum(b.mins)::bigint as bm, sum(b.price_iqd)::bigint as rev
                from b where b.live group by b.mins) x),
    'lead_time', jsonb_build_object(
      'median_min', (select round(percentile_cont(0.5) within group (order by lb.lead_min::double precision))::int from lb),
      'buckets', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',   k.bucket,
                 'bookings', coalesce(x.n, 0),
                 'mobile',   coalesce(x.m, 0),
                 'desk',     coalesce(x.d, 0)
               ) order by k.ord)
          from lead_keys k
          left join (select lb.lead_bucket, count(*) as n,
                            count(*) filter (where lb.source = 'mobile') as m,
                            count(*) filter (where lb.source = 'desk')   as d
                       from lb group by lb.lead_bucket) x on x.lead_bucket = k.bucket)),
    'created_hour', (
      select jsonb_agg(jsonb_build_object('hour', gs, 'bookings', (select count(*) from lb where lb.c_hour = gs)) order by gs)
        from generate_series(0, 23) gs),
    'created_dow', (
      select jsonb_agg(jsonb_build_object('dow', gs, 'bookings', (select count(*) from lb where lb.c_dow = gs)) order by gs)
        from generate_series(0, 6) gs),
    'sources', (
      select jsonb_agg(jsonb_build_object(
               'source',           s.source,
               'bookings',         coalesce(x.n, 0),
               'revenue_iqd',      coalesce(x.rev, 0),
               'cancellations',    coalesce(x.canc, 0),
               'no_shows',         coalesce(x.ns, 0),
               'avg_duration_min', x.avg_dur
             ) order by s.source)
        from src_keys s
        left join (select b.source,
                          count(*) filter (where b.live)                              as n,
                          coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as rev,
                          count(*) filter (where b.cancelled)                         as canc,
                          count(*) filter (where b.no_show)                           as ns,
                          round(avg(b.mins) filter (where b.live), 1)                 as avg_dur
                     from b group by b.source) x on x.source = s.source),
    'hold_funnel', jsonb_build_object(
      'holds_ended',    h.expired + c.n,
      'converted',      c.n,
      'pending',        h.pending,
      'conversion_pct', case when h.expired + c.n > 0 then round(c.n * 100.0 / (h.expired + c.n), 1) end),
    'series', (
      select jsonb_build_object(
               'series_bookings',    count(*) filter (where b.series_id is not null),
               'single_bookings',    count(*) filter (where b.series_id is null),
               'series_pct',         case when count(*) > 0
                                          then round(count(*) filter (where b.series_id is not null) * 100.0 / count(*), 1) end,
               'series_revenue_iqd', coalesce(sum(b.price_iqd) filter (where b.series_id is not null), 0)::bigint)
        from b where b.live))
    into v_out
    from holds h, converted c;

  return v_out;
end $fn_analytics_courts_demand_0147$;

revoke all on function app.analytics_courts_demand(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_demand(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.analytics_courts_endings — 0097 body verbatim minus r.players, the
--    'players' segment dimension and no_shows.by_players.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_endings(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_endings_0147$
declare
  v_b          record;
  v_policy_min int;
  v_out        jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_policy_min := coalesce((select vs.cancellation_window_hours from venue_settings vs limit 1), 12) * 60;

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.series_id, r.start_at, r.end_at, r.cancelled_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                      as lead_min,
           extract(epoch from (r.start_at - r.cancelled_at)) / 60                    as notice_min,
           coalesce(r.cancelled_by::text, 'unknown')                                 as actor,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show,
           app.analytics_guest_ident(r.guest_id, r.guest_phone)                     as ident
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as (
    select app.analytics_guest_ident(r.guest_id, r.guest_phone) as ident,
           r.start_at
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  bounds as (
    select distinct v from unnest(array[0, 120, 360, 1440, 4320, v_policy_min]) as v),
  edges as (
    select v as lo, lead(v) over (order by v) as hi, row_number() over (order by v) as ord
      from bounds),
  notice_keys as (
    select null::int as lo, 0 as hi, 0::bigint as ord, 'after_start'::text as bucket, false as policy_edge
    union all
    select e.lo, e.hi, e.ord,
           case when e.hi is null then e.lo::text || '_plus' else e.lo::text || '_' || e.hi::text end,
           e.lo = v_policy_min
      from edges e),
  typed as (
    select b.*,
           case when b.ident is null then 'unidentified'
                when exists (select 1 from hist h where h.ident = b.ident and h.start_at < b.start_at) then 'returning'
                else 'new' end as typ,
           case when b.series_id is not null then null
                when b.lead_min < 120   then 'lt2h'
                when b.lead_min < 360   then '2_6h'
                when b.lead_min < 1440  then '6_24h'
                when b.lead_min < 4320  then '1_3d'
                when b.lead_min < 10080 then '3_7d'
                else '7d_plus' end as lead_bucket,
           case when b.notice_min is null then null
                when b.notice_min < 0    then 'after_start'
                else (select k.bucket from notice_keys k
                       where k.lo is not null and b.notice_min >= k.lo and (k.hi is null or b.notice_min < k.hi)
                       limit 1) end as notice_bucket
      from b),
  segs as (
    select t.id, t.cancelled, t.no_show, x.dim, x.key, x.ord
      from typed t
      cross join lateral (values
        ('hour',      t.hour::text,                                                   t.hour),
        ('dow',       t.dow::text,                                                    t.dow),
        ('court',     t.court_id::text,                                               0),
        ('source',    t.source,                                                       0),
        ('duration',  t.mins::text,                                                   t.mins),
        ('lead_time', t.lead_bucket,                                                  case t.lead_bucket
                                                                                        when 'lt2h' then 1 when '2_6h' then 2 when '6_24h' then 3
                                                                                        when '1_3d' then 4 when '3_7d' then 5 else 6 end),
        ('series',    case when t.series_id is null then 'single' else 'series' end,  0),
        ('type',      t.typ,                                                          case t.typ when 'returning' then 1 when 'new' then 2 else 3 end)
      ) x(dim, key, ord)
     where x.key is not null),
  agg as (
    select s.dim, s.key, min(s.ord) as ord,
           count(*) filter (where s.cancelled) as canc,
           count(*) filter (where s.no_show)   as ns,
           count(*)                            as total
      from segs s
     group by s.dim, s.key),
  rows_c as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.canc, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  rows_n as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.ns, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  actor_keys as (
    select k.actor, k.ord
      from (values ('guest', 1), ('staff', 2), ('unknown', 3)) k(actor, ord)),
  -- Late cancellations and what became of the slot.
  late as (
    select t.id, t.court_id, t.start_at, t.end_at, t.cancelled_at, t.price_iqd
      from typed t
     where t.cancelled and t.notice_min is not null and t.notice_min < v_policy_min),
  resold as (
    select lc.id, lc.price_iqd,
           (select r2.price_iqd
              from reservations r2
             where r2.court_id = lc.court_id
               and r2.kind = 'booking'
               and r2.status in ('confirmed','arrived','completed')
               and r2.id <> lc.id
               and r2.created_at > lc.cancelled_at
               and r2.start_at < lc.end_at and r2.end_at > lc.start_at
             order by r2.created_at, r2.id
             limit 1) as replacement_iqd
      from late lc),
  in_period as (
    select count(*) as n, coalesce(sum(r.price_iqd), 0)::bigint as revenue_iqd
      from reservations r
     where r.kind = 'booking'
       and r.status = 'cancelled'
       and r.cancelled_at >= v_b.ts_from and r.cancelled_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id))
  select jsonb_build_object(
    'policy_window_min', v_policy_min,
    'cancellations', jsonb_build_object(
      'total',             (select count(*) from b where b.cancelled),
      'revenue_iqd',       (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.cancelled),
      'late_revenue_iqd',  (select coalesce(sum(lc.price_iqd), 0)::bigint from late lc),
      'median_notice_min', (select round(percentile_cont(0.5) within group (order by b.notice_min::double precision))::int
                              from b where b.cancelled and b.notice_min is not null),
      'by_notice', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'lo_min',      k.lo,
                 'hi_min',      k.hi,
                 'n',           coalesce(x.n, 0),
                 'policy_edge', k.policy_edge
               ) order by k.ord)
          from notice_keys k
          left join (select t.notice_bucket, count(*) as n from typed t where t.cancelled group by t.notice_bucket) x
                 on x.notice_bucket = k.bucket),
      'by_actor', (
        select jsonb_agg(jsonb_build_object('actor', k.actor, 'n', coalesce(x.n, 0)) order by k.ord)
          from actor_keys k
          left join (select b.actor, count(*) as n from b where b.cancelled group by b.actor) x on x.actor = k.actor),
      'cancelled_in_period', (select jsonb_build_object('n', ip.n, 'revenue_iqd', ip.revenue_iqd) from in_period ip),
      'resold', (
        select jsonb_build_object(
                 'cancelled',     count(*),
                 'resold_n',      count(*) filter (where rs.replacement_iqd is not null),
                 'recovered_iqd', coalesce(sum(rs.replacement_iqd), 0)::bigint,
                 'empty_n',       count(*) filter (where rs.replacement_iqd is null),
                 'lost_iqd',      coalesce(sum(rs.price_iqd) filter (where rs.replacement_iqd is null), 0)::bigint)
          from resold rs),
      'by_hour',      coalesce((select rc.rows from rows_c rc where rc.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rc.rows from rows_c rc where rc.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rc.rows from rows_c rc where rc.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rc.rows from rows_c rc where rc.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rc.rows from rows_c rc where rc.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rc.rows from rows_c rc where rc.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rc.rows from rows_c rc where rc.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rc.rows from rows_c rc where rc.dim = 'type'),      '[]'::jsonb)),
    'no_shows', jsonb_build_object(
      'total',        (select count(*) from b where b.no_show),
      'revenue_iqd',  (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.no_show),
      'by_hour',      coalesce((select rn.rows from rows_n rn where rn.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rn.rows from rows_n rn where rn.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rn.rows from rows_n rn where rn.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rn.rows from rows_n rn where rn.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rn.rows from rows_n rn where rn.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rn.rows from rows_n rn where rn.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rn.rows from rows_n rn where rn.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rn.rows from rows_n rn where rn.dim = 'type'),      '[]'::jsonb)))
    into v_out;

  return v_out;
end $fn_analytics_courts_endings_0147$;

revoke all on function app.analytics_courts_endings(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_endings(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.analytics_courts_cafe — 0097 body verbatim minus r.players and
--    by_players.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_courts_cafe(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_courts_cafe_0147$
declare
  v_b     record;
  v_ex    uuid[];
  v_out   jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_ex    := app.analytics_excluded();

  with
  b as (
    select r.id, r.court_id, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order
      from courts c
     where (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  lt as (
    select t.id as tab_id, t.reservation_id, t.status
      from tabs t
      join b on b.id = t.reservation_id
     where t.status <> 'void' and t.merged_into_tab_id is null),
  lm as (
    select s.tab_id, s.reservation_id, s.cafe_gross_iqd, s.refunds_iqd, s.cafe_net_iqd
      from app.cafe_settled_tabs(null, null) s
      join b on b.id = s.reservation_id),
  per_b as (
    select b.*,
           exists (select 1 from lt where lt.reservation_id = b.id)                                   as linked,
           exists (select 1 from lm where lm.reservation_id = b.id)                                   as settled,
           (select coalesce(sum(lm.cafe_net_iqd), 0)   from lm where lm.reservation_id = b.id)::bigint as cafe_iqd,
           (select coalesce(sum(lm.cafe_gross_iqd), 0) from lm where lm.reservation_id = b.id)::bigint as cafe_gross_iqd,
           (select coalesce(sum(lm.refunds_iqd), 0)    from lm where lm.reservation_id = b.id)::bigint as refunds_iqd
      from b),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order,
           coalesce(oc.open_minutes, 0)::bigint          as open_minutes,
           count(p.id)                                   as live_bookings,
           count(p.id) filter (where p.linked)           as linked_bookings,
           count(p.id) filter (where p.settled)          as settled_linked,
           coalesce(sum(p.cafe_iqd), 0)::bigint          as cafe_iqd,
           coalesce(sum(p.cafe_gross_iqd), 0)::bigint    as cafe_gross_iqd,
           coalesce(sum(p.refunds_iqd), 0)::bigint       as refunds_iqd,
           coalesce(sum(p.price_iqd), 0)::bigint         as court_iqd,
           coalesce(sum(p.mins), 0)::bigint              as booked_minutes
      from courts_in c
      left join oc on oc.court_id = c.id
      left join per_b p on p.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, oc.open_minutes),
  tot as (
    select coalesce(sum(pc.live_bookings), 0)::bigint    as live_bookings,
           coalesce(sum(pc.linked_bookings), 0)::bigint  as linked_bookings,
           coalesce(sum(pc.settled_linked), 0)::bigint   as settled_linked,
           coalesce(sum(pc.cafe_iqd), 0)::bigint         as cafe_iqd,
           coalesce(sum(pc.cafe_gross_iqd), 0)::bigint   as cafe_gross_iqd,
           coalesce(sum(pc.refunds_iqd), 0)::bigint      as refunds_iqd,
           coalesce(sum(pc.court_iqd), 0)::bigint        as court_iqd,
           coalesce(sum(pc.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(sum(pc.open_minutes), 0)::bigint     as open_minutes
      from per_court pc),
  nl as (
    select * from app.cafe_net_lines((select coalesce(array_agg(lt.tab_id), '{}'::uuid[]) from lt))),
  lo as (
    select o.id as order_id, o.placed_at, p.court_id, p.start_at, p.end_at
      from orders o
      join lt on lt.tab_id = o.tab_id
      join per_b p on p.id = lt.reservation_id
     where o.status <> 'voided'),
  li as (
    select lo.court_id, lo.order_id, nl.menu_item_id,
           (nl.qty - nl.refund_qty) as qty, nl.net_iqd
      from nl
      join lo on lo.order_id = nl.order_id
     where nl.menu_item_id <> all (v_ex)),
  ao as (
    select o.id as order_id
      from orders o
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'),
  ai as (
    select oi.menu_item_id, oi.order_id
      from order_items oi
      join ao on ao.order_id = oi.order_id
     where not oi.voided and oi.menu_item_id <> all (v_ex)),
  top_items as (
    select x.*, row_number() over (partition by x.court_id order by x.qty desc, x.revenue_iqd desc, x.item_id) as rn
      from (select li.court_id, li.menu_item_id as item_id,
                   sum(li.qty)::bigint             as qty,
                   sum(li.net_iqd)::bigint         as revenue_iqd,
                   count(distinct li.order_id)     as linked_orders
              from li group by li.court_id, li.menu_item_id) x),
  items as (
    select coalesce(l.item_id, a.item_id) as item_id, coalesce(l.n, 0) as linked_n, coalesce(a.n, 0) as all_n
      from (select li.menu_item_id as item_id, count(distinct li.order_id) as n from li group by li.menu_item_id) l
      full join (select ai.menu_item_id as item_id, count(distinct ai.order_id) as n from ai group by ai.menu_item_id) a
             on a.item_id = l.item_id),
  timing as (
    select lo.order_id,
           extract(epoch from (lo.placed_at - lo.start_at)) / 60 as offset_min,
           case when lo.placed_at < lo.start_at - interval '30 minutes'            then 'before_30plus'
                when lo.placed_at < lo.start_at                                    then 'before_0_30'
                when lo.placed_at < lo.start_at + (lo.end_at - lo.start_at) / 2    then 'first_half'
                when lo.placed_at < lo.end_at                                      then 'second_half'
                when lo.placed_at < lo.end_at + interval '30 minutes'              then 'after_0_30'
                else 'after_30plus' end as bucket,
           (select coalesce(sum(nl.net_iqd), 0) from nl where nl.order_id = lo.order_id)::bigint as revenue_iqd
      from lo),
  timing_keys as (
    select k.bucket, k.ord
      from (values ('before_30plus', 1), ('before_0_30', 2), ('first_half', 3),
                   ('second_half', 4), ('after_0_30', 5), ('after_30plus', 6)) k(bucket, ord))
  select jsonb_build_object(
    'attach', jsonb_build_object(
      'live_bookings',                t.live_bookings,
      'linked_bookings',              t.linked_bookings,
      'attach_pct',                   case when t.live_bookings > 0 then round(t.linked_bookings * 100.0 / t.live_bookings, 1) end,
      'settled_linked',               t.settled_linked,
      'cafe_iqd',                     t.cafe_iqd,
      'cafe_gross_iqd',               t.cafe_gross_iqd,
      'refunds_iqd',                  t.refunds_iqd,
      'cafe_per_linked_iqd',          case when t.settled_linked > 0 then round(t.cafe_iqd * 1.0 / t.settled_linked)::bigint end,
      'cafe_per_booking_iqd',         case when t.live_bookings > 0 then round(t.cafe_iqd * 1.0 / t.live_bookings)::bigint end,
      'court_iqd',                    t.court_iqd,
      'booked_minutes',               t.booked_minutes,
      'open_minutes',                 t.open_minutes,
      'combined_per_booked_hour_iqd', case when t.booked_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.booked_minutes)::bigint end,
      'combined_per_open_hour_iqd',   case when t.open_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.open_minutes)::bigint end),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                     pc.id,
               'name_en',                      pc.name_en,
               'name_ar',                      pc.name_ar,
               'live_bookings',                pc.live_bookings,
               'linked_bookings',              pc.linked_bookings,
               'attach_pct',                   case when pc.live_bookings > 0 then round(pc.linked_bookings * 100.0 / pc.live_bookings, 1) end,
               'settled_linked',               pc.settled_linked,
               'cafe_iqd',                     pc.cafe_iqd,
               'cafe_gross_iqd',               pc.cafe_gross_iqd,
               'refunds_iqd',                  pc.refunds_iqd,
               'cafe_per_linked_iqd',          case when pc.settled_linked > 0 then round(pc.cafe_iqd * 1.0 / pc.settled_linked)::bigint end,
               'cafe_per_booking_iqd',         case when pc.live_bookings > 0 then round(pc.cafe_iqd * 1.0 / pc.live_bookings)::bigint end,
               'court_iqd',                    pc.court_iqd,
               'booked_minutes',               pc.booked_minutes,
               'open_minutes',                 pc.open_minutes,
               'combined_per_booked_hour_iqd', case when pc.booked_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.booked_minutes)::bigint end,
               'combined_per_open_hour_iqd',   case when pc.open_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.open_minutes)::bigint end
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                ti.court_id,
               'item_id',                 ti.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'qty',                     ti.qty,
               'revenue_iqd',             ti.revenue_iqd,
               'linked_orders_with_item', ti.linked_orders
             ) order by ti.court_id, ti.rn), '[]'::jsonb)
        from top_items ti
        join menu_items mi on mi.id = ti.item_id
       where ti.rn <= 5),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'item_id',                 i.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'linked_orders_with_item', i.linked_n,
               'all_orders_with_item',    i.all_n
             ) order by i.linked_n desc, i.all_n desc, mi.name_en, i.item_id), '[]'::jsonb)
        from items i
        join menu_items mi on mi.id = i.item_id),
    'linked_orders_total', (select count(*) from lo),
    'all_orders_total',    (select count(*) from ao),
    'order_timing', jsonb_build_object(
      'median_offset_min', (select round(percentile_cont(0.5) within group (order by tm.offset_min::double precision))::int from timing tm),
      'buckets', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'orders',      coalesce(x.n, 0),
                 'revenue_iqd', coalesce(x.rev, 0)
               ) order by k.ord)
          from timing_keys k
          left join (select tm.bucket, count(*) as n, sum(tm.revenue_iqd)::bigint as rev from timing tm group by tm.bucket) x
                 on x.bucket = k.bucket)),
    'attach_cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',             x.dow,
               'hour',            x.hour,
               'live_bookings',   x.n,
               'linked_bookings', x.linked
             ) order by x.dow, x.hour), '[]'::jsonb)
        from (select p.dow, p.hour, count(*) as n, count(*) filter (where p.linked) as linked
                from per_b p group by p.dow, p.hour) x),
    'by_duration', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'duration_min', x.mins,
               'bookings',     x.n,
               'linked',       x.linked,
               'cafe_iqd',     x.cafe_iqd
             ) order by x.mins), '[]'::jsonb)
        from (select p.mins, count(*) as n, count(*) filter (where p.linked) as linked,
                     coalesce(sum(p.cafe_iqd), 0)::bigint as cafe_iqd
                from per_b p group by p.mins) x))
    into v_out
    from tot t;

  return v_out;
end $fn_analytics_courts_cafe_0147$;

revoke all on function app.analytics_courts_cafe(date, date, uuid) from public, anon;
grant execute on function app.analytics_courts_cafe(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.assistant_bookings_list — 0109 body verbatim minus rows[].players.
--    Same comment, same revoke (reached only through app.assistant_run_tool).
-- ---------------------------------------------------------------------------
create or replace function app.assistant_bookings_list(
  p_from        date,
  p_to          date,
  p_court_id    uuid    default null,
  p_status      text    default null,
  p_customer_id uuid    default null,
  p_limit       int     default 50,
  p_offset      int     default 0,
  p_count_only  boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_bookings_list_0147$
declare
  v_b      record;
  v_status reservation_status;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_status is not null then
    begin
      v_status := p_status::reservation_status;
    exception when invalid_text_representation then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
    end;
  end if;
  select * into v_page from app.assistant_page(p_limit, p_offset);

  select count(*) into v_total
    from reservations r
   where r.kind = 'booking'
     and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
     and (p_court_id is null or r.court_id = p_court_id)
     and (v_status is null or r.status = v_status)
     and (p_customer_id is null or r.guest_id = p_customer_id);

  if p_count_only then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', v_total);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  x.id,
           'court_id',            x.court_id,
           'court_name_en',       c.name_en,
           'court_name_ar',       c.name_ar,
           'kind',                x.kind,
           'status',              x.status,
           'start_at',            x.start_at,
           'end_at',              x.end_at,
           'guest_id',            x.guest_id,
           'guest_name',          coalesce(x.guest_name, pr.full_name),
           'guest_phone',         coalesce(x.guest_phone, pr.phone),
           'price_iqd',           x.price_iqd,
           'source',              x.source,
           'series_id',           x.series_id,
           'created_by_staff_id', x.created_by_staff_id,
           'created_at',          x.created_at,
           'cancelled_at',        x.cancelled_at,
           'cancellation_reason', x.cancellation_reason
         ) order by x.start_at, x.id), '[]'::jsonb)
    into v_rows
    from (
      select r.*
        from reservations r
       where r.kind = 'booking'
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (p_court_id is null or r.court_id = p_court_id)
         and (v_status is null or r.status = v_status)
         and (p_customer_id is null or r.guest_id = p_customer_id)
       order by r.start_at, r.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join courts   c  on c.id  = x.court_id
    left join profiles pr on pr.id = x.guest_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_bookings_list_0147$;

comment on function app.assistant_bookings_list(date, date, uuid, text, uuid, int, int, boolean) is
  '0109. Owner-only (reached through app.assistant_run_tool). Bookings (kind = booking) whose start falls on a business day in [p_from, p_to], optional court / status / customer filters, ordered by start, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_bookings_list(date, date, uuid, text, uuid, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. The columns, their allowlist rows, and the courts_findings prompt.
-- ---------------------------------------------------------------------------
delete from app.assistant_readable_columns
 where table_name in ('reservations', 'reservation_series')
   and column_name = 'players';

alter table reservations       drop column if exists players;
alter table reservation_series drop column if exists players;

update assistant_components
   set question = 'Read the courts figures for this range and write at most five findings, one per angle and only where the data supports it: (1) occupancy — which courts, weekdays and hours fill and which stay empty; (2) reliability — cancellations and no-shows, where they cluster; (3) demand — how far ahead people book, durations, the app against the desk; (4) guests — new against returning, and the regulars; (5) attach — cafe spend on court bookings. Each finding is one plain sentence with its figures, a kind, the subjects it names, its metrics and a confidence. Skip an angle rather than guess. Never restate a rejected finding.'
 where key = 'courts_findings'
   and kind = 'builtin';

-- An answer generated from the old question may talk about group size; the
-- next press regenerates it from the new one.
update assistant_component_cache
   set superseded_at = now()
 where component_key = 'courts_findings'
   and superseded_at is null;
