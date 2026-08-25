-- ===========================================================================
-- 0037 — adjustment guards + attribution (money)
--
--   #4  apply_discount and override_price could push a tab's total BELOW what
--       had already been paid. Pay 10,000 of a 20,000 tab (status flips to
--       awaiting_payment), then discount 15,000: total becomes 5,000, settle
--       computes due = 5,000 - 10,000 = -5,000 and raises ALREADY_PAID forever.
--       The tab is stranded in awaiting_payment and close_day refuses to close
--       the day (DAY_OPEN_TABS). void_after_send got exactly this guard in
--       0026 (VOID_REQUIRES_REFUND); the two adjustment paths never did.
--
--   #15 verify_manager_pin selected the PIN holder with `limit 1` and no
--       ORDER BY. With 4-digit PINs a collision between two managers is
--       likely, and the row returned was whatever the plan happened to emit —
--       so authorized_by on the adjustment and the audit row could name the
--       wrong manager, non-deterministically. ORDER BY id makes attribution
--       stable and a collision now leaves a trail. (Stable is not the same as
--       correct: the real fix is PIN uniqueness, tracked separately.)
--
--   #16 ticket_transition measured actual_prep_seconds from tickets.created_at
--       — the moment the order was enqueued, not the moment the kitchen picked
--       it up. Every queue-wait minute was reported as prep time, inflating
--       the only prep metric the operator has.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app.tab_net_paid — INTERNAL: what this tab has actually taken, net of
-- refunds. Extracted from the copy in void_order_item_internal (0032) and
-- settle_tab (0026) so the three guards that need it cannot drift apart.
-- ---------------------------------------------------------------------------
create or replace function app.tab_net_paid(p_tab_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(p.amount_iqd) from payments p
                    where p.tab_id = p_tab_id), 0)
       - coalesce((select sum(r.amount_iqd) from refunds r
                     join payments p2 on p2.id = r.payment_id
                    where p2.tab_id = p_tab_id), 0)
$$;

revoke all on function app.tab_net_paid(uuid) from public, anon, authenticated;

comment on function app.tab_net_paid(uuid) is
  '0037: payments minus refunds for a tab. Internal — the shared basis for the VOID_/DISCOUNT_/OVERRIDE_REQUIRES_REFUND guards.';

