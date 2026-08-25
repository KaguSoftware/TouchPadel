-- ===========================================================================
-- 0038 — concurrency + idempotency scoping
--
-- LOCK ORDER, established here and binding on everything downstream:
--
--     day_sessions  ->  tabs  ->  orders  ->  order_items
--
-- Every RPC that touches more than one of these must acquire them in that
-- order. Before this migration void_order_item_internal went the other way
-- (line, then order, never the tab), which is both the bug in #5 and the
-- reason the naive fix would deadlock.
--
--   #5  void_order_item_internal locked the order and the line but NOT the
--       tab, while settle_tab, apply_discount, override_price, till_add_items
--       and merge_tabs all take `tabs ... for update`. Under READ COMMITTED a
--       settle and a void could interleave: the settle read the totals with
--       the line still live, the void read `payments` before the settle's row
--       was visible (so v_paid = 0 and the VOID_REQUIRES_REFUND guard never
--       fired), and both committed. Result: a tab settled at the full price
--       with a voided line, and the guard that exists precisely to prevent
--       that was skipped.
--
--   #6  close_day locks its day_sessions row and refuses to close while any
--       tab is open. But create_guest_order resolved the day through
--       app.current_open_day() — an unlocked plain select — and never
--       re-checked. A guest order that started before the close and committed
--       after it left an OPEN TAB ON A CLOSED DAY: its cash sits outside
--       cash_expected_iqd and it can never be settled into any day.
--
--   #7  Idempotency replays were looked up by key alone, with no check that
--       the row belongs to the caller. For create_guest_order that is a real
--       RLS bypass: any anonymous caller supplying another guest's key got
--       that order's id, tab id and status back — a read orders_guest_read
--       otherwise forbids. (Keys are UUIDs, so this is an oracle rather than
--       an enumeration.) The staff RPCs leak nothing a staff RLS policy does
--       not already permit, but a cashier replaying another cashier's key
--       still got a nonsense "duplicate" instead of an error, so they get the
--       same treatment.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app.current_open_day_locked — INTERNAL: the open day, row-locked FOR SHARE.
--
-- The existing app.current_open_day() stays as-is: it is `stable` and used on
-- read paths where taking a row lock would be wrong. This is its write-path
-- sibling.
--
-- `for share` here against close_day's `for update` gives exact mutual
-- exclusion under READ COMMITTED, with no retry loop on either side:
--   * close commits first -> the waiting order re-evaluates the row (EvalPlanQual),
--     status is no longer 'open', the row is filtered out, `not found` -> CAFE_CLOSED.
--   * the order commits first -> close_day's open-tab guard sees the new tab
--     and raises DAY_OPEN_TABS.
-- ---------------------------------------------------------------------------
create or replace function app.current_open_day_locked() returns uuid
language sql security definer set search_path = public as $$
  select id from day_sessions where status = 'open' order by opened_at desc limit 1 for share
$$;

revoke all on function app.current_open_day_locked() from public, anon, authenticated;

comment on function app.current_open_day_locked() is
  '0038: the open day session, FOR SHARE. Write paths that create a tab or an order must use this, not app.current_open_day(), so a concurrent close_day cannot strand an open tab on a closed day.';

