-- 0030_order_pricing — app.add_order_items re-created for the cafe rebuild:
-- sold_out (0027), one-level modifier reveals (0028) and the featured-item
-- discount driven by cafe_settings (0029).
--
-- THIS FUNCTION IS THE SINGLE PRICING AUTHORITY FOR GUEST *AND* TILL ORDERS.
-- create_guest_order and till_add_items both delegate every line to it, so
-- the featured discount, availability (86 / sold_out / inactive) and modifier
-- rules apply identically whatever the order source. Prices are still
-- snapshotted from the menu tables only — never client-supplied. Basket
-- previews (web / till) may mirror the arithmetic with
-- packages/core/src/money/discount.ts, but the snapshot written here wins.
--
-- Additive on hosted (lczijabnorujcgmbuqlw): new nullable/defaulted columns,
-- same function signature (create or replace keeps the 0015 grants), no drops.
-- Depends on: menu_items.sold_out (0027), app.item_active_groups (0028),
-- app.cafe_setting_text / app.cafe_setting_int (0029).

-- ---------------------------------------------------------------------------
-- order_items: keep the LIST price beside the (possibly discounted) snapshot.
--   list_price_iqd  variant.price_iqd at send time (NULL on pre-0030 rows)
--   unit_price_iqd  what the guest pays per unit (existing column; may be
--                   lower than list when a promo applied; override_price
--                   still rewrites it and leaves list_price_iqd alone)
--   discount_pct / discount_source  why they differ (0 / NULL = no promo)
-- ---------------------------------------------------------------------------
alter table order_items
  add column if not exists list_price_iqd  iqd,
  add column if not exists discount_pct    int  not null default 0,
  add column if not exists discount_source text;

do $chk_0030$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_discount_pct_chk') then
    alter table order_items
      add constraint order_items_discount_pct_chk
        check (discount_pct between 0 and 99);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_discount_source_chk') then
    alter table order_items
      add constraint order_items_discount_source_chk
        check (discount_source is null or discount_source in ('featured'));
  end if;
end $chk_0030$;

comment on column order_items.list_price_iqd is
  'Variant price at send time, before any promo. NULL only on rows written before 0030. list_price_iqd - unit_price_iqd = promo effect per unit.';
comment on column order_items.discount_pct is
  'Percent taken off list_price_iqd to reach unit_price_iqd (0 = none). Integer half-up via app.apply_pct_discount.';
comment on column order_items.discount_source is
  'Which promo produced discount_pct: ''featured'' (cafe_settings hero) or NULL.';

-- ---------------------------------------------------------------------------
-- app.apply_pct_discount — INTERNAL pure helper. Integer half-up:
--   (list * (100 - pct) + 50) / 100      (bigint division; list is >= 0 so
--                                         truncation == floor)
-- Twin of applyPctDiscountIqd in packages/core/src/money/discount.ts — the
-- two MUST agree bit-for-bit (parity test in packages/db/tests).
-- ---------------------------------------------------------------------------
create or replace function app.apply_pct_discount(p_list bigint, p_pct int)
returns bigint
language plpgsql immutable as $fn_pct_0030$
begin
  if p_pct is null or p_pct < 0 or p_pct > 99 then
    raise exception 'INVALID_PCT' using errcode = 'P0001',
      detail = coalesce(p_pct::text, 'null'),
      hint = 'percent discounts are whole numbers 0..99';
  end if;
  return (p_list * (100 - p_pct) + 50) / 100;
end $fn_pct_0030$;

revoke all on function app.apply_pct_discount(bigint, int) from public, anon, authenticated;
grant execute on function app.apply_pct_discount(bigint, int) to service_role;   -- parity tests

