-- 0085_cancel_empty_tab — app.cancel_tab, for the tab that should never have
-- been opened.
--
-- THE PROBLEM. A tab could be created but never destroyed. The cashier who
-- opened T4 when they meant T6 had two ways out: settle it for zero, which
-- writes a payment row and a settled tab into the day's takings for a sale
-- that never happened, or merge it into another tab, which needs a second tab
-- to merge into and reads as "these guests sat together" in the audit trail.
-- Both lie about the evening. So the wrong tabs were left sitting on the
-- board, and app.close_day — which refuses to close while any tab is open —
-- turned each one into a puzzle at 1am.
--
-- THE RULE. A tab may be cancelled only while there is NOTHING to reconcile:
-- no orders, no payments, no adjustments, and no booking (a booking carries
-- the court fee, which is money owed whether or not anyone has ordered a
-- drink). That is checked here rather than trusted from the client, because
-- the till's copy of a tab is a cached read and can be seconds stale — a
-- waiter's order landing between the render and the press is exactly the race
-- this guard exists for.
--
-- WHY 'void' AND NOT A DELETE. `tabs.id` is referenced by orders, payments,
-- tab_adjustments and merged_into_tab_id, and the row is the only record that
-- a tab number was ever issued. Voiding keeps the audit trail (0005 writes the
-- before/after) and reuses the state close_day already accepts. It leaves
-- merged_into_tab_id NULL, which is what distinguishes a cancelled tab from a
-- merged one for anybody reading the table later.
--
-- The guest side is unaffected on purpose: app.guest_place_order looks for the
-- table's tab WHERE status = 'open', so a scan after a cancellation opens a
-- fresh tab rather than resurrecting the void one.

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.cancel_tab(p_tab_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $cancel_0085$
declare
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_before jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Lock order (0038/0044): day_sessions -> tabs -> orders -> payments.
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
  -- 'awaiting_payment' lands here too: the name says what is owed.
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001', detail = v_tab.status;
  end if;
  if v_tab.day_session_id <> v_day then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;

  -- Every branch below is money, or the record of money, on this tab. `detail`
  -- names which one so the audit trail and a support call can tell them apart;
  -- the till shows one message for all four, because the cashier's next move
  -- is the same in each case — settle it, do not cancel it.
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
  if v_tab.reservation_id is not null then
    raise exception 'TAB_NOT_EMPTY' using errcode = 'P0001', detail = 'reservation',
      hint = 'the booking''s court fee is owed on this tab';
  end if;

  v_before := to_jsonb(v_tab);

  update tabs
     set status = 'void', subtotal_iqd = 0, tax_iqd = 0, discount_iqd = 0, total_iqd = 0
   where id = v_tab.id
   returning * into v_tab;

  perform app.write_audit('tab.cancel', 'tabs', v_tab.id::text,
                          v_before, to_jsonb(v_tab), 'tab_cancelled');

  return jsonb_build_object('tab_id', v_tab.id, 'status', v_tab.status);
end $cancel_0085$;

comment on function app.cancel_tab(uuid) is
  '0085. Voids an OPEN tab that has no orders, no payments, no adjustments and no booking — the tab opened on the wrong table. Raises TAB_NOT_EMPTY (detail names which) when there is anything to reconcile; merged and already-settled tabs raise TAB_MERGED / TAB_NOT_OPEN. Audited as tab.cancel.';

revoke all on function app.cancel_tab(uuid) from public, anon;
grant execute on function app.cancel_tab(uuid) to authenticated;
