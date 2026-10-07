set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0317 frame_style — court lines become a style, not a frame (Phase 2, Edit
-- profile; owner 2026-10-06).
--
-- The guest picks a colour first, then Normal or Court lines. Court lines (the
-- ring drawn as dashes) is offered on the five free frames only; the earned
-- frames keep their own design.
--
--   1. profiles gains avatar_frame_style: solid | lines, default solid. Lines
--      only on a free frame (profiles_avatar_frame_style_chk).
--   2. Everyone wearing court-lines moves to brand-green + lines, which is the
--      same green dashed ring, and court-lines leaves the closed list
--      (profiles_avatar_frame_chk, app.frame_ids, app.frame_unlocked).
--   3. app.set_my_frame(p_frame, p_style default 'solid') writes both;
--      FRAME_INVALID for lines on an earned frame. app.my_frames returns the
--      style beside the current frame. Account deletion resets it to solid.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists avatar_frame_style text not null default 'solid';

comment on column profiles.avatar_frame_style is
  '0317. How the photo frame is drawn: solid, or lines (court lines: the ring as dashes). Lines only on a free frame. Written only by app.set_my_frame; back to solid on account deletion.';

grant select (avatar_frame_style) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. court-lines → brand-green + lines, then out of the closed list
-- ---------------------------------------------------------------------------
update profiles
   set avatar_frame = 'brand-green', avatar_frame_style = 'lines'
 where avatar_frame = 'court-lines';

