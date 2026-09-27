set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0219_reports_venue_scope — multi-venue slice 3, step 5 (plan MV8).
--
-- Every report, panel and analytics read is a security-definer body, so the
-- staff read policies' venue axis (0136) never reaches it: with two branches a
-- manager's day close, stock report or staff activity would count the other
-- branch too, and the owner could not look at one branch alone.
--
-- Each body below is re-issued from its latest version with the report scope
-- added to every read of a venue-scoped table (a predicate after the WHERE that
-- follows each `from|join <table> <alias>`; joined leaf rows follow their
-- scoped root):
--   * the cafe, revenue, stock, staff, drill, overview and cafe-analytics
--     reads filter `venue_id = any(v_rv)`, v_rv := app.report_venues() (0214):
--     for the owner the branch named by the x-venue-scope request header, or
--     every branch; for anyone else only branches they work at;
--   * the courts analytics and the courts report compute opening hours and
--     occupancy for ONE branch, so they filter `venue_id = v_av`,
--     v_av := app.analysis_venue() (0214), the branch their helpers already use;
--   * the SQL helpers cafe_settled_tabs and analytics_sales_lines read the
--     scope inline (`= any((select app.report_venues())::uuid[])`, evaluated
--     once per call); reports_figures (plpgsql) uses v_rv like the reports;
--   * the stock views are filtered through their ingredient or batch;
--   * unpaid_played_bookings works on its day's branch.
-- No signature changes: the operator names the scope in a request header
-- (slice 4), exactly as it names its station (0215).

-- cafe_settled_tabs: re-issued from 20260914000095_cafe_net_lines.sql:325; report scope on 3 read(s)
create or replace function app.cafe_settled_tabs(
  p_ts_from timestamptz default null,
  p_ts_to   timestamptz default null
) returns table (
  tab_id          uuid,
  settled_at      timestamptz,
  reservation_id  uuid,
  subtotal_iqd    bigint,
  discount_iqd    bigint,
  tax_iqd         bigint,
  court_iqd       bigint,
  total_iqd       bigint,
  goods_iqd       bigint,
  cafe_gross_iqd  bigint,
  refunds_iqd     bigint,
  cafe_net_iqd    bigint
) language sql stable security definer set search_path = public as $cafe_settled_tabs_0219$
  select t.id,
         t.settled_at,
         t.reservation_id,
         coalesce(t.subtotal_iqd, 0)::bigint,
         coalesce(t.discount_iqd, 0)::bigint,
         coalesce(t.tax_iqd, 0)::bigint,
         coalesce(t.court_iqd, 0)::bigint,
         coalesce(t.total_iqd, 0)::bigint,
         (coalesce(t.subtotal_iqd, 0) - coalesce(t.discount_iqd, 0))::bigint             as goods_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0))::bigint                   as cafe_gross_iqd,
         coalesce(r.refunds_iqd, 0)::bigint                                              as refunds_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0) - coalesce(r.refunds_iqd, 0))::bigint as cafe_net_iqd
    from tabs t
    left join lateral (
      select sum(rf.amount_iqd) as refunds_iqd
        from refunds rf
        join payments p on p.id = rf.payment_id
       where p.venue_id = any((select app.report_venues())::uuid[]) and rf.venue_id = any((select app.report_venues())::uuid[]) and p.tab_id = t.id
    ) r on true
   where t.venue_id = any((select app.report_venues())::uuid[]) and t.status = 'settled'
     and t.merged_into_tab_id is null
     and t.settled_at is not null
     and (p_ts_from is null or t.settled_at >= p_ts_from)
     and (p_ts_to   is null or t.settled_at <  p_ts_to)
$cafe_settled_tabs_0219$;

-- analytics_sales_lines: re-issued from 20260914000095_cafe_net_lines.sql:540; report scope on 5 read(s)
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
  settled_at        timestamptz,
  order_item_id     uuid,
  menu_item_id      uuid,
  variant_id        uuid,
  qty               int,
  net_qty           int,
  list_price_iqd    bigint,
  unit_price_iqd    bigint,
  line_total_iqd    bigint,
  list_line_iqd     bigint,
  discount_line_iqd bigint,
  discount_source   text,
  line_adj_iqd      bigint,
  tab_adj_iqd       bigint,
  refund_qty        int,
  refund_iqd        bigint,
  net_line_iqd      bigint,
  cost_iqd          bigint,
  cost_total_iqd    bigint
) language sql stable security definer set search_path = public as $analytics_sales_lines_0219$
  with
  picked_tabs as (
    select t.id as tab_id, t.settled_at
      from tabs t
     where t.venue_id = any((select app.report_venues())::uuid[]) and p_basis = 'settled'
       and t.status = 'settled'
       and t.merged_into_tab_id is null
       and t.settled_at >= p_ts_from and t.settled_at < p_ts_to
    union
    select o.tab_id, t.settled_at
      from orders o
      join tabs t on t.id = o.tab_id
     where t.venue_id = any((select app.report_venues())::uuid[]) and o.venue_id = any((select app.report_venues())::uuid[]) and p_basis in ('served', 'all')
       and o.placed_at >= p_ts_from and o.placed_at < p_ts_to
       and o.status <> 'voided'
       and case p_basis
             when 'served' then (o.status = 'served' or t.status = 'settled')
             else true
           end),
  nl as (
    select * from app.cafe_net_lines((select coalesce(array_agg(pt.tab_id), '{}'::uuid[]) from picked_tabs pt)))
  select case when p_basis = 'settled'
              then app.business_date(pt.settled_at, p_tz, p_start_hour)
              else app.business_date(o.placed_at, p_tz, p_start_hour) end,
         o.id, o.tab_id, o.guest_session_id, o.source, o.placed_at, pt.settled_at,
         oi.id, oi.menu_item_id, oi.variant_id, oi.qty,
         (oi.qty - nl.refund_qty)::int,
         coalesce(oi.list_price_iqd, oi.unit_price_iqd)::bigint,
         oi.unit_price_iqd::bigint,
         oi.line_total_iqd::bigint,
         (oi.line_total_iqd + g.promo_gap)::bigint,
         g.promo_gap::bigint,
         oi.discount_source,
         nl.line_discount_iqd,
         nl.tab_discount_iqd,
         nl.refund_qty,
         nl.refund_iqd,
         nl.net_iqd,
         nl.cost_iqd,
         nl.cost_total_iqd
    from picked_tabs pt
    join orders o       on o.tab_id = pt.tab_id
    join order_items oi on oi.order_id = o.id
    join nl             on nl.order_item_id = oi.id
    cross join lateral (
      select case
               when oi.discount_pct > 0 and oi.list_price_iqd is not null
               then (oi.list_price_iqd
                     - (oi.list_price_iqd * (100 - oi.discount_pct) + 50) / 100) * oi.qty
               else 0
             end as promo_gap
    ) g
   where o.venue_id = any((select app.report_venues())::uuid[]) and o.status <> 'voided'
     and not oi.voided
     -- On the event bases only the orders in the window count; on the settle
     -- basis every line of the settled tab belongs to its settle day.
     and (p_basis = 'settled'
          or (o.placed_at >= p_ts_from and o.placed_at < p_ts_to
              and case p_basis
                    when 'served' then (o.status = 'served' or exists (select 1 from tabs t where t.venue_id = any((select app.report_venues())::uuid[]) and t.id = o.tab_id and t.status = 'settled'))
                    when 'all'    then true
                    else false
                  end))
$analytics_sales_lines_0219$;

