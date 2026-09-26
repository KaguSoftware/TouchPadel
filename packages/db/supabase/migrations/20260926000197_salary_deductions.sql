-- 0197 salary_deductions — a head proposes a pay deduction for a member of
-- their team, and a manager or the owner decides it.
--
-- Feature: protocols and the staff phone, wave 5, lane P
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.5, §2.0, §2.3, §3;
-- Majed's answer #2; §8 Q2, Q5-Q10 defaults).
-- Depends on: staff_push_keys_wave5 (P: deduction_proposed, _approved,
-- _declined, _recorded), assistant_barista_waiter_access (R: app.staff_team
-- maps the assistant barista to bar, so Bareq proposes for Hussein, M9).
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- A RECORD, NOT PAYROLL (PROPOSAL, §8 Q9). The owner pays outside the system
-- and reads the month view. A deduction is immutable once proposed: the
-- proposer withdraws instead of editing, a decision is one-way, and an
-- approval made in error is cancelled by the owner with a reason while the
-- row stays. An approved row's pay month is the venue's business month on
-- the day it was approved (V16), so an approval after pay day lands in the
-- month still open; deduction_date stays "when it happened", and a row dated
-- in an earlier month says so (dated_earlier).
--
-- WHO. The heads (head_barista, head_chef) propose for the active members of
-- their own team at the venue (app.staff_team), never a head role or
-- themselves; MGMT for any active non-owner at the venue but themselves
-- (PROPOSAL, §8 Q5; the cashier and the waiter have no head, §8 Q2). Any
-- manager or owner at the venue decides, except the proposer and the person
-- the deduction is against; only the owner cancels. 1 to 2,000,000 IQD, dated
-- within the 60 days up to the venue's business date (PROPOSAL, §8 Q7; no
-- legal rule is enforced, §7.7).
--
-- WHO READS (PROPOSAL, §8 Q6). MGMT at the venue: every row but the ones
-- against themselves, and the month view (the table policy, deductions_page,
-- deductions_month). A manager can be the person (MGMT propose for any
-- non-owner), and then reads the row only as the person does (review
-- 2026-09-26). The proposing head: their own proposals, every status, with
-- the decision note. The person: their own approved and cancelled rows, with
-- no proposer, decision note or cancel reason. Nobody else.
--
-- THE LLM WALL (§2.0). Money about a named person, so never readable by the
-- owner assistant or any LLM: coverage excluded, no assistant_readable_columns
-- row, no assistant tool, no index trigger. Audit rows carry {status} only
-- and no reason code: audit_log is table_read, so a payload never names the
-- person, an amount, the reason or a note (V17). No push carries an amount,
-- the reason or the person's name. The push itself would: deduction_recorded
-- goes to the person, and notification_outbox is table_read, so its
-- recipient (profile_id) and payload leave the assistant's columns here
-- (review 2026-09-26); the table keeps its other columns.
--
-- covered by packages/db/tests/salary-deductions.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists salary_deductions (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id),
  staff_id       uuid not null references staff(id),
  amount_iqd     iqd not null,
  deduction_date date not null,
  pay_month      date,
  reason         text not null,
  proposed_by    uuid not null references staff(id),
  proposed_at    timestamptz not null default now(),
  status         text not null default 'waiting',
  decided_by     uuid references staff(id),
  decided_at     timestamptz,
  decision_note  text,
  cancelled_by   uuid references staff(id),
  cancelled_at   timestamptz,
  cancel_reason  text,
  constraint salary_deductions_amount_chk check (amount_iqd between 1 and 2000000),
  constraint salary_deductions_reason_chk
    check (coalesce(length(btrim(reason)),0) > 0 and length(reason) <= 500),
  constraint salary_deductions_status_chk
    check (status in ('waiting','approved','declined','withdrawn','cancelled')),
  constraint salary_deductions_not_self_chk check (staff_id <> proposed_by),
  constraint salary_deductions_decided_chk
    check ((status in ('approved','declined','cancelled')) = (decided_by is not null)),
  constraint salary_deductions_decided_at_chk check ((decided_by is null) = (decided_at is null)),
  constraint salary_deductions_decider_chk
    check (decided_by is null or (decided_by <> proposed_by and decided_by <> staff_id)),
  constraint salary_deductions_decision_note_chk
    check (decision_note is null or length(decision_note) <= 1000),
  constraint salary_deductions_decline_note_chk
    check (status <> 'declined' or coalesce(length(btrim(decision_note)),0) > 0),
  constraint salary_deductions_cancelled_chk check ((status = 'cancelled') = (cancelled_by is not null)),
  constraint salary_deductions_cancelled_at_chk check ((cancelled_by is null) = (cancelled_at is null)),
  constraint salary_deductions_cancel_reason_len_chk
    check (cancel_reason is null or length(cancel_reason) <= 1000),
  constraint salary_deductions_cancel_reason_chk
    check (status <> 'cancelled' or coalesce(length(btrim(cancel_reason)),0) > 0),
  constraint salary_deductions_canceller_chk check (cancelled_by is null or cancelled_by <> staff_id),
  constraint salary_deductions_pay_month_chk
    check ((pay_month is not null) = (status in ('approved','cancelled'))),
  constraint salary_deductions_pay_month_first_chk
    check (pay_month is null or pay_month = date_trunc('month', pay_month)::date)
);

