set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0373 tournament_seat_pick — the chair a guest taps is the chair they get
-- (Majed, 2026-10-29: "when a user clicks on a + icon at court no 6 for
-- example it should add them there instead of adding them into the first open
-- slot"). Before this the board placed every registered entry by registration
-- order, so a tap on any open chair took the first open one.
--
--   1. tournament_entries.seat_no: the board chair (1… max_entries; chair k of
--      court c is (c - 1) * 4 + k) a registered entry sits on, or null. Backfilled
--      with the order the board drew, so no one already registered moves.
--   2. app.tournament_seats(tournament): every registered entry's chair. An
--      entry with a seat_no keeps it (the first by registration order when two
--      claim one); an entry with none (a desk add, a waitlist promotion, a
--      substitute) takes the lowest chairs left, in registration order. Internal.
--   3. tournament_register (latest 0359) takes p_seat_no int default null, so a
--      phone build before this one still registers with its one argument. A
--      registration stamps its chair: the one asked for (INVALID_ARGUMENT detail
--      p_seat_no outside 1… max_entries, TOURNAMENT_SEAT_TAKEN when someone sits
--      there), else the lowest one free. A waitlisted entry has none.
--   4. tournament_public (latest 0359): each of entries carries seat (its chair).
--
-- The draw is untouched: round 1's courts are the engine's, as before, and the
-- board shows them once play is drawn.

-- ===========================================================================
-- 1. The column
-- ===========================================================================
alter table tournament_entries add column if not exists seat_no smallint;

do $tournament_entries_seat_0373$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tournament_entries_seat'
                    and conrelid = 'public.tournament_entries'::regclass) then
    alter table tournament_entries add constraint tournament_entries_seat
      check (seat_no is null or seat_no between 1 and 512) not valid;
  end if;
end $tournament_entries_seat_0373$;

do $tournament_entries_seat_validate_0373$
begin
  if exists (select 1 from pg_constraint
              where conname = 'tournament_entries_seat'
                and conrelid = 'public.tournament_entries'::regclass
                and not convalidated) then
    alter table tournament_entries validate constraint tournament_entries_seat;
  end if;
end $tournament_entries_seat_validate_0373$;

comment on column tournament_entries.seat_no is
  '0373. The seating board chair a registered entry sits on (1… max_entries; chair k of court c is (c - 1) * 4 + k), stamped by tournament_register: the chair the guest tapped, else the lowest free. Null for an entry the desk added or the waitlist promoted, which app.tournament_seats places on the lowest chairs left. Kept on a withdrawn row and ignored there. The board only: the draw does not read it.';

