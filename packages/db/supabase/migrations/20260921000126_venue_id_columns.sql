-- ===========================================================================
-- 0126 — venue_id on the 35 scoped tables, plus venue_settings (multi-venue
-- slice 1, decision R1). Column and default only: the backfill is 0127, the
-- foreign keys 0128, the NOT NULL guarantee 0129.
--
-- TWO STATEMENTS PER TABLE, NEVER ONE. `add column venue_id uuid default
-- app.current_venue()` in a single statement is a trap: a default that is not
-- VOLATILE is evaluated ONCE, at DDL time, as the MIGRATION role — Postgres
-- then stores that one value as the column's "missing" value and every
-- existing row silently reads back as though it had been written there. Both
-- resolvers are STABLE. Adding the column first and setting the default
-- afterwards leaves existing rows NULL, which is what 0127 is for and what
-- 0129 then proves is gone.
--
-- WHICH DEFAULT (R1).
--
--   app.current_venue()            — 27 tables written only by an identified
--                                    caller: a staff or guest definer RPC. If
--                                    the venue is ambiguous the write is
--                                    REFUSED with VENUE_REQUIRED. A booking, a
--                                    payment or a stock movement filed at the
--                                    wrong club is worse than a failed write.
--   app.current_venue_or_default() — 8 tables that cron or service_role also
--                                    write with no caller at all. A sweep that
--                                    raises is an outage; those rows fall back
--                                    to app.default_venue().
--
-- Neither default is app.default_venue(): a business table must never guess.
--
-- venue_settings is the exception and stays ONE ROW through slice 1 (boolean
-- PK kept). It gains venue_id with default app.default_venue() and is updated
-- in place here — it is the singleton the default venue was BUILT from (0122),
-- so it belongs to that venue by construction. Splitting the platform-wide
-- knobs out into platform_settings, and re-issuing the 35 functions that read
-- venue_settings unqualified, is slice 2.
--
-- The eight D tables carry a comment on the column saying why they differ;
-- reading `default app.current_venue_or_default()` in psql a year from now
-- should not need this file.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The 27 tables written only by identified callers: refuse, never guess.
-- ---------------------------------------------------------------------------
alter table courts                         add column if not exists venue_id uuid;
alter table rate_rules                     add column if not exists venue_id uuid;
alter table cafe_tables                    add column if not exists venue_id uuid;
alter table day_sessions                   add column if not exists venue_id uuid;
alter table menu_categories                add column if not exists venue_id uuid;
alter table menu_items                     add column if not exists venue_id uuid;
alter table modifier_groups                add column if not exists venue_id uuid;
alter table ingredients                    add column if not exists venue_id uuid;
alter table deliveries                     add column if not exists venue_id uuid;
alter table stock_counts                   add column if not exists venue_id uuid;
alter table tax_groups                     add column if not exists venue_id uuid;
alter table marketing_audiences            add column if not exists venue_id uuid;
alter table marketing_campaigns            add column if not exists venue_id uuid;
alter table reservations                   add column if not exists venue_id uuid;
alter table reservation_series             add column if not exists venue_id uuid;
alter table guest_sessions                 add column if not exists venue_id uuid;
alter table tabs                           add column if not exists venue_id uuid;
alter table orders                         add column if not exists venue_id uuid;
alter table tickets                        add column if not exists venue_id uuid;
alter table payments                       add column if not exists venue_id uuid;
alter table refunds                        add column if not exists venue_id uuid;
alter table stock_batches                  add column if not exists venue_id uuid;
alter table stock_movements                add column if not exists venue_id uuid;
alter table waiter_calls                   add column if not exists venue_id uuid;
alter table staff_breaks                   add column if not exists venue_id uuid;
alter table station_staff                  add column if not exists venue_id uuid;
alter table device_heartbeats              add column if not exists venue_id uuid;

