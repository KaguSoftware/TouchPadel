set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0281 lesson_money — coaching, lane Money (docs/design/coaching/money.md §5;
-- build contracts §1.1, §1.5, §1.7, §1.8, C-6, C-15, C-23, C-31, CM-1…CM-5,
-- R2, R5, R27, R28, R36, R37, R60, R62, R71, R75).
--
-- Where every dinar of a lesson lives (money.md §1): desk money is one fresh
-- kind 'lesson' tab per payment, inserted and settled in the same call
-- (lesson_settle); online money is a booking_payments row of purpose 'lesson'
-- (0284); what an enrolment owes, keeps and gets back is decided in one place,
-- the engine app.lesson_enrolment_money. In file order:
--
--   1. the arithmetic twins of @touch/core (iqd_split = splitEvenly, R2/R60;
--      lesson_coach_share; course_late_join_price; course_share_for);
--   2. the engine lesson_enrolment_money, lesson_fee_remaining (the till's
--      lesson line), lesson_collected (a session's kept money);
--   3. lesson_refund_start (R5/R28: the only coaching path that refunds online
--      lesson money; DB's cancel internals call it) and lesson_money_open (R37:
--      close_branch, 0280);
--   4. the till: compute_tab_totals (dropped and created with lesson_iqd),
--      settle_tab (stamps it), the no-goods wall (LESSON_TAB_NO_GOODS) and
--      cafe_settled_tabs (no lesson tab is café money);
--   5. app.refund (R36): the coach mutex and REFUND_EXCEEDS_DUE for lesson tabs;
--   6. C-31 / R27 / R71: a refund counts on the day it is made — close_day,
--      v_day_close_summary, ops_overview, day_close_shop, and till_shift_list's
--      cross-day line; day_sessions' expected columns become signed;
--   7. the desk RPCs lesson_settle and lesson_refunds_due (§1.7), and R75's
--      lesson_blocked_refund_record (a manager records online money handed back
--      outside the till when Qi cannot take a second refund).
--
-- Every internal function is security definer set search_path = public and
-- revoked from public, anon and authenticated. Lesson events are written
-- through DB's app.lesson_event (0283; plpgsql binds it when the statement
-- first runs, and no lesson row exists before 0283). Nothing here queues a
-- push: the lesson_events_notify trigger (0283) maps no key to settled or
-- refunded (R40).

-- ===========================================================================
-- 1. The arithmetic twins (money.md §5.1; packages/core/src/coaching/statement.ts)
-- ===========================================================================

