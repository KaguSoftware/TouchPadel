set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0292 lesson_money_reports — the coaching post-build review, lesson money
-- and reports (plan "Coaching: make it bulletproof" §1, items DB-15 to
-- DB-20; decision D2). 0273–0289 are not edited: every function below is
-- re-issued from its latest body, verbatim except for the change named;
-- dollar tags _0292.
--
--   Schema  lesson_enrolments.kept_until (DB-18), backfilled for every
--           guest_late cancel from the branch's window as it is now; a
--           partial index lesson_enrolments (venue_id) for the ended places
--           (DB-15).
--   DB-15   New app.lesson_enrolment_may_owe(enrolment): the paid-money
--           condition (a settled lesson tab, or an online lesson row with a
--           refund) AND (the place is no longer booked, or a covered session
--           is cancelled or expired, or desk plus online money is above its
--           price). Exact: a booked place with every session still on is due
--           its whole price, so it can owe nothing back unless overpaid.
--           Applied in app.lesson_refunds_due (0281:2164), test 3 of
--           app.lesson_money_open (0281:648) and the desk refund figure,
--           which moves from app.lesson_money_figures (0288:55) to
--           app.day_close_online (0288:1237), its only reader.
--   DB-16   app.report_drill (0219:410, never re-issued since): the revenue
--           drill adds up to reports_figures.revenue again (lesson money
--           tagged revenue and lessonRevenue by lesson_money_figures'
--           definitions: desk payments on lesson tabs, their refunds less,
--           online lesson rows by succeeded_at, their refunds less by
--           refunded_at, handbacks outside the till less), and the cash and
--           card drills add up to reports_figures.cash and .card (tabs with no
--           table are no longer dropped: t.venue_id, not the left-joined
--           ct.venue_id, in the payment and order branches; a refund is a
--           positive row under refunds and a negative twin under its method,
--           which scope-only drills leave out like the cafeNet twin). No guest
--           identity on a lesson row (R42). lessonRevenue is a figure, the
--           owner's alone.
--   DB-17   app.ops_overview (0281:1492): blockingTabs filters the tab's own
--           columns in WHERE and the venue checks of the left-joined table and
--           booking move to their ON clauses, so counter, shop and lesson tabs
--           are listed; a lesson tab is named by its place (R44) and every
--           row carries the tab's kind.
--   DB-18   app.enrolment_cancel_internal (0283:504) stamps kept_until =
--           cancelled_at + the branch's cancellation window (coaching_rules,
--           in the same transaction) on a guest_late cancel, and
--           app.lesson_enrolment_money (0281:173) judges a cancelled course
--           leave by it: a later change of the window no longer moves what
--           the venue keeps (R75). The if_cancelled previews keep the live
--           window. A row with no stamp (planted by a test) falls back to the
--           live window.
--   DB-19   app.lesson_money_open (0281:648): also true while a lesson row of
--           the branch is refund_pending, or while a (coach, branch) pair has
--           adjustment lines not yet drafted (app.coach_statement_plan for the
--           branch-local month now has an is_adjustment line: money that moved
--           on a lesson of a month already paid). R37 amended (§1.15 D6).
--   DB-20   D2: money handed back outside the till (lesson_events refunded,
--           code outside, R75) reduces lessonRevenue. app.lesson_money_figures
--           gains outsideRefundsIqd and outsideRefundsCount (by the event's
--           time, sandbox left out) and subtracts them in netIqd;
--           app.report_revenue (0288:412) subtracts them from lessonIqd (with
--           no filter: the money has no method or till) and
--           app.report_lessons (0288:1457) adds them to refundsIqd.
--           day_close_online is left alone for them: the money never went
--           through the till.
--
-- Everything re-issued keeps its signature and grants; the new helper is
-- internal, revoked from every client role. Nothing takes a new lock (the
-- bodies changed here read, and enrolment_cancel_internal only adds a column
-- to its own update), so check:locks walks the same sequences. No new error
-- code.
--
-- MIGRATION-RISK-ACCEPTED (check-migrations index-not-concurrent): the partial
-- index is on lesson_enrolments, a coaching table (0278) with coaching off on
-- every branch, so it holds a handful of rows at most; the build takes SHARE
-- for one scan of it under lock_timeout 3s, as 0279's coaching indexes did.

-- ===========================================================================
-- Schema (DB-15, DB-18)
-- ===========================================================================

alter table lesson_enrolments add column if not exists kept_until timestamptz;

comment on column lesson_enrolments.kept_until is
  '0292 (DB-18, R75). A guest_late cancel: cancelled_at plus the branch''s cancellation window at the cancel. The engine keeps a course leave''s sessions starting before it, whatever the window becomes later. NULL otherwise.';

-- Backfill: every guest_late cancel so far, from the branch's window as it is
-- now (12 hours with no settings row, as the engine reads it).
update lesson_enrolments e
   set kept_until = e.cancelled_at
                    + make_interval(hours => coalesce((select vs.cancellation_window_hours
                                                         from venue_settings vs
                                                        where vs.venue_id = e.venue_id), 12))
 where e.status = 'cancelled'
   and e.cancel_kind = 'guest_late'
   and e.cancelled_at is not null
   and e.kept_until is null;

create index if not exists lesson_enrolments_ended_venue
  on lesson_enrolments (venue_id) where status in ('cancelled', 'expired');

-- ===========================================================================
-- DB-15: app.lesson_enrolment_may_owe (new)
-- ===========================================================================

-- Whether the engine can find lesson money owed back on this place: the cheap
-- gate in front of every reader that lists or sums refunds due. It took money
-- (a settled lesson tab, or an online lesson row that had a refund) AND it is
-- no longer booked (held, cancelled, expired), or one of its covered sessions
-- is cancelled or expired, or its desk plus applied online money is above its
-- price. A booked place with every session on counts every session (money.md
-- §5.2), so its due is its whole price and nothing goes back unless it was
-- overpaid: the gate never hides a refund the engine would find.
create or replace function app.lesson_enrolment_may_owe(p_enrolment_id uuid) returns boolean
language sql stable security definer set search_path = public as $lesson_enrolment_may_owe_0292$
  select exists (
    select 1
      from lesson_enrolments e
     where e.id = p_enrolment_id
       and (exists (select 1 from tabs t where t.lesson_enrolment_id = e.id and t.status = 'settled')
            or exists (select 1 from booking_payments bp
                        where bp.lesson_enrolment_id = e.id and bp.purpose = 'lesson'
                          and bp.status in ('refund_pending', 'refund_failed', 'refunded')))
       and (e.status <> 'booked'
            or exists (select 1 from lessons l
                        where ((e.lesson_id is not null and l.id = e.lesson_id)
                               or (e.course_id is not null and l.course_id = e.course_id
                                   and l.session_no >= e.first_session_no
                                   and l.session_no < e.first_session_no + e.sessions_covered))
                          and l.status in ('cancelled', 'expired'))
            or (select coalesce(sum(t.lesson_iqd), 0)
                  from tabs t
                 where t.lesson_enrolment_id = e.id and t.status = 'settled' and t.merged_into_tab_id is null)
               + (select coalesce(sum(bp.amount_iqd), 0)
                    from booking_payments bp
                   where bp.purpose = 'lesson' and bp.lesson_enrolment_id = e.id
                     and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')
                     and coalesce(bp.refund_reason, '') not in ('amount_mismatch', 'duplicate_success',
                                                                 'slot_lost', 'venue_offline'))
               > e.price_iqd))
$lesson_enrolment_may_owe_0292$;

comment on function app.lesson_enrolment_may_owe(uuid) is
  '0292 (DB-15; money.md §5.11). Internal. True when the engine can find lesson money owed back on the place: it took money (a settled lesson tab, or an online lesson row in refund_pending, refund_failed or refunded) and it is not booked, or a covered session is cancelled or expired, or its desk plus applied online money is above price_iqd. Exact: a booked place with every session on is due its price. Read by lesson_refunds_due, lesson_money_open and day_close_online before they run the engine. Takes no lock.';

revoke all on function app.lesson_enrolment_may_owe(uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-18: the engine (re-issued from 20261001000281_lesson_money.sql:173)
-- ===========================================================================

-- 0292 (DB-18, R75): a cancelled course leave (guest_late) keeps the sessions
-- starting before its kept_until, the window as it was at the cancel; the
-- if_cancelled previews (a cancel now) keep the window as it is now.
create or replace function app.lesson_enrolment_money(p_enrolment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_enrolment_money_0292$
declare
  v_e         lesson_enrolments%rowtype;
  v_kind      text;
  v_window    interval;
  v_until     timestamptz;
  v_shares    bigint[];
  v_desk_paid bigint;
  v_desk_ref  bigint;
  v_on_paid   bigint;
  v_on_ref    bigint;
  v_on_open   bigint;
  v_sb_net    bigint;
  v_sandbox   boolean;
  v_outside   bigint;
  v_gross     bigint;
  v_payable   boolean;
  v_final     boolean;
  v_modes     text[];
  v_mode      text;
  v_status    text;
  v_ck        text;
  v_at        timestamptz;
  v_next      uuid;
  v_rows      jsonb;
  v_due       bigint;
  v_n         int;
  v_left      int;
  v_net       bigint;
  v_kept      bigint;
  v_real      bigint;
  v_owed      bigint;
  v_rd        bigint;
  v_rd_on     bigint;
  v_rd_desk   bigint;
  v_blocked   bigint;
  v_alloc     bigint[];
  v_sessions  jsonb;
  v_out       jsonb;
  v_if        jsonb;
begin
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if not found then
    return null;
  end if;

  if v_e.course_id is not null then
    v_kind := 'course';
    v_shares := app.iqd_split(v_e.price_iqd, v_e.sessions_covered);
  else
    select l.kind into v_kind from lessons l where l.id = v_e.lesson_id;
  end if;

  -- W: the branch's cancellation window, read live for the previews, 12 hours
  -- by default as cancel_reservation reads it (0210). 0292 (DB-18): a
  -- cancelled leave is judged by its kept_until instead.
  select make_interval(hours => coalesce(vs.cancellation_window_hours, 12)) into v_window
    from venue_settings vs
   where vs.venue_id = v_e.venue_id;
  v_window := coalesce(v_window, make_interval(hours => 12));

  -- Desk money: the enrolment's settled, unmerged lesson tabs (gross, the
  -- court_fee_paid filter, 0242), and the till refunds on their payments.
  select coalesce(sum(t.lesson_iqd), 0)::bigint into v_desk_paid
    from tabs t
   where t.lesson_enrolment_id = v_e.id and t.status = 'settled' and t.merged_into_tab_id is null;
  select coalesce(sum(rf.amount_iqd), 0)::bigint into v_desk_ref
    from refunds rf
    join payments p on p.id = rf.payment_id
    join tabs t on t.id = p.tab_id
   where t.lesson_enrolment_id = v_e.id and t.status = 'settled' and t.merged_into_tab_id is null;

  -- Online money: the APPLIED rows (a row refunded because it never paid for
  -- the enrolment — amount_mismatch, duplicate_success, slot_lost,
  -- venue_offline — is not one). Money promised back counts as gone, as
  -- deposit_net_paid counts it (0258:703-704).
  select coalesce(sum(bp.amount_iqd), 0)::bigint,
         coalesce(sum(coalesce(bp.refund_amount_iqd, 0))
                    filter (where bp.status in ('refund_pending', 'refund_failed', 'refunded')), 0)::bigint,
         coalesce(sum(bp.amount_iqd) filter (where bp.status = 'succeeded'), 0)::bigint,
         coalesce(sum(bp.amount_iqd - case when bp.status in ('refund_pending', 'refund_failed', 'refunded')
                                           then coalesce(bp.refund_amount_iqd, 0) else 0 end)
                    filter (where bp.sandbox), 0)::bigint,
         coalesce(bool_or(bp.sandbox), false)
    into v_on_paid, v_on_ref, v_on_open, v_sb_net, v_sandbox
    from booking_payments bp
   where bp.purpose = 'lesson'
     and bp.lesson_enrolment_id = v_e.id
     and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')
     and coalesce(bp.refund_reason, '') not in ('amount_mismatch', 'duplicate_success', 'slot_lost', 'venue_offline');

  v_outside := coalesce(v_e.refunded_outside_iqd, 0);
  v_gross := v_desk_paid + v_on_paid;

  -- Payable at the desk: booked, a covered session still on, and (private or
  -- group) not marked a no-show (CD-11: nothing is collected from a no-show;
  -- unmarking makes it payable again).
  v_payable := v_e.status = 'booked'
    and exists (select 1 from lessons l
                 where ((v_e.lesson_id is not null and l.id = v_e.lesson_id)
                        or (v_e.course_id is not null and l.course_id = v_e.course_id
                            and l.session_no >= v_e.first_session_no
                            and l.session_no < v_e.first_session_no + v_e.sessions_covered))
                   and l.status not in ('cancelled', 'expired'))
    and (v_kind = 'course'
         or not exists (select 1 from lesson_attendance a
                         where a.lesson_id = v_e.lesson_id and a.enrolment_id = v_e.id
                           and a.status = 'no_show'));

  -- Final: nothing about this enrolment's money can change any more (CM-5).
  v_final := v_e.status = 'expired'
          or (v_e.status = 'cancelled' and v_e.cancel_kind is distinct from 'guest_late')
          or not exists (select 1 from lessons l
                          where ((v_e.lesson_id is not null and l.id = v_e.lesson_id)
                                 or (v_e.course_id is not null and l.course_id = v_e.course_id
                                     and l.session_no >= v_e.first_session_no
                                     and l.session_no < v_e.first_session_no + v_e.sessions_covered))
                            and l.status not in ('completed', 'cancelled', 'expired'));

  v_modes := case when v_e.status in ('held', 'booked') then array['actual', 'guest_free', 'guest_late']
                  else array['actual'] end;
  foreach v_mode in array v_modes loop
    if v_mode = 'actual' then
      v_status := v_e.status;
      v_ck := v_e.cancel_kind;
      v_at := v_e.cancelled_at;
      -- 0292 (DB-18): the window as it was at the cancel.
      v_until := coalesce(v_e.kept_until, v_at + v_window);
    else
      v_status := 'cancelled';
      v_ck := v_mode;
      v_at := now();
      v_until := v_at + v_window;
    end if;

    -- N_e (C-23): the guest's own next covered session at the cancel, not
    -- cancelled by then. A later venue cancel of it takes it out through "not
    -- cancelled" and never promotes the session after it.
    v_next := null;
    if v_kind = 'course' and v_status = 'cancelled' and v_ck = 'guest_late' then
      select l.id into v_next
        from lessons l
       where l.course_id = v_e.course_id
         and l.session_no >= v_e.first_session_no
         and l.session_no < v_e.first_session_no + v_e.sessions_covered
         and l.start_at >= v_at
         and (l.cancelled_at is null or l.cancelled_at > v_at)
       order by l.start_at, l.id
       limit 1;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'lesson_id', s.id, 'session_no', s.session_no, 'start_at', s.start_at, 'status', s.status,
             'share_iqd', s.share_amt, 'counts', s.counts) order by s.ord), '[]'::jsonb)
      into v_rows
      from (select l.id, l.session_no, l.start_at, l.status,
                   case when v_kind = 'course'
                        then coalesce(v_shares[l.session_no - v_e.first_session_no + 1], 0)
                        else v_e.price_iqd::bigint end as share_amt,
                   coalesce(case
                     when v_status in ('held', 'expired') then false
                     when v_status = 'booked' then l.status not in ('cancelled', 'expired')
                     when v_ck = 'guest_late' and v_kind <> 'course'
                       then l.status not in ('cancelled', 'expired') or l.cancel_reason = 'guest_cancel'
                     when v_ck = 'guest_late'
                       then l.status not in ('cancelled', 'expired')
                            and (l.start_at < v_until or l.id = v_next)
                     when v_ck = 'course_cancelled' then l.status not in ('cancelled', 'expired')
                     else l.status not in ('cancelled', 'expired') and l.start_at < v_at
                   end, false) as counts,
                   row_number() over (order by l.session_no nulls first, l.start_at, l.id) as ord
              from lessons l
             where (v_e.lesson_id is not null and l.id = v_e.lesson_id)
                or (v_e.course_id is not null and l.course_id = v_e.course_id
                    and l.session_no >= v_e.first_session_no
                    and l.session_no < v_e.first_session_no + v_e.sessions_covered)) s;

    select coalesce(sum((r->>'share_iqd')::bigint) filter (where (r->>'counts')::boolean), 0)::bigint,
           (count(*) filter (where (r->>'counts')::boolean))::int,
           (count(*) filter (where not (r->>'counts')::boolean
                               and r->>'status' not in ('cancelled', 'expired')))::int
      into v_due, v_n, v_left
      from jsonb_array_elements(v_rows) as r;

    v_net     := v_gross - v_desk_ref - v_on_ref - v_outside;
    v_kept    := least(v_net, v_due);
    v_rd      := greatest(v_net - v_due, 0);
    v_rd_on   := least(v_rd, v_on_open);
    v_rd_desk := least(v_rd - v_rd_on, greatest(v_desk_paid - v_desk_ref, 0));
    v_blocked := v_rd - v_rd_on - v_rd_desk;

    if v_mode = 'actual' then
      v_real := greatest(v_kept - v_sb_net, 0);
      v_owed := case when v_payable then greatest(v_due - v_gross, 0) else 0 end;
      v_alloc := case when v_n > 0 then app.iqd_split(v_real, v_n) end;
      select coalesce(jsonb_agg(y.r || jsonb_build_object(
               'alloc_iqd', case when y.c then coalesce(v_alloc[y.pos], 0) else 0 end) order by y.o), '[]'::jsonb)
        into v_sessions
        from (select x.r, x.o, coalesce((x.r->>'counts')::boolean, false) as c,
                     (sum(case when coalesce((x.r->>'counts')::boolean, false) then 1 else 0 end)
                        over (order by x.o))::int as pos
                from jsonb_array_elements(v_rows) with ordinality as x(r, o)) y;
      v_out := jsonb_build_object(
        'enrolment_id',          v_e.id,
        'kind',                  v_kind,
        'status',                v_e.status,
        'cancel_kind',           v_e.cancel_kind,
        'payment_mode',          v_e.payment_mode,
        'price_iqd',             v_e.price_iqd::bigint,
        'due_iqd',               v_due,
        'payable',               v_payable,
        'final',                 v_final,
        'desk_paid_iqd',         v_desk_paid,
        'desk_refunded_iqd',     v_desk_ref,
        'online_paid_iqd',       v_on_paid,
        'online_refunded_iqd',   v_on_ref,
        'online_refundable_iqd', v_on_open,
        'refunded_outside_iqd',  v_outside,
        'paid_gross_iqd',        v_gross,
        'net_iqd',               v_net,
        'kept_iqd',              v_kept,
        'real_kept_iqd',         v_real,
        'owed_iqd',              v_owed,
        'refund_due_iqd',        v_rd,
        'refund_due_online_iqd', v_rd_on,
        'refund_due_desk_iqd',   v_rd_desk,
        'refund_blocked_iqd',    v_blocked,
        'sandbox',               v_sandbox,
        'sessions',              v_sessions);
    else
      v_if := coalesce(v_if, '{}'::jsonb) || jsonb_build_object(v_mode, jsonb_build_object(
        'refund_iqd',      v_rd_on,
        'kept_iqd',        v_kept,
        'refund_due_iqd',  v_rd,
        'kept_sessions',   v_n,
        'refund_sessions', v_left));
    end if;
  end loop;

  return v_out || jsonb_build_object('if_cancelled', v_if);
