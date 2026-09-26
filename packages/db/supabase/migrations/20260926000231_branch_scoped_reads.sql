set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0231 (multi-venue audit, 2026-09-26): reads and checks that crossed branches.
--
--   * preview_series suggests, and create_series moves to, courts of the
--     series court's own branch only; preview_series refuses another branch's
--     court (VENUE_MISMATCH) like create_series does.
--   * series_detail and booking_bill: staff read a booking of a branch they
--     work at (a guest still reads their own series).
--   * table_qr_tokens lists the branch in scope only, with the branch's name on
--     each table (a copied branch repeats the table numbers), and
--     generate_table_token refuses another branch's table.
--   * audit_log_page reads the report scope (app.report_venues), like the
--     audit_log policy the page used to side-step.
--   * kitchen_board with no branch argument follows the scope
--     (visible_venue_ids), not every branch of the caller.
--   * menu_availability: guests see open branches, staff the branch in scope;
--     "today" is each item's own branch's business day; stock is summed only
--     for the ingredients of those branches.
--   * verify_manager_pin: a manager's PIN counts at the branch it is used at
--     (the row's branch a guard asserted, else the station's or the caller's),
--     the owner's everywhere. It also means one bcrypt per manager of that
--     branch instead of per manager of the chain.
--   * unpaid_played_bookings: bounded to the day's window before the per-row
--     business-date test, so it no longer walks the branch's whole history.
--   * report_cafe: the category filter no longer drops the branch filter
--     (and/or precedence, 0219).
--   * receive_delivery: the supplier must be the delivery's own branch's.
--   * Eight money and stock child tables read through their parent's branch:
--     tab_adjustments, refund_items, promotion_redemptions, delivery_lines,
--     stock_count_lines, menu_item_costs, recipe_lines, marketing_sends.

-- preview_series: re-issued from 20260926000210_booking_settings_per_venue.sql
create or replace function app.preview_series(p_court_id uuid, p_pattern text, p_weekdays integer[], p_start_time time without time zone, p_duration_min integer, p_starts_on date, p_ends_on date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $preview_series_0231$
declare
  v_occ      record;
  v_hit      record;
  v_reason   text;
  v_alts     uuid[];
  v_conflict jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_venue    uuid;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from courts where id = p_court_id and is_active) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0231: the court's branch, and only a branch the caller works at.
  v_venue := (select c.venue_id from courts c where c.id = p_court_id);
  if not app.is_staff_at(v_venue, 'court_desk','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  for v_occ in
    select o.occ_date, o.start_at, o.end_at
      from app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                  p_starts_on, p_ends_on, (select c.venue_id from courts c where c.id = p_court_id)) o
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
           and c.venue_id = v_venue
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
end $preview_series_0231$;

-- create_series: re-issued from 20260926000217_cross_venue_guards.sql
create or replace function app.create_series(p_court_id uuid, p_pattern text, p_weekdays integer[], p_start_time time without time zone, p_duration_min integer, p_starts_on date, p_ends_on date, p_guest_id uuid DEFAULT NULL::uuid, p_guest_name text DEFAULT NULL::text, p_guest_phone text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_resolutions jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_players integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $create_series_0231$
declare
  v_venue uuid;
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
  -- 0217: the court's branch decides the day, the rows written and who may act.
  v_venue := (select c.venue_id from courts c where c.id = p_court_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
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
                                    v_existing.duration_min, v_existing.starts_on, v_existing.ends_on,
                                    v_existing.venue_id) o
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
      if v_target is null or not exists (select 1 from courts where id = v_target and is_active
                                                                and venue_id = v_venue) then
        raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
          detail = v_r::text, hint = 'moveCourt needs the id of an active court';
      end if;
    end if;
  end loop;

  -- Validate the pattern (INVALID_PATTERN / INVALID_WEEKDAYS / INVALID_RANGE /
  -- SERIES_EMPTY / SERIES_TOO_LONG) before the series row and before any lock.
  perform app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                 p_starts_on, p_ends_on, (select c.venue_id from courts c where c.id = p_court_id));

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
end $create_series_0231$;

-- series_detail: re-issued from 20260903000066_reservation_series.sql
create or replace function app.series_detail(p_series_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $series_detail_0231$
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
     and ((v_staff and app.is_staff_at(venue_id, 'court_desk','cashier','manager','owner'))
          or guest_id = v_uid);
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
end $series_detail_0231$;

-- booking_bill: re-issued from 20260917000106_desk_payment.sql
create or replace function app.booking_bill(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $booking_bill_0231$
declare
  v_res        reservations%rowtype;
  v_court      courts%rowtype;
  v_live       boolean;
  v_day_open   boolean;
  v_tab        tabs%rowtype;
  v_totals     record;
  v_paid_net   bigint;
  v_live_json  jsonb := null;
  v_court_paid bigint;
  v_remaining  bigint;
  v_refunds    bigint;
  v_refund_due bigint;
  v_settled    jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_res from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_res.venue_id, 'cashier','court_desk','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select * into v_court from courts where id = v_res.court_id;

  v_live := v_res.kind = 'booking' and v_res.status in ('confirmed','arrived','completed');
  v_day_open := exists (select 1 from day_sessions where status = 'open' and venue_id = v_res.venue_id);

  select * into v_tab from tabs
   where reservation_id = v_res.id and status in ('open','awaiting_payment')
   limit 1;
  if found then
    select * into v_totals from app.compute_tab_totals(v_tab.id);
    v_paid_net := app.tab_net_paid(v_tab.id);
    v_live_json := jsonb_build_object(
      'id',              v_tab.id,
      'status',          v_tab.status,
      'day_session_id',  v_tab.day_session_id,
      'subtotal_iqd',    v_totals.subtotal_iqd,
      'discount_iqd',    v_totals.discount_iqd,
      'tax_iqd',         v_totals.tax_iqd,
      'court_iqd',       v_totals.court_iqd,
      'total_iqd',       v_totals.total_iqd,
      'paid_iqd',        v_paid_net,
      'due_iqd',         greatest(v_totals.total_iqd - v_paid_net, 0),
      'over_paid_iqd',   greatest(v_paid_net - v_totals.total_iqd, 0),
      -- Units, not rows: two coffees on one line are two items to the guest.
      'item_count',      (select coalesce(sum(oi.qty), 0) from order_items oi join orders o on o.id = oi.order_id
                           where o.tab_id = v_tab.id and o.status <> 'voided' and not oi.voided),
      'has_orders',      exists (select 1 from orders where tab_id = v_tab.id),
      'has_payments',    exists (select 1 from payments where tab_id = v_tab.id),
      'has_adjustments', exists (select 1 from tab_adjustments where tab_id = v_tab.id));
  end if;

  v_court_paid := app.court_fee_paid(v_res.id, null);
  v_remaining  := app.court_fee_remaining(v_res.id, null);

  select coalesce(sum(rf.amount_iqd), 0) into v_refunds
    from refunds rf
    join payments p on p.id = rf.payment_id
    join tabs t on t.id = p.tab_id
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  -- Display only ("may be owed back"): what the settled tabs billed for the
  -- court beyond what the booking now costs, less anything already refunded
  -- on those tabs. A refund carries no court/goods split, so this is a prompt
  -- for a manager, never a figure anything else is computed from.
  v_refund_due := greatest(
    v_court_paid - (case when v_live then coalesce(v_res.price_iqd, 0) else 0 end) - v_refunds,
    0);

  select coalesce(jsonb_agg(jsonb_build_object(
           'tab_id',      t.id,
           'settled_at',  t.settled_at,
           'court_iqd',   t.court_iqd,
           'total_iqd',   t.total_iqd,
           'refunds_iqd', (select coalesce(sum(rf.amount_iqd), 0) from refunds rf
                             join payments p2 on p2.id = rf.payment_id where p2.tab_id = t.id),
           'payments',    (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id',               p.id,
                                     'method',           p.method,
                                     'amount_iqd',       p.amount_iqd,
                                     'tendered_iqd',     p.tendered_iqd,
                                     'change_iqd',       p.change_iqd,
                                     'created_at',       p.created_at,
                                     'recorded_by_name', s.display_name) order by p.created_at), '[]'::jsonb)
                             from payments p left join staff s on s.id = p.recorded_by
                            where p.tab_id = t.id)
         ) order by t.settled_at), '[]'::jsonb)
    into v_settled
    from tabs t
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  return jsonb_build_object(
    'reservation', jsonb_build_object(
       'id',            v_res.id,
       'kind',          v_res.kind,
       'status',        v_res.status,
       'price_iqd',     v_res.price_iqd,
       'guest_name',    v_res.guest_name,
       'start_at',      v_res.start_at,
       'end_at',        v_res.end_at,
       'court_id',      v_res.court_id,
       'court_name_en', v_court.name_en,
       'court_name_ar', v_court.name_ar),
    'live',                 v_live,
    'day_open',             v_day_open,
    'live_tab',             v_live_json,
    'court_paid_iqd',       v_court_paid,
    'court_remaining_iqd',  v_remaining,
    'court_refund_due_iqd', v_refund_due,
    'settled_tabs',         v_settled);
