-- 0204 stock_store_reads — what the phone's store pages read: the pick list
-- for adding, moving and counting, the day's moves, additions and counts, and
-- the stock page by store.
--
-- Feature: protocols and the staff phone, wave 5, lane S
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8.5, §2.8.6, §2.11,
-- §5.3; Majed's answers #5 and #8).
-- Depends on: stock_transfers, stock_logs, stock_counts_by_location (S: the
-- moves, the staff logs, the phone counts), staff_roles_assistant_waiter
-- (R: the waiter the guards name).
-- Re-runnable: create or replace.
--
-- THE ROLE GROUPS (§2.0), each mirrored by its RPC's guard:
--   MOVE        waiter, manager, owner                          transfer_stock
--   LOG         head_barista, head_chef, cashier, court_desk,   log_stock
--               manager, owner
--   COUNT       head_chef, chef, manager, owner                 submit_stock_count
--   STOCK_VIEW  head_barista, head_chef, court_desk, waiter,    staff_stock_view
--               manager, owner
--
-- NO MONEY. Nothing here carries a cost, a price, a supplier, a note, a
-- theoretical quantity or a variance, and no key ends in _iqd (I12).
--
-- stock_pick_list(purpose, location): the venue's active ingredients a
-- purpose may name, by English name, at most 300, p_query matched on either
-- name (as staff_ingredient_options, 0162):
--   log    the caller's log kinds, shop stock only for the cafe; the store
--          defaults to the caller's home, and the desk is refused the bakery;
--   move   purchased and prepared stock held at the source store, each with
--          on_hand there (the source defaults to the cafe);
--   count  names and units only, no quantity: the bakery leaves shop stock
--          out, and the head chef and chef count the bakery only.
--
-- stock_today: the venue's business day (app.venue_business_date, the day
-- production_today uses), each section present only for its roles and null
-- otherwise: transfers (MOVE: the day's moves), logs (LOG: every delivery of
-- the day, staff logs and Goods in both, cut to the kinds the caller may log,
-- with no cost, supplier or note), driver_deliveries_waiting (LOG: purchases
-- the driver has delivered that are still to receive, so nobody logs them
-- twice) and counts (COUNT: the phone counts of the last 30 days at the
-- stores the caller counts, waiting or applied, counted quantities only).
--
-- staff_stock_view (0181:34) gains the waiter (purchased and prepared, so
-- Hasan sees what he moves) and a by_location {cafe, bakery} on each row,
-- which sums to on_hand.
--
-- covered by packages/db/tests/stock-store-reads.test.ts and
-- packages/db/tests/staff-stock-view.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.stock_pick_list — LOG, MOVE or COUNT at the venue, per purpose.
-- ---------------------------------------------------------------------------
create or replace function app.stock_pick_list(
  p_purpose  text,
  p_location text default null,
  p_venue_id uuid default null,
  p_query    text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $stock_pick_list_0204$
declare
  v_role  staff_role := app.staff_role();
  v_venue uuid;
  v_loc   stock_location;
  v_kinds text[];
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb;
begin
  if not app.is_staff('head_barista','head_chef','chef','cashier','court_desk','waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_purpose is null or p_purpose not in ('log', 'move', 'count') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'purpose';
  end if;
  if (p_purpose = 'log'   and not app.is_staff('head_barista','head_chef','cashier','court_desk','manager','owner'))
     or (p_purpose = 'move'  and not app.is_staff('waiter','manager','owner'))
     or (p_purpose = 'count' and not app.is_staff('head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'purpose';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','chef','cashier','court_desk','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_purpose = 'log' then
    v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
    if v_role = 'court_desk' and v_loc <> 'cafe' then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    v_kinds := case
                 when v_role in ('head_barista','head_chef') then array['purchased']
                 when v_role = 'court_desk'                  then array['retail']
                 else                                             array['purchased','retail']
               end;
  elsif p_purpose = 'move' then
    v_loc   := app.parse_stock_location(p_location, 'cafe');
    v_kinds := array['purchased','prepared'];
  else
    v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
    if v_role in ('head_chef','chef') and v_loc <> 'bakery' then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    v_kinds := array['purchased','prepared','retail'];
  end if;
  -- Shop stock lives in the cafe only (V14).
  if v_loc <> 'cafe' then
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
end $stock_pick_list_0204$;

comment on function app.stock_pick_list(text, text, uuid, text) is
  'stock_store_reads (wave 5 §2.8.5). What the phone''s store pages may name, per purpose, at the venue: log (LOG: the caller''s log kinds, shop stock only at the cafe; default the caller''s home store; the desk is refused the bakery), move (MOVE: purchased and prepared stock held at the source store p_location, default cafe, with on_hand there), count (COUNT: names and units only; the bakery leaves shop stock out; the head chef and chef count the bakery only). Returns {purpose, location, items: [{ingredient_id, name_en, name_ar, unit, kind, pack_size, on_hand?}]}, at most 300, by English name, p_query on either name. No cost. FORBIDDEN (also hints purpose, location); INVALID_ARGUMENT (purpose, location).';

revoke all on function app.stock_pick_list(text, text, uuid, text) from public, anon;
grant execute on function app.stock_pick_list(text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.stock_today — MOVE, LOG or COUNT at the venue: today's store work.
-- ---------------------------------------------------------------------------
create or replace function app.stock_today(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $stock_today_0204$
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
  if not app.is_staff('head_barista','head_chef','chef','cashier','court_desk','waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','chef','cashier','court_desk','waiter','manager','owner')) then
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

  if v_role in ('head_barista','head_chef','cashier','court_desk','manager','owner') then
    v_kinds := case
                 when v_role in ('head_barista','head_chef') then array['purchased']
                 when v_role = 'court_desk'                  then array['retail']
                 else                                             array['purchased','retail']
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

    select count(*) into v_waiting
      from purchases p
     where p.venue_id = v_venue and p.delivered_at is not null and p.status = 'to_receive';
  end if;

  if v_role in ('head_chef','chef','manager','owner') then
    v_stores := case when v_role in ('head_chef','chef') then array['bakery']::stock_location[]
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
end $stock_today_0204$;

comment on function app.stock_today(uuid) is
  'stock_store_reads (wave 5 §2.8.5). MOVE, LOG or COUNT at the venue, for the business day: {business_date, transfers (MOVE: [{transfer_id, from, to, moved_by_name, moved_at, lines: [{ingredient_id, name_en, name_ar, unit, qty}]}]), logs (LOG: every delivery of the day cut to the kinds the caller may log, [{delivery_id, location, source, received_by_name, received_at, lines: [{ingredient_id, name_en, name_ar, unit, qty, expiry_date}]}]), driver_deliveries_waiting (LOG: purchases delivered and still to receive), counts (COUNT: phone counts of the last 30 days at the stores the caller counts, [{count_id, location, status waiting|applied, counted_by_name, submitted_at, applied_at, lines: [{ingredient_id, name_en, name_ar, unit, counted_qty}]}])}; a section outside the caller''s roles is null. No cost, supplier, note, theoretical or variance. FORBIDDEN for anyone else.';

revoke all on function app.stock_today(uuid) from public, anon;
grant execute on function app.stock_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.staff_stock_view — 0181:34 + the waiter (purchased and prepared)
--    and by_location on each row.
-- ---------------------------------------------------------------------------
create or replace function app.staff_stock_view(
  p_venue_id uuid default null,
  p_kind     text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $staff_stock_view_0204$
declare
  v_venue uuid;
  v_role  staff_role := app.staff_role();
  v_kinds text[];
  v_items jsonb;
begin
  if not app.is_staff('head_barista','head_chef','court_desk','waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','court_desk','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_kinds := case
               when v_role in ('manager','owner')                   then array['purchased','prepared','retail']
               when v_role in ('head_barista','head_chef','waiter') then array['purchased','prepared']
               when v_role = 'court_desk'                           then array['retail']
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
           'by_location',         jsonb_build_object('cafe', x.on_hand_cafe, 'bakery', x.on_hand_bakery))
         order by x.low desc, lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.kind::text as kind, i.name_en, i.name_ar, i.unit::text as unit, i.pack_size,
                 oh.on_hand, i.par_level, i.low_stock_threshold,
                 (i.low_stock_threshold is not null and oh.on_hand <= i.low_stock_threshold) as low,
                 (i.par_level is not null and oh.on_hand < i.par_level) as below_par,
                 oh.next_expiry, oh.on_hand_cafe, oh.on_hand_bakery,
                 pr.product
            from ingredients i
            cross join lateral (
              select coalesce(sum(b.qty_remaining), 0) as on_hand,
                     min(b.expiry_date) as next_expiry,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'cafe'), 0) as on_hand_cafe,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'bakery'), 0) as on_hand_bakery
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
end $staff_stock_view_0204$;

comment on function app.staff_stock_view(uuid, text) is
  'staff_stock_view (§2.24.5, #68) + stock_store_reads (wave 5 §2.8.5). The head barista, the head chef and the waiter (purchased and prepared), the court desk (retail, with the shop product and size each row backs) and MGMT (all three) at the venue: {as_of, items: [{ingredient_id, kind, name_en, name_ar, unit, pack_size, on_hand, par_level, low_stock_threshold, low, below_par, next_expiry, product, by_location: {cafe, bakery}}]}, active ingredients, low first, then by name. on_hand is the sum of stock_batches.qty_remaining and by_location splits it by store; low is on_hand at or under the threshold; below_par is strictly under par. No cost, price, supplier or delivery. FORBIDDEN for anyone else and (hint kind) for a kind outside the caller''s; INVALID_ARGUMENT (hint kind) for an unknown kind.';

revoke all on function app.staff_stock_view(uuid, text) from public, anon;
grant execute on function app.staff_stock_view(uuid, text) to authenticated;