end $lesson_enrolment_money_0292$;

comment on function app.lesson_enrolment_money(uuid) is
  '0281, 0292 (money.md §5.3; C-9, C-23, CM-2, CM-3, CM-15, R62, R75). Internal. The money engine of one enrolment: {enrolment_id, kind, status, cancel_kind, payment_mode, price_iqd, due_iqd, payable, final, desk_paid_iqd, desk_refunded_iqd, online_paid_iqd, online_refunded_iqd, online_refundable_iqd, refunded_outside_iqd, paid_gross_iqd, net_iqd, kept_iqd, real_kept_iqd, owed_iqd, refund_due_iqd, refund_due_online_iqd, refund_due_desk_iqd, refund_blocked_iqd, sandbox, if_cancelled {guest_free, guest_late: {refund_iqd, kept_iqd, refund_due_iqd, kept_sessions, refund_sessions}} | null, sessions [{lesson_id, session_no, start_at, status, share_iqd, counts, alloc_iqd}]}. Identities: kept + refund_due = net; refund_due = refund_due_online + refund_due_desk + refund_blocked; kept ≤ due; owed ≤ due; Σ alloc = real_kept. Owed uses gross money (CM-2), kept and refunds net money. 0292 (DB-18): a cancelled course leave keeps the sessions starting before its kept_until (the window at the cancel; the live window when unstamped); the if_cancelled previews use the live window. Stable, no locks; NULL for an unknown id; no name, phone or guest id. Key list: COACHING_SHAPES.lesson_enrolment_money (packages/core/src/coaching/shapes.ts).';

revoke all on function app.lesson_enrolment_money(uuid) from public, anon, authenticated;
-- The service role reads it directly (the shapes and money suites); no client.
grant execute on function app.lesson_enrolment_money(uuid) to service_role;

-- ===========================================================================
-- DB-18: app.enrolment_cancel_internal (re-issued from
-- 20261001000283_lesson_booking.sql:504)
-- ===========================================================================

