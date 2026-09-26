-- 0200 stock_locations — two stores at every venue, the cafe and the bakery:
-- every batch and movement names its store, each use draws from its own store
-- first, and every path that adds stock says which store it goes into.
--
-- Feature: protocols and the staff phone, wave 5, lane S
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8.1-§2.8.6, §2.10,
-- §2.11, §7.4; Majed's answer #8 and its same-evening UPDATE).
-- Depends on: stock_transfer_movement (S: the 'transfer' value that
-- trg_low_stock_alert skips).
-- Re-runnable: the type and every constraint in guarded DO blocks, add column
-- if not exists, create or replace, drop function if exists + create, drop
-- trigger if exists + create trigger, on conflict do nothing.
--
-- APPLY AT A QUIET HOUR (§7.4). Adding the columns takes a brief ACCESS
-- EXCLUSIVE lock on stock_batches, stock_movements, stock_counts, deliveries
-- and delivery_lines. With lock_timeout 3s the apply fails under till load
-- instead of stalling; re-run it. Nothing is rewritten: each new column has a
-- constant default, stored as the column's missing value, so no row is
-- touched, stock_movements_ao never fires and pg_class.relfilenode of every
-- table stays the same (checked on the local stack, and by
-- stock-locations.test.ts on the same DDL shape).
--
-- THE STORES (D1, PROPOSAL). stock_location is an enum, ('cafe','bakery');
-- both exist at every venue. A third store is an add value in its own file.
-- Everything booked before this migration is in the cafe, so on day one a
-- manager records an opening move of the bakery's shelf (§7.4 step 5).
--
-- A MOVEMENT'S STORE IS ITS BATCH'S (D2). stock_movements_location sets
-- new.location from the batch whenever batch_id is set, whatever the writer
-- said. A batch-less row (an overdraft, a count shortage past the batches)
-- keeps what the writer passed. So write_off_expired and the void triggers
-- need no re-issue: the 0018:10-16 precedent, stock wired by trigger.
--
-- WHICH STORE EACH USE DRAWS FROM (D3). app.consume_fefo_at first takes the
-- ingredient's lock (below), then locks every live batch of the ingredient,
-- in both stores, in one canonical order (expiry_date asc nulls last,
-- received_at asc, id asc); only then does it consume, preferred store first
-- by FEFO, then the other. It overdraws only when the whole venue is short,
-- with the batch-less row at the preferred store and one negative_stock alert
-- whose payload names it. The id tie-break matters: a transferred batch
-- copies expiry and received_at. It returns what it booked (quantity times
-- unit cost), so a production is costed from its own rows only.
--
-- THE INGREDIENT LOCK (V15, review 2026-09-26). app.lock_stock_ingredients
-- takes a transaction advisory lock per ingredient, in ingredient_id order.
-- consume_fefo_at, transfer_stock, finalize_count and price_logged_stock
-- take it before they read a batch. A row lock alone is not enough: a sale
-- that waits on a batch a move is emptying reads its batch list before the
-- move commits, finds the source empty and never sees the batch the move
-- made, so it wrote an overdraft while the other store held the stock. A
-- writer that touches several ingredients takes all of them first, in one
-- call: app.consume_for_order_item takes its whole order's (a two-item
-- ticket whose items run against ingredient order met a two-line move in
-- 40P01), and the product test takes all its servings'.
--   sale                      cafe (consume_fefo is now its cafe wrapper)
--   production                bakery by default (PROPOSAL, §8 Q18); the
--                             batch it makes lands there too
--   waste                     the named store, else the caller's home
--   product test              the submitter's home: the bakery for head_chef
--                             and chef, otherwise the cafe
--   refund restock            the newest cafe batch first
-- Availability, low stock and out of stock stay venue-wide (PROPOSAL):
-- trg_low_stock_alert only learns to ignore a transfer, which never changes
-- the venue's on-hand. With all stock in the cafe every figure is today's.
--
-- RECEIVING NAMES A STORE (D4). Goods in (receive_delivery) and "Bought by
-- the driver" (receive_purchase) take p_location, default cafe. Both reach
-- the one internal, app.receive_delivery_internal, which S's log_stock also
-- uses. The internal:
--   * refuses an ingredient of another venue (INGREDIENT_NOT_FOUND,
--     PROPOSAL tightening; 0145 had no venue check);
--   * keeps shop (retail) stock in the cafe only (V14): a retail line at the
--     bakery is INVALID_ARGUMENT hint kind. Transfers refuse shop products
--     and the bakery count leaves them out, so a shop product booked into the
--     bakery could never be moved or counted there;
--   * respects a manager's count (M5, V19): it takes the store's count lock
--     shared, then refuses with STORE_BEING_COUNTED (hint the store) while an
--     operator count is open there. A phone count waiting for a manager does
--     not block. The key is hashtextextended('stock_count:<venue>:<store>',
--     0); start_count and submit_stock_count take it exclusively.
--
-- RE-ISSUED, each from its latest body with the change named beside it and
-- nothing else (re-checked with the §2.10 command): consume_fefo (0018:83),
-- consume_for_order_item (0018:213), receive_delivery (0145:242),
-- receive_purchase (0166:678), record_production_internal (0167:38),
-- record_production (0167:111), record_waste (0049:356),
-- protocol_submit_product_release_test (0172:1112), trg_refund_restock
-- (0146:245), trg_low_stock_alert (0151:36). Every new
-- parameter defaults, so an older operator keeps working: its Goods in and
-- waste go to the cafe and its production to the bakery. record_batch calls
-- record_production_internal with four positional arguments and is not
-- re-issued.
--
-- covered by packages/db/tests/stock-locations.test.ts, and the store cases
-- of staff-production, product-release and shopping-purchases .test.ts; the
-- ingredient lock by the committed races in stock-transfers.test.ts and
-- stock-locations.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The type.
-- ---------------------------------------------------------------------------
do $stock_location_type_0200$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'stock_location' and n.nspname = 'public') then
    create type public.stock_location as enum ('cafe', 'bakery');
  end if;
