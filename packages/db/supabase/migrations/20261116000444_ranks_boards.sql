-- 0444 ranks_boards — what the phone and the operator read from 0443's Touch Level and Season Race
-- (docs/design/ranks/plan-2026-11-13.md §4, §5, §6, §9, §9a).
--
--   * app.ranks_board() (anon) re-issued: the headline board the owner picked (Majed 2026-11-16:
--     a switch, default the Race), the Race top N, the Touch Level top N (reliable players only),
--     the top N of each class A / B / C and Most improved. `rows` stays, the Race board in 0364's
--     shape, so a phone built before this keeps showing a board.
--   * app.my_ranks() re-issued: 0364's keys (points and rank are now the Race's, level and
--     next_level the tier the Touch Level reaches) plus `touch` (the level, reliability, class,
--     tier, "higher than X% of players", the last games' levels) and `race` (points, rank, what
--     counted, boosts used).
--   * app.ranks_result_json re-issued: + level_change and boost; `points` is the result's Race
--     points (rounded).
--   * app.ranks_admin() re-issued: + rules (in force), defaults, overrides, the last replay.
--   * app.set_ranks_rules(p_rules) new (owner): replaces the overrides, checked by
--     app.ranks_rules_check, audited ranks.rules, replays everyone.
--   * app.set_ranks_levels re-issued: tiers by min_level (min_points from an older operator build
--     is read as hundredths of a level).
--   * app.ranks_level_checks_list(p_limit) new (manager, owner): every Level check, who gave it,
--     whether the rules applied it, and where the player's level went in the 20 games after.
--   * app.ranks_results_to_check(p_days) new (court desk, manager, owner): the same four players
--     with the winner flipped within 7 days, to look at and void if they were traded.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 1. Internal helpers
-- ===========================================================================

-- The tier a Touch Level reaches: {name_en, name_ar, min_level, min_points}.
create or replace function app.ranks_tier_json(p_level numeric) returns jsonb
language sql stable security definer set search_path = public as $ranks_tier_json_0444$
  select coalesce(
    (select jsonb_build_object('name_en', l.name_en, 'name_ar', l.name_ar, 'min_level', l.min_level,
                               'min_points', l.min_points)
       from ranks_levels l where l.min_level <= round(coalesce(p_level, 0), 1)
      order by l.min_level desc limit 1),
    jsonb_build_object('name_en', null, 'name_ar', null, 'min_level', 0, 'min_points', 0))
$ranks_tier_json_0444$;

comment on function app.ranks_tier_json(numeric) is
  '0444. Internal. The tier a Touch Level reaches (the highest min_level at or below it, read at one decimal as the boards show it).';

revoke all on function app.ranks_tier_json(numeric) from public, anon, authenticated;

create or replace function app.ranks_class(p_level numeric, p_rules jsonb) returns text
language sql immutable set search_path = public as $ranks_class_0444$
  select case when round(p_level, 1) >= (p_rules ->> 'class_a_from')::numeric then 'A'
              when round(p_level, 1) >= (p_rules ->> 'class_b_from')::numeric then 'B' else 'C' end
$ranks_class_0444$;

comment on function app.ranks_class(numeric, jsonb) is '0444. Internal. A Touch Level''s class (read at one decimal): A, B or C by the rules'' bands.';

revoke all on function app.ranks_class(numeric, jsonb) from public, anon, authenticated;

-- Every rated live player with what the boards need: level, games and different opponents in the
-- reliable window, last game, reliable or not, class.
create or replace function app.ranks_player_stats(p_rules jsonb)
returns table (profile_id uuid, level numeric, games int, provisional_left int, games_window int,
               opponents_window int, last_game_at timestamptz, reliable boolean, klass text)
language sql stable security definer set search_path = public as $ranks_player_stats_0444$
  select l.profile_id, l.level, l.games, l.provisional_left,
         coalesce(w.games, 0), coalesce(w.opponents, 0), l.last_game_at,
         coalesce(w.games, 0) >= (p_rules ->> 'reliable_games')::int
           and coalesce(w.opponents, 0) >= (p_rules ->> 'reliable_opponents')::int
           and l.provisional_left = 0
           and l.last_game_at > now() - make_interval(days => (p_rules ->> 'inactive_days')::int),
         app.ranks_class(l.level, p_rules)
    from ranks_player_levels l
    join profiles p on p.id = l.profile_id and p.deleted_at is null
    left join lateral (
      select count(distinct s.result_id)::int as games,
             (select count(distinct o)::int
                from ranks_result_scores s2, unnest(s2.opponents) o
               where s2.profile_id = l.profile_id
                 and s2.played_at > now() - make_interval(days => (p_rules ->> 'reliable_days')::int)) as opponents
        from ranks_result_scores s
       where s.profile_id = l.profile_id
         and s.played_at > now() - make_interval(days => (p_rules ->> 'reliable_days')::int)) w on true
   where l.games > 0
$ranks_player_stats_0444$;

comment on function app.ranks_player_stats(jsonb) is
  '0444. Internal. Each live player with a rated game: level, games, provisional games left, games and distinct opponents in reliable_days, last game, reliable (enough of both, not provisional, played within inactive_days) and class.';

revoke all on function app.ranks_player_stats(jsonb) from public, anon, authenticated;

-- A finished tournament's place points for each player, in the season from p_from.
create or replace function app.ranks_tournament_points(p_rules jsonb, p_from timestamptz)
returns table (profile_id uuid, tournament_id uuid, points numeric)
language plpgsql stable security definer set search_path = public as $ranks_tournament_points_0444$
declare
  v_t record;
  v_n int;
begin
  if not coalesce((select s.count_tournaments from ranks_settings s where s.id), false) then
    return;
  end if;
  for v_t in select t.id from tournaments t
              where t.status = 'finished' and t.finished_at >= p_from and t.finished_at <= now() loop
    select count(*)::int into v_n from app.tournament_standings(v_t.id) st where not st.withdrawn;
    return query
      select e.guest_id, v_t.id,
             round((case when st.rank = 1 then (p_rules ->> 't_first')::numeric
                         when st.rank = 2 then (p_rules ->> 't_second')::numeric
                         when st.rank <= 4 then (p_rules ->> 't_semi')::numeric
                         when st.rank <= ceil(v_n / 2.0) then (p_rules ->> 't_top_half')::numeric
                         else (p_rules ->> 't_played')::numeric end)
                   * (p_rules ->> 'boost_event')::numeric, 2)
        from app.tournament_standings(v_t.id) st
        join tournament_entries e on e.id = st.entry_id
       where not st.withdrawn and st.played > 0;
  end loop;
