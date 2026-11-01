-- 0382 branch_isolation — everything stays inside its own branch (launch
-- findings F-27 and F-28, Majed 2026-11-01: "Everything exclusive to its own
-- branch").
--
-- F-27. The building-wide realtime topics 'kds', 'floor' and 'courts' (0022,
-- 0033, 0061, 0062, 0074, 0238, 0352) were kept "for one operator release"
-- by 0224 next to the per-branch 'kds:<venue>', 'floor:<venue>' and
-- 'courts:<venue>'. Any branch's kitchen and till staff could join them, so
-- with two branches open one branch heard the other's tickets, waiter calls,
-- slips and court changes. Every sender now sends on the branch topic only,
-- and the read policies admit the branch topics only:
--   rt_ticket, rt_order_item_ready, rt_waiter_call, rt_reservation,
--   rt_court_changed (0224), rt_order_slip (0238), order_set_delivery (0352)
--   and delete_court (0074, which sent on 'courts' alone: now courts:<venue>)
--   are re-issued from their latest bodies without the literal topic;
--   touchpadel_rt_staff_topics and touchpadel_rt_courts (0224) lose the
--   literal topics. 'menu' (public, table/key/op only) and 'ranks' stay.
-- The operator (lib/realtime.ts branchTopic), the phone (courtsChannel,
-- useFloorLive) and the waiter's calls already join the branch topics.
--
-- F-28. Reads with no branch guard:
--   * app.split_evenly (0015) and app.split_by_item (0053) checked only
--     is_staff(cashier, manager, owner): a cashier at one branch could read
--     another branch's bill total and lines by tab id. Both now refuse a tab
--     of a branch the caller does not work at (VENUE_MISMATCH,
--     app.is_staff_at), right after the tab is found.
--   * app.eligible_promotions (0309) had the same gap (it reads the tab's
--     customer, lines and totals): same guard.
--   * staff requests (0072): a manager read, through app.staff_requests_page
--     and the staff_requests_read_mgmt policy, every branch's leave and
--     advance asks, and could decide them. A manager now reads and decides
--     the asks of the people who share a branch with them
--     (app.shares_branch_with); the owner still sees every ask. The decision
--     guard is a trigger (staff_requests_branch_guard) rather than a re-issue
--     of app.decide_staff_request, so it holds whatever body decides.
-- Writes were already guarded by zz_branch_guard (0230) on every branch
-- table; a pass over every granted definer RPC that takes a tab, order,
-- booking, table or court id found no other read without a branch guard.
--
-- covered by packages/db/tests/branch-isolation.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Broadcast triggers: the branch topic only (re-issued from 0224).
-- ---------------------------------------------------------------------------
create or replace function app.rt_ticket() returns trigger
language plpgsql security definer set search_path = public as $rt_ticket_0382$
begin
  -- 0382 (F-27): the branch's own topic only; the building-wide one is gone.
  begin
    perform realtime.send(
      jsonb_build_object(
        'ticket_id', new.id,
        'order_id',  new.order_id,
        'status',    new.status,
        'created_at', new.created_at,
        'target_seconds', new.target_seconds),
      case when tg_op = 'INSERT' then 'ticket_created' else 'ticket_status' end,
      'kds:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_ticket_0382$;

revoke all on function app.rt_ticket() from public, anon, authenticated;

create or replace function app.rt_order_item_ready() returns trigger
language plpgsql security definer set search_path = public as $rt_order_item_ready_0382$
begin
  -- 0382 (F-27): the branch's own topic only; the building-wide one is gone.
  begin
    perform realtime.send(
      jsonb_build_object(
        'order_item_id', new.id,
        'order_id',      new.order_id,
        'ready',         new.ready_at is not null),
      'item_ready',
      'kds:' || (select o.venue_id from orders o where o.id = new.order_id)::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_order_item_ready_0382$;

revoke all on function app.rt_order_item_ready() from public, anon, authenticated;

create or replace function app.rt_waiter_call() returns trigger
language plpgsql security definer set search_path = public as $rt_waiter_call_0382$
begin
  -- 0382 (F-27): the branch's own topic only; the building-wide one is gone.
  begin
    perform realtime.send(
      jsonb_build_object(
        'call_id',  new.id,
        'table_id', new.table_id,
        'reason',   new.reason,
        'status',   new.status,
        'raised_at', new.raised_at),
      'waiter_call',
      'floor:' || new.venue_id::text,
      true);
  exception when others then null;
  end;

  -- NEW: the guest who raised the call (topic authorised by
  -- touchpadel_rt_guest_session while their session is live).
  if new.guest_session_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object(
          'call_id',         new.id,
          'status',          new.status,
          'reason',          new.reason,
          'raised_at',       new.raised_at,
          'acknowledged_at', new.acknowledged_at,
          'resolved_at',     new.resolved_at),
        'waiter_call_status',
        'session:' || new.guest_session_id::text,
        true);
    exception when others then null;
    end;
  end if;

  return new;
end $rt_waiter_call_0382$;

revoke all on function app.rt_waiter_call() from public, anon, authenticated;

create or replace function app.rt_reservation() returns trigger
language plpgsql security definer set search_path = public as $rt_reservation_0382$
begin
  if tg_op = 'UPDATE'
     and new.status = old.status
     and new.court_id = old.court_id
     and new.start_at = old.start_at
     and new.end_at = old.end_at then
    return new;                               -- nothing grid-relevant changed
  end if;
  -- 0382 (F-27): the branch's own topic only; the building-wide one is gone.
  begin
    perform realtime.send(
      jsonb_build_object(
        'court_id', new.court_id,
        'start_at', new.start_at,
        'end_at',   new.end_at,
        'kind',     new.kind,
        'status',   new.status,
        'busy',     new.status in ('pending','confirmed','arrived')),
      'slot_changed',
      'courts:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_reservation_0382$;

revoke all on function app.rt_reservation() from public, anon, authenticated;

create or replace function app.rt_court_changed() returns trigger
language plpgsql security definer set search_path = public as $rt_court_changed_0382$
begin
  -- 0382 (F-27): the branch's own topic only; the building-wide one is gone.
  begin
    perform realtime.send(
      jsonb_build_object('court_id', new.id, 'active', new.is_active),
      'court_changed',
      'courts:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_court_changed_0382$;

revoke all on function app.rt_court_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Order slips (re-issued from 0238): floor:<venue> only.
-- ---------------------------------------------------------------------------
create or replace function app.rt_order_slip() returns trigger
language plpgsql security definer set search_path = public as $rt_order_slip_0382$
begin
  begin
    perform realtime.send(
      jsonb_build_object('slip_id', new.id, 'status', new.status),
      'order_slip',
      'floor:' || new.venue_id::text,
      true);
  exception when others then null;
  end;
  return new;
end $rt_order_slip_0382$;

revoke all on function app.rt_order_slip() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.order_set_delivery (re-issued from 0352): kds:<venue> only.
-- ---------------------------------------------------------------------------
create or replace function app.order_set_delivery(
  p_order_id       uuid,
  p_service        text,
  p_table_id       uuid default null,
  p_reservation_id uuid default null,
  p_device_id      text default null
) returns jsonb
language plpgsql security definer set search_path = public as $order_set_delivery_0382$
declare
  v_venue  uuid;
  v_order  orders%rowtype;
  v_before orders%rowtype;
  v_tab    tabs%rowtype;
  v_res    reservations%rowtype;
  v_ticket tickets%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := (select o.venue_id from orders o where o.id = p_order_id);
  if v_venue is null then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_service is null or p_service not in ('deliver','pickup') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'service';
  end if;
  if p_table_id is not null and p_reservation_id is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'one spot';
  end if;
  if p_service = 'pickup' and (p_table_id is not null or p_reservation_id is not null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'a pick up has no spot';
  end if;

  if p_table_id is not null
     and not exists (select 1 from cafe_tables where id = p_table_id and is_active and venue_id = v_venue) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null then
    select * into v_res from reservations where id = p_reservation_id and venue_id = v_venue;
    if not found or v_res.kind not in ('booking','lesson') then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_res.status not in ('confirmed','arrived') then
      raise exception 'RESERVATION_NOT_LIVE' using errcode = 'P0001', detail = v_res.status::text;
    end if;
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if v_order.status in ('voided','served') then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001', hint = v_order.status::text;
  end if;
  select * into v_tab from tabs where id = v_order.tab_id;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := v_order;
  update orders
     set service                = p_service::order_service,
         deliver_table_id       = p_table_id,
         deliver_reservation_id = p_reservation_id
   where id = p_order_id
   returning * into v_order;

  perform app.write_audit('order.delivery', 'orders', v_order.id::text,
    jsonb_build_object('service', v_before.service, 'deliver_table_id', v_before.deliver_table_id,
                       'deliver_reservation_id', v_before.deliver_reservation_id),
    jsonb_build_object('service', v_order.service, 'deliver_table_id', v_order.deliver_table_id,
                       'deliver_reservation_id', v_order.deliver_reservation_id),
    null, null, p_device_id);

  -- Every board re-reads (KdsBoard invalidates on any kds event): the 0224
  -- payload, unchanged, on the branch's topic (0382, F-27: the literal 'kds'
  -- topic is gone).
  select * into v_ticket from tickets where order_id = v_order.id;
  if found then
    begin
      perform realtime.send(
        jsonb_build_object(
          'ticket_id', v_ticket.id,
          'order_id',  v_ticket.order_id,
          'status',    v_ticket.status,
          'created_at', v_ticket.created_at,
          'target_seconds', v_ticket.target_seconds),
        'ticket_status', 'kds:' || v_ticket.venue_id::text, true);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('order_id', v_order.id, 'service', v_order.service,
    'deliver_table_id', v_order.deliver_table_id,
    'deliver_reservation_id', v_order.deliver_reservation_id);
end $order_set_delivery_0382$;

comment on function app.order_set_delivery(uuid, text, uuid, uuid, text) is
  '0352 (order first, the table after), 0382. Cashier, manager and owner at the order''s branch: sets how one order reaches the guest, at any time after it was placed: p_service pickup (no spot), or deliver to p_table_id (an active table of the branch, TABLE_NOT_FOUND), to p_reservation_id''s court (a booking or lesson of the branch, RESERVATION_NOT_FOUND; confirmed or arrived, RESERVATION_NOT_LIVE), or to neither (the tab''s own seat, or on a counter tab no table yet). INVALID_ARGUMENT hint service | one spot | a pick up has no spot. The order must be live (ORDER_NOT_FOUND for none, voided or served) on an open or awaiting-payment tab (TAB_NOT_OPEN). Re-announces its ticket on kds:<venue> (ticket_status). Returns {order_id, service, deliver_table_id, deliver_reservation_id}. Audit order.delivery.';

revoke all on function app.order_set_delivery(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function app.order_set_delivery(uuid, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.delete_court (re-issued from 0074): courts:<venue>.
-- ---------------------------------------------------------------------------
create or replace function app.delete_court(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $delete_court_0382$
declare
  v_row          courts%rowtype;
  v_reservations int;
  v_series       int;
  v_rate_rules   int;
begin
  -- Same tier as upsert_court/reorder_courts (0062).
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from courts where id = p_id for update;
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- EVERY reservation, not just live ones: a cancelled booking from March is
  -- still a row the courts report reads a name off.
  select count(*) into v_reservations from reservations where court_id = p_id;
  select count(*) into v_series       from reservation_series where court_id = p_id;
  select count(*) into v_rate_rules   from rate_rules where court_id = p_id;

  if v_reservations > 0 or v_series > 0 or v_rate_rules > 0 then
    raise exception 'COURT_IN_USE' using errcode = 'P0001',
      -- The screen parses this to say what is holding the court and offer the
      -- deactivate instead. Keep the shape if you touch it.
      detail = jsonb_build_object('reservations', v_reservations,
                                  'series',       v_series,
                                  'rate_rules',   v_rate_rules)::text,
      hint = 'deactivate the court instead — its bookings and reports still name it';
  end if;

  -- Audit BEFORE the row goes: write_audit reads the snapshot, and after the
  -- delete there is nothing left to snapshot.
  perform app.write_audit('courts.delete', 'courts', p_id::text, to_jsonb(v_row), null);

  delete from courts where id = p_id;

  -- 0062's courts_rt trigger is AFTER INSERT OR UPDATE only, so a delete emits
  -- nothing and the desk grid, the rate editor and the guest court list would
  -- all keep the court until their next refetch. Same payload shape, 'active'
  -- false because it is gone. 0382 (F-27): on the court's branch topic
  -- (courts:<venue>, 0224), no longer the building-wide 'courts'.
  begin
    perform realtime.send(
      jsonb_build_object('court_id', p_id, 'active', false, 'deleted', true),
      'court_changed',
      'courts:' || v_row.venue_id::text,
      true);
  exception when others then null;
  end;

  return jsonb_build_object('court_id', p_id, 'deleted', true);
end $delete_court_0382$;

comment on function app.delete_court(uuid) is
  '0074, 0382: hard-delete a court that nothing references. Raises COURT_IN_USE (detail = {reservations, series, rate_rules}) when it has history — that court is deactivated via app.upsert_court instead, so the reports keep its name. Announces court_changed {court_id, active false, deleted true} on courts:<venue>.';

revoke all on function app.delete_court(uuid) from public, anon;
grant execute on function app.delete_court(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The read policies: the branch topics only.
-- ---------------------------------------------------------------------------
do $rt_staff_topics_0382$
begin
  if to_regclass('realtime.messages') is null then
    raise exception 'SETUP_FAILED' using errcode = 'P0001',
      detail = 'realtime.messages is missing: touchpadel_rt_staff_topics cannot be created';
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_staff_topics on realtime.messages
  $p$;

  execute $p$
    create policy touchpadel_rt_staff_topics on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (
              (realtime.topic() ~ '^(kds|floor):[0-9a-f-]{36}$'
               and app.is_staff_at(split_part(realtime.topic(), ':', 2)::uuid,
                                   'prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef'))
           or (realtime.topic() ~ '^floor:[0-9a-f-]{36}$'
               and app.is_staff_at(split_part(realtime.topic(), ':', 2)::uuid, 'waiter'))
        )
      )
  $p$;
end $rt_staff_topics_0382$;

do $rt_courts_0382$
begin
  if to_regclass('realtime.messages') is null then
    raise exception 'SETUP_FAILED' using errcode = 'P0001',
      detail = 'realtime.messages is missing: touchpadel_rt_courts cannot be created';
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_courts on realtime.messages
  $p$;

  -- Any signed-in session (the guest app's grid, the desk), as in 0224, but
  -- the branch topic only.
  execute $p$
    create policy touchpadel_rt_courts on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and realtime.topic() ~ '^courts:[0-9a-f-]{36}$'
      )
  $p$;
end $rt_courts_0382$;

-- ---------------------------------------------------------------------------
-- 6. Bills: split_evenly (0015), split_by_item (0053), eligible_promotions (0309).
-- ---------------------------------------------------------------------------
create or replace function app.split_evenly(p_tab_id uuid, p_n int)
returns bigint[]
language plpgsql stable security definer set search_path = public as $split_evenly_0382$
declare
  v_tab   tabs%rowtype;
  v_total bigint;
  v_base  bigint;
  v_rem   bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_n is null or p_n < 1 or p_n > 50 then
    raise exception 'INVALID_SPLIT_COUNT' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0382 (F-28): only staff of the tab's own branch read its bill.
  if not app.is_staff_at(v_tab.venue_id, 'cashier','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  -- Settled tabs use the stamped total; open tabs the live computation.
  if v_tab.total_iqd is not null then
    v_total := v_tab.total_iqd;
  else
    select t.total_iqd into v_total from app.compute_tab_totals(p_tab_id) t;
  end if;

  v_base := v_total / p_n;                     -- bigint division truncates = floor for non-negatives
  v_rem  := v_total % p_n;

  return (
    select array_agg(case when i <= v_rem then v_base + 1 else v_base end order by i)
      from generate_series(1, p_n) i
  );
end $split_evenly_0382$;

revoke all on function app.split_evenly(uuid, int) from public, anon;
grant execute on function app.split_evenly(uuid, int) to authenticated;

create or replace function app.split_by_item(p_tab_id uuid, p_groups jsonb)
returns bigint[]
language plpgsql stable security definer set search_path = public as $split_by_item_0382$
declare
  v_tab       tabs%rowtype;
  v_totals    record;
  v_n         int;
  v_assigned  int;
  v_live      int;
  v_dupes     int;
  v_orphans   int;
  v_amounts   bigint[];
  v_sum       bigint := 0;
  v_remainder bigint;
  i           int;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'INVALID_SPLIT' using errcode = 'P0001',
      hint = 'expected an array of groups, each an array of order_item ids';
  end if;
  v_n := jsonb_array_length(p_groups);
  if v_n < 2 or v_n > 50 then
    raise exception 'INVALID_SPLIT_COUNT' using errcode = 'P0001',
      hint = 'a split has between 2 and 50 parts';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0382 (F-28): only staff of the tab's own branch read its bill.
  if not app.is_staff_at(v_tab.venue_id, 'cashier','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  -- The assignment, flattened once. A CTE rather than a temp table: this
  -- function is STABLE, and a temp table would also need a WHERE-less DELETE,
  -- which safeupdate refuses on every PostgREST connection (see 0052 and
  -- scripts/check-safe-update.mjs — the guard caught exactly that here).
  with assign as (
    select (elem #>> '{}')::uuid as order_item_id, g.ord - 1 as grp
      from jsonb_array_elements(p_groups) with ordinality as g(items, ord),
           jsonb_array_elements(g.items) as elem
  )
  select count(*),
         (select count(*) from (select order_item_id from assign
                                 group by order_item_id having count(*) > 1) d),
         (select count(*) from assign a
           where not exists (
             select 1 from order_items oi
             join orders o on o.id = oi.order_id
              where oi.id = a.order_item_id and o.tab_id = p_tab_id
                and o.status <> 'voided' and not oi.voided))
    into v_assigned, v_dupes, v_orphans
    from assign;

  if v_dupes > 0 then
    raise exception 'ITEM_ASSIGNED_TWICE' using errcode = 'P0001';
  end if;
  if v_orphans > 0 then
    raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001';
  end if;

  select count(*) into v_live
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  -- Partial coverage is refused rather than quietly returning parts that do
  -- not sum to the bill: the whole point of the call is that they add up.
  if v_assigned <> v_live then
    raise exception 'SPLIT_INCOMPLETE' using errcode = 'P0001',
      detail = format('%s of %s live items assigned', v_assigned, v_live);
  end if;

  select * into v_totals from app.compute_tab_totals(p_tab_id);

  -- Each group's floor share of the whole bill, by its portion of the goods
  -- subtotal. A zero subtotal (everything discounted away, or a court-only
  -- tab) splits evenly instead of dividing by zero.
  with assign as (
    select (elem #>> '{}')::uuid as order_item_id, g.ord - 1 as grp
      from jsonb_array_elements(p_groups) with ordinality as g(items, ord),
           jsonb_array_elements(g.items) as elem
  ),
  per_group as (
    select a.grp, coalesce(sum(oi.line_total_iqd), 0) as grp_subtotal
      from assign a
      join order_items oi on oi.id = a.order_item_id
     group by a.grp
  ),
  filled as (
    select g.ord - 1 as grp, coalesce(pg.grp_subtotal, 0) as grp_subtotal
      from jsonb_array_elements(p_groups) with ordinality as g(items, ord)
      left join per_group pg on pg.grp = g.ord - 1
  ),
  shares as (
    -- The window has to resolve BEFORE the aggregate: array_agg over a window
    -- expression is a grouping error (42803), not a subtlety worth being clever
    -- about.
    select f.grp,
           floor(
             case when sum(f.grp_subtotal) over () > 0
                  then v_totals.total_iqd::numeric * f.grp_subtotal / sum(f.grp_subtotal) over ()
                  else v_totals.total_iqd::numeric / v_n
             end
           )::bigint as share
      from filled f
  )
  select array_agg(s.share order by s.grp) into v_amounts from shares s;

  -- Largest remainder: the rounding shortfall goes to the earliest groups, so
  -- the parts sum EXACTLY to the bill. Same discipline as app.split_evenly.
  select coalesce(sum(x), 0) into v_sum from unnest(v_amounts) x;
  v_remainder := v_totals.total_iqd - v_sum;
  i := 1;
  while v_remainder > 0 and i <= v_n loop
    v_amounts[i] := v_amounts[i] + 1;
    v_remainder := v_remainder - 1;
    i := i + 1;
  end loop;

  return v_amounts;
end $split_by_item_0382$;

revoke all on function app.split_by_item(uuid, jsonb) from public, anon;
grant execute on function app.split_by_item(uuid, jsonb) to authenticated;

create or replace function app.eligible_promotions(p_tab_id uuid, p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $eligible_promotions_0382$
declare
  v_tab      tabs%rowtype;
  v_court_id uuid;
  v_customer uuid;
  v_totals   record;
  v_gross    bigint;
  v_local    timestamp;
  v_dow      int;
  v_time     time;
  v_code     text := nullif(upper(btrim(p_code)), '');
  p          promotions%rowtype;
  v_base     bigint;
  v_amount   bigint;
  v_limit    bigint;
  v_out      jsonb := '[]'::jsonb;
  v_sorted   jsonb;
  v_room     bigint;    -- 0309 (c14)
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0382 (F-28): only staff of the tab's own branch read its bill.
  if not app.is_staff_at(v_tab.venue_id, 'cashier','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  if v_code is not null and not exists (select 1 from promotions x where x.public_code = v_code) then
    raise exception 'CODE_INVALID' using errcode = 'P0001', detail = v_code;
  end if;

  if v_tab.reservation_id is not null then
    select r.court_id into v_court_id
      from reservations r where r.id = v_tab.reservation_id;
  end if;

  -- 0306 (loyalty): the customer is app.tab_customer (the attached guest, the
  -- booking's guest, or a linked café session's profile).
  v_customer := app.tab_customer(p_tab_id);

  -- Gross = goods subtotal + court fee (what the guest is spending before any
  -- discount). The discount BASE is narrower (goods only; see promotion_base_iqd).
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_gross := coalesce(v_totals.subtotal_iqd, 0) + coalesce(v_totals.court_iqd, 0);

  -- 0309 (c14): what the other discounts leave of the goods.
  v_room := app.promotion_room_iqd(p_tab_id);

  v_local := now() at time zone coalesce((select vs.timezone from venue_settings vs
                                            where vs.venue_id = v_tab.venue_id), 'Asia/Baghdad');
  v_dow   := extract(dow from v_local)::int;
  v_time  := v_local::time;

  for p in
    select pr.*
      from promotions pr
     where pr.enabled
       and (pr.venue_id is null or pr.venue_id = v_tab.venue_id)   -- 0212 (MV2)
       and (pr.starts_at is null or pr.starts_at <= now())
       and (pr.ends_at   is null or pr.ends_at   >  now())
       and (coalesce(array_length(pr.weekdays, 1), 0) = 0 or v_dow = any(pr.weekdays))
       and (pr.hour_from is null
            or (pr.hour_from < pr.hour_to and v_time >= pr.hour_from and v_time < pr.hour_to)
            or (pr.hour_from > pr.hour_to and (v_time >= pr.hour_from or v_time < pr.hour_to)))
       and (pr.auto or (v_code is not null and pr.public_code = v_code))
       and (jsonb_typeof(pr.scope->'courtIds') is distinct from 'array'
            or jsonb_array_length(pr.scope->'courtIds') = 0
            or (v_court_id is not null and (pr.scope->'courtIds') ? v_court_id::text))
     order by pr.created_at, pr.id
  loop
    -- Redemptions on OTHER tabs: this tab's own current promotion is about to
    -- be replaced by any apply, so it must never block a re-apply.
    if not p.auto and p.code_single_use and exists (
         select 1 from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) then
      continue;
    end if;

    v_limit := (p.limits->>'total')::bigint;
    if v_limit is not null and (
         select count(*) from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) >= v_limit then
      continue;
    end if;

    v_limit := (p.limits->>'perCustomer')::bigint;
    if v_limit is not null then
      -- A per-customer cap needs a customer: a tab with no identified guest
      -- cannot be counted, so it is not eligible (the strict reading).
      if v_customer is null then
        continue;
      end if;
      if (select count(*) from promotion_redemptions r
           where r.promotion_id = p.id and r.customer_id = v_customer and r.tab_id <> p_tab_id)
         >= v_limit then
        continue;
      end if;
    end if;

    -- 0309 (c6/c16): a tier promotion (limits.tierMin, a tier id) needs
    -- loyalty on, a customer, and the customer's tier at least that one by
    -- points (app.promotion_tier_ok).
    if not app.promotion_tier_ok(p.limits, v_customer) then
      continue;
    end if;

    v_limit := (p.limits->>'minSpendIqd')::bigint;
    if v_limit is not null and v_gross < v_limit then
      continue;
    end if;

    v_base   := app.promotion_base_iqd(p_tab_id, p.scope);
    v_amount := least(app.promotion_amount_iqd(v_base, p.type, p.value), v_room);   -- 0309 (c14)
    if v_amount < 1 then
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'promotionId', p.id,
      'name_en',     p.name_en,
      'name_ar',     p.name_ar,
      'type',        p.type,
      'value',       p.value,
      'amountIqd',   v_amount);
  end loop;

  select coalesce(jsonb_agg(t.e order by (t.e->>'amountIqd')::bigint desc, t.ord), '[]'::jsonb)
    into v_sorted
    from jsonb_array_elements(v_out) with ordinality as t(e, ord);
  return v_sorted;
end $eligible_promotions_0382$;

revoke all on function app.eligible_promotions(uuid, text) from public, anon;
grant execute on function app.eligible_promotions(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Staff requests: a manager sees and decides their own branches' people.
-- ---------------------------------------------------------------------------
create or replace function app.shares_branch_with(p_staff_id uuid) returns boolean
language sql stable security definer set search_path = public as $shares_branch_with_0382$
  select case
    when auth.uid() is null or p_staff_id is null then false
    when app.is_staff('owner') then true
    else exists (select 1
                   from staff_venues mine
                   join staff_venues theirs on theirs.venue_id = mine.venue_id
                   join venues v on v.id = mine.venue_id and v.status <> 'closed'
                  where mine.staff_id = auth.uid()
                    and theirs.staff_id = p_staff_id)
  end
$shares_branch_with_0382$;

comment on function app.shares_branch_with(uuid) is
  '0382 (F-28). True when the caller is the owner, or works at a branch (not closed) where p_staff_id also works. Read by staff_requests_page, the staff_requests_read_mgmt policy and the staff_requests_branch_guard trigger.';

revoke all on function app.shares_branch_with(uuid) from public;
grant execute on function app.shares_branch_with(uuid) to anon, authenticated, service_role;

drop policy if exists staff_requests_read_mgmt on public.staff_requests;
create policy staff_requests_read_mgmt on public.staff_requests as permissive for select to authenticated
  using ((select app.is_staff('manager','owner')) and app.shares_branch_with(staff_id));

create or replace function app.staff_requests_page(
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $staff_requests_page_0382$
declare
  v_rows   jsonb;
  v_total  bigint;
  v_status staff_request_status;
  v_lim    int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off    int := greatest(coalesce(p_offset, 0), 0);
  v_mgmt   boolean := app.is_staff('manager','owner');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_status is not null then
    begin
      v_status := p_status::staff_request_status;
    exception when invalid_text_representation then
      raise exception 'BAD_STATUS' using errcode = 'P0001';
    end;
  end if;

  -- Management sees the venue; everyone else sees their own asks. Same
  -- function either way, so a non-manager cannot reach the queue by guessing
  -- an argument. 0382 (F-28): a manager sees the asks of the people who work
  -- at one of their branches (app.shares_branch_with); the owner sees all.
  with visible as (
    select r.*
      from staff_requests r
     where (r.staff_id = auth.uid()
            or (v_mgmt and app.shares_branch_with(r.staff_id)))
       and (v_status is null or r.status = v_status)
  )
  select
    -- `pending_first` is a sort key, not a field: strip it so the client sees
    -- exactly the row it is meant to render.
    coalesce(jsonb_agg(to_jsonb(x) - 'pending_first' order by x.pending_first, x.created_at desc), '[]'::jsonb),
    (select count(*) from visible)
  into v_rows, v_total
  from (
    select v.id, v.kind, v.status, v.from_date, v.to_date, v.amount_iqd, v.note,
           v.created_at, v.decided_at, v.decision_note,
           v.staff_id,
           s.display_name  as staff_name,
           s.role::text    as staff_role,
           d.display_name  as decided_by_name,
           (v.status <> 'pending') as pending_first
      from visible v
      join staff s on s.id = v.staff_id
      left join staff d on d.id = v.decided_by
     order by (v.status <> 'pending'), v.created_at desc
     limit v_lim offset v_off
  ) x;

  return jsonb_build_object(
    'requests', v_rows,
    'total',    v_total,
    'pending',  (select count(*) from staff_requests r
                  where r.status = 'pending'
                    and (r.staff_id = auth.uid()
                         or (v_mgmt and app.shares_branch_with(r.staff_id)))));
end $staff_requests_page_0382$;

revoke all on function app.staff_requests_page(text, int, int) from public, anon;
grant execute on function app.staff_requests_page(text, int, int) to authenticated;

-- A decision (pending -> approved | declined) by anyone but the asker must
-- come from someone who shares a branch with the asker. Service-role and cron
-- writes (no auth.uid()) and the asker's own withdraw pass.
create or replace function app.trg_staff_requests_branch_guard() returns trigger
language plpgsql security definer set search_path = public as $trg_staff_requests_branch_guard_0382$
begin
  if auth.uid() is not null
     and new.status is distinct from old.status
     and auth.uid() is distinct from old.staff_id
     and not app.shares_branch_with(old.staff_id) then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  return new;
end $trg_staff_requests_branch_guard_0382$;

revoke all on function app.trg_staff_requests_branch_guard() from public, anon, authenticated;

drop trigger if exists staff_requests_branch_guard on public.staff_requests;
create trigger staff_requests_branch_guard before update on public.staff_requests
  for each row execute function app.trg_staff_requests_branch_guard();