end $booking_bill_0231$;

-- table_qr_tokens: re-issued from 20260825000031_tables_storage.sql
create or replace function app.table_qr_tokens()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $table_qr_tokens_0231$
declare
  v_out   jsonb;
  v_count int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'table_id',      t.id,
           'table_number',  t.table_number,
           'zone',          t.zone,
           'capacity',      t.capacity,
           'is_active',     t.is_active,
           'bell_enabled',  t.bell_enabled,
           'token_version', t.token_version,
           'token',         app.generate_table_token(t.id),
           'venue_id',      t.venue_id,
           'venue_name_en', v.name_en,
           'venue_name_ar', v.name_ar)
           order by v.created_at, length(t.table_number), t.table_number), '[]'::jsonb),
         count(*)
    into v_out, v_count
    from cafe_tables t
    join venues v on v.id = t.venue_id
   where t.is_active
     and t.venue_id = any (app.visible_venue_ids());

  perform app.write_audit('table.qr_tokens_read', 'cafe_tables', 'all',
                          null, jsonb_build_object('tables', v_count));
  return v_out;
end $table_qr_tokens_0231$;

-- generate_table_token: re-issued from 20260907000071_compact_table_token.sql
create or replace function app.generate_table_token(p_table_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $generate_table_token_0231$
declare
  v_table cafe_tables%rowtype;
  v_id    bytea;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_table from cafe_tables where id = p_table_id;
  if not found then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_table.venue_id, 'manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  -- uuid -> its 16 raw bytes. decode(hex) is the portable route; uuid_send()
  -- lives in a schema this function's search_path does not name.
  v_id := decode(replace(v_table.id::text, '-', ''), 'hex');

  return app.b64url_encode(
           v_id || substring(
             extensions.hmac(v_id || convert_to(v_table.token_version::text, 'utf8'),
                             convert_to(app.table_token_secret(), 'utf8'),
                             'sha256')
             from 1 for 10));
end $generate_table_token_0231$;

-- audit_log_page: re-issued from 20260903000068_reports.sql
create or replace function app.audit_log_page(p_from timestamp with time zone, p_to timestamp with time zone, p_actor_id uuid DEFAULT NULL::uuid, p_action_prefix text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $audit_log_page_0231$
declare
  v_total bigint;
  v_rows  jsonb;
  v_rv    uuid[];
begin
  perform app.reports_guard(false);
  v_rv := app.report_venues();
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_limit', hint = 'p_limit must be between 1 and 1000';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_offset';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from audit_log l
   where l.venue_id = any (v_rv)
     and (p_from is null or l.at >= p_from)
     and (p_to   is null or l.at <  p_to)
     and (p_actor_id is null or l.actor_id = p_actor_id or l.authorizer_id = p_actor_id)
     and (p_action_prefix is null or l.action like p_action_prefix || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',             x.id,
           'at',             x.at,
           'actorId',        x.actor_id,
           'actorRole',      x.actor_role,
           'actorName',      coalesce(sa.display_name, pa.full_name),
           'authorizerId',   x.authorizer_id,
           'authorizerName', su.display_name,
           'action',         x.action,
           'entity',         x.entity,
           'entityId',       x.entity_id,
           'before',         x.before,
           'after',          x.after,
           'reasonCode',     x.reason_code,
           'deviceId',       x.device_id
         ) order by x.at desc, x.id desc), '[]'::jsonb)
    into v_rows
    from (
      select l.*
        from audit_log l
       where l.venue_id = any (v_rv)
         and (p_from is null or l.at >= p_from)
         and (p_to   is null or l.at <  p_to)
         and (p_actor_id is null or l.actor_id = p_actor_id or l.authorizer_id = p_actor_id)
         and (p_action_prefix is null or l.action like p_action_prefix || '%')
       order by l.at desc, l.id desc
       limit p_limit offset p_offset) x
    left join staff sa    on sa.id = x.actor_id
    left join profiles pa on pa.id = x.actor_id
    left join staff su    on su.id = x.authorizer_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