end $ranks_tournament_points_0444$;

comment on function app.ranks_tournament_points(jsonb, timestamptz) is
  '0444. Internal. While count_tournaments is on: for each tournament finished since p_from, each player who played in it and did not withdraw gets t_first (1st), t_second (2nd), t_semi (3rd-4th), t_top_half (top half) or t_played, times boost_event.';

revoke all on function app.ranks_tournament_points(jsonb, timestamptz) from public, anon, authenticated;

-- Each player's Race points in the season from p_from: the best race_best_matches match results,
-- the best race_best_tournaments finishes and the owner's adjustments in the season.
create or replace function app.ranks_race(p_rules jsonb, p_from timestamptz)
returns table (profile_id uuid, points numeric, matches int, matches_counted int, tournaments int,
               last_at timestamptz)
language sql stable security definer set search_path = public as $ranks_race_0444$
  with m as (
    select s.profile_id, s.race_points, s.played_at,
           row_number() over (partition by s.profile_id order by s.race_points desc, s.played_at) as rn
      from ranks_result_scores s
     where s.season_start = app.ranks_season_of(p_from, (select st.period from ranks_settings st where st.id))
       and s.source <> 'tournament'
  ), t as (
    select tp.profile_id, tp.points,
           row_number() over (partition by tp.profile_id order by tp.points desc) as rn
      from app.ranks_tournament_points(p_rules, p_from) tp
  ), adj as (
    select l.profile_id, sum(l.delta)::numeric as points, max(l.earned_at) as last_at
      from ranks_ledger l where l.kind = 'adjust' and l.earned_at >= p_from group by l.profile_id
  ), ids as (
    select m.profile_id from m union select t.profile_id from t union select adj.profile_id from adj
  )
  select i.profile_id,
         coalesce((select sum(m.race_points) from m where m.profile_id = i.profile_id
                     and m.rn <= (p_rules ->> 'race_best_matches')::int), 0)
         + coalesce((select sum(t.points) from t where t.profile_id = i.profile_id
                       and t.rn <= (p_rules ->> 'race_best_tournaments')::int), 0)
         + coalesce((select a.points from adj a where a.profile_id = i.profile_id), 0),
         (select count(*)::int from m where m.profile_id = i.profile_id),
         (select count(*)::int from m where m.profile_id = i.profile_id
             and m.rn <= (p_rules ->> 'race_best_matches')::int),
         (select count(*)::int from t where t.profile_id = i.profile_id),
         greatest((select max(m.played_at) from m where m.profile_id = i.profile_id),
                  (select a.last_at from adj a where a.profile_id = i.profile_id))
    from ids i
    join profiles p on p.id = i.profile_id and p.deleted_at is null
$ranks_race_0444$;

comment on function app.ranks_race(jsonb, timestamptz) is
  '0444. Internal. The Race in the season from p_from: per live player, the sum of their best race_best_matches match results (ranks_result_scores, tournament matches excluded), best race_best_tournaments tournament finishes (app.ranks_tournament_points) and the owner''s adjustments (ranks_ledger kind adjust) in the season; with how many matches they played and how many counted, tournaments, and their last scoring moment.';

revoke all on function app.ranks_race(jsonb, timestamptz) from public, anon, authenticated;