-- reports_figures: re-issued from 20260915000099_revenue_net_and_cafe_waste.sql:31; report scope on 6 read(s)
create or replace function app.reports_figures(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $reports_figures_0219$
declare
  v_rv uuid[] := app.report_venues();
  v_b   record;
  v_out jsonb;
begin
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  res as (
    select count(*) filter (where r.status in ('confirmed','arrived','completed'))                    as bookings,
           coalesce(sum(r.price_iqd) filter (where r.status in ('confirmed','arrived','completed')), 0)::bigint as padel_iqd,
           count(*) filter (where r.status = 'no_show')                                               as no_shows
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to),
  cafe as (
    select coalesce(sum(s.cafe_gross_iqd), 0)::bigint as cafe_iqd,
           coalesce(sum(s.cafe_net_iqd), 0)::bigint   as cafe_net_iqd,
           coalesce(sum(s.discount_iqd), 0)::bigint   as discounts_iqd,
           coalesce(sum(s.refunds_iqd), 0)::bigint    as refunds_iqd
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s),
  ord as (
    select count(*) as orders
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'),
  pay as (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to),
  ref as (
    select coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to),
  waste as (
    select coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost_iqd
      from stock_movements sm
     where sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to)
  select jsonb_build_object(
           'revenue',       res.padel_iqd + cafe.cafe_net_iqd,
           'padelRevenue',  res.padel_iqd,
           'cafeRevenue',   cafe.cafe_iqd,
           'cafeNet',       cafe.cafe_net_iqd,
           'cash',          pay.cash_iqd - ref.cash_iqd,
           'card',          pay.card_iqd - ref.card_iqd,
           'bookings',      res.bookings,
           'orders',        ord.orders,
           'avgOrderValue', case when ord.orders > 0
                                 then round(cafe.cafe_iqd::numeric / ord.orders)::bigint
                                 else 0 end,
           'discounts',     cafe.discounts_iqd,
           'refunds',       cafe.refunds_iqd,
           'waste',         waste.cost_iqd,
           'noShows',       res.no_shows)
    into v_out
    from res, cafe, ord, pay, ref, waste;

  return v_out;
end $reports_figures_0219$;

-- report_cafe: re-issued from 20260914000096_reports_shared_cafe.sql:355; report scope on 5 read(s)
create or replace function app.report_cafe(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_cafe_0219$
declare
  v_rv uuid[] := app.report_venues();
  v_b        record;
  v_cat      uuid;
  v_rows     jsonb;
  v_summary  jsonb;
  v_by_cat   jsonb;
  v_waste    jsonb;
  v_prep     jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'categoryId' and jsonb_typeof(p_filters -> 'categoryId') <> 'null' then
    begin
      v_cat := (p_filters ->> 'categoryId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'categoryId';
    end;
  end if;

  with
  l as (
    select l.order_id, l.menu_item_id, l.variant_id, l.net_qty as qty, l.net_line_iqd, l.cost_total_iqd,
           mi.category_id
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join menu_items mi on mi.id = l.menu_item_id
     where mi.venue_id = any(v_rv) and v_cat is null or mi.category_id = v_cat),
  per_item as (
    select l.menu_item_id, l.category_id,
           sum(l.qty)::bigint                                   as qty,
           sum(l.net_line_iqd)::bigint                          as revenue_iqd,
           case when bool_and(l.cost_total_iqd is not null)
                then sum(l.cost_total_iqd)::bigint end          as cogs_iqd,
           count(distinct l.order_id)                           as orders
      from l
     group by l.menu_item_id, l.category_id),
  per_cat as (
    select pi.category_id,
           sum(pi.qty)::bigint                                    as qty,
           sum(pi.revenue_iqd)::bigint                            as revenue_iqd,
           case when bool_or(pi.cogs_iqd is not null)
                then sum(pi.cogs_iqd)::bigint end                 as cogs_iqd,
           count(*)                                               as items
      from per_item pi
     group by pi.category_id),
  tot as (
    select coalesce(sum(pi.qty), 0)::bigint                                          as qty,
           coalesce(sum(pi.revenue_iqd), 0)::bigint                                  as revenue_iqd,
           coalesce(sum(pi.cogs_iqd), 0)::bigint                                     as cogs_iqd,
           coalesce(sum(pi.revenue_iqd) filter (where pi.cogs_iqd is not null), 0)::bigint as revenue_with_cogs_iqd,
           count(*)::int                                                              as items_total,
           count(pi.cogs_iqd)::int                                                    as items_with_cogs
      from per_item pi),
  ord as (
    select count(*) as orders
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and (v_cat is null or exists (
             select 1 from order_items oi join menu_items mi on mi.id = oi.menu_item_id
              where mi.venue_id = any(v_rv) and oi.order_id = o.id and not oi.voided and mi.category_id = v_cat)))
  select
    coalesce((select jsonb_agg(jsonb_build_object(
               'itemId',         pi.menu_item_id,
               'nameEn',         mi.name_en,
               'nameAr',         mi.name_ar,
               'categoryId',     pi.category_id,
               'categoryNameEn', mc.name_en,
               'categoryNameAr', mc.name_ar,
               'qty',            pi.qty,
               'orders',         pi.orders,
               'revenueIqd',     pi.revenue_iqd,
               'cogsIqd',        pi.cogs_iqd,
               'grossProfitIqd', case when pi.cogs_iqd is not null then pi.revenue_iqd - pi.cogs_iqd end,
               'marginPct',      case when pi.cogs_iqd is not null and pi.revenue_iqd > 0
                                      then round((pi.revenue_iqd - pi.cogs_iqd) * 100.0 / pi.revenue_iqd, 1) end
             ) order by pi.revenue_iqd desc, pi.qty desc, mi.name_en, pi.menu_item_id)
        from per_item pi
        join menu_items mi      on mi.id = pi.menu_item_id
        join menu_categories mc on mc.id = pi.category_id), '[]'::jsonb),
    (select jsonb_build_object(
               'orders',            ord.orders,
               'qty',               tot.qty,
               'avgOrderValueIqd',  case when ord.orders > 0 then round(tot.revenue_iqd::numeric / ord.orders)::bigint else 0 end,
               'revenueIqd',        tot.revenue_iqd,
               'cogsIqd',           tot.cogs_iqd,
               'grossProfitIqd',    tot.revenue_with_cogs_iqd - tot.cogs_iqd,
               'marginPct',         case when tot.revenue_with_cogs_iqd > 0
                                         then round((tot.revenue_with_cogs_iqd - tot.cogs_iqd) * 100.0 / tot.revenue_with_cogs_iqd, 1) end,
               'cogsCoveragePct',   case when tot.revenue_iqd > 0
                                         then round(tot.revenue_with_cogs_iqd * 100.0 / tot.revenue_iqd, 1) else 0 end,
               'itemsWithCogs',     tot.items_with_cogs,
               'itemsTotal',        tot.items_total)
        from tot, ord),
    coalesce((select jsonb_agg(jsonb_build_object(
               'categoryId',     pc.category_id,
               'categoryNameEn', mc.name_en,
               'categoryNameAr', mc.name_ar,
               'items',          pc.items,
               'qty',            pc.qty,
               'revenueIqd',     pc.revenue_iqd,
               'cogsIqd',        pc.cogs_iqd,
               'grossProfitIqd', case when pc.cogs_iqd is not null then pc.revenue_iqd - pc.cogs_iqd end,
               'marginPct',      case when pc.cogs_iqd is not null and pc.revenue_iqd > 0
                                      then round((pc.revenue_iqd - pc.cogs_iqd) * 100.0 / pc.revenue_iqd, 1) end
             ) order by pc.revenue_iqd desc, mc.sort_order, mc.name_en)
        from per_cat pc
        join menu_categories mc on mc.id = pc.category_id), '[]'::jsonb)
    into v_rows, v_summary, v_by_cat;

  select coalesce(jsonb_agg(jsonb_build_object(
           'reason',  x.reason,
           'count',   x.n,
           'qty',     x.qty,
           'costIqd', x.cost
         ) order by x.cost desc, x.reason), '[]'::jsonb)
    into v_waste
    from (
      select coalesce(sm.reason_code, sm.movement_type::text)                  as reason,
             count(*)                                                          as n,
             sum(-sm.qty_delta)                                                as qty,
             coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost
        from stock_movements sm
       where sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
         and sm.qty_delta < 0
         and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
       group by 1) x;

  select jsonb_build_object(
           'avgSeconds', round(avg(t.actual_prep_seconds))::int,
           'p90Seconds', round(percentile_cont(0.9) within group (order by t.actual_prep_seconds))::int,
           'count',      count(*))
    into v_prep
    from tickets t
   where t.venue_id = any(v_rv) and t.actual_prep_seconds is not null
     and coalesce(t.ready_at, t.completed_at) >= v_b.ts_from
     and coalesce(t.ready_at, t.completed_at) <  v_b.ts_to;

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','nameEn',         'labelEn','Item',         'labelAr','الصنف',        'kind','text'),
      jsonb_build_object('key','categoryNameEn', 'labelEn','Category',     'labelAr','التصنيف',      'kind','text'),
      jsonb_build_object('key','qty',            'labelEn','Qty',          'labelAr','الكمية',       'kind','count'),
      jsonb_build_object('key','revenueIqd',     'labelEn','Revenue',      'labelAr','الإيراد',      'kind','money'),
      jsonb_build_object('key','cogsIqd',        'labelEn','Cost of goods','labelAr','تكلفة البضاعة','kind','money'),
      jsonb_build_object('key','grossProfitIqd', 'labelEn','Gross profit', 'labelAr','الربح الإجمالي','kind','money'),
      jsonb_build_object('key','marginPct',      'labelEn','Margin',       'labelAr','الهامش',       'kind','pct')),
    'rows',          v_rows,
    'totals',        v_summary,
    'summary',       v_summary,
    'byCategory',    v_by_cat,
    'wasteByReason', v_waste,
    'prepTimes',     v_prep,
    'comparison',    null);
end $report_cafe_0219$;

-- report_drill: re-issued from 20260917000102_report_drill_words.sql:20; report scope on 18 read(s)
create or replace function app.report_drill(
  p_figure text,
  p_key    text,
  p_from   date,
  p_to     date
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_drill_0219$
declare
  v_rv uuid[] := app.report_venues();
  v_b        record;
  v_tag      text;
  v_scope    record;
  v_key      record;
  v_court    uuid;
  v_item     uuid;
  v_staff    uuid;
  v_out      jsonb;
  v_figures  text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','discounts',
                             'refunds','voids','waste','noShows','bookings','orders','cancellations'];
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  if p_figure is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_figure';
  end if;
  select * into v_scope from app.reports_parse_scope(p_figure);
  if v_scope.kind is null then
    if not (p_figure = any (v_figures)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'p_figure', hint = 'a figure key or court:<uuid> | item:<uuid> | staff:<uuid>';
    end if;
    v_tag := p_figure;
  end if;
  select * into v_key from app.reports_parse_scope(p_key);
  if p_key is not null and v_key.kind is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_key', hint = 'court:<uuid> | item:<uuid> | staff:<uuid> or null';
  end if;

  -- Financial figures are the owner's alone (spec R-roles, build plan §4).
  if v_tag in ('revenue','padelRevenue','cafeRevenue','cafeNet','cash','card') then
    perform app.reports_guard(true);
  end if;

  v_court := case when v_scope.kind = 'court' then v_scope.id when v_key.kind = 'court' then v_key.id end;
  v_item  := case when v_scope.kind = 'item'  then v_scope.id when v_key.kind = 'item'  then v_key.id end;
  v_staff := case when v_scope.kind = 'staff' then v_scope.id when v_key.kind = 'staff' then v_key.id end;

  with
  tx as (
    -- Bookings on their slot's day (every status the reports count).
    select r.id::text                                                  as id,
           r.start_at                                                  as at,
           'reservation'                                               as kind,
           c.name_en || ' · ' || coalesce(r.guest_name, pr.full_name, '') as label,
           coalesce(r.price_iqd, 0)::bigint                            as amount,
           r.created_by_staff_id                                       as staff_id,
           r.id::text                                                  as reference,
           r.court_id                                                  as court_id,
           null::uuid                                                  as item_id,
           jsonb_build_object('sub', 'booking', 'status', r.status,
                              'courtEn', c.name_en, 'courtAr', c.name_ar,
                              'guest', coalesce(r.guest_name, pr.full_name)) as detail,
           case
             when r.status in ('confirmed','arrived','completed') then array['bookings','revenue','padelRevenue']
             when r.status = 'no_show'   then array['noShows']
             when r.status = 'cancelled' then array['cancellations']
             else array[]::text[]
           end                                                         as tags
      from reservations r
      join courts c on c.id = r.court_id
      left join profiles pr on pr.id = r.guest_id
     where c.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
    union all
    -- Settled tabs from the shared helper: the cafe part, gross of refunds.
    -- 0099: only the cafeRevenue figure lists these; revenue lists the net twin.
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_gross_iqd,
           coalesce((select p.recorded_by from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'settledTab', 'tabLabel', t.label, 'table', ct.table_number),
           array['cafeRevenue']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- The same tabs, net of their refunds: the cafeNet figure and, since 0099,
    -- the cafe part of revenue (so the drill rows add up to the headline).
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_net_iqd,
           coalesce((select p.recorded_by from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'settledTab', 'tabLabel', t.label, 'table', ct.table_number),
           array['revenue','cafeNet']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- Payments by method.
    select p.id::text, p.created_at, 'payment',
           p.method::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           p.amount_iqd::bigint, p.recorded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'payment', 'method', p.method, 'tabLabel', t.label, 'table', ct.table_number),
           array[p.method::text]
      from payments p
      join tabs t on t.id = p.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where ct.venue_id = any(v_rv) and t.venue_id = any(v_rv) and p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
    union all
    -- Refunds (money out; also net off cash/card).
    select r.id::text, r.created_at, 'refund',
           'refund · ' || r.reason_code || ' · ' || p.method::text,
           r.amount_iqd::bigint, r.refunded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', r.reason_code, 'method', p.method),
           array['refunds', p.method::text]
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union all
    -- Discounts / price overrides.
    select a.id::text, a.created_at, 'adjustment',
           a.kind::text || ' · ' || a.reason_code,
           a.amount_iqd::bigint, a.applied_by, a.tab_id::text, null::uuid,
           (select oi.menu_item_id from order_items oi where oi.id = a.order_item_id),
           jsonb_build_object('sub', 'discount', 'adjKind', a.kind, 'reason', a.reason_code),
           array['discounts']
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
    union all
    -- Voids, from the audit trail (the only timestamped record of a void).
    select l.id::text, l.at, 'adjustment',
           'void · ' || coalesce(l.reason_code, '') || ' · ' || coalesce(mi.name_en, ''),
           coalesce((l.after ->> 'line_total_iqd')::bigint, 0), l.actor_id, l.entity_id,
           null::uuid, mi.id,
           jsonb_build_object('sub', 'void', 'reason', l.reason_code, 'itemEn', mi.name_en, 'itemAr', mi.name_ar),
           array['voids']
      from audit_log l
      left join menu_items mi on mi.id::text = (l.after ->> 'menu_item_id')
     where mi.venue_id = any(v_rv) and l.venue_id = any(v_rv) and l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
    union all
    -- Waste movements.
    select sm.id::text, sm.at, 'waste',
           i.name_en || ' · ' || coalesce(sm.reason_code, sm.movement_type::text)
             || ' · ' || (-sm.qty_delta)::text || ' ' || i.unit::text,
           coalesce(round(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0)), 0)::bigint,
           sm.staff_id, sm.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'waste', 'movement', sm.movement_type, 'reason', sm.reason_code,
                              'ingredientEn', i.name_en, 'ingredientAr', i.name_ar,
                              'qty', -sm.qty_delta, 'unit', i.unit),
           array['waste']
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where i.venue_id = any(v_rv) and sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
    union all
    -- Orders (non-voided), amount = live line total.
    select o.id::text, o.placed_at, 'tab',
           'order · ' || o.source::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           coalesce((select sum(oi.line_total_iqd) from order_items oi
                      where oi.order_id = o.id and not oi.voided), 0)::bigint,
           o.placed_by_staff_id, o.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'order', 'source', o.source, 'tabLabel', t.label, 'table', ct.table_number),
           array['orders']
      from orders o
      join tabs t on t.id = o.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where ct.venue_id = any(v_rv) and t.venue_id = any(v_rv) and o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
    union all
    -- Settled lines, for the item scope only (net of discounts and refunds).
    select l.order_item_id::text, l.placed_at, 'tab',
           mi.name_en || ' × ' || l.qty::text,
           l.net_line_iqd, o.placed_by_staff_id, l.tab_id::text, null::uuid, l.menu_item_id,
           jsonb_build_object('sub', 'line', 'itemEn', mi.name_en, 'itemAr', mi.name_ar, 'qty', l.qty),
           array['lines']
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join orders o on o.id = l.order_id
      join menu_items mi on mi.id = l.menu_item_id
     where mi.venue_id = any(v_rv) and o.venue_id = any(v_rv) and v_item is not null),
  picked as (
    select tx.*
      from tx
     where (v_tag is null or v_tag = any (tx.tags))
       and (v_court is null or tx.court_id = v_court)
       and (v_staff is null or tx.staff_id = v_staff)
       and (v_item  is null or tx.item_id  = v_item)
       -- Scope-only drills: a court shows its bookings, an item its lines
       -- (plus voids of it), a member their actions (not the duplicate lines,
       -- and not the net twin of a tab row).
       and (v_tag is not null
            or (v_scope.kind = 'court' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags))
            or (v_scope.kind = 'item'  and ('lines' = any (tx.tags) or 'voids' = any (tx.tags)))
            or (v_scope.kind = 'staff' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags)))
       and (v_tag is null or 'lines' <> all (tx.tags))
     order by tx.at desc, tx.id desc
     limit 500)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        p.id,
           'at',        p.at,
           'kind',      p.kind,
           'label',     p.label,
           'amountIqd', p.amount,
           'staffId',   p.staff_id,
           'staffName', s.display_name,
           'reference', p.reference,
           'detail',    p.detail
         ) order by p.at desc, p.id desc), '[]'::jsonb)
    into v_out
    from picked p
    left join staff s on s.id = p.staff_id;

  return jsonb_build_object(
    'figure',       p_figure,
    'key',          p_key,
    'period',       jsonb_build_object('from', p_from, 'to', p_to),
    'transactions', v_out);
end $report_drill_0219$;

