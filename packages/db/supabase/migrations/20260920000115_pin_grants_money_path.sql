-- ===========================================================================
-- 0115 — the manager-PIN lockout engages on the money path (S3).
--
-- THE DEFECT. app.verify_manager_pin records every attempt in app.pin_attempts
-- and returns NULL on a wrong PIN; the five money RPCs that call it then
-- `raise exception 'PIN_INVALID'`. A raise aborts the transaction, and the
-- attempt row is rolled back with it — so through apply_discount,
-- override_price, refund, void_after_send and write_off_expired the counter
-- never moved and the 5-failures lockout never engaged. A six-digit PIN was
-- brute-forceable from any cashier session, padded to 250 ms a guess and
-- nothing else. 0011 fixed the same rollback for the direct call and 0086 wrote
-- down why the lockout row lives on a returning path; neither could reach a
-- raise that happens in the CALLER.
--
-- WHY NOT "return a typed failure": Postgres has no autonomous transactions.
-- Whatever verify_manager_pin returns, the caller's raise still rolls the
-- attempt back; and a money RPC that returns an error object instead of
-- raising breaks the one contract every client relies on (P0001 message =
-- machine code) in nine bodies and three transports at once.
--
-- THE FIX — a grant, minted where the attempt commits.
--   1. app.verify_manager_pin (re-issued from 0086 verbatim, plus two lines) is
--      the ONLY place a manager PIN is ever checked. It is called on its own by
--      the client, so its transaction commits whatever the outcome and the
--      attempt row persists. On success it inserts ONE row into app.pin_grants
--      (caller, authorizer, device, now()).
--   2. app.consume_pin_grant(p_device_id) — internal, revoked from every client
--      role — atomically consumes the caller's newest unconsumed grant younger
--      than app.pin_grant_ttl() (2 minutes) and returns the authorizer. No
--      grant: PIN_GRANT_REQUIRED.
--   3. The five money RPCs call consume_pin_grant where they called
--      verify_manager_pin. They keep p_pin in their signatures (clients and the
--      queued payloads still carry it; dropping it is a later change) but never
--      read it: a wrong PIN, a right PIN and no PIN all get the same
--      PIN_GRANT_REQUIRED without a grant, so the money RPC is not an oracle.
--   4. Every client verifies first: the operator's appRpc wrapper calls
--      verify_manager_pin before any of the five (apps/operator/src/lib/appRpc.ts);
--      the replay edge function does the same as the staff session before it
--      dispatches a queued PIN-gated mutation (functions/replay/index.ts). Both
--      read the list from packages/core PIN_GATED_RPCS /
--      functions/_shared/mutation-types.json, held equal by a test.
--
-- THE ORACLE, CLOSED. A guess at the money RPC returns PIN_GRANT_REQUIRED
-- regardless of correctness; a guess at verify_manager_pin is counted, padded
-- and locked out at five. There is no third door.
--
-- WEAK PINs (Part B item 4, second half). verify_manager_pin now treats a
-- CORRECT pin that app.pin_is_weak() rejects (0078) exactly like a wrong one —
-- same padding, same attempt row, same NULL — and writes an audit row
-- staff.pin_weak_refused naming the manager, on the returning path. A manager
-- whose pre-0078 PIN is weak cannot authorise anything until it is reset with
-- app.set_staff_pin, which refuses weak PINs. OWNER RUNBOOK: rotate every PIN
-- (Part B item 2) BEFORE this migration reaches hosted, or the audit log will
-- say why a manager is suddenly refused.
--
-- Lock order: app.pin_grants is not a ledger table and is not in
-- check-lock-order.mjs ORDER; the consume is a single-row UPDATE ... FOR UPDATE
-- SKIP LOCKED on the caller's own rows, taken before any tab lock.
--
-- covered by packages/db/tests/pin-grants.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.pin_grants — one row per successful manager-PIN verification.
-- ---------------------------------------------------------------------------
create table if not exists app.pin_grants (
  id            bigint generated always as identity primary key,
  caller_id     uuid not null,                       -- auth.uid() that typed the PIN
  authorizer_id uuid not null references staff(id),  -- the manager whose PIN it was
  device_id     text,                                -- client-supplied station id (audit only)
  created_at    timestamptz not null default now(),
  consumed_at   timestamptz
);

