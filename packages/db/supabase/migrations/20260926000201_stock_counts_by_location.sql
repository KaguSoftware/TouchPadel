-- 0201 stock_counts_by_location — "Stock control": each store is counted on
-- its own, by a manager on the operator or by the kitchen on the phone.
--
-- Feature: protocols and the staff phone, wave 5, lane S
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8.2 D7, §2.8.5,
-- §2.8.6, §2.11; Majed's answer #5).
-- Depends on: stock_locations (S: stock_counts.location and source, the
-- count lock, the stores), stock_transfer_movement (S: 'transfer', read by
-- the variance view). staff_roles_assistant_waiter (R) for its tests only
-- (V7).
-- Re-runnable: drop function if exists + create, create or replace, on
-- conflict do nothing.
--
-- ONE COUNT PER STORE. There is one count in progress or waiting per (venue,
-- store), under the advisory lock hashtextextended('stock_count:<venue>:
-- <store>', 0). start_count and submit_stock_count take it exclusively;
-- transfer_stock and app.receive_delivery_internal take it shared, so a count
-- never starts while a move or a receipt into that store is in flight, and
-- none lands while a manager's count is open (M5, V19).
--
-- THE MANAGER'S COUNT. start_count(p_location, p_venue_id) snapshots the
-- venue's active ingredients at that store (the bakery leaves shop stock out:
-- it lives in the cafe only, V14), each at its ledger sum there. An old
-- operator's start_count() counts the cafe.
--
-- THE PHONE COUNT (PROPOSAL, §8 Q19, Q20). submit_stock_count is blind: the
-- head chef and the chef count the bakery (the cafe is FORBIDDEN hint
-- location), MGMT either store. It creates a count that is already waiting,
-- with lines only for what was typed, each snapshotting its theoretical (the
-- ledger sum at the store) at submit, and returns no theoretical and no
-- variance. A manager applies it with finalize_count (Apply, lines editable)
-- or throws it away with discard_count. No push: a badge on Stock ▸ Counts.
--
-- RECONCILING. finalize_count (0044:301) now reconciles at the count's store
-- only. It first takes the ingredient lock of every drifted line
-- (app.lock_stock_ingredients, V15). Per drifted line, in ingredient_id order
-- as before, it then takes the canonical lock pass over all the ingredient's
-- live batches (both stores, consume_fefo_at's order); a shortage then draws that store's
-- batches in that order, with any rest on a batch-less row at that store; a
-- surplus tops up that store's newest live batch, or else makes one there
-- costed like the newest live batch elsewhere, or at zero (PROPOSAL). It is
-- row-addressed: another venue's count is COUNT_NOT_FOUND.
--
-- VARIANCE. v_variance_report's period is now per (venue, store,
-- ingredient), its explanations cover only the count's store, and it appends
-- location and transfer_qty (the net moved in, signed). A phone count's
-- theoretical is the ledger when it was submitted, so its period ends there
-- (started_at), and the next period starts there: what happened between the
-- count and the manager's Apply belongs to the next count, not to this
-- difference (review 2026-09-26). An operator count keeps 0172's end, the
-- moment it was applied. report_stock carries
-- both on each variance row and location on expiring and expired batches;
-- the stock value, low and below-par lists stay venue totals.
--
-- covered by packages/db/tests/stock-counts.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.start_count — 0019:41 + p_location, p_venue_id: MGMT at the venue,
--    one store, the count lock.
-- ---------------------------------------------------------------------------
drop function if exists app.start_count();

