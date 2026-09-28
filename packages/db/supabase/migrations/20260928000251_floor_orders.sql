-- 0251 — placing an order from the staff phone (owner, 2026-09-28): "scan an
-- order should be 'place an order': the worker picks a table, then adds to a
-- tab or opens one". This reverses wave5-addendum Q3 ("no till on the waiter's
-- phone") and the order-slip rule that only a cashier's send reaches the
-- kitchen; the owner decided it.
--
-- The phone still calls no till RPC (apps/mobile noStationRpc.test.ts): it gets
-- three of its own, for the floor (waiter, cashier, manager, owner):
--
--   1. app.floor_tables(p_venue_id) — the branch's active tables, each with its
--      open café tabs of today: label, when it opened, whether the caller
--      opened it, and what is on it (item names and counts). NO MONEY: the
--      waiter reads no tab total (owner, 2026-09-28: "item prices only").
--   2. app.floor_menu(p_venue_id) — the café menu as the phone orders from it:
--      active categories and items, each item's sizes with their list price,
--      its option groups with min/max, their options with their price change
--      and the groups each option reveals (depth 1, as app.item_active_groups),
--      and whether the item can be ordered right now (sold out, off today, or
--      an ingredient out: app.menu_availability).
--   3. app.place_floor_order(p_table_id, p_tab_id, p_label, p_items, key) —
--      adds the items to one of the table's open tabs (p_tab_id), or opens a
--      new tab on the table (p_tab_id NULL, with an optional name) and adds
--      them. The order goes to the kitchen at once, as the till's does: the
--      order row, app.add_order_items (server prices, option checks) and the
--      ticket, whose triggers take the stock and reach the kitchen board. A new
--      tab may be opened with no items. Idempotent by key (claim_replay).
--
-- The till's bodies are not re-issued: open_tab and till_add_items keep their
-- role lists. The inserts here follow create_guest_order (0217:1879) and
-- till_add_items (0244:201): same lock order (the day, then the tab), same
-- branch assertion (app.venue_id), same order + ticket pair.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.floor_tables
-- ---------------------------------------------------------------------------
create or replace function app.floor_tables(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $floor_tables_0251$
declare
  v_venue uuid;
  v_day   uuid;
begin
  if not app.is_staff('waiter','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'waiter','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_day := app.current_open_day(v_venue);

  return jsonb_build_object(
    'day_open', v_day is not null,
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',           t.id,
               'table_number', t.table_number,
               'zone',         t.zone,
               'tabs', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id',        tb.id,
                          'label',     tb.label,
                          'opened_at', tb.opened_at,
                          'mine',      tb.opened_by_staff_id is not distinct from auth.uid(),
                          'lines', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'name_en', mi.name_en,
                                     'name_ar', mi.name_ar,
                                     'size_en', case when sz.n > 1 then v.name_en end,
                                     'size_ar', case when sz.n > 1 then v.name_ar end,
                                     'qty',     x.qty)
                                   order by x.first_at, mi.name_en, v.id)
                              from (select oi.variant_id,
                                           sum(oi.qty) as qty,
                                           min(o.placed_at) as first_at
                                      from orders o
                                      join order_items oi on oi.order_id = o.id
                                     where o.tab_id = tb.id and not oi.voided
                                     group by oi.variant_id) x
                              join menu_item_variants v on v.id = x.variant_id
                              cross join lateral (select count(*) as n from menu_item_variants v2
                                                   where v2.item_id = v.item_id) sz
                              join menu_items mi on mi.id = v.item_id), '[]'::jsonb))
                        order by tb.opened_at, tb.id)
                   from tabs tb
                  where tb.table_id = t.id
                    and tb.day_session_id = v_day
                    and tb.status = 'open'
                    and tb.merged_into_tab_id is null
                    and tb.kind = 'cafe'), '[]'::jsonb))
             order by nullif(regexp_replace(t.table_number, '\D', '', 'g'), '')::numeric nulls last,
                      t.table_number, t.id)
        from cafe_tables t
       where t.venue_id = v_venue
         and t.is_active), '[]'::jsonb));
end $floor_tables_0251$;

comment on function app.floor_tables(uuid) is
  '0251 (place an order from the staff phone). The waiter, the cashier and MGMT at the venue: {day_open, tables: [{id, table_number, zone, tabs: [{id, label, opened_at, mine, lines: [{name_en, name_ar, size_en?, size_ar?, qty}]}]}]}, the active tables in number order with their open café tabs of the open day (none while no day is open), and what is on each (voided lines left out; a size named only when the item has more than one). No money. FORBIDDEN for anyone else.';

