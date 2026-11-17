set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0445 loyalty_card_gifts — what the Green and Blue cards give (Majed,
-- 2026-11-14, approved):
--   Green (250 points): a free drink on the birthday, and a premium profile
--     ring.
--   Blue (1,000 points): free add-ons, the drink card full after 6 instead of
--     the standard 8, a free tea or water with any dessert at all times, and
--     a drink AND a dessert on the birthday.
-- His standing rule: every card privilege is something the owner can set up
-- again in the operator; where the operator could not, make it able to.
-- Thresholds and the free add-ons need no build (loyalty_tiers, 0410).
-- Approved the same day from the suggestions: a card-up gift (a free drink
-- on reaching a card), a free drink every month for Black, a free size
-- upgrade, Black's drink card full at 5 and a free court hour on a Black
-- birthday (a stamp_size privilege and a court_hour gift: no extra build),
-- Black at 3,000 points (a threshold).
--
-- 1. loyalty_tier_perks gains config (jsonb object) and five kinds beside
--    free_addons and custom (app.upsert_loyalty_tier_perk checks the shape):
--      gift        {when: birthday | monthly | card_up, target: items |
--                   court_hour, categoryIds, itemIds, days}: once per window
--                   (birthday: from the birthday in the branch's time zone,
--                   `days` 1..31, default 7; monthly: the calendar month;
--                   card_up: from the day the member moved up to THIS card,
--                   only while they hold it, `days` 1..90, default 30). Target
--                   items frees one unit of the dearest matching line; target
--                   court_hour frees one hour of the court fee of the plain
--                   booking the bill belongs to (reservation_card_gifts, read
--                   by court_fee_remaining through app.court_reward_iqd). A
--                   birthday gift needs the birth date set 30 days before the
--                   window opens (profiles.birth_date_set_at), so a guest
--                   cannot move it onto today. A card holds the lower cards'
--                   gifts too (Blue = Green's drink + its own dessert), except
--                   card_up gifts, which belong to the card reached
--                   (loyalty_accounts.tier_up_at).
--      size_upgrade {categoryIds, itemIds}: a matching line is charged the
--                   next size down (its variant's price less the item's next
--                   cheaper variant), on every unit still paid.
--      free_with   {triggerCategoryIds, triggerItemIds, freeCategoryIds,
--                   freeItemIds}: for every unit of a trigger line on the bill,
--                   one unit of a free line is free (the dearest first).
--      frame       {frameId: card-green | card-blue | card-black}: the card
--                   unlocks that profile ring (app.frame_unlocked). Losing the
--                   card, or the owner taking the privilege away, puts a
--                   wearer back on brand-green.
--      stamp_size  {size 2..20}: the member's drink card fills at this many
--                   stamps instead of the club's standard (the lowest wins).
-- 2. The drink card (new): table loyalty_stamp_card (one row: enabled, size
--    default 8, the stamping category_ids and excluded_item_ids), owner-set
--    through app.set_stamp_card, read through app.stamp_card_settings. Ledger
--    loyalty_stamps (earn | redeem, one of each per tab at most). A settled
--    bill of a member (deferred trigger tabs_loyalty_stamps, beside
--    tabs_loyalty_earn) stamps every PAID unit of a stamping line (a unit a
--    card privilege freed does not stamp) and spends the stamps of a free
--    drink it carried. A full card frees the dearest stamping unit on the
--    member's next bill a till opens, once per bill.
-- 3. One engine for the bill: app.loyalty_perks_detail(tab) says, line by
--    line, what the card frees and why (stamp, gift, free_with, free_addons,
--    in that order; a unit is freed once, add-ons only on units still paid).
--    app.loyalty_perks_plan (0410 no longer) sums it per line, capped at what
--    the line has left, so the tab_adjustments rows stay one per line,
--    reason_code loyalty_tier_perk, exactly as 0410 writes them.
--    app.loyalty_perks_refresh (0410 no longer) also keeps
--    loyalty_perk_lines, the detail of what a bill carries, in step: it is
--    how a gift is known to be used (or held by another open bill), and how
--    the settle trigger knows a free drink was taken.
-- 4. Reads: app.my_card_extras() for the guest (the drink card and the
--    birthday gifts), app.loyalty_card_extras(p_profile_id) for desk and till
--    staff (no birth date in it). app.loyalty_perks_json (0410 no longer)
--    carries config; app.loyalty_tab_benefits (0410 no longer) carries each
--    privilege's config.
-- 5. Profile rings: three card frames join the closed list
--    (profiles_avatar_frame_chk, app.frame_ids), app.frame_unlocked and
--    app.my_frames (0318 no longer; my_frames also names the card that
--    unlocks a card frame); trigger loyalty_accounts_card_frame.
-- 6. profiles.birth_date_set_at (backfilled with created_at where a date is
--    already set); app.set_my_birth_date (0302 no longer) stamps it whenever
--    the date changes.
--
-- Lock order: refresh takes tabs alone (unchanged); the settle trigger writes
-- loyalty_stamps without locking a ranked row; the frame resets update
-- profiles rows only.
-- Covered by packages/db/tests/loyalty-card-gifts.test.ts.
-- ===========================================================================

-- ===========================================================================
-- 1. Tables and columns
-- ===========================================================================

alter table loyalty_tier_perks add column if not exists config jsonb not null default '{}'::jsonb;

do $loyalty_tier_perks_kind_0445$
begin
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_tier_perks_kind'
                and conrelid = 'public.loyalty_tier_perks'::regclass
                and pg_get_constraintdef(oid) not like '%size_upgrade%') then
    alter table loyalty_tier_perks drop constraint loyalty_tier_perks_kind;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'loyalty_tier_perks_kind'
                    and conrelid = 'public.loyalty_tier_perks'::regclass) then
    alter table loyalty_tier_perks add constraint loyalty_tier_perks_kind
      check (kind in ('free_addons', 'custom', 'gift', 'free_with', 'frame', 'stamp_size', 'size_upgrade')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'loyalty_tier_perks_config'
                    and conrelid = 'public.loyalty_tier_perks'::regclass) then
    alter table loyalty_tier_perks add constraint loyalty_tier_perks_config
      check (jsonb_typeof(config) = 'object') not valid;
  end if;
end $loyalty_tier_perks_kind_0445$;

do $loyalty_tier_perks_validate_0445$
begin
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_tier_perks_kind'
                and conrelid = 'public.loyalty_tier_perks'::regclass and not convalidated) then
    alter table loyalty_tier_perks validate constraint loyalty_tier_perks_kind;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_tier_perks_config'
                and conrelid = 'public.loyalty_tier_perks'::regclass and not convalidated) then
    alter table loyalty_tier_perks validate constraint loyalty_tier_perks_config;
  end if;
end $loyalty_tier_perks_validate_0445$;

comment on column loyalty_tier_perks.config is
  '0445. The privilege''s settings, by kind: gift {when birthday | monthly | card_up, target items | court_hour, categoryIds, itemIds, days}; size_upgrade {categoryIds, itemIds}; free_with {triggerCategoryIds, triggerItemIds, freeCategoryIds, freeItemIds}; frame {frameId}; stamp_size {size}; {} for free_addons and custom. Checked by app.upsert_loyalty_tier_perk.';

-- Birth date stamp
alter table profiles add column if not exists birth_date_set_at timestamptz;

update profiles set birth_date_set_at = created_at
 where birth_date is not null and birth_date_set_at is null;

comment on column profiles.birth_date_set_at is
  '0445. When birth_date last changed (app.set_my_birth_date). A birthday gift needs it 30 days before the window opens, so a date moved onto today gives nothing. Backfilled with created_at for dates set before 0445. No column grant.';

-- The drink card
create table if not exists loyalty_stamp_card (
  id                boolean primary key default true,
  enabled           boolean not null default false,
  size              smallint not null default 8,
  category_ids      uuid[] not null default '{}',
  excluded_item_ids uuid[] not null default '{}',
  updated_at        timestamptz not null default now(),
  updated_by        uuid references staff(id),
  constraint loyalty_stamp_card_one  check (id),
  constraint loyalty_stamp_card_size check (size between 2 and 20),
  constraint loyalty_stamp_card_max  check (cardinality(category_ids) <= 100 and cardinality(excluded_item_ids) <= 300)
);

comment on table loyalty_stamp_card is
  '0445. The drink card, one row: enabled (off until the owner turns it on), size (stamps to a free drink, the club standard; a stamp_size privilege lowers it for a card), category_ids (the menu categories whose items stamp), excluded_item_ids (items in them that never stamp: water, tea, a plain espresso shot). Written by app.set_stamp_card (owner), read by app.stamp_card_settings. No client grant.';

insert into loyalty_stamp_card (id) values (true) on conflict (id) do nothing;

alter table loyalty_stamp_card enable row level security;
revoke all on loyalty_stamp_card from anon, authenticated;
grant all on loyalty_stamp_card to service_role;

create table if not exists loyalty_stamps (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  tab_id     uuid references tabs(id) on delete set null,
  kind       text not null,
  delta      int not null,
  created_at timestamptz not null default now(),
  constraint loyalty_stamps_kind check (kind in ('earn', 'redeem')),
  constraint loyalty_stamps_sign check ((kind = 'earn') = (delta > 0)),
  constraint loyalty_stamps_once unique (kind, tab_id)
);

comment on table loyalty_stamps is
  '0445. The drink card ledger: one earn row (the paid stamping units) and at most one redeem row (minus the stamps a free drink spent) per settled tab, written by the deferred trigger tabs_loyalty_stamps. A member''s stamps = the sum of delta. No client grant; read through app.my_card_extras and app.loyalty_card_extras.';

alter table loyalty_stamps enable row level security;
revoke all on loyalty_stamps from anon, authenticated;
grant all on loyalty_stamps to service_role;

drop trigger if exists zz_branch_guard on public.loyalty_stamps;
create trigger zz_branch_guard before insert or update or delete on public.loyalty_stamps
  for each row execute function app.trg_branch_guard('child', 'tabs', 'tab_id');

create table if not exists loyalty_perk_lines (
  id            uuid primary key default gen_random_uuid(),
  tab_id        uuid not null references tabs(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  perk_id       uuid references loyalty_tier_perks(id) on delete set null,
  kind          text not null,
  units         int not null default 0,
  amount_iqd    bigint not null,
  stamps_spent  int,
  created_at    timestamptz not null default now(),
  constraint loyalty_perk_lines_kind   check (kind in ('stamp', 'gift', 'free_with', 'size_upgrade', 'free_addons')),
  constraint loyalty_perk_lines_amount check (amount_iqd > 0 and units >= 0),
  constraint loyalty_perk_lines_stamps check ((kind = 'stamp') = (stamps_spent is not null))
);

comment on table loyalty_perk_lines is
  '0445. What a member''s card frees on a bill, line by line and why (kind stamp: the drink card''s free drink, stamps_spent = the card''s size then; gift: a birthday gift, perk_id the privilege; free_with; free_addons), kept in step with app.loyalty_perks_detail by app.loyalty_perks_refresh while the bill is open. The money itself is the bill''s tab_adjustments rows (reason_code loyalty_tier_perk, one per line). A gift is used once a line of it sits on another open or settled bill in the same window; the settle trigger spends stamps for a stamp line. No client grant.';

do $loyalty_perk_lines_kind_0445$
begin
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_perk_lines_kind'
                and conrelid = 'public.loyalty_perk_lines'::regclass
                and pg_get_constraintdef(oid) not like '%size_upgrade%') then
    alter table loyalty_perk_lines drop constraint loyalty_perk_lines_kind;
    alter table loyalty_perk_lines add constraint loyalty_perk_lines_kind
      check (kind in ('stamp', 'gift', 'free_with', 'size_upgrade', 'free_addons')) not valid;
    alter table loyalty_perk_lines validate constraint loyalty_perk_lines_kind;
  end if;
end $loyalty_perk_lines_kind_0445$;

alter table loyalty_perk_lines enable row level security;
revoke all on loyalty_perk_lines from anon, authenticated;
grant all on loyalty_perk_lines to service_role;

drop trigger if exists zz_branch_guard on public.loyalty_perk_lines;
create trigger zz_branch_guard before insert or update or delete on public.loyalty_perk_lines
  for each row execute function app.trg_branch_guard('child', 'tabs', 'tab_id', 'order_items', 'order_item_id');

-- A court hour a card gift took off a booking (one per booking).
create table if not exists reservation_card_gifts (
  reservation_id uuid primary key references reservations(id) on delete cascade,
  tab_id         uuid references tabs(id) on delete set null,
  profile_id     uuid not null references profiles(id) on delete cascade,
  perk_id        uuid references loyalty_tier_perks(id) on delete set null,
  amount_iqd     bigint not null,
  applied_by     uuid,
  authorized_by  uuid,
  created_at     timestamptz not null default now(),
  constraint reservation_card_gifts_amount check (amount_iqd > 0)
);

comment on table reservation_card_gifts is
  '0445. The court hour a card gift (a gift privilege with target court_hour) took off a plain booking''s court fee: amount_iqd (app.court_hour_value, never more than the fee left), the member, the privilege, the bill that applied it (applied_by the staff member, authorized_by the privilege''s maker). One per booking. Kept in step by app.loyalty_court_gift_sync from app.loyalty_perks_refresh until a bill of the booking settles; app.court_reward_iqd adds it, so court_fee_remaining subtracts it. A cancelled or no-show booking''s row no longer counts as the gift used. No client grant.';

alter table reservation_card_gifts enable row level security;
revoke all on reservation_card_gifts from anon, authenticated;
grant all on reservation_card_gifts to service_role;

drop trigger if exists zz_branch_guard on public.reservation_card_gifts;
create trigger zz_branch_guard before insert or update or delete on public.reservation_card_gifts
  for each row execute function app.trg_branch_guard('child', 'reservations', 'reservation_id', 'tabs', 'tab_id');

