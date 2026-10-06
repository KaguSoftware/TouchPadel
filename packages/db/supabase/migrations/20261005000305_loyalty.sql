set lock_timeout = '3s';
set statement_timeout = '60s';

-- loyalty — Phase 2 milestone 3, staged file C
-- (docs/design/loyalty/build-contracts-2026-10-05.md §1.3; plan §3.4).
--
--   1. The tables: loyalty_settings (one business-wide row, enabled = false
--      until the client gives the numbers, L-1), loyalty_tiers (the base tier
--      seeded), loyalty_rewards, loyalty_cards (the member QR's secret),
--      loyalty_ledger (append-only, the authority) and loyalty_accounts (its
--      cache). RLS on, no policy, no client grant: every read and write is a
--      definer body. The two tables with venue_id carry zz_branch_guard.
--   2. tabs.customer_id (the guest a desk attached to a tab); its index is in
--      file D (an index never shares a file with the column it needs, and
--      file B runs before this one).
--   3. The engine: app.tab_customer, app.loyalty_points_for (the SQL twin of
--      @touch/core/loyalty earnPoints), app.loyalty_recompute, the ledger's
--      two triggers, the earn trigger on tabs and the clawback trigger on
--      refunds (L-5: no money RPC is re-issued).
--   4. The member token (RFC 6238 TOTP, SHA-1, six digits, step from the
--      settings, ±2 steps accepted): app.loyalty_totp, app.base32_encode,
--      app.loyalty_card_ensure, app.loyalty_token_profile.
--   5. The RPCs of §1.3, each guard first.
--
-- Lock order: loyalty_accounts ranks LAST, after match_tickets. The earn and
-- clawback triggers are deferred constraint triggers, so they run at commit,
-- after every lock the settling or refunding body took (settle_tab and refund
-- go on to write refund_items, stock and bookings after the row that fires
-- them). The ledger is insert-only and is not ranked.
--
-- Points are business-wide (L-7); ledger rows carry venue_id for reporting.
-- Every loyalty write is online-only (L-6): no queued mutation type.

-- ===========================================================================
-- 1. The tables
-- ===========================================================================

create table if not exists loyalty_settings (
  id                       boolean primary key default true check (id),
  enabled                  boolean not null default false,
  iqd_per_point            int not null default 1000 check (iqd_per_point > 0),
  point_value_iqd          int not null default 50 check (point_value_iqd > 0),
  min_redeem_points        int not null default 100 check (min_redeem_points >= 0),
  earn_cafe                boolean not null default true,
  earn_shop                boolean not null default true,
  earn_court               boolean not null default true,
  earn_lesson              boolean not null default true,
  earn_tournament          boolean not null default true,
  inactivity_expiry_months int check (inactivity_expiry_months is null or inactivity_expiry_months between 1 and 120),
  totp_step_seconds        int not null default 30 check (totp_step_seconds between 15 and 120),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references staff(id)
);

insert into loyalty_settings (id) values (true) on conflict (id) do nothing;

create table if not exists loyalty_tiers (
  id              uuid primary key default gen_random_uuid(),
  name_en         text not null,
  name_ar         text not null,
  min_points_12m  int not null,
  earn_multiplier numeric(3,2) not null default 1,
  promotion_id    uuid references promotions(id),
  sort            smallint not null,
  created_at      timestamptz not null default now(),
  constraint loyalty_tiers_min_key  unique (min_points_12m),
  constraint loyalty_tiers_sort_key unique (sort),
  constraint loyalty_tiers_names    check (char_length(name_en) between 1 and 40 and char_length(name_ar) between 1 and 40),
  constraint loyalty_tiers_min      check (min_points_12m >= 0),
  constraint loyalty_tiers_mult     check (earn_multiplier between 1 and 5),
  constraint loyalty_tiers_sort     check (sort >= 0),
  -- The base tier (sort 0) is the one every account starts in: from 0 points.
  constraint loyalty_tiers_base     check ((sort = 0) = (min_points_12m = 0))
);

insert into loyalty_tiers (name_en, name_ar, min_points_12m, earn_multiplier, promotion_id, sort)
select 'Member', 'عضو', 0, 1.00, null, 0
 where not exists (select 1 from loyalty_tiers where sort = 0);

create table if not exists loyalty_rewards (
  id              uuid primary key default gen_random_uuid(),
  name_en         text not null,
  name_ar         text not null,
  cost_points     int not null,
  kind            text not null,
  iqd_off         int,
  menu_variant_id uuid references menu_item_variants(id),
  active          boolean not null default true,
  venue_id        uuid references venues(id),   -- null: every branch
  created_at      timestamptz not null default now(),
  constraint loyalty_rewards_names check (char_length(name_en) between 1 and 60 and char_length(name_ar) between 1 and 60),
  constraint loyalty_rewards_cost  check (cost_points > 0),
  constraint loyalty_rewards_kind  check (kind in ('iqd_off', 'item')),
  constraint loyalty_rewards_shape check (
        (kind = 'iqd_off' and iqd_off is not null and iqd_off > 0 and menu_variant_id is null)
     or (kind = 'item' and menu_variant_id is not null and iqd_off is null))
);

create table if not exists loyalty_cards (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  member_code text not null,
  secret      bytea not null,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz,
  constraint loyalty_cards_member_code_key unique (member_code),
  constraint loyalty_cards_code   check (member_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  constraint loyalty_cards_secret check (octet_length(secret) = 20)
);

create table if not exists loyalty_ledger (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id),
  venue_id    uuid references venues(id),
  delta       int not null,
  kind        text not null,
  source_kind text not null,
  source_id   uuid not null,
  tab_id      uuid references tabs(id),
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default clock_timestamp(),   -- insertion order inside one transaction
  constraint loyalty_ledger_once  unique (kind, source_kind, source_id),
  constraint loyalty_ledger_delta check (delta <> 0),
  constraint loyalty_ledger_kind  check (kind in ('earn', 'redeem', 'redeem_void', 'reward', 'adjust', 'clawback',
                                                  'expire', 'merge_in')),
  constraint loyalty_ledger_note  check (note is null or char_length(note) <= 200)
);

create table if not exists loyalty_accounts (
  profile_id       uuid primary key references profiles(id) on delete cascade,
  balance          int not null default 0,
  lifetime_earned  int not null default 0,
  points_12m       int not null default 0,
  tier_id          uuid references loyalty_tiers(id) on delete set null,
  last_activity_at timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table loyalty_settings is
  'Loyalty (Phase 2 M3, contracts §1.3). The one business-wide row (points are shared across branches, L-7). enabled ships false until the client gives the point value, tiers and rewards (L-1). iqd_per_point: IQD paid per point earned; point_value_iqd: IQD one point takes off a bill; min_redeem_points: the least a guest may redeem at once; earn_*: the per-domain earn switches (court = the court fee carried on any tab); inactivity_expiry_months: null = points never expire; totp_step_seconds: the member token''s step. Owner-written through app.set_loyalty_settings. No client grant.';
comment on table loyalty_tiers is
  'Loyalty (M3). Tiers by points earned in the last 12 months (min_points_12m), each with an earn multiplier and an optional promotion (a promotion with limits.tierMin = this tier''s sort is eligible from this tier up). The sort-0 tier (from 0 points) is the base every account starts in and cannot be deleted. Owner-written. No client grant.';
comment on table loyalty_rewards is
  'Loyalty (M3). Rewards redeemed at the till for cost_points: iqd_off (a fixed amount off the bill) or item (the variant''s current price off). venue_id null = every branch. Owner-written. No client grant.';
comment on table loyalty_cards is
  'Loyalty (M3, L-4). One member card per profile: member_code (8 Crockford base32 characters, printed under the QR) and the 20-byte TOTP secret the phone or browser computes the rotating token from. Created lazily by app.my_member_card; the secret is rotated by app.rotate_member_card. Read only through those two RPCs. No client grant.';
comment on table loyalty_ledger is
  'Loyalty (M3). The points ledger, append-only (app.trg_loyalty_ledger_immutable; the one exception is the account merge re-pointing profile_id under set_config(''app.loyalty_merge'', ''on'', true)). One row per (kind, source_kind, source_id): earn per tab, clawback per refund, redeem/reward/redeem_void per tab adjustment. balance = sum(delta). venue_id is reporting only (points are business-wide). No client grant.';
comment on table loyalty_accounts is
  'Loyalty (M3). The cache of the ledger per profile: balance = sum(delta), lifetime_earned and points_12m = earn + clawback + adjust (all time / last 12 months), tier_id = the highest tier whose min_points_12m it reaches, last_activity_at = the newest row that is not an expiry. Maintained by app.loyalty_recompute (after every ledger insert, and nightly). No client grant.';

-- RLS on, no policy, no client grant: Supabase's default privileges grant
-- the client roles every new table, so they are revoked (0299 pattern).
alter table loyalty_settings enable row level security;
revoke all on loyalty_settings from anon, authenticated;
grant all on loyalty_settings to service_role;
alter table loyalty_tiers enable row level security;
revoke all on loyalty_tiers from anon, authenticated;
grant all on loyalty_tiers to service_role;
alter table loyalty_rewards enable row level security;
revoke all on loyalty_rewards from anon, authenticated;
grant all on loyalty_rewards to service_role;
alter table loyalty_cards enable row level security;
revoke all on loyalty_cards from anon, authenticated;
grant all on loyalty_cards to service_role;
alter table loyalty_ledger enable row level security;
revoke all on loyalty_ledger from anon, authenticated;
grant all on loyalty_ledger to service_role;
alter table loyalty_accounts enable row level security;
revoke all on loyalty_accounts from anon, authenticated;
grant all on loyalty_accounts to service_role;

-- The branch guard (0230) on the two tables that carry venue_id. A null
-- venue_id (a chain-wide reward, a manager adjustment) has no branch.
drop trigger if exists zz_branch_guard on public.loyalty_rewards;
create trigger zz_branch_guard before insert or update or delete on public.loyalty_rewards
  for each row execute function app.trg_branch_guard('scoped', 'menu_item_variants', 'menu_variant_id');
drop trigger if exists zz_branch_guard on public.loyalty_ledger;
create trigger zz_branch_guard before insert or update or delete on public.loyalty_ledger
  for each row execute function app.trg_branch_guard('scoped', 'tabs', 'tab_id');

-- ===========================================================================
-- 2. tabs.customer_id
-- ===========================================================================
alter table tabs add column if not exists customer_id uuid;

do $tabs_customer_loyalty_0305$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_customer_id_fkey'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_customer_id_fkey
      foreign key (customer_id) references profiles(id) not valid;
  end if;
end $tabs_customer_loyalty_0305$;

do $tabs_customer_validate_loyalty_0305$
begin
  if exists (select 1 from pg_constraint
              where conname = 'tabs_customer_id_fkey'
                and conrelid = 'public.tabs'::regclass
                and not convalidated) then
    alter table tabs validate constraint tabs_customer_id_fkey;
  end if;
end $tabs_customer_validate_loyalty_0305$;

comment on column tabs.customer_id is
  'Loyalty (M3). The guest a desk attached to this tab (app.set_tab_customer, after app.loyalty_identify). The tab''s customer is app.tab_customer: this, else the booking''s guest, else the latest linked café session''s profile.';

-- ===========================================================================
-- 3. The engine
-- ===========================================================================

-- The customer of a tab (internal): the attached guest, else the booking's
-- guest, else the profile linked to the latest café session that ordered on
-- it (app.link_guest_session). A deleted profile counts as none.
create or replace function app.tab_customer(p_tab_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $tab_customer_0305$
declare
  v_tab tabs%rowtype;
  v     uuid;
begin
  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    return null;
  end if;
  if v_tab.customer_id is not null then
    select p.id into v from profiles p where p.id = v_tab.customer_id and p.deleted_at is null;
    if v is not null then
      return v;
    end if;
  end if;
  if v_tab.reservation_id is not null then
    select p.id into v
      from reservations r
      join profiles p on p.id = r.guest_id and p.deleted_at is null
     where r.id = v_tab.reservation_id;
    if v is not null then
      return v;
    end if;
  end if;
  select p.id into v
    from orders o
    join guest_sessions g on g.id = o.guest_session_id
    join profiles p on p.id = g.linked_profile_id and p.deleted_at is null
   where o.tab_id = p_tab_id
     and o.source = 'guest_web'
   order by o.placed_at desc, o.id desc
   limit 1;
  return v;
end $tab_customer_0305$;

comment on function app.tab_customer(uuid) is
  'Loyalty (M3, contracts §1.3). Internal: the customer of a tab: tabs.customer_id, else the booking''s guest (tabs.reservation_id), else the linked profile of the latest guest_web order''s café session that has one. A deleted profile counts as none; NULL when there is no customer.';

revoke all on function app.tab_customer(uuid) from public, anon, authenticated;

-- The earn arithmetic (internal, immutable): the SQL twin of earnPoints in
-- packages/core/src/loyalty/points.ts. The court portion is the court fee
-- the tab carried, capped at what was paid; the rest belongs to the tab's own
-- kind. floor(eligible / iqd_per_point * multiplier), computed exactly
-- (multiply first: numeric division would round 10/3*3 to 9.99…).
create or replace function app.loyalty_points_for(
  p_kind        text,
  p_paid        bigint,
  p_court       bigint,
  p_iqd_per_pt  int,
  p_multiplier  numeric,
  p_cafe        boolean,
  p_shop        boolean,
  p_court_on    boolean,
  p_lesson      boolean,
  p_tournament  boolean
) returns int
language plpgsql immutable set search_path = public as $loyalty_points_for_0305$
declare
  v_court bigint;
  v_rest  bigint;
  v_own   boolean;
  v_elig  bigint;
begin
  if coalesce(p_paid, 0) <= 0 or coalesce(p_iqd_per_pt, 0) <= 0 then
    return 0;
  end if;
  v_court := least(greatest(coalesce(p_court, 0), 0), p_paid);
  v_rest  := p_paid - v_court;
  v_own := case p_kind
             when 'cafe'       then p_cafe
             when 'shop'       then p_shop
             when 'lesson'     then p_lesson
             when 'tournament' then p_tournament
             else false
           end;
  v_elig := case when p_court_on then v_court else 0 end
          + case when coalesce(v_own, false) then v_rest else 0 end;
  return floor((v_elig::numeric * coalesce(p_multiplier, 1)) / p_iqd_per_pt)::int;
end $loyalty_points_for_0305$;

comment on function app.loyalty_points_for(text, bigint, bigint, int, numeric, boolean, boolean, boolean, boolean, boolean) is
  'Loyalty (M3, contracts §1.3). Internal, immutable: the points a settled tab earns, the SQL twin of earnPoints (@touch/core/loyalty). court = least(court fee, paid) under earn_court; the rest under the tab kind''s own switch (cafe, shop, lesson, tournament); floor(eligible * multiplier / iqd_per_point). loyalty.test.ts holds the two to one table.';

revoke all on function app.loyalty_points_for(text, bigint, bigint, int, numeric, boolean, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;

-- The account cache of one profile, rebuilt from the ledger (internal).
create or replace function app.loyalty_recompute(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $loyalty_recompute_0305$
declare
  v_balance  bigint;
  v_life     bigint;
  v_12m      bigint;
  v_last     timestamptz;
  v_tier     uuid;
begin
  if p_profile is null then
    return;
  end if;
  -- The row first, then the sums: a concurrent writer for the same profile
  -- holds this row until it commits, and the sums below (a fresh snapshot,
  -- after the wait) then include its ledger row. Summing first and upserting
  -- after the wait would write a balance that misses it.
  insert into loyalty_accounts (profile_id) values (p_profile) on conflict (profile_id) do nothing;
  perform 1 from loyalty_accounts a where a.profile_id = p_profile for update;

  select coalesce(sum(l.delta), 0),
         coalesce(sum(l.delta) filter (where l.kind in ('earn', 'clawback', 'adjust')), 0),
         coalesce(sum(l.delta) filter (where l.kind in ('earn', 'clawback', 'adjust')
                                         and l.created_at > now() - interval '12 months'), 0),
         max(l.created_at) filter (where l.kind <> 'expire')
    into v_balance, v_life, v_12m, v_last
    from loyalty_ledger l
   where l.profile_id = p_profile;

  select t.id into v_tier
    from loyalty_tiers t
   where t.min_points_12m <= greatest(v_12m, 0)
   order by t.min_points_12m desc
   limit 1;

  update loyalty_accounts
     set balance          = v_balance,
         lifetime_earned  = greatest(v_life, 0),
         points_12m       = greatest(v_12m, 0),
         tier_id          = v_tier,
         last_activity_at = v_last,
         updated_at       = now()
   where profile_id = p_profile;
end $loyalty_recompute_0305$;

comment on function app.loyalty_recompute(uuid) is
  'Loyalty (M3, contracts §1.3). Internal: rebuilds one profile''s loyalty_accounts row from the ledger (balance = sum(delta); lifetime_earned and points_12m = earn + clawback + adjust, all time and the last 12 months; tier = the highest tier reached by points_12m; last_activity_at = the newest row that is not an expiry). Called after every ledger insert, by the nightly run and by the account merge (through to_regprocedure).';

revoke all on function app.loyalty_recompute(uuid) from public, anon, authenticated;

-- The ledger is append-only. The merge (file A) re-points profile_id from the
-- dropped account to the kept one, and says so for this transaction only.
create or replace function app.trg_loyalty_ledger_immutable() returns trigger
language plpgsql set search_path = public as $trg_loyalty_ledger_immutable_0305$
begin
  if tg_op = 'UPDATE'
     and current_setting('app.loyalty_merge', true) = 'on'
     and (to_jsonb(new) - 'profile_id') = (to_jsonb(old) - 'profile_id') then
    return new;
  end if;
  raise exception 'FORBIDDEN' using errcode = 'P0001',
    detail = 'loyalty_ledger is append-only';
end $trg_loyalty_ledger_immutable_0305$;

comment on function app.trg_loyalty_ledger_immutable() is
  'Loyalty (M3). BEFORE UPDATE OR DELETE on loyalty_ledger: refuses both (FORBIDDEN, detail append-only), except an UPDATE that changes profile_id alone while app.loyalty_merge is ''on'' (set_config(..., true), the account merge).';

revoke all on function app.trg_loyalty_ledger_immutable() from public, anon, authenticated;

drop trigger if exists loyalty_ledger_immutable on loyalty_ledger;
create trigger loyalty_ledger_immutable
  before update or delete on loyalty_ledger
  for each row execute function app.trg_loyalty_ledger_immutable();

create or replace function app.trg_loyalty_account_apply() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_account_apply_0305$
begin
  perform app.loyalty_recompute(new.profile_id);
  return null;
end $trg_loyalty_account_apply_0305$;

comment on function app.trg_loyalty_account_apply() is
  'Loyalty (M3). AFTER INSERT on loyalty_ledger: upserts the profile''s loyalty_accounts row (app.loyalty_recompute), so the balance and the tier move with the row.';

revoke all on function app.trg_loyalty_account_apply() from public, anon, authenticated;

drop trigger if exists loyalty_ledger_account_apply on loyalty_ledger;
create trigger loyalty_ledger_account_apply
  after insert on loyalty_ledger
  for each row execute function app.trg_loyalty_account_apply();

-- The earn multiplier of a profile's tier now (internal): the base tier's
-- when the profile has no account yet.
create or replace function app.loyalty_multiplier(p_profile uuid) returns numeric
language sql stable security definer set search_path = public as $loyalty_multiplier_0305$
  select coalesce(
    (select t.earn_multiplier from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id
      where a.profile_id = p_profile),
    (select t.earn_multiplier from loyalty_tiers t order by t.sort limit 1),
    1::numeric)
$loyalty_multiplier_0305$;

revoke all on function app.loyalty_multiplier(uuid) from public, anon, authenticated;

-- Earn (L-5): a tab becoming settled earns its customer points, once. A
-- deferred constraint trigger: it runs at commit, after every lock the
-- settling body takes, so loyalty_accounts stays last in the lock order, and
-- it reads the payments the body inserted. It re-reads the tab: a tab that is
-- no longer settled by then earns nothing.
create or replace function app.trg_loyalty_earn() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_earn_0305$
declare
  v_s        loyalty_settings%rowtype;
  v_tab      tabs%rowtype;
  v_customer uuid;
  v_paid     bigint;
  v_points   int;
begin
  select * into v_s from loyalty_settings where id;
  if not found or not v_s.enabled then
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

  -- Net of refunds (app.tab_net_paid, 0037): a refund taken while the tab was
  -- open (DISCOUNT_ / VOID_REQUIRES_REFUND, a method switch) found no earn to
  -- claw back, so the money it returned must not earn here either.
  v_paid := app.tab_net_paid(v_tab.id);
  v_points := app.loyalty_points_for(v_tab.kind, v_paid, coalesce(v_tab.court_iqd, 0), v_s.iqd_per_point,
                                     app.loyalty_multiplier(v_customer), v_s.earn_cafe, v_s.earn_shop,
                                     v_s.earn_court, v_s.earn_lesson, v_s.earn_tournament);
  if v_points > 0 then
    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
    values (v_customer, v_tab.venue_id, v_points, 'earn', 'tab', v_tab.id, v_tab.id, auth.uid())
    on conflict (kind, source_kind, source_id) do nothing;
  end if;
  return null;
end $trg_loyalty_earn_0305$;

comment on function app.trg_loyalty_earn() is
  'Loyalty (M3, contracts §1.3, L-5). Deferred AFTER UPDATE OF status on tabs, when the tab becomes settled: skipped while loyalty is off, when the tab is no longer settled at commit, or with no customer (app.tab_customer). paid = the tab''s payments less its refunds (app.tab_net_paid: a refund taken while the tab was open has nothing to claw back); points = app.loyalty_points_for(kind, paid, court_iqd, iqd_per_point, the customer''s tier multiplier, the switches); a row (earn, tab, tab_id) when above 0, once (on conflict do nothing).';

revoke all on function app.trg_loyalty_earn() from public, anon, authenticated;

drop trigger if exists tabs_loyalty_earn on tabs;
create constraint trigger tabs_loyalty_earn
  after update of status on tabs
  deferrable initially deferred
  for each row
  when (new.status = 'settled' and old.status is distinct from 'settled')
  execute function app.trg_loyalty_earn();

-- Clawback: a refund on an earning tab takes back its share of the points,
-- rounded up, never more than the tab earned less what earlier refunds took.
-- Deferred like the earn, for the same reason (refund writes refund_items,
-- whose trigger restocks stock_batches, after the refunds row).
create or replace function app.trg_loyalty_clawback() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_clawback_0305$
declare
  v_tab    uuid;
  v_earn   loyalty_ledger%rowtype;
  v_paid   bigint;
  v_prior  bigint;
  v_claw   bigint;
begin
  select p.tab_id into v_tab from payments p where p.id = new.payment_id;
  if v_tab is null then
    return null;
  end if;
  select * into v_earn from loyalty_ledger l
   where l.kind = 'earn' and l.source_kind = 'tab' and l.source_id = v_tab;
  if not found then
    return null;
  end if;
  if not exists (select 1 from profiles p where p.id = v_earn.profile_id and p.deleted_at is null) then
    return null;
  end if;

  -- What the earn was computed on: the payments less the refunds taken before
  -- it (those have no clawback row; every refund after it has one, until the
  -- cap is reached and the base no longer matters).
  select coalesce(sum(p.amount_iqd), 0)
       - coalesce((select sum(r.amount_iqd)
                     from refunds r join payments p2 on p2.id = r.payment_id
                    where p2.tab_id = v_tab and r.id <> new.id
                      and not exists (select 1 from loyalty_ledger c
                                       where c.kind = 'clawback' and c.source_kind = 'refund'
                                         and c.source_id = r.id)), 0)
    into v_paid
    from payments p where p.tab_id = v_tab;
  if v_paid <= 0 then
    return null;
  end if;
  select coalesce(-sum(l.delta), 0) into v_prior
    from loyalty_ledger l
   where l.kind = 'clawback' and l.source_kind = 'refund'
     and l.source_id in (select r.id from refunds r join payments p on p.id = r.payment_id
                          where p.tab_id = v_tab and r.id <> new.id);
  v_claw := least(ceil((v_earn.delta::numeric * new.amount_iqd) / v_paid)::bigint,
                  v_earn.delta - v_prior);
  if v_claw > 0 then
    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
    values (v_earn.profile_id, new.venue_id, -v_claw, 'clawback', 'refund', new.id, v_tab, auth.uid())
    on conflict (kind, source_kind, source_id) do nothing;
  end if;
  return null;
end $trg_loyalty_clawback_0305$;

comment on function app.trg_loyalty_clawback() is
  'Loyalty (M3, contracts §1.3). Deferred AFTER INSERT on refunds: when the refunded payment''s tab earned points, writes (clawback, refund, refund_id) of -ceil(earned * refund / paid), paid being what the earn was computed on (the payments less the refunds taken before it), capped at earned less the tab''s earlier clawbacks. Runs whether loyalty is on or off (what was earned is taken back); skipped for a deleted profile. The balance may go negative.';

revoke all on function app.trg_loyalty_clawback() from public, anon, authenticated;

drop trigger if exists refunds_loyalty_clawback on refunds;
create constraint trigger refunds_loyalty_clawback
  after insert on refunds
  deferrable initially deferred
  for each row
  execute function app.trg_loyalty_clawback();

-- ===========================================================================
-- 4. The member token (RFC 6238; L-4)
-- ===========================================================================

-- HOTP (RFC 4226) over an 8-byte big-endian counter, six digits. The TS twin
-- is hotp in packages/core/src/loyalty/totp.ts (loyalty-totp-parity.test.ts).
create or replace function app.loyalty_totp(p_secret bytea, p_counter bigint) returns text
language plpgsql immutable set search_path = public as $loyalty_totp_0305$
declare
  v_mac bytea;
  v_off int;
  v_bin bigint;
begin
  v_mac := extensions.hmac(int8send(p_counter), p_secret, 'sha1');
  v_off := get_byte(v_mac, 19) & 15;
  v_bin := ((get_byte(v_mac, v_off) & 127)::bigint << 24)
         | (get_byte(v_mac, v_off + 1)::bigint << 16)
         | (get_byte(v_mac, v_off + 2)::bigint << 8)
         |  get_byte(v_mac, v_off + 3)::bigint;
  return lpad((v_bin % 1000000)::text, 6, '0');
end $loyalty_totp_0305$;

comment on function app.loyalty_totp(bytea, bigint) is
  'Loyalty (M3, contracts §1.3). Internal, immutable: the six-digit HOTP (RFC 4226, HMAC-SHA1 via pgcrypto) of a card secret at one counter; TOTP is the counter floor(epoch / step). The SQL twin of hotp (@touch/core/loyalty).';

revoke all on function app.loyalty_totp(bytea, bigint) from public, anon, authenticated;

-- RFC 4648 base32, no padding: how the secret travels to the phone.
create or replace function app.base32_encode(p_bytes bytea) returns text
language plpgsql immutable set search_path = public as $base32_encode_0305$
declare
  c_alpha constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  v_out   text := '';
  v_bits  int := 0;
  v_val   bigint := 0;
  i       int;
begin
  if p_bytes is null then
    return null;
  end if;
  for i in 0 .. octet_length(p_bytes) - 1 loop
    v_val := ((v_val << 8) | get_byte(p_bytes, i)) & 65535;
    v_bits := v_bits + 8;
    while v_bits >= 5 loop
      v_out := v_out || substr(c_alpha, ((v_val >> (v_bits - 5)) & 31)::int + 1, 1);
      v_bits := v_bits - 5;
    end loop;
  end loop;
  if v_bits > 0 then
    v_out := v_out || substr(c_alpha, ((v_val << (5 - v_bits)) & 31)::int + 1, 1);
  end if;
  return v_out;
end $base32_encode_0305$;

comment on function app.base32_encode(bytea) is
  'Loyalty (M3). Internal, immutable: RFC 4648 base32 without padding (32 characters for a 20-byte card secret); base32Decode (@touch/core/loyalty) reads it.';

revoke all on function app.base32_encode(bytea) from public, anon, authenticated;

-- A fresh member code: 8 Crockford base32 characters (no I, L, O, U) from 40
-- random bits.
create or replace function app.loyalty_member_code() returns text
language plpgsql volatile set search_path = public as $loyalty_member_code_0305$
declare
  c_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_rand  bytea := extensions.gen_random_bytes(5);
  v_val   bigint := 0;
  v_out   text := '';
  i       int;
begin
  for i in 0 .. 4 loop
    v_val := (v_val << 8) | get_byte(v_rand, i);
  end loop;
  for i in reverse 7 .. 0 loop
    v_out := v_out || substr(c_alpha, ((v_val >> (i * 5)) & 31)::int + 1, 1);
  end loop;
  return v_out;
end $loyalty_member_code_0305$;

revoke all on function app.loyalty_member_code() from public, anon, authenticated;

-- The profile's card, created on first use (a unique member_code, retried on
-- the rare collision).
create or replace function app.loyalty_card_ensure(p_profile uuid) returns loyalty_cards
language plpgsql security definer set search_path = public as $loyalty_card_ensure_0305$
declare
  v_card  loyalty_cards%rowtype;
  v_try   int := 0;
begin
  select * into v_card from loyalty_cards where profile_id = p_profile;
  if found then
    return v_card;
  end if;
  loop
    v_try := v_try + 1;
    begin
      insert into loyalty_cards (profile_id, member_code, secret)
      values (p_profile, app.loyalty_member_code(), extensions.gen_random_bytes(20))
      on conflict (profile_id) do nothing
      returning * into v_card;
      if v_card.profile_id is null then
        select * into v_card from loyalty_cards where profile_id = p_profile;
      end if;
      return v_card;
    exception when unique_violation then
      if v_try >= 8 then
        raise;
      end if;
    end;
  end loop;
end $loyalty_card_ensure_0305$;

comment on function app.loyalty_card_ensure(uuid) is
  'Loyalty (M3). Internal: the profile''s loyalty_cards row, created on first use with a fresh member code (retried on a collision) and 20 random secret bytes.';

revoke all on function app.loyalty_card_ensure(uuid) from public, anon, authenticated;

-- The profile a member token names (internal). Accepts the current step ±2;
-- a well-formed token whose digits match a step within ten minutes either way
-- is MEMBER_CODE_EXPIRED (a screenshot), anything else MEMBER_CODE_INVALID.
create or replace function app.loyalty_token_profile(p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $loyalty_token_profile_0305$
declare
  v_t       text := upper(btrim(coalesce(p_token, '')));
  v_m       text[];
  v_card    loyalty_cards%rowtype;
  v_step    int;
  v_now     bigint;
  v_window  int;
  k         int;
begin
  v_m := regexp_match(v_t, '^TP-([0-9A-HJKMNP-TV-Z]{8})-([0-9]{6})$');
  if v_m is null then
    raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
  end if;
  select c.* into v_card
    from loyalty_cards c
    join profiles p on p.id = c.profile_id and p.deleted_at is null
   where c.member_code = v_m[1];
  if not found then
    raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
  end if;
  v_step := coalesce((select s.totp_step_seconds from loyalty_settings s where s.id), 30);
  v_now := floor(extract(epoch from now()) / v_step)::bigint;
  for k in -2 .. 2 loop
    if app.loyalty_totp(v_card.secret, v_now + k) = v_m[2] then
      return v_card.profile_id;
    end if;
  end loop;
  v_window := ceil(600.0 / v_step)::int;
  for k in -v_window .. v_window loop
    continue when k between -2 and 2;
    if app.loyalty_totp(v_card.secret, v_now + k) = v_m[2] then
      raise exception 'MEMBER_CODE_EXPIRED' using errcode = 'P0001';
    end if;
  end loop;
  raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
end $loyalty_token_profile_0305$;

comment on function app.loyalty_token_profile(text) is
  'Loyalty (M3, contracts §1.3). Internal: the live profile a TP-<member_code>-<6 digits> token names, the digits checked against counters now ± 2 (now = floor(epoch / totp_step_seconds)). MEMBER_CODE_EXPIRED when they match a step within ten minutes outside that window, MEMBER_CODE_INVALID otherwise (a bad shape, an unknown code, wrong digits).';

revoke all on function app.loyalty_token_profile(text) from public, anon, authenticated;

-- "Given F." for the till, never the full name: given name and family
-- initial, else full_name.
create or replace function app.loyalty_display_name(p_profile uuid) returns text
language sql stable security definer set search_path = public as $loyalty_display_name_0305$
  select coalesce(
           nullif(btrim(coalesce(p.given_name, '')
                        || case when nullif(btrim(coalesce(p.family_name, '')), '') is not null
                                then ' ' || left(btrim(p.family_name), 1) || '.' else '' end), ''),
           p.full_name)
    from profiles p
   where p.id = p_profile
$loyalty_display_name_0305$;

revoke all on function app.loyalty_display_name(uuid) from public, anon, authenticated;

-- The phone with all but its last four digits masked, for the till.
create or replace function app.loyalty_phone_masked(p_phone text) returns text
language plpgsql immutable set search_path = public as $loyalty_phone_masked_0305$
declare
  v_d text := app.phone_digits(p_phone);
begin
  if v_d is null or v_d = '' then
    return null;
  end if;
  if length(v_d) <= 4 then
    return v_d;
  end if;
  return repeat('•', length(v_d) - 4) || right(v_d, 4);
end $loyalty_phone_masked_0305$;

revoke all on function app.loyalty_phone_masked(text) from public, anon, authenticated;

-- The tier object of the answers: {id, name_en, name_ar, multiplier}.
create or replace function app.loyalty_tier_json(p_tier uuid) returns jsonb
language sql stable security definer set search_path = public as $loyalty_tier_json_0305$
  select jsonb_build_object('id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                            'multiplier', t.earn_multiplier)
    from loyalty_tiers t
   where t.id = coalesce(p_tier, (select b.id from loyalty_tiers b order by b.sort limit 1))
$loyalty_tier_json_0305$;

revoke all on function app.loyalty_tier_json(uuid) from public, anon, authenticated;

-- The newest ledger rows of a profile, as LedgerRow[].
create or replace function app.loyalty_history(p_profile uuid, p_limit int) returns jsonb
language sql stable security definer set search_path = public as $loyalty_history_0305$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'delta', h.delta,
                                               'venue_id', h.venue_id, 'created_at', h.created_at,
                                               'note', h.note)
                            order by h.created_at desc, h.id desc), '[]'::jsonb)
    from (select l.* from loyalty_ledger l
           where l.profile_id = p_profile
           order by l.created_at desc, l.id desc
           limit p_limit) h
$loyalty_history_0305$;

revoke all on function app.loyalty_history(uuid, int) from public, anon, authenticated;

-- ===========================================================================
-- 5. The RPCs (§1.3)
-- ===========================================================================

-- ── the guest ───────────────────────────────────────────────────────────────

-- The caller's live profile, or ACCOUNT_REQUIRED (an anonymous café session
-- has no profile; a deleted account is a tombstone).
create or replace function app.loyalty_me() returns uuid
language plpgsql stable security definer set search_path = public as $loyalty_me_0305$
declare
  v uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select p.id into v from profiles p where p.id = auth.uid() and p.deleted_at is null;
  if v is null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  return v;
end $loyalty_me_0305$;

revoke all on function app.loyalty_me() from public, anon, authenticated;

create or replace function app.my_loyalty() returns jsonb
language plpgsql stable security definer set search_path = public as $my_loyalty_0305$
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
                            'multiplier', t.earn_multiplier, 'min_points_12m', t.min_points_12m)
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
    'history',           app.loyalty_history(v_me, 50),
    'rewards',           coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                                          'cost_points', r.cost_points, 'kind', r.kind, 'iqd_off', r.iqd_off)
                       order by r.cost_points, r.id)
        from loyalty_rewards r
       where r.active), '[]'::jsonb));
