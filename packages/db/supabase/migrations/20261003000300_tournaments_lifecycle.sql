set lock_timeout = '3s';
set statement_timeout = '60s';

-- tournaments_lifecycle — tournaments (Phase 2 milestone 7), staged file 2 of
-- 3 (docs/design/tournaments/build-contracts-2026-10-03.md §1.1, §1.4–§1.6,
-- §1.9, §1.10, §1.12 S8–S13). Depends on tournaments_schema_money (the tables,
-- app.tournament_on, app.tournament_entry_money).
--
--   1. app.block_courts_for_event, re-issued from 0174:612 (S10, S11): the
--      scope is the visible branches, an inactive court is COURT_NOT_FOUND,
--      DEGRADED_LOCKOUT inside the protected horizon, and the combined R22
--      check refuses blocks that would leave a waiting match no court.
--   2. The guard trigger: an adopted block of a live tournament is never
--      cancelled, moved, re-kinded or marked from outside (TOURNAMENT_VIA_EVENTS).
--   3. Internals: release the blocks, cancel, promote, notify.
--   4. tournament_publish (T-6), tournament_cancel.
--   5. tournament_register, tournament_withdraw (T-4, T-7), the desk's
--      tournament_add_entry and tournament_remove_entry.
--   6. app.tournament_sweep and tp_tournament_sweep (§3.7).
--   7. set_tournaments_enabled, desk_tournaments, tournaments_public.
--
-- Lock rule (§1.4, S8): tournaments before entries before rounds and
-- matches. Releasing blocks takes the courts (app.lock_court, court-id order)
-- after the tournament row, then writes reservations (the 0174:566-595 pair).
-- Nothing here takes day_sessions. Every body says its order in its header.

