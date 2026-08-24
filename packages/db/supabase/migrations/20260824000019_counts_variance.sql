-- 0019_counts_variance — stock counts + variance/COGS/expiry reporting views
-- (design-data.md §1.8 tail, week-3 track A).
--
--  * start_count snapshots the LEDGER theoretical (includes overdrafts) per
--    active ingredient; finalize_count writes count_adjustment movements and
--    reconciles batches: shortages draw down oldest-first (FEFO order),
--    surpluses top up the newest live batch (zero-cost synthetic if none).
--    Adjustments are written per batch touched (they sum to the line delta) so
--    per-batch ledger sums stay consistent with qty_remaining; a shortage
--    beyond batch stock lands on a batch-null row, like FEFO overdrafts.
--  * All views are security_invoker: RLS on the base tables (manager/owner)
--    is what makes them staff-only.

set check_function_bodies = off;

create table stock_counts (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finalized_at timestamptz,
  counted_by   uuid not null references staff(id)
);

create table stock_count_lines (
  count_id        uuid not null references stock_counts(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id),
  theoretical_qty numeric(12,3) not null,     -- snapshot at count start (ledger sum)
  counted_qty     numeric(12,3) not null,
  primary key (count_id, ingredient_id)
);

-- Deferred FK from 0018 (stock_movements.count_id existed before this table).
alter table stock_movements
  add constraint stock_movements_count_id_fkey
  foreign key (count_id) references stock_counts(id);

-- ---------------------------------------------------------------------------
-- app.start_count — manager/owner; one open count at a time; snapshots the
-- ledger theoretical for every active ingredient (counted_qty starts at the
-- theoretical and is overwritten by finalize_count's payload).
-- ---------------------------------------------------------------------------
create or replace function app.start_count() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_count stock_counts%rowtype;
  v_lines int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if exists (select 1 from stock_counts where finalized_at is null) then
    raise exception 'COUNT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  insert into stock_counts (counted_by) values (auth.uid()) returning * into v_count;

  insert into stock_count_lines (count_id, ingredient_id, theoretical_qty, counted_qty)
  select v_count.id, i.id,
         coalesce((select sum(m.qty_delta) from stock_movements m where m.ingredient_id = i.id), 0),
         coalesce((select sum(m.qty_delta) from stock_movements m where m.ingredient_id = i.id), 0)
    from ingredients i
   where i.is_active;
  get diagnostics v_lines = row_count;

  perform app.write_audit('stock.start_count', 'stock_counts', v_count.id::text,
                          null, jsonb_build_object('lines', v_lines));

  return jsonb_build_object('count_id', v_count.id, 'lines', v_lines,
                            'started_at', v_count.started_at);
end $$;

-- ---------------------------------------------------------------------------
-- app.finalize_count — manager/owner. p_lines: [{"ingredient_id": uuid,
-- "counted_qty": n}, ...]. Writes count_adjustment movements for every line
-- whose counted differs from the start snapshot, reconciles batches, stamps
-- finalized_at. Adjustment delta = counted − theoretical(snapshot).
-- ---------------------------------------------------------------------------
create or replace function app.finalize_count(
  p_count_id  uuid,
  p_lines     jsonb default '[]'::jsonb,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_count    stock_counts%rowtype;
  v_line     jsonb;
  v_cl       stock_count_lines%rowtype;
  v_delta    numeric;
  v_left     numeric;
  v_take     numeric;
  v_batch    record;
  v_adjusted int := 0;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_count from stock_counts where id = p_count_id for update;
  if not found then
    raise exception 'COUNT_NOT_FOUND' using errcode = 'P0001';
  end if;
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

  -- Reconcile every drifted line.
  for v_cl in
    select * from stock_count_lines
     where count_id = p_count_id and counted_qty <> theoretical_qty
  loop
    v_delta := v_cl.counted_qty - v_cl.theoretical_qty;
    v_adjusted := v_adjusted + 1;

    if v_delta < 0 then
      -- Shortage: draw down oldest-first (FEFO scan order), overdraft on batch null.
      v_left := -v_delta;
      for v_batch in
        select id, qty_remaining, unit_cost_iqd
          from stock_batches
         where ingredient_id = v_cl.ingredient_id and qty_remaining > 0
         order by expiry_date asc nulls last, received_at asc
         for update
      loop
        exit when v_left <= 0;
        v_take := least(v_left, v_batch.qty_remaining);
        update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
        insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                     unit_cost_iqd, count_id, staff_id, device_id, reason_code)
        values (v_cl.ingredient_id, v_batch.id, 'count_adjustment', -v_take,
                v_batch.unit_cost_iqd, p_count_id, auth.uid(), p_device_id, 'count_shortage');
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then
        insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                     unit_cost_iqd, count_id, staff_id, device_id, reason_code)
        values (v_cl.ingredient_id, null, 'count_adjustment', -v_left,
                null, p_count_id, auth.uid(), p_device_id, 'count_shortage');
      end if;
    else
      -- Surplus: top up the newest live batch, or a zero-cost synthetic batch.
      select id, unit_cost_iqd into v_batch
        from stock_batches
       where ingredient_id = v_cl.ingredient_id and qty_remaining > 0
       order by received_at desc, id desc
       limit 1
       for update;
      if found then
        update stock_batches set qty_remaining = qty_remaining + v_delta where id = v_batch.id;
      else
        insert into stock_batches (ingredient_id, delivery_line_id, qty_received, qty_remaining, unit_cost_iqd)
        values (v_cl.ingredient_id, null, v_delta, v_delta, 0)
        returning id, unit_cost_iqd into v_batch;
      end if;
      insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                   unit_cost_iqd, count_id, staff_id, device_id, reason_code)
      values (v_cl.ingredient_id, v_batch.id, 'count_adjustment', v_delta,
              v_batch.unit_cost_iqd, p_count_id, auth.uid(), p_device_id, 'count_surplus');
    end if;
  end loop;

  update stock_counts set finalized_at = now() where id = p_count_id
  returning * into v_count;

  perform app.write_audit('stock.finalize_count', 'stock_counts', p_count_id::text,
                          null, jsonb_build_object('adjusted_lines', v_adjusted),
                          null, null, p_device_id);

  return jsonb_build_object('count_id', p_count_id, 'adjusted_lines', v_adjusted,
                            'finalized_at', v_count.finalized_at);
