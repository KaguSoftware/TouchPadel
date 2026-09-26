set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0233 (multi-venue audit, 2026-09-26; decision A2): opening, closing and
-- copying a branch hold up under concurrency, and a close tidies up.
--
--   * open_branch, close_branch and open_day take one transaction lock
--     ('venue_status'). Two owners closing the last two open branches at once
--     each saw the other still open, and both committed: no branch open, and
--     every cron default had nowhere to file. A manager's open_day could also
--     commit just after close_branch's BRANCH_DAY_OPEN check.
--   * open_day refuses a closed branch with VENUE_CLOSED (it was FORBIDDEN, or
--     worse, allowed for the owner before 0228).
--   * close_branch refuses while the branch has bookings or holds still to come
--     or an active series (BRANCH_HAS_BOOKINGS, detail = how many), then ends
--     the branch's live guest sessions, retires its stations (their rota and
--     heartbeats go too) and ends its degraded period, before it closes. Its
--     audit row is written while the branch is still open, so it is filed there.
--   * create_branch: one copy at a time chain-wide, so SLUG_TAKEN is never a
--     raw unique violation; a category whose tax group is at another branch
--     takes the new branch's first tax group instead of failing the copy; the
--     deprecated venue_settings columns (llm_*, currency, the hold cap, 0207)
--     are no longer copied, so their later drop does not break it.
--   * branch_readiness counts a rate rule only while it is valid today and
--     names at least one day.
--   * register_staff and set_staff_venues refuse a closed branch (VENUE_CLOSED).

-- open_branch: re-issued from 20260926000223_open_a_new_branch.sql
create or replace function app.open_branch(p_venue uuid)
 RETURNS venues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $open_branch_0233$
declare
  v_old     venues%rowtype;
  v_row     venues%rowtype;
  v_missing text[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0233: one status change (or day open) at a time, chain-wide.
  perform pg_advisory_xact_lock(hashtextextended('venue_status', 0));
  select * into v_old from venues where id = p_venue for update;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.status = 'open' then
    return v_old;
  end if;

  select coalesce(array_agg(r->>'key' order by r->>'key'), '{}') into v_missing
    from jsonb_array_elements(app.branch_readiness(p_venue)) r
   where (r->>'required')::boolean and not (r->>'ok')::boolean;
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'BRANCH_NOT_READY' using errcode = 'P0001', detail = array_to_string(v_missing, ',');
  end if;

  update venues set status = 'open' where id = p_venue returning * into v_row;

  perform set_config('app.venue_id', p_venue::text, true);
  perform app.write_audit('venue.open', 'venues', p_venue::text,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_row.status));
  return v_row;
end $open_branch_0233$;

-- close_branch: re-issued from 20260926000223_open_a_new_branch.sql
create or replace function app.close_branch(p_venue uuid)
 RETURNS venues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $close_branch_0233$
