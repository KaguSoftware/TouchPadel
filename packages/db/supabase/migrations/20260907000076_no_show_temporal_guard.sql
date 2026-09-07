-- 0076_no_show_temporal_guard — restore the SEC-11 gate that 0075 reverted.
--
-- WHAT HAPPENED. Two migrations changed app.mark_reservation a day apart, and
-- the second was written against the body the first had already replaced:
--
--   0071 (2026-09-06, SEC-11) added a TEMPORAL GUARD: no_show and completed are
--        refused while now() < start_at.
--   0075 (2026-09-07) re-issued the function from the 0026 body to stamp
--        cancelled_at / cancellation_reason and drive the push trigger.
--
-- `create or replace function` replaces the WHOLE body, so 0075 silently
-- reverted the guard. Nothing failed: 0075's own tests passed, because they mark
-- FUTURE bookings. The regression was only visible as two red tests in
-- booking-integrity.test.ts, and only once a stack existed to run them on.
-- Caught 2026-09-07 on the first execution either migration ever had.
--
-- This is not a criticism of 0075 — its findings are real and its fix is right.
-- It is the cost of two people editing one function through CREATE OR REPLACE.
-- The lasting protection is the test, which now fails the moment the guard goes
-- missing again, whoever removes it and however innocently.
--
-- THE MERGED BODY, and why each half stays:
--
--   0075's half — an ending must LOOK ended. A no-show that leaves cancelled_at
--   null reads as live to every consumer that asks "is this over?", and the
--   guest's phone keeps the booking and still gets the 3-hour reminder.
--
--   0071's half — an ending must not be REACHABLE EARLY. no_show and completed
--   both leave the exclusion predicate (0008: pending/confirmed/arrived), so
--   either one frees the court the instant it is written. On a booking that has
--   not started, that is a paid Friday slot marked absent on Tuesday and sold
--   twice, showing in the ledger as an unremarkable no-show. `arrived` is not
--   guarded: it stays inside the predicate and frees nothing, so an early
--   check-in is still ordinary desk work.
--
-- The legitimate early exit is untouched: app.cancel_reservation still frees a
-- future slot, with a reason and the cancellation window. A desk that needs the
-- court back before the slot starts cancels the booking — which says so.
--
-- covered by packages/db/tests/booking-integrity.test.ts (SEC-11)
--         and packages/db/tests/no-show.test.ts (0075's terminal bookkeeping)

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.mark_reservation(
  p_reservation_id uuid,
  p_status         reservation_status,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $mark_reservation_0076$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_ok     boolean;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_ok := (p_status = 'arrived'   and v.status = 'confirmed')
       or (p_status = 'no_show'   and v.status = 'confirmed')
       or (p_status = 'completed' and v.status in ('confirmed','arrived'));
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  -- 0071 (SEC-11), restored. Checked against the FOR UPDATE read, so it cannot
  -- race a concurrent move that shifted start_at.
  if p_status in ('no_show','completed') and now() < v.start_at then
    raise exception 'RESERVATION_NOT_STARTED' using errcode = 'P0001',
      detail = format('starts at %s', v.start_at),
      hint = 'a future booking is cancelled through cancel_reservation with a reason, not marked no_show';
  end if;

  v_before := to_jsonb(v);

  -- 0075: the booking is over from this moment. Anything asking "has this
  -- ended?" reads cancelled_at, and a no-show used to leave it null.
  update reservations
     set status = p_status,
         cancelled_at = case when p_status in ('no_show','completed')
                             then coalesce(v.cancelled_at, now())
                             else v.cancelled_at end,
         cancellation_reason = case when p_status = 'no_show'
                                    then coalesce(p_reason, 'no_show')
                                    else v.cancellation_reason end
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.mark_' || p_status::text, 'reservations',
                          v.id::text, v_before, to_jsonb(v),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $mark_reservation_0076$;

comment on function app.mark_reservation(uuid, reservation_status, text) is
  '0076 = 0075 + 0071/SEC-11. arrived / no_show / completed. The two ENDINGS stamp cancelled_at (a no_show also stamps cancellation_reason) AND are refused before start_at with RESERVATION_NOT_STARTED, because both leave the exclusion set and would free a future court for resale. A no_show is not a cancellation: the reports count them separately.';

revoke all on function app.mark_reservation(uuid, reservation_status, text) from public, anon;
grant execute on function app.mark_reservation(uuid, reservation_status, text) to authenticated;
