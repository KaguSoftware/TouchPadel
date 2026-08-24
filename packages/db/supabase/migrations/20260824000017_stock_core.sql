-- 0017_stock_core — ingredients, recipes/BOM, deliveries, batches (design-data.md §1.8).
--
--  * one BOM table (recipe_lines), three attachment points, CHECK num_nonnulls = 1;
--    sub-recipe cycle guard = constraint trigger (recursive walk, depth cap 3).
--  * stock_batches carry qty_remaining maintained ONLY by app.* functions; the
--    append-only movements ledger (0018) is the truth, batches are the FEFO index.
--  * app.receive_delivery: manager/owner; one call = delivery + lines + batches +
--    goods_in ledger rows; expiry captured per line or derived from shelf_life_days;
--    short delivery = qty_expected − qty_received, stored on the line.
--  * RLS (matrix §3.2): stock tables are staff-only — manager/owner SELECT; every
--    write is RPC-only. Cashier touches stock exclusively through the waste RPC (0018).

-- receive_delivery inserts into stock_movements (created in 0018): skip body
-- validation at creation time.
set check_function_bodies = off;

create table ingredients (
  id                      uuid primary key default gen_random_uuid(),
  kind                    ingredient_kind not null default 'purchased',
  name_en                 text not null,
  name_ar                 text not null,
  unit                    stock_unit not null,               -- base unit: g / ml / pc
  pack_size               numeric(12,3),                     -- e.g. 1000 (g) per bag
  pack_cost_iqd           iqd,                               -- supplier cost per pack (latest)
  supplier_name           text,
  shelf_life_days         int,                               -- default expiry at goods-in if none captured
  yield_percent           numeric(5,2) not null default 100 check (yield_percent > 0 and yield_percent <= 100),
  waste_allowance_percent numeric(5,2) not null default 0 check (waste_allowance_percent >= 0),
  par_level               numeric(12,3),
  low_stock_threshold     numeric(12,3),
  is_active               boolean not null default true
);

-- One BOM table, three attachment points; CHECK enforces exactly one target.
create table recipe_lines (
  id                   uuid primary key default gen_random_uuid(),
  variant_id           uuid references menu_item_variants(id) on delete cascade, -- per-SIZE quantities
  modifier_id          uuid references modifiers(id) on delete cascade,          -- modifier-aware consumption
  output_ingredient_id uuid references ingredients(id) on delete cascade,        -- sub-recipe definition (kind='prepared')
  ingredient_id        uuid not null references ingredients(id),
  qty                  numeric(12,3) not null check (qty > 0),                   -- in ingredient base unit
  check (num_nonnulls(variant_id, modifier_id, output_ingredient_id) = 1)
);

create index recipe_lines_variant  on recipe_lines (variant_id)  where variant_id  is not null;
create index recipe_lines_modifier on recipe_lines (modifier_id) where modifier_id is not null;
create index recipe_lines_output   on recipe_lines (output_ingredient_id) where output_ingredient_id is not null;
create index recipe_lines_ingredient on recipe_lines (ingredient_id);

-- ---------------------------------------------------------------------------
-- Sub-recipe cycle guard (design §4): output_ingredient lines may reference
-- another prepared ingredient, nesting at most one level (walk capped at 3);
-- a component chain that reaches back to its own output is refused.
-- Constraint trigger: fires at commit-visible time per row, cannot be bypassed
-- by definer functions.
-- ---------------------------------------------------------------------------
create or replace function app.check_recipe_cycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_hit boolean;
begin
  if new.output_ingredient_id is null then
    return new;
  end if;
  if new.output_ingredient_id = new.ingredient_id then
    raise exception 'RECIPE_CYCLE' using errcode = 'P0001',
      detail = 'a sub-recipe cannot contain its own output';
  end if;

  with recursive walk(ingredient_id, depth) as (
    select new.ingredient_id, 1
    union all
    select rl.ingredient_id, w.depth + 1
      from walk w
      join recipe_lines rl on rl.output_ingredient_id = w.ingredient_id
     where w.depth < 4
  )
  select bool_or(ingredient_id = new.output_ingredient_id or depth > 3)
    into v_hit
    from walk;

  if coalesce(v_hit, false) then
    raise exception 'RECIPE_CYCLE' using errcode = 'P0001',
      detail = 'sub-recipe nesting forms a cycle or exceeds depth 3';
  end if;
  return new;
end $$;

create constraint trigger recipe_lines_cycle_guard
  after insert or update of ingredient_id, output_ingredient_id on recipe_lines
  for each row execute function app.check_recipe_cycle();

-- ---------------------------------------------------------------------------
-- Deliveries (goods-in) and batches
-- ---------------------------------------------------------------------------
create table deliveries (
  id            uuid primary key default gen_random_uuid(),
  received_at   timestamptz not null default now(),
  received_by   uuid not null references staff(id),
  supplier_name text,
  notes         text
);

