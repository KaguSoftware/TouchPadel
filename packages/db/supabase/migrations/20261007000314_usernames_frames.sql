set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0314 usernames_frames — Phase 2, Edit profile (owner, 2026-10-06).
--
--   1. profiles gains username (unique among live profiles, lower case, 3–20
--      of a-z 0-9 . _, starting and ending with a letter or digit, no two
--      dots or underscores in a row), username_changed_at, and avatar_frame
--      (the photo frame id, default brand-green). Plain columns: no rewrite.
--      The unique index is its own file (0315).
--   2. username_holds: a name a guest gave up (changed away from: 7 days;
--      account deleted or merged away: 90 days) that nobody else may take
--      until released_at. The holder may take their own name back.
--   3. app.username_check(p) answers {username, available, reason} for the
--      Edit profile field; app.suggest_username() builds one from the name
--      (given + "." + family initial, e.g. hassan.s, then hassan.s2 …);
--      app.set_my_username(p) sets it, at most once every 7 days after the
--      first. Reserved: anything starting with "touch", and a short list
--      (admin, support, staff …).
--   4. app.set_my_frame(p) picks a frame. Free frames are anyone's; earned
--      frames (regular, silver-racket, gold-racket, champion) are refused with
--      FRAME_LOCKED until app.frame_unlocked says the guest earned them.
--      app.my_frames() lists the closed set for the picker.
--   5. The tombstone trigger (0302) is re-issued: account deletion and a
--      0303 merge's drop now also hold the username for 90 days, empty it,
--      and put the frame back to brand-green.
--
-- Usernames are seen by other guests (open matches, a later slice) and by
-- staff; they show beside the short name ("Hassan S.", OM-26 extended).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists username            text;
alter table profiles add column if not exists username_changed_at timestamptz;
alter table profiles add column if not exists avatar_frame        text not null default 'brand-green';

comment on column profiles.username is
  '0314. The guest''s public handle: lower case, 3-20 of a-z 0-9 . _, unique among live profiles (0315). Seen by other guests and staff. Written only by app.set_my_username; emptied (and held 90 days) by account deletion.';
comment on column profiles.username_changed_at is
  '0314. When the username last changed; a guest may change it again 7 days after this. NULL until the first username.';
comment on column profiles.avatar_frame is
  '0314. The ring drawn around the profile photo: one id of the closed list (app.frame_ids()). Written only by app.set_my_frame; back to brand-green on account deletion.';

-- The grammar, written out so no role needs EXECUTE to write the row.
do $constraints_0314$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_username_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_username_chk check (
      username is null
      or (username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'
          and username !~ '[._]{2}')) not valid;
    alter table profiles validate constraint profiles_username_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_avatar_frame_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_avatar_frame_chk check (
      avatar_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
                       'court-lines', 'regular', 'silver-racket', 'gold-racket', 'champion')) not valid;
    alter table profiles validate constraint profiles_avatar_frame_chk;
  end if;
end $constraints_0314$;