end $my_loyalty_0305$;

comment on function app.my_loyalty() is
  'Loyalty (M3, contracts §1.3). The signed-in guest''s points: {enabled, balance, lifetime, points_12m, tier {id, name_en, name_ar, multiplier} (the base tier without an account), next_tier (+ min_points_12m) | null, point_value_iqd, min_redeem_points, history (50 newest LedgerRow), rewards (every active one, any branch)}. AUTH_REQUIRED without a session, ACCOUNT_REQUIRED for an anonymous session or a deleted account.';

revoke all on function app.my_loyalty() from public, anon;
grant execute on function app.my_loyalty() to authenticated;

create or replace function app.my_member_card() returns jsonb
language plpgsql security definer set search_path = public as $my_member_card_0305$
declare
  v_me   uuid := app.loyalty_me();
  v_card loyalty_cards%rowtype;
begin
  v_card := app.loyalty_card_ensure(v_me);
  return jsonb_build_object(
    'member_code', v_card.member_code,
    'secret_b32',  app.base32_encode(v_card.secret),
    'step',        coalesce((select s.totp_step_seconds from loyalty_settings s where s.id), 30));
end $my_member_card_0305$;

comment on function app.my_member_card() is
  'Loyalty (M3, contracts §1.3, L-4). The signed-in guest''s member card {member_code, secret_b32 (RFC 4648, no padding), step}, created on first call. The phone or browser computes the rotating TP-<member_code>-<6 digits> token from it offline. AUTH_REQUIRED / ACCOUNT_REQUIRED as my_loyalty.';