-- The rule numbers a player may see (the phone's "6 games against 4 people", boost sizes, best N).
create or replace function app.ranks_public_rules(p_rules jsonb) returns jsonb
language sql immutable set search_path = public as $ranks_public_rules_0444$
  select jsonb_build_object(
    'reliable_games', (p_rules ->> 'reliable_games')::int,
    'reliable_opponents', (p_rules ->> 'reliable_opponents')::int,
    'reliable_days', (p_rules ->> 'reliable_days')::int,
    'inactive_days', (p_rules ->> 'inactive_days')::int,
    'provisional_games', (p_rules ->> 'provisional_games')::int,
    'improved_days', (p_rules ->> 'improved_days')::int,
    'improved_min_games', (p_rules ->> 'improved_min_games')::int,
    'class_b_from', (p_rules ->> 'class_b_from')::numeric,
    'class_a_from', (p_rules ->> 'class_a_from')::numeric,
    'race_win', (p_rules ->> 'race_win')::numeric,
    'race_loss', (p_rules ->> 'race_loss')::numeric,
    'race_draw', (p_rules ->> 'race_draw')::numeric,
    'race_strength_max', (p_rules ->> 'race_strength_max')::numeric,
    'race_best_matches', (p_rules ->> 'race_best_matches')::int,
    'race_best_tournaments', (p_rules ->> 'race_best_tournaments')::int,
    'boost_offpeak', (p_rules ->> 'boost_offpeak')::numeric,
    'boost_event', (p_rules ->> 'boost_event')::numeric,
    'boost_welcome', (p_rules ->> 'boost_welcome')::numeric,
    'boost_max_per_season', (p_rules ->> 'boost_max_per_season')::int)
$ranks_public_rules_0444$;

comment on function app.ranks_public_rules(jsonb) is
  '0444. Internal. The rule numbers shown to players: reliability gates, the improved window, class bands, Race points and best N, boost sizes and cap. Never the offpeak hours or who may check.';

revoke all on function app.ranks_public_rules(jsonb) from public, anon, authenticated;

-- A board row's public face: rank, "First L.", mine.
create or replace function app.ranks_row_json(p_rank bigint, p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public as $ranks_row_json_0444$
  select jsonb_build_object('rank', p_rank, 'name', app.match_display_name(p_profile_id) -> 'name',
                            'mine', coalesce(p_profile_id = auth.uid(), false))
$ranks_row_json_0444$;

comment on function app.ranks_row_json(bigint, uuid) is '0444. Internal. {rank, name ("First L."), mine}: never an id.';

revoke all on function app.ranks_row_json(bigint, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. The public board
-- ===========================================================================

create or replace function app.ranks_board() returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_board_0444$
declare
  v_s     ranks_settings%rowtype;
  v_r     jsonb := app.ranks_rules();
  v_from  timestamptz;
  v_show  boolean := (v_r ->> 'show_level')::boolean;
  v_race  jsonb;
  v_level jsonb;
  v_class jsonb;
  v_imp   jsonb;
begin
  select * into v_s from ranks_settings where id;
  if not v_s.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  v_from := app.ranks_period_start(v_s.period);

  -- The Race: points this season, a tie shares a rank, who got there first listed first.
  select coalesce(jsonb_agg(app.ranks_row_json(x.rnk, x.profile_id) || jsonb_build_object(
           'points', round(x.points)::int,
           'level', case when v_show then round(st.level, 1) end,
           'tier', app.ranks_tier_json(st.level), 'class', st.klass) order by x.rn), '[]'::jsonb)
    into v_race
    from (select r.*, rank() over (order by round(r.points) desc) as rnk,
                 row_number() over (order by round(r.points) desc, r.last_at, r.profile_id) as rn
            from app.ranks_race(v_r, v_from) r where r.points > 0) x
    left join app.ranks_player_stats(v_r) st on st.profile_id = x.profile_id
   where x.rn <= v_s.board_size;

  -- The Touch Level: reliable players only.
  select coalesce(jsonb_agg(app.ranks_row_json(x.rnk, x.profile_id) || jsonb_build_object(
           'level', case when v_show then round(x.level, 1) end,
           'tier', app.ranks_tier_json(x.level), 'class', x.klass) order by x.rn), '[]'::jsonb)
    into v_level
    from (select st.*, rank() over (order by round(st.level, 1) desc) as rnk,
                 row_number() over (order by st.level desc, st.profile_id) as rn
            from app.ranks_player_stats(v_r) st where st.reliable) x
   where x.rn <= v_s.board_size;

  -- Each class's top, by level, reliable players only.
  select coalesce(jsonb_object_agg(c.k, c.rows), '{}'::jsonb) into v_class
    from (select k.k, coalesce((
            select jsonb_agg(app.ranks_row_json(x.rnk, x.profile_id) || jsonb_build_object(
                     'level', case when v_show then round(x.level, 1) end,
                     'tier', app.ranks_tier_json(x.level)) order by x.rn)
              from (select st.*, rank() over (order by round(st.level, 1) desc) as rnk,
                           row_number() over (order by st.level desc, st.profile_id) as rn
                      from app.ranks_player_stats(v_r) st where st.reliable and st.klass = k.k) x
             where x.rn <= v_s.board_size), '[]'::jsonb) as rows
            from (values ('A'), ('B'), ('C')) k(k)) c;

  -- Most improved: the biggest gain over improved_days, at least improved_min_games games in it.
  select coalesce(jsonb_agg(app.ranks_row_json(x.rnk, x.profile_id) || jsonb_build_object(
           'gain', round(x.gain, 2),
           'level', case when v_show then round(x.level_now, 1) end,
           'tier', app.ranks_tier_json(x.level_now)) order by x.rn), '[]'::jsonb)
    into v_imp
    from (select g.*, rank() over (order by round(g.gain, 2) desc) as rnk,
                 row_number() over (order by g.gain desc, g.profile_id) as rn
            from (select s.profile_id,
                         (array_agg(s.level_after order by s.played_at desc))[1]
                           - (array_agg(s.level_before order by s.played_at))[1] as gain,
                         (array_agg(s.level_after order by s.played_at desc))[1] as level_now,
                         count(*) as n
                    from ranks_result_scores s
                    join profiles p on p.id = s.profile_id and p.deleted_at is null
                   where s.played_at > now() - make_interval(days => (v_r ->> 'improved_days')::int)
                   group by s.profile_id) g
           where g.n >= (v_r ->> 'improved_min_games')::int and g.gain > 0) x
   where x.rn <= v_s.board_size;

  return jsonb_build_object(
    'enabled', true,
    'headline', v_r ->> 'headline',
    'show_level', v_show,
    'period', v_s.period,
    'from', case when v_s.period = 'all' then null else v_from end,
    'size', v_s.board_size,
    'race', v_race,
    'level', v_level,
    'classes', v_class,
    'improved', v_imp,
    'improved_days', (v_r ->> 'improved_days')::int,
    'rules', app.ranks_public_rules(v_r),
    -- 0364's shape, for a phone built before 0444: the Race board.
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                      'rank', e -> 'rank', 'name', e -> 'name', 'points', e -> 'points',
                      'level', e -> 'tier', 'mine', e -> 'mine')), '[]'::jsonb)
               from jsonb_array_elements(v_race) e));
end $ranks_board_0444$;

comment on function app.ranks_board() is
  '0444. Public (anon). {enabled:false} while off, else {enabled, headline (race | level, the owner''s switch), show_level, period, from (null for all time), size, race [{rank, name, mine, points, level, tier, class}] (Race points this season), level [{rank, name, mine, level, tier, class}] (reliable players by Touch Level), classes {A, B, C: [{rank, name, mine, level, tier}]}, improved [{rank, name, mine, gain, level, tier}] over improved_days, improved_days, rules (app.ranks_public_rules), rows (0364''s shape: the Race board)}. level is null on every row while show_level is off. At most size rows a board; nobody below a board is read, and no id, phone or full name leaves it.';

revoke all on function app.ranks_board() from public;
grant execute on function app.ranks_board() to anon, authenticated;

-- ===========================================================================
-- 3. The player's own side
-- ===========================================================================

