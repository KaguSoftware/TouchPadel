-- 0162 staff_ingredient_options — the narrow ingredient read the staff phone and
-- /tasks use to name an ingredient: a release proposal's recipe lines, a
-- shopping-list line, the driver's purchase pack helper.
--
-- Feature: protocols and the staff phone, lane A
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.5; plan §6.4).
-- Depends on: nothing. shopping_purchases (C) and the release propose form
-- (E, H) read through it.
-- Re-runnable: create or replace.
--
-- WHY A FUNCTION. The ingredient tables stay MGMT only (0136:129-151): they
-- carry pack cost, supplier and par levels, and batches carry unit costs and
-- on-hand. A head barista proposing a drink or a driver buying flour needs
-- the names, the unit and the pack size, and nothing else, so this returns
-- exactly {id, name_en, name_ar, unit, kind, pack_size}: no cost, no on-hand,
-- no supplier.
--
-- WHO. The bar and kitchen family (head_barista, barista, head_chef, chef),
-- the driver (the purchase pack helper, PROPOSAL) and MGMT, at the venue.
-- Marketing, the till, the desk and prep have no form that names an
-- ingredient.
--
-- covered by packages/db/tests/staff-ingredient-options.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.staff_ingredient_options(
  p_venue_id uuid default null,
  p_query    text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $staff_ingredient_options_0162$
declare
  v_venue uuid;
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
  v_rows  jsonb;
begin
  if not app.is_staff('head_barista','barista','head_chef','chef','driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'head_barista','barista','head_chef','chef','driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- A typed search matches either name, anywhere in it. % and _ are escaped,
  -- so a query is text and never a pattern.
  if v_q is not null then
    v_q := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',        i.id,
             'name_en',   i.name_en,
             'name_ar',   i.name_ar,
             'unit',      i.unit,
             'kind',      i.kind,
             'pack_size', i.pack_size)
           order by lower(i.name_en), i.id), '[]'::jsonb)
    into v_rows
    from (select i.*
            from ingredients i
           where i.venue_id = v_venue
             and i.is_active
             and (v_q is null or i.name_en ilike v_q or i.name_ar ilike v_q)
           order by lower(i.name_en), i.id
           limit 200) i;

  return jsonb_build_object('ingredients', v_rows);
end $staff_ingredient_options_0162$;

comment on function app.staff_ingredient_options(uuid, text) is
  'staff_ingredient_options (build-contracts §2.5). The bar and kitchen family, the driver and MGMT at the venue: '
  'the venue''s active ingredients as {ingredients: [{id, name_en, name_ar, unit, kind, pack_size}]}, p_query matched '
  'on either name, at most 200, by English name. No cost, no on-hand, no supplier: the ingredient tables stay MGMT '
  'only (0136). FORBIDDEN for anyone else and for a venue the caller does not work at.';

revoke all on function app.staff_ingredient_options(uuid, text) from public, anon;
grant execute on function app.staff_ingredient_options(uuid, text) to authenticated;