comment on table app.pin_grants is
  '0115. A successful app.verify_manager_pin mints one row; app.consume_pin_grant spends it '
  'inside the money RPC. Single-use, app.pin_grant_ttl() old at most, bound to the caller '
  'session. No client role may read or write it.';

-- No index on purpose: one row per successful verification, pruned per caller
-- after an hour, so the table holds at most a few hundred rows venue-wide and the
-- consume lookup (one caller, newest first) is a trivial scan. An index would be
-- a lock-taking statement for nothing.

alter table app.pin_grants enable row level security;
revoke all on app.pin_grants from public, anon, authenticated;

create or replace function app.pin_grant_ttl() returns interval
language sql immutable set search_path = public as $pin_grant_ttl_0115$
  select interval '2 minutes';
$pin_grant_ttl_0115$;

comment on function app.pin_grant_ttl() is
  '0115. How long a manager-PIN grant may sit unconsumed. A constant on purpose, like app.pin_delay_floor(): long enough for the round trip that always follows a verification, too short to be a standing authorisation.';

revoke all on function app.pin_grant_ttl() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.consume_pin_grant — internal. Returns the authorizer or raises.
-- ---------------------------------------------------------------------------
create or replace function app.consume_pin_grant(p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $consume_pin_grant_0115$
declare
  v_auth uuid;
begin
  -- Same staff guard as the callers: reached only from SECURITY DEFINER money
  -- RPCs, but stated here so the function is safe on its own.
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update app.pin_grants g
     set consumed_at = now()
   where g.id = (
     select id from app.pin_grants
      where caller_id = auth.uid()
        and consumed_at is null
        and created_at > now() - app.pin_grant_ttl()
      order by created_at desc
      limit 1
      for update skip locked)
  returning g.authorizer_id into v_auth;

  if v_auth is null then
    raise exception 'PIN_GRANT_REQUIRED' using errcode = 'P0001';
  end if;
  return v_auth;
end $consume_pin_grant_0115$;

comment on function app.consume_pin_grant(text) is
  '0115. Spends the caller''s newest live manager-PIN grant (see app.pin_grants) and returns the authorising manager. PIN_GRANT_REQUIRED when there is none: the caller must run app.verify_manager_pin first. Internal — no client role may execute it.';

revoke all on function app.consume_pin_grant(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.verify_manager_pin — re-issued IN FULL from 0086 ($vmp_0086$), plus the
-- weak-PIN refusal and the grant insert. Signature unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $vmp_0115$
declare
  v_started timestamptz := clock_timestamp();
  v_caller  text := coalesce(auth.uid()::text, 'anon');
  v_key     text;
  v_fails   int;
  v_id      uuid;
  v_matches int;
begin
  -- 0046: staff only. The five money RPCs that call this are SECURITY DEFINER
  -- owned by postgres, so this guard sees the ORIGINAL caller's JWT and passes
  -- for them; a guest probing the endpoint directly is refused before any
  -- bcrypt work happens. NOT padded: this is not a PIN outcome at all, it is
  -- "you are not staff", and the caller's own role is not a secret from them.
  if not app.is_staff('cashier','prep','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- RATE-LIMIT KEY (0026): p_device_id is client-supplied, so keying on it
  -- alone let a caller rotate device ids for unlimited guesses. Attempts are
  -- stored under '{caller}:{device}' and failures are COUNTED per caller
  -- (prefix match across all that caller's devices): 5 fails / 5 min / caller.
  v_key := v_caller || ':' || coalesce(p_device_id, 'unknown');

  select count(*) into v_fails
    from app.pin_attempts
   where device_id like v_caller || ':%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  if v_fails >= 5 then
    -- 0086: padded. Without this a locked-out caller is refused in a
    -- millisecond while a wrong PIN costs a bcrypt, and the retry loop that
    -- follows a lockout runs at full speed.
    perform app.pin_pad_to_floor(v_started);
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  -- 0086: ONE scan, always over every candidate. The previous count(*) +
  -- `select … limit 1` pair made a CORRECT pin measurably faster than a wrong
  -- one, because only the second query could stop early. array_agg with an
  -- ORDER BY keeps 0037's stable attribution on a PIN collision.
  select count(*), (array_agg(id order by id))[1]
    into v_matches, v_id
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash);

  -- 0115: a CORRECT pin that is weak (0078) is refused like a wrong one — same
  -- padding, same attempt row, same NULL — so the refusal is not an oracle
  -- either. The audit row explains it to the owner; app.set_staff_pin, which
  -- refuses weak PINs, is the way out. Written here, on the returning path.
  if v_id is not null and app.pin_is_weak(p_pin) then
    perform app.write_audit('staff.pin_weak_refused', 'staff', v_id::text, null,
                            jsonb_build_object('scope', 'manager'), null, null, p_device_id);
    v_id := null;
    v_matches := 0;
  end if;

  insert into app.pin_attempts (device_id, success) values (v_key, v_id is not null);

  -- 0086: the lockout is audited HERE — at the failure that reaches the
  -- threshold — because this path RETURNS and therefore commits. Writing it
  -- beside the `raise` above would roll the row back with the exception and
  -- log nothing at all (the 0011 lesson).
  --
  -- entity_id is THE CALLER, not the manager whose PIN was guessed at — there
  -- is no such manager on a failure, and audit_log.entity_id is NOT NULL, so
  -- passing null here aborted the whole transaction. That did not merely lose
  -- the audit row: it rolled back the pin_attempts INSERT alongside it, so the
  -- fifth failure was never recorded and THE LOCKOUT NEVER ENGAGED. Caught by
  -- pin-uniformity.test.ts on its first run; it is the 0011 failure mode
  -- wearing a different hat, which is why the row is written on a path that
  -- returns rather than one that raises.
  if v_id is null and v_fails + 1 >= 5 then
    perform app.write_audit('staff.pin_locked', 'staff', v_caller, null,
                            jsonb_build_object('scope', 'manager', 'fails', v_fails + 1,
                                               'window', '5 minutes'),
                            null, null, p_device_id);
  end if;

  -- A collision means authorized_by may name the wrong manager. Ordering makes
  -- the choice stable; it does not make it correct. Real fix is PIN uniqueness.
  if v_matches > 1 then
    raise warning 'PIN collision: % active managers share this PIN', v_matches;
    perform app.write_audit('staff.pin_collision', 'staff', v_id::text, null,
                            jsonb_build_object('matches', v_matches), null, null, p_device_id);
  end if;

  -- 0115: mint the grant the money RPC will consume (app.consume_pin_grant).
  -- This is the returning path, so the row commits with the attempt row.
  if v_id is not null then
    insert into app.pin_grants (caller_id, authorizer_id, device_id)
    values (auth.uid(), v_id, p_device_id);
    -- Housekeeping, bounded: spent or stale rows older than an hour.
    delete from app.pin_grants
     where caller_id = auth.uid()
       and created_at < now() - interval '1 hour';
  end if;

  -- Padded on BOTH outcomes. Padding only the failure would invert the leak:
  -- fast would mean correct.
  perform app.pin_pad_to_floor(v_started);
  return v_id;
end $vmp_0115$;

-- ---------------------------------------------------------------------------
-- app.apply_discount — re-issued IN FULL from 20260825000037_adjustment_guards.sql ($disc_0037$),
-- changed ONLY at the PIN check. Signature unchanged: grants from the original
-- migration survive `create or replace`.
-- ---------------------------------------------------------------------------
create or replace function app.apply_discount(
  p_tab_id        uuid,
  p_kind          adjustment_kind,
  p_value         int,
  p_pin           text,
  p_reason_code   text,
  p_order_item_id uuid default null,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_discount_0115$
declare
  v_auth      uuid;
  v_tab       tabs%rowtype;
  v_base      bigint;
  v_amount    bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_kind not in ('discount_percent','discount_amount') then
    raise exception 'INVALID_KIND' using errcode = 'P0001',
      hint = 'use app.override_price for price overrides';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to


  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt


  -- persisted either way) and holds a single-use grant; without one this raises


  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.


  v_auth := app.consume_pin_grant(p_device_id);

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  if p_order_item_id is not null then
    select oi.line_total_iqd into v_base
      from order_items oi
      join orders o on o.id = oi.order_id
     where oi.id = p_order_item_id and o.tab_id = p_tab_id and not oi.voided;
    if v_base is null then
      raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001';
    end if;
  else
    select t.subtotal_iqd into v_base from app.compute_tab_totals(p_tab_id) t;
  end if;

  if p_kind = 'discount_percent' then
    if p_value < 1 or p_value > 10000 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001',
        hint = 'percent discounts are basis points 1..10000';
    end if;
    v_amount := round((v_base::numeric * p_value) / 10000.0)::bigint;
  else
    if p_value < 1 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001';
    end if;
    v_amount := least(p_value::bigint, v_base);
  end if;

  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (p_tab_id, p_order_item_id, p_kind, p_value, v_amount,
          auth.uid(), v_auth, p_reason_code)
  returning * into v_adj;

  -- DISCOUNT-AFTER-PAYMENT GUARD (0037): the total must still cover what has
  -- been paid net of refunds. Checked AFTER the insert because the total has
  -- to be computed with the adjustment in place; the raise rolls it back.
  -- Same shape as the 0026 VOID_REQUIRES_REFUND guard. app.refund is the
  -- unwind path.
  v_paid := app.tab_net_paid(p_tab_id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(p_tab_id) t;
    if v_new_total < v_paid then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-discount total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before discounting';
    end if;
  end if;

  perform app.write_audit('discount.apply', 'tab_adjustments', v_adj.id::text,
                          null, to_jsonb(v_adj), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('adjustment_id', v_adj.id, 'amount_iqd', v_amount);
end $apply_discount_0115$;

-- ---------------------------------------------------------------------------
-- app.override_price — re-issued IN FULL from 20260827000044_lock_order_fixes.sql ($override_0044$),
-- changed ONLY at the PIN check. Signature unchanged: grants from the original
-- migration survive `create or replace`.
-- ---------------------------------------------------------------------------
create or replace function app.override_price(
  p_order_item_id uuid,
  p_new_unit_price_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $override_price_0115$
declare
  v_auth      uuid;
  v_oi        order_items%rowtype;
  v_tab       tabs%rowtype;
  v_tab_id    uuid;
  v_order_id  uuid;
  v_before    jsonb;
  v_mods      bigint;
  v_new_line  bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_new_unit_price_iqd is null or p_new_unit_price_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to


  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt


  -- persisted either way) and holds a single-use grant; without one this raises


  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.


  v_auth := app.consume_pin_grant(p_device_id);

  -- Resolve the owning tab WITHOUT locking, so the locks below can be taken in
  -- the canonical order (0038). This is exactly the shape void_order_item_internal
  -- uses; before 0044 this function locked the line first and deadlocked against it.
  select o.tab_id, o.id into v_tab_id, v_order_id
    from order_items oi
    join orders o on o.id = oi.order_id
   where oi.id = p_order_item_id;
  if v_tab_id is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs        where id = v_tab_id        for update;
  select * into v_oi  from order_items where id = p_order_item_id for update;

  -- The line could have moved tabs (merge_tabs) between the unlocked read and
  -- the lock; 40001 tells the caller to retry rather than pricing the wrong tab.
  if not exists (select 1 from orders o where o.id = v_oi.order_id and o.tab_id = v_tab.id) then
    raise exception 'TAB_MOVED' using errcode = '40001',
      hint = 'the order moved to another tab mid-override; retry';
  end if;

  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_oi);

  select coalesce(sum(price_delta_iqd * qty), 0) into v_mods
    from order_item_modifiers where order_item_id = v_oi.id;
  v_new_line := (p_new_unit_price_iqd + v_mods) * v_oi.qty;

  update order_items
     set unit_price_iqd = p_new_unit_price_iqd, line_total_iqd = v_new_line
   where id = v_oi.id
   returning * into v_oi;

  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (v_tab.id, v_oi.id, 'price_override', p_new_unit_price_iqd::int,
          greatest((v_before->>'line_total_iqd')::bigint - v_new_line, 0),
          auth.uid(), v_auth, p_reason_code)
  returning * into v_adj;

  -- OVERRIDE-AFTER-PAYMENT GUARD (0037). Trustworthy from 0044 on: refund now
  -- takes the same tab lock, so tab_net_paid cannot move under us here.
  v_paid := app.tab_net_paid(v_tab.id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(v_tab.id) t;
    if v_new_total < v_paid then
      raise exception 'OVERRIDE_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-override total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before overriding';
    end if;
  end if;

  perform app.write_audit('price.override', 'order_items', v_oi.id::text,
                          v_before, to_jsonb(v_oi), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('adjustment_id', v_adj.id,
    'order_item_id', v_oi.id, 'line_total_iqd', v_new_line);
end $override_price_0115$;

-- ---------------------------------------------------------------------------
-- app.refund — re-issued IN FULL from 20260827000044_lock_order_fixes.sql ($refund_0044$),
-- changed ONLY at the PIN check. Signature unchanged: grants from the original
-- migration survive `create or replace`.
-- ---------------------------------------------------------------------------
create or replace function app.refund(
  p_payment_id uuid,
  p_amount_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_items jsonb default null,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0115$
declare
  v_auth     uuid;
  v_payment  payments%rowtype;
  v_tab_id   uuid;
  v_refunded bigint;
  v_refund   refunds%rowtype;
  v_item     jsonb;
  v_oi       order_items%rowtype;
  v_qty      int;
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

  return jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
end $refund_0115$;

-- ---------------------------------------------------------------------------
-- app.void_after_send — re-issued IN FULL from 20260825000032_telegram.sql ($tg_void_after_send$),
-- changed ONLY at the PIN check. Signature unchanged: grants from the original
-- migration survive `create or replace`.
-- ---------------------------------------------------------------------------
create or replace function app.void_after_send(
  p_order_item_id uuid,
  p_pin           text,
  p_reason_code   text,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $void_after_send_0115$
declare
  v_auth uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to


  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt


  -- persisted either way) and holds a single-use grant; without one this raises


  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.


  v_auth := app.consume_pin_grant(p_device_id);

  return app.void_order_item_internal(p_order_item_id, p_reason_code, v_auth, p_device_id, null);
end $void_after_send_0115$;

-- ---------------------------------------------------------------------------
-- app.write_off_expired — re-issued IN FULL from 20260824000018_stock_ledger.sql (anonymous $$),
-- changed ONLY at the PIN check. Signature unchanged: grants from the original
-- migration survive `create or replace`.
-- ---------------------------------------------------------------------------
create or replace function app.write_off_expired(
  p_batch_id    uuid,
  p_pin         text,
  p_reason_code text default 'expired',
  p_device_id   text default null
) returns void
language plpgsql security definer set search_path = public as $write_off_expired_0115$
declare
  v_batch      stock_batches%rowtype;
  v_authorizer uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0115: the PIN itself is no longer checked here. The caller proved it to

  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt

  -- persisted either way) and holds a single-use grant; without one this raises

  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.

  v_authorizer := app.consume_pin_grant(p_device_id);

  select * into v_batch from stock_batches where id = p_batch_id for update;
  if not found then
    raise exception 'BATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_batch.qty_remaining <= 0 then
    raise exception 'BATCH_EMPTY' using errcode = 'P0001';
  end if;

  update stock_batches set qty_remaining = 0 where id = p_batch_id;

  insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                               unit_cost_iqd, staff_id, device_id, reason_code)
  values (v_batch.ingredient_id, p_batch_id, 'expired_writeoff', -v_batch.qty_remaining,
          v_batch.unit_cost_iqd, auth.uid(), p_device_id, p_reason_code);

  perform app.write_audit('stock.write_off_expired', 'stock_batches', p_batch_id::text,
                          to_jsonb(v_batch), null, p_reason_code, v_authorizer, p_device_id);
end $write_off_expired_0115$;
