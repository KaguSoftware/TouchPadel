set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0211_cafe_settings_readers_per_venue — multi-venue slice 2, step 4 (guest
-- cafe family and the business-day helpers).
--
-- Each body is re-issued from its latest version and reads the settings of the
-- branch its table, session, order or tab belongs to:
--   venue_business_date (0165)        the start hour of THAT branch (it read the
--                                     caller's resolved one)
--   business_date(timestamptz) (0034) delegates to venue_business_date at the
--                                     caller's resolved venue (default branch as
--                                     the last resort); same timezone, since
--                                     venues.timezone and venue_settings.timezone
--                                     are kept in step by set_venue_details
--   open_table_session (0031)         token TTL of the table's branch; the new
--                                     session names that branch (a guest has no
--                                     station or membership to resolve by)
--   touch_guest_session (0014)        token TTL of the session's branch
--   raise_waiter_call (0032)          degraded state and cooldown of the session's
--                                     branch; the call row names that branch
--   compute_tab_totals (0106)         tax_inclusive of the tab's branch
--   trg_guest_order_rate_limit,       limits of the order's branch
--   trg_guest_order_item_cap (0082)
--   add_order_items (0095)            business date and featured promo of the
--                                     order's branch

-- venue_business_date: re-issued from 20260925000165_checklists.sql:182
create or replace function app.venue_business_date(p_venue uuid, p_at timestamptz default now())
returns date
language sql stable security definer set search_path = public as $venue_business_date_0211$
  select app.business_date(
           p_at,
           coalesce((select v.timezone from venues v where v.id = p_venue), 'Asia/Baghdad'),
           coalesce(app.cafe_setting_int('analytics_business_day_start_hour', p_venue), 4))
$venue_business_date_0211$;

-- business_date(timestamptz): re-issued from 20260825000034_analytics.sql:71
create or replace function app.business_date(p_at timestamptz)
returns date
language sql stable security definer set search_path = public as $business_date_0211$
  select app.venue_business_date(app.current_venue_or_default(), p_at)
$business_date_0211$;

comment on function app.business_date(timestamptz) is
  '0034, 0211. The business date of p_at at the caller''s resolved branch (station, app.venue_id, only membership, only active venue; the default branch as the last resort). A body that knows its branch calls app.venue_business_date(venue, at) instead.';

