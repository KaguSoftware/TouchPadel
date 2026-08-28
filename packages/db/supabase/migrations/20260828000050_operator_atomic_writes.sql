-- ---------------------------------------------------------------------------
-- 0050 — atomic writes for the operator admin screens.
--
-- Three defects from docs/design/operator-audit-2026-08-28.md, all of them
-- caused by the client having to compose a multi-row change out of single-row
-- RPCs:
--
--   H3  Reordering a menu item, category or add-on option re-sent the ENTIRE row rebuilt from
--       the local React Query cache (MenuEditor.tsx:61, CategoryEditor.tsx:180
--       via itemUpsertArgs / categoryUpsertArgs). If another manager had edited
--       that item since this client last fetched, pressing the up-arrow reverted
--       their edit — silently, with no conflict. Reordering must move a row, not
--       rewrite it.
--
--   H4  The hero builder wrote its settings in a `for … await` loop
--       (HeroBuilder.tsx:190) with no rollback, so a failure part-way left the
--       guest hero half-configured — mode changed, media not, or the reverse.
--
-- The fix in both cases is to make the whole change one statement in one
-- transaction, which is also the only way the audit log can record it as one
-- act by one actor.
--
-- Conventions followed: schema `app`, SECURITY DEFINER, `app.is_staff` guard
-- first, `app.write_audit` for every mutation, revoke from public/anon and
-- grant to `authenticated` only.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. app.reorder_menu_items(uuid[])
--
--    Assigns sort_order = array position, in one UPDATE. Touches ONLY
--    sort_order — name, price, photo, hook, highlight, availability and
--    is_active are left exactly as they are on the server, which is the whole
--    point: a reorder can no longer carry a stale copy of the rest of the row.
-- ---------------------------------------------------------------------------
create or replace function app.reorder_menu_items(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $reorder_items$
declare
  v_expected int := coalesce(array_length(p_ids, 1), 0);
  v_found    int;
  v_before   jsonb;
  v_after    jsonb;
  v_entity   text;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_expected = 0 then
    return 0;
  end if;

  -- A duplicated id would give two rows the same position and make the result
  -- depend on tie-breaking; refuse rather than reorder unpredictably.
  if v_expected <> (select count(distinct id) from unnest(p_ids) as id) then
    raise exception 'DUPLICATE_ID' using errcode = 'P0001',
      hint = 'each item may appear once in the ordering';
  end if;

  -- Lock the whole set first so two managers reordering the same category
  -- serialize instead of interleaving.
  perform 1 from menu_items where id = any(p_ids) order by id for update;

  select count(*) into v_found from menu_items where id = any(p_ids);
  if v_found <> v_expected then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001',
      detail = format('%s of %s ids exist', v_found, v_expected);
  end if;

  select jsonb_agg(jsonb_build_object('id', mi.id, 'sort_order', mi.sort_order) order by mi.sort_order)
    into v_before
    from menu_items mi where mi.id = any(p_ids);

  update menu_items mi
     set sort_order = ord.pos
    from (select id, (ordinality - 1)::int as pos
            from unnest(p_ids) with ordinality as t(id, ordinality)) ord
   where mi.id = ord.id
     and mi.sort_order is distinct from ord.pos;

  select jsonb_agg(jsonb_build_object('id', mi.id, 'sort_order', mi.sort_order) order by mi.sort_order)
    into v_after
    from menu_items mi where mi.id = any(p_ids);

  -- audit_log.entity_id is NOT NULL (0005:16), and a batch still has an entity:
  -- the category whose ordering changed. The operator reorders within one
  -- category, so this is normally a real id; 'multiple' is the honest answer
  -- when a caller spans categories rather than a fabricated one.
  -- min() has no uuid overload in Postgres; cast first.
  select case when count(distinct mi.category_id) = 1
              then min(mi.category_id::text)
              else 'multiple' end
    into v_entity
    from menu_items mi where mi.id = any(p_ids);

  perform app.write_audit('menu.item.reorder', 'menu_items', v_entity, v_before, v_after);
  return v_expected;
end $reorder_items$;

revoke all on function app.reorder_menu_items(uuid[]) from public, anon;
grant execute on function app.reorder_menu_items(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.reorder_menu_categories(uuid[]) — same contract, same reasoning.
-- ---------------------------------------------------------------------------
create or replace function app.reorder_menu_categories(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $reorder_cats$
declare
  v_expected int := coalesce(array_length(p_ids, 1), 0);
  v_found    int;
  v_before   jsonb;
  v_after    jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_expected = 0 then
    return 0;
  end if;

  if v_expected <> (select count(distinct id) from unnest(p_ids) as id) then
    raise exception 'DUPLICATE_ID' using errcode = 'P0001',
      hint = 'each category may appear once in the ordering';
  end if;

  perform 1 from menu_categories where id = any(p_ids) order by id for update;

  select count(*) into v_found from menu_categories where id = any(p_ids);
  if v_found <> v_expected then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001',
      detail = format('%s of %s ids exist', v_found, v_expected);
  end if;

  select jsonb_agg(jsonb_build_object('id', mc.id, 'sort_order', mc.sort_order) order by mc.sort_order)
    into v_before
    from menu_categories mc where mc.id = any(p_ids);

  update menu_categories mc
     set sort_order = ord.pos
    from (select id, (ordinality - 1)::int as pos
            from unnest(p_ids) with ordinality as t(id, ordinality)) ord
   where mc.id = ord.id
     and mc.sort_order is distinct from ord.pos;

  select jsonb_agg(jsonb_build_object('id', mc.id, 'sort_order', mc.sort_order) order by mc.sort_order)
    into v_after
    from menu_categories mc where mc.id = any(p_ids);

  -- Category ordering is venue-wide, so the entity is the menu itself.
  -- audit_log.entity_id is NOT NULL (0005:16).
  perform app.write_audit('menu.category.reorder', 'menu_categories', 'all', v_before, v_after);
  return v_expected;
end $reorder_cats$;

revoke all on function app.reorder_menu_categories(uuid[]) from public, anon;
grant execute on function app.reorder_menu_categories(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.reorder_modifiers(uuid[])
--
--    Same defect as the two above, and the sharpest edge of it: the row the
--    old client re-sent carried `price_delta_iqd`, so reordering add-on
--    options could silently revert a colleague’s price change (money, from a
--    stale cache). Positions are assigned within the ids given, which is one
--    modifier group in the operator UI.
-- ---------------------------------------------------------------------------
create or replace function app.reorder_modifiers(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $reorder_mods$
declare
  v_expected int := coalesce(array_length(p_ids, 1), 0);
  v_found    int;
  v_before   jsonb;
  v_after    jsonb;
  v_entity   text;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_expected = 0 then
    return 0;
  end if;

  if v_expected <> (select count(distinct id) from unnest(p_ids) as id) then
    raise exception 'DUPLICATE_ID' using errcode = 'P0001',
      hint = 'each option may appear once in the ordering';
  end if;

  perform 1 from modifiers where id = any(p_ids) order by id for update;

  select count(*) into v_found from modifiers where id = any(p_ids);
  if v_found <> v_expected then
    raise exception 'MODIFIER_NOT_FOUND' using errcode = 'P0001',
      detail = format('%s of %s ids exist', v_found, v_expected);
  end if;

  select jsonb_agg(jsonb_build_object('id', m.id, 'sort_order', m.sort_order) order by m.sort_order)
    into v_before
    from modifiers m where m.id = any(p_ids);

  update modifiers m
     set sort_order = ord.pos
    from (select id, (ordinality - 1)::int as pos
            from unnest(p_ids) with ordinality as t(id, ordinality)) ord
   where m.id = ord.id
     and m.sort_order is distinct from ord.pos;

  select jsonb_agg(jsonb_build_object('id', m.id, 'sort_order', m.sort_order) order by m.sort_order)
    into v_after
    from modifiers m where m.id = any(p_ids);

  -- The entity whose ordering changed is the group. audit_log.entity_id is
  -- NOT NULL (0005:16); min() has no uuid overload, so cast first.
  select case when count(distinct m.group_id) = 1
              then min(m.group_id::text)
              else 'multiple' end
    into v_entity
    from modifiers m where m.id = any(p_ids);

  perform app.write_audit('menu.modifier.reorder', 'modifiers', v_entity, v_before, v_after);
  return v_expected;
end $reorder_mods$;

revoke all on function app.reorder_modifiers(uuid[]) from public, anon;
grant execute on function app.reorder_modifiers(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.set_cafe_settings(jsonb)
--
--    Apply a whole {key: value} object atomically. Delegates each key to
--    app.set_cafe_setting so the registry lookup, the per-key min_role check,
--    the value validation and the per-key audit row all stay in exactly one
--    place — this adds transactionality, not a second code path.
--
--    Keys are applied in sorted order so two stations writing overlapping sets
--    take row locks in the same order and cannot deadlock.
-- ---------------------------------------------------------------------------
create or replace function app.set_cafe_settings(p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $set_settings$
declare
  v_key    text;
  v_result jsonb := '[]'::jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'INVALID_SETTINGS' using errcode = 'P0001',
      hint = 'expected a JSON object of {key: value}';
  end if;

  -- An empty object is a no-op, not an error: the hero builder computes its
  -- diff client-side and may legitimately find nothing changed.
  for v_key in select k from jsonb_object_keys(p_settings) k order by k loop
    v_result := v_result || jsonb_build_array(
      app.set_cafe_setting(v_key, p_settings -> v_key)
    );
  end loop;

  return v_result;
end $set_settings$;

revoke all on function app.set_cafe_settings(jsonb) from public, anon;
grant execute on function app.set_cafe_settings(jsonb) to authenticated;
