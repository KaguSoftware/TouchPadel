-- 0364 ranks_leaderboard — the players' leaderboard (Majed, 2026-10-22).
--
-- "Every time they win a game they gain a point, and the points put them on a leaderboard. The
-- leaderboard is public; only the top 10 are shared, and anybody below them is never fetched. It is
-- still saved on the player's profile, so they can see how many points they have and how high they
-- are. Levels too. All of it set in the admin panel, like the loyalty": a win +2, a loss +1, and
-- so on.
--
-- Where a result comes from (Majed: both):
--   * player   the booker of a court booking that has been played reports it in the app: their
--              partner and the two opponents by username, and who won. One of the opponents
--              confirms it; until then it awards nothing, and it lapses after report_hours.
--   * desk     the court desk, a manager or the owner enters one on the operator, confirmed at
--              once (a booking's pending report is replaced by it).
--   * tournament  a scored tournament match, when count_tournaments is on (a correction voids
--              the old result and records the new score).
-- A manager or the owner may void any result: its points come off again.
--
-- Points are business-wide, like loyalty's (L-7), and kept apart from them: loyalty points are
-- money, these are play. They live in ranks_ledger, written once per player per result, so a rule
-- changed later applies from then on and never reshuffles games already played. The board sums the
-- ledger over the period the owner picks (all time, this month, this quarter, in the business's
-- time zone) and a level reads lifetime points, so nobody drops a level when a season turns.
--
-- Public: app.ranks_board() is anon-readable and returns the top board_size rows and nothing
-- else: rank, the match-style name ("First L.", app.match_display_name), points and level. A
-- player below the board is never read by anyone else; app.my_ranks() gives a signed-in player
-- their own points, rank and level.
--
-- Every write is online only (no queued mutation type) and runs as a definer; the tables have RLS
-- on and no client grant.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 1. Settings and levels (business-wide, one row; loyalty_settings' shape)
-- ===========================================================================

create table if not exists ranks_settings (
  id                boolean primary key default true check (id),
  enabled           boolean not null default true,
  win_points        int not null default 2 check (win_points between 0 and 100),
  loss_points       int not null default 1 check (loss_points between 0 and 100),
  draw_points       int not null default 1 check (draw_points between 0 and 100),
  period            text not null default 'month' check (period in ('all', 'month', 'quarter')),
  board_size        int not null default 10 check (board_size between 3 and 25),
  count_reported    boolean not null default true,
  count_tournaments boolean not null default true,
  report_hours      int not null default 48 check (report_hours between 1 and 336),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references staff(id)
);

comment on table ranks_settings is
  '0364. The leaderboard''s rules, one business-wide row (owner, app.set_ranks_settings): points for a win, a loss and a draw (written to the ledger when a result is confirmed, so a change applies from then on), the board''s period (all, month, quarter) and size, which sources count (player reports, tournament matches) and how long a report may wait (report_hours: after the booking''s end to report, and after the report to confirm).';

insert into ranks_settings (id) values (true) on conflict (id) do nothing;

create table if not exists ranks_levels (
  id         uuid primary key default gen_random_uuid(),
  name_en    text not null,
  name_ar    text not null,
  min_points int not null,
  created_at timestamptz not null default now(),
  constraint ranks_levels_min_key unique (min_points),
  constraint ranks_levels_names   check (char_length(name_en) between 1 and 24 and char_length(name_ar) between 1 and 24),
  constraint ranks_levels_min     check (min_points between 0 and 1000000)
);

comment on table ranks_levels is
  '0364. The leaderboard''s levels (owner, app.set_ranks_levels replaces the list): a player is at the highest level whose min_points their lifetime points reach. The first level always starts at 0.';

insert into ranks_levels (name_en, name_ar, min_points)
select v.name_en, v.name_ar, v.min_points
  from (values ('Rookie', 'مبتدئ', 0), ('Rising', 'صاعد', 20), ('Contender', 'منافس', 60),
               ('Elite', 'نخبة', 150), ('Legend', 'أسطورة', 300)) as v(name_en, name_ar, min_points)
 where not exists (select 1 from ranks_levels);

-- ===========================================================================
-- 2. Results and the ledger
-- ===========================================================================

create table if not exists game_results (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null default app.current_venue() references venues(id),
  reservation_id      uuid references reservations(id),
  tournament_match_id uuid references tournament_matches(id),
  source              text not null check (source in ('player', 'desk', 'tournament')),
  status              text not null default 'pending'
                        check (status in ('pending', 'confirmed', 'rejected', 'expired', 'voided')),
  -- Side A and side B. A side's second seat may be empty (a desk entry with a walk-in partner).
  a1                  uuid not null references profiles(id),
  a2                  uuid references profiles(id),
  b1                  uuid not null references profiles(id),
  b2                  uuid references profiles(id),
  winner              text not null check (winner in ('a', 'b', 'draw')),
  score               text,
  played_at           timestamptz not null,
  reported_by         uuid not null,
  reported_at         timestamptz not null default now(),
  expires_at          timestamptz,
  decided_by          uuid,
  decided_at          timestamptz,
  void_reason         text,
  constraint game_results_four check (
    a1 <> b1
    and (a2 is null or (a2 <> a1 and a2 <> b1))
    and (b2 is null or (b2 <> a1 and b2 <> b1 and (a2 is null or b2 <> a2)))),
  constraint game_results_score check (score is null or (char_length(score) <= 40
    and score ~ '^[0-9]{1,2}-[0-9]{1,2}(, [0-9]{1,2}-[0-9]{1,2}){0,4}$')),
  constraint game_results_void_reason check (void_reason is null or char_length(void_reason) <= 200),
  constraint game_results_player_report check (source <> 'player' or (reservation_id is not null and a2 is not null
                                                                       and b2 is not null and expires_at is not null)),
  constraint game_results_tournament check ((source = 'tournament') = (tournament_match_id is not null))
);

comment on table game_results is
  '0364. One game''s result for the leaderboard: sides A (a1, a2) and B (b1, b2), the winner (a, b or draw) and an optional score ("6-4, 7-5"). source player: the booker reported it (side A is theirs) and it waits, pending, for an opponent to confirm until expires_at; desk: entered on the operator, confirmed at once; tournament: a scored tournament match. Points reach ranks_ledger only on confirmed. No client grant: app.my_ranks, app.ranks_desk_results.';

-- One live result per booking and per tournament match.
create unique index if not exists game_results_reservation_live
  on game_results (reservation_id) where reservation_id is not null and status in ('pending', 'confirmed');
create unique index if not exists game_results_tournament_live
  on game_results (tournament_match_id) where tournament_match_id is not null and status = 'confirmed';
create index if not exists game_results_a1 on game_results (a1);
create index if not exists game_results_a2 on game_results (a2) where a2 is not null;
create index if not exists game_results_b1 on game_results (b1);
create index if not exists game_results_b2 on game_results (b2) where b2 is not null;
create index if not exists game_results_reported on game_results (reported_at desc);

drop trigger if exists zz_branch_guard on public.game_results;
create trigger zz_branch_guard before insert or update or delete on public.game_results
  for each row execute function app.trg_branch_guard('scoped', 'reservations', 'reservation_id',
                                                     'tournament_matches', 'tournament_match_id');

create table if not exists ranks_ledger (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  result_id  uuid,
  kind       text not null check (kind in ('win', 'loss', 'draw', 'void', 'adjust')),
  delta      int not null,
  earned_at  timestamptz not null,
  actor_id   uuid,
  note       text,
  created_at timestamptz not null default now(),
  constraint ranks_ledger_result check ((kind = 'adjust') = (result_id is null)),
  constraint ranks_ledger_note   check (note is null or char_length(note) <= 200),
  constraint ranks_ledger_once   unique (result_id, profile_id, kind)
);

comment on table ranks_ledger is
  '0364. Leaderboard points, append-only: win, loss or draw once per player per confirmed result (at the rules of that moment), a void taking the same points off again, or an owner''s adjust. earned_at is the game''s time (a void keeps it, so it comes off the same period). The board and app.my_ranks sum it. No client grant.';

create index if not exists ranks_ledger_profile on ranks_ledger (profile_id, earned_at);
create index if not exists ranks_ledger_earned on ranks_ledger (earned_at);

create or replace function app.trg_ranks_ledger_append_only() returns trigger
language plpgsql set search_path = public as $trg_ranks_ledger_append_only_0364$
begin
  -- The account merge (app.merge_profiles_internal) re-points profile_id from the dropped account
  -- to the kept one, and says so for its transaction only (loyalty_ledger's rule, 0305). A game
  -- that kept the drop's seat (app.trg_game_results_merge) keeps the drop's points from it too.
  if tg_op = 'UPDATE'
     and current_setting('app.profile_merge', true) = 'on'
     and (to_jsonb(new) - 'profile_id') = (to_jsonb(old) - 'profile_id') then
    if old.result_id is not null
       and exists (select 1 from game_results g
                    where g.id = old.result_id and old.profile_id in (g.a1, g.a2, g.b1, g.b2)) then
      return null;
    end if;
    return new;
  end if;
  raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'ranks_ledger is append-only';
end $trg_ranks_ledger_append_only_0364$;

comment on function app.trg_ranks_ledger_append_only() is
  '0364. BEFORE UPDATE OR DELETE on ranks_ledger: refused (FORBIDDEN, detail append-only); a void writes its own rows. The one exception is an UPDATE that changes profile_id alone while app.profile_merge is ''on'' (the account merge''s re-point), skipped for a row whose game still seats the dropped account.';

revoke all on function app.trg_ranks_ledger_append_only() from public, anon, authenticated;

drop trigger if exists ranks_ledger_append_only on public.ranks_ledger;
create trigger ranks_ledger_append_only before update or delete on public.ranks_ledger
  for each row execute function app.trg_ranks_ledger_append_only();

alter table ranks_settings enable row level security;
alter table ranks_levels   enable row level security;
alter table game_results   enable row level security;
alter table ranks_ledger   enable row level security;
revoke all on ranks_settings, ranks_levels, game_results, ranks_ledger from anon, authenticated;

-- ===========================================================================
-- 3. Internal helpers
-- ===========================================================================

-- The business's clock, for the board's month and quarter: the default branch's time zone.
create or replace function app.ranks_period_start(p_period text) returns timestamptz
language plpgsql stable security definer set search_path = public as $ranks_period_start_0364$
declare
  v_tz text;
begin
  if p_period = 'all' then
    return '-infinity'::timestamptz;
  end if;
  select vs.timezone into v_tz from venue_settings vs where vs.venue_id = app.current_venue_or_default();
  v_tz := coalesce(nullif(v_tz, ''), 'Asia/Baghdad');
  return date_trunc(case when p_period = 'quarter' then 'quarter' else 'month' end, now() at time zone v_tz)
         at time zone v_tz;
end $ranks_period_start_0364$;

comment on function app.ranks_period_start(text) is
  '0364. Internal. Where the board''s period began: -infinity for all, else the start of this month or quarter in the default branch''s time zone.';

revoke all on function app.ranks_period_start(text) from public, anon, authenticated;

-- A level as the phone and the operator show it, for a lifetime total.
create or replace function app.ranks_level_json(p_lifetime int) returns jsonb
language sql stable security definer set search_path = public as $ranks_level_json_0364$
  select coalesce(
    (select jsonb_build_object('name_en', l.name_en, 'name_ar', l.name_ar, 'min_points', l.min_points)
       from ranks_levels l where l.min_points <= greatest(coalesce(p_lifetime, 0), 0)
      order by l.min_points desc limit 1),
    jsonb_build_object('name_en', null, 'name_ar', null, 'min_points', 0))
$ranks_level_json_0364$;

comment on function app.ranks_level_json(int) is
  '0364. Internal. The level a lifetime total reaches: {name_en, name_ar, min_points}.';

revoke all on function app.ranks_level_json(int) from public, anon, authenticated;

-- Writes a confirmed result's points, at today's rules, once per player.
create or replace function app.ranks_award(p_result_id uuid) returns void
language plpgsql security definer set search_path = public as $ranks_award_0364$
declare
  v_r  game_results%rowtype;
  v_s  ranks_settings%rowtype;
  v_p  uuid;
  v_side text;
  v_kind text;
begin
  select * into v_r from game_results where id = p_result_id;
  if not found or v_r.status <> 'confirmed' then
    return;
  end if;
  select * into v_s from ranks_settings where id;
  for v_p, v_side in
    select x.p, x.side from (values (v_r.a1, 'a'), (v_r.a2, 'a'), (v_r.b1, 'b'), (v_r.b2, 'b')) as x(p, side)
     where x.p is not null
  loop
    v_kind := case when v_r.winner = 'draw' then 'draw' when v_r.winner = v_side then 'win' else 'loss' end;
    insert into ranks_ledger (profile_id, result_id, kind, delta, earned_at, actor_id)
    values (v_p, v_r.id, v_kind,
            case v_kind when 'win' then v_s.win_points when 'loss' then v_s.loss_points else v_s.draw_points end,
            v_r.played_at, auth.uid())
    on conflict on constraint ranks_ledger_once do nothing;
  end loop;
end $ranks_award_0364$;

comment on function app.ranks_award(uuid) is
  '0364. Internal. A confirmed result''s points into ranks_ledger at the current rules: win_points, loss_points or draw_points for each player on it, earned_at the game''s time; never twice (ranks_ledger_once).';

revoke all on function app.ranks_award(uuid) from public, anon, authenticated;

-- Takes a result's points off again (a void, or a tournament score corrected).
create or replace function app.ranks_unaward(p_result_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $ranks_unaward_0364$
begin
  insert into ranks_ledger (profile_id, result_id, kind, delta, earned_at, actor_id, note)
  select l.profile_id, l.result_id, 'void', -l.delta, l.earned_at, auth.uid(), left(p_note, 200)
    from ranks_ledger l
   where l.result_id = p_result_id and l.kind in ('win', 'loss', 'draw')
  on conflict on constraint ranks_ledger_once do nothing;
end $ranks_unaward_0364$;

comment on function app.ranks_unaward(uuid, text) is
  '0364. Internal. One void row per award of the result, the same points negated at the same earned_at; never twice.';

revoke all on function app.ranks_unaward(uuid, text) from public, anon, authenticated;

-- A live account by its username (lower case), or null.
create or replace function app.ranks_profile_by_username(p_username text) returns uuid
language sql stable security definer set search_path = public as $ranks_profile_by_username_0364$
  select p.id from profiles p
   where p.username = lower(btrim(coalesce(p_username, ''))) and p.deleted_at is null
   limit 1
$ranks_profile_by_username_0364$;

comment on function app.ranks_profile_by_username(text) is
  '0364. Internal. The live profile holding a username (exact, case-folded), or NULL.';

revoke all on function app.ranks_profile_by_username(text) from public, anon, authenticated;

-- One player on a result as other players see them: the match name and the username, never an id.
create or replace function app.ranks_player_json(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public as $ranks_player_json_0364$
  select case when p_profile_id is null then null else
    app.match_display_name(p_profile_id)
      || jsonb_build_object('username', (select p.username from profiles p
                                          where p.id = p_profile_id and p.deleted_at is null),
                            'me', p_profile_id = auth.uid())
  end
$ranks_player_json_0364$;

comment on function app.ranks_player_json(uuid) is
  '0364. Internal. {name, former, username, me} for a player on a result: never a phone, a full name or an id.';

revoke all on function app.ranks_player_json(uuid) from public, anon, authenticated;

-- A result as a player on it sees it.
create or replace function app.ranks_result_json(p_r game_results, p_me uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_result_json_0364$
declare
  v_side   text := case when p_me in (p_r.a1, p_r.a2) then 'a' when p_me in (p_r.b1, p_r.b2) then 'b' end;
  v_status text := p_r.status;
  v_points int;
begin
  if v_status = 'pending' and p_r.expires_at <= now() then
    v_status := 'expired';
  end if;
  select sum(l.delta)::int into v_points from ranks_ledger l where l.result_id = p_r.id and l.profile_id = p_me;
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
    'points', coalesce(v_points, 0));
end $ranks_result_json_0364$;

comment on function app.ranks_result_json(game_results, uuid) is
  '0364. Internal. A result from one player''s side: {id, source, status (a lapsed pending reads expired), played_at, score, outcome won|lost|draw, us [2], them [2] (app.ranks_player_json, null for an empty seat), reported_by_me, can_confirm (pending and on side B), expires_at, points (what it gave them, net)}.';

revoke all on function app.ranks_result_json(game_results, uuid) from public, anon, authenticated;

create or replace function app.ranks_settings_json() returns jsonb
language sql stable security definer set search_path = public as $ranks_settings_json_0364$
  select jsonb_build_object(
    'enabled', s.enabled, 'win_points', s.win_points, 'loss_points', s.loss_points,
    'draw_points', s.draw_points, 'period', s.period, 'board_size', s.board_size,
    'count_reported', s.count_reported, 'count_tournaments', s.count_tournaments,
    'report_hours', s.report_hours, 'updated_at', s.updated_at)
    from ranks_settings s where s.id
$ranks_settings_json_0364$;

comment on function app.ranks_settings_json() is '0364. Internal. The ranks_settings row as JSON.';

revoke all on function app.ranks_settings_json() from public, anon, authenticated;

create or replace function app.ranks_levels_json() returns jsonb
language sql stable security definer set search_path = public as $ranks_levels_json_0364$
  select coalesce(jsonb_agg(jsonb_build_object('name_en', l.name_en, 'name_ar', l.name_ar,
                                               'min_points', l.min_points) order by l.min_points), '[]'::jsonb)
    from ranks_levels l
$ranks_levels_json_0364$;

comment on function app.ranks_levels_json() is '0364. Internal. The levels, lowest first.';

revoke all on function app.ranks_levels_json() from public, anon, authenticated;

-- ===========================================================================
-- 4. The public board
-- ===========================================================================

create or replace function app.ranks_board() returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_board_0364$
declare
  v_s    ranks_settings%rowtype;
  v_from timestamptz;
  v_rows jsonb;
begin
  select * into v_s from ranks_settings where id;
  if not v_s.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  v_from := app.ranks_period_start(v_s.period);

  with pts as (
    select l.profile_id, sum(l.delta)::int as points, max(l.earned_at) as last_at
      from ranks_ledger l
     where l.earned_at >= v_from
     group by l.profile_id
    having sum(l.delta) > 0
  ), live as (
    select pts.* from pts join profiles p on p.id = pts.profile_id and p.deleted_at is null
  ), top as (
    -- Equal points share a rank; the one who got there first is listed first.
    select live.*, rank() over (order by live.points desc) as rnk,
           row_number() over (order by live.points desc, live.last_at, live.profile_id) as rn
      from live
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', t.rnk,
           'name', app.match_display_name(t.profile_id) -> 'name',
           'points', t.points,
           'level', app.ranks_level_json((select coalesce(sum(l.delta), 0)::int from ranks_ledger l
                                           where l.profile_id = t.profile_id)),
           'mine', coalesce(t.profile_id = auth.uid(), false)) order by t.rn), '[]'::jsonb)
    into v_rows
    from top t
   where t.rn <= v_s.board_size;

  return jsonb_build_object(
    'enabled', true,
    'period', v_s.period,
    'from', case when v_s.period = 'all' then null else v_from end,
    'size', v_s.board_size,
    'rows', v_rows);
end $ranks_board_0364$;

comment on function app.ranks_board() is
  '0364. Public (anon). The leaderboard: {enabled:false} while the owner has it off, else {enabled, period, from (null for all time), size, rows: [{rank, name ("First L." or null), points, level {name_en, name_ar, min_points}, mine}]}, the top board_size players by points earned in the period, a tie sharing a rank. Nobody below the board is read, and no id, phone or full name leaves it.';

revoke all on function app.ranks_board() from public;
grant execute on function app.ranks_board() to anon, authenticated;

-- ===========================================================================
-- 5. The player's own side
-- ===========================================================================

create or replace function app.my_ranks() returns jsonb
language plpgsql stable security definer set search_path = public as $my_ranks_0364$
declare
  v_me       uuid := auth.uid();
  v_s        ranks_settings%rowtype;
  v_from     timestamptz;
  v_points   int;
  v_lifetime int;
  v_rank     int;
  v_next     jsonb;
  v_results  jsonb;
  v_report   jsonb;
  v_recent   jsonb;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_s from ranks_settings where id;
  if not v_s.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  v_from := app.ranks_period_start(v_s.period);

  select coalesce(sum(l.delta) filter (where l.earned_at >= v_from), 0)::int, coalesce(sum(l.delta), 0)::int
    into v_points, v_lifetime
    from ranks_ledger l where l.profile_id = v_me;

  -- Their place: one more than the live players ahead of them in the period. Only their own.
  if v_points > 0 then
    select count(*)::int + 1 into v_rank
      from (select l.profile_id from ranks_ledger l
             where l.earned_at >= v_from and l.profile_id <> v_me
             group by l.profile_id having sum(l.delta) > v_points) ahead
      join profiles p on p.id = ahead.profile_id and p.deleted_at is null;
  end if;

  select jsonb_build_object('name_en', l.name_en, 'name_ar', l.name_ar, 'min_points', l.min_points)
    into v_next
    from ranks_levels l where l.min_points > v_lifetime order by l.min_points limit 1;

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
    'period', v_s.period,
    'from', case when v_s.period = 'all' then null else v_from end,
    'size', v_s.board_size,
    'points', v_points,
    'lifetime', v_lifetime,
    'rank', v_rank,
    'level', app.ranks_level_json(v_lifetime),
    'next_level', v_next,
    'rules', jsonb_build_object('win', v_s.win_points, 'loss', v_s.loss_points, 'draw', v_s.draw_points,
                                'report_hours', v_s.report_hours, 'reports', v_s.count_reported),
    'username', (select p.username from profiles p where p.id = v_me),
    'results', v_results,
    'to_report', coalesce(v_report, '[]'::jsonb),
    'recent', v_recent);
end $my_ranks_0364$;

comment on function app.my_ranks() is
  '0364. The signed-in player''s own leaderboard page: {enabled:false} while off, else {enabled, period, from, size, points (this period), lifetime, rank (their place in the period, null with no points; theirs alone), level, next_level (null at the top), rules {win, loss, draw, report_hours, reports}, username, results (app.ranks_result_json, the ones waiting on them first), to_report (their played bookings with no live result, inside report_hours), recent (usernames they played with lately)}.';

revoke all on function app.my_ranks() from public, anon;
grant execute on function app.my_ranks() to authenticated;

create or replace function app.ranks_find_player(p_username text) returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_find_player_0364$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  v_id := app.ranks_profile_by_username(p_username);
  if v_id is null then
    return null;
  end if;
  return jsonb_build_object('username', (select p.username from profiles p where p.id = v_id),
                            'name', app.match_display_name(v_id) -> 'name',
                            'me', v_id = auth.uid());
end $ranks_find_player_0364$;

comment on function app.ranks_find_player(text) is
  '0364. A signed-in player looks a username up, exactly (no search, no list): {username, name, me} or NULL.';

revoke all on function app.ranks_find_player(text) from public, anon;
grant execute on function app.ranks_find_player(text) to authenticated;

create or replace function app.ranks_report(p_reservation_id uuid, p_partner text, p_opponent1 text,
                                            p_opponent2 text, p_won boolean, p_score text)
returns jsonb
language plpgsql security definer set search_path = public as $ranks_report_0364$
declare
  v_me    uuid := auth.uid();
  v_s     ranks_settings%rowtype;
  v_rv    reservations%rowtype;
  v_venue uuid;
  v_a2    uuid;
  v_b1    uuid;
  v_b2    uuid;
  v_row   game_results%rowtype;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_s from ranks_settings where id;
  if not v_s.enabled or not v_s.count_reported then
    raise exception 'RANKS_OFF' using errcode = 'P0001';
  end if;
  if p_won is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_won';
  end if;

  select * into v_rv from reservations where id = p_reservation_id;
  if not found or v_rv.guest_id is distinct from v_me or v_rv.kind <> 'booking'
     or v_rv.status not in ('confirmed', 'arrived', 'completed')
     or v_rv.start_at > now() - interval '30 minutes'
     or v_rv.end_at <= now() - make_interval(hours => v_s.report_hours) then
    raise exception 'RANKS_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  v_a2 := app.ranks_profile_by_username(p_partner);
  v_b1 := app.ranks_profile_by_username(p_opponent1);
  v_b2 := app.ranks_profile_by_username(p_opponent2);
  if v_a2 is null or v_b1 is null or v_b2 is null then
    raise exception 'RANKS_PLAYER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_me in (v_a2, v_b1, v_b2) or v_a2 in (v_b1, v_b2) or v_b1 = v_b2 then
    raise exception 'RANKS_PLAYERS_INVALID' using errcode = 'P0001';
  end if;

  select c.venue_id into v_venue from courts c where c.id = v_rv.court_id;
  perform set_config('app.venue_id', v_venue::text, true);
  -- A report on it that lapsed unanswered no longer stands in the way.
  update game_results set status = 'expired', decided_at = now()
   where reservation_id = v_rv.id and status = 'pending' and expires_at <= now();
  begin
    insert into game_results (venue_id, reservation_id, source, status, a1, a2, b1, b2, winner, score,
                              played_at, reported_by, expires_at)
    values (v_venue, v_rv.id, 'player', 'pending', v_me, v_a2, v_b1, v_b2,
            case when p_won then 'a' else 'b' end, nullif(btrim(p_score), ''),
            v_rv.start_at, v_me, now() + make_interval(hours => v_s.report_hours))
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'RANKS_ALREADY_REPORTED' using errcode = 'P0001';
    when check_violation then
      raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'p_score';
  end;
  return app.ranks_result_json(v_row, v_me);
end $ranks_report_0364$;

comment on function app.ranks_report(uuid, text, text, text, boolean, text) is
  '0364. The booker reports a game they played: their booking (played at least 30 minutes, ended no more than report_hours ago, no live result), their partner and the two opponents by username, whether they won, and an optional score ("6-4, 7-5"). It waits, pending, for an opponent to confirm until report_hours from now. RANKS_OFF, RANKS_NOT_ELIGIBLE, RANKS_PLAYER_NOT_FOUND, RANKS_PLAYERS_INVALID, RANKS_ALREADY_REPORTED, INVALID_VALUE (the score). Returns the result (app.ranks_result_json).';

revoke all on function app.ranks_report(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function app.ranks_report(uuid, text, text, text, boolean, text) to authenticated;

create or replace function app.ranks_confirm(p_result_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $ranks_confirm_0364$
declare
  v_me  uuid := auth.uid();
  v_row game_results%rowtype;
begin
  if v_me is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_accept is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_accept';
  end if;
  select * into v_row from game_results where id = p_result_id for update;
  if not found or v_me not in (v_row.b1, coalesce(v_row.b2, v_row.b1)) then
    raise exception 'RANKS_NOT_YOURS' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'RANKS_RESULT_CLOSED' using errcode = 'P0001';
  end if;

  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.expires_at <= now() then
    update game_results set status = 'expired', decided_at = now() where id = v_row.id returning * into v_row;
  elsif p_accept then
    update game_results set status = 'confirmed', decided_by = v_me, decided_at = now()
     where id = v_row.id returning * into v_row;
    perform app.ranks_award(v_row.id);
  else
    update game_results set status = 'rejected', decided_by = v_me, decided_at = now()
     where id = v_row.id returning * into v_row;
  end if;
  return app.ranks_result_json(v_row, v_me);
end $ranks_confirm_0364$;

comment on function app.ranks_confirm(uuid, boolean) is
  '0364. An opponent on a pending report confirms it (it is confirmed and every player on it gets their points) or turns it down (rejected). A report past expires_at is marked expired instead and the answer says so. RANKS_NOT_YOURS (not on side B), RANKS_RESULT_CLOSED (no longer pending). Returns the result.';

revoke all on function app.ranks_confirm(uuid, boolean) from public, anon;
grant execute on function app.ranks_confirm(uuid, boolean) to authenticated;

-- ===========================================================================
-- 6. The desk and the owner
-- ===========================================================================

create or replace function app.ranks_desk_record(p_reservation_id uuid, p_a1 uuid, p_a2 uuid, p_b1 uuid,
                                                 p_b2 uuid, p_winner text, p_score text)
returns jsonb
language plpgsql security definer set search_path = public as $ranks_desk_record_0364$
declare
  v_s      ranks_settings%rowtype;
  v_rv     reservations%rowtype;
  v_venue  uuid;
  v_played timestamptz := now();
  v_row    game_results%rowtype;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
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
  if p_a1 is null or p_b1 is null
     or exists (select 1 from unnest(array[p_a1, p_a2, p_b1, p_b2]) u(id)
                 where u.id is not null
                   and not exists (select 1 from profiles p where p.id = u.id and p.deleted_at is null)) then
    raise exception 'RANKS_PLAYER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_reservation_id is not null then
    select * into v_rv from reservations where id = p_reservation_id;
    if not found or v_rv.kind <> 'booking' or v_rv.status in ('cancelled', 'expired', 'pending', 'no_show') then
      raise exception 'RANKS_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;
    select c.venue_id into v_venue from courts c where c.id = v_rv.court_id;
    if not (v_venue = any((select app.visible_venue_ids())::uuid[])) then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    v_played := v_rv.start_at;
    perform set_config('app.venue_id', v_venue::text, true);
    -- The desk's word replaces a report still waiting on an opponent.
    update game_results set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
                            void_reason = 'replaced at the desk'
     where reservation_id = p_reservation_id and status = 'pending';
  else
    v_venue := app.current_venue();
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  begin
    insert into game_results (venue_id, reservation_id, source, status, a1, a2, b1, b2, winner, score,
                              played_at, reported_by, decided_by, decided_at)
    values (v_venue, p_reservation_id, 'desk', 'confirmed', p_a1, p_a2, p_b1, p_b2, p_winner,
            nullif(btrim(p_score), ''), v_played, auth.uid(), auth.uid(), now())
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'RANKS_ALREADY_REPORTED' using errcode = 'P0001';
    when check_violation then
      raise exception 'RANKS_PLAYERS_INVALID' using errcode = 'P0001', detail = sqlerrm;
  end;
  perform app.ranks_award(v_row.id);
  perform app.write_audit('ranks.record', 'game_results', v_row.id::text, null, to_jsonb(v_row), null);
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end $ranks_desk_record_0364$;

comment on function app.ranks_desk_record(uuid, uuid, uuid, uuid, uuid, text, text) is
  '0364. Court desk, manager or owner: enters a game''s result, confirmed at once and its points written. Sides A (p_a1, p_a2) and B (p_b1, p_b2), a second seat may be NULL for a player with no account; p_winner a, b or draw; an optional score. With a booking (p_reservation_id) it is played at the booking''s start and replaces a report still pending on it; without one, now, at the caller''s branch. RANKS_OFF, INVALID_VALUE (detail p_score), RANKS_PLAYER_NOT_FOUND, RANKS_PLAYERS_INVALID (a player twice), RANKS_NOT_ELIGIBLE (a cancelled, expired, pending or no-show booking), RANKS_ALREADY_REPORTED (void the confirmed one first), VENUE_MISMATCH. Audited ranks.record.';

revoke all on function app.ranks_desk_record(uuid, uuid, uuid, uuid, uuid, text, text) from public, anon;
grant execute on function app.ranks_desk_record(uuid, uuid, uuid, uuid, uuid, text, text) to authenticated;

create or replace function app.ranks_void(p_result_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $ranks_void_0364$
declare
  v_row    game_results%rowtype;
  v_before jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_row from game_results where id = p_result_id for update;
  if not found or not (v_row.venue_id = any((select app.visible_venue_ids())::uuid[])) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.status not in ('pending', 'confirmed') then
    raise exception 'RANKS_RESULT_CLOSED' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  update game_results set status = 'voided', decided_by = auth.uid(), decided_at = now(),
                          void_reason = left(btrim(p_reason), 200)
   where id = v_row.id returning * into v_row;
  perform app.ranks_unaward(v_row.id, v_row.void_reason);
  perform app.write_audit('ranks.void', 'game_results', v_row.id::text, v_before, to_jsonb(v_row), null);
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end $ranks_void_0364$;

comment on function app.ranks_void(uuid, text) is
  '0364. Manager or owner: voids a pending or confirmed result with a reason (3+ characters); the points it gave come off again at the game''s time. REASON_REQUIRED, NOT_FOUND (or another branch''s), RANKS_RESULT_CLOSED. Audited ranks.void.';

revoke all on function app.ranks_void(uuid, text) from public, anon;
grant execute on function app.ranks_void(uuid, text) to authenticated;

create or replace function app.ranks_desk_results(p_status text, p_limit int) returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_desk_results_0364$
declare
  v_rows jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('pending', 'confirmed', 'rejected', 'expired', 'voided') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
  end if;
  select coalesce(jsonb_agg(x.j order by x.reported_at desc), '[]'::jsonb) into v_rows
    from (select r.reported_at, jsonb_build_object(
                   'id', r.id, 'source', r.source,
                   'status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status end,
                   'winner', r.winner, 'score', r.score, 'played_at', r.played_at, 'reported_at', r.reported_at,
                   'reservation_id', r.reservation_id, 'void_reason', r.void_reason,
                   'court', (select jsonb_build_object('name_en', c.name_en, 'name_ar', c.name_ar)
                               from reservations rv join courts c on c.id = rv.court_id where rv.id = r.reservation_id),
                   'a', jsonb_build_array(app.ranks_staff_player_json(r.a1), app.ranks_staff_player_json(r.a2)),
                   'b', jsonb_build_array(app.ranks_staff_player_json(r.b1), app.ranks_staff_player_json(r.b2))) as j
            from game_results r
           where r.venue_id = any((select app.visible_venue_ids())::uuid[])
             and (p_status is null
                  or (p_status = 'pending' and r.status = 'pending' and r.expires_at > now())
                  or (p_status = 'expired' and (r.status = 'expired' or (r.status = 'pending' and r.expires_at <= now())))
                  or (p_status not in ('pending', 'expired') and r.status = p_status))
           order by r.reported_at desc
           limit least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  return v_rows;
end $ranks_desk_results_0364$;

-- Staff see the player's full name and username (the desk knows its guests), never a phone here.
create or replace function app.ranks_staff_player_json(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public as $ranks_staff_player_json_0364$
  select case when p_profile_id is null then null else
    (select jsonb_build_object('id', p.id,
                               'name', coalesce(nullif(btrim(p.full_name), ''),
                                                nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')),
                               'username', p.username, 'former', p.deleted_at is not null)
       from profiles p where p.id = p_profile_id)
  end
$ranks_staff_player_json_0364$;

comment on function app.ranks_staff_player_json(uuid) is
  '0364. Internal. A player on a result as the desk sees them: {id, name (full), username, former}.';

revoke all on function app.ranks_staff_player_json(uuid) from public, anon, authenticated;

comment on function app.ranks_desk_results(text, int) is
  '0364. Court desk, manager or owner: the latest results at the branches in scope, newest report first (p_status narrows: pending means still inside its window, expired includes a lapsed pending; p_limit 1-200, default 50): [{id, source, status, winner, score, played_at, reported_at, reservation_id, void_reason, court, a [2], b [2] (app.ranks_staff_player_json)}].';

revoke all on function app.ranks_desk_results(text, int) from public, anon;
grant execute on function app.ranks_desk_results(text, int) to authenticated;

create or replace function app.ranks_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $ranks_admin_0364$
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object('settings', app.ranks_settings_json(), 'levels', app.ranks_levels_json());
end $ranks_admin_0364$;

comment on function app.ranks_admin() is
  '0364. Manager or owner: {settings (ranks_settings), levels [{name_en, name_ar, min_points}] lowest first}.';

revoke all on function app.ranks_admin() from public, anon;
grant execute on function app.ranks_admin() to authenticated;

create or replace function app.set_ranks_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_ranks_settings_0364$
declare
  v_key    text;
  v_before jsonb;
  v_row    ranks_settings%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('enabled', 'win_points', 'loss_points', 'draw_points', 'period', 'board_size',
                     'count_reported', 'count_tournaments', 'report_hours') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;

  v_before := app.ranks_settings_json();
  select * into v_row from ranks_settings where id for update;
  begin
    v_row := jsonb_populate_record(v_row, p_patch);
    update ranks_settings
       set enabled           = v_row.enabled,
           win_points        = v_row.win_points,
           loss_points       = v_row.loss_points,
           draw_points       = v_row.draw_points,
           period            = v_row.period,
           board_size        = v_row.board_size,
           count_reported    = v_row.count_reported,
           count_tournaments = v_row.count_tournaments,
           report_hours      = v_row.report_hours,
           updated_at        = now(),
           updated_by        = auth.uid()
     where id;
  exception when check_violation or not_null_violation or invalid_text_representation
                 or numeric_value_out_of_range or datatype_mismatch or invalid_parameter_value then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.write_audit('ranks.settings', 'ranks_settings', 'true', v_before, app.ranks_settings_json(), null);
  return app.ranks_settings_json();
end $set_ranks_settings_0364$;

comment on function app.set_ranks_settings(jsonb) is
  '0364. Owner: patches the leaderboard''s rules with the keys given (enabled, win_points, loss_points, draw_points, period, board_size, count_reported, count_tournaments, report_hours); an unknown key is INVALID_ARGUMENT (detail = the key), a value the table refuses INVALID_VALUE. New points apply to results confirmed from now on. Returns the settings. Audited ranks.settings.';

revoke all on function app.set_ranks_settings(jsonb) from public, anon;
grant execute on function app.set_ranks_settings(jsonb) to authenticated;

create or replace function app.set_ranks_levels(p_levels jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_ranks_levels_0364$
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
  if not exists (select 1 from jsonb_array_elements(p_levels) e where (e ->> 'min_points') = '0') then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'base';
  end if;

  v_before := app.ranks_levels_json();
  delete from ranks_levels where true;
  begin
    insert into ranks_levels (name_en, name_ar, min_points)
    select btrim(e ->> 'name_en'), btrim(e ->> 'name_ar'), (e ->> 'min_points')::int
      from jsonb_array_elements(p_levels) e;
  exception when check_violation or not_null_violation or unique_violation or invalid_text_representation
                 or numeric_value_out_of_range then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = sqlerrm;
  end;

  perform app.write_audit('ranks.levels', 'ranks_levels', 'all', jsonb_build_object('levels', v_before),
                          jsonb_build_object('levels', app.ranks_levels_json()), null);
  return app.ranks_levels_json();
end $set_ranks_levels_0364$;

comment on function app.set_ranks_levels(jsonb) is
  '0364. Owner: replaces the levels with p_levels, [{name_en, name_ar, min_points}], 1 to 10 of them, one at 0, no two at the same points, names 1-24 characters. INVALID_VALUE (detail count, base or the refusal). Returns the levels. Audited ranks.levels.';

revoke all on function app.set_ranks_levels(jsonb) from public, anon;
grant execute on function app.set_ranks_levels(jsonb) to authenticated;

create or replace function app.ranks_adjust(p_profile_id uuid, p_delta int, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $ranks_adjust_0364$
declare
  v_id uuid;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000 then
    raise exception 'INVALID_VALUE' using errcode = 'P0001', detail = 'p_delta';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = p_profile_id and p.deleted_at is null) then
    raise exception 'RANKS_PLAYER_NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into ranks_ledger (profile_id, kind, delta, earned_at, actor_id, note)
  values (p_profile_id, 'adjust', p_delta, now(), auth.uid(), left(btrim(p_note), 200))
  returning id into v_id;
  perform app.write_audit('ranks.adjust', 'ranks_ledger', v_id::text, null,
                          jsonb_build_object('profile_id', p_profile_id, 'delta', p_delta, 'note', p_note), null);
  return jsonb_build_object('id', v_id);
end $ranks_adjust_0364$;

comment on function app.ranks_adjust(uuid, int, text) is
  '0364. Owner: adds or takes off points for one player, now, with a reason (|delta| 1-1000). INVALID_VALUE, REASON_REQUIRED, RANKS_PLAYER_NOT_FOUND. Audited ranks.adjust.';

revoke all on function app.ranks_adjust(uuid, int, text) from public, anon;
grant execute on function app.ranks_adjust(uuid, int, text) to authenticated;

-- ===========================================================================
-- 7. Tournament matches feed the board
-- ===========================================================================

create or replace function app.trg_tournament_match_ranks() returns trigger
language plpgsql security definer set search_path = public as $trg_tournament_match_ranks_0364$
declare
  v_s    ranks_settings%rowtype;
  v_old  uuid;
  v_new  uuid;
  v_g    uuid[];
begin
  if new.points_a is not distinct from old.points_a and new.points_b is not distinct from old.points_b then
    return null;
  end if;
  select * into v_s from ranks_settings where id;

  -- A score changed or cleared: the old result and its points go, whatever the switches say now.
  select r.id into v_old from game_results r where r.tournament_match_id = new.id and r.status = 'confirmed';
  if v_old is not null then
    perform set_config('app.venue_id', new.venue_id::text, true);
    update game_results set status = 'voided', decided_at = now(), void_reason = 'tournament score changed'
     where id = v_old;
    perform app.ranks_unaward(v_old, 'tournament score changed');
  end if;

  if new.points_a is null or not v_s.enabled or not v_s.count_tournaments then
    return null;
  end if;

  select array[(select e.guest_id from tournament_entries e where e.id = new.a1),
               (select e.guest_id from tournament_entries e where e.id = new.a2),
               (select e.guest_id from tournament_entries e where e.id = new.b1),
               (select e.guest_id from tournament_entries e where e.id = new.b2)]
    into v_g;
  perform set_config('app.venue_id', new.venue_id::text, true);
  insert into game_results (venue_id, tournament_match_id, source, status, a1, a2, b1, b2, winner, score,
                            played_at, reported_by, decided_by, decided_at)
  values (new.venue_id, new.id, 'tournament', 'confirmed', v_g[1], v_g[2], v_g[3], v_g[4],
          case when new.points_a > new.points_b then 'a' when new.points_b > new.points_a then 'b' else 'draw' end,
          case when new.points_a <= 99 and new.points_b <= 99 then new.points_a || '-' || new.points_b end,
          coalesce(new.scored_at, now()), coalesce(new.scored_by, auth.uid(), new.id), new.scored_by, now())
  returning id into v_new;
  perform app.ranks_award(v_new);
  return null;
end $trg_tournament_match_ranks_0364$;

comment on function app.trg_tournament_match_ranks() is
  '0364. AFTER UPDATE OF points_a, points_b on tournament_matches: a new or corrected score voids the match''s confirmed result (its points come off) and, while the leaderboard is on and count_tournaments, records the new one (source tournament) and its points.';

drop trigger if exists tournament_match_ranks on public.tournament_matches;
create trigger tournament_match_ranks after update of points_a, points_b on public.tournament_matches
  for each row execute function app.trg_tournament_match_ranks();

-- ===========================================================================
-- 8. The account merge follows a player's results and points
-- ===========================================================================

-- game_results.a1/a2/b1/b2 and ranks_ledger.profile_id point at profiles, so the account merge
-- has to say what it does with them (account-merge.test.ts holds every such column to
-- app.profile_merge_columns()). A game and its points follow the person: both re-point in the
-- merge's generic loop, and ranks_ledger's append-only trigger lets that one UPDATE through.
-- Two accounts of one person that sat on the SAME game (a report named the other account) cannot
-- both stay on it (game_results_four): that game, and the drop's points from it, stay on the drop's
-- tombstone, so the person keeps that game once, as the kept account, and the merge goes through.
-- game_results re-points before ranks_ledger (ord 210-213, then 220), so the ledger rule can ask
-- the game whether it moved.

create or replace function app.trg_game_results_merge() returns trigger
language plpgsql set search_path = public as $trg_game_results_merge_0364$
begin
  if current_setting('app.profile_merge', true) = 'on'
     and not (new.a1 <> new.b1
              and (new.a2 is null or (new.a2 <> new.a1 and new.a2 <> new.b1))
              and (new.b2 is null or (new.b2 <> new.a1 and new.b2 <> new.b1 and (new.a2 is null or new.b2 <> new.a2)))) then
    return null;  -- this game keeps the drop's seat
  end if;
  return new;
end $trg_game_results_merge_0364$;

comment on function app.trg_game_results_merge() is
  '0364. BEFORE UPDATE on game_results: while the account merge holds app.profile_merge, a re-point that would seat one person twice on a game (game_results_four) is skipped, so that game keeps the dropped account''s seat. Otherwise a no-op.';

revoke all on function app.trg_game_results_merge() from public, anon, authenticated;

drop trigger if exists game_results_merge on public.game_results;
create trigger game_results_merge before update on public.game_results
  for each row execute function app.trg_game_results_merge();

-- app.profile_merge_columns: re-created from 20261017000347_discounts_merge.sql:19, verbatim
-- plus the five rows at 210-220.
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0364$
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
    (200, 'public', 'reservation_court_discounts', 'customer_id',     'repoint'),
    (210, 'public', 'game_results',          'a1',                    'repoint'),
    (211, 'public', 'game_results',          'a2',                    'repoint'),
    (212, 'public', 'game_results',          'b1',                    'repoint'),
    (213, 'public', 'game_results',          'b2',                    'repoint'),
    (220, 'public', 'ranks_ledger',          'profile_id',            'repoint'),
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
    (430, 'public', 'frame_grants',          'profile_id',            'rule'),
    (440, 'public', 'customer_discounts',    'customer_id',           'rule'),
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
$profile_merge_columns_0364$;


comment on function app.profile_merge_columns() is
  '0303, 0307, username_holds since 0314, frame_grants since 0320, customer_discounts and reservation_court_discounts since 0347, game_results and ranks_ledger since 0364. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;

-- ===========================================================================
-- 9. Live: the board and a player's results over realtime broadcast
-- ===========================================================================
-- Majed (2026-10-22): the leaderboard is live, like the rest of the system. Two broadcast-from-
-- database topics, each event a bare "something changed" the phone answers by reading again
-- through ranks_board / my_ranks, so a payload never carries a name, an id or a number (SEC-28's
-- rule, held by check-broadcast-payloads.mjs):
--   ranks              the board moved (points written, a rule or a level changed). Public like
--                      the board itself: anon and signed-in sessions may listen.
--   ranks:<profile id> a result this player is on changed (reported, confirmed, turned down,
--                      voided): their "confirm a score" card and their games. Only that player.
-- The poll on the phone stays the safety net while a channel is down.

create or replace function app.rt_ranks_board() returns trigger
language plpgsql security definer set search_path = public as $rt_ranks_board_0364$
begin
  begin
    perform realtime.send(jsonb_build_object('at', now()), 'board', 'ranks', true);
  exception when others then null;
  end;
  return null;
end $rt_ranks_board_0364$;

comment on function app.rt_ranks_board() is
  '0364. AFTER statement trigger on ranks_ledger, ranks_settings and ranks_levels: one ''board'' broadcast on the private ''ranks'' topic, payload {at} only. Never raises.';

revoke all on function app.rt_ranks_board() from public, anon, authenticated;

drop trigger if exists rt_ranks_board on public.ranks_ledger;
create trigger rt_ranks_board after insert on public.ranks_ledger
  for each statement execute function app.rt_ranks_board();
drop trigger if exists rt_ranks_board on public.ranks_settings;
create trigger rt_ranks_board after update on public.ranks_settings
  for each statement execute function app.rt_ranks_board();
drop trigger if exists rt_ranks_board on public.ranks_levels;
create trigger rt_ranks_board after insert or update or delete on public.ranks_levels
  for each statement execute function app.rt_ranks_board();

create or replace function app.rt_ranks_result() returns trigger
language plpgsql security definer set search_path = public as $rt_ranks_result_0364$
declare
  v_p uuid;
begin
  for v_p in
    select distinct x.p from unnest(array[new.a1, new.a2, new.b1, new.b2]) as x(p) where x.p is not null
  loop
    begin
      perform realtime.send(jsonb_build_object('status', new.status), 'result', 'ranks:' || v_p::text, true);
    exception when others then null;
    end;
  end loop;
  return null;
end $rt_ranks_result_0364$;

comment on function app.rt_ranks_result() is
  '0364. AFTER INSERT OR UPDATE OF status on game_results: a ''result'' broadcast on each player''s own private ''ranks:<profile id>'' topic, payload {status} only. Never raises.';

revoke all on function app.rt_ranks_result() from public, anon, authenticated;

drop trigger if exists rt_ranks_result on public.game_results;
create trigger rt_ranks_result after insert or update of status on public.game_results
  for each row execute function app.rt_ranks_result();

-- Who may listen (the 0224 form): the board topic is as public as the board; a player's topic is
-- theirs alone.
do $rt_ranks_0364$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent - skipping broadcast RLS policies';
    return;
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_ranks on realtime.messages
  $p$;
  execute $p$
    create policy touchpadel_rt_ranks on realtime.messages
      for select to anon, authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (realtime.topic() = 'ranks'
             or (auth.uid() is not null and realtime.topic() = 'ranks:' || auth.uid()::text))
      )
  $p$;
end $rt_ranks_0364$;
