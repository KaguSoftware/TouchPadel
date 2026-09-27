-- 0182 recipe_view — recipes as ingredient names, with no quantity, for the bar
-- and kitchen family and MGMT.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.6; plan #72, the
-- PARKED-default of §0 P3).
-- Depends on: nothing.
-- Re-runnable: create or replace.
--
-- WHAT IT LISTS. items: the active menu items in a cafe category at the
-- venue, each size with its recipe lines (so no shop product and no item in
-- release, which is never active). prepared: the active prepared ingredients
-- at the venue with an output recipe (the desserts and syrups, plan #25).
-- With p_menu_item_id, that one item only, and prepared is empty. Add-on
-- recipe lines are not shown (PROPOSAL).
--
-- NO QUANTITY AND NO UNIT, FOR ANYONE, MGMT INCLUDED (#72, §0 P3 is parked
-- on its default). No cost and no price either; the manager and the owner
-- keep Stock ▸ Recipes on the operator for the numbers. recipe_line_id is
-- there so a head's change request (§2.24.7) can name a line. If §0 P3 is
-- answered "show quantities", one re-issue adds qty and unit to lines for the
-- roles Majed names.
--
-- WHO READS. head_barista, barista, head_chef, chef (the chef's read is a
-- PROPOSAL: the spec does not name the chef tier for recipes), manager and
-- owner. The court desk, cashier, driver, marketing and prep read none.
--
-- covered by packages/db/tests/recipe-view.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.recipe_view(
  p_venue_id     uuid default null,
  p_menu_item_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $recipe_view_0182$
declare
  v_venue    uuid;
  v_items    jsonb;
  v_prepared jsonb;
begin
  if not app.is_staff('head_barista','barista','head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_menu_item_id is not null then
    -- One item: an active cafe item at one of the caller's venues, whose venue
    -- it reads. Anything else answers as missing.
    select mi.venue_id into v_venue
      from menu_items mi
      join menu_categories c on c.id = mi.category_id
     where mi.id = p_menu_item_id
       and mi.is_active
       and c.kind = 'cafe'
       and mi.venue_id = any(app.staff_venue_ids());
    if not found or (p_venue_id is not null and v_venue <> p_venue_id) then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'menu_item_id';
    end if;
  else
    v_venue := coalesce(p_venue_id, app.current_venue());
  end if;
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','barista','head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'menu_item_id',     mi.id,
           'name_en',          mi.name_en,
           'name_ar',          mi.name_ar,
           'category_name_en', c.name_en,
           'category_name_ar', c.name_ar,
           'sizes',            (select coalesce(jsonb_agg(jsonb_build_object(
                                         'variant_id', v.id,
                                         'name_en',    v.name_en,
                                         'name_ar',    v.name_ar,
                                         'lines',      (select coalesce(jsonb_agg(jsonb_build_object(
                                                                 'recipe_line_id', rl.id,
                                                                 'ingredient_id',  i.id,
                                                                 'name_en',        i.name_en,
                                                                 'name_ar',        i.name_ar)
                                                               order by lower(i.name_en), rl.id), '[]'::jsonb)
                                                          from recipe_lines rl
                                                          join ingredients i on i.id = rl.ingredient_id
                                                         where rl.variant_id = v.id))
                                       order by v.sort_order, v.id), '[]'::jsonb)
                                  from menu_item_variants v
                                 where v.item_id = mi.id))
         order by c.sort_order, lower(c.name_en), mi.sort_order, lower(mi.name_en), mi.id), '[]'::jsonb)
    into v_items
    from menu_items mi
    join menu_categories c on c.id = mi.category_id
   where mi.venue_id = v_venue
     and mi.is_active
     and c.kind = 'cafe'
     and (p_menu_item_id is null or mi.id = p_menu_item_id);

  if p_menu_item_id is not null then
    v_prepared := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'ingredient_id', p.id,
             'name_en',       p.name_en,
             'name_ar',       p.name_ar,
             'lines',         (select coalesce(jsonb_agg(jsonb_build_object(
                                        'recipe_line_id', rl.id,
                                        'ingredient_id',  i.id,
                                        'name_en',        i.name_en,
                                        'name_ar',        i.name_ar)
                                      order by lower(i.name_en), rl.id), '[]'::jsonb)
                                 from recipe_lines rl
                                 join ingredients i on i.id = rl.ingredient_id
                                where rl.output_ingredient_id = p.id))
           order by lower(p.name_en), p.id), '[]'::jsonb)
      into v_prepared
      from ingredients p
     where p.venue_id = v_venue
       and p.is_active
       and p.kind = 'prepared'
       and exists (select 1 from recipe_lines rl where rl.output_ingredient_id = p.id);
  end if;

  return jsonb_build_object('items', v_items, 'prepared', v_prepared);
end $recipe_view_0182$;

comment on function app.recipe_view(uuid, uuid) is
  'recipe_view (§2.24.6, #72). The bar and kitchen family and MGMT at the venue: {items: [{menu_item_id, name_en, name_ar, category_name_en, category_name_ar, sizes: [{variant_id, name_en, name_ar, lines: [{recipe_line_id, ingredient_id, name_en, name_ar}]}]}], prepared: [{ingredient_id, name_en, name_ar, lines: [...]}]}: the active cafe items and the active prepared ingredients with an output recipe, as ingredient names. No quantity, unit, cost or price for anyone (#72, §0 P3). With p_menu_item_id, that item only (REF_NOT_FOUND unless it is an active cafe item at one of the caller''s venues) and prepared is empty. FORBIDDEN for anyone else.';

revoke all on function app.recipe_view(uuid, uuid) from public, anon;
grant execute on function app.recipe_view(uuid, uuid) to authenticated;
