-- ===========================================================================
-- 0120 — the till's remaining money corrections join the durable queue
-- (Phase 2 milestone 0, item 9 / C3; decision Parsa 2026-09-20).
--
-- WHAT CHANGES. Four RPCs the operator called directly (online only) become
-- queued mutation types, so a correction made on a till that has lost the
-- link is written to disk and replayed, exactly like an order or a payment:
--
--   payment.refund    -> app.refund          gains p_idempotency_key + claim_replay
--   tab.settle_zero   -> app.settle_zero_tab gains p_idempotency_key + claim_replay
--   tab.cancel        -> app.cancel_tab      gains p_device_id AND p_idempotency_key
--                                            + claim_replay; the audit row now
--                                            carries the device
--   order_item.void   -> app.void_after_send UNCHANGED: app.void_order_item_internal
--                                            (0039) already answers a second call
--                                            with {duplicate:true}, so it is
--                                            state-idempotent like set_ticket_status
--   stock.waste       -> app.record_waste    UNCHANGED: keyed since 0049; the
--                                            screen simply starts using the
--                                            already-registered type
--
-- WHY A KEY. refund inserts a refunds row per call and refunds has no unique
-- column; settle_zero_tab and cancel_tab answer a second call with TAB_NOT_OPEN,
-- a refusal, so a response lost between the server and the till would file a
-- real close as a failed queue row (the C1 class). app.claim_replay (0049) is
-- the ledger that fits all three: it stores the first result and echoes it,
-- with duplicate:true, to every replay of the same key by the same caller.
--
-- WHERE THE CLAIM SITS. After the role and reason guards (an unauthorised
-- caller cannot burn keys) and BEFORE any lock or write, as 0049 placed it in
-- apply_discount; a replay therefore returns before current_open_day_locked()
-- or the PIN grant is touched. Every raise below the claim rolls it back with
-- the work.
--
-- STAYING ONLINE-ONLY by decision (scope ledger, HANDOFF.md): merge_tabs (two
-- tabs re-checked under lock), record_drawer_open, open_day, close_day (the
-- day boundary must be authoritative).
--
-- Signature changes: drop by exact prior type list, create, re-issue the
-- grants and the comments (a drop discards them). sync_replays.entity gains
-- the values 'refund' and 'order_item' (free text, 0021:41).
--
-- covered by packages/db/tests/replay-idempotency.test.ts (0120 cases) and
-- apps/operator/src/lib/mutate.test.ts (golden args)
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.refund — $refund_0115$ (0115:480-578) VERBATIM plus the claim and
--    the stored result. Prior signature (uuid, bigint, text, text, jsonb, text).
-- ---------------------------------------------------------------------------
drop function if exists app.refund(uuid, bigint, text, text, jsonb, text);

create function app.refund(
  p_payment_id      uuid,
  p_amount_iqd      bigint,
  p_pin             text,
  p_reason_code     text,
  p_items           jsonb default null,
  p_device_id       text  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0120$
declare
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

  -- 0120: claim after the guards and before any write or lock (0049 pattern).
  -- A replay of the same key by the same caller returns the stored result
  -- here, before the PIN grant is touched.
  v_replay := app.claim_replay(p_idempotency_key, 'refund');
  if v_replay is not null then
    return v_replay;
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

  v_result := jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $refund_0120$;

comment on function app.refund(uuid, bigint, text, text, jsonb, text, text) is
  '0120 (0044, 0115). Refunds part or all of one payment (manager, owner) behind a manager-PIN grant; naming order lines restocks them. p_idempotency_key: a replay of the same key by the same caller echoes the first result with duplicate:true (app.claim_replay). REFUND_EXCEEDS_PAYMENT (detail = paid/refunded), PAYMENT_NOT_FOUND, ITEM_NOT_ON_TAB, INVALID_QTY, INVALID_AMOUNT.';

revoke all on function app.refund(uuid, bigint, text, text, jsonb, text, text) from public, anon;
grant execute on function app.refund(uuid, bigint, text, text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.settle_zero_tab — $settle_zero_0106$ (0106:536-613) VERBATIM plus the
--    claim and the stored result. Prior signature (uuid, text, text).
-- ---------------------------------------------------------------------------
drop function if exists app.settle_zero_tab(uuid, text, text);

create function app.settle_zero_tab(
  p_tab_id          uuid,
  p_reason_code     text,
  p_device_id       text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_zero_0120$
declare
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
end $settle_zero_0120$;

revoke all on function app.settle_zero_tab(uuid, text, text, text) from public, anon;
grant execute on function app.settle_zero_tab(uuid, text, text, text) to authenticated;

comment on function app.settle_zero_tab(uuid, text, text, text) is
  '0120 (0106). Closes an open/awaiting tab that owes nothing (total = net paid) as settled, with a reason, and no payments row. NOT_ZERO when money is owed, REFUND_DUE (detail = amount) when more was paid than is owed, TAB_EMPTY when nothing was ever on it (use cancel_tab). p_idempotency_key: a replay echoes the first result with duplicate:true (app.claim_replay). Audited as tab.settle with zero_close.';

-- ---------------------------------------------------------------------------
-- 3. app.cancel_tab — $cancel_0106$ (0106:625-692) VERBATIM plus p_device_id
--    (now on the audit row), the claim and the stored result. Prior signature
--    (uuid, text).
-- ---------------------------------------------------------------------------
drop function if exists app.cancel_tab(uuid, text);

create function app.cancel_tab(
  p_tab_id          uuid,
  p_reason_code     text default null,
  p_device_id       text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $cancel_0120$
declare
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
end $cancel_0120$;

revoke all on function app.cancel_tab(uuid, text, text, text) from public, anon;
grant execute on function app.cancel_tab(uuid, text, text, text) to authenticated;

comment on function app.cancel_tab(uuid, text, text, text) is
  '0120 (0106, 0100). Voids an OPEN tab with no orders, payments or adjustments, and no court fee still owed on its booking (cashier, court_desk, manager, owner). p_reason_code is mandatory. Raises TAB_NOT_EMPTY (detail names which) when there is anything to reconcile. p_idempotency_key: a replay echoes the first result with duplicate:true (app.claim_replay). Audited as tab.cancel, with the device.';