-- Redeem in the app (Majed, 2026-11-15): a free drink or a card gift reaches a
-- bill only after the member presses Redeem (app.claim_card_reward) or a till
-- gives it for them (app.claim_card_reward_for_tab). One row per member and
-- reward, renewed by each press; it holds 7 days for a free drink and to the end
-- of the gift's window for a gift (a court hour is often booked days ahead).
create table if not exists loyalty_reward_claims (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  kind       text not null,
  perk_id    uuid references loyalty_tier_perks(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_by uuid,
  reward_key text generated always as (kind || ':' || coalesce(perk_id::text, '-')) stored,
  constraint loyalty_reward_claims_kind check (kind in ('stamp', 'gift')),
  constraint loyalty_reward_claims_perk check ((kind = 'gift') = (perk_id is not null)),
  constraint loyalty_reward_claims_window check (expires_at > claimed_at),
  constraint loyalty_reward_claims_once unique (profile_id, reward_key)
);

comment on table loyalty_reward_claims is
  '0445 (Majed, 2026-11-15: "a redeem now button, not go ask the cashier"). A member''s press of Redeem on a free drink (kind stamp) or a card gift (kind gift, perk_id the privilege): until expires_at (7 days for a free drink, the end of the gift''s window for a gift) the bill engine may free it (app.loyalty_perks_detail, app.loyalty_court_gift_sync); without a live claim it waits. claimed_by is the staff member when a till gave it for the member, NULL when the member pressed it. A stamp claim ends early once a settled bill spent stamps after it. One row per member and reward, renewed by each press. Chain-wide (no branch link). No client grant.';

alter table loyalty_reward_claims enable row level security;
revoke all on loyalty_reward_claims from anon, authenticated;
grant all on loyalty_reward_claims to service_role;

-- When the member moved up to the card they hold (a card-up gift's window).
alter table loyalty_accounts add column if not exists tier_up_at timestamptz;

comment on column loyalty_accounts.tier_up_at is
  '0445. When the member moved UP to the tier they hold now (trigger loyalty_accounts_tier_up); NULL after a move down, and for every account that held its tier before 0445, so a card-up gift is for a card reached from now on.';

-- The card frames join the closed list.
do $profiles_avatar_frame_0445$
begin
  if exists (select 1 from pg_constraint
              where conname = 'profiles_avatar_frame_chk'
                and conrelid = 'public.profiles'::regclass
                and pg_get_constraintdef(oid) not like '%card-green%') then
    alter table profiles drop constraint profiles_avatar_frame_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_avatar_frame_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_avatar_frame_chk
      check (avatar_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
                              'regular', 'silver-racket', 'gold-racket', 'champion',
                              'card-green', 'card-blue', 'card-black')) not valid;
  end if;
end $profiles_avatar_frame_0445$;

do $profiles_avatar_frame_validate_0445$
begin
  if exists (select 1 from pg_constraint
              where conname = 'profiles_avatar_frame_chk'
                and conrelid = 'public.profiles'::regclass and not convalidated) then
    alter table profiles validate constraint profiles_avatar_frame_chk;
  end if;
end $profiles_avatar_frame_validate_0445$;

-- ===========================================================================
-- 2. Internals
-- ===========================================================================

-- The closed list: re-created from 20261007000317_frame_style.sql:61 with the
-- three card rings.
create or replace function app.frame_ids() returns text[]
language sql immutable set search_path = public as $frame_ids_0445$
  select array['brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
               'regular', 'silver-racket', 'gold-racket', 'champion',
               'card-green', 'card-blue', 'card-black']
$frame_ids_0445$;

comment on function app.frame_ids() is
  '0314, court-lines out since 0317 (a style now), the card rings since 0445. The closed list of photo frame ids, free ones first, earned, then the three card rings a loyalty card unlocks (a frame privilege). profiles_avatar_frame_chk names the same list.';

revoke all on function app.frame_ids() from public, anon, authenticated;

-- The card ring a profile's card unlocks.
create or replace function app.card_frame_unlocked(p_profile uuid, p_frame text) returns boolean
language sql stable security definer set search_path = public as $card_frame_unlocked_0445$
  select coalesce((select s.enabled from loyalty_settings s where s.id), false)
     and exists (select 1
                   from loyalty_tier_perks k
                   join loyalty_tiers t on t.id = k.tier_id
                  where k.active and k.kind = 'frame' and k.config->>'frameId' = p_frame
                    and t.min_points_12m <= app.loyalty_tier_floor(p_profile))
$card_frame_unlocked_0445$;

comment on function app.card_frame_unlocked(uuid, text) is
  '0445. Internal: whether the profile''s loyalty card (their tier and every tier below) holds an active frame privilege naming this ring, while loyalty is on.';

revoke all on function app.card_frame_unlocked(uuid, text) from public, anon, authenticated;

-- app.frame_unlocked: re-created from 20261007000318_frame_grants.sql:28 with
-- the card rings.
create or replace function app.frame_unlocked(p_profile uuid, p_frame text) returns boolean
language sql stable security definer set search_path = public as $frame_unlocked_0445$
  select p_frame = any(app.frame_ids())
         and (exists (select 1 from frame_grants g where g.profile_id = p_profile)
              or case p_frame
                   when 'regular'       then app.matches_played(p_profile) >= 10
                   when 'silver-racket' then app.matches_played(p_profile) >= 50
                   when 'gold-racket'   then app.matches_played(p_profile) >= 100
                   when 'champion'      then app.tournaments_won(p_profile) >= 1
                   when 'card-green'    then app.card_frame_unlocked(p_profile, p_frame)   -- 0445
                   when 'card-blue'     then app.card_frame_unlocked(p_profile, p_frame)   -- 0445
                   when 'card-black'    then app.card_frame_unlocked(p_profile, p_frame)   -- 0445
                   else p_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line')
                 end)
$frame_unlocked_0445$;

comment on function app.frame_unlocked(uuid, text) is
  '0314, the earned rules since 0316, five free frames since 0317, frame_grants since 0318, the card rings since 0445. Internal: whether a profile may wear a frame. A profile in frame_grants wears all of them; otherwise the five free frames always, regular at 10 matches played and paid, silver-racket at 50, gold-racket at 100 (app.matches_played), champion after one tournament win (app.tournaments_won), and a card ring while their loyalty card holds a frame privilege naming it (app.card_frame_unlocked).';

revoke all on function app.frame_unlocked(uuid, text) from public, anon, authenticated;

-- Wearers of a card ring their card no longer unlocks go back to brand-green.
create or replace function app.card_frame_reset(p_profile uuid default null) returns int
language plpgsql security definer set search_path = public as $card_frame_reset_0445$
declare
  v_n int;
begin
  update profiles p
     set avatar_frame = 'brand-green', avatar_frame_style = 'solid'
   where p.avatar_frame in ('card-green', 'card-blue', 'card-black')
     and (p_profile is null or p.id = p_profile)
     and not exists (select 1 from frame_grants g where g.profile_id = p.id)
     and not app.card_frame_unlocked(p.id, p.avatar_frame);
  get diagnostics v_n = row_count;
  return v_n;
end $card_frame_reset_0445$;

comment on function app.card_frame_reset(uuid) is
  '0445. Internal: puts every wearer of a card ring their card no longer unlocks (or just p_profile''s) back on brand-green, solid. Called when a member''s tier changes (trigger loyalty_accounts_card_frame) and when the owner changes or removes a frame privilege. Returns how many it moved.';

revoke all on function app.card_frame_reset(uuid) from public, anon, authenticated;

create or replace function app.trg_loyalty_card_frame() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_card_frame_0445$
begin
  if new.tier_id is distinct from old.tier_id then
    perform app.card_frame_reset(new.profile_id);
  end if;
  return null;
end $trg_loyalty_card_frame_0445$;

comment on function app.trg_loyalty_card_frame() is
  '0445. Trigger loyalty_accounts_card_frame: when a member''s tier changes, a card ring the new card does not unlock comes off (app.card_frame_reset).';

revoke all on function app.trg_loyalty_card_frame() from public, anon, authenticated;

drop trigger if exists loyalty_accounts_card_frame on public.loyalty_accounts;
create trigger loyalty_accounts_card_frame after update of tier_id on public.loyalty_accounts
  for each row execute function app.trg_loyalty_card_frame();

create or replace function app.trg_loyalty_tier_up() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_tier_up_0445$
begin
  if new.tier_id is distinct from old.tier_id then
    if new.tier_id is not null
       and coalesce((select t.min_points_12m from loyalty_tiers t where t.id = new.tier_id), 0)
           > coalesce((select t.min_points_12m from loyalty_tiers t where t.id = old.tier_id), -1) then
      new.tier_up_at := now();
    else
      new.tier_up_at := null;
    end if;
  end if;
  return new;
end $trg_loyalty_tier_up_0445$;

comment on function app.trg_loyalty_tier_up() is
  '0445. Trigger loyalty_accounts_tier_up (before a tier change): stamps tier_up_at when the new tier is higher than the old (or the account had none), clears it on a move down.';

revoke all on function app.trg_loyalty_tier_up() from public, anon, authenticated;

drop trigger if exists loyalty_accounts_tier_up on public.loyalty_accounts;
create trigger loyalty_accounts_tier_up before update of tier_id on public.loyalty_accounts
  for each row execute function app.trg_loyalty_tier_up();

-- court_reward_iqd: re-created from 20261105000403_loyalty_rewards_only.sql:155
-- with the court hour a card gift took (its three readers, court_fee_remaining,
-- apply_customer_court_discount and bill_customer_discount, then count it).
create or replace function app.court_reward_iqd(p_reservation_id uuid) returns bigint
language sql stable security definer set search_path = public as $court_reward_iqd_0445$
  select (coalesce((select x.amount_iqd from reservation_loyalty_rewards x
                     where x.reservation_id = p_reservation_id), 0)
        + coalesce((select g.amount_iqd from reservation_card_gifts g
                     where g.reservation_id = p_reservation_id), 0))::bigint   -- 0445
$court_reward_iqd_0445$;

revoke all on function app.court_reward_iqd(uuid) from public, anon, authenticated;

comment on function app.court_reward_iqd(uuid) is
  '0403, card gifts since 0445. Internal: the IQD free court hours took off the booking''s court fee: the points reward (reservation_loyalty_rewards.amount_iqd) plus a card gift''s hour (reservation_card_gifts.amount_iqd); 0 with none. court_fee_remaining, apply_customer_court_discount and bill_customer_discount subtract it.';

-- The uuids a jsonb array holds (non-uuid entries are dropped).
create or replace function app.jsonb_uuids(p jsonb) returns uuid[]
language sql immutable set search_path = public as $jsonb_uuids_0445$
  select coalesce(array(select distinct e::uuid
                          from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
                         where e ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         order by 1), '{}'::uuid[])
$jsonb_uuids_0445$;

comment on function app.jsonb_uuids(jsonb) is
  '0445. Internal: the distinct uuids of a jsonb array, sorted; anything else (not an array, a non-uuid entry) is dropped.';

revoke all on function app.jsonb_uuids(jsonb) from public, anon, authenticated;

-- A member's drink card size: the club's standard, or a stamp_size privilege's.
create or replace function app.loyalty_stamp_size(p_profile uuid) returns int
language sql stable security definer set search_path = public as $loyalty_stamp_size_0445$
  select least(coalesce((select c.size from loyalty_stamp_card c where c.id), 8),
               coalesce((select min((k.config->>'size')::int)
                           from loyalty_tier_perks k
                           join loyalty_tiers t on t.id = k.tier_id
                          where k.active and k.kind = 'stamp_size'
                            and t.min_points_12m <= app.loyalty_tier_floor(p_profile)), 1000))
$loyalty_stamp_size_0445$;

comment on function app.loyalty_stamp_size(uuid) is
  '0445. Internal: how many stamps fill this member''s drink card: the club''s size (loyalty_stamp_card.size), or less when their card holds a stamp_size privilege (the lowest wins).';

revoke all on function app.loyalty_stamp_size(uuid) from public, anon, authenticated;

create or replace function app.loyalty_stamp_balance(p_profile uuid) returns int
language sql stable security definer set search_path = public as $loyalty_stamp_balance_0445$
  select coalesce(sum(s.delta), 0)::int from loyalty_stamps s where s.profile_id = p_profile
$loyalty_stamp_balance_0445$;

comment on function app.loyalty_stamp_balance(uuid) is
  '0445. Internal: a member''s stamps, the sum of their loyalty_stamps rows.';

revoke all on function app.loyalty_stamp_balance(uuid) from public, anon, authenticated;

-- Whether a menu item stamps the drink card.
create or replace function app.loyalty_item_stamps(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $loyalty_item_stamps_0445$
  select exists (select 1
                   from loyalty_stamp_card c
                   join menu_items mi on mi.id = p_item
                  where c.id and c.enabled
                    and mi.category_id = any(c.category_ids)
                    and not (p_item = any(c.excluded_item_ids)))
$loyalty_item_stamps_0445$;

comment on function app.loyalty_item_stamps(uuid) is
  '0445. Internal: true when the drink card is on and the menu item is in one of its stamping categories and not excluded.';

revoke all on function app.loyalty_item_stamps(uuid) from public, anon, authenticated;

-- The birthday window holding p_day, if any: [from, from + days - 1] around
-- the birthday of p_day's year or the year before; 29 February is the 28th in
-- a common year.
create or replace function app.loyalty_birthday_window(p_birth date, p_day date, p_days int)
returns daterange
language sql immutable set search_path = public as $loyalty_birthday_window_0445$
  select w
    from (select daterange(b, b + greatest(p_days, 1), '[)') as w
            from (select case when extract(month from p_birth) = 2 and extract(day from p_birth) = 29
                                   and not (y % 4 = 0 and (y % 100 <> 0 or y % 400 = 0))
                              then make_date(y, 2, 28)
                              else make_date(y, extract(month from p_birth)::int, extract(day from p_birth)::int)
                         end as b
                    from (values (extract(year from p_day)::int), (extract(year from p_day)::int - 1)) as yy(y)) bb) ww
   where p_birth is not null and p_day <@ w
   limit 1
$loyalty_birthday_window_0445$;

comment on function app.loyalty_birthday_window(date, date, int) is
  '0445. Internal: the birthday window (a date range from the birthday, p_days long) that holds p_day, looking at the birthday of p_day''s year and the year before (a late-December birthday''s window runs into January); 29 February falls on the 28th in a common year. NULL when p_day is in no window.';

revoke all on function app.loyalty_birthday_window(date, date, int) from public, anon, authenticated;

-- The card gifts a profile can use today at a branch: each window, and
-- whether the gift is used (or held by another open bill or booking).
drop function if exists app.loyalty_birthday_gifts(uuid, uuid, uuid);

-- Until when the member's Redeem press for one reward holds, or NULL when
-- none is live. p_since: a press before it does not count (a gift's window
-- start). A stamp press ends once a settled bill spent stamps after it.
create or replace function app.loyalty_claim_until(p_profile uuid, p_kind text, p_perk uuid,
                                                   p_since timestamptz default null)
returns timestamptz
language plpgsql stable security definer set search_path = public as $loyalty_claim_until_0445$
declare
  v_until timestamptz;
begin
  select c.expires_at into v_until
    from loyalty_reward_claims c
   where c.profile_id = p_profile and c.kind = p_kind and c.perk_id is not distinct from p_perk
     and c.expires_at > now()
     and (p_since is null or c.claimed_at >= p_since)
     and (p_kind <> 'stamp' or not exists (
           select 1 from loyalty_stamps s
            where s.profile_id = p_profile and s.kind = 'redeem' and s.created_at >= c.claimed_at));
  return v_until;
end $loyalty_claim_until_0445$;

comment on function app.loyalty_claim_until(uuid, text, uuid, timestamptz) is
  '0445 (Redeem in the app). Internal: when the member''s live claim (loyalty_reward_claims) on a free drink (kind stamp, p_perk NULL) or a card gift (kind gift, p_perk the privilege) ends, or NULL when there is none: a claim made before p_since does not count, and a stamp claim ends once a settled bill spent stamps after it.';

revoke all on function app.loyalty_claim_until(uuid, text, uuid, timestamptz) from public, anon, authenticated;

-- The return type gained claimed_until (Redeem in the app); a re-run replaces it.
drop function if exists app.loyalty_card_gifts(uuid, uuid, uuid, uuid);

create or replace function app.loyalty_card_gifts(p_profile uuid, p_venue uuid,
                                                  p_except_tab uuid default null,
                                                  p_except_reservation uuid default null)
returns table (perk_id uuid, name_en text, name_ar text, gift_when text, target text,
               window_from date, window_to date, eligible boolean, used boolean,
               category_ids uuid[], item_ids uuid[], authorized_by uuid,
               claimed_until timestamptz)
language plpgsql stable security definer set search_path = public as $loyalty_card_gifts_0445$
declare
  v_birth date;
  v_set   timestamptz;
  v_tz    text;
  v_today date;
  v_floor int;
  v_tier  uuid;
  v_up    timestamptz;
  k       record;
  v_w     daterange;
  v_when  text;
  v_from  timestamptz;
begin
  if not coalesce((select s.enabled from loyalty_settings s where s.id), false) then
    return;
  end if;
  select p.birth_date, p.birth_date_set_at into v_birth, v_set
    from profiles p where p.id = p_profile and p.deleted_at is null;
  if not found then
    return;
  end if;
  v_tz := coalesce((select vs.timezone from venue_settings vs where vs.venue_id = p_venue), 'Asia/Baghdad');
  v_today := (now() at time zone v_tz)::date;
  v_floor := app.loyalty_tier_floor(p_profile);
  select a.tier_id, a.tier_up_at into v_tier, v_up from loyalty_accounts a where a.profile_id = p_profile;

  for k in
    select gk.*
      from loyalty_tier_perks gk
      join loyalty_tiers t on t.id = gk.tier_id
     where gk.active and gk.kind = 'gift' and t.min_points_12m <= v_floor
     order by t.min_points_12m, gk.sort, gk.created_at, gk.id
  loop
    v_when := coalesce(k.config->>'when', 'birthday');
    v_w := null;
    if v_when = 'birthday' then
      if v_birth is not null then
        v_w := app.loyalty_birthday_window(v_birth, v_today,
                                           coalesce(least(greatest((k.config->>'days')::int, 1), 31), 7));
      end if;
    elsif v_when = 'monthly' then
      v_w := daterange(date_trunc('month', v_today)::date,
                       (date_trunc('month', v_today) + interval '1 month')::date, '[)');
    elsif v_when = 'card_up' then
      -- The card the member holds now, from the day they moved up to it.
      if k.tier_id = v_tier and v_up is not null then
        v_w := daterange((v_up at time zone v_tz)::date,
                         (v_up at time zone v_tz)::date
                           + coalesce(least(greatest((k.config->>'days')::int, 1), 90), 30), '[)');
        if not (v_today <@ v_w) then
          v_w := null;
        end if;
      end if;
    end if;
    if v_w is null then
      continue;
    end if;
    v_from := (lower(v_w)::timestamp at time zone v_tz);
    if v_when = 'card_up' then
      v_from := greatest(v_from, v_up);
    end if;
    perk_id := k.id;
    name_en := k.name_en;
    name_ar := k.name_ar;
    gift_when := v_when;
    target := coalesce(k.config->>'target', 'items');
    window_from := lower(v_w);
    window_to := upper(v_w) - 1;
    eligible := v_when <> 'birthday'
                or (v_set is not null and v_set <= ((lower(v_w) - 30)::timestamp at time zone v_tz));
    used := exists (select 1
                      from loyalty_perk_lines l
                      join tabs t on t.id = l.tab_id
                     where l.profile_id = p_profile and l.kind = 'gift' and l.perk_id = k.id
                       and (p_except_tab is null or l.tab_id <> p_except_tab)
                       and t.status in ('open', 'awaiting_payment', 'settled')
                       and t.merged_into_tab_id is null
                       and l.created_at >= v_from)
         or exists (select 1
                      from reservation_card_gifts x
                      join reservations r on r.id = x.reservation_id
                     where x.profile_id = p_profile and x.perk_id = k.id
                       and (p_except_reservation is null or x.reservation_id <> p_except_reservation)
                       and r.status not in ('cancelled', 'no_show', 'expired')
                       and x.created_at >= v_from);
    category_ids := app.jsonb_uuids(k.config->'categoryIds');
    item_ids := app.jsonb_uuids(k.config->'itemIds');
    authorized_by := k.created_by;
    claimed_until := app.loyalty_claim_until(p_profile, 'gift', k.id, v_from);
    return next;
  end loop;
end $loyalty_card_gifts_0445$;

comment on function app.loyalty_card_gifts(uuid, uuid, uuid, uuid) is
  '0445. Internal: the gift privileges of the profile''s card whose window holds today in the branch''s time zone: {perk_id, names, gift_when (birthday: from the birthday, days long; monthly: the calendar month; card_up: from loyalty_accounts.tier_up_at, only for a gift of the tier they hold), target (items | court_hour), window_from, window_to (inclusive), eligible (birthday: the birth date set at least 30 days before the window opened; always true otherwise), used (a line of this gift on another open or settled bill, or a court hour of it on another live booking, since the window opened; p_except_tab / p_except_reservation are left out), category_ids, item_ids, authorized_by (the privilege''s maker), claimed_until (the member''s live Redeem press on it since the window opened, app.loyalty_claim_until, or NULL)}. No rows while loyalty is off.';

revoke all on function app.loyalty_card_gifts(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- A court-hour gift on the booking a bill belongs to: added, changed or taken
-- off to match the member's card, until a bill of the booking settles.
create or replace function app.loyalty_court_gift_sync(p_tab_id uuid, p_customer uuid) returns boolean
language plpgsql security definer set search_path = public as $loyalty_court_gift_sync_0445$
declare
  v_tab    tabs%rowtype;
  v_res    reservations%rowtype;
  v_row    reservation_card_gifts%rowtype;
  v_perk   uuid;
  v_auth   uuid;
  v_ok     boolean;
  v_amount bigint;
begin
  select * into v_tab from tabs where id = p_tab_id;
  if not found or v_tab.reservation_id is null then
    return false;
  end if;
  select * into v_row from reservation_card_gifts where reservation_id = v_tab.reservation_id;
  if p_customer is not null then
    select cg.perk_id, cg.authorized_by into v_perk, v_auth
      from app.loyalty_card_gifts(p_customer, v_tab.venue_id, null, v_tab.reservation_id) cg
     where cg.target = 'court_hour' and cg.eligible and not cg.used
       and (cg.claimed_until is not null or cg.perk_id is not distinct from v_row.perk_id)
     order by (cg.gift_when = 'birthday') desc, cg.window_from, cg.perk_id
     limit 1;
  end if;
  if v_perk is null and v_row.reservation_id is null then
    return false;
  end if;

  -- The booking's money: the court lock, then the row (loyalty_redeem's order).
  select * into v_res from reservations where id = v_tab.reservation_id;
  perform app.lock_court(v_res.court_id);
  select * into v_res from reservations where id = v_tab.reservation_id for update;
  if app.court_discount_closed(v_res.id) then
    return false;
  end if;

  v_ok := v_perk is not null and v_res.kind = 'booking'
          and v_res.status in ('confirmed', 'arrived', 'completed') and v_res.price_iqd is not null
          and not exists (select 1 from matches m where m.reservation_id = v_res.id);
  if v_ok then
    v_amount := least(app.court_hour_value(v_res.id),
                      app.court_fee_remaining(v_res.id) + coalesce(v_row.amount_iqd, 0));
    v_ok := v_amount > 0;
  end if;

  if v_ok then
    if v_row.reservation_id is not null and v_row.perk_id is not distinct from v_perk
       and v_row.amount_iqd = v_amount and v_row.profile_id = p_customer then
      return false;
    end if;
    delete from reservation_card_gifts where reservation_id = v_res.id;
    insert into reservation_card_gifts (reservation_id, tab_id, profile_id, perk_id, amount_iqd, applied_by, authorized_by)
    values (v_res.id, p_tab_id, p_customer, v_perk, v_amount, auth.uid(), v_auth);
    return true;
  elsif v_row.reservation_id is not null then
    delete from reservation_card_gifts where reservation_id = v_res.id;
    return true;
  end if;
  return false;
end $loyalty_court_gift_sync_0445$;

comment on function app.loyalty_court_gift_sync(uuid, uuid) is
  '0445. Internal, called by app.loyalty_perks_refresh: when the bill belongs to a plain priced live booking (kind booking, confirmed | arrived | completed, not a match) and the member''s card has a court_hour gift open, eligible, unused and redeemed (claimed_until, or the one the booking already carries), the booking carries one reservation_card_gifts row worth one court hour (app.court_hour_value, never more than the fee left); otherwise a row it carries goes. Takes the court lock and the booking row first; leaves a booking alone once a bill of it settled (app.court_discount_closed). Returns whether it changed anything.';

revoke all on function app.loyalty_court_gift_sync(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. The bill engine
-- ===========================================================================

create or replace function app.loyalty_perks_detail(p_tab_id uuid)
returns table (order_item_id uuid, perk_id uuid, kind text, units int, amount_iqd bigint,
               authorized_by uuid, stamps_spent int)
language plpgsql stable security definer set search_path = public as $loyalty_perks_detail_0445$
declare
  v_tab      tabs%rowtype;
  v_customer uuid;
  v_floor    int;
  v_lines    jsonb := '[]'::jsonb;   -- [{id, item, category, qty, unit, room}]
  v_freed    jsonb := '{}'::jsonb;   -- {line id: units freed}
  v_size     int;
  v_owner    uuid;
  v_all      boolean;
  v_groups   uuid[];
  v_auth     uuid;
  r          record;
  k          record;
  g          record;
  v_left     int;
  v_take     int;
  v_trig     int;
  v_cats     uuid[];
  v_items    uuid[];
  v_fcats    uuid[];
  v_fitems   uuid[];
  v_upg      jsonb := '{}'::jsonb;   -- {line id: true} once upgraded
  v_step     bigint;
begin
  if not coalesce((select s.enabled from loyalty_settings s where s.id), false) then
    return;
  end if;
  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    return;
  end if;
  v_customer := app.tab_customer(p_tab_id);
  if v_customer is null then
    return;
  end if;
  v_floor := app.loyalty_tier_floor(v_customer);

  -- The live lines, dearest unit first: a unit's value is the line total over
  -- its quantity (add-ons included), and room is what other line discounts
  -- leave of the line.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'item', x.menu_item_id, 'category', x.category_id, 'variant', x.variant_id, 'qty', x.qty,
           'unit', x.unit, 'room', x.room) order by x.unit desc, x.line_no, x.id), '[]'::jsonb)
    into v_lines
    from (select oi.id, oi.menu_item_id, mi.category_id, oi.variant_id, oi.qty, oi.line_no,
                 (oi.line_total_iqd / greatest(oi.qty, 1))::bigint as unit,
                 greatest(oi.line_total_iqd::bigint
                          - coalesce((select sum(a.amount_iqd)
                                        from tab_adjustments a
                                       where a.tab_id = p_tab_id and a.order_item_id = oi.id
                                         and a.kind in ('discount_percent', 'discount_amount')
                                         and a.reason_code <> 'loyalty_tier_perk'), 0), 0) as room
            from orders o
            join order_items oi on oi.order_id = o.id
            left join menu_items mi on mi.id = oi.menu_item_id
           where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
             and oi.qty > 0 and oi.line_total_iqd > 0) x;

  -- (a) The drink card: a full card frees the dearest stamping unit, once a
  -- bill, unless another open bill of theirs already holds the free drink.
  v_size := app.loyalty_stamp_size(v_customer);
  if coalesce((select c.enabled from loyalty_stamp_card c where c.id), false)
     and app.loyalty_stamp_balance(v_customer) >= v_size
     -- Redeem in the app: only once the member pressed Redeem (or a till did
     -- for them), and kept on the bill that already carries it.
     and (app.loyalty_claim_until(v_customer, 'stamp', null) is not null
          or exists (select 1 from loyalty_perk_lines l where l.tab_id = p_tab_id and l.kind = 'stamp'))
     and not exists (select 1 from loyalty_perk_lines l join tabs t on t.id = l.tab_id
                      where l.profile_id = v_customer and l.kind = 'stamp' and l.tab_id <> p_tab_id
                        and t.status in ('open', 'awaiting_payment') and t.merged_into_tab_id is null) then
    -- Who stands behind the free drink: whoever last set the card, else the
    -- first active owner (a card set by migration or by hand has nobody).
    v_owner := coalesce((select c.updated_by from loyalty_stamp_card c where c.id),
                        (select s.id from staff s where s.role = 'owner' and s.is_active
                          order by s.created_at, s.id limit 1));
    for r in select * from jsonb_to_recordset(v_lines)
                      as l(id uuid, item uuid, category uuid, variant uuid, qty int, unit bigint, room bigint)
    loop
      if r.item is not null and app.loyalty_item_stamps(r.item)
         and coalesce((v_freed->>r.id::text)::int, 0) < r.qty then
        order_item_id := r.id; perk_id := null; kind := 'stamp'; units := 1;
        amount_iqd := r.unit; authorized_by := v_owner; stamps_spent := v_size;
        v_freed := jsonb_set(v_freed, array[r.id::text], to_jsonb(coalesce((v_freed->>r.id::text)::int, 0) + 1));
        return next;
        exit;
      end if;
    end loop;
  end if;

  -- (b) Gifts on menu items (birthday, monthly, card-up): one unit each, the
  -- dearest matching unit still paid. Court-hour gifts are the booking's
  -- (app.loyalty_court_gift_sync).
  for g in select * from app.loyalty_card_gifts(v_customer, v_tab.venue_id, p_tab_id, null) bg
            where bg.eligible and not bg.used and bg.target = 'items'
              and (bg.claimed_until is not null
                   or exists (select 1 from loyalty_perk_lines l
                               where l.tab_id = p_tab_id and l.kind = 'gift' and l.perk_id = bg.perk_id))
  loop
    for r in select * from jsonb_to_recordset(v_lines)
                      as l(id uuid, item uuid, category uuid, variant uuid, qty int, unit bigint, room bigint)
    loop
      if (r.category = any(g.category_ids) or r.item = any(g.item_ids))
         and coalesce((v_freed->>r.id::text)::int, 0) < r.qty then
        order_item_id := r.id; perk_id := g.perk_id; kind := 'gift'; units := 1;
        amount_iqd := r.unit; authorized_by := g.authorized_by; stamps_spent := null;
        v_freed := jsonb_set(v_freed, array[r.id::text], to_jsonb(coalesce((v_freed->>r.id::text)::int, 0) + 1));
        return next;
        exit;
      end if;
    end loop;
  end loop;

  -- (c) Free with: one free unit per trigger unit on the bill, dearest first.
  for k in
    select fk.*
      from loyalty_tier_perks fk
      join loyalty_tiers t on t.id = fk.tier_id
     where fk.active and fk.kind = 'free_with' and t.min_points_12m <= v_floor
     order by t.min_points_12m desc, fk.sort, fk.created_at, fk.id
  loop
    v_cats := app.jsonb_uuids(k.config->'triggerCategoryIds');
    v_items := app.jsonb_uuids(k.config->'triggerItemIds');
    v_fcats := app.jsonb_uuids(k.config->'freeCategoryIds');
    v_fitems := app.jsonb_uuids(k.config->'freeItemIds');
    select coalesce(sum(l.qty), 0)::int into v_trig
      from jsonb_to_recordset(v_lines) as l(id uuid, item uuid, category uuid, variant uuid, qty int, unit bigint, room bigint)
     where (l.category = any(v_cats) or l.item = any(v_items))
       and not (l.category = any(v_fcats) or l.item = any(v_fitems));
    v_left := v_trig;
    for r in select * from jsonb_to_recordset(v_lines)
                      as l(id uuid, item uuid, category uuid, variant uuid, qty int, unit bigint, room bigint)
    loop
      exit when v_left <= 0;
      if r.category = any(v_fcats) or r.item = any(v_fitems) then
        v_take := least(v_left, r.qty - coalesce((v_freed->>r.id::text)::int, 0));
        if v_take > 0 then
          order_item_id := r.id; perk_id := k.id; kind := 'free_with'; units := v_take;
          amount_iqd := r.unit * v_take; authorized_by := k.created_by; stamps_spent := null;
          v_freed := jsonb_set(v_freed, array[r.id::text], to_jsonb(coalesce((v_freed->>r.id::text)::int, 0) + v_take));
          v_left := v_left - v_take;
          return next;
        end if;
      end if;
    end loop;
  end loop;

  -- (d) Size upgrades: a matching line is charged the next size down on every
  -- unit still paid (its variant's price less the item's next cheaper one).
  for k in
    select su.*
      from loyalty_tier_perks su
      join loyalty_tiers t on t.id = su.tier_id
     where su.active and su.kind = 'size_upgrade' and t.min_points_12m <= v_floor
     order by t.min_points_12m desc, su.sort, su.created_at, su.id
  loop
    v_cats := app.jsonb_uuids(k.config->'categoryIds');
    v_items := app.jsonb_uuids(k.config->'itemIds');
    for r in select * from jsonb_to_recordset(v_lines)
                      as l(id uuid, item uuid, category uuid, variant uuid, qty int, unit bigint, room bigint)
    loop
      if (r.category = any(v_cats) or r.item = any(v_items)) and not (v_upg ? r.id::text) then
        v_take := r.qty - coalesce((v_freed->>r.id::text)::int, 0);
        select greatest(v.price_iqd - coalesce((select max(v2.price_iqd) from menu_item_variants v2
                                                  where v2.item_id = v.item_id and v2.price_iqd < v.price_iqd),
                                                v.price_iqd), 0)
          into v_step
          from menu_item_variants v where v.id = r.variant;
        if v_take > 0 and coalesce(v_step, 0) > 0 then
          order_item_id := r.id; perk_id := k.id; kind := 'size_upgrade'; units := v_take;
          amount_iqd := least(v_step, r.unit) * v_take; authorized_by := k.created_by; stamps_spent := null;
          v_upg := v_upg || jsonb_build_object(r.id::text, true);
          return next;
        end if;
      end if;
    end loop;
  end loop;

  -- (e) Free add-ons (0410's rule), on the units still paid.
  select coalesce(bool_or(cardinality(fa.modifier_group_ids) = 0), false),
         coalesce(array_agg(distinct gg.id) filter (where gg.id is not null), '{}'::uuid[]),
         (array_agg(fa.created_by order by t.min_points_12m desc, fa.sort, fa.created_at, fa.id))[1]
    into v_all, v_groups, v_auth
    from loyalty_tier_perks fa
    join loyalty_tiers t on t.id = fa.tier_id
    left join lateral unnest(fa.modifier_group_ids) as gg(id) on true
   where fa.active and fa.kind = 'free_addons' and t.min_points_12m <= v_floor;
  if v_auth is not null then
    for r in
      select oi.id, oi.qty, sum(oim.price_delta_iqd::bigint * oim.qty) as per_unit
        from orders o
        join order_items oi on oi.order_id = o.id
        join order_item_modifiers oim on oim.order_item_id = oi.id
        join modifiers m on m.id = oim.modifier_id
       where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
         and oim.price_delta_iqd > 0
         and (v_all or m.group_id = any(v_groups))
       group by oi.id, oi.qty
    loop
      v_take := r.qty - coalesce((v_freed->>r.id::text)::int, 0);
      if v_take > 0 and r.per_unit > 0 then
        order_item_id := r.id; perk_id := null; kind := 'free_addons'; units := v_take;
        amount_iqd := r.per_unit * v_take; authorized_by := v_auth; stamps_spent := null;
        return next;
      end if;
    end loop;
  end if;
end $loyalty_perks_detail_0445$;

comment on function app.loyalty_perks_detail(uuid) is
  '0445. Internal: what the tab customer''s card frees on this bill, line by line and why, in this order: (stamp) a full drink card the member redeemed (a live claim, app.loyalty_claim_until, or already on this bill) frees the dearest stamping unit, once a bill, unless another open bill of theirs holds it (stamps_spent = the card''s size); (gift) each menu-item gift (app.loyalty_card_gifts, target items: birthday, monthly, card_up) whose window holds today, eligible, not used and redeemed (claimed_until, or already on this bill), frees the dearest matching unit; (free_with) each free_with privilege frees one free-line unit per trigger unit (trigger lines that are also free lines do not count), dearest first; (size_upgrade) each size_upgrade privilege charges a matching line the next size down on its units still paid (once a line); (free_addons) 0410''s free add-ons on the units no earlier row freed. A unit is freed once. A unit''s value is line_total_iqd / qty. amount_iqd is not capped here (app.loyalty_perks_plan caps the per-line sum). No rows while loyalty is off or the tab has no customer.';

revoke all on function app.loyalty_perks_detail(uuid) from public, anon, authenticated;

-- loyalty_perks_plan: re-created from 20261112000410_loyalty_deals_perks.sql:291
-- over the detail. The signature and the rows' meaning are unchanged: one row
-- per line, capped at what the line's other discounts leave.
create or replace function app.loyalty_perks_plan(p_tab_id uuid)
returns table (order_item_id uuid, amount_iqd bigint, authorized_by uuid)
language sql stable security definer set search_path = public as $loyalty_perks_plan_0445$
  select d.order_item_id,
         least(sum(d.amount_iqd),
               greatest(oi.line_total_iqd::bigint
                        - coalesce((select sum(a.amount_iqd)
                                      from tab_adjustments a
                                     where a.tab_id = p_tab_id and a.order_item_id = oi.id
                                       and a.kind in ('discount_percent', 'discount_amount')
                                       and a.reason_code <> 'loyalty_tier_perk'), 0), 0))::bigint,
         (array_agg(d.authorized_by order by case d.kind when 'stamp' then 0 when 'gift' then 1
                                                         when 'free_with' then 2 when 'size_upgrade' then 3
                                                         else 4 end))[1]
    from app.loyalty_perks_detail(p_tab_id) d
    join order_items oi on oi.id = d.order_item_id
   group by d.order_item_id, oi.id, oi.line_total_iqd
  having least(sum(d.amount_iqd),
               greatest(oi.line_total_iqd::bigint
                        - coalesce((select sum(a.amount_iqd)
                                      from tab_adjustments a
                                     where a.tab_id = p_tab_id and a.order_item_id = oi.id
                                       and a.kind in ('discount_percent', 'discount_amount')
                                       and a.reason_code <> 'loyalty_tier_perk'), 0), 0)) > 0
$loyalty_perks_plan_0445$;

comment on function app.loyalty_perks_plan(uuid) is
  '0410, every card privilege since 0445. Internal: what the tab customer''s card frees on each live line now, one row per line: amount_iqd = the line''s rows of app.loyalty_perks_detail (drink card, birthday gifts, free with, free add-ons) summed, never more than the line total less its other line discounts; authorized_by = the maker of the line''s first row (drink card, then gift, free with, add-ons). No rows while loyalty is off, the tab has no customer (app.tab_customer) or their card frees nothing on it.';

revoke all on function app.loyalty_perks_plan(uuid) from public, anon, authenticated;

-- loyalty_perks_refresh: re-created from
-- 20261112000410_loyalty_deals_perks.sql:1023. Changes marked 0445: the
-- detail is kept in loyalty_perk_lines on every open-bill refresh.
create or replace function app.loyalty_perks_refresh(p_tab_id uuid, p_device_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_perks_refresh_0445$
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
  v_detail  jsonb;    -- 0445
  v_cust    uuid;     -- 0445
  v_court   boolean;  -- 0445
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

  -- 0445: the detail first (the plan is its per-line sum), read once and held.
  v_cust := app.tab_customer(p_tab_id);
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_detail
    from app.loyalty_perks_detail(p_tab_id) d;

  -- The plan is read once and held, so the comparison, the delete and the
  -- insert all see the same rows.
  select coalesce(jsonb_agg(jsonb_build_object('order_item_id', pl.order_item_id, 'amount_iqd', pl.amount_iqd,
                                               'authorized_by', pl.authorized_by)), '[]'::jsonb)
    into v_plan
    from app.loyalty_perks_plan(p_tab_id) pl;

  -- 0445: the detail rows follow the plan whether or not the money changes
  -- (the same amount can change its reason).
  delete from loyalty_perk_lines l where l.tab_id = p_tab_id;
  if v_cust is not null then
    insert into loyalty_perk_lines (tab_id, order_item_id, profile_id, perk_id, kind, units, amount_iqd, stamps_spent)
    select p_tab_id, d.order_item_id, v_cust, d.perk_id, d.kind, d.units, d.amount_iqd, d.stamps_spent
      from jsonb_to_recordset(v_detail) as d(order_item_id uuid, perk_id uuid, kind text, units int,
                                            amount_iqd bigint, authorized_by uuid, stamps_spent int)
     where d.amount_iqd > 0;
  end if;

  -- 0445: a court-hour gift on the bill's booking.
  v_court := app.loyalty_court_gift_sync(p_tab_id, v_cust);

  select count(*), coalesce(sum(pl.amount_iqd), 0) into v_new_n, v_new_sum
    from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid);
  v_differs := exists (
      (select a.order_item_id, a.amount_iqd::bigint from tab_adjustments a
        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk')
      except all
      (select pl.order_item_id, pl.amount_iqd from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid)))
    or exists (
      (select pl.order_item_id, pl.amount_iqd from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid))
      except all
      (select a.order_item_id, a.amount_iqd::bigint from tab_adjustments a
        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk'));
  if not v_differs then
    return jsonb_build_object('changed', v_court, 'amount_iqd', v_old_sum, 'lines', v_old_n);   -- 0445: v_court
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
      -- 0445: the detail goes back to what the bill still carries.
      delete from loyalty_perk_lines l where l.tab_id = p_tab_id;
      return jsonb_build_object('changed', false, 'amount_iqd', v_old_sum, 'lines', v_old_n,
                                'refused', 'DISCOUNT_REQUIRES_REFUND');
    end if;
    raise;
  end;

  perform app.write_audit('loyalty.perks_apply', 'tabs', p_tab_id::text,
                          jsonb_build_object('lines', v_old_n, 'amount_iqd', v_old_sum),
                          jsonb_build_object('lines', v_new_n, 'amount_iqd', v_new_sum,
                                             'customer_id', v_cust,
                                             'kinds', (select coalesce(jsonb_agg(distinct d->>'kind'), '[]'::jsonb)
                                                         from jsonb_array_elements(v_detail) d)),   -- 0445
                          'loyalty_tier_perk',
                          (select pl.authorized_by from jsonb_to_recordset(v_plan) as pl(order_item_id uuid, amount_iqd bigint, authorized_by uuid) limit 1),
                          p_device_id);
  return jsonb_build_object('changed', true, 'amount_iqd', v_new_sum, 'lines', v_new_n);
end $loyalty_perks_refresh_0445$;

comment on function app.loyalty_perks_refresh(uuid, text) is
  '0410, every card privilege since 0445. court_desk, cashier, shop_staff, manager, owner at the tab''s branch, the tab''s kind for the role (TAB_KIND_FORBIDDEN), no PIN: brings what the tab customer''s card frees in line with the bill (TAB_NOT_FOUND, VENUE_MISMATCH). One tab_adjustments line discount per live line the card frees something on (app.loyalty_perks_plan: the drink card''s free drink, birthday gifts, free with, free add-ons): kind discount_amount, reason_code loyalty_tier_perk, applied_by the caller, authorized_by the privilege''s maker; rows that no longer match go. 0445: loyalty_perk_lines is rewritten from app.loyalty_perks_detail on every refresh of an open bill, and a court-hour gift on the bill''s booking follows the card (app.loyalty_court_gift_sync; changed is true when it moved). State-idempotent on the money: a refresh that changes nothing writes no adjustment, and a settled, void or merged bill is left as it is. 0037 guard: on a part-paid bill a change that would take the total below what was paid is not made and is answered {refused: DISCOUNT_REQUIRES_REFUND} (its detail rows are cleared). Returns {changed, amount_iqd, lines, refused?}. Audited loyalty.perks_apply when the money changes.';

revoke all on function app.loyalty_perks_refresh(uuid, text) from public, anon;
grant execute on function app.loyalty_perks_refresh(uuid, text) to authenticated;

-- The drink card at the settle: paid stamping units stamp, a free drink spends.
create or replace function app.trg_loyalty_stamps() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_stamps_0445$
declare
  v_tab      tabs%rowtype;
  v_customer uuid;
  v_units    int;
  v_spent    int;
begin
  if not coalesce((select s.enabled from loyalty_settings s where s.id), false)
     or not coalesce((select c.enabled from loyalty_stamp_card c where c.id), false) then
    return null;
  end if;
  select * into v_tab from tabs where id = new.id;
  if not found or v_tab.status <> 'settled' then
    return null;
  end if;
  v_customer := app.tab_customer(v_tab.id);
  if v_customer is null then
    return null;
  end if;

  -- Paid units of stamping lines: the line's quantity less the units a card
  -- privilege freed whole (drink card, gift, free with).
  select coalesce(sum(greatest(oi.qty - coalesce((select sum(l.units)
                                                    from loyalty_perk_lines l
                                                   where l.tab_id = v_tab.id and l.order_item_id = oi.id
                                                     and l.kind in ('stamp', 'gift', 'free_with')), 0), 0)), 0)::int
    into v_units
    from orders o
    join order_items oi on oi.order_id = o.id
   where o.tab_id = v_tab.id and o.status <> 'voided' and not oi.voided
     and oi.qty > 0 and oi.line_total_iqd > 0
     and app.loyalty_item_stamps(oi.menu_item_id);
  if v_units > 0 then
    insert into loyalty_stamps (profile_id, tab_id, kind, delta)
    values (v_customer, v_tab.id, 'earn', v_units)
    on conflict (kind, tab_id) do nothing;
  end if;

  -- A free drink the bill carried (its line still live and still discounted).
  select coalesce(sum(l.stamps_spent), 0)::int into v_spent
    from loyalty_perk_lines l
    join order_items oi on oi.id = l.order_item_id
    join orders o on o.id = oi.order_id
   where l.tab_id = v_tab.id and l.kind = 'stamp' and not oi.voided and o.status <> 'voided'
     and exists (select 1 from tab_adjustments a
                  where a.tab_id = v_tab.id and a.order_item_id = l.order_item_id
                    and a.reason_code = 'loyalty_tier_perk');
  if v_spent > 0 then
    insert into loyalty_stamps (profile_id, tab_id, kind, delta)
    values (v_customer, v_tab.id, 'redeem', -v_spent)
    on conflict (kind, tab_id) do nothing;
  end if;
  return null;
end $trg_loyalty_stamps_0445$;

comment on function app.trg_loyalty_stamps() is
  '0445. Deferred trigger tabs_loyalty_stamps (a tab first settles): while loyalty and the drink card are on and the tab has a customer, writes loyalty_stamps (earn: the paid units of stamping lines, less the units a drink card, gift or free with line freed; redeem: minus the stamps_spent of a drink card line the bill still carries). One of each per tab (loyalty_stamps_once). A refund after the settle does not take stamps back.';

revoke all on function app.trg_loyalty_stamps() from public, anon, authenticated;

drop trigger if exists tabs_loyalty_stamps on public.tabs;
create constraint trigger tabs_loyalty_stamps after update of status on public.tabs
  deferrable initially deferred
  for each row when (new.status = 'settled' and old.status is distinct from 'settled')
  execute function app.trg_loyalty_stamps();

-- ===========================================================================
-- 4. Owner writes and reads
-- ===========================================================================

-- loyalty_perks_json: re-created from 20261112000410_loyalty_deals_perks.sql:244
-- with config on both views.
create or replace function app.loyalty_perks_json(p_tier uuid, p_all boolean default false) returns jsonb
language sql stable security definer set search_path = public as $loyalty_perks_json_0445$
  select coalesce(jsonb_agg(
           case when p_all then
             jsonb_build_object('id', k.id, 'tier_id', k.tier_id, 'kind', k.kind,
                                'name_en', k.name_en, 'name_ar', k.name_ar,
                                'modifier_group_ids', to_jsonb(k.modifier_group_ids),
                                'config', k.config,   -- 0445
                                'active', k.active, 'sort', k.sort)
           else
             jsonb_build_object('id', k.id, 'kind', k.kind, 'name_en', k.name_en, 'name_ar', k.name_ar,
                                'config', k.config)   -- 0445
           end
           order by k.sort, k.created_at, k.id), '[]'::jsonb)
    from loyalty_tier_perks k
   where k.tier_id = p_tier and (p_all or k.active)
$loyalty_perks_json_0445$;

comment on function app.loyalty_perks_json(uuid, boolean) is
  '0410, config since 0445. Internal: one tier''s privileges in order (sort, then age). p_all false: the active ones as a guest reads them [{id, kind, name_en, name_ar, config}]; true: every row for the owner [{id, tier_id, kind, name_en, name_ar, modifier_group_ids, config, active, sort}].';

revoke all on function app.loyalty_perks_json(uuid, boolean) from public, anon, authenticated;

-- upsert_loyalty_tier_perk: re-created from
-- 20261112000410_loyalty_deals_perks.sql:619. Changes marked 0445: the four
-- new kinds and their config.
create or replace function app.upsert_loyalty_tier_perk(p_perk jsonb) returns jsonb
language plpgsql security definer set search_path = public as $upsert_loyalty_tier_perk_0445$
declare
  v_id     uuid;
  v_tier   uuid;
  v_kind   text;
  v_groups uuid[];
  v_old    loyalty_tier_perks%rowtype;
  v_row    loyalty_tier_perks%rowtype;
  v_in     jsonb;    -- 0445
  v_config jsonb;    -- 0445
  v_a      uuid[];   -- 0445
  v_b      uuid[];   -- 0445
  v_c      uuid[];   -- 0445
  v_d      uuid[];   -- 0445
  v_n      int;      -- 0445
  v_when   text;     -- 0445
  v_target text;     -- 0445
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
    -- Only free add-ons carry groups.
    if v_kind <> 'free_addons' then
      v_groups := '{}';
    end if;

    -- 0445: the config, checked by kind. A config left out on an update of
    -- the same kind (the On switch) keeps the row's own unchecked: a menu
    -- item deleted since must not block switching it off or on.
    v_in := case when p_perk ? 'config' then p_perk->'config' else '{}'::jsonb end;
    if not (p_perk ? 'config') and v_old.id is not null and v_old.kind = v_kind then
      v_config := v_old.config;
    elsif v_in is null or jsonb_typeof(v_in) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config';
    elsif v_kind = 'gift' then
      v_when := coalesce(v_in->>'when', 'birthday');
      if v_when not in ('birthday', 'monthly', 'card_up') then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.when';
      end if;
      v_target := coalesce(v_in->>'target', 'items');
      if v_target not in ('items', 'court_hour') then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.target';
      end if;
      v_a := '{}'; v_b := '{}';
      if v_target = 'items' then
        v_a := app.jsonb_uuids(v_in->'categoryIds');
        v_b := app.jsonb_uuids(v_in->'itemIds');
        if cardinality(v_a) + cardinality(v_b) = 0 then
          raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.categoryIds';
        end if;
        if (select count(*) from menu_categories c where c.id = any(v_a)) <> cardinality(v_a) then
          raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.categoryIds';
        end if;
        if (select count(*) from menu_items mi where mi.id = any(v_b)) <> cardinality(v_b) then
          raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.itemIds';
        end if;
      end if;
      v_n := case v_when when 'birthday' then coalesce((v_in->>'days')::int, 7)
                         when 'card_up' then coalesce((v_in->>'days')::int, 30) end;
      if (v_when = 'birthday' and v_n not between 1 and 31) or (v_when = 'card_up' and v_n not between 1 and 90) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.days';
      end if;
      v_config := jsonb_strip_nulls(jsonb_build_object('when', v_when, 'target', v_target,
                                                       'categoryIds', to_jsonb(v_a), 'itemIds', to_jsonb(v_b),
                                                       'days', v_n));
    elsif v_kind = 'size_upgrade' then
      v_a := app.jsonb_uuids(v_in->'categoryIds');
      v_b := app.jsonb_uuids(v_in->'itemIds');
      if cardinality(v_a) + cardinality(v_b) = 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.categoryIds';
      end if;
      if (select count(*) from menu_categories c where c.id = any(v_a)) <> cardinality(v_a) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.categoryIds';
      end if;
      if (select count(*) from menu_items mi where mi.id = any(v_b)) <> cardinality(v_b) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.itemIds';
      end if;
      v_config := jsonb_build_object('categoryIds', to_jsonb(v_a), 'itemIds', to_jsonb(v_b));
    elsif v_kind = 'free_with' then
      v_a := app.jsonb_uuids(v_in->'triggerCategoryIds');
      v_b := app.jsonb_uuids(v_in->'triggerItemIds');
      v_c := app.jsonb_uuids(v_in->'freeCategoryIds');
      v_d := app.jsonb_uuids(v_in->'freeItemIds');
      if cardinality(v_a) + cardinality(v_b) = 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.triggerCategoryIds';
      end if;
      if cardinality(v_c) + cardinality(v_d) = 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.freeItemIds';
      end if;
      if (select count(distinct c.id) from menu_categories c where c.id = any(v_a || v_c))
         <> (select count(distinct x) from unnest(v_a || v_c) x) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.categoryIds';
      end if;
      if (select count(distinct mi.id) from menu_items mi where mi.id = any(v_b || v_d))
         <> (select count(distinct x) from unnest(v_b || v_d) x) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.itemIds';
      end if;
      v_config := jsonb_build_object('triggerCategoryIds', to_jsonb(v_a), 'triggerItemIds', to_jsonb(v_b),
                                     'freeCategoryIds', to_jsonb(v_c), 'freeItemIds', to_jsonb(v_d));
    elsif v_kind = 'frame' then
      if coalesce(v_in->>'frameId', '') not in ('card-green', 'card-blue', 'card-black') then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.frameId';
      end if;
      v_config := jsonb_build_object('frameId', v_in->>'frameId');
    elsif v_kind = 'stamp_size' then
      v_n := (v_in->>'size')::int;
      if v_n is null or v_n not between 2 and 20 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'config.size';
      end if;
      v_config := jsonb_build_object('size', v_n);
    else
      v_config := '{}'::jsonb;
    end if;

    if v_id is not null then
      update loyalty_tier_perks
         set tier_id            = coalesce(v_tier, tier_id),
             kind               = v_kind,
             name_en            = coalesce(app.safe_line(p_perk->>'name_en'), name_en),
             name_ar            = coalesce(app.safe_line(p_perk->>'name_ar'), name_ar),
             modifier_group_ids = coalesce(v_groups, modifier_group_ids),
             config             = v_config,   -- 0445
             active             = coalesce((p_perk->>'active')::boolean, active),
             sort               = coalesce((p_perk->>'sort')::smallint, sort),
             updated_at         = now()
       where id = v_id
      returning * into v_row;
    else
      insert into loyalty_tier_perks (tier_id, kind, name_en, name_ar, modifier_group_ids, config, active, sort, created_by)
      values (v_tier, v_kind, app.safe_line(p_perk->>'name_en'), app.safe_line(p_perk->>'name_ar'),
              coalesce(v_groups, '{}'), v_config, coalesce((p_perk->>'active')::boolean, true),
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

  -- 0445: a ring this change takes from a card comes off its wearers.
  if v_old.kind = 'frame' or v_row.kind = 'frame' then
    perform app.card_frame_reset(null);
  end if;

  perform app.write_audit('loyalty.perk', 'loyalty_tier_perks', v_row.id::text,
                          case when v_old.id is not null then to_jsonb(v_old) end, to_jsonb(v_row), null, null, null);
  return jsonb_build_object('id', v_row.id, 'tier_id', v_row.tier_id, 'kind', v_row.kind,
                            'name_en', v_row.name_en, 'name_ar', v_row.name_ar,
                            'modifier_group_ids', to_jsonb(v_row.modifier_group_ids),
                            'config', v_row.config,   -- 0445
                            'active', v_row.active, 'sort', v_row.sort);
end $upsert_loyalty_tier_perk_0445$;

comment on function app.upsert_loyalty_tier_perk(jsonb) is
  '0410, five more kinds since 0445. Owner: creates a tier privilege (no id; tier_id, kind and both names needed) or updates one (id; absent keys kept) from {id?, tier_id, kind, name_en, name_ar (1 to 80 characters, what guests read), modifier_group_ids (free_addons only; empty or absent = every add-on), config (0445, by kind: gift {when birthday | monthly | card_up (default birthday), target items | court_hour (default items), categoryIds, itemIds (target items: one of the two at least), days (birthday 1..31, default 7; card_up 1..90, default 30; monthly none)}; size_upgrade {categoryIds, itemIds, one at least}; free_with {triggerCategoryIds | triggerItemIds, freeCategoryIds | freeItemIds, at least one of each side}; frame {frameId card-green | card-blue | card-black}; stamp_size {size 2..20}; ignored for free_addons and custom; left out on an update of the same kind = kept), active, sort}. INVALID_ARGUMENT (p_perk, an unknown id, tier_id, modifier group, menu category or item, or a config key, detail names it), INVALID_VALUE (what the table refuses: an unknown kind, a missing or too long name). Bills pick the change up at their next refresh (app.loyalty_perks_refresh); a frame change takes the ring off anyone whose card no longer unlocks it. Returns the privilege {id, tier_id, kind, name_en, name_ar, modifier_group_ids, config, active, sort}. Audited loyalty.perk.';

revoke all on function app.upsert_loyalty_tier_perk(jsonb) from public, anon;
grant execute on function app.upsert_loyalty_tier_perk(jsonb) to authenticated;

-- delete_loyalty_tier_perk: re-created from
-- 20261112000410_loyalty_deals_perks.sql:706 with the ring reset.
create or replace function app.delete_loyalty_tier_perk(p_perk_id uuid) returns void
language plpgsql security definer set search_path = public as $delete_loyalty_tier_perk_0445$
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
  -- 0445: a ring no card unlocks any more comes off its wearers.
  if v_old.kind = 'frame' then
    perform app.card_frame_reset(null);
  end if;
  perform app.write_audit('loyalty.perk_delete', 'loyalty_tier_perks', v_old.id::text, to_jsonb(v_old), null, null, null, null);
end $delete_loyalty_tier_perk_0445$;

comment on function app.delete_loyalty_tier_perk(uuid) is
  '0410, the ring reset since 0445. Owner: removes one tier privilege (INVALID_ARGUMENT for an unknown id). What it freed on open bills goes at their next refresh; settled bills keep what they carried; a removed frame privilege takes the ring off anyone whose card no longer unlocks it. Audited loyalty.perk_delete.';

revoke all on function app.delete_loyalty_tier_perk(uuid) from public, anon;
grant execute on function app.delete_loyalty_tier_perk(uuid) to authenticated;

-- The drink card's settings.
create or replace function app.stamp_card_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $stamp_card_settings_0445$
declare
  c loyalty_stamp_card%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into c from loyalty_stamp_card where id;
  return jsonb_build_object('enabled', coalesce(c.enabled, false), 'size', coalesce(c.size, 8),
                            'category_ids', to_jsonb(coalesce(c.category_ids, '{}'::uuid[])),
                            'excluded_item_ids', to_jsonb(coalesce(c.excluded_item_ids, '{}'::uuid[])),
                            'updated_at', c.updated_at);
end $stamp_card_settings_0445$;

comment on function app.stamp_card_settings() is
  '0445. Manager or owner: the drink card {enabled, size, category_ids, excluded_item_ids, updated_at} for Setup > Loyalty.';

revoke all on function app.stamp_card_settings() from public, anon;
grant execute on function app.stamp_card_settings() to authenticated;

create or replace function app.set_stamp_card(p_card jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_stamp_card_0445$
declare
  v_old  loyalty_stamp_card%rowtype;
  v_row  loyalty_stamp_card%rowtype;
  v_cats uuid[];
  v_ex   uuid[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_card';
  end if;
  select * into v_old from loyalty_stamp_card where id for update;
  if p_card ? 'category_ids' then
    v_cats := app.jsonb_uuids(p_card->'category_ids');
    if (select count(*) from menu_categories c where c.id = any(v_cats)) <> cardinality(v_cats) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'category_ids';
    end if;
  end if;
  if p_card ? 'excluded_item_ids' then
    v_ex := app.jsonb_uuids(p_card->'excluded_item_ids');
    if (select count(*) from menu_items mi where mi.id = any(v_ex)) <> cardinality(v_ex) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'excluded_item_ids';
    end if;
  end if;
  begin
    update loyalty_stamp_card
       set enabled           = coalesce((p_card->>'enabled')::boolean, enabled),
           size              = coalesce((p_card->>'size')::smallint, size),
           category_ids      = coalesce(v_cats, category_ids),
           excluded_item_ids = coalesce(v_ex, excluded_item_ids),
           updated_at        = now(),
           updated_by        = auth.uid()
     where id
    returning * into v_row;
  exception
    when others then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;
  if v_row.enabled and cardinality(v_row.category_ids) = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'category_ids',
      hint = 'a drink card that is on needs at least one stamping category';
  end if;
  perform app.write_audit('loyalty.stamp_card', 'loyalty_stamp_card', 'true', to_jsonb(v_old), to_jsonb(v_row), null, null, null);
  return jsonb_build_object('enabled', v_row.enabled, 'size', v_row.size,
                            'category_ids', to_jsonb(v_row.category_ids),
                            'excluded_item_ids', to_jsonb(v_row.excluded_item_ids),
                            'updated_at', v_row.updated_at);
end $set_stamp_card_0445$;

comment on function app.set_stamp_card(jsonb) is
  '0445. Owner: sets the drink card from {enabled, size (2..20), category_ids, excluded_item_ids} (absent keys kept). INVALID_ARGUMENT (p_card, an unknown category or item, or category_ids empty while enabled), INVALID_VALUE (a size outside 2..20). Stamps already earned stay. Returns the card as app.stamp_card_settings does. Audited loyalty.stamp_card.';

revoke all on function app.set_stamp_card(jsonb) from public, anon;
grant execute on function app.set_stamp_card(jsonb) to authenticated;

-- ===========================================================================
-- 5. What the member sees, and what the till sees
-- ===========================================================================

create or replace function app.loyalty_extras_json(p_profile uuid, p_venue uuid, p_with_dates boolean)
returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_extras_json_0445$
declare
  v_on    boolean;
  v_card  boolean;
  v_size  int;
  v_bal   int;
  v_held  boolean;
  v_birth date;
  v_set   timestamptz;
begin
  v_on := coalesce((select s.enabled from loyalty_settings s where s.id), false);
  v_card := v_on and coalesce((select c.enabled from loyalty_stamp_card c where c.id), false);
  v_size := app.loyalty_stamp_size(p_profile);
  v_bal := app.loyalty_stamp_balance(p_profile);
  v_held := exists (select 1 from loyalty_perk_lines l join tabs t on t.id = l.tab_id
                     where l.profile_id = p_profile and l.kind = 'stamp'
                       and t.status in ('open', 'awaiting_payment') and t.merged_into_tab_id is null);
  select p.birth_date, p.birth_date_set_at into v_birth, v_set from profiles p where p.id = p_profile;

  return jsonb_build_object(
    'stamps', jsonb_build_object('enabled', v_card, 'count', greatest(v_bal, 0), 'size', v_size,
                                 'ready', v_card and v_bal >= v_size, 'held', v_held,
                                 'claimed_until', case when v_card and v_bal >= v_size
                                                       then app.loyalty_claim_until(p_profile, 'stamp', null) end),
    'birthday', jsonb_build_object(
      'has_date', v_birth is not null,
      'gifts', coalesce((select jsonb_agg(jsonb_build_object(
                                  'perk_id', g.perk_id, 'name_en', g.name_en, 'name_ar', g.name_ar,
                                  'target', g.target,
                                  'window_from', case when p_with_dates then g.window_from end,
                                  'window_to', case when p_with_dates then g.window_to end,
                                  'eligible', g.eligible, 'used', g.used,
                                  'claimed_until', g.claimed_until))
                           from app.loyalty_card_gifts(p_profile, p_venue, null, null) g
                          where g.gift_when = 'birthday'), '[]'::jsonb),
      -- The guest only: when a newly set date starts counting.
      'counts_from', case when p_with_dates and v_set is not null then ((v_set at time zone 'Asia/Baghdad')::date + 30) end,
      'gifts_on_card', coalesce((select jsonb_agg(jsonb_build_object('perk_id', k.id, 'name_en', k.name_en, 'name_ar', k.name_ar,
                                                                    'target', coalesce(k.config->>'target', 'items'),
                                                                    'days', coalesce((k.config->>'days')::int, 7))
                                                  order by t.min_points_12m, k.sort, k.created_at)
                                   from loyalty_tier_perks k join loyalty_tiers t on t.id = k.tier_id
                                  where v_on and k.active and k.kind = 'gift'
                                    and coalesce(k.config->>'when', 'birthday') = 'birthday'
                                    and t.min_points_12m <= app.loyalty_tier_floor(p_profile)), '[]'::jsonb)),
    -- The other gifts open now (monthly, card-up): no birth date in them.
    'gifts', coalesce((select jsonb_agg(jsonb_build_object(
                                'perk_id', g.perk_id, 'name_en', g.name_en, 'name_ar', g.name_ar,
                                'when', g.gift_when, 'target', g.target, 'window_to', g.window_to,
                                'used', g.used, 'claimed_until', g.claimed_until) order by g.window_to, g.perk_id)
                         from app.loyalty_card_gifts(p_profile, p_venue, null, null) g
                        where g.gift_when <> 'birthday'), '[]'::jsonb));
end $loyalty_extras_json_0445$;

comment on function app.loyalty_extras_json(uuid, uuid, boolean) is
  '0445. Internal: {stamps {enabled (loyalty and the drink card on), count, size (app.loyalty_stamp_size), ready (count >= size), held (an open bill of theirs carries the free drink), claimed_until (while ready: until when their Redeem press holds, else NULL)}, birthday {has_date, gifts (the gifts whose window holds today: {perk_id, name_en, name_ar, window_from, window_to (p_with_dates only), eligible, used, claimed_until}), counts_from (p_with_dates only: the day a birth date set or changed starts counting, set + 30 days), gifts_on_card (every birthday gift the card holds: {perk_id, name_en, name_ar, target, days})}, gifts (the monthly and card-up gifts open now: {perk_id, name_en, name_ar, when, target items | court_hour, window_to, used, claimed_until})}; each birthday gift also carries its target.';

revoke all on function app.loyalty_extras_json(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function app.my_card_extras(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $my_card_extras_0445$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = v_uid and p.deleted_at is null)
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  return app.loyalty_extras_json(v_uid,
                                 coalesce(p_venue_id, (select v.id from venues v where v.is_active order by v.created_at limit 1)),
                                 true);
end $my_card_extras_0445$;

comment on function app.my_card_extras(uuid) is
  '0445. The signed-in guest''s drink card and birthday gifts (app.loyalty_extras_json with dates), the birthday window read in p_venue_id''s time zone (default: the first open branch). AUTH_REQUIRED, ACCOUNT_REQUIRED (anonymous session or deleted account).';

revoke all on function app.my_card_extras(uuid) from public, anon;
grant execute on function app.my_card_extras(uuid) to authenticated;

create or replace function app.loyalty_card_extras(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_card_extras_0445$
declare
  v_venue uuid;
begin
  if not app.is_staff('court_desk', 'cashier', 'shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_profile_id is null or not exists (select 1 from profiles p where p.id = p_profile_id and p.deleted_at is null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_profile_id';
  end if;
  v_venue := coalesce(app.current_venue_or_default(), (select v.id from venues v where v.is_active order by v.created_at limit 1));
  return app.loyalty_extras_json(p_profile_id, v_venue, false);
end $loyalty_card_extras_0445$;

comment on function app.loyalty_card_extras(uuid) is
  '0445. Desk and till staff (court_desk, cashier, shop_staff, manager, owner): a member''s drink card and the birthday gifts open today (app.loyalty_extras_json without dates: no birth date, no window dates). INVALID_ARGUMENT for an unknown or deleted profile.';

revoke all on function app.loyalty_card_extras(uuid) from public, anon;
grant execute on function app.loyalty_card_extras(uuid) to authenticated;

-- ===========================================================================
-- 6. Profile reads and writes
-- ===========================================================================

-- app.my_frames: re-created from 20261007000318_frame_grants.sql:50. Changes
-- marked 0445: a card ring is unlocked by the member's card and names it.
create or replace function app.my_frames()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_frames_0445$
declare
  v_uid     uuid := auth.uid();
  v_frame   text;
  v_style   text;
  v_played  int;
  v_won     int;
  v_granted boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select avatar_frame, avatar_frame_style into v_frame, v_style
    from profiles where id = v_uid and deleted_at is null;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  v_played  := app.matches_played(v_uid);
  v_won     := app.tournaments_won(v_uid);
  v_granted := exists (select 1 from frame_grants g where g.profile_id = v_uid);

  return jsonb_build_object(
    'current', v_frame,
    'style', v_style,
    'played', v_played,
    'tournaments_won', v_won,
    'frames', (
      select jsonb_agg(
               jsonb_build_object(
                 'id', f,
                 'goal', g.goal,
                 'progress', g.progress,
                 'unlocked', v_granted
                             or case when f like 'card-%' then app.card_frame_unlocked(v_uid, f)   -- 0445
                                     else coalesce(g.progress >= g.goal, true) end,
                 'card', case when f like 'card-%' then (   -- 0445: the lowest card that unlocks it
                           select jsonb_build_object('tier_id', t.id, 'name_en', t.name_en,
                                                     'name_ar', t.name_ar, 'color', t.color)
                             from loyalty_tier_perks k join loyalty_tiers t on t.id = k.tier_id
                            where k.active and k.kind = 'frame' and k.config->>'frameId' = f
                            order by t.min_points_12m limit 1) end)
               order by o)
        from unnest(app.frame_ids()) with ordinality as x(f, o)
        left join lateral (
          select case f when 'regular' then 10 when 'silver-racket' then 50
                        when 'gold-racket' then 100 when 'champion' then 1 end as goal,
                 case f when 'champion' then v_won
                        when 'regular' then v_played when 'silver-racket' then v_played
                        when 'gold-racket' then v_played end as progress
        ) g on true));
end $my_frames_0445$;

comment on function app.my_frames() is
  '0314, progress since 0316, style since 0317, frame_grants since 0318, card rings since 0445. The caller''s frame picker: {current, style, played, tournaments_won, frames: [{id, goal, progress, unlocked, card}]} in the closed list''s order; goal and progress are NULL for a free frame (always unlocked) and a card ring; a card ring is unlocked while the caller''s loyalty card holds a frame privilege naming it, and card names the lowest card that does ({tier_id, name_en, name_ar, color}, NULL when none does, so the ring is not on offer); every frame is unlocked for a profile in frame_grants.';

revoke all on function app.my_frames() from public, anon;
grant execute on function app.my_frames() to authenticated;

-- app.set_my_birth_date: re-created from
-- 20261004000302_profile_avatar_birth_date.sql. 0445: a change stamps
-- birth_date_set_at.
create or replace function app.set_my_birth_date(p_birth_date date)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_birth_date_0445$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if p_birth_date is not null
     and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_birth_date', hint = 'p_birth_date';
  end if;

  update profiles
     set birth_date = p_birth_date,
         birth_date_set_at = case when p_birth_date is null then null else now() end   -- 0445
   where id = v_uid and birth_date is distinct from p_birth_date;

  return jsonb_build_object('birth_date', p_birth_date);
end $set_my_birth_date_0445$;

comment on function app.set_my_birth_date(date) is
  '0302, birth_date_set_at since 0445. The caller''s own profile: sets the optional date of birth (1900-01-01 .. today, INVALID_ARGUMENT hint p_birth_date otherwise) or clears it with NULL. A change stamps birth_date_set_at (a birthday gift counts 30 days after it). Returns {birth_date}.';

revoke all on function app.set_my_birth_date(date) from public, anon;
grant execute on function app.set_my_birth_date(date) to authenticated;

-- loyalty_tab_benefits: re-created from
-- 20261112000410_loyalty_deals_perks.sql:930. 0445: each privilege carries
-- its config, and the bill's detail lines come with it.
create or replace function app.loyalty_tab_benefits(p_tab_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_tab_benefits_0445$
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
      'lines', '[]'::jsonb,   -- 0445
      'court_gift', null,     -- 0445
      'deal', null);
  end if;

  v_floor := app.loyalty_tier_floor(v_customer);
  select a.tier_id into v_tier from loyalty_accounts a where a.profile_id = v_customer;
  v_pick := app.loyalty_picked_deal(v_customer);

  select coalesce(sum(pl.amount_iqd), 0) into v_due from app.loyalty_perks_plan(p_tab_id) pl;
  v_differs := exists (
      (select a.order_item_id, a.amount_iqd::bigint from tab_adjustments a
        where a.tab_id = p_tab_id and a.reason_code = 'loyalty_tier_perk')
      except all
      (select pl.order_item_id, pl.amount_iqd from app.loyalty_perks_plan(p_tab_id) pl))
    or exists (
      (select pl.order_item_id, pl.amount_iqd from app.loyalty_perks_plan(p_tab_id) pl)
      except all
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
               'config', k.config,   -- 0445
               'tier_id', t.id, 'tier_name_en', t.name_en, 'tier_name_ar', t.name_ar, 'tier_color', t.color)
               order by t.min_points_12m desc, k.sort, k.created_at, k.id)
        from loyalty_tier_perks k
        join loyalty_tiers t on t.id = k.tier_id
       where k.active and t.min_points_12m <= v_floor), '[]'::jsonb) end,
    'addons', jsonb_build_object('on_bill_iqd', v_on_bill, 'due_iqd', v_due,
                                 'needs_refresh', v_open and v_differs),
    -- 0445: the court hour a card gift took off the bill's booking.
    'court_gift', (select jsonb_build_object('perk_id', g.perk_id, 'name_en', k.name_en, 'name_ar', k.name_ar,
                                             'amount_iqd', g.amount_iqd)
                     from reservation_card_gifts g left join loyalty_tier_perks k on k.id = g.perk_id
                    where g.reservation_id = v_tab.reservation_id),
    -- 0445: what each line carries and why (the kept detail of the last refresh).
    'lines', coalesce((select jsonb_agg(jsonb_build_object('order_item_id', l.order_item_id, 'kind', l.kind,
                                                           'perk_id', l.perk_id, 'units', l.units,
                                                           'amount_iqd', l.amount_iqd)
                                        order by l.created_at, l.id)
                         from loyalty_perk_lines l where l.tab_id = p_tab_id), '[]'::jsonb),
    'deal', (select jsonb_build_object(
                      'promotion_id', p.id, 'name_en', p.name_en, 'name_ar', p.name_ar,
                      'type', p.type, 'value', p.value,
                      'applied', exists (select 1 from tab_adjustments a
                                          where a.tab_id = p_tab_id and a.promotion_id = p.id))
               from promotions p
              where p.id = v_pick and p.enabled and p.in_app
                and (p.venue_id is null or p.venue_id = v_tab.venue_id)));
end $loyalty_tab_benefits_0445$;

comment on function app.loyalty_tab_benefits(uuid) is
  '0410, config and lines since 0445. court_desk, cashier, shop_staff, manager, owner at the tab''s branch (TAB_NOT_FOUND, VENUE_MISMATCH): what the tab customer''s card gives on this bill. {tab_id, customer_id (app.tab_customer) | null, enabled (the loyalty switch), tier {id, name_en, name_ar, multiplier, color, min_points_12m} | null, perks (every active privilege of their tier and the tiers below, highest tier first: {id, kind, name_en, name_ar, config, tier_id, tier_name_en, tier_name_ar, tier_color}; empty while loyalty is off), addons {on_bill_iqd (what the card frees on the bill''s live lines now), due_iqd (what it should come to, app.loyalty_perks_plan), needs_refresh (an open bill whose rows differ from the plan: app.loyalty_perks_refresh would change something)}, lines (0445: loyalty_perk_lines of the bill, {order_item_id, kind stamp | gift | free_with | size_upgrade | free_addons, perk_id, units, amount_iqd}), court_gift (0445: the court hour a card gift took off the bill''s booking {perk_id, name_en, name_ar, amount_iqd} | null), deal (the listed deal the member picked in the app, when it runs at this branch: {promotion_id, name_en, name_ar, type, value, applied}) | null}. Read-only.';

revoke all on function app.loyalty_tab_benefits(uuid) from public, anon;
grant execute on function app.loyalty_tab_benefits(uuid) to authenticated;

-- ===========================================================================
-- 7. Account merge: the drink card, the bill detail and a booking's card gift
--    follow their member
-- ===========================================================================

-- profile_merge_columns: re-issued from 20261113000415_loyalty_reward_vouchers.sql:703.
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0445$
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
    (250, 'public', 'loyalty_reward_vouchers', 'profile_id',          'repoint'),   -- 0415
    (252, 'public', 'loyalty_stamps',        'profile_id',            'repoint'),   -- 0445
    (254, 'public', 'loyalty_perk_lines',    'profile_id',            'repoint'),   -- 0445
    (256, 'public', 'reservation_card_gifts', 'profile_id',           'repoint'),   -- 0445
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
    (425, 'public', 'loyalty_reward_claims', 'profile_id',            'drop_only'),   -- 0445 Redeem in the app
    (426, 'public', 'loyalty_deal_vouchers', 'profile_id',            'drop_only'),   -- 0445 a deal's own QR
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
$profile_merge_columns_0445$;

comment on function app.profile_merge_columns() is
  '0303, 0307, username_holds since 0314, frame_grants since 0320, customer_discounts and reservation_court_discounts since 0347, game_results and ranks_ledger since 0364, profiles.level_confirmed_by since 0368, reservation_loyalty_rewards.profile_id since 0403, loyalty_reward_vouchers.profile_id since 0415, loyalty_stamps, loyalty_perk_lines and reservation_card_gifts.profile_id since 0445 (repoint; loyalty_reward_claims.profile_id and loyalty_deal_vouchers.profile_id drop_only: a pending Redeem press or a 15-minute deal code goes with the dropped account). Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;

-- ===========================================================================
-- 8. Redeem in the app, and buy-one-get-one deals (Majed, 2026-11-15)
--
--    "Make the rewards from the drink card ... a redeem now button, not go
--    ask the cashier for it. Same thing whenever you reach a new card, same
--    thing on your birthday." A free drink and every card gift wait until the
--    member presses Redeem (app.claim_card_reward) or a till gives it for them
--    (app.claim_card_reward_for_tab, for a member without the app): the bill
--    engine reads app.loyalty_claim_until (sections 1-3 above).
--
--    "If it's more like buy this get this": promotions.type free_item. value
--    is the percent off each unit given (100 = free); scope itemIds |
--    categoryIds is what is given, buyItemIds | buyCategoryIds (or a court
--    booking, courtIds) is what earns it, perBill how many units one bill may
--    get. The cheapest matching units are given, one per earning unit; a unit
--    is never both. app.promotion_base_iqd prices it, so eligible_promotions
--    and apply_best_promotion are untouched (the adjustment is written as
--    discount_amount; its value column keeps the promotion's percent, the
--    money is amount_iqd as for every promotion). The owner sets it up in the
--    operator's promotion editor, and my_deals tells the phone what the deal
--    looks like (app.deal_look_json).
-- ===========================================================================

do $promotions_free_item_0445$
begin
  if exists (select 1 from pg_constraint
              where conname = 'promotions_type_check' and conrelid = 'public.promotions'::regclass
                and pg_get_constraintdef(oid) not like '%free_item%') then
    alter table promotions drop constraint promotions_type_check;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'promotions_type_check' and conrelid = 'public.promotions'::regclass) then
    alter table promotions add constraint promotions_type_check
      check (type in ('percent', 'amount', 'free_item')) not valid;
  end if;

  if exists (select 1 from pg_constraint
              where conname = 'promotions_value_chk' and conrelid = 'public.promotions'::regclass
                and pg_get_constraintdef(oid) not like '%free_item%') then
    alter table promotions drop constraint promotions_value_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'promotions_value_chk' and conrelid = 'public.promotions'::regclass) then
    alter table promotions add constraint promotions_value_chk check (
      (type = 'percent' and value between 1 and 99) or (type = 'amount' and value > 0)
      or (type = 'free_item' and value between 1 and 100)) not valid;
  end if;

  -- Menu ids belong to one branch: a chain-wide promotion names none, on the
  -- buy side either.
  if exists (select 1 from pg_constraint
              where conname = 'promotions_chain_scope_chk' and conrelid = 'public.promotions'::regclass
                and pg_get_constraintdef(oid) not like '%buyItemIds%') then
    alter table promotions drop constraint promotions_chain_scope_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'promotions_chain_scope_chk' and conrelid = 'public.promotions'::regclass) then
    alter table promotions add constraint promotions_chain_scope_chk check (
      venue_id is not null or (
            coalesce(jsonb_array_length(case when jsonb_typeof(scope->'courtIds') = 'array' then scope->'courtIds' end), 0) = 0
        and coalesce(jsonb_array_length(case when jsonb_typeof(scope->'categoryIds') = 'array' then scope->'categoryIds' end), 0) = 0
        and coalesce(jsonb_array_length(case when jsonb_typeof(scope->'itemIds') = 'array' then scope->'itemIds' end), 0) = 0
        and coalesce(jsonb_array_length(case when jsonb_typeof(scope->'buyCategoryIds') = 'array' then scope->'buyCategoryIds' end), 0) = 0
        and coalesce(jsonb_array_length(case when jsonb_typeof(scope->'buyItemIds') = 'array' then scope->'buyItemIds' end), 0) = 0)) not valid;
  end if;
end $promotions_free_item_0445$;

do $promotions_free_item_validate_0445$
begin
  if exists (select 1 from pg_constraint
              where conname = 'promotions_type_check' and conrelid = 'public.promotions'::regclass and not convalidated) then
    alter table promotions validate constraint promotions_type_check;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'promotions_value_chk' and conrelid = 'public.promotions'::regclass and not convalidated) then
    alter table promotions validate constraint promotions_value_chk;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'promotions_chain_scope_chk' and conrelid = 'public.promotions'::regclass and not convalidated) then
    alter table promotions validate constraint promotions_chain_scope_chk;
  end if;