-- Cancels one enrolment (db.md §4.7.2). The caller holds lock_coach. A live
-- private lesson goes with its enrolment (its reason from the kind). After
-- the status writes, Money's engine starts the online refund (R5, R28) for an
-- enrolment with an applied online row; Money derives the reason and the
-- amount (money.md §5.5: callers pass NULL). Events in Guest's order (guest.md
-- §4.3 item 2): enrolment_cancelled (code the kind; data reason, from,
-- refunds_started, places, lesson_id), then a cancelled private lesson's own
-- cancelled. Re-reads its row; {changed: false} when it is no longer live.
-- 0292 (DB-18): a guest_late cancel stamps kept_until = now() + the branch's
-- window, read from coaching_rules in this transaction.
create or replace function app.enrolment_cancel_internal(p_enrolment_id uuid, p_kind text, p_actor text,
                                                         p_profile_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $enrolment_cancel_internal_0292$
declare
  v_e        lesson_enrolments%rowtype;
  v_l        lessons%rowtype;
  v_co       courses%rowtype;
  v_from     text;
  v_reason   text;
  v_lreason  text;
  v_lcancel  boolean := false;
  v_refunds  int := 0;
  v_data     jsonb;
  v_kept     timestamptz;
begin
  if p_kind is null or p_kind not in ('guest_free', 'guest_late', 'coach', 'staff', 'under_filled',
                                      'account_deleted', 'course_cancelled') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;
  if p_actor is null or p_actor not in ('guest', 'coach', 'staff', 'system') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_actor';
  end if;

  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.id is null then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_e.status not in ('held', 'booked') then
    return jsonb_build_object('enrolment_id', v_e.id, 'changed', false, 'status', v_e.status,
                              'cancel_kind', v_e.cancel_kind, 'lesson_cancelled', false, 'refunds_started', 0);
  end if;
  v_from := v_e.status;
  perform set_config('app.venue_id', v_e.venue_id::text, true);

  if v_e.lesson_id is not null then
    select * into v_l from lessons where id = v_e.lesson_id;
    if v_l.status in ('cancelled', 'expired') then
      -- The lesson carried this enrolment (lesson_cancel_internal).
      v_reason := v_l.cancel_reason;
    elsif v_l.kind = 'private' and v_l.status in ('held', 'scheduled') then
      v_lreason := case p_kind
                     when 'guest_free' then 'guest_cancel'
                     when 'guest_late' then 'guest_cancel'
                     when 'coach' then 'coach_cancel'
                     when 'staff' then 'staff_cancel'
                     when 'under_filled' then 'under_filled'
                     when 'account_deleted' then 'account_deleted'
                     else 'staff_cancel'
                   end;
      update lessons
         set status = 'cancelled', cancel_reason = v_lreason, cancelled_at = now(), hold_expires_at = null,
             updated_at = now()
       where id = v_l.id and status in ('held', 'scheduled');
      perform app.lesson_court_release(v_l.id, 'cancelled');
      v_lcancel := true;
    end if;
  elsif p_kind = 'course_cancelled' then
    select * into v_co from courses where id = v_e.course_id;
    v_reason := v_co.cancel_reason;
  end if;

  -- 0292 (DB-18, R75): the window a late leave is judged by, as it is now.
  if p_kind = 'guest_late' then
    v_kept := now() + make_interval(hours => coalesce(
                (app.coaching_rules(v_e.venue_id) ->> 'cancellation_window_hours')::int, 12));
  end if;

  update lesson_enrolments
     set status = 'cancelled', cancel_kind = p_kind, cancelled_at = now(), hold_expires_at = null,
         kept_until = v_kept, updated_at = now()
   where id = v_e.id and status in ('held', 'booked');

  -- R28: after the status writes, for an enrolment with an applied online row.
  if exists (select 1 from booking_payments bp
              where bp.lesson_enrolment_id = v_e.id and bp.purpose = 'lesson'
                and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')) then
    v_refunds := coalesce(app.lesson_refund_start(v_e.id, null), 0);
  end if;

  v_data := jsonb_build_object('reason', v_reason,
                               'from', v_from,
                               'refunds_started', v_refunds,
                               'lesson_id', coalesce(v_e.lesson_id, app.course_ref_lesson(v_e.course_id)))
            || app.lesson_places_data(v_e.lesson_id, v_e.course_id);
  perform app.lesson_event(v_e.venue_id, v_e.lesson_id, v_e.course_id, v_e.id, 'enrolment_cancelled', p_actor,
                           p_profile_id, p_staff_id, p_kind, v_data);
  if v_lcancel then
    perform app.lesson_event(v_l.venue_id, v_l.id, null, null, 'cancelled', p_actor, p_profile_id, p_staff_id,
                             v_lreason, jsonb_build_object('enrolments', 1, 'via_course', false, 'lesson_id', v_l.id));
  end if;

  return jsonb_build_object('enrolment_id', v_e.id, 'changed', true, 'status', 'cancelled', 'cancel_kind', p_kind,
                            'lesson_cancelled', v_lcancel, 'refunds_started', v_refunds);
end $enrolment_cancel_internal_0292$;

comment on function app.enrolment_cancel_internal(uuid, text, text, uuid, uuid) is
  '0283, 0292 (db.md §4.7.2; R5, R28, R75). Internal; the caller holds lock_coach. Cancels a held or booked enrolment with cancel_kind p_kind (a live private lesson goes with it: guest_cancel for the guest kinds, else coach_cancel, staff_cancel, under_filled or account_deleted), stamping kept_until = now() + the branch''s cancellation window for guest_late (DB-18: the engine judges the leave by it), then calls Money''s lesson_refund_start(e, NULL) when it has an applied online row, then writes enrolment_cancelled (code p_kind; data reason = the lesson''s or course''s cancel_reason that carried it, from, refunds_started, places_taken, places_total, lesson_id) and a cancelled private lesson''s own cancelled event. No court lock; never a strike. Returns {enrolment_id, changed, status, cancel_kind, lesson_cancelled, refunds_started}; changed false when the enrolment was no longer live.';

revoke all on function app.enrolment_cancel_internal(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-15, DB-19: app.lesson_money_open (re-issued from
-- 20261001000281_lesson_money.sql:648)
-- ===========================================================================

-- R37. True while a branch still has coaching money to settle; close_branch
-- (0280) refuses BRANCH_HAS_BOOKINGS detail coaching_money while it is. The
-- tests, cheapest first: a draft or approved coach statement; a lesson refund
-- still in flight (refund_pending, DB-19); a statement lesson (money.md §7.1:
-- over, and completed, still scheduled, or a late guest cancel the venue kept
-- money for) in a branch-local month with no non-void statement for its coach
-- and branch; a place the engine may owe money on (lesson_enrolment_may_owe,
-- DB-15) with desk money still due back or online money blocked; adjustment
-- lines not yet drafted for a (coach, branch) pair (DB-19: a lesson of a paid
-- month whose money moved since).
create or replace function app.lesson_money_open(p_venue_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $lesson_money_open_0292$
declare
  v_tz    text;
  v_month date;
begin
  if p_venue_id is null then
    return false;
  end if;

  if exists (select 1 from coach_statements s
              where s.venue_id = p_venue_id and s.status in ('draft', 'approved')) then
    return true;
  end if;

  -- 0292 (DB-19): an online lesson refund still on its way to the guest.
  if exists (select 1 from booking_payments bp
              where bp.venue_id = p_venue_id and bp.purpose = 'lesson' and bp.status = 'refund_pending') then
    return true;
  end if;

  select v.timezone into v_tz from venues v where v.id = p_venue_id;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');
  if exists (select 1
               from lessons l
              where l.venue_id = p_venue_id
                and l.end_at <= now()
                and not exists (select 1 from coach_statements s
                                 where s.coach_id = l.coach_id
                                   and s.venue_id = l.venue_id
                                   and s.status <> 'void'
                                   and s.month = date_trunc('month', l.start_at at time zone v_tz)::date)
                and (l.status in ('completed', 'scheduled')
                     or (l.status = 'cancelled' and l.cancel_reason = 'guest_cancel'
                         and app.lesson_collected(l.id) > 0))) then
    return true;
  end if;

  if exists (select 1
               from lesson_enrolments x
              where x.venue_id = p_venue_id
                and app.lesson_enrolment_may_owe(x.id)
                and exists (select 1
                              from (select app.lesson_enrolment_money(x.id) as m) mm
                             where (mm.m->>'refund_due_desk_iqd')::bigint > 0
                                or (mm.m->>'refund_blocked_iqd')::bigint > 0)) then
    return true;
  end if;

  -- 0292 (DB-19): adjustments not yet drafted. The pairs are the monthly
  -- run's (coach_statements_draft): every coach_branches row of the branch,
  -- plus every coach with a lesson there in the look-back.
  v_month := date_trunc('month', (now() at time zone v_tz)::date)::date;
  if exists (select 1
               from (select cb.coach_id from coach_branches cb where cb.venue_id = p_venue_id
                     union
                     select l.coach_id from lessons l
                      where l.venue_id = p_venue_id and l.start_at >= now() - interval '13 months') pr
              where exists (select 1
                              from jsonb_array_elements(app.coach_statement_plan(pr.coach_id, p_venue_id, v_month)) x
                             where (x ->> 'is_adjustment')::boolean)) then
    return true;
  end if;

  return false;
end $lesson_money_open_0292$;

comment on function app.lesson_money_open(uuid) is
  '0281, 0292 (R37, amended §1.15 D6). Internal. True while branch p_venue_id still has coaching money to settle: a coach statement in draft or approved; an online lesson refund still refund_pending (DB-19); a statement lesson (over, and completed, still scheduled, or a late guest cancel that kept money) in a branch-local month with no non-void statement for its coach; a place with lesson money still due back at the till or blocked on Qi (refund_due_desk_iqd, refund_blocked_iqd; only places app.lesson_enrolment_may_owe lets through, DB-15); or a (coach, branch) pair whose coach_statement_plan for the branch-local month now has an adjustment line (money that moved on a lesson of a month already paid, DB-19). close_branch (0280) refuses BRANCH_HAS_BOOKINGS detail coaching_money while it is.';

revoke all on function app.lesson_money_open(uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-15: app.lesson_refunds_due (re-issued from
-- 20261001000281_lesson_money.sql:2164)
-- ===========================================================================

-- lesson_refunds_due (money.md §5.11, X21, R44, R75): the lesson money a branch
-- owes back at the till, and the online money Qi could not take back. Manager,
-- owner; the role before the branch (R57). 0292 (DB-15): the engine runs only
-- on places app.lesson_enrolment_may_owe lets through. label and phone follow
-- R44: a coach- or desk-booked student's typed name and phone, never the
-- profile's; a guest's own booking the profile's name and phone (staff see
-- phones; C-16 limits coaches only).
create or replace function app.lesson_refunds_due(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_refunds_due_0292$
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
    select e.id, e.lesson_id, e.course_id, e.guest_id, e.guest_name, e.guest_phone, e.booked_by_kind,
           e.cancel_kind, e.cancelled_at, e.first_session_no, e.sessions_covered,
           app.lesson_enrolment_money(e.id) as m
      from lesson_enrolments e
     where e.venue_id = v_venue
       and app.lesson_enrolment_may_owe(e.id)
  ),
  due as (
    select c.*,
           (c.m->>'refund_due_iqd')::bigint      as rd,
           (c.m->>'refund_due_desk_iqd')::bigint as rd_desk,
           (c.m->>'refund_blocked_iqd')::bigint  as blocked
      from cand c
     where (c.m->>'refund_due_desk_iqd')::bigint > 0 or (c.m->>'refund_blocked_iqd')::bigint > 0
  ),
  listed as (
    select d.*,
           coalesce(l.kind, 'course') as kind,
           coalesce(l.coach_id, co.coach_id) as coach_id,
           coalesce(l.lesson_type_id, co.lesson_type_id) as lesson_type_id,
           coalesce(l.start_at,
                    (select min(s.start_at) from lessons s
                      where s.course_id = d.course_id
                        and s.session_no >= d.first_session_no
                        and s.session_no < d.first_session_no + d.sessions_covered)) as start_at
      from due d
      left join lessons l on l.id = d.lesson_id
      left join courses co on co.id = d.course_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrolment_id',        r.id,
           'lesson_id',           r.lesson_id,
           'course_id',           r.course_id,
           'kind',                r.kind,
           'coach_id',            r.coach_id,
           'coach_name_en',       ch.display_name_en,
           'coach_name_ar',       ch.display_name_ar,
           'type_name_en',        lt.name_en,
           'type_name_ar',        lt.name_ar,
           'start_at',            r.start_at,
           'label',               case when r.booked_by_kind = 'guest' then coalesce(p.full_name, r.guest_name)
                                       else r.guest_name end,
           'phone',               case when r.booked_by_kind = 'guest' then p.phone else r.guest_phone end,
           'cancel_kind',         r.cancel_kind,
           'cancelled_at',        r.cancelled_at,
           'refund_due_iqd',      r.rd,
           'refund_due_desk_iqd', r.rd_desk,
           'online_blocked_iqd',  r.blocked,
           'payments',            coalesce((
             select jsonb_agg(jsonb_build_object(
                      'payment_id',     py.id,
                      'tab_id',         t.id,
                      'method',         py.method,
                      'amount_iqd',     py.amount_iqd,
                      'refunded_iqd',   coalesce(rf.refunded, 0),
                      'refundable_iqd', py.amount_iqd - coalesce(rf.refunded, 0),
                      'created_at',     py.created_at) order by py.created_at, py.id)
               from tabs t
               join payments py on py.tab_id = t.id
               left join lateral (select sum(x.amount_iqd)::bigint as refunded
                                    from refunds x where x.payment_id = py.id) rf on true
              where t.lesson_enrolment_id = r.id and t.status = 'settled' and t.merged_into_tab_id is null),
             '[]'::jsonb))
           order by r.start_at, r.id), '[]'::jsonb),
         coalesce(sum(r.rd_desk + r.blocked), 0)::bigint
    into v_items, v_total
    from listed r
    left join coaches ch on ch.id = r.coach_id
    left join lesson_types lt on lt.id = r.lesson_type_id
    left join profiles p on p.id = r.guest_id;

  return jsonb_build_object('venue_id', v_venue, 'total_iqd', v_total, 'items', v_items);
end $lesson_refunds_due_0292$;

comment on function app.lesson_refunds_due(uuid) is
  '0281, 0292 (money.md §5.11, X21, R44, R75; DB-15). Manager or owner at the branch (p_venue_id, default the caller''s resolved branch; the role first, R57): the lesson money the branch owes back. {venue_id, total_iqd (Σ refund_due_desk_iqd + Σ online_blocked_iqd), items [{enrolment_id, lesson_id, course_id, kind, coach_id, coach_name_en, coach_name_ar, type_name_en, type_name_ar, start_at (a course: its first covered session), label, phone (a coach- or desk-booked student''s typed name and phone, a guest''s own booking the profile''s), cancel_kind, cancelled_at, refund_due_iqd, refund_due_desk_iqd, online_blocked_iqd, payments [{payment_id, tab_id, method, amount_iqd, refunded_iqd, refundable_iqd, created_at}]}]}, oldest lesson first. The engine runs only on places app.lesson_enrolment_may_owe lets through. A desk item is refunded with app.refund (reason lesson_refund, up to refund_due_desk_iqd); an online_blocked_iqd item is handed back outside the till and recorded with lesson_blocked_refund_record. FORBIDDEN, VENUE_MISMATCH. Key list: COACHING_SHAPES.lesson_refunds_due.';

revoke all on function app.lesson_refunds_due(uuid) from public, anon;
grant execute on function app.lesson_refunds_due(uuid) to authenticated;

-- ===========================================================================
-- DB-15, DB-20: app.lesson_money_figures (re-issued from
-- 20261001000288_lesson_reports.sql:55)
-- ===========================================================================

-- 0292: refundsDueDeskIqd/Count move to day_close_online, their only reader
-- (DB-15: no engine run per desk-paid place on every report); handbacks
-- outside the till (R75) are a refund of lesson money and come off netIqd
-- (DB-20, D2).
create or replace function app.lesson_money_figures(p_ts_from timestamptz, p_ts_to timestamptz, p_venues uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_money_figures_0292$
declare
  v_desk record;
  v_dref record;
  v_on   record;
  v_oref record;
  v_out  record;
  v_wait record;
  v_sl   record;
  v_ls   record;
  v_late bigint;
begin
  -- Desk money: the payments on kind 'lesson' tabs, by created_at, and their
  -- refunds by created_at (the moment each was made, as reports_figures dates
  -- every refund; the day close dates them by their till shift's day, R27).
  select coalesce(sum(p.amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_desk
    from payments p
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where p.venue_id = any (p_venues) and p.created_at >= p_ts_from and p.created_at < p_ts_to;

  select coalesce(sum(r.amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_dref
    from refunds r
    join payments p on p.id = r.payment_id
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where p.venue_id = any (p_venues) and r.venue_id = any (p_venues)
     and r.created_at >= p_ts_from and r.created_at < p_ts_to;

  -- Online money: every lesson row that succeeded in the range (a wrong
  -- amount, a duplicate or a slot lost is refunded in full and nets to 0 over
  -- time, the onlineDeposits rule), less what was refunded in the range.
  select coalesce(sum(bp.amount_iqd) filter (where not bp.sandbox), 0)::bigint as iqd,
         count(*) filter (where not bp.sandbox)::bigint                         as n,
         count(*) filter (where bp.sandbox)::bigint                             as sandbox
    into v_on
    from booking_payments bp
   where bp.purpose = 'lesson' and bp.venue_id = any (p_venues)
     and bp.succeeded_at >= p_ts_from and bp.succeeded_at < p_ts_to;

  select coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_oref
    from booking_payments bp
   where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any (p_venues)
     and bp.status = 'refunded'
     and bp.refunded_at >= p_ts_from and bp.refunded_at < p_ts_to;

  -- 0292 (DB-20, D2): online lesson money handed back outside the till
  -- (lesson_blocked_refund_record, R75), by the moment it was recorded; a
  -- place paid through the Qi sandbox counts 0 (CM-15).
  select coalesce(sum((ev.data ->> 'amount_iqd')::bigint), 0)::bigint as iqd, count(*)::bigint as n
    into v_out
    from lesson_events ev
   where ev.type = 'refunded' and ev.code = 'outside'
     and ev.venue_id = any (p_venues) and ev.at >= p_ts_from and ev.at < p_ts_to
     and not exists (select 1 from booking_payments bp
                      where bp.lesson_enrolment_id = ev.enrolment_id and bp.purpose = 'lesson' and bp.sandbox);

  select coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_wait
    from booking_payments bp
   where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any (p_venues)
     and bp.status in ('refund_pending', 'refund_failed');

  -- The statement lessons starting in the range (0287, money.md §7.1): the
  -- accrual figures, and the places, enrolments and marks on them. A course
  -- enrolment counts on every session it covers.
  with
  sl as (
    select * from app.coach_statement_lessons(p_venues, p_ts_from, p_ts_to, null)),
  cov as (
    select sl.lesson_id, sl.kind, e.id as enrolment_id, e.party_size
      from sl
      join lesson_enrolments e
        on e.status = 'booked'
       and (e.lesson_id = sl.lesson_id
            or (e.course_id = sl.course_id
                and sl.session_no between e.first_session_no
                                      and e.first_session_no + e.sessions_covered - 1)))
  select (select count(*) from sl)::bigint                                                    as lessons,
         (select count(*) from sl where sl.kind = 'private')::bigint                          as private_n,
         (select count(*) from sl where sl.kind = 'group')::bigint                            as group_n,
         (select count(*) from sl where sl.kind = 'course')::bigint                           as course_n,
         (select coalesce(sum(sl.minutes), 0) from sl)::bigint                                as minutes,
         (select coalesce(sum(sl.collected_iqd), 0) from sl)::bigint                          as collected,
         (select coalesce(sum(least(sl.court_share_iqd, sl.collected_iqd)), 0) from sl)::bigint as court,
         (select coalesce(sum(sl.coach_iqd), 0) from sl)::bigint                              as coach,
         (select coalesce(sum(sl.max_places), 0) from sl where sl.kind in ('group', 'course'))::bigint as places,
         (select coalesce(sum(cov.party_size), 0) from cov where cov.kind in ('group', 'course'))::bigint as taken,
         (select count(*) from cov)::bigint                                                   as enrolments,
         (select count(*) from lesson_attendance a join sl on sl.lesson_id = a.lesson_id
           where a.status = 'attended')::bigint                                               as attended,
         (select count(*) from lesson_attendance a join sl on sl.lesson_id = a.lesson_id
           where a.status = 'no_show')::bigint                                                as no_shows
    into v_sl;

  -- Every lesson starting in the range that did not take place.
  select count(*) filter (where l.status = 'cancelled')::bigint                                  as cancelled,
         count(*) filter (where l.status = 'cancelled' and l.cancel_reason = 'under_filled')::bigint as under_filled,
         count(*) filter (where l.status = 'expired')::bigint                                    as expired
    into v_ls
    from lessons l
   where l.venue_id = any (p_venues) and l.start_at >= p_ts_from and l.start_at < p_ts_to;

  -- Late cancels: a private or group place by its lesson's start, a course
  -- leave by when it was made.
  select count(*)::bigint into v_late
    from lesson_enrolments e
    left join lessons l on l.id = e.lesson_id
   where e.venue_id = any (p_venues)
     and e.status = 'cancelled' and e.cancel_kind = 'guest_late'
     and coalesce(l.start_at, e.cancelled_at) >= p_ts_from
     and coalesce(l.start_at, e.cancelled_at) < p_ts_to;

  return jsonb_build_object(
    'deskIqd',                   v_desk.iqd,
    'deskCount',                 v_desk.n,
    'deskRefundsIqd',            v_dref.iqd,
    'deskRefundsCount',          v_dref.n,
    'onlineIqd',                 v_on.iqd,
    'onlineCount',               v_on.n,
    'onlineRefundsIqd',          v_oref.iqd,
    'onlineRefundsCount',        v_oref.n,
    'outsideRefundsIqd',         v_out.iqd,
    'outsideRefundsCount',       v_out.n,
    'onlineRefundsWaitingIqd',   v_wait.iqd,
    'onlineRefundsWaitingCount', v_wait.n,
    'netIqd',                    v_desk.iqd - v_dref.iqd + v_on.iqd - v_oref.iqd - v_out.iqd,
    'lessons',                   v_sl.lessons,
    'private',                   v_sl.private_n,
    'group',                     v_sl.group_n,
    'courseSessions',            v_sl.course_n,
    'lessonMinutes',             v_sl.minutes,
    'collectedIqd',              v_sl.collected,
    'courtShareIqd',             v_sl.court,
    'owedToCoachesIqd',          v_sl.coach,
    'places',                    v_sl.places,
    'placesTaken',               v_sl.taken,
    'enrolments',                v_sl.enrolments,
    'attended',                  v_sl.attended,
    'noShows',                   v_sl.no_shows,
    'cancelled',                 v_ls.cancelled,
    'underFilled',               v_ls.under_filled,
    'expired',                   v_ls.expired,
    'lateCancels',               v_late,
    'sandboxExcluded',           v_on.sandbox);
end $lesson_money_figures_0292$;

comment on function app.lesson_money_figures(timestamptz, timestamptz, uuid[]) is
  '0288, 0292 (money.md §8.1; CM-13, CM-15). Internal, the ticket_money_figures twin: every lesson figure of the branches p_venues for [p_ts_from, p_ts_to), non-sandbox. Cash basis: deskIqd, deskCount (payments on kind lesson tabs by created_at), deskRefundsIqd, deskRefundsCount (their refunds by created_at), onlineIqd, onlineCount (lesson rows by succeeded_at), onlineRefundsIqd, onlineRefundsCount (refunded by refunded_at), outsideRefundsIqd, outsideRefundsCount (0292, DB-20: online money handed back outside the till, lesson_events refunded code outside, by the event''s time; a sandbox place left out), netIqd = desk - desk refunds + online - online refunds - outside refunds (lessonRevenue). Now: onlineRefundsWaitingIqd/Count (refund_pending, refund_failed). Accrual, over the statement lessons starting in the range (app.coach_statement_lessons): lessons, private, group, courseSessions, lessonMinutes, collectedIqd, courtShareIqd (Σ least(court share, collected)), owedToCoachesIqd (Σ the coach share; named so no SEC-29 coach pattern matches), places and placesTaken (group and course sessions), enrolments (booked enrolments on those lessons, a course enrolment on each session it covers), attended, noShows. Lessons starting in the range: cancelled, underFilled, expired; lateCancels (guest_late enrolments: by the lesson''s start, a course leave by when it was made). sandboxExcluded: sandbox lesson rows succeeded in the range. 0292 (DB-15): the desk refunds due now are day_close_online''s own figure. Read by reports_figures, report_revenue (pinned equal per range), report_courts, report_lessons and day_close_online. Aggregates only. Takes no lock.';

revoke all on function app.lesson_money_figures(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- DB-15: app.day_close_online (re-issued from
-- 20261001000288_lesson_reports.sql:1237)
-- ===========================================================================

-- day_close_online: re-issued from 20260929000265_match_reports.sql:155 (its
-- one re-issue, §1.8); + the lessons block and sandbox_excluded.lessons.
-- Information only: close_day is untouched (0281 dates its refunds by till
-- shift), desk lesson money is already in cash and card because it is
-- ordinary payments, and owed_to_coaches_iqd is NEVER part of the cash count
-- (C-12: the coach is paid outside the till). C-31, R27, R71: a desk lesson
-- refund counts on the day it was made, its till shift's day (the payment's
-- day when it was made outside a shift). 0292 (DB-15): the desk refunds due
-- now are summed here, over the places app.lesson_enrolment_may_owe lets
-- through (lesson_money_figures no longer carries them). A handback outside
-- the till (DB-20) is not in this card: it never went through the till.
create or replace function app.day_close_online(p_day_session_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $day_close_online_0292$
declare
  v_day      day_sessions%rowtype;
  v_tz       text;
  v_hour     int;
  v_from     timestamptz;
  v_to       timestamptz;
  v_tickets  jsonb;
  v_owed     jsonb;
  v_dep      jsonb;
  v_sb_dep   bigint;
  v_matches  jsonb;
  v_lm       jsonb;
  v_desk     record;
  v_dref     bigint;
  v_kept     record;
  v_lowed    record;
  v_rdue     record;
  v_lessons  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_day_session_id is not null then
    select * into v_day from day_sessions where id = p_day_session_id;
  else
    select * into v_day from day_sessions
     where venue_id = app.current_venue()
     order by (status = 'open') desc, business_date desc
     limit 1;
  end if;
  if not found then
    raise exception 'DAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_day.venue_id, 'manager', 'owner') then
    raise exception 'DAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The business day as bounds: app.venue_business_date(venue, ts) =
  -- business_date exactly when ts falls in [v_from, v_to) (0211:29).
  v_tz   := coalesce((select v.timezone from venues v where v.id = v_day.venue_id), 'Asia/Baghdad');
  v_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_day.venue_id), 4);
  v_from := (v_day.business_date::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
  v_to   := ((v_day.business_date + 1)::timestamp + make_interval(hours => v_hour)) at time zone v_tz;

  -- Online deposits of this branch: received by succeeded_at, refunded by
  -- refunded_at, kept for a no-show by forfeited_at; waiting = now.
  select jsonb_build_object(
           'received_iqd',          coalesce(sum(bp.amount_iqd) filter (where bp.succeeded_at >= v_from
                                                                        and bp.succeeded_at < v_to), 0)::bigint,
           'received_count',        count(*) filter (where bp.succeeded_at >= v_from and bp.succeeded_at < v_to),
           'refunded_iqd',          coalesce(sum(bp.refund_amount_iqd) filter (where bp.refunded_at >= v_from
                                                                               and bp.refunded_at < v_to), 0)::bigint,
           'refunded_count',        count(*) filter (where bp.refunded_at >= v_from and bp.refunded_at < v_to),
           'forfeited_iqd',         coalesce(sum(bp.amount_iqd) filter (where bp.forfeited_at >= v_from
                                                                        and bp.forfeited_at < v_to), 0)::bigint,
           'forfeited_count',       count(*) filter (where bp.forfeited_at >= v_from and bp.forfeited_at < v_to),
           'refunds_waiting_iqd',   coalesce(sum(bp.refund_amount_iqd)
                                               filter (where bp.status in ('refund_pending', 'refund_failed')), 0)::bigint,
           'refunds_waiting_count', count(*) filter (where bp.status in ('refund_pending', 'refund_failed')))
    into v_dep
    from booking_payments bp
   where bp.purpose = 'deposit' and not bp.sandbox and bp.venue_id = v_day.venue_id;

  select count(*) into v_sb_dep
    from booking_payments bp
   where bp.purpose = 'deposit' and bp.sandbox and bp.venue_id = v_day.venue_id
     and bp.succeeded_at >= v_from and bp.succeeded_at < v_to;

  -- Tickets through the one helper, with the day's bounds; the liability as of
  -- the close (or now, while the day is open).
  v_tickets := app.ticket_money_figures(v_from, v_to, array[v_day.venue_id]);
  v_owed    := app.ticket_money_figures(coalesce(v_day.closed_at, now()), coalesce(v_day.closed_at, now()),
                                        array[v_day.venue_id]);

  -- Open matches starting that business day: the live match bookings' money
  -- (M3: price = paid + written off + owed when nothing is over-paid), the
  -- call-offs, and the no-show carriers (R21: a no-show whose number a walk-in
  -- took carries nothing).
  select jsonb_build_object(
           'bookings',        count(*) filter (where x.live),
           'price_iqd',       coalesce(sum(x.price_iqd) filter (where x.live), 0)::bigint,
           'desk_paid_iqd',   coalesce(sum(app.court_fee_paid(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'written_off_iqd', coalesce(sum(app.court_fee_written_off(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'owed_iqd',        coalesce(sum(app.court_fee_remaining(x.reservation_id, null)) filter (where x.live), 0)::bigint,
           'called_off',      count(*) filter (where x.ended_reason = 'called_off_short'),
           'no_show_seats',   coalesce(sum(x.no_show_carriers), 0)::bigint)
    into v_matches
    from (
      select mt.reservation_id, mt.ended_reason,
             coalesce(r.kind = 'booking' and r.status in ('confirmed', 'arrived', 'completed'), false) as live,
             coalesce(r.price_iqd, 0)::bigint                                                       as price_iqd,
             (select count(*) from app.match_carriers(mt.id) c where c.status = 'no_show')          as no_show_carriers
        from matches mt
        left join reservations r on r.id = mt.reservation_id
       where mt.venue_id = v_day.venue_id and not mt.sandbox
         and mt.start_at >= v_from and mt.start_at < v_to) x;

  -- 0288 (money.md §8.6, X27): lessons.
  v_lm := app.lesson_money_figures(v_from, v_to, array[v_day.venue_id]);

  -- Desk lesson money taken in this day session; its refunds by the day they
  -- were made (C-31, R27: the till shift's day, else the payment's day).
  select coalesce(sum(p.amount_iqd), 0)::bigint as iqd, count(*)::bigint as n
    into v_desk
    from payments p
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where p.day_session_id = v_day.id;

  select coalesce(sum(r.amount_iqd), 0)::bigint
    into v_dref
    from refunds r
    join payments p on p.id = r.payment_id
    join tabs t on t.id = p.tab_id and t.kind = 'lesson'
   where r.venue_id = v_day.venue_id
     and coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id),
                  p.day_session_id) = v_day.id;

  -- Money the venue keeps for late cancels and no-shows on the sessions
  -- starting that business day: Σ the engine's allocation to each such session.
  select coalesce(sum((s ->> 'alloc_iqd')::bigint), 0)::bigint                        as iqd,
         count(distinct x.enrolment_id) filter (where (s ->> 'alloc_iqd')::bigint > 0)::bigint as n
    into v_kept
    from (select e.id as enrolment_id, l.id as lesson_id
            from lessons l
            join lesson_enrolments e
              on (e.lesson_id = l.id
                  or (e.course_id = l.course_id
                      and l.session_no between e.first_session_no
                                           and e.first_session_no + e.sessions_covered - 1))
           where l.venue_id = v_day.venue_id
             and l.start_at >= v_from and l.start_at < v_to
             and ((e.status = 'cancelled' and e.cancel_kind = 'guest_late')
                  or exists (select 1 from lesson_attendance a
                              where a.lesson_id = l.id and a.enrolment_id = e.id and a.status = 'no_show'))) x
    cross join lateral jsonb_array_elements(app.lesson_enrolment_money(x.enrolment_id) -> 'sessions') s
   where (s ->> 'lesson_id')::uuid = x.lesson_id;

  -- Played, not yet paid: booked desk enrolments with a session that started
  -- that business day (each enrolment once).
  select coalesce(sum(y.owed), 0)::bigint as iqd, count(*) filter (where y.owed > 0)::bigint as n
    into v_lowed
    from (select (app.lesson_enrolment_money(e.id) ->> 'owed_iqd')::bigint as owed
            from lesson_enrolments e
           where e.venue_id = v_day.venue_id
             and e.status = 'booked' and e.payment_mode = 'desk'
             and exists (select 1 from lessons l
                          where l.venue_id = v_day.venue_id
                            and l.start_at >= v_from and l.start_at < v_to and l.start_at <= now()
                            and l.status <> 'cancelled'
                            and (e.lesson_id = l.id
                                 or (e.course_id = l.course_id
                                     and l.session_no between e.first_session_no
                                                          and e.first_session_no + e.sessions_covered - 1)))) y;

  -- 0292 (DB-15): desk money owed back now (the till pays it, R36); the engine
  -- runs only on places that took desk money and may owe some back.
  select coalesce(sum(z.due), 0)::bigint as iqd, count(*) filter (where z.due > 0)::bigint as n
    into v_rdue
    from (select (app.lesson_enrolment_money(e.id) ->> 'refund_due_desk_iqd')::bigint as due
            from lesson_enrolments e
           where e.venue_id = v_day.venue_id
             and exists (select 1 from tabs t where t.lesson_enrolment_id = e.id and t.status = 'settled')
             and app.lesson_enrolment_may_owe(e.id)) z;

  v_lessons := jsonb_build_object(
    'desk_paid_iqd',                v_desk.iqd,
    'desk_paid_count',              v_desk.n,
    'desk_refunded_iqd',            v_dref,
    'online_received_iqd',          (v_lm ->> 'onlineIqd')::bigint,
    'online_received_count',        (v_lm ->> 'onlineCount')::bigint,
    'online_refunded_iqd',          (v_lm ->> 'onlineRefundsIqd')::bigint,
    'online_refunded_count',        (v_lm ->> 'onlineRefundsCount')::bigint,
    'online_refunds_waiting_iqd',   (v_lm ->> 'onlineRefundsWaitingIqd')::bigint,
    'online_refunds_waiting_count', (v_lm ->> 'onlineRefundsWaitingCount')::bigint,
    'refunds_due_desk_iqd',         v_rdue.iqd,
    'refunds_due_desk_count',       v_rdue.n,
    'kept_iqd',                     v_kept.iqd,
    'kept_count',                   v_kept.n,
    'lessons',                      (v_lm ->> 'lessons')::bigint,
    'owed_iqd',                     v_lowed.iqd,
    'owed_count',                   v_lowed.n,
    -- Information only: the coaches are paid outside the till (C-12).
    'owed_to_coaches_iqd',          (v_lm ->> 'owedToCoachesIqd')::bigint);

  return jsonb_build_object(
    'day_session_id', v_day.id,
    'venue_id',       v_day.venue_id,
    'business_date',  v_day.business_date,
    'as_of',          now(),
    'deposits',       v_dep,
    'tickets_here',   jsonb_build_object(
                        'forfeited_iqd',   v_tickets -> 'forfeitsIqd',
                        'forfeited_count', v_tickets -> 'forfeitedTickets',
                        'restored_count',  v_tickets -> 'restoredTickets',
                        'cashouts_iqd',    v_tickets -> 'cashoutsHereIqd',
                        'cashouts_count',  v_tickets -> 'cashoutsHereTickets'),
    'tickets_chain',  jsonb_build_object(
                        'sold_iqd',              v_tickets -> 'soldIqd',
                        'sold_tickets',          v_tickets -> 'soldTickets',
                        'purchases',             v_tickets -> 'purchases',
                        'refunded_iqd',          v_tickets -> 'refundedIqd',
                        'refunded_tickets',      v_tickets -> 'refundedTickets',
                        'refunds_waiting_iqd',   v_tickets -> 'refundsWaitingIqd',
                        'refunds_waiting_count', v_tickets -> 'refundsWaitingCount',
                        'liability_iqd',         v_owed -> 'liabilityIqd',
                        'liability_tickets',     v_owed -> 'liabilityTickets'),
    'matches',        v_matches,
    'lessons',        v_lessons,
    'sandbox_excluded', jsonb_build_object('deposits', v_sb_dep, 'tickets', v_tickets -> 'sandboxExcluded',
                                           'lessons', (v_lm ->> 'sandboxExcluded')::bigint));
end $day_close_online_0292$;

comment on function app.day_close_online(uuid) is
  '0288, 0292, from 0265 (money.md §7.2, §8.6). Manager or owner at the day''s branch: the day close''s "Money outside the drawer" card for p_day_session_id (default the branch''s open day, else its latest; another branch''s day is DAY_NOT_FOUND). {day_session_id, venue_id, business_date, as_of, deposits {...}, tickets_here {...}, tickets_chain {...}, matches {...} (0265, unchanged), lessons {desk_paid_iqd, desk_paid_count (payments on lesson tabs in this day session), desk_refunded_iqd (their refunds made this day: the till shift''s day, else the payment''s, C-31, R27, R71), online_received_iqd, online_received_count, online_refunded_iqd, online_refunded_count (by the day''s bounds), online_refunds_waiting_iqd, online_refunds_waiting_count, refunds_due_desk_iqd, refunds_due_desk_count (now: Σ the engine''s refund_due_desk_iqd over the places app.lesson_enrolment_may_owe lets through, 0292 DB-15), kept_iqd, kept_count (money kept for late cancels and no-shows on sessions starting that day), lessons, owed_to_coaches_iqd (statement lessons starting that day and the coaches'' share: information only, never part of the cash count, C-12), owed_iqd, owed_count (booked desk enrolments with a session played that day, not yet paid)}, sandbox_excluded {deposits, tickets, lessons}}. Information only: close_day is untouched and nothing here enters the cash count; a handback outside the till is not in it. Takes no lock. FORBIDDEN, DAY_NOT_FOUND, VENUE_REQUIRED (no default branch).';

revoke all on function app.day_close_online(uuid) from public, anon;
grant execute on function app.day_close_online(uuid) to authenticated;

-- ===========================================================================
-- DB-20: app.report_revenue (re-issued from
-- 20261001000288_lesson_reports.sql:412)
-- ===========================================================================

-- report_revenue: re-issued from 20260926000219_reports_venue_scope.sql:637;
-- + lessonIqd (part of totalIqd, C-18) and owedToCoachesIqd (accrual, never
-- in totalIqd), each bucketed by the business date of its own movement (X26).
-- With a paymentMethod or staffId filter, lessonIqd counts only the desk
-- lesson money that matches (online money has neither) and owedToCoachesIqd
-- is 0. 0292 (DB-20, D2): a handback outside the till comes off lessonIqd on
-- the day it was recorded (no filter matches it: it has no method or till).
create or replace function app.report_revenue(
  p_from    date,
  p_to      date,
  p_group   text default 'day',
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_revenue_0292$
declare
  v_rv uuid[] := app.report_venues();
  v_b      record;
  v_method payment_method;
  v_staff  uuid;
  v_rows   jsonb;
  v_totals jsonb;
begin
  perform app.reports_guard(true);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_group is null or p_group not in ('day','week','month') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_group', hint = 'p_group must be ''day'', ''week'' or ''month''';
  end if;
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters';
  end if;
  if p_filters ? 'paymentMethod' and jsonb_typeof(p_filters -> 'paymentMethod') <> 'null' then
    if (p_filters ->> 'paymentMethod') not in ('cash','card') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'paymentMethod', hint = 'paymentMethod must be ''cash'' or ''card''';
    end if;
    v_method := (p_filters ->> 'paymentMethod')::payment_method;
  end if;
  if p_filters ? 'staffId' and jsonb_typeof(p_filters -> 'staffId') <> 'null' then
    begin
      v_staff := (p_filters ->> 'staffId')::uuid;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'staffId';
    end;
  end if;

  with
  res as (
    select app.reports_bucket(app.business_date(r.start_at, v_b.tz, v_b.start_hour), p_group) as b,
           count(*)                            as bookings,
           coalesce(sum(r.price_iqd), 0)::bigint as padel_iqd
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking' and r.status in ('confirmed','arrived','completed')
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
       and (v_staff is null or r.created_by_staff_id = v_staff)
     group by 1),
  cafe as (
    select app.reports_bucket(app.business_date(s.settled_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(s.cafe_gross_iqd), 0)::bigint as cafe_iqd,
           coalesce(sum(s.cafe_net_iqd), 0)::bigint   as cafe_net_iqd,
           coalesce(sum(s.tax_iqd), 0)::bigint        as tax_iqd,
           coalesce(sum(s.discount_iqd), 0)::bigint   as discounts_iqd
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
     where (v_method is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.recorded_by = v_staff))
     group by 1),
  -- 0146: the Touch Shop share of the settled tabs, net of line and tab
  -- discounts and of refunds, before tax (cafe_net_lines, 0095). A breakdown
  -- of the café money, not an addition to it: total_iqd is unchanged.
  st as (
    select s.tab_id, s.settled_at
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
     where (v_method is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.method = v_method))
       and (v_staff  is null or exists (select 1 from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id and p.recorded_by = v_staff))),
  shop as (
    select app.reports_bucket(app.business_date(st.settled_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(nl.net_iqd), 0)::bigint as shop_iqd
      from app.cafe_net_lines(array(select st2.tab_id from st st2)) nl
      join st on st.tab_id = nl.tab_id
      join menu_items mi on mi.id = nl.menu_item_id
      join menu_categories c on c.id = mi.category_id and c.kind = 'shop'
     group by 1),
  ord as (
    select app.reports_bucket(app.business_date(o.placed_at, v_b.tz, v_b.start_hour), p_group) as b,
           count(*) as orders
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
       and (v_staff is null or o.placed_by_staff_id = v_staff)
     group by 1),
  pay as (
    select app.reports_bucket(app.business_date(p.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or p.recorded_by = v_staff)
     group by 1),
  ref as (
    select app.reports_bucket(app.business_date(r.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(r.amount_iqd), 0)::bigint                                   as refunds_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'cash'), 0)::bigint as cash_iqd,
           coalesce(sum(r.amount_iqd) filter (where p.method = 'card'), 0)::bigint as card_iqd
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or r.refunded_by = v_staff)
     group by 1),
  -- Staff-attributed discounts: the adjustment rows that member applied, by
  -- the day they applied them. A stamped tab discount has no single author,
  -- so this variant is the UNCAPPED sum of the rows (0068 behaviour).
  adj as (
    select app.reports_bucket(app.business_date(a.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(a.amount_iqd), 0)::bigint as discounts_iqd
      from tab_adjustments a
     where v_staff is not null
       and a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
       and a.applied_by = v_staff
     group by 1),
  vd as (
    select app.reports_bucket(app.business_date(l.at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum((l.after ->> 'line_total_iqd')::bigint), 0)::bigint as voids_iqd
      from audit_log l
     where l.venue_id = any(v_rv) and l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
       and (v_staff is null or l.actor_id = v_staff)
     group by 1),
  -- 0288 (money.md §8.3, CM-13): lesson money, cash basis, each movement by
  -- its own business date, by the definitions of app.lesson_money_figures
  -- (a test pins the two equal over the range): desk payments and their
  -- refunds by created_at (the filters apply), online payments by
  -- succeeded_at and their refunds by refunded_at (no filter can match them).
  les_pay as (
    select app.reports_bucket(app.business_date(p.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(p.amount_iqd), 0)::bigint as iqd
      from payments p
      join tabs t on t.id = p.tab_id and t.kind = 'lesson'
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or p.recorded_by = v_staff)
     group by 1),
  les_ref as (
    select app.reports_bucket(app.business_date(r.created_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(r.amount_iqd), 0)::bigint as iqd
      from refunds r
      join payments p on p.id = r.payment_id
      join tabs t on t.id = p.tab_id and t.kind = 'lesson'
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
       and (v_method is null or p.method = v_method)
       and (v_staff  is null or r.refunded_by = v_staff)
     group by 1),
  les_on as (
    select app.reports_bucket(app.business_date(bp.succeeded_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(bp.amount_iqd), 0)::bigint as iqd
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.succeeded_at >= v_b.ts_from and bp.succeeded_at < v_b.ts_to
       and v_method is null and v_staff is null
     group by 1),
  les_onref as (
    select app.reports_bucket(app.business_date(bp.refunded_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(bp.refund_amount_iqd), 0)::bigint as iqd
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.status = 'refunded'
       and bp.refunded_at >= v_b.ts_from and bp.refunded_at < v_b.ts_to
       and v_method is null and v_staff is null
     group by 1),
  -- 0292 (DB-20, D2): online lesson money handed back outside the till, by
  -- the moment it was recorded; a sandbox place left out (CM-15).
  les_out as (
    select app.reports_bucket(app.business_date(ev.at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum((ev.data ->> 'amount_iqd')::bigint), 0)::bigint as iqd
      from lesson_events ev
     where ev.type = 'refunded' and ev.code = 'outside' and ev.venue_id = any(v_rv)
       and ev.at >= v_b.ts_from and ev.at < v_b.ts_to
       and not exists (select 1 from booking_payments bp
                        where bp.lesson_enrolment_id = ev.enrolment_id and bp.purpose = 'lesson' and bp.sandbox)
       and v_method is null and v_staff is null
     group by 1),
  -- Accrual (X26): the coach share of the statement lessons starting in the
  -- bucket, as owedToCoaches; never part of total_iqd.
  les_owed as (
    select app.reports_bucket(app.business_date(sl.start_at, v_b.tz, v_b.start_hour), p_group) as b,
           coalesce(sum(sl.coach_iqd), 0)::bigint as iqd
      from app.coach_statement_lessons(v_rv, v_b.ts_from, v_b.ts_to, null) sl
     where v_method is null and v_staff is null
     group by 1),
  buckets as (
    select b from res union select b from cafe union select b from shop union select b from ord union select b from pay
    union select b from ref union select b from adj union select b from vd
    union select b from les_pay union select b from les_ref union select b from les_on union select b from les_onref
    union select b from les_out union select b from les_owed),
  rows_ as (
    select buckets.b                                                          as period,
           coalesce(res.padel_iqd, 0)                                         as padel_iqd,
           coalesce(cafe.cafe_iqd, 0)                                         as cafe_iqd,
           coalesce(cafe.cafe_net_iqd, 0)                                     as cafe_net_iqd,
           coalesce(shop.shop_iqd, 0)                                         as shop_iqd,
           coalesce(les_pay.iqd, 0) - coalesce(les_ref.iqd, 0)
             + coalesce(les_on.iqd, 0) - coalesce(les_onref.iqd, 0)
             - coalesce(les_out.iqd, 0)                                       as lesson_iqd,
           coalesce(les_owed.iqd, 0)                                          as owed_to_coaches_iqd,
           coalesce(res.padel_iqd, 0) + coalesce(cafe.cafe_net_iqd, 0)
             + coalesce(les_pay.iqd, 0) - coalesce(les_ref.iqd, 0)
             + coalesce(les_on.iqd, 0) - coalesce(les_onref.iqd, 0)
             - coalesce(les_out.iqd, 0)                                       as total_iqd,
           coalesce(pay.cash_iqd, 0) - coalesce(ref.cash_iqd, 0)              as cash_iqd,
           coalesce(pay.card_iqd, 0) - coalesce(ref.card_iqd, 0)              as card_iqd,
           case when v_staff is null then coalesce(cafe.discounts_iqd, 0)
                else coalesce(adj.discounts_iqd, 0) end                       as discounts_iqd,
           coalesce(vd.voids_iqd, 0)                                          as voids_iqd,
           coalesce(ref.refunds_iqd, 0)                                       as refunds_iqd,
           coalesce(cafe.tax_iqd, 0)                                          as tax_iqd,
           coalesce(ord.orders, 0)                                            as orders,
           coalesce(res.bookings, 0)                                          as bookings
      from buckets
      left join res       on res.b       = buckets.b
      left join cafe      on cafe.b      = buckets.b
      left join shop      on shop.b      = buckets.b
      left join ord       on ord.b       = buckets.b
      left join pay       on pay.b       = buckets.b
      left join ref       on ref.b       = buckets.b
      left join adj       on adj.b       = buckets.b
      left join vd        on vd.b        = buckets.b
      left join les_pay   on les_pay.b   = buckets.b
      left join les_ref   on les_ref.b   = buckets.b
      left join les_on    on les_on.b    = buckets.b
      left join les_onref on les_onref.b = buckets.b
      left join les_out   on les_out.b   = buckets.b
      left join les_owed  on les_owed.b  = buckets.b)
  select coalesce(jsonb_agg(jsonb_build_object(
           'period',           r.period,
           'padelIqd',         r.padel_iqd,
           'cafeIqd',          r.cafe_iqd,
           'cafeNetIqd',       r.cafe_net_iqd,
           'shopIqd',          r.shop_iqd,
           'lessonIqd',        r.lesson_iqd,
           'owedToCoachesIqd', r.owed_to_coaches_iqd,
           'totalIqd',         r.total_iqd,
           'cashIqd',          r.cash_iqd,
           'cardIqd',          r.card_iqd,
           'discountsIqd',     r.discounts_iqd,
           'voidsIqd',         r.voids_iqd,
           'refundsIqd',       r.refunds_iqd,
           'taxIqd',           r.tax_iqd,
           'orders',           r.orders,
           'bookings',         r.bookings
         ) order by r.period), '[]'::jsonb),
         jsonb_build_object(
           'padelIqd',         coalesce(sum(r.padel_iqd), 0)::bigint,
           'cafeIqd',          coalesce(sum(r.cafe_iqd), 0)::bigint,
           'cafeNetIqd',       coalesce(sum(r.cafe_net_iqd), 0)::bigint,
           'shopIqd',          coalesce(sum(r.shop_iqd), 0)::bigint,
           'lessonIqd',        coalesce(sum(r.lesson_iqd), 0)::bigint,
           'owedToCoachesIqd', coalesce(sum(r.owed_to_coaches_iqd), 0)::bigint,
           'totalIqd',         coalesce(sum(r.total_iqd), 0)::bigint,
           'cashIqd',          coalesce(sum(r.cash_iqd), 0)::bigint,
           'cardIqd',          coalesce(sum(r.card_iqd), 0)::bigint,
           'discountsIqd',     coalesce(sum(r.discounts_iqd), 0)::bigint,
           'voidsIqd',         coalesce(sum(r.voids_iqd), 0)::bigint,
           'refundsIqd',       coalesce(sum(r.refunds_iqd), 0)::bigint,
           'taxIqd',           coalesce(sum(r.tax_iqd), 0)::bigint,
           'orders',           coalesce(sum(r.orders), 0)::bigint,
           'bookings',         coalesce(sum(r.bookings), 0)::bigint)
    into v_rows, v_totals
    from rows_ r;

  return jsonb_build_object(
    'group',   p_group,
    'period',  jsonb_build_object('from', p_from, 'to', p_to),
    'columns', jsonb_build_array(
      jsonb_build_object('key','period',           'labelEn','Period',          'labelAr','الفترة',           'kind','date'),
      jsonb_build_object('key','padelIqd',         'labelEn','Padel',           'labelAr','البادل',           'kind','money'),
      jsonb_build_object('key','cafeIqd',          'labelEn','Cafe',            'labelAr','الكافيه',          'kind','money'),
      jsonb_build_object('key','cafeNetIqd',       'labelEn','Cafe net',        'labelAr','صافي الكافيه',     'kind','money'),
      jsonb_build_object('key','shopIqd',          'labelEn','Of which shop',   'labelAr','منها المتجر',      'kind','money'),
      -- 0288: the one coaching glossary (C-30, R55, R81).
      jsonb_build_object('key','lessonIqd',        'labelEn','Lessons',         'labelAr','الحصص',            'kind','money'),
      jsonb_build_object('key','owedToCoachesIqd', 'labelEn','Owed to coaches', 'labelAr','مستحق للمدرّبين',  'kind','money'),
      jsonb_build_object('key','totalIqd',         'labelEn','Total',           'labelAr','الإجمالي',         'kind','money'),
      jsonb_build_object('key','cashIqd',          'labelEn','Cash',            'labelAr','نقد',              'kind','money'),
      jsonb_build_object('key','cardIqd',          'labelEn','Card',            'labelAr','بطاقة',            'kind','money'),
      jsonb_build_object('key','discountsIqd',     'labelEn','Discounts',       'labelAr','الخصومات',         'kind','money'),
      jsonb_build_object('key','voidsIqd',         'labelEn','Voids',           'labelAr','الإلغاءات',        'kind','money'),
      jsonb_build_object('key','refundsIqd',       'labelEn','Refunds',         'labelAr','المبالغ المستردة', 'kind','money'),
      jsonb_build_object('key','taxIqd',           'labelEn','Tax',             'labelAr','الضريبة',          'kind','money'),
      jsonb_build_object('key','orders',           'labelEn','Orders',          'labelAr','الطلبات',          'kind','count'),
      jsonb_build_object('key','bookings',         'labelEn','Bookings',        'labelAr','الحجوزات',         'kind','count')),
    'rows',       v_rows,
    'totals',     v_totals,
    'comparison', null);
end $report_revenue_0292$;

comment on function app.report_revenue(date, date, text, jsonb) is
  '0288, 0292, from 0219 (0146, 0068). Owner only (reports_guard(true)): revenue by day, week or month over app.report_venues(), with paymentMethod and staffId filters. Per bucket and in totals: padelIqd, cafeIqd, cafeNetIqd, shopIqd, lessonIqd (coaching, money.md §8.3: desk lesson payments less their refunds by created_at, online lesson payments by succeeded_at less refunds by refunded_at, less money handed back outside the till by when it was recorded (0292, DB-20); with a filter, only the matching desk money), owedToCoachesIqd (the coach share of the statement lessons starting in the bucket; 0 with a filter; never in totalIqd), totalIqd (padel + cafe net + lessons, C-18), cashIqd, cardIqd, discountsIqd, voidsIqd, refundsIqd, taxIqd, orders, bookings; columns with EN and AR labels. FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.report_revenue(date, date, text, jsonb) from public, anon;
grant execute on function app.report_revenue(date, date, text, jsonb) to authenticated;

-- ===========================================================================
-- DB-20: app.report_lessons (re-issued from
-- 20261001000288_lesson_reports.sql:1457)
-- ===========================================================================

-- A person-money report (C-28, R42): byCoach is money about a named coach, so
-- it is in PERSON_MONEY_REPORTS (scanned for guest identity, exempt from the
-- coach patterns) and no assistant tool names it. No student name, phone or
-- guest id. collectedIqd and coachShareIqd are accrual (the statement
-- lessons); deskIqd, onlineIqd, refundsIqd and lessonRevenueIqd are cash
-- basis (app.lesson_money_figures). 0292 (DB-20, D2): refundsIqd counts the
-- money handed back outside the till too, so deskIqd + onlineIqd - refundsIqd
-- is lessonRevenueIqd.
create or replace function app.report_lessons(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $report_lessons_0292$
declare
  v_rv       uuid[] := app.report_venues();
  v_b        record;
  v_lm       jsonb;
  v_set      jsonb;
  v_by_coach jsonb;
  v_by_type  jsonb;
  v_by_day   jsonb;
  v_places   bigint;
  v_taken    bigint;
  v_coll     bigint;
  v_share    bigint;
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  v_lm := app.lesson_money_figures(v_b.ts_from, v_b.ts_to, v_rv);

  -- The statement lessons once, each with its booked enrolments.
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson',     sl.lesson_id,
           'coach',      sl.coach_id,
           'type',       sl.lesson_type_id,
           'kind',       sl.kind,
           'day',        app.business_date(sl.start_at, v_b.tz, v_b.start_hour),
           'collected',  sl.collected_iqd,
           'share',      sl.coach_iqd,
           'enrolments', (select count(*) from lesson_enrolments e
                           where e.status = 'booked'
                             and (e.lesson_id = sl.lesson_id
                                  or (e.course_id = sl.course_id
                                      and sl.session_no between e.first_session_no
                                                            and e.first_session_no + e.sessions_covered - 1))))),
           '[]'::jsonb)
    into v_set
    from app.coach_statement_lessons(v_rv, v_b.ts_from, v_b.ts_to, null) sl;

  select coalesce(jsonb_agg(jsonb_build_object(
           'coachId',       x.coach,
           'coachNameEn',   c.display_name_en,
           'coachNameAr',   c.display_name_ar,
           'lessons',       x.lessons,
           'enrolments',    x.enrolments,
           'collectedIqd',  x.collected,
           'coachShareIqd', x.share)
           order by x.collected desc, c.display_name_en), '[]'::jsonb)
    into v_by_coach
    from (select s.coach, count(*)::bigint as lessons, sum(s.enrolments)::bigint as enrolments,
                 sum(s.collected)::bigint as collected, sum(s.share)::bigint as share
            from jsonb_to_recordset(v_set) as s(lesson uuid, coach uuid, type uuid, kind text, day date,
                                                collected bigint, share bigint, enrolments bigint)
           group by s.coach) x
    join coaches c on c.id = x.coach;

  select coalesce(jsonb_agg(jsonb_build_object(
           'lessonTypeId', x.type,
           'nameEn',       lt.name_en,
           'nameAr',       lt.name_ar,
           'kind',         lt.kind,
           'lessons',      x.lessons,
           'enrolments',   x.enrolments,
           'collectedIqd', x.collected)
           order by x.collected desc, lt.sort_order, lt.name_en), '[]'::jsonb)
    into v_by_type
    from (select s.type, count(*)::bigint as lessons, sum(s.enrolments)::bigint as enrolments,
                 sum(s.collected)::bigint as collected
            from jsonb_to_recordset(v_set) as s(lesson uuid, coach uuid, type uuid, kind text, day date,
                                                collected bigint, share bigint, enrolments bigint)
           group by s.type) x
    join lesson_types lt on lt.id = x.type;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date',          x.day,
           'lessons',       x.lessons,
           'collectedIqd',  x.collected,
           'coachShareIqd', x.share)
           order by x.day), '[]'::jsonb)
    into v_by_day
    from (select s.day, count(*)::bigint as lessons, sum(s.collected)::bigint as collected,
                 sum(s.share)::bigint as share
            from jsonb_to_recordset(v_set) as s(lesson uuid, coach uuid, type uuid, kind text, day date,
                                                collected bigint, share bigint, enrolments bigint)
           group by s.day) x;

  v_places := (v_lm ->> 'places')::bigint;
  v_taken  := (v_lm ->> 'placesTaken')::bigint;
  v_coll   := (v_lm ->> 'collectedIqd')::bigint;
  v_share  := (v_lm ->> 'owedToCoachesIqd')::bigint;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', jsonb_build_object(
      'lessons',          (v_lm ->> 'lessons')::bigint,
      'private',          (v_lm ->> 'private')::bigint,
      'group',            (v_lm ->> 'group')::bigint,
      'courseSessions',   (v_lm ->> 'courseSessions')::bigint,
      'cancelled',        (v_lm ->> 'cancelled')::bigint,
      'underFilled',      (v_lm ->> 'underFilled')::bigint,
      'expired',          (v_lm ->> 'expired')::bigint,
      'enrolments',       (v_lm ->> 'enrolments')::bigint,
      'places',           v_places,
      'placesTaken',      v_taken,
      'fillRatePct',      case when v_places > 0 then round(v_taken * 100.0 / v_places, 1) end,
      'attended',         (v_lm ->> 'attended')::bigint,
      'noShows',          (v_lm ->> 'noShows')::bigint,
      'lateCancels',      (v_lm ->> 'lateCancels')::bigint,
      'collectedIqd',     v_coll,
      'courtShareIqd',    (v_lm ->> 'courtShareIqd')::bigint,
      'coachShareIqd',    v_share,
      'venueShareIqd',    v_coll - v_share,
      'deskIqd',          (v_lm ->> 'deskIqd')::bigint,
      'onlineIqd',        (v_lm ->> 'onlineIqd')::bigint,
      'refundsIqd',       (v_lm ->> 'deskRefundsIqd')::bigint + (v_lm ->> 'onlineRefundsIqd')::bigint
                            + (v_lm ->> 'outsideRefundsIqd')::bigint,
      'lessonRevenueIqd', (v_lm ->> 'netIqd')::bigint,
      'sandboxExcluded',  (v_lm ->> 'sandboxExcluded')::bigint),
    'byCoach', v_by_coach,
    'byType',  v_by_type,
    'byDay',   v_by_day,
    -- The byCoach table's columns, the report_courts shape; the one coaching
    -- glossary (C-30, R55, R81). DRAFT-AR.
    'columns', jsonb_build_array(
      jsonb_build_object('key','coachNameEn',   'labelEn','Coach',          'labelAr','المدرّب',      'kind','text'),
      jsonb_build_object('key','lessons',       'labelEn','Lessons',        'labelAr','الحصص',        'kind','count'),
      jsonb_build_object('key','enrolments',    'labelEn','Places taken',   'labelAr','الأماكن المحجوزة', 'kind','count'),
      jsonb_build_object('key','collectedIqd',  'labelEn','Collected',      'labelAr','المحصّل',       'kind','money'),
      jsonb_build_object('key','coachShareIqd', 'labelEn','Coach''s share', 'labelAr','نصيب المدرّب', 'kind','money')));
end $report_lessons_0292$;

comment on function app.report_lessons(date, date) is
  '0288, 0292 (money.md §8.7, X24; C-28, R42). Manager or owner (reports_guard): the Lessons report for a business-day range over app.report_venues(), lessons by start. {period {from, to}, totals {lessons, private, group, courseSessions, cancelled, underFilled, expired, enrolments, places, placesTaken, fillRatePct (group and course sessions, one decimal), attended, noShows, lateCancels, collectedIqd, courtShareIqd, coachShareIqd, venueShareIqd (= collected - coach share), deskIqd, onlineIqd, refundsIqd (desk, online and, since 0292 (DB-20), handed back outside the till), lessonRevenueIqd (= desk + online - refunds), sandboxExcluded} (app.lesson_money_figures: collected and coach share accrual over the statement lessons, desk, online, refunds and lesson revenue cash basis), byCoach [{coachId, coachNameEn, coachNameAr, lessons, enrolments, collectedIqd, coachShareIqd}], byType [{lessonTypeId, nameEn, nameAr, kind, lessons, enrolments, collectedIqd}], byDay [{date, lessons, collectedIqd, coachShareIqd}], columns (EN, AR)}. A person-money report: coach display names, never a student, a phone or a guest id; never an assistant tool (R42). FORBIDDEN, INVALID_RANGE.';

revoke all on function app.report_lessons(date, date) from public, anon;
grant execute on function app.report_lessons(date, date) to authenticated;

-- ===========================================================================
-- DB-17: app.ops_overview (re-issued from 20261001000281_lesson_money.sql:1492)
-- ===========================================================================

-- ops_overview: re-issued from 20260926000219_reports_venue_scope.sql:1254
-- (R71): the live expected-cash tile dates refunds as close_day does. 0292
-- (DB-17): blockingTabs filters only the tab's own columns in WHERE (a venue
-- check on a left-joined table there dropped every tab with no table or no
-- booking: counter, shop and lesson tabs); a lesson tab is named by its place
-- (R44: a desk- or coach-typed student's typed name, a guest's own booking
-- the profile's) and every row carries the tab's kind.
create or replace function app.ops_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $ops_overview_0292$
declare
  v_rv uuid[] := app.report_venues();
  v_now      timestamptz := now();
  v_today    date;
  v_b        record;
  v_day      day_sessions%rowtype;
  v_bookings jsonb;
  v_cafe     jsonb;
  v_stock    jsonb;
  v_staff    jsonb;
  v_exc      jsonb;
  v_close    jsonb;
begin
  perform app.reports_guard(false);

  v_today := app.business_date(v_now);
  select * into strict v_b from app.analytics_bounds(v_today, v_today);

  -- Bookings ---------------------------------------------------------------
  with r as (
    select *
      from reservations
     where reservations.venue_id = any(v_rv) and kind = 'booking'
       and start_at >= v_b.ts_from and start_at < v_b.ts_to)
  select jsonb_build_object(
           'today',          (select count(*) from r where status in ('confirmed','arrived','completed')),
           'arrived',        (select count(*) from r where status = 'arrived'),
           'upcoming',       (select count(*) from r where status = 'confirmed' and start_at > v_now),
           'noShows',        (select count(*) from r where status = 'no_show'),
           'cancelledToday', (select count(*) from reservations
                               where reservations.venue_id = any(v_rv) and kind = 'booking' and status = 'cancelled'
                                 and cancelled_at >= v_b.ts_from and cancelled_at < v_b.ts_to),
           'nextArrival',    (select jsonb_build_object(
                                       'reservationId', r.id,
                                       'startAt',       r.start_at,
                                       'courtNameEn',   c.name_en,
                                       'courtNameAr',   c.name_ar,
                                       'guestName',     coalesce(r.guest_name, pr.full_name))
                                from r
                                join courts c on c.id = r.court_id
                                left join profiles pr on pr.id = r.guest_id
                               where c.venue_id = any(v_rv) and r.status = 'confirmed' and r.end_at > v_now
                               order by r.start_at, r.id
                               limit 1))
    into v_bookings;

  -- Cafe -------------------------------------------------------------------
  select jsonb_build_object(
           'openTabs',         (select count(*) from tabs where tabs.venue_id = any(v_rv) and status in ('open','awaiting_payment')),
           'ticketsQueued',    (select count(*) from tickets where tickets.venue_id = any(v_rv) and status = 'queued'),
           'ticketsPreparing', (select count(*) from tickets where tickets.venue_id = any(v_rv) and status = 'preparing'),
           'ticketsLate',      (select count(*) from tickets
                                 where tickets.venue_id = any(v_rv) and status in ('queued','preparing')
                                   and v_now - created_at > make_interval(secs => target_seconds)),
           'waiterCallsOpen',  (select count(*) from waiter_calls where waiter_calls.venue_id = any(v_rv) and status in ('raised','acknowledged')),
           'ordersToday',      (select count(*) from orders
                                 where orders.venue_id = any(v_rv) and placed_at >= v_b.ts_from and placed_at < v_b.ts_to
                                   and status <> 'voided'))
    into v_cafe;

  -- Stock ------------------------------------------------------------------
  select jsonb_build_object(
           'low',          (select count(*) from v_ingredient_on_hand
                             where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
                               and is_active and low_stock_threshold is not null
                               and on_hand <= low_stock_threshold),
           'belowPar',     (select count(*) from v_ingredient_on_hand
                             where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))
                               and is_active and par_level is not null and on_hand < par_level),
           'expiringSoon', (select count(*) from v_expiring_soon where venue_id = any(v_rv)),
           'expired',      (select count(*) from v_expired where ingredient_id in (select i0.id from ingredients i0 where i0.venue_id = any(v_rv))),
           'lastCountAt',  (select max(finalized_at) from stock_counts where stock_counts.venue_id = any(v_rv) and venue_id = any(v_rv)),
           'openAlerts',   (select count(*) from manager_alerts where manager_alerts.venue_id = any(v_rv) and acknowledged_at is null))
    into v_stock;

  -- Staff activity today (activity, not a ranking: ordered by name) ---------
  with
  ord as (
    select o.placed_by_staff_id as staff_id, count(*) as n
      from orders o
     where o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided' and o.placed_by_staff_id is not null
     group by 1),
  bk as (
    select r.created_by_staff_id as staff_id, count(*) as n
      from reservations r
     where r.venue_id = any(v_rv) and r.kind = 'booking' and r.created_by_staff_id is not null
       and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
     group by 1),
  pay as (
    select p.recorded_by as staff_id, count(*) as n
      from payments p
     where p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
     group by 1),
  ids as (
    select staff_id from ord union select staff_id from bk union select staff_id from pay)
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId',         s.id,
           'name',            s.display_name,
           'role',            s.role,
           'ordersTaken',     coalesce(ord.n, 0),
           'bookingsCreated', coalesce(bk.n, 0),
           'paymentsTaken',   coalesce(pay.n, 0)
         ) order by s.display_name, s.id), '[]'::jsonb)
    into v_staff
    from ids
    join staff s on s.id = ids.staff_id
    left join ord on ord.staff_id = s.id
    left join bk  on bk.staff_id  = s.id
    left join pay on pay.staff_id = s.id;

  -- Exceptions today -------------------------------------------------------
  select jsonb_build_object(
           'discounts', (select jsonb_build_object('count', count(*), 'amountIqd', coalesce(sum(amount_iqd), 0)::bigint)
                           from tab_adjustments
                          where created_at >= v_b.ts_from and created_at < v_b.ts_to),
           'voids',     (select jsonb_build_object('count', count(*),
                                                   'amountIqd', coalesce(sum((after ->> 'line_total_iqd')::bigint), 0)::bigint)
                           from audit_log
                          where audit_log.venue_id = any(v_rv) and action = 'order_item.void'
                            and at >= v_b.ts_from and at < v_b.ts_to),
           'refunds',   (select jsonb_build_object('count', count(*), 'amountIqd', coalesce(sum(amount_iqd), 0)::bigint)
                           from refunds
                          where refunds.venue_id = any(v_rv) and created_at >= v_b.ts_from and created_at < v_b.ts_to),
           'waste',     (select jsonb_build_object('count', count(*),
                                                   'costIqd', coalesce(round(sum(-qty_delta * coalesce(unit_cost_iqd, 0))), 0)::bigint)
                           from stock_movements
                          where stock_movements.venue_id = any(v_rv) and movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
                            and qty_delta < 0
                            and at >= v_b.ts_from and at < v_b.ts_to))
    into v_exc;

  -- Day close --------------------------------------------------------------
  select * into v_day from day_sessions
   where day_sessions.venue_id = any(v_rv) and status in ('open','closing')
   order by opened_at desc limit 1;

  if found then
    select jsonb_build_object(
             'open',            true,
             'businessDate',    v_day.business_date,
             'openedAt',        v_day.opened_at,
             'openingFloatIqd', v_day.opening_float_iqd::bigint,
             -- 0292 (DB-17): the tab's own columns in WHERE, the joined rows'
             -- venue checks in their ON clauses.
             'blockingTabs',    coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id',          t.id,
                        'kind',        t.kind,
                        'label',       t.label,
                        'tableNumber', ct.table_number,
                        'guestName',   coalesce(r.guest_name, pr.full_name,
                                                case when le.booked_by_kind = 'guest'
                                                     then coalesce(lp.full_name, le.guest_name)
                                                     else le.guest_name end)
                      ) order by t.opened_at, t.id)
                 from tabs t
                 left join cafe_tables ct        on ct.id = t.table_id and ct.venue_id = any(v_rv)
                 left join reservations r        on r.id = t.reservation_id and r.venue_id = any(v_rv)
                 left join profiles pr           on pr.id = r.guest_id
                 left join lesson_enrolments le  on le.id = t.lesson_enrolment_id
                 left join profiles lp           on lp.id = le.guest_id
                where t.venue_id = any(v_rv) and t.day_session_id = v_day.id
                  and t.status in ('open','awaiting_payment')), '[]'::jsonb),
             'expectedCashIqd', (
               v_day.opening_float_iqd
               + coalesce((select sum(p.amount_iqd) from payments p
                            where p.venue_id = any(v_rv) and p.day_session_id = v_day.id and p.method = 'cash'), 0)
               - coalesce((select sum(rf.amount_iqd) from refunds rf
                             join payments p on p.id = rf.payment_id
                            where p.venue_id = any(v_rv) and rf.venue_id = any(v_rv)
                              and coalesce((select ts.day_session_id from till_shifts ts where ts.id = rf.till_shift_id), p.day_session_id) = v_day.id   -- 0281 (C-31, R71)
                              and p.method = 'cash'), 0))::bigint)
      into v_close;
  else
    v_close := jsonb_build_object(
      'open', false, 'businessDate', null, 'openedAt', null, 'openingFloatIqd', null,
      'blockingTabs', '[]'::jsonb, 'expectedCashIqd', null);
  end if;

  return jsonb_build_object(
    'businessDate',  v_today,
    'asOf',          v_now,
    'bookings',      v_bookings,
    'cafe',          v_cafe,
    'stock',         v_stock,
    'staffActivity', v_staff,
    'exceptions',    v_exc,
    'dayClose',      v_close);
end $ops_overview_0292$;

comment on function app.ops_overview() is
  '0068, 0219, 0281, 0292. The operator''s Today screen for the branches in scope: today''s bookings, café, stock, staff activity and exceptions, and the open day (blocking tabs, expected cash). 0281 (C-31, R71): expectedCashIqd dates a refund by the till shift it was made in, else by its payment''s day, as close_day does. 0292 (DB-17): blockingTabs lists every open or awaiting-payment tab of the open day (table, counter, shop and lesson tabs alike), each {id, kind, label, tableNumber, guestName}; a lesson tab is named by its place (R44).';

-- ===========================================================================
-- DB-16: app.report_drill (re-issued from
-- 20260926000219_reports_venue_scope.sql:410)
-- ===========================================================================

-- report_drill: re-issued from 20260917000102_report_drill_words.sql:20; report scope on 18 read(s)
-- 0292 (DB-16): the money drills add up to their headline (reports_figures)
-- again. revenue: + lesson money by lesson_money_figures' definitions (desk
-- payments on lesson tabs, their refunds as negative rows, online lesson rows
-- by succeeded_at, their refunds by refunded_at, handbacks outside the till by
-- when they were recorded), also tagged lessonRevenue, a figure of its own
-- (the owner's alone); cash and card: every payment of the branches (a tab
-- with no table counted, t.venue_id) less its refunds, each refund a negative
-- twin of its refunds row (scope-only drills leave the twin out, like the
-- cafeNet twin). Orders on tabs with no table are listed too (t.venue_id). No
-- guest identity on a lesson row (R42).
create or replace function app.report_drill(
  p_figure text,
  p_key    text,
  p_from   date,
  p_to     date
) returns jsonb
language plpgsql stable security definer set search_path = public as $report_drill_0292$
declare
  v_rv uuid[] := app.report_venues();
  v_b        record;
  v_tag      text;
  v_scope    record;
  v_key      record;
  v_court    uuid;
  v_item     uuid;
  v_staff    uuid;
  v_out      jsonb;
  v_figures  text[] := array['revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','discounts',
                             'refunds','voids','waste','noShows','bookings','orders','cancellations',
                             'lessonRevenue'];
begin
  perform app.reports_guard(false);
  select * into strict v_b from app.analytics_bounds(p_from, p_to);

  if p_figure is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_figure';
  end if;
  select * into v_scope from app.reports_parse_scope(p_figure);
  if v_scope.kind is null then
    if not (p_figure = any (v_figures)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
        detail = 'p_figure', hint = 'a figure key or court:<uuid> | item:<uuid> | staff:<uuid>';
    end if;
    v_tag := p_figure;
  end if;
  select * into v_key from app.reports_parse_scope(p_key);
  if p_key is not null and v_key.kind is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'p_key', hint = 'court:<uuid> | item:<uuid> | staff:<uuid> or null';
  end if;

  -- Financial figures are the owner's alone (spec R-roles, build plan §4).
  if v_tag in ('revenue','padelRevenue','cafeRevenue','cafeNet','cash','card','lessonRevenue') then
    perform app.reports_guard(true);
  end if;

  v_court := case when v_scope.kind = 'court' then v_scope.id when v_key.kind = 'court' then v_key.id end;
  v_item  := case when v_scope.kind = 'item'  then v_scope.id when v_key.kind = 'item'  then v_key.id end;
  v_staff := case when v_scope.kind = 'staff' then v_scope.id when v_key.kind = 'staff' then v_key.id end;

  with
  tx as (
    -- Bookings on their slot's day (every status the reports count).
    select r.id::text                                                  as id,
           r.start_at                                                  as at,
           'reservation'                                               as kind,
           c.name_en || ' · ' || coalesce(r.guest_name, pr.full_name, '') as label,
           coalesce(r.price_iqd, 0)::bigint                            as amount,
           r.created_by_staff_id                                       as staff_id,
           r.id::text                                                  as reference,
           r.court_id                                                  as court_id,
           null::uuid                                                  as item_id,
           jsonb_build_object('sub', 'booking', 'status', r.status,
                              'courtEn', c.name_en, 'courtAr', c.name_ar,
                              'guest', coalesce(r.guest_name, pr.full_name)) as detail,
           case
             when r.status in ('confirmed','arrived','completed') then array['bookings','revenue','padelRevenue']
             when r.status = 'no_show'   then array['noShows']
             when r.status = 'cancelled' then array['cancellations']
             else array[]::text[]
           end                                                         as tags
      from reservations r
      join courts c on c.id = r.court_id
      left join profiles pr on pr.id = r.guest_id
     where c.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.kind = 'booking'
       and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
    union all
    -- Settled tabs from the shared helper: the cafe part, gross of refunds.
    -- 0099: only the cafeRevenue figure lists these; revenue lists the net twin.
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_gross_iqd,
           coalesce((select p.recorded_by from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'settledTab', 'tabLabel', t.label, 'table', ct.table_number),
           array['cafeRevenue']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- The same tabs, net of their refunds: the cafeNet figure and, since 0099,
    -- the cafe part of revenue (so the drill rows add up to the headline).
    select s.tab_id::text, s.settled_at, 'tab',
           coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           s.cafe_net_iqd,
           coalesce((select p.recorded_by from payments p where p.venue_id = any(v_rv) and p.tab_id = s.tab_id
                      order by p.created_at desc limit 1), t.opened_by_staff_id),
           s.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'settledTab', 'tabLabel', t.label, 'table', ct.table_number),
           array['revenue','cafeNet']
      from app.cafe_settled_tabs(v_b.ts_from, v_b.ts_to) s
      join tabs t on t.id = s.tab_id
      left join cafe_tables ct on ct.id = t.table_id
    union all
    -- Payments by method. 0292 (DB-16): every tab of the branches, a tab with
    -- no table included (t.venue_id); a payment on a lesson tab is lesson
    -- revenue too.
    select p.id::text, p.created_at, 'payment',
           p.method::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           p.amount_iqd::bigint, p.recorded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'payment', 'method', p.method, 'tabLabel', t.label, 'table', ct.table_number),
           case when t.kind = 'lesson' then array[p.method::text, 'revenue', 'lessonRevenue']
                else array[p.method::text] end
      from payments p
      join tabs t on t.id = p.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where t.venue_id = any(v_rv) and p.venue_id = any(v_rv) and p.created_at >= v_b.ts_from and p.created_at < v_b.ts_to
    union all
    -- Refunds (money out), listed under refunds.
    select r.id::text, r.created_at, 'refund',
           'refund · ' || r.reason_code || ' · ' || p.method::text,
           r.amount_iqd::bigint, r.refunded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', r.reason_code, 'method', p.method),
           array['refunds']
      from refunds r
      join payments p on p.id = r.payment_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union all
    -- 0292 (DB-16): the same refunds as negative rows, netted off their
    -- method (cash, card) and, on a lesson tab, off lesson revenue. 'net' marks
    -- the twin, which a scope-only drill leaves out.
    select r.id::text, r.created_at, 'refund',
           'refund · ' || r.reason_code || ' · ' || p.method::text,
           -r.amount_iqd::bigint, r.refunded_by, p.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', r.reason_code, 'method', p.method),
           case when t.kind = 'lesson' then array[p.method::text, 'net', 'revenue', 'lessonRevenue']
                else array[p.method::text, 'net'] end
      from refunds r
      join payments p on p.id = r.payment_id
      join tabs t on t.id = p.tab_id
     where p.venue_id = any(v_rv) and r.venue_id = any(v_rv) and r.created_at >= v_b.ts_from and r.created_at < v_b.ts_to
    union all
    -- 0292 (DB-16): online lesson money (never cash or card), paid by
    -- succeeded_at, refunded as a negative row by refunded_at; sandbox rows
    -- count 0 and are not listed (CM-15). No guest identity (R42).
    select bp.id::text, bp.succeeded_at, 'payment',
           'lesson · online',
           bp.amount_iqd::bigint, null::uuid, bp.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'payment', 'method', 'online', 'tabLabel', 'Lesson'),
           array['revenue', 'lessonRevenue']
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.succeeded_at >= v_b.ts_from and bp.succeeded_at < v_b.ts_to
    union all
    select bp.id::text || ':refund', bp.refunded_at, 'refund',
           'refund · lesson · online',
           -bp.refund_amount_iqd::bigint, null::uuid, bp.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', bp.refund_reason, 'method', 'online'),
           array['revenue', 'lessonRevenue']
      from booking_payments bp
     where bp.purpose = 'lesson' and not bp.sandbox and bp.venue_id = any(v_rv)
       and bp.status = 'refunded'
       and bp.refunded_at >= v_b.ts_from and bp.refunded_at < v_b.ts_to
    union all
    -- 0292 (DB-16, DB-20): online lesson money handed back outside the till
    -- (R75), as a negative row by when it was recorded; a sandbox place left
    -- out.
    select 'lesson-event:' || ev.id::text, ev.at, 'refund',
           'refund · lesson · outside the till',
           -(ev.data ->> 'amount_iqd')::bigint, ev.actor_staff_id, ev.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'refund', 'reason', 'lesson_refund_outside', 'method', 'outside'),
           array['revenue', 'lessonRevenue']
      from lesson_events ev
     where ev.type = 'refunded' and ev.code = 'outside' and ev.venue_id = any(v_rv)
       and ev.at >= v_b.ts_from and ev.at < v_b.ts_to
       and not exists (select 1 from booking_payments bp
                        where bp.lesson_enrolment_id = ev.enrolment_id and bp.purpose = 'lesson' and bp.sandbox)
    union all
    -- Discounts / price overrides.
    select a.id::text, a.created_at, 'adjustment',
           a.kind::text || ' · ' || a.reason_code,
           a.amount_iqd::bigint, a.applied_by, a.tab_id::text, null::uuid,
           (select oi.menu_item_id from order_items oi where oi.id = a.order_item_id),
           jsonb_build_object('sub', 'discount', 'adjKind', a.kind, 'reason', a.reason_code),
           array['discounts']
      from tab_adjustments a
     where a.created_at >= v_b.ts_from and a.created_at < v_b.ts_to
    union all
    -- Voids, from the audit trail (the only timestamped record of a void).
    select l.id::text, l.at, 'adjustment',
           'void · ' || coalesce(l.reason_code, '') || ' · ' || coalesce(mi.name_en, ''),
           coalesce((l.after ->> 'line_total_iqd')::bigint, 0), l.actor_id, l.entity_id,
           null::uuid, mi.id,
           jsonb_build_object('sub', 'void', 'reason', l.reason_code, 'itemEn', mi.name_en, 'itemAr', mi.name_ar),
           array['voids']
      from audit_log l
      left join menu_items mi on mi.id::text = (l.after ->> 'menu_item_id')
     where mi.venue_id = any(v_rv) and l.venue_id = any(v_rv) and l.action = 'order_item.void'
       and l.at >= v_b.ts_from and l.at < v_b.ts_to
    union all
    -- Waste movements.
    select sm.id::text, sm.at, 'waste',
           i.name_en || ' · ' || coalesce(sm.reason_code, sm.movement_type::text)
             || ' · ' || (-sm.qty_delta)::text || ' ' || i.unit::text,
           coalesce(round(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0)), 0)::bigint,
           sm.staff_id, sm.id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'waste', 'movement', sm.movement_type, 'reason', sm.reason_code,
                              'ingredientEn', i.name_en, 'ingredientAr', i.name_ar,
                              'qty', -sm.qty_delta, 'unit', i.unit),
           array['waste']
      from stock_movements sm
      join ingredients i on i.id = sm.ingredient_id
     where i.venue_id = any(v_rv) and sm.venue_id = any(v_rv) and sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= v_b.ts_from and sm.at < v_b.ts_to
    union all
    -- Orders (non-voided), amount = live line total. 0292: a tab with no
    -- table included (t.venue_id), as reports_figures counts orders.
    select o.id::text, o.placed_at, 'tab',
           'order · ' || o.source::text || ' · ' || coalesce(t.label, 'Table ' || ct.table_number, 'Tab'),
           coalesce((select sum(oi.line_total_iqd) from order_items oi
                      where oi.order_id = o.id and not oi.voided), 0)::bigint,
           o.placed_by_staff_id, o.tab_id::text, null::uuid, null::uuid,
           jsonb_build_object('sub', 'order', 'source', o.source, 'tabLabel', t.label, 'table', ct.table_number),
           array['orders']
      from orders o
      join tabs t on t.id = o.tab_id
      left join cafe_tables ct on ct.id = t.table_id
     where t.venue_id = any(v_rv) and o.venue_id = any(v_rv) and o.placed_at >= v_b.ts_from and o.placed_at < v_b.ts_to
       and o.status <> 'voided'
    union all
    -- Settled lines, for the item scope only (net of discounts and refunds).
    select l.order_item_id::text, l.placed_at, 'tab',
           mi.name_en || ' × ' || l.qty::text,
           l.net_line_iqd, o.placed_by_staff_id, l.tab_id::text, null::uuid, l.menu_item_id,
           jsonb_build_object('sub', 'line', 'itemEn', mi.name_en, 'itemAr', mi.name_ar, 'qty', l.qty),
           array['lines']
      from app.analytics_sales_lines('settled', v_b.ts_from, v_b.ts_to, v_b.tz, v_b.start_hour) l
      join orders o on o.id = l.order_id
      join menu_items mi on mi.id = l.menu_item_id
     where mi.venue_id = any(v_rv) and o.venue_id = any(v_rv) and v_item is not null),
  picked as (
    select tx.*
      from tx
     where (v_tag is null or v_tag = any (tx.tags))
       and (v_court is null or tx.court_id = v_court)
       and (v_staff is null or tx.staff_id = v_staff)
       and (v_item  is null or tx.item_id  = v_item)
       -- Scope-only drills: a court shows its bookings, an item its lines
       -- (plus voids of it), a member their actions (not the duplicate lines,
       -- and not the net twin of a tab row or of a refund).
       and (v_tag is not null
            or (v_scope.kind = 'court' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags)
                and 'net' <> all (tx.tags))
            or (v_scope.kind = 'item'  and ('lines' = any (tx.tags) or 'voids' = any (tx.tags)))
            or (v_scope.kind = 'staff' and 'lines' <> all (tx.tags) and 'cafeNet' <> all (tx.tags)
                and 'net' <> all (tx.tags)))
       and (v_tag is null or 'lines' <> all (tx.tags))
     order by tx.at desc, tx.id desc
     limit 500)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        p.id,
           'at',        p.at,
           'kind',      p.kind,
           'label',     p.label,
           'amountIqd', p.amount,
           'staffId',   p.staff_id,
           'staffName', s.display_name,
           'reference', p.reference,
           'detail',    p.detail
         ) order by p.at desc, p.id desc), '[]'::jsonb)
    into v_out
    from picked p
    left join staff s on s.id = p.staff_id;

  return jsonb_build_object(
    'figure',       p_figure,
    'key',          p_key,
    'period',       jsonb_build_object('from', p_from, 'to', p_to),
    'transactions', v_out);
end $report_drill_0292$;

comment on function app.report_drill(text, text, date, date) is
  '0219, 0292. Manager or owner (reports_guard; the money figures revenue, padelRevenue, cafeRevenue, cafeNet, cash, card and lessonRevenue the owner''s alone): the transactions behind a report figure (or a court:, item: or staff: scope) for a business-day range over app.report_venues(), newest first, at most 500, each {id, at, kind, label, amountIqd, staffId, staffName, reference, detail}. 0292 (DB-16): revenue, cash and card add up to reports_figures (lesson money by app.lesson_money_figures'' definitions, tagged revenue and lessonRevenue: desk lesson payments, their refunds negative, online lesson rows by succeeded_at, their refunds negative by refunded_at, handbacks outside the till negative; every payment of the branches, a tab with no table included, each refund a negative twin under its method). A lesson row carries no guest identity (R42). FORBIDDEN, INVALID_RANGE, INVALID_ARGUMENT.';

revoke all on function app.report_drill(text, text, date, date) from public, anon;
grant execute on function app.report_drill(text, text, date, date) to authenticated;