end $$;

-- ---------------------------------------------------------------------------
-- Reporting views. security_invoker: the caller's own RLS (manager/owner on
-- stock tables) gates every one of them — non-managers see zero rows.
-- ---------------------------------------------------------------------------

create view v_ingredient_on_hand with (security_invoker = on) as
select i.id  as ingredient_id,
       i.name_en, i.name_ar, i.unit, i.kind,
       coalesce(b.on_hand, 0)     as on_hand,        -- live batches (never negative)
       coalesce(m.theoretical, 0) as theoretical,    -- ledger sum (overdrafts included)
       i.par_level, i.low_stock_threshold, i.is_active
  from ingredients i
  left join (select ingredient_id, sum(qty_remaining) as on_hand
               from stock_batches where qty_remaining > 0 group by ingredient_id) b
         on b.ingredient_id = i.id
  left join (select ingredient_id, sum(qty_delta) as theoretical
               from stock_movements group by ingredient_id) m
         on m.ingredient_id = i.id;

create view v_variance_report with (security_invoker = on) as
with counts as (
  select c.id, c.finalized_at, c.counted_by,
         lag(c.finalized_at) over (order by c.finalized_at) as period_start
    from stock_counts c
   where c.finalized_at is not null
)
select c.id                          as count_id,
       c.period_start,
       c.finalized_at                as period_end,
       l.ingredient_id,
       i.name_en, i.name_ar, i.unit,
       l.theoretical_qty,
       l.counted_qty,
       l.counted_qty - l.theoretical_qty        as variance_qty,
       p.sold_qty,
       round(p.sold_qty * i.waste_allowance_percent / 100.0, 3)
                                     as expected_waste_qty,   -- allowance, separate column
       p.recorded_waste_qty,                                   -- spill + spoilage
       p.void_qty,                                             -- void_after_send
       p.expired_qty,                                          -- expired_writeoff
       p.movement_ids                                          -- drill-down
  from stock_count_lines l
  join counts c on c.id = l.count_id
  join ingredients i on i.id = l.ingredient_id
  left join lateral (
    select coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'sale_consumption'), 0) as sold_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type in ('waste_spill','waste_spoilage')), 0) as recorded_waste_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'void_after_send'), 0) as void_qty,
           coalesce(-sum(sm.qty_delta) filter (where sm.movement_type = 'expired_writeoff'), 0) as expired_qty,
           array_agg(sm.id order by sm.id) as movement_ids
      from stock_movements sm
     where sm.ingredient_id = l.ingredient_id
       and sm.at <= c.finalized_at
       and (c.period_start is null or sm.at > c.period_start)
  ) p on true;