end $promotions_free_item_validate_0445$;

-- promotion_amount_iqd: re-issued from 20260903000067_promotions.sql:177
create or replace function app.promotion_amount_iqd(p_base bigint, p_type text, p_value int)
returns bigint
language plpgsql immutable as $promo_amount_0445$
begin
  if p_base is null or p_base < 0 then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', hint = 'base must be integer IQD >= 0';
  end if;
  if p_type = 'percent' then
    -- 1..99 enforced by apply_pct_discount's own INVALID_PCT (0 is refused
    -- here: a 0 % promotion is not a promotion).
    if p_value is null or p_value < 1 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', hint = 'percent promotions are 1..99';
    end if;
    return p_base - app.apply_pct_discount(p_base, p_value);
  elsif p_type = 'amount' then
    if p_value is null or p_value < 1 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', hint = 'amount promotions are IQD > 0';
    end if;
    return least(p_value::bigint, p_base);
  elsif p_type = 'free_item' then
    -- 0445: the base is what the units given cost (app.promotion_base_iqd);
    -- value is the percent off them, 100 = free.
    if p_value is null or p_value < 1 or p_value > 100 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', hint = 'free_item promotions are 1..100 percent';
    end if;
    if p_value = 100 then
      return p_base;
    end if;
    return p_base - app.apply_pct_discount(p_base, p_value);
  end if;
  raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(p_type, 'null'),
    hint = 'type is percent, amount or free_item';
