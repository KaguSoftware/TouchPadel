set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0287 coach_statements — coaching, lane Money (docs/design/coaching/money.md
-- §7; build contracts §1.1, §1.5, §1.7, §1.9, C-6, C-12, C-24, C-25, C-28,
-- C-29, CM-7..CM-12, CM-15, CM-16, R4, R21, R24, R40, R42, R45, R49, R59,
-- R70, R72, R74, R81).
--
--   1. app.coach_statement_lessons   internal: the statement lessons (§7.1) of
--                                    some branches in a time range, with each
--                                    lesson's collected money and coach share.
--                                    The one definition the statements (here)
--                                    and the reports (0288) read.
--   2. app.coach_statement_plan      internal: the lines a draft of (coach,
--                                    branch, month) would hold now (§7.2 steps
--                                    4-6; R24: every line names its lesson).
--   3. app.coach_statement_build     internal (§1.5): writes that draft.
--   4. app.coach_statement_draft_one internal (R59): one pair, under its coach
--                                    lock, in an exception block.
--   5. procedure app.coach_statements_draft  security invoker (R59, R70): every
--                                    pair, a COMMIT after each.
--   6. the staff writes: coach_statement_refresh, coach_statement_approve,
--      coach_statement_void (PIN from approved, R70), coach_statement_mark_paid
--      (PIN, R4; never a payments, refunds or booking_payments row, C-12).
--   7. the reads: report_coach_statements (X22, every branch in scope, R21),
--      coach_statement_detail (X23, R72), my_coach_statements (X12; a retired
--      coach still reads, C-25, R45).
--   8. cron tp_coach_statements '0 0 1 * *' UTC (03:00 on the 1st in Baghdad).
--
-- Money (C-6, CD-5): per statement lesson L, collected_L =
-- app.lesson_collected(L) (0281: the real money kept on every enrolment
-- covering L, allocated evenly over the sessions each pays for; sandbox money
-- counts 0, CM-15) and coach_L = app.lesson_coach_share(collected_L,
-- L.court_share_iqd, L.coach_share_bp) = floor(bp x max(0, collected -
-- court share) / 10000), the twin of @touch/core lessonCoachShare.
--
-- C-28, R42 (the salary_deductions precedent): coach pay never reaches an
-- LLM. The statement tables are excluded from the assistant (0278), the two
-- person-money reports are never an assistant tool, and the audit rows written
-- here carry ids, the month and the status only, never an amount or a payment
-- reference: audit_log is readable by the owner assistant (its before/after
-- columns are in app.assistant_readable_columns, 0109).
--
-- Locks (money.md §9): every write takes the statement's coach mutex
-- (app.lock_coach) and nothing else ranked; mark paid and a void from approved
-- spend the PIN grant first (app.pin_grants, unranked). The procedure holds
-- one coach's key per transaction (R59). The walker prints coach_advisory.
--
-- Functions of other coaching files this one calls (bound late, by name):
--   0278 (DB)    app.lock_coach
--   0281 (Money) app.lesson_collected, app.lesson_coach_share
--   0282 (DB)    app.coach_of_caller
--   0283 (Guest) app.lesson_notify (coach.statement_ready, coach.statement_paid:
--                Money's only two direct push calls, R40)

-- ===========================================================================
-- 1. The statement lessons (money.md §7.1)
-- ===========================================================================

-- A statement lesson: over (end_at <= now()) and completed, or still
-- scheduled (the sweep not yet run), or cancelled by its guest with money kept
-- (a late cancel, CM-7). Range by start_at; the branches' months are the
-- callers' business (CM-16).
create or replace function app.coach_statement_lessons(
  p_venues   uuid[],
  p_ts_from  timestamptz,
  p_ts_to    timestamptz,
  p_coach_id uuid default null
) returns table (
  lesson_id       uuid,
  venue_id        uuid,
  coach_id        uuid,
  lesson_type_id  uuid,
  kind            text,
  course_id       uuid,
  session_no      int,
  start_at        timestamptz,
  end_at          timestamptz,
  minutes         int,
  status          text,
  court_share_iqd bigint,
  share_bp        int,
  max_places      int,
  collected_iqd   bigint,
  coach_iqd       bigint
)
language sql stable security definer set search_path = public as $coach_statement_lessons_0287$
  select x.id, x.venue_id, x.coach_id, x.lesson_type_id, x.kind, x.course_id, x.session_no::int,
         x.start_at, x.end_at, x.minutes, x.status, x.court_share_iqd::bigint, x.coach_share_bp,
         x.max_places::int, x.collected::bigint,
         app.lesson_coach_share(x.collected, x.court_share_iqd, x.coach_share_bp)::bigint
    from (select l.id, l.venue_id, l.coach_id, l.lesson_type_id, l.kind, l.course_id, l.session_no,
                 l.start_at, l.end_at, l.status, l.court_share_iqd, l.coach_share_bp, l.max_places,
                 (extract(epoch from (l.end_at - l.start_at)) / 60)::int as minutes,
                 app.lesson_collected(l.id)                              as collected
            from lessons l
           where l.venue_id = any (p_venues)
             and l.start_at >= p_ts_from and l.start_at < p_ts_to
             and (p_coach_id is null or l.coach_id = p_coach_id)
             and l.end_at <= now()
             and (l.status in ('completed', 'scheduled')
                  or (l.status = 'cancelled' and l.cancel_reason = 'guest_cancel'))) x
   where x.status in ('completed', 'scheduled') or x.collected > 0
$coach_statement_lessons_0287$;

comment on function app.coach_statement_lessons(uuid[], timestamptz, timestamptz, uuid) is
  '0287 (money.md §7.1). Internal. The statement lessons of the branches p_venues (and coach p_coach_id when given) starting in [p_ts_from, p_ts_to): over (end_at <= now()) and completed or still scheduled, or cancelled guest_cancel with money kept (CM-7). Per lesson: its kind, course and session, minutes, status, the snapshotted court share and share_bp, max_places, collected_iqd = app.lesson_collected (real kept money, sandbox 0) and coach_iqd = app.lesson_coach_share(collected, court share, share_bp). The one definition read by the statements (0287) and the reports and day close (0288). Takes no lock.';

revoke all on function app.coach_statement_lessons(uuid[], timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. The lines a draft would hold now (money.md §7.2 steps 4-6)
-- ===========================================================================

-- Candidates: the pair's statement lessons from p_month - 12 months to the end
-- of p_month (branch-local months, CM-16), and every lesson of that window
-- with lines on an approved or paid statement (void lines never count). A
-- lesson of p_month with no such line is a REGULAR line at its figures now
-- (collected 0 included: the coach sees a lesson taught that brought in
-- nothing). Every other candidate is an ADJUSTMENT line of its figures now
-- less its booked lines, written only when the coach or collected delta is not
-- zero. R24: one line per lesson, always naming it.
create or replace function app.coach_statement_plan(p_coach_id uuid, p_venue_id uuid, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = public as $coach_statement_plan_0287$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_tz    text;
  v_from  timestamptz;
  v_mfrom timestamptz;
  v_to    timestamptz;
  v_out   jsonb;
begin
  select coalesce(v.timezone, 'Asia/Baghdad') into v_tz from venues v where v.id = p_venue_id;
  if v_tz is null or p_coach_id is null or v_month is null then
    return '[]'::jsonb;
  end if;
  v_from  := ((v_month - interval '12 months')::date)::timestamp at time zone v_tz;
  v_mfrom := v_month::timestamp at time zone v_tz;
  v_to    := ((v_month + interval '1 month')::date)::timestamp at time zone v_tz;

  with
  sl as (
    select s.lesson_id, s.start_at, s.court_share_iqd, s.share_bp, s.collected_iqd, s.coach_iqd
      from app.coach_statement_lessons(array[p_venue_id], v_from, v_to, p_coach_id) s),
  booked as (
    select ln.lesson_id,
           sum(ln.collected_iqd)::bigint   as collected,
           sum(ln.court_share_iqd)::bigint as court,
           sum(ln.coach_iqd)::bigint       as coach
      from coach_statement_lines ln
      join coach_statements st on st.id = ln.statement_id and st.status in ('approved', 'paid')
      join lessons l on l.id = ln.lesson_id
     where l.coach_id = p_coach_id and l.venue_id = p_venue_id
       and l.start_at >= v_from and l.start_at < v_to
     group by ln.lesson_id),
  cand as (
    select sl.lesson_id, sl.start_at, sl.court_share_iqd as court, sl.share_bp,
           sl.collected_iqd as collected, sl.coach_iqd as coach
      from sl
    union all
    -- Booked, but no longer a statement lesson (a late cancel whose money
    -- went back): its figures now, so the adjustment takes the line back.
    select l.id, l.start_at, l.court_share_iqd::bigint, l.coach_share_bp, x.collected,
           app.lesson_coach_share(x.collected, l.court_share_iqd, l.coach_share_bp)::bigint
      from booked b
      join lessons l on l.id = b.lesson_id
      cross join lateral (select app.lesson_collected(l.id)::bigint as collected) x
     where not exists (select 1 from sl where sl.lesson_id = b.lesson_id)),
  lines as (
    select c.lesson_id, c.start_at, c.share_bp,
           (c.start_at >= v_mfrom and b.lesson_id is null) as regular,
           c.collected - coalesce(b.collected, 0)         as d_collected,
           c.court     - coalesce(b.court, 0)             as d_court,
           c.coach     - coalesce(b.coach, 0)             as d_coach
      from cand c
      left join booked b on b.lesson_id = c.lesson_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_id',       ln.lesson_id,
           'collected_iqd',   ln.d_collected,
           'court_share_iqd', ln.d_court,
           'share_bp',        ln.share_bp,
           'coach_iqd',       ln.d_coach,
           'is_adjustment',   not ln.regular)
           order by (not ln.regular), ln.start_at, ln.lesson_id), '[]'::jsonb)
    into v_out
    from lines ln
   where ln.regular or ln.d_coach <> 0 or ln.d_collected <> 0;

  return v_out;
end $coach_statement_plan_0287$;

comment on function app.coach_statement_plan(uuid, uuid, date) is
  '0287 (money.md §7.2 steps 4-6; R24). Internal. The lines a draft of (p_coach_id, p_venue_id, the month of p_month) would hold now, as [{lesson_id, collected_iqd, court_share_iqd, share_bp, coach_iqd, is_adjustment}], regular lines first then by start: a statement lesson of the month with no line on an approved or paid statement is a regular line at its figures now; every other statement lesson of the 12 months before, and every lesson of the window with booked lines, is an adjustment of its figures now less its booked lines, kept only when the coach or collected delta is not zero. Read by coach_statement_build and by coach_statement_detail''s stale flag. Takes no lock.';

revoke all on function app.coach_statement_plan(uuid, uuid, date) from public, anon, authenticated;

-- ===========================================================================
-- 3. app.coach_statement_build (money.md §7.2)
-- ===========================================================================

-- The caller holds lock_coach(p_coach_id). NULL when there is nothing to draft
-- or drafting is blocked: the month is not complete at the branch; the pair
-- has a live draft of another month (CM-8: one live draft, or two drafts would
-- each carry the same adjustment); the month already has an approved or paid
-- statement. A draft of the month is rebuilt in place.
create or replace function app.coach_statement_build(p_coach_id uuid, p_venue_id uuid, p_month date)
returns uuid
language plpgsql security definer set search_path = public as $coach_statement_build_0287$
declare
  v_month  date;
  v_tz     text;
  v_s      coach_statements%rowtype;
  v_found  boolean;
  v_plan   jsonb;
  v_id     uuid;
  v_count  int;
  v_coll   bigint;
  v_court  bigint;
  v_coach  bigint;
  v_adj    bigint;
begin
  if p_coach_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_coach_id';
  end if;
  if p_month is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_month';
  end if;
  select coalesce(v.timezone, 'Asia/Baghdad') into v_tz from venues v where v.id = p_venue_id;
  if v_tz is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  end if;
  v_month := date_trunc('month', p_month)::date;

  -- 1. Only a month that is over at the branch (CM-16).
  if (v_month + interval '1 month')::date > (now() at time zone v_tz)::date then
    return null;
  end if;

  -- 2. CM-8: one live draft per coach and branch.
  if exists (select 1 from coach_statements s
              where s.coach_id = p_coach_id and s.venue_id = p_venue_id
                and s.status = 'draft' and s.month <> v_month) then
    return null;
  end if;

  -- 3. The month's live statement: a draft is rebuilt, anything else stays.
  select * into v_s from coach_statements s
   where s.coach_id = p_coach_id and s.venue_id = p_venue_id and s.month = v_month and s.status <> 'void';
  v_found := found;
  if v_found and v_s.status <> 'draft' then
    return null;
  end if;

  -- 4-6. The lines.
  v_plan := app.coach_statement_plan(p_coach_id, p_venue_id, v_month);

  -- 7. Nothing to draft.
  if jsonb_array_length(v_plan) = 0 and not v_found then
    return null;
  end if;

  select count(*) filter (where not (x ->> 'is_adjustment')::boolean),
         coalesce(sum((x ->> 'collected_iqd')::bigint)   filter (where not (x ->> 'is_adjustment')::boolean), 0),
         coalesce(sum((x ->> 'court_share_iqd')::bigint) filter (where not (x ->> 'is_adjustment')::boolean), 0),
         coalesce(sum((x ->> 'coach_iqd')::bigint)       filter (where not (x ->> 'is_adjustment')::boolean), 0),
         coalesce(sum((x ->> 'coach_iqd')::bigint)       filter (where (x ->> 'is_adjustment')::boolean), 0)
    into v_count, v_coll, v_court, v_coach, v_adj
    from jsonb_array_elements(v_plan) x;

  perform set_config('app.venue_id', p_venue_id::text, true);

  if v_found then
    delete from coach_statement_lines where statement_id = v_s.id;
    update coach_statements
       set lessons_count   = v_count,
           collected_iqd   = v_coll,
           court_share_iqd = v_court,
           coach_iqd       = v_coach,
           adjustments_iqd = v_adj,
           refreshed_at    = now()
     where id = v_s.id;
    v_id := v_s.id;
  else
    insert into coach_statements (coach_id, venue_id, month, status, lessons_count, collected_iqd,
                                  court_share_iqd, coach_iqd, adjustments_iqd, drafted_at)
    values (p_coach_id, p_venue_id, v_month, 'draft', v_count, v_coll, v_court, v_coach, v_adj, now())
    returning id into v_id;
  end if;

  insert into coach_statement_lines (statement_id, venue_id, lesson_id, collected_iqd, court_share_iqd,
                                     share_bp, coach_iqd, is_adjustment)
  select v_id, p_venue_id, (x ->> 'lesson_id')::uuid, (x ->> 'collected_iqd')::bigint,
         (x ->> 'court_share_iqd')::bigint, (x ->> 'share_bp')::int, (x ->> 'coach_iqd')::bigint,
         (x ->> 'is_adjustment')::boolean
    from jsonb_array_elements(v_plan) x;

  -- C-28: ids, the month and the line count; no amount.
  perform app.write_audit(case when v_found then 'coach.statement_refreshed' else 'coach.statement_drafted' end,
                          'coach_statements', v_id::text, null,
                          jsonb_build_object('statement_id', v_id, 'coach_id', p_coach_id, 'month', v_month,
                                             'lines', jsonb_array_length(v_plan), 'status', 'draft'));
  return v_id;
end $coach_statement_build_0287$;

comment on function app.coach_statement_build(uuid, uuid, date) is
  '0287 (money.md §7.2; CM-8, R24). Internal; the caller holds lock_coach(p_coach_id). Writes the draft of (coach, branch, the month of p_month) from app.coach_statement_plan: lessons_count, collected_iqd, court_share_iqd and coach_iqd are the sums of the regular lines, adjustments_iqd the sum of the adjustment lines'' coach_iqd; a draft of the month is rebuilt in place (refreshed_at). Returns its id, or NULL when the month is not over at the branch, the pair has a live draft of another month, the month has an approved or paid statement, or there is nothing to draft. Audits coach.statement_drafted / coach.statement_refreshed {statement_id, coach_id, month, lines, status} (no amount, C-28). What the coach is owed for a statement is coach_iqd + adjustments_iqd; it can be negative.';

revoke all on function app.coach_statement_build(uuid, uuid, date) from public, anon, authenticated;

-- ===========================================================================
-- 4. app.coach_statement_draft_one (R59)
-- ===========================================================================

-- COMMIT cannot run inside a block with an exception handler, so the
-- procedure's per-pair work and its error handling live here. When the pair
-- has a live draft of an older month, that one is refreshed instead (CM-8; a
-- month is drafted only once the one before it is approved).
create or replace function app.coach_statement_draft_one(p_coach_id uuid, p_venue_id uuid, p_month date)
returns boolean
language plpgsql security definer set search_path = public as $coach_statement_draft_one_0287$
declare
  v_older date;
  v_id    uuid;
begin
  begin
    perform app.lock_coach(p_coach_id);
    select s.month into v_older
      from coach_statements s
     where s.coach_id = p_coach_id and s.venue_id = p_venue_id and s.status = 'draft'
       and s.month < date_trunc('month', p_month)::date
     order by s.month
     limit 1;
    v_id := app.coach_statement_build(p_coach_id, p_venue_id, coalesce(v_older, p_month));
    return v_id is not null;
  exception when others then
    raise warning 'coach_statement_draft_one: coach % at % for % left for the next run: % (%)',
      p_coach_id, p_venue_id, p_month, sqlerrm, sqlstate;
    return false;
  end;
end $coach_statement_draft_one_0287$;

comment on function app.coach_statement_draft_one(uuid, uuid, date) is
  '0287 (money.md §7.3; R59, R70). Internal. One (coach, branch) pair of the monthly run: under lock_coach, refreshes the pair''s live draft of an older month if there is one, else builds the month p_month (app.coach_statement_build). True when a draft was built or refreshed. Any error is a warning and false: one bad pair never stops the run.';

revoke all on function app.coach_statement_draft_one(uuid, uuid, date) from public, anon, authenticated;

-- ===========================================================================
-- 5. procedure app.coach_statements_draft (money.md §7.3; R59, R70)
-- ===========================================================================

-- PostgreSQL refuses COMMIT in a procedure that is SECURITY DEFINER or has a
-- SET clause, so this one is SECURITY INVOKER with no SET clause: every name
-- is qualified, it is granted to no client, and pg_cron runs it as the job
-- owner. It commits after each pair, so no coach's lock is held longer than
-- its own build (F21). The pairs: every coach_branches row (active or not, any
-- coach status: a paused or retired coach is still paid for lessons given,
-- C-25), plus every (coach, branch) of a lesson in the look-back (a coach
-- taken off a branch). The month: p_month, else each branch's previous local
-- month. The loop's cursor is held across the commits (PL/pgSQL makes a
-- cursor loop holdable on COMMIT).
create or replace procedure app.coach_statements_draft(p_month date default null)
language plpgsql as $coach_statements_draft_0287$
declare
  r     record;
  v_m   date;
  v_n   int := 0;
