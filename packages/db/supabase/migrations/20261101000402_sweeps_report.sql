set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0402 — the other six background bodies that catch their errors report them
-- (Majed, 2026-11-01, owner decision: every failure reaches the dev monitoring
-- panel; DECISIONS.md "Monitoring contract"). 0394 did protocol_remind_sweep,
-- reward_sweep and shop_reward_sweep and left these six to their next
-- re-issue; this is that re-issue.
--
-- A body that catches an item's (or a branch's, or a step's) error in its own
-- exception block and carries on never fails its pg_cron run, so 0393's
-- tp_monitor_cron never sees it: the error lived only in a `raise warning`.
-- Each such handler now also stores it through app.monitor (0393: never
-- raises), source cron, level error, kind `<function>_failed`, the warning's
-- own text as the message and only ids in the detail (no names, phones or
-- amounts). The function goes on exactly as before.
--
--   app.match_sweep(uuid)            0263's body verbatim: the per-match
--                                    handler, the DF-20 refunds, the report purge
--   app.lesson_sweep()               0295's body verbatim: the per-item handler,
--                                    the refund net, the CD-8 purge
--   app.tournament_sweep()           0310's body verbatim: cut-off, deleted
--                                    account, finish, cancel, and the cancel's mark
--   app.checklist_sweep()            0323's body verbatim: the per-branch handler
--   app.loyalty_nightly_one(uuid, int, timestamptz)
--                                    0376's body verbatim: the per-account handler
--   app.price_promo_apply_due()      0177's body verbatim: the per-run handler
--                                    (the scheduled change did not apply; it had
--                                    no warning, the revert and the audit row
--                                    stay as they were) and its put-back handler
--
-- 0402 holds all six now. The only changes are the `perform app.monitor(...)`
-- lines and the dollar tags. Signatures, SET clauses and comments are
-- unchanged (create or replace keeps a comment); each revoke/grant pair is
-- re-issued as its latest file had it. The `exception when sqlstate 'P0001'`
-- blocks in match_sweep (assert_bookable answering "not bookable") are flow,
-- not failures, and report nothing.
--
-- covered by packages/db/tests/sweeps-report.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app.match_sweep — 0263's body verbatim plus app.monitor in its three handlers.
-- ---------------------------------------------------------------------------
create or replace function app.match_sweep(p_venue_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $match_sweep_0402$
declare
  c_zero    constant jsonb := '{"booked": 0, "awaiting_expired": 0, "bumped": 0, "expired": 0, "cancelled": 0,
                                "warned": 0, "requests_expired": 0, "left_deleted": 0, "removed_banned": 0,
                                "forfeited": 0, "played": 0, "no_show": 0}';
  v_c       jsonb := c_zero;   -- the run's counts
  v_snap    jsonb;             -- the counts before the match in hand (an error rolls it back)
  v_swept   int := 0;
  v_skipped int := 0;
  v_errors  int := 0;
  v_refunds int := 0;
  v_purged  int := 0;
  v_budget  int := 200;
  v_ids     uuid[] := '{}'::uuid[];
  v_venues  uuid[] := '{}'::uuid[];
  v_row     record;
  v_due     boolean;
  v_n       int;
  v_off     int := 0;
  v_i       int;
  v_v       uuid;
  v_lo      timestamptz;
  v_hi      timestamptz;
  v_mid     uuid;
  v_m       matches%rowtype;
  v_req     record;
  v_holder  record;
  v_code    text;
  v_fit     text;
  v_status  text;
  v_tickets uuid[];
  v_seats   uuid[];
  v_k       int;
  v_del     int;
  v_ban     int;