-- ---------------------------------------------------------------------------
-- app.add_order_items — INTERNAL: validate + snapshot + insert the lines of one
-- order. p_items: [{"variant_id": uuid, "qty": int, "notes": text,
--                   "modifiers": [{"modifier_id": uuid, "qty": int}]}]
-- Prices come from menu tables ONLY. Returns the order's total in integer IQD.
--
-- Full 0015 body re-created here (0026 lesson: one migration owns the whole
-- function). Changes vs 0015:
--   (a) ITEM_UNAVAILABLE also when menu_items.sold_out (sticky, unlike 86).
--   (b) Featured promo: hero_mode='featured' + featured_item_id = this item +
--       featured_discount_pct > 0  =>  unit = apply_pct_discount(list, pct),
--       discount_pct / discount_source stamped; list_price_iqd always kept.
--   (c) Modifier loop only checks existence + is_active + qty and snapshots
--       the delta; group membership is no longer decided per modifier.
--   (d) After the loop, per line, via app.item_active_groups (0028):
--       active = groups linked to the item  UNION  groups revealed by a chosen
--       modifier whose own group is linked. A chosen modifier outside the
--       active set => MODIFIER_INVALID (detail = modifier id). Each active
--       group's distinct chosen count outside [min_select, max_select] =>
--       MODIFIER_SELECTION (detail = group id). A revealed group whose
--       revealing option was not chosen is simply inactive: its min_select
--       does not apply and any modifier from it is MODIFIER_INVALID.
-- Everything else (EMPTY_ORDER, INVALID_QTY, VARIANT_NOT_FOUND, category
-- check, duplicate-modifier PK, line_total = (unit + mods) * qty, returned
-- total) is unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.add_order_items(p_order_id uuid, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = public as $fn_add_0030$
declare
  v_item      jsonb;
  v_mod       jsonb;
  v_variant   menu_item_variants%rowtype;
  v_mi        menu_items%rowtype;
  v_modifier  modifiers%rowtype;
  v_qty       int;
  v_mqty      int;
  v_list      bigint;
  v_unit      bigint;
  v_mods      bigint;
  v_line      bigint;
  v_oi_id     uuid;
  v_total     bigint := 0;
  v_hero_mode text;
  v_feat      uuid;
  v_pct       int;
  v_featured  boolean;
  v_chosen    uuid[];
  v_active    uuid[];
  v_bad_mod   uuid;
  v_bad_group uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  -- Featured promo state (0029 settings), read ONCE per call so every line of
  -- this order sees the same promo — a mid-order settings change cannot split
  -- one order across two prices.
  v_hero_mode := app.cafe_setting_text('hero_mode');
  begin
    v_feat := nullif(nullif(app.cafe_setting_text('featured_item_id'), ''), 'null')::uuid;
  exception when invalid_text_representation then
    v_feat := null;                            -- a malformed setting must never block ordering
  end;
  v_pct := coalesce(app.cafe_setting_int('featured_discount_pct'), 0);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;

    select * into v_variant from menu_item_variants
     where id = (v_item->>'variant_id')::uuid;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001',
        detail = v_item->>'variant_id';
    end if;

    select * into v_mi from menu_items where id = v_variant.item_id;
    if not v_mi.is_active
       or v_mi.unavailable_on = current_date
       or v_mi.sold_out
       or not exists (select 1 from menu_categories c where c.id = v_mi.category_id and c.is_active) then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001',
        detail = v_mi.id::text;
    end if;

    v_list := v_variant.price_iqd;             -- SNAPSHOT: server price, never client-supplied
    v_featured := coalesce(v_hero_mode = 'featured' and v_feat = v_mi.id and v_pct > 0, false);
    if v_featured then
      v_unit := app.apply_pct_discount(v_list, v_pct);
    else
      v_unit := v_list;
    end if;
    v_mods := 0;

    insert into order_items (order_id, menu_item_id, variant_id, qty,
                             list_price_iqd, unit_price_iqd, line_total_iqd, notes,
                             discount_pct, discount_source)
    values (p_order_id, v_mi.id, v_variant.id, v_qty,
            v_list, v_unit, 0, nullif(v_item->>'notes', ''),
            case when v_featured then v_pct else 0 end,
            case when v_featured then 'featured' else null end)
    returning id into v_oi_id;

    for v_mod in select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb)) loop
      v_mqty := coalesce(nullif(v_mod->>'qty', '')::int, 1);
      if v_mqty < 1 or v_mqty > 9 then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;

      -- Existence + is_active here; whether its group is linked OR revealed for
      -- this line is decided below, once every choice of the line is known.
      select m.* into v_modifier
        from modifiers m
       where m.id = (v_mod->>'modifier_id')::uuid and m.is_active;
      if not found then
        raise exception 'MODIFIER_INVALID' using errcode = 'P0001',
          detail = v_mod->>'modifier_id';
      end if;

      insert into order_item_modifiers (order_item_id, modifier_id, qty, price_delta_iqd)
      values (v_oi_id, v_modifier.id, v_mqty, v_modifier.price_delta_iqd);
      -- PK (order_item_id, modifier_id) raises on a duplicate modifier in the payload.

      v_mods := v_mods + v_modifier.price_delta_iqd * v_mqty;
    end loop;

    -- Active groups for this line (0028): linked groups UNION groups revealed
    -- by a chosen modifier whose own group is linked (depth is 1 by invariant).
    select coalesce(array_agg(oim.modifier_id), '{}'::uuid[]) into v_chosen
      from order_item_modifiers oim
     where oim.order_item_id = v_oi_id;
    v_active := array(select ag from app.item_active_groups(v_mi.id, v_chosen) as ag);

    -- Any chosen modifier outside the active set is invalid for this line.
    select m.id into v_bad_mod
      from order_item_modifiers oim
      join modifiers m on m.id = oim.modifier_id
     where oim.order_item_id = v_oi_id
       and m.group_id <> all (v_active)
     order by m.sort_order, m.id
     limit 1;
    if v_bad_mod is not null then
      raise exception 'MODIFIER_INVALID' using errcode = 'P0001',
        detail = v_bad_mod::text,
        hint = 'modifier group is neither linked to the item nor revealed by a chosen option';
    end if;

    -- min/max per ACTIVE group (distinct choices count; a doubled modifier is one choice).
    select g.id into v_bad_group
      from modifier_groups g
      left join lateral (
        select count(*) as chosen
          from order_item_modifiers oim
          join modifiers m2 on m2.id = oim.modifier_id
         where oim.order_item_id = v_oi_id and m2.group_id = g.id
      ) c on true
     where g.id = any (v_active)
       and (c.chosen < g.min_select or c.chosen > g.max_select)
     order by g.id
     limit 1;
    if v_bad_group is not null then
      raise exception 'MODIFIER_SELECTION' using errcode = 'P0001',
        detail = v_bad_group::text,
        hint = 'modifier choices violate a group min/max';
    end if;

    v_line := (v_unit + v_mods) * v_qty;
    update order_items set line_total_iqd = v_line where id = v_oi_id;
    v_total := v_total + v_line;
  end loop;

  return v_total;
end $fn_add_0030$;

-- INTERNAL: create or replace preserves the 0015 grants; restated as a belt.
revoke all on function app.add_order_items(uuid, jsonb) from public, anon, authenticated;
