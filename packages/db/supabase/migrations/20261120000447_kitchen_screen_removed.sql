-- 0447 kitchen_screen_removed — the kitchen screen (KDS) is gone, and so is everything that
-- only existed to feed it (Majed, 2026-11-20: "fully get rid of the kitchen screen ... delete it
-- remove it erase it").
--
-- What goes:
--   * the screen's reads and writes: app.kitchen_board (0158 ... 0352), app.kds_ack_tickets and
--     app.recall_ticket (0396), app.kitchen_reach (0399, 0400), app.set_order_item_ready (0061 ...
--     0217) and app.set_ticket_status (0015 ... 0217), the bump the screen called;
--   * the item_ready realtime event and its trigger (0061): only the screen's item ticks fired it;
--   * the access area 'kds': its app.access_area_rpcs rows, and the word in staff.blocked_areas
--     (scrubbed from every row, then the CHECK and app.set_staff_access re-issued without it);
--   * 'recall_ticket' in app.queueable_rpcs (0395);
--   * the ticketsQueued / ticketsPreparing / ticketsLate figures of app.ops_overview: with nobody
--     bumping tickets they would only ever grow, so the manager's "Kitchen orders running late"
--     row would never clear.
--
-- tickets.kds_seen_at (0396) stays as an unused nullable column: dropping a column is refused by the
-- migration gate on a direct push, and nothing reads it any more.
--
-- What stays, on purpose: the tickets table and a ticket per sent order (till_add_items, the
-- counter orders, order_service, the Telegram group, the reports all write or read it),
-- app.ticket_transition (the Telegram buttons), the 'kds' realtime topic (waiter calls and the
-- delivery announcements ride it) and the 'prep' staff role. A ticket now stays 'queued' unless a
-- Telegram button moves it; reports count an order as served once its tab settles
-- (o.status = 'served' or t.status = 'settled'), so no figure waits on a ticket.
--
-- covered by packages/db/tests/kitchen-screen-removed.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 1. The screen's functions
-- ===========================================================================
drop function if exists app.kitchen_board(uuid);
drop function if exists app.kds_ack_tickets(uuid[]);
drop function if exists app.recall_ticket(uuid, text);
drop function if exists app.kitchen_reach(timestamptz);
drop function if exists app.set_order_item_ready(uuid, boolean, text);
drop function if exists app.set_ticket_status(uuid, ticket_status, text);

-- ===========================================================================
-- 2. The item_ready event
-- ===========================================================================
drop trigger if exists order_items_ready_rt on order_items;
drop function if exists app.rt_order_item_ready();

-- ===========================================================================
-- 4. app.queueable_rpcs — 0395's list without recall_ticket
-- ===========================================================================
create or replace function app.queueable_rpcs()
returns text[]
language sql immutable set search_path = public as $queueable_rpcs_0447$
  select array[
    -- Settings
    'set_venue_details', 'set_waiter_call_cooldown', 'set_match_settings',
    'set_coaching_settings', 'set_tournaments_enabled', 'set_opening_hours',
    'set_deposit_settings', 'set_loyalty_settings', 'set_telegram_staff',
    -- Courts, tables, prices
    'upsert_court', 'reorder_courts', 'upsert_court_gender_rule', 'upsert_rate_rule',
    'upsert_cafe_table', 'set_table_bell',
    -- Menu
    'upsert_menu_category', 'upsert_menu_item', 'upsert_variant', 'upsert_modifier',
    'upsert_modifier_group', 'link_item_modifier_group', 'set_modifier_reveals',
    'set_item_sold_out', 'set_item_availability', 'set_item_cost', 'reorder_modifiers',
    'reorder_menu_items', 'reorder_menu_categories', 'set_addon_suggestions',
    -- Promotions and loyalty
    'upsert_promotion', 'set_promotion_enabled', 'upsert_loyalty_reward', 'upsert_loyalty_tier',
    -- Coaching
    'upsert_lesson_type', 'set_coach_lesson_types', 'set_coach_price', 'set_coach_hours',
    'set_coach_branches', 'set_coach_status', 'coach_update', 'add_coach_time_off',
    'cancel_coach_time_off',
    -- Staff (never the PIN)
    'rename_staff', 'set_staff_role', 'set_staff_active', 'set_staff_access',
    'set_staff_venues', 'set_station_staff',
    -- Shop catalogue and stock settings
    'upsert_retail_variant', 'upsert_shop_category', 'upsert_supplier',
    'set_shop_price_watch', 'upsert_ingredient', 'set_recipe',
    -- F-56, F-58
    'set_tab_customer',
    'deposit_refund_retry', 'deposit_refund_request', 'deposit_refund_manual'
  ]::text[]
$queueable_rpcs_0447$;

comment on function app.queueable_rpcs() is
  '0395, 0447: the RPCs an rpc.queued envelope may name. Mirrors packages/core QUEUEABLE_RPCS and '
  'functions/_shared/mutation-types.json queueableRpcs; tests/queued-rpc.test.ts holds them equal.';

-- ===========================================================================
-- 5. app.ops_overview — 0292's body without the kitchen ticket counts
-- ===========================================================================
create or replace function app.ops_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $ops_overview_0447$
declare
  v_rv uuid[] := app.report_venues();
  v_now      timestamptz := now();
  v_today    date;
  v_b        record;
  v_day      day_sessions%rowtype;
  v_bookings jsonb;
  v_cafe     jsonb;
  v_stock    jsonb;
  v_staff    jsonb;
  v_exc      jsonb;
  v_close    jsonb;
begin
  perform app.reports_guard(false);

  v_today := app.business_date(v_now);
  select * into strict v_b from app.analytics_bounds(v_today, v_today);

  -- Bookings ---------------------------------------------------------------
  with r as (
    select *
      from reservations
     where reservations.venue_id = any(v_rv) and kind = 'booking'
       and start_at >= v_b.ts_from and start_at < v_b.ts_to)
  select jsonb_build_object(
           'today',          (select count(*) from r where status in ('confirmed','arrived','completed')),
           'arrived',        (select count(*) from r where status = 'arrived'),
           'upcoming',       (select count(*) from r where status = 'confirmed' and start_at > v_now),
           'noShows',        (select count(*) from r where status = 'no_show'),
           'cancelledToday', (select count(*) from reservations
                               where reservations.venue_id = any(v_rv) and kind = 'booking' and status = 'cancelled'
                                 and cancelled_at >= v_b.ts_from and cancelled_at < v_b.ts_to),
           'nextArrival',    (select jsonb_build_object(
                                       'reservationId', r.id,
                                       'startAt',       r.start_at,
                                       'courtNameEn',   c.name_en,
                                       'courtNameAr',   c.name_ar,
                                       'guestName',     coalesce(r.guest_name, pr.full_name))
                                from r
                                join courts c on c.id = r.court_id
                                left join profiles pr on pr.id = r.guest_id
                               where c.venue_id = any(v_rv) and r.status = 'confirmed' and r.end_at > v_now
                               order by r.start_at, r.id
                               limit 1))
    into v_bookings;

  -- Cafe -------------------------------------------------------------------
  select jsonb_build_object(
           'openTabs',         (select count(*) from tabs where tabs.venue_id = any(v_rv) and status in ('open','awaiting_payment')),
           'waiterCallsOpen',  (select count(*) from waiter_calls where waiter_calls.venue_id = any(v_rv) and status in ('raised','acknowledged')),
           'ordersToday',      (select count(*) from orders
                                 where orders.venue_id = any(v_rv) and placed_at >= v_b.ts_from and placed_at < v_b.ts_to
                                   and status <> 'voided'))
    into v_cafe;

  -- Stock ------------------------------------------------------------------
  select jsonb_build_object(
           'low',          (select count(*) from v_ingredient_on_hand
                             where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
                               and is_active and low_stock_threshold is not null
                               and on_hand <= low_stock_threshold),
           'belowPar',     (select count(*) from v_ingredient_on_hand
                             where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
                               and is_active and par_level is not null and on_hand < par_level),
           'expiringSoon', (select count(*) from v_expiring_soon where venue_id = any(v_rv)),
           'expired',      (select count(*) from v_expired where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))),
           'lastCountAt',  (select max(finalized_at) from stock_counts where stock_counts.venue_id = any(v_rv) and venue_id = any(v_rv)),
           'openAlerts',   (select count(*) from manager_alerts where manager_alerts.venue_id = any(v_rv) and acknowledged_at is null))
    into v_stock;

  -- Staff activity today (activity, not a ranking: ordered by name) ---------
  with
  ord as (
    select o.placed_by_staff_id as staff_id, count(*) as n
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided' and o.placed_by_staff_id is not null
     group by 1),
  bk as (
    select r.created_by_staff_id as staff_id, count(*) as n
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking' and r.created_by_staff_id is not null
       and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  pay as (
    select p.recorded_by as staff_id, count(*) as n
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
     group by 1),
  ids as (
    select staff_id from ord union select staff_id from bk union select staff_id from pay)
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId',         s.id,
           'name',            s.display_name,
           'role',            s.role,
           'ordersTaken',     coalesce(ord.n, 0),
           'bookingsCreated', coalesce(bk.n, 0),
           'paymentsTaken',   coalesce(pay.n, 0)
         ) order by s.display_name, s.id), '[]'::jsonb)
    into v_staff
    from ids
    join staff s on s.id = ids.staff_id
    left join ord on ord.staff_id = s.id
    left join bk  on bk.staff_id  = s.id
    left join pay on pay.staff_id = s.id;

  -- Exceptions today -------------------------------------------------------
  select jsonb_build_object(
           'discounts', (select jsonb_build_object('count', count(*), 'amountIqd', coalesce(sum(amount_iqd), 0)::bigint)
                           from tab_adjustments
                          where created_at >= v_b.ts_from and created_at < v_b.ts_to),
           'voids',     (select jsonb_build_object('count', count(*),
                                                   'amountIqd', coalesce(sum((after ->> 'line_total_iqd')::bigint), 0)::bigint)
                           from audit_log
                          where audit_log.venue_id = any(v_rv) and action = 'order_item.void'
                            and at >= v_b.ts_from and at < v_b.ts_to),
           'refunds',   (select jsonb_build_object('count', count(*), 'amountIqd', coalesce(sum(amount_iqd), 0)::bigint)
                           from refunds
                          where refunds.venue_id = any(v_rv) and created_at >= v_b.ts_from and created_at < v_b.ts_to),
           'waste',     (select jsonb_build_object('count', count(*),
                                                   'costIqd', coalesce(round(sum(-qty_delta * coalesce(unit_cost_iqd, 0))), 0)::bigint)
                           from stock_movements
                          where stock_movements.venue_id = any(v_rv) and movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
                            and qty_delta < 0
                            and at >= v_b.ts_from and at < v_b.ts_to))
    into v_exc;

  -- Day close --------------------------------------------------------------
  select * into v_day from day_sessions
   where day_sessions.venue_id = any(v_rv) and status in ('open','closing')
   order by opened_at desc limit 1;

  if found then
    select jsonb_build_object(
             'open',            true,
             'businessDate',    v_day.business_date,
             'openedAt',        v_day.opened_at,
             'openingFloatIqd', v_day.opening_float_iqd::bigint,
             -- 0292 (DB-17): the tab's own columns in WHERE, the joined rows'
             -- venue checks in their ON clauses.
             'blockingTabs',    coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id',          t.id,
                        'kind',        t.kind,
                        'label',       t.label,
                        'tableNumber', ct.table_number,
                        'guestName',   coalesce(r.guest_name, pr.full_name,
                                                case when le.booked_by_kind = 'guest'
                                                     then coalesce(lp.full_name, le.guest_name)
                                                     else le.guest_name end)
                      ) order by t.opened_at, t.id)
                 from tabs t
                 left join cafe_tables ct        on ct.id = t.table_id and ct.venue_id = any(v_rv)
                 left join reservations r        on r.id = t.reservation_id and r.venue_id = any(v_rv)
                 left join profiles pr           on pr.id = r.guest_id
                 left join lesson_enrolments le  on le.id = t.lesson_enrolment_id
                 left join profiles lp           on lp.id = le.guest_id
                where t.venue_id = any(v_rv) and t.day_session_id = v_day.id
                  and t.status in ('open','awaiting_payment')), '[]'::jsonb),
             'expectedCashIqd', (
               v_day.opening_float_iqd
               + coalesce((select sum(p.amount_iqd) from payments p
                            where p.venue_id = any(v_rv) and p.day_session_id = v_day.id and p.method = 'cash'), 0)
               - coalesce((select sum(rf.amount_iqd) from refunds rf
                             join payments p on p.id = rf.payment_id
                            where p.venue_id = any(v_rv) and rf.venue_id = any(v_rv)
                              and coalesce((select ts.day_session_id from till_shifts ts where ts.id = rf.till_shift_id), p.day_session_id) = v_day.id   -- 0281 (C-31, R71)
                              and p.method = 'cash'), 0))::bigint)
      into v_close;
  else
    v_close := jsonb_build_object(
      'open', false, 'businessDate', null, 'openedAt', null, 'openingFloatIqd', null,
      'blockingTabs', '[]'::jsonb, 'expectedCashIqd', null);
  end if;

  return jsonb_build_object(
    'businessDate',  v_today,
    'asOf',          v_now,
    'bookings',      v_bookings,
    'cafe',          v_cafe,
    'stock',         v_stock,
    'staffActivity', v_staff,
    'exceptions',    v_exc,
    'dayClose',      v_close);