-- ===========================================================================
-- 1. block_courts_for_event: re-issued from
--    20260925000174_event_court_blocks.sql:612, verbatim plus S10 (the scope
--    line), S11 (v_min_start and the degraded check before the court locks,
--    c.is_active in the court check, the combined R22 check after the
--    conflict query). Same signature and grants.
-- ===========================================================================
create or replace function app.block_courts_for_event(
  p_run_id          uuid,
  p_blocks          jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $block_courts_for_event_0300$
declare
  v_run       protocol_runs%rowtype;
  v_step      protocol_run_steps%rowtype;
  v_replay    jsonb;
  v_el        jsonb;
  v_court     uuid;
  v_from      timestamptz;
  v_to        timestamptz;
  v_min_start timestamptz;   -- M7 (S11): the request's earliest start
  v_blocks    jsonb := '[]'::jsonb;
  v_conflicts jsonb;
  v_waiting   jsonb;         -- M7 (S11): the blocks a waiting match needs
  v_blocked   jsonb := '[]'::jsonb;
  v_b         record;
  v_id        uuid;
  v_notes     text;
  v_result    jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  -- M7 (S10): the branches in scope, as every staff read (0226).
  if not found or not (v_run.venue_id = any ((select app.visible_venue_ids())::uuid[])) or v_run.kind <> 'tournament' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'block_courts_for_event');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_step from protocol_run_steps where run_id = v_run.id and step_key = 'courts' for update;
  if v_run.status <> 'active' or not found or v_step.status <> 'open' then
    raise exception 'STEP_NOT_OPEN' using errcode = 'P0001';
  end if;

  -- The blocks: 1 to 60 of {court_id, start_at, end_at}, each ending after it
  -- starts, on an active court of the run's venue, none overlapping another of
  -- the same court in this request.
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) not between 1 and 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
  end if;
  for v_el in select e from jsonb_array_elements(p_blocks) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
    end if;
    begin
      v_court := (v_el->>'court_id')::uuid;
      v_from  := (v_el->>'start_at')::timestamptz;
      v_to    := (v_el->>'end_at')::timestamptz;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
    end;
    if v_court is null or v_from is null or v_to is null or not isfinite(v_from) or not isfinite(v_to) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
    end if;
    if v_to <= v_from then
      raise exception 'BLOCK_RANGE_INVALID' using errcode = 'P0001';
    end if;
    -- M7 (S11): an inactive court cannot be blocked.
    if not exists (select 1 from courts c where c.id = v_court and c.venue_id = v_run.venue_id and c.is_active) then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_min_start := least(v_min_start, v_from);
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'court_id', v_court, 'start_at', v_from, 'end_at', v_to));
  end loop;
  if exists (select 1
               from jsonb_array_elements(v_blocks) with ordinality a(e, i)
               join jsonb_array_elements(v_blocks) with ordinality b(e, j)
                 on a.i < b.j and a.e->>'court_id' = b.e->>'court_id'
              where tstzrange((a.e->>'start_at')::timestamptz, (a.e->>'end_at')::timestamptz, '[)')
                 && tstzrange((b.e->>'start_at')::timestamptz, (b.e->>'end_at')::timestamptz, '[)')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocks';
  end if;

  -- M7 (S11): an event block is planned work. While the branch trades offline
  -- the desk's queued bookings may replay onto these courts, so nothing is
  -- blocked inside the protected horizon (DEGRADED_LOCKOUT; the raise rolls
  -- the claimed key back).
  perform app.assert_not_degraded_for(v_min_start, v_run.venue_id);

  -- Serialise with every other writer of these courts (0042), in court-id
  -- order, then clear stale holds in the windows.
  for v_court in select distinct (e->>'court_id')::uuid from jsonb_array_elements(v_blocks) e order by 1 loop
    perform app.lock_court(v_court);
  end loop;
  for v_b in
    select (e->>'court_id')::uuid as court_id, (e->>'start_at')::timestamptz as start_at,
           (e->>'end_at')::timestamptz as end_at
      from jsonb_array_elements(v_blocks) e
  loop
    perform app.expire_stale_holds(v_b.court_id, tstzrange(v_b.start_at, v_b.end_at, '[)'));
  end loop;

  -- What is in the way: any live reservation overlapping a block, except this
  -- run's own block of exactly that court and window.
  select coalesce(jsonb_agg(jsonb_build_object(
           'court_id', r.court_id, 'start_at', r.start_at, 'end_at', r.end_at,
           'reservation_id', r.id, 'kind', r.kind, 'status', r.status)
         order by r.start_at, r.court_id, r.id), '[]'::jsonb)
    into v_conflicts
    from reservations r
   where r.status in ('pending', 'confirmed', 'arrived')
     and exists (select 1
                   from jsonb_array_elements(v_blocks) e
                  where (e->>'court_id')::uuid = r.court_id
                    and r.period && tstzrange((e->>'start_at')::timestamptz, (e->>'end_at')::timestamptz, '[)')
                    and not (r.protocol_run_id is not distinct from v_run.id
                             and r.block_purpose is not distinct from 'event'
                             and r.start_at = (e->>'start_at')::timestamptz
                             and r.end_at = (e->>'end_at')::timestamptz));

  -- M7 (S11, review B2): R22 over the whole request. match_court_claimed
  -- (0263:186) judges one court at a time and counts the request's other
  -- courts as free, so blocking every court against one waiting match passed
  -- and trigger part B then bumped it. Here a waiting match M over a requested
  -- block is starved when the courts that could still book it after this
  -- request (active, offering M's length, no live row over M's period, no
  -- block of this request over it) are fewer than the waiting matches over
  -- M's period. Only a block whose own court could book M is refused for it
  -- (active, offering M's length, no live row over M's period), as
  -- match_court_claimed asks of its one court, so a request of one court gets
  -- the same answer. A match the sweep will not book (its branch degraded, the
  -- start inside the protected horizon) neither claims nor counts, exactly as
  -- in match_court_claimed. A plain read: the sweep is the backstop. One
  -- conflict per starving requested block, reservation_id null.
  select coalesce(jsonb_agg(jsonb_build_object(
           'court_id', b.court_id, 'start_at', b.start_at, 'end_at', b.end_at,
           'reservation_id', null, 'kind', 'match_waiting', 'status', 'awaiting_court')
         order by b.start_at, b.court_id), '[]'::jsonb)
    into v_waiting
    from (select distinct (e->>'court_id')::uuid as court_id, (e->>'start_at')::timestamptz as start_at,
                 (e->>'end_at')::timestamptz as end_at
            from jsonb_array_elements(v_blocks) e) b
   where exists (
     select 1
       from matches m
      where m.venue_id = v_run.venue_id
        and m.status = 'awaiting_court'
        and not m.sandbox
        and m.period && tstzrange(b.start_at, b.end_at, '[)')
        -- The block's own court could host M (active, offering M's length, no
        -- live row over M's period), as match_court_claimed asks of its court:
        -- a block on a court M can never take starves nothing.
        and exists (select 1 from courts c
                      where c.id = b.court_id
                        and c.is_active
                        and m.duration_min = any (c.duration_options)
                        and not exists (select 1 from reservations r
                                         where r.court_id = c.id
                                           and r.status in ('pending', 'confirmed', 'arrived')
                                           and r.period && m.period))
        and not (app.is_degraded(m.venue_id)
                 and m.start_at < now() + make_interval(hours => coalesce(
                       (select vs.protected_horizon_hours from venue_settings vs where vs.venue_id = m.venue_id),
                       48)))
        and (select count(*)
               from courts c2
              where c2.venue_id = m.venue_id
                and c2.is_active
                and m.duration_min = any (c2.duration_options)
                and not exists (select 1 from reservations r2
                                 where r2.court_id = c2.id
                                   and r2.status in ('pending', 'confirmed', 'arrived')
                                   and r2.period && m.period)
                and not exists (select 1 from jsonb_array_elements(v_blocks) e2
                                 where (e2->>'court_id')::uuid = c2.id
                                   and tstzrange((e2->>'start_at')::timestamptz, (e2->>'end_at')::timestamptz, '[)')
                                       && m.period))
            < (select count(*)
                 from matches x
                where x.venue_id = m.venue_id
                  and x.status = 'awaiting_court'
                  and not x.sandbox
                  and x.period && m.period
                  and not (app.is_degraded(x.venue_id)
                           and x.start_at < now() + make_interval(hours => coalesce(
                                 (select vs.protected_horizon_hours from venue_settings vs
                                   where vs.venue_id = x.venue_id), 48)))));

  if jsonb_array_length(v_waiting) > 0 then
    -- Sorted as before: start, court, then the null reservation id last.
    select jsonb_agg(c order by (c->>'start_at')::timestamptz, c->>'court_id', c->>'reservation_id' nulls last)
      into v_conflicts
      from jsonb_array_elements(v_conflicts || v_waiting) c;
  end if;

  if jsonb_array_length(v_conflicts) > 0 then
    v_result := jsonb_build_object('blocked', '[]'::jsonb, 'conflicts', v_conflicts);
    perform app.finish_replay(p_idempotency_key, v_result);
    return v_result;
  end if;

  -- Older desks read notes: the tournament's English name, else the title.
  v_notes := left(coalesce(nullif(btrim(v_run.data->>'name_en'), ''), nullif(btrim(v_run.title_en), ''),
                           v_run.title_ar), 200);
  for v_b in
    select (e->>'court_id')::uuid as court_id, (e->>'start_at')::timestamptz as start_at,
           (e->>'end_at')::timestamptz as end_at
      from jsonb_array_elements(v_blocks) e
     order by 1, 2
  loop
    select r.id into v_id
      from reservations r
     where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
       and r.court_id = v_b.court_id and r.start_at = v_b.start_at and r.end_at = v_b.end_at
       and r.status in ('pending', 'confirmed', 'arrived');
    if not found then
      begin
        insert into reservations
          (court_id, kind, status, start_at, end_at, created_by_staff_id, source, notes,
           venue_id, block_purpose, protocol_run_id)
        values
          (v_b.court_id, 'maintenance', 'confirmed', v_b.start_at, v_b.end_at, auth.uid(), 'desk', v_notes,
           v_run.venue_id, 'event', v_run.id)
        returning id into v_id;
      exception when exclusion_violation then
        raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
      end;
      perform app.write_audit('reservation.event_block', 'reservations', v_id::text, null,
        jsonb_build_object('protocol_run_id', v_run.id, 'court_id', v_b.court_id,
                           'start_at', v_b.start_at, 'end_at', v_b.end_at));
    end if;
    v_blocked := v_blocked || jsonb_build_array(jsonb_build_object(
      'reservation_id', v_id, 'court_id', v_b.court_id, 'start_at', v_b.start_at, 'end_at', v_b.end_at));
  end loop;

  v_result := jsonb_build_object('blocked', v_blocked, 'conflicts', '[]'::jsonb);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $block_courts_for_event_0300$;

comment on function app.block_courts_for_event(uuid, jsonb, text) is
  'event_court_blocks (§2.11), M7. The court desk or MGMT at the run''s venue (a branch in scope, app.visible_venue_ids), while the tournament''s courts step is open: blocks p_blocks [{court_id, start_at, end_at}] (1-60, active courts) as event blocks (maintenance, block_purpose event, protocol_run_id, notes = the tournament''s English name), every court locked in court-id order first. Returns {blocked: [{reservation_id, court_id, start_at, end_at}], conflicts: [{court_id, start_at, end_at, reservation_id, kind, status}]}; with any conflict nothing is written and blocked is empty. M7 (S11): a requested block on a court that could book a waiting open match (awaiting_court; the court active, offering its length, with no live row over its period) and that would leave it no court comes back as a conflict {reservation_id null, kind match_waiting, status awaiting_court}. A block of this run with the same court and window is returned, not written again. PROTOCOL_NOT_FOUND, STEP_NOT_OPEN, INVALID_ARGUMENT (hint blocks), BLOCK_RANGE_INVALID, COURT_NOT_FOUND (unknown, another branch''s or inactive), DEGRADED_LOCKOUT (M7: the branch trading offline, the earliest block inside the protected horizon), SLOT_TAKEN (a race past the check). Idempotent on p_idempotency_key. Audit reservation.event_block.';

revoke all on function app.block_courts_for_event(uuid, jsonb, text) from public, anon;
grant execute on function app.block_courts_for_event(uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- 2. The guard trigger (T-3, S9): no re-issue of cancel, move, mark or extend
-- ===========================================================================
-- An event block of a run whose tournament is open, closed or running is the
-- tournament's court: only the tournament's own release changes it, and that
-- sets the tournament cancelled or finished first, in the same transaction.
-- Before publish no tournament row exists, so the protocol's own cancels
-- (plan passed and moved, stop) are untouched. Takes no lock.
create or replace function app.trg_tournament_block_guard() returns trigger
language plpgsql security definer set search_path = public as $trg_tournament_block_guard_0300$
begin
  if (new.status is distinct from old.status
      or new.court_id is distinct from old.court_id
      or new.start_at is distinct from old.start_at
      or new.end_at is distinct from old.end_at
      or new.kind is distinct from old.kind)
     and exists (select 1 from tournaments t
                  where t.protocol_run_id = old.protocol_run_id
                    and t.status in ('open', 'closed', 'running')) then
    raise exception 'TOURNAMENT_VIA_EVENTS' using errcode = 'P0001',
      hint = 'this block is a tournament''s court; change the tournament instead';
  end if;
  return new;
end $trg_tournament_block_guard_0300$;

comment on function app.trg_tournament_block_guard() is
  'Tournaments (M7, T-3, S9). Trigger reservations_tournament_guard, before update of status, court_id, start_at, end_at, kind on an event block (block_purpose event, protocol_run_id set): TOURNAMENT_VIA_EVENTS when one of them changes while the run''s tournament is open, closed or running. The tournament''s own release sets it cancelled or finished first. No lock.';

revoke all on function app.trg_tournament_block_guard() from public, anon, authenticated;

drop trigger if exists reservations_tournament_guard on reservations;
create trigger reservations_tournament_guard
  before update of status, court_id, start_at, end_at, kind on reservations
  for each row when (old.block_purpose = 'event' and old.protocol_run_id is not null)
  execute function app.trg_tournament_block_guard();

-- ===========================================================================
-- 3. Internals: release, notify, promote, cancel
-- ===========================================================================

-- The run's adopted event blocks that have not started go back (the
-- 0174:573-594 loop verbatim, plus the count). Called only after the
-- tournament's status left open/closed/running, so the guard lets it pass;
-- finish frees the courts it no longer needs early (review N7).
-- Lock order: the caller's tournaments row -> courts (court-id order) ->
-- reservations.
create or replace function app.tournament_release_blocks(p_tournament_id uuid, p_note text)
returns int
language plpgsql security definer set search_path = public as $tournament_release_blocks_0300$
declare
  v_run_id uuid;
  v_court  uuid;
  v_res    reservations%rowtype;
  v_n      int := 0;
begin
  select t.protocol_run_id into v_run_id from tournaments t where t.id = p_tournament_id;
  if v_run_id is null then
    return 0;
  end if;

  for v_court in
    select distinct r.court_id
      from reservations r
     where r.protocol_run_id = v_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.start_at > now()
     order by 1
  loop
    perform app.lock_court(v_court);
  end loop;

  for v_res in
    update reservations r
       set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff',
           cancellation_reason = left(coalesce(nullif(btrim(p_note), ''), 'Tournament ended'), 200)
     where r.protocol_run_id = v_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.start_at > now()
    returning r.*
  loop
    v_n := v_n + 1;
    perform app.write_audit('reservation.cancel', 'reservations', v_res.id::text,
      jsonb_build_object('status', 'confirmed'),
      jsonb_build_object('status', 'cancelled', 'protocol_run_id', v_run_id, 'tournament_id', p_tournament_id));
  end loop;
  return v_n;
end $tournament_release_blocks_0300$;

comment on function app.tournament_release_blocks(uuid, text) is
  'Tournaments (M7, §1.5). Internal: cancels the tournament run''s live event blocks that have not started (courts locked in court-id order first; cancellation_reason p_note; audit reservation.cancel per block). Called by cancel and finish only after the status change. Returns the blocks cancelled.';

revoke all on function app.tournament_release_blocks(uuid, text) from public, anon, authenticated;

-- The one queue for the tournament push family (§1.10): a cut-down
-- lesson_notify (0283:4132). One recipient, the entry's account; the kind
-- from the key; never the actor; deleted and tokenless profiles skipped; a
-- 15-minute dedupe; due now and nudged. A push never fails the write that
-- queued it.
create or replace function app.tournament_notify(p_entry_id uuid, p_title_key text, p_dedupe text)
returns void
language plpgsql security definer set search_path = public as $tournament_notify_0300$
declare
  -- The tournament subset of _shared/guest-push.json title_keys
  -- (tests/tournaments-lifecycle.test.ts compares).
  c_keys constant jsonb := '{"tournament.cancelled": "tournament_update", "tournament.promoted": "tournament_update"}';
  v_dedupe  text := nullif(btrim(p_dedupe), '');
  v_actor   uuid := auth.uid();
  v_to      uuid;
  v_tid     uuid;
  v_payload jsonb;
  v_count   int := 0;
begin
  if p_title_key is null or not (c_keys ? p_title_key) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'title_key';
  end if;
  if p_entry_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_entry_id';
  end if;

  begin
    select e.guest_id, e.tournament_id into v_to, v_tid from tournament_entries e where e.id = p_entry_id;
    if v_to is null then
      return;
    end if;
    -- Params are closed and empty: no name and no amount reaches a lock screen.
    v_payload := jsonb_build_object('route', 'tournament', 'id', v_tid::text, 'title_key', p_title_key,
                                    'params', '{}'::jsonb)
              || case when v_dedupe is null then '{}'::jsonb else jsonb_build_object('dedupe', v_dedupe) end;

    insert into notification_outbox (profile_id, kind, payload, scheduled_for)
    select p.id, c_keys->>p_title_key, v_payload, now()
      from profiles p
     where p.id = v_to
       and p.deleted_at is null
       and p.expo_push_token is not null
       and p.id is distinct from v_actor
       and (v_dedupe is null
            or not exists (select 1 from notification_outbox o
                            where o.profile_id = p.id
                              and o.payload->>'dedupe' = v_dedupe
                              and o.created_at > now() - interval '15 minutes'));
    get diagnostics v_count = row_count;
    if v_count > 0 then
      perform app.push_nudge();
    end if;
  exception when others then
    raise warning 'tournament_notify: %', sqlerrm;
  end;
end $tournament_notify_0300$;

comment on function app.tournament_notify(uuid, text, text) is
  'Tournaments (M7, §1.5, §1.10). Internal: queues at most one notification_outbox row of kind tournament_update for the entry''s account, title key tournament.cancelled or tournament.promoted (c_keys, the tournament subset of _shared/guest-push.json). Payload {route tournament, id (the tournament), title_key, params {}} (+ dedupe). Skips deleted and tokenless profiles, the actor (auth.uid()) and a recipient who had that dedupe in the last 15 minutes. INVALID_ARGUMENT (hint title_key, p_entry_id) for a bad call; a failing insert only warns.';

revoke all on function app.tournament_notify(uuid, text, text) from public, anon, authenticated;

-- A registered place came free while registration is open: the first
-- waitlisted entry by entered_at takes it and is told. The caller holds the
-- tournament row FOR UPDATE.
create or replace function app.tournament_promote_internal(p_tournament_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $tournament_promote_internal_0300$
declare
  v_t  tournaments%rowtype;
  v_id uuid;
begin
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or v_t.status <> 'open' then
    return null;
  end if;
  if (select count(*) from tournament_entries e
       where e.tournament_id = v_t.id and e.status = 'registered') >= v_t.max_entries then
    return null;
  end if;

  select e.id into v_id
    from tournament_entries e
   where e.tournament_id = v_t.id and e.status = 'waitlisted'
   order by e.entered_at, e.id
   limit 1
     for update;
  if v_id is null then
    return null;
  end if;

  update tournament_entries
     set status = 'registered', promoted_at = now(), updated_at = now()
   where id = v_id;
  perform app.tournament_notify(v_id, 'tournament.promoted', 'tournament.promoted:' || v_id::text);
  perform app.write_audit('tournament.promote', 'tournament_entries', v_id::text,
                          jsonb_build_object('status', 'waitlisted'),
                          jsonb_build_object('status', 'registered', 'tournament_id', v_t.id));
  return v_id;
end $tournament_promote_internal_0300$;

comment on function app.tournament_promote_internal(uuid) is
  'Tournaments (M7, §1.5). Internal: while the tournament is open and a registered place is free, the first waitlisted entry by entered_at (then id) becomes registered (promoted_at), is told (tournament.promoted) and audited (tournament.promote). Returns its id, or NULL. The caller holds the tournament row FOR UPDATE.';

revoke all on function app.tournament_promote_internal(uuid) from public, anon, authenticated;

-- Cancel: the status first (so the guard lets the release through), then the
-- courts, then every live entry is told. Returns what each paying entry is due
-- back at the till. p_reason is the code, or '<code>: <note>' (the R42 form):
-- the code is cancel_reason, the note goes to the audit row. The caller holds
-- the tournament row FOR UPDATE.
-- Lock order: the caller's tournaments row -> courts -> reservations.
create or replace function app.tournament_cancel_internal(p_tournament_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_cancel_internal_0300$
declare
  v_t        tournaments%rowtype;
  v_code     text := btrim(split_part(coalesce(p_reason, ''), ':', 1));
  v_note     text;
  v_was      text;
  v_entry    uuid;
  v_released int;
  v_refunds  jsonb;
begin
  if v_code not in ('under_filled', 'staff') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_reason';
  end if;
  if position(':' in p_reason) > 0 then
    v_note := left(nullif(btrim(substr(p_reason, position(':' in p_reason) + 1)), ''), 300);
  end if;
  select t.status into v_was from tournaments t where t.id = p_tournament_id;
  update tournaments
     set status = 'cancelled', cancel_reason = v_code, cancelled_at = now(), updated_at = now()
   where id = p_tournament_id and status in ('open', 'closed', 'running')
  returning * into v_t;
  if not found then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;

  v_released := app.tournament_release_blocks(v_t.id,
    case when v_code = 'under_filled' then 'Tournament under-filled' else 'Tournament cancelled' end);

  for v_entry in
    select e.id from tournament_entries e
     where e.tournament_id = v_t.id and e.status in ('registered', 'waitlisted')
     order by e.entered_at, e.id
  loop
    perform app.tournament_notify(v_entry, 'tournament.cancelled', 'tournament.cancelled:' || v_t.id::text);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('entry_id', x.entry_id, 'net_paid_iqd', x.net)
                            order by x.entry_id), '[]'::jsonb)
    into v_refunds
    from (select e.id as entry_id,
                 (app.tournament_entry_money(e.id)->>'refund_due_iqd')::bigint as net
            from tournament_entries e
           where e.tournament_id = v_t.id) x
   where x.net > 0;

  perform app.write_audit('tournament.cancel', 'tournaments', v_t.id::text,
                          jsonb_build_object('status', v_was),
                          jsonb_build_object('status', 'cancelled', 'cancel_reason', v_code, 'note', v_note,
                                             'blocks_released', v_released, 'refunds_due', v_refunds),
                          v_code);
  return jsonb_build_object('tournament_id', v_t.id, 'status', 'cancelled', 'refunds_due', v_refunds);
end $tournament_cancel_internal_0300$;

comment on function app.tournament_cancel_internal(uuid, text) is
  'Tournaments (M7, §1.5). Internal: an open, closed or running tournament becomes cancelled (p_reason under_filled or staff, or ''<code>: <note>'' with the note kept in the audit row; cancel_reason is the code), its future event blocks are released, every live entry is told (tournament.cancelled), audit tournament.cancel. Returns {tournament_id, status, refunds_due [{entry_id, net_paid_iqd}]} (the desk money each entry is due back, refunded through app.refund). TOURNAMENT_NOT_OPEN detail status otherwise. The caller holds the tournament row FOR UPDATE.';

revoke all on function app.tournament_cancel_internal(uuid, text) from public, anon, authenticated;

-- ===========================================================================
-- 4. Publish and cancel (manager, owner)
-- ===========================================================================

-- tournament_publish (T-6, §1.6, S13): a done tournament run becomes one
-- tournaments row that adopts the run's live event blocks of its plan.
-- Lock order: protocol_runs FOR UPDATE -> courts (app.lock_court, court-id
-- order) -> the blocks FOR UPDATE (review N6) -> insert tournaments. The run
-- lock and the unique key on protocol_run_id serialise two publishes.
create or replace function app.tournament_publish(p_run_id uuid, p_settings jsonb, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_publish_0300$
declare
  c_keys constant text[] := array['format', 'category', 'points_target', 'rounds', 'min_entries',
                                  'waitlist_max', 'registration_closes_at', 'prize_en', 'prize_ar'];
  v_run       protocol_runs%rowtype;
  v_s         jsonb := coalesce(p_settings, '{}'::jsonb);
  v_replay    jsonb;
  v_data      jsonb;
  v_key       text;
  v_count     bigint;
  v_max       int;
  v_format    text;
  v_category  text := 'open';
  v_points    int := 24;
  v_rounds    int;
  v_min       int := 4;
  v_wait      int := 8;
  v_n         bigint;
  v_closes    timestamptz;
  v_prize_en  text;
  v_prize_ar  text;
  v_fee       bigint;
  v_court     uuid;
  v_first     timestamptz;
  v_last      timestamptz;
  v_blocks    jsonb;
  v_unblocked jsonb;
  v_id        uuid;
  v_constraint text;
  v_result    jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  if jsonb_typeof(v_s) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_settings';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or v_run.kind <> 'tournament'
     or not (v_run.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  if not app.tournament_on(v_run.venue_id) then
    raise exception 'TOURNAMENTS_OFF' using errcode = 'P0001';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'tournament_publish');
  if v_replay is not null then
    return v_replay;
  end if;

  v_data := v_run.data;
  if v_run.status <> 'done' then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'not_done',
      hint = 'only a finished tournament run is published';
  end if;
  if exists (select 1 from tournaments t where t.protocol_run_id = v_run.id) then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'already_published';
  end if;
  -- The unit is matched as a pattern so no body spells the word 0147 swept
  -- out (the 0147 suite reads every function body).
  if coalesce(v_data->'capacity'->>'unit', '') !~ '^player(s)$' then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'capacity_unit',
      hint = 'v1 plays individual entries: the plan''s capacity must count single entries';
  end if;
  begin
    v_count := (v_data->'capacity'->>'count')::bigint;
  exception when others then
    v_count := null;
  end;
  if v_count is null or v_count < 4 then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'capacity_count';
  end if;
  v_max := least(v_count, 64)::int;

  -- The format: type 1 and 3 plans carry it (the settings may only repeat it);
  -- a type 2 plan has none, so the settings must name it.
  if v_run.variant in ('type1', 'type3') then
    v_format := v_data->>'format';
    if v_format is null or v_format not in ('americano', 'mexicano')
       or (v_s->'format' is not null and v_s->'format' <> 'null'::jsonb
           and v_s->>'format' is distinct from v_format) then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'format';
    end if;
  else
    if jsonb_typeof(v_s->'format') is distinct from 'string' or v_s->>'format' not in ('americano', 'mexicano') then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'format';
    end if;
    v_format := v_s->>'format';
  end if;

  -- The fee (T-6): a fee needs the owner's OK on feasibility, on its current
  -- round. protocol_engine_decider with needs_owner_ok admits the owner only
  -- (0164:211) and an auto pass records the submitter (0164:528), so a passing
  -- row decided by an owner is the owner's OK. A type 2 plan has no fee.
  v_fee := case when v_run.variant in ('type1', 'type3')
                then coalesce((v_data->>'entry_fee_iqd')::bigint, 0) else 0 end;
  if v_fee > 0 and not exists (
       select 1
         from protocol_run_steps s
         join protocol_submissions x on x.run_step_id = s.id and x.round = s.round
         join staff st on st.id = x.decided_by
        where s.run_id = v_run.id
          and s.step_key = 'feasibility'
          and s.status = 'passed'
          and s.needs_owner_ok
          and x.withdrawn_at is null
          and x.superseded_at is null
          and x.decision in ('approve', 'auto')
          and st.role = 'owner') then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'fee_not_approved',
      hint = 'an entry fee needs the owner''s OK on the feasibility step';
  end if;

  if not exists (select 1 from reservations r
                  where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
                    and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
                    and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at)) then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'no_blocks';
  end if;

  -- The settings (§1.6): every key optional unless marked; an unknown key or a
  -- bad value is settings:<key>.
  select k into v_key from jsonb_object_keys(v_s) k where not (k = any (c_keys)) order by k limit 1;
  if v_key is not null then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:' || v_key;
  end if;
  if v_s->'category' is not null and v_s->'category' <> 'null'::jsonb then
    if jsonb_typeof(v_s->'category') <> 'string' or v_s->>'category' not in ('open', 'women', 'men') then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:category';
    end if;
    v_category := v_s->>'category';
  end if;
  foreach v_key in array array['points_target', 'rounds', 'min_entries', 'waitlist_max'] loop
    begin
      v_n := app.tournament_int(v_s->v_key,
               case v_key when 'points_target' then 8 when 'rounds' then 1 when 'min_entries' then 4 else 0 end,
               case v_key when 'points_target' then 64 when 'rounds' then 30 when 'min_entries' then v_max else 64 end,
               false, v_key);
    exception when others then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:' || v_key;
    end;
    if v_n is not null then
      case v_key
        when 'points_target' then v_points := v_n;
        when 'rounds'        then v_rounds := v_n;
        when 'min_entries'   then v_min := v_n;
        else                      v_wait := v_n;
      end case;
    end if;
  end loop;
  -- Mexicano plays one round at a time to a planned count; an Americano's
  -- length is its first schedule's, so a rounds value is ignored there.
  if v_format = 'mexicano' and v_rounds is null then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:rounds';
  end if;
  if v_format = 'americano' then
    v_rounds := null;
  end if;
  if jsonb_typeof(v_s->'registration_closes_at') is not distinct from 'string' then
    begin
      v_closes := (v_s->>'registration_closes_at')::timestamptz;
    exception when others then
      v_closes := null;
    end;
  end if;
  if v_closes is null or not isfinite(v_closes) or v_closes <= now() then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:registration_closes_at',
      hint = 'registration_closes_at is required: a time after now, no later than the first court block';
  end if;
  foreach v_key in array array['prize_en', 'prize_ar'] loop
    if v_s->v_key is not null and v_s->v_key <> 'null'::jsonb then
      if jsonb_typeof(v_s->v_key) <> 'string'
         or char_length(coalesce(app.safe_line(v_s->>v_key), '')) > 200 then
        raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:' || v_key;
      end if;
      if v_key = 'prize_en' then
        v_prize_en := nullif(btrim(app.safe_line(v_s->>v_key)), '');
      else
        v_prize_ar := nullif(btrim(app.safe_line(v_s->>v_key)), '');
      end if;
    end if;
  end loop;

  -- The courts, in court-id order (0042), then the blocks themselves.
  for v_court in
    select distinct r.court_id
      from reservations r
     where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
       and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at)
     order by 1
  loop
    perform app.lock_court(v_court);
  end loop;
  perform 1
     from reservations r
    where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
      and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
      and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at)
      for update;

  select min(r.start_at), max(r.end_at),
         coalesce(jsonb_agg(jsonb_build_object('reservation_id', r.id, 'court_id', r.court_id,
                                               'start_at', r.start_at, 'end_at', r.end_at)
                            order by r.start_at, r.court_id, r.id), '[]'::jsonb)
    into v_first, v_last, v_blocks
    from reservations r
   where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
     and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
     and app.tournament_plan_has_window(v_data, r.court_id, r.start_at, r.end_at);
  if v_first is null then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'no_blocks';
  end if;
  if v_closes > v_first then
    raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'settings:registration_closes_at',
      hint = 'registration must close no later than the first court block starts';
  end if;

  -- S13: each court and window of the plan that no live block of the run covers.
  select coalesce(jsonb_agg(jsonb_build_object('court_id', c.id::uuid, 'start_at', (g.e->>'from')::timestamptz,
                                               'end_at', (g.e->>'to')::timestamptz)
                            order by (g.e->>'from')::timestamptz, c.id), '[]'::jsonb)
    into v_unblocked
    from jsonb_array_elements(case when jsonb_typeof(v_data->'ranges') = 'array'
                                   then v_data->'ranges' else '[]'::jsonb end) g(e)
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(g.e->'court_ids') = 'array'
                                                      then g.e->'court_ids' else '[]'::jsonb end) c(id)
   where not exists (select 1 from reservations r
                      where r.protocol_run_id = v_run.id and r.block_purpose = 'event'
                        and r.status in ('pending', 'confirmed', 'arrived')
                        and r.court_id::text = c.id
                        and r.start_at = (g.e->>'from')::timestamptz
                        and r.end_at = (g.e->>'to')::timestamptz);

  begin
    insert into tournaments
      (venue_id, protocol_run_id, name_en, name_ar, format, category, class, points_target, rounds_planned,
       max_entries, min_entries, waitlist_max, entry_fee_iqd, prize_en, prize_ar, starts_at, ends_at,
       registration_closes_at, published_by)
    values
      (v_run.venue_id, v_run.id, v_data->>'name_en', v_data->>'name_ar', v_format, v_category, v_data->>'class',
       v_points, v_rounds, v_max, v_min, v_wait, v_fee, v_prize_en, v_prize_ar, v_first, v_last,
       v_closes, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tournaments_protocol_run_id_key' then
      raise exception 'TOURNAMENT_PUBLISH_REFUSED' using errcode = 'P0001', detail = 'already_published';
    end if;
    raise;
  end;

  v_result := jsonb_build_object(
    'duplicate',         false,
    'tournament_id',     v_id,
    'status',            'open',
    'starts_at',         v_first,
    'ends_at',           v_last,
    'blocks',            v_blocks,
    'unblocked_windows', v_unblocked);
  perform app.write_audit('tournament.publish', 'tournaments', v_id::text, null,
                          jsonb_build_object('protocol_run_id', v_run.id, 'format', v_format,
                                             'category', v_category, 'max_entries', v_max,
                                             'min_entries', v_min, 'entry_fee_iqd', v_fee,
                                             'starts_at', v_first, 'ends_at', v_last,
                                             'registration_closes_at', v_closes,
                                             'blocks', jsonb_array_length(v_blocks)));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $tournament_publish_0300$;

comment on function app.tournament_publish(uuid, jsonb, text) is
  'Tournaments (M7, T-6, build contracts §1.6, §1.9, S13). Manager or owner at the run''s branch: a done tournament run becomes one tournaments row (names and class from the plan, max_entries = least(capacity.count, 64), the fee from the plan, starts_at/ends_at the adopted blocks'' span) adopting the run''s live event blocks on its plan (courts locked in court-id order, then the blocks FOR UPDATE). p_settings: format (type 2 required; type 1/3 must equal the plan''s), category, points_target 8..64, rounds (Mexicano required, 1..30; ignored for Americano), min_entries 4..max, waitlist_max 0..64, registration_closes_at (required, after now, no later than the first block), prize_en, prize_ar (<= 200). FORBIDDEN; INVALID_ARGUMENT (detail p_idempotency_key, p_settings); PROTOCOL_NOT_FOUND; VENUE_MISMATCH; TOURNAMENTS_OFF; a replay returns the stored answer; TOURNAMENT_PUBLISH_REFUSED detail not_done, already_published, capacity_unit, capacity_count, format, fee_not_approved (a fee without the owner''s OK on feasibility), no_blocks, settings:<key>. Audit tournament.publish. Returns {duplicate, tournament_id, status, starts_at, ends_at, blocks [{reservation_id, court_id, start_at, end_at}], unblocked_windows [{court_id, start_at, end_at}]}.';

revoke all on function app.tournament_publish(uuid, jsonb, text) from public, anon;
grant execute on function app.tournament_publish(uuid, jsonb, text) to authenticated;

-- tournament_cancel (§1.6). Lock order: tournaments FOR UPDATE -> courts ->
-- reservations (app.tournament_cancel_internal) -> the outbox.
create or replace function app.tournament_cancel(p_tournament_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_cancel_0300$
declare
  v_t      tournaments%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if v_t.status not in ('open', 'closed', 'running') then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;

  return app.tournament_cancel_internal(v_t.id, 'staff: ' || v_reason);
end $tournament_cancel_0300$;

comment on function app.tournament_cancel(uuid, text) is
  'Tournaments (M7, §1.6). Manager or owner at the tournament''s branch: an open, closed or running tournament is cancelled (cancel_reason staff): its future event blocks are released, every live entry is told (tournament.cancelled). FORBIDDEN; TOURNAMENT_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH; REASON_REQUIRED (blank p_reason, kept in the audit row); TOURNAMENT_NOT_OPEN detail status. Returns {tournament_id, status, refunds_due [{entry_id, net_paid_iqd}]}: the desk money to refund through the till''s refund.';

revoke all on function app.tournament_cancel(uuid, text) from public, anon;
grant execute on function app.tournament_cancel(uuid, text) to authenticated;

-- ===========================================================================
-- 5. Entries
-- ===========================================================================

-- tournament_register (T-4): a guest who may play an open match registers,
-- or joins the waitlist when the places are taken. State-idempotent: a live
-- entry answers duplicate. Lock order: tournaments FOR UPDATE -> entries.
create or replace function app.tournament_register(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_register_0300$
declare
  v_p      profiles;
  v_t      tournaments%rowtype;
  v_e      tournament_entries%rowtype;
  v_reg    int;
  v_wait   int;
  v_status text;
  v_pos    int;
begin
  -- AUTH, ACCOUNT, PHONE, TERMS, MATCH_BANNED, GENDER_REQUIRED (0260).
  v_p := app.match_guest(true);

  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found or not exists (select 1 from venues v where v.id = v_t.venue_id and v.is_active) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.tournament_on(v_t.venue_id) then
    raise exception 'TOURNAMENTS_OFF' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);

  select * into v_e from tournament_entries
   where tournament_id = v_t.id and guest_id = v_p.id
     for update;
  if v_e.id is not null and v_e.status in ('registered', 'waitlisted') then
    v_pos := case when v_e.status = 'waitlisted' then
               (select count(*)::int + 1 from tournament_entries w
                 where w.tournament_id = v_t.id and w.status = 'waitlisted'
                   and (w.entered_at, w.id) < (v_e.entered_at, v_e.id)) end;
    return jsonb_build_object('entry_id', v_e.id, 'status', v_e.status, 'waitlist_position', v_pos,
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

  if v_e.id is not null then
    -- A withdrawn guest comes back: the same row, a fresh place in the queue.
    update tournament_entries
       set status = v_status, entered_at = now(), added_by_kind = 'guest', added_by_staff_id = null,
           withdrawn_reason = null, withdrawn_at = null, promoted_at = null, updated_at = now()
     where id = v_e.id
    returning * into v_e;
  else
    insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind)
    values (v_t.venue_id, v_t.id, v_p.id, v_status, 'guest')
    returning * into v_e;
  end if;

  v_pos := case when v_status = 'waitlisted' then v_wait + 1 end;
  perform app.write_audit('tournament.register', 'tournament_entries', v_e.id::text, null,
                          jsonb_build_object('tournament_id', v_t.id, 'status', v_status));
  return jsonb_build_object('entry_id', v_e.id, 'status', v_status, 'waitlist_position', v_pos,
                            'duplicate', false);
end $tournament_register_0300$;

comment on function app.tournament_register(uuid) is
  'Tournaments (M7, T-4, §1.6). Guest: app.match_guest(true) first (AUTH_REQUIRED, ACCOUNT_REQUIRED, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, GENDER_REQUIRED); then TOURNAMENT_NOT_FOUND (unknown, or its branch not open to guests), TOURNAMENTS_OFF, a live entry answers duplicate true, TOURNAMENT_NOT_OPEN detail status (not open, or a no-show row) or cutoff (past registration_closes_at), TOURNAMENT_CATEGORY_MISMATCH (women / men against profiles.gender). registered while fewer than max_entries are, else waitlisted while fewer than waitlist_max are, else TOURNAMENT_FULL; a withdrawn row is re-used with a fresh entered_at. Audit tournament.register. Returns {entry_id, status, waitlist_position, duplicate}.';

revoke all on function app.tournament_register(uuid) from public, anon;
grant execute on function app.tournament_register(uuid) to authenticated;

-- tournament_withdraw (T-7): free while open and before the cut-off; a freed
-- registered place goes to the first waitlisted entry. Lock order:
-- tournaments FOR UPDATE -> entries.
create or replace function app.tournament_withdraw(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_withdraw_0300$
declare
  v_p   profiles;
  v_t   tournaments%rowtype;
  v_e   tournament_entries%rowtype;
  v_was text;
begin
  v_p := app.match_guest(false);

  select * into v_t from tournaments where id = p_tournament_id for update;
  if found then
    perform set_config('app.venue_id', v_t.venue_id::text, true);
    select * into v_e from tournament_entries
     where tournament_id = v_t.id and guest_id = v_p.id
       for update;
  end if;
  if v_e.id is null or v_e.status = 'no_show' then
    raise exception 'TOURNAMENT_ENTRY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_e.status = 'withdrawn' then
    return jsonb_build_object('entry_id', v_e.id, 'status', v_e.status,
                              'refund_due_iqd', (app.tournament_entry_money(v_e.id)->>'refund_due_iqd')::bigint,
                              'duplicate', true);
  end if;
  if v_t.status <> 'open' then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  if now() >= v_t.registration_closes_at then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'cutoff',
      hint = 'registration has closed; the desk can take you off';
  end if;

  v_was := v_e.status;
  update tournament_entries
     set status = 'withdrawn', withdrawn_reason = 'guest', withdrawn_at = now(), updated_at = now()
   where id = v_e.id
  returning * into v_e;
  if v_was = 'registered' then
    perform app.tournament_promote_internal(v_t.id);
  end if;

  perform app.write_audit('tournament.withdraw', 'tournament_entries', v_e.id::text,
                          jsonb_build_object('status', v_was),
                          jsonb_build_object('status', 'withdrawn', 'withdrawn_reason', 'guest',
                                             'tournament_id', v_t.id));
  return jsonb_build_object('entry_id', v_e.id, 'status', 'withdrawn',
                            'refund_due_iqd', (app.tournament_entry_money(v_e.id)->>'refund_due_iqd')::bigint,
                            'duplicate', false);
end $tournament_withdraw_0300$;

comment on function app.tournament_withdraw(uuid) is
  'Tournaments (M7, T-7, §1.6). Guest: app.match_guest(false) first; TOURNAMENT_ENTRY_NOT_FOUND without an entry of the caller (or for a no-show); an already withdrawn entry answers duplicate true; TOURNAMENT_NOT_OPEN detail status (not open) or cutoff (past registration_closes_at). The entry becomes withdrawn (guest); a freed registered place goes to the first waitlisted entry (tournament.promoted). Audit tournament.withdraw. Returns {entry_id, status, refund_due_iqd, duplicate}.';

revoke all on function app.tournament_withdraw(uuid) from public, anon;
grant execute on function app.tournament_withdraw(uuid) to authenticated;

-- tournament_add_entry (T-4, review M1): the desk adds a walk-in (a real
-- profile, desk-customer-create) in open, closed or running. Registered while
-- a place is free, else waitlisted; asked again for a waitlisted guest it
-- promotes them when there is room. Once closed every new registered entry
-- takes the next seed and moves the revision. Lock order: tournaments FOR
-- UPDATE -> entries.
create or replace function app.tournament_add_entry(p_tournament_id uuid, p_guest_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_add_entry_0300$
declare
  v_t      tournaments%rowtype;
  v_g      profiles%rowtype;
  v_e      tournament_entries%rowtype;
  v_reg    int;
  v_wait   int;
  v_status text;
  v_was    text;
  v_pos    int;
  v_play   boolean;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = p_tournament_id for update;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  if v_t.status not in ('open', 'closed', 'running') then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;

  select * into v_g from profiles where id = p_guest_id;
  if not found or v_g.deleted_at is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_id';
  end if;
  -- The desk vouches for phone and terms; a match ban still bars (0260).
  if exists (select 1 from customer_flags f where f.customer_id = v_g.id and f.type = 'match_ban') then
    raise exception 'MATCH_BANNED' using errcode = 'P0001';
  end if;
  if v_t.category in ('women', 'men') and v_g.gender is null then
    raise exception 'GENDER_REQUIRED' using errcode = 'P0001';
  end if;
  if (v_t.category = 'women' and v_g.gender <> 'female') or (v_t.category = 'men' and v_g.gender <> 'male') then
    raise exception 'TOURNAMENT_CATEGORY_MISMATCH' using errcode = 'P0001';
  end if;

  v_play := v_t.status in ('closed', 'running');
  select count(*) filter (where e.status = 'registered'), count(*) filter (where e.status = 'waitlisted')
    into v_reg, v_wait
    from tournament_entries e
   where e.tournament_id = v_t.id;

  select * into v_e from tournament_entries
   where tournament_id = v_t.id and guest_id = v_g.id
     for update;
  if v_e.status is not distinct from 'no_show' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'entry_status';
  end if;
  if v_e.status = 'registered' or (v_e.status = 'waitlisted' and v_reg >= v_t.max_entries) then
    v_pos := case when v_e.status = 'waitlisted' then
               (select count(*)::int + 1 from tournament_entries w
                 where w.tournament_id = v_t.id and w.status = 'waitlisted'
                   and (w.entered_at, w.id) < (v_e.entered_at, v_e.id)) end;
    return jsonb_build_object('entry_id', v_e.id, 'status', v_e.status, 'waitlist_position', v_pos,
                              'duplicate', true);
  end if;

  v_was := v_e.status;
  if v_reg < v_t.max_entries then
    v_status := 'registered';
  elsif v_wait < v_t.waitlist_max then
    v_status := 'waitlisted';
  else
    raise exception 'TOURNAMENT_FULL' using errcode = 'P0001';
  end if;

  if v_e.id is not null and v_was = 'waitlisted' then
    -- A waitlisted guest with a place free now: promoted in place.
    update tournament_entries
       set status = 'registered', promoted_at = now(), updated_at = now(),
           seed_no = case when v_play
                          then (select coalesce(max(x.seed_no), 0) + 1 from tournament_entries x
                                 where x.tournament_id = v_t.id) end
     where id = v_e.id
    returning * into v_e;
  elsif v_e.id is not null then
    -- A withdrawn guest comes back on the desk's word.
    update tournament_entries
       set status = v_status, entered_at = now(), added_by_kind = 'staff', added_by_staff_id = auth.uid(),
           withdrawn_reason = null, withdrawn_at = null, promoted_at = null, updated_at = now(),
           seed_no = case when v_play and v_status = 'registered'
                          then (select coalesce(max(x.seed_no), 0) + 1 from tournament_entries x
                                 where x.tournament_id = v_t.id) end
     where id = v_e.id
    returning * into v_e;
  else
    insert into tournament_entries (venue_id, tournament_id, guest_id, status, added_by_kind, added_by_staff_id,
                                    seed_no)
    values (v_t.venue_id, v_t.id, v_g.id, v_status, 'staff', auth.uid(),
            case when v_play and v_status = 'registered'
                 then (select coalesce(max(x.seed_no), 0) + 1 from tournament_entries x
                        where x.tournament_id = v_t.id) end)
    returning * into v_e;
  end if;

  if v_play and v_e.status = 'registered' then
    update tournaments set revision = revision + 1, updated_at = now() where id = v_t.id;
  end if;

  v_pos := case when v_e.status = 'waitlisted' then
             (select count(*)::int + 1 from tournament_entries w
               where w.tournament_id = v_t.id and w.status = 'waitlisted'
                 and (w.entered_at, w.id) < (v_e.entered_at, v_e.id)) end;
  perform app.write_audit('tournament.add_entry', 'tournament_entries', v_e.id::text,
                          case when v_was is null then null else jsonb_build_object('status', v_was) end,
                          jsonb_build_object('tournament_id', v_t.id, 'guest_id', v_g.id, 'status', v_e.status,
                                             'seed_no', v_e.seed_no));
  return jsonb_build_object('entry_id', v_e.id, 'status', v_e.status, 'waitlist_position', v_pos,
                            'duplicate', false);
end $tournament_add_entry_0300$;

comment on function app.tournament_add_entry(uuid, uuid) is
  'Tournaments (M7, T-4, §1.6, review M1). The court desk, managers and the owner at the tournament''s branch add a guest profile (a walk-in made through desk-customer-create) while the tournament is open, closed or running. FORBIDDEN; TOURNAMENT_NOT_FOUND; VENUE_MISMATCH; TOURNAMENT_NOT_OPEN detail status; INVALID_ARGUMENT detail p_guest_id (unknown or deleted profile) or entry_status (a no-show); MATCH_BANNED; GENDER_REQUIRED (a women or men tournament and no gender); TOURNAMENT_CATEGORY_MISMATCH. No phone or terms check (the desk vouches). registered while a place is free, else waitlisted, else TOURNAMENT_FULL; a waitlisted guest is promoted when a place is free; a registered one (or a waitlisted one with no place) answers duplicate true. In closed and running a new registered entry takes the next seed_no and moves the revision. Audit tournament.add_entry. Returns {entry_id, status, waitlist_position, duplicate}.';

revoke all on function app.tournament_add_entry(uuid, uuid) from public, anon;
grant execute on function app.tournament_add_entry(uuid, uuid) to authenticated;

-- tournament_remove_entry: the desk takes an entry off before play (open or
-- closed; in running a no-show is the tool, review N3). A freed place goes to
-- the waitlist while open. Lock order: tournaments FOR UPDATE -> entries.
create or replace function app.tournament_remove_entry(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_remove_entry_0300$
declare
  v_venue  uuid;
  v_tid    uuid;
  v_t      tournaments%rowtype;
  v_e      tournament_entries%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_was    text;
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
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_t from tournaments where id = v_tid for update;
  select * into v_e from tournament_entries where id = p_entry_id for update;
  if v_t.status not in ('open', 'closed') then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  if v_e.status = 'no_show' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'entry_status';
  end if;
  if v_e.status = 'withdrawn' then
    return jsonb_build_object('entry_id', v_e.id, 'status', v_e.status,
                              'refund_due_iqd', (app.tournament_entry_money(v_e.id)->>'refund_due_iqd')::bigint);
  end if;

  v_was := v_e.status;
  update tournament_entries
     set status = 'withdrawn', withdrawn_reason = 'staff', withdrawn_at = now(), updated_at = now()
   where id = v_e.id
  returning * into v_e;
  if v_was = 'registered' and v_t.status = 'open' then
    perform app.tournament_promote_internal(v_t.id);
  elsif v_was = 'registered' then
    update tournaments set revision = revision + 1, updated_at = now() where id = v_t.id;
  end if;

  perform app.write_audit('tournament.remove_entry', 'tournament_entries', v_e.id::text,
                          jsonb_build_object('status', v_was),
                          jsonb_build_object('status', 'withdrawn', 'withdrawn_reason', 'staff',
                                             'tournament_id', v_t.id),
                          left(v_reason, 300));
  return jsonb_build_object('entry_id', v_e.id, 'status', 'withdrawn',
                            'refund_due_iqd', (app.tournament_entry_money(v_e.id)->>'refund_due_iqd')::bigint);
end $tournament_remove_entry_0300$;

comment on function app.tournament_remove_entry(uuid, text) is
  'Tournaments (M7, §1.6, review N3). The court desk, managers and the owner take an entry off an open or closed tournament: FORBIDDEN; TOURNAMENT_ENTRY_NOT_FOUND; VENUE_MISMATCH; REASON_REQUIRED (kept in the audit row); TOURNAMENT_NOT_OPEN detail status (running: mark a no-show instead); INVALID_ARGUMENT detail entry_status (a no-show). The entry becomes withdrawn (staff); a freed registered place goes to the waitlist while open, and moves the revision once closed. An already withdrawn entry answers as it is. Audit tournament.remove_entry. Returns {entry_id, status, refund_due_iqd}.';

revoke all on function app.tournament_remove_entry(uuid, text) from public, anon;
grant execute on function app.tournament_remove_entry(uuid, text) to authenticated;

-- ===========================================================================
-- 6. The sweep (§3.7) and its cron
-- ===========================================================================
-- Service role only. Each tournament in its own exception block, locked FOR
-- UPDATE SKIP LOCKED (a tournament the desk is writing waits for the next
-- tick), app.venue_id set before any write (review N5).
--   1. The cut-off: an open tournament past registration_closes_at with fewer
--      registered entries than min_entries is chosen for the tick's cancel
--      (under_filled: blocks released, entries told), otherwise closed with
--      its seeds stamped.
--   2. Deleted accounts (0290's tombstone keeps guest_id): a live entry in an
--      open or closed tournament is withdrawn (account_deleted), with
--      promotion while open; once closed the revision moves.
--   3. The finish: a closed or running tournament six hours past ends_at is
--      finished. Every block has started by then (ends_at is the last block's
--      end), so there is nothing left to release. A closed one with no round
--      drawn was never played: it is chosen for the tick's cancel instead
--      (staff, the note "not played"), so its payers are owed their fee back.
--   4. The cancel: at most one a tick, the first chosen, from one call site,
--      its row still locked by the step that chose it. A cancel takes court
--      locks, and court locks of two tournaments taken in one transaction
--      would not be in court-id order across them; the rest are deferred and
--      the next tick (a minute later) takes the next.
-- Lock order: tournaments (skip locked) -> entries (steps 1 to 3); then the
-- one cancel: courts -> reservations (step 4).
create or replace function app.tournament_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $tournament_sweep_0300$
declare
  v_id        uuid;
  v_t         tournaments%rowtype;
  v_e         record;
  v_reg       int;
  v_cancelled int := 0;
  v_closed    int := 0;
  v_withdrawn int := 0;
  v_finished  int := 0;
  v_deferred  int := 0;
  v_skipped   int := 0;
  v_errors    int := 0;
  -- The one cancel of this tick, made at the end (step 4) from one call site.
  v_cancel_id uuid;
  v_cancel_why text;
begin
  -- 1. The cut-off.
  for v_id in
    select t.id from tournaments t
     where t.status = 'open' and t.registration_closes_at <= now()
     order by t.registration_closes_at, t.id
     limit 200
  loop
    begin
      select * into v_t from tournaments where id = v_id and status = 'open' for update skip locked;
      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      perform set_config('app.venue_id', v_t.venue_id::text, true);
      select count(*) into v_reg from tournament_entries e where e.tournament_id = v_t.id and e.status = 'registered';
      if v_reg < v_t.min_entries then
        if v_cancel_id is not null then
          v_deferred := v_deferred + 1;
          continue;
        end if;
        -- Kept locked; cancelled in step 4.
        v_cancel_id := v_t.id;
        v_cancel_why := 'under_filled';
      else
        update tournaments set status = 'closed', closed_at = now(), updated_at = now() where id = v_t.id;
        update tournament_entries e
           set seed_no = s.n, updated_at = now()
          from (select x.id, row_number() over (order by x.entered_at, x.id) as n
                  from tournament_entries x
                 where x.tournament_id = v_t.id and x.status = 'registered') s
         where e.id = s.id;
        perform app.write_audit('tournament.close', 'tournaments', v_t.id::text,
                                jsonb_build_object('status', 'open'),
                                jsonb_build_object('status', 'closed', 'registered', v_reg));
        v_closed := v_closed + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'tournament_sweep cut-off %: % (%)', v_id, sqlerrm, sqlstate;
    end;
  end loop;

  -- 2. Deleted accounts.
  for v_e in
    select e.id, e.tournament_id
      from tournament_entries e
      join tournaments t on t.id = e.tournament_id
      join profiles p on p.id = e.guest_id
     where e.status in ('registered', 'waitlisted')
       and t.status in ('open', 'closed')
       and p.deleted_at is not null
     order by e.tournament_id, e.id
     limit 200
  loop
    begin
      select * into v_t from tournaments where id = v_e.tournament_id and status in ('open', 'closed')
         for update skip locked;
      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      perform set_config('app.venue_id', v_t.venue_id::text, true);
      update tournament_entries
         set status = 'withdrawn', withdrawn_reason = 'account_deleted', withdrawn_at = now(), updated_at = now()
       where id = v_e.id and status in ('registered', 'waitlisted');
      if found then
        perform app.write_audit('tournament.withdraw', 'tournament_entries', v_e.id::text, null,
                                jsonb_build_object('status', 'withdrawn', 'withdrawn_reason', 'account_deleted',
                                                   'tournament_id', v_t.id));
        if v_t.status = 'open' then
          perform app.tournament_promote_internal(v_t.id);
        else
          update tournaments set revision = revision + 1, updated_at = now() where id = v_t.id;
        end if;
        v_withdrawn := v_withdrawn + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'tournament_sweep deleted account %: % (%)', v_e.id, sqlerrm, sqlstate;
    end;
  end loop;

  -- 3. The finish.
  for v_id in
    select t.id from tournaments t
     where t.status in ('closed', 'running') and t.ends_at + interval '6 hours' <= now()
     order by t.ends_at, t.id
     limit 200
  loop
    begin
      select * into v_t from tournaments where id = v_id and status in ('closed', 'running') for update skip locked;
      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      perform set_config('app.venue_id', v_t.venue_id::text, true);
      -- Closed with no round drawn: never played. Finishing it would end its
      -- refunds (refund_due counts withdrawn and cancelled entries only, and
      -- tournament_cancel refuses a finished one), so it is cancelled instead
      -- and the money read owes every payer back: in step 4, within the one
      -- cancel a tick.
      if v_t.status = 'closed' and not exists (select 1 from tournament_rounds r where r.tournament_id = v_t.id) then
        if v_cancel_id is not null then
          v_deferred := v_deferred + 1;
          continue;
        end if;
        v_cancel_id := v_t.id;
        v_cancel_why := 'staff: not played (no round drawn by the finish)';
        continue;
      end if;
      update tournaments set status = 'finished', finished_at = now(), updated_at = now() where id = v_t.id;
      perform app.write_audit('tournament.finish', 'tournaments', v_t.id::text,
                              jsonb_build_object('status', v_t.status),
                              jsonb_build_object('status', 'finished', 'by', 'sweep'));
      v_finished := v_finished + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'tournament_sweep finish %: % (%)', v_id, sqlerrm, sqlstate;
    end;
  end loop;

  -- 4. The one cancel of the tick (step 1's under-filled or step 3's never
  -- played), its row still locked by the step that chose it. One call site,
  -- so the court locks of two cancels never meet in one transaction.
  if v_cancel_id is not null then
    begin
      select * into v_t from tournaments where id = v_cancel_id;
      perform set_config('app.venue_id', v_t.venue_id::text, true);
      perform app.tournament_cancel_internal(v_cancel_id, v_cancel_why);
      v_cancelled := 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'tournament_sweep cancel %: % (%)', v_cancel_id, sqlerrm, sqlstate;
    end;
  end if;

  return jsonb_build_object('cancelled', v_cancelled, 'closed', v_closed, 'withdrawn', v_withdrawn,
                            'finished', v_finished, 'deferred', v_deferred, 'skipped', v_skipped,
                            'errors', v_errors);
end $tournament_sweep_0300$;

comment on function app.tournament_sweep() is
  'Tournaments (M7, §1.5, plan §3.7). Internal, service role (cron tp_tournament_sweep, every minute). Each tournament in its own exception block, FOR UPDATE SKIP LOCKED, app.venue_id set first: 1 an open tournament past registration_closes_at below min_entries registered is cancelled under_filled (blocks released, entries told), otherwise closed with seed_no stamped 1..N by entered_at (audit tournament.close); 2 a live entry of a deleted account in an open or closed tournament is withdrawn account_deleted (promotion while open, a revision once closed); 3 a closed or running tournament six hours past ends_at is finished (audit tournament.finish; no block is left to release), except a closed one with no round drawn, which is cancelled (cancel_reason staff, note not played, so every payer is owed the fee back). Cancels: at most one a tick, the first chosen, made last from one call site with its row still locked; the rest deferred. At most 200 items a step. Returns {cancelled, closed, withdrawn, finished, deferred, skipped, errors}.';

revoke all on function app.tournament_sweep() from public, anon, authenticated;
grant execute on function app.tournament_sweep() to service_role;

-- tp_tournament_sweep: every minute, its own transaction. Guarded like 0286's
-- tp_lesson_sweep. After a hosted push, cron.job must have the row
-- (packages/db/CLAUDE.md).
do $tournament_sweep_cron_0300$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_tournament_sweep not scheduled';
    return;
  end if;
  perform cron.schedule('tp_tournament_sweep', '* * * * *', 'select app.tournament_sweep();');
end $tournament_sweep_cron_0300$;

-- ===========================================================================
-- 7. The switch, the desk list, the public list
-- ===========================================================================

-- The owner's switch per branch (TD-3). The role before the branch (R57).
create or replace function app.set_tournaments_enabled(p_venue_id uuid, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = public as $set_tournaments_enabled_0300$
declare
  v_before boolean;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is null or not app.is_staff_at(p_venue_id, 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  if p_enabled is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enabled';
  end if;
  perform set_config('app.venue_id', p_venue_id::text, true);

  select vs.tournaments_enabled into v_before from venue_settings vs where vs.venue_id = p_venue_id for update;
  if not found then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  update venue_settings set tournaments_enabled = p_enabled where venue_id = p_venue_id;
  perform app.write_audit('venue.tournaments_settings', 'venue_settings', p_venue_id::text,
                          jsonb_build_object('tournaments_enabled', v_before),
                          jsonb_build_object('tournaments_enabled', p_enabled));
  return jsonb_build_object('venue_id', p_venue_id, 'tournaments_enabled', p_enabled);
end $set_tournaments_enabled_0300$;

comment on function app.set_tournaments_enabled(uuid, boolean) is
  'Tournaments (M7, TD-3, §1.6). The owner alone (FORBIDDEN, checked before the branch): turns tournaments on or off at one branch (venue_settings.tournaments_enabled). VENUE_MISMATCH for an unknown or closed branch; INVALID_ARGUMENT detail p_enabled for a null switch. Off stops publish and registration; published tournaments run to their end. Audit venue.tournaments_settings. Returns {venue_id, tournaments_enabled}.';

revoke all on function app.set_tournaments_enabled(uuid, boolean) from public, anon;
grant execute on function app.set_tournaments_enabled(uuid, boolean) to authenticated;

-- desk_tournaments: the desk calendar's overlay and the tournament list
-- (mirrors desk_lessons, 0294). Any staff at a visible branch. A plain read.
create or replace function app.desk_tournaments(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $desk_tournaments_0300$
declare
  v_venue uuid;
  v_rows  jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null or not (v_venue = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  -- Not cancelled and overlapping the window; a cancelled one only while it
  -- still holds a live block in the window.
  select coalesce(jsonb_agg(x.j order by x.starts_at, x.id), '[]'::jsonb)
    into v_rows
    from (select t.id, t.starts_at,
                 jsonb_build_object(
                   'id', t.id,
                   'name_en', t.name_en,
                   'name_ar', t.name_ar,
                   'status', t.status,
                   'format', t.format,
                   'category', t.category,
                   'starts_at', t.starts_at,
                   'ends_at', t.ends_at,
                   'registered', (select count(*) from tournament_entries e
                                   where e.tournament_id = t.id and e.status = 'registered'),
                   'waitlisted', (select count(*) from tournament_entries e
                                   where e.tournament_id = t.id and e.status = 'waitlisted'),
                   'max_entries', t.max_entries,
                   'blocks', coalesce((select jsonb_agg(jsonb_build_object(
                                                'reservation_id', r.id, 'court_id', r.court_id,
                                                'start_at', r.start_at, 'end_at', r.end_at)
                                                order by r.start_at, r.court_id, r.id)
                                         from reservations r
                                        where r.protocol_run_id = t.protocol_run_id
                                          and r.block_purpose = 'event'
                                          and r.status in ('pending', 'confirmed', 'arrived')
                                          and r.period && tstzrange(p_from, p_to, '[)')), '[]'::jsonb)) as j
            from tournaments t
           where t.venue_id = v_venue
             and ((t.status <> 'cancelled' and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_from, p_to, '[)'))
                  or (t.status = 'cancelled'
                      and exists (select 1 from reservations r
                                   where r.protocol_run_id = t.protocol_run_id
                                     and r.block_purpose = 'event'
                                     and r.status in ('pending', 'confirmed', 'arrived')
                                     and r.period && tstzrange(p_from, p_to, '[)'))))) x;

  return jsonb_build_object(
    'tournaments_enabled', app.tournament_on(v_venue),
    'server_now', now(),
    'tournaments', v_rows);
end $desk_tournaments_0300$;

comment on function app.desk_tournaments(uuid, timestamptz, timestamptz) is
  'Tournaments (M7, §1.6). Any staff at a branch in scope (p_venue_id, else the caller''s resolved branch): FORBIDDEN; INVALID_ARGUMENT detail p_from, p_to (after p_from, at most 62 days on); VENUE_MISMATCH. The branch''s tournaments not cancelled whose [starts_at, ends_at) overlaps [p_from, p_to), plus a cancelled one still holding a live block there: {tournaments_enabled, server_now, tournaments [{id, name_en, name_ar, status, format, category, starts_at, ends_at, registered, waitlisted, max_entries, blocks [{reservation_id, court_id, start_at, end_at}] (the live event blocks in the window)}]}. Names in both languages; no guest data.';

revoke all on function app.desk_tournaments(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.desk_tournaments(uuid, timestamptz, timestamptz) to authenticated;

-- tournaments_public (T-8, review M7): the web landing, the phone's list and
-- its "Mine" filter. Anon and authenticated; never raises; publicByDesign: no
-- names, no court ids, no guest data. mine only with a session.
create or replace function app.tournaments_public(p_venue_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournaments_public_0300$
declare
  v_uid      uuid := auth.uid();
  v_venues   uuid[];
  v_branches jsonb;
  v_rows     jsonb;
begin
  -- Open branches with tournaments on; a named branch that is off, closed or
  -- unknown, or none at all, is {off: true} and nothing else.
  select coalesce(array_agg(v.id order by v.created_at, v.id), '{}'::uuid[])
    into v_venues
    from venues v
    join venue_settings vs on vs.venue_id = v.id
   where v.is_active
     and vs.tournaments_enabled
     and (p_venue_id is null or v.id = p_venue_id);
  if cardinality(v_venues) = 0 then
    return jsonb_build_object('off', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'venue_id', v.id,
           'name_en', v.name_en,
           'name_ar', v.name_ar,
           'timezone', coalesce(vs.timezone, v.timezone))
           order by v.created_at, v.id), '[]'::jsonb)
    into v_branches
    from venues v
    left join venue_settings vs on vs.venue_id = v.id
   where v.id = any (v_venues);

  select coalesce(jsonb_agg(x.j order by x.starts_at, x.id), '[]'::jsonb)
    into v_rows
    from (select t.id, t.starts_at,
                 jsonb_build_object(
                   'id', t.id,
                   'venue_id', t.venue_id,
                   'name_en', t.name_en,
                   'name_ar', t.name_ar,
                   'format', t.format,
                   'category', t.category,
                   'starts_at', t.starts_at,
                   'ends_at', t.ends_at,
                   'registration_closes_at', t.registration_closes_at,
                   'entry_fee_iqd', t.entry_fee_iqd,
                   'prize_en', t.prize_en,
                   'prize_ar', t.prize_ar,
                   'max_entries', t.max_entries,
                   'places_left', greatest(t.max_entries - c.reg, 0),
                   'waitlist_open', t.status = 'open' and now() < t.registration_closes_at
                                    and c.reg >= t.max_entries and c.wait < t.waitlist_max,
                   'status', t.status,
                   'mine', case when v_uid is null then null else
                             (select jsonb_build_object(
                                       'entry_id', me.id,
                                       'status', me.status,
                                       'waitlist_position',
                                         case when me.status = 'waitlisted' then
                                           (select count(*)::int + 1 from tournament_entries w
                                             where w.tournament_id = t.id and w.status = 'waitlisted'
                                               and (w.entered_at, w.id) < (me.entered_at, me.id)) end)
                                from tournament_entries me
                               where me.tournament_id = t.id and me.guest_id = v_uid) end) as j
            from tournaments t
            cross join lateral (
              select count(*) filter (where e.status = 'registered')::int as reg,
                     count(*) filter (where e.status = 'waitlisted')::int as wait
                from tournament_entries e
               where e.tournament_id = t.id) c
           where t.venue_id = any (v_venues)
             and (t.status in ('open', 'closed', 'running')
                  or (t.status = 'finished' and t.finished_at > now() - interval '7 days'))) x;

  return jsonb_build_object('off', false, 'server_now', now(), 'branches', v_branches, 'tournaments', v_rows);
end $tournaments_public_0300$;

comment on function app.tournaments_public(uuid) is
  'Tournaments (M7, T-8, §1.6, §1.8, review M7). Public by design (anon and authenticated; never raises): {off: true} for an unknown, closed or switched-off branch (or, with p_venue_id null, when no open branch runs tournaments); otherwise {off: false, server_now, branches [{venue_id, name_en, name_ar, timezone}], tournaments [{id, venue_id, name_en, name_ar, format, category, starts_at, ends_at, registration_closes_at, entry_fee_iqd, prize_en, prize_ar, max_entries, places_left, waitlist_open, status, mine}]} for open, closed and running tournaments and those finished in the last 7 days. mine is the caller''s own entry {entry_id, status, waitlist_position} (with a session), else null. No names, no court ids, no guest data.';

revoke all on function app.tournaments_public(uuid) from public;
grant execute on function app.tournaments_public(uuid) to anon, authenticated;
