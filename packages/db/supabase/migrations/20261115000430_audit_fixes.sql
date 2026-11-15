-- ===========================================================================
-- 0430 audit_fixes (ponytail audit 2026-11-15; Majed: fix 4, 7, 11, 19, 24).
--
-- 1. One in-app deal pick, one bill (finding 4). app.loyalty_deal_uses counts
--    settled bills only, so a member with a café bill and a court bill open at
--    once had the picked deal applied to both. The new internal
--    app.loyalty_picked_deal_on(profile, tab) is app.loyalty_picked_deal minus
--    a pick already redeemed on ANOTHER open or awaiting-payment bill of that
--    member; eligible_promotions asks it for the tab it prices, so a re-apply
--    on the bill that holds the deal keeps it. apply_best_promotion locks the
--    candidate promotions FOR UPDATE and reads eligibility again after the
--    lock (0309 c15), so two stations at once still see each other.
--    **0430 holds eligible_promotions** (0410 no longer; one call changed).
--
-- 2. "+964 0770 ..." is the same number as "0770 ..." (finding 7).
--    app.phone_canon stripped ONE of 964 or a trunk 0, so 96407701234567 kept
--    its 0 and the desk found no customer by it and made a second one. It now
--    strips 00, then 964, then a trunk 0; @touch/core phoneCanon and
--    _shared/phone.ts change with it (iraq.fixtures.ts). profiles.phone_key is
--    recomputed with 0307's own two statements (losers first, so
--    profiles_phone_key_live never sees two holders). app.sms_sends.phone_canon
--    keeps what was written; it feeds a 24-hour cap only.
--
-- 3. A court discount and a settle of the same bill no longer pass each other
--    (finding 11). apply_customer_court_discount now locks the booking's live
--    tab before the court (tabs -> court_advisory -> reservations, the
--    documented order). **0430 holds apply_customer_court_discount** (0403 no
--    longer).
--
-- 4. queued_rpc_claim refuses a page the caller is blocked from
--    (AREA_BLOCKED), as app.pre_request does for the direct call (finding 19).
--    **0430 holds queued_rpc_claim** (0398 no longer).
--
-- 5. One push token, one profile (finding 24): trigger
--    profiles_push_token_one_holder clears a just-written token from every
--    other profile; today's duplicates stay with the account that signed in last.
--
-- covered by tests/audit-fixes-0430.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. One pick, one bill
-- ---------------------------------------------------------------------------
create or replace function app.loyalty_picked_deal_on(p_profile uuid, p_tab uuid) returns uuid
language sql stable security definer set search_path = public as $loyalty_picked_deal_on_0430$
  select d.id
    from (select app.loyalty_picked_deal(p_profile) as id) d
   where d.id is not null
     and not exists (
       select 1
         from promotion_redemptions r
         join tabs t on t.id = r.tab_id
        where r.promotion_id = d.id
          and r.customer_id = p_profile
          and r.tab_id is distinct from p_tab
          and t.status in ('open', 'awaiting_payment')
          and t.merged_into_tab_id is null)
$loyalty_picked_deal_on_0430$;

comment on function app.loyalty_picked_deal_on(uuid, uuid) is
  '0430. Internal: app.loyalty_picked_deal(p_profile) for the bill p_tab, or null when that pick is already redeemed on another open or awaiting-payment bill of the member (one pick is one use, even with two bills open at once).';

revoke all on function app.loyalty_picked_deal_on(uuid, uuid) from public, anon, authenticated;