end $promo_amount_0445$;

revoke all on function app.promotion_amount_iqd(bigint, text, int) from public, anon, authenticated;
grant execute on function app.promotion_amount_iqd(bigint, text, int) to service_role;   -- parity tests

comment on function app.promotion_amount_iqd(bigint, text, int) is
  '0067, 0445. percent => base - app.apply_pct_discount(base, pct); amount => least(value, base); free_item (0445) => the base (what the units given cost) at 100, else base - app.apply_pct_discount(base, value). '
  'Twin of @touch/core promotionDiscountIqd.';

-- promotion_base_iqd: re-issued from 20260903000067_promotions.sql:213
create or replace function app.promotion_base_iqd(p_tab_id uuid, p_scope jsonb)
returns bigint
language plpgsql stable security definer set search_path = public as $promo_base_0445$
declare
  v_items  jsonb := '[]'::jsonb;
  v_cats   jsonb := '[]'::jsonb;
  v_base   bigint;
  v_bitems jsonb := '[]'::jsonb;   -- 0445: the buy side
  v_bcats  jsonb := '[]'::jsonb;
  v_per    int;
  v_units  bigint[];
  v_isbuy  boolean[];
  v_buyn   int;
  v_k      int;
  v_taken  int;
begin
  -- upsert_promotion stores scope canonically (no JSON nulls, no empty
  -- arrays); the typeof checks keep this helper honest on any input.
  if jsonb_typeof(p_scope->'itemIds') = 'array' then
    v_items := p_scope->'itemIds';
  end if;
  if jsonb_typeof(p_scope->'categoryIds') = 'array' then
    v_cats := p_scope->'categoryIds';
  end if;

  -- 0445: a buy-one-get-one (upsert_promotion stores perBill for free_item
  -- only). The base is what the units given cost: the cheapest units of what
  -- is given, at their price after the line's own discounts (so a unit a card
  -- privilege already freed adds nothing), at most perBill of them, and each
  -- needs an earning unit that is not itself given. Earned by a court booking
  -- alone (no buy ids), eligibility's courtIds check is the earning.
  if jsonb_typeof(p_scope->'perBill') = 'number' then
    if jsonb_typeof(p_scope->'buyItemIds') = 'array' then
      v_bitems := p_scope->'buyItemIds';
    end if;
    if jsonb_typeof(p_scope->'buyCategoryIds') = 'array' then
      v_bcats := p_scope->'buyCategoryIds';
    end if;
    v_per := least(greatest((p_scope->>'perBill')::int, 1), 10);

    with units as (
      select oi.id, g.n,
             (greatest(oi.line_total_iqd::bigint
                       - coalesce((select sum(a.amount_iqd)
                                     from tab_adjustments a
                                    where a.tab_id = p_tab_id and a.order_item_id = oi.id
                                      and a.kind in ('discount_percent', 'discount_amount')), 0), 0)
              / greatest(oi.qty, 1))::bigint as unit,
             ((v_bitems ? oi.menu_item_id::text) or (v_bcats ? mi.category_id::text)) as is_buy,
             ((v_items ? oi.menu_item_id::text) or (v_cats ? mi.category_id::text)) as is_get
        from orders o
        join order_items oi on oi.order_id = o.id
        join menu_items mi  on mi.id = oi.menu_item_id
        cross join generate_series(1, greatest(oi.qty, 0)) g(n)
       where o.tab_id = p_tab_id
         and o.status <> 'voided'
         and not oi.voided
    )
    select coalesce(array_agg(u.unit order by u.unit, u.id, u.n) filter (where u.is_get and u.unit > 0), '{}'),
           coalesce(array_agg(u.is_buy order by u.unit, u.id, u.n) filter (where u.is_get and u.unit > 0), '{}'),
           count(*) filter (where u.is_buy)
      into v_units, v_isbuy, v_buyn
      from units u;

    if jsonb_array_length(v_bitems) = 0 and jsonb_array_length(v_bcats) = 0 then
      v_buyn := null;
    end if;
    for v_k in reverse least(v_per, coalesce(array_length(v_units, 1), 0)) .. 1 loop
      select coalesce(sum(x), 0) into v_base from unnest(v_units[1:v_k]) x;
      if v_buyn is null then
        return v_base;
      end if;
      select count(*) into v_taken from unnest(v_isbuy[1:v_k]) b where b;
      if v_buyn - v_taken >= v_k then
        return v_base;
      end if;
    end loop;
    return 0;
  end if;

  if jsonb_array_length(v_items) = 0 and jsonb_array_length(v_cats) = 0 then
    select t.subtotal_iqd into v_base from app.compute_tab_totals(p_tab_id) t;
    return coalesce(v_base, 0);
  end if;

  select coalesce(sum(oi.line_total_iqd), 0) into v_base
    from order_items oi
    join orders o      on o.id  = oi.order_id
    join menu_items mi on mi.id = oi.menu_item_id
   where o.tab_id = p_tab_id
     and o.status <> 'voided'
     and not oi.voided
     and ((v_items ? oi.menu_item_id::text) or (v_cats ? mi.category_id::text));
  return v_base;