-- ---------------------------------------------------------------------------
-- app.apply_discount — 0015 body + the below-net-paid guard (#4).
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
language plpgsql security definer set search_path = public as $disc_0037$
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

  return jsonb_build_object('adjustment_id', v_adj.id, 'amount_iqd', v_amount);
end $disc_0037$;

-- ---------------------------------------------------------------------------
-- app.override_price — 0015 body + the below-net-paid guard (#4).
-- ---------------------------------------------------------------------------
create or replace function app.override_price(
  p_order_item_id      uuid,
  p_new_unit_price_iqd bigint,
  p_pin                text,
  p_reason_code        text,
  p_device_id          text default null
) returns jsonb
language plpgsql security definer set search_path = public as $ovr_0037$
declare
  v_auth      uuid;
  v_oi        order_items%rowtype;
  v_tab       tabs%rowtype;
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

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  select oi.* into v_oi from order_items oi where oi.id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;

  select t.* into v_tab
    from tabs t join orders o on o.tab_id = t.id
   where o.id = v_oi.order_id
   for update of t;
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

  -- OVERRIDE-AFTER-PAYMENT GUARD (0037): only a downward override can trip
  -- this, but the check is cheap enough to run unconditionally.
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
end $ovr_0037$;

-- ---------------------------------------------------------------------------
-- app.verify_manager_pin — 0026 body + deterministic attribution (#15).
-- The NULL-on-invalid contract and the attempt-row insert are unchanged; see
-- the 0026 comment for why an invalid PIN must not raise.
-- ---------------------------------------------------------------------------
create or replace function app.verify_manager_pin(p_pin text, p_device_id text default null)
returns uuid
language plpgsql security definer set search_path = public as $pin_0037$
declare
  v_caller  text := coalesce(auth.uid()::text, 'anon');
  v_key     text;
  v_fails   int;
  v_id      uuid;
  v_matches int;
begin
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
    raise exception 'PIN_LOCKED' using errcode = 'P0001';
  end if;

  select count(*) into v_matches
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash);

  select id into v_id
    from staff
   where role in ('manager','owner') and is_active
     and pin_hash is not null
     and pin_hash = extensions.crypt(p_pin, pin_hash)
   order by id                      -- 0037: was unordered; attribution drifted
   limit 1;

  insert into app.pin_attempts (device_id, success) values (v_key, v_id is not null);

  -- A collision means authorized_by may name the wrong manager. Ordering makes
  -- that stable and visible; it does not make it right. Surfacing it here is
  -- what lets an owner find and fix the duplicate PIN.
  if v_matches > 1 then
    raise warning 'PIN collision: % active managers share this PIN', v_matches;
    perform app.write_audit('staff.pin_collision', 'staff', v_id::text, null,
                            jsonb_build_object('matches', v_matches), null, null, p_device_id);
  end if;

  -- Returns NULL on an invalid PIN instead of raising: a raise would roll back
  -- the attempt row above (PostgREST wraps each RPC in one transaction) and the
  -- 5-failure lockout could never engage. Callers treat NULL as PIN_INVALID;
  -- composite sensitive RPCs re-raise it themselves. Found by the RLS matrix
  -- suite against staging (lockout test).
  return v_id;
end $pin_0037$;

-- ---------------------------------------------------------------------------
-- app.ticket_transition — 0032 body, prep measured from started_at (#16).
-- ---------------------------------------------------------------------------
create or replace function app.ticket_transition(
  p_ticket_id   uuid,
  p_status      ticket_status,
  p_device_id   text,
  p_actor_label text default null
) returns jsonb
language plpgsql security definer set search_path = public as $tkt_0037$
declare
  v    tickets%rowtype;
  v_ok boolean;
begin
  select * into v from tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'TICKET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v.status = p_status then                  -- idempotent replay of a bump
    return jsonb_build_object('duplicate', true, 'ticket_id', v.id, 'status', v.status);
  end if;

  v_ok := (p_status = 'preparing' and v.status = 'queued')
       or (p_status = 'ready'     and v.status in ('queued','preparing'))
       or (p_status = 'completed' and v.status = 'ready');
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  update tickets
     set status       = p_status,
         started_at   = case when p_status = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at     = case when p_status = 'ready'     then coalesce(ready_at, now())   else ready_at end,
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
         -- 0037: prep time runs from the kitchen pickup, not the enqueue.
         -- started_at in a SET list reads the PRE-update value, which is what
         -- we want. A ticket bumped queued -> ready -> completed never had a
         -- pickup, so it falls back to created_at exactly as before.
         actual_prep_seconds = case when p_status = 'completed'
                                    then extract(epoch from now() - coalesce(started_at, created_at))::int
                                    else actual_prep_seconds end,
         device_id    = coalesce(p_device_id, device_id),
         last_actor_label = coalesce(p_actor_label, last_actor_label)
   where id = p_ticket_id
   returning * into v;

  -- Mirror onto the order (guest status page reads orders.status).
  update orders
     set status = case p_status
                    when 'preparing' then 'preparing'::order_status
                    when 'ready'     then 'ready'::order_status
                    when 'completed' then 'served'::order_status
                  end
   where id = v.order_id and status <> 'voided';

  if p_status = 'ready' then
    update order_items set ready_at = now()
     where order_id = v.order_id and not voided and ready_at is null;
  end if;

  return jsonb_build_object('duplicate', false, 'ticket_id', v.id, 'status', v.status,
    'actual_prep_seconds', v.actual_prep_seconds);
end $tkt_0037$;