-- eligible_promotions: re-issued from 20261112000410_loyalty_deals_perks.sql:357.
create or replace function app.eligible_promotions(p_tab_id uuid, p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $eligible_promotions_0430$
declare
  v_tab      tabs%rowtype;
  v_court_id uuid;
  v_customer uuid;
  v_totals   record;
  v_gross    bigint;
  v_local    timestamp;
  v_dow      int;
  v_time     time;
  v_code     text := nullif(upper(btrim(p_code)), '');
  p          promotions%rowtype;
  v_base     bigint;
  v_amount   bigint;
  v_limit    bigint;
  v_out      jsonb := '[]'::jsonb;
  v_sorted   jsonb;
  v_room     bigint;    -- 0309 (c14)
  v_pick     uuid;      -- 0410
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0382 (F-28): only staff of the tab's own branch read its bill.
  if not app.is_staff_at(v_tab.venue_id, 'cashier','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  if v_code is not null and not exists (select 1 from promotions x where x.public_code = v_code) then
    raise exception 'CODE_INVALID' using errcode = 'P0001', detail = v_code;
  end if;

  if v_tab.reservation_id is not null then
    select r.court_id into v_court_id
      from reservations r where r.id = v_tab.reservation_id;
  end if;

  -- 0306 (loyalty): the customer is app.tab_customer (the attached guest, the
  -- booking's guest, or a linked café session's profile).
  v_customer := app.tab_customer(p_tab_id);

  -- 0410: the listed deal this member picked in the app, while the pick is live.
  -- 0430: and not already on another live bill of theirs (one pick, one use).
  if v_customer is not null then
    v_pick := app.loyalty_picked_deal_on(v_customer, p_tab_id);
  end if;

  -- Gross = goods subtotal + court fee (what the guest is spending before any
  -- discount). The discount BASE is narrower (goods only; see promotion_base_iqd).
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_gross := coalesce(v_totals.subtotal_iqd, 0) + coalesce(v_totals.court_iqd, 0);

  -- 0309 (c14): what the other discounts leave of the goods.
  v_room := app.promotion_room_iqd(p_tab_id);

  v_local := now() at time zone coalesce((select vs.timezone from venue_settings vs
                                            where vs.venue_id = v_tab.venue_id), 'Asia/Baghdad');
  v_dow   := extract(dow from v_local)::int;
  v_time  := v_local::time;

  for p in
    select pr.*
      from promotions pr
     where pr.enabled
       and (pr.venue_id is null or pr.venue_id = v_tab.venue_id)   -- 0212 (MV2)
       and (pr.starts_at is null or pr.starts_at <= now())
       and (pr.ends_at   is null or pr.ends_at   >  now())
       and (coalesce(array_length(pr.weekdays, 1), 0) = 0 or v_dow = any(pr.weekdays))
       and (pr.hour_from is null
            or (pr.hour_from < pr.hour_to and v_time >= pr.hour_from and v_time < pr.hour_to)
            or (pr.hour_from > pr.hour_to and (v_time >= pr.hour_from or v_time < pr.hour_to)))
       -- 0410: a listed deal the member picked needs no code.
       and (pr.auto or (v_code is not null and pr.public_code = v_code)
            or (pr.in_app and v_pick is not null and pr.id = v_pick))
       and (jsonb_typeof(pr.scope->'courtIds') is distinct from 'array'
            or jsonb_array_length(pr.scope->'courtIds') = 0
            or (v_court_id is not null and (pr.scope->'courtIds') ? v_court_id::text))
     order by pr.created_at, pr.id
  loop
    -- Redemptions on OTHER tabs: this tab's own current promotion is about to
    -- be replaced by any apply, so it must never block a re-apply.
    if not p.auto and p.code_single_use and exists (
         select 1 from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) then
      continue;
    end if;

    v_limit := (p.limits->>'total')::bigint;
    if v_limit is not null and (
         select count(*) from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) >= v_limit then
      continue;
    end if;

    v_limit := (p.limits->>'perCustomer')::bigint;
    if v_limit is not null then
      -- A per-customer cap needs a customer: a tab with no identified guest
      -- cannot be counted, so it is not eligible (the strict reading).
      if v_customer is null then
        continue;
      end if;
      if (select count(*) from promotion_redemptions r
           where r.promotion_id = p.id and r.customer_id = v_customer and r.tab_id <> p_tab_id)
         >= v_limit then
        continue;
      end if;
    end if;

    -- 0309 (c6/c16): a tier promotion (limits.tierMin, a tier id) needs
    -- loyalty on, a customer, and the customer's tier at least that one by
    -- points (app.promotion_tier_ok).
    if not app.promotion_tier_ok(p.limits, v_customer) then
      continue;
    end if;

    v_limit := (p.limits->>'minSpendIqd')::bigint;
    if v_limit is not null and v_gross < v_limit then
      continue;
    end if;

    v_base   := app.promotion_base_iqd(p_tab_id, p.scope);
    v_amount := least(app.promotion_amount_iqd(v_base, p.type, p.value), v_room);   -- 0309 (c14)
    if v_amount < 1 then
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'promotionId', p.id,
      'name_en',     p.name_en,
      'name_ar',     p.name_ar,
      'type',        p.type,
      'value',       p.value,
      'amountIqd',   v_amount,
      'picked',      v_pick is not null and p.id = v_pick);   -- 0410
  end loop;

  -- 0410: the deal the member picked first, then the largest.
  select coalesce(jsonb_agg(t.e order by (t.e->>'picked')::boolean desc,
                                         (t.e->>'amountIqd')::bigint desc, t.ord), '[]'::jsonb)
    into v_sorted
    from jsonb_array_elements(v_out) with ordinality as t(e, ord);
  return v_sorted;
end $eligible_promotions_0430$;

comment on function app.eligible_promotions(uuid, text) is
  '0067, 0212, 0306, 0309, 0382, 0410, 0430. Cashier, manager, owner at the tab''s branch (VENUE_MISMATCH): the promotions that could apply to the tab right now, [{promotionId, name_en, name_ar, type, value, amountIqd, picked}]: enabled, of this branch or every branch, inside its dates, days and hours, automatic or named by p_code (CODE_INVALID for an unknown code) or, since 0410, a listed deal (in_app) the tab''s customer picked in the app (app.loyalty_picked_deal_on: live, and on no other open bill of theirs; no code needed), on its courts, within its total and per-customer limits (redemptions on other tabs), its tier (app.promotion_tier_ok) and its minimum spend; amountIqd is the discount on its base, at most what the other discounts leave (app.promotion_room_iqd), and a candidate below 1 is dropped. The picked deal sorts first, then the largest amount: app.apply_best_promotion takes the first.';

revoke all on function app.eligible_promotions(uuid, text) from public, anon;
grant execute on function app.eligible_promotions(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. phone_canon: 00, then 964, then a trunk 0 (re-issued from 0189:158)
-- ---------------------------------------------------------------------------
create or replace function app.phone_canon(p_phone text) returns text
language plpgsql immutable as $phone_canon_0430$
begin
  return nullif(
           regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(app.phone_digits(p_phone), ''), '^00', ''),
               '^964', ''),
             '^0', ''),
           '');