-- open_table_session: re-issued from 20260825000031_tables_storage.sql:160
create or replace function app.open_table_session(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $open_table_session_0211$
declare
  v_uid      uuid := auth.uid();
  v_table_id uuid;
  v_table    cafe_tables%rowtype;
  v_ttl      int;
  v_sess     guest_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001',
      hint = 'sign in anonymously before opening a table session';
  end if;

  v_table_id := app.verify_table_token(p_token);
  if v_table_id is null then
    raise exception 'TOKEN_INVALID' using errcode = 'P0001',
      hint = 'ask staff for a fresh QR';
  end if;

  select * into v_table from cafe_tables where id = v_table_id;
  -- 0211: the table's branch, for its TTL and for the session row's venue.
  select table_token_ttl_minutes into v_ttl from venue_settings where venue_id = v_table.venue_id;
  perform set_config('app.venue_id', v_table.venue_id::text, true);

  -- One live session per auth user: refresh on the same table, replace on a
  -- table switch (guest moved seats / rescanned another QR).
  select * into v_sess
    from guest_sessions
   where auth_user_id = v_uid and closed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;

  if found and v_sess.table_id = v_table_id then
    update guest_sessions
       set last_activity_at = now(),
           expires_at = now() + make_interval(mins => coalesce(v_ttl, 90))
     where id = v_sess.id
     returning * into v_sess;
  else
    if found then
      update guest_sessions set closed_at = now() where id = v_sess.id;
    end if;
    insert into guest_sessions (table_id, auth_user_id, linked_profile_id, expires_at)
    values (v_table_id, v_uid,
            (select id from profiles where id = v_uid),   -- null for anonymous users
            now() + make_interval(mins => coalesce(v_ttl, 90)))
    returning * into v_sess;
  end if;

  return jsonb_build_object(
    'session_id',   v_sess.id,
    'table_id',     v_table.id,
    'table_number', v_table.table_number,
    'bell_enabled', v_table.bell_enabled,
    'expires_at',   v_sess.expires_at);
end $open_table_session_0211$;

-- touch_guest_session: re-issued from 20260824000014_tables_sessions.sql:252
create or replace function app.touch_guest_session() returns guest_sessions
language plpgsql security definer set search_path = public as $touch_guest_session_0211$
declare
  v_ttl  int;
  v_sess guest_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_sess
    from guest_sessions
   where auth_user_id = auth.uid() and closed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    raise exception 'SESSION_EXPIRED' using errcode = 'P0001',
      hint = 'scan the table QR again';
  end if;

  select table_token_ttl_minutes into v_ttl from venue_settings where venue_id = v_sess.venue_id;
  update guest_sessions
     set last_activity_at = now(),
         expires_at = now() + make_interval(mins => coalesce(v_ttl, 90))
   where id = v_sess.id
   returning * into v_sess;

  return v_sess;
end $touch_guest_session_0211$;

-- raise_waiter_call: re-issued from 20260825000032_telegram.sql:989
create or replace function app.raise_waiter_call(p_reason waiter_call_reason)
returns jsonb
language plpgsql security definer set search_path = public as $raise_waiter_call_0211$
declare
  v_sess guest_sessions;
  v_cool int;
  v_last timestamptz;
  v_row  waiter_calls%rowtype;
begin
  -- DEGRADED GUARD: staff can't watch the floor screen while the till is
  -- offline.
  -- 0211: the degraded state of the caller's live session's branch.
  if app.is_degraded(coalesce(
       (select gs.venue_id from guest_sessions gs
         where gs.auth_user_id = auth.uid() and gs.closed_at is null and gs.expires_at > now()
         order by gs.created_at desc limit 1),
       app.current_venue_or_default())) then
    raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
      hint = 'please wave at the staff — the call screen is offline';
  end if;

  v_sess := app.touch_guest_session();         -- raises SESSION_EXPIRED / AUTH_REQUIRED

  -- BELL (0031/0032): the table's bell can be switched off by management.
  if not coalesce((select bell_enabled from cafe_tables where id = v_sess.table_id), true) then
    raise exception 'BELL_DISABLED' using errcode = 'P0001',
      hint = 'the bell is off for this table — please wave at the staff';
  end if;

  select waiter_call_cooldown_seconds into v_cool from venue_settings where venue_id = v_sess.venue_id;
  perform set_config('app.venue_id', v_sess.venue_id::text, true);
  select max(raised_at) into v_last from waiter_calls where table_id = v_sess.table_id;
  if v_last is not null and v_last > now() - make_interval(secs => coalesce(v_cool, 120)) then
    raise exception 'CALL_COOLDOWN' using errcode = 'P0001',
      hint = 'staff already notified — give them a moment';
  end if;

  begin
    insert into waiter_calls (table_id, guest_session_id, reason)
    values (v_sess.table_id, v_sess.id, p_reason)
    returning * into v_row;
  exception when unique_violation then
    -- waiter_calls_one_open: a live call already exists for this table.
    raise exception 'ALREADY_NOTIFIED' using errcode = 'P0001',
      hint = 'staff already notified — give them a moment';
  end;

  -- TELEGRAM (0032): bookkeeping only — never roll back the call.
  begin
    perform app.enqueue_telegram('waiter_call', v_row.id);
  exception when others then
    raise warning 'telegram enqueue failed for waiter call %: % (%)', v_row.id, sqlerrm, sqlstate;
  end;

  return jsonb_build_object('call_id', v_row.id, 'status', v_row.status,
                            'raised_at', v_row.raised_at);
end $raise_waiter_call_0211$;

-- compute_tab_totals: re-issued from 20260917000106_desk_payment.sql:163
create or replace function app.compute_tab_totals(p_tab_id uuid)
returns table (
  subtotal_iqd bigint,
  discount_iqd bigint,
  tax_iqd      bigint,
  court_iqd    bigint,
  total_iqd    bigint
)
language plpgsql stable security definer set search_path = public as $compute_tab_totals_0211$
declare
  v_subtotal  bigint;
  v_disc_line bigint;
  v_disc_tab  bigint;
  v_discount  bigint;
  v_tab_alloc bigint;
  v_tax       bigint;
  v_court     bigint;
  v_inclusive boolean;
begin
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_line
    from tab_adjustments a
    join order_items oi on oi.id = a.order_item_id
    join orders o on o.id = oi.order_id
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and o.tab_id = p_tab_id
     and o.status <> 'voided'
     and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_tab
    from tab_adjustments a
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and a.order_item_id is null;

  v_discount := least(v_disc_line + v_disc_tab, v_subtotal);

  v_tab_alloc := greatest(least(v_disc_tab, v_discount - least(v_disc_line, v_discount)), 0);

  -- 0106: the court fee still OWED on the booking this tab is charged to (D1,
  -- D3). 'pending' holds, cancelled, expired and no-show bookings owe nothing.
  select app.court_fee_remaining(t.reservation_id, t.id) into v_court
    from tabs t
   where t.id = p_tab_id
     and t.reservation_id is not null;
  v_court := coalesce(v_court, 0);

  with grp as (
    select mc.tax_group_id, sum(oi.line_total_iqd) as grp_subtotal
      from order_items oi
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
     group by mc.tax_group_id
  ),
  line_disc as (
    select mc.tax_group_id, sum(a.amount_iqd) as amt
      from tab_adjustments a
      join order_items oi     on oi.id = a.order_item_id and not oi.voided
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where a.tab_id = p_tab_id
       and a.kind in ('discount_percent','discount_amount')
       and o.tab_id = p_tab_id
       and o.status <> 'voided'
     group by mc.tax_group_id
  ),
  base as (
    select g.tax_group_id,
           greatest(g.grp_subtotal - coalesce(ld.amt, 0), 0) as after_line
      from grp g
      left join line_disc ld on ld.tax_group_id = g.tax_group_id
  ),
  alloc as (
    select b.tax_group_id,
           greatest(
             b.after_line
               - round((v_tab_alloc::numeric * b.after_line)
                       / nullif(sum(b.after_line) over (), 0)),
             0) as taxable
      from base b
  )
  select coalesce(sum(
           case when coalesce((select vs.tax_inclusive from venue_settings vs
                                 where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id)), false)
                then round((a.taxable::numeric * tg.rate_bp) / (10000.0 + tg.rate_bp))
                else round((a.taxable::numeric * tg.rate_bp) / 10000.0)
           end), 0)::bigint
    into v_tax
    from alloc a
    join tax_groups tg on tg.id = a.tax_group_id
   where tg.is_active;

  select vs.tax_inclusive into v_inclusive from venue_settings vs
   where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id);

  subtotal_iqd := v_subtotal;
  discount_iqd := v_discount;
  tax_iqd      := v_tax;
  court_iqd    := v_court;
  total_iqd    := greatest(
    v_subtotal - v_discount
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0) + v_court;
  return next;