end $audit_log_page_0231$;

-- kitchen_board: re-issued from 20260926000194_assistant_barista_waiter_access.sql
create or replace function app.kitchen_board(p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $kitchen_board_0231$
declare
  v_venues   uuid[];
  v_bookings boolean;
  v_tickets  jsonb;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is null then
    -- The old tickets_staff_read venue axis: the owner's active venues, anyone
    -- else's active memberships.
    v_venues := app.visible_venue_ids();
  elsif app.is_staff_at(p_venue_id, 'prep','cashier','manager','owner',
                        'head_barista','barista','assistant_barista','head_chef','chef') then
    v_venues := array[p_venue_id];
  else
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The booking's guest name: only where the caller's own policy reads the
  -- booking (reservations_staff_read, and reservations_cashier_read through
  -- the tab that holds it).
  v_bookings := app.is_staff('cashier','manager','owner');

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',               t.id,
             'status',           t.status,
             'target_seconds',   t.target_seconds,
             'created_at',       t.created_at,
             'completed_at',     t.completed_at,
             'last_actor_label', t.last_actor_label,
             'order', jsonb_build_object(
               'id',     o.id,
               'source', o.source,
               'status', o.status,
               'tab', (select jsonb_build_object(
                                'id',    tb.id,
                                'label', tb.label,
                                'table', (select jsonb_build_object('table_number', ct.table_number)
                                            from cafe_tables ct where ct.id = tb.table_id),
                                'reservation', case when v_bookings then
                                                 (select jsonb_build_object('id', r.id, 'guest_name', r.guest_name)
                                                    from reservations r where r.id = tb.reservation_id)
                                               end)
                         from tabs tb where tb.id = o.tab_id),
               'order_items', coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'id',       oi.id,
                            'qty',      oi.qty,
                            'notes',    oi.notes,
                            'voided',   oi.voided,
                            'ready_at', oi.ready_at,
                            'menu_item', (select jsonb_build_object('name_en', mi.name_en, 'name_ar', mi.name_ar)
                                            from menu_items mi where mi.id = oi.menu_item_id),
                            'variant', (select jsonb_build_object('name_en', v.name_en, 'name_ar', v.name_ar)
                                          from menu_item_variants v where v.id = oi.variant_id),
                            'order_item_modifiers', coalesce((
                              select jsonb_agg(
                                       jsonb_build_object(
                                         'qty', oim.qty,
                                         'modifier', jsonb_build_object('name_en', m.name_en, 'name_ar', m.name_ar))
                                       order by m.sort_order, m.id)
                                from order_item_modifiers oim
                                join modifiers m on m.id = oim.modifier_id
                               where oim.order_item_id = oi.id), '[]'::jsonb))
                          order by oi.line_no)
                   from order_items oi
                  where oi.order_id = o.id), '[]'::jsonb)))
           order by t.created_at), '[]'::jsonb)
    into v_tickets
    from tickets t
    join orders o on o.id = t.order_id
   where t.venue_id = any(v_venues)
     and (t.status in ('queued','preparing','ready')
          or (t.status = 'completed' and t.completed_at >= now() - interval '2 minutes'));

  return jsonb_build_object('tickets', v_tickets);
