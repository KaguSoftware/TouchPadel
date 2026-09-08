-- 0081_staff_global_signout — SEC-35. Deactivating a staff member ends their
-- sessions, not just their permissions.
--
-- WHAT WAS ALREADY TRUE. app.set_staff_active(false) flips is_active and nulls
-- pin_hash, and every role check goes through app.staff_role(), which reads
-- `where id = auth.uid() and is_active`. So a deactivated cashier loses every
-- staff RPC immediately. That is the half the checklist calls "already done".
--
-- WHAT WAS NOT. Their SESSION survives. The refresh token in the till browser
-- keeps minting new access tokens indefinitely, so the account stays signed in,
-- keeps a live Realtime subscription, and keeps whatever a plain `authenticated`
-- principal can reach. For a leaver this is the difference between "cannot
-- authorise a discount" and "is no longer in the building".
--
-- WHY THIS IS THE DATABASE'S JOB AND NOT THE ADMIN API'S. GoTrue's
-- `auth.admin.signOut(jwt, scope)` takes the USER'S OWN token — the caller must
-- already hold it — so it cannot be used to sign out somebody else. Deleting the
-- rows is the operation that actually exists: auth.refresh_tokens CASCADEs from
-- auth.sessions, so one DELETE ends every device that account was signed in on.
-- Doing it inside set_staff_active also makes it ATOMIC with the deactivation;
-- an edge function doing it afterwards can fail in between and leave the two
-- disagreeing.
--
-- HONEST LIMIT, and it is not fixable here. An access token already issued stays
-- valid until it expires — `jwt_expiry = 3600` in config.toml, so up to one hour.
-- Nothing server-side can retract a signed JWT that is already in a browser.
-- What this migration guarantees is that no NEW token can be minted, so the
-- session cannot outlive that hour. Shortening jwt_expiry to 30 minutes is the
-- SEC-05 box in Phase 0 and it is a dashboard setting, not code.
--
-- covered by packages/db/tests/staff-signout.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.revoke_user_sessions — the one place that ends a session server-side.
-- ---------------------------------------------------------------------------
create or replace function app.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql security definer set search_path = public as $revoke_user_sessions_0081$
declare
  v_count integer;
begin
  if p_user_id is null then
    return 0;
  end if;
  -- auth.refresh_tokens cascades from auth.sessions (verified against the live
  -- catalog), so this is the whole job: every device, every refresh token.
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end $revoke_user_sessions_0081$;

comment on function app.revoke_user_sessions(uuid) is
  '0081/SEC-35. Ends every session for one auth user by deleting auth.sessions (auth.refresh_tokens cascades). No new access token can be minted; one already issued remains valid until jwt_expiry. Internal — no client grant; called from app.set_staff_active.';

revoke all on function app.revoke_user_sessions(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_staff_active — re-issued from the 0051 body with the revocation added.
-- ---------------------------------------------------------------------------
-- 0076's lesson: `create or replace` replaces the WHOLE body, so this is the
-- current definition plus one call, not an older body brought forward. The
-- owner guard, the self-edit refusal, the last-owner guard, the PIN clearing and
-- the audit row are all carried over unchanged.
create or replace function app.set_staff_active(
  p_staff_id    uuid,
  p_active      boolean,
  p_reason_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_staff_active_0081$
declare
  v_before  staff%rowtype;
  v_after   staff%rowtype;
  v_revoked integer := 0;
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

  -- 0081/SEC-35. Only on the way DOWN: reactivating somebody must not punish
  -- whatever session they happen to have, and there is nothing to revoke.
  if not v_after.is_active then
    v_revoked := app.revoke_user_sessions(p_staff_id);
  end if;

  perform app.write_audit('staff.active_set', 'staff', p_staff_id::text,
                          jsonb_build_object('is_active', v_before.is_active),
                          jsonb_build_object('is_active', v_after.is_active,
                                             'sessions_revoked', v_revoked),
                          p_reason_code);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'is_active', v_after.is_active,
                            'sessions_revoked', v_revoked);
end $set_staff_active_0081$;

comment on function app.set_staff_active(uuid, boolean, text) is
  '0081 = 0051 + SEC-35. Owner-only. Deactivating also nulls the authorisation PIN and REVOKES every session (auth.sessions delete, refresh tokens cascade), so a leaver is signed out rather than merely unprivileged. An access token already issued stays valid until jwt_expiry.';

revoke all on function app.set_staff_active(uuid, boolean, text) from public, anon;
grant execute on function app.set_staff_active(uuid, boolean, text) to authenticated;
