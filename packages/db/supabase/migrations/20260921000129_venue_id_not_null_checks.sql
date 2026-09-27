-- ===========================================================================
-- 0129 — venue_id is never NULL on the 35 scoped tables, as a VALIDATED CHECK
-- rather than SET NOT NULL (multi-venue slice 1, decision R5).
--
-- WHY A CHECK AND NOT NOT NULL. Two reasons, and they point the same way.
--
--   1. `alter column ... set not null` is a full table scan under ACCESS
--      EXCLUSIVE, and check-migrations.mjs:391-400 blocks it outright for that
--      reason. A CHECK (venue_id is not null) added NOT VALID and then
--      VALIDATEd gives the identical guarantee — the constraint is enforced on
--      every write from the instant it is added, and the scan that proves the
--      existing rows runs under SHARE UPDATE EXCLUSIVE.
--   2. types.gen.ts. A NOT NULL column comes back from `pnpm db:types` as
--      `venue_id: string`, and 36 columns turning non-nullable moves the
--      generated types under every client in the monorepo in the same commit
--      that backfills 35 tables on the client's live project. A CHECK leaves
--      them `venue_id: string | null` and nothing downstream moves.
--
-- SET NOT NULL lands in slice 2, in its own migration, with a purpose-written
-- MIGRATION-RISK-ACCEPTED waiver — and by then Postgres 12+ will use these
-- validated CHECKs to skip the scan entirely, which is the third reason to do
-- it in this order.
--
-- Shape as everywhere else: guarded DO block for the NOT VALID adds (0092:64-76),
-- plain VALIDATE statements after it (0098:15-38).
--
-- This is the last file of the column work. Next in the slice: 0130 teaches
-- app.heartbeat to register a station and assert it, 0131 the station FKs.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Add them NOT VALID — enforced on every write from this moment on.
-- ---------------------------------------------------------------------------
do $venue_present_0129$
begin
  if not exists (select 1 from pg_constraint where conname = 'courts_venue_id_present' and conrelid = 'courts'::regclass) then
    alter table courts
      add constraint courts_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rate_rules_venue_id_present' and conrelid = 'rate_rules'::regclass) then
    alter table rate_rules
      add constraint rate_rules_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cafe_tables_venue_id_present' and conrelid = 'cafe_tables'::regclass) then
    alter table cafe_tables
      add constraint cafe_tables_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'day_sessions_venue_id_present' and conrelid = 'day_sessions'::regclass) then
    alter table day_sessions
      add constraint day_sessions_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_categories_venue_id_present' and conrelid = 'menu_categories'::regclass) then
    alter table menu_categories
      add constraint menu_categories_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_items_venue_id_present' and conrelid = 'menu_items'::regclass) then
    alter table menu_items
      add constraint menu_items_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'modifier_groups_venue_id_present' and conrelid = 'modifier_groups'::regclass) then
    alter table modifier_groups
      add constraint modifier_groups_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ingredients_venue_id_present' and conrelid = 'ingredients'::regclass) then
    alter table ingredients
      add constraint ingredients_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deliveries_venue_id_present' and conrelid = 'deliveries'::regclass) then
    alter table deliveries
      add constraint deliveries_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_counts_venue_id_present' and conrelid = 'stock_counts'::regclass) then
    alter table stock_counts
      add constraint stock_counts_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tax_groups_venue_id_present' and conrelid = 'tax_groups'::regclass) then
    alter table tax_groups
      add constraint tax_groups_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_audiences_venue_id_present' and conrelid = 'marketing_audiences'::regclass) then
    alter table marketing_audiences
      add constraint marketing_audiences_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_campaigns_venue_id_present' and conrelid = 'marketing_campaigns'::regclass) then
    alter table marketing_campaigns
      add constraint marketing_campaigns_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analytics_insights_venue_id_present' and conrelid = 'analytics_insights'::regclass) then
    alter table analytics_insights
      add constraint analytics_insights_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analytics_patterns_venue_id_present' and conrelid = 'analytics_patterns'::regclass) then
    alter table analytics_patterns
      add constraint analytics_patterns_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analytics_insight_rejections_venue_id_present' and conrelid = 'analytics_insight_rejections'::regclass) then
    alter table analytics_insight_rejections
      add constraint analytics_insight_rejections_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'telegram_outbox_venue_id_present' and conrelid = 'telegram_outbox'::regclass) then
    alter table telegram_outbox
      add constraint telegram_outbox_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'telegram_actions_venue_id_present' and conrelid = 'telegram_actions'::regclass) then
    alter table telegram_actions
      add constraint telegram_actions_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'manager_alerts_venue_id_present' and conrelid = 'manager_alerts'::regclass) then
    alter table manager_alerts
      add constraint manager_alerts_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'degraded_periods_venue_id_present' and conrelid = 'degraded_periods'::regclass) then
    alter table degraded_periods
      add constraint degraded_periods_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_log_venue_id_present' and conrelid = 'audit_log'::regclass) then
    alter table audit_log
      add constraint audit_log_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_venue_id_present' and conrelid = 'reservations'::regclass) then
    alter table reservations
      add constraint reservations_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservation_series_venue_id_present' and conrelid = 'reservation_series'::regclass) then
    alter table reservation_series
      add constraint reservation_series_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guest_sessions_venue_id_present' and conrelid = 'guest_sessions'::regclass) then
    alter table guest_sessions
      add constraint guest_sessions_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tabs_venue_id_present' and conrelid = 'tabs'::regclass) then
    alter table tabs
      add constraint tabs_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_venue_id_present' and conrelid = 'orders'::regclass) then
    alter table orders
      add constraint orders_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tickets_venue_id_present' and conrelid = 'tickets'::regclass) then
    alter table tickets
      add constraint tickets_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_venue_id_present' and conrelid = 'payments'::regclass) then
    alter table payments
      add constraint payments_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'refunds_venue_id_present' and conrelid = 'refunds'::regclass) then
    alter table refunds
      add constraint refunds_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_batches_venue_id_present' and conrelid = 'stock_batches'::regclass) then
    alter table stock_batches
      add constraint stock_batches_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_venue_id_present' and conrelid = 'stock_movements'::regclass) then
    alter table stock_movements
      add constraint stock_movements_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waiter_calls_venue_id_present' and conrelid = 'waiter_calls'::regclass) then
    alter table waiter_calls
      add constraint waiter_calls_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_breaks_venue_id_present' and conrelid = 'staff_breaks'::regclass) then
    alter table staff_breaks
      add constraint staff_breaks_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'station_staff_venue_id_present' and conrelid = 'station_staff'::regclass) then
    alter table station_staff
      add constraint station_staff_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'device_heartbeats_venue_id_present' and conrelid = 'device_heartbeats'::regclass) then
    alter table device_heartbeats
      add constraint device_heartbeats_venue_id_present
      check (venue_id is not null) not valid;
  end if;