-- report_revenue: re-issued from 20260922000146_shop_sale_path.sql:410; report scope on 10 read(s)
create or replace function app.report_revenue(
  p_from    date,
  p_to      date,
  p_group   text default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_revenue_0219$
declare
  v_rv uuid[] := app.report_venues();
  v_b      record;
  v_method payment_method;
  v_staff  uuid;
  v_rows   jsonb;
  v_totals jsonb;
begin
  perform app.reports_guard(true);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_group is null or p_group not in ('day','week','month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_group', hint = 'p_group must be ''day'', ''week'' or ''month''';
  end if;
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'paymentMethod' and jsonb_typeof(p_filters -> 'paymentMethod') <> 'null' then
    if (p_filters ->> 'paymentMethod') not in ('cash','card') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'paymentMethod', hint = 'paymentMethod must be ''cash'' or ''card''';
    end if;
    v_method := (p_filters ->> 'paymentMethod')::payment_method;
  end if;
  if p_filters ? 'staffId' and jsonb_typeof(p_filters -> 'staffId') <> 'null' then
    begin
      v_staff := (p_filters ->> 'staffId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'staffId';
    end;
  end if;

  with
  res as (
    select app.reports_bucket(app.business_date(r.start_at, v_b.tz, v_b.start_hour), p_group) as b,
           count(*)                            as bookings,
           coalesce(sum(r.price_iqd), 0)::bigint as padel_iqd
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_staff is null or r.created_by_staff_id = v_staff)
     group by 1),
  cafe as (
    select app.reports_bucket(app.business_date(s.settled_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(s.cafe_gross_iqd), 0)::bigint as cafe_iqd,
           coalesce(sum(s.cafe_net_iqd), 0)::bigint   as cafe_net_iqd,
           coalesce(sum(s.tax_iqd), 0)::bigint        as tax_iqd,
           coalesce(sum(s.discount_iqd), 0)::bigint   as discounts_iqd
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
     where (v_method is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.recorded_by = v_staff))
     group by 1),
  -- 0146: the Touch Shop share of the settled tabs, net of line and tab
  -- discounts and of refunds, before tax (cafe_net_lines, 0095). A breakdown
  -- of the café money, not an addition to it: total_iqd is unchanged.
  st as (
    select s.tab_id, s.settled_at
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
     where (v_method is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.recorded_by = v_staff))),
  shop as (
    select app.reports_bucket(app.business_date(st.settled_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(nl.net_iqd), 0)::bigint as shop_iqd
      from app.cafe_net_lines(array(select st2.tab_id from st st2)) nl
      join st on st.tab_id = nl.tab_id
      join menu_items mi on mi.id = nl.menu_item_id
      join menu_categories c on c.id = mi.category_id and c.kind = 'shop'
     group by 1),
  ord as (
    select app.reports_bucket(app.business_date(o.placed_at, v_b.tz, v_b.start_hour), p_group) as b,
           count(*) as orders
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and (v_staff is null or o.placed_by_staff_id = v_staff)
     group by 1),
  pay as (
    select app.reports_bucket(app.business_date(p.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or p.recorded_by = v_staff)
     group by 1),
  ref as (
    select app.reports_bucket(app.business_date(r.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(r.amount_iqd), 0)::bigint                                   as refunds_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or r.refunded_by = v_staff)
     group by 1),
  -- Staff-attributed discounts: the adjustment rows that member applied, by
  -- the day they applied them. A stamped tab discount has no single author,
  -- so this variant is the UNCAPPED sum of the rows (0068 behaviour).
  adj as (
    select app.reports_bucket(app.business_date(a.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(a.amount_iqd), 0)::bigint as discounts_iqd
      from tab_adjustments a
     where v_staff is not null
       and a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
       and a.applied_by = v_staff
     group by 1),
  vd as (
    select app.reports_bucket(app.business_date(l.at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum((l.after ->> 'line_total_iqd')::bigint), 0)::bigint as voids_iqd
      from audit_log l
     where l.venue_id = any(v_rv) and l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
       and (v_staff is null or l.actor_id = v_staff)
     group by 1),
  buckets as (
    select b from res union select b from cafe union select b from shop union select b from ord union select b from pay
    union select b from ref union select b from adj union select b from vd),
  rows_ as (
    select buckets.b                                                          as period,
           coalesce(res.padel_iqd, 0)                                         as padel_iqd,
           coalesce(cafe.cafe_iqd, 0)                                         as cafe_iqd,
           coalesce(cafe.cafe_net_iqd, 0)                                     as cafe_net_iqd,
           coalesce(shop.shop_iqd, 0)                                         as shop_iqd,
           coalesce(res.padel_iqd, 0) + coalesce(cafe.cafe_net_iqd, 0)        as total_iqd,
           coalesce(pay.cash_iqd, 0) - coalesce(ref.cash_iqd, 0)              as cash_iqd,
           coalesce(pay.card_iqd, 0) - coalesce(ref.card_iqd, 0)              as card_iqd,
           case when v_staff is null then coalesce(cafe.discounts_iqd, 0)
                else coalesce(adj.discounts_iqd, 0) end                       as discounts_iqd,
           coalesce(vd.voids_iqd, 0)                                          as voids_iqd,
           coalesce(ref.refunds_iqd, 0)                                       as refunds_iqd,
           coalesce(cafe.tax_iqd, 0)                                          as tax_iqd,
           coalesce(ord.orders, 0)                                            as orders,
           coalesce(res.bookings, 0)                                          as bookings
      from buckets
      left join res  on res.b  = buckets.b
      left join cafe on cafe.b = buckets.b
      left join shop on shop.b = buckets.b
      left join ord  on ord.b  = buckets.b
      left join pay  on pay.b  = buckets.b
      left join ref  on ref.b  = buckets.b
      left join adj  on adj.b  = buckets.b
      left join vd   on vd.b   = buckets.b)
  select coalesce(jsonb_agg(jsonb_build_object(
           'period',       r.period,
           'padelIqd',     r.padel_iqd,
           'cafeIqd',      r.cafe_iqd,
           'cafeNetIqd',   r.cafe_net_iqd,
           'shopIqd',      r.shop_iqd,
           'totalIqd',     r.total_iqd,
           'cashIqd',      r.cash_iqd,
           'cardIqd',      r.card_iqd,
           'discountsIqd', r.discounts_iqd,
           'voidsIqd',     r.voids_iqd,
           'refundsIqd',   r.refunds_iqd,
           'taxIqd',       r.tax_iqd,
           'orders',       r.orders,
           'bookings',     r.bookings
         ) order by r.period), '[]'::jsonb),
         jsonb_build_object(
           'padelIqd',     coalesce(sum(r.padel_iqd), 0)::bigint,
           'cafeIqd',      coalesce(sum(r.cafe_iqd), 0)::bigint,
           'cafeNetIqd',   coalesce(sum(r.cafe_net_iqd), 0)::bigint,
           'shopIqd',      coalesce(sum(r.shop_iqd), 0)::bigint,
           'totalIqd',     coalesce(sum(r.total_iqd), 0)::bigint,
           'cashIqd',      coalesce(sum(r.cash_iqd), 0)::bigint,
           'cardIqd',      coalesce(sum(r.card_iqd), 0)::bigint,
           'discountsIqd', coalesce(sum(r.discounts_iqd), 0)::bigint,
           'voidsIqd',     coalesce(sum(r.voids_iqd), 0)::bigint,
           'refundsIqd',   coalesce(sum(r.refunds_iqd), 0)::bigint,
           'taxIqd',       coalesce(sum(r.tax_iqd), 0)::bigint,
           'orders',       coalesce(sum(r.orders), 0)::bigint,
           'bookings',     coalesce(sum(r.bookings), 0)::bigint)
    into v_rows, v_totals
    from rows_ r;

  return jsonb_build_object(
    'group',   p_group,
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','period',       'labelEn','Period',     'labelAr','الفترة',           'kind','date'),
      jsonb_build_object('key','padelIqd',     'labelEn','Padel',      'labelAr','البادل',           'kind','money'),
      jsonb_build_object('key','cafeIqd',      'labelEn','Cafe',       'labelAr','الكافيه',          'kind','money'),
      jsonb_build_object('key','cafeNetIqd',   'labelEn','Cafe net',   'labelAr','صافي الكافيه',     'kind','money'),
      jsonb_build_object('key','shopIqd',      'labelEn','Of which shop', 'labelAr','منها المتجر',   'kind','money'),
      jsonb_build_object('key','totalIqd',     'labelEn','Total',      'labelAr','الإجمالي',         'kind','money'),
      jsonb_build_object('key','cashIqd',      'labelEn','Cash',       'labelAr','نقد',              'kind','money'),
      jsonb_build_object('key','cardIqd',      'labelEn','Card',       'labelAr','بطاقة',            'kind','money'),
      jsonb_build_object('key','discountsIqd', 'labelEn','Discounts',  'labelAr','الخصومات',         'kind','money'),
      jsonb_build_object('key','voidsIqd',     'labelEn','Voids',      'labelAr','الإلغاءات',        'kind','money'),
      jsonb_build_object('key','refundsIqd',   'labelEn','Refunds',    'labelAr','المبالغ المستردة', 'kind','money'),
      jsonb_build_object('key','taxIqd',       'labelEn','Tax',        'labelAr','الضريبة',          'kind','money'),
      jsonb_build_object('key','orders',       'labelEn','Orders',     'labelAr','الطلبات',          'kind','count'),
      jsonb_build_object('key','bookings',     'labelEn','Bookings',   'labelAr','الحجوزات',         'kind','count')),
    'rows',       v_rows,
    'totals',     v_totals,
    'comparison', null);
end $report_revenue_0219$;

-- report_staff_activity: re-issued from 20260903000068_reports.sql:1124; report scope on 13 read(s)
create or replace function app.report_staff_activity(
  p_from     date,
  p_to       date,
  p_staff_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_staff_activity_0219$
declare
  v_rv uuid[] := app.report_venues();
  v_b    record;
  v_rows jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  ord as (
    select o.placed_by_staff_id as staff_id,
           app.business_date(o.placed_at, v_b.tz, v_b.start_hour) as d,
           count(*) as n
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided' and o.placed_by_staff_id is not null
     group by 1, 2),
  ord_s as (
    select staff_id, sum(n)::bigint as n, max(n)::bigint as busiest from ord group by staff_id),
  bk as (
    select r.created_by_staff_id as staff_id, count(*) as n
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking' and r.created_by_staff_id is not null
       and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  pay as (
    select p.recorded_by as staff_id, count(*) as n
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
     group by 1),
  disc as (
    select a.applied_by as staff_id, count(*) as n, coalesce(sum(a.amount_iqd), 0)::bigint as amt
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
     group by 1),
  vd as (
    select l.actor_id as staff_id, count(*) as n,
           coalesce(sum((l.after ->> 'line_total_iqd')::bigint), 0)::bigint as amt
      from audit_log l
     where l.venue_id = any(v_rv) and l.action = 'order_item.void' and l.actor_id is not null
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
     group by 1),
  ref as (
    select r.refunded_by as staff_id, count(*) as n, coalesce(sum(r.amount_iqd), 0)::bigint as amt
      from refunds r
     where r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  wc as (
    select w.acknowledged_by as staff_id, count(*) as n,
           round(avg(extract(epoch from (w.acknowledged_at - w.raised_at))))::int as avg_s
      from waiter_calls w
     where w.venue_id = any(v_rv) and w.acknowledged_by is not null and w.acknowledged_at is not null
       and w.acknowledged_at >= v_b.ts_from and w.acknowledged_at < v_b.ts_to
     group by 1),
  dc as (
    select d.closed_by as staff_id,
           jsonb_agg(jsonb_build_object('businessDate', d.business_date,
                                        'cashVarianceIqd', d.cash_variance_iqd::bigint)
                     order by d.business_date) as closes
      from day_sessions d
     where d.venue_id = any(v_rv) and d.closed_by is not null and d.closed_at is not null
       and d.closed_at >= v_b.ts_from and d.closed_at < v_b.ts_to
     group by 1),
  acts as (
    select staff_id, d from ord
    union select r.created_by_staff_id, app.business_date(r.created_at, v_b.tz, v_b.start_hour)
            from reservations r
           where r.venue_id = any(v_rv) and r.kind = 'booking' and r.created_by_staff_id is not null
             and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union select p.recorded_by, app.business_date(p.created_at, v_b.tz, v_b.start_hour)
            from payments p where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
    union select a.applied_by, app.business_date(a.created_at, v_b.tz, v_b.start_hour)
            from tab_adjustments a where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
    union select l.actor_id, app.business_date(l.at, v_b.tz, v_b.start_hour)
            from audit_log l where l.venue_id = any(v_rv) and l.action = 'order_item.void' and l.actor_id is not null
             and l.at >= v_b.ts_from and l.at < v_b.ts_to
    union select r.refunded_by, app.business_date(r.created_at, v_b.tz, v_b.start_hour)
            from refunds r where r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union select w.acknowledged_by, app.business_date(w.acknowledged_at, v_b.tz, v_b.start_hour)
            from waiter_calls w where w.venue_id = any(v_rv) and w.acknowledged_by is not null and w.acknowledged_at is not null
             and w.acknowledged_at >= v_b.ts_from and w.acknowledged_at < v_b.ts_to
    union select d.closed_by, d.business_date
            from day_sessions d where d.venue_id = any(v_rv) and d.closed_by is not null and d.closed_at is not null
             and d.closed_at >= v_b.ts_from and d.closed_at < v_b.ts_to),
  days as (
    select staff_id, count(distinct d) as n from acts group by staff_id),
  members as (
    select s.id, s.display_name, s.role, s.is_active
      from staff s
     where (p_staff_id is null or s.id = p_staff_id)
       and (s.is_active or exists (select 1 from acts where acts.staff_id = s.id)))
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId',         m.id,
           'name',            m.display_name,
           'role',            m.role,
           'isActive',        m.is_active,
           'ordersTaken',     coalesce(ord_s.n, 0),
           'bookingsCreated', coalesce(bk.n, 0),
           'paymentsTaken',   coalesce(pay.n, 0),
           'discounts',       jsonb_build_object('count', coalesce(disc.n, 0), 'amountIqd', coalesce(disc.amt, 0)),
           'voids',           jsonb_build_object('count', coalesce(vd.n, 0),   'amountIqd', coalesce(vd.amt, 0)),
           'refunds',         jsonb_build_object('count', coalesce(ref.n, 0),  'amountIqd', coalesce(ref.amt, 0)),
           'waiterCallResponse', jsonb_build_object('count', coalesce(wc.n, 0), 'avgSeconds', wc.avg_s),
           'dayCloses',       coalesce(dc.closes, '[]'::jsonb),
           'shiftContext',    jsonb_build_object('daysWorked', coalesce(days.n, 0),
                                                 'busiestDayOrders', coalesce(ord_s.busiest, 0))
         ) order by m.display_name, m.id), '[]'::jsonb)
    into v_rows
    from members m
    left join ord_s on ord_s.staff_id = m.id
    left join bk    on bk.staff_id    = m.id
    left join pay   on pay.staff_id   = m.id
    left join disc  on disc.staff_id  = m.id
    left join vd    on vd.staff_id    = m.id
    left join ref   on ref.staff_id   = m.id
    left join wc    on wc.staff_id    = m.id
    left join dc    on dc.staff_id    = m.id
    left join days  on days.staff_id  = m.id;

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','name',            'labelEn','Staff member',     'labelAr','الموظف',           'kind','text'),
      jsonb_build_object('key','role',            'labelEn','Role',             'labelAr','الدور',            'kind','text'),
      jsonb_build_object('key','ordersTaken',     'labelEn','Orders taken',     'labelAr','الطلبات المسجلة', 'kind','count'),
      jsonb_build_object('key','bookingsCreated', 'labelEn','Bookings created', 'labelAr','الحجوزات المنشأة','kind','count'),
      jsonb_build_object('key','paymentsTaken',   'labelEn','Payments taken',   'labelAr','المدفوعات المستلمة','kind','count')),
    'rows',       v_rows,
    'totals',     null,
    'comparison', null);
end $report_staff_activity_0219$;

-- analytics_daily_sales: re-issued from 20260915000099_revenue_net_and_cafe_waste.sql:501; report scope on 4 read(s)
create or replace function app.analytics_daily_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_daily_sales_0219$
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
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s),
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
     group by l.business_date),
  ord as (
    select app.business_date(o.placed_at, v_b.tz, v_b.start_hour) as d,
           count(*)                                              as orders,
           count(*) filter (where o.source = 'guest_web')        as guest_orders,
           count(*) filter (where o.source = 'till')             as till_orders,
           count(distinct o.tab_id)                              as visits
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
     group by 1),
  calls as (
    select app.business_date(w.raised_at, v_b.tz, v_b.start_hour) as d,
           count(*) as waiter_calls
      from waiter_calls w
     where w.venue_id = any(v_rv) and w.raised_at >= v_b.ts_from and w.raised_at < v_b.ts_to
     group by 1),
  -- 0099: stock written off, at its movement cost, on the day it was written
  -- off. The same rows and arithmetic as the panel's waste figure
  -- (app.reports_figures), bucketed by business day.
  waste as (
    select app.business_date(sm.at, v_b.tz, v_b.start_hour) as d,
           coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as waste_iqd
      from stock_movements sm
     where sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
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
end $analytics_daily_sales_0219$;

-- report_stock: re-issued from 20260926000201_stock_counts_by_location.sql:514; report scope on 4 read(s)
create or replace function app.report_stock(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_stock_0219$
declare
  v_rv uuid[] := app.report_venues();
  v_b        record;
  v_ing      uuid;
  v_value    bigint;
  v_low      jsonb;
  v_par      jsonb;
  v_soon     jsonb;
  v_expired  jsonb;
  v_cons     jsonb;
  v_var      jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'ingredientId' and jsonb_typeof(p_filters -> 'ingredientId') <> 'null' then
    begin
      v_ing := (p_filters ->> 'ingredientId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'ingredientId';
    end;
  end if;

  select coalesce(round(sum(b.qty_remaining * b.unit_cost_iqd)), 0)::bigint
    into v_value
    from stock_batches b
   where b.venue_id = any(v_rv) and b.qty_remaining > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', v.ingredient_id,
           'nameEn',       v.name_en,
           'nameAr',       v.name_ar,
           'unit',         v.unit,
           'onHand',       v.on_hand,
           'threshold',    v.low_stock_threshold,
           'parLevel',     v.par_level
         ) order by v.name_en), '[]'::jsonb)
    into v_low
    from v_ingredient_on_hand v
   where v.ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
     and v.is_active and v.low_stock_threshold is not null and v.on_hand <= v.low_stock_threshold;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', v.ingredient_id,
           'nameEn',       v.name_en,
           'nameAr',       v.name_ar,
           'unit',         v.unit,
           'onHand',       v.on_hand,
           'parLevel',     v.par_level,
           'shortfall',    v.par_level - v.on_hand
         ) order by (v.par_level - v.on_hand) desc, v.name_en), '[]'::jsonb)
    into v_par
    from v_ingredient_on_hand v
   where v.ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
     and v.is_active and v.par_level is not null and v.on_hand < v.par_level;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysLeft',     e.days_left,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint,
           'location',     sb.location
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_soon
    from v_expiring_soon e
    left join stock_batches sb on sb.id = e.batch_id
   where sb.venue_id = any(v_rv) and e.venue_id = any(v_rv);

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysExpired',  e.days_expired,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint,
           'location',     sb.location
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_expired
    from v_expired e
    left join stock_batches sb on sb.id = e.batch_id
   where sb.venue_id = any(v_rv) and e.ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv));

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', x.ingredient_id,
           'nameEn',       i.name_en,
           'nameAr',       i.name_ar,
           'unit',         i.unit,
           'consumedQty',  x.qty,
           'costIqd',      x.cost
         ) order by x.cost desc, i.name_en), '[]'::jsonb)
    into v_cons
    from (
      select sm.ingredient_id,
             sum(-sm.qty_delta)                                                       as qty,
             coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost
        from stock_movements sm
       where sm.venue_id = any(v_rv) and sm.movement_type in ('sale_consumption','production_consume')
         and sm.qty_delta < 0
         and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
         and (v_ing is null or sm.ingredient_id = v_ing)
       group by sm.ingredient_id) x
    join ingredients i on i.id = x.ingredient_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'countId',          r.count_id,
           'periodStart',      r.period_start,
           'periodEnd',        r.period_end,
           'ingredientId',     r.ingredient_id,
           'nameEn',           r.name_en,
           'nameAr',           r.name_ar,
           'unit',             r.unit,
           'theoreticalQty',   r.theoretical_qty,
           'countedQty',       r.counted_qty,
           'varianceQty',      r.variance_qty,
           'soldQty',          r.sold_qty,
           'expectedWasteQty', r.expected_waste_qty,
           'recordedWasteQty', r.recorded_waste_qty,
           'voidQty',          r.void_qty,
           'expiredQty',       r.expired_qty,
           'productTestQty',   r.product_test_qty,
           'location',         r.location,
           'transferQty',      r.transfer_qty
         ) order by r.period_end desc, r.name_en), '[]'::jsonb)
    into v_var
    from v_variance_report r
   where r.period_end >= v_b.ts_from and r.period_end < v_b.ts_to
     and (v_ing is null or r.ingredient_id = v_ing);

  return jsonb_build_object(
    'period',        jsonb_build_object('from', p_from, 'to', p_to),
    'stockValueIqd', v_value,
    'lowStock',      v_low,
    'belowPar',      v_par,
    'expiringSoon',  v_soon,
    'expired',       v_expired,
    'consumption',   v_cons,
    'variance',      v_var,
    'comparison',    null);
