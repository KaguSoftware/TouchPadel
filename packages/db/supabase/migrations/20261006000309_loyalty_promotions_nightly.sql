set lock_timeout = '3s';
set statement_timeout = '60s';

-- loyalty_promotions_nightly: the review of 0305/0306 (plan
-- go-over-the-backend-partitioned-metcalfe.md, file 0309).
--
--   c6/c16 A tier promotion names its tier by id: limits.tierMin is a
--          loyalty_tiers.id (string). app.price_promo_promotion and
--          app.upsert_promotion_internal (latest 0177) accept it (an existing
--          tier, else RECORD_INVALID / INVALID_VALUE detail limits.tierMin).
--          Eligibility is app.promotion_tier_ok: loyalty on, a customer, and
--          the customer's tier min_points_12m at least the named tier's. A
--          legacy integer tierMin (a tier's sort, 0306) is converted to the
--          id below; one left over reads as that sort's tier, and no tier
--          means nobody. loyalty_tiers.promotion_id was never read: it is
--          cleared, no longer written, and left for a later drop (a DROP
--          COLUMN needs a person's MIGRATION-RISK-ACCEPTED). The tiers' sort
--          follows min_points_12m: app.upsert_loyalty_tier renumbers after
--          every write (app.loyalty_tiers_renumber). app.delete_loyalty_tier
--          refuses TIER_IN_USE while a promotion names the tier (the write
--          holds the tier FOR KEY SHARE).
--   c7     app.apply_best_promotion drops the tab's promotion when it is no
--          longer eligible (audited promotion.drop_ineligible). A drop is
--          kept: the call returns {dropped: true, refused: <code>} rather
--          than raising NO_ELIGIBLE_PROMOTION / CODE_NOT_ELIGIBLE, which
--          would roll it back. The same-promotion path moves the redemption
--          to the tab's current customer. (set_tab_customer's re-check is
--          0308's, and must test tierMin through app.promotion_tier_ok:
--          after this file tierMin is a tier id, not a sort.
--          0308's inline sort comparison would raise 22P02.)
--   c14    A promotion takes at most what the goods subtotal leaves after the
--          tab's other discounts (app.promotion_room_iqd: line discounts on
--          live lines and tab discounts that are not a promotion, loyalty
--          redemptions included); eligible_promotions shows that figure and
--          drops a candidate left below 1.
--   c15    apply_best_promotion locks the candidates (FOR UPDATE in id order, after
--          the tab) and re-reads eligibility before the insert, so a
--          single-use code or a total/perCustomer limit is not spent twice by
--          two tills at once. promotions is ranked after tabs.
--   c8     The nightly expiry runs only while loyalty is on, and measures
--          inactivity from greatest(last_activity_at, loyalty_settings.
--          enabled_at); set_loyalty_settings stamps enabled_at when enabled
--          turns on.
--   c31    The nightly is app.loyalty_nightly_one per account (its own
--          exception block, the account FOR UPDATE SKIP LOCKED, an account
--          whose cache already matches skipped, lock_timeout 2s) driven by
--          procedure app.loyalty_nightly_run, which COMMITs every p_batch
--          accounts and stops at a time budget (PostgreSQL refuses COMMIT in
--          a procedure with a SET clause, and a SET sent with the CALL makes
--          one implicit transaction, so the budget stands in for the
--          statement timeout). Cron tp_loyalty_nightly CALLs it.
--          app.loyalty_nightly() stays, for the service role and the tests,
--          as one transaction over the same per-account body.
--
-- Re-issued from their latest bodies: price_promo_promotion and
-- upsert_promotion_internal (0177), eligible_promotions, apply_best_promotion
-- and loyalty_nightly (0306), set_loyalty_settings, upsert_loyalty_tier and
-- delete_loyalty_tier (0305).

-- ===========================================================================
-- 1. Schema
-- ===========================================================================

alter table loyalty_settings add column if not exists enabled_at timestamptz;
comment on column loyalty_settings.enabled_at is
  'Loyalty (0309, c8). When enabled last turned on (app.set_loyalty_settings). The nightly inactivity expiry measures from greatest(last_activity_at, enabled_at): a pause never counts as inactivity.';

-- c6: the link nothing read.
update loyalty_tiers set promotion_id = null where promotion_id is not null;
comment on column loyalty_tiers.promotion_id is
  'Deprecated (0309, c6): never read; a tier promotion names its tier in promotions.limits.tierMin. Always null; to be dropped.';

-- c6/c16: a legacy tierMin (0306: a tier's sort) becomes that tier's id.
update promotions p
   set limits = jsonb_set(p.limits, '{tierMin}', to_jsonb(t.id::text)), updated_at = now()
  from loyalty_tiers t
 where jsonb_typeof(p.limits->'tierMin') = 'number'
   and t.sort = (p.limits->>'tierMin')::numeric;

-- ===========================================================================
-- 2. Helpers
-- ===========================================================================

-- c6/c16: may this customer have a promotion with these limits, by tier?
create or replace function app.promotion_tier_ok(p_limits jsonb, p_customer uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $promotion_tier_ok_0309$
declare
  v_need bigint;
  v_has  bigint;
begin
  if p_limits is null or not (p_limits ? 'tierMin') or jsonb_typeof(p_limits->'tierMin') = 'null' then
    return true;
  end if;
  if p_customer is null or not coalesce((select s.enabled from loyalty_settings s where s.id), false) then
    return false;
  end if;
  if jsonb_typeof(p_limits->'tierMin') = 'string'
     and (p_limits->>'tierMin') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select t.min_points_12m into v_need from loyalty_tiers t where t.id = (p_limits->>'tierMin')::uuid;
  elsif jsonb_typeof(p_limits->'tierMin') = 'number' then
    -- Legacy (0306): a tier's sort.
    select t.min_points_12m into v_need from loyalty_tiers t where t.sort = (p_limits->>'tierMin')::numeric;
  end if;
  if v_need is null then
    return false;   -- an unknown or deleted tier: nobody
  end if;
  v_has := coalesce((select t.min_points_12m from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id
                      where a.profile_id = p_customer), 0);
  return v_has >= v_need;
end $promotion_tier_ok_0309$;

comment on function app.promotion_tier_ok(jsonb, uuid) is
  'Loyalty (0309, c6/c16). Internal: true when p_limits has no tierMin; else loyalty is on, there is a customer, and the min_points_12m of the customer''s tier (no account: 0) is at least that of the tier tierMin names (a loyalty_tiers id; legacy: a number, the tier with that sort). An unknown tier is false.';

revoke all on function app.promotion_tier_ok(jsonb, uuid) from public, anon, authenticated;

-- c14: what a promotion may still take off this tab: the goods subtotal less
-- the discounts that are not a promotion (line discounts on live lines, and
-- tab discounts, loyalty redemptions among them).
create or replace function app.promotion_room_iqd(p_tab_id uuid)
returns bigint
language sql stable security definer set search_path = public as $promotion_room_iqd_0309$
  select greatest(
           coalesce((select sum(oi.line_total_iqd)
                       from order_items oi join orders o on o.id = oi.order_id
                      where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided), 0)
         - coalesce((select sum(a.amount_iqd)
                       from tab_adjustments a
                       join order_items oi on oi.id = a.order_item_id
                       join orders o on o.id = oi.order_id
                      where a.tab_id = p_tab_id and a.kind in ('discount_percent', 'discount_amount')
                        and o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided), 0)
         - coalesce((select sum(a.amount_iqd)
                       from tab_adjustments a
                      where a.tab_id = p_tab_id and a.kind in ('discount_percent', 'discount_amount')
                        and a.order_item_id is null and a.promotion_id is null), 0),
         0)::bigint
$promotion_room_iqd_0309$;

comment on function app.promotion_room_iqd(uuid) is
  'Loyalty (0309, c14). Internal: greatest(goods subtotal - line discounts on live lines - tab discounts that are not a promotion, 0): the most a promotion may take off the tab, so a promotion applied after a loyalty redemption never takes more than the bill has left.';

revoke all on function app.promotion_room_iqd(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. The promotion validators (c6)
-- ===========================================================================

-- price_promo_promotion: re-issued from 20260925000177_price_promo.sql:472
create or replace function app.price_promo_promotion(p_value jsonb, p_own uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $price_promo_promotion_0309$
declare
  v_type     text;
  v_starts   timestamptz;
  v_ends     timestamptz;
  v_el       jsonb;
  v_weekdays int[] := '{}';
  v_from     time;
  v_to       time;
  v_key      text;
  v_ids      uuid[];
  v_found    int;
  v_scope    jsonb := '{}'::jsonb;
  v_limits   jsonb := '{}'::jsonb;
  v_n        bigint;
  v_code     text;
  v_out      jsonb;
  v_tier     uuid;    -- 0309 (c6): limits.tierMin, a loyalty tier id
begin
  perform app.price_promo_only_keys(p_value,
    array['name_en', 'name_ar', 'type', 'value', 'starts_at', 'ends_at', 'weekdays', 'hour_from',
          'hour_to', 'scope', 'limits', 'auto', 'public_code', 'code_single_use'], null, 'promotion.');

  v_type := app.price_promo_text(p_value->'type', 10, true, 'promotion.type');
  if v_type not in ('percent', 'amount') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.type';
  end if;

  v_starts := app.price_promo_instant(p_value->'starts_at', false, 'promotion.starts_at');
  v_ends := app.price_promo_instant(p_value->'ends_at', false, 'promotion.ends_at');
  if v_starts is not null and v_ends is not null and v_starts >= v_ends then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.ends_at';
  end if;

  -- 0 = Sunday .. 6 = Saturday, each once; empty = every day.
  if jsonb_typeof(p_value->'weekdays') is distinct from 'array' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.weekdays';
  end if;
  for v_el in select e from jsonb_array_elements(p_value->'weekdays') e loop
    v_weekdays := v_weekdays || app.price_promo_int(v_el, 0, 6, true, 'promotion.weekdays')::int;
  end loop;
  if cardinality(v_weekdays) <> (select count(distinct d) from unnest(v_weekdays) d) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.weekdays';
  end if;

  -- Both hours or neither; equal hours are an empty window (from > to
  -- crosses midnight).
  v_from := app.price_promo_time(p_value->'hour_from', false, 'promotion.hour_from');
  v_to := app.price_promo_time(p_value->'hour_to', false, 'promotion.hour_to');
  if (v_from is null) <> (v_to is null) or (v_from is not null and v_from = v_to) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.hour_to';
  end if;

  -- The scope, stored as 0067 stores it: known keys, existing ids, empty
  -- arrays dropped.
  if jsonb_typeof(p_value->'scope') is distinct from 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope';
  end if;
  perform app.price_promo_only_keys(p_value->'scope', array['courtIds', 'categoryIds', 'itemIds'], 'promotion.scope');
  for v_key in select k from jsonb_object_keys(p_value->'scope') k order by k loop
    continue when jsonb_typeof(p_value->'scope'->v_key) = 'null';
    if jsonb_typeof(p_value->'scope'->v_key) <> 'array' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope.' || v_key;
    end if;
    v_ids := '{}';
    for v_el in select e from jsonb_array_elements(p_value->'scope'->v_key) e loop
      v_ids := v_ids || app.price_promo_uuid(v_el, true, 'promotion.scope.' || v_key);
    end loop;
    if cardinality(v_ids) <> (select count(distinct i) from unnest(v_ids) i) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope.' || v_key;
    end if;
    continue when cardinality(v_ids) = 0;
    if v_key = 'courtIds' then
      select count(*) into v_found from courts where id = any(v_ids);
    elsif v_key = 'categoryIds' then
      select count(*) into v_found from menu_categories where id = any(v_ids);
    else
      select count(*) into v_found from menu_items where id = any(v_ids);
    end if;
    if v_found <> cardinality(v_ids) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.scope.' || v_key;
    end if;
    v_scope := v_scope || jsonb_build_object(v_key, to_jsonb(v_ids));
  end loop;

  -- The limits: total and perCustomer at least 1, minSpendIqd at least 0.
  if p_value->'limits' is not null and p_value->'limits' <> 'null'::jsonb then
    perform app.price_promo_only_keys(p_value->'limits', array['total', 'perCustomer', 'minSpendIqd', 'tierMin'], 'promotion.limits');
    foreach v_key in array array['total', 'perCustomer', 'minSpendIqd'] loop
      v_n := app.price_promo_int(p_value->'limits'->v_key, case when v_key = 'minSpendIqd' then 0 else 1 end,
                                 999999999999999, false, 'promotion.limits.' || v_key);
      if v_n is not null then
        v_limits := v_limits || jsonb_build_object(v_key, v_n);
      end if;
    end loop;
    -- 0309 (c6): tierMin names an existing loyalty tier by id; the customer's
    -- tier must reach its min_points_12m (app.promotion_tier_ok).
    v_tier := app.price_promo_uuid(p_value->'limits'->'tierMin', false, 'promotion.limits.tierMin');
    if v_tier is not null then
      if not exists (select 1 from loyalty_tiers t where t.id = v_tier) then
        raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.limits.tierMin';
      end if;
      v_limits := v_limits || jsonb_build_object('tierMin', v_tier::text);
    end if;
  end if;

  v_out := jsonb_build_object(
    'name_en',         app.price_promo_text(p_value->'name_en', 80, true, 'promotion.name_en'),
    'name_ar',         app.price_promo_text(p_value->'name_ar', 80, true, 'promotion.name_ar'),
    'type',            v_type,
    'value',           app.price_promo_int(p_value->'value', 1,
                                           case when v_type = 'percent' then 99 else 2147483647 end,
                                           true, 'promotion.value'),
    'starts_at',       v_starts,
    'ends_at',         v_ends,
    'weekdays',        to_jsonb(v_weekdays),
    'hour_from',       v_from,
    'hour_to',         v_to,
    'scope',           v_scope,
    'limits',          v_limits,
    'auto',            coalesce(app.price_promo_bool(p_value->'auto', false, 'promotion.auto'), true),
    'code_single_use', coalesce(app.price_promo_bool(p_value->'code_single_use', false, 'promotion.code_single_use'), false));

  if p_value->'public_code' is not null and p_value->'public_code' <> 'null'::jsonb then
    if jsonb_typeof(p_value->'public_code') <> 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.public_code';
    end if;
    v_code := upper(btrim(p_value->>'public_code'));
    if v_code <> '' and (v_code !~ '^[A-Z0-9]{4,16}$'
                         or exists (select 1 from promotions x
                                     where x.public_code = v_code and x.id is distinct from p_own)) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'promotion.public_code';
    end if;
    v_out := v_out || jsonb_build_object('public_code', v_code);
  end if;
  return v_out;
end $price_promo_promotion_0309$;

comment on function app.price_promo_promotion(jsonb, uuid) is
  'price_promo (§2.8), 0309. Internal: checks and normalises a proposed promotion {name_en, name_ar (<= 80), type percent|amount, value (1-99 | 1-2147483647), starts_at?, ends_at?, weekdays (0-6, each once), hour_from?, hour_to?, scope {courtIds?, categoryIds?, itemIds?} (existing ids), limits? {total?, perCustomer?, minSpendIqd?, tierMin? (0309: an existing loyalty tier id)}, auto?, public_code? (4-16 letters or digits, free of every promotion but p_own; '''' clears), code_single_use?}: 0067''s validations, each refusal RECORD_INVALID or TEXT_TOO_LONG with hint promotion.<field>.';

revoke all on function app.price_promo_promotion(jsonb, uuid) from public, anon, authenticated;

-- upsert_promotion_internal: re-issued from 20260925000177_price_promo.sql:1256
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
language plpgsql security definer set search_path = public as $upsert_promotion_internal_0309$
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
  if p_type is null or p_type not in ('percent','amount') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'type',
      hint = 'type is percent or amount';
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
      hint = 'scope is an object {courtIds, categoryIds, itemIds}';
  end if;
  for v_key in select jsonb_object_keys(p_scope) loop
    if v_key not in ('courtIds','categoryIds','itemIds') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'scope.' || v_key,
        hint = 'scope keys are courtIds, categoryIds, itemIds';
    end if;
    if jsonb_typeof(p_scope->v_key) = 'null' then
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
    elsif v_key = 'categoryIds' then
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
end $upsert_promotion_internal_0309$;

comment on function app.upsert_promotion_internal(uuid, text, text, text, int, timestamptz, timestamptz, int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) is
  'price_promo (§2.13), 0309 (limits.tierMin: an existing loyalty tier id, else INVALID_VALUE detail limits.tierMin). Internal: the 0067 app.upsert_promotion body without its guard: creates (created_by = the caller) or replaces a promotion, validated by name (NAME_REQUIRED, INVALID_VALUE, INVALID_RANGE, INVALID_WEEKDAYS, CODE_TAKEN, PROMOTION_NOT_FOUND); p_public_code null keeps a code and '''' clears it. Audit promotion.upsert. Called by the public app.upsert_promotion, by a promotion change''s proposal (its disabled draft) and by the apply.';

revoke all on function app.upsert_promotion_internal(uuid, text, text, text, int, timestamptz, timestamptz, int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) from public, anon, authenticated;

-- ===========================================================================
-- 4. Eligibility and the apply (c6, c7, c14, c15)
-- ===========================================================================

-- eligible_promotions: re-issued from 20261005000306_loyalty_promotions.sql:43
create or replace function app.eligible_promotions(p_tab_id uuid, p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $eligible_promotions_0309$
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
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
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
       and (pr.auto or (v_code is not null and pr.public_code = v_code))
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
      'amountIqd',   v_amount);
  end loop;

  select coalesce(jsonb_agg(t.e order by (t.e->>'amountIqd')::bigint desc, t.ord), '[]'::jsonb)
    into v_sorted
    from jsonb_array_elements(v_out) with ordinality as t(e, ord);
  return v_sorted;
end $eligible_promotions_0309$;

revoke all on function app.eligible_promotions(uuid, text) from public, anon;
grant execute on function app.eligible_promotions(uuid, text) to authenticated;

comment on function app.eligible_promotions(uuid, text) is
  '0067, 0212 (MV2), loyalty 0306, 0309. Cashier, manager, owner: the promotions a tab is eligible for now, best first ({promotionId, name_en, name_ar, type, value, amountIqd}). The customer (perCustomer, tierMin) is app.tab_customer. limits.tierMin (a loyalty tier id, 0309) needs loyalty on, a customer, and the customer''s tier at least that tier by min_points_12m (app.promotion_tier_ok). amountIqd is capped at app.promotion_room_iqd (0309, c14: the goods less the other discounts), and a candidate below 1 is left out. CODE_INVALID for an unknown code.';

-- apply_best_promotion: re-issued from 20261005000306_loyalty_promotions.sql:189
create or replace function app.apply_best_promotion(
  p_tab_id          uuid,
  p_code            text default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_best_promotion_0309$
declare
  v_venue uuid;
  v_tab       tabs%rowtype;
  v_replay    jsonb;
  v_elig      jsonb;
  v_best      jsonb;
  v_promo     promotions%rowtype;
  v_code      text := nullif(upper(btrim(p_code)), '');
  v_code_id   uuid;
  v_customer  uuid;
  v_amount    bigint;
  v_old_red   promotion_redemptions%rowtype;
  v_old_adj   tab_adjustments%rowtype;
  v_adj       tab_adjustments%rowtype;
  v_red       promotion_redemptions%rowtype;
  v_replaced  uuid;
  v_paid      bigint;
  v_new_total bigint;
  v_result    jsonb;
  v_old_code  text;     -- 0309 (c7)
  v_dropped   uuid;     -- 0309 (c7)
  v_refusal   text;     -- 0309 (c7)
  v_locked    uuid[] := '{}';  -- 0309 (c15)
  v_new       uuid[];          -- 0309 (c15)
  v_try       int;             -- 0309 (c15)
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'apply_best_promotion');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  -- 0309 (c7): the tab's promotion was chosen for the tab as it was (its
  -- customer, tier, lines). One that no longer qualifies goes now, whatever
  -- this call then finds; the drop is kept even when nothing replaces it.
  select * into v_old_red from promotion_redemptions where tab_id = p_tab_id;
  if found then
    v_old_code := case when exists (select 1 from promotions x where x.public_code = v_old_red.code_used)
                       then v_old_red.code_used end;
    if not exists (select 1 from jsonb_array_elements(app.eligible_promotions(p_tab_id, v_old_code)) e
                    where (e->>'promotionId')::uuid = v_old_red.promotion_id) then
      select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
      delete from promotion_redemptions where id = v_old_red.id;
      delete from tab_adjustments where tab_id = p_tab_id and promotion_id is not null;
      perform app.write_audit('promotion.drop_ineligible', 'tab_adjustments', v_old_red.adjustment_id::text,
                              to_jsonb(v_old_adj) || jsonb_build_object('redemption', to_jsonb(v_old_red)),
                              null, 'promotion', null, p_device_id);
      v_dropped := v_old_red.promotion_id;
    end if;
  end if;

  -- 0309 (c15): lock the candidates (promotions after tabs), then read
  -- eligibility again: a concurrent apply of the same single-use code or the
  -- last use of a limit has committed by the time the lock is granted, and
  -- this fresh read counts it. Every candidate of the first read is locked in
  -- one statement, in id order, so two applies never take the same rows in
  -- opposite orders; a later read locks more only when the candidates changed
  -- under it (a promotion edited or created meanwhile). The pick is the best
  -- of a read taken after its lock; the fifth read settles for the best of
  -- those it holds.
  for v_try in 1 .. 5 loop
    v_elig := app.eligible_promotions(p_tab_id, p_code);   -- raises CODE_INVALID

    -- A known code that is not eligible right now (expired, used up, wrong day,
    -- below minimum spend) is named rather than silently replaced by whatever
    -- auto promotion happens to be best: the cashier is holding a guest's code.
    if v_code is not null then
      select x.id into v_code_id from promotions x where x.public_code = v_code;
      if not exists (select 1 from jsonb_array_elements(v_elig) e
                      where (e->>'promotionId')::uuid = v_code_id) then
        v_refusal := 'CODE_NOT_ELIGIBLE';
        exit;
      end if;
    end if;

    if jsonb_array_length(v_elig) = 0 then
      v_refusal := 'NO_ELIGIBLE_PROMOTION';
      exit;
    end if;

    v_new := array(select distinct (e->>'promotionId')::uuid
                     from jsonb_array_elements(v_elig) e
                    where not ((e->>'promotionId')::uuid = any(v_locked))
                    order by 1);
    if cardinality(v_new) = 0 or v_try = 5 then
      select x.e into v_best
        from jsonb_array_elements(v_elig) with ordinality x(e, n)
       where (x.e->>'promotionId')::uuid = any(v_locked)
       order by x.n
       limit 1;
      if v_best is null then
        v_refusal := 'NO_ELIGIBLE_PROMOTION';
      end if;
      exit;
    end if;
    perform 1 from promotions where id = any(v_new) order by id for update;
    v_locked := v_locked || v_new;
  end loop;

  if v_refusal is not null then
    if v_dropped is null then
      if v_refusal = 'CODE_NOT_ELIGIBLE' then
        raise exception 'CODE_NOT_ELIGIBLE' using errcode = 'P0001', detail = v_code;
      end if;
      raise exception 'NO_ELIGIBLE_PROMOTION' using errcode = 'P0001';
    end if;
    -- 0309 (c7): raising would undo the drop; the refusal travels in the result.
    v_result := jsonb_build_object('promotionId', null, 'amountIqd', 0, 'adjustmentId', null,
      'replacedPromotionId', v_dropped, 'unchanged', false, 'dropped', true, 'refused', v_refusal);
    perform app.finish_replay(p_idempotency_key, v_result);
    return v_result;
  end if;

  v_amount := (v_best->>'amountIqd')::bigint;
  select * into v_promo from promotions where id = (v_best->>'promotionId')::uuid;

  -- 0306 (loyalty): the redemption's customer is the tab's (app.tab_customer),
  -- the same one eligible_promotions counted perCustomer and tierMin against.
  v_customer := app.tab_customer(p_tab_id);

  -- Replace the earlier promotion on this tab (one per tab). Same promotion,
  -- same amount: nothing has changed, so nothing is rewritten.
  select * into v_old_red from promotion_redemptions where tab_id = p_tab_id;
  if found then
    select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
    if v_old_red.promotion_id = v_promo.id and v_old_adj.amount_iqd = v_amount then
      -- 0309 (c7): the redemption follows the tab's customer.
      update promotion_redemptions set customer_id = v_customer
       where id = v_old_red.id and customer_id is distinct from v_customer;
      v_result := jsonb_build_object('promotionId', v_promo.id, 'amountIqd', v_amount,
        'adjustmentId', v_old_adj.id, 'replacedPromotionId', null, 'unchanged', true);
      perform app.finish_replay(p_idempotency_key, v_result);
      return v_result;
    end if;
    v_replaced := v_old_red.promotion_id;
    delete from promotion_redemptions where id = v_old_red.id;
    -- By promotion_id, not by adjustment id alone: any stray promotion row on
    -- this tab goes with it, so the partial unique index cannot refuse the insert.
    delete from tab_adjustments where tab_id = p_tab_id and promotion_id is not null;
    perform app.write_audit('promotion.replace', 'tab_adjustments', v_old_adj.id::text,
                            to_jsonb(v_old_adj) || jsonb_build_object('redemption', to_jsonb(v_old_red)),
                            null, 'promotion', v_promo.created_by, p_device_id);
  end if;

  -- authorized_by = the manager who configured the promotion (created_by):
  -- the configuration is the authorisation, and day close names that person.
  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code, promotion_id)
  values (p_tab_id, null,
          case when v_promo.type = 'percent' then 'discount_percent'::adjustment_kind
               else 'discount_amount'::adjustment_kind end,
          case when v_promo.type = 'percent' then v_promo.value * 100   -- basis points, as apply_discount stores
               else v_promo.value end,
          v_amount, auth.uid(), v_promo.created_by, 'promotion', v_promo.id)
  returning * into v_adj;

  insert into promotion_redemptions (promotion_id, tab_id, adjustment_id, customer_id,
                                     amount_iqd, code_used, idempotency_key, redeemed_by)
  values (v_promo.id, p_tab_id, v_adj.id, v_customer, v_amount,
          case when v_promo.auto then null else v_code end, p_idempotency_key, auth.uid())
  returning * into v_red;

  -- DISCOUNT-AFTER-PAYMENT GUARD (0037), verbatim shape. An 'open' tab has
  -- normally taken nothing, but the guard is cheap and the invariant matters.
  v_paid := app.tab_net_paid(p_tab_id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(p_tab_id) t;
    if v_new_total < v_paid then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-promotion total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before applying a promotion';
    end if;
  end if;

  perform app.write_audit('promotion.apply', 'tab_adjustments', v_adj.id::text,
                          null, to_jsonb(v_adj) || jsonb_build_object('redemption', to_jsonb(v_red)),
                          'promotion', v_promo.created_by, p_device_id);

  v_result := jsonb_build_object('promotionId', v_promo.id, 'amountIqd', v_amount,
    'adjustmentId', v_adj.id, 'replacedPromotionId', coalesce(v_replaced, v_dropped), 'unchanged', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $apply_best_promotion_0309$;

revoke all on function app.apply_best_promotion(uuid, text, text, text) from public, anon;
grant execute on function app.apply_best_promotion(uuid, text, text, text) to authenticated;

comment on function app.apply_best_promotion(uuid, text, text, text) is
  '0067, 0217, loyalty 0306, 0309. Cashier, manager, owner at the tab''s branch: applies the best eligible promotion (app.eligible_promotions) to an open tab, replacing the tab''s earlier one; the redemption''s customer is app.tab_customer. 0309: the tab''s promotion is first re-checked and dropped when no longer eligible (c7, audited promotion.drop_ineligible); when nothing replaces a dropped one the call returns {promotionId: null, amountIqd: 0, replacedPromotionId, dropped: true, refused: NO_ELIGIBLE_PROMOTION | CODE_NOT_ELIGIBLE} instead of raising, so the drop stands. The candidates are locked FOR UPDATE after the tab, in id order, and eligibility read again before the insert (c15). The same promotion kept moves its redemption to the tab''s customer.';

-- ===========================================================================
-- 5. Settings (c8)
-- ===========================================================================

-- set_loyalty_settings: re-issued from 20261005000305_loyalty.sql:1334
create or replace function app.set_loyalty_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_loyalty_settings_0309$
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
                     'totp_step_seconds') then
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
end $set_loyalty_settings_0309$;

comment on function app.set_loyalty_settings(jsonb) is
  'Loyalty (M3, contracts §1.3; 0309). Owner: patches the business-wide settings with the keys given (enabled, iqd_per_point, point_value_iqd, min_redeem_points, earn_cafe, earn_shop, earn_court, earn_lesson, earn_tournament, inactivity_expiry_months, totp_step_seconds); an unknown key is INVALID_ARGUMENT (detail = the key), a value the table refuses INVALID_VALUE. Returns the settings. Audited loyalty.settings. 0309 (c8): enabled_at = now() when enabled turns on (the nightly inactivity expiry counts from it).';

revoke all on function app.set_loyalty_settings(jsonb) from public, anon;
grant execute on function app.set_loyalty_settings(jsonb) to authenticated;

-- ===========================================================================
-- 6. Tiers (c6, c16)
-- ===========================================================================

-- The tiers' sort follows min_points_12m (internal). The base tier (0 points)
-- stays sort 0. Two passes through 1000+ keep loyalty_tiers_sort_key unique
-- at every row; nothing is written when the order already agrees.
create or replace function app.loyalty_tiers_renumber() returns void
language plpgsql security definer set search_path = public as $loyalty_tiers_renumber_0309$
begin
  if not exists (select 1 from loyalty_tiers a join loyalty_tiers b
                  on a.sort < b.sort and a.min_points_12m > b.min_points_12m) then
    return;
  end if;
  update loyalty_tiers t
     set sort = (1000 + x.rn)::smallint
    from (select t2.id, row_number() over (order by t2.min_points_12m) - 1 as rn from loyalty_tiers t2) x
   where x.id = t.id and x.rn > 0;
  update loyalty_tiers set sort = (sort - 1000)::smallint where sort >= 1000;
end $loyalty_tiers_renumber_0309$;

comment on function app.loyalty_tiers_renumber() is
  'Loyalty (0309, c16). Internal: renumbers loyalty_tiers.sort to follow min_points_12m (base 0, then 1, 2, ...) when the two orders disagree; a no-op otherwise.';

revoke all on function app.loyalty_tiers_renumber() from public, anon, authenticated;

-- Tiers already out of order (0305 let sort and threshold move apart).
select app.loyalty_tiers_renumber();

-- upsert_loyalty_tier: re-issued from 20261005000305_loyalty.sql:1405
create or replace function app.upsert_loyalty_tier(p_tier jsonb) returns jsonb
language plpgsql security definer set search_path = public as $upsert_loyalty_tier_0309$
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
             sort            = coalesce((p_tier->>'sort')::smallint, sort)
       where id = v_id
      returning * into v_row;
    else
      insert into loyalty_tiers (name_en, name_ar, min_points_12m, earn_multiplier, sort)
      values (app.safe_line(p_tier->>'name_en'), app.safe_line(p_tier->>'name_ar'),
              (p_tier->>'min_points_12m')::int, coalesce((p_tier->>'earn_multiplier')::numeric, 1),
              (p_tier->>'sort')::smallint)
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
                            'promotion_id', null, 'sort', v_row.sort);
end $upsert_loyalty_tier_0309$;

comment on function app.upsert_loyalty_tier(jsonb) is
  'Loyalty (M3, contracts §1.3; 0309). Owner: creates a tier (no id) or updates one (id; absent keys kept) from {name_en, name_ar, min_points_12m, earn_multiplier (1-5), sort}. The sort-0 tier is the base (from 0 points) and keeps sort 0. 0309: promotion_id is ignored (always null; a tier promotion names the tier in limits.tierMin), and the sorts are renumbered to follow min_points_12m (c16), so the sort returned may differ from the one sent. INVALID_ARGUMENT (unknown id, the base''s sort), INVALID_VALUE (what the table refuses: a duplicate threshold or sort, a missing name). Every account''s tier follows at once. Returns the tier (LoyaltyAdminTier). Audited loyalty.tier.';

revoke all on function app.upsert_loyalty_tier(jsonb) from public, anon;
grant execute on function app.upsert_loyalty_tier(jsonb) to authenticated;

-- delete_loyalty_tier: re-issued from 20261005000305_loyalty.sql:1466
create or replace function app.delete_loyalty_tier(p_tier_id uuid) returns void
language plpgsql security definer set search_path = public as $delete_loyalty_tier_0309$
declare
  v_old  loyalty_tiers%rowtype;
  v_uses int;   -- 0309 (c6)
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_old from loyalty_tiers where id = p_tier_id for update;
  if not found or v_old.sort = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_tier_id';
  end if;
  -- 0309 (c6): a promotion that names this tier (limits.tierMin, enabled or
  -- not) would be left for nobody, and its next edit refused. The tier row is
  -- held FOR UPDATE above, so a promotion write naming it (FOR KEY SHARE in
  -- app.upsert_promotion_internal) has committed or waits.
  select count(*) into v_uses
    from promotions p
   where (jsonb_typeof(p.limits->'tierMin') = 'string' and p.limits->>'tierMin' = v_old.id::text)
      or (jsonb_typeof(p.limits->'tierMin') = 'number' and (p.limits->>'tierMin')::numeric = v_old.sort);
  if v_uses > 0 then
    raise exception 'TIER_IN_USE' using errcode = 'P0001', detail = v_uses::text,
      hint = 'promotions name this tier in limits.tierMin; change them first';
  end if;
  delete from loyalty_tiers where id = p_tier_id;
  perform app.loyalty_retier();
  perform app.write_audit('loyalty.tier_delete', 'loyalty_tiers', p_tier_id::text, to_jsonb(v_old), null, null);
end $delete_loyalty_tier_0309$;

comment on function app.delete_loyalty_tier(uuid) is
  'Loyalty (M3, contracts §1.3; 0309). Owner: deletes a tier; the base tier (sort 0) or an unknown id is INVALID_ARGUMENT. 0309: TIER_IN_USE (detail: how many) while a promotion, enabled or not, names it in limits.tierMin. Its accounts fall to the tier their points now reach. Audited loyalty.tier_delete.';

revoke all on function app.delete_loyalty_tier(uuid) from public, anon;
grant execute on function app.delete_loyalty_tier(uuid) to authenticated;

-- ===========================================================================
-- 7. The nightly run (c8, c31)
-- ===========================================================================

-- One account of the nightly run (internal). p_expire_months is the
-- inactivity limit while loyalty is on (null: no expiry), p_since
-- loyalty_settings.enabled_at. Returns what happened: locked (a till holds
-- the account: tomorrow), unchanged, recomputed, expired, or error (logged as
-- a warning; this account is left for the next run, the others go on).
create or replace function app.loyalty_nightly_one(p_profile uuid, p_expire_months int, p_since timestamptz)
returns text
language plpgsql security definer set search_path = public set lock_timeout = '2s' as $loyalty_nightly_one_0309$
declare
  a       loyalty_accounts%rowtype;
  v_sum   bigint;
  v_last  timestamptz;
  v_12m   bigint;
  v_adj   bigint;
  v_out   text := 'unchanged';
begin
  begin
    select * into a from loyalty_accounts c where c.profile_id = p_profile for update skip locked;
    if not found and exists (select 1 from loyalty_accounts c where c.profile_id = p_profile) then
      return 'locked';
    end if;

    -- Unchanged: the cache equals the ledger, read as app.loyalty_recompute
    -- reads it (0308: the tier points are earn + clawback of the last 12
    -- months), in one scan: the balance, the last activity, the 12-month
    -- points and the tier they reach. Never from updated_at, which
    -- app.loyalty_retier also stamps without recounting. An account with an
    -- adjustment in the window is always rebuilt: whether an adjustment counts
    -- toward the tier is the recompute's rule (0305 counted it, 0308 does not).
    select coalesce(sum(l.delta), 0),
           max(l.created_at) filter (where l.kind <> 'expire'),
           coalesce(sum(l.delta) filter (where l.kind in ('earn', 'clawback')
                                           and l.created_at > now() - interval '12 months'), 0),
           count(*) filter (where l.kind = 'adjust' and l.created_at > now() - interval '12 months')
      into v_sum, v_last, v_12m, v_adj
      from loyalty_ledger l where l.profile_id = p_profile;
    v_12m := greatest(v_12m, 0);
    if a.profile_id is null
       or a.balance <> v_sum
       or a.last_activity_at is distinct from v_last
       or a.points_12m is distinct from v_12m
       or v_adj > 0
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
end $loyalty_nightly_one_0309$;

comment on function app.loyalty_nightly_one(uuid, int, timestamptz) is
  'Loyalty (0309, c8, c31). Internal: one account of the nightly run, in its own exception block with lock_timeout 2s. The account FOR UPDATE SKIP LOCKED (held by a till: locked, tomorrow); recomputed (app.loyalty_recompute) unless its balance equals sum(ledger), its last_activity_at the newest row that is not an expiry, its points_12m the earn + clawback of the last 12 months and its tier the one those reach, with no adjustment in that window (unchanged; never judged by updated_at, which app.loyalty_retier also stamps); then, when p_expire_months is set (loyalty on), an (expire, expiry) row for the whole balance if greatest(last_activity_at, p_since) is older than that. Returns locked | unchanged | recomputed | expired | error (a warning).';

revoke all on function app.loyalty_nightly_one(uuid, int, timestamptz) from public, anon, authenticated;

-- loyalty_nightly: re-issued from 20261005000306_loyalty_promotions.sql:668,
-- now one transaction over app.loyalty_nightly_one (the service role, tests).
create or replace function app.loyalty_nightly() returns jsonb
language plpgsql security definer set search_path = public as $loyalty_nightly_0309$
declare
  v_s      loyalty_settings%rowtype;
  v_p      uuid;
  v_r      text;
  v_counts jsonb := '{"recomputed":0,"expired":0,"unchanged":0,"locked":0,"error":0}'::jsonb;
begin
  -- A deleted account has no cache (delete_my_account, the merge's drop): one
  -- left behind goes, and none is rebuilt from the ledger rows the tombstone
  -- keeps.
  delete from loyalty_accounts c
   using profiles p
   where p.id = c.profile_id and p.deleted_at is not null;

  select * into v_s from loyalty_settings where id;
  for v_p in
    select x.profile_id
      from (select l.profile_id from loyalty_ledger l
            union
            select c.profile_id from loyalty_accounts c) x
      join profiles p on p.id = x.profile_id and p.deleted_at is null
     order by x.profile_id
  loop
    v_r := app.loyalty_nightly_one(v_p, case when v_s.enabled then v_s.inactivity_expiry_months end, v_s.enabled_at);
    v_counts := jsonb_set(v_counts, array[v_r], to_jsonb((v_counts->>v_r)::int + 1));
  end loop;

  return v_counts;
end $loyalty_nightly_0309$;

comment on function app.loyalty_nightly() is
  'Loyalty (M3, contracts §1.4; 0309). The nightly run in one transaction, for the service role and the tests (cron calls procedure app.loyalty_nightly_run): the cache of a deleted profile removed, then app.loyalty_nightly_one for every live profile with ledger rows or an account, with the inactivity expiry only while loyalty is on (c8). Returns {recomputed, expired, unchanged, locked, error}. Granted to the service role only.';

revoke all on function app.loyalty_nightly() from public, anon, authenticated;
grant execute on function app.loyalty_nightly() to service_role;

-- c31: the cron run. PostgreSQL refuses COMMIT in a SECURITY DEFINER
-- procedure or one with a SET clause (0287 precedent), so this one is
-- security invoker with every name qualified, granted to no client role; it
-- commits every p_batch accounts, so no account lock outlives its batch and a
-- failing account never undoes the others, and stops when p_budget is spent
-- (the rest wait for tomorrow, in profile order). The loop's cursor is held
-- across the commits.
create or replace procedure app.loyalty_nightly_run(p_batch int default 200, p_budget interval default '20 minutes')
language plpgsql as $loyalty_nightly_run_0309$
declare
  v_start  timestamptz := pg_catalog.clock_timestamp();
  v_months int;
  v_since  timestamptz;
  v_p      uuid;
  v_r      text;
  v_n      int := 0;
  v_counts jsonb := '{"recomputed":0,"expired":0,"unchanged":0,"locked":0,"error":0}'::jsonb;
  v_cut    boolean := false;
begin
  delete from public.loyalty_accounts c
   using public.profiles p
   where p.id = c.profile_id and p.deleted_at is not null;
  commit;

  select case when s.enabled then s.inactivity_expiry_months end, s.enabled_at
    into v_months, v_since
    from public.loyalty_settings s where s.id;

  for v_p in
    select x.profile_id
      from (select l.profile_id from public.loyalty_ledger l
            union
            select c.profile_id from public.loyalty_accounts c) x
      join public.profiles p on p.id = x.profile_id and p.deleted_at is null
     order by x.profile_id
  loop
    if pg_catalog.clock_timestamp() - v_start > p_budget then
      v_cut := true;
      exit;
    end if;
    v_r := app.loyalty_nightly_one(v_p, v_months, v_since);
    v_counts := pg_catalog.jsonb_set(v_counts, array[v_r], pg_catalog.to_jsonb((v_counts->>v_r)::int + 1));
    v_n := v_n + 1;
    if v_n % greatest(coalesce(p_batch, 200), 1) = 0 then
      commit;
    end if;
  end loop;
  commit;

  if v_cut or (v_counts->>'error')::int > 0 then
    raise warning 'loyalty_nightly_run: % (budget % spent: %)', v_counts, p_budget, v_cut;
  else
    raise notice 'loyalty_nightly_run: %', v_counts;
  end if;
end $loyalty_nightly_run_0309$;

comment on procedure app.loyalty_nightly_run(int, interval) is
  'Loyalty (0309, c31). The nightly run (cron tp_loyalty_nightly, ''15 0 * * *'' UTC). Security invoker with no SET clause (PostgreSQL refuses COMMIT otherwise): removes the caches of deleted profiles, then app.loyalty_nightly_one for every live profile with ledger rows or an account, in profile order, with a COMMIT every p_batch accounts; the inactivity expiry only while loyalty is on, from greatest(last activity, enabled_at) (c8). Stops when p_budget is spent (the statement timeout of a run that commits). A warning carries the counts when an account failed or the budget ran out, else a notice. Granted to no client role.';

revoke all on procedure app.loyalty_nightly_run(int, interval) from public, anon, authenticated;

-- tp_loyalty_nightly now CALLs the procedure (cron.schedule upserts by name).
do $loyalty_nightly_cron_0309$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_loyalty_nightly not scheduled';
    return;
  end if;
  perform cron.schedule('tp_loyalty_nightly', '15 0 * * *', 'call app.loyalty_nightly_run();');
end $loyalty_nightly_cron_0309$;

-- Every live account's cache rebuilt once under the current rules (0308
-- changed what counts toward points_12m; the nightly skips an account whose
-- cache matches, so it would not catch up on its own). The tables are small
-- (loyalty ships off).
do $loyalty_recompute_all_0309$
declare v_p uuid;
begin
  for v_p in
    select c.profile_id from loyalty_accounts c
      join profiles p on p.id = c.profile_id and p.deleted_at is null
     order by c.profile_id
  loop
    perform app.loyalty_recompute(v_p);
  end loop;
end $loyalty_recompute_all_0309$;
