set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0312 username_not_allowed — no slurs or swear words as usernames (owner,
-- 2026-10-06).
--
--   1. app.username_offensive(p): true when a stored-form username carries a
--      racist slur, a swear word or a sexual word, in English or in Arabic
--      written in Latin letters. Dots and underscores are ignored and common
--      digit swaps read as letters (n1gg3r, sh1t), so they do not slip past.
--      Two lists: words caught anywhere in the name, and short words caught
--      only as a whole name or a whole part between dots, underscores and
--      digits (big_dick, but not dickens; coon, but not raccoon).
--   2. app.username_problem gains a third answer, not_allowed, after invalid
--      and before reserved. app.username_check passes it through as the reason;
--      app.set_my_username raises USERNAME_NOT_ALLOWED. app.suggest_username
--      already skips any name with a problem.
--   3. A live username already stored that fails the check is emptied, with
--      username_changed_at, so its guest may pick a new one at once; a hold on
--      such a name is dropped.
--
-- The list will never be complete. To add a word, re-issue
-- app.username_offensive from this body in a new migration.

-- ---------------------------------------------------------------------------
-- 1. app.username_offensive
-- ---------------------------------------------------------------------------
create or replace function app.username_offensive(p text) returns boolean
language sql immutable set search_path = public as $username_offensive_0312$
  with n as (
    -- Separators out, digit swaps read as letters.
    select translate(replace(replace(coalesce(p, ''), '.', ''), '_', ''), '0134578', 'oieastb') as plain
  ),
  f as (
    -- Also with doubled letters squeezed, so fuuuck reads as fuck.
    select plain, regexp_replace(plain, '(.)\1+', '\1', 'g') as squeezed from n
  ),
  anywhere(w) as (
    select unnest(array[
      -- Racist and hateful
      'nigger', 'nigga', 'niggr', 'nigglet', 'niglet', 'chink', 'gook', 'wetback', 'beaner',
      'raghead', 'towelhead', 'sandnig', 'kike', 'kyke', 'faggot', 'fagot', 'tranny', 'retard',
      'kkk', 'hitler', 'siegheil', 'whitepower', 'heilhit', 'gasthe', 'killjew', 'killthe',
      'kuffar',
      -- Swear words and sexual words
      'fuck', 'fck', 'motherf', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'asshole',
      'bastard', 'wanker', 'pussy', 'penis', 'vagina', 'dildo', 'blowjob', 'handjob', 'boobs',
      'porn', 'horny', 'orgasm', 'erection', 'masturb', 'pedophil', 'paedophil',
      -- Arabic, in Latin letters
      'sharmo', 'sharmu', 'sharmou', 'kosomak', 'kusomak', 'kosommak', 'kusummak', 'kosemak',
      'koskhtak', 'manyak', 'manyok', 'manyouk', 'gahba', 'qahba', 'kahba',
      'zebbi', 'ayrbik', 'nayek', 'tizak', 'teezak', 'ibnalkalb', 'ibnelkalb', 'kalbibn', 'ibnkalb'
    ])
  ),
  whole(w) as (
    select unnest(array[
      'dick', 'cock', 'cum', 'sex', 'tits', 'twat', 'rape', 'coon', 'spic', 'paki', 'dyke', 'fag',
      'homo', 'jap', 'heil', 'ass', 'arse', 'piss', 'crap', 'hoe', 'nazi', 'nazis', 'negro',
      'negros', 'fuk', 'pedo', 'paedo', 'rapist', 'kafir', 'jihadi',
      'kos', 'kus', 'ayre', 'ayreh', 'ayri', 'ayrak', 'zebi', 'zeby', 'khara', 'kalb', 'tiz', 'neek',
      'khawal'
    ])
  ),
  parts(t) as (
    select translate(x, '0134578', 'oieastb')
      from unnest(regexp_split_to_array(coalesce(p, ''), '[._0-9]+')) x
    union all select plain from f
    union all select squeezed from f
  )
  select exists (
           select 1 from f, anywhere
            where f.plain like '%' || anywhere.w || '%'
               -- The squeezed name only against a squeezed word of four or
               -- more letters: "kkk" squeezes to "k", which is everywhere.
               or (length(regexp_replace(anywhere.w, '(.)\1+', '\1', 'g')) >= 4
                   and f.squeezed like '%' || regexp_replace(anywhere.w, '(.)\1+', '\1', 'g') || '%'))
      or exists (select 1 from parts join whole on parts.t = whole.w)
$username_offensive_0312$;

comment on function app.username_offensive(text) is
  '0312. True when a stored-form username carries a slur, a swear word or a sexual word (English, or Arabic in Latin letters); dots, underscores and digit swaps ignored. Pure text.';

