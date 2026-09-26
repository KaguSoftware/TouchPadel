-- ===========================================================================
-- 0128 — venue_id references venues(id) on all 35 scoped tables (multi-venue
-- slice 1).
--
-- NOT VALID first, VALIDATE after, the two-step this repo uses on every live
-- table (shape 0092:64-76, precedent 0098:15-38). ADD CONSTRAINT on its own
-- takes ACCESS EXCLUSIVE — which blocks even SELECT — for the whole validating
-- scan; NOT VALID takes it for an instant, and VALIDATE CONSTRAINT then scans
-- under SHARE UPDATE EXCLUSIVE while the till keeps trading.
--
-- The DO block is guarded on pg_constraint so a re-run of this file is a no-op
-- rather than a duplicate_object error (0071 precedent). VALIDATE CONSTRAINT is
-- idempotent by itself — validating an already-valid constraint does nothing —
-- so those statements stand outside the block where the checker can read them.
--
-- NO ON DELETE CLAUSE, deliberately. A venue is never deleted: 0122 gives it
-- is_active, and the multi-venue test deactivates venue B rather than removing
-- it precisely because audit_log and payments rows make deletion impossible.
-- The default (NO ACTION) is the correct refusal.
--
-- The CROSS-VENUE agreement constraints — (court_id, venue_id) -> courts,
-- (tab_id, venue_id) -> tabs and the rest — are 0133, on top of the pair keys
-- 0132 creates. This file only ties each venue_id to a real venue.
--
-- Next: 0129, the validated CHECK that stands in for NOT NULL (R5).
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Add them NOT VALID — instant, and idempotent on a re-run.
-- ---------------------------------------------------------------------------
do $venue_fks_0128$
begin
  if not exists (select 1 from pg_constraint where conname = 'courts_venue_id_fkey' and conrelid = 'courts'::regclass) then
    alter table courts
      add constraint courts_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rate_rules_venue_id_fkey' and conrelid = 'rate_rules'::regclass) then
    alter table rate_rules
      add constraint rate_rules_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cafe_tables_venue_id_fkey' and conrelid = 'cafe_tables'::regclass) then
    alter table cafe_tables
      add constraint cafe_tables_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'day_sessions_venue_id_fkey' and conrelid = 'day_sessions'::regclass) then
    alter table day_sessions
      add constraint day_sessions_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_categories_venue_id_fkey' and conrelid = 'menu_categories'::regclass) then
    alter table menu_categories
      add constraint menu_categories_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_items_venue_id_fkey' and conrelid = 'menu_items'::regclass) then
    alter table menu_items
      add constraint menu_items_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'modifier_groups_venue_id_fkey' and conrelid = 'modifier_groups'::regclass) then
    alter table modifier_groups
      add constraint modifier_groups_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ingredients_venue_id_fkey' and conrelid = 'ingredients'::regclass) then
    alter table ingredients
      add constraint ingredients_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deliveries_venue_id_fkey' and conrelid = 'deliveries'::regclass) then
    alter table deliveries
      add constraint deliveries_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_counts_venue_id_fkey' and conrelid = 'stock_counts'::regclass) then
    alter table stock_counts
      add constraint stock_counts_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tax_groups_venue_id_fkey' and conrelid = 'tax_groups'::regclass) then
    alter table tax_groups
      add constraint tax_groups_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_audiences_venue_id_fkey' and conrelid = 'marketing_audiences'::regclass) then
    alter table marketing_audiences
      add constraint marketing_audiences_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_campaigns_venue_id_fkey' and conrelid = 'marketing_campaigns'::regclass) then
    alter table marketing_campaigns
      add constraint marketing_campaigns_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analytics_insights_venue_id_fkey' and conrelid = 'analytics_insights'::regclass) then
    alter table analytics_insights
      add constraint analytics_insights_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analytics_patterns_venue_id_fkey' and conrelid = 'analytics_patterns'::regclass) then
    alter table analytics_patterns
      add constraint analytics_patterns_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analytics_insight_rejections_venue_id_fkey' and conrelid = 'analytics_insight_rejections'::regclass) then
    alter table analytics_insight_rejections
      add constraint analytics_insight_rejections_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'telegram_outbox_venue_id_fkey' and conrelid = 'telegram_outbox'::regclass) then
    alter table telegram_outbox
      add constraint telegram_outbox_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'telegram_actions_venue_id_fkey' and conrelid = 'telegram_actions'::regclass) then
    alter table telegram_actions
      add constraint telegram_actions_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'manager_alerts_venue_id_fkey' and conrelid = 'manager_alerts'::regclass) then
    alter table manager_alerts
      add constraint manager_alerts_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'degraded_periods_venue_id_fkey' and conrelid = 'degraded_periods'::regclass) then
    alter table degraded_periods
      add constraint degraded_periods_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_log_venue_id_fkey' and conrelid = 'audit_log'::regclass) then
    alter table audit_log
      add constraint audit_log_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_venue_id_fkey' and conrelid = 'reservations'::regclass) then
    alter table reservations
      add constraint reservations_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservation_series_venue_id_fkey' and conrelid = 'reservation_series'::regclass) then
    alter table reservation_series
      add constraint reservation_series_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guest_sessions_venue_id_fkey' and conrelid = 'guest_sessions'::regclass) then
    alter table guest_sessions
      add constraint guest_sessions_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tabs_venue_id_fkey' and conrelid = 'tabs'::regclass) then
    alter table tabs
      add constraint tabs_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_venue_id_fkey' and conrelid = 'orders'::regclass) then
    alter table orders
      add constraint orders_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tickets_venue_id_fkey' and conrelid = 'tickets'::regclass) then
    alter table tickets
      add constraint tickets_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_venue_id_fkey' and conrelid = 'payments'::regclass) then
    alter table payments
      add constraint payments_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'refunds_venue_id_fkey' and conrelid = 'refunds'::regclass) then
    alter table refunds
      add constraint refunds_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_batches_venue_id_fkey' and conrelid = 'stock_batches'::regclass) then
    alter table stock_batches
      add constraint stock_batches_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_venue_id_fkey' and conrelid = 'stock_movements'::regclass) then
    alter table stock_movements
      add constraint stock_movements_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'waiter_calls_venue_id_fkey' and conrelid = 'waiter_calls'::regclass) then
    alter table waiter_calls
      add constraint waiter_calls_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_breaks_venue_id_fkey' and conrelid = 'staff_breaks'::regclass) then
    alter table staff_breaks
      add constraint staff_breaks_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'station_staff_venue_id_fkey' and conrelid = 'station_staff'::regclass) then
    alter table station_staff
      add constraint station_staff_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'device_heartbeats_venue_id_fkey' and conrelid = 'device_heartbeats'::regclass) then
    alter table device_heartbeats
      add constraint device_heartbeats_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
