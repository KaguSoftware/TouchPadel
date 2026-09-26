set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0213_venue_id_not_null — multi-venue slice 2, step 7.
--
-- Slice 1 (0126–0129, R5) made venue_id present by a validated
-- CHECK (venue_id is not null) on every scoped table, because
-- check-migrations.mjs blocks a bare SET NOT NULL. With that CHECK validated,
-- Postgres 12+ proves the column has no nulls from the constraint and skips the
-- table scan, so SET NOT NULL here costs a catalog update under a brief ACCESS
-- EXCLUSIVE lock, not a scan. The CHECKs stay (harmless, and they document the
-- slice-1 history). After this, src/types.gen.ts carries venue_id: string on
-- every one of these tables.
--
-- The 37 tables are the slice-1 list (35 less suppliers, created NOT NULL in
-- 0144) plus venue_settings (0126/0208) and cafe_settings (0209). promotions is
-- deliberately left nullable: NULL means every branch (0212, MV2).
--
-- MIGRATION-RISK-ACCEPTED: SET NOT NULL on 37 tables, each backed by a
-- validated venue_id presence CHECK, so no row is scanned; the gate's
-- not-null-direct rule is waived for this file (PHASE-2-CHECKLIST.md, slice-2
-- waiver). Runs outside service hours like every hosted push.

alter table analytics_insight_rejections alter column venue_id set not null;
alter table analytics_insights alter column venue_id set not null;
alter table analytics_patterns alter column venue_id set not null;
alter table audit_log alter column venue_id set not null;
alter table cafe_settings alter column venue_id set not null;
alter table cafe_tables alter column venue_id set not null;
alter table courts alter column venue_id set not null;
alter table day_sessions alter column venue_id set not null;
alter table degraded_periods alter column venue_id set not null;
alter table deliveries alter column venue_id set not null;
alter table device_heartbeats alter column venue_id set not null;
alter table guest_sessions alter column venue_id set not null;
alter table ingredients alter column venue_id set not null;
alter table manager_alerts alter column venue_id set not null;
alter table marketing_audiences alter column venue_id set not null;
alter table marketing_campaigns alter column venue_id set not null;
alter table menu_categories alter column venue_id set not null;
alter table menu_items alter column venue_id set not null;
alter table modifier_groups alter column venue_id set not null;
alter table orders alter column venue_id set not null;
alter table payments alter column venue_id set not null;
alter table rate_rules alter column venue_id set not null;
alter table refunds alter column venue_id set not null;
alter table reservation_series alter column venue_id set not null;
alter table reservations alter column venue_id set not null;
alter table staff_breaks alter column venue_id set not null;
alter table station_staff alter column venue_id set not null;
alter table stock_batches alter column venue_id set not null;
alter table stock_counts alter column venue_id set not null;
alter table stock_movements alter column venue_id set not null;
alter table tabs alter column venue_id set not null;
alter table tax_groups alter column venue_id set not null;
alter table telegram_actions alter column venue_id set not null;
alter table telegram_outbox alter column venue_id set not null;
alter table tickets alter column venue_id set not null;
alter table venue_settings alter column venue_id set not null;
alter table waiter_calls alter column venue_id set not null;
