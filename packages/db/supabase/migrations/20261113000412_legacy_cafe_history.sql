-- 0412 legacy_cafe_history — the café's sales from before the system, as the
-- old till (Morabaa) printed them, in the figures the owner already reads
-- (Majed 2026-11-13: "add the data to analytics", and the assistant must see
-- it).
--
-- What arrived. Nine PDF exports of the old till (client-data/cafe-pos-2026):
-- four monthly orders reports, four monthly items reports and one longer items
-- report, 2 June to 31 October 2026. client-data/cafe-pos-2026/extract.py
-- reads them into three files, and 0413 loads those files; this migration is
-- the schema and the reads.
--
-- What. Three tables, all empty here, and one view:
--   * legacy_cafe_hours     one row per calendar day and clock hour of the
--                           till: what the ITEMS report holds for that hour
--                           (lines, units, their money, tickets) and what the
--                           ORDERS report holds (orders, their money, the
--                           discounts given and the money received). The four
--                           orders columns are null on a day no orders report
--                           covers (31 July, 31 August, 30 September and all
--                           of October): unknown, never zero.
--   * legacy_cafe_item_days one row per day, product name and unit price:
--                           the units sold. The name is the till's own.
--   * legacy_cafe_products  one row per product name and unit price: OUR
--                           grouping (read from the name) and the owner's
--                           cost where his cost sheet names the item
--                           (client-data/item-costs-2026-11.md). Not till
--                           data; labelled as ours wherever it is shown.
--   * legacy_cafe_days      (view) one row per day: gross, discounts, net,
--                           orders and units, by ONE rule: where both reports
--                           hold a day, the larger gross is the more complete
--                           one (the items report misses lines on the till's
--                           first days; the monthly orders reports were cut
--                           before the last orders of their final day), and
--                           net is the money the orders report says was
--                           received plus any items money that report lacks.
--                           Where only the items report holds the day, net is
--                           its gross and the discounts are unknown (null).
-- Nothing is estimated or spread: every figure is a sum of printed rows. A day
-- is the till's own calendar day (22 of 41,968 lines fall before 06:00), not
-- the 04:00 business day the system uses.
--
-- Where it counts.
--   * app.analytics_daily_sales (re-issued from 0346, verbatim except the
--     marked 0412 lines): an old-till day is a row like any other. Its money
--     adds into revenue_iqd, cafe_gross_iqd, cafe_net_iqd and goods_iqd, its
--     orders into tabs_settled, orders, visits and till_orders, its units into
--     items_qty and its discounts into discount_iqd. Cash, card, refunds and
--     waste get nothing: the till's reports do not have them. Two new keys on
--     every row: old_till_iqd (how much of revenue_iqd is the old till's) and
--     old_till_discount_known (null with no old-till rows that day).
--   * app.analytics_hourly (re-issued from 0095, verbatim except the marked
--     lines): the old till's hours add into the weekday-by-hour cells.
--   * app.panel_headline (re-issued from 0349, verbatim except the marked
--     lines): cafeRevenue, cafeNet, revenue, orders, discounts and
--     avgOrderValue include the old till's days, and history.period.cafe /
--     history.comparison.cafe say how much.
--   * New app.analytics_cafe_history(p_from, p_to), owner only: the old till's
--     months, product groups and products in a range, with the owner's cost
--     where known. The item cards of Analytics > Café read menu items by id
--     and stay the system's own; the old till's products are shown under
--     their own names, never mapped onto the menu.
-- app.reports_figures is NOT changed (report_revenue and the day-close figures
-- stay pinned to it), and neither are app.legacy_report_totals or
-- app.legacy_add_to_figures (the padel reports): the café has its own two
-- helpers, app.legacy_cafe_totals and app.legacy_cafe_add_to_figures.
--
-- Who. The owner reads all four (the analytics rule), at the branches in
-- scope. No client writes. The owner assistant reads them through table_read.
--
-- Re-runnable: create table if not exists, create or replace, drop/create
-- policy and trigger, on conflict do nothing. No index beyond the primary keys.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. legacy_cafe_hours
-- ---------------------------------------------------------------------------
create table if not exists legacy_cafe_hours (
  venue_id         uuid not null references venues(id),
  day              date not null,
  hour             smallint not null,
  item_lines       int not null,
  units            int not null,
  items_gross_iqd  bigint not null,
  tickets          int not null,
  orders           int,
  orders_gross_iqd bigint,
  discount_iqd     bigint,
  received_iqd     bigint,
  primary key (venue_id, day, hour),
  constraint legacy_cafe_hours_hour_chk check (hour between 0 and 23),
  constraint legacy_cafe_hours_items_chk check (
    item_lines >= 0 and units >= 0 and items_gross_iqd >= 0 and tickets >= 0),
  constraint legacy_cafe_hours_orders_chk check (
    (orders is null) = (orders_gross_iqd is null)
    and (orders is null) = (discount_iqd is null)
    and (orders is null) = (received_iqd is null)
    and (orders is null or (orders >= 0 and orders_gross_iqd >= 0
                            and discount_iqd >= 0 and received_iqd >= 0)))
);

comment on table legacy_cafe_hours is
  'legacy_cafe_hours (0412): the café''s sales from before the system, 2 June to 31 October 2026, as the old till (Morabaa) printed them; one row per calendar day and clock hour. Sums of printed rows only, nothing estimated. The items columns come from the till''s items reports, the orders columns from its orders reports; the orders columns are null on a day no orders report covers (31 July, 31 August, 30 September, all of October), which means unknown, not zero. 30 June is in no report. For one figure per day read the view legacy_cafe_days. Read by the owner; written only by migration (client-data/cafe-pos-2026).';
comment on column legacy_cafe_hours.venue_id is 'The branch the till stood in.';
comment on column legacy_cafe_hours.day is 'The till''s own calendar day (not the 04:00 business day the system uses).';
comment on column legacy_cafe_hours.hour is 'The clock hour, 0 to 23, the till printed on the row.';
comment on column legacy_cafe_hours.item_lines is 'Item lines the items report holds in this hour.';
comment on column legacy_cafe_hours.units is 'Units sold on those lines (water bottles included, so it is large).';
comment on column legacy_cafe_hours.items_gross_iqd is 'Money of those lines at the price charged, before any order discount, IQD.';
comment on column legacy_cafe_hours.tickets is 'Distinct orders among those lines, by the till''s own order counter; an order belongs to the hour of its first line.';
comment on column legacy_cafe_hours.orders is 'Orders the orders report holds in this hour; null when no orders report covers the day.';
comment on column legacy_cafe_hours.orders_gross_iqd is 'Their amount before discount, IQD; null when no orders report covers the day.';
comment on column legacy_cafe_hours.discount_iqd is 'Discounts given on them, IQD; null (unknown) when no orders report covers the day.';
comment on column legacy_cafe_hours.received_iqd is 'Money received for them, IQD; null when no orders report covers the day.';

alter table legacy_cafe_hours enable row level security;
revoke all on legacy_cafe_hours from anon, authenticated;

drop policy if exists legacy_cafe_hours_owner_read on legacy_cafe_hours;
create policy legacy_cafe_hours_owner_read on legacy_cafe_hours
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on legacy_cafe_hours to authenticated;
grant all on legacy_cafe_hours to service_role;

drop trigger if exists zz_branch_guard on public.legacy_cafe_hours;
create trigger zz_branch_guard before insert or update or delete on public.legacy_cafe_hours
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 2. legacy_cafe_item_days
-- ---------------------------------------------------------------------------
create table if not exists legacy_cafe_item_days (
  venue_id       uuid not null references venues(id),
  day            date not null,
  product        text not null,
  unit_price_iqd bigint not null,
  units          int not null,
  primary key (venue_id, day, product, unit_price_iqd),
  constraint legacy_cafe_item_days_chk check (
    unit_price_iqd >= 0 and units > 0 and length(product) between 1 and 120)
);

comment on table legacy_cafe_item_days is
  'legacy_cafe_item_days (0412): what the café sold before the system, from the old till''s items reports, 2 June to 31 October 2026; one row per calendar day, product name and unit price. The money of a row is units x unit_price_iqd, before any order discount. The product is the till''s own name (Arabic, with the size in the name: كبير large, وسط medium) and is not linked to a menu item. Its group and the owner''s cost are in legacy_cafe_products. Read by the owner; written only by migration.';
comment on column legacy_cafe_item_days.venue_id is 'The branch the till stood in.';
comment on column legacy_cafe_item_days.day is 'The till''s own calendar day.';
comment on column legacy_cafe_item_days.product is 'The product name exactly as the till printed it (Unicode-normalised).';
comment on column legacy_cafe_item_days.unit_price_iqd is 'The price charged for one unit, IQD. One name can carry two prices (كوكيز at 2,000 is the plain cookie, at 3,000 the stuffed one).';
comment on column legacy_cafe_item_days.units is 'Units sold that day at that price.';

alter table legacy_cafe_item_days enable row level security;
revoke all on legacy_cafe_item_days from anon, authenticated;

drop policy if exists legacy_cafe_item_days_owner_read on legacy_cafe_item_days;
create policy legacy_cafe_item_days_owner_read on legacy_cafe_item_days
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on legacy_cafe_item_days to authenticated;
grant all on legacy_cafe_item_days to service_role;

drop trigger if exists zz_branch_guard on public.legacy_cafe_item_days;
create trigger zz_branch_guard before insert or update or delete on public.legacy_cafe_item_days
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 3. legacy_cafe_products
-- ---------------------------------------------------------------------------
create table if not exists legacy_cafe_products (
  venue_id       uuid not null references venues(id),
  product        text not null,
  unit_price_iqd bigint not null,
  group_key      text not null,
  cost_iqd       bigint,
  cost_stated    text,
  primary key (venue_id, product, unit_price_iqd),
  constraint legacy_cafe_products_group_chk check (group_key in (
    'dessert_food', 'juice', 'smoothie_shake', 'mojito', 'iced_coffee', 'water_ice',
    'hot_coffee', 'tea_chocolate', 'espresso', 'other')),
  constraint legacy_cafe_products_cost_chk check (
    (cost_iqd is null) = (cost_stated is null) and (cost_iqd is null or cost_iqd >= 0))
);

comment on table legacy_cafe_products is
  'legacy_cafe_products (0412): one row per product name and unit price of legacy_cafe_item_days. NOT till data: group_key is our grouping, read from the name; cost_iqd is what the owner said one unit costs the club (Majed, 2026-11-09, client-data/item-costs-2026-11.md), matched to the till''s name by us. The cost sheet names no sizes, so one cost stands for every size of an item. cost_iqd is null where the sheet does not name the item (about 39% of the money, among them ice cream, the Spanish latte, slush, cheesecake, watermelon and water). Read by the owner; written only by migration.';
comment on column legacy_cafe_products.venue_id is 'The branch.';
comment on column legacy_cafe_products.product is 'The till''s product name (legacy_cafe_item_days.product).';
comment on column legacy_cafe_products.unit_price_iqd is 'The unit price the name was sold at, IQD.';
comment on column legacy_cafe_products.group_key is 'Our grouping, from the name: dessert_food, juice, smoothie_shake (smoothies, milkshakes, slush, frappuccino), mojito, iced_coffee, water_ice, hot_coffee, tea_chocolate (tea, hibiscus, hot and iced chocolate), espresso, other.';
comment on column legacy_cafe_products.cost_iqd is 'What one unit costs the club, IQD, as the owner stated it; null when his sheet does not name the item. An owner''s figure, not a till or invoice figure.';
comment on column legacy_cafe_products.cost_stated is 'The line of the owner''s cost sheet the cost was taken from, as he wrote it.';

alter table legacy_cafe_products enable row level security;
revoke all on legacy_cafe_products from anon, authenticated;

drop policy if exists legacy_cafe_products_owner_read on legacy_cafe_products;
create policy legacy_cafe_products_owner_read on legacy_cafe_products
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on legacy_cafe_products to authenticated;
grant all on legacy_cafe_products to service_role;

drop trigger if exists zz_branch_guard on public.legacy_cafe_products;
create trigger zz_branch_guard before insert or update or delete on public.legacy_cafe_products
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 4. legacy_cafe_days: one figure per day, by the rule in the header.
--    security_invoker: the reader's own right to legacy_cafe_hours decides.
-- ---------------------------------------------------------------------------
create or replace view legacy_cafe_days with (security_invoker = on) as
select h.venue_id,
       h.day,
       greatest(coalesce(sum(h.orders_gross_iqd), 0), sum(h.items_gross_iqd))::bigint as gross_iqd,
       sum(h.discount_iqd)::bigint                                                    as discount_iqd,
       (coalesce(sum(h.received_iqd), 0)
        + greatest(sum(h.items_gross_iqd) - coalesce(sum(h.orders_gross_iqd), 0), 0))::bigint as net_iqd,
       greatest(coalesce(sum(h.orders), 0), sum(h.tickets))::int                      as orders,
       sum(h.units)::int                                                              as units,
       bool_or(h.orders is not null)                                                  as has_orders_export
  from legacy_cafe_hours h
 group by h.venue_id, h.day;

comment on view legacy_cafe_days is
  'legacy_cafe_days (0412): the café''s sales from before the system, one row per calendar day of the old till, 2 June to 31 October 2026 (147 trading days; 30 June is in no report; closed 25 and 26 June, 3 and 4 August). Built from legacy_cafe_hours. These days are already inside analytics_daily_sales and the management panel''s café figures, so never add them to those a second time. The padel desk''s reports for June to September are in legacy_reports. Read by the owner.';
comment on column legacy_cafe_days.venue_id is 'The branch.';
comment on column legacy_cafe_days.day is 'The till''s own calendar day.';
comment on column legacy_cafe_days.gross_iqd is 'Sales before order discounts, IQD: the larger of the orders report''s and the items report''s total for the day (the more complete of the two).';
comment on column legacy_cafe_days.discount_iqd is 'Discounts given, IQD; null (unknown) on a day no orders report covers.';
comment on column legacy_cafe_days.net_iqd is 'Money taken, IQD: what the orders report says was received, plus any items money that report lacks; on a day with no orders report it equals gross_iqd because the discounts are unknown.';
comment on column legacy_cafe_days.orders is 'Orders that day: the larger of the orders report''s count and the items report''s distinct tickets.';
comment on column legacy_cafe_days.units is 'Units sold that day (water bottles included).';
comment on column legacy_cafe_days.has_orders_export is 'True when an orders report covers the day, so its discounts and received money are known.';

revoke all on legacy_cafe_days from anon, authenticated;
grant select on legacy_cafe_days to authenticated;
grant select on legacy_cafe_days to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.legacy_cafe_totals: the old till's days of p_venues in [p_from, p_to].
-- ---------------------------------------------------------------------------
create or replace function app.legacy_cafe_totals(p_venues uuid[], p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public as $legacy_cafe_totals_0412$
  select jsonb_build_object(
           'days',                count(*),
           'from',                min(lc.day),
           'to',                  max(lc.day),
           'gross',               coalesce(sum(lc.gross_iqd), 0)::bigint,
           'discounts',           coalesce(sum(lc.discount_iqd), 0)::bigint,
           'net',                 coalesce(sum(lc.net_iqd), 0)::bigint,
           'orders',              coalesce(sum(lc.orders), 0)::bigint,
           'units',               coalesce(sum(lc.units), 0)::bigint,
           'discountUnknownDays', count(*) filter (where not lc.has_orders_export))
    from legacy_cafe_days lc
   where lc.venue_id = any(coalesce(p_venues, '{}'::uuid[]))
     and lc.day between p_from and p_to
$legacy_cafe_totals_0412$;

comment on function app.legacy_cafe_totals(uuid[], date, date) is
  '0412. Internal (read by panel_headline and analytics_cafe_history). The old café till''s days (legacy_cafe_days) of p_venues inside [p_from, p_to], day by day, so a range may cut a month: {days, from, to (the first and last such day, null with none), gross, discounts, net, orders, units, discountUnknownDays (days no orders report covers, whose discounts are unknown and count as 0)}.';

revoke all on function app.legacy_cafe_totals(uuid[], date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.legacy_cafe_add_to_figures: a reports_figures object plus the old till.
-- ---------------------------------------------------------------------------
create or replace function app.legacy_cafe_add_to_figures(p_fig jsonb, p_lc jsonb)
returns jsonb
language plpgsql immutable set search_path = public as $legacy_cafe_add_to_figures_0412$
declare
  v_gross  bigint;
  v_orders bigint;
begin
  if p_fig is null or p_lc is null or coalesce((p_lc ->> 'days')::bigint, 0) = 0 then
    return p_fig;
  end if;
  v_gross  := (p_fig ->> 'cafeRevenue')::bigint + (p_lc ->> 'gross')::bigint;
  v_orders := (p_fig ->> 'orders')::bigint + (p_lc ->> 'orders')::bigint;
  return p_fig
    || jsonb_build_object(
         'revenue',       (p_fig ->> 'revenue')::bigint + (p_lc ->> 'net')::bigint,
         'cafeRevenue',   v_gross,
         'cafeNet',       (p_fig ->> 'cafeNet')::bigint + (p_lc ->> 'net')::bigint,
         'orders',        v_orders,
         'avgOrderValue', case when v_orders > 0 then round(v_gross::numeric / v_orders)::bigint else 0 end,
         'discounts',     (p_fig ->> 'discounts')::bigint + (p_lc ->> 'discounts')::bigint);
end $legacy_cafe_add_to_figures_0412$;

comment on function app.legacy_cafe_add_to_figures(jsonb, jsonb) is
  '0412. Internal: an app.reports_figures object with app.legacy_cafe_totals added: revenue and cafeNet + the old till''s net, cafeRevenue + its gross, orders + its orders, discounts + its known discounts, and avgOrderValue recomputed the way reports_figures does (cafeRevenue / orders). Cash, card, refunds, waste and every padel key unchanged: the till''s reports do not have them.';

revoke all on function app.legacy_cafe_add_to_figures(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. analytics_daily_sales: re-issued from 20261016000346_shop_analytics.sql.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_daily_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_daily_sales_0412$
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
  -- 0412: the old till's days (legacy_cafe_days) of the branches in report
  -- scope. Its day is the till's own calendar day.
  old as (
    select lc.day                                    as d,
           sum(lc.gross_iqd)::bigint                 as gross_iqd,
           sum(lc.net_iqd)::bigint                   as net_iqd,
           coalesce(sum(lc.discount_iqd), 0)::bigint as discount_iqd,
           sum(lc.orders)::bigint                    as orders,
           sum(lc.units)::bigint                     as units,
           bool_and(lc.has_orders_export)            as discount_known
      from legacy_cafe_days lc
     where lc.venue_id = any(v_rv) and lc.day between p_from and p_to
     group by lc.day),
  days as (
    select d from money
    union select d from ord
    union select d from calls
    union select d from waste
    union select d from old)
  select coalesce(jsonb_agg(jsonb_build_object(
           'business_date',      days.d,
           'revenue_iqd',        coalesce(money.cafe_net_iqd, 0) + coalesce(old.net_iqd, 0),
           'cafe_gross_iqd',     coalesce(money.cafe_gross_iqd, 0) + coalesce(old.gross_iqd, 0),
           'cafe_net_iqd',       coalesce(money.cafe_net_iqd, 0) + coalesce(old.net_iqd, 0),
           'goods_iqd',          coalesce(money.goods_iqd, 0) + coalesce(old.gross_iqd, 0),
           'court_fees_iqd',     coalesce(money.court_fees_iqd, 0),
           'refunds_iqd',        coalesce(money.refunds_iqd, 0),
           'item_refunds_iqd',   coalesce(lines.item_refunds_iqd, 0),
           'promo_discount_iqd', coalesce(lines.promo_discount_iqd, 0),
           'cash_iqd',           coalesce(pay.cash_iqd, 0) - coalesce(pay.cash_ref_iqd, 0),
           'card_iqd',           coalesce(pay.card_iqd, 0) - coalesce(pay.card_ref_iqd, 0),
           'tabs_settled',       coalesce(money.tabs_settled, 0) + coalesce(old.orders, 0),
           'orders',             coalesce(ord.orders, 0) + coalesce(old.orders, 0),
           'items_qty',          coalesce(lines.items_qty, 0) + coalesce(old.units, 0),
           'discount_iqd',       coalesce(money.discount_iqd, 0) + coalesce(old.discount_iqd, 0),
           'tax_iqd',            coalesce(money.tax_iqd, 0),
           'visits',             coalesce(ord.visits, 0) + coalesce(old.orders, 0),
           'guest_orders',       coalesce(ord.guest_orders, 0),
           'till_orders',        coalesce(ord.till_orders, 0) + coalesce(old.orders, 0),
           'waiter_calls',       coalesce(calls.waiter_calls, 0),
           'waste_iqd',          coalesce(waste.waste_iqd, 0),
           -- 0412: how much of this day is the old till's, and whether that
           -- till's discounts are known for it (null: no old-till rows).
           'old_till_iqd',            coalesce(old.net_iqd, 0),
           'old_till_discount_known', old.discount_known
         ) order by days.d), '[]'::jsonb)
    into v_out
    from days
    left join money on money.d = days.d
    left join pay   on pay.d   = days.d
    left join lines on lines.d = days.d
    left join ord   on ord.d   = days.d
    left join calls on calls.d = days.d
    left join waste on waste.d = days.d
    left join old   on old.d   = days.d;

  return v_out;
end $analytics_daily_sales_0412$;
comment on function app.analytics_daily_sales(date, date) is
  '0099, 0219, 0346, 0412. Owner (analytics_guard): the café''s daily sales rows for the branches in report scope, settle-day basis. 0346: café only; kind shop tabs, their lines and orders and the shop store''s waste are left out (shop money is padel revenue, app.analytics_shop). 0412: a day of the old till (legacy_cafe_days, 2 June to 31 October 2026, its own calendar day) is a row too: its net is in revenue_iqd and cafe_net_iqd, its gross in cafe_gross_iqd and goods_iqd, its orders in tabs_settled, orders, visits and till_orders, its units in items_qty, its known discounts in discount_iqd; cash, card, refunds and waste hold nothing for it. old_till_iqd is the part of revenue_iqd that is the old till''s; old_till_discount_known is false on a day whose discounts that till''s reports do not give (so net equals gross there), null on a day with no old-till rows.';

revoke all on function app.analytics_daily_sales(date, date) from public, anon;
grant execute on function app.analytics_daily_sales(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. analytics_hourly: re-issued from 20260914000095_cafe_net_lines.sql.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_hourly(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_hourly_0412$
declare
  v_b   record;
  v_out jsonb;
  v_rv  uuid[] := app.report_venues();   -- 0412
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
     select y.dow, y.hour, sum(y.orders)::bigint as orders, sum(y.qty)::bigint as qty,
            sum(y.revenue_iqd)::bigint as revenue_iqd
       from (
      select extract(dow from app.business_date(l.placed_at, v_b.tz, v_b.start_hour))::int as dow,
             extract(hour from (l.placed_at at time zone v_b.tz))::int                      as hour,
             count(distinct l.order_id)                                                     as orders,
             coalesce(sum(l.net_qty), 0)::bigint                                            as qty,
             coalesce(sum(l.net_line_iqd), 0)::bigint                                       as revenue_iqd
        from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
       group by 1, 2
      -- 0412: the old till's hours (legacy_cafe_hours), by its own calendar
      -- day and clock hour; legacy_cafe_days' rule applied hour by hour.
      union all
      select extract(dow from lh.day)::int,
             lh.hour::int,
             sum(greatest(coalesce(lh.orders, 0), lh.tickets))::bigint,
             sum(lh.units)::bigint,
             sum(coalesce(lh.received_iqd, 0)
                 + greatest(lh.items_gross_iqd - coalesce(lh.orders_gross_iqd, 0), 0))::bigint
        from legacy_cafe_hours lh
       where lh.venue_id = any(v_rv) and lh.day between p_from and p_to
       group by 1, 2
       ) y
      group by y.dow, y.hour
    ) x;

  return v_out;
end $analytics_hourly_0412$;
comment on function app.analytics_hourly(date, date) is
  '0095, 0412. Owner (analytics_guard): café orders, units and net revenue by weekday (0 = Sunday) and clock hour. 0412: the old till''s hours (legacy_cafe_hours, 2 June to 31 October 2026) are added in, by the till''s own calendar day and hour.';

revoke all on function app.analytics_hourly(date, date) from public, anon;
grant execute on function app.analytics_hourly(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. panel_headline: re-issued from 20261017000349_legacy_reports_in_figures.sql.
-- ---------------------------------------------------------------------------
create or replace function app.panel_headline(p_from date, p_to date, p_compare text default 'none')
returns jsonb
language plpgsql stable security definer set search_path = public as $panel_headline_0412$
declare
  v_b        record;
  v_cur      jsonb;
  v_prev     jsonb;
  v_cmp_from date;
  v_cmp_to   date;
  v_len      int;
  -- 0265: the seven online-money and open-match keys go last (money.md §7.3),
  -- so every existing position is unchanged. 0288: the two coaching keys
  -- after them (money.md §8.2).
  v_keys     text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','bookings',
                             'orders','avgOrderValue','discounts','refunds','waste','noShows',
                             'onlineDeposits','depositForfeits','ticketSales','ticketRefunds',
                             'ticketForfeits','ticketLiability','matchWrittenOff',
                             'lessonRevenue','owedToCoaches'];
  v_figures  jsonb;
  -- 0349: the pre-system monthly reports whose whole month lies in the range.
  v_rv       uuid[] := app.report_venues();
  v_lg       jsonb;
  v_lgp      jsonb;
  -- 0412: the old café till's days in the range.
  v_lc       jsonb;
  v_lcp      jsonb;
begin
  perform app.reports_guard(true);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_compare is null or p_compare not in ('previousPeriod','sameLastYear','none') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare', hint = 'p_compare must be ''previousPeriod'', ''sameLastYear'' or ''none''';
  end if;

  v_cur := app.reports_figures(p_from, p_to);
  v_lg  := app.legacy_report_totals(v_rv, p_from, p_to);
  v_cur := app.legacy_add_to_figures(v_cur, v_lg);
  v_lc  := app.legacy_cafe_totals(v_rv, p_from, p_to);              -- 0412
  v_cur := app.legacy_cafe_add_to_figures(v_cur, v_lc);             -- 0412

  if p_compare = 'previousPeriod' then
    v_len      := (p_to - p_from) + 1;
    v_cmp_to   := p_from - 1;
    v_cmp_from := p_from - v_len;
  elsif p_compare = 'sameLastYear' then
    v_cmp_from := (p_from - interval '1 year')::date;
    v_cmp_to   := (p_to   - interval '1 year')::date;
  end if;

  if v_cmp_from is not null then
    v_prev := app.reports_figures(v_cmp_from, v_cmp_to);
    v_lgp  := app.legacy_report_totals(v_rv, v_cmp_from, v_cmp_to);
    v_prev := app.legacy_add_to_figures(v_prev, v_lgp);
    v_lcp  := app.legacy_cafe_totals(v_rv, v_cmp_from, v_cmp_to);   -- 0412
    v_prev := app.legacy_cafe_add_to_figures(v_prev, v_lcp);        -- 0412
  end if;

  select jsonb_agg(jsonb_build_object(
           'key',       k,
           'value',     (v_cur ->> k)::bigint,
           'previous',  (v_prev ->> k)::bigint,
           'changeAbs', case when v_prev is not null
                             then (v_cur ->> k)::bigint - (v_prev ->> k)::bigint end,
           'changePct', case when v_prev is not null and (v_prev ->> k)::bigint > 0
                             then round(((v_cur ->> k)::bigint - (v_prev ->> k)::bigint) * 100.0
                                        / (v_prev ->> k)::bigint, 1) end
         ) order by ord)
    into v_figures
    from unnest(v_keys) with ordinality as u(k, ord);

  return jsonb_build_object(
    'period',     jsonb_build_object('from', p_from, 'to', p_to),
    'comparison', case when v_cmp_from is not null
                       then jsonb_build_object('from', v_cmp_from, 'to', v_cmp_to) end,
    'figures',    coalesce(v_figures, '[]'::jsonb),
    -- 0349: which monthly reports are in the figures, and which the range cuts.
    -- 0412: each side also says how much of its café figures is the old till's.
    'history',    jsonb_build_object('period', v_lg || jsonb_build_object('cafe', v_lc),
                                     'comparison', v_lgp || jsonb_build_object('cafe', v_lcp)));
end $panel_headline_0412$;
comment on function app.panel_headline(date, date, text) is
  '0412, from 0349 (0288, 0265). Owner only (reports_guard(true)): the management panel headline for a business-day range, {period, comparison, figures [{key, value, previous, changeAbs, changePct}]} in a fixed key order: revenue, padelRevenue, cafeRevenue, cafeNet, cash, card, bookings, orders, avgOrderValue, discounts, refunds, waste, noShows, then onlineDeposits, depositForfeits, ticketSales, ticketRefunds, ticketForfeits, ticketLiability, matchWrittenOff (money.md §7.3; ticketSales, ticketRefunds and ticketLiability are chain-wide), then lessonRevenue and owedToCoaches (coaching, money.md §8.2: lesson money in revenue as its own line, C-18; the coaches'' share, information only). p_compare: none, previousPeriod or sameLastYear. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT. 0349: period and comparison figures include the pre-system monthly reports whose whole month lies in that window (app.legacy_report_totals: bookings, noShows, padelRevenue, revenue), and history {period, comparison} names the reports included and the ones the window cuts. 0412: they also include the old café till''s days inside that window, day by day (app.legacy_cafe_totals: cafeRevenue, cafeNet, revenue, orders, discounts, and avgOrderValue recomputed; cash and card do not), and history.period.cafe / history.comparison.cafe carry that object.';

revoke all on function app.panel_headline(date, date, text) from public, anon;
grant execute on function app.panel_headline(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.analytics_cafe_history: the old till in a range, for its own card.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_cafe_history(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_cafe_history_0412$
declare
  v_rv  uuid[] := app.report_venues();
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  d as (
    select lc.* from legacy_cafe_days lc
     where lc.venue_id = any(v_rv) and lc.day between p_from and p_to),
  m as (
    select date_trunc('month', d.day)::date as month,
           count(*)                                    as days,
           sum(d.gross_iqd)::bigint                    as gross_iqd,
           coalesce(sum(d.discount_iqd), 0)::bigint    as discount_iqd,
           sum(d.net_iqd)::bigint                      as net_iqd,
           sum(d.orders)::bigint                       as orders,
           sum(d.units)::bigint                        as units,
           count(*) filter (where not d.has_orders_export) as discount_unknown_days
      from d group by 1),
  i as (
    select p.product, p.unit_price_iqd, p.group_key, p.cost_iqd,
           sum(x.units)::bigint                        as units,
           sum(x.units * x.unit_price_iqd)::bigint     as gross_iqd
      from legacy_cafe_item_days x
      join legacy_cafe_products p
        on p.venue_id = x.venue_id and p.product = x.product and p.unit_price_iqd = x.unit_price_iqd
     where x.venue_id = any(v_rv) and x.day between p_from and p_to
     group by p.product, p.unit_price_iqd, p.group_key, p.cost_iqd),
  g as (
    select i.group_key,
           sum(i.units)::bigint                                              as units,
           sum(i.gross_iqd)::bigint                                          as gross_iqd,
           coalesce(sum(i.gross_iqd) filter (where i.cost_iqd is not null), 0)::bigint       as cost_known_gross_iqd,
           coalesce(sum(i.units * i.cost_iqd) filter (where i.cost_iqd is not null), 0)::bigint as cost_iqd
      from i group by i.group_key)
  select jsonb_build_object(
    'totals',   app.legacy_cafe_totals(v_rv, p_from, p_to),
    'months',   coalesce((select jsonb_agg(jsonb_build_object(
                    'month', m.month, 'days', m.days, 'gross_iqd', m.gross_iqd,
                    'discount_iqd', m.discount_iqd, 'net_iqd', m.net_iqd, 'orders', m.orders,
                    'units', m.units, 'discount_unknown_days', m.discount_unknown_days)
                    order by m.month) from m), '[]'::jsonb),
    'groups',   coalesce((select jsonb_agg(jsonb_build_object(
                    'key', g.group_key, 'units', g.units, 'gross_iqd', g.gross_iqd,
                    'cost_known_gross_iqd', g.cost_known_gross_iqd, 'cost_iqd', g.cost_iqd)
                    order by g.gross_iqd desc, g.group_key) from g), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
                    'product', i.product, 'unit_price_iqd', i.unit_price_iqd, 'group', i.group_key,
                    'units', i.units, 'gross_iqd', i.gross_iqd,
                    'unit_cost_iqd', i.cost_iqd,
                    'cost_iqd', case when i.cost_iqd is not null then i.units * i.cost_iqd end)
                    order by i.gross_iqd desc, i.product, i.unit_price_iqd) from i), '[]'::jsonb),
    'items',    jsonb_build_object(
                    'gross_iqd',            coalesce((select sum(i.gross_iqd) from i), 0)::bigint,
                    'cost_known_gross_iqd', coalesce((select sum(i.gross_iqd) from i where i.cost_iqd is not null), 0)::bigint,
                    'cost_iqd',             coalesce((select sum(i.units * i.cost_iqd) from i where i.cost_iqd is not null), 0)::bigint))
    into v_out;
  return v_out;
end $analytics_cafe_history_0412$;

comment on function app.analytics_cafe_history(date, date) is
  '0412. Owner (analytics_guard): the café''s sales from the old till (Morabaa, 2 June to 31 October 2026) inside [p_from, p_to], for the branches in report scope. {totals (app.legacy_cafe_totals: days, from, to, gross, discounts, net, orders, units, discountUnknownDays), months [{month, days, gross_iqd, discount_iqd, net_iqd, orders, units, discount_unknown_days}], groups [{key, units, gross_iqd, cost_known_gross_iqd, cost_iqd}], products [{product, unit_price_iqd, group, units, gross_iqd, unit_cost_iqd, cost_iqd}] by gross, items {gross_iqd, cost_known_gross_iqd, cost_iqd}}. Item money is before order discounts, from the items reports; product names are the till''s own and are not menu items; the grouping is ours; a cost is the owner''s stated cost per unit (null where his sheet does not name the item) and cost_iqd is that cost times the units. These days are already inside analytics_daily_sales and analytics_hourly. INVALID_RANGE, FORBIDDEN.';

revoke all on function app.analytics_cafe_history(date, date) from public, anon;
grant execute on function app.analytics_cafe_history(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The owner assistant may read all four (table_read), as 0331 seeds its two.
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       true,
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('legacy_cafe_hours', 'legacy_cafe_item_days', 'legacy_cafe_products', 'legacy_cafe_days')
on conflict (table_name, column_name) do nothing;