end
$venue_present_0129$;

-- ---------------------------------------------------------------------------
-- 2. Validate: the scan 0127 made pass.
-- ---------------------------------------------------------------------------
alter table courts                         validate constraint courts_venue_id_present;
alter table rate_rules                     validate constraint rate_rules_venue_id_present;
alter table cafe_tables                    validate constraint cafe_tables_venue_id_present;
alter table day_sessions                   validate constraint day_sessions_venue_id_present;
alter table menu_categories                validate constraint menu_categories_venue_id_present;
alter table menu_items                     validate constraint menu_items_venue_id_present;
alter table modifier_groups                validate constraint modifier_groups_venue_id_present;
alter table ingredients                    validate constraint ingredients_venue_id_present;
alter table deliveries                     validate constraint deliveries_venue_id_present;
alter table stock_counts                   validate constraint stock_counts_venue_id_present;
alter table tax_groups                     validate constraint tax_groups_venue_id_present;
alter table marketing_audiences            validate constraint marketing_audiences_venue_id_present;
alter table marketing_campaigns            validate constraint marketing_campaigns_venue_id_present;
alter table analytics_insights             validate constraint analytics_insights_venue_id_present;
alter table analytics_patterns             validate constraint analytics_patterns_venue_id_present;
alter table analytics_insight_rejections   validate constraint analytics_insight_rejections_venue_id_present;
alter table telegram_outbox                validate constraint telegram_outbox_venue_id_present;
alter table telegram_actions               validate constraint telegram_actions_venue_id_present;
alter table manager_alerts                 validate constraint manager_alerts_venue_id_present;
alter table degraded_periods               validate constraint degraded_periods_venue_id_present;
alter table audit_log                      validate constraint audit_log_venue_id_present;
alter table reservations                   validate constraint reservations_venue_id_present;
alter table reservation_series             validate constraint reservation_series_venue_id_present;
alter table guest_sessions                 validate constraint guest_sessions_venue_id_present;
alter table tabs                           validate constraint tabs_venue_id_present;
alter table orders                         validate constraint orders_venue_id_present;
alter table tickets                        validate constraint tickets_venue_id_present;
alter table payments                       validate constraint payments_venue_id_present;
alter table refunds                        validate constraint refunds_venue_id_present;
alter table stock_batches                  validate constraint stock_batches_venue_id_present;
alter table stock_movements                validate constraint stock_movements_venue_id_present;
alter table waiter_calls                   validate constraint waiter_calls_venue_id_present;
alter table staff_breaks                   validate constraint staff_breaks_venue_id_present;
alter table station_staff                  validate constraint station_staff_venue_id_present;
alter table device_heartbeats              validate constraint device_heartbeats_venue_id_present;
