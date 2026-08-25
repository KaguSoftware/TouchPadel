-- 0027_menu_extensions — cafe-rebuild wave 1: menu content extensions.
-- Additive on 0001–0026 (hosted is production: no table/column drops, no enum
-- edits). Every new NOT NULL column carries a default.
--
--  1. menu_items gains hook_en/hook_ar (bilingual one-line "hook" chip, both or
--     neither), highlight ('none'|'blue'|'brown' brand tint), sold_out (sticky
--     flag, unlike the auto-restoring 86 in unavailable_on) and photo_blur (tiny
--     data-URI / blurhash placeholder). menu_categories gains photo_path +
--     photo_blur.
--  2. Unit cost lives in a SEPARATE table, menu_item_costs (item_id PK, NULL =
--     no row = unknown), readable by manager|owner only through RLS. A cost
--     column on menu_items would need column-level grants, which break every
--     `select *` on menu_items (web fetchMenu, MenuEditor, the RLS-matrix
--     `select menu_items` rule) — a separate table keeps menu_items fully
--     selectable and lets plain RLS express "staff only".
--  3. Photo-wipe bug (db-slice "Key architectural calls"): app.upsert_menu_item
--     no longer takes p_photo_path and NEVER touches photo_path / photo_blur /
--     sold_out. Dedicated, audited setters own those columns:
--     set_item_photo, set_category_photo, set_item_sold_out, set_item_cost.
--     The old overload is DROPPED (0026 precedent) so PostgREST calls stay
--     unambiguous.
--  4. app.is_media_path(text) — shared storage-key validator (items/, categories/,
--     hero/ prefixes; also used by the hero settings in 0029).
--  5. app.menu_availability() re-created in FULL (0025 body) with
--     `and not mi.sold_out`; the menu_item_availability view is untouched
--     (same columns, still points at the function).
--
-- Conventions: definer + pinned search_path, role guard first, every error is
-- `raise exception '<CODE>' using errcode = 'P0001'`, audit via app.write_audit.

-- ---------------------------------------------------------------------------
-- 1. Columns + named constraints
-- ---------------------------------------------------------------------------
alter table menu_items
  add column if not exists hook_en    text    not null default '',
  add column if not exists hook_ar    text    not null default '',
  add column if not exists highlight  text    not null default 'none',
  add column if not exists sold_out   boolean not null default false,
  add column if not exists photo_blur text;                 -- <= 400 chars (constraint below)

alter table menu_categories
  add column if not exists photo_path text,
  add column if not exists photo_blur text;

-- `add constraint` has no IF NOT EXISTS; guard by name so re-runs no-op.
do $ddl_0027_constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_highlight_chk') then
    alter table menu_items
      add constraint menu_items_highlight_chk check (highlight in ('none','blue','brown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_items_hook_pair_chk') then
    alter table menu_items
      add constraint menu_items_hook_pair_chk check ((hook_en = '') = (hook_ar = ''));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_items_photo_blur_len') then
    alter table menu_items
      add constraint menu_items_photo_blur_len
        check (photo_blur is null or length(photo_blur) <= 400);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_categories_photo_blur_len') then
    alter table menu_categories
      add constraint menu_categories_photo_blur_len
        check (photo_blur is null or length(photo_blur) <= 400);
  end if;
end $ddl_0027_constraints$;

comment on column menu_items.hook_en is
  'One-line hook shown under the name (<= 80 chars, set via app.upsert_menu_item). Empty in both languages or in neither.';
comment on column menu_items.highlight is
  'Brand tint for the item card: none | blue (#3360AB) | brown (#603813).';
comment on column menu_items.sold_out is
  'Sticky sold-out flag (app.set_item_sold_out). Unlike unavailable_on (the 86, auto-restores tomorrow) it stays until cleared; the guest menu still renders the item with a stamp and app.menu_availability() reports orderable = false.';
comment on column menu_items.photo_blur is
  'Tiny placeholder (data-URI / blurhash, <= 400 chars) shown while the photo loads. Written only by app.set_item_photo.';

-- ---------------------------------------------------------------------------
-- 2. menu_item_costs — unit cost per item, staff-only (manager|owner).
--    No row = unknown. RPC-only writes (app.set_item_cost).
-- ---------------------------------------------------------------------------
create table if not exists menu_item_costs (
  item_id    uuid primary key references menu_items(id) on delete cascade,
  cost_iqd   iqd not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id)
);

comment on column menu_item_costs.cost_iqd is
  'Owner-entered unit cost in IQD. A missing row means "not entered": margin math drops the item and reports coverage. Never treat a missing cost as zero.';