end $stock_location_type_0200$;

comment on type stock_location is
  'stock_locations (wave 5 §2.8, D1): the two stores every venue has. cafe holds the counter and the shop; bakery is the kitchen''s own store, which Rusul logs into and counts. Stock moves between them only through app.transfer_stock.';

-- ---------------------------------------------------------------------------
-- 2. The columns. Constant defaults: no rewrite, no row touched.
-- ---------------------------------------------------------------------------
alter table stock_batches   add column if not exists location        stock_location not null default 'cafe';
alter table stock_batches   add column if not exists origin_batch_id uuid;
alter table stock_movements add column if not exists location        stock_location not null default 'cafe';
alter table stock_counts    add column if not exists location        stock_location not null default 'cafe';
alter table stock_counts    add column if not exists source          text not null default 'operator';
alter table deliveries      add column if not exists location        stock_location not null default 'cafe';
alter table deliveries      add column if not exists source          text not null default 'goods_in';
alter table delivery_lines  add column if not exists cost_source     text not null default 'entered';

do $add_constraints_0200$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'stock_batches_origin_batch_id_fkey'
                    and conrelid = 'public.stock_batches'::regclass) then
    alter table stock_batches
      add constraint stock_batches_origin_batch_id_fkey
      foreign key (origin_batch_id) references stock_batches(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'stock_counts_source_chk'
                    and conrelid = 'public.stock_counts'::regclass) then
    alter table stock_counts
      add constraint stock_counts_source_chk
      check (source in ('operator', 'phone')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'deliveries_source_chk'
                    and conrelid = 'public.deliveries'::regclass) then
    alter table deliveries
      add constraint deliveries_source_chk
      check (source in ('goods_in', 'staff_log')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'delivery_lines_cost_source_chk'
                    and conrelid = 'public.delivery_lines'::regclass) then
    alter table delivery_lines
      add constraint delivery_lines_cost_source_chk
      check (cost_source in ('entered', 'last_batch', 'pack', 'none')) not valid;
  end if;
end $add_constraints_0200$;

do $validate_constraints_0200$
begin
  if exists (select 1 from pg_constraint
              where conname = 'stock_batches_origin_batch_id_fkey'
                and conrelid = 'public.stock_batches'::regclass and not convalidated) then
    alter table stock_batches validate constraint stock_batches_origin_batch_id_fkey;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'stock_counts_source_chk'
                and conrelid = 'public.stock_counts'::regclass and not convalidated) then
    alter table stock_counts validate constraint stock_counts_source_chk;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'deliveries_source_chk'
                and conrelid = 'public.deliveries'::regclass and not convalidated) then
    alter table deliveries validate constraint deliveries_source_chk;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'delivery_lines_cost_source_chk'
                and conrelid = 'public.delivery_lines'::regclass and not convalidated) then
    alter table delivery_lines validate constraint delivery_lines_cost_source_chk;
  end if;
end $validate_constraints_0200$;

comment on column stock_batches.location is
  'stock_locations (D1): the store the batch sits in, cafe or bakery. Set by whoever creates the batch (a receipt, a production, a transfer, a count surplus); everything booked before wave 5 is in the cafe.';
comment on column stock_batches.origin_batch_id is
  'stock_locations (D6): for a batch made by app.transfer_stock, the batch the stock was first booked into (always the root, never an intermediate copy), so a cost correction reaches every copy. NULL for any other batch.';
comment on column stock_movements.location is
  'stock_locations (D2): the store the movement happened in. For a row with a batch it is the batch''s store, set by the stock_movements_location trigger whatever the writer passed; a batch-less row (an overdraft or a count shortage past the batches) keeps the writer''s.';
comment on column stock_counts.location is
  'stock_locations (D7): the store the count is of. One count in progress or waiting per venue and store.';
comment on column stock_counts.source is
  'stock_locations (D7): operator (a manager''s count started with app.start_count, which blocks receipts and moves into the store while open) or phone (a blind count sent with app.submit_stock_count, waiting for a manager to apply or discard it; it blocks nothing).';
comment on column deliveries.location is
  'stock_locations (D4): the store the delivery was booked into.';
comment on column deliveries.source is
  'stock_locations (D4): goods_in (a manager''s Goods in or a received driver purchase) or staff_log (stock added by staff through app.log_stock, costed by estimate until a manager prices it).';
comment on column delivery_lines.cost_source is
  'stock_locations (D5): where unit_cost_iqd came from. entered (typed by a manager, or a driver purchase''s price), or, for a staff log, last_batch (the latest batch with a cost above 0), pack (pack cost / pack size) or none (0, which Setup flags until a manager sets it).';

-- ---------------------------------------------------------------------------
-- 3. A movement's store is its batch's (D2).
-- ---------------------------------------------------------------------------
create or replace function app.trg_stock_movement_location() returns trigger
language plpgsql security definer set search_path = public as $trg_stock_movement_location_0200$
begin
  -- An unknown batch keeps the writer's value, so the foreign key still names
  -- the real error.
  if new.batch_id is not null then
    new.location := coalesce((select b.location from stock_batches b where b.id = new.batch_id), new.location);
  end if;
  return new;
end $trg_stock_movement_location_0200$;

comment on function app.trg_stock_movement_location() is
  'stock_locations (D2). BEFORE INSERT on stock_movements: a movement with a batch takes the batch''s store, overriding the writer; a batch-less row keeps what the writer passed (default cafe).';