end $compute_tab_totals_0211$;

-- trg_guest_order_rate_limit: re-issued from 20260907000082_cafe_abuse_limits.sql:53
create or replace function app.trg_guest_order_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $trg_guest_order_rate_limit_0211$
declare
  v_limit  int;
  v_recent int;
begin
  -- Staff-created orders are not rate-limited: a busy till legitimately fires
  -- faster than any guest, and the actor there is identified and audited.
  if new.guest_session_id is null then
    return new;
  end if;

  select guest_orders_per_minute into v_limit from venue_settings where venue_id = new.venue_id;
  if v_limit is null then
    return new;                                  -- no settings row: do not invent a limit
  end if;

  select count(*) into v_recent
    from orders
   where guest_session_id = new.guest_session_id
     and placed_at > now() - interval '1 minute';

  if v_recent >= v_limit then
    raise exception 'TOO_MANY_ORDERS' using errcode = 'P0001',
      detail = format('%s orders in the last minute, limit %s', v_recent, v_limit),
      hint = 'please wait a moment, or ask a member of staff';
  end if;

  return new;
end $trg_guest_order_rate_limit_0211$;

-- trg_guest_order_item_cap: re-issued from 20260907000082_cafe_abuse_limits.sql:94
create or replace function app.trg_guest_order_item_cap() returns trigger
language plpgsql security definer set search_path = public as $trg_guest_order_item_cap_0211$
declare
  v_limit   int;
  v_session uuid;
  v_count   int;
