-- 0054_menu_serve_temp — the menu design's serve-temperature chip (حار / بارد).
--
-- The Touch Cafe menu design tags a drink as served hot, cold, or both; the
-- guest menu paints that as a red "حار" and/or a blue "بارد" pill beside the
-- item name. Nothing in 0013–0053 could express it: `allergens` is the only
-- chip mechanism and it means something else entirely (a dietary warning that
-- also drives the item sheet's allergen list), so overloading it would put
-- "hot" in the allergen editor and in every allergen read.
--
-- Serve temperature is a property OF THE ITEM with exactly four states, so it
-- is one column, not a join table: an item is served hot, cold, both, or the
-- question does not apply (cakes, snacks).
--
-- Additive on hosted production: new NOT NULL column carries a default, so
-- every existing row lands on 'none' and no read breaks.
--
-- app.upsert_menu_item gains p_serve_temp. Per the 0027 precedent the previous
-- overload is DROPPED rather than left beside the new one — two candidates with
-- the same name make every PostgREST call ambiguous.
--
-- p_serve_temp defaults to NULL meaning "leave unchanged", NOT to 'none'. The
-- operator's menu editor re-sends each ENTIRE row on every edit (menuLogic.ts),
-- so a param defaulting to 'none' would silently clear the chip on any unrelated
-- edit made by a client that has not been taught the new field — the photo-wipe
-- bug 0027 fixed, re-introduced. NULL on insert means 'none'.

-- ---------------------------------------------------------------------------
-- 1. Column + named constraint (guarded, so a re-run no-ops)
-- ---------------------------------------------------------------------------
alter table menu_items
  add column if not exists serve_temp text not null default 'none';

do $ddl_0054_constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_serve_temp_chk') then
    alter table menu_items
      add constraint menu_items_serve_temp_chk
        check (serve_temp in ('none','hot','cold','both'));
  end if;
end $ddl_0054_constraints$;

comment on column menu_items.serve_temp is
  'Serve temperature chip on the guest menu: none | hot | cold | both.';

-- ---------------------------------------------------------------------------
-- 2. app.upsert_menu_item — same body as 0027 plus serve_temp.
-- ---------------------------------------------------------------------------
create or replace function app.upsert_menu_item(
  p_category_id    uuid,
  p_name_en        text,
  p_name_ar        text,
  p_id             uuid default null,
  p_description_en text default null,
  p_description_ar text default null,
  p_sort_order     int default 0,
  p_is_active      boolean default true,
  p_hook_en        text default '',
  p_hook_ar        text default '',
  p_highlight      text default 'none',
  p_serve_temp     text default null   -- null = leave unchanged (insert: 'none')
) returns uuid
language plpgsql security definer set search_path = public as $fn_upsert_menu_item$
declare
  v_before  jsonb;
  v_row     menu_items%rowtype;
  v_hook_en text := btrim(coalesce(p_hook_en, ''));
  v_hook_ar text := btrim(coalesce(p_hook_ar, ''));
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from menu_categories where id = p_category_id) then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_highlight is null or p_highlight not in ('none','blue','brown') then
    raise exception 'INVALID_HIGHLIGHT' using errcode = 'P0001',
      hint = 'highlight must be one of none, blue, brown';
  end if;
  if p_serve_temp is not null and p_serve_temp not in ('none','hot','cold','both') then
    raise exception 'INVALID_SERVE_TEMP' using errcode = 'P0001',
      hint = 'serve_temp must be one of none, hot, cold, both';
  end if;
  if length(v_hook_en) > 80 or length(v_hook_ar) > 80 then
    raise exception 'HOOK_TOO_LONG' using errcode = 'P0001',
      hint = 'hook_en / hook_ar are limited to 80 characters each';
  end if;
  if (v_hook_en = '') <> (v_hook_ar = '') then
    raise exception 'HOOK_PAIR_MISMATCH' using errcode = 'P0001',
      hint = 'provide the hook in both languages or in neither';
  end if;

  if p_id is null then
    insert into menu_items (category_id, name_en, name_ar, description_en, description_ar,
                            sort_order, is_active, hook_en, hook_ar, highlight, serve_temp)
    values (p_category_id, p_name_en, p_name_ar, p_description_en, p_description_ar,
            p_sort_order, p_is_active, v_hook_en, v_hook_ar, p_highlight,
            coalesce(p_serve_temp, 'none'))
    returning * into v_row;
    perform app.write_audit('menu.item.create', 'menu_items', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_items where id = p_id for update;
    if not found then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update menu_items
       set category_id = p_category_id, name_en = p_name_en, name_ar = p_name_ar,
           description_en = p_description_en, description_ar = p_description_ar,
           sort_order = p_sort_order, is_active = p_is_active,
           hook_en = v_hook_en, hook_ar = v_hook_ar, highlight = p_highlight,
           serve_temp = coalesce(p_serve_temp, v_row.serve_temp)
           -- photo_path / photo_blur / sold_out deliberately NOT here.
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.item.update', 'menu_items', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $fn_upsert_menu_item$;

-- Drop the 0027 overload (11 args) so the 12-arg one is the only candidate.
drop function if exists app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text);