alter table courts                         alter column venue_id set default app.current_venue();
alter table rate_rules                     alter column venue_id set default app.current_venue();
alter table cafe_tables                    alter column venue_id set default app.current_venue();
alter table day_sessions                   alter column venue_id set default app.current_venue();
alter table menu_categories                alter column venue_id set default app.current_venue();
alter table menu_items                     alter column venue_id set default app.current_venue();
alter table modifier_groups                alter column venue_id set default app.current_venue();
alter table ingredients                    alter column venue_id set default app.current_venue();
alter table deliveries                     alter column venue_id set default app.current_venue();
alter table stock_counts                   alter column venue_id set default app.current_venue();
alter table tax_groups                     alter column venue_id set default app.current_venue();
alter table marketing_audiences            alter column venue_id set default app.current_venue();
alter table marketing_campaigns            alter column venue_id set default app.current_venue();
alter table reservations                   alter column venue_id set default app.current_venue();
alter table reservation_series             alter column venue_id set default app.current_venue();
alter table guest_sessions                 alter column venue_id set default app.current_venue();
alter table tabs                           alter column venue_id set default app.current_venue();
alter table orders                         alter column venue_id set default app.current_venue();
alter table tickets                        alter column venue_id set default app.current_venue();
alter table payments                       alter column venue_id set default app.current_venue();
alter table refunds                        alter column venue_id set default app.current_venue();
alter table stock_batches                  alter column venue_id set default app.current_venue();
alter table stock_movements                alter column venue_id set default app.current_venue();
alter table waiter_calls                   alter column venue_id set default app.current_venue();
alter table staff_breaks                   alter column venue_id set default app.current_venue();
alter table station_staff                  alter column venue_id set default app.current_venue();
alter table device_heartbeats              alter column venue_id set default app.current_venue();

-- ---------------------------------------------------------------------------
-- 2. The 8 tables cron and service_role write with no caller: fall back.
-- ---------------------------------------------------------------------------
alter table analytics_insights             add column if not exists venue_id uuid;
alter table analytics_patterns             add column if not exists venue_id uuid;
alter table analytics_insight_rejections   add column if not exists venue_id uuid;
alter table telegram_outbox                add column if not exists venue_id uuid;
alter table telegram_actions               add column if not exists venue_id uuid;
alter table manager_alerts                 add column if not exists venue_id uuid;
alter table degraded_periods               add column if not exists venue_id uuid;
alter table audit_log                      add column if not exists venue_id uuid;

alter table analytics_insights             alter column venue_id set default app.current_venue_or_default();
alter table analytics_patterns             alter column venue_id set default app.current_venue_or_default();
alter table analytics_insight_rejections   alter column venue_id set default app.current_venue_or_default();
alter table telegram_outbox                alter column venue_id set default app.current_venue_or_default();
alter table telegram_actions               alter column venue_id set default app.current_venue_or_default();
alter table manager_alerts                 alter column venue_id set default app.current_venue_or_default();
alter table degraded_periods               alter column venue_id set default app.current_venue_or_default();
alter table audit_log                      alter column venue_id set default app.current_venue_or_default();

comment on column analytics_insights.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — the nightly analytics job and app.save_analytics_insights write it; a cron tick has no caller, so it files at the default venue rather than raising (R1).';
comment on column analytics_patterns.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — written by the same nightly job as analytics_insights; a cron tick has no caller, so it files at the default venue rather than raising (R1).';
comment on column analytics_insight_rejections.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — written beside analytics_insights by the same owner-facing path and by the job that prunes them; never raise on a background write (R1).';
comment on column telegram_outbox.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — the sender drains it as service_role and the enqueue side runs from cron; a queue write must not fail because nobody is signed in (R1).';
comment on column telegram_actions.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — the Telegram webhook writes it as service_role with no Supabase identity at all (R1).';
comment on column manager_alerts.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — every sweep and every background guard writes an alert; an alert that cannot be filed is an alert nobody sees (R1).';
comment on column degraded_periods.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — app.sweep_degraded_periods runs from cron; degraded mode must be recordable with no caller present (R1).';
comment on column audit_log.venue_id is
  '0126 (multi-venue slice 1): defaults to app.current_venue_or_default(), not
  app.current_venue() — cron sweeps and service_role paths audit too, and an audit row is never worth refusing a write over (R1).';

-- ---------------------------------------------------------------------------
-- 3. venue_settings — the singleton the default venue was built from. One row
--    through slice 1; the platform_settings split is slice 2.
-- ---------------------------------------------------------------------------
alter table venue_settings add column if not exists venue_id uuid;
alter table venue_settings alter column venue_id set default app.default_venue();

update venue_settings set venue_id = app.default_venue() where id;

comment on column venue_settings.venue_id is
  '0126 (multi-venue slice 1): the venue this singleton describes — the one 0122 built
  from it. venue_settings keeps its boolean primary key and stays ONE ROW through slice
  1; slice 2 splits the platform-wide knobs into platform_settings and re-issues the 35
  functions that read this table unqualified.';
