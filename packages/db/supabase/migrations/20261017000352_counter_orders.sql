-- 0352 counter_orders — order first, the table after (Majed 2026-10-17:
-- "after placing the order only will they attach a table to that order").
--
-- Until now a café tab was opened ON a seat (0084: a table or a booking, a
-- name alone was TAB_ANCHOR_REQUIRED), and where an order went was the tab's
-- seat. Majed's calls: the order goes first at the counter, with no table; the
-- table is attached to the ORDER, not the tab, at any time after it was
-- placed, and nothing prompts for it. So:
--
--   1. app.open_tab opens a café tab with no table and no booking: a counter
--      tab. Its label is the name the cashier typed, or with none "#<n>", the
--      n-th counter tab of the day (two tills opening at the same instant can
--      share a number; the label is a name to call, not a key). A table or a
--      booking is still accepted (the guest's QR order, the waiter's phone and
--      a booking's court bill all open on a seat, unchanged).
--   2. orders.deliver_table_id / orders.deliver_reservation_id: where THIS
--      order is brought, at most one, and only on a deliver order
--      (orders_deliver_spot). Null on a deliver order means "the tab's own
--      seat" (a table tab, a booking's court), or on a counter tab "no table
--      yet".
--   3. app.order_set_delivery(p_order_id, p_service, p_table_id,
--      p_reservation_id): pick up, or bring it (to a table, to a booking's
--      court, or nowhere yet). Cashier, manager and owner at the order's
--      branch, while the order is live (not voided or served: ORDER_NOT_FOUND)
--      on a tab still open or awaiting payment (TAB_NOT_OPEN). The table must
--      be active at that branch (TABLE_NOT_FOUND); the booking at that branch,
--      a booking or a lesson, confirmed or arrived (RESERVATION_NOT_FOUND,
--      RESERVATION_NOT_LIVE). Both, or a spot on pick up: INVALID_ARGUMENT.
--      Audited order.delivery. The order's ticket is re-announced on the
--      branch's kds topic (ticket_status, the 0224 payload) so every board
--      reads the new spot at once. Online only: not a queued type.
--   4. app.kitchen_board adds order.deliver_table {table_number} and
--      order.deliver_court {name_en, name_ar}.
--
-- send_order_slip (0240) keeps its own TAB_ANCHOR_REQUIRED: a scanned slip is
-- sent to a table it names, which is a separate flow.
-- Lock order: orders FOR UPDATE only (order_set_delivery); open_tab unchanged.
-- covered by packages/db/tests/counter-orders.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Where an order is brought
-- ---------------------------------------------------------------------------
-- Constraints NOT VALID, then validated (the repo's two-step: a brief lock,
-- then a scan under SHARE UPDATE EXCLUSIVE). Every existing row has both
-- columns null, so the scan finds nothing. No index: nothing looks an order
-- up by its spot (the floor and the board read through the tab and the order).
alter table orders
  add column deliver_table_id       uuid,
  add column deliver_reservation_id uuid;
alter table orders
  add constraint orders_deliver_table_id_fkey foreign key (deliver_table_id) references cafe_tables(id) not valid;
alter table orders
  add constraint orders_deliver_reservation_id_fkey foreign key (deliver_reservation_id) references reservations(id) not valid;
alter table orders
  add constraint orders_deliver_spot check (
    num_nonnulls(deliver_table_id, deliver_reservation_id) <= 1
    and (service = 'deliver' or (deliver_table_id is null and deliver_reservation_id is null))
  ) not valid;
alter table orders validate constraint orders_deliver_table_id_fkey;
alter table orders validate constraint orders_deliver_reservation_id_fkey;
alter table orders validate constraint orders_deliver_spot;

comment on column orders.deliver_table_id is
  '0352: the table this deliver order is brought to, attached after it was placed (app.order_set_delivery).';
comment on column orders.deliver_reservation_id is
  '0352: the booking whose court this deliver order is brought to (app.order_set_delivery).';

-- ---------------------------------------------------------------------------
-- 2. app.open_tab — re-issued from 20261001000280_lesson_reservation_guards.sql
--    with the counter tab.
-- ---------------------------------------------------------------------------
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null,
  p_kind            text default 'cafe'
) returns jsonb
language plpgsql security definer set search_path = public as $open_tab_0352$
declare
  v_venue uuid;
  v_day        uuid;
  v_row        tabs%rowtype;
  v_label      text := nullif(btrim(p_label), '');
  v_status     reservation_status;
  v_live       uuid;
  v_constraint text;
  v_kind       text := coalesce(p_kind, 'cafe');
  v_lesson     uuid;   -- 0280
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the table or booking's branch decides the day, the rows written and who may act.
  v_venue := coalesce((select t.venue_id from cafe_tables t where t.id = p_table_id),
                     (select r.venue_id from reservations r where r.id = p_reservation_id));
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if v_kind not in ('cafe','shop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;
  -- 0244: the kind decides who may open it (shop_staff shop only, the café
  -- staff café only), and a shop sale is paid on the spot: no table, no booking.
  perform app.assert_tab_kind_role(v_kind);
  if v_kind = 'shop' and (p_table_id is not null or p_reservation_id is not null) then
    raise exception 'SHOP_TAB_NO_ANCHOR' using errcode = 'P0001',
      hint = 'a shop sale is paid at the shop desk; it never goes on a table or a booking';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from tabs where idempotency_key = p_idempotency_key;
    if found then
      if v_row.opened_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another tab';
      end if;
      return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null then
    select status, lesson_id into v_status, v_lesson from reservations where id = p_reservation_id;
    if not found then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- 0280 (db.md §4.5.3): a lesson is paid on its own bill (lesson_settle),
    -- never on a tab opened against its court row.
    if v_lesson is not null then
      raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'tab',
        hint = 'a lesson is paid from its lesson screen';
    end if;
    -- 0106: a booking that has ended without being played owes nothing; a tab
    -- opened against it is a mistake the day close would have to clean up.
    if v_status in ('cancelled','no_show','expired') then
      raise exception 'RESERVATION_NOT_LIVE' using errcode = 'P0001', detail = v_status::text;
    end if;
    -- 0106 (D1): friendly refusal. NOT serialised — two concurrent opens both
    -- pass it; tabs_one_live_per_reservation is the guard, mapped below.
    select id into v_live from tabs
     where reservation_id = p_reservation_id
       and status in ('open','awaiting_payment')
     limit 1;
    if v_live is not null then
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = v_live::text,
        hint = 'this booking already has an open bill; add to that one';
    end if;
  end if;
  if p_table_id is null and p_reservation_id is null then
    -- 0145: a shop counter sale's label is what the till and the day close show for it.
    if v_kind = 'shop' then
      if v_label is null then
        raise exception 'LABEL_REQUIRED' using errcode = 'P0001',
          hint = 'a counter sale needs a name or a number';
      end if;
    -- 0352: a café counter tab (order first, the table after). With no name,
    -- the day's next counter number, so the board and the pass can call it.
    elsif v_label is null then
      v_label := '#' || (1 + (select count(*) from tabs
                               where day_session_id = v_day
                                 and kind = 'cafe'
                                 and table_id is null
                                 and reservation_id is null))::text;
    end if;
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key, kind)
    values (v_day, p_table_id, p_reservation_id, v_label,
            auth.uid(), p_device_id, p_idempotency_key, v_kind)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tabs_one_live_per_reservation' then
      select id into v_live from tabs
       where reservation_id = p_reservation_id
         and status in ('open','awaiting_payment')
       limit 1;
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = coalesce(v_live::text, ''),
        hint = 'this booking already has an open bill; add to that one';
    end if;
    if p_idempotency_key is not null then
      select * into v_row from tabs where idempotency_key = p_idempotency_key;
      if found then
        if v_row.opened_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another tab';
        end if;
        return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
      end if;
    end if;
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id, 'label', v_row.label);
end $open_tab_0352$;

