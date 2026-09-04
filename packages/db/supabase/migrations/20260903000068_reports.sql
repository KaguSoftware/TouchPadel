-- 0068_reports — read-only jsonb overviews and reports for the operator desktop
-- (build plan §4 "0068 reports and overviews"; spec screens 06.21, 06.39–06.44).
--
-- Posture
--  * Every client-callable function here is `stable security definer`, returns
--    jsonb, and runs the same prologue: app.reports_guard(owner_only) FIRST
--    (FORBIDDEN unless manager/owner — or owner alone for the financial
--    surfaces) -> app.analytics_bounds() (INVALID_RANGE) -> argument enums
--    (INVALID_ARGUMENT) -> aggregate. Nothing here writes: no audit rows, no
--    side effects, no temp state.
--  * Business day: app.business_date / app.analytics_bounds (0034) are reused
--    verbatim, never reimplemented. Which timestamp buckets a row:
--      reservations       start_at          (the slot's day, for every status)
--      settled tabs       settled_at
--      orders             placed_at
--      payments/refunds   created_at
--      tab_adjustments    created_at
--      voids              audit_log.at      (action 'order_item.void')
--      waste              stock_movements.at
--      day closes         closed_at
--  * Money (integer IQD, bigint):
--      padel revenue  = reservations.price_iqd of kind 'booking' in status
--                       confirmed / arrived / completed
--      cafe revenue   = settled tabs' total_iqd - court_iqd. A tab charged to a
--                       booking carries the court on its total (0053); the
--                       court is already counted as padel revenue, so it is
--                       taken back out here — revenue = padel + cafe, never
--                       the court twice.
--      cash / card    = payments - refunds by payments.method (0034 posture;
--                       reconciles with app.close_day)
--      discounts      = tab_adjustments.amount_iqd, every kind (as day close)
--      voids          = line_total_iqd of the voided line, read from the
--                       'order_item.void' audit row (the only timestamped
--                       record of a void)
--      refunds        = refunds.amount_iqd
--      waste          = stock_movements of type waste_spill / waste_spoilage /
--                       void_after_send / expired_writeoff, cost =
--                       round(sum(-qty_delta * unit_cost_iqd)) — the same set
--                       v_day_close_summary uses
--      avgOrderValue  = cafe revenue / non-voided orders, whole IQD
--  * Courts: availableMinutes = Σ over the calendar dates in range that are
--    not in venue_settings.closed_dates of the opening_hours windows for that
--    weekday (venue_settings.opening_hours, the 0026 assert_bookable shape:
--    {"mon":[["00:00","02:00"],["09:00","24:00"]],…}). One set of hours for
--    every court — no per-court hours exist. Peak / off-peak: rate_rules has
--    no peak flag, so a booking is PEAK when its rate rule's price for the
--    booked duration equals the highest active price for that duration among
--    the rules that apply to its court; anything else (cheaper rule, retired
--    rule, manual price with no rule) is off-peak.
--  * Staff activity (06.44) is activity and exceptions: rows are ordered by
--    display name, carry no rank, no score, no sort by volume.
--  * report_drill: amountIqd is a magnitude; `kind` says the direction
--    (refund / adjustment / waste are money out). Cap 500, newest first.
--
-- Depends on: 0034 (business_date, analytics_bounds, analytics_sales_lines),
-- 0019 views (v_ingredient_on_hand, v_variance_report, v_item_cogs,
-- v_expiring_soon, v_expired), 0053 tabs.court_iqd, 0061
-- tickets.actual_prep_seconds. Additive only: new app.* functions, no tables,
-- no enum edits. Every error is `raise exception '<CODE>' using errcode = 'P0001'`.
--
-- covered by packages/db/tests/reports.test.ts

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Internal helpers (never client-callable)
-- ---------------------------------------------------------------------------

-- Shared gate. p_owner_only = true narrows to the owner (financial surfaces).
create or replace function app.reports_guard(p_owner_only boolean default false)
returns void
language plpgsql stable security definer set search_path = public as $fn_reports_guard_0068$
begin
  if p_owner_only then
    if not app.is_staff('owner') then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  elsif not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
end $fn_reports_guard_0068$;

-- Period bucket for report_revenue: day = the date, week = ISO Monday,
-- month = the 1st.
create or replace function app.reports_bucket(p_d date, p_group text)
returns date
language sql immutable parallel safe as $fn_reports_bucket_0068$
  select case p_group
           when 'day'   then p_d
           when 'week'  then date_trunc('week', p_d::timestamp)::date
           when 'month' then date_trunc('month', p_d::timestamp)::date
         end
$fn_reports_bucket_0068$;

-- Open minutes across [p_from, p_to] from venue_settings.opening_hours,
-- skipping closed_dates. Each window is measured from its own day's local
-- midnight (0026), so ["00:00","02:00"] + ["09:00","24:00"] = 17 h per day.
create or replace function app.reports_available_minutes(p_from date, p_to date)
returns bigint
language sql stable security definer set search_path = public as $fn_reports_avail_0068$
  select coalesce(sum(
           (extract(epoch from (w ->> 1)::interval) - extract(epoch from (w ->> 0)::interval)) / 60
         ), 0)::bigint
    from venue_settings vs
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    cross join lateral jsonb_array_elements(
      coalesce(vs.opening_hours -> lower(to_char(d, 'Dy')), '[]'::jsonb)) w
   where not (d::date = any (coalesce(vs.closed_dates, '{}')))
$fn_reports_avail_0068$;

-- The headline figures for one range, as {key: value}. Shared by
-- panel_headline (current + comparison period).
create or replace function app.reports_figures(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_reports_figures_0068$
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
    select coalesce(sum(coalesce(t.total_iqd, 0) - t.court_iqd), 0)::bigint as cafe_iqd
      from tabs t
     where t.status = 'settled'
       and t.settled_at >= v_b.ts_from and t.settled_at < v_b.ts_to),
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
    select coalesce(sum(r.amount_iqd), 0)::bigint                                   as refunds_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to),
  adj as (
    select coalesce(sum(a.amount_iqd), 0)::bigint as discounts_iqd
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to),
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
           'cash',          pay.cash_iqd - ref.cash_iqd,
           'card',          pay.card_iqd - ref.card_iqd,
           'bookings',      res.bookings,
           'orders',        ord.orders,
           'avgOrderValue', case when ord.orders > 0
                                 then round(cafe.cafe_iqd::numeric / ord.orders)::bigint
                                 else 0 end,
           'discounts',     adj.discounts_iqd,
           'refunds',       ref.refunds_iqd,
           'waste',         waste.cost_iqd,
           'noShows',       res.no_shows)
    into v_out
    from res, cafe, ord, pay, ref, adj, waste;

  return v_out;