end
$venue_fks_0128$;

-- ---------------------------------------------------------------------------
-- 2. Validate them: SHARE UPDATE EXCLUSIVE, and 0127 already filled the rows.
-- ---------------------------------------------------------------------------
alter table courts                         validate constraint courts_venue_id_fkey;
alter table rate_rules                     validate constraint rate_rules_venue_id_fkey;
alter table cafe_tables                    validate constraint cafe_tables_venue_id_fkey;
alter table day_sessions                   validate constraint day_sessions_venue_id_fkey;
alter table menu_categories                validate constraint menu_categories_venue_id_fkey;
alter table menu_items                     validate constraint menu_items_venue_id_fkey;
alter table modifier_groups                validate constraint modifier_groups_venue_id_fkey;
alter table ingredients                    validate constraint ingredients_venue_id_fkey;
alter table deliveries                     validate constraint deliveries_venue_id_fkey;
alter table stock_counts                   validate constraint stock_counts_venue_id_fkey;
alter table tax_groups                     validate constraint tax_groups_venue_id_fkey;
alter table marketing_audiences            validate constraint marketing_audiences_venue_id_fkey;
alter table marketing_campaigns            validate constraint marketing_campaigns_venue_id_fkey;
alter table analytics_insights             validate constraint analytics_insights_venue_id_fkey;
alter table analytics_patterns             validate constraint analytics_patterns_venue_id_fkey;
alter table analytics_insight_rejections   validate constraint analytics_insight_rejections_venue_id_fkey;
alter table telegram_outbox                validate constraint telegram_outbox_venue_id_fkey;
alter table telegram_actions               validate constraint telegram_actions_venue_id_fkey;
alter table manager_alerts                 validate constraint manager_alerts_venue_id_fkey;
alter table degraded_periods               validate constraint degraded_periods_venue_id_fkey;
alter table audit_log                      validate constraint audit_log_venue_id_fkey;
alter table reservations                   validate constraint reservations_venue_id_fkey;
alter table reservation_series             validate constraint reservation_series_venue_id_fkey;
alter table guest_sessions                 validate constraint guest_sessions_venue_id_fkey;
alter table tabs                           validate constraint tabs_venue_id_fkey;
alter table orders                         validate constraint orders_venue_id_fkey;
alter table tickets                        validate constraint tickets_venue_id_fkey;
alter table payments                       validate constraint payments_venue_id_fkey;
alter table refunds                        validate constraint refunds_venue_id_fkey;
alter table stock_batches                  validate constraint stock_batches_venue_id_fkey;
alter table stock_movements                validate constraint stock_movements_venue_id_fkey;
alter table waiter_calls                   validate constraint waiter_calls_venue_id_fkey;
alter table staff_breaks                   validate constraint staff_breaks_venue_id_fkey;
alter table station_staff                  validate constraint station_staff_venue_id_fkey;
alter table device_heartbeats              validate constraint device_heartbeats_venue_id_fkey;