-- The registered entries of open tournaments sit where the board drew them
-- before this migration: by registration order (0334's entries order).
update tournament_entries e
   set seat_no = s.n
  from (select x.id, row_number() over (partition by x.tournament_id
                                         order by coalesce(x.promoted_at, x.entered_at), x.id) as n
          from tournament_entries x
         where x.status = 'registered') s
 where e.id = s.id
   and e.status = 'registered'
   and e.seat_no is null
   and s.n <= 512;

-- ===========================================================================
-- 2. Every registered entry's chair
-- ===========================================================================
create or replace function app.tournament_seats(p_tournament_id uuid)
returns table (entry_id uuid, seat_no int)
language sql stable security definer set search_path = public as $tournament_seats_0373$
  with reg as (
    select e.id, e.seat_no::int as seat_no,
           row_number() over (order by coalesce(e.promoted_at, e.entered_at), e.id) as ord
      from tournament_entries e
     where e.tournament_id = p_tournament_id and e.status = 'registered'),
  cap as (
    select greatest(coalesce((select t.max_entries from tournaments t where t.id = p_tournament_id), 0),
                    (select count(*) from reg))::int as n),
  claimed as (
    select r.id, r.seat_no, row_number() over (partition by r.seat_no order by r.ord) as k
      from reg r cross join cap
     where r.seat_no between 1 and cap.n),
  fixed as (
    select c.id, c.seat_no from claimed c where c.k = 1),
  rest as (
    select r.id, row_number() over (order by r.ord) as k
      from reg r
     where not exists (select 1 from fixed f where f.id = r.id)),
  free as (
    select s::int as seat_no, row_number() over (order by s) as k
      from cap cross join generate_series(1, cap.n) s
     where not exists (select 1 from fixed f where f.seat_no = s))
  select f.id, f.seat_no from fixed f
  union all
  select r.id, fr.seat_no from rest r join free fr on fr.k = r.k
$tournament_seats_0373$;

comment on function app.tournament_seats(uuid) is
  'Tournaments (0373). Internal: one row per registered entry, {entry_id, seat_no}, its seating board chair. An entry with a seat_no in 1… greatest(max_entries, registered) keeps it (the first by registration order, promoted_at else entered_at then id, when two claim one); every other entry takes the lowest chairs left in that order. Read by tournament_register (is the chair free) and tournament_public (entries[].seat).';

revoke all on function app.tournament_seats(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Register in a chair (0359)
-- ===========================================================================
drop function if exists app.tournament_register(uuid);

create or replace function app.tournament_register(p_tournament_id uuid, p_seat_no int default null)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_register_0373$
declare
  v_p      profiles;
  v_t      tournaments%rowtype;
  v_e      tournament_entries%rowtype;
  v_reg    int;
  v_wait   int;
  v_status text;
  v_pos    int;
  v_seat   int;
begin
  -- AUTH, ACCOUNT, PHONE, TERMS, MATCH_BANNED, GENDER_REQUIRED (0260).
  v_p := app.match_guest(true);

  -- 0310 (s0): the branch is checked before the row is locked.
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not exists (select 1 from venues v where v.id = v_t.venue_id and v.is_active) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.tournament_on(v_t.venue_id) then
    raise exception 'TOURNAMENTS_OFF' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  select * into v_t from tournaments where id = v_t.id for update;

  select * into v_e from tournament_entries
   where tournament_id = v_t.id and guest_id = v_p.id
     for update;
  if v_e.id is not null and v_e.status in ('registered', 'waitlisted') then
    v_pos := case when v_e.status = 'waitlisted' then
               (select count(*)::int + 1 from tournament_entries w
                 where w.tournament_id = v_t.id and w.status = 'waitlisted'
                   and (w.entered_at, w.id) < (v_e.entered_at, v_e.id)) end;
    return jsonb_build_object('entry_id', v_e.id, 'status', v_e.status, 'waitlist_position', v_pos,
                              'seat_no', case when v_e.status = 'registered' then
                                           (select s.seat_no from app.tournament_seats(v_t.id) s
                                             where s.entry_id = v_e.id) end,
                              'duplicate', true);
  end if;
  if v_t.status <> 'open' or v_e.status is not distinct from 'no_show' then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  if now() >= v_t.registration_closes_at then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'cutoff';
  end if;
  if (v_t.category = 'women' and v_p.gender is distinct from 'female')
     or (v_t.category = 'men' and v_p.gender is distinct from 'male') then
    raise exception 'TOURNAMENT_CATEGORY_MISMATCH' using errcode = 'P0001';
  end if;
  -- 0339: who it is for. The level fits one of its classes (0359; advanced A,
  -- intermediate B, beginner or new C); when the tournament names a years bracket, the guest's
  -- years are that bracket (never counts as under_one). An unanswered question
  -- is PROFILE_REQUIRED, so the phone opens the survey; the desk adds anyone.
  if v_p.play_level is null then
    raise exception 'TOURNAMENT_PROFILE_REQUIRED' using errcode = 'P0001', detail = 'level';
  end if;
  if not ((case v_p.play_level when 'advanced' then 'A'
                                when 'intermediate' then 'B' else 'C' end) = any(v_t.classes)) then
    raise exception 'TOURNAMENT_LEVEL_MISMATCH' using errcode = 'P0001', detail = 'level';
  end if;
  if v_t.play_years is not null then
    if v_p.play_years is null then
      raise exception 'TOURNAMENT_PROFILE_REQUIRED' using errcode = 'P0001', detail = 'years';
    end if;
    if v_t.play_years is distinct from (case v_p.play_years when 'never' then 'under_one'
                                                             else v_p.play_years end) then
      raise exception 'TOURNAMENT_LEVEL_MISMATCH' using errcode = 'P0001', detail = 'years';
    end if;
  end if;

  select count(*) filter (where e.status = 'registered'), count(*) filter (where e.status = 'waitlisted')
    into v_reg, v_wait
    from tournament_entries e
   where e.tournament_id = v_t.id;
  if v_reg < v_t.max_entries then
    v_status := 'registered';
  elsif v_wait < v_t.waitlist_max then
    v_status := 'waitlisted';
  else
    raise exception 'TOURNAMENT_FULL' using errcode = 'P0001';
  end if;

  -- 0373: the chair. The tournament row is locked, so no other registration
  -- reads the chairs until this one commits. A waitlisted entry takes none.
  if v_status = 'registered' then
    if p_seat_no is not null then
      if p_seat_no < 1 or p_seat_no > v_t.max_entries then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_no';
      end if;
      if exists (select 1 from app.tournament_seats(v_t.id) s where s.seat_no = p_seat_no) then
        raise exception 'TOURNAMENT_SEAT_TAKEN' using errcode = 'P0001';
      end if;
      v_seat := p_seat_no;
    else
      select min(g) into v_seat
        from generate_series(1, v_t.max_entries) g
       where not exists (select 1 from app.tournament_seats(v_t.id) s where s.seat_no = g);
    end if;
  end if;

  if v_e.id is not null then
    -- A withdrawn guest comes back: the same row, a fresh place in the queue.
    update tournament_entries
       set status = v_status, entered_at = now(), added_by_kind = 'guest', added_by_staff_id = null,
           withdrawn_reason = null, withdrawn_at = null, promoted_at = null, seat_no = v_seat,
           updated_at = now()
     where id = v_e.id
    returning * into v_e;
  else
    insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, seat_no)
    values (v_t.venue_id, v_t.id, v_p.id, v_status, 'guest', v_seat)
    returning * into v_e;
  end if;

  v_pos := case when v_status = 'waitlisted' then v_wait + 1 end;
  perform app.write_audit('tournament.register', 'tournament_entries', v_e.id::text, null,
                          jsonb_build_object('tournament_id', v_t.id, 'status', v_status,
                                             'seat_no', v_seat));
  return jsonb_build_object('entry_id', v_e.id, 'status', v_status, 'waitlist_position', v_pos,
                            'seat_no', v_seat, 'duplicate', false);
end $tournament_register_0373$;

comment on function app.tournament_register(uuid, int) is
  'Tournaments (M7, T-4, §1.6; 0373 seat). Guest: app.match_guest(true) first (AUTH_REQUIRED, ACCOUNT_REQUIRED, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, GENDER_REQUIRED); then TOURNAMENT_NOT_FOUND (unknown, or its branch not open to guests), TOURNAMENTS_OFF, a live entry answers duplicate true (its chair unchanged), TOURNAMENT_NOT_OPEN detail status (not open, or a no-show row) or cutoff (past registration_closes_at), TOURNAMENT_CATEGORY_MISMATCH; 0339: TOURNAMENT_PROFILE_REQUIRED (detail level | years: that play survey question is unanswered), TOURNAMENT_LEVEL_MISMATCH (detail level | years: the level fits none of the classes (0359), or the years are not the tournament''s bracket) (women / men against profiles.gender). registered while fewer than max_entries are, else waitlisted while fewer than waitlist_max are, else TOURNAMENT_FULL; a withdrawn row is re-used with a fresh entered_at. 0373: p_seat_no (default null, so a one-argument call still works) is the seating board chair asked for: a registration sits there (INVALID_ARGUMENT detail p_seat_no outside 1… max_entries; TOURNAMENT_SEAT_TAKEN when app.tournament_seats has someone on it), or with null on the lowest free chair; a waitlisted entry takes none and p_seat_no is ignored. Audit tournament.register. Returns {entry_id, status, waitlist_position, seat_no (null when waitlisted), duplicate}.';

revoke all on function app.tournament_register(uuid, int) from public, anon;
grant execute on function app.tournament_register(uuid, int) to authenticated;

-- ===========================================================================
-- 4. The read (0359): each entry's chair
-- ===========================================================================
create or replace function app.tournament_public(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_public_0373$
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
  v_entries   jsonb := '[]'::jsonb;
begin
  if p_id is null then
    return jsonb_build_object('missing', true, 'entries', '[]'::jsonb);
  end if;
  select * into v_t from tournaments where id = p_id;
  if not found or not app.tournament_on(v_t.venue_id)
     or (v_t.status = 'cancelled' and v_t.cancelled_at < now() - interval '7 days') then
    return jsonb_build_object('missing', true, 'entries', '[]'::jsonb);
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

  -- 0334: the registered entries in registration order (when each became
  -- registered: a promoted waitlist entry at its promotion), before and after
  -- the schedule exists, for the seating board. The player is the public
  -- shape the rounds use; mine is the caller's own entry (false for anon).
  -- 0373: seat is the entry's board chair (app.tournament_seats).
  select coalesce(jsonb_agg(jsonb_build_object(
           'player', jsonb_build_object(
             'name', case when e.added_by_kind = 'staff' and p.terms_version is null then null
                          else d.v->>'name' end,
             'former', coalesce((d.v->>'former')::boolean, false),
             'no', e.seed_no),
           'mine', coalesce(e.guest_id = v_uid, false),
           'seat', st.seat_no)
           order by coalesce(e.promoted_at, e.entered_at), e.id), '[]'::jsonb)
    into v_entries
    from tournament_entries e
    left join profiles p on p.id = e.guest_id
    left join app.tournament_seats(v_t.id) st on st.entry_id = e.id
    cross join lateral (select app.match_display_name(e.guest_id) as v) d
   where e.tournament_id = v_t.id
     and e.status = 'registered';

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
    'class', v_t.class,
    'classes', to_jsonb(v_t.classes),
    'play_years', v_t.play_years,
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
    'entries', v_entries,
    'me', v_me);
end $tournament_public_0373$;

comment on function app.tournament_public(uuid) is
  'Tournaments (M7, T-8, §1.8, review M8; 0311 c27; 0334 entries; 0339 class, play_years; 0359 classes; 0373 seat). Public by design (anon and authenticated; never raises): {missing: true, entries: []} for an unknown id, a branch closed or switched off, or a tournament cancelled more than 7 days ago; otherwise {missing: false, id, venue_id, branch {venue_id, name_en, name_ar, timezone}, name_en, name_ar, format, category, class (the first of classes), classes (0359), play_years, points_target, rounds_planned, starts_at, ends_at, registration_closes_at, entry_fee_iqd, prize_en, prize_ar, status, max_entries, entries_count (registered), places_left, waitlist_open, server_now, rounds [{round_no, sit_out [player], matches [{court_no, a [player, player], b [player, player], points_a, points_b}]}], standings [{rank, player, points_won, diff, played, withdrawn (0311: left the play; ranked after every registered entry)}], entries [{player, mine, seat}] (0334: the registered entries in registration order, promoted_at for a promoted waitlist entry else entered_at, then id; present before and after the schedule exists; mine is the caller''s own entry, false for anon; 0373: seat, the entry''s seating board chair, 1… max_entries, chair k of court c being (c - 1) * 4 + k), me {entry_id, status, waitlist_position, owed_iqd} (the caller''s own entry, with a session) | null}. A player is {name ("First I." via app.match_display_name, null for a desk-added profile with no accepted terms), former (a deleted account), no (seed_no)}; rounds and standings are empty until a schedule exists (entries is not: 0334, the seating board names the registered entries before the draw; no is null until seeds are given), and the waitlist is never named. court_no is an ordinal; no court id, guest id, phone or full name.';

revoke all on function app.tournament_public(uuid) from public;
grant execute on function app.tournament_public(uuid) to anon, authenticated;