end $fn_reports_figures_0068$;

-- Parse a drill scope 'court:<uuid>' | 'item:<uuid>' | 'staff:<uuid>'.
-- Returns (kind, id); kind NULL when the text is not a scope.
create or replace function app.reports_parse_scope(p_text text, out kind text, out id uuid)
language plpgsql immutable as $fn_reports_scope_0068$
begin
  kind := null; id := null;
  if p_text is null then return; end if;
  if p_text ~ '^(court|item|staff):[0-9a-fA-F-]{36}$' then
    kind := split_part(p_text, ':', 1);
    begin
      id := split_part(p_text, ':', 2)::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = p_text, hint = 'scope id must be a uuid';
    end;
  end if;
end $fn_reports_scope_0068$;

-- ---------------------------------------------------------------------------
-- 2. app.ops_overview — manager/owner. The manager's landing screen (06.21):
--    today's business day at a glance.
-- ---------------------------------------------------------------------------
create or replace function app.ops_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_ops_overview_0068$
declare
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
     where kind = 'booking'
       and start_at >= v_b.ts_from and start_at < v_b.ts_to)
  select jsonb_build_object(
           'today',          (select count(*) from r where status in ('confirmed','arrived','completed')),
           'arrived',        (select count(*) from r where status = 'arrived'),
           'upcoming',       (select count(*) from r where status = 'confirmed' and start_at > v_now),
           'noShows',        (select count(*) from r where status = 'no_show'),
           'cancelledToday', (select count(*) from reservations
                               where kind = 'booking' and status = 'cancelled'
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
                               where r.status = 'confirmed' and r.end_at > v_now
                               order by r.start_at, r.id
                               limit 1))
    into v_bookings;

  -- Cafe -------------------------------------------------------------------
  select jsonb_build_object(
           'openTabs',         (select count(*) from tabs where status in ('open','awaiting_payment')),
           'ticketsQueued',    (select count(*) from tickets where status = 'queued'),
           'ticketsPreparing', (select count(*) from tickets where status = 'preparing'),
           'ticketsLate',      (select count(*) from tickets
                                 where status in ('queued','preparing')
                                   and v_now - created_at > make_interval(secs => target_seconds)),
           'waiterCallsOpen',  (select count(*) from waiter_calls where status in ('raised','acknowledged')),
           'ordersToday',      (select count(*) from orders
                                 where placed_at >= v_b.ts_from and placed_at < v_b.ts_to
                                   and status <> 'voided'))
    into v_cafe;

  -- Stock ------------------------------------------------------------------
  select jsonb_build_object(
           'low',          (select count(*) from v_ingredient_on_hand
                             where is_active and low_stock_threshold is not null
                               and on_hand <= low_stock_threshold),
           'belowPar',     (select count(*) from v_ingredient_on_hand
                             where is_active and par_level is not null and on_hand < par_level),
           'expiringSoon', (select count(*) from v_expiring_soon),
           'expired',      (select count(*) from v_expired),
           'lastCountAt',  (select max(finalized_at) from stock_counts),
           'openAlerts',   (select count(*) from manager_alerts where acknowledged_at is null))
    into v_stock;

  -- Staff activity today (activity, not a ranking: ordered by name) ---------
  with
  ord as (
    select o.placed_by_staff_id as staff_id, count(*) as n
      from orders o
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided' and o.placed_by_staff_id is not null
     group by 1),
  bk as (
    select r.created_by_staff_id as staff_id, count(*) as n
      from reservations r
     where r.kind = 'booking' and r.created_by_staff_id is not null
       and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  pay as (
    select p.recorded_by as staff_id, count(*) as n
      from payments p
     where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
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
                          where action = 'order_item.void'
                            and at >= v_b.ts_from and at < v_b.ts_to),
           'refunds',   (select jsonb_build_object('count', count(*), 'amountIqd', coalesce(sum(amount_iqd), 0)::bigint)
                           from refunds
                          where created_at >= v_b.ts_from and created_at < v_b.ts_to),
           'waste',     (select jsonb_build_object('count', count(*),
                                                   'costIqd', coalesce(round(sum(-qty_delta * coalesce(unit_cost_iqd, 0))), 0)::bigint)
                           from stock_movements
                          where movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
                            and qty_delta < 0
                            and at >= v_b.ts_from and at < v_b.ts_to))
    into v_exc;

  -- Day close --------------------------------------------------------------
  select * into v_day from day_sessions
   where status in ('open','closing')
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
                where t.day_session_id = v_day.id
                  and t.status in ('open','awaiting_payment')), '[]'::jsonb),
             'expectedCashIqd', (
               v_day.opening_float_iqd
               + coalesce((select sum(p.amount_iqd) from payments p
                            where p.day_session_id = v_day.id and p.method = 'cash'), 0)
               - coalesce((select sum(rf.amount_iqd) from refunds rf
                             join payments p on p.id = rf.payment_id
                            where p.day_session_id = v_day.id and p.method = 'cash'), 0))::bigint)
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
end $fn_ops_overview_0068$;

