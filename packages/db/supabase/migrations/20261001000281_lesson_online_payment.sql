set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0281 lesson_online_payment — coaching, lane Money (docs/design/coaching/
-- money.md §6; build contracts §1.1, §1.5, §1.8, C-3, C-26, CD-1, CD-2, R3,
-- R22, R25, R28, R29, R30, R33, R34, R50, R64, R65, R67, R70).
--
-- A lesson paid online is "reserve first, then pay" (C-3, CM-6): the booking
-- RPCs (0280) leave the enrolment `held` (a private lesson `held` too, with a
-- court `hold` row naming it); the edge function lesson-begin records an
-- attempt here and opens Qi's page; app.deposit_apply, the one writer of a
-- payment outcome, books it on SUCCESS or ends it on EXPIRED.
--
--   1. app.lesson_payment_prepare   service role (edge lesson-begin, R3): one
--                                   live attempt per enrolment, three per
--                                   enrolment, the lessons terms (R50)
--   2. app.lesson_settle_success    internal (deposit_apply, R70): SUCCESS on a
--                                   lesson row books the held enrolment, revives
--                                   an expired one when it still fits (R29), or
--                                   refunds the whole row (slot_lost,
--                                   venue_offline, duplicate_success,
--                                   account_deleted); a late success withdraws
--                                   the unsettled lapsed_hold strike (R65)
--   3. app.lesson_hold_expire       internal (deposit_apply's EXPIRED branch and
--                                   0283's lesson_sweep): the held enrolment (a
--                                   private lesson and its hold row too) expires
--                                   unless a payment can still land, with a
--                                   lapsed_hold strike for a guest's own booking
--                                   (R25, R30)
--   4. app.deposit_apply            re-issued from 20261001000267_deposit_payment_id_match.sql:23:
--                                   the lesson arm (R33, R34)
--   5. app.deposit_status           re-issued from 20260929000259_ticket_purchase.sql:897:
--                                   the lesson answer (X14)
--   6. app.deposit_refund_apply     re-issued from 20260929000259_ticket_purchase.sql:1002:
--                                   a lesson row takes its row lock only
--   7. app.deposits_due_for_reconcile re-issued from 20260929000258_match_tables.sql:841:
--                                   the net for a coaching refund that never
--                                   started, with no time window (R28)
--   8. app.deposit_attention        re-issued from 20260929000258_match_tables.sql:969:
--                                   lesson rows of the branch
--   9. app.deposit_refund_request   re-issued from 20260929000258_match_tables.sql:1155:
--                                   a lesson row only once its money is final (CM-5)
--
-- Lock order (§1.4, R33, money.md §9). deposit_apply takes, in this TEXT order
-- whichever arm runs (the walker reads the body linearly): the coach
-- (app.lock_coach, a lesson row only), then every court (the deposit's one;
-- a private lesson's whole branch, app.lesson_lock_branch_courts, R34), then
-- every reservations row FOR UPDATE, then the payment row. A private lesson's
-- stale holds over its period are expired right before
-- app.lesson_settle_success, AFTER the deposit arm's settle call in the text
-- and with SKIP LOCKED (never waits, R64): deposit_settle_success already
-- expires stale holds with a waiting FOR UPDATE (0258's R15 hoist), and a
-- second waiting expiry anywhere in the body reads as match_tickets ->
-- reservations to the gate, whichever comes first. The predicate is
-- match_expire_holds' after 0277 (TTL, or an orphan with neither a guest nor a
-- lesson; an open payment's ten-minute grace). lesson_settle_success and
-- lesson_hold_expire take no lock of their own and never a waiting
-- FOR UPDATE on reservations. The gate prints deposit_apply as coach_advisory
-- -> court_advisory -> reservations -> match_venue_advisory -> match_tickets.
--
-- Functions of other coaching files this one calls (each bound late, by name):
--   0275 (DB)    app.lock_coach
--   0274 (DB)    app.coaching_rules, app.lesson_terms_ok
--   0278 (Money) app.lesson_enrolment_money, app.lesson_refund_start
--   0279 (DB)    app.coach_available
--   0280 (DB)    app.lesson_lock_branch_courts, app.lesson_pick_court,
--                app.lesson_places_taken, app.course_places_taken (R70: the
--                enrolment to leave out), app.lesson_event,
--                app.lesson_court_release
--   0283 (DB)    app.lesson_strike_record (created after this file; nothing
--                calls lesson_hold_expire before 0283's sweep or a lesson
--                payment, and coaching ships off everywhere)
--
-- No push is queued here (R40): the paid_online event makes Guest's
-- lesson_events_notify trigger queue coach.new_student, and the expired event
-- lesson.payment_expired. Nothing here calls lesson_notify or
-- lesson_sync_reminders.

-- ===========================================================================
-- 1. Prepare an attempt (service role; edge lesson-begin)
-- ===========================================================================
create or replace function app.lesson_payment_prepare(
  p_guest_id     uuid,
  p_enrolment_id uuid,
  p_locale       text,
  p_provider     text
) returns jsonb
language plpgsql security definer set search_path = public as $lesson_payment_prepare_0281$
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
    -- unlike match_terms_ok). The same test lesson_guest(true) makes on 0280's
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
      update lesson_enrolments
         set hold_expires_at = greatest(hold_expires_at, v.deadline_at),
             updated_at      = now()
       where id = e.id and status = 'held';
      if l.kind = 'private' then
        update lessons
           set hold_expires_at = greatest(hold_expires_at, v.deadline_at),
               updated_at      = now()
         where id = l.id and status = 'held';
        update reservations
           set hold_expires_at = greatest(hold_expires_at, v.deadline_at)
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
end $lesson_payment_prepare_0281$;

comment on function app.lesson_payment_prepare(uuid, uuid, text, text) is
  '0281 (R3; money.md §6.2). Service role (edge lesson-begin, on behalf of the JWT user p_guest_id). Returns the enrolment''s live attempt (reused), or records a new one (purpose lesson, status created, the whole place, deposit_window_seconds) and stretches the enrolment, a private lesson and its court hold to the payment deadline. Locks: the coach, then a private lesson''s hold court and hold row. Refusals in order: INVALID_ARGUMENT (p_guest_id, p_enrolment_id, p_provider), ACCOUNT_REQUIRED, ENROLMENT_NOT_FOUND (unknown or another guest''s), LESSON_NOT_PAYABLE (detail cancelled | expired | desk | booked | expired for a lapsed hold | free), COACHING_OFF, ONLINE_PAYMENT_OFF, PHONE_REQUIRED, TERMS_REQUIRED detail lessons (C-26, R50), DEGRADED_LOCKOUT, TOO_MANY_ATTEMPTS (3 per enrolment). Returns {id, request_id, purpose, status, provider, sandbox, amount_iqd, deadline_at, form_url, provider_payment_id, locale, reused, enrolment_id, lesson_id, course_id, guest_phone, guest_name}.';

revoke all on function app.lesson_payment_prepare(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function app.lesson_payment_prepare(uuid, uuid, text, text) to service_role;

-- ===========================================================================
-- 2. SUCCESS on a lesson row (internal; deposit_apply)
-- ===========================================================================
-- The caller (deposit_apply) holds the coach lock, for a private lesson every
-- court in p_locked (the branch's active courts, R34) and the hold row, has
-- expired the branch's stale holds over the lesson's period, and holds the
-- payment row. This function takes no lock of its own, no FOR UPDATE on
-- reservations, and calls nothing that does (the walker walks it alone,
-- SERVICE_WALK). It never raises on a valid row: a raise rolls back
-- deposit_apply, the webhook answers 500 and the reconciler loops (the
-- ticket_settle_success rule). Every booking write sits in one sub-block where
-- a check, unique or exclusion violation is slot_lost and DEGRADED_LOCKOUT is
-- venue_offline (R29).
create or replace function app.lesson_settle_success(p_payment_id uuid, p_locked uuid[])
returns text
language plpgsql security definer set search_path = public as $lesson_settle_success_0281$
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
          -- locked set (R34) and the row inserted in the shape of 0280's
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
end $lesson_settle_success_0281$;

comment on function app.lesson_settle_success(uuid, uuid[]) is
  '0281 (R29, R34, R65, R70; money.md §6.4). Internal (deposit_apply''s lesson arm, which holds the coach, a private lesson''s branch courts p_locked and its hold row, has expired the stale holds over the lesson''s period, and holds the payment row). SUCCESS on a lesson row: a held enrolment is booked (a private lesson scheduled, its hold turned into the lesson''s court row in place, or a court re-picked from p_locked when the hold expired by TTL; a group or course place re-checked with itself left out); an expired one is revived when the lesson, the coach, a court and the place are still free (expired -> scheduled / booked); otherwise the whole row goes back: account_deleted, duplicate_success, slot_lost (started, full, gone, cancelled, any check, unique or exclusion violation), venue_offline (DEGRADED_LOCKOUT). A late SUCCESS withdraws the unsettled lapsed_hold strike. Writes the paid_online event ({payment_id, amount_iqd, lesson_id, places_taken, places_total, revived}) and audit lesson.paid_online; no push call (R40). Takes no lock; never raises on a valid row.';

revoke all on function app.lesson_settle_success(uuid, uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- 3. A held enrolment's window is over (internal; deposit_apply, lesson_sweep)
-- ===========================================================================
-- One definition for deposit_apply's EXPIRED branch and 0283's lesson_sweep
-- (D8). The caller holds the coach lock (the sweep, deposit_apply) or is
-- deposit_apply's lesson arm. No court lock: every write is status-only, and a
-- private lesson's hold row is expired by app.lesson_court_release's
-- skip-locked statement (R25, R64), never waiting.
create or replace function app.lesson_hold_expire(p_enrolment_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $lesson_hold_expire_0281$
declare
  e       lesson_enrolments%rowtype;
  l       lessons%rowtype;
  v_first uuid;
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
  -- only (0283's lesson_strike_record); hold_strikes_settle applies it later
  -- under the principal lock, never here (§1.4).
  if e.booked_by_kind = 'guest' and e.guest_id is not null and v_first is not null then
    perform app.lesson_strike_record(e.id, v_first, 'lapsed_hold');
  end if;

  -- The push trigger queues lesson.payment_expired to the guest (R40).
  perform app.lesson_event(e.venue_id, v_first, e.course_id, e.id, 'expired', 'system',
                           null, null, 'payment_expired', jsonb_build_object('lesson_id', v_first));
  return true;
end $lesson_hold_expire_0281$;

comment on function app.lesson_hold_expire(uuid) is
  '0281 (R25, R30, money.md §6.5). Internal: deposit_apply''s EXPIRED branch and 0283''s lesson_sweep (D8). Returns false and changes nothing unless the enrolment is held, while a lesson payment of it is created|pending within ten minutes of its deadline, or when one succeeded. Otherwise: the enrolment expired (cancel_kind expired); a private lesson expired (payment_expired) and its pending hold row expired through app.lesson_court_release (skip locked, never waiting); a lapsed_hold strike recorded for a guest''s own booking (app.lesson_strike_record, applied later by hold_strikes_settle); the expired event (code payment_expired). No court lock, no push call (R40). Returns true.';

revoke all on function app.lesson_hold_expire(uuid) from public, anon, authenticated;
grant execute on function app.lesson_hold_expire(uuid) to service_role;

-- ===========================================================================
-- 4. deposit_apply — re-issued verbatim from 20261001000267_deposit_payment_id_match.sql:23,
--    plus the lesson arm, each change marked 0281
-- ===========================================================================
create or replace function app.deposit_apply(
  p_request_id          uuid,
  p_provider_payment_id text,
  p_provider_status     text,
  p_amount              numeric,
  p_currency            text,
  p_canceled            boolean,
  p_source              text,
  p_signature_ok        boolean default null,
  p_raw                 jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_apply_0281$
declare
  v        booking_payments%rowtype;
  r        reservations%rowtype;
  v_status text := upper(btrim(coalesce(p_provider_status, '')));
  v_kind   text;
  v_code   text;
  v_new    text;
  v_coach  uuid;        -- 0281: a lesson row's coach
  v_period tstzrange;   -- 0281: a private lesson's period
  v_locked uuid[];      -- 0281: the courts a private lesson's arm locked (R34)
begin
  if p_source is null or p_source not in ('webhook', 'poll', 'reconcile') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_source';
  end if;
  p_provider_payment_id := nullif(btrim(coalesce(p_provider_payment_id, '')), '');

  select * into v from booking_payments where request_id = p_request_id;
  if not found and p_provider_payment_id is not null then
    select * into v from booking_payments where provider_payment_id = p_provider_payment_id;
  end if;
  if v.id is null then
    perform app.deposit_event(null, p_source, p_provider_status, p_signature_ok, 'unmatched', p_raw);
    return jsonb_build_object('matched', false);
  end if;

  -- 0267: the signed payment id must be the row's own once the row knows it.
  if v.provider_payment_id is not null and p_provider_payment_id is not null
     and v.provider_payment_id <> p_provider_payment_id then
    perform app.deposit_event(v.id, p_source, p_provider_status, p_signature_ok, 'payment_id_mismatch', p_raw);
    return jsonb_build_object('matched', false, 'mismatch', true);
  end if;

  -- 0281 (R33, R34): every purpose's locks in one text order, so the walker
  -- reads the body monotone whichever arm runs: the coach (a lesson row), then
  -- every court, then every reservations row, then the payment row. A lesson's
  -- coach and a private lesson's period never change under a held or expired
  -- enrolment, so the unlocked read names the right key. A group or course
  -- payment takes the coach lock only: places are serialised by the coach mutex.
  if v.purpose = 'lesson' then
    select coalesce(l.coach_id, c.coach_id), l.period
      into v_coach, v_period
      from lesson_enrolments e
      left join lessons l on l.id = e.lesson_id
      left join courses c on c.id = e.course_id
     where e.id = v.lesson_enrolment_id;
    perform app.lock_coach(v_coach);
  end if;
  if v.purpose = 'deposit' then
    -- Lock order: court → reservations → booking_payments.
    select * into r from reservations where id = v.reservation_id;
    perform app.lock_court(r.court_id);
  elsif v.purpose = 'lesson' and v.hold_id is not null then
    -- 0281 (R34): every active court of the branch, id order; a swept hold
    -- re-picks only from this set.
    v_locked := app.lesson_lock_branch_courts(v.venue_id);
  end if;
  if v.purpose = 'deposit' then
    perform 1 from reservations where id in (v.reservation_id, v.hold_id) order by id for update;
  elsif v.purpose = 'lesson' and v.hold_id is not null then
    perform 1 from reservations where id = v.hold_id for update;
  end if;
  -- 0259: a ticket purchase is a chain row with no court, booking or
  -- branch: only the row itself is locked.
  select * into v from booking_payments where id = v.id for update;
  if v.purpose <> 'ticket' then
    perform set_config('app.venue_id', v.venue_id::text, true);
  end if;

  perform app.deposit_event(v.id, p_source, p_provider_status, p_signature_ok, null, p_raw);

  -- Learn Qi's id if we never heard it (create timed out after Qi made it).
  if v.provider_payment_id is null and p_provider_payment_id is not null then
    update booking_payments set provider_payment_id = p_provider_payment_id where id = v.id;
  end if;

  v_kind := case
    when v_status = 'SUCCESS' then 'success'
    when v_status in ('FAILED', 'ERROR', 'AUTHENTICATION_FAILED') then 'failed'
    when v_status in ('EXPIRED', 'NOT_FOUND', 'GIVE_UP') then 'expired'
    when coalesce(p_canceled, false) then 'expired'
    else 'open' end;
  v_code := case
    when v_status = 'AUTHENTICATION_FAILED' then 'auth_failed'
    when v_status = 'ERROR' then 'bank_error'
    when v_status = 'FAILED' then 'declined'
    when coalesce(p_canceled, false) then 'cancelled'
    else null end;

  update booking_payments
     set provider_status = coalesce(left(nullif(v_status, ''), 64), provider_status),
         last_checked_at = now(),
         claimed_at      = null,
         status          = case when status = 'created' and v_kind = 'open'
                                     and coalesce(provider_payment_id, p_provider_payment_id) is not null
                                then 'pending' else status end,
         updated_at      = now()
   where id = v.id
   returning * into v;

  v_new := v.status;

  if v_kind = 'success' then
    if v.status in ('created', 'pending', 'failed', 'expired') then
      -- Amount and currency to the dinar, or it is not our payment (plan §3.2).
      -- A ticket purchase with the wrong amount creates no ticket: the whole
      -- row is refunded (MD-2). 0281: a lesson row likewise; the enrolment
      -- stays held and expires on its own.
      if p_amount is null or upper(coalesce(p_currency, '')) <> 'IQD'
         or abs(p_amount - v.amount_iqd) >= 1 then
        update booking_payments
           set status = 'succeeded', succeeded_at = coalesce(succeeded_at, now()), updated_at = now()
         where id = v.id;
        perform app.deposit_begin_refund(v.id, 'amount_mismatch', null,
                                         format('Qi said %s %s', p_amount, p_currency));
        perform app.deposit_nudge();
        v_new := 'refund_pending';
      elsif v.purpose = 'deposit' then
        v_new := app.deposit_settle_success(v.id);
      elsif v.purpose = 'lesson' then
        -- 0281 (R33, R25, R64): before any write, the branch's stale holds over
        -- the private lesson's period expire (match_expire_holds' predicate
        -- after 0277: past the TTL, or an orphan with neither a guest nor a
        -- lesson; never a hold whose payment is still inside its ten-minute
        -- grace, so this payment's own hold goes only once it is past it, and
        -- lesson_settle_success re-picks). SKIP LOCKED: a hold another
        -- transaction holds is being expired by it, and this statement never
        -- waits; written after deposit_settle_success's own expiry so the body
        -- reads one waiting reservations lock (see the file header). The alias
        -- is x: r is this function's own reservations variable.
        if v.hold_id is not null then
          update reservations
             set status = 'expired'
           where id in (
             select x.id from reservations x
              where x.kind = 'hold' and x.status = 'pending'
                and (x.hold_expires_at < now() or (x.guest_id is null and x.lesson_id is null))
                and x.venue_id = v.venue_id
                and x.period && v_period
                and not exists (select 1 from booking_payments bp
                                 where bp.hold_id = x.id
                                   and bp.status in ('created', 'pending')
                                   and bp.deadline_at > now() - interval '10 minutes')
              order by x.id
                for update of x skip locked);
        end if;
        v_new := app.lesson_settle_success(v.id, v_locked);
      else
        v_new := app.ticket_settle_success(v.id);
      end if;
    end if;
    -- succeeded / refund_* / refunded: a replay. Logged above, nothing moves.

  elsif v_kind = 'failed' and v.status in ('created', 'pending') then
    update booking_payments
       set status = 'failed', failed_at = now(), failure_code = v_code, updated_at = now()
     where id = v.id;
    v_new := 'failed';
    -- The hold stays until its deadline: the guest may try again or, when the
    -- deposit is optional, confirm and pay at the desk.

  elsif v_kind = 'expired' and v.status in ('created', 'pending') then
    update booking_payments
       set status = 'expired', expired_at = now(), failure_code = v_code, updated_at = now()
     where id = v.id;
    v_new := 'expired';
    -- The window is over: give the slot back unless the guest confirmed it
    -- meanwhile or started another attempt. A ticket purchase holds no slot.
    if v.purpose = 'deposit'
       and not exists (select 1 from booking_payments o
                        where o.hold_id = v.hold_id and o.id <> v.id and o.status in ('created', 'pending')) then
      update reservations
         set status = 'expired'
       where id = v.hold_id and kind = 'hold' and status = 'pending';
    elsif v.purpose = 'lesson' then
      -- 0281 (§6.5): the held enrolment (a private lesson and its hold row
      -- too) expires with a lapsed_hold strike for a guest's own booking,
      -- unless another attempt on it is live.
      perform app.lesson_hold_expire(v.lesson_enrolment_id);
    end if;
  end if;

  return jsonb_build_object('matched', true, 'id', v.id, 'request_id', v.request_id,
                            'status', v_new, 'reservation_id',
                            (select reservation_id from booking_payments where id = v.id),
                            'purpose', v.purpose, 'ticket_count', v.ticket_count,
                            'lesson_enrolment_id', v.lesson_enrolment_id);
end $deposit_apply_0281$;

comment on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) is
  '0242, 0259, 0267, 0281. Service role. The ONLY writer of a payment outcome: deposits, open-match ticket purchases and lessons paid online. Logs the message, then: SUCCESS for exactly amount_iqd in IQD books the slot of a deposit (confirm the hold, or re-create a swept one), creates a ticket purchase''s tickets (app.ticket_settle_success, however late), or books a lesson place (app.lesson_settle_success: a held enrolment booked, an expired one revived when it still fits) and marks succeeded in the same transaction, or goes to refund_pending (slot_lost, venue_offline, amount_mismatch, duplicate_success, account_deleted); FAILED/ERROR/AUTHENTICATION_FAILED → failed (hold kept); EXPIRED/cancelled/NOT_FOUND/GIVE_UP → expired (a deposit''s hold released; a lesson''s held enrolment expired by app.lesson_hold_expire). A late SUCCESS after failed/expired is honoured. Anything else only updates provider_status. Unknown request → logged unmatched; a provider payment id other than the one the row already holds → logged payment_id_mismatch, nothing applied (0267). Locks in one text order (0281, R33): a lesson''s coach, the court(s) (a private lesson''s whole branch, R34), the reservations rows, the payment row. The result carries purpose, ticket_count and lesson_enrolment_id.';

revoke all on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) to service_role;

-- ===========================================================================
-- 5. deposit_status — re-issued verbatim from 20260929000259_ticket_purchase.sql:897,
--    plus the lesson answer (X14), marked 0281
-- ===========================================================================
create or replace function app.deposit_status(p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_status_0281$
declare
  v_uid      uuid := auth.uid();
  v          booking_payments%rowtype;
  r          reservations%rowtype;
  h          reservations%rowtype;
  v_attempts int;
  v_mine     jsonb;
  v_lesson   jsonb;     -- 0281
  v_live     boolean;   -- 0281
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where request_id = p_request_id;
  -- Someone else's ref and an unknown ref read the same (0038 #7).
  if not found
     or (v.guest_id is distinct from v_uid
         and not app.is_staff_at(v.venue_id, 'court_desk', 'manager', 'owner')) then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v.purpose = 'ticket' then
    select count(*) into v_attempts from booking_payments
     where guest_id = v.guest_id and purpose = 'ticket' and status in ('failed', 'expired')
       and created_at > now() - interval '24 hours';
    select jsonb_build_object(
             'from_this_purchase', count(*) filter (where purchase_payment_id = v.id),
             'available',          count(*) filter (where status = 'available'),
             'reserved',           count(*) filter (where status = 'reserved'),
             'in_use',             count(*) filter (where status = 'in_use'))
      into v_mine
      from match_tickets where guest_id = v.guest_id;
    return jsonb_build_object(
      'request_id',        v.request_id,
      'purpose',           'ticket',
      'status',            v.status,
      'failure_code',      v.failure_code,
      'amount_iqd',        v.amount_iqd,
      'ticket_count',      v.ticket_count,
      'unit_price_iqd',    v.quoted_price_iqd,
      'price_iqd',         v.amount_iqd,
      'rest_iqd',          0,
      'deadline_at',       v.deadline_at,
      'form_url',          case when v.status in ('created', 'pending') then v.form_url end,
      'refund_reason',     v.refund_reason,
      'refund_amount_iqd', v.refund_amount_iqd,
      'refunded_at',       v.refunded_at,
      'sandbox',           v.sandbox,
      'deposit_mode',      null,
      'attempts_left',     greatest(3 - v_attempts, 0),
      'hold_live',         false,
      'reservation',       null,
      'tickets',           v_mine,
      'server_now',        now());
  end if;

  -- 0281 (X14, money.md §6.6): a lesson paid online. The lesson block names
  -- the first covered session (start_at, end_at), the coach by coaches.id and
  -- public display name (NULL once retired: C-29, R43, R63) and the type; no
  -- court (§1.6). attempts_left counts this enrolment's lesson attempts;
  -- hold_live says the enrolment is still held inside its window.
  if v.purpose = 'lesson' then
    select count(*) into v_attempts from booking_payments
     where lesson_enrolment_id = v.lesson_enrolment_id and purpose = 'lesson';
    select jsonb_build_object(
             'enrolment_id',     e.id,
             'enrolment_status', e.status,
             'kind',             coalesce(l.kind, 'course'),
             'lesson_id',        e.lesson_id,
             'course_id',        e.course_id,
             'start_at',         s.start_at,
             'end_at',           s.end_at,
             'venue_id',         e.venue_id,
             'coach_id',         co.id,
             'coach_name_en',    case when co.status = 'retired' then null else co.display_name_en end,
             'coach_name_ar',    case when co.status = 'retired' then null else co.display_name_ar end,
             'type_name_en',     lt.name_en,
             'type_name_ar',     lt.name_ar),
           (e.status = 'held' and e.hold_expires_at > now())
      into v_lesson, v_live
      from lesson_enrolments e
      left join lessons l on l.id = e.lesson_id
      left join courses c on c.id = e.course_id
      left join lateral (
        select x.start_at, x.end_at
          from lessons x
         where x.id = e.lesson_id
            or (x.course_id = e.course_id
                and x.session_no between e.first_session_no
                                     and e.first_session_no + e.sessions_covered - 1)
         order by x.start_at, x.session_no
         limit 1) s on true
      left join coaches co on co.id = coalesce(l.coach_id, c.coach_id)
      left join lesson_types lt on lt.id = coalesce(l.lesson_type_id, c.lesson_type_id)
     where e.id = v.lesson_enrolment_id;
    return jsonb_build_object(
      'request_id',        v.request_id,
      'purpose',           'lesson',
      'status',            v.status,
      'failure_code',      v.failure_code,
      'amount_iqd',        v.amount_iqd,
      'price_iqd',         v.quoted_price_iqd,
      'rest_iqd',          greatest(v.quoted_price_iqd - v.amount_iqd, 0),
      'deadline_at',       v.deadline_at,
      'form_url',          case when v.status in ('created', 'pending') then v.form_url end,
      'refund_reason',     v.refund_reason,
      'refund_amount_iqd', v.refund_amount_iqd,
      'refunded_at',       v.refunded_at,
      'sandbox',           v.sandbox,
      'deposit_mode',      null,
      'attempts_left',     greatest(3 - v_attempts, 0),
      'hold_live',         coalesce(v_live, false),
      'reservation',       null,
      'ticket_count',      null,
      'lesson',            v_lesson,
      'server_now',        now());
  end if;

  select * into r from reservations where id = v.reservation_id;
  select * into h from reservations where id = v.hold_id;
  select count(*) into v_attempts from booking_payments where hold_id = v.hold_id;

  return jsonb_build_object(
    'request_id',        v.request_id,
    'status',            v.status,
    'failure_code',      v.failure_code,
    'amount_iqd',        v.amount_iqd,
    'price_iqd',         coalesce(r.price_iqd, v.quoted_price_iqd),
    'rest_iqd',          greatest(coalesce(r.price_iqd, v.quoted_price_iqd) - v.amount_iqd, 0),
    'deadline_at',       v.deadline_at,
    'form_url',          case when v.status in ('created', 'pending') then v.form_url end,
    'refund_reason',     v.refund_reason,
    'refund_amount_iqd', v.refund_amount_iqd,
    'refunded_at',       v.refunded_at,
    'sandbox',           v.sandbox,
    'deposit_mode',      app.deposit_mode_for(v.guest_id, v.venue_id),
    'attempts_left',     greatest(3 - v_attempts, 0),
    'hold_live',         (h.kind = 'hold' and h.status = 'pending' and h.hold_expires_at > now()),
    'reservation',       jsonb_build_object(
                           'id',       r.id,
                           'kind',     r.kind,
                           'status',   r.status,
                           'court_id', r.court_id,
                           'start_at', r.start_at,
                           'end_at',   r.end_at,
                           'venue_id', r.venue_id),
    'purpose',           'deposit',
    'ticket_count',      null,
    'server_now',        now());
end $deposit_status_0281$;

comment on function app.deposit_status(uuid) is
  '0242, 0259, 0281. One payment attempt by its request_id, as the guest''s payment screen renders it (contracts §2.2), with purpose. A deposit: the guest reads their own, court desk, manager and owner their branch''s. A ticket purchase (money.md §5.5): only its guest; deposit_mode null, reservation null, hold_live false, unit_price_iqd, ticket_count, attempts_left from the guest''s failed or expired ticket attempts in 24 h, and tickets {from_this_purchase, available, reserved, in_use}. A lesson paid online (0281, X14): the guest, or court desk, manager and owner of its branch; price_iqd the place, rest_iqd 0, deposit_mode, reservation and ticket_count null, attempts_left of three on the enrolment, hold_live while the enrolment is held inside its window, and lesson {enrolment_id, enrolment_status, kind, lesson_id, course_id, start_at, end_at (the first covered session), venue_id, coach_id, coach_name_en, coach_name_ar (NULL once retired), type_name_en, type_name_ar}; no court. PAYMENT_NOT_FOUND for an unknown or foreign ref alike.';

revoke all on function app.deposit_status(uuid) from public, anon;
grant execute on function app.deposit_status(uuid) to authenticated;

-- ===========================================================================
-- 6. deposit_refund_apply — re-issued verbatim from 20260929000259_ticket_purchase.sql:1002,
--    plus the lesson branch, marked 0281
-- ===========================================================================
create or replace function app.deposit_refund_apply(
  p_payment_id         uuid,
  p_outcome            text,
  p_provider_status    text,
  p_refund_provider_id text,
  p_raw                jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_apply_0281$
declare
  v       booking_payments%rowtype;
  r       reservations%rowtype;
  v_token boolean;
begin
  if p_outcome is null or p_outcome not in ('succeeded', 'failed', 'pending', 'unknown') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_outcome';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.purpose = 'deposit' then
    -- Lock order court → reservations → booking_payments, as deposit_apply.
    perform app.lock_court((select court_id from reservations where id = v.reservation_id));
    perform 1 from reservations where id = v.reservation_id for update;
    select * into v from booking_payments where id = p_payment_id for update;
    perform set_config('app.venue_id', v.venue_id::text, true);
  else
    -- 0281: a ticket purchase, and a lesson row (no booking, no court lock):
    -- the row only.
    select * into v from booking_payments where id = p_payment_id for update;
  end if;

  perform app.deposit_event(v.id, 'refund', p_provider_status, null, p_outcome, p_raw);

  if v.status <> 'refund_pending' then
    return jsonb_build_object('id', v.id, 'status', v.status, 'changed', false);
  end if;

  if p_outcome = 'succeeded' then
    update booking_payments
       set status = 'refunded', refunded_at = now(),
           refund_provider_id = coalesce(left(p_refund_provider_id, 200), refund_provider_id),
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
    if v.purpose = 'deposit' then
      perform app.write_audit('deposit.refunded', 'booking_payments', v.id::text, null,
                              jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'reason', v.refund_reason,
                                                 'reservation_id', v.reservation_id));
      -- Tell the guest (their phone may have been closed for days).
      select * into r from reservations where id = v.reservation_id;
      select expo_push_token is not null into v_token from profiles where id = v.guest_id;
      if coalesce(v_token, false) and not v.sandbox then
        insert into notification_outbox (profile_id, kind, payload)
        values (v.guest_id, 'deposit_refunded', jsonb_build_object(
          'reservation_id', v.reservation_id,
          'court_id',       r.court_id,
          'start_at',       r.start_at,
          'amount_iqd',     v.refund_amount_iqd,
          'request_id',     v.request_id));
        perform app.push_nudge();
      end if;
    elsif v.purpose = 'lesson' then
      -- 0281 (money.md §6.6): the audit only. No push: the cancel that
      -- started the refund already told the guest (§1.9 has no refund key).
      perform app.write_audit('lesson.refunded', 'booking_payments', v.id::text, null,
                              jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'reason', v.refund_reason,
                                                 'lesson_enrolment_id', v.lesson_enrolment_id));
    else
      perform app.write_audit('ticket.refunded', 'booking_payments', v.id::text, null,
                              jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'reason', v.refund_reason,
                                                 'ticket_count', v.ticket_count));
      if not v.sandbox and v.guest_id is not null then
        begin
          perform app.match_notify(null, array[v.guest_id], 'tickets_refunded', '{}'::jsonb, null, null,
                                   'tickets_refunded:' || v.request_id);
        exception when others then
          raise warning 'deposit_refund_apply: tickets_refunded push for % not queued: % (%)',
            v.id, sqlerrm, sqlstate;
        end;
      end if;
    end if;
  elsif p_outcome = 'failed' then
    update booking_payments
       set status = 'refund_failed', refund_attempts = refund_attempts + 1,
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
    perform app.write_audit('deposit.refund_failed', 'booking_payments', v.id::text, null,
                            jsonb_build_object('provider_status', p_provider_status));
  else
    update booking_payments
       set refund_attempts = refund_attempts + 1,
           status = case when p_outcome = 'unknown' and refund_attempts + 1 >= 10
                         then 'refund_failed' else status end,
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
  end if;

  return jsonb_build_object('id', v.id, 'status', v.status, 'changed', true);
end $deposit_refund_apply_0281$;

comment on function app.deposit_refund_apply(uuid, text, text, text, jsonb) is
  '0242, 0259, 0281. Service role (edge deposit-reconcile). refund_pending → refunded (a deposit_refunded push for a deposit; tickets_refunded through app.match_notify for a ticket purchase, never for sandbox, never failing the write; for a lesson row the audit lesson.refunded only, the cancel having told the guest) | refund_failed (a manager sees it in deposit_attention); pending/unknown count an attempt, and ten unanswered attempts give up to refund_failed. A ticket purchase and a lesson row take no court or booking lock: the row only.';

revoke all on function app.deposit_refund_apply(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_refund_apply(uuid, text, text, text, jsonb) to service_role;

-- ===========================================================================
-- 7. deposits_due_for_reconcile — re-issued verbatim from 20260929000258_match_tables.sql:841,
--    plus the lesson net (R28), marked 0281
-- ===========================================================================
create or replace function app.deposits_due_for_reconcile(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $deposits_due_0281$
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

  -- 0281 (R28, money.md §6.6): the net for a coaching refund that never
  -- started. A succeeded lesson row whose enrolment was cancelled or expired,
  -- or whose lesson or course was cancelled, and that still has online money
  -- due back: app.lesson_refund_start refunds exactly what the engine says is
  -- due (never more, one refund per row). No time window: a venue cancel can
  -- come weeks after a late cancel. The cheap tests run first, so the engine
  -- runs only on those rows; the refund-due test keeps a late cancel's kept
  -- row (succeeded forever, nothing due) out of the limit.
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
    perform app.lesson_refund_start(v_row.lesson_enrolment_id, null);
  end loop;

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
end $deposits_due_0281$;

comment on function app.deposits_due_for_reconcile(int) is
  '0242, 0258, 0281. Service role (edge deposit-reconcile). Claims up to p_limit (max 100) payments for 60 s: action check (open past its deadline, or pending unheard for 90 s) or refund (refund_pending), deposits, ticket purchases and lessons alike; each row carries purpose, ticket_count and lesson_enrolment_id. First turns any succeeded deposit (never a ticket purchase) whose booking is no longer live (and was not forfeited) into a refund, then starts, through app.lesson_refund_start, the refund still due on any succeeded lesson row whose enrolment was cancelled or expired or whose lesson or course was cancelled (R28: no time window; 20 a run each).';

revoke all on function app.deposits_due_for_reconcile(int) from public, anon, authenticated;
grant execute on function app.deposits_due_for_reconcile(int) to service_role;

-- ===========================================================================
-- 8. deposit_attention — re-issued verbatim from 20260929000258_match_tables.sql:969,
--    plus the lesson rows, marked 0281
-- ===========================================================================
create or replace function app.deposit_attention(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_attention_0281$
declare
  v_venue uuid;
  v_out   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0281 (money.md §6.6, R41): a lesson row has no booking (reservation_id
  -- NULL), so its name and phone are the payer's profile (an online lesson is
  -- always the guest's own booking, CD-1) and start_at is its first covered
  -- session; it carries lesson_enrolment_id, enrolment_id (the same),
  -- lesson_id and course_id. court_name_* stay NULL for it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  bp.id,
           'request_id',          bp.request_id,
           'reservation_id',      bp.reservation_id,
           'guest_name',          coalesce(r.guest_name, p.full_name),
           'guest_phone',         coalesce(r.guest_phone, p.phone),
           'amount_iqd',          bp.amount_iqd,
           'refund_amount_iqd',   bp.refund_amount_iqd,
           'status',              bp.status,
           'refund_reason',       bp.refund_reason,
           'refund_requested_at', bp.refund_requested_at,
           'refund_attempts',     bp.refund_attempts,
           'succeeded_at',        bp.succeeded_at,
           'sandbox',             bp.sandbox,
           'court_name_en',       c.name_en,
           'court_name_ar',       c.name_ar,
           'start_at',            coalesce(r.start_at, ls.start_at),
           'purpose',             bp.purpose,
           'ticket_count',        bp.ticket_count,
           'customer_id',         bp.guest_id,
           'lesson_enrolment_id', bp.lesson_enrolment_id,
           'enrolment_id',        bp.lesson_enrolment_id,
           'lesson_id',           le.lesson_id,
           'course_id',           le.course_id) order by coalesce(bp.refund_requested_at, bp.succeeded_at)),
         '[]'::jsonb)
    into v_out
    from booking_payments bp
    left join reservations r on r.id = bp.reservation_id
    left join courts c on c.id = r.court_id
    left join profiles p on p.id = bp.guest_id
    left join lesson_enrolments le on le.id = bp.lesson_enrolment_id
    left join lateral (
      select x.start_at
        from lessons x
       where x.id = le.lesson_id
          or (x.course_id = le.course_id
              and x.session_no between le.first_session_no
                                   and le.first_session_no + le.sessions_covered - 1)
       order by x.start_at, x.session_no
       limit 1) ls on bp.purpose = 'lesson'
   where (bp.venue_id = v_venue or (bp.purpose = 'ticket' and not bp.sandbox))
     and (bp.status = 'refund_failed'
          or (bp.status = 'refund_pending' and bp.refund_requested_at <= now() - interval '24 hours')
          or (bp.purpose = 'deposit' and bp.status = 'succeeded' and bp.forfeited_at is null
              and not (r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed', 'no_show')))
          -- 0281: a succeeded lesson row whose enrolment, lesson or course is
          -- over without it, with online money still due back (the cheap tests
          -- first, so the engine runs only on those).
          or (bp.purpose = 'lesson' and bp.status = 'succeeded'
              and (le.status in ('cancelled', 'expired')
                   or exists (select 1 from lessons l2 where l2.id = le.lesson_id and l2.status = 'cancelled')
                   or exists (select 1 from courses c2 where c2.id = le.course_id and c2.status = 'cancelled'))
              and coalesce((app.lesson_enrolment_money(bp.lesson_enrolment_id) ->> 'refund_due_online_iqd')::bigint, 0) > 0));
  return v_out;
end $deposit_attention_0281$;

comment on function app.deposit_attention(uuid) is
  '0242, 0258, 0281. Manager, owner. Online payments a person must look at: refund_failed, refund_pending for more than 24 hours, succeeded deposits whose booking is no longer live, and succeeded lesson payments whose enrolment, lesson or course ended without them and that still owe money back (0281). Deposits and lesson payments of the branch, plus every branch''s view of the chain''s open-match ticket purchases (never the review account''s sandbox ones). Items carry purpose, ticket_count and customer_id; a lesson row also lesson_enrolment_id, enrolment_id, lesson_id, course_id, the payer''s name and phone, and its first covered session''s start_at.';

revoke all on function app.deposit_attention(uuid) from public, anon;
grant execute on function app.deposit_attention(uuid) to authenticated;

-- ===========================================================================
-- 9. deposit_refund_request — re-issued verbatim from 20260929000258_match_tables.sql:1155,
--    plus the lesson rule (CM-5), marked 0281
-- ===========================================================================
create or replace function app.deposit_refund_request(p_payment_id uuid, p_amount_iqd bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_request_0281$
declare
  v booking_payments%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.purpose = 'ticket' then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = 'ticket';
  end if;
  if not app.is_staff_at(v.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  -- 0281 (CM-5): online lesson money goes back by hand only once the
  -- enrolment's money is final (no covered session still to come): while a
  -- session is ahead, the cancel that may still come needs the one refund a
  -- row allows. Final never turns back, so the unlocked read is sound.
  if v.purpose = 'lesson'
     and not coalesce((app.lesson_enrolment_money(v.lesson_enrolment_id) ->> 'final')::boolean, false) then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = 'lesson_live';
  end if;
  -- Lock order court → reservations → booking_payments, as deposit_apply.
  -- 0281: a lesson row has no booking; both are no-ops for it (0042:53).
  perform app.lock_court((select court_id from reservations where id = v.reservation_id));
  perform 1 from reservations where id = v.reservation_id for update;
  perform 1 from booking_payments where id = p_payment_id for update;
  perform set_config('app.venue_id', v.venue_id::text, true);
  v := app.deposit_begin_refund(p_payment_id, 'staff_refund', p_amount_iqd);
  perform app.deposit_nudge();
  return jsonb_build_object('id', v.id, 'status', v.status, 'refund_amount_iqd', v.refund_amount_iqd);
end $deposit_refund_request_0281$;

comment on function app.deposit_refund_request(uuid, bigint) is
  '0242, 0258, 0281. Manager, owner of the payment''s branch. succeeded → refund_pending with refund_reason staff_refund (partial when an amount is given). A ticket purchase is refused PAYMENT_STATE detail ticket: tickets go back only by a cash-out. A lesson payment only once its enrolment''s money is final (no covered session still to come), else PAYMENT_STATE detail lesson_live (CM-5).';

revoke all on function app.deposit_refund_request(uuid, bigint) from public, anon;
grant execute on function app.deposit_refund_request(uuid, bigint) to authenticated;