end $report_stock_0219$;

-- ops_overview: re-issued from 20260903000068_reports.sql:205; report scope on 24 read(s)
create or replace function app.ops_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $ops_overview_0219$
declare
  v_rv uuid[] := app.report_venues();
  v_now      timestamptz := now();
  v_today    date;
  v_b        record;
  v_day      day_sessions%rowtype;
  v_bookings jsonb;
  v_cafe     jsonb;
  v_stock    jsonb;
  v_staff    jsonb;
  v_exc      jsonb;
  v_close    jsonb;
begin
  perform app.reports_guard(false);

  v_today := app.business_date(v_now);
  select * into strict v_b from app.analytics_bounds(v_today, v_today);

  -- Bookings ---------------------------------------------------------------
  with r as (
    select *
      from reservations
     where reservations.venue_id = any(v_rv) and kind = 'booking'
       and start_at >= v_b.ts_from and start_at < v_b.ts_to)
  select jsonb_build_object(
           'today',          (select count(*) from r where status in ('confirmed','arrived','completed')),
           'arrived',        (select count(*) from r where status = 'arrived'),
           'upcoming',       (select count(*) from r where status = 'confirmed' and start_at > v_now),
           'noShows',        (select count(*) from r where status = 'no_show'),
           'cancelledToday', (select count(*) from reservations
                               where reservations.venue_id = any(v_rv) and kind = 'booking' and status = 'cancelled'
                                 and cancelled_at >= v_b.ts_from and cancelled_at < v_b.ts_to),
           'nextArrival',    (select jsonb_build_object(
                                       'reservationId', r.id,
                                       'startAt',       r.start_at,
                                       'courtNameEn',   c.name_en,
                                       'courtNameAr',   c.name_ar,
                                       'guestName',     coalesce(r.guest_name, pr.full_name))
                                from r
                                join courts c on c.id = r.court_id
                                left join profiles pr on pr.id = r.guest_id
                               where c.venue_id = any(v_rv) and r.status = 'confirmed' and r.end_at > v_now
                               order by r.start_at, r.id
                               limit 1))
    into v_bookings;

  -- Cafe -------------------------------------------------------------------
  select jsonb_build_object(
           'openTabs',         (select count(*) from tabs where tabs.venue_id = any(v_rv) and status in ('open','awaiting_payment')),
           'ticketsQueued',    (select count(*) from tickets where tickets.venue_id = any(v_rv) and status = 'queued'),
           'ticketsPreparing', (select count(*) from tickets where tickets.venue_id = any(v_rv) and status = 'preparing'),
           'ticketsLate',      (select count(*) from tickets
                                 where tickets.venue_id = any(v_rv) and status in ('queued','preparing')
                                   and v_now - created_at > make_interval(secs => target_seconds)),
           'waiterCallsOpen',  (select count(*) from waiter_calls where waiter_calls.venue_id = any(v_rv) and status in ('raised','acknowledged')),
           'ordersToday',      (select count(*) from orders
                                 where orders.venue_id = any(v_rv) and placed_at >= v_b.ts_from and placed_at < v_b.ts_to
                                   and status <> 'voided'))
    into v_cafe;

  -- Stock ------------------------------------------------------------------
  select jsonb_build_object(
           'low',          (select count(*) from v_ingredient_on_hand
                             where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
                               and is_active and low_stock_threshold is not null
                               and on_hand <= low_stock_threshold),
           'belowPar',     (select count(*) from v_ingredient_on_hand
                             where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
                               and is_active and par_level is not null and on_hand < par_level),
           'expiringSoon', (select count(*) from v_expiring_soon where venue_id = any(v_rv)),
           'expired',      (select count(*) from v_expired where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))),
           'lastCountAt',  (select max(finalized_at) from stock_counts where stock_counts.venue_id = any(v_rv) and venue_id = any(v_rv)),
           'openAlerts',   (select count(*) from manager_alerts where manager_alerts.venue_id = any(v_rv) and acknowledged_at is null))
    into v_stock;

  -- Staff activity today (activity, not a ranking: ordered by name) ---------
  with
  ord as (
    select o.placed_by_staff_id as staff_id, count(*) as n
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided' and o.placed_by_staff_id is not null
     group by 1),
  bk as (
    select r.created_by_staff_id as staff_id, count(*) as n
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking' and r.created_by_staff_id is not null
       and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  pay as (
    select p.recorded_by as staff_id, count(*) as n
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
     group by 1),
  ids as (
    select staff_id from ord union select staff_id from bk union select staff_id from pay)
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId',         s.id,
           'name',            s.display_name,
           'role',            s.role,
           'ordersTaken',     coalesce(ord.n, 0),
           'bookingsCreated', coalesce(bk.n, 0),
           'paymentsTaken',   coalesce(pay.n, 0)
         ) order by s.display_name, s.id), '[]'::jsonb)
    into v_staff
    from ids
    join staff s on s.id = ids.staff_id
    left join ord on ord.staff_id = s.id
    left join bk  on bk.staff_id  = s.id
    left join pay on pay.staff_id = s.id;

  -- Exceptions today -------------------------------------------------------
  select jsonb_build_object(
           'discounts', (select jsonb_build_object('count', count(*), 'amountIqd', coalesce(sum(amount_iqd), 0)::bigint)
                           from tab_adjustments
                          where created_at >= v_b.ts_from and created_at < v_b.ts_to),
           'voids',     (select jsonb_build_object('count', count(*),
                                                   'amountIqd', coalesce(sum((after ->> 'line_total_iqd')::bigint), 0)::bigint)
                           from audit_log
                          where audit_log.venue_id = any(v_rv) and action = 'order_item.void'
                            and at >= v_b.ts_from and at < v_b.ts_to),
           'refunds',   (select jsonb_build_object('count', count(*), 'amountIqd', coalesce(sum(amount_iqd), 0)::bigint)
                           from refunds
                          where refunds.venue_id = any(v_rv) and created_at >= v_b.ts_from and created_at < v_b.ts_to),
           'waste',     (select jsonb_build_object('count', count(*),
                                                   'costIqd', coalesce(round(sum(-qty_delta * coalesce(unit_cost_iqd, 0))), 0)::bigint)
                           from stock_movements
                          where stock_movements.venue_id = any(v_rv) and movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
                            and qty_delta < 0
                            and at >= v_b.ts_from and at < v_b.ts_to))
    into v_exc;

  -- Day close --------------------------------------------------------------
  select * into v_day from day_sessions
   where day_sessions.venue_id = any(v_rv) and status in ('open','closing')
   order by opened_at desc limit 1;

  if found then
    select jsonb_build_object(
             'open',            true,
             'businessDate',    v_day.business_date,
             'openedAt',        v_day.opened_at,
             'openingFloatIqd', v_day.opening_float_iqd::bigint,
             'blockingTabs',    coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id',          t.id,
                        'label',       t.label,
                        'tableNumber', ct.table_number,
                        'guestName',   coalesce(r.guest_name, pr.full_name)
                      ) order by t.opened_at, t.id)
                 from tabs t
                 left join cafe_tables ct  on ct.id = t.table_id
                 left join reservations r  on r.id = t.reservation_id
                 left join profiles pr     on pr.id = r.guest_id
                where r.venue_id = any(v_rv) and ct.venue_id = any(v_rv) and t.venue_id = any(v_rv) and t.day_session_id = v_day.id
                  and t.status in ('open','awaiting_payment')), '[]'::jsonb),
             'expectedCashIqd', (
               v_day.opening_float_iqd
               + coalesce((select sum(p.amount_iqd) from payments p
                            where p.venue_id = any(v_rv) and p.day_session_id = v_day.id and p.method = 'cash'), 0)
               - coalesce((select sum(rf.amount_iqd) from refunds rf
                             join payments p on p.id = rf.payment_id
                            where p.venue_id = any(v_rv) and rf.venue_id = any(v_rv) and p.day_session_id = v_day.id and p.method = 'cash'), 0))::bigint)
      into v_close;
  else
    v_close := jsonb_build_object(
      'open', false, 'businessDate', null, 'openedAt', null, 'openingFloatIqd', null,
      'blockingTabs', '[]'::jsonb, 'expectedCashIqd', null);
  end if;

  return jsonb_build_object(
    'businessDate',  v_today,
    'asOf',          v_now,
    'bookings',      v_bookings,
    'cafe',          v_cafe,
    'stock',         v_stock,
    'staffActivity', v_staff,
    'exceptions',    v_exc,
    'dayClose',      v_close);
