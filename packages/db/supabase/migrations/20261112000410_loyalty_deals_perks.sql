-- ===========================================================================
-- 0410 loyalty_deals_perks — deals in the app, and cards that give privileges
-- (Majed, 2026-11-12).
--
-- Majed's asks (2026-11-12):
--   * deals beside the points: "we're making a certain discount and everybody
--     can redeem it on the application", the way a fast-food app lists its
--     deals;
--   * the guest sees how many points are left to the next tier and what that
--     tier gives;
--   * a tier gives more than extra points: "every add-on to your drink, extra
--     shot, extra syrup, different milk ... free, if they are the highest
--     type of card", set by the owner on the operator, and shown so that
--     people want the next card.
--
-- 1. Deals. A deal is a promotion (0067) the owner lists in the app:
--    promotions.in_app, with an optional line for guests (app_blurb_en / _ar).
--    The guest reads them through app.my_deals and picks the one to use next
--    with app.pick_deal; the pick sits on their member card
--    (loyalty_cards.deal_promotion_id, deal_picked_at, deal_uses_before) for
--    24 hours or until a bill that carries it settles (the member's settled
--    uses of that deal pass the count taken at the pick). At the till nothing new is pressed: the
--    cashier scans the card (the tab's customer) and "Apply promotion"
--    (app.apply_best_promotion, unchanged) takes the picked deal first.
--    app.eligible_promotions is re-issued for that: a promotion that is not
--    automatic is also eligible, with no code, for the member who picked it,
--    and the picked deal sorts first. A promotion that is not automatic, has
--    no code and is listed is therefore an "in the app only" deal.
--    The owner lists a promotion with app.set_promotion_app (no change to
--    app.upsert_promotion or the price and promo protocol).
-- 2. Privileges. Table loyalty_tier_perks: what a tier gives beside its earn
--    multiplier. kind free_addons (paid add-ons are free: every add-on, or
--    the modifier groups named) or custom (a line the staff honour by hand:
--    "priority booking", "a free racket"). A card holds its own tier's
--    privileges and those of every tier below it. The owner writes them with
--    app.upsert_loyalty_tier_perk / app.delete_loyalty_tier_perk;
--    app.loyalty_admin lists them under each tier.
-- 3. Free add-ons on the bill. One tab_adjustments row per live line that
--    carries paid add-ons the member's card frees: kind discount_amount,
--    order_item_id the line, reason_code 'loyalty_tier_perk', amount the
--    add-ons' snapshot price (order_item_modifiers.price_delta_iqd * its qty
--    * the line's qty), never more than the line has left after its other
--    line discounts. authorized_by is the owner who made the privilege (the
--    0067 rule: the configuration is the authorisation). A line discount
--    stops counting when its line is voided (compute_tab_totals), so a void
--    never leaves the bill over-discounted. app.loyalty_perks_refresh brings
--    the rows in line with the bill (state-idempotent; the operator calls it
--    whenever a bill with a member changes, as it does for the customer
--    discount, 0342); app.loyalty_tab_benefits tells the till what the
--    member's card gives, the deal they picked, and whether a refresh would
--    change anything.
-- 4. The guest's view. app.my_loyalty also answers tiers: every tier in
--    order with its privileges and the listed deals it unlocks, so the phone
--    can show the way to the next card and what it gives; tier and next_tier
--    carry min_points_12m (app.loyalty_tier_json).
-- 5. The owner's assistant may read the three new promotions columns
--    (app.assistant_readable_columns), so it can say which deals are listed.
--
-- New: columns promotions.in_app, app_blurb_en, app_blurb_ar and
-- loyalty_cards.deal_promotion_id, deal_picked_at, deal_uses_before; table
-- loyalty_tier_perks; internals loyalty_tier_floor, loyalty_deal_uses,
-- loyalty_picked_deal, loyalty_perks_json, loyalty_ladder_json,
-- loyalty_perks_plan; RPCs my_deals, pick_deal, set_promotion_app,
-- upsert_loyalty_tier_perk, delete_loyalty_tier_perk, loyalty_tab_benefits,
-- loyalty_perks_refresh; error codes DEAL_UNAVAILABLE, DEAL_LOCKED, DEAL_USED.
-- Re-issued (each change marked "-- 0410"): eligible_promotions (0382),
-- loyalty_tier_json and loyalty_admin (0376), my_loyalty (0403).
--
-- Lock order: loyalty_perks_refresh takes tabs alone; set_promotion_app takes
-- its one promotions row; pick_deal writes the caller's loyalty_cards row
-- (not ranked).
--
-- covered by packages/db/tests/loyalty-deals-perks.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 1. Schema
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1.1 A promotion listed in the app
-- ---------------------------------------------------------------------------
alter table promotions add column if not exists in_app boolean not null default false;
alter table promotions add column if not exists app_blurb_en text;
alter table promotions add column if not exists app_blurb_ar text;

do $promotions_app_blurb_0410$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'promotions_app_blurb'
                    and conrelid = 'public.promotions'::regclass) then
    alter table promotions add constraint promotions_app_blurb check (
      (app_blurb_en is null) = (app_blurb_ar is null)
      and (app_blurb_en is null or char_length(app_blurb_en) between 1 and 160)
      and (app_blurb_ar is null or char_length(app_blurb_ar) between 1 and 160)) not valid;
  end if;
end $promotions_app_blurb_0410$;

do $promotions_app_blurb_validate_0410$
begin
  if exists (select 1 from pg_constraint
              where conname = 'promotions_app_blurb'
                and conrelid = 'public.promotions'::regclass
                and not convalidated) then
    alter table promotions validate constraint promotions_app_blurb;
  end if;
end $promotions_app_blurb_validate_0410$;

comment on column promotions.in_app is
  '0410. Listed as a deal in the guests'' app (app.my_deals). A listed promotion that is not automatic is also eligible, with no code, for the member who picked it (app.pick_deal). Written by app.set_promotion_app.';
comment on column promotions.app_blurb_en is
  '0410. The line guests read under a listed deal, English (1 to 160 characters; null with app_blurb_ar: the app shows what the promotion covers instead).';
comment on column promotions.app_blurb_ar is
  '0410. The line guests read under a listed deal, Arabic (set and cleared together with app_blurb_en).';

