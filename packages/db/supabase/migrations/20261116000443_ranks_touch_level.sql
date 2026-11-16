-- 0443 ranks_touch_level — the ranking rules (Majed, 2026-11-13 to 2026-11-16;
-- docs/design/ranks/plan-2026-11-13.md).
--
-- "Just playing shouldn't make them top." 0364's board summed +2 a win and +1 a loss, so the most
-- active player led it. From here every player has two numbers:
--
--   * Touch Level, 1.0 to 7.0: where a player starts (a Level check by a coach or the desk, else
--     what they said at sign-up), moved after every confirmed game by how the result compared
--     with what the two pairs' levels expected (Elo on the padel scale). Playing more makes it
--     surer, never higher.
--   * Season Race: points per season (ranks_settings.period, now a quarter by default) from the
--     best N match results and best N tournament finishes, with boosts (off-peak hours, club
--     events, a new player on the court). Boosts never touch the Touch Level.
--
-- Every number is an owner setting (Majed 2026-11-16: "everything we set here can be changed in the
-- operator"): ranks_settings.rules holds only what the owner changed, app.ranks_rules() lays it over
-- app.ranks_rules_default(), and app.ranks_rules_check() refuses a value out of range.
--
-- The Touch Level is DERIVED, never stored by hand: app.ranks_rebuild() replays every confirmed
-- game_results row and every Level check in time order into ranks_player_levels (one row a player)
-- and ranks_result_scores (one row a player a result: level before and after, the change, the
-- Race points and the boost). It runs after any statement that confirms, voids or changes a
-- confirmed result, after a Level check, and after a rule change, so a void or a new rule re-scores
-- everyone from history. At about 250 games a month a full replay is cheap; the singleton
-- ranks_rebuild_state row is the mutex (taken last, after every other lock).
--
-- A Level check is any write of profiles.level_confirmed (0368 staff_set_customer_level, 0401
-- coach_set_student_level): the trigger profiles_ranks_level_check copies it into
-- ranks_level_checks. Classes: advanced = A, intermediate = B, beginner = C, new = new. The replay
-- applies a check only when the rules let that role check, no earlier check of the player was
-- applied within check_days, and, on a player past their provisional games, moves the level at
-- most check_max_change; then the player is provisional again. Nobody is blocked from setting a
-- level: a check the rules skip is kept and shown as skipped.
--
-- No index beyond the primary keys: the tables hold a few thousand rows a year and the gate refuses
-- a non-concurrent index (0410's precedent). No new table carries a foreign key to profiles: the cache is rebuilt from game_results (the
-- account merge repoints those, 0364), so profile_merge_columns is not re-issued.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 1. Rules: defaults, the owner's overrides, the check
-- ===========================================================================

alter table ranks_settings add column if not exists rules jsonb not null default '{}'::jsonb;

comment on column ranks_settings.rules is
  '0443. The owner''s changes to the ranking rules, key by key (app.ranks_rules_default() lists every key and its default). A key absent here is its default; app.ranks_rules() merges the two. Written by app.set_ranks_rules only.';

-- Majed 2026-11-13: the Race season is a quarter. Only a row the owner never touched moves.
update ranks_settings set period = 'quarter' where id and period = 'month' and updated_by is null;

create or replace function app.ranks_rules_default() returns jsonb
language sql immutable set search_path = public as $ranks_rules_default_0443$
  select jsonb_build_object(
    -- Boards
    'headline', 'race',            -- which board leads: race | level
    'show_level', true,            -- the level number on the public boards
    'class_b_from', 2.5,           -- C below, B from here
    'class_a_from', 4.0,           -- A from here
    'improved_days', 30,           -- the Most improved window
    'improved_min_games', 4) || jsonb_build_object(
    -- Where a player starts
    'start_a', 4.5, 'start_b', 3.2, 'start_c', 2.0, 'start_new', 1.0,                 -- a Level check
    'self_advanced', 4.5, 'self_intermediate', 3.2, 'self_beginner', 2.0, 'self_new', 1.0,  -- sign-up
    'start_unknown', 2.0,          -- nothing said, nothing checked
    -- How a game moves it
    'scale', 1.0,                  -- a gap this big = the stronger pair expected to win 91%
    'win_weight', 0.7,             -- the rest is the share of games won, when a score is given
    'k_provisional', 0.5, 'k_settling', 0.3, 'k_settled', 0.15,
    'provisional_games', 5, 'settling_games', 20,
    'trust_tournament', 1.0, 'trust_desk', 1.0, 'trust_player', 0.75,
    'repeat_days', 30, 'repeat_half_from', 3, 'repeat_zero_from', 5,
    'soft_loss_below', 2.5, 'soft_loss_factor', 0.6,
    'max_move', 0.25,
    'level_min', 1.0, 'level_max', 7.0) || jsonb_build_object(
    -- On the Touch Level board
    'reliable_games', 6, 'reliable_days', 90, 'reliable_opponents', 4,
    'inactive_days', 45, 'return_games', 3,
    -- Level checks
    'check_roles', jsonb_build_array('coach', 'court_desk', 'manager', 'owner'),
    'check_days', 60, 'check_max_change', 0.5,
    -- Season Race
    'race_win', 10, 'race_strength_max', 2.0, 'race_loss', 2, 'race_draw', 4,
    'race_best_matches', 8, 'race_best_tournaments', 2,
    't_first', 100, 't_second', 60, 't_semi', 36, 't_top_half', 18, 't_played', 8,
    -- Boosts (Race only)
    'boost_offpeak', 1.5, 'boost_event', 2.0, 'boost_welcome', 1.5, 'boost_max_per_season', 3,
    'offpeak', '[]'::jsonb)        -- [{days: [0..6, 0 = Sunday], from: 'HH:MM', to: 'HH:MM'}]
$ranks_rules_default_0443$;

comment on function app.ranks_rules_default() is
  '0443. Internal. Every ranking rule and its default (docs/design/ranks/plan-2026-11-13.md §9a).';

revoke all on function app.ranks_rules_default() from public, anon, authenticated;

create or replace function app.ranks_rules() returns jsonb
language sql stable security definer set search_path = public as $ranks_rules_0443$
  select app.ranks_rules_default() || coalesce((select s.rules from ranks_settings s where s.id), '{}'::jsonb)
$ranks_rules_0443$;

comment on function app.ranks_rules() is
  '0443. Internal. The rules in force: the defaults with the owner''s changes laid over them.';

revoke all on function app.ranks_rules() from public, anon, authenticated;

-- Refuses an override object that names an unknown key or a value out of range: INVALID_ARGUMENT
-- detail the key (unknown), INVALID_VALUE detail the key (bad value or order).
create or replace function app.ranks_rules_check(p_rules jsonb) returns void
language plpgsql stable set search_path = public as $ranks_rules_check_0443$
declare
  v_def  jsonb := app.ranks_rules_default();
  v_all  jsonb;
  v_key  text;
  v_val  jsonb;
  v_n    numeric;
  v_w    jsonb;
  -- key -> [min, max] for the numbers
  v_rng  jsonb := jsonb_build_object(
    'class_b_from', '[1,7]', 'class_a_from', '[1,7]', 'improved_days', '[7,180]', 'improved_min_games', '[1,50]',
    'start_a', '[1,7]', 'start_b', '[1,7]', 'start_c', '[1,7]', 'start_new', '[1,7]',
    'self_advanced', '[1,7]', 'self_intermediate', '[1,7]', 'self_beginner', '[1,7]', 'self_new', '[1,7]',
    'start_unknown', '[1,7]', 'scale', '[0.25,4]', 'win_weight', '[0,1]') || jsonb_build_object(
    'k_provisional', '[0.01,2]', 'k_settling', '[0.01,2]', 'k_settled', '[0.01,2]',
    'provisional_games', '[0,50]', 'settling_games', '[0,200]',
    'trust_tournament', '[0,2]', 'trust_desk', '[0,2]', 'trust_player', '[0,2]',
    'repeat_days', '[0,365]', 'repeat_half_from', '[2,100]', 'repeat_zero_from', '[2,100]',
    'soft_loss_below', '[1,7]', 'soft_loss_factor', '[0,1]', 'max_move', '[0.01,2]',
    'level_min', '[0,7]', 'level_max', '[1,10]',
    'reliable_games', '[1,100]', 'reliable_days', '[7,730]', 'reliable_opponents', '[1,50]',
    'inactive_days', '[7,730]', 'return_games', '[0,50]',
    'check_days', '[0,730]', 'check_max_change', '[0,7]') || jsonb_build_object(
    'race_win', '[0,1000]', 'race_strength_max', '[1,10]', 'race_loss', '[0,1000]', 'race_draw', '[0,1000]',
    'race_best_matches', '[1,100]', 'race_best_tournaments', '[0,50]',
    't_first', '[0,10000]', 't_second', '[0,10000]', 't_semi', '[0,10000]', 't_top_half', '[0,10000]',
    't_played', '[0,10000]',
    'boost_offpeak', '[1,10]', 'boost_event', '[1,10]', 'boost_welcome', '[1,10]',
    'boost_max_per_season', '[0,100]');
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_rules';
  end if;
  for v_key, v_val in select * from jsonb_each(p_rules) loop
    if not v_def ? v_key then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
    if v_rng ? v_key then
      if jsonb_typeof(v_val) <> 'number' then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
      end if;
      v_n := v_val::text::numeric;
      -- A count or a number of days is a whole number (the replay and the boards read it as int).
      if v_key in ('improved_days', 'improved_min_games', 'provisional_games', 'settling_games', 'repeat_days',
                   'repeat_half_from', 'repeat_zero_from', 'reliable_games', 'reliable_days',
                   'reliable_opponents', 'inactive_days', 'return_games', 'check_days',
                   'race_best_matches', 'race_best_tournaments', 'boost_max_per_season')
         and v_n <> trunc(v_n) then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
      end if;
      if v_n < ((v_rng ->> v_key)::jsonb ->> 0)::numeric or v_n > ((v_rng ->> v_key)::jsonb ->> 1)::numeric then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
      end if;
    elsif v_key = 'headline' then
      if v_val #>> '{}' is null or v_val #>> '{}' not in ('race', 'level') then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
      end if;
    elsif v_key = 'show_level' then
      if jsonb_typeof(v_val) <> 'boolean' then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
      end if;
    elsif v_key = 'check_roles' then
      if jsonb_typeof(v_val) <> 'array'
         or exists (select 1 from jsonb_array_elements(v_val) e
                     where jsonb_typeof(e) <> 'string'
                        or e #>> '{}' not in ('coach', 'court_desk', 'manager', 'owner')) then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
      end if;
    elsif v_key = 'offpeak' then
      if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 20 then
        raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
      end if;
      for v_w in select * from jsonb_array_elements(v_val) loop
        if jsonb_typeof(v_w) <> 'object'
           or jsonb_typeof(v_w -> 'days') is distinct from 'array'
           or jsonb_array_length(v_w -> 'days') = 0
           or exists (select 1 from jsonb_array_elements(v_w -> 'days') d
                       where jsonb_typeof(d) <> 'number' or d::text not in ('0','1','2','3','4','5','6'))
           or coalesce(v_w ->> 'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           or coalesce(v_w ->> 'to', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$' then
          raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = v_key;
        end if;
      end loop;
    end if;
  end loop;

  -- The whole set in force must still make sense together.
  v_all := v_def || p_rules;
  if (v_all ->> 'class_a_from')::numeric <= (v_all ->> 'class_b_from')::numeric then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'class_a_from';
  end if;
  if (v_all ->> 'level_max')::numeric <= (v_all ->> 'level_min')::numeric then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'level_max';
  end if;
  if (v_all ->> 'repeat_zero_from')::numeric < (v_all ->> 'repeat_half_from')::numeric then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'repeat_zero_from';
  end if;
  if (v_all ->> 'settling_games')::numeric < (v_all ->> 'provisional_games')::numeric then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'settling_games';
  end if;
  if not ((v_all ->> 't_first')::numeric >= (v_all ->> 't_second')::numeric
          and (v_all ->> 't_second')::numeric >= (v_all ->> 't_semi')::numeric
          and (v_all ->> 't_semi')::numeric >= (v_all ->> 't_top_half')::numeric
          and (v_all ->> 't_top_half')::numeric >= (v_all ->> 't_played')::numeric) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 't_first';
  end if;
end $ranks_rules_check_0443$;

comment on function app.ranks_rules_check(jsonb) is
  '0443. Internal. Refuses an override object: an unknown key INVALID_ARGUMENT (detail the key), a value of the wrong type, out of range or a fraction where a whole count or number of days is meant INVALID_VALUE (detail the key), and a set that contradicts itself (class A not above B, level_max not above level_min, repeat_zero_from below repeat_half_from, settling below provisional, tournament points not falling with the place) INVALID_VALUE.';

revoke all on function app.ranks_rules_check(jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 2. Tiers read the Touch Level
-- ===========================================================================

alter table ranks_levels add column if not exists min_level numeric(3,1);

-- The five default tiers get the plan's levels; any other list is spread from 1.0 in steps of 1.0.
update ranks_levels l
   set min_level = coalesce(
         case l.name_en when 'Rookie' then 0.0 when 'Rising' then 2.0 when 'Contender' then 3.0
                        when 'Elite' then 4.0 when 'Legend' then 5.0 end,
         (select (x.rn - 1)::numeric from (select l2.id, row_number() over (order by l2.min_points) as rn
                                              from ranks_levels l2) x where x.id = l.id))
 where l.min_level is null;

-- The lowest tier always starts at 0, so every level has one.
update ranks_levels l set min_level = 0.0
 where l.id = (select l2.id from ranks_levels l2 order by l2.min_level, l2.min_points limit 1)
   and l.min_level <> 0.0;

do $levels_0443$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ranks_levels_min_level' and conrelid = 'public.ranks_levels'::regclass) then
    alter table ranks_levels add constraint ranks_levels_min_level
      check (min_level is not null and min_level between 0 and 10) not valid;
    alter table ranks_levels validate constraint ranks_levels_min_level;
  end if;
end $levels_0443$;

comment on column ranks_levels.min_level is
  '0443. The Touch Level a player needs for this tier; the lowest tier starts at 0. min_points (0364) is kept for older builds and written as min_level x 100.';

-- ===========================================================================
-- 3. Level checks and the derived tables
-- ===========================================================================

create table if not exists ranks_level_checks (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated by default as identity,
  profile_id  uuid not null,
  level       text not null check (level in ('new', 'beginner', 'intermediate', 'advanced')),
  checked_by  uuid,
  role        text check (role is null or role in ('coach', 'court_desk', 'manager', 'owner')),
  checked_at  timestamptz not null default now(),
  note        text check (note is null or char_length(note) <= 120),
  applied       boolean not null default false,
  applied_level numeric(5,3)
);

comment on table ranks_level_checks is
  '0443. Every Level check (seq = the order given, so two checks in one moment replay in order), appended by the profiles_ranks_level_check trigger when profiles.level_confirmed is written (a coach, the court desk, a manager or the owner): the class (advanced = A, intermediate = B, beginner = C, new), who, their role, when and the note. The replay (app.ranks_rebuild) decides whether each one moves the Touch Level and writes applied / applied_level (the level it set) back on every replay. No foreign key to profiles (the cache is rebuilt from game_results); no client grant.';

create table if not exists ranks_player_levels (
  profile_id       uuid primary key,
  level            numeric(5,3) not null,
  start_level      numeric(5,3) not null,
  games            int not null default 0,
  provisional_left int not null default 0,
  first_game_at    timestamptz,
  last_game_at     timestamptz,
  last_check_at    timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table ranks_player_levels is
  '0443. Derived by app.ranks_rebuild, never written otherwise: each player''s Touch Level after every confirmed result and Level check, where they started, how many rated games, how many provisional games are left, their first and last rated game and their last applied check. No client grant.';

create table if not exists ranks_result_scores (
  result_id    uuid not null,
  profile_id   uuid not null,
  played_at    timestamptz not null,
  source       text not null,
  won          text not null check (won in ('won', 'lost', 'draw')),
  level_before numeric(5,3) not null,
  level_after  numeric(5,3) not null,
  expected     numeric(5,4) not null,
  race_points  numeric(8,2) not null default 0,
  boost        numeric(4,2) not null default 1,
  boost_kind   text check (boost_kind is null or boost_kind in ('offpeak', 'welcome')),
  season_start timestamptz not null,
  opponents    uuid[] not null default '{}',
  primary key (result_id, profile_id)
);

comment on table ranks_result_scores is
  '0443. Derived by app.ranks_rebuild: one row a player a confirmed result: the Touch Level before and after, what the levels expected (expected, their side''s chance), the Race points (0 for a tournament match: a tournament scores by its finish) after any boost, the boost and why, the season it counts in, and the opponents'' ids (for the distinct-opponent count). No client grant.';

create table if not exists ranks_rebuild_state (
  id         boolean primary key default true check (id),
  rebuilt_at timestamptz,
  results    int not null default 0,
  ms         int not null default 0
);

comment on table ranks_rebuild_state is
  '0443. One row: when the Touch Level was last replayed, over how many results, in how many milliseconds. app.ranks_rebuild takes it FOR UPDATE first, so two replays never interleave. No client grant.';

insert into ranks_rebuild_state (id) values (true) on conflict (id) do nothing;

alter table ranks_level_checks  enable row level security;
alter table ranks_player_levels enable row level security;
alter table ranks_result_scores enable row level security;
alter table ranks_rebuild_state enable row level security;
revoke all on ranks_level_checks, ranks_player_levels, ranks_result_scores, ranks_rebuild_state
  from anon, authenticated;

-- The checks already given (0368, 0401) are the history the replay starts from.
insert into ranks_level_checks (profile_id, level, checked_by, role, checked_at, note)
select p.id, p.level_confirmed, p.level_confirmed_by, p.level_confirmed_role, p.level_confirmed_at, p.level_note
  from profiles p
 where p.level_confirmed is not null and p.deleted_at is null
   and not exists (select 1 from ranks_level_checks c where c.profile_id = p.id);

-- ===========================================================================
-- 4. The replay
-- ===========================================================================

-- A score "6-4, 7-5" as games won by side A and side B; NULL for no score.
create or replace function app.ranks_score_games(p_score text) returns int[]
language sql immutable set search_path = public as $ranks_score_games_0443$
  select case when nullif(btrim(p_score), '') is null then null else
    array[sum(split_part(s, '-', 1)::int)::int, sum(split_part(s, '-', 2)::int)::int] end
    from unnest(string_to_array(coalesce(p_score, ''), ', ')) s
   where s ~ '^[0-9]{1,2}-[0-9]{1,2}$'
$ranks_score_games_0443$;

comment on function app.ranks_score_games(text) is
  '0443. Internal. Games won by side A and by side B over every set of a score, or NULL.';

revoke all on function app.ranks_score_games(text) from public, anon, authenticated;

-- Where a player starts before any game: their last applied check, else what they said at sign-up.
create or replace function app.ranks_seed(p_profile_id uuid, p_rules jsonb) returns numeric
language sql stable security definer set search_path = public as $ranks_seed_0443$
  select coalesce((p_rules ->> ('self_' || p.play_level))::numeric, (p_rules ->> 'start_unknown')::numeric)
    from (select (select pr.play_level from profiles pr where pr.id = p_profile_id) as play_level) p
$ranks_seed_0443$;

comment on function app.ranks_seed(uuid, jsonb) is
  '0443. Internal. A player''s starting Touch Level from their sign-up level (self_new, self_beginner, self_intermediate, self_advanced), start_unknown when they said nothing.';

revoke all on function app.ranks_seed(uuid, jsonb) from public, anon, authenticated;

-- Is a moment inside the owner's off-peak hours, in the branch's clock?
create or replace function app.ranks_is_offpeak(p_at timestamptz, p_venue uuid, p_windows jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $ranks_is_offpeak_0443$
declare
  v_tz    text;
  v_local timestamp;
  v_dow   int;
  v_min   int;
  v_w     jsonb;
  v_from  int;
  v_to    int;
begin
  if p_windows is null or jsonb_array_length(p_windows) = 0 then
    return false;
  end if;
  select vs.timezone into v_tz from venue_settings vs where vs.venue_id = p_venue;
  v_local := p_at at time zone coalesce(nullif(v_tz, ''), 'Asia/Baghdad');
  v_dow := extract(dow from v_local)::int;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  for v_w in select * from jsonb_array_elements(p_windows) loop
    v_from := split_part(v_w ->> 'from', ':', 1)::int * 60 + split_part(v_w ->> 'from', ':', 2)::int;
    v_to   := split_part(v_w ->> 'to', ':', 1)::int * 60 + split_part(v_w ->> 'to', ':', 2)::int;
    if (v_w -> 'days') @> to_jsonb(v_dow) and v_min >= v_from and v_min < v_to then
      return true;
    end if;
  end loop;
  return false;
end $ranks_is_offpeak_0443$;

comment on function app.ranks_is_offpeak(timestamptz, uuid, jsonb) is
  '0443. Internal. Whether a moment falls in one of the owner''s off-peak windows ({days, from, to}, 0 = Sunday) in the branch''s time zone.';

revoke all on function app.ranks_is_offpeak(timestamptz, uuid, jsonb) from public, anon, authenticated;

-- The start of the Race season holding a moment.
create or replace function app.ranks_season_of(p_at timestamptz, p_period text) returns timestamptz
language plpgsql stable security definer set search_path = public as $ranks_season_of_0443$
declare
  v_tz text;
begin
  if p_period = 'all' then
    return '-infinity'::timestamptz;
  end if;
  select vs.timezone into v_tz from venue_settings vs where vs.venue_id = app.current_venue_or_default();
  v_tz := coalesce(nullif(v_tz, ''), 'Asia/Baghdad');
  return date_trunc(case when p_period = 'quarter' then 'quarter' else 'month' end, p_at at time zone v_tz)
         at time zone v_tz;
end $ranks_season_of_0443$;

comment on function app.ranks_season_of(timestamptz, text) is
  '0443. Internal. The start of the season (month or quarter in the default branch''s clock, -infinity for all) that holds a moment; app.ranks_period_start is this for now().';

revoke all on function app.ranks_season_of(timestamptz, text) from public, anon, authenticated;

create or replace function app.ranks_rebuild() returns void
language plpgsql security definer set search_path = public as $ranks_rebuild_0443$
declare
  v_t0     timestamptz := clock_timestamp();
  v_r      jsonb := app.ranks_rules();
  v_period text := (select s.period from ranks_settings s where s.id);
  v_ev     record;
  v_side   record;
  v_p      uuid;
  v_lv     numeric;
  v_games  int;
  v_prov   int;
  v_ret    int;
  v_last   timestamptz;
  v_lastck timestamptz;
  v_team   numeric[];
  v_exp    numeric;
  v_act    numeric;
  v_res    numeric;
  v_share  numeric;
  v_g      int[];
  v_trust  numeric;
  v_rep    numeric;
  v_seen   int;
  v_k      numeric;
  v_delta  numeric;
  v_new    numeric;
  v_race   numeric;
  v_boost  numeric;
  v_bkind  text;
  v_season timestamptz;
  v_used   int;
  v_welcome boolean;
  v_offpeak boolean;
  v_n      int := 0;
  -- the rules, read once
  c_scale  numeric := (v_r ->> 'scale')::numeric;
  c_w      numeric := (v_r ->> 'win_weight')::numeric;
  c_kp     numeric := (v_r ->> 'k_provisional')::numeric;
  c_ks     numeric := (v_r ->> 'k_settling')::numeric;
  c_kd     numeric := (v_r ->> 'k_settled')::numeric;
  c_pg     int     := (v_r ->> 'provisional_games')::int;
  c_sg     int     := (v_r ->> 'settling_games')::int;
  c_min    numeric := (v_r ->> 'level_min')::numeric;
  c_max    numeric := (v_r ->> 'level_max')::numeric;
  c_move   numeric := (v_r ->> 'max_move')::numeric;
  c_softb  numeric := (v_r ->> 'soft_loss_below')::numeric;
  c_softf  numeric := (v_r ->> 'soft_loss_factor')::numeric;
  c_rdays  int     := (v_r ->> 'repeat_days')::int;
  c_rhalf  int     := (v_r ->> 'repeat_half_from')::int;
  c_rzero  int     := (v_r ->> 'repeat_zero_from')::int;
  c_inact  int     := (v_r ->> 'inactive_days')::int;
  c_ret    int     := (v_r ->> 'return_games')::int;
  c_ckdays int     := (v_r ->> 'check_days')::int;
  c_ckmax  numeric := (v_r ->> 'check_max_change')::numeric;
  c_bmax   int     := (v_r ->> 'boost_max_per_season')::int;
begin
  -- The mutex, taken after every lock the caller already holds.
  perform 1 from ranks_rebuild_state where id for update;

  create temp table if not exists _rk_lv (
    profile_id uuid primary key, level numeric, start_level numeric, games int, prov int,
    first_at timestamptz, last_at timestamptz, last_check timestamptz, ret int not null default 0)
    on commit drop;
  create temp table if not exists _rk_seen (k text, at timestamptz) on commit drop;
  create temp table if not exists _rk_boost (profile_id uuid, season timestamptz, used int,
                                            primary key (profile_id, season)) on commit drop;
  truncate _rk_lv, _rk_seen, _rk_boost;

  delete from ranks_result_scores where true;
  update ranks_level_checks set applied = false, applied_level = null where applied or applied_level is not null;

  -- Every event in time order: a Level check (kind 0, before a game at the same moment) or a result.
  for v_ev in
    select 0 as kind, c.checked_at as at, c.seq as ord, c.id, c.profile_id, c.level, c.role,
           null::text as source, null::uuid as venue_id, null::uuid as reservation_id,
           null::uuid as a1, null::uuid as a2, null::uuid as b1, null::uuid as b2,
           null::text as winner, null::text as score
      from ranks_level_checks c
    union all
    select 1, g.played_at, 0::bigint, g.id, null, null, null, g.source, g.venue_id, g.reservation_id,
           g.a1, g.a2, g.b1, g.b2, g.winner, g.score
      from game_results g
     where g.status = 'confirmed'
    order by 2, 1, 3, 4   -- time, checks first, checks in the order given (seq), then id
  loop
    if v_ev.kind = 0 then
      -- A Level check: only roles the rules allow, one per check_days, capped on a settled player.
      if not ((v_r -> 'check_roles') ? coalesce(v_ev.role, '')) then
        continue;
      end if;
      select l.level, l.games, l.last_check into v_lv, v_games, v_lastck from _rk_lv l where l.profile_id = v_ev.profile_id;
      if v_lastck is not null and v_ev.at < v_lastck + make_interval(days => c_ckdays) then
        continue;
      end if;
      v_new := (v_r ->> case v_ev.level when 'advanced' then 'start_a' when 'intermediate' then 'start_b'
                                       when 'beginner' then 'start_c' else 'start_new' end)::numeric;
      if v_lv is not null and v_games >= c_pg then
        v_new := greatest(v_lv - c_ckmax, least(v_lv + c_ckmax, v_new));
      end if;
      update ranks_level_checks set applied = true, applied_level = round(v_new, 3) where id = v_ev.id;
      insert into _rk_lv (profile_id, level, start_level, games, prov, last_check)
      values (v_ev.profile_id, v_new, v_new, 0, c_pg, v_ev.at)
      on conflict (profile_id) do update
        set level = excluded.level, prov = c_pg, last_check = excluded.last_check,
            start_level = case when _rk_lv.games = 0 then excluded.level else _rk_lv.start_level end;
      continue;
    end if;

    v_n := v_n + 1;
    -- Make sure every player on the game has a level (their seed) before reading the teams.
    insert into _rk_lv (profile_id, level, start_level, games, prov)
    select u.p, app.ranks_seed(u.p, v_r), app.ranks_seed(u.p, v_r), 0, c_pg
      from unnest(array[v_ev.a1, v_ev.a2, v_ev.b1, v_ev.b2]) u(p)
     where u.p is not null
    on conflict (profile_id) do nothing;

    -- A pair's level: the average of its players (a missing second seat counts the one there).
    select array[(select avg(l.level) from _rk_lv l where l.profile_id in (v_ev.a1, v_ev.a2)),
                 (select avg(l.level) from _rk_lv l where l.profile_id in (v_ev.b1, v_ev.b2))]
      into v_team;
    v_exp := 1 / (1 + power(10::numeric, (v_team[2] - v_team[1]) / c_scale));   -- side A's chance
    v_res := case v_ev.winner when 'a' then 1 when 'b' then 0 else 0.5 end;
    v_g := app.ranks_score_games(v_ev.score);
    if v_g is not null and (v_g[1] + v_g[2]) > 0 then
      v_share := v_g[1]::numeric / (v_g[1] + v_g[2]);
      v_act := c_w * v_res + (1 - c_w) * v_share;
    else
      v_act := v_res;
    end if;
    v_trust := (v_r ->> ('trust_' || case v_ev.source when 'tournament' then 'tournament'
                                                     when 'desk' then 'desk' else 'player' end))::numeric;

    -- The same four players again inside repeat_days count less, then nothing.
    select count(*)::int + 1 into v_seen from _rk_seen s
     where s.k = array_to_string(array(select x from unnest(array[v_ev.a1, v_ev.a2, v_ev.b1, v_ev.b2]::text[]) x
                                        where x is not null order by x), ',')
       and s.at > v_ev.at - make_interval(days => c_rdays);
    v_rep := case when v_seen >= c_rzero then 0 when v_seen >= c_rhalf then 0.5 else 1 end;
    insert into _rk_seen values (array_to_string(array(select x from unnest(array[v_ev.a1, v_ev.a2, v_ev.b1, v_ev.b2]::text[]) x
                                                       where x is not null order by x), ','), v_ev.at);

    -- Boosts (Race only): a game in off-peak hours, or one with a player on their first rated game.
    v_offpeak := v_ev.source <> 'tournament' and app.ranks_is_offpeak(
                   coalesce((select rv.start_at from reservations rv where rv.id = v_ev.reservation_id), v_ev.at),
                   v_ev.venue_id, v_r -> 'offpeak');
    v_welcome := exists (select 1 from _rk_lv l where l.profile_id in (v_ev.a1, v_ev.a2, v_ev.b1, v_ev.b2)
                                                 and l.games = 0);
    v_season := app.ranks_season_of(v_ev.at, v_period);

    for v_side in
      select x.p, x.side from (values (v_ev.a1, 'a'), (v_ev.a2, 'a'), (v_ev.b1, 'b'), (v_ev.b2, 'b')) as x(p, side)
       where x.p is not null
    loop
      v_p := v_side.p;
      select l.level, l.games, l.prov, l.last_at, l.ret into v_lv, v_games, v_prov, v_last, v_ret
        from _rk_lv l where l.profile_id = v_p;
      -- Back after a long break: this game and the next ones (return_games in all) move like a
      -- settling player's, because the level is less certain.
      if v_last is not null and v_ev.at > v_last + make_interval(days => c_inact) then
        v_ret := c_ret;
      end if;
      v_k := case when v_prov > 0 then c_kp
                  when v_games < c_sg or v_ret > 0 then c_ks
                  else c_kd end;
      v_delta := v_k * v_trust * v_rep * (case when v_side.side = 'a' then v_act - v_exp else (1 - v_act) - (1 - v_exp) end);
      -- A win never lowers a level and a loss never raises it (a 6-2 6-2 win over a much weaker
      -- pair is below what was expected in games, but it is still a win).
      if v_ev.winner = v_side.side then
        v_delta := greatest(v_delta, 0);
      elsif v_ev.winner <> 'draw' then
        v_delta := least(v_delta, 0);
      end if;
      if v_delta < 0 and v_lv < c_softb then
        v_delta := v_delta * c_softf;
      end if;
      v_delta := greatest(-c_move, least(c_move, v_delta));
      v_new := greatest(c_min, least(c_max, v_lv + v_delta));

      -- Race points: a win is worth more against a stronger pair; a tournament match scores 0 here.
      if v_ev.source = 'tournament' then
        v_race := 0;
      elsif v_ev.winner = 'draw' then
        v_race := (v_r ->> 'race_draw')::numeric;
      elsif v_ev.winner = v_side.side then
        v_race := (v_r ->> 'race_win')::numeric
                  * least((v_r ->> 'race_strength_max')::numeric,
                          1 + greatest(0, case when v_side.side = 'a' then v_team[2] - v_team[1]
                                               else v_team[1] - v_team[2] end));
      else
        v_race := (v_r ->> 'race_loss')::numeric;
      end if;
      v_boost := 1; v_bkind := null;
      if v_race > 0 and (v_offpeak or v_welcome) then
        select b.used into v_used from _rk_boost b where b.profile_id = v_p and b.season = v_season;
        if coalesce(v_used, 0) < c_bmax then
          if v_offpeak and (not v_welcome or (v_r ->> 'boost_offpeak')::numeric >= (v_r ->> 'boost_welcome')::numeric) then
            v_boost := (v_r ->> 'boost_offpeak')::numeric; v_bkind := 'offpeak';
          else
            v_boost := (v_r ->> 'boost_welcome')::numeric; v_bkind := 'welcome';
          end if;
          if v_boost > 1 then
            insert into _rk_boost values (v_p, v_season, 1)
            on conflict (profile_id, season) do update set used = _rk_boost.used + 1;
          else
            v_bkind := null;
          end if;
        end if;
        v_used := null;
      end if;

      insert into ranks_result_scores (result_id, profile_id, played_at, source, won, level_before, level_after,
                                       expected, race_points, boost, boost_kind, season_start, opponents)
      values (v_ev.id, v_p, v_ev.at, v_ev.source,
              case when v_ev.winner = 'draw' then 'draw' when v_ev.winner = v_side.side then 'won' else 'lost' end,
              round(v_lv, 3), round(v_new, 3),
              round(case when v_side.side = 'a' then v_exp else 1 - v_exp end, 4),
              round(v_race * v_boost, 2), v_boost, v_bkind, v_season,
              array(select o from unnest(case when v_side.side = 'a' then array[v_ev.b1, v_ev.b2]
                                              else array[v_ev.a1, v_ev.a2] end) o where o is not null));

      update _rk_lv
         set level = v_new, prov = greatest(prov - 1, 0), games = games + 1, ret = greatest(v_ret - 1, 0),
             first_at = coalesce(first_at, v_ev.at), last_at = v_ev.at
       where profile_id = v_p;
    end loop;
  end loop;

  delete from ranks_player_levels where true;
  insert into ranks_player_levels (profile_id, level, start_level, games, provisional_left, first_game_at,
                                   last_game_at, last_check_at, updated_at)
  select l.profile_id, round(l.level, 3), round(l.start_level, 3), l.games, l.prov, l.first_at, l.last_at,
         l.last_check, now()
    from _rk_lv l;

  update ranks_rebuild_state
     set rebuilt_at = now(), results = v_n,
         ms = (extract(epoch from clock_timestamp() - v_t0) * 1000)::int
   where id;
end $ranks_rebuild_0443$;

comment on function app.ranks_rebuild() is
  '0443. Internal. Replays every Level check and confirmed result in time order under app.ranks_rules() into ranks_player_levels and ranks_result_scores (both emptied first): seeds (a check, else the sign-up level), the expected result from the pairs'' average levels, the actual (win weight plus the games share when scored), K by provisional / settling / settled and a long break, trust by source, repeat damping, softer losses below soft_loss_below, max_move, level_min/max; Race points (0 for a tournament match), off-peak and welcome boosts up to boost_max_per_season a player a season. Takes ranks_rebuild_state FOR UPDATE first.';

revoke all on function app.ranks_rebuild() from public, anon, authenticated;

-- ===========================================================================
-- 5. When it replays
-- ===========================================================================

create or replace function app.trg_ranks_results_rebuild() returns trigger
language plpgsql security definer set search_path = public as $trg_ranks_results_rebuild_0443$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from new_rows n where n.status = 'confirmed') then
      perform app.ranks_rebuild();
    end if;
  elsif exists (select 1 from new_rows n join old_rows o on o.id = n.id
                 where (n.status = 'confirmed') is distinct from (o.status = 'confirmed')
                    or (n.status = 'confirmed'
                        and (row(n.a1, n.a2, n.b1, n.b2, n.winner, n.score, n.played_at)
                             is distinct from row(o.a1, o.a2, o.b1, o.b2, o.winner, o.score, o.played_at)))) then
    perform app.ranks_rebuild();
  end if;
  return null;
end $trg_ranks_results_rebuild_0443$;

comment on function app.trg_ranks_results_rebuild() is
  '0443. AFTER INSERT / UPDATE statement trigger on game_results: replays the Touch Level when a statement confirmed a result, took one out of confirmed (void, correction) or changed a confirmed one''s players, winner, score or time (an account merge''s repoint).';

revoke all on function app.trg_ranks_results_rebuild() from public, anon, authenticated;

drop trigger if exists game_results_ranks_rebuild_ins on public.game_results;
create trigger game_results_ranks_rebuild_ins after insert on public.game_results
  referencing new table as new_rows for each statement execute function app.trg_ranks_results_rebuild();
drop trigger if exists game_results_ranks_rebuild_upd on public.game_results;
create trigger game_results_ranks_rebuild_upd after update on public.game_results
  referencing new table as new_rows old table as old_rows
  for each statement execute function app.trg_ranks_results_rebuild();

create or replace function app.trg_profile_ranks_level_check() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_ranks_level_check_0443$
begin
  insert into ranks_level_checks (profile_id, level, checked_by, role, checked_at, note)
  values (new.id, new.level_confirmed, new.level_confirmed_by, new.level_confirmed_role,
          coalesce(new.level_confirmed_at, now()), new.level_note);
  perform app.ranks_rebuild();
  return null;
end $trg_profile_ranks_level_check_0443$;

comment on function app.trg_profile_ranks_level_check() is
  '0443. AFTER UPDATE OF level_confirmed, level_confirmed_at on profiles (a new judgment, not a clear): records it as a Level check and replays the Touch Level.';

revoke all on function app.trg_profile_ranks_level_check() from public, anon, authenticated;

drop trigger if exists profiles_ranks_level_check on public.profiles;
create trigger profiles_ranks_level_check after update of level_confirmed, level_confirmed_at on public.profiles
  for each row
  when (new.level_confirmed is not null
        and (new.level_confirmed is distinct from old.level_confirmed
             or new.level_confirmed_at is distinct from old.level_confirmed_at))
  execute function app.trg_profile_ranks_level_check();

-- The first replay, over everything played so far.
select app.ranks_rebuild();