revoke all on function app.my_member_card() from public, anon;
grant execute on function app.my_member_card() to authenticated;

create or replace function app.rotate_member_card() returns jsonb
language plpgsql security definer set search_path = public as $rotate_member_card_0305$
declare
  v_me uuid := app.loyalty_me();
begin
  perform app.loyalty_card_ensure(v_me);
  update loyalty_cards
     set secret = extensions.gen_random_bytes(20), rotated_at = now()
   where profile_id = v_me;
  perform app.write_audit('loyalty.card_rotate', 'loyalty_cards', v_me::text, null, null, null);
  return app.my_member_card();
end $rotate_member_card_0305$;

comment on function app.rotate_member_card() is
  'Loyalty (M3, contracts §1.3). "My code was shared": a new secret for the signed-in guest''s card (the member code stays), so every token made from the old one stops working. Returns the my_member_card shape. Audited loyalty.card_rotate.';

revoke all on function app.rotate_member_card() from public, anon;
grant execute on function app.rotate_member_card() to authenticated;

-- An anonymous café session links itself to the account signed in in the
-- same browser, by a token that account's client computed: the tab's earn
-- then reaches the account (app.tab_customer).
create or replace function app.link_guest_session(p_member_token text) returns jsonb
language plpgsql security definer set search_path = public as $link_guest_session_0305$
declare
  v_uid     uuid := auth.uid();
  v_sess    guest_sessions%rowtype;
  v_profile uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = 'only an anonymous café session links to an account';
  end if;
  select * into v_sess
    from guest_sessions
   where auth_user_id = v_uid and closed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    raise exception 'SESSION_EXPIRED' using errcode = 'P0001';
  end if;

  v_profile := app.loyalty_token_profile(p_member_token);   -- MEMBER_CODE_INVALID | MEMBER_CODE_EXPIRED

  update guest_sessions set linked_profile_id = v_profile where id = v_sess.id;
  perform set_config('app.venue_id', v_sess.venue_id::text, true);
  perform app.write_audit('loyalty.link_session', 'guest_sessions', v_sess.id::text,
                          jsonb_build_object('linked_profile_id', v_sess.linked_profile_id),
                          jsonb_build_object('linked_profile_id', v_profile), null);
  return jsonb_build_object('linked', true, 'display_name', app.loyalty_display_name(v_profile));
