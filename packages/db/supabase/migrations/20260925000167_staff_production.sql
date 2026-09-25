-- 0167 staff_production — the chefs record a batch on the phone: what to make
-- today, the batch itself (stock deducted as the manager's production does),
-- and what was made today.
--
-- Feature: protocols and the staff phone, lane C
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.16, §2.18; plan §6.4, §7.2).
-- Depends on: nothing. The phone's staff-production (H) and the operator's
-- Stock ▸ Waste and production "Made today" (I) read through it.
-- Re-runnable: create or replace.
--
-- ONE BODY, TWO DOORS. app.record_production (0018:342, its latest and only
-- body) is split: its body, without the guard, becomes the internal
-- app.record_production_internal, and record_production is re-issued as the
-- same MGMT-guarded function calling it (signature, defaults and grant
-- unchanged). app.record_batch is the second door, for the head chef and the
-- chef as well: it names the venue (a phone asserts no station), refuses an
-- ingredient of another venue, and claims an idempotency key, because the
-- body takes none and a retried batch would deduct the components twice
-- (0049). It returns the quantity and expiry, never the batch's unit cost.
--
-- THE DAY. "Today" is the venue's business day: the three-argument
-- business_date in the venue's timezone with the analytics start hour, the
-- rule app.venue_business_date (checklists) states, written out here because
-- this migration depends on nothing.
--
-- Bar batches (syrups) are not in v1 (PROPOSAL; the decision names chef
-- production).
--
-- covered by packages/db/tests/staff-production.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.record_production_internal — the 0018:342 body verbatim, without its
--    guard. Internal: record_production and record_batch guard it.
-- ---------------------------------------------------------------------------
create or replace function app.record_production_internal(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_expiry_date   date,
  p_device_id     text
) returns jsonb
language plpgsql security definer set search_path = public as $record_production_internal_0167$
declare
  v_ing      ingredients%rowtype;
  v_r        record;
  v_from_id  bigint;
  v_cost     numeric;
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
end $record_production_internal_0167$;

comment on function app.record_production_internal(uuid, numeric, date, text) is
  'staff_production (§2.16). Internal: the 0018 record_production body without its guard. Consumes the prepared ingredient''s components FEFO (production_consume), creates a production_in batch costed at what was consumed, audits stock.record_production and returns {batch_id, unit_cost_iqd, expiry_date}. INVALID_QTY, NOT_PREPARED, NO_RECIPE. Reached only through app.record_production (MGMT) and app.record_batch (the chefs and MGMT).';