revoke all on function app.username_offensive(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.username_problem: re-created from 20261006000307_usernames_frames.sql,
--    not_allowed added.
-- ---------------------------------------------------------------------------
-- NULL when the name is fine, else invalid | not_allowed | reserved.
create or replace function app.username_problem(p text) returns text
language sql immutable set search_path = public as $username_problem_0312$
  select case
    when p is null or p !~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$' or p ~ '[._]{2}' then 'invalid'
    when app.username_offensive(p) then 'not_allowed'
    when p like 'touch%'
      or replace(replace(p, '.', ''), '_', '') in (
           'admin', 'administrator', 'support', 'staff', 'desk', 'frontdesk', 'reception', 'manager',
           'owner', 'coach', 'moderator', 'mod', 'system', 'official', 'help', 'info', 'root', 'null',
           'undefined', 'me', 'you', 'guest', 'player', 'padel', 'venue', 'cafe', 'team', 'security',
           'privacy', 'legal', 'everyone', 'all', 'anonymous', 'deleted', 'deletedaccount')
      then 'reserved'
  end
$username_problem_0312$;

comment on function app.username_problem(text) is
  '0312. Why a stored-form username cannot be used: invalid (grammar), not_allowed (a slur or swear word, app.username_offensive) or reserved (starts with touch, or a staff-like word); NULL when fine. Pure text.';

revoke all on function app.username_problem(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.username_check: re-created from 20261006000307_usernames_frames.sql;
--    the body is unchanged, the comment names the new reason.
-- ---------------------------------------------------------------------------
create or replace function app.username_check(p_username text)
returns jsonb
language plpgsql stable security definer set search_path = public as $username_check_0312$
declare
  v_uid  uuid := auth.uid();
  v_name text := app.username_normal(p_username);
  v_why  text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  v_why := app.username_problem(v_name);
  if v_why is null and app.username_taken(v_name, v_uid) then
    v_why := 'taken';
  end if;
  return jsonb_build_object('username', v_name, 'available', v_why is null, 'reason', v_why);
end $username_check_0312$;

comment on function app.username_check(text) is
  '0312. The caller''s Edit profile field: {username (as it would be stored), available, reason: null | invalid | not_allowed | reserved | taken}. The caller''s own current or held name is available to them.';

revoke all on function app.username_check(text) from public, anon;
grant execute on function app.username_check(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.set_my_username: re-created from 20261006000307_usernames_frames.sql,
--    USERNAME_NOT_ALLOWED added.
-- ---------------------------------------------------------------------------
create or replace function app.set_my_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_username_0312$
declare
  v_uid  uuid := auth.uid();
  v_p    profiles%rowtype;
  v_name text := app.username_normal(p_username);
  v_why  text;
  v_next timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_p from profiles where id = v_uid for update;
  if not found or v_p.deleted_at is not null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  v_why := app.username_problem(v_name);
  if v_why = 'invalid' then
    raise exception 'USERNAME_INVALID' using errcode = 'P0001';
  elsif v_why = 'not_allowed' then
    raise exception 'USERNAME_NOT_ALLOWED' using errcode = 'P0001';
  elsif v_why = 'reserved' then
    raise exception 'USERNAME_RESERVED' using errcode = 'P0001';
  end if;

  if v_p.username = v_name then
    return jsonb_build_object('username', v_name, 'changed_at', v_p.username_changed_at,
                              'next_change_at', v_p.username_changed_at + interval '7 days',
                              'duplicate', true);
  end if;

  -- The first username is free; after that, once every 7 days.
  if v_p.username is not null and v_p.username_changed_at > now() - interval '7 days' then
    v_next := v_p.username_changed_at + interval '7 days';
    raise exception 'USERNAME_TOO_SOON' using errcode = 'P0001', detail = v_next::text;
  end if;

  -- Two guests racing for one name: serialise on it; the 0308 index backs it.
  perform pg_advisory_xact_lock(hashtext('username:' || v_name));
  if app.username_taken(v_name, v_uid) then
    raise exception 'USERNAME_TAKEN' using errcode = 'P0001';
  end if;

  if v_p.username is not null then
    insert into username_holds (username, profile_id, released_at, reason)
    values (v_p.username, v_uid, now() + interval '7 days', 'changed')
    on conflict (username) do update
      set profile_id = excluded.profile_id, held_at = now(),
          released_at = excluded.released_at, reason = excluded.reason;
  end if;
  -- Taking back one's own held name ends the hold.
  delete from username_holds where username = v_name and profile_id = v_uid;

  begin
    update profiles set username = v_name, username_changed_at = now() where id = v_uid;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN' using errcode = 'P0001';
  end;

  return jsonb_build_object('username', v_name, 'changed_at', now(),
                            'next_change_at', now() + interval '7 days', 'duplicate', false);
end $set_my_username_0312$;

comment on function app.set_my_username(text) is
  '0312. The caller''s own username. USERNAME_INVALID, USERNAME_NOT_ALLOWED (a slur or swear word), USERNAME_RESERVED, USERNAME_TAKEN, USERNAME_TOO_SOON (detail: when the next change is allowed; the first username is free, then once every 7 days). The name given up is held for the caller for 7 days. Returns {username, changed_at, next_change_at, duplicate}.';

revoke all on function app.set_my_username(text) from public, anon;
grant execute on function app.set_my_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Names already stored
-- ---------------------------------------------------------------------------
update profiles
   set username = null, username_changed_at = null
 where username is not null
   and deleted_at is null
   and app.username_offensive(username);

delete from username_holds where app.username_offensive(username);