end $link_guest_session_0305$;

comment on function app.link_guest_session(text) is
  'Loyalty (M3, contracts §1.3). An anonymous café session (auth.users.is_anonymous) with a live guest_sessions row sets its linked_profile_id from a member token (app.loyalty_token_profile): the account signed in in the same browser. Returns {linked: true, display_name}. AUTH_REQUIRED, FORBIDDEN (not anonymous), SESSION_EXPIRED (no live session), MEMBER_CODE_INVALID, MEMBER_CODE_EXPIRED. Audited loyalty.link_session.';

revoke all on function app.link_guest_session(text) from public, anon;
grant execute on function app.link_guest_session(text) to authenticated;

-- ── the desk ────────────────────────────────────────────────────────────────

-- Identify a guest at the till: a scanned or typed token, or the phone they
-- say (an exact phone_key match, never a partial one, so nobody can walk the
-- customer list). File A's profiles.phone_key holds app.phone_canon(phone).
create or replace function app.loyalty_identify(p_code text, p_venue_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_identify_0305$
declare
  v_raw     text := upper(btrim(coalesce(p_code, '')));
  v_digits  text;
  v_key     text;
  v_profile profiles%rowtype;
  v_id      uuid;
  v_method  text;
  v_acct    loyalty_accounts%rowtype;
  v_tier    loyalty_tiers%rowtype;
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is not null then
    if not (p_venue_id = any(app.visible_venue_ids())) then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', p_venue_id::text, true);
  end if;

  if v_raw like 'TP-%' then
    v_method := 'qr';
    v_id := app.loyalty_token_profile(v_raw);   -- MEMBER_CODE_INVALID | MEMBER_CODE_EXPIRED
  else
    v_digits := app.phone_digits(p_code);
    if v_raw ~ '[A-Z]' or v_digits is null or length(v_digits) not between 7 and 15 then
      raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
    end if;
    v_method := 'phone';
    v_key := app.phone_canon(p_code);
    select p.id into v_id
      from profiles p
     where p.phone_key = v_key and p.deleted_at is null
     order by p.created_at
     limit 1;
    if v_id is null then
      raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  select * into v_profile from profiles where id = v_id;
  select * into v_acct from loyalty_accounts where profile_id = v_id;
  select * into v_tier from loyalty_tiers
   where id = coalesce(v_acct.tier_id, (select b.id from loyalty_tiers b order by b.sort limit 1));

  perform app.write_audit('loyalty.identify', 'profiles', v_id::text, null,
                          jsonb_build_object('method', v_method, 'venue_id', p_venue_id), null);

  return jsonb_build_object(
    'customer_id',  v_id,
    'display_name', app.loyalty_display_name(v_id),
    'phone_masked', app.loyalty_phone_masked(v_profile.phone),
    'tier_name_en', v_tier.name_en,
    'tier_name_ar', v_tier.name_ar,
    'balance',      coalesce(v_acct.balance, 0),
    'enabled',      coalesce((select s.enabled from loyalty_settings s where s.id), false));
end $loyalty_identify_0305$;

comment on function app.loyalty_identify(text, uuid) is
  'Loyalty (M3, contracts §1.3, L-4). Cashier, shop_staff, court_desk, manager, owner; p_venue_id (when sent) one the caller can see (VENUE_MISMATCH). p_code is a member token (TP-…, app.loyalty_token_profile: MEMBER_CODE_INVALID, MEMBER_CODE_EXPIRED) or a phone of 7-15 digits matched exactly on profiles.phone_key (MEMBER_NOT_FOUND; no partial match); anything else MEMBER_CODE_INVALID. Returns {customer_id, display_name (given name + family initial), phone_masked (last four digits), tier_name_en, tier_name_ar, balance, enabled}. Audited loyalty.identify {method qr|phone, venue_id}.';

revoke all on function app.loyalty_identify(text, uuid) from public, anon;
grant execute on function app.loyalty_identify(text, uuid) to authenticated;

create or replace function app.set_tab_customer(p_tab_id uuid, p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $set_tab_customer_0305$
declare
  v_venue uuid;
  v_tab   tabs%rowtype;
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides who may act and where the rows land.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244: shop_staff shop tabs only
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from profiles p where p.id = p_customer_id and p.deleted_at is null) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_tab.customer_id is distinct from p_customer_id then
    update tabs set customer_id = p_customer_id where id = p_tab_id;
    perform app.write_audit('loyalty.attach', 'tabs', p_tab_id::text,
                            jsonb_build_object('customer_id', v_tab.customer_id),
                            jsonb_build_object('customer_id', p_customer_id), null);
  end if;
  return jsonb_build_object('tab_id', p_tab_id, 'customer_id', p_customer_id);
end $set_tab_customer_0305$;

comment on function app.set_tab_customer(uuid, uuid) is
  'Loyalty (M3, contracts §1.3). Cashier, shop_staff, court_desk, manager, owner at the tab''s branch (VENUE_MISMATCH), the tab''s kind for the role (app.assert_tab_kind_role, TAB_KIND_FORBIDDEN): attaches a guest to an open tab (TAB_NOT_OPEN), or detaches with null. MEMBER_NOT_FOUND for an unknown or deleted profile; TAB_NOT_FOUND. Online-only (L-6). Returns {tab_id, customer_id}; audited loyalty.attach when it changes.';

revoke all on function app.set_tab_customer(uuid, uuid) from public, anon;
grant execute on function app.set_tab_customer(uuid, uuid) to authenticated;

-- Redeem points or a reward as a whole-tab discount (L-5: a tab_adjustments
-- row, not a payment method), with its ledger row in the same transaction.
-- The amount is capped at what is left to discount: the goods not already
-- discounted (compute_tab_totals caps discounts at the goods subtotal; court,
-- lesson and entry money is never discounted) and the bill still unpaid.
create or replace function app.loyalty_redeem(
  p_tab_id          uuid,
  p_points          int,
  p_reward_id       uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_redeem_0305$
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

  -- loyalty_accounts last (lock order): the balance read below holds.
  select a.balance into v_balance from loyalty_accounts a where a.profile_id = v_customer for update;
  v_balance := coalesce(v_balance, 0);

  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_room := least(greatest(coalesce(v_totals.subtotal_iqd, 0) - coalesce(v_totals.discount_iqd, 0), 0),
                  greatest(coalesce(v_totals.total_iqd, 0) - app.tab_net_paid(p_tab_id), 0));

  if p_reward_id is not null then
    select * into v_reward from loyalty_rewards r
     where r.id = p_reward_id and r.active and (r.venue_id is null or r.venue_id = v_tab.venue_id);
    if not found then
      raise exception 'REWARD_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_balance < v_reward.cost_points then
      raise exception 'POINTS_INSUFFICIENT' using errcode = 'P0001',
        detail = format('balance %s, cost %s', v_balance, v_reward.cost_points);
    end if;
    v_points := v_reward.cost_points;
    v_amount := least(case when v_reward.kind = 'iqd_off' then v_reward.iqd_off::bigint
                           else (select v.price_iqd from menu_item_variants v where v.id = v_reward.menu_variant_id)
                      end, v_room);
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
  end if;
  if coalesce(v_amount, 0) < 1 or v_points < 1 then
    raise exception 'NOTHING_OWED' using errcode = 'P0001',
      hint = 'nothing on this bill is left to discount';
  end if;

  -- MATCH_BOOKING_NO_CAFE / LESSON_TAB_NO_GOODS come from the 0262/0281
  -- trigger on tab_adjustments, as for every discount.
  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (p_tab_id, null, 'discount_amount', v_points, v_amount, auth.uid(), auth.uid(),
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
                                                                'reward_id', p_reward_id),
                          v_adj.reason_code, auth.uid());

  v_result := jsonb_build_object(
    'adjustment_id', v_adj.id,
    'points',        v_points,
    'amount_iqd',    v_amount,
    'balance',       (select a.balance from loyalty_accounts a where a.profile_id = v_customer));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $loyalty_redeem_0305$;

comment on function app.loyalty_redeem(uuid, int, uuid, text) is
  'Loyalty (M3, contracts §1.3, L-5). Cashier, shop_staff, court_desk, manager, owner at the tab''s branch, the tab''s kind for the role. Exactly one of p_points and p_reward_id (INVALID_ARGUMENT). LOYALTY_OFF, then claim_replay, then the tab (TAB_NOT_FOUND, TAB_MERGED, TAB_NOT_OPEN: open only) and its customer (NO_CUSTOMER), the account locked last. Points: POINTS_BELOW_MIN (min_redeem_points), POINTS_INSUFFICIENT, then rounded down to fit what is left to discount (the goods not yet discounted, and the unpaid bill), amount = points * point_value_iqd. Reward: active, this branch or every branch (REWARD_NOT_FOUND), POINTS_INSUFFICIENT for cost_points, amount = iqd_off or the variant''s price, capped. NOTHING_OWED when nothing is left to discount. Writes a tab_adjustments discount_amount (value = points, applied_by = authorized_by = the caller, reason_code loyalty_points | loyalty_reward) and a ledger row (redeem | reward, tab_adjustment, adjustment_id) in one transaction, then the 0037 guard. Returns {adjustment_id, points, amount_iqd, balance}. Audited loyalty.redeem.';

revoke all on function app.loyalty_redeem(uuid, int, uuid, text) from public, anon;
grant execute on function app.loyalty_redeem(uuid, int, uuid, text) to authenticated;

create or replace function app.loyalty_unredeem(p_adjustment_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_unredeem_0305$
declare
  v_venue uuid;
  v_adj   tab_adjustments%rowtype;
  v_tab   tabs%rowtype;
  v_row   loyalty_ledger%rowtype;
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := (select t.venue_id from tab_adjustments a join tabs t on t.id = a.tab_id where a.id = p_adjustment_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  select t.* into v_tab
    from tabs t
   where t.id = (select a.tab_id from tab_adjustments a where a.id = p_adjustment_id)
     for update;
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

  perform 1 from loyalty_accounts a where a.profile_id = v_row.profile_id for update;
  delete from tab_adjustments where id = p_adjustment_id;
  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
  values (v_row.profile_id, v_row.venue_id, -v_row.delta, 'redeem_void', 'tab_adjustment', p_adjustment_id,
          v_tab.id, auth.uid());

  perform app.write_audit('loyalty.unredeem', 'tab_adjustments', p_adjustment_id::text, to_jsonb(v_adj), null,
                          v_adj.reason_code, auth.uid());
  return jsonb_build_object('balance',
    (select a.balance from loyalty_accounts a where a.profile_id = v_row.profile_id));
end $loyalty_unredeem_0305$;

comment on function app.loyalty_unredeem(uuid) is
  'Loyalty (M3, contracts §1.3). Same roles as loyalty_redeem, at the tab''s branch, the tab''s kind for the role. Reverses a loyalty redemption on a tab that is still open (TAB_NOT_OPEN): deletes the adjustment and writes (redeem_void, tab_adjustment, adjustment_id) giving the points back. INVALID_ARGUMENT for an adjustment that is not a loyalty redemption. Returns {balance}. Audited loyalty.unredeem.';

revoke all on function app.loyalty_unredeem(uuid) from public, anon;
grant execute on function app.loyalty_unredeem(uuid) to authenticated;

create or replace function app.loyalty_adjust(p_profile_id uuid, p_delta int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_adjust_0305$
declare
  v_auth   uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid := gen_random_uuid();
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_delta';
  end if;
  if not exists (select 1 from profiles p where p.id = p_profile_id and p.deleted_at is null) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 0115/0119: the caller proved a manager PIN to app.verify_manager_pin and
  -- holds a single-use grant; PIN_GRANT_REQUIRED otherwise.
  v_auth := app.consume_pin_grant(null);

  perform 1 from loyalty_accounts a where a.profile_id = p_profile_id for update;
  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, actor_id, note)
  values (p_profile_id, null, p_delta, 'adjust', 'adjust', v_id, auth.uid(), left(app.safe_line(v_reason), 200));

  perform app.write_audit('loyalty.adjust', 'profiles', p_profile_id::text, null,
                          jsonb_build_object('delta', p_delta, 'ledger_source_id', v_id), v_reason, v_auth);
  return jsonb_build_object('balance',
    (select a.balance from loyalty_accounts a where a.profile_id = p_profile_id));
end $loyalty_adjust_0305$;

comment on function app.loyalty_adjust(uuid, int, text) is
  'Loyalty (M3, contracts §1.3). Manager or owner, behind a manager PIN grant (app.consume_pin_grant, PIN_GRANT_REQUIRED; 0115 pattern): adds p_delta points (non-zero, at most a million either way; INVALID_ARGUMENT) to a live profile (MEMBER_NOT_FOUND) with a reason (REASON_REQUIRED), as (adjust, adjust, fresh id) with the reason as the note. Counts toward lifetime and the 12-month tier points. Returns {balance}. Audited loyalty.adjust with the authorizer.';

revoke all on function app.loyalty_adjust(uuid, int, text) from public, anon;
grant execute on function app.loyalty_adjust(uuid, int, text) to authenticated;

create or replace function app.loyalty_customer(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_customer_0305$
declare
  v_acct loyalty_accounts%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = p_profile_id) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_acct from loyalty_accounts where profile_id = p_profile_id;
  return jsonb_build_object(
    'balance',    coalesce(v_acct.balance, 0),
    'lifetime',   coalesce(v_acct.lifetime_earned, 0),
    'points_12m', coalesce(v_acct.points_12m, 0),
    'tier',       app.loyalty_tier_json(v_acct.tier_id),
    'history',    app.loyalty_history(p_profile_id, 100));
end $loyalty_customer_0305$;

comment on function app.loyalty_customer(uuid) is
  'Loyalty (M3, contracts §1.3). Any staff: one guest''s points for the customer record {balance, lifetime, points_12m, tier, history (100 newest LedgerRow)}. MEMBER_NOT_FOUND for an unknown profile.';

revoke all on function app.loyalty_customer(uuid) from public, anon;
grant execute on function app.loyalty_customer(uuid) to authenticated;

-- ── setup (owner) ───────────────────────────────────────────────────────────

create or replace function app.loyalty_settings_json() returns jsonb
language sql stable security definer set search_path = public as $loyalty_settings_json_0305$
  select to_jsonb(s) - 'id' - 'updated_by' from loyalty_settings s where s.id
$loyalty_settings_json_0305$;

revoke all on function app.loyalty_settings_json() from public, anon, authenticated;

create or replace function app.loyalty_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_admin_0305$
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'settings', app.loyalty_settings_json(),
    'tiers', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                         'min_points_12m', t.min_points_12m, 'earn_multiplier', t.earn_multiplier,
                         'promotion_id', t.promotion_id, 'sort', t.sort) order by t.sort)
                         from loyalty_tiers t), '[]'::jsonb),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                           'cost_points', r.cost_points, 'kind', r.kind, 'iqd_off', r.iqd_off,
                           'menu_variant_id', r.menu_variant_id, 'active', r.active,
                           'venue_id', r.venue_id) order by r.active desc, r.cost_points, r.id)
                           from loyalty_rewards r), '[]'::jsonb));
