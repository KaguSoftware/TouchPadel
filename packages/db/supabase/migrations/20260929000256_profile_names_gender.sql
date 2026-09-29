set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0256 profile_names_gender — open matches, lane Guest on DB's contract
-- (docs/design/open-matches/guest.md §4.5, db.md §4.2, build contracts §1.2).
--
-- Players of an open match see each other as "First I." (OM-26), and a
-- women's or men's match needs to know who may join (OM-28, OM-39). So:
--
--   1. profiles gains given_name, family_name (each 1..39, so the pair joined
--      by one space is at most 79 and profiles_full_name_len holds), and
--      gender (female | male) with gender_set_at and gender_set_by, the three
--      set together. Plain nullable columns: no rewrite.
--   2. app.split_person_name(text) splits a whole name into {given, family}.
--   3. The sanitiser (0080) cleans the two parts as it cleans full_name.
--   4. profiles_sync_names keeps full_name and the parts in step: the parts
--      win when they change, a full_name written alone (older builds, desk
--      customers, staff edits) is split again, and a tombstone (0077) loses the
--      five new columns, so account deletion erases them from this file on.
--   5. handle_new_user (0069) stores the sign-up's two metadata parts when they
--      rebuild the name exactly; otherwise the trigger splits the name.
--   6. Existing profiles are backfilled with full_name byte-for-byte kept.
--   7. A guest may read the five columns and write the two name parts; only
--      app.set_my_gender (below) and staff_set_customer_gender (0262) write
--      gender, stamping all three columns.
--
-- The phone reads the new columns from a later build (landing order push C2):
-- a build that selects given_name before this file is on hosted fails.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists given_name    text;
alter table profiles add column if not exists family_name   text;
alter table profiles add column if not exists gender        text;
alter table profiles add column if not exists gender_set_at timestamptz;
alter table profiles add column if not exists gender_set_by text;

-- ---------------------------------------------------------------------------
-- 2. app.split_person_name — {given, family} from one whole name
-- ---------------------------------------------------------------------------
-- Whitespace-separated tokens. The given name is the first token, or the first
-- two when the first is a compound prefix (عبد, ابو, abd, abdul, abdel, abdal,
-- abu, abou; hamza forms of the alif folded) and a second token exists, or the
-- first three for "Abd al Rahman" / "عبد ال رحمن". The family name is the
-- rest. Each part is clamped to 39 characters, so an 80-character legacy name
-- never breaks the length CHECKs. NULL, empty or blank gives {NULL, NULL}.
-- plpgsql with a SET clause: never inlined, so the revoke below holds on a
-- pooled connection (sql-helpers-not-inlinable.test.ts).
create or replace function app.split_person_name(p text) returns text[]
language plpgsql immutable set search_path = public as $split_person_name_0256$
declare
  v_tokens text[];
  v_count  int;
  v_n      int := 1;
  v_first  text;
begin
  if p is null or btrim(regexp_replace(p, '\s+', ' ', 'g')) = '' then
    return array[null, null]::text[];
  end if;
  v_tokens := regexp_split_to_array(btrim(regexp_replace(p, '\s+', ' ', 'g')), ' ');
  v_count  := cardinality(v_tokens);
  v_first  := translate(lower(v_tokens[1]), 'أإآ', 'ااا');
  if v_count >= 2
     and v_first in ('عبد', 'ابو', 'abd', 'abdul', 'abdel', 'abdal', 'abu', 'abou') then
    v_n := 2;
    if v_count >= 3 and lower(v_tokens[2]) in ('al', 'el', 'ال') then
      v_n := 3;
    end if;
  end if;
  return array[
    nullif(rtrim(left(array_to_string(v_tokens[1:v_n], ' '), 39)), ''),
    nullif(rtrim(left(array_to_string(v_tokens[v_n + 1:v_count], ' '), 39)), '')
  ]::text[];
end $split_person_name_0256$;

comment on function app.split_person_name(text) is
  '0256. {given, family} from one whole name: the first token (two or three after a compound prefix such as عبد, ابو, Abd, Abu, and "Abd al"), then the rest, each clamped to 39 characters; {NULL, NULL} for a blank name. Internal: the name trigger, the sign-up trigger, the backfill and typed desk names (0260).';

