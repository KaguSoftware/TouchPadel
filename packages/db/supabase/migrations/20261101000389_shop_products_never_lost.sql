set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0389 shop_products_never_lost — the Touch Shop's products (F-36, F-35 review;
-- Majed 2026-11-01: "a product can never be deleted; a new product arriving from
-- a driver purchase or a scanned receipt is recorded, and the manager gets a
-- message to approve the purchase of the new product and add it to the
-- products list").
--
--   1. receive_delivery_internal (0245 is no longer the latest): a shop product
--      bought with the café's goods is booked into the shop store instead of
--      being refused (INVALID_ARGUMENT hint kind was the finding): all shop
--      lines, the whole delivery goes to the shop store; some, they become a
--      second delivery at the shop store (returned as shop_delivery_id,
--      shop_batch_ids). Goods in only (p_source goods_in): a staff log is still
--      refused outside the shop store. receive_purchase, confirm_receipt and receive_delivery
--      all book through it, so none is re-issued. The shop store still takes
--      shop products only.
--   2. A shop product is never deleted: BEFORE DELETE triggers on menu_items
--      and menu_item_variants refuse a row of a 'shop' category (FORBIDDEN hint
--      shop_product). Hiding it (is_active false) stays the way to take one off
--      sale.
--   3. create_shop_product(...) makes a product and its first size in ONE
--      transaction (upsert_menu_item + upsert_retail_variant, 0246), idempotent
--      by key, so a failed second save can no longer leave a product without a
--      size and a retry never makes a second one. With p_purchase_line_id (the
--      manager or the owner) it is the approval of a new product a driver bought:
--      a purchase line with a name and no product (the driver's purchase already
--      tells the branch's managers, staff_task purchase_to_receive, 0166) is
--      linked to the new product's stock item and its quantity is booked into
--      the shop store at the price paid; the line is received, and the purchase
--      is done when nothing is left to receive. Declining stays
--      acknowledge_purchase_line (0166).

-- ===========================================================================
-- 1. Shop products in a café delivery go to the shop store
-- ===========================================================================
-- receive_delivery_internal: re-issued from 20260927000245_shop_store.sql:187.
create or replace function app.receive_delivery_internal(
  p_venue         uuid,
  p_location      stock_location,
  p_lines         jsonb,
  p_supplier_name text,
  p_notes         text,
  p_device_id     text,
  p_supplier_id   uuid,
  p_source        text
) returns jsonb
language plpgsql security definer set search_path = public as $receive_delivery_internal_0389$
declare
  v_delivery deliveries%rowtype;
  v_line     jsonb;
  v_ing      ingredients%rowtype;
  v_dl_id    uuid;
  v_batch_id uuid;
  v_expiry   date;
  v_qty      numeric;
  v_cost     numeric;
  v_csource  text;
  v_batches  uuid[] := '{}';
  v_retail   jsonb;
  v_rest     jsonb;
  v_shop     jsonb;
begin
  if p_venue is null or p_location is null or p_source is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
  end if;

  -- 0389 (F-36): a shop product bought with the café's goods (a driver
  -- purchase, a scanned receipt, Goods in) goes into the shop store, never a
  -- refusal. All the lines shop products: the whole delivery is the shop's;
  -- some of them: they become their own shop delivery, booked first, and the
  -- rest stay here. The shop store itself still takes only shop products, and
  -- a staff log (p_source staff_log) still books only into its own store.
  if p_source = 'goods_in' and p_location <> 'shop' and p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    select coalesce(jsonb_agg(l.e order by l.n) filter (where i.kind = 'retail'), '[]'::jsonb),
           coalesce(jsonb_agg(l.e order by l.n) filter (where i.kind is distinct from 'retail'), '[]'::jsonb)
      into v_retail, v_rest
      from jsonb_array_elements(p_lines) with ordinality l(e, n)
      left join ingredients i
        on i.id = case when (l.e->>'ingredient_id') ~ '^[0-9a-fA-F-]{36}$' then (l.e->>'ingredient_id')::uuid end
       and i.venue_id = p_venue;
    if jsonb_array_length(v_retail) > 0 then
      if jsonb_array_length(v_rest) = 0 then
        p_location := 'shop';
      else
        v_shop := app.receive_delivery_internal(p_venue, 'shop', v_retail, p_supplier_name, p_notes,
                                                p_device_id, p_supplier_id, p_source);
        p_lines := v_rest;
      end if;
    end if;
  end if;

  -- The count lock (M5, V19), shared: a manager's count at this store waits
  -- for this receipt, and this receipt never lands in the middle of one.
  perform pg_advisory_xact_lock_shared(
    hashtextextended('stock_count:' || p_venue::text || ':' || p_location::text, 0));
  if exists (select 1 from stock_counts
              where venue_id = p_venue and location = p_location
                and source = 'operator' and finalized_at is null) then
    raise exception 'STORE_BEING_COUNTED' using errcode = 'P0001', hint = p_location::text;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_DELIVERY' using errcode = 'P0001';
  end if;

  insert into deliveries (venue_id, location, source, received_by, supplier_name, supplier_id, notes)
  values (p_venue, p_location, p_source, auth.uid(), p_supplier_name, p_supplier_id, p_notes)
  returning * into v_delivery;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_ing from ingredients
     where id = (v_line->>'ingredient_id')::uuid and is_active and venue_id = p_venue;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_line->>'ingredient_id', '(missing ingredient_id)');
    end if;
    -- 0245: shop stock lives in the shop store only, and the shop store holds only shop stock.
    perform app.assert_store_for_kind(v_ing.kind, p_location);

    v_qty  := (v_line->>'qty_received')::numeric;
    v_cost := (v_line->>'unit_cost_iqd')::numeric;
    if v_qty is null or v_qty < 0 or v_cost is null or v_cost < 0 then
      raise exception 'INVALID_LINE' using errcode = 'P0001', detail = v_line::text;
    end if;
    v_csource := coalesce(v_line->>'cost_source', 'entered');
    if v_csource not in ('entered', 'last_batch', 'pack', 'none') then
      raise exception 'INVALID_LINE' using errcode = 'P0001', detail = v_line::text;
    end if;

    -- Expiry: captured per line, else derived from shelf_life_days, else null.
    v_expiry := coalesce(
      (v_line->>'expiry_date')::date,
      case when v_ing.shelf_life_days is not null
           then current_date + v_ing.shelf_life_days end);

    insert into delivery_lines (delivery_id, ingredient_id, qty_expected, qty_received, unit_cost_iqd, expiry_date,
                                cost_source)
    values (v_delivery.id, v_ing.id, (v_line->>'qty_expected')::numeric, v_qty, v_cost, v_expiry,
            v_csource)
    returning id into v_dl_id;

    if v_qty > 0 then
      insert into stock_batches (ingredient_id, delivery_line_id, expiry_date, qty_received, qty_remaining, unit_cost_iqd,
                                 venue_id, location)
      values (v_ing.id, v_dl_id, v_expiry, v_qty, v_qty, v_cost,
              p_venue, p_location)
      returning id into v_batch_id;
      v_batches := v_batches || v_batch_id;

      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                   unit_cost_iqd, delivery_line_id, staff_id, device_id, venue_id, location)
      values (v_ing.id, v_batch_id, 'goods_in', v_qty, v_cost, v_dl_id, auth.uid(), p_device_id, p_venue, p_location);
    end if;
  end loop;

  return jsonb_build_object('delivery_id', v_delivery.id, 'batch_ids', to_jsonb(v_batches))
         || case when v_shop is null then '{}'::jsonb
                 else jsonb_build_object('shop_delivery_id', v_shop->'delivery_id',
                                         'shop_batch_ids', v_shop->'batch_ids') end;
