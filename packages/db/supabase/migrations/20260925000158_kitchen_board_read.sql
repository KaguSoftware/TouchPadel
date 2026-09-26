set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0158 kitchen_board_read — app.kitchen_board, the kitchen board's money-free read
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.23, plan #60).
-- Depends on nothing.
--
-- The board read `tickets` with orders, the tab and the order lines embedded
-- (op/features/kds/ticketView.ts TICKET_SELECT), so every kitchen role held
-- the four order-side read policies, and with them the priced columns the
-- client grants expose (0015:1338: total_iqd, unit_price_iqd,
-- line_total_iqd, cost_iqd). The bar and kitchen roles sign in on their own
-- phones (#10, #27), and a session that reads order_items can count any
-- item's sales, which #54 closes everywhere else.
--
-- This function returns exactly what the board renders, in the TICKET_SELECT
-- shape (same keys and nesting), so ticketView.ts and TicketList render it
-- unchanged:
--   * the venue's tickets that are queued, preparing or ready, plus those
--     completed in the last two minutes (the board's own linger,
--     COMPLETED_LINGER_MS). The window is fixed here and takes no argument:
--     the guard admits a bar or kitchen phone, and a wider window would let
--     that session read every completed ticket's lines;
--   * no money anywhere: no price, total, discount or cost column;
--   * `reservation` only for cashier, manager and owner, the roles whose own
--     policy reads that booking today (0136:211, 0136:223); the bar and
--     kitchen family and prep got null through the embed and still do.
--
-- The guard is the kitchen list of tickets_staff_read and set_ticket_status
-- (0156:605, 0156:788). A venue named is that venue only; none named is every
-- venue the caller works at, which is what tickets_staff_read gave the board
-- (0156:788). Not app.current_venue(): the operator asserts no station on this
-- read, so for the owner (no staff_venues rows) and for anyone with two
-- memberships it raises VENUE_REQUIRED as soon as a second venue is active.
--
-- kitchen_money_reads, a later file, then takes the bar and kitchen family
-- and prep off the four order-side read policies. Nothing else changes: the
-- LAN board has no database read, and the kds topic carries ids and statuses.
-- ===========================================================================

create or replace function app.kitchen_board(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $kitchen_board_0158$
declare
  v_venues   uuid[];
  v_bookings boolean;
  v_tickets  jsonb;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is null then
    -- The old tickets_staff_read venue axis: the owner's active venues, anyone
    -- else's active memberships.
    v_venues := app.staff_venue_ids();
  elsif app.is_staff_at(p_venue_id, 'prep','cashier','manager','owner',
                        'head_barista','barista','head_chef','chef') then
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
end $kitchen_board_0158$;

comment on function app.kitchen_board(uuid) is
  'kitchen_board_read (build-contracts §2.23, plan #60): the kitchen board''s tickets at the venue '
  'named, or with none at every venue the caller works at (app.staff_venue_ids(), the old '
  'tickets_staff_read axis), in the shape the board renders: live tickets and those '
  'completed in the last two minutes, a window fixed here; order, tab tag, lines, add-ons, notes '
  'and ready marks; no price, total or cost. The booking is filled for cashier, manager and owner '
  'only. Kitchen list of set_ticket_status at the venue; FORBIDDEN otherwise.';

revoke all on function app.kitchen_board(uuid) from public, anon;
grant execute on function app.kitchen_board(uuid) to authenticated;
