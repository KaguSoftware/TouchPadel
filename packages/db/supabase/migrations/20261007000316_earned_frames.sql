set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0316 earned_frames — the earned photo frames (Phase 2, Edit profile; owner
-- 2026-10-06). 0314 refused every earned frame; this file says who earned one.
--
-- A MATCH PLAYED (owner's rule): the match actually finished AND the guest's
-- share is paid in full. Booked, checked in, written off, refunded or
-- cancelled does not count. Matches from before this file count when they
-- meet the same rule. Two sources, never the same game twice:
--   * an open-match seat: the match is played (not sandbox), the seat was
--     played (in or attended, never no_show, left, removed …), and
--     app.match_money shows it carrying with nothing open and nothing written
--     off;
--   * a court booking of the guest's own: kind booking, completed, not an
--     open match's court (that game is counted by its seats), and
--     app.court_fee_remaining says nothing is owed.
-- CHAMPION: the guest's entry ranks 1st (ties share it) in a finished
-- tournament (app.tournament_standings).
--
-- The rules are computed on read, never stored: regular at 10 matches,
-- silver-racket at 50, gold-racket at 100, champion at one win. Reads only
-- (match_money and court_fee_remaining are stable and take no lock).

-- ---------------------------------------------------------------------------
-- 1. The counts
-- ---------------------------------------------------------------------------
create or replace function app.matches_played(p_profile uuid) returns int
language sql stable security definer set search_path = public as $matches_played_0316$
  select (
    (select count(*)
       from match_seats s
       join matches m on m.id = s.match_id
      where s.guest_id = p_profile
        and m.status = 'played'
        and not m.sandbox
        and s.status in ('in', 'attended')
        and exists (select 1
                      from jsonb_array_elements(app.match_money(m.id, null) -> 'seats') e
                     where e ->> 'seat_id' = s.id::text
                       and (e ->> 'carrying')::boolean
                       and (e ->> 'open_iqd')::bigint = 0
                       and (e ->> 'written_off_iqd')::bigint = 0))
    +
    (select count(*)
       from reservations r
      where r.guest_id = p_profile
        and r.kind = 'booking'
        and r.status = 'completed'
        and not exists (select 1 from matches m where m.reservation_id = r.id)
        and app.court_fee_remaining(r.id, null) = 0)
  )::int
$matches_played_0316$;

comment on function app.matches_played(uuid) is
  '0316. Internal: how many games a profile has played AND paid in full (the earned-frame rule): open-match seats of played matches that carry nothing open and nothing written off, plus the profile''s own completed court bookings (not an open match''s court) with no court fee left. Stable, no locks.';

revoke all on function app.matches_played(uuid) from public, anon, authenticated;

create or replace function app.tournaments_won(p_profile uuid) returns int
language plpgsql stable security definer set search_path = public as $tournaments_won_0316$
declare
  v_won int := 0;
  t     record;
begin
  for t in
    select distinct e.tournament_id, e.id as entry_id
      from tournament_entries e
      join tournaments x on x.id = e.tournament_id
     where e.guest_id = p_profile and x.status = 'finished'
  loop
    if exists (select 1 from app.tournament_standings(t.tournament_id) s
                where s.entry_id = t.entry_id and s.rank = 1) then
      v_won := v_won + 1;
    end if;
  end loop;
  return v_won;
end $tournaments_won_0316$;

comment on function app.tournaments_won(uuid) is
  '0316. Internal: how many finished tournaments a profile''s entry ranked 1st in (ties share 1st), by app.tournament_standings. The Champion frame''s rule.';

revoke all on function app.tournaments_won(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.frame_unlocked: re-created from
--    20261007000314_usernames_frames.sql:309 with the earned rules.
-- ---------------------------------------------------------------------------
create or replace function app.frame_unlocked(p_profile uuid, p_frame text) returns boolean
language sql stable security definer set search_path = public as $frame_unlocked_0316$
  select case p_frame
    when 'regular'       then app.matches_played(p_profile) >= 10
    when 'silver-racket' then app.matches_played(p_profile) >= 50
    when 'gold-racket'   then app.matches_played(p_profile) >= 100
    when 'champion'      then app.tournaments_won(p_profile) >= 1
    else p_frame in ('brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line', 'court-lines')
  end
$frame_unlocked_0316$;

comment on function app.frame_unlocked(uuid, text) is
  '0314, the earned rules since 0316. Internal: whether a profile may wear a frame. The six free frames always; regular at 10 matches played and paid, silver-racket at 50, gold-racket at 100 (app.matches_played); champion after one tournament win (app.tournaments_won).';

revoke all on function app.frame_unlocked(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.my_frames: re-created from 20261007000314_usernames_frames.sql:319,
--    now with the counts once and a goal and progress per earned frame.
-- ---------------------------------------------------------------------------
create or replace function app.my_frames()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_frames_0316$
declare
  v_uid    uuid := auth.uid();
  v_frame  text;
  v_played int;
  v_won    int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select avatar_frame into v_frame from profiles where id = v_uid and deleted_at is null;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  v_played := app.matches_played(v_uid);
  v_won    := app.tournaments_won(v_uid);

  return jsonb_build_object(
    'current', v_frame,
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
end $my_frames_0316$;

comment on function app.my_frames() is
  '0314, progress since 0316. The caller''s frame picker: {current, played, tournaments_won, frames: [{id, goal, progress, unlocked}]} in the closed list''s order; goal and progress are NULL for a free frame (always unlocked).';

revoke all on function app.my_frames() from public, anon;
grant execute on function app.my_frames() to authenticated;