end $receive_delivery_internal_0389$;

comment on function app.receive_delivery_internal(uuid, stock_location, jsonb, text, text, text, uuid, text) is
  'stock_locations (D4), 0389. Internal: books one delivery into a store (p_source goods_in or staff_log): a delivery line, a batch and a goods_in movement per line, each naming the venue and the store; a line may carry cost_source (default entered). 0389: shop products (kind retail) delivered to another store go to the shop store: the whole delivery when every line is one, else their own shop delivery first (shop_delivery_id, shop_batch_ids in the answer). Takes the store''s count lock shared first. Returns {delivery_id, batch_ids[, shop_delivery_id, shop_batch_ids]}. STORE_BEING_COUNTED (hint the store), EMPTY_DELIVERY, INGREDIENT_NOT_FOUND (inactive, unknown or another venue''s), INVALID_ARGUMENT (hint kind: a café item into the shop store), INVALID_LINE. Reached through receive_delivery, receive_purchase (via receive_delivery), confirm_receipt, log_stock and create_shop_product; the caller guards, claims and audits.';

revoke all on function app.receive_delivery_internal(uuid, stock_location, jsonb, text, text, text, uuid, text) from public, anon, authenticated;

-- ===========================================================================
-- 2. A shop product is never deleted
-- ===========================================================================
create or replace function app.trg_shop_product_no_delete()
returns trigger
language plpgsql security definer set search_path = public as $trg_shop_product_no_delete_0389$
declare
  v_item uuid;
