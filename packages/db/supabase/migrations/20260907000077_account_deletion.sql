-- 0077_account_deletion — app.delete_my_account(), and the FK surgery that
-- makes it possible.
--
-- Both stores require a signed-in user to be able to delete their account from
-- inside the app. This is the database half. It is the migration the
-- social-signin design note (docs/design/social-signin-2026-09-01.md §302)
-- called "mandatory", and it has to be right the first time: there is one
-- Supabase project and it is the venue's live database (D1).
--
-- ---------------------------------------------------------------------------
-- WHY THE OBVIOUS IMPLEMENTATION DESTROYS THE VENUE'S BOOKS
-- ---------------------------------------------------------------------------
--
-- The obvious implementation is `auth.admin.deleteUser(uid)`. Measured against
-- the live schema, here is what that does today:
--
--   profiles.id            -> auth.users  ON DELETE CASCADE   the profile vanishes
--   reservations.guest_id  -> profiles     NO ACTION           <- 23503, DELETE FAILS
--   guest_sessions.auth_user_id -> auth.users NO ACTION        <- 23503, DELETE FAILS
--   customer_notes/flags   -> profiles     ON DELETE CASCADE   silently destroyed
--   notification_outbox    -> profiles     ON DELETE CASCADE   silently destroyed
--
-- So for any guest who has ever booked a court or scanned a table QR the call
-- simply errors; and for a guest who has not, it quietly takes the customer
-- history the venue runs its statistics on. Neither outcome is "delete my
-- account".
--
-- ---------------------------------------------------------------------------
-- THE SHAPE: THE PROFILE ROW OUTLIVES ITS AUTH USER
-- ---------------------------------------------------------------------------
--
-- profiles.id becomes the venue's durable PSEUDONYMOUS guest key. The row stays,
-- stripped of everything that names a person; the auth user — email, phone,
-- raw_user_meta_data, every identity and every session — is destroyed. The
-- booking rows keep a parent, so the reports still add up, and there is nothing
-- left to tie the key to a human being.
--
-- That requires profiles.id to stop being a foreign key at all. No ON DELETE
-- action lets a child row survive its parent: CASCADE removes it, RESTRICT and
-- NO ACTION block the parent's deletion, and SET NULL cannot apply to a primary
-- key. So the constraint is dropped. Profile creation does not weaken as a
-- result — it never came from the FK. It comes from the on_auth_user_created
-- trigger (0004), which is still the only INSERT path: profiles has no INSERT
-- grant and no INSERT policy.
--
-- guest_sessions.auth_user_id gets the same treatment, for a different reason.
-- Its FK is NO ACTION, so it BLOCKS the delete outright — and the row cannot
-- simply be removed instead, because orders.guest_session_id and
-- waiter_calls.guest_session_id are NO ACTION onto it. Deleting a guest's
-- sessions to delete the guest would take the café's sales history with them.
-- Every reader of auth_user_id compares it to auth.uid() for session ownership
-- (0014:264, 0014:292, 0015:180, 0022:189, 0031:187, 0038:206); against a
-- deleted account those comparisons simply stop matching, which is correct.
--
-- ---------------------------------------------------------------------------
-- KEEPING auth.admin.deleteUser HONEST — the tombstone
-- ---------------------------------------------------------------------------
--
-- Dropping profiles_id_fkey would change what deleteUser means EVERYWHERE, and
-- two rollback paths depend on today's meaning: desk-customer-create/index.ts
-- :161 and staff-admin/index.ts:115 both create an auth user, and on a failed
-- follow-up delete it to roll the account back — relying on the cascade to take
-- the half-built profile with it. Without that, a failed desk registration
-- leaves a ghost customer in the search results.
--
-- So the cascade is replaced by an explicit BEFORE DELETE trigger that keeps the
-- old behaviour for every path EXCEPT a guest's own deletion, which is marked by
-- the new profiles.deleted_at tombstone. Self-deletion retains the row; an admin
-- rollback still drops it.
--
-- covered by packages/db/tests/account-deletion.test.ts
--         and packages/db/tests/stored-fields.test.ts (SEC-20)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The tombstone. Nullable, no default: a catalog-only change, no rewrite.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists deleted_at timestamptz;