end $ops_overview_0219$;

-- analytics_menu_snapshot: re-issued from 20260825000034_analytics.sql:748; report scope on 1 read(s)
create or replace function app.analytics_menu_snapshot()
returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_menu_snapshot_0219$
declare
  v_rv uuid[] := app.report_venues();
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
    left join menu_item_costs c on c.item_id = mi.id
   where mc.venue_id = any(v_rv) and mi.venue_id = any(v_rv);

  return v_out;
end $analytics_menu_snapshot_0219$;

-- analytics_courts_cafe: re-issued from 20260925000174_event_court_blocks.sql:1218; report scope on 6 read(s)
create or replace function app.analytics_courts_cafe(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_cafe_0219$
declare
  v_av uuid := app.analysis_venue();
  v_b     record;
  v_ex    uuid[];
  v_out   jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_ex    := app.analytics_excluded();

  with
  b as (
    select r.id, r.court_id, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order
      from courts c
     where c.venue_id = v_av and (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes, sum(o.event_minutes)::bigint as event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  lt as (
    select t.id as tab_id, t.reservation_id, t.status
      from tabs t
      join b on b.id = t.reservation_id
     where t.venue_id = v_av and t.status <> 'void' and t.merged_into_tab_id is null),
  lm as (
    select s.tab_id, s.reservation_id, s.cafe_gross_iqd, s.refunds_iqd, s.cafe_net_iqd
      from app.cafe_settled_tabs(null, null) s
      join b on b.id = s.reservation_id),
  per_b as (
    select b.*,
           exists (select 1 from lt where lt.reservation_id = b.id)                                   as linked,
           exists (select 1 from lm where lm.reservation_id = b.id)                                   as settled,
           (select coalesce(sum(lm.cafe_net_iqd), 0)   from lm where lm.reservation_id = b.id)::bigint as cafe_iqd,
           (select coalesce(sum(lm.cafe_gross_iqd), 0) from lm where lm.reservation_id = b.id)::bigint as cafe_gross_iqd,
           (select coalesce(sum(lm.refunds_iqd), 0)    from lm where lm.reservation_id = b.id)::bigint as refunds_iqd
      from b),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order,
           coalesce(oc.open_minutes, 0)::bigint          as open_minutes,
           coalesce(oc.event_minutes, 0)::bigint         as event_minutes,
           count(p.id)                                   as live_bookings,
           count(p.id) filter (where p.linked)           as linked_bookings,
           count(p.id) filter (where p.settled)          as settled_linked,
           coalesce(sum(p.cafe_iqd), 0)::bigint          as cafe_iqd,
           coalesce(sum(p.cafe_gross_iqd), 0)::bigint    as cafe_gross_iqd,
           coalesce(sum(p.refunds_iqd), 0)::bigint       as refunds_iqd,
           coalesce(sum(p.price_iqd), 0)::bigint         as court_iqd,
           coalesce(sum(p.mins), 0)::bigint              as booked_minutes
      from courts_in c
      left join oc on oc.court_id = c.id
      left join per_b p on p.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, oc.open_minutes, oc.event_minutes),
  tot as (
    select coalesce(sum(pc.live_bookings), 0)::bigint    as live_bookings,
           coalesce(sum(pc.linked_bookings), 0)::bigint  as linked_bookings,
           coalesce(sum(pc.settled_linked), 0)::bigint   as settled_linked,
           coalesce(sum(pc.cafe_iqd), 0)::bigint         as cafe_iqd,
           coalesce(sum(pc.cafe_gross_iqd), 0)::bigint   as cafe_gross_iqd,
           coalesce(sum(pc.refunds_iqd), 0)::bigint      as refunds_iqd,
           coalesce(sum(pc.court_iqd), 0)::bigint        as court_iqd,
           coalesce(sum(pc.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(sum(pc.open_minutes), 0)::bigint     as open_minutes,
           coalesce(sum(pc.event_minutes), 0)::bigint    as event_minutes
      from per_court pc),
  nl as (
    select * from app.cafe_net_lines((select coalesce(array_agg(lt.tab_id), '{}'::uuid[]) from lt))),
  lo as (
    select o.id as order_id, o.placed_at, p.court_id, p.start_at, p.end_at
      from orders o
      join lt on lt.tab_id = o.tab_id
      join per_b p on p.id = lt.reservation_id
     where o.venue_id = v_av and o.status <> 'voided'),
  li as (
    select lo.court_id, lo.order_id, nl.menu_item_id,
           (nl.qty - nl.refund_qty) as qty, nl.net_iqd
      from nl
      join lo on lo.order_id = nl.order_id
     where nl.menu_item_id <> all (v_ex)),
  ao as (
    select o.id as order_id
      from orders o
     where o.venue_id = v_av and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'),
  ai as (
    select oi.menu_item_id, oi.order_id
      from order_items oi
      join ao on ao.order_id = oi.order_id
     where not oi.voided and oi.menu_item_id <> all (v_ex)),
  top_items as (
    select x.*, row_number() over (partition by x.court_id order by x.qty desc, x.revenue_iqd desc, x.item_id) as rn
      from (select li.court_id, li.menu_item_id as item_id,
                   sum(li.qty)::bigint             as qty,
                   sum(li.net_iqd)::bigint         as revenue_iqd,
                   count(distinct li.order_id)     as linked_orders
              from li group by li.court_id, li.menu_item_id) x),
  items as (
    select coalesce(l.item_id, a.item_id) as item_id, coalesce(l.n, 0) as linked_n, coalesce(a.n, 0) as all_n
      from (select li.menu_item_id as item_id, count(distinct li.order_id) as n from li group by li.menu_item_id) l
      full join (select ai.menu_item_id as item_id, count(distinct ai.order_id) as n from ai group by ai.menu_item_id) a
             on a.item_id = l.item_id),
  timing as (
    select lo.order_id,
           extract(epoch from (lo.placed_at - lo.start_at)) / 60 as offset_min,
           case when lo.placed_at < lo.start_at - interval '30 minutes'            then 'before_30plus'
                when lo.placed_at < lo.start_at                                    then 'before_0_30'
                when lo.placed_at < lo.start_at + (lo.end_at - lo.start_at) / 2    then 'first_half'
                when lo.placed_at < lo.end_at                                      then 'second_half'
                when lo.placed_at < lo.end_at + interval '30 minutes'              then 'after_0_30'
                else 'after_30plus' end as bucket,
           (select coalesce(sum(nl.net_iqd), 0) from nl where nl.order_id = lo.order_id)::bigint as revenue_iqd
      from lo),
  timing_keys as (
    select k.bucket, k.ord
      from (values ('before_30plus', 1), ('before_0_30', 2), ('first_half', 3),
                   ('second_half', 4), ('after_0_30', 5), ('after_30plus', 6)) k(bucket, ord))
  select jsonb_build_object(
    'event_minutes', t.event_minutes,
    'attach', jsonb_build_object(
      'live_bookings',                t.live_bookings,
      'linked_bookings',              t.linked_bookings,
      'attach_pct',                   case when t.live_bookings > 0 then round(t.linked_bookings * 100.0 / t.live_bookings, 1) end,
      'settled_linked',               t.settled_linked,
      'cafe_iqd',                     t.cafe_iqd,
      'cafe_gross_iqd',               t.cafe_gross_iqd,
      'refunds_iqd',                  t.refunds_iqd,
      'cafe_per_linked_iqd',          case when t.settled_linked > 0 then round(t.cafe_iqd * 1.0 / t.settled_linked)::bigint end,
      'cafe_per_booking_iqd',         case when t.live_bookings > 0 then round(t.cafe_iqd * 1.0 / t.live_bookings)::bigint end,
      'court_iqd',                    t.court_iqd,
      'booked_minutes',               t.booked_minutes,
      'open_minutes',                 t.open_minutes,
      'combined_per_booked_hour_iqd', case when t.booked_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.booked_minutes)::bigint end,
      'combined_per_open_hour_iqd',   case when t.open_minutes > 0 then round((t.court_iqd + t.cafe_iqd) * 60.0 / t.open_minutes)::bigint end),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                     pc.id,
               'name_en',                      pc.name_en,
               'name_ar',                      pc.name_ar,
               'live_bookings',                pc.live_bookings,
               'linked_bookings',              pc.linked_bookings,
               'attach_pct',                   case when pc.live_bookings > 0 then round(pc.linked_bookings * 100.0 / pc.live_bookings, 1) end,
               'settled_linked',               pc.settled_linked,
               'cafe_iqd',                     pc.cafe_iqd,
               'cafe_gross_iqd',               pc.cafe_gross_iqd,
               'refunds_iqd',                  pc.refunds_iqd,
               'cafe_per_linked_iqd',          case when pc.settled_linked > 0 then round(pc.cafe_iqd * 1.0 / pc.settled_linked)::bigint end,
               'cafe_per_booking_iqd',         case when pc.live_bookings > 0 then round(pc.cafe_iqd * 1.0 / pc.live_bookings)::bigint end,
               'court_iqd',                    pc.court_iqd,
               'booked_minutes',               pc.booked_minutes,
               'open_minutes',                 pc.open_minutes,
               'combined_per_booked_hour_iqd', case when pc.booked_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.booked_minutes)::bigint end,
               'combined_per_open_hour_iqd',   case when pc.open_minutes > 0 then round((pc.court_iqd + pc.cafe_iqd) * 60.0 / pc.open_minutes)::bigint end
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',                ti.court_id,
               'item_id',                 ti.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'qty',                     ti.qty,
               'revenue_iqd',             ti.revenue_iqd,
               'linked_orders_with_item', ti.linked_orders
             ) order by ti.court_id, ti.rn), '[]'::jsonb)
        from top_items ti
        join menu_items mi on mi.id = ti.item_id
       where mi.venue_id = v_av and ti.rn <= 5),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'item_id',                 i.item_id,
               'name_en',                 mi.name_en,
               'name_ar',                 mi.name_ar,
               'linked_orders_with_item', i.linked_n,
               'all_orders_with_item',    i.all_n
             ) order by i.linked_n desc, i.all_n desc, mi.name_en, i.item_id), '[]'::jsonb)
        from items i
        join menu_items mi on mi.id = i.item_id),
    'linked_orders_total', (select count(*) from lo),
    'all_orders_total',    (select count(*) from ao),
    'order_timing', jsonb_build_object(
      'median_offset_min', (select round(percentile_cont(0.5) within group (order by tm.offset_min::double precision))::int from timing tm),
      'buckets', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'orders',      coalesce(x.n, 0),
                 'revenue_iqd', coalesce(x.rev, 0)
               ) order by k.ord)
          from timing_keys k
          left join (select tm.bucket, count(*) as n, sum(tm.revenue_iqd)::bigint as rev from timing tm group by tm.bucket) x
                 on x.bucket = k.bucket)),
    'attach_cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',             x.dow,
               'hour',            x.hour,
               'live_bookings',   x.n,
               'linked_bookings', x.linked
             ) order by x.dow, x.hour), '[]'::jsonb)
        from (select p.dow, p.hour, count(*) as n, count(*) filter (where p.linked) as linked
                from per_b p group by p.dow, p.hour) x),
    'by_duration', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'duration_min', x.mins,
               'bookings',     x.n,
               'linked',       x.linked,
               'cafe_iqd',     x.cafe_iqd
             ) order by x.mins), '[]'::jsonb)
        from (select p.mins, count(*) as n, count(*) filter (where p.linked) as linked,
                     coalesce(sum(p.cafe_iqd), 0)::bigint as cafe_iqd
                from per_b p group by p.mins) x))
    into v_out
    from tot t;

  return v_out;
