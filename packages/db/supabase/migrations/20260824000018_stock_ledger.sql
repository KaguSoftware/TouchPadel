-- 0018_stock_ledger — the APPEND-ONLY movements ledger, FEFO consumption engine,
-- production, waste, expiry write-off, manager alerts, and the wiring that makes
-- a sale consume stock (design-data.md §1.8, §4).
--
--  * stock_movements is the only truth; stock_batches.qty_remaining is the FEFO
--    index maintained in the same transaction.
--  * consume_fefo: FOR UPDATE serializes concurrent tickets on one ingredient;
--    a shortfall becomes a negative-stock overdraft row (batch_id null) + a
--    manager alert — a sale is NEVER blocked by stock.
--  * Wiring is TRIGGER-BASED so this file never patches Drop-2 RPC bodies:
--      tickets AFTER INSERT            -> consume the order's items (sale_consumption)
--      order_items voided flips true   -> reclass pair (+sale_consumption reversal,
--                                         −void_after_send) — net zero on-hand,
--                                         waste correctly attributed
--      refund_items AFTER INSERT       -> refund_reversal restock into the newest
--                                         live batch (zero-cost synthetic if none)
--  * menu_item_availability is REPLACED with the stock-aware version (§1.4).

-- Bodies reference Drop-2 tables (orders, order_items, tickets, refund_items,
-- menu_item_variants) — all exist by 0016 on a fresh run; keep validation off
-- for safety while both drops land.
set check_function_bodies = off;

create table stock_movements (                -- APPEND-ONLY LEDGER; the only truth
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  ingredient_id    uuid not null references ingredients(id),
  batch_id         uuid references stock_batches(id),   -- null only for negative-stock overdraft lines
  movement_type    movement_type not null,
  qty_delta        numeric(12,3) not null,              -- + in, − out; never zero
  unit_cost_iqd    numeric(14,4),                       -- COGS at the moment of movement
  order_item_id    uuid references order_items(id),
  ticket_id        uuid references tickets(id),
  delivery_line_id uuid references delivery_lines(id),
  count_id         uuid,                                -- FK added in 0019 (stock_counts lands there)
  refund_id        uuid references refunds(id),
  reason_code      text,
  staff_id         uuid references staff(id),
  device_id        text,
  check (qty_delta <> 0)
);

create index stock_movements_ingredient_at on stock_movements (ingredient_id, at desc);
create index stock_movements_order_item on stock_movements (order_item_id) where order_item_id is not null;
create index stock_movements_type_at on stock_movements (movement_type, at desc);

-- Append-only, both layers (design §3.4).
revoke update, delete on stock_movements from anon, authenticated;
create trigger stock_movements_ao
  before update or delete on stock_movements
  for each statement execute function app.forbid_mutation();

create table manager_alerts (
  id              uuid primary key default gen_random_uuid(),
  kind            alert_kind not null,
  payload         jsonb not null,             -- {"ingredient_id":..,"shortfall":..} — machine payload
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references staff(id)
);

create index manager_alerts_open on manager_alerts (kind, created_at desc)
  where acknowledged_at is null;

-- ---------------------------------------------------------------------------
-- app.ingredient_on_hand — sum(qty_remaining) over live batches. Cheap at
-- one-venue scale (design §1.4). Never negative (overdrafts live only in the
-- ledger); theoretical-including-overdraft is the ledger sum (see 0019 views).
-- ---------------------------------------------------------------------------
create or replace function app.ingredient_on_hand(p_ingredient uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty_remaining), 0)
    from stock_batches
   where ingredient_id = p_ingredient and qty_remaining > 0
$$;