-- ---------------------------------------------------------------------------
-- 1.2 The deal a member picked, on their card
-- ---------------------------------------------------------------------------
alter table loyalty_cards add column if not exists deal_promotion_id uuid;
alter table loyalty_cards add column if not exists deal_picked_at timestamptz;
alter table loyalty_cards add column if not exists deal_uses_before int not null default 0;

do $loyalty_cards_deal_0410$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'loyalty_cards_deal_promotion_id_fkey'
                    and conrelid = 'public.loyalty_cards'::regclass) then
    alter table loyalty_cards add constraint loyalty_cards_deal_promotion_id_fkey
      foreign key (deal_promotion_id) references promotions(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'loyalty_cards_deal_pair'
                    and conrelid = 'public.loyalty_cards'::regclass) then
    alter table loyalty_cards add constraint loyalty_cards_deal_pair
      check (deal_promotion_id is null or deal_picked_at is not null) not valid;
  end if;
end $loyalty_cards_deal_0410$;

do $loyalty_cards_deal_validate_0410$
begin
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_cards_deal_promotion_id_fkey'
                and conrelid = 'public.loyalty_cards'::regclass
                and not convalidated) then
    alter table loyalty_cards validate constraint loyalty_cards_deal_promotion_id_fkey;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_cards_deal_pair'
                and conrelid = 'public.loyalty_cards'::regclass
                and not convalidated) then
    alter table loyalty_cards validate constraint loyalty_cards_deal_pair;
  end if;
end $loyalty_cards_deal_validate_0410$;

comment on column loyalty_cards.deal_promotion_id is
  '0410. The listed deal (promotions.in_app) the member picked to use next (app.pick_deal), or null. Live for 24 hours from deal_picked_at or until a bill of theirs that carries it settles (app.loyalty_picked_deal).';
comment on column loyalty_cards.deal_picked_at is
  '0410. When the member picked deal_promotion_id.';
comment on column loyalty_cards.deal_uses_before is
  '0410. How many settled bills of the member carried deal_promotion_id when they picked it. The pick is spent once that count has grown (app.loyalty_picked_deal), so one pick is one use.';

-- ---------------------------------------------------------------------------
-- 1.3 What a tier gives
-- ---------------------------------------------------------------------------
create table if not exists loyalty_tier_perks (
  id                 uuid primary key default gen_random_uuid(),
  tier_id            uuid not null references loyalty_tiers(id) on delete cascade,
  kind               text not null,
  name_en            text not null,
  name_ar            text not null,
  modifier_group_ids uuid[] not null default '{}',
  active             boolean not null default true,
  sort               smallint not null default 0,
  created_by         uuid not null references staff(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint loyalty_tier_perks_kind   check (kind in ('free_addons', 'custom')),
  constraint loyalty_tier_perks_names  check (char_length(name_en) between 1 and 80
                                              and char_length(name_ar) between 1 and 80),
  constraint loyalty_tier_perks_groups check (kind = 'free_addons' or cardinality(modifier_group_ids) = 0),
  constraint loyalty_tier_perks_groups_max check (cardinality(modifier_group_ids) <= 60)
);

comment on table loyalty_tier_perks is
  '0410. What a loyalty tier gives beside its earn multiplier, in the owner''s words (name_en, name_ar, 1 to 80 characters, read by guests). kind free_addons: paid add-ons are free on the member''s bills (modifier_group_ids: the modifier groups it frees, any branch; empty = every add-on), applied by app.loyalty_perks_refresh as line discounts with reason_code loyalty_tier_perk; kind custom: a privilege the staff honour by hand. A card holds its own tier''s privileges and those of every tier below (by min_points_12m). active false hides and stops one without deleting it. Owner-written through app.upsert_loyalty_tier_perk and app.delete_loyalty_tier_perk; read through app.loyalty_admin, app.my_loyalty and app.loyalty_tab_benefits. No client grant.';

alter table loyalty_tier_perks enable row level security;
revoke all on loyalty_tier_perks from anon, authenticated;
grant all on loyalty_tier_perks to service_role;

-- ===========================================================================
-- 2. Internals
-- ===========================================================================

-- The tier a profile holds, as its threshold (no account: the base tier, 0).
create or replace function app.loyalty_tier_floor(p_profile uuid) returns int
language sql stable security definer set search_path = public as $loyalty_tier_floor_0410$
  select coalesce((select t.min_points_12m
                     from loyalty_accounts a
                     join loyalty_tiers t on t.id = a.tier_id
                    where a.profile_id = p_profile), 0)
$loyalty_tier_floor_0410$;

comment on function app.loyalty_tier_floor(uuid) is
  '0410. Internal: the min_points_12m of the tier a profile holds (no account or no tier: 0, the base tier). A card holds every privilege of the tiers at or below it.';

revoke all on function app.loyalty_tier_floor(uuid) from public, anon, authenticated;

-- How many settled bills of a member carried a promotion.
create or replace function app.loyalty_deal_uses(p_profile uuid, p_promotion uuid) returns int
language sql stable security definer set search_path = public as $loyalty_deal_uses_0410$
  select count(*)::int
    from promotion_redemptions r
    join tabs t on t.id = r.tab_id
   where r.promotion_id = p_promotion and r.customer_id = p_profile and t.status = 'settled'
$loyalty_deal_uses_0410$;

comment on function app.loyalty_deal_uses(uuid, uuid) is
  '0410. Internal: how many settled bills of a member carried a promotion (promotion_redemptions rows of that member and promotion on settled tabs). app.pick_deal stores it at the pick and app.loyalty_picked_deal compares it, so one pick is one use.';

revoke all on function app.loyalty_deal_uses(uuid, uuid) from public, anon, authenticated;

-- The deal a member picked and has not used yet.
create or replace function app.loyalty_picked_deal(p_profile uuid) returns uuid
language sql stable security definer set search_path = public as $loyalty_picked_deal_0410$
  select c.deal_promotion_id
    from loyalty_cards c
   where c.profile_id = p_profile
     and c.deal_promotion_id is not null
     and c.deal_picked_at > now() - interval '24 hours'
     and app.loyalty_deal_uses(p_profile, c.deal_promotion_id) <= c.deal_uses_before
$loyalty_picked_deal_0410$;

comment on function app.loyalty_picked_deal(uuid) is
  '0410. Internal: the listed deal a member picked in the app (loyalty_cards.deal_promotion_id) while the pick is live: made in the last 24 hours, and no bill of theirs carrying it has settled since (app.loyalty_deal_uses still at most deal_uses_before). Null otherwise.';

revoke all on function app.loyalty_picked_deal(uuid) from public, anon, authenticated;

-- A tier's privileges. p_all: the owner's view (every row, with its groups,
-- its switch and its order); else what a guest reads (active ones only).
create or replace function app.loyalty_perks_json(p_tier uuid, p_all boolean default false) returns jsonb
language sql stable security definer set search_path = public as $loyalty_perks_json_0410$
  select coalesce(jsonb_agg(
           case when p_all then
             jsonb_build_object('id', k.id, 'tier_id', k.tier_id, 'kind', k.kind,
                                'name_en', k.name_en, 'name_ar', k.name_ar,
                                'modifier_group_ids', to_jsonb(k.modifier_group_ids),
                                'active', k.active, 'sort', k.sort)
           else
             jsonb_build_object('id', k.id, 'kind', k.kind, 'name_en', k.name_en, 'name_ar', k.name_ar)
           end
           order by k.sort, k.created_at, k.id), '[]'::jsonb)
    from loyalty_tier_perks k
   where k.tier_id = p_tier and (p_all or k.active)
$loyalty_perks_json_0410$;

comment on function app.loyalty_perks_json(uuid, boolean) is
  '0410. Internal: one tier''s privileges in order (sort, then age). p_all false: the active ones as a guest reads them [{id, kind, name_en, name_ar}]; true: every row for the owner [{id, tier_id, kind, name_en, name_ar, modifier_group_ids, active, sort}].';

revoke all on function app.loyalty_perks_json(uuid, boolean) from public, anon, authenticated;

-- Every tier, lowest first, with what it gives: the guest's ladder.
create or replace function app.loyalty_ladder_json() returns jsonb
language sql stable security definer set search_path = public as $loyalty_ladder_json_0410$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
           'multiplier', t.earn_multiplier, 'min_points_12m', t.min_points_12m, 'color', t.color,
           'perks', app.loyalty_perks_json(t.id, false),
           'deals', coalesce((
             select jsonb_agg(jsonb_build_object('id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar)
                              order by p.created_at, p.id)
               from promotions p
              where p.enabled and p.in_app and not p.code_single_use
                and (p.starts_at is null or p.starts_at <= now())
                and (p.ends_at is null or p.ends_at > now())
                and jsonb_typeof(p.limits->'tierMin') = 'string'
                and p.limits->>'tierMin' = t.id::text), '[]'::jsonb))
           order by t.min_points_12m, t.sort), '[]'::jsonb)
    from loyalty_tiers t
