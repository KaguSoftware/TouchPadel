-- 0203 stock_logs — "Log stock": staff add what arrived to a store, never
-- seeing or typing a cost; a manager prices it afterwards.
--
-- Feature: protocols and the staff phone, wave 5, lane S
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8.2 D4-D5, §2.8.4,
-- §2.8.5, §2.11; Majed's answer #5 and #8's UPDATE).
-- Depends on: stock_locations (S: the stores, deliveries.source,
-- delivery_lines.cost_source, app.receive_delivery_internal).
-- For its tests only: staff_roles_assistant_waiter (R, V7), and
-- stock_counts_by_location and stock_transfers (S: a count holding a store,
-- a move of a logged batch).
-- Re-runnable: create or replace.
--
-- WHO LOGS WHAT, AND WHERE. Maha logs shop stock because she covers the desk,
-- every add-stock path names its store, and Rusul logs into the bakery
-- (binding answers). Shop (retail) stock is cafe-only for everyone (V14).
-- The rest is PROPOSAL:
--   head_barista        purchased          cafe or bakery (default cafe)
--   head_chef           purchased          bakery or cafe (default bakery)
--   cashier             purchased, retail  purchased either store, retail the
--                                          cafe only (default cafe)
--   court_desk          retail             the cafe only; the bakery is
--                                          FORBIDDEN hint location
--   manager, owner      purchased, retail  as the cashier
-- The default is the role's home store (app.staff_home_location). Prepared
-- stock is never logged: it comes from production (INVALID_ARGUMENT hint
-- kind). Barista, chef, waiter, driver and marketing are refused.
--
-- A LINE is {ingredient_id, qty, unit?, expiry_date?}: unit the base unit or
-- 'pack' (times pack_size, as shopping_items.unit, 0166). Every line is
-- checked here, the shop-in-the-cafe rule included, before the internal is
-- called, so EMPTY_DELIVERY and INVALID_LINE never reach the phone (M6).
--
-- THE COST (D5, PROPOSAL, §8 Q23). app.stock_cost_estimate takes the latest
-- batch with a cost above 0 (received_at desc, id desc, as v_item_cogs), so
-- a zero-cost refund restock or count surplus never turns an estimate into 0
-- (V21); else pack cost / pack size; else 0, marked none for Setup's "needs a
-- cost". Each line keeps its cost_source. The staff member sees no cost in
-- anything this returns.
--
-- THE CORRECTION. app.price_logged_stock (MGMT) sets a staff log's cost per
-- base unit and revalues only what is on the shelf: the line, its batch and
-- that batch's transfer copies. Movements already booked keep the estimate;
-- the audit keeps both costs. It takes the lines' ingredient locks
-- (app.lock_stock_ingredients), then locks every batch it will touch in one
-- statement, ingredient by ingredient in a sale's canonical order (V15). A
-- Goods in delivery is not a staff log (REF_NOT_FOUND hint delivery, I13).
--
-- DOUBLE BOOKING (§8 Q24, PROPOSAL). A delivery that Bareq logs is not also
-- entered in Goods in: the manager prices his entry instead. stock_today
-- shows the day's deliveries and the driver purchases still waiting.
--
-- covered by packages/db/tests/stock-logs.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.stock_cost_estimate — internal (D5).
-- ---------------------------------------------------------------------------
create or replace function app.stock_cost_estimate(p_ingredient uuid, out unit_cost numeric, out cost_source text)
language plpgsql stable security definer set search_path = public as $stock_cost_estimate_0203$
declare
  v_ing ingredients%rowtype;
begin
  select b.unit_cost_iqd into unit_cost
    from stock_batches b
   where b.ingredient_id = p_ingredient and b.unit_cost_iqd > 0
   order by b.received_at desc, b.id desc
   limit 1;
  if unit_cost is not null then
    cost_source := 'last_batch';
    return;
  end if;

  select * into v_ing from ingredients where id = p_ingredient;
  if coalesce(v_ing.pack_cost_iqd, 0) > 0 and coalesce(v_ing.pack_size, 0) > 0 then
    unit_cost   := round(v_ing.pack_cost_iqd::numeric / v_ing.pack_size, 4);
    cost_source := 'pack';
    return;
  end if;

  unit_cost   := 0;
  cost_source := 'none';
end $stock_cost_estimate_0203$;

comment on function app.stock_cost_estimate(uuid) is
  'stock_logs (D5). Internal: the estimated cost per base unit of stock staff add, with where it came from: the latest batch with a cost above 0 (received_at desc, id desc) → last_batch; else pack_cost_iqd / pack_size (both above 0) → pack; else 0 → none.';