revoke all on function app.floor_tables(uuid) from public, anon;
grant execute on function app.floor_tables(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.floor_menu
-- ---------------------------------------------------------------------------
create or replace function app.floor_menu(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $floor_menu_0251$
declare
  v_venue uuid;
  v_today date;
  v_out   uuid[];
begin
  if not app.is_staff('waiter','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'waiter','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_today := app.venue_business_date(v_venue, now());
  -- Once per read: an item one of whose ingredients is out.
  v_out := array(select a.item_id from app.menu_availability() a where not a.orderable);

  return jsonb_build_object('categories', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',      c.id,
             'name_en', c.name_en,
             'name_ar', c.name_ar,
             'items',   c.items)
           order by c.sort_order, c.name_en, c.id)
      from (
        select c.id, c.name_en, c.name_ar, c.sort_order,
               (select jsonb_agg(jsonb_build_object(
                         'id',        mi.id,
                         'name_en',   mi.name_en,
                         'name_ar',   mi.name_ar,
                         'orderable', not mi.sold_out
                                      and mi.unavailable_on is distinct from v_today
                                      and not (mi.id = any (v_out)),
                         'variants', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                    'id',         v.id,
                                    'name_en',    v.name_en,
                                    'name_ar',    v.name_ar,
                                    'price_iqd',  v.price_iqd,
                                    'is_default', v.is_default)
                                  order by v.sort_order, v.id)
                             from menu_item_variants v
                            where v.item_id = mi.id), '[]'::jsonb),
                         'groups', coalesce((
                           select jsonb_agg(app.floor_menu_group(g.id, false) order by l.sort_order, g.id)
                             from menu_item_modifier_groups l
                             join modifier_groups g on g.id = l.group_id
                            where l.item_id = mi.id), '[]'::jsonb))
                       order by mi.sort_order, mi.name_en, mi.id)
                  from menu_items mi
                 where mi.category_id = c.id
                   and mi.venue_id = v_venue
                   and mi.is_active) as items
          from menu_categories c
         where c.venue_id = v_venue
           and c.is_active
           and c.kind = 'cafe') c
     where c.items is not null), '[]'::jsonb));
end $floor_menu_0251$;

-- One option group as the phone draws it. p_revealed: a group some option
-- reveals, whose own options reveal nothing further (depth 1, as
-- app.item_active_groups and add_order_items check it). Defined after its
-- caller: plpgsql resolves it when the menu is read.
create or replace function app.floor_menu_group(p_group_id uuid, p_revealed boolean)
returns jsonb
language plpgsql stable security definer set search_path = public as $floor_menu_group_0251$
begin
  return (
    select jsonb_build_object(
             'id',         g.id,
             'name_en',    g.name_en,
             'name_ar',    g.name_ar,
             'min_select', g.min_select,
             'max_select', g.max_select,
             'modifiers', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id',              m.id,
                        'name_en',         m.name_en,
                        'name_ar',         m.name_ar,
                        'price_delta_iqd', m.price_delta_iqd,
                        'reveals', case when p_revealed then '[]'::jsonb else coalesce((
                          select jsonb_agg(app.floor_menu_group(r.group_id, true) order by r.sort_order, r.group_id)
                            from modifier_reveals r
                           where r.modifier_id = m.id
                             and r.group_id <> g.id), '[]'::jsonb) end)
                      order by m.sort_order, m.name_en, m.id)
                 from modifiers m
                where m.group_id = g.id and m.is_active), '[]'::jsonb))
      from modifier_groups g
     where g.id = p_group_id);
end $floor_menu_group_0251$;

comment on function app.floor_menu(uuid) is
  '0251 (place an order from the staff phone). The waiter, the cashier and MGMT at the venue: {categories: [{id, name_en, name_ar, items: [{id, name_en, name_ar, orderable, variants: [{id, name_en, name_ar, price_iqd, is_default}], groups: [group]}]}]}, the active café categories with their active items; a group is {id, name_en, name_ar, min_select, max_select, modifiers: [{id, name_en, name_ar, price_delta_iqd, reveals: [group]}]} (depth 1). orderable is false when the item is sold out, off for the business day, or an ingredient is out. List prices; the server prices every order itself. FORBIDDEN for anyone else.';
comment on function app.floor_menu_group(uuid, boolean) is
  '0251. Internal to app.floor_menu: one option group with its active options, each with the groups it reveals (none when p_revealed).';