end $ops_overview_0447$;

comment on function app.ops_overview() is
  '0068, 0219, 0281, 0292, 0447. The operator''s Today screen for the branches in scope: today''s bookings, café (open tabs, orders today, waiter calls), stock, staff activity and exceptions, and the open day (blocking tabs, expected cash). 0281 (C-31, R71): expectedCashIqd dates a refund by the till shift it was made in, else by its payment''s day, as close_day does. 0292 (DB-17): blockingTabs lists every open or awaiting-payment tab of the open day (table, counter, shop and lesson tabs alike), each {id, kind, label, tableNumber, guestName}; a lesson tab is named by its place (R44). 0447: no kitchen ticket counts; the kitchen screen is gone.';

-- ===========================================================================
-- 6. The access area 'kds'
-- ===========================================================================
delete from app.access_area_rpcs where area = 'kds';

alter table app.access_area_rpcs drop constraint if exists access_area_rpcs_area_chk;
alter table app.access_area_rpcs
  add constraint access_area_rpcs_area_chk
    check (area in ('till', 'desk', 'customers', 'tournaments', 'shop', 'tasks',
                    'insights', 'content', 'incidents', 'ops', 'stock', 'admin', 'reports',
                    'protocols', 'suggestions', 'deductions', 'attendance')) not valid;