comment on function app.open_tab(uuid, text, uuid, text, text, text) is
  '0106, 0145, 0217, 0244, 0280, 0352. Opens a staff tab at the branch of its table or booking (VENUE_MISMATCH elsewhere), or with neither at the caller''s branch: kind cafe (cashier, court_desk, manager, owner) on a table, a booking, or since 0352 neither (a counter tab: order first, the table attached to each order after, app.order_set_delivery; labelled with the name given or "#<n>", the day''s n-th counter tab), or shop (shop_staff, manager, owner; no anchor, a label, SHOP_TAB_NO_ANCHOR, LABEL_REQUIRED); any other p_kind is INVALID_ARGUMENT. A booking takes at most one live tab (BOOKING_TAB_OPEN, detail = that tab id) and an ended booking none (RESERVATION_NOT_LIVE). NO_OPEN_DAY, TABLE_NOT_FOUND, RESERVATION_NOT_FOUND, IDEMPOTENCY_CONFLICT. 0280: a tab against a lesson''s court row is refused LESSON_VIA_COACHING detail tab: a lesson is paid on its own kind lesson tab (lesson_settle). Returns {duplicate, tab_id, label}.';

-- ---------------------------------------------------------------------------
-- 3. app.order_set_delivery
-- ---------------------------------------------------------------------------
create function app.order_set_delivery(
  p_order_id       uuid,
  p_service        text,
  p_table_id       uuid default null,
  p_reservation_id uuid default null,
  p_device_id      text default null
) returns jsonb
language plpgsql security definer set search_path = public as $order_set_delivery_0352$
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
  -- payload, unchanged, on the branch's topic and the literal one.
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
        'ticket_status', 'kds', true);
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
end $order_set_delivery_0352$;

