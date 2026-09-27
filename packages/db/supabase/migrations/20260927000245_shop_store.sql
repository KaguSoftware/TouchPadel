-- 0245 shop_store — the shop's own store: retail stock lives there and only
-- there, the shop assistant keeps it, a shop sale draws from it.
--
-- Feature: Touch Shop, own desk (Parsa, 2026-09-27; docs/design/shop/
-- shop-desk-2026-09-27.md). Depends on: shop_desk_enums (0243: 'shop',
-- shop_staff), shop_desk_access (0244).
-- Re-runnable: create or replace; the data move is a guarded no-op on a
-- second run.
--
-- THE RULE (app.assert_store_for_kind). Retail stock is in the 'shop' store
-- and the 'shop' store holds only retail. It replaces the wave-5 V14 checks
-- ("retail lives in the cafe only", 0200:477, 0201:107/183, 0203:169,
-- 0204:109-110) in every body that books or reads a store. A breach is
-- INVALID_ARGUMENT hint kind, the code those checks already raised.
--
-- WHO KEEPS IT. shop_staff logs, receives, counts and wastes shop stock, at
-- the shop store only; the court desk loses the retail rows it had on the
-- phone (Parsa: "remove it"); the cashier keeps purchased stock only; MGMT
-- keeps everything. Production and moves never touch the shop store.
--
-- THE SALE. consume_for_order_item takes a shop order's lines from the shop
-- store (consume_fefo_at 'shop'); a refund puts a shop line back there. No
-- ingredient sits in two kinds of store, so consume_fefo_at's "then the other
-- store" fallback never reaches the café for a retail line.
--
-- Every body below is the latest one, verbatim, plus the marked 0245 changes.
--
-- covered by packages/db/tests/shop-desk.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0. app.assert_store_for_kind — internal.
-- ---------------------------------------------------------------------------
create or replace function app.assert_store_for_kind(p_kind ingredient_kind, p_location stock_location)
returns void
language plpgsql immutable security definer set search_path = public as $assert_store_for_kind_0245$
begin
  if (p_kind = 'retail') <> (p_location = 'shop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind',
      detail = p_kind::text || '@' || p_location::text;
  end if;
end $assert_store_for_kind_0245$;

comment on function app.assert_store_for_kind(ingredient_kind, stock_location) is
  '0245 (Touch Shop own desk). Internal: retail stock lives in the shop store and the shop store holds only retail; INVALID_ARGUMENT hint kind (detail kind@store) otherwise.';

revoke all on function app.assert_store_for_kind(ingredient_kind, stock_location) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. app.staff_home_location — re-issued from 20260926000200_stock_locations.sql:273
-- ---------------------------------------------------------------------------
create or replace function app.staff_home_location(p_role staff_role)
returns stock_location
language plpgsql stable security definer set search_path = public as $staff_home_location_0245$
begin
  return case when p_role in ('head_chef', 'chef') then 'bakery'::stock_location
              when p_role = 'shop_staff'           then 'shop'::stock_location     -- 0245
              else 'cafe'::stock_location end;
end $staff_home_location_0245$;

comment on function app.staff_home_location(staff_role) is
  'stock_locations (§2.8.4) + shop_store (0245). Internal: bakery for head_chef and chef, shop for shop_staff, cafe for every other role (and for no role).';

revoke all on function app.staff_home_location(staff_role) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.consume_for_order_item — re-issued from 20260926000200_stock_locations.sql:555
-- ---------------------------------------------------------------------------
create or replace function app.consume_for_order_item(
  p_order_item_id uuid,
  p_ticket_id     uuid default null
) returns void
language plpgsql security definer set search_path = public as $consume_for_order_item_0245$
declare
  v_oi     order_items%rowtype;
  v_order  orders%rowtype;
  v_r      record;
  v_loc    stock_location;
begin
  select * into v_oi from order_items where id = p_order_item_id;
  if not found or v_oi.voided then
    return;
  end if;
  if exists (select 1 from stock_movements
              where order_item_id = p_order_item_id and movement_type = 'sale_consumption') then
    return;                                   -- replay / duplicate ticket: already consumed
  end if;

  select * into v_order from orders where id = v_oi.order_id;

  perform app.lock_stock_ingredients(array(
    select b.ingredient_id
      from order_items oi
      cross join lateral app.order_item_bom(oi.id) b
     where oi.order_id = v_oi.order_id and not oi.voided));

  -- 0245: a shop order draws from the shop store, everything else from the
  -- cafe first (app.consume_fefo's preference).
  v_loc := case when app.order_is_shop(v_oi.order_id) then 'shop'::stock_location
                else 'cafe'::stock_location end;
  for v_r in select * from app.order_item_bom(p_order_item_id) loop
    perform app.consume_fefo_at(v_loc, v_r.ingredient_id, v_r.qty * v_oi.qty, 'sale_consumption',
                                p_order_item_id, p_ticket_id,
                                v_order.placed_by_staff_id, v_order.device_id);
  end loop;
end $consume_for_order_item_0245$;

comment on function app.consume_for_order_item(uuid, uuid) is
  '0018 + stock_locations (V15) + shop_store (0245). Internal: the sale-consumption driver, idempotent per order item (a replayed ticket never consumes twice). Takes the ingredient lock for every ingredient of the whole order first, in ingredient_id order, then consumes the item''s BOM through app.consume_fefo_at: a shop order from the shop store, any other from the cafe first. Reached from the ticket trigger and the shop sale.';

revoke all on function app.consume_for_order_item(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.trg_refund_restock — re-issued from 20260926000200_stock_locations.sql:1063
-- ---------------------------------------------------------------------------
create or replace function app.trg_refund_restock() returns trigger
language plpgsql security definer set search_path = public as $trg_refund_restock_0245$
declare
  v_r        record;
  v_batch    record;
  v_qty      numeric;
  v_refund   refunds%rowtype;
  v_line_qty int;
  v_refunded numeric;
  v_home     stock_location;
begin
  -- GUARD 1 (0043): the line was voided after send, so its stock is already
  -- recorded as waste. Crediting it back here would double-count it.
  if exists (select 1 from stock_movements
              where order_item_id = new.order_item_id
                and (movement_type = 'void_after_send'
                     or reason_code = 'retail_void_restock')) then   -- 0146: a voided retail line is already back on the shelf
    return new;
  end if;

  -- GUARD 2 (0043): never refund more units than the line holds.
  select qty into v_line_qty from order_items where id = new.order_item_id;
  select coalesce(sum(ri.qty), 0) into v_refunded
    from refund_items ri where ri.order_item_id = new.order_item_id;
  if v_line_qty is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_refunded > v_line_qty then
    raise exception 'REFUND_QTY_EXCEEDS_LINE' using errcode = 'P0001',
      detail = format('line qty %s, refunded %s', v_line_qty, v_refunded);
  end if;

  select * into v_refund from refunds where id = new.refund_id;

  for v_r in select * from app.order_item_bom(new.order_item_id) loop
    v_qty := v_r.qty * new.qty;
    -- 0245: shop stock goes back to the shop store, everything else to the cafe first.
    v_home := case when (select i.kind from ingredients i where i.id = v_r.ingredient_id) = 'retail'
                   then 'shop'::stock_location else 'cafe'::stock_location end;

    select id, unit_cost_iqd into v_batch
      from stock_batches
     where ingredient_id = v_r.ingredient_id and qty_remaining > 0
     order by (location <> v_home), received_at desc, id desc
     limit 1
     for update;

    if found then
      update stock_batches set qty_remaining = qty_remaining + v_qty where id = v_batch.id;
    else
      insert into stock_batches (ingredient_id, delivery_line_id, qty_received, qty_remaining, unit_cost_iqd, location)
      values (v_r.ingredient_id, null, v_qty, v_qty, 0, v_home)
      returning id, unit_cost_iqd into v_batch;
    end if;

    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, refund_id, staff_id, reason_code)
    values (v_r.ingredient_id, v_batch.id, 'refund_reversal', v_qty,
            v_batch.unit_cost_iqd, new.order_item_id, new.refund_id,
            v_refund.refunded_by, v_refund.reason_code);
  end loop;
  return new;
end $trg_refund_restock_0245$;

revoke all on function app.trg_refund_restock() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.receive_delivery_internal — re-issued from 20260926000200_stock_locations.sql:424
-- ---------------------------------------------------------------------------
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
language plpgsql security definer set search_path = public as $receive_delivery_internal_0245$
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
begin
  if p_venue is null or p_location is null or p_source is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
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

  return jsonb_build_object('delivery_id', v_delivery.id, 'batch_ids', to_jsonb(v_batches));
end $receive_delivery_internal_0245$;

comment on function app.receive_delivery_internal(uuid, stock_location, jsonb, text, text, text, uuid, text) is
  'stock_locations (D4). Internal: books one delivery into a store (p_source goods_in or staff_log): a delivery line, a batch and a goods_in movement per line, each naming the venue and the store; a line may carry cost_source (default entered). Takes the store''s count lock shared first. Returns {delivery_id, batch_ids}. STORE_BEING_COUNTED (hint the store: an operator count is open there), EMPTY_DELIVERY, INGREDIENT_NOT_FOUND (inactive, unknown or another venue''s), INVALID_ARGUMENT (hint kind: a shop line outside the cafe), INVALID_LINE. Reached through receive_delivery, receive_purchase (via receive_delivery) and log_stock; the caller guards, claims and audits.';

revoke all on function app.receive_delivery_internal(uuid, stock_location, jsonb, text, text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.receive_delivery — re-issued from 20260926000231_branch_scoped_reads.sql:1176
-- ---------------------------------------------------------------------------
create or replace function app.receive_delivery(p_lines jsonb, p_supplier_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text, p_supplier_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_location text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $receive_delivery_0245$
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
  if app.staff_role() = 'shop_staff' then
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
end $receive_delivery_0245$;

-- ---------------------------------------------------------------------------
-- 6. app.start_count — re-issued from 20260926000201_stock_counts_by_location.sql:66
-- ---------------------------------------------------------------------------
create or replace function app.start_count(
  p_location text default null,
  p_venue_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $start_count_0245$
declare
  v_venue uuid;
  v_loc   stock_location;
  v_count stock_counts%rowtype;
  v_lines int;
begin
  if not app.is_staff('manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner','shop_staff')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_loc := app.parse_stock_location(p_location, app.staff_home_location(app.staff_role()));
  -- 0245: the shop assistant counts the shop store only.
  if app.staff_role() = 'shop_staff' and v_loc <> 'shop' then
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
end $start_count_0245$;

comment on function app.start_count(text, uuid) is
  '0019 + stock_counts_by_location (D7) + shop_store (0245). MGMT, or the shop assistant for the shop store, at the venue: opens an operator count of one store (p_location, default the caller''s home store) under the store''s count lock, snapshotting every active ingredient of the venue at its ledger sum in that store (the shop store holds shop stock only, the cafe and bakery none). Receipts and moves into the store are refused until it is finalized or discarded. Returns {count_id, lines, started_at, location}. FORBIDDEN, INVALID_ARGUMENT (hint location), COUNT_IN_PROGRESS (a count of that store is open or waiting). Audit stock.start_count.';

revoke all on function app.start_count(text, uuid) from public, anon;
grant execute on function app.start_count(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.submit_stock_count — re-issued from 20260926000201_stock_counts_by_location.sql:126
-- ---------------------------------------------------------------------------
create or replace function app.submit_stock_count(
  p_location        text  default null,
  p_lines           jsonb default null,
  p_venue_id        uuid  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_stock_count_0245$
declare
  c_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_role   staff_role := app.staff_role();
  v_venue  uuid;
  v_loc    stock_location;
  v_el     jsonb;
  v_ing    ingredients%rowtype;
  v_qty    numeric;
  v_unit   text;
  v_seen   uuid[] := '{}';
  v_lines  jsonb := '[]'::jsonb;
  v_replay jsonb;
  v_count  stock_counts%rowtype;
  v_result jsonb;
begin
  if not app.is_staff('head_chef','chef','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_chef','chef','manager','owner','shop_staff')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
  if v_role in ('head_chef','chef') and v_loc <> 'bakery' then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;
  if v_role = 'shop_staff' and v_loc <> 'shop' then             -- 0245
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;

  -- A line is {ingredient_id, counted_qty, unit?}: unit the base unit or pack.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 300 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_el->>'ingredient_id', '(missing ingredient_id)');
    end if;
    select * into v_ing from ingredients
     where id = (v_el->>'ingredient_id')::uuid and venue_id = v_venue and is_active;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', detail = v_el->>'ingredient_id';
    end if;
    if v_ing.id = any(v_seen) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    perform app.assert_store_for_kind(v_ing.kind, v_loc);   -- 0245 (was: retail in the cafe only)
    if coalesce(jsonb_typeof(v_el->'counted_qty'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_qty := (v_el->>'counted_qty')::numeric;
    if v_qty < 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_unit := nullif(v_el->>'unit', '');
    if v_unit is not null and v_unit <> v_ing.unit::text then
      if v_unit <> 'pack' or coalesce(v_ing.pack_size, 0) <= 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit';
      end if;
      v_qty := v_qty * v_ing.pack_size;
    end if;
    v_qty := round(v_qty, 3);
    if v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_seen  := v_seen || v_ing.id;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('ingredient_id', v_ing.id, 'counted_qty', v_qty));
  end loop;

  v_replay := app.claim_replay(p_idempotency_key, 'submit_stock_count');
  if v_replay is not null then
    return v_replay;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stock_count:' || v_venue::text || ':' || v_loc::text, 0));
  if exists (select 1 from stock_counts
              where venue_id = v_venue and location = v_loc and finalized_at is null) then
    raise exception 'COUNT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  insert into stock_counts (counted_by, venue_id, location, source)
  values (auth.uid(), v_venue, v_loc, 'phone')
  returning * into v_count;

  insert into stock_count_lines (count_id, ingredient_id, theoretical_qty, counted_qty)
  select v_count.id, (x->>'ingredient_id')::uuid, t.qty, (x->>'counted_qty')::numeric
    from jsonb_array_elements(v_lines) x
    cross join lateral (select coalesce(sum(m.qty_delta), 0) as qty
                          from stock_movements m
                         where m.ingredient_id = (x->>'ingredient_id')::uuid and m.location = v_loc) t;

  perform app.write_audit('stock.submit_count', 'stock_counts', v_count.id::text, null,
                          jsonb_build_object('location', v_loc, 'lines', jsonb_array_length(v_lines)));

  v_result := jsonb_build_object('count_id', v_count.id, 'location', v_loc,
                                 'lines', jsonb_array_length(v_lines));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $submit_stock_count_0245$;

comment on function app.submit_stock_count(text, jsonb, uuid, text) is
  'stock_counts_by_location (wave 5 §2.8.5, D7). The head chef and the chef (the bakery only) and MGMT (either store) at the venue: a blind count of p_location (default the caller''s home store), p_lines [{ingredient_id, counted_qty, unit?}] (1 to 300, each once; unit the base unit or pack), saved as a phone count waiting for a manager to apply (finalize_count) or discard. Each line snapshots the store''s ledger sum at submit. Returns {count_id, location, lines} (a count, no theoretical, no variance). Idempotent by key. FORBIDDEN (also hint location); INVALID_ARGUMENT (location, lines, unit, kind: a shop product at the bakery); INVALID_QTY; INGREDIENT_NOT_FOUND; COUNT_IN_PROGRESS (a count of that store is open or waiting). Audit stock.submit_count {location, lines} (a count).';

revoke all on function app.submit_stock_count(text, jsonb, uuid, text) from public, anon;
grant execute on function app.submit_stock_count(text, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.transfer_stock — re-issued from 20260926000202_stock_transfers.sql:112
-- ---------------------------------------------------------------------------
create or replace function app.transfer_stock(
  p_from            text,
  p_to              text,
  p_lines           jsonb,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $transfer_stock_0245$
declare
  c_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_venue  uuid;
  v_from   stock_location;
  v_to     stock_location;
  v_replay jsonb;
  v_el     jsonb;
  v_ing    ingredients%rowtype;
  v_qty    numeric;
  v_unit   text;
  v_seen   uuid[] := '{}';
  v_lines  jsonb := '[]'::jsonb;
  v_busy   stock_location;
  v_id     uuid;
  v_at     timestamptz;
  v_line   record;
  v_ids    uuid[];
  v_have   numeric;
  v_left   numeric;
  v_take   numeric;
  v_src    stock_batches%rowtype;
  v_new    uuid;
  v_slices int := 0;
  v_result jsonb;
begin
  if not app.is_staff('waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_from := app.parse_stock_location(p_from, null);
  v_to   := app.parse_stock_location(p_to, null);
  if v_from is null or v_to is null or v_from = v_to
     or 'shop' in (v_from, v_to) then        -- 0245: nothing moves in or out of the shop store
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
  end if;

  -- Every line is checked before anything is locked or written: a line is
  -- {ingredient_id, qty, unit?}, unit the base unit or 'pack'.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 50 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_el->>'ingredient_id', '(missing ingredient_id)');
    end if;
    select * into v_ing from ingredients
     where id = (v_el->>'ingredient_id')::uuid and venue_id = v_venue and is_active;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', detail = v_el->>'ingredient_id';
    end if;
    if v_ing.id = any(v_seen) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if v_ing.kind = 'retail' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind', detail = v_ing.id::text;
    end if;
    if coalesce(jsonb_typeof(v_el->'qty'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_qty := (v_el->>'qty')::numeric;
    if v_qty <= 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_unit := nullif(v_el->>'unit', '');
    if v_unit is not null and v_unit <> v_ing.unit::text then
      if v_unit <> 'pack' or coalesce(v_ing.pack_size, 0) <= 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit';
      end if;
      v_qty := v_qty * v_ing.pack_size;
    end if;
    v_qty := round(v_qty, 3);
    if v_qty <= 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_seen  := v_seen || v_ing.id;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('ingredient_id', v_ing.id, 'qty', v_qty));
  end loop;

  v_replay := app.claim_replay(p_idempotency_key, 'transfer_stock');
  if v_replay is not null then
    return v_replay;
  end if;

  -- The count locks (M5), shared, both stores, in the enum's order.
  perform pg_advisory_xact_lock_shared(
    hashtextextended('stock_count:' || v_venue::text || ':' || least(v_from, v_to)::text, 0));
  perform pg_advisory_xact_lock_shared(
    hashtextextended('stock_count:' || v_venue::text || ':' || greatest(v_from, v_to)::text, 0));
  select c.location into v_busy
    from stock_counts c
   where c.venue_id = v_venue and c.location in (v_from, v_to)
     and c.source = 'operator' and c.finalized_at is null
   order by c.location
   limit 1;
  if found then
    raise exception 'STORE_BEING_COUNTED' using errcode = 'P0001', hint = v_busy::text;
  end if;

  -- The ingredient locks (V15), every line's, in ingredient_id order.
  perform app.lock_stock_ingredients(v_seen);

  insert into stock_transfers (venue_id, from_location, to_location, moved_by)
  values (v_venue, v_from, v_to, auth.uid())
  returning id, moved_at into v_id, v_at;

  for v_line in
    select (x->>'ingredient_id')::uuid as ingredient_id, (x->>'qty')::numeric as qty
      from jsonb_array_elements(v_lines) x
     order by (x->>'ingredient_id')::uuid
  loop
    -- The canonical lock pass (consume_fefo_at's), both stores, before any
    -- batch of this ingredient is touched.
    select coalesce(array_agg(l.id), '{}') into v_ids
      from (select b.id
              from stock_batches b
             where b.ingredient_id = v_line.ingredient_id and b.qty_remaining > 0
             order by b.expiry_date asc nulls last, b.received_at asc, b.id asc
               for update) l;

    select coalesce(sum(b.qty_remaining), 0) into v_have
      from stock_batches b
     where b.id = any(v_ids) and b.location = v_from;
    if v_have < v_line.qty then
      raise exception 'TRANSFER_SHORT' using errcode = 'P0001',
        hint = v_line.ingredient_id::text, detail = trim_scale(v_have)::text;
    end if;

    v_left := v_line.qty;
    for v_src in
      select b.*
        from stock_batches b
       where b.id = any(v_ids) and b.location = v_from and b.qty_remaining > 0
       order by b.expiry_date asc nulls last, b.received_at asc, b.id asc
    loop
      exit when v_left <= 0;
      v_take := least(v_left, v_src.qty_remaining);
      update stock_batches set qty_remaining = qty_remaining - v_take where id = v_src.id;
      insert into stock_batches (ingredient_id, delivery_line_id, received_at, expiry_date, qty_received, qty_remaining,
                                 unit_cost_iqd, venue_id, location, origin_batch_id)
      values (v_src.ingredient_id, null, v_src.received_at, v_src.expiry_date, v_take, v_take,
              v_src.unit_cost_iqd, v_src.venue_id, v_to, coalesce(v_src.origin_batch_id, v_src.id))
      returning id into v_new;
      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd,
                                   reason_code, staff_id, venue_id, location)
      values (v_src.ingredient_id, v_src.id, 'transfer', -v_take, v_src.unit_cost_iqd,
              'transfer:' || v_id::text, auth.uid(), v_venue, v_from),
             (v_src.ingredient_id, v_new, 'transfer', v_take, v_src.unit_cost_iqd,
              'transfer:' || v_id::text, auth.uid(), v_venue, v_to);
      v_left   := v_left - v_take;
      v_slices := v_slices + 1;
    end loop;

    insert into stock_transfer_lines (transfer_id, ingredient_id, qty)
    values (v_id, v_line.ingredient_id, v_line.qty);
  end loop;

  perform app.write_audit('stock.transfer', 'stock_transfers', v_id::text, null,
                          jsonb_build_object('from', v_from, 'to', v_to,
                                             'lines', jsonb_array_length(v_lines), 'batches', v_slices));

  v_result := jsonb_build_object('transfer_id', v_id, 'from', v_from, 'to', v_to, 'moved_at', v_at,
                                 'lines', v_lines);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $transfer_stock_0245$;

comment on function app.transfer_stock(text, text, jsonb, uuid, text) is
  'stock_transfers (wave 5 §2.8.5, D6). The waiter and MGMT at the venue: moves p_lines [{ingredient_id, qty, unit?}] (1 to 50, each ingredient once; unit the base unit or pack) from store p_from to store p_to. Lines are booked in ingredient_id order, after the ingredient locks of every line (app.lock_stock_ingredients) and each after a lock pass over all its live batches; the source''s batches are split FEFO into destination batches with the same expiry, received_at and cost, and each slice writes a transfer movement pair (reason transfer:<id>). Returns {transfer_id, from, to, moved_at, lines: [{ingredient_id, qty}]} in base units, no cost. Idempotent by key. FORBIDDEN; INVALID_ARGUMENT (hint location: the same store or an unknown one; lines; unit; kind: a shop product); INVALID_QTY; INGREDIENT_NOT_FOUND (detail the id); TRANSFER_SHORT (hint the ingredient, detail what the source shows; nothing is moved); STORE_BEING_COUNTED (hint the store). Audit stock.transfer {from, to, lines, batches} (counts).';

revoke all on function app.transfer_stock(text, text, jsonb, uuid, text) from public, anon;
grant execute on function app.transfer_stock(text, text, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.log_stock — re-issued from 20260926000203_stock_logs.sql:95
-- ---------------------------------------------------------------------------
create or replace function app.log_stock(
  p_location        text  default null,
  p_lines           jsonb default null,
  p_note            text  default null,
  p_venue_id        uuid  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $log_stock_0245$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_role    staff_role := app.staff_role();
  v_venue   uuid;
  v_loc     stock_location;
  v_kinds   text[];
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_el      jsonb;
  v_ing     ingredients%rowtype;
  v_qty     numeric;
  v_unit    text;
  v_exp     date;
  v_seen    uuid[] := '{}';
  v_payload jsonb := '[]'::jsonb;
  v_est     record;
  v_sources jsonb := jsonb_build_object('last_batch', 0, 'pack', 0, 'none', 0);
  v_replay  jsonb;
  v_made    jsonb;
  v_lines   jsonb;
  v_result  jsonb;
begin
  -- 0245: the shop assistant takes the court desk's place (shop stock, the
  -- shop store only); the cashier keeps purchased stock only.
  if not app.is_staff('head_barista','head_chef','cashier','shop_staff','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','cashier','shop_staff','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
  if v_role = 'shop_staff' and v_loc <> 'shop' then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;
  v_kinds := case
               when v_role in ('head_barista','head_chef','cashier') then array['purchased']
               when v_role = 'shop_staff'                            then array['retail']
               else                                                       array['purchased','retail']
             end;

  if length(v_note) > 200 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 50 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_el->>'ingredient_id', '(missing ingredient_id)');
    end if;
    select * into v_ing from ingredients
     where id = (v_el->>'ingredient_id')::uuid and venue_id = v_venue and is_active;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', detail = v_el->>'ingredient_id';
    end if;
    if v_ing.id = any(v_seen) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    -- Made here, not bought: a batch, never a log. A kind outside the
    -- caller's is refused the same way; 0245: shop stock only in the shop store.
    if not (v_ing.kind::text = any(v_kinds)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind', detail = v_ing.id::text;
    end if;
    perform app.assert_store_for_kind(v_ing.kind, v_loc);
    if coalesce(jsonb_typeof(v_el->'qty'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_qty := (v_el->>'qty')::numeric;
    if v_qty <= 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_unit := nullif(v_el->>'unit', '');
    if v_unit is not null and v_unit <> v_ing.unit::text then
      if v_unit <> 'pack' or coalesce(v_ing.pack_size, 0) <= 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit';
      end if;
      v_qty := v_qty * v_ing.pack_size;
    end if;
    v_qty := round(v_qty, 3);
    if v_qty <= 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_exp := null;
    if nullif(v_el->>'expiry_date', '') is not null then
      begin
        v_exp := (v_el->>'expiry_date')::date;
      exception when others then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'expiry_date';
      end;
      if v_exp < current_date then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'expiry_date';
      end if;
    end if;

    select * into v_est from app.stock_cost_estimate(v_ing.id);
    v_sources := jsonb_set(v_sources, array[v_est.cost_source],
                           to_jsonb((v_sources->>v_est.cost_source)::int + 1));
    v_seen    := v_seen || v_ing.id;
    v_payload := v_payload || jsonb_build_array(jsonb_build_object(
      'ingredient_id', v_ing.id,
      'qty_received',  v_qty,
      'unit_cost_iqd', v_est.unit_cost,
      'cost_source',   v_est.cost_source,
      'expiry_date',   v_exp));
  end loop;

  v_replay := app.claim_replay(p_idempotency_key, 'log_stock');
  if v_replay is not null then
    return v_replay;
  end if;

  v_made := app.receive_delivery_internal(v_venue, v_loc, v_payload, null, v_note, null, null, 'staff_log');

  select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', dl.ingredient_id,
                                               'qty',           dl.qty_received,
                                               'expiry_date',   dl.expiry_date)
                            order by dl.ingredient_id), '[]'::jsonb)
    into v_lines
    from delivery_lines dl
   where dl.delivery_id = (v_made->>'delivery_id')::uuid;

  perform app.write_audit('stock.log', 'deliveries', v_made->>'delivery_id', null,
                          jsonb_build_object('location', v_loc, 'lines', jsonb_array_length(v_payload),
                                             'cost_sources', v_sources));

  v_result := jsonb_build_object('delivery_id', (v_made->>'delivery_id')::uuid, 'location', v_loc,
                                 'lines', v_lines);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $log_stock_0245$;

comment on function app.log_stock(text, jsonb, text, uuid, text) is
  'stock_logs (wave 5 §2.8.5, D4-D5) + shop_store (0245). The head barista, the head chef, the cashier, the shop assistant and MGMT at the venue: adds p_lines [{ingredient_id, qty, unit?, expiry_date?}] (1 to 50, each once; unit the base unit or pack) to store p_location (default the caller''s home store) as one staff_log delivery, costed by app.stock_cost_estimate. Kinds: the heads and the cashier purchased; the shop assistant retail (the shop store only); MGMT purchased and retail. Shop stock goes to the shop store only, and only shop stock goes there; prepared stock is never logged. Returns {delivery_id, location, lines: [{ingredient_id, qty, expiry_date}]}: no cost. Idempotent by key. FORBIDDEN (also hint location: the shop assistant outside the shop store); INVALID_ARGUMENT (hints location, lines, unit, kind, expiry_date); INVALID_QTY; INGREDIENT_NOT_FOUND; TEXT_TOO_LONG (note, 200); STORE_BEING_COUNTED. Audit stock.log {location, lines, cost_sources} (counts).';

revoke all on function app.log_stock(text, jsonb, text, uuid, text) from public, anon;
grant execute on function app.log_stock(text, jsonb, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.stock_pick_list — re-issued from 20260926000204_stock_store_reads.sql:56
-- ---------------------------------------------------------------------------
create or replace function app.stock_pick_list(
  p_purpose  text,
  p_location text default null,
  p_venue_id uuid default null,
  p_query    text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $stock_pick_list_0245$
declare
  v_role  staff_role := app.staff_role();
  v_venue uuid;
  v_loc   stock_location;
  v_kinds text[];
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb;
begin
  if not app.is_staff('head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_purpose is null or p_purpose not in ('log', 'move', 'count') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'purpose';
  end if;
  if (p_purpose = 'log'   and not app.is_staff('head_barista','head_chef','cashier','shop_staff','manager','owner'))
     or (p_purpose = 'move'  and not app.is_staff('waiter','manager','owner'))
     or (p_purpose = 'count' and not app.is_staff('head_chef','chef','shop_staff','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'purpose';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_purpose = 'log' then
    v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
    if v_role = 'shop_staff' and v_loc <> 'shop' then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    v_kinds := case
                 when v_role in ('head_barista','head_chef','cashier') then array['purchased']
                 when v_role = 'shop_staff'                            then array['retail']
                 else                                                       array['purchased','retail']
               end;
  elsif p_purpose = 'move' then
    v_loc   := app.parse_stock_location(p_location, 'cafe');
    v_kinds := array['purchased','prepared'];
  else
    v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
    if v_role in ('head_chef','chef') and v_loc <> 'bakery' then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    if v_role = 'shop_staff' and v_loc <> 'shop' then          -- 0245
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    v_kinds := array['purchased','prepared','retail'];
  end if;
  -- 0245: shop stock lives in the shop store only, and the shop store holds nothing else.
  if v_loc = 'shop' then
    v_kinds := array(select k from unnest(v_kinds) k where k = 'retail');
  else
    v_kinds := array_remove(v_kinds, 'retail');
  end if;

  -- A typed search matches either name, anywhere in it. % and _ are escaped,
  -- so a query is text and never a pattern.
  if v_q is not null then
    v_q := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(jsonb_agg(
           case when p_purpose = 'move'
                then jsonb_build_object('ingredient_id', x.id, 'name_en', x.name_en, 'name_ar', x.name_ar,
                                        'unit', x.unit, 'kind', x.kind, 'pack_size', x.pack_size,
                                        'on_hand', x.on_hand)
                else jsonb_build_object('ingredient_id', x.id, 'name_en', x.name_en, 'name_ar', x.name_ar,
                                        'unit', x.unit, 'kind', x.kind, 'pack_size', x.pack_size)
           end
           order by lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.name_en, i.name_ar, i.unit::text as unit, i.kind::text as kind, i.pack_size, oh.on_hand
            from ingredients i
            cross join lateral (
              select coalesce(sum(b.qty_remaining), 0) as on_hand
                from stock_batches b
               where b.ingredient_id = i.id and b.location = v_loc and b.qty_remaining > 0) oh
           where i.venue_id = v_venue
             and i.is_active
             and i.kind::text = any(v_kinds)
             and (v_q is null or i.name_en ilike v_q or i.name_ar ilike v_q)
             and (p_purpose <> 'move' or oh.on_hand > 0)
           order by lower(i.name_en), i.id
           limit 300) x;

  return jsonb_build_object('purpose', p_purpose, 'location', v_loc, 'items', v_items);
end $stock_pick_list_0245$;

comment on function app.stock_pick_list(text, text, uuid, text) is
  'stock_store_reads (wave 5 §2.8.5). What the phone''s store pages may name, per purpose, at the venue: log (LOG: the caller''s log kinds, shop stock only at the cafe; default the caller''s home store; the desk is refused the bakery), move (MOVE: purchased and prepared stock held at the source store p_location, default cafe, with on_hand there), count (COUNT: names and units only; the bakery leaves shop stock out; the head chef and chef count the bakery only). Returns {purpose, location, items: [{ingredient_id, name_en, name_ar, unit, kind, pack_size, on_hand?}]}, at most 300, by English name, p_query on either name. No cost. FORBIDDEN (also hints purpose, location); INVALID_ARGUMENT (purpose, location).';

revoke all on function app.stock_pick_list(text, text, uuid, text) from public, anon;
grant execute on function app.stock_pick_list(text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. app.stock_today — re-issued from 20260926000204_stock_store_reads.sql:155
-- ---------------------------------------------------------------------------
create or replace function app.stock_today(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $stock_today_0245$
declare
  v_role      staff_role := app.staff_role();
  v_venue     uuid;
  v_tz        text;
  v_start     int := coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4);
  v_day       date;
  v_from      timestamptz;
  v_kinds     text[];
  v_stores    stock_location[];
  v_transfers jsonb;
  v_logs      jsonb;
  v_waiting   int;
  v_counts    jsonb;
begin
  if not app.is_staff('head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_tz   := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
  v_day  := app.venue_business_date(v_venue, now());
  v_from := (v_day + make_interval(hours => v_start)) at time zone v_tz;

  if v_role in ('waiter','manager','owner') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'transfer_id',   t.id,
             'from',          t.from_location,
             'to',            t.to_location,
             'moved_by_name', s.display_name,
             'moved_at',      t.moved_at,
             'lines',         (select coalesce(jsonb_agg(jsonb_build_object(
                                        'ingredient_id', l.ingredient_id,
                                        'name_en',       i.name_en,
                                        'name_ar',       i.name_ar,
                                        'unit',          i.unit,
                                        'qty',           l.qty)
                                      order by lower(i.name_en), i.id), '[]'::jsonb)
                                 from stock_transfer_lines l
                                 join ingredients i on i.id = l.ingredient_id
                                where l.transfer_id = t.id))
           order by t.moved_at desc, t.id), '[]'::jsonb)
      into v_transfers
      from stock_transfers t
      join staff s on s.id = t.moved_by
     where t.venue_id = v_venue
       and t.moved_at >= v_from and t.moved_at < v_from + interval '1 day';
  end if;

  -- 0245: the LOG list follows log_stock (shop_staff for court_desk, the cashier purchased only).
  if v_role in ('head_barista','head_chef','cashier','shop_staff','manager','owner') then
    v_kinds := case
                 when v_role in ('head_barista','head_chef','cashier') then array['purchased']
                 when v_role = 'shop_staff'                            then array['retail']
                 else                                                       array['purchased','retail']
               end;
    select coalesce(jsonb_agg(d.row order by d.received_at desc, d.id), '[]'::jsonb)
      into v_logs
      from (select dv.id, dv.received_at,
                   jsonb_build_object('delivery_id',      dv.id,
                                      'location',         dv.location,
                                      'source',           dv.source,
                                      'received_by_name', s.display_name,
                                      'received_at',      dv.received_at,
                                      'lines',            ln.lines) as row
              from deliveries dv
              join staff s on s.id = dv.received_by
              cross join lateral (
                select jsonb_agg(jsonb_build_object('ingredient_id', dl.ingredient_id,
                                                    'name_en',       i.name_en,
                                                    'name_ar',       i.name_ar,
                                                    'unit',          i.unit,
                                                    'qty',           dl.qty_received,
                                                    'expiry_date',   dl.expiry_date)
                                 order by lower(i.name_en), i.id) as lines
                  from delivery_lines dl
                  join ingredients i on i.id = dl.ingredient_id
                 where dl.delivery_id = dv.id and i.kind::text = any(v_kinds)) ln
             where dv.venue_id = v_venue
               and dv.received_at >= v_from and dv.received_at < v_from + interval '1 day'
               and ln.lines is not null) d;

    -- 0245: the driver buys for the cafe; the shop assistant has none waiting.
    if v_role <> 'shop_staff' then
      select count(*) into v_waiting
        from purchases p
       where p.venue_id = v_venue and p.delivered_at is not null and p.status = 'to_receive';
    end if;
  end if;

  if v_role in ('head_chef','chef','shop_staff','manager','owner') then
    v_stores := case when v_role in ('head_chef','chef') then array['bakery']::stock_location[]
                     when v_role = 'shop_staff'           then array['shop']::stock_location[]   -- 0245
                     else enum_range(null::stock_location) end;
    select coalesce(jsonb_agg(jsonb_build_object(
             'count_id',        c.id,
             'location',        c.location,
             'status',          case when c.finalized_at is null then 'waiting' else 'applied' end,
             'counted_by_name', s.display_name,
             'submitted_at',    c.started_at,
             'applied_at',      c.finalized_at,
             'lines',           (select coalesce(jsonb_agg(jsonb_build_object(
                                          'ingredient_id', l.ingredient_id,
                                          'name_en',       i.name_en,
                                          'name_ar',       i.name_ar,
                                          'unit',          i.unit,
                                          'counted_qty',   l.counted_qty)
                                        order by lower(i.name_en), i.id), '[]'::jsonb)
                                   from stock_count_lines l
                                   join ingredients i on i.id = l.ingredient_id
                                  where l.count_id = c.id))
           order by c.started_at desc, c.id), '[]'::jsonb)
      into v_counts
      from stock_counts c
      join staff s on s.id = c.counted_by
     where c.venue_id = v_venue
       and c.source = 'phone'
       and c.location = any(v_stores)
       and c.started_at >= now() - interval '30 days';
  end if;

  return jsonb_build_object('business_date',             v_day,
                            'transfers',                 v_transfers,
                            'logs',                      v_logs,
                            'driver_deliveries_waiting', v_waiting,
                            'counts',                    v_counts);
end $stock_today_0245$;

comment on function app.stock_today(uuid) is
  'stock_store_reads (wave 5 §2.8.5). MOVE, LOG or COUNT at the venue, for the business day: {business_date, transfers (MOVE: [{transfer_id, from, to, moved_by_name, moved_at, lines: [{ingredient_id, name_en, name_ar, unit, qty}]}]), logs (LOG: every delivery of the day cut to the kinds the caller may log, [{delivery_id, location, source, received_by_name, received_at, lines: [{ingredient_id, name_en, name_ar, unit, qty, expiry_date}]}]), driver_deliveries_waiting (LOG: purchases delivered and still to receive), counts (COUNT: phone counts of the last 30 days at the stores the caller counts, [{count_id, location, status waiting|applied, counted_by_name, submitted_at, applied_at, lines: [{ingredient_id, name_en, name_ar, unit, counted_qty}]}])}; a section outside the caller''s roles is null. No cost, supplier, note, theoretical or variance. FORBIDDEN for anyone else.';

revoke all on function app.stock_today(uuid) from public, anon;
grant execute on function app.stock_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. app.staff_stock_view — re-issued from 20260926000204_stock_store_reads.sql:293
-- ---------------------------------------------------------------------------
create or replace function app.staff_stock_view(
  p_venue_id uuid default null,
  p_kind     text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $staff_stock_view_0245$
declare
  v_venue uuid;
  v_role  staff_role := app.staff_role();
  v_kinds text[];
  v_items jsonb;
begin
  if not app.is_staff('head_barista','head_chef','shop_staff','waiter','manager','owner') then   -- 0245: shop_staff for court_desk
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','shop_staff','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_kinds := case
               when v_role in ('manager','owner')                   then array['purchased','prepared','retail']
               when v_role in ('head_barista','head_chef','waiter') then array['purchased','prepared']
               when v_role = 'shop_staff'                           then array['retail']
             end;
  if p_kind is not null then
    if p_kind not in ('purchased','prepared','retail') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
    end if;
    if not (p_kind = any(v_kinds)) then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'kind';
    end if;
    v_kinds := array[p_kind];
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredient_id',       x.id,
           'kind',                x.kind,
           'name_en',             x.name_en,
           'name_ar',             x.name_ar,
           'unit',                x.unit,
           'pack_size',           x.pack_size,
           'on_hand',             x.on_hand,
           'par_level',           x.par_level,
           'low_stock_threshold', x.low_stock_threshold,
           'low',                 x.low,
           'below_par',           x.below_par,
           'next_expiry',         x.next_expiry,
           'product',             x.product,
           'by_location',         jsonb_build_object('cafe', x.on_hand_cafe, 'bakery', x.on_hand_bakery,
                                                     'shop', x.on_hand_shop))   -- 0245
         order by x.low desc, lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.kind::text as kind, i.name_en, i.name_ar, i.unit::text as unit, i.pack_size,
                 oh.on_hand, i.par_level, i.low_stock_threshold,
                 (i.low_stock_threshold is not null and oh.on_hand <= i.low_stock_threshold) as low,
                 (i.par_level is not null and oh.on_hand < i.par_level) as below_par,
                 oh.next_expiry, oh.on_hand_cafe, oh.on_hand_bakery, oh.on_hand_shop,
                 pr.product
            from ingredients i
            cross join lateral (
              select coalesce(sum(b.qty_remaining), 0) as on_hand,
                     min(b.expiry_date) as next_expiry,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'cafe'), 0) as on_hand_cafe,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'bakery'), 0) as on_hand_bakery,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'shop'), 0) as on_hand_shop
                from stock_batches b
               where b.ingredient_id = i.id and b.qty_remaining > 0) oh
            -- A retail ingredient backs one shop size, through its recipe line.
            left join lateral (
              select jsonb_build_object('menu_item_id', mi.id,
                                        'name_en',      mi.name_en,
                                        'name_ar',      mi.name_ar,
                                        'size_name_en', v.name_en,
                                        'size_name_ar', v.name_ar) as product
                from recipe_lines rl
                join menu_item_variants v on v.id = rl.variant_id
                join menu_items mi on mi.id = v.item_id
               where i.kind = 'retail' and rl.ingredient_id = i.id
               order by rl.id
               limit 1) pr on true
           where i.venue_id = v_venue
             and i.is_active
             and i.kind::text = any(v_kinds)) x;

  return jsonb_build_object('as_of', now(), 'items', v_items);
end $staff_stock_view_0245$;

comment on function app.staff_stock_view(uuid, text) is
  'staff_stock_view (§2.24.5, #68) + stock_store_reads (wave 5 §2.8.5) + shop_store (0245). The head barista, the head chef and the waiter (purchased and prepared), the shop assistant (retail, with the shop product and size each row backs) and MGMT (all three) at the venue: {as_of, items: [{ingredient_id, kind, name_en, name_ar, unit, pack_size, on_hand, par_level, low_stock_threshold, low, below_par, next_expiry, product, by_location: {cafe, bakery, shop}}]}, active ingredients, low first, then by name. on_hand is the sum of stock_batches.qty_remaining and by_location splits it by store; low is on_hand at or under the threshold; below_par is strictly under par. No cost, price, supplier or delivery. FORBIDDEN for anyone else and (hint kind) for a kind outside the caller''s; INVALID_ARGUMENT (hint kind) for an unknown kind.';

revoke all on function app.staff_stock_view(uuid, text) from public, anon;
grant execute on function app.staff_stock_view(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. app.record_waste — re-issued from 20260926000217_cross_venue_guards.sql:1772
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
language plpgsql security definer set search_path = public as $record_waste_0245$
declare
  v_venue uuid;
  v_replay jsonb;
  v_loc    stock_location;
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
  v_loc := app.parse_stock_location(p_location, app.staff_home_location(app.staff_role()));
  -- 0245: the shop assistant writes off shop stock at the shop store only, and
  -- shop stock is written off there and nowhere else.
  if app.staff_role() = 'shop_staff' and v_loc <> 'shop' then
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
end $record_waste_0245$;

-- ---------------------------------------------------------------------------
-- 14. app.record_production_internal — re-issued from 20260926000200_stock_locations.sql:865
-- ---------------------------------------------------------------------------
create or replace function app.record_production_internal(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_expiry_date   date,
  p_device_id     text,
  p_location      stock_location default 'bakery'
) returns jsonb
language plpgsql security definer set search_path = public as $record_production_internal_0245$
declare
  v_ing      ingredients%rowtype;
  v_r        record;
  v_cost     numeric := 0;
  v_unit     numeric;
  v_expiry   date;
  v_batch_id uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;
  select * into v_ing from ingredients where id = p_ingredient_id and is_active;
  if not found or v_ing.kind <> 'prepared' then
    raise exception 'NOT_PREPARED' using errcode = 'P0001',
      hint = 'production applies to active prepared ingredients only';
  end if;
  perform app.assert_store_for_kind(v_ing.kind, p_location);   -- 0245: never the shop store
  if not exists (select 1 from recipe_lines where output_ingredient_id = p_ingredient_id) then
    raise exception 'NO_RECIPE' using errcode = 'P0001';
  end if;

  for v_r in
    select rl.ingredient_id, sum(rl.qty / (i.yield_percent / 100.0)) as qty
      from recipe_lines rl
      join ingredients i on i.id = rl.ingredient_id
     where rl.output_ingredient_id = p_ingredient_id
     group by rl.ingredient_id
     order by rl.ingredient_id
  loop
    v_cost := v_cost + app.consume_fefo_at(p_location, v_r.ingredient_id, v_r.qty * p_qty, 'production_consume',
                                           null, null, auth.uid(), p_device_id);
  end loop;

  v_unit := round(v_cost / p_qty, 4);

  v_expiry := coalesce(p_expiry_date,
    case when v_ing.shelf_life_days is not null then current_date + v_ing.shelf_life_days end);

  insert into stock_batches (ingredient_id, delivery_line_id, expiry_date, qty_received, qty_remaining, unit_cost_iqd,
                             location)
  values (p_ingredient_id, null, v_expiry, p_qty, p_qty, v_unit,
          p_location)
  returning id into v_batch_id;

  insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                               unit_cost_iqd, staff_id, device_id)
  values (p_ingredient_id, v_batch_id, 'production_in', p_qty, v_unit, auth.uid(), p_device_id);

  perform app.write_audit('stock.record_production', 'ingredients', p_ingredient_id::text,
                          null, jsonb_build_object('qty', p_qty, 'batch_id', v_batch_id,
                                                   'unit_cost_iqd', v_unit, 'location', p_location),
                          null, null, p_device_id);

  return jsonb_build_object('batch_id', v_batch_id, 'unit_cost_iqd', v_unit, 'expiry_date', v_expiry);
end $record_production_internal_0245$;

comment on function app.record_production_internal(uuid, numeric, date, text, stock_location) is
  'staff_production (§2.16) + stock_locations (D3). Internal: the 0018 record_production body without its guard. Consumes the prepared ingredient''s components FEFO from p_location first (default bakery), then the other store (production_consume), creates a production_in batch in p_location costed at what this call consumed (consume_fefo_at''s own total), audits stock.record_production (+ location) and returns {batch_id, unit_cost_iqd, expiry_date}. INVALID_QTY, NOT_PREPARED, NO_RECIPE. Reached only through app.record_production (MGMT) and app.record_batch (the chefs and MGMT; the bakery).';

revoke all on function app.record_production_internal(uuid, numeric, date, text, stock_location) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 15. app.finalize_count — re-issued from 20260926000201_stock_counts_by_location.sql:251
-- ---------------------------------------------------------------------------
create or replace function app.finalize_count(
  p_count_id  uuid,
  p_lines     jsonb default '[]'::jsonb,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $finalize_count_0245$
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
  if app.staff_role() = 'shop_staff' and v_count.location <> 'shop' then
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
end $finalize_count_0245$;

comment on function app.finalize_count(uuid, jsonb, text) is
  '0019/0044 + stock_counts_by_location (D7) + shop_store (0245). MGMT, or the shop assistant for a count of the shop store, at the count''s venue: applies an operator count or a waiting phone count. p_lines [{ingredient_id, counted_qty}] overwrite the counted quantities (COUNT_LINE_NOT_FOUND for an ingredient not in the count); every drifted line is reconciled at the count''s store with count_adjustment movements (a shortage FEFO with any rest batch-less, a surplus into that store''s newest live batch or a new one). Returns {count_id, adjusted_lines, finalized_at, location}. FORBIDDEN, COUNT_NOT_FOUND (also another venue''s), COUNT_FINALIZED, INVALID_LINE. Audit stock.finalize_count.';

revoke all on function app.finalize_count(uuid, jsonb, text) from public, anon;
grant execute on function app.finalize_count(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. app.discard_count — re-issued from 20260926000201_stock_counts_by_location.sql:398
-- ---------------------------------------------------------------------------
create or replace function app.discard_count(p_count_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $discard_count_0245$
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
  if app.staff_role() = 'shop_staff' and v_count.location <> 'shop' then
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
end $discard_count_0245$;

comment on function app.discard_count(uuid) is
  'stock_counts_by_location (wave 5 §2.8.5, D7) + shop_store (0245). MGMT, or the shop assistant for a count of the shop store, at the count''s venue: deletes a count that was never applied (an operator count left open, or a phone count not worth applying), with its lines; stock is untouched. Returns {count_id, discarded: true}. FORBIDDEN, COUNT_NOT_FOUND (also another venue''s, or already discarded), COUNT_FINALIZED. Audit stock.discard_count {location, source, lines}.';

revoke all on function app.discard_count(uuid) from public, anon;
grant execute on function app.discard_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 17. Reads for the shop assistant: the shop store's stock and nothing else.
--     New permissive policies beside the MGMT ones (unchanged), same venue
--     axis and (select …) wrapping as 0231/0234.
-- ---------------------------------------------------------------------------
drop policy if exists ingredients_shop_staff_read on ingredients;
create policy ingredients_shop_staff_read on ingredients for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and kind = 'retail'
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists stock_batches_shop_staff_read on stock_batches;
create policy stock_batches_shop_staff_read on stock_batches for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and location = 'shop'
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists stock_movements_shop_staff_read on stock_movements;
create policy stock_movements_shop_staff_read on stock_movements for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and location = 'shop'
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists deliveries_shop_staff_read on deliveries;
create policy deliveries_shop_staff_read on deliveries for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and location = 'shop'
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists delivery_lines_shop_staff_read on delivery_lines;
create policy delivery_lines_shop_staff_read on delivery_lines for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and exists (select 1 from deliveries d
                      where d.id = delivery_lines.delivery_id and d.location = 'shop'
                        and d.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists stock_counts_shop_staff_read on stock_counts;
create policy stock_counts_shop_staff_read on stock_counts for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and location = 'shop'
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists stock_count_lines_shop_staff_read on stock_count_lines;
create policy stock_count_lines_shop_staff_read on stock_count_lines for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and exists (select 1 from stock_counts c
                      where c.id = stock_count_lines.count_id and c.location = 'shop'
                        and c.venue_id = any ((select app.visible_venue_ids())::uuid[])));

drop policy if exists suppliers_shop_staff_read on suppliers;
create policy suppliers_shop_staff_read on suppliers for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and venue_id = any ((select app.visible_venue_ids())::uuid[]));

drop policy if exists recipe_lines_shop_staff_read on recipe_lines;
create policy recipe_lines_shop_staff_read on recipe_lines for select to authenticated
  using ((select app.is_staff('shop_staff'))
         and exists (select 1 from ingredients i
                      where i.id = recipe_lines.ingredient_id and i.kind = 'retail'
                        and i.venue_id = any ((select app.visible_venue_ids())::uuid[])));

-- ---------------------------------------------------------------------------
-- 18. Data: shop stock already booked in the cafe moves to the shop store.
--     Expected to touch no row on hosted (the client never sent products and
--     0190 emptied the stock), but written to be exact and re-runnable: each
--     live retail batch outside the shop gets a paired transfer (out at its
--     store, in at the shop) and then changes store. A retail batch in an
--     open count is left alone and reported, so the count is not broken.
-- ---------------------------------------------------------------------------
do $retail_to_shop_0245$
declare
  v_b     record;
  v_moved int := 0;
  v_held  int := 0;
begin
  for v_b in
    select b.id, b.ingredient_id, b.qty_remaining, b.unit_cost_iqd, b.location, b.venue_id
      from stock_batches b
      join ingredients i on i.id = b.ingredient_id
     where i.kind = 'retail' and b.location <> 'shop'
     order by b.id
       for update of b
  loop
    if exists (select 1 from stock_counts c
                where c.venue_id = v_b.venue_id and c.location = v_b.location
                  and c.finalized_at is null) then
      v_held := v_held + 1;
      continue;
    end if;
    if v_b.qty_remaining > 0 then
      perform set_config('app.venue_id', v_b.venue_id::text, true);
      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd,
                                   reason_code, location)
      values (v_b.ingredient_id, v_b.id, 'transfer', -v_b.qty_remaining, v_b.unit_cost_iqd,
              'shop_store_move', v_b.location);
      update stock_batches set location = 'shop' where id = v_b.id;
      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta, unit_cost_iqd,
                                   reason_code, location)
      values (v_b.ingredient_id, v_b.id, 'transfer', v_b.qty_remaining, v_b.unit_cost_iqd,
              'shop_store_move', 'shop');
    else
      update stock_batches set location = 'shop' where id = v_b.id;
    end if;
    v_moved := v_moved + 1;
  end loop;
  raise notice '0245 shop_store: % retail batch(es) moved to the shop store, % held by an open count', v_moved, v_held;
end
$retail_to_shop_0245$;
