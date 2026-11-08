-- 0404 shop_only_second_jobs — the shop assistant's limits hold for a shop
-- second job too (brooks audit 2026-11-07, db.md Critical).
--
-- 0345 made app.is_staff count staff.extra_roles, so the guard
-- is_staff('manager','owner','shop_staff') of the seven bodies below admits a
-- person whose SECOND job is shop_staff. Each then held the shop assistant to
-- the shop with `app.staff_role() = 'shop_staff'`, which reads the main role
-- alone: a cashier, barista, waiter, … with shop_staff as a second job passed
-- the guard and skipped every shop limit, and, not being a manager, every
-- manager rule too. They could edit café items and switch them on without the
-- release protocol (upsert_menu_item, upsert_variant), and receive into,
-- count, apply or discard counts of, and write off the café and bakery stores
-- (receive_delivery, start_count, finalize_count, discard_count, record_waste).
-- Neither job grants that alone.
--
-- The limit now applies to everyone the guard admits through shop_staff alone:
-- `not app.is_staff(<the guard's other roles>)`, the main role and second jobs
-- both (manager and owner; record_waste also admits the cashier, who writes off
-- anywhere, so a cashier who also works the shop is not held to it, 0383's
-- union rule). Where a shop assistant's store defaulted to their home store
-- (start_count, record_waste), a caller held to the shop defaults to the shop,
-- as the shop assistant does. The manager rules still read app.staff_role():
-- manager is never a second job (staff_extra_roles_chk).
--
-- Every body below is the latest one, verbatim, plus the marked 0404 changes.
--
-- covered by packages/db/tests/second-jobs.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.upsert_menu_item — re-issued from 20260927000246_shop_products.sql:106
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
language plpgsql security definer set search_path = public as $upsert_menu_item_0404$
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
  -- 0404: anyone in through shop_staff alone, a second job included.
  if not app.is_staff('manager','owner') then
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
end $upsert_menu_item_0404$;

comment on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) is
  'Manager or owner, or the shop assistant, as main or second job (0404), for shop products only (0246; FORBIDDEN hint category otherwise, and none of the manager rules below reach them): creates or updates a menu item or shop product (0054; a wrapper over app.upsert_menu_item_internal since product_release). ITEM_IN_RELEASE, for everyone, on switching on an item whose product release is not live or done, or moving it into a category that is not a cafe one. For a manager: ITEM_VIA_RELEASE on any item moved from a shop category into a cafe one; and on a new item or a draft (never launched, switched off, not in release), ITEM_VIA_RELEASE for a new cafe item or a cafe draft switched on, LAUNCH_VIA_PROTOCOL for a shop product saved switched on. CATEGORY_NOT_FOUND, ITEM_NOT_FOUND, INVALID_HIGHLIGHT, INVALID_SERVE_TEMP, HOOK_TOO_LONG, HOOK_PAIR_MISMATCH.';

revoke all on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) from public, anon;
grant execute on function app.upsert_menu_item(uuid, text, text, uuid, text, text, int, boolean, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.upsert_variant — re-issued from 20260927000246_shop_products.sql:197
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
language plpgsql security definer set search_path = public as $upsert_variant_0404$
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
  -- 0404: anyone in through shop_staff alone, a second job included.
  if not app.is_staff('manager','owner')
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
end $upsert_variant_0404$;

comment on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) is
  'Manager or owner, or the shop assistant, as main or second job (0404), for shop sizes only (0246; FORBIDDEN hint category otherwise; PRICE_VIA_PROTOCOL does not reach them): creates or updates one size of a menu item or shop product (0013; a wrapper over app.upsert_variant_internal since product_release). ITEM_IN_RELEASE, for everyone, on a new size or a price change of an item whose product release is not live or done: its prices come from the price step. PRICE_VIA_PROTOCOL (price_promo, #51), for a manager, on a new size or a price change of any item that is not a draft (launched_at set, or switched on), cafe or shop, including through app.upsert_retail_variant: it goes through a price change. PRICE_VIA_PROTOCOL hint name (price_promo_renames, #9), for a manager, on a changed name (either language, compared trimmed) of an existing size of such an item, checked after the price: the rename goes through a price change too. ITEM_NOT_FOUND, VARIANT_NOT_FOUND, INVALID_PRICE.';