-- R2/R60. Twin of @touch/core splitEvenly (packages/core/src/money/split.ts):
-- floor(t/n) each, plus 1 on the first t % n parts. Not app.split_evenly (the
-- till's Split bill RPC, 0015:768): no overload of that name.
create or replace function app.iqd_split(p_total bigint, p_n int) returns bigint[]
language plpgsql immutable security definer set search_path = public as $iqd_split_0281$
begin
  if p_total is null or p_n is null then
    return null;
  end if;
  if p_total < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_total';
  end if;
  if p_n < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_n';
  end if;
  return array(select p_total / p_n + case when i <= p_total % p_n then 1 else 0 end
                 from generate_series(1, p_n) as g(i)
                order by i);
end $iqd_split_0281$;

comment on function app.iqd_split(bigint, int) is
  '0281. Internal (R2, R60). The even split of p_total IQD into p_n parts: floor(p_total / p_n) each, the first p_total % p_n parts one more (largest remainder, Σ = p_total, parts differ by at most 1). Twin of @touch/core splitEvenly (and match_shares(p) = iqd_split(p, 4)). NULL in, NULL out; INVALID_ARGUMENT detail p_total (< 0) or p_n (< 1).';

revoke all on function app.iqd_split(bigint, int) from public, anon, authenticated;

-- C-6, CD-5. Twin of core lessonCoachShare: bigint division floors a
-- non-negative value.
create or replace function app.lesson_coach_share(p_collected bigint, p_court_share bigint, p_share_bp int)
returns bigint
language plpgsql immutable security definer set search_path = public as $lesson_coach_share_0281$
begin
  if p_collected is null or p_court_share is null or p_share_bp is null then
    return null;
  end if;
  if p_share_bp < 0 or p_share_bp > 10000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_share_bp';
  end if;
  if p_collected < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_collected';
  end if;
  if p_court_share < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_court_share';
  end if;
  return (p_share_bp::bigint * greatest(p_collected - p_court_share, 0)) / 10000;
end $lesson_coach_share_0281$;

comment on function app.lesson_coach_share(bigint, bigint, int) is
  '0281. Internal (C-6, CD-5). What a coach earns on one session: floor(p_share_bp × max(0, p_collected − p_court_share) / 10000). Twin of @touch/core lessonCoachShare. NULL in, NULL out; INVALID_ARGUMENT detail p_share_bp (outside 0..10000), p_collected or p_court_share (< 0).';

revoke all on function app.lesson_coach_share(bigint, bigint, int) from public, anon, authenticated;

-- C-15. Twin of core courseLateJoinPrice: the course price split evenly over
-- its sessions, summed from session p_first_session_no on.
create or replace function app.course_late_join_price(p_course_price bigint, p_sessions_count int,
                                                      p_first_session_no int)
returns bigint
language plpgsql immutable security definer set search_path = public as $course_late_join_price_0281$
begin
  if p_course_price is null or p_sessions_count is null or p_first_session_no is null then
    return null;
  end if;
  if p_first_session_no < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_first_session_no';
  end if;
  return coalesce((select sum(u.s)
                     from unnest(app.iqd_split(p_course_price, p_sessions_count)) with ordinality as u(s, i)
                    where u.i >= p_first_session_no), 0)::bigint;
end $course_late_join_price_0281$;

comment on function app.course_late_join_price(bigint, int, int) is
  '0281. Internal (C-15). The price of a course joined from session p_first_session_no (1-based): Σ iqd_split(p_course_price, p_sessions_count) from that session on; 1 is the whole price, a number past the last session 0. A late joiner pays per session exactly what a full member pays (money.md §5.1). Twin of @touch/core courseLateJoinPrice. NULL in, NULL out; INVALID_ARGUMENT detail p_first_session_no (< 1), and iqd_split''s.';

revoke all on function app.course_late_join_price(bigint, int, int) from public, anon, authenticated;

-- One session's share of one course enrolment: the enrolment's own price split
-- over the sessions it covers (so Σ shares = price_iqd always).
create or replace function app.course_share_for(p_enrolment_id uuid, p_session_no int) returns bigint
language sql stable security definer set search_path = public as $course_share_for_0281$
  select case
           when e.course_id is null then null
           when p_session_no < e.first_session_no
             or p_session_no >= e.first_session_no + e.sessions_covered then 0
           else (app.iqd_split(e.price_iqd, e.sessions_covered))[p_session_no - e.first_session_no + 1]
         end
    from lesson_enrolments e
   where e.id = p_enrolment_id
$course_share_for_0281$;

comment on function app.course_share_for(uuid, int) is
  '0281. Internal (CM-4). A course enrolment''s share of session p_session_no: iqd_split(price_iqd, sessions_covered) at the session''s place among the sessions it covers; 0 outside them; NULL for a private or group enrolment or an unknown id.';

revoke all on function app.course_share_for(uuid, int) from public, anon, authenticated;

-- ===========================================================================
-- 2. The engine (money.md §5.2, §5.3; C-9, C-23, CM-2, CM-3, CM-15, R62, R75)
-- ===========================================================================
-- What an enrolment owes, what the venue keeps and what goes back, decided in
-- one place. Every other lesson figure reads it: the till's lesson line, the
-- desk and guest reads (0283), lesson_settle, lesson_refund_start,
-- lesson_refunds_due, app.refund's lesson bound, the statements and reports
-- (0287, 0288). Stable, no locks, NULL for an unknown id; no name, phone or
-- guest id (readers add identity under their own rules).
--
-- Covered sessions S_e: the lesson (private, group) or the course's sessions
-- first_session_no .. first_session_no + sessions_covered - 1. A session
-- COUNTS (the venue may keep its share) by the table of money.md §5.2; T_e is
-- the counting sessions; due = Σ share over T_e. "Cancelled" below means a
-- session with status cancelled or expired.
--
--   held, expired                       never
--   booked                              not cancelled
--   cancelled guest_late, private/group not cancelled, or ended by the guest's
--                                       own cancel (cancel_reason guest_cancel)
--   cancelled guest_late, course (C-23) not cancelled, and begun or starting
--                                       inside the window, or N_e (the guest's
--                                       next covered session at the cancel)
--   cancelled course_cancelled          not cancelled
--   cancelled otherwise                 not cancelled and begun before the cancel
--
-- Figures: paid_gross = desk_paid + online_paid; net = paid_gross − desk
-- refunds − online refunds (promised back counts as gone) − refunded_outside
-- (R75: money handed back outside the till when Qi could not take a second
-- refund); kept = least(net, due); real_kept = kept less sandbox money (CM-15);
-- owed = due − paid_gross while payable (CM-2: gross), else 0; refund_due =
-- net − due when positive, online first, then desk, the rest blocked (online
-- money owed back on a row that had its one refund, CM-5); alloc = real_kept
-- split evenly over T_e. if_cancelled: for a held or booked enrolment, the
-- figures as if it were cancelled now as guest_free and as guest_late
-- (refund_iqd = the online money that would go back, kept_iqd, refund_due_iqd,
-- kept_sessions, refund_sessions); DB's reads pick the one their rule applies.
create or replace function app.lesson_enrolment_money(p_enrolment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_enrolment_money_0281$
declare
  v_e         lesson_enrolments%rowtype;
  v_kind      text;
  v_window    interval;
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

  -- W: the branch's cancellation window, read live (R75), 12 hours by default
  -- as cancel_reservation reads it (0210).
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
    else
      v_status := 'cancelled';
      v_ck := v_mode;
      v_at := now();
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
                            and (l.start_at < v_at + v_window or l.id = v_next)
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
end $lesson_enrolment_money_0281$;

comment on function app.lesson_enrolment_money(uuid) is
  '0281. Internal (money.md §5.3; C-9, C-23, CM-2, CM-3, CM-15, R62, R75). The money engine of one enrolment: {enrolment_id, kind, status, cancel_kind, payment_mode, price_iqd, due_iqd, payable, final, desk_paid_iqd, desk_refunded_iqd, online_paid_iqd, online_refunded_iqd, online_refundable_iqd, refunded_outside_iqd, paid_gross_iqd, net_iqd, kept_iqd, real_kept_iqd, owed_iqd, refund_due_iqd, refund_due_online_iqd, refund_due_desk_iqd, refund_blocked_iqd, sandbox, if_cancelled {guest_free, guest_late: {refund_iqd, kept_iqd, refund_due_iqd, kept_sessions, refund_sessions}} | null, sessions [{lesson_id, session_no, start_at, status, share_iqd, counts, alloc_iqd}]}. Identities: kept + refund_due = net; refund_due = refund_due_online + refund_due_desk + refund_blocked; kept ≤ due; owed ≤ due; Σ alloc = real_kept. Owed uses gross money (CM-2), kept and refunds net money. Stable, no locks; NULL for an unknown id; no name, phone or guest id. Key list: COACHING_SHAPES.lesson_enrolment_money (packages/core/src/coaching/shapes.ts).';

revoke all on function app.lesson_enrolment_money(uuid) from public, anon, authenticated;
-- The service role reads it directly (the shapes and money suites); no client.
grant execute on function app.lesson_enrolment_money(uuid) to service_role;

-- ===========================================================================
-- The till's lesson line and a session's kept money (money.md §5.4)
-- ===========================================================================

-- What the enrolment still owes at the desk with one tab left out (the
-- court_fee_remaining shape): the left-out tab is only ever the live tab being
-- totalled (compute_tab_totals runs before settle_tab stamps it), which the
-- engine never counts; a settled lesson tab of the enrolment is added back.
create or replace function app.lesson_fee_remaining(p_enrolment_id uuid, p_exclude_tab_id uuid default null)
returns bigint
language plpgsql stable security definer set search_path = public as $lesson_fee_remaining_0281$
declare
  v_m jsonb := app.lesson_enrolment_money(p_enrolment_id);
begin
  if v_m is null or not coalesce((v_m->>'payable')::boolean, false) then
    return 0;
  end if;
  return greatest((v_m->>'due_iqd')::bigint - (v_m->>'paid_gross_iqd')::bigint
                  + coalesce((select t.lesson_iqd
                                from tabs t
                               where t.id = p_exclude_tab_id
                                 and t.lesson_enrolment_id = p_enrolment_id
                                 and t.status = 'settled'
                                 and t.merged_into_tab_id is null), 0), 0);
end $lesson_fee_remaining_0281$;

comment on function app.lesson_fee_remaining(uuid, uuid) is
  '0281. Internal (§1.5). What an enrolment still owes at the desk, tab p_exclude_tab_id left out: 0 unless payable, else max(0, due − paid_gross (+ that tab''s lesson_iqd when it is a settled lesson tab of the enrolment)). compute_tab_totals'' lesson line; 0 for an unknown id.';

revoke all on function app.lesson_fee_remaining(uuid, uuid) from public, anon, authenticated;

-- The money one session collected: Σ alloc over every enrolment covering it,
-- whatever its status (a late canceller's kept money counts). The statements
-- (0287) and reports (0288) read it per lesson.
create or replace function app.lesson_collected(p_lesson_id uuid) returns bigint
language plpgsql stable security definer set search_path = public as $lesson_collected_0281$
declare
  v_l   lessons%rowtype;
  v_eid uuid;
  v_m   jsonb;
  v_sum bigint := 0;
begin
  select * into v_l from lessons where id = p_lesson_id;
  if not found then
    return 0;
  end if;
  for v_eid in
    select x.id
      from lesson_enrolments x
     where (v_l.course_id is null and x.lesson_id = v_l.id)
        or (v_l.course_id is not null and x.course_id = v_l.course_id
            and v_l.session_no >= x.first_session_no
            and v_l.session_no < x.first_session_no + x.sessions_covered)
     order by x.id
  loop
    v_m := app.lesson_enrolment_money(v_eid);
    v_sum := v_sum + coalesce((select sum((s->>'alloc_iqd')::bigint)
                                 from jsonb_array_elements(v_m->'sessions') as s
                                where s->>'lesson_id' = v_l.id::text), 0);
  end loop;
  return v_sum;
end $lesson_collected_0281$;

comment on function app.lesson_collected(uuid) is
  '0281. Internal (money.md §5.4, §7.1). The money one lesson session collected: Σ alloc_iqd of that session over every enrolment covering it, whatever its status (real money kept, sandbox excluded). 0 for an unknown id. collected_L of the coach statements.';

revoke all on function app.lesson_collected(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Online refunds of lesson money (R5, R28; money.md §5.5)
-- ===========================================================================
-- The only coaching path that refunds online lesson money (CM-5). Called, after
-- their status writes, by DB's enrolment_cancel_internal,
-- lesson_cancel_internal and course_cancel_internal (0283; for every enrolment
-- with an applied online row, live or not) under the caller's coach mutex, and
-- by the reconciler's lesson loop (0284). Takes no coach or court lock: it
-- locks only the enrolment's own payment rows. The amount is always the
-- engine's refund_due_online_iqd (C-23 for a course leave, R62); the reason is
-- always derived (R28): p_reason exists for the signature, NULL from every
-- caller; a value outside the refund and cancel vocabularies is
-- INVALID_ARGUMENT, any other value is ignored. Idempotent: a second call finds
-- nothing due (the first refund already counts as gone) and returns 0. A
-- created|pending payment is left alone: its success is refunded by the apply,
-- the enrolment being no longer live. Returns the refunds started (0 or 1).
create or replace function app.lesson_refund_start(p_enrolment_id uuid, p_reason text) returns int
language plpgsql security definer set search_path = public as $lesson_refund_start_0281$
declare
  v_e       lesson_enrolments%rowtype;
  v_m       jsonb;
  v_amount  bigint;
  v_row     booking_payments%rowtype;
  v_reason  text;
  v_cr      text;
  v_coach   uuid;
  v_uid     uuid := auth.uid();
  v_actor   text := 'system';
  v_profile uuid;
  v_staff   uuid;
begin
  if p_reason is not null and p_reason not in (
       'guest_cancel', 'staff_cancel', 'coach_cancel', 'under_filled', 'slot_lost', 'venue_offline',
       'amount_mismatch', 'duplicate_success', 'account_deleted', 'staff_refund',
       'coach_retired', 'payment_expired') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;

  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if not found then
    return 0;
  end if;
  perform set_config('app.venue_id', v_e.venue_id::text, true);

  -- 1. The enrolment's applied, still-succeeded rows, id order.
  perform 1
     from booking_payments bp
    where bp.purpose = 'lesson' and bp.lesson_enrolment_id = v_e.id and bp.status = 'succeeded'
    order by bp.id
      for update;

  -- 2. What goes back online now (R28: always the engine's figure).
  v_m := app.lesson_enrolment_money(v_e.id);
  v_amount := coalesce((v_m->>'refund_due_online_iqd')::bigint, 0);
  if v_amount <= 0 then
    return 0;
  end if;

  -- The one refundable row (an enrolment has at most one applied row: a second
  -- success is refunded duplicate_success by the apply).
  select * into v_row
    from booking_payments bp
   where bp.purpose = 'lesson' and bp.lesson_enrolment_id = v_e.id and bp.status = 'succeeded'
   order by bp.created_at, bp.id
   limit 1;
  if not found then
    return 0;
  end if;
  v_amount := least(v_amount, v_row.amount_iqd::bigint);

  -- 3. The reason, derived (R28; money.md §5.5).
  if v_e.status = 'expired' then
    v_reason := 'slot_lost';
  elsif v_e.cancel_kind = 'guest_free' then
    v_reason := 'guest_cancel';
  elsif v_e.cancel_kind = 'coach' then
    v_reason := 'coach_cancel';
  elsif v_e.cancel_kind = 'staff' then
    v_reason := 'staff_cancel';
  elsif v_e.cancel_kind = 'under_filled' then
    v_reason := 'under_filled';
  elsif v_e.cancel_kind = 'account_deleted' then
    v_reason := 'account_deleted';
  elsif v_e.cancel_kind = 'course_cancelled' then
    select c.cancel_reason into v_cr from courses c where c.id = v_e.course_id;
    v_reason := case v_cr
                  when 'coach_cancel'    then 'coach_cancel'
                  when 'coach_retired'   then 'coach_cancel'
                  when 'staff_cancel'    then 'staff_cancel'
                  when 'under_filled'    then 'under_filled'
                  when 'account_deleted' then 'account_deleted'
                  else 'staff_cancel' end;
  else
    -- guest_late (or, from the reconciler, an enrolment still live): a covered
    -- session the venue cancelled since takes its own reason; otherwise a late
    -- course leave refunds its outside-window shares as guest_cancel (C-23).
    select l.cancel_reason into v_cr
      from lessons l
     where ((v_e.lesson_id is not null and l.id = v_e.lesson_id)
            or (v_e.course_id is not null and l.course_id = v_e.course_id
                and l.session_no >= v_e.first_session_no
                and l.session_no < v_e.first_session_no + v_e.sessions_covered))
       and l.status = 'cancelled'
       and l.cancel_reason is distinct from 'guest_cancel'
       and (v_e.cancelled_at is null or l.cancelled_at >= v_e.cancelled_at)
     order by l.cancelled_at desc, l.id
     limit 1;
    v_reason := case v_cr
                  when 'coach_cancel'    then 'coach_cancel'
                  when 'coach_retired'   then 'coach_cancel'
                  when 'staff_cancel'    then 'staff_cancel'
                  when 'under_filled'    then 'under_filled'
                  when 'account_deleted' then 'account_deleted'
                  when 'payment_expired' then 'slot_lost'
                  else null end;
    v_reason := coalesce(v_reason, case when v_e.cancel_kind = 'guest_late' then 'guest_cancel'
                                        else 'staff_cancel' end);
  end if;

  -- Who the event names: the caller as the cancel saw them (R28 "actor as the
  -- caller's"), else the system (the sweep, the reconciler).
  select coalesce(l.coach_id, c.coach_id) into v_coach
    from lesson_enrolments x
    left join lessons l on l.id = x.lesson_id
    left join courses c on c.id = x.course_id
   where x.id = v_e.id;
  if v_uid is not null then
    if exists (select 1 from coaches ch where ch.id = v_coach and ch.profile_id = v_uid) then
      v_actor := 'coach';
      v_profile := v_uid;
    elsif v_e.guest_id is not distinct from v_uid then
      v_actor := 'guest';
      v_profile := v_uid;
    elsif exists (select 1 from staff s where s.id = v_uid) then
      v_actor := 'staff';
      v_staff := v_uid;
    end if;
  end if;

  -- 4. One refund on the row (partial when less than the row; 0242:165-207).
  perform app.deposit_begin_refund(v_row.id, v_reason,
                                   case when v_amount = v_row.amount_iqd then null else v_amount end,
                                   'lesson');
  perform app.deposit_nudge();
  perform app.lesson_event(v_e.venue_id, v_e.lesson_id, v_e.course_id, v_e.id, 'refunded', v_actor,
                           v_profile, v_staff, v_reason,
                           jsonb_build_object('payment_id', v_row.id, 'amount_iqd', v_amount));
  return 1;
end $lesson_refund_start_0281$;

comment on function app.lesson_refund_start(uuid, text) is
  '0281. Internal (R5, R28; money.md §5.5). Starts the online refund an enrolment is owed now: refund_due_online_iqd of app.lesson_enrolment_money (C-23''s course leave included) on its one applied succeeded booking_payments row (app.deposit_begin_refund, partial when less than the row), then app.deposit_nudge and a lesson_events row refunded (code the reason, data {payment_id, amount_iqd}). The reason is derived from the enrolment''s status and cancel_kind and the lesson''s or course''s cancel_reason (account_deleted stays account_deleted; expired is slot_lost); p_reason is for the signature (NULL), INVALID_ARGUMENT outside the refund and cancel vocabularies. Locks only the enrolment''s payment rows. Idempotent; returns 0 or 1. Called by DB''s cancel internals (0283) after their status writes, and by the reconciler (0284).';

revoke all on function app.lesson_refund_start(uuid, text) from public, anon, authenticated;

-- R37. True while a branch still has coaching money to settle; close_branch
-- (0280) refuses BRANCH_HAS_BOOKINGS detail coaching_money while it is. Three
-- tests, cheapest first: a draft or approved coach statement; a statement
-- lesson (money.md §7.1: over, and completed, still scheduled, or a late guest
-- cancel the venue kept money for) in a branch-local month with no non-void
-- statement for its coach and branch; an enrolment that took desk money or had
-- an online refund and still has desk money due back or online money blocked.
create or replace function app.lesson_money_open(p_venue_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $lesson_money_open_0281$
declare
  v_tz text;
begin
  if p_venue_id is null then
    return false;
  end if;

  if exists (select 1 from coach_statements s
              where s.venue_id = p_venue_id and s.status in ('draft', 'approved')) then
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
                and (exists (select 1 from tabs t where t.lesson_enrolment_id = x.id and t.status = 'settled')
                     or exists (select 1 from booking_payments bp
                                 where bp.lesson_enrolment_id = x.id and bp.purpose = 'lesson'
                                   and bp.status in ('refund_pending', 'refund_failed', 'refunded')))
                and exists (select 1
                              from (select app.lesson_enrolment_money(x.id) as m) mm
                             where (mm.m->>'refund_due_desk_iqd')::bigint > 0
                                or (mm.m->>'refund_blocked_iqd')::bigint > 0)) then
    return true;
  end if;

  return false;
end $lesson_money_open_0281$;

comment on function app.lesson_money_open(uuid) is
  '0281. Internal (R37). True while branch p_venue_id still has coaching money to settle: a coach statement in draft or approved; a statement lesson (over, and completed, still scheduled, or a late guest cancel that kept money) in a branch-local month with no non-void statement for its coach; or an enrolment with lesson money still due back at the till or blocked on Qi (refund_due_desk_iqd, refund_blocked_iqd). close_branch (0280) refuses BRANCH_HAS_BOOKINGS detail coaching_money while it is.';

revoke all on function app.lesson_money_open(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 4. The till: the lesson line (money.md §5.6–§5.9)
-- ===========================================================================

-- compute_tab_totals: re-issued from 20260929000262_match_desk_money.sql:413,
-- DROPPED and created: its result gains a sixth column, lesson_iqd, appended
-- last (the 0053:53-54 precedent). The lesson line is what the enrolment of a
-- kind 'lesson' tab still owes (lesson_fee_remaining, this tab left out),
-- outside subtotal_iqd (no discount applies) and outside the tax base (CD-4),
-- exactly as the court line. Every caller reads the result by column name or
-- into a record (money.md §5.6 lists them); no view or SQL-standard body
-- depends on it, so the drop needs no cascade. A non-lesson tab answers
-- lesson_iqd = 0 and its 0262 figures unchanged. The drop forgets the grants:
-- they are re-issued below.
drop function if exists app.compute_tab_totals(uuid);
create function app.compute_tab_totals(p_tab_id uuid)
returns table (
  subtotal_iqd bigint,
  discount_iqd bigint,
  tax_iqd      bigint,
  court_iqd    bigint,
  total_iqd    bigint,
  lesson_iqd   bigint   -- 0281
)
language plpgsql stable security definer set search_path = public as $compute_tab_totals_0281$
declare
  v_subtotal  bigint;
  v_disc_line bigint;
  v_disc_tab  bigint;
  v_discount  bigint;
  v_tab_alloc bigint;
  v_tax       bigint;
  v_court     bigint;
  v_inclusive boolean;
  v_lesson    bigint;   -- 0281
begin
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_line
    from tab_adjustments a
    join order_items oi on oi.id = a.order_item_id
    join orders o on o.id = oi.order_id
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and o.tab_id = p_tab_id
     and o.status <> 'voided'
     and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_disc_tab
    from tab_adjustments a
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount')
     and a.order_item_id is null;

  v_discount := least(v_disc_line + v_disc_tab, v_subtotal);

  v_tab_alloc := greatest(least(v_disc_tab, v_discount - least(v_disc_line, v_discount)), 0);

  -- 0106: the court fee still OWED on the booking this tab is charged to (D1,
  -- D3). 'pending' holds, cancelled, expired and no-show bookings owe nothing.
  -- 0262 (R2): a tab with court_cap_iqd bills at most its cap.
  select case when t.court_cap_iqd is null then app.court_fee_remaining(t.reservation_id, t.id)
              else least(t.court_cap_iqd, app.court_fee_remaining(t.reservation_id, t.id)) end
    into v_court
    from tabs t
   where t.id = p_tab_id
     and t.reservation_id is not null;
  v_court := coalesce(v_court, 0);

  -- 0281 (CM-1): a kind 'lesson' tab bills what its enrolment still owes,
  -- this tab left out (lesson_fee_remaining); every other tab 0.
  select case when t.kind = 'lesson' then app.lesson_fee_remaining(t.lesson_enrolment_id, t.id) else 0 end
    into v_lesson
    from tabs t
   where t.id = p_tab_id;
  v_lesson := coalesce(v_lesson, 0);

  with grp as (
    select mc.tax_group_id, sum(oi.line_total_iqd) as grp_subtotal
      from order_items oi
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
     group by mc.tax_group_id
  ),
  line_disc as (
    select mc.tax_group_id, sum(a.amount_iqd) as amt
      from tab_adjustments a
      join order_items oi     on oi.id = a.order_item_id and not oi.voided
      join orders o           on o.id  = oi.order_id
      join menu_items mi      on mi.id = oi.menu_item_id
      join menu_categories mc on mc.id = mi.category_id
     where a.tab_id = p_tab_id
       and a.kind in ('discount_percent','discount_amount')
       and o.tab_id = p_tab_id
       and o.status <> 'voided'
     group by mc.tax_group_id
  ),
  base as (
    select g.tax_group_id,
           greatest(g.grp_subtotal - coalesce(ld.amt, 0), 0) as after_line
      from grp g
      left join line_disc ld on ld.tax_group_id = g.tax_group_id
  ),
  alloc as (
    select b.tax_group_id,
           greatest(
             b.after_line
               - round((v_tab_alloc::numeric * b.after_line)
                       / nullif(sum(b.after_line) over (), 0)),
             0) as taxable
      from base b
  )
  select coalesce(sum(
           case when coalesce((select vs.tax_inclusive from venue_settings vs
                                 where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id)), false)
                then round((a.taxable::numeric * tg.rate_bp) / (10000.0 + tg.rate_bp))
                else round((a.taxable::numeric * tg.rate_bp) / 10000.0)
           end), 0)::bigint
    into v_tax
    from alloc a
    join tax_groups tg on tg.id = a.tax_group_id
   where tg.is_active;

  select vs.tax_inclusive into v_inclusive from venue_settings vs
   where vs.venue_id = (select t.venue_id from tabs t where t.id = p_tab_id);

  subtotal_iqd := v_subtotal;
  discount_iqd := v_discount;
  tax_iqd      := v_tax;
  court_iqd    := v_court;
  total_iqd    := greatest(
    v_subtotal - v_discount
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0) + v_court + v_lesson;   -- 0281: the lesson line, like the court line
  lesson_iqd   := v_lesson;
  return next;
end $compute_tab_totals_0281$;

revoke all on function app.compute_tab_totals(uuid) from public, anon, authenticated;
grant execute on function app.compute_tab_totals(uuid) to service_role;

comment on function app.compute_tab_totals(uuid) is
  '0053, 0106, 0211, 0262: a tab''s subtotal, discount, tax, court line and total. The court line is what the booking still owes (court_fee_remaining, this tab excluded), capped by tabs.court_cap_iqd when set (R2: a seat settle''s tab, or a normal bill closed by match_link_payment). Court time is outside subtotal_iqd (so percentage discounts apply to goods only) and outside the tax base (tax is per item group, L454-455). 0281 (CM-1): a sixth column, lesson_iqd: on a kind lesson tab, what its enrolment still owes (lesson_fee_remaining, this tab left out), outside subtotal_iqd and the tax base like the court line, and in total_iqd; 0 on every other tab.';

-- settle_tab: re-issued from 20260927000244_shop_desk_access.sql:312. The stamp
-- and the answer carry lesson_iqd. assert_tab_kind_role already admits cashier,
-- court_desk, manager and owner for any kind but shop, so a lesson tab needs no
-- role change. settle_zero_tab and cancel_tab are not re-issued: a lesson tab is
-- never live after a commit (CM-1).
create or replace function app.settle_tab(
  p_tab_id             uuid,
  p_method             payment_method,
  p_tendered_iqd       bigint default null,
  p_amount_iqd         bigint default null,
  p_idempotency_key    text   default null,
  p_device_id          text   default null,
  p_expected_total_iqd bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $settle_tab_0281$
declare
  v_venue uuid;
  v_tab      tabs%rowtype;
  v_totals   record;
  v_paid     bigint;
  v_due      bigint;
  v_amount   bigint;
  v_change   bigint;
  v_payment  payments%rowtype;
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides the day, the rows written and who may act.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  if p_idempotency_key is not null then
    select * into v_payment from payments where idempotency_key = p_idempotency_key;
    if found then
      if v_payment.recorded_by is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another payment';
      end if;
      select * into v_tab from tabs where id = v_payment.tab_id;
      return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
        'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
    end if;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  select * into v_totals from app.compute_tab_totals(p_tab_id);

  -- 0106 (D4): the bill moved under the clerk (a line added, a booking
  -- extended). Refused BEFORE the stamp, so the row is left exactly as it was.
  if p_expected_total_iqd is not null and p_expected_total_iqd <> v_totals.total_iqd then
    raise exception 'TOTAL_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', p_expected_total_iqd, v_totals.total_iqd),
      hint = 'the bill changed since it was shown; read it again before taking payment';
  end if;

  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         court_iqd    = v_totals.court_iqd,
         total_iqd    = v_totals.total_iqd,
         lesson_iqd   = v_totals.lesson_iqd   -- 0281
   where id = p_tab_id
   returning * into v_tab;

  v_paid := app.tab_net_paid(p_tab_id);
  v_due := v_tab.total_iqd - v_paid;
  if v_due <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001',
      hint = 'nothing is owed on this tab; close it with app.settle_zero_tab';
  end if;

  v_amount := coalesce(p_amount_iqd, v_due);
  if v_amount < 1 or v_amount > v_due then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001',
      detail = format('due %s, got %s', v_due, v_amount);
  end if;

  if p_method = 'cash' then
    if p_tendered_iqd is null or p_tendered_iqd < v_amount then
      raise exception 'TENDER_SHORT' using errcode = 'P0001';
    end if;
    v_change := p_tendered_iqd - v_amount;
  else
    if p_tendered_iqd is not null then
      raise exception 'TENDER_CARD' using errcode = 'P0001',
        hint = 'tendered/change are cash-only fields';
    end if;
    v_change := null;
  end if;

  begin
    insert into payments (tab_id, day_session_id, method, amount_iqd, tendered_iqd,
                          change_iqd, recorded_by, device_id, idempotency_key)
    values (p_tab_id, v_tab.day_session_id, p_method, v_amount, p_tendered_iqd,
            v_change, auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_payment;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_payment from payments where idempotency_key = p_idempotency_key;
      if found then
        if v_payment.recorded_by is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another payment';
        end if;
        return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
          'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
      end if;
    end if;
    raise;
  end;

  if v_paid + v_amount >= v_tab.total_iqd then
    update tabs set status = 'settled', settled_at = now()
     where id = p_tab_id returning * into v_tab;
    perform app.write_audit('tab.settle', 'tabs', v_tab.id::text,
                            null, to_jsonb(v_tab), null, null, p_device_id);
  else
    update tabs set status = 'awaiting_payment'
     where id = p_tab_id returning * into v_tab;
  end if;

  return jsonb_build_object('duplicate', false, 'payment_id', v_payment.id,
    'tab_id', v_tab.id, 'status', v_tab.status,
    'subtotal_iqd', v_tab.subtotal_iqd, 'discount_iqd', v_tab.discount_iqd,
    'tax_iqd', v_tab.tax_iqd, 'court_iqd', v_tab.court_iqd, 'lesson_iqd', v_tab.lesson_iqd,   -- 0281
    'total_iqd', v_tab.total_iqd,
    'amount_iqd', v_amount, 'change_iqd', v_change,
    'remaining_iqd', greatest(v_tab.total_iqd - v_paid - v_amount, 0));
end $settle_tab_0281$;

comment on function app.settle_tab(uuid, payment_method, bigint, bigint, text, text, bigint) is
  '0106 (0053). Records one payment against a tab (cashier, court_desk, manager, owner); part payments leave it awaiting_payment. p_expected_total_iqd, when given, must equal the recomputed total or TOTAL_CHANGED is raised before anything is written. 0281 (CM-1): the stamp and the answer carry lesson_iqd (compute_tab_totals'' lesson line; 0 on every tab but a kind lesson one).';

-- The no-goods wall: trg_match_booking_no_cafe, re-issued from
-- 20260929000262_match_desk_money.sql:1413 (CM-1). A lesson tab carries the
-- lesson line only: every path a goods line or an adjustment could take onto
-- it (till_add_items, merge_tabs, place_floor_order, apply_discount, a
-- promotion, a queued replay) writes orders or tab_adjustments, which this
-- refuses with LESSON_TAB_NO_GOODS. The match wall (0262) is verbatim. The two
-- triggers (orders_match_booking_no_cafe, tab_adjustments_match_booking_no_cafe)
-- are unchanged: create or replace keeps the binding. One primary-key probe of
-- tabs per row.
create or replace function app.trg_match_booking_no_cafe() returns trigger
language plpgsql security definer set search_path = public as $trg_match_booking_no_cafe_0281$
declare
  v_kind text;
  v_res  uuid;
begin
  if new.tab_id is not null then
    select t.kind, t.reservation_id into v_kind, v_res from tabs t where t.id = new.tab_id;
    -- 0281 (CM-1): a lesson tab carries the lesson line only.
    if v_kind = 'lesson' then
      raise exception 'LESSON_TAB_NO_GOODS' using errcode = 'P0001',
        hint = 'a lesson is paid on its own bill; café items go on a café bill';
    end if;
    if v_res is not null and exists (select 1 from matches m where m.reservation_id = v_res) then
      raise exception 'MATCH_BOOKING_NO_CAFE' using errcode = 'P0001',
        hint = 'a match player''s café order goes on a café bill of its own';
    end if;
  end if;
  return new;
end $trg_match_booking_no_cafe_0281$;

comment on function app.trg_match_booking_no_cafe() is
  '0262 (R20, DF-16), 0281 (CM-1). Trigger on orders and tab_adjustments (insert, or a move of tab_id): refuses a row on a kind lesson tab with LESSON_TAB_NO_GOODS (a lesson tab carries the lesson line only), and a row on the tab of an open match''s booking with MATCH_BOOKING_NO_CAFE (the booking''s tabs carry court money only; café orders go on their own bill and a share is forgiven only by a write-off).';

revoke all on function app.trg_match_booking_no_cafe() from public, anon, authenticated;

-- cafe_settled_tabs: re-issued from 20260926000219_reports_venue_scope.sql:31
-- with one predicate: a lesson tab is lesson money, never café money. Without
-- it a settled lesson tab would count its whole total as cafe_gross_iqd and
-- every refund on it as a café refund in reports_figures, report_revenue, the
-- panels and the café analytics. analytics_sales_lines reads order lines, and a
-- lesson tab has none.
create or replace function app.cafe_settled_tabs(
  p_ts_from timestamptz default null,
  p_ts_to   timestamptz default null
) returns table (
  tab_id          uuid,
  settled_at      timestamptz,
  reservation_id  uuid,
  subtotal_iqd    bigint,
  discount_iqd    bigint,
  tax_iqd         bigint,
  court_iqd       bigint,
  total_iqd       bigint,
  goods_iqd       bigint,
  cafe_gross_iqd  bigint,
  refunds_iqd     bigint,
  cafe_net_iqd    bigint
) language sql stable security definer set search_path = public as $cafe_settled_tabs_0281$
  select t.id,
         t.settled_at,
         t.reservation_id,
         coalesce(t.subtotal_iqd, 0)::bigint,
         coalesce(t.discount_iqd, 0)::bigint,
         coalesce(t.tax_iqd, 0)::bigint,
         coalesce(t.court_iqd, 0)::bigint,
         coalesce(t.total_iqd, 0)::bigint,
         (coalesce(t.subtotal_iqd, 0) - coalesce(t.discount_iqd, 0))::bigint             as goods_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0))::bigint                   as cafe_gross_iqd,
         coalesce(r.refunds_iqd, 0)::bigint                                              as refunds_iqd,
         (coalesce(t.total_iqd, 0) - coalesce(t.court_iqd, 0) - coalesce(r.refunds_iqd, 0))::bigint as cafe_net_iqd
    from tabs t
    left join lateral (
      select sum(rf.amount_iqd) as refunds_iqd
        from refunds rf
        join payments p on p.id = rf.payment_id
       where p.venue_id = any((select app.report_venues())::uuid[]) and rf.venue_id = any((select app.report_venues())::uuid[]) and p.tab_id = t.id
    ) r on true
   where t.venue_id = any((select app.report_venues())::uuid[]) and t.status = 'settled'
     and t.kind <> 'lesson'   -- 0281 (CM-1): lesson money is never café money
     and t.merged_into_tab_id is null
     and t.settled_at is not null
     and (p_ts_from is null or t.settled_at >= p_ts_from)
     and (p_ts_to   is null or t.settled_at <  p_ts_to)
$cafe_settled_tabs_0281$;

comment on function app.cafe_settled_tabs(timestamptz, timestamptz) is
  '0095, 0219, 0281. Internal (report scope): one row per settled, unmerged tab of the branches in scope settled in [p_ts_from, p_ts_to), with its stamped figures, goods_iqd (subtotal less discount), cafe_gross_iqd (total less the court line), the refunds on its payments and cafe_net_iqd. 0281 (CM-1): kind lesson tabs are left out (lesson money is reported on its own line, 0288).';

-- ===========================================================================
-- 5. Desk refunds of lesson money (R36; money.md §5.12)
-- ===========================================================================
-- refund: re-issued from 20260926000217_cross_venue_guards.sql:34. For a
-- payment on a kind 'lesson' tab: the coach mutex before the tab lock (the
-- order stays day_sessions -> coach_advisory -> tabs -> payments -> till_shifts
-- -> refunds), and at most what the engine says is due back at the till
-- (refund_due_desk_iqd), unless the reason is lesson_goodwill (a manager's
-- refund beyond what is due, PIN as always). Two tills, or a queued
-- payment.refund replayed after another manager paid, then never refund the
-- same due twice: the coach mutex orders them and the second reads the first.
-- Every other tab kind: unchanged (the lesson branch is skipped at run time).
-- Signature, grants and PIN_GATED_RPCS membership unchanged.
create or replace function app.refund(
  p_payment_id      uuid,
  p_amount_iqd      bigint,
  p_pin             text,
  p_reason_code     text,
  p_items           jsonb default null,
  p_device_id       text  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $refund_0281$
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
  select t.kind, t.lesson_enrolment_id into v_kind, v_enrol
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
end $refund_0281$;

comment on function app.refund(uuid, bigint, text, text, jsonb, text, text) is
  'till_shifts (0139, 0120, 0044, 0115). Refunds part or all of one payment (manager, owner) behind a manager-PIN grant, inside an open day (NO_OPEN_DAY otherwise); naming order lines restocks them. The refunds row records p_device_id, and app.stamp_till_shift gives it the shift open at that station. p_idempotency_key: a replay of the same key by the same caller echoes the first result with duplicate:true (app.claim_replay). REFUND_EXCEEDS_PAYMENT (detail = paid/refunded), PAYMENT_NOT_FOUND, ITEM_NOT_ON_TAB, INVALID_QTY, INVALID_AMOUNT. 0281 (R36): on a kind lesson tab the coach mutex is taken before the tab, and a refund above the enrolment''s refund_due_desk_iqd is REFUND_EXCEEDS_DUE (detail due <n>) unless p_reason_code is lesson_goodwill. Reason codes on lesson money: lesson_refund (what is due), lesson_goodwill (beyond it).';

-- ===========================================================================
-- 6. A refund is counted on the day it is made (C-31, R27, R71; money.md §5.13)
-- ===========================================================================
-- Every refund (café, court, lesson) is dated by the till shift it was made in,
-- else (no shift) by its payment's day:
--   coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id), p.day_session_id)
-- in close_day, v_day_close_summary, ops_overview's expected cash and
-- day_close_shop (day_close_online learns it in 0288). Payments stay on their
-- own day. Closed days keep their stored figures; the view's derived
-- refunds_iqd of a day closed before 0281 is re-dated by the rule.
--
-- day_sessions.cash_expected_iqd and card_expected_iqd become iqd_signed (as
-- till_shifts.cash_expected_iqd already is, 0205): a refund made today of an
-- earlier day's payment can now exceed today's float plus takings, and the
-- unsigned domain would refuse the close itself (23514). iqd and iqd_signed are
-- both bigint and iqd_signed has no constraint, so the type change rewrites
-- nothing (a catalog change under a brief ACCESS EXCLUSIVE on a table of one row
-- a day per branch). v_day_close_summary reads both columns, so it is dropped
-- first and created again (same columns, same names, same grant).
drop view if exists v_day_close_summary;

alter table day_sessions
  alter column cash_expected_iqd type iqd_signed,
  alter column card_expected_iqd type iqd_signed;

comment on column day_sessions.cash_expected_iqd is
  '0020, 0281. Stamped at close_day: opening float + the day''s cash payments - the cash refunds made that day (C-31: a refund counts on the day of the till shift it was made in, else its payment''s day). Signed since 0281: a refund of an earlier day''s payment can exceed the day''s float and takings.';
comment on column day_sessions.card_expected_iqd is
  '0020, 0281. Stamped at close_day: the day''s card payments - the card refunds made that day (C-31). Signed since 0281.';

-- v_day_close_summary: re-created from 20260917000106_desk_payment.sql:1061
-- (create or replace view there), the ref lateral dated by the refund's till
-- shift. It is security_invoker: its readers are the manager and the owner at
-- day close, who read till_shifts (till_shifts_mgmt_read); any other reader
-- would see a refund dated by its payment's day.
create view v_day_close_summary with (security_invoker = on) as
select d.id as day_session_id,
       d.business_date, d.status, d.opened_at, d.closed_at,
       d.opening_float_iqd,
       d.cash_expected_iqd, d.cash_counted_iqd, d.cash_variance_iqd,
       d.card_expected_iqd, d.card_terminal_batch_iqd,
       pay.cash_payments_iqd, pay.card_payments_iqd,
       ref.refunds_iqd, ref.refund_count,
       adj.discounts_iqd, adj.adjustment_count, adj.authorizer_names,
       vv.voided_lines_iqd, vv.voided_line_count,
       w.waste_cost_iqd,
       d.notes,
       desk.desk_cash_iqd, desk.desk_card_iqd
  from day_sessions d
  left join lateral (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0) as cash_payments_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0) as card_payments_iqd
      from payments p where p.day_session_id = d.id
  ) pay on true
  left join lateral (
    select coalesce(sum(r.amount_iqd), 0) as refunds_iqd, count(r.id) as refund_count
      from refunds r join payments p on p.id = r.payment_id
     where coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id), p.day_session_id) = d.id   -- 0281 (C-31, R27)
  ) ref on true
  left join lateral (
    select coalesce(sum(a.amount_iqd), 0) as discounts_iqd,
           count(a.id)                    as adjustment_count,
           array_remove(array_agg(distinct s.display_name), null) as authorizer_names
      from tab_adjustments a
      join tabs t on t.id = a.tab_id
      left join staff s on s.id = a.authorized_by
     where t.day_session_id = d.id
  ) adj on true
  left join lateral (
    select coalesce(sum(oi.line_total_iqd), 0) as voided_lines_iqd,
           count(oi.id)                        as voided_line_count
      from order_items oi
      join orders o on o.id = oi.order_id
      join tabs t on t.id = o.tab_id
     where t.day_session_id = d.id and oi.voided
  ) vv on true
  left join lateral (
    select coalesce(round(sum(-sm.qty_delta * coalesce(sm.unit_cost_iqd, 0)))::bigint, 0) as waste_cost_iqd
      from stock_movements sm
     where sm.movement_type in ('waste_spill','waste_spoilage','void_after_send','expired_writeoff')
       and sm.qty_delta < 0
       and sm.at >= d.opened_at
       and sm.at <= coalesce(d.closed_at, now())
  ) w on true
  left join lateral (
    select coalesce(sum(p.amount_iqd) filter (where p.method = 'cash'), 0) as desk_cash_iqd,
           coalesce(sum(p.amount_iqd) filter (where p.method = 'card'), 0) as desk_card_iqd
      from payments p
      join staff s on s.id = p.recorded_by
     where p.day_session_id = d.id and s.role = 'court_desk'
  ) desk on true;

