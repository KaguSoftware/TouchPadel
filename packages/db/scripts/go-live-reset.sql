-- go-live-reset.sql — clear the trading record before the venue opens.
--
-- WHAT IT DOES. Empties every table that holds a TRANSACTION: reservations,
-- tabs, orders, tickets, payments, refunds, day sessions, stock movements, the
-- audit log, and the analytics/assistant rows derived from them. Written
-- 2026-09-22 for the go-live cutover.
--
-- WHAT IT KEEPS. Everything the venue was CONFIGURED with: the menu and its
-- modifiers, allergens, tax groups, ingredients and recipes, courts, cafe
-- tables, rate rules, promotions, staff, venues, venue_settings, cafe_settings,
-- the Telegram links, and the assistant's schema/doc index. Guest accounts stay
-- too (`profiles`, `customer_notes`, `customer_flags`) — their bookings and tabs
-- go, the people do not.
--
-- WHY TRUNCATE AND NOT DELETE. `audit_log`, `payments`, `refunds`,
-- `stock_movements` and `sync_replays` carry the `app.forbid_mutation` trigger
-- (append-only): a DELETE on any of them raises '<table> is append-only'.
-- TRUNCATE does not fire row triggers, so it is the only statement that clears
-- them. It also sidesteps the `safeupdate` extension, which refuses a DELETE
-- with no WHERE clause on PostgREST connections.
--
-- WHY NO CASCADE. Deliberate. Every table that references a truncated table is
-- named in the list below, so the statement succeeds as written. If the schema
-- gains a new child table later, this errors and names it — which is what you
-- want. CASCADE would silently truncate the menu.
--
-- HOW TO RUN. As `postgres` (Supabase Studio → SQL Editor, or psql on the
-- pooler). TRUNCATE needs table ownership; the anon/authenticated/service roles
-- cannot run it.
--
--   Dry run:  change the last line to `rollback;` — you get the before/after
--             report with nothing committed.
--   For real: leave the last line as `commit;`.
--
-- BEFORE YOU RUN IT ON THE HOSTED PROJECT: take a backup
-- (Dashboard → Database → Backups, or `supabase db dump --linked -f pre-golive.sql`).
-- There is no undo once this commits.

set lock_timeout = '10s';
set statement_timeout = '300s';

begin;

-- ---------------------------------------------------------------------------
-- Guard. A day session that is still open means the till is mid-trade; wiping
-- underneath it would leave the drawer unreconciled. Close the day first.
-- ---------------------------------------------------------------------------
do $guard$
declare
  open_days integer;
begin
  select count(*) into open_days from public.day_sessions where closed_at is null;
  if open_days > 0 then
    raise exception
      'REFUSING: % day session(s) are still open. Close the day on the till first.', open_days;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- Before-report.
-- ---------------------------------------------------------------------------
do $before$
declare
  r record;
begin
  raise notice '--- before ---';
  for r in
    select 'reservations' as t, count(*) as n from public.reservations
    union all select 'tabs',     count(*) from public.tabs
    union all select 'orders',   count(*) from public.orders
    union all select 'payments', count(*) from public.payments
    union all select 'day_sessions', count(*) from public.day_sessions
    union all select 'audit_log',    count(*) from public.audit_log
    order by 1
  loop
    raise notice '% = %', rpad(r.t, 14), r.n;
  end loop;
end
$before$;

-- ---------------------------------------------------------------------------
-- The wipe. One statement: TRUNCATE is atomic across every table listed, so
-- no FK is ever transiently violated and order does not matter.
-- ---------------------------------------------------------------------------
truncate table
  -- The trading record ------------------------------------------------------
  public.reservations,
  public.reservation_series,
  public.tabs,
  public.tab_adjustments,
  public.orders,
  public.order_items,
  public.order_item_modifiers,
  public.tickets,
  public.payments,
  public.refunds,
  public.refund_items,
  public.day_sessions,
  public.waiter_calls,
  public.guest_sessions,
  public.promotion_redemptions,

  -- Stock. Ingredients and recipes survive; quantities go to zero, so the
  -- venue starts with an opening count on day one.
  public.stock_movements,
  public.stock_batches,
  public.stock_counts,
  public.stock_count_lines,
  public.deliveries,
  public.delivery_lines,

  -- Operations, devices and staff activity ----------------------------------
  public.audit_log,
  public.sync_replays,
  public.device_heartbeats,
  public.degraded_periods,
  public.manager_alerts,
  public.notification_outbox,
  public.telegram_outbox,
  public.telegram_actions,
  public.staff_breaks,
  public.staff_requests,
  public.station_staff,
  -- `stations` is the device registry (0124). Dev sessions and test tills
  -- registered themselves here; a real till re-registers on its first
  -- heartbeat. Drop this one line if the venue's till is already installed
  -- and you want to keep its registered_at.
  public.stations,

  -- Derived from the rows above: regenerated, never authored ----------------
  public.analytics_insights,
  public.analytics_patterns,
  public.analytics_insight_rejections,
  public.assistant_calls,
  public.assistant_messages,
  public.assistant_conversations,
  public.assistant_jobs,
  public.assistant_index_queue,
  -- assistant_component_cache is NOT listed: no migration creates it and it is
  -- absent from both a clean 0139 stack and the hosted project. It existed only
  -- on an older local database. Naming a table TRUNCATE cannot find aborts the
  -- whole statement, so it stays out.
  public.llm_usage,
  public.marketing_sends,

  -- Short-lived server state ------------------------------------------------
  app.rpc_replays,    -- idempotency claims (app.claim_replay)
  app.pin_attempts,   -- PIN rate-limit counters
  app.pin_grants,     -- single-use manager-PIN grants, 2 min TTL (0115)
  app.sms_sends       -- OTP send log
restart identity;

-- ---------------------------------------------------------------------------
-- After-report: the wipe, then proof the catalog is untouched.
-- ---------------------------------------------------------------------------
do $after$
declare
  r record;
begin
  raise notice '--- after (should all be 0) ---';
  for r in
    select 'reservations' as t, count(*) as n from public.reservations
    union all select 'tabs',     count(*) from public.tabs
    union all select 'orders',   count(*) from public.orders
    union all select 'payments', count(*) from public.payments
    union all select 'day_sessions', count(*) from public.day_sessions
    union all select 'audit_log',    count(*) from public.audit_log
    order by 1
  loop
    raise notice '% = %', rpad(r.t, 14), r.n;
  end loop;

  raise notice '--- kept (should all be non-zero) ---';
  for r in
    select 'menu_items' as t, count(*) as n from public.menu_items
    union all select 'courts',      count(*) from public.courts
    union all select 'cafe_tables', count(*) from public.cafe_tables
    union all select 'staff',       count(*) from public.staff
    union all select 'ingredients', count(*) from public.ingredients
    union all select 'profiles',    count(*) from public.profiles
    order by 1
  loop
    raise notice '% = %', rpad(r.t, 14), r.n;
  end loop;
end
$after$;

-- Change to `rollback;` for a dry run.
commit;