begin
  -- Two tables share the body; each branch reads only its own table's columns.
  if tg_table_name = 'menu_items' then
    v_item := old.id;
  else
    v_item := old.item_id;
  end if;
  if exists (select 1 from menu_items mi join menu_categories c on c.id = mi.category_id
              where mi.id = v_item and c.kind = 'shop') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'shop_product',
      detail = 'a shop product is never deleted; hide it instead';
  end if;
  return old;
end $trg_shop_product_no_delete_0389$;

comment on function app.trg_shop_product_no_delete() is
  '0389 (F-36). Trigger: a menu item of a shop category, or one of its sizes, is never deleted (FORBIDDEN hint shop_product); it is hidden instead (is_active false).';
revoke all on function app.trg_shop_product_no_delete() from public, anon, authenticated;

drop trigger if exists menu_items_shop_no_delete on public.menu_items;
create trigger menu_items_shop_no_delete before delete on public.menu_items
  for each row execute function app.trg_shop_product_no_delete();
drop trigger if exists menu_item_variants_shop_no_delete on public.menu_item_variants;
create trigger menu_item_variants_shop_no_delete before delete on public.menu_item_variants
  for each row execute function app.trg_shop_product_no_delete();

-- ===========================================================================
-- 3. create_shop_product: product and first size in one, and the approval of a
--    new product a driver bought
-- ===========================================================================
create or replace function app.create_shop_product(
  p_category_id         uuid,
  p_name_en             text,
  p_name_ar             text,
  p_size_name_en        text,
  p_size_name_ar        text,
  p_price_iqd           bigint,
  p_sku                 text default null,
  p_barcode             text default null,
  p_supplier_id         uuid default null,
  p_pack_cost_iqd       bigint default null,
  p_low_stock_threshold numeric default null,
  p_is_active           boolean default true,
  p_purchase_line_id    uuid default null,
  p_idempotency_key     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $create_shop_product_0389$
declare
  v_replay  jsonb;
  v_item    uuid;
  v_size    jsonb;
  v_line    purchase_lines%rowtype;
  v_p       purchases%rowtype;
  v_del     jsonb;
  v_result  jsonb;
begin
  if not app.is_staff('shop_staff', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_purchase_line_id is not null and not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'purchase';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  if p_purchase_line_id is not null then
    -- The purchase first (receive_purchase's order: the purchase, then its lines).
    select p.* into v_p from purchases p join purchase_lines pl on pl.purchase_id = p.id
     where pl.id = p_purchase_line_id;
    if not found or not (v_p.venue_id = any(app.staff_venue_ids())) or not app.is_staff_at(v_p.venue_id, 'manager', 'owner') then
      raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_p.venue_id::text, true);
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'create_shop_product');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_purchase_line_id is not null then
    select * into v_p from purchases where id = v_p.id for update;
    select * into v_line from purchase_lines where id = p_purchase_line_id for update;
    if v_line.ingredient_id is not null or v_line.status <> 'to_receive' then
      raise exception 'REQUEST_NOT_PENDING' using errcode = 'P0001', detail = v_line.status;
    end if;
  end if;

  -- 0246's own rules and words: a shop category, the names, the price, the size.
  v_item := app.upsert_menu_item(p_category_id, p_name_en, p_name_ar, null, null, null, 0,
                                 coalesce(p_is_active, true));
  v_size := app.upsert_retail_variant(v_item, p_size_name_en, p_size_name_ar, p_price_iqd, p_sku, p_barcode,
                                      p_supplier_id, p_pack_cost_iqd, p_low_stock_threshold, null, true, 0);
  v_result := jsonb_build_object('item_id', v_item, 'variant_id', v_size->'variant_id',
                                 'ingredient_id', v_size->'ingredient_id');

  if p_purchase_line_id is not null then
    -- Approved: the line is this product, its quantity goes into the shop store
    -- at the price the driver paid, and the line is received.
    update purchase_lines set ingredient_id = (v_size->>'ingredient_id')::uuid, status = 'received'
     where id = v_line.id;
    v_del := app.receive_delivery_internal(
      v_p.venue_id, 'shop',
      jsonb_build_array(jsonb_build_object(
        'ingredient_id', v_size->>'ingredient_id',
        'qty_expected',  v_line.qty,
        'qty_received',  v_line.qty,
        'unit_cost_iqd', round(v_line.price_iqd::numeric / v_line.qty, 4),
        'expiry_date',   null)),
      coalesce(v_p.shop_name, 'Driver purchase'), null, null, null, 'goods_in');
    update shopping_items si set status = 'received'
     where si.id = v_line.shopping_item_id and si.status = 'bought';
    update purchases
       set status = case when exists (select 1 from purchase_lines
                                        where purchase_id = v_p.id and status = 'to_receive')
                         then status else 'done' end,
           delivery_id = coalesce(delivery_id, (v_del->>'delivery_id')::uuid),
           received_by = coalesce(received_by, auth.uid()),
           received_at = coalesce(received_at, now())
     where id = v_p.id;
    perform app.write_audit('purchase.new_product_approved', 'purchase', v_p.id::text, null,
                            jsonb_build_object('line_id', v_line.id, 'item_id', v_item,
                                               'delivery_id', v_del->>'delivery_id'));
    v_result := v_result || jsonb_build_object('purchase_id', v_p.id, 'delivery_id', v_del->'delivery_id');
  end if;

  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $create_shop_product_0389$;

comment on function app.create_shop_product(uuid, text, text, text, text, bigint, text, text, uuid, bigint, numeric, boolean, uuid, text) is
  '0389 (F-36). The shop assistant, a manager or the owner makes a shop product and its first size in one transaction (upsert_menu_item then upsert_retail_variant, 0246, with their rules and refusals), idempotent by p_idempotency_key (required): {item_id, variant_id, ingredient_id}. With p_purchase_line_id (a manager or the owner at the purchase''s branch) it approves a new product a driver bought: the line (a name, no product, still to receive; else REQUEST_NOT_PENDING) becomes the new product''s stock item and its quantity is booked into the shop store at the price paid (+ purchase_id, delivery_id); the purchase is done when no line is left to receive. FORBIDDEN, PURCHASE_NOT_FOUND, INVALID_ARGUMENT. Audit purchase.new_product_approved.';
revoke all on function app.create_shop_product(uuid, text, text, text, text, bigint, text, text, uuid, bigint, numeric, boolean, uuid, text) from public, anon;
grant execute on function app.create_shop_product(uuid, text, text, text, text, bigint, text, text, uuid, bigint, numeric, boolean, uuid, text) to authenticated;
