-- 0272 deductions_owner_decides — only the owner approves a deduction, and an
-- approved one comes off the person's wage (0270, 0271).
--
-- Feature: wages (Parsa 2026-10-01: "the deduction … should be confirmed from
-- the owner's Management > Wages tab"; approval is owner only, managers and
-- heads propose). Supersedes 0197's "a manager or the owner decides" and its
-- "a record, not payroll".
-- Depends on: salary_deductions (0197), wages_rpcs (0271: lock_wage,
-- wage_open_month, wage_month_paid).
-- Re-runnable: drop … if exists + add NOT VALID + guarded VALIDATE,
-- create or replace.
--
-- WHAT CHANGES (every other rule of 0197 stands):
--   * app.decide_deduction: the owner only. A manager's approval is FORBIDDEN.
--   * app.propose_deduction: a waiting proposal tells the owner only. The
--     owner's own entry needs nobody else, so it is recorded approved at once
--     (status approved, decided by the owner at the moment it is proposed),
--     and the person is told as on any approval. salary_deductions_decider_chk
--     allows exactly that: the decider is the proposer only when decided_at
--     equals proposed_at.
--   * The pay month of an approval is the person's first unpaid month on or
--     after the business month it is approved in (V16, generalised): a month
--     the owner already paid is frozen.
--   * app.cancel_deduction: never in a paid month (WAGE_ALREADY_PAID).
--   * app.deductions_page: can_decide for the owner only; can_withdraw, the
--     waiting rows the caller proposed (a manager now sees proposals they can
--     neither decide nor withdraw); can_cancel needs an unpaid month.
--   * app.deductions_month: each person says whether the month's wage is paid.
-- Each re-issued body is 0197's verbatim but for those lines. The writes take
-- app.lock_wage before the deduction row's lock, as 0271's writes do.
--
-- covered by packages/db/tests/salary-deductions.test.ts and wages.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The owner's own entry is decided as it is proposed.
-- ---------------------------------------------------------------------------
alter table salary_deductions drop constraint if exists salary_deductions_decider_chk;
alter table salary_deductions
  add constraint salary_deductions_decider_chk
  check (decided_by is null
         or (decided_by <> staff_id
             and (decided_by <> proposed_by or decided_at = proposed_at)))
  not valid;

do $validate_decider_chk_0272$
begin
  if exists (select 1 from pg_constraint
              where conname = 'salary_deductions_decider_chk'
                and conrelid = 'public.salary_deductions'::regclass
                and not convalidated) then
    alter table salary_deductions validate constraint salary_deductions_decider_chk;
  end if;
end $validate_decider_chk_0272$;

comment on table salary_deductions is
  'salary_deductions (wave5-addendum §2.5, 0272): pay deductions a head proposes for a member of their team, or a manager for anyone at the venue, approved by the owner only; the owner''s own entry is recorded approved at once. An approved deduction comes off the person''s wage in its pay month (wages, 0270). Read by MGMT at the venue; the proposer and the person read through RPCs. Never readable by the owner assistant or any LLM.';
comment on column salary_deductions.pay_month is 'The person''s first unpaid pay month on or after the venue''s business month on the day it was approved (0272); set on approval and kept on a cancel, NULL otherwise.';
comment on column salary_deductions.decided_by is 'The owner who decided it: never the person, and the proposer only for the owner''s own entry, decided as it was proposed.';
comment on column salary_deductions.proposed_by is 'The head, manager or owner who proposed it.';

