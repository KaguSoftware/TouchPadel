-- 0089_mark_reservation_reassert — the 0076 body, re-issued so that the hosted
-- project ends up with it whatever order the migrations were applied in.
--
-- WHAT HAPPENED. `20260906000071_booking_integrity.sql` (Phase 2, written on a
-- branch) reached `main` AFTER `20260907000071..75` had been pushed to the
-- hosted project by hand. Its version sorts BEFORE versions already on the
-- remote ledger, and `supabase db push` refuses an out-of-order file unless it
-- is told `--include-all` — so from that merge on, every push (manual and the
-- CI job) was refused, and nothing from 0077 onward applied either. Found on
-- 2026-09-12 when the phone's booking list, which reads 0088's `cancelled_by`,
-- failed against the hosted schema.
--
-- The repair pushes with `--include-all`, which applies 0071 AFTER 0076. That
-- is the one place the late apply is not harmless: 0071 also issues
-- `create or replace function app.mark_reservation`, and 0075/0076 — already on
-- the ledger — issued it again with the merged body ("0076 = 0075 + 0071"). A
-- plain `create or replace` replaces the WHOLE body, so the late 0071 would
-- have reverted the 0075 half (cancelled_at / cancellation_reason stamping on
-- no_show and completed) exactly as 0075 once reverted the 0071 half. Every
-- other object 0071 defines — move_reservation, extend_reservation,
-- expire_stale_holds, upsert_rate_rule, reason_given, the two CHECK constraints
-- — has 0071 as its latest definition, so the late apply leaves them correct.
--
-- This file re-asserts the 0076 body, comment and grants, byte for byte apart
-- from the dollar tag. On a clean slate (CI, local reset) the order is
-- 0071 -> 0076 -> 0089 and the final function is unchanged; on hosted it is
-- 0076 -> 0071 -> 0089 and the final function is the same one. The 0071 file is
-- deliberately NOT renamed: every stack that already applied it would need a
-- ledger repair, and its constraints are only conditionally idempotent.
--
-- The lasting protection is in `scripts/check-migrations.mjs`: a new migration
-- whose version sorts before one already on `main` now fails the pull request,
-- and so does a duplicate version. Neither finding is waivable — the remote
-- ledger does not honour intent.
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
language plpgsql security definer set search_path = public as $mark_reservation_0089$
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
end $mark_reservation_0089$;

comment on function app.mark_reservation(uuid, reservation_status, text) is
  '0089 = the 0076 body re-asserted (0076 = 0075 + 0071/SEC-11), so a hosted ledger that applied 0071 after 0076 ends on the merged body. arrived / no_show / completed. The two ENDINGS stamp cancelled_at (a no_show also stamps cancellation_reason) AND are refused before start_at with RESERVATION_NOT_STARTED, because both leave the exclusion set and would free a future court for resale. A no_show is not a cancellation: the reports count them separately.';

revoke all on function app.mark_reservation(uuid, reservation_status, text) from public, anon;
grant execute on function app.mark_reservation(uuid, reservation_status, text) to authenticated;