create index if not exists salary_deductions_venue_status_idx
  on salary_deductions (venue_id, status, proposed_at);
create index if not exists salary_deductions_venue_staff_idx
  on salary_deductions (venue_id, staff_id, deduction_date);
create index if not exists salary_deductions_venue_month_idx
  on salary_deductions (venue_id, pay_month);

comment on table salary_deductions is
  'salary_deductions (wave5-addendum §2.5, answer #2): pay deductions a head proposes for a member of their team (or MGMT for anyone at the venue), decided by a manager or the owner. A record, not payroll: the owner pays outside the system. Read by MGMT at the venue; the proposer and the person read through RPCs. Never readable by the owner assistant or any LLM.';
comment on column salary_deductions.id is 'Deduction id.';
comment on column salary_deductions.venue_id is 'The venue.';
comment on column salary_deductions.staff_id is 'The person the deduction is against.';
comment on column salary_deductions.amount_iqd is 'The amount, 1 to 2,000,000 IQD.';
comment on column salary_deductions.deduction_date is 'When it happened: within the 60 days up to the venue''s business date when proposed. Not the pay month.';
comment on column salary_deductions.pay_month is 'The first day of the venue''s business month on the day it was approved; set on approval and kept on a cancel, NULL otherwise.';
comment on column salary_deductions.reason is 'Why, as typed by the proposer (1 to 500 characters).';
comment on column salary_deductions.proposed_by is 'The head or manager who proposed it.';
comment on column salary_deductions.proposed_at is 'When it was proposed.';
comment on column salary_deductions.status is 'waiting, approved or declined (decided), withdrawn (by the proposer) or cancelled (an approval the owner took back).';
comment on column salary_deductions.decided_by is 'The manager or owner who decided it: never the proposer or the person.';
comment on column salary_deductions.decided_at is 'When it was decided.';
comment on column salary_deductions.decision_note is 'The decider''s note (at most 1000 characters); required on a decline.';
comment on column salary_deductions.cancelled_by is 'The owner who cancelled the approval.';
comment on column salary_deductions.cancelled_at is 'When the approval was cancelled.';
comment on column salary_deductions.cancel_reason is 'Why the approval was cancelled (1 to 1000 characters).';

alter table salary_deductions enable row level security;

drop policy if exists salary_deductions_mgmt_read on salary_deductions;
create policy salary_deductions_mgmt_read on salary_deductions
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids())
         and staff_id is distinct from auth.uid());

grant select on salary_deductions to authenticated;
grant all on salary_deductions to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.deduction_targets — who the caller may propose a deduction for.
-- ---------------------------------------------------------------------------
create or replace function app.deduction_targets(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $deduction_targets_0197$
declare
  v_role  staff_role := app.staff_role();
  v_venue uuid;
  v_team  text;
  v_rows  jsonb;
begin
  if not app.is_staff('head_barista','head_chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- A head's own team, without its head role; MGMT anyone but an owner.
  if v_role in ('head_barista','head_chef') then
    v_team := app.staff_team(v_role);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'role', s.role)
                            order by s.display_name, s.id), '[]'::jsonb)
    into v_rows
    from staff s
   where s.is_active
     and s.id <> auth.uid()
     and s.role <> 'owner'
     and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = v_venue)
     and (v_team is null
          or (app.staff_team(s.role) = v_team and s.role <> app.staff_team_head(v_team)));

  return jsonb_build_object('staff', v_rows);