begin
  -- Phase 1: the due matches and their branches (no locks).
  for v_row in
    select mt.id, mt.venue_id, mt.status, mt.sandbox, mt.price_court_id, mt.start_at, mt.end_at,
           case
             when mt.status = 'awaiting_court' then true
             when mt.status = 'filling' then
                  now() >= mt.fill_deadline_at
               or (now() >= mt.fill_deadline_at - interval '30 minutes' and mt.deadline_warned_at is null)
               or exists (select 1 from match_seats s join profiles p on p.id = s.guest_id
                           where s.match_id = mt.id and s.status = 'in'
                             and (p.deleted_at is not null
                                  or exists (select 1 from customer_flags f
                                              where f.customer_id = s.guest_id and f.type = 'match_ban')))
               or exists (select 1 from match_requests q join profiles p on p.id = q.guest_id
                           where q.match_id = mt.id and q.status = 'pending'
                             and (p.deleted_at is not null
                                  or exists (select 1 from customer_flags f
                                              where f.customer_id = q.guest_id and f.type = 'match_ban')))
               -- It no longer fits: the branch, or no firm-free court offering
               -- the length (none offering it at all included).
               or (not mt.sandbox
                   and (not (mt.venue_id = any (app.open_venue_ids()))
                        or not app.match_court_free_firm(mt.venue_id, mt.period, mt.duration_min, 1)))
             when mt.status = 'booked' then
                  now() >= mt.end_at + (case when mt.sandbox then interval '0 minutes' else interval '3 hours' end)
               or (now() < mt.start_at
                   and exists (select 1 from app.match_carriers(mt.id) c
                                 join match_seats s on s.id = c.seat_id
                                 join profiles p on p.id = s.guest_id
                                where c.status = 'in' and p.deleted_at is not null))
               or (now() >= mt.start_at
                   and exists (select 1 from app.match_carriers(mt.id) c
                                 join match_seats s on s.id = c.seat_id
                                 join match_tickets k on k.id = s.ticket_id
                                where c.status = 'left_late' and k.status = 'in_use' and k.seat_id = s.id))
               or (now() >= mt.start_at
                   and exists (select 1 from match_requests q where q.match_id = mt.id and q.status = 'pending'))
             -- Ended with a pending request left behind.
             else true
           end as due
      from matches mt
     where (p_venue_id is null or mt.venue_id = p_venue_id)
       and (mt.status in ('filling', 'awaiting_court', 'booked')
            or mt.id in (select q.match_id from match_requests q where q.status = 'pending'))
     order by mt.venue_id, mt.start_at, mt.id
  loop
    v_due := v_row.due;
    -- The branch's hours and closed dates: assert_bookable only raises.
    if not v_due and v_row.status = 'filling' and not v_row.sandbox then
      begin
        perform app.assert_bookable(v_row.price_court_id, v_row.start_at, v_row.end_at);
      exception when sqlstate 'P0001' then
        v_due := true;
      end;
    end if;
    if v_due then
      v_ids := v_ids || v_row.id;
      if not (v_row.venue_id = any (v_venues)) then
        v_venues := v_venues || v_row.venue_id;
      end if;
    end if;
  end loop;

  -- Phase 2: per branch, from a rotating offset so no branch is always last.
  v_n := cardinality(v_venues);
  if v_n > 0 then
    v_off := floor(extract(epoch from now()) / 30)::int % v_n;
  end if;
  for v_i in 0 .. v_n - 1 loop
    exit when v_budget <= 0;
    v_v := v_venues[((v_off + v_i) % v_n) + 1];
    perform set_config('app.venue_id', v_v::text, true);
    if v_i = 0 then
      -- The first branch waits for its locks (LS).
      perform app.match_lock_courts(v_v);
      -- No filling or waiting match due here (only booked work): no span, so
      -- no hold expiry. tstzrange(NULL, NULL) is the unbounded range, never
      -- NULL, so the bounds are tested, not the range.
      select min(mt.start_at), max(mt.end_at) into v_lo, v_hi
        from matches mt
       where mt.id = any (v_ids) and mt.venue_id = v_v and mt.status in ('filling', 'awaiting_court');
      if v_lo is not null and v_hi is not null then
        perform app.match_expire_holds(v_v, tstzrange(v_lo, v_hi, '[)'));
      end if;
      perform app.lock_match_venue(v_v);
    elsif not app.try_lock_match_venue(v_v, true) then
      -- A later branch is never waited on (C21): skipped this run.
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_swept := v_swept + 1;

    for v_mid in
      select mt.id from matches mt
       where mt.id = any (v_ids) and mt.venue_id = v_v
       order by mt.start_at, mt.id
    loop
      exit when v_budget <= 0;
      v_budget := v_budget - 1;
      v_snap := v_c;
      begin
        select * into v_m from matches where id = v_mid;

        -- 1. Requests past their cutoff (filling or waiting: the deadline;
        --    booked: the start; code closed), or left on an ended match (code
        --    its ended_reason).
        for v_req in
          select q.id from match_requests q
           where q.match_id = v_m.id and q.status = 'pending'
             and (v_m.status not in ('filling', 'awaiting_court', 'booked')
                  or (v_m.status in ('filling', 'awaiting_court') and now() >= v_m.fill_deadline_at)
                  or (v_m.status = 'booked' and now() >= v_m.start_at))
           order by q.id
        loop
          v_code := case when v_m.status in ('filling', 'awaiting_court', 'booked') then 'closed'
                         else coalesce(v_m.ended_reason, 'match_ended') end;
          select array_agg(k.id order by k.id) into v_tickets
            from match_tickets k where k.request_id = v_req.id and k.status = 'reserved';
          perform app.ticket_release(v_tickets, v_code, null, v_req.id);
          update match_requests set status = 'expired', decided_at = now() where id = v_req.id;
          perform app.match_event(v_m.id, v_m.venue_id, 'request_expired', 'system', null, v_req.id, v_code,
                                  '{}'::jsonb);
          v_c := v_c || jsonb_build_object('requests_expired', (v_c->>'requests_expired')::int + 1);
        end loop;

        -- 2. Deleted and banned holders (R18, C5).
        if v_m.status in ('filling', 'awaiting_court') then
          select count(*) filter (where p.deleted_at is not null), count(*) filter (where p.deleted_at is null)
            into v_del, v_ban
            from match_seats s join profiles p on p.id = s.guest_id
           where s.match_id = v_m.id and s.status = 'in'
             and (p.deleted_at is not null
                  or exists (select 1 from customer_flags f where f.customer_id = s.guest_id and f.type = 'match_ban'));
          if app.match_drop_ineligible(v_m.id) > 0 then
            v_c := v_c || jsonb_build_object('left_deleted', (v_c->>'left_deleted')::int + v_del,
                                             'removed_banned', (v_c->>'removed_banned')::int + v_ban);
            -- A waiting match left with fewer than four goes back to filling
            -- (db.md §3.1, as match_try_book step 3 does): step 6 may not
            -- run (offline inside the horizon), and a waiting match at 3/4
            -- would keep claiming a court (R22) that the desk cannot fill.
            select * into v_m from matches where id = v_mid;
            if v_m.status = 'awaiting_court'
               and (select count(*) from app.match_carriers(v_m.id) c where c.seat_id is not null) < 4 then
              update matches set status = 'filling', updated_at = now() where id = v_m.id;
            end if;
          end if;
        elsif v_m.status = 'booked' and now() < v_m.start_at then
          -- A deleted holder's booked seats become late leaves (DF-20): open
          -- for a refill, their tickets released at the start and never
          -- forfeited (step 7, ticket_forfeit, R18). A banned holder's booked
          -- seats are left to the desk.
          v_k := 0;
          for v_holder in
            select s.guest_id
              from app.match_carriers(v_m.id) c
              join match_seats s on s.id = c.seat_id
              join profiles p on p.id = s.guest_id
             where c.status = 'in' and p.deleted_at is not null
             group by s.guest_id
             order by s.guest_id
          loop
            select array_agg(s.id order by (s.kind = 'account') desc, s.seat_no, s.id) into v_seats
              from match_seats s
             where s.match_id = v_m.id and s.status = 'in' and s.guest_id = v_holder.guest_id;
            update match_seats set status = 'left_late', ended_at = now(), end_reason = 'account_deleted'
             where id = any (v_seats);
            perform app.match_event(v_m.id, v_m.venue_id, 'left_late', 'system', v_seats[1], null, 'account_deleted',
                                    jsonb_build_object('seats', to_jsonb(v_seats),
                                                       'seats_taken', (select count(*) from app.match_carriers(v_m.id) c
                                                                        where c.status in ('in', 'attended'))));
            v_c := v_c || jsonb_build_object('left_deleted', (v_c->>'left_deleted')::int + cardinality(v_seats));
            v_k := v_k + 1;
          end loop;
          if v_k > 0 then
            perform app.match_recompute_organiser(v_m.id);
          end if;
        end if;
        select * into v_m from matches where id = v_mid;

        -- 3. The fit backstop: the branch trades, its hours and dates allow
        --    the time, a court still offers the length, one is firm-free.
        --    A sandbox match books no court (DF-19).
        if v_m.status in ('filling', 'awaiting_court') and not v_m.sandbox then
          v_fit := null;
          if not (v_m.venue_id = any (app.open_venue_ids())) then
            v_fit := 'venue_closed';
          else
            begin
              perform app.assert_bookable(v_m.price_court_id, v_m.start_at, v_m.end_at);
            exception when sqlstate 'P0001' then
              if sqlerrm not in ('CLOSED_DATE', 'OUTSIDE_HOURS') then
                raise;
              end if;
              v_fit := 'venue_closed';
            end;
          end if;
          if v_fit is null
             and not exists (select 1 from courts c
                              where c.venue_id = v_m.venue_id and c.is_active
                                and v_m.duration_min = any (c.duration_options)) then
            v_fit := 'no_court';
          elsif v_fit is null
                and not app.match_court_free_firm(v_m.venue_id, v_m.period, v_m.duration_min, 1) then
            v_fit := 'bumped';
          end if;
          if v_fit = 'venue_closed' then
            perform app.match_end(v_m.id, 'cancelled', 'venue_closed', 'system');
            v_c := v_c || jsonb_build_object('cancelled', (v_c->>'cancelled')::int + 1);
          elsif v_fit is not null then
            perform app.match_end(v_m.id, 'bumped', v_fit, 'system');
            v_c := v_c || jsonb_build_object('bumped', (v_c->>'bumped')::int + 1);
          end if;
          select * into v_m from matches where id = v_mid;
        end if;

        -- 4. The fill deadline.
        if v_m.status = 'filling' and now() >= v_m.fill_deadline_at then
          perform app.match_end(v_m.id, 'expired', 'deadline', 'system');
          v_c := v_c || jsonb_build_object('expired', (v_c->>'expired')::int + 1);
          select * into v_m from matches where id = v_mid;
        end if;

        -- 5. The warning, once, inside the last 30 minutes before the deadline.
        if v_m.status = 'filling' and now() >= v_m.fill_deadline_at - interval '30 minutes'
           and v_m.deadline_warned_at is null then
          update matches set deadline_warned_at = now(), updated_at = now() where id = v_m.id;
          perform app.match_event(v_m.id, v_m.venue_id, 'deadline_warning', 'system', null, null, null,
                                  jsonb_build_object('seats_taken', (select count(*) from app.match_carriers(v_m.id) c
                                                                      where c.seat_id is not null)));
          v_c := v_c || jsonb_build_object('warned', (v_c->>'warned')::int + 1);
        end if;

        -- 6. Waiting for a court (DF-18): expired at the start, else booked
        --    now if the blocking hold is gone (bumped if it confirmed). Not
        --    while the branch trades offline with the start inside the
        --    protected horizon (the desk books there, 0210).
        if v_m.status = 'awaiting_court' then
          if now() >= v_m.start_at then
            perform app.match_end(v_m.id, 'expired', 'no_court', 'system');
            v_c := v_c || jsonb_build_object('awaiting_expired', (v_c->>'awaiting_expired')::int + 1);
          elsif not (app.is_degraded(v_m.venue_id)
                     and v_m.start_at < now() + make_interval(hours => coalesce(
                           (select vs.protected_horizon_hours from venue_settings vs where vs.venue_id = v_m.venue_id),
                           48))) then
            v_status := app.match_try_book(v_m.id);
            if v_status = 'booked' then
              v_c := v_c || jsonb_build_object('booked', (v_c->>'booked')::int + 1);
            elsif v_status = 'bumped' then
              v_c := v_c || jsonb_build_object('bumped', (v_c->>'bumped')::int + 1);
            elsif v_status = 'cancelled' then
              v_c := v_c || jsonb_build_object('cancelled', (v_c->>'cancelled')::int + 1);
            end if;
          end if;
          select * into v_m from matches where id = v_mid;
        end if;

        -- 7. The start: an unrefilled late leave loses its ticket (a deleted
        --    holder's is released instead, R18). The tickets are locked first
        --    in one id-ordered statement (db.md §2.4).
        if v_m.status = 'booked' and now() >= v_m.start_at then
          select array_agg(s.id order by s.seat_no, s.id), array_agg(s.ticket_id order by s.seat_no, s.id)
            into v_seats, v_tickets
            from app.match_carriers(v_m.id) c
            join match_seats s on s.id = c.seat_id
            join match_tickets k on k.id = s.ticket_id
           where c.status = 'left_late' and k.status = 'in_use' and k.seat_id = s.id;
          if v_tickets is not null then
            perform 1 from match_tickets where id = any (v_tickets) order by id for update;
            for v_k in 1 .. cardinality(v_tickets) loop
              if app.ticket_forfeit(v_tickets[v_k], v_seats[v_k]) then
                v_c := v_c || jsonb_build_object('forfeited', (v_c->>'forfeited')::int + 1);
              end if;
            end loop;
          end if;
        end if;

        -- 8. The end of play, 3 hours after end_at (a sandbox match at
        --    end_at): unmarked carriers attended (R37), or no_show when no
        --    carrier is in or attended.
        if v_m.status = 'booked'
           and now() >= v_m.end_at + (case when v_m.sandbox then interval '0 minutes' else interval '3 hours' end) then
          if exists (select 1 from app.match_carriers(v_m.id) c where c.status in ('in', 'attended')) then
            perform app.match_end(v_m.id, 'played', null, 'system');
            v_c := v_c || jsonb_build_object('played', (v_c->>'played')::int + 1);
          else
            perform app.match_end(v_m.id, 'no_show', 'all_no_show', 'system');
            v_c := v_c || jsonb_build_object('no_show', (v_c->>'no_show')::int + 1);
          end if;
        end if;
      exception when others then
        -- One bad match never stops the rest: its changes roll back, it is
        -- counted, and the next run tries again.
        v_c := v_snap;
        v_errors := v_errors + 1;
        raise warning 'match_sweep: match % left for the next run: % (%)', v_mid, sqlerrm, sqlstate;
        perform app.monitor('cron', 'error', 'match_sweep_failed',
          format('match_sweep: match %s left for the next run: %s (%s)', v_mid, sqlerrm, sqlstate),
          jsonb_build_object('match_id', v_mid, 'venue_id', v_v, 'sqlstate', sqlstate));
      end;
    end loop;
  end loop;

  -- Phase 3: chain-wide, each step on its own. A branch-scoped call (a manual
  -- rerun, a test) never touches other branches' guests or reports.
  if p_venue_id is null then
    begin
      v_refunds := coalesce(app.ticket_refund_deleted(null), 0);
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'match_sweep: DF-20 refunds left for the next run: % (%)', sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'match_sweep_failed',
        format('match_sweep: DF-20 refunds left for the next run: %s (%s)', sqlerrm, sqlstate),
        jsonb_build_object('step', 'refunds', 'sqlstate', sqlstate));
    end;
    begin
      delete from match_reports where created_at < now() - interval '12 months';
      get diagnostics v_purged = row_count;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'match_sweep: report purge left for the next run: % (%)', sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'match_sweep_failed',
        format('match_sweep: report purge left for the next run: %s (%s)', sqlerrm, sqlstate),
        jsonb_build_object('step', 'report_purge', 'sqlstate', sqlstate));
    end;
  end if;

  return jsonb_build_object('venues_swept', v_swept, 'venues_skipped', v_skipped)
         || v_c
         || jsonb_build_object('refunds_started', v_refunds, 'reports_purged', v_purged, 'errors', v_errors);
