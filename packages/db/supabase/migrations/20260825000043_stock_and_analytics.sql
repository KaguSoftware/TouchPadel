-- ===========================================================================
-- 0043 - stock reversal + analytics visits
--
--   #10 trg_refund_restock fired on ANY refund_items insert and credited the
--       line's BOM back into stock, with no check that the line had already
--       been written off. void_after_send records the food as WASTE (the
--       reversal pair in trg_order_item_voided) because it was already made.
--       Refunding a line that was voided after send therefore credited the
--       ingredients a second time and on-hand drifted up by that line's BOM.
--       A voided-as-waste line now restocks nothing.
--
--       Second guard: cumulative refunded qty may not exceed the line qty.
--       Nothing enforced this, so a line could be refunded repeatedly and
--       manufacture stock out of nothing. This runs in an AFTER trigger, so
--       the raise rolls the offending insert back.
--
--   #12 analytics_daily_sales reported visits as count(distinct
--       o.guest_session_id). guest_session_id is NULL for every till order by
--       constraint (0015), and count(distinct) skips NULLs - so a day of pure
--       walk-in business reported "visits: 0" next to a non-zero order count,
--       and the operator UI presented that as footfall. A till order has no
--       guest session, so its TAB is the natural visit unit.
--
--       SERIES BREAK: this changes every historical daily figure the owner has
--       already seen. Worth a note in the analytics UI.
--
-- The daily-sales body below is the 0034 function verbatim with that single
-- expression replaced (and the dollar-quote tag renamed).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app.trg_refund_restock - 0018 body + the two guards (#10).
-- ---------------------------------------------------------------------------
create or replace function app.trg_refund_restock() returns trigger
language plpgsql security definer set search_path = public as $restock_0043$
declare
  v_r        record;
  v_batch    record;
  v_qty      numeric;
  v_refund   refunds%rowtype;
  v_line_qty int;
  v_refunded numeric;
begin
  -- GUARD 1 (0043): the line was voided after send, so its stock is already
  -- recorded as waste. Crediting it back here would double-count it.
  if exists (select 1 from stock_movements
              where order_item_id = new.order_item_id
                and movement_type = 'void_after_send') then
    return new;
  end if;

  -- GUARD 2 (0043): never refund more units than the line holds.
  select qty into v_line_qty from order_items where id = new.order_item_id;
  select coalesce(sum(ri.qty), 0) into v_refunded
    from refund_items ri where ri.order_item_id = new.order_item_id;
  if v_line_qty is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_refunded > v_line_qty then
    raise exception 'REFUND_QTY_EXCEEDS_LINE' using errcode = 'P0001',
      detail = format('line qty %s, refunded %s', v_line_qty, v_refunded);
  end if;

  select * into v_refund from refunds where id = new.refund_id;

  for v_r in select * from app.order_item_bom(new.order_item_id) loop
    v_qty := v_r.qty * new.qty;

    select id, unit_cost_iqd into v_batch
      from stock_batches
     where ingredient_id = v_r.ingredient_id and qty_remaining > 0
     order by received_at desc, id desc
     limit 1
     for update;

    if found then
      update stock_batches set qty_remaining = qty_remaining + v_qty where id = v_batch.id;
    else
      insert into stock_batches (ingredient_id, delivery_line_id, qty_received, qty_remaining, unit_cost_iqd)
      values (v_r.ingredient_id, null, v_qty, v_qty, 0)
      returning id, unit_cost_iqd into v_batch;
    end if;

    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, refund_id, staff_id, reason_code)
    values (v_r.ingredient_id, v_batch.id, 'refund_reversal', v_qty,
            v_batch.unit_cost_iqd, new.order_item_id, new.refund_id,
            v_refund.refunded_by, v_refund.reason_code);
  end loop;
  return new;
end $restock_0043$;

revoke all on function app.trg_refund_restock() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.analytics_daily_sales - 0034 body, till tabs counted as visits (#12).
-- ---------------------------------------------------------------------------
create or replace function app.analytics_daily_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn_daily_sales_0043$
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
           count(distinct coalesce(o.guest_session_id::text,
                          'till:' || o.tab_id::text))              as visits
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
end $fn_daily_sales_0043$;