end $deduction_targets_0197$;

comment on function app.deduction_targets(uuid) is
  'salary_deductions (wave5-addendum §2.5.3). The heads and MGMT at the venue: {staff: [{id, display_name, role}]} by name, the people the caller may propose a deduction for: a head''s own team''s active members at the venue (app.staff_team), never a head role or themselves; MGMT every active non-owner at the venue but themselves. FORBIDDEN for anyone else.';

revoke all on function app.deduction_targets(uuid) from public, anon;
grant execute on function app.deduction_targets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.propose_deduction — a head or MGMT proposes. Tells MGMT at the
--    venue, never the person, and names no amount.
-- ---------------------------------------------------------------------------
create or replace function app.propose_deduction(
  p_staff_id        uuid,
  p_amount_iqd      bigint,
  p_date            date,
  p_reason          text,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $propose_deduction_0197$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_today  date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
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

  insert into salary_deductions (venue_id, staff_id, amount_iqd, deduction_date, reason, proposed_by)
  values (v_venue, p_staff_id, p_amount_iqd, p_date, v_reason, auth.uid())
  returning id into v_id;

  perform app.write_audit('staff.deduction.propose', 'salary_deduction', v_id::text, null,
                          jsonb_build_object('status', 'waiting'));

  perform app.notify_staff(
    array_remove(app.staff_ids_with_roles(v_venue, array['manager','owner']::staff_role[]), p_staff_id),
    'staff_decide',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', 'deduction_proposed',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()))),
    'deduction:' || auth.uid()::text);

  v_result := jsonb_build_object('id', v_id, 'status', 'waiting');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $propose_deduction_0197$;

comment on function app.propose_deduction(uuid, bigint, date, text, uuid, text) is
  'salary_deductions (wave5-addendum §2.5.3). The heads and MGMT at the venue: proposes a deduction of 1 to 2,000,000 IQD, dated within the 60 days up to the venue''s business date, with a reason (1 to 500), for one of app.deduction_targets. Tells MGMT at the venue but the person (staff_decide / deduction_proposed, the proposer''s name only; dedupe deduction:<proposer>, 15 minutes). Returns {id, status: waiting}. Idempotent by key. FORBIDDEN (hint staff_id: not among the caller''s targets), INVALID_AMOUNT, INVALID_ARGUMENT (hint date), TEXT_REQUIRED, TEXT_TOO_LONG (hint reason). Audit staff.deduction.propose {status}.';

revoke all on function app.propose_deduction(uuid, bigint, date, text, uuid, text) from public, anon;
grant execute on function app.propose_deduction(uuid, bigint, date, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.withdraw_deduction — the proposer, while it waits.
-- ---------------------------------------------------------------------------
create or replace function app.withdraw_deduction(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $withdraw_deduction_0197$
declare
  v_row salary_deductions%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from salary_deductions where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if v_row.proposed_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;

  update salary_deductions set status = 'withdrawn' where id = p_id;

  perform app.write_audit('staff.deduction.withdraw', 'salary_deduction', p_id::text,
                          jsonb_build_object('status', 'waiting'),
                          jsonb_build_object('status', 'withdrawn'));
  return jsonb_build_object('status', 'withdrawn');
end $withdraw_deduction_0197$;

comment on function app.withdraw_deduction(uuid) is
  'salary_deductions (wave5-addendum §2.5.3). The proposer takes back a waiting deduction. Returns {status}. REF_NOT_FOUND (unknown or elsewhere), FORBIDDEN (not theirs), SUBMISSION_DECIDED (already decided or withdrawn). No push. Audit staff.deduction.withdraw {status}.';

revoke all on function app.withdraw_deduction(uuid) from public, anon;
grant execute on function app.withdraw_deduction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.decide_deduction — a manager or owner at the venue, never on one
--    they proposed or one against themselves. An approval sets the pay month.
-- ---------------------------------------------------------------------------
create or replace function app.decide_deduction(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_deduction_0197$
declare
  v_row  salary_deductions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from salary_deductions where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
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
         -- V16: the month it is approved in, which is still open for pay.
         pay_month     = case when p_approve
                              then date_trunc('month', app.venue_business_date(v_row.venue_id, now()))::date
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
end $decide_deduction_0197$;

comment on function app.decide_deduction(uuid, boolean, text) is
  'salary_deductions (wave5-addendum §2.5.3). A manager or owner at the deduction''s venue approves or declines a waiting deduction, never one they proposed or one against themselves; a decline needs a note (at most 1000). An approval stamps pay_month, the venue''s business month today (V16). Tells the proposer (staff_decided / deduction_approved or deduction_declined) and, on an approval, the person (staff_info / deduction_recorded), with no amount. Returns {status, decided_at, pay_month}. REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED, CANNOT_DECIDE_OWN, INVALID_ARGUMENT (hint approve), TEXT_TOO_LONG (hint note), REASON_REQUIRED. Audit staff.deduction.approve / .decline {status}.';

revoke all on function app.decide_deduction(uuid, boolean, text) from public, anon;
grant execute on function app.decide_deduction(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.cancel_deduction — the owner takes back an approval made in error,
--    with a reason. The row and its pay month stay.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_deduction(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $cancel_deduction_0197$
declare
  v_row    salary_deductions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from salary_deductions where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.status <> 'approved' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if auth.uid() = v_row.staff_id then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
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
end $cancel_deduction_0197$;

comment on function app.cancel_deduction(uuid, text) is
  'salary_deductions (wave5-addendum §2.5.3). The owner cancels an approved deduction, never one against themselves, with a reason (1 to 1000); the row and its pay month stay, and it leaves every total. No push. Returns {status: cancelled, cancelled_at}. REF_NOT_FOUND, FORBIDDEN, INVALID_TRANSITION (not approved), CANNOT_DECIDE_OWN, REASON_REQUIRED, TEXT_TOO_LONG (hint reason). Audit staff.deduction.cancel {status}.';

revoke all on function app.cancel_deduction(uuid, text) from public, anon;
grant execute on function app.cancel_deduction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.deductions_page — MGMT at the venue: waiting, decided or all.
-- ---------------------------------------------------------------------------
create or replace function app.deductions_page(
  p_venue_id uuid default null,
  p_filter   text default 'waiting',
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $deductions_page_0197$
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
           'can_decide',        x.status = 'waiting'
                                and auth.uid() is distinct from x.proposed_by
                                and auth.uid() is distinct from x.staff_id,
           'can_cancel',        x.status = 'approved' and v_owner
                                and auth.uid() is distinct from x.staff_id)
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
end $deductions_page_0197$;

comment on function app.deductions_page(uuid, text, int, int) is
  'salary_deductions (wave5-addendum §2.5.3). MGMT at the venue, every row but the ones against the caller: {deductions: [{id, staff_id, staff_name, staff_role, amount_iqd, deduction_date, pay_month, dated_earlier, reason, status, proposed_by_name, proposed_by_role, proposed_at, decided_by_name, decided_at, decision_note, cancelled_by_name, cancelled_at, cancel_reason, can_decide, can_cancel}], waiting_count, total} for p_filter waiting, decided (approved, declined, cancelled) or all, waiting first and then newest, p_limit 1 to 200. INVALID_ARGUMENT (hint filter); FORBIDDEN for anyone else.';

revoke all on function app.deductions_page(uuid, text, int, int) from public, anon;
grant execute on function app.deductions_page(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.deductions_month — MGMT at the venue: one pay month, by person.
-- ---------------------------------------------------------------------------
create or replace function app.deductions_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $deductions_month_0197$
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
end $deductions_month_0197$;

comment on function app.deductions_month(uuid, date) is
  'salary_deductions (wave5-addendum §2.5.3, V16). MGMT at the venue, every person but the caller: {month, totals: {approved_iqd, approved_count, waiting_iqd, waiting_count, people}, people: [{staff_id, display_name, role, is_active, approved_iqd, approved_count, waiting_iqd, waiting_count, deductions: [{id, amount_iqd, deduction_date, dated_earlier, reason, status, proposed_by_name, decided_by_name, decided_at}]}]} for p_month (NULL: the venue''s current business month): the approved and cancelled rows whose pay month it is, and in the current month the waiting rows too. Cancelled rows are listed and in no total. FORBIDDEN for anyone else.';

revoke all on function app.deductions_month(uuid, date) from public, anon;
grant execute on function app.deductions_month(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.my_deduction_proposals — a head's or manager's own proposals.
-- ---------------------------------------------------------------------------
create or replace function app.my_deduction_proposals(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_deduction_proposals_0197$
declare
  v_venue uuid;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows  jsonb;
begin
  if not app.is_staff('head_barista','head_chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',             x.id,
           'staff_name',     s.display_name,
           'staff_role',     s.role,
           'amount_iqd',     x.amount_iqd,
           'deduction_date', x.deduction_date,
           'reason',         x.reason,
           'status',         x.status,
           'proposed_at',    x.proposed_at,
           'decided_at',     x.decided_at,
           'decision_note',  x.decision_note)
         order by x.proposed_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from salary_deductions d
           where d.venue_id = v_venue and d.proposed_by = auth.uid()
           order by d.proposed_at desc, d.id
           limit v_limit) x
    join staff s on s.id = x.staff_id;

  return jsonb_build_object('proposals', v_rows);
end $my_deduction_proposals_0197$;

comment on function app.my_deduction_proposals(uuid, int) is
  'salary_deductions (wave5-addendum §2.5.2, §2.5.3). The heads and MGMT at the venue: {proposals: [{id, staff_name, staff_role, amount_iqd, deduction_date, reason, status, proposed_at, decided_at, decision_note}]}, the caller''s own proposals at every status, newest first, p_limit 1 to 100 (default 30). No totals. FORBIDDEN for anyone else.';

revoke all on function app.my_deduction_proposals(uuid, int) from public, anon;
grant execute on function app.my_deduction_proposals(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.my_deductions — the person's own approved and cancelled rows in a
--     pay month, and the month's approved total. Any role, driver and
--     marketing included.
-- ---------------------------------------------------------------------------
create or replace function app.my_deductions(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_deductions_0197$
declare
  v_venue uuid;
  v_month date;
  v_rows  jsonb;
  v_total bigint;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_month := coalesce(date_trunc('month', p_month)::date,
                      date_trunc('month', app.venue_business_date(v_venue))::date);

  -- Never who proposed it, the decision note or the cancel reason (§2.5.2).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',             d.id,
           'amount_iqd',     d.amount_iqd,
           'deduction_date', d.deduction_date,
           'dated_earlier',  date_trunc('month', d.deduction_date)::date < d.pay_month,
           'reason',         d.reason,
           'status',         d.status,
           'decided_at',     d.decided_at)
         order by d.deduction_date, d.decided_at, d.id), '[]'::jsonb),
         coalesce(sum(d.amount_iqd) filter (where d.status = 'approved'), 0)
    into v_rows, v_total
    from salary_deductions d
   where d.venue_id = v_venue
     and d.staff_id = auth.uid()
     and d.status in ('approved','cancelled')
     and d.pay_month = v_month;

  return jsonb_build_object('month', v_month, 'total_iqd', v_total, 'deductions', v_rows);
end $my_deductions_0197$;

comment on function app.my_deductions(uuid, date) is
  'salary_deductions (wave5-addendum §2.5.2, §2.5.3). Any active staff member at the venue: {month, total_iqd, deductions: [{id, amount_iqd, deduction_date, dated_earlier, reason, status, decided_at}]}, their own approved and cancelled deductions whose pay month is p_month (NULL: the venue''s current business month); total_iqd counts the approved ones. Never a waiting, declined or withdrawn row, the proposer, the decision note or the cancel reason. FORBIDDEN for anyone else.';

revoke all on function app.my_deductions(uuid, date) from public, anon;
grant execute on function app.my_deductions(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Owner assistant: the push queue's recipient and payload leave its
--     columns. deduction_recorded goes to the person, so the row's
--     profile_id, beside the approval's audit row at the same moment, would
--     name who a deduction is against (§2.0). The table stays table_read
--     with its other columns (kind, the times, attempts, the error).
-- ---------------------------------------------------------------------------
delete from app.assistant_readable_columns
 where table_name = 'notification_outbox'
   and column_name in ('profile_id', 'payload');