revoke all on function app.stock_cost_estimate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.log_stock — LOG at the venue.
-- ---------------------------------------------------------------------------
create or replace function app.log_stock(
  p_location        text  default null,
  p_lines           jsonb default null,
  p_note            text  default null,
  p_venue_id        uuid  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $log_stock_0203$
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
  if not app.is_staff('head_barista','head_chef','cashier','court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','cashier','court_desk','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
  if v_role = 'court_desk' and v_loc <> 'cafe' then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;
  v_kinds := case
               when v_role in ('head_barista','head_chef') then array['purchased']
               when v_role = 'court_desk'                  then array['retail']
               else                                             array['purchased','retail']
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
    -- caller's, or shop stock outside the cafe (V14), is refused the same way.
    if not (v_ing.kind::text = any(v_kinds)) or (v_ing.kind = 'retail' and v_loc <> 'cafe') then
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
end $log_stock_0203$;

comment on function app.log_stock(text, jsonb, text, uuid, text) is
  'stock_logs (wave 5 §2.8.5, D4-D5). The head barista, the head chef, the cashier, the court desk and MGMT at the venue: adds p_lines [{ingredient_id, qty, unit?, expiry_date?}] (1 to 50, each once; unit the base unit or pack) to store p_location (default the caller''s home store) as one staff_log delivery, costed by app.stock_cost_estimate. Kinds: the heads purchased; the desk retail; the cashier and MGMT purchased and retail. Shop stock goes to the cafe only; prepared stock is never logged. Returns {delivery_id, location, lines: [{ingredient_id, qty, expiry_date}]}: no cost. Idempotent by key. FORBIDDEN (also hint location: the desk and the bakery); INVALID_ARGUMENT (hints location, lines, unit, kind, expiry_date); INVALID_QTY; INGREDIENT_NOT_FOUND; TEXT_TOO_LONG (note, 200); STORE_BEING_COUNTED. Audit stock.log {location, lines, cost_sources} (counts).';

revoke all on function app.log_stock(text, jsonb, text, uuid, text) from public, anon;
grant execute on function app.log_stock(text, jsonb, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.price_logged_stock — MGMT at the delivery's venue.
-- ---------------------------------------------------------------------------
create or replace function app.price_logged_stock(p_delivery_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $price_logged_stock_0203$
declare
  c_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_d      deliveries%rowtype;
  v_el     jsonb;
  v_lid    uuid;
  v_cost   numeric;
  v_lids   uuid[] := '{}';
  v_set    jsonb := '[]'::jsonb;
  v_before jsonb;
  v_n      int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_d from deliveries where id = p_delivery_id for update;
  if not found or not (v_d.venue_id = any(app.staff_venue_ids())) or v_d.source <> 'staff_log' then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'delivery';
  end if;
  if not app.is_staff_at(v_d.venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_d.venue_id::text, true);

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 50 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(v_el->>'delivery_line_id', '') !~ c_uuid then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'lines';
    end if;
    v_lid := (v_el->>'delivery_line_id')::uuid;
    if not exists (select 1 from delivery_lines where id = v_lid and delivery_id = v_d.id) then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'lines';
    end if;
    if v_lid = any(v_lids) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(jsonb_typeof(v_el->'unit_cost_iqd'), 'null') <> 'number' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit_cost_iqd';
    end if;
    v_cost := round((v_el->>'unit_cost_iqd')::numeric, 4);
    if v_cost < 0 or v_cost >= 1000000000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit_cost_iqd';
    end if;
    v_lids := v_lids || v_lid;
    v_set  := v_set || jsonb_build_array(jsonb_build_object('delivery_line_id', v_lid, 'unit_cost_iqd', v_cost));
  end loop;

  -- The lines' ingredient locks (V15): a move of one of them finishes first,
  -- so its new copies are in the lock below and in the revaluation.
  perform app.lock_stock_ingredients(array(
    select dl.ingredient_id from delivery_lines dl where dl.id = any(v_lids)));

  -- Every batch this touches, locked in one statement before any write: each
  -- line's batch and its transfer copies, ingredient by ingredient in the
  -- order a sale's lock pass uses (V15).
  perform 1
     from stock_batches b
    where b.id in (select r.id from stock_batches r where r.delivery_line_id = any(v_lids))
       or b.origin_batch_id in (select r.id from stock_batches r where r.delivery_line_id = any(v_lids))
    order by b.ingredient_id, b.expiry_date asc nulls last, b.received_at asc, b.id asc
      for update;

  select jsonb_agg(jsonb_build_object('delivery_line_id', dl.id, 'unit_cost_iqd', dl.unit_cost_iqd) order by dl.id)
    into v_before
    from delivery_lines dl
   where dl.id = any(v_lids);

  update delivery_lines dl
     set unit_cost_iqd = x.cost,
         cost_source   = 'entered'
    from (select (e->>'delivery_line_id')::uuid as id, (e->>'unit_cost_iqd')::numeric as cost
            from jsonb_array_elements(v_set) e) x
   where dl.id = x.id;
  get diagnostics v_n = row_count;

  update stock_batches b
     set unit_cost_iqd = t.cost
    from (select r.id as root, (e->>'unit_cost_iqd')::numeric as cost
            from jsonb_array_elements(v_set) e
            join stock_batches r on r.delivery_line_id = (e->>'delivery_line_id')::uuid) t
   where b.id = t.root or b.origin_batch_id = t.root;

  perform app.write_audit('stock.price_log', 'deliveries', v_d.id::text,
                          jsonb_build_object('lines', v_before),
                          jsonb_build_object('lines', (select jsonb_agg(s order by s->>'delivery_line_id')
                                                         from jsonb_array_elements(v_set) s)));

  return jsonb_build_object('delivery_id', v_d.id, 'updated', v_n);
end $price_logged_stock_0203$;

comment on function app.price_logged_stock(uuid, jsonb) is
  'stock_logs (wave 5 §2.8.5, D5). MGMT at the delivery''s venue: sets the cost per base unit of a staff log''s lines, p_lines [{delivery_line_id, unit_cost_iqd}] (0 to under 1e9, 4 places). Revalues the line (cost_source becomes entered), its batch and that batch''s transfer copies; booked movements keep the estimate. State-idempotent. Returns {delivery_id, updated}. FORBIDDEN; REF_NOT_FOUND (hint delivery: unknown, another venue''s, or not a staff log; hint lines: a line of another delivery); INVALID_ARGUMENT (lines, unit_cost_iqd). Audit stock.price_log with both costs.';

revoke all on function app.price_logged_stock(uuid, jsonb) from public, anon;
grant execute on function app.price_logged_stock(uuid, jsonb) to authenticated;
