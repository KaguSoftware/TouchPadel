set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0376 loyalty_tier_colors — each tier has a colour, and points given by hand
-- count toward the tier (Ameen, 2026-10-31: "i made a new tier ... from 100
-- points and then got an account over 100 points and the card never changed";
-- the owner picks a tier's colour and the guest's card follows it).
--
--   1. loyalty_tiers.color: one of classic | bronze | silver | gold | platinum |
--      black (TIER_COLORS, @touch/core/loyalty), default classic, so every tier
--      made before this one keeps the card it had. The phone's points card draws
--      its lines, its tier word and the holder's name in it; black is a black
--      card.
--   2. upsert_loyalty_tier (latest 0309) takes and returns color; loyalty_admin
--      (latest 0305) lists it; loyalty_tier_json (latest 0305) carries it, so
--      my_loyalty's tier and loyalty_customer's do; my_loyalty (latest 0308)
--      also gives next_tier its color.
--   3. Points given by hand (kind adjust, app.loyalty_adjust) count toward
--      lifetime and the 12-month tier points again, as 0305 had them (Ameen:
--      "all gifts count", owner's and manager's alike). 0308 (c17) had made an
--      adjustment move the balance only, which is why a gifted account never
--      moved up. A manager's gifts stay capped at 1,000 points in a rolling 24
--      hours and the owners still hear of each (loyalty_adjust, unchanged).
--      loyalty_recompute (latest 0308) and loyalty_nightly_one (latest 0309),
--      whose "unchanged" test reads the same sum, are re-issued, and every live
--      account is rebuilt once under the rule.

-- ===========================================================================
-- 1. The column
-- ===========================================================================
alter table loyalty_tiers add column if not exists color text not null default 'classic';

do $loyalty_tiers_color_0376$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'loyalty_tiers_color'
                    and conrelid = 'public.loyalty_tiers'::regclass) then
    alter table loyalty_tiers add constraint loyalty_tiers_color
      check (color in ('classic', 'bronze', 'silver', 'gold', 'platinum', 'black')) not valid;
  end if;
end $loyalty_tiers_color_0376$;

do $loyalty_tiers_color_validate_0376$
begin
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_tiers_color'
                and conrelid = 'public.loyalty_tiers'::regclass
                and not convalidated) then
    alter table loyalty_tiers validate constraint loyalty_tiers_color;
  end if;
end $loyalty_tiers_color_validate_0376$;

comment on column loyalty_tiers.color is
  '0376. The colour the owner gave the tier: classic (Padel Green on the brand blue card, the card before 0376) | bronze | silver | gold | platinum | black (a black card). The guest''s points card draws its lines, its tier word and the holder''s name in it. The same keys as TIER_COLORS in @touch/core/loyalty.';

-- ===========================================================================
-- 2. The tier answers
-- ===========================================================================

-- loyalty_tier_json: re-issued from 20261005000305_loyalty.sql:729
create or replace function app.loyalty_tier_json(p_tier uuid) returns jsonb
language sql stable security definer set search_path = public as $loyalty_tier_json_0376$
  select jsonb_build_object('id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                            'multiplier', t.earn_multiplier,
                            'color', t.color)   -- 0376
    from loyalty_tiers t
   where t.id = coalesce(p_tier, (select b.id from loyalty_tiers b order by b.sort limit 1))
$loyalty_tier_json_0376$;

revoke all on function app.loyalty_tier_json(uuid) from public, anon, authenticated;

-- my_loyalty: re-issued from 20261006000308_loyalty_earn_redeem.sql:853
create or replace function app.my_loyalty() returns jsonb
language plpgsql stable security definer set search_path = public as $my_loyalty_0376$
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
    'history',           app.loyalty_history_guest(v_me, 50),   -- 0308 (s1)
    'rewards',           coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                                          'cost_points', r.cost_points, 'kind', r.kind, 'iqd_off', r.iqd_off)
                       order by r.cost_points, r.id)
        from loyalty_rewards r
       where r.active), '[]'::jsonb));
end $my_loyalty_0376$;

comment on function app.my_loyalty() is
  'Loyalty (M3, contracts §1.3; 0308, 0376). The signed-in guest''s points: {enabled, balance, lifetime, points_12m, tier {id, name_en, name_ar, multiplier, color} (the base tier without an account), next_tier (+ min_points_12m, color) | null, point_value_iqd, min_redeem_points, history (50 newest LedgerRow; since 0308 the note only on reward and expire rows), rewards (every active one, any branch)}. AUTH_REQUIRED without a session, ACCOUNT_REQUIRED for an anonymous session or a deleted account.';

revoke all on function app.my_loyalty() from public, anon;
grant execute on function app.my_loyalty() to authenticated;

-- loyalty_admin: re-issued from 20261005000305_loyalty.sql:1307
create or replace function app.loyalty_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_admin_0376$
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
                         'color', t.color) order by t.sort)   -- 0376
                         from loyalty_tiers t), '[]'::jsonb),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object(
                           'id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                           'cost_points', r.cost_points, 'kind', r.kind, 'iqd_off', r.iqd_off,
                           'menu_variant_id', r.menu_variant_id, 'active', r.active,
                           'venue_id', r.venue_id) order by r.active desc, r.cost_points, r.id)
                           from loyalty_rewards r), '[]'::jsonb));