alter table menu_item_costs enable row level security;

grant select on menu_item_costs to authenticated;

do $ddl_0027_cost_policy$
begin
  create policy menu_item_costs_mgmt_read on menu_item_costs for select to authenticated
    using (app.is_staff('manager','owner'));
exception when duplicate_object then null;
end $ddl_0027_cost_policy$;
-- anon: no grant; guests / cashier / prep / court_desk: grant but the policy
-- yields silence. No INSERT/UPDATE/DELETE grant or policy for any client.

-- ---------------------------------------------------------------------------
-- 3. app.is_media_path — storage-key validator shared by item / category
--    photos (here) and the hero media setting (0029).
--    Segments may contain dots and hyphens (uuids / ulids), but no segment may
--    be empty or start with a dot (blocks `..` traversal and hidden files).
--    Granted to clients deliberately: it is a pure regex, and a future RLS /
--    storage policy evaluated as anon/authenticated must be able to call it
--    (0025 lesson: EXECUTE is checked against the session role).
-- ---------------------------------------------------------------------------
create or replace function app.is_media_path(p text) returns boolean
language sql immutable set search_path = public as $fn_is_media_path$
  select p is not null
     and p ~ '^(items|categories|hero)/[A-Za-z0-9][A-Za-z0-9/_.-]{0,180}\.(webp|jpe?g|png|mp4|webm)$'
     and p !~ '//'
     and p !~ '/\.'
$fn_is_media_path$;

revoke all on function app.is_media_path(text) from public;
grant execute on function app.is_media_path(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.menu_availability — FULL 0025 body + `and not mi.sold_out`.
--    Same signature / return type, so the menu_item_availability view (0025)
--    keeps pointing at it unchanged. Grants re-issued for clarity.
-- ---------------------------------------------------------------------------
create or replace function app.menu_availability()
returns table (item_id uuid, orderable boolean)
language sql stable security definer set search_path = public as $fn_menu_availability$
  select mi.id as item_id,
         mi.is_active and coalesce(mi.unavailable_on <> current_date, true)
           and not mi.sold_out
           and not exists (
             select 1 from app.item_required_ingredients(mi.id) ri
             where app.ingredient_on_hand(ri.ingredient_id) <= 0
           ) as orderable
    from menu_items mi
$fn_menu_availability$;

revoke all on function app.menu_availability() from public;
grant execute on function app.menu_availability() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.upsert_menu_item — NEW SIGNATURE (p_photo_path removed; hook /
--    highlight appended). The 0013 overload is dropped first: leaving it would
--    make the RPC ambiguous for PostgREST (0026 precedent).
--    NEVER touches photo_path, photo_blur, sold_out (dedicated setters below).
-- ---------------------------------------------------------------------------
drop function if exists app.upsert_menu_item(uuid, text, text, uuid, text, text, text, int, boolean);

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
  p_highlight      text default 'none'
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
                            sort_order, is_active, hook_en, hook_ar, highlight)
    values (p_category_id, p_name_en, p_name_ar, p_description_en, p_description_ar,
            p_sort_order, p_is_active, v_hook_en, v_hook_ar, p_highlight)
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
           hook_en = v_hook_en, hook_ar = v_hook_ar, highlight = p_highlight
           -- photo_path / photo_blur / sold_out deliberately NOT here.
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.item.update', 'menu_items', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $fn_upsert_menu_item$;

revoke all on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text) from public, anon;
grant execute on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.set_item_photo — the ONLY writer of menu_items.photo_path/photo_blur.
--    NULL path clears both. Deleting the previous storage object is the
--    operator app's job after this succeeds (SQL never touches storage.objects).
-- ---------------------------------------------------------------------------
create or replace function app.set_item_photo(
  p_item_id    uuid,
  p_photo_path text,
  p_photo_blur text default null
) returns void
language plpgsql security definer set search_path = public as $fn_set_item_photo$
declare
  v_before jsonb;
  v_row    menu_items%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_photo_path is not null
     and not (app.is_media_path(p_photo_path) and p_photo_path like 'items/%') then
    raise exception 'INVALID_PHOTO_PATH' using errcode = 'P0001',
      hint = 'expected items/<...>.(webp|jpg|jpeg|png|mp4|webm)';
  end if;
  if p_photo_path is not null and length(coalesce(p_photo_blur, '')) > 400 then
    raise exception 'PHOTO_BLUR_TOO_LONG' using errcode = 'P0001';
  end if;

  select * into v_row from menu_items where id = p_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  update menu_items
     set photo_path = p_photo_path,
         photo_blur = case when p_photo_path is null then null else p_photo_blur end
   where id = p_item_id
   returning * into v_row;

  perform app.write_audit('menu.item.photo', 'menu_items', v_row.id::text,
                          v_before, to_jsonb(v_row));