create or replace function app.ranks_result_json(p_r game_results, p_me uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_result_json_0444$
declare
  v_side   text := case when p_me in (p_r.a1, p_r.a2) then 'a' when p_me in (p_r.b1, p_r.b2) then 'b' end;
  v_status text := p_r.status;
  v_sc     ranks_result_scores%rowtype;
begin
  if v_status = 'pending' and p_r.expires_at <= now() then
    v_status := 'expired';
  end if;
  select * into v_sc from ranks_result_scores s where s.result_id = p_r.id and s.profile_id = p_me;
  return jsonb_build_object(
    'id', p_r.id,
    'source', p_r.source,
    'status', v_status,
    'played_at', p_r.played_at,
    'score', p_r.score,
    'outcome', case when p_r.winner = 'draw' then 'draw' when p_r.winner = v_side then 'won' else 'lost' end,
    'us', jsonb_build_array(app.ranks_player_json(case when v_side = 'b' then p_r.b1 else p_r.a1 end),
                            app.ranks_player_json(case when v_side = 'b' then p_r.b2 else p_r.a2 end)),
    'them', jsonb_build_array(app.ranks_player_json(case when v_side = 'b' then p_r.a1 else p_r.b1 end),
                              app.ranks_player_json(case when v_side = 'b' then p_r.a2 else p_r.b2 end)),
    'reported_by_me', p_r.reported_by = p_me,
    'can_confirm', v_status = 'pending' and v_side = 'b',
    'expires_at', p_r.expires_at,
    'points', coalesce(round(v_sc.race_points)::int, 0),
    'level_change', case when v_sc.result_id is null then null else round(v_sc.level_after - v_sc.level_before, 2) end,
    'boost', v_sc.boost_kind);
end $ranks_result_json_0444$;

comment on function app.ranks_result_json(game_results, uuid) is
  '0444 (0364 + level_change, boost). Internal. A result from one player''s side: {id, source, status (a lapsed pending reads expired), played_at, score, outcome won|lost|draw, us [2], them [2] (app.ranks_player_json, null for an empty seat), reported_by_me, can_confirm (pending and on side B), expires_at, points (its Race points, rounded; 0 for a tournament match or an unconfirmed result), level_change (what it did to their Touch Level, null until confirmed), boost (offpeak | welcome | null)}.';

revoke all on function app.ranks_result_json(game_results, uuid) from public, anon, authenticated;

create or replace function app.my_ranks() returns jsonb
language plpgsql stable security definer set search_path = public as $my_ranks_0444$
declare
  v_me       uuid := auth.uid();
  v_s        ranks_settings%rowtype;
  v_r        jsonb := app.ranks_rules();
  v_from     timestamptz;
  v_lifetime int;
  v_results  jsonb;
  v_report   jsonb;
  v_recent   jsonb;
  v_st       record;
  v_race     record;
  v_rrank    int;
  v_lrank    int;
  v_pool     int;
  v_below    int;
  v_level    numeric;
  v_next     jsonb;
  v_hist     jsonb;
  v_boosts   int;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_s from ranks_settings where id;
  if not v_s.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  v_from := app.ranks_period_start(v_s.period);

  select coalesce(sum(l.delta), 0)::int into v_lifetime from ranks_ledger l where l.profile_id = v_me;

  -- Their Touch Level (a player with no rated game yet still has a starting level).
  select * into v_st from app.ranks_player_stats(v_r) s where s.profile_id = v_me;
  v_level := coalesce(v_st.level, (select l.level from ranks_player_levels l where l.profile_id = v_me),
                      app.ranks_seed(v_me, v_r));

  -- "Higher than X% of players": the players with a rated game in reliable_days.
  select count(*)::int, count(*) filter (where s.level < v_level)::int into v_pool, v_below
    from app.ranks_player_stats(v_r) s
   where s.games_window > 0 and s.profile_id <> v_me;
  if coalesce(v_st.reliable, false) then
    select count(*)::int + 1 into v_lrank
      from app.ranks_player_stats(v_r) s where s.reliable and round(s.level, 1) > round(v_level, 1);
  end if;

  select * into v_race from app.ranks_race(v_r, v_from) r where r.profile_id = v_me;
  if coalesce(v_race.points, 0) > 0 then
    select count(*)::int + 1 into v_rrank
      from app.ranks_race(v_r, v_from) r where round(r.points) > round(v_race.points) and r.profile_id <> v_me;
  end if;
  select count(*)::int into v_boosts from ranks_result_scores s
   where s.profile_id = v_me and s.boost_kind is not null
     and s.season_start = app.ranks_season_of(v_from, v_s.period);

  select jsonb_build_object('name_en', l.name_en, 'name_ar', l.name_ar, 'min_level', l.min_level,
                            'min_points', l.min_points)
    into v_next
    from ranks_levels l where l.min_level > round(v_level, 1) order by l.min_level limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('played_at', h.played_at, 'level', round(h.level_after, 2))
                            order by h.played_at), '[]'::jsonb)
    into v_hist
    from (select s.played_at, s.level_after from ranks_result_scores s where s.profile_id = v_me
           order by s.played_at desc limit 20) h;

  -- Their last results, newest first, and every one still waiting on them.
  select coalesce(jsonb_agg(app.ranks_result_json(x.g, v_me) order by x.waiting desc, x.played_at desc), '[]'::jsonb)
    into v_results
    from (select r as g, r.played_at,
                 (r.status = 'pending' and r.expires_at > now() and v_me in (r.b1, r.b2)) as waiting
            from game_results r
           where v_me in (r.a1, r.a2, r.b1, r.b2)
             and (r.status = 'confirmed'
                  or (r.status = 'pending' and r.expires_at > now() - interval '7 days')
                  or (r.status in ('rejected', 'expired') and r.reported_by = v_me
                      and r.decided_at > now() - interval '7 days'))
           order by 3 desc, r.played_at desc
           limit 12) x;

  -- The bookings they made, played and not yet reported, still inside the window.
  if v_s.count_reported then
    select coalesce(jsonb_agg(jsonb_build_object(
             'reservation_id', x.id, 'start_at', x.start_at, 'end_at', x.end_at,
             'court', jsonb_build_object('name_en', x.name_en, 'name_ar', x.name_ar)) order by x.start_at desc), '[]'::jsonb)
      into v_report
      from (select rv.id, rv.start_at, rv.end_at, c.name_en, c.name_ar
              from reservations rv
              join courts c on c.id = rv.court_id
             where rv.guest_id = v_me
               and rv.kind = 'booking'
               and rv.status in ('confirmed', 'arrived', 'completed')
               and rv.start_at <= now() - interval '30 minutes'
               and rv.end_at > now() - make_interval(hours => v_s.report_hours)
               and not exists (select 1 from game_results g
                                where g.reservation_id = rv.id
                                  and (g.status = 'confirmed' or (g.status = 'pending' and g.expires_at > now())))
             order by rv.start_at desc
             limit 5) x;
  end if;

  -- People they played with lately, by username, for the report's quick picks.
  select coalesce(jsonb_agg(jsonb_build_object('username', q.username, 'name', app.match_display_name(q.id) -> 'name')
                            order by q.last_at desc), '[]'::jsonb)
    into v_recent
    from (select p.id, p.username, max(r.played_at) as last_at
            from game_results r
            cross join lateral unnest(array[r.a1, r.a2, r.b1, r.b2]) as u(pid)
            join profiles p on p.id = u.pid and p.deleted_at is null and p.username is not null
           where v_me in (r.a1, r.a2, r.b1, r.b2) and u.pid <> v_me and r.status in ('pending', 'confirmed')
           group by p.id, p.username
           order by max(r.played_at) desc
           limit 8) q;

  return jsonb_build_object(
    'enabled', true,
    'headline', v_r ->> 'headline',
    'period', v_s.period,
    'from', case when v_s.period = 'all' then null else v_from end,
    'size', v_s.board_size,
    -- 0364's keys: points and rank are the Race's, level and next_level the Touch Level's tier.
    'points', coalesce(round(v_race.points)::int, 0),
    'lifetime', v_lifetime,
    'rank', v_rrank,
    'level', app.ranks_tier_json(v_level),
    'next_level', v_next,
    'rules', jsonb_build_object('win', (v_r ->> 'race_win')::numeric, 'loss', (v_r ->> 'race_loss')::numeric,
                                'draw', (v_r ->> 'race_draw')::numeric,
                                'report_hours', v_s.report_hours, 'reports', v_s.count_reported),
    'touch', jsonb_build_object(
      'level', round(v_level, 2),
      'show_level', (v_r ->> 'show_level')::boolean,
      'rated', v_st.profile_id is not null,
      'games', coalesce(v_st.games, 0),
      'provisional_left', coalesce(v_st.provisional_left,
                                   (select l.provisional_left from ranks_player_levels l where l.profile_id = v_me),
                                   (v_r ->> 'provisional_games')::int),
      'games_window', coalesce(v_st.games_window, 0),
      'opponents_window', coalesce(v_st.opponents_window, 0),
      'reliable', coalesce(v_st.reliable, false),
      'needs_games', greatest((v_r ->> 'reliable_games')::int - coalesce(v_st.games_window, 0), 0),
      'needs_opponents', greatest((v_r ->> 'reliable_opponents')::int - coalesce(v_st.opponents_window, 0), 0),
      'reliable_days', (v_r ->> 'reliable_days')::int,
      'class', app.ranks_class(v_level, v_r),
      'tier', app.ranks_tier_json(v_level),
      'next_tier', v_next,
      'to_next', case when v_next is null then null else round((v_next ->> 'min_level')::numeric - v_level, 2) end,
      'rank', v_lrank,
      'higher_than_pct', case when coalesce(v_pool, 0) = 0 then null else round(100.0 * v_below / v_pool)::int end,
      'history', v_hist,
      -- Their type: what they picked, the last check that counted, and whether they may still change it.
      'self_type', (select p.play_level from profiles p where p.id = v_me),
      'checked', (select jsonb_build_object('type', c.level, 'role', c.role, 'at', c.checked_at)
                    from ranks_level_checks c where c.profile_id = v_me and c.applied
                   order by c.checked_at desc, c.seq desc limit 1),
      'can_change_type', not exists (select 1 from ranks_level_checks c where c.profile_id = v_me and c.applied)
                         and coalesce((select l.games from ranks_player_levels l where l.profile_id = v_me), 0)
                               < (v_r ->> 'provisional_games')::int),
    'race', jsonb_build_object(
      'points', coalesce(round(v_race.points)::int, 0),
      'rank', v_rrank,
      'matches', coalesce(v_race.matches, 0),
      'matches_counted', coalesce(v_race.matches_counted, 0),
      'best_matches', (v_r ->> 'race_best_matches')::int,
      'tournaments', coalesce(v_race.tournaments, 0),
      'best_tournaments', (v_r ->> 'race_best_tournaments')::int,
      'boosts_used', v_boosts,
      'boosts_max', (v_r ->> 'boost_max_per_season')::int),
    'public_rules', app.ranks_public_rules(v_r),
    'username', (select p.username from profiles p where p.id = v_me),
    'results', v_results,
    'to_report', coalesce(v_report, '[]'::jsonb),
    'recent', v_recent);