grant select (username, username_changed_at, avatar_frame) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. username_holds
-- ---------------------------------------------------------------------------
create table if not exists username_holds (
  username    text primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  held_at     timestamptz not null default now(),
  released_at timestamptz not null,
  reason      text not null check (reason in ('changed', 'deleted')),
  constraint username_holds_username_chk check (username ~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$')
);

comment on table username_holds is
  '0314. Usernames a guest gave up, kept from everyone else until released_at: 7 days after a change, 90 days after account deletion or a merge. The holder may take their own name back. No client grant; the username definers read and write it.';
comment on column username_holds.username is 'The held name.';
comment on column username_holds.profile_id is 'Whose name it was; only they may take it back while it is held.';
comment on column username_holds.held_at is 'When it was given up.';
comment on column username_holds.released_at is 'When anyone may take it again.';
comment on column username_holds.reason is 'changed (7 days) or deleted (90 days: deletion or a 0303 merge).';

alter table username_holds enable row level security;
grant all on username_holds to service_role;

-- ---------------------------------------------------------------------------
-- 3. Helpers. Pure text, immutable, never raise. Each carries a SET clause so
--    it is never inlined into a caller and its revoke holds on a pooled
--    connection (sql-helpers-not-inlinable.test.ts).
-- ---------------------------------------------------------------------------
create or replace function app.username_normal(p text) returns text
language sql immutable set search_path = public as $username_normal_0314$
  select nullif(lower(btrim(coalesce(p, ''))), '')
$username_normal_0314$;

comment on function app.username_normal(text) is
  '0314. A typed username as stored: trimmed, lower case; NULL for blank. Pure text.';

-- NULL when the name is fine, else invalid | reserved.
create or replace function app.username_problem(p text) returns text
language sql immutable set search_path = public as $username_problem_0314$
  select case
    when p is null or p !~ '^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$' or p ~ '[._]{2}' then 'invalid'
    when p like 'touch%'
      or replace(replace(p, '.', ''), '_', '') in (
           'admin', 'administrator', 'support', 'staff', 'desk', 'frontdesk', 'reception', 'manager',
           'owner', 'coach', 'moderator', 'mod', 'system', 'official', 'help', 'info', 'root', 'null',
           'undefined', 'me', 'you', 'guest', 'player', 'padel', 'venue', 'cafe', 'team', 'security',
           'privacy', 'legal', 'everyone', 'all', 'anonymous', 'deleted', 'deletedaccount')
      then 'reserved'
  end
$username_problem_0314$;

comment on function app.username_problem(text) is
  '0314. Why a stored-form username cannot be used: invalid (grammar) or reserved (starts with touch, or a staff-like word); NULL when fine. Pure text.';

revoke all on function app.username_normal(text) from public, anon, authenticated;
revoke all on function app.username_problem(text) from public, anon, authenticated;

-- Taken by another live profile, or held for someone else.
create or replace function app.username_taken(p text, p_by uuid) returns boolean
language sql stable security definer set search_path = public as $username_taken_0314$
  select exists (select 1 from profiles
                  where username = p and id is distinct from p_by and deleted_at is null)
      or exists (select 1 from username_holds
                  where username = p and profile_id is distinct from p_by and released_at > now())
$username_taken_0314$;

comment on function app.username_taken(text, uuid) is
  '0314. Internal: true when another live profile has the name, or it is held for someone other than p_by.';

revoke all on function app.username_taken(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.username_check — the Edit profile field's live answer.
-- ---------------------------------------------------------------------------
create or replace function app.username_check(p_username text)
returns jsonb
language plpgsql stable security definer set search_path = public as $username_check_0314$
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
end $username_check_0314$;

comment on function app.username_check(text) is
  '0314. The caller''s Edit profile field: {username (as it would be stored), available, reason: null | invalid | reserved | taken}. The caller''s own current or held name is available to them.';

revoke all on function app.username_check(text) from public, anon;
grant execute on function app.username_check(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.suggest_username — given name + "." + family initial, then numbers.
-- ---------------------------------------------------------------------------
create or replace function app.suggest_username()
returns jsonb
language plpgsql stable security definer set search_path = public as $suggest_username_0314$
declare
  v_uid  uuid := auth.uid();
  v_p    profiles%rowtype;
  v_base text;
  v_init text;
  v_try  text;
  v_n    int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_p from profiles where id = v_uid and deleted_at is null;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Latin letters and digits only (Arabic names give no base: "player").
  v_base := left(regexp_replace(lower(coalesce(v_p.given_name, '')), '[^a-z0-9]', '', 'g'), 15);
  v_init := left(regexp_replace(lower(coalesce(v_p.family_name, '')), '[^a-z0-9]', '', 'g'), 1);
  if length(v_base) < 2 then
    v_base := 'player';
    v_init := '';
  end if;
  if v_init <> '' then
    v_base := v_base || '.' || v_init;
  elsif length(v_base) < 3 then
    v_base := v_base || '1';
  end if;

  for v_n in 1 .. 999 loop
    v_try := case when v_n = 1 and v_base <> 'player' then v_base else v_base || v_n::text end;
    if app.username_problem(v_try) is null and not app.username_taken(v_try, v_uid) then
      return jsonb_build_object('username', v_try);
    end if;
  end loop;
  return jsonb_build_object('username', null);
end $suggest_username_0314$;

comment on function app.suggest_username() is
  '0314. A free username for the caller, built from their name: given name + "." + family initial (hassan.s), then hassan.s2, hassan.s3 …; player1, player2 … when the name has no Latin letters. {username} (NULL only if 999 tries are taken).';

revoke all on function app.suggest_username() from public, anon;
grant execute on function app.suggest_username() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.set_my_username
-- ---------------------------------------------------------------------------
create or replace function app.set_my_username(p_username text)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_username_0314$
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

  -- Two guests racing for one name: serialise on it; the 0315 index backs it.
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
end $set_my_username_0314$;

comment on function app.set_my_username(text) is
  '0314. The caller''s own username. USERNAME_INVALID, USERNAME_RESERVED, USERNAME_TAKEN, USERNAME_TOO_SOON (detail: when the next change is allowed; the first username is free, then once every 7 days). The name given up is held for the caller for 7 days. Returns {username, changed_at, next_change_at, duplicate}.';

revoke all on function app.set_my_username(text) from public, anon;
grant execute on function app.set_my_username(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Frames
-- ---------------------------------------------------------------------------
create or replace function app.frame_ids() returns text[]
language sql immutable set search_path = public as $frame_ids_0314$
  select array['brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
               'court-lines', 'regular', 'silver-racket', 'gold-racket', 'champion']
$frame_ids_0314$;

comment on function app.frame_ids() is
  '0314. The closed list of photo frame ids, free ones first. profiles_avatar_frame_chk names the same list.';

revoke all on function app.frame_ids() from public, anon, authenticated;

-- Whether p_profile may wear p_frame. Free frames: always. Earned frames:
-- not yet (the earning rules land with the earned-frames slice).
create or replace function app.frame_unlocked(p_profile uuid, p_frame text) returns boolean
language sql stable security definer set search_path = public as $frame_unlocked_0314$
  select p_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line', 'court-lines')
$frame_unlocked_0314$;

comment on function app.frame_unlocked(uuid, text) is
  '0314. Internal: whether a profile may wear a frame. The six free frames always; the earned frames once their rule is met (until the earned slice, never).';

revoke all on function app.frame_unlocked(uuid, text) from public, anon, authenticated;

create or replace function app.my_frames()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_frames_0314$
declare
  v_uid   uuid := auth.uid();
  v_frame text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select avatar_frame into v_frame from profiles where id = v_uid and deleted_at is null;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'current', v_frame,
    'frames', (select jsonb_agg(jsonb_build_object('id', f, 'unlocked', app.frame_unlocked(v_uid, f))
                                order by o)
                 from unnest(app.frame_ids()) with ordinality as x(f, o)));
end $my_frames_0314$;

comment on function app.my_frames() is
  '0314. The caller''s frame picker: {current, frames: [{id, unlocked}]} in the closed list''s order.';

revoke all on function app.my_frames() from public, anon;
grant execute on function app.my_frames() to authenticated;

create or replace function app.set_my_frame(p_frame text)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_frame_0314$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if p_frame is null or not (p_frame = any(app.frame_ids())) then
    raise exception 'FRAME_INVALID' using errcode = 'P0001';
  end if;
  if not app.frame_unlocked(v_uid, p_frame) then
    raise exception 'FRAME_LOCKED' using errcode = 'P0001';
  end if;

  update profiles set avatar_frame = p_frame
   where id = v_uid and avatar_frame is distinct from p_frame;
  return jsonb_build_object('avatar_frame', p_frame);
end $set_my_frame_0314$;

comment on function app.set_my_frame(text) is
  '0314. The caller''s own photo frame. FRAME_INVALID for an id outside the closed list, FRAME_LOCKED for an earned frame not earned yet. Returns {avatar_frame}.';

revoke all on function app.set_my_frame(text) from public, anon;
grant execute on function app.set_my_frame(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The tombstone trigger: re-created from
--    20261004000302_profile_avatar_birth_date.sql:350, verbatim plus the
--    username hold and the frame reset.
-- ---------------------------------------------------------------------------
create or replace function app.trg_profile_media_tombstone() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_media_tombstone_0314$
begin
  if tg_op = 'DELETE' then
    insert into avatar_purges (path) values (old.id::text);
    return old;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.avatar_path := null;
    new.birth_date  := null;
    insert into avatar_purges (path) values (new.id::text);
    -- 0314: the username is held from everyone else for 90 days.
    if old.username is not null then
      insert into username_holds (username, profile_id, released_at, reason)
      values (old.username, new.id, now() + interval '90 days', 'deleted')
      on conflict (username) do update
        set profile_id = excluded.profile_id, held_at = now(),
            released_at = excluded.released_at, reason = excluded.reason;
    end if;
    new.username            := null;
    new.username_changed_at := null;
    new.avatar_frame        := 'brand-green';
  end if;
  return new;
end $trg_profile_media_tombstone_0314$;

comment on function app.trg_profile_media_tombstone() is
  '0302, username and frame since 0314. Trigger profiles_media_tombstone: on the 0077 tombstone UPDATE (account deletion, or a 0303 merge''s drop), empties avatar_path, birth_date and the username (held 90 days in username_holds) and puts the frame back to brand-green; on that UPDATE or a DELETE, queues the account''s whole avatars folder in avatar_purges.';

revoke all on function app.trg_profile_media_tombstone() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.profile_merge_columns: re-created from
--    20261005000303_account_identity.sql:168, verbatim plus username_holds.
--    A hold stays with the drop (drop_only): the drop's tombstone holds its
--    old username under its own id for 90 days (section 8), and the keep
--    picks or keeps its own name.
-- ---------------------------------------------------------------------------
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0314$
  select * from (values
    ( 10, 'public', 'tabs',                  'customer_id',           'repoint'),
    ( 20, 'public', 'reservations',          'guest_id',              'repoint'),
    ( 30, 'public', 'reservation_series',    'guest_id',              'repoint'),
    ( 40, 'public', 'guest_sessions',        'linked_profile_id',     'repoint'),
    ( 50, 'public', 'customer_notes',        'customer_id',           'repoint'),
    ( 60, 'public', 'promotion_redemptions', 'customer_id',           'repoint'),
    ( 70, 'public', 'matches',               'organiser_id',          'repoint'),
    ( 80, 'public', 'match_events',          'actor_guest_id',        'repoint'),
    ( 90, 'public', 'coaches',               'profile_id',            'repoint'),
    (100, 'public', 'courses',               'created_by_profile_id', 'repoint'),
    (110, 'public', 'lessons',               'created_by_profile_id', 'repoint'),
    (130, 'public', 'lesson_attendance',     'marked_by_profile_id',  'repoint'),
    (140, 'public', 'lesson_strikes',        'guest_id',              'repoint'),
    (150, 'public', 'lesson_events',         'actor_profile_id',      'repoint'),
    (160, 'public', 'loyalty_ledger',        'profile_id',            'repoint'),
    (170, 'public', 'match_ticket_events',   'guest_id',              'repoint'),
    (180, 'public', 'match_tickets',         'guest_id',              'repoint'),
    (190, 'public', 'notification_outbox',   'profile_id',            'repoint'),
    (300, 'public', 'customer_flags',        'customer_id',           'rule'),
    (310, 'public', 'booking_payments',      'guest_id',              'rule'),
    (320, 'public', 'hold_standing',         'guest_id',              'rule'),
    (330, 'public', 'match_requests',        'guest_id',              'rule'),
    (340, 'public', 'match_seats',           'guest_id',              'rule'),
    (350, 'public', 'match_exclusions',      'guest_id',              'rule'),
    (360, 'public', 'match_blocks',          'blocker_id',            'rule'),
    (361, 'public', 'match_blocks',          'blocked_id',            'rule'),
    (370, 'public', 'match_reports',         'reporter_id',           'rule'),
    (371, 'public', 'match_reports',         'reported_id',           'rule'),
    (380, 'public', 'lesson_enrolments',     'guest_id',              'rule'),
    (381, 'public', 'lesson_enrolments',     'booked_by_profile_id',  'rule'),
    (390, 'public', 'tournament_entries',    'guest_id',              'rule'),
    (400, 'public', 'loyalty_cards',         'profile_id',            'rule'),
    (410, 'public', 'loyalty_accounts',      'profile_id',            'rule'),
    (420, 'public', 'username_holds',        'profile_id',            'drop_only'),
    (500, 'auth',   'identities',            'user_id',               'auth'),
    (510, 'auth',   'sessions',              'user_id',               'signout'),
    (520, 'auth',   'one_time_tokens',       'user_id',               'signout'),
    (530, 'auth',   'mfa_factors',           'user_id',               'drop_only'),
    (540, 'auth',   'oauth_authorizations',  'user_id',               'drop_only'),
    (550, 'auth',   'oauth_consents',        'user_id',               'drop_only'),
    (560, 'auth',   'webauthn_credentials',  'user_id',               'drop_only'),
    (570, 'auth',   'webauthn_challenges',   'user_id',               'drop_only'),
    (600, 'public', 'staff',                 'id',                    'refuse'),
    (700, 'app',    'profile_merges',        'keep_id',               'record')
  ) as t (ord, sch, tbl, col, how)
  order by 1;
$profile_merge_columns_0314$;

comment on function app.profile_merge_columns() is
  '0303, 0307, username_holds since 0314. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;