declare
  v_old venues%rowtype;
  v_row venues%rowtype;
  v_n   int;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0233: one status change (or day open) at a time, chain-wide.
  perform pg_advisory_xact_lock(hashtextextended('venue_status', 0));
  select * into v_old from venues where id = p_venue for update;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.status = 'closed' then
    return v_old;
  end if;
  if v_old.status = 'open'
     and not exists (select 1 from venues v where v.status = 'open' and v.id <> p_venue) then
    raise exception 'LAST_OPEN_BRANCH' using errcode = 'P0001',
      hint = 'open another branch before closing this one';
  end if;
  if exists (select 1 from day_sessions d where d.venue_id = p_venue and d.status in ('open','closing')) then
    raise exception 'BRANCH_DAY_OPEN' using errcode = 'P0001',
      hint = 'close the branch''s day first';
  end if;

  -- 0233: guests with a court still to come are told by a person, not by a
  -- closed door. Cancel or move them first.
  select count(*) into v_n
    from reservations r
   where r.venue_id = p_venue
     and r.kind in ('booking', 'hold')
     and r.status in ('pending', 'confirmed')
     and r.end_at > now();
  v_n := v_n + (select count(*) from reservation_series s
                 where s.venue_id = p_venue and s.cancelled_at is null
                   and (s.ends_on is null or s.ends_on >= current_date));
  if v_n > 0 then
    raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = v_n::text,
      hint = 'cancel or move the branch''s bookings, holds and series first';
  end if;

  -- 0233: tidy up while the branch is still open, so every row below (and the
  -- audit row) is filed there.
  perform set_config('app.venue_id', p_venue::text, true);
  update guest_sessions set closed_at = now()
   where venue_id = p_venue and closed_at is null;
  delete from station_staff where venue_id = p_venue;
  delete from device_heartbeats where venue_id = p_venue;
  update stations set retired_at = now()
   where venue_id = p_venue and retired_at is null;
  update degraded_periods set ended_at = now()
   where venue_id = p_venue and ended_at is null;
  perform app.write_audit('venue.close', 'venues', p_venue::text,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', 'closed'));

  update venues set status = 'closed' where id = p_venue returning * into v_row;
  return v_row;
end $close_branch_0233$;

-- open_day: re-issued from 20260926000216_day_per_venue.sql
create or replace function app.open_day(p_opening_float_iqd bigint, p_business_date date DEFAULT NULL::date, p_device_id text DEFAULT NULL::text, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $open_day_0233$
declare
  v_date  date;
  v_row   day_sessions%rowtype;
  v_venue uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0233: one status change (or day open) at a time, chain-wide.
  perform pg_advisory_xact_lock(hashtextextended('venue_status', 0));
  if p_venue_id is not null
     and exists (select 1 from venues v where v.id = p_venue_id and v.status = 'closed') then
    raise exception 'VENUE_CLOSED' using errcode = 'P0001';
  end if;
  -- 0216: one branch: the argument, else the station on the request or the
  -- caller's only membership.
  v_venue := coalesce(p_venue_id, app.current_venue(p_device_id));
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_opening_float_iqd is null or p_opening_float_iqd < 0 then
    raise exception 'INVALID_FLOAT' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_date := coalesce(p_business_date,
                     (now() at time zone coalesce((select vs.timezone from venue_settings vs where vs.venue_id = v_venue), 'Asia/Baghdad'))::date);

  select * into v_row from day_sessions where venue_id = v_venue and business_date = v_date;
  if found then
    return jsonb_build_object('duplicate', true, 'day_session_id', v_row.id,
                              'status', v_row.status);
  end if;

  if exists (select 1 from day_sessions where venue_id = v_venue and status in ('open','closing')) then
    raise exception 'PREVIOUS_DAY_OPEN' using errcode = 'P0001',
      hint = 'close the previous day before opening a new one';
  end if;

  insert into day_sessions (venue_id, business_date, opened_by, opening_float_iqd)
  values (v_venue, v_date, auth.uid(), p_opening_float_iqd)
  returning * into v_row;

  perform app.write_audit('day.open', 'day_sessions', v_row.id::text,
                          null, to_jsonb(v_row), null, null, p_device_id);

  return jsonb_build_object('duplicate', false, 'day_session_id', v_row.id,
                            'business_date', v_row.business_date);
end $open_day_0233$;

-- create_branch: re-issued from 20260926000223_open_a_new_branch.sql
create or replace function app.create_branch(p_source_venue uuid, p_slug text, p_name_en text, p_name_ar text, p_phone text DEFAULT NULL::text, p_timezone text DEFAULT NULL::text, p_address_en text DEFAULT NULL::text, p_address_ar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $create_branch_0233$
declare
  v_src     venues%rowtype;
  v_new     uuid := gen_random_uuid();
  v_slug    text := lower(btrim(coalesce(p_slug, '')));
  v_name_en text := btrim(coalesce(p_name_en, ''));
  v_name_ar text := btrim(coalesce(p_name_ar, ''));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_tz      text;
  v_counts  jsonb := '{}'::jsonb;
  v_n       int;
  v_feat    jsonb;
  v_excl    jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0233: one copy at a time chain-wide, taken before the slug check, so two
  -- owners asking for one slug get SLUG_TAKEN rather than a unique violation.
  perform pg_advisory_xact_lock(hashtextextended('create_branch', 0));

  select * into v_src from venues where id = p_source_venue;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,31}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_slug',
      hint = '2-32 lowercase letters, digits and dashes';
  end if;
  if exists (select 1 from venues where slug = v_slug) then
    raise exception 'SLUG_TAKEN' using errcode = 'P0001';
  end if;
  if char_length(v_name_en) not between 2 and 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_name_en';
  end if;
  if char_length(v_name_ar) not between 2 and 80 then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', detail = 'p_name_ar';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,20}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_phone';
  end if;
  v_tz := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), v_src.timezone);
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_timezone';
  end if;

  -- Every write below that relies on a column default files at the new branch.
  perform set_config('app.venue_id', v_new::text, true);

  create temporary table if not exists _branch_map (
    kind   text not null,
    old_id uuid not null,
    new_id uuid not null,
    primary key (kind, old_id)
  ) on commit drop;   -- one per call: every RPC is its own transaction

  -- The branch itself.
  insert into venues (id, slug, name_en, name_ar, timezone, phone, status, address_en, address_ar, map_url)
  values (v_new, v_slug, v_name_en, v_name_ar, v_tz, v_phone, 'preparing',
          nullif(btrim(coalesce(p_address_en, '')), ''), nullif(btrim(coalesce(p_address_ar, '')), ''), null);

  -- Settings: the source's rules and hours, the new branch's identity.
  -- 0233: the chain's own settings (currency, the hold cap, the LLM keys) live
  -- in platform_settings since 0207; their deprecated columns keep defaults.
  insert into venue_settings (id, venue_id, venue_name, timezone, opening_hours, closed_dates,
                              hold_ttl_seconds, protected_horizon_hours, heartbeat_stale_seconds,
                              table_token_ttl_minutes, waiter_call_cooldown_seconds,
                              cancellation_window_hours, cash_rounding_iqd, expiring_soon_days,
                              tax_inclusive, phone, max_booking_horizon_days,
                              guest_orders_per_minute, guest_items_per_order, tab_confirm_threshold_iqd)
  select true, v_new, v_name_en, v_tz, vs.opening_hours, vs.closed_dates,
         vs.hold_ttl_seconds, vs.protected_horizon_hours, vs.heartbeat_stale_seconds,
         vs.table_token_ttl_minutes, vs.waiter_call_cooldown_seconds,
         vs.cancellation_window_hours, vs.cash_rounding_iqd, vs.expiring_soon_days,
         vs.tax_inclusive, v_phone, vs.max_booking_horizon_days,
         vs.guest_orders_per_minute, vs.guest_items_per_order, vs.tab_confirm_threshold_iqd
    from venue_settings vs
   where vs.venue_id = p_source_venue;

  -- Tax groups and suppliers.
  insert into _branch_map select 'tax_group', id, gen_random_uuid() from tax_groups where venue_id = p_source_venue;
  insert into tax_groups (id, venue_id, name_en, name_ar, rate_bp, is_active)
  select m.new_id, v_new, t.name_en, t.name_ar, t.rate_bp, t.is_active
    from tax_groups t join _branch_map m on m.kind = 'tax_group' and m.old_id = t.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tax_groups', v_n);

  insert into _branch_map select 'supplier', id, gen_random_uuid() from suppliers where venue_id = p_source_venue;
  insert into suppliers (id, venue_id, name, phone, notes, is_active)
  select m.new_id, v_new, s.name, s.phone, s.notes, s.is_active
    from suppliers s join _branch_map m on m.kind = 'supplier' and m.old_id = s.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', v_n);

  -- Courts and their rates.
  -- Active courts only: a retired court (active_to set) stays history at the source.
  insert into _branch_map select 'court', id, gen_random_uuid() from courts where venue_id = p_source_venue and is_active;
  insert into courts (id, venue_id, name_en, name_ar, description_en, description_ar, indoor, photo_path,
                      duration_options, sort_order, is_active, active_from, active_to)
  select m.new_id, v_new, c.name_en, c.name_ar, c.description_en, c.description_ar, c.indoor, c.photo_path,
         c.duration_options, c.sort_order, c.is_active, null, null
    from courts c join _branch_map m on m.kind = 'court' and m.old_id = c.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('courts', v_n);

  insert into _branch_map select 'rate_rule', id, gen_random_uuid() from rate_rules where venue_id = p_source_venue;
  insert into rate_rules (id, venue_id, name, court_id, days_of_week, start_time, end_time, priority,
                          valid_from, valid_to, is_active)
  select m.new_id, v_new, r.name, mc.new_id, r.days_of_week, r.start_time, r.end_time, r.priority,
         r.valid_from, r.valid_to, r.is_active
    from rate_rules r
    join _branch_map m on m.kind = 'rate_rule' and m.old_id = r.id
    left join _branch_map mc on mc.kind = 'court' and mc.old_id = r.court_id
   where r.court_id is null or mc.new_id is not null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('rate_rules', v_n);

  insert into rate_rule_prices (rule_id, duration_min, price_iqd)
  select m.new_id, p.duration_min, p.price_iqd
    from rate_rule_prices p join _branch_map m on m.kind = 'rate_rule' and m.old_id = p.rule_id
   where exists (select 1 from rate_rules r where r.id = m.new_id);

  -- Tables (new ids: new QR codes are printed for the new branch).
  insert into cafe_tables (id, venue_id, table_number, zone, capacity, token_version, is_active, bell_enabled)
  select gen_random_uuid(), v_new, t.table_number, t.zone, t.capacity, 1, t.is_active, t.bell_enabled
    from cafe_tables t where t.venue_id = p_source_venue and t.is_active;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cafe_tables', v_n);

  -- Menu.
  insert into _branch_map select 'category', id, gen_random_uuid() from menu_categories where venue_id = p_source_venue;
  insert into menu_categories (id, venue_id, name_en, name_ar, tax_group_id, sort_order, is_active, photo_path,
                               photo_blur, serve_temp, kind)
  select m.new_id, v_new, c.name_en, c.name_ar,
         -- 0233: a tax group at another branch (no FK keeps it here) falls
         -- back to the new branch's first one instead of failing the copy.
         coalesce(mt.new_id, (select m2.new_id from _branch_map m2 join tax_groups t2 on t2.id = m2.old_id
                               where m2.kind = 'tax_group' order by t2.is_active desc, t2.name_en limit 1)),
         c.sort_order, c.is_active, c.photo_path,
         c.photo_blur, c.serve_temp, c.kind
    from menu_categories c
    join _branch_map m on m.kind = 'category' and m.old_id = c.id
    left join _branch_map mt on mt.kind = 'tax_group' and mt.old_id = c.tax_group_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('menu_categories', v_n);

  insert into _branch_map
  select 'item', i.id, gen_random_uuid() from menu_items i where i.venue_id = p_source_venue;
  insert into menu_items (id, venue_id, category_id, name_en, name_ar, description_en, description_ar, photo_path,
                          is_active, unavailable_on, sort_order, hook_en, hook_ar, highlight, sold_out,
                          photo_blur, serve_temp, release_run_id, launched_at)
  select m.new_id, v_new, mc.new_id, i.name_en, i.name_ar, i.description_en, i.description_ar, i.photo_path,
         i.is_active, null, i.sort_order, i.hook_en, i.hook_ar, i.highlight, false,
         i.photo_blur, i.serve_temp, null,
         coalesce(i.launched_at, case when i.is_active then now() end)
    from menu_items i
    join _branch_map m  on m.kind = 'item' and m.old_id = i.id
    join _branch_map mc on mc.kind = 'category' and mc.old_id = i.category_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('menu_items', v_n);

  insert into _branch_map
  select 'variant', v.id, gen_random_uuid()
    from menu_item_variants v join _branch_map mi on mi.kind = 'item' and mi.old_id = v.item_id;
  insert into menu_item_variants (id, item_id, name_en, name_ar, price_iqd, is_default, sort_order, sku, barcode)
  select m.new_id, mi.new_id, v.name_en, v.name_ar, v.price_iqd, v.is_default, v.sort_order, v.sku, v.barcode
    from menu_item_variants v
    join _branch_map m  on m.kind = 'variant' and m.old_id = v.id
    join _branch_map mi on mi.kind = 'item' and mi.old_id = v.item_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('menu_item_variants', v_n);

  insert into menu_item_costs (item_id, cost_iqd, updated_at, updated_by)
  select mi.new_id, c.cost_iqd, now(), auth.uid()
    from menu_item_costs c join _branch_map mi on mi.kind = 'item' and mi.old_id = c.item_id;

  insert into menu_item_allergens (item_id, allergen_id)
  select mi.new_id, a.allergen_id
    from menu_item_allergens a join _branch_map mi on mi.kind = 'item' and mi.old_id = a.item_id;

  insert into addon_suggestions (item_id, suggested_item_id, sort_order)
  select ma.new_id, mb.new_id, s.sort_order
    from addon_suggestions s
    join _branch_map ma on ma.kind = 'item' and ma.old_id = s.item_id
    join _branch_map mb on mb.kind = 'item' and mb.old_id = s.suggested_item_id;

  -- Add-ons.
  insert into _branch_map select 'group', id, gen_random_uuid() from modifier_groups where venue_id = p_source_venue;
  insert into modifier_groups (id, venue_id, name_en, name_ar, min_select, max_select)
  select m.new_id, v_new, g.name_en, g.name_ar, g.min_select, g.max_select
    from modifier_groups g join _branch_map m on m.kind = 'group' and m.old_id = g.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('modifier_groups', v_n);

  insert into _branch_map
  select 'modifier', md.id, gen_random_uuid()
    from modifiers md join _branch_map mg on mg.kind = 'group' and mg.old_id = md.group_id;
  insert into modifiers (id, group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active, launched_at)
  select m.new_id, mg.new_id, md.name_en, md.name_ar, md.price_delta_iqd, md.sort_order, md.is_active,
         coalesce(md.launched_at, case when md.is_active then now() end)
    from modifiers md
    join _branch_map m  on m.kind = 'modifier' and m.old_id = md.id
    join _branch_map mg on mg.kind = 'group' and mg.old_id = md.group_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('modifiers', v_n);

  insert into menu_item_modifier_groups (item_id, group_id, sort_order)
  select mi.new_id, mg.new_id, l.sort_order
    from menu_item_modifier_groups l
    join _branch_map mi on mi.kind = 'item' and mi.old_id = l.item_id
    join _branch_map mg on mg.kind = 'group' and mg.old_id = l.group_id;

  insert into modifier_reveals (modifier_id, group_id, sort_order)
  select mm.new_id, mg.new_id, r.sort_order
    from modifier_reveals r
    join _branch_map mm on mm.kind = 'modifier' and mm.old_id = r.modifier_id
    join _branch_map mg on mg.kind = 'group' and mg.old_id = r.group_id;

  -- Stock definitions (never stock: the new branch starts at zero).
  insert into _branch_map select 'ingredient', id, gen_random_uuid() from ingredients where venue_id = p_source_venue;
  insert into ingredients (id, venue_id, kind, name_en, name_ar, unit, pack_size, pack_cost_iqd, supplier_name,
                           shelf_life_days, yield_percent, waste_allowance_percent, par_level,
                           low_stock_threshold, is_active, variant_id, supplier_id)
  select m.new_id, v_new, i.kind, i.name_en, i.name_ar, i.unit, i.pack_size, i.pack_cost_iqd, i.supplier_name,
         i.shelf_life_days, i.yield_percent, i.waste_allowance_percent, i.par_level,
         i.low_stock_threshold, i.is_active, mv.new_id, ms.new_id
    from ingredients i
    join _branch_map m on m.kind = 'ingredient' and m.old_id = i.id
    left join _branch_map mv on mv.kind = 'variant' and mv.old_id = i.variant_id
    left join _branch_map ms on ms.kind = 'supplier' and ms.old_id = i.supplier_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ingredients', v_n);

  insert into recipe_lines (id, variant_id, modifier_id, output_ingredient_id, ingredient_id, qty)
  select gen_random_uuid(), mv.new_id, mm.new_id, mo.new_id, mi.new_id, r.qty
    from recipe_lines r
    join _branch_map mi on mi.kind = 'ingredient' and mi.old_id = r.ingredient_id
    left join _branch_map mv on mv.kind = 'variant'    and mv.old_id = r.variant_id
    left join _branch_map mm on mm.kind = 'modifier'   and mm.old_id = r.modifier_id
    left join _branch_map mo on mo.kind = 'ingredient' and mo.old_id = r.output_ingredient_id
   where (r.variant_id is null or mv.new_id is not null)
     and (r.modifier_id is null or mm.new_id is not null)
     and (r.output_ingredient_id is null or mo.new_id is not null);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('recipe_lines', v_n);

  -- Protocol templates (the source's edited ones), then the defaults for any
  -- kind the source never had.
  insert into _branch_map select 'ptemplate', id, gen_random_uuid() from protocol_templates where venue_id = p_source_venue;
  insert into protocol_templates (id, venue_id, kind, variant, name_en, name_ar, version, updated_by, updated_at)
  select m.new_id, v_new, t.kind, t.variant, t.name_en, t.name_ar, 1, auth.uid(), now()
    from protocol_templates t join _branch_map m on m.kind = 'ptemplate' and m.old_id = t.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('protocol_templates', v_n);

  insert into _branch_map
  select 'pstep', s.id, gen_random_uuid()
    from protocol_template_steps s join _branch_map mt on mt.kind = 'ptemplate' and mt.old_id = s.template_id;
  insert into protocol_template_steps (id, template_id, position, step_key, name_en, name_ar, actor_roles,
                                       needs_owner_ok, optional)
  select m.new_id, mt.new_id, s.position, s.step_key, s.name_en, s.name_ar, s.actor_roles,
         s.needs_owner_ok, s.optional
    from protocol_template_steps s
    join _branch_map m  on m.kind = 'pstep' and m.old_id = s.id
    join _branch_map mt on mt.kind = 'ptemplate' and mt.old_id = s.template_id;

  insert into protocol_template_items (id, step_id, position, text_en, text_ar)
  select gen_random_uuid(), ms.new_id, i.position, i.text_en, i.text_ar
    from protocol_template_items i join _branch_map ms on ms.kind = 'pstep' and ms.old_id = i.step_id;

  perform app.protocol_seed_venue(v_new);

  -- Checklist templates.
  insert into _branch_map select 'ctemplate', id, gen_random_uuid() from checklist_templates where venue_id = p_source_venue;
  insert into checklist_templates (id, venue_id, role, slot, name_en, name_ar, version, updated_by, updated_at)
  select m.new_id, v_new, t.role, t.slot, t.name_en, t.name_ar, 1, auth.uid(), now()
    from checklist_templates t join _branch_map m on m.kind = 'ctemplate' and m.old_id = t.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('checklist_templates', v_n);

  insert into checklist_template_items (id, template_id, position, text_en, text_ar, photo_required)
  select gen_random_uuid(), mt.new_id, i.position, i.text_en, i.text_ar, i.photo_required
    from checklist_template_items i join _branch_map mt on mt.kind = 'ctemplate' and mt.old_id = i.template_id;

  -- Cafe settings: the source's values, minus its Telegram group (MV3), with
  -- the featured item and the excluded items pointed at the copies.
  insert into cafe_settings (venue_id, key, value, is_public, updated_at, updated_by)
  select v_new, cs.key, cs.value, cs.is_public, now(), auth.uid()
    from cafe_settings cs
   where cs.venue_id = p_source_venue
     and cs.key not like 'telegram\_%';

  select value into v_feat from cafe_settings where venue_id = v_new and key = 'featured_item_id';
  if v_feat is not null and jsonb_typeof(v_feat) = 'string' then
    update cafe_settings
       set value = coalesce((select to_jsonb(m.new_id::text) from _branch_map m
                              where m.kind = 'item' and m.old_id::text = (v_feat #>> '{}')), 'null'::jsonb)
     where venue_id = v_new and key = 'featured_item_id';
  end if;

  select value into v_excl from cafe_settings where venue_id = v_new and key = 'analytics_excluded_item_ids';
  if v_excl is not null and jsonb_typeof(v_excl) = 'array' then
    update cafe_settings
       set value = coalesce((select jsonb_agg(to_jsonb(m.new_id::text))
                               from jsonb_array_elements_text(v_excl) e
                               join _branch_map m on m.kind = 'item' and m.old_id::text = e), '[]'::jsonb)
     where venue_id = v_new and key = 'analytics_excluded_item_ids';
  end if;

  perform app.write_audit('venue.create', 'venues', v_new::text, null,
    jsonb_build_object('source_venue', p_source_venue, 'slug', v_slug, 'name_en', v_name_en,
                       'name_ar', v_name_ar, 'counts', v_counts));

  return jsonb_build_object('venue_id', v_new, 'slug', v_slug, 'status', 'preparing', 'counts', v_counts);
end $create_branch_0233$;

-- branch_readiness: re-issued from 20260926000223_open_a_new_branch.sql
create or replace function app.branch_readiness(p_venue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $branch_readiness_0233$
declare
  v_hours jsonb;
begin
  if not app.is_staff_at(p_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select opening_hours into v_hours from venue_settings where venue_id = p_venue;

  return jsonb_build_array(
    jsonb_build_object('key', 'courts_and_rates', 'required', true,
      'ok', exists (select 1 from courts c
                     where c.venue_id = p_venue and c.is_active
                       and exists (select 1 from rate_rules r
                                    where r.venue_id = p_venue and r.is_active
                                      and (r.valid_to is null or r.valid_to >= current_date)
                                      and cardinality(r.days_of_week) > 0
                                      and (r.court_id is null or r.court_id = c.id)
                                      and exists (select 1 from rate_rule_prices p where p.rule_id = r.id)))),
    jsonb_build_object('key', 'opening_hours', 'required', true,
      'ok', v_hours is not null and exists (
              select 1 from jsonb_each(v_hours) d
               where jsonb_typeof(d.value) = 'array' and jsonb_array_length(d.value) > 0)),
    jsonb_build_object('key', 'manager', 'required', true,
      'ok', exists (select 1 from staff_venues sv join staff s on s.id = sv.staff_id and s.is_active
                     where sv.venue_id = p_venue and s.role = 'manager')),
    jsonb_build_object('key', 'till', 'required', true,
      'ok', exists (select 1 from stations st
                     where st.venue_id = p_venue and st.retired_at is null
                       and (st.mode = 'till' or st.is_till))),
    jsonb_build_object('key', 'menu', 'required', false,
      'ok', exists (select 1 from menu_items i where i.venue_id = p_venue and i.is_active)),
    jsonb_build_object('key', 'telegram', 'required', false,
      'ok', coalesce(app.cafe_setting_bool('telegram_enabled', p_venue), false)
            and nullif(app.cafe_setting_text('telegram_chat_id', p_venue), '') is not null),
    jsonb_build_object('key', 'opening_stock', 'required', false,
      'ok', exists (select 1 from stock_batches b where b.venue_id = p_venue and b.qty_remaining > 0)));
end $branch_readiness_0233$;

-- register_staff: re-issued from 20260926000218_staff_membership_fix.sql
create or replace function app.register_staff(p_staff_id uuid, p_display_name text, p_role staff_role, p_actor_id uuid, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $register_staff_0233$
declare
  v_name text := btrim(coalesce(p_display_name, ''));
  v_row  staff%rowtype;
begin
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001',
      hint = 'display name must be 1-80 characters';
  end if;
  if exists (select 1 from staff where id = p_staff_id) then
    raise exception 'STAFF_EXISTS' using errcode = 'P0001';
  end if;
  -- 0218: the branch the new account works at (the trigger files the
  -- membership there). An owner holds none, so the branch is ignored for one.
  if p_venue_id is not null then
    if not exists (select 1 from venues v where v.id = p_venue_id) then
      raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
    end if;
    if exists (select 1 from venues v where v.id = p_venue_id and v.status = 'closed') then
      raise exception 'VENUE_CLOSED' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', p_venue_id::text, true);
  end if;

  insert into staff (id, display_name, role, is_active, created_by)
  values (p_staff_id, v_name, p_role, true, p_actor_id)
  returning * into v_row;

  -- The service role has no JWT, so auth.uid() is null here; name the owner
  -- explicitly rather than record an unattributable account creation.
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, 'owner', 'staff.create', 'staff', p_staff_id::text, null,
          jsonb_build_object('display_name', v_row.display_name, 'role', v_row.role,
                             'venue_id', p_venue_id));

  return jsonb_build_object('id', v_row.id, 'display_name', v_row.display_name,
                            'role', v_row.role, 'is_active', v_row.is_active);
end $register_staff_0233$;

-- set_staff_venues: re-issued from 20260926000218_staff_membership_fix.sql
create or replace function app.set_staff_venues(p_staff_id uuid, p_venue_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $set_staff_venues_0233$
declare
  v_staff  staff%rowtype;
  v_ids    uuid[];
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_staff from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_staff.role = 'owner' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_staff_id', hint = 'an owner works at every branch and holds no memberships';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_venue_ids, '{}')) x where x is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'STAFF_VENUE_REQUIRED' using errcode = 'P0001',
      hint = 'a staff member works at one branch at least';
  end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from venues v where v.id = x)) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0233: a membership at a closed branch works nowhere.
  if exists (select 1 from venues v where v.id = any (v_ids) and v.status = 'closed') then
    raise exception 'VENUE_CLOSED' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(venue_id order by venue_id), '[]'::jsonb) into v_before
    from staff_venues where staff_id = p_staff_id;

  delete from staff_venues where staff_id = p_staff_id and not (venue_id = any (v_ids));
  insert into staff_venues (staff_id, venue_id, role)
  select p_staff_id, x, v_staff.role from unnest(v_ids) x
  on conflict (staff_id, venue_id) do update set role = excluded.role;

  select coalesce(jsonb_agg(venue_id order by venue_id), '[]'::jsonb) into v_after
    from staff_venues where staff_id = p_staff_id;

  perform set_config('app.venue_id', v_ids[1]::text, true);
  perform app.write_audit('staff.venues', 'staff', p_staff_id::text,
    jsonb_build_object('venue_ids', v_before), jsonb_build_object('venue_ids', v_after));

  return jsonb_build_object('staff_id', p_staff_id, 'venue_ids', v_after);
end $set_staff_venues_0233$;