end $my_ranks_0444$;

comment on function app.my_ranks() is
  '0444. The signed-in player''s own page: {enabled:false} while off, else 0364''s keys (points and rank are now this season''s Race, level and next_level the tier their Touch Level reaches, rules the Race''s win/loss/draw) plus headline, touch {level, show_level, rated, games, provisional_left, games_window, opponents_window, reliable, needs_games, needs_opponents, reliable_days, class, tier, next_tier, to_next, rank (on the Touch Level board, reliable only), higher_than_pct (share of players with a rated game in reliable_days whose level is below theirs), history [{played_at, level}] last 20, self_type (what they picked: new|beginner|intermediate|advanced), checked {type, role, at} (the last Level check that counted, or null), can_change_type (set_my_play_level is open to them)} and race {points, rank, matches, matches_counted, best_matches, tournaments, best_tournaments, boosts_used, boosts_max} and public_rules (app.ranks_public_rules; my_ranks keeps 0364''s `rules` key for older builds). Theirs alone.';

revoke all on function app.my_ranks() from public, anon;
grant execute on function app.my_ranks() to authenticated;

-- ===========================================================================
-- 4. The owner's rules and tiers
-- ===========================================================================

create or replace function app.ranks_levels_json() returns jsonb
language sql stable security definer set search_path = public as $ranks_levels_json_0444$
  select coalesce(jsonb_agg(jsonb_build_object('name_en', l.name_en, 'name_ar', l.name_ar,
                                               'min_level', l.min_level, 'min_points', l.min_points)
                            order by l.min_level), '[]'::jsonb)
    from ranks_levels l
$ranks_levels_json_0444$;

comment on function app.ranks_levels_json() is '0444 (0364 + min_level). Internal. The tiers, lowest first.';

revoke all on function app.ranks_levels_json() from public, anon, authenticated;

create or replace function app.ranks_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_admin_0444$
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'settings', app.ranks_settings_json(),
    'levels', app.ranks_levels_json(),
    'rules', app.ranks_rules(),
    'defaults', app.ranks_rules_default(),
    'overrides', (select s.rules from ranks_settings s where s.id),
    'rebuild', (select jsonb_build_object('at', b.rebuilt_at, 'results', b.results, 'ms', b.ms)
                  from ranks_rebuild_state b where b.id));
end $ranks_admin_0444$;

comment on function app.ranks_admin() is
  '0444 (0364 + rules). Manager or owner: {settings (ranks_settings), levels [{name_en, name_ar, min_level, min_points}] lowest first, rules (in force), defaults, overrides (what the owner changed), rebuild {at, results, ms}}.';

revoke all on function app.ranks_admin() from public, anon;
grant execute on function app.ranks_admin() to authenticated;

create or replace function app.set_ranks_rules(p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_ranks_rules_0444$
declare
  v_before jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform app.ranks_rules_check(p_rules);
  select s.rules into v_before from ranks_settings s where s.id for update;
  -- Keep only what differs from the default: "back to default" is leaving a key out.
  update ranks_settings
     set rules = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p_rules) e(k, v)
                   where v is distinct from app.ranks_rules_default() -> k),
         updated_at = now(), updated_by = auth.uid()
   where id;
  perform app.ranks_rebuild();
  perform app.write_audit('ranks.rules', 'ranks_settings', 'true', jsonb_build_object('rules', v_before),
                          jsonb_build_object('rules', (select s.rules from ranks_settings s where s.id)), null);
  return app.ranks_admin();