end $match_sweep_0402$;

revoke all on function app.match_sweep(uuid) from public, anon, authenticated;
grant execute on function app.match_sweep(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- app.lesson_sweep — 0295's body verbatim plus app.monitor in its three handlers.
-- ---------------------------------------------------------------------------
create or replace function app.lesson_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $lesson_sweep_0402$
declare
  v_c       jsonb := jsonb_build_object(
                       'held_expired', 0, 'held_waiting', 0, 'deleted_cancelled', 0, 'links_dropped', 0,
                       'retired_cancelled', 0, 'under_filled', 0, 'courses_under_filled', 0,
                       'judged_late', 0, 'cutoffs_confirmed', 0, 'deferred', 0, 'courses_running', 0,
                       'completed', 0, 'courses_completed', 0,
                       'holds_released', 0);   -- 0295 (DB-39)
  v_works   text[];
  v_ids     uuid[];
  v_coaches uuid[];
  v_venues  uuid[];
  v_n       int;
  v_i       int;
  v_cur     uuid;
  v_first   boolean := true;
  v_held    boolean := false;
  v_skipped int := 0;
  v_errors  int := 0;
  v_purged  int := 0;
  v_key     text;
  v_res     jsonb;
  v_e       lesson_enrolments%rowtype;
  v_l       lessons%rowtype;
  v_co      courses%rowtype;
  v_start   timestamptz;
  v_booked  int;
  v_taken   int;
  v_ref     uuid;
  v_s       record;     -- 0295 (DB-41)
  v_refunds int := 0;   -- 0295 (DB-40)
begin
  -- Phase 1: the due items (no locks), at most 200, by coach, then step.
  select coalesce(array_agg(w.work     order by w.rn), '{}'::text[]),
         coalesce(array_agg(w.id       order by w.rn), '{}'::uuid[]),
         coalesce(array_agg(w.coach_id order by w.rn), '{}'::uuid[]),
         coalesce(array_agg(w.venue_id order by w.rn), '{}'::uuid[])
    into v_works, v_ids, v_coaches, v_venues
    from (
      select u.*, row_number() over (order by u.coach_id, u.ord, u.due, u.id) as rn
        from (
          -- 1. held enrolments past their hold, no payment that can still land
          select 'held_expire'::text as work, e.id, coalesce(l.coach_id, c.coach_id) as coach_id,
                 e.venue_id, 1 as ord, e.hold_expires_at as due
            from lesson_enrolments e
            left join lessons l on l.id = e.lesson_id
            left join courses c on c.id = e.course_id
           where e.status = 'held'
             and e.hold_expires_at <= now()
             and not exists (select 1 from booking_payments bp
                              where bp.lesson_enrolment_id = e.id and bp.purpose = 'lesson'
                                and (bp.status = 'succeeded'
                                     or (bp.status in ('created', 'pending')
                                         and bp.deadline_at > now() - interval '10 minutes')))
          union all
          -- 2. live enrolments of a deleted account, not yet started
          select 'deleted', e.id, coalesce(l.coach_id, c.coach_id), e.venue_id, 2, e.created_at
            from lesson_enrolments e
            join profiles p on p.id = e.guest_id and p.deleted_at is not null
            left join lessons l on l.id = e.lesson_id
            left join courses c on c.id = e.course_id
           where e.status in ('held', 'booked')
             and coalesce(l.start_at,
                          (select s.start_at from lessons s
                            where s.course_id = e.course_id
                              and s.session_no = e.first_session_no + e.sessions_covered - 1)) > now()
          union all
          -- 3. a retired coach's lessons not yet started (never a course session alone, C-19)
          select 'retired_lesson', l.id, l.coach_id, l.venue_id, 3, l.start_at
            from lessons l
            join coaches co on co.id = l.coach_id and co.status = 'retired'
           where l.status in ('held', 'scheduled') and l.kind <> 'course' and l.start_at > now()
          union all
          -- 3. ... and courses with a session left to start
          select 'retired_course', c.id, c.coach_id, c.venue_id, 3, c.signup_closes_at
            from courses c
            join coaches co on co.id = c.coach_id and co.status = 'retired'
           where c.status in ('open', 'running')
             and exists (select 1 from lessons s
                          where s.course_id = c.id and s.status in ('held', 'scheduled') and s.start_at > now())
          union all
          -- 4. group sessions whose cut-off is due (lessons_cutoff_due)
          select 'cutoff_lesson', l.id, l.coach_id, l.venue_id, 4, l.cutoff_at
            from lessons l
           where l.kind = 'group' and l.status = 'scheduled'
             and l.cutoff_checked_at is null and l.cutoff_at <= now()
          union all
          -- 5. open courses whose cut-off is due (courses_cutoff_due)
          select 'cutoff_course', c.id, c.coach_id, c.venue_id, 5, c.cutoff_at
            from courses c
           where c.status = 'open' and c.cutoff_checked_at is null and c.cutoff_at <= now()
          union all
          -- 6. open courses whose session 1 has started
          select 'course_running', c.id, c.coach_id, c.venue_id, 6, s.start_at
            from courses c
            join lessons s on s.course_id = c.id and s.session_no = 1
           where c.status = 'open' and s.start_at <= now()
          union all
          -- 7. scheduled lessons 15 minutes past their end (lessons_end_due)
          select 'complete_lesson', l.id, l.coach_id, l.venue_id, 7, l.end_at
            from lessons l
           where l.status = 'scheduled' and l.end_at + interval '15 minutes' <= now()
          union all
          -- 8. running courses with nothing left to give (their last sessions
          --    may be completed by step 7 of this same run)
          select 'complete_course', c.id, c.coach_id, c.venue_id, 8, c.signup_closes_at
            from courses c
           where c.status = 'running'
             and not exists (select 1 from lessons s
                              where s.course_id = c.id and s.status in ('held', 'scheduled')
                                and s.end_at + interval '15 minutes' > now())
          union all
          -- 9. 0295 (DB-39): pending court holds of lessons no longer held
          --    (one item per lesson)
          select 'hold_release', l.id, l.coach_id, l.venue_id, 9, min(r.created_at)
            from reservations r
            join lessons l on l.id = r.lesson_id
           where r.kind = 'hold' and r.status = 'pending' and l.status <> 'held'
           group by l.id, l.coach_id, l.venue_id
        ) u
       order by rn
       limit 200
    ) w;

  -- Phase 2: coach by coach.
  v_n := coalesce(array_length(v_ids, 1), 0);
  for v_i in 1 .. v_n loop
    if v_coaches[v_i] is distinct from v_cur then
      v_cur := v_coaches[v_i];
      if v_first then
        -- The first coach is waited for (D-3) ...
        perform app.lock_coach(v_cur);
        v_first := false;
        v_held := true;
      else
        -- ... every later one only tried: a blocking second coach could close
        -- a cycle with a booking that holds it (db.md §2.4, situation 39).
        v_held := app.try_lock_coach(v_cur);
      end if;
    end if;
    if not v_held then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    perform set_config('app.venue_id', v_venues[v_i]::text, true);
    begin
      v_key := null;

      if v_works[v_i] = 'held_expire' then
        -- Money decides (one definition with deposit_apply's EXPIRED branch):
        -- false while a payment can still land, true once it expired the
        -- enrolment (and a private lesson, and its hold row) and recorded the
        -- lapsed_hold strike of a guest-booked enrolment (R30).
        v_key := case when app.lesson_hold_expire(v_ids[v_i]) then 'held_expired' else 'held_waiting' end;

      elsif v_works[v_i] = 'deleted' then
        select * into v_e from lesson_enrolments where id = v_ids[v_i];
        v_start := coalesce((select l.start_at from lessons l where l.id = v_e.lesson_id),
                            (select s.start_at from lessons s
                              where s.course_id = v_e.course_id
                                and s.session_no = v_e.first_session_no + v_e.sessions_covered - 1));
        if v_e.status in ('held', 'booked')
           and exists (select 1 from profiles p where p.id = v_e.guest_id and p.deleted_at is not null) then
          if v_e.booked_by_kind <> 'guest' and v_e.link_confirmed_at is null then
            -- C-21, R44: a typed phone that matched this account was never
            -- confirmed, so nobody knows it is that person. The link goes as
            -- "Not me" takes it away (silently, no event); the coach's or the
            -- desk's student stays booked under the typed name and phone.
            -- (0289 does this at deletion; this catches an add that matched
            -- while the deletion was committing.)
            update lesson_enrolments
               set guest_id = null, updated_at = now()
             where id = v_e.id and guest_id = v_e.guest_id and link_confirmed_at is null;
            v_key := 'links_dropped';
          elsif v_start > now() then
            v_res := app.enrolment_cancel_internal(v_e.id, 'account_deleted', 'system', null, null);
            if coalesce(v_res ->> 'changed', 'true') <> 'false' then
              v_key := 'deleted_cancelled';
            end if;
          end if;
        end if;

      elsif v_works[v_i] = 'retired_lesson' then
        select * into v_l from lessons where id = v_ids[v_i];
        if v_l.status in ('held', 'scheduled') and v_l.kind <> 'course' and v_l.start_at > now()
           and exists (select 1 from coaches co where co.id = v_l.coach_id and co.status = 'retired') then
          v_res := app.lesson_cancel_internal(v_l.id, 'coach_retired', 'system', null, null);
          if coalesce(v_res ->> 'changed', 'true') <> 'false' then
            v_key := 'retired_cancelled';
          end if;
        end if;

      elsif v_works[v_i] = 'retired_course' then
        select * into v_co from courses where id = v_ids[v_i];
        if v_co.status in ('open', 'running')
           and exists (select 1 from coaches co where co.id = v_co.coach_id and co.status = 'retired')
           and exists (select 1 from lessons s
                        where s.course_id = v_co.id and s.status in ('held', 'scheduled') and s.start_at > now()) then
          v_res := app.course_cancel_internal(v_co.id, 'coach_retired', 'system', null, null);
          if coalesce(v_res ->> 'changed', 'true') <> 'false' then
            v_key := 'retired_cancelled';
          end if;
        end if;

      elsif v_works[v_i] = 'cutoff_lesson' then
        select * into v_l from lessons where id = v_ids[v_i];
        if v_l.kind = 'group' and v_l.status = 'scheduled'
           and v_l.cutoff_checked_at is null and v_l.cutoff_at <= now() then
          -- R38: the cut-off counts booked places; held places only decide
          -- whether to wait.
          select coalesce(sum(e.party_size) filter (where e.status = 'booked'), 0)::int
            into v_booked
            from lesson_enrolments e
           where e.lesson_id = v_l.id;
          v_taken := app.lesson_places_taken(v_l.id);

          if now() >= v_l.start_at
             and not exists (select 1 from lesson_enrolments e
                              where e.lesson_id = v_l.id and e.status in ('booked', 'held')) then
            -- 0295 (DB-41, D4): judged late with no place booked or held (a
            -- zero cut-off is always judged late): nobody to disrupt and no
            -- money to move, so it is cancelled under_filled and its court
            -- freed.
            v_res := app.lesson_cancel_internal(v_l.id, 'under_filled', 'system', null, null);
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where id = v_l.id and cutoff_checked_at is null;
            v_key := 'under_filled';
          elsif now() >= v_l.start_at then
            -- R26: judged late (a skipped coach, a stalled cron). Stamp, say
            -- so, cancel nothing.
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where id = v_l.id and cutoff_checked_at is null;
            if v_booked < v_l.min_places then
              perform app.lesson_event(v_l.venue_id, v_l.id, null, null, 'under_filled', 'system', null, null, null,
                                       jsonb_build_object('places_taken', v_booked, 'min_places', v_l.min_places,
                                                          'late', true, 'lesson_id', v_l.id));
              v_key := 'judged_late';
            else
              v_key := 'cutoffs_confirmed';
            end if;
          elsif v_booked >= v_l.min_places then
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where id = v_l.id and cutoff_checked_at is null;
            v_key := 'cutoffs_confirmed';
          elsif v_taken >= v_l.min_places and now() < v_l.start_at - interval '10 minutes' then
            -- R38: a guest mid-payment could still make the minimum; back
            -- next minute.
            v_key := 'deferred';
          else
            -- C-14: cancelled under_filled (the internal writes the
            -- under_filled event, frees the court, refunds online money).
            v_res := app.lesson_cancel_internal(v_l.id, 'under_filled', 'system', null, null);
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where id = v_l.id and cutoff_checked_at is null;
            v_key := 'under_filled';
          end if;
        end if;

      elsif v_works[v_i] = 'cutoff_course' then
        select * into v_co from courses where id = v_ids[v_i];
        if v_co.status = 'open' and v_co.cutoff_checked_at is null and v_co.cutoff_at <= now() then
          select s.start_at into v_start from lessons s where s.course_id = v_co.id and s.session_no = 1;
          select coalesce(sum(e.party_size) filter (where e.status = 'booked'), 0)::int
            into v_booked
            from lesson_enrolments e
           where e.course_id = v_co.id;
          v_taken := app.course_places_taken(v_co.id);

          if (v_start is null or now() >= v_start)
             and not exists (select 1 from lesson_enrolments e
                              where e.course_id = v_co.id and e.status in ('booked', 'held')) then
            -- 0295 (DB-41, D4): judged late with no place booked or held: the
            -- course is cancelled under_filled (its sessions not started
            -- through course_cancel_internal), then every session still on
            -- (the one under way: nobody is in it), so all its courts are
            -- freed. The whole course goes, never one session alone (C-19).
            v_res := app.course_cancel_internal(v_co.id, 'under_filled', 'system', null, null);
            for v_s in
              select s.id from lessons s
               where s.course_id = v_co.id and s.status in ('held', 'scheduled')
               order by s.session_no
            loop
              perform app.lesson_cancel_internal(v_s.id, 'under_filled', 'system', null, null);
            end loop;
            update courses set cutoff_checked_at = now(), updated_at = now()
             where id = v_co.id and cutoff_checked_at is null;
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where course_id = v_co.id and cutoff_checked_at is null;
            v_key := 'courses_under_filled';
          elsif v_start is null or now() >= v_start then
            -- R26: session 1 has started; stamp the course and its sessions.
            update courses set cutoff_checked_at = now(), updated_at = now()
             where id = v_co.id and cutoff_checked_at is null;
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where course_id = v_co.id and cutoff_checked_at is null;
            if v_booked < v_co.min_places then
              -- A course-wide event names the course's next session not yet
              -- started, else its last (db.md §5.2).
              v_ref := coalesce((select s.id from lessons s
                                  where s.course_id = v_co.id and s.start_at > now()
                                  order by s.start_at, s.session_no limit 1),
                                (select s.id from lessons s
                                  where s.course_id = v_co.id
                                  order by s.session_no desc limit 1));
              perform app.lesson_event(v_co.venue_id, null, v_co.id, null, 'under_filled', 'system', null, null, null,
                                       jsonb_build_object('places_taken', v_booked, 'min_places', v_co.min_places,
                                                          'late', true, 'lesson_id', v_ref));
              v_key := 'judged_late';
            else
              v_key := 'cutoffs_confirmed';
            end if;
          elsif v_booked >= v_co.min_places then
            update courses set cutoff_checked_at = now(), updated_at = now()
             where id = v_co.id and cutoff_checked_at is null;
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where course_id = v_co.id and cutoff_checked_at is null;
            v_key := 'cutoffs_confirmed';
          elsif v_taken >= v_co.min_places and now() < v_start - interval '10 minutes' then
            v_key := 'deferred';
          else
            v_res := app.course_cancel_internal(v_co.id, 'under_filled', 'system', null, null);
            update courses set cutoff_checked_at = now(), updated_at = now()
             where id = v_co.id and cutoff_checked_at is null;
            update lessons set cutoff_checked_at = now(), updated_at = now()
             where course_id = v_co.id and cutoff_checked_at is null;
            v_key := 'courses_under_filled';
          end if;
        end if;

      elsif v_works[v_i] = 'course_running' then
        -- No event: open -> running is not a guest-facing move (db.md §5.2).
        update courses set status = 'running', updated_at = now()
         where id = v_ids[v_i] and status = 'open'
           and exists (select 1 from lessons s
                        where s.course_id = v_ids[v_i] and s.session_no = 1 and s.start_at <= now());
        if found then
          v_key := 'courses_running';
        end if;

      elsif v_works[v_i] = 'complete_lesson' then
        select * into v_l from lessons where id = v_ids[v_i];
        if v_l.status = 'scheduled' and v_l.end_at + interval '15 minutes' <= now() then
          -- The court row first (status only, never a court lock; §3.4: the
          -- mark_reservation convention), then the lesson.
          perform app.lesson_court_release(v_l.id, 'completed');
          update lessons
             set status = 'completed', completed_at = now(), updated_at = now()
           where id = v_l.id and status = 'scheduled';
          perform app.lesson_event(v_l.venue_id, v_l.id, v_l.course_id, null, 'completed', 'system');
          v_key := 'completed';
        end if;

      elsif v_works[v_i] = 'complete_course' then
        select * into v_co from courses where id = v_ids[v_i];
        if v_co.status = 'running' then
          update courses set status = 'completed', updated_at = now()
           where id = v_co.id and status = 'running'
             and not exists (select 1 from lessons s
                              where s.course_id = v_co.id and s.status in ('held', 'scheduled'));
          if found then
            v_ref := (select s.id from lessons s where s.course_id = v_co.id order by s.session_no desc limit 1);
            perform app.lesson_event(v_co.venue_id, null, v_co.id, null, 'completed', 'system', null, null, null,
                                     jsonb_build_object('lesson_id', v_ref));
            v_key := 'courses_completed';
          end if;
        end if;

      elsif v_works[v_i] = 'hold_release' then
        -- 0295 (DB-39): under this lesson's coach lock, a pending hold naming
        -- a lesson that is no longer held is stale (a held lesson's release
        -- skipped it: SKIP LOCKED, R25). lesson_court_release expires it the
        -- same never-waiting way; a row still locked is tried next minute.
        if exists (select 1 from lessons l where l.id = v_ids[v_i] and l.status <> 'held')
           and exists (select 1 from reservations r
                        where r.lesson_id = v_ids[v_i] and r.kind = 'hold' and r.status = 'pending') then
          perform app.lesson_court_release(v_ids[v_i], 'expired');
          if not exists (select 1 from reservations r
                          where r.lesson_id = v_ids[v_i] and r.kind = 'hold' and r.status = 'pending') then
            v_key := 'holds_released';
          end if;
        end if;
      end if;

      -- The count moves last: an item that raised above is never counted.
      if v_key is not null then
        v_c := jsonb_set(v_c, array[v_key], to_jsonb(coalesce((v_c ->> v_key)::int, 0) + 1));
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'lesson_sweep: % % left for the next run: % (%)', v_works[v_i], v_ids[v_i], sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'lesson_sweep_failed',
        format('lesson_sweep: %s %s left for the next run: %s (%s)', v_works[v_i], v_ids[v_i], sqlerrm, sqlstate),
        jsonb_build_object('step', v_works[v_i], 'item_id', v_ids[v_i], 'coach_id', v_coaches[v_i],
                           'venue_id', v_venues[v_i], 'sqlstate', sqlstate));
    end;
  end loop;

  -- Phase 3, every run (0295, DB-40): the R28 refund net, so a refund a
  -- cancel never started goes out within a minute even when no other
  -- payment is open (the reconciler is only nudged then). Its own block: an
  -- error is counted and the next run tries again.
  begin
    v_refunds := app.lesson_refund_net();
  exception when others then
    v_errors := v_errors + 1;
    raise warning 'lesson_sweep: refund net left for the next run: % (%)', sqlerrm, sqlstate;
    perform app.monitor('cron', 'error', 'lesson_sweep_failed',
      format('lesson_sweep: refund net left for the next run: %s (%s)', sqlerrm, sqlstate),
      jsonb_build_object('step', 'refund_net', 'sqlstate', sqlstate));
  end;

  -- Phase 3, once an hour: the CD-8 purge (app.lesson_typed_purge, above).
  if extract(minute from now()) = 0 then
    begin
      v_purged := app.lesson_typed_purge(500);
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'lesson_sweep: CD-8 purge left for the next run: % (%)', sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'lesson_sweep_failed',
        format('lesson_sweep: CD-8 purge left for the next run: %s (%s)', sqlerrm, sqlstate),
        jsonb_build_object('step', 'typed_purge', 'sqlstate', sqlstate));
    end;
  end if;

  return v_c || jsonb_build_object('refunds_started', v_refunds, 'purged', v_purged, 'skipped', v_skipped,
                                   'errors', v_errors);
