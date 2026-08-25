-- 0034_analytics — cafe-rebuild wave 2: owner-only sales analytics RPCs, the
-- business-day helpers they share, and the LLM insight tables + RPCs
-- (db-slice.md "0034_analytics"; consumed by apps/operator features/analytics).
--
-- Posture
--  * Every analytics_* function is `security definer stable`, returns jsonb,
--    and runs the same prologue: app.analytics_guard() (FORBIDDEN unless
--    owner) -> app.analytics_bounds() (INVALID_RANGE when p_to < p_from, a
--    NULL bound, or a span over 400 days) -> aggregate. Argument enums
--    (p_basis / p_scope / limits) raise INVALID_ARGUMENT.
--  * Business day: app.business_date(at) = venue-local wall clock shifted back
--    by cafe_settings.analytics_business_day_start_hour (0029, default 4), so
--    a 01:30 sale belongs to the previous evening. The range [p_from, p_to] is
--    turned into ONE timestamptz window once per call (analytics_bounds) so
--    the placed_at / created_at indexes below do the filtering; per-row
--    bucketing uses the inlinable 3-arg overload with the captured tz + hour.
--  * Sales basis (item-level functions, p_basis):
--      'settled' = lines of tabs with status 'settled'  (money truth; matches
--                  payments, the default)
--      'served'  = non-voided lines of orders in status 'served' OR on settled
--                  tabs (live "today so far")
--    Always excluded: voided lines (order_items.voided) and voided orders.
--    Functions without p_basis (bought_together / hourly / promo) use every
--    non-voided line regardless of tab state — they describe behaviour, not
--    money. A line's business day is that of its ORDER's placed_at.
--  * Exclusions: cafe_settings.analytics_excluded_item_ids (0029) is applied
--    to item-level outputs (sold_items, best_sellers, bought_together,
--    item_margins, price_bands, promo) and NEVER to the money totals of
--    analytics_daily_sales (UpperDeck rule: revenue is revenue).
--  * Money in analytics_daily_sales is payments minus refunds by the business
--    day of their own created_at (cash/card by payments.method), NOT line
--    totals — it reconciles with app.close_day. Item-level revenue is
--    order_items.line_total_iqd = (unit + modifiers) * qty.
--  * discount_iqd (daily) = tab_adjustments.amount_iqd (all kinds, as the day
--    close sums them) + the featured-promo gap of every line, where the promo
--    gap is recomputed from list_price_iqd + discount_pct (0030) so a later
--    price override on a promo line is never counted twice.
--  * Costs come from menu_item_costs (0027): no row = unknown => has_cost =
--    false with NULL cost / margin, never 0; coverage is reported.
--  * LLM tables (analytics_insights / analytics_patterns /
--    analytics_insight_rejections): owner-only RLS, RPC-only writes.
--    app.normalize_finding is the SQL twin of normalizeFinding in
--    packages/core/src/analytics/insightsText.ts and must stay byte-identical.
--
-- Depends on: menu_item_costs + menu_items.sold_out/highlight (0027),
-- app.cafe_setting / app.cafe_setting_int (0029),
-- order_items.list_price_iqd / discount_pct / discount_source (0030).
-- Additive only: new indexes, new app.* functions, new tables. No drops, no
-- enum edits. Every error is `raise exception '<CODE>' using errcode = 'P0001'`.

-- ---------------------------------------------------------------------------
-- 1. Indexes — the range windows below filter on these columns.
-- ---------------------------------------------------------------------------
create index if not exists orders_placed_at_idx       on orders       (placed_at);
create index if not exists payments_created_at_idx    on payments     (created_at);
create index if not exists refunds_created_at_idx     on refunds      (created_at);
create index if not exists waiter_calls_raised_at_idx on waiter_calls (raised_at);

-- ---------------------------------------------------------------------------
-- 2. Business-day helpers
-- ---------------------------------------------------------------------------
-- 3-arg overload: pure arithmetic, IMMUTABLE, no SET clause and not definer so
-- the planner inlines it into the per-row GROUP BY of every function below.
create or replace function app.business_date(p_at timestamptz, p_tz text, p_start_hour int)
returns date
language sql immutable parallel safe as $fn_business_date3_0034$
  select ((p_at at time zone p_tz) - make_interval(hours => p_start_hour))::date
$fn_business_date3_0034$;

-- 1-arg form (the spec'd helper): venue timezone + the 0029 start-hour setting.
create or replace function app.business_date(p_at timestamptz)
returns date
language sql stable security definer set search_path = public as $fn_business_date1_0034$
  select app.business_date(
           p_at,
           coalesce((select vs.timezone from venue_settings vs limit 1), 'Asia/Baghdad'),
           coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4))
$fn_business_date1_0034$;

-- Owner gate shared by every analytics surface.
create or replace function app.analytics_guard()
returns void
language plpgsql stable security definer set search_path = public as $fn_analytics_guard_0034$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
end $fn_analytics_guard_0034$;

