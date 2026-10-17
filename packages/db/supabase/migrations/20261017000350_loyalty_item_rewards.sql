-- 0350 loyalty_item_rewards — an item reward is the item, not its money
-- (Majed 2026-10-17: "not evaluated as money but as specific rewards for
-- specific points").
--
-- Until now a reward of kind 'item' (loyalty_rewards.menu_variant_id) was a
-- whole-tab discount worth the variant's price: nothing tied it to the item,
-- so "free coffee" could take a coffee's price off a sandwich. Now:
--
--   1. app.loyalty_redeem, for an item reward, frees ONE unit of that exact
--      size (variant) on the tab: a line discount (tab_adjustments.
--      order_item_id = the line) of the line's own unit price
--      (order_items.unit_price_iqd, the price that line was sold at; paid
--      extras, the modifiers, stay paid). The line is the oldest live line of
--      that variant with a unit still free: fewer loyalty rewards on it than
--      its qty, and at least a unit price left after its other line discounts.
--      With no such line, the item is ordered onto the tab first, one unit,
--      through the till's own path (orders source 'till', app.add_order_items,
--      the kitchen ticket, or served on the spot for a shop item), so the
--      barista makes it; ITEM_UNAVAILABLE, a required choice and every other
--      ordering refusal come from that path. Only a role that may add items at
--      a till (cashier, shop_staff, manager, owner) adds one: the court desk
--      gets REWARD_ITEM_NOT_ON_TAB. Adding needs the open day the tab belongs
--      to (NO_OPEN_DAY, DAY_CLOSED), taken before the tab, as till_add_items
--      does. REWARD_EXCEEDS_BILL is now for an iqd_off reward only. The result
--      gains order_item_id and item_added.
--      "Use points" and iqd_off rewards are unchanged (Majed: keep both).
--   2. app.trg_loyalty_redeem_cap: an item reward whose line (or its order)
--      was voided before the settle used nothing, so all its points come back
--      at the settle, the way a reward the cap swallows comes back.
--
-- app.loyalty_unredeem (0305) is unchanged: undo takes the reward off the
-- line and gives the points back; an item the reward added stays on the tab
-- at its price, for the cashier to void like any other line.
-- Same signatures and grants. Lock order: day_sessions (an item reward only)
-- -> tabs -> loyalty_attempts_advisory -> orders -> order_items -> tickets ->
-- stock_batches (a shop item) -> loyalty_accounts, as ranked.
--
-- covered by packages/db/tests/loyalty.test.ts ("loyalty item rewards (0350)")

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.loyalty_redeem: an item reward frees the item.
-- ---------------------------------------------------------------------------

-- loyalty_redeem: re-issued from 20261006000308_loyalty_earn_redeem.sql:1203