revoke all on function app.split_person_name(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The sanitiser: re-issued from 20260907000080_guest_text_sanitising.sql:130
--    with the two name parts.
-- ---------------------------------------------------------------------------
create or replace function app.trg_sanitise_profile() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_profile_0256$
begin
  -- full_name is NOT NULL: safe_line never turns a non-null into a null, so a
  -- name made entirely of control characters becomes '' and is refused by the
  -- same rules that already refuse an empty name, not by a constraint violation
  -- the guest cannot interpret.
  new.full_name := coalesce(app.safe_line(new.full_name), '');
  new.phone     := app.safe_line(new.phone);
  -- 0256: the name parts are single-line fields too. NULL stays NULL; a part
  -- made only of controls becomes '', which profiles_sync_names turns to NULL.
  new.given_name  := app.safe_line(new.given_name);
  new.family_name := app.safe_line(new.family_name);
  return new;
end $trg_sanitise_profile_0256$;

revoke all on function app.trg_sanitise_profile() from public, anon, authenticated;

drop trigger if exists profiles_sanitise on profiles;
create trigger profiles_sanitise
  before insert or update of full_name, phone, given_name, family_name on profiles
  for each row execute function app.trg_sanitise_profile();

-- ---------------------------------------------------------------------------
-- 4. profiles_sync_names — full_name and the parts kept in step
-- ---------------------------------------------------------------------------
-- BEFORE, and named to sort after profiles_sanitise, so it sees clean text.
-- The first matching rule wins:
--   1. a tombstone (deleted_at set, the 0077 UPDATE): the five new columns go;
--   2. app.skip_name_sync = 'on' (the backfill below only): nothing;
--   3. always, before 4-6: an empty part is NULL;
--   4. INSERT without a given name: the parts are split from full_name;
--   5. INSERT with a given name, or UPDATE that changes a part: full_name is
--      the parts joined by one space (the parts win, also when full_name was
--      written in the same UPDATE);
--   6. UPDATE that changes full_name alone: the parts are split again.
-- An UPDATE that lists a column without changing it matches no rule.
create or replace function app.trg_profile_names() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_names_0256$
declare
  v_parts text[];
begin
  if new.deleted_at is not null then
    new.given_name    := null;
    new.family_name   := null;
    new.gender        := null;
    new.gender_set_at := null;
    new.gender_set_by := null;
    return new;
  end if;

  if current_setting('app.skip_name_sync', true) = 'on' then
    return new;
  end if;

  new.given_name  := nullif(new.given_name, '');
  new.family_name := nullif(new.family_name, '');

  if tg_op = 'INSERT' then
    if new.given_name is null then
      v_parts         := app.split_person_name(new.full_name);
      new.given_name  := v_parts[1];
      new.family_name := v_parts[2];
    else
      new.full_name := concat_ws(' ', new.given_name, new.family_name);
    end if;
    return new;
  end if;

  if new.given_name is distinct from old.given_name
     or new.family_name is distinct from old.family_name then
    new.full_name := concat_ws(' ', new.given_name, new.family_name);
  elsif new.full_name is distinct from old.full_name then
    v_parts         := app.split_person_name(new.full_name);
    new.given_name  := v_parts[1];
    new.family_name := v_parts[2];
  end if;
  return new;
end $trg_profile_names_0256$;

comment on function app.trg_profile_names() is
  '0256. Trigger profiles_sync_names: keeps full_name and given_name/family_name in step (the parts win when they change; full_name alone is split again), NULLs an empty part, and empties the five name and gender columns on the 0077 tombstone. Skipped while app.skip_name_sync = on (the 0256 backfill only).';

revoke all on function app.trg_profile_names() from public, anon, authenticated;

drop trigger if exists profiles_sync_names on profiles;
create trigger profiles_sync_names
  before insert or update of full_name, given_name, family_name, deleted_at on profiles
  for each row execute function app.trg_profile_names();

-- ---------------------------------------------------------------------------
-- 5. Signup trigger: re-issued from 20260905000069_phone_otp_base.sql:204
--    verbatim, with the two metadata name parts.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $handle_new_user_0256$
declare
  v_meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email  text  := coalesce(new.email, '');
  v_name   text;
  v_phone  text;
  v_given  text;
  v_family text;
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

  -- 0069: a phone sign-up (GoTrue signInWithOtp) has no metadata; the verified
  -- number sits in auth.users.phone as digits without '+'. Metadata still wins
  -- when present (the email/password form sends it).
  v_phone := coalesce(
    nullif(btrim(v_meta->>'phone'), ''),
    case when nullif(btrim(coalesce(new.phone, '')), '') is not null
         then '+' || app.phone_digits(new.phone) end);

  -- 0256: the sign-up's two name parts, clamped to 39, only when they rebuild
  -- the resolved name exactly. A given_name without its surname (or parts that
  -- disagree with full_name) must not cut the stored name short: both stay
  -- NULL and profiles_sync_names splits v_name instead.
  v_given  := nullif(rtrim(left(btrim(v_meta->>'given_name'), 39)), '');
  v_family := nullif(rtrim(left(btrim(v_meta->>'family_name'), 39)), '');
  if v_given is null or concat_ws(' ', v_given, v_family) is distinct from v_name then
    v_given  := null;
    v_family := null;
  end if;

  insert into public.profiles (id, full_name, phone, preferred_lang, given_name, family_name)
  values (
    new.id,
    v_name,
    v_phone,
    case when v_meta->>'preferred_lang' in ('en','ar')
         then v_meta->>'preferred_lang' else 'en' end,
    v_given,
    v_family
  )
  on conflict (id) do nothing;
  return new;
end $handle_new_user_0256$;
-- Grants + trigger binding unchanged (0004:56, 0004:150): replace preserves them.

-- ---------------------------------------------------------------------------
-- 6. Backfill: every live profile gets its parts; full_name is not touched
-- ---------------------------------------------------------------------------
-- The skip flag keeps profiles_sync_names out of it, so full_name stays
-- byte-identical (rule 5 would rebuild it from a clamped part). The parts are
-- the sign-up's metadata parts when they rebuild the name exactly, else the
-- split; both from the sanitised name, as the sanitiser (which this UPDATE
-- fires) sees it. A tombstone keeps NULL parts. Profiles are a few thousand
-- rows at most: one statement, well inside the timeout.
do $backfill_names_0256$
begin
  perform set_config('app.skip_name_sync', 'on', true);

  update profiles p
     set given_name  = s.parts[1],
         family_name = s.parts[2]
    from (
      select pr.id,
             case when m.g is not null
                   and concat_ws(' ', m.g, m.f) = coalesce(app.safe_line(pr.full_name), '')
                  then array[m.g, m.f]
                  else app.split_person_name(app.safe_line(pr.full_name)) end as parts
        from profiles pr
        left join auth.users u on u.id = pr.id
       cross join lateral (
         select nullif(rtrim(left(app.safe_line(u.raw_user_meta_data->>'given_name'), 39)), '')  as g,
                nullif(rtrim(left(app.safe_line(u.raw_user_meta_data->>'family_name'), 39)), '') as f
       ) m
       where pr.deleted_at is null
         and pr.given_name is null
         and pr.full_name <> ''
    ) s
   where p.id = s.id
     and p.deleted_at is null
     and p.given_name is null
     and s.parts[1] is not null;

  perform set_config('app.skip_name_sync', '', true);
end $backfill_names_0256$;

-- ---------------------------------------------------------------------------
-- 7. Constraints: NOT VALID, then VALIDATE inside a guard on conname and
--    conrelid (0241:185-199).
-- ---------------------------------------------------------------------------
do $profiles_names_checks_0256$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_given_name_len'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_given_name_len
      check (given_name is null or char_length(given_name) between 1 and 39) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_family_name_len'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_family_name_len
      check (family_name is null or char_length(family_name) between 1 and 39) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_name_parts'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_name_parts
      check (given_name is not null or family_name is null) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_gender_values'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_gender_values
      check (gender is null or gender in ('female', 'male')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_gender_stamp'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_gender_stamp
      check ((gender is null) = (gender_set_at is null)
             and (gender is null) = (gender_set_by is null)
             and (gender_set_by is null or gender_set_by in ('guest', 'staff'))) not valid;
  end if;
end $profiles_names_checks_0256$;

do $profiles_names_validate_0256$
declare
  v_name text;
begin
  foreach v_name in array array['profiles_given_name_len', 'profiles_family_name_len',
                                'profiles_name_parts', 'profiles_gender_values',
                                'profiles_gender_stamp'] loop
    if exists (select 1 from pg_constraint
                where conname = v_name
                  and conrelid = 'public.profiles'::regclass
                  and not convalidated) then
      execute format('alter table profiles validate constraint %I', v_name);
    end if;
  end loop;
end $profiles_names_validate_0256$;

-- ---------------------------------------------------------------------------
-- 8. Grants. Row access stays profiles_select (own row, or court_desk,
--    manager, owner) and profiles_update_own. No update grant on gender.
-- ---------------------------------------------------------------------------
grant select (given_name, family_name, gender, gender_set_at, gender_set_by)
  on profiles to authenticated;
grant update (given_name, family_name) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.set_my_gender — the guest says once whether they are a woman or a
--    man (OM-28). The front desk corrects it (staff_set_customer_gender, 0262).
-- ---------------------------------------------------------------------------
create or replace function app.set_my_gender(p_gender text)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_gender_0256$
declare
  v_uid     uuid := auth.uid();
  v_profile profiles%rowtype;
  v_at      timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no profile (0004 skips is_anonymous), and a
  -- deleted account is a tombstone. This refusal is also what keeps
  -- check-rpc-authz.mjs, which calls every RPC as an anonymous guest, from
  -- writing anything.
  select * into v_profile from profiles where id = v_uid;
  if not found or v_profile.deleted_at is not null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  if p_gender is null or p_gender not in ('female', 'male') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_gender', hint = 'p_gender';
  end if;

  if v_profile.gender is not null then
    if v_profile.gender = p_gender then
      return jsonb_build_object('gender', v_profile.gender, 'gender_set_at', v_profile.gender_set_at,
                                'duplicate', true);
    end if;
    raise exception 'GENDER_ALREADY_SET' using errcode = 'P0001';
  end if;

  -- Only while still unset: two racing first answers cannot both write.
  update profiles
     set gender        = p_gender,
         gender_set_at = now(),
         gender_set_by = 'guest'
   where id = v_uid
     and gender is null
  returning gender_set_at into v_at;

  if not found then
    select * into v_profile from profiles where id = v_uid;
    if v_profile.gender = p_gender then
      return jsonb_build_object('gender', v_profile.gender, 'gender_set_at', v_profile.gender_set_at,
                                'duplicate', true);
    end if;
    raise exception 'GENDER_ALREADY_SET' using errcode = 'P0001';
  end if;

  -- The audit row names the account and who set it, never the value: audit_log
  -- is append-only and outlives an account deletion (0077 keeps identity out
  -- of it for the same reason).
  perform app.write_audit('profile.gender_set', 'profiles', v_uid::text, null,
                          jsonb_build_object('gender_set_by', 'guest'));

  return jsonb_build_object('gender', p_gender, 'gender_set_at', v_at, 'duplicate', false);
end $set_my_gender_0256$;

comment on function app.set_my_gender(text) is
  '0256. The calling account says once whether they are a woman or a man (female | male), for women''s and men''s open matches (OM-28). Refusals in order: AUTH_REQUIRED, ACCOUNT_REQUIRED (no profile or deleted), INVALID_ARGUMENT (detail p_gender), GENDER_ALREADY_SET (a different value is stored; the front desk corrects it). The same value again returns duplicate true. Stamps gender, gender_set_at and gender_set_by = guest together; audits profile.gender_set without the value.';

revoke all on function app.set_my_gender(text) from public, anon;
grant execute on function app.set_my_gender(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Comments
-- ---------------------------------------------------------------------------
comment on column profiles.given_name is
  '0256. First name (1..39). Other open-match players see it; the desk and the guest see the whole name. Kept in step with full_name by profiles_sync_names; NULL on a deleted account.';
comment on column profiles.family_name is
  '0256. Surname (1..39, NULL without a given_name). Other open-match players see only its first letter. NULL on a deleted account.';
comment on column profiles.gender is
  '0256. female | male, asked once at the first open match (OM-28): women''s and men''s matches. Written only by app.set_my_gender and app.staff_set_customer_gender, with gender_set_at and gender_set_by. NULL on a deleted account.';
comment on column profiles.gender_set_at is
  '0256. When gender was last set; set with gender.';
comment on column profiles.gender_set_by is
  '0256. guest (app.set_my_gender) or staff (the front desk''s correction); set with gender.';
