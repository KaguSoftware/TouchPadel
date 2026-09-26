set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0218_staff_membership_fix — multi-venue slice 3, step 4.
--
-- 0123's trigger (R4) gave every new or re-roled non-owner a staff_venues row
-- at app.default_venue(). Right for slice 1 (one venue), wrong the day a
-- second branch has staff: a venue-B barista whose role changes gets a venue-A
-- membership as well, app.resolve_venue then sees two memberships and returns
-- null, and every write that person makes raises VENUE_REQUIRED.
--
--   * trg_staff_default_venue: a staffer who already has memberships keeps
--     them (a role change updates the role on those rows only); a staffer with
--     none (a new account, or an owner demoted) gets one at the resolved venue:
--     app.venue_id when the writer asserted it (register_staff below), else the
--     station or only membership of the caller, else the default branch.
--   * register_staff gains p_venue_id (the staff-admin edge function passes the
--     branch the owner picked); it asserts app.venue_id so the trigger files
--     the membership there.
--   * app.set_staff_venues(p_staff_id, p_venue_ids): owner-only, the branches a
--     non-owner works at (at least one). Audited as staff.venues.
--
-- MIGRATION-RISK-ACCEPTED: none needed (function bodies only).

-- ---------------------------------------------------------------------------
-- 1. The trigger (0123 body)
-- ---------------------------------------------------------------------------
create or replace function app.trg_staff_default_venue() returns trigger
language plpgsql security definer set search_path = public as $trg_staff_default_venue_0218$
declare
  v_venue uuid;
begin
  if new.role = 'owner' then
    -- An owner is the platform, not a member. A promotion clears the rows the
    -- person held as a manager.
    delete from staff_venues where staff_id = new.id;
    return new;
  end if;

  -- 0218: memberships already held stay where they are; only the role moves.
  if exists (select 1 from staff_venues where staff_id = new.id) then
    update staff_venues set role = new.role
     where staff_id = new.id and role is distinct from new.role;
    return new;
  end if;

  -- No membership yet: the asserted venue (register_staff sets app.venue_id),
  -- else the caller's resolved venue, else the default branch.
  v_venue := coalesce(app.resolve_venue(), app.default_venue());
  -- No venue yet (only reachable on a database built before 0122): do nothing
  -- rather than refuse the staff write.
  if v_venue is null then
    return new;
  end if;

  insert into staff_venues (staff_id, venue_id, role)
  values (new.id, v_venue, new.role)
  on conflict (staff_id, venue_id) do update set role = excluded.role;

  return new;
end
$trg_staff_default_venue_0218$;

comment on function app.trg_staff_default_venue() is
  '0123, 0218. After insert or role change on staff: an owner holds no memberships; a non-owner with memberships keeps them (role updated); one with none gets a membership at the asserted venue (app.venue_id), else the caller''s resolved venue, else the default branch.';

revoke all on function app.trg_staff_default_venue() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. register_staff (0051 body) gains p_venue_id
-- ---------------------------------------------------------------------------
drop function if exists app.register_staff(uuid, text, staff_role, uuid);

create or replace function app.register_staff(
  p_staff_id     uuid,
  p_display_name text,
  p_role         staff_role,
  p_actor_id     uuid,
  p_venue_id     uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $register_staff_0218$
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
end $register_staff_0218$;

comment on function app.register_staff(uuid, text, staff_role, uuid, uuid) is
  '0051, 0218. Service role only (staff-admin): the staff row for a freshly created auth user, audited as staff.create by p_actor_id. p_venue_id is the branch a non-owner works at (default: the default branch, through the membership trigger).';

revoke all on function app.register_staff(uuid, text, staff_role, uuid, uuid) from public, anon, authenticated;
grant execute on function app.register_staff(uuid, text, staff_role, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The owner assigns branches
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_venues(p_staff_id uuid, p_venue_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $set_staff_venues_0218$
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
end $set_staff_venues_0218$;

comment on function app.set_staff_venues(uuid, uuid[]) is
  '0218. Owner-only: the branches a non-owner staff member works at (replaces the set; at least one, STAFF_VENUE_REQUIRED). Two memberships make the person pick a branch (station or switcher) for every write. Audited as staff.venues.';

revoke all on function app.set_staff_venues(uuid, uuid[]) from public, anon;
grant execute on function app.set_staff_venues(uuid, uuid[]) to authenticated;