-- Excluded item ids from cafe_settings.analytics_excluded_item_ids. Tolerates
-- a missing row, JSON null, a non-array, or junk elements (skipped) — always
-- returns a (possibly empty) uuid[] so `<> all (...)` is never NULL.
create or replace function app.analytics_excluded()
returns uuid[]
language sql stable security definer set search_path = public as $fn_analytics_excluded_0034$
  select coalesce(
           (select array_agg((e #>> '{}')::uuid)
              from jsonb_array_elements(case when jsonb_typeof(s.v) = 'array' then s.v else '[]'::jsonb end) e
             where jsonb_typeof(e) = 'string'
               and (e #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
           '{}'::uuid[])
    from (select coalesce(app.cafe_setting('analytics_excluded_item_ids'), '[]'::jsonb) as v) s
$fn_analytics_excluded_0034$;

-- Range validation + the timestamptz window for [p_from, p_to] in business
-- days: day D spans [D start_hour:00, D+1 start_hour:00) venue-local.
create or replace function app.analytics_bounds(
  p_from date,
  p_to   date,
  out tz         text,
  out start_hour int,
  out ts_from    timestamptz,
  out ts_to      timestamptz
) language plpgsql stable security definer set search_path = public as $fn_analytics_bounds_0034$
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001',
      detail = format('from %s to %s', coalesce(p_from::text, 'null'), coalesce(p_to::text, 'null')),
      hint = 'p_from <= p_to and at most 400 days apart';
  end if;
  tz         := coalesce((select vs.timezone from venue_settings vs limit 1), 'Asia/Baghdad');
  start_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4);
  ts_from    := (p_from::timestamp + make_interval(hours => start_hour)) at time zone tz;
  ts_to      := ((p_to + 1)::timestamp + make_interval(hours => start_hour)) at time zone tz;
end $fn_analytics_bounds_0034$;

create or replace function app.analytics_assert_basis(p_basis text)
returns void
language plpgsql immutable as $fn_analytics_assert_basis_0034$
begin
  if p_basis is null or p_basis not in ('settled', 'served') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_basis',
      hint = 'p_basis must be ''settled'' or ''served''';
  end if;
end $fn_analytics_assert_basis_0034$;

-- The one line source every item-level function reads. Plain (non-definer,
-- no SET) SQL so it inlines into the caller's plan; callers are definer
-- functions with search_path pinned to public. p_basis: 'settled' | 'served'
-- (see header) | 'all' (internal: every non-voided line).
--   list_line_iqd     = line_total + promo gap  (what the line would have cost
--                       at list price)
--   discount_line_iqd = promo gap = (list - apply_pct_discount(list, pct)) * qty
--                       inlined as (list*(100-pct)+50)/100 — the 0030 /
--                       packages/core/src/money/discount.ts formula. Zero on
--                       pre-0030 rows (list NULL) and on non-promo lines.
create or replace function app.analytics_sales_lines(
  p_basis      text,
  p_ts_from    timestamptz,
  p_ts_to      timestamptz,
  p_tz         text,
  p_start_hour int
) returns table (
  business_date     date,
  order_id          uuid,
  tab_id            uuid,
  guest_session_id  uuid,
  source            order_source,
  placed_at         timestamptz,
  order_item_id     uuid,
  menu_item_id      uuid,
  variant_id        uuid,
  qty               int,
  list_price_iqd    bigint,
  unit_price_iqd    bigint,
  line_total_iqd    bigint,
  list_line_iqd     bigint,
  discount_line_iqd bigint,
  discount_source   text
) language sql stable as $fn_analytics_sales_lines_0034$
  select app.business_date(o.placed_at, p_tz, p_start_hour),
         o.id, o.tab_id, o.guest_session_id, o.source, o.placed_at,
         oi.id, oi.menu_item_id, oi.variant_id, oi.qty,
         coalesce(oi.list_price_iqd, oi.unit_price_iqd)::bigint,
         oi.unit_price_iqd::bigint,
         oi.line_total_iqd::bigint,
         (oi.line_total_iqd + g.promo_gap)::bigint,
         g.promo_gap::bigint,
         oi.discount_source
    from orders o
    join tabs t         on t.id = o.tab_id
    join order_items oi on oi.order_id = o.id
    cross join lateral (
      select case
               when oi.discount_pct > 0 and oi.list_price_iqd is not null
               then (oi.list_price_iqd
                     - (oi.list_price_iqd * (100 - oi.discount_pct) + 50) / 100) * oi.qty
               else 0
             end as promo_gap
    ) g
   where o.placed_at >= p_ts_from and o.placed_at < p_ts_to
     and o.status <> 'voided'
     and not oi.voided
     and case p_basis
           when 'settled' then t.status = 'settled'
           when 'served'  then (o.status = 'served' or t.status = 'settled')
           when 'all'     then true
           else false
         end
$fn_analytics_sales_lines_0034$;

-- ---------------------------------------------------------------------------
-- 3. Owner analytics functions
-- ---------------------------------------------------------------------------

-- 3.1 analytics_daily_sales — one row per business day that had ANY activity
-- (order, payment, refund, settlement, adjustment or waiter call); days with
-- nothing are absent so the client can show them as gaps / "closed?".
-- Money = payments - refunds (never excluded, never line totals).
create or replace function app.analytics_daily_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_daily_sales_0034$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  ord as (
    select app.business_date(o.placed_at, v_b.tz, v_b.start_hour) as d,
           count(*)                                              as orders,
           count(*) filter (where o.source = 'guest_web')        as guest_orders,
           count(*) filter (where o.source = 'till')             as till_orders,
           count(distinct o.guest_session_id)                    as visits
      from orders o
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
     group by 1),
  lines as (
    select app.business_date(o.placed_at, v_b.tz, v_b.start_hour) as d,
           sum(oi.qty)::bigint as items_qty,
           sum(case
                 when oi.discount_pct > 0 and oi.list_price_iqd is not null
                 then (oi.list_price_iqd
                       - (oi.list_price_iqd * (100 - oi.discount_pct) + 50) / 100) * oi.qty
                 else 0
               end)::bigint as promo_discount_iqd
      from orders o
      join order_items oi on oi.order_id = o.id
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided' and not oi.voided
     group by 1),
  pay as (
    select app.business_date(p.created_at, v_b.tz, v_b.start_hour) as d,
           sum(p.amount_iqd)::bigint                                              as paid_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_paid_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_paid_iqd
      from payments p
     where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
     group by 1),
  ref as (
    select app.business_date(r.created_at, v_b.tz, v_b.start_hour) as d,
           sum(r.amount_iqd)::bigint                                              as refunded_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_refunded_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_refunded_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  settled as (
    select app.business_date(t.settled_at, v_b.tz, v_b.start_hour) as d,
           count(*)                            as tabs_settled,
           coalesce(sum(t.tax_iqd), 0)::bigint as tax_iqd
      from tabs t
     where t.status = 'settled'
       and t.settled_at >= v_b.ts_from and t.settled_at < v_b.ts_to
     group by 1),
  adj as (
    select app.business_date(a.created_at, v_b.tz, v_b.start_hour) as d,
           sum(a.amount_iqd)::bigint as adjustment_iqd
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
     group by 1),
  calls as (
    select app.business_date(w.raised_at, v_b.tz, v_b.start_hour) as d,
           count(*) as waiter_calls
      from waiter_calls w
     where w.raised_at >= v_b.ts_from and w.raised_at < v_b.ts_to
     group by 1),
  days as (
    select d from ord
    union select d from lines
    union select d from pay
    union select d from ref
    union select d from settled
    union select d from adj
    union select d from calls)
  select coalesce(jsonb_agg(jsonb_build_object(
           'business_date', days.d,
           'revenue_iqd',   coalesce(pay.paid_iqd, 0)      - coalesce(ref.refunded_iqd, 0),
           'cash_iqd',      coalesce(pay.cash_paid_iqd, 0) - coalesce(ref.cash_refunded_iqd, 0),
           'card_iqd',      coalesce(pay.card_paid_iqd, 0) - coalesce(ref.card_refunded_iqd, 0),
           'tabs_settled',  coalesce(settled.tabs_settled, 0),
           'orders',        coalesce(ord.orders, 0),
           'items_qty',     coalesce(lines.items_qty, 0),
           'discount_iqd',  coalesce(adj.adjustment_iqd, 0) + coalesce(lines.promo_discount_iqd, 0),
           'tax_iqd',       coalesce(settled.tax_iqd, 0),
           'visits',        coalesce(ord.visits, 0),
           'guest_orders',  coalesce(ord.guest_orders, 0),
           'till_orders',   coalesce(ord.till_orders, 0),
           'waiter_calls',  coalesce(calls.waiter_calls, 0)
         ) order by days.d), '[]'::jsonb)
    into v_out
    from days
    left join ord     on ord.d     = days.d
    left join lines   on lines.d   = days.d
    left join pay     on pay.d     = days.d
    left join ref     on ref.d     = days.d
    left join settled on settled.d = days.d
    left join adj     on adj.d     = days.d
    left join calls   on calls.d   = days.d;

  return v_out;
end $fn_analytics_daily_sales_0034$;

-- 3.2 analytics_sold_items — day x item grain (the client rolls up).
-- discount_iqd here is the featured-promo gap only (tab-level discounts are
-- not attributable to a line); list_revenue_iqd = revenue_iqd + discount_iqd.
create or replace function app.analytics_sold_items(
  p_from  date,
  p_to    date,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_sold_items_0034$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  v_ex := app.analytics_excluded();

  select coalesce(jsonb_agg(jsonb_build_object(
           'business_date',    s.business_date,
           'menu_item_id',     s.menu_item_id,
           'name_en',          mi.name_en,
           'name_ar',          mi.name_ar,
           'category_id',      mi.category_id,
           'qty',              s.qty,
           'revenue_iqd',      s.revenue_iqd,
           'list_revenue_iqd', s.list_revenue_iqd,
           'discount_iqd',     s.discount_iqd
         ) order by s.business_date, s.qty desc, s.revenue_iqd desc, mi.name_en), '[]'::jsonb)
    into v_out
    from (
      select l.business_date, l.menu_item_id,
             sum(l.qty)::bigint               as qty,
             sum(l.line_total_iqd)::bigint    as revenue_iqd,
             sum(l.list_line_iqd)::bigint     as list_revenue_iqd,
             sum(l.discount_line_iqd)::bigint as discount_iqd
        from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
       where l.menu_item_id <> all (v_ex)
       group by l.business_date, l.menu_item_id
    ) s
    join menu_items mi on mi.id = s.menu_item_id;

  return v_out;
end $fn_analytics_sold_items_0034$;

-- 3.3 analytics_best_sellers — top p_limit items by qty. share_pct = the
-- item's share of all (non-excluded) units sold in the range, 1 decimal.
create or replace function app.analytics_best_sellers(
  p_from  date,
  p_to    date,
  p_limit int  default 20,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_best_sellers_0034$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_limit', hint = 'p_limit must be between 1 and 500';
  end if;
  v_ex := app.analytics_excluded();

  with
  agg as (
    select l.menu_item_id,
           sum(l.qty)::bigint            as qty,
           sum(l.line_total_iqd)::bigint as revenue_iqd,
           count(distinct l.order_id)    as orders
      from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.menu_item_id <> all (v_ex)
     group by l.menu_item_id),
  tot as (
    select coalesce(sum(agg.qty), 0)::bigint as total_qty from agg),
  top as (
    select agg.menu_item_id, agg.qty, agg.revenue_iqd, agg.orders,
           mi.name_en, mi.name_ar, mi.category_id
      from agg
      join menu_items mi on mi.id = agg.menu_item_id
     order by agg.qty desc, agg.revenue_iqd desc, mi.name_en, agg.menu_item_id
     limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
           'menu_item_id', top.menu_item_id,
           'name_en',      top.name_en,
           'name_ar',      top.name_ar,
           'category_id',  top.category_id,
           'qty',          top.qty,
           'revenue_iqd',  top.revenue_iqd,
           'share_pct',    case when tot.total_qty > 0
                                then round(top.qty * 100.0 / tot.total_qty, 1)
                                else 0 end,
           'orders',       top.orders
         ) order by top.qty desc, top.revenue_iqd desc, top.name_en, top.menu_item_id), '[]'::jsonb)
    into v_out
    from top
    cross join tot;

  return v_out;
end $fn_analytics_best_sellers_0034$;

-- 3.4 analytics_bought_together — unordered item pairs that co-occur in the
-- same basket (p_scope 'order' = one order, 'tab' = the whole tab). All
-- non-voided lines (no money basis). Per pair: both = baskets holding both,
-- count_a / count_b = baskets holding each, confidence_ab = both / count_a
-- (fraction 0..1, 3 decimals), lift = both * orders_total / (count_a *
-- count_b), orders_total = baskets with >= 1 counted line. Ranked by both
-- desc, lift desc; only pairs with both >= p_min_support.
create or replace function app.analytics_bought_together(
  p_from        date,
  p_to          date,
  p_min_support int  default 3,
  p_limit       int  default 30,
  p_scope       text default 'order'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_bought_together_0034$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_scope is null or p_scope not in ('order', 'tab') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_scope', hint = 'p_scope must be ''order'' or ''tab''';
  end if;
  if p_min_support is null or p_min_support < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_min_support', hint = 'p_min_support must be >= 1';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_limit', hint = 'p_limit must be between 1 and 500';
  end if;
  v_ex := app.analytics_excluded();

  with
  bl as (                                      -- distinct (basket, item)
    select distinct
           case when p_scope = 'tab' then l.tab_id else l.order_id end as basket_id,
           l.menu_item_id
      from app.analytics_sales_lines('all', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.menu_item_id <> all (v_ex)),
  tot as (
    select count(distinct bl.basket_id) as baskets from bl),
  ic as (
    select bl.menu_item_id, count(*) as n from bl group by bl.menu_item_id),
  pairs as (
    select a.menu_item_id as item_a, b.menu_item_id as item_b, count(*) as pair_count
      from bl a
      join bl b on b.basket_id = a.basket_id and b.menu_item_id > a.menu_item_id
     group by a.menu_item_id, b.menu_item_id
    having count(*) >= p_min_support),
  ranked as (
    select p.item_a, p.item_b, p.pair_count,
           ca.n as count_a, cb.n as count_b, tot.baskets,
           round(p.pair_count::numeric / ca.n, 3)                        as confidence_ab,
           round(p.pair_count::numeric / cb.n, 3)                        as confidence_ba,
           round(p.pair_count::numeric * tot.baskets / (ca.n * cb.n), 3) as lift
      from pairs p
      join ic ca on ca.menu_item_id = p.item_a
      join ic cb on cb.menu_item_id = p.item_b
      cross join tot
     order by p.pair_count desc, lift desc, p.item_a, p.item_b
     limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_a',        r.item_a,
           'item_b',        r.item_b,
           'name_a_en',     ma.name_en,
           'name_a_ar',     ma.name_ar,
           'name_b_en',     mb.name_en,
           'name_b_ar',     mb.name_ar,
           'both',          r.pair_count,
           'count_a',       r.count_a,
           'count_b',       r.count_b,
           'confidence_ab', r.confidence_ab,
           'confidence_ba', r.confidence_ba,
           'lift',          r.lift,
           'orders_total',  r.baskets
         ) order by r.pair_count desc, r.lift desc, r.item_a, r.item_b), '[]'::jsonb)
    into v_out
    from ranked r
    join menu_items ma on ma.id = r.item_a
    join menu_items mb on mb.id = r.item_b;

  return v_out;
end $fn_analytics_bought_together_0034$;

-- 3.5 analytics_item_margins — revenue vs CURRENT unit cost (menu_item_costs;
-- not snapshotted — cost_as_of says when it was read). Modifier revenue is in
-- revenue_iqd but no modifier cost exists, so margins are per-item estimates.
-- has_cost=false rows carry NULL cost_iqd / cost_total_iqd / margin_iqd /
-- margin_pct. avg_price_iqd = revenue / qty rounded to whole IQD.
create or replace function app.analytics_item_margins(
  p_from  date,
  p_to    date,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_item_margins_0034$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  v_ex := app.analytics_excluded();

  with
  agg as (
    select l.menu_item_id,
           sum(l.qty)::bigint            as qty,
           sum(l.line_total_iqd)::bigint as revenue_iqd
      from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.menu_item_id <> all (v_ex)
     group by l.menu_item_id),
  j as (
    select agg.menu_item_id, mi.name_en, mi.name_ar, mi.category_id,
           agg.qty, agg.revenue_iqd,
           c.cost_iqd::bigint                               as cost_iqd,
           (c.cost_iqd * agg.qty)::bigint                   as cost_total_iqd,
           (agg.revenue_iqd - c.cost_iqd * agg.qty)::bigint as margin_iqd
      from agg
      join menu_items mi          on mi.id = agg.menu_item_id
      left join menu_item_costs c on c.item_id = agg.menu_item_id),
  cov as (
    select count(*)::int                                                                as items_total,
           count(j.cost_iqd)::int                                                       as items_with_cost,
           coalesce(sum(j.revenue_iqd), 0)::bigint                                      as rev_total,
           coalesce(sum(j.revenue_iqd) filter (where j.cost_iqd is not null), 0)::bigint as rev_with_cost
      from j)
  select jsonb_build_object(
           'basis',      p_basis,
           'cost_as_of', now(),
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'menu_item_id',   j.menu_item_id,
                      'name_en',        j.name_en,
                      'name_ar',        j.name_ar,
                      'category_id',    j.category_id,
                      'qty',            j.qty,
                      'revenue_iqd',    j.revenue_iqd,
                      'avg_price_iqd',  case when j.qty > 0
                                             then round(j.revenue_iqd::numeric / j.qty)::bigint end,
                      'cost_iqd',       j.cost_iqd,
                      'cost_total_iqd', j.cost_total_iqd,
                      'margin_iqd',     j.margin_iqd,
                      'margin_pct',     case when j.cost_iqd is not null and j.revenue_iqd > 0
                                             then round(j.margin_iqd * 100.0 / j.revenue_iqd, 1) end,
                      'has_cost',       j.cost_iqd is not null
                    ) order by j.margin_iqd desc nulls last, j.revenue_iqd desc, j.name_en)
               from j), '[]'::jsonb),
           'coverage', (
             select jsonb_build_object(
                      'revenue_with_cost_pct', case when cov.rev_total > 0
                                                    then round(cov.rev_with_cost * 100.0 / cov.rev_total, 1)
                                                    else 0 end,
                      'items_with_cost',       cov.items_with_cost,
                      'items_total',           cov.items_total)
               from cov))
    into v_out;

  return v_out;
end $fn_analytics_item_margins_0034$;

-- 3.6 analytics_price_bands — units / revenue by the item's DEFAULT-variant
-- list price (is_default, else the first variant by sort_order). Always
-- returns the four bands in order, empty ones with items [] and zeros.
create or replace function app.analytics_price_bands(
  p_from  date,
  p_to    date,
  p_basis text default 'settled'
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_price_bands_0034$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  perform app.analytics_assert_basis(p_basis);
  v_ex := app.analytics_excluded();

  with
  dv as (
    select distinct on (v.item_id) v.item_id, v.price_iqd
      from menu_item_variants v
     order by v.item_id, v.is_default desc, v.sort_order, v.id),
  agg as (
    select l.menu_item_id,
           sum(l.qty)::bigint            as qty,
           sum(l.line_total_iqd)::bigint as revenue_iqd
      from app.analytics_sales_lines(p_basis, v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.menu_item_id <> all (v_ex)
     group by l.menu_item_id),
  banded as (
    select case when dv.price_iqd < 3000  then 'lt3000'
                when dv.price_iqd < 6000  then '3000_5999'
                when dv.price_iqd < 10000 then '6000_9999'
                else 'gte10000' end as band,
           agg.menu_item_id, agg.qty, agg.revenue_iqd
      from agg
      join dv on dv.item_id = agg.menu_item_id),
  bands as (
    select b.band, b.ord
      from (values ('lt3000', 1), ('3000_5999', 2), ('6000_9999', 3), ('gte10000', 4)) as b(band, ord)),
  rolled as (
    select bands.band, bands.ord,
           coalesce(jsonb_agg(banded.menu_item_id order by banded.qty desc, banded.menu_item_id)
                      filter (where banded.menu_item_id is not null), '[]'::jsonb) as items,
           coalesce(sum(banded.qty), 0)::bigint         as qty,
           coalesce(sum(banded.revenue_iqd), 0)::bigint as revenue_iqd
      from bands
      left join banded on banded.band = bands.band
     group by bands.band, bands.ord)
  select coalesce(jsonb_agg(jsonb_build_object(
           'band',        rolled.band,
           'items',       rolled.items,
           'qty',         rolled.qty,
           'revenue_iqd', rolled.revenue_iqd
         ) order by rolled.ord), '[]'::jsonb)
    into v_out
    from rolled;

  return v_out;
end $fn_analytics_price_bands_0034$;

-- 3.7 analytics_hourly — orders / units / line revenue by (dow, hour). dow is
-- the weekday of the BUSINESS day (0 = Sunday) so a 01:00 order sits with the
-- evening it belongs to; hour is the venue-local clock hour of placed_at.
-- All non-voided orders/lines; exclusions not applied (it is a money/time
-- total, not an item ranking).
create or replace function app.analytics_hourly(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_hourly_0034$
declare
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  select coalesce(jsonb_agg(jsonb_build_object(
           'dow',         x.dow,
           'hour',        x.hour,
           'orders',      x.orders,
           'qty',         x.qty,
           'revenue_iqd', x.revenue_iqd
         ) order by x.dow, x.hour), '[]'::jsonb)
    into v_out
    from (
      select extract(dow from app.business_date(o.placed_at, v_b.tz, v_b.start_hour))::int as dow,
             extract(hour from (o.placed_at at time zone v_b.tz))::int                      as hour,
             count(distinct o.id)                                                           as orders,
             coalesce(sum(oi.qty), 0)::bigint                                               as qty,
             coalesce(sum(oi.line_total_iqd), 0)::bigint                                    as revenue_iqd
        from orders o
        left join order_items oi on oi.order_id = o.id and not oi.voided
       where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
         and o.status <> 'voided'
       group by 1, 2
    ) x;

  return v_out;
end $fn_analytics_hourly_0034$;

-- 3.8 analytics_promo — lines sold under the featured-item promo
-- (order_items.discount_source = 'featured', 0030). All non-voided lines;
-- exclusions applied (it is item-level). discount_iqd = list - paid.
create or replace function app.analytics_promo(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_promo_0034$
declare
  v_b   record;
  v_ex  uuid[];
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_ex := app.analytics_excluded();

  with
  l as (
    select l.business_date, l.order_id, l.qty, l.list_line_iqd, l.line_total_iqd, l.discount_line_iqd
      from app.analytics_sales_lines('all', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
     where l.discount_source = 'featured'
       and l.menu_item_id <> all (v_ex)),
  by_day as (
    select l.business_date                  as d,
           sum(l.qty)::bigint               as qty,
           sum(l.list_line_iqd)::bigint     as list_revenue_iqd,
           sum(l.line_total_iqd)::bigint    as revenue_iqd,
           sum(l.discount_line_iqd)::bigint as discount_iqd,
           count(distinct l.order_id)       as orders
      from l
     group by l.business_date)
  select jsonb_build_object(
           'qty',              coalesce((select sum(by_day.qty)              from by_day), 0)::bigint,
           'list_revenue_iqd', coalesce((select sum(by_day.list_revenue_iqd) from by_day), 0)::bigint,
           'revenue_iqd',      coalesce((select sum(by_day.revenue_iqd)      from by_day), 0)::bigint,
           'discount_iqd',     coalesce((select sum(by_day.discount_iqd)     from by_day), 0)::bigint,
           'orders',           (select count(distinct l.order_id) from l),
           'by_day', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'business_date',    by_day.d,
                      'qty',              by_day.qty,
                      'list_revenue_iqd', by_day.list_revenue_iqd,
                      'revenue_iqd',      by_day.revenue_iqd,
                      'discount_iqd',     by_day.discount_iqd,
                      'orders',           by_day.orders
                    ) order by by_day.d)
               from by_day), '[]'::jsonb))
    into v_out;

  return v_out;
end $fn_analytics_promo_0034$;

-- 3.9 analytics_menu_snapshot — the current menu as the matrix / position
-- analysis input: every item (active or not; is_active says which) with its
-- category, ordering, default-variant price, current cost (NULL = unknown)
-- and flags. No range, no exclusions (the client applies its keep filter).
create or replace function app.analytics_menu_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_menu_snapshot_0034$
declare
  v_out jsonb;
begin
  perform app.analytics_guard();

  with
  dv as (
    select distinct on (v.item_id) v.item_id, v.price_iqd
      from menu_item_variants v
     order by v.item_id, v.is_default desc, v.sort_order, v.id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'menu_item_id',     mi.id,
           'name_en',          mi.name_en,
           'name_ar',          mi.name_ar,
           'category_id',      mc.id,
           'category_name_en', mc.name_en,
           'category_name_ar', mc.name_ar,
           'category_sort',    mc.sort_order,
           'item_sort',        mi.sort_order,
           'price_iqd',        dv.price_iqd::bigint,
           'cost_iqd',         c.cost_iqd::bigint,
           'is_active',        mi.is_active,
           'sold_out',         mi.sold_out,
           'highlight',        mi.highlight,
           'has_photo',        mi.photo_path is not null
         ) order by mc.sort_order, mc.name_en, mi.sort_order, mi.name_en, mi.id), '[]'::jsonb)
    into v_out
    from menu_items mi
    join menu_categories mc     on mc.id = mi.category_id
    left join dv                on dv.item_id = mi.id
    left join menu_item_costs c on c.item_id = mi.id;

  return v_out;
end $fn_analytics_menu_snapshot_0034$;

-- ---------------------------------------------------------------------------
-- 4. LLM tables — owner-only reads, RPC-only writes.
-- ---------------------------------------------------------------------------
create table if not exists analytics_insights (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  range_from    date not null,
  range_to      date not null,
  compare_basis text not null default 'prev' check (compare_basis in ('prev', '4w', '52w')),
  locale        text not null default 'ar'   check (locale in ('ar', 'en')),
  insights      jsonb not null,
  created_by    uuid references staff(id)
);
create index if not exists analytics_insights_range
  on analytics_insights (range_from, range_to, compare_basis, locale, created_at desc);

create table if not exists analytics_patterns (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  range_from date not null,
  range_to   date not null,
  locale     text not null default 'ar' check (locale in ('ar', 'en')),
  patterns   jsonb not null,
  created_by uuid references staff(id)
);
create index if not exists analytics_patterns_range
  on analytics_patterns (range_from, range_to, locale, created_at desc);

create table if not exists analytics_insight_rejections (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  text       text not null,
  text_key   text not null unique,              -- app.normalize_finding(text)
  reason     text,
  created_by uuid references staff(id)
);
create index if not exists analytics_insight_rejections_created
  on analytics_insight_rejections (created_at desc);

comment on table analytics_insights is
  'Stored AI insight sets per (range, compare basis, locale). Written only by app.save_analytics_insights; owner read.';
comment on table analytics_patterns is
  'Stored mined-pattern sets per (range, locale). Written only by app.save_analytics_patterns; owner read.';
comment on column analytics_insight_rejections.text_key is
  'Dedupe key = app.normalize_finding(text). The edge function mirrors the same algorithm (packages/core/src/analytics/insightsText.ts normalizeFinding).';

alter table analytics_insights           enable row level security;
alter table analytics_patterns           enable row level security;
alter table analytics_insight_rejections enable row level security;

grant select on analytics_insights, analytics_patterns, analytics_insight_rejections to authenticated;
-- No INSERT/UPDATE/DELETE grants or policies for any client role; service_role
-- keeps full access via the 0012 default privileges.

do $ddl_0034_policies$
begin
  begin
    create policy analytics_insights_owner_read on analytics_insights
      for select to authenticated using (app.is_staff('owner'));
  exception when duplicate_object then null; end;
  begin
    create policy analytics_patterns_owner_read on analytics_patterns
      for select to authenticated using (app.is_staff('owner'));
  exception when duplicate_object then null; end;
  begin
    create policy analytics_insight_rejections_owner_read on analytics_insight_rejections
      for select to authenticated using (app.is_staff('owner'));
  exception when duplicate_object then null; end;
end $ddl_0034_policies$;

-- ---------------------------------------------------------------------------
-- 5. app.normalize_finding — SQL twin of normalizeFinding in
--    packages/core/src/analytics/insightsText.ts. The two MUST produce the
--    same bytes (parity test in packages/db/tests). Ordered steps, none may
--    be skipped or reordered:
--      1. lower(s)                       — plain lowercase, no locale rules
--      2. Arabic-Indic U+0660–U+0669 and Extended Arabic-Indic U+06F0–U+06F9
--         digits -> ASCII '0'–'9'        (translate)
--      3. DELETE tatweel U+0640, harakat U+064B–U+0652, superscript alef U+0670
--      4. every char that is not a letter, digit or whitespace -> one SPACE
--         ('[^[:alnum:][:space:]]'; under the UTF-8 non-C database locale
--         [:alnum:] covers Arabic letters — verified on the local stack (ICU
--         en_US.UTF-8) and true for glibc en_US.UTF-8 on hosted. The JS side
--         uses [^\p{L}\p{N}\s]; Postgres ARE has no \p{..} classes.)
--      5. collapse whitespace runs to one SPACE, trim
--    No NFC/NFD, no hamza/alef folding on either side. The Arabic character
--    literals below are spelled as \uXXXX escapes (E'' strings) so the file
--    stays ASCII and encoding-proof.
-- ---------------------------------------------------------------------------
create or replace function app.normalize_finding(p_text text)
returns text
language sql immutable parallel safe as $fn_normalize_finding_0034$
  select btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 translate(lower(p_text),
                           E'\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9',
                           '01234567890123456789'),
                 E'[\u0640\u064B-\u0652\u0670]', '', 'g'),
               '[^[:alnum:][:space:]]', ' ', 'g'),
             '\s+', ' ', 'g'))
$fn_normalize_finding_0034$;

-- ---------------------------------------------------------------------------
-- 6. Owner RPCs for the LLM tables (guarded, audited).
-- ---------------------------------------------------------------------------
create or replace function app.save_analytics_insights(
  p_range_from    date,
  p_range_to      date,
  p_compare_basis text,
  p_locale        text,
  p_insights      jsonb
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_analytics_insights_0034$
declare
  v_row analytics_insights%rowtype;
begin
  perform app.analytics_guard();
  if p_range_from is null or p_range_to is null or p_range_to < p_range_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  if p_compare_basis is null or p_compare_basis not in ('prev', '4w', '52w') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare_basis', hint = 'one of prev, 4w, 52w';
  end if;
  if p_locale is null or p_locale not in ('ar', 'en') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_locale', hint = 'one of ar, en';
  end if;
  if p_insights is null or jsonb_typeof(p_insights) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_insights', hint = 'a JSON array of findings';
  end if;

  insert into analytics_insights (range_from, range_to, compare_basis, locale, insights, created_by)
  values (p_range_from, p_range_to, p_compare_basis, p_locale, p_insights, auth.uid())
  returning * into v_row;

  perform app.write_audit('analytics.insights.save', 'analytics_insights', v_row.id::text,
                          null,
                          jsonb_build_object('range_from', v_row.range_from, 'range_to', v_row.range_to,
                                             'compare_basis', v_row.compare_basis, 'locale', v_row.locale,
                                             'count', jsonb_array_length(v_row.insights)));
  return v_row.id;
end $fn_save_analytics_insights_0034$;

create or replace function app.save_analytics_patterns(
  p_range_from date,
  p_range_to   date,
  p_locale     text,
  p_patterns   jsonb
) returns uuid
language plpgsql security definer set search_path = public as $fn_save_analytics_patterns_0034$
declare
  v_row analytics_patterns%rowtype;
begin
  perform app.analytics_guard();
  if p_range_from is null or p_range_to is null or p_range_to < p_range_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  if p_locale is null or p_locale not in ('ar', 'en') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_locale', hint = 'one of ar, en';
  end if;
  if p_patterns is null or jsonb_typeof(p_patterns) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_patterns', hint = 'a JSON array of patterns';
  end if;

  insert into analytics_patterns (range_from, range_to, locale, patterns, created_by)
  values (p_range_from, p_range_to, p_locale, p_patterns, auth.uid())
  returning * into v_row;

  perform app.write_audit('analytics.patterns.save', 'analytics_patterns', v_row.id::text,
                          null,
                          jsonb_build_object('range_from', v_row.range_from, 'range_to', v_row.range_to,
                                             'locale', v_row.locale,
                                             'count', jsonb_array_length(v_row.patterns)));
  return v_row.id;
end $fn_save_analytics_patterns_0034$;

-- Idempotent on the normalized key: a repeat returns the existing row's id
-- (no new audit row). Empty-after-normalization text is INVALID_ARGUMENT.
create or replace function app.reject_insight(
  p_text   text,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $fn_reject_insight_0034$
declare
  v_key text;
  v_id  uuid;
  v_row analytics_insight_rejections%rowtype;
begin
  perform app.analytics_guard();
  if p_text is null or length(p_text) > 4000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_text', hint = 'finding text is required (<= 4000 chars)';
  end if;
  v_key := app.normalize_finding(p_text);
  if v_key is null or v_key = '' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_text', hint = 'finding text has no letters or digits';
  end if;

  insert into analytics_insight_rejections (text, text_key, reason, created_by)
  values (p_text, v_key, nullif(btrim(p_reason), ''), auth.uid())
  on conflict (text_key) do nothing
  returning * into v_row;

  if v_row.id is null then
    select r.id into v_id from analytics_insight_rejections r where r.text_key = v_key;
    return v_id;
  end if;

  perform app.write_audit('analytics.insight.reject', 'analytics_insight_rejections', v_row.id::text,
                          null, to_jsonb(v_row));
  return v_row.id;
end $fn_reject_insight_0034$;

create or replace function app.unreject_insight(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn_unreject_insight_0034$
declare
  v_row analytics_insight_rejections%rowtype;
begin
  perform app.analytics_guard();

  delete from analytics_insight_rejections r where r.id = p_id
  returning * into v_row;
  if not found then
    raise exception 'REJECTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform app.write_audit('analytics.insight.unreject', 'analytics_insight_rejections', v_row.id::text,
                          to_jsonb(v_row), null);
end $fn_unreject_insight_0034$;

-- ---------------------------------------------------------------------------
-- 7. Function grants — internal helpers: service_role only; owner surfaces:
--    authenticated (the guard inside decides).
-- ---------------------------------------------------------------------------
revoke all on function app.business_date(timestamptz, text, int) from public, anon, authenticated;
grant execute on function app.business_date(timestamptz, text, int) to service_role;

revoke all on function app.business_date(timestamptz) from public, anon, authenticated;
grant execute on function app.business_date(timestamptz) to service_role;

revoke all on function app.analytics_guard() from public, anon, authenticated;
grant execute on function app.analytics_guard() to service_role;

revoke all on function app.analytics_excluded() from public, anon, authenticated;
grant execute on function app.analytics_excluded() to service_role;

revoke all on function app.analytics_bounds(date, date) from public, anon, authenticated;
grant execute on function app.analytics_bounds(date, date) to service_role;

revoke all on function app.analytics_assert_basis(text) from public, anon, authenticated;
grant execute on function app.analytics_assert_basis(text) to service_role;

revoke all on function app.analytics_sales_lines(text, timestamptz, timestamptz, text, int) from public, anon, authenticated;
grant execute on function app.analytics_sales_lines(text, timestamptz, timestamptz, text, int) to service_role;

revoke all on function app.normalize_finding(text) from public, anon, authenticated;
grant execute on function app.normalize_finding(text) to service_role;   -- parity tests

revoke all on function app.analytics_daily_sales(date, date) from public, anon;
grant execute on function app.analytics_daily_sales(date, date) to authenticated;

revoke all on function app.analytics_sold_items(date, date, text) from public, anon;
grant execute on function app.analytics_sold_items(date, date, text) to authenticated;

revoke all on function app.analytics_best_sellers(date, date, int, text) from public, anon;
grant execute on function app.analytics_best_sellers(date, date, int, text) to authenticated;

revoke all on function app.analytics_bought_together(date, date, int, int, text) from public, anon;
grant execute on function app.analytics_bought_together(date, date, int, int, text) to authenticated;

revoke all on function app.analytics_item_margins(date, date, text) from public, anon;
grant execute on function app.analytics_item_margins(date, date, text) to authenticated;

revoke all on function app.analytics_price_bands(date, date, text) from public, anon;
grant execute on function app.analytics_price_bands(date, date, text) to authenticated;

revoke all on function app.analytics_hourly(date, date) from public, anon;
grant execute on function app.analytics_hourly(date, date) to authenticated;

revoke all on function app.analytics_promo(date, date) from public, anon;
grant execute on function app.analytics_promo(date, date) to authenticated;

revoke all on function app.analytics_menu_snapshot() from public, anon;
grant execute on function app.analytics_menu_snapshot() to authenticated;

revoke all on function app.save_analytics_insights(date, date, text, text, jsonb) from public, anon;
grant execute on function app.save_analytics_insights(date, date, text, text, jsonb) to authenticated;

revoke all on function app.save_analytics_patterns(date, date, text, jsonb) from public, anon;
grant execute on function app.save_analytics_patterns(date, date, text, jsonb) to authenticated;

revoke all on function app.reject_insight(text, text) from public, anon;
grant execute on function app.reject_insight(text, text) to authenticated;

revoke all on function app.unreject_insight(uuid) from public, anon;
grant execute on function app.unreject_insight(uuid) to authenticated;
