-- ===========================================================================
-- 0044 — lock-order fixes: override_price, refund, and stock iteration order
--
-- 0038 declared the binding lock order:
--
--     day_sessions  ->  tabs  ->  orders  ->  order_items
--
-- and its header asserts that "settle_tab, apply_discount, override_price,
-- till_add_items and merge_tabs all take `tabs ... for update`". Two of those
-- claims did not hold, and both are reproducible.
--
--   #18  app.override_price took the locks INVERTED — `order_items` first,
--        then `tabs`. Every sibling descends parent-to-child, so a cashier
--        overriding a price and a cashier voiding the same line form a real
--        lock cycle. Reproduced against 0043 with deadlock_timeout = 10ms:
--
--          ERROR: deadlock detected
--          CONTEXT: while locking tuple (1,47) in relation "tabs"
--
--        Postgres kills one side with 40P01, which is not a business error:
--        no RPC maps it, the till surfaces it raw, and per HANDOFF a booking
--        or money RPC returning "deadlock detected" is now a REGRESSION.
--        Fixed the way 0038 fixed void_order_item_internal: resolve the tab
--        through an UNLOCKED read, then take tabs -> order_items in order,
--        then re-check the line is still on that tab (TAB_MOVED).
--
--   #19  app.refund never took the tab lock at all — only `payments`. But
--        app.tab_net_paid() is the shared basis of every "requires refund"
--        guard (VOID_REQUIRES_REFUND 0026, DISCOUNT_/OVERRIDE_REQUIRES_REFUND
--        0037) AND of settle_tab's v_due and its settled-vs-awaiting decision,
--        and all of those read it while holding `tabs ... for update` on the
--        assumption that the lock makes it stable. It does not. Reproduced
--        against 0043 — session A held the tab lock for the whole window:
--
--          A: net_paid FIRST read  = 10000
--          B: refund -> {"refund_id": ..., "amount_iqd": 3000}   <-- commits
--          A: net_paid SECOND read = 7000
--
--        The money consequence is in settle_tab: it reads v_paid, computes
--        v_due = total - v_paid, inserts the payment, then settles the tab if
--        `v_paid + v_amount >= total`. A refund committing inside that window
--        leaves v_paid stale-HIGH, so the tab is marked `settled` while it is
--        genuinely underpaid — the shortfall never appears in cash_expected_iqd
--        and the tab can never be re-settled. Fix: refund joins the same lock
--        order, taking tabs before payments, so the tab lock means what every
--        other money path already assumes it means.
--
--   #20  Multi-ingredient stock writers iterated in UNSPECIFIED order, so the
--        row locks on `stock_batches` came in whatever order the plan emitted:
--        app.order_item_bom groups by ingredient_id with no ORDER BY, and
--        finalize_count's reconcile loop reads stock_count_lines with no
--        ORDER BY. Two tickets sharing two ingredients, or a ticket racing a
--        count, can therefore take the same two locks in opposite orders.
--        Today's planner happens to emit sorted output, so this is a latent
--        hazard rather than a reproduced deadlock — but it is one plan change
--        away from being real, and the fix is a total order that costs nothing.
--        finalize_count also tops up surplus newest-first while drawing
--        shortage down oldest-first; the outer ORDER BY makes the per-call
--        sequence deterministic either way.
--
-- Forward-only: no applied migration is edited, and no settled tab is
-- re-stamped. This changes lock acquisition only — no totals, no balances.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- #18 — override_price: tabs before order_items
-- ---------------------------------------------------------------------------
create or replace function app.override_price(
  p_order_item_id uuid,
  p_new_unit_price_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $override_0044$
declare
  v_auth      uuid;
  v_oi        order_items%rowtype;
  v_tab       tabs%rowtype;
  v_tab_id    uuid;
  v_order_id  uuid;
  v_before    jsonb;
  v_mods      bigint;
  v_new_line  bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_new_unit_price_iqd is null or p_new_unit_price_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  -- Resolve the owning tab WITHOUT locking, so the locks below can be taken in
  -- the canonical order (0038). This is exactly the shape void_order_item_internal
  -- uses; before 0044 this function locked the line first and deadlocked against it.
  select o.tab_id, o.id into v_tab_id, v_order_id
    from order_items oi
    join orders o on o.id = oi.order_id
   where oi.id = p_order_item_id;
  if v_tab_id is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs        where id = v_tab_id        for update;
  select * into v_oi  from order_items where id = p_order_item_id for update;

  -- The line could have moved tabs (merge_tabs) between the unlocked read and
  -- the lock; 40001 tells the caller to retry rather than pricing the wrong tab.
  if not exists (select 1 from orders o where o.id = v_oi.order_id and o.tab_id = v_tab.id) then
    raise exception 'TAB_MOVED' using errcode = '40001',
      hint = 'the order moved to another tab mid-override; retry';
  end if;

  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_oi);

  select coalesce(sum(price_delta_iqd * qty), 0) into v_mods
    from order_item_modifiers where order_item_id = v_oi.id;
  v_new_line := (p_new_unit_price_iqd + v_mods) * v_oi.qty;

  update order_items
     set unit_price_iqd = p_new_unit_price_iqd, line_total_iqd = v_new_line
   where id = v_oi.id
   returning * into v_oi;

  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (v_tab.id, v_oi.id, 'price_override', p_new_unit_price_iqd::int,
          greatest((v_before->>'line_total_iqd')::bigint - v_new_line, 0),
          auth.uid(), v_auth, p_reason_code)
  returning * into v_adj;

  -- OVERRIDE-AFTER-PAYMENT GUARD (0037). Trustworthy from 0044 on: refund now
  -- takes the same tab lock, so tab_net_paid cannot move under us here.
  v_paid := app.tab_net_paid(v_tab.id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(v_tab.id) t;
    if v_new_total < v_paid then
      raise exception 'OVERRIDE_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-override total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before overriding';
    end if;
  end if;

  perform app.write_audit('price.override', 'order_items', v_oi.id::text,
                          v_before, to_jsonb(v_oi), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('adjustment_id', v_adj.id,
    'order_item_id', v_oi.id, 'line_total_iqd', v_new_line);
end $override_0044$;

-- ---------------------------------------------------------------------------
-- #19 — refund: take the tab lock before the payment lock
-- ---------------------------------------------------------------------------
create or replace function app.refund(
  p_payment_id uuid,
  p_amount_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_items jsonb default null,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0044$
declare
  v_auth     uuid;
  v_payment  payments%rowtype;
  v_tab_id   uuid;
  v_refunded bigint;
  v_refund   refunds%rowtype;
  v_item     jsonb;
  v_oi       order_items%rowtype;
  v_qty      int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  -- 0044: the tab comes FIRST. payments.tab_id never changes (payments are
  -- append-only, and merge_tabs refuses a donor that has any), so resolving it
  -- through an unlocked read and then locking is sound. Taking `tabs` here is
  -- what makes app.tab_net_paid() actually stable for settle_tab and for all
  -- three REQUIRES_REFUND guards, every one of which reads it under this lock.
  select tab_id into v_tab_id from payments where id = p_payment_id;
  if v_tab_id is null then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from tabs where id = v_tab_id for update;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount_iqd), 0) into v_refunded
    from refunds where payment_id = p_payment_id;
  if v_refunded + p_amount_iqd > v_payment.amount_iqd then
    raise exception 'REFUND_EXCEEDS_PAYMENT' using errcode = 'P0001',
      detail = format('paid %s, already refunded %s', v_payment.amount_iqd, v_refunded);
  end if;

  insert into refunds (payment_id, amount_iqd, reason_code, refunded_by)
  values (p_payment_id, p_amount_iqd, p_reason_code, auth.uid())
  returning * into v_refund;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
      select oi.* into v_oi
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.id = (v_item->>'order_item_id')::uuid
         and o.tab_id = v_payment.tab_id;
      if not found then
        raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001',
          detail = v_item->>'order_item_id';
      end if;
      if v_qty < 1 or v_qty > v_oi.qty then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;
      insert into refund_items (refund_id, order_item_id, qty)
      values (v_refund.id, v_oi.id, v_qty);
    end loop;
  end if;

  -- STOCK HOOK (0018/0043): the refund_items_restock trigger writes the
  -- 'refund_reversal' movements, guarded against void-as-waste double credit.

  perform app.write_audit('payment.refund', 'refunds', v_refund.id::text,
                          null, to_jsonb(v_refund), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
end $refund_0044$;

-- ---------------------------------------------------------------------------
-- #20 — deterministic ingredient order for every multi-ingredient stock writer
-- ---------------------------------------------------------------------------

-- Same rows, same yield maths, same signature as 0018 - only the emission
-- order is now pinned. consume_for_order_item loops this directly and takes
-- `stock_batches ... for update` per ingredient, so this ORDER BY is what
-- gives two concurrent tickets a common lock order. Body regenerated from the
-- live 0018 definition so ORDER BY is the only difference.
CREATE OR REPLACE FUNCTION app.order_item_bom(p_order_item_id uuid)
 RETURNS TABLE(ingredient_id uuid, qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select l.ingredient_id,
         sum(l.qty * l.factor / (i.yield_percent / 100.0)) as qty
    from (
      select rl.ingredient_id, rl.qty, 1::numeric as factor
        from order_items oi
        join recipe_lines rl on rl.variant_id = oi.variant_id
       where oi.id = p_order_item_id
      union all
      select rl.ingredient_id, rl.qty, oim.qty::numeric
        from order_item_modifiers oim
        join recipe_lines rl on rl.modifier_id = oim.modifier_id
       where oim.order_item_id = p_order_item_id
    ) l
    join ingredients i on i.id = l.ingredient_id
   group by l.ingredient_id
   order by l.ingredient_id
$function$;

revoke all on function app.order_item_bom(uuid) from public, anon, authenticated;

-- finalize_count: pin the reconcile loop's ingredient order so a count takes
-- its stock_batches locks in the same sequence as every ticket does. Body
-- regenerated from the live 0019 definition; ORDER BY is the only difference.
CREATE OR REPLACE FUNCTION app.finalize_count(p_count_id uuid, p_lines jsonb DEFAULT '[]'::jsonb, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count    stock_counts%rowtype;
  v_line     jsonb;
  v_cl       stock_count_lines%rowtype;
  v_delta    numeric;
  v_left     numeric;
  v_take     numeric;
  v_batch    record;
  v_adjusted int := 0;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_count from stock_counts where id = p_count_id for update;
  if not found then
    raise exception 'COUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_count.finalized_at is not null then
    raise exception 'COUNT_FINALIZED' using errcode = 'P0001';
  end if;

  -- Apply the counted quantities from the payload.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update stock_count_lines
       set counted_qty = (v_line->>'counted_qty')::numeric
     where count_id = p_count_id
       and ingredient_id = (v_line->>'ingredient_id')::uuid;
    if not found then
      raise exception 'COUNT_LINE_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_line->>'ingredient_id', '(missing ingredient_id)');
    end if;
    if (v_line->>'counted_qty')::numeric < 0 then
      raise exception 'INVALID_LINE' using errcode = 'P0001', detail = v_line::text;
    end if;
  end loop;

  -- Reconcile every drifted line.
  for v_cl in
    select * from stock_count_lines
     where count_id = p_count_id and counted_qty <> theoretical_qty
     order by ingredient_id
  loop
    v_delta := v_cl.counted_qty - v_cl.theoretical_qty;
    v_adjusted := v_adjusted + 1;

    if v_delta < 0 then
      -- Shortage: draw down oldest-first (FEFO scan order), overdraft on batch null.
      v_left := -v_delta;
      for v_batch in
        select id, qty_remaining, unit_cost_iqd
          from stock_batches
         where ingredient_id = v_cl.ingredient_id and qty_remaining > 0
         order by expiry_date asc nulls last, received_at asc
         for update
      loop
        exit when v_left <= 0;
        v_take := least(v_left, v_batch.qty_remaining);
        update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
        insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                     unit_cost_iqd, count_id, staff_id, device_id, reason_code)
        values (v_cl.ingredient_id, v_batch.id, 'count_adjustment', -v_take,
                v_batch.unit_cost_iqd, p_count_id, auth.uid(), p_device_id, 'count_shortage');
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then
        insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                     unit_cost_iqd, count_id, staff_id, device_id, reason_code)
        values (v_cl.ingredient_id, null, 'count_adjustment', -v_left,
                null, p_count_id, auth.uid(), p_device_id, 'count_shortage');
      end if;
    else
      -- Surplus: top up the newest live batch, or a zero-cost synthetic batch.
      select id, unit_cost_iqd into v_batch
        from stock_batches
       where ingredient_id = v_cl.ingredient_id and qty_remaining > 0
       order by received_at desc, id desc
       limit 1
       for update;
      if found then
        update stock_batches set qty_remaining = qty_remaining + v_delta where id = v_batch.id;
      else
        insert into stock_batches (ingredient_id, delivery_line_id, qty_received, qty_remaining, unit_cost_iqd)
        values (v_cl.ingredient_id, null, v_delta, v_delta, 0)
        returning id, unit_cost_iqd into v_batch;
      end if;
      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                   unit_cost_iqd, count_id, staff_id, device_id, reason_code)
      values (v_cl.ingredient_id, v_batch.id, 'count_adjustment', v_delta,
              v_batch.unit_cost_iqd, p_count_id, auth.uid(), p_device_id, 'count_surplus');
    end if;
  end loop;

  update stock_counts set finalized_at = now() where id = p_count_id
  returning * into v_count;

  perform app.write_audit('stock.finalize_count', 'stock_counts', p_count_id::text,
                          null, jsonb_build_object('adjusted_lines', v_adjusted),
                          null, null, p_device_id);

  return jsonb_build_object('count_id', p_count_id, 'adjusted_lines', v_adjusted,
                            'finalized_at', v_count.finalized_at);
end $function$;

revoke all on function app.override_price(uuid, bigint, text, text, text) from public, anon;
revoke all on function app.refund(uuid, bigint, text, text, jsonb, text) from public, anon;
revoke all on function app.finalize_count(uuid, jsonb, text) from public, anon;
grant execute on function app.override_price(uuid, bigint, text, text, text) to authenticated;
grant execute on function app.refund(uuid, bigint, text, text, jsonb, text) to authenticated;
grant execute on function app.finalize_count(uuid, jsonb, text) to authenticated;