create table delivery_lines (
  id            uuid primary key default gen_random_uuid(),
  delivery_id   uuid not null references deliveries(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty_expected  numeric(12,3),
  qty_received  numeric(12,3) not null check (qty_received >= 0),  -- short delivery = expected − received
  unit_cost_iqd numeric(14,4) not null check (unit_cost_iqd >= 0), -- cost per BASE unit (fractional internally; bills stay integer)
  expiry_date   date                                               -- captured, else derived from shelf_life_days
);

create table stock_batches (
  id               uuid primary key default gen_random_uuid(),
  ingredient_id    uuid not null references ingredients(id),
  delivery_line_id uuid references delivery_lines(id),             -- null for production_in / synthetic batches
  received_at      timestamptz not null default now(),
  expiry_date      date,
  qty_received     numeric(12,3) not null,
  qty_remaining    numeric(12,3) not null check (qty_remaining >= 0),
  unit_cost_iqd    numeric(14,4) not null
);

-- FEFO scan order: soonest expiry first, unknown expiry last, oldest goods-in first.
create index stock_batches_fefo on stock_batches (ingredient_id, expiry_date asc nulls last, received_at asc)
  where qty_remaining > 0;

-- ---------------------------------------------------------------------------
-- app.receive_delivery — manager/owner. One transaction: delivery header, lines,
-- one batch per line with qty_received > 0, one goods_in ledger row per batch.
-- p_lines: [{ "ingredient_id": uuid, "qty_expected": n|null, "qty_received": n,
--             "unit_cost_iqd": n, "expiry_date": "YYYY-MM-DD"|null }, ...]
-- ---------------------------------------------------------------------------
create or replace function app.receive_delivery(
  p_lines         jsonb,
  p_supplier_name text default null,
  p_notes         text default null,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_delivery deliveries%rowtype;
  v_line     jsonb;
  v_ing      ingredients%rowtype;
  v_dl_id    uuid;
  v_batch_id uuid;
  v_expiry   date;
  v_qty      numeric;
  v_cost     numeric;
  v_batches  uuid[] := '{}';
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_DELIVERY' using errcode = 'P0001';
  end if;

  insert into deliveries (received_by, supplier_name, notes)
  values (auth.uid(), p_supplier_name, p_notes)
  returning * into v_delivery;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_ing from ingredients
     where id = (v_line->>'ingredient_id')::uuid and is_active;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_line->>'ingredient_id', '(missing ingredient_id)');
    end if;

    v_qty  := (v_line->>'qty_received')::numeric;
    v_cost := (v_line->>'unit_cost_iqd')::numeric;
    if v_qty is null or v_qty < 0 or v_cost is null or v_cost < 0 then
      raise exception 'INVALID_LINE' using errcode = 'P0001', detail = v_line::text;
    end if;

    -- Expiry: captured per line, else derived from shelf_life_days, else null.
    v_expiry := coalesce(
      (v_line->>'expiry_date')::date,
      case when v_ing.shelf_life_days is not null
           then current_date + v_ing.shelf_life_days end);

    insert into delivery_lines (delivery_id, ingredient_id, qty_expected, qty_received, unit_cost_iqd, expiry_date)
    values (v_delivery.id, v_ing.id, (v_line->>'qty_expected')::numeric, v_qty, v_cost, v_expiry)
    returning id into v_dl_id;

    if v_qty > 0 then
      insert into stock_batches (ingredient_id, delivery_line_id, expiry_date, qty_received, qty_remaining, unit_cost_iqd)
      values (v_ing.id, v_dl_id, v_expiry, v_qty, v_qty, v_cost)
      returning id into v_batch_id;
      v_batches := v_batches || v_batch_id;

      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                   unit_cost_iqd, delivery_line_id, staff_id, device_id)
      values (v_ing.id, v_batch_id, 'goods_in', v_qty, v_cost, v_dl_id, auth.uid(), p_device_id);
    end if;
  end loop;

  perform app.write_audit('stock.receive_delivery', 'deliveries', v_delivery.id::text,
                          null, jsonb_build_object('lines', p_lines, 'supplier', p_supplier_name),
                          null, null, p_device_id);

  return jsonb_build_object('delivery_id', v_delivery.id, 'batch_ids', to_jsonb(v_batches));
end $$;

-- ---------------------------------------------------------------------------
-- Grants + RLS: staff-only (manager/owner SELECT); ALL writes RPC-only.
-- ---------------------------------------------------------------------------
alter table ingredients    enable row level security;
alter table recipe_lines   enable row level security;
alter table deliveries     enable row level security;
alter table delivery_lines enable row level security;
alter table stock_batches  enable row level security;

grant select on ingredients, recipe_lines, deliveries, delivery_lines, stock_batches to authenticated;

create policy ingredients_mgmt_read    on ingredients    for select to authenticated using (app.is_staff('manager','owner'));
create policy recipe_lines_mgmt_read   on recipe_lines   for select to authenticated using (app.is_staff('manager','owner'));
create policy deliveries_mgmt_read     on deliveries     for select to authenticated using (app.is_staff('manager','owner'));
create policy delivery_lines_mgmt_read on delivery_lines for select to authenticated using (app.is_staff('manager','owner'));
create policy stock_batches_mgmt_read  on stock_batches  for select to authenticated using (app.is_staff('manager','owner'));

revoke all on function app.check_recipe_cycle() from public, anon, authenticated;
revoke all on function app.receive_delivery(jsonb, text, text, text) from public, anon;
grant execute on function app.receive_delivery(jsonb, text, text, text) to authenticated;
