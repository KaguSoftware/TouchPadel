set lock_timeout = '3s';
set statement_timeout = '60s';

-- tournaments_money_lifecycle — the tournaments review fixes (money and
-- lifecycle), plan ~/.claude/plans/go-over-the-backend-partitioned-metcalfe.md
-- §0310. Re-issues only from each function's latest body:
--
--   c10 app.tournament_entry_money (0299): a waitlisted entry still holding
--       money once registration has closed is due it back.
--   c29 app.tournament_release_blocks (0300): blocks already running end now
--       (court-id order under app.lock_court), so a finish frees its courts.
--   c24 app.tournament_close_internal (new; the sweep's cut-off) and the
--       desk's app.tournament_close (court_desk, manager, owner; before the
--       cut-off a manager or the owner only).
--   c28 app.tournament_finish (new; manager, owner): a running tournament
--       ends early at its last complete round, its courts released.
--   s0  tournament_cancel, tournament_register (0300) and
--       tournament_set_rounds (0301): the branch is checked before the
--       tournament row is locked.
--   c25 app.tournament_add_entry (0300): refused while running
--       (TOURNAMENT_NOT_OPEN detail running), and s0.
--   c39 app.tournament_sweep (0300): a failed cancel no longer holds the
--       tick's one cancel (tournaments.sweep_error_at, sweep_errors); step 1
--       closes through tournament_close_internal (c24).
--   c9  app.desk_tournaments (0300) also lists a cancelled or finished
--       tournament still owing entry money (and a cancel in the window),
--       with refund_due_iqd; new app.tournament_refunds_due (manager, owner);
--       app.desk_tournament_detail (0301) gives each entry its payments and
--       can.close / can.finish.
--   c41 app.refund (0281): a tournament tab takes the tournament (share) and
--       the entry before the tab, and refunds at most refund_due_iqd unless
--       the reason is tournament_goodwill (REFUND_EXCEEDS_DUE).
--   c40 app.close_branch (0280): refused while the branch has a live
--       tournament (detail tournaments) or entry money due back (detail
--       tournament_money).
--
-- New codes: TOURNAMENT_UNDER_FILLED (close), TOURNAMENT_FINISH_REFUSED
-- (finish). Lock order: tournaments -> entries -> rounds and matches -> courts
-- (court-id order) -> reservations, as 0300/0301; app.refund takes the
-- tournament (share) and the entry where the lesson branch takes the coach
-- mutex, before tabs, as tournament_settle does.

-- ===========================================================================
-- 0. The sweep's failure stamp (c39)
-- ===========================================================================
alter table tournaments add column if not exists sweep_error_at timestamptz;
alter table tournaments add column if not exists sweep_errors int not null default 0;

comment on column tournaments.sweep_error_at is
  'Tournaments (0310, c39). When the sweep''s cancel of this tournament last failed (NULL: never). The sweep tries a tournament with no failure first, then the oldest failure.';
comment on column tournaments.sweep_errors is
  'Tournaments (0310, c39). How many times the sweep''s cancel of this tournament has failed (shown on desk_tournament_detail).';