end $analytics_courts_cafe_0219$;

-- analytics_courts_demand: re-issued from 20260922000147_drop_reservation_players.sql:763; report scope on 2 read(s)
create or replace function app.analytics_courts_demand(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_demand_0219$
declare
  v_av uuid := app.analysis_venue();
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source, r.series_id,
           coalesce(r.price_iqd, 0)::bigint                                              as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                       as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                          as lead_min,
           extract(hour from (r.created_at at time zone v_b.tz))::int                    as c_hour,
           extract(dow from app.business_date(r.created_at, v_b.tz, v_b.start_hour))::int as c_dow,
           r.status in ('confirmed','arrived','completed')                               as live,
           r.status = 'cancelled'                                                        as cancelled,
           r.status = 'no_show'                                                          as no_show
      from reservations r
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  -- lead time and creation clock: live, single (non-series) bookings only
  lb as (
    select b.*,
           case when b.lead_min < 120   then 'lt2h'
                when b.lead_min < 360   then '2_6h'
                when b.lead_min < 1440  then '6_24h'
                when b.lead_min < 4320  then '1_3d'
                when b.lead_min < 10080 then '3_7d'
                else '7d_plus' end as lead_bucket
      from b
     where b.live and b.series_id is null),
  lead_keys as (
    select k.bucket, k.ord
      from (values ('lt2h', 1), ('2_6h', 2), ('6_24h', 3), ('1_3d', 4), ('3_7d', 5), ('7d_plus', 6)) k(bucket, ord)),
  src_keys as (
    select s.source from (values ('mobile'), ('desk')) s(source)),
  holds as (
    select count(*) filter (where r.status = 'expired')  as expired,
           count(*) filter (where r.status = 'pending')  as pending
      from reservations r
     where r.venue_id = v_av and r.kind = 'hold' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  converted as (
    select count(*) as n from b where b.source = 'mobile')
  select jsonb_build_object(
    'durations', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'duration_min',         x.mins,
               'bookings',             x.n,
               'booked_minutes',       x.bm,
               'revenue_iqd',          x.rev,
               'revenue_per_hour_iqd', case when x.bm > 0 then round(x.rev * 60.0 / x.bm)::bigint end
             ) order by x.mins), '[]'::jsonb)
        from (select b.mins, count(*) as n, sum(b.mins)::bigint as bm, sum(b.price_iqd)::bigint as rev
                from b where b.live group by b.mins) x),
    'lead_time', jsonb_build_object(
      'median_min', (select round(percentile_cont(0.5) within group (order by lb.lead_min::double precision))::int from lb),
      'buckets', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',   k.bucket,
                 'bookings', coalesce(x.n, 0),
                 'mobile',   coalesce(x.m, 0),
                 'desk',     coalesce(x.d, 0)
               ) order by k.ord)
          from lead_keys k
          left join (select lb.lead_bucket, count(*) as n,
                            count(*) filter (where lb.source = 'mobile') as m,
                            count(*) filter (where lb.source = 'desk')   as d
                       from lb group by lb.lead_bucket) x on x.lead_bucket = k.bucket)),
    'created_hour', (
      select jsonb_agg(jsonb_build_object('hour', gs, 'bookings', (select count(*) from lb where lb.c_hour = gs)) order by gs)
        from generate_series(0, 23) gs),
    'created_dow', (
      select jsonb_agg(jsonb_build_object('dow', gs, 'bookings', (select count(*) from lb where lb.c_dow = gs)) order by gs)
        from generate_series(0, 6) gs),
    'sources', (
      select jsonb_agg(jsonb_build_object(
               'source',           s.source,
               'bookings',         coalesce(x.n, 0),
               'revenue_iqd',      coalesce(x.rev, 0),
               'cancellations',    coalesce(x.canc, 0),
               'no_shows',         coalesce(x.ns, 0),
               'avg_duration_min', x.avg_dur
             ) order by s.source)
        from src_keys s
        left join (select b.source,
                          count(*) filter (where b.live)                              as n,
                          coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as rev,
                          count(*) filter (where b.cancelled)                         as canc,
                          count(*) filter (where b.no_show)                           as ns,
                          round(avg(b.mins) filter (where b.live), 1)                 as avg_dur
                     from b group by b.source) x on x.source = s.source),
    'hold_funnel', jsonb_build_object(
      'holds_ended',    h.expired + c.n,
      'converted',      c.n,
      'pending',        h.pending,
      'conversion_pct', case when h.expired + c.n > 0 then round(c.n * 100.0 / (h.expired + c.n), 1) end),
    'series', (
      select jsonb_build_object(
               'series_bookings',    count(*) filter (where b.series_id is not null),
               'single_bookings',    count(*) filter (where b.series_id is null),
               'series_pct',         case when count(*) > 0
                                          then round(count(*) filter (where b.series_id is not null) * 100.0 / count(*), 1) end,
               'series_revenue_iqd', coalesce(sum(b.price_iqd) filter (where b.series_id is not null), 0)::bigint)
        from b where b.live))
    into v_out
    from holds h, converted c;

  return v_out;
end $analytics_courts_demand_0219$;

-- analytics_courts_endings: re-issued from 20260926000214_analytics_stock_settings_per_venue.sql:418; report scope on 4 read(s)
create or replace function app.analytics_courts_endings(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_endings_0219$
declare
  v_av uuid := app.analysis_venue();
  v_b          record;
  v_policy_min int;
  v_out        jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  v_policy_min := coalesce((select vs.cancellation_window_hours from venue_settings vs
                             where vs.venue_id = app.analysis_venue()), 12) * 60;

  with
  -- 0154: app.analytics_guest_ident, set-based. The phone -> account map is
  -- built once (earliest profile per canonical phone, as its LIMIT 1 picks)
  -- instead of one profiles scan per phone-only row.
  phone_owner as materialized (
    select distinct on (x.canon) x.canon, 'u:' || x.id::text as ident
      from (select app.phone_canon(p.phone) as canon, p.id, p.created_at
              from profiles p
             where p.phone is not null) x
     where x.canon is not null
     order by x.canon, x.created_at, x.id),
  b as materialized (
    select r.id, r.court_id, r.source::text as source, r.series_id, r.start_at, r.end_at, r.cancelled_at,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           extract(epoch from (r.start_at - r.created_at)) / 60                      as lead_min,
           extract(epoch from (r.start_at - r.cancelled_at)) / 60                    as notice_min,
           coalesce(r.cancelled_by::text, 'unknown')                                 as actor,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show,
           case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as materialized (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident,
           r.start_at
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  -- 0154: an earlier same-ident row exists  <=>  the ident's earliest start is
  -- earlier. Both strict, so two rows at the same instant are not each other's
  -- history. One hash aggregate instead of a correlated SubPlan per booking.
  first_seen as materialized (
    select h.ident, min(h.start_at) as first_at
      from hist h
     where h.ident is not null
     group by h.ident),
  bounds as (
    select distinct v from unnest(array[0, 120, 360, 1440, 4320, v_policy_min]) as v),
  edges as (
    select v as lo, lead(v) over (order by v) as hi, row_number() over (order by v) as ord
      from bounds),
  notice_keys as (
    select null::int as lo, 0 as hi, 0::bigint as ord, 'after_start'::text as bucket, false as policy_edge
    union all
    select e.lo, e.hi, e.ord,
           case when e.hi is null then e.lo::text || '_plus' else e.lo::text || '_' || e.hi::text end,
           e.lo = v_policy_min
      from edges e),
  typed as (
    select b.*,
           case when b.ident is null then 'unidentified'
                when coalesce(fs.first_at < b.start_at, false) then 'returning'
                else 'new' end as typ,
           case when b.series_id is not null then null
                when b.lead_min < 120   then 'lt2h'
                when b.lead_min < 360   then '2_6h'
                when b.lead_min < 1440  then '6_24h'
                when b.lead_min < 4320  then '1_3d'
                when b.lead_min < 10080 then '3_7d'
                else '7d_plus' end as lead_bucket,
           case when b.notice_min is null then null
                when b.notice_min < 0    then 'after_start'
                else (select k.bucket from notice_keys k
                       where k.lo is not null and b.notice_min >= k.lo and (k.hi is null or b.notice_min < k.hi)
                       limit 1) end as notice_bucket
      from b
      left join first_seen fs on fs.ident = b.ident),
  segs as (
    select t.id, t.cancelled, t.no_show, x.dim, x.key, x.ord
      from typed t
      cross join lateral (values
        ('hour',      t.hour::text,                                                   t.hour),
        ('dow',       t.dow::text,                                                    t.dow),
        ('court',     t.court_id::text,                                               0),
        ('source',    t.source,                                                       0),
        ('duration',  t.mins::text,                                                   t.mins),
        ('lead_time', t.lead_bucket,                                                  case t.lead_bucket
                                                                                        when 'lt2h' then 1 when '2_6h' then 2 when '6_24h' then 3
                                                                                        when '1_3d' then 4 when '3_7d' then 5 else 6 end),
        ('series',    case when t.series_id is null then 'single' else 'series' end,  0),
        ('type',      t.typ,                                                          case t.typ when 'returning' then 1 when 'new' then 2 else 3 end)
      ) x(dim, key, ord)
     where x.key is not null),
  agg as (
    select s.dim, s.key, min(s.ord) as ord,
           count(*) filter (where s.cancelled) as canc,
           count(*) filter (where s.no_show)   as ns,
           count(*)                            as total
      from segs s
     group by s.dim, s.key),
  rows_c as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.canc, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  rows_n as (
    select a.dim,
           jsonb_agg(
             jsonb_build_object('key', a.key, 'n', a.ns, 'bookings_total', a.total)
             || case when a.dim = 'court'
                     then jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar)
                     else '{}'::jsonb end
             order by a.ord, c.sort_order nulls last, c.name_en, a.key) as rows
      from agg a
      left join courts c on a.dim = 'court' and c.id::text = a.key
     group by a.dim),
  actor_keys as (
    select k.actor, k.ord
      from (values ('guest', 1), ('staff', 2), ('unknown', 3)) k(actor, ord)),
  -- Late cancellations and what became of the slot.
  late as (
    select t.id, t.court_id, t.start_at, t.end_at, t.cancelled_at, t.price_iqd
      from typed t
     where t.cancelled and t.notice_min is not null and t.notice_min < v_policy_min),
  resold as (
    select lc.id, lc.price_iqd,
           (select r2.price_iqd
              from reservations r2
             where r2.venue_id = v_av and r2.court_id = lc.court_id
               and r2.kind = 'booking'
               and r2.status in ('confirmed','arrived','completed')
               and r2.id <> lc.id
               and r2.created_at > lc.cancelled_at
               and r2.start_at < lc.end_at and r2.end_at > lc.start_at
             order by r2.created_at, r2.id
             limit 1) as replacement_iqd
      from late lc),
  in_period as (
    select count(*) as n, coalesce(sum(r.price_iqd), 0)::bigint as revenue_iqd
      from reservations r
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status = 'cancelled'
       and r.cancelled_at >= v_b.ts_from and r.cancelled_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id))
  select jsonb_build_object(
    'policy_window_min', v_policy_min,
    'cancellations', jsonb_build_object(
      'total',             (select count(*) from b where b.cancelled),
      'revenue_iqd',       (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.cancelled),
      'late_revenue_iqd',  (select coalesce(sum(lc.price_iqd), 0)::bigint from late lc),
      'median_notice_min', (select round(percentile_cont(0.5) within group (order by b.notice_min::double precision))::int
                              from b where b.cancelled and b.notice_min is not null),
      'by_notice', (
        select jsonb_agg(jsonb_build_object(
                 'bucket',      k.bucket,
                 'lo_min',      k.lo,
                 'hi_min',      k.hi,
                 'n',           coalesce(x.n, 0),
                 'policy_edge', k.policy_edge
               ) order by k.ord)
          from notice_keys k
          left join (select t.notice_bucket, count(*) as n from typed t where t.cancelled group by t.notice_bucket) x
                 on x.notice_bucket = k.bucket),
      'by_actor', (
        select jsonb_agg(jsonb_build_object('actor', k.actor, 'n', coalesce(x.n, 0)) order by k.ord)
          from actor_keys k
          left join (select b.actor, count(*) as n from b where b.cancelled group by b.actor) x on x.actor = k.actor),
      'cancelled_in_period', (select jsonb_build_object('n', ip.n, 'revenue_iqd', ip.revenue_iqd) from in_period ip),
      'resold', (
        select jsonb_build_object(
                 'cancelled',     count(*),
                 'resold_n',      count(*) filter (where rs.replacement_iqd is not null),
                 'recovered_iqd', coalesce(sum(rs.replacement_iqd), 0)::bigint,
                 'empty_n',       count(*) filter (where rs.replacement_iqd is null),
                 'lost_iqd',      coalesce(sum(rs.price_iqd) filter (where rs.replacement_iqd is null), 0)::bigint)
          from resold rs),
      'by_hour',      coalesce((select rc.rows from rows_c rc where rc.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rc.rows from rows_c rc where rc.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rc.rows from rows_c rc where rc.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rc.rows from rows_c rc where rc.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rc.rows from rows_c rc where rc.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rc.rows from rows_c rc where rc.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rc.rows from rows_c rc where rc.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rc.rows from rows_c rc where rc.dim = 'type'),      '[]'::jsonb)),
    'no_shows', jsonb_build_object(
      'total',        (select count(*) from b where b.no_show),
      'revenue_iqd',  (select coalesce(sum(b.price_iqd), 0)::bigint from b where b.no_show),
      'by_hour',      coalesce((select rn.rows from rows_n rn where rn.dim = 'hour'),      '[]'::jsonb),
      'by_dow',       coalesce((select rn.rows from rows_n rn where rn.dim = 'dow'),       '[]'::jsonb),
      'by_court',     coalesce((select rn.rows from rows_n rn where rn.dim = 'court'),     '[]'::jsonb),
      'by_source',    coalesce((select rn.rows from rows_n rn where rn.dim = 'source'),    '[]'::jsonb),
      'by_duration',  coalesce((select rn.rows from rows_n rn where rn.dim = 'duration'),  '[]'::jsonb),
      'by_lead_time', coalesce((select rn.rows from rows_n rn where rn.dim = 'lead_time'), '[]'::jsonb),
      'by_series',    coalesce((select rn.rows from rows_n rn where rn.dim = 'series'),    '[]'::jsonb),
      'by_type',      coalesce((select rn.rows from rows_n rn where rn.dim = 'type'),      '[]'::jsonb)))
    into v_out;

  return v_out;
end $analytics_courts_endings_0219$;

-- analytics_courts_guests: re-issued from 20260923000154_analytics_returning_guest.sql:284; report scope on 3 read(s)
create or replace function app.analytics_courts_guests(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_guests_0219$
declare
  v_av uuid := app.analysis_venue();
  v_b   record;
  v_out jsonb;
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  -- 0154: app.analytics_guest_ident, set-based. The phone -> account map is
  -- built once (earliest profile per canonical phone, as its LIMIT 1 picks)
  -- instead of one profiles scan per phone-only row.
  phone_owner as materialized (
    select distinct on (x.canon) x.canon, 'u:' || x.id::text as ident
      from (select app.phone_canon(p.phone) as canon, p.id, p.created_at
              from profiles p
             where p.phone is not null) x
     where x.canon is not null
     order by x.canon, x.created_at, x.id),
  b as materialized (
    select r.id, r.court_id, r.start_at,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)      as d,
           case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  hist as materialized (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident,
           r.start_at
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from - interval '180 days' and r.start_at < v_b.ts_to
       and (r.guest_id is not null or r.guest_phone is not null)),
  -- 0154: see analytics_courts_endings above.
  first_seen as materialized (
    select h.ident, min(h.start_at) as first_at
      from hist h
     where h.ident is not null
     group by h.ident),
  typed as (
    select b.*,
           coalesce(fs.first_at < b.start_at, false) as returning
      from b
      left join first_seen fs on fs.ident = b.ident
     where b.ident is not null),
  per_ident as (
    select t.ident, count(*) as n from typed t group by t.ident),
  visit_keys as (
    select k.bucket, k.ord, k.lo, k.hi
      from (values ('1', 1, 1, 1), ('2_3', 2, 2, 3), ('4_6', 3, 4, 6), ('7_plus', 4, 7, 2147483647)) k(bucket, ord, lo, hi)),
  reg_src as materialized (
    select case when r.guest_id is not null then 'u:' || r.guest_id::text
                when pc.canon is null then null
                else coalesce(po.ident, 'p:' || pc.canon) end as ident,
           r.start_at,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
      cross join lateral (select app.phone_canon(r.guest_phone) as canon) pc
      left join phone_owner po on r.guest_id is null and po.canon = pc.canon
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_to - interval '90 days' and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)
       and (r.guest_id is not null or r.guest_phone is not null)),
  regs as (
    select s.ident, count(*) as n, max(s.start_at) as last_at
      from reg_src s
     where s.ident is not null
     group by s.ident
    having count(*) >= 3),
  reg_slots as (
    select s.ident, max(x.cnt) as top, sum(x.cnt) as total
      from (select s2.ident, s2.dow, s2.hour, count(*) as cnt
              from reg_src s2
             where s2.ident in (select rg.ident from regs rg)
             group by s2.ident, s2.dow, s2.hour) x
      join regs s on s.ident = x.ident
     group by s.ident),
  weeks as (
    select date_trunc('week', t.d)::date as week_start, t.ident, bool_or(not t.returning) as is_new
      from typed t
     group by 1, t.ident),
  week_rows as (
    select w.week_start,
           count(*) filter (where w.is_new)      as new_identities,
           count(*) filter (where not w.is_new)  as returning_identities
      from weeks w
     group by w.week_start),
  week_all as (
    select date_trunc('week', b.d)::date as week_start, count(*) as bookings
      from b group by 1)
  select jsonb_build_object(
    'lookback_days',        180,
    'regular_window_days',  90,
    'lapse_days',           28,
    'identified_bookings',   (select count(*) from typed),
    'unidentified_bookings', (select count(*) from b where b.ident is null),
    'identities',            (select count(*) from per_ident),
    'returning_bookings',    (select count(*) from typed t where t.returning),
    'new_bookings',          (select count(*) from typed t where not t.returning),
    'returning_pct',         (select case when count(*) > 0 then round(count(*) filter (where t.returning) * 100.0 / count(*), 1) end from typed t),
    'visit_buckets', (
      select jsonb_agg(jsonb_build_object(
               'bucket',     k.bucket,
               'identities', (select count(*) from per_ident p where p.n between k.lo and k.hi),
               'bookings',   (select coalesce(sum(p.n), 0)::bigint from per_ident p where p.n between k.lo and k.hi)
             ) order by k.ord)
        from visit_keys k),
    'regulars',          (select count(*) from regs),
    'lapsing_regulars',  (select count(*) from regs rg
                           where rg.last_at <= least(v_b.ts_to, now()) - interval '28 days'),
    'regulars_bookings_pct', (
      select case when count(*) > 0
                  then round(count(*) filter (where b.ident in (select rg.ident from regs rg)) * 100.0 / count(*), 1) end
        from b),
    'regulars_fixed_slot_pct', (
      select case when count(*) > 0
                  then round(count(*) filter (where rs.top * 100.0 / rs.total >= 60) * 100.0 / count(*), 1) end
        from reg_slots rs),
    'by_week', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'week_start',           wa.week_start,
               'new_identities',       coalesce(wr.new_identities, 0),
               'returning_identities', coalesce(wr.returning_identities, 0),
               'bookings',             wa.bookings
             ) order by wa.week_start), '[]'::jsonb)
        from week_all wa
        left join week_rows wr on wr.week_start = wa.week_start))
    into v_out;

  return v_out;