begin
  select o.guest_session_id into v_session from orders o where o.id = new.order_id;
  if v_session is null then
    return new;                                  -- staff order, or no parent yet
  end if;

  select vs.guest_items_per_order into v_limit from venue_settings vs
   where vs.venue_id = (select o.venue_id from orders o where o.id = new.order_id);
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count from order_items where order_id = new.order_id;

  if v_count >= v_limit then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001',
      detail = format('%s items already on this order, limit %s', v_count, v_limit),
      hint = 'split it across orders, or ask a member of staff';
  end if;

  return new;
end $trg_guest_order_item_cap_0211$;

-- add_order_items: re-issued from 20260914000095_cafe_net_lines.sql:98
create or replace function app.add_order_items(p_order_id uuid, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = public as $add_order_items_0211$
declare
  v_item      jsonb;
  v_mod       jsonb;
  v_variant   menu_item_variants%rowtype;
  v_mi        menu_items%rowtype;
  v_modifier  modifiers%rowtype;
  v_qty       int;
  v_mqty      int;
  v_list      bigint;
  v_unit      bigint;
  v_mods      bigint;
  v_line      bigint;
  v_cost      bigint;
  v_oi_id     uuid;
  v_total     bigint := 0;
  v_hero_mode text;
  v_feat      uuid;
  v_pct       int;
  v_featured  boolean;
  v_chosen    uuid[];
  v_active    uuid[];
  v_bad_mod   uuid;
  v_bad_group uuid;
  v_today     date;
  v_venue     uuid := (select o.venue_id from orders o where o.id = p_order_id);
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  v_today := app.venue_business_date(v_venue, now());   -- 0041: once per order; 0211: the order's branch

  -- Featured promo state (0029 settings), read ONCE per call so every line of
  -- this order sees the same promo — a mid-order settings change cannot split
  -- one order across two prices.
  v_hero_mode := app.cafe_setting_text('hero_mode', v_venue);
  begin
    v_feat := nullif(nullif(app.cafe_setting_text('featured_item_id', v_venue), ''), 'null')::uuid;
  exception when invalid_text_representation then
    v_feat := null;                            -- a malformed setting must never block ordering
  end;
  v_pct := coalesce(app.cafe_setting_int('featured_discount_pct', v_venue), 0);

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;

    select * into v_variant from menu_item_variants
     where id = (v_item->>'variant_id')::uuid;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001',
        detail = v_item->>'variant_id';
    end if;

    select * into v_mi from menu_items where id = v_variant.item_id;
    if not v_mi.is_active
       or v_mi.unavailable_on = v_today                    -- 0041: was current_date
       or v_mi.sold_out
       or not exists (select 1 from menu_categories c where c.id = v_mi.category_id and c.is_active) then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001',
        detail = v_mi.id::text;
    end if;

    v_list := v_variant.price_iqd;             -- SNAPSHOT: server price, never client-supplied
    -- 0095: SNAPSHOT the unit cost too, so margins read the cost of the day
    -- the line was sold, not the cost of the day the report is opened.
    v_cost := app.current_unit_cost(v_mi.id, v_variant.id);
    v_featured := coalesce(v_hero_mode = 'featured' and v_feat = v_mi.id and v_pct > 0, false);
    if v_featured then
      v_unit := app.apply_pct_discount(v_list, v_pct);
    else
      v_unit := v_list;
    end if;
    v_mods := 0;

    insert into order_items (order_id, menu_item_id, variant_id, qty,
                             list_price_iqd, unit_price_iqd, line_total_iqd, notes,
                             discount_pct, discount_source, cost_iqd)
    values (p_order_id, v_mi.id, v_variant.id, v_qty,
            v_list, v_unit, 0, nullif(v_item->>'notes', ''),
            case when v_featured then v_pct else 0 end,
            case when v_featured then 'featured' else null end,
            v_cost)
    returning id into v_oi_id;

    for v_mod in select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb)) loop
      v_mqty := coalesce(nullif(v_mod->>'qty', '')::int, 1);
      if v_mqty < 1 or v_mqty > 9 then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;

      -- Existence + is_active here; whether its group is linked OR revealed for
      -- this line is decided below, once every choice of the line is known.
      select m.* into v_modifier
        from modifiers m
       where m.id = (v_mod->>'modifier_id')::uuid and m.is_active;
      if not found then
        raise exception 'MODIFIER_INVALID' using errcode = 'P0001',
          detail = v_mod->>'modifier_id';
      end if;

      insert into order_item_modifiers (order_item_id, modifier_id, qty, price_delta_iqd)
      values (v_oi_id, v_modifier.id, v_mqty, v_modifier.price_delta_iqd);
      -- PK (order_item_id, modifier_id) raises on a duplicate modifier in the payload.

      v_mods := v_mods + v_modifier.price_delta_iqd * v_mqty;
    end loop;

    -- Active groups for this line (0028): linked groups UNION groups revealed
    -- by a chosen modifier whose own group is linked (depth is 1 by invariant).
    select coalesce(array_agg(oim.modifier_id), '{}'::uuid[]) into v_chosen
      from order_item_modifiers oim
     where oim.order_item_id = v_oi_id;
    v_active := array(select ag from app.item_active_groups(v_mi.id, v_chosen) as ag);

    -- Any chosen modifier outside the active set is invalid for this line.
    select m.id into v_bad_mod
      from order_item_modifiers oim
      join modifiers m on m.id = oim.modifier_id
     where oim.order_item_id = v_oi_id
       and m.group_id <> all (v_active)
     order by m.sort_order, m.id
     limit 1;
    if v_bad_mod is not null then
      raise exception 'MODIFIER_INVALID' using errcode = 'P0001',
        detail = v_bad_mod::text,
        hint = 'modifier group is neither linked to the item nor revealed by a chosen option';
    end if;

    -- min/max per ACTIVE group (distinct choices count; a doubled modifier is one choice).
    select g.id into v_bad_group
      from modifier_groups g
      left join lateral (
        select count(*) as chosen
          from order_item_modifiers oim
          join modifiers m2 on m2.id = oim.modifier_id
         where oim.order_item_id = v_oi_id and m2.group_id = g.id
      ) c on true
     where g.id = any (v_active)
       and (c.chosen < g.min_select or c.chosen > g.max_select)
     order by g.id
     limit 1;
    if v_bad_group is not null then
      raise exception 'MODIFIER_SELECTION' using errcode = 'P0001',
        detail = v_bad_group::text,
        hint = 'modifier choices violate a group min/max';
    end if;

    v_line := (v_unit + v_mods) * v_qty;
    update order_items set line_total_iqd = v_line where id = v_oi_id;
    v_total := v_total + v_line;
  end loop;

  return v_total;
end $add_order_items_0211$;

