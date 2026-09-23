-- 0153_terms_consent — a record that the guest agreed to the Terms of Service
-- and read the Privacy Policy, and which version they agreed to.
--
-- Until now sign-up showed a privacy link and nothing else: no Terms existed and
-- nothing proved a guest had accepted anything. The Terms page
-- (apps/web/app/[locale]/terms) carries the booking, cancellation, venue-risk
-- and liability rules; they only bind a guest who accepted them, and the only
-- evidence of that is a row that says when and which version.
--
-- THE SHAPE
--
--   profiles.terms_version      the version string the guest accepted
--                               (CURRENT_TERMS_VERSION in packages/core/src/legal.ts)
--   profiles.terms_accepted_at  when, stamped by the server clock
--
-- Both nullable: every existing profile starts at null and meets the app's
-- consent screen on its next launch, exactly as a guest does after a version
-- bump. Apple and Google sign-ups never see the sign-up form, and desk-created
-- customers never see the app at all until they sign in — the gate, not the
-- form, is what reaches all three.
--
-- NOT PERSONAL DATA, AND KEPT ON DELETION. A version string and a timestamp
-- identify nobody, and app.delete_my_account (0077) leaves the anonymised
-- tombstone standing; the consent record staying on it is the proof that the
-- terms applied to the bookings the venue retains. 0077 is therefore NOT
-- re-issued. stored-fields.test.ts declares both columns non-personal.
--
-- covered by packages/db/tests/terms-consent.test.ts and tests/rls-matrix.ts (drop 16)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Columns. Nullable, no default: catalog-only, no table rewrite.
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists terms_version     text;
alter table profiles add column if not exists terms_accepted_at timestamptz;

comment on column profiles.terms_version is
  'The Terms of Service / Privacy Policy version the guest last accepted (CURRENT_TERMS_VERSION in packages/core/src/legal.ts). Written only by app.accept_terms. Null = never accepted; the app shows its consent screen.';
comment on column profiles.terms_accepted_at is
  'Server time app.accept_terms recorded the acceptance of terms_version. Retained on the 0077 tombstone as proof the terms applied.';

-- A version is a short date-like tag, never free text a guest could fill.
do $terms_version_check_0153$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_terms_version_format'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table profiles add constraint profiles_terms_version_format
      check (terms_version is null or terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$')
      not valid;
  end if;
end $terms_version_check_0153$;

alter table profiles validate constraint profiles_terms_version_format;

-- ---------------------------------------------------------------------------
-- 2. The guest may READ their own acceptance (the app's gate compares it with
--    the current version). There is no UPDATE grant: the RPC below is the only
--    write path, so the timestamp is always the server's, never the device's.
-- ---------------------------------------------------------------------------
grant select (terms_version, terms_accepted_at) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.accept_terms
-- ---------------------------------------------------------------------------
create or replace function app.accept_terms(p_version text default null)
returns jsonb
language plpgsql security definer set search_path = public as $accept_terms_0153$
declare
  v_uid uuid := auth.uid();
  v_at  timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no profile (0004 skips is_anonymous), and a
  -- deleted account is a tombstone: neither has anyone to bind to the terms.
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  if p_version is null
     or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$' then
    raise exception 'VERSION_INVALID' using errcode = 'P0001';
  end if;

  update profiles
     set terms_version     = p_version,
         terms_accepted_at = now()
   where id = v_uid
  returning terms_accepted_at into v_at;

  return jsonb_build_object('terms_version', p_version, 'terms_accepted_at', v_at);
end $accept_terms_0153$;

comment on function app.accept_terms(text) is
  'Records that the calling account accepted Terms/Privacy version p_version, stamped with the server clock. Refuses an anonymous café session and a deleted account (ACCOUNT_REQUIRED) and a malformed version (VERSION_INVALID). The only write path to profiles.terms_version / terms_accepted_at.';

revoke all on function app.accept_terms(text) from public, anon;
grant execute on function app.accept_terms(text) to authenticated;
