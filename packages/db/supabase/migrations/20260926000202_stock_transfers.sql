-- 0202 stock_transfers — Hasan moves stock between the cafe and the bakery.
--
-- Feature: protocols and the staff phone, wave 5, lane S
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8.2 D6, §2.8.3,
-- §2.8.5, §2.11; Majed's answer #8).
-- Depends on: stock_locations (S: the stores, origin_batch_id, the count
-- lock), stock_transfer_movement (S: 'transfer'), staff_roles_assistant_waiter
-- (R: the waiter the guard names); stock_counts_by_location (S) for its tests
-- only (a manager's count by store, the count lock in start_count).
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- WHO MOVES (PROPOSAL, §8 Q21). The waiter, the manager and the owner, at the
-- venue, either way, purchased and prepared stock. Heads and chefs ask Hasan.
-- Shop (retail) stock lives in the cafe only (V14), so it never moves.
--
-- HOW A MOVE BOOKS (D6). Lines are handled in ingredient_id order, whatever
-- order p_lines gives: every stock writer that touches several ingredients
-- has since 0044 (0044:263-264), and without it a move of [milk, sugar] next
-- to a sale whose recipe gives sugar first deadlocks (V15). Before any batch
-- is read it takes the ingredient lock of every line (app.lock_stock_ingredients,
-- stock_locations), so a sale or another move of the same ingredient waits
-- for this one to commit and then reads the batches it made. For each
-- ingredient it first locks every live batch in both stores in the canonical
-- order consume_fefo_at uses, then takes the source store's batches FEFO. Per
-- slice of a source batch it lowers that batch, makes a batch in the
-- destination with the same expiry, received_at, unit cost and venue
-- (origin_batch_id = the root batch, so a cost correction reaches every
-- copy), and writes one movement pair, 'transfer', reason transfer:<id>:
-- minus at the source, plus at the destination. The venue's on-hand, its
-- stock value and every FEFO position stay as they were (I4, I8).
--
-- IT REFUSES the whole move when the source shows less than a line
-- (TRANSFER_SHORT, hint the ingredient, detail what the source shows:
-- moving past the batches would make stock from nothing, PROPOSAL), a shop
-- product (INVALID_ARGUMENT hint kind), and any move while a manager's count
-- is open at either store (STORE_BEING_COUNTED, hint the store). It takes
-- both stores' count locks shared, cafe first, before that check (M5), so a
-- count started meanwhile waits for the move.
--
-- WHO READS. stock_transfers and its lines are MGMT at the venue; the waiter
-- reads the day's moves through stock_today (stock_store_reads). No note
-- column: a move is ingredients and quantities, nothing else.
--
-- covered by packages/db/tests/stock-transfers.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The tables.
-- ---------------------------------------------------------------------------
create table if not exists stock_transfers (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  from_location stock_location not null,
  to_location   stock_location not null,
  moved_by      uuid not null references staff(id),
  moved_at      timestamptz not null default now(),
  constraint stock_transfers_stores_chk check (from_location <> to_location)
);

create index if not exists stock_transfers_venue_moved_idx
  on stock_transfers (venue_id, moved_at);

comment on table stock_transfers is
  'stock_transfers (wave 5 §2.8, D6): one move of stock from one store of a venue to the other, booked by app.transfer_stock as transfer movement pairs (reason transfer:<id>). Written by the waiter and MGMT through that RPC only; read by MGMT at the venue.';
comment on column stock_transfers.id is 'Move id; the movements'' reason_code is transfer:<id>.';
comment on column stock_transfers.venue_id is 'The venue.';
comment on column stock_transfers.from_location is 'The store the stock left: cafe or bakery.';
comment on column stock_transfers.to_location is 'The store the stock went into: the other one.';
comment on column stock_transfers.moved_by is 'Who moved it.';
comment on column stock_transfers.moved_at is 'When it was moved.';

create table if not exists stock_transfer_lines (
  transfer_id   uuid not null references stock_transfers(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty           numeric(12,3) not null check (qty > 0),
  primary key (transfer_id, ingredient_id)
);

comment on table stock_transfer_lines is
  'stock_transfers (wave 5 §2.8, D6): what one move carried, one row per ingredient. Read by MGMT at the move''s venue.';
comment on column stock_transfer_lines.transfer_id is 'The move.';
comment on column stock_transfer_lines.ingredient_id is 'The ingredient moved (purchased or prepared; shop stock never moves).';
comment on column stock_transfer_lines.qty is 'How much, in the ingredient''s base unit.';

alter table stock_transfers enable row level security;
alter table stock_transfer_lines enable row level security;

drop policy if exists stock_transfers_mgmt_read on stock_transfers;
create policy stock_transfers_mgmt_read on stock_transfers
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists stock_transfer_lines_mgmt_read on stock_transfer_lines;
create policy stock_transfer_lines_mgmt_read on stock_transfer_lines
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from stock_transfers t
                      where t.id = stock_transfer_lines.transfer_id
                        and t.venue_id = any(app.staff_venue_ids())));

grant select on stock_transfers, stock_transfer_lines to authenticated;
grant all on stock_transfers, stock_transfer_lines to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.transfer_stock — the waiter and MGMT at the venue.
-- ---------------------------------------------------------------------------
create or replace function app.transfer_stock(
  p_from            text,
  p_to              text,
  p_lines           jsonb,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $transfer_stock_0202$
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
  if v_from is null or v_to is null or v_from = v_to then
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
end $transfer_stock_0202$;

comment on function app.transfer_stock(text, text, jsonb, uuid, text) is
  'stock_transfers (wave 5 §2.8.5, D6). The waiter and MGMT at the venue: moves p_lines [{ingredient_id, qty, unit?}] (1 to 50, each ingredient once; unit the base unit or pack) from store p_from to store p_to. Lines are booked in ingredient_id order, after the ingredient locks of every line (app.lock_stock_ingredients) and each after a lock pass over all its live batches; the source''s batches are split FEFO into destination batches with the same expiry, received_at and cost, and each slice writes a transfer movement pair (reason transfer:<id>). Returns {transfer_id, from, to, moved_at, lines: [{ingredient_id, qty}]} in base units, no cost. Idempotent by key. FORBIDDEN; INVALID_ARGUMENT (hint location: the same store or an unknown one; lines; unit; kind: a shop product); INVALID_QTY; INGREDIENT_NOT_FOUND (detail the id); TRANSFER_SHORT (hint the ingredient, detail what the source shows; nothing is moved); STORE_BEING_COUNTED (hint the store). Audit stock.transfer {from, to, lines, batches} (counts).';

revoke all on function app.transfer_stock(text, text, jsonb, uuid, text) from public, anon;
grant execute on function app.transfer_stock(text, text, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Owner assistant: both tables join the table_read allowlist (this
--    migration's tables only, never the all-table catch-up, §1.5).
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       'table',
       true,
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in ('stock_transfers', 'stock_transfer_lines')
on conflict (table_name, column_name) do nothing;
