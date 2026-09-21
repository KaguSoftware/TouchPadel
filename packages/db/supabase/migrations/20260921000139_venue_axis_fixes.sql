-- ===========================================================================
-- 0139 — multi-venue slice 1, review fixes (2026-09-21 evening review of
-- 0122-0138 and 0120).
--
-- Nine corrections, each a re-issue of the latest body with one clause, so
-- that a single venue behaves bit-for-bit as before and a second venue stops
-- leaking into the first:
--
--   1. app.sweep_degraded_periods  read per venue, wrote globally (0137 made
--                                  is_degraded() venue-scoped; the sweep's
--                                  exists/update on degraded_periods had no
--                                  venue filter, so a beat at A closed B's
--                                  open outage and an open period at A hid
--                                  B's). Now one sweep per ACTIVE venue.
--   2. stations_read_staff         no venue conjunct: a cashier at A read B's
--                                  device registry. 0136 shape A applied.
--   3. staff_venues_read_mgmt      no venue conjunct: a manager at A read B's
--                                  roster. Same fix.
--   4. app.price_slot              picked rate_rules from ANY venue; a venue-
--                                  wide rule (court_id null) at B was a
--                                  candidate for an A court. Filtered to the
--                                  court's venue.
--   5. app.is_degraded(uuid),      read venue_settings unqualified (the rule
--      app.venue_mode(uuid)        in packages/db/CLAUDE.md for new code).
--                                  Prefer the venue's row, fall back to the
--                                  singleton, so slice 2 needs no re-issue.
--   6. venue_settings.venue_id     defaulted to app.default_venue(), which is
--                                  granted to service_role only — a column
--                                  default runs as the WRITING role (0121),
--                                  so any client insert would have failed.
--                                  Default is now current_venue_or_default()
--                                  and the table gets the venue_id_present
--                                  CHECK the other 35 carry.
--   7. app.is_staff_at             granted to anon "because policies evaluate
--                                  it" — no policy, CHECK or default calls it
--                                  (0136 uses staff_venue_ids()). Kept for
--                                  slice 2's per-venue roles, revoked from
--                                  anon, comment corrected.
--   8. app.set_station_staff       resolved the venue only in the unknown-
--                                  station branch; with every station known
--                                  it came from station_staff's column default
--                                  AFTER the delete, so VENUE_REQUIRED was the
--                                  last statement, not the guard. Hoisted.
--   9. app.refund                  the only queued money write with no open-
--                                  day guard: a refund queued offline could
--                                  land after close_day and desync
--                                  cash_expected_iqd. NO_OPEN_DAY before the
--                                  claim, like settle_zero_tab and cancel_tab.
--                                  A duplicate replay also spends any live
--                                  PIN grant it finds, so the station never
--                                  holds an authorisation nobody typed.
--
-- Also here: staff_venues.created_by gains `on delete set null` (staff_id
-- cascades; a populated created_by would have blocked a staff delete).
--
-- Every function is re-issued from its latest body (grep both spellings):
-- sweep_degraded_periods 0021, price_slot 0007, is_degraded(uuid) and
-- venue_mode(uuid) 0137, is_staff_at 0123, set_station_staff 0130, refund 0120.
-- Grants are re-issued after each (the registry gate replays them in order).
--
-- covered by tests/multi-venue.test.ts cases 11b-11d, 13, 14 and
-- tests/replay-idempotency.test.ts (refund NO_OPEN_DAY)
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.sweep_degraded_periods — one transition per active venue.
--    0021:75-86 body inside a loop; with one active venue the statements are
--    the same two, filtered to it. current_venue_or_default() is NOT used:
--    cron has no caller and must sweep every venue, and a heartbeat at A must
--    not decide anything about B.
-- ---------------------------------------------------------------------------
create or replace function app.sweep_degraded_periods() returns void
language plpgsql security definer set search_path = public as $sweep_degraded_periods_0139$
declare
  v_venue uuid;
begin
  for v_venue in select id from venues where is_active order by created_at, id loop
    if app.is_degraded(v_venue) then
      if not exists (select 1 from degraded_periods
                      where ended_at is null and venue_id = v_venue) then
        insert into degraded_periods (started_at, detected_by, venue_id)
        values (now(), 'heartbeat_timeout', v_venue);
      end if;
    else
      update degraded_periods set ended_at = now()
       where ended_at is null and venue_id = v_venue;
    end if;
  end loop;
end $sweep_degraded_periods_0139$;

comment on function app.sweep_degraded_periods() is
  '0139 (0021). Opens or closes the degraded_periods row of EVERY active venue from '
  'its own tills. Called by app.heartbeat and by cron tp_degraded_sweep every minute.';

revoke all on function app.sweep_degraded_periods() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. stations_read_staff — 0124:127-129 plus the venue conjunct (0136 shape A).
-- ---------------------------------------------------------------------------
drop policy if exists stations_read_staff on stations;
create policy stations_read_staff on stations
  for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- ---------------------------------------------------------------------------
-- 3. staff_venues_read_mgmt — 0123:70-72 plus the venue conjunct. A staffer
--    still reads their own rows through staff_venues_read_own, untouched.
-- ---------------------------------------------------------------------------
drop policy if exists staff_venues_read_mgmt on staff_venues;
create policy staff_venues_read_mgmt on staff_venues
  for select to authenticated
  using (app.is_staff('manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- staff_venues.created_by: never written by the trigger or a fixture, and its
-- FK had no ON DELETE while staff_id cascades. Re-add it as SET NULL so a
-- populated column can never block a staff delete.
do $staff_venues_created_by_0139$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_venues_created_by_fkey'
                and conrelid = 'staff_venues'::regclass) then
    alter table staff_venues drop constraint staff_venues_created_by_fkey;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'staff_venues_created_by_fkey'
                    and conrelid = 'staff_venues'::regclass) then
    alter table staff_venues
      add constraint staff_venues_created_by_fkey
      foreign key (created_by) references staff(id) on delete set null not valid;
  end if;
end $staff_venues_created_by_0139$;

do $staff_venues_created_by_validate_0139$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_venues_created_by_fkey'
                and conrelid = 'staff_venues'::regclass
                and not convalidated) then
    alter table staff_venues validate constraint staff_venues_created_by_fkey;
  end if;