end $loyalty_admin_0305$;

comment on function app.loyalty_admin() is
  'Loyalty (M3, contracts §1.3). Manager or owner: {settings (LoyaltySettings + updated_at), tiers (by sort), rewards (active first)} for Setup > Loyalty.';

revoke all on function app.loyalty_admin() from public, anon;
grant execute on function app.loyalty_admin() to authenticated;

create or replace function app.set_loyalty_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_loyalty_settings_0305$
declare
  v_key    text;
  v_before jsonb;
  v_row    loyalty_settings%rowtype;
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
                     'totp_step_seconds') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  v_before := app.loyalty_settings_json();
  select * into v_row from loyalty_settings where id for update;
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
           updated_at               = now(),
           updated_by               = auth.uid()
     where id;
  exception when check_violation or not_null_violation or invalid_text_representation
                 or numeric_value_out_of_range or datatype_mismatch or invalid_parameter_value then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.write_audit('loyalty.settings', 'loyalty_settings', 'true', v_before, app.loyalty_settings_json(), null);
  return app.loyalty_settings_json();
end $set_loyalty_settings_0305$;

comment on function app.set_loyalty_settings(jsonb) is
  'Loyalty (M3, contracts §1.3). Owner: patches the business-wide settings with the keys given (enabled, iqd_per_point, point_value_iqd, min_redeem_points, earn_cafe, earn_shop, earn_court, earn_lesson, earn_tournament, inactivity_expiry_months, totp_step_seconds); an unknown key is INVALID_ARGUMENT (detail = the key), a value the table refuses INVALID_VALUE. Returns the settings. Audited loyalty.settings.';