end $lesson_sweep_0402$;

revoke all on function app.lesson_sweep() from public, anon, authenticated;
grant execute on function app.lesson_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- app.tournament_sweep — 0310's body verbatim plus app.monitor in its five handlers.
-- ---------------------------------------------------------------------------
create or replace function app.tournament_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $tournament_sweep_0402$
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
      perform app.monitor('cron', 'error', 'tournament_sweep_failed',
        format('tournament_sweep cut-off %s: %s (%s)', v_id, sqlerrm, sqlstate),
        jsonb_build_object('step', 'cut_off', 'tournament_id', v_id, 'sqlstate', sqlstate));
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
      perform app.monitor('cron', 'error', 'tournament_sweep_failed',
        format('tournament_sweep deleted account %s: %s (%s)', v_e.id, sqlerrm, sqlstate),
        jsonb_build_object('step', 'deleted_account', 'entry_id', v_e.id, 'tournament_id', v_e.tournament_id,
                           'sqlstate', sqlstate));
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
      perform app.monitor('cron', 'error', 'tournament_sweep_failed',
        format('tournament_sweep finish %s: %s (%s)', v_id, sqlerrm, sqlstate),
        jsonb_build_object('step', 'finish', 'tournament_id', v_id, 'sqlstate', sqlstate));
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
      perform app.monitor('cron', 'error', 'tournament_sweep_failed',
        format('tournament_sweep cancel %s: %s (%s)', v_cancel_id, sqlerrm, sqlstate),
        jsonb_build_object('step', 'cancel', 'tournament_id', v_cancel_id, 'sqlstate', sqlstate));
      -- 0310 (c39): marked, so the next tick tries the others first; the
      -- count shows on the desk's detail.
      begin
        update tournaments
           set sweep_error_at = now(), sweep_errors = sweep_errors + 1
         where id = v_cancel_id;
      exception when others then
        raise warning 'tournament_sweep mark %: % (%)', v_cancel_id, sqlerrm, sqlstate;
        perform app.monitor('cron', 'error', 'tournament_sweep_failed',
          format('tournament_sweep mark %s: %s (%s)', v_cancel_id, sqlerrm, sqlstate),
          jsonb_build_object('step', 'mark', 'tournament_id', v_cancel_id, 'sqlstate', sqlstate));
      end;
    end;
  end if;

  return jsonb_build_object('cancelled', v_cancelled, 'closed', v_closed, 'withdrawn', v_withdrawn,
                            'finished', v_finished, 'deferred', v_deferred, 'skipped', v_skipped,
                            'errors', v_errors);
