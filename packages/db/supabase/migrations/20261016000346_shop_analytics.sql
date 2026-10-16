set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0346 shop_analytics — Touch Shop sales in the owner's analytics, counted
-- as padel revenue (Majed 2026-10-16: "integrate the touch shop analytics to
-- the padel analytics tab, in a way that the shop sales are also counted as
-- padel revenue").
--
-- Shop sales were already recorded in full (0143–0146, 0243–0246: a kind
-- 'shop' tab, its orders and lines with price and cost snapshots, payments
-- and refunds), but nothing summarised them over a range: day_close_shop is
-- one day, report_revenue.shopIqd is "of which shop" inside café money and no
-- screen read it. And the analytics café figures counted every shop sale as
-- café money.
--
--   1. app.analytics_shop       owner (analytics_guard): the analysed branch's
--                               shop sales for a business-day range, the shop
--                               block of the Courts (padel) tab. Net revenue is
--                               the café_settled_tabs measure for shop tabs
--                               (total less refunds, dated by the settle day),
--                               so what 2. takes out of café is exactly what
--                               this adds to padel.
--   2. app.analytics_daily_sales re-issued from
--                               20260926000219_reports_venue_scope.sql:983:
--                               café only. Shop tabs leave the money, payment,
--                               line and order figures, and the shop store
--                               leaves waste. A shop sale counts once, as
--                               padel, in the analytics Venue revenue.
--
-- A shop tab holds shop lines only since 0244 (TAB_KIND_MISMATCH,
-- MIXED_BASKET), so tabs.kind = 'shop' is the shop sale. A shop line rung on
-- a café counter tab before 0244 stays café money here, as it was.
--
-- Not changed: the Reports pages (report_revenue keeps "of which shop" inside
-- café, reports_figures, report_cafe) and the café item analytics (best
-- sellers, margins, sold items, price bands, hourly, bought together, promo),
-- which still list shop products among café items.
--
-- SEC-29: analytics_shop returns counts, money and product names only; no
-- seller, customer or member.
--
-- Everything here reads and nothing locks, so check:locks has nothing to walk.

-- ===========================================================================
-- 1. app.analytics_shop
-- ===========================================================================
create or replace function app.analytics_shop(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_shop_0346$
declare
  v_b   record;
  v_av  uuid;
  v_out jsonb;
begin
  perform app.analytics_guard();
  v_av := app.analysis_venue();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  st as (
    select t.id                                                                  as tab_id,
           app.business_date(t.settled_at, v_b.tz, v_b.start_hour)               as d,
           extract(hour from (t.settled_at at time zone v_b.tz))::int            as hour,
           (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0))::bigint          as gross_iqd,
           coalesce(t.discount_iqd, 0)::bigint                                   as discount_iqd,
           coalesce(r.refunds_iqd, 0)::bigint                                    as refunds_iqd,
           (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0) - coalesce(r.refunds_iqd, 0))::bigint as net_iqd
      from tabs t
      left join lateral (
        select sum(rf.amount_iqd) as refunds_iqd
          from refunds rf
          join payments p on p.id = rf.payment_id
         where p.tab_id = t.id and p.venue_id = v_av and rf.venue_id = v_av
      ) r on true
     where t.venue_id = v_av
       and t.kind = 'shop'
       and t.status = 'settled'
       and t.merged_into_tab_id is null
       and t.settled_at >= v_b.ts_from and t.settled_at < v_b.ts_to),
  nl as (
    select x.*
      from app.cafe_net_lines((select coalesce(array_agg(st.tab_id), '{}'::uuid[]) from st)) x),
  lines as (
    select nl.tab_id,
           sum(nl.qty - nl.refund_qty)::bigint                                                   as units,
           coalesce(sum(nl.qty - nl.refund_qty) filter (where nl.cost_iqd is not null), 0)::bigint as costed_units,
           coalesce(sum(nl.net_iqd) filter (where nl.cost_iqd is not null), 0)::bigint           as costed_net_iqd,
           coalesce(sum(nl.cost_total_iqd), 0)::bigint                                           as cost_iqd
      from nl
     group by nl.tab_id),
  pay as (
    -- Refunds summed per payment first: a payment with two refund rows is
    -- counted once.
    select coalesce(sum(p.amount_iqd - coalesce(r.refunded, 0)) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd - coalesce(r.refunded, 0)) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from st
      join payments p on p.tab_id = st.tab_id and p.venue_id = v_av
      left join lateral (select sum(rf.amount_iqd) as refunded from refunds rf where rf.payment_id = p.id and rf.venue_id = v_av) r on true),
  tot as (
    select count(*)::bigint                                          as sales,
           coalesce(sum(st.net_iqd), 0)::bigint                      as net_iqd,
           coalesce(sum(st.gross_iqd), 0)::bigint                    as gross_iqd,
           coalesce(sum(st.refunds_iqd), 0)::bigint                  as refunds_iqd,
           coalesce(sum(st.discount_iqd), 0)::bigint                 as discount_iqd,
           count(*) filter (where st.refunds_iqd > 0)::bigint        as refunded_sales,
           coalesce(sum(l.units), 0)::bigint                         as units,
           coalesce(sum(l.costed_units), 0)::bigint                  as costed_units,
           coalesce(sum(l.costed_net_iqd), 0)::bigint                as costed_net_iqd,
           coalesce(sum(l.cost_iqd), 0)::bigint                      as cost_iqd
      from st
      left join lines l on l.tab_id = st.tab_id),
  days as (
    select st.d,
           count(*)::bigint                      as sales,
           sum(st.net_iqd)::bigint               as net_iqd,
           sum(st.gross_iqd)::bigint             as gross_iqd,
           sum(st.refunds_iqd)::bigint           as refunds_iqd,
           sum(st.discount_iqd)::bigint          as discount_iqd,
           coalesce(sum(l.units), 0)::bigint     as units
      from st
      left join lines l on l.tab_id = st.tab_id
     group by st.d),
  hours as (
    select st.hour, count(*)::bigint as sales, sum(st.net_iqd)::bigint as net_iqd
      from st
     group by st.hour),
  items as (
    select nl.menu_item_id, nl.variant_id,
           sum(nl.qty - nl.refund_qty)::bigint                                                    as units,
           sum(nl.net_iqd)::bigint                                                                as net_iqd,
           coalesce(sum(nl.qty - nl.refund_qty) filter (where nl.cost_iqd is not null), 0)::bigint as costed_units,
           sum(nl.cost_total_iqd)::bigint                                                         as cost_iqd,
           coalesce(sum(nl.net_iqd) filter (where nl.cost_iqd is not null), 0)::bigint            as costed_net_iqd,
           count(distinct nl.tab_id)::bigint                                                      as sales
      from nl
     group by nl.menu_item_id, nl.variant_id),
  ranked as (
    select i.*, mi.name_en, mi.name_ar, mi.category_id,
           v.name_en as variant_en, v.name_ar as variant_ar,
           row_number() over (order by i.net_iqd desc, i.units desc, i.menu_item_id, i.variant_id) as rn
      from items i
      join menu_items mi on mi.id = i.menu_item_id
      left join menu_item_variants v on v.id = i.variant_id),
  cats as (
    select r.category_id, c.name_en, c.name_ar,
           sum(r.units)::bigint as units, sum(r.net_iqd)::bigint as net_iqd
      from ranked r
      join menu_categories c on c.id = r.category_id
     group by r.category_id, c.name_en, c.name_ar)
  select jsonb_build_object(
           'range', jsonb_build_object('from', p_from, 'to', p_to),
           'kpis', (select jsonb_build_object(
               'sales',          t.sales,
               'net_iqd',        t.net_iqd,
               'gross_iqd',      t.gross_iqd,
               'refunds_iqd',    t.refunds_iqd,
               'discount_iqd',   t.discount_iqd,
               'refunded_sales', t.refunded_sales,
               'units',          t.units,
               'avg_sale_iqd',   case when t.sales > 0 then round(t.net_iqd::numeric / t.sales)::bigint end,
               'costed_units',   t.costed_units,
               'cost_iqd',       t.cost_iqd,
               'margin_iqd',     case when t.costed_units > 0 then t.costed_net_iqd - t.cost_iqd end,
               'margin_pct',     case when t.costed_units > 0 and t.costed_net_iqd > 0
                                      then round((t.costed_net_iqd - t.cost_iqd) * 100.0 / t.costed_net_iqd, 1) end,
               'cash_iqd',       (select pay.cash_iqd from pay),
               'card_iqd',       (select pay.card_iqd from pay))
             from tot t),
           'by_day', coalesce((select jsonb_agg(jsonb_build_object(
               'business_date', d.d, 'sales', d.sales, 'net_iqd', d.net_iqd, 'gross_iqd', d.gross_iqd,
               'refunds_iqd', d.refunds_iqd, 'discount_iqd', d.discount_iqd, 'units', d.units) order by d.d)
             from days d), '[]'::jsonb),
           'by_hour', coalesce((select jsonb_agg(jsonb_build_object(
               'hour', h.hour, 'sales', h.sales, 'net_iqd', h.net_iqd) order by h.hour)
             from hours h), '[]'::jsonb),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
               'menu_item_id', r.menu_item_id,
               'variant_id',   r.variant_id,
               'name_en',      r.name_en,
               'name_ar',      r.name_ar,
               'variant_en',   r.variant_en,
               'variant_ar',   r.variant_ar,
               'units',        r.units,
               'sales',        r.sales,
               'net_iqd',      r.net_iqd,
               'costed_units', r.costed_units,
               'margin_iqd',   case when r.costed_units > 0 then r.costed_net_iqd - coalesce(r.cost_iqd, 0) end) order by r.rn)
             from ranked r where r.rn <= 50), '[]'::jsonb),
           'categories', coalesce((select jsonb_agg(jsonb_build_object(
               'category_id', c.category_id, 'name_en', c.name_en, 'name_ar', c.name_ar,
               'units', c.units, 'net_iqd', c.net_iqd) order by c.net_iqd desc, c.category_id)
             from cats c), '[]'::jsonb))
    into v_out;

  return v_out;