end $kitchen_board_0231$;

-- menu_availability: re-issued from 20260922000146_shop_sale_path.sql
create or replace function app.menu_availability()
 RETURNS TABLE(item_id uuid, orderable boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $menu_availability_0231$
  with branches as (
    -- 0231: guests see open branches; staff the branch in scope. Each with its
    -- own business day.
    select v.id, app.venue_business_date(v.id, now()) as d
      from venues v
     where v.id = any (case when app.staff_role() is null then app.open_venue_ids()
                            else app.visible_venue_ids() end)
  ),
  on_hand as (
    select sb.ingredient_id, sum(sb.qty_remaining) as qty
      from stock_batches sb
     where sb.qty_remaining > 0
       and sb.venue_id in (select id from branches)
     group by sb.ingredient_id
  ),
  direct as (
    -- every ingredient any variant of the item draws on, deduped
    select v.item_id, rl.ingredient_id
      from menu_item_variants v
      join recipe_lines rl on rl.variant_id = v.id
     group by v.item_id, rl.ingredient_id
  ),
  required as (
    -- purchased, or prepared with stock on hand: required as-is
    select d.item_id, d.ingredient_id
      from direct d
      join ingredients i on i.id = d.ingredient_id
      left join on_hand oh on oh.ingredient_id = d.ingredient_id
     where i.kind = 'purchased' or (i.kind = 'prepared' and coalesce(oh.qty, 0) > 0)
    union
    -- prepared and OUT: one-level expansion into its components
    select d.item_id, rl.ingredient_id
      from direct d
      join ingredients i on i.id = d.ingredient_id
      join recipe_lines rl on rl.output_ingredient_id = d.ingredient_id
      left join on_hand oh on oh.ingredient_id = d.ingredient_id
     where i.kind = 'prepared' and coalesce(oh.qty, 0) <= 0
  ),
  -- 0146: retail stock is per size. An item is orderable while ANY of its
  -- sizes is on the shelf; the one-size-out case must not grey the rack.
  retail as (
    select v.item_id, bool_or(coalesce(oh.qty, 0) > 0) as any_in
      from menu_item_variants v
      join recipe_lines rl on rl.variant_id = v.id
      join ingredients i on i.id = rl.ingredient_id and i.kind = 'retail'
      left join on_hand oh on oh.ingredient_id = i.id
     group by v.item_id
  )
  select mi.id as item_id,
         mi.is_active
           and coalesce(mi.unavailable_on <> b.d, true)   -- 0041, 0231: the item's branch's day
           and not mi.sold_out
           and not exists (
             select 1
               from required r
               left join on_hand oh on oh.ingredient_id = r.ingredient_id
              where r.item_id = mi.id and coalesce(oh.qty, 0) <= 0
           )
           and coalesce((select r.any_in from retail r where r.item_id = mi.id), true)
           as orderable
    from menu_items mi
    join branches b on b.id = mi.venue_id
$menu_availability_0231$;

-- verify_manager_pin: re-issued from 20260923000156_new_roles_access.sql
create or replace function app.verify_manager_pin(p_pin text, p_device_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $verify_manager_pin_0231$
declare
  v_started timestamptz := clock_timestamp();
  v_caller  text := coalesce(auth.uid()::text, 'anon');
  v_key     text;
  v_fails   int;
  v_id      uuid;
  v_matches int;
  v_venues  uuid[];
  v_one     uuid;
begin
  -- 0046: staff only. The five money RPCs that call this are SECURITY DEFINER
  -- owned by postgres, so this guard sees the ORIGINAL caller's JWT and passes
  -- for them; a guest probing the endpoint directly is refused before any
  -- bcrypt work happens. NOT padded: this is not a PIN outcome at all, it is
  -- "you are not staff", and the caller's own role is not a secret from them.
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- RATE-LIMIT KEY (0026): p_device_id is client-supplied, so keying on it
  -- alone let a caller rotate device ids for unlimited guesses. Attempts are
  -- stored under '{caller}:{device}' and failures are COUNTED per caller
  -- (prefix match across all that caller's devices): 5 fails / 5 min / caller.
  v_key := v_caller || ':' || coalesce(p_device_id, 'unknown');

  select count(*) into v_fails
    from app.pin_attempts
   where device_id like v_caller || ':%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    -- 0086: padded. Without this a locked-out caller is refused in a
    -- millisecond while a wrong PIN costs a bcrypt, and the retry loop that
    -- follows a lockout runs at full speed.
    perform app.pin_pad_to_floor(v_started);
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  -- 0086: ONE scan, always over every candidate. The previous count(*) +
  -- `select … limit 1` pair made a CORRECT pin measurably faster than a wrong
  -- one, because only the second query could stop early. array_agg with an
  -- ORDER BY keeps 0037's stable attribution on a PIN collision.
  -- 0231: a manager's PIN counts at the branch it is used at: the row's branch
  -- a guard asserted (app.venue_id), else the station's, else the caller's
  -- (all of theirs when they work at several). The owner's counts everywhere.
  v_one := app.resolve_venue(p_device_id);
  v_venues := case when v_one is not null then array[v_one] else app.staff_venue_ids() end;
  select count(*), (array_agg(id order by id))[1]
    into v_matches, v_id
    from staff s
   where s.role in ('manager','owner') and s.is_active
     and s.pin_hash is not null
     and (s.role = 'owner'
          or exists (select 1 from staff_venues sv
                      where sv.staff_id = s.id and sv.venue_id = any (v_venues)))
     and s.pin_hash = extensions.crypt(p_pin, s.pin_hash);

  -- 0115: a CORRECT pin that is weak (0078) is refused like a wrong one — same
  -- padding, same attempt row, same NULL — so the refusal is not an oracle
  -- either. The audit row explains it to the owner; app.set_staff_pin, which
  -- refuses weak PINs, is the way out. Written here, on the returning path.
  if v_id is not null and app.pin_is_weak(p_pin) then
    perform app.write_audit('staff.pin_weak_refused', 'staff', v_id::text, null,
                            jsonb_build_object('scope', 'manager'), null, null, p_device_id);
    v_id := null;
    v_matches := 0;
  end if;

  insert into app.pin_attempts (device_id, success) values (v_key, v_id is not null);

  -- 0086: the lockout is audited HERE — at the failure that reaches the
  -- threshold — because this path RETURNS and therefore commits. Writing it
  -- beside the `raise` above would roll the row back with the exception and
  -- log nothing at all (the 0011 lesson).
  --
  -- entity_id is THE CALLER, not the manager whose PIN was guessed at — there
  -- is no such manager on a failure, and audit_log.entity_id is NOT NULL, so
  -- passing null here aborted the whole transaction. That did not merely lose
  -- the audit row: it rolled back the pin_attempts INSERT alongside it, so the
  -- fifth failure was never recorded and THE LOCKOUT NEVER ENGAGED. Caught by
  -- pin-uniformity.test.ts on its first run; it is the 0011 failure mode
  -- wearing a different hat, which is why the row is written on a path that
  -- returns rather than one that raises.
  if v_id is null and v_fails + 1 >= 5 then
    perform app.write_audit('staff.pin_locked', 'staff', v_caller, null,
                            jsonb_build_object('scope', 'manager', 'fails', v_fails + 1,
                                               'window', '5 minutes'),
                            null, null, p_device_id);
  end if;

  -- A collision means authorized_by may name the wrong manager. Ordering makes
  -- the choice stable; it does not make it correct. Real fix is PIN uniqueness.
  if v_matches > 1 then
    raise warning 'PIN collision: % active managers share this PIN', v_matches;
    perform app.write_audit('staff.pin_collision', 'staff', v_id::text, null,
                            jsonb_build_object('matches', v_matches), null, null, p_device_id);
  end if;

  -- 0115: mint the grant the money RPC will consume (app.consume_pin_grant).
  -- This is the returning path, so the row commits with the attempt row.
  if v_id is not null then
    insert into app.pin_grants (caller_id, authorizer_id, device_id)
    values (auth.uid(), v_id, p_device_id);
    -- Housekeeping, bounded: spent or stale rows older than an hour.
    delete from app.pin_grants
     where caller_id = auth.uid()
       and created_at < now() - interval '1 hour';
  end if;

  -- Padded on BOTH outcomes. Padding only the failure would invert the leak:
  -- fast would mean correct.
  perform app.pin_pad_to_floor(v_started);
  return v_id;
end $verify_manager_pin_0231$;

-- unpaid_played_bookings: re-issued from 20260926000219_reports_venue_scope.sql
create or replace function app.unpaid_played_bookings(p_day_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $unpaid_played_bookings_0231$
declare
  v_day day_sessions%rowtype;
  v_out jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_day_session_id is null then
    -- 0219: the open day of the caller's branch.
    select * into v_day from day_sessions
     where venue_id = app.current_venue() and status in ('open','closing')
     order by opened_at desc limit 1;
  else
    select * into v_day from day_sessions where id = p_day_session_id;
  end if;
  if not found then
    return '[]'::jsonb;
  end if;
  if not app.is_staff_at(v_day.venue_id, 'manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'reservation_id', r.id,
           'guest_name',     r.guest_name,
           'status',         r.status,
           'start_at',       r.start_at,
           'end_at',         r.end_at,
           'court_name_en',  c.name_en,
           'court_name_ar',  c.name_ar,
           'price_iqd',      r.price_iqd,
           'remaining_iqd',  app.court_fee_remaining(r.id, null),
           'live_tab_id',    (select t.id from tabs t where t.reservation_id = r.id
                                and t.status in ('open','awaiting_payment') limit 1))
         order by r.start_at), '[]'::jsonb)
    into v_out
    from reservations r
    join courts c on c.id = r.court_id
   where r.kind = 'booking'
     and r.venue_id = v_day.venue_id
     -- 0231: a sargable window around the business day (any timezone and
     -- start hour fall inside it) before the exact per-row test below.
     and r.start_at >= v_day.business_date::timestamptz - interval '2 days'
     and r.start_at <  v_day.business_date::timestamptz + interval '3 days'
     and app.venue_business_date(v_day.venue_id, r.start_at) = v_day.business_date
     and (r.status in ('arrived','completed') or (r.status = 'confirmed' and r.end_at <= now()))
     and app.court_fee_remaining(r.id, null) > 0;

  return v_out;
end $unpaid_played_bookings_0231$;

-- report_cafe: re-issued from 20260926000219_reports_venue_scope.sql
create or replace function app.report_cafe(p_from date, p_to date, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $report_cafe_0231$
declare
  v_rv uuid[] := app.report_venues();
  v_b        record;
  v_cat      uuid;
  v_rows     jsonb;
  v_summary  jsonb;
  v_by_cat   jsonb;
  v_waste    jsonb;
  v_prep     jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'categoryId' and jsonb_typeof(p_filters -> 'categoryId') <> 'null' then
    begin
      v_cat := (p_filters ->> 'categoryId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'categoryId';
    end;
  end if;

  with
  l as (
    select l.order_id, l.menu_item_id, l.variant_id, l.net_qty as qty, l.net_line_iqd, l.cost_total_iqd,
           mi.category_id
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join menu_items mi on mi.id = l.menu_item_id
     where mi.venue_id = any(v_rv) and (v_cat is null or mi.category_id = v_cat)),
  per_item as (
    select l.menu_item_id, l.category_id,
           sum(l.qty)::bigint                                   as qty,
           sum(l.net_line_iqd)::bigint                          as revenue_iqd,
           case when bool_and(l.cost_total_iqd is not null)
                then sum(l.cost_total_iqd)::bigint end          as cogs_iqd,
           count(distinct l.order_id)                           as orders
      from l
     group by l.menu_item_id, l.category_id),
  per_cat as (
    select pi.category_id,
           sum(pi.qty)::bigint                                    as qty,
           sum(pi.revenue_iqd)::bigint                            as revenue_iqd,
           case when bool_or(pi.cogs_iqd is not null)
                then sum(pi.cogs_iqd)::bigint end                 as cogs_iqd,
           count(*)                                               as items
      from per_item pi
     group by pi.category_id),
  tot as (
    select coalesce(sum(pi.qty), 0)::bigint                                          as qty,
           coalesce(sum(pi.revenue_iqd), 0)::bigint                                  as revenue_iqd,
           coalesce(sum(pi.cogs_iqd), 0)::bigint                                     as cogs_iqd,
           coalesce(sum(pi.revenue_iqd) filter (where pi.cogs_iqd is not null), 0)::bigint as revenue_with_cogs_iqd,
           count(*)::int                                                              as items_total,
           count(pi.cogs_iqd)::int                                                    as items_with_cogs
      from per_item pi),
  ord as (
    select count(*) as orders
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and (v_cat is null or exists (
             select 1 from order_items oi join menu_items mi on mi.id = oi.menu_item_id
              where mi.venue_id = any(v_rv) and oi.order_id = o.id and not oi.voided and mi.category_id = v_cat)))
  select
    coalesce((select jsonb_agg(jsonb_build_object(
               'itemId',         pi.menu_item_id,
               'nameEn',         mi.name_en,
               'nameAr',         mi.name_ar,
               'categoryId',     pi.category_id,
               'categoryNameEn', mc.name_en,
               'categoryNameAr', mc.name_ar,
               'qty',            pi.qty,
               'orders',         pi.orders,
               'revenueIqd',     pi.revenue_iqd,
               'cogsIqd',        pi.cogs_iqd,
               'grossProfitIqd', case when pi.cogs_iqd is not null then pi.revenue_iqd - pi.cogs_iqd end,
               'marginPct',      case when pi.cogs_iqd is not null and pi.revenue_iqd > 0
                                      then round((pi.revenue_iqd - pi.cogs_iqd) * 100.0 / pi.revenue_iqd, 1) end
             ) order by pi.revenue_iqd desc, pi.qty desc, mi.name_en, pi.menu_item_id)
        from per_item pi
        join menu_items mi      on mi.id = pi.menu_item_id
        join menu_categories mc on mc.id = pi.category_id), '[]'::jsonb),
    (select jsonb_build_object(
               'orders',            ord.orders,
               'qty',               tot.qty,
               'avgOrderValueIqd',  case when ord.orders > 0 then round(tot.revenue_iqd::numeric / ord.orders)::bigint else 0 end,
               'revenueIqd',        tot.revenue_iqd,
               'cogsIqd',           tot.cogs_iqd,
               'grossProfitIqd',    tot.revenue_with_cogs_iqd - tot.cogs_iqd,
               'marginPct',         case when tot.revenue_with_cogs_iqd > 0
                                         then round((tot.revenue_with_cogs_iqd - tot.cogs_iqd) * 100.0 / tot.revenue_with_cogs_iqd, 1) end,
               'cogsCoveragePct',   case when tot.revenue_iqd > 0
                                         then round(tot.revenue_with_cogs_iqd * 100.0 / tot.revenue_iqd, 1) else 0 end,
               'itemsWithCogs',     tot.items_with_cogs,
               'itemsTotal',        tot.items_total)
        from tot, ord),
    coalesce((select jsonb_agg(jsonb_build_object(
               'categoryId',     pc.category_id,
               'categoryNameEn', mc.name_en,
               'categoryNameAr', mc.name_ar,
               'items',          pc.items,
               'qty',            pc.qty,
               'revenueIqd',     pc.revenue_iqd,
               'cogsIqd',        pc.cogs_iqd,
               'grossProfitIqd', case when pc.cogs_iqd is not null then pc.revenue_iqd - pc.cogs_iqd end,
               'marginPct',      case when pc.cogs_iqd is not null and pc.revenue_iqd > 0
                                      then round((pc.revenue_iqd - pc.cogs_iqd) * 100.0 / pc.revenue_iqd, 1) end
             ) order by pc.revenue_iqd desc, mc.sort_order, mc.name_en)
        from per_cat pc
        join menu_categories mc on mc.id = pc.category_id), '[]'::jsonb)
    into v_rows, v_summary, v_by_cat;

  select coalesce(jsonb_agg(jsonb_build_object(
           'reason',  x.reason,
           'count',   x.n,
           'qty',     x.qty,
           'costIqd', x.cost
         ) order by x.cost desc, x.reason), '[]'::jsonb)
    into v_waste
    from (
      select coalesce(sm.reason_code, sm.movement_type::text)                  as reason,
             count(*)                                                          as n,
             sum(-sm.qty_delta)                                                as qty,
             coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost
        from stock_movements sm
       where sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
         and sm.qty_delta < 0
         and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
       group by 1) x;

  select jsonb_build_object(
           'avgSeconds', round(avg(t.actual_prep_seconds))::int,
           'p90Seconds', round(percentile_cont(0.9) within group (order by t.actual_prep_seconds))::int,
           'count',      count(*))
    into v_prep
    from tickets t
   where t.venue_id = any(v_rv) and t.actual_prep_seconds is not null
     and coalesce(t.ready_at, t.completed_at) >= v_b.ts_from
     and coalesce(t.ready_at, t.completed_at) <  v_b.ts_to;

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','nameEn',         'labelEn','Item',         'labelAr','الصنف',        'kind','text'),
      jsonb_build_object('key','categoryNameEn', 'labelEn','Category',     'labelAr','التصنيف',      'kind','text'),
      jsonb_build_object('key','qty',            'labelEn','Qty',          'labelAr','الكمية',       'kind','count'),
      jsonb_build_object('key','revenueIqd',     'labelEn','Revenue',      'labelAr','الإيراد',      'kind','money'),
      jsonb_build_object('key','cogsIqd',        'labelEn','Cost of goods','labelAr','تكلفة البضاعة','kind','money'),
      jsonb_build_object('key','grossProfitIqd', 'labelEn','Gross profit', 'labelAr','الربح الإجمالي','kind','money'),
      jsonb_build_object('key','marginPct',      'labelEn','Margin',       'labelAr','الهامش',       'kind','pct')),
    'rows',          v_rows,
    'totals',        v_summary,
    'summary',       v_summary,
    'byCategory',    v_by_cat,
    'wasteByReason', v_waste,
    'prepTimes',     v_prep,
    'comparison',    null);
end $report_cafe_0231$;

-- receive_delivery: re-issued from 20260926000200_stock_locations.sql
create or replace function app.receive_delivery(p_lines jsonb, p_supplier_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_location text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $receive_delivery_0231$
declare
  v_venue    uuid;
  v_loc      stock_location;
  v_replay   jsonb;
  v_supplier suppliers%rowtype;
  v_sname    text := nullif(btrim(p_supplier_name), '');
  v_result   jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.current_venue();
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_loc := app.parse_stock_location(p_location, 'cafe');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_DELIVERY' using errcode = 'P0001';
  end if;
  if p_supplier_id is not null then
    select * into v_supplier from suppliers
     where id = p_supplier_id and venue_id = v_venue;
    if not found then
      raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_sname := coalesce(v_sname, v_supplier.name);
  end if;

  -- 0145: claim after the guards and before any write (0049 pattern). A
  -- second tap of "Receive" or a replayed receipt confirm returns the first
  -- delivery instead of doubling the stock.
  v_replay := app.claim_replay(p_idempotency_key, 'receive_delivery');
  if v_replay is not null then
    return v_replay;
  end if;

  v_result := app.receive_delivery_internal(v_venue, v_loc, p_lines, v_sname, p_notes, p_device_id,
                                            p_supplier_id, 'goods_in');

  perform app.write_audit('stock.receive_delivery', 'deliveries', v_result->>'delivery_id',
                          null, jsonb_build_object('lines', p_lines, 'supplier', v_sname,
                                                   'supplier_id', p_supplier_id, 'location', v_loc),
                          null, null, p_device_id);

  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $receive_delivery_0231$;


-- Money and stock child tables read through their parent's branch (0226 axis).
drop policy if exists tab_adjustments_staff_read on tab_adjustments;
create policy tab_adjustments_staff_read on tab_adjustments for select to authenticated
  using ((select app.is_staff('cashier','manager','owner'))
         and exists (select 1 from tabs t
                      where t.id = tab_adjustments.tab_id
                        and t.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists refund_items_staff_read on refund_items;
create policy refund_items_staff_read on refund_items for select to authenticated
  using ((select app.is_staff('cashier','manager','owner'))
         and exists (select 1 from refunds r
                      where r.id = refund_items.refund_id
                        and r.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists promotion_redemptions_staff_read on promotion_redemptions;
create policy promotion_redemptions_staff_read on promotion_redemptions for select to authenticated
  using ((select app.is_staff('cashier','manager','owner'))
         and exists (select 1 from tabs t
                      where t.id = promotion_redemptions.tab_id
                        and t.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists delivery_lines_mgmt_read on delivery_lines;
create policy delivery_lines_mgmt_read on delivery_lines for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and exists (select 1 from deliveries d
                      where d.id = delivery_lines.delivery_id
                        and d.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists stock_count_lines_mgmt_read on stock_count_lines;
create policy stock_count_lines_mgmt_read on stock_count_lines for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and exists (select 1 from stock_counts c
                      where c.id = stock_count_lines.count_id
                        and c.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists menu_item_costs_mgmt_read on menu_item_costs;
create policy menu_item_costs_mgmt_read on menu_item_costs for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and exists (select 1 from menu_items mi
                      where mi.id = menu_item_costs.item_id
                        and mi.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists recipe_lines_mgmt_read on recipe_lines;
create policy recipe_lines_mgmt_read on recipe_lines for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and exists (select 1 from ingredients i
                      where i.id = recipe_lines.ingredient_id
                        and i.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists marketing_sends_read on marketing_sends;
create policy marketing_sends_read on marketing_sends for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and exists (select 1 from marketing_campaigns c
                      where c.id = marketing_sends.campaign_id
                        and c.venue_id = any ((select app.visible_venue_ids())::uuid[])));
