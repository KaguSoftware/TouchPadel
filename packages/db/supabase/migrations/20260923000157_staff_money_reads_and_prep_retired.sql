set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0157 — two corrections to 0156, both about who reads and who is given what.
--
-- 1. MONEY READS. 0156 made the four order-side read policies role-agnostic
--    along with the rest of the any-staff list. For the five roles of the day
--    that was the same predicate, but it also handed driver and marketing
--    SELECT on tabs, orders, order_items and order_item_modifiers, and with
--    them the priced columns the client grants expose (total_iqd,
--    unit_price_iqd, line_total_iqd, cost_iqd). Those two roles work from a
--    personal phone, not a venue machine, and hold no till, desk or kitchen
--    screen that needs a tab. The four policies go back to an explicit list:
--    the five roles that read them before 0156, plus the bar and kitchen
--    family, which reads order lines for the kitchen board exactly as prep
--    does. Every other 0156 any-staff policy (menu, courts, rates, tax
--    groups, venues, settings, stations, tables, promotions) stays
--    role-agnostic: nothing in them is a figure a guest cannot already see.
--    Shapes are 0156's verbatim: tabs and orders keep the 0136 venue
--    conjunct, order_items and order_item_modifiers keep none (0015).
--
-- 2. PREP IS RETIRED ON THE SERVER TOO. staff-admin refuses to create a prep
--    account, but app.set_staff_role (latest body 0105:105-150) still moved
--    anyone onto it, and an operator build older than the retirement still
--    offers Kitchen in its picker. A change TO prep now raises ROLE_RETIRED.
--    A row that is already prep may be saved as prep (no-op) and moved off it
--    freely. The body is 0105's verbatim with that one check added after the
--    row lock.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The four order-side read policies (latest: 0156).
-- ---------------------------------------------------------------------------

-- tabs (0156:684)
drop policy if exists tabs_staff_read on tabs;
create policy tabs_staff_read on tabs for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner',
                      'head_barista','barista','head_chef','chef')
         and venue_id = any(app.staff_venue_ids()));

-- orders (0156:690)
drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner',
                      'head_barista','barista','head_chef','chef')
         and venue_id = any(app.staff_venue_ids()));

-- order_items (0156:703)
drop policy if exists order_items_staff_read on order_items;
create policy order_items_staff_read on order_items for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner',
                      'head_barista','barista','head_chef','chef'));

-- order_item_modifiers (0156:708)
drop policy if exists order_item_modifiers_staff_read on order_item_modifiers;
create policy order_item_modifiers_staff_read on order_item_modifiers
  for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner',
                      'head_barista','barista','head_chef','chef'));

-- ---------------------------------------------------------------------------
-- 2. app.set_staff_role — 0105 body plus the ROLE_RETIRED check
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_role(
  p_staff_id    uuid,
  p_role        staff_role,
  p_reason_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_role_0157$
declare
  v_before staff%rowtype;
  v_after  staff%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'CANNOT_EDIT_SELF' using errcode = 'P0001',
      hint = 'another owner must change your own role';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 0157: prep is retired (0155). Nobody is moved onto it; a row already on
  -- it may be saved unchanged and moved to barista or chef.
  if p_role = 'prep' and v_before.role is distinct from 'prep' then
    raise exception 'ROLE_RETIRED' using errcode = 'P0001',
      hint = 'prep is retired; choose barista or chef';
  end if;

  if v_before.role = 'owner' and p_role <> 'owner' and app.other_active_owners(p_staff_id) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001',
      hint = 'promote another owner first';
  end if;

  -- 0105: the PIN stays. It is the person's PIN now, not the role's; a demoted
  -- manager's PIN simply stops approving anything, because verify_manager_pin
  -- filters on the role at verification time.
  update staff
     set role = p_role
   where id = p_staff_id
   returning * into v_after;

  perform app.write_audit('staff.role_set', 'staff', p_staff_id::text,
                          jsonb_build_object('role', v_before.role,
                                             'had_pin', v_before.pin_hash is not null),
                          jsonb_build_object('role', v_after.role,
                                             'had_pin', v_after.pin_hash is not null),
                          p_reason_code);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'is_active', v_after.is_active);
end $set_role_0157$;

revoke all on function app.set_staff_role(uuid, staff_role, text) from public, anon;
grant execute on function app.set_staff_role(uuid, staff_role, text) to authenticated;