end $tournament_sweep_0402$;

revoke all on function app.tournament_sweep() from public, anon, authenticated;
grant execute on function app.tournament_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- app.checklist_sweep — 0323's body verbatim plus app.monitor in its branch handler.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_sweep()
returns int
language plpgsql security definer set search_path = public as $checklist_sweep_0402$
declare
  v_venue  uuid;
  v_date   date;
  v_run    record;
  v_key    text;
  v_to     uuid[];
  v_n      int := 0;
begin
  for v_venue in
    select v.id
      from venues v
     where v.status <> 'closed'
       and exists (select 1 from checklist_templates t
                    where t.venue_id = v.id and t.archived_at is null)
     order by v.id
  loop
    begin
      perform set_config('app.venue_id', v_venue::text, true);
      v_date := app.venue_business_date(v_venue);
      perform app.checklist_materialize(v_venue, v_date);

      for v_run in
        select r.id, r.role, r.assignee_id, r.due_at, r.due_pushed_at, r.overdue_pushed_at,
               t.name_en, t.name_ar
          from checklist_runs r
          join checklist_templates t on t.id = r.template_id
         where r.venue_id = v_venue
           and t.archived_at is null
           and r.business_date <= v_date
           and r.due_at is not null
           and (r.overdue_pushed_at is null
                or (r.due_pushed_at is null and now() < r.due_at))
           and now() >= r.due_at - interval '30 minutes'
           and app.checklist_current(r.template_id, r.business_date, r.period_end, v_date)
           and exists (select 1 from checklist_run_items i where i.run_id = r.id and i.done_at is null)
         order by r.id
      loop
        if now() >= v_run.due_at then
          continue when v_run.overdue_pushed_at is not null;
          v_key := 'checklist_overdue';
          update checklist_runs set overdue_pushed_at = now()
           where id = v_run.id and overdue_pushed_at is null;
        else
          continue when v_run.due_pushed_at is not null;
          v_key := 'checklist_due';
          update checklist_runs set due_pushed_at = now()
           where id = v_run.id and due_pushed_at is null;
        end if;
        -- Another sweep stamped it first.
        continue when not found;

        if v_run.assignee_id is not null then
          -- Only while they still work at the branch (materialise's rule): a
          -- person moved away mid-occurrence gets no push naming its list.
          v_to := case when app.checklist_member_at(v_run.assignee_id, v_venue)
                       then array[v_run.assignee_id] else '{}'::uuid[] end;
        else
          v_to := app.staff_ids_with_roles(v_venue, array[v_run.role]);
          if v_run.role <> 'owner' then
            select coalesce(array_agg(x.id), '{}'::uuid[]) into v_to
              from unnest(v_to) x(id)
             where not exists (select 1 from staff s where s.id = x.id and s.role = 'owner');
          end if;
        end if;
        select coalesce(array_agg(x.id), '{}'::uuid[]) into v_to
          from unnest(v_to) x(id)
         where not app.checklist_on_leave(x.id, v_date);

        if cardinality(v_to) > 0 then
          v_n := v_n + app.notify_staff(
            v_to, 'staff_task',
            jsonb_build_object('route', 'staff-checklist', 'id', v_run.id::text, 'title_key', v_key,
                               'params', jsonb_build_object(
                                 'step', jsonb_build_object('en', v_run.name_en, 'ar', v_run.name_ar))),
            'checklist:' || v_run.id::text || ':' || v_key);
        end if;
      end loop;
    exception when others then
      raise warning 'checklist_sweep venue %: % (%)', v_venue, sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'checklist_sweep_failed',
        format('checklist_sweep venue %s: %s (%s)', v_venue, sqlerrm, sqlstate),
        jsonb_build_object('venue_id', v_venue, 'sqlstate', sqlstate));
    end;
  end loop;

  return v_n;
