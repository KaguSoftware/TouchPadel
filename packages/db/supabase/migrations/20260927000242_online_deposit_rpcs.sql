-- 0242 online_deposit_rpcs — the deposit state machine (tables in 0241;
-- plan docs/design/payments/qi-deposit-plan-2026-09-20.md §3, contracts
-- docs/design/payments/build-contracts-2026-09-27.md §2).
--
-- Who writes what:
--   * The edge functions (service role) are the only callers of
--     deposit_prepare, deposit_mark_created, deposit_apply, deposit_log_event,
--     deposits_due_for_reconcile, deposit_refund_apply and
--     deposit_note_cancel_attempt. deposit_apply is the ONLY writer of a
--     payment's outcome, and it confirms the booking in the same transaction
--     that marks the payment succeeded.
--   * Guests: deposit_quote (Review) and deposit_status (the payment screen),
--     both on their own rows only.
--   * Staff: deposit_settings / set_deposit_settings (owner writes),
--     deposit_attention, deposit_refund_retry, deposit_refund_manual,
--     deposit_refund_request.
--
-- The two rules the whole file exists to keep (plan §0):
--   * no false positive: a payment is `succeeded` only when Qi said SUCCESS
--     for exactly our amount in IQD AND the booking is confirmed; a SUCCESS
--     that cannot keep its slot goes to refund_pending, never to a paid
--     payment without a booking;
--   * no false negative: a late SUCCESS on an attempt we had written off
--     (failed / expired) is still honoured: booked if the slot is there,
--     refunded if not. Our own transport errors never mark anything failed.
--
-- Lock order inside this file: court (app.lock_court) → reservations →
-- booking_payments, the same order the reservations trigger below takes
-- (reservations locked by the cancelling RPC, then its payments).
--
-- Hooks into existing RPCs, each re-issued from its latest body:
--   confirm_booking (0210)   DEPOSIT_REQUIRED when the guest must pay first
--   release_hold (0060)      a hold with a live payment is not released
--   expire_stale_holds (0071) the sweep skips a hold whose payment is live
--   court_fee_paid (0106)    a live booking's deposit counts as paid
--   booking_bill (0231)      online_paid_iqd + online_payments
--   my_reservations (0235)   online_paid_iqd, payment_status, payment_ref
--   set_customer_flags (0065) accepts deposit_exempt
-- and one new trigger on reservations: a cancelled booking's deposit is
-- refunded, a no-show's is kept or refunded per deposit_forfeit_no_show.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Internal helpers.
-- ---------------------------------------------------------------------------

