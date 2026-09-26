-- ===========================================================================
-- 0134 — two uniques that were venue-blind become per-venue.
--
-- Both were written in a one-venue world and read as obviously right there:
--
--   cafe_tables.table_number  unique   (0014:21 — inline `unique`, so Postgres
--                                       named it cafe_tables_table_number_key)
--   day_sessions.business_date unique  (0015:27 — same, day_sessions_business_date_key)
--
-- In a two-venue world each is a bug with a straight face. Every cafe on earth
-- has a table called T1; the second venue could not have one. Every venue
-- trades on the same calendar day; the second venue could not open its day at
-- all, because the first had already taken 2026-09-21 — and app.open_day would
-- fail with a unique violation nobody could explain.
--
-- The replacements are unique indexes on (venue_id, table_number) and
-- (venue_id, business_date). Leading column venue_id, so they also serve the
-- per-venue lookups that slice 3 and 4 will make; a one-value leading column
-- is never chosen by the planner today, which is fine — correctness is what
-- these are for.
--
-- CREATE BEFORE DROP, in that order, deliberately: for the instant between the
-- two statements the table carries both rules, so there is no window in which
-- a duplicate could slip in. Doing it the other way round opens one. Both
-- statements are idempotent (`if not exists` / `if exists`), so a re-run of the
-- file is a no-op whichever half already happened.
--
-- app.upsert_cafe_table needs NO re-issue: it catches unique_violation
-- generically (0031:106) and turns it into TABLE_NUMBER_TAKEN, which stays the
-- right answer — it just now means "taken at THIS venue".
--
-- MIGRATION-RISK-ACCEPTED: two CREATE UNIQUE INDEX statements, not
-- CONCURRENTLY — same acceptance as 0132: CONCURRENTLY cannot run in the
-- transaction Supabase wraps each migration in, the tables are ~20 and ~400
-- rows, and lock_timeout = '3s' aborts the file rather than queue the till
-- behind it. Waiver given locally via MIGRATION_RISK_ACCEPTED (R11).
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. cafe_tables: a table number is unique within its venue.
-- ---------------------------------------------------------------------------
create unique index if not exists cafe_tables_venue_number_key
  on cafe_tables (venue_id, table_number);

alter table cafe_tables drop constraint if exists cafe_tables_table_number_key;

comment on column cafe_tables.table_number is
  '0014: the number printed on the QR. 0134: unique per VENUE, not globally '
  '(cafe_tables_venue_number_key) — two venues may both have a T1.';

-- ---------------------------------------------------------------------------
-- 2. day_sessions: a trading day is unique within its venue.
-- ---------------------------------------------------------------------------
create unique index if not exists day_sessions_venue_date_key
  on day_sessions (venue_id, business_date);

alter table day_sessions drop constraint if exists day_sessions_business_date_key;

comment on column day_sessions.business_date is
  '0015: the trading day this session belongs to. 0134: unique per VENUE, not '
  'globally (day_sessions_venue_date_key) — every venue opens the same calendar '
  'day. app.open_day''s PREVIOUS_DAY_OPEN guard is still venue-blind until '
  'slice 3.';