-- ---------------------------------------------------------------------------
-- 2. app.propose_deduction — 0197 but for: the owner is told, and the
--    owner's own entry is approved at once.
-- ---------------------------------------------------------------------------
create or replace function app.propose_deduction(
  p_staff_id        uuid,
  p_amount_iqd      bigint,
  p_date            date,
  p_reason          text,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $propose_deduction_0272$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_today  date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
  v_month  date;
  v_result jsonb;
begin
  if not app.is_staff('head_barista','head_chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'propose_deduction');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_amount_iqd is null or p_amount_iqd < 1 or p_amount_iqd > 2000000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;
  -- The venue's own day, not the server's: up to 60 days back, never ahead.
  v_today := app.venue_business_date(v_venue);
  if p_date is null or p_date > v_today or p_date < v_today - 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'date';
  end if;
  if v_reason is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'reason';
  end if;
  if length(v_reason) > 500 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;
  -- One list decides, the one the form shows.
  if p_staff_id is null
     or not exists (select 1
                      from jsonb_array_elements(app.deduction_targets(v_venue)->'staff') t
                     where (t->>'id')::uuid = p_staff_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'staff_id';
  end if;

  if app.is_staff('owner') then
    -- 0272: the owner approves, so the owner's own entry is approved as it is
    -- made, into the person's first unpaid month.
    perform app.lock_wage(v_venue, p_staff_id);
    v_month := app.wage_open_month(v_venue, p_staff_id, v_today);
    insert into salary_deductions (venue_id, staff_id, amount_iqd, deduction_date, reason, proposed_by,
                                   status, decided_by, decided_at, pay_month)
    values (v_venue, p_staff_id, p_amount_iqd, p_date, v_reason, auth.uid(),
            'approved', auth.uid(), now(), v_month)
    returning id into v_id;

    perform app.write_audit('staff.deduction.record', 'salary_deduction', v_id::text, null,
                            jsonb_build_object('status', 'approved'));

    perform app.notify_staff(
      array[p_staff_id],
      'staff_info',
      jsonb_build_object('route', 'staff', 'id', null, 'title_key', 'deduction_recorded',
                         'params', '{}'::jsonb));

    v_result := jsonb_build_object('id', v_id, 'status', 'approved', 'pay_month', v_month);
  else
    insert into salary_deductions (venue_id, staff_id, amount_iqd, deduction_date, reason, proposed_by)
    values (v_venue, p_staff_id, p_amount_iqd, p_date, v_reason, auth.uid())
    returning id into v_id;

    perform app.write_audit('staff.deduction.propose', 'salary_deduction', v_id::text, null,
                            jsonb_build_object('status', 'waiting'));

    -- 0272: the owner decides, so the owner is told.
    perform app.notify_staff(
      array_remove(app.staff_ids_with_roles(v_venue, array['owner']::staff_role[]), p_staff_id),
      'staff_decide',
      jsonb_build_object(
        'route', 'staff',
        'id', null,
        'title_key', 'deduction_proposed',
        'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()))),
      'deduction:' || auth.uid()::text);

    v_result := jsonb_build_object('id', v_id, 'status', 'waiting');
  end if;

  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $propose_deduction_0272$;

comment on function app.propose_deduction(uuid, bigint, date, text, uuid, text) is
  'salary_deductions (wave5-addendum §2.5.3, 0272). The heads and MGMT at the venue: proposes a deduction of 1 to 2,000,000 IQD, dated within the 60 days up to the venue''s business date, with a reason (1 to 500), for one of app.deduction_targets. Tells the owner (staff_decide / deduction_proposed, the proposer''s name only; dedupe deduction:<proposer>, 15 minutes) and returns {id, status: waiting}. The owner''s own entry is approved at once into the person''s first unpaid month, tells the person (staff_info / deduction_recorded, no amount) and returns {id, status: approved, pay_month}. Idempotent by key. FORBIDDEN (hint staff_id: not among the caller''s targets), INVALID_AMOUNT, INVALID_ARGUMENT (hint date), TEXT_REQUIRED, TEXT_TOO_LONG (hint reason). Audit staff.deduction.propose or staff.deduction.record {status}.';

revoke all on function app.propose_deduction(uuid, bigint, date, text, uuid, text) from public, anon;
grant execute on function app.propose_deduction(uuid, bigint, date, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.decide_deduction — 0197 but for: the owner only, and the pay month
--    is the person's first unpaid one.
-- ---------------------------------------------------------------------------
create or replace function app.decide_deduction(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_deduction_0272$
declare
  v_row   salary_deductions%rowtype;
  v_venue uuid;
  v_staff uuid;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- 0272: the owner decides.
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select d.venue_id, d.staff_id into v_venue, v_staff from salary_deductions d where d.id = p_id;
  if not found or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  -- The person's pay lock before the row's (0271).
  perform app.lock_wage(v_venue, v_staff);
  select * into v_row from salary_deductions where id = p_id for update;
  if v_row.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if auth.uid() = v_row.proposed_by or auth.uid() = v_row.staff_id then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'approve';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  -- A decline is the one decision the proposer cannot act on without a reason.
  if not p_approve and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  update salary_deductions
     set status        = case when p_approve then 'approved' else 'declined' end,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = v_note,
         -- V16, 0272: the month it is approved in, or the person's next
         -- unpaid one when the owner already paid it.
         pay_month     = case when p_approve
                              then app.wage_open_month(v_row.venue_id, v_row.staff_id,
                                                       app.venue_business_date(v_row.venue_id, now()))
                         end
   where id = p_id
   returning * into v_row;

  perform app.write_audit(case when p_approve then 'staff.deduction.approve' else 'staff.deduction.decline' end,
                          'salary_deduction', p_id::text,
                          jsonb_build_object('status', 'waiting'),
                          jsonb_build_object('status', v_row.status));

  perform app.notify_staff(
    array[v_row.proposed_by],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', case when p_approve then 'deduction_approved' else 'deduction_declined' end,
      'params', '{}'::jsonb));
  if p_approve then
    perform app.notify_staff(
      array[v_row.staff_id],
      'staff_info',
      jsonb_build_object('route', 'staff', 'id', null, 'title_key', 'deduction_recorded',
                         'params', '{}'::jsonb));
  end if;

  return jsonb_build_object('status', v_row.status, 'decided_at', v_row.decided_at,
                            'pay_month', v_row.pay_month);
end $decide_deduction_0272$;

comment on function app.decide_deduction(uuid, boolean, text) is
  'salary_deductions (wave5-addendum §2.5.3, 0272). The owner approves or declines a waiting deduction at a venue, never one they proposed or one against themselves; a decline needs a note (at most 1000). An approval stamps pay_month: the venue''s business month today, or the person''s next unpaid month when that one is paid (V16, 0272), and the amount comes off that month''s wage. Tells the proposer (staff_decided / deduction_approved or deduction_declined) and, on an approval, the person (staff_info / deduction_recorded), with no amount. Returns {status, decided_at, pay_month}. FORBIDDEN (not the owner), REF_NOT_FOUND, SUBMISSION_DECIDED, CANNOT_DECIDE_OWN, INVALID_ARGUMENT (hint approve), TEXT_TOO_LONG (hint note), REASON_REQUIRED. Audit staff.deduction.approve / .decline {status}.';

revoke all on function app.decide_deduction(uuid, boolean, text) from public, anon;
grant execute on function app.decide_deduction(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.cancel_deduction — 0197 but for: never in a paid month.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_deduction(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $cancel_deduction_0272$
declare
  v_row    salary_deductions%rowtype;
  v_venue  uuid;
  v_staff  uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select d.venue_id, d.staff_id into v_venue, v_staff from salary_deductions d where d.id = p_id;
  if not found or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  -- The person's pay lock before the row's (0271).
  perform app.lock_wage(v_venue, v_staff);
  select * into v_row from salary_deductions where id = p_id for update;
  if v_row.status <> 'approved' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if auth.uid() = v_row.staff_id then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  -- 0272: a paid month is frozen.
  if app.wage_month_paid(v_row.venue_id, v_row.staff_id, v_row.pay_month) then
    raise exception 'WAGE_ALREADY_PAID' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;

  update salary_deductions
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
   where id = p_id
   returning * into v_row;

  perform app.write_audit('staff.deduction.cancel', 'salary_deduction', p_id::text,
                          jsonb_build_object('status', 'approved'),
                          jsonb_build_object('status', 'cancelled'));
  return jsonb_build_object('status', 'cancelled', 'cancelled_at', v_row.cancelled_at);
end $cancel_deduction_0272$;

comment on function app.cancel_deduction(uuid, text) is
  'salary_deductions (wave5-addendum §2.5.3, 0272). The owner cancels an approved deduction, never one against themselves or one whose pay month is already paid, with a reason (1 to 1000); the row and its pay month stay, and it leaves every total. No push. Returns {status: cancelled, cancelled_at}. REF_NOT_FOUND, FORBIDDEN, INVALID_TRANSITION (not approved), CANNOT_DECIDE_OWN, WAGE_ALREADY_PAID, REASON_REQUIRED, TEXT_TOO_LONG (hint reason). Audit staff.deduction.cancel {status}.';

revoke all on function app.cancel_deduction(uuid, text) from public, anon;
grant execute on function app.cancel_deduction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.deductions_page — 0197 but for: can_decide is the owner's,
--    can_withdraw is new, can_cancel needs an unpaid month.
-- ---------------------------------------------------------------------------
create or replace function app.deductions_page(
  p_venue_id uuid default null,
  p_filter   text default 'waiting',
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $deductions_page_0272$
declare
  v_venue    uuid;
  v_filter   text := coalesce(p_filter, 'waiting');
  v_statuses text[];
  v_limit    int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset   int := greatest(coalesce(p_offset, 0), 0);
  v_owner    boolean := app.is_staff('owner');
  v_rows     jsonb;
  v_total    int;
  v_waiting  int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_statuses := case v_filter
                  when 'waiting' then array['waiting']
                  when 'decided' then array['approved','declined','cancelled']
                  when 'all'     then array['waiting','approved','declined','withdrawn','cancelled']
                end;
  if v_statuses is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'filter';
  end if;

  -- Never a row against the caller: a manager who is the person reads it
  -- through my_deductions, as the person (§2.5.2).
  select count(*) into v_total
    from salary_deductions d
   where d.venue_id = v_venue and d.status = any(v_statuses) and d.staff_id is distinct from auth.uid();
  select count(*) into v_waiting
    from salary_deductions d
   where d.venue_id = v_venue and d.status = 'waiting' and d.staff_id is distinct from auth.uid();

  -- Waiting first, then newest.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                x.id,
           'staff_id',          x.staff_id,
           'staff_name',        s.display_name,
           'staff_role',        s.role,
           'amount_iqd',        x.amount_iqd,
           'deduction_date',    x.deduction_date,
           'pay_month',         x.pay_month,
           'dated_earlier',     x.pay_month is not null
                                and date_trunc('month', x.deduction_date)::date < x.pay_month,
           'reason',            x.reason,
           'status',            x.status,
           'proposed_by_name',  p.display_name,
           'proposed_by_role',  p.role,
           'proposed_at',       x.proposed_at,
           'decided_by_name',   dd.display_name,
           'decided_at',        x.decided_at,
           'decision_note',     x.decision_note,
           'cancelled_by_name', c.display_name,
           'cancelled_at',      x.cancelled_at,
           'cancel_reason',     x.cancel_reason,
           -- 0272: the owner decides.
           'can_decide',        x.status = 'waiting' and v_owner
                                and auth.uid() is distinct from x.proposed_by
                                and auth.uid() is distinct from x.staff_id,
           'can_withdraw',      x.status = 'waiting' and auth.uid() = x.proposed_by,
           'can_cancel',        x.status = 'approved' and v_owner
                                and auth.uid() is distinct from x.staff_id
                                and not app.wage_month_paid(x.venue_id, x.staff_id, x.pay_month))
         order by x.ord), '[]'::jsonb)
    into v_rows
    from (select d.*,
                 row_number() over (order by (d.status = 'waiting') desc, d.proposed_at desc, d.id) as ord
            from salary_deductions d
           where d.venue_id = v_venue and d.status = any(v_statuses)
             and d.staff_id is distinct from auth.uid()
           order by ord
           limit v_limit offset v_offset) x
    join staff s on s.id = x.staff_id
    left join staff p  on p.id  = x.proposed_by
    left join staff dd on dd.id = x.decided_by
    left join staff c  on c.id  = x.cancelled_by;

  return jsonb_build_object('deductions', v_rows, 'waiting_count', v_waiting, 'total', v_total);
end $deductions_page_0272$;

comment on function app.deductions_page(uuid, text, int, int) is
  'salary_deductions (wave5-addendum §2.5.3, 0272). MGMT at the venue, every row but the ones against the caller: {deductions: [{id, staff_id, staff_name, staff_role, amount_iqd, deduction_date, pay_month, dated_earlier, reason, status, proposed_by_name, proposed_by_role, proposed_at, decided_by_name, decided_at, decision_note, cancelled_by_name, cancelled_at, cancel_reason, can_decide, can_withdraw, can_cancel}], waiting_count, total} for p_filter waiting, decided (approved, declined, cancelled) or all, waiting first and then newest, p_limit 1 to 200. can_decide: the owner, on a waiting row they neither proposed nor are the person of; can_withdraw: the caller proposed the waiting row; can_cancel: the owner, on an approved row whose pay month is unpaid. INVALID_ARGUMENT (hint filter); FORBIDDEN for anyone else.';

revoke all on function app.deductions_page(uuid, text, int, int) from public, anon;
grant execute on function app.deductions_page(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.deductions_month — 0197 but for: each person's wage_paid.
-- ---------------------------------------------------------------------------
create or replace function app.deductions_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $deductions_month_0272$
declare
  v_venue   uuid;
  v_current date;
  v_month   date;
  v_people  jsonb;
  v_totals  jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_current := date_trunc('month', app.venue_business_date(v_venue))::date;
  v_month   := coalesce(date_trunc('month', p_month)::date, v_current);

  -- The month's approved and cancelled rows by their pay month; waiting rows
  -- have none yet, so they show in the current month only. A cancelled row is
  -- listed and in no total.
  with rows as (
    select d.*,
           p.display_name as proposed_by_name,
           x.display_name as decided_by_name
      from salary_deductions d
      left join staff p on p.id = d.proposed_by
      left join staff x on x.id = d.decided_by
     where d.venue_id = v_venue
       and d.staff_id is distinct from auth.uid()        -- the caller's own: my_deductions
       and ((d.status in ('approved','cancelled') and d.pay_month = v_month)
            or (d.status = 'waiting' and v_month = v_current))
  ), people as (
    select r.staff_id,
           s.display_name,
           s.role,
           s.is_active,
           coalesce(sum(r.amount_iqd) filter (where r.status = 'approved'), 0) as approved_iqd,
           count(*) filter (where r.status = 'approved')                         as approved_count,
           coalesce(sum(r.amount_iqd) filter (where r.status = 'waiting'), 0)  as waiting_iqd,
           count(*) filter (where r.status = 'waiting')                          as waiting_count,
           jsonb_agg(jsonb_build_object(
             'id',               r.id,
             'amount_iqd',       r.amount_iqd,
             'deduction_date',   r.deduction_date,
             'dated_earlier',    r.pay_month is not null
                                 and date_trunc('month', r.deduction_date)::date < r.pay_month,
             'reason',           r.reason,
             'status',           r.status,
             'proposed_by_name', r.proposed_by_name,
             'decided_by_name',  r.decided_by_name,
             'decided_at',       r.decided_at)
             order by r.deduction_date, r.proposed_at, r.id) as deductions
      from rows r
      join staff s on s.id = r.staff_id
     group by r.staff_id, s.display_name, s.role, s.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'staff_id',       pp.staff_id,
           'display_name',   pp.display_name,
           'role',           pp.role,
           'is_active',      pp.is_active,
           'approved_iqd',   pp.approved_iqd,
           'approved_count', pp.approved_count,
           'waiting_iqd',    pp.waiting_iqd,
           'waiting_count',  pp.waiting_count,
           -- 0272: the month's wage is paid, so nothing in it can be cancelled.
           'wage_paid',      app.wage_month_paid(v_venue, pp.staff_id, v_month),
           'deductions',     pp.deductions)
           order by pp.display_name, pp.staff_id), '[]'::jsonb),
         jsonb_build_object(
           'approved_iqd',   coalesce(sum(pp.approved_iqd), 0),
           'approved_count', coalesce(sum(pp.approved_count), 0),
           'waiting_iqd',    coalesce(sum(pp.waiting_iqd), 0),
           'waiting_count',  coalesce(sum(pp.waiting_count), 0),
           'people',         count(*))
    into v_people, v_totals
    from people pp;

  return jsonb_build_object('month', v_month, 'totals', v_totals, 'people', v_people);
end $deductions_month_0272$;

comment on function app.deductions_month(uuid, date) is
  'salary_deductions (wave5-addendum §2.5.3, V16, 0272). MGMT at the venue, every person but the caller: {month, totals: {approved_iqd, approved_count, waiting_iqd, waiting_count, people}, people: [{staff_id, display_name, role, is_active, approved_iqd, approved_count, waiting_iqd, waiting_count, wage_paid, deductions: [{id, amount_iqd, deduction_date, dated_earlier, reason, status, proposed_by_name, decided_by_name, decided_at}]}]} for p_month (NULL: the venue''s current business month): the approved and cancelled rows whose pay month it is, and in the current month the waiting rows too. Cancelled rows are listed and in no total. wage_paid: the owner marked that person''s wage for the month paid (wages, 0271). FORBIDDEN for anyone else.';

revoke all on function app.deductions_month(uuid, date) from public, anon;
grant execute on function app.deductions_month(uuid, date) to authenticated;