end
$phone_canon_0430$;

revoke all on function app.phone_canon(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recompute every key (0307 section 3, verbatim) (phone_key alone fires no profiles trigger). Winner
--    per key: the verified owner, then the oldest. Losers first, so the
--    unique index never sees two holders.
-- ---------------------------------------------------------------------------
with w as materialized (
  select q.id, x.k,
         row_number() over (partition by x.k
                            order by app.phone_verified_owner(q.id, x.k) desc, q.created_at, q.id) as rn
    from profiles q
    cross join lateral (select app.profile_phone_key(q.id, q.phone) as k) x
   where q.deleted_at is null and x.k is not null
)
update profiles p
   set phone_key = null
 where p.phone_key is not null
   and not exists (select 1 from w where w.id = p.id and w.rn = 1 and w.k = p.phone_key);

with w as materialized (
  select q.id, x.k,
         row_number() over (partition by x.k
                            order by app.phone_verified_owner(q.id, x.k) desc, q.created_at, q.id) as rn
    from profiles q
    cross join lateral (select app.profile_phone_key(q.id, q.phone) as k) x
   where q.deleted_at is null and x.k is not null
)
update profiles p
   set phone_key = w.k
  from w
 where w.id = p.id and w.rn = 1
   and p.phone_key is distinct from w.k;

-- ---------------------------------------------------------------------------
-- 3. apply_customer_court_discount: re-issued from
--    20261105000403_loyalty_rewards_only.sql:238
-- ---------------------------------------------------------------------------
create or replace function app.apply_customer_court_discount(
  p_reservation_id uuid,
  p_kind      text default null,
  p_value     int  default null,
  p_reason    text default null,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_customer_court_discount_0430$
declare
  v_res      reservations%rowtype;
  v_kind     text := nullif(btrim(coalesce(p_kind, '')), '');
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_customer uuid;
  v_cd       customer_discounts%rowtype;
  v_old      reservation_court_discounts%rowtype;
  v_has_old  boolean;
  v_waived   boolean;
  v_row      reservation_court_discounts%rowtype;
  v_t_kind   text;
  v_t_value  int;
  v_t_reason text;
  v_t_stand  boolean;
  v_t_auth   uuid;
  v_owed     bigint;
  v_amount   bigint;
begin
  if not app.is_staff('court_desk', 'cashier', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_kind is not null and v_kind not in ('standing', 'none', 'percent', 'amount') then
    raise exception 'INVALID_KIND' using errcode = 'P0001', detail = v_kind,
      hint = 'NULL (refresh) | standing | none | percent | amount';
  end if;
  if v_kind in ('percent', 'amount') then
    if (v_kind = 'percent' and (p_value is null or p_value not between 1 and 10000))
       or (v_kind = 'amount' and (p_value is null or p_value not between 1 and 100000000)) then
      raise exception 'INVALID_VALUE' using errcode = 'P0001',
        hint = 'a percent is basis points 1..10000; an amount is IQD 1..100000000';
    end if;
    if v_reason is null then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
    if v_reason not in ('sponsored', 'family', 'coach', 'staff', 'other') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_reason;
    end if;
  end if;

  select * into v_res from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_res.venue_id, 'court_desk', 'cashier', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_res.venue_id::text, true);

  -- 0430: the booking's live bill first (tabs before court_advisory, the
  -- documented order). settle_tab locks only the tab, so without this a
  -- discount and a settle of the same bill passed each other: the bill
  -- settled at the full fee and the discount row was still written. Now the
  -- discount waits for the settle and then sees the fee paid.
  perform 1 from tabs t
   where t.reservation_id = p_reservation_id
     and t.status in ('open', 'awaiting_payment')
     and t.merged_into_tab_id is null
     for update;

  -- The court, then the booking row (0042's order): two discount writes on
  -- one booking queue here, and nothing else is locked after it.
  perform app.lock_court(v_res.court_id);
  select * into v_res from reservations where id = p_reservation_id for update;

  if v_res.kind <> 'booking' or v_res.status not in ('confirmed', 'arrived', 'completed')
     or v_res.price_iqd is null then
    if v_kind is null then
      return jsonb_build_object('applied', false, 'unchanged', true, 'refused', 'COURT_DISCOUNT_NOT_ALLOWED');
    end if;
    raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'not_a_live_booking';
  end if;
  if exists (select 1 from matches m where m.reservation_id = v_res.id) then
    if v_kind is null then
      return jsonb_build_object('applied', false, 'unchanged', true, 'refused', 'COURT_DISCOUNT_NOT_ALLOWED');
    end if;
    raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'match';
  end if;

  v_customer := app.booking_discount_customer(v_res.id);
  if v_kind in ('percent', 'amount') then
    if v_customer is null then
      raise exception 'NO_CUSTOMER' using errcode = 'P0001';
    end if;
    if v_customer = auth.uid() then
      raise exception 'SELF_DISCOUNT' using errcode = 'P0001';
    end if;
  end if;

  select * into v_old from reservation_court_discounts where reservation_id = v_res.id;
  v_has_old := found;

  v_waived := exists (select 1 from customer_discount_waivers w where w.reservation_id = v_res.id);

  -- The target.
  if v_kind is null or v_kind = 'standing' then
    if v_kind is null and v_has_old and not v_old.standing then
      v_t_kind := v_old.kind; v_t_value := v_old.value; v_t_reason := v_old.reason;
      v_t_stand := false; v_t_auth := v_old.authorized_by;
    elsif v_customer is not null and (v_kind = 'standing' or not v_waived) then
      select * into v_cd from customer_discounts d where d.customer_id = v_customer;
      if found and v_cd.court_kind is not null then
        v_t_kind := v_cd.court_kind; v_t_value := v_cd.court_value; v_t_reason := v_cd.reason;
        v_t_stand := true; v_t_auth := v_cd.set_by;
      end if;
    end if;
  elsif v_kind in ('percent', 'amount') then
    v_t_kind := v_kind; v_t_value := p_value; v_t_reason := v_reason;
    v_t_stand := false; v_t_auth := auth.uid();
  end if;

  -- Anything but a refresh decides this booking afresh: the waiver goes, and
  -- 'none' writes a new one.
  if v_kind is not null then
    delete from customer_discount_waivers where reservation_id = v_res.id;
    if v_kind = 'none' then
      insert into customer_discount_waivers (reservation_id, waived_by) values (v_res.id, auth.uid());
    end if;
  end if;

  if v_has_old and v_old.kind is not distinct from v_t_kind and v_old.value is not distinct from v_t_value
     and v_old.standing is not distinct from v_t_stand and v_old.reason is not distinct from v_t_reason then
    return jsonb_build_object('applied', true, 'unchanged', true, 'kind', v_old.kind, 'value', v_old.value,
      'amount_iqd', app.court_fee_discount(v_res.id), 'standing', v_old.standing,
      'customer_id', v_customer, 'remaining_iqd', app.court_fee_remaining(v_res.id, null));
  end if;
  if not v_has_old and v_t_kind is null then
    return jsonb_build_object('applied', false, 'unchanged', true, 'kind', null, 'value', null,
      'amount_iqd', 0, 'standing', null, 'customer_id', v_customer,
      'remaining_iqd', app.court_fee_remaining(v_res.id, null));
  end if;

  -- A discount a settled bill already counted stays as it is.
  if v_has_old and app.court_discount_closed(v_res.id) then
    if v_kind is null then
      return jsonb_build_object('applied', true, 'unchanged', true, 'kind', v_old.kind, 'value', v_old.value,
        'amount_iqd', app.court_fee_discount(v_res.id), 'standing', v_old.standing,
        'customer_id', v_customer, 'remaining_iqd', app.court_fee_remaining(v_res.id, null),
        'closed', true);
    end if;
    raise exception 'COURT_BILL_CLOSED' using errcode = 'P0001';
  end if;

  -- What the booking owes before any discount: price less what was paid.
  v_owed := greatest(v_res.price_iqd - app.court_fee_paid(v_res.id, null)
                                     - app.court_fee_written_off(v_res.id, null)
                                     - app.court_reward_iqd(v_res.id), 0);   -- 0403: a free court hour
  if v_t_kind is not null then
    v_amount := case when v_t_kind = 'percent' then round((v_res.price_iqd::numeric * v_t_value) / 10000.0)::bigint
                     else least(v_t_value::bigint, v_res.price_iqd) end;
    if v_owed = 0 then
      if v_kind is null then
        return jsonb_build_object('applied', v_has_old, 'unchanged', true, 'refused', 'COURT_FEE_PAID');
      end if;
      raise exception 'COURT_FEE_PAID' using errcode = 'P0001';
    end if;
    if v_amount > v_owed then
      if v_kind is null then
        return jsonb_build_object('applied', v_has_old, 'unchanged', true, 'refused', 'DISCOUNT_REQUIRES_REFUND');
      end if;
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('owed %s, discount %s', v_owed, v_amount),
        hint = 'more of the court fee was paid than the discount leaves owed';
    end if;
  end if;

  if v_t_kind is null then
    delete from reservation_court_discounts where reservation_id = v_res.id;
    perform app.write_audit('court_discount.remove', 'reservation_court_discounts', v_res.id::text,
                            to_jsonb(v_old), null, coalesce(v_reason, v_old.reason), null, p_device_id);
    return jsonb_build_object('applied', false, 'unchanged', false, 'kind', null, 'value', null,
      'amount_iqd', 0, 'standing', null, 'customer_id', v_customer,
      'remaining_iqd', app.court_fee_remaining(v_res.id, null));
  end if;

  -- A subtransaction, as in apply_customer_discount: a live bill of the
  -- booking that has taken more than its new total refuses the discount
  -- (the 0037 guard), as data for a refresh.
  begin
    delete from reservation_court_discounts where reservation_id = v_res.id;
    insert into reservation_court_discounts (reservation_id, customer_id, kind, value, reason, standing,
                                             applied_by, authorized_by)
    values (v_res.id, v_customer, v_t_kind, v_t_value, v_t_reason, v_t_stand, auth.uid(), v_t_auth)
    returning * into v_row;

    if exists (select 1
                 from tabs t
                where t.reservation_id = v_res.id
                  and t.status in ('open', 'awaiting_payment')
                  and t.merged_into_tab_id is null
                  and app.tab_net_paid(t.id) > (select x.total_iqd from app.compute_tab_totals(t.id) x)) then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        hint = 'the open bill of this booking has taken more than it would be after the discount';
    end if;
  exception when sqlstate 'P0001' then
    if v_kind is null and sqlerrm = 'DISCOUNT_REQUIRES_REFUND' then
      return jsonb_build_object('applied', v_has_old, 'unchanged', true, 'refused', 'DISCOUNT_REQUIRES_REFUND');
    end if;
    raise;
  end;

  perform app.write_audit('court_discount.apply', 'reservation_court_discounts', v_res.id::text,
                          case when v_has_old then to_jsonb(v_old) end,
                          to_jsonb(v_row) || jsonb_build_object('amount_iqd', v_amount),
                          v_t_reason, v_t_auth, p_device_id);

  return jsonb_build_object('applied', true, 'unchanged', false, 'kind', v_t_kind, 'value', v_t_value,
    'amount_iqd', v_amount, 'standing', v_t_stand, 'customer_id', v_customer,
    'remaining_iqd', app.court_fee_remaining(v_res.id, null));
end $apply_customer_court_discount_0430$;

revoke all on function app.apply_customer_court_discount(uuid, text, int, text, text) from public, anon;
grant execute on function app.apply_customer_court_discount(uuid, text, int, text, text) to authenticated;

comment on function app.apply_customer_court_discount(uuid, text, int, text, text) is
  '0342, 0403, 0430 (the booking''s live bill locked first, so a concurrent settle_tab and this never pass each other). court_desk, cashier, manager, owner at the booking''s branch (RESERVATION_NOT_FOUND, VENUE_MISMATCH), no PIN. The court-fee discount of a confirmed, arrived or completed plain booking with a price (COURT_DISCOUNT_NOT_ALLOWED detail not_a_live_booking | match). p_kind NULL refreshes it (a one-off keeps its kind and value, else the booking customer''s standing court discount unless this booking waived it, else it goes) and answers every refusal as data ({applied, unchanged: true, refused}); ''standing'' lifts the waiver and puts the standing discount on in place of a one-off; ''none'' takes it off and waives the standing discount for this booking (customer_discount_waivers); ''percent'' | ''amount'' with p_value and p_reason gives it on this booking only (NO_CUSTOMER, SELF_DISCOUNT). The customer is the booking''s guest, else its live tab''s customer. Fixed once a bill of the booking settled with it in place (COURT_BILL_CLOSED). COURT_FEE_PAID when the fee is already paid; DISCOUNT_REQUIRES_REFUND when the discount is more than is still owed (0403: a free court hour from loyalty, reservation_loyalty_rewards, counts as already covered). Locks the court (lock_court) then the booking row. Audit court_discount.apply / court_discount.remove. Returns {applied, unchanged, kind, value, amount_iqd, standing, customer_id, remaining_iqd}.';

-- ---------------------------------------------------------------------------
-- 4. queued_rpc_claim: re-issued from 20261101000398_retired_station_wall.sql
--    (finding 19). A blocked page's save wrapped in queued_rpc is AREA_BLOCKED
--    like the direct call.
-- ---------------------------------------------------------------------------
create or replace function app.queued_rpc_claim(p_key text, p_fn text)
returns jsonb
language plpgsql security definer set search_path = public as $queued_rpc_claim_0430$
declare
  v_retired text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_retired := app.request_station_retired();
  if v_retired is not null then
    raise exception 'STATION_RETIRED' using errcode = 'P0001', detail = v_retired;
  end if;
  if p_fn is null or not (p_fn = any (app.queueable_rpcs())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'not a queueable RPC';
  end if;
  -- 0430: a page the owner blocked for this person stays blocked through the
  -- queue. app.pre_request sees only 'queued_rpc' in the URL, which no page
  -- owns, so the inner RPC's page is checked here.
  if app.area_blocked_rpc(p_fn) then
    raise exception 'AREA_BLOCKED' using errcode = 'P0001', detail = p_fn;
  end if;
  if p_key is null or p_key !~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*:rpc\.queued:[0-9A-HJKMNP-TV-Z]{26}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  return app.claim_replay(p_key, 'queued:' || p_fn);
end $queued_rpc_claim_0430$;

revoke all on function app.queued_rpc_claim(text, text) from public, anon;
grant execute on function app.queued_rpc_claim(text, text) to authenticated;

comment on function app.queued_rpc_claim(text, text) is
  '0395, 0398, 0430. Called by app.queued_rpc in the same transaction: any active staff (FORBIDDEN), not from a retired station (STATION_RETIRED), an allowlisted name (app.queueable_rpcs, FORBIDDEN otherwise), not a page the caller is blocked from (app.area_blocked_rpc, AREA_BLOCKED detail the name), a key shaped <STATION>:rpc.queued:<ulid> (INVALID_ARGUMENT); then app.claim_replay(key, ''queued:'' || name).';

-- ---------------------------------------------------------------------------
-- 5. One phone, one account (finding 24). A push token names one handset.
--    When it is written to a profile, every other profile that still holds it
--    lets it go: a sign-out the guest did not start (an expired session, a
--    password reset elsewhere) cannot clear the old row, and the next account
--    on the phone used to get the previous person's notifications too. Delete
--    and reinstall stays right: the app writes its token again at the next
--    sign-in (its in-memory cache starts empty), the account signing in takes
--    it, and a token the store has retired is still cleared by send-push on
--    DeviceNotRegistered. No index: profiles is small and a token is written
--    once per sign-in or token change.
-- ---------------------------------------------------------------------------
create or replace function app.trg_profile_push_token_one_holder() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_push_token_one_holder_0430$
begin
  if new.expo_push_token is not null
     and (tg_op = 'INSERT' or new.expo_push_token is distinct from old.expo_push_token) then
    update profiles
       set expo_push_token = null
     where expo_push_token = new.expo_push_token
       and id <> new.id;
  end if;
  return null;
end $trg_profile_push_token_one_holder_0430$;

comment on function app.trg_profile_push_token_one_holder() is
  '0430. Trigger profiles_push_token_one_holder (AFTER INSERT OR UPDATE OF expo_push_token): the token just written is cleared from every other profile, so one handset receives one account''s notifications.';

revoke all on function app.trg_profile_push_token_one_holder() from public, anon, authenticated;

drop trigger if exists profiles_push_token_one_holder on public.profiles;
create trigger profiles_push_token_one_holder
  after insert or update of expo_push_token on public.profiles
  for each row execute function app.trg_profile_push_token_one_holder();

-- Today's rows: where two profiles hold one token, the account that signed in
-- last (auth.users.last_sign_in_at, then id) is the one on the phone now and
-- keeps it; the others let it go.
with holders as materialized (
  select p.id, p.expo_push_token,
         row_number() over (partition by p.expo_push_token
                            order by u.last_sign_in_at desc nulls last, p.id desc) as rn
    from profiles p
    left join auth.users u on u.id = p.id
   where p.expo_push_token is not null
)
update profiles p
   set expo_push_token = null
  from holders h
 where h.id = p.id and h.rn > 1;