grant select on v_day_close_summary to authenticated;

comment on view v_day_close_summary is
  '0020, 0106, 0281. One row per business day: the stamped close figures, the day''s cash and card payments, the refunds made that day (C-31: dated by the till shift they were made in, else by their payment''s day), discounts, voided lines, waste, and the court desk''s own cash and card.';

-- close_day: re-issued from 20260926000216_day_per_venue.sql:114. The two refund
-- sums are dated by the refund's till shift (C-31); the payment sums stay on
-- p.day_session_id. The till_shifts join is a plain read beside the existing
-- till_shifts ... for update, so no new lock.
create or replace function app.close_day(
  p_cash_counted_iqd bigint,
  p_card_batch_iqd   bigint default null,
  p_notes            text default null,
  p_device_id        text default null,
  p_venue_id         uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $close_day_0281$
declare
  v_day           day_sessions%rowtype;
  v_before        jsonb;
  v_cash_in       bigint;
  v_cash_refunds  bigint;
  v_card_in       bigint;
  v_card_refunds  bigint;
  v_cash_expected bigint;
  v_card_expected bigint;
  v_shift         till_shifts%rowtype;
  v_shifts_closed int := 0;
  v_venue         uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0216: one branch: the argument, else the station on the request or the
  -- caller's only membership.
  v_venue := coalesce(p_venue_id, app.current_venue(p_device_id));
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cash_counted_iqd is null or p_cash_counted_iqd < 0 then
    raise exception 'INVALID_COUNT' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  select * into v_day from day_sessions
   where venue_id = v_venue
     and status in ('open','closing')
   order by opened_at desc limit 1
   for update;
  if not found then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- Guard 1: every tab settled or voided before the day closes.
  if exists (select 1 from tabs
              where day_session_id = v_day.id and status in ('open','awaiting_payment')) then
    raise exception 'DAY_OPEN_TABS' using errcode = 'P0001',
      hint = 'settle or void every open tab before closing the day';
  end if;

  -- Guard 2: no till may still hold queued (unreplayed) writes. Queue depth is
  -- reported by app.heartbeat (0021); a device silent since before the day
  -- opened does not block.
  if exists (select 1 from device_heartbeats
              where venue_id = v_venue
                and queue_depth > 0 and last_seen_at >= v_day.opened_at) then
    raise exception 'DAY_UNSYNCED' using errcode = 'P0001',
      hint = 'a till still has queued offline writes; let it finish replaying';
  end if;

  -- till_shifts: no shift outlives its day. Each one still open ends here,
  -- in this transaction, with its figures stamped and no count.
  perform 1 from till_shifts where day_session_id = v_day.id and closed_at is null for update;
  for v_shift in
    select * from till_shifts
     where day_session_id = v_day.id and closed_at is null
     order by opened_at
  loop
    perform app.close_till_shift_internal(v_shift, null, null, 'day_close', null, p_device_id);
    v_shifts_closed := v_shifts_closed + 1;
  end loop;

  v_before := to_jsonb(v_day);

  select coalesce(sum(p.amount_iqd), 0) into v_cash_in
    from payments p where p.day_session_id = v_day.id and p.method = 'cash';
  select coalesce(sum(r.amount_iqd), 0) into v_cash_refunds
    from refunds r join payments p on p.id = r.payment_id
   where coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id), p.day_session_id) = v_day.id   -- 0281 (C-31, R27)
     and p.method = 'cash';
  select coalesce(sum(p.amount_iqd), 0) into v_card_in
    from payments p where p.day_session_id = v_day.id and p.method = 'card';
  select coalesce(sum(r.amount_iqd), 0) into v_card_refunds
    from refunds r join payments p on p.id = r.payment_id
   where coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id), p.day_session_id) = v_day.id   -- 0281 (C-31, R27)
     and p.method = 'card';

  v_cash_expected := v_day.opening_float_iqd + v_cash_in - v_cash_refunds;
  v_card_expected := v_card_in - v_card_refunds;

  update day_sessions
     set status                  = 'closed',
         closed_at               = now(),
         closed_by               = auth.uid(),
         cash_expected_iqd       = v_cash_expected,
         cash_counted_iqd        = p_cash_counted_iqd,
         cash_variance_iqd       = p_cash_counted_iqd - v_cash_expected,
         card_expected_iqd       = v_card_expected,
         card_terminal_batch_iqd = p_card_batch_iqd,
         notes                   = coalesce(p_notes, notes)
   where id = v_day.id
   returning * into v_day;

  perform app.write_audit('day.close', 'day_sessions', v_day.id::text,
                          v_before, to_jsonb(v_day), null, null, p_device_id);

  return jsonb_build_object(
    'day_session_id',    v_day.id,
    'business_date',     v_day.business_date,
    'cash_expected_iqd', v_day.cash_expected_iqd,
    'cash_counted_iqd',  v_day.cash_counted_iqd,
    'cash_variance_iqd', v_day.cash_variance_iqd,
    'card_expected_iqd', v_day.card_expected_iqd,
    'card_terminal_batch_iqd', v_day.card_terminal_batch_iqd,
    'shifts_closed_with_day', v_shifts_closed);