end $loyalty_admin_0376$;

comment on function app.loyalty_admin() is
  'Loyalty (M3, contracts §1.3; 0376). Manager or owner: {settings (LoyaltySettings + updated_at), tiers (by sort, each with its color), rewards (active first)} for Setup > Loyalty.';

revoke all on function app.loyalty_admin() from public, anon;
grant execute on function app.loyalty_admin() to authenticated;

-- upsert_loyalty_tier: re-issued from 20261006000309_loyalty_promotions_nightly.sql:962
create or replace function app.upsert_loyalty_tier(p_tier jsonb) returns jsonb
language plpgsql security definer set search_path = public as $upsert_loyalty_tier_0376$
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
      -- 0309 (c6): promotion_id is no longer written (a tier promotion names
      -- its tier in limits.tierMin).
      update loyalty_tiers
         set name_en         = coalesce(app.safe_line(p_tier->>'name_en'), name_en),
             name_ar         = coalesce(app.safe_line(p_tier->>'name_ar'), name_ar),
             min_points_12m  = coalesce((p_tier->>'min_points_12m')::int, min_points_12m),
             earn_multiplier = coalesce((p_tier->>'earn_multiplier')::numeric, earn_multiplier),
             sort            = coalesce((p_tier->>'sort')::smallint, sort),
             color           = coalesce(p_tier->>'color', color)   -- 0376
       where id = v_id
      returning * into v_row;
    else
      insert into loyalty_tiers (name_en, name_ar, min_points_12m, earn_multiplier, sort, color)
      values (app.safe_line(p_tier->>'name_en'), app.safe_line(p_tier->>'name_ar'),
              (p_tier->>'min_points_12m')::int, coalesce((p_tier->>'earn_multiplier')::numeric, 1),
              (p_tier->>'sort')::smallint, coalesce(p_tier->>'color', 'classic'))   -- 0376
      returning * into v_row;
    end if;
    -- 0309 (c16): the order follows the points.
    perform app.loyalty_tiers_renumber();
  exception
    when raise_exception then raise;
    when others then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;
  select * into v_row from loyalty_tiers where id = v_row.id;

  perform app.loyalty_retier();
  perform app.write_audit('loyalty.tier', 'loyalty_tiers', v_row.id::text,
                          case when v_old.id is not null then to_jsonb(v_old) end, to_jsonb(v_row), null);
  return jsonb_build_object('id', v_row.id, 'name_en', v_row.name_en, 'name_ar', v_row.name_ar,
                            'min_points_12m', v_row.min_points_12m, 'earn_multiplier', v_row.earn_multiplier,
                            'promotion_id', null, 'sort', v_row.sort,
                            'color', v_row.color);   -- 0376
end $upsert_loyalty_tier_0376$;

comment on function app.upsert_loyalty_tier(jsonb) is
  'Loyalty (M3, contracts §1.3; 0309, 0376). Owner: creates a tier (no id) or updates one (id; absent keys kept) from {name_en, name_ar, min_points_12m, earn_multiplier (1-5), sort, color (0376: classic | bronze | silver | gold | platinum | black, default classic)}. The sort-0 tier is the base (from 0 points) and keeps sort 0. 0309: promotion_id is ignored (always null; a tier promotion names the tier in limits.tierMin), and the sorts are renumbered to follow min_points_12m (c16), so the sort returned may differ from the one sent. INVALID_ARGUMENT (unknown id, the base''s sort), INVALID_VALUE (what the table refuses: a duplicate threshold or sort, a missing name, an unknown color). Every account''s tier follows at once. Returns the tier (LoyaltyAdminTier). Audited loyalty.tier.';

revoke all on function app.upsert_loyalty_tier(jsonb) from public, anon;
grant execute on function app.upsert_loyalty_tier(jsonb) to authenticated;

-- ===========================================================================
-- 3. Points given by hand count toward the tier
-- ===========================================================================

