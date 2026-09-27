-- 0244 shop_desk_access — the shop assistant works the shop till and nothing
-- else; the café staff no longer sell from the shop.
--
-- Feature: Touch Shop, own desk (Parsa, 2026-09-27; docs/design/shop/
-- shop-desk-2026-09-27.md). Depends on: shop_desk_enums (0243: shop_staff).
-- Re-runnable: create or replace, drop policy if exists + create policy,
-- guarded constraint swap.
--
-- THE RULE (app.assert_tab_kind_role). A tab's kind decides who may work it:
-- shop_staff works 'shop' tabs only; cashier and court_desk work 'cafe' tabs
-- only; manager and owner work both. It is checked after the tab row is read
-- in every till RPC that acts on a tab, and on the kind asked for in
-- open_tab. TAB_KIND_FORBIDDEN otherwise.
--
-- NO CROSS-SELL. A shop tab carries no table and no booking: open_tab
-- refuses one (SHOP_TAB_NO_ANCHOR), merge_tabs refuses mixing kinds
-- (TAB_KIND_MISMATCH), and the order_items guard refuses a shop item on a
-- café tab and a café item on a shop tab (TAB_KIND_MISMATCH), beside the
-- 0146 guest-web and mixed-basket checks.
--
-- THE SHOP PC is a station with mode 'shop' (stations_mode_chk widened,
-- register_station accepts it). Its drawer is its own till shift (0205): the
-- four shift RPCs admit shop_staff, and stamp_till_shift needs no change.
--
-- READS. shop_staff reads the shop's tabs and their orders, lines, payments,
-- refunds, adjustments and refund lines, and nothing of the café: each
-- staff read policy gains an "or shop_staff and the tab is a shop tab"
-- branch, with the (select …) wrapping of 0234.
--
-- HIRING. shop_staff is hireable (protocol_engine_roles, the hiring
-- position's role check) and has no team (app.staff_team).
--
-- Every body below is the latest one, verbatim, plus the marked 0244 changes.
--
-- covered by packages/db/tests/shop-desk.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0. app.assert_tab_kind_role — internal.
-- ---------------------------------------------------------------------------
create or replace function app.assert_tab_kind_role(p_kind text) returns void
language plpgsql stable security definer set search_path = public as $assert_tab_kind_role_0244$
declare
  v_role staff_role := app.staff_role();
begin
  if v_role in ('manager', 'owner') then
    return;
  end if;
  if coalesce(p_kind, 'cafe') = 'shop' then
    if v_role = 'shop_staff' then
      return;
    end if;
  elsif v_role in ('cashier', 'court_desk') then
    return;
  end if;
  raise exception 'TAB_KIND_FORBIDDEN' using errcode = 'P0001',
    detail = coalesce(p_kind, 'cafe');
end $assert_tab_kind_role_0244$;

comment on function app.assert_tab_kind_role(text) is
  '0244 (Touch Shop own desk). Internal: raises TAB_KIND_FORBIDDEN (detail = the kind) unless the caller may work a tab of that kind: shop_staff shop only, cashier and court_desk cafe only, manager and owner both.';

revoke all on function app.assert_tab_kind_role(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. app.open_tab — re-issued from 20260926000217_cross_venue_guards.sql:166
-- ---------------------------------------------------------------------------
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null,
  p_kind            text default 'cafe'
) returns jsonb
language plpgsql security definer set search_path = public as $open_tab_0244$
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
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the table or booking's branch decides the day, the rows written and who may act.
  v_venue := coalesce((select t.venue_id from cafe_tables t where t.id = p_table_id),
                     (select r.venue_id from reservations r where r.id = p_reservation_id));
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if v_kind not in ('cafe','shop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;
  -- 0244: the kind decides who may open it (shop_staff shop only, the café
  -- staff café only), and a shop sale is paid on the spot: no table, no booking.
  perform app.assert_tab_kind_role(v_kind);
  if v_kind = 'shop' and (p_table_id is not null or p_reservation_id is not null) then
    raise exception 'SHOP_TAB_NO_ANCHOR' using errcode = 'P0001',
      hint = 'a shop sale is paid at the shop desk; it never goes on a table or a booking';
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
end $open_tab_0244$;

-- ---------------------------------------------------------------------------
-- 2. app.till_add_items — re-issued from 20260926000217_cross_venue_guards.sql:288
-- ---------------------------------------------------------------------------
create or replace function app.till_add_items(
  p_tab_id          uuid,
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $till_add_items_0244$
declare
  v_venue uuid;
  v_tab    tabs%rowtype;
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_total  bigint;
  v_day    uuid;
  v_oi     record;
begin
  if not app.is_staff('cashier','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner','shop_staff') then
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
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244

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
end $till_add_items_0244$;

-- ---------------------------------------------------------------------------
-- 3. app.settle_tab — re-issued from 20260926000217_cross_venue_guards.sql:396
-- ---------------------------------------------------------------------------
create or replace function app.settle_tab(
  p_tab_id             uuid,
  p_method             payment_method,
  p_tendered_iqd       bigint default null,
  p_amount_iqd         bigint default null,
  p_idempotency_key    text   default null,
  p_device_id          text   default null,
  p_expected_total_iqd bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_tab_0244$
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
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
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
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244
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
end $settle_tab_0244$;

-- ---------------------------------------------------------------------------
-- 4. app.settle_zero_tab — re-issued from 20260926000217_cross_venue_guards.sql:537
-- ---------------------------------------------------------------------------
create or replace function app.settle_zero_tab(
  p_tab_id          uuid,
  p_reason_code     text,
  p_device_id       text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_zero_tab_0244$
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
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
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
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244
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
end $settle_zero_tab_0244$;

-- ---------------------------------------------------------------------------
-- 5. app.cancel_tab — re-issued from 20260926000217_cross_venue_guards.sql:637
-- ---------------------------------------------------------------------------
create or replace function app.cancel_tab(
  p_tab_id          uuid,
  p_reason_code     text default null,
  p_device_id       text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $cancel_tab_0244$
declare
  v_venue uuid;
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_before jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_replay jsonb;
  v_result jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
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
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244
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
end $cancel_tab_0244$;

-- ---------------------------------------------------------------------------
-- 6. app.apply_discount — re-issued from 20260926000217_cross_venue_guards.sql:732
-- ---------------------------------------------------------------------------
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
language plpgsql security definer set search_path = public as $apply_discount_0244$
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
  if not app.is_staff('cashier','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner','shop_staff') then
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
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244
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
end $apply_discount_0244$;

-- ---------------------------------------------------------------------------
-- 7. app.override_price — re-issued from 20260926000217_cross_venue_guards.sql:993
-- ---------------------------------------------------------------------------
create or replace function app.override_price(
  p_order_item_id uuid,
  p_new_unit_price_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_device_id text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $override_price_0244$
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
  if not app.is_staff('cashier','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the order line's branch decides the day, the rows written and who may act.
  v_venue := (select o.venue_id from order_items oi join orders o on o.id = oi.order_id where oi.id = p_order_item_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner','shop_staff') then
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
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244
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
end $override_price_0244$;

-- ---------------------------------------------------------------------------
-- 8. app.void_after_send — re-issued from 20260926000217_cross_venue_guards.sql:1116
-- ---------------------------------------------------------------------------
create or replace function app.void_after_send(
  p_order_item_id uuid,
  p_pin           text,
  p_reason_code   text,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $void_after_send_0244$
declare
  v_venue uuid;
  v_auth uuid;
begin
  if not app.is_staff('cashier','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the order line's branch decides the day, the rows written and who may act.
  v_venue := (select o.venue_id from order_items oi join orders o on o.id = oi.order_id where oi.id = p_order_item_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  -- 0244: the line's tab kind decides who may void it.
  perform app.assert_tab_kind_role((select t.kind from order_items oi
                                      join orders o on o.id = oi.order_id
                                      join tabs t on t.id = o.tab_id
                                     where oi.id = p_order_item_id));

  -- 0115: the PIN itself is no longer checked here. The caller proved it to


  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt


  -- persisted either way) and holds a single-use grant; without one this raises


  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.


  v_auth := app.consume_pin_grant(p_device_id);

  return app.void_order_item_internal(p_order_item_id, p_reason_code, v_auth, p_device_id, null);
end $void_after_send_0244$;

-- ---------------------------------------------------------------------------
-- 9. app.record_drawer_open — re-issued from 20260926000217_cross_venue_guards.sql:1160
-- ---------------------------------------------------------------------------
create or replace function app.record_drawer_open(
  p_reason_code text,
  p_device_id   text default null,
  p_tab_id      uuid default null
) returns void
language plpgsql security definer set search_path = public as $record_drawer_open_0244$
declare
  v_venue uuid;
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  -- 0244: a drawer opened for a sale follows the sale's tab kind; one opened
  -- with no sale is the caller's own drawer at their station.
  if p_tab_id is not null then
    perform app.assert_tab_kind_role((select t.kind from tabs t where t.id = p_tab_id));
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
end $record_drawer_open_0244$;

-- ---------------------------------------------------------------------------
-- 10. app.merge_tabs — re-issued from 20260926000217_cross_venue_guards.sql:1193
-- ---------------------------------------------------------------------------
create or replace function app.merge_tabs(
  p_donor_tab_id    uuid,
  p_survivor_tab_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $merge_tabs_0244$
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
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the surviving tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_survivor_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
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
  -- 0244: a shop sale and a café bill never become one bill.
  if coalesce(v_donor.kind, 'cafe') <> coalesce(v_survivor.kind, 'cafe') then
    raise exception 'TAB_KIND_MISMATCH' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_survivor.kind);
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
end $merge_tabs_0244$;

-- ---------------------------------------------------------------------------
-- 11. app.trg_order_items_shop_guard — re-issued from 20260922000146_shop_sale_path.sql:48
-- ---------------------------------------------------------------------------
create or replace function app.trg_order_items_shop_guard() returns trigger
language plpgsql security definer set search_path = public as $shop_guard_0244$
declare
  v_kind     text;
  v_source   order_source;
  v_tab_kind text;
begin
  select c.kind into v_kind
    from menu_items mi join menu_categories c on c.id = mi.category_id
   where mi.id = new.menu_item_id;
  select o.source, t.kind into v_source, v_tab_kind
    from orders o left join tabs t on t.id = o.tab_id
   where o.id = new.order_id;

  if v_kind = 'shop' and v_source = 'guest_web' then
    raise exception 'SHOP_ITEM_NOT_ORDERABLE' using errcode = 'P0001',
      detail = new.menu_item_id::text;
  end if;
  -- 0244: a shop item goes on a shop tab and a café item on a café tab, never
  -- the other way (the shop is its own desk; no cross-sell).
  if v_tab_kind is not null and coalesce(v_kind, 'cafe') <> v_tab_kind then
    raise exception 'TAB_KIND_MISMATCH' using errcode = 'P0001',
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
end $shop_guard_0244$;

revoke all on function app.trg_order_items_shop_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. app.open_till_shift — re-issued from 20260926000205_till_shifts.sql:445
-- ---------------------------------------------------------------------------
create or replace function app.open_till_shift(
  p_opening_float_iqd bigint,
  p_device_id         text,
  p_note              text default null,
  p_idempotency_key   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $open_till_shift_0244$
declare
  v_station  stations%rowtype;
  v_venue    uuid;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_replay   jsonb;
  v_day      day_sessions%rowtype;
  v_stale    till_shifts%rowtype;
  v_mine     till_shifts%rowtype;
  v_prev     till_shifts%rowtype;
  v_outside  bigint;
  v_diff     bigint;
  v_row      till_shifts%rowtype;
  v_con      text;
  v_result   jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_station := app.till_shift_station(p_device_id, true);
  v_venue := v_station.venue_id;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_opening_float_iqd is null or p_opening_float_iqd < 0 then
    raise exception 'INVALID_FLOAT' using errcode = 'P0001';
  end if;
  if length(v_note) > 500 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'open_till_shift');
  if v_replay is not null then
    return v_replay;
  end if;

  -- The open day, FOR SHARE against close_day's FOR UPDATE (0038).
  select * into v_day
    from day_sessions
   where status = 'open' and venue_id = v_venue
   order by opened_at desc
   limit 1
   for share;
  if not found then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- Self-heal (PROPOSAL): a shift left open on this station, or by this
  -- person, on a day closed outside close_day (V9) ends with its day now.
  for v_stale in
    select s.*
      from till_shifts s
      join day_sessions d on d.id = s.day_session_id and d.status = 'closed'
     where s.closed_at is null
       and (s.station_id = v_station.id or s.staff_id = auth.uid())
     order by s.opened_at
     for update of s
  loop
    perform app.close_till_shift_internal(v_stale, null, null, 'day_close', null, p_device_id);
  end loop;

  -- V13: a sale queued while no shift was open is inserted at replay, and the
  -- stamp would put it in this shift, whose counted float already holds its
  -- cash. Let the queue drain first, as close_day's DAY_UNSYNCED (0020:57-64).
  if exists (select 1 from device_heartbeats h
              where h.device_id = v_station.id
                and h.queue_depth > 0
                and h.last_seen_at >= v_day.opened_at) then
    raise exception 'TILL_SHIFT_UNSYNCED' using errcode = 'P0001',
      hint = 'this till still has queued sales; open the shift once they are sent';
  end if;

  select * into v_mine from till_shifts where staff_id = auth.uid() and closed_at is null;
  if found then
    raise exception 'TILL_SHIFT_ALREADY_OPEN' using errcode = 'P0001', detail = v_mine.station_id;
  end if;
  if exists (select 1 from till_shifts where station_id = v_station.id and closed_at is null) then
    raise exception 'TILL_SHIFT_STATION_BUSY' using errcode = 'P0001';
  end if;

  -- Handover (V18): the station's last counted shift of this day, plus the
  -- cash that came in or went out at the station with no shift open (a
  -- no-shift sale, a manager's cash refund at the till), counted from that
  -- shift's opening so a sale that began before its close and landed after
  -- it is in. A new day never hands over.
  select * into v_prev
    from till_shifts
   where station_id = v_station.id
     and day_session_id = v_day.id
     and closed_at is not null
     and cash_counted_iqd is not null
   order by closed_at desc
   limit 1;
  if found then
    select coalesce(sum(p.amount_iqd), 0)
           - coalesce((select sum(r.amount_iqd)
                         from refunds r
                         join payments rp on rp.id = r.payment_id
                        where r.till_shift_id is null
                          and r.device_id = v_station.id
                          and r.venue_id = v_venue
                          and rp.method = 'cash'
                          and r.created_at > v_prev.opened_at), 0)
      into v_outside
      from payments p
     where p.till_shift_id is null
       and p.device_id = v_station.id
       and p.venue_id = v_venue
       and p.method = 'cash'
       and p.created_at > v_prev.opened_at;
    v_diff := p_opening_float_iqd - (v_prev.cash_counted_iqd + v_outside);
  end if;

  begin
    insert into till_shifts (venue_id, day_session_id, station_id, staff_id, opening_float_iqd,
                             open_note, handover_from_shift_id, handover_difference_iqd)
    values (v_venue, v_day.id, v_station.id, auth.uid(), p_opening_float_iqd,
            v_note, v_prev.id, v_diff)
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent open got there first; the same two answers as above.
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'till_shifts_one_open_per_staff' then
      raise exception 'TILL_SHIFT_ALREADY_OPEN' using errcode = 'P0001',
        detail = coalesce((select station_id from till_shifts
                            where staff_id = auth.uid() and closed_at is null), '');
    elsif v_con = 'till_shifts_one_open_per_station' then
      raise exception 'TILL_SHIFT_STATION_BUSY' using errcode = 'P0001';
    end if;
    raise;
  end;

  perform app.write_audit('drawer.shift_open', 'till_shifts', v_row.id::text, null,
                          to_jsonb(v_row) - 'open_note' - 'close_note',
                          null, null, p_device_id);

  v_result := jsonb_build_object(
    'duplicate', false,
    'till_shift', jsonb_build_object(
      'id',                v_row.id,
      'station_id',        v_row.station_id,
      'staff_id',          v_row.staff_id,
      'staff_name',        (select display_name from staff where id = v_row.staff_id),
      'opened_at',         v_row.opened_at,
      'opening_float_iqd', v_row.opening_float_iqd,
      'handover_from',     case when v_prev.id is null then null else jsonb_build_object(
                             'till_shift_id',          v_prev.id,
                             'staff_name',             (select display_name from staff where id = v_prev.staff_id),
                             'closed_at',              v_prev.closed_at,
                             'left_in_drawer_iqd',     v_prev.cash_counted_iqd,
                             'outside_cash_since_iqd', v_outside) end,
      'handover_difference_iqd', v_row.handover_difference_iqd));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $open_till_shift_0244$;

comment on function app.open_till_shift(bigint, text, text, text) is
  'till_shifts (§2.9.4). Cashier, court desk, manager, owner, beating from the station: opens the caller''s shift there on a counted float, inside the open day, and returns {duplicate, till_shift:{id, station_id, staff_id, staff_name, opened_at, opening_float_iqd, handover_from:{till_shift_id, staff_name, closed_at, left_in_drawer_iqd, outside_cash_since_iqd}|null, handover_difference_iqd}}. First ends any shift left open on the station or by the caller on a closed day (day_close). Idempotent by key. FORBIDDEN, INVALID_STATION, STATION_UNKNOWN, TILL_SHIFT_WRONG_STATION, INVALID_FLOAT, TEXT_TOO_LONG (hint note), IDEMPOTENCY_CONFLICT, NO_OPEN_DAY, TILL_SHIFT_UNSYNCED, TILL_SHIFT_ALREADY_OPEN (detail = its station), TILL_SHIFT_STATION_BUSY. Audit drawer.shift_open. Online-only.';

revoke all on function app.open_till_shift(bigint, text, text, text) from public, anon;
grant execute on function app.open_till_shift(bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. app.close_till_shift — re-issued from 20260926000205_till_shifts.sql:615
-- ---------------------------------------------------------------------------
create or replace function app.close_till_shift(
  p_till_shift_id   uuid,
  p_counted_iqd     bigint,
  p_pin             text,
  p_device_id       text,
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $close_till_shift_0244$
declare
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_replay jsonb;
  v_shift  till_shifts%rowtype;
  v_result jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_counted_iqd is null or p_counted_iqd < 0 or p_counted_iqd > 999999999999 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;
  if length(v_note) > 500 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  -- The PIN before the claim (0011; start_break 0156:95). Raises PIN_LOCKED /
  -- NO_PIN_SET itself; a wrong PIN comes back false and is RETURNED, so the
  -- attempt row it wrote commits.
  if not app.verify_own_pin(p_pin, p_device_id) then
    return jsonb_build_object('ok', false, 'code', 'PIN_INVALID');
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'close_till_shift');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_shift from till_shifts where id = p_till_shift_id for update;
  if not found or not (v_shift.venue_id = any(app.staff_venue_ids())) then
    raise exception 'TILL_SHIFT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_shift.venue_id::text, true);
  if v_shift.closed_at is not null then
    raise exception 'TILL_SHIFT_CLOSED' using errcode = 'P0001';
  end if;
  if v_shift.staff_id <> auth.uid() then
    raise exception 'TILL_SHIFT_NOT_YOURS' using errcode = 'P0001';
  end if;
  if p_device_id is distinct from v_shift.station_id then
    raise exception 'TILL_SHIFT_WRONG_STATION' using errcode = 'P0001',
      hint = 'start and end a till shift at the till itself, signed in there';
  end if;
  perform app.till_shift_station(v_shift.station_id, true);
  -- The DAY_UNSYNCED mirror (0020:57-64): queued writes reported since the
  -- shift opened would land after the count.
  if exists (select 1 from device_heartbeats h
              where h.device_id = v_shift.station_id
                and h.queue_depth > 0
                and h.last_seen_at >= v_shift.opened_at) then
    raise exception 'TILL_SHIFT_UNSYNCED' using errcode = 'P0001',
      hint = 'this till still has queued sales; count once they are sent';
  end if;

  v_result := app.close_till_shift_internal(v_shift, p_counted_iqd, v_note, 'own_pin', null, p_device_id)
              || jsonb_build_object('duplicate', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $close_till_shift_0244$;

comment on function app.close_till_shift(uuid, bigint, text, text, text, text) is
  'till_shifts (§2.9.4). The shift''s holder, with their own PIN, beating from its station: a blind count closes it. Returns {ok:true, duplicate, till_shift_id, station_id, staff_id, staff_name, opened_at, closed_at, closed_via, authorized_by_name, opening_float_iqd, cash_payments_iqd, cash_refunds_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count, drawer_open_count, left_in_drawer_iqd}, or {ok:false, code:PIN_INVALID} for a wrong PIN (returned, so the attempt counts). Idempotent by key. FORBIDDEN, INVALID_COUNT, TEXT_TOO_LONG (hint note), NO_PIN_SET, PIN_LOCKED, IDEMPOTENCY_CONFLICT, TILL_SHIFT_NOT_FOUND, TILL_SHIFT_CLOSED, TILL_SHIFT_NOT_YOURS, TILL_SHIFT_WRONG_STATION, STATION_UNKNOWN, TILL_SHIFT_UNSYNCED. Audit drawer.shift_close. Online-only.';

revoke all on function app.close_till_shift(uuid, bigint, text, text, text, text) from public, anon;
grant execute on function app.close_till_shift(uuid, bigint, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. app.close_till_shift_for — re-issued from 20260926000205_till_shifts.sql:696
-- ---------------------------------------------------------------------------
create or replace function app.close_till_shift_for(
  p_till_shift_id   uuid,
  p_counted_iqd     bigint,
  p_device_id       text,
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $close_till_shift_for_0244$
declare
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_replay jsonb;
  v_shift  till_shifts%rowtype;
  v_auth   uuid;
  v_result jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_counted_iqd is null or p_counted_iqd < 0 or p_counted_iqd > 999999999999 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;
  if length(v_note) > 500 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  -- A replay echoes the stored result and spends the grant the screen minted
  -- for this press, best effort (refund, 0139:407-413).
  v_replay := app.claim_replay(p_idempotency_key, 'close_till_shift_for');
  if v_replay is not null then
    begin
      perform app.consume_pin_grant(p_device_id);
    exception when others then
      null;
    end;
    return v_replay;
  end if;

  select * into v_shift from till_shifts where id = p_till_shift_id for update;
  if not found or not (v_shift.venue_id = any(app.staff_venue_ids())) then
    raise exception 'TILL_SHIFT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_shift.venue_id::text, true);
  if v_shift.closed_at is not null then
    raise exception 'TILL_SHIFT_CLOSED' using errcode = 'P0001';
  end if;
  if p_device_id is distinct from v_shift.station_id then
    raise exception 'TILL_SHIFT_WRONG_STATION' using errcode = 'P0001',
      hint = 'start and end a till shift at the till itself, signed in there';
  end if;
  perform app.till_shift_station(v_shift.station_id, true);
  if exists (select 1 from device_heartbeats h
              where h.device_id = v_shift.station_id
                and h.queue_depth > 0
                and h.last_seen_at >= v_shift.opened_at) then
    raise exception 'TILL_SHIFT_UNSYNCED' using errcode = 'P0001',
      hint = 'this till still has queued sales; count once they are sent';
  end if;

  -- PIN_GRANT_REQUIRED rolls the claim back with it, so a retry with the same
  -- key works once the manager has entered the PIN.
  v_auth := app.consume_pin_grant(p_device_id);

  v_result := app.close_till_shift_internal(v_shift, p_counted_iqd, v_note, 'manager_pin', v_auth, p_device_id)
              || jsonb_build_object('duplicate', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $close_till_shift_for_0244$;

comment on function app.close_till_shift_for(uuid, bigint, text, text, text) is
  'till_shifts (§2.9.4). Cashier, court desk, manager, owner, beating from the shift''s station, holding a manager-PIN grant (app.verify_manager_pin first): a blind count closes anyone''s shift, a no-PIN holder''s own included; authorized_by = the manager. Returns what app.close_till_shift returns. Idempotent by key (a replay spends the grant). FORBIDDEN, INVALID_COUNT, TEXT_TOO_LONG (hint note), IDEMPOTENCY_CONFLICT, TILL_SHIFT_NOT_FOUND, TILL_SHIFT_CLOSED, TILL_SHIFT_WRONG_STATION, STATION_UNKNOWN, TILL_SHIFT_UNSYNCED, PIN_GRANT_REQUIRED. Audit drawer.shift_close with the authorizer. Online-only.';

revoke all on function app.close_till_shift_for(uuid, bigint, text, text, text) from public, anon;
grant execute on function app.close_till_shift_for(uuid, bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. app.till_shift_status — re-issued from 20260926000205_till_shifts.sql:776
-- ---------------------------------------------------------------------------
create or replace function app.till_shift_status(p_device_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $till_shift_status_0244$
declare
  v_station stations%rowtype;
  v_mgmt    boolean := app.is_staff('manager','owner');
  v_day     day_sessions%rowtype;
  v_shift   till_shifts%rowtype;
  v_last    till_shifts%rowtype;
  v_mine    till_shifts%rowtype;
  v_fig     jsonb;
  v_outside bigint;
  v_depth   int;
  v_shift_j jsonb;
  v_last_j  jsonb;
  v_mine_j  jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_station := app.till_shift_station(p_device_id, false);

  select * into v_day
    from day_sessions
   where status = 'open' and venue_id = v_station.venue_id
   order by opened_at desc
   limit 1;

  select * into v_shift from till_shifts where station_id = v_station.id and closed_at is null;
  if found then
    v_fig := app.till_shift_figures(v_shift.id);
    v_shift_j := jsonb_build_object(
      'id',                v_shift.id,
      'staff_id',          v_shift.staff_id,
      'staff_name',        (select display_name from staff where id = v_shift.staff_id),
      'is_mine',           v_shift.staff_id = auth.uid(),
      'opened_at',         v_shift.opened_at,
      'opening_float_iqd', v_shift.opening_float_iqd,
      'payment_count',     v_fig->'payment_count',
      'refund_count',      v_fig->'refund_count',
      'drawer_open_count', v_fig->'drawer_open_count');
    if v_mgmt then
      v_shift_j := v_shift_j || jsonb_build_object('cash_expected_iqd', v_fig->'cash_expected_iqd');
    end if;
  end if;

  -- The start panel prefills left_in_drawer_iqd + outside_cash_since_iqd (V18),
  -- the null-stamped cash since that shift opened, as open_till_shift counts it.
  if v_day.id is not null then
    select * into v_last
      from till_shifts
     where station_id = v_station.id
       and day_session_id = v_day.id
       and closed_at is not null
       and cash_counted_iqd is not null
     order by closed_at desc
     limit 1;
    if found then
      select coalesce(sum(p.amount_iqd), 0)
             - coalesce((select sum(r.amount_iqd)
                           from refunds r
                           join payments rp on rp.id = r.payment_id
                          where r.till_shift_id is null
                            and r.device_id = v_station.id
                            and r.venue_id = v_station.venue_id
                            and rp.method = 'cash'
                            and r.created_at > v_last.opened_at), 0)
        into v_outside
        from payments p
       where p.till_shift_id is null
         and p.device_id = v_station.id
         and p.venue_id = v_station.venue_id
         and p.method = 'cash'
         and p.created_at > v_last.opened_at;
      v_last_j := jsonb_build_object(
        'id',                     v_last.id,
        'staff_name',             (select display_name from staff where id = v_last.staff_id),
        'closed_at',              v_last.closed_at,
        'left_in_drawer_iqd',     v_last.cash_counted_iqd,
        'outside_cash_since_iqd', v_outside);
    end if;
  end if;

  select * into v_mine
    from till_shifts
   where staff_id = auth.uid() and closed_at is null and station_id <> v_station.id;
  if found then
    v_mine_j := jsonb_build_object('id', v_mine.id, 'station_id', v_mine.station_id,
                                   'opened_at', v_mine.opened_at);
  end if;

  select h.queue_depth into v_depth from device_heartbeats h where h.device_id = v_station.id;

  return jsonb_build_object(
    'station_id',     v_station.id,
    'day',            case when v_day.id is null then null else jsonb_build_object(
                        'id', v_day.id, 'business_date', v_day.business_date,
                        'opening_float_iqd', v_day.opening_float_iqd) end,
    'shift',          v_shift_j,
    'last_closed',    v_last_j,
    'mine_elsewhere', v_mine_j,
    'queue_depth',    coalesce(v_depth, 0));
end $till_shift_status_0244$;

comment on function app.till_shift_status(text) is
  'till_shifts (§2.9.4). Cashier, court desk, manager, owner: {station_id, day:{id, business_date, opening_float_iqd}|null, shift:{id, staff_id, staff_name, is_mine, opened_at, opening_float_iqd, payment_count, refund_count, drawer_open_count, cash_expected_iqd (MGMT only; absent otherwise)}|null, last_closed:{id, staff_name, closed_at, left_in_drawer_iqd, outside_cash_since_iqd}|null, mine_elsewhere:{id, station_id, opened_at}|null, queue_depth} for the station. No heartbeat needed. FORBIDDEN, INVALID_STATION, STATION_UNKNOWN.';

revoke all on function app.till_shift_status(text) from public, anon;
grant execute on function app.till_shift_status(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 15b. stations.mode gains 'shop': the shop desk's PC. Its drawer is its own
--      till shift, like the court desk's (0205 §2.9.9); it is not a till
--      (is_till stays mode = 'till', the degraded-mode rule is unchanged).
-- ---------------------------------------------------------------------------
do $stations_mode_0244$
begin
  if exists (select 1 from pg_constraint
              where conname = 'stations_mode_chk' and conrelid = 'stations'::regclass
                and pg_get_constraintdef(oid) not like '%shop%') then
    alter table stations drop constraint stations_mode_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'stations_mode_chk' and conrelid = 'stations'::regclass) then
    alter table stations add constraint stations_mode_chk
      check (mode is null or mode in ('till', 'desk', 'kds', 'shop')) not valid;
  end if;
end
$stations_mode_0244$;
alter table stations validate constraint stations_mode_chk;

comment on column stations.mode is
  '0222 + 0244. What the machine is: till, desk, kds or shop (the Touch Shop desk), as registered by app.register_station. NULL for a station that only ever registered itself by heartbeat (0130).';

-- ---------------------------------------------------------------------------
-- 16. app.register_station — re-issued from 20260926000229_stations_on_purpose.sql:148
-- ---------------------------------------------------------------------------
create or replace function app.register_station(p_id text, p_venue_id uuid, p_mode text)
returns stations
language plpgsql security definer set search_path = public as $register_station_0244$
declare
  v_id  text := upper(btrim(coalesce(p_id, '')));
  v_old stations%rowtype;
  v_row stations%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is null or not app.is_staff_at(p_venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_id !~ '^[A-Z][A-Z0-9-]{0,31}$' then
    raise exception 'INVALID_STATION' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('till', 'desk', 'kds', 'shop') then   -- 0244: + shop
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_mode';
  end if;

  -- 0229: FOR UPDATE locks nothing while the row does not exist yet; two first
  -- registrations of one name at two branches meet here instead.
  perform pg_advisory_xact_lock(hashtextextended('station:' || v_id, 0));

  select * into v_old from stations where id = v_id for update;
  if found and v_old.retired_at is null and v_old.venue_id <> p_venue_id then
    raise exception 'STATION_OTHER_BRANCH' using errcode = 'P0001',
      hint = 'this station name is in use at another branch; retire it there first or pick another name';
  end if;
  if found and v_old.venue_id <> p_venue_id then
    -- A retired name moving branch: its till shifts pin it where it was.
    if exists (select 1 from till_shifts t where t.station_id = v_id) then
      raise exception 'STATION_HAS_HISTORY' using errcode = 'P0001',
        hint = 'this station name has till shifts at another branch; pick another name';
    end if;
    delete from station_staff where station_id = v_id;
    delete from device_heartbeats where device_id = v_id;
  end if;

  perform set_config('app.venue_id', p_venue_id::text, true);
  insert into stations (id, venue_id, is_till, registered_by, mode)
  values (v_id, p_venue_id, p_mode = 'till', auth.uid(), p_mode)
  on conflict (id) do update
     set venue_id      = excluded.venue_id,
         is_till       = excluded.is_till,
         mode          = excluded.mode,
         registered_by = excluded.registered_by,
         registered_at = now(),
         retired_at    = null
  returning * into v_row;

  -- A desk or kitchen screen is not a till, whatever it said when it beat.
  if p_mode <> 'till' then
    update device_heartbeats set is_till = false where device_id = v_id and is_till;
  end if;

  perform app.write_audit('station.register', 'stations', v_id,
                          case when v_old.id is null then null else to_jsonb(v_old) end, to_jsonb(v_row));
  return v_row;
end
$register_station_0244$;

-- ---------------------------------------------------------------------------
-- 17. app.protocol_engine_roles — re-issued from 20260926000194_assistant_barista_waiter_access.sql:614
-- ---------------------------------------------------------------------------
create or replace function app.protocol_engine_roles(p_roles jsonb)
returns staff_role[]
language plpgsql stable set search_path = public as $protocol_engine_roles_0244$
declare
  c_hireable constant text[] := array['cashier','waiter','court_desk','shop_staff','manager','head_barista','barista',
                                      'assistant_barista','head_chef','chef','driver','marketing'];
  v_roles text[];
begin
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' or jsonb_array_length(p_roles) = 0
     or exists (select 1 from jsonb_array_elements(p_roles) e where jsonb_typeof(e) <> 'string') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'actor_roles';
  end if;
  v_roles := array(select jsonb_array_elements_text(p_roles));
  if exists (select 1 from unnest(v_roles) r where not (r = any(c_hireable)))
     or cardinality(v_roles) <> (select count(distinct r) from unnest(v_roles) r) then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'actor_roles';
  end if;
  return v_roles::staff_role[];
end $protocol_engine_roles_0244$;

comment on function app.protocol_engine_roles(jsonb) is
  'protocols_engine_rpcs (§2.7). Internal: parses an owner-added step''s actor_roles; INVALID_ROLE unless a non-empty array of distinct hireable roles (cashier, waiter, court_desk, shop_staff, manager, head_barista, barista, assistant_barista, head_chef, chef, driver, marketing), re-issued by assistant_barista_waiter_access (wave 5 §2.1.4) and shop_desk_access (0244: + shop_staff).';

revoke all on function app.protocol_engine_roles(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 18. app.protocol_check_hiring_open_position — re-issued from 20260926000194_assistant_barista_waiter_access.sql:645
-- ---------------------------------------------------------------------------
create or replace function app.protocol_check_hiring_open_position(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_hiring_open_position_0244$
declare
  v_start date;
  v_min   bigint;
  v_max   bigint;
begin
  perform app.hiring_only_keys(p_record, array['role', 'why', 'hours', 'start_date', 'pay_min_iqd', 'pay_max_iqd']);

  if p_record->>'role' = 'prep' then
    raise exception 'ROLE_RETIRED' using errcode = 'P0001', hint = 'role';
  end if;
  if jsonb_typeof(p_record->'role') is distinct from 'string'
     or p_record->>'role' not in ('cashier', 'waiter', 'court_desk', 'shop_staff', 'manager', 'head_barista', 'barista',
                                  'assistant_barista', 'head_chef', 'chef', 'driver', 'marketing') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'role';
  end if;

  if jsonb_typeof(p_record->'start_date') is distinct from 'string'
     or p_record->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'start_date';
  end if;
  begin
    v_start := (p_record->>'start_date')::date;
  exception when others then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'start_date';
  end;

  v_min := app.hiring_iqd(p_record->'pay_min_iqd', 'pay_min_iqd');
  v_max := app.hiring_iqd(p_record->'pay_max_iqd', 'pay_max_iqd');
  if v_min is not null and v_max is not null and v_min > v_max then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'pay_max_iqd';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'role',        p_record->>'role',
    'why',         app.hiring_text(p_record->'why', 2000, true, 'why'),
    'hours',       app.hiring_text(p_record->'hours', 300, true, 'hours'),
    'start_date',  v_start,
    'pay_min_iqd', v_min,
    'pay_max_iqd', v_max));
end $protocol_check_hiring_open_position_0244$;

comment on function app.protocol_check_hiring_open_position(uuid, jsonb, text[]) is
  'hiring (§2.8). Internal check hook: open_position {role (hireable; ROLE_RETIRED for prep), why, hours (<= 300), start_date (YYYY-MM-DD), pay_min_iqd?, pay_max_iqd? (min <= max)}. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_hiring_open_position(uuid, jsonb, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 19. Reads for the shop assistant: the shop's own rows and nothing else.
--     New permissive policies beside the café staff's (which are unchanged):
--     Postgres ORs them, so shop_staff sees a tab, order, line, payment,
--     refund or adjustment only when its tab is a shop tab at a branch in
--     scope, and the day it belongs to. (select …) wrapping as 0234.
-- ---------------------------------------------------------------------------
drop policy if exists day_sessions_shop_staff_read on day_sessions;
create policy day_sessions_shop_staff_read on day_sessions for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists tabs_shop_staff_read on tabs;
create policy tabs_shop_staff_read on tabs for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and kind = 'shop'
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists orders_shop_staff_read on orders;
create policy orders_shop_staff_read on orders for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[])
         and exists (select 1 from tabs t where t.id = orders.tab_id and t.kind = 'shop'));

drop policy if exists order_items_shop_staff_read on order_items;
create policy order_items_shop_staff_read on order_items for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and exists (select 1 from orders o join tabs t on t.id = o.tab_id
                      where o.id = order_items.order_id and t.kind = 'shop'
                        and o.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists order_item_modifiers_shop_staff_read on order_item_modifiers;
create policy order_item_modifiers_shop_staff_read on order_item_modifiers for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and exists (select 1 from order_items oi
                       join orders o on o.id = oi.order_id
                       join tabs t on t.id = o.tab_id
                      where oi.id = order_item_modifiers.order_item_id and t.kind = 'shop'
                        and o.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists payments_shop_staff_read on payments;
create policy payments_shop_staff_read on payments for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[])
         and exists (select 1 from tabs t where t.id = payments.tab_id and t.kind = 'shop'));

drop policy if exists refunds_shop_staff_read on refunds;
create policy refunds_shop_staff_read on refunds for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[])
         and exists (select 1 from payments p join tabs t on t.id = p.tab_id
                      where p.id = refunds.payment_id and t.kind = 'shop'));

drop policy if exists tab_adjustments_shop_staff_read on tab_adjustments;
create policy tab_adjustments_shop_staff_read on tab_adjustments for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and exists (select 1 from tabs t
                      where t.id = tab_adjustments.tab_id and t.kind = 'shop'
                        and t.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists refund_items_shop_staff_read on refund_items;
create policy refund_items_shop_staff_read on refund_items for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and exists (select 1 from refunds r
                       join payments p on p.id = r.payment_id
                       join tabs t on t.id = p.tab_id
                      where r.id = refund_items.refund_id and t.kind = 'shop'
                        and r.venue_id = any ((select app.visible_venue_ids())::uuid[])));