revoke all on function app.floor_menu(uuid) from public, anon;
grant execute on function app.floor_menu(uuid) to authenticated;
revoke all on function app.floor_menu_group(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.place_floor_order
-- ---------------------------------------------------------------------------
create or replace function app.place_floor_order(
  p_table_id        uuid,
  p_tab_id          uuid   default null,
  p_label           text   default null,
  p_items           jsonb  default '[]'::jsonb,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $place_floor_order_0251$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_opened boolean := false;
  v_label  text := nullif(btrim(coalesce(p_label, '')), '');
  v_items  jsonb := coalesce(p_items, '[]'::jsonb);
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_result jsonb;
begin
  if not app.is_staff('waiter','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- The table's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from cafe_tables t where t.id = p_table_id);
  if v_venue is null then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_venue, 'waiter','cashier','manager','owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if jsonb_array_length(v_items) > 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if v_label is not null and length(v_label) > 40 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'label';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'place_floor_order');
  if v_replay is not null then
    return v_replay;
  end if;

  v_day := app.current_open_day_locked(v_venue);   -- lock order: the day before the tab
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_tab_id is not null then
    select * into v_tab from tabs where id = p_tab_id for update;
    if not found then
      raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_tab.merged_into_tab_id is not null then
      raise exception 'TAB_MERGED' using errcode = 'P0001',
        detail = v_tab.merged_into_tab_id::text;
    end if;
    if v_tab.status <> 'open' then
      raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
    end if;
    if v_tab.day_session_id is distinct from v_day then
      raise exception 'DAY_CLOSED' using errcode = 'P0001',
        hint = 'this tab belongs to a day that is no longer open';
    end if;
    -- A café tab on this table: the phone never adds to a booking's bill or
    -- a shop sale, and never to another table's tab.
    if v_tab.kind <> 'cafe' or v_tab.table_id is distinct from p_table_id then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'tab';
    end if;
    if jsonb_array_length(v_items) = 0 then
      raise exception 'EMPTY_ORDER' using errcode = 'P0001';
    end if;
  else
    insert into tabs (day_session_id, table_id, label, opened_by_staff_id, device_id, kind)
    values (v_day, p_table_id, v_label, auth.uid(), 'phone', 'cafe')
    returning * into v_tab;
    v_opened := true;
  end if;

  if jsonb_array_length(v_items) > 0 then
    insert into orders (tab_id, source, placed_by_staff_id, device_id)
    values (v_tab.id, 'till', auth.uid(), 'phone')
    returning * into v_order;

    perform app.add_order_items(v_order.id, v_items);

    insert into tickets (order_id, device_id)
    values (v_order.id, 'phone')
    returning * into v_ticket;
    -- STOCK HOOK (0018): tickets_consume_stock takes the stock on this insert,
    -- and tickets_rt puts the ticket on the kitchen board.
  end if;

  perform app.write_audit('floor.order', 'tabs', v_tab.id::text, null,
                          jsonb_build_object('opened', v_opened,
                                             'table_id', p_table_id,
                                             'order_id', v_order.id,
                                             'lines', jsonb_array_length(v_items)));

  v_result := jsonb_build_object('tab_id', v_tab.id, 'opened', v_opened,
                                 'order_id', v_order.id, 'ticket_id', v_ticket.id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $place_floor_order_0251$;

comment on function app.place_floor_order(uuid, uuid, text, jsonb, text) is
  '0251 (place an order from the staff phone). The waiter, the cashier and MGMT at the table''s branch, while its day is open: adds p_items (the till''s shape, [{variant_id, qty 1..99, notes?, modifiers?: [{modifier_id, qty}]}], at most 60, priced by the server) to p_tab_id, an open café tab of today on p_table_id; or, with no p_tab_id, opens a new café tab on the table (p_label, an optional name up to 40) and adds them, if any. The order is sent to the kitchen at once (order + ticket, as till_add_items). Returns {tab_id, opened, order_id, ticket_id}; no money. Idempotent by key. FORBIDDEN, TABLE_NOT_FOUND, VENUE_MISMATCH, NO_OPEN_DAY, TAB_NOT_FOUND, TAB_MERGED, TAB_NOT_OPEN, DAY_CLOSED, INVALID_ARGUMENT (hint items or tab), TEXT_TOO_LONG (hint label), EMPTY_ORDER, and add_order_items''s INVALID_QTY, VARIANT_NOT_FOUND, ITEM_UNAVAILABLE, MODIFIER_INVALID, MODIFIER_SELECTION, TAB_KIND_MISMATCH. Audit floor.order.';

revoke all on function app.place_floor_order(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function app.place_floor_order(uuid, uuid, text, jsonb, text) to authenticated;
