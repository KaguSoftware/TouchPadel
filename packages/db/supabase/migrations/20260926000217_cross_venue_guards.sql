set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0217_cross_venue_guards — multi-venue slice 3, step 3.
--
-- Every RPC below creates rows on behalf of one thing that already belongs to a
-- branch: a payment, a tab, a table or booking, a court, an order line, a
-- ticket, an ingredient, a batch. Each is re-issued from its latest body with
-- one block added straight after its role guard:
--
--   v_venue := <that thing's venue_id>;
--   if v_venue is not null then
--     if not app.is_staff_at(v_venue, <the same roles>) then
--       raise exception 'VENUE_MISMATCH';
--     end if;
--     perform set_config('app.venue_id', v_venue::text, true);
--   end if;
--
-- Setting app.venue_id is what files everything downstream at the right branch
-- without touching those bodies: app.current_open_day() / _locked() (0216)
-- resolve to that branch's day, and every insert that relies on the venue_id
-- column default (payments, refunds, orders, tickets, stock movements and
-- batches written by the stock triggers, manager alerts, the audit row) takes
-- that branch rather than whichever the station on the request belongs to. A
-- caller acting on another branch's row is refused with VENUE_MISMATCH (an owner
-- works at every branch, so an owner is never refused). A missing row keeps the
-- body's own not-found error: the block only acts when the lookup finds a venue.
--
-- create_guest_order (0038) is the guest path: its degraded check and its day
-- are the guest session's branch, and the session's branch is asserted before
-- the tab, order and ticket inserts.

-- refund: re-issued from 20260926000205_till_shifts.sql:1100 with the 0217 venue guard
create or replace function app.refund(
  p_payment_id      uuid,
  p_amount_iqd      bigint,
  p_pin             text,
  p_reason_code     text,
  p_items           jsonb default null,
  p_device_id       text  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0217$
declare
  v_venue uuid;
  v_auth     uuid;
  v_payment  payments%rowtype;
  v_tab_id   uuid;
  v_refunded bigint;
  v_refund   refunds%rowtype;
  v_item     jsonb;
  v_oi       order_items%rowtype;
  v_qty      int;
  v_replay   jsonb;
  v_result   jsonb;
  v_day      uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the payment's branch decides the day, the rows written and who may act.
  v_venue := (select p.venue_id from payments p where p.id = p_payment_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- 0120: claim after the guards and before any write or lock (0049 pattern).
  -- A replay of the same key by the same caller returns the stored result
  -- here. 0139: it also spends the grant the replay worker minted for this
  -- dispatch, if there is one, so the station is not left holding a live
  -- authorisation for the next two minutes. Best effort — a duplicate must
  -- echo the stored result whatever the grant table says.
  v_replay := app.claim_replay(p_idempotency_key, 'refund');
  if v_replay is not null then
    begin
      perform app.consume_pin_grant(p_device_id);
    exception when others then
      null;
    end;
    return v_replay;
  end if;

  -- 0139: a refund is money leaving the till, so it needs an open day like
  -- settle_zero_tab and cancel_tab (0120) — a refund queued offline and
  -- replayed after close_day would otherwise land on a closed day.
  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to
  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt
  -- persisted either way) and holds a single-use grant; without one this raises
  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.
  v_auth := app.consume_pin_grant(p_device_id);

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

  insert into refunds (payment_id, amount_iqd, reason_code, refunded_by, device_id)
  values (p_payment_id, p_amount_iqd, p_reason_code, auth.uid(), p_device_id)
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

  v_result := jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $refund_0217$;

-- open_tab: re-issued from 20260922000145_shop_rpcs.sql:349 with the 0217 venue guard
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null,
  p_kind            text default 'cafe'
) returns jsonb
language plpgsql security definer set search_path = public as $open_tab_0217$
declare
  v_venue uuid;
  v_day        uuid;
  v_row        tabs%rowtype;
  v_label      text := nullif(btrim(p_label), '');
  v_status     reservation_status;
  v_live       uuid;
  v_constraint text;
  v_kind       text := coalesce(p_kind, 'cafe');
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the table or booking's branch decides the day, the rows written and who may act.
  v_venue := coalesce((select t.venue_id from cafe_tables t where t.id = p_table_id),
                     (select r.venue_id from reservations r where r.id = p_reservation_id));
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if v_kind not in ('cafe','shop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
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

  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null then
    select status into v_status from reservations where id = p_reservation_id;
    if not found then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- 0106: a booking that has ended without being played owes nothing; a tab
    -- opened against it is a mistake the day close would have to clean up.
    if v_status in ('cancelled','no_show','expired') then
      raise exception 'RESERVATION_NOT_LIVE' using errcode = 'P0001', detail = v_status::text;
    end if;
    -- 0106 (D1): friendly refusal. NOT serialised — two concurrent opens both
    -- pass it; tabs_one_live_per_reservation is the guard, mapped below.
    select id into v_live from tabs
     where reservation_id = p_reservation_id
       and status in ('open','awaiting_payment')
     limit 1;
    if v_live is not null then
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = v_live::text,
        hint = 'this booking already has an open bill; add to that one';
    end if;
  end if;
  if p_table_id is null and p_reservation_id is null then
    -- 0145: a shop counter sale is the one tab with no table and no booking;
    -- its label is what the till and the day close show for it.
    if v_kind = 'shop' then
      if v_label is null then
        raise exception 'LABEL_REQUIRED' using errcode = 'P0001',
          hint = 'a counter sale needs a name or a number';
      end if;
    else
      raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001',
        hint = 'a tab needs a table or a reservation; a name alone is not an anchor';
    end if;
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key, kind)
    values (v_day, p_table_id, p_reservation_id, v_label,
            auth.uid(), p_device_id, p_idempotency_key, v_kind)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tabs_one_live_per_reservation' then
      select id into v_live from tabs
       where reservation_id = p_reservation_id
         and status in ('open','awaiting_payment')
       limit 1;
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = coalesce(v_live::text, ''),
        hint = 'this booking already has an open bill; add to that one';
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
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id);
end $open_tab_0217$;

