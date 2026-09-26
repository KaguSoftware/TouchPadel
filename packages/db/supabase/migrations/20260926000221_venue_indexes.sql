set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0221_venue_indexes — multi-venue slice 3, step 7.
--
-- Slice 1 (R10) built four (venue_id, time) indexes and left the rest for the
-- slice whose queries filter by venue. Slices 2–3 made the day, the till, the
-- kitchen board reads, the guest paths and the reports filter by venue_id, so
-- the hot paths get their leading column now (the slice-1 hand-over list).
--
-- MIGRATION-RISK-ACCEPTED: non-concurrent CREATE INDEX (a Supabase migration
-- runs in a transaction, where CONCURRENTLY cannot). Every table here holds one
-- branch's rows today; the SHARE lock lasts the seconds each build takes and the
-- push runs outside service hours, like 0132/0134/0135.

create index if not exists tickets_venue_status_created_idx
  on tickets (venue_id, status, created_at);
create index if not exists tabs_venue_day_open_idx
  on tabs (venue_id, day_session_id) where status = 'open';
create index if not exists stock_movements_venue_at_idx
  on stock_movements (venue_id, at);
create index if not exists waiter_calls_venue_status_idx
  on waiter_calls (venue_id, status);
create index if not exists guest_sessions_venue_live_idx
  on guest_sessions (venue_id) where closed_at is null;
create index if not exists courts_venue_active_idx
  on courts (venue_id, is_active);
create index if not exists menu_items_venue_active_idx
  on menu_items (venue_id, is_active);
create index if not exists menu_categories_venue_active_idx
  on menu_categories (venue_id, is_active);
create index if not exists ingredients_venue_active_idx
  on ingredients (venue_id, is_active);
create index if not exists rate_rules_venue_active_idx
  on rate_rules (venue_id, is_active);
create index if not exists device_heartbeats_venue_seen_idx
  on device_heartbeats (venue_id, last_seen_at);
