set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0145 — Touch Shop RPCs.
--
--   app.set_category_kind      cafe <-> shop on an EMPTY category.
--   app.upsert_supplier        create / edit / (de)activate a supplier.
--   app.upsert_retail_variant  one transaction: the variant (through
--                              app.upsert_variant), its sku / barcode, its own
--                              `retail` ingredient (unit pc) and the qty-1
--                              recipe line that makes a sale consume it.
--   app.receive_delivery       0017 body + p_supplier_id + p_idempotency_key
--                              (claim_replay, 0049). NEW SIGNATURE: the old one
--                              is dropped by exact signature and re-granted.
--   app.open_tab               0106 body + p_kind. A shop tab may be opened
--                              with no table and no reservation when it has a
--                              label (a counter sale). NEW SIGNATURE, same drill.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app.set_category_kind
-- ---------------------------------------------------------------------------
create or replace function app.set_category_kind(p_id uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public as $set_category_kind_0145$
declare
  v_before jsonb;
  v_row    menu_categories%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('cafe','shop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;

  select * into v_row from menu_categories
   where id = p_id and venue_id = any(app.staff_venue_ids())
   for update;
  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.kind = p_kind then
    return;
  end if;
  -- A café item with a recipe cannot become a retail product (and back)
  -- without its stock rows lying about what they are: switch only when empty.
  if exists (select 1 from menu_items where category_id = p_id) then
    raise exception 'CATEGORY_NOT_EMPTY' using errcode = 'P0001',
      hint = 'move or delete the items first; a section changes kind only while empty';
  end if;

  v_before := to_jsonb(v_row);
  update menu_categories set kind = p_kind where id = p_id returning * into v_row;
  perform app.write_audit('menu.category.kind', 'menu_categories', v_row.id::text,
                          v_before, to_jsonb(v_row));
end $set_category_kind_0145$;

revoke all on function app.set_category_kind(uuid, text) from public, anon;
grant execute on function app.set_category_kind(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.upsert_supplier
-- ---------------------------------------------------------------------------
create or replace function app.upsert_supplier(
  p_name      text,
  p_phone     text default null,
  p_notes     text default null,
  p_id        uuid default null,
  p_is_active boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $upsert_supplier_0145$
declare
  v_name   text := nullif(btrim(p_name), '');
  v_before jsonb;
  v_row    suppliers%rowtype;
  v_venue  uuid;
begin
  if not app.is_staff('manager','owner') then
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
end $upsert_supplier_0145$;

revoke all on function app.upsert_supplier(text, text, text, uuid, boolean) from public, anon;
grant execute on function app.upsert_supplier(text, text, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.upsert_retail_variant
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
language plpgsql security definer set search_path = public as $upsert_retail_variant_0145$
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
  if not app.is_staff('manager','owner') then
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
end $upsert_retail_variant_0145$;

revoke all on function app.upsert_retail_variant(uuid, text, text, bigint, text, text, uuid, bigint, numeric, uuid, boolean, int) from public, anon;
grant execute on function app.upsert_retail_variant(uuid, text, text, bigint, text, text, uuid, bigint, numeric, uuid, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.receive_delivery — 0017 body + supplier id + idempotency key.
-- ---------------------------------------------------------------------------
drop function if exists app.receive_delivery(jsonb, text, text, text);

create or replace function app.receive_delivery(
  p_lines           jsonb,
  p_supplier_name   text default null,
  p_notes           text default null,
  p_device_id       text default null,
  p_supplier_id     uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $receive_delivery_0145$
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
  v_replay   jsonb;
  v_supplier suppliers%rowtype;
  v_sname    text := nullif(btrim(p_supplier_name), '');
  v_result   jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_DELIVERY' using errcode = 'P0001';
  end if;
  if p_supplier_id is not null then
    select * into v_supplier from suppliers
     where id = p_supplier_id and venue_id = any(app.staff_venue_ids());
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

  insert into deliveries (received_by, supplier_name, supplier_id, notes)
  values (auth.uid(), v_sname, p_supplier_id, p_notes)
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
                          null, jsonb_build_object('lines', p_lines, 'supplier', v_sname,
                                                   'supplier_id', p_supplier_id),
                          null, null, p_device_id);

  v_result := jsonb_build_object('delivery_id', v_delivery.id, 'batch_ids', to_jsonb(v_batches));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $receive_delivery_0145$;

revoke all on function app.receive_delivery(jsonb, text, text, text, uuid, text) from public, anon;
grant execute on function app.receive_delivery(jsonb, text, text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.open_tab — 0106 body + p_kind.
-- ---------------------------------------------------------------------------
drop function if exists app.open_tab(uuid, text, uuid, text, text);

create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null,
  p_kind            text default 'cafe'
) returns jsonb
language plpgsql security definer set search_path = public as $opentab_0145$
declare
  v_day        uuid;
  v_row        tabs%rowtype;
  v_label      text := nullif(btrim(p_label), '');
  v_status     reservation_status;
  v_live       uuid;
  v_constraint text;
  v_kind       text := coalesce(p_kind, 'cafe');
begin
  if not app.is_staff('cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_kind not in ('cafe','shop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from tabs where idempotency_key = p_idempotency_key;
    if found then
      if v_row.opened_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another tab';
      end if;
      return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null then
    select status into v_status from reservations where id = p_reservation_id;
    if not found then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- 0106: a booking that has ended without being played owes nothing; a tab
    -- opened against it is a mistake the day close would have to clean up.
    if v_status in ('cancelled','no_show','expired') then
      raise exception 'RESERVATION_NOT_LIVE' using errcode = 'P0001', detail = v_status::text;
    end if;
    -- 0106 (D1): friendly refusal. NOT serialised — two concurrent opens both
    -- pass it; tabs_one_live_per_reservation is the guard, mapped below.
    select id into v_live from tabs
     where reservation_id = p_reservation_id
       and status in ('open','awaiting_payment')
     limit 1;
    if v_live is not null then
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = v_live::text,
        hint = 'this booking already has an open bill; add to that one';
    end if;
  end if;
  if p_table_id is null and p_reservation_id is null then
    -- 0145: a shop counter sale is the one tab with no table and no booking;
    -- its label is what the till and the day close show for it.
    if v_kind = 'shop' then
      if v_label is null then
        raise exception 'LABEL_REQUIRED' using errcode = 'P0001',
          hint = 'a counter sale needs a name or a number';
      end if;
    else
      raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001',
        hint = 'a tab needs a table or a reservation; a name alone is not an anchor';
    end if;
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key, kind)
    values (v_day, p_table_id, p_reservation_id, v_label,
            auth.uid(), p_device_id, p_idempotency_key, v_kind)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tabs_one_live_per_reservation' then
      select id into v_live from tabs
       where reservation_id = p_reservation_id
         and status in ('open','awaiting_payment')
       limit 1;
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = coalesce(v_live::text, ''),
        hint = 'this booking already has an open bill; add to that one';
    end if;
    if p_idempotency_key is not null then
      select * into v_row from tabs where idempotency_key = p_idempotency_key;
      if found then
        if v_row.opened_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another tab';
        end if;
        return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
      end if;
    end if;
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id);
end $opentab_0145$;

revoke all on function app.open_tab(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function app.open_tab(uuid, text, uuid, text, text, text) to authenticated;