comment on column profiles.deleted_at is
  'Set by app.delete_my_account. The row is a TOMBSTONE: anonymised, retained only so reservations.guest_id and the venue statistics keep a parent. Never set by hand — the on_auth_user_deleted trigger reads it to tell a self-deletion (row survives) from an admin rollback (row is dropped).';

-- ---------------------------------------------------------------------------
-- 2. Break the two foreign keys that make deletion impossible.
-- ---------------------------------------------------------------------------
alter table profiles       drop constraint if exists profiles_id_fkey;
alter table guest_sessions drop constraint if exists guest_sessions_auth_user_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. Preserve the pre-0077 meaning of auth.admin.deleteUser for every path that
--    is NOT a guest deleting themselves.
-- ---------------------------------------------------------------------------
create or replace function app.handle_user_deleted() returns trigger
language plpgsql security definer set search_path = public as $handle_user_deleted_0077$
begin
  -- A tombstoned row is a completed self-deletion: it is already anonymised and
  -- the booking rows point at it. Leave it alone.
  --
  -- Everything else is an admin path — the desk-customer-create and staff-admin
  -- rollbacks, and test cleanup — which until 0077 got this for free from
  -- profiles_id_fkey ON DELETE CASCADE. Keep that behaviour exactly, including
  -- its failure mode: a profile still referenced by reservations.guest_id
  -- raises 23503 and the whole delete rolls back, precisely as it did before.
  delete from public.profiles where id = old.id and deleted_at is null;
  return old;
end $handle_user_deleted_0077$;

revoke all on function app.handle_user_deleted() from public, anon, authenticated;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function app.handle_user_deleted();

