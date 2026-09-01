-- 0058 — OAuth-shaped sign-ups: bootstrap a sane profile from an id token.
--
-- VENDOR ADDITION (2026-09-01). SOW L259-260 excludes social sign-in; the owner
-- decided to add native Sign in with Apple (iOS) + Google, via
-- supabase.auth.signInWithIdToken. Email/password remains the contractual
-- sign-up path and is unchanged by this file.
--
-- WHY: app.handle_new_user (0004) derives full_name from
-- raw_user_meta_data->>'full_name', else the email's local part. GoTrue's
-- id-token flow writes different metadata:
--   * Google: full_name AND name (+ email, picture, avatar_url). Covered by luck
--     -- `full_name` happens to be set -- but `name` alone is the standard OIDC
--     claim and must work too.
--   * Apple: NO name at all (Apple hands it to the app once, never inside the
--     token) and, with Hide My Email, an opaque relay address such as
--     k3x9q2@privaterelay.appleid.com. The 0004 fallback then made 'k3x9q2' the
--     display name -- and the desk treats that as a real guest name:
--     profiles_select lets court_desk / manager / owner read every row and
--     DeskCalendar searches profiles by full_name / phone.
--   * Neither carries a phone.
-- Now a relay address yields full_name = '' (the app's complete-profile step
-- fills it in); the local-part fallback is KEPT for every other email because
-- admin-created staff users rely on it (the staff-admin edge function passes
-- no metadata at all; register_staff writes staff.display_name separately).
-- The phone is trimmed to NULL when absent or blank so the 0059 rule and the
-- desk search see one representation of "no phone".
--
-- Safety: pure function-body replacement -- same name, same signature, same
-- SECURITY DEFINER / search_path -- so the 0004:150 revoke and the 0004:56
-- trigger binding survive untouched (the trigger is deliberately NOT dropped or
-- recreated). No lock beyond the function's own, no table rewrite, no backfill:
-- no OAuth user exists yet, so there is nothing to backfill. The `is_anonymous`
-- early return is preserved -- 0048 (C1) relies on anonymous cafe sessions
-- having NO profiles row -- and so is `on conflict (id) do nothing`.
--
-- Not in types.gen.ts: trigger functions are not exposed through PostgREST, so
-- there is no type regeneration (verified by grep).
--
-- Rollback: re-run the 0004 L35-53 body.

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text  := coalesce(new.email, '');
  v_name  text;
begin
  if coalesce(new.is_anonymous, false) then
    return new;                                -- cafe anonymous sessions: no profile
  end if;

  v_name := coalesce(
    nullif(btrim(v_meta->>'full_name'), ''),                                          -- email/password sign-up; Google
    nullif(btrim(v_meta->>'name'), ''),                                               -- Google `name` claim
    nullif(btrim(concat_ws(' ', v_meta->>'given_name', v_meta->>'family_name')), ''), -- standard OIDC, belt and braces
    case when v_email ilike '%@privaterelay.appleid.com' then null                     -- a relay token is not a name; the app's complete-profile step fills it
         else nullif(split_part(v_email, '@', 1), '') end,                              -- historical fallback kept: admin-created staff users (staff-admin edge fn passes no metadata) rely on it
    '');

  insert into public.profiles (id, full_name, phone, preferred_lang)
  values (
    new.id,
    v_name,
    nullif(btrim(v_meta->>'phone'), ''),
    case when v_meta->>'preferred_lang' in ('en','ar')
         then v_meta->>'preferred_lang' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
-- Grants + trigger binding unchanged (0004:56, 0004:150): replace preserves them.