comment on function app.order_set_delivery(uuid, text, uuid, uuid, text) is
  '0352 (order first, the table after). Cashier, manager and owner at the order''s branch: sets how one order reaches the guest, at any time after it was placed: p_service pickup (no spot), or deliver to p_table_id (an active table of the branch, TABLE_NOT_FOUND), to p_reservation_id''s court (a booking or lesson of the branch, RESERVATION_NOT_FOUND; confirmed or arrived, RESERVATION_NOT_LIVE), or to neither (the tab''s own seat, or on a counter tab no table yet). INVALID_ARGUMENT hint service | one spot | a pick up has no spot. The order must be live (ORDER_NOT_FOUND for none, voided or served) on an open or awaiting-payment tab (TAB_NOT_OPEN). Re-announces its ticket on kds (ticket_status). Returns {order_id, service, deliver_table_id, deliver_reservation_id}. Audit order.delivery.';

revoke all on function app.order_set_delivery(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function app.order_set_delivery(uuid, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.kitchen_board — re-issued from 20261017000351_order_service.sql
--    with order.deliver_table and order.deliver_court.
-- ---------------------------------------------------------------------------
create or replace function app.kitchen_board(p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $kitchen_board_0352$
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
               -- 0352: where this order is brought, when attached to it.
               'deliver_table', (select jsonb_build_object('table_number', ct.table_number)
                                   from cafe_tables ct where ct.id = o.deliver_table_id),
               'deliver_court', (select jsonb_build_object('name_en', c.name_en, 'name_ar', c.name_ar)
                                   from reservations r join courts c on c.id = r.court_id
                                  where r.id = o.deliver_reservation_id),
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
end $kitchen_board_0352$;

comment on function app.kitchen_board(uuid) is
  'kitchen_board_read (build-contracts §2.23, plan #60): the kitchen board''s tickets at the venue '
  'named, or with none at every venue the caller works at (app.visible_venue_ids()), in the shape '
  'the board renders: live tickets and those completed in the last two minutes, a window fixed '
  'here; order (with its service, deliver | pickup, 0351, and the table or court it is brought to '
  'when one was attached to it, deliver_table and deliver_court, 0352), tab tag (table, and for a '
  'booking''s tab its court''s name, 0351), lines, add-ons, notes and ready marks; no price, total '
  'or cost. The booking is filled for cashier, manager and owner only. Kitchen list of '
  'set_ticket_status at the venue; FORBIDDEN otherwise.';

revoke all on function app.kitchen_board(uuid) from public, anon;
grant execute on function app.kitchen_board(uuid) to authenticated;
