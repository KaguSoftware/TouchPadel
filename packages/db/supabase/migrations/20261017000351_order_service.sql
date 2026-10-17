-- 0351 order_service — the till decides whether an order is picked up or
-- brought to the guest's spot (Majed 2026-10-17: "the staff can decide
-- whether an order is pick up or on the slot or delivery").
--
--   1. orders.service (new enum order_service: deliver | pickup), not null,
--      default 'deliver'. Every existing order and every path that does not
--      choose (the guest web order, the waiter's place_floor_order, a loyalty
--      reward's added item) keeps what it always meant: brought to the table
--      or court the tab is on.
--   2. app.till_add_items takes p_service ('deliver' | 'pickup', else
--      INVALID_ARGUMENT hint service). Left out (an older till, a queued
--      envelope written before this), the tab decides: 'deliver' on a table
--      or a booking, 'pickup' on a tab with neither (a by-name tab, a shop
--      sale). A duplicate key returns the first call's order unchanged.
--      Signature change: dropped by its old signature, re-granted.
--   3. app.kitchen_board adds order.service, and tab.court {name_en, name_ar}
--      for a booking's tab, for every kitchen-list role: a runner needs the
--      court to bring the order to, and the court's name is not the guest
--      (the booking itself stays cashier and MGMT only, as before).
--
-- Lock order unchanged (day_sessions -> tabs -> orders -> order_items ->
-- tickets). covered by packages/db/tests/kitchen-board.test.ts ("order
-- service (0351)").

set lock_timeout = '3s';
set statement_timeout = '60s';

create type order_service as enum ('deliver', 'pickup');

alter table orders
  add column service order_service not null default 'deliver';

comment on column orders.service is
  '0351: deliver = brought to the tab''s table or court; pickup = the guest collects it at the counter. '
  'Chosen at the till (app.till_add_items p_service); every other path takes the default.';

-- ---------------------------------------------------------------------------
-- 1. app.till_add_items — re-issued from 20260927000244_shop_desk_access.sql
--    with p_service.
-- ---------------------------------------------------------------------------
drop function app.till_add_items(uuid, jsonb, text, text);

create function app.till_add_items(
  p_tab_id          uuid,
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null,
  p_service         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $till_add_items_0351$
declare
  v_venue   uuid;
  v_tab     tabs%rowtype;
  v_order   orders%rowtype;
  v_ticket  tickets%rowtype;
  v_total   bigint;
  v_day     uuid;
  v_oi      record;
  v_service order_service;
begin
  if not app.is_staff('cashier','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  -- 0351: checked before anything is read or locked.
  if p_service is not null and p_service not in ('deliver','pickup') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'service';
  end if;

  if p_idempotency_key is not null then
    select * into v_order from orders where idempotency_key = p_idempotency_key;
    if found then
      if v_order.placed_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another order';
      end if;
      select * into v_ticket from tickets where order_id = v_order.id;
      return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
        'ticket_id', v_ticket.id, 'status', v_order.status, 'service', v_order.service);
    end if;
  end if;

  v_day := app.current_open_day_locked();      -- 0038 (#6): lock BEFORE the tab
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001',
      detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_tab.day_session_id is distinct from v_day then
    raise exception 'DAY_CLOSED' using errcode = 'P0001',
      hint = 'this tab belongs to a day that is no longer open';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244

  -- 0351: not chosen, the tab decides: a spot to bring it to, or the counter.
  v_service := coalesce(p_service::order_service,
                        case when v_tab.table_id is not null or v_tab.reservation_id is not null
                             then 'deliver' else 'pickup' end::order_service);

  begin
    insert into orders (tab_id, source, placed_by_staff_id, device_id, idempotency_key, service)
    values (v_tab.id, 'till', auth.uid(), p_device_id, p_idempotency_key, v_service)
    returning * into v_order;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_order from orders where idempotency_key = p_idempotency_key;
      if found then
        if v_order.placed_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another order';
        end if;
        select * into v_ticket from tickets where order_id = v_order.id;
        return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
          'ticket_id', v_ticket.id, 'status', v_order.status, 'service', v_order.service);
      end if;
    end if;
    raise;
  end;

  v_total := app.add_order_items(v_order.id, p_items);

  -- 0146: a shop order (every line in a kind = 'shop' section; the
  -- order_items trigger refuses a mixed one) makes no kitchen ticket. Stock is
  -- taken here, line by line, through the same idempotent driver the ticket
  -- trigger uses, and the order is served on the spot.
  if app.order_is_shop(v_order.id) then
    for v_oi in select id from order_items where order_id = v_order.id and not voided loop
      perform app.consume_for_order_item(v_oi.id, null);
    end loop;
    update orders set status = 'served' where id = v_order.id;
    return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
      'tab_id', v_tab.id, 'ticket_id', null, 'total_iqd', v_total, 'kind', 'shop',
      'service', v_order.service);
  end if;

  insert into tickets (order_id, device_id)
  values (v_order.id, p_device_id)
  returning * into v_ticket;

  -- STOCK HOOK (0018): consumption wired here too.

  return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
    'tab_id', v_tab.id, 'ticket_id', v_ticket.id, 'total_iqd', v_total,
    'service', v_order.service);
end $till_add_items_0351$;

comment on function app.till_add_items(uuid, jsonb, text, text, text) is
  'The till''s order (0015; 0146 shop orders, 0217 branch guard, 0244 tab kind, 0351 service). '
  'Cashier, shop_staff, manager and owner at the tab''s branch: adds p_items to the open tab of the '
  'open day as one order (source till) and its kitchen ticket, or for a shop order no ticket and '
  'served on the spot. p_service deliver | pickup (INVALID_ARGUMENT hint service); left out, deliver '
  'on a table or booking tab and pickup otherwise. Idempotent by key. Returns {duplicate, order_id, '
  'tab_id, ticket_id, total_iqd, service}. FORBIDDEN, VENUE_MISMATCH, NO_OPEN_DAY, TAB_NOT_FOUND, '
  'TAB_MERGED, TAB_NOT_OPEN, DAY_CLOSED, IDEMPOTENCY_CONFLICT and add_order_items''s refusals.';

revoke all on function app.till_add_items(uuid, jsonb, text, text, text) from public, anon;
grant execute on function app.till_add_items(uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.kitchen_board — re-issued from 20260926000231_branch_scoped_reads.sql
--    with order.service and tab.court.
-- ---------------------------------------------------------------------------
create or replace function app.kitchen_board(p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $kitchen_board_0351$
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
               'id',      o.id,
               'source',  o.source,
               'status',  o.status,
               'service', o.service,                                  -- 0351
               'tab', (select jsonb_build_object(
                                'id',    tb.id,
                                'label', tb.label,
                                'table', (select jsonb_build_object('table_number', ct.table_number)
                                            from cafe_tables ct where ct.id = tb.table_id),
                                'reservation', case when v_bookings then
                                                 (select jsonb_build_object('id', r.id, 'guest_name', r.guest_name)
                                                    from reservations r where r.id = tb.reservation_id)
                                               end,
                                -- 0351: where to bring it, for every board role.
                                'court', (select jsonb_build_object('name_en', c.name_en, 'name_ar', c.name_ar)
                                            from reservations r join courts c on c.id = r.court_id
                                           where r.id = tb.reservation_id))
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
end $kitchen_board_0351$;

comment on function app.kitchen_board(uuid) is
  'kitchen_board_read (build-contracts §2.23, plan #60): the kitchen board''s tickets at the venue '
  'named, or with none at every venue the caller works at (app.visible_venue_ids()), in the shape '
  'the board renders: live tickets and those completed in the last two minutes, a window fixed '
  'here; order (with its service, deliver | pickup, 0351), tab tag (table, and for a booking''s tab '
  'its court''s name, 0351), lines, add-ons, notes and ready marks; no price, total or cost. The '
  'booking is filled for cashier, manager and owner only. Kitchen list of set_ticket_status at the '
  'venue; FORBIDDEN otherwise.';

revoke all on function app.kitchen_board(uuid) from public, anon;
grant execute on function app.kitchen_board(uuid) to authenticated;