-- till_add_items: re-issued from 20260922000146_shop_sale_path.sql:86 with the 0217 venue guard
create or replace function app.till_add_items(
  p_tab_id          uuid,
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $till_add_items_0217$
declare
  v_venue uuid;
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
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
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
end $till_add_items_0217$;

-- settle_tab: re-issued from 20260917000106_desk_payment.sql:391 with the 0217 venue guard
create or replace function app.settle_tab(
  p_tab_id             uuid,
  p_method             payment_method,
  p_tendered_iqd       bigint default null,
  p_amount_iqd         bigint default null,
  p_idempotency_key    text   default null,
  p_device_id          text   default null,
  p_expected_total_iqd bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_tab_0217$
declare
  v_venue uuid;
  v_tab      tabs%rowtype;
  v_totals   record;
  v_paid     bigint;
  v_due      bigint;
  v_amount   bigint;
  v_change   bigint;
  v_payment  payments%rowtype;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
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

  select * into v_totals from app.compute_tab_totals(p_tab_id);

  -- 0106 (D4): the bill moved under the clerk (a line added, a booking
  -- extended). Refused BEFORE the stamp, so the row is left exactly as it was.
  if p_expected_total_iqd is not null and p_expected_total_iqd <> v_totals.total_iqd then
    raise exception 'TOTAL_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', p_expected_total_iqd, v_totals.total_iqd),
      hint = 'the bill changed since it was shown; read it again before taking payment';
  end if;

  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         court_iqd    = v_totals.court_iqd,
         total_iqd    = v_totals.total_iqd
   where id = p_tab_id
   returning * into v_tab;

  v_paid := app.tab_net_paid(p_tab_id);
  v_due := v_tab.total_iqd - v_paid;
  if v_due <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001',
      hint = 'nothing is owed on this tab; close it with app.settle_zero_tab';
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
    v_change := p_tendered_iqd - v_amount;
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
    'tax_iqd', v_tab.tax_iqd, 'court_iqd', v_tab.court_iqd, 'total_iqd', v_tab.total_iqd,
    'amount_iqd', v_amount, 'change_iqd', v_change,
    'remaining_iqd', greatest(v_tab.total_iqd - v_paid - v_amount, 0));
end $settle_tab_0217$;