revoke all on function app.trg_stock_movement_location() from public, anon, authenticated;

drop trigger if exists stock_movements_location on stock_movements;
create trigger stock_movements_location
  before insert on stock_movements
  for each row execute function app.trg_stock_movement_location();

-- ---------------------------------------------------------------------------
-- 4. v_stock_by_location — per store, beside v_ingredient_on_hand's venue
--    totals. No cost column; the base tables' RLS makes it MGMT at the venue.
-- ---------------------------------------------------------------------------
create or replace view v_stock_by_location with (security_invoker = on) as
select i.id                          as ingredient_id,
       i.venue_id,
       i.name_en,
       i.name_ar,
       i.unit,
       i.kind,
       s.location,
       coalesce(b.on_hand, 0)        as on_hand,
       coalesce(m.theoretical, 0)    as theoretical,
       i.is_active
  from ingredients i
  cross join unnest(enum_range(null::stock_location)) as s(location)
  left join (select sb.ingredient_id, sb.location, sum(sb.qty_remaining) as on_hand
               from stock_batches sb
              where sb.qty_remaining > 0
              group by sb.ingredient_id, sb.location) b
    on b.ingredient_id = i.id and b.location = s.location
  left join (select sm.ingredient_id, sm.location, sum(sm.qty_delta) as theoretical
               from stock_movements sm
              group by sm.ingredient_id, sm.location) m
    on m.ingredient_id = i.id and m.location = s.location;

comment on view v_stock_by_location is
  'stock_locations (§2.8.3): one row per ingredient and store. Summed over the stores, on_hand and theoretical equal v_ingredient_on_hand''s. No cost. security_invoker: MGMT at the venue through the base tables'' policies.';
comment on column v_stock_by_location.ingredient_id is 'The ingredient.';
comment on column v_stock_by_location.venue_id is 'The ingredient''s venue.';
comment on column v_stock_by_location.name_en is 'The ingredient''s English name.';
comment on column v_stock_by_location.name_ar is 'The ingredient''s Arabic name.';
comment on column v_stock_by_location.unit is 'The base unit (g, ml or pc).';
comment on column v_stock_by_location.kind is 'purchased, prepared or retail (shop stock, which is only ever in the cafe).';
comment on column v_stock_by_location.location is 'The store: cafe or bakery.';
comment on column v_stock_by_location.on_hand is 'What the store''s live batches hold (sum of qty_remaining above 0), in the base unit.';
comment on column v_stock_by_location.theoretical is 'The store''s ledger sum (sum of qty_delta, overdrafts included), in the base unit.';
comment on column v_stock_by_location.is_active is 'Whether the ingredient is in use.';

grant select on v_stock_by_location to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Internals (no grant).
-- ---------------------------------------------------------------------------

-- Each role's home store: the bakery for the kitchen, the cafe for everyone
-- else. The default store for production, waste and a product test.
create or replace function app.staff_home_location(p_role staff_role)
returns stock_location
language plpgsql stable security definer set search_path = public as $staff_home_location_0200$
begin
  return case when p_role in ('head_chef', 'chef') then 'bakery'::stock_location
              else 'cafe'::stock_location end;
end $staff_home_location_0200$;

comment on function app.staff_home_location(staff_role) is
  'stock_locations (§2.8.4). Internal: bakery for head_chef and chef, cafe for every other role (and for no role).';

revoke all on function app.staff_home_location(staff_role) from public, anon, authenticated;

-- A client's store argument: null or '' is the default, a store name is that
-- store, anything else is refused.
create or replace function app.parse_stock_location(p_value text, p_default stock_location)
returns stock_location
language plpgsql stable security definer set search_path = public as $parse_stock_location_0200$
begin
  if p_value is null or p_value = '' then
    return p_default;
  end if;
  if p_value = any(enum_range(null::stock_location)::text[]) then
    return p_value::stock_location;
  end if;
  raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
end $parse_stock_location_0200$;

comment on function app.parse_stock_location(text, stock_location) is
  'stock_locations (§2.8.4). Internal: a client''s store argument. NULL or empty gives p_default, cafe or bakery gives that store, anything else raises INVALID_ARGUMENT (hint location).';

revoke all on function app.parse_stock_location(text, stock_location) from public, anon, authenticated;

-- The ingredient lock (V15): one transaction advisory lock per ingredient,
-- taken in ingredient_id order. Every stock writer that reads batches to move
-- or consume them takes it first, and one that touches several ingredients
-- takes them all in one call. Taking a lock this transaction already holds
-- costs nothing, so a writer may take it again ingredient by ingredient.
create or replace function app.lock_stock_ingredients(p_ingredients uuid[])
returns void
language plpgsql security definer set search_path = public as $lock_stock_ingredients_0200$
declare
  v_id uuid;
begin
  for v_id in
    select distinct x from unnest(coalesce(p_ingredients, '{}'::uuid[])) x where x is not null order by x
  loop
    perform pg_advisory_xact_lock(hashtextextended('stock_ingredient:' || v_id::text, 0));
  end loop;
end $lock_stock_ingredients_0200$;

comment on function app.lock_stock_ingredients(uuid[]) is
  'stock_locations (V15). Internal: a transaction advisory lock per ingredient (hashtextextended(''stock_ingredient:<id>'', 0)), in ingredient_id order, nulls and repeats skipped. Taken before any batch is read by consume_fefo_at, consume_for_order_item (the whole order), the product test (every serving), transfer_stock, finalize_count and price_logged_stock, so one of them never reads batches another is still moving.';

revoke all on function app.lock_stock_ingredients(uuid[]) from public, anon, authenticated;