end $checklist_sweep_0402$;

revoke all on function app.checklist_sweep() from public, anon, authenticated;
grant execute on function app.checklist_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- app.loyalty_nightly_one — 0376's body verbatim plus app.monitor in its handler.
-- ---------------------------------------------------------------------------
create or replace function app.loyalty_nightly_one(p_profile uuid, p_expire_months int, p_since timestamptz)
returns text
language plpgsql security definer set search_path = public set lock_timeout = '2s' as $loyalty_nightly_one_0402$
declare
  a       loyalty_accounts%rowtype;
  v_sum   bigint;
  v_last  timestamptz;
  v_12m   bigint;
  v_out   text := 'unchanged';
begin
  begin
    select * into a from loyalty_accounts c where c.profile_id = p_profile for update skip locked;
    if not found and exists (select 1 from loyalty_accounts c where c.profile_id = p_profile) then
      return 'locked';
    end if;

    -- Unchanged: the cache equals the ledger, read as app.loyalty_recompute
    -- reads it (0376: the tier points are earn + clawback + adjust of the last
    -- 12 months), in one scan: the balance, the last activity, the 12-month
    -- points and the tier they reach. Never from updated_at, which
    -- app.loyalty_retier also stamps without recounting.
    select coalesce(sum(l.delta), 0),
           max(l.created_at) filter (where l.kind <> 'expire'),
           coalesce(sum(l.delta) filter (where l.kind in ('earn', 'clawback', 'adjust')
                                           and l.created_at > now() - interval '12 months'), 0)
      into v_sum, v_last, v_12m
      from loyalty_ledger l where l.profile_id = p_profile;
    v_12m := greatest(v_12m, 0);
    if a.profile_id is null
       or a.balance <> v_sum
       or a.last_activity_at is distinct from v_last
       or a.points_12m is distinct from v_12m
       or a.tier_id is distinct from (select t.id from loyalty_tiers t where t.min_points_12m <= v_12m
                                       order by t.min_points_12m desc limit 1) then
      perform app.loyalty_recompute(p_profile);
      select * into a from loyalty_accounts c where c.profile_id = p_profile;
      v_out := 'recomputed';
    end if;

    -- c8: inactivity expiry, only while loyalty is on (p_expire_months set),
    -- counted from the later of the last activity and the last switch-on.
    if p_expire_months is not null and a.balance > 0
       and greatest(a.last_activity_at, p_since) < now() - make_interval(months => p_expire_months) then
      insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, note)
      values (p_profile, null, -a.balance, 'expire', 'expiry', gen_random_uuid(),
              format('inactive %s months', p_expire_months));
      v_out := 'expired';
    end if;
    return v_out;
  exception when others then
    raise warning 'loyalty_nightly_one: profile % left for the next run: % (%)', p_profile, sqlerrm, sqlstate;
    perform app.monitor('cron', 'error', 'loyalty_nightly_one_failed',
      format('loyalty_nightly_one: profile %s left for the next run: %s (%s)', p_profile, sqlerrm, sqlstate),
      jsonb_build_object('profile_id', p_profile, 'sqlstate', sqlstate));
    return 'error';
  end;