-- ===========================================================================
-- 1. app.tournament_entry_money (c10), re-issued from 0299:442
-- ===========================================================================
create or replace function app.tournament_entry_money(p_entry_id uuid, p_exclude_tab_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_entry_money_0310$
declare
  v_e        tournament_entries%rowtype;
  v_t        tournaments%rowtype;
  v_paid     bigint;
  v_refunded bigint;
  v_online   bigint := 0;   -- the Qi seam (T-2): no online entry money in v1
  v_net      bigint;
  v_payable  boolean;
  v_owed     bigint;
  v_due      bigint;
begin
  select * into v_e from tournament_entries where id = p_entry_id;
  if not found then
    return null;
  end if;
  select * into v_t from tournaments where id = v_e.tournament_id;

  select coalesce(sum(p.amount_iqd), 0) into v_paid
    from payments p
    join tabs t on t.id = p.tab_id
   where t.kind = 'tournament'
     and t.tournament_entry_id = v_e.id
     and t.status = 'settled'
     and t.merged_into_tab_id is null
     and t.id is distinct from p_exclude_tab_id;

  select coalesce(sum(rf.amount_iqd), 0) into v_refunded
    from refunds rf
    join payments p on p.id = rf.payment_id
    join tabs t on t.id = p.tab_id
   where t.kind = 'tournament'
     and t.tournament_entry_id = v_e.id
     and t.status = 'settled'
     and t.merged_into_tab_id is null
     and t.id is distinct from p_exclude_tab_id;

  v_net := v_paid - v_refunded + v_online;
  v_payable := v_e.status = 'registered' and v_t.status <> 'cancelled';
  v_owed := case when v_payable then greatest(v_t.entry_fee_iqd - v_net, 0) else 0 end;
  -- 0310 (c10): a waitlisted entry still holding money once registration has
  -- closed (it came back from a withdrawal onto a full field) will never be
  -- seated: its money is due back like a withdrawn entry's.
  v_due := case when v_e.status = 'withdrawn' or v_t.status = 'cancelled'
                     or (v_e.status = 'waitlisted' and v_t.status in ('closed', 'running', 'finished'))
                then v_net else 0 end;

  return jsonb_build_object(
    'entry_id',          v_e.id,
    'tournament_id',     v_t.id,
    'entry_status',      v_e.status,
    'tournament_status', v_t.status,
    'fee_iqd',           v_t.entry_fee_iqd,
    'desk_paid_iqd',     v_paid,
    'desk_refunded_iqd', v_refunded,
    'online_paid_iqd',   v_online,
    'net_iqd',           v_net,
    'payable',           v_payable,
    'owed_iqd',          v_owed,
    'refund_due_iqd',    v_due);
end $tournament_entry_money_0310$;

comment on function app.tournament_entry_money(uuid, uuid) is
  'Tournaments (M7, build contracts §1.7, S2, S3; 0310 c10). Internal: the money of one entry, tab p_exclude_tab_id left out: {entry_id, tournament_id, entry_status, tournament_status, fee_iqd, desk_paid_iqd (payments on its settled, unmerged tournament tabs), desk_refunded_iqd (refunds on those payments), online_paid_iqd (0, the Qi seam), net_iqd, payable (registered, tournament not cancelled), owed_iqd (payable ? max(0, fee - net) : 0), refund_due_iqd (net when withdrawn, the tournament cancelled, or (0310) waitlisted once the tournament is closed, running or finished; else 0)}. NULL for an unknown entry. Stable, no locks, no name, phone or guest id. Key list: TOURNAMENT_SHAPES.tournament_entry_money (packages/core/src/tournaments/shapes.ts).';

-- ===========================================================================
-- 2. app.tournament_release_blocks (c29), re-issued from 0300:331
-- ===========================================================================
create or replace function app.tournament_release_blocks(p_tournament_id uuid, p_note text)
returns int
language plpgsql security definer set search_path = public as $tournament_release_blocks_0310$
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

  -- 0310 (c29): every live block that has not ended, the running ones too.
  for v_court in
    select distinct r.court_id
      from reservations r
     where r.protocol_run_id = v_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived') and r.end_at > now()
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

  -- 0310 (c29): a block already running ends now (at least a minute after it
  -- began), so the courts the tournament no longer needs are bookable at once.
  for v_res in
    update reservations r
       set end_at = greatest(now(), r.start_at + interval '1 minute')
     where r.protocol_run_id = v_run_id and r.block_purpose = 'event'
       and r.status in ('pending', 'confirmed', 'arrived')
       and r.start_at <= now() and r.end_at > greatest(now(), r.start_at + interval '1 minute')
    returning r.*
  loop
    v_n := v_n + 1;
    perform app.write_audit('reservation.shorten', 'reservations', v_res.id::text, null,
      jsonb_build_object('end_at', v_res.end_at, 'protocol_run_id', v_run_id, 'tournament_id', p_tournament_id));
  end loop;
  return v_n;
end $tournament_release_blocks_0310$;

comment on function app.tournament_release_blocks(uuid, text) is
  'Tournaments (M7, §1.5; 0310 c29). Internal: cancels the tournament run''s live event blocks that have not started and ends the ones already running now (end_at = greatest(now(), start_at + 1 minute)); courts locked in court-id order first; cancellation_reason p_note; audit reservation.cancel or reservation.shorten per block. Called by cancel and finish only after the status change. Returns the blocks cancelled or shortened.';

-- ===========================================================================
-- 3. Close (c24) and finish (c28): new
-- ===========================================================================
-- The one close of registration (c24): the sweep's cut-off and the desk's
-- tournament_close. The caller holds the tournament row FOR UPDATE and has
-- checked it is open with at least min_entries registered. Seeds 1..N by
-- entered_at. Returns the registered count.
create or replace function app.tournament_close_internal(p_tournament_id uuid, p_by text)
returns int
language plpgsql security definer set search_path = public as $tournament_close_internal_0310$
declare
  v_reg int;
begin
  if p_by is null or p_by not in ('sweep', 'staff') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_by';
  end if;
  update tournaments set status = 'closed', closed_at = now(), updated_at = now()
   where id = p_tournament_id and status = 'open';
  if not found then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  update tournament_entries e
     set seed_no = s.n, updated_at = now()
    from (select x.id, row_number() over (order by x.entered_at, x.id) as n
            from tournament_entries x
           where x.tournament_id = p_tournament_id and x.status = 'registered') s
   where e.id = s.id;
  get diagnostics v_reg = row_count;
  perform app.write_audit('tournament.close', 'tournaments', p_tournament_id::text,
                          jsonb_build_object('status', 'open'),
                          jsonb_build_object('status', 'closed', 'registered', v_reg, 'by', p_by));
  return v_reg;
end $tournament_close_internal_0310$;

comment on function app.tournament_close_internal(uuid, text) is
  'Tournaments (0310, c24). Internal: an open tournament becomes closed (closed_at) with seed_no stamped 1..N by entered_at over its registered entries; audit tournament.close {status, registered, by (sweep or staff)}. TOURNAMENT_NOT_OPEN detail status when it is not open. The caller holds the tournament row FOR UPDATE and has checked min_entries. Returns the registered count.';

revoke all on function app.tournament_close_internal(uuid, text) from public, anon, authenticated;

-- tournament_close (c24): the desk closes registration itself, so a missing or
-- failing sweep never leaves a tournament unplayable. Past the cut-off the
-- court desk may; before it only a manager or the owner (an early close).
-- State-idempotent: a closed tournament answers duplicate. Lock order:
-- tournaments FOR UPDATE -> entries.
create or replace function app.tournament_close(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_close_0310$
declare
  v_t   tournaments%rowtype;
  v_reg int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  select * into v_t from tournaments where id = v_t.id for update;

  if v_t.status = 'closed' then
    return jsonb_build_object('tournament_id', v_t.id, 'status', v_t.status, 'duplicate', true,
                              'registered', (select count(*) from tournament_entries e
                                              where e.tournament_id = v_t.id and e.status = 'registered'));
  end if;
  if v_t.status <> 'open' then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  if now() < v_t.registration_closes_at and not app.is_staff_at(v_t.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'early_close',
      hint = 'registration is still open; a manager can close it early';
  end if;
  select count(*) into v_reg from tournament_entries e where e.tournament_id = v_t.id and e.status = 'registered';
  if v_reg < v_t.min_entries then
    raise exception 'TOURNAMENT_UNDER_FILLED' using errcode = 'P0001',
      detail = format('%s/%s', v_reg, v_t.min_entries),
      hint = 'fewer players than the minimum; add players or cancel the tournament';
  end if;

  v_reg := app.tournament_close_internal(v_t.id, 'staff');
  return jsonb_build_object('tournament_id', v_t.id, 'status', 'closed', 'duplicate', false, 'registered', v_reg);
end $tournament_close_0310$;

comment on function app.tournament_close(uuid) is
  'Tournaments (0310, c24). The court desk, managers and the owner at the tournament''s branch close its registration (the sweep''s cut-off, by hand): FORBIDDEN (detail early_close: before registration_closes_at, below manager); TOURNAMENT_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH; TOURNAMENT_NOT_OPEN detail status (not open); TOURNAMENT_UNDER_FILLED (detail <registered>/<min_entries>: cancel instead). A closed tournament answers duplicate true. Seeds stamped 1..N by entered_at (app.tournament_close_internal); audit tournament.close by staff. Returns {tournament_id, status, duplicate, registered}.';

revoke all on function app.tournament_close(uuid) from public, anon;
grant execute on function app.tournament_close(uuid) to authenticated;

-- tournament_finish (c28, c29): a manager ends a running tournament early (a
-- Mexicano with too few players left, the venue out of time) instead of
-- cancelling it, which would owe every payer back. The rounds after the last
-- fully scored one are deleted (a round with a score after it refuses: score
-- or forfeit its open matches first), rounds_planned becomes that round, and
-- the courts are released (the running blocks end now). Lock order:
-- tournaments FOR UPDATE -> rounds and matches -> courts (court-id order) ->
-- reservations.
create or replace function app.tournament_finish(p_tournament_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_finish_0310$
declare
  v_t        tournaments%rowtype;
  v_reason   text := nullif(btrim(p_reason), '');
  v_open     int;
  v_last     int;
  v_k        int;
  v_removed  int;
  v_n        int;
  v_released int;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = p_tournament_id;
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
  select * into v_t from tournaments where id = v_t.id for update;
  if v_t.status <> 'running' then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;

  -- The last complete round: every round before the first one with an
  -- unscored match (or no match at all). Rounds are contiguous from 1.
  select min(r.round_no) into v_open
    from tournament_rounds r
   where r.tournament_id = v_t.id
     and (not exists (select 1 from tournament_matches m where m.round_id = r.id)
          or exists (select 1 from tournament_matches m where m.round_id = r.id and m.points_a is null));
  select coalesce(max(r.round_no), 0) into v_last from tournament_rounds r where r.tournament_id = v_t.id;
  v_k := coalesce(v_open - 1, v_last);
  if v_k < 1 then
    raise exception 'TOURNAMENT_FINISH_REFUSED' using errcode = 'P0001', detail = 'not_played',
      hint = 'no round has been fully played; cancel the tournament instead';
  end if;
  if exists (select 1 from tournament_matches m
              where m.tournament_id = v_t.id and m.round_no > v_k and m.points_a is not null) then
    raise exception 'TOURNAMENT_FINISH_REFUSED' using errcode = 'P0001', detail = 'partial_round',
      hint = format('round %s has begun: score or forfeit its open matches first', v_k + 1);
  end if;

  delete from tournament_rounds r where r.tournament_id = v_t.id and r.round_no > v_k;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_removed := v_k + 1;
  end if;

  update tournaments
     set status = 'finished', finished_at = now(), rounds_planned = v_k, revision = revision + 1,
         updated_at = now()
   where id = v_t.id
  returning * into v_t;
  v_released := app.tournament_release_blocks(v_t.id, 'Tournament finished');
  perform app.write_audit('tournament.finish', 'tournaments', v_t.id::text,
                          jsonb_build_object('status', 'running'),
                          jsonb_build_object('status', 'finished', 'by', 'staff', 'rounds_planned', v_k,
                                             'removed_from_round', v_removed, 'blocks_released', v_released),
                          left(v_reason, 300));
  return jsonb_build_object('tournament_id', v_t.id, 'status', 'finished', 'rounds_planned', v_k,
                            'removed_from_round', v_removed, 'blocks_released', v_released,
                            'revision', v_t.revision);
end $tournament_finish_0310$;

comment on function app.tournament_finish(uuid, text) is
  'Tournaments (0310, c28, c29). Managers and the owner at the tournament''s branch end a running tournament early: FORBIDDEN; TOURNAMENT_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH; REASON_REQUIRED (kept in the audit row); TOURNAMENT_NOT_OPEN detail status (not running); TOURNAMENT_FINISH_REFUSED detail not_played (no round fully scored: cancel instead) or partial_round (a round after the last complete one has a score: score or forfeit its open matches first). The rounds after the last complete one are deleted (removed_from_round), rounds_planned becomes it, the tournament is finished (finished_at, revision + 1) and its courts released (app.tournament_release_blocks: future blocks cancelled, running ones end now). Paying players keep their places, so only withdrawn (and late-waitlisted) entries are due money back. Audit tournament.finish {by staff}. Returns {tournament_id, status, rounds_planned, removed_from_round, blocks_released, revision}.';

revoke all on function app.tournament_finish(uuid, text) from public, anon;
grant execute on function app.tournament_finish(uuid, text) to authenticated;

-- ===========================================================================
-- 4. tournament_cancel (s0), re-issued from 0300:847
-- ===========================================================================
create or replace function app.tournament_cancel(p_tournament_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_cancel_0310$
declare
  v_t      tournaments%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0310 (s0): the branch is checked before the row is locked.
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  select * into v_t from tournaments where id = v_t.id for update;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if v_t.status not in ('open', 'closed', 'running') then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;

  return app.tournament_cancel_internal(v_t.id, 'staff: ' || v_reason);
end $tournament_cancel_0310$;

-- ===========================================================================
-- 5. tournament_register (s0), re-issued from 0300:888
-- ===========================================================================
create or replace function app.tournament_register(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_register_0310$
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
end $tournament_register_0310$;

-- ===========================================================================
-- 6. tournament_add_entry (c25, s0), re-issued from 0300:1039
-- ===========================================================================
create or replace function app.tournament_add_entry(p_tournament_id uuid, p_guest_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_add_entry_0310$
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
  if v_t.status not in ('open', 'closed', 'running') then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'status';
  end if;
  -- 0310 (c25): the drawn rounds would never seat a player added while the
  -- play is on; a missing player is replaced through mark_no_show instead.
  if v_t.status = 'running' then
    raise exception 'TOURNAMENT_NOT_OPEN' using errcode = 'P0001', detail = 'running',
      hint = 'the play has begun: mark a no-show with this guest as the substitute';
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

  v_play := v_t.status = 'closed';
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
end $tournament_add_entry_0310$;

comment on function app.tournament_add_entry(uuid, uuid) is
  'Tournaments (M7, T-4, §1.6, review M1; 0310 c25, s0). The court desk, managers and the owner at the tournament''s branch add a guest profile (a walk-in made through desk-customer-create) while the tournament is open or closed. FORBIDDEN; TOURNAMENT_NOT_FOUND; VENUE_MISMATCH (both before the row lock, 0310); TOURNAMENT_NOT_OPEN detail status (finished, cancelled) or running (0310: the drawn rounds would never seat them; mark a no-show with the guest as substitute instead); INVALID_ARGUMENT detail p_guest_id (unknown or deleted profile) or entry_status (a no-show); MATCH_BANNED; GENDER_REQUIRED (a women or men tournament and no gender); TOURNAMENT_CATEGORY_MISMATCH. No phone or terms check (the desk vouches). registered while a place is free, else waitlisted, else TOURNAMENT_FULL; a waitlisted guest is promoted when a place is free; a registered one (or a waitlisted one with no place) answers duplicate true. Once closed a new registered entry takes the next seed_no and moves the revision. Audit tournament.add_entry. Returns {entry_id, status, waitlist_position, duplicate}.';

-- ===========================================================================
-- 7. tournament_set_rounds (s0), re-issued from 0301:30
-- ===========================================================================
create or replace function app.tournament_set_rounds(p_tournament_id uuid, p_payload jsonb, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $tournament_set_rounds_0310$
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
end $tournament_set_rounds_0310$;

-- ===========================================================================
-- 8. tournament_sweep (c24, c39), re-issued from 0300:1257
-- ===========================================================================
create or replace function app.tournament_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $tournament_sweep_0310$
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
  v_cancel_err timestamptz;   -- 0310 (c39): when the chosen cancel last failed
begin
  -- 1. The cut-off.
  for v_id in
    select t.id from tournaments t
     where t.status = 'open' and t.registration_closes_at <= now()
     order by t.sweep_error_at nulls first, t.registration_closes_at, t.id
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
        -- 0310 (c39): a tournament whose cancel has never failed goes before
        -- one whose cancel failed, and of those the one that failed longest
        -- ago, so one failing cancel never holds the tick's slot for good.
        if v_cancel_id is not null
           and not (v_cancel_err is not null
                    and (v_t.sweep_error_at is null or v_t.sweep_error_at < v_cancel_err)) then
          v_deferred := v_deferred + 1;
          continue;
        end if;
        if v_cancel_id is not null then
          v_deferred := v_deferred + 1;
        end if;
        -- Kept locked; cancelled in step 4.
        v_cancel_id := v_t.id;
        v_cancel_err := v_t.sweep_error_at;
        v_cancel_why := 'under_filled';
      else
        -- 0310 (c24): the one close, shared with the desk's tournament_close.
        perform app.tournament_close_internal(v_t.id, 'sweep');
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
     order by t.sweep_error_at nulls first, t.ends_at, t.id
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
        if v_cancel_id is not null
           and not (v_cancel_err is not null
                    and (v_t.sweep_error_at is null or v_t.sweep_error_at < v_cancel_err)) then
          v_deferred := v_deferred + 1;
          continue;
        end if;
        if v_cancel_id is not null then
          v_deferred := v_deferred + 1;
        end if;
        v_cancel_id := v_t.id;
        v_cancel_err := v_t.sweep_error_at;
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
      -- 0310 (c39): marked, so the next tick tries the others first; the
      -- count shows on the desk's detail.
      begin
        update tournaments
           set sweep_error_at = now(), sweep_errors = sweep_errors + 1
         where id = v_cancel_id;
      exception when others then
        raise warning 'tournament_sweep mark %: % (%)', v_cancel_id, sqlerrm, sqlstate;
      end;
    end;
  end if;

  return jsonb_build_object('cancelled', v_cancelled, 'closed', v_closed, 'withdrawn', v_withdrawn,
                            'finished', v_finished, 'deferred', v_deferred, 'skipped', v_skipped,
                            'errors', v_errors);
end $tournament_sweep_0310$;

comment on function app.tournament_sweep() is
  'Tournaments (M7, §1.5, plan §3.7; 0310 c24, c39). Internal, service role (cron tp_tournament_sweep, every minute). Each tournament in its own exception block, FOR UPDATE SKIP LOCKED, app.venue_id set first: 1 an open tournament past registration_closes_at below min_entries registered is cancelled under_filled (blocks released, entries told), otherwise closed through app.tournament_close_internal (seed_no 1..N by entered_at, audit tournament.close by sweep); 2 a live entry of a deleted account in an open or closed tournament is withdrawn account_deleted (promotion while open, a revision once closed); 3 a closed or running tournament six hours past ends_at is finished (audit tournament.finish), except a closed one with no round drawn, which is cancelled (cancel_reason staff, note not played, so every payer is owed the fee back). Cancels: at most one a tick, made last from one call site with its row still locked; the rest deferred. 0310: a tournament whose cancel never failed is chosen before one whose cancel failed (tournaments.sweep_error_at, oldest failure first), and a failed cancel stamps sweep_error_at and sweep_errors + 1, so one failing cancel never starves the others. At most 200 items a step. Returns {cancelled, closed, withdrawn, finished, deferred, skipped, errors}.';

-- ===========================================================================
-- 9. desk_tournaments (c9), re-issued from 0300:1476
-- ===========================================================================
create or replace function app.desk_tournaments(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $desk_tournaments_0310$
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
  -- still holds a live block in the window. 0310 (c9): also a cancelled one
  -- cancelled in the window, and a cancelled or finished one (at any date)
  -- whose entries are still due money back at the till, until it is refunded.
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
                   'refund_due_iqd', rd.due,
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
            cross join lateral (
              select coalesce(sum((app.tournament_entry_money(e.id)->>'refund_due_iqd')::bigint), 0)::bigint as due
                from tournament_entries e
               where e.tournament_id = t.id
                 and exists (select 1 from tabs tb where tb.tournament_entry_id = e.id)) rd
           where t.venue_id = v_venue
             and ((t.status <> 'cancelled' and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_from, p_to, '[)'))
                  or (t.status = 'cancelled'
                      and exists (select 1 from reservations r
                                   where r.protocol_run_id = t.protocol_run_id
                                     and r.block_purpose = 'event'
                                     and r.status in ('pending', 'confirmed', 'arrived')
                                     and r.period && tstzrange(p_from, p_to, '[)')))
                  or (t.status = 'cancelled' and t.cancelled_at >= p_from and t.cancelled_at < p_to)
                  or (t.status in ('cancelled', 'finished') and rd.due > 0))) x;

  return jsonb_build_object(
    'tournaments_enabled', app.tournament_on(v_venue),
    'server_now', now(),
    'tournaments', v_rows);
end $desk_tournaments_0310$;

comment on function app.desk_tournaments(uuid, timestamptz, timestamptz) is
  'Tournaments (M7, §1.6; 0310 c9). Any staff at a branch in scope (p_venue_id, else the caller''s resolved branch): FORBIDDEN; INVALID_ARGUMENT detail p_from, p_to (after p_from, at most 62 days on); VENUE_MISMATCH. The branch''s tournaments not cancelled whose [starts_at, ends_at) overlaps [p_from, p_to), a cancelled one still holding a live block there or cancelled in the window, and (0310) any cancelled or finished one whose entries are still due money back: {tournaments_enabled, server_now, tournaments [{id, name_en, name_ar, status, format, category, starts_at, ends_at, registered, waitlisted, max_entries, refund_due_iqd (the sum its entries are due back at the till), blocks [{reservation_id, court_id, start_at, end_at}] (the live event blocks in the window)}]}. Names in both languages; no guest data.';

-- ===========================================================================
-- 10. tournament_refunds_due (c9): new
-- ===========================================================================
-- tournament_refunds_due (c9): the lesson_refunds_due twin (0292). Every entry
-- of the branch still due money back at the till, whatever its tournament's
-- date or status, with the payments to refund against. A plain read.
create or replace function app.tournament_refunds_due(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_refunds_due_0310$
declare
  v_venue uuid;
  v_items jsonb;
  v_total bigint;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null or not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  with cand as (
    select e.id, e.tournament_id, e.guest_id, e.status,
           (app.tournament_entry_money(e.id)->>'refund_due_iqd')::bigint as rd
      from tournament_entries e
     where e.venue_id = v_venue
       and exists (select 1 from tabs tb where tb.tournament_entry_id = e.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id',          c.id,
           'tournament_id',     t.id,
           'name_en',           t.name_en,
           'name_ar',           t.name_ar,
           'tournament_status', t.status,
           'starts_at',         t.starts_at,
           'cancelled_at',      t.cancelled_at,
           'entry_status',      c.status,
           'full_name',         p.full_name,
           'phone',             p.phone,
           'refund_due_iqd',    c.rd,
           'payments',          coalesce((
             select jsonb_agg(jsonb_build_object(
                      'payment_id',     py.id,
                      'tab_id',         tb.id,
                      'method',         py.method,
                      'amount_iqd',     py.amount_iqd,
                      'refunded_iqd',   coalesce(rf.refunded, 0),
                      'refundable_iqd', py.amount_iqd - coalesce(rf.refunded, 0),
                      'created_at',     py.created_at) order by py.created_at, py.id)
               from tabs tb
               join payments py on py.tab_id = tb.id
               left join lateral (select sum(x.amount_iqd)::bigint as refunded
                                    from refunds x where x.payment_id = py.id) rf on true
              where tb.tournament_entry_id = c.id and tb.kind = 'tournament'
                and tb.status = 'settled' and tb.merged_into_tab_id is null), '[]'::jsonb))
           order by t.starts_at, t.id, c.id), '[]'::jsonb),
         coalesce(sum(c.rd), 0)::bigint
    into v_items, v_total
    from cand c
    join tournaments t on t.id = c.tournament_id
    left join profiles p on p.id = c.guest_id
   where c.rd > 0;

  return jsonb_build_object('venue_id', v_venue, 'total_iqd', v_total, 'items', v_items);
end $tournament_refunds_due_0310$;

comment on function app.tournament_refunds_due(uuid) is
  'Tournaments (0310, c9). Manager or owner at the branch (p_venue_id, default the caller''s resolved branch; the role first, R57): the tournament entry money the branch owes back at the till, whatever the tournament''s date or status. {venue_id, total_iqd, items [{entry_id, tournament_id, name_en, name_ar, tournament_status, starts_at, cancelled_at, entry_status, full_name, phone, refund_due_iqd (app.tournament_entry_money), payments [{payment_id, tab_id, method, amount_iqd, refunded_iqd, refundable_iqd, created_at}]}]}, earliest tournament first. Refunded with app.refund (up to refund_due_iqd unless the reason is tournament_goodwill). FORBIDDEN, VENUE_MISMATCH.';

revoke all on function app.tournament_refunds_due(uuid) from public, anon;
grant execute on function app.tournament_refunds_due(uuid) to authenticated;

-- ===========================================================================
-- 11. desk_tournament_detail (c9), re-issued from 0301:614
-- ===========================================================================
create or replace function app.desk_tournament_detail(p_tournament_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $desk_tournament_detail_0310$
declare
  v_t         tournaments%rowtype;
  v_tz        text;
  v_entries   jsonb;
  v_courts    jsonb;
  v_rounds    jsonb;
  v_standings jsonb;
  v_desk      boolean;
  v_mgmt      boolean;
  v_till      boolean;
begin
  -- The role first (R57): the entries carry every guest's name and phone.
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_t from tournaments where id = p_tournament_id;
  if not found or not (v_t.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'TOURNAMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select coalesce(vs.timezone, v.timezone) into v_tz
    from venues v left join venue_settings vs on vs.venue_id = v.id
   where v.id = v_t.venue_id;
  v_desk := app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner');
  v_mgmt := app.is_staff_at(v_t.venue_id, 'manager', 'owner');
  v_till := app.is_staff_at(v_t.venue_id, 'cashier', 'court_desk', 'manager', 'owner');

  -- Registered by seed (then entered_at), the waitlist in its order, then the rest.
  select coalesce(jsonb_agg(x.j order by x.k1, x.k2, x.k3, x.id), '[]'::jsonb)
    into v_entries
    from (select e.id,
                 case e.status when 'registered' then 0 when 'waitlisted' then 1 when 'no_show' then 2 else 3 end as k1,
                 coalesce(e.seed_no, 32767) as k2,
                 e.entered_at as k3,
                 jsonb_build_object(
                   'entry_id', e.id,
                   'guest_id', e.guest_id,
                   'full_name', p.full_name,
                   'phone', p.phone,
                   'status', e.status,
                   'seed_no', e.seed_no,
                   'waitlist_position',
                     case when e.status = 'waitlisted' then
                       (select count(*)::int + 1 from tournament_entries w
                         where w.tournament_id = e.tournament_id and w.status = 'waitlisted'
                           and (w.entered_at, w.id) < (e.entered_at, e.id)) end,
                   'added_by_kind', e.added_by_kind,
                   'owed_iqd', (m.money->>'owed_iqd')::bigint,
                   'net_paid_iqd', (m.money->>'net_iqd')::bigint,
                   'refund_due_iqd', (m.money->>'refund_due_iqd')::bigint,
                   'substitute_for', e.substitute_for,
                   -- 0310 (c9): the payments a refund is made against.
                   'payments', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'payment_id',     py.id,
                              'tab_id',         tb.id,
                              'method',         py.method,
                              'amount_iqd',     py.amount_iqd,
                              'refunded_iqd',   coalesce(rf.refunded, 0),
                              'refundable_iqd', py.amount_iqd - coalesce(rf.refunded, 0),
                              'created_at',     py.created_at) order by py.created_at, py.id)
                       from tabs tb
                       join payments py on py.tab_id = tb.id
                       left join lateral (select sum(x.amount_iqd)::bigint as refunded
                                            from refunds x where x.payment_id = py.id) rf on true
                      where tb.tournament_entry_id = e.id and tb.kind = 'tournament'
                        and tb.status = 'settled' and tb.merged_into_tab_id is null), '[]'::jsonb)) as j
            from tournament_entries e
            left join profiles p on p.id = e.guest_id
            cross join lateral (select app.tournament_entry_money(e.id) as money) m
           where e.tournament_id = v_t.id) x;

  -- The courts of the run's live adopted blocks.
  select coalesce(jsonb_agg(jsonb_build_object('court_id', c.id, 'name_en', c.name_en, 'name_ar', c.name_ar,
                                               'sort_order', c.sort_order)
                            order by c.sort_order, c.id), '[]'::jsonb)
    into v_courts
    from courts c
   where c.id in (select r.court_id from reservations r
                   where r.protocol_run_id = v_t.protocol_run_id and r.block_purpose = 'event'
                     and r.status in ('pending', 'confirmed', 'arrived'));

  select coalesce(jsonb_agg(jsonb_build_object(
           'round_no', r.round_no,
           'sit_out', to_jsonb(r.bye_entry_ids),
           'matches', coalesce((select jsonb_agg(jsonb_build_object(
                                         'match_id', m.id,
                                         'court_id', m.court_id,
                                         'a', jsonb_build_array(m.a1, m.a2),
                                         'b', jsonb_build_array(m.b1, m.b2),
                                         'points_a', m.points_a,
                                         'points_b', m.points_b,
                                         'revision', m.revision,
                                         'corrections', greatest((select count(*) from tournament_score_events s
                                                                   where s.match_id = m.id) - 1, 0))
                                         order by c.sort_order, c.id)
                                  from tournament_matches m
                                  join courts c on c.id = m.court_id
                                 where m.round_id = r.id), '[]'::jsonb))
           order by r.round_no), '[]'::jsonb)
    into v_rounds
    from tournament_rounds r
   where r.tournament_id = v_t.id;

  -- In the function's own order: a tie on rank goes by seed, then entry id.
  select coalesce(jsonb_agg(to_jsonb(s) order by s.rank, se.seed_no nulls last, s.entry_id), '[]'::jsonb)
    into v_standings
    from app.tournament_standings(v_t.id) s
    left join tournament_entries se on se.id = s.entry_id;

  return jsonb_build_object(
    'id', v_t.id,
    'venue_id', v_t.venue_id,
    'protocol_run_id', v_t.protocol_run_id,
    'name_en', v_t.name_en,
    'name_ar', v_t.name_ar,
    'format', v_t.format,
    'category', v_t.category,
    'class', v_t.class,
    'points_target', v_t.points_target,
    'rounds_planned', v_t.rounds_planned,
    'max_entries', v_t.max_entries,
    'min_entries', v_t.min_entries,
    'waitlist_max', v_t.waitlist_max,
    'entry_fee_iqd', v_t.entry_fee_iqd,
    'prize_en', v_t.prize_en,
    'prize_ar', v_t.prize_ar,
    'starts_at', v_t.starts_at,
    'ends_at', v_t.ends_at,
    'registration_closes_at', v_t.registration_closes_at,
    'status', v_t.status,
    'cancel_reason', v_t.cancel_reason,
    'revision', v_t.revision,
    'closed_at', v_t.closed_at,
    'finished_at', v_t.finished_at,
    'cancelled_at', v_t.cancelled_at,
    'sweep_errors', v_t.sweep_errors,
    'timezone', v_tz,
    'server_now', now(),
    'entries', v_entries,
    'courts', v_courts,
    'rounds', v_rounds,
    'standings', v_standings,
    'can', jsonb_build_object(
      'add', v_desk and v_t.status in ('open', 'closed'),
      'set_rounds', v_desk and v_t.status in ('closed', 'running'),
      'score', v_desk and v_t.status in ('running', 'finished'),
      'cancel', v_mgmt and v_t.status in ('open', 'closed', 'running'),
      'close', v_desk and v_t.status = 'open' and (v_mgmt or now() >= v_t.registration_closes_at),
      'finish', v_mgmt and v_t.status = 'running',
      'settle', v_till and v_t.status <> 'cancelled'));
end $desk_tournament_detail_0310$;

comment on function app.desk_tournament_detail(uuid) is
  'Tournaments (M7, §1.8; 0310). The cashier, the court desk, managers and the owner (the entries carry names and phones): FORBIDDEN; TOURNAMENT_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH (not one of those roles at its branch). The tournament''s fields and revision, sweep_errors (0310: failed sweep cancels), timezone, server_now; entries [{entry_id, guest_id, full_name, phone, status, seed_no, waitlist_position, added_by_kind, owed_iqd, net_paid_iqd, refund_due_iqd, substitute_for, payments [{payment_id, tab_id, method, amount_iqd, refunded_iqd, refundable_iqd, created_at}] (0310)}] (registered by seed, the waitlist in order, then the rest); courts [{court_id, name_en, name_ar, sort_order}] of the live adopted blocks; rounds [{round_no, sit_out [entry], matches [{match_id, court_id, a [entry, entry], b [entry, entry], points_a, points_b, revision, corrections}]}]; standings (app.tournament_standings); can {add (open or closed; 0310: not running), set_rounds, score, cancel, close (0310: open, past the cut-off or a manager), finish (0310: a manager, running), settle} for the caller''s role and the status.';

-- ===========================================================================
-- 12. app.refund (c41), re-issued from 0281:1102
-- ===========================================================================
create or replace function app.refund(
  p_payment_id      uuid,
  p_amount_iqd      bigint,
  p_pin             text,
  p_reason_code     text,
  p_items           jsonb default null,
  p_device_id       text  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0310$
declare
  v_venue uuid;
  v_auth     uuid;
  v_payment  payments%rowtype;
  v_tab_id   uuid;
  v_refunded bigint;
  v_refund   refunds%rowtype;
  v_item     jsonb;
  v_oi       order_items%rowtype;
  v_qty      int;
  v_replay   jsonb;
  v_result   jsonb;
  v_day      uuid;
  v_kind     text;    -- 0281 (R36)
  v_enrol    uuid;
  v_coach    uuid;
  v_m        jsonb;
  v_entry    uuid;    -- 0310 (c41)
  v_due      bigint;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the payment's branch decides the day, the rows written and who may act.
  v_venue := (select p.venue_id from payments p where p.id = p_payment_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- 0120: claim after the guards and before any write or lock (0049 pattern).
  -- A replay of the same key by the same caller returns the stored result
  -- here. 0139: it also spends the grant the replay worker minted for this
  -- dispatch, if there is one, so the station is not left holding a live
  -- authorisation for the next two minutes. Best effort — a duplicate must
  -- echo the stored result whatever the grant table says.
  v_replay := app.claim_replay(p_idempotency_key, 'refund');
  if v_replay is not null then
    begin
      perform app.consume_pin_grant(p_device_id);
    exception when others then
      null;
    end;
    return v_replay;
  end if;

  -- 0139: a refund is money leaving the till, so it needs an open day like
  -- settle_zero_tab and cancel_tab (0120) — a refund queued offline and
  -- replayed after close_day would otherwise land on a closed day.
  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- 0115: the PIN itself is no longer checked here. The caller proved it to
  -- app.verify_manager_pin a moment ago (its own transaction, so the attempt
  -- persisted either way) and holds a single-use grant; without one this raises
  -- PIN_GRANT_REQUIRED whatever p_pin says, so guessing here reveals nothing.
  v_auth := app.consume_pin_grant(p_device_id);

  -- 0281 (R36): a lesson tab's refund takes the coach mutex before the tab.
  -- The tab's kind, its enrolment and the enrolment's coach never change, so
  -- an unlocked read is sound.
  select t.kind, t.lesson_enrolment_id, t.tournament_entry_id into v_kind, v_enrol, v_entry
    from payments p
    join tabs t on t.id = p.tab_id
   where p.id = p_payment_id;
  if v_kind = 'lesson' then
    select coalesce(l.coach_id, c.coach_id) into v_coach
      from lesson_enrolments x
      left join lessons l on l.id = x.lesson_id
      left join courses c on c.id = x.course_id
     where x.id = v_enrol;
    perform app.lock_coach(v_coach);
  end if;
  -- 0310 (c41): a tournament tab's refund takes tournament_settle's order
  -- before the tab: the tournament FOR SHARE (a cancel waits, and so does the
  -- refund), then the entry FOR NO KEY UPDATE, so the due figure read below
  -- cannot move under it. A tab's entry never changes: an unlocked read is sound.
  if v_kind = 'tournament' then
    perform 1 from tournaments x
     where x.id = (select e.tournament_id from tournament_entries e where e.id = v_entry)
       for share;
    perform 1 from tournament_entries e where e.id = v_entry for no key update;
  end if;

  -- 0044: the tab comes FIRST. payments.tab_id never changes (payments are
  -- append-only, and merge_tabs refuses a donor that has any), so resolving it
  -- through an unlocked read and then locking is sound. Taking `tabs` here is
  -- what makes app.tab_net_paid() actually stable for settle_tab and for all
  -- three REQUIRES_REFUND guards, every one of which reads it under this lock.
  select tab_id into v_tab_id from payments where id = p_payment_id;
  if v_tab_id is null then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from tabs where id = v_tab_id for update;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount_iqd), 0) into v_refunded
    from refunds where payment_id = p_payment_id;
  if v_refunded + p_amount_iqd > v_payment.amount_iqd then
    raise exception 'REFUND_EXCEEDS_PAYMENT' using errcode = 'P0001',
      detail = format('paid %s, already refunded %s', v_payment.amount_iqd, v_refunded);
  end if;

  -- 0281 (R36): lesson money goes back at the till only as far as it is due
  -- (lesson_enrolment_money's refund_due_desk_iqd, read under the coach
  -- mutex), unless a manager gives more on purpose (lesson_goodwill).
  if v_kind = 'lesson' and p_reason_code is distinct from 'lesson_goodwill' then
    v_m := app.lesson_enrolment_money(v_enrol);
    if p_amount_iqd > coalesce((v_m->>'refund_due_desk_iqd')::bigint, 0) then
      raise exception 'REFUND_EXCEEDS_DUE' using errcode = 'P0001',
        detail = format('due %s', coalesce((v_m->>'refund_due_desk_iqd')::bigint, 0)),
        hint = 'more than the lesson money due back; a goodwill refund beyond it uses the reason lesson_goodwill';
    end if;
  end if;

  -- 0310 (c41): entry money goes back only as far as it is due (withdrawn,
  -- cancelled, or waitlisted once registration closed), unless a manager
  -- gives more on purpose (tournament_goodwill). A registered player's fee
  -- or a no-show's forfeited fee is not due.
  if v_kind = 'tournament' and p_reason_code is distinct from 'tournament_goodwill' then
    v_due := coalesce((app.tournament_entry_money(v_entry)->>'refund_due_iqd')::bigint, 0);
    if p_amount_iqd > v_due then
      raise exception 'REFUND_EXCEEDS_DUE' using errcode = 'P0001',
        detail = format('due %s', v_due),
        hint = 'more than the entry money due back; a goodwill refund beyond it uses the reason tournament_goodwill';
    end if;
  end if;

  insert into refunds (payment_id, amount_iqd, reason_code, refunded_by, device_id)
  values (p_payment_id, p_amount_iqd, p_reason_code, auth.uid(), p_device_id)
  returning * into v_refund;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
      select oi.* into v_oi
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.id = (v_item->>'order_item_id')::uuid
         and o.tab_id = v_payment.tab_id;
      if not found then
        raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001',
          detail = v_item->>'order_item_id';
      end if;
      if v_qty < 1 or v_qty > v_oi.qty then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;
      insert into refund_items (refund_id, order_item_id, qty)
      values (v_refund.id, v_oi.id, v_qty);
    end loop;
  end if;

  -- STOCK HOOK (0018/0043): the refund_items_restock trigger writes the
  -- 'refund_reversal' movements, guarded against void-as-waste double credit.

  perform app.write_audit('payment.refund', 'refunds', v_refund.id::text,
                          null, to_jsonb(v_refund), p_reason_code, v_auth, p_device_id);

  v_result := jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $refund_0310$;

comment on function app.refund(uuid, bigint, text, text, jsonb, text, text) is
  'till_shifts (0139, 0120, 0044, 0115). Refunds part or all of one payment (manager, owner) behind a manager-PIN grant, inside an open day (NO_OPEN_DAY otherwise); naming order lines restocks them. The refunds row records p_device_id, and app.stamp_till_shift gives it the shift open at that station. p_idempotency_key: a replay of the same key by the same caller echoes the first result with duplicate:true (app.claim_replay). REFUND_EXCEEDS_PAYMENT (detail = paid/refunded), PAYMENT_NOT_FOUND, ITEM_NOT_ON_TAB, INVALID_QTY, INVALID_AMOUNT. 0281 (R36): on a kind lesson tab the coach mutex is taken before the tab, and a refund above the enrolment''s refund_due_desk_iqd is REFUND_EXCEEDS_DUE (detail due <n>) unless p_reason_code is lesson_goodwill. Reason codes on lesson money: lesson_refund (what is due), lesson_goodwill (beyond it). 0310 (c41): on a kind tournament tab the tournament (FOR SHARE) and the entry (FOR NO KEY UPDATE) are taken before the tab, and a refund above the entry''s refund_due_iqd (tournament_entry_money) is REFUND_EXCEEDS_DUE (detail due <n>) unless p_reason_code is tournament_goodwill.';

-- ===========================================================================
-- 13. app.close_branch (c40), re-issued from 0280:671
-- ===========================================================================
create or replace function app.close_branch(p_venue uuid)
 RETURNS venues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $close_branch_0310$
declare
  v_old venues%rowtype;
  v_row venues%rowtype;
  v_n   int;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0233: one status change (or day open) at a time, chain-wide.
  perform pg_advisory_xact_lock(hashtextextended('venue_status', 0));
  select * into v_old from venues where id = p_venue for update;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.status = 'closed' then
    return v_old;
  end if;
  if v_old.status = 'open'
     and not exists (select 1 from venues v where v.status = 'open' and v.id <> p_venue) then
    raise exception 'LAST_OPEN_BRANCH' using errcode = 'P0001',
      hint = 'open another branch before closing this one';
  end if;
  if exists (select 1 from day_sessions d where d.venue_id = p_venue and d.status in ('open','closing')) then
    raise exception 'BRANCH_DAY_OPEN' using errcode = 'P0001',
      hint = 'close the branch''s day first';
  end if;

  -- 0233: guests with a court still to come are told by a person, not by a
  -- closed door. Cancel or move them first.
  select count(*) into v_n
    from reservations r
   where r.venue_id = p_venue
     and r.kind in ('booking', 'hold', 'lesson')   -- 0280: a lesson's court row is a booking to come
     and r.status in ('pending', 'confirmed')
     and r.end_at > now();
  v_n := v_n + (select count(*) from reservation_series s
                 where s.venue_id = p_venue and s.cancelled_at is null
                   and (s.ends_on is null or s.ends_on >= current_date));
  if v_n > 0 then
    raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = v_n::text,
      hint = 'cancel or move the branch''s bookings, lessons, holds and series first';
  end if;

  -- 0280 (R37): coaching money still to settle. Money's app.lesson_money_open
  -- (0281) is true while the branch has a draft or approved coach statement, a
  -- statement lesson in a month with no non-void statement, or an enrolment
  -- whose lesson money is still due back at the till (or blocked on Qi). The
  -- outer test keeps the call off a branch that never had a lesson or a
  -- statement; the nested IF is prepared only when it runs.
  if exists (select 1 from lessons l where l.venue_id = p_venue)
     or exists (select 1 from coach_statements s where s.venue_id = p_venue) then
    if app.lesson_money_open(p_venue) then
      raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = 'coaching_money',
        hint = 'approve and pay the branch''s coach statements and make its lesson refunds first';
    end if;
  end if;

  -- 0310 (c40): once closed nobody is staff there, so nobody could run, end
  -- or cancel its tournaments or refund their entry money at the till.
  if exists (select 1 from tournaments t
              where t.venue_id = p_venue and t.status in ('open', 'closed', 'running')) then
    raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = 'tournaments',
      hint = 'finish or cancel the branch''s tournaments first';
  end if;
  if exists (select 1 from tournament_entries e
              where e.venue_id = p_venue
                and exists (select 1 from tabs tb where tb.tournament_entry_id = e.id)
                and (app.tournament_entry_money(e.id)->>'refund_due_iqd')::bigint > 0) then
    raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = 'tournament_money',
      hint = 'make the branch''s tournament refunds first';
  end if;

  -- 0233: tidy up while the branch is still open, so every row below (and the
  -- audit row) is filed there.
  perform set_config('app.venue_id', p_venue::text, true);
  update guest_sessions set closed_at = now()
   where venue_id = p_venue and closed_at is null;
  delete from station_staff where venue_id = p_venue;
  delete from device_heartbeats where venue_id = p_venue;
  update stations set retired_at = now()
   where venue_id = p_venue and retired_at is null;
  update degraded_periods set ended_at = now()
   where venue_id = p_venue and ended_at is null;
  perform app.write_audit('venue.close', 'venues', p_venue::text,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', 'closed'));

  update venues set status = 'closed' where id = p_venue returning * into v_row;
  return v_row;
end $close_branch_0310$;

comment on function app.close_branch(uuid) is
  '0223 (MV4). Owner-only: close a branch (never deleted). Refuses the last open branch (LAST_OPEN_BRANCH) and a branch whose day is still open (BRANCH_DAY_OPEN). Audited as venue.close. 0280: live lessons count with the bookings (BRANCH_HAS_BOOKINGS, detail the count); R37: a branch with coaching money to settle (a draft or approved coach statement, an undrafted month of statement lessons, a lesson refund still due at the till or blocked on Qi; app.lesson_money_open) is refused BRANCH_HAS_BOOKINGS detail coaching_money. 0310 (c40): an open, closed or running tournament is BRANCH_HAS_BOOKINGS detail tournaments, and tournament entry money still due back at the till detail tournament_money.';