end $fn_set_item_photo$;

revoke all on function app.set_item_photo(uuid, text, text) from public, anon;
grant execute on function app.set_item_photo(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.set_category_photo — same contract for menu_categories (prefix
--    categories/). app.upsert_menu_category is untouched and never sees photos.
-- ---------------------------------------------------------------------------
create or replace function app.set_category_photo(
  p_category_id uuid,
  p_photo_path  text,
  p_photo_blur  text default null
) returns void
language plpgsql security definer set search_path = public as $fn_set_category_photo$
declare
  v_before jsonb;
  v_row    menu_categories%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_photo_path is not null
     and not (app.is_media_path(p_photo_path) and p_photo_path like 'categories/%') then
    raise exception 'INVALID_PHOTO_PATH' using errcode = 'P0001',
      hint = 'expected categories/<...>.(webp|jpg|jpeg|png|mp4|webm)';
  end if;
  if p_photo_path is not null and length(coalesce(p_photo_blur, '')) > 400 then
    raise exception 'PHOTO_BLUR_TOO_LONG' using errcode = 'P0001';
  end if;

  select * into v_row from menu_categories where id = p_category_id for update;
  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  update menu_categories
     set photo_path = p_photo_path,
         photo_blur = case when p_photo_path is null then null else p_photo_blur end
   where id = p_category_id
   returning * into v_row;

  perform app.write_audit('menu.category.photo', 'menu_categories', v_row.id::text,
                          v_before, to_jsonb(v_row));
end $fn_set_category_photo$;

revoke all on function app.set_category_photo(uuid, text, text) from public, anon;
grant execute on function app.set_category_photo(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.set_item_sold_out — sticky sold-out toggle (see column comment).
-- ---------------------------------------------------------------------------
create or replace function app.set_item_sold_out(
  p_item_id  uuid,
  p_sold_out boolean
) returns void
language plpgsql security definer set search_path = public as $fn_set_item_sold_out$
declare
  v_before jsonb;
  v_row    menu_items%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_sold_out is null then
    raise exception 'INVALID_SOLD_OUT' using errcode = 'P0001',
      hint = 'p_sold_out must be true or false';
  end if;

  select * into v_row from menu_items where id = p_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  update menu_items
     set sold_out = p_sold_out
   where id = p_item_id
   returning * into v_row;

  perform app.write_audit('menu.item.sold_out', 'menu_items', v_row.id::text,
                          v_before, to_jsonb(v_row));
end $fn_set_item_sold_out$;

revoke all on function app.set_item_sold_out(uuid, boolean) from public, anon;
grant execute on function app.set_item_sold_out(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.set_item_cost — the ONLY writer of menu_item_costs.
--    NULL = "unknown" = delete the row (never coerced to 0).
-- ---------------------------------------------------------------------------
create or replace function app.set_item_cost(
  p_item_id  uuid,
  p_cost_iqd bigint
) returns void
language plpgsql security definer set search_path = public as $fn_set_item_cost$
declare
  v_before jsonb;
  v_row    menu_item_costs%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cost_iqd is not null and p_cost_iqd < 0 then
    raise exception 'INVALID_COST' using errcode = 'P0001';
  end if;
  if not exists (select 1 from menu_items where id = p_item_id) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select to_jsonb(c) into v_before from menu_item_costs c where c.item_id = p_item_id for update;

  if p_cost_iqd is null then
    delete from menu_item_costs where item_id = p_item_id;
    perform app.write_audit('menu.item.cost', 'menu_item_costs', p_item_id::text,
                            v_before, null);
  else
    insert into menu_item_costs (item_id, cost_iqd, updated_at, updated_by)
    values (p_item_id, p_cost_iqd, now(), auth.uid())
    on conflict (item_id) do update
      set cost_iqd = excluded.cost_iqd, updated_at = now(), updated_by = auth.uid()
    returning * into v_row;
    perform app.write_audit('menu.item.cost', 'menu_item_costs', p_item_id::text,
                            v_before, to_jsonb(v_row));
  end if;
end $fn_set_item_cost$;

revoke all on function app.set_item_cost(uuid, bigint) from public, anon;
grant execute on function app.set_item_cost(uuid, bigint) to authenticated;