end $set_ranks_rules_0444$;

comment on function app.set_ranks_rules(jsonb) is
  '0444. Owner: replaces the ranking rule overrides with p_rules (only keys of app.ranks_rules_default(); a key left out is its default; a value equal to the default is not kept), checked by app.ranks_rules_check (INVALID_ARGUMENT / INVALID_VALUE, detail the key), then replays every Touch Level and Race score under the new rules. Returns app.ranks_admin(). Audited ranks.rules.';

revoke all on function app.set_ranks_rules(jsonb) from public, anon;
grant execute on function app.set_ranks_rules(jsonb) to authenticated;

create or replace function app.set_ranks_levels(p_levels jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_ranks_levels_0444$
declare
  v_before jsonb;
  v_n      int;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_levels';
  end if;
  v_n := jsonb_array_length(p_levels);
  if v_n < 1 or v_n > 10 then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'count';
  end if;
  -- min_level, or 0364's min_points from an older operator build read as hundredths of a level.
  if not exists (select 1 from jsonb_array_elements(p_levels) e
                  where coalesce((e ->> 'min_level')::numeric, (e ->> 'min_points')::numeric / 100) = 0) then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'base';
  end if;

  v_before := app.ranks_levels_json();
  delete from ranks_levels where true;
  begin
    insert into ranks_levels (name_en, name_ar, min_level, min_points)
    select btrim(e ->> 'name_en'), btrim(e ->> 'name_ar'), x.lv, (x.lv * 100)::int
      from jsonb_array_elements(p_levels) e
      cross join lateral (select round(coalesce((e ->> 'min_level')::numeric,
                                                (e ->> 'min_points')::numeric / 100), 1) as lv) x;
  exception when check_violation or not_null_violation or unique_violation or invalid_text_representation
                 or numeric_value_out_of_range then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.write_audit('ranks.levels', 'ranks_levels', 'all', jsonb_build_object('levels', v_before),
                          jsonb_build_object('levels', app.ranks_levels_json()), null);
  return app.ranks_levels_json();
end $set_ranks_levels_0444$;

comment on function app.set_ranks_levels(jsonb) is
  '0444 (0364, tiers by Touch Level). Owner: replaces the tiers with p_levels, [{name_en, name_ar, min_level}] (min_points of an older build is read as hundredths of a level), 1 to 10 of them, one at 0, no two at the same level (one decimal), names 1-24 characters. INVALID_VALUE (detail count, base or the refusal). Returns the tiers. Audited ranks.levels.';

revoke all on function app.set_ranks_levels(jsonb) from public, anon;
grant execute on function app.set_ranks_levels(jsonb) to authenticated;

-- ===========================================================================
-- 5. The two review lists
-- ===========================================================================

create or replace function app.ranks_level_checks_list(p_limit int) returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_level_checks_list_0444$
declare
  v_rows jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(x.j order by x.checked_at desc, x.seq desc), '[]'::jsonb) into v_rows
    from (select c.checked_at, c.seq, jsonb_build_object(
                   'id', c.id,
                   'player', app.ranks_staff_player_json(c.profile_id),
                   'class', case c.level when 'advanced' then 'A' when 'intermediate' then 'B'
                                         when 'beginner' then 'C' else 'new' end,
                   'role', c.role,
                   'checked_by', app.ranks_staff_player_json(c.checked_by) -> 'name',
                   'checked_at', c.checked_at,
                   'note', c.note,
                   'applied', c.applied,
                   'level_set', round(c.applied_level, 2),
                   'games_after', a.n,
                   'level_after', round(a.level_after, 2),
                   'drift', case when c.applied and a.n > 0 then round(a.level_after - c.applied_level, 2) end) as j
            from ranks_level_checks c
            left join lateral (
              select count(*)::int as n,
                     (array_agg(s.level_after order by s.played_at desc))[1] as level_after
                from (select s.level_after, s.played_at from ranks_result_scores s
                       where s.profile_id = c.profile_id and s.played_at > c.checked_at
                       order by s.played_at limit 20) s) a on true
           order by c.checked_at desc, c.seq desc
           limit least(greatest(coalesce(p_limit, 100), 1), 300)) x;
  return v_rows;
end $ranks_level_checks_list_0444$;

comment on function app.ranks_level_checks_list(int) is
  '0444. Manager or owner: the Level checks, newest first (p_limit 1-300, default 100): [{id, player (app.ranks_staff_player_json), class A|B|C|new, role, checked_by (name), checked_at, note, applied (the rules let it move the level), level_set, games_after (up to 20), level_after (after those games), drift (level_after - level_set: a checker whose players keep falling rates too high)}].';

revoke all on function app.ranks_level_checks_list(int) from public, anon;
grant execute on function app.ranks_level_checks_list(int) to authenticated;

create or replace function app.ranks_results_to_check(p_days int) returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_results_to_check_0444$
declare
  v_rows jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  with r as (
    select g.*, least(array_to_string(array(select x from unnest(array[g.a1, g.a2]::text[]) x where x is not null order by x), ','),
                      array_to_string(array(select x from unnest(array[g.b1, g.b2]::text[]) x where x is not null order by x), ',')) as t1,
                greatest(array_to_string(array(select x from unnest(array[g.a1, g.a2]::text[]) x where x is not null order by x), ','),
                         array_to_string(array(select x from unnest(array[g.b1, g.b2]::text[]) x where x is not null order by x), ',')) as t2,
                case when g.winner = 'draw' then null
                     when (g.winner = 'a') = (array_to_string(array(select x from unnest(array[g.a1, g.a2]::text[]) x where x is not null order by x), ',')
                                              <= array_to_string(array(select x from unnest(array[g.b1, g.b2]::text[]) x where x is not null order by x), ','))
                     then 1 else 2 end as won_team
      from game_results g
     where g.status = 'confirmed'
       and g.venue_id = any((select app.visible_venue_ids())::uuid[])
       and g.played_at > now() - make_interval(days => least(greatest(coalesce(p_days, 60), 7), 365))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'first', jsonb_build_object('id', x.id, 'played_at', x.played_at, 'score', x.score, 'source', x.source,
                                       'winner', x.winner,
                                       'a', jsonb_build_array(app.ranks_staff_player_json(x.a1), app.ranks_staff_player_json(x.a2)),
                                       'b', jsonb_build_array(app.ranks_staff_player_json(x.b1), app.ranks_staff_player_json(x.b2))),
           'second', jsonb_build_object('id', y.id, 'played_at', y.played_at, 'score', y.score, 'source', y.source,
                                        'winner', y.winner,
                                        'a', jsonb_build_array(app.ranks_staff_player_json(y.a1), app.ranks_staff_player_json(y.a2)),
                                        'b', jsonb_build_array(app.ranks_staff_player_json(y.b1), app.ranks_staff_player_json(y.b2))))
           order by y.played_at desc), '[]'::jsonb)
    into v_rows
    from r x
    join r y on y.t1 = x.t1 and y.t2 = x.t2 and y.played_at > x.played_at
            and y.played_at <= x.played_at + interval '7 days'
            and x.won_team is not null and y.won_team is not null and x.won_team <> y.won_team
   where not exists (select 1 from r z where z.t1 = x.t1 and z.t2 = x.t2
                                         and z.played_at > x.played_at and z.played_at < y.played_at);
  return coalesce(v_rows, '[]'::jsonb);
