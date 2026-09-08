-- 0067_promotions — promotions (spec 06.26 / 06.27) and their application at
-- the till (06.13 "where two promotions could apply, the server applies the
-- single best one").
--
-- Model (build plan §0 + §4, 0067):
--
--   * A promotion is configuration: who may get what, when. Managers/owners
--     write it (upsert / enable / code); it is never deleted (06.26: "enabled
--     and disabled without deleting, keeping history intact").
--   * Applying one to a tab writes ONE ordinary `tab_adjustments` discount row
--     (kind discount_percent | discount_amount, reason_code 'promotion',
--     promotion_id set) plus a `promotion_redemptions` row. Nothing downstream
--     changes: app.compute_tab_totals (0053) sums every discount_* adjustment
--     with order_item_id null, settle_tab stamps those totals, and
--     v_day_close_summary (0020) sums every tab_adjustments row with its
--     authorizer's name. A promotion therefore reaches the bill and the day
--     close exactly the way a manager discount does — checked, not assumed:
--     see promotions.test.ts "reaches the bill" / "day close".
--   * authorized_by on that row is the MANAGER WHO CONFIGURED THE PROMOTION
--     (promotions.created_by), not the cashier applying it: the cashier
--     exercises no discretion, the configuration is the authorisation. The
--     day-close authoriser column then names the right person.
--   * ONE promotion per tab (partial unique index). Re-applying replaces the
--     earlier promotion row. That replacement is the one place in the money
--     path where a tab_adjustments row is DELETED, and it is acceptable here
--     because (a) the row is not a manager discount — no PIN, no reason chosen
--     by a person — it is a deterministic snapshot of configuration, (b) the
--     replacement is audited ('promotion.replace' carries the old row), and
--     (c) the alternative (a superseded flag) would make every limit count and
--     every totals sum carry a filter for a state that has no business
--     meaning. Manager discounts (apply_discount) are untouched by this.
--   * Money arithmetic reuses the sanctioned helper. Percent: the discount is
--     base - app.apply_pct_discount(base, pct) (0030; TS twin
--     applyPctDiscountIqd). Amount: least(value, base). Both integer IQD, both
--     mirrored in @touch/core promotionDiscountIqd (parity test in the suite).
--     NOTE for review: apply_discount (0037/0049) computes its own percent as
--     round(base * bp / 10000) with basis points; on an exact .5 boundary the
--     two disagree by 1 IQD (1,250 at 15 %: 188 vs 187). This file uses the
--     helper with the TS twin so the till preview and the server agree
--     bit-for-bit, which apply_discount's inline expression cannot offer.
--
-- Eligibility (app.eligible_promotions), all evaluated at now() in the venue
-- timezone:
--   enabled; starts_at <= now() < ends_at (null = unbounded); weekday in
--   weekdays (empty = any; 0 = Sunday, same convention as 0066 series);
--   local time in [hour_from, hour_to) (null = any; from > to crosses
--   midnight); scope.courtIds (tab's reservation must sit on one of them);
--   limits.total / limits.perCustomer (count of redemptions on OTHER tabs — the
--   tab's own current redemption is about to be replaced, so it never blocks
--   a re-apply); limits.minSpendIqd against the tab's gross (goods subtotal +
--   court fee); auto = false only with a matching public_code, a single-use
--   code only while it has no redemption elsewhere. Discount base:
--   scope.itemIds / categoryIds restrict it to the matching live lines,
--   otherwise the goods subtotal (the base apply_discount uses). amount >= 1.
--
-- Deliberately NOT in phase 1 (flagged in the lane report):
--   * a promotion never discounts the court fee (compute_tab_totals caps the
--     discount at the goods subtotal; court_iqd is outside it by 0053 design),
--     so a court-scoped promotion is an eligibility filter on goods;
--   * the amount is a snapshot at apply time, like every adjustment; the till
--     re-applies after the tab changes (same-promotion re-apply is a no-op when
--     the amount is unchanged);
--   * codes share their promotion's limits and expiry (no per-code limits).
--
-- covered by packages/db/tests/promotions.test.ts

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table promotions (
  id              uuid primary key default gen_random_uuid(),
  name_en         text not null,
  name_ar         text not null,
  type            text not null check (type in ('percent','amount')),
  value           int  not null,                       -- percent 1..99 | IQD > 0
  starts_at       timestamptz,
  ends_at         timestamptz,
  weekdays        int[] not null default '{}',         -- 0 = Sunday; empty = any
  hour_from       time,
  hour_to         time,                                -- null = any; from > to crosses midnight
  scope           jsonb not null default '{}'::jsonb,  -- {courtIds:[],categoryIds:[],itemIds:[]}
  limits          jsonb not null default '{}'::jsonb,  -- {total, perCustomer, minSpendIqd}
  auto            boolean not null default true,       -- applied automatically vs by code
  public_code     text unique,
  code_single_use boolean not null default false,
  enabled         boolean not null default true,
  created_by      uuid not null references staff(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint promotions_value_chk check (
    (type = 'percent' and value between 1 and 99) or (type = 'amount' and value > 0)),
  constraint promotions_dates_chk check (
    starts_at is null or ends_at is null or starts_at < ends_at),
  constraint promotions_hours_chk check (
    (hour_from is null) = (hour_to is null) and (hour_from is null or hour_from <> hour_to)),
  constraint promotions_weekdays_chk check (weekdays <@ '{0,1,2,3,4,5,6}'::int[]),
  constraint promotions_code_chk check (public_code is null or public_code ~ '^[A-Z0-9]{4,16}$'),
  constraint promotions_scope_chk check (jsonb_typeof(scope) = 'object'),
  constraint promotions_limits_chk check (jsonb_typeof(limits) = 'object')
);

comment on table promotions is
  '0067: promotion configuration (spec 06.26/06.27). Written only through '
  'app.upsert_promotion / set_promotion_enabled / generate_promo_code; never deleted.';
comment on column promotions.weekdays is '0 = Sunday .. 6 = Saturday (extract(dow)); empty = any day.';
comment on column promotions.scope is
  '{courtIds:[uuid], categoryIds:[uuid], itemIds:[uuid]} — empty/absent = whole bill. '
  'courtIds filters eligibility (tab reservation court); item/category ids restrict the discount base.';
comment on column promotions.limits is
  '{total:int, perCustomer:int, minSpendIqd:int} — absent = unlimited / no minimum.';

alter table tab_adjustments
  add column promotion_id uuid references promotions(id);

-- A promotion row is recognisable by construction: reason_code 'promotion'
-- and promotion_id go together. Existing rows (promotion_id null) pass.
alter table tab_adjustments
  add constraint tab_adjustments_promotion_reason_chk
  check (promotion_id is null or reason_code = 'promotion');

comment on column tab_adjustments.promotion_id is
  '0067: set when this discount row was written by app.apply_best_promotion '
  '(reason_code ''promotion''; authorized_by = the manager who configured the promotion).';

-- ONE promotion per tab, enforced by the database rather than by the RPC alone.
create unique index tab_adjustments_one_promotion_per_tab
  on tab_adjustments (tab_id) where promotion_id is not null;
create index tab_adjustments_promotion
  on tab_adjustments (promotion_id) where promotion_id is not null;

create table promotion_redemptions (
  id              uuid primary key default gen_random_uuid(),
  promotion_id    uuid not null references promotions(id),
  tab_id          uuid not null references tabs(id),
  adjustment_id   uuid not null references tab_adjustments(id),
  customer_id     uuid references profiles(id),        -- the tab's reservation guest, when known
  amount_iqd      iqd  not null,
  code_used       text,
  idempotency_key text unique,
  redeemed_at     timestamptz not null default now(),
  redeemed_by     uuid not null references staff(id)
);

comment on table promotion_redemptions is
  '0067: one row per promotion currently applied to a tab (unique per tab). Counted by '
  'limits.total / limits.perCustomer and by single-use codes. Replaced, never edited.';

create unique index promotion_redemptions_one_per_tab on promotion_redemptions (tab_id);
create index promotion_redemptions_promotion on promotion_redemptions (promotion_id);
create index promotion_redemptions_customer
  on promotion_redemptions (promotion_id, customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- 2. RLS — staff read; writes are RPC-only (no insert/update/delete grant at
--    all, and the revoke is the belt on top of never granting). Guests do not
--    read promotions in phase 1: the code is typed by the cashier.
-- ---------------------------------------------------------------------------
alter table promotions enable row level security;
alter table promotion_redemptions enable row level security;

grant select on promotions, promotion_redemptions to authenticated;
revoke insert, update, delete on promotions, promotion_redemptions from anon, authenticated;

create policy promotions_staff_read on promotions for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));

-- Redemptions are a money surface: same audience as tab_adjustments (0015).
create policy promotion_redemptions_staff_read on promotion_redemptions for select to authenticated
  using (app.is_staff('cashier','manager','owner'));

-- ---------------------------------------------------------------------------
-- 3. Internal money helpers — the ONLY arithmetic in this file.
--
--    app.promotion_amount_iqd is the SQL twin of @touch/core
--    promotionDiscountIqd; the two MUST agree bit-for-bit (parity test in
--    promotions.test.ts, same discipline as apply_pct_discount / 0030).
-- ---------------------------------------------------------------------------
create or replace function app.promotion_amount_iqd(p_base bigint, p_type text, p_value int)
returns bigint
language plpgsql immutable as $promo_amount_0067$
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
  end if;
  raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = coalesce(p_type, 'null'),
    hint = 'type is percent or amount';
end $promo_amount_0067$;

revoke all on function app.promotion_amount_iqd(bigint, text, int) from public, anon, authenticated;
grant execute on function app.promotion_amount_iqd(bigint, text, int) to service_role;   -- parity tests

comment on function app.promotion_amount_iqd(bigint, text, int) is
  '0067: percent => base - app.apply_pct_discount(base, pct); amount => least(value, base). '
  'Twin of @touch/core promotionDiscountIqd.';

-- The discount base for one promotion on one tab: the goods subtotal (the
-- same base apply_discount uses for a whole-tab discount), or, when the scope
-- names items/categories, the live lines that match. Court time is never in
-- the base (0053).
create or replace function app.promotion_base_iqd(p_tab_id uuid, p_scope jsonb)
returns bigint
language plpgsql stable security definer set search_path = public as $promo_base_0067$
declare
  v_items jsonb := '[]'::jsonb;
  v_cats  jsonb := '[]'::jsonb;
  v_base  bigint;
begin
  -- upsert_promotion stores scope canonically (no JSON nulls, no empty
  -- arrays); the typeof checks keep this helper honest on any input.
  if jsonb_typeof(p_scope->'itemIds') = 'array' then
    v_items := p_scope->'itemIds';
  end if;
  if jsonb_typeof(p_scope->'categoryIds') = 'array' then
    v_cats := p_scope->'categoryIds';
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
end $promo_base_0067$;

revoke all on function app.promotion_base_iqd(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.promotion_base_iqd(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. app.upsert_promotion — manager/owner; validated by name; audited.
--
--    Every parameter has a default so the contract's `p_id?` can come first
--    (Postgres requires every parameter after a defaulted one to carry a
--    default). Semantics are full replacement — the editor sends the whole
--    record — with ONE exception: p_public_code null KEEPS an existing code
--    and '' CLEARS it, because a code has a life outside the system (printed,
--    shared) and must not vanish because a form omitted it.
-- ---------------------------------------------------------------------------
create or replace function app.upsert_promotion(
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
language plpgsql security definer set search_path = public as $upsert_promo_0067$
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
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

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
      hint = 'limits is an object {total, perCustomer, minSpendIqd}';
  end if;
  for v_key in select jsonb_object_keys(p_limits) loop
    if v_key not in ('total','perCustomer','minSpendIqd') then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'limits.' || v_key,
        hint = 'limit keys are total, perCustomer, minSpendIqd';
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
end $upsert_promo_0067$;

revoke all on function app.upsert_promotion(uuid, text, text, text, int, timestamptz, timestamptz,
  int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) from public, anon;
grant execute on function app.upsert_promotion(uuid, text, text, text, int, timestamptz, timestamptz,
  int[], time, time, jsonb, jsonb, boolean, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.set_promotion_enabled — the only "delete" there is (06.26).
-- ---------------------------------------------------------------------------
create or replace function app.set_promotion_enabled(p_id uuid, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = public as $promo_enabled_0067$
declare
  v_row    promotions%rowtype;
  v_before jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_enabled is null then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'enabled';
  end if;

  select * into v_row from promotions where id = p_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.enabled = p_enabled then
    return jsonb_build_object('id', v_row.id, 'enabled', v_row.enabled, 'duplicate', true);
  end if;
  v_before := to_jsonb(v_row);

  update promotions set enabled = p_enabled, updated_at = now()
   where id = p_id
   returning * into v_row;

  perform app.write_audit('promotion.set_enabled', 'promotions', p_id::text,
                          v_before, to_jsonb(v_row));
  return jsonb_build_object('id', v_row.id, 'enabled', v_row.enabled, 'duplicate', false);
end $promo_enabled_0067$;

revoke all on function app.set_promotion_enabled(uuid, boolean) from public, anon;
grant execute on function app.set_promotion_enabled(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.generate_promo_code — 8 characters from an unambiguous alphabet
--    (no 0/O/1/I), unique across promotions, replaces any existing code.
--    Alphabet has 32 symbols so a byte modulo 32 is unbiased. Twin constant
--    PROMO_CODE_ALPHABET in @touch/core.
-- ---------------------------------------------------------------------------
create or replace function app.generate_promo_code(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $promo_code_0067$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_row      promotions%rowtype;
  v_before   jsonb;
  v_bytes    bytea;
  v_code     text;
  v_try      int := 0;
  i          int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from promotions where id = p_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  loop
    v_try := v_try + 1;
    if v_try > 20 then
      raise exception 'CODE_GENERATION_FAILED' using errcode = 'P0001';
    end if;
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from promotions x where x.public_code = v_code);
  end loop;

  update promotions set public_code = v_code, updated_at = now()
   where id = p_id
   returning * into v_row;

  perform app.write_audit('promotion.generate_code', 'promotions', p_id::text,
                          v_before, to_jsonb(v_row));
  return v_code;
end $promo_code_0067$;

revoke all on function app.generate_promo_code(uuid) from public, anon;
grant execute on function app.generate_promo_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.eligible_promotions — read-only; what could apply to this tab now.
--    Returns [{promotionId, name_en, name_ar, type, value, amountIqd}] best
--    first (amountIqd desc, then created_at asc, id asc — deterministic).
--    An unknown p_code raises CODE_INVALID so a mistyped code is caught at
--    the point of typing; a known code whose promotion is not eligible is
--    simply absent (apply_best_promotion names that case).
-- ---------------------------------------------------------------------------
create or replace function app.eligible_promotions(p_tab_id uuid, p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $elig_0067$
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
    select r.court_id, r.guest_id into v_court_id, v_customer
      from reservations r where r.id = v_tab.reservation_id;
  end if;

  -- Gross = goods subtotal + court fee (what the guest is spending before any
  -- discount). The discount BASE is narrower (goods only; see promotion_base_iqd).
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_gross := coalesce(v_totals.subtotal_iqd, 0) + coalesce(v_totals.court_iqd, 0);

  v_local := now() at time zone coalesce((select vs.timezone from venue_settings vs), 'Asia/Baghdad');
  v_dow   := extract(dow from v_local)::int;
  v_time  := v_local::time;

  for p in
    select pr.*
      from promotions pr
     where pr.enabled
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

    v_limit := (p.limits->>'minSpendIqd')::bigint;
    if v_limit is not null and v_gross < v_limit then
      continue;
    end if;

    v_base   := app.promotion_base_iqd(p_tab_id, p.scope);
    v_amount := app.promotion_amount_iqd(v_base, p.type, p.value);
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
end $elig_0067$;

revoke all on function app.eligible_promotions(uuid, text) from public, anon;
grant execute on function app.eligible_promotions(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.apply_best_promotion — the write. Guard first; claim the replay key
--    (0049 ledger: the claim commits or rolls back with the work, and it
--    survives the replacement delete, which a key column on the redemption
--    row alone would not); lock the tab (canonical order, 0038); evaluate;
--    replace; insert; refund guard; audit.
-- ---------------------------------------------------------------------------
create or replace function app.apply_best_promotion(
  p_tab_id          uuid,
  p_code            text default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $apply_promo_0067$
declare
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
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
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

  v_elig := app.eligible_promotions(p_tab_id, p_code);   -- raises CODE_INVALID

  -- A known code that is not eligible right now (expired, used up, wrong day,
  -- below minimum spend) is named rather than silently replaced by whatever
  -- auto promotion happens to be best: the cashier is holding a guest's code.
  if v_code is not null then
    select x.id into v_code_id from promotions x where x.public_code = v_code;
    if not exists (select 1 from jsonb_array_elements(v_elig) e
                    where (e->>'promotionId')::uuid = v_code_id) then
      raise exception 'CODE_NOT_ELIGIBLE' using errcode = 'P0001', detail = v_code;
    end if;
  end if;

  if jsonb_array_length(v_elig) = 0 then
    raise exception 'NO_ELIGIBLE_PROMOTION' using errcode = 'P0001';
  end if;

  v_best   := v_elig->0;
  v_amount := (v_best->>'amountIqd')::bigint;
  select * into v_promo from promotions where id = (v_best->>'promotionId')::uuid;

  if v_tab.reservation_id is not null then
    select r.guest_id into v_customer from reservations r where r.id = v_tab.reservation_id;
  end if;

  -- Replace the earlier promotion on this tab (one per tab). Same promotion,
  -- same amount: nothing has changed, so nothing is rewritten.
  select * into v_old_red from promotion_redemptions where tab_id = p_tab_id;
  if found then
    select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
    if v_old_red.promotion_id = v_promo.id and v_old_adj.amount_iqd = v_amount then
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
    'adjustmentId', v_adj.id, 'replacedPromotionId', v_replaced, 'unchanged', false);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $apply_promo_0067$;

revoke all on function app.apply_best_promotion(uuid, text, text, text) from public, anon;
grant execute on function app.apply_best_promotion(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.merge_tabs — the 0015 body VERBATIM plus one block.
--
--    merge_tabs re-points every tab_adjustments row of the donor at the
--    survivor. With a promotion on BOTH tabs that is either a raw 23505 from
--    tab_adjustments_one_promotion_per_tab (the index above) or, without the
--    index, two promotion discounts stacking on one bill — the exact thing
--    06.13 forbids. Neither is acceptable, so the donor's promotion is dropped
--    (audited) before the move; the survivor keeps its own. The survivor's
--    snapshot is now stale against a bigger bill, and the till re-applies —
--    the same rule as after any line change. Nothing else in the body moved.
-- ---------------------------------------------------------------------------
create or replace function app.merge_tabs(
  p_donor_tab_id    uuid,
  p_survivor_tab_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $merge_0067$
declare
  v_donor    tabs%rowtype;
  v_survivor tabs%rowtype;
  v_before   jsonb;
  v_first    uuid;
  v_second   uuid;
  v_old_red  promotion_redemptions%rowtype;
  v_old_adj  tab_adjustments%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_donor_tab_id = p_survivor_tab_id then
    raise exception 'MERGE_SELF' using errcode = 'P0001';
  end if;

  -- Lock in a deterministic order to dodge deadlocks with a concurrent merge.
  v_first  := least(p_donor_tab_id, p_survivor_tab_id);
  v_second := greatest(p_donor_tab_id, p_survivor_tab_id);
  perform 1 from tabs where id = v_first for update;
  perform 1 from tabs where id = v_second for update;

  select * into v_donor from tabs where id = p_donor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_donor_tab_id::text;
  end if;
  select * into v_survivor from tabs where id = p_survivor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_survivor_tab_id::text;
  end if;

  if v_donor.status <> 'open' or v_survivor.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_donor.day_session_id <> v_survivor.day_session_id then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;
  if exists (select 1 from payments where tab_id = v_donor.id) then
    raise exception 'DONOR_HAS_PAYMENTS' using errcode = 'P0001',
      hint = 'settle or refund the donor tab first';
  end if;

  v_before := to_jsonb(v_donor);

  -- 0067: the donor's promotion does not travel (one promotion per tab).
  select * into v_old_red from promotion_redemptions where tab_id = v_donor.id;
  if found then
    select * into v_old_adj from tab_adjustments where id = v_old_red.adjustment_id;
    delete from promotion_redemptions where id = v_old_red.id;
    delete from tab_adjustments where tab_id = v_donor.id and promotion_id is not null;
    perform app.write_audit('promotion.drop_on_merge', 'tab_adjustments', v_old_adj.id::text,
                            to_jsonb(v_old_adj) || jsonb_build_object('redemption', to_jsonb(v_old_red)),
                            null, 'promotion', v_old_adj.authorized_by, null);
  end if;

  update orders set tab_id = v_survivor.id where tab_id = v_donor.id;
  update tab_adjustments set tab_id = v_survivor.id where tab_id = v_donor.id;

  update tabs
     set status = 'void', merged_into_tab_id = v_survivor.id,
         subtotal_iqd = 0, tax_iqd = 0, discount_iqd = 0, total_iqd = 0
   where id = v_donor.id
   returning * into v_donor;

  perform app.write_audit('tab.merge', 'tabs', v_donor.id::text,
                          v_before, to_jsonb(v_donor));

  return jsonb_build_object('donor_tab_id', v_donor.id,
                            'survivor_tab_id', v_survivor.id);
end $merge_0067$;

revoke all on function app.merge_tabs(uuid, uuid) from public, anon;
grant execute on function app.merge_tabs(uuid, uuid) to authenticated;
