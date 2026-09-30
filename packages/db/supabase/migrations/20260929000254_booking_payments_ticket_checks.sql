set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0254 booking_payments_ticket_checks — open matches, lane Money
-- (docs/design/open-matches/money.md §3, build contracts §1.1). CHECK widening
-- only, alone in its file.
--
--   purpose        + 'ticket'  an open-match ticket purchase (a chain row, 0258)
--   refund_reason  + 'ticket_cashout', 'account_deleted'
--
-- Both are inline column CHECKs of 0241, so Postgres named them
-- booking_payments_purpose_check (0241:33) and
-- booking_payments_refund_reason_check (0241:53-55). The table constraint
-- booking_payments_refund_reason (0241:70-72) is a different one and is not
-- touched. Safe on its own: nothing writes purpose 'ticket' before 0259, and
-- 0258 scopes every deposit hook to purpose 'deposit' first.

alter table booking_payments drop constraint if exists booking_payments_purpose_check;
alter table booking_payments add constraint booking_payments_purpose_check
  check (purpose in ('deposit', 'ticket')) not valid;

alter table booking_payments drop constraint if exists booking_payments_refund_reason_check;
alter table booking_payments add constraint booking_payments_refund_reason_check
  check (refund_reason is null or refund_reason in
    ('guest_cancel', 'staff_cancel', 'no_show', 'slot_lost', 'venue_offline', 'amount_mismatch',
     'duplicate_success', 'manual', 'staff_refund', 'ticket_cashout', 'account_deleted')) not valid;

do $booking_payments_purpose_validate_0254$
begin
  if exists (select 1 from pg_constraint
              where conname = 'booking_payments_purpose_check'
                and conrelid = 'public.booking_payments'::regclass
                and not convalidated) then
    alter table booking_payments validate constraint booking_payments_purpose_check;
  end if;
end $booking_payments_purpose_validate_0254$;

do $booking_payments_refund_reason_validate_0254$
begin
  if exists (select 1 from pg_constraint
              where conname = 'booking_payments_refund_reason_check'
                and conrelid = 'public.booking_payments'::regclass
                and not convalidated) then
    alter table booking_payments validate constraint booking_payments_refund_reason_check;
  end if;
end $booking_payments_refund_reason_validate_0254$;
