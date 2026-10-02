set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0295 lesson_payment_strikes_sweep — the coaching post-build review, the
-- online lesson payment, the strike ladder and the sweep (plan "Coaching:
-- make it bulletproof" §1, items DB-35 to DB-41; decisions D4 and D5, build
-- contracts §1.15). 0273–0289 are not edited: every function below is
-- re-issued from its latest body (0284, 0286), verbatim except for the change
-- named and marked 0295; dollar tags _0295. No signature changes; every
-- re-issued function keeps its grants (create or replace), re-stated below.
--
--   DB-35 A guest who paid in time was refunded, left held, struck and could
--         pay again (D5).
--         app.lesson_settle_success: a SUCCESS on a HELD enrolment that is
--         refunded slot_lost or venue_offline now expires the enrolment
--         (cancel_kind expired) and, for a held private lesson, the lesson
--         (payment_expired) and its hold row (app.lesson_court_release
--         'expired', skip locked), with an expired event {lesson_id, reason}
--         and no strike. amount_mismatch still leaves it held (money.md
--         §6.3). app.lesson_hold_expire records no lapsed_hold strike when
--         any lesson row of the enrolment has succeeded_at (the guest paid,
--         whatever happened to the money after). app.lesson_payment_prepare
--         refuses LESSON_NOT_PAYABLE detail started once the first covered
--         session has started (or none is left), and stretches the hold to
--         the payment deadline but never past that start.
--   DB-36 app.lesson_hold_expire records no lapsed_hold strike when the
--         branch now has coaching off or lesson payment set to desk: the
--         venue's switch made the payment impossible (D5).
--   DB-37 app.hold_strikes_settle leaves a lapsed_hold strike unsettled
--         while its enrolment has a lesson payment created or pending, so a
--         late SUCCESS can still withdraw it (R65, D5); a strike older than
--         two days is still settled uncounted.
--   DB-38 app.lesson_settle_success: a SUCCESS for a place at a CLOSED branch
--         (venues.status, not open_venue_ids: a paused branch is not
--         caught) is slot_lost before the held and the expired branches, so
--         a late success never revives a lesson there.
--   DB-39 app.lesson_sweep, new step 9 hold_release: a pending kind hold
--         reservation whose lesson is no longer held (its release was
--         skipped by lesson_court_release's SKIP LOCKED, R25) is expired by
--         app.lesson_court_release(lesson, 'expired') under the coach lock
--         the sweep holds; a row still locked is retried next minute.
--         Correction to the R25 comments of 0283:449-457 and 0284:805-813:
--         the skip-locked release expires a hold "another transaction holds"
--         only when that transaction is expiring it; any other holder (a
--         prepare stretching it, a SUCCESS turning it into the lesson's row)
--         may commit without expiring it, which this step catches.
--   DB-40 New internal app.lesson_refund_net(): 0284's R28 loop (a succeeded
--         lesson row whose enrolment was cancelled or expired, or whose
--         lesson or course was cancelled, with refund_due_online_iqd > 0:
--         app.lesson_refund_start), at most 20 rows a run, FOR UPDATE SKIP
--         LOCKED. app.deposits_due_for_reconcile calls it in place of the
--         loop, and app.lesson_sweep calls it every minute in its own
--         exception block, so the net no longer waits for some other
--         payment to be open (0242's deposit_nudge only calls the reconciler
--         then).
--   DB-41 app.lesson_sweep: a cut-off judged after the start (R26's late
--         branch) cancels a group session or a course with no booked or
--         held place (D4): nobody to disrupt, no money to move, its courts
--         freed. An empty course's sessions already under way are cancelled
--         too (C-19 forbids one session alone; the whole course goes). A
--         group or course with places is still left running.
--   The sweep's answer gains holds_released and refunds_started.
--
-- Locks. No new rank. lesson_settle_success still takes no lock of its own:
-- its new writes are status updates and lesson_court_release's skip-locked
-- statement (the caller, deposit_apply, already holds the hold row).
-- hold_strikes_settle's new test is a plain read before its skip-locked row
-- lock. lesson_refund_net locks booking_payments rows (unranked, as in
-- 0284) with SKIP LOCKED, then lesson_refund_start re-locks the same row;
-- from the sweep it runs after phase 2, under the coach keys phase 2 took,
-- which come first in ORDER. The sweep's hold release is lesson_court_release
-- (skip locked, never waiting). No new error code (LESSON_NOT_PAYABLE gains
-- the detail started; clients read unknown details as the generic line).

-- ===========================================================================
-- DB-40: app.lesson_refund_net (new)
-- ===========================================================================

-- 0284's R28 net, verbatim, in a function of its own (DB-40): the reconciler
-- and the lesson sweep both run it. A succeeded lesson row whose enrolment was
-- cancelled or expired, or whose lesson or course was cancelled, and that
-- still has online money due back: app.lesson_refund_start refunds exactly
-- what the engine says is due (never more, one refund per row). No time
-- window: a venue cancel can come weeks after a late cancel. The cheap tests
-- run first, so the engine runs only on those rows; the refund-due test keeps
-- a late cancel's kept row (succeeded forever, nothing due) out of the limit.
-- SKIP LOCKED: a row another run or a cancel holds is theirs this time.
create or replace function app.lesson_refund_net()
returns int
language plpgsql security definer set search_path = public as $lesson_refund_net_0295$
declare
  v_row record;
  v_n   int := 0;
begin
  for v_row in
    select bp.id, bp.lesson_enrolment_id
      from booking_payments bp
      join lesson_enrolments e on e.id = bp.lesson_enrolment_id
     where bp.purpose = 'lesson'
       and bp.status = 'succeeded'
       and (e.status in ('cancelled', 'expired')
            or exists (select 1 from lessons l where l.id = e.lesson_id and l.status = 'cancelled')
            or exists (select 1 from courses c where c.id = e.course_id and c.status = 'cancelled'))
       and coalesce((app.lesson_enrolment_money(e.id) ->> 'refund_due_online_iqd')::bigint, 0) > 0
     order by bp.id
     limit 20
       for update of bp skip locked
  loop
    v_n := v_n + coalesce(app.lesson_refund_start(v_row.lesson_enrolment_id, null), 0);
  end loop;
  return v_n;
end $lesson_refund_net_0295$;

comment on function app.lesson_refund_net() is
  '0295 (DB-40; R28, money.md §6.6). Internal. The net for a coaching refund that never started: up to 20 succeeded lesson rows (FOR UPDATE SKIP LOCKED) whose enrolment was cancelled or expired, or whose lesson or course was cancelled, and whose enrolment the engine says is still owed refund_due_online_iqd > 0, each through app.lesson_refund_start (never more than the engine says, one refund per row). No time window. Called by app.deposits_due_for_reconcile and, every minute in its own exception block, by app.lesson_sweep. Returns the refunds started.';

revoke all on function app.lesson_refund_net() from public, anon, authenticated;

-- ===========================================================================
-- DB-35: app.lesson_payment_prepare (re-issued from 0284:82)
-- ===========================================================================
create or replace function app.lesson_payment_prepare(
  p_guest_id     uuid,
  p_enrolment_id uuid,
  p_locale       text,
  p_provider     text
) returns jsonb
language plpgsql security definer set search_path = public as $lesson_payment_prepare_0295$
declare
  v         booking_payments%rowtype;
  e         lesson_enrolments%rowtype;
  l         lessons%rowtype;
  h         reservations%rowtype;
  v_profile profiles%rowtype;
  v_coach   uuid;
  v_start   timestamptz;
  v_rules   jsonb;
  v_window  int;
  v_tries   int;
  v_reused  boolean := false;
begin
  if p_guest_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_id';
  end if;
  if p_enrolment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;
  if p_provider is null or p_provider not in ('qi', 'fake') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_provider';
  end if;

  select * into v_profile from profiles where id = p_guest_id;
  if not found or v_profile.deleted_at is not null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Someone else's enrolment reads the same as none (0242:280-285).
  select * into e from lesson_enrolments where id = p_enrolment_id;
  if not found or e.guest_id is distinct from p_guest_id then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The coach of the lesson or the course: it never changes, so the unlocked
  -- read names the right key (§1.4). Then, for a private lesson, its court
  -- hold: the court, then the row (coach -> court -> reservations, the
  -- deposit_prepare shape, 0242:351-352).
  if e.lesson_id is not null then
    select * into l from lessons where id = e.lesson_id;
    v_coach := l.coach_id;
  else
    select co.coach_id into v_coach from courses co where co.id = e.course_id;
  end if;
  perform app.lock_coach(v_coach);
  if e.lesson_id is not null and l.kind = 'private' then
    perform app.lock_court((select r.court_id from reservations r
                             where r.lesson_id = l.id and r.kind = 'hold'
                             order by r.created_at desc, r.id desc
                             limit 1));
    select * into h from reservations
     where lesson_id = l.id and kind = 'hold'
     order by created_at desc, id desc
     limit 1
       for update;
  end if;
  perform set_config('app.venue_id', e.venue_id::text, true);

  -- Re-read under the coach lock: a cancel or the sweep may have moved it.
  select * into e from lesson_enrolments where id = p_enrolment_id;
  if e.lesson_id is not null then
    select * into l from lessons where id = e.lesson_id;
  end if;

  -- The enrolment's live attempt: hand it back (a double tap, a second
  -- phone). The edge asks the gateway about one past its deadline.
  select * into v from booking_payments
   where lesson_enrolment_id = e.id and purpose = 'lesson' and status in ('created', 'pending')
   for update;
  if found and e.status = 'held' then
    v_reused := true;
  else
    -- What cannot be paid online (money.md §6.2 step 6).
    if e.status in ('cancelled', 'expired') then
      raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = e.status;
    end if;
    if e.payment_mode <> 'online' then
      raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = 'desk';
    end if;
    if e.status <> 'held' then
      raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = e.status;
    end if;
    -- A lapsed hold (R25: a private lesson's hold row expired by TTL counts too).
    if e.hold_expires_at is null or e.hold_expires_at < now()
       or (l.kind = 'private' and (h.id is null or h.kind <> 'hold' or h.status <> 'pending')) then
      raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = 'expired';
    end if;
    if e.price_iqd <= 0 then
      raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = 'free';
    end if;

    -- The branch's switches: coaching on, and the owner has not turned online
    -- lesson payment off since the hold was taken (CD-1).
    v_rules := app.coaching_rules(e.venue_id);
    if not coalesce((v_rules ->> 'coaching_enabled')::boolean, false) then
      raise exception 'COACHING_OFF' using errcode = 'P0001';
    end if;
    if coalesce(v_rules ->> 'lesson_payment_mode', 'desk') = 'desk' then
      raise exception 'ONLINE_PAYMENT_OFF' using errcode = 'P0001';
    end if;

    if nullif(btrim(coalesce(v_profile.phone, '')), '') is null then
      raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
        hint = 'add a phone number to your profile before paying';
    end if;
    -- C-26, R50: online lesson money only under terms that carry the lessons
    -- section, accepted by this guest (NULL lesson_terms_version refuses,
    -- unlike match_terms_ok). The same test lesson_guest(true) makes on 0283's
    -- online booking paths.
    if not app.lesson_terms_ok(v_profile.terms_version) then
      raise exception 'TERMS_REQUIRED' using errcode = 'P0001', detail = 'lessons';
    end if;

    -- The first covered session: the lesson, or the course's first one this
    -- enrolment pays for.
    if e.lesson_id is not null then
      v_start := l.start_at;
    else
      select min(s.start_at) into v_start
        from lessons s
       where s.course_id = e.course_id
         and s.session_no between e.first_session_no and e.first_session_no + e.sessions_covered - 1;
    end if;
    -- 0295 (DB-35): a place whose first covered session has started (or has
    -- none left) cannot be paid for: a SUCCESS would only be slot_lost.
    if v_start is null or v_start <= now() then
      raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = 'started';
    end if;
    perform app.assert_not_degraded_for(v_start, e.venue_id);

    -- Three attempts per enrolment (the per-hold rule, 0242:393-397).
    select count(*) into v_tries from booking_payments
     where lesson_enrolment_id = e.id and purpose = 'lesson';
    if v_tries >= 3 then
      raise exception 'TOO_MANY_ATTEMPTS' using errcode = 'P0001',
        hint = 'three payment attempts on one lesson booking; pay at the desk or book again';
    end if;

    v_window := coalesce((v_rules ->> 'deposit_window_seconds')::int, 900);

    begin
      -- A lesson row (R22): its branch and enrolment named, no booking, no
      -- ticket count; hold_id the court hold of a private lesson, else NULL.
      -- No part payments: the whole place (what a held enrolment owes).
      insert into booking_payments
        (venue_id, reservation_id, hold_id, lesson_enrolment_id, guest_id, purpose, ticket_count,
         provider, sandbox, request_id, amount_iqd, quoted_price_iqd, locale, status, deadline_at)
      values
        (e.venue_id, null, h.id, e.id, p_guest_id, 'lesson', null,
         p_provider, coalesce(v_profile.payment_sandbox, false), gen_random_uuid(),
         e.price_iqd, e.price_iqd,
         case when p_locale in ('en', 'ar') then p_locale else 'ar' end,
         'created', now() + make_interval(secs => v_window))
      returning * into v;
    exception when unique_violation then
      -- booking_payments_one_active_lesson (or _one_active on the hold) let
      -- another attempt through first: hand that one back.
      select * into v from booking_payments
       where lesson_enrolment_id = e.id and purpose = 'lesson' and status in ('created', 'pending')
       for update;
      if not found then
        raise;
      end if;
      v_reused := true;
    end;

    if not v_reused then
      -- The payment window owns the hold now (0242:411-414): the enrolment, a
      -- private lesson and its hold row live at least as long. hold_expires_at
      -- is not a column reservations_match fires on, and the row stays pending.
      -- 0295 (DB-35): never past the first covered session's start.
      update lesson_enrolments
         set hold_expires_at = greatest(hold_expires_at, least(v.deadline_at, v_start)),
             updated_at      = now()
       where id = e.id and status = 'held';
      if l.kind = 'private' then
        update lessons
           set hold_expires_at = greatest(hold_expires_at, least(v.deadline_at, v_start)),
               updated_at      = now()
         where id = l.id and status = 'held';
        update reservations
           set hold_expires_at = greatest(hold_expires_at, least(v.deadline_at, v_start))
         where id = h.id and kind = 'hold' and status = 'pending';
      end if;

      perform app.deposit_event(v.id, 'begin', null, null, null,
                                jsonb_build_object('amount_iqd', v.amount_iqd, 'provider', v.provider,
                                                   'sandbox', v.sandbox, 'lesson_enrolment_id', e.id));
      perform app.write_audit('lesson.payment_begin', 'booking_payments', v.id::text, null,
                              jsonb_build_object('payment_id', v.id, 'enrolment_id', e.id,
                                                 'amount_iqd', v.amount_iqd, 'sandbox', v.sandbox));
    end if;
  end if;

  return jsonb_build_object(
    'id',                  v.id,
    'request_id',          v.request_id,
    'purpose',             'lesson',
    'status',              v.status,
    'provider',            v.provider,
    'sandbox',             v.sandbox,
    'amount_iqd',          v.amount_iqd,
    'deadline_at',         v.deadline_at,
    'form_url',            v.form_url,
    'provider_payment_id', v.provider_payment_id,
    'locale',              v.locale,
    'reused',              v_reused,
    'enrolment_id',        e.id,
    'lesson_id',           e.lesson_id,
    'course_id',           e.course_id,
    'guest_phone',         v_profile.phone,
    'guest_name',          v_profile.full_name);
end $lesson_payment_prepare_0295$;

comment on function app.lesson_payment_prepare(uuid, uuid, text, text) is
  '0284, 0295 (R3; money.md §6.2). Service role (edge lesson-begin, on behalf of the JWT user p_guest_id). Returns the enrolment''s live attempt (reused), or records a new one (purpose lesson, status created, the whole place, deposit_window_seconds) and stretches the enrolment, a private lesson and its court hold to the payment deadline, never past the first covered session''s start (0295, DB-35). Locks: the coach, then a private lesson''s hold court and hold row. Refusals in order: INVALID_ARGUMENT (p_guest_id, p_enrolment_id, p_provider), ACCOUNT_REQUIRED, ENROLMENT_NOT_FOUND (unknown or another guest''s), LESSON_NOT_PAYABLE (detail cancelled | expired | desk | booked | expired for a lapsed hold | free), COACHING_OFF, ONLINE_PAYMENT_OFF, PHONE_REQUIRED, TERMS_REQUIRED detail lessons (C-26, R50), LESSON_NOT_PAYABLE detail started (the first covered session has started, or none is left; 0295), DEGRADED_LOCKOUT, TOO_MANY_ATTEMPTS (3 per enrolment). Returns {id, request_id, purpose, status, provider, sandbox, amount_iqd, deadline_at, form_url, provider_payment_id, locale, reused, enrolment_id, lesson_id, course_id, guest_phone, guest_name}.';

revoke all on function app.lesson_payment_prepare(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function app.lesson_payment_prepare(uuid, uuid, text, text) to service_role;

-- ===========================================================================
-- DB-35, DB-38: app.lesson_settle_success (re-issued from 0284:316)
-- ===========================================================================
-- The caller (deposit_apply) holds the coach lock, for a private lesson every
-- court in p_locked (the branch's active courts, R34) and the hold row, has
-- expired the branch's stale holds over the lesson's period, and holds the
-- payment row. This function takes no lock of its own, no waiting FOR UPDATE
-- on reservations, and calls nothing that does (the walker walks it alone,
-- SERVICE_WALK): 0295's hold release is lesson_court_release's skip-locked
-- statement on the hold row the caller already holds. It never raises on a
-- valid row: a raise rolls back deposit_apply, the webhook answers 500 and
-- the reconciler loops (the ticket_settle_success rule). Every booking write
-- sits in one sub-block where a check, unique or exclusion violation is
-- slot_lost and DEGRADED_LOCKOUT is venue_offline (R29).
create or replace function app.lesson_settle_success(p_payment_id uuid, p_locked uuid[])
returns text
language plpgsql security definer set search_path = public as $lesson_settle_success_0295$
declare
  v           booking_payments%rowtype;
  e           lesson_enrolments%rowtype;
  l           lessons%rowtype;          -- a private or group enrolment's lesson
  c           courses%rowtype;          -- a course enrolment's course
  h           reservations%rowtype;     -- a private lesson's court hold
  v_reason    text := null;
  v_gone      boolean;
  v_expired   boolean := false;         -- a late SUCCESS (the enrolment had expired)
  v_revived   boolean := false;
  v_first     uuid;                     -- the first covered session
  v_start     timestamptz;              -- its start
  v_court     uuid;
  v_coach_ok  boolean;
  v_taken     int;
  v_total     int;
  v_data      jsonb;
begin
  select * into v from booking_payments where id = p_payment_id;
  if not found or v.purpose <> 'lesson' then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into e from lesson_enrolments where id = v.lesson_enrolment_id;
  if e.lesson_id is not null then
    select * into l from lessons where id = e.lesson_id;
    v_first := l.id;
    v_start := l.start_at;
  elsif e.course_id is not null then
    select * into c from courses where id = e.course_id;
    select s.id, s.start_at into v_first, v_start
      from lessons s
     where s.course_id = e.course_id
       and s.session_no between e.first_session_no and e.first_session_no + e.sessions_covered - 1
     order by s.start_at, s.session_no
     limit 1;
  end if;
  v_expired := e.status = 'expired';

  select p.deleted_at is not null into v_gone from profiles p where p.id = v.guest_id;

  if v.guest_id is null or coalesce(v_gone, true) then
    -- 1. The payer is gone (a hard delete, or deleted while paying).
    v_reason := 'account_deleted';
  elsif exists (select 1 from booking_payments o
                 where o.lesson_enrolment_id = v.lesson_enrolment_id and o.id <> v.id
                   and o.purpose = 'lesson'
                   and o.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')
                   and coalesce(o.refund_reason, '') not in ('amount_mismatch', 'duplicate_success',
                                                             'slot_lost', 'venue_offline')) then
    -- 2. Another payment already paid for this enrolment (and was not handed
    -- back as not ours): this one goes back whole.
    v_reason := 'duplicate_success';
  elsif e.id is null or e.status not in ('held', 'expired') then
    -- 5. Cancelled while the bank was thinking, or anything else.
    v_reason := 'slot_lost';
  elsif exists (select 1 from venues vn where vn.id = e.venue_id and vn.status = 'closed') then
    -- 0295 (DB-38): the branch closed meanwhile. Never booked there, and a
    -- late success never revives a lesson there. venues.status, not
    -- open_venue_ids: a paused branch still trades its booked lessons.
    v_reason := 'slot_lost';
  else
    begin
      perform app.assert_not_degraded_for(v_start, e.venue_id);

      if v_first is null or v_start <= now() then
        -- The first covered session has started: the place cannot be given.
        v_reason := 'slot_lost';

      elsif e.status = 'held' then
        -- 3. The normal case.
        if e.course_id is not null then
          -- R29: the place re-checked, this enrolment left out.
          if c.status not in ('open', 'running')
             or app.course_places_taken(c.id, e.id) + e.party_size > c.max_places then
            v_reason := 'slot_lost';
          end if;
        elsif l.kind = 'group' then
          if l.status <> 'scheduled'
             or app.lesson_places_taken(l.id, e.id) + e.party_size > l.max_places then
            v_reason := 'slot_lost';
          end if;
        elsif l.status <> 'held' then
          v_reason := 'slot_lost';
        else
          -- A private lesson: its hold becomes the lesson's court row in place
          -- (same court and period: the exclusion holds as it did), or, when
          -- the hold expired by TTL (R25), a court is picked again from the
          -- locked set (R34) and the row inserted in the shape of 0283's
          -- lesson_create_internal.
          select * into h from reservations where id = v.hold_id;
          if h.id is not null and h.lesson_id = l.id and h.kind = 'hold' and h.status = 'pending' then
            update reservations
               set kind            = 'lesson',
                   status          = 'confirmed',
                   hold_expires_at = null
             where id = h.id;
          else
            v_court := app.lesson_pick_court(l.venue_id, l.period, p_locked);
            if v_court is null then
              v_reason := 'slot_lost';
            else
              insert into reservations
                (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source, lesson_id)
              values
                (l.venue_id, v_court, 'lesson', 'confirmed', l.start_at, l.end_at, null, 'Lesson',
                 coalesce(h.source, 'mobile'), l.id);
            end if;
          end if;
          if v_reason is null then
            update lessons
               set status          = 'scheduled',
                   hold_expires_at = null,
                   updated_at      = now()
             where id = l.id;
          end if;
        end if;

        if v_reason is null then
          update lesson_enrolments
             set status          = 'booked',
                 hold_expires_at = null,
                 updated_at      = now()
           where id = e.id;
        end if;

      else
        -- 4. A late SUCCESS after the window (R29): revived when everything is
        -- still free. DB's state machines: expired -> scheduled (the lesson),
        -- expired -> booked (the enrolment); writer: this function.
        if e.course_id is not null then
          if c.status not in ('open', 'running')
             or exists (select 1 from lessons s
                         where s.course_id = c.id
                           and s.session_no between e.first_session_no
                                                and e.first_session_no + e.sessions_covered - 1
                           and (s.start_at <= now() or s.status <> 'scheduled'))
             or app.course_places_taken(c.id, e.id) + e.party_size > c.max_places then
            v_reason := 'slot_lost';
          end if;
        elsif l.kind = 'group' then
          if l.status <> 'scheduled'
             or app.lesson_places_taken(l.id, e.id) + e.party_size > l.max_places then
            v_reason := 'slot_lost';
          end if;
        else
          -- A private lesson: the coach still active at the branch and free
          -- (hours, time off, no other live lesson; the expired one is not
          -- live), a court free in the locked set.
          select co.status = 'active'
                 and exists (select 1 from coach_branches cb
                              where cb.coach_id = co.id and cb.venue_id = l.venue_id and cb.active)
            into v_coach_ok
            from coaches co
           where co.id = l.coach_id;
          if l.status <> 'expired' or not coalesce(v_coach_ok, false)
             or not coalesce(app.coach_available(l.coach_id, l.venue_id, l.period), false) then
            v_reason := 'slot_lost';
          else
            v_court := app.lesson_pick_court(l.venue_id, l.period, p_locked);
            if v_court is null then
              v_reason := 'slot_lost';
            else
              -- lessons_ended wants these three NULL off cancelled|expired;
              -- lessons_coach_no_overlap has the last word (a violation is
              -- slot_lost below).
              update lessons
                 set status          = 'scheduled',
                     cancel_reason   = null,
                     cancelled_at    = null,
                     hold_expires_at = null,
                     updated_at      = now()
               where id = l.id;
              select * into h from reservations where id = v.hold_id;
              insert into reservations
                (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source, lesson_id)
              values
                (l.venue_id, v_court, 'lesson', 'confirmed', l.start_at, l.end_at, null, 'Lesson',
                 coalesce(h.source, 'mobile'), l.id);
            end if;
          end if;
        end if;

        if v_reason is null then
          update lesson_enrolments
             set status          = 'booked',
                 cancel_kind     = null,
                 cancelled_at    = null,
                 hold_expires_at = null,
                 updated_at      = now()
           where id = e.id;
          v_revived := true;
        end if;
      end if;
    exception
      when check_violation or unique_violation or exclusion_violation then
        -- R29: a stale live court row of the lesson, a coach booked meanwhile,
        -- a place another guest took: the money goes back.
        v_reason := 'slot_lost';
        v_revived := false;
      when raise_exception then
        if sqlerrm = 'DEGRADED_LOCKOUT' then
          v_reason := 'venue_offline';
          v_revived := false;
        else
          raise;
        end if;
    end;
  end if;

  -- 0295 (DB-35, D5): the guest paid in time, but the place cannot be given
  -- (slot_lost, venue_offline): the money goes back whole below, so the
  -- place ends now, as an expiry with no strike. Left held, it would be
  -- payable again and the sweep would expire it later with a lapsed_hold
  -- strike. A private lesson and its hold row end with it (the hold row is
  -- the one deposit_apply holds, so the skip-locked release never skips it).
  -- amount_mismatch never comes here (deposit_apply refunds it before this
  -- function): that place stays held (money.md §6.3).
  if not v_expired and e.status = 'held' and v_reason in ('slot_lost', 'venue_offline') then
    update lesson_enrolments
       set status          = 'expired',
           cancel_kind     = 'expired',
           cancelled_at    = now(),
           hold_expires_at = null,
           updated_at      = now()
     where id = e.id and status = 'held';
    if e.lesson_id is not null and l.kind = 'private' and l.status = 'held' then
      update lessons
         set status          = 'expired',
             cancel_reason   = 'payment_expired',
             cancelled_at    = now(),
             hold_expires_at = null,
             updated_at      = now()
       where id = l.id and status = 'held';
      perform app.lesson_court_release(l.id, 'expired');
    end if;
    -- The push trigger reads data.reason (a refund, not a lapse).
    perform app.lesson_event(e.venue_id, v_first, e.course_id, e.id, 'expired', 'system',
                             null, null, 'payment_expired',
                             jsonb_build_object('lesson_id', v_first, 'reason', v_reason));
  end if;

  -- R65: a late successful payment withdraws the guest's unsettled lapsed_hold
  -- strike: the guest did pay, the bank was slow. Never waits on a row a settle
  -- holds (R31: skip locked; a row being settled counts as settled).
  if v_expired and coalesce(v_reason, '') not in ('duplicate_success', 'account_deleted') then
    delete from lesson_strikes
     where (enrolment_id, lesson_id) in
           (select s.enrolment_id, s.lesson_id
              from lesson_strikes s
             where s.enrolment_id = e.id and s.kind = 'lapsed_hold' and s.settled_at is null
               for update skip locked);
  end if;

  update booking_payments
     set status       = 'succeeded',
         succeeded_at = coalesce(succeeded_at, now()),
         failure_code = null,
         updated_at   = now()
   where id = v.id;

  if v_reason is not null then
    perform app.deposit_begin_refund(v.id, v_reason);
    perform app.deposit_nudge();
    return 'refund_pending';
  end if;

  -- The event the push trigger reads (R40, R78): the coach learns of a paid
  -- student (coach.new_student); the guest's payment screen is open (X15).
  -- Places are the booked ones after the change; a private lesson sends none.
  if e.course_id is not null then
    select coalesce(sum(x.party_size), 0)::int into v_taken
      from lesson_enrolments x where x.course_id = e.course_id and x.status = 'booked';
    v_total := c.max_places;
  elsif l.kind = 'group' then
    select coalesce(sum(x.party_size), 0)::int into v_taken
      from lesson_enrolments x where x.lesson_id = l.id and x.status = 'booked';
    v_total := l.max_places;
  end if;
  v_data := jsonb_build_object('payment_id', v.id, 'amount_iqd', v.amount_iqd, 'lesson_id', v_first);
  if v_total is not null then
    v_data := v_data || jsonb_build_object('places_taken', v_taken, 'places_total', v_total);
  end if;
  if v_revived then
    v_data := v_data || jsonb_build_object('revived', true);
  end if;
  perform app.lesson_event(e.venue_id, v_first, e.course_id, e.id, 'paid_online', 'system',
                           null, null, null, v_data);
  perform app.write_audit('lesson.paid_online', 'booking_payments', v.id::text, null,
                          jsonb_build_object('payment_id', v.id, 'enrolment_id', e.id,
                                             'lesson_id', e.lesson_id, 'course_id', e.course_id,
                                             'amount_iqd', v.amount_iqd, 'sandbox', v.sandbox,
                                             'revived', v_revived));
  return 'succeeded';
end $lesson_settle_success_0295$;

comment on function app.lesson_settle_success(uuid, uuid[]) is
  '0284, 0295 (R29, R34, R65, R70; money.md §6.4). Internal (deposit_apply''s lesson arm, which holds the coach, a private lesson''s branch courts p_locked and its hold row, has expired the stale holds over the lesson''s period, and holds the payment row). SUCCESS on a lesson row: a held enrolment is booked (a private lesson scheduled, its hold turned into the lesson''s court row in place, or a court re-picked from p_locked when the hold expired by TTL; a group or course place re-checked with itself left out); an expired one is revived when the lesson, the coach, a court and the place are still free (expired -> scheduled / booked); otherwise the whole row goes back: account_deleted, duplicate_success, slot_lost (started, full, gone, cancelled, any check, unique or exclusion violation), venue_offline (DEGRADED_LOCKOUT); a place at a closed branch is slot_lost before either branch (0295, DB-38). 0295 (DB-35): a held place refunded slot_lost or venue_offline is expired at once (cancel_kind expired; a held private lesson expired payment_expired with its hold row, through lesson_court_release expired), with an expired event {lesson_id, reason} and no strike. A late SUCCESS withdraws the unsettled lapsed_hold strike. Writes the paid_online event ({payment_id, amount_iqd, lesson_id, places_taken, places_total, revived}) and audit lesson.paid_online; no push call (R40). Takes no lock of its own (the hold release is skip locked, on the row the caller holds); never raises on a valid row.';

revoke all on function app.lesson_settle_success(uuid, uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- DB-35, DB-36: app.lesson_hold_expire (re-issued from 0284:591)
-- ===========================================================================
-- One definition for deposit_apply's EXPIRED branch and 0286's lesson_sweep
-- (D8). The caller holds the coach lock (the sweep, deposit_apply) or is
-- deposit_apply's lesson arm. No court lock: every write is status-only, and a
-- private lesson's hold row is expired by app.lesson_court_release's
-- skip-locked statement (R25, R64), never waiting; a hold row that statement
-- skips is expired by the sweep's hold_release step (0295, DB-39).
create or replace function app.lesson_hold_expire(p_enrolment_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $lesson_hold_expire_0295$
declare
  e       lesson_enrolments%rowtype;
  l       lessons%rowtype;
  v_first uuid;
  v_rules jsonb;   -- 0295 (DB-36)
begin
  select * into e from lesson_enrolments where id = p_enrolment_id;
  if not found or e.status <> 'held' then
    return false;
  end if;
  -- A payment that can still land keeps it (the expire_stale_holds grace,
  -- 0268:48-51), and one already paid books it.
  if exists (select 1 from booking_payments bp
              where bp.lesson_enrolment_id = e.id and bp.purpose = 'lesson'
                and ((bp.status in ('created', 'pending') and bp.deadline_at > now() - interval '10 minutes')
                     or bp.status = 'succeeded')) then
    return false;
  end if;
  perform set_config('app.venue_id', e.venue_id::text, true);

  update lesson_enrolments
     set status          = 'expired',
         cancel_kind     = 'expired',
         cancelled_at    = now(),
         hold_expires_at = null,
         updated_at      = now()
   where id = e.id and status = 'held';

  if e.lesson_id is not null then
    select * into l from lessons where id = e.lesson_id;
    v_first := l.id;
    -- Only a private lesson is ever held (lessons_hold): it expires with its
    -- enrolment, and its pending hold row with it, whatever hold_expires_at
    -- says (R25, R64).
    if l.status = 'held' then
      update lessons
         set status          = 'expired',
             cancel_reason   = 'payment_expired',
             cancelled_at    = now(),
             hold_expires_at = null,
             updated_at      = now()
       where id = l.id and status = 'held';
      perform app.lesson_court_release(l.id, 'cancelled');
    end if;
  else
    select s.id into v_first
      from lessons s
     where s.course_id = e.course_id
       and s.session_no between e.first_session_no and e.first_session_no + e.sessions_covered - 1
     order by s.start_at, s.session_no
     limit 1;
  end if;

  -- R30 (CD-2): a guest's own booking that lapsed unpaid strikes. Recorded
  -- only (0286's lesson_strike_record); hold_strikes_settle applies it later
  -- under the principal lock, never here (§1.4).
  -- 0295 (D5): never when the guest paid (DB-35: any lesson row of the place
  -- that succeeded, whatever happened to the money after: a refund
  -- slot_lost, venue_offline or amount_mismatch), nor when the branch's
  -- switch made paying impossible (DB-36: coaching off, or lesson payment
  -- now at the desk; lesson_payment_prepare refuses both).
  v_rules := app.coaching_rules(e.venue_id);
  if e.booked_by_kind = 'guest' and e.guest_id is not null and v_first is not null
     and not exists (select 1 from booking_payments bp
                      where bp.lesson_enrolment_id = e.id and bp.purpose = 'lesson'
                        and bp.succeeded_at is not null)
     and coalesce((v_rules ->> 'coaching_enabled')::boolean, false)
     and coalesce(v_rules ->> 'lesson_payment_mode', 'desk') <> 'desk' then
    perform app.lesson_strike_record(e.id, v_first, 'lapsed_hold');
  end if;

  -- The push trigger queues lesson.payment_expired to the guest (R40).
  perform app.lesson_event(e.venue_id, v_first, e.course_id, e.id, 'expired', 'system',
                           null, null, 'payment_expired', jsonb_build_object('lesson_id', v_first));
  return true;
end $lesson_hold_expire_0295$;

comment on function app.lesson_hold_expire(uuid) is
  '0284, 0295 (R25, R30, money.md §6.5). Internal: deposit_apply''s EXPIRED branch and 0286''s lesson_sweep (D8). Returns false and changes nothing unless the enrolment is held, while a lesson payment of it is created|pending within ten minutes of its deadline, or when one succeeded. Otherwise: the enrolment expired (cancel_kind expired); a private lesson expired (payment_expired) and its pending hold row expired through app.lesson_court_release (skip locked, never waiting); a lapsed_hold strike recorded for a guest''s own booking (app.lesson_strike_record, applied later by hold_strikes_settle), except when a lesson row of the place ever succeeded (DB-35) or the branch now has coaching off or lesson payment at the desk (DB-36; 0295, D5); the expired event (code payment_expired). No court lock, no push call (R40). Returns true.';

revoke all on function app.lesson_hold_expire(uuid) from public, anon, authenticated;
grant execute on function app.lesson_hold_expire(uuid) to service_role;

-- ===========================================================================
-- DB-37: app.hold_strikes_settle (re-issued from 0286:136)
-- ===========================================================================
-- 0286's ladder, verbatim but for one test (D5, R65 amended): a lapsed_hold
-- strike whose enrolment still has a lesson payment created or pending is
-- left unsettled (`continue`, before its row lock), so the late SUCCESS of
-- that payment can still withdraw it (lesson_settle_success deletes only an
-- unsettled strike). A strike older than two days is settled uncounted as
-- before, payment or not: a lapse older than the longest memory can no longer
-- change anything. The test is a plain read of booking_payments, no lock.
create or replace function app.hold_strikes_settle(p_guests uuid[] default null)
returns int
language plpgsql security definer set search_path = public as $hold_strikes_settle_0295$
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
    select x.source, x.hold_id, x.enrolment_id, x.lesson_id, x.guest_id, x.venue_id, x.at, x.strike_kind
      from (
        -- 0252:235-248, verbatim: lapsed mobile holds not yet in the ledger.
        select 'hold'::text           as source,
               h.id                   as hold_id,
               null::uuid             as enrolment_id,
               null::uuid             as lesson_id,
               h.guest_id, h.venue_id,
               h.hold_expires_at      as at,
               h.id::text             as ord_id,
               null::text             as strike_kind  -- 0295
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
               ls.enrolment_id::text || ':' || ls.lesson_id::text,
               ls.kind
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
      -- 0295 (DB-37, D5): a lapsed hold whose payment is still in flight
      -- stays unsettled, so its late SUCCESS can withdraw it (R65); past two
      -- days it is settled uncounted below as any stale strike.
      if r.strike_kind = 'lapsed_hold' and r.at > now() - interval '2 days'
         and exists (select 1 from booking_payments bp
                      where bp.lesson_enrolment_id = r.enrolment_id and bp.purpose = 'lesson'
                        and bp.status in ('created', 'pending')) then
        continue;
      end if;
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
end $hold_strikes_settle_0295$;

comment on function app.hold_strikes_settle(uuid[]) is
  '0252, lesson strikes since 0286, 0295 (db.md §4.9.2; R30, R31, R65). Internal. Settles, oldest first by (time, source, id), one ladder: the lapsed mobile holds (taken since hold_strikes_since, lapsed within 2 days, not yet in hold_strikes; a hold with any booking_payments attempt is recorded uncounted) and the unsettled lesson strikes (late_cancel, no_show, lapsed_hold, struck since hold_strikes_since; each re-selected FOR UPDATE SKIP LOCKED, so a row a mark is deleting or another settle holds waits for the next run; one older than 2 days is settled uncounted; a lapsed_hold younger than that whose enrolment has a lesson payment created or pending is left unsettled, so a late SUCCESS can withdraw it: 0295, DB-37, D5). NULL = every account (tp_hold_strikes); else the given accounts (hold_slot and the lesson bookings, after their principal lock). Returns the strikes counted (holds and lessons). Never called under a coach or court lock.';

revoke all on function app.hold_strikes_settle(uuid[]) from public, anon, authenticated;
grant execute on function app.hold_strikes_settle(uuid[]) to service_role;

-- ===========================================================================
-- DB-40: app.deposits_due_for_reconcile (re-issued from 0284:1156)
-- ===========================================================================
create or replace function app.deposits_due_for_reconcile(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $deposits_due_0295$
declare
  v_out jsonb;
  v_row record;
begin
  -- A succeeded deposit whose booking is gone and was not forfeited must not
  -- sit on the venue's account (I2). The reservations trigger catches the
  -- normal paths; this catches anything that slipped past it.
  for v_row in
    select bp.id
      from booking_payments bp
      join reservations r on r.id = bp.reservation_id
     where bp.status = 'succeeded'
       and bp.purpose = 'deposit'
       and bp.forfeited_at is null
       and not (r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed', 'no_show'))
     order by bp.id
     limit 20
       for update of bp skip locked
  loop
    perform app.deposit_begin_refund(v_row.id, 'slot_lost', null, 'reconciler: booking not live');
  end loop;

  -- 0284 (R28, money.md §6.6): the net for a coaching refund that never
  -- started. 0295 (DB-40): the loop is app.lesson_refund_net (verbatim, 20 a
  -- run, skip locked), which the lesson sweep also runs every minute.
  perform app.lesson_refund_net();

  with due as (
    select bp.id,
           case when bp.status = 'refund_pending' then 'refund' else 'check' end as action
      from booking_payments bp
     where (bp.claimed_at is null or bp.claimed_at <= now() - interval '60 seconds')
       and (
         (bp.status in ('created', 'pending') and bp.deadline_at <= now())
         or (bp.status = 'pending' and bp.created_at <= now() - interval '2 minutes'
             and coalesce(bp.last_checked_at, bp.created_at) <= now() - interval '90 seconds')
         or bp.status = 'refund_pending')
     order by bp.deadline_at
     limit greatest(least(coalesce(p_limit, 50), 100), 1)
       for update of bp skip locked
  ), claimed as (
    update booking_payments bp
       set claimed_at = now()
      from due
     where bp.id = due.id
    returning bp.*, due.action
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  c.id,
           'action',              c.action,
           'request_id',          c.request_id,
           'provider',            c.provider,
           'sandbox',             c.sandbox,
           'provider_payment_id', c.provider_payment_id,
           'status',              c.status,
           'amount_iqd',          c.amount_iqd,
           'deadline_at',         c.deadline_at,
           'cancel_attempts',     c.cancel_attempts,
           'refund_request_id',   c.refund_request_id,
           'refund_amount_iqd',   c.refund_amount_iqd,
           'refund_attempts',     c.refund_attempts,
           'refund_reason',       c.refund_reason,
           'purpose',             c.purpose,
           'ticket_count',        c.ticket_count,
           'lesson_enrolment_id', c.lesson_enrolment_id)), '[]'::jsonb)
    into v_out
    from claimed c;

  return v_out;
end $deposits_due_0295$;

comment on function app.deposits_due_for_reconcile(int) is
  '0242, 0258, 0284, 0295. Service role (edge deposit-reconcile). Claims up to p_limit (max 100) payments for 60 s: action check (open past its deadline, or pending unheard for 90 s) or refund (refund_pending), deposits, ticket purchases and lessons alike; each row carries purpose, ticket_count and lesson_enrolment_id. First turns any succeeded deposit (never a ticket purchase) whose booking is no longer live (and was not forfeited) into a refund, then starts, through app.lesson_refund_net (0295, DB-40; app.lesson_refund_start each), the refund still due on any succeeded lesson row whose enrolment was cancelled or expired or whose lesson or course was cancelled (R28: no time window; 20 a run each).';

revoke all on function app.deposits_due_for_reconcile(int) from public, anon, authenticated;
grant execute on function app.deposits_due_for_reconcile(int) to service_role;

-- ===========================================================================
-- DB-39, DB-40, DB-41: app.lesson_sweep (re-issued from 0286:328)
-- ===========================================================================

-- Phase 1 finds the due items, at most 200, without a lock, sorted by coach
-- and then by step. Phase 2 works coach by coach: the first coach is locked by
-- blocking, every later one by try-lock only (busy -> its items are skipped
-- this run, `skipped`). Every item runs in its own exception block, re-reads
-- its row under the coach lock and asserts its branch (app.venue_id); an error
-- rolls that item back, is counted and warned, and the next run tries again.
-- Phase 3 is the refund net every run (0295, DB-40) and, once an hour, the
-- CD-8 purge. Every step selects only rows that still need it and every
-- change is one-way or a stamp, so a second run in the same minute does
-- nothing.
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
--                     the minimum until start - 10 minutes (R38); judged
--                     later, an item with no booked or held place is
--                     cancelled under_filled (0295, DB-41, D4)
--   6 course_running  an open course whose session 1 has started
--   7 complete_lesson a scheduled lesson 15 minutes past its end -> completed,
--                     its court row completed
--   8 complete_course a running course with no held or scheduled session left
--   9 hold_release    (0295, DB-39) a pending court hold naming a lesson that
--                     is no longer held -> app.lesson_court_release(lesson,
--                     'expired'): a release some cancel or expiry made while
--                     another transaction held the row (SKIP LOCKED, R25)
create or replace function app.lesson_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $lesson_sweep_0295$
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
  end;

  -- Phase 3, once an hour: the CD-8 purge (app.lesson_typed_purge, above).
  if extract(minute from now()) = 0 then
    begin
      v_purged := app.lesson_typed_purge(500);
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'lesson_sweep: CD-8 purge left for the next run: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  return v_c || jsonb_build_object('refunds_started', v_refunds, 'purged', v_purged, 'skipped', v_skipped,
                                   'errors', v_errors);
end $lesson_sweep_0295$;

comment on function app.lesson_sweep() is
  '0286, 0295 (db.md §4.9.3). Internal, service role (cron tp_lesson_sweep, every minute). Phase 1 finds at most 200 due items without a lock, by coach then step; phase 2 blocks on the first coach (lock_coach) and try-locks every later one (busy -> its items skipped), each item in its own exception block, re-read under the lock: 1 a held enrolment past its hold with no payment that can still land -> Money''s lesson_hold_expire (R25, R30); 2 a live enrolment of a deleted account not yet started -> enrolment_cancel_internal account_deleted (R28), or a pending typed-phone link dropped silently (C-21); 3 a retired coach''s lessons not started and courses with a session left -> coach_retired; 4, 5 the cut-off of a group session or a course, judged on booked places only before the session''s (session 1''s) start (R26: judged later it stamps and writes under_filled {late: true}, cancelling nothing, unless no place is booked or held: then it is cancelled under_filled, a course with every session still on, 0295 DB-41, D4), deferred while held places could reach the minimum until start - 10 minutes (R38), else under_filled (C-14); 6 open -> running at session 1''s start; 7 a scheduled lesson 15 minutes past its end -> completed with its court row; 8 a running course with no live session -> completed; 9 a pending court hold of a lesson no longer held -> expired through lesson_court_release (0295, DB-39). Every run, in its own block, the R28 refund net app.lesson_refund_net (0295, DB-40). Once an hour, the CD-8 purge: enrolments 365 days past their last session lose the typed phone and friend names, and a typed name becomes ''Walk-in'' (R44: a marker, never NULL), at most 500 a run. No court lock and no waiting FOR UPDATE on reservations (R6, R33, R64). Returns {held_expired, held_waiting, deleted_cancelled, links_dropped, retired_cancelled, under_filled, courses_under_filled, judged_late, cutoffs_confirmed, deferred, courses_running, completed, courses_completed, holds_released, refunds_started, purged, skipped, errors}.';

revoke all on function app.lesson_sweep() from public, anon, authenticated;
grant execute on function app.lesson_sweep() to service_role;