$loyalty_ladder_json_0410$;

comment on function app.loyalty_ladder_json() is
  '0410. Internal: every tier from the base up, [{id, name_en, name_ar, multiplier, min_points_12m, color, perks (its own active privileges: {id, kind, name_en, name_ar}), deals (the listed, running deals that open at this tier: {id, name_en, name_ar})}]. A card also holds what the tiers below it give.';

revoke all on function app.loyalty_ladder_json() from public, anon, authenticated;

-- The free add-ons a tab should carry right now: one row per live line.
create or replace function app.loyalty_perks_plan(p_tab_id uuid)
returns table (order_item_id uuid, amount_iqd bigint, authorized_by uuid)
language plpgsql stable security definer set search_path = public as $loyalty_perks_plan_0410$
declare
  v_customer uuid;
  v_floor    int;
  v_all      boolean;
  v_groups   uuid[];
  v_auth     uuid;
begin
  if not coalesce((select s.enabled from loyalty_settings s where s.id), false) then
    return;
  end if;
  v_customer := app.tab_customer(p_tab_id);
  if v_customer is null then
    return;
  end if;
  v_floor := app.loyalty_tier_floor(v_customer);

  -- The member's card: their tier's free add-ons and those of every tier below.
  select coalesce(bool_or(cardinality(k.modifier_group_ids) = 0), false),
         coalesce(array_agg(distinct g.id) filter (where g.id is not null), '{}'::uuid[]),
         (array_agg(k.created_by order by t.min_points_12m desc, k.sort, k.created_at, k.id))[1]
    into v_all, v_groups, v_auth
    from loyalty_tier_perks k
    join loyalty_tiers t on t.id = k.tier_id
    left join lateral unnest(k.modifier_group_ids) as g(id) on true
   where k.active and k.kind = 'free_addons' and t.min_points_12m <= v_floor;
  if v_auth is null then
    return;
  end if;

  return query
    select x.order_item_id, x.amount_iqd, v_auth
      from (
        select oi.id as order_item_id,
               least(sum(oim.price_delta_iqd::bigint * oim.qty) * oi.qty,
                     greatest(oi.line_total_iqd::bigint
                              - coalesce((select sum(a.amount_iqd)
                                            from tab_adjustments a
                                           where a.tab_id = p_tab_id and a.order_item_id = oi.id
                                             and a.kind in ('discount_percent', 'discount_amount')
                                             and a.reason_code <> 'loyalty_tier_perk'), 0), 0))::bigint as amount_iqd
          from orders o
          join order_items oi on oi.order_id = o.id
          join order_item_modifiers oim on oim.order_item_id = oi.id
          join modifiers m on m.id = oim.modifier_id
         where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
           and oim.price_delta_iqd > 0
           and (v_all or m.group_id = any(v_groups))
         group by oi.id, oi.qty, oi.line_total_iqd
      ) x
     where x.amount_iqd > 0;
end $loyalty_perks_plan_0410$;

comment on function app.loyalty_perks_plan(uuid) is
  '0410. Internal: the free add-ons a tab should carry now, one row per live line (order not voided, line not voided) with paid add-ons the tab customer''s card frees: amount_iqd = sum(order_item_modifiers.price_delta_iqd * qty) * the line''s qty over the freed modifier groups (every group when a privilege names none), never more than the line total less its other line discounts; authorized_by = who made the highest such privilege. No rows while loyalty is off, the tab has no customer (app.tab_customer) or their card (their tier and every tier below) has no active free_addons privilege.';

