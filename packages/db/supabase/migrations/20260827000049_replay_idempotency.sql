-- ===========================================================================
-- 0049 — the offline replay path could apply the same money twice
--
-- functions/replay/index.ts dispatches the queued RPC at :303 and only THEN
-- inserts the sync_replays row at :313, as a separate statement whose failure
-- is merely logged (:329). If that insert fails, or the HTTP response is lost
-- on the way back to the till, the till's retry finds no sync_replays row
-- (:272-280) and dispatches the SAME mutation again.
--
-- Seven of the routed RPCs survive that: they take a p_idempotency_key and
-- return {duplicate:true}. Six do not. Of those six, three are naturally
-- idempotent and were audited as safe:
--
--   set_ticket_status     transition-guarded; a same-status replay echoes
--                         {duplicate:true} (0032:433 / 0037:299)
--   ack_waiter_call       app.waiter_call_transition, 0032:648: "idempotent
--   resolve_waiter_call   double-tap" -> {duplicate:true}
--
-- The other three are not, and two of them are money:
--
--   apply_discount   inserts a tab_adjustments row per call (0037:54) and
--                    compute_tab_totals sums those rows into discount_iqd
--                    (0036:59). A replayed discount is applied TWICE.
--   override_price   likewise inserts a tab_adjustments row (0044:143), so a
--                    replay double-counts the override against the tab.
--   record_waste     consume_fefo writes to the append-only stock_movements
--                    ledger (0018:437). A replay deducts the stock twice and
--                    the ledger has no undo -- corrections are counter-entries.
--
-- WHY A LEDGER RATHER THAN A COLUMN. The obvious fix is an idempotency_key
-- column with a unique index, as tabs/orders/payments/tickets have. It does
-- not work for record_waste: consume_fefo walks batches in FEFO order and can
-- write SEVERAL stock_movements rows for one call, and one key cannot be
-- unique across all of them. app.rpc_replays is one claim row per call, which
-- covers the multi-row case and the single-row cases identically.
--
-- CLAIM THEN APPLY. The claim is inserted BEFORE the mutation and inside the
-- same transaction, so it commits with the work or rolls back with it -- there
-- is no window where the money moved and the claim did not. That is precisely
-- the property replay/index.ts cannot have across its two statements, and it
-- is why the fix belongs here rather than in the edge function.
-- ===========================================================================

create table if not exists app.rpc_replays (
  idempotency_key text primary key,
  fn              text        not null,
  caller          uuid        not null,
  result          jsonb,
  at              timestamptz not null default now()
);

comment on table app.rpc_replays is
  '0049: one claim row per idempotent RPC call. Written before the mutation, in '
  'the same transaction, so a replay can never re-apply committed work. Keys are '
  'caller-scoped: another principal replaying your key gets IDEMPOTENCY_CONFLICT, '
  'never your result (the 0038 #7 / 0048 H3 rule).';

-- Definer-only, exactly as app.secrets (0014:357): RLS on, no policy, no grant.
alter table app.rpc_replays enable row level security;
revoke all on table app.rpc_replays from anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.claim_replay — INTERNAL. Returns NULL when the caller now owns a fresh
-- claim and must do the work; returns the stored result (plus duplicate:true)
-- when this is a replay. Raises IDEMPOTENCY_CONFLICT when the key belongs to
-- someone else, or to a different RPC.
-- ---------------------------------------------------------------------------
create or replace function app.claim_replay(p_key text, p_fn text)
returns jsonb
language plpgsql security definer set search_path = public as $claim$
declare
  v app.rpc_replays%rowtype;
begin
  if p_key is null then
    return null;                              -- unkeyed call: nothing to claim
  end if;

  begin
    insert into app.rpc_replays (idempotency_key, fn, caller)
    values (p_key, p_fn, auth.uid());
    return null;                              -- fresh claim: caller does the work
  exception when unique_violation then
    null;                                     -- fall through to the replay path
  end;

  select * into v from app.rpc_replays where idempotency_key = p_key;
  if v.caller is distinct from auth.uid() or v.fn is distinct from p_fn then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
      hint = 'that key belongs to another operation';
  end if;
  return coalesce(v.result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
end $claim$;

revoke all on function app.claim_replay(text, text) from public, anon, authenticated;

-- app.finish_replay — INTERNAL. Records what the fresh call returned so the
-- next replay can echo it verbatim.
create or replace function app.finish_replay(p_key text, p_result jsonb)
returns void
language sql security definer set search_path = public as $finish$
  update app.rpc_replays set result = p_result where idempotency_key = p_key;
$finish$;

revoke all on function app.finish_replay(text, jsonb) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- apply_discount — the 0037 body VERBATIM plus the claim. Adding a parameter
-- defines a new signature, so the old one is dropped and the grants re-issued
-- (a drop discards them); same procedure as 0027:151.
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text);

create function app.apply_discount(
  p_tab_id        uuid,
  p_kind          adjustment_kind,
  p_value         int,
  p_pin           text,
  p_reason_code   text,
  p_order_item_id uuid default null,
  p_device_id     text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $disc_0049$
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

  v_auth := app.verify_manager_pin(p_pin, p_device_id);   -- raises PIN_LOCKED itself
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

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
end $disc_0049$;

revoke all on function app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text, text)
  from public, anon;
grant execute on function app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text, text)
  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- override_price — the 0044 body VERBATIM plus the claim.
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists app.override_price(uuid, bigint, text, text, text);

create function app.override_price(
  p_order_item_id uuid,
  p_new_unit_price_iqd bigint,
  p_pin text,
  p_reason_code text,
  p_device_id text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $override_0049$
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

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

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
end $override_0049$;

revoke all on function app.override_price(uuid, bigint, text, text, text, text) from public, anon;
grant execute on function app.override_price(uuid, bigint, text, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- record_waste — the 0018 body VERBATIM plus the claim.
--
-- This is the one that motivated the ledger: consume_fefo walks batches in
-- FEFO order and can write SEVERAL stock_movements rows for a single call, so
-- there is no single row to hang a unique key on. It returns void, so a replay
-- simply returns having done nothing -- which is the correct answer.
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists app.record_waste(uuid, numeric, movement_type, text, text);

create function app.record_waste(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_movement_type movement_type default 'waste_spill',
  p_reason_code   text default null,
  p_device_id     text default null,
  p_idempotency_key text default null
) returns void
language plpgsql security definer set search_path = public as $waste_0049$
declare
  v_replay jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_movement_type not in ('waste_spill','waste_spoilage') then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001',
      hint = 'record_waste accepts waste_spill or waste_spoilage';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- 0049: the stock ledger is append-only, so a double deduction has no undo;
  -- corrections are counter-entries. Claim before consuming anything.
  v_replay := app.claim_replay(p_idempotency_key, 'record_waste');
  if v_replay is not null then
    return;                                   -- already applied
  end if;

  perform app.consume_fefo(p_ingredient_id, p_qty, p_movement_type,
                           null, null, auth.uid(), p_device_id, p_reason_code);

  perform app.write_audit('stock.record_waste', 'ingredients', p_ingredient_id::text,
                          null, jsonb_build_object('qty', p_qty, 'movement_type', p_movement_type),
                          p_reason_code, null, p_device_id);

  perform app.finish_replay(p_idempotency_key, jsonb_build_object('applied', true));
end $waste_0049$;

revoke all on function app.record_waste(uuid, numeric, movement_type, text, text, text) from public, anon;
grant execute on function app.record_waste(uuid, numeric, movement_type, text, text, text) to authenticated;