end $ranks_results_to_check_0444$;

comment on function app.ranks_results_to_check(int) is
  '0444. Court desk, manager or owner: pairs of confirmed results at the branches in scope (last p_days, 7-365, default 60) where the same two pairs played within 7 days and the winner flipped (a sign two pairs are trading wins), newest first: [{first, second: {id, played_at, score, source, winner, a [2], b [2] (app.ranks_staff_player_json)}}]. A manager or the owner voids a traded result with ranks_void.';

revoke all on function app.ranks_results_to_check(int) from public, anon;
grant execute on function app.ranks_results_to_check(int) to authenticated;

-- ===========================================================================
-- 6. Who writes what (Majed 2026-11-16: "they themselves write it and it's confirmed, and if they
--    don't write it the operator or coach can set it; the operator can confirm / edit / set", for
--    both results and levels)
-- ===========================================================================

-- Results: the players report (0364 ranks_report) and side B confirms (ranks_confirm). The desk
-- confirms a report still waiting, edits any result, or enters one (0364 ranks_desk_record); a
-- coach enters one (ranks_coach_record).

create or replace function app.ranks_staff_confirm(p_result_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $ranks_staff_confirm_0444$
declare
  v_row game_results%rowtype;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from game_results where id = p_result_id for update;
  if not found or not (v_row.venue_id = any((select app.visible_venue_ids())::uuid[])) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'RANKS_RESULT_CLOSED' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  -- The desk's word stands even after the players' window lapsed.
  update game_results set status = 'confirmed', decided_by = auth.uid(), decided_at = now()
   where id = v_row.id returning * into v_row;
  perform app.ranks_award(v_row.id);
  perform app.write_audit('ranks.confirm', 'game_results', v_row.id::text, null, to_jsonb(v_row), null);
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end $ranks_staff_confirm_0444$;

comment on function app.ranks_staff_confirm(uuid) is
  '0444. Court desk, manager or owner: confirms a player report still pending (also one whose window lapsed but was never closed), as an opponent would; its points are written and the levels replay. NOT_FOUND (or another branch''s), RANKS_RESULT_CLOSED (not pending). Audited ranks.confirm.';

revoke all on function app.ranks_staff_confirm(uuid) from public, anon;
grant execute on function app.ranks_staff_confirm(uuid) to authenticated;

create or replace function app.ranks_edit_result(p_result_id uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid, p_b2 uuid,
                                                 p_winner text, p_score text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $ranks_edit_result_0444$
declare
  v_old  game_results%rowtype;
  v_new  game_results%rowtype;
  v_why  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_why is null or char_length(v_why) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_winner is null or p_winner not in ('a', 'b', 'draw') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_winner';
  end if;
  if nullif(btrim(p_score), '') is not null
     and nullif(btrim(p_score), '') !~ '^[0-9]{1,2}-[0-9]{1,2}(, [0-9]{1,2}-[0-9]{1,2}){0,4}$' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'p_score';
  end if;
  if p_a1 is null or p_b1 is null
     or exists (select 1 from unnest(array[p_a1, p_a2, p_b1, p_b2]) u(id)
                 where u.id is not null
                   and not exists (select 1 from profiles p where p.id = u.id and p.deleted_at is null)) then
    raise exception 'RANKS_PLAYER_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_old from game_results where id = p_result_id for update;
  if not found or not (v_old.venue_id = any((select app.visible_venue_ids())::uuid[])) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.status not in ('pending', 'confirmed') then
    raise exception 'RANKS_RESULT_CLOSED' using errcode = 'P0001';
  end if;
  -- A tournament match is corrected on the tournament's own score sheet (0364's trigger follows it).
  if v_old.source = 'tournament' then
    raise exception 'RANKS_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  perform set_config('app.venue_id', v_old.venue_id::text, true);
  -- The old result ends voided with the reason; the corrected one takes its place, confirmed.
  update game_results set status = 'voided', decided_by = auth.uid(), decided_at = now(),
                          void_reason = left('edited: ' || v_why, 200)
   where id = v_old.id;
  perform app.ranks_unaward(v_old.id, left('edited: ' || v_why, 200));
  begin
    insert into game_results (venue_id, reservation_id, source, status, a1, a2, b1, b2, winner, score,
                              played_at, reported_by, decided_by, decided_at)
    values (v_old.venue_id, v_old.reservation_id, 'desk', 'confirmed', p_a1, p_a2, p_b1, p_b2, p_winner,
            nullif(btrim(p_score), ''), v_old.played_at, auth.uid(), auth.uid(), now())
    returning * into v_new;
  exception when check_violation then
    raise exception 'RANKS_PLAYERS_INVALID' using errcode = 'P0001';
  end;
  perform app.ranks_award(v_new.id);
  perform app.write_audit('ranks.edit', 'game_results', v_new.id::text, to_jsonb(v_old), to_jsonb(v_new),
                          left(v_why || ' (replaces ' || v_old.id::text || ')', 500));
  return jsonb_build_object('id', v_new.id, 'status', v_new.status, 'replaces', v_old.id);
end $ranks_edit_result_0444$;

comment on function app.ranks_edit_result(uuid, uuid, uuid, uuid, uuid, text, text, text) is
  '0444. Court desk, manager or owner: corrects a pending or confirmed result (the players, the winner, the score) with a reason: the old row is voided ("edited: <reason>", its points taken off) and a corrected desk result takes its place at the same time and booking, confirmed, its points written; the levels replay. A second seat may be NULL. A tournament match is corrected on the tournament (RANKS_NOT_ELIGIBLE). REASON_REQUIRED, INVALID_ARGUMENT (p_winner), INVALID_VALUE (p_score), RANKS_PLAYER_NOT_FOUND, RANKS_PLAYERS_INVALID, NOT_FOUND, RANKS_RESULT_CLOSED. Audited ranks.edit. Returns {id, status, replaces}.';

revoke all on function app.ranks_edit_result(uuid, uuid, uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function app.ranks_edit_result(uuid, uuid, uuid, uuid, uuid, text, text, text) to authenticated;

create or replace function app.ranks_coach_record(p_a1 text, p_a2 text, p_b1 text, p_b2 text,
                                                  p_winner text, p_score text)
returns jsonb
language plpgsql security definer set search_path = public as $ranks_coach_record_0444$
declare
  v_coach coaches%rowtype;
  v_s     ranks_settings%rowtype;
  v_ids   uuid[];
  v_venue uuid;
  v_row   game_results%rowtype;
begin
  v_coach := app.coach_self(false);
  if v_coach.id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_s from ranks_settings where id;
  if not v_s.enabled then
    raise exception 'RANKS_OFF' using errcode = 'P0001';
  end if;
  if p_winner is null or p_winner not in ('a', 'b', 'draw') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_winner';
  end if;
  if nullif(btrim(p_score), '') is not null
     and nullif(btrim(p_score), '') !~ '^[0-9]{1,2}-[0-9]{1,2}(, [0-9]{1,2}-[0-9]{1,2}){0,4}$' then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'p_score';
  end if;
  v_ids := array[app.ranks_profile_by_username(p_a1), app.ranks_profile_by_username(p_a2),
                 app.ranks_profile_by_username(p_b1), app.ranks_profile_by_username(p_b2)];
  if v_ids[1] is null or v_ids[3] is null
     or (nullif(btrim(coalesce(p_a2, '')), '') is not null and v_ids[2] is null)
     or (nullif(btrim(coalesce(p_b2, '')), '') is not null and v_ids[4] is null) then
    raise exception 'RANKS_PLAYER_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- The coach's branch (their first active one), else the default branch.
  select cb.venue_id into v_venue from coach_branches cb
   where cb.coach_id = v_coach.id and cb.active order by cb.created_at limit 1;
  v_venue := coalesce(v_venue, app.current_venue_or_default());
  perform set_config('app.venue_id', v_venue::text, true);
  begin
    insert into game_results (venue_id, source, status, a1, a2, b1, b2, winner, score, played_at,
                              reported_by, decided_by, decided_at)
    values (v_venue, 'desk', 'confirmed', v_ids[1], v_ids[2], v_ids[3], v_ids[4], p_winner,
            nullif(btrim(p_score), ''), now(), auth.uid(), auth.uid(), now())
    returning * into v_row;
  exception when check_violation then
    raise exception 'RANKS_PLAYERS_INVALID' using errcode = 'P0001';
  end;
  perform app.ranks_award(v_row.id);
  perform app.write_audit('ranks.record', 'game_results', v_row.id::text, null, to_jsonb(v_row),
                          'entered by a coach (' || v_coach.id::text || ')');
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end $ranks_coach_record_0444$;

comment on function app.ranks_coach_record(text, text, text, text, text, text) is
  '0444. A coach (app.coach_self, else FORBIDDEN) enters a game they watched, by the players'' usernames (a second seat may be empty): confirmed at once at the coach''s first active branch, played now, counted like a desk entry (trust_desk); the levels replay. RANKS_OFF, INVALID_ARGUMENT (p_winner), INVALID_VALUE (p_score), RANKS_PLAYER_NOT_FOUND, RANKS_PLAYERS_INVALID (one person twice). Audited ranks.record with by = coach.';

revoke all on function app.ranks_coach_record(text, text, text, text, text, text) from public, anon;
grant execute on function app.ranks_coach_record(text, text, text, text, text, text) to authenticated;

-- Levels: the player picks their own type (it counts, as their starting level) while nobody on the
-- staff has checked them and they are still in their first games; after that the desk or a coach
-- changes it (staff_set_customer_level, coach_set_student_level: the Level check).

create or replace function app.set_my_play_level(p_level text) returns jsonb
language plpgsql security definer set search_path = public as $set_my_play_level_0444$
declare
  v_me  uuid := auth.uid();
  v_r   jsonb := app.ranks_rules();
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  -- An anonymous café session has no profile (0004 skips is_anonymous); a deleted account neither.
  if not exists (select 1 from profiles p where p.id = v_me and p.deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if p_level is null or p_level not in ('new', 'beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_level';
  end if;
  if exists (select 1 from ranks_level_checks c where c.profile_id = v_me and c.applied)
     or coalesce((select l.games from ranks_player_levels l where l.profile_id = v_me), 0)
          >= (v_r ->> 'provisional_games')::int then
    raise exception 'RANKS_LEVEL_LOCKED' using errcode = 'P0001';
  end if;
  update profiles set play_level = p_level where id = v_me and play_level is distinct from p_level;
  return jsonb_build_object('play_level', p_level);
end $set_my_play_level_0444$;

comment on function app.set_my_play_level(text) is
  '0444. The signed-in player picks their own type (new, beginner = C, intermediate = B, advanced = A); it is their starting level until a Level check. Allowed only while no check of theirs was applied and they have played fewer than provisional_games rated games: after that RANKS_LEVEL_LOCKED (the desk or a coach changes it). AUTH_REQUIRED, ACCOUNT_REQUIRED (an anonymous session or a deleted account), INVALID_PLAY_PROFILE (detail p_level). The levels replay (profiles_ranks_self_level). Returns {play_level}.';

revoke all on function app.set_my_play_level(text) from public, anon;
grant execute on function app.set_my_play_level(text) to authenticated;

create or replace function app.trg_profile_ranks_self_level() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_ranks_self_level_0444$
begin
  perform app.ranks_rebuild();
  return null;
end $trg_profile_ranks_self_level_0444$;

comment on function app.trg_profile_ranks_self_level() is
  '0444. AFTER UPDATE OF play_level on profiles (a real change, by the player or the sign-up survey): replays the Touch Level, because a sign-up level is a starting point.';

revoke all on function app.trg_profile_ranks_self_level() from public, anon, authenticated;

drop trigger if exists profiles_ranks_self_level on public.profiles;
create trigger profiles_ranks_self_level after update of play_level on public.profiles
  for each row when (new.play_level is distinct from old.play_level)
  execute function app.trg_profile_ranks_self_level();