end $close_day_0281$;

comment on function app.close_day(bigint, bigint, text, text, uuid) is
  '0020/0205, 0216. Manager or owner at the branch: close that branch''s open day (p_venue_id, else the station on the request / the caller''s only membership). Refuses with DAY_OPEN_TABS or DAY_UNSYNCED (that branch''s tills only); ends every open till shift of the day; stamps expected and counted cash and card. 0281 (C-31, R27): a refund counts on the day it was made: the day of the till shift it was made in, else its payment''s day; payments stay on their own day. Expected cash and card may be negative (a refund of an earlier day''s payment).';

-- ops_overview: re-issued from 20260926000219_reports_venue_scope.sql:1254
-- (R71): the live expected-cash tile dates refunds as close_day does.
create or replace function app.ops_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $ops_overview_0281$
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
             'blockingTabs',    coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id',          t.id,
                        'label',       t.label,
                        'tableNumber', ct.table_number,
                        'guestName',   coalesce(r.guest_name, pr.full_name)
                      ) order by t.opened_at, t.id)
                 from tabs t
                 left join cafe_tables ct  on ct.id = t.table_id
                 left join reservations r  on r.id = t.reservation_id
                 left join profiles pr     on pr.id = r.guest_id
                where r.venue_id = any(v_rv) and ct.venue_id = any(v_rv) and t.venue_id = any(v_rv) and t.day_session_id = v_day.id
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
end $ops_overview_0281$;

