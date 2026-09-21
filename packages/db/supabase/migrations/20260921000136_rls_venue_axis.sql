-- ===========================================================================
-- 0136 — RLS gains a venue axis: a staff read is scoped to the venues the
-- reader actually works at.
--
-- Until now every staff-read policy asked one question — "is the caller a
-- cashier / manager / owner?" — and a yes returned the whole table. With one
-- venue that is the right answer. With two it means the manager at Karrada
-- reads the other site's payments, audit trail, stock and bookings, and the
-- cashier there sees a till list that is half somebody else's.
--
-- Every policy below is the LATEST definition of itself, copied verbatim from
-- the file named beside it, with one conjunct added:
--
--     and venue_id = any(app.staff_venue_ids())
--
-- Same policy name, same roles, same predicate otherwise. app.staff_venue_ids()
-- (0123) answers with every active venue for an owner and the caller's active
-- memberships for everybody else, so an owner's reads are bit-identical to
-- today and a single-venue install is bit-identical for everyone. It is granted
-- to anon, authenticated AND service_role, because a function named in a policy
-- is evaluated as the READING role and the anon branch of the Shape C policies
-- below reaches it — the 0121 trap, one file earlier in its own history.
--
-- THREE SHAPES.
--   A. `using (app.is_staff(...))` — the conjunct is appended to the whole
--      predicate. 26 policies.
--   B. reservations_cashier_read (0106:1047) — a role test AND a time-or-tab
--      test. The conjunct is appended to the whole predicate, so the nested
--      EXISTS on tabs is untouched; it is a pass-through for a cashier who
--      already reads every tab.
--   C. `using (is_active or app.is_staff(...))` — guest-readable catalogue
--      tables. ONLY THE STAFF DISJUNCT gains the clause:
--          using (is_active or (app.is_staff(...) and venue_id = any(...)))
--      Putting it outside the parenthesis would hide every active court and
--      menu item from the anon guest surface, which is the one thing slice 1
--      promised not to break.
--
-- KNOWN GAP, CLOSED IN SLICE 4. Shape C leaves the `is_active` branch open, so
-- a manager at venue A can still read an ACTIVE court, rate rule, tax group,
-- menu category or menu item belonging to venue B — by reading it the way a
-- guest does. Nothing in the product shows them that (every screen lists by
-- the venue it is looking at), no money or guest data is behind it, and the
-- alternative today is to break the pre-identity guest menu. Slice 4 gives the
-- guest surface a venue of its own (a table token and a station both name one)
-- and the branch becomes `is_active and venue_id = <the guest's venue>`.
--
-- UNTOUCHED, deliberately: every *_guest_read and *_read_own policy (they are
-- already scoped by ownership, and a guest has no staff_venues row); every leaf
-- table that derives its venue through its parent's policy (order_items,
-- refund_items, rate_rule_prices, …); every `using (true)` table; the global
-- tables (profiles, staff, allergens, promotions, telegram_*, …);
-- venue_settings_staff_read and cafe_settings_staff_read (both move in slice 2
-- with the platform_settings split); the owner-only analytics_* and assistant_*
-- policies (an owner reads every venue anyway); and realtime.messages, whose
-- topic regex is a slice-4 change (SEC-28).
--
-- Every pair is `drop policy if exists` + `create policy`, so the file is
-- re-runnable and check-migrations' unpaired-drop-policy rule stays quiet.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Shape A — bare role tests. Source file:line beside each.
-- ---------------------------------------------------------------------------