-- loyalty_recompute: re-issued from 20261006000308_loyalty_earn_redeem.sql:433
create or replace function app.loyalty_recompute(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $loyalty_recompute_0376$
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

  -- 0376: lifetime and the 12-month tier points are earn + clawback + adjust
  -- again: points given by hand move the tier (0308 had made them move the
  -- balance only).
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
end $loyalty_recompute_0376$;

comment on function app.loyalty_recompute(uuid) is
  'Loyalty (M3; 0308, 0376). Internal: rebuilds one profile''s loyalty_accounts row from the ledger (balance = sum(delta); lifetime_earned and points_12m = earn + clawback + adjust, all time and the last 12 months: since 0376 points given by hand move the tier again; tier = the highest tier reached by points_12m; last_activity_at = the newest row that is not an expiry). Called after every ledger insert, by the nightly run and by the account merge (through to_regprocedure).';

revoke all on function app.loyalty_recompute(uuid) from public, anon, authenticated;

-- loyalty_nightly_one: re-issued from 20261006000309_loyalty_promotions_nightly.sql:1072
create or replace function app.loyalty_nightly_one(p_profile uuid, p_expire_months int, p_since timestamptz)
returns text
language plpgsql security definer set search_path = public set lock_timeout = '2s' as $loyalty_nightly_one_0376$
declare
  a       loyalty_accounts%rowtype;
  v_sum   bigint;
  v_last  timestamptz;
  v_12m   bigint;
  v_out   text := 'unchanged';
begin
  begin
    select * into a from loyalty_accounts c where c.profile_id = p_profile for update skip locked;
    if not found and exists (select 1 from loyalty_accounts c where c.profile_id = p_profile) then
      return 'locked';
    end if;

    -- Unchanged: the cache equals the ledger, read as app.loyalty_recompute
    -- reads it (0376: the tier points are earn + clawback + adjust of the last
    -- 12 months), in one scan: the balance, the last activity, the 12-month
    -- points and the tier they reach. Never from updated_at, which
    -- app.loyalty_retier also stamps without recounting.
    select coalesce(sum(l.delta), 0),
           max(l.created_at) filter (where l.kind <> 'expire'),
           coalesce(sum(l.delta) filter (where l.kind in ('earn', 'clawback', 'adjust')
                                           and l.created_at > now() - interval '12 months'), 0)
      into v_sum, v_last, v_12m
      from loyalty_ledger l where l.profile_id = p_profile;
    v_12m := greatest(v_12m, 0);
    if a.profile_id is null
       or a.balance <> v_sum
       or a.last_activity_at is distinct from v_last
       or a.points_12m is distinct from v_12m
       or a.tier_id is distinct from (select t.id from loyalty_tiers t where t.min_points_12m <= v_12m
                                       order by t.min_points_12m desc limit 1) then
      perform app.loyalty_recompute(p_profile);
      select * into a from loyalty_accounts c where c.profile_id = p_profile;
      v_out := 'recomputed';
    end if;

    -- c8: inactivity expiry, only while loyalty is on (p_expire_months set),
    -- counted from the later of the last activity and the last switch-on.
    if p_expire_months is not null and a.balance > 0
       and greatest(a.last_activity_at, p_since) < now() - make_interval(months => p_expire_months) then
      insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, note)
      values (p_profile, null, -a.balance, 'expire', 'expiry', gen_random_uuid(),
              format('inactive %s months', p_expire_months));
      v_out := 'expired';
    end if;
    return v_out;
  exception when others then
    raise warning 'loyalty_nightly_one: profile % left for the next run: % (%)', p_profile, sqlerrm, sqlstate;
    return 'error';
  end;
end $loyalty_nightly_one_0376$;

comment on function app.loyalty_nightly_one(uuid, int, timestamptz) is
  'Loyalty (0309, c8, c31; 0376). Internal: one account of the nightly run, in its own exception block with lock_timeout 2s. The account FOR UPDATE SKIP LOCKED (held by a till: locked, tomorrow); recomputed (app.loyalty_recompute) unless its balance equals sum(ledger), its last_activity_at the newest row that is not an expiry, its points_12m the earn + clawback + adjust of the last 12 months (0376) and its tier the one those reach (unchanged; never judged by updated_at, which app.loyalty_retier also stamps); then, when p_expire_months is set (loyalty on), an (expire, expiry) row for the whole balance if greatest(last_activity_at, p_since) is older than that. Returns locked | unchanged | recomputed | expired | error (a warning).';

revoke all on function app.loyalty_nightly_one(uuid, int, timestamptz) from public, anon, authenticated;

comment on function app.loyalty_adjust(uuid, int, text) is
  'Loyalty (M3, contracts §1.3; 0308, 0376). Manager or owner, behind a manager PIN grant (app.consume_pin_grant, PIN_GRANT_REQUIRED; 0115 pattern): adds p_delta points (non-zero, at most a million either way; INVALID_ARGUMENT) to a live profile (MEMBER_NOT_FOUND) with a reason (REASON_REQUIRED), as (adjust, adjust, fresh id) with the reason as the note. 0308 (c17): FORBIDDEN detail self_dealing for the caller''s own profile or a PIN of the member themself, staff_member for a positive delta to active staff, owner_required when a manager''s gift takes the points they gave (any profile) or the profile received (from anyone) in the last 24 hours above 1,000 (hint the two sums); every gift by a manager queues a loyalty_gift staff push to the owners (app.notify_staff, the manager''s name only). Since 0376 the points count toward lifetime and the 12-month tier points as well as the balance. Returns {balance}. Audited loyalty.adjust with the authorizer.';

-- Every live account's cache rebuilt once under the rule (the nightly would
-- catch up, but a gifted account should move up now). The tables are small.
do $loyalty_recompute_all_0376$
declare v_p uuid;
begin
  for v_p in
    select c.profile_id from loyalty_accounts c
      join profiles p on p.id = c.profile_id and p.deleted_at is null
     order by c.profile_id
  loop
    perform app.loyalty_recompute(v_p);
  end loop;
end $loyalty_recompute_all_0376$;
