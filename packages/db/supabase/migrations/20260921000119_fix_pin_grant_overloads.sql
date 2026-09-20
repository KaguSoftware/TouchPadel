-- ===========================================================================
-- 0119 — remove the stray overloads 0115 created for apply_discount and
-- override_price, and put the grant model in force for them.
--
-- THE DEFECT. 0049 dropped the 7-arg app.apply_discount(uuid, adjustment_kind,
-- int, text, text, uuid, text) and the 5-arg app.override_price(uuid, bigint,
-- text, text, text) and CREATED (plain `create function`, 0049:111-123 and
-- 0049:229-238) the 8-/6-arg forms that end in p_idempotency_key and carry the
-- claim_replay / finish_replay pair. 0115 then re-issued both with
-- `create or replace function` at the PRE-0049 arities (0115:256-264,
-- 0115:365-371). Because those arities no longer existed, Postgres created two
-- NEW functions instead of replacing anything: every database that ran 0115
-- has had two live overloads of each name since.
--
-- WHAT IT DID.
--   * Keyed callers — the till (apps/operator/src/lib/mutate.ts) and the replay
--     function (functions/replay/index.ts, common()) always send
--     p_idempotency_key — resolve to the 8-/6-arg 0049 bodies, whose PIN check
--     is still verify_manager_pin + raise PIN_INVALID. The single-use grant the
--     client minted a moment earlier was never consumed, every successful
--     discount or override verified the PIN a second time (two pin_attempts
--     rows, two grants), and the 0115 lockout property was simply not in force
--     for these two RPCs.
--   * Keyless callers — tests/pin-grants.test.ts, cafe-money, analytics — match
--     both overloads and get PostgREST PGRST203 ("could not choose the best
--     candidate function").
--   * The strays carried NO grant (0003 revokes execute by default in schema
--     app), so scripts/check-rpc-registry.mjs and check-rpc-authz.mjs — both
--     grant-driven — never saw them; only tests/rpc-overloads.test.ts (new) and
--     the static overload rule in check-rpc-registry.mjs (new) can.
--
-- WHY IT HAPPENED. "Re-issue from the latest body" was implemented as a search
-- for `create or replace function app.<name>(`; 0049's plain `create function`
-- did not match and the search fell back to 0037 / 0044. The rule in
-- packages/db/CLAUDE.md now says: grep `function app.<name>(` — both spellings
-- count — and the overload gate makes the mistake fail the build.
--
-- THE FIX. Drop the two 0115 strays by exact signature; re-issue the 8-arg
-- apply_discount and the 6-arg override_price from the 0049 bodies VERBATIM
-- ($disc_0049$, $override_0049$), changing only the PIN block, exactly as 0115
-- meant to: verify_manager_pin + PIN_INVALID becomes app.consume_pin_grant.
-- claim_replay stays where 0049 put it (after the guards, before any write);
-- a replayed call returns the stored result before touching the grant, which
-- leaves that grant to expire — bounded by app.pin_grant_ttl(), single-use,
-- harmless. `create or replace` is correct here because the 8-/6-arg
-- signatures exist; the grants are re-issued anyway because the registry gate
-- forgets a name's grants on any `drop function app.<name>(...)`.
--
-- Hosted never ran 0115 (nothing from 0108 on is there), so no data or
-- pin_attempts telemetry needs repair on hosted. Locally, `db reset`.
--
-- covered by packages/db/tests/rpc-overloads.test.ts and the keyed cases in
-- packages/db/tests/pin-grants.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The strays 0115 created.
-- ---------------------------------------------------------------------------
drop function if exists app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text);
drop function if exists app.override_price(uuid, bigint, text, text, text);

-- ---------------------------------------------------------------------------
-- 2. app.apply_discount — $disc_0049$ (0049:113-219) VERBATIM; only the PIN
--    block (0049:154-157) is replaced by the 0115 grant consumption.
-- ---------------------------------------------------------------------------
create or replace function app.apply_discount(
  p_tab_id        uuid,
  p_kind          adjustment_kind,
  p_value         int,
  p_pin           text,
  p_reason_code   text,
  p_order_item_id uuid default null,
  p_device_id     text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_discount_0119$
declare
  v_auth      uuid;
  v_tab       tabs%rowtype;
  v_base      bigint;
  v_amount    bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
  v_replay    jsonb;
  v_result    jsonb;
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

  -- 0049: claim BEFORE the PIN check and before any write, but AFTER the role
  -- guard, so an unauthorized caller cannot burn keys. The claim lives in this
  -- transaction: every raise below rolls it back with the work.
  v_replay := app.claim_replay(p_idempotency_key, 'apply_discount');
  if v_replay is not null then
    return v_replay;
  end if;

  -- 0115/0119: the PIN itself is no longer checked here. The caller proved it to
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

  v_result := jsonb_build_object('adjustment_id', v_adj.id, 'amount_iqd', v_amount);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $apply_discount_0119$;

comment on function app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text, text) is
  '0119: the 0049 body (claim_replay) with the 0115 PIN grant; the only live signature.';

revoke all on function app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text, text)
  from public, anon;
grant execute on function app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.override_price — $override_0049$ (0049:231-341) VERBATIM; only the
--    PIN block (0049:271-274) is replaced by the 0115 grant consumption.
-- ---------------------------------------------------------------------------
create or replace function app.override_price(
  p_order_item_id uuid,
  p_new_unit_price_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_device_id text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $override_price_0119$
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
  v_replay    jsonb;
  v_result    jsonb;
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

  -- 0049: claim before the PIN check and before any write; after the role guard.
  v_replay := app.claim_replay(p_idempotency_key, 'override_price');
  if v_replay is not null then
    return v_replay;
  end if;

  -- 0115/0119: the PIN itself is no longer checked here. The caller proved it to
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

  v_result := jsonb_build_object('adjustment_id', v_adj.id,
    'order_item_id', v_oi.id, 'line_total_iqd', v_new_line);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $override_price_0119$;

comment on function app.override_price(uuid, bigint, text, text, text, text) is
  '0119: the 0049 body (claim_replay) with the 0115 PIN grant; the only live signature.';

revoke all on function app.override_price(uuid, bigint, text, text, text, text) from public, anon;
grant execute on function app.override_price(uuid, bigint, text, text, text, text) to authenticated;