revoke all on function app.loyalty_perks_plan(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Promotions: a picked deal is eligible with no code, and goes first
-- ===========================================================================

-- eligible_promotions: re-issued from 20261101000382_branch_isolation.sql:605.
-- Changes marked 0410.
create or replace function app.eligible_promotions(p_tab_id uuid, p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $eligible_promotions_0410$
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
  if v_customer is not null then
    v_pick := app.loyalty_picked_deal(v_customer);
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
end $eligible_promotions_0410$;

comment on function app.eligible_promotions(uuid, text) is
  '0067, 0212, 0306, 0309, 0382, 0410. Cashier, manager, owner at the tab''s branch (VENUE_MISMATCH): the promotions that could apply to the tab right now, [{promotionId, name_en, name_ar, type, value, amountIqd, picked}]: enabled, of this branch or every branch, inside its dates, days and hours, automatic or named by p_code (CODE_INVALID for an unknown code) or, since 0410, a listed deal (in_app) the tab''s customer picked in the app (app.loyalty_picked_deal; no code needed), on its courts, within its total and per-customer limits (redemptions on other tabs), its tier (app.promotion_tier_ok) and its minimum spend; amountIqd is the discount on its base, at most what the other discounts leave (app.promotion_room_iqd), and a candidate below 1 is dropped. The picked deal sorts first, then the largest amount: app.apply_best_promotion takes the first.';

revoke all on function app.eligible_promotions(uuid, text) from public, anon;
grant execute on function app.eligible_promotions(uuid, text) to authenticated;

-- ===========================================================================
-- 4. The tier answers
-- ===========================================================================

-- loyalty_tier_json: re-issued from 20261031000376_loyalty_tier_colors.sql:61,
-- plus min_points_12m (0410).
create or replace function app.loyalty_tier_json(p_tier uuid) returns jsonb
language sql stable security definer set search_path = public as $loyalty_tier_json_0410$
  select jsonb_build_object('id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                            'multiplier', t.earn_multiplier,
                            'color', t.color,   -- 0376
                            'min_points_12m', t.min_points_12m)   -- 0410
    from loyalty_tiers t
   where t.id = coalesce(p_tier, (select b.id from loyalty_tiers b order by b.sort limit 1))
$loyalty_tier_json_0410$;

comment on function app.loyalty_tier_json(uuid) is
  '0305, 0376, 0410. Internal: a tier as an answer carries it, {id, name_en, name_ar, multiplier, color, min_points_12m (0410)}; a null id is the base tier.';

revoke all on function app.loyalty_tier_json(uuid) from public, anon, authenticated;

-- my_loyalty: re-issued from 20261105000403_loyalty_rewards_only.sql:707, plus
-- tiers (0410).
create or replace function app.my_loyalty() returns jsonb
language plpgsql stable security definer set search_path = public as $my_loyalty_0410$
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
    'tiers',             app.loyalty_ladder_json(),   -- 0410
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
end $my_loyalty_0410$;

comment on function app.my_loyalty() is
  'Loyalty (M3, contracts §1.3; 0308, 0376, 0403, 0410). The signed-in guest''s points: {enabled, balance, lifetime, points_12m, tier {id, name_en, name_ar, multiplier, color, min_points_12m} (the base tier without an account), next_tier (the same keys) | null, tiers (0410: every tier from the base up with what it gives, {id, name_en, name_ar, multiplier, min_points_12m, color, perks [{id, kind free_addons | custom, name_en, name_ar}], deals [{id, name_en, name_ar}] (listed deals that open at that tier)}; a card also holds what the tiers below it give), point_value_iqd, min_redeem_points, points_off_enabled (0403: false = points are not spent as money off; rewards only), history (50 newest LedgerRow; since 0308 the note only on reward and expire rows), rewards (every active one, any branch; kind iqd_off | item | court_hour)}. AUTH_REQUIRED without a session, ACCOUNT_REQUIRED for an anonymous session or a deleted account.';

revoke all on function app.my_loyalty() from public, anon;
grant execute on function app.my_loyalty() to authenticated;

-- loyalty_admin: re-issued from 20261031000376_loyalty_tier_colors.sql:120,
-- plus each tier's perks (0410).
create or replace function app.loyalty_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_admin_0410$
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'settings', app.loyalty_settings_json(),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                         'min_points_12m', t.min_points_12m, 'earn_multiplier', t.earn_multiplier,
                         'promotion_id', t.promotion_id, 'sort', t.sort,
                         'color', t.color,   -- 0376
                         'perks', app.loyalty_perks_json(t.id, true)) order by t.sort)   -- 0410
                         from loyalty_tiers t), '[]'::jsonb),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                           'cost_points', r.cost_points, 'kind', r.kind, 'iqd_off', r.iqd_off,
                           'menu_variant_id', r.menu_variant_id, 'active', r.active,
                           'venue_id', r.venue_id) order by r.active desc, r.cost_points, r.id)
                           from loyalty_rewards r), '[]'::jsonb));
end $loyalty_admin_0410$;

comment on function app.loyalty_admin() is
  'Loyalty (M3, contracts §1.3; 0376, 0410). Manager or owner: {settings (LoyaltySettings + updated_at), tiers (by sort, each with its color and, since 0410, perks: every privilege of the tier {id, tier_id, kind, name_en, name_ar, modifier_group_ids, active, sort}), rewards (active first)} for Setup > Loyalty.';

revoke all on function app.loyalty_admin() from public, anon;
grant execute on function app.loyalty_admin() to authenticated;

-- ===========================================================================
-- 5. The owner's writers
-- ===========================================================================