create or replace function app.start_count(
  p_location text default null,
  p_venue_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $start_count_0201$
declare
  v_venue uuid;
  v_loc   stock_location;
  v_count stock_counts%rowtype;
  v_lines int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_loc := app.parse_stock_location(p_location, 'cafe');

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
     and (v_loc = 'cafe' or i.kind <> 'retail');
  get diagnostics v_lines = row_count;

  perform app.write_audit('stock.start_count', 'stock_counts', v_count.id::text,
                          null, jsonb_build_object('lines', v_lines, 'location', v_loc));

  return jsonb_build_object('count_id', v_count.id, 'lines', v_lines,
                            'started_at', v_count.started_at, 'location', v_loc);
end $start_count_0201$;

comment on function app.start_count(text, uuid) is
  '0019 + stock_counts_by_location (D7). MGMT at the venue: opens an operator count of one store (p_location, default cafe) under the store''s count lock, snapshotting every active ingredient of the venue at its ledger sum in that store (the bakery count leaves shop stock out). Receipts and moves into the store are refused until it is finalized or discarded. Returns {count_id, lines, started_at, location}. FORBIDDEN, INVALID_ARGUMENT (hint location), COUNT_IN_PROGRESS (a count of that store is open or waiting). Audit stock.start_count.';

revoke all on function app.start_count(text, uuid) from public, anon;
grant execute on function app.start_count(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.submit_stock_count — COUNT at the venue: a blind count, waiting.
-- ---------------------------------------------------------------------------
create or replace function app.submit_stock_count(
  p_location        text  default null,
  p_lines           jsonb default null,
  p_venue_id        uuid  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_stock_count_0201$
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
  if not app.is_staff('head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
  if v_role in ('head_chef','chef') and v_loc <> 'bakery' then
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
    if v_ing.kind = 'retail' and v_loc <> 'cafe' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind', detail = v_ing.id::text;
    end if;
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
end $submit_stock_count_0201$;

comment on function app.submit_stock_count(text, jsonb, uuid, text) is
  'stock_counts_by_location (wave 5 §2.8.5, D7). The head chef and the chef (the bakery only) and MGMT (either store) at the venue: a blind count of p_location (default the caller''s home store), p_lines [{ingredient_id, counted_qty, unit?}] (1 to 300, each once; unit the base unit or pack), saved as a phone count waiting for a manager to apply (finalize_count) or discard. Each line snapshots the store''s ledger sum at submit. Returns {count_id, location, lines} (a count, no theoretical, no variance). Idempotent by key. FORBIDDEN (also hint location); INVALID_ARGUMENT (location, lines, unit, kind: a shop product at the bakery); INVALID_QTY; INGREDIENT_NOT_FOUND; COUNT_IN_PROGRESS (a count of that store is open or waiting). Audit stock.submit_count {location, lines} (a count).';

revoke all on function app.submit_stock_count(text, jsonb, uuid, text) from public, anon;
grant execute on function app.submit_stock_count(text, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.finalize_count — 0044:301 (upper-case $function$ body); now
--    row-addressed, and reconciled at the count's store.
-- ---------------------------------------------------------------------------
create or replace function app.finalize_count(
  p_count_id  uuid,
  p_lines     jsonb default '[]'::jsonb,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $finalize_count_0201$
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
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_count from stock_counts where id = p_count_id for update;
  if not found or not (v_count.venue_id = any(app.staff_venue_ids())) then
    raise exception 'COUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_count.venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
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
end $finalize_count_0201$;

comment on function app.finalize_count(uuid, jsonb, text) is
  '0019/0044 + stock_counts_by_location (D7). MGMT at the count''s venue: applies an operator count or a waiting phone count. p_lines [{ingredient_id, counted_qty}] overwrite the counted quantities (COUNT_LINE_NOT_FOUND for an ingredient not in the count); every drifted line is reconciled at the count''s store with count_adjustment movements (a shortage FEFO with any rest batch-less, a surplus into that store''s newest live batch or a new one). Returns {count_id, adjusted_lines, finalized_at, location}. FORBIDDEN, COUNT_NOT_FOUND (also another venue''s), COUNT_FINALIZED, INVALID_LINE. Audit stock.finalize_count.';

revoke all on function app.finalize_count(uuid, jsonb, text) from public, anon;
grant execute on function app.finalize_count(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.discard_count — MGMT: an unapplied count goes, with its lines.
-- ---------------------------------------------------------------------------
create or replace function app.discard_count(p_count_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $discard_count_0201$
declare
  v_count stock_counts%rowtype;
  v_lines int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_count from stock_counts where id = p_count_id for update;
  if not found or not (v_count.venue_id = any(app.staff_venue_ids())) then
    raise exception 'COUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_count.venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
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
end $discard_count_0201$;

comment on function app.discard_count(uuid) is
  'stock_counts_by_location (wave 5 §2.8.5, D7). MGMT at the count''s venue: deletes a count that was never applied (an operator count left open, or a phone count not worth applying), with its lines; stock is untouched. Returns {count_id, discarded: true}. FORBIDDEN, COUNT_NOT_FOUND (also another venue''s, or already discarded), COUNT_FINALIZED. Audit stock.discard_count {location, source, lines}.';

revoke all on function app.discard_count(uuid) from public, anon;
grant execute on function app.discard_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. v_variance_report — 0172:1836 with the period per (venue, store,
--    ingredient) and the explanations at the count's store; location and
--    transfer_qty appended (a create or replace may only add at the end).
-- ---------------------------------------------------------------------------
create or replace view v_variance_report with (security_invoker = on) as
with counted as (
  -- A phone count's moment is its submit (its theoretical's snapshot); an
  -- operator count's is its finalize, as 0172. One count per store is open or
  -- waiting at a time, so the order is the same either way.
  select l.count_id, l.ingredient_id, l.theoretical_qty, l.counted_qty,
         case when c.source = 'phone' then c.started_at else c.finalized_at end as finalized_at,
         c.location,
         lag(case when c.source = 'phone' then c.started_at else c.finalized_at end)
           over (partition by c.venue_id, c.location, l.ingredient_id
                 order by case when c.source = 'phone' then c.started_at else c.finalized_at end) as period_start
    from stock_count_lines l
    join stock_counts c on c.id = l.count_id
   where c.finalized_at is not null
)
select x.count_id,
       x.period_start,
       x.finalized_at                as period_end,
       x.ingredient_id,
       i.name_en, i.name_ar, i.unit,
       x.theoretical_qty,
       x.counted_qty,
       x.counted_qty - x.theoretical_qty        as variance_qty,
       p.sold_qty,
       round(p.sold_qty * i.waste_allowance_percent / 100.0, 3)
                                     as expected_waste_qty,   -- allowance, separate column
       p.recorded_waste_qty,                                   -- spill + spoilage
       p.void_qty,                                             -- void_after_send
       p.expired_qty,                                          -- expired_writeoff
       p.movement_ids,                                         -- drill-down
       p.product_test_qty,                                     -- product_test (a release's test servings)
       x.location,                                             -- the count's store
       p.transfer_qty                                          -- moved in (+) or out (-) of the store
  from counted x
  join ingredients i on i.id = x.ingredient_id
  left join lateral (
    select coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'sale_consumption'), 0) as sold_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type in ('waste_spill','waste_spoilage')), 0) as recorded_waste_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'void_after_send'), 0) as void_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'expired_writeoff'), 0) as expired_qty,
           array_agg(sm.id order by sm.id) as movement_ids,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'product_test'), 0) as product_test_qty,
           coalesce(sum(sm.qty_delta) filter (where sm.movement_type = 'transfer'), 0) as transfer_qty
      from stock_movements sm
     where sm.ingredient_id = x.ingredient_id
       and sm.location = x.location
       and sm.at <= x.finalized_at
       and (x.period_start is null or sm.at > x.period_start)
  ) p on true;