-- ---------------------------------------------------------------------------
-- app.consume_fefo — design §4, exactly. FOR UPDATE serializes concurrent
-- tickets on the same ingredient; overdraft row (batch null) + negative_stock
-- alert on shortfall; never blocks a sale.
-- (p_reason_code appended so waste/write-off callers can attribute movements.)
-- ---------------------------------------------------------------------------
create or replace function app.consume_fefo(
  p_ingredient uuid, p_qty numeric, p_type movement_type,
  p_order_item uuid default null, p_ticket uuid default null,
  p_staff uuid default null, p_device text default null,
  p_reason_code text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_left numeric := p_qty; v_batch record; v_take numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;

  for v_batch in
    select id, qty_remaining, unit_cost_iqd
      from stock_batches
     where ingredient_id = p_ingredient and qty_remaining > 0
     order by expiry_date asc nulls last, received_at asc
     for update                                   -- serialize concurrent tickets on the same ingredient
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_batch.qty_remaining);
    update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (p_ingredient, v_batch.id, p_type, -v_take,
            v_batch.unit_cost_iqd, p_order_item, p_ticket, p_staff, p_device, p_reason_code);
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then                               -- NEGATIVE STOCK: record the truth, alert, never block a sale
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (p_ingredient, null, p_type, -v_left,
            (select unit_cost_iqd from stock_batches where ingredient_id = p_ingredient
              order by received_at desc limit 1),   -- best-effort COGS
            p_order_item, p_ticket, p_staff, p_device, p_reason_code);
    insert into manager_alerts (kind, payload)
    values ('negative_stock', jsonb_build_object('ingredient_id', p_ingredient,
            'shortfall', v_left, 'order_item_id', p_order_item));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- app.order_item_bom — PER-UNIT requirements of one order item: variant lines
-- + modifier lines × modifier qty (double shot = 2 × the line), yield-adjusted.
-- Prepared components stay DIRECT — they consume from their own batches
-- (production is explicit; design §4).
-- ---------------------------------------------------------------------------
create or replace function app.order_item_bom(p_order_item_id uuid)
returns table (ingredient_id uuid, qty numeric)
language sql stable security definer set search_path = public as $$
  select l.ingredient_id,
         sum(l.qty * l.factor / (i.yield_percent / 100.0)) as qty
    from (
      select rl.ingredient_id, rl.qty, 1::numeric as factor
        from order_items oi
        join recipe_lines rl on rl.variant_id = oi.variant_id
       where oi.id = p_order_item_id
      union all
      select rl.ingredient_id, rl.qty, oim.qty::numeric
        from order_item_modifiers oim
        join recipe_lines rl on rl.modifier_id = oim.modifier_id
       where oim.order_item_id = p_order_item_id
    ) l
    join ingredients i on i.id = l.ingredient_id
   group by l.ingredient_id
$$;

