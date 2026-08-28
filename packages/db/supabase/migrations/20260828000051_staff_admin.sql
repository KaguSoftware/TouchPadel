-- ---------------------------------------------------------------------------
-- 0051 — staff administration by the owner role.
--
-- SOW L234: "Staff accounts created and managed by the owner role." It is also
-- a PHASE acceptance condition (L997, "every role sees only what its permission
-- set allows"), and 0004:175-176 said the RPCs would "land with the admin drop"
-- — they never did. `/admin/staff` has been a read-only table whose own header
-- says invites stay in the Supabase dashboard, which is the opposite of what
-- was signed.
--
-- Account CREATION needs the GoTrue admin API, so it lives in the `staff-admin`
-- edge function (service role, owner-gated). Everything that is only a row
-- change lives here, where `app.is_staff('owner')` and `app.write_audit` are
-- the same guard and the same trail as every other mutation.
--
-- One invariant matters above the rest: the venue must never end up with zero
-- active owners, because `app.is_staff('owner')` is the only key to this whole
-- family of functions and there is no way back in from inside the product.
--
-- It is enforced by CANNOT_EDIT_SELF. `app.staff_role()` reads
-- `where id = auth.uid() and is_active` (0010), so any caller that reaches these
-- guards IS an active owner; if they may not target themselves, then whoever
-- they do target leaves them behind, and the count never reaches zero.
--
-- The LAST_OWNER checks below are therefore UNREACHABLE through the client path
-- today, and are kept deliberately as a backstop: they are the thing that still
-- holds if a future service-role or migration caller ever bypasses the self
-- check. They are documented as unreachable rather than tested as if they were
-- live — see packages/db/tests/staff-admin.test.ts.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Helper: how many active owners would remain if this staff row stopped being
-- an active owner. Definer, no grants — used by the two guards below.
-- ---------------------------------------------------------------------------
create or replace function app.other_active_owners(p_staff_id uuid) returns int
language sql stable security definer set search_path = public as $other_owners$
  select count(*)::int
    from staff
   where role = 'owner' and is_active and id <> p_staff_id
$other_owners$;

revoke all on function app.other_active_owners(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. app.set_staff_role — change a staff member's role.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_role(
  p_staff_id    uuid,
  p_role        staff_role,
  p_reason_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_role$
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

  if v_before.role = 'owner' and p_role <> 'owner' and app.other_active_owners(p_staff_id) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001',
      hint = 'promote another owner first';
  end if;

  update staff
     set role = p_role,
         -- A PIN only exists for managers and owners (0026). Dropping below
         -- that leaves a live credential attached to someone who can no longer
         -- authorise anything, so clear it in the same statement.
         pin_hash = case when p_role in ('manager','owner') then pin_hash else null end
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
end $set_role$;

revoke all on function app.set_staff_role(uuid, staff_role, text) from public, anon;
grant execute on function app.set_staff_role(uuid, staff_role, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.set_staff_active — the venue's "remove a staff member".
--
--    Deliberately NOT a delete: `staff.id` is referenced by audit trails and by
--    `created_by`, and a trading record must stay attributable to the person who
--    made it. Deactivating also stops sign-in, because `fetchStaff` in the
--    operator refuses an inactive row and every `app.is_staff` guard requires it.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_active(
  p_staff_id    uuid,
  p_active      boolean,
  p_reason_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_active$
declare
  v_before staff%rowtype;
  v_after  staff%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'CANNOT_EDIT_SELF' using errcode = 'P0001',
      hint = 'another owner must deactivate your own account';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_before.role = 'owner' and not coalesce(p_active, false)
     and app.other_active_owners(p_staff_id) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001',
      hint = 'promote another owner first';
  end if;

  update staff
     set is_active = coalesce(p_active, false),
         -- A deactivated account must not keep a usable authorisation PIN.
         pin_hash = case when coalesce(p_active, false) then pin_hash else null end
   where id = p_staff_id
   returning * into v_after;

  perform app.write_audit('staff.active_set', 'staff', p_staff_id::text,
                          jsonb_build_object('is_active', v_before.is_active),
                          jsonb_build_object('is_active', v_after.is_active),
                          p_reason_code);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'is_active', v_after.is_active);
end $set_active$;

revoke all on function app.set_staff_active(uuid, boolean, text) from public, anon;
grant execute on function app.set_staff_active(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.rename_staff — the display name every audit row is read through.
-- ---------------------------------------------------------------------------
create or replace function app.rename_staff(p_staff_id uuid, p_display_name text)
returns jsonb
language plpgsql security definer set search_path = public as $rename_staff$
declare
  v_name   text := btrim(coalesce(p_display_name, ''));
  v_before staff%rowtype;
  v_after  staff%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001',
      hint = 'display name must be 1-80 characters';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  update staff set display_name = v_name where id = p_staff_id returning * into v_after;

  perform app.write_audit('staff.rename', 'staff', p_staff_id::text,
                          jsonb_build_object('display_name', v_before.display_name),
                          jsonb_build_object('display_name', v_after.display_name));

  return jsonb_build_object('id', v_after.id, 'display_name', v_after.display_name);
end $rename_staff$;

revoke all on function app.rename_staff(uuid, text) from public, anon;
grant execute on function app.rename_staff(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.clear_staff_pin — revoke an authorisation PIN without touching the role.
--    (`set_staff_pin` from 0026 sets one; there was no way to take one away.)
-- ---------------------------------------------------------------------------
create or replace function app.clear_staff_pin(p_staff_id uuid) returns void
language plpgsql security definer set search_path = public as $clear_pin$
declare v_had boolean;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select pin_hash is not null into v_had from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  update staff set pin_hash = null where id = p_staff_id;

  -- Audit the CHANGE, never the PIN — same rule as set_staff_pin (0026).
  perform app.write_audit('staff.pin_cleared', 'staff', p_staff_id::text,
                          jsonb_build_object('had_pin', v_had),
                          jsonb_build_object('had_pin', false));
end $clear_pin$;

revoke all on function app.clear_staff_pin(uuid) from public, anon;
grant execute on function app.clear_staff_pin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.register_staff — attach a staff row to an ALREADY-CREATED auth user.
--
--    Called by the `staff-admin` edge function immediately after
--    `auth.admin.createUser`, with `p_actor_id` naming the owner who asked for
--    it: the function runs as the service role, which has no JWT, so
--    `auth.uid()` would be null and the audit row would have no actor. Every
--    other authorisation decision has already been made by the edge function's
--    `requireStaffRole(req, service, ['owner'])`.
--
--    Definer with NO client grant — an operator cannot call this directly, and
--    could not use it if they did, since it presumes the auth user exists.
-- ---------------------------------------------------------------------------
create or replace function app.register_staff(
  p_staff_id     uuid,
  p_display_name text,
  p_role         staff_role,
  p_actor_id     uuid
) returns jsonb
language plpgsql security definer set search_path = public as $register_staff$
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

  insert into staff (id, display_name, role, is_active, created_by)
  values (p_staff_id, v_name, p_role, true, p_actor_id)
  returning * into v_row;

  -- The service role has no JWT, so auth.uid() is null here; name the owner
  -- explicitly rather than record an unattributable account creation.
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, 'owner', 'staff.create', 'staff', p_staff_id::text, null,
          jsonb_build_object('display_name', v_row.display_name, 'role', v_row.role));

  return jsonb_build_object('id', v_row.id, 'display_name', v_row.display_name,
                            'role', v_row.role, 'is_active', v_row.is_active);
end $register_staff$;

revoke all on function app.register_staff(uuid, text, staff_role, uuid) from public, anon, authenticated;
-- The staff-admin edge function is the ONLY caller, and it holds the service
-- role. Functions do not inherit the blanket table grants in 0012, so this has
-- to be explicit — without it the create path fails with 42501 after the auth
-- user has already been made.
grant execute on function app.register_staff(uuid, text, staff_role, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. app.audit_staff_password_reset — audit row for the one action that can
--    only happen through the GoTrue admin API.
--
--    `app.write_audit_external` (0039) deliberately writes `actor_id = null`,
--    which is right for Telegram (the tapper is not an auth user) and wrong
--    here: a password reset MUST name the owner who performed it, or the log
--    fails the "traceable to a named actor" test for the most sensitive action
--    an owner can take. Definer, no client grant — the edge function calls it
--    with the service role after `requireStaffRole(..., ['owner'])`.
-- ---------------------------------------------------------------------------
create or replace function app.audit_staff_password_reset(
  p_staff_id uuid,
  p_actor_id uuid
) returns void
language plpgsql security definer set search_path = public as $audit_pwd$
declare v_name text;
begin
  select display_name into v_name from staff where id = p_staff_id;
  if v_name is null then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- The password itself is never written, only the fact of the change.
  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, 'owner', 'staff.password_reset', 'staff', p_staff_id::text, null,
          jsonb_build_object('display_name', v_name));
end $audit_pwd$;

revoke all on function app.audit_staff_password_reset(uuid, uuid) from public, anon, authenticated;
grant execute on function app.audit_staff_password_reset(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. app.list_staff — the roster the admin screen renders.
--
--    Exists because `pin_hash` is deliberately NOT in the client column grant
--    (0004:170, "pin_hash is NEVER readable by clients"), and the screen still
--    has to show whether a PIN is set. Selecting the column from the browser
--    would both fail on that grant and, if it ever succeeded, hand a bcrypt
--    hash of a 4-6 digit secret to a machine that can brute-force it offline in
--    seconds. So the boolean is computed here and the hash never leaves.
--
--    Manager-readable as well as owner: managers already see the roster through
--    the plain `staff` select policy (0004:173-174), and this returns strictly
--    less than that plus one boolean. Only OWNERS can change anything.
-- ---------------------------------------------------------------------------
create or replace function app.list_staff()
returns table (
  id           uuid,
  display_name text,
  role         staff_role,
  is_active    boolean,
  has_pin      boolean
)
language plpgsql stable security definer set search_path = public as $list_staff$
begin
  -- Raising rather than filtering to an empty set: every other RPC in this
  -- schema refuses out loud, and the authorization sweep reads a refusal as the
  -- pass condition. An RPC that answers "nothing here" to an unauthorised
  -- caller is indistinguishable from one with no guard at all.
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
    select s.id, s.display_name, s.role, s.is_active, s.pin_hash is not null
      from staff s
     order by s.is_active desc, s.display_name;
end $list_staff$;

revoke all on function app.list_staff() from public, anon;
grant execute on function app.list_staff() to authenticated;