comment on function app.ops_overview() is
  '0068, 0219, 0281. The operator''s Today screen for the branches in scope: today''s bookings, café, stock, staff activity and exceptions, and the open day (blocking tabs, expected cash). 0281 (C-31, R71): expectedCashIqd dates a refund by the till shift it was made in, else by its payment''s day, as close_day does.';

-- day_close_shop: re-issued from 20260927000246_shop_products.sql:450 (R71): the
-- shop's refunds are dated as close_day dates them.
create or replace function app.day_close_shop(p_day_session_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $day_close_shop_0281$
declare
  v_day      day_sessions%rowtype;
  v_by       jsonb;
  v_refunds  bigint;
  v_sales    bigint;
  v_settled  int;
  v_open     jsonb;
  v_shifts   jsonb;
begin
  if not app.is_staff('shop_staff','manager','owner') then
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
  if not app.is_staff_at(v_day.venue_id, 'shop_staff','manager','owner') then
    raise exception 'DAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Money taken for shop sales that day, by method (change already netted
  -- out of amount_iqd), and what was refunded of it.
  select coalesce(jsonb_object_agg(x.method, x.iqd), '{}'::jsonb), coalesce(sum(x.iqd), 0)
    into v_by, v_sales
    from (select p.method::text as method, sum(p.amount_iqd) as iqd
            from payments p join tabs t on t.id = p.tab_id
           where t.kind = 'shop' and p.day_session_id = v_day.id
           group by p.method) x;

  select coalesce(sum(r.amount_iqd), 0) into v_refunds
    from refunds r
    join payments p on p.id = r.payment_id
    join tabs t on t.id = p.tab_id
   where t.kind = 'shop'
     and coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id), p.day_session_id) = v_day.id;   -- 0281 (C-31, R71)

  select count(*) into v_settled
    from tabs t
   where t.kind = 'shop' and t.day_session_id = v_day.id and t.status = 'settled';

  -- A sale left open blocks close_day (0216): list them so the shop can
  -- finish or cancel each one.
  select coalesce(jsonb_agg(jsonb_build_object('tab_id', t.id, 'label', t.label,
                                               'opened_at', t.opened_at, 'total_iqd', t.total_iqd)
                            order by t.opened_at), '[]'::jsonb)
    into v_open
    from tabs t
   where t.kind = 'shop' and t.day_session_id = v_day.id
     and t.status in ('open', 'awaiting_payment');

  -- The shop PCs' drawers (stations with mode shop): their till shifts.
  select coalesce(jsonb_agg(jsonb_build_object(
           'till_shift_id',     s.id,
           'station_id',        s.station_id,
           'staff_name',        st.display_name,
           'opened_at',         s.opened_at,
           'closed_at',         s.closed_at,
           'opening_float_iqd', s.opening_float_iqd,
           'cash_expected_iqd', s.cash_expected_iqd,
           'cash_counted_iqd',  s.cash_counted_iqd,
           'cash_variance_iqd', s.cash_variance_iqd,
           'card_payments_iqd', s.card_payments_iqd)
         order by s.opened_at), '[]'::jsonb)
    into v_shifts
    from till_shifts s
    join stations sn on sn.id = s.station_id and sn.venue_id = s.venue_id
    join staff st on st.id = s.staff_id
   where s.day_session_id = v_day.id and sn.mode = 'shop';

  return jsonb_build_object(
    'day_session_id', v_day.id,
    'business_date',  v_day.business_date,
    'sales_iqd',      v_sales,
    'by_method',      v_by,
    'refunds_iqd',    v_refunds,
    'net_iqd',        v_sales - v_refunds,
    'settled_sales',  v_settled,
    'open_sales',     v_open,
    'shifts',         v_shifts);