end $analytics_courts_guests_0219$;

-- analytics_courts_summary: re-issued from 20260926000214_analytics_stock_settings_per_venue.sql:199; report scope on 3 read(s)
create or replace function app.analytics_courts_summary(
  p_from     date,
  p_to       date,
  p_court_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $analytics_courts_summary_0219$
declare
  v_b   record;
  v_out jsonb;
  v_av  uuid := app.analysis_venue();
begin
  perform app.analytics_guard();
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  with
  b as (
    select r.id, r.court_id, r.source::text as source,
           coalesce(r.price_iqd, 0)::bigint                                          as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int                   as mins,
           r.start_at at time zone v_b.tz                                            as s_local,
           r.end_at at time zone v_b.tz                                              as e_local,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)                     as d,
           extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour,
           r.status in ('confirmed','arrived','completed')                           as live,
           r.status = 'cancelled'                                                    as cancelled,
           r.status = 'no_show'                                                      as no_show
      from reservations r
     where r.venue_id = v_av and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed','cancelled','no_show')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  holds as (
    select extract(dow from app.business_date(r.start_at, v_b.tz, v_b.start_hour))::int as dow,
           extract(hour from (r.start_at at time zone v_b.tz))::int                  as hour
      from reservations r
     where r.venue_id = v_av and r.kind = 'hold' and r.status = 'expired' and r.source = 'mobile'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (p_court_id is null or r.court_id = p_court_id)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where c.venue_id = v_av and (p_court_id is null or c.id = p_court_id)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, o.dow, o.hour, o.open_minutes, o.open_days, o.event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, p_court_id) o
      join courts_in ci on ci.id = o.court_id),
  court_open as (
    select oc.court_id, sum(oc.open_minutes)::bigint as open_minutes, sum(oc.event_minutes)::bigint as event_minutes
      from oc group by oc.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(co.open_minutes, 0)::bigint                           as open_minutes,
           coalesce(co.event_minutes, 0)::bigint                          as event_minutes,
           count(b.id) filter (where b.live)                              as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint         as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint    as revenue_iqd,
           count(b.id) filter (where b.cancelled)                         as cancellations,
           count(b.id) filter (where b.no_show)                           as no_shows,
           count(b.id) filter (where b.live and b.source = 'mobile')      as mobile_bookings,
           count(b.id) filter (where b.live and b.source = 'desk')        as desk_bookings,
           avg(b.mins) filter (where b.live)                              as avg_duration_min
      from courts_in c
      left join court_open co on co.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, co.open_minutes, co.event_minutes),
  tot as (
    select count(*)::int                                   as courts_count,
           coalesce(sum(pc.bookings), 0)::bigint           as bookings,
           coalesce(sum(pc.booked_minutes), 0)::bigint     as booked_minutes,
           coalesce(sum(pc.revenue_iqd), 0)::bigint        as revenue_iqd,
           coalesce(sum(pc.cancellations), 0)::bigint      as cancellations,
           coalesce(sum(pc.no_shows), 0)::bigint           as no_shows,
           coalesce(sum(pc.mobile_bookings), 0)::bigint    as mobile_bookings,
           coalesce(sum(pc.desk_bookings), 0)::bigint      as desk_bookings,
           coalesce(sum(pc.open_minutes), 0)::bigint       as open_minutes,
           coalesce(sum(pc.event_minutes), 0)::bigint      as event_minutes
      from per_court pc),
  days as (
    select gs::date as d
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs),
  by_day as (
    select d.d,
           coalesce((select case when jsonb_typeof(vs.opening_hours -> lower(to_char(d.d, 'Dy'))) = 'array'
                                  then jsonb_array_length(vs.opening_hours -> lower(to_char(d.d, 'Dy')))
                                  else 0 end = 0
                            or d.d = any (coalesce(vs.closed_dates, '{}'))
                       from venue_settings vs where vs.venue_id = v_av), true) as closed,
           count(b.id) filter (where b.live)                           as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint      as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint as revenue_iqd,
           count(b.id) filter (where b.cancelled)                      as cancellations,
           count(b.id) filter (where b.no_show)                        as no_shows
      from days d
      left join b on b.d = d.d
     group by d.d),
  split as (
    select extract(dow from (gs - make_interval(hours => v_b.start_hour))::date)::int as dow,
           extract(hour from gs)::int                                                 as hour,
           sum(extract(epoch from (least(b.e_local, gs + interval '1 hour') - greatest(b.s_local, gs))) / 60) as booked_minutes
      from b
      cross join lateral generate_series(date_trunc('hour', b.s_local), b.e_local, interval '1 hour') gs
     where b.live and gs < b.e_local
     group by 1, 2),
  starts as (
    select b.dow, b.hour,
           count(*) filter (where b.live)                               as bookings,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint  as revenue_iqd,
           count(*) filter (where b.cancelled)                          as cancellations,
           count(*) filter (where b.no_show)                            as no_shows
      from b
     group by b.dow, b.hour),
  hold_cells as (
    select h.dow, h.hour, count(*) as holds_expired from holds h group by h.dow, h.hour),
  open_cells as (
    -- VENUE-WIDE: every court in courts_in, summed per cell.
    select oc.dow, oc.hour, sum(oc.open_minutes)::bigint as open_minutes, max(oc.open_days)::int as open_days
      from oc
     group by oc.dow, oc.hour),
  keys as (
    select oc.dow, oc.hour from open_cells oc
    union select sp.dow, sp.hour from split sp
    union select st.dow, st.hour from starts st
    union select hc.dow, hc.hour from hold_cells hc),
  heat as (
    select k.dow, k.hour,
           coalesce(oc.open_minutes, 0)::bigint            as open_minutes,
           coalesce(oc.open_days, 0)                       as open_days,
           coalesce(round(sp.booked_minutes), 0)::bigint   as booked_minutes,
           coalesce(st.bookings, 0)                        as bookings,
           coalesce(st.revenue_iqd, 0)                     as revenue_iqd,
           coalesce(st.cancellations, 0)                   as cancellations,
           coalesce(st.no_shows, 0)                        as no_shows,
           coalesce(hc.holds_expired, 0)                   as holds_expired
      from keys k
      left join open_cells oc on oc.dow = k.dow and oc.hour = k.hour
      left join split sp      on sp.dow = k.dow and sp.hour = k.hour
      left join starts st     on st.dow = k.dow and st.hour = k.hour
      left join hold_cells hc on hc.dow = k.dow and hc.hour = k.hour)
  select jsonb_build_object(
    'range',         jsonb_build_object('from', p_from, 'to', p_to),
    'courts_count',  t.courts_count,
    'open_minutes',  t.open_minutes,
    'event_minutes', t.event_minutes,
    'kpis', jsonb_build_object(
      'bookings',                  t.bookings,
      'booked_minutes',            t.booked_minutes,
      'occupancy_pct',             case when t.open_minutes > 0 then round(t.booked_minutes * 100.0 / t.open_minutes, 1) end,
      'revenue_iqd',               t.revenue_iqd,
      'rev_per_open_hour_iqd',     case when t.open_minutes > 0 then round(t.revenue_iqd * 60.0 / t.open_minutes)::bigint end,
      'price_per_booked_hour_iqd', case when t.booked_minutes > 0 then round(t.revenue_iqd * 60.0 / t.booked_minutes)::bigint end,
      'cancellations',             t.cancellations,
      'no_shows',                  t.no_shows,
      'booked_total',              t.bookings + t.cancellations + t.no_shows,
      'cancellation_rate_pct',     case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.cancellations * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'no_show_rate_pct',          case when t.bookings + t.cancellations + t.no_shows > 0
                                        then round(t.no_shows * 100.0 / (t.bookings + t.cancellations + t.no_shows), 1) end,
      'mobile_bookings',           t.mobile_bookings,
      'desk_bookings',             t.desk_bookings,
      'holds_expired',             (select count(*) from holds),
      'booking_days',              (select count(distinct b.d) from b where b.live)),
    'per_court', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'court_id',              pc.id,
               'name_en',               pc.name_en,
               'name_ar',               pc.name_ar,
               'is_active',             pc.is_active,
               'bookings',              pc.bookings,
               'booked_minutes',        pc.booked_minutes,
               'open_minutes',          pc.open_minutes,
               'occupancy_pct',         case when pc.open_minutes > 0 then round(pc.booked_minutes * 100.0 / pc.open_minutes, 1) end,
               'revenue_iqd',           pc.revenue_iqd,
               'rev_per_open_hour_iqd', case when pc.open_minutes > 0 then round(pc.revenue_iqd * 60.0 / pc.open_minutes)::bigint end,
               'cancellations',         pc.cancellations,
               'no_shows',              pc.no_shows,
               'booked_total',          pc.bookings + pc.cancellations + pc.no_shows,
               'cancellation_rate_pct', case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'no_show_rate_pct',      case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                             then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
               'mobile_bookings',       pc.mobile_bookings,
               'desk_bookings',         pc.desk_bookings,
               'avg_duration_min',      round(pc.avg_duration_min, 1)
             ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb)
        from per_court pc),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'business_date',  x.d,
               'closed',         x.closed,
               'bookings',       x.bookings,
               'booked_minutes', x.booked_minutes,
               'revenue_iqd',    x.revenue_iqd,
               'cancellations',  x.cancellations,
               'no_shows',       x.no_shows
             ) order by x.d), '[]'::jsonb)
        from by_day x),
    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'dow',            h.dow,
               'hour',           h.hour,
               'open_minutes',   h.open_minutes,
               'open_days',      h.open_days,
               'booked_minutes', h.booked_minutes,
               'bookings',       h.bookings,
               'revenue_iqd',    h.revenue_iqd,
               'cancellations',  h.cancellations,
               'no_shows',       h.no_shows,
               'holds_expired',  h.holds_expired
             ) order by h.dow, h.hour), '[]'::jsonb)
        from heat h))
    into v_out
    from tot t;

  return v_out;
