-- 0246 shop_products — the shop assistant keeps the shop's own product list:
-- shop categories, products, sizes, prices and suppliers; and the day close
-- gets a Shop block.
--
-- Feature: Touch Shop, own desk (Parsa, 2026-09-27; docs/design/shop/
-- shop-desk-2026-09-27.md). Depends on: shop_desk_enums (0243),
-- shop_desk_access (0244), shop_store (0245).
-- Re-runnable: create or replace.
--
-- PRODUCTS. Parsa's answer: the shop assistant adds and edits shop products
-- AND their prices on their own. upsert_menu_item, upsert_variant and
-- upsert_retail_variant admit shop_staff for items in a 'shop' category only
-- (FORBIDDEN hint category otherwise). The manager-only rules
-- (ITEM_VIA_RELEASE, LAUNCH_VIA_PROTOCOL, PRICE_VIA_PROTOCOL) name the
-- manager role and so do not reach the shop assistant: a shop product goes on
-- sale and changes price directly, as the owner's do. This is deliberate and
-- scoped to the shop; a café price still goes through its protocol.
--
-- CATEGORIES. app.upsert_shop_category (new) creates and edits the shop's own
-- sections (Rackets, Balls, Accessories…) as kind 'shop' from the shop side,
-- so nobody opens the café menu editor for the shop. It never touches a café
-- category.
--
-- SUPPLIERS. upsert_supplier admits shop_staff.
--
-- DAY CLOSE. app.day_close_shop (new, read): the shop's sales by method,
-- refunds, net and open sales for a business day, and the shifts of the
-- shop stations (mode 'shop'). The one venue close stays close_day's.
--
-- Every re-issued body is the latest one, verbatim, plus the marked 0246
-- changes.
--
-- covered by packages/db/tests/shop-desk.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0. app.upsert_shop_category — the shop's own sections.
-- ---------------------------------------------------------------------------
create or replace function app.upsert_shop_category(
  p_name_en      text,
  p_name_ar      text,
  p_tax_group_id uuid,
  p_id           uuid default null,
  p_sort_order   int default 0,
  p_is_active    boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_shop_category_0246$
declare
  v_before jsonb;
  v_row    menu_categories%rowtype;
begin
  if not app.is_staff('shop_staff','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_name_en), '') is null or nullif(btrim(p_name_ar), '') is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'name';
  end if;
  if not exists (select 1 from tax_groups where id = p_tax_group_id) then
    raise exception 'TAX_GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into menu_categories (name_en, name_ar, tax_group_id, sort_order, is_active, serve_temp, kind)
    values (btrim(p_name_en), btrim(p_name_ar), p_tax_group_id, coalesce(p_sort_order, 0),
            coalesce(p_is_active, true), 'none', 'shop')
    returning * into v_row;
    perform app.write_audit('menu.category.create', 'menu_categories', v_row.id::text,
                            null, to_jsonb(v_row));
  else
    select * into v_row from menu_categories where id = p_id for update;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_row.venue_id is distinct from app.current_venue()
       and not app.is_staff_at(v_row.venue_id, 'shop_staff','manager','owner') then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_row.kind <> 'shop' then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'category';
    end if;
    perform set_config('app.venue_id', v_row.venue_id::text, true);
    v_before := to_jsonb(v_row);
    update menu_categories
       set name_en = btrim(p_name_en), name_ar = btrim(p_name_ar), tax_group_id = p_tax_group_id,
           sort_order = coalesce(p_sort_order, v_row.sort_order),
           is_active = coalesce(p_is_active, v_row.is_active)
     where id = p_id
     returning * into v_row;
    perform app.write_audit('menu.category.update', 'menu_categories', v_row.id::text,
                            v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $upsert_shop_category_0246$;

comment on function app.upsert_shop_category(text, text, uuid, uuid, int, boolean) is
  '0246 (Touch Shop own desk). The shop assistant, manager or owner: creates a shop section (menu_categories.kind = shop) or edits one; never a cafe category (FORBIDDEN hint category). Returns the id. FORBIDDEN, INVALID_ARGUMENT (hint name), TAX_GROUP_NOT_FOUND, CATEGORY_NOT_FOUND. Audit menu.category.create / menu.category.update.';

revoke all on function app.upsert_shop_category(text, text, uuid, uuid, int, boolean) from public, anon;
grant execute on function app.upsert_shop_category(text, text, uuid, uuid, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. app.upsert_menu_item — re-issued from 20260925000172_product_release.sql:623
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
language plpgsql security definer set search_path = public as $upsert_menu_item_0246$
declare
  v_item       menu_items%rowtype;
  v_run_status text;
  v_new_kind   text;
  v_old_kind   text;
begin
  if not app.is_staff('manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0246: the shop assistant keeps shop products only — the category it
  -- saves into and, for an existing item, the one it is in, are both shop.
  if app.staff_role() = 'shop_staff' then
    if not exists (select 1 from menu_categories c where c.id = p_category_id and c.kind = 'shop')
       or (p_id is not null and not exists (
             select 1 from menu_items mi join menu_categories c on c.id = mi.category_id
              where mi.id = p_id and c.kind = 'shop')) then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'category';
    end if;
  end if;

  if p_id is not null then
    select * into v_item from menu_items where id = p_id;
    if found and v_item.release_run_id is not null then
      select r.status into v_run_status from protocol_runs r where r.id = v_item.release_run_id;
      if v_run_status not in ('live', 'done')
         and (coalesce(p_is_active, false)
              or (p_category_id is distinct from v_item.category_id
                  and exists (select 1 from menu_categories c
                               where c.id = p_category_id and c.kind <> 'cafe'))) then
        raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- A shop product moved into a cafe category is a new menu item there,
  -- whether or not it was launched as a product (#52).
  if app.staff_role() = 'manager' and v_item.id is not null
     and p_category_id is distinct from v_item.category_id
     and exists (select 1 from menu_categories c where c.id = v_item.category_id and c.kind = 'shop')
     and exists (select 1 from menu_categories c where c.id = p_category_id and c.kind = 'cafe') then
    raise exception 'ITEM_VIA_RELEASE' using errcode = 'P0001';
  end if;

  -- A draft: never launched, switched off, not in a release.
  if app.staff_role() = 'manager'
     and (p_id is null
          or (v_item.id is not null and v_item.launched_at is null and not v_item.is_active
              and v_item.release_run_id is null)) then
    select c.kind into v_new_kind from menu_categories c where c.id = p_category_id;
    if v_item.id is not null then
      select c.kind into v_old_kind from menu_categories c where c.id = v_item.category_id;
    end if;
    if v_new_kind = 'cafe'
       and (p_id is null or coalesce(p_is_active, false) or v_old_kind = 'shop') then
      raise exception 'ITEM_VIA_RELEASE' using errcode = 'P0001';
    end if;
    if v_new_kind = 'shop' and coalesce(p_is_active, false) then
      raise exception 'LAUNCH_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
  end if;

  return app.upsert_menu_item_internal(p_category_id, p_name_en, p_name_ar, p_id,
                                       p_description_en, p_description_ar, p_sort_order,
                                       p_is_active, p_hook_en, p_hook_ar, p_highlight,
                                       p_serve_temp);
end $upsert_menu_item_0246$;

comment on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) is
  'Manager or owner, or the shop assistant for shop products only (0246; FORBIDDEN hint category otherwise, and none of the manager rules below reach them): creates or updates a menu item or shop product (0054; a wrapper over app.upsert_menu_item_internal since product_release). ITEM_IN_RELEASE, for everyone, on switching on an item whose product release is not live or done, or moving it into a category that is not a cafe one. For a manager: ITEM_VIA_RELEASE on any item moved from a shop category into a cafe one; and on a new item or a draft (never launched, switched off, not in release), ITEM_VIA_RELEASE for a new cafe item or a cafe draft switched on, LAUNCH_VIA_PROTOCOL for a shop product saved switched on. CATEGORY_NOT_FOUND, ITEM_NOT_FOUND, INVALID_HIGHLIGHT, INVALID_SERVE_TEMP, HOOK_TOO_LONG, HOOK_PAIR_MISMATCH.';

revoke all on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) from public, anon;
grant execute on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.upsert_variant — re-issued from 20260926000195_price_promo_renames.sql:63
-- ---------------------------------------------------------------------------
create or replace function app.upsert_variant(
  p_item_id    uuid,
  p_name_en    text,
  p_name_ar    text,
  p_price_iqd  bigint,
  p_id         uuid default null,
  p_is_default boolean default false,
  p_sort_order int default 0
) returns uuid
language plpgsql security definer set search_path = public as $upsert_variant_0246$
declare
  v_run_status text;
  v_price      bigint;
  v_item       menu_items%rowtype;
  v_name_en    text;
  v_name_ar    text;
begin
  if not app.is_staff('manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_item from menu_items where id = p_item_id for update;
  -- 0246: the shop assistant prices and names shop sizes only; the manager's
  -- price-change rule below names the manager, so a shop price is set directly.
  if app.staff_role() = 'shop_staff'
     and not exists (select 1 from menu_categories c where c.id = v_item.category_id and c.kind = 'shop') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'category';
  end if;
  if v_item.release_run_id is not null then
    select r.status into v_run_status from protocol_runs r where r.id = v_item.release_run_id;
  end if;
  if v_run_status is not null and v_run_status not in ('live', 'done') then
    if p_id is null then
      raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
    end if;
    select v.price_iqd into v_price
      from menu_item_variants v
     where v.id = p_id and v.item_id = p_item_id;
    -- A size that is not there falls through to VARIANT_NOT_FOUND.
    if found and p_price_iqd is distinct from v_price then
      raise exception 'ITEM_IN_RELEASE' using errcode = 'P0001';
    end if;
  end if;

  -- The size lock (#41, #51): a manager's price goes through a price change,
  -- and so does a manager's new name (#9): the price first, with no hint, then
  -- the name, hint name. Surrounding whitespace is not a rename; a case change
  -- is.
  if app.staff_role() = 'manager' then
    if v_item.id is not null and (v_item.launched_at is not null or v_item.is_active) then
      if p_id is null then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
      select v.price_iqd, v.name_en, v.name_ar into v_price, v_name_en, v_name_ar
        from menu_item_variants v
       where v.id = p_id and v.item_id = p_item_id;
      if found and p_price_iqd is distinct from v_price then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
      end if;
      if found and (btrim(p_name_en) is distinct from btrim(v_name_en)
                    or btrim(p_name_ar) is distinct from btrim(v_name_ar)) then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', hint = 'name';
      end if;
    end if;
  end if;

  return app.upsert_variant_internal(p_item_id, p_name_en, p_name_ar, p_price_iqd,
                                     p_id, p_is_default, p_sort_order);
end $upsert_variant_0246$;

comment on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) is
  'Manager or owner, or the shop assistant for shop sizes only (0246; FORBIDDEN hint category otherwise; PRICE_VIA_PROTOCOL does not reach them): creates or updates one size of a menu item or shop product (0013; a wrapper over app.upsert_variant_internal since product_release). ITEM_IN_RELEASE, for everyone, on a new size or a price change of an item whose product release is not live or done: its prices come from the price step. PRICE_VIA_PROTOCOL (price_promo, #51), for a manager, on a new size or a price change of any item that is not a draft (launched_at set, or switched on), cafe or shop, including through app.upsert_retail_variant: it goes through a price change. PRICE_VIA_PROTOCOL hint name (price_promo_renames, #9), for a manager, on a changed name (either language, compared trimmed) of an existing size of such an item, checked after the price: the rename goes through a price change too. ITEM_NOT_FOUND, VARIANT_NOT_FOUND, INVALID_PRICE.';

revoke all on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.upsert_retail_variant — re-issued from 20260922000145_shop_rpcs.sql:132
-- ---------------------------------------------------------------------------
create or replace function app.upsert_retail_variant(
  p_item_id             uuid,
  p_name_en             text,
  p_name_ar             text,
  p_price_iqd           bigint,
  p_sku                 text default null,
  p_barcode             text default null,
  p_supplier_id         uuid default null,
  p_pack_cost_iqd       bigint default null,
  p_low_stock_threshold numeric default null,
  p_id                  uuid default null,
  p_is_default          boolean default false,
  p_sort_order          int default 0
) returns jsonb
language plpgsql security definer set search_path = public as $upsert_retail_variant_0246$
declare
  v_item     menu_items%rowtype;
  v_kind     text;
  v_sku      text := nullif(btrim(p_sku), '');
  v_barcode  text := nullif(btrim(p_barcode), '');
  v_variant  uuid;
  v_ing      ingredients%rowtype;
  v_ing_name_en text;
  v_ing_name_ar text;
begin
  if not app.is_staff('manager','owner','shop_staff') then   -- 0246
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select mi.* into v_item from menu_items mi
   where mi.id = p_item_id and mi.venue_id = any(app.staff_venue_ids());
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  select c.kind into v_kind from menu_categories c where c.id = v_item.category_id;
  if v_kind is distinct from 'shop' then
    raise exception 'NOT_SHOP_CATEGORY' using errcode = 'P0001',
      hint = 'only items in a shop section carry stock of their own';
  end if;
  if p_pack_cost_iqd is not null and p_pack_cost_iqd < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_pack_cost_iqd';
  end if;
  if p_low_stock_threshold is not null and p_low_stock_threshold < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_low_stock_threshold';
  end if;
  if p_supplier_id is not null and not exists (
       select 1 from suppliers s
        where s.id = p_supplier_id and s.is_active and s.venue_id = v_item.venue_id) then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Per-venue uniqueness (variants carry no venue_id; the venue is the item's).
  if v_barcode is not null and exists (
       select 1 from menu_item_variants v
         join menu_items mi on mi.id = v.item_id
        where mi.venue_id = v_item.venue_id and v.barcode = v_barcode
          and (p_id is null or v.id <> p_id)) then
    raise exception 'BARCODE_TAKEN' using errcode = 'P0001', detail = v_barcode;
  end if;
  if v_sku is not null and exists (
       select 1 from menu_item_variants v
         join menu_items mi on mi.id = v.item_id
        where mi.venue_id = v_item.venue_id and lower(v.sku) = lower(v_sku)
          and (p_id is null or v.id <> p_id)) then
    raise exception 'SKU_TAKEN' using errcode = 'P0001', detail = v_sku;
  end if;

  -- The variant itself: the existing RPC, so price rules and the one-default
  -- rule stay in one place. Its manager guard passes (same caller).
  v_variant := app.upsert_variant(p_item_id, p_name_en, p_name_ar, p_price_iqd,
                                  p_id, coalesce(p_is_default, false), coalesce(p_sort_order, 0));
  update menu_item_variants set sku = v_sku, barcode = v_barcode where id = v_variant;

  v_ing_name_en := left(btrim(v_item.name_en || ' ' || coalesce(nullif(btrim(p_name_en), ''), '')), 200);
  v_ing_name_ar := left(btrim(v_item.name_ar || ' ' || coalesce(nullif(btrim(p_name_ar), ''), '')), 200);

  select * into v_ing from ingredients where variant_id = v_variant for update;
  if not found then
    insert into ingredients (venue_id, kind, name_en, name_ar, unit, pack_size, pack_cost_iqd,
                             supplier_id, supplier_name, low_stock_threshold, variant_id)
    values (v_item.venue_id, 'retail', v_ing_name_en, v_ing_name_ar, 'pc', 1, p_pack_cost_iqd,
            p_supplier_id, (select name from suppliers where id = p_supplier_id),
            p_low_stock_threshold, v_variant)
    returning * into v_ing;
    insert into recipe_lines (variant_id, ingredient_id, qty)
    values (v_variant, v_ing.id, 1);
    perform app.write_audit('shop.retail_stock.create', 'ingredients', v_ing.id::text,
                            null, to_jsonb(v_ing));
  else
    update ingredients
       set name_en = v_ing_name_en, name_ar = v_ing_name_ar,
           pack_cost_iqd = coalesce(p_pack_cost_iqd, pack_cost_iqd),
           supplier_id = p_supplier_id,
           supplier_name = (select name from suppliers where id = p_supplier_id),
           low_stock_threshold = p_low_stock_threshold,
           is_active = true
     where id = v_ing.id;
  end if;

  return jsonb_build_object('variant_id', v_variant, 'ingredient_id', v_ing.id);
end $upsert_retail_variant_0246$;

revoke all on function app.upsert_retail_variant(uuid, text, text, bigint, text, text, uuid, bigint, numeric, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_retail_variant(uuid, text, text, bigint, text, text, uuid, bigint, numeric, uuid, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.upsert_supplier — re-issued from 20260922000145_shop_rpcs.sql:66
-- ---------------------------------------------------------------------------
create or replace function app.upsert_supplier(
  p_name      text,
  p_phone     text default null,
  p_notes     text default null,
  p_id        uuid default null,
  p_is_active boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_supplier_0246$
declare
  v_name   text := nullif(btrim(p_name), '');
  v_before jsonb;
  v_row    suppliers%rowtype;
  v_venue  uuid;
begin
  if not app.is_staff('manager','owner','shop_staff') then   -- 0246
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) > 120 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_name';
  end if;

  if p_id is null then
    v_venue := app.current_venue();
  else
    select * into v_row from suppliers
     where id = p_id and venue_id = any(app.staff_venue_ids())
     for update;
    if not found then
      raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_venue := v_row.venue_id;
  end if;

  -- One live supplier per spelling per venue ("Al-Rafidain" = "al rafidain").
  if coalesce(p_is_active, true) and exists (
       select 1 from suppliers s
        where s.venue_id = v_venue and s.is_active
          and (p_id is null or s.id <> p_id)
          and app.search_norm(s.name) = app.search_norm(v_name)) then
    raise exception 'SUPPLIER_EXISTS' using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into suppliers (venue_id, name, phone, notes, is_active)
    values (v_venue, v_name, nullif(btrim(p_phone), ''), nullif(btrim(p_notes), ''),
            coalesce(p_is_active, true))
    returning * into v_row;
    perform app.write_audit('supplier.create', 'suppliers', v_row.id::text, null, to_jsonb(v_row));
  else
    v_before := to_jsonb(v_row);
    update suppliers
       set name = v_name, phone = nullif(btrim(p_phone), ''), notes = nullif(btrim(p_notes), ''),
           is_active = coalesce(p_is_active, true)
     where id = p_id
     returning * into v_row;
    perform app.write_audit('supplier.update', 'suppliers', v_row.id::text, v_before, to_jsonb(v_row));
  end if;
  return v_row.id;
end $upsert_supplier_0246$;

revoke all on function app.upsert_supplier(text, text, text, uuid, boolean) from public, anon;
grant execute on function app.upsert_supplier(text, text, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.day_close_shop — the day close's Shop block (read).
-- ---------------------------------------------------------------------------
create or replace function app.day_close_shop(p_day_session_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $day_close_shop_0246$
declare
  v_day      day_sessions%rowtype;
  v_by       jsonb;
  v_refunds  bigint;
  v_sales    bigint;
  v_settled  int;
  v_open     jsonb;
  v_shifts   jsonb;
begin
  if not app.is_staff('shop_staff','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_day_session_id is not null then
    select * into v_day from day_sessions where id = p_day_session_id;
  else
    select * into v_day from day_sessions
     where venue_id = app.current_venue()
     order by (status = 'open') desc, business_date desc
     limit 1;
  end if;
  if not found then
    raise exception 'DAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_day.venue_id, 'shop_staff','manager','owner') then
    raise exception 'DAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Money taken for shop sales that day, by method (change already netted
  -- out of amount_iqd), and what was refunded of it.
  select coalesce(jsonb_object_agg(x.method, x.iqd), '{}'::jsonb), coalesce(sum(x.iqd), 0)
    into v_by, v_sales
    from (select p.method::text as method, sum(p.amount_iqd) as iqd
            from payments p join tabs t on t.id = p.tab_id
           where t.kind = 'shop' and p.day_session_id = v_day.id
           group by p.method) x;

  select coalesce(sum(r.amount_iqd), 0) into v_refunds
    from refunds r
    join payments p on p.id = r.payment_id
    join tabs t on t.id = p.tab_id
   where t.kind = 'shop' and p.day_session_id = v_day.id;

  select count(*) into v_settled
    from tabs t
   where t.kind = 'shop' and t.day_session_id = v_day.id and t.status = 'settled';

  -- A sale left open blocks close_day (0216): list them so the shop can
  -- finish or cancel each one.
  select coalesce(jsonb_agg(jsonb_build_object('tab_id', t.id, 'label', t.label,
                                               'opened_at', t.opened_at, 'total_iqd', t.total_iqd)
                            order by t.opened_at), '[]'::jsonb)
    into v_open
    from tabs t
   where t.kind = 'shop' and t.day_session_id = v_day.id
     and t.status in ('open', 'awaiting_payment');

  -- The shop PCs' drawers (stations with mode shop): their till shifts.
  select coalesce(jsonb_agg(jsonb_build_object(
           'till_shift_id',     s.id,
           'station_id',        s.station_id,
           'staff_name',        st.display_name,
           'opened_at',         s.opened_at,
           'closed_at',         s.closed_at,
           'opening_float_iqd', s.opening_float_iqd,
           'cash_expected_iqd', s.cash_expected_iqd,
           'cash_counted_iqd',  s.cash_counted_iqd,
           'cash_variance_iqd', s.cash_variance_iqd,
           'card_payments_iqd', s.card_payments_iqd)
         order by s.opened_at), '[]'::jsonb)
    into v_shifts
    from till_shifts s
    join stations sn on sn.id = s.station_id and sn.venue_id = s.venue_id
    join staff st on st.id = s.staff_id
   where s.day_session_id = v_day.id and sn.mode = 'shop';

  return jsonb_build_object(
    'day_session_id', v_day.id,
    'business_date',  v_day.business_date,
    'sales_iqd',      v_sales,
    'by_method',      v_by,
    'refunds_iqd',    v_refunds,
    'net_iqd',        v_sales - v_refunds,
    'settled_sales',  v_settled,
    'open_sales',     v_open,
    'shifts',         v_shifts);
end $day_close_shop_0246$;

comment on function app.day_close_shop(uuid) is
  '0246 (Touch Shop own desk). The shop assistant, manager or owner at the day''s venue: the day close''s Shop block for p_day_session_id (default the branch''s open day, else its latest): {day_session_id, business_date, sales_iqd, by_method {cash, card, …}, refunds_iqd, net_iqd, settled_sales, open_sales [{tab_id, label, opened_at, total_iqd}] (these block close_day), shifts [{till_shift_id, station_id, staff_name, opened_at, closed_at, opening_float_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd}] (the till shifts of stations with mode shop)}. Shop sales are tabs of kind shop. FORBIDDEN, DAY_NOT_FOUND (also another branch''s).';

revoke all on function app.day_close_shop(uuid) from public, anon;
grant execute on function app.day_close_shop(uuid) to authenticated;