end $day_close_shop_0281$;

comment on function app.day_close_shop(uuid) is
  '0246 (Touch Shop own desk). The shop assistant, manager or owner at the day''s venue: the day close''s Shop block for p_day_session_id (default the branch''s open day, else its latest): {day_session_id, business_date, sales_iqd, by_method {cash, card, …}, refunds_iqd, net_iqd, settled_sales, open_sales [{tab_id, label, opened_at, total_iqd}] (these block close_day), shifts [{till_shift_id, station_id, staff_name, opened_at, closed_at, opening_float_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd}] (the till shifts of stations with mode shop)}. Shop sales are tabs of kind shop. FORBIDDEN, DAY_NOT_FOUND (also another branch''s). 0281 (C-31, R71): refunds_iqd counts the shop refunds made that day (the day of the till shift they were made in, else their payment''s day); sales stay on their payment''s day.';

-- till_shift_list: re-issued from 20260926000205_till_shifts.sql:901 so its
-- cross-day line keeps meaning what it says (TI6, V10). Before 0281 close_day
-- and v_day_close_summary dated every refund by its payment's day, and
-- cross_day carried every refund made on another day than its payment's. Now a
-- refund made in a till shift is dated by that shift's day in both, so only a
-- refund made with no shift (dated by its payment's day there, by its time
-- here) still crosses days: cross_day counts those alone, and TI6 (shifts +
-- outside = the summary + earlier_days - later) and TI7 still hold. The
-- operator's day close shows the line as "refunds made today for earlier days'
-- payments, which close_day's expected cash leaves out" (dayCloseLogic.ts),
-- which stays true.
create or replace function app.till_shift_list(
  p_from       date default null,
  p_to         date default null,
  p_station_id text default null,
  p_staff_id   uuid default null,
  p_venue_id   uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $till_shift_list_0281$
declare
  v_venue   uuid;
  v_from    date;
  v_to      date;
  v_shifts  jsonb;
  v_outside jsonb;
  v_cross   jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_from is null and p_to is null then
    -- The open day, else the latest.
    select d.business_date into v_from
      from day_sessions d
     where d.venue_id = v_venue
     order by (d.status = 'open') desc, d.opened_at desc
     limit 1;
    v_to := v_from;
  else
    v_from := coalesce(p_from, p_to);
    v_to := coalesce(p_to, p_from);
    if v_from > v_to or v_to - v_from + 1 > 62 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'range';
    end if;
  end if;

  with days as (
    select d.id, d.business_date, d.opened_at, d.closed_at
      from day_sessions d
     where d.venue_id = v_venue
       and d.business_date between v_from and v_to
  ),
  -- Every refund that can touch these days, with the day it was made on.
  made as (
    select r.id, r.amount_iqd, r.device_id, r.till_shift_id, p.method,
           p.day_session_id as paid_day,
           coalesce(s.day_session_id,
                    (select d2.id
                       from day_sessions d2
                      where d2.venue_id = r.venue_id
                        and d2.opened_at <= r.created_at
                        and (d2.closed_at is null or r.created_at < d2.closed_at)
                      order by d2.opened_at desc
                      limit 1)) as made_day
      from refunds r
      join payments p on p.id = r.payment_id
      left join till_shifts s on s.id = r.till_shift_id
     where r.venue_id = v_venue
       and (p.day_session_id in (select id from days)
            or r.created_at >= (select min(opened_at) from days))
  ),
  shift_rows as (
    select s.*, dd.business_date,
           case when s.closed_at is null then app.till_shift_figures(s.id) end as live
      from till_shifts s
      join days dd on dd.id = s.day_session_id
     where (p_station_id is null or s.station_id = p_station_id)
       and (p_staff_id is null or s.staff_id = p_staff_id)
  ),
  shifts_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',                      s.id,
             'day_session_id',          s.day_session_id,
             'business_date',           s.business_date,
             'station_id',              s.station_id,
             'staff_id',                s.staff_id,
             'staff_name',              st.display_name,
             'opened_at',               s.opened_at,
             'closed_at',               s.closed_at,
             'closed_via',              s.closed_via,
             'closed_by_name',          cb.display_name,
             'authorized_by_name',      au.display_name,
             'opening_float_iqd',       s.opening_float_iqd,
             'handover_difference_iqd', s.handover_difference_iqd,
             'cash_payments_iqd',       coalesce(s.cash_payments_iqd, (s.live->>'cash_payments_iqd')::bigint),
             'cash_refunds_iqd',        coalesce(s.cash_refunds_iqd,  (s.live->>'cash_refunds_iqd')::bigint),
             'cash_expected_iqd',       coalesce(s.cash_expected_iqd, (s.live->>'cash_expected_iqd')::bigint),
             'cash_counted_iqd',        s.cash_counted_iqd,
             'cash_variance_iqd',       s.cash_variance_iqd,
             'card_payments_iqd',       coalesce(s.card_payments_iqd, (s.live->>'card_payments_iqd')::bigint),
             'card_refunds_iqd',        coalesce(s.card_refunds_iqd,  (s.live->>'card_refunds_iqd')::bigint),
             'payment_count',           coalesce(s.payment_count,     (s.live->>'payment_count')::int),
             'refund_count',            coalesce(s.refund_count,      (s.live->>'refund_count')::int),
             'drawer_open_count',       coalesce(s.drawer_open_count, (s.live->>'drawer_open_count')::int),
             'open_note',               s.open_note,
             'close_note',              s.close_note)
             order by s.opened_at, s.id), '[]'::jsonb) as j
      from shift_rows s
      join staff st on st.id = s.staff_id
      left join staff cb on cb.id = s.closed_by
      left join staff au on au.id = s.authorized_by
  ),
  -- Money with no shift, per day and station (a null station is a write
  -- that named no device). Station-filtered, never staff-filtered: nobody's
  -- shift holds it.
  outside_rows as (
    select u.day_id, u.station_id,
           sum(u.cash_in)::bigint  as cash_payments_iqd,
           sum(u.cash_out)::bigint as cash_refunds_iqd,
           sum(u.card_in)::bigint  as card_payments_iqd,
           sum(u.card_out)::bigint as card_refunds_iqd,
           sum(u.pay_n)::int       as payment_count,
           sum(u.ref_n)::int       as refund_count
      from (
        select p.day_session_id as day_id, p.device_id as station_id,
               case when p.method = 'cash' then p.amount_iqd else 0 end as cash_in,
               0::bigint as cash_out,
               case when p.method = 'card' then p.amount_iqd else 0 end as card_in,
               0::bigint as card_out,
               1 as pay_n, 0 as ref_n
          from payments p
         where p.till_shift_id is null
           and p.venue_id = v_venue
           and p.day_session_id in (select id from days)
           and (p_station_id is null or p.device_id = p_station_id)
        union all
        select m.made_day, m.device_id,
               0::bigint,
               case when m.method = 'cash' then m.amount_iqd else 0 end,
               0::bigint,
               case when m.method = 'card' then m.amount_iqd else 0 end,
               0, 1
          from made m
         where m.till_shift_id is null
           and m.made_day in (select id from days)
           and (p_station_id is null or m.device_id = p_station_id)
      ) u
     group by u.day_id, u.station_id
  ),
  outside_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'day_session_id',    o.day_id,
             'business_date',     d.business_date,
             'station_id',        o.station_id,
             'cash_payments_iqd', o.cash_payments_iqd,
             'cash_refunds_iqd',  o.cash_refunds_iqd,
             'card_payments_iqd', o.card_payments_iqd,
             'card_refunds_iqd',  o.card_refunds_iqd,
             'payment_count',     o.payment_count,
             'refund_count',      o.refund_count)
             order by d.business_date, o.station_id nulls first), '[]'::jsonb) as j
      from outside_rows o
      join days d on d.id = o.day_id
  ),
  cross_j as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'day_session_id',                d.id,
             'business_date',                 d.business_date,
             'earlier_days_cash_refunds_iqd', coalesce((select sum(m.amount_iqd) from made m
                                                         where m.made_day = d.id and m.paid_day <> d.id
                                                           and m.till_shift_id is null   -- 0281 (C-31)
                                                           and m.method = 'cash'), 0),
             'earlier_days_card_refunds_iqd', coalesce((select sum(m.amount_iqd) from made m
                                                         where m.made_day = d.id and m.paid_day <> d.id
                                                           and m.till_shift_id is null   -- 0281 (C-31)
                                                           and m.method = 'card'), 0),
             'later_cash_refunds_iqd',        coalesce((select sum(m.amount_iqd) from made m
                                                         where m.paid_day = d.id
                                                           and m.till_shift_id is null   -- 0281 (C-31)
                                                           and m.made_day is distinct from d.id
                                                           and m.method = 'cash'), 0),
             'later_card_refunds_iqd',        coalesce((select sum(m.amount_iqd) from made m
                                                         where m.paid_day = d.id
                                                           and m.till_shift_id is null   -- 0281 (C-31)
                                                           and m.made_day is distinct from d.id
                                                           and m.method = 'card'), 0))
             order by d.business_date), '[]'::jsonb) as j
      from days d
  )
  select shifts_j.j, outside_j.j, cross_j.j
    into v_shifts, v_outside, v_cross
    from shifts_j, outside_j, cross_j;

  return jsonb_build_object('from', v_from, 'to', v_to,
                            'shifts', v_shifts, 'outside', v_outside, 'cross_day', v_cross);
