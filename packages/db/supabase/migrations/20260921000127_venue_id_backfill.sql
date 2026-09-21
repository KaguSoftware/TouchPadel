-- ===========================================================================
-- 0127 — backfill venue_id on the 35 scoped tables (multi-venue slice 1).
--
-- Every row in the database predates the venue axis and belongs to the one
-- club Touch has been running since day one, so every NULL becomes
-- app.default_venue(). 0126 left them NULL on purpose (a stored default would
-- have back-filled them at DDL time as the migration role); this file fills
-- them for real, and 0129 then proves none is left.
--
-- FOUR APPEND-ONLY TRIGGERS COME OFF FIRST. audit_log_ao (0005:25),
-- payments_ao (0015:164), refunds_ao (0015:167) and stock_movements_ao
-- (0018:49) are BEFORE UPDATE OR DELETE statement triggers whose whole job is
-- to raise on an UPDATE — including this one. They are disabled and re-enabled
-- in the SAME TRANSACTION, which is what makes it safe: a migration is wrapped
-- in one transaction by the CLI, so there is no window in which the ledger is
-- unguarded, and a failure anywhere below rolls the whole thing back with the
-- triggers still attached. Precedent: 0114:41-48, which disabled sync_replays_ao
-- for exactly one statement to purge recorded PINs. sync_replays_ao itself
-- stays on — sync_replays is a global table and gets no venue_id.
--
-- AFTER THE PUSH, ASSERT THE TRIGGERS ARE BACK:
--   select tgrelid::regclass, tgenabled from pg_trigger where tgname like '%\_ao';
-- All five must read 'O'.
--
-- IDEMPOTENT: every statement is `where venue_id is null`, so a re-run touches
-- nothing. It is also why the backfill can never overwrite a row that a live
-- write has already filed at its own venue.
--
-- SIZE. These tables hold hundreds of rows on hosted, so one transaction is
-- right. If `select count(*) from audit_log` on hosted ever comes back large,
-- audit_log gets its own migration — but never a batched backfill across
-- transactions, because that reopens the append-only window above.
--
-- Next in this slice: 0128 the foreign keys, 0129 the not-null checks.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Lift the append-only guards for the length of this transaction.
-- ---------------------------------------------------------------------------
alter table audit_log                      disable trigger audit_log_ao;
alter table payments                       disable trigger payments_ao;
alter table refunds                        disable trigger refunds_ao;
alter table stock_movements                disable trigger stock_movements_ao;

-- ---------------------------------------------------------------------------
-- 2. File every existing row at the default venue.
-- ---------------------------------------------------------------------------
update courts                         set venue_id = app.default_venue() where venue_id is null;
update rate_rules                     set venue_id = app.default_venue() where venue_id is null;
update cafe_tables                    set venue_id = app.default_venue() where venue_id is null;
update day_sessions                   set venue_id = app.default_venue() where venue_id is null;
update menu_categories                set venue_id = app.default_venue() where venue_id is null;
update menu_items                     set venue_id = app.default_venue() where venue_id is null;
update modifier_groups                set venue_id = app.default_venue() where venue_id is null;
update ingredients                    set venue_id = app.default_venue() where venue_id is null;
update deliveries                     set venue_id = app.default_venue() where venue_id is null;
update stock_counts                   set venue_id = app.default_venue() where venue_id is null;
update tax_groups                     set venue_id = app.default_venue() where venue_id is null;
update marketing_audiences            set venue_id = app.default_venue() where venue_id is null;
update marketing_campaigns            set venue_id = app.default_venue() where venue_id is null;
update analytics_insights             set venue_id = app.default_venue() where venue_id is null;
update analytics_patterns             set venue_id = app.default_venue() where venue_id is null;
update analytics_insight_rejections   set venue_id = app.default_venue() where venue_id is null;
update telegram_outbox                set venue_id = app.default_venue() where venue_id is null;
update telegram_actions               set venue_id = app.default_venue() where venue_id is null;
update manager_alerts                 set venue_id = app.default_venue() where venue_id is null;
update degraded_periods               set venue_id = app.default_venue() where venue_id is null;
update audit_log                      set venue_id = app.default_venue() where venue_id is null;
update reservations                   set venue_id = app.default_venue() where venue_id is null;
update reservation_series             set venue_id = app.default_venue() where venue_id is null;
update guest_sessions                 set venue_id = app.default_venue() where venue_id is null;
update tabs                           set venue_id = app.default_venue() where venue_id is null;
update orders                         set venue_id = app.default_venue() where venue_id is null;
update tickets                        set venue_id = app.default_venue() where venue_id is null;
update payments                       set venue_id = app.default_venue() where venue_id is null;
update refunds                        set venue_id = app.default_venue() where venue_id is null;
update stock_batches                  set venue_id = app.default_venue() where venue_id is null;
update stock_movements                set venue_id = app.default_venue() where venue_id is null;
update waiter_calls                   set venue_id = app.default_venue() where venue_id is null;
update staff_breaks                   set venue_id = app.default_venue() where venue_id is null;
update station_staff                  set venue_id = app.default_venue() where venue_id is null;
update device_heartbeats              set venue_id = app.default_venue() where venue_id is null;

-- ---------------------------------------------------------------------------
-- 3. Put them back. Same transaction: the ledgers are never unguarded.
-- ---------------------------------------------------------------------------
alter table audit_log                      enable trigger audit_log_ao;
alter table payments                       enable trigger payments_ao;
alter table refunds                        enable trigger refunds_ao;
alter table stock_movements                enable trigger stock_movements_ao;