do $constraints_0317$
begin
  alter table profiles drop constraint if exists profiles_avatar_frame_chk;
  alter table profiles add constraint profiles_avatar_frame_chk check (
    avatar_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
                     'regular', 'silver-racket', 'gold-racket', 'champion')) not valid;
  alter table profiles validate constraint profiles_avatar_frame_chk;

  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_avatar_frame_style_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_avatar_frame_style_chk check (
      avatar_frame_style = 'solid'
      or (avatar_frame_style = 'lines'
          and avatar_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line')))
      not valid;
    alter table profiles validate constraint profiles_avatar_frame_style_chk;
  end if;
end $constraints_0317$;

-- ---------------------------------------------------------------------------
-- 3. The closed list: re-created from 20261007000314_usernames_frames.sql:296
--    without court-lines.
-- ---------------------------------------------------------------------------
create or replace function app.frame_ids() returns text[]
language sql immutable set search_path = public as $frame_ids_0317$
  select array['brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
               'regular', 'silver-racket', 'gold-racket', 'champion']
$frame_ids_0317$;

comment on function app.frame_ids() is
  '0314, court-lines out since 0317 (a style now). The closed list of photo frame ids, free ones first. profiles_avatar_frame_chk names the same list.';

revoke all on function app.frame_ids() from public, anon, authenticated;

-- Re-created from 20261007000316_earned_frames.sql:92, five free frames now.
create or replace function app.frame_unlocked(p_profile uuid, p_frame text) returns boolean
language sql stable security definer set search_path = public as $frame_unlocked_0317$
  select case p_frame
    when 'regular'       then app.matches_played(p_profile) >= 10
    when 'silver-racket' then app.matches_played(p_profile) >= 50
    when 'gold-racket'   then app.matches_played(p_profile) >= 100
    when 'champion'      then app.tournaments_won(p_profile) >= 1
    else p_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line')
  end
$frame_unlocked_0317$;

comment on function app.frame_unlocked(uuid, text) is
  '0314, the earned rules since 0316, five free frames since 0317. Internal: whether a profile may wear a frame. The five free frames always; regular at 10 matches played and paid, silver-racket at 50, gold-racket at 100 (app.matches_played); champion after one tournament win (app.tournaments_won).';

revoke all on function app.frame_unlocked(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.my_frames: re-created from 20261007000316_earned_frames.sql:109,
--    plus the current style.
-- ---------------------------------------------------------------------------
create or replace function app.my_frames()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_frames_0317$
declare
  v_uid    uuid := auth.uid();
  v_frame  text;
  v_style  text;
  v_played int;
  v_won    int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select avatar_frame, avatar_frame_style into v_frame, v_style
    from profiles where id = v_uid and deleted_at is null;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  v_played := app.matches_played(v_uid);
  v_won    := app.tournaments_won(v_uid);

  return jsonb_build_object(
    'current', v_frame,
    'style', v_style,
    'played', v_played,
    'tournaments_won', v_won,
    'frames', (
      select jsonb_agg(
               jsonb_build_object(
                 'id', f,
                 'goal', g.goal,
                 'progress', g.progress,
                 'unlocked', coalesce(g.progress >= g.goal, true))
               order by o)
        from unnest(app.frame_ids()) with ordinality as x(f, o)
        left join lateral (
          select case f when 'regular' then 10 when 'silver-racket' then 50
                        when 'gold-racket' then 100 when 'champion' then 1 end as goal,
                 case f when 'champion' then v_won
                        when 'regular' then v_played when 'silver-racket' then v_played
                        when 'gold-racket' then v_played end as progress
        ) g on true));
end $my_frames_0317$;

comment on function app.my_frames() is
  '0314, progress since 0316, style since 0317. The caller''s frame picker: {current, style, played, tournaments_won, frames: [{id, goal, progress, unlocked}]} in the closed list''s order; goal and progress are NULL for a free frame (always unlocked).';

revoke all on function app.my_frames() from public, anon;
grant execute on function app.my_frames() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.set_my_frame: re-created from 20261007000314_usernames_frames.sql:346
--    with the style. Signature change: drop the one-argument version.
-- ---------------------------------------------------------------------------
drop function if exists app.set_my_frame(text);

create or replace function app.set_my_frame(p_frame text, p_style text default 'solid')
returns jsonb
language plpgsql security definer set search_path = public as $set_my_frame_0317$
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
  -- Court lines are a free frame's style; the earned frames keep their design.
  if p_style is null or p_style not in ('solid', 'lines')
     or (p_style = 'lines'
         and p_frame not in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line')) then
    raise exception 'FRAME_INVALID' using errcode = 'P0001';
  end if;
  if not app.frame_unlocked(v_uid, p_frame) then
    raise exception 'FRAME_LOCKED' using errcode = 'P0001';
  end if;

  update profiles set avatar_frame = p_frame, avatar_frame_style = p_style
   where id = v_uid
     and (avatar_frame is distinct from p_frame or avatar_frame_style is distinct from p_style);
  return jsonb_build_object('avatar_frame', p_frame, 'avatar_frame_style', p_style);
end $set_my_frame_0317$;

comment on function app.set_my_frame(text, text) is
  '0314, style since 0317. The caller''s own photo frame and its style (solid | lines; lines on a free frame only). FRAME_INVALID for an id outside the closed list or a style it cannot take, FRAME_LOCKED for an earned frame not earned yet. Returns {avatar_frame, avatar_frame_style}.';

revoke all on function app.set_my_frame(text, text) from public, anon;
grant execute on function app.set_my_frame(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The tombstone trigger: re-created from
--    20261007000314_usernames_frames.sql:383, verbatim plus the style reset.
-- ---------------------------------------------------------------------------
create or replace function app.trg_profile_media_tombstone() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_media_tombstone_0317$
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
    new.avatar_frame_style  := 'solid';
  end if;
  return new;
end $trg_profile_media_tombstone_0317$;

comment on function app.trg_profile_media_tombstone() is
  '0302, username and frame since 0314, frame style since 0317. Trigger profiles_media_tombstone: on the 0077 tombstone UPDATE (account deletion, or a 0303 merge''s drop), empties avatar_path, birth_date and the username (held 90 days in username_holds) and puts the frame back to brand-green, solid; on that UPDATE or a DELETE, queues the account''s whole avatars folder in avatar_purges.';

revoke all on function app.trg_profile_media_tombstone() from public, anon, authenticated;