-- D3: the location-aware FEFO engine. Same arguments as consume_fefo, with
-- the preferred store first. It returns what it booked (Σ quantity × unit
-- cost, the overdraft at its best-effort cost), which a production sums.
drop function if exists app.consume_fefo_at(stock_location, uuid, numeric, movement_type, uuid, uuid, uuid, text, text);

create or replace function app.consume_fefo_at(
  p_location    stock_location,
  p_ingredient  uuid,
  p_qty         numeric,
  p_type        movement_type,
  p_order_item  uuid default null,
  p_ticket      uuid default null,
  p_staff       uuid default null,
  p_device      text default null,
  p_reason_code text default null
) returns numeric
language plpgsql security definer set search_path = public as $consume_fefo_at_0200$
declare
  v_left  numeric := p_qty;
  v_ids   uuid[];
  v_batch record;
  v_take  numeric;
  v_cost  numeric := 0;
  v_unit  numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;
  if p_location is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'location';
  end if;

  -- The ingredient lock first: a move or a count still booking this
  -- ingredient finishes before the batches are read, so the list below holds
  -- the batch a move made and not the one it emptied.
  perform app.lock_stock_ingredients(array[p_ingredient]);

  -- One lock pass over every live batch of the ingredient, in both stores and
  -- in one canonical order, before any batch is touched. A sale that prefers
  -- the cafe and a production that prefers the bakery then queue on the same
  -- first row instead of deadlocking (transfer_stock and finalize_count take
  -- the same pass). The rows consumed below are exactly these.
  select coalesce(array_agg(l.id), '{}') into v_ids
    from (select b.id
            from stock_batches b
           where b.ingredient_id = p_ingredient and b.qty_remaining > 0
           order by b.expiry_date asc nulls last, b.received_at asc, b.id asc
             for update) l;

  for v_batch in
    select b.id, b.qty_remaining, b.unit_cost_iqd, b.location
      from stock_batches b
     where b.id = any(v_ids) and b.qty_remaining > 0
     order by (b.location <> p_location), b.expiry_date asc nulls last, b.received_at asc, b.id asc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_batch.qty_remaining);
    update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code,
                                 location)
    values (p_ingredient, v_batch.id, p_type, -v_take,
            v_batch.unit_cost_iqd, p_order_item, p_ticket, p_staff, p_device, p_reason_code,
            v_batch.location);
    v_cost := v_cost + v_take * coalesce(v_batch.unit_cost_iqd, 0);
    v_left := v_left - v_take;
  end loop;

  -- Short across the whole venue: record the truth at the preferred store,
  -- alert, never block a sale (0018:112-121).
  if v_left > 0 then
    v_unit := (select unit_cost_iqd from stock_batches where ingredient_id = p_ingredient
                order by received_at desc limit 1);   -- best-effort COGS
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code,
                                 location)
    values (p_ingredient, null, p_type, -v_left,
            v_unit,
            p_order_item, p_ticket, p_staff, p_device, p_reason_code,
            p_location);
    insert into manager_alerts (kind, payload)
    values ('negative_stock', jsonb_build_object('ingredient_id', p_ingredient,
            'shortfall', v_left, 'order_item_id', p_order_item, 'location', p_location));
    v_cost := v_cost + v_left * coalesce(v_unit, 0);
  end if;
  return v_cost;
end $consume_fefo_at_0200$;

comment on function app.consume_fefo_at(stock_location, uuid, numeric, movement_type, uuid, uuid, uuid, text, text) is
  'stock_locations (D3, V15). Internal: takes the ingredient lock (app.lock_stock_ingredients), locks every live batch of the ingredient in the canonical order (expiry asc nulls last, received_at asc, id asc), consumes the preferred store FEFO, then the other store, and only when the whole venue is short writes one batch-less row at the preferred store and one negative_stock alert (payload + location). Returns what it booked: the sum of quantity times unit cost over the rows it wrote (the overdraft at its best-effort cost, a missing cost as 0). Never blocks. INVALID_QTY.';