create view v_item_cogs with (security_invoker = on) as
select v.id      as variant_id,
       v.item_id,
       mi.name_en as item_name_en, mi.name_ar as item_name_ar,
       v.name_en  as variant_name_en, v.name_ar as variant_name_ar,
       v.price_iqd,
       sum(rl.qty / (i.yield_percent / 100.0) * c.unit_cost_iqd) as cogs_iqd
  from menu_item_variants v
  join menu_items mi on mi.id = v.item_id
  join recipe_lines rl on rl.variant_id = v.id
  join ingredients i on i.id = rl.ingredient_id
  left join lateral (
    select coalesce(
             (select b.unit_cost_iqd from stock_batches b
               where b.ingredient_id = i.id order by b.received_at desc, b.id desc limit 1),
             i.pack_cost_iqd / nullif(i.pack_size, 0),
             0) as unit_cost_iqd
  ) c on true
 group by v.id, v.item_id, mi.name_en, mi.name_ar, v.name_en, v.name_ar, v.price_iqd;

create view v_item_margin with (security_invoker = on) as
select variant_id, item_id, item_name_en, item_name_ar,
       variant_name_en, variant_name_ar,
       price_iqd,
       round(cogs_iqd)::bigint                  as cogs_iqd,
       price_iqd - round(cogs_iqd)::bigint      as margin_iqd,
       case when price_iqd > 0
            then round((price_iqd - cogs_iqd) / price_iqd * 100.0, 1) end as margin_percent
  from v_item_cogs;

create view v_expiring_soon with (security_invoker = on) as
select b.id as batch_id, b.ingredient_id, i.name_en, i.name_ar, i.unit,
       b.qty_remaining, b.unit_cost_iqd, b.expiry_date,
       b.expiry_date - current_date as days_left
  from stock_batches b
  join ingredients i on i.id = b.ingredient_id
 where b.qty_remaining > 0
   and b.expiry_date is not null
   and b.expiry_date >= current_date
   and b.expiry_date <= current_date + (select expiring_soon_days from venue_settings);

create view v_expired with (security_invoker = on) as
select b.id as batch_id, b.ingredient_id, i.name_en, i.name_ar, i.unit,
       b.qty_remaining, b.unit_cost_iqd, b.expiry_date,
       current_date - b.expiry_date as days_expired
  from stock_batches b
  join ingredients i on i.id = b.ingredient_id
 where b.qty_remaining > 0
   and b.expiry_date is not null
   and b.expiry_date < current_date;

-- ---------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------
alter table stock_counts enable row level security;
alter table stock_count_lines enable row level security;

grant select on stock_counts, stock_count_lines to authenticated;
create policy stock_counts_mgmt_read on stock_counts for select to authenticated
  using (app.is_staff('manager','owner'));
create policy stock_count_lines_mgmt_read on stock_count_lines for select to authenticated
  using (app.is_staff('manager','owner'));

grant select on v_ingredient_on_hand, v_variance_report, v_item_cogs, v_item_margin,
                v_expiring_soon, v_expired to authenticated;

revoke all on function app.start_count() from public, anon;
grant execute on function app.start_count() to authenticated;
revoke all on function app.finalize_count(uuid, jsonb, text) from public, anon;
grant execute on function app.finalize_count(uuid, jsonb, text) to authenticated;