-- ---------------------------------------------------------------------------
-- 4. app.delete_my_account
-- ---------------------------------------------------------------------------
create or replace function app.delete_my_account(p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $delete_my_account_0077$
declare
  v_uid          uuid := auth.uid();
  v_profile      profiles%rowtype;
  v_apple        boolean;
  v_reservations int;
  v_series       int;
  v_notes        int;
  v_flags        int;
  v_outbox       int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no account to delete: handle_new_user (0004)
  -- returns early for is_anonymous, so no profiles row was ever created.
  --
  -- This guard is also what keeps check-rpc-authz.mjs safe. That sweep calls
  -- EVERY RPC granted to `authenticated` with NULL arguments as a real
  -- anonymous guest. Without a refusal on its first line, the authorization
  -- gate would delete the account it probes with, on every run.
  select * into v_profile from profiles where id = v_uid;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Staff are deactivated, never deleted: staff.id -> auth.users is ON DELETE
  -- RESTRICT (0004), and audit_log.actor_id, staff.created_by and
  -- reservations.created_by_staff_id all point at them. Without this the call
  -- would reach the delete and fail there with a raw 23503.
  if exists (select 1 from staff where id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = 'staff accounts are deactivated, not deleted';
  end if;

  if v_profile.deleted_at is not null then
    raise exception 'ALREADY_DELETED' using errcode = 'P0001';
  end if;

  -- Irreversible, and reachable by anything holding the guest's JWT. The
  -- explicit token means a stray retry or an injected fetch cannot spend the
  -- account by calling a bare zero-argument RPC.
  if p_confirm is distinct from 'DELETE' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode = 'P0001',
      hint = 'call with p_confirm => ''DELETE''';
  end if;

  -- Apple requires POST https://appleid.apple.com/auth/revoke when an account
  -- offering Sign in with Apple is deleted. The .p8 key does not exist yet
  -- (blocked on Apple Developer enrolment), so the obligation is RECORDED
  -- rather than silently skipped — the deletion itself must not be held hostage
  -- to a missing credential.
  select exists (select 1 from auth.identities
                  where user_id = v_uid and provider = 'apple')
    into v_apple;

  -- --- the anonymisation ----------------------------------------------------
  --
  -- Everything below removes a column that names or reaches a PERSON. Columns
  -- carrying business value — times, prices, courts, statuses, totals — are
  -- deliberately untouched, which is the entire point of retaining the row.

  -- The profile itself. expo_push_token is cleared here (SEC-21: cleared on
  -- deletion), which is also the only remaining way to reach the device.
  update profiles
     set full_name       = 'Deleted account',
         phone           = null,
         expo_push_token = null,
         deleted_at      = now()
   where id = v_uid;

  -- Denormalised identity on the booking rows. THIS IS THE HALF THAT IS EASY TO
  -- MISS: reservations and reservation_series each carry their OWN guest_name
  -- and guest_phone beside guest_id, and nothing constrains the two to be
  -- mutually exclusive — app.confirm_booking writes
  -- `guest_name = coalesce(p_guest_name, guest_name)` whatever guest_id holds,
  -- and app.create_series takes p_guest_name the same way.
  --
  -- No client ships that argument TODAY: the mobile app calls confirm_booking
  -- with p_hold_id alone, so an app-made booking leaves both columns null, and
  -- only the test suite currently passes a name alongside a guest_id. The desk
  -- surface that would do it for a walk-in with an account is the obvious next
  -- feature. Scrubbing here is therefore mostly forward defence — but it is the
  -- difference between a deletion that stays complete and one that silently
  -- stops being complete the day that screen is built, which is exactly the
  -- kind of regression nobody re-audits.
  update reservations
     set guest_name = null, guest_phone = null, notes = null, device_id = null
   where guest_id = v_uid;
  get diagnostics v_reservations = row_count;

  update reservation_series
     set guest_name = null, guest_phone = null, notes = null
   where guest_id = v_uid;
  get diagnostics v_series = row_count;

  -- Records ABOUT the person, with no aggregate value: staff free text and
  -- labels, and queued notifications addressed to a device that is now
  -- unreachable. These used to CASCADE from profiles; now that the profile row
  -- survives, they have to be removed explicitly or they would outlive it.
  delete from customer_notes where customer_id = v_uid;
  get diagnostics v_notes = row_count;

  delete from customer_flags where customer_id = v_uid;
  get diagnostics v_flags = row_count;

  delete from notification_outbox where profile_id = v_uid;
  get diagnostics v_outbox = row_count;

  -- The audit row is written BEFORE the auth user goes, while auth.uid() still
  -- resolves for write_audit's actor_id.
  --
  -- It deliberately carries NO before-image. to_jsonb(profile) would write the
  -- full_name and phone this function exists to erase into an append-only table
  -- that manager and owner can read — reintroducing the data one row further
  -- down. What is recorded is the SHAPE of the deletion: enough to prove it
  -- happened and what it touched, nothing that identifies who.
  perform app.write_audit(
    'account.delete', 'profiles', v_uid::text,
    jsonb_build_object(
      'had_phone',      v_profile.phone is not null,
      'had_push_token', v_profile.expo_push_token is not null,
      'created_at',     v_profile.created_at),
    jsonb_build_object(
      'reservations_anonymised', v_reservations,
      'series_anonymised',       v_series,
      'customer_notes_deleted',  v_notes,
      'customer_flags_deleted',  v_flags,
      'outbox_deleted',          v_outbox,
      'apple_revoke_pending',    v_apple),
    'guest_request');

  -- The global sign-out, and the destruction of the identity itself.
  --
  -- auth.sessions CASCADEs from auth.users and auth.refresh_tokens CASCADEs from
  -- auth.sessions, so every token ever issued to this account dies with this one
  -- statement — a refresh token captured an hour ago can no longer mint a JWT.
  -- It also takes auth.identities (the Apple / Google link) and the email, phone
  -- and raw_user_meta_data, which is where full_name and phone were duplicated.
  --
  -- The on_auth_user_deleted trigger fires here and does nothing: deleted_at was
  -- stamped above, so the tombstone is left standing.
  delete from auth.users where id = v_uid;

  return jsonb_build_object(
    'deleted',              true,
    'profile_id',           v_uid,
    'apple_revoke_pending', v_apple);
end $delete_my_account_0077$;

comment on function app.delete_my_account(text) is
  'Store-mandated in-app account deletion. Destroys the auth user (which cascades every session, refresh token and identity — this IS the global sign-out) and leaves profiles as an anonymised tombstone so reservations.guest_id and the venue statistics keep a parent. Refuses an anonymous session (ACCOUNT_REQUIRED), a staff account (FORBIDDEN — staff are deactivated) and any call without p_confirm => ''DELETE''. Apple''s /auth/revoke is NOT called: no .p8 key exists yet, so the audit row records apple_revoke_pending instead.';

revoke all on function app.delete_my_account(text) from public, anon;
grant execute on function app.delete_my_account(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. SEC-21 — narrow the profiles SELECT grant to exclude expo_push_token.
-- ---------------------------------------------------------------------------
--
-- 0004:160 is a bare `grant select on profiles to authenticated` — the WHOLE
-- table — and profiles_select (0004:163) admits
-- `id = auth.uid() or app.is_staff('court_desk','manager','owner')`.
--
-- A café guest holds `authenticated`, exactly as staff do. So every court_desk,
-- manager and owner session can read every guest's expo_push_token today: the
-- one credential needed to push an arbitrary notification to that guest's phone.
-- The checklist called this box "guest-only read", which is not what the
-- migration does.
--
-- The fix is the column-level grant `staff` has had since 0004:171, which is
-- exactly how pin_hash is kept unreadable by clients. UPDATE(expo_push_token)
-- stays: the app must still register a token. The column becomes write-only to
-- clients, and only the service role (send-push) ever reads it back.
--
-- Nothing else selects it. apps/mobile/src/features/profile/api.ts:21 listed it
-- in fetchOwnProfile and no consumer ever read the value; that select is
-- narrowed in the same commit. No view depends on profiles (0 rows).
revoke select on profiles from authenticated;
grant select (id, full_name, phone, preferred_lang, created_at)
  on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Keep tombstones out of the desk's customer search.
-- ---------------------------------------------------------------------------
--
-- Re-issued from the 0065 body (verified unchanged since — customer_search
-- appears in no later migration) with ONE added predicate. 0076's lesson: a
-- `create or replace` replaces the whole body, so this is a merge onto the
-- CURRENT definition, not a re-application of an old one.
--
-- Without it a deleted guest still answers the desk search as "Deleted account"
-- with a live booking count, which reads as a real customer who cannot be
-- contacted.
create or replace function app.customer_search(p_query text, p_limit int default 12)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $customer_search_0077$
declare
  v_query  text := btrim(coalesce(p_query, ''));
  v_name   text;
  v_digits text;
  v_email  text;
  v_limit  int  := least(greatest(coalesce(p_limit, 12), 1), 50);
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- One character matches half the venue; the screen's `idle` state covers it.
  if length(v_query) < 2 then
    return;
  end if;

  v_name   := app.like_escape(replace(app.search_norm(v_query), ' ', ''));
  v_digits := app.phone_digits(v_query);
  v_email  := app.like_escape(lower(v_query));

  return query
    select jsonb_build_object(
             'id',             p.id,
             'full_name',      p.full_name,
             'phone',          p.phone,
             'email',          u.email,
             'preferred_lang', p.preferred_lang,
             'flags',          app.customer_flags_json(p.id),
             'counts',         app.customer_counts(p.id))
      from profiles p
      left join auth.users u on u.id = p.id
     where p.deleted_at is null                          -- 0077: not a tombstone
       and ((v_name <> ''
             and replace(app.search_norm(p.full_name), ' ', '') like '%' || v_name || '%')
        or (v_digits is not null and length(v_digits) >= 3
            and app.phone_digits(p.phone) like '%' || v_digits || '%')
        or ((position('@' in v_query) > 0 or length(v_query) >= 3)
            and u.email is not null and lower(u.email) like '%' || v_email || '%'))
     order by
       -- prefix hits first, then substring hits, then by name
       case
         when v_name <> '' and replace(app.search_norm(p.full_name), ' ', '') like v_name || '%' then 0
         when v_digits is not null and app.phone_digits(p.phone) like v_digits || '%' then 1
         else 2
       end,
       p.full_name,
       p.created_at desc
     limit v_limit;
end $customer_search_0077$;

revoke all on function app.customer_search(text, int) from public, anon;
grant execute on function app.customer_search(text, int) to authenticated;
