set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0330 — The owner assistant reads closed days from a stored copy
-- (owner call 2026-10-09: "fetch once, then only what came after the most
-- recent fetch").
--
-- Why. Every question used to re-run the report RPCs over the whole range,
-- and a long range (a quarter of per-day rows) is the biggest thing the
-- model reads. A closed business day does not change, so its headline
-- figures are computed once and kept; a question about a long range then
-- reads the kept days and computes only the days after the newest kept one.
--
-- What.
--   * assistant_cache_config   one row: the switch (OFF), the freeze lag (3
--                              days: a day is kept only once it is that far in
--                              the past, so a late refund or correction near
--                              the present is always read live), when init ran.
--   * assistant_day_facts      one row per (scope, business day): the 21 flow
--                              keys app.reports_figures returns for that day
--                              (the panel's own figures), scope = one branch
--                              id or 'all:<hash of the branch set>' so a
--                              change in the branch set is a cache miss, never
--                              a stale answer. Both tables ship EMPTY and the
--                              switch OFF: nothing is stored until
--                              app.assistant_cache_init() runs (owner call:
--                              fill it only when told, once real data exists).
--   * app.assistant_history_figures(from, to, group, extra) — the new tool
--                              `history_figures`: buckets (day/week/month, at
--                              most 31) of the headline figures with totals.
--                              Kept days are read from assistant_day_facts, the
--                              rest through app.reports_figures; says how many
--                              came from where. Read-only (the dispatcher's
--                              wall), so it never writes the cache.
--   * assistant_day_detail     the same idea for three row-heavy reports, one compact
--                              additive row per (scope, family, day): items (café
--                              items sold), courts (counts, booked and open minutes,
--                              hourly cells) and staff (discounts, voids, refunds,
--                              orders, payments, bookings per person). Tools
--                              history_items, history_courts and history_staff.
--   * app.assistant_cache_fill(p_max_days) — the only writer: stores the days
--                              missing between the first day with data and
--                              today minus the freeze lag, newest first, at
--                              most p_max_days per call, for each scope.
--                              Does nothing while the switch is off. Cron
--                              tp_assistant_cache_fill runs it nightly, so the
--                              daily top-up is the "after the latest" fetch.
--   * app.assistant_cache_init / _clear / _invalidate / _status — service
--                              role: switch on and fill, empty and switch off,
--                              drop a date range to be recomputed, report.
--
-- app.assistant_run_tool is re-issued from its latest body (0328:207) with one
-- `when` branch and the dollar tag 0330. Nothing here has a client grant.

-- ---------------------------------------------------------------------------
-- 1. Tables (new, empty: the primary-key index is the only index, so no
--    separate create index is needed)
-- ---------------------------------------------------------------------------
create table if not exists assistant_cache_config (
  id             boolean primary key default true check (id),
  enabled        boolean not null default false,
  freeze_days    int not null default 3 check (freeze_days between 1 and 30),
  initialised_at timestamptz,
  last_fill_at   timestamptz
);

comment on table assistant_cache_config is
  '0330. One row. The owner assistant''s stored-days cache: enabled (OFF until app.assistant_cache_init), freeze_days (a business day is kept only once it is this many days in the past), when init ran and when the last fill ran. Written by the service-role cache RPCs only.';
comment on column assistant_cache_config.id is 'Always true: the single-row key.';
comment on column assistant_cache_config.enabled is 'False until app.assistant_cache_init(); while false app.assistant_history_figures reads every day live and app.assistant_cache_fill stores nothing.';
comment on column assistant_cache_config.freeze_days is 'A day older than today minus this many business days is final enough to keep (late refunds and corrections land within it). Default 3.';
comment on column assistant_cache_config.initialised_at is 'When app.assistant_cache_init first switched the cache on; null while it never has.';
comment on column assistant_cache_config.last_fill_at is 'When app.assistant_cache_fill last stored a day.';

insert into assistant_cache_config (id) values (true) on conflict (id) do nothing;

create table if not exists assistant_day_facts (
  scope         text not null,
  business_date date not null,
  facts         jsonb not null,
  computed_at   timestamptz not null default now(),
  primary key (scope, business_date)
);

comment on table assistant_day_facts is
  '0330. The owner assistant''s stored days: the flow figures app.reports_figures returned for ONE closed business day at one report scope. Empty until app.assistant_cache_init(); written only by app.assistant_cache_fill; read by app.assistant_history_figures. Never holds guest identity.';
comment on column assistant_day_facts.scope is 'One branch id (text), or all:<md5 of the sorted branch ids> for a multi-branch scope, so a changed branch set is a miss.';
comment on column assistant_day_facts.business_date is 'The business day (venue clock), at least freeze_days in the past when stored.';
comment on column assistant_day_facts.facts is 'The panel headline keys for that one day: revenue, padelRevenue, cafeRevenue, cafeNet, cash, card, bookings, orders, discounts, refunds, waste, noShows, onlineDeposits, depositForfeits, ticketSales, ticketRefunds, ticketForfeits, matchWrittenOff, lessonRevenue, owedToCoaches (ticketLiability is a balance, not a day flow, and is not stored).';
comment on column assistant_day_facts.computed_at is 'When this row was computed; app.assistant_cache_invalidate drops a range so the next fill recomputes it.';

alter table assistant_cache_config enable row level security;
alter table assistant_day_facts enable row level security;
revoke all on assistant_cache_config from public, anon, authenticated;
revoke all on assistant_day_facts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The scope key of a branch set
-- ---------------------------------------------------------------------------
create or replace function app.assistant_cache_scope(p_venues uuid[])
returns text
language sql immutable set search_path = public as $assistant_cache_scope_0330$
  select case
           when cardinality(p_venues) = 1 then p_venues[1]::text
           else 'all:' || md5(coalesce((select string_agg(v::text, ',' order by v) from unnest(p_venues) v), ''))
         end
$assistant_cache_scope_0330$;

comment on function app.assistant_cache_scope(uuid[]) is
  '0330. Internal. The assistant_day_facts scope key of a branch set: the branch id for one branch, otherwise all: plus the md5 of the sorted ids.';

revoke all on function app.assistant_cache_scope(uuid[]) from public, anon, authenticated;
grant execute on function app.assistant_cache_scope(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_history_figures — the read path (tool history_figures)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_history_figures(
  p_from  date,
  p_to    date,
  p_group text default 'day',
  p_extra boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_history_figures_0330$
declare
  v_rv      uuid[];
  v_scope   text;
  v_cfg     assistant_cache_config%rowtype;
  v_enabled boolean;
  v_edge    date;
  v_group   text := coalesce(p_group, 'day');
  v_keys    text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','bookings','orders','discounts','refunds','waste','noShows'];
  v_more    text[] := array['onlineDeposits','depositForfeits','ticketSales','ticketRefunds','ticketForfeits','matchWrittenOff','lessonRevenue','owedToCoaches'];
  v_live    jsonb := '[]'::jsonb;
  isl       record;
  v_buckets int;
  v_days    int;
  v_cached  int;
  v_newest  date;
  v_rows    jsonb;
  v_tot     jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  if v_group not in ('day', 'week', 'month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_group', hint = 'day, week or month';
  end if;
  if coalesce(p_extra, false) then
    v_keys := v_keys || v_more;
  end if;

  select count(distinct case v_group when 'day' then d::date
                                     when 'week' then date_trunc('week', d)::date
                                     else date_trunc('month', d)::date end)
    into v_buckets
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;
  if v_buckets > 31 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = format('%s buckets; at most 31 (use group week or month for a longer range)', v_buckets);
  end if;

  v_rv    := app.report_venues();
  v_scope := app.assistant_cache_scope(v_rv);
  select * into v_cfg from assistant_cache_config where id;
  v_enabled := coalesce(v_cfg.enabled, false);
  v_edge    := app.business_date(now()) - coalesce(v_cfg.freeze_days, 3);

  -- The days not kept (cache off, empty, or inside the freeze lag), in runs
  -- per bucket: each run is one reports_figures call.
  for isl in
    select x.b, min(x.d) as lo, max(x.d) as hi, count(*)::int as n
      from (select c.b, c.d, c.d - (row_number() over (partition by c.b order by c.d))::int as g
              from (select gr.d, gr.b, f.facts
                      from (select d::date as d,
                                   case v_group when 'day' then d::date
                                                when 'week' then date_trunc('week', d)::date
                                                else date_trunc('month', d)::date end as b
                              from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d) gr
                      left join assistant_day_facts f
                        on v_enabled and f.scope = v_scope and f.business_date = gr.d and gr.d <= v_edge) c
             where c.facts is null) x
     group by x.b, x.g
  loop
    v_live := v_live || jsonb_build_array(jsonb_build_object('b', isl.b, 'n', isl.n, 'facts', app.reports_figures(isl.lo, isl.hi)));
  end loop;

  with cached as (
    select gr.d, gr.b, f.facts
      from (select d::date as d,
                   case v_group when 'day' then d::date
                                when 'week' then date_trunc('week', d)::date
                                else date_trunc('month', d)::date end as b
              from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d) gr
      left join assistant_day_facts f
        on v_enabled and f.scope = v_scope and f.business_date = gr.d and gr.d <= v_edge),
  parts as (
    select c.b, 1 as n, c.facts from cached c where c.facts is not null
    union all
    select (e ->> 'b')::date, (e ->> 'n')::int, e -> 'facts' from jsonb_array_elements(v_live) e),
  per_key as (
    select p.b, k.key, sum((p.facts ->> k.key)::bigint) as v
      from parts p cross join unnest(v_keys) as k(key)
     group by p.b, k.key),
  per_b as (select p.b, sum(p.n)::int as days from parts p group by p.b),
  rowsq as (
    select pb.b, pb.days, jsonb_object_agg(pk.key, pk.v) as vals
      from per_b pb join per_key pk on pk.b = pb.b
     group by pb.b, pb.days),
  tot as (select jsonb_object_agg(t.key, t.v) as vals from (select key, sum(v) as v from per_key group by key) t)
  select (select coalesce(jsonb_agg(jsonb_build_object('period', r.b, 'days', r.days) || r.vals
                 || jsonb_build_object('avgOrderValue', case when (r.vals ->> 'orders')::bigint > 0
                                                              then round((r.vals ->> 'cafeRevenue')::numeric / (r.vals ->> 'orders')::bigint)::bigint
                                                              else 0 end)
                 order by r.b), '[]'::jsonb) from rowsq r),
         (select t.vals || jsonb_build_object('avgOrderValue', case when (t.vals ->> 'orders')::bigint > 0
                                                                     then round((t.vals ->> 'cafeRevenue')::numeric / (t.vals ->> 'orders')::bigint)::bigint
                                                                     else 0 end) from tot t),
         (select count(*)::int from cached c where c.facts is not null),
         (select max(c.d) from cached c where c.facts is not null),
         (select count(*)::int from cached c)
    into v_rows, v_tot, v_cached, v_newest, v_days;

  return jsonb_build_object(
    'group', v_group,
    'from',  p_from,
    'to',    p_to,
    'cache', jsonb_build_object('on', v_enabled, 'days_from_cache', v_cached, 'days_read_live', v_days - v_cached, 'newest_cached_day', v_newest),
    'rows',  coalesce(v_rows, '[]'::jsonb),
    'totals', coalesce(v_tot, '{}'::jsonb));
end $assistant_history_figures_0330$;

comment on function app.assistant_history_figures(date, date, text, boolean) is
  '0330. Owner-only, read-only, reached through app.assistant_run_tool (tool history_figures). The headline figures of a business-day range in day, week or month buckets (at most 31) with totals and avgOrderValue (cafeRevenue per order). Days at least freeze_days old are read from assistant_day_facts when the cache is on and has them; every other day goes through app.reports_figures, so the numbers equal the panel''s. p_extra adds deposits, ticket, match write-off and lesson keys. cache says how many days came from where. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.assistant_history_figures(date, date, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3b. The detail families (items, courts, staff): the same stored-days idea
--     for the three reports that return the most rows.
--
--   items   one compact row per menu item sold that day (app.analytics_sold_items, settled basis)
--   courts  the day's court counts, booked and open minutes and the hourly cells (app.analytics_courts_summary)
--   staff   one row per person with activity that day (app.report_staff_activity)
--
-- Every family is stored in a compact ADDITIVE form, so a range is the sum of
-- its days: kept days are read from assistant_day_detail, the days after the
-- newest kept one go through the same report RPC once per run, and
-- app.assistant_detail_merge adds the parts together.
-- ---------------------------------------------------------------------------
create table if not exists assistant_day_detail (
  scope         text not null,
  family        text not null check (family in ('items', 'courts', 'staff')),
  business_date date not null,
  data          jsonb not null,
  computed_at   timestamptz not null default now(),
  primary key (scope, family, business_date)
);

comment on table assistant_day_detail is
  '0330. Stored closed days of the assistant''s three detail reports, one row per scope, family and business day, in an additive compact form. Empty until app.assistant_cache_init(); written only by app.assistant_cache_fill together with the day''s assistant_day_facts row; read by app.assistant_detail_collect. Never holds guest identity.';
comment on column assistant_day_detail.scope is 'Same key as assistant_day_facts.scope.';
comment on column assistant_day_detail.family is 'items, courts or staff.';
comment on column assistant_day_detail.business_date is 'The business day (venue clock), at least freeze_days in the past when stored.';
comment on column assistant_day_detail.data is 'items: [{i item id, n name_en, a name_ar, q qty, r revenue_iqd}]. courts: {bk bookings, ns no-shows, cx cancellations, bm booked minutes, lm lesson minutes, rev revenue_iqd, om open minutes, hours [{h, bk, bm, om, rev}]}. staff: [{i staff id, n name, ro role, dc/di discounts count/iqd, vc/vi voids, rc/ri refunds, o orders, p payments, b bookings}].';
comment on column assistant_day_detail.computed_at is 'When this row was computed.';

alter table assistant_day_detail enable row level security;
revoke all on assistant_day_detail from public, anon, authenticated;

create or replace function app.assistant_detail_compute(p_family text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_detail_compute_0330$
declare
  v jsonb;
  c jsonb;
begin
  if p_family = 'items' then
    select coalesce(jsonb_agg(jsonb_build_object('i', t.id, 'n', t.n, 'a', t.a, 'q', t.q, 'r', t.r) order by t.r desc, t.id), '[]'::jsonb)
      into v
      from (select e ->> 'menu_item_id' as id, max(e ->> 'name_en') as n, max(e ->> 'name_ar') as a,
                   sum((e ->> 'qty')::bigint) as q, sum((e ->> 'revenue_iqd')::bigint) as r
              from jsonb_array_elements(app.analytics_sold_items(p_from, p_to, 'settled')) e
             group by 1) t;
  elsif p_family = 'courts' then
    c := app.analytics_courts_summary(p_from, p_to, null);
    v := jsonb_build_object(
           'bk',  coalesce((c #>> '{kpis,bookings}')::bigint, 0),
           'ns',  coalesce((c #>> '{kpis,no_shows}')::bigint, 0),
           'cx',  coalesce((c #>> '{kpis,cancellations}')::bigint, 0),
           'bm',  coalesce((c #>> '{kpis,booked_minutes}')::bigint, 0),
           'lm',  coalesce((c #>> '{kpis,lesson_minutes}')::bigint, 0),
           'rev', coalesce((c #>> '{kpis,revenue_iqd}')::bigint, 0),
           'om',  coalesce((c ->> 'open_minutes')::bigint, 0),
           'hours', coalesce((select jsonb_agg(jsonb_build_object('h', x.h, 'bk', x.bk, 'bm', x.bm, 'om', x.om, 'rev', x.rev) order by x.h)
                                from (select (e ->> 'hour')::int as h, sum((e ->> 'bookings')::bigint) as bk,
                                             sum((e ->> 'booked_minutes')::bigint) as bm, sum((e ->> 'open_minutes')::bigint) as om,
                                             sum((e ->> 'revenue_iqd')::bigint) as rev
                                        from jsonb_array_elements(c -> 'heatmap') e group by 1) x), '[]'::jsonb));
  elsif p_family = 'staff' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'i', e ->> 'staffId', 'n', e ->> 'name', 'ro', e ->> 'role',
             'dc', coalesce((e #>> '{discounts,count}')::bigint, 0), 'di', coalesce((e #>> '{discounts,amountIqd}')::bigint, 0),
             'vc', coalesce((e #>> '{voids,count}')::bigint, 0),     'vi', coalesce((e #>> '{voids,amountIqd}')::bigint, 0),
             'rc', coalesce((e #>> '{refunds,count}')::bigint, 0),   'ri', coalesce((e #>> '{refunds,amountIqd}')::bigint, 0),
             'o',  coalesce((e ->> 'ordersTaken')::bigint, 0), 'p', coalesce((e ->> 'paymentsTaken')::bigint, 0),
             'b',  coalesce((e ->> 'bookingsCreated')::bigint, 0))), '[]'::jsonb)
      into v
      from jsonb_array_elements(app.report_staff_activity(p_from, p_to, null) -> 'rows') e
     where coalesce((e #>> '{discounts,count}')::bigint, 0) + coalesce((e #>> '{voids,count}')::bigint, 0)
         + coalesce((e #>> '{refunds,count}')::bigint, 0) + coalesce((e ->> 'ordersTaken')::bigint, 0)
         + coalesce((e ->> 'paymentsTaken')::bigint, 0) + coalesce((e ->> 'bookingsCreated')::bigint, 0) > 0;
  else
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_family';
  end if;
  return v;
end $assistant_detail_compute_0330$;

comment on function app.assistant_detail_compute(text, date, date) is
  '0330. Internal. The compact additive form of one detail family (items, courts, staff) for a business-day range, from the same report RPC the pages use, at the report scope of the caller. Used by the read path for days not kept and by app.assistant_cache_fill for the days it keeps.';

revoke all on function app.assistant_detail_compute(text, date, date) from public, anon, authenticated;
grant execute on function app.assistant_detail_compute(text, date, date) to service_role;

create or replace function app.assistant_detail_merge(p_family text, p_parts jsonb)
returns jsonb
language plpgsql stable set search_path = public as $assistant_detail_merge_0330$
declare
  v jsonb;
begin
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then
    return case p_family when 'courts' then '{"bk":0,"ns":0,"cx":0,"bm":0,"lm":0,"rev":0,"om":0,"hours":[]}'::jsonb else '[]'::jsonb end;
  end if;
  if p_family = 'items' then
    select coalesce(jsonb_agg(jsonb_build_object('i', t.i, 'n', t.n, 'a', t.a, 'q', t.q, 'r', t.r) order by t.r desc, t.i), '[]'::jsonb)
      into v
      from (select e ->> 'i' as i, max(e ->> 'n') as n, max(e ->> 'a') as a, sum((e ->> 'q')::bigint) as q, sum((e ->> 'r')::bigint) as r
              from jsonb_array_elements(p_parts) part, jsonb_array_elements(part) e
             group by 1) t;
  elsif p_family = 'staff' then
    select coalesce(jsonb_agg(jsonb_build_object('i', t.i, 'n', t.n, 'ro', t.ro, 'dc', t.dc, 'di', t.di, 'vc', t.vc, 'vi', t.vi,
                                                 'rc', t.rc, 'ri', t.ri, 'o', t.o, 'p', t.p, 'b', t.b) order by t.di + t.vi + t.ri desc, t.i), '[]'::jsonb)
      into v
      from (select e ->> 'i' as i, max(e ->> 'n') as n, max(e ->> 'ro') as ro,
                   sum((e ->> 'dc')::bigint) as dc, sum((e ->> 'di')::bigint) as di, sum((e ->> 'vc')::bigint) as vc, sum((e ->> 'vi')::bigint) as vi,
                   sum((e ->> 'rc')::bigint) as rc, sum((e ->> 'ri')::bigint) as ri, sum((e ->> 'o')::bigint) as o,
                   sum((e ->> 'p')::bigint) as p, sum((e ->> 'b')::bigint) as b
              from jsonb_array_elements(p_parts) part, jsonb_array_elements(part) e
             group by 1) t;
  elsif p_family = 'courts' then
    select jsonb_build_object(
             'bk', coalesce(sum((part ->> 'bk')::bigint), 0), 'ns', coalesce(sum((part ->> 'ns')::bigint), 0),
             'cx', coalesce(sum((part ->> 'cx')::bigint), 0), 'bm', coalesce(sum((part ->> 'bm')::bigint), 0),
             'lm', coalesce(sum((part ->> 'lm')::bigint), 0), 'rev', coalesce(sum((part ->> 'rev')::bigint), 0),
             'om', coalesce(sum((part ->> 'om')::bigint), 0),
             'hours', coalesce((select jsonb_agg(jsonb_build_object('h', x.h, 'bk', x.bk, 'bm', x.bm, 'om', x.om, 'rev', x.rev) order by x.h)
                                  from (select (e ->> 'h')::int as h, sum((e ->> 'bk')::bigint) as bk, sum((e ->> 'bm')::bigint) as bm,
                                               sum((e ->> 'om')::bigint) as om, sum((e ->> 'rev')::bigint) as rev
                                          from jsonb_array_elements(p_parts) pp, jsonb_array_elements(pp -> 'hours') e group by 1) x), '[]'::jsonb))
      into v
      from jsonb_array_elements(p_parts) part;
  else
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_family';
  end if;
  return v;
end $assistant_detail_merge_0330$;

comment on function app.assistant_detail_merge(text, jsonb) is
  '0330. Internal. Adds the compact forms of a detail family (an array of parts) into one: items and staff by id, courts by field and hour.';

revoke all on function app.assistant_detail_merge(text, jsonb) from public, anon, authenticated;
grant execute on function app.assistant_detail_merge(text, jsonb) to service_role;

-- The read path shared by the three history tools: buckets (range, day, week
-- or month) of one family, kept days from assistant_day_detail, the rest live.
create or replace function app.assistant_detail_collect(p_family text, p_from date, p_to date, p_group text)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_detail_collect_0330$
declare
  v_rv      uuid[];
  v_scope   text;
  v_cfg     assistant_cache_config%rowtype;
  v_enabled boolean;
  v_edge    date;
  v_live    jsonb := '[]'::jsonb;
  isl       record;
  v_buckets int;
  v_out     jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = 'from..to must be at most 400 days';
  end if;
  if p_group not in ('range', 'day', 'week', 'month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_group', hint = 'range, day, week or month';
  end if;
  select count(distinct case p_group when 'range' then p_from when 'day' then d::date
                                     when 'week' then date_trunc('week', d)::date else date_trunc('month', d)::date end)
    into v_buckets
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d;
  if v_buckets > 31 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', hint = format('%s buckets; at most 31 (use group week or month for a longer range)', v_buckets);
  end if;

  v_rv    := app.report_venues();
  v_scope := app.assistant_cache_scope(v_rv);
  select * into v_cfg from assistant_cache_config where id;
  v_enabled := coalesce(v_cfg.enabled, false);
  v_edge    := app.business_date(now()) - coalesce(v_cfg.freeze_days, 3);

  for isl in
    select x.b, min(x.d) as lo, max(x.d) as hi, count(*)::int as n
      from (select c.b, c.d, c.d - (row_number() over (partition by c.b order by c.d))::int as g
              from (select gr.d, gr.b, f.data
                      from (select d::date as d,
                                   case p_group when 'range' then p_from when 'day' then d::date
                                                when 'week' then date_trunc('week', d)::date
                                                else date_trunc('month', d)::date end as b
                              from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d) gr
                      left join assistant_day_detail f
                        on v_enabled and f.scope = v_scope and f.family = p_family and f.business_date = gr.d and gr.d <= v_edge) c
             where c.data is null) x
     group by x.b, x.g
  loop
    v_live := v_live || jsonb_build_array(jsonb_build_object('b', isl.b, 'n', isl.n, 'data', app.assistant_detail_compute(p_family, isl.lo, isl.hi)));
  end loop;

  with stored as (
    select gr.d, gr.b, f.data
      from (select d::date as d,
                   case p_group when 'range' then p_from when 'day' then d::date
                                when 'week' then date_trunc('week', d)::date
                                else date_trunc('month', d)::date end as b
              from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d) gr
      left join assistant_day_detail f
        on v_enabled and f.scope = v_scope and f.family = p_family and f.business_date = gr.d and gr.d <= v_edge),
  parts as (
    select s.b, 1 as n, s.data from stored s where s.data is not null
    union all
    select (e ->> 'b')::date, (e ->> 'n')::int, e -> 'data' from jsonb_array_elements(v_live) e),
  per as (
    select p.b, sum(p.n)::int as days, app.assistant_detail_merge(p_family, jsonb_agg(p.data)) as data
      from parts p group by p.b)
  select jsonb_build_object(
           'buckets', coalesce((select jsonb_agg(jsonb_build_object('b', per.b, 'days', per.days, 'data', per.data) order by per.b) from per), '[]'::jsonb),
           'total',   app.assistant_detail_merge(p_family, (select jsonb_agg(p.data) from parts p)),
           'cache',   jsonb_build_object('on', v_enabled,
                                         'days_from_cache', (select count(*) from stored s where s.data is not null),
                                         'days_read_live',  (select count(*) from stored s where s.data is null),
                                         'newest_cached_day', (select max(s.d) from stored s where s.data is not null)))
    into v_out;
  return v_out;
end $assistant_detail_collect_0330$;

comment on function app.assistant_detail_collect(text, date, date, text) is
  '0330. Internal (reached through the three history tools). {buckets:[{b, days, data}], total, cache} for one detail family over a range grouped as range, day, week or month (at most 31 buckets): kept days from assistant_day_detail when the cache is on, the rest through app.assistant_detail_compute. Owner only. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.assistant_detail_collect(text, date, date, text) from public, anon, authenticated;

-- history_items
create or replace function app.assistant_history_items(p_from date, p_to date, p_limit int default 10, p_order text default 'revenue')
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_history_items_0330$
declare
  c       jsonb;
  v_n     int := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_order text := coalesce(p_order, 'revenue');
  v_qty   bigint;
  v_rev   bigint;
begin
  if v_order not in ('revenue', 'qty') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_order', hint = 'revenue or qty';
  end if;
  c := app.assistant_detail_collect('items', p_from, p_to, 'range');
  select coalesce(sum((e ->> 'q')::bigint), 0), coalesce(sum((e ->> 'r')::bigint), 0)
    into v_qty, v_rev from jsonb_array_elements(c -> 'total') e;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'order', v_order,
    'cache', c -> 'cache',
    'total', jsonb_build_object('items', jsonb_array_length(c -> 'total'), 'qty', v_qty, 'revenue_iqd', v_rev),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('item_id', t.i, 'name_en', t.n, 'name_ar', t.a, 'qty', t.q, 'revenue_iqd', t.r,
                                                        'share_pct', case when v_rev > 0 then round(t.r * 100.0 / v_rev, 1) else 0 end) order by t.k desc, t.i)
                        from (select e ->> 'i' as i, e ->> 'n' as n, e ->> 'a' as a, (e ->> 'q')::bigint as q, (e ->> 'r')::bigint as r,
                                     case v_order when 'qty' then (e ->> 'q')::bigint else (e ->> 'r')::bigint end as k
                                from jsonb_array_elements(c -> 'total') e
                               order by 6 desc, 1 limit v_n) t), '[]'::jsonb));
end $assistant_history_items_0330$;

comment on function app.assistant_history_items(date, date, int, text) is
  '0330. Owner-only, read-only, reached through app.assistant_run_tool (tool history_items). The top café items of a business-day range by revenue or quantity with each item''s share of the café total, settled basis (the analytics pages'' own numbers). Kept days come from assistant_day_detail, the rest live; cache says which.';

revoke all on function app.assistant_history_items(date, date, int, text) from public, anon, authenticated;

-- history_courts
create or replace function app.assistant_history_courts(p_from date, p_to date, p_group text default 'range', p_hours boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_history_courts_0330$
declare
  c jsonb;
  t jsonb;
begin
  c := app.assistant_detail_collect('courts', p_from, p_to, coalesce(p_group, 'range'));
  t := c -> 'total';
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'group', coalesce(p_group, 'range'),
    'cache', c -> 'cache',
    'total', jsonb_build_object(
      'bookings', t -> 'bk', 'no_shows', t -> 'ns', 'cancellations', t -> 'cx',
      'booked_hours', round(((t ->> 'bm')::numeric) / 60, 1), 'lesson_hours', round(((t ->> 'lm')::numeric) / 60, 1),
      'open_hours', round(((t ->> 'om')::numeric) / 60, 1),
      'occupancy_pct', case when (t ->> 'om')::bigint > 0 then round((t ->> 'bm')::numeric * 100 / (t ->> 'om')::numeric, 1) else 0 end,
      'revenue_iqd', t -> 'rev',
      'iqd_per_booked_hour', case when (t ->> 'bm')::bigint > 0 then round((t ->> 'rev')::numeric * 60 / (t ->> 'bm')::numeric)::bigint else 0 end),
    'rows', case when coalesce(p_group, 'range') = 'range' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                'period', b.b, 'days', b.days,
                'bookings', b.data -> 'bk', 'no_shows', b.data -> 'ns', 'cancellations', b.data -> 'cx',
                'booked_hours', round(((b.data ->> 'bm')::numeric) / 60, 1),
                'occupancy_pct', case when (b.data ->> 'om')::bigint > 0 then round((b.data ->> 'bm')::numeric * 100 / (b.data ->> 'om')::numeric, 1) else 0 end,
                'revenue_iqd', b.data -> 'rev') order by b.b)
              from jsonb_to_recordset(c -> 'buckets') as b(b date, days int, data jsonb)), '[]'::jsonb) end,
    'hours', case when coalesce(p_hours, false) then
               coalesce((select jsonb_agg(jsonb_build_object(
                           'hour', h.h, 'bookings', h.bk, 'booked_hours', round(h.bm / 60.0, 1),
                           'occupancy_pct', case when h.om > 0 then round(h.bm * 100.0 / h.om, 1) else 0 end,
                           'revenue_iqd', h.rev) order by h.h)
                         from jsonb_to_recordset(t -> 'hours') as h(h int, bk bigint, bm bigint, om bigint, rev bigint)
                        where h.om > 0), '[]'::jsonb) end);
end $assistant_history_courts_0330$;

comment on function app.assistant_history_courts(date, date, text, boolean) is
  '0330. Owner-only, read-only, reached through app.assistant_run_tool (tool history_courts). Court use over a business-day range, all courts of the branches in scope: bookings, no-shows, cancellations, booked and open hours, occupancy (booked over open minutes, as the courts page computes it) and revenue per bucket (range, day, week or month; at most 31) with totals, and with p_hours the same by hour of the day. Kept days come from assistant_day_detail, the rest live.';

revoke all on function app.assistant_history_courts(date, date, text, boolean) from public, anon, authenticated;

-- history_staff
create or replace function app.assistant_history_staff(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_history_staff_0330$
declare
  c jsonb;
begin
  c := app.assistant_detail_collect('staff', p_from, p_to, 'range');
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'cache', c -> 'cache',
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'id', e ->> 'i', 'name', e ->> 'n', 'role', e ->> 'ro',
                'discounts', e -> 'dc', 'discount_iqd', e -> 'di', 'voids', e -> 'vc', 'void_iqd', e -> 'vi',
                'refunds', e -> 'rc', 'refund_iqd', e -> 'ri', 'orders', e -> 'o', 'payments', e -> 'p', 'bookings', e -> 'b'))
                from (select e from jsonb_array_elements(c -> 'total') e limit 30) s(e)), '[]'::jsonb));
end $assistant_history_staff_0330$;

comment on function app.assistant_history_staff(date, date) is
  '0330. Owner-only, read-only, reached through app.assistant_run_tool (tool history_staff). Per person over a business-day range: discounts, voids and refunds (count and IQD), orders taken, payments taken and bookings made, the largest discount, void and refund totals first, at most 30 people. Kept days come from assistant_day_detail, the rest live.';

revoke all on function app.assistant_history_staff(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.assistant_cache_fill — the only writer
-- ---------------------------------------------------------------------------
create or replace function app.assistant_cache_fill(p_max_days int default 31)
returns jsonb
language plpgsql security definer set search_path = public as $assistant_cache_fill_0330$
declare
  v_cfg     assistant_cache_config%rowtype;
  v_owner   uuid;
  v_edge    date;
  v_first   date;
  v_ts      timestamptz;
  v_header  text;
  v_scope   text;
  v_seen    text[] := '{}';
  v_d       date;
  v_budget  int := greatest(1, least(coalesce(p_max_days, 31), 400));
  v_filled  int := 0;
  v_pending int := 0;
  v_missing int;
  v_hdr0    text := current_setting('request.headers', true);
  v_sub0    text := current_setting('request.jwt.claim.sub', true);
  v_clm0    text := current_setting('request.jwt.claims', true);
begin
  select * into v_cfg from assistant_cache_config where id;
  if not found or not v_cfg.enabled then
    return jsonb_build_object('enabled', false, 'filled', 0, 'pending', 0, 'done', true);
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('assistant_cache_fill', 0)) then
    return jsonb_build_object('enabled', true, 'filled', 0, 'pending', null, 'done', false, 'busy', true);
  end if;

  -- Same stand-in as the nightly pre-warm (0141): the figures RPCs check the owner.
  select id into v_owner from staff where role = 'owner' and is_active order by created_at limit 1;
  if v_owner is null then
    raise exception 'OWNER_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_edge := app.business_date(now()) - v_cfg.freeze_days;
  v_ts := least((select min(r.start_at) from reservations r),
                (select min(o.placed_at) from orders o),
                (select min(p.created_at) from payments p));
  if v_ts is null then
    return jsonb_build_object('enabled', true, 'filled', 0, 'pending', 0, 'done', true);
  end if;
  -- At most two years back, and never before the first day with any data.
  v_first := greatest(app.business_date(v_ts), v_edge - 730);

  for v_header in select h from unnest(array['all'] || array(select id::text from venues order by created_at, id)) h loop
    perform set_config('request.headers', json_build_object('x-venue-scope', v_header)::text, true);
    v_scope := app.assistant_cache_scope(app.report_venues());
    continue when v_scope = any (v_seen);          -- one branch: 'all' and the branch are the same scope
    v_seen := v_seen || v_scope;

    for v_d in
      select g::date
        from generate_series(v_first::timestamp, v_edge::timestamp, interval '1 day') g
       where not exists (select 1 from assistant_day_facts f where f.scope = v_scope and f.business_date = g::date)
       order by 1 desc
       limit greatest(v_budget - v_filled, 0)
    loop
      insert into assistant_day_facts (scope, business_date, facts)
      values (v_scope, v_d, app.reports_figures(v_d, v_d) - 'ticketLiability')
      on conflict (scope, business_date) do nothing;
      insert into assistant_day_detail (scope, family, business_date, data)
      select v_scope, f, v_d, app.assistant_detail_compute(f, v_d, v_d)
        from unnest(array['items', 'courts', 'staff']) f
      on conflict (scope, family, business_date) do nothing;
      v_filled := v_filled + 1;
    end loop;

    select count(*)::int into v_missing
      from generate_series(v_first::timestamp, v_edge::timestamp, interval '1 day') g
     where not exists (select 1 from assistant_day_facts f where f.scope = v_scope and f.business_date = g::date);
    v_pending := v_pending + v_missing;
  end loop;

  -- Put the caller's request context back: the owner stand-in and the branch
  -- header are for the figures calls above only.
  perform set_config('request.headers', coalesce(v_hdr0, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub0, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_clm0, ''), true);

  if v_filled > 0 then
    update assistant_cache_config set last_fill_at = now() where id;
  end if;
  return jsonb_build_object('enabled', true, 'filled', v_filled, 'pending', v_pending, 'done', v_pending = 0);
end $assistant_cache_fill_0330$;

comment on function app.assistant_cache_fill(int) is
  '0330. Service role (and cron tp_assistant_cache_fill, nightly). While assistant_cache_config.enabled is false it stores nothing. Otherwise, for each report scope (every branch, and all of them), stores the days missing between the first day with data (at most two years back) and today minus freeze_days, newest first, at most p_max_days in this call; the nightly run therefore only ever adds the days after the newest stored one. Returns {enabled, filled, pending, done}; call again while done is false. Takes an advisory lock; runs the figures as the venue owner like the 0141 pre-warm.';

revoke all on function app.assistant_cache_fill(int) from public, anon, authenticated;
grant execute on function app.assistant_cache_fill(int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. init / clear / invalidate / status (service role)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_cache_init(p_max_days int default 31)
returns jsonb
language plpgsql security definer set search_path = public as $assistant_cache_init_0330$
begin
  update assistant_cache_config
     set enabled = true, initialised_at = coalesce(initialised_at, now())
   where id;
  return app.assistant_cache_fill(p_max_days);
end $assistant_cache_init_0330$;

comment on function app.assistant_cache_init(int) is
  '0330. Service role. The "cache init": switches the stored-days cache on and fills up to p_max_days; call it again (or run scripts/assistant-cache.mjs init) until the result says done. Not run by any migration: the cache ships empty and off.';

revoke all on function app.assistant_cache_init(int) from public, anon, authenticated;
grant execute on function app.assistant_cache_init(int) to service_role;

create or replace function app.assistant_cache_clear()
returns int
language plpgsql security definer set search_path = public as $assistant_cache_clear_0330$
declare
  v_n int;
begin
  delete from assistant_day_facts where business_date is not null;
  get diagnostics v_n = row_count;
  delete from assistant_day_detail where business_date is not null;
  update assistant_cache_config set enabled = false, initialised_at = null, last_fill_at = null where id;
  return v_n;
end $assistant_cache_clear_0330$;

comment on function app.assistant_cache_clear() is
  '0330. Service role. Empties assistant_day_facts and assistant_day_detail and switches the cache off; the assistant then reads every day live again. Returns the rows deleted.';

revoke all on function app.assistant_cache_clear() from public, anon, authenticated;
grant execute on function app.assistant_cache_clear() to service_role;

create or replace function app.assistant_cache_invalidate(p_from date, p_to date)
returns int
language plpgsql security definer set search_path = public as $assistant_cache_invalidate_0330$
declare
  v_n int;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  delete from assistant_day_facts where business_date between p_from and p_to;
  get diagnostics v_n = row_count;
  delete from assistant_day_detail where business_date between p_from and p_to;
  return v_n;
end $assistant_cache_invalidate_0330$;

comment on function app.assistant_cache_invalidate(date, date) is
  '0330. Service role. Deletes the stored days (headline and detail) in a range (after a backdated correction) so the next fill recomputes them; until then they are read live. Returns the rows deleted.';

revoke all on function app.assistant_cache_invalidate(date, date) from public, anon, authenticated;
grant execute on function app.assistant_cache_invalidate(date, date) to service_role;

create or replace function app.assistant_cache_status()
returns jsonb
language sql stable security definer set search_path = public as $assistant_cache_status_0330$
  select jsonb_build_object(
           'enabled',        c.enabled,
           'freeze_days',    c.freeze_days,
           'initialised_at', c.initialised_at,
           'last_fill_at',   c.last_fill_at,
           'detail_rows',    (select count(*) from assistant_day_detail),
           'scopes', coalesce((select jsonb_agg(jsonb_build_object('scope', s.scope, 'days', s.days, 'first', s.first, 'last', s.last) order by s.scope)
                                 from (select scope, count(*)::int as days, min(business_date) as first, max(business_date) as last
                                         from assistant_day_facts group by scope) s), '[]'::jsonb))
    from assistant_cache_config c
   where c.id
$assistant_cache_status_0330$;

comment on function app.assistant_cache_status() is
  '0330. Service role. {enabled, freeze_days, initialised_at, last_fill_at, scopes:[{scope, days, first, last}]}.';

revoke all on function app.assistant_cache_status() from public, anon, authenticated;
grant execute on function app.assistant_cache_status() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Nightly top-up (the "only what came after the latest fetch" run)
-- ---------------------------------------------------------------------------
do $assistant_cache_cron_0330$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - assistant cache fill skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_assistant_cache_fill not scheduled';
    return;
  end if;

  -- 01:20 UTC = 04:20 in Iraq, after the night's day close. A no-op while the cache is off.
  perform cron.schedule('tp_assistant_cache_fill', '20 1 * * *', 'select app.assistant_cache_fill(62);');
end $assistant_cache_cron_0330$;

-- ---------------------------------------------------------------------------
-- 7. app.assistant_run_tool — re-issued from 20261008000328:207 with one branch
--    (assistant_history_figures)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_0330$
declare
  a           jsonb := coalesce(p_args, '{}'::jsonb);
  v_result    jsonb;
  v_path      text;                 -- the catalog's rows_path for this tool
  v_count     int;
  v_truncated boolean;
  v_scope     text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The wall. STABLE is a promise; this is the enforcement: from here to the
  -- end of the transaction any INSERT/UPDATE/DELETE/DDL reached through a
  -- dispatched RPC fails with 25006 read_only_sql_transaction.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '8000', true);

  if jsonb_typeof(a) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_args', hint = 'an object of p_* keys';
  end if;

  case p_tool
    -- ── Money and headline ────────────────────────────────────────────────
    when 'panel_headline' then
      v_path := 'figures';
      v_result := app.panel_headline((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_compare', 'none'));
    when 'report_revenue' then
      v_path := 'rows';
      v_result := app.report_revenue((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     coalesce(a ->> 'p_group', 'day'), coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_compare' then
      v_result := app.report_compare(a ->> 'p_report', (a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     a ->> 'p_compare', coalesce(a ->> 'p_group', 'day'),
                                     coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_drill' then
      -- The RPC's row array is 'transactions' (the catalog says 'rows'; the
      -- dispatcher follows the RPC so row_count is real, and the mismatch is
      -- reported to the catalog's owner).
      v_path := 'transactions';
      v_result := app.report_drill(a ->> 'p_figure', a ->> 'p_key', (a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'assistant_payments_list' then
      v_path := 'rows';
      v_result := app.assistant_payments_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_method',
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Cafe ──────────────────────────────────────────────────────────────
    when 'report_cafe' then
      v_result := app.report_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_daily_sales' then
      v_path := '$';
      v_result := app.analytics_daily_sales((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_sold_items' then
      v_path := '$';
      v_result := app.analytics_sold_items((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_best_sellers' then
      v_path := '$';
      v_result := app.analytics_best_sellers((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                             coalesce((a ->> 'p_limit')::int, 20), coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_item_margins' then
      v_result := app.analytics_item_margins((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_price_bands' then
      v_path := '$';
      v_result := app.analytics_price_bands((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_hourly' then
      v_path := '$';
      v_result := app.analytics_hourly((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_bought_together' then
      v_path := '$';
      -- The RPC's basket scope is 'order' | 'tab'; anything else falls back to
      -- its default rather than failing the whole turn.
      v_scope := case when a ->> 'p_scope' in ('order', 'tab') then a ->> 'p_scope' else 'order' end;
      v_result := app.analytics_bought_together((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce((a ->> 'p_min_support')::int, 3),
                                                coalesce((a ->> 'p_limit')::int, 30), v_scope);
    when 'analytics_menu_snapshot' then
      v_result := app.analytics_menu_snapshot();
    when 'assistant_tabs_list' then
      v_path := 'rows';
      v_result := app.assistant_tabs_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_status',
                                          (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Courts ────────────────────────────────────────────────────────────
    when 'report_courts' then
      v_result := app.report_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_courts_summary' then
      v_result := app.analytics_courts_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_demand' then
      v_result := app.analytics_courts_demand((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_endings' then
      v_result := app.analytics_courts_endings((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_guests' then
      v_result := app.analytics_courts_guests((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_cafe' then
      v_result := app.analytics_courts_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'assistant_bookings_list' then
      v_path := 'rows';
      v_result := app.assistant_bookings_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid,
                                              a ->> 'p_status', (a ->> 'p_customer_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    when 'booking_bill' then
      v_result := app.booking_bill((a ->> 'p_reservation_id')::uuid);
    when 'series_detail' then
      v_result := app.series_detail((a ->> 'p_series_id')::uuid);
    when 'assistant_courts_and_rates' then
      v_result := app.assistant_courts_and_rates();

    -- ── Stock ─────────────────────────────────────────────────────────────
    when 'report_stock' then
      v_result := app.report_stock((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_stock_view' then
      v_path := 'rows';
      v_result := app.assistant_stock_view(a ->> 'p_view', (a ->> 'p_limit')::int, (a ->> 'p_offset')::int);

    -- ── Staff and ops ─────────────────────────────────────────────────────
    when 'ops_overview' then
      v_result := app.ops_overview();
    when 'list_staff' then
      v_path := '$';
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_result from app.list_staff() s;
    when 'staff_requests_page' then
      v_path := 'requests';   -- the RPC returns {requests, total, pending}; the catalog says the same
      v_result := app.staff_requests_page(a ->> 'p_status', coalesce((a ->> 'p_limit')::int, 50),
                                          coalesce((a ->> 'p_offset')::int, 0));
    when 'report_staff_activity' then
      v_path := 'rows';
      v_result := app.report_staff_activity((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid);
    when 'assistant_break_history' then
      v_path := 'rows';
      v_result := app.assistant_break_history((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Audit ─────────────────────────────────────────────────────────────
    when 'assistant_audit_page' then
      v_path := 'rows';
      v_result := app.assistant_audit_page((a ->> 'p_from')::timestamptz, (a ->> 'p_to')::timestamptz,
                                           (a ->> 'p_actor_id')::uuid, a ->> 'p_action_prefix', a ->> 'p_text',
                                           (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Customers ─────────────────────────────────────────────────────────
    when 'customer_search' then
      v_path := '$';
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result
        from app.customer_search(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 12)) x;
    when 'customer_record' then
      v_result := app.customer_record((a ->> 'p_customer_id')::uuid);

    -- ── Marketing ─────────────────────────────────────────────────────────
    when 'analytics_promo' then
      v_result := app.analytics_promo((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'marketing_overview' then
      v_result := app.marketing_overview();
    when 'marketing_campaign_performance' then
      v_result := app.marketing_campaign_performance((a ->> 'p_campaign')::uuid);

    -- ── Tournaments, open matches, loyalty (0328) ────────────────────────
    when 'assistant_tournaments_summary' then
      v_path := 'tournaments';
      v_result := app.assistant_tournaments_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'report_matches' then
      v_path := 'byDay';
      v_result := app.report_matches((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_loyalty_summary' then
      v_path := 'tiers';
      v_result := app.assistant_loyalty_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Stored daily figures (0330) ───────────────────────────────────────
    when 'assistant_history_figures' then
      v_path := 'rows';
      v_result := app.assistant_history_figures((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce(a ->> 'p_group', 'day'), coalesce((a ->> 'p_extra')::boolean, false));
    when 'assistant_history_items' then
      v_path := 'rows';
      v_result := app.assistant_history_items((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                              coalesce((a ->> 'p_limit')::int, 10), coalesce(a ->> 'p_order', 'revenue'));
    when 'assistant_history_courts' then
      v_path := 'rows';
      v_result := app.assistant_history_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                               coalesce(a ->> 'p_group', 'range'), coalesce((a ->> 'p_hours')::boolean, false));
    when 'assistant_history_staff' then
      v_path := 'rows';
      v_result := app.assistant_history_staff((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    -- ── Settings, system, any table ───────────────────────────────────────
    when 'assistant_settings_read' then
      v_result := app.assistant_settings_read();
    when 'assistant_system_status' then
      v_result := app.assistant_system_status();
    when 'assistant_table_read' then
      v_path := 'rows';
      v_result := app.assistant_table_read(
                    a ->> 'p_table',
                    case when a ? 'p_columns' and jsonb_typeof(a -> 'p_columns') = 'array'
                         then array(select jsonb_array_elements_text(a -> 'p_columns')) end,
                    a -> 'p_filters', a ->> 'p_order',
                    (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Meter (0111) ──────────────────────────────────────────────────────
    when 'assistant_usage' then
      v_path := 'days';
      v_result := app.assistant_usage((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    else
      raise exception 'ASSISTANT_UNKNOWN_TOOL' using errcode = 'P0001', detail = coalesce(p_tool, 'null');
  end case;

  -- row_count: the length of the array rows_path points at, when known.
  v_count := case
               when v_path = '$' and jsonb_typeof(v_result) = 'array' then jsonb_array_length(v_result)
               when v_path is not null and v_path <> '$' and jsonb_typeof(v_result -> v_path) = 'array'
                 then jsonb_array_length(v_result -> v_path)
             end;
  -- truncated: a paged list whose total exceeds what this page returned.
  v_truncated := case
                   when v_count is not null and jsonb_typeof(v_result) = 'object' and (v_result ->> 'total') ~ '^\d+$'
                     then (v_result ->> 'total')::bigint > coalesce((v_result ->> 'offset')::bigint, coalesce((a ->> 'p_offset')::bigint, 0)) + v_count
                   else false
                 end;

  return jsonb_build_object('tool', p_tool, 'data', v_result, 'row_count', v_count, 'truncated', v_truncated);
end $assistant_run_tool_0330$;

comment on function app.assistant_run_tool(text, jsonb) is
  '0109, 0328, 0330. Owner-only. THE read-only wall for the assistant: turns transaction_read_only on, then dispatches over the fixed catalog of read RPC names (packages/core/src/assistant/tools.ts DISPATCHED_RPCS) with arguments pulled from p_args by p_* name. Unknown names raise ASSISTANT_UNKNOWN_TOOL. Returns {tool, data, row_count, truncated}. Called with the owner''s JWT by the assistant-chat edge function.';

revoke all on function app.assistant_run_tool(text, jsonb) from public, anon;
grant execute on function app.assistant_run_tool(text, jsonb) to authenticated;
