set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0318 frame_grants — every frame for a named test account (owner, 2026-10-06).
--
-- Earned frames are computed from play (0316), so a test account cannot reach
-- the gold or champion frames without faking matches and money. A row here
-- opens every frame for that profile instead. Empty on hosted; the local seed
-- (supabase/seed.sql) grants the seven dev accounts. No client role reads or
-- writes it; only app.frame_unlocked and app.my_frames look at it.

create table if not exists frame_grants (
  profile_id uuid primary key references profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text
);

comment on table frame_grants is
  '0318. Test accounts that wear every photo frame, earned or not. Empty on hosted; seeded locally for the dev accounts. Read only by app.frame_unlocked and app.my_frames; no client grant.';

alter table frame_grants enable row level security;
revoke all on table frame_grants from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.frame_unlocked: re-created from 20261007000317_frame_style.sql, a grant
-- first.
-- ---------------------------------------------------------------------------
create or replace function app.frame_unlocked(p_profile uuid, p_frame text) returns boolean
language sql stable security definer set search_path = public as $frame_unlocked_0318$
  select p_frame = any(app.frame_ids())
         and (exists (select 1 from frame_grants g where g.profile_id = p_profile)
              or case p_frame
                   when 'regular'       then app.matches_played(p_profile) >= 10
                   when 'silver-racket' then app.matches_played(p_profile) >= 50
                   when 'gold-racket'   then app.matches_played(p_profile) >= 100
                   when 'champion'      then app.tournaments_won(p_profile) >= 1
                   else p_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line')
                 end)
$frame_unlocked_0318$;

comment on function app.frame_unlocked(uuid, text) is
  '0314, the earned rules since 0316, five free frames since 0317, frame_grants since 0318. Internal: whether a profile may wear a frame. A profile in frame_grants wears all of them; otherwise the five free frames always, regular at 10 matches played and paid, silver-racket at 50, gold-racket at 100 (app.matches_played), champion after one tournament win (app.tournaments_won).';

revoke all on function app.frame_unlocked(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.my_frames: re-created from 20261007000317_frame_style.sql; a granted
-- profile sees every frame unlocked (goal and progress still the real ones).
-- ---------------------------------------------------------------------------
create or replace function app.my_frames()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_frames_0318$
declare
  v_uid     uuid := auth.uid();
  v_frame   text;
  v_style   text;
  v_played  int;
  v_won     int;
  v_granted boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select avatar_frame, avatar_frame_style into v_frame, v_style
    from profiles where id = v_uid and deleted_at is null;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  v_played  := app.matches_played(v_uid);
  v_won     := app.tournaments_won(v_uid);
  v_granted := exists (select 1 from frame_grants g where g.profile_id = v_uid);

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
                 'unlocked', v_granted or coalesce(g.progress >= g.goal, true))
               order by o)
        from unnest(app.frame_ids()) with ordinality as x(f, o)
        left join lateral (
          select case f when 'regular' then 10 when 'silver-racket' then 50
                        when 'gold-racket' then 100 when 'champion' then 1 end as goal,
                 case f when 'champion' then v_won
                        when 'regular' then v_played when 'silver-racket' then v_played
                        when 'gold-racket' then v_played end as progress
        ) g on true));
end $my_frames_0318$;

comment on function app.my_frames() is
  '0314, progress since 0316, style since 0317, frame_grants since 0318. The caller''s frame picker: {current, style, played, tournaments_won, frames: [{id, goal, progress, unlocked}]} in the closed list''s order; goal and progress are NULL for a free frame (always unlocked), and every frame is unlocked for a profile in frame_grants.';

revoke all on function app.my_frames() from public, anon;
grant execute on function app.my_frames() to authenticated;