-- audit_log (0005:65). The policy is named audit_log_select_mgmt, not
-- audit_log_staff_read.
drop policy if exists audit_log_select_mgmt on audit_log;
create policy audit_log_select_mgmt on audit_log for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- cafe_tables (0014:364)
drop policy if exists cafe_tables_staff_read on cafe_tables;
create policy cafe_tables_staff_read on cafe_tables for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- guest_sessions (0014:370)
drop policy if exists guest_sessions_staff_read on guest_sessions;
create policy guest_sessions_staff_read on guest_sessions for select to authenticated
  using (app.is_staff('cashier','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- day_sessions (latest 0106:1034, not the 0015 original)
drop policy if exists day_sessions_staff_read on day_sessions;
create policy day_sessions_staff_read on day_sessions for select to authenticated
  using (app.is_staff('cashier','court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- tabs (0015:1351)
drop policy if exists tabs_staff_read on tabs;
create policy tabs_staff_read on tabs for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- orders (0015:1357)
drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- tickets (0015:1377)
drop policy if exists tickets_staff_read on tickets;
create policy tickets_staff_read on tickets for select to authenticated
  using (app.is_staff('prep','cashier','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- payments (0015:1383)
drop policy if exists payments_staff_read on payments;
create policy payments_staff_read on payments for select to authenticated
  using (app.is_staff('cashier','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- refunds (0015:1385)
drop policy if exists refunds_staff_read on refunds;
create policy refunds_staff_read on refunds for select to authenticated
  using (app.is_staff('cashier','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- waiter_calls (0016:156)
drop policy if exists waiter_calls_staff_read on waiter_calls;
create policy waiter_calls_staff_read on waiter_calls for select to authenticated
  using (app.is_staff('cashier','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- ingredients (0017:217)
drop policy if exists ingredients_mgmt_read on ingredients;
create policy ingredients_mgmt_read on ingredients for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- deliveries (0017:219)
drop policy if exists deliveries_mgmt_read on deliveries;
create policy deliveries_mgmt_read on deliveries for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- stock_batches (0017:221)
drop policy if exists stock_batches_mgmt_read on stock_batches;
create policy stock_batches_mgmt_read on stock_batches for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- stock_movements (0018:542)
drop policy if exists stock_movements_mgmt_read on stock_movements;
create policy stock_movements_mgmt_read on stock_movements for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- manager_alerts (0018:544)
drop policy if exists manager_alerts_mgmt_read on manager_alerts;
create policy manager_alerts_mgmt_read on manager_alerts for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- stock_counts (0019:300)
drop policy if exists stock_counts_mgmt_read on stock_counts;
create policy stock_counts_mgmt_read on stock_counts for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- device_heartbeats (0021:321)
drop policy if exists device_heartbeats_mgmt_read on device_heartbeats;
create policy device_heartbeats_mgmt_read on device_heartbeats for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- degraded_periods (0021:323)
drop policy if exists degraded_periods_mgmt_read on degraded_periods;
create policy degraded_periods_mgmt_read on degraded_periods for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- telegram_outbox (0032:124)
drop policy if exists telegram_outbox_mgmt_read on telegram_outbox;
create policy telegram_outbox_mgmt_read on telegram_outbox for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- telegram_actions (0032:126)
drop policy if exists telegram_actions_mgmt_read on telegram_actions;
create policy telegram_actions_mgmt_read on telegram_actions for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- reservation_series (0066:87)
drop policy if exists reservation_series_staff_read on reservation_series;
create policy reservation_series_staff_read on reservation_series for select to authenticated
  using (app.is_staff('court_desk','cashier','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- marketing_audiences (0073:136)
drop policy if exists marketing_audiences_read on marketing_audiences;
create policy marketing_audiences_read on marketing_audiences
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- marketing_campaigns (0073:140)
drop policy if exists marketing_campaigns_read on marketing_campaigns;
create policy marketing_campaigns_read on marketing_campaigns
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- station_staff (0105:212)
drop policy if exists station_staff_read_mgmt on station_staff;
create policy station_staff_read_mgmt on station_staff
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- staff_breaks (0105:255)
drop policy if exists staff_breaks_read_mgmt on staff_breaks;
create policy staff_breaks_read_mgmt on staff_breaks
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- reservations (0008:687)
drop policy if exists reservations_staff_read on reservations;
create policy reservations_staff_read on reservations for select to authenticated
  using (app.is_staff('court_desk','manager','owner')
         and venue_id = any(app.staff_venue_ids()));

-- ---------------------------------------------------------------------------
-- Shape B — the cashier's booking window (0106:1047). The inline EXISTS on
-- tabs stays exactly as 0106 wrote it, comment and all: it is an EXISTS rather
-- than a revoked definer helper because every policy on a table is planned for
-- every caller, and a guest reading their own booking would otherwise need
-- EXECUTE on that helper (check:authz caught exactly that).
-- ---------------------------------------------------------------------------
drop policy if exists reservations_cashier_read on reservations;
create policy reservations_cashier_read on reservations for select to authenticated
  using (
    app.is_staff('cashier')
    and ((start_at >= now() - interval '1 day' and start_at < now() + interval '1 day')
         or exists (select 1 from tabs t where t.reservation_id = reservations.id))
    and venue_id = any(app.staff_venue_ids())
  );

-- ---------------------------------------------------------------------------
-- Shape C — guest-readable catalogue. ONLY the staff disjunct is narrowed; the
-- `is_active` branch is the pre-identity guest surface and stays open (the
-- known gap in the header).
-- ---------------------------------------------------------------------------

-- courts (0007:80)
drop policy if exists courts_read on courts;
create policy courts_read on courts for select to anon, authenticated
  using (is_active or (app.is_staff('cashier','prep','court_desk','manager','owner')
                       and venue_id = any(app.staff_venue_ids())));

-- rate_rules (0007:83)
drop policy if exists rate_rules_read on rate_rules;
create policy rate_rules_read on rate_rules for select to anon, authenticated
  using (is_active or (app.is_staff('cashier','prep','court_desk','manager','owner')
                       and venue_id = any(app.staff_venue_ids())));

-- tax_groups (0006:72)
drop policy if exists tax_groups_read on tax_groups;
create policy tax_groups_read on tax_groups for select to anon, authenticated
  using (is_active or (app.is_staff('cashier','prep','court_desk','manager','owner')
                       and venue_id = any(app.staff_venue_ids())));

-- menu_categories (0013:614)
drop policy if exists menu_categories_read on menu_categories;
create policy menu_categories_read on menu_categories for select to anon, authenticated
  using (is_active or (app.is_staff('cashier','prep','court_desk','manager','owner')
                       and venue_id = any(app.staff_venue_ids())));

-- menu_items (0013:617)
drop policy if exists menu_items_read on menu_items;
create policy menu_items_read on menu_items for select to anon, authenticated
  using (is_active or (app.is_staff('cashier','prep','court_desk','manager','owner')
                       and venue_id = any(app.staff_venue_ids())));