end $till_shift_list_0281$;

comment on function app.till_shift_list(date, date, text, uuid, uuid) is
  'till_shifts (§2.9.4, V10). Manager or owner at the venue: {from, to, shifts:[{id, day_session_id, business_date, station_id, staff_id, staff_name, opened_at, closed_at, closed_via, closed_by_name, authorized_by_name, opening_float_iqd, handover_difference_iqd, cash_payments_iqd, cash_refunds_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count, drawer_open_count, open_note, close_note}], outside:[{day_session_id, business_date, station_id, cash_payments_iqd, cash_refunds_iqd, card_payments_iqd, card_refunds_iqd, payment_count, refund_count}], cross_day:[{day_session_id, business_date, earlier_days_cash_refunds_iqd, earlier_days_card_refunds_iqd, later_cash_refunds_iqd, later_card_refunds_iqd}]} over the business days p_from..p_to (no dates: the open day, else the latest; at most 62 days). A refund belongs to the day it was made. FORBIDDEN, INVALID_ARGUMENT (hint range), VENUE_REQUIRED. 0281 (C-31): close_day and v_day_close_summary date a refund made in a till shift by that shift''s day, so cross_day counts only refunds made with no shift (still dated by their payment''s day there) on another day than their payment''s; TI6 and TI7 hold as before.';

-- ===========================================================================
-- 7. The desk RPCs (§1.7; money.md §5.10, §5.11; R75)
-- ===========================================================================

-- lesson_settle (CM-1, money.md §5.10): one fresh kind 'lesson' tab at the
-- enrolment's branch and open day, settled in the same call for what the
-- enrolment owes now. Modelled on match_seat_settle (0262:542). Cashier,
-- court_desk, manager, owner (capability takeLessonPayment); not shop_staff.
-- Online only (CD-6): no queued mutation type. Lock order: day_sessions
-- (share) -> coach_advisory -> tabs -> payments (+ till_shifts share, the
-- stamp trigger).
create or replace function app.lesson_settle(
  p_enrolment_id      uuid,
  p_method            payment_method,
  p_expected_owed_iqd bigint,
  p_tendered_iqd      bigint default null,
  p_idempotency_key   text default null,
  p_device_id         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $lesson_settle_0281$
declare
  v_e          lesson_enrolments%rowtype;
  v_coach      uuid;
  v_day        uuid;
  v_replay     jsonb;
  v_m          jsonb;
  v_owed       bigint;
  v_tab        tabs%rowtype;
  v_totals     record;
  v_settle     jsonb;
  v_payment    uuid;
  v_result     jsonb;
  v_constraint text;
begin
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_enrolment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;
  if p_method is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_method';
  end if;
  if p_expected_owed_iqd is null or p_expected_owed_iqd < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_expected_owed_iqd';
  end if;
  -- A money write is always keyed (the signature keeps its default, as C16
  -- made match_seat_settle's).
  if p_idempotency_key is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if not found or not (v_e.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_e.venue_id, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_e.venue_id::text, true);

  -- 0049: claim after the guards, before the day lock and any write.
  v_replay := app.claim_replay(p_idempotency_key, 'lesson_settle');
  if v_replay is not null then
    return v_replay;
  end if;

  v_day := app.current_open_day_locked(v_e.venue_id);
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  -- The coach of the lesson or course (it never changes: an unlocked read).
  select coalesce(l.coach_id, c.coach_id) into v_coach
    from lesson_enrolments x
    left join lessons l on l.id = x.lesson_id
    left join courses c on c.id = x.course_id
   where x.id = v_e.id;
  perform app.lock_coach(v_coach);

  -- Under the coach mutex: the enrolment and its sessions as they are now.
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.status <> 'booked' then
    raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = v_e.status,
      hint = 'only a booked place is paid at the desk';
  end if;
  if not exists (select 1 from lessons l
                  where ((v_e.lesson_id is not null and l.id = v_e.lesson_id)
                         or (v_e.course_id is not null and l.course_id = v_e.course_id
                             and l.session_no >= v_e.first_session_no
                             and l.session_no < v_e.first_session_no + v_e.sessions_covered))
                    and l.status not in ('cancelled', 'expired')) then
    raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = 'lesson_cancelled',
      hint = 'every session of this place was cancelled';
  end if;
  if v_e.lesson_id is not null
     and exists (select 1 from lesson_attendance a
                  where a.lesson_id = v_e.lesson_id and a.enrolment_id = v_e.id and a.status = 'no_show') then
    raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = 'no_show',
      hint = 'nothing is collected from a no-show';
  end if;

  v_m := app.lesson_enrolment_money(v_e.id);
  v_owed := coalesce((v_m->>'owed_iqd')::bigint, 0);
  if v_owed = 0 then
    raise exception 'LESSON_NOT_PAYABLE' using errcode = 'P0001', detail = 'nothing_owed',
      hint = 'this place owes nothing';
  end if;
  if v_owed <> p_expected_owed_iqd then
    raise exception 'LESSON_OWED_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', p_expected_owed_iqd, v_owed),
      hint = 'what this place owes changed since it was shown; read it again';
  end if;

  -- The tab: the enrolment's branch and open day, a fixed label (no student
  -- name on a till row), no table, booking or court cap (tabs_lesson_shape).
  begin
    insert into tabs (venue_id, day_session_id, lesson_enrolment_id, label, opened_by_staff_id, device_id, kind)
    values (v_e.venue_id, v_day, v_e.id, 'Lesson', auth.uid(), p_device_id, 'lesson')
    returning * into v_tab;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tabs_one_live_per_enrolment' then
      raise exception 'LESSON_OWED_CHANGED' using errcode = 'P0001', detail = 'tab_open',
        hint = 'this place already has a bill open';
    end if;
    raise;
  end;

  select * into v_totals from app.compute_tab_totals(v_tab.id);
  if v_totals.lesson_iqd is distinct from v_owed or v_totals.total_iqd is distinct from v_owed then
    raise exception 'LESSON_OWED_CHANGED' using errcode = 'P0001',
      detail = format('expected %s, now %s', v_owed, coalesce(v_totals.total_iqd, 0)),
      hint = 'what this place owes changed since it was shown; read it again';
  end if;

  -- 0106's till path: TENDER_SHORT, TENDER_CARD, the till-shift stamp.
  v_settle := app.settle_tab(v_tab.id, p_method, p_tendered_iqd, v_owed, p_idempotency_key, p_device_id, v_owed);
  if coalesce((v_settle->>'duplicate')::boolean, false) or v_settle->>'status' is distinct from 'settled' then
    -- The key already names another payment: never take this place's money on it.
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
      hint = 'that key belongs to another payment';
  end if;
  v_payment := (v_settle->>'payment_id')::uuid;

  perform app.lesson_event(v_e.venue_id, v_e.lesson_id, v_e.course_id, v_e.id, 'settled', 'staff',
                           null, auth.uid(), null,
                           jsonb_build_object('enrolment_id', v_e.id, 'payment_id', v_payment, 'tab_id', v_tab.id,
                                              'amount_iqd', v_owed, 'method', p_method));

  v_result := jsonb_build_object(
    'duplicate',    false,
    'payment_id',   v_payment,
    'tab_id',       v_tab.id,
    'enrolment_id', v_e.id,
    'amount_iqd',   v_owed,
    'change_iqd',   (v_settle->>'change_iqd')::bigint,
    'method',       p_method,
    'owed_iqd',     0,
    'status',       'settled');
  perform app.write_audit('lesson.settle', 'lesson_enrolments', v_e.id::text, null,
                          jsonb_build_object('enrolment_id', v_e.id, 'lesson_id', v_e.lesson_id,
                                             'course_id', v_e.course_id, 'payment_id', v_payment,
                                             'tab_id', v_tab.id, 'amount_iqd', v_owed, 'method', p_method),
                          null, null, p_device_id);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $lesson_settle_0281$;

