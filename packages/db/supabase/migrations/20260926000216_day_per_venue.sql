set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0216_day_per_venue — multi-venue slice 3, step 2 (the day family).
--
-- day_sessions has been unique per (venue_id, business_date) since 0134, but
-- the bodies that open, close and find the day never looked at the venue:
--   * open_day (0015) took its date from the singleton, treated any row on that
--     date as a duplicate and refused with PREVIOUS_DAY_OPEN if ANY branch had a
--     day open;
--   * close_day (0205) locked the newest open day at any branch and blocked on
--     queued writes at any branch's till;
--   * current_open_day() (0015) and current_open_day_locked() (0038) returned the
--     newest open day anywhere, so a second branch's tabs, refunds and drawer
--     opens would attach to the first branch's day.
-- Each is re-issued from its latest body and works on ONE branch: p_venue_id
-- when given, else the caller's resolved venue (the station on the request,
-- 0215; app.current_venue raises VENUE_REQUIRED rather than guess). open_day and
-- close_day guard with app.is_staff_at, and audit at the branch. Till shifts
-- (0205) hang off the day, so they inherit the fix.

-- current_open_day / current_open_day_locked: re-issued from
-- 20260824000015_tabs_orders.sql:197 and 20260825000038_concurrency_locks.sql:55 with p_venue
drop function if exists app.current_open_day();
drop function if exists app.current_open_day_locked();

create or replace function app.current_open_day(p_venue uuid default null) returns uuid
language sql stable security definer set search_path = public as $current_open_day_0216$
  select id from day_sessions
   where status = 'open'
     and venue_id = coalesce(p_venue, app.current_venue())
   order by opened_at desc limit 1
$current_open_day_0216$;

create or replace function app.current_open_day_locked(p_venue uuid default null) returns uuid
language sql security definer set search_path = public as $current_open_day_locked_0216$
  select id from day_sessions
   where status = 'open'
     and venue_id = coalesce(p_venue, app.current_venue())
   order by opened_at desc limit 1 for share
$current_open_day_locked_0216$;

comment on function app.current_open_day(uuid) is
  '0015, 0216. The open day of one branch: p_venue, else the caller''s resolved venue (VENUE_REQUIRED when ambiguous). Internal.';
comment on function app.current_open_day_locked(uuid) is
  '0038, 0216. current_open_day, taking the day row FOR SHARE (lock order: day_sessions first). Internal.';

revoke all on function app.current_open_day(uuid) from public, anon, authenticated;
revoke all on function app.current_open_day_locked(uuid) from public, anon, authenticated;

-- open_day: re-issued from 20260824000015_tabs_orders.sql:364 with p_venue_id
drop function if exists app.open_day(bigint, date, text);