-- ---------------------------------------------------------------------------
-- 3. app.panel_headline — OWNER only (06.39). Headline figures with an
--    optional comparison period. changePct is NULL when previous is 0/NULL.
-- ---------------------------------------------------------------------------
create or replace function app.panel_headline(p_from date, p_to date, p_compare text default 'none')
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_panel_headline_0068$
declare
  v_b        record;
  v_cur      jsonb;
  v_prev     jsonb;
  v_cmp_from date;
  v_cmp_to   date;
  v_len      int;
  v_keys     text[] := array['revenue','padelRevenue','cafeRevenue','cash','card','bookings',
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
end $fn_panel_headline_0068$;

-- ---------------------------------------------------------------------------
-- 4. app.report_revenue — OWNER only (06.40). One row per period bucket.
--    Filters (p_filters): paymentMethod 'cash'|'card' scopes payments,
--    refunds and the settled tabs that carry a payment of that method
--    (reservations carry no payment method and are unaffected); staffId
--    scopes each source to that member (reservations created, tabs settled
--    with a payment they recorded, payments recorded, orders placed,
--    adjustments applied, refunds issued, voids performed).
-- ---------------------------------------------------------------------------
create or replace function app.report_revenue(
  p_from    date,
  p_to      date,
  p_group   text default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_revenue_0068$
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
    select app.reports_bucket(app.business_date(t.settled_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(coalesce(t.total_iqd, 0) - t.court_iqd), 0)::bigint as cafe_iqd,
           coalesce(sum(t.tax_iqd), 0)::bigint                               as tax_iqd
      from tabs t
     where t.status = 'settled'
       and t.settled_at >= v_b.ts_from and t.settled_at < v_b.ts_to
       and (v_method is null or exists (select 1 from payments p where p.tab_id = t.id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.tab_id = t.id and p.recorded_by = v_staff))
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
  adj as (
    select app.reports_bucket(app.business_date(a.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(a.amount_iqd), 0)::bigint as discounts_iqd
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
       and (v_staff is null or a.applied_by = v_staff)
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
           coalesce(res.padel_iqd, 0) + coalesce(cafe.cafe_iqd, 0)            as total_iqd,
           coalesce(pay.cash_iqd, 0) - coalesce(ref.cash_iqd, 0)              as cash_iqd,
           coalesce(pay.card_iqd, 0) - coalesce(ref.card_iqd, 0)              as card_iqd,
           coalesce(adj.discounts_iqd, 0)                                     as discounts_iqd,
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
end $fn_report_revenue_0068$;

-- ---------------------------------------------------------------------------
-- 5. app.report_courts — manager/owner (06.41). One row per court (active
--    courts, plus any retired court that still has bookings in range).
--    Cancellations and no-shows sit on the SLOT's business day (start_at),
--    so a row answers "what happened to this day's court time".
--    Filters: courtId.
-- ---------------------------------------------------------------------------
create or replace function app.report_courts(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_courts_0068$
declare
  v_b       record;
  v_court   uuid;
  v_avail   bigint;
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

  v_avail := app.reports_available_minutes(p_from, p_to);

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
             where rr.is_active
               and (rr.court_id is null or rr.court_id = r.court_id)
               and p2.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int) as max_price
      from reservations r
      left join rate_rule_prices rp
             on rp.rule_id = r.rate_rule_id
            and rp.duration_min = (extract(epoch from (r.end_at - r.start_at)) / 60)::int
     where r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_court is null or r.court_id = v_court)),
  courts_in as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active
      from courts c
     where (v_court is null or c.id = v_court)
       and (c.is_active or exists (select 1 from b where b.court_id = c.id))),
  per_court as (
    select c.id, c.name_en, c.name_ar, c.sort_order, c.is_active,
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
      left join b on b.court_id = c.id
     group by c.id, c.name_en, c.name_ar, c.sort_order, c.is_active)
  select coalesce(jsonb_agg(jsonb_build_object(
           'courtId',                    pc.id,
           'courtNameEn',                pc.name_en,
           'courtNameAr',                pc.name_ar,
           'isActive',                   pc.is_active,
           'bookings',                   pc.bookings,
           'bookedMinutes',              pc.booked_minutes,
           'availableMinutes',           v_avail,
           'occupancyPct',               case when v_avail > 0 then round(pc.booked_minutes * 100.0 / v_avail, 1) end,
           'revenueIqd',                 pc.revenue_iqd,
           'revenuePerAvailableHourIqd', case when v_avail > 0 then round(pc.revenue_iqd * 60.0 / v_avail)::bigint end,
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
           'availableMinutes', (coalesce(count(pc.id), 0) * v_avail)::bigint,
           'occupancyPct',     case when count(pc.id) * v_avail > 0
                                    then round(coalesce(sum(pc.booked_minutes), 0) * 100.0 / (count(pc.id) * v_avail), 1) end,
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
       where r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
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
       where r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
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
end $fn_report_courts_0068$;

-- ---------------------------------------------------------------------------
-- 6. app.report_cafe — manager/owner (06.42). Settled lines only (money
--    truth, 0034 'settled' basis); cogs from v_item_cogs per variant × qty,
--    NULL (never 0) for items with no recipe. prepTimes come from
--    tickets.actual_prep_seconds (0061) — the venue has one prep station, so
--    a single bucket. Filters: categoryId.
-- ---------------------------------------------------------------------------
create or replace function app.report_cafe(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_cafe_0068$
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
    select l.order_id, l.menu_item_id, l.variant_id, l.qty, l.line_total_iqd,
           mi.category_id,
           case when vc.cogs_iqd is not null then vc.cogs_iqd * l.qty end as cogs
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join menu_items mi on mi.id = l.menu_item_id
      left join v_item_cogs vc on vc.variant_id = l.variant_id
     where v_cat is null or mi.category_id = v_cat),
  per_item as (
    select l.menu_item_id, l.category_id,
           sum(l.qty)::bigint                          as qty,
           sum(l.line_total_iqd)::bigint               as revenue_iqd,
           case when bool_or(l.cogs is not null)
                then round(sum(l.cogs))::bigint end    as cogs_iqd,
           count(distinct l.order_id)                  as orders
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
end $fn_report_cafe_0068$;

-- ---------------------------------------------------------------------------
-- 7. app.report_stock — manager/owner (06.43). Value on hand is live batches
--    at their own unit cost; low / par / expiry lists are CURRENT state (not
--    ranged); consumption and variance are ranged. Filters: ingredientId
--    (consumption + variance).
-- ---------------------------------------------------------------------------
create or replace function app.report_stock(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_stock_0068$
declare
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
   where b.qty_remaining > 0;

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
   where v.is_active and v.low_stock_threshold is not null and v.on_hand <= v.low_stock_threshold;

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
   where v.is_active and v.par_level is not null and v.on_hand < v.par_level;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysLeft',     e.days_left,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_soon
    from v_expiring_soon e;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysExpired',  e.days_expired,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_expired
    from v_expired e;

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
       where sm.movement_type in ('sale_consumption','production_consume')
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
           'expiredQty',       r.expired_qty
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
end $fn_report_stock_0068$;

-- ---------------------------------------------------------------------------
-- 8. app.report_staff_activity — manager/owner (06.44). Activity and
--    exceptions per staff member, ordered by name. NO rank, NO score, no
--    sort by volume. Every active member appears (zeros included) plus any
--    retired member with activity in range; p_staff_id narrows to one.
--    shiftContext gives the reader the scale of the period: daysWorked =
--    distinct business days with any recorded activity, busiestDayOrders =
--    the most orders they took on one business day.
-- ---------------------------------------------------------------------------
create or replace function app.report_staff_activity(
  p_from     date,
  p_to       date,
  p_staff_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_staff_0068$
declare
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
     where o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided' and o.placed_by_staff_id is not null
     group by 1, 2),
  ord_s as (
    select staff_id, sum(n)::bigint as n, max(n)::bigint as busiest from ord group by staff_id),
  bk as (
    select r.created_by_staff_id as staff_id, count(*) as n
      from reservations r
     where r.kind = 'booking' and r.created_by_staff_id is not null
       and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  pay as (
    select p.recorded_by as staff_id, count(*) as n
      from payments p
     where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
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
     where l.action = 'order_item.void' and l.actor_id is not null
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
     group by 1),
  ref as (
    select r.refunded_by as staff_id, count(*) as n, coalesce(sum(r.amount_iqd), 0)::bigint as amt
      from refunds r
     where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  wc as (
    select w.acknowledged_by as staff_id, count(*) as n,
           round(avg(extract(epoch from (w.acknowledged_at - w.raised_at))))::int as avg_s
      from waiter_calls w
     where w.acknowledged_by is not null and w.acknowledged_at is not null
       and w.acknowledged_at >= v_b.ts_from and w.acknowledged_at < v_b.ts_to
     group by 1),
  dc as (
    select d.closed_by as staff_id,
           jsonb_agg(jsonb_build_object('businessDate', d.business_date,
                                        'cashVarianceIqd', d.cash_variance_iqd::bigint)
                     order by d.business_date) as closes
      from day_sessions d
     where d.closed_by is not null and d.closed_at is not null
       and d.closed_at >= v_b.ts_from and d.closed_at < v_b.ts_to
     group by 1),
  acts as (
    select staff_id, d from ord
    union select r.created_by_staff_id, app.business_date(r.created_at, v_b.tz, v_b.start_hour)
            from reservations r
           where r.kind = 'booking' and r.created_by_staff_id is not null
             and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union select p.recorded_by, app.business_date(p.created_at, v_b.tz, v_b.start_hour)
            from payments p where p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
    union select a.applied_by, app.business_date(a.created_at, v_b.tz, v_b.start_hour)
            from tab_adjustments a where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
    union select l.actor_id, app.business_date(l.at, v_b.tz, v_b.start_hour)
            from audit_log l where l.action = 'order_item.void' and l.actor_id is not null
             and l.at >= v_b.ts_from and l.at < v_b.ts_to
    union select r.refunded_by, app.business_date(r.created_at, v_b.tz, v_b.start_hour)
            from refunds r where r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union select w.acknowledged_by, app.business_date(w.acknowledged_at, v_b.tz, v_b.start_hour)
            from waiter_calls w where w.acknowledged_by is not null and w.acknowledged_at is not null
             and w.acknowledged_at >= v_b.ts_from and w.acknowledged_at < v_b.ts_to
    union select d.closed_by, d.business_date
            from day_sessions d where d.closed_by is not null and d.closed_at is not null
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
end $fn_report_staff_0068$;

-- ---------------------------------------------------------------------------
-- 9. app.report_drill — manager/owner; OWNER only for the financial figures
--    (revenue, padelRevenue, cafeRevenue, cash, card). The transactions
--    behind a figure, newest first, capped at 500.
--
--    p_figure: 'revenue' | 'padelRevenue' | 'cafeRevenue' | 'cash' | 'card'
--              | 'discounts' | 'refunds' | 'voids' | 'waste' | 'noShows'
--              | 'bookings' | 'orders' | 'cancellations'
--              or a scope on its own: 'court:<uuid>' (that court's bookings),
--              'item:<uuid>' (that item's settled lines), 'staff:<uuid>'
--              (everything attributed to that member).
--    p_key:    optional extra scope in the same 'court:|item:|staff:' form,
--              applied on top of the figure (e.g. figure 'bookings' + key
--              'court:<uuid>'). Pass null for none.
--    Row: {id, at, kind, label, amountIqd, staffName, reference}. amountIqd is
--    a magnitude; kind = reservation|tab|payment|refund|adjustment|waste.
-- ---------------------------------------------------------------------------
create or replace function app.report_drill(
  p_figure text,
  p_key    text,
  p_from   date,
  p_to     date
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_drill_0068$
declare
  v_b        record;
  v_tag      text;
  v_scope    record;
  v_key      record;
  v_court    uuid;
  v_item     uuid;
  v_staff    uuid;
  v_out      jsonb;
  v_figures  text[] := array['revenue','padelRevenue','cafeRevenue','cash','card','discounts',
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
  if v_tag in ('revenue','padelRevenue','cafeRevenue','cash','card') then
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
    -- Settled tabs (cafe part only; the court is on the reservation row).
    select t.id::text, t.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           (coalesce(t.total_iqd, 0) - t.court_iqd)::bigint,
           coalesce((select p.recorded_by from payments p where p.tab_id = t.id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           t.id::text, null::uuid, null::uuid,
           array['revenue','cafeRevenue']
      from tabs t
      left join cafe_tables ct on ct.id = t.table_id
     where t.status = 'settled'
       and t.settled_at >= v_b.ts_from and t.settled_at < v_b.ts_to
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
    -- Settled lines, for the item scope only.
    select l.order_item_id::text, l.placed_at, 'tab',
           mi.name_en || ' × ' || l.qty::text,
           l.line_total_iqd, o.placed_by_staff_id, l.tab_id::text, null::uuid, l.menu_item_id,
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
       -- (plus voids of it), a member their actions (not the duplicate lines).
       and (v_tag is not null
            or (v_scope.kind = 'court' and 'lines' <> all (tx.tags))
            or (v_scope.kind = 'item'  and ('lines' = any (tx.tags) or 'voids' = any (tx.tags)))
            or (v_scope.kind = 'staff' and 'lines' <> all (tx.tags)))
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
end $fn_report_drill_0068$;

-- ---------------------------------------------------------------------------
-- 10. app.audit_log_page — manager/owner. Server-side filtered page of the
--     audit trail with actor / authorizer display names (06.44 "audit-log
--     view filtered to one person or one action type"). p_from / p_to are
--     wall-clock bounds (null = open); p_action_prefix matches
--     `action like prefix || '%'`.
-- ---------------------------------------------------------------------------
create or replace function app.audit_log_page(
  p_from          timestamptz,
  p_to            timestamptz,
  p_actor_id      uuid default null,
  p_action_prefix text default null,
  p_limit         int  default 200,
  p_offset        int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_audit_log_page_0068$
declare
  v_total bigint;
  v_rows  jsonb;
begin
  perform app.reports_guard(false);
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_limit', hint = 'p_limit must be between 1 and 1000';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_offset';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from audit_log l
   where (p_from is null or l.at >= p_from)
     and (p_to   is null or l.at <  p_to)
     and (p_actor_id is null or l.actor_id = p_actor_id or l.authorizer_id = p_actor_id)
     and (p_action_prefix is null or l.action like p_action_prefix || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',             x.id,
           'at',             x.at,
           'actorId',        x.actor_id,
           'actorRole',      x.actor_role,
           'actorName',      coalesce(sa.display_name, pa.full_name),
           'authorizerId',   x.authorizer_id,
           'authorizerName', su.display_name,
           'action',         x.action,
           'entity',         x.entity,
           'entityId',       x.entity_id,
           'before',         x.before,
           'after',          x.after,
           'reasonCode',     x.reason_code,
           'deviceId',       x.device_id
         ) order by x.at desc, x.id desc), '[]'::jsonb)
    into v_rows
    from (
      select l.*
        from audit_log l
       where (p_from is null or l.at >= p_from)
         and (p_to   is null or l.at <  p_to)
         and (p_actor_id is null or l.actor_id = p_actor_id or l.authorizer_id = p_actor_id)
         and (p_action_prefix is null or l.action like p_action_prefix || '%')
       order by l.at desc, l.id desc
       limit p_limit offset p_offset) x
    left join staff sa    on sa.id = x.actor_id
    left join profiles pa on pa.id = x.actor_id
    left join staff su    on su.id = x.authorizer_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
end $fn_audit_log_page_0068$;

-- ---------------------------------------------------------------------------
-- 11. Grants. Internal helpers: service_role only (tests). Client surfaces:
--     authenticated (the in-function guard is the wall).
-- ---------------------------------------------------------------------------
revoke all on function app.reports_guard(boolean) from public, anon, authenticated;
grant execute on function app.reports_guard(boolean) to service_role;

revoke all on function app.reports_bucket(date, text) from public, anon, authenticated;
grant execute on function app.reports_bucket(date, text) to service_role;

revoke all on function app.reports_available_minutes(date, date) from public, anon, authenticated;
grant execute on function app.reports_available_minutes(date, date) to service_role;

revoke all on function app.reports_figures(date, date) from public, anon, authenticated;
grant execute on function app.reports_figures(date, date) to service_role;

revoke all on function app.reports_parse_scope(text) from public, anon, authenticated;
grant execute on function app.reports_parse_scope(text) to service_role;

revoke all on function app.ops_overview() from public, anon;
grant execute on function app.ops_overview() to authenticated;

revoke all on function app.panel_headline(date, date, text) from public, anon;
grant execute on function app.panel_headline(date, date, text) to authenticated;

revoke all on function app.report_revenue(date, date, text, jsonb) from public, anon;
grant execute on function app.report_revenue(date, date, text, jsonb) to authenticated;

revoke all on function app.report_courts(date, date, jsonb) from public, anon;
grant execute on function app.report_courts(date, date, jsonb) to authenticated;

revoke all on function app.report_cafe(date, date, jsonb) from public, anon;
grant execute on function app.report_cafe(date, date, jsonb) to authenticated;

revoke all on function app.report_stock(date, date, jsonb) from public, anon;
grant execute on function app.report_stock(date, date, jsonb) to authenticated;

revoke all on function app.report_staff_activity(date, date, uuid) from public, anon;
grant execute on function app.report_staff_activity(date, date, uuid) to authenticated;

revoke all on function app.report_drill(text, text, date, date) from public, anon;
grant execute on function app.report_drill(text, text, date, date) to authenticated;

revoke all on function app.audit_log_page(timestamptz, timestamptz, uuid, text, int, int) from public, anon;
grant execute on function app.audit_log_page(timestamptz, timestamptz, uuid, text, int, int) to authenticated;
