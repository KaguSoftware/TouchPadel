-- 0446 baristas_work_the_till — every barista is also a cashier.
--
-- Majed, 2026-11-20: "All baristas will take on cashier. Whether it's head or
-- not head, all of them will take cashier." A barista places orders and
-- works the café till exactly as a cashier does, with no conflict.
--
-- TWO PARTS.
--
-- 1. Cashier is kept as a second job on every barista. The trigger
--    staff_barista_cashier (app.trg_staff_barista_cashier) puts 'cashier' in
--    staff.extra_roles whenever the person's main role is on the bar team
--    (head_barista, barista, assistant_barista; app.staff_team's 'bar') or
--    barista is one of their second jobs. Every reader already counts a
--    second job: app.is_staff and app.staff_ids_with_roles (0345), app.my_staff_roles
--    (0383), the edge functions' requireStaffRole (0383), the operator's
--    can/canAccess and the staff phone's rows (0345). So one rule here opens
--    the till, its pushes, its checklists and its pages everywhere at once,
--    and the owner's Access list shows Cashier ticked (locked for a barista).
--    An owner who unticks it gets it back on save: it is the rule, not a
--    choice. A main role moved OFF the bar team (with no barista second job
--    left) loses the cashier job again; ticked by hand afterwards if wanted.
--    Unticking the barista second job leaves cashier ticked, visibly, for the
--    owner to untick: a save never removes a box the owner is looking at.
--    Existing baristas are given it below.
--
-- 2. The till's tab-kind rule reads every job. Each till RPC's door
--    (open_tab, till_add_items, settle_tab, … all is_staff('cashier', …))
--    let a second-job cashier in, then app.assert_tab_kind_role (0244) read
--    app.staff_role(), the MAIN job alone, and refused the café tab with
--    TAB_KIND_FORBIDDEN ("This sale belongs to the other cashier"). It now
--    reads app.my_staff_roles() (0383). The rule is 0244's: manager or owner,
--    any tab; shop_staff, a shop tab; cashier or court_desk, a café tab. 0383
--    swept the other main-role reads and 0404 the shop-only limits; this one
--    was missed. Every caller is untouched: the sixteen till RPCs call the
--    helper by name.
--
-- covered by packages/db/tests/second-jobs.test.ts ("0446")

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.assert_tab_kind_role — re-issued from
--    20260927000244_shop_desk_access.sql:43, the main role replaced by the
--    caller's jobs.
-- ---------------------------------------------------------------------------
create or replace function app.assert_tab_kind_role(p_kind text) returns void
language plpgsql stable security definer set search_path = public as $assert_tab_kind_role_0446$
declare
  v_roles staff_role[] := app.my_staff_roles();   -- 0446: every job, not the main one
begin
  if v_roles && array['manager', 'owner']::staff_role[] then
    return;
  end if;
  if coalesce(p_kind, 'cafe') = 'shop' then
    if 'shop_staff' = any(v_roles) then
      return;
    end if;
  elsif v_roles && array['cashier', 'court_desk']::staff_role[] then
    return;
  end if;
  raise exception 'TAB_KIND_FORBIDDEN' using errcode = 'P0001',
    detail = coalesce(p_kind, 'cafe');
end $assert_tab_kind_role_0446$;

comment on function app.assert_tab_kind_role(text) is
  '0244, 0446. Internal: raises TAB_KIND_FORBIDDEN (detail = the kind) unless one of the caller''s jobs (app.my_staff_roles: the main role and each second job) may work a tab of that kind: shop_staff shop only, cashier and court_desk cafe only, manager and owner both.';

revoke all on function app.assert_tab_kind_role(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Every barista holds the cashier job.
-- ---------------------------------------------------------------------------
create or replace function app.trg_staff_barista_cashier() returns trigger
language plpgsql set search_path = public as $trg_staff_barista_cashier_0446$
declare
  c_bar constant staff_role[] := array['head_barista', 'barista', 'assistant_barista']::staff_role[];
  v_extra staff_role[] := coalesce(new.extra_roles, '{}'::staff_role[]);
begin
  if new.role in ('owner', 'manager', 'cashier') then
    -- An owner holds no list (0345), a manager already opens the till, and a
    -- cashier's main role is the job itself.
    return new;
  end if;
  if new.role = any(c_bar) or 'barista' = any(v_extra) then
    if not ('cashier' = any(v_extra)) then
      new.extra_roles := (select array_agg(distinct r order by r)
                            from unnest(v_extra || 'cashier'::staff_role) r);
    end if;
  elsif tg_op = 'UPDATE' and old.role = any(c_bar) and new.role is distinct from old.role then
    -- Moved off the bar team: the cashier job came with the bar, so it goes.
    new.extra_roles := array_remove(v_extra, 'cashier'::staff_role);
  end if;
  return new;
end $trg_staff_barista_cashier_0446$;

comment on function app.trg_staff_barista_cashier() is
  '0446 (Majed 2026-11-20: every barista is also a cashier). BEFORE INSERT OR UPDATE OF role, extra_roles on staff: a person whose main role is head_barista, barista or assistant_barista, or who holds barista as a second job, always holds cashier in extra_roles; a main role moved off the bar team drops it. Owner, manager and cashier rows are left alone.';

revoke all on function app.trg_staff_barista_cashier() from public, anon, authenticated;

drop trigger if exists staff_barista_cashier on public.staff;
create trigger staff_barista_cashier
  before insert or update of role, extra_roles on public.staff
  for each row execute function app.trg_staff_barista_cashier();

-- The baristas already on the books: the trigger adds the job on this write.
update public.staff
   set extra_roles = extra_roles
 where (role in ('head_barista', 'barista', 'assistant_barista') or 'barista' = any(extra_roles))
   and not ('cashier' = any(extra_roles));