revoke all on function app.record_production_internal(uuid, numeric, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.record_production — re-issued as the wrapper: the same signature,
--    defaults, MGMT guard, result and grant as 0018.
-- ---------------------------------------------------------------------------
create or replace function app.record_production(
  p_ingredient_id uuid,
  p_qty           numeric,
  p_expiry_date   date default null,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $record_production_0167$
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.record_production_internal(p_ingredient_id, p_qty, p_expiry_date, p_device_id);
end $record_production_0167$;

comment on function app.record_production(uuid, numeric, date, text) is
  '0018 + staff_production (§2.16). MGMT: explicit sub-recipe production through app.record_production_internal (components consumed FEFO, a production_in batch costed at what was consumed). Returns {batch_id, unit_cost_iqd, expiry_date}.';

revoke all on function app.record_production(uuid, numeric, date, text) from public, anon;
grant execute on function app.record_production(uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.record_batch — the head chef, the chef and MGMT at the venue.
-- ---------------------------------------------------------------------------
create or replace function app.record_batch(
  p_ingredient_id   uuid,
  p_qty             numeric,
  p_expiry_date     date default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $record_batch_0167$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_made   jsonb;
  v_result jsonb;
begin
  if not app.is_staff('head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- consume_fefo's movements and the new batch take venue_id from
  -- app.current_venue(); a phone asserts no station.
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'record_batch');
  if v_replay is not null then
    return v_replay;
  end if;

  if not exists (select 1 from ingredients where id = p_ingredient_id and venue_id = v_venue) then
    raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_made := app.record_production_internal(p_ingredient_id, p_qty, p_expiry_date, null);

  v_result := jsonb_build_object('batch_id',    v_made->'batch_id',
                                 'qty',         p_qty,
                                 'expiry_date', v_made->'expiry_date');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $record_batch_0167$;

comment on function app.record_batch(uuid, numeric, date, uuid, text) is
  'staff_production (§2.16). The head chef, the chef and MGMT at the venue: records a batch of a prepared ingredient of that venue through app.record_production_internal (components consumed FEFO; audit stock.record_production). Returns {batch_id, qty, expiry_date}, never the unit cost. Idempotent by key: a retry never deducts twice. INGREDIENT_NOT_FOUND (not an ingredient of the venue), INVALID_QTY, NOT_PREPARED, NO_RECIPE; FORBIDDEN for anyone else.';

revoke all on function app.record_batch(uuid, numeric, date, uuid, text) from public, anon;
grant execute on function app.record_batch(uuid, numeric, date, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.production_today — what to make: every active prepared ingredient
--    of the venue with an output recipe, below par first. Quantities only,
--    no cost.
-- ---------------------------------------------------------------------------
create or replace function app.production_today(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $production_today_0167$
declare
  v_venue uuid;
  v_tz    text;
  v_start int := coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4);
  v_from  timestamptz;
  v_items jsonb;
begin
  if not app.is_staff('head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_tz   := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
  v_from := (app.business_date(now(), v_tz, v_start) + make_interval(hours => v_start)) at time zone v_tz;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredient_id',   x.id,
           'name_en',         x.name_en,
           'name_ar',         x.name_ar,
           'unit',            x.unit,
           'on_hand',         x.on_hand,
           'par_level',       x.par_level,
           'below_par',       x.below_par,
           'made_today',      x.made_today,
           'shelf_life_days', x.shelf_life_days)
         order by x.below_par desc, lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.name_en, i.name_ar, i.unit::text as unit, i.par_level, i.shelf_life_days,
                 oh.on_hand,
                 (i.par_level is not null and oh.on_hand < i.par_level) as below_par,
                 coalesce((select sum(m.qty_delta) from stock_movements m
                            where m.ingredient_id = i.id
                              and m.movement_type = 'production_in'
                              and m.at >= v_from and m.at < v_from + interval '1 day'), 0) as made_today
            from ingredients i
            cross join lateral (
              select coalesce(sum(b.qty_remaining), 0) as on_hand
                from stock_batches b
               where b.ingredient_id = i.id and b.qty_remaining > 0) oh
           where i.venue_id = v_venue
             and i.is_active
             and i.kind = 'prepared'
             and exists (select 1 from recipe_lines rl where rl.output_ingredient_id = i.id)) x;

  return jsonb_build_object('items', v_items);
end $production_today_0167$;

comment on function app.production_today(uuid) is
  'staff_production (§2.16). The head chef, the chef and MGMT at the venue: {items: [{ingredient_id, name_en, name_ar, unit, on_hand, par_level, below_par, made_today, shelf_life_days}]}, every active prepared ingredient with an output recipe, below par first; made_today is the business day''s production_in. No cost. FORBIDDEN for anyone else.';

revoke all on function app.production_today(uuid) from public, anon;
grant execute on function app.production_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.production_log_today — "Made today": the business day's production_in
--    movements at the venue, newest first, who and how much. No cost.
-- ---------------------------------------------------------------------------
create or replace function app.production_log_today(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $production_log_today_0167$
declare
  v_venue uuid;
  v_tz    text;
  v_start int := coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4);
  v_from  timestamptz;
  v_rows  jsonb;
begin
  if not app.is_staff('head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_tz   := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
  v_from := (app.business_date(now(), v_tz, v_start) + make_interval(hours => v_start)) at time zone v_tz;

  select coalesce(jsonb_agg(jsonb_build_object(
           'movement_id',   m.id,
           'ingredient_id', m.ingredient_id,
           'name_en',       i.name_en,
           'name_ar',       i.name_ar,
           'qty',           m.qty_delta,
           'unit',          i.unit,
           'staff_name',    s.display_name,
           'at',            m.at)
         order by m.at desc, m.id desc), '[]'::jsonb)
    into v_rows
    from stock_movements m
    join ingredients i on i.id = m.ingredient_id
    left join staff s on s.id = m.staff_id
   where m.movement_type = 'production_in'
     and m.venue_id = v_venue
     and m.at >= v_from and m.at < v_from + interval '1 day';

  return jsonb_build_object('rows', v_rows);
end $production_log_today_0167$;

comment on function app.production_log_today(uuid) is
  'staff_production (§2.16). The head chef, the chef and MGMT at the venue: {rows: [{movement_id, ingredient_id, name_en, name_ar, qty, unit, staff_name, at}]}, the business day''s production_in movements, newest first. No cost. FORBIDDEN for anyone else.';

revoke all on function app.production_log_today(uuid) from public, anon;
grant execute on function app.production_log_today(uuid) to authenticated;
