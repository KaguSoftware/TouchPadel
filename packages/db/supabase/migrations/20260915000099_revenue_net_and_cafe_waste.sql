-- 0099_revenue_net_and_cafe_waste — one revenue, and waste in Analytics.
--
-- 1. Revenue counts the cafe AFTER refunds everywhere. Before this, the
--    panel's revenue headline, report_revenue's totalIqd and the revenue
--    drill added the cafe gross of refunds, while the Analytics "Venue
--    revenue" tile adds it net — so the owner saw two different totals for
--    the same window. Now:
--      reports_figures.revenue      padelRevenue + cafeNet
--      report_revenue.totalIqd      padelIqd + cafeNetIqd
--      report_drill 'revenue'       the bookings plus the NET tab rows
--    cafeRevenue / cafeIqd keep their meaning (gross of refunds), and so does
--    avgOrderValue, which divides the gross cafe by orders.
--
-- 2. app.analytics_daily_sales gains waste_iqd per business day: the stock
--    movements the panel's waste figure reads, costed the same way, so the
--    Analytics Cafe tab can show waste that adds up to the panel's.
--    A day with only waste appears as a row with zero sales; the page's
--    coverage counts a day only when it has revenue or orders, so this does
--    not change what counts as a trading day.
--
-- covered by tests/reports.test.ts and tests/analytics.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. app.reports_figures — revenue = padel + cafe net.
-- ---------------------------------------------------------------------------
create or replace function app.reports_figures(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_reports_figures_0099$
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
end $fn_reports_figures_0099$;

-- ---------------------------------------------------------------------------
-- 2. app.report_revenue — totalIqd = padel + cafe net.
-- ---------------------------------------------------------------------------
create or replace function app.report_revenue(
  p_from    date,
  p_to      date,
  p_group   text default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_revenue_0099$
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
end $fn_report_revenue_0099$;

-- ---------------------------------------------------------------------------
-- 3. app.report_drill — the revenue figure lists the net tab rows.
-- ---------------------------------------------------------------------------
create or replace function app.report_drill(
  p_figure text,
  p_key    text,
  p_from   date,
  p_to     date
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_drill_0099$
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
    -- 0099: only the cafeRevenue figure lists these; revenue lists the net twin.
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_gross_iqd,
           coalesce((select p.recorded_by from payments p where p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
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
           coalesce((select p.recorded_by from payments p where p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           array['revenue','cafeNet']
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
end $fn_report_drill_0099$;

-- ---------------------------------------------------------------------------
-- 4. app.analytics_daily_sales — waste_iqd per business day.
-- ---------------------------------------------------------------------------
create or replace function app.analytics_daily_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_analytics_daily_sales_0099$
declare
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
      left join lateral (select sum(rf.amount_iqd) as refunded from refunds rf where rf.payment_id = p.id) r on true
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
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
     group by 1),
  calls as (
    select app.business_date(w.raised_at, v_b.tz, v_b.start_hour) as d,
           count(*) as waiter_calls
      from waiter_calls w
     where w.raised_at >= v_b.ts_from and w.raised_at < v_b.ts_to
     group by 1),
  -- 0099: stock written off, at its movement cost, on the day it was written
  -- off. The same rows and arithmetic as the panel's waste figure
  -- (app.reports_figures), bucketed by business day.
  waste as (
    select app.business_date(sm.at, v_b.tz, v_b.start_hour) as d,
           coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as waste_iqd
      from stock_movements sm
     where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
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
end $fn_analytics_daily_sales_0099$;

-- ---------------------------------------------------------------------------
-- 5. Grants restated.
-- ---------------------------------------------------------------------------
revoke all on function app.reports_figures(date, date) from public, anon, authenticated;
grant execute on function app.reports_figures(date, date) to service_role;

revoke all on function app.report_revenue(date, date, text, jsonb) from public, anon;
grant execute on function app.report_revenue(date, date, text, jsonb) to authenticated;

revoke all on function app.report_drill(text, text, date, date) from public, anon;
grant execute on function app.report_drill(text, text, date, date) to authenticated;

revoke all on function app.analytics_daily_sales(date, date) from public, anon;
grant execute on function app.analytics_daily_sales(date, date) to authenticated;