revoke all on function app.consume_fefo_at(stock_location, uuid, numeric, movement_type, uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- D4: 0145:242's body without its guard, claim and audit, with the venue,
-- the store, the source and the per-line cost source.
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
language plpgsql security definer set search_path = public as $receive_delivery_internal_0200$
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
    -- Shop stock lives in the cafe only (V14).
    if v_ing.kind = 'retail' and p_location <> 'cafe' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind', detail = v_ing.id::text;
    end if;

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
end $receive_delivery_internal_0200$;

comment on function app.receive_delivery_internal(uuid, stock_location, jsonb, text, text, text, uuid, text) is
  'stock_locations (D4). Internal: books one delivery into a store (p_source goods_in or staff_log): a delivery line, a batch and a goods_in movement per line, each naming the venue and the store; a line may carry cost_source (default entered). Takes the store''s count lock shared first. Returns {delivery_id, batch_ids}. STORE_BEING_COUNTED (hint the store: an operator count is open there), EMPTY_DELIVERY, INGREDIENT_NOT_FOUND (inactive, unknown or another venue''s), INVALID_ARGUMENT (hint kind: a shop line outside the cafe), INVALID_LINE. Reached through receive_delivery, receive_purchase (via receive_delivery) and log_stock; the caller guards, claims and audits.';

revoke all on function app.receive_delivery_internal(uuid, stock_location, jsonb, text, text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Re-issues.
-- ---------------------------------------------------------------------------

-- 6a. app.consume_fefo — 0018:83; the body is now its cafe wrapper, so every
--     sale (consume_for_order_item, untouched) draws the cafe first.
create or replace function app.consume_fefo(
  p_ingredient uuid, p_qty numeric, p_type movement_type,
  p_order_item uuid default null, p_ticket uuid default null,
  p_staff uuid default null, p_device text default null,
  p_reason_code text default null
) returns void language plpgsql security definer set search_path = public as $consume_fefo_0200$
begin
  perform app.consume_fefo_at('cafe', p_ingredient, p_qty, p_type, p_order_item, p_ticket,
                              p_staff, p_device, p_reason_code);
end $consume_fefo_0200$;

comment on function app.consume_fefo(uuid, numeric, movement_type, uuid, uuid, uuid, text, text) is
  '0018 + stock_locations (D3). Internal: the sale path''s FEFO consumption, app.consume_fefo_at with the cafe preferred.';

revoke all on function app.consume_fefo(uuid, numeric, movement_type, uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- 6a2. app.consume_for_order_item — 0018:213 + the whole order's ingredient
--      lock (V15). Each item already consumes in ingredient_id order
--      (order_item_bom, 0044:272), but a ticket takes its items one by one, so
--      a latte rung up before a cookie took milk before flour while a move
--      of [flour, milk] took flour first: 40P01. Every item of the order takes
--      all the order's ingredients first, in ingredient_id order; the first
--      item takes them and the rest find them held. The ticket trigger
--      (0018) and the shop sale (0146) both come through here.
create or replace function app.consume_for_order_item(
  p_order_item_id uuid,
  p_ticket_id     uuid default null
) returns void
language plpgsql security definer set search_path = public as $consume_for_order_item_0200$
declare
  v_oi     order_items%rowtype;
  v_order  orders%rowtype;
  v_r      record;
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

  for v_r in select * from app.order_item_bom(p_order_item_id) loop
    perform app.consume_fefo(v_r.ingredient_id, v_r.qty * v_oi.qty, 'sale_consumption',
                             p_order_item_id, p_ticket_id,
                             v_order.placed_by_staff_id, v_order.device_id);
  end loop;
end $consume_for_order_item_0200$;

comment on function app.consume_for_order_item(uuid, uuid) is
  '0018 + stock_locations (V15). Internal: the sale-consumption driver, idempotent per order item (a replayed ticket never consumes twice). Takes the ingredient lock for every ingredient of the whole order first, in ingredient_id order, then consumes the item''s BOM through app.consume_fefo (the cafe first). Reached from the ticket trigger and the shop sale.';

revoke all on function app.consume_for_order_item(uuid, uuid) from public, anon, authenticated;

-- 6b. app.receive_delivery — 0145:242 + p_location (default cafe): the venue
--     is asserted, the body is the internal's, the audit names the store.
drop function if exists app.receive_delivery(jsonb, text, text, text, uuid, text);

create or replace function app.receive_delivery(
  p_lines           jsonb,
  p_supplier_name   text default null,
  p_notes           text default null,
  p_device_id       text default null,
  p_supplier_id     uuid default null,
  p_idempotency_key text default null,
  p_location        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $receive_delivery_0200$
declare
  v_venue    uuid;
  v_loc      stock_location;
  v_replay   jsonb;
  v_supplier suppliers%rowtype;
  v_sname    text := nullif(btrim(p_supplier_name), '');
  v_result   jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.current_venue();
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_loc := app.parse_stock_location(p_location, 'cafe');
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
end $receive_delivery_0200$;

comment on function app.receive_delivery(jsonb, text, text, text, uuid, text, text) is
  '0145 + stock_locations (D4). MGMT at the venue: Goods in. p_lines [{ingredient_id, qty_received, unit_cost_iqd, qty_expected?, expiry_date?}] booked as one delivery into p_location (cafe or bakery, default cafe) through app.receive_delivery_internal. Returns {delivery_id, batch_ids}. Idempotent by key. EMPTY_DELIVERY, SUPPLIER_NOT_FOUND, INVALID_ARGUMENT (hint location; hint kind: a shop line at the bakery), STORE_BEING_COUNTED (an operator count is open at that store), INGREDIENT_NOT_FOUND, INVALID_LINE. Audit stock.receive_delivery.';

revoke all on function app.receive_delivery(jsonb, text, text, text, uuid, text, text) from public, anon;
grant execute on function app.receive_delivery(jsonb, text, text, text, uuid, text, text) to authenticated;

-- 6c. app.receive_purchase — 0166:678 + p_location, passed to the public
--     receive_delivery by name; purchase.receive's after gains the store.
drop function if exists app.receive_purchase(uuid, jsonb, uuid, text, text);

create or replace function app.receive_purchase(
  p_purchase_id     uuid,
  p_lines           jsonb,
  p_supplier_id     uuid default null,
  p_supplier_name   text default null,
  p_idempotency_key text default null,
  p_location        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $receive_purchase_0200$
declare
  c_uuid     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_replay   jsonb;
  v_p        purchases%rowtype;
  v_el       jsonb;
  v_lid      uuid;
  v_line     purchase_lines%rowtype;
  v_qty      numeric;
  v_exp      date;
  v_ids      uuid[] := '{}';
  v_payload  jsonb := '[]'::jsonb;
  v_sname    text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  v_delivery jsonb;
  v_status   text;
  v_result   jsonb;
  v_loc      stock_location;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_loc := app.parse_stock_location(p_location, 'cafe');

  -- Claimed before the purchase's state is read: a retry under the same key
  -- returns the first delivery; a new key finds the purchase received.
  v_replay := app.claim_replay(p_idempotency_key, 'receive_purchase');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_p from purchases where id = p_purchase_id for update;
  if not found or not (v_p.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_p.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- receive_delivery's inserts take venue_id from app.current_venue().
  perform set_config('app.venue_id', v_p.venue_id::text, true);

  if v_p.delivery_id is not null or v_p.status = 'done' then
    raise exception 'PURCHASE_ALREADY_RECEIVED' using errcode = 'P0001';
  end if;
  perform 1 from purchase_lines where purchase_id = v_p.id order by id for update;
  if not exists (select 1 from purchase_lines where purchase_id = v_p.id and ingredient_id is not null) then
    -- Nothing here is stock: its lines are acknowledged, not received.
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  -- A stock line whose ingredient was switched off after it was bought cannot
  -- be booked (receive_delivery takes active ingredients only). It is
  -- acknowledged first (acknowledge_purchase_line), or the ingredient is
  -- switched back on; until then the purchase is refused as a whole, so the
  -- one delivery never leaves a line behind. The detail names the line.
  select pl.id into v_lid
    from purchase_lines pl
    join ingredients i on i.id = pl.ingredient_id
   where pl.purchase_id = v_p.id and pl.status = 'to_receive' and not i.is_active
   order by pl.id
   limit 1;
  if found then
    raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', hint = 'lines', detail = v_lid::text;
  end if;
  if length(v_sname) > 80 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'supplier_name';
  end if;
  if p_supplier_id is not null
     and not exists (select 1 from suppliers where id = p_supplier_id and venue_id = v_p.venue_id) then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el->>'purchase_line_id', '') !~ c_uuid then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    v_lid := (v_el->>'purchase_line_id')::uuid;
    select * into v_line from purchase_lines where id = v_lid and purchase_id = v_p.id;
    if not found or v_lid = any(v_ids) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if v_line.ingredient_id is null then
      -- A line that is not stock is acknowledged (acknowledge_purchase_line).
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if v_line.status <> 'to_receive' then
      raise exception 'PURCHASE_ALREADY_RECEIVED' using errcode = 'P0001';
    end if;
    if coalesce(jsonb_typeof(v_el->'qty_received'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001', hint = 'qty_received';
    end if;
    v_qty := (v_el->>'qty_received')::numeric;
    if v_qty < 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001', hint = 'qty_received';
    end if;
    v_exp := null;
    if nullif(v_el->>'expiry_date', '') is not null then
      begin
        v_exp := (v_el->>'expiry_date')::date;
      exception when others then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'expiry_date';
      end;
    end if;

    v_ids := v_ids || v_lid;
    v_payload := v_payload || jsonb_build_array(jsonb_build_object(
      'ingredient_id', v_line.ingredient_id,
      'qty_expected',  v_line.qty,
      'qty_received',  v_qty,
      -- A cost per base unit (0017:108): the line's quantity is in base units.
      -- Four places, as Goods in rounds a pack price (unitCostFromPack).
      'unit_cost_iqd', round(v_line.price_iqd::numeric / v_line.qty, 4),
      'expiry_date',   v_exp));
  end loop;

  -- Every stock line still to receive is named, so one purchase makes exactly
  -- one delivery; a short line is a qty_received below what was bought.
  if exists (select 1 from purchase_lines
              where purchase_id = v_p.id and ingredient_id is not null
                and status = 'to_receive' and not (id = any(v_ids))) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;

  -- The outer claim covers the whole call, so receive_delivery takes no key.
  -- The delivery is named by the typed name, else the chosen supplier (which
  -- receive_delivery fills in), else the shop the driver typed. It books into
  -- the chosen store, so a shop line at the bakery and a store being counted
  -- are refused here too.
  v_delivery := app.receive_delivery(
    p_lines           => v_payload,
    p_supplier_name   => case when p_supplier_id is null then coalesce(v_sname, v_p.shop_name) else v_sname end,
    p_notes           => null,
    p_device_id       => null,
    p_supplier_id     => p_supplier_id,
    p_idempotency_key => null,
    p_location        => v_loc::text);

  update purchase_lines set status = 'received' where id = any(v_ids);
  update shopping_items si
     set status = 'received'
    from purchase_lines pl
   where pl.id = any(v_ids)
     and si.id = pl.shopping_item_id
     and si.status = 'bought';

  v_status := case when exists (select 1 from purchase_lines
                                 where purchase_id = v_p.id and status = 'to_receive')
                   then 'to_receive' else 'done' end;
  update purchases
     set delivery_id = (v_delivery->>'delivery_id')::uuid,
         received_by = auth.uid(),
         received_at = now(),
         status      = v_status
   where id = v_p.id;

  perform app.write_audit('purchase.receive', 'purchase', v_p.id::text,
                          jsonb_build_object('status', v_p.status),
                          jsonb_build_object('status', v_status,
                                             'delivery_id', v_delivery->>'delivery_id',
                                             'lines', cardinality(v_ids),
                                             'location', v_loc));

  v_result := jsonb_build_object('delivery_id', (v_delivery->>'delivery_id')::uuid,
                                 'received_line_ids', to_jsonb(v_ids));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $receive_purchase_0200$;

comment on function app.receive_purchase(uuid, jsonb, uuid, text, text, text) is
  'shopping_purchases (§2.15) + stock_locations (D4). MGMT at the purchase''s venue, one transaction: p_lines [{purchase_line_id, qty_received, expiry_date?}] must name every stock line still to receive (a short line receives less than was bought); they are booked through app.receive_delivery as ONE delivery into p_location (cafe or bakery, default cafe; cost per base unit = price ÷ quantity; named p_supplier_name, else the supplier p_supplier_id, else the shop), purchases.delivery_id links it, the lines become received and the purchase done once no line is left. Returns {delivery_id, received_line_ids}. Idempotent by key. PURCHASE_NOT_FOUND, PURCHASE_ALREADY_RECEIVED, INVALID_ARGUMENT (hint lines: a missing, unknown, repeated or non-stock line; hint location), INGREDIENT_NOT_FOUND (hint lines, detail the line: a stock line whose ingredient was switched off since, to acknowledge first), INVALID_QTY, SUPPLIER_NOT_FOUND and receive_delivery''s codes (STORE_BEING_COUNTED; INVALID_ARGUMENT hint kind for a shop line at the bakery). Audit purchase.receive (+ location).';

revoke all on function app.receive_purchase(uuid, jsonb, uuid, text, text, text) from public, anon;
grant execute on function app.receive_purchase(uuid, jsonb, uuid, text, text, text) to authenticated;

-- 6d. app.record_production_internal — 0167:38 + p_location (default
--     bakery): the components are drawn from that store first and the batch
--     lands there. The component loop is now in ingredient_id order, the rule
--     every stock writer that touches several ingredients follows (0044:263,
--     V15), because each component's lock pass now takes all its batches.
--     The batch is costed from what consume_fefo_at says it booked, not from
--     every production_consume row numbered after a max(id) read first: a
--     production that waited on another's ingredient lock counted the other's
--     rows too once they committed (review 2026-09-26).
drop function if exists app.record_production_internal(uuid, numeric, date, text);

create or replace function app.record_production_internal(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_expiry_date   date,
  p_device_id     text,
  p_location      stock_location default 'bakery'
) returns jsonb
language plpgsql security definer set search_path = public as $record_production_internal_0200$
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
end $record_production_internal_0200$;

comment on function app.record_production_internal(uuid, numeric, date, text, stock_location) is
  'staff_production (§2.16) + stock_locations (D3). Internal: the 0018 record_production body without its guard. Consumes the prepared ingredient''s components FEFO from p_location first (default bakery), then the other store (production_consume), creates a production_in batch in p_location costed at what this call consumed (consume_fefo_at''s own total), audits stock.record_production (+ location) and returns {batch_id, unit_cost_iqd, expiry_date}. INVALID_QTY, NOT_PREPARED, NO_RECIPE. Reached only through app.record_production (MGMT) and app.record_batch (the chefs and MGMT; the bakery).';

revoke all on function app.record_production_internal(uuid, numeric, date, text, stock_location) from public, anon, authenticated;

-- 6e. app.record_production — 0167:111 + p_location (default bakery).
drop function if exists app.record_production(uuid, numeric, date, text);

create or replace function app.record_production(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_expiry_date   date default null,
  p_device_id     text default null,
  p_location      text default 'bakery'
) returns jsonb
language plpgsql security definer set search_path = public as $record_production_0200$
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.record_production_internal(p_ingredient_id, p_qty, p_expiry_date, p_device_id,
                                        app.parse_stock_location(p_location, 'bakery'));
end $record_production_0200$;

comment on function app.record_production(uuid, numeric, date, text, text) is
  '0018 + staff_production (§2.16) + stock_locations (D3). MGMT: explicit sub-recipe production through app.record_production_internal in p_location (cafe or bakery, default bakery): components consumed FEFO from that store first, a production_in batch there costed at what was consumed. Returns {batch_id, unit_cost_iqd, expiry_date}. INVALID_ARGUMENT (hint location).';

revoke all on function app.record_production(uuid, numeric, date, text, text) from public, anon;
grant execute on function app.record_production(uuid, numeric, date, text, text) to authenticated;

-- 6f. app.record_waste — 0049:356 (a plain create function) + p_location:
--     the named store, else the caller's home.
drop function if exists app.record_waste(uuid, numeric, movement_type, text, text, text);

create or replace function app.record_waste(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_movement_type movement_type default 'waste_spill',
  p_reason_code   text default null,
  p_device_id     text default null,
  p_idempotency_key text default null,
  p_location      text default null
) returns void
language plpgsql security definer set search_path = public as $record_waste_0200$
declare
  v_replay jsonb;
  v_loc    stock_location;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_movement_type not in ('waste_spill','waste_spoilage') then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001',
      hint = 'record_waste accepts waste_spill or waste_spoilage';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  v_loc := app.parse_stock_location(p_location, app.staff_home_location(app.staff_role()));

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
end $record_waste_0200$;

comment on function app.record_waste(uuid, numeric, movement_type, text, text, text, text) is
  '0018/0049 + stock_locations (D3). The cashier and MGMT: records waste_spill or waste_spoilage with a reason, FEFO from p_location first (cafe or bakery; default the caller''s home store), then the other store. Idempotent by key (the queued stock.waste passes p_location only when it names one). FORBIDDEN, INVALID_MOVEMENT, REASON_REQUIRED, INVALID_ARGUMENT (hint location), INVALID_QTY. Audit stock.record_waste (+ location).';

revoke all on function app.record_waste(uuid, numeric, movement_type, text, text, text, text) from public, anon;
grant execute on function app.record_waste(uuid, numeric, movement_type, text, text, text, text) to authenticated;

-- 6g. app.protocol_submit_product_release_test — 0172:1112; the servings are
--     drawn from the submitter's home store first, after the ingredient lock
--     for every serving's ingredients (V15): the servings are consumed one by
--     one, so across servings the ingredient order is not kept.
create or replace function app.protocol_submit_product_release_test(p_submission_id uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_submit_product_release_test_0200$
declare
  v_sub   protocol_submissions%rowtype;
  v_s     record;
  v_l     record;
  v_lines int := 0;
  v_loc   stock_location := app.staff_home_location(app.staff_role());
begin
  select * into v_sub from protocol_submissions where id = p_submission_id;
  perform app.lock_stock_ingredients(array(
    select rl.ingredient_id
      from jsonb_array_elements(v_sub.record->'servings') e
      join recipe_lines rl on rl.variant_id = (e->>'variant_id')::uuid));
  for v_s in
    select (e->>'variant_id')::uuid as variant_id, (e->>'count')::int as cnt
      from jsonb_array_elements(v_sub.record->'servings') e
  loop
    for v_l in
      select rl.ingredient_id, rl.qty / (i.yield_percent / 100.0) * v_s.cnt as need
        from recipe_lines rl
        join ingredients i on i.id = rl.ingredient_id
       where rl.variant_id = v_s.variant_id
       order by rl.ingredient_id, rl.id
    loop
      perform app.consume_fefo_at(v_loc, v_l.ingredient_id, v_l.need, 'product_test', null, null,
                                  auth.uid(), null, 'run:' || v_sub.run_id::text);
      v_lines := v_lines + 1;
    end loop;
  end loop;

  perform app.write_audit('stock.product_test', 'protocol_run', v_sub.run_id::text, null,
    jsonb_build_object('submission_id', v_sub.id, 'round', v_sub.round,
                       'servings', jsonb_array_length(v_sub.record->'servings'), 'movements', v_lines));
end $protocol_submit_product_release_test_0200$;

comment on function app.protocol_submit_product_release_test(uuid) is
  'product_release (§2.9) + stock_locations (D3, V15). Internal submit hook: takes the ingredient lock for every serving''s ingredients, then consumes each serving''s recipe (qty / yield × count) through app.consume_fefo_at as product_test from the submitter''s home store first (the bakery for head_chef and chef, otherwise the cafe), reason run:<run_id>, staff the sender; runs on every round, and a withdrawn or sent-back test keeps its consumption. Audit stock.product_test.';

revoke all on function app.protocol_submit_product_release_test(uuid) from public, anon, authenticated;

-- 6h. app.trg_refund_restock — 0146:245; the restock goes to the newest CAFE
--     batch first (sales draw the cafe), else the newest elsewhere, else a
--     zero-cost synthetic batch, which defaults to the cafe. The restock is
--     costed as the chosen batch, so it is today's money exactly while every
--     live batch is in the cafe (V20).
create or replace function app.trg_refund_restock() returns trigger
language plpgsql security definer set search_path = public as $trg_refund_restock_0200$
declare
  v_r        record;
  v_batch    record;
  v_qty      numeric;
  v_refund   refunds%rowtype;
  v_line_qty int;
  v_refunded numeric;
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

    select id, unit_cost_iqd into v_batch
      from stock_batches
     where ingredient_id = v_r.ingredient_id and qty_remaining > 0
     order by (location <> 'cafe'), received_at desc, id desc
     limit 1
     for update;

    if found then
      update stock_batches set qty_remaining = qty_remaining + v_qty where id = v_batch.id;
    else
      insert into stock_batches (ingredient_id, delivery_line_id, qty_received, qty_remaining, unit_cost_iqd)
      values (v_r.ingredient_id, null, v_qty, v_qty, 0)
      returning id, unit_cost_iqd into v_batch;
    end if;

    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, refund_id, staff_id, reason_code)
    values (v_r.ingredient_id, v_batch.id, 'refund_reversal', v_qty,
            v_batch.unit_cost_iqd, new.order_item_id, new.refund_id,
            v_refund.refunded_by, v_refund.reason_code);
  end loop;
  return new;
end $trg_refund_restock_0200$;

revoke all on function app.trg_refund_restock() from public, anon, authenticated;

-- 6i. app.trg_low_stock_alert — 0151:36; a transfer never changes the
--     venue's on-hand, so it never raises low or out of stock (I10).
create or replace function app.trg_low_stock_alert() returns trigger
language plpgsql security definer set search_path = public as $trg_low_stock_alert_0200$
declare
  v_threshold numeric;
  v_on_hand   numeric;
  v_out       boolean;
begin
  if new.movement_type = 'transfer' then
    return new;
  end if;

  v_on_hand := app.ingredient_on_hand(new.ingredient_id);
  v_out     := v_on_hand <= 0;
  select low_stock_threshold into v_threshold from ingredients where id = new.ingredient_id;

  if v_out then
    -- One event, one alert: consume_fefo is raising negative_stock for this
    -- shortfall in the same statement (0018:119), and that alert is the truer
    -- one — it carries how much was taken beyond the record and sends the
    -- manager to a count, which is the only thing that fixes it.
    if (select coalesce(sum(qty_delta), 0) from stock_movements
         where ingredient_id = new.ingredient_id) < 0 then
      return new;
    end if;
  elsif v_threshold is null or v_on_hand > v_threshold then
    return new;                                    -- still above the reorder point
  end if;

  -- One open alert per ingredient PER SEVERITY. Deduping on the ingredient
  -- alone (the 0018 rule) meant an ingredient that had already raised
  -- "running low" went quiet when it later emptied, which is the moment worth
  -- hearing about.
  if exists (select 1 from manager_alerts
              where kind = 'low_stock' and acknowledged_at is null
                and payload->>'ingredient_id' = new.ingredient_id::text
                and coalesce((payload->>'out')::boolean, false) = v_out) then
    return new;
  end if;

  insert into manager_alerts (kind, payload)
  values ('low_stock', jsonb_build_object('ingredient_id', new.ingredient_id,
          'on_hand', v_on_hand, 'threshold', v_threshold, 'out', v_out));
  return new;
end $trg_low_stock_alert_0200$;

revoke all on function app.trg_low_stock_alert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Owner assistant: the new view and the new columns join the table_read
--    allowlist (this migration's objects only, never the all-table catch-up,
--    §1.5). None is money or a person.
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       true,
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and (c.table_name = 'v_stock_by_location'
        or (c.table_name, c.column_name) in (('stock_batches', 'location'), ('stock_batches', 'origin_batch_id'),
                                             ('stock_movements', 'location'),
                                             ('stock_counts', 'location'), ('stock_counts', 'source'),
                                             ('deliveries', 'location'), ('deliveries', 'source'),
                                             ('delivery_lines', 'cost_source')))
on conflict (table_name, column_name) do nothing;