end $loyalty_nightly_one_0402$;

revoke all on function app.loyalty_nightly_one(uuid, int, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.price_promo_apply_due — 0177's body verbatim plus app.monitor in its run
--   handler and its put-back handler.
-- ---------------------------------------------------------------------------
create or replace function app.price_promo_apply_due()
returns jsonb
language plpgsql security definer set search_path = public as $price_promo_apply_due_0402$
declare
  v_id       uuid;
  v_run      protocol_runs%rowtype;
  v_step     protocol_run_steps%rowtype;
  v_code     text;
  v_hint     text;
  v_applied  int := 0;
  v_reverted int := 0;
begin
  for v_id in
    select r.id
      from protocol_runs r
     where r.kind = 'price_promo' and r.status = 'scheduled' and r.scheduled_for <= now()
     order by r.scheduled_for, r.id
  loop
    begin
      -- Under the lock: a date cancelled since the list was read is skipped.
      select * into v_run from protocol_runs where id = v_id for update;
      continue when v_run.status <> 'scheduled' or v_run.scheduled_for > now();
      perform app.price_promo_apply_internal(v_id);
      v_applied := v_applied + 1;
    exception when others then
      get stacked diagnostics v_code = message_text, v_hint = pg_exception_hint;
      perform app.monitor('cron', 'error', 'price_promo_apply_due_failed',
        format('price_promo_apply_due: run %s not applied: %s (%s)', v_id, v_code, sqlstate),
        jsonb_build_object('run_id', v_id, 'step', 'apply', 'sqlstate', sqlstate));
      begin
        select * into v_run from protocol_runs where id = v_id for update;
        select * into v_step from protocol_run_steps s where s.run_id = v_id and s.step_key = 'apply' for update;
        if v_run.status = 'scheduled' and app.protocol_step_allowed(v_step.status, 'open') then
          perform set_config('app.venue_id', v_run.venue_id::text, true);
          update protocol_runs set status = 'active', scheduled_for = null where id = v_run.id;
          update protocol_run_steps
             set status = 'open', round = round + 1, opened_at = now(), passed_at = null
           where id = v_step.id;
          perform app.protocol_engine_notify(app.staff_ids_with_roles(v_run.venue_id, '{manager}'),
                                             'staff_task', 'apply_not_ready', 'staff-step',
                                             v_step.id, v_run.id, v_step.id);
          -- Codes and ids only: an unexpected error's text is not kept.
          perform app.write_audit('protocol.unschedule', 'protocol_run', v_run.id::text,
            jsonb_build_object('status', 'scheduled'),
            jsonb_build_object('status', 'active', 'run_step_id', v_step.id,
                               'not_applied', case when v_code ~ '^[A-Z][A-Z_]*$' then v_code else 'ERROR' end,
                               'hint', case when v_code ~ '^[A-Z][A-Z_]*$' then v_hint end));
          v_reverted := v_reverted + 1;
        end if;
      exception when others then
        raise warning 'price_promo_apply_due: run % could not be put back (%)', v_id, sqlerrm;
        perform app.monitor('cron', 'error', 'price_promo_apply_due_failed',
          format('price_promo_apply_due: run %s could not be put back (%s)', v_id, sqlerrm),
          jsonb_build_object('run_id', v_id, 'step', 'put_back', 'sqlstate', sqlstate));
      end;
    end;
  end loop;
  return jsonb_build_object('applied', v_applied, 'reverted', v_reverted);
end $price_promo_apply_due_0402$;

revoke all on function app.price_promo_apply_due() from public, anon, authenticated;