comment on function app.lesson_settle(uuid, payment_method, bigint, bigint, text, text) is
  '0281 (money.md §5.10, CM-1). Desk payment of a lesson place: cashier, court_desk, manager, owner at the enrolment''s branch (not shop_staff), online only. Inserts one kind lesson tab (label Lesson, the branch''s open day) and settles it in the same call for what the enrolment owes now (lesson_enrolment_money owed_iqd, the compute_tab_totals lesson line). Refusals in order: FORBIDDEN; INVALID_ARGUMENT (detail p_enrolment_id, p_method, p_expected_owed_iqd >= 1, p_idempotency_key required); ENROLMENT_NOT_FOUND (unknown or outside the visible branches); VENUE_MISMATCH; a replay returns the stored result (duplicate true), IDEMPOTENCY_CONFLICT; NO_OPEN_DAY; then under the coach mutex LESSON_NOT_PAYABLE (detail held, expired, cancelled, lesson_cancelled, no_show, nothing_owed); LESSON_OWED_CHANGED (detail expected X, now Y, or tab_open); settle_tab''s TENDER_SHORT, TENDER_CARD. Writes a lesson_events row settled and the audit lesson.settle. Returns {duplicate, payment_id, tab_id, enrolment_id, amount_iqd, change_iqd, method, owed_iqd, status}.';

revoke all on function app.lesson_settle(uuid, payment_method, bigint, bigint, text, text) from public, anon;
grant execute on function app.lesson_settle(uuid, payment_method, bigint, bigint, text, text) to authenticated;

-- lesson_refunds_due (money.md §5.11, X21, R44, R75): the lesson money a branch
-- owes back at the till, and the online money Qi could not take back. Manager,
-- owner; the role before the branch (R57). The engine runs only on enrolments
-- that took desk money or had an online refund. label and phone follow R44: a
-- coach- or desk-booked student's typed name and phone, never the profile's; a
-- guest's own booking the profile's name and phone (staff see phones; C-16
-- limits coaches only).
create or replace function app.lesson_refunds_due(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_refunds_due_0281$
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
       and (exists (select 1 from tabs t where t.lesson_enrolment_id = e.id and t.status = 'settled')
            or exists (select 1 from booking_payments bp
                        where bp.lesson_enrolment_id = e.id and bp.purpose = 'lesson'
                          and bp.status in ('refund_pending', 'refund_failed', 'refunded')))
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
end $lesson_refunds_due_0281$;

comment on function app.lesson_refunds_due(uuid) is
  '0281 (money.md §5.11, X21, R44, R75). Manager or owner at the branch (p_venue_id, default the caller''s resolved branch; the role first, R57): the lesson money the branch owes back. {venue_id, total_iqd (Σ refund_due_desk_iqd + Σ online_blocked_iqd), items [{enrolment_id, lesson_id, course_id, kind, coach_id, coach_name_en, coach_name_ar, type_name_en, type_name_ar, start_at (a course: its first covered session), label, phone (a coach- or desk-booked student''s typed name and phone, a guest''s own booking the profile''s), cancel_kind, cancelled_at, refund_due_iqd, refund_due_desk_iqd, online_blocked_iqd, payments [{payment_id, tab_id, method, amount_iqd, refunded_iqd, refundable_iqd, created_at}]}]}, oldest lesson first. A desk item is refunded with app.refund (reason lesson_refund, up to refund_due_desk_iqd); an online_blocked_iqd item is handed back outside the till and recorded with lesson_blocked_refund_record. FORBIDDEN, VENUE_MISMATCH. Key list: COACHING_SHAPES.lesson_refunds_due.';

revoke all on function app.lesson_refunds_due(uuid) from public, anon;
grant execute on function app.lesson_refunds_due(uuid) to authenticated;

-- R75: a refund Qi cannot take. When a share is owed back on an online payment
-- that already had its one refund (a late course leave, then a venue cancel of
-- the session it kept, C-23 × CM-5), lesson_refunds_due lists it as
-- online_blocked_iqd and the money is handed back outside the till. A manager
-- records the handback here, behind a manager PIN (the 0115 grant, spent by
-- consume_pin_grant; PIN_GATED_RPCS): it is stored in
-- lesson_enrolments.refunded_outside_iqd, which the engine and the statements
-- count as refunded, and is never a payments or refunds row. At most what is
-- blocked now (REFUND_EXCEEDS_DUE); the reference is a receipt or transfer
-- number, never a card or account number (R49, R74: a run of 12 or more digits
-- once spaces and hyphens are removed is refused).
create or replace function app.lesson_blocked_refund_record(
  p_enrolment_id uuid,
  p_amount_iqd   bigint,
  p_reference    text,
  p_pin          text,
  p_device_id    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $lesson_blocked_refund_record_0281$
declare
  v_e       lesson_enrolments%rowtype;
  v_ref     text := nullif(btrim(p_reference), '');
  v_auth    uuid;
  v_coach   uuid;
  v_m       jsonb;
  v_blocked bigint;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_enrolment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_amount_iqd';
  end if;
  if v_ref is null or char_length(v_ref) > 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reference';
  end if;
  if regexp_replace(v_ref, '[[:space:]-]', '', 'g') ~ '[0-9]{12}' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reference', hint = 'digits';
  end if;

  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if not found or not (v_e.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_e.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_e.venue_id::text, true);

  -- 0115: p_pin is never read here; without a fresh grant this is
  -- PIN_GRANT_REQUIRED whatever it says.
  v_auth := app.consume_pin_grant(p_device_id);

  select coalesce(l.coach_id, c.coach_id) into v_coach
    from lesson_enrolments x
    left join lessons l on l.id = x.lesson_id
    left join courses c on c.id = x.course_id
   where x.id = v_e.id;
  perform app.lock_coach(v_coach);

  v_m := app.lesson_enrolment_money(v_e.id);
  v_blocked := coalesce((v_m->>'refund_blocked_iqd')::bigint, 0);
  if p_amount_iqd > v_blocked then
    raise exception 'REFUND_EXCEEDS_DUE' using errcode = 'P0001', detail = format('due %s', v_blocked),
      hint = 'more than the online lesson money blocked on this place';
  end if;

  update lesson_enrolments
     set refunded_outside_iqd = refunded_outside_iqd + p_amount_iqd,
         updated_at           = now()
   where id = v_e.id
   returning * into v_e;

  perform app.lesson_event(v_e.venue_id, v_e.lesson_id, v_e.course_id, v_e.id, 'refunded', 'staff',
                           null, auth.uid(), 'outside',
                           jsonb_build_object('amount_iqd', p_amount_iqd, 'outside', true));
  perform app.write_audit('lesson.refund_outside', 'lesson_enrolments', v_e.id::text,
                          jsonb_build_object('refunded_outside_iqd', v_e.refunded_outside_iqd - p_amount_iqd),
                          jsonb_build_object('refunded_outside_iqd', v_e.refunded_outside_iqd,
                                             'amount_iqd', p_amount_iqd, 'reference', app.safe_line(v_ref)),
                          'lesson_refund_outside', v_auth, p_device_id);

  v_m := app.lesson_enrolment_money(v_e.id);
  return jsonb_build_object(
    'enrolment_id',         v_e.id,
    'amount_iqd',           p_amount_iqd,
    'refunded_outside_iqd', v_e.refunded_outside_iqd::bigint,
    'online_blocked_iqd',   coalesce((v_m->>'refund_blocked_iqd')::bigint, 0));
end $lesson_blocked_refund_record_0281$;

comment on function app.lesson_blocked_refund_record(uuid, bigint, text, text, text) is
  '0281 (R75). Manager or owner at the enrolment''s branch, behind a manager PIN grant (PIN_GATED_RPCS): records p_amount_iqd of online lesson money handed back outside the till because its payment already had its one Qi refund. Adds to lesson_enrolments.refunded_outside_iqd (counted as refunded by the engine and the statements; never a payments or refunds row), under the coach mutex, at most the engine''s refund_blocked_iqd. Refusals in order: FORBIDDEN; INVALID_ARGUMENT (detail p_enrolment_id, p_amount_iqd >= 1, p_reference 1..80, p_reference hint digits for a run of 12 or more digits, R49/R74); ENROLMENT_NOT_FOUND; VENUE_MISMATCH; PIN_GRANT_REQUIRED; REFUND_EXCEEDS_DUE (detail due <n>). Writes a lesson_events row refunded (code outside) and the audit lesson.refund_outside with the reference. Returns {enrolment_id, amount_iqd, refunded_outside_iqd, online_blocked_iqd}.';

revoke all on function app.lesson_blocked_refund_record(uuid, bigint, text, text, text) from public, anon;
grant execute on function app.lesson_blocked_refund_record(uuid, bigint, text, text, text) to authenticated;
