set lock_timeout = '3s';
set statement_timeout = '60s';

-- tournaments_play_fixes — the tournaments review fixes (play), plan
-- ~/.claude/plans/go-over-the-backend-partitioned-metcalfe.md §0311.
-- Re-issues only from each function's latest body:
--
--   c26 app.tournament_set_rounds (0310): check 12 sit_out, a round's
--       sit-outs are entries with the fewest sit-outs so far (the rounds
--       before from_round, then the payload's earlier rounds), the rule both
--       engines draw by; core validateRoundsPayload is its twin.
--   c38 app.tournament_set_rounds: starting a closed tournament below
--       min_entries is TOURNAMENT_UNDER_FILLED (detail <registered>/<min>);
--       app.tournament_mark_no_show (0301): a waitlisted substitute entry
--       runs the guest path's deleted-account and match-ban checks.
--   c32 mark_no_show: the substitute takes the sit-out of every round with
--       an unscored match, not only the rounds not begun.
--   c33 mark_no_show without a substitute: the first round to delete is the
--       entry's first own unscored match, or a sit-out in a round not begun.
--   c34 mark_no_show: the substitute swap moves each swapped match's
--       revision, so a score from a stale screen is 'changed'.
--   c35 app.tournament_score (0301): on a finished tournament only a manager
--       or the owner writes (FORBIDDEN detail finished), within 48 hours of
--       finished_at (TOURNAMENT_SCORE_REFUSED detail closed), always with a
--       reason (REASON_REQUIRED).
--   c36 tournament_score: a Mexicano correction on a finished tournament
--       deletes no later round (set_rounds could never draw it again).
--   c37 tournament_score: a null p_expected_revision is INVALID_ARGUMENT, a
--       match gone by the time it is locked is TOURNAMENT_NOT_FOUND, and the
--       sum is taken in int (no smallint overflow).
--   c27 app.tournament_standings (0301): rank counts only the registered
--       rows; a withdrawn or no-show row ranks after every registered one
--       (core rankStandings is the twin, changed with it);
--       app.tournament_public (0301) carries each standing's withdrawn.
--
-- No new code. Lock order unchanged: tournaments FOR UPDATE -> entries ->
-- rounds and matches (0301).

-- ===========================================================================
-- 1. tournament_set_rounds (c26, c38), re-issued from 0310:688
-- ===========================================================================
create or replace function app.tournament_set_rounds(p_tournament_id uuid, p_payload jsonb, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_set_rounds_0311$
declare
  v_t       tournaments%rowtype;
  v_replay  jsonb;
  v_rounds  jsonb;
  v_r       jsonb;
  v_m       jsonb;
  v_x       jsonb;
  v_shape   boolean := true;
  v_based   numeric;
  v_from    numeric;
  v_n       int;
  v_last    int;
  v_active  text[];
  v_courts  text[];
  v_round   uuid;
  v_planned int;
  v_result  jsonb;
  v_sat     jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0310 (s0): the branch is checked before the row is locked.
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  select * into v_t from tournaments where id = v_t.id for update;
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'tournament_set_rounds');
  if v_replay is not null then
    return v_replay;
  end if;

  -- The §1.10 shape (isRoundsPayloadShape): an object; based_on_revision and
  -- from_round whole numbers; rounds an array of {round_no whole, matches
  -- [{court_id, a: [id, id], b: [id, id]}], sit_out [id]}, every id a
  -- non-empty string. Anything else is not a rules question.
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'based_on_revision') is distinct from 'number'
     or jsonb_typeof(p_payload->'from_round') is distinct from 'number'
     or jsonb_typeof(p_payload->'rounds') is distinct from 'array' then
    v_shape := false;
  else
    v_based := (p_payload->>'based_on_revision')::numeric;
    v_from := (p_payload->>'from_round')::numeric;
    if v_based <> trunc(v_based) or v_from <> trunc(v_from) then
      v_shape := false;
    end if;
    v_rounds := p_payload->'rounds';
    for v_r in select e from jsonb_array_elements(v_rounds) e loop
      exit when not v_shape;
      if jsonb_typeof(v_r) <> 'object'
         or jsonb_typeof(v_r->'round_no') is distinct from 'number'
         or jsonb_typeof(v_r->'matches') is distinct from 'array'
         or jsonb_typeof(v_r->'sit_out') is distinct from 'array' then
        v_shape := false;
        exit;
      end if;
      if (v_r->>'round_no')::numeric <> trunc((v_r->>'round_no')::numeric) then
        v_shape := false;
        exit;
      end if;
      for v_x in select e from jsonb_array_elements(v_r->'sit_out') e loop
        if jsonb_typeof(v_x) <> 'string' or v_x #>> '{}' = '' then
          v_shape := false;
        end if;
      end loop;
      for v_m in select e from jsonb_array_elements(v_r->'matches') e loop
        if jsonb_typeof(v_m) <> 'object'
           or jsonb_typeof(v_m->'court_id') is distinct from 'string' or v_m->>'court_id' = ''
           or jsonb_typeof(v_m->'a') is distinct from 'array' or jsonb_array_length(v_m->'a') <> 2
           or jsonb_typeof(v_m->'b') is distinct from 'array' or jsonb_array_length(v_m->'b') <> 2 then
          v_shape := false;
        elsif exists (select 1 from jsonb_array_elements((v_m->'a') || (v_m->'b')) p
                       where jsonb_typeof(p) <> 'string' or p #>> '{}' = '') then
          v_shape := false;
        end if;
      end loop;
    end loop;
  end if;
  if not v_shape then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_payload';
  end if;

  v_n := jsonb_array_length(v_rounds);
  select coalesce(max(r.round_no), 0) into v_last from tournament_rounds r where r.tournament_id = v_t.id;
  select coalesce(array_agg(e.id::text order by e.id), '{}'::text[]) into v_active
    from tournament_entries e
   where e.tournament_id = v_t.id and e.status = 'registered';
  -- The courts of the run's live adopted event blocks.
  select coalesce(array_agg(distinct r.court_id::text), '{}'::text[]) into v_courts
    from reservations r
   where r.protocol_run_id = v_t.protocol_run_id and r.block_purpose = 'event'
     and r.status in ('pending', 'confirmed', 'arrived');

  -- The checks, in the order of §1.9 (validateRoundsPayload's order).
  -- 1. status
  if v_t.status not in ('closed', 'running') then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'status';
  end if;
  -- 2. stale (review M2: the revision moves on every score)
  if v_based <> v_t.revision then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'stale',
      hint = 'the tournament changed since these rounds were made; read it again';
  end if;
  -- 3. engine
  if p_payload->>'engine' is distinct from 'tp-tour-1' then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'engine';
  end if;
  -- 4. format
  if p_payload->>'format' is distinct from v_t.format then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'format';
  end if;
  -- 5. numbering: from_round in 1..last+1, at least one round, contiguous, none past 30.
  if v_from < 1 or v_from > v_last + 1 or v_n < 1 or v_from - 1 + v_n > 30
     or exists (select 1 from jsonb_array_elements(v_rounds) with ordinality x(r, i)
                 where (x.r->>'round_no')::numeric <> v_from + x.i - 1) then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'numbering';
  end if;
  -- 6. played: nothing at or after from_round has a score.
  if exists (select 1 from tournament_matches m
              where m.tournament_id = v_t.id and m.round_no >= v_from and m.points_a is not null) then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'played';
  end if;
  if v_t.format = 'mexicano' then
    -- 7. one round at a time, within the plan
    if v_n <> 1 or v_t.rounds_planned is null or v_from > v_t.rounds_planned then
      raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'mexicano_one';
    end if;
    -- 8. after a fully scored round
    if v_from > 1 and not exists (
         select 1 from tournament_rounds r
          where r.tournament_id = v_t.id and r.round_no = v_from - 1
            and exists (select 1 from tournament_matches m where m.round_id = r.id)
            and not exists (select 1 from tournament_matches m where m.round_id = r.id and m.points_a is null)) then
      raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'round_open';
    end if;
  end if;
  -- 9. seat: every round seats the active set exactly once.
  if exists (
       select 1
         from jsonb_array_elements(v_rounds) x(r)
        cross join lateral (
          select count(*) as n, count(distinct s.id) as d, bool_and(s.id = any (v_active)) as known
            from (select jsonb_array_elements_text(m.e->'a') as id
                    from jsonb_array_elements(x.r->'matches') m(e)
                  union all
                  select jsonb_array_elements_text(m.e->'b')
                    from jsonb_array_elements(x.r->'matches') m(e)
                  union all
                  select jsonb_array_elements_text(x.r->'sit_out')) s) c
        where c.n <> cardinality(v_active) or c.d <> c.n or not coalesce(c.known, true)) then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'seat';
  end if;
  -- 10. court: distinct per round, each a court of a live adopted block.
  if exists (
       select 1
         from jsonb_array_elements(v_rounds) x(r)
        cross join lateral (
          select count(*) as n, count(distinct m.e->>'court_id') as d,
                 bool_and((m.e->>'court_id') = any (v_courts)) as known
            from jsonb_array_elements(x.r->'matches') m(e)) c
        where c.d <> c.n or not coalesce(c.known, true)) then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'court';
  end if;
  -- 11. courts_used: 1..floor(active / 4) matches per round.
  if exists (select 1 from jsonb_array_elements(v_rounds) x(r)
              where jsonb_array_length(x.r->'matches') < 1
                 or jsonb_array_length(x.r->'matches') > cardinality(v_active) / 4) then
    raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'courts_used';
  end if;
  -- 12. sit_out (0311, c26): a round's sit-outs are entries with the fewest
  -- sit-outs so far (the rounds before from_round, then the payload's earlier
  -- rounds), the rule the Americano and Mexicano engines draw by. A sit-out
  -- is worth floor(points_target / 2), so the desk does not pick who sits.
  select coalesce(jsonb_object_agg(b.id, b.n), '{}'::jsonb) into v_sat
    from (select y.id::text as id, count(*) as n
            from tournament_rounds r
           cross join lateral unnest(r.bye_entry_ids) y(id)
           where r.tournament_id = v_t.id and r.round_no < v_from
           group by y.id) b;
  for v_r in select e from jsonb_array_elements(v_rounds) e loop
    if (select max(coalesce((v_sat->>s.id)::int, 0)) from jsonb_array_elements_text(v_r->'sit_out') s(id))
       > (select min(coalesce((v_sat->>a.id)::int, 0)) from unnest(v_active) a(id)
           where not ((v_r->'sit_out') ? a.id)) then
      raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'sit_out',
        hint = 'the entries who have sat out least sit out next';
    end if;
    v_sat := v_sat || coalesce((select jsonb_object_agg(s.id, coalesce((v_sat->>s.id)::int, 0) + 1)
                                  from jsonb_array_elements_text(v_r->'sit_out') s(id)), '{}'::jsonb);
  end loop;
  -- Starting play (0311, c38): a closed tournament the desk thinned below its
  -- minimum is cancelled (and refunded), not started.
  if v_t.status = 'closed' and cardinality(v_active) < v_t.min_entries then
    raise exception 'TOURNAMENT_UNDER_FILLED' using errcode = 'P0001',
      detail = format('%s/%s', cardinality(v_active), v_t.min_entries);
  end if;

  -- The writes. Seeds first: a registered entry with none takes the next
  -- numbers by entered_at (the cut-off normally stamped them).
  update tournament_entries e
     set seed_no = s.base + s.n, updated_at = now()
    from (select x.id, row_number() over (order by x.entered_at, x.id) as n,
                 (select coalesce(max(y.seed_no), 0) from tournament_entries y where y.tournament_id = v_t.id) as base
            from tournament_entries x
           where x.tournament_id = v_t.id and x.status = 'registered' and x.seed_no is null) s
   where e.id = s.id;

  -- Only unscored rounds are at or after from_round (check 6): the cascade
  -- takes their matches.
  delete from tournament_rounds r where r.tournament_id = v_t.id and r.round_no >= v_from;
  for v_r in select e from jsonb_array_elements(v_rounds) e loop
    insert into tournament_rounds (venue_id, tournament_id, round_no, bye_entry_ids, generated_by)
    values (v_t.venue_id, v_t.id, (v_r->>'round_no')::int,
            array(select s::uuid from jsonb_array_elements_text(v_r->'sit_out') s), auth.uid())
    returning id into v_round;
    insert into tournament_matches (venue_id, tournament_id, round_id, round_no, court_id, a1, a2, b1, b2)
    select v_t.venue_id, v_t.id, v_round, (v_r->>'round_no')::int, (m.e->>'court_id')::uuid,
           (m.e->'a'->>0)::uuid, (m.e->'a'->>1)::uuid, (m.e->'b'->>0)::uuid, (m.e->'b'->>1)::uuid
      from jsonb_array_elements(v_r->'matches') m(e);
  end loop;

  v_planned := case when v_t.format = 'americano' then (v_from - 1 + v_n)::int else v_t.rounds_planned end;
  update tournaments
     set revision = revision + 1,
         rounds_planned = v_planned,
         status = case when status = 'closed' then 'running' else status end,
         updated_at = now()
   where id = v_t.id
  returning * into v_t;

  v_result := jsonb_build_object('duplicate', false, 'revision', v_t.revision, 'rounds_planned', v_t.rounds_planned,
                                 'status', v_t.status);
  perform app.write_audit('tournament.rounds', 'tournaments', v_t.id::text, null,
                          jsonb_build_object('from_round', v_from, 'rounds', v_n, 'revision', v_t.revision,
                                             'rounds_planned', v_t.rounds_planned, 'status', v_t.status));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $tournament_set_rounds_0311$;

comment on function app.tournament_set_rounds(uuid, jsonb, text) is
  'Tournaments (M7, TD-7, §1.9, §1.10; 0310 s0; 0311 c26, c38). The court desk, managers and the owner: the one write of the play. p_payload {engine tp-tour-1, format, based_on_revision, from_round, rounds [{round_no, matches [{court_id, a [entry, entry], b [entry, entry]}], sit_out [entry]}]} replaces the rounds from from_round on. FORBIDDEN; TOURNAMENT_NOT_FOUND; VENUE_MISMATCH (both before the row lock); INVALID_ARGUMENT detail p_idempotency_key, or p_payload (not the shape); a replay returns the stored answer; then TOURNAMENT_ROUNDS_INVALID with the first failing detail, in order: status (not closed or running), stale (based_on_revision is not the revision), engine, format, numbering (from_round in 1..last+1, at least one round, contiguous, at most 30), played (a score at or after from_round), mexicano_one (Mexicano: one round, within rounds_planned), round_open (Mexicano: the round before not fully scored), seat (each registered entry exactly once per round, nothing else), court (distinct, each a court of a live block of the run), courts_used (1..floor(registered/4) matches), sit_out (0311: a sit-out with more sit-outs so far than a player of the round; counted over the rounds before from_round, then the payload''s); then TOURNAMENT_UNDER_FILLED detail <registered>/<min_entries> (0311: a closed tournament below min_entries). Stamps missing seeds, deletes the rounds from from_round on, writes the new ones; Americano rounds_planned = from_round - 1 + n; revision + 1; closed -> running. Audit tournament.rounds. Returns {duplicate, revision, rounds_planned, status}.';

revoke all on function app.tournament_set_rounds(uuid, jsonb, text) from public, anon;
grant execute on function app.tournament_set_rounds(uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- 2. tournament_score (c35, c36, c37), re-issued from 0301:264
-- ===========================================================================
-- Lock order: tournaments FOR UPDATE -> the match -> rounds (a Mexicano
-- correction's delete); the score that finishes then releases the blocks
-- (courts -> reservations).
create or replace function app.tournament_score(
  p_match_id          uuid,
  p_points_a          smallint,
  p_points_b          smallint,
  p_expected_revision int,
  p_reason            text
) returns jsonb
language plpgsql security definer set search_path = public as $tournament_score_0311$
declare
  v_venue   uuid;
  v_tid     uuid;
  v_t       tournaments%rowtype;
  v_m       tournament_matches%rowtype;
  v_reason  text := nullif(btrim(p_reason), '');
  v_correct boolean;
  v_removed int;
  v_n       int;
  v_status  text;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select m.venue_id, m.tournament_id into v_venue, v_tid from tournament_matches m where m.id = p_match_id;
  if v_venue is null or not (v_venue = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_venue, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  -- 0311 (c37): the revision is how a stale screen is caught; null skips it.
  if p_expected_revision is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_expected_revision';
  end if;

  select * into v_t from tournaments where id = v_tid for update;
  select * into v_m from tournament_matches where id = p_match_id for update;
  -- 0311 (c37): a regeneration may have deleted it while this call waited.
  if not found then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_t.status not in ('running', 'finished') then
    raise exception 'TOURNAMENT_SCORE_REFUSED' using errcode = 'P0001', detail = 'status';
  end if;
  -- 0311 (c35): after the finish a score is a manager's decision, made within
  -- 48 hours and always explained.
  if v_t.status = 'finished' then
    if not app.is_staff_at(v_venue, 'manager', 'owner') then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'finished',
        hint = 'the tournament has finished: a manager changes its scores';
    end if;
    if now() > coalesce(v_t.finished_at, v_t.ends_at) + interval '48 hours' then
      raise exception 'TOURNAMENT_SCORE_REFUSED' using errcode = 'P0001', detail = 'closed',
        hint = 'the scores are final 48 hours after the finish';
    end if;
    if v_reason is null then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
  end if;
  if p_points_a is null or p_points_b is null or p_points_a < 0 or p_points_b < 0
     or p_points_a::int + p_points_b::int <> v_t.points_target then
    raise exception 'TOURNAMENT_SCORE_REFUSED' using errcode = 'P0001', detail = 'invalid',
      hint = format('the two sides add up to %s', v_t.points_target);
  end if;
  if p_expected_revision is distinct from v_m.revision then
    raise exception 'TOURNAMENT_SCORE_REFUSED' using errcode = 'P0001', detail = 'changed',
      hint = 'this match changed since it was shown; read it again';
  end if;
  v_correct := v_m.points_a is not null;
  if v_correct and v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- A Mexicano correction (TD-11): the later rounds were drawn from the
  -- standings this score changes. A scored later round is history and locks
  -- the correction; unscored later rounds are deleted and the desk draws
  -- again. An Americano schedule never depended on scores. 0311 (c36): once
  -- finished nothing can draw them again, so they stay as drawn.
  if v_correct and v_t.format = 'mexicano' then
    if exists (select 1 from tournament_matches x
                where x.tournament_id = v_t.id and x.round_no > v_m.round_no and x.points_a is not null) then
      raise exception 'TOURNAMENT_SCORE_REFUSED' using errcode = 'P0001', detail = 'locked',
        hint = 'a later round has been played on these standings';
    end if;
    if v_t.status = 'running' then
      delete from tournament_rounds r where r.tournament_id = v_t.id and r.round_no > v_m.round_no;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_removed := v_m.round_no + 1;
      end if;
    end if;
  end if;

  insert into tournament_score_events (venue_id, tournament_id, match_id, points_a_before, points_b_before,
                                       points_a, points_b, reason, actor_staff_id)
  values (v_t.venue_id, v_t.id, v_m.id, v_m.points_a, v_m.points_b, p_points_a, p_points_b, v_reason, auth.uid());
  update tournament_matches
     set points_a = p_points_a, points_b = p_points_b, revision = revision + 1,
         scored_at = now(), scored_by = auth.uid()
   where id = v_m.id
  returning * into v_m;
  update tournaments set revision = revision + 1, updated_at = now() where id = v_t.id
  returning * into v_t;
  perform app.write_audit('tournament.score', 'tournament_matches', v_m.id::text, null,
                          jsonb_build_object('tournament_id', v_t.id, 'round_no', v_m.round_no,
                                             'points_a', p_points_a, 'points_b', p_points_b,
                                             'correction', v_correct, 'removed_from_round', v_removed),
                          case when v_reason is not null then left(v_reason, 300) end);

  -- The finish: every match of rounds 1..rounds_planned is scored, and (for a
  -- Mexicano) every planned round exists. Corrections stay allowed after it.
  if v_t.status = 'running' and v_t.rounds_planned is not null
     and (select count(*) from tournament_rounds r
           where r.tournament_id = v_t.id and r.round_no between 1 and v_t.rounds_planned) = v_t.rounds_planned
     and not exists (select 1 from tournament_matches x
                      where x.tournament_id = v_t.id and x.round_no <= v_t.rounds_planned and x.points_a is null) then
    update tournaments set status = 'finished', finished_at = now(), updated_at = now() where id = v_t.id
    returning * into v_t;
    perform app.tournament_release_blocks(v_t.id, 'Tournament finished');
    perform app.write_audit('tournament.finish', 'tournaments', v_t.id::text,
                            jsonb_build_object('status', 'running'),
                            jsonb_build_object('status', 'finished', 'by', 'score'));
  end if;
  v_status := v_t.status;

  return jsonb_build_object('match_id', v_m.id, 'revision', v_m.revision, 'tournament_revision', v_t.revision,
                            'removed_from_round', v_removed, 'status', v_status);
end $tournament_score_0311$;

comment on function app.tournament_score(uuid, smallint, smallint, int, text) is
  'Tournaments (M7, T-5, TD-9, TD-11, §1.6; 0311 c35, c36, c37). The court desk, managers and the owner enter a match''s score or correct it. FORBIDDEN; TOURNAMENT_NOT_FOUND (unknown match or outside the visible branches, or 0311: the match deleted before its lock); VENUE_MISMATCH; INVALID_ARGUMENT detail p_expected_revision (0311: null); TOURNAMENT_SCORE_REFUSED detail status (not running or finished); on a finished tournament (0311) FORBIDDEN detail finished below manager, TOURNAMENT_SCORE_REFUSED detail closed 48 hours after finished_at, REASON_REQUIRED for every write; TOURNAMENT_SCORE_REFUSED detail invalid (both >= 0 and adding up to points_target; a forfeit is 0 against the target), changed (p_expected_revision is not the match''s revision), locked (a Mexicano correction with a scored later round); REASON_REQUIRED (a correction). A Mexicano correction on a running tournament deletes the unscored later rounds (removed_from_round = the round after); on a finished one it deletes nothing. Writes the match (revision + 1), a tournament_score_events row every time, the tournament''s revision + 1, audit tournament.score; the score that completes every planned round finishes the tournament (finished_at, its future blocks released, audit tournament.finish). Returns {match_id, revision (the match''s), tournament_revision, removed_from_round, status}.';

revoke all on function app.tournament_score(uuid, smallint, smallint, int, text) from public, anon;
grant execute on function app.tournament_score(uuid, smallint, smallint, int, text) to authenticated;

-- ===========================================================================
-- 3. tournament_mark_no_show (c32, c33, c34, c38), re-issued from 0301:382
-- ===========================================================================
-- A registered entry who did not come. With a substitute (a waitlisted entry,
-- or a guest the desk adds on the add path's rules) the substitute takes the
-- place in every unplayed match and sit-out: nothing is regenerated. Without
-- one, the rounds from the entry's first unplayed round on are deleted and the
-- desk regenerates. Lock order: tournaments FOR UPDATE -> entries -> rounds
-- and matches.
create or replace function app.tournament_mark_no_show(
  p_entry_id            uuid,
  p_substitute_entry_id uuid,
  p_substitute_guest_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $tournament_mark_no_show_0311$
declare
  v_venue   uuid;
  v_tid     uuid;
  v_t       tournaments%rowtype;
  v_e       tournament_entries%rowtype;
  v_s       tournament_entries%rowtype;
  v_g       profiles%rowtype;
  v_sub     uuid;
  v_r0      int;
  v_removed int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select e.venue_id, e.tournament_id into v_venue, v_tid from tournament_entries e where e.id = p_entry_id;
  if v_venue is null or not (v_venue = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_venue, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  if p_substitute_entry_id is not null and p_substitute_guest_id is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'substitute';
  end if;

  select * into v_t from tournaments where id = v_tid for update;
  select * into v_e from tournament_entries where id = p_entry_id for update;
  if v_t.status not in ('closed', 'running') then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  if v_e.status <> 'registered' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'entry_status';
  end if;

  -- The substitute, checked before anything is written.
  if p_substitute_entry_id is not null then
    select * into v_s from tournament_entries
     where id = p_substitute_entry_id and tournament_id = v_t.id and status = 'waitlisted'
       for update;
    if not found then
      raise exception 'TOURNAMENT_ENTRY_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- 0311 (c38): the guest path's checks, which a waitlisted entry may have
    -- outlived (an account deleted, a ban set after joining).
    if exists (select 1 from profiles p where p.id = v_s.guest_id and p.deleted_at is not null) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_substitute_entry_id';
    end if;
    if exists (select 1 from customer_flags f where f.customer_id = v_s.guest_id and f.type = 'match_ban') then
      raise exception 'MATCH_BANNED' using errcode = 'P0001';
    end if;
  elsif p_substitute_guest_id is not null then
    -- tournament_add_entry's rules: a profile, no match ban, the category.
    select * into v_g from profiles where id = p_substitute_guest_id;
    if not found or v_g.deleted_at is not null then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_substitute_guest_id';
    end if;
    if exists (select 1 from customer_flags f where f.customer_id = v_g.id and f.type = 'match_ban') then
      raise exception 'MATCH_BANNED' using errcode = 'P0001';
    end if;
    if v_t.category in ('women', 'men') and v_g.gender is null then
      raise exception 'GENDER_REQUIRED' using errcode = 'P0001';
    end if;
    if (v_t.category = 'women' and v_g.gender <> 'female') or (v_t.category = 'men' and v_g.gender <> 'male') then
      raise exception 'TOURNAMENT_CATEGORY_MISMATCH' using errcode = 'P0001';
    end if;
    select * into v_s from tournament_entries
     where tournament_id = v_t.id and guest_id = v_g.id
       for update;
    if v_s.id is not null and v_s.status not in ('waitlisted', 'withdrawn') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'substitute';
    end if;
    if v_s.id is null then
      insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, added_by_staff_id)
      values (v_t.venue_id, v_t.id, v_g.id, 'waitlisted', 'staff', auth.uid())
      returning * into v_s;
    end if;
  end if;

  update tournament_entries
     set status = 'no_show', no_show_at = now(), updated_at = now()
   where id = v_e.id;

  if v_s.id is not null then
    v_sub := v_s.id;
    update tournament_entries
       set status = 'registered', substitute_for = v_e.id, withdrawn_reason = null, withdrawn_at = null,
           promoted_at = case when v_s.status = 'waitlisted' then now() else promoted_at end,
           seed_no = (select coalesce(max(x.seed_no), 0) + 1 from tournament_entries x where x.tournament_id = v_t.id),
           updated_at = now()
     where id = v_sub;
    update tournament_matches
       set a1 = case when a1 = v_e.id then v_sub else a1 end,
           a2 = case when a2 = v_e.id then v_sub else a2 end,
           b1 = case when b1 = v_e.id then v_sub else b1 end,
           b2 = case when b2 = v_e.id then v_sub else b2 end,
           -- 0311 (c34): a screen showing the old four is stale.
           revision = revision + 1
     where tournament_id = v_t.id and points_a is null and v_e.id in (a1, a2, b1, b2);
    -- 0311 (c32): every round still being played, so the substitute is in
    -- each round the entry was, and a round in play credits its sit-out.
    update tournament_rounds r
       set bye_entry_ids = array_replace(r.bye_entry_ids, v_e.id, v_sub)
     where r.tournament_id = v_t.id and v_e.id = any (r.bye_entry_ids)
       and exists (select 1 from tournament_matches m where m.round_id = r.id and m.points_a is null);
  else
    -- 0311 (c33): the entry's first own unscored match, or its sit-out in a
    -- round not begun; another court still playing does not count.
    select min(r.round_no) into v_r0
      from tournament_rounds r
     where r.tournament_id = v_t.id
       and (exists (select 1 from tournament_matches m
                     where m.round_id = r.id and m.points_a is null and v_e.id in (m.a1, m.a2, m.b1, m.b2))
            or (v_e.id = any (r.bye_entry_ids)
                and not exists (select 1 from tournament_matches m where m.round_id = r.id and m.points_a is not null)));
    if v_r0 is not null then
      if exists (select 1 from tournament_matches m
                  where m.tournament_id = v_t.id and m.round_no >= v_r0 and m.points_a is not null) then
        raise exception 'TOURNAMENT_ROUNDS_INVALID' using errcode = 'P0001', detail = 'played',
          hint = 'that round has begun: name a substitute, or score the match as a forfeit';
      end if;
      delete from tournament_rounds r where r.tournament_id = v_t.id and r.round_no >= v_r0;
      v_removed := v_r0;
    end if;
  end if;

  update tournaments set revision = revision + 1, updated_at = now() where id = v_t.id
  returning * into v_t;
  perform app.write_audit('tournament.no_show', 'tournament_entries', v_e.id::text,
                          jsonb_build_object('status', 'registered'),
                          jsonb_build_object('status', 'no_show', 'tournament_id', v_t.id,
                                             'substitute_entry_id', v_sub, 'removed_from_round', v_removed));
  return jsonb_build_object('entry_id', v_e.id, 'status', 'no_show', 'substitute_entry_id', v_sub,
                            'removed_from_round', v_removed, 'revision', v_t.revision);
end $tournament_mark_no_show_0311$;

comment on function app.tournament_mark_no_show(uuid, uuid, uuid) is
  'Tournaments (M7, T-7, §1.6; 0311 c32, c33, c34, c38). The court desk, managers and the owner mark a registered entry no_show in a closed or running tournament, with at most one substitute. FORBIDDEN; TOURNAMENT_ENTRY_NOT_FOUND (the entry, or a substitute entry that is not waitlisted in this tournament); VENUE_MISMATCH; INVALID_ARGUMENT detail substitute (both given, or a substitute guest already registered or a no-show), entry_status (not registered), p_substitute_guest_id (unknown profile); TOURNAMENT_NOT_OPEN detail status; a substitute guest runs add_entry''s MATCH_BANNED, GENDER_REQUIRED, TOURNAMENT_CATEGORY_MISMATCH. With a substitute: it becomes registered (substitute_for, the next seed_no) and takes the entry''s place in every unscored match (each one''s revision + 1, 0311) and in the sit-outs of every round with an unscored match (0311); a substitute entry whose account is deleted is INVALID_ARGUMENT detail p_substitute_entry_id, a banned one MATCH_BANNED (0311). Without: the first round to go is the entry''s first own unscored match or its sit-out in a round not begun (0311); TOURNAMENT_ROUNDS_INVALID detail played when a round from it on has a score, else those rounds are deleted (removed_from_round). revision + 1; audit tournament.no_show. Returns {entry_id, status, substitute_entry_id, removed_from_round, revision}.';

revoke all on function app.tournament_mark_no_show(uuid, uuid, uuid) from public, anon;
grant execute on function app.tournament_mark_no_show(uuid, uuid, uuid) to authenticated;

-- ===========================================================================
-- 4. app.tournament_standings (c27), re-issued from 0301:528
-- ===========================================================================
-- Rows: the registered entries, and any other entry with a scored match.
-- points_won: own team's points in scored matches, plus floor(target / 2) for
-- each sit-out in a complete round (at least one match, every match scored);
-- sat_out counts those. diff: match points won - points against (a sit-out
-- adds 0). h2h: once per scored match, own - other points, in the matches the
-- entry played against at least one entry of its (points_won, diff) tie
-- group. rank (0311, c27): a registered row is 1 + the registered rows
-- strictly better on (points_won, diff, h2h); any other row ranks after every
-- registered one, among its kind the same way. Order: registered first, then
-- points_won, diff, h2h (desc), then seed_no and the entry id.
create or replace function app.tournament_standings(p_tournament_id uuid)
returns table (
  entry_id       uuid,
  rank           int,
  points_won     int,
  points_against int,
  diff           int,
  h2h            int,
  played         int,
  sat_out        int,
  withdrawn      boolean
)
language sql stable security definer set search_path = public as $tournament_standings_0311$
  with t as (
    select x.id, x.points_target / 2 as credit from tournaments x where x.id = p_tournament_id
  ),
  sides as (
    select m.id as match_id, s.entry_id, s.team,
           case when s.team = 'a' then m.points_a else m.points_b end::int as own,
           case when s.team = 'a' then m.points_b else m.points_a end::int as opp
      from tournament_matches m
     cross join lateral (values (m.a1, 'a'), (m.a2, 'a'), (m.b1, 'b'), (m.b2, 'b')) s(entry_id, team)
     where m.tournament_id = p_tournament_id and m.points_a is not null
  ),
  byes as (
    select b.entry_id, count(*)::int as n
      from tournament_rounds r
     cross join lateral unnest(r.bye_entry_ids) b(entry_id)
     where r.tournament_id = p_tournament_id
       and exists (select 1 from tournament_matches m where m.round_id = r.id)
       and not exists (select 1 from tournament_matches m where m.round_id = r.id and m.points_a is null)
     group by b.entry_id
  ),
  tally as (
    select e.id as entry_id, e.status, e.seed_no,
           coalesce(sum(s.own), 0)::int as match_won,
           coalesce(sum(s.opp), 0)::int as against,
           count(s.match_id)::int as played,
           coalesce(max(b.n), 0)::int as sat
      from tournament_entries e
      left join sides s on s.entry_id = e.id
      left join byes b on b.entry_id = e.id
     where e.tournament_id = p_tournament_id
     group by e.id, e.status, e.seed_no
  ),
  pop as (
    select y.entry_id, y.status, y.seed_no, y.played, y.sat, y.against,
           y.match_won + y.sat * (select t.credit from t) as points_won,
           y.match_won - y.against as diff
      from tally y
     where y.status = 'registered' or y.played > 0
  ),
  ranked as (
    select p.*,
           coalesce((select sum(s.own - s.opp)
                       from sides s
                      where s.entry_id = p.entry_id
                        and exists (select 1
                                      from sides o
                                      join pop q on q.entry_id = o.entry_id
                                     where o.match_id = s.match_id and o.team <> s.team
                                       and q.points_won = p.points_won and q.diff = p.diff)), 0)::int as h2h
      from pop p
  )
  select r.entry_id,
         (1 + case when r.status = 'registered' then 0
                   else (select count(*) from ranked o where o.status = 'registered') end
            + (select count(*) from ranked o
                where (o.status = 'registered') = (r.status = 'registered')
                  and (o.points_won, o.diff, o.h2h) > (r.points_won, r.diff, r.h2h)))::int as rank,
         r.points_won, r.against, r.diff, r.h2h, r.played, r.sat, r.status <> 'registered'
    from ranked r
   order by r.status <> 'registered', r.points_won desc, r.diff desc, r.h2h desc, r.seed_no asc nulls last, r.entry_id
$tournament_standings_0311$;

comment on function app.tournament_standings(uuid) is
  'Tournaments (M7, TD-8, TD-10, §1.5; 0311 c27). Internal: the standings of one tournament, computed on every read: one row per registered entry and per other entry with a scored match: entry_id, rank (a registered row: 1 + the registered rows strictly better on points_won, diff, h2h; ties share it; any other row after every registered one, ranked among its kind the same way), points_won (own team''s points + floor(points_target / 2) per sit-out in a complete round), points_against, diff, h2h (once per scored match against an entry of the same points_won and diff), played, sat_out (credited sit-outs), withdrawn (status not registered). Ordered registered first, then points_won, diff, h2h descending, then seed_no, then entry id. packages/core/src/tournaments/standings.ts rankStandings is its twin (tests/tournament-rounds.test.ts).';

revoke all on function app.tournament_standings(uuid) from public, anon, authenticated;
-- The parity suite reads it as the service role; clients read the detail reads.
grant execute on function app.tournament_standings(uuid) to service_role;

-- ===========================================================================
-- 5. tournament_public (c27), re-issued from 0301:764
-- ===========================================================================
revoke all on function app.desk_tournament_detail(uuid) from public, anon;
grant execute on function app.desk_tournament_detail(uuid) to authenticated;

-- tournament_public (T-8, review M8): the website's noindex page and the
-- phone's detail. Anon and authenticated; never raises; publicByDesign. A
-- player is {name ("First I."), former, no}; names only once a schedule
-- exists and never for the waitlist; a desk-added profile with no accepted
-- terms is name null ("Player <no>"). Courts are ordinals, never ids.
create or replace function app.tournament_public(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_public_0311$
declare
  v_uid       uuid := auth.uid();
  v_t         tournaments%rowtype;
  v_branch    jsonb;
  v_reg       int;
  v_wait      int;
  v_who       jsonb;
  v_courtno   jsonb;
  v_rounds    jsonb := '[]'::jsonb;
  v_standings jsonb := '[]'::jsonb;
  v_me        jsonb;
begin
  if p_id is null then
    return jsonb_build_object('missing', true);
  end if;
  select * into v_t from tournaments where id = p_id;
  if not found or not app.tournament_on(v_t.venue_id)
     or (v_t.status = 'cancelled' and v_t.cancelled_at < now() - interval '7 days') then
    return jsonb_build_object('missing', true);
  end if;

  select jsonb_build_object('venue_id', v.id, 'name_en', v.name_en, 'name_ar', v.name_ar,
                            'timezone', coalesce(vs.timezone, v.timezone))
    into v_branch
    from venues v left join venue_settings vs on vs.venue_id = v.id
   where v.id = v_t.venue_id;
  select count(*) filter (where e.status = 'registered')::int, count(*) filter (where e.status = 'waitlisted')::int
    into v_reg, v_wait
    from tournament_entries e
   where e.tournament_id = v_t.id;

  if exists (select 1 from tournament_rounds r where r.tournament_id = v_t.id) then
    -- Every entry that can appear in the schedule or the standings.
    select coalesce(jsonb_object_agg(e.id::text, jsonb_build_object(
             'name', case when e.added_by_kind = 'staff' and p.terms_version is null then null
                          else d.v->>'name' end,
             'former', coalesce((d.v->>'former')::boolean, false),
             'no', e.seed_no)), '{}'::jsonb)
      into v_who
      from tournament_entries e
      left join profiles p on p.id = e.guest_id
      cross join lateral (select app.match_display_name(e.guest_id) as v) d
     where e.tournament_id = v_t.id and e.status <> 'waitlisted';

    select coalesce(jsonb_object_agg(c.id::text, c.n), '{}'::jsonb)
      into v_courtno
      from (select c.id, row_number() over (order by c.sort_order, c.id) as n
              from courts c
             where c.id in (select m.court_id from tournament_matches m where m.tournament_id = v_t.id)) c;

    select coalesce(jsonb_agg(jsonb_build_object(
             'round_no', r.round_no,
             'sit_out', coalesce((select jsonb_agg(v_who->(b.id::text) order by b.ord)
                                    from unnest(r.bye_entry_ids) with ordinality b(id, ord)), '[]'::jsonb),
             'matches', coalesce((select jsonb_agg(jsonb_build_object(
                                           'court_no', (v_courtno->>(m.court_id::text))::int,
                                           'a', jsonb_build_array(v_who->(m.a1::text), v_who->(m.a2::text)),
                                           'b', jsonb_build_array(v_who->(m.b1::text), v_who->(m.b2::text)),
                                           'points_a', m.points_a,
                                           'points_b', m.points_b)
                                           order by (v_courtno->>(m.court_id::text))::int)
                                    from tournament_matches m
                                   where m.round_id = r.id), '[]'::jsonb))
             order by r.round_no), '[]'::jsonb)
      into v_rounds
      from tournament_rounds r
     where r.tournament_id = v_t.id;

    -- The function's own order, as the desk reads it.
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', s.rank,
             'player', v_who->(s.entry_id::text),
             'points_won', s.points_won,
             'diff', s.diff,
             'played', s.played,
             'withdrawn', s.withdrawn)
             order by s.rank, se.seed_no nulls last, s.entry_id), '[]'::jsonb)
      into v_standings
      from app.tournament_standings(v_t.id) s
      left join tournament_entries se on se.id = s.entry_id;
  end if;

  if v_uid is not null then
    select jsonb_build_object(
             'entry_id', e.id,
             'status', e.status,
             'waitlist_position',
               case when e.status = 'waitlisted' then
                 (select count(*)::int + 1 from tournament_entries w
                   where w.tournament_id = e.tournament_id and w.status = 'waitlisted'
                     and (w.entered_at, w.id) < (e.entered_at, e.id)) end,
             'owed_iqd', (app.tournament_entry_money(e.id)->>'owed_iqd')::bigint)
      into v_me
      from tournament_entries e
     where e.tournament_id = v_t.id and e.guest_id = v_uid;
  end if;

  return jsonb_build_object(
    'missing', false,
    'id', v_t.id,
    'venue_id', v_t.venue_id,
    'branch', v_branch,
    'name_en', v_t.name_en,
    'name_ar', v_t.name_ar,
    'format', v_t.format,
    'category', v_t.category,
    'points_target', v_t.points_target,
    'rounds_planned', v_t.rounds_planned,
    'starts_at', v_t.starts_at,
    'ends_at', v_t.ends_at,
    'registration_closes_at', v_t.registration_closes_at,
    'entry_fee_iqd', v_t.entry_fee_iqd,
    'prize_en', v_t.prize_en,
    'prize_ar', v_t.prize_ar,
    'status', v_t.status,
    'max_entries', v_t.max_entries,
    'entries_count', v_reg,
    'places_left', greatest(v_t.max_entries - v_reg, 0),
    'waitlist_open', v_t.status = 'open' and now() < v_t.registration_closes_at
                     and v_reg >= v_t.max_entries and v_wait < v_t.waitlist_max,
    'server_now', now(),
    'rounds', v_rounds,
    'standings', v_standings,
    'me', v_me);
end $tournament_public_0311$;

comment on function app.tournament_public(uuid) is
  'Tournaments (M7, T-8, §1.8, review M8; 0311 c27). Public by design (anon and authenticated; never raises): {missing: true} for an unknown id, a branch closed or switched off, or a tournament cancelled more than 7 days ago; otherwise {missing: false, id, venue_id, branch {venue_id, name_en, name_ar, timezone}, name_en, name_ar, format, category, points_target, rounds_planned, starts_at, ends_at, registration_closes_at, entry_fee_iqd, prize_en, prize_ar, status, max_entries, entries_count (registered), places_left, waitlist_open, server_now, rounds [{round_no, sit_out [player], matches [{court_no, a [player, player], b [player, player], points_a, points_b}]}], standings [{rank, player, points_won, diff, played, withdrawn (0311: left the play; ranked after every registered entry)}], me {entry_id, status, waitlist_position, owed_iqd} (the caller''s own entry, with a session) | null}. A player is {name ("First I." via app.match_display_name, null for a desk-added profile with no accepted terms), former (a deleted account), no (seed_no)}; rounds and standings are empty until a schedule exists, and the waitlist is never named. court_no is an ordinal; no court id, guest id, phone or full name.';