-- settle_zero_tab: re-issued from 20260921000120_queue_money_ops.sql:173 with the 0217 venue guard
create or replace function app.settle_zero_tab(
  p_tab_id          uuid,
  p_reason_code     text,
  p_device_id       text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_zero_tab_0217$
declare
  v_venue uuid;
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_totals record;
  v_paid   bigint;
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_replay jsonb;
  v_result jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0120: claim after the guards, before the day lock (0049 pattern).
  v_replay := app.claim_replay(p_idempotency_key, 'settle_zero_tab');
  if v_replay is not null then
    return v_replay;
  end if;

  -- Lock order (0038/0044): day_sessions -> tabs.
  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001', detail = v_tab.status::text;
  end if;
  if v_tab.day_session_id <> v_day then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_paid := app.tab_net_paid(p_tab_id);

  if v_totals.total_iqd > v_paid then
    raise exception 'NOT_ZERO' using errcode = 'P0001',
      detail = (v_totals.total_iqd - v_paid)::text,
      hint = 'money is still owed on this tab; take payment instead';
  end if;
  if v_paid > v_totals.total_iqd then
    raise exception 'REFUND_DUE' using errcode = 'P0001',
      detail = (v_paid - v_totals.total_iqd)::text,
      hint = 'more was paid than is now owed; a manager refunds the difference first';
  end if;
  if not exists (select 1 from orders where tab_id = v_tab.id)
     and not exists (select 1 from payments where tab_id = v_tab.id)
     and not exists (select 1 from tab_adjustments where tab_id = v_tab.id) then
    raise exception 'TAB_EMPTY' using errcode = 'P0001',
      hint = 'nothing was ever on this tab; remove it with app.cancel_tab';
  end if;

  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         court_iqd    = v_totals.court_iqd,
         total_iqd    = v_totals.total_iqd,
         status       = 'settled',
         settled_at   = now()
   where id = v_tab.id
   returning * into v_tab;

  perform app.write_audit('tab.settle', 'tabs', v_tab.id::text,
                          null, to_jsonb(v_tab) || jsonb_build_object('zero_close', true),
                          v_reason, null, p_device_id);

  v_result := jsonb_build_object('tab_id', v_tab.id, 'status', v_tab.status,
                                 'total_iqd', v_tab.total_iqd, 'paid_iqd', v_paid);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $settle_zero_tab_0217$;

-- cancel_tab: re-issued from 20260921000120_queue_money_ops.sql:276 with the 0217 venue guard
create or replace function app.cancel_tab(
  p_tab_id          uuid,
  p_reason_code     text default null,
  p_device_id       text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $cancel_tab_0217$
declare
  v_venue uuid;
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_before jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_replay jsonb;
  v_result jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0120: claim after the guards, before the day lock (0049 pattern).
  v_replay := app.claim_replay(p_idempotency_key, 'cancel_tab');
  if v_replay is not null then
    return v_replay;
  end if;

  v_day := app.current_open_day_locked();
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
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001', detail = v_tab.status;
  end if;
  if v_tab.day_session_id <> v_day then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;

  if exists (select 1 from orders where tab_id = v_tab.id) then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'orders',
      hint = 'settle or void the orders on this tab first';
  end if;
  if exists (select 1 from payments where tab_id = v_tab.id) then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'payments',
      hint = 'this tab has been paid against; refund it before it can go';
  end if;
  if exists (select 1 from tab_adjustments where tab_id = v_tab.id) then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'adjustments';
  end if;
  -- 0106: only while the booking still owes its court fee on this tab. A
  -- cancelled / no-show booking, or one whose court was paid on another tab,
  -- owes nothing here, and refusing left the tab open until day close failed.
  if v_tab.reservation_id is not null
     and app.court_fee_remaining(v_tab.reservation_id, v_tab.id) > 0 then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'reservation',
      hint = 'the booking''s court fee is owed on this tab';
  end if;

  v_before := to_jsonb(v_tab);

  update tabs
     set status = 'void', subtotal_iqd = 0, tax_iqd = 0, discount_iqd = 0, total_iqd = 0
   where id = v_tab.id
   returning * into v_tab;

  -- 0120: the device now reaches the audit row (0106 passed six arguments, so
  -- audit_log.device_id was never set for a cancelled tab).
  perform app.write_audit('tab.cancel', 'tabs', v_tab.id::text,
                          v_before, to_jsonb(v_tab), v_reason, null, p_device_id);

  v_result := jsonb_build_object('tab_id', v_tab.id, 'status', v_tab.status);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $cancel_tab_0217$;

-- apply_discount: re-issued from 20260921000119_fix_pin_grant_overloads.sql:69 with the 0217 venue guard
create or replace function app.apply_discount(
  p_tab_id        uuid,
  p_kind          adjustment_kind,
  p_value         int,
  p_pin           text,
  p_reason_code   text,
  p_order_item_id uuid default null,
  p_device_id     text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_discount_0217$
declare
  v_venue uuid;
  v_auth      uuid;
  v_tab       tabs%rowtype;
  v_base      bigint;
  v_amount    bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
  v_replay    jsonb;
  v_result    jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_kind not in ('discount_percent','discount_amount') then
    raise exception 'INVALID_KIND' using errcode = 'P0001',
      hint = 'use app.override_price for price overrides';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0049: claim BEFORE the PIN check and before any write, but AFTER the role
  -- guard, so an unauthorized caller cannot burn keys. The claim lives in this
  -- transaction: every raise below rolls it back with the work.
  v_replay := app.claim_replay(p_idempotency_key, 'apply_discount');
  if v_replay is not null then
    return v_replay;
  end if;

  -- 0115/0119: the PIN itself is no longer checked here. The caller proved it to
  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt
  -- persisted either way) and holds a single-use grant; without one this raises
  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.
  v_auth := app.consume_pin_grant(p_device_id);

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  if p_order_item_id is not null then
    select oi.line_total_iqd into v_base
      from order_items oi
      join orders o on o.id = oi.order_id
     where oi.id = p_order_item_id and o.tab_id = p_tab_id and not oi.voided;
    if v_base is null then
      raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001';
    end if;
  else
    select t.subtotal_iqd into v_base from app.compute_tab_totals(p_tab_id) t;
  end if;

  if p_kind = 'discount_percent' then
    if p_value < 1 or p_value > 10000 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001',
        hint = 'percent discounts are basis points 1..10000';
    end if;
    v_amount := round((v_base::numeric * p_value) / 10000.0)::bigint;
  else
    if p_value < 1 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001';
    end if;
    v_amount := least(p_value::bigint, v_base);
  end if;

  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (p_tab_id, p_order_item_id, p_kind, p_value, v_amount,
          auth.uid(), v_auth, p_reason_code)
  returning * into v_adj;

  -- DISCOUNT-AFTER-PAYMENT GUARD (0037): the total must still cover what has
  -- been paid net of refunds. Checked AFTER the insert because the total has
  -- to be computed with the adjustment in place; the raise rolls it back.
  -- Same shape as the 0026 VOID_REQUIRES_REFUND guard. app.refund is the
  -- unwind path.
  v_paid := app.tab_net_paid(p_tab_id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(p_tab_id) t;
    if v_new_total < v_paid then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-discount total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before discounting';
    end if;
  end if;

  perform app.write_audit('discount.apply', 'tab_adjustments', v_adj.id::text,
                          null, to_jsonb(v_adj), p_reason_code, v_auth, p_device_id);

  v_result := jsonb_build_object('adjustment_id', v_adj.id, 'amount_iqd', v_amount);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $apply_discount_0217$;

-- apply_best_promotion: re-issued from 20260903000067_promotions.sql:708 with the 0217 venue guard
create or replace function app.apply_best_promotion(
  p_tab_id          uuid,
  p_code            text default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_best_promotion_0217$
declare
  v_venue uuid;
  v_tab       tabs%rowtype;
  v_replay    jsonb;
  v_elig      jsonb;
  v_best      jsonb;
  v_promo     promotions%rowtype;
  v_code      text := nullif(upper(btrim(p_code)), '');
  v_code_id   uuid;
  v_customer  uuid;
  v_amount    bigint;
  v_old_red   promotion_redemptions%rowtype;
  v_old_adj   tab_adjustments%rowtype;
  v_adj       tab_adjustments%rowtype;
  v_red       promotion_redemptions%rowtype;
  v_replaced  uuid;
  v_paid      bigint;
  v_new_total bigint;
  v_result    jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'apply_best_promotion');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_elig := app.eligible_promotions(p_tab_id, p_code);   -- raises CODE_INVALID

  -- A known code that is not eligible right now (expired, used up, wrong day,
  -- below minimum spend) is named rather than silently replaced by whatever
  -- auto promotion happens to be best: the cashier is holding a guest's code.
  if v_code is not null then
    select x.id into v_code_id from promotions x where x.public_code = v_code;
    if not exists (select 1 from jsonb_array_elements(v_elig) e
                    where (e->>'promotionId')::uuid = v_code_id) then
      raise exception 'CODE_NOT_ELIGIBLE' using errcode = 'P0001', detail = v_code;
    end if;
  end if;

  if jsonb_array_length(v_elig) = 0 then
    raise exception 'NO_ELIGIBLE_PROMOTION' using errcode = 'P0001';
  end if;

  v_best   := v_elig->0;
  v_amount := (v_best->>'amountIqd')::bigint;
  select * into v_promo from promotions where id = (v_best->>'promotionId')::uuid;

  if v_tab.reservation_id is not null then
    select r.guest_id into v_customer from reservations r where r.id = v_tab.reservation_id;
  end if;

  -- Replace the earlier promotion on this tab (one per tab). Same promotion,
  -- same amount: nothing has changed, so nothing is rewritten.
  select * into v_old_red from promotion_redemptions where tab_id = p_tab_id;
  if found then
    select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
    if v_old_red.promotion_id = v_promo.id and v_old_adj.amount_iqd = v_amount then
      v_result := jsonb_build_object('promotionId', v_promo.id, 'amountIqd', v_amount,
        'adjustmentId', v_old_adj.id, 'replacedPromotionId', null, 'unchanged', true);
      perform app.finish_replay(p_idempotency_key, v_result);
      return v_result;
    end if;
    v_replaced := v_old_red.promotion_id;
    delete from promotion_redemptions where id = v_old_red.id;
    -- By promotion_id, not by adjustment id alone: any stray promotion row on
    -- this tab goes with it, so the partial unique index cannot refuse the insert.
    delete from tab_adjustments where tab_id = p_tab_id and promotion_id is not null;
    perform app.write_audit('promotion.replace', 'tab_adjustments', v_old_adj.id::text,
                            to_jsonb(v_old_adj) || jsonb_build_object('redemption', to_jsonb(v_old_red)),
                            null, 'promotion', v_promo.created_by, p_device_id);
  end if;

  -- authorized_by = the manager who configured the promotion (created_by):
  -- the configuration is the authorisation, and day close names that person.
  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code, promotion_id)
  values (p_tab_id, null,
          case when v_promo.type = 'percent' then 'discount_percent'::adjustment_kind
               else 'discount_amount'::adjustment_kind end,
          case when v_promo.type = 'percent' then v_promo.value * 100   -- basis points, as apply_discount stores
               else v_promo.value end,
          v_amount, auth.uid(), v_promo.created_by, 'promotion', v_promo.id)
  returning * into v_adj;

  insert into promotion_redemptions (promotion_id, tab_id, adjustment_id, customer_id,
                                     amount_iqd, code_used, idempotency_key, redeemed_by)
  values (v_promo.id, p_tab_id, v_adj.id, v_customer, v_amount,
          case when v_promo.auto then null else v_code end, p_idempotency_key, auth.uid())
  returning * into v_red;

  -- DISCOUNT-AFTER-PAYMENT GUARD (0037), verbatim shape. An 'open' tab has
  -- normally taken nothing, but the guard is cheap and the invariant matters.
  v_paid := app.tab_net_paid(p_tab_id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(p_tab_id) t;
    if v_new_total < v_paid then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-promotion total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before applying a promotion';
    end if;
  end if;

  perform app.write_audit('promotion.apply', 'tab_adjustments', v_adj.id::text,
                          null, to_jsonb(v_adj) || jsonb_build_object('redemption', to_jsonb(v_red)),
                          'promotion', v_promo.created_by, p_device_id);

  v_result := jsonb_build_object('promotionId', v_promo.id, 'amountIqd', v_amount,
    'adjustmentId', v_adj.id, 'replacedPromotionId', v_replaced, 'unchanged', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $apply_best_promotion_0217$;

-- override_price: re-issued from 20260921000119_fix_pin_grant_overloads.sql:190 with the 0217 venue guard
create or replace function app.override_price(
  p_order_item_id uuid,
  p_new_unit_price_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_device_id text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $override_price_0217$
declare
  v_venue uuid;
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
  v_replay    jsonb;
  v_result    jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the order line's branch decides the day, the rows written and who may act.
  v_venue := (select o.venue_id from order_items oi join orders o on o.id = oi.order_id where oi.id = p_order_item_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_new_unit_price_iqd is null or p_new_unit_price_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  -- 0049: claim before the PIN check and before any write; after the role guard.
  v_replay := app.claim_replay(p_idempotency_key, 'override_price');
  if v_replay is not null then
    return v_replay;
  end if;

  -- 0115/0119: the PIN itself is no longer checked here. The caller proved it to
  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt
  -- persisted either way) and holds a single-use grant; without one this raises
  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.
  v_auth := app.consume_pin_grant(p_device_id);

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

  v_result := jsonb_build_object('adjustment_id', v_adj.id,
    'order_item_id', v_oi.id, 'line_total_iqd', v_new_line);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $override_price_0217$;

-- void_after_send: re-issued from 20260920000115_pin_grants_money_path.sql:585 with the 0217 venue guard
create or replace function app.void_after_send(
  p_order_item_id uuid,
  p_pin           text,
  p_reason_code   text,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $void_after_send_0217$
declare
  v_venue uuid;
  v_auth uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the order line's branch decides the day, the rows written and who may act.
  v_venue := (select o.venue_id from order_items oi join orders o on o.id = oi.order_id where oi.id = p_order_item_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to


  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt


  -- persisted either way) and holds a single-use grant; without one this raises


  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.


  v_auth := app.consume_pin_grant(p_device_id);

  return app.void_order_item_internal(p_order_item_id, p_reason_code, v_auth, p_device_id, null);
end $void_after_send_0217$;

-- record_drawer_open: re-issued from 20260917000106_desk_payment.sql:787 with the 0217 venue guard
create or replace function app.record_drawer_open(
  p_reason_code text,
  p_device_id   text default null,
  p_tab_id      uuid default null
) returns void
language plpgsql security definer set search_path = public as $record_drawer_open_0217$
declare
  v_venue uuid;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_reason_code is null or btrim(p_reason_code) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'an opening with no sale attached needs a stated reason';
  end if;

  perform app.write_audit('drawer.open', 'day_sessions',
                          coalesce(app.current_open_day()::text, 'none'),
                          null,
                          jsonb_build_object('tab_id', p_tab_id),
                          p_reason_code, null, p_device_id);
end $record_drawer_open_0217$;

-- merge_tabs: re-issued from 20260917000106_desk_payment.sql:704 with the 0217 venue guard
create or replace function app.merge_tabs(
  p_donor_tab_id    uuid,
  p_survivor_tab_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $merge_tabs_0217$
declare
  v_venue uuid;
  v_donor    tabs%rowtype;
  v_survivor tabs%rowtype;
  v_before   jsonb;
  v_first    uuid;
  v_second   uuid;
  v_old_red  promotion_redemptions%rowtype;
  v_old_adj  tab_adjustments%rowtype;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the surviving tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_survivor_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_donor_tab_id = p_survivor_tab_id then
    raise exception 'MERGE_SELF' using errcode = 'P0001';
  end if;

  v_first  := least(p_donor_tab_id, p_survivor_tab_id);
  v_second := greatest(p_donor_tab_id, p_survivor_tab_id);
  perform 1 from tabs where id = v_first for update;
  perform 1 from tabs where id = v_second for update;

  select * into v_donor from tabs where id = p_donor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_donor_tab_id::text;
  end if;
  select * into v_survivor from tabs where id = p_survivor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_survivor_tab_id::text;
  end if;

  if v_donor.status <> 'open' or v_survivor.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_donor.day_session_id <> v_survivor.day_session_id then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;
  if exists (select 1 from payments where tab_id = v_donor.id) then
    raise exception 'DONOR_HAS_PAYMENTS' using errcode = 'P0001',
      hint = 'settle or refund the donor tab first';
  end if;
  -- 0106: the court fee rides on the booking tab. Merge the other way.
  if v_donor.reservation_id is not null
     and v_donor.reservation_id is distinct from v_survivor.reservation_id then
    raise exception 'BOOKING_TAB_DONOR' using errcode = 'P0001',
      hint = 'a booking''s bill cannot be merged into another bill; merge the other bill into it';
  end if;

  v_before := to_jsonb(v_donor);

  select * into v_old_red from promotion_redemptions where tab_id = v_donor.id;
  if found then
    select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
    delete from promotion_redemptions where id = v_old_red.id;
    delete from tab_adjustments where tab_id = v_donor.id and promotion_id is not null;
    perform app.write_audit('promotion.drop_on_merge', 'tab_adjustments', v_old_adj.id::text,
                            to_jsonb(v_old_adj) || jsonb_build_object('redemption', to_jsonb(v_old_red)),
                            null, 'promotion', v_old_adj.authorized_by, null);
  end if;

  update orders set tab_id = v_survivor.id where tab_id = v_donor.id;
  update tab_adjustments set tab_id = v_survivor.id where tab_id = v_donor.id;

  update tabs
     set status = 'void', merged_into_tab_id = v_survivor.id,
         subtotal_iqd = 0, tax_iqd = 0, discount_iqd = 0, total_iqd = 0
   where id = v_donor.id
   returning * into v_donor;

  perform app.write_audit('tab.merge', 'tabs', v_donor.id::text,
                          v_before, to_jsonb(v_donor));

  return jsonb_build_object('donor_tab_id', v_donor.id,
                            'survivor_tab_id', v_survivor.id);
end $merge_tabs_0217$;

-- set_ticket_status: re-issued from 20260926000194_assistant_barista_waiter_access.sql:61 with the 0217 venue guard
create or replace function app.set_ticket_status(
  p_ticket_id uuid,
  p_status    ticket_status,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_ticket_status_0217$
declare
  v_venue uuid;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the ticket's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tickets t where t.id = p_ticket_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  return app.ticket_transition(p_ticket_id, p_status, p_device_id, null);
end $set_ticket_status_0217$;

-- set_order_item_ready: re-issued from 20260926000194_assistant_barista_waiter_access.sql:80 with the 0217 venue guard
create or replace function app.set_order_item_ready(
  p_order_item_id uuid,
  p_ready         boolean,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_order_item_ready_0217$
declare
  v_venue uuid;
  v_oi     order_items%rowtype;
  v_ticket tickets%rowtype;
  v_all    boolean;
begin
  if not app.is_staff('prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the order line's branch decides the day, the rows written and who may act.
  v_venue := (select o.venue_id from order_items oi join orders o on o.id = oi.order_id where oi.id = p_order_item_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'prep','cashier','manager','owner','head_barista','barista','assistant_barista','head_chef','chef') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  select * into v_oi from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;

  select * into v_ticket from tickets where order_id = v_oi.order_id;
  if found and v_ticket.status in ('completed','voided') then
    raise exception 'TICKET_CLOSED' using errcode = 'P0001',
      hint = 'a finished ticket''s marks are history, not state';
  end if;

  if p_ready then
    -- Idempotent: a double-tap (or a replay) keeps the FIRST timestamp.
    update order_items set ready_at = coalesce(ready_at, now())
     where id = p_order_item_id
     returning * into v_oi;
  else
    update order_items set ready_at = null
     where id = p_order_item_id
     returning * into v_oi;
  end if;

  select bool_and(ready_at is not null) into v_all
    from order_items where order_id = v_oi.order_id and not voided;

  return jsonb_build_object(
    'order_item_id',   v_oi.id,
    'ready_at',        v_oi.ready_at,
    'all_items_ready', coalesce(v_all, false),
    'ticket_id',       v_ticket.id);
end $set_order_item_ready_0217$;

-- staff_create_reservation: re-issued from 20260926000210_booking_settings_per_venue.sql:403 with the 0217 venue guard
create or replace function app.staff_create_reservation(
  p_court_id           uuid,
  p_kind               reservation_kind,
  p_start_at           timestamptz,
  p_end_at             timestamptz,
  p_guest_name         text default null,
  p_guest_phone        text default null,
  p_guest_id           uuid default null,
  p_notes              text default null,
  p_idempotency_key    text default null,
  p_client_ref         text default null,
  p_device_id          text default null,
  p_price_override_iqd bigint default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a till on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players            int default null
) returns jsonb
language plpgsql security definer set search_path = public as $staff_create_reservation_0217$
declare
  v_venue uuid;
  v_status   reservation_status;
  v_ttl      int;
  v_expires  timestamptz;
  v_rule     uuid;
  v_price    bigint;
  v_dur      int;
  v_existing reservations%rowtype;
  v_res      reservations%rowtype;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the court's branch decides the day, the rows written and who may act.
  v_venue := (select c.venue_id from courts c where c.id = p_court_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_end_at <= p_start_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from reservations where idempotency_key = p_idempotency_key;
    if found then
      -- 0048 (H3): scoped to the staff member who created it.
      if v_existing.created_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another reservation';
      end if;
      return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
        'status', v_existing.status);
    end if;
  end if;

  -- BOOKING-HOURS GUARD (0026): maintenance is exempt -- blocking time on a
  -- closed day (repairs, private events) is legitimate.
  if p_kind <> 'maintenance' then
    perform app.assert_bookable(p_court_id, p_start_at, p_end_at);
  end if;

  if p_kind = 'booking' and p_guest_id is null and p_guest_name is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042): same point in the sequence as hold_slot -- the desk and
  -- the guest app now queue for one court instead of racing into the GiST
  -- exclusion check and deadlocking there.
  perform app.lock_court(p_court_id);

  perform app.expire_stale_holds(p_court_id, tstzrange(p_start_at, p_end_at, '[)'));

  v_status := case when p_kind = 'hold' then 'pending' else 'confirmed' end;
  if p_kind = 'hold' then
    select hold_ttl_seconds into v_ttl from venue_settings where venue_id = (select c.venue_id from courts c where c.id = p_court_id);
    v_expires := now() + make_interval(secs => coalesce(v_ttl, 300));
  end if;

  if p_kind = 'booking' then
    v_dur := (extract(epoch from (p_end_at - p_start_at)) / 60)::int;
    select ps.rule_id, ps.price_iqd into v_rule, v_price
      from app.price_slot(p_court_id, p_start_at, v_dur) ps;
    if p_price_override_iqd is not null then
      -- Explicit price under manager/owner authority (odd ranges no rule
      -- prices, or a deliberate override). Audited below.
      if not app.is_staff('manager','owner') then
        raise exception 'FORBIDDEN' using errcode = 'P0001',
          hint = 'price overrides are manager/owner only';
      end if;
      if p_price_override_iqd < 0 then
        raise exception 'INVALID_PRICE' using errcode = 'P0001';
      end if;
      v_price := p_price_override_iqd;
      v_rule  := null;                          -- 0048: mark it as an override for H1
    elsif v_rule is null then
      -- 0026: an unpriced booking is never stored silently any more.
      raise exception 'NO_RATE' using errcode = 'P0001',
        hint = 'no rate rule prices this range - a manager/owner may pass p_price_override_iqd';
    end if;
  end if;

  begin
    insert into reservations
      (court_id, kind, status, start_at, end_at, guest_id, guest_name, guest_phone,
       created_by_staff_id, source, rate_rule_id, price_iqd, hold_expires_at,
       notes, device_id, idempotency_key, client_ref)
    values
      (p_court_id, p_kind, v_status, p_start_at, p_end_at, p_guest_id, p_guest_name,
       p_guest_phone, auth.uid(), 'desk', v_rule, v_price, v_expires,
       p_notes, p_device_id, p_idempotency_key, p_client_ref)
    returning * into v_res;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
    when unique_violation then
      if p_idempotency_key is not null then
        select * into v_existing from reservations where idempotency_key = p_idempotency_key;
        if found then
          if v_existing.created_by_staff_id is distinct from auth.uid() then
            raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
              hint = 'that key belongs to another reservation';
          end if;
          return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
            'status', v_existing.status);
        end if;
      end if;
      raise;
  end;

  perform app.write_audit('reservation.create', 'reservations', v_res.id::text,
                          null, to_jsonb(v_res), null, null, p_device_id);

  if p_kind = 'booking' and p_price_override_iqd is not null then
    perform app.write_audit('reservation.price_override', 'reservations', v_res.id::text,
                            null,
                            jsonb_build_object('price_override_iqd', p_price_override_iqd,
                                               'applied_by', auth.uid(),
                                               'rate_rule_id', v_rule),
                            'price_override', null, p_device_id);
  end if;

  return jsonb_build_object('duplicate', false, 'reservation_id', v_res.id,
    'status', v_res.status, 'rate_rule_id', v_rule, 'price_iqd', v_price);
end $staff_create_reservation_0217$;

-- create_series: re-issued from 20260926000210_booking_settings_per_venue.sql:774 with the 0217 venue guard
create or replace function app.create_series(
  p_court_id        uuid,
  p_pattern         text,
  p_weekdays        int[],
  p_start_time      time,
  p_duration_min    int,
  p_starts_on       date,
  p_ends_on         date,
  p_guest_id        uuid  default null,
  p_guest_name      text  default null,
  p_guest_phone     text  default null,
  p_notes           text  default null,
  p_resolutions     jsonb default '[]'::jsonb,
  p_idempotency_key text  default null,
  p_device_id       text  default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a till on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players         int   default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_series_0217$
declare
  v_venue uuid;
  v_uid         uuid := auth.uid();
  v_resolutions jsonb := coalesce(p_resolutions, '[]'::jsonb);
  v_existing    reservation_series%rowtype;
  v_series      reservation_series%rowtype;
  v_r           jsonb;
  v_action      text;
  v_target      uuid;
  v_court       uuid;
  v_courts      uuid[];
  v_occ         record;
  v_res         jsonb;
  v_key         text;
  v_created     uuid[] := '{}'::uuid[];
  v_skipped     date[] := '{}'::date[];
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the court's branch decides the day, the rows written and who may act.
  v_venue := (select c.venue_id from courts c where c.id = p_court_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  -- Idempotent replay, scoped to the staff member who created it (0048/H3).
  if p_idempotency_key is not null then
    select * into v_existing from reservation_series where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.created_by_staff_id is distinct from v_uid then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another series';
      end if;
      select coalesce(array_agg(r.id order by r.start_at, r.id), '{}'::uuid[]) into v_created
        from reservations r
       where r.series_id = v_existing.id;
      select coalesce(array_agg(o.occ_date order by o.occ_date), '{}'::date[]) into v_skipped
        from app.series_occurrences(v_existing.pattern, v_existing.weekdays, v_existing.start_time,
                                    v_existing.duration_min, v_existing.starts_on, v_existing.ends_on,
                                    v_existing.venue_id) o
       where not exists (select 1 from reservations r
                          where r.idempotency_key = p_idempotency_key || ':' || o.occ_date::text);
      return jsonb_build_object('duplicate', true, 'seriesId', v_existing.id,
        'created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
    end if;
  end if;

  if not exists (select 1 from courts where id = p_court_id and is_active) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_guest_id is null and coalesce(btrim(p_guest_name), '') = '' then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001',
      hint = 'a series needs guest_id or guest_name';
  end if;
  if p_guest_id is not null and not exists (select 1 from profiles where id = p_guest_id) then
    raise exception 'GUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Resolutions: shape-checked in full before anything is locked or written.
  if jsonb_typeof(v_resolutions) <> 'array' then
    raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
      hint = 'p_resolutions: [{date, action: skip | moveCourt, courtId}]';
  end if;
  for v_r in select * from jsonb_array_elements(v_resolutions) loop
    v_action := v_r ->> 'action';
    if jsonb_typeof(v_r) <> 'object' or v_action is null or v_action not in ('skip', 'moveCourt') then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'action: skip | moveCourt';
    end if;
    begin
      perform (v_r ->> 'date')::date;
    exception when others then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'date: YYYY-MM-DD';
    end;
    if v_r ->> 'date' is null then
      raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
        detail = v_r::text, hint = 'date: YYYY-MM-DD';
    end if;
    if v_action = 'moveCourt' then
      begin
        v_target := (v_r ->> 'courtId')::uuid;
      exception when others then
        v_target := null;
      end;
      if v_target is null or not exists (select 1 from courts where id = v_target and is_active) then
        raise exception 'INVALID_RESOLUTION' using errcode = 'P0001',
          detail = v_r::text, hint = 'moveCourt needs the id of an active court';
      end if;
    end if;
  end loop;

  -- Validate the pattern (INVALID_PATTERN / INVALID_WEEKDAYS / INVALID_RANGE /
  -- SERIES_EMPTY / SERIES_TOO_LONG) before the series row and before any lock.
  perform app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                 p_starts_on, p_ends_on, (select c.venue_id from courts c where c.id = p_court_id));

  -- SERIALIZE (0042): every court this series may write to, ascending, first.
  select array_agg(s.c order by s.c) into v_courts
    from (select p_court_id as c
          union
          select (r ->> 'courtId')::uuid
            from jsonb_array_elements(v_resolutions) r
           where r ->> 'action' = 'moveCourt') s;
  foreach v_court in array v_courts loop
    perform app.lock_court(v_court);
  end loop;

  -- The series row goes in FIRST so a concurrent replay of the same key queues
  -- on the unique index and then reads this series back instead of writing a
  -- second one.
  begin
    insert into reservation_series
      (court_id, pattern, weekdays, start_time, duration_min, starts_on, ends_on,
       guest_id, guest_name, guest_phone, notes, created_by_staff_id, idempotency_key)
    values
      (p_court_id, p_pattern, coalesce(p_weekdays, '{}'::int[]), p_start_time, p_duration_min,
       p_starts_on, p_ends_on, p_guest_id, nullif(btrim(p_guest_name), ''),
       nullif(btrim(p_guest_phone), ''), p_notes, v_uid, p_idempotency_key)
    returning * into v_series;
  exception
    when unique_violation then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'a series with this key was created concurrently - replay the call';
  end;

  for v_occ in
    select o.occ_date, o.start_at, o.end_at,
           (select r from jsonb_array_elements(v_resolutions) r
             where (r ->> 'date')::date = o.occ_date
             limit 1) as res
      from app.series_occurrences(p_pattern, p_weekdays, p_start_time, p_duration_min,
                                  p_starts_on, p_ends_on) o
     order by o.occ_date
  loop
    v_action := v_occ.res ->> 'action';
    if v_action = 'skip' then
      v_skipped := v_skipped || v_occ.occ_date;
      continue;
    end if;
    v_target := case when v_action = 'moveCourt' then (v_occ.res ->> 'courtId')::uuid
                     else p_court_id end;
    v_key := case when p_idempotency_key is null then null
                  else p_idempotency_key || ':' || v_occ.occ_date::text end;

    -- THE insert path. Its refusals are this series' unresolved conflicts; any
    -- other error is a real fault and propagates unchanged.
    begin
      v_res := app.staff_create_reservation(
        p_court_id           => v_target,
        p_kind               => 'booking',
        p_start_at           => v_occ.start_at,
        p_end_at             => v_occ.end_at,
        p_guest_name         => v_series.guest_name,
        p_guest_phone        => v_series.guest_phone,
        p_guest_id           => v_series.guest_id,
        p_notes              => v_series.notes,
        p_idempotency_key    => v_key,
        p_client_ref         => null,
        p_device_id          => p_device_id,
        p_price_override_iqd => null);
    exception
      when raise_exception then
        if sqlerrm in ('SLOT_TAKEN', 'CLOSED_DATE', 'OUTSIDE_HOURS', 'NO_RATE') then
          raise exception 'SERIES_UNRESOLVED_CONFLICTS' using errcode = 'P0001',
            detail = v_occ.occ_date::text,
            hint = format('%s on %s - skip that date or move it to another court',
                          sqlerrm, v_occ.occ_date);
        end if;
        raise;
    end;

    -- A "duplicate" here means the per-occurrence key exists with no series
    -- behind it (a desk booking reused the key). Refuse rather than adopt it.
    if coalesce((v_res ->> 'duplicate')::boolean, false) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        detail = v_occ.occ_date::text,
        hint = 'an occurrence key already belongs to a reservation outside this series';
    end if;
    v_created := v_created || (v_res ->> 'reservation_id')::uuid;
  end loop;

  if coalesce(array_length(v_created, 1), 0) = 0 then
    raise exception 'SERIES_EMPTY' using errcode = 'P0001',
      hint = 'every occurrence was skipped';
  end if;

  update reservations
     set series_id = v_series.id
   where id = any (v_created);

  perform app.write_audit('series.create', 'reservation_series', v_series.id::text,
                          null,
                          to_jsonb(v_series)
                            || jsonb_build_object('created',     to_jsonb(v_created),
                                                  'skipped',     to_jsonb(v_skipped),
                                                  'resolutions', v_resolutions),
                          null, null, p_device_id);

  return jsonb_build_object('duplicate', false, 'seriesId', v_series.id,
    'created', to_jsonb(v_created), 'skipped', to_jsonb(v_skipped));
end $create_series_0217$;

-- record_production: re-issued from 20260926000200_stock_locations.sql:936 with the 0217 venue guard
create or replace function app.record_production(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_expiry_date   date default null,
  p_device_id     text default null,
  p_location      text default 'bakery'
) returns jsonb
language plpgsql security definer set search_path = public as $record_production_0217$
declare
  v_venue uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the ingredient's branch decides the day, the rows written and who may act.
  v_venue := (select i.venue_id from ingredients i where i.id = p_ingredient_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  return app.record_production_internal(p_ingredient_id, p_qty, p_expiry_date, p_device_id,
                                        app.parse_stock_location(p_location, 'bakery'));
end $record_production_0217$;

-- record_waste: re-issued from 20260926000200_stock_locations.sql:962 with the 0217 venue guard
create or replace function app.record_waste(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_movement_type movement_type default 'waste_spill',
  p_reason_code   text default null,
  p_device_id     text default null,
  p_idempotency_key text default null,
  p_location      text default null
) returns void
language plpgsql security definer set search_path = public as $record_waste_0217$
declare
  v_venue uuid;
  v_replay jsonb;
  v_loc    stock_location;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the ingredient's branch decides the day, the rows written and who may act.
  v_venue := (select i.venue_id from ingredients i where i.id = p_ingredient_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_movement_type not in ('waste_spill','waste_spoilage') then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001',
      hint = 'record_waste accepts waste_spill or waste_spoilage';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  v_loc := app.parse_stock_location(p_location, app.staff_home_location(app.staff_role()));

  -- 0049: the stock ledger is append-only, so a double deduction has no undo;
  -- corrections are counter-entries. Claim before consuming anything.
  v_replay := app.claim_replay(p_idempotency_key, 'record_waste');
  if v_replay is not null then
    return;                                   -- already applied
  end if;

  perform app.consume_fefo_at(v_loc, p_ingredient_id, p_qty, p_movement_type,
                              null, null, auth.uid(), p_device_id, p_reason_code);

  perform app.write_audit('stock.record_waste', 'ingredients', p_ingredient_id::text,
                          null, jsonb_build_object('qty', p_qty, 'movement_type', p_movement_type,
                                                   'location', v_loc),
                          p_reason_code, null, p_device_id);

  perform app.finish_replay(p_idempotency_key, jsonb_build_object('applied', true));
end $record_waste_0217$;

-- write_off_expired: re-issued from 20260920000115_pin_grants_money_path.sql:624 with the 0217 venue guard
create or replace function app.write_off_expired(
  p_batch_id    uuid,
  p_pin         text,
  p_reason_code text default 'expired',
  p_device_id   text default null
) returns void
language plpgsql security definer set search_path = public as $write_off_expired_0217$
declare
  v_venue uuid;
  v_batch      stock_batches%rowtype;
  v_authorizer uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the batch's branch decides the day, the rows written and who may act.
  v_venue := (select b.venue_id from stock_batches b where b.id = p_batch_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  -- 0115: the PIN itself is no longer checked here. The caller proved it to

  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt

  -- persisted either way) and holds a single-use grant; without one this raises

  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.

  v_authorizer := app.consume_pin_grant(p_device_id);

  select * into v_batch from stock_batches where id = p_batch_id for update;
  if not found then
    raise exception 'BATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_batch.qty_remaining <= 0 then
    raise exception 'BATCH_EMPTY' using errcode = 'P0001';
  end if;

  update stock_batches set qty_remaining = 0 where id = p_batch_id;

  insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                               unit_cost_iqd, staff_id, device_id, reason_code)
  values (v_batch.ingredient_id, p_batch_id, 'expired_writeoff', -v_batch.qty_remaining,
          v_batch.unit_cost_iqd, auth.uid(), p_device_id, p_reason_code);

  perform app.write_audit('stock.write_off_expired', 'stock_batches', p_batch_id::text,
                          to_jsonb(v_batch), null, p_reason_code, v_authorizer, p_device_id);
end $write_off_expired_0217$;

-- create_guest_order: re-issued from 20260825000038_concurrency_locks.sql:174
create or replace function app.create_guest_order(
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_guest_order_0217$
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
  -- 0217: the degraded state of the caller's live session's branch.
  if app.is_degraded(coalesce(
       (select gs.venue_id from guest_sessions gs
         where gs.auth_user_id = auth.uid() and gs.closed_at is null and gs.expires_at > now()
         order by gs.created_at desc limit 1),
       app.current_venue_or_default())) then
    raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
      hint = 'ordering is paused — please order with staff';
  end if;

  v_sess := app.touch_guest_session();         -- raises SESSION_EXPIRED / AUTH_REQUIRED
  -- 0217: the session's branch: its day, and the tab, order and ticket rows.
  perform set_config('app.venue_id', v_sess.venue_id::text, true);

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
end $create_guest_order_0217$;