revoke all on function app.set_loyalty_settings(jsonb) from public, anon;
grant execute on function app.set_loyalty_settings(jsonb) to authenticated;

-- Every account's tier, after the tiers changed (internal).
create or replace function app.loyalty_retier() returns void
language plpgsql security definer set search_path = public as $loyalty_retier_0305$
begin
  update loyalty_accounts a
     set tier_id = x.tier_id, updated_at = now()
    from (select a2.profile_id,
                 (select t.id from loyalty_tiers t where t.min_points_12m <= a2.points_12m
                   order by t.min_points_12m desc limit 1) as tier_id
            from loyalty_accounts a2) x
   where x.profile_id = a.profile_id
     and a.tier_id is distinct from x.tier_id;
end $loyalty_retier_0305$;

revoke all on function app.loyalty_retier() from public, anon, authenticated;

create or replace function app.upsert_loyalty_tier(p_tier jsonb) returns jsonb
language plpgsql security definer set search_path = public as $upsert_loyalty_tier_0305$
declare
  v_id   uuid;
  v_row  loyalty_tiers%rowtype;
  v_old  loyalty_tiers%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_tier is null or jsonb_typeof(p_tier) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_tier';
  end if;
  begin
    v_id := nullif(p_tier->>'id', '')::uuid;
    if v_id is not null then
      select * into v_old from loyalty_tiers where id = v_id for update;
      if not found then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'id';
      end if;
      -- The base tier stays the base tier.
      if v_old.sort = 0 and coalesce((p_tier->>'sort')::smallint, 0) <> 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'sort';
      end if;
      update loyalty_tiers
         set name_en         = coalesce(app.safe_line(p_tier->>'name_en'), name_en),
             name_ar         = coalesce(app.safe_line(p_tier->>'name_ar'), name_ar),
             min_points_12m  = coalesce((p_tier->>'min_points_12m')::int, min_points_12m),
             earn_multiplier = coalesce((p_tier->>'earn_multiplier')::numeric, earn_multiplier),
             promotion_id    = case when p_tier ? 'promotion_id' then nullif(p_tier->>'promotion_id', '')::uuid
                                    else promotion_id end,
             sort            = coalesce((p_tier->>'sort')::smallint, sort)
       where id = v_id
      returning * into v_row;
    else
      insert into loyalty_tiers (name_en, name_ar, min_points_12m, earn_multiplier, promotion_id, sort)
      values (app.safe_line(p_tier->>'name_en'), app.safe_line(p_tier->>'name_ar'),
              (p_tier->>'min_points_12m')::int, coalesce((p_tier->>'earn_multiplier')::numeric, 1),
              nullif(p_tier->>'promotion_id', '')::uuid, (p_tier->>'sort')::smallint)
      returning * into v_row;
    end if;
  exception
    when raise_exception then raise;
    when others then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.loyalty_retier();
  perform app.write_audit('loyalty.tier', 'loyalty_tiers', v_row.id::text,
                          case when v_old.id is not null then to_jsonb(v_old) end, to_jsonb(v_row), null);
  return jsonb_build_object('id', v_row.id, 'name_en', v_row.name_en, 'name_ar', v_row.name_ar,
                            'min_points_12m', v_row.min_points_12m, 'earn_multiplier', v_row.earn_multiplier,
                            'promotion_id', v_row.promotion_id, 'sort', v_row.sort);