end $staff_venues_created_by_validate_0139$;

-- ---------------------------------------------------------------------------
-- 4. app.price_slot — 0007:46-65 verbatim plus `r.venue_id = the court's`.
--    A court-specific rule already implies the venue through 0133's composite
--    FK; the venue-wide (court_id is null) branch is what leaked.
--    venue_settings.timezone stays the singleton read every pricing function
--    makes through slice 1 (the slice-2 platform_settings split re-issues it).
-- ---------------------------------------------------------------------------
create or replace function app.price_slot(p_court_id uuid, p_start_at timestamptz, p_duration_min int)
returns table (rule_id uuid, price_iqd bigint)
language sql stable security definer set search_path = public as $price_slot_0139$
  with loc as (
    select p_start_at at time zone coalesce((select timezone from venue_settings), 'Asia/Baghdad') as lts
  )
  select r.id, (p.price_iqd)::bigint
    from rate_rules r
    join rate_rule_prices p on p.rule_id = r.id and p.duration_min = p_duration_min
    cross join loc
   where r.is_active
     and r.venue_id = (select c.venue_id from courts c where c.id = p_court_id)
     and (r.court_id is null or r.court_id = p_court_id)
     and extract(dow from loc.lts)::int = any (r.days_of_week)
     and ( (r.start_time <= r.end_time and loc.lts::time >= r.start_time and loc.lts::time < r.end_time)
        or (r.start_time >  r.end_time and (loc.lts::time >= r.start_time or loc.lts::time < r.end_time)) )
     and (r.valid_from is null or loc.lts::date >= r.valid_from)
     and (r.valid_to   is null or loc.lts::date <= r.valid_to)
   order by (r.court_id is not null) desc, r.priority desc, r.id
   limit 1
$price_slot_0139$;