revoke all on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_variant(uuid, text, text, bigint, uuid, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.receive_delivery — re-issued from 20260927000245_shop_store.sql:289
-- ---------------------------------------------------------------------------
create or replace function app.receive_delivery(p_lines jsonb, p_supplier_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_location text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $receive_delivery_0404$
declare
  v_venue    uuid;
  v_loc      stock_location;
  v_replay   jsonb;
  v_supplier suppliers%rowtype;
  v_sname    text := nullif(btrim(p_supplier_name), '');
  v_result   jsonb;
begin
  if not app.is_staff('manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.current_venue();
  if not app.is_staff_at(v_venue, 'manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_loc := app.parse_stock_location(p_location, 'cafe');
  -- 0245: the shop assistant receives into the shop store and nowhere else.
  -- 0404: anyone in through shop_staff alone, a second job included.
  if not app.is_staff('manager','owner') then
    if p_location is not null and btrim(p_location) <> '' and v_loc <> 'shop' then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    v_loc := 'shop';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_DELIVERY' using errcode = 'P0001';
  end if;
  if p_supplier_id is not null then
    select * into v_supplier from suppliers
     where id = p_supplier_id and venue_id = v_venue;
    if not found then
      raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_sname := coalesce(v_sname, v_supplier.name);
  end if;

  -- 0145: claim after the guards and before any write (0049 pattern). A
  -- second tap of "Receive" or a replayed receipt confirm returns the first
  -- delivery instead of doubling the stock.
  v_replay := app.claim_replay(p_idempotency_key, 'receive_delivery');
  if v_replay is not null then
    return v_replay;
  end if;

  v_result := app.receive_delivery_internal(v_venue, v_loc, p_lines, v_sname, p_notes, p_device_id,
                                            p_supplier_id, 'goods_in');

  perform app.write_audit('stock.receive_delivery', 'deliveries', v_result->>'delivery_id',
                          null, jsonb_build_object('lines', p_lines, 'supplier', v_sname,
                                                   'supplier_id', p_supplier_id, 'location', v_loc),
                          null, null, p_device_id);

  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $receive_delivery_0404$;

comment on function app.receive_delivery(jsonb, text, text, text, uuid, text, text) is
  '0145 + stock_locations (D4) + shop_store (0245). MGMT, or the shop assistant, as main or second job (0404), into the shop store only (FORBIDDEN hint location for another store; the shop store when none is named), at the venue: Goods in. p_lines [{ingredient_id, qty_received, unit_cost_iqd, qty_expected?, expiry_date?}] booked as one delivery into p_location (default cafe) through app.receive_delivery_internal. Returns {delivery_id, batch_ids}. Idempotent by key. EMPTY_DELIVERY, SUPPLIER_NOT_FOUND, INVALID_ARGUMENT (hint location; hint kind), STORE_BEING_COUNTED (an operator count is open at that store), INGREDIENT_NOT_FOUND, INVALID_LINE. Audit stock.receive_delivery.';

revoke all on function app.receive_delivery(jsonb, text, text, text, uuid, text, text) from public, anon;
grant execute on function app.receive_delivery(jsonb, text, text, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.start_count — re-issued from 20260927000245_shop_store.sql:356
-- ---------------------------------------------------------------------------
create or replace function app.start_count(
  p_location text default null,
  p_venue_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $start_count_0404$
declare
  v_venue uuid;
  v_loc   stock_location;
  v_count stock_counts%rowtype;
  v_lines int;
  v_shop_only boolean;
begin
  if not app.is_staff('manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner','shop_staff')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  -- 0404: anyone in through shop_staff alone, a second job included, is held
  -- to the shop store and defaults to it.
  v_shop_only := not app.is_staff('manager','owner');
  v_loc := app.parse_stock_location(p_location, case when v_shop_only then 'shop'::stock_location
                                                     else app.staff_home_location(app.staff_role()) end);
  -- 0245: the shop assistant counts the shop store only.
  if v_shop_only and v_loc <> 'shop' then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;

  -- Waits for any move or receipt into this store still in flight, so the
  -- snapshot below sees it.
  perform pg_advisory_xact_lock(hashtextextended('stock_count:' || v_venue::text || ':' || v_loc::text, 0));
  if exists (select 1 from stock_counts
              where venue_id = v_venue and location = v_loc and finalized_at is null) then
    raise exception 'COUNT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  insert into stock_counts (counted_by, venue_id, location, source)
  values (auth.uid(), v_venue, v_loc, 'operator')
  returning * into v_count;

  insert into stock_count_lines (count_id, ingredient_id, theoretical_qty, counted_qty)
  select v_count.id, i.id, t.qty, t.qty
    from ingredients i
    cross join lateral (select coalesce(sum(m.qty_delta), 0) as qty
                          from stock_movements m
                         where m.ingredient_id = i.id and m.location = v_loc) t
   where i.is_active
     and i.venue_id = v_venue
     and ((v_loc = 'shop') = (i.kind = 'retail'));   -- 0245: shop stock only, and only there
  get diagnostics v_lines = row_count;

  perform app.write_audit('stock.start_count', 'stock_counts', v_count.id::text,
                          null, jsonb_build_object('lines', v_lines, 'location', v_loc));

  return jsonb_build_object('count_id', v_count.id, 'lines', v_lines,
                            'started_at', v_count.started_at, 'location', v_loc);
end $start_count_0404$;

comment on function app.start_count(text, uuid) is
  '0019 + stock_counts_by_location (D7) + shop_store (0245). MGMT, or the shop assistant, as main or second job (0404), for the shop store, at the venue: opens an operator count of one store (p_location, default the caller''s home store; the shop store for a shop assistant) under the store''s count lock, snapshotting every active ingredient of the venue at its ledger sum in that store (the shop store holds shop stock only, the cafe and bakery none). Receipts and moves into the store are refused until it is finalized or discarded. Returns {count_id, lines, started_at, location}. FORBIDDEN, INVALID_ARGUMENT (hint location), COUNT_IN_PROGRESS (a count of that store is open or waiting). Audit stock.start_count.';

revoke all on function app.start_count(text, uuid) from public, anon;
grant execute on function app.start_count(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.record_waste — re-issued from 20260927000245_shop_store.sql:1241
-- ---------------------------------------------------------------------------
create or replace function app.record_waste(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_movement_type movement_type default 'waste_spill',
  p_reason_code   text default null,
  p_device_id     text default null,
  p_idempotency_key text default null,
  p_location      text default null
) returns void
language plpgsql security definer set search_path = public as $record_waste_0404$
declare
  v_venue uuid;
  v_replay jsonb;
  v_loc    stock_location;
  v_shop_only boolean;
begin
  if not app.is_staff('cashier','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the ingredient's branch decides the day, the rows written and who may act.
  v_venue := (select i.venue_id from ingredients i where i.id = p_ingredient_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_movement_type not in ('waste_spill','waste_spoilage') then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001',
      hint = 'record_waste accepts waste_spill or waste_spoilage';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  -- 0404: anyone in through shop_staff alone, a second job included, is held
  -- to the shop store and defaults to it; a cashier writes off anywhere.
  v_shop_only := not app.is_staff('cashier','manager','owner');
  v_loc := app.parse_stock_location(p_location, case when v_shop_only then 'shop'::stock_location
                                                     else app.staff_home_location(app.staff_role()) end);
  -- 0245: the shop assistant writes off shop stock at the shop store only, and
  -- shop stock is written off there and nowhere else.
  if v_shop_only and v_loc <> 'shop' then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;
  perform app.assert_store_for_kind((select i.kind from ingredients i where i.id = p_ingredient_id), v_loc);

  -- 0049: the stock ledger is append-only, so a double deduction has no undo;
  -- corrections are counter-entries. Claim before consuming anything.
  v_replay := app.claim_replay(p_idempotency_key, 'record_waste');
  if v_replay is not null then
    return;                                   -- already applied
  end if;

  perform app.consume_fefo_at(v_loc, p_ingredient_id, p_qty, p_movement_type,
                              null, null, auth.uid(), p_device_id, p_reason_code);

  perform app.write_audit('stock.record_waste', 'ingredients', p_ingredient_id::text,
                          null, jsonb_build_object('qty', p_qty, 'movement_type', p_movement_type,
                                                   'location', v_loc),
                          p_reason_code, null, p_device_id);

  perform app.finish_replay(p_idempotency_key, jsonb_build_object('applied', true));
end $record_waste_0404$;

comment on function app.record_waste(uuid, numeric, movement_type, text, text, text, text) is
  '0018/0049 + stock_locations (D3) + shop_store (0245). The cashier and MGMT, or the shop assistant, as main or second job, at the shop store only (0404: held there unless the cashier, manager or owner is also one of their jobs; FORBIDDEN hint location): records waste_spill or waste_spoilage with a reason at the ingredient''s branch (VENUE_MISMATCH), FEFO from p_location (default the caller''s home store; the shop store for a shop assistant). Shop stock is written off at the shop store and nowhere else (INVALID_ARGUMENT hint kind). Idempotent by key (the queued stock.waste passes p_location only when it names one). FORBIDDEN, INVALID_MOVEMENT, REASON_REQUIRED, INVALID_ARGUMENT (hint location), INVALID_QTY. Audit stock.record_waste (+ location).';

revoke all on function app.record_waste(uuid, numeric, movement_type, text, text, text, text) from public, anon;
grant execute on function app.record_waste(uuid, numeric, movement_type, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.finalize_count — re-issued from 20260927000245_shop_store.sql:1376
-- ---------------------------------------------------------------------------
create or replace function app.finalize_count(
  p_count_id  uuid,
  p_lines     jsonb default '[]'::jsonb,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $finalize_count_0404$
declare
  v_count    stock_counts%rowtype;
  v_line     jsonb;
  v_cl       stock_count_lines%rowtype;
  v_delta    numeric;
  v_left     numeric;
  v_take     numeric;
  v_batch    record;
  v_ids      uuid[];
  v_cost     numeric;
  v_adjusted int := 0;
begin
  if not app.is_staff('manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_count from stock_counts where id = p_count_id for update;
  if not found or not (v_count.venue_id = any(app.staff_venue_ids())) then
    raise exception 'COUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_count.venue_id, 'manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0245: the shop assistant applies or discards counts of the shop store only.
  -- 0404: anyone in through shop_staff alone, a second job included.
  if not app.is_staff('manager','owner') and v_count.location <> 'shop' then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;
  perform set_config('app.venue_id', v_count.venue_id::text, true);
  if v_count.finalized_at is not null then
    raise exception 'COUNT_FINALIZED' using errcode = 'P0001';
  end if;

  -- Apply the counted quantities from the payload.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update stock_count_lines
       set counted_qty = (v_line->>'counted_qty')::numeric
     where count_id = p_count_id
       and ingredient_id = (v_line->>'ingredient_id')::uuid;
    if not found then
      raise exception 'COUNT_LINE_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_line->>'ingredient_id', '(missing ingredient_id)');
    end if;
    if (v_line->>'counted_qty')::numeric < 0 then
      raise exception 'INVALID_LINE' using errcode = 'P0001', detail = v_line::text;
    end if;
  end loop;

  -- The ingredient locks of every drifted line first (V15), so no sale or
  -- move is still booking one of them when its batches are read.
  perform app.lock_stock_ingredients(array(
    select l.ingredient_id from stock_count_lines l
     where l.count_id = p_count_id and l.counted_qty <> l.theoretical_qty));

  -- Reconcile every drifted line, at the count's store only.
  for v_cl in
    select * from stock_count_lines
     where count_id = p_count_id and counted_qty <> theoretical_qty
     order by ingredient_id
  loop
    v_delta := v_cl.counted_qty - v_cl.theoretical_qty;
    v_adjusted := v_adjusted + 1;

    -- The canonical lock pass (consume_fefo_at's), both stores, before any
    -- batch of this ingredient is touched.
    select coalesce(array_agg(l.id), '{}') into v_ids
      from (select b.id
              from stock_batches b
             where b.ingredient_id = v_cl.ingredient_id and b.qty_remaining > 0
             order by b.expiry_date asc nulls last, b.received_at asc, b.id asc
               for update) l;

    if v_delta < 0 then
      -- Shortage: draw down this store's batches in the canonical order,
      -- overdraft on batch null at this store.
      v_left := -v_delta;
      for v_batch in
        select b.id, b.qty_remaining, b.unit_cost_iqd
          from stock_batches b
         where b.id = any(v_ids) and b.location = v_count.location and b.qty_remaining > 0
         order by b.expiry_date asc nulls last, b.received_at asc, b.id asc
      loop
        exit when v_left <= 0;
        v_take := least(v_left, v_batch.qty_remaining);
        update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
        insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                     unit_cost_iqd, count_id, staff_id, device_id, reason_code, location)
        values (v_cl.ingredient_id, v_batch.id, 'count_adjustment', -v_take,
                v_batch.unit_cost_iqd, p_count_id, auth.uid(), p_device_id, 'count_shortage', v_count.location);
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then
        insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                     unit_cost_iqd, count_id, staff_id, device_id, reason_code, location)
        values (v_cl.ingredient_id, null, 'count_adjustment', -v_left,
                null, p_count_id, auth.uid(), p_device_id, 'count_shortage', v_count.location);
      end if;
    else
      -- Surplus: top up this store's newest live batch; else make one here,
      -- costed like the newest live batch elsewhere, or at zero.
      select b.id, b.unit_cost_iqd into v_batch
        from stock_batches b
       where b.id = any(v_ids) and b.location = v_count.location and b.qty_remaining > 0
       order by b.received_at desc, b.id desc
       limit 1;
      if found then
        update stock_batches set qty_remaining = qty_remaining + v_delta where id = v_batch.id;
      else
        select b.unit_cost_iqd into v_cost
          from stock_batches b
         where b.id = any(v_ids) and b.qty_remaining > 0
         order by b.received_at desc, b.id desc
         limit 1;
        insert into stock_batches (ingredient_id, delivery_line_id, qty_received, qty_remaining, unit_cost_iqd,
                                   venue_id, location)
        values (v_cl.ingredient_id, null, v_delta, v_delta, coalesce(v_cost, 0),
                v_count.venue_id, v_count.location)
        returning id, unit_cost_iqd into v_batch;
      end if;
      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                   unit_cost_iqd, count_id, staff_id, device_id, reason_code, location)
      values (v_cl.ingredient_id, v_batch.id, 'count_adjustment', v_delta,
              v_batch.unit_cost_iqd, p_count_id, auth.uid(), p_device_id, 'count_surplus', v_count.location);
    end if;
  end loop;

  update stock_counts set finalized_at = now() where id = p_count_id
  returning * into v_count;

  perform app.write_audit('stock.finalize_count', 'stock_counts', p_count_id::text,
                          null, jsonb_build_object('adjusted_lines', v_adjusted, 'location', v_count.location),
                          null, null, p_device_id);

  return jsonb_build_object('count_id', p_count_id, 'adjusted_lines', v_adjusted,
                            'finalized_at', v_count.finalized_at, 'location', v_count.location);
end $finalize_count_0404$;

comment on function app.finalize_count(uuid, jsonb, text) is
  '0019/0044 + stock_counts_by_location (D7) + shop_store (0245). MGMT, or the shop assistant, as main or second job (0404), for a count of the shop store, at the count''s venue: applies an operator count or a waiting phone count. p_lines [{ingredient_id, counted_qty}] overwrite the counted quantities (COUNT_LINE_NOT_FOUND for an ingredient not in the count); every drifted line is reconciled at the count''s store with count_adjustment movements (a shortage FEFO with any rest batch-less, a surplus into that store''s newest live batch or a new one). Returns {count_id, adjusted_lines, finalized_at, location}. FORBIDDEN, COUNT_NOT_FOUND (also another venue''s), COUNT_FINALIZED, INVALID_LINE. Audit stock.finalize_count.';

revoke all on function app.finalize_count(uuid, jsonb, text) from public, anon;
grant execute on function app.finalize_count(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.discard_count — re-issued from 20260927000245_shop_store.sql:1527
-- ---------------------------------------------------------------------------
create or replace function app.discard_count(p_count_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $discard_count_0404$
declare
  v_count stock_counts%rowtype;
  v_lines int;
begin
  if not app.is_staff('manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_count from stock_counts where id = p_count_id for update;
  if not found or not (v_count.venue_id = any(app.staff_venue_ids())) then
    raise exception 'COUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_count.venue_id, 'manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0245: the shop assistant applies or discards counts of the shop store only.
  -- 0404: anyone in through shop_staff alone, a second job included.
  if not app.is_staff('manager','owner') and v_count.location <> 'shop' then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;
  perform set_config('app.venue_id', v_count.venue_id::text, true);
  if v_count.finalized_at is not null then
    raise exception 'COUNT_FINALIZED' using errcode = 'P0001';
  end if;

  select count(*) into v_lines from stock_count_lines where count_id = p_count_id;
  -- An unapplied count has written no movement, so nothing references it.
  delete from stock_counts where id = p_count_id;

  perform app.write_audit('stock.discard_count', 'stock_counts', p_count_id::text,
                          jsonb_build_object('location', v_count.location, 'source', v_count.source,
                                             'lines', v_lines),
                          null);

  return jsonb_build_object('count_id', p_count_id, 'discarded', true);
end $discard_count_0404$;

comment on function app.discard_count(uuid) is
  'stock_counts_by_location (wave 5 §2.8.5, D7) + shop_store (0245). MGMT, or the shop assistant, as main or second job (0404), for a count of the shop store, at the count''s venue: deletes a count that was never applied (an operator count left open, or a phone count not worth applying), with its lines; stock is untouched. Returns {count_id, discarded: true}. FORBIDDEN, COUNT_NOT_FOUND (also another venue''s, or already discarded), COUNT_FINALIZED. Audit stock.discard_count {location, source, lines}.';

revoke all on function app.discard_count(uuid) from public, anon;
grant execute on function app.discard_count(uuid) to authenticated;
