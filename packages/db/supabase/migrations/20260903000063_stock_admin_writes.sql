-- 0063_stock_admin_writes — the stock master-data write path (SOW L515-518).
--
-- Module 5's ledger, batches, counts and views have existed since 0017-0019,
-- but `ingredients` and `recipe_lines` had NO write RPC at all — RLS blocks
-- direct writes and the fixtures were the only author. The stock UI cannot
-- exist without these two:
--
--   1. app.upsert_ingredient — manager/owner; unit and kind become IMMUTABLE
--      once the ingredient has ledger movements (quantities are stored in the
--      base unit; changing it would silently corrupt every historical row);
--      named validation errors; audited.
--   2. app.set_recipe — one call per attachment point ('variant' | 'modifier'
--      | 'output'), atomically replacing that target's lines. The 0017 cycle
--      constraint-trigger still guards sub-recipes; its raise surfaces as
--      RECIPE_CYCLE. Audited with before/after line sets.
--
-- covered by packages/db/tests/stock-admin.test.ts

-- ---------------------------------------------------------------------------
-- 1. upsert_ingredient
-- ---------------------------------------------------------------------------
create or replace function app.upsert_ingredient(
  p_name_en                 text,
  p_name_ar                 text,
  p_unit                    stock_unit,
  p_kind                    ingredient_kind default 'purchased',
  p_pack_size               numeric default null,
  p_pack_cost_iqd           bigint  default null,
  p_supplier_name           text    default null,
  p_shelf_life_days         int     default null,
  p_yield_percent           numeric default 100,
  p_waste_allowance_percent numeric default 0,
  p_par_level               numeric default null,
  p_low_stock_threshold     numeric default null,
  p_is_active               boolean default true,
  p_id                      uuid    default null
) returns uuid
language plpgsql security definer set search_path = public as $upsert_ing_0063$
declare
  v_row    ingredients%rowtype;
  v_before jsonb;
  v_moved  boolean;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_name_en), '') = '' or coalesce(btrim(p_name_ar), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001',
      hint = 'both English and Arabic names';
  end if;
  if p_yield_percent is null or p_yield_percent <= 0 or p_yield_percent > 100 then
    raise exception 'INVALID_YIELD' using errcode = 'P0001', hint = '0 < yield <= 100';
  end if;
  if p_waste_allowance_percent is null or p_waste_allowance_percent < 0
     or p_waste_allowance_percent > 100 then
    raise exception 'INVALID_WASTE_ALLOWANCE' using errcode = 'P0001', hint = '0-100';
  end if;
  if p_pack_size is not null and p_pack_size <= 0 then
    raise exception 'INVALID_PACK' using errcode = 'P0001';
  end if;
  if p_pack_cost_iqd is not null and p_pack_cost_iqd < 0 then
    raise exception 'INVALID_COST' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into ingredients (kind, name_en, name_ar, unit, pack_size, pack_cost_iqd,
                             supplier_name, shelf_life_days, yield_percent,
                             waste_allowance_percent, par_level, low_stock_threshold, is_active)
    values (p_kind, btrim(p_name_en), btrim(p_name_ar), p_unit, p_pack_size, p_pack_cost_iqd,
            p_supplier_name, p_shelf_life_days, p_yield_percent,
            p_waste_allowance_percent, p_par_level, p_low_stock_threshold, p_is_active)
    returning * into v_row;
    perform app.write_audit('stock.ingredient.create', 'ingredients', v_row.id::text,
                            null, to_jsonb(v_row));
    return v_row.id;
  end if;

  select * into v_row from ingredients where id = p_id for update;
  if not found then
    raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  -- The ledger stores quantities in the base unit and costs per that unit.
  -- Once a movement exists, unit/kind are history's units — refuse the edit
  -- by name instead of letting 23514 or silent corruption answer.
  v_moved := exists (select 1 from stock_movements where ingredient_id = p_id);
  if v_moved and v_row.unit is distinct from p_unit then
    raise exception 'UNIT_LOCKED' using errcode = 'P0001',
      hint = 'the ledger already holds quantities in the current unit';
  end if;
  if v_moved and v_row.kind is distinct from p_kind then
    raise exception 'KIND_LOCKED' using errcode = 'P0001',
      hint = 'the ledger already classifies this ingredient';
  end if;

  update ingredients
     set kind                    = p_kind,
         name_en                 = btrim(p_name_en),
         name_ar                 = btrim(p_name_ar),
         unit                    = p_unit,
         pack_size               = p_pack_size,
         pack_cost_iqd           = p_pack_cost_iqd,
         supplier_name           = p_supplier_name,
         shelf_life_days         = p_shelf_life_days,
         yield_percent           = p_yield_percent,
         waste_allowance_percent = p_waste_allowance_percent,
         par_level               = p_par_level,
         low_stock_threshold     = p_low_stock_threshold,
         is_active               = p_is_active
   where id = p_id
   returning * into v_row;

  perform app.write_audit('stock.ingredient.update', 'ingredients', p_id::text,
                          v_before, to_jsonb(v_row));
  return v_row.id;
end $upsert_ing_0063$;

revoke all on function app.upsert_ingredient(text, text, stock_unit, ingredient_kind, numeric,
  bigint, text, int, numeric, numeric, numeric, numeric, boolean, uuid) from public, anon;
grant execute on function app.upsert_ingredient(text, text, stock_unit, ingredient_kind, numeric,
  bigint, text, int, numeric, numeric, numeric, numeric, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. set_recipe — atomic replace per attachment point.
--    p_lines: [{ "ingredient_id": uuid, "qty": numeric }] ; [] clears.
-- ---------------------------------------------------------------------------
create or replace function app.set_recipe(
  p_target    text,
  p_target_id uuid,
  p_lines     jsonb default '[]'::jsonb
) returns int
language plpgsql security definer set search_path = public as $set_recipe_0063$
declare
  v_line    jsonb;
  v_ing     uuid;
  v_qty     numeric;
  v_before  jsonb;
  v_after   jsonb;
  v_written int := 0;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_target = 'variant' then
    if not exists (select 1 from menu_item_variants where id = p_target_id) then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif p_target = 'modifier' then
    if not exists (select 1 from modifiers where id = p_target_id) then
      raise exception 'MODIFIER_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif p_target = 'output' then
    if not exists (select 1 from ingredients where id = p_target_id and kind = 'prepared') then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        hint = 'sub-recipes attach to a PREPARED ingredient';
    end if;
  else
    raise exception 'INVALID_TARGET' using errcode = 'P0001',
      hint = 'variant | modifier | output';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', rl.ingredient_id, 'qty', rl.qty)
                            order by rl.ingredient_id), '[]'::jsonb)
    into v_before
    from recipe_lines rl
   where (p_target = 'variant'  and rl.variant_id = p_target_id)
      or (p_target = 'modifier' and rl.modifier_id = p_target_id)
      or (p_target = 'output'   and rl.output_ingredient_id = p_target_id);

  delete from recipe_lines rl
   where (p_target = 'variant'  and rl.variant_id = p_target_id)
      or (p_target = 'modifier' and rl.modifier_id = p_target_id)
      or (p_target = 'output'   and rl.output_ingredient_id = p_target_id);

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_ing := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    if v_ing is null or v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_QTY' using errcode = 'P0001',
        hint = 'each line needs ingredient_id and qty > 0';
    end if;
    if not exists (select 1 from ingredients where id = v_ing) then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', detail = v_ing::text;
    end if;
    -- The 0017 cycle constraint-trigger fires per row and already raises the
    -- stable 'RECIPE_CYCLE' code — no wrapping needed here.
    insert into recipe_lines (variant_id, modifier_id, output_ingredient_id, ingredient_id, qty)
    values (case when p_target = 'variant'  then p_target_id end,
            case when p_target = 'modifier' then p_target_id end,
            case when p_target = 'output'   then p_target_id end,
            v_ing, v_qty);
    v_written := v_written + 1;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', rl.ingredient_id, 'qty', rl.qty)
                            order by rl.ingredient_id), '[]'::jsonb)
    into v_after
    from recipe_lines rl
   where (p_target = 'variant'  and rl.variant_id = p_target_id)
      or (p_target = 'modifier' and rl.modifier_id = p_target_id)
      or (p_target = 'output'   and rl.output_ingredient_id = p_target_id);

  perform app.write_audit('stock.recipe.set', 'recipe_lines',
                          p_target || ':' || p_target_id::text, v_before, v_after);
  return v_written;
end $set_recipe_0063$;

revoke all on function app.set_recipe(text, uuid, jsonb) from public, anon;
grant execute on function app.set_recipe(text, uuid, jsonb) to authenticated;
