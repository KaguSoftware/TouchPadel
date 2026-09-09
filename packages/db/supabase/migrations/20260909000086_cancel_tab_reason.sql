-- 0086_cancel_tab_reason — app.cancel_tab records WHY the tab went.
--
-- 0085 gave the cashier a way to take back a tab opened on the wrong table,
-- and wrote the audit row with a fixed 'tab_cancelled' where every other
-- destructive RPC in the till writes the reason the operator chose. So the
-- audit log could say a tab was cancelled, and by whom, and never why — while
-- the same log answers that question for a void, a discount, an override and
-- a booking cancellation. The till now asks (ReasonCodePrompt, the same
-- picker as a cancelled booking) and the answer has to have somewhere to go.
--
-- The parameter is a plain text code, optionally with the operator's note
-- appended as 'code: note' — the shape app.cancel_reservation already takes
-- from the same prompt, so the audit log reads consistently across the two
-- cancellations a venue actually performs.
--
-- REASON_REQUIRED rather than a silent default: a reason that may be omitted
-- is a reason nobody fills in. It defaults to NULL only so the 1-argument
-- signature keeps parsing at call sites that predate this migration; a NULL
-- (or blank) reason is refused at the top of the body, before anything is
-- read or locked.
--
-- The 1-arg function is DROPPED, not left beside this one. PostgREST resolves
-- an RPC by the argument names in the request body, and two candidates that
-- both accept {p_tab_id} make every call ambiguous.

set lock_timeout = '3s';
set statement_timeout = '60s';

drop function if exists app.cancel_tab(uuid);

create or replace function app.cancel_tab(p_tab_id uuid, p_reason_code text default null)
returns jsonb
language plpgsql security definer set search_path = public as $cancel_0086$
declare
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_before jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
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
                          v_before, to_jsonb(v_tab), v_reason);

  return jsonb_build_object('tab_id', v_tab.id, 'status', v_tab.status);
end $cancel_0086$;

comment on function app.cancel_tab(uuid, text) is
  '0086 (0085). Voids an OPEN tab that has no orders, no payments, no adjustments and no booking — the tab opened on the wrong table. p_reason_code is the operator''s chosen code, optionally ''code: note'', and is mandatory (REASON_REQUIRED); it is written to the audit row. Raises TAB_NOT_EMPTY (detail names which) when there is anything to reconcile; merged and already-settled tabs raise TAB_MERGED / TAB_NOT_OPEN. Audited as tab.cancel.';

revoke all on function app.cancel_tab(uuid, text) from public, anon;
grant execute on function app.cancel_tab(uuid, text) to authenticated;
