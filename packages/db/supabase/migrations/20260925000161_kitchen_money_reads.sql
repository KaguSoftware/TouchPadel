set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0161 kitchen_money_reads — the bar and kitchen family and prep stop reading tabs,
-- orders and order lines directly (docs/design/protocols/
-- build-contracts-2026-09-23.md §2.23, plan #60).
--
-- Depends on kitchen_board_read (app.kitchen_board) and, by commit order, on
-- the board commit that reads through it and on G's send-push commit (§1.1):
-- a board still reading `tickets` with embedded orders would show every
-- ticket without its lines once this lands, so it reaches hosted only after
-- the operator that reads through app.kitchen_board is on every kitchen
-- machine (§1.6 step 3).
--
-- The four order-side read policies, re-issued from their latest bodies
-- (0157:36-61):
--   * the role list goes back to the pre-0156 five without prep: cashier,
--     court_desk, manager and owner read exactly as they do today.
--     head_barista, barista, head_chef, chef and prep lose all four; their
--     only reader was the kitchen board, which now reads the money-free
--     app.kitchen_board. They keep tickets_staff_read, set_ticket_status,
--     set_order_item_ready and the kds topic;
--   * order_items and order_item_modifiers gain the venue conjunct 0136 gave
--     tabs and orders, as an inline exists on the parent rather than a
--     definer helper: every policy on a table is planned for every caller, so
--     a helper would need EXECUTE for guests too (the 0106 and 0136 reason).
--     For these four roles the nested orders policy is a pass-through.
--
-- Untouched: the guests' own-session policies (*_guest_read, 0015:1349-1372),
-- tickets_staff_read, and the grants (0015:1338); the policies are the wall.
-- No index or constraint is added.
-- ===========================================================================

-- tabs (0157:37)
drop policy if exists tabs_staff_read on tabs;
create policy tabs_staff_read on tabs for select to authenticated
  using (app.is_staff('cashier','court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- orders (0157:44)
drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (app.is_staff('cashier','court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- order_items (0157:51) + the venue conjunct through its order
drop policy if exists order_items_staff_read on order_items;
create policy order_items_staff_read on order_items for select to authenticated
  using (app.is_staff('cashier','court_desk','manager','owner')
         and exists (select 1 from orders o
                      where o.id = order_items.order_id
                        and o.venue_id = any(app.staff_venue_ids())));

-- order_item_modifiers (0157:57) + the venue conjunct through its line's order
drop policy if exists order_item_modifiers_staff_read on order_item_modifiers;
create policy order_item_modifiers_staff_read on order_item_modifiers
  for select to authenticated
  using (app.is_staff('cashier','court_desk','manager','owner')
         and exists (select 1 from order_items oi
                       join orders o on o.id = oi.order_id
                      where oi.id = order_item_modifiers.order_item_id
                        and o.venue_id = any(app.staff_venue_ids())));
