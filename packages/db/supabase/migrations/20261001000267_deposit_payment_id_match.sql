set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0267 deposit_payment_id_match — a gateway answer whose signed payment id is
-- not the one already stored on the payment row applies nothing.
--
-- Qi signs only paymentId|amount|currency|creationDate|status. deposit_apply
-- found the row by p_request_id first — a field the signature does not cover —
-- and then trusted the rest, so one genuine signed SUCCESS could be replayed
-- against ANOTHER unpaid row of the same amount by editing requestId (the
-- 2026-10-01 review; deposit-webhook also preferred an unsigned
-- confirmedAmount when Qi's status call failed). The edge function now looks a
-- verified message up by its signed paymentId; this is the database half: a
-- row that already carries a provider_payment_id refuses an answer naming a
-- different one, logs it as 'payment_id_mismatch' and returns
-- {matched:false, mismatch:true}. The poll and the reconciler ask Qi about the
-- row's own payment id, so they never trip it; a row that never learned its id
-- (the create call timed out) still learns it from the first answer, as before.
--
-- deposit_apply re-issued verbatim from 20260929000259_ticket_purchase.sql:753,
-- plus the check marked 0267.

create or replace function app.deposit_apply(
  p_request_id          uuid,
  p_provider_payment_id text,
  p_provider_status     text,
  p_amount              numeric,
  p_currency            text,
  p_canceled            boolean,
  p_source              text,
  p_signature_ok        boolean default null,
  p_raw                 jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_apply_0259$
declare
  v        booking_payments%rowtype;
  r        reservations%rowtype;
  v_status text := upper(btrim(coalesce(p_provider_status, '')));
  v_kind   text;
  v_code   text;
  v_new    text;
begin
  if p_source is null or p_source not in ('webhook', 'poll', 'reconcile') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_source';
  end if;
  p_provider_payment_id := nullif(btrim(coalesce(p_provider_payment_id, '')), '');

  select * into v from booking_payments where request_id = p_request_id;
  if not found and p_provider_payment_id is not null then
    select * into v from booking_payments where provider_payment_id = p_provider_payment_id;
  end if;
  if v.id is null then
    perform app.deposit_event(null, p_source, p_provider_status, p_signature_ok, 'unmatched', p_raw);
    return jsonb_build_object('matched', false);
  end if;

  -- 0267: the signed payment id must be the row's own once the row knows it.
  if v.provider_payment_id is not null and p_provider_payment_id is not null
     and v.provider_payment_id <> p_provider_payment_id then
    perform app.deposit_event(v.id, p_source, p_provider_status, p_signature_ok, 'payment_id_mismatch', p_raw);
    return jsonb_build_object('matched', false, 'mismatch', true);
  end if;

  if v.purpose = 'deposit' then
    -- Lock order: court → reservations → booking_payments.
    select * into r from reservations where id = v.reservation_id;
    perform app.lock_court(r.court_id);
    perform 1 from reservations where id in (v.reservation_id, v.hold_id) order by id for update;
    select * into v from booking_payments where id = v.id for update;
    perform set_config('app.venue_id', v.venue_id::text, true);
  else
    -- 0259: a ticket purchase is a chain row with no court, booking or
    -- branch: only the row itself is locked.
    select * into v from booking_payments where id = v.id for update;
  end if;

  perform app.deposit_event(v.id, p_source, p_provider_status, p_signature_ok, null, p_raw);

  -- Learn Qi's id if we never heard it (create timed out after Qi made it).
  if v.provider_payment_id is null and p_provider_payment_id is not null then
    update booking_payments set provider_payment_id = p_provider_payment_id where id = v.id;
  end if;

  v_kind := case
    when v_status = 'SUCCESS' then 'success'
    when v_status in ('FAILED', 'ERROR', 'AUTHENTICATION_FAILED') then 'failed'
    when v_status in ('EXPIRED', 'NOT_FOUND', 'GIVE_UP') then 'expired'
    when coalesce(p_canceled, false) then 'expired'
    else 'open' end;
  v_code := case
    when v_status = 'AUTHENTICATION_FAILED' then 'auth_failed'
    when v_status = 'ERROR' then 'bank_error'
    when v_status = 'FAILED' then 'declined'
    when coalesce(p_canceled, false) then 'cancelled'
    else null end;

  update booking_payments
     set provider_status = coalesce(left(nullif(v_status, ''), 64), provider_status),
         last_checked_at = now(),
         claimed_at      = null,
         status          = case when status = 'created' and v_kind = 'open'
                                     and coalesce(provider_payment_id, p_provider_payment_id) is not null
                                then 'pending' else status end,
         updated_at      = now()
   where id = v.id
   returning * into v;

  v_new := v.status;

  if v_kind = 'success' then
    if v.status in ('created', 'pending', 'failed', 'expired') then
      -- Amount and currency to the dinar, or it is not our payment (plan §3.2).
      -- A ticket purchase with the wrong amount creates no ticket: the whole
      -- row is refunded (MD-2).
      if p_amount is null or upper(coalesce(p_currency, '')) <> 'IQD'
         or abs(p_amount - v.amount_iqd) >= 1 then
        update booking_payments
           set status = 'succeeded', succeeded_at = coalesce(succeeded_at, now()), updated_at = now()
         where id = v.id;
        perform app.deposit_begin_refund(v.id, 'amount_mismatch', null,
                                         format('Qi said %s %s', p_amount, p_currency));
        perform app.deposit_nudge();
        v_new := 'refund_pending';
      elsif v.purpose = 'deposit' then
        v_new := app.deposit_settle_success(v.id);
      else
        v_new := app.ticket_settle_success(v.id);
      end if;
    end if;
    -- succeeded / refund_* / refunded: a replay. Logged above, nothing moves.

  elsif v_kind = 'failed' and v.status in ('created', 'pending') then
    update booking_payments
       set status = 'failed', failed_at = now(), failure_code = v_code, updated_at = now()
     where id = v.id;
    v_new := 'failed';
    -- The hold stays until its deadline: the guest may try again or, when the
    -- deposit is optional, confirm and pay at the desk.

  elsif v_kind = 'expired' and v.status in ('created', 'pending') then
    update booking_payments
       set status = 'expired', expired_at = now(), failure_code = v_code, updated_at = now()
     where id = v.id;
    v_new := 'expired';
    -- The window is over: give the slot back unless the guest confirmed it
    -- meanwhile or started another attempt. A ticket purchase holds no slot.
    if v.purpose = 'deposit'
       and not exists (select 1 from booking_payments o
                        where o.hold_id = v.hold_id and o.id <> v.id and o.status in ('created', 'pending')) then
      update reservations
         set status = 'expired'
       where id = v.hold_id and kind = 'hold' and status = 'pending';
    end if;
  end if;

  return jsonb_build_object('matched', true, 'id', v.id, 'request_id', v.request_id,
                            'status', v_new, 'reservation_id',
                            (select reservation_id from booking_payments where id = v.id),
                            'purpose', v.purpose, 'ticket_count', v.ticket_count);
end $deposit_apply_0259$;

comment on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) is
  '0242, 0259, 0267. Service role. The ONLY writer of a payment outcome, deposits and open-match ticket purchases alike. Logs the message, then: SUCCESS for exactly amount_iqd in IQD books the slot of a deposit (confirm the hold, or re-create a swept one) or creates a ticket purchase''s tickets (app.ticket_settle_success, however late) and marks succeeded in the same transaction, or goes to refund_pending (slot_lost, venue_offline, amount_mismatch, duplicate_success; a ticket purchase only amount_mismatch or account_deleted); FAILED/ERROR/AUTHENTICATION_FAILED → failed (hold kept); EXPIRED/cancelled/NOT_FOUND/GIVE_UP → expired (a deposit''s hold released). A late SUCCESS after failed/expired is honoured. Anything else only updates provider_status. Unknown request → logged unmatched; a provider payment id other than the one the row already holds → logged payment_id_mismatch, nothing applied (0267). The result carries purpose and ticket_count.';

revoke all on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) to service_role;