-- ---------------------------------------------------------------------------
-- app.void_order_item_internal — 0032 body, restructured to take the tab lock
-- FIRST (#5).
-- ---------------------------------------------------------------------------
create or replace function app.void_order_item_internal(
  p_order_item_id uuid,
  p_reason_code   text,
  p_authorizer    uuid,
  p_device_id     text,
  p_actor         jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $void_0038$
declare
  v_oi        order_items%rowtype;
  v_order     orders%rowtype;
  v_tab       tabs%rowtype;
  v_tab_id    uuid;
  v_order_id  uuid;
  v_before    jsonb;
  v_after     jsonb;
  v_paid      bigint;
  v_new_total bigint;
begin
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- Resolve the owning tab WITHOUT locking anything, so we can then acquire
  -- the locks in the canonical order above.
  select o.tab_id, o.id into v_tab_id, v_order_id
    from order_items oi
    join orders o on o.id = oi.order_id
   where oi.id = p_order_item_id;
  if v_tab_id is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = v_tab_id for update;          -- 1. tab
  select * into v_order from orders where id = v_order_id for update;     -- 2. order
  select * into v_oi from order_items where id = p_order_item_id for update;  -- 3. line

  -- Re-verify after the locks: merge_tabs may have moved this order onto a
  -- different tab while we were waiting, in which case our tab lock is on the
  -- wrong row. Serialization-failure class so a caller can simply retry.
  if v_order.tab_id is distinct from v_tab.id then
    raise exception 'TAB_MOVED' using errcode = '40001',
      hint = 'the order moved to another tab mid-void; retry';
  end if;

  if v_oi.voided then
    return jsonb_build_object('duplicate', true, 'order_item_id', v_oi.id);
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001',
      hint = 'a settled line comes back via app.refund';
  end if;

  v_before := to_jsonb(v_oi);

  update order_items
     set voided = true, void_reason_code = p_reason_code
   where id = p_order_item_id
   returning * into v_oi;

  -- VOID-AFTER-PAYMENT GUARD (0026): with the line struck, the tab total must
  -- still cover what has already been paid net of refunds — otherwise raise
  -- (rolling the void back). app.refund is the unwind path. The tab lock taken
  -- above is what makes this read of `payments` trustworthy (0038).
  v_paid := app.tab_net_paid(v_tab.id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(v_tab.id) t;
    if v_new_total < v_paid then
      raise exception 'VOID_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-void total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before voiding';
    end if;
  end if;

  -- STOCK HOOK (0018): the order_items_void_stock trigger writes the waste
  -- reclass pair on the voided flip above (the food was already made).

  if not exists (select 1 from order_items
                  where order_id = v_order.id and not voided) then
    update orders set status = 'voided' where id = v_order.id;
    update tickets
       set status = 'voided',
           last_actor_label = coalesce(p_actor->>'label', last_actor_label)
     where order_id = v_order.id
       and status <> 'voided';
  end if;

  v_after := to_jsonb(v_oi)
          || case when p_actor is not null then jsonb_build_object('actor', p_actor)
                  else '{}'::jsonb end;

  if p_actor is not null then
    perform app.write_audit_external('telegram', 'order_item.void', 'order_items',
                                     v_oi.id::text, v_before, v_after, p_reason_code);
  else
    perform app.write_audit('order_item.void', 'order_items', v_oi.id::text,
                            v_before, v_after, p_reason_code, p_authorizer, p_device_id);
  end if;

  return jsonb_build_object('duplicate', false, 'order_item_id', v_oi.id);
end $void_0038$;

-- ---------------------------------------------------------------------------
-- app.create_guest_order — 0032 body + locked day (#6) + scoped replay (#7).
-- ---------------------------------------------------------------------------
create or replace function app.create_guest_order(
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $guest_0038$
declare
  v_sess   guest_sessions;
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_total  bigint;
begin
  -- DEGRADED GUARD: cafe ordering is blocked outright while the till is
  -- offline (app.is_degraded, real implementation since 0021/0026).
  if app.is_degraded() then
    raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
      hint = 'ordering is paused — please order with staff';
  end if;

  v_sess := app.touch_guest_session();         -- raises SESSION_EXPIRED / AUTH_REQUIRED

  if p_idempotency_key is not null then
    select * into v_order from orders where idempotency_key = p_idempotency_key;
    if found then
      -- 0038 (#7): a replay must belong to this caller. The auth.uid() fallback
      -- keeps a legitimate replay working across a session rotation on the same
      -- anonymous user. The raise deliberately carries no ids.
      if v_order.guest_session_id is distinct from v_sess.id
         and not exists (select 1 from guest_sessions gs
                          where gs.id = v_order.guest_session_id
                            and gs.auth_user_id = auth.uid()) then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another order';
      end if;
      select * into v_ticket from tickets where order_id = v_order.id;
      return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
        'tab_id', v_order.tab_id, 'ticket_id', v_ticket.id, 'status', v_order.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();      -- 0038 (#6): was current_open_day()
  if v_day is null then
    raise exception 'CAFE_CLOSED' using errcode = 'P0001';
  end if;

  -- The table's open tab for today, or a fresh guest-opened one.
  select * into v_tab
    from tabs
   where table_id = v_sess.table_id and day_session_id = v_day
     and status = 'open' and merged_into_tab_id is null
   order by opened_at desc
   limit 1
   for update;
  if not found then
    insert into tabs (day_session_id, table_id, device_id)   -- opened_by_staff_id null: guest-web
    values (v_day, v_sess.table_id, p_device_id)
    returning * into v_tab;
  end if;

  begin
    insert into orders (tab_id, source, guest_session_id, device_id, idempotency_key)
    values (v_tab.id, 'guest_web', v_sess.id, p_device_id, p_idempotency_key)
    returning * into v_order;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_order from orders where idempotency_key = p_idempotency_key;
      if found then
        if v_order.guest_session_id is distinct from v_sess.id
           and not exists (select 1 from guest_sessions gs
                            where gs.id = v_order.guest_session_id
                              and gs.auth_user_id = auth.uid()) then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another order';
        end if;
        select * into v_ticket from tickets where order_id = v_order.id;
        return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
          'tab_id', v_order.tab_id, 'ticket_id', v_ticket.id, 'status', v_order.status);
      end if;
    end if;
    raise;
  end;

  v_total := app.add_order_items(v_order.id, p_items);

  insert into tickets (order_id, device_id)
  values (v_order.id, p_device_id)
  returning * into v_ticket;

  -- STOCK HOOK (0018): the tickets_consume_stock trigger consumes the order's
  -- lines ('sale_consumption') on the ticket insert above.

  -- TELEGRAM (0032): enqueue the staff-group message. Bookkeeping only — a
  -- failure here must never roll back the order.
  begin
    perform app.enqueue_telegram('order_new', v_order.id);
  exception when others then
    raise warning 'telegram enqueue failed for order %: % (%)', v_order.id, sqlerrm, sqlstate;
  end;

  return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
    'tab_id', v_tab.id, 'ticket_id', v_ticket.id, 'total_iqd', v_total);
end $guest_0038$;

-- ---------------------------------------------------------------------------
-- app.open_tab — 0015 body + locked day (#6) + scoped replay (#7).
-- ---------------------------------------------------------------------------
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $opentab_0038$
declare
  v_day  uuid;
  v_row  tabs%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from tabs where idempotency_key = p_idempotency_key;
    if found then
      if v_row.opened_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another tab';
      end if;
      return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();      -- 0038 (#6)
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null and not exists (select 1 from reservations where id = p_reservation_id) then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_table_id is null and p_label is null and p_reservation_id is null then
    raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001',
      hint = 'a tab needs a table, a label, or a reservation';
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key)
    values (v_day, p_table_id, p_reservation_id, p_label,
            auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_row;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_row from tabs where idempotency_key = p_idempotency_key;
      if found then
        if v_row.opened_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another tab';
        end if;
        return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
      end if;
    end if;
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id);
end $opentab_0038$;

-- ---------------------------------------------------------------------------
-- app.till_add_items — 0015 body + day assertion (#6) + scoped replay (#7).
--
-- This RPC never resolved a day at all: it trusted the tab's `status = 'open'`
-- check alone. Since close_day requires every tab settled or voided first, a
-- tab that is still open normally implies its day is too — but only if the
-- close cannot interleave. The explicit assertion below, against the FOR SHARE
-- day, is what closes that window.
-- ---------------------------------------------------------------------------
create or replace function app.till_add_items(
  p_tab_id          uuid,
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $till_0038$
declare
  v_tab    tabs%rowtype;
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_total  bigint;
  v_day    uuid;
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

  insert into tickets (order_id, device_id)
  values (v_order.id, p_device_id)
  returning * into v_ticket;

  -- STOCK HOOK (0018): consumption wired here too.

  return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
    'tab_id', v_tab.id, 'ticket_id', v_ticket.id, 'total_iqd', v_total);
end $till_0038$;

-- ---------------------------------------------------------------------------
-- app.settle_tab — 0026 body + scoped replay (#7); the net-paid subquery now
-- goes through app.tab_net_paid (0037) so the three guards share one basis.
-- ---------------------------------------------------------------------------
create or replace function app.settle_tab(
  p_tab_id          uuid,
  p_method          payment_method,
  p_tendered_iqd    bigint default null,
  p_amount_iqd      bigint default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_0038$
declare
  v_tab      tabs%rowtype;
  v_totals   record;
  v_paid     bigint;
  v_due      bigint;
  v_amount   bigint;
  v_change   bigint;
  v_payment  payments%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_payment from payments where idempotency_key = p_idempotency_key;
    if found then
      if v_payment.recorded_by is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another payment';
      end if;
      select * into v_tab from tabs where id = v_payment.tab_id;
      return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
        'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
    end if;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  -- Compute once; re-stamp (identical inputs => identical stamp) so a
  -- split-payment sequence keeps one consistent bill.
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         total_iqd    = v_totals.total_iqd
   where id = p_tab_id
   returning * into v_tab;

  -- Paid NET of refunds (0026): a refunded payment no longer counts toward the
  -- bill, so the refund-then-void unwind path can settle the remainder instead
  -- of dead-ending on ALREADY_PAID. Shared helper since 0037.
  v_paid := app.tab_net_paid(p_tab_id);
  v_due := v_tab.total_iqd - v_paid;
  if v_due <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  v_amount := coalesce(p_amount_iqd, v_due);
  if v_amount < 1 or v_amount > v_due then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001',
      detail = format('due %s, got %s', v_due, v_amount);
  end if;

  if p_method = 'cash' then
    if p_tendered_iqd is null or p_tendered_iqd < v_amount then
      raise exception 'TENDER_SHORT' using errcode = 'P0001';
    end if;
    v_change := p_tendered_iqd - v_amount;     -- exact: cash_rounding_iqd default 1 = off
  else
    if p_tendered_iqd is not null then
      raise exception 'TENDER_CARD' using errcode = 'P0001',
        hint = 'tendered/change are cash-only fields';
    end if;
    v_change := null;
  end if;

  begin
    insert into payments (tab_id, day_session_id, method, amount_iqd, tendered_iqd,
                          change_iqd, recorded_by, device_id, idempotency_key)
    values (p_tab_id, v_tab.day_session_id, p_method, v_amount, p_tendered_iqd,
            v_change, auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_payment;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_payment from payments where idempotency_key = p_idempotency_key;
      if found then
        if v_payment.recorded_by is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another payment';
        end if;
        return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
          'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
      end if;
    end if;
    raise;
  end;

  if v_paid + v_amount >= v_tab.total_iqd then
    update tabs set status = 'settled', settled_at = now()
     where id = p_tab_id returning * into v_tab;
    perform app.write_audit('tab.settle', 'tabs', v_tab.id::text,
                            null, to_jsonb(v_tab), null, null, p_device_id);
  else
    update tabs set status = 'awaiting_payment'
     where id = p_tab_id returning * into v_tab;
  end if;

  return jsonb_build_object('duplicate', false, 'payment_id', v_payment.id,
    'tab_id', v_tab.id, 'status', v_tab.status,
    'subtotal_iqd', v_tab.subtotal_iqd, 'discount_iqd', v_tab.discount_iqd,
    'tax_iqd', v_tab.tax_iqd, 'total_iqd', v_tab.total_iqd,
    'amount_iqd', v_amount, 'change_iqd', v_change,
    'remaining_iqd', greatest(v_tab.total_iqd - v_paid - v_amount, 0));
end $settle_0038$;
