-- ===========================================================================
-- 0041 — availability: venue-local day, and one set-based query
--
--   #11 The "86 for today" flag was written and compared with current_date —
--       the DATABASE date, i.e. UTC on Supabase — while every other date
--       decision in the system is explicitly venue-local (open_day resolves
--       Asia/Baghdad; analytics runs on app.business_date with a 04:00 start
--       hour). In Baghdad (UTC+3) that meant: an 86 set between 00:00 and
--       03:00 local was stamped with YESTERDAY's UTC date and had no effect at
--       all, and every 86 silently cleared at 03:00 local — mid-service, while
--       the venue was still trading.
--
--       All three call sites now use app.business_date(now()) (0034), so an 86
--       covers the whole trading night and clears at the business-day boundary
--       (04:00 local by default, app-configurable via
--       analytics_business_day_start_hour).
--
--   #9  app.menu_availability() was a function-call-per-row nested scan:
--       item_required_ingredients(mi.id) per menu item, which itself called
--       ingredient_on_hand() per candidate ingredient, each of which
--       re-aggregated stock_batches. O(items x ingredients) aggregate scans —
--       and the guest menu reads it as a plain whole-table select on SSR, on
--       every menu_changed broadcast (fanned out to EVERY connected guest), on
--       reconnect and on tab-focus.
--
--       Rewritten set-based: on-hand is aggregated ONCE into a CTE and the
--       required-ingredient expansion is a join. Same signature and return
--       type, so the menu_item_availability view (0025) and its anon grants
--       are untouched.
--
--       EQUIVALENCE. item_required_ingredients sums qty and divides by
--       yield_percent; availability only ever tests `on_hand <= 0`, and
--       positive scaling cannot turn a positive on-hand into zero, so the
--       quantities are dropped and only the ingredient SET is reproduced:
--         - a direct ingredient that is purchased           -> required as-is
--         - a direct ingredient that is prepared and IN stock -> required as-is
--         - a direct ingredient that is prepared and OUT     -> replaced by its
--           one-level components (the prepared ingredient itself drops out)
--       which is exactly the 0018 `expanded` CTE. app.item_required_ingredients
--       is left in place — the 0018/0019 cost views still call it.
--
--       No index is added: stock_batches_fefo (0017) is already
--       (ingredient_id, ...) WHERE qty_remaining > 0, which is the partial
--       index this aggregate wants.
--
--       Not a materialized view: it would need invalidating on every
--       stock_batches write — i.e. on every ticket — trading a read cost for a
--       write cost on the hottest path in the system.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app.set_item_availability — 0013 body, venue-local stamp (#11).
-- ---------------------------------------------------------------------------
create or replace function app.set_item_availability(
  p_item_id   uuid,
  p_available boolean
) returns void
language plpgsql security definer set search_path = public as $avail_0041$
declare
  v_before jsonb;
  v_row    menu_items%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from menu_items where id = p_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  update menu_items
     set unavailable_on = case when p_available then null
                               else app.business_date(now()) end   -- 0041: was current_date
   where id = p_item_id
   returning * into v_row;

  perform app.write_audit('menu.item.availability', 'menu_items', v_row.id::text,
                          v_before, to_jsonb(v_row));
end $avail_0041$;

-- ---------------------------------------------------------------------------
-- app.menu_availability — set-based (#9) + venue-local day (#11).
-- ---------------------------------------------------------------------------
create or replace function app.menu_availability()
returns table (item_id uuid, orderable boolean)
language sql stable security definer set search_path = public as $menu_avail_0041$
  with today as (
    select app.business_date(now()) as d
  ),
  on_hand as (
    select ingredient_id, sum(qty_remaining) as qty
      from stock_batches
     where qty_remaining > 0
     group by ingredient_id
  ),
  direct as (
    -- every ingredient any variant of the item draws on, deduped
    select v.item_id, rl.ingredient_id
      from menu_item_variants v
      join recipe_lines rl on rl.variant_id = v.id
     group by v.item_id, rl.ingredient_id
  ),
  required as (
    -- purchased, or prepared with stock on hand: required as-is
    select d.item_id, d.ingredient_id
      from direct d
      join ingredients i on i.id = d.ingredient_id
      left join on_hand oh on oh.ingredient_id = d.ingredient_id
     where i.kind = 'purchased' or coalesce(oh.qty, 0) > 0
    union
    -- prepared and OUT: one-level expansion into its components
    select d.item_id, rl.ingredient_id
      from direct d
      join ingredients i on i.id = d.ingredient_id
      join recipe_lines rl on rl.output_ingredient_id = d.ingredient_id
      left join on_hand oh on oh.ingredient_id = d.ingredient_id
     where i.kind = 'prepared' and coalesce(oh.qty, 0) <= 0
  )
  select mi.id as item_id,
         mi.is_active
           and coalesce(mi.unavailable_on <> (select d from today), true)   -- 0041
           and not mi.sold_out
           and not exists (
             select 1
               from required r
               left join on_hand oh on oh.ingredient_id = r.ingredient_id
              where r.item_id = mi.id and coalesce(oh.qty, 0) <= 0
           ) as orderable
    from menu_items mi
$menu_avail_0041$;

revoke all on function app.menu_availability() from public;
grant execute on function app.menu_availability() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.add_order_items — 0030 body (featured pricing, reveal-aware modifier
-- validation) with the 86 comparison made venue-local (#11). Everything else
-- is byte-identical to 0030.
-- ---------------------------------------------------------------------------
create or replace function app.add_order_items(p_order_id uuid, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = public as $add_0041$
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
  v_today     date;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  v_today := app.business_date(now());         -- 0041: once per order, not per line

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
       or v_mi.unavailable_on = v_today                    -- 0041: was current_date
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
end $add_0041$;

-- INTERNAL: create or replace preserves the 0015 grants; restated as a belt.
revoke all on function app.add_order_items(uuid, jsonb) from public, anon, authenticated;