create or replace function app.upsert_loyalty_tier_perk(p_perk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $upsert_loyalty_tier_perk_0410$
declare
  v_id     uuid;
  v_tier   uuid;
  v_kind   text;
  v_groups uuid[];
  v_old    loyalty_tier_perks%rowtype;
  v_row    loyalty_tier_perks%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_perk is null or jsonb_typeof(p_perk) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_perk';
  end if;
  begin
    v_id := nullif(p_perk->>'id', '')::uuid;
    v_tier := nullif(p_perk->>'tier_id', '')::uuid;
    if p_perk ? 'modifier_group_ids' and jsonb_typeof(p_perk->'modifier_group_ids') = 'array' then
      v_groups := array(select distinct e::uuid
                          from jsonb_array_elements_text(p_perk->'modifier_group_ids') e
                         order by 1);
    end if;
    if v_id is not null then
      select * into v_old from loyalty_tier_perks where id = v_id for update;
      if not found then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'id';
      end if;
    elsif v_tier is null or not exists (select 1 from loyalty_tiers t where t.id = v_tier) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'tier_id';
    end if;
    if v_tier is not null and v_id is not null
       and not exists (select 1 from loyalty_tiers t where t.id = v_tier) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'tier_id';
    end if;
    v_kind := coalesce(nullif(p_perk->>'kind', ''), v_old.kind);
    if v_groups is not null and cardinality(v_groups) > 0
       and (select count(*) from modifier_groups g where g.id = any(v_groups)) <> cardinality(v_groups) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'modifier_group_ids';
    end if;
    -- A custom privilege frees nothing: it carries no groups.
    if v_kind = 'custom' then
      v_groups := '{}';
    end if;

    if v_id is not null then
      update loyalty_tier_perks
         set tier_id            = coalesce(v_tier, tier_id),
             kind               = v_kind,
             name_en            = coalesce(app.safe_line(p_perk->>'name_en'), name_en),
             name_ar            = coalesce(app.safe_line(p_perk->>'name_ar'), name_ar),
             modifier_group_ids = coalesce(v_groups, modifier_group_ids),
             active             = coalesce((p_perk->>'active')::boolean, active),
             sort               = coalesce((p_perk->>'sort')::smallint, sort),
             updated_at         = now()
       where id = v_id
      returning * into v_row;
    else
      insert into loyalty_tier_perks (tier_id, kind, name_en, name_ar, modifier_group_ids, active, sort, created_by)
      values (v_tier, v_kind, app.safe_line(p_perk->>'name_en'), app.safe_line(p_perk->>'name_ar'),
              coalesce(v_groups, '{}'), coalesce((p_perk->>'active')::boolean, true),
              coalesce((p_perk->>'sort')::smallint,
                       (select coalesce(max(k.sort), -1) + 1 from loyalty_tier_perks k where k.tier_id = v_tier)),
              auth.uid())
      returning * into v_row;
    end if;
  exception
    when raise_exception then raise;
    when others then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.write_audit('loyalty.perk', 'loyalty_tier_perks', v_row.id::text,
                          case when v_old.id is not null then to_jsonb(v_old) end, to_jsonb(v_row), null, null, null);
  return jsonb_build_object('id', v_row.id, 'tier_id', v_row.tier_id, 'kind', v_row.kind,
                            'name_en', v_row.name_en, 'name_ar', v_row.name_ar,
                            'modifier_group_ids', to_jsonb(v_row.modifier_group_ids),
                            'active', v_row.active, 'sort', v_row.sort);
end $upsert_loyalty_tier_perk_0410$;

comment on function app.upsert_loyalty_tier_perk(jsonb) is
  '0410. Owner: creates a tier privilege (no id; tier_id, kind and both names needed) or updates one (id; absent keys kept) from {id?, tier_id, kind (free_addons | custom), name_en, name_ar (1 to 80 characters, what guests read), modifier_group_ids (free_addons only: the modifier groups whose paid add-ons are free; empty or absent = every add-on; a custom privilege carries none), active, sort}. INVALID_ARGUMENT (p_perk, an unknown id, tier_id or modifier group), INVALID_VALUE (what the table refuses: an unknown kind, a missing or too long name). Bills pick the change up at their next refresh (app.loyalty_perks_refresh). Returns the privilege {id, tier_id, kind, name_en, name_ar, modifier_group_ids, active, sort}. Audited loyalty.perk.';

revoke all on function app.upsert_loyalty_tier_perk(jsonb) from public, anon;
grant execute on function app.upsert_loyalty_tier_perk(jsonb) to authenticated;

create or replace function app.delete_loyalty_tier_perk(p_perk_id uuid) returns void
language plpgsql security definer set search_path = public as $delete_loyalty_tier_perk_0410$
declare
  v_old loyalty_tier_perks%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  delete from loyalty_tier_perks where id = p_perk_id returning * into v_old;
  if v_old.id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_perk_id';
  end if;
  perform app.write_audit('loyalty.perk_delete', 'loyalty_tier_perks', v_old.id::text, to_jsonb(v_old), null, null, null, null);
end $delete_loyalty_tier_perk_0410$;

comment on function app.delete_loyalty_tier_perk(uuid) is
  '0410. Owner: removes one tier privilege (INVALID_ARGUMENT for an unknown id). Free add-ons already on open bills go at their next refresh; settled bills keep what they carried. Audited loyalty.perk_delete.';

revoke all on function app.delete_loyalty_tier_perk(uuid) from public, anon;
grant execute on function app.delete_loyalty_tier_perk(uuid) to authenticated;

create or replace function app.set_promotion_app(
  p_id       uuid,
  p_in_app   boolean,
  p_blurb_en text default null,
  p_blurb_ar text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_promotion_app_0410$
declare
  v_old promotions%rowtype;
  v_row promotions%rowtype;
  v_en  text := nullif(btrim(coalesce(app.safe_line(p_blurb_en), '')), '');
  v_ar  text := nullif(btrim(coalesce(app.safe_line(p_blurb_ar), '')), '');
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_id is null or p_in_app is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_in_app';
  end if;
  if (v_en is null) <> (v_ar is null) then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001', hint = 'both lines, English and Arabic, or neither';
  end if;
  if char_length(coalesce(v_en, '')) > 160 or char_length(coalesce(v_ar, '')) > 160 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'promotion.app_blurb';
  end if;

  select * into v_old from promotions where id = p_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- A single-use code is one voucher for one bill, not a deal for everybody.
  if p_in_app and v_old.code_single_use then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'code_single_use';
  end if;

  update promotions
     set in_app = p_in_app, app_blurb_en = v_en, app_blurb_ar = v_ar, updated_at = now()
   where id = p_id
  returning * into v_row;

  perform app.write_audit('promotion.app', 'promotions', v_row.id::text,
    jsonb_build_object('in_app', v_old.in_app, 'app_blurb_en', v_old.app_blurb_en, 'app_blurb_ar', v_old.app_blurb_ar),
    jsonb_build_object('in_app', v_row.in_app, 'app_blurb_en', v_row.app_blurb_en, 'app_blurb_ar', v_row.app_blurb_ar),
    null, null, null);
  return jsonb_build_object('id', v_row.id, 'in_app', v_row.in_app,
                            'app_blurb_en', v_row.app_blurb_en, 'app_blurb_ar', v_row.app_blurb_ar);
end $set_promotion_app_0410$;

comment on function app.set_promotion_app(uuid, boolean, text, text) is
  '0410. Owner: lists a promotion as a deal in the guests'' app, or takes it off (p_in_app), with the line guests read under it (p_blurb_en and p_blurb_ar, both or neither, up to 160 characters; NAME_REQUIRED, TEXT_TOO_LONG). PROMOTION_NOT_FOUND; a promotion whose code is single-use cannot be listed (INVALID_VALUE detail code_single_use). A listed promotion that is not automatic applies, with no code, for the member who picked it (app.pick_deal). Returns {id, in_app, app_blurb_en, app_blurb_ar}. Audited promotion.app.';

revoke all on function app.set_promotion_app(uuid, boolean, text, text) from public, anon;
grant execute on function app.set_promotion_app(uuid, boolean, text, text) to authenticated;

-- ===========================================================================
-- 6. The guest: deals
-- ===========================================================================

create or replace function app.my_deals() returns jsonb
language plpgsql stable security definer set search_path = public as $my_deals_0410$
declare
  v_me    uuid := app.loyalty_me();
  v_pick  uuid := app.loyalty_picked_deal(v_me);
  v_until timestamptz;
  v_tz    text;
  v_deals jsonb;
begin
  if v_pick is not null then
    select c.deal_picked_at + interval '24 hours' into v_until from loyalty_cards c where c.profile_id = v_me;
  end if;
  -- A chain-wide deal's days and hours are read in the first open branch's time.
  select vs.timezone into v_tz
    from venues v join venue_settings vs on vs.venue_id = v.id
   where v.is_active
   order by v.created_at, v.id
   limit 1;

  select coalesce(jsonb_agg(d.j order by d.rank, d.ends_at nulls last, d.created_at, d.id), '[]'::jsonb)
    into v_deals
    from (
      select p.id, p.ends_at, p.created_at,
             case when p.id = v_pick then 0 when s.state = 'open' then 1 when s.state = 'locked' then 2 else 3 end as rank,
             jsonb_build_object(
               'id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
               'blurb_en', p.app_blurb_en, 'blurb_ar', p.app_blurb_ar,
               'type', p.type, 'value', p.value,
               'ends_at', p.ends_at,
               'weekdays', to_jsonb(p.weekdays),
               'hour_from', to_char(p.hour_from, 'HH24:MI'),
               'hour_to', to_char(p.hour_to, 'HH24:MI'),
               'live_now', (coalesce(array_length(p.weekdays, 1), 0) = 0 or extract(dow from l.at)::int = any(p.weekdays))
                           and (p.hour_from is null
                                or (p.hour_from < p.hour_to and l.at::time >= p.hour_from and l.at::time < p.hour_to)
                                or (p.hour_from > p.hour_to and (l.at::time >= p.hour_from or l.at::time < p.hour_to))),
               'min_spend_iqd', (p.limits->>'minSpendIqd')::bigint,
               'per_customer', (p.limits->>'perCustomer')::int,
               'used', u.used,
               'tier', (select jsonb_build_object('id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                                                  'color', t.color, 'min_points_12m', t.min_points_12m)
                          from loyalty_tiers t
                         where jsonb_typeof(p.limits->'tierMin') = 'string' and t.id::text = p.limits->>'tierMin'),
               'state', s.state,
               'picked', coalesce(p.id = v_pick, false),
               'venue_id', p.venue_id,
               'on', jsonb_build_object(
                 'items', coalesce((select jsonb_agg(jsonb_build_object('name_en', mi.name_en, 'name_ar', mi.name_ar)
                                                     order by mi.name_en)
                                      from menu_items mi
                                     where jsonb_typeof(p.scope->'itemIds') = 'array'
                                       and (p.scope->'itemIds') ? mi.id::text), '[]'::jsonb),
                 'categories', coalesce((select jsonb_agg(jsonb_build_object('name_en', mc.name_en, 'name_ar', mc.name_ar)
                                                          order by mc.name_en)
                                           from menu_categories mc
                                          where jsonb_typeof(p.scope->'categoryIds') = 'array'
                                            and (p.scope->'categoryIds') ? mc.id::text), '[]'::jsonb),
                 'courts', coalesce(jsonb_typeof(p.scope->'courtIds') = 'array'
                                    and jsonb_array_length(p.scope->'courtIds') > 0, false))
             ) as j
        from promotions p
        cross join lateral (
          select now() at time zone coalesce(
                   (select vs.timezone from venue_settings vs where vs.venue_id = p.venue_id), v_tz, 'Asia/Baghdad') as at
        ) l
        cross join lateral (
          select count(*)::int as used
            from promotion_redemptions r
           where r.promotion_id = p.id and r.customer_id = v_me
        ) u
        cross join lateral (
          select case when not app.promotion_tier_ok(p.limits, v_me) then 'locked'
                      when (p.limits->>'perCustomer') is not null
                           and u.used >= (p.limits->>'perCustomer')::int then 'used'
                      else 'open' end as state
        ) s
       where p.enabled and p.in_app and not p.code_single_use
         and (p.starts_at is null or p.starts_at <= now())
         and (p.ends_at is null or p.ends_at > now())
         and (p.venue_id is null or exists (select 1 from venues v where v.id = p.venue_id and v.is_active))
         -- A deal whose total uses are spent is gone for everybody.
         and ((p.limits->>'total') is null
              or (select count(*) from promotion_redemptions r where r.promotion_id = p.id) < (p.limits->>'total')::bigint)
    ) d;

  return jsonb_build_object('picked_id', v_pick, 'picked_until', v_until, 'deals', v_deals);
end $my_deals_0410$;

comment on function app.my_deals() is
  '0410. The signed-in guest''s deals: {picked_id (the deal they picked to use next, while the pick is live) | null, picked_until, deals [{id, name_en, name_ar, blurb_en, blurb_ar (the owner''s line, or null), type percent | amount, value, ends_at, weekdays (0 = Sunday; empty = every day), hour_from, hour_to (HH:MM or null), live_now (inside its days and hours in the branch''s time), min_spend_iqd, per_customer, used (their own redemptions), tier {id, name_en, name_ar, color, min_points_12m} | null (the card it needs), state open | locked (their card is below its tier) | used (their uses are spent), picked, venue_id (null = every branch), on {items, categories ([{name_en, name_ar}]; both empty = the whole café bill), courts}}]}: every enabled promotion listed in the app (promotions.in_app) that has started, has not ended, is not a single-use code and has total uses left; the picked one first, then open, locked, used. AUTH_REQUIRED without a session, ACCOUNT_REQUIRED for an anonymous session or a deleted account. Read-only.';

revoke all on function app.my_deals() from public, anon;
grant execute on function app.my_deals() to authenticated;

create or replace function app.pick_deal(p_promotion_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $pick_deal_0410$
declare
  v_me   uuid := app.loyalty_me();
  v_p    promotions%rowtype;
  v_used bigint;
begin
  if p_promotion_id is null then
    update loyalty_cards set deal_promotion_id = null, deal_picked_at = null, deal_uses_before = 0
     where profile_id = v_me and deal_promotion_id is not null;
    return app.my_deals();
  end if;

  select * into v_p from promotions p
   where p.id = p_promotion_id and p.enabled and p.in_app and not p.code_single_use
     and (p.starts_at is null or p.starts_at <= now())
     and (p.ends_at is null or p.ends_at > now());
  if not found
     or ((v_p.limits->>'total') is not null
         and (select count(*) from promotion_redemptions r where r.promotion_id = v_p.id) >= (v_p.limits->>'total')::bigint) then
    raise exception 'DEAL_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if not app.promotion_tier_ok(v_p.limits, v_me) then
    raise exception 'DEAL_LOCKED' using errcode = 'P0001';
  end if;
  if (v_p.limits->>'perCustomer') is not null then
    select count(*) into v_used from promotion_redemptions r
     where r.promotion_id = v_p.id and r.customer_id = v_me;
    if v_used >= (v_p.limits->>'perCustomer')::bigint then
      raise exception 'DEAL_USED' using errcode = 'P0001';
    end if;
  end if;

  perform app.loyalty_card_ensure(v_me);
  update loyalty_cards
     set deal_promotion_id = v_p.id, deal_picked_at = now(),
         deal_uses_before = app.loyalty_deal_uses(v_me, v_p.id)
   where profile_id = v_me;
  return app.my_deals();
end $pick_deal_0410$;

comment on function app.pick_deal(uuid) is
  '0410. The signed-in guest picks the listed deal to use next (one at a time; picking another replaces it; null clears it). The pick sits on their member card for 24 hours or until a bill that carries it settles: the cashier scans the card and Apply promotion takes it first (app.eligible_promotions). DEAL_UNAVAILABLE (unknown, switched off, not listed, not started, ended, or its total uses spent), DEAL_LOCKED (their card is below the deal''s tier), DEAL_USED (their own uses are spent). Creates the member card when there is none. Returns app.my_deals(). AUTH_REQUIRED, ACCOUNT_REQUIRED as app.my_loyalty.';

revoke all on function app.pick_deal(uuid) from public, anon;
grant execute on function app.pick_deal(uuid) to authenticated;

-- ===========================================================================
-- 7. The till: what the member's card gives on this bill
-- ===========================================================================

create or replace function app.loyalty_tab_benefits(p_tab_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_tab_benefits_0410$
declare
  v_tab      tabs%rowtype;
  v_customer uuid;
  v_enabled  boolean;
  v_floor    int;
  v_tier     uuid;
  v_pick     uuid;
  v_on_bill  bigint;
  v_due      bigint;
  v_differs  boolean;
  v_open     boolean;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_tab.venue_id, 'court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  v_enabled := coalesce((select s.enabled from loyalty_settings s where s.id), false);
  v_customer := app.tab_customer(p_tab_id);
  v_open := v_tab.status in ('open', 'awaiting_payment') and v_tab.merged_into_tab_id is null;

  select coalesce(sum(a.amount_iqd), 0) into v_on_bill
    from tab_adjustments a
    join order_items oi on oi.id = a.order_item_id
    join orders o on o.id = oi.order_id
   where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk'
     and o.status <> 'voided' and not oi.voided;

  if v_customer is null then
    return jsonb_build_object('tab_id', p_tab_id, 'customer_id', null, 'enabled', v_enabled,
      'tier', null, 'perks', '[]'::jsonb,
      'addons', jsonb_build_object('on_bill_iqd', v_on_bill, 'due_iqd', 0,
                                   'needs_refresh', v_open and exists (
                                     select 1 from tab_adjustments a
                                      where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk')),
      'deal', null);
  end if;

  v_floor := app.loyalty_tier_floor(v_customer);
  select a.tier_id into v_tier from loyalty_accounts a where a.profile_id = v_customer;
  v_pick := app.loyalty_picked_deal(v_customer);

  select coalesce(sum(pl.amount_iqd), 0) into v_due from app.loyalty_perks_plan(p_tab_id) pl;
  v_differs := exists (
      (select a.order_item_id, a.amount_iqd::bigint from tab_adjustments a
        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk')
      except
      (select pl.order_item_id, pl.amount_iqd from app.loyalty_perks_plan(p_tab_id) pl))
    or exists (
      (select pl.order_item_id, pl.amount_iqd from app.loyalty_perks_plan(p_tab_id) pl)
      except
      (select a.order_item_id, a.amount_iqd::bigint from tab_adjustments a
        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk'));

  return jsonb_build_object(
    'tab_id', p_tab_id,
    'customer_id', v_customer,
    'enabled', v_enabled,
    'tier', app.loyalty_tier_json(v_tier),
    'perks', case when not v_enabled then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'kind', k.kind, 'name_en', k.name_en, 'name_ar', k.name_ar,
               'tier_id', t.id, 'tier_name_en', t.name_en, 'tier_name_ar', t.name_ar, 'tier_color', t.color)
               order by t.min_points_12m desc, k.sort, k.created_at, k.id)
        from loyalty_tier_perks k
        join loyalty_tiers t on t.id = k.tier_id
       where k.active and t.min_points_12m <= v_floor), '[]'::jsonb) end,
    'addons', jsonb_build_object('on_bill_iqd', v_on_bill, 'due_iqd', v_due,
                                 'needs_refresh', v_open and v_differs),
    'deal', (select jsonb_build_object(
                      'promotion_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
                      'type', p.type, 'value', p.value,
                      'applied', exists (select 1 from tab_adjustments a
                                          where a.tab_id = p_tab_id and a.promotion_id = p.id))
               from promotions p
              where p.id = v_pick and p.enabled and p.in_app
                and (p.venue_id is null or p.venue_id = v_tab.venue_id)));
end $loyalty_tab_benefits_0410$;

comment on function app.loyalty_tab_benefits(uuid) is
  '0410. court_desk, cashier, shop_staff, manager, owner at the tab''s branch (TAB_NOT_FOUND, VENUE_MISMATCH): what the tab customer''s card gives on this bill. {tab_id, customer_id (app.tab_customer) | null, enabled (the loyalty switch), tier {id, name_en, name_ar, multiplier, color, min_points_12m} | null, perks (every active privilege of their tier and the tiers below, highest tier first: {id, kind free_addons | custom, name_en, name_ar, tier_id, tier_name_en, tier_name_ar, tier_color}; empty while loyalty is off), addons {on_bill_iqd (the free add-ons on the bill''s live lines now), due_iqd (what they should come to, app.loyalty_perks_plan), needs_refresh (an open bill whose rows differ from the plan: app.loyalty_perks_refresh would change something)}, deal (the listed deal the member picked in the app, when it runs at this branch: {promotion_id, name_en, name_ar, type, value, applied (it is the promotion on this bill)}) | null}. Read-only.';

revoke all on function app.loyalty_tab_benefits(uuid) from public, anon;
grant execute on function app.loyalty_tab_benefits(uuid) to authenticated;

create or replace function app.loyalty_perks_refresh(p_tab_id uuid, p_device_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_perks_refresh_0410$
declare
  v_venue   uuid;
  v_tab     tabs%rowtype;
  v_old_n   int;
  v_old_sum bigint;
  v_new_n   int;
  v_new_sum bigint;
  v_differs boolean;
  v_paid    bigint;
  v_total   bigint;
  v_plan    jsonb;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);

  select count(*), coalesce(sum(a.amount_iqd), 0) into v_old_n, v_old_sum
    from tab_adjustments a
   where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk';

  -- A closed or merged bill keeps what it carried: nothing to refresh.
  if v_tab.merged_into_tab_id is not null or v_tab.status not in ('open', 'awaiting_payment') then
    return jsonb_build_object('changed', false, 'amount_iqd', v_old_sum, 'lines', v_old_n);
  end if;

  -- The plan is read once and held, so the comparison, the delete and the
  -- insert all see the same rows.
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id', pl.order_item_id, 'amount_iqd', pl.amount_iqd,
                                               'authorized_by', pl.authorized_by)), '[]'::jsonb)
    into v_plan
    from app.loyalty_perks_plan(p_tab_id) pl;

  select count(*), coalesce(sum(pl.amount_iqd), 0) into v_new_n, v_new_sum
    from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid);
  v_differs := exists (
      (select a.order_item_id, a.amount_iqd::bigint from tab_adjustments a
        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk')
      except
      (select pl.order_item_id, pl.amount_iqd from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid)))
    or exists (
      (select pl.order_item_id, pl.amount_iqd from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid))
      except
      (select a.order_item_id, a.amount_iqd::bigint from tab_adjustments a
        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk'));
  if not v_differs then
    return jsonb_build_object('changed', false, 'amount_iqd', v_old_sum, 'lines', v_old_n);
  end if;

  -- A subtransaction: when the guard below refuses, the rows go back as they
  -- were and the refusal is answered as data, so a bill's automatic refresh
  -- never shows anyone an error (the 0342 shape).
  begin
    delete from tab_adjustments a
     where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk'
       and not exists (select 1 from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid)
                        where pl.order_item_id = a.order_item_id and pl.amount_iqd = a.amount_iqd);
    insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                                 applied_by, authorized_by, reason_code)
    select p_tab_id, pl.order_item_id, 'discount_amount'::adjustment_kind, pl.amount_iqd::int, pl.amount_iqd,
           auth.uid(), pl.authorized_by, 'loyalty_tier_perk'
      from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid)
     where not exists (select 1 from tab_adjustments a
                        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk'
                          and a.order_item_id = pl.order_item_id);

    -- DISCOUNT-AFTER-PAYMENT GUARD (0037), the apply_discount shape.
    v_paid := app.tab_net_paid(p_tab_id);
    if v_paid > 0 then
      select t.total_iqd into v_total from app.compute_tab_totals(p_tab_id) t;
      if v_total < v_paid then
        raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
          detail = format('paid %s, post-discount total %s', v_paid, v_total);
      end if;
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'DISCOUNT_REQUIRES_REFUND' then
      return jsonb_build_object('changed', false, 'amount_iqd', v_old_sum, 'lines', v_old_n,
                                'refused', 'DISCOUNT_REQUIRES_REFUND');
    end if;
    raise;
  end;

  perform app.write_audit('loyalty.perks_apply', 'tabs', p_tab_id::text,
                          jsonb_build_object('lines', v_old_n, 'amount_iqd', v_old_sum),
                          jsonb_build_object('lines', v_new_n, 'amount_iqd', v_new_sum,
                                             'customer_id', app.tab_customer(p_tab_id)),
                          'loyalty_tier_perk',
                          (select pl.authorized_by from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid) limit 1),
                          p_device_id);
  return jsonb_build_object('changed', true, 'amount_iqd', v_new_sum, 'lines', v_new_n);
