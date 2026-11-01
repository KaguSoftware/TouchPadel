-- 0400 branch_exclusive_reads — the cross-branch reads the F-67 role matrix
-- found (Majed's F-27 rule, 2026-11-01: "everything exclusive to its own
-- branch"). Uses only 0382's app.shares_branch_with; nothing here depends on
-- 0401 or later.
--
--   1. Staff. A manager read every staff row of the chain (staff_select) and
--      app.list_staff listed every staff member with has_pin. Now a manager
--      sees only themselves, the owners, and the people who work at one of
--      their branches (app.staff_visible_to_me); the owner still sees
--      everyone. app.clear_pin_lockout follows the same rule (a manager of
--      another branch cannot release someone's PIN lock: STAFF_NOT_FOUND).
--   2. Tables with no branch column, read by managers chain-wide:
--      sync_replays (the replay record), telegram_chats and telegram_staff
--      (the Telegram setup, whose page is the owner's: /admin/telegram) and
--      app.profile_merges (the merge log; merge_accounts is owner-only).
--      None says which branch a row is, so each is now the owner's alone.
--      Customer notes and flags stay chain-wide (customers are chain-wide).
--   3. app.kitchen_reach (0399) was any active staff over every branch in
--      scope. Now the till, kitchen and bar, court desk, waiter, shop,
--      manager and owner roles (not dev, driver, marketing), at the branches
--      the caller works at (app.is_staff_at), so a station still reads its
--      own branch.
--
-- covered by packages/db/tests/branch-isolation.test.ts and the role matrix
-- (tests/rls-matrix.ts, principal branch_b_manager)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Staff.
-- ---------------------------------------------------------------------------
create or replace function app.staff_visible_to_me(p_staff_id uuid) returns boolean
language sql stable security definer set search_path = public as $staff_visible_to_me_0400$
  select case
    when auth.uid() is null or p_staff_id is null then false
    when p_staff_id = auth.uid() then true
    when app.is_staff('owner') then true
    when not app.is_staff('manager') then false
    -- An owner works at every branch.
    when exists (select 1 from staff o where o.id = p_staff_id and o.role = 'owner') then true
    else app.shares_branch_with(p_staff_id)
  end
$staff_visible_to_me_0400$;

comment on function app.staff_visible_to_me(uuid) is
  '0400 (F-27). Whether the caller may see staff row p_staff_id: their own row; every row for the owner; for a manager, the owners and anyone who shares a branch (not closed) with them (app.shares_branch_with). False for everyone else. Read by the staff_select policy, app.list_staff and app.clear_pin_lockout.';

revoke all on function app.staff_visible_to_me(uuid) from public;
grant execute on function app.staff_visible_to_me(uuid) to anon, authenticated, service_role;

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff as permissive for select to authenticated
  using ((id = auth.uid())
         or ((select app.is_staff('manager', 'owner')) and app.staff_visible_to_me(id)));

-- list_staff: re-issued from 20260828000051_staff_admin.sql:317, scoped.
create or replace function app.list_staff()
returns table (
  id           uuid,
  display_name text,
  role         staff_role,
  is_active    boolean,
  has_pin      boolean
)
language plpgsql stable security definer set search_path = public as $list_staff_0400$
begin
  -- Raising rather than filtering to an empty set: every other RPC in this
  -- schema refuses out loud, and the authorization sweep reads a refusal as the
  -- pass condition. An RPC that answers "nothing here" to an unauthorised
  -- caller is indistinguishable from one with no guard at all.
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0400 (F-27): a manager lists the people of their own branches.
  return query
    select s.id, s.display_name, s.role, s.is_active, s.pin_hash is not null
      from staff s
     where app.staff_visible_to_me(s.id)
     order by s.is_active desc, s.display_name;
end $list_staff_0400$;

revoke all on function app.list_staff() from public, anon;
grant execute on function app.list_staff() to authenticated;

-- clear_pin_lockout: re-issued from 20260909000086_pin_failure_uniformity.sql:294.
create or replace function app.clear_pin_lockout(p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $clear_lock_0400$
declare
  v_cleared int;
  v_target  staff%rowtype;
begin
  -- The role guard is the FIRST statement, before any argument validation:
  -- check:authz calls every RPC with NULL arguments as a real anonymous guest
  -- and expects a refusal.
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_target from staff where id = p_staff_id;
  -- 0400 (F-27): another branch's person is not found.
  if not found or not app.staff_visible_to_me(p_staff_id) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Only the FAILURES, and only the ones still inside the window. The
  -- successful attempts are the record of who authorised what and are never
  -- touched; older failures are already spent and deleting them would quietly
  -- rewrite how often this person has been locked out.
  delete from app.pin_attempts
   where device_id like p_staff_id::text || ':%'
     and not success
     and attempted_at > now() - interval '5 minutes';
  get diagnostics v_cleared = row_count;

  -- Both scopes: '{uuid}:{device}' (manager authorisations) and
  -- '{uuid}:self:{device}' (the lock screen) both start with the uuid, so the
  -- one prefix covers them. A manager clearing a lock releases the person, not
  -- one of their two limiters.
  perform app.write_audit('staff.pin_lockout_cleared', 'staff', p_staff_id::text,
                          jsonb_build_object('failed_attempts', v_cleared),
                          jsonb_build_object('failed_attempts', 0));

  return jsonb_build_object('cleared', v_cleared);
end $clear_lock_0400$;

comment on function app.clear_pin_lockout(uuid) is
  '0086/SEC-13, 0400. Manager/owner releases a staff member locked out by 5 failed PIN attempts in 5 minutes; a manager only for someone of their own branches (STAFF_NOT_FOUND otherwise). Deletes only in-window FAILED attempts; never reveals, sets or verifies a PIN. Audited as staff.pin_lockout_cleared.';

revoke all on function app.clear_pin_lockout(uuid) from public, anon;
grant execute on function app.clear_pin_lockout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. No branch column: the owner's alone.
-- ---------------------------------------------------------------------------
drop policy if exists sync_replays_mgmt_read on public.sync_replays;
create policy sync_replays_mgmt_read on public.sync_replays as permissive for select to authenticated
  using ((select app.is_staff('owner')));

drop policy if exists telegram_chats_mgmt_read on public.telegram_chats;
create policy telegram_chats_mgmt_read on public.telegram_chats as permissive for select to authenticated
  using ((select app.is_staff('owner')));

drop policy if exists telegram_staff_mgmt_read on public.telegram_staff;
create policy telegram_staff_mgmt_read on public.telegram_staff as permissive for select to authenticated
  using ((select app.is_staff('owner')));

drop policy if exists profile_merges_select_mgmt on app.profile_merges;
create policy profile_merges_select_mgmt on app.profile_merges
  for select to authenticated
  using ((select app.is_staff('owner')));

-- ---------------------------------------------------------------------------
-- 3. kitchen_reach: the roles that send or cook, at their own branches.
--    Re-issued from 20261101000399_kitchen_reach.sql:26.
-- ---------------------------------------------------------------------------
create or replace function app.kitchen_reach(p_since timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $kitchen_reach_0400$
declare
  v_since  timestamptz := greatest(coalesce(p_since, now() - interval '2 hours'), now() - interval '3 hours');
  v_venues uuid[];
begin
  -- 0400 (F-27): not dev, driver or marketing.
  if not app.is_staff('cashier','prep','head_barista','barista','assistant_barista','head_chef','chef',
                      'court_desk','waiter','shop_staff','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0400 (F-27): the branches in scope that the caller works at.
  v_venues := array(select v
                      from unnest((select app.visible_venue_ids())::uuid[]) v
                     where app.is_staff_at(v, 'cashier','prep','head_barista','barista','assistant_barista',
                                           'head_chef','chef','court_desk','waiter','shop_staff','manager','owner'));

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',              r.id,
             'status',          r.status,
             'created_at',      r.created_at,
             'kds_seen_at',     r.kds_seen_at,
             'tab_id',          r.tab_id,
             'idempotency_key', r.idempotency_key)
           order by r.created_at desc)
      from (
        select t.id, t.status, t.created_at, t.kds_seen_at, o.tab_id, o.idempotency_key
          from tickets t
          join orders o on o.id = t.order_id
         where t.venue_id = any (v_venues)
           and t.created_at >= v_since
         order by t.created_at desc
         limit 500
      ) r
  ), '[]'::jsonb);
end $kitchen_reach_0400$;

comment on function app.kitchen_reach(timestamptz) is
  '0399 (F-11), 0400 (F-27). The till, kitchen and bar, court desk, waiter, shop, manager and owner roles (FORBIDDEN for anyone else): the tickets since p_since (at most 3 h back, 500 rows) of the branches in scope the caller works at, each {id, status, created_at, kds_seen_at, tab_id, idempotency_key}: what the operator''s "not received by the kitchen" flag reads on every station. Read-only.';

revoke all on function app.kitchen_reach(timestamptz) from public, anon;
grant execute on function app.kitchen_reach(timestamptz) to authenticated;
