set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0286 lesson_sweep — coaching, lane DB (docs/design/coaching/db.md §4.9;
-- build contracts §1.1, §1.4, §1.5, §1.8, C-14, CD-2, CD-8, R25, R26, R28,
-- R30, R31, R38, R44, R45, R63, R64, R65).
--
--   1. app.lesson_strike_record   internal: one lesson strike row for a
--                                 guest-booked enrolment (late cancel, no-show,
--                                 lapsed online hold). Never applies a strike
--                                 (§1.4: no strike inside a coach or court lock)
--                                 and never waits on a strike row (R31, R65).
--   2. app.hold_strikes_settle    re-issued from 20260929000252_hold_strikes.sql:221
--                                 (same signature; the 0268:66 grant to the
--                                 service role stays): one ladder, oldest first,
--                                 over the 0252 lapsed holds (verbatim) and the
--                                 unsettled lesson strikes (skip locked, R31).
--   3. app.lesson_typed_purge     internal: the CD-8 purge (R44: a fixed
--                                 marker, never NULL), once an hour from the
--                                 sweep; its own function so it can be tested.
--   4. app.lesson_sweep           service role: held expiry through Money's
--                                 lesson_hold_expire, deleted students and
--                                 retired coaches, the cut-off (R26, R38), a
--                                 course's start and end, a lesson's end, and
--                                 once an hour the purge.
--   5. cron tp_lesson_sweep       every minute, guarded like 0268's tp_hold_strikes.
--
-- Locks (db.md §2.3 level S, §2.4): the sweep blocks on its first coach only
-- (app.lock_coach) and try-locks every later one (app.try_lock_coach; busy ->
-- that coach's items are skipped this run). It takes no court lock and no
-- waiting FOR UPDATE on reservations (R6, R33, R64): a lesson's court rows are
-- written by guarded status updates in the cancel internals and
-- app.lesson_court_release, a held lesson's hold row only by that function's
-- `skip locked` statement. The walker prints coach_advisory ->
-- match_venue_advisory -> match_tickets (the reservations trigger expanded
-- under a status write; at run time part B returns at once for a row leaving
-- the live set).
--
-- Functions of other coaching files this one calls (each bound late, by name):
--   0283 (DB)    app.enrolment_cancel_internal, app.lesson_cancel_internal,
--                app.course_cancel_internal, app.lesson_court_release,
--                app.lesson_event, app.lesson_places_taken,
--                app.course_places_taken
--   0284 (Money) app.lesson_hold_expire
--   0252         app.hold_standing_key, app.hold_strike_apply

-- ===========================================================================
-- 1. app.lesson_strike_record (db.md §4.9.1)
-- ===========================================================================

-- CD-2: only an enrolment the guest booked themselves, with a live account,
-- strikes; a coach- or desk-booked student, a walk-in, and a coach or staff
-- cancel never do (callers record only late_cancel, no_show and lapsed_hold).
-- R65 / D-26: the existence check is a PLAIN read. It sees a committed row even
-- while hold_strikes_settle holds it FOR UPDATE, and returns; a `skip locked`
-- check would hide that row and send the insert to wait on it in the unique
-- check (the F8 cycle). Only when no row is visible does the insert run, and
-- `on conflict do nothing` absorbs a row committed meanwhile.
create or replace function app.lesson_strike_record(p_enrolment_id uuid, p_lesson_id uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public as $lesson_strike_record_0286$
declare
  v_e     lesson_enrolments%rowtype;
  v_venue uuid;
begin
  if p_kind is null or p_kind not in ('late_cancel', 'no_show', 'lapsed_hold') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;
  if p_enrolment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;
  if p_lesson_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;

  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if not found then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;

  -- The session must be the enrolment's own: its lesson, or a session of its
  -- course (a course strike or mark names the session, db.md §4.3.10).
  select l.venue_id into v_venue
    from lessons l
   where l.id = p_lesson_id
     and (l.id = v_e.lesson_id or (v_e.course_id is not null and l.course_id = v_e.course_id));
  if v_venue is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;

  -- CD-2: nothing for anyone but the guest who booked it with a live account.
  if v_e.booked_by_kind <> 'guest' or v_e.guest_id is null then
    return;
  end if;
  if not exists (select 1 from profiles p where p.id = v_e.guest_id and p.deleted_at is null) then
    return;
  end if;

  -- R65: a plain read, never `skip locked` (see the comment above).
  if exists (select 1 from lesson_strikes s
              where s.enrolment_id = p_enrolment_id and s.lesson_id = p_lesson_id) then
    return;
  end if;

  insert into lesson_strikes (enrolment_id, lesson_id, venue_id, guest_id, kind, struck_at)
  values (p_enrolment_id, p_lesson_id, v_e.venue_id, v_e.guest_id, p_kind, now())
  on conflict (enrolment_id, lesson_id) do nothing;
end $lesson_strike_record_0286$;

comment on function app.lesson_strike_record(uuid, uuid, text) is
  '0286 (db.md §4.9.1; CD-2, R30, R31, R65). Internal. Records one lesson strike (late_cancel | no_show | lapsed_hold) of enrolment p_enrolment_id on session p_lesson_id (its lesson, or a session of its course), for a guest-booked enrolment of a live account only; a coach- or desk-booked student, a walk-in and a deleted account never strike. The existence check is a plain read (a row being settled counts as there), then insert ... on conflict do nothing: it never waits on a strike row. Never touches hold_standing: hold_strikes_settle applies the row later under the principal lock or in tp_hold_strikes. Called under the coach lock by the guest cancel and the attendance marks (0283) and by Money''s lesson_hold_expire (0284). INVALID_ARGUMENT p_kind | p_enrolment_id | p_lesson_id.';

revoke all on function app.lesson_strike_record(uuid, uuid, text) from public, anon, authenticated;

-- ===========================================================================
-- 2. app.hold_strikes_settle (db.md §4.9.2), re-issued from
--    20260929000252_hold_strikes.sql:221
-- ===========================================================================

-- One ladder (D-4): a lapsed court hold, a lapsed online lesson, a late
-- cancel and a no-show count the same, in time order, so the one-day memory
-- of app.hold_strike_apply reads them right. The 0252 rows are found and
-- handled verbatim (at = hold_expires_at). A lesson strike row (at =
-- struck_at) is re-selected FOR UPDATE SKIP LOCKED before it is settled
-- (R31): a row an attendance correction is deleting, or another settle holds,
-- is left for the next run, so a booking that settles its guest's strikes
-- never waits on a coach-lock holder (the F8 cycle). A lesson strike older
-- than two days is settled uncounted: as for the 0252 rows ("a lapse older
-- than the longest memory can no longer change anything"), applying it now
-- could only stack a stale strike on a fresh ladder.
--
-- The callers are unchanged and none holds a coach or court key:
-- tp_hold_strikes (every minute, its own transaction, 0268), hold_slot after
-- lock_principal (0269), and 0283's lesson_book_private, lesson_join and
-- course_join after theirs.
create or replace function app.hold_strikes_settle(p_guests uuid[] default null)
returns int
language plpgsql security definer set search_path = public as $hold_strikes_settle_0286$
declare
  v_since timestamptz;
  v_key   text;
  v_count int := 0;
  r       record;
begin
  select hold_strikes_since into v_since from platform_settings where id;
  if v_since is null then
    return 0;
  end if;

  for r in
    select x.source, x.hold_id, x.enrolment_id, x.lesson_id, x.guest_id, x.venue_id, x.at
      from (
        -- 0252:235-248, verbatim: lapsed mobile holds not yet in the ledger.
        select 'hold'::text           as source,
               h.id                   as hold_id,
               null::uuid             as enrolment_id,
               null::uuid             as lesson_id,
               h.guest_id, h.venue_id,
               h.hold_expires_at      as at,
               h.id::text             as ord_id
          from reservations h
         where h.kind = 'hold'
           and h.source = 'mobile'
           and h.status in ('pending', 'expired')
           and h.guest_id is not null
           and (p_guests is null or h.guest_id = any(p_guests))
           and h.created_at >= v_since
           and h.hold_expires_at < now()
           -- A lapse older than the longest memory can no longer change anything.
           and h.hold_expires_at > now() - interval '2 days'
           and not exists (select 1 from hold_strikes s where s.reservation_id = h.id)
        union all
        -- 0286: the lesson strikes not settled yet (late_cancel, no_show,
        -- lapsed_hold), recorded since the ladder was switched on.
        select 'lesson'::text,
               null::uuid,
               ls.enrolment_id,
               ls.lesson_id,
               ls.guest_id, ls.venue_id,
               ls.struck_at,
               ls.enrolment_id::text || ':' || ls.lesson_id::text
          from lesson_strikes ls
         where ls.settled_at is null
           and ls.struck_at >= v_since
           and (p_guests is null or ls.guest_id = any(p_guests))
      ) x
     order by x.at, x.source, x.ord_id
  loop
    if r.source = 'hold' then
      v_key := app.hold_standing_key(r.guest_id);
      if exists (select 1 from booking_payments bp where bp.hold_id = r.hold_id) then
        insert into hold_strikes (reservation_id, standing_key, counted, struck_at)
        values (r.hold_id, v_key, false, r.at)
        on conflict (reservation_id) do nothing;
      else
        insert into hold_strikes (reservation_id, standing_key, counted, struck_at)
        values (r.hold_id, v_key, true, r.at)
        on conflict (reservation_id) do nothing;
        if found then
          perform app.hold_strike_apply(v_key, r.guest_id, r.venue_id, r.at);
          v_count := v_count + 1;
        end if;
      end if;
    else
      -- R31: never wait on a lesson strike row.
      perform 1
         from lesson_strikes ls
        where ls.enrolment_id = r.enrolment_id
          and ls.lesson_id = r.lesson_id
          and ls.settled_at is null
          for update skip locked;
      if not found then
        continue;
      end if;
      if r.at <= now() - interval '2 days' then
        update lesson_strikes
           set settled_at = now(), counted = false
         where enrolment_id = r.enrolment_id and lesson_id = r.lesson_id and settled_at is null;
      else
        update lesson_strikes
           set settled_at = now(), counted = true
         where enrolment_id = r.enrolment_id and lesson_id = r.lesson_id and settled_at is null;
        perform app.hold_strike_apply(app.hold_standing_key(r.guest_id), r.guest_id, r.venue_id, r.at);
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end $hold_strikes_settle_0286$;

comment on function app.hold_strikes_settle(uuid[]) is
  '0252, lesson strikes since 0286 (db.md §4.9.2; R30, R31). Internal. Settles, oldest first by (time, source, id), one ladder: the lapsed mobile holds (taken since hold_strikes_since, lapsed within 2 days, not yet in hold_strikes; a hold with any booking_payments attempt is recorded uncounted) and the unsettled lesson strikes (late_cancel, no_show, lapsed_hold, struck since hold_strikes_since; each re-selected FOR UPDATE SKIP LOCKED, so a row a mark is deleting or another settle holds waits for the next run; one older than 2 days is settled uncounted). NULL = every account (tp_hold_strikes); else the given accounts (hold_slot and the lesson bookings, after their principal lock). Returns the strikes counted (holds and lessons). Never called under a coach or court lock.';

revoke all on function app.hold_strikes_settle(uuid[]) from public, anon, authenticated;
grant execute on function app.hold_strikes_settle(uuid[]) to service_role;

-- ===========================================================================
-- 3. app.lesson_typed_purge (db.md §4.9.3 phase 3; CD-8, R44)
-- ===========================================================================

-- The CD-8 purge, once an hour from lesson_sweep, at most p_limit rows a run.
-- An enrolment whose lesson (a course: its last covered session) ended more
-- than 365 days ago loses the typed phone and the friend names; a coach- or
-- staff-booked row's typed name becomes a fixed marker, never NULL (NULL would
-- let a reader fall back to the account's name and reveal a link). The
-- deletion marker of 0289 is left as it is. No status change, no event, no
-- lock: nothing reads these columns for state. The predicate narrows
-- lesson_enrolments_purge_due's (0279); created_at bounds the scan, since an
-- enrolment is created before its last session ends.
create or replace function app.lesson_typed_purge(p_limit int default 500)
returns int
language plpgsql security definer set search_path = public as $lesson_typed_purge_0286$
declare
  c_marker constant text := 'Walk-in';
  v_n      int;
begin
  with due as (
    select e.id
      from lesson_enrolments e
     where (e.guest_phone is not null
            or cardinality(e.friend_names) > 0
            or (e.booked_by_kind <> 'guest' and e.guest_name <> 'Walk-in'
                and e.guest_name <> 'Deleted account'))
       and e.created_at < now() - interval '365 days'
       and coalesce((select l.end_at from lessons l where l.id = e.lesson_id),
                    (select max(s.end_at) from lessons s
                      where s.course_id = e.course_id
                        and s.session_no between e.first_session_no
                                             and e.first_session_no + e.sessions_covered - 1))
           < now() - interval '365 days'
     order by e.created_at
     limit greatest(coalesce(p_limit, 500), 1)
  )
  update lesson_enrolments e
     set guest_phone  = null,
         friend_names = '{}'::text[],
         guest_name   = case when e.booked_by_kind <> 'guest' and e.guest_name <> 'Deleted account'
                             then c_marker else e.guest_name end,
         updated_at   = now()
    from due
   where e.id = due.id;
  get diagnostics v_n = row_count;
  return v_n;
end $lesson_typed_purge_0286$;

comment on function app.lesson_typed_purge(int) is
  '0286 (db.md §4.9.3 phase 3; CD-8, R44). Internal, run once an hour by lesson_sweep. At most p_limit enrolments whose lesson (a course: the last covered session) ended more than 365 days ago lose the typed phone and the friend names, and a coach- or staff-booked row''s typed name becomes the fixed marker ''Walk-in'' (never NULL; a ''Deleted account'' marker stays). No status change, no event, no lock. Returns the rows purged.';

revoke all on function app.lesson_typed_purge(int) from public, anon, authenticated;

-- ===========================================================================
-- 4. app.lesson_sweep (db.md §4.9.3)
-- ===========================================================================

-- Phase 1 finds the due items, at most 200, without a lock, sorted by coach
-- and then by step. Phase 2 works coach by coach: the first coach is locked by
-- blocking, every later one by try-lock only (busy -> its items are skipped
-- this run, `skipped`). Every item runs in its own exception block, re-reads
-- its row under the coach lock and asserts its branch (app.venue_id); an error
-- rolls that item back, is counted and warned, and the next run tries again.
-- Phase 3, once an hour, is the CD-8 purge. Every step selects only rows that
-- still need it and every change is one-way or a stamp, so a second run in
-- the same minute does nothing.
--
-- The steps (db.md §4.9.3):
--   1 held_expire     a held enrolment past hold_expires_at, no payment open
--                     inside the ten-minute grace and none succeeded ->
--                     Money's app.lesson_hold_expire (R25, R30; it decides
--                     again and records the lapsed_hold strike)
--   2 deleted         a live enrolment of a deleted account whose lesson (a
--                     course: its last covered session) has not started ->
--                     account_deleted (refund reason account_deleted, R28);
--                     a pending link is dropped instead (C-21, below)
--   3 retired_lesson  a retired coach's held or scheduled private or group
--     retired_course  lesson not yet started, and course with a session left
--                     to start -> coach_retired (a coach retired by account
--                     deletion, 0289, which takes no coach lock; set_coach_status
--                     cancels at once)
--   4 cutoff_lesson   a scheduled group session whose cut-off is due
--   5 cutoff_course   an open course whose cut-off is due
--                     -> judged on booked places, only before the session's
--                     start (R26), deferred while held places could still reach
--                     the minimum until start - 10 minutes (R38)
--   6 course_running  an open course whose session 1 has started
--   7 complete_lesson a scheduled lesson 15 minutes past its end -> completed,
--                     its court row completed
--   8 complete_course a running course with no held or scheduled session left
create or replace function app.lesson_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $lesson_sweep_0286$
declare
  v_c       jsonb := jsonb_build_object(
                       'held_expired', 0, 'held_waiting', 0, 'deleted_cancelled', 0, 'links_dropped', 0,
                       'retired_cancelled', 0, 'under_filled', 0, 'courses_under_filled', 0,
                       'judged_late', 0, 'cutoffs_confirmed', 0, 'deferred', 0, 'courses_running', 0,
                       'completed', 0, 'courses_completed', 0);
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

          if now() >= v_l.start_at then
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

          if v_start is null or now() >= v_start then
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
      end if;

      -- The count moves last: an item that raised above is never counted.
      if v_key is not null then
        v_c := jsonb_set(v_c, array[v_key], to_jsonb(coalesce((v_c ->> v_key)::int, 0) + 1));
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'lesson_sweep: % % left for the next run: % (%)', v_works[v_i], v_ids[v_i], sqlerrm, sqlstate;
    end;
  end loop;

  -- Phase 3, once an hour: the CD-8 purge (app.lesson_typed_purge, above).
  if extract(minute from now()) = 0 then
    begin
      v_purged := app.lesson_typed_purge(500);
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'lesson_sweep: CD-8 purge left for the next run: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  return v_c || jsonb_build_object('purged', v_purged, 'skipped', v_skipped, 'errors', v_errors);
end $lesson_sweep_0286$;

comment on function app.lesson_sweep() is
  '0286 (db.md §4.9.3). Internal, service role (cron tp_lesson_sweep, every minute). Phase 1 finds at most 200 due items without a lock, by coach then step; phase 2 blocks on the first coach (lock_coach) and try-locks every later one (busy -> its items skipped), each item in its own exception block, re-read under the lock: 1 a held enrolment past its hold with no payment that can still land -> Money''s lesson_hold_expire (R25, R30); 2 a live enrolment of a deleted account not yet started -> enrolment_cancel_internal account_deleted (R28), or a pending typed-phone link dropped silently (C-21); 3 a retired coach''s lessons not started and courses with a session left -> coach_retired; 4, 5 the cut-off of a group session or a course, judged on booked places only before the session''s (session 1''s) start (R26: judged later it stamps and writes under_filled {late: true}, cancelling nothing), deferred while held places could reach the minimum until start - 10 minutes (R38), else under_filled (C-14); 6 open -> running at session 1''s start; 7 a scheduled lesson 15 minutes past its end -> completed with its court row; 8 a running course with no live session -> completed. Once an hour, the CD-8 purge: enrolments 365 days past their last session lose the typed phone and friend names, and a typed name becomes ''Walk-in'' (R44: a marker, never NULL), at most 500 a run. No court lock and no waiting FOR UPDATE on reservations (R6, R33, R64). Returns {held_expired, held_waiting, deleted_cancelled, links_dropped, retired_cancelled, under_filled, courses_under_filled, judged_late, cutoffs_confirmed, deferred, courses_running, completed, courses_completed, purged, skipped, errors}.';

revoke all on function app.lesson_sweep() from public, anon, authenticated;
grant execute on function app.lesson_sweep() to service_role;

-- ===========================================================================
-- 5. tp_lesson_sweep: every minute, its own transaction. Guarded like 0268's
--    tp_hold_strikes. After a hosted push, cron.job must have the row
--    (packages/db/CLAUDE.md).
-- ===========================================================================
do $lesson_sweep_cron_0286$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_lesson_sweep not scheduled';
    return;
  end if;
  perform cron.schedule('tp_lesson_sweep', '* * * * *', 'select app.lesson_sweep();');
end $lesson_sweep_cron_0286$;