end $analytics_courts_summary_0219$;

-- report_courts: re-issued from 20260925000174_event_court_blocks.sql:1461; report scope on 5 read(s)
create or replace function app.report_courts(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_courts_0219$
declare
  v_av uuid := app.analysis_venue();
  v_b       record;
  v_court   uuid;
  v_rows    jsonb;
  v_totals  jsonb;
  v_by_hour jsonb;
  v_trend   jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'courtId' and jsonb_typeof(p_filters -> 'courtId') <> 'null' then
    begin
      v_court := (p_filters ->> 'courtId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'courtId';
    end;
  end if;

  with
  b as (
    select r.id, r.court_id, r.status, r.start_at, r.end_at,
           coalesce(r.price_iqd, 0)::bigint                                   as price_iqd,
           (extract(epoch from (r.end_at - r.start_at)) / 60)::int            as mins,
           app.business_date(r.start_at, v_b.tz, v_b.start_hour)              as d,
           extract(hour from (r.start_at at time zone v_b.tz))::int           as hour,
           r.status in ('confirmed','arrived','completed')                    as live,
           rp.price_iqd                                                       as rule_price,
           (select max(p2.price_iqd)
              from rate_rules rr
              join rate_rule_prices p2 on p2.rule_id = rr.id
             where rr.venue_id = v_av and rr.is_active
               and (rr.court_id is null or rr.court_id = r.court_id)
               and p2.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int) as max_price
      from reservations r
      left join rate_rule_prices rp
             on rp.rule_id = r.rate_rule_id
            and rp.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int
     where r.venue_id = v_av and r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_court is null or r.court_id = v_court)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where c.venue_id = v_av and (v_court is null or c.id = v_court)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  oc as (
    select o.court_id, sum(o.open_minutes)::bigint as open_minutes, sum(o.event_minutes)::bigint as event_minutes
      from app.analytics_open_minutes(v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour, v_court) o
      join courts_in ci on ci.id = o.court_id
     group by o.court_id),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
           coalesce(oc.open_minutes, 0)::bigint                                as avail,
           coalesce(oc.event_minutes, 0)::bigint                               as event_minutes,
           count(b.id) filter (where b.live)                                   as bookings,
           coalesce(sum(b.mins) filter (where b.live), 0)::bigint              as booked_minutes,
           coalesce(sum(b.price_iqd) filter (where b.live), 0)::bigint         as revenue_iqd,
           count(b.id) filter (where b.status = 'cancelled')                   as cancellations,
           count(b.id) filter (where b.status = 'no_show')                     as no_shows,
           count(b.id) filter (where b.live and b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price) as peak,
           count(b.id) filter (where b.live and not (b.rule_price is not null
                                 and b.max_price is not null and b.rule_price >= b.max_price)) as off_peak
      from courts_in c
      left join oc on oc.court_id = c.id
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active, oc.open_minutes, oc.event_minutes)
  select coalesce(jsonb_agg(jsonb_build_object(
           'courtId',                    pc.id,
           'courtNameEn',                pc.name_en,
           'courtNameAr',                pc.name_ar,
           'isActive',                   pc.is_active,
           'bookings',                   pc.bookings,
           'bookedMinutes',              pc.booked_minutes,
           'availableMinutes',           pc.avail,
           'eventMinutes',               pc.event_minutes,
           'occupancyPct',               case when pc.avail > 0 then round(pc.booked_minutes * 100.0 / pc.avail, 1) end,
           'revenueIqd',                 pc.revenue_iqd,
           'revenuePerAvailableHourIqd', case when pc.avail > 0 then round(pc.revenue_iqd * 60.0 / pc.avail)::bigint end,
           'cancellations',              pc.cancellations,
           'noShows',                    pc.no_shows,
           'cancellationRatePct',        case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.cancellations * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'noShowRatePct',              case when pc.bookings + pc.cancellations + pc.no_shows > 0
                                              then round(pc.no_shows * 100.0 / (pc.bookings + pc.cancellations + pc.no_shows), 1) end,
           'peakBookings',               pc.peak,
           'offPeakBookings',            pc.off_peak
         ) order by pc.sort_order, pc.name_en, pc.id), '[]'::jsonb),
         jsonb_build_object(
           'bookings',         coalesce(sum(pc.bookings), 0)::bigint,
           'bookedMinutes',    coalesce(sum(pc.booked_minutes), 0)::bigint,
           'availableMinutes', coalesce(sum(pc.avail), 0)::bigint,
           'eventMinutes',     coalesce(sum(pc.event_minutes), 0)::bigint,
           'occupancyPct',     case when coalesce(sum(pc.avail), 0) > 0
                                    then round(coalesce(sum(pc.booked_minutes), 0) * 100.0 / sum(pc.avail), 1) end,
           'revenueIqd',       coalesce(sum(pc.revenue_iqd), 0)::bigint,
           'cancellations',    coalesce(sum(pc.cancellations), 0)::bigint,
           'noShows',          coalesce(sum(pc.no_shows), 0)::bigint,
           'peakBookings',     coalesce(sum(pc.peak), 0)::bigint,
           'offPeakBookings',  coalesce(sum(pc.off_peak), 0)::bigint)
    into v_rows, v_totals
    from per_court pc;

  -- byHour: every venue-local hour 0..23 (a chart wants the full axis).
  select jsonb_agg(jsonb_build_object('hour', h.hour, 'bookings', coalesce(x.n, 0)) order by h.hour)
    into v_by_hour
    from generate_series(0, 23) as h(hour)
    left join (
      select extract(hour from (r.start_at at time zone v_b.tz))::int as hour, count(*) as n
        from reservations r
       where r.venue_id = v_av and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x on x.hour = h.hour;

  -- trend: one entry per business day that had a live booking.
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', x.d, 'bookings', x.n, 'revenueIqd', x.rev) order by x.d), '[]'::jsonb)
    into v_trend
    from (
      select app.business_date(r.start_at, v_b.tz, v_b.start_hour) as d,
             count(*)                                             as n,
             coalesce(sum(r.price_iqd), 0)::bigint                as rev
        from reservations r
       where r.venue_id = v_av and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (v_court is null or r.court_id = v_court)
       group by 1) x;

  return jsonb_build_object(
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','courtNameEn',                'labelEn','Court',               'labelAr','الملعب',                 'kind','text'),
      jsonb_build_object('key','bookings',                   'labelEn','Bookings',            'labelAr','الحجوزات',               'kind','count'),
      jsonb_build_object('key','bookedMinutes',              'labelEn','Booked minutes',      'labelAr','الدقائق المحجوزة',       'kind','count'),
      jsonb_build_object('key','availableMinutes',           'labelEn','Available minutes',   'labelAr','الدقائق المتاحة',        'kind','count'),
      jsonb_build_object('key','eventMinutes',               'labelEn','Event minutes',       'labelAr','دقائق الفعاليات',        'kind','count'),
      jsonb_build_object('key','occupancyPct',               'labelEn','Occupancy',           'labelAr','الإشغال',                'kind','pct'),
      jsonb_build_object('key','revenueIqd',                 'labelEn','Revenue',             'labelAr','الإيراد',                'kind','money'),
      jsonb_build_object('key','revenuePerAvailableHourIqd', 'labelEn','Revenue / open hour', 'labelAr','الإيراد لكل ساعة متاحة', 'kind','money'),
      jsonb_build_object('key','cancellations',              'labelEn','Cancellations',       'labelAr','الإلغاءات',              'kind','count'),
      jsonb_build_object('key','noShows',                    'labelEn','No-shows',            'labelAr','عدم الحضور',             'kind','count'),
      jsonb_build_object('key','cancellationRatePct',        'labelEn','Cancellation rate',   'labelAr','نسبة الإلغاء',           'kind','pct'),
      jsonb_build_object('key','noShowRatePct',              'labelEn','No-show rate',        'labelAr','نسبة عدم الحضور',        'kind','pct'),
      jsonb_build_object('key','peakBookings',               'labelEn','Peak',                'labelAr','وقت الذروة',             'kind','count'),
      jsonb_build_object('key','offPeakBookings',            'labelEn','Off-peak',            'labelAr','خارج الذروة',            'kind','count')),
    'rows',       v_rows,
    'totals',     v_totals,
    'byHour',     coalesce(v_by_hour, '[]'::jsonb),
    'trend',      v_trend,
    'comparison', null);
end $report_courts_0219$;

-- unpaid_played_bookings: re-issued from 20260917000106_desk_payment.sql:1122; its day's branch
create or replace function app.unpaid_played_bookings(p_day_session_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $unpaid_played_bookings_0219$
declare
  v_day day_sessions%rowtype;
  v_out jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_day_session_id is null then
    -- 0219: the open day of the caller's branch.
    select * into v_day from day_sessions
     where venue_id = app.current_venue() and status in ('open','closing')
     order by opened_at desc limit 1;
  else
    select * into v_day from day_sessions where id = p_day_session_id;
  end if;
  if not found then
    return '[]'::jsonb;
  end if;
  if not app.is_staff_at(v_day.venue_id, 'manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'reservation_id', r.id,
           'guest_name',     r.guest_name,
           'status',         r.status,
           'start_at',       r.start_at,
           'end_at',         r.end_at,
           'court_name_en',  c.name_en,
           'court_name_ar',  c.name_ar,
           'price_iqd',      r.price_iqd,
           'remaining_iqd',  app.court_fee_remaining(r.id, null),
           'live_tab_id',    (select t.id from tabs t where t.reservation_id = r.id
                                and t.status in ('open','awaiting_payment') limit 1))
         order by r.start_at), '[]'::jsonb)
    into v_out
    from reservations r
    join courts c on c.id = r.court_id
   where r.kind = 'booking'
     and r.venue_id = v_day.venue_id
     and app.venue_business_date(v_day.venue_id, r.start_at) = v_day.business_date
     and (r.status in ('arrived','completed') or (r.status = 'confirmed' and r.end_at <= now()))
     and app.court_fee_remaining(r.id, null) > 0;

  return v_out;
end $unpaid_played_bookings_0219$;

