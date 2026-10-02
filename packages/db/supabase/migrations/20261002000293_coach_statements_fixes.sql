set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0293 coach_statements_fixes — the coaching post-build review, coach
-- statements (plan "Coaching: make it bulletproof" §1, items DB-21 to DB-26;
-- decision D6). 0273–0289 are not edited: every function below is re-issued
-- from its latest body (0287, 0281), verbatim except for the change named;
-- dollar tags _0293.
--
--   DB-21   New immutable app.looks_like_card(text): true when the text,
--           once Arabic-Indic (U+0660..0669) and Extended Arabic-Indic
--           (U+06F0..06F9) digits read as 0-9 and spaces, dots and dashes
--           (hyphen-minus, U+2010..2015, U+2212) are removed, holds a run of
--           12 or more digits. R74 amended (§1.15 D6). It backs the CHECK
--           coach_statements_no_card (dropped and re-added NOT VALID, every
--           existing row checked, then validated) and the card guards of
--           app.coach_statement_void (0287:556), app.coach_statement_mark_paid
--           (0287:658) and app.lesson_blocked_refund_record (0281:2274), each
--           run on the text app.safe_line returns.
--   DB-22   CM-11 amended (§1.15 D6): after each app.consume_pin_grant in the
--           void and mark paid, a grant authorised by the statement coach's
--           own profile is FORBIDDEN detail own_statement_pin. The raise
--           rolls the call back, so the grant is not spent.
--   DB-23   app.lesson_blocked_refund_record takes a required
--           p_idempotency_key (the 5-argument version is dropped): the claim
--           (app.claim_replay) comes before the PIN grant, so a replay
--           answers the stored result with duplicate true and spends no
--           grant; app.finish_replay stores the answer. R75's signature is
--           now (p_enrolment_id, p_amount_iqd, p_reference, p_pin,
--           p_idempotency_key, p_device_id).
--   DB-24   app.report_coach_statements (0287:768): a missing pair blocked by
--           another month's live draft says older_draft when that month is
--           before the report's, newer_draft when after, with
--           blocking_month and blocking_statement_id (both NULL for
--           not_drafted).
--   DB-25   The same report keeps a missing pair only while some statement
--           lesson of the month has no line on a statement that is not void
--           (a voided month settled as adjustments on a later statement is
--           no longer "not drafted"), and app.coach_statement_detail
--           (0287:880) offers Redraft on a void statement only when a draft
--           of its month would hold a line (app.coach_statement_plan is not
--           empty).
--   DB-26   tp_coach_statements moves to '0 12 1 * *' UTC: at noon UTC on the
--           1st every zone from UTC-12 to UTC+14 is on local day 1 or 2, so
--           the run drafts the previous local month everywhere. The
--           procedure's comment says so.
--
-- Locks: unchanged. The void and mark paid still spend the grant (unranked)
-- before the coach mutex; the blocked refund claims its key in
-- app.rpc_replays (unranked, as app.refund does) before the grant and the
-- coach mutex. No new error code (FORBIDDEN and INVALID_ARGUMENT details
-- only).

-- ===========================================================================
-- DB-21: app.looks_like_card (new) and the CHECK it backs
-- ===========================================================================

-- R49, R74 (amended): a card or account number never lands in a free-text
-- field. Western, Arabic-Indic and Extended Arabic-Indic digits all count;
-- spaces, dots and every dash are ignored. Pure text: no table read, never
-- raises. A CHECK runs it as the writing role: coach_statements is written
-- by SECURITY DEFINER bodies (postgres) and by service_role (fixtures), never
-- by a client role (no INSERT or UPDATE grant), so it is granted to
-- service_role only.
create or replace function app.looks_like_card(p_text text) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $looks_like_card_0293$
  select regexp_replace(translate(coalesce(p_text, ''),
                                  '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
                        '[[:space:].‐-―−-]', '', 'g') ~ '[0-9]{12}'
$looks_like_card_0293$;

comment on function app.looks_like_card(text) is
  '0293 (DB-21; R49, R74 amended). Internal, immutable. True when p_text, with Arabic-Indic and Extended Arabic-Indic digits read as 0-9 and spaces, dots and dashes (hyphen-minus, U+2010..2015, U+2212) removed, holds a run of 12 or more digits: a card or account number. Backs coach_statements_no_card and the card guards of coach_statement_void, coach_statement_mark_paid and lesson_blocked_refund_record. NULL reads as empty (false).';

revoke all on function app.looks_like_card(text) from public, anon, authenticated;
grant execute on function app.looks_like_card(text) to service_role;

alter table coach_statements drop constraint if exists coach_statements_no_card;
alter table coach_statements
  add constraint coach_statements_no_card
  check (not app.looks_like_card(paid_reference) and not app.looks_like_card(void_reason))
  not valid;

-- Every existing row is checked before the validate: a row the wider guard now
-- refuses stops the migration with its count, never a half-applied rule.
do $validate_no_card_0293$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from coach_statements s
   where app.looks_like_card(s.paid_reference) or app.looks_like_card(s.void_reason);
  if v_bad > 0 then
    raise exception 'coach_statements_no_card: % existing statement(s) hold a card-like reference or reason; fix them before 0293', v_bad;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'coach_statements_no_card'
                and conrelid = 'public.coach_statements'::regclass
                and not convalidated) then
    alter table coach_statements validate constraint coach_statements_no_card;
  end if;
