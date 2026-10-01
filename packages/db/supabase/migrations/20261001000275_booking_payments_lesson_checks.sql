set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0275 booking_payments_lesson_checks — coaching, lane Money
-- (docs/design/coaching/money.md §3.1; build contracts §1.1, §1.2). CHECK
-- widening only, alone in its file.
--
--   purpose        + 'lesson'        a lesson place paid online (Qi; 0284)
--   refund_reason  + 'coach_cancel'  the coach cancelled (or was retired)
--                  + 'under_filled'  a group session or course below its
--                                    minimum at its cut-off (C-14)
--
-- Both are inline column CHECKs of 0241, re-issued by name in 0254
-- (booking_payments_purpose_check, booking_payments_refund_reason_check); this
-- is the 0254 shape again. The table constraint booking_payments_refund_reason
-- (0241:70-72) is a different one and is not touched. Safe alone: nothing
-- writes purpose 'lesson' before 0284, and until 0278 re-creates it the 0258
-- anchor refuses any lesson-shaped row anyway.

alter table booking_payments drop constraint if exists booking_payments_purpose_check;
alter table booking_payments add constraint booking_payments_purpose_check
  check (purpose in ('deposit', 'ticket', 'lesson')) not valid;

alter table booking_payments drop constraint if exists booking_payments_refund_reason_check;
alter table booking_payments add constraint booking_payments_refund_reason_check
  check (refund_reason is null or refund_reason in
    ('guest_cancel', 'staff_cancel', 'no_show', 'slot_lost', 'venue_offline', 'amount_mismatch',
     'duplicate_success', 'manual', 'staff_refund', 'ticket_cashout', 'account_deleted',
     'coach_cancel', 'under_filled')) not valid;

do $booking_payments_purpose_validate_0275$
begin
  if exists (select 1 from pg_constraint
              where conname = 'booking_payments_purpose_check'
                and conrelid = 'public.booking_payments'::regclass
                and not convalidated) then
    alter table booking_payments validate constraint booking_payments_purpose_check;
  end if;
end $booking_payments_purpose_validate_0275$;

do $booking_payments_refund_reason_validate_0275$
begin
  if exists (select 1 from pg_constraint
              where conname = 'booking_payments_refund_reason_check'
                and conrelid = 'public.booking_payments'::regclass
                and not convalidated) then
    alter table booking_payments validate constraint booking_payments_refund_reason_check;
  end if;
end $booking_payments_refund_reason_validate_0275$;