begin
  for r in
    select x.coach_id, x.venue_id, coalesce(v.timezone, 'Asia/Baghdad') as tz
      from (select cb.coach_id, cb.venue_id from public.coach_branches cb
            union
            select l.coach_id, l.venue_id from public.lessons l
             where l.start_at >= pg_catalog.now() - interval '13 months') x
      join public.venues v on v.id = x.venue_id
     order by x.coach_id, x.venue_id
  loop
    v_m := coalesce(pg_catalog.date_trunc('month', p_month)::date,
                    (pg_catalog.date_trunc('month', (pg_catalog.now() at time zone r.tz)::date)
                     - interval '1 month')::date);
    if app.coach_statement_draft_one(r.coach_id, r.venue_id, v_m) then
      v_n := v_n + 1;
    end if;
    commit;
  end loop;
  raise notice 'coach_statements_draft: % drafts built or refreshed', v_n;
end $coach_statements_draft_0287$;

comment on procedure app.coach_statements_draft(date) is
  '0287 (money.md §7.3; R59, R70). The monthly statement run (cron tp_coach_statements, ''0 0 1 * *'' UTC). Security invoker with no SET clause (PostgreSQL refuses COMMIT otherwise): for every (coach, branch) pair, in (coach_id, venue_id) order, app.coach_statement_draft_one for p_month, else the branch''s previous local month, then COMMIT, so a booking for a coach is never held past that coach''s own build and a failing pair never undoes the others. Raises a notice with the drafts built or refreshed. Granted to no client role. No push: drafts are hidden from coaches (CM-12).';