-- The mode that applies to THIS guest at THIS branch, now. `required` becomes
-- `optional` for a guest the desk flagged deposit_exempt (plan §3.5).
create or replace function app.deposit_mode_for(p_guest_id uuid, p_venue_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $deposit_mode_for_0242$
declare
  v_mode text;
begin
  select deposit_mode into v_mode from venue_settings where venue_id = p_venue_id;
  v_mode := coalesce(v_mode, 'off');
  if v_mode = 'required' and p_guest_id is not null
     and exists (select 1 from customer_flags
                  where customer_id = p_guest_id and type = 'deposit_exempt') then
    return 'optional';
  end if;
  return v_mode;
end $deposit_mode_for_0242$;

revoke all on function app.deposit_mode_for(uuid, uuid) from public, anon, authenticated;

-- The deposit for a court price at a branch: percent, rounded UP to 250 IQD,
-- then held between the minimum and the maximum, and never above the price.
create or replace function app.deposit_amount(p_price_iqd bigint, p_venue_id uuid)
returns bigint
language plpgsql stable security definer set search_path = public as $deposit_amount_0242$
declare
  v_s venue_settings%rowtype;
  v   bigint;
begin
  if p_price_iqd is null or p_price_iqd <= 0 then
    return 0;
  end if;
  select * into v_s from venue_settings where venue_id = p_venue_id;
  if not found then
    return 0;
  end if;
  v := (ceil((p_price_iqd::numeric * v_s.deposit_percent_bp) / 10000.0 / 250.0) * 250)::bigint;
  v := greatest(v, v_s.deposit_min_iqd);
  if v_s.deposit_max_iqd is not null then
    v := least(v, v_s.deposit_max_iqd);
  end if;
  return least(v, p_price_iqd);
end $deposit_amount_0242$;

revoke all on function app.deposit_amount(bigint, uuid) from public, anon, authenticated;

-- What a live booking has been paid online: succeeded deposits, less whatever
-- is being or has been refunded. Sandbox payments are not money.
create or replace function app.deposit_net_paid(p_reservation_id uuid)
returns bigint
language sql stable security definer set search_path = public as $deposit_net_paid_0242$
  select coalesce(sum(bp.amount_iqd - case when bp.status = 'succeeded' then 0
                                           else coalesce(bp.refund_amount_iqd, 0) end), 0)::bigint
    from booking_payments bp
   where bp.reservation_id = p_reservation_id
     and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')
     and not bp.sandbox
$deposit_net_paid_0242$;

revoke all on function app.deposit_net_paid(uuid) from public, anon, authenticated;

create or replace function app.deposit_event(
  p_payment_id      uuid,
  p_source          text,
  p_provider_status text default null,
  p_signature_ok    boolean default null,
  p_note            text default null,
  p_raw             jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public as $deposit_event_0242$
  insert into booking_payment_events (payment_id, source, provider_status, signature_ok, note, raw)
  values (p_payment_id, p_source, left(p_provider_status, 64), p_signature_ok, left(p_note, 300),
          coalesce(p_raw, '{}'::jsonb));
$deposit_event_0242$;

revoke all on function app.deposit_event(uuid, text, text, boolean, text, jsonb) from public, anon, authenticated;

-- Ask the reconciler to run now (refunds should not wait for the sweep).
-- Mirrors app.push_nudge (0090): swallows its own errors, never fails a caller.
create or replace function app.deposit_nudge() returns void
language plpgsql security definer set search_path = public as $deposit_nudge_0242$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from booking_payments
                    where status in ('created', 'pending', 'refund_pending')
                      and (claimed_at is null or claimed_at <= now() - interval '60 seconds')) then
      return;
    end if;
    if to_regnamespace('net') is null then
      return;
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;
    end if;
    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/deposit-reconcile',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'deposit_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $deposit_nudge_0242$;

revoke all on function app.deposit_nudge() from public, anon, authenticated;
grant execute on function app.deposit_nudge() to service_role;

-- succeeded → refund_pending. The refund request id is minted HERE, once, so a
-- refund call retried after a timeout carries the same id to Qi.
-- Caller holds the payment row lock.
create or replace function app.deposit_begin_refund(
  p_payment_id uuid,
  p_reason     text,
  p_amount_iqd bigint default null,
  p_note       text default null
) returns booking_payments
language plpgsql security definer set search_path = public as $deposit_begin_refund_0242$
declare
  v booking_payments%rowtype;
begin
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status <> 'succeeded' then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v.status;
  end if;
  if p_amount_iqd is not null and (p_amount_iqd <= 0 or p_amount_iqd > v.amount_iqd) then
    raise exception 'REFUND_TOO_LARGE' using errcode = 'P0001',
      detail = v.amount_iqd::text, hint = 'a refund is more than zero and at most the deposit';
  end if;

  update booking_payments
     set status              = 'refund_pending',
         refund_reason       = p_reason,
         refund_amount_iqd   = coalesce(p_amount_iqd, v.amount_iqd),
         refund_request_id   = gen_random_uuid(),
         refund_note         = left(p_note, 300),
         refund_requested_at = now(),
         refund_attempts     = 0,
         claimed_at          = null,
         updated_at          = now()
   where id = v.id
   returning * into v;

  perform app.deposit_event(v.id, 'decision', null, null,
                            'refund requested: ' || p_reason,
                            jsonb_build_object('refund_amount_iqd', v.refund_amount_iqd));
  perform app.write_audit('deposit.refund_request', 'booking_payments', v.id::text,
                          null, jsonb_build_object('reason', p_reason, 'amount_iqd', v.refund_amount_iqd,
                                                   'reservation_id', v.reservation_id));
  return v;
end $deposit_begin_refund_0242$;

revoke all on function app.deposit_begin_refund(uuid, text, bigint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guest reads.
-- ---------------------------------------------------------------------------
create or replace function app.deposit_quote(p_hold_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_quote_0242$
declare
  v_uid    uuid := auth.uid();
  r        reservations%rowtype;
  v_mode   text;
  v_amount bigint;
  v_window int;
  v_active booking_payments%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into r from reservations where id = p_hold_id;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.guest_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_mode := app.deposit_mode_for(v_uid, r.venue_id);
  v_amount := case when v_mode = 'off' then 0 else app.deposit_amount(r.price_iqd, r.venue_id) end;
  if v_amount <= 0 then
    v_mode := 'off';
    v_amount := 0;
  end if;
  select deposit_window_seconds into v_window from venue_settings where venue_id = r.venue_id;

  select * into v_active from booking_payments
   where hold_id = r.id and status in ('created', 'pending');

  return jsonb_build_object(
    'deposit_mode',   v_mode,
    'deposit_iqd',    v_amount,
    'price_iqd',      coalesce(r.price_iqd, 0),
    'rest_iqd',       greatest(coalesce(r.price_iqd, 0) - v_amount, 0),
    'window_seconds', coalesce(v_window, 900),
    'active',         case when v_active.id is null then null else jsonb_build_object(
                        'request_id',  v_active.request_id,
                        'status',      v_active.status,
                        'form_url',    v_active.form_url,
                        'deadline_at', v_active.deadline_at) end);
end $deposit_quote_0242$;

comment on function app.deposit_quote(uuid) is
  '0242. Review''s deposit terms for the caller''s own hold: {deposit_mode (effective for this guest), deposit_iqd, price_iqd, rest_iqd, window_seconds, active (the live attempt or null)}. Mode is off and amounts 0 when deposits are off. AUTH_REQUIRED, HOLD_NOT_FOUND, FORBIDDEN.';

revoke all on function app.deposit_quote(uuid) from public, anon;
grant execute on function app.deposit_quote(uuid) to authenticated;

create or replace function app.deposit_status(p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_status_0242$
declare
  v_uid      uuid := auth.uid();
  v          booking_payments%rowtype;
  r          reservations%rowtype;
  h          reservations%rowtype;
  v_attempts int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where request_id = p_request_id;
  -- Someone else's ref and an unknown ref read the same (0038 #7).
  if not found
     or (v.guest_id is distinct from v_uid
         and not app.is_staff_at(v.venue_id, 'court_desk', 'manager', 'owner')) then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into r from reservations where id = v.reservation_id;
  select * into h from reservations where id = v.hold_id;
  select count(*) into v_attempts from booking_payments where hold_id = v.hold_id;

  return jsonb_build_object(
    'request_id',        v.request_id,
    'status',            v.status,
    'failure_code',      v.failure_code,
    'amount_iqd',        v.amount_iqd,
    'price_iqd',         coalesce(r.price_iqd, v.quoted_price_iqd),
    'rest_iqd',          greatest(coalesce(r.price_iqd, v.quoted_price_iqd) - v.amount_iqd, 0),
    'deadline_at',       v.deadline_at,
    'form_url',          case when v.status in ('created', 'pending') then v.form_url end,
    'refund_reason',     v.refund_reason,
    'refund_amount_iqd', v.refund_amount_iqd,
    'refunded_at',       v.refunded_at,
    'sandbox',           v.sandbox,
    'deposit_mode',      app.deposit_mode_for(v.guest_id, v.venue_id),
    'attempts_left',     greatest(3 - v_attempts, 0),
    'hold_live',         (h.kind = 'hold' and h.status = 'pending' and h.hold_expires_at > now()),
    'reservation',       jsonb_build_object(
                           'id',       r.id,
                           'kind',     r.kind,
                           'status',   r.status,
                           'court_id', r.court_id,
                           'start_at', r.start_at,
                           'end_at',   r.end_at,
                           'venue_id', r.venue_id),
    'server_now',        now());
end $deposit_status_0242$;

comment on function app.deposit_status(uuid) is
  '0242. One payment attempt by its request_id, as the guest''s payment screen renders it (contracts §2.2). The guest reads their own; court desk, manager and owner read their branch''s. PAYMENT_NOT_FOUND for an unknown or foreign ref alike.';

revoke all on function app.deposit_status(uuid) from public, anon;
grant execute on function app.deposit_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Service role: begin, created, apply, log.
-- ---------------------------------------------------------------------------
create or replace function app.deposit_prepare(
  p_guest_id uuid,
  p_hold_id  uuid,
  p_locale   text,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_prepare_0242$
declare
  r          reservations%rowtype;
  v          booking_payments%rowtype;
  v_mode     text;
  v_amount   bigint;
  v_window   int;
  v_attempts int;
  v_profile  profiles%rowtype;
  v_reused   boolean := false;
begin
  if p_guest_id is null or p_hold_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001';
  end if;
  if p_provider is null or p_provider not in ('qi', 'fake') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_provider';
  end if;

  perform app.lock_court((select court_id from reservations where id = p_hold_id));
  select * into r from reservations where id = p_hold_id for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.guest_id is distinct from p_guest_id then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', r.venue_id::text, true);

  -- A live attempt on this hold: hand it back (a double tap, a second phone).
  select * into v from booking_payments
   where hold_id = r.id and status in ('created', 'pending')
   for update;
  if found then
    if v.deadline_at <= now() then
      raise exception 'HOLD_EXPIRED' using errcode = 'P0001',
        hint = 'the payment window on this hold has ended';
    end if;
    v_reused := true;
  else
    if r.kind <> 'hold' or r.status <> 'pending' or r.hold_expires_at < now() then
      raise exception 'HOLD_EXPIRED' using errcode = 'P0001';
    end if;

    v_mode := app.deposit_mode_for(p_guest_id, r.venue_id);
    if v_mode = 'off' then
      raise exception 'DEPOSITS_OFF' using errcode = 'P0001';
    end if;
    v_amount := app.deposit_amount(r.price_iqd, r.venue_id);
    if v_amount <= 0 then
      raise exception 'DEPOSITS_OFF' using errcode = 'P0001', hint = 'nothing to pay on this slot';
    end if;

    select * into v_profile from profiles where id = p_guest_id;
    if nullif(btrim(coalesce(v_profile.phone, '')), '') is null then
      raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
        hint = 'add a phone number to your profile before paying';
    end if;

    perform app.assert_not_degraded_for(r.start_at, r.venue_id);

    select count(*) into v_attempts from booking_payments where hold_id = r.id;
    if v_attempts >= 3 then
      raise exception 'TOO_MANY_ATTEMPTS' using errcode = 'P0001',
        hint = 'three payment attempts on one hold; pay at the desk or choose another time';
    end if;

    select deposit_window_seconds into v_window from venue_settings where venue_id = r.venue_id;

    insert into booking_payments
      (venue_id, reservation_id, hold_id, guest_id, provider, sandbox, request_id,
       amount_iqd, quoted_price_iqd, locale, status, deadline_at)
    values
      (r.venue_id, r.id, r.id, p_guest_id, p_provider, coalesce(v_profile.payment_sandbox, false),
       gen_random_uuid(), v_amount, r.price_iqd,
       case when p_locale in ('en', 'ar') then p_locale else 'ar' end,
       'created', now() + make_interval(secs => coalesce(v_window, 900)))
    returning * into v;

    -- The payment window owns the hold now: it lives at least as long.
    update reservations
       set hold_expires_at = greatest(hold_expires_at, v.deadline_at)
     where id = r.id;

    perform app.deposit_event(v.id, 'begin', null, null, null,
                              jsonb_build_object('amount_iqd', v.amount_iqd, 'provider', v.provider,
                                                 'sandbox', v.sandbox));
    perform app.write_audit('reservation.deposit_begin', 'reservations', r.id::text, null,
                            jsonb_build_object('payment_id', v.id, 'amount_iqd', v.amount_iqd,
                                               'sandbox', v.sandbox));
  end if;

  select * into v_profile from profiles where id = p_guest_id;
  return jsonb_build_object(
    'id',               v.id,
    'request_id',       v.request_id,
    'status',           v.status,
    'provider',         v.provider,
    'sandbox',          v.sandbox,
    'amount_iqd',       v.amount_iqd,
    'deadline_at',      v.deadline_at,
    'form_url',         v.form_url,
    'provider_payment_id', v.provider_payment_id,
    'locale',           v.locale,
    'reused',           v_reused,
    'reservation_id',   r.id,
    'guest_phone',      v_profile.phone,
    'guest_name',       v_profile.full_name);
end $deposit_prepare_0242$;

comment on function app.deposit_prepare(uuid, uuid, text, text) is
  '0242. Service role (edge deposit-begin, on behalf of the JWT user p_guest_id). Returns the live attempt on the hold, or records a new one (status created) and extends the hold to the payment deadline. HOLD_NOT_FOUND, FORBIDDEN, HOLD_EXPIRED, DEPOSITS_OFF, PHONE_REQUIRED, DEGRADED_LOCKOUT, TOO_MANY_ATTEMPTS (3 per hold).';

revoke all on function app.deposit_prepare(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function app.deposit_prepare(uuid, uuid, text, text) to service_role;

create or replace function app.deposit_mark_created(
  p_request_id          uuid,
  p_provider_payment_id text,
  p_form_url            text,
  p_provider_status     text,
  p_raw                 jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_mark_created_0242$
declare
  v booking_payments%rowtype;
begin
  select * into v from booking_payments where request_id = p_request_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_provider_payment_id is null or btrim(p_provider_payment_id) = '' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_provider_payment_id';
  end if;

  if v.status = 'created' then
    update booking_payments
       set status              = 'pending',
           provider_payment_id = p_provider_payment_id,
           form_url            = p_form_url,
           provider_status     = left(p_provider_status, 64),
           last_checked_at     = now(),
           updated_at          = now()
     where id = v.id
     returning * into v;
  elsif v.provider_payment_id is null then
    -- Recovered after the deadline passed: keep the outcome, learn the id.
    update booking_payments
       set provider_payment_id = p_provider_payment_id,
           form_url            = coalesce(form_url, p_form_url),
           updated_at          = now()
     where id = v.id
     returning * into v;
  end if;

  perform app.deposit_event(v.id, 'created', p_provider_status, null, null, p_raw);
  return jsonb_build_object('id', v.id, 'request_id', v.request_id, 'status', v.status,
                            'form_url', v.form_url, 'deadline_at', v.deadline_at,
                            'amount_iqd', v.amount_iqd);
end $deposit_mark_created_0242$;

revoke all on function app.deposit_mark_created(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_mark_created(uuid, text, text, text, jsonb) to service_role;

-- Money came in: book the slot, or send the money back. Caller holds the
-- locks (court, reservations, the payment). Returns the new status.
create or replace function app.deposit_settle_success(p_payment_id uuid)
returns text
language plpgsql security definer set search_path = public as $deposit_settle_success_0242$
declare
  v        booking_payments%rowtype;
  r        reservations%rowtype;
  v_new    reservations%rowtype;
  v_before jsonb;
  v_reason text := null;
begin
  select * into v from booking_payments where id = p_payment_id;
  select * into r from reservations where id = v.reservation_id;

  -- Another payment already paid for this booking (plan §10 row 30). A
  -- deposit a manager partly refunded still paid for it.
  if exists (select 1 from booking_payments o
              where o.reservation_id = r.id and o.id <> v.id
                and (o.status = 'succeeded'
                     or (o.status in ('refund_pending', 'refund_failed', 'refunded')
                         and o.refund_reason = 'staff_refund'))) then
    v_reason := 'duplicate_success';
  elsif r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed')
        and r.guest_id is not distinct from v.guest_id then
    -- Already booked (the guest chose "pay at the desk" while the bank was
    -- still thinking, or this is a replay): the deposit simply counts as paid.
    null;
  elsif r.kind = 'hold' and r.status = 'pending' then
    if r.end_at <= now() then
      v_reason := 'slot_lost';
    else
      begin
        perform app.assert_not_degraded_for(r.start_at, r.venue_id);
      exception when others then
        if sqlerrm = 'DEGRADED_LOCKOUT' then
          v_reason := 'venue_offline';
        else
          raise;
        end if;
      end;
      if v_reason is null then
        v_before := to_jsonb(r);
        -- Quote = charge (0117): the hold carries the price the guest paid a
        -- deposit against; a rate edited mid-payment does not change it.
        update reservations
           set kind            = 'booking',
               status          = 'confirmed',
               hold_expires_at = null
         where id = r.id
         returning * into r;
        perform app.write_audit('reservation.confirm', 'reservations', r.id::text,
                                v_before, to_jsonb(r) || jsonb_build_object('via', 'deposit', 'payment_id', v.id),
                                null, null, r.device_id);
      end if;
    end if;
  elsif r.status = 'expired' and r.kind = 'hold' then
    -- The hold was swept (should not happen: the sweep skips it). Book the
    -- same court and time for the same guest if it is still free.
    if r.end_at <= now() then
      v_reason := 'slot_lost';
    else
      begin
        perform app.assert_not_degraded_for(r.start_at, r.venue_id);
        perform app.expire_stale_holds(r.court_id, tstzrange(r.start_at, r.end_at, '[)'));
        insert into reservations
          (venue_id, court_id, kind, status, start_at, end_at, guest_id, source,
           rate_rule_id, price_iqd, device_id)
        values
          (r.venue_id, r.court_id, 'booking', 'confirmed', r.start_at, r.end_at, r.guest_id, r.source,
           r.rate_rule_id, r.price_iqd, r.device_id)
        returning * into v_new;
        update booking_payments set reservation_id = v_new.id, updated_at = now() where id = v.id;
        perform app.write_audit('reservation.confirm', 'reservations', v_new.id::text, null,
                                to_jsonb(v_new) || jsonb_build_object('via', 'deposit', 'payment_id', v.id,
                                                                      'recreated_from', r.id));
      exception
        when exclusion_violation then
          v_reason := 'slot_lost';
        when others then
          if sqlerrm = 'DEGRADED_LOCKOUT' then
            v_reason := 'venue_offline';
          else
            raise;
          end if;
      end;
    end if;
  else
    -- Cancelled, no-show, or anything else: the slot is not the guest's.
    v_reason := 'slot_lost';
  end if;

  update booking_payments
     set status       = 'succeeded',
         succeeded_at = coalesce(succeeded_at, now()),
         failure_code = null,
         updated_at   = now()
   where id = v.id;

  if v_reason is not null then
    perform app.deposit_begin_refund(v.id, v_reason);
    perform app.deposit_nudge();
    return 'refund_pending';
  end if;
  return 'succeeded';
end $deposit_settle_success_0242$;

revoke all on function app.deposit_settle_success(uuid) from public, anon, authenticated;

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
language plpgsql security definer set search_path = public as $deposit_apply_0242$
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

  -- Lock order: court → reservations → booking_payments.
  select * into r from reservations where id = v.reservation_id;
  perform app.lock_court(r.court_id);
  perform 1 from reservations where id in (v.reservation_id, v.hold_id) order by id for update;
  select * into v from booking_payments where id = v.id for update;
  perform set_config('app.venue_id', v.venue_id::text, true);

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
      if p_amount is null or upper(coalesce(p_currency, '')) <> 'IQD'
         or abs(p_amount - v.amount_iqd) >= 1 then
        update booking_payments
           set status = 'succeeded', succeeded_at = coalesce(succeeded_at, now()), updated_at = now()
         where id = v.id;
        perform app.deposit_begin_refund(v.id, 'amount_mismatch', null,
                                         format('Qi said %s %s', p_amount, p_currency));
        perform app.deposit_nudge();
        v_new := 'refund_pending';
      else
        v_new := app.deposit_settle_success(v.id);
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
    -- meanwhile or started another attempt.
    if not exists (select 1 from booking_payments o
                    where o.hold_id = v.hold_id and o.id <> v.id and o.status in ('created', 'pending')) then
      update reservations
         set status = 'expired'
       where id = v.hold_id and kind = 'hold' and status = 'pending';
    end if;
  end if;

  return jsonb_build_object('matched', true, 'id', v.id, 'request_id', v.request_id,
                            'status', v_new, 'reservation_id',
                            (select reservation_id from booking_payments where id = v.id));
end $deposit_apply_0242$;

comment on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) is
  '0242. Service role. The ONLY writer of a payment outcome. Logs the message, then: SUCCESS for exactly amount_iqd in IQD books the slot (confirm the hold, or re-create a swept one) and marks succeeded in the same transaction, or goes to refund_pending (slot_lost, venue_offline, amount_mismatch, duplicate_success); FAILED/ERROR/AUTHENTICATION_FAILED → failed (hold kept); EXPIRED/cancelled/NOT_FOUND/GIVE_UP → expired (hold released). A late SUCCESS after failed/expired is honoured. Anything else only updates provider_status. Unknown request → logged unmatched.';

revoke all on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) to service_role;

create or replace function app.deposit_log_event(
  p_request_id      uuid,
  p_source          text,
  p_provider_status text,
  p_signature_ok    boolean,
  p_note            text,
  p_raw             jsonb
) returns void
language plpgsql security definer set search_path = public as $deposit_log_event_0242$
declare
  v_id uuid;
begin
  if p_source is null or p_source not in ('webhook', 'poll', 'reconcile', 'created', 'refund') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_source';
  end if;
  select id into v_id from booking_payments where request_id = p_request_id;
  perform app.deposit_event(v_id, p_source, p_provider_status, p_signature_ok, p_note, p_raw);
end $deposit_log_event_0242$;

revoke all on function app.deposit_log_event(uuid, text, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_log_event(uuid, text, text, boolean, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Service role: the reconciler.
-- ---------------------------------------------------------------------------
create or replace function app.deposits_due_for_reconcile(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $deposits_due_0242$
declare
  v_out jsonb;
  v_row record;
begin
  -- A succeeded deposit whose booking is gone and was not forfeited must not
  -- sit on the venue's account (I2). The reservations trigger catches the
  -- normal paths; this catches anything that slipped past it.
  for v_row in
    select bp.id
      from booking_payments bp
      join reservations r on r.id = bp.reservation_id
     where bp.status = 'succeeded'
       and bp.forfeited_at is null
       and not (r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed', 'no_show'))
     order by bp.id
     limit 20
       for update of bp skip locked
  loop
    perform app.deposit_begin_refund(v_row.id, 'slot_lost', null, 'reconciler: booking not live');
  end loop;

  with due as (
    select bp.id,
           case when bp.status = 'refund_pending' then 'refund' else 'check' end as action
      from booking_payments bp
     where (bp.claimed_at is null or bp.claimed_at <= now() - interval '60 seconds')
       and (
         (bp.status in ('created', 'pending') and bp.deadline_at <= now())
         or (bp.status = 'pending' and bp.created_at <= now() - interval '2 minutes'
             and coalesce(bp.last_checked_at, bp.created_at) <= now() - interval '90 seconds')
         or bp.status = 'refund_pending')
     order by bp.deadline_at
     limit greatest(least(coalesce(p_limit, 50), 100), 1)
       for update of bp skip locked
  ), claimed as (
    update booking_payments bp
       set claimed_at = now()
      from due
     where bp.id = due.id
    returning bp.*, due.action
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  c.id,
           'action',              c.action,
           'request_id',          c.request_id,
           'provider',            c.provider,
           'sandbox',             c.sandbox,
           'provider_payment_id', c.provider_payment_id,
           'status',              c.status,
           'amount_iqd',          c.amount_iqd,
           'deadline_at',         c.deadline_at,
           'cancel_attempts',     c.cancel_attempts,
           'refund_request_id',   c.refund_request_id,
           'refund_amount_iqd',   c.refund_amount_iqd,
           'refund_attempts',     c.refund_attempts,
           'refund_reason',       c.refund_reason)), '[]'::jsonb)
    into v_out
    from claimed c;

  return v_out;
end $deposits_due_0242$;

comment on function app.deposits_due_for_reconcile(int) is
  '0242. Service role (edge deposit-reconcile). Claims up to p_limit (max 100) payments for 60 s: action check (open past its deadline, or pending unheard for 90 s) or refund (refund_pending). First turns any succeeded deposit whose booking is no longer live (and was not forfeited) into a refund.';

revoke all on function app.deposits_due_for_reconcile(int) from public, anon, authenticated;
grant execute on function app.deposits_due_for_reconcile(int) to service_role;

create or replace function app.deposit_note_cancel_attempt(p_payment_id uuid)
returns int
language plpgsql security definer set search_path = public as $deposit_note_cancel_attempt_0242$
declare
  v_n int;
begin
  update booking_payments
     set cancel_attempts = cancel_attempts + 1, updated_at = now()
   where id = p_payment_id
  returning cancel_attempts into v_n;
  if v_n is null then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_n;
end $deposit_note_cancel_attempt_0242$;

revoke all on function app.deposit_note_cancel_attempt(uuid) from public, anon, authenticated;
grant execute on function app.deposit_note_cancel_attempt(uuid) to service_role;

-- p_outcome: succeeded (Qi refunded), failed (Qi refused for good),
-- pending (Qi is processing), unknown (we did not get an answer).
create or replace function app.deposit_refund_apply(
  p_payment_id         uuid,
  p_outcome            text,
  p_provider_status    text,
  p_refund_provider_id text,
  p_raw                jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_apply_0242$
declare
  v       booking_payments%rowtype;
  r       reservations%rowtype;
  v_token boolean;
begin
  if p_outcome is null or p_outcome not in ('succeeded', 'failed', 'pending', 'unknown') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_outcome';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Lock order court → reservations → booking_payments, as deposit_apply.
  perform app.lock_court((select court_id from reservations where id = v.reservation_id));
  perform 1 from reservations where id = v.reservation_id for update;
  select * into v from booking_payments where id = p_payment_id for update;
  perform set_config('app.venue_id', v.venue_id::text, true);

  perform app.deposit_event(v.id, 'refund', p_provider_status, null, p_outcome, p_raw);

  if v.status <> 'refund_pending' then
    return jsonb_build_object('id', v.id, 'status', v.status, 'changed', false);
  end if;

  if p_outcome = 'succeeded' then
    update booking_payments
       set status = 'refunded', refunded_at = now(),
           refund_provider_id = coalesce(left(p_refund_provider_id, 200), refund_provider_id),
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
    perform app.write_audit('deposit.refunded', 'booking_payments', v.id::text, null,
                            jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'reason', v.refund_reason,
                                               'reservation_id', v.reservation_id));
    -- Tell the guest (their phone may have been closed for days).
    select * into r from reservations where id = v.reservation_id;
    select expo_push_token is not null into v_token from profiles where id = v.guest_id;
    if coalesce(v_token, false) and not v.sandbox then
      insert into notification_outbox (profile_id, kind, payload)
      values (v.guest_id, 'deposit_refunded', jsonb_build_object(
        'reservation_id', v.reservation_id,
        'court_id',       r.court_id,
        'start_at',       r.start_at,
        'amount_iqd',     v.refund_amount_iqd,
        'request_id',     v.request_id));
      perform app.push_nudge();
    end if;
  elsif p_outcome = 'failed' then
    update booking_payments
       set status = 'refund_failed', refund_attempts = refund_attempts + 1,
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
    perform app.write_audit('deposit.refund_failed', 'booking_payments', v.id::text, null,
                            jsonb_build_object('provider_status', p_provider_status));
  else
    update booking_payments
       set refund_attempts = refund_attempts + 1,
           status = case when p_outcome = 'unknown' and refund_attempts + 1 >= 10
                         then 'refund_failed' else status end,
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
  end if;

  return jsonb_build_object('id', v.id, 'status', v.status, 'changed', true);
end $deposit_refund_apply_0242$;

comment on function app.deposit_refund_apply(uuid, text, text, text, jsonb) is
  '0242. Service role (edge deposit-reconcile). refund_pending → refunded (and a deposit_refunded push) | refund_failed (a manager sees it in deposit_attention); pending/unknown count an attempt, and ten unanswered attempts give up to refund_failed.';

revoke all on function app.deposit_refund_apply(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_refund_apply(uuid, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. A cancelled or no-show booking decides its deposit.
-- ---------------------------------------------------------------------------
create or replace function app.trg_reservation_deposit() returns trigger
language plpgsql security definer set search_path = public as $trg_reservation_deposit_0242$
declare
  v_pay    record;
  v_keep   boolean;
  v_reason text;
  v_any    boolean := false;
begin
  if new.status not in ('cancelled', 'no_show') or old.status is not distinct from new.status then
    return null;
  end if;

  for v_pay in
    select id from booking_payments
     where reservation_id = new.id and status = 'succeeded' and forfeited_at is null
     order by id
     for update
  loop
    if new.status = 'no_show' then
      select deposit_forfeit_no_show into v_keep from venue_settings where venue_id = new.venue_id;
      if coalesce(v_keep, true) then
        update booking_payments set forfeited_at = now(), updated_at = now() where id = v_pay.id;
        perform app.deposit_event(v_pay.id, 'decision', null, null, 'forfeit: no_show', '{}'::jsonb);
        perform app.write_audit('deposit.forfeit', 'booking_payments', v_pay.id::text, null,
                                jsonb_build_object('reservation_id', new.id, 'reason', 'no_show'));
        continue;
      end if;
      v_reason := 'no_show';
    elsif new.cancelled_by::text = 'guest' then
      v_reason := 'guest_cancel';
    else
      v_reason := 'staff_cancel';
    end if;
    perform app.deposit_begin_refund(v_pay.id, v_reason);
    v_any := true;
  end loop;

  if v_any then
    perform app.deposit_nudge();
  end if;
  return null;
end $trg_reservation_deposit_0242$;

revoke all on function app.trg_reservation_deposit() from public, anon, authenticated;

drop trigger if exists reservations_deposit on reservations;
create trigger reservations_deposit
  after update of status on reservations
  for each row execute function app.trg_reservation_deposit();

-- ---------------------------------------------------------------------------
-- 6. Staff: settings, attention list, refunds.
-- ---------------------------------------------------------------------------
create or replace function app.deposit_settings(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_settings_0242$
declare
  v_venue uuid;
  v_out   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'venue_id',                vs.venue_id,
           'deposit_mode',            vs.deposit_mode,
           'deposit_percent_bp',      vs.deposit_percent_bp,
           'deposit_min_iqd',         vs.deposit_min_iqd,
           'deposit_max_iqd',         vs.deposit_max_iqd,
           'deposit_window_seconds',  vs.deposit_window_seconds,
           'deposit_forfeit_no_show', vs.deposit_forfeit_no_show)
    into v_out
    from venue_settings vs
   where vs.venue_id = v_venue;
  if v_out is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;
  return v_out;
end $deposit_settings_0242$;

revoke all on function app.deposit_settings(uuid) from public, anon;
grant execute on function app.deposit_settings(uuid) to authenticated;

create or replace function app.set_deposit_settings(p_patch jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_deposit_settings_0242$
declare
  v_allowed text[] := array['deposit_mode', 'deposit_percent_bp', 'deposit_min_iqd', 'deposit_max_iqd',
                            'deposit_window_seconds', 'deposit_forfeit_no_show'];
  v_venue  uuid;
  v_key    text;
  v_before jsonb;
  v_after  jsonb;
  v_int    int;
  v_min    bigint;
  v_max    bigint;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  v_before := app.deposit_settings(v_venue);

  -- Validate everything before writing anything.
  if p_patch ? 'deposit_mode'
     and coalesce(p_patch->>'deposit_mode', '') not in ('off', 'optional', 'required') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_mode';
  end if;
  if p_patch ? 'deposit_percent_bp' then
    v_int := app.venue_patch_int(p_patch, 'deposit_percent_bp', 100, 10000);
  end if;
  if p_patch ? 'deposit_window_seconds' then
    v_int := app.venue_patch_int(p_patch, 'deposit_window_seconds', 120, 1800);
  end if;
  if p_patch ? 'deposit_forfeit_no_show'
     and jsonb_typeof(p_patch->'deposit_forfeit_no_show') <> 'boolean' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_forfeit_no_show';
  end if;
  if p_patch ? 'deposit_min_iqd' then
    if jsonb_typeof(p_patch->'deposit_min_iqd') <> 'number'
       or (p_patch->>'deposit_min_iqd')::numeric <> trunc((p_patch->>'deposit_min_iqd')::numeric)
       or (p_patch->>'deposit_min_iqd')::numeric not between 0 and 10000000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_min_iqd';
    end if;
  end if;
  if p_patch ? 'deposit_max_iqd' and jsonb_typeof(p_patch->'deposit_max_iqd') <> 'null' then
    if jsonb_typeof(p_patch->'deposit_max_iqd') <> 'number'
       or (p_patch->>'deposit_max_iqd')::numeric <> trunc((p_patch->>'deposit_max_iqd')::numeric)
       or (p_patch->>'deposit_max_iqd')::numeric not between 1 and 10000000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_max_iqd';
    end if;
  end if;
  v_min := coalesce((p_patch->>'deposit_min_iqd')::bigint, (v_before->>'deposit_min_iqd')::bigint);
  v_max := case when p_patch ? 'deposit_max_iqd' then (p_patch->>'deposit_max_iqd')::bigint
                else (v_before->>'deposit_max_iqd')::bigint end;
  if v_max is not null and v_max < v_min then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'deposit_max_iqd',
      hint = 'the maximum is below the minimum';
  end if;

  perform set_config('app.venue_id', v_venue::text, true);

  update venue_settings
     set deposit_mode            = case when p_patch ? 'deposit_mode' then p_patch->>'deposit_mode' else deposit_mode end,
         deposit_percent_bp      = case when p_patch ? 'deposit_percent_bp'
                                        then (p_patch->>'deposit_percent_bp')::int else deposit_percent_bp end,
         deposit_min_iqd         = v_min,
         deposit_max_iqd         = v_max,
         deposit_window_seconds  = case when p_patch ? 'deposit_window_seconds'
                                        then (p_patch->>'deposit_window_seconds')::int else deposit_window_seconds end,
         deposit_forfeit_no_show = case when p_patch ? 'deposit_forfeit_no_show'
                                        then (p_patch->>'deposit_forfeit_no_show')::boolean else deposit_forfeit_no_show end
   where venue_id = v_venue;

  v_after := app.deposit_settings(v_venue);
  if v_before is distinct from v_after then
    perform app.write_audit('venue.deposit_settings', 'venue_settings', v_venue::text, v_before, v_after);
  end if;
  return v_after;
end $set_deposit_settings_0242$;

comment on function app.set_deposit_settings(jsonb, uuid) is
  '0242. Owner. Patch the branch''s deposit rules (deposit_mode off|optional|required, deposit_percent_bp 100..10000, deposit_min_iqd 0..10M, deposit_max_iqd null or min..10M, deposit_window_seconds 120..1800, deposit_forfeit_no_show). Returns deposit_settings. Audited venue.deposit_settings.';

revoke all on function app.set_deposit_settings(jsonb, uuid) from public, anon;
grant execute on function app.set_deposit_settings(jsonb, uuid) to authenticated;

create or replace function app.deposit_attention(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_attention_0242$
declare
  v_venue uuid;
  v_out   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  bp.id,
           'request_id',          bp.request_id,
           'reservation_id',      bp.reservation_id,
           'guest_name',          coalesce(r.guest_name, p.full_name),
           'guest_phone',         coalesce(r.guest_phone, p.phone),
           'amount_iqd',          bp.amount_iqd,
           'refund_amount_iqd',   bp.refund_amount_iqd,
           'status',              bp.status,
           'refund_reason',       bp.refund_reason,
           'refund_requested_at', bp.refund_requested_at,
           'refund_attempts',     bp.refund_attempts,
           'succeeded_at',        bp.succeeded_at,
           'sandbox',             bp.sandbox,
           'court_name_en',       c.name_en,
           'court_name_ar',       c.name_ar,
           'start_at',            r.start_at) order by coalesce(bp.refund_requested_at, bp.succeeded_at)),
         '[]'::jsonb)
    into v_out
    from booking_payments bp
    join reservations r on r.id = bp.reservation_id
    left join courts c on c.id = r.court_id
    left join profiles p on p.id = bp.guest_id
   where bp.venue_id = v_venue
     and (bp.status = 'refund_failed'
          or (bp.status = 'refund_pending' and bp.refund_requested_at <= now() - interval '24 hours')
          or (bp.status = 'succeeded' and bp.forfeited_at is null
              and not (r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed', 'no_show'))));
  return v_out;
end $deposit_attention_0242$;

comment on function app.deposit_attention(uuid) is
  '0242. Manager, owner. Online deposits a person must look at: refund_failed, refund_pending for more than 24 hours, and succeeded deposits whose booking is no longer live.';

revoke all on function app.deposit_attention(uuid) from public, anon;
grant execute on function app.deposit_attention(uuid) to authenticated;

create or replace function app.deposit_refund_retry(p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_retry_0242$
declare
  v booking_payments%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  -- Lock order court → reservations → booking_payments, as deposit_apply.
  perform app.lock_court((select court_id from reservations where id = v.reservation_id));
  perform 1 from reservations where id = v.reservation_id for update;
  select * into v from booking_payments where id = p_payment_id for update;
  if v.status <> 'refund_failed' then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v.status;
  end if;
  perform set_config('app.venue_id', v.venue_id::text, true);

  update booking_payments
     set status = 'refund_pending', refund_attempts = 0, claimed_at = null,
         refund_requested_at = now(), updated_at = now()
   where id = v.id
   returning * into v;
  perform app.deposit_event(v.id, 'manual', null, null, 'refund retry', '{}'::jsonb);
  perform app.write_audit('deposit.refund_retry', 'booking_payments', v.id::text, null,
                          jsonb_build_object('reservation_id', v.reservation_id));
  perform app.deposit_nudge();
  return jsonb_build_object('id', v.id, 'status', v.status);
end $deposit_refund_retry_0242$;

revoke all on function app.deposit_refund_retry(uuid) from public, anon;
grant execute on function app.deposit_refund_retry(uuid) to authenticated;

create or replace function app.deposit_refund_manual(
  p_payment_id uuid,
  p_pin        text,
  p_note       text,
  p_device_id  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_manual_0242$
declare
  v      booking_payments%rowtype;
  v_auth uuid;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      hint = 'say how the guest got their money back';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  -- 0115: the PIN was proved to app.verify_manager_pin a moment ago (its own
  -- transaction, so the attempt persists and the lockout counts). p_pin is
  -- never read here: no grant is PIN_GRANT_REQUIRED whatever it says.
  v_auth := app.consume_pin_grant(p_device_id);
  -- Lock order court → reservations → booking_payments, as deposit_apply.
  perform app.lock_court((select court_id from reservations where id = v.reservation_id));
  perform 1 from reservations where id = v.reservation_id for update;
  select * into v from booking_payments where id = p_payment_id for update;
  if v.status not in ('refund_pending', 'refund_failed', 'succeeded') then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v.status;
  end if;
  perform set_config('app.venue_id', v.venue_id::text, true);

  update booking_payments
     set status            = 'refunded',
         refund_reason     = case when status = 'succeeded' then 'manual' else refund_reason end,
         refund_amount_iqd = coalesce(refund_amount_iqd, amount_iqd),
         refund_requested_at = coalesce(refund_requested_at, now()),
         refunded_at       = now(),
         refund_note       = left(btrim(p_note), 300),
         claimed_at        = null,
         updated_at        = now()
   where id = v.id
   returning * into v;
  perform app.deposit_event(v.id, 'manual', null, null, 'settled another way', '{}'::jsonb);
  perform app.write_audit('deposit.refund_manual', 'booking_payments', v.id::text, null,
                          jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'note', v.refund_note,
                                             'reservation_id', v.reservation_id),
                          'manual', v_auth);
  return jsonb_build_object('id', v.id, 'status', v.status);
end $deposit_refund_manual_0242$;

comment on function app.deposit_refund_manual(uuid, text, text, text) is
  '0242. Manager, owner, with a manager PIN. Marks an online deposit refunded because the guest got the money back another way (cash at the desk, a bank transfer). The note says how. Nothing is sent to Qi.';

revoke all on function app.deposit_refund_manual(uuid, text, text, text) from public, anon;
grant execute on function app.deposit_refund_manual(uuid, text, text, text) to authenticated;

create or replace function app.deposit_refund_request(p_payment_id uuid, p_amount_iqd bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_request_0242$
declare
  v booking_payments%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  -- Lock order court → reservations → booking_payments, as deposit_apply.
  perform app.lock_court((select court_id from reservations where id = v.reservation_id));
  perform 1 from reservations where id = v.reservation_id for update;
  perform 1 from booking_payments where id = p_payment_id for update;
  perform set_config('app.venue_id', v.venue_id::text, true);
  v := app.deposit_begin_refund(p_payment_id, 'staff_refund', p_amount_iqd);
  perform app.deposit_nudge();
  return jsonb_build_object('id', v.id, 'status', v.status, 'refund_amount_iqd', v.refund_amount_iqd);
end $deposit_refund_request_0242$;

revoke all on function app.deposit_refund_request(uuid, bigint) from public, anon;
grant execute on function app.deposit_refund_request(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. confirm_booking: re-issued from 20260926000210_booking_settings_per_venue.sql:297,
--    plus DEPOSIT_REQUIRED.
-- ---------------------------------------------------------------------------
create or replace function app.confirm_booking(
  p_hold_id     uuid,
  p_guest_name  text default null,
  p_guest_phone text default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a phone on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players     int  default null
) returns jsonb
language plpgsql security definer set search_path = public as $confirm_booking_0242$
declare
  v_uid    uuid := auth.uid();
  v        reservations%rowtype;
  v_before jsonb;
  v_rule   uuid;
  v_price  bigint;
  v_dur    int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_hold_id for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not app.is_staff('court_desk','manager','owner')
     and v.guest_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Idempotent confirm.
  if v.kind = 'booking' and v.status = 'confirmed' then
    return jsonb_build_object('duplicate', true, 'reservation_id', v.id,
      'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
  end if;

  if v.kind <> 'hold' or v.status <> 'pending' or v.hold_expires_at < now() then
    raise exception 'HOLD_EXPIRED' using errcode = 'P0001';
  end if;

  -- DEGRADED GUARD (0021): guests cannot confirm inside the protected horizon
  -- while the venue trades offline; staff paths are unaffected.
  if not app.is_staff('court_desk','manager','owner') then
    perform app.assert_not_degraded_for(v.start_at, v.venue_id);
  end if;

  -- 0059: spec 05.3 makes the phone a required PROFILE field and the desk
  -- relies on it to reach a guest about their booking. Enforced only in the app
  -- until now; a social sign-in creates a phone-less profile, so the write path
  -- refuses too. Staff paths pass p_guest_phone and are exempt.
  if not app.is_staff('court_desk','manager','owner')
     and not exists (select 1 from profiles
                      where id = v_uid and nullif(btrim(phone), '') is not null) then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
      hint = 'add a phone number to your profile before confirming';
  end if;

  -- 0242: when the branch asks this guest to pay first, a guest confirm needs
  -- a paid deposit (which app.deposit_apply confirms by itself, so reaching
  -- here without one is the refusal). Desk bookings are never asked.
  if not app.is_staff('court_desk','manager','owner')
     and app.deposit_mode_for(v_uid, v.venue_id) = 'required'
     and not exists (select 1 from booking_payments bp
                      where bp.hold_id = v.id and bp.status = 'succeeded') then
    raise exception 'DEPOSIT_REQUIRED' using errcode = 'P0001',
      hint = 'this booking needs an online deposit before it is confirmed';
  end if;

  if v.guest_id is null and coalesce(p_guest_name, v.guest_name) is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001',
      hint = 'a booking needs guest_id or guest_name';
  end if;

  v_before := to_jsonb(v);
  v_dur := (extract(epoch from (v.end_at - v.start_at)) / 60)::int;

  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(v.court_id, v.start_at, v_dur) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001';
  end if;

  -- 0117 (C5): quote = charge. The hold carries the price the guest was shown
  -- (stamped by hold_slot since 0117). If the rate rules moved underneath the
  -- hold, refuse rather than charge an amount nobody agreed to; the app shows
  -- the new price and asks again. A hold from before 0117 has no stamp and
  -- keeps the old behaviour. Staff paths are exempt: the desk sees the current
  -- price on screen as it confirms.
  if v.price_iqd is not null and v.price_iqd <> v_price
     and not app.is_staff('court_desk','manager','owner') then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001',
      detail = jsonb_build_object('quoted_iqd', v.price_iqd, 'current_iqd', v_price,
                                  'rate_rule_id', v_rule)::text,
      hint = 'the price of this slot changed after it was held; hold it again to see the new price';
  end if;

  update reservations
     set kind            = 'booking',
         status          = 'confirmed',
         rate_rule_id    = v_rule,
         price_iqd       = v_price,
         guest_name      = coalesce(p_guest_name, guest_name),
         guest_phone     = coalesce(p_guest_phone, guest_phone),
         hold_expires_at = null
   where id = p_hold_id
   returning * into v;

  perform app.write_audit('reservation.confirm', 'reservations', v.id::text,
                          v_before, to_jsonb(v), null, null, v.device_id);

  return jsonb_build_object('duplicate', false, 'reservation_id', v.id,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
end $confirm_booking_0242$;

-- ---------------------------------------------------------------------------
-- 8. release_hold: re-issued from 20260903000060_release_hold.sql, plus: a
--    hold whose payment is still open is not released (the payment window
--    owns it; deposit_apply releases it when the payment ends).
-- ---------------------------------------------------------------------------
create or replace function app.release_hold(p_reservation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $release_hold_0242$
declare
  v_uid    uuid := auth.uid();
  v        reservations%rowtype;
  v_before jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0048/C1 parity: only an account can own a hold, so only an account can
  -- release one. Checked BEFORE the argument is used (check-rpc-authz.mjs).
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001',
      hint = 'releasing a hold requires a signed-in account';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Ownership before kind: a caller must never learn what someone else's
  -- reservation is by the shape of the refusal (0038 #7 / 0048 H3).
  if v.guest_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v.kind <> 'hold' then
    raise exception 'NOT_A_HOLD' using errcode = 'P0001',
      hint = 'confirmed bookings are cancelled through cancel_reservation';
  end if;

  -- Already gone (swept, released twice, or cancelled at the desk): report the
  -- state, do not raise. Releasing is idempotent by design.
  if v.status <> 'pending' then
    return jsonb_build_object('reservation_id', v.id, 'status', v.status,
      'released', false);
  end if;

  -- 0242: the guest may already have paid at the bank; the slot waits for
  -- the payment's answer.
  if exists (select 1 from booking_payments
              where hold_id = v.id and status in ('created', 'pending')) then
    return jsonb_build_object('reservation_id', v.id, 'status', v.status,
      'released', false, 'payment_in_progress', true);
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = 'expired'
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.release', 'reservations', v.id::text,
                          v_before, to_jsonb(v), 'guest_released');

  return jsonb_build_object('reservation_id', v.id, 'status', v.status,
    'released', true);
end $release_hold_0242$;

-- ---------------------------------------------------------------------------
-- 9. expire_stale_holds: re-issued from 20260906000071_booking_integrity.sql,
--    plus: a hold with an open payment is not swept until ten minutes past
--    that payment's deadline (the reconciler normally ends it first; the ten
--    minutes are the backstop if the reconciler is down).
-- ---------------------------------------------------------------------------
create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $sweep_0242$
declare v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or r.guest_id is null)   -- 0071 (SEC-07): orphans too
        and (p_court_id is null or r.court_id = p_court_id)
        and (p_period is null or r.period && p_period)
        and not exists (select 1 from booking_payments bp
                         where bp.hold_id = r.id
                           and bp.status in ('created', 'pending')
                           and bp.deadline_at > now() - interval '10 minutes')
      order by r.id
      for update of r
   );
  get diagnostics v_count = row_count;
  return v_count;
end $sweep_0242$;
comment on function app.expire_stale_holds(uuid, tstzrange) is
  '0071: expires holds past their TTL AND orphan holds (guest_id is null), which no caller can release through app.release_hold and which would otherwise occupy the court until TTL. 0242: skips a hold whose online payment is still open, until ten minutes after that payment''s deadline.';

-- ---------------------------------------------------------------------------
-- 10. court_fee_paid: re-issued from 20260917000106_desk_payment.sql, plus the
--     live booking's online deposit (net of refunds). court_fee_remaining,
--     compute_tab_totals, settle_tab and booking_bill_states inherit it.
--     A booking that is not live counts no deposit: whatever happens to that
--     money is the deposit's own refund or forfeit, never "owed back" by a tab.
-- ---------------------------------------------------------------------------
create or replace function app.court_fee_paid(p_reservation_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $court_fee_paid_0242$
  select (coalesce((select sum(t.court_iqd)
                      from tabs t
                     where t.reservation_id = p_reservation_id
                       and t.status = 'settled'
                       and t.merged_into_tab_id is null
                       and t.id is distinct from p_exclude_tab_id), 0)
          + coalesce((select app.deposit_net_paid(r.id)
                        from reservations r
                       where r.id = p_reservation_id
                         and r.kind = 'booking'
                         and r.status in ('confirmed', 'arrived', 'completed')), 0))::bigint
$court_fee_paid_0242$;
revoke all on function app.court_fee_paid(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. booking_bill: re-issued from 20260926000231_branch_scoped_reads.sql,
--     plus online_paid_iqd and online_payments.
-- ---------------------------------------------------------------------------
create or replace function app.booking_bill(p_reservation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $booking_bill_0242$
declare
  v_res        reservations%rowtype;
  v_court      courts%rowtype;
  v_live       boolean;
  v_day_open   boolean;
  v_tab        tabs%rowtype;
  v_totals     record;
  v_paid_net   bigint;
  v_live_json  jsonb := null;
  v_court_paid bigint;
  v_remaining  bigint;
  v_refunds    bigint;
  v_refund_due bigint;
  v_settled    jsonb;
  v_online     bigint;
  v_online_list jsonb;
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_res from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_res.venue_id, 'cashier','court_desk','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select * into v_court from courts where id = v_res.court_id;

  v_live := v_res.kind = 'booking' and v_res.status in ('confirmed','arrived','completed');
  v_day_open := exists (select 1 from day_sessions where status = 'open' and venue_id = v_res.venue_id);

  select * into v_tab from tabs
   where reservation_id = v_res.id and status in ('open','awaiting_payment')
   limit 1;
  if found then
    select * into v_totals from app.compute_tab_totals(v_tab.id);
    v_paid_net := app.tab_net_paid(v_tab.id);
    v_live_json := jsonb_build_object(
      'id',              v_tab.id,
      'status',          v_tab.status,
      'day_session_id',  v_tab.day_session_id,
      'subtotal_iqd',    v_totals.subtotal_iqd,
      'discount_iqd',    v_totals.discount_iqd,
      'tax_iqd',         v_totals.tax_iqd,
      'court_iqd',       v_totals.court_iqd,
      'total_iqd',       v_totals.total_iqd,
      'paid_iqd',        v_paid_net,
      'due_iqd',         greatest(v_totals.total_iqd - v_paid_net, 0),
      'over_paid_iqd',   greatest(v_paid_net - v_totals.total_iqd, 0),
      -- Units, not rows: two coffees on one line are two items to the guest.
      'item_count',      (select coalesce(sum(oi.qty), 0) from order_items oi join orders o on o.id = oi.order_id
                           where o.tab_id = v_tab.id and o.status <> 'voided' and not oi.voided),
      'has_orders',      exists (select 1 from orders where tab_id = v_tab.id),
      'has_payments',    exists (select 1 from payments where tab_id = v_tab.id),
      'has_adjustments', exists (select 1 from tab_adjustments where tab_id = v_tab.id));
  end if;

  v_court_paid := app.court_fee_paid(v_res.id, null);
  v_remaining  := app.court_fee_remaining(v_res.id, null);
  -- 0242: the part of court_paid that came in online (0 unless live).
  v_online     := case when v_live then app.deposit_net_paid(v_res.id) else 0 end;

  select coalesce(sum(rf.amount_iqd), 0) into v_refunds
    from refunds rf
    join payments p on p.id = rf.payment_id
    join tabs t on t.id = p.tab_id
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  -- Display only ("may be owed back"): what the settled tabs billed for the
  -- court beyond what the booking now costs, less anything already refunded
  -- on those tabs. A refund carries no court/goods split, so this is a prompt
  -- for a manager, never a figure anything else is computed from.
  v_refund_due := greatest(
    v_court_paid - (case when v_live then coalesce(v_res.price_iqd, 0) else 0 end) - v_refunds,
    0);

  select coalesce(jsonb_agg(jsonb_build_object(
           'tab_id',      t.id,
           'settled_at',  t.settled_at,
           'court_iqd',   t.court_iqd,
           'total_iqd',   t.total_iqd,
           'refunds_iqd', (select coalesce(sum(rf.amount_iqd), 0) from refunds rf
                             join payments p2 on p2.id = rf.payment_id where p2.tab_id = t.id),
           'payments',    (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id',               p.id,
                                     'method',           p.method,
                                     'amount_iqd',       p.amount_iqd,
                                     'tendered_iqd',     p.tendered_iqd,
                                     'change_iqd',       p.change_iqd,
                                     'created_at',       p.created_at,
                                     'recorded_by_name', s.display_name) order by p.created_at), '[]'::jsonb)
                             from payments p left join staff s on s.id = p.recorded_by
                            where p.tab_id = t.id)
         ) order by t.settled_at), '[]'::jsonb)
    into v_settled
    from tabs t
   where t.reservation_id = v_res.id and t.status = 'settled' and t.merged_into_tab_id is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                bp.id,
           'status',            bp.status,
           'amount_iqd',        bp.amount_iqd,
           'refund_amount_iqd', bp.refund_amount_iqd,
           'refund_reason',     bp.refund_reason,
           'succeeded_at',      bp.succeeded_at,
           'refunded_at',       bp.refunded_at,
           'forfeited',         bp.forfeited_at is not null,
           'sandbox',           bp.sandbox) order by bp.succeeded_at), '[]'::jsonb)
    into v_online_list
    from booking_payments bp
   where bp.reservation_id = v_res.id
     and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded');

  return jsonb_build_object(
    'reservation', jsonb_build_object(
       'id',            v_res.id,
       'kind',          v_res.kind,
       'status',        v_res.status,
       'price_iqd',     v_res.price_iqd,
       'guest_name',    v_res.guest_name,
       'start_at',      v_res.start_at,
       'end_at',        v_res.end_at,
       'court_id',      v_res.court_id,
       'court_name_en', v_court.name_en,
       'court_name_ar', v_court.name_ar),
    'live',                 v_live,
    'day_open',             v_day_open,
    'live_tab',             v_live_json,
    'court_paid_iqd',       v_court_paid,
    'court_remaining_iqd',  v_remaining,
    'court_refund_due_iqd', v_refund_due,
    'settled_tabs',         v_settled,
    'online_paid_iqd',      v_online,
    'online_payments',      v_online_list);
end $booking_bill_0242$;

-- ---------------------------------------------------------------------------
-- 12. my_reservations: re-created from 20260926000235_my_reservations_venue.sql
--     with online_paid_iqd, payment_status and payment_ref (a new column
--     changes the result type, so drop + create + grants, as 0235 did).
-- ---------------------------------------------------------------------------
drop function if exists app.my_reservations(uuid);

create function app.my_reservations(p_reservation_id uuid default null)
returns table(id uuid, court_id uuid, kind text, status text, start_at timestamptz, end_at timestamptz,
              price_iqd bigint, hold_expires_at timestamptz, cancelled_by text, cancelled_at timestamptz,
              court_paid_iqd bigint, court_remaining_iqd bigint, venue_id uuid,
              online_paid_iqd bigint, payment_status text, payment_ref uuid)
language sql stable security definer set search_path = public as $my_reservations_0242$
  select r.id,
         r.court_id,
         r.kind::text,
         r.status::text,
         r.start_at,
         r.end_at,
         r.price_iqd::bigint,
         r.hold_expires_at,
         r.cancelled_by::text,
         r.cancelled_at,
         app.court_fee_paid(r.id)      as court_paid_iqd,
         app.court_fee_remaining(r.id) as court_remaining_iqd,
         r.venue_id,
         app.deposit_net_paid(r.id)    as online_paid_iqd,
         lp.status                     as payment_status,
         lp.request_id                 as payment_ref
    from reservations r
    left join lateral (
      select bp.status, bp.request_id
        from booking_payments bp
       where bp.reservation_id = r.id or bp.hold_id = r.id
       order by bp.created_at desc
       limit 1
    ) lp on true
   where auth.uid() is not null
     and r.guest_id = auth.uid()
     and (p_reservation_id is null or r.id = p_reservation_id)
   order by r.start_at desc
   limit 100
$my_reservations_0242$;

revoke all on function app.my_reservations(uuid) from public, anon;
grant execute on function app.my_reservations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. set_customer_flags: re-issued from 20260903000065_customers.sql, plus
--     deposit_exempt.
-- ---------------------------------------------------------------------------
create or replace function app.set_customer_flags(p_customer_id uuid, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_customer_flags_0242$
declare
  v_flags  jsonb := coalesce(p_flags, '[]'::jsonb);
  v_flag   jsonb;
  v_type   text;
  v_label  text;
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_flags) <> 'array' then
    raise exception 'INVALID_FLAGS' using errcode = 'P0001',
      hint = 'p_flags is an array of {type, label}';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Validate everything before touching the table: a refused call leaves the
  -- previous flags exactly as they were.
  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_type := v_flag->>'type';
    if v_type is null or v_type not in ('vip','birthday','payment_note','special_request','deposit_exempt') then
      raise exception 'INVALID_FLAG' using errcode = 'P0001',
        detail = coalesce(v_type, 'null'),
        hint = 'type is vip | birthday | payment_note | special_request | deposit_exempt';
    end if;
    if length(coalesce(v_flag->>'label', '')) > 120 then
      raise exception 'LABEL_LENGTH' using errcode = 'P0001',
        hint = 'a flag label is at most 120 characters';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_flags))
     <> (select count(distinct f->>'type') from jsonb_array_elements(v_flags) f) then
    raise exception 'DUPLICATE_FLAG' using errcode = 'P0001',
      hint = 'each flag type may appear once';
  end if;

  v_before := app.customer_flags_json(p_customer_id);

  delete from customer_flags where customer_id = p_customer_id;

  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_label := nullif(btrim(coalesce(v_flag->>'label', '')), '');
    insert into customer_flags (customer_id, type, label, created_by)
    values (p_customer_id, v_flag->>'type', v_label, auth.uid());
  end loop;

  v_after := app.customer_flags_json(p_customer_id);

  if v_before is distinct from v_after then
    perform app.write_audit('customer.flags_set', 'customer_flags', p_customer_id::text,
                            v_before, v_after);
  end if;

  return v_after;
end $set_customer_flags_0242$;

-- ---------------------------------------------------------------------------
-- 14. tp_deposit_sweep: the reconciler every 30 seconds (every minute where
--     pg_cron predates the seconds syntax). Guarded like 0090.
-- ---------------------------------------------------------------------------
do $deposit_cron_0242$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_deposit_sweep not scheduled';
    return;
  end if;
  begin
    perform cron.schedule('tp_deposit_sweep', '30 seconds', 'select app.deposit_nudge();');
  exception when others then
    raise notice 'pg_cron seconds syntax unsupported (%) - tp_deposit_sweep every minute', sqlerrm;
    perform cron.schedule('tp_deposit_sweep', '* * * * *', 'select app.deposit_nudge();');
  end;
end $deposit_cron_0242$;