comment on function app.price_slot(uuid, timestamptz, int) is
  '0139 (0007). The winning rate rule for (court, start, duration): the court''s own venue '
  'only, court-specific before venue-wide, then priority. Zero rows when nothing prices it.';

revoke all on function app.price_slot(uuid, timestamptz, int) from public;
grant execute on function app.price_slot(uuid, timestamptz, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.is_degraded(uuid) / app.venue_mode(uuid) — 0137 bodies with the
--    venue_settings read qualified: the venue's own row when it has one,
--    else the singleton (`where id`, the boolean PK, as 0126 reads it).
-- ---------------------------------------------------------------------------
create or replace function app.is_degraded(p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $is_degraded_0139$
  select exists (select 1 from device_heartbeats
                  where venue_id = p_venue
                    and (is_till or device_id like 'TILL%'))
     and not exists (
       select 1 from device_heartbeats
        where venue_id = p_venue
          and (is_till or device_id like 'TILL%')
          and last_seen_at > now() - make_interval(
                secs => coalesce(
                  (select heartbeat_stale_seconds from venue_settings where venue_id = p_venue),
                  (select heartbeat_stale_seconds from venue_settings where id)))
     )
$is_degraded_0139$;

comment on function app.is_degraded(uuid) is
  '0139 (0137). Is this venue degraded: it has a till and none of its tills is fresh. '
  'heartbeat_stale_seconds from the venue''s own venue_settings row, else the singleton.';

create or replace function app.venue_mode(p_venue uuid) returns jsonb
language sql stable security definer set search_path = public as $venue_mode_0139$
  select jsonb_build_object(
    'degraded', app.is_degraded(p_venue),
    'degraded_since', (select started_at from degraded_periods
                        where ended_at is null
                          and venue_id = p_venue
                        order by started_at desc limit 1),
    'protected_horizon_hours', coalesce(
      (select protected_horizon_hours from venue_settings where venue_id = p_venue),
      (select protected_horizon_hours from venue_settings where id)),
    'server_time', now())
$venue_mode_0139$;

comment on function app.venue_mode(uuid) is
  '0139 (0137). What the clients poll and paint on, for one venue: degraded flag, when '
  'it started, the protected booking horizon and server time. Numbers only, safe for anon.';

revoke all on function app.is_degraded(uuid) from public;
revoke all on function app.venue_mode(uuid)  from public;
grant execute on function app.is_degraded(uuid) to anon, authenticated;
grant execute on function app.venue_mode(uuid)  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. venue_settings.venue_id — a default the writing role may execute, and
--    the presence CHECK the other scoped tables got in 0129.
-- ---------------------------------------------------------------------------
alter table venue_settings alter column venue_id set default app.current_venue_or_default();

comment on column venue_settings.venue_id is
  '0139 (0126): the venue this singleton describes. Defaults to app.current_venue_or_default() '
  '(granted to every writing role) — 0126 used app.default_venue(), which only service_role may '
  'execute, so a client insert would have failed at the default. ONE ROW through slice 1.';

do $venue_settings_present_0139$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'venue_settings_venue_id_present'
                    and conrelid = 'venue_settings'::regclass) then
    alter table venue_settings
      add constraint venue_settings_venue_id_present
      check (venue_id is not null) not valid;
  end if;
end $venue_settings_present_0139$;

do $venue_settings_present_validate_0139$
begin
  if exists (select 1 from pg_constraint
              where conname = 'venue_settings_venue_id_present'
                and conrelid = 'venue_settings'::regclass
                and not convalidated) then
    alter table venue_settings validate constraint venue_settings_venue_id_present;
  end if;
end $venue_settings_present_validate_0139$;

-- ---------------------------------------------------------------------------
-- 7. app.is_staff_at — 0123:166-175 verbatim; anon loses execute. Nothing a
--    policy, CHECK or default evaluates calls it, so the 0121 rule does not
--    apply; it stays for slice 2 (per-venue roles).
-- ---------------------------------------------------------------------------
create or replace function app.is_staff_at(p_venue uuid, variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $is_staff_at_0139$
  select case
    when not app.is_staff(variadic roles) then false
    when app.is_staff('owner') then true
    else exists (select 1
                   from staff_venues sv
                   join venues v on v.id = sv.venue_id and v.is_active
                  where sv.staff_id = auth.uid()
                    and sv.venue_id = p_venue)
  end
$is_staff_at_0139$;

comment on function app.is_staff_at(uuid, variadic staff_role[]) is
  '0139 (0123): app.is_staff() narrowed to one venue. Owners pass everywhere (they hold no '
  'staff_venues rows by design). Called by no policy in slice 1 (0136 uses staff_venue_ids()); '
  'kept for slice 2. authenticated only.';

revoke all on function app.is_staff_at(uuid, variadic staff_role[]) from public, anon;
grant execute on function app.is_staff_at(uuid, variadic staff_role[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. app.set_station_staff — 0130:144-203 verbatim with current_venue()
--    hoisted to the guard position and passed explicitly to station_staff.
-- ---------------------------------------------------------------------------
create or replace function app.set_station_staff(p_staff_id uuid, p_station_ids text[])
returns jsonb
language plpgsql security definer set search_path = public as $set_station_staff_0139$
declare
  v_ids    text[];
  v_before text[];
  v_id     text;
  v_venue  uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0139: the venue guard is the second statement, before any write. A manager
  -- who cannot say which venue they mean is told (VENUE_REQUIRED) here, not
  -- after the rota has been deleted.
  v_venue := app.current_venue();
  if not exists (select 1 from staff where id = p_staff_id) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into v_ids
    from unnest(coalesce(p_station_ids, '{}')) as x;
  foreach v_id in array v_ids loop
    if v_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
      raise exception 'INVALID_STATION' using errcode = 'P0001',
        hint = 'capitals, digits and dashes, starting with a letter';
    end if;
    -- 0130: the rota is usually written before the till is switched on, so a
    -- station named here that the registry has never seen is registered at
    -- the venue of the manager doing the assigning.
    if not exists (select 1 from stations where id = v_id and retired_at is null) then
      insert into stations (id, venue_id, is_till, registered_by)
      values (v_id, v_venue, v_id like 'TILL%', auth.uid())
      on conflict (id) do update
         set retired_at = null,
             is_till    = stations.is_till or excluded.is_till;
      perform app.write_audit('station.registered', 'stations', v_id,
                              null,
                              jsonb_build_object('venue_id', v_venue, 'is_till', v_id like 'TILL%',
                                                 'via', 'set_station_staff'),
                              null, null, null);
    end if;
  end loop;

  select coalesce(array_agg(station_id order by station_id), '{}')
    into v_before
    from station_staff where staff_id = p_staff_id;

  delete from station_staff where staff_id = p_staff_id;
  insert into station_staff (station_id, staff_id, created_by, venue_id)
  select x, p_staff_id, auth.uid(), v_venue from unnest(v_ids) as x;

  if v_before is distinct from v_ids then
    perform app.write_audit('staff.stations_set', 'staff', p_staff_id::text,
                            jsonb_build_object('station_ids', to_jsonb(v_before)),
                            jsonb_build_object('station_ids', to_jsonb(v_ids)));
  end if;

  return jsonb_build_object('staff_id', p_staff_id, 'station_ids', to_jsonb(v_ids));
end $set_station_staff_0139$;

comment on function app.set_station_staff(uuid, text[]) is
  '0139 (0130, 0105). Replaces a staffer''s station rota (manager, owner). An unknown station is '
  'registered at the caller''s venue; VENUE_REQUIRED is raised before any write.';

revoke all on function app.set_station_staff(uuid, text[]) from public, anon;
grant execute on function app.set_station_staff(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.refund — $refund_0120$ (0120:56-159) VERBATIM plus the open-day
--    guard and the grant spend on the duplicate path. Same signature, so
--    `create or replace` keeps the grants; re-issued anyway.
-- ---------------------------------------------------------------------------
create or replace function app.refund(
  p_payment_id      uuid,
  p_amount_iqd      bigint,
  p_pin             text,
  p_reason_code     text,
  p_items           jsonb default null,
  p_device_id       text  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0139$
declare
  v_auth     uuid;
  v_payment  payments%rowtype;
  v_tab_id   uuid;
  v_refunded bigint;
  v_refund   refunds%rowtype;
  v_item     jsonb;
  v_oi       order_items%rowtype;
  v_qty      int;
  v_replay   jsonb;
  v_result   jsonb;
  v_day      uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- 0120: claim after the guards and before any write or lock (0049 pattern).
  -- A replay of the same key by the same caller returns the stored result
  -- here. 0139: it also spends the grant the replay worker minted for this
  -- dispatch, if there is one, so the station is not left holding a live
  -- authorisation for the next two minutes. Best effort — a duplicate must
  -- echo the stored result whatever the grant table says.
  v_replay := app.claim_replay(p_idempotency_key, 'refund');
  if v_replay is not null then
    begin
      perform app.consume_pin_grant(p_device_id);
    exception when others then
      null;
    end;
    return v_replay;
  end if;

  -- 0139: a refund is money leaving the till, so it needs an open day like
  -- settle_zero_tab and cancel_tab (0120) — a refund queued offline and
  -- replayed after close_day would otherwise land on a closed day.
  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to
  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt
  -- persisted either way) and holds a single-use grant; without one this raises
  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.
  v_auth := app.consume_pin_grant(p_device_id);

  -- 0044: the tab comes FIRST. payments.tab_id never changes (payments are
  -- append-only, and merge_tabs refuses a donor that has any), so resolving it
  -- through an unlocked read and then locking is sound. Taking `tabs` here is
  -- what makes app.tab_net_paid() actually stable for settle_tab and for all
  -- three REQUIRES_REFUND guards, every one of which reads it under this lock.
  select tab_id into v_tab_id from payments where id = p_payment_id;
  if v_tab_id is null then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from tabs where id = v_tab_id for update;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount_iqd), 0) into v_refunded
    from refunds where payment_id = p_payment_id;
  if v_refunded + p_amount_iqd > v_payment.amount_iqd then
    raise exception 'REFUND_EXCEEDS_PAYMENT' using errcode = 'P0001',
      detail = format('paid %s, already refunded %s', v_payment.amount_iqd, v_refunded);
  end if;

  insert into refunds (payment_id, amount_iqd, reason_code, refunded_by)
  values (p_payment_id, p_amount_iqd, p_reason_code, auth.uid())
  returning * into v_refund;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
      select oi.* into v_oi
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.id = (v_item->>'order_item_id')::uuid
         and o.tab_id = v_payment.tab_id;
      if not found then
        raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001',
          detail = v_item->>'order_item_id';
      end if;
      if v_qty < 1 or v_qty > v_oi.qty then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;
      insert into refund_items (refund_id, order_item_id, qty)
      values (v_refund.id, v_oi.id, v_qty);
    end loop;
  end if;

  -- STOCK HOOK (0018/0043): the refund_items_restock trigger writes the
  -- 'refund_reversal' movements, guarded against void-as-waste double credit.

  perform app.write_audit('payment.refund', 'refunds', v_refund.id::text,
                          null, to_jsonb(v_refund), p_reason_code, v_auth, p_device_id);

  v_result := jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $refund_0139$;

comment on function app.refund(uuid, bigint, text, text, jsonb, text, text) is
  '0139 (0120, 0044, 0115). Refunds part or all of one payment (manager, owner) behind a manager-PIN grant, inside an open day (NO_OPEN_DAY otherwise); naming order lines restocks them. p_idempotency_key: a replay of the same key by the same caller echoes the first result with duplicate:true (app.claim_replay). REFUND_EXCEEDS_PAYMENT (detail = paid/refunded), PAYMENT_NOT_FOUND, ITEM_NOT_ON_TAB, INVALID_QTY, INVALID_AMOUNT.';

revoke all on function app.refund(uuid, bigint, text, text, jsonb, text, text) from public, anon;
grant execute on function app.refund(uuid, bigint, text, text, jsonb, text, text) to authenticated;
