-- 0006_settings_tax — venue_settings singleton, tax groups, public settings view.
--
-- RESOLVED OVERRIDE #1: cash_rounding_iqd DEFAULT 1 (rounding OFF). Even bill
-- splits use exact integer largest-remainder allocation (packages/core), NOT the
-- 250-IQD scheme sketched in design-data.md §2. The knob exists if Touch asks.

create table venue_settings (                  -- singleton
  id                           boolean primary key default true check (id),
  venue_name                   text not null,
  currency                     char(3) not null default 'IQD',
  timezone                     text not null default 'Asia/Baghdad',
  opening_hours                jsonb not null, -- {"mon":[["09:00","23:00"]],...} config blob
  closed_dates                 date[] not null default '{}',
  hold_ttl_seconds             int not null default 300,
  protected_horizon_hours      int not null default 48,   -- degraded-mode lockout window
  heartbeat_stale_seconds      int not null default 45,   -- till POSTs every 10s; stale past this
  table_token_ttl_minutes      int not null default 90,   -- guest session inactivity expiry
  waiter_call_cooldown_seconds int not null default 120,
  cancellation_window_hours    int not null default 12,
  cash_rounding_iqd            int not null default 1,    -- 1 = no rounding (override #1)
  expiring_soon_days           int not null default 3,
  tax_inclusive                boolean not null default false
);

-- Singleton row exists from the moment the schema does; seed.sql upserts values.
insert into venue_settings (venue_name, opening_hours)
values ('Touch Padel',
        '{"mon":[["09:00","23:00"]],"tue":[["09:00","23:00"]],"wed":[["09:00","23:00"]],
          "thu":[["09:00","23:00"]],"fri":[["09:00","23:00"]],"sat":[["09:00","23:00"]],
          "sun":[["09:00","23:00"]]}'::jsonb)
on conflict (id) do nothing;

create table tax_groups (
  id        uuid primary key default gen_random_uuid(),
  name_en   text not null,
  name_ar   text not null,
  rate_bp   smallint not null default 0 check (rate_bp between 0 and 10000),  -- 1000 = 10%
  is_active boolean not null default true      -- seed ships 'Restaurant 10%' inactive
);

-- ---------------------------------------------------------------------------
-- Public settings view: the ONLY venue_settings surface anon may read
-- (opening hours, horizon, policy windows — no operational knobs).
-- Definer-style view (security_invoker off): owner read bypasses base-table RLS.
-- ---------------------------------------------------------------------------
create view venue_settings_public with (security_invoker = off) as
select venue_name,
       currency,
       timezone,
       opening_hours,
       closed_dates,
       protected_horizon_hours,
       cancellation_window_hours,
       table_token_ttl_minutes
  from venue_settings;

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------
alter table venue_settings enable row level security;
alter table tax_groups enable row level security;

-- venue_settings: staff read the full row; updates are RPC-only (admin drop).
grant select on venue_settings to authenticated;
create policy venue_settings_staff_read on venue_settings for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));

grant select on venue_settings_public to anon, authenticated;

-- tax_groups: everyone reads active groups; staff also see retired ones.
grant select on tax_groups to anon, authenticated;
create policy tax_groups_read on tax_groups for select to anon, authenticated
  using (is_active or app.is_staff('cashier','prep','court_desk','manager','owner'));
