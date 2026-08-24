-- 0007_courts_rates — courts, rate rules, per-duration prices, app.price_slot.
-- Pricing is PRICE PROVENANCE by design: bookings snapshot (rate_rule_id, price_iqd)
-- so a historical price is explainable forever; rules are soft-retired, never deleted.

create table courts (
  id               uuid primary key default gen_random_uuid(),
  name_en          text not null,
  name_ar          text not null,
  description_en   text,
  description_ar   text,
  indoor           boolean not null default true,
  photo_path       text,                       -- Supabase Storage key
  duration_options int[] not null default '{60,90,120}',   -- minutes
  sort_order       int not null default 0,
  is_active        boolean not null default true
);

create table rate_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                  -- 'Weekday off-peak' — internal, staff-facing
  court_id     uuid references courts(id),     -- NULL = all courts
  days_of_week int[] not null,                 -- 0=Sun..6=Sat, venue-local
  start_time   time not null,
  end_time     time not null,
  priority     int not null default 0,         -- highest priority wins on overlap
  valid_from   date,
  valid_to     date,
  is_active    boolean not null default true
);

create table rate_rule_prices (                -- per-duration absolute prices, not multipliers
  rule_id      uuid not null references rate_rules(id) on delete cascade,
  duration_min int not null,
  price_iqd    iqd not null,
  primary key (rule_id, duration_min)
);

create index rate_rules_active on rate_rules (court_id, priority desc) where is_active;

-- ---------------------------------------------------------------------------
-- app.price_slot — resolve the winning rate rule for (court, start, duration).
-- Court-specific beats NULL-court, then priority. Day-of-week and time window are
-- venue-local (venue_settings.timezone). Overnight windows (start > end) wrap.
-- Returns zero rows when no rule prices this duration/slot.
-- ---------------------------------------------------------------------------
create or replace function app.price_slot(p_court_id uuid, p_start_at timestamptz, p_duration_min int)
returns table (rule_id uuid, price_iqd bigint)
language sql stable security definer set search_path = public as $$
  with loc as (
    select p_start_at at time zone coalesce((select timezone from venue_settings), 'Asia/Baghdad') as lts
  )
  select r.id, (p.price_iqd)::bigint
    from rate_rules r
    join rate_rule_prices p on p.rule_id = r.id and p.duration_min = p_duration_min
    cross join loc
   where r.is_active
     and (r.court_id is null or r.court_id = p_court_id)
     and extract(dow from loc.lts)::int = any (r.days_of_week)
     and ( (r.start_time <= r.end_time and loc.lts::time >= r.start_time and loc.lts::time < r.end_time)
        or (r.start_time >  r.end_time and (loc.lts::time >= r.start_time or loc.lts::time < r.end_time)) )
     and (r.valid_from is null or loc.lts::date >= r.valid_from)
     and (r.valid_to   is null or loc.lts::date <= r.valid_to)
   order by (r.court_id is not null) desc, r.priority desc, r.id
   limit 1
$$;

revoke all on function app.price_slot(uuid, timestamptz, int) from public;
grant execute on function app.price_slot(uuid, timestamptz, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS: public read of active rows; staff see everything; writes are
-- RPC-only (admin CRUD lands with the admin drop).
-- ---------------------------------------------------------------------------
alter table courts enable row level security;
alter table rate_rules enable row level security;
alter table rate_rule_prices enable row level security;

grant select on courts, rate_rules, rate_rule_prices to anon, authenticated;

create policy courts_read on courts for select to anon, authenticated
  using (is_active or app.is_staff('cashier','prep','court_desk','manager','owner'));

create policy rate_rules_read on rate_rules for select to anon, authenticated
  using (is_active or app.is_staff('cashier','prep','court_desk','manager','owner'));

create policy rate_rule_prices_read on rate_rule_prices for select to anon, authenticated
  using (exists (
    select 1 from rate_rules r
     where r.id = rule_id
       and (r.is_active or app.is_staff('cashier','prep','court_desk','manager','owner'))
  ));