end $promo_base_0445$;

revoke all on function app.promotion_base_iqd(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.promotion_base_iqd(uuid, jsonb) to service_role;

comment on function app.promotion_base_iqd(uuid, jsonb) is
  '0067, 0445. The discount base of one promotion on one tab: the goods subtotal, or the live lines its itemIds / categoryIds match; court time is never in it. 0445: a buy-one-get-one scope (perBill stored) is priced by the units given: the cheapest matching units at their price after the line''s own discounts, at most perBill, each needing an earning unit (buyItemIds / buyCategoryIds) that is not itself given; with no buy ids the court booking earns it (eligibility checks courtIds).';

-- upsert_promotion_internal: re-issued from 20261006000309_loyalty_promotions_nightly.sql:264
create or replace function app.upsert_promotion_internal(
  p_id              uuid        default null,
  p_name_en         text        default null,
  p_name_ar         text        default null,
  p_type            text        default null,
  p_value           int         default null,
  p_starts_at       timestamptz default null,
  p_ends_at         timestamptz default null,
  p_weekdays        int[]       default '{}',
  p_hour_from       time        default null,
  p_hour_to         time        default null,
  p_scope           jsonb       default '{}'::jsonb,
  p_limits          jsonb       default '{}'::jsonb,
  p_auto            boolean     default true,
  p_public_code     text        default null,
  p_code_single_use boolean     default false,
  p_enabled         boolean     default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_promotion_internal_0445$
declare
  v_row      promotions%rowtype;
  v_before   jsonb;
  v_scope    jsonb := '{}'::jsonb;
  v_limits   jsonb := '{}'::jsonb;
  v_code     text;
  v_key      text;
  v_ids      uuid[];
  v_n        int;
  v_found    int;
  v_wd       int;
  v_weekdays int[] := coalesce(p_weekdays, '{}');
begin
  -- names
  if coalesce(btrim(p_name_en), '') = '' or coalesce(btrim(p_name_ar), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001',
      hint = 'both English and Arabic names';
  end if;

  -- type + value
  if p_type is null or p_type not in ('percent','amount','free_item') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'type',
      hint = 'type is percent, amount or free_item';
  end if;
  -- 0445: buy one, get one. value is the percent off each unit given, 100 = free.
  if p_type = 'free_item' and (p_value is null or p_value < 1 or p_value > 100) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'value',
      hint = 'free_item promotions take 1..100 percent off the unit given (100 = free)';
  end if;
  if p_type = 'percent' and (p_value is null or p_value < 1 or p_value > 99) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'value',
      hint = 'percent promotions are whole numbers 1..99';
  end if;
  if p_type = 'amount' and (p_value is null or p_value < 1) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'value',
      hint = 'amount promotions are IQD > 0';
  end if;

  -- dates
  if p_starts_at is not null and p_ends_at is not null and p_starts_at >= p_ends_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', detail = 'dates',
      hint = 'ends_at must be after starts_at';
  end if;

  -- weekdays: 0..6, no duplicates
  v_n := coalesce(array_length(v_weekdays, 1), 0);
  if v_n > 0 then
    foreach v_wd in array v_weekdays loop
      if v_wd is null or v_wd < 0 or v_wd > 6 then
        raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001',
          detail = coalesce(v_wd::text, 'null'), hint = '0 = Sunday .. 6 = Saturday';
      end if;
    end loop;
    if v_n <> (select count(distinct d) from unnest(v_weekdays) d) then
      raise exception 'INVALID_WEEKDAYS' using errcode = 'P0001', hint = 'each weekday once';
    end if;
  end if;

  -- hour window: both or neither; a zero-length window is refused
  if (p_hour_from is null) <> (p_hour_to is null) then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', detail = 'hours',
      hint = 'hour_from and hour_to go together';
  end if;
  if p_hour_from is not null and p_hour_from = p_hour_to then
    raise exception 'INVALID_RANGE' using errcode = 'P0001', detail = 'hours',
      hint = 'hour window must not be empty (from > to crosses midnight)';
  end if;

  -- scope: known keys, arrays of existing ids; stored canonical (lower-case
  -- uuid text, empty arrays dropped) so the `?` containment tests in
  -- eligibility are exact.
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope',
      hint = 'scope is an object {courtIds, categoryIds, itemIds, buyCategoryIds, buyItemIds, perBill}';
  end if;
  for v_key in select jsonb_object_keys(p_scope) loop
    if v_key not in ('courtIds','categoryIds','itemIds','buyCategoryIds','buyItemIds','perBill') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'scope keys are courtIds, categoryIds, itemIds, buyCategoryIds, buyItemIds, perBill';
    end if;
    if jsonb_typeof(p_scope->v_key) = 'null' then
      continue;
    end if;
    -- 0445: the buy side and perBill belong to a buy-one-get-one only.
    if v_key in ('buyCategoryIds','buyItemIds','perBill') and p_type <> 'free_item' then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'only a free_item promotion has a buy side';
    end if;
    if v_key = 'perBill' then
      if jsonb_typeof(p_scope->v_key) <> 'number' or (p_scope->>v_key) !~ '^[0-9]{1,2}$'
         or (p_scope->>v_key)::int not between 1 and 10 then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.perBill',
          hint = 'how many units one bill may get: 1..10';
      end if;
      continue;
    end if;
    if jsonb_typeof(p_scope->v_key) <> 'array' then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'an array of ids';
    end if;
    begin
      select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}')
        into v_ids from jsonb_array_elements(p_scope->v_key) e;
    exception when invalid_text_representation then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'ids must be uuids';
    end;
    v_n := coalesce(array_length(v_ids, 1), 0);
    if v_n = 0 then
      continue;
    end if;
    if v_key = 'courtIds' then
      select count(*) into v_found from courts where id = any(v_ids);
    elsif v_key in ('categoryIds','buyCategoryIds') then
      select count(*) into v_found from menu_categories where id = any(v_ids);
    else
      select count(*) into v_found from menu_items where id = any(v_ids);
    end if;
    if v_found <> v_n then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = format('%s of %s ids exist', v_found, v_n);
    end if;
    v_scope := v_scope || jsonb_build_object(v_key, to_jsonb(v_ids));
  end loop;

  -- 0445: a buy-one-get-one names what is given (itemIds | categoryIds) and
  -- what earns it (buyItemIds | buyCategoryIds, or a court booking: courtIds);
  -- perBill is always stored (default 1), which is how the discount base
  -- (app.promotion_base_iqd) knows the scope is a buy-one-get-one.
  if p_type = 'free_item' then
    if not (v_scope ? 'itemIds' or v_scope ? 'categoryIds') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.itemIds',
        hint = 'a free_item promotion names what the guest gets';
    end if;
    if not (v_scope ? 'buyItemIds' or v_scope ? 'buyCategoryIds' or v_scope ? 'courtIds') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.buyItemIds',
        hint = 'a free_item promotion names what earns it: items, categories or a court booking';
    end if;
    v_scope := v_scope || jsonb_build_object('perBill',
                 coalesce(case when jsonb_typeof(p_scope->'perBill') = 'number' then (p_scope->>'perBill')::int end, 1));
  end if;

  -- limits: known keys, whole numbers; total/perCustomer >= 1, minSpendIqd >= 0.
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits',
      hint = 'limits is an object {total, perCustomer, minSpendIqd, tierMin}';
  end if;
  for v_key in select jsonb_object_keys(p_limits) loop
    -- 0309 (c6): tierMin is a loyalty tier id (string), the tier must exist.
    if v_key = 'tierMin' then
      continue when jsonb_typeof(p_limits->v_key) = 'null';
      if jsonb_typeof(p_limits->v_key) <> 'string'
         or (p_limits->>v_key) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.tierMin',
          hint = 'the id of an existing loyalty tier';
      end if;
      -- The tier is held (FOR KEY SHARE) until this write commits:
      -- app.delete_loyalty_tier (FOR UPDATE) then waits and sees the promotion
      -- that names it (TIER_IN_USE), or it ran first and the tier is gone here.
      perform 1 from loyalty_tiers t where t.id = (p_limits->>v_key)::uuid for key share;
      if not found then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.tierMin',
          hint = 'the id of an existing loyalty tier';
      end if;
      v_limits := v_limits || jsonb_build_object('tierMin', ((p_limits->>v_key)::uuid)::text);
      continue;
    end if;
    if v_key not in ('total','perCustomer','minSpendIqd') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.' || v_key,
        hint = 'limit keys are total, perCustomer, minSpendIqd, tierMin';
    end if;
    if jsonb_typeof(p_limits->v_key) = 'null' then
      continue;
    end if;
    if jsonb_typeof(p_limits->v_key) <> 'number'
       or (p_limits->>v_key) !~ '^[0-9]{1,15}$' then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.' || v_key,
        hint = 'a whole non-negative number';
    end if;
    if v_key in ('total','perCustomer') and (p_limits->>v_key)::bigint < 1 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.' || v_key,
        hint = 'at least 1';
    end if;
    v_limits := v_limits || jsonb_build_object(v_key, (p_limits->>v_key)::bigint);
  end loop;

  -- code: normalised upper-case; '' clears; null keeps (update) / none (insert)
  if p_public_code is not null then
    v_code := nullif(upper(btrim(p_public_code)), '');
    if v_code is not null and v_code !~ '^[A-Z0-9]{4,16}$' then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'public_code',
        hint = '4-16 letters or digits';
    end if;
    if v_code is not null and exists (
         select 1 from promotions x where x.public_code = v_code and x.id is distinct from p_id) then
      raise exception 'CODE_TAKEN' using errcode = 'P0001', detail = v_code;
    end if;
  end if;

  if p_id is null then
    begin
      insert into promotions (name_en, name_ar, type, value, starts_at, ends_at, weekdays,
                              hour_from, hour_to, scope, limits, auto, public_code,
                              code_single_use, enabled, created_by)
      values (btrim(p_name_en), btrim(p_name_ar), p_type, p_value, p_starts_at, p_ends_at,
              v_weekdays, p_hour_from, p_hour_to, v_scope, v_limits, coalesce(p_auto, true),
              v_code, coalesce(p_code_single_use, false), coalesce(p_enabled, true), auth.uid())
      returning * into v_row;
    exception when unique_violation then
      raise exception 'CODE_TAKEN' using errcode = 'P0001', detail = v_code;
    end;
    perform app.write_audit('promotion.upsert', 'promotions', v_row.id::text, null, to_jsonb(v_row));
    return v_row.id;
  end if;

  select * into v_row from promotions where id = p_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  begin
    update promotions
       set name_en         = btrim(p_name_en),
           name_ar         = btrim(p_name_ar),
           type            = p_type,
           value           = p_value,
           starts_at       = p_starts_at,
           ends_at         = p_ends_at,
           weekdays        = v_weekdays,
           hour_from       = p_hour_from,
           hour_to         = p_hour_to,
           scope           = v_scope,
           limits          = v_limits,
           auto            = coalesce(p_auto, true),
           public_code     = case when p_public_code is null then public_code else v_code end,
           code_single_use = coalesce(p_code_single_use, false),
           enabled         = coalesce(p_enabled, true),
           updated_at      = now()
     where id = p_id
     returning * into v_row;
  exception when unique_violation then
    raise exception 'CODE_TAKEN' using errcode = 'P0001', detail = v_code;
  end;

  perform app.write_audit('promotion.upsert', 'promotions', p_id::text, v_before, to_jsonb(v_row));
  return v_row.id;
end $upsert_promotion_internal_0445$;

comment on function app.upsert_promotion_internal(uuid, text, text, text, int, timestamptz, timestamptz, int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) is
  'price_promo (§2.13), 0309 (limits.tierMin: an existing loyalty tier id, else INVALID_VALUE detail limits.tierMin), 0445 (type free_item, buy one get one: value 1..100 percent off each unit given, scope itemIds | categoryIds = what is given, buyItemIds | buyCategoryIds | courtIds = what earns it, perBill 1..10 stored, default 1; the buy keys and perBill on another type are INVALID_VALUE). Internal: the 0067 app.upsert_promotion body without its guard: creates (created_by = the caller) or replaces a promotion, validated by name (NAME_REQUIRED, INVALID_VALUE, INVALID_RANGE, INVALID_WEEKDAYS, CODE_TAKEN, PROMOTION_NOT_FOUND); p_public_code null keeps a code and '''' clears it. Audit promotion.upsert. Called by the public app.upsert_promotion, by a promotion change''s proposal (its disabled draft) and by the apply.';

revoke all on function app.upsert_promotion_internal(uuid, text, text, text, int, timestamptz, timestamptz, int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) from public, anon, authenticated;

-- What a deal shows on the phone: what it is given on and what earns it,
-- with a photo each (the item's, else its category's) and the category's
-- English name (the phone's drawing when there is no photo).
create or replace function app.deal_look_side(p_items jsonb, p_cats jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $deal_look_side_0445$
begin
  return coalesce((
    select jsonb_agg(x.j order by x.o, x.n)
      from (select * from (
              select 0 as o, mi.name_en as n,
                     jsonb_build_object('name_en', mi.name_en, 'name_ar', mi.name_ar,
                                        'photo_path', coalesce(mi.photo_path, mc.photo_path),
                                        'category_en', mc.name_en) as j
                from menu_items mi
                left join menu_categories mc on mc.id = mi.category_id
               where jsonb_typeof(p_items) = 'array' and p_items ? mi.id::text
              union all
              select 1, mc.name_en,
                     jsonb_build_object('name_en', mc.name_en, 'name_ar', mc.name_ar,
                                        'photo_path', mc.photo_path, 'category_en', mc.name_en)
                from menu_categories mc
               where jsonb_typeof(p_cats) = 'array' and p_cats ? mc.id::text) s
             order by s.o, s.n
             limit 3) x), '[]'::jsonb);
end $deal_look_side_0445$;

comment on function app.deal_look_side(jsonb, jsonb) is
  '0445. Internal: up to three [{name_en, name_ar, photo_path (the item''s, else its category''s, or null), category_en}] for a list of menu item ids then category ids, items first, by English name.';

revoke all on function app.deal_look_side(jsonb, jsonb) from public, anon, authenticated;

create or replace function app.deal_look_json(p_scope jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $deal_look_json_0445$
begin
  return jsonb_build_object(
    'get', app.deal_look_side(p_scope->'itemIds', p_scope->'categoryIds'),
    'buy', app.deal_look_side(p_scope->'buyItemIds', p_scope->'buyCategoryIds'),
    'per_bill', case when jsonb_typeof(p_scope->'perBill') = 'number' then (p_scope->>'perBill')::int end,
    'courts', coalesce(jsonb_typeof(p_scope->'courtIds') = 'array' and jsonb_array_length(p_scope->'courtIds') > 0, false));
end $deal_look_json_0445$;

comment on function app.deal_look_json(jsonb) is
  '0445. Internal: what a deal looks like on the phone, from its scope: {get (app.deal_look_side of itemIds, categoryIds: what it takes money off or gives), buy (of buyItemIds, buyCategoryIds: what earns a buy-one-get-one), per_bill (a buy-one-get-one''s units a bill, else null), courts (it needs a court booking)}. Read by app.my_deals.';

revoke all on function app.deal_look_json(jsonb) from public, anon, authenticated;

-- my_deals: re-issued from 20261112000410_loyalty_deals_perks.sql
create or replace function app.my_deals() returns jsonb
language plpgsql stable security definer set search_path = public as $my_deals_0445$
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
               'look', app.deal_look_json(p.scope),   -- 0445
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
end $my_deals_0445$;

comment on function app.my_deals() is
  '0410. The signed-in guest''s deals: {picked_id (the deal they picked to use next, while the pick is live) | null, picked_until, deals [{id, name_en, name_ar, blurb_en, blurb_ar (the owner''s line, or null), type percent | amount, value, ends_at, weekdays (0 = Sunday; empty = every day), hour_from, hour_to (HH:MM or null), live_now (inside its days and hours in the branch''s time), min_spend_iqd, per_customer, used (their own redemptions), tier {id, name_en, name_ar, color, min_points_12m} | null (the card it needs), state open | locked (their card is below its tier) | used (their uses are spent), picked, venue_id (null = every branch), on {items, categories ([{name_en, name_ar}]; both empty = the whole café bill), courts}}]}: every enabled promotion listed in the app (promotions.in_app) that has started, has not ended, is not a single-use code and has total uses left; the picked one first, then open, locked, used. AUTH_REQUIRED without a session, ACCOUNT_REQUIRED for an anonymous session or a deleted account. Read-only. 0445: each deal also carries look (app.deal_look_json: what it is given on and what earns it, with photos, for the card''s picture); type may be free_item (buy one get one: value = percent off each unit given, 100 = free).';

revoke all on function app.my_deals() from public, anon;
grant execute on function app.my_deals() to authenticated;

-- Redeem in the app: the press itself.
create or replace function app.loyalty_claim(p_profile uuid, p_venue uuid, p_kind text, p_perk uuid, p_by uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $loyalty_claim_0445$
declare
  v_ok    boolean;
  v_until timestamptz;
  v_to    date;
  v_tz    text;
begin
  if p_kind is null or p_kind not in ('stamp', 'gift') or (p_kind = 'gift' and p_perk is null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;
  if not coalesce((select s.enabled from loyalty_settings s where s.id), false) then
    raise exception 'REWARD_NOT_READY' using errcode = 'P0001', detail = 'loyalty_off';
  end if;
  if p_kind = 'stamp' then
    v_ok := coalesce((select c.enabled from loyalty_stamp_card c where c.id), false)
            and app.loyalty_stamp_balance(p_profile) >= app.loyalty_stamp_size(p_profile)
            and not exists (select 1 from loyalty_perk_lines l join tabs t on t.id = l.tab_id
                             where l.profile_id = p_profile and l.kind = 'stamp'
                               and t.status in ('open', 'awaiting_payment') and t.merged_into_tab_id is null);
    -- Nothing else bounds a free drink: the press holds a week.
    v_until := now() + interval '7 days';
  else
    select g.window_to into v_to
      from app.loyalty_card_gifts(p_profile, p_venue, null, null) g
     where g.perk_id = p_perk and g.eligible and not g.used;
    v_ok := found;
    -- A gift's press holds to the end of its window (a court hour is often
    -- booked days ahead), in the branch's time.
    v_tz := coalesce((select vs.timezone from venue_settings vs where vs.venue_id = p_venue), 'Asia/Baghdad');
    v_until := ((v_to + 1)::timestamp at time zone v_tz);
  end if;
  if not v_ok or v_until is null or v_until <= now() then
    raise exception 'REWARD_NOT_READY' using errcode = 'P0001', detail = p_kind;
  end if;

  insert into loyalty_reward_claims (profile_id, kind, perk_id, claimed_at, expires_at, claimed_by)
  values (p_profile, p_kind, case when p_kind = 'gift' then p_perk end, now(), v_until, p_by)
  on conflict (profile_id, reward_key) do update
     set claimed_at = excluded.claimed_at, expires_at = excluded.expires_at, claimed_by = excluded.claimed_by
  returning expires_at into v_until;
  return v_until;
end $loyalty_claim_0445$;

comment on function app.loyalty_claim(uuid, uuid, text, uuid, uuid) is
  '0445. Internal: records a Redeem press (loyalty_reward_claims, renewed by a second press; a free drink''s holds 7 days, a gift''s to the end of its window in p_venue''s time) on the member''s free drink (p_kind stamp: the drink card on, full, and not already on an open bill) or one card gift (p_kind gift, p_perk the privilege: open at p_venue, eligible and unused, app.loyalty_card_gifts). INVALID_ARGUMENT (p_kind), REWARD_NOT_READY (loyalty off, or the reward is not there to take). Returns when the claim ends.';

revoke all on function app.loyalty_claim(uuid, uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function app.claim_card_reward(p_kind text, p_perk_id uuid default null, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $claim_card_reward_0445$
declare
  v_uid   uuid := auth.uid();
  v_venue uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = v_uid and p.deleted_at is null)
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, (select v.id from venues v where v.is_active order by v.created_at limit 1));
  perform app.loyalty_claim(v_uid, v_venue, p_kind, p_perk_id, null);
  return app.loyalty_extras_json(v_uid, v_venue, true);
end $claim_card_reward_0445$;

comment on function app.claim_card_reward(text, uuid, uuid) is
  '0445 (Majed, 2026-11-15: a redeem now button, not go ask the cashier). The signed-in guest presses Redeem on their free drink (p_kind stamp) or a card gift (p_kind gift, p_perk_id the privilege; birthday, monthly or card-up), read at p_venue_id (default: the first open branch): app.loyalty_claim, then the bill a till opens for them frees it while the press holds (a free drink 7 days, a gift to the end of its window; a second press renews it). Returns app.my_card_extras'' answer. AUTH_REQUIRED, ACCOUNT_REQUIRED, INVALID_ARGUMENT, REWARD_NOT_READY.';

revoke all on function app.claim_card_reward(text, uuid, uuid) from public, anon;
grant execute on function app.claim_card_reward(text, uuid, uuid) to authenticated;

create or replace function app.claim_card_reward_for_tab(p_tab_id uuid, p_kind text, p_perk_id uuid default null,
                                                         p_device_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $claim_card_reward_for_tab_0445$
declare
  v_tab   tabs%rowtype;
  v_cust  uuid;
  v_until timestamptz;
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
  v_cust := app.tab_customer(p_tab_id);
  if v_cust is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'customer';
  end if;
  perform set_config('app.venue_id', v_tab.venue_id::text, true);

  v_until := app.loyalty_claim(v_cust, v_tab.venue_id, p_kind, p_perk_id, auth.uid());
  perform app.write_audit('loyalty.claim', 'loyalty_reward_claims', v_cust::text, null,
                          jsonb_build_object('kind', p_kind, 'perk_id', p_perk_id, 'tab_id', p_tab_id,
                                             'expires_at', v_until),
                          null, null, p_device_id);
  if v_tab.status = 'open' then
    perform app.loyalty_perks_refresh(p_tab_id, p_device_id);
  end if;
  return app.loyalty_tab_benefits(p_tab_id);
end $claim_card_reward_for_tab_0445$;

comment on function app.claim_card_reward_for_tab(uuid, text, uuid, text) is
  '0445. court_desk, cashier, shop_staff, manager, owner at the tab''s branch (TAB_NOT_FOUND, VENUE_MISMATCH): presses Redeem for the tab''s customer, for a member without the app (INVALID_ARGUMENT detail customer with none): app.loyalty_claim at the tab''s branch, audited loyalty.claim, then app.loyalty_perks_refresh while the tab is open. Returns app.loyalty_tab_benefits. INVALID_ARGUMENT (p_kind), REWARD_NOT_READY.';

revoke all on function app.claim_card_reward_for_tab(uuid, text, uuid, text) from public, anon;
grant execute on function app.claim_card_reward_for_tab(uuid, text, uuid, text) to authenticated;

-- ===========================================================================
-- 9. A deal's own QR (Majed, 2026-11-15: "the deal should generate its own QR
--    code, associated with the user, but its own QR code with a 15-minute
--    countdown, just like rewards")
--
--    Redeem on a deal (app.redeem_deal) writes a loyalty_deal_vouchers row: the
--    member, the deal, a fixed single-use code TPD- + 12 Crockford base32, alive
--    15 minutes (a scan in the minute after still counts, as for rewards). One
--    live code per member: a new Redeem cancels the one before. No points are
--    held, so nothing comes back and no sweep runs: a code past its time reads
--    as expired. The till scans it (app.use_deal_voucher): the code is the
--    proof; the bill takes the voucher's member when it has none, the deal
--    becomes their pick (0410) and app.apply_best_promotion applies it (the
--    picked deal sorts first), or the scan is refused and nothing is kept
--    (DEAL_NOT_ON_BILL: outside its hours, under its minimum, nothing it
--    covers). pick_deal stays for builds before this one.
-- ===========================================================================

create table if not exists loyalty_deal_vouchers (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  promotion_id uuid not null references promotions(id),
  code         text not null,
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  ended_at     timestamptz,
  used_by      uuid references staff(id),
  tab_id       uuid references tabs(id) on delete set null,
  constraint loyalty_deal_vouchers_code       unique (code),
  constraint loyalty_deal_vouchers_code_shape check (code ~ '^TPD-[0-9A-HJKMNP-TV-Z]{12}$'),
  constraint loyalty_deal_vouchers_status     check (status in ('active', 'used', 'cancelled')),
  constraint loyalty_deal_vouchers_ended      check ((status = 'active') = (ended_at is null)),
  constraint loyalty_deal_vouchers_used       check ((status = 'used') = (used_by is not null))
);

comment on table loyalty_deal_vouchers is
  '0445 (2026-11-15). A deal the guest redeemed in the app: its fixed single-use code (TPD-<12 Crockford base32>), the 15 minutes it lives (expires_at; a scan in the minute after counts), and what it became: active, used (at a till: the tab, used_by), cancelled (by the guest, or by their next Redeem). Expired is read from expires_at, never stored. Written by app.redeem_deal, app.cancel_deal_voucher and app.use_deal_voucher; read by app.my_deal_vouchers. No client grant.';

alter table loyalty_deal_vouchers enable row level security;
revoke all on loyalty_deal_vouchers from anon, authenticated;
grant all on loyalty_deal_vouchers to service_role;

drop trigger if exists zz_branch_guard on public.loyalty_deal_vouchers;
create trigger zz_branch_guard before insert or update or delete on public.loyalty_deal_vouchers
  for each row execute function app.trg_branch_guard('child', 'tabs', 'tab_id');

create or replace function app.deal_voucher_code_new() returns text
language plpgsql volatile security definer set search_path = public as $deal_voucher_code_new_0445$
declare
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_code  text;
  i       int;
begin
  loop
    v_bytes := extensions.gen_random_bytes(12);
    v_code := 'TPD-';
    for i in 0..11 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from loyalty_deal_vouchers v where v.code = v_code);
  end loop;
  return v_code;
end $deal_voucher_code_new_0445$;

comment on function app.deal_voucher_code_new() is
  '0445. Internal: a deal voucher code not yet used, TPD- + 12 characters of the Crockford base32 alphabet (60 bits), the reward vouchers'' scheme (app.voucher_code_new).';

revoke all on function app.deal_voucher_code_new() from public, anon, authenticated;

-- What the phone shows for one deal voucher; expired is read from the clock.
create or replace function app.deal_voucher_json(p_voucher loyalty_deal_vouchers) returns jsonb
language plpgsql stable security definer set search_path = public as $deal_voucher_json_0445$
declare
  p promotions%rowtype;
begin
  select * into p from promotions where id = p_voucher.promotion_id;
  return jsonb_build_object(
    'id',           p_voucher.id,
    'code',         p_voucher.code,
    'promotion_id', p_voucher.promotion_id,
    'name_en',      p.name_en,
    'name_ar',      p.name_ar,
    'type',         p.type,
    'value',        p.value,
    'status',       case when p_voucher.status = 'active' and p_voucher.expires_at + interval '1 minute' < now()
                         then 'expired' else p_voucher.status end,
    'created_at',   p_voucher.created_at,
    'expires_at',   p_voucher.expires_at,
    'ended_at',     coalesce(p_voucher.ended_at,
                             case when p_voucher.expires_at + interval '1 minute' < now() then p_voucher.expires_at end));
end $deal_voucher_json_0445$;

comment on function app.deal_voucher_json(loyalty_deal_vouchers) is
  '0445. Internal: {id, code, promotion_id, name_en, name_ar, type, value, status active | used | cancelled | expired (an active code past expires_at + 1 minute), created_at, expires_at, ended_at} of one deal voucher.';

revoke all on function app.deal_voucher_json(loyalty_deal_vouchers) from public, anon, authenticated;

create or replace function app.my_deal_vouchers() returns jsonb
language plpgsql stable security definer set search_path = public as $my_deal_vouchers_0445$
declare
  v_me uuid := app.loyalty_me();
begin
  return jsonb_build_object(
    'now', now(),
    'vouchers', coalesce((
      select jsonb_agg(app.deal_voucher_json(v) order by (v.status = 'active') desc, v.created_at desc, v.id)
        from loyalty_deal_vouchers v
       where v.profile_id = v_me
         and (v.status = 'active' or v.ended_at > now() - interval '30 minutes')
         and v.expires_at > now() - interval '30 minutes'), '[]'::jsonb));
end $my_deal_vouchers_0445$;

comment on function app.my_deal_vouchers() is
  '0445. The signed-in guest''s deal vouchers: the live one and those ended in the last 30 minutes ({now (the server clock, for the countdown), vouchers [app.deal_voucher_json], a live code first, then newest first}). AUTH_REQUIRED, ACCOUNT_REQUIRED (app.loyalty_me). Read-only.';

revoke all on function app.my_deal_vouchers() from public, anon;
grant execute on function app.my_deal_vouchers() to authenticated;

create or replace function app.redeem_deal(p_promotion_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $redeem_deal_0445$
declare
  v_me   uuid := app.loyalty_me();
  v_p    promotions%rowtype;
  v_used bigint;
  v_row  loyalty_deal_vouchers%rowtype;
begin
  -- pick_deal's checks (0410): listed, running, total uses left, the card, their own uses.
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

  -- One live code per member: the one before is cancelled.
  update loyalty_deal_vouchers set status = 'cancelled', ended_at = now()
   where profile_id = v_me and status = 'active';
  insert into loyalty_deal_vouchers (profile_id, promotion_id, code, expires_at)
  values (v_me, v_p.id, app.deal_voucher_code_new(), now() + interval '15 minutes')
  returning * into v_row;
  return jsonb_build_object('now', now(), 'voucher', app.deal_voucher_json(v_row));
end $redeem_deal_0445$;

comment on function app.redeem_deal(uuid) is
  '0445 (Majed, 2026-11-15: a deal''s own QR with a 15-minute countdown, like rewards). The signed-in guest redeems a listed deal: pick_deal''s checks (DEAL_UNAVAILABLE, DEAL_LOCKED, DEAL_USED), then a loyalty_deal_vouchers row with a fresh TPD- code alive 15 minutes; their live code before it is cancelled. Returns {now, voucher (app.deal_voucher_json)}. AUTH_REQUIRED, ACCOUNT_REQUIRED. State-idempotent enough: a second press gives a new code and cancels the first.';

revoke all on function app.redeem_deal(uuid) from public, anon;
grant execute on function app.redeem_deal(uuid) to authenticated;

create or replace function app.cancel_deal_voucher(p_voucher_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $cancel_deal_voucher_0445$
declare
  v_me uuid := app.loyalty_me();
begin
  update loyalty_deal_vouchers set status = 'cancelled', ended_at = now()
   where id = p_voucher_id and profile_id = v_me and status = 'active';
  return app.my_deal_vouchers();
end $cancel_deal_voucher_0445$;

comment on function app.cancel_deal_voucher(uuid) is
  '0445. The signed-in guest cancels their own live deal code (another member''s id, or a code no longer active, changes nothing). Returns app.my_deal_vouchers(). AUTH_REQUIRED, ACCOUNT_REQUIRED.';

revoke all on function app.cancel_deal_voucher(uuid) from public, anon;
grant execute on function app.cancel_deal_voucher(uuid) to authenticated;

create or replace function app.use_deal_voucher(p_tab_id uuid, p_code text, p_idempotency_key text default null,
                                                p_device_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $use_deal_voucher_0445$
declare
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  v_replay jsonb;
  v        loyalty_deal_vouchers%rowtype;
  v_tab    tabs%rowtype;
  v_p      promotions%rowtype;
  v_cust   uuid;
  v_apply  jsonb;
  v_result jsonb;
  v_n      int;
begin
  if not app.is_staff('cashier', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_tab.venue_id, 'cashier', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_tab.venue_id::text, true);
  v_replay := app.claim_replay(p_idempotency_key, 'use_deal_voucher');
  if v_replay is not null then
    return v_replay;
  end if;

  -- TPD + 12, typed with or without the dashes.
  if v_code ~ '^TPD[0-9A-HJKMNP-TV-Z]{12}$' then
    v_code := 'TPD-' || substr(v_code, 4);
  end if;
  select * into v from loyalty_deal_vouchers where code = v_code;
  if not found then
    raise exception 'VOUCHER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status <> 'active' then
    raise exception 'VOUCHER_USED' using errcode = 'P0001';
  end if;
  if v.expires_at + interval '1 minute' < now() then
    raise exception 'VOUCHER_EXPIRED' using errcode = 'P0001';
  end if;
  select * into v_p from promotions where id = v.promotion_id;
  if v_p.venue_id is not null and v_p.venue_id <> v_tab.venue_id then
    raise exception 'VOUCHER_WRONG_BRANCH' using errcode = 'P0001';
  end if;

  -- The bill is the voucher's member's: it takes them when it has nobody.
  v_cust := app.tab_customer(p_tab_id);
  if v_cust is null then
    perform app.set_tab_customer(p_tab_id, v.profile_id);
  elsif v_cust <> v.profile_id then
    raise exception 'VOUCHER_OTHER_MEMBER' using errcode = 'P0001';
  end if;

  -- The deal becomes their pick (0410), so the best promotion is this one.
  perform app.loyalty_card_ensure(v.profile_id);
  update loyalty_cards
     set deal_promotion_id = v.promotion_id, deal_picked_at = now(),
         deal_uses_before = app.loyalty_deal_uses(v.profile_id, v.promotion_id)
   where profile_id = v.profile_id;
  begin
    v_apply := app.apply_best_promotion(p_tab_id, null, null, p_device_id);
  exception when sqlstate 'P0001' then
    -- Nothing on the bill qualifies: said as the deal not fitting this bill.
    if sqlerrm in ('NO_ELIGIBLE_PROMOTION', 'CODE_NOT_ELIGIBLE') then
      raise exception 'DEAL_NOT_ON_BILL' using errcode = 'P0001';
    end if;
    raise;
  end;
  if (v_apply->>'promotionId') is distinct from v.promotion_id::text then
    raise exception 'DEAL_NOT_ON_BILL' using errcode = 'P0001';
  end if;

  -- Last, under its row lock: the code is spent once (a scan at another till
  -- that got here first leaves nothing active, and this whole call rolls back).
  update loyalty_deal_vouchers
     set status = 'used', ended_at = now(), used_by = auth.uid(), tab_id = p_tab_id
   where id = v.id and status = 'active';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'VOUCHER_USED' using errcode = 'P0001';
  end if;
  perform app.write_audit('loyalty.deal_voucher', 'loyalty_deal_vouchers', v.id::text, null,
                          jsonb_build_object('tab_id', p_tab_id, 'promotion_id', v.promotion_id,
                                             'amount_iqd', (v_apply->>'amountIqd')::bigint),
                          null, null, p_device_id);
  v_result := jsonb_build_object('voucherId', v.id, 'promotionId', v.promotion_id,
                                 'name_en', v_p.name_en, 'name_ar', v_p.name_ar,
                                 'amountIqd', (v_apply->>'amountIqd')::bigint,
                                 'customerId', v.profile_id);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $use_deal_voucher_0445$;

comment on function app.use_deal_voucher(uuid, text, text, text) is
  '0445 (2026-11-15). Cashier, manager, owner at the tab''s branch (TAB_NOT_FOUND, VENUE_MISMATCH): the till scans a deal''s QR. The code is the proof (typed with or without dashes): VOUCHER_NOT_FOUND, VOUCHER_USED (used or cancelled), VOUCHER_EXPIRED (past expires_at + 1 minute), VOUCHER_WRONG_BRANCH (a deal of another branch). The bill takes the voucher''s member when it has none (app.set_tab_customer); another member''s bill is VOUCHER_OTHER_MEMBER. The deal becomes their pick and app.apply_best_promotion applies it; when the bill cannot take it (hours, minimum, nothing it covers) the call is DEAL_NOT_ON_BILL and nothing is kept. The code is then spent (status used, the tab, used_by), audited loyalty.deal_voucher. Returns {voucherId, promotionId, name_en, name_ar, amountIqd, customerId}; p_idempotency_key replays it (app.claim_replay).';

revoke all on function app.use_deal_voucher(uuid, text, text, text) from public, anon;
grant execute on function app.use_deal_voucher(uuid, text, text, text) to authenticated;
