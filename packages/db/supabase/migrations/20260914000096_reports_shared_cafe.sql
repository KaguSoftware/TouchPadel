-- 0096_reports_shared_cafe — Reports read the cafe from the same helpers as
-- Analytics (0095), so the two screens can no longer disagree.
--
-- Before this, reports_figures / report_revenue / report_drill each carried
-- their own copy of "settled tabs' total − court" and discounts came from
-- tab_adjustments by created_at (uncapped: a 10,000 discount on a 4,000 tab
-- counted as 10,000), while report_cafe priced cost of goods from TODAY's
-- recipe cost. Now:
--   cafeRevenue / cafeIqd   Σ cafe_gross of app.cafe_settled_tabs (unchanged
--                           meaning: total − court fee, gross of refunds)
--   cafeNet / cafeNetIqd    NEW: Σ cafe_net (gross − the tab's refunds), the
--                           figure the Analytics "Cafe sales" tile shows
--   discounts               Σ STAMPED tabs.discount_iqd of the tabs settled in
--                           the window (capped at the goods, as the bill was).
--                           report_revenue's staff-attributed variant keeps
--                           reading adjustment rows, because a stamped tab
--                           discount has no single author; that variant is
--                           therefore uncapped — documented on the function.
--   refunds (figures)       from the helper: the refunds of the tabs settled
--                           in the window, on their settle day
--   report_cafe             revenue = net_line_iqd, cogs = cost_total_iqd
--                           (the snapshot), NULL when no line has one
--   report_drill            cafeRevenue rows from the helper; a cafeNet figure
--                           whose rows carry the net amount
-- report_courts moves to per-court open minutes in 0097.
--
-- covered by tests/reports.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. app.reports_figures — the headline figures, cafe via the helper.
-- ---------------------------------------------------------------------------
create or replace function app.reports_figures(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_reports_figures_0096$
declare
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
     where r.kind = 'booking'
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
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'),
  pay as (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from payments p
     where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to),
  ref as (
    select coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to),
  waste as (
    select coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost_iqd
      from stock_movements sm
     where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to)
  select jsonb_build_object(
           'revenue',       res.padel_iqd + cafe.cafe_iqd,
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
end $fn_reports_figures_0096$;

-- ---------------------------------------------------------------------------
-- 2. app.panel_headline — 0068 body + the cafeNet key.
-- ---------------------------------------------------------------------------
create or replace function app.panel_headline(p_from date, p_to date, p_compare text default 'none')
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_panel_headline_0096$
declare
  v_b        record;
  v_cur      jsonb;
  v_prev     jsonb;
  v_cmp_from date;
  v_cmp_to   date;
  v_len      int;
  v_keys     text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','bookings',
                             'orders','avgOrderValue','discounts','refunds','waste','noShows'];
  v_figures  jsonb;
begin
  perform app.reports_guard(true);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_compare is null or p_compare not in ('previousPeriod','sameLastYear','none') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_compare', hint = 'p_compare must be ''previousPeriod'', ''sameLastYear'' or ''none''';
  end if;

  v_cur := app.reports_figures(p_from, p_to);

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
    'figures',    coalesce(v_figures, '[]'::jsonb));
end $fn_panel_headline_0096$;

-- ---------------------------------------------------------------------------
-- 3. app.report_revenue — cafe via the helper, bucketed by SETTLE day;
--    cafeNetIqd added; discounts stamped (see header for the staff variant).
-- ---------------------------------------------------------------------------
create or replace function app.report_revenue(
  p_from    date,
  p_to      date,
  p_group   text default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_revenue_0096$
declare
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
     where r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
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
     where (v_method is null or exists (select 1 from payments p where p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.tab_id = s.tab_id and p.recorded_by = v_staff))
     group by 1),
  ord as (
    select app.reports_bucket(app.business_date(o.placed_at, v_b.tz, v_b.start_hour), p_group) as b,
           count(*) as orders
      from orders o
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and (v_staff is null or o.placed_by_staff_id = v_staff)
     group by 1),
  pay as (
    select app.reports_bucket(app.business_date(p.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from payments p
     where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
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
     where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
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
     where l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
       and (v_staff is null or l.actor_id = v_staff)
     group by 1),
  buckets as (
    select b from res union select b from cafe union select b from ord union select b from pay
    union select b from ref union select b from adj union select b from vd),
  rows_ as (
    select buckets.b                                                          as period,
           coalesce(res.padel_iqd, 0)                                         as padel_iqd,
           coalesce(cafe.cafe_iqd, 0)                                         as cafe_iqd,
           coalesce(cafe.cafe_net_iqd, 0)                                     as cafe_net_iqd,
           coalesce(res.padel_iqd, 0) + coalesce(cafe.cafe_iqd, 0)            as total_iqd,
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
end $fn_report_revenue_0096$;

-- ---------------------------------------------------------------------------
-- 4. app.report_cafe — NET line revenue, cost of goods from the line
--    snapshot (cost_total_iqd), NULL (never 0) when no line carries one.
-- ---------------------------------------------------------------------------
create or replace function app.report_cafe(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_cafe_0096$
declare
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
     where v_cat is null or mi.category_id = v_cat),
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
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and (v_cat is null or exists (
             select 1 from order_items oi join menu_items mi on mi.id = oi.menu_item_id
              where oi.order_id = o.id and not oi.voided and mi.category_id = v_cat)))
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
       where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
         and sm.qty_delta < 0
         and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
       group by 1) x;

  select jsonb_build_object(
           'avgSeconds', round(avg(t.actual_prep_seconds))::int,
           'p90Seconds', round(percentile_cont(0.9) within group (order by t.actual_prep_seconds))::int,
           'count',      count(*))
    into v_prep
    from tickets t
   where t.actual_prep_seconds is not null
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
end $fn_report_cafe_0096$;

-- ---------------------------------------------------------------------------
-- 5. app.report_drill — 0068 body with the cafe rows read from the helper and
--    a cafeNet figure (owner-only, like the other money figures).
-- ---------------------------------------------------------------------------
create or replace function app.report_drill(
  p_figure text,
  p_key    text,
  p_from   date,
  p_to     date
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_drill_0096$
declare
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
           case
             when r.status in ('confirmed','arrived','completed') then array['bookings','revenue','padelRevenue']
             when r.status = 'no_show'   then array['noShows']
             when r.status = 'cancelled' then array['cancellations']
             else array[]::text[]
           end                                                         as tags
      from reservations r
      join courts c on c.id = r.court_id
      left join profiles pr on pr.id = r.guest_id
     where r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
    union all
    -- Settled tabs from the shared helper: the cafe part, gross of refunds.
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_gross_iqd,
           coalesce((select p.recorded_by from payments p where p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           array['revenue','cafeRevenue']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- The same tabs, net of their refunds, for the cafeNet figure.
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_net_iqd,
           coalesce((select p.recorded_by from payments p where p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           array['cafeNet']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- Payments by method.
    select p.id::text, p.created_at, 'payment',
           p.method::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           p.amount_iqd::bigint, p.recorded_by, p.tab_id::text, null::uuid, null::uuid,
           array[p.method::text]
      from payments p
      join tabs t on t.id = p.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
    union all
    -- Refunds (money out; also net off cash/card).
    select r.id::text, r.created_at, 'refund',
           'refund · ' || r.reason_code || ' · ' || p.method::text,
           r.amount_iqd::bigint, r.refunded_by, p.tab_id::text, null::uuid, null::uuid,
           array['refunds', p.method::text]
      from refunds r
      join payments p on p.id = r.payment_id
     where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union all
    -- Discounts / price overrides.
    select a.id::text, a.created_at, 'adjustment',
           a.kind::text || ' · ' || a.reason_code,
           a.amount_iqd::bigint, a.applied_by, a.tab_id::text, null::uuid,
           (select oi.menu_item_id from order_items oi where oi.id = a.order_item_id),
           array['discounts']
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
    union all
    -- Voids, from the audit trail (the only timestamped record of a void).
    select l.id::text, l.at, 'adjustment',
           'void · ' || coalesce(l.reason_code, '') || ' · ' || coalesce(mi.name_en, ''),
           coalesce((l.after ->> 'line_total_iqd')::bigint, 0), l.actor_id, l.entity_id,
           null::uuid, mi.id,
           array['voids']
      from audit_log l
      left join menu_items mi on mi.id::text = (l.after ->> 'menu_item_id')
     where l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
    union all
    -- Waste movements.
    select sm.id::text, sm.at, 'waste',
           i.name_en || ' · ' || coalesce(sm.reason_code, sm.movement_type::text)
             || ' · ' || (-sm.qty_delta)::text || ' ' || i.unit::text,
           coalesce(round(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0)), 0)::bigint,
           sm.staff_id, sm.id::text, null::uuid, null::uuid,
           array['waste']
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
    union all
    -- Orders (non-voided), amount = live line total.
    select o.id::text, o.placed_at, 'tab',
           'order · ' || o.source::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           coalesce((select sum(oi.line_total_iqd) from order_items oi
                      where oi.order_id = o.id and not oi.voided), 0)::bigint,
           o.placed_by_staff_id, o.tab_id::text, null::uuid, null::uuid,
           array['orders']
      from orders o
      join tabs t on t.id = o.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
    union all
    -- Settled lines, for the item scope only (net of discounts and refunds).
    select l.order_item_id::text, l.placed_at, 'tab',
           mi.name_en || ' × ' || l.qty::text,
           l.net_line_iqd, o.placed_by_staff_id, l.tab_id::text, null::uuid, l.menu_item_id,
           array['lines']
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join orders o on o.id = l.order_id
      join menu_items mi on mi.id = l.menu_item_id
     where v_item is not null),
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
           'reference', p.reference
         ) order by p.at desc, p.id desc), '[]'::jsonb)
    into v_out
    from picked p
    left join staff s on s.id = p.staff_id;

  return jsonb_build_object(
    'figure',       p_figure,
    'key',          p_key,
    'period',       jsonb_build_object('from', p_from, 'to', p_to),
    'transactions', v_out);
end $fn_report_drill_0096$;

-- ---------------------------------------------------------------------------
-- 6. Grants restated.
-- ---------------------------------------------------------------------------
revoke all on function app.reports_figures(date, date) from public, anon, authenticated;
grant execute on function app.reports_figures(date, date) to service_role;

revoke all on function app.panel_headline(date, date, text) from public, anon;
grant execute on function app.panel_headline(date, date, text) to authenticated;

revoke all on function app.report_revenue(date, date, text, jsonb) from public, anon;
grant execute on function app.report_revenue(date, date, text, jsonb) to authenticated;

revoke all on function app.report_cafe(date, date, jsonb) from public, anon;
grant execute on function app.report_cafe(date, date, jsonb) to authenticated;

revoke all on function app.report_drill(text, text, date, date) from public, anon;
grant execute on function app.report_drill(text, text, date, date) to authenticated;
