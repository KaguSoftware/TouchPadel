set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0146 — Touch Shop sale path.
--
--   order_items_shop_guard  BEFORE INSERT trigger on order_items: a shop line
--                           on a guest (web) order raises
--                           SHOP_ITEM_NOT_ORDERABLE (the change order: no guest
--                           shop); an order mixing café and shop lines raises
--                           MIXED_BASKET (the till splits the basket; one
--                           order is either kitchen work or a shelf sale).
--                           A trigger, not an edit to add_order_items, so every
--                           order path is covered, present and future.
--   app.order_is_shop       internal.
--   app.till_add_items      0038 body + the shop branch: no ticket (the KDS,
--                           its "recently done" list and the prep-time figures
--                           never see a racket), stock consumed directly,
--                           order served.
--   app.trg_order_item_voided  0018 body + retail restock (see the body).
--   app.trg_refund_restock  0043 body + guard: never restock a line twice.
--   app.menu_availability   0041 body + the retail rule (any size in stock).
--   app.item_required_ingredients  0018 body: retail is required as-is.
--   app.report_revenue      0099 body + shopIqd ("of which shop").
--
-- Every re-issued body is the latest one, verbatim, plus the marked 0146
-- changes (generated from the files and diff-checked).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app.order_is_shop — internal.
-- ---------------------------------------------------------------------------
create or replace function app.order_is_shop(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $order_is_shop_0146$
  select exists (
    select 1
      from order_items oi
      join menu_items mi on mi.id = oi.menu_item_id
      join menu_categories c on c.id = mi.category_id
     where oi.order_id = p_order_id and c.kind = 'shop')
$order_is_shop_0146$;

revoke all on function app.order_is_shop(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. order_items_shop_guard
-- ---------------------------------------------------------------------------
create or replace function app.trg_order_items_shop_guard() returns trigger
language plpgsql security definer set search_path = public as $shop_guard_0146$
declare
  v_kind   text;
  v_source order_source;
begin
  select c.kind into v_kind
    from menu_items mi join menu_categories c on c.id = mi.category_id
   where mi.id = new.menu_item_id;
  select o.source into v_source from orders o where o.id = new.order_id;

  if v_kind = 'shop' and v_source = 'guest_web' then
    raise exception 'SHOP_ITEM_NOT_ORDERABLE' using errcode = 'P0001',
      detail = new.menu_item_id::text;
  end if;
  if exists (
       select 1
         from order_items oi
         join menu_items mi on mi.id = oi.menu_item_id
         join menu_categories c on c.id = mi.category_id
        where oi.order_id = new.order_id and c.kind is distinct from v_kind) then
    raise exception 'MIXED_BASKET' using errcode = 'P0001',
      hint = 'send café items and shop items as two orders';
  end if;
  return new;
end $shop_guard_0146$;

revoke all on function app.trg_order_items_shop_guard() from public, anon, authenticated;

drop trigger if exists order_items_shop_guard on order_items;
create trigger order_items_shop_guard
  before insert on order_items
  for each row execute function app.trg_order_items_shop_guard();

-- ---------------------------------------------------------------------------
-- 3. app.till_add_items (latest 20260825000038_concurrency_locks.sql)
-- ---------------------------------------------------------------------------

create or replace function app.till_add_items(
  p_tab_id          uuid,
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $till_0146$
declare
  v_tab    tabs%rowtype;
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_total  bigint;
  v_day    uuid;
  v_oi     record;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_order from orders where idempotency_key = p_idempotency_key;
    if found then
      if v_order.placed_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another order';
      end if;
      select * into v_ticket from tickets where order_id = v_order.id;
      return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
        'ticket_id', v_ticket.id, 'status', v_order.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();      -- 0038 (#6): lock BEFORE the tab
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001',
      detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_tab.day_session_id is distinct from v_day then
    raise exception 'DAY_CLOSED' using errcode = 'P0001',
      hint = 'this tab belongs to a day that is no longer open';
  end if;

  begin
    insert into orders (tab_id, source, placed_by_staff_id, device_id, idempotency_key)
    values (v_tab.id, 'till', auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_order;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_order from orders where idempotency_key = p_idempotency_key;
      if found then
        if v_order.placed_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another order';
        end if;
        select * into v_ticket from tickets where order_id = v_order.id;
        return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
          'ticket_id', v_ticket.id, 'status', v_order.status);
      end if;
    end if;
    raise;
  end;

  v_total := app.add_order_items(v_order.id, p_items);

  -- 0146: a shop order (every line in a kind = 'shop' section; the
  -- order_items trigger refuses a mixed one) makes no kitchen ticket. Stock is
  -- taken here, line by line, through the same idempotent driver the ticket
  -- trigger uses, and the order is served on the spot.
  if app.order_is_shop(v_order.id) then
    for v_oi in select id from order_items where order_id = v_order.id and not voided loop
      perform app.consume_for_order_item(v_oi.id, null);
    end loop;
    update orders set status = 'served' where id = v_order.id;
    return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
      'tab_id', v_tab.id, 'ticket_id', null, 'total_iqd', v_total, 'kind', 'shop');
  end if;

  insert into tickets (order_id, device_id)
  values (v_order.id, p_device_id)
  returning * into v_ticket;

  -- STOCK HOOK (0018): consumption wired here too.

  return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
    'tab_id', v_tab.id, 'ticket_id', v_ticket.id, 'total_iqd', v_total);
end $till_0146$;

-- ---------------------------------------------------------------------------
-- 4. app.trg_order_item_voided (latest 20260824000018_stock_ledger.sql); trigger binding unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.trg_order_item_voided() returns trigger
language plpgsql security definer set search_path = public as $voided_0146$
declare
  v_m    record;
  v_kind text;
begin
  -- 0146: a voided RETAIL line goes back on the shelf. The café reclass pair
  -- below books a voided drink as waste (it was made); a racket that was
  -- rung up by mistake was never unwrapped. Reverse the consumption and give
  -- the units back to the batch they came from.
  select c.kind into v_kind
    from menu_items mi join menu_categories c on c.id = mi.category_id
   where mi.id = new.menu_item_id;
  if v_kind = 'shop' then
    if exists (select 1 from stock_movements
                where order_item_id = new.id and reason_code = 'retail_void_restock') then
      return new;                             -- replay: already restocked
    end if;
    for v_m in
      select * from stock_movements
       where order_item_id = new.id and movement_type = 'sale_consumption' and qty_delta < 0
    loop
      if v_m.batch_id is not null then
        update stock_batches set qty_remaining = qty_remaining - v_m.qty_delta
         where id = v_m.batch_id;
      end if;
      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                   unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
      values (v_m.ingredient_id, v_m.batch_id, 'sale_consumption', -v_m.qty_delta,
              v_m.unit_cost_iqd, new.id, v_m.ticket_id, auth.uid(), v_m.device_id, 'retail_void_restock');
    end loop;
    return new;
  end if;

  if exists (select 1 from stock_movements
              where order_item_id = new.id and movement_type = 'void_after_send') then
    return new;                               -- replay: already reclassified
  end if;

  for v_m in
    select * from stock_movements
     where order_item_id = new.id and movement_type = 'sale_consumption' and qty_delta < 0
  loop
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (v_m.ingredient_id, v_m.batch_id, 'sale_consumption', -v_m.qty_delta,
            v_m.unit_cost_iqd, new.id, v_m.ticket_id, auth.uid(), v_m.device_id, 'void_after_send_reversal');
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (v_m.ingredient_id, v_m.batch_id, 'void_after_send', v_m.qty_delta,
            v_m.unit_cost_iqd, new.id, v_m.ticket_id, auth.uid(), v_m.device_id, new.void_reason_code);
  end loop;
  return new;
end $voided_0146$;

-- ---------------------------------------------------------------------------
-- 5. app.trg_refund_restock (latest 20260825000043_stock_and_analytics.sql); trigger binding unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.trg_refund_restock() returns trigger
language plpgsql security definer set search_path = public as $restock_0146$
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
                and (movement_type = 'void_after_send'
                     or reason_code = 'retail_void_restock')) then   -- 0146: a voided retail line is already back on the shelf
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
end $restock_0146$;

-- ---------------------------------------------------------------------------
-- 6. app.menu_availability (latest 20260825000041_availability_local_day.sql); the menu_item_availability view
--    (0025) reads it, so the view and its anon grants are untouched.
-- ---------------------------------------------------------------------------
create or replace function app.menu_availability()
returns table (item_id uuid, orderable boolean)
language sql stable security definer set search_path = public as $menu_avail_0146$
  with today as (
    select app.business_date(now()) as d
  ),
  on_hand as (
    select ingredient_id, sum(qty_remaining) as qty
      from stock_batches
     where qty_remaining > 0
     group by ingredient_id
  ),
  direct as (
    -- every ingredient any variant of the item draws on, deduped
    select v.item_id, rl.ingredient_id
      from menu_item_variants v
      join recipe_lines rl on rl.variant_id = v.id
     group by v.item_id, rl.ingredient_id
  ),
  required as (
    -- purchased, or prepared with stock on hand: required as-is
    select d.item_id, d.ingredient_id
      from direct d
      join ingredients i on i.id = d.ingredient_id
      left join on_hand oh on oh.ingredient_id = d.ingredient_id
     where i.kind = 'purchased' or (i.kind = 'prepared' and coalesce(oh.qty, 0) > 0)
    union
    -- prepared and OUT: one-level expansion into its components
    select d.item_id, rl.ingredient_id
      from direct d
      join ingredients i on i.id = d.ingredient_id
      join recipe_lines rl on rl.output_ingredient_id = d.ingredient_id
      left join on_hand oh on oh.ingredient_id = d.ingredient_id
     where i.kind = 'prepared' and coalesce(oh.qty, 0) <= 0
  ),
  -- 0146: retail stock is per size. An item is orderable while ANY of its
  -- sizes is on the shelf; the one-size-out case must not grey the rack.
  retail as (
    select v.item_id, bool_or(coalesce(oh.qty, 0) > 0) as any_in
      from menu_item_variants v
      join recipe_lines rl on rl.variant_id = v.id
      join ingredients i on i.id = rl.ingredient_id and i.kind = 'retail'
      left join on_hand oh on oh.ingredient_id = i.id
     group by v.item_id
  )
  select mi.id as item_id,
         mi.is_active
           and coalesce(mi.unavailable_on <> (select d from today), true)   -- 0041
           and not mi.sold_out
           and not exists (
             select 1
               from required r
               left join on_hand oh on oh.ingredient_id = r.ingredient_id
              where r.item_id = mi.id and coalesce(oh.qty, 0) <= 0
           )
           and coalesce((select r.any_in from retail r where r.item_id = mi.id), true)
           as orderable
    from menu_items mi
$menu_avail_0146$;

revoke all on function app.menu_availability() from public;
grant execute on function app.menu_availability() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.item_required_ingredients (latest 20260824000018_stock_ledger.sql); the cost views read it.
-- ---------------------------------------------------------------------------
create or replace function app.item_required_ingredients(p_id uuid)
returns table (ingredient_id uuid, qty numeric)
language plpgsql stable security definer set search_path = public as $item_required_0146$
begin
  return query
  with direct as (
    select rl.ingredient_id, sum(rl.qty) as qty
      from recipe_lines rl
     where rl.variant_id = p_id
        or rl.variant_id in (select v.id from menu_item_variants v where v.item_id = p_id)
     group by rl.ingredient_id
  ),
  expanded as (
    -- purchased, or prepared with stock on hand: required as-is
    select d.ingredient_id, d.qty
      from direct d
      join ingredients i on i.id = d.ingredient_id
     where i.kind in ('purchased','retail') or app.ingredient_on_hand(d.ingredient_id) > 0
    union all
    -- prepared and OUT: one-level expansion into its components
    select rl.ingredient_id, d.qty * rl.qty
      from direct d
      join ingredients i on i.id = d.ingredient_id
      join recipe_lines rl on rl.output_ingredient_id = d.ingredient_id
     where i.kind = 'prepared' and app.ingredient_on_hand(d.ingredient_id) <= 0
  )
  select e.ingredient_id, sum(e.qty / (i.yield_percent / 100.0))
    from expanded e
    join ingredients i on i.id = e.ingredient_id
   group by e.ingredient_id;
end $item_required_0146$;

-- ---------------------------------------------------------------------------
-- 8. app.report_revenue (latest 20260915000099_revenue_net_and_cafe_waste.sql).
-- ---------------------------------------------------------------------------
create or replace function app.report_revenue(
  p_from    date,
  p_to      date,
  p_group   text default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_report_revenue_0146$
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
  -- 0146: the Touch Shop share of the settled tabs, net of line and tab
  -- discounts and of refunds, before tax (cafe_net_lines, 0095). A breakdown
  -- of the café money, not an addition to it: total_iqd is unchanged.
  st as (
    select s.tab_id, s.settled_at
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
     where (v_method is null or exists (select 1 from payments p where p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.tab_id = s.tab_id and p.recorded_by = v_staff))),
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
end $fn_report_revenue_0146$;