create or replace function app.open_day(
  p_opening_float_iqd bigint,
  p_business_date     date default null,
  p_device_id         text default null,
  p_venue_id          uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $open_day_0216$
declare
  v_date  date;
  v_row   day_sessions%rowtype;
  v_venue uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0216: one branch: the argument, else the station on the request or the
  -- caller's only membership.
  v_venue := coalesce(p_venue_id, app.current_venue(p_device_id));
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_opening_float_iqd is null or p_opening_float_iqd < 0 then
    raise exception 'INVALID_FLOAT' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_date := coalesce(p_business_date,
                     (now() at time zone coalesce((select vs.timezone from venue_settings vs where vs.venue_id = v_venue), 'Asia/Baghdad'))::date);

  select * into v_row from day_sessions where venue_id = v_venue and business_date = v_date;
  if found then
    return jsonb_build_object('duplicate', true, 'day_session_id', v_row.id,
                              'status', v_row.status);
  end if;

  if exists (select 1 from day_sessions where venue_id = v_venue and status in ('open','closing')) then
    raise exception 'PREVIOUS_DAY_OPEN' using errcode = 'P0001',
      hint = 'close the previous day before opening a new one';
  end if;

  insert into day_sessions (venue_id, business_date, opened_by, opening_float_iqd)
  values (v_venue, v_date, auth.uid(), p_opening_float_iqd)
  returning * into v_row;

  perform app.write_audit('day.open', 'day_sessions', v_row.id::text,
                          null, to_jsonb(v_row), null, null, p_device_id);

  return jsonb_build_object('duplicate', false, 'day_session_id', v_row.id,
                            'business_date', v_row.business_date);
end $open_day_0216$;

comment on function app.open_day(bigint, date, text, uuid) is
  '0015, 0216. Manager or owner at the branch: open that branch''s business day (p_venue_id, else the station on the request / the caller''s only membership). A second call on the same date returns duplicate; PREVIOUS_DAY_OPEN when that branch still has a day open.';

revoke all on function app.open_day(bigint, date, text, uuid) from public, anon;
grant execute on function app.open_day(bigint, date, text, uuid) to authenticated;

-- close_day: re-issued from 20260926000205_till_shifts.sql:1236 with p_venue_id
drop function if exists app.close_day(bigint, bigint, text, text);

create or replace function app.close_day(
  p_cash_counted_iqd bigint,
  p_card_batch_iqd   bigint default null,
  p_notes            text default null,
  p_device_id        text default null,
  p_venue_id         uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $close_day_0216$
declare
  v_day           day_sessions%rowtype;
  v_before        jsonb;
  v_cash_in       bigint;
  v_cash_refunds  bigint;
  v_card_in       bigint;
  v_card_refunds  bigint;
  v_cash_expected bigint;
  v_card_expected bigint;
  v_shift         till_shifts%rowtype;
  v_shifts_closed int := 0;
  v_venue         uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0216: one branch: the argument, else the station on the request or the
  -- caller's only membership.
  v_venue := coalesce(p_venue_id, app.current_venue(p_device_id));
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cash_counted_iqd is null or p_cash_counted_iqd < 0 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  select * into v_day from day_sessions
   where venue_id = v_venue
     and status in ('open','closing')
   order by opened_at desc limit 1
   for update;
  if not found then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- Guard 1: every tab settled or voided before the day closes.
  if exists (select 1 from tabs
              where day_session_id = v_day.id and status in ('open','awaiting_payment')) then
    raise exception 'DAY_OPEN_TABS' using errcode = 'P0001',
      hint = 'settle or void every open tab before closing the day';
  end if;

  -- Guard 2: no till may still hold queued (unreplayed) writes. Queue depth is
  -- reported by app.heartbeat (0021); a device silent since before the day
  -- opened does not block.
  if exists (select 1 from device_heartbeats
              where venue_id = v_venue
                and queue_depth > 0 and last_seen_at >= v_day.opened_at) then
    raise exception 'DAY_UNSYNCED' using errcode = 'P0001',
      hint = 'a till still has queued offline writes; let it finish replaying';
  end if;

  -- till_shifts: no shift outlives its day. Each one still open ends here,
  -- in this transaction, with its figures stamped and no count.
  perform 1 from till_shifts where day_session_id = v_day.id and closed_at is null for update;
  for v_shift in
    select * from till_shifts
     where day_session_id = v_day.id and closed_at is null
     order by opened_at
  loop
    perform app.close_till_shift_internal(v_shift, null, null, 'day_close', null, p_device_id);
    v_shifts_closed := v_shifts_closed + 1;
  end loop;

  v_before := to_jsonb(v_day);

  select coalesce(sum(p.amount_iqd), 0) into v_cash_in
    from payments p where p.day_session_id = v_day.id and p.method = 'cash';
  select coalesce(sum(r.amount_iqd), 0) into v_cash_refunds
    from refunds r join payments p on p.id = r.payment_id
   where p.day_session_id = v_day.id and p.method = 'cash';
  select coalesce(sum(p.amount_iqd), 0) into v_card_in
    from payments p where p.day_session_id = v_day.id and p.method = 'card';
  select coalesce(sum(r.amount_iqd), 0) into v_card_refunds
    from refunds r join payments p on p.id = r.payment_id
   where p.day_session_id = v_day.id and p.method = 'card';

  v_cash_expected := v_day.opening_float_iqd + v_cash_in - v_cash_refunds;
  v_card_expected := v_card_in - v_card_refunds;

  update day_sessions
     set status                  = 'closed',
         closed_at               = now(),
         closed_by               = auth.uid(),
         cash_expected_iqd       = v_cash_expected,
         cash_counted_iqd        = p_cash_counted_iqd,
         cash_variance_iqd       = p_cash_counted_iqd - v_cash_expected,
         card_expected_iqd       = v_card_expected,
         card_terminal_batch_iqd = p_card_batch_iqd,
         notes                   = coalesce(p_notes, notes)
   where id = v_day.id
   returning * into v_day;

  perform app.write_audit('day.close', 'day_sessions', v_day.id::text,
                          v_before, to_jsonb(v_day), null, null, p_device_id);

  return jsonb_build_object(
    'day_session_id',    v_day.id,
    'business_date',     v_day.business_date,
    'cash_expected_iqd', v_day.cash_expected_iqd,
    'cash_counted_iqd',  v_day.cash_counted_iqd,
    'cash_variance_iqd', v_day.cash_variance_iqd,
    'card_expected_iqd', v_day.card_expected_iqd,
    'card_terminal_batch_iqd', v_day.card_terminal_batch_iqd,
    'shifts_closed_with_day', v_shifts_closed);
end $close_day_0216$;

comment on function app.close_day(bigint, bigint, text, text, uuid) is
  '0020/0205, 0216. Manager or owner at the branch: close that branch''s open day (p_venue_id, else the station on the request / the caller''s only membership). Refuses with DAY_OPEN_TABS or DAY_UNSYNCED (that branch''s tills only); ends every open till shift of the day; stamps expected and counted cash and card.';

revoke all on function app.close_day(bigint, bigint, text, text, uuid) from public, anon;
grant execute on function app.close_day(bigint, bigint, text, text, uuid) to authenticated;

