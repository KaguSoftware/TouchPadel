-- ===========================================================================
-- 0135 — four (venue_id, time) indexes on the tables that grow (decision R10).
--
-- Only four, and only these four. A leading column with one distinct value is
-- never chosen by the planner, so an index on (venue_id, …) is dead weight
-- until a second venue exists and the queries actually filter by venue —
-- which they do not until slice 3. Adding one per scoped table now would mean
-- 35 indexes nobody uses, 35 more things every INSERT maintains, and a bigger
-- surface to get wrong.
--
-- These four earn it because they are the tables that keep growing and are
-- always read as "a window of time at one venue":
--
--   audit_log    (venue_id, at desc)        the audit page and assistant_audit_page
--   reservations (venue_id, start_at)       the calendar and every availability read
--   orders       (venue_id, placed_at)      the KDS feed and the cafe reports
--   payments     (venue_id, created_at)     day close and every revenue report
--
-- The timestamp column names are the real ones, checked against the tables
-- rather than guessed: audit_log.at (0005:9, which already has audit_log_at on
-- (at desc)), reservations.start_at (0008:18), orders.placed_at (0015:68),
-- payments.created_at (0015:131). Three of the four differ from each other,
-- which is exactly why this was worth checking.
--
-- THE SLICE-3 SET, so nobody re-derives it. When the RPCs start filtering by
-- venue, these are the next candidates, in this order, each only once a query
-- exists that wants it: tabs (venue_id, opened_at), tickets (venue_id,
-- status), guest_sessions (venue_id, last_activity_at) where closed_at is
-- null, stock_movements (venue_id, at), waiter_calls (venue_id, created_at)
-- where resolved_at is null, telegram_outbox (venue_id, created_at) where
-- sent_at is null, manager_alerts (venue_id, created_at) where
-- acknowledged_at is null, device_heartbeats (venue_id, last_seen_at), and
-- courts / menu_items / cafe_tables (venue_id, is_active) for the admin lists.
-- Each of those is a partial index on a hot predicate, not a bare pair.
--
-- MIGRATION-RISK-ACCEPTED: four CREATE INDEX statements, not CONCURRENTLY —
-- same acceptance as 0132 and 0134. CONCURRENTLY cannot run inside the
-- transaction Supabase wraps each migration in; the client's project holds
-- these tables in the hundreds to low thousands of rows, so each build is
-- milliseconds, and lock_timeout = '3s' aborts the file rather than freeze the
-- till. Waiver given locally through MIGRATION_RISK_ACCEPTED (R11).
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

create index if not exists audit_log_venue_at_idx
  on audit_log (venue_id, at desc);

create index if not exists reservations_venue_start_idx
  on reservations (venue_id, start_at);

create index if not exists orders_venue_placed_idx
  on orders (venue_id, placed_at);

create index if not exists payments_venue_created_idx
  on payments (venue_id, created_at);