alter table app.access_area_rpcs validate constraint access_area_rpcs_area_chk;

-- A blocked page the product no longer has is not a block. Done before the CHECK below, which
-- would refuse the old word.
update staff
   set blocked_areas = array_remove(blocked_areas, 'kds')
 where 'kds' = any(blocked_areas);

alter table staff drop constraint if exists staff_blocked_areas_chk;
alter table staff add constraint staff_blocked_areas_chk
  check (blocked_areas <@ array['till', 'desk', 'customers', 'tournaments',
                                'shop', 'tasks', 'insights', 'content', 'incidents', 'ops', 'stock', 'admin',
                                'reports', 'protocols', 'suggestions', 'deductions',
                                'attendance']::text[]
         and cardinality(blocked_areas) <= 17) not valid;
alter table staff validate constraint staff_blocked_areas_chk;

-- 0362's body without 'kds' in the area list.
create or replace function app.set_staff_access(
  p_staff_id      uuid,
  p_extra_roles   staff_role[],
  p_blocked_areas text[]
) returns jsonb
language plpgsql security definer set search_path = public as $set_staff_access_0447$
declare
  v_before staff%rowtype;
  v_after  staff%rowtype;
  v_extra  staff_role[];
  v_block  text[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'CANNOT_EDIT_SELF' using errcode = 'P0001',
      hint = 'another owner must change your own access';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_before.role = 'owner' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      hint = 'an owner opens everything';
  end if;

  -- Sorted and once each, without the main role: the row reads the same
  -- however the boxes were ticked, and an audit diff shows only real changes.
  select coalesce(array_agg(distinct r order by r), '{}'::staff_role[]) into v_extra
    from unnest(coalesce(p_extra_roles, '{}'::staff_role[])) r
   where r is not null and r <> v_before.role;
  select coalesce(array_agg(distinct a order by a), '{}'::text[]) into v_block
    from unnest(coalesce(p_blocked_areas, '{}'::text[])) a
   where a is not null;

  if not (v_extra <@ array['cashier', 'waiter', 'court_desk', 'shop_staff',
                           'barista', 'chef', 'driver', 'marketing']::staff_role[]) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'extra_roles';
  end if;
  if not (v_block <@ array['till', 'desk', 'customers', 'tournaments',
                           'shop', 'tasks', 'insights', 'content', 'incidents', 'ops', 'stock', 'admin',
                           'reports', 'protocols', 'suggestions', 'deductions',
                           'attendance']::text[]) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocked_areas';
  end if;

  update staff
     set extra_roles   = v_extra,
         blocked_areas = v_block
   where id = p_staff_id
   returning * into v_after;

  perform app.write_audit('staff.access_set', 'staff', p_staff_id::text,
                          jsonb_build_object('extra_roles', v_before.extra_roles,
                                             'blocked_areas', v_before.blocked_areas),
                          jsonb_build_object('extra_roles', v_after.extra_roles,
                                             'blocked_areas', v_after.blocked_areas),
                          null);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'extra_roles', v_after.extra_roles,
                            'blocked_areas', v_after.blocked_areas);
end $set_staff_access_0447$;