revoke all on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) from public, anon;
grant execute on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. menu_categories.serve_temp — the design badges a WHOLE section too
--    ("سموذي  بارد"), not only single rows, so the category carries the same
--    four states. Items in such a section keep serve_temp='none': the badge is
--    stated once on the heading rather than repeated on every row.
-- ---------------------------------------------------------------------------
alter table menu_categories
  add column if not exists serve_temp text not null default 'none';

do $ddl_0054_cat_constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_categories_serve_temp_chk') then
    alter table menu_categories
      add constraint menu_categories_serve_temp_chk
        check (serve_temp in ('none','hot','cold','both'));
  end if;
end $ddl_0054_cat_constraints$;

comment on column menu_categories.serve_temp is
  'Serve-temperature badge on the section heading: none | hot | cold | both.';

create or replace function app.upsert_menu_category(
  p_name_en      text,
  p_name_ar      text,
  p_tax_group_id uuid,
  p_id           uuid default null,
  p_sort_order   int default 0,
  p_is_active    boolean default true,
  p_serve_temp   text default null   -- null = leave unchanged (insert: 'none')
) returns uuid
language plpgsql security definer set search_path = public as $fn_upsert_menu_category$
declare
  v_before jsonb;
  v_row    menu_categories%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tax_groups where id = p_tax_group_id) then
    raise exception 'TAX_GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_serve_temp is not null and p_serve_temp not in ('none','hot','cold','both') then
    raise exception 'INVALID_SERVE_TEMP' using errcode = 'P0001',
      hint = 'serve_temp must be one of none, hot, cold, both';
  end if;

  if p_id is null then
    insert into menu_categories (name_en, name_ar, tax_group_id, sort_order, is_active, serve_temp)
    values (p_name_en, p_name_ar, p_tax_group_id, p_sort_order, p_is_active,
            coalesce(p_serve_temp, 'none'))
    returning * into v_row;
    perform app.write_audit('menu.category.create', 'menu_categories', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_categories where id = p_id for update;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_before := to_jsonb(v_row);
    update menu_categories
       set name_en = p_name_en, name_ar = p_name_ar, tax_group_id = p_tax_group_id,
           sort_order = p_sort_order, is_active = p_is_active,
           serve_temp = coalesce(p_serve_temp, v_row.serve_temp)
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.category.update', 'menu_categories', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $fn_upsert_menu_category$;

-- Drop the 0013 overload (6 args) so the 7-arg one is the only candidate.
drop function if exists app.upsert_menu_category(text, text, uuid, uuid, int, boolean);

revoke all on function app.upsert_menu_category(text, text, uuid, uuid, int, boolean, text) from public, anon;
grant execute on function app.upsert_menu_category(text, text, uuid, uuid, int, boolean, text) to authenticated;
