-- 0250 — batch sizes for prepared items (owner, 2026-09-28): "the worker
-- selects a batch and the number is filled in from the recipe".
--
-- A prepared item's recipe is written per ONE base unit made (the operator's
-- "Amounts to make one {unit}"), and record_batch multiplies it by the amount
-- made. Nothing said how much one batch makes, so the phone could fill in
-- nothing. Now:
--
--   1. ingredients.batch_yield — how much one batch makes, in the item's own
--      unit (g, ml or pc). NULL: no batch size set; the phone asks for the
--      amount as before.
--   2. app.set_batch_yield — the manager or the owner sets or clears it, on a
--      prepared item of their branch. The operator's recipe dialog for a
--      prepared item carries the field.
--   3. app.production_today — also returns batch_yield. Re-issued from
--      20260925000167_staff_production.sql:190; only the field is added.
--
-- A batch size is an amount made, not a recipe amount: recipe_view still
-- shows no quantity to anyone (#72, P3).

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. ingredients.batch_yield
-- ---------------------------------------------------------------------------
alter table ingredients add column if not exists batch_yield numeric(12,3);

do $batch_yield_chk_0250$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ingredients_batch_yield_chk'
                    and conrelid = 'public.ingredients'::regclass) then
    alter table ingredients
      add constraint ingredients_batch_yield_chk
      check (batch_yield is null or (batch_yield > 0 and batch_yield < 1000000000)) not valid;
    alter table ingredients validate constraint ingredients_batch_yield_chk;
  end if;
end $batch_yield_chk_0250$;

comment on column ingredients.batch_yield is
  '0250. How much one batch of a prepared item makes, in the item''s own unit; NULL when no batch size is set. Set by app.set_batch_yield; read by app.production_today, which the staff phone uses to fill in the amount made.';

-- ---------------------------------------------------------------------------
-- 2. app.set_batch_yield
-- ---------------------------------------------------------------------------
create or replace function app.set_batch_yield(
  p_ingredient_id uuid,
  p_batch_yield   numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_batch_yield_0250$
declare
  v_row ingredients%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from ingredients where id = p_ingredient_id;
  if not found then
    raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.kind <> 'prepared' then
    raise exception 'NOT_PREPARED' using errcode = 'P0001';
  end if;
  if p_batch_yield is not null and not (p_batch_yield > 0 and p_batch_yield < 1000000000) then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;

  update ingredients set batch_yield = round(p_batch_yield, 3) where id = v_row.id;

  perform app.write_audit('stock.set_batch_yield', 'ingredients', v_row.id::text,
                          jsonb_build_object('batch_yield', v_row.batch_yield),
                          jsonb_build_object('batch_yield', round(p_batch_yield, 3)));

  return jsonb_build_object('ingredient_id', v_row.id, 'batch_yield', round(p_batch_yield, 3));
end $set_batch_yield_0250$;

comment on function app.set_batch_yield(uuid, numeric) is
  '0250. The manager or the owner at the item''s branch: sets how much one batch of a prepared item makes, in its own unit (above 0, below 1e9, 3 decimals), or clears it with NULL. Returns {ingredient_id, batch_yield}. FORBIDDEN, INGREDIENT_NOT_FOUND, VENUE_MISMATCH, NOT_PREPARED, INVALID_QTY. Audit stock.set_batch_yield.';

revoke all on function app.set_batch_yield(uuid, numeric) from public, anon;
grant execute on function app.set_batch_yield(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.production_today
-- ---------------------------------------------------------------------------
create or replace function app.production_today(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $production_today_0250$
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
           'shelf_life_days', x.shelf_life_days,
           'batch_yield',     x.batch_yield)
         order by x.below_par desc, lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.name_en, i.name_ar, i.unit::text as unit, i.par_level, i.shelf_life_days, i.batch_yield,
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
end $production_today_0250$;

comment on function app.production_today(uuid) is
  'staff_production (§2.16, 0250). The head chef, the chef and MGMT at the venue: {items: [{ingredient_id, name_en, name_ar, unit, on_hand, par_level, below_par, made_today, shelf_life_days, batch_yield}]}, every active prepared ingredient with an output recipe, below par first; made_today is the business day''s production_in; batch_yield is how much one batch makes (NULL when not set). No cost. FORBIDDEN for anyone else.';

revoke all on function app.production_today(uuid) from public, anon;
grant execute on function app.production_today(uuid) to authenticated;