-- ---------------------------------------------------------------------------
-- app.item_required_ingredients — AVAILABILITY expansion (design §1.4).
-- Accepts a menu_items.id (union over the item's variants) or a variant id.
-- Modifier lines are excluded (optional add-ons never grey an item).
-- Prepared components: if the prepared ingredient has stock it is required
-- as-is (it consumes from its own batches); if it is OUT, expand ONE level
-- into its components — the item only greys when the raws are also gone
-- (kitchen can still make it; matches "training signal, not a blocker").
-- ---------------------------------------------------------------------------
create or replace function app.item_required_ingredients(p_id uuid)
returns table (ingredient_id uuid, qty numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with direct as (
    select rl.ingredient_id, sum(rl.qty) as qty
      from recipe_lines rl
     where rl.variant_id = p_id
        or rl.variant_id in (select v.id from menu_item_variants v where v.item_id = p_id)
     group by rl.ingredient_id
  ),
  expanded as (
    -- purchased, or prepared with stock on hand: required as-is
    select d.ingredient_id, d.qty
      from direct d
      join ingredients i on i.id = d.ingredient_id
     where i.kind = 'purchased' or app.ingredient_on_hand(d.ingredient_id) > 0
    union all
    -- prepared and OUT: one-level expansion into its components
    select rl.ingredient_id, d.qty * rl.qty
      from direct d
      join ingredients i on i.id = d.ingredient_id
      join recipe_lines rl on rl.output_ingredient_id = d.ingredient_id
     where i.kind = 'prepared' and app.ingredient_on_hand(d.ingredient_id) <= 0
  )
  select e.ingredient_id, sum(e.qty / (i.yield_percent / 100.0))
    from expanded e
    join ingredients i on i.id = e.ingredient_id
   group by e.ingredient_id;
end $$;

-- ---------------------------------------------------------------------------
-- Stock-aware menu availability (replaces the 0013 view; same columns, same
-- definer posture, same grants): grey out when any required ingredient's
-- on-hand <= 0.
-- ---------------------------------------------------------------------------
drop view if exists menu_item_availability;
create view menu_item_availability with (security_invoker = off) as
select mi.id as item_id,
       mi.is_active and coalesce(mi.unavailable_on <> current_date, true)
         and not exists (
           select 1 from app.item_required_ingredients(mi.id) ri
           where app.ingredient_on_hand(ri.ingredient_id) <= 0
         ) as orderable
from menu_items mi;

grant select on menu_item_availability to anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.consume_for_order_item — the sale-consumption driver (design §4).
-- Idempotent per order item: a replayed ticket insert never double-consumes.
-- ---------------------------------------------------------------------------
create or replace function app.consume_for_order_item(
  p_order_item_id uuid,
  p_ticket_id     uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
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

  for v_r in select * from app.order_item_bom(p_order_item_id) loop
    perform app.consume_fefo(v_r.ingredient_id, v_r.qty * v_oi.qty, 'sale_consumption',
                             p_order_item_id, p_ticket_id,
                             v_order.placed_by_staff_id, v_order.device_id);
  end loop;
end $$;

-- WIRING 1: a new ticket consumes its order's items.
create or replace function app.trg_ticket_consume() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_oi record;
begin
  for v_oi in select id from order_items where order_id = new.order_id and not voided loop
    perform app.consume_for_order_item(v_oi.id, new.id);
  end loop;
  return new;
end $$;

create trigger tickets_consume_stock
  after insert on tickets
  for each row execute function app.trg_ticket_consume();

-- WIRING 2: void after send — reclass pair per original consumption row:
-- (+qty sale_consumption reversal, −qty void_after_send), same batch, so
-- on-hand and per-batch sums stay consistent while the waste report picks up
-- the void. Overdraft rows (batch null) pair with batch null.
create or replace function app.trg_order_item_voided() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_m record;
begin
  if exists (select 1 from stock_movements
              where order_item_id = new.id and movement_type = 'void_after_send') then
    return new;                               -- replay: already reclassified
  end if;

  for v_m in
    select * from stock_movements
     where order_item_id = new.id and movement_type = 'sale_consumption' and qty_delta < 0
  loop
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (v_m.ingredient_id, v_m.batch_id, 'sale_consumption', -v_m.qty_delta,
            v_m.unit_cost_iqd, new.id, v_m.ticket_id, auth.uid(), v_m.device_id, 'void_after_send_reversal');
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id, reason_code)
    values (v_m.ingredient_id, v_m.batch_id, 'void_after_send', v_m.qty_delta,
            v_m.unit_cost_iqd, new.id, v_m.ticket_id, auth.uid(), v_m.device_id, new.void_reason_code);
  end loop;
  return new;
end $$;

create trigger order_items_void_stock
  after update of voided on order_items
  for each row
  when (new.voided and not old.voided)
  execute function app.trg_order_item_voided();

-- WIRING 3: refund restock — refund_items insert reverses the line's BOM at the
-- refunded qty into the NEWEST live batch per ingredient (zero-cost synthetic
-- batch if none) — pragmatic, documented, visible in the ledger (design §4).
create or replace function app.trg_refund_restock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_r        record;
  v_batch    record;
  v_qty      numeric;
  v_refund   refunds%rowtype;
begin
  select * into v_refund from refunds where id = new.refund_id;

  for v_r in select * from app.order_item_bom(new.order_item_id) loop
    v_qty := v_r.qty * new.qty;

    select id, unit_cost_iqd into v_batch
      from stock_batches
     where ingredient_id = v_r.ingredient_id and qty_remaining > 0
     order by received_at desc, id desc
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
end $$;

create trigger refund_items_restock
  after insert on refund_items
  for each row execute function app.trg_refund_restock();

-- ---------------------------------------------------------------------------
-- app.record_production — explicit sub-recipe production (design §4): consumes
-- component stock FEFO (production_consume, prepared components from their own
-- batches) and creates a production_in batch costed at Σ actual consumed costs.
-- Recipe lines with output_ingredient_id = the prepared id are per ONE base
-- unit of output.
-- ---------------------------------------------------------------------------
create or replace function app.record_production(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_expiry_date   date default null,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ing      ingredients%rowtype;
  v_r        record;
  v_from_id  bigint;
  v_cost     numeric;
  v_unit     numeric;
  v_expiry   date;
  v_batch_id uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
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

  select coalesce(max(id), 0) into v_from_id from stock_movements;

  for v_r in
    select rl.ingredient_id, sum(rl.qty / (i.yield_percent / 100.0)) as qty
      from recipe_lines rl
      join ingredients i on i.id = rl.ingredient_id
     where rl.output_ingredient_id = p_ingredient_id
     group by rl.ingredient_id
  loop
    perform app.consume_fefo(v_r.ingredient_id, v_r.qty * p_qty, 'production_consume',
                             null, null, auth.uid(), p_device_id);
  end loop;

  select coalesce(sum(-qty_delta * coalesce(unit_cost_iqd, 0)), 0) into v_cost
    from stock_movements where id > v_from_id and movement_type = 'production_consume';
  v_unit := round(v_cost / p_qty, 4);

  v_expiry := coalesce(p_expiry_date,
    case when v_ing.shelf_life_days is not null then current_date + v_ing.shelf_life_days end);

  insert into stock_batches (ingredient_id, delivery_line_id, expiry_date, qty_received, qty_remaining, unit_cost_iqd)
  values (p_ingredient_id, null, v_expiry, p_qty, p_qty, v_unit)
  returning id into v_batch_id;

  insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                               unit_cost_iqd, staff_id, device_id)
  values (p_ingredient_id, v_batch_id, 'production_in', p_qty, v_unit, auth.uid(), p_device_id);

  perform app.write_audit('stock.record_production', 'ingredients', p_ingredient_id::text,
                          null, jsonb_build_object('qty', p_qty, 'batch_id', v_batch_id,
                                                   'unit_cost_iqd', v_unit),
                          null, null, p_device_id);

  return jsonb_build_object('batch_id', v_batch_id, 'unit_cost_iqd', v_unit, 'expiry_date', v_expiry);
end $$;

-- ---------------------------------------------------------------------------
-- app.record_waste — cashier-allowed (matrix: the ONE cashier stock path) with
-- a mandatory reason; spillage vs spoilage kept separate for the variance report.
-- ---------------------------------------------------------------------------
create or replace function app.record_waste(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_movement_type movement_type default 'waste_spill',
  p_reason_code   text default null,
  p_device_id     text default null
) returns void
language plpgsql security definer set search_path = public as $$
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

  perform app.consume_fefo(p_ingredient_id, p_qty, p_movement_type,
                           null, null, auth.uid(), p_device_id, p_reason_code);

  perform app.write_audit('stock.record_waste', 'ingredients', p_ingredient_id::text,
                          null, jsonb_build_object('qty', p_qty, 'movement_type', p_movement_type),
                          p_reason_code, null, p_device_id);
end $$;

-- ---------------------------------------------------------------------------
-- app.write_off_expired — manager PIN confirms writing off an expired batch;
-- expired_writeoff stays separate from spillage/spoilage in the variance report.
-- NULL from verify_manager_pin = invalid PIN (0011 pattern) — re-raise here.
-- ---------------------------------------------------------------------------
create or replace function app.write_off_expired(
  p_batch_id    uuid,
  p_pin         text,
  p_reason_code text default 'expired',
  p_device_id   text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_batch      stock_batches%rowtype;
  v_authorizer uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_authorizer := app.verify_manager_pin(p_pin, p_device_id);
  if v_authorizer is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  select * into v_batch from stock_batches where id = p_batch_id for update;
  if not found then
    raise exception 'BATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_batch.qty_remaining <= 0 then
    raise exception 'BATCH_EMPTY' using errcode = 'P0001';
  end if;

  update stock_batches set qty_remaining = 0 where id = p_batch_id;

  insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                               unit_cost_iqd, staff_id, device_id, reason_code)
  values (v_batch.ingredient_id, p_batch_id, 'expired_writeoff', -v_batch.qty_remaining,
          v_batch.unit_cost_iqd, auth.uid(), p_device_id, p_reason_code);

  perform app.write_audit('stock.write_off_expired', 'stock_batches', p_batch_id::text,
                          to_jsonb(v_batch), null, p_reason_code, v_authorizer, p_device_id);
end $$;

-- ---------------------------------------------------------------------------
-- app.acknowledge_alert — manager/owner clears an alert (RPC-only write path).
-- ---------------------------------------------------------------------------
create or replace function app.acknowledge_alert(p_alert_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update manager_alerts
     set acknowledged_at = now(), acknowledged_by = auth.uid()
   where id = p_alert_id and acknowledged_at is null;
  if not found then
    raise exception 'ALERT_NOT_FOUND' using errcode = 'P0001',
      hint = 'no such alert, or already acknowledged';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Low-stock alert: any outbound movement that leaves an ingredient at/below its
-- threshold raises ONE open low_stock alert (deduped while unacknowledged).
-- ---------------------------------------------------------------------------
create or replace function app.trg_low_stock_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_threshold numeric;
  v_on_hand   numeric;
begin
  select low_stock_threshold into v_threshold from ingredients where id = new.ingredient_id;
  if v_threshold is null then
    return new;
  end if;
  v_on_hand := app.ingredient_on_hand(new.ingredient_id);
  if v_on_hand <= v_threshold
     and not exists (select 1 from manager_alerts
                      where kind = 'low_stock' and acknowledged_at is null
                        and payload->>'ingredient_id' = new.ingredient_id::text) then
    insert into manager_alerts (kind, payload)
    values ('low_stock', jsonb_build_object('ingredient_id', new.ingredient_id,
            'on_hand', v_on_hand, 'threshold', v_threshold));
  end if;
  return new;
end $$;

create trigger stock_movements_low_stock
  after insert on stock_movements
  for each row
  when (new.qty_delta < 0)
  execute function app.trg_low_stock_alert();

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------
alter table stock_movements enable row level security;
alter table manager_alerts  enable row level security;

grant select on stock_movements, manager_alerts to authenticated;

create policy stock_movements_mgmt_read on stock_movements for select to authenticated
  using (app.is_staff('manager','owner'));
create policy manager_alerts_mgmt_read on manager_alerts for select to authenticated
  using (app.is_staff('manager','owner'));

-- Internal-only (called from definer functions / triggers / the definer view):
revoke all on function app.ingredient_on_hand(uuid) from public, anon, authenticated;
revoke all on function app.consume_fefo(uuid, numeric, movement_type, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function app.order_item_bom(uuid) from public, anon, authenticated;
revoke all on function app.item_required_ingredients(uuid) from public, anon, authenticated;
revoke all on function app.consume_for_order_item(uuid, uuid) from public, anon, authenticated;
revoke all on function app.trg_ticket_consume() from public, anon, authenticated;
revoke all on function app.trg_order_item_voided() from public, anon, authenticated;
revoke all on function app.trg_refund_restock() from public, anon, authenticated;
revoke all on function app.trg_low_stock_alert() from public, anon, authenticated;

-- Client-callable RPCs (role guards FIRST inside each body):
revoke all on function app.record_production(uuid, numeric, date, text) from public, anon;
grant execute on function app.record_production(uuid, numeric, date, text) to authenticated;
revoke all on function app.record_waste(uuid, numeric, movement_type, text, text) from public, anon;
grant execute on function app.record_waste(uuid, numeric, movement_type, text, text) to authenticated;
revoke all on function app.write_off_expired(uuid, text, text, text) from public, anon;
grant execute on function app.write_off_expired(uuid, text, text, text) to authenticated;
revoke all on function app.acknowledge_alert(uuid) from public, anon;
grant execute on function app.acknowledge_alert(uuid) to authenticated;
