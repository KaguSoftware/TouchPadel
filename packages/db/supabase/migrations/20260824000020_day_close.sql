-- 0020_day_close — business-day lifecycle (design-data.md §1.6 tail).
--
--  * app.open_day ships in 0015 (tabs drop) — signature (bigint, date, text);
--    this file adds close_day + the summary views only (a second open_day
--    overload here would make the RPC ambiguous).
--  * close_day refuses while open tabs exist (DAY_OPEN_TABS) or any till still
--    reports a non-empty replay queue (DAY_UNSYNCED — queue depth arrives via
--    app.heartbeat, 0021; bodies are not validated at creation, so the forward
--    reference is safe on a fresh run).
--  * cash_expected = opening float + Σ cash payments − Σ cash refunds; the
--    variance is stamped on the row, never recomputed.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- app.close_day — guards first, then expected-cash math, then stamp.
-- ---------------------------------------------------------------------------
create or replace function app.close_day(
  p_cash_counted_iqd bigint,
  p_card_batch_iqd   bigint default null,
  p_notes            text default null,
  p_device_id        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_day           day_sessions%rowtype;
  v_before        jsonb;
  v_cash_in       bigint;
  v_cash_refunds  bigint;
  v_card_in       bigint;
  v_card_refunds  bigint;
  v_cash_expected bigint;
  v_card_expected bigint;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cash_counted_iqd is null or p_cash_counted_iqd < 0 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;

  select * into v_day from day_sessions
   where status in ('open','closing')
   order by opened_at desc limit 1
   for update;
  if not found then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- Guard 1: every tab settled or voided before the day closes.
  if exists (select 1 from tabs
              where day_session_id = v_day.id and status in ('open','awaiting_payment')) then
    raise exception 'DAY_OPEN_TABS' using errcode = 'P0001',
      hint = 'settle or void every open tab before closing the day';
  end if;

  -- Guard 2: no till may still hold queued (unreplayed) writes. Queue depth is
  -- reported by app.heartbeat (0021); a device silent since before the day
  -- opened does not block.
  if exists (select 1 from device_heartbeats
              where queue_depth > 0 and last_seen_at >= v_day.opened_at) then
    raise exception 'DAY_UNSYNCED' using errcode = 'P0001',
      hint = 'a till still has queued offline writes; let it finish replaying';
  end if;

  v_before := to_jsonb(v_day);

  select coalesce(sum(p.amount_iqd), 0) into v_cash_in
    from payments p where p.day_session_id = v_day.id and p.method = 'cash';
  select coalesce(sum(r.amount_iqd), 0) into v_cash_refunds
    from refunds r join payments p on p.id = r.payment_id
   where p.day_session_id = v_day.id and p.method = 'cash';
  select coalesce(sum(p.amount_iqd), 0) into v_card_in
    from payments p where p.day_session_id = v_day.id and p.method = 'card';
  select coalesce(sum(r.amount_iqd), 0) into v_card_refunds
    from refunds r join payments p on p.id = r.payment_id
   where p.day_session_id = v_day.id and p.method = 'card';

  v_cash_expected := v_day.opening_float_iqd + v_cash_in - v_cash_refunds;
  v_card_expected := v_card_in - v_card_refunds;

  update day_sessions
     set status                  = 'closed',
         closed_at               = now(),
         closed_by               = auth.uid(),
         cash_expected_iqd       = v_cash_expected,
         cash_counted_iqd        = p_cash_counted_iqd,
         cash_variance_iqd       = p_cash_counted_iqd - v_cash_expected,
         card_expected_iqd       = v_card_expected,
         card_terminal_batch_iqd = p_card_batch_iqd,
         notes                   = coalesce(p_notes, notes)
   where id = v_day.id
   returning * into v_day;

  perform app.write_audit('day.close', 'day_sessions', v_day.id::text,
                          v_before, to_jsonb(v_day), null, null, p_device_id);

  return jsonb_build_object(
    'day_session_id',    v_day.id,
    'business_date',     v_day.business_date,
    'cash_expected_iqd', v_day.cash_expected_iqd,
    'cash_counted_iqd',  v_day.cash_counted_iqd,
    'cash_variance_iqd', v_day.cash_variance_iqd,
    'card_expected_iqd', v_day.card_expected_iqd,
    'card_terminal_batch_iqd', v_day.card_terminal_batch_iqd);
end $$;

-- ---------------------------------------------------------------------------
-- Day-close summary: one row per day session with the sums the close screen
-- and the morning-after review need — discounts / voids / refunds / waste,
-- with authorizer names where an authorizer exists (adjustments carry one
-- directly; void/refund authorizers live in audit_log — see
-- v_day_close_adjustments for the drill-down).
-- security_invoker: day_sessions RLS (staff read per matrix) gates it.
-- ---------------------------------------------------------------------------
create view v_day_close_summary with (security_invoker = on) as
select d.id as day_session_id,
       d.business_date, d.status, d.opened_at, d.closed_at,
       d.opening_float_iqd,
       d.cash_expected_iqd, d.cash_counted_iqd, d.cash_variance_iqd,
       d.card_expected_iqd, d.card_terminal_batch_iqd,
       pay.cash_payments_iqd, pay.card_payments_iqd,
       ref.refunds_iqd, ref.refund_count,
       adj.discounts_iqd, adj.adjustment_count, adj.authorizer_names,
       vv.voided_lines_iqd, vv.voided_line_count,
       w.waste_cost_iqd,
       d.notes
  from day_sessions d
  left join lateral (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0) as cash_payments_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0) as card_payments_iqd
      from payments p where p.day_session_id = d.id
  ) pay on true
  left join lateral (
    select coalesce(sum(r.amount_iqd), 0) as refunds_iqd, count(r.id) as refund_count
      from refunds r join payments p on p.id = r.payment_id
     where p.day_session_id = d.id
  ) ref on true
  left join lateral (
    select coalesce(sum(a.amount_iqd), 0) as discounts_iqd,
           count(a.id)                    as adjustment_count,
           array_remove(array_agg(distinct s.display_name), null) as authorizer_names
      from tab_adjustments a
      join tabs t on t.id = a.tab_id
      left join staff s on s.id = a.authorized_by
     where t.day_session_id = d.id
  ) adj on true
  left join lateral (
    select coalesce(sum(oi.line_total_iqd), 0) as voided_lines_iqd,
           count(oi.id)                        as voided_line_count
      from order_items oi
      join orders o on o.id = oi.order_id
      join tabs t on t.id = o.tab_id
     where t.day_session_id = d.id and oi.voided
  ) vv on true
  left join lateral (
    select coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0)))::bigint, 0) as waste_cost_iqd
      from stock_movements sm
     where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= d.opened_at
       and sm.at <= coalesce(d.closed_at, now())
  ) w on true;

-- Drill-down: every PIN-authorized adjustment of a day, with names.
create view v_day_close_adjustments with (security_invoker = on) as
select t.day_session_id,
       a.id as adjustment_id, a.tab_id, a.order_item_id,
       a.kind, a.value, a.amount_iqd, a.reason_code, a.created_at,
       ap.display_name as applied_by_name,
       au.display_name as authorized_by_name
  from tab_adjustments a
  join tabs t on t.id = a.tab_id
  left join staff ap on ap.id = a.applied_by
  left join staff au on au.id = a.authorized_by;

grant select on v_day_close_summary, v_day_close_adjustments to authenticated;

revoke all on function app.close_day(bigint, bigint, text, text) from public, anon;
grant execute on function app.close_day(bigint, bigint, text, text) to authenticated;