end $upsert_loyalty_tier_0305$;

comment on function app.upsert_loyalty_tier(jsonb) is
  'Loyalty (M3, contracts §1.3). Owner: creates a tier (no id) or updates one (id; absent keys kept) from {name_en, name_ar, min_points_12m, earn_multiplier (1-5), promotion_id, sort}. The sort-0 tier is the base (from 0 points) and keeps sort 0. INVALID_ARGUMENT (unknown id, the base''s sort), INVALID_VALUE (what the table refuses: a duplicate threshold or sort, a missing name). Every account''s tier follows at once. Returns the tier (LoyaltyAdminTier). Audited loyalty.tier.';

revoke all on function app.upsert_loyalty_tier(jsonb) from public, anon;
grant execute on function app.upsert_loyalty_tier(jsonb) to authenticated;

create or replace function app.delete_loyalty_tier(p_tier_id uuid) returns void
language plpgsql security definer set search_path = public as $delete_loyalty_tier_0305$
declare
  v_old loyalty_tiers%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_old from loyalty_tiers where id = p_tier_id for update;
  if not found or v_old.sort = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_tier_id';
  end if;
  delete from loyalty_tiers where id = p_tier_id;
  perform app.loyalty_retier();
  perform app.write_audit('loyalty.tier_delete', 'loyalty_tiers', p_tier_id::text, to_jsonb(v_old), null, null);