comment on column v_variance_report.period_end is
  'stock_counts_by_location (D7): the end of the period the variance covers. An operator count''s is when it was applied; a phone count''s is when it was submitted, the moment its theoretical was taken, and the next period starts there.';
comment on column v_variance_report.location is
  'stock_counts_by_location (D7): the store the count is of. The period and every explanation column cover that store only.';
comment on column v_variance_report.transfer_qty is
  'stock_counts_by_location (D7): what was moved into the store (positive) or out of it (negative) in the period by app.transfer_stock, net, in the ingredient''s unit. One of the explanations of a count difference, never waste.';

-- The owner assistant reads the view's columns from its allowlist; the two
-- new columns join it (never the all-table catch-up, §1.5).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'view', true, c.data_type, c.ordinal_position,
       col_description('public.v_variance_report'::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'v_variance_report'
   and c.column_name in ('location', 'transfer_qty')
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 6. app.report_stock — 0172:1889 verbatim, plus location and transferQty on
--    each variance row and location on each expiring and expired batch.
-- ---------------------------------------------------------------------------
create or replace function app.report_stock(
  p_from    date,
  p_to      date,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_stock_0201$
declare
  v_b        record;
  v_ing      uuid;
  v_value    bigint;
  v_low      jsonb;
  v_par      jsonb;
  v_soon     jsonb;
  v_expired  jsonb;
  v_cons     jsonb;
  v_var      jsonb;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'ingredientId' and jsonb_typeof(p_filters -> 'ingredientId') <> 'null' then
    begin
      v_ing := (p_filters ->> 'ingredientId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'ingredientId';
    end;
  end if;

  select coalesce(round(sum(b.qty_remaining * b.unit_cost_iqd)), 0)::bigint
    into v_value
    from stock_batches b
   where b.qty_remaining > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', v.ingredient_id,
           'nameEn',       v.name_en,
           'nameAr',       v.name_ar,
           'unit',         v.unit,
           'onHand',       v.on_hand,
           'threshold',    v.low_stock_threshold,
           'parLevel',     v.par_level
         ) order by v.name_en), '[]'::jsonb)
    into v_low
    from v_ingredient_on_hand v
   where v.is_active and v.low_stock_threshold is not null and v.on_hand <= v.low_stock_threshold;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', v.ingredient_id,
           'nameEn',       v.name_en,
           'nameAr',       v.name_ar,
           'unit',         v.unit,
           'onHand',       v.on_hand,
           'parLevel',     v.par_level,
           'shortfall',    v.par_level - v.on_hand
         ) order by (v.par_level - v.on_hand) desc, v.name_en), '[]'::jsonb)
    into v_par
    from v_ingredient_on_hand v
   where v.is_active and v.par_level is not null and v.on_hand < v.par_level;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysLeft',     e.days_left,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint,
           'location',     sb.location
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_soon
    from v_expiring_soon e
    left join stock_batches sb on sb.id = e.batch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'batchId',      e.batch_id,
           'ingredientId', e.ingredient_id,
           'nameEn',       e.name_en,
           'nameAr',       e.name_ar,
           'unit',         e.unit,
           'qtyRemaining', e.qty_remaining,
           'expiryDate',   e.expiry_date,
           'daysExpired',  e.days_expired,
           'valueIqd',     round(e.qty_remaining * e.unit_cost_iqd)::bigint,
           'location',     sb.location
         ) order by e.expiry_date, e.name_en), '[]'::jsonb)
    into v_expired
    from v_expired e
    left join stock_batches sb on sb.id = e.batch_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', x.ingredient_id,
           'nameEn',       i.name_en,
           'nameAr',       i.name_ar,
           'unit',         i.unit,
           'consumedQty',  x.qty,
           'costIqd',      x.cost
         ) order by x.cost desc, i.name_en), '[]'::jsonb)
    into v_cons
    from (
      select sm.ingredient_id,
             sum(-sm.qty_delta)                                                       as qty,
             coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0))), 0)::bigint as cost
        from stock_movements sm
       where sm.movement_type in ('sale_consumption','production_consume')
         and sm.qty_delta < 0
         and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
         and (v_ing is null or sm.ingredient_id = v_ing)
       group by sm.ingredient_id) x
    join ingredients i on i.id = x.ingredient_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'countId',          r.count_id,
           'periodStart',      r.period_start,
           'periodEnd',        r.period_end,
           'ingredientId',     r.ingredient_id,
           'nameEn',           r.name_en,
           'nameAr',           r.name_ar,
           'unit',             r.unit,
           'theoreticalQty',   r.theoretical_qty,
           'countedQty',       r.counted_qty,
           'varianceQty',      r.variance_qty,
           'soldQty',          r.sold_qty,
           'expectedWasteQty', r.expected_waste_qty,
           'recordedWasteQty', r.recorded_waste_qty,
           'voidQty',          r.void_qty,
           'expiredQty',       r.expired_qty,
           'productTestQty',   r.product_test_qty,
           'location',         r.location,
           'transferQty',      r.transfer_qty
         ) order by r.period_end desc, r.name_en), '[]'::jsonb)
    into v_var
    from v_variance_report r
   where r.period_end >= v_b.ts_from and r.period_end < v_b.ts_to
     and (v_ing is null or r.ingredient_id = v_ing);

  return jsonb_build_object(
    'period',        jsonb_build_object('from', p_from, 'to', p_to),
    'stockValueIqd', v_value,
    'lowStock',      v_low,
    'belowPar',      v_par,
    'expiringSoon',  v_soon,
    'expired',       v_expired,
    'consumption',   v_cons,
    'variance',      v_var,
    'comparison',    null);
end $report_stock_0201$;

comment on function app.report_stock(date, date, jsonb) is
  'Manager or owner (0068; product_release adds productTestQty to each variance row; stock_counts_by_location adds location and transferQty to each variance row and location to each expiring and expired batch): the stock report for [p_from, p_to] in business days: stock value, low stock, below par, expiring and expired batches, consumption and count differences. Stock value, low stock and below par are venue totals.';

revoke all on function app.report_stock(date, date, jsonb) from public, anon;
grant execute on function app.report_stock(date, date, jsonb) to authenticated;