end $validate_no_card_0293$;

-- ===========================================================================
-- DB-21, DB-22: app.coach_statement_void and app.coach_statement_mark_paid
--   (0287:556, 0287:658)
-- ===========================================================================

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
language plpgsql security definer set search_path = public as $coach_statement_void_0293$
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
  -- R49, R74 (amended, DB-21): never a card or account number (a run of 12
  -- digits of any of the three scripts once spaces, dots and dashes are
  -- removed; coach_statements_no_card backs it).
  if app.looks_like_card(v_reason) then
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
    -- CM-11 (amended, DB-22): the coach's own PIN never authorises their
    -- statement. The raise rolls back, so the grant is not spent.
    if v_auth = (select c.profile_id from coaches c where c.id = v_s.coach_id) then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement_pin';
    end if;
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
    -- CM-11 (amended, DB-22), as above.
    if v_auth = (select c.profile_id from coaches c where c.id = v_s.coach_id) then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement_pin';
    end if;
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
end $coach_statement_void_0293$;

comment on function app.coach_statement_void(uuid, text, text, text) is
  '0287, 0293 (money.md §7.4; CM-10, CM-11, R49, R59, R70, R74). Manager or owner at the statement''s branch, the rail''s (R21), never their own (CM-11) and never with a PIN of the statement''s coach (0293, DB-22). A draft or approved statement becomes void (voided_by, voided_at, void_reason 1..200, never card-like: app.looks_like_card, 0293); its lessons then have no booked line, so the next draft carries them as adjustments (a voided negative month is how a clawback is carried forward). From approved it spends a manager PIN grant (p_pin is never read: the transports prove it to verify_manager_pin first); from draft no PIN. An already void statement answers {duplicate: true} and a paid one INVALID_TRANSITION detail paid, both before any grant is spent. Audit coach.statement_voided {statement_id, coach_id, month, from_status, status} with the authorising manager (no amount and no reason, C-28). No push. Returns {duplicate, statement_id, status: void, voided_at}. FORBIDDEN (detail own_statement; own_statement_pin, the grant left unspent), REASON_REQUIRED, INVALID_ARGUMENT (p_reason hint length or digits; p_statement_id), VENUE_MISMATCH, INVALID_TRANSITION paid, PIN_GRANT_REQUIRED.';

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
language plpgsql security definer set search_path = public as $coach_statement_mark_paid_0293$
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
  -- R49, R74 (amended, DB-21): a receipt or transfer number, never a card or
  -- account number, whatever its digits or separators.
  if app.looks_like_card(v_ref) then
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
  -- CM-11 (amended, DB-22): the coach's own PIN never authorises their
  -- statement. The raise rolls back, so the grant is not spent.
  if v_auth = (select c.profile_id from coaches c where c.id = v_s.coach_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement_pin';
  end if;

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
end $coach_statement_mark_paid_0293$;

comment on function app.coach_statement_mark_paid(uuid, text, text, text) is
  '0287, 0293 (money.md §7.4; C-12, CM-11, R4, R49, R59, R74). Manager or owner at the statement''s branch, the rail''s (R21), never their own (CM-11), with a manager PIN grant that is not the statement''s coach''s own (0293, DB-22) (p_pin is never read: the transports prove it to verify_manager_pin first, 0115). An approved statement whose total (coach_iqd + adjustments_iqd) is not negative becomes paid with p_reference (a receipt or transfer number, 1..80, never card-like: app.looks_like_card, 0293). The money is handed over outside the till: no payments, refunds or booking_payments row. Audit coach.statement_paid {statement_id, coach_id, month, status} with the authorising manager (no amount, no reference, C-28); the coach is told coach.statement_paid. Already paid answers {duplicate: true, paid_reference} before any grant is spent. Returns {duplicate, statement_id, status: paid, paid_at, total_iqd}. FORBIDDEN (detail own_statement; own_statement_pin, the grant left unspent), STATEMENT_REFERENCE_REQUIRED, INVALID_ARGUMENT (p_reference hint digits; p_statement_id), VENUE_MISMATCH, STATEMENT_NOT_APPROVED (detail the status, or negative), PIN_GRANT_REQUIRED.';

revoke all on function app.coach_statement_mark_paid(uuid, text, text, text) from public, anon;
grant execute on function app.coach_statement_mark_paid(uuid, text, text, text) to authenticated;

-- ===========================================================================
-- DB-21, DB-23: app.lesson_blocked_refund_record (0281:2274), keyed
-- ===========================================================================

drop function if exists app.lesson_blocked_refund_record(uuid, bigint, text, text, text);

-- R75: a refund Qi cannot take. When a share is owed back on an online payment
-- that already had its one refund (a late course leave, then a venue cancel of
-- the session it kept, C-23 × CM-5), lesson_refunds_due lists it as
-- online_blocked_iqd and the money is handed back outside the till. A manager
-- records the handback here, behind a manager PIN (the 0115 grant, spent by
-- consume_pin_grant; PIN_GATED_RPCS): it is stored in
-- lesson_enrolments.refunded_outside_iqd, which the engine and the statements
-- count as refunded, and is never a payments or refunds row. At most what is
-- blocked now (REFUND_EXCEEDS_DUE); the reference is a receipt or transfer
-- number, never a card or account number (R49, R74 amended: app.looks_like_card,
-- on the text app.safe_line returns). 0293 (DB-23): p_idempotency_key is
-- required and claimed before the grant, so a lost answer retried with the
-- same key adds nothing twice and spends no second grant.
create or replace function app.lesson_blocked_refund_record(
  p_enrolment_id    uuid,
  p_amount_iqd      bigint,
  p_reference       text,
  p_pin             text,
  p_idempotency_key text,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $lesson_blocked_refund_record_0293$
declare
  v_e       lesson_enrolments%rowtype;
  v_ref     text := nullif(btrim(app.safe_line(p_reference)), '');
  v_auth    uuid;
  v_coach   uuid;
  v_m       jsonb;
  v_blocked bigint;
  v_replay  jsonb;
  v_result  jsonb;
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
  if app.looks_like_card(v_ref) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reference', hint = 'digits';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if not found or not (v_e.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_e.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_e.venue_id::text, true);

  -- 0293 (DB-23): claim after the guards and before the grant (0049 pattern).
  -- A replay of the same key by the same caller answers the stored result
  -- with duplicate true and spends no grant; a failure below rolls the claim
  -- back with everything else.
  v_replay := app.claim_replay(p_idempotency_key, 'lesson_blocked_refund_record');
  if v_replay is not null then
    return v_replay;
  end if;

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
  v_result := jsonb_build_object(
    'duplicate',            false,
    'enrolment_id',         v_e.id,
    'amount_iqd',           p_amount_iqd,
    'refunded_outside_iqd', v_e.refunded_outside_iqd::bigint,
    'online_blocked_iqd',   coalesce((v_m->>'refund_blocked_iqd')::bigint, 0));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $lesson_blocked_refund_record_0293$;

comment on function app.lesson_blocked_refund_record(uuid, bigint, text, text, text, text) is
  '0281, 0293 (R75, DB-21, DB-23). Manager or owner at the enrolment''s branch, behind a manager PIN grant (PIN_GATED_RPCS): records p_amount_iqd of online lesson money handed back outside the till because its payment already had its one Qi refund. Adds to lesson_enrolments.refunded_outside_iqd (counted as refunded by the engine and the statements; never a payments or refunds row), under the coach mutex, at most the engine''s refund_blocked_iqd. p_idempotency_key (required) is claimed before the grant: a replay of the same key by the same caller answers the stored result with duplicate true and spends no grant (app.claim_replay; another caller''s key is IDEMPOTENCY_CONFLICT). Refusals in order: FORBIDDEN; INVALID_ARGUMENT (detail p_enrolment_id, p_amount_iqd >= 1, p_reference 1..80, p_reference hint digits when app.looks_like_card, R49/R74, p_idempotency_key); ENROLMENT_NOT_FOUND; VENUE_MISMATCH; IDEMPOTENCY_CONFLICT; PIN_GRANT_REQUIRED; REFUND_EXCEEDS_DUE (detail due <n>). Writes a lesson_events row refunded (code outside) and the audit lesson.refund_outside with the reference. Returns {duplicate, enrolment_id, amount_iqd, refunded_outside_iqd, online_blocked_iqd}.';

revoke all on function app.lesson_blocked_refund_record(uuid, bigint, text, text, text, text) from public, anon;
grant execute on function app.lesson_blocked_refund_record(uuid, bigint, text, text, text, text) to authenticated;

-- ===========================================================================
-- DB-24, DB-25: app.report_coach_statements and app.coach_statement_detail
--   (0287:768, 0287:880)
-- ===========================================================================


-- X22. A person-money report (C-28, R42): scanned by SEC-29 for guest
-- identity, exempt from the coach patterns, never an assistant tool. Coach
-- display names only (public, §1.2; a deleted coach's stay, C-29); staff
-- display names for who approved and paid. Every branch in the report scope
-- (R21: "All branches" lists both; writes stay on the rail's branch).
create or replace function app.report_coach_statements(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $report_coach_statements_0293$
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
  -- 0293 (DB-25): a pair is kept only while one of those lessons has no line
  -- on a statement that is not void (a voided month whose lessons a later
  -- statement settled as adjustments waits for nothing). 0293 (DB-24): the
  -- blocking draft is older_draft when its month is before this one,
  -- newer_draft when after, and named (blocking_month, blocking_statement_id).
  with pairs as (
    select sl.coach_id, sl.venue_id
      from unnest(v_rv) as rv(vid)
      join venues v on v.id = rv.vid
      cross join lateral app.coach_statement_lessons(
                   array[rv.vid],
                   v_month::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   ((v_month + interval '1 month')::date)::timestamp at time zone coalesce(v.timezone, 'Asia/Baghdad'),
                   null) sl
     where not exists (select 1
                         from coach_statement_lines ln
                         join coach_statements s4 on s4.id = ln.statement_id and s4.status <> 'void'
                        where ln.lesson_id = sl.lesson_id)
     group by sl.coach_id, sl.venue_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'coach_id',              p.coach_id,
           'coach_name_en',         c.display_name_en,
           'coach_name_ar',         c.display_name_ar,
           'venue_id',              p.venue_id,
           'reason',                case when b.id is null then 'not_drafted'
                                         when b.month < v_month then 'older_draft'
                                         else 'newer_draft' end,
           'blocking_month',        b.month,
           'blocking_statement_id', b.id)
           order by c.display_name_en, p.venue_id), '[]'::jsonb)
    into v_missing
    from pairs p
    join coaches c on c.id = p.coach_id
    left join lateral (select s2.id, s2.month
                         from coach_statements s2
                        where s2.coach_id = p.coach_id and s2.venue_id = p.venue_id
                          and s2.status = 'draft' and s2.month <> v_month
                        order by s2.month
                        limit 1) b on true
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
end $report_coach_statements_0293$;

comment on function app.report_coach_statements(date) is
  '0287, 0293 (money.md §7.5, X22; C-12, C-28, R21, R42; DB-24, DB-25). Manager or owner (reports_guard): the coach statements of month p_month (default the previous month in the analysed branch''s time zone) at every branch in the report scope, void ones listed and left out of the totals. {month, current_month, server_now, statements [{statement_id, coach_id, coach_name_en, coach_name_ar, venue_id, venue_name_en, venue_name_ar, month, status, lessons_count, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, payable_iqd (= coach_iqd + adjustments_iqd), drafted_at, refreshed_at, approved_at, approved_by_name, paid_at, paid_by_name, paid_reference, voided_at, void_reason}], missing [{coach_id, coach_name_en, coach_name_ar, venue_id, reason: older_draft | newer_draft | not_drafted, blocking_month, blocking_statement_id}] (pairs with a statement lesson of the month on no statement that is not void and no live statement of the month; older_draft / newer_draft: the pair''s live draft of an earlier / later month stands in the way, named by blocking_month and blocking_statement_id, both NULL for not_drafted), totals {statements, collected_iqd, court_share_iqd, coach_iqd, adjustments_iqd, total_iqd, payable_iqd, approved_unpaid_iqd, unpaid_iqd, paid_iqd}}. A person-money report: coach display names, never a guest; never an assistant tool (R42). FORBIDDEN.';

revoke all on function app.report_coach_statements(date) from public, anon;
grant execute on function app.report_coach_statements(date) to authenticated;

-- X23, R72, R81. The statement's branch must be the rail's (R21). The can
-- flags follow §7.4 and are all false on the caller's own statement (CM-11).
-- coach_booked_no_shows (C-24, R56, R72): every no-show mark on a
-- coach-booked enrolment of the statement's lessons, with the typed label the
-- coach entered (R44), so the manager sees hoarding on the pay screen.
create or replace function app.coach_statement_detail(p_statement_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $coach_statement_detail_0293$
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

  -- A void month can be redrafted only when nothing live stands in its way,
  -- and (0293, DB-25) only when a draft of it would hold a line: lessons a
  -- later statement settled as adjustments leave nothing to redraft.
  v_free := not exists (select 1 from coach_statements s
                         where s.coach_id = v_s.coach_id and s.venue_id = v_s.venue_id and s.status <> 'void'
                           and (s.month = v_s.month or s.status = 'draft'));
  if v_s.status = 'void' and v_free then
    v_free := jsonb_array_length(app.coach_statement_plan(v_s.coach_id, v_s.venue_id, v_s.month)) > 0;
  end if;

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
end $coach_statement_detail_0293$;

comment on function app.coach_statement_detail(uuid) is
  '0287, 0293 (money.md §7.5, X23; C-24, R21, R56, R72, R81; DB-25). Manager or owner at the statement''s branch, the rail''s (R21). {statement (the report_coach_statements row), stale (a draft only: a rebuild now would change a line), can {refresh, approve, void, mark_paid} (all false on the caller''s own statement, CM-11; refresh on a void statement needs nothing live in its way and a draft of its month that would hold a line, 0293; mark_paid needs a non-negative total), coach_booked_no_shows [{lesson_id, start_at, student_label}] (no-show marks on coach-booked enrolments of its lessons, the label the coach typed, R44), lines [{line_id, lesson_id, start_at, kind, type_name_en, type_name_ar, course_id, course_title_en, course_title_ar, session_no, lesson_status, is_adjustment, collected_iqd, court_share_iqd, share_bp, coach_iqd, enrolments, attended, no_shows}] regular lines first, by start}. Never a phone, a guest id or a profile. FORBIDDEN, INVALID_ARGUMENT p_statement_id, VENUE_MISMATCH.';

revoke all on function app.coach_statement_detail(uuid) from public, anon;
grant execute on function app.coach_statement_detail(uuid) to authenticated;

-- ===========================================================================
-- DB-26: tp_coach_statements at noon UTC on the 1st
-- ===========================================================================

comment on procedure app.coach_statements_draft(date) is
  '0287 (money.md §7.3; R59, R70), 0293 (DB-26). The monthly statement run (cron tp_coach_statements, ''0 12 1 * *'' UTC: every zone from UTC-12 to UTC+14 is then on local day 1 or 2, so the previous local month is over everywhere). Security invoker with no SET clause (PostgreSQL refuses COMMIT otherwise): for every (coach, branch) pair, in (coach_id, venue_id) order, app.coach_statement_draft_one for p_month, else the branch''s previous local month, then COMMIT, so a booking for a coach is never held past that coach''s own build and a failing pair never undoes the others. Raises a notice with the drafts built or refreshed. Granted to no client role. No push: drafts are hidden from coaches (CM-12).';

-- 0287's '0 0 1 * *' was 03:00 on the 1st in Baghdad but still the last day
-- of the old month west of UTC, where the run drafted the month before it.
-- After a hosted push, cron.job must hold the new schedule
-- (packages/db/CLAUDE.md).
do $coach_statements_cron_0293$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_coach_statements not scheduled';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'tp_coach_statements';
  perform cron.schedule('tp_coach_statements', '0 12 1 * *', 'call app.coach_statements_draft(null);');
end $coach_statements_cron_0293$;