end $delete_loyalty_tier_0305$;

comment on function app.delete_loyalty_tier(uuid) is
  'Loyalty (M3, contracts §1.3). Owner: deletes a tier; the base tier (sort 0) or an unknown id is INVALID_ARGUMENT. Its accounts fall to the tier their points now reach. Audited loyalty.tier_delete.';

revoke all on function app.delete_loyalty_tier(uuid) from public, anon;
grant execute on function app.delete_loyalty_tier(uuid) to authenticated;

create or replace function app.upsert_loyalty_reward(p_reward jsonb) returns jsonb
language plpgsql security definer set search_path = public as $upsert_loyalty_reward_0305$
declare
  v_id    uuid;
  v_row   loyalty_rewards%rowtype;
  v_old   loyalty_rewards%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reward is null or jsonb_typeof(p_reward) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reward';
  end if;
  begin
    v_id := nullif(p_reward->>'id', '')::uuid;
    if v_id is not null then
      select * into v_old from loyalty_rewards where id = v_id for update;
      if not found then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'id';
      end if;
    end if;
    v_row := v_old;
    v_row.name_en     := coalesce(app.safe_line(p_reward->>'name_en'), v_old.name_en);
    v_row.name_ar     := coalesce(app.safe_line(p_reward->>'name_ar'), v_old.name_ar);
    v_row.cost_points := coalesce((p_reward->>'cost_points')::int, v_old.cost_points);
    v_row.kind        := coalesce(p_reward->>'kind', v_old.kind);
    v_row.iqd_off     := case when p_reward ? 'iqd_off' then (p_reward->>'iqd_off')::int else v_old.iqd_off end;
    v_row.menu_variant_id := case when p_reward ? 'menu_variant_id' then nullif(p_reward->>'menu_variant_id', '')::uuid
                                  else v_old.menu_variant_id end;
    v_row.active      := coalesce((p_reward->>'active')::boolean, v_old.active, true);
    v_row.venue_id    := case when p_reward ? 'venue_id' then nullif(p_reward->>'venue_id', '')::uuid
                              else v_old.venue_id end;
    if v_row.venue_id is not null then
      perform set_config('app.venue_id', v_row.venue_id::text, true);
    end if;
    if v_id is null then
      insert into loyalty_rewards (name_en, name_ar, cost_points, kind, iqd_off, menu_variant_id, active, venue_id)
      values (v_row.name_en, v_row.name_ar, v_row.cost_points, v_row.kind, v_row.iqd_off, v_row.menu_variant_id,
              v_row.active, v_row.venue_id)
      returning * into v_row;
    else
      update loyalty_rewards
         set name_en = v_row.name_en, name_ar = v_row.name_ar, cost_points = v_row.cost_points,
             kind = v_row.kind, iqd_off = v_row.iqd_off, menu_variant_id = v_row.menu_variant_id,
             active = v_row.active, venue_id = v_row.venue_id
       where id = v_id
      returning * into v_row;
    end if;
  exception
    when raise_exception then raise;
    when others then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.write_audit('loyalty.reward', 'loyalty_rewards', v_row.id::text,
                          case when v_old.id is not null then to_jsonb(v_old) end, to_jsonb(v_row), null);
  return jsonb_build_object('id', v_row.id, 'name_en', v_row.name_en, 'name_ar', v_row.name_ar,
                            'cost_points', v_row.cost_points, 'kind', v_row.kind, 'iqd_off', v_row.iqd_off,
                            'menu_variant_id', v_row.menu_variant_id, 'active', v_row.active,
                            'venue_id', v_row.venue_id);
end $upsert_loyalty_reward_0305$;

comment on function app.upsert_loyalty_reward(jsonb) is
  'Loyalty (M3, contracts §1.3). Owner: creates a reward (no id) or updates one (id; absent keys kept) from {name_en, name_ar, cost_points, kind iqd_off|item, iqd_off, menu_variant_id, active, venue_id (null = every branch)}. INVALID_ARGUMENT (unknown id), INVALID_VALUE (what the table refuses: the kind''s shape, a variant of another branch is VENUE_MISMATCH from the branch guard). Returns the reward (LoyaltyAdminReward). Audited loyalty.reward.';

revoke all on function app.upsert_loyalty_reward(jsonb) from public, anon;
grant execute on function app.upsert_loyalty_reward(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The till's terms and the public switch (integration, 2026-10-05). The six
-- loyalty tables stay closed to clients; the desk and the website read what
-- they need through these two.
-- ---------------------------------------------------------------------------
create or replace function app.loyalty_till_terms(p_venue_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_till_terms_0305$
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
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                                          'cost_points', r.cost_points, 'kind', r.kind,
                                          'iqd_off', r.iqd_off, 'menu_variant_id', r.menu_variant_id,
                                          'active', r.active, 'venue_id', r.venue_id)
                       order by r.cost_points, r.name_en)
        from loyalty_rewards r
       where r.active and (r.venue_id is null or r.venue_id = p_venue_id)), '[]'::jsonb));
end $loyalty_till_terms_0305$;

comment on function app.loyalty_till_terms(uuid) is
  'Loyalty (M3, integration). Desk roles (cashier, shop_staff, court_desk, manager, owner): what the till needs to offer points and rewards: {enabled, point_value_iqd, min_redeem_points, rewards[] active at p_venue_id or every branch}. VENUE_MISMATCH outside the caller''s branches. Read-only.';

revoke all on function app.loyalty_till_terms(uuid) from public, anon;
grant execute on function app.loyalty_till_terms(uuid) to authenticated;

create or replace function app.loyalty_public() returns jsonb
language sql stable security definer set search_path = public as $loyalty_public_0305$
  select jsonb_build_object('enabled', coalesce((select s.enabled from loyalty_settings s where s.id), false));
$loyalty_public_0305$;

comment on function app.loyalty_public() is
  'Loyalty (M3, integration). Public by design: {enabled} only, so the website hides "sign in to earn points" while the programme is off. Reveals nothing about any account.';

revoke all on function app.loyalty_public() from public;
grant execute on function app.loyalty_public() to anon, authenticated;