revoke all on procedure app.coach_statements_draft(date) from public, anon, authenticated;

-- ===========================================================================
-- 6. The staff writes (money.md §7.4): manager or owner, at the statement's
--    branch, which must be the rail's (R21); never their own statement
--    (CM-11).
-- ===========================================================================

-- Common prologue, written out in each (R57: the role first): FORBIDDEN unless
-- manager or owner; an unknown statement, or one outside the caller's visible
-- branches, is INVALID_ARGUMENT detail p_statement_id (there is no
-- STATEMENT_NOT_FOUND); VENUE_MISMATCH unless the statement's branch is the
-- caller's resolved branch (under "All branches" another branch's statement is
-- read-only, R21) and the caller is a manager or the owner there; FORBIDDEN
-- detail own_statement on the caller's own coach profile (CM-11); then the
-- coach mutex and a re-read.

create or replace function app.coach_statement_refresh(p_statement_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $coach_statement_refresh_0287$
declare
  v_s    coach_statements%rowtype;
  v_rail uuid;
  v_id   uuid;
  v_live text;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_s from coach_statements where id = p_statement_id;
  if not found or not (v_s.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_statement_id';
  end if;
  begin
    v_rail := app.current_venue();
  exception when sqlstate 'P0001' then
    v_rail := null;
  end;
  if v_rail is distinct from v_s.venue_id or not app.is_staff_at(v_s.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);
  if exists (select 1 from coaches c where c.id = v_s.coach_id and c.profile_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement';
  end if;

  perform app.lock_coach(v_s.coach_id);
  select * into v_s from coach_statements where id = p_statement_id;

  if v_s.status = 'draft' then
    v_id := app.coach_statement_build(v_s.coach_id, v_s.venue_id, v_s.month);
    return jsonb_build_object('statement_id', v_s.id, 'status', 'draft', 'created', false);
  elsif v_s.status = 'void' then
    -- A void month is drafted again only when nothing live stands in its way:
    -- the month's own live statement, or the pair's live draft (CM-8).
    select s.status into v_live
      from coach_statements s
     where s.coach_id = v_s.coach_id and s.venue_id = v_s.venue_id and s.status <> 'void'
       and (s.month = v_s.month or s.status = 'draft')
     order by (s.status = 'draft') desc
     limit 1;
    if v_live = 'draft' then
      raise exception 'STATEMENT_NOT_DRAFT' using errcode = 'P0001', detail = 'live_draft';
    elsif v_live is not null then
      raise exception 'STATEMENT_NOT_DRAFT' using errcode = 'P0001', detail = v_live;
    end if;
    v_id := app.coach_statement_build(v_s.coach_id, v_s.venue_id, v_s.month);
    return jsonb_build_object('statement_id', coalesce(v_id, v_s.id),
                              'status',       case when v_id is null then 'void' else 'draft' end,
                              'created',      v_id is not null);
  end if;
  raise exception 'STATEMENT_NOT_DRAFT' using errcode = 'P0001', detail = v_s.status;
end $coach_statement_refresh_0287$;

comment on function app.coach_statement_refresh(uuid) is
  '0287 (money.md §7.4). Manager or owner at the statement''s branch, the rail''s (R21), never their own (CM-11). A draft is rebuilt in place from today''s figures (a lesson that ended after the monthly run becomes a regular line); a void statement''s month is drafted afresh when the month has no live statement and the pair no live draft (else STATEMENT_NOT_DRAFT detail live_draft, or the live statement''s status). Returns {statement_id, status, created} (the new draft''s id when a void month was redrafted). FORBIDDEN (detail own_statement), INVALID_ARGUMENT p_statement_id (unknown or not visible), VENUE_MISMATCH, STATEMENT_NOT_DRAFT (approved, paid).';

revoke all on function app.coach_statement_refresh(uuid) from public, anon;
grant execute on function app.coach_statement_refresh(uuid) to authenticated;

create or replace function app.coach_statement_approve(p_statement_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $coach_statement_approve_0287$
declare
  v_s     coach_statements%rowtype;
  v_rail  uuid;
  v_tz    text;
  v_m     date;
  v_k     int := 0;
  v_next  uuid;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_s from coach_statements where id = p_statement_id;
  if not found or not (v_s.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_statement_id';
  end if;
  begin
    v_rail := app.current_venue();
  exception when sqlstate 'P0001' then
    v_rail := null;
  end;
  if v_rail is distinct from v_s.venue_id or not app.is_staff_at(v_s.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);
  if exists (select 1 from coaches c where c.id = v_s.coach_id and c.profile_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement';
  end if;

  perform app.lock_coach(v_s.coach_id);
  select * into v_s from coach_statements where id = p_statement_id;
  if v_s.status <> 'draft' then
    raise exception 'STATEMENT_NOT_DRAFT' using errcode = 'P0001', detail = v_s.status;
  end if;

  -- CM-9: approval freezes the draft as drafted or last refreshed; the lines
  -- freeze with it (coach_statement_lines_frozen, 0278).
  update coach_statements
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = v_s.id and status = 'draft';

  perform app.write_audit('coach.statement_approved', 'coach_statements', v_s.id::text,
                          jsonb_build_object('status', 'draft'),
                          jsonb_build_object('statement_id', v_s.id, 'coach_id', v_s.coach_id,
                                             'month', v_s.month, 'status', 'approved'));

  -- R40: one of Money's two direct push calls (route coach_statements; the
  -- payload carries the statement id only). A push never fails the approval.
  begin
    perform app.lesson_notify(v_s.id, 'coach.statement_ready',
                              'l:' || v_s.id::text || ':coach.statement_ready', '{}'::jsonb);
  exception when others then
    raise warning 'coach_statement_approve: push left out: % (%)', sqlerrm, sqlstate;
  end;

  -- CM-8's chain, under the same coach lock: the first later complete month
  -- of the pair that yields a draft.
  select coalesce(v.timezone, 'Asia/Baghdad') into v_tz from venues v where v.id = v_s.venue_id;
  v_m := (v_s.month + interval '1 month')::date;
  while v_k < 24 and (v_m + interval '1 month')::date <= (now() at time zone v_tz)::date loop
    v_next := app.coach_statement_build(v_s.coach_id, v_s.venue_id, v_m);
    exit when v_next is not null;
    v_m := (v_m + interval '1 month')::date;
    v_k := v_k + 1;
  end loop;

  return jsonb_build_object('statement_id', v_s.id, 'status', 'approved', 'next_statement_id', v_next);
end $coach_statement_approve_0287$;

comment on function app.coach_statement_approve(uuid) is
  '0287 (money.md §7.4; C-12, CM-8, CM-9, R40). Manager or owner at the statement''s branch, the rail''s (R21), never their own (CM-11). A draft becomes approved (approved_by, approved_at), its lines frozen; audit coach.statement_approved (no amount, C-28); the coach is told coach.statement_ready (app.lesson_notify, never failing the approval); then the first later complete month of the pair that yields a draft is built. No PIN (R4: the PIN is asked when marking paid). Returns {statement_id, status: approved, next_statement_id}. FORBIDDEN (detail own_statement), INVALID_ARGUMENT p_statement_id, VENUE_MISMATCH, STATEMENT_NOT_DRAFT (detail the status).';

revoke all on function app.coach_statement_approve(uuid) from public, anon;
grant execute on function app.coach_statement_approve(uuid) to authenticated;

-- R70: (p_statement_id, p_reason, p_pin, p_device_id); the PIN transports
-- prove a PIN only when the call carries a string p_pin, which is why the
-- argument exists. A void from draft needs none; from approved it spends a
-- manager PIN grant (R59: cash may already have been handed over).
create or replace function app.coach_statement_void(
  p_statement_id uuid,
  p_reason       text,
  p_pin          text default null,
  p_device_id    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $coach_statement_void_0287$
declare
  v_s      coach_statements%rowtype;
  v_rail   uuid;
  v_reason text;
  v_from   text;
  v_auth   uuid;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_reason := btrim(app.safe_line(p_reason));
  if v_reason is null or v_reason = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason', hint = 'length';
  end if;
  -- R49, R74: never a card or account number (a run of 12 digits once spaces
  -- and hyphens are removed; coach_statements_no_card backs it).
  if regexp_replace(v_reason, '[[:space:]-]', '', 'g') ~ '[0-9]{12}' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason', hint = 'digits';
  end if;

  select * into v_s from coach_statements where id = p_statement_id;
  if not found or not (v_s.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_statement_id';
  end if;
  begin
    v_rail := app.current_venue();
  exception when sqlstate 'P0001' then
    v_rail := null;
  end;
  if v_rail is distinct from v_s.venue_id or not app.is_staff_at(v_s.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);
  if exists (select 1 from coaches c where c.id = v_s.coach_id and c.profile_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement';
  end if;

  -- Answered before any grant is spent (CM-10).
  if v_s.status = 'void' then
    return jsonb_build_object('duplicate', true, 'statement_id', v_s.id, 'status', 'void',
                              'voided_at', v_s.voided_at);
  end if;
  if v_s.status = 'paid' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'paid';
  end if;

  -- [pin grant] -> coach_advisory (money.md §9). 0115: p_pin is never read
  -- here; without a fresh grant this is PIN_GRANT_REQUIRED whatever it says.
  if v_s.status = 'approved' then
    v_auth := app.consume_pin_grant(p_device_id);
  end if;

  perform app.lock_coach(v_s.coach_id);
  select * into v_s from coach_statements where id = p_statement_id;
  if v_s.status = 'void' then
    return jsonb_build_object('duplicate', true, 'statement_id', v_s.id, 'status', 'void',
                              'voided_at', v_s.voided_at);
  end if;
  if v_s.status = 'paid' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'paid';
  end if;
  if v_s.status = 'approved' and v_auth is null then
    -- Approved while this call was waiting for the lock: the PIN is needed.
    v_auth := app.consume_pin_grant(p_device_id);
  end if;
  v_from := v_s.status;

  update coach_statements
     set status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = v_reason
   where id = v_s.id and status in ('draft', 'approved');

  -- C-28: no amount, and not the reason either (free text about a coach's
  -- pay; it stays on the statement, which no LLM reads).
  perform app.write_audit('coach.statement_voided', 'coach_statements', v_s.id::text,
                          jsonb_build_object('status', v_from),
                          jsonb_build_object('statement_id', v_s.id, 'coach_id', v_s.coach_id,
                                             'month', v_s.month, 'from_status', v_from,
                                             'status', 'void'),
                          null, v_auth, p_device_id);

  return jsonb_build_object('duplicate', false, 'statement_id', v_s.id, 'status', 'void',
                            'voided_at', now());
end $coach_statement_void_0287$;

comment on function app.coach_statement_void(uuid, text, text, text) is
  '0287 (money.md §7.4; CM-10, R49, R59, R70, R74). Manager or owner at the statement''s branch, the rail''s (R21), never their own (CM-11). A draft or approved statement becomes void (voided_by, voided_at, void_reason 1..200, never a run of 12 digits); its lessons then have no booked line, so the next draft carries them as adjustments (a voided negative month is how a clawback is carried forward). From approved it spends a manager PIN grant (p_pin is never read: the transports prove it to verify_manager_pin first); from draft no PIN. An already void statement answers {duplicate: true} and a paid one INVALID_TRANSITION detail paid, both before any grant is spent. Audit coach.statement_voided {statement_id, coach_id, month, from_status, status} with the authorising manager (no amount and no reason, C-28). No push. Returns {duplicate, statement_id, status: void, voided_at}. FORBIDDEN (detail own_statement), REASON_REQUIRED, INVALID_ARGUMENT (p_reason hint length or digits; p_statement_id), VENUE_MISMATCH, INVALID_TRANSITION paid, PIN_GRANT_REQUIRED.';

revoke all on function app.coach_statement_void(uuid, text, text, text) from public, anon;
grant execute on function app.coach_statement_void(uuid, text, text, text) to authenticated;

-- C-12, R4: the money is handed over outside the till. No payments, refunds
-- or booking_payments row, ever (invariant L10).
create or replace function app.coach_statement_mark_paid(
  p_statement_id uuid,
  p_reference    text,
  p_pin          text,
  p_device_id    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $coach_statement_mark_paid_0287$
declare
  v_s    coach_statements%rowtype;
  v_rail uuid;
  v_ref  text;
  v_auth uuid;
  v_at   timestamptz := now();
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_ref := btrim(app.safe_line(p_reference));
  if v_ref is null or v_ref = '' or char_length(v_ref) > 80 then
    raise exception 'STATEMENT_REFERENCE_REQUIRED' using errcode = 'P0001';
  end if;
  -- R49, R74: a receipt or transfer number, never a card or account number.
  if regexp_replace(v_ref, '[[:space:]-]', '', 'g') ~ '[0-9]{12}' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reference', hint = 'digits';
  end if;

  select * into v_s from coach_statements where id = p_statement_id;
  if not found or not (v_s.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_statement_id';
  end if;
  begin
    v_rail := app.current_venue();
  exception when sqlstate 'P0001' then
    v_rail := null;
  end;
  if v_rail is distinct from v_s.venue_id or not app.is_staff_at(v_s.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);
  if exists (select 1 from coaches c where c.id = v_s.coach_id and c.profile_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement';
  end if;

  -- Answered before any grant is spent.
  if v_s.status = 'paid' then
    return jsonb_build_object('duplicate', true, 'statement_id', v_s.id, 'status', 'paid',
                              'paid_at', v_s.paid_at, 'paid_reference', v_s.paid_reference,
                              'total_iqd', v_s.coach_iqd + v_s.adjustments_iqd);
  end if;
  if v_s.status <> 'approved' then
    raise exception 'STATEMENT_NOT_APPROVED' using errcode = 'P0001', detail = v_s.status;
  end if;
  -- R59: a negative month is voided and carried forward, never "paid".
  if v_s.coach_iqd + v_s.adjustments_iqd < 0 then
    raise exception 'STATEMENT_NOT_APPROVED' using errcode = 'P0001', detail = 'negative';
  end if;

  -- [pin grant] -> coach_advisory (money.md §9). 0115: p_pin is never read.
  v_auth := app.consume_pin_grant(p_device_id);

  perform app.lock_coach(v_s.coach_id);
  select * into v_s from coach_statements where id = p_statement_id;
  if v_s.status = 'paid' then
    return jsonb_build_object('duplicate', true, 'statement_id', v_s.id, 'status', 'paid',
                              'paid_at', v_s.paid_at, 'paid_reference', v_s.paid_reference,
                              'total_iqd', v_s.coach_iqd + v_s.adjustments_iqd);
  end if;
  if v_s.status <> 'approved' then
    raise exception 'STATEMENT_NOT_APPROVED' using errcode = 'P0001', detail = v_s.status;
  end if;

  update coach_statements
     set status = 'paid', paid_by = auth.uid(), paid_at = v_at, paid_reference = v_ref
   where id = v_s.id and status = 'approved';

  -- C-28: no amount and no reference in the audit row (both are on the
  -- statement, which no LLM reads).
  perform app.write_audit('coach.statement_paid', 'coach_statements', v_s.id::text,
                          jsonb_build_object('status', 'approved'),
                          jsonb_build_object('statement_id', v_s.id, 'coach_id', v_s.coach_id,
                                             'month', v_s.month, 'status', 'paid'),
                          null, v_auth, p_device_id);

  -- R40: Money's other direct push call. Never fails the write.
  begin
    perform app.lesson_notify(v_s.id, 'coach.statement_paid',
                              'l:' || v_s.id::text || ':coach.statement_paid', '{}'::jsonb);
  exception when others then
    raise warning 'coach_statement_mark_paid: push left out: % (%)', sqlerrm, sqlstate;
  end;

  return jsonb_build_object('duplicate', false, 'statement_id', v_s.id, 'status', 'paid',
                            'paid_at', v_at, 'total_iqd', v_s.coach_iqd + v_s.adjustments_iqd);
end $coach_statement_mark_paid_0287$;

comment on function app.coach_statement_mark_paid(uuid, text, text, text) is
  '0287 (money.md §7.4; C-12, R4, R49, R59, R74). Manager or owner at the statement''s branch, the rail''s (R21), never their own (CM-11), with a manager PIN grant (p_pin is never read: the transports prove it to verify_manager_pin first, 0115). An approved statement whose total (coach_iqd + adjustments_iqd) is not negative becomes paid with p_reference (a receipt or transfer number, 1..80, never a run of 12 digits). The money is handed over outside the till: no payments, refunds or booking_payments row. Audit coach.statement_paid {statement_id, coach_id, month, status} with the authorising manager (no amount, no reference, C-28); the coach is told coach.statement_paid. Already paid answers {duplicate: true, paid_reference} before any grant is spent. Returns {duplicate, statement_id, status: paid, paid_at, total_iqd}. FORBIDDEN (detail own_statement), STATEMENT_REFERENCE_REQUIRED, INVALID_ARGUMENT (p_reference hint digits; p_statement_id), VENUE_MISMATCH, STATEMENT_NOT_APPROVED (detail the status, or negative), PIN_GRANT_REQUIRED.';

revoke all on function app.coach_statement_mark_paid(uuid, text, text, text) from public, anon;
grant execute on function app.coach_statement_mark_paid(uuid, text, text, text) to authenticated;

-- ===========================================================================
-- 7. The reads (money.md §7.5; key lists in packages/core/src/coaching/shapes.ts)
-- ===========================================================================

-- X22. A person-money report (C-28, R42): scanned by SEC-29 for guest
-- identity, exempt from the coach patterns, never an assistant tool. Coach
-- display names only (public, §1.2; a deleted coach's stay, C-29); staff
-- display names for who approved and paid. Every branch in the report scope
-- (R21: "All branches" lists both; writes stay on the rail's branch).
create or replace function app.report_coach_statements(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $report_coach_statements_0287$
declare
  v_rv      uuid[] := app.report_venues();
  v_tz      text;
  v_now     date;
  v_month   date;
  v_rows    jsonb;
  v_missing jsonb;
  v_totals  jsonb;
begin
  perform app.reports_guard(false);
  v_tz    := coalesce((select v.timezone from venues v where v.id = app.analysis_venue()), 'Asia/Baghdad');
  v_now   := date_trunc('month', (now() at time zone v_tz)::date)::date;
  v_month := coalesce(date_trunc('month', p_month)::date, (v_now - interval '1 month')::date);

  select coalesce(jsonb_agg(jsonb_build_object(
           'statement_id',     s.id,
           'coach_id',         s.coach_id,
           'coach_name_en',    c.display_name_en,
           'coach_name_ar',    c.display_name_ar,
           'venue_id',         s.venue_id,
           'venue_name_en',    v.name_en,
           'venue_name_ar',    v.name_ar,
           'month',            s.month,
           'status',           s.status,
           'lessons_count',    s.lessons_count,
           'collected_iqd',    s.collected_iqd,
           'court_share_iqd',  s.court_share_iqd,
           'coach_iqd',        s.coach_iqd,
           'adjustments_iqd',  s.adjustments_iqd,
           'total_iqd',        s.coach_iqd + s.adjustments_iqd,
           'payable_iqd',      s.coach_iqd + s.adjustments_iqd,
           'drafted_at',       s.drafted_at,
           'refreshed_at',     s.refreshed_at,
           'approved_at',      s.approved_at,
           'approved_by_name', ab.display_name,
           'paid_at',          s.paid_at,
           'paid_by_name',     pb.display_name,
           'paid_reference',   s.paid_reference,
           'voided_at',        s.voided_at,
           'void_reason',      s.void_reason)
           order by v.name_en, c.display_name_en, s.drafted_at), '[]'::jsonb),
         jsonb_build_object(
           'statements',          count(*) filter (where s.status <> 'void'),
           'collected_iqd',       coalesce(sum(s.collected_iqd)   filter (where s.status <> 'void'), 0)::bigint,
           'court_share_iqd',     coalesce(sum(s.court_share_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'coach_iqd',           coalesce(sum(s.coach_iqd)       filter (where s.status <> 'void'), 0)::bigint,
           'adjustments_iqd',     coalesce(sum(s.adjustments_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'total_iqd',           coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'payable_iqd',         coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status <> 'void'), 0)::bigint,
           'approved_unpaid_iqd', coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status = 'approved'), 0)::bigint,
           'unpaid_iqd',          coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status = 'approved'), 0)::bigint,
           'paid_iqd',            coalesce(sum(s.coach_iqd + s.adjustments_iqd) filter (where s.status = 'paid'), 0)::bigint)
    into v_rows, v_totals
    from coach_statements s
    join coaches c on c.id = s.coach_id
    join venues v on v.id = s.venue_id
    left join staff ab on ab.id = s.approved_by
    left join staff pb on pb.id = s.paid_by
   where s.venue_id = any (v_rv) and s.month = v_month;

  -- Pairs with statement lessons in the month and no live statement: blocked
  -- by a live draft of another month (CM-8), or the month not drafted yet.
  with pairs as (
    select sl.coach_id, sl.venue_id
      from unnest(v_rv) as rv(vid)
      join venues v on v.id = rv.vid
      cross join lateral app.coach_statement_lessons(
                   array[rv.vid],
                   v_month::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   ((v_month + interval '1 month')::date)::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   null) sl
     group by sl.coach_id, sl.venue_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'coach_id',      p.coach_id,
           'coach_name_en', c.display_name_en,
           'coach_name_ar', c.display_name_ar,
           'venue_id',      p.venue_id,
           'reason',        case when exists (select 1 from coach_statements s2
                                               where s2.coach_id = p.coach_id and s2.venue_id = p.venue_id
                                                 and s2.status = 'draft' and s2.month <> v_month)
                                 then 'older_draft' else 'not_drafted' end)
           order by c.display_name_en, p.venue_id), '[]'::jsonb)
    into v_missing
    from pairs p
    join coaches c on c.id = p.coach_id
   where not exists (select 1 from coach_statements s3
                      where s3.coach_id = p.coach_id and s3.venue_id = p.venue_id
                        and s3.month = v_month and s3.status <> 'void');

  return jsonb_build_object(
    'month',         v_month,
    'current_month', v_now,
    'server_now',    now(),
    'statements',    v_rows,
    'missing',       v_missing,
    'totals',        v_totals);
end $report_coach_statements_0287$;

comment on function app.report_coach_statements(date) is
  '0287 (money.md §7.5, X22; C-12, C-28, R21, R42). Manager or owner (reports_guard): the coach statements of month p_month (default the previous month in the analysed branch''s time zone) at every branch in the report scope, void ones listed and left out of the totals. {month, current_month, server_now, statements [{statement_id, coach_id, coach_name_en, coach_name_ar, venue_id, venue_name_en, venue_name_ar, month, status, lessons_count, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, payable_iqd (= coach_iqd + adjustments_iqd), drafted_at, refreshed_at, approved_at, approved_by_name, paid_at, paid_by_name, paid_reference, voided_at, void_reason}], missing [{coach_id, coach_name_en, coach_name_ar, venue_id, reason: older_draft | not_drafted}], totals {statements, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, payable_iqd, approved_unpaid_iqd, unpaid_iqd, paid_iqd}}. A person-money report: coach display names, never a guest; never an assistant tool (R42). FORBIDDEN.';

revoke all on function app.report_coach_statements(date) from public, anon;
grant execute on function app.report_coach_statements(date) to authenticated;

-- X23, R72, R81. The statement's branch must be the rail's (R21). The can
-- flags follow §7.4 and are all false on the caller's own statement (CM-11).
-- coach_booked_no_shows (C-24, R56, R72): every no-show mark on a
-- coach-booked enrolment of the statement's lessons, with the typed label the
-- coach entered (R44), so the manager sees hoarding on the pay screen.
create or replace function app.coach_statement_detail(p_statement_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $coach_statement_detail_0287$
declare
  v_s        coach_statements%rowtype;
  v_rail     uuid;
  v_own      boolean;
  v_total    bigint;
  v_stale    boolean := false;
  v_free     boolean;
  v_row      jsonb;
  v_lines    jsonb;
  v_noshows  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_s from coach_statements where id = p_statement_id;
  if not found or not (v_s.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_statement_id';
  end if;
  begin
    v_rail := app.current_venue();
  exception when sqlstate 'P0001' then
    v_rail := null;
  end;
  if v_rail is distinct from v_s.venue_id or not app.is_staff_at(v_s.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  v_own   := exists (select 1 from coaches c where c.id = v_s.coach_id and c.profile_id = auth.uid());
  v_total := v_s.coach_iqd + v_s.adjustments_iqd;

  -- stale (a draft only): a rebuild now would change a line.
  if v_s.status = 'draft' then
    v_stale := coalesce((select jsonb_agg(x order by x ->> 'lesson_id')
                           from jsonb_array_elements(app.coach_statement_plan(v_s.coach_id, v_s.venue_id, v_s.month)) x), '[]'::jsonb)
               is distinct from
               coalesce((select jsonb_agg(jsonb_build_object(
                                  'lesson_id',       ln.lesson_id,
                                  'collected_iqd',   ln.collected_iqd::bigint,
                                  'court_share_iqd', ln.court_share_iqd::bigint,
                                  'share_bp',        ln.share_bp,
                                  'coach_iqd',       ln.coach_iqd::bigint,
                                  'is_adjustment',   ln.is_adjustment) order by ln.lesson_id::text)
                           from coach_statement_lines ln where ln.statement_id = v_s.id), '[]'::jsonb);
  end if;

  -- A void month can be redrafted only when nothing live stands in its way.
  v_free := not exists (select 1 from coach_statements s
                         where s.coach_id = v_s.coach_id and s.venue_id = v_s.venue_id and s.status <> 'void'
                           and (s.month = v_s.month or s.status = 'draft'));

  select jsonb_build_object(
           'statement_id',     v_s.id,
           'coach_id',         v_s.coach_id,
           'coach_name_en',    c.display_name_en,
           'coach_name_ar',    c.display_name_ar,
           'venue_id',         v_s.venue_id,
           'venue_name_en',    v.name_en,
           'venue_name_ar',    v.name_ar,
           'month',            v_s.month,
           'status',           v_s.status,
           'lessons_count',    v_s.lessons_count,
           'collected_iqd',    v_s.collected_iqd,
           'court_share_iqd',  v_s.court_share_iqd,
           'coach_iqd',        v_s.coach_iqd,
           'adjustments_iqd',  v_s.adjustments_iqd,
           'total_iqd',        v_total,
           'payable_iqd',      v_total,
           'drafted_at',       v_s.drafted_at,
           'refreshed_at',     v_s.refreshed_at,
           'approved_at',      v_s.approved_at,
           'approved_by_name', (select st.display_name from staff st where st.id = v_s.approved_by),
           'paid_at',          v_s.paid_at,
           'paid_by_name',     (select st.display_name from staff st where st.id = v_s.paid_by),
           'paid_reference',   v_s.paid_reference,
           'voided_at',        v_s.voided_at,
           'void_reason',      v_s.void_reason)
    into v_row
    from coaches c, venues v
   where c.id = v_s.coach_id and v.id = v_s.venue_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id',         ln.id,
           'lesson_id',       ln.lesson_id,
           'start_at',        l.start_at,
           'kind',            l.kind,
           'type_name_en',    lt.name_en,
           'type_name_ar',    lt.name_ar,
           'course_id',       l.course_id,
           'course_title_en', co.title_en,
           'course_title_ar', co.title_ar,
           'session_no',      l.session_no,
           'lesson_status',   l.status,
           'is_adjustment',   ln.is_adjustment,
           'collected_iqd',   ln.collected_iqd,
           'court_share_iqd', ln.court_share_iqd,
           'share_bp',        ln.share_bp,
           'coach_iqd',       ln.coach_iqd,
           'enrolments',      (select count(*) from lesson_enrolments e
                                where e.status = 'booked'
                                  and (e.lesson_id = l.id
                                       or (e.course_id = l.course_id
                                           and l.session_no between e.first_session_no
                                                                and e.first_session_no + e.sessions_covered - 1))),
           'attended',        (select count(*) from lesson_attendance a
                                where a.lesson_id = l.id and a.status = 'attended'),
           'no_shows',        (select count(*) from lesson_attendance a
                                where a.lesson_id = l.id and a.status = 'no_show'))
           order by ln.is_adjustment, l.start_at, ln.lesson_id), '[]'::jsonb)
    into v_lines
    from coach_statement_lines ln
    join lessons l on l.id = ln.lesson_id
    join lesson_types lt on lt.id = l.lesson_type_id
    left join courses co on co.id = l.course_id
   where ln.statement_id = v_s.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_id',     a.lesson_id,
           'start_at',      l.start_at,
           'student_label', e.guest_name)
           order by l.start_at, a.lesson_id, e.id), '[]'::jsonb)
    into v_noshows
    from lesson_attendance a
    join lesson_enrolments e on e.id = a.enrolment_id and e.booked_by_kind = 'coach'
    join lessons l on l.id = a.lesson_id
   where a.status = 'no_show'
     and a.lesson_id in (select ln.lesson_id from coach_statement_lines ln where ln.statement_id = v_s.id);

  return jsonb_build_object(
    'statement',             v_row,
    'stale',                 v_stale,
    'can',                   jsonb_build_object(
                               'refresh',   not v_own and (v_s.status = 'draft' or (v_s.status = 'void' and v_free)),
                               'approve',   not v_own and v_s.status = 'draft',
                               'void',      not v_own and v_s.status in ('draft', 'approved'),
                               'mark_paid', not v_own and v_s.status = 'approved' and v_total >= 0),
    'coach_booked_no_shows', v_noshows,
    'lines',                 v_lines);
end $coach_statement_detail_0287$;

comment on function app.coach_statement_detail(uuid) is
  '0287 (money.md §7.5, X23; C-24, R21, R56, R72, R81). Manager or owner at the statement''s branch, the rail''s (R21). {statement (the report_coach_statements row), stale (a draft only: a rebuild now would change a line), can {refresh, approve, void, mark_paid} (all false on the caller''s own statement, CM-11; mark_paid needs a non-negative total), coach_booked_no_shows [{lesson_id, start_at, student_label}] (no-show marks on coach-booked enrolments of its lessons, the label the coach typed, R44), lines [{line_id, lesson_id, start_at, kind, type_name_en, type_name_ar, course_id, course_title_en, course_title_ar, session_no, lesson_status, is_adjustment, collected_iqd, court_share_iqd, share_bp, coach_iqd, enrolments, attended, no_shows}] regular lines first, by start}. Never a phone, a guest id or a profile. FORBIDDEN, INVALID_ARGUMENT p_statement_id, VENUE_MISMATCH.';

revoke all on function app.coach_statement_detail(uuid) from public, anon;
grant execute on function app.coach_statement_detail(uuid) to authenticated;

-- X12 (guest.md §4.3 with money.md §7.5; R45, R70). The coach guard admits a
-- retired coach (app.coach_of_caller, never app.coach_self): a retired coach
-- sees approved and paid statements and nothing else (C-25). Drafts and voids
-- are never sent (CM-12). p_month NULL: the summaries of the last 12 months
-- with an approved or paid statement, no lines; a month: that month's
-- statements at every branch, with their lines (shapes.ts: lines optional).
create or replace function app.my_coach_statements(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_coach_statements_0287$
declare
  v_uid     uuid := auth.uid();
  v_coach   coaches%rowtype;
  v_months  date[];
  v_month   date;
  v_stmts   jsonb;
  v_current jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = v_uid and p.deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  v_coach := app.coach_of_caller();
  if v_coach.id is null then
    raise exception 'NOT_A_COACH' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(m order by m desc), '{}'::date[]) into v_months
    from (select distinct s.month as m
            from coach_statements s
           where s.coach_id = v_coach.id and s.status in ('approved', 'paid')
           order by 1 desc
           limit 12) x;

  v_month := date_trunc('month', p_month)::date;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',              s.id,
             'venue_id',        s.venue_id,
             'venue_name_en',   v.name_en,
             'venue_name_ar',   v.name_ar,
             'month',           s.month,
             'status',          s.status,
             'lessons_count',   s.lessons_count,
             'collected_iqd',   s.collected_iqd,
             'court_share_iqd', s.court_share_iqd,
             'coach_iqd',       s.coach_iqd,
             'adjustments_iqd', s.adjustments_iqd,
             'total_iqd',       s.coach_iqd + s.adjustments_iqd,
             'share_bp',        (select case when count(distinct ln.share_bp) = 1 then min(ln.share_bp) end
                                   from coach_statement_lines ln
                                  where ln.statement_id = s.id and not ln.is_adjustment),
             'approved_at',     s.approved_at,
             'paid_at',         s.paid_at,
             'paid_reference',  s.paid_reference)
           || case when v_month is null then '{}'::jsonb else jsonb_build_object('lines',
                (select coalesce(jsonb_agg(jsonb_build_object(
                          'lesson_id',       ln.lesson_id,
                          'start_at',        l.start_at,
                          'kind',            l.kind,
                          'type_name_en',    lt.name_en,
                          'type_name_ar',    lt.name_ar,
                          'collected_iqd',   ln.collected_iqd,
                          'court_share_iqd', ln.court_share_iqd,
                          'share_bp',        ln.share_bp,
                          'coach_iqd',       ln.coach_iqd,
                          'is_adjustment',   ln.is_adjustment)
                          order by ln.is_adjustment, l.start_at, ln.lesson_id), '[]'::jsonb)
                   from coach_statement_lines ln
                   join lessons l on l.id = ln.lesson_id
                   join lesson_types lt on lt.id = l.lesson_type_id
                  where ln.statement_id = s.id)) end
           order by s.month desc, v.name_en), '[]'::jsonb)
    into v_stmts
    from coach_statements s
    join venues v on v.id = s.venue_id
   where s.coach_id = v_coach.id
     and s.status in ('approved', 'paid')
     and (case when v_month is null then s.month = any (v_months) else s.month = v_month end);

  -- This month so far, per branch, with today's math: an estimate, not a
  -- statement. Empty for a retired coach (C-25).
  if v_coach.status = 'retired' then
    v_current := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'venue_id',      b.venue_id,
             'estimate',      true,
             'lessons',       coalesce(f.lessons, 0),
             'collected_iqd', coalesce(f.collected, 0),
             'coach_iqd',     coalesce(f.coach, 0))
             order by b.venue_id), '[]'::jsonb)
      into v_current
      from (select cb.venue_id, coalesce(v.timezone, 'Asia/Baghdad') as tz
              from coach_branches cb
              join venues v on v.id = cb.venue_id
             where cb.coach_id = v_coach.id and cb.active) b
      cross join lateral (
        select count(*)::int as lessons, sum(sl.collected_iqd)::bigint as collected, sum(sl.coach_iqd)::bigint as coach
          from app.coach_statement_lessons(
                 array[b.venue_id],
                 (date_trunc('month', (now() at time zone b.tz)::date)::date)::timestamp at time zone b.tz,
                 now(), v_coach.id) sl) f;
  end if;

  return jsonb_build_object(
    'months',        to_jsonb(v_months),
    'statements',    v_stmts,
    'current_month', v_current);
end $my_coach_statements_0287$;

comment on function app.my_coach_statements(date) is
  '0287 (money.md §7.5, guest.md §4.3, X12; C-25, CM-12, R45, R70). Coach (any status, a retired one included: app.coach_of_caller): {months (the last 12 months with an approved or paid statement, newest first), statements [{id, venue_id, venue_name_en, venue_name_ar, month, status (approved | paid), lessons_count, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, share_bp (the regular lines'' share when they agree, else NULL), approved_at, paid_at, paid_reference, lines?}], current_month [{venue_id, estimate: true, lessons, collected_iqd, coach_iqd}]}. p_month NULL: the statements of those months, no lines; a month: that month''s statements at every branch with their lines [{lesson_id, start_at, kind, type_name_en, type_name_ar, collected_iqd, court_share_iqd, share_bp, coach_iqd, is_adjustment}]. Drafts and voids are never sent; current_month is this month so far at each active branch (empty for a retired coach). Never a student. AUTH_REQUIRED, ACCOUNT_REQUIRED, NOT_A_COACH.';

revoke all on function app.my_coach_statements(date) from public, anon;
grant execute on function app.my_coach_statements(date) to authenticated;

-- ===========================================================================
-- 8. tp_coach_statements: '0 0 1 * *' UTC, 03:00 on the 1st in Baghdad: the
--    previous local month is over everywhere the chain trades east of UTC.
--    After a hosted push, cron.job must have the row (packages/db/CLAUDE.md).
-- ===========================================================================
do $coach_statements_cron_0287$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_coach_statements not scheduled';
    return;
  end if;
  perform cron.schedule('tp_coach_statements', '0 0 1 * *', 'call app.coach_statements_draft(null);');
end $coach_statements_cron_0287$;