end $analytics_shop_0346$;

comment on function app.analytics_shop(date, date) is
  '0346. Owner (analytics_guard): the analysed branch''s Touch Shop sales for a business-day range, the shop block of the Courts (padel) tab, where shop money counts as padel revenue. A sale is a settled, unmerged kind shop tab dated by its settle day. kpis {sales, net_iqd (total less refunds, the cafe_settled_tabs measure), gross_iqd, refunds_iqd, discount_iqd, refunded_sales, units (sold less refunded), avg_sale_iqd, costed_units, cost_iqd, margin_iqd and margin_pct (lines with a cost snapshot only; null when none), cash_iqd, card_iqd (net of refunds)}, by_day (sales, net, gross, refunds, discount, units), by_hour, items (top 50 by net, net before tax from cafe_net_lines) and categories. Counts, money and product names only.';

revoke all on function app.analytics_shop(date, date) from public, anon;
grant execute on function app.analytics_shop(date, date) to authenticated;

-- ===========================================================================
-- 2. app.analytics_daily_sales: café only
-- ===========================================================================
-- Re-issued from 20260926000219_reports_venue_scope.sql:983. Changed: `st`
-- drops kind shop tabs, `lines` and `ord` drop lines and orders on them, and
-- `waste` drops the shop store. Everything else as 0219.
create or replace function app.analytics_daily_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_daily_sales_0346$
declare
  v_rv uuid[] := app.report_venues();
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  st as (
    select app.business_date(s.settled_at, v_b.tz, v_b.start_hour) as d, s.*
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
     where t.kind <> 'shop'),   -- 0346: shop money is padel revenue (app.analytics_shop)
  money as (
    select st.d,
           count(*)                                as tabs_settled,
           sum(st.cafe_gross_iqd)::bigint          as cafe_gross_iqd,
           sum(st.cafe_net_iqd)::bigint            as cafe_net_iqd,
           sum(st.goods_iqd)::bigint               as goods_iqd,
           sum(st.court_iqd)::bigint               as court_fees_iqd,
           sum(st.refunds_iqd)::bigint             as refunds_iqd,
           sum(st.discount_iqd)::bigint            as discount_iqd,
           sum(st.tax_iqd)::bigint                 as tax_iqd
      from st
     group by st.d),
  pay as (
    -- Refunds are summed per payment FIRST: a payment with two refund rows
    -- must not be counted twice.
    select st.d,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint   as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint   as card_iqd,
           coalesce(sum(r.refunded) filter (where p.method = 'cash'), 0)::bigint     as cash_ref_iqd,
           coalesce(sum(r.refunded) filter (where p.method = 'card'), 0)::bigint     as card_ref_iqd
      from st
      join payments p on p.tab_id = st.tab_id
      left join lateral (select sum(rf.amount_iqd) as refunded from refunds rf where rf.venue_id = any(v_rv) and rf.payment_id = p.id) r on true
     group by st.d),
  lines as (
    select l.business_date as d,
           sum(l.net_qty)::bigint             as items_qty,
           sum(l.refund_iqd)::bigint          as item_refunds_iqd,
           sum(l.discount_line_iqd)::bigint   as promo_discount_iqd
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join tabs t on t.id = l.tab_id
     where t.kind <> 'shop'
     group by l.business_date),
  ord as (
    select app.business_date(o.placed_at, v_b.tz, v_b.start_hour) as d,
           count(*)                                              as orders,
           count(*) filter (where o.source = 'guest_web')        as guest_orders,
           count(*) filter (where o.source = 'till')             as till_orders,
           count(distinct o.tab_id)                              as visits
      from orders o
      join tabs t on t.id = o.tab_id
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and t.kind <> 'shop'
     group by 1),
  calls as (
    select app.business_date(w.raised_at, v_b.tz, v_b.start_hour) as d,
           count(*) as waiter_calls
      from waiter_calls w
     where w.venue_id = any(v_rv) and w.raised_at >= v_b.ts_from and w.raised_at < v_b.ts_to
     group by 1),
  -- 0099: stock written off, at its movement cost, on the day it was written
  -- off. The same rows and arithmetic as the panel's waste figure
  -- (app.reports_figures), bucketed by business day; 0346: the café's
  -- stores only, never the shop's.
  waste as (
    select app.business_date(sm.at, v_b.tz, v_b.start_hour) as d,
           coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as waste_iqd
      from stock_movements sm
     where sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.location <> 'shop'
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
     group by 1),
  days as (
    select d from money
    union select d from ord
    union select d from calls
    union select d from waste)
  select coalesce(jsonb_agg(jsonb_build_object(
           'business_date',      days.d,
           'revenue_iqd',        coalesce(money.cafe_net_iqd, 0),
           'cafe_gross_iqd',     coalesce(money.cafe_gross_iqd, 0),
           'cafe_net_iqd',       coalesce(money.cafe_net_iqd, 0),
           'goods_iqd',          coalesce(money.goods_iqd, 0),
           'court_fees_iqd',     coalesce(money.court_fees_iqd, 0),
           'refunds_iqd',        coalesce(money.refunds_iqd, 0),
           'item_refunds_iqd',   coalesce(lines.item_refunds_iqd, 0),
           'promo_discount_iqd', coalesce(lines.promo_discount_iqd, 0),
           'cash_iqd',           coalesce(pay.cash_iqd, 0) - coalesce(pay.cash_ref_iqd, 0),
           'card_iqd',           coalesce(pay.card_iqd, 0) - coalesce(pay.card_ref_iqd, 0),
           'tabs_settled',       coalesce(money.tabs_settled, 0),
           'orders',             coalesce(ord.orders, 0),
           'items_qty',          coalesce(lines.items_qty, 0),
           'discount_iqd',       coalesce(money.discount_iqd, 0),
           'tax_iqd',            coalesce(money.tax_iqd, 0),
           'visits',             coalesce(ord.visits, 0),
           'guest_orders',       coalesce(ord.guest_orders, 0),
           'till_orders',        coalesce(ord.till_orders, 0),
           'waiter_calls',       coalesce(calls.waiter_calls, 0),
           'waste_iqd',          coalesce(waste.waste_iqd, 0)
         ) order by days.d), '[]'::jsonb)
    into v_out
    from days
    left join money on money.d = days.d
    left join pay   on pay.d   = days.d
    left join lines on lines.d = days.d
    left join ord   on ord.d   = days.d
    left join calls on calls.d = days.d
    left join waste on waste.d = days.d;

  return v_out;
end $analytics_daily_sales_0346$;

comment on function app.analytics_daily_sales(date, date) is
  '0099, 0219, 0346. Owner (analytics_guard): the café''s daily sales rows for the branches in report scope, settle-day basis. 0346: café only; kind shop tabs, their lines and orders and the shop store''s waste are left out (shop money is padel revenue, app.analytics_shop).';

revoke all on function app.analytics_daily_sales(date, date) from public, anon;
grant execute on function app.analytics_daily_sales(date, date) to authenticated;