end $loyalty_perks_refresh_0410$;

comment on function app.loyalty_perks_refresh(uuid, text) is
  '0410. court_desk, cashier, shop_staff, manager, owner at the tab''s branch, the tab''s kind for the role (TAB_KIND_FORBIDDEN), no PIN: brings the free add-ons of the tab customer''s card in line with the bill (TAB_NOT_FOUND, VENUE_MISMATCH). One tab_adjustments line discount per live line with freed paid add-ons (app.loyalty_perks_plan): kind discount_amount, reason_code loyalty_tier_perk, applied_by the caller, authorized_by the owner who made the privilege; rows that no longer match (the member taken off, their tier changed, a privilege switched off, a line voided) go. State-idempotent: a refresh that changes nothing writes nothing, and a settled, void or merged bill is left as it is. 0037 guard: on a part-paid bill a change that would take the total below what was paid is not made and is answered {refused: DISCOUNT_REQUIRES_REFUND}. Returns {changed, amount_iqd, lines, refused?}. Audited loyalty.perks_apply when it changes something.';

revoke all on function app.loyalty_perks_refresh(uuid, text) from public, anon;
grant execute on function app.loyalty_perks_refresh(uuid, text) to authenticated;

-- ===========================================================================
-- 8. The owner's assistant reads which promotions are listed in the app
-- ===========================================================================
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select 'promotions', c.column_name, 'table', true, c.data_type, c.ordinal_position,
       col_description('public.promotions'::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'promotions'
   and c.column_name in ('in_app', 'app_blurb_en', 'app_blurb_ar')
on conflict (table_name, column_name) do nothing;