create or replace function app.loyalty_redeem(
  p_tab_id          uuid,
  p_points          int,
  p_reward_id       uuid,
  p_idempotency_key text,
  p_member_token    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_redeem_0350$
declare
  v_venue     uuid;
  v_s         loyalty_settings%rowtype;
  v_replay    jsonb;
  v_tab       tabs%rowtype;
  v_customer  uuid;
  v_balance   bigint;
  v_reward    loyalty_rewards%rowtype;
  v_totals    record;
  v_room      bigint;
  v_points    int;
  v_amount    bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
  v_result    jsonb;
  v_auth      uuid;   -- 0308 (c2)
  v_how       text;   -- 0308
  v_member    uuid;   -- 0308
  v_value     bigint; -- 0308 (c13)
  v_code      text;   -- 0308 (c3)
  v_msg       text;   -- 0308
  v_detail    text;   -- 0308
  v_day       uuid;                 -- 0350
  v_line      order_items%rowtype;  -- 0350
  v_order     orders%rowtype;       -- 0350
  v_oi        record;               -- 0350
  v_added     boolean := false;     -- 0350
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if (p_points is null) = (p_reward_id is null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'exactly one of p_points and p_reward_id';
  end if;
  if p_points is not null and p_points < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_points';
  end if;
  select * into v_s from loyalty_settings where id;
  if not coalesce(v_s.enabled, false) then
    raise exception 'LOYALTY_OFF' using errcode = 'P0001';
  end if;

  -- 0049: claim after the guards and before any lock or write.
  v_replay := app.claim_replay(p_idempotency_key, 'loyalty_redeem');
  if v_replay is not null then
    return v_replay;
  end if;

  -- 0350: an item reward may order its item onto the tab, so the open day is
  -- locked before the tab (lock order), as till_add_items locks it.
  if p_reward_id is not null
     and exists (select 1 from loyalty_rewards r where r.id = p_reward_id and r.kind = 'item') then
    v_day := app.current_open_day_locked();
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  v_customer := app.tab_customer(p_tab_id);
  if v_customer is null then
    raise exception 'NO_CUSTOMER' using errcode = 'P0001';
  end if;

  -- 0308 (c2): the member is here (their token, spent once, names the tab's
  -- customer), or a manager vouches with a PIN grant that is not the
  -- customer's own. A member's token never lets staff spend their own points.
  if nullif(btrim(coalesce(p_member_token, '')), '') is not null then
    -- 0308 (c3): the token path is throttled like identify (ten misses in
    -- ten minutes lock the caller). A miss is answered as {error, detail},
    -- not raised, so its attempt row commits; the idempotency claim goes
    -- with it, so the same key may be retried with a manager PIN.
    v_code := app.loyalty_token_code(p_member_token);
    perform app.loyalty_throttle_check(auth.uid(), v_code, 10);   -- MEMBER_CODE_LOCKED
    begin
      v_member := app.loyalty_token_consume(p_member_token);
    exception when raise_exception then
      get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
      if v_msg not in ('MEMBER_CODE_INVALID', 'MEMBER_CODE_EXPIRED') then
        raise;
      end if;
      -- An expired token is a real one shown late (a stale scan at the till, an
      -- old screenshot), not a guess: it is answered but never counted.
      if v_msg <> 'MEMBER_CODE_EXPIRED' then
        perform app.loyalty_attempt_record(auth.uid(), v_code, false);
      end if;
      delete from app.rpc_replays where idempotency_key = p_idempotency_key and fn = 'loyalty_redeem';
      return jsonb_build_object('error', v_msg, 'detail', nullif(v_detail, ''));
    end;
    perform app.loyalty_attempt_record(auth.uid(), v_code, true);
    if v_member is distinct from v_customer then
      raise exception 'MEMBER_CODE_MISMATCH' using errcode = 'P0001';
    end if;
    if v_customer = auth.uid() then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
    end if;
    v_auth := auth.uid();
    v_how := 'qr';
  else
    v_auth := app.consume_pin_grant(null);   -- PIN_GRANT_REQUIRED
    if v_auth = v_customer then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
    end if;
    v_how := 'pin';
  end if;

  -- 0350: the reward, and for an item reward the line it frees: the oldest
  -- live line of that exact size with a unit still free (fewer rewards on it
  -- than its qty, and a unit price left after its other line discounts). With
  -- none, one unit is ordered onto the tab through the till's own path. Read
  -- before the account, which is locked last.
  if p_reward_id is not null then
    select * into v_reward from loyalty_rewards r
     where r.id = p_reward_id and r.active and (r.venue_id is null or r.venue_id = v_tab.venue_id);
    if not found then
      raise exception 'REWARD_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_reward.kind = 'item' then
      select oi.* into v_line
        from order_items oi
        join orders o on o.id = oi.order_id
       where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
         and oi.variant_id = v_reward.menu_variant_id
         and (select count(*) from tab_adjustments x
               where x.order_item_id = oi.id and x.reason_code = 'loyalty_reward') < oi.qty
         and oi.line_total_iqd
             - coalesce((select sum(x.amount_iqd) from tab_adjustments x
                          where x.order_item_id = oi.id
                            and x.kind in ('discount_percent', 'discount_amount')), 0)
             >= oi.unit_price_iqd
       order by o.placed_at, oi.line_no
       limit 1;
      if not found then
        if not app.is_staff('cashier', 'manager', 'owner', 'shop_staff') then
          raise exception 'REWARD_ITEM_NOT_ON_TAB' using errcode = 'P0001';
        end if;
        if v_day is null then
          raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
        end if;
        if v_tab.day_session_id is distinct from v_day then
          raise exception 'DAY_CLOSED' using errcode = 'P0001',
            hint = 'this tab belongs to a day that is no longer open';
        end if;
        insert into orders (tab_id, source, placed_by_staff_id)
        values (v_tab.id, 'till', auth.uid())
        returning * into v_order;
        perform app.add_order_items(v_order.id,
          jsonb_build_array(jsonb_build_object('variant_id', v_reward.menu_variant_id, 'qty', 1)));
        -- till_add_items' two endings (0146): a shop item is served on the
        -- spot with its stock taken; anything else goes to the kitchen.
        if app.order_is_shop(v_order.id) then
          for v_oi in select id from order_items where order_id = v_order.id and not voided loop
            perform app.consume_for_order_item(v_oi.id, null);
          end loop;
          update orders set status = 'served' where id = v_order.id;
        else
          insert into tickets (order_id) values (v_order.id);
        end if;
        select * into v_line from order_items where order_id = v_order.id;
        v_added := true;
      end if;
    end if;
  end if;

  -- loyalty_accounts last (lock order): the balance read below holds.
  select a.balance into v_balance from loyalty_accounts a where a.profile_id = v_customer for update;
  v_balance := coalesce(v_balance, 0);

  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_room := least(greatest(coalesce(v_totals.subtotal_iqd, 0) - coalesce(v_totals.discount_iqd, 0), 0),
                  greatest(coalesce(v_totals.total_iqd, 0) - app.tab_net_paid(p_tab_id), 0));

  if p_reward_id is not null then
    -- 0350: the reward was read above, before the account.
    if v_balance < v_reward.cost_points then
      raise exception 'POINTS_INSUFFICIENT' using errcode = 'P0001',
        detail = format('balance %s, cost %s', v_balance, v_reward.cost_points);
    end if;
    v_points := v_reward.cost_points;
    if v_reward.kind = 'item' then
      -- 0350: the item itself: one unit of its line, at the price that line
      -- was sold at. Its extras stay paid.
      v_value := v_line.unit_price_iqd::bigint;
    else
      v_value := v_reward.iqd_off::bigint;
      -- 0308 (c13): a reward is used whole: worth more than what is left to
      -- discount, it would cost its points for less than its value.
      if coalesce(v_value, 0) > v_room then
        raise exception 'REWARD_EXCEEDS_BILL' using errcode = 'P0001',
          detail = format('reward %s, left %s', coalesce(v_value, 0), v_room);
      end if;
    end if;
    v_amount := v_value;
  else
    if p_points < v_s.min_redeem_points then
      raise exception 'POINTS_BELOW_MIN' using errcode = 'P0001',
        detail = v_s.min_redeem_points::text;
    end if;
    if v_balance < p_points then
      raise exception 'POINTS_INSUFFICIENT' using errcode = 'P0001',
        detail = format('balance %s, asked %s', v_balance, p_points);
    end if;
    -- Rounded down to fit: the discount never exceeds what is left (redeemAmount).
    v_points := least(p_points::bigint, v_room / v_s.point_value_iqd)::int;
    v_amount := v_points::bigint * v_s.point_value_iqd;
    -- 0308 (s2): the minimum holds for what is actually used.
    if v_points >= 1 and v_points < v_s.min_redeem_points then
      raise exception 'POINTS_BELOW_MIN' using errcode = 'P0001',
        detail = v_s.min_redeem_points::text,
        hint = format('only %s points fit what is left to discount', v_points);
    end if;
  end if;
  if coalesce(v_amount, 0) < 1 or v_points < 1 then
    raise exception 'NOTHING_OWED' using errcode = 'P0001',
      hint = 'nothing on this bill is left to discount';
  end if;

  -- MATCH_BOOKING_NO_CAFE / LESSON_TAB_NO_GOODS come from the 0262/0281
  -- trigger on tab_adjustments, as for every discount.
  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (p_tab_id, v_line.id, 'discount_amount', v_points, v_amount, auth.uid(), v_auth,   -- 0350: v_line.id
          case when p_reward_id is null then 'loyalty_points' else 'loyalty_reward' end)
  returning * into v_adj;

  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id, note)
  values (v_customer, v_tab.venue_id, -v_points,
          case when p_reward_id is null then 'redeem' else 'reward' end,
          'tab_adjustment', v_adj.id, p_tab_id, auth.uid(),
          case when p_reward_id is not null then left(v_reward.name_en, 200) end);

  -- DISCOUNT-AFTER-PAYMENT GUARD (0037), verbatim shape.
  v_paid := app.tab_net_paid(p_tab_id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(p_tab_id) t;
    if v_new_total < v_paid then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-discount total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before discounting';
    end if;
  end if;

  perform app.write_audit('loyalty.redeem', 'tab_adjustments', v_adj.id::text, null,
                          to_jsonb(v_adj) || jsonb_build_object('customer_id', v_customer,
                                                                'reward_id', p_reward_id,
                                                                'proof', v_how),
                          v_adj.reason_code, v_auth);

  v_result := jsonb_build_object(
    'adjustment_id', v_adj.id,
    'points',        v_points,
    'amount_iqd',    v_amount,
    'balance',       (select a.balance from loyalty_accounts a where a.profile_id = v_customer),
    'order_item_id', v_line.id,   -- 0350
    'item_added',    v_added);    -- 0350
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $loyalty_redeem_0350$;

comment on function app.loyalty_redeem(uuid, int, uuid, text, text) is
  'Loyalty (M3, contracts §1.3, L-5; 0308, 0350). Cashier, shop_staff, court_desk, manager, owner at the tab''s branch, the tab''s kind for the role. Exactly one of p_points and p_reward_id (INVALID_ARGUMENT). LOYALTY_OFF, then claim_replay, then the tab (TAB_NOT_FOUND, TAB_MERGED, TAB_NOT_OPEN: open only) and its customer (NO_CUSTOMER). 0308 (c2, c3): the proof: p_member_token, spent once, must name the customer (MEMBER_CODE_MISMATCH; FORBIDDEN self_dealing when the customer is the caller); a token that does not pass (wrong, expired, replayed) is answered {error: MEMBER_CODE_INVALID | MEMBER_CODE_EXPIRED, detail} and counted in loyalty_token_attempts, with the idempotency claim released, and MEMBER_CODE_LOCKED after ten misses by the caller in ten minutes; or without it a manager PIN grant (PIN_GRANT_REQUIRED) whose authorizer is not the customer (FORBIDDEN self_dealing). Then the account, locked last. Points: POINTS_BELOW_MIN (min_redeem_points, checked again after the fit: hint the points that fit), POINTS_INSUFFICIENT, rounded down to fit what is left to discount (the goods not yet discounted, and the unpaid bill), amount = points * point_value_iqd. Reward: active, this branch or every branch (REWARD_NOT_FOUND), POINTS_INSUFFICIENT for cost_points. An iqd_off reward is a tab discount of iqd_off, REWARD_EXCEEDS_BILL when that is more than what is left (0308, c13). 0350: an item reward frees one unit of its exact variant on the tab: a line discount of that line''s unit_price_iqd (modifiers stay paid) on the oldest live line of the variant with a unit free (fewer loyalty_reward rows on it than its qty, and a unit price left after its line discounts); with none, one unit is ordered onto the tab first (orders source till, placed_by the caller, app.add_order_items, a ticket or a served shop order; its refusals pass through) by a cashier, shop_staff, manager or owner (REWARD_ITEM_NOT_ON_TAB for the court desk), on the open day the tab belongs to (NO_OPEN_DAY, DAY_CLOSED; the day is locked before the tab). NOTHING_OWED when nothing is left to discount. Writes a tab_adjustments discount_amount (order_item_id = the freed line for an item reward, else null; value = points, applied_by = the caller, authorized_by = the caller for a token or the PIN''s manager, reason_code loyalty_points | loyalty_reward) and a ledger row (redeem | reward, tab_adjustment, adjustment_id) in one transaction, then the 0037 guard. Returns {adjustment_id, points, amount_iqd, balance, order_item_id (an item reward''s line, else null), item_added}. Audited loyalty.redeem {proof qr | pin}.';

revoke all on function app.loyalty_redeem(uuid, int, uuid, text, text) from public, anon;
grant execute on function app.loyalty_redeem(uuid, int, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.trg_loyalty_redeem_cap: a voided line's reward comes back whole.
-- ---------------------------------------------------------------------------

-- trg_loyalty_redeem_cap: re-issued from 20261006000308_loyalty_earn_redeem.sql:686
create or replace function app.trg_loyalty_redeem_cap() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_redeem_cap_0350$
declare
  v_tab    tabs%rowtype;
  v_sub    bigint;
  v_other  bigint;
  v_room   bigint;
  v_used   bigint;
  v_back   bigint;
  a        record;
begin
  select * into v_tab from tabs where id = new.id;
  if not found or v_tab.status <> 'settled' then
    return null;
  end if;
  if not exists (select 1 from tab_adjustments x where x.tab_id = v_tab.id
                    and x.reason_code in ('loyalty_points', 'loyalty_reward')) then
    return null;
  end if;

  select coalesce(sum(oi.line_total_iqd), 0) into v_sub
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = v_tab.id and o.status <> 'voided' and not oi.voided;
  select coalesce(sum(x.amount_iqd), 0) into v_other
    from tab_adjustments x
   where x.tab_id = v_tab.id
     and x.kind in ('discount_percent', 'discount_amount')
     and x.reason_code is distinct from 'loyalty_points' and x.reason_code is distinct from 'loyalty_reward'
     and (x.order_item_id is null
          or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                      where oi.id = x.order_item_id and o.tab_id = v_tab.id
                        and o.status <> 'voided' and not oi.voided));
  v_room := greatest(v_sub - v_other, 0);

  for a in
    select x.id, x.amount_iqd, l.profile_id, l.venue_id, -l.delta as points,
           -- 0350: an item reward on a line (or order) voided since used nothing.
           (x.order_item_id is null
            or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                        where oi.id = x.order_item_id and o.tab_id = v_tab.id
                          and o.status <> 'voided' and not oi.voided)) as live
      from tab_adjustments x
      join loyalty_ledger l on l.kind in ('redeem', 'reward') and l.source_kind = 'tab_adjustment'
                           and l.source_id = x.id
     where x.tab_id = v_tab.id and x.reason_code in ('loyalty_points', 'loyalty_reward')
     order by x.created_at, x.id
  loop
    v_used := case when a.live then least(a.amount_iqd, v_room) else 0 end;   -- 0350
    v_room := v_room - v_used;
    if a.amount_iqd > v_used and a.amount_iqd > 0 then
      v_back := floor((a.points::numeric * (a.amount_iqd - v_used)) / a.amount_iqd)::bigint;
      if v_back > 0 then
        insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
        values (a.profile_id, a.venue_id, v_back, 'redeem_void', 'tab_adjustment', a.id, v_tab.id, auth.uid())
        on conflict (kind, source_kind, source_id) do nothing;
      end if;
    end if;
  end loop;
  return null;
end $trg_loyalty_redeem_cap_0350$;

comment on function app.trg_loyalty_redeem_cap() is
  'Loyalty (0308, c13; 0350). Deferred AFTER UPDATE OF status on tabs, when the tab becomes settled: the loyalty redemptions on it take what the goods subtotal leaves after the other discounts (lines not voided, every manual and promotion discount first), in the order applied; for each, floor(points * unused / amount) points come back as (redeem_void, tab_adjustment, adjustment_id). 0350: an item reward whose line or order was voided used nothing, so all its points come back. Runs whether loyalty is on or off.';

revoke all on function app.trg_loyalty_redeem_cap() from public, anon, authenticated;
