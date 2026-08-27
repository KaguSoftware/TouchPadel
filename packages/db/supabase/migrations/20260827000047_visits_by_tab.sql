-- ===========================================================================
-- 0047 — visits counts tabs, and only tabs
--
--   #23  0043 fixed "a pure walk-in day reports zero footfall" -- visits was
--        count(distinct guest_session_id), and that column is NULL for every
--        till order. Its header states the intent plainly: count TABS. The
--        expression it shipped did not:
--
--          count(distinct coalesce(guest_session_id::text, 'till:'||tab_id))
--
--        That mixes two identifier spaces in one distinct. A tab carrying BOTH
--        a guest-web order and a till order yields two keys -- the session id
--        and 'till:<tab>' -- so ONE party is counted as TWO visits.
--
--        This is not a corner case, it is the normal upsell flow: a QR party
--        orders from the phone, the waiter later adds a forgotten item at the
--        till against that same tab. app.till_add_items places no restriction
--        on a tab's origin (nor should it), so any tab can end up mixed.
--
--        Reproduced against 0046 on a real guest tab:
--          distinct TABS on this day       : 1
--          visits as analytics counts them : 2
--
--        Fix: count(distinct o.tab_id) -- literally what 0043 set out to do.
--        One tab is one bill is one party.
--
--        SERIES BREAK, the second on this metric. 0043 already restated every
--        historical figure; this restates every mixed-tab day downward. Days
--        with no mixed tabs are unchanged, which is most of them today: no tab
--        in the current dataset carries both sources yet, so in practice this
--        corrects the metric BEFORE it starts drifting rather than after.
-- ===========================================================================

CREATE OR REPLACE FUNCTION app.analytics_daily_sales(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           count(distinct o.tab_id)                              as visits
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
end $function$;
