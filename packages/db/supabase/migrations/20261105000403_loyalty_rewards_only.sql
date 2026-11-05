-- ===========================================================================
-- 0403 loyalty_rewards_only — points buy things, not money off (Majed,
-- 2026-11-05).
--
-- Majed's calls (2026-11-05):
--   * a reward is a thing you take (a free coffee, a free ice cream, a free
--     hour of court), not a wallet or a credit balance. This reverses his
--     2026-10-17 "keep both" (0350 header): "Use points", points spent as
--     money off the bill at point_value_iqd, becomes a switch the owner turns
--     on, and it is OFF by default;
--   * iqd_off rewards stay in the schema as they are; nothing is removed;
--   * a new reward kind, court_hour: one free hour of court.
--
-- 1. loyalty_settings.points_off_enabled (boolean, default false; the one row
--    there is ends up false). app.loyalty_redeem with p_points raises
--    POINTS_OFF while it is off; rewards are unaffected. The owner sets it
--    through app.set_loyalty_settings; app.loyalty_admin (to_jsonb of the
--    row, unchanged), app.loyalty_till_terms and app.my_loyalty return it.
-- 2. loyalty_rewards.kind gains 'court_hour' (iqd_off and menu_variant_id
--    both null); loyalty_rewards_kind and loyalty_rewards_shape are dropped
--    and added again by name (NOT VALID, then VALIDATE).
-- 3. A court_hour reward is redeemed through app.loyalty_redeem(p_reward_id)
--    on a tab that belongs to a booking (tabs.reservation_id: one live tab
--    per booking, 0106). Plain bookings only, as 0342's court discount: an
--    open match prices its seats itself, a lesson, an event block and
--    maintenance have no court fee of their own (COURT_DISCOUNT_NOT_ALLOWED
--    detail not_a_live_booking | match); no booking is REWARD_NEEDS_BOOKING.
--    Its value is one hour of THAT booking at its own price after the
--    customer's court discount, app.court_hour_value:
--    floor((price_iqd - court_fee_discount) * 60 / minutes), never more than
--    the whole fee (a 60-minute booking, or a shorter one, is free whole).
--    Used whole, like iqd_off: more than app.court_fee_remaining now is
--    REWARD_EXCEEDS_BILL (refund what was paid first). One per booking (the
--    new table's primary key; REWARD_ALREADY_ON_BOOKING), and none once a
--    bill of the booking has closed with its court discount (COURT_BILL_CLOSED,
--    app.court_discount_closed).
-- 4. Table reservation_loyalty_rewards (one row per booking: the reward, the
--    points it cost, the IQD it frees, who applied it, who vouched, how the
--    member proved they were there). RLS on, no client grant, zz_branch_guard;
--    like reservation_court_discounts (0342). The ledger row is (reward,
--    reservation_reward, the row's id), tab_id the tab, note the reward's
--    English name. app.court_fee_remaining subtracts the free hour too (never
--    below 0), so every reader of what a booking owes (the till's court line,
--    the desk bill, day close's unpaid list, reports' owed figures, the
--    guest's own booking) sees it as a discount, never as revenue. Earning is
--    unchanged and counts only what was paid: the free part earns nothing.
-- 5. Undo: app.loyalty_unredeem takes the row's id as well as a tab
--    adjustment's: the points come back (redeem_void, reservation_reward) and
--    the row goes, while no bill of the booking has closed since
--    (COURT_BILL_CLOSED, app.court_reward_closed). A booking cancelled or
--    marked no-show before that gives the points back by itself, once (the
--    deferred trigger reservations_loyalty_court_reward).
-- 6. The desk's view: app.loyalty_court_reward(p_tab_id) says whether a free
--    court hour fits this tab, what it would be worth, and the one already on
--    its booking (for the bill's line and its Undo).
-- 7. A customer court discount given after the free hour never takes the fee
--    below what the hour covered: apply_customer_court_discount and
--    bill_customer_discount count the hour in what was already covered.
--
-- New: column loyalty_settings.points_off_enabled; table
-- reservation_loyalty_rewards; internals court_reward_iqd, court_reward_closed,
-- court_hour_value, trg_loyalty_court_reward_back (deferred trigger
-- reservations_loyalty_court_reward); RPC loyalty_court_reward; error codes
-- POINTS_OFF, REWARD_NEEDS_BOOKING, REWARD_ALREADY_ON_BOOKING.
-- Re-issued (each marked "-- 0403"): court_fee_remaining (0342 no longer the
-- latest), apply_customer_court_discount and bill_customer_discount (0342),
-- set_loyalty_settings (0309), loyalty_till_terms (0305), my_loyalty (0376),
-- loyalty_redeem (0350), loyalty_unredeem (0305), profile_merge_columns
-- (0368: + reservation_loyalty_rewards.profile_id, repoint).
--
-- Lock order: loyalty_redeem and loyalty_unredeem take tabs -> (the item
-- path's orders, order_items, tickets, stock_batches) -> court_advisory
-- (app.lock_court) -> reservations -> loyalty_accounts, as ranked; the
-- cancel trigger is deferred to commit and takes loyalty_accounts only.
--
-- covered by packages/db/tests/loyalty.test.ts ("loyalty rewards only (0403)")
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. "Use points" is a switch, off by default
-- ---------------------------------------------------------------------------

alter table loyalty_settings add column if not exists points_off_enabled boolean not null default false;

comment on column loyalty_settings.points_off_enabled is
  '0403 (Majed 2026-11-05: rewards are things you take, not a wallet). True: the till offers "Use points", points spent as money off a bill at point_value_iqd (app.loyalty_redeem with p_points). False (the default): POINTS_OFF; points are spent on rewards only. Owner-written through app.set_loyalty_settings.';

comment on table loyalty_settings is
  'Loyalty (Phase 2 M3, contracts §1.3; 0403). The one business-wide row (points are shared across branches, L-7). enabled ships false until the client gives the point value, tiers and rewards (L-1). iqd_per_point: IQD paid per point earned; point_value_iqd: IQD one point takes off a bill, used only while points_off_enabled (0403, off by default); min_redeem_points: the least a guest may redeem at once; earn_*: the per-domain earn switches (court = the court fee carried on any tab); inactivity_expiry_months: null = points never expire; totp_step_seconds: the member token''s step. Owner-written through app.set_loyalty_settings. No client grant.';

-- ---------------------------------------------------------------------------
-- 2. The court_hour reward kind
-- ---------------------------------------------------------------------------

alter table loyalty_rewards drop constraint if exists loyalty_rewards_kind;
alter table loyalty_rewards add constraint loyalty_rewards_kind
  check (kind in ('iqd_off', 'item', 'court_hour')) not valid;
alter table loyalty_rewards validate constraint loyalty_rewards_kind;

alter table loyalty_rewards drop constraint if exists loyalty_rewards_shape;
alter table loyalty_rewards add constraint loyalty_rewards_shape check (
        (kind = 'iqd_off' and iqd_off is not null and iqd_off > 0 and menu_variant_id is null)
     or (kind = 'item' and menu_variant_id is not null and iqd_off is null)
     or (kind = 'court_hour' and iqd_off is null and menu_variant_id is null)) not valid;
alter table loyalty_rewards validate constraint loyalty_rewards_shape;

comment on table loyalty_rewards is
  'Loyalty (M3; 0350, 0403). Rewards redeemed at the till for cost_points: iqd_off (a fixed amount off the bill), item (one unit of menu_variant_id free on the tab, 0350) or court_hour (one hour of the court fee of the tab''s booking free, 0403; no amount, no item). venue_id null = every branch. Owner-written. No client grant.';

-- ---------------------------------------------------------------------------
-- 3. The free court hour of a booking
-- ---------------------------------------------------------------------------

-- One row per booking. amount_iqd is fixed when the hour is taken (the hour
-- at the booking's price then, after its customer court discount), so a later
-- move or extend changes what the rest of the booking costs, not what the
-- reward freed.
create table if not exists reservation_loyalty_rewards (
  reservation_id uuid primary key references reservations(id) on delete cascade,
  id             uuid not null default gen_random_uuid(),
  tab_id         uuid not null references tabs(id),
  profile_id     uuid not null references profiles(id),
  reward_id      uuid not null references loyalty_rewards(id),
  points         int not null,
  amount_iqd     bigint not null,
  applied_by     uuid not null references staff(id),
  authorized_by  uuid not null references staff(id),
  proof          text not null,
  created_at     timestamptz not null default now(),
  constraint reservation_loyalty_rewards_id_key unique (id),
  constraint reservation_loyalty_rewards_points check (points > 0),
  constraint reservation_loyalty_rewards_amount check (amount_iqd > 0),
  constraint reservation_loyalty_rewards_proof check (proof in ('qr', 'pin'))
);

comment on table reservation_loyalty_rewards is
  '0403. The free court hour (a court_hour loyalty reward) on one booking: reward_id, the points it cost, amount_iqd (the IQD it took off the court fee, fixed when taken), the member (profile_id), the tab it was taken on, applied_by the caller, authorized_by the caller for a scanned member card or the manager whose PIN vouched (proof qr | pin). app.court_fee_remaining subtracts amount_iqd. The ledger row is (reward, reservation_reward, id). Written only by app.loyalty_redeem; removed by app.loyalty_unredeem and by app.trg_loyalty_court_reward_back (the booking cancelled or a no-show before its bill closed), each giving the points back. Read through app.loyalty_court_reward. No client grant.';

alter table reservation_loyalty_rewards enable row level security;
revoke all on reservation_loyalty_rewards from anon, authenticated;
grant all on reservation_loyalty_rewards to service_role;

drop trigger if exists zz_branch_guard on public.reservation_loyalty_rewards;
create trigger zz_branch_guard before insert or update or delete on public.reservation_loyalty_rewards
  for each row execute function app.trg_branch_guard('child', 'reservations', 'reservation_id', 'tabs', 'tab_id');

-- ---------------------------------------------------------------------------
-- 4. Internals
-- ---------------------------------------------------------------------------

-- The IQD a booking's free court hour took off its fee; 0 with none.
create or replace function app.court_reward_iqd(p_reservation_id uuid) returns bigint
language sql stable security definer set search_path = public as $court_reward_iqd_0403$
  select coalesce((select x.amount_iqd from reservation_loyalty_rewards x
                    where x.reservation_id = p_reservation_id), 0)::bigint
$court_reward_iqd_0403$;

revoke all on function app.court_reward_iqd(uuid) from public, anon, authenticated;

comment on function app.court_reward_iqd(uuid) is
  '0403. Internal: the IQD the booking''s free court hour (reservation_loyalty_rewards.amount_iqd) took off its court fee; 0 with none. court_fee_remaining subtracts it.';

-- True once a bill of the booking settled after its free hour was taken: the
-- hour was used on a closed bill and stays.
create or replace function app.court_reward_closed(p_reservation_id uuid) returns boolean
language sql stable security definer set search_path = public as $court_reward_closed_0403$
  select exists (
    select 1
      from reservation_loyalty_rewards x
      join tabs t on t.reservation_id = x.reservation_id
     where x.reservation_id = p_reservation_id
       and t.status = 'settled'
       and t.merged_into_tab_id is null
       and t.settled_at >= x.created_at)
$court_reward_closed_0403$;

revoke all on function app.court_reward_closed(uuid) from public, anon, authenticated;

comment on function app.court_reward_closed(uuid) is
  '0403. Internal: true when a bill of the booking settled at or after its free court hour was taken; the hour is then used and can no longer be undone or given back (COURT_BILL_CLOSED).';

-- One hour of a booking at its own price after its customer court discount:
-- floor((price_iqd - court_fee_discount) * 60 / minutes), at most that whole
-- price (an hour or less is free whole). 0 without a price.
create or replace function app.court_hour_value(p_reservation_id uuid) returns bigint
language sql stable security definer set search_path = public as $court_hour_value_0403$
  select coalesce((
    select least(
             greatest(r.price_iqd - app.court_fee_discount(r.id), 0),
             floor((greatest(r.price_iqd - app.court_fee_discount(r.id), 0)::numeric * 60)
                   / greatest(extract(epoch from (r.end_at - r.start_at)) / 60.0, 1)))::bigint
      from reservations r
     where r.id = p_reservation_id
       and r.price_iqd is not null
  ), 0)::bigint
$court_hour_value_0403$;

revoke all on function app.court_hour_value(uuid) from public, anon, authenticated;

comment on function app.court_hour_value(uuid) is
  '0403. Internal: what a court_hour reward is worth on a booking now: one hour at its own price after its customer court discount, floor((price_iqd - app.court_fee_discount) * 60 / its minutes), never more than that whole fee (a booking of an hour or less is free whole); 0 without a price.';

-- court_fee_remaining: re-issued from 20261016000342_customer_discounts.sql:222.
-- One term added (0403): the booking's free court hour is owed by nobody.
create or replace function app.court_fee_remaining(p_reservation_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language sql stable security definer set search_path = public as $court_fee_remaining_0403$
  select coalesce((
    select greatest(r.price_iqd - app.court_fee_paid(r.id, p_exclude_tab_id)
                                - app.court_fee_written_off(r.id, p_exclude_tab_id)
                                - app.court_fee_discount(r.id)
                                - app.court_reward_iqd(r.id), 0)::bigint   -- 0403
      from reservations r
     where r.id = p_reservation_id
       and r.kind = 'booking'
       and r.status in ('confirmed','arrived','completed')
       and r.price_iqd is not null
  ), 0)::bigint
$court_fee_remaining_0403$;

revoke all on function app.court_fee_remaining(uuid, uuid) from public, anon, authenticated;

comment on function app.court_fee_remaining(uuid, uuid) is
  '0106, 0262, 0342, 0403. The court fee still owed on a booking: price_iqd minus the court_iqd stamped on its OTHER settled tabs (and its online deposit) minus the open-match shares written off (court_fee_written_off) minus its customer court discount (court_fee_discount, 0342) minus its free court hour from loyalty (court_reward_iqd, 0403), floored at 0; 0 unless the booking is confirmed/arrived/completed. The basis of the court line on every tab (compute_tab_totals). Internal.';


-- ---------------------------------------------------------------------------
-- 5. A customer court discount after the free hour
-- ---------------------------------------------------------------------------

-- apply_customer_court_discount: re-issued from 20261016000342_customer_discounts.sql:686.
-- One term added (0403): what the booking owes before the discount is also
-- less its free court hour, so a discount given after the reward never takes
-- the fee below what the reward already covered.
create or replace function app.apply_customer_court_discount(
  p_reservation_id uuid,
  p_kind      text default null,
  p_value     int  default null,
  p_reason    text default null,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_customer_court_discount_0403$
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
end $apply_customer_court_discount_0403$;

revoke all on function app.apply_customer_court_discount(uuid, text, int, text, text) from public, anon;
grant execute on function app.apply_customer_court_discount(uuid, text, int, text, text) to authenticated;

comment on function app.apply_customer_court_discount(uuid, text, int, text, text) is
  '0342, 0403. court_desk, cashier, manager, owner at the booking''s branch (RESERVATION_NOT_FOUND, VENUE_MISMATCH), no PIN. The court-fee discount of a confirmed, arrived or completed plain booking with a price (COURT_DISCOUNT_NOT_ALLOWED detail not_a_live_booking | match). p_kind NULL refreshes it (a one-off keeps its kind and value, else the booking customer''s standing court discount unless this booking waived it, else it goes) and answers every refusal as data ({applied, unchanged: true, refused}); ''standing'' lifts the waiver and puts the standing discount on in place of a one-off; ''none'' takes it off and waives the standing discount for this booking (customer_discount_waivers); ''percent'' | ''amount'' with p_value and p_reason gives it on this booking only (NO_CUSTOMER, SELF_DISCOUNT). The customer is the booking''s guest, else its live tab''s customer. Fixed once a bill of the booking settled with it in place (COURT_BILL_CLOSED). COURT_FEE_PAID when the fee is already paid; DISCOUNT_REQUIRES_REFUND when the discount is more than is still owed (0403: a free court hour from loyalty, reservation_loyalty_rewards, counts as already covered). Locks the court (lock_court) then the booking row. Audit court_discount.apply / court_discount.remove. Returns {applied, unchanged, kind, value, amount_iqd, standing, customer_id, remaining_iqd}.';

-- bill_customer_discount: re-issued from 20261016000342_customer_discounts.sql:902.
-- The same term as apply_customer_court_discount (0403), so court_needs_refresh
-- never asks for a refresh the apply would refuse.
create or replace function app.bill_customer_discount(
  p_tab_id         uuid default null,
  p_reservation_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $bill_customer_discount_0403$
declare
  v_tab      tabs%rowtype;
  v_res      reservations%rowtype;
  v_has_tab  boolean := false;
  v_has_res  boolean := false;
  v_venue    uuid;
  v_customer uuid;
  v_name     text;
  v_cafe     jsonb := null;
  v_court    jsonb := null;
  v_plan     record;
  v_adj      tab_adjustments%rowtype;
  v_cafe_refresh  boolean := false;
  v_court_refresh boolean := false;
  v_cd       customer_discounts%rowtype;
  v_rcd      reservation_court_discounts%rowtype;
  v_owed     bigint;
  v_amount   bigint;
  v_live     boolean;
  v_cafe_waived  boolean := false;
  v_court_waived boolean := false;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_tab_id is null and p_reservation_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'pass p_tab_id or p_reservation_id';
  end if;

  if p_tab_id is not null then
    select * into v_tab from tabs where id = p_tab_id;
    if not found then
      raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_has_tab := true;
    v_venue := v_tab.venue_id;
  end if;
  if coalesce(p_reservation_id, v_tab.reservation_id) is not null then
    select * into v_res from reservations where id = coalesce(p_reservation_id, v_tab.reservation_id);
    if not found then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_has_res := true;
    v_venue := coalesce(v_venue, v_res.venue_id);
  end if;
  if not app.is_staff_at(v_venue, 'court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  v_customer := case when v_has_tab then app.tab_customer(v_tab.id)
                     else app.booking_discount_customer(v_res.id) end;
  if v_customer is null and v_has_res then
    v_customer := app.booking_discount_customer(v_res.id);
  end if;
  select p.full_name into v_name from profiles p where p.id = v_customer;
  if v_customer is not null then
    select * into v_cd from customer_discounts d where d.customer_id = v_customer;
  end if;

  if v_has_tab then
    v_cafe_waived := exists (select 1 from customer_discount_waivers w where w.tab_id = v_tab.id);
    select * into v_adj
      from tab_adjustments a
     where a.tab_id = v_tab.id and a.order_item_id is null
       and a.reason_code in ('customer_discount', 'customer_discount_once')
     order by a.created_at desc
     limit 1;
    if found then
      v_cafe := jsonb_build_object(
        'adjustment_id', v_adj.id,
        'kind',          case when v_adj.kind = 'discount_percent' then 'percent' else 'amount' end,
        'value',         v_adj.value,
        'amount_iqd',    v_adj.amount_iqd,
        'standing',      v_adj.reason_code = 'customer_discount');
    end if;
    if v_tab.status in ('open', 'awaiting_payment') and v_tab.merged_into_tab_id is null then
      select * into v_plan from app.customer_tab_discount_plan(v_tab.id, v_customer);
      v_cafe_refresh :=
        case when v_adj.id is null then coalesce(v_plan.amount_iqd, 0) > 0
             else v_plan.kind is null
                  or v_adj.reason_code is distinct from v_plan.reason_code
                  or v_adj.value is distinct from v_plan.value
                  or v_adj.amount_iqd is distinct from v_plan.amount_iqd
                  or (case when v_adj.kind = 'discount_percent' then 'percent' else 'amount' end) is distinct from v_plan.kind
        end;
    end if;
  end if;

  if v_has_res then
    select * into v_rcd from reservation_court_discounts where reservation_id = v_res.id;
    if found then
      v_court := jsonb_build_object(
        'kind',       v_rcd.kind,
        'value',      v_rcd.value,
        'amount_iqd', app.court_fee_discount(v_res.id),
        'standing',   v_rcd.standing,
        'reason',     v_rcd.reason,
        'closed',     app.court_discount_closed(v_res.id));
    end if;
    v_live := v_res.kind = 'booking' and v_res.status in ('confirmed', 'arrived', 'completed')
              and v_res.price_iqd is not null
              and not exists (select 1 from matches m where m.reservation_id = v_res.id);
    -- The refresh would change something: the standing court discount is not
    -- on the booking yet (or a different one is), the bill is not closed, and
    -- it fits in what is still owed.
    v_court_waived := exists (select 1 from customer_discount_waivers w where w.reservation_id = v_res.id);
    if v_live and v_cd.court_kind is not null and not v_court_waived
       and (v_rcd.reservation_id is null
            or (v_rcd.standing and (v_rcd.kind is distinct from v_cd.court_kind
                                    or v_rcd.value is distinct from v_cd.court_value
                                    or v_rcd.reason is distinct from v_cd.reason)))
       and not app.court_discount_closed(v_res.id) then
      v_owed := greatest(v_res.price_iqd - app.court_fee_paid(v_res.id, null)
                                         - app.court_fee_written_off(v_res.id, null)
                                         - app.court_reward_iqd(v_res.id), 0);   -- 0403
      v_amount := case when v_cd.court_kind = 'percent'
                       then round((v_res.price_iqd::numeric * v_cd.court_value) / 10000.0)::bigint
                       else least(v_cd.court_value::bigint, v_res.price_iqd) end;
      v_court_refresh := v_owed > 0 and v_amount <= v_owed;
    elsif v_live and v_rcd.reservation_id is not null and v_rcd.standing and v_cd.court_kind is null
          and not app.court_discount_closed(v_res.id) then
      v_court_refresh := true;   -- the standing discount was removed: the refresh drops it
    end if;
  end if;

  return jsonb_build_object(
    'customer',              case when v_customer is null then null
                                  else jsonb_build_object('id', v_customer, 'name', v_name) end,
    'standing',              case when v_customer is null then null else app.customer_discount_json(v_customer) end,
    'cafe',                  v_cafe,
    'court',                 v_court,
    'cafe_needs_refresh',    v_cafe_refresh,
    'court_needs_refresh',   v_court_refresh,
    'cafe_waived',           v_cafe_waived,
    'court_waived',          v_court_waived,
    'court_allowed',         coalesce(v_live, false));
end $bill_customer_discount_0403$;

revoke all on function app.bill_customer_discount(uuid, uuid) from public, anon;
grant execute on function app.bill_customer_discount(uuid, uuid) to authenticated;

comment on function app.bill_customer_discount(uuid, uuid) is
  '0342, 0403. court_desk, cashier, shop_staff, manager, owner at the bill''s branch: the customer discount state of a bill (a tab, a booking, or a tab and its booking; INVALID_ARGUMENT with neither, TAB_NOT_FOUND, RESERVATION_NOT_FOUND, VENUE_MISMATCH). {customer: {id, name} | null (tab_customer, else the booking''s), standing: customer_discount_json | null, cafe: {adjustment_id, kind, value, amount_iqd, standing} | null, court: {kind, value, amount_iqd, standing, reason, closed} | null, cafe_needs_refresh, court_needs_refresh (apply_customer_discount / apply_customer_court_discount with no kind would change something), cafe_waived, court_waived (the standing discount was taken off this bill: customer_discount_waivers), court_allowed (a live plain booking with a price, no match)}.';

-- ---------------------------------------------------------------------------
-- 6. The switch: the owner's writer and the readers
-- ---------------------------------------------------------------------------

-- set_loyalty_settings: re-issued from 20261006000309_loyalty_promotions_nightly.sql:873,
-- plus the points_off_enabled key (0403).
create or replace function app.set_loyalty_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_loyalty_settings_0403$
declare
  v_key    text;
  v_before jsonb;
  v_row    loyalty_settings%rowtype;
  v_was    boolean;   -- 0309 (c8)
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('enabled', 'iqd_per_point', 'point_value_iqd', 'min_redeem_points', 'earn_cafe', 'earn_shop',
                     'earn_court', 'earn_lesson', 'earn_tournament', 'inactivity_expiry_months',
                     'totp_step_seconds', 'points_off_enabled') then   -- 0403
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  v_before := app.loyalty_settings_json();
  select * into v_row from loyalty_settings where id for update;
  v_was := v_row.enabled;
  begin
    v_row := jsonb_populate_record(v_row, p_patch);
    update loyalty_settings
       set enabled                  = v_row.enabled,
           iqd_per_point            = v_row.iqd_per_point,
           point_value_iqd          = v_row.point_value_iqd,
           min_redeem_points        = v_row.min_redeem_points,
           earn_cafe                = v_row.earn_cafe,
           earn_shop                = v_row.earn_shop,
           earn_court               = v_row.earn_court,
           earn_lesson              = v_row.earn_lesson,
           earn_tournament          = v_row.earn_tournament,
           inactivity_expiry_months = v_row.inactivity_expiry_months,
           totp_step_seconds        = v_row.totp_step_seconds,
           points_off_enabled       = v_row.points_off_enabled,   -- 0403
           -- 0309 (c8): when the programme turns on, inactivity counts from now.
           enabled_at               = case when v_row.enabled and not v_was then now() else enabled_at end,
           updated_at               = now(),
           updated_by               = auth.uid()
     where id;
  exception when check_violation or not_null_violation or invalid_text_representation
                 or numeric_value_out_of_range or datatype_mismatch or invalid_parameter_value then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.write_audit('loyalty.settings', 'loyalty_settings', 'true', v_before, app.loyalty_settings_json(), null);
  return app.loyalty_settings_json();
end $set_loyalty_settings_0403$;

comment on function app.set_loyalty_settings(jsonb) is
  'Loyalty (M3, contracts §1.3; 0309, 0403). Owner: patches the business-wide settings with the keys given (enabled, iqd_per_point, point_value_iqd, min_redeem_points, earn_cafe, earn_shop, earn_court, earn_lesson, earn_tournament, inactivity_expiry_months, totp_step_seconds, points_off_enabled (0403: "Use points" as money off; off by default)); an unknown key is INVALID_ARGUMENT (detail = the key), a value the table refuses INVALID_VALUE. Returns the settings. Audited loyalty.settings. 0309 (c8): enabled_at = now() when enabled turns on (the nightly inactivity expiry counts from it).';

revoke all on function app.set_loyalty_settings(jsonb) from public, anon;
grant execute on function app.set_loyalty_settings(jsonb) to authenticated;

-- loyalty_till_terms: re-issued from 20261005000305_loyalty.sql:1562, plus
-- points_off_enabled (0403).
create or replace function app.loyalty_till_terms(p_venue_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_till_terms_0403$
declare
  v_s loyalty_settings%rowtype;
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is not null and not (p_venue_id = any(app.visible_venue_ids())) then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select * into v_s from loyalty_settings where id;
  return jsonb_build_object(
    'enabled', coalesce(v_s.enabled, false),
    'point_value_iqd', v_s.point_value_iqd,
    'min_redeem_points', v_s.min_redeem_points,
    'points_off_enabled', coalesce(v_s.points_off_enabled, false),   -- 0403
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                                          'cost_points', r.cost_points, 'kind', r.kind,
                                          'iqd_off', r.iqd_off, 'menu_variant_id', r.menu_variant_id,
                                          'active', r.active, 'venue_id', r.venue_id)
                       order by r.cost_points, r.name_en)
        from loyalty_rewards r
       where r.active and (r.venue_id is null or r.venue_id = p_venue_id)), '[]'::jsonb));
end $loyalty_till_terms_0403$;

comment on function app.loyalty_till_terms(uuid) is
  'Loyalty (M3, integration; 0403). Desk roles (cashier, shop_staff, court_desk, manager, owner): what the till needs to offer points and rewards: {enabled, point_value_iqd, min_redeem_points, points_off_enabled (0403: the till offers "Use points" only when true), rewards[] (kind iqd_off | item | court_hour) active at p_venue_id or every branch}. VENUE_MISMATCH outside the caller''s branches. Read-only.';


revoke all on function app.loyalty_till_terms(uuid) from public, anon;
grant execute on function app.loyalty_till_terms(uuid) to authenticated;

-- my_loyalty: re-issued from 20261031000376_loyalty_tier_colors.sql:73, plus
-- points_off_enabled (0403).
create or replace function app.my_loyalty() returns jsonb
language plpgsql stable security definer set search_path = public as $my_loyalty_0403$
declare
  v_me    uuid := app.loyalty_me();
  v_s     loyalty_settings%rowtype;
  v_acct  loyalty_accounts%rowtype;
  v_tier  loyalty_tiers%rowtype;
  v_next  jsonb;
begin
  select * into v_s from loyalty_settings where id;
  select * into v_acct from loyalty_accounts where profile_id = v_me;
  select * into v_tier from loyalty_tiers
   where id = coalesce(v_acct.tier_id, (select b.id from loyalty_tiers b order by b.sort limit 1));
  select jsonb_build_object('id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                            'multiplier', t.earn_multiplier, 'min_points_12m', t.min_points_12m,
                            'color', t.color)   -- 0376
    into v_next
    from loyalty_tiers t
   where t.min_points_12m > coalesce(v_tier.min_points_12m, 0)
   order by t.min_points_12m
   limit 1;

  return jsonb_build_object(
    'enabled',           coalesce(v_s.enabled, false),
    'balance',           coalesce(v_acct.balance, 0),
    'lifetime',          coalesce(v_acct.lifetime_earned, 0),
    'points_12m',        coalesce(v_acct.points_12m, 0),
    'tier',              app.loyalty_tier_json(v_tier.id),
    'next_tier',         v_next,
    'point_value_iqd',   v_s.point_value_iqd,
    'min_redeem_points', v_s.min_redeem_points,
    'points_off_enabled', coalesce(v_s.points_off_enabled, false),   -- 0403
    'history',           app.loyalty_history_guest(v_me, 50),   -- 0308 (s1)
    'rewards',           coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                                          'cost_points', r.cost_points, 'kind', r.kind, 'iqd_off', r.iqd_off)
                       order by r.cost_points, r.id)
        from loyalty_rewards r
       where r.active), '[]'::jsonb));
end $my_loyalty_0403$;

comment on function app.my_loyalty() is
  'Loyalty (M3, contracts §1.3; 0308, 0376, 0403). The signed-in guest''s points: {enabled, balance, lifetime, points_12m, tier {id, name_en, name_ar, multiplier, color} (the base tier without an account), next_tier (+ min_points_12m, color) | null, point_value_iqd, min_redeem_points, points_off_enabled (0403: false = points are not spent as money off; rewards only), history (50 newest LedgerRow; since 0308 the note only on reward and expire rows), rewards (every active one, any branch; kind iqd_off | item | court_hour)}. AUTH_REQUIRED without a session, ACCOUNT_REQUIRED for an anonymous session or a deleted account.';

revoke all on function app.my_loyalty() from public, anon;
grant execute on function app.my_loyalty() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.loyalty_redeem: POINTS_OFF and the free court hour
-- ---------------------------------------------------------------------------

-- loyalty_redeem: re-issued from 20261017000350_loyalty_item_rewards.sql:49.
-- Changes marked 0403: POINTS_OFF, and the court_hour reward.
create or replace function app.loyalty_redeem(
  p_tab_id          uuid,
  p_points          int,
  p_reward_id       uuid,
  p_idempotency_key text,
  p_member_token    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_redeem_0403$
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
  v_court     boolean := false;     -- 0403: a free court hour
  v_res       reservations%rowtype;                 -- 0403
  v_crw       reservation_loyalty_rewards%rowtype;  -- 0403
  v_owed      bigint;                               -- 0403
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
  -- 0403 (Majed 2026-11-05): points are spent on rewards; "Use points" as
  -- money off the bill only while the owner has it switched on.
  if p_points is not null and not coalesce(v_s.points_off_enabled, false) then
    raise exception 'POINTS_OFF' using errcode = 'P0001';
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
    -- 0403: a free court hour is taken off the court fee of the booking this
    -- tab belongs to: a plain booking (not an open match, a lesson, an event
    -- or maintenance), once per booking, while no bill of it has closed with
    -- its court discount. The court, then the booking row (0042's order, as
    -- apply_customer_court_discount), both before the account.
    if v_reward.kind = 'court_hour' then
      v_court := true;
      if v_tab.reservation_id is null then
        raise exception 'REWARD_NEEDS_BOOKING' using errcode = 'P0001';
      end if;
      select * into v_res from reservations where id = v_tab.reservation_id;
      perform app.lock_court(v_res.court_id);
      select * into v_res from reservations where id = v_tab.reservation_id for update;
      if v_res.kind <> 'booking' or v_res.status not in ('confirmed', 'arrived', 'completed')
         or v_res.price_iqd is null then
        raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'not_a_live_booking';
      end if;
      if exists (select 1 from matches m where m.reservation_id = v_res.id) then
        raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'match';
      end if;
      if exists (select 1 from reservation_loyalty_rewards x where x.reservation_id = v_res.id) then
        raise exception 'REWARD_ALREADY_ON_BOOKING' using errcode = 'P0001';
      end if;
      if app.court_discount_closed(v_res.id) then
        raise exception 'COURT_BILL_CLOSED' using errcode = 'P0001';
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
    elsif v_court then
      -- 0403: one hour of this booking at its own price after the customer's
      -- court discount (app.court_hour_value; a booking of an hour or less is
      -- free whole), used whole: more than the court fee still owed is
      -- refused, never charged in full for less.
      v_value := app.court_hour_value(v_res.id);
      v_owed := app.court_fee_remaining(v_res.id, null);
      if v_value > v_owed then
        raise exception 'REWARD_EXCEEDS_BILL' using errcode = 'P0001',
          detail = format('reward %s, court fee left %s', v_value, v_owed),
          hint = 'part of the court fee is already paid: refund it first, then use the free hour';
      end if;
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

  if v_court then
    -- 0403: the free hour is the booking's (reservation_loyalty_rewards), not
    -- a goods discount; app.court_fee_remaining takes it off the court fee.
    insert into reservation_loyalty_rewards (reservation_id, tab_id, profile_id, reward_id, points, amount_iqd,
                                             applied_by, authorized_by, proof)
    values (v_res.id, p_tab_id, v_customer, v_reward.id, v_points, v_amount, auth.uid(), v_auth, v_how)
    returning * into v_crw;

    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id, note)
    values (v_customer, v_tab.venue_id, -v_points, 'reward', 'reservation_reward', v_crw.id, p_tab_id, auth.uid(),
            left(v_reward.name_en, 200));
  else
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
  end if;

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

  if v_court then
    perform app.write_audit('loyalty.redeem', 'reservation_loyalty_rewards', v_crw.id::text, null,
                            to_jsonb(v_crw) || jsonb_build_object('customer_id', v_customer,
                                                                  'reward_id', p_reward_id,
                                                                  'proof', v_how),
                            'loyalty_court_hour', v_auth);
  else
    perform app.write_audit('loyalty.redeem', 'tab_adjustments', v_adj.id::text, null,
                            to_jsonb(v_adj) || jsonb_build_object('customer_id', v_customer,
                                                                  'reward_id', p_reward_id,
                                                                  'proof', v_how),
                            v_adj.reason_code, v_auth);
  end if;

  v_result := jsonb_build_object(
    'adjustment_id', v_adj.id,
    'points',        v_points,
    'amount_iqd',    v_amount,
    'balance',       (select a.balance from loyalty_accounts a where a.profile_id = v_customer),
    'order_item_id', v_line.id,   -- 0350
    'item_added',    v_added,     -- 0350
    'court_reward_id', v_crw.id,         -- 0403
    'reservation_id',  v_res.id);        -- 0403
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $loyalty_redeem_0403$;

comment on function app.loyalty_redeem(uuid, int, uuid, text, text) is
  'Loyalty (M3, contracts §1.3, L-5; 0308, 0350, 0403). Cashier, shop_staff, court_desk, manager, owner at the tab''s branch, the tab''s kind for the role. Exactly one of p_points and p_reward_id (INVALID_ARGUMENT). LOYALTY_OFF, then claim_replay, then the tab (TAB_NOT_FOUND, TAB_MERGED, TAB_NOT_OPEN: open only) and its customer (NO_CUSTOMER). 0308 (c2, c3): the proof: p_member_token, spent once, must name the customer (MEMBER_CODE_MISMATCH; FORBIDDEN self_dealing when the customer is the caller); a token that does not pass (wrong, expired, replayed) is answered {error: MEMBER_CODE_INVALID | MEMBER_CODE_EXPIRED, detail} and counted in loyalty_token_attempts, with the idempotency claim released, and MEMBER_CODE_LOCKED after ten misses by the caller in ten minutes; or without it a manager PIN grant (PIN_GRANT_REQUIRED) whose authorizer is not the customer (FORBIDDEN self_dealing). Then the account, locked last. Points: POINTS_BELOW_MIN (min_redeem_points, checked again after the fit: hint the points that fit), POINTS_INSUFFICIENT, rounded down to fit what is left to discount (the goods not yet discounted, and the unpaid bill), amount = points * point_value_iqd. Reward: active, this branch or every branch (REWARD_NOT_FOUND), POINTS_INSUFFICIENT for cost_points. An iqd_off reward is a tab discount of iqd_off, REWARD_EXCEEDS_BILL when that is more than what is left (0308, c13). 0350: an item reward frees one unit of its exact variant on the tab: a line discount of that line''s unit_price_iqd (modifiers stay paid) on the oldest live line of the variant with a unit free (fewer loyalty_reward rows on it than its qty, and a unit price left after its line discounts); with none, one unit is ordered onto the tab first (orders source till, placed_by the caller, app.add_order_items, a ticket or a served shop order; its refusals pass through) by a cashier, shop_staff, manager or owner (REWARD_ITEM_NOT_ON_TAB for the court desk), on the open day the tab belongs to (NO_OPEN_DAY, DAY_CLOSED; the day is locked before the tab). NOTHING_OWED when nothing is left to discount. Writes a tab_adjustments discount_amount (order_item_id = the freed line for an item reward, else null; value = points, applied_by = the caller, authorized_by = the caller for a token or the PIN''s manager, reason_code loyalty_points | loyalty_reward) and a ledger row (redeem | reward, tab_adjustment, adjustment_id) in one transaction, then the 0037 guard. Returns {adjustment_id, points, amount_iqd, balance, order_item_id (an item reward''s line, else null), item_added}. Audited loyalty.redeem {proof qr | pin}. 0403 (Majed 2026-11-05, rewards are things you take): p_points is POINTS_OFF unless loyalty_settings.points_off_enabled; a court_hour reward frees one hour of the court fee of the booking the tab belongs to (REWARD_NEEDS_BOOKING without one; COURT_DISCOUNT_NOT_ALLOWED detail not_a_live_booking | match for anything but a confirmed, arrived or completed plain booking with a price; REWARD_ALREADY_ON_BOOKING for a second; COURT_BILL_CLOSED once a bill of it closed with its court discount; REWARD_EXCEEDS_BILL when the hour, app.court_hour_value, is more than app.court_fee_remaining; lock_court then the booking row, before the account), written as a reservation_loyalty_rewards row and a ledger row (reward, reservation_reward, the row id) with no tab adjustment; the result then has adjustment_id null, court_reward_id and reservation_id. Audited loyalty.redeem on reservation_loyalty_rewards, reason loyalty_court_hour.';

revoke all on function app.loyalty_redeem(uuid, int, uuid, text, text) from public, anon;
grant execute on function app.loyalty_redeem(uuid, int, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Undo, from the desk or the till
-- ---------------------------------------------------------------------------

-- loyalty_unredeem: re-issued from 20261005000305_loyalty.sql:1180. 0403: the
-- id may also be a free court hour's (reservation_loyalty_rewards.id). The
-- tab it was taken on is locked first either way, then the court and the
-- booking row, then the account: the order loyalty_redeem took them in.
create or replace function app.loyalty_unredeem(p_adjustment_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_unredeem_0403$
declare
  v_venue uuid;
  v_adj   tab_adjustments%rowtype;
  v_tab   tabs%rowtype;
  v_row   loyalty_ledger%rowtype;
  v_crw   reservation_loyalty_rewards%rowtype;   -- 0403
  v_res   reservations%rowtype;                 -- 0403
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0403: a free court hour is undone by its own id.
  select * into v_crw from reservation_loyalty_rewards where id = p_adjustment_id;
  if v_crw.id is not null then
    v_venue := (select r.venue_id from reservations r where r.id = v_crw.reservation_id);
  else
    v_venue := (select t.venue_id from tab_adjustments a join tabs t on t.id = a.tab_id where a.id = p_adjustment_id);
  end if;
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  select t.* into v_tab
    from tabs t
   where t.id = coalesce(v_crw.tab_id, (select a.tab_id from tab_adjustments a where a.id = p_adjustment_id))
     for update;

  -- 0403: the free court hour. Undone while no bill of the booking has closed
  -- since it was taken, whatever became of the tab it was taken on.
  if v_crw.id is not null then
    select * into v_res from reservations where id = v_crw.reservation_id;
    perform app.lock_court(v_res.court_id);
    select * into v_res from reservations where id = v_crw.reservation_id for update;
    select * into v_crw from reservation_loyalty_rewards where id = p_adjustment_id;
    select * into v_row from loyalty_ledger l
     where l.kind = 'reward' and l.source_kind = 'reservation_reward' and l.source_id = p_adjustment_id;
    if v_crw.id is null or v_row.id is null then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'not a loyalty redemption';
    end if;
    if v_tab.id is not null then
      perform app.assert_tab_kind_role(v_tab.kind);
    end if;
    if app.court_reward_closed(v_res.id) then
      raise exception 'COURT_BILL_CLOSED' using errcode = 'P0001';
    end if;
  else
    select * into v_adj from tab_adjustments where id = p_adjustment_id;
    select * into v_row from loyalty_ledger l
     where l.kind in ('redeem', 'reward') and l.source_kind = 'tab_adjustment' and l.source_id = p_adjustment_id;
    if v_adj.id is null or v_row.id is null then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'not a loyalty redemption';
    end if;
    perform app.assert_tab_kind_role(v_tab.kind);
    if v_tab.status <> 'open' then
      raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
    end if;
  end if;

  perform 1 from loyalty_accounts a where a.profile_id = v_row.profile_id for update;
  if v_crw.id is not null then
    -- 0403
    delete from reservation_loyalty_rewards where id = v_crw.id;
    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
    values (v_row.profile_id, v_row.venue_id, -v_row.delta, 'redeem_void', 'reservation_reward', v_crw.id,
            v_crw.tab_id, auth.uid());
    perform app.write_audit('loyalty.unredeem', 'reservation_loyalty_rewards', v_crw.id::text, to_jsonb(v_crw), null,
                            'loyalty_court_hour', auth.uid());
  else
    delete from tab_adjustments where id = p_adjustment_id;
    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
    values (v_row.profile_id, v_row.venue_id, -v_row.delta, 'redeem_void', 'tab_adjustment', p_adjustment_id,
            v_tab.id, auth.uid());
    perform app.write_audit('loyalty.unredeem', 'tab_adjustments', p_adjustment_id::text, to_jsonb(v_adj), null,
                            v_adj.reason_code, auth.uid());
  end if;

  return jsonb_build_object('balance',
    (select a.balance from loyalty_accounts a where a.profile_id = v_row.profile_id));
end $loyalty_unredeem_0403$;

comment on function app.loyalty_unredeem(uuid) is
  'Loyalty (M3, contracts §1.3; 0403). Same roles as loyalty_redeem, at the tab''s branch, the tab''s kind for the role. Reverses a loyalty redemption on a tab that is still open (TAB_NOT_OPEN): deletes the adjustment and writes (redeem_void, tab_adjustment, adjustment_id) giving the points back. 0403: p_adjustment_id may instead be a free court hour (reservation_loyalty_rewards.id), undone while no bill of its booking has settled since it was taken (COURT_BILL_CLOSED), whatever became of the tab it was taken on: the row goes and (redeem_void, reservation_reward, id) gives the points back; the tab, then lock_court and the booking row, then the account. INVALID_ARGUMENT for an id that is neither. Returns {balance}. Audited loyalty.unredeem.';

revoke all on function app.loyalty_unredeem(uuid) from public, anon;
grant execute on function app.loyalty_unredeem(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The bill's view of the free court hour
-- ---------------------------------------------------------------------------

create or replace function app.loyalty_court_reward(p_tab_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_court_reward_0403$
declare
  v_tab     tabs%rowtype;
  v_res     reservations%rowtype;
  v_crw     reservation_loyalty_rewards%rowtype;
  v_rw      loyalty_rewards%rowtype;
  v_plain   boolean := false;
  v_refused text;
  v_value   bigint;
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_tab.venue_id, 'cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  if v_tab.reservation_id is null then
    v_refused := 'REWARD_NEEDS_BOOKING';
  else
    select * into v_res from reservations where id = v_tab.reservation_id;
    v_plain := v_res.kind = 'booking' and v_res.status in ('confirmed', 'arrived', 'completed')
               and v_res.price_iqd is not null
               and not exists (select 1 from matches m where m.reservation_id = v_res.id);
    select * into v_crw from reservation_loyalty_rewards where reservation_id = v_tab.reservation_id;
    if v_crw.id is not null then
      select * into v_rw from loyalty_rewards where id = v_crw.reward_id;
    end if;
    if not v_plain then
      v_refused := 'COURT_DISCOUNT_NOT_ALLOWED';
    else
      v_value := app.court_hour_value(v_res.id);
      if v_crw.id is not null then
        v_refused := 'REWARD_ALREADY_ON_BOOKING';
      elsif app.court_discount_closed(v_res.id) then
        v_refused := 'COURT_BILL_CLOSED';
      elsif v_value < 1 then
        v_refused := 'NOTHING_OWED';
      elsif v_value > app.court_fee_remaining(v_res.id, null) then
        v_refused := 'REWARD_EXCEEDS_BILL';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'tab_id',         v_tab.id,
    'reservation_id', v_tab.reservation_id,
    'plain_booking',  v_plain,
    'value_iqd',      v_value,
    'refused',        v_refused,
    'reward',         case when v_crw.id is null then null else jsonb_build_object(
                        'id',         v_crw.id,
                        'reward_id',  v_crw.reward_id,
                        'name_en',    v_rw.name_en,
                        'name_ar',    v_rw.name_ar,
                        'points',     v_crw.points,
                        'amount_iqd', v_crw.amount_iqd,
                        'created_at', v_crw.created_at,
                        'closed',     app.court_reward_closed(v_crw.reservation_id)) end);
end $loyalty_court_reward_0403$;

revoke all on function app.loyalty_court_reward(uuid) from public, anon;
grant execute on function app.loyalty_court_reward(uuid) to authenticated;

comment on function app.loyalty_court_reward(uuid) is
  '0403. Desk roles (cashier, shop_staff, court_desk, manager, owner) at the tab''s branch (TAB_NOT_FOUND, VENUE_MISMATCH). Read-only: the free court hour on the booking this tab belongs to. {tab_id, reservation_id, plain_booking (a confirmed, arrived or completed booking with a price and no open match: a court_hour reward can be offered here), value_iqd (app.court_hour_value, plain bookings only), refused (what app.loyalty_redeem would answer a court_hour reward now: REWARD_NEEDS_BOOKING | COURT_DISCOUNT_NOT_ALLOWED | REWARD_ALREADY_ON_BOOKING | COURT_BILL_CLOSED | NOTHING_OWED | REWARD_EXCEEDS_BILL | null), reward: {id (what app.loyalty_unredeem takes), reward_id, name_en, name_ar, points, amount_iqd, created_at, closed} | null}.';

-- ---------------------------------------------------------------------------
-- 10. A booking cancelled or a no-show before its bill closed gives the
--     points back, once
-- ---------------------------------------------------------------------------

create or replace function app.trg_loyalty_court_reward_back() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_court_reward_back_0403$
declare
  v_res reservations%rowtype;
  v_crw reservation_loyalty_rewards%rowtype;
  v_row loyalty_ledger%rowtype;
begin
  -- At commit: the booking is still cancelled or a no-show, and still has an
  -- hour no closed bill used.
  select * into v_res from reservations where id = new.id;
  if not found or v_res.status not in ('cancelled', 'no_show') then
    return null;
  end if;
  select * into v_crw from reservation_loyalty_rewards where reservation_id = new.id;
  if v_crw.id is null or app.court_reward_closed(new.id) then
    return null;
  end if;
  perform set_config('app.venue_id', v_res.venue_id::text, true);
  select * into v_row from loyalty_ledger l
   where l.kind = 'reward' and l.source_kind = 'reservation_reward' and l.source_id = v_crw.id;
  if v_row.id is not null then
    perform 1 from loyalty_accounts a where a.profile_id = v_row.profile_id for update;
    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
    values (v_row.profile_id, v_row.venue_id, -v_row.delta, 'redeem_void', 'reservation_reward', v_crw.id,
            v_crw.tab_id, auth.uid())
    on conflict (kind, source_kind, source_id) do nothing;
  end if;
  delete from reservation_loyalty_rewards where id = v_crw.id;
  perform app.write_audit('loyalty.court_reward_back', 'reservation_loyalty_rewards', v_crw.id::text,
                          to_jsonb(v_crw), null, v_res.status::text, null);
  return null;
end $trg_loyalty_court_reward_back_0403$;

revoke all on function app.trg_loyalty_court_reward_back() from public, anon, authenticated;

comment on function app.trg_loyalty_court_reward_back() is
  '0403. Deferred AFTER UPDATE OF status on reservations, to cancelled or no_show: at commit, when the booking is still cancelled or a no-show and its free court hour (reservation_loyalty_rewards) was not used on a bill that closed (app.court_reward_closed), the points come back as (redeem_void, reservation_reward, the row id), once (loyalty_ledger_once), and the row goes. Audited loyalty.court_reward_back. Never raises for a booking with no free hour.';

drop trigger if exists reservations_loyalty_court_reward on public.reservations;
create constraint trigger reservations_loyalty_court_reward
  after update of status on public.reservations
  deferrable initially deferred
  for each row
  when (new.status in ('cancelled', 'no_show') and old.status is distinct from new.status)
  execute function app.trg_loyalty_court_reward_back();

-- ---------------------------------------------------------------------------
-- 11. The pages the new read belongs to (0384: blocked areas), as
--     loyalty_till_terms
-- ---------------------------------------------------------------------------

insert into app.access_area_rpcs (area, rpc) values
  ('customers', 'loyalty_court_reward'), ('desk', 'loyalty_court_reward'),
  ('shop', 'loyalty_court_reward'), ('till', 'loyalty_court_reward')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 12. The account merge knows the new link to profiles
-- ---------------------------------------------------------------------------

-- profile_merge_columns: re-issued from 20261024000368_customer_facts.sql:1597,
-- verbatim plus reservation_loyalty_rewards.profile_id (0403), a foreign key
-- to profiles: a merged member's free court hour follows them, like the
-- ledger row it spent.
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0403$
  select * from (values
    ( 10, 'public', 'tabs',                  'customer_id',           'repoint'),
    ( 20, 'public', 'reservations',          'guest_id',              'repoint'),
    ( 30, 'public', 'reservation_series',    'guest_id',              'repoint'),
    ( 40, 'public', 'guest_sessions',        'linked_profile_id',     'repoint'),
    ( 50, 'public', 'customer_notes',        'customer_id',           'repoint'),
    ( 60, 'public', 'promotion_redemptions', 'customer_id',           'repoint'),
    ( 70, 'public', 'matches',               'organiser_id',          'repoint'),
    ( 80, 'public', 'match_events',          'actor_guest_id',        'repoint'),
    ( 90, 'public', 'coaches',               'profile_id',            'repoint'),
    (100, 'public', 'courses',               'created_by_profile_id', 'repoint'),
    (110, 'public', 'lessons',               'created_by_profile_id', 'repoint'),
    (130, 'public', 'lesson_attendance',     'marked_by_profile_id',  'repoint'),
    (140, 'public', 'lesson_strikes',        'guest_id',              'repoint'),
    (150, 'public', 'lesson_events',         'actor_profile_id',      'repoint'),
    (160, 'public', 'loyalty_ledger',        'profile_id',            'repoint'),
    (170, 'public', 'match_ticket_events',   'guest_id',              'repoint'),
    (180, 'public', 'match_tickets',         'guest_id',              'repoint'),
    (190, 'public', 'notification_outbox',   'profile_id',            'repoint'),
    (200, 'public', 'reservation_court_discounts', 'customer_id',     'repoint'),
    (210, 'public', 'game_results',          'a1',                    'repoint'),
    (211, 'public', 'game_results',          'a2',                    'repoint'),
    (212, 'public', 'game_results',          'b1',                    'repoint'),
    (213, 'public', 'game_results',          'b2',                    'repoint'),
    (220, 'public', 'ranks_ledger',          'profile_id',            'repoint'),
    (230, 'public', 'profiles',              'level_confirmed_by',    'repoint'),
    (240, 'public', 'reservation_loyalty_rewards', 'profile_id',      'repoint'),   -- 0403
    (300, 'public', 'customer_flags',        'customer_id',           'rule'),
    (310, 'public', 'booking_payments',      'guest_id',              'rule'),
    (320, 'public', 'hold_standing',         'guest_id',              'rule'),
    (330, 'public', 'match_requests',        'guest_id',              'rule'),
    (340, 'public', 'match_seats',           'guest_id',              'rule'),
    (350, 'public', 'match_exclusions',      'guest_id',              'rule'),
    (360, 'public', 'match_blocks',          'blocker_id',            'rule'),
    (361, 'public', 'match_blocks',          'blocked_id',            'rule'),
    (370, 'public', 'match_reports',         'reporter_id',           'rule'),
    (371, 'public', 'match_reports',         'reported_id',           'rule'),
    (380, 'public', 'lesson_enrolments',     'guest_id',              'rule'),
    (381, 'public', 'lesson_enrolments',     'booked_by_profile_id',  'rule'),
    (390, 'public', 'tournament_entries',    'guest_id',              'rule'),
    (400, 'public', 'loyalty_cards',         'profile_id',            'rule'),
    (410, 'public', 'loyalty_accounts',      'profile_id',            'rule'),
    (420, 'public', 'username_holds',        'profile_id',            'drop_only'),
    (430, 'public', 'frame_grants',          'profile_id',            'rule'),
    (440, 'public', 'customer_discounts',    'customer_id',           'rule'),
    (500, 'auth',   'identities',            'user_id',               'auth'),
    (510, 'auth',   'sessions',              'user_id',               'signout'),
    (520, 'auth',   'one_time_tokens',       'user_id',               'signout'),
    (530, 'auth',   'mfa_factors',           'user_id',               'drop_only'),
    (540, 'auth',   'oauth_authorizations',  'user_id',               'drop_only'),
    (550, 'auth',   'oauth_consents',        'user_id',               'drop_only'),
    (560, 'auth',   'webauthn_credentials',  'user_id',               'drop_only'),
    (570, 'auth',   'webauthn_challenges',   'user_id',               'drop_only'),
    (600, 'public', 'staff',                 'id',                    'refuse'),
    (700, 'app',    'profile_merges',        'keep_id',               'record')
  ) as t (ord, sch, tbl, col, how)
  order by 1;
$profile_merge_columns_0403$;

comment on function app.profile_merge_columns() is
  '0303, 0307, username_holds since 0314, frame_grants since 0320, customer_discounts and reservation_court_discounts since 0347, game_results and ranks_ledger since 0364, profiles.level_confirmed_by since 0368, reservation_loyalty_rewards.profile_id since 0403. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;
