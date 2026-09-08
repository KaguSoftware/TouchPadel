-- 0072_staff_requests — the things a staff member asks the owner to confirm,
-- and the owner's decision on each (Management → Observation → Requests).
--
-- Why this table exists at all: every other "waiting on the owner" signal in
-- this system is a side effect of something else — an unclosed day, a stock
-- alert, a failed Telegram row. A leave day, a shift swap, a wage advance and
-- a correction to a recorded shift are none of those: they originate with a
-- PERSON, they are refused as often as they are granted, and the refusal has
-- to be as durable as the grant. So they are a record with a decision on it,
-- not a message.
--
-- Model:
--
--   * A request is IMMUTABLE once submitted. The requester may withdraw it
--     (status 'withdrawn'), which is a fact about the request rather than an
--     edit of it; nothing else about a submitted row ever changes except the
--     decision block. Editing a pending request would let someone alter what
--     was asked after the owner had read it, which is precisely the thing an
--     approval record exists to prevent.
--   * The OWNER decides. Not the manager — a manager approving their own
--     team's advances is the conflict this screen is meant to remove, and
--     /observation is owner-only in ROUTE_ROLES for the same reason. Managers
--     still READ every request, because they run the roster the decision
--     lands on.
--   * NOBODY decides their own request, owner included. An owner who asks for
--     something asks the other owner; with one owner the row simply stays
--     pending, which is honest.
--   * Decisions are one-way. There is no un-approve: an approval that turned
--     out wrong is a new request, so the trail keeps both.
--
-- Payload per kind is constrained rather than free jsonb, because the four
-- kinds answer genuinely different questions and a screen that has to guess
-- which fields are meaningful will render all of them:
--
--   leave       from_date..to_date          — days off
--   shift_swap  from_date..to_date          — cover for a run of shifts
--   advance     amount_iqd                  — money against wages
--   correction  from_date, note             — "I was here, the record says I was not"
--
-- covered by packages/db/tests/staffRequests.test.ts

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type staff_request_kind as enum ('leave','shift_swap','advance','correction');
exception when duplicate_object then null; end $$;

do $$ begin
  create type staff_request_status as enum ('pending','approved','rejected','withdrawn');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table if not exists staff_requests (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references staff(id),
  kind          staff_request_kind   not null,
  status        staff_request_status not null default 'pending',
  from_date     date,
  to_date       date,
  amount_iqd    int,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  decision_note text,

  -- Payload coherence, per kind. A screen reads these as guarantees.
  constraint staff_requests_dates_chk check (
    case kind
      when 'leave'      then from_date is not null and to_date is not null and to_date >= from_date
      when 'shift_swap' then from_date is not null and to_date is not null and to_date >= from_date
      when 'correction' then from_date is not null and to_date is null
      when 'advance'    then from_date is null     and to_date is null
    end
  ),
  constraint staff_requests_amount_chk check (
    case kind
      when 'advance' then amount_iqd is not null and amount_iqd > 0
      else amount_iqd is null
    end
  ),
  -- A correction that does not say what was wrong is not reviewable.
  constraint staff_requests_correction_note_chk check (
    kind <> 'correction' or length(btrim(note)) > 0
  ),
  -- The decision block is all-or-nothing, and only a settled row carries one.
  -- 'withdrawn' is the requester's own act, so it has no decider.
  constraint staff_requests_decision_chk check (
    case status
      when 'pending'   then decided_by is null and decided_at is null
      when 'withdrawn' then decided_by is null and decided_at is null
      else decided_by is not null and decided_at is not null
    end
  ),
  -- Nobody signs off their own ask.
  constraint staff_requests_not_self_chk check (decided_by is null or decided_by <> staff_id)
);

comment on table staff_requests is
  '0072: staff-originated asks (leave, shift swap, wage advance, record correction) with the '
  'owner''s decision. Immutable once submitted apart from the decision block; withdraw rather '
  'than edit. Decisions are made only through app.decide_staff_request.';

-- The queue read: pending first, oldest first, which is the order they are worked.
create index if not exists staff_requests_pending_idx
  on staff_requests (created_at) where status = 'pending';
create index if not exists staff_requests_staff_idx
  on staff_requests (staff_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. RLS — read here, write only through the definer RPCs below
-- ---------------------------------------------------------------------------
alter table staff_requests enable row level security;

drop policy if exists staff_requests_read_own on staff_requests;
create policy staff_requests_read_own on staff_requests
  for select to authenticated
  using (staff_id = auth.uid());

drop policy if exists staff_requests_read_mgmt on staff_requests;
create policy staff_requests_read_mgmt on staff_requests
  for select to authenticated
  using (app.is_staff('manager','owner'));

-- No insert/update/delete policy on purpose: submission and decision both run
-- through SECURITY DEFINER functions so the guards and the audit row cannot be
-- bypassed by a direct PostgREST write.
grant select on staff_requests to authenticated;
grant all    on staff_requests to service_role;

-- ---------------------------------------------------------------------------
-- 4. app.submit_staff_request — any signed-in staff member, for themselves
-- ---------------------------------------------------------------------------
create or replace function app.submit_staff_request(
  p_kind       text,
  p_from       date default null,
  p_to         date default null,
  p_amount_iqd int  default null,
  p_note       text default ''
) returns uuid
language plpgsql security definer set search_path = public as $fn_submit_staff_request_0072$
declare
  v_id   uuid;
  v_kind staff_request_kind;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  begin
    v_kind := p_kind::staff_request_kind;
  exception when invalid_text_representation then
    raise exception 'BAD_KIND' using errcode = 'P0001';
  end;

  -- One open ask of a kind at a time: a second pending leave request is
  -- almost always a double submit, and the owner should never have to guess
  -- which of two identical rows is the live one.
  if exists (
    select 1 from staff_requests
     where staff_id = auth.uid() and kind = v_kind and status = 'pending'
  ) then
    raise exception 'REQUEST_ALREADY_PENDING' using errcode = 'P0001';
  end if;

  insert into staff_requests (staff_id, kind, from_date, to_date, amount_iqd, note)
  values (auth.uid(), v_kind, p_from, p_to, p_amount_iqd, coalesce(btrim(p_note), ''))
  returning id into v_id;

  perform app.write_audit(
    'staff_request.submit', 'staff_request', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'amountIqd', p_amount_iqd));

  return v_id;
end $fn_submit_staff_request_0072$;

-- ---------------------------------------------------------------------------
-- 5. app.withdraw_staff_request — the requester, while it is still pending
-- ---------------------------------------------------------------------------
create or replace function app.withdraw_staff_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn_withdraw_staff_request_0072$
declare
  v_row staff_requests%rowtype;
begin
  -- FIRST statement, before the row is even looked up: a cafe guest holds
  -- `authenticated` exactly as staff do, so without this the NOT_FOUND vs
  -- FORBIDDEN split below tells an anonymous scanner which request ids exist.
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from staff_requests where id = p_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.staff_id <> auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = 'P0001';
  end if;

  update staff_requests set status = 'withdrawn' where id = p_id;
  perform app.write_audit('staff_request.withdraw', 'staff_request', p_id::text,
                          to_jsonb(v_row), null);
end $fn_withdraw_staff_request_0072$;

-- ---------------------------------------------------------------------------
-- 6. app.decide_staff_request — the owner, once, never on their own row
-- ---------------------------------------------------------------------------
create or replace function app.decide_staff_request(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn_decide_staff_request_0072$
declare
  v_row    staff_requests%rowtype;
  v_status staff_request_status;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from staff_requests where id = p_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = 'P0001';
  end if;
  if v_row.staff_id = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;

  -- A refusal without a reason is the one decision a person cannot act on,
  -- so it is the one that must carry a note.
  if not p_approve and coalesce(length(btrim(p_note)), 0) = 0 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_status := case when p_approve then 'approved' else 'rejected' end;

  update staff_requests
     set status        = v_status,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id
   returning * into v_row;

  perform app.write_audit('staff_request.decide', 'staff_request', p_id::text,
                          null, to_jsonb(v_row));

  return to_jsonb(v_row);
end $fn_decide_staff_request_0072$;

-- ---------------------------------------------------------------------------
-- 7. app.staff_requests_page — the queue, with the requester's name
-- ---------------------------------------------------------------------------
create or replace function app.staff_requests_page(
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn_staff_requests_page_0072$
declare
  v_rows   jsonb;
  v_total  bigint;
  v_status staff_request_status;
  v_lim    int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off    int := greatest(coalesce(p_offset, 0), 0);
  v_mgmt   boolean := app.is_staff('manager','owner');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_status is not null then
    begin
      v_status := p_status::staff_request_status;
    exception when invalid_text_representation then
      raise exception 'BAD_STATUS' using errcode = 'P0001';
    end;
  end if;

  -- Management sees the venue; everyone else sees their own asks. Same
  -- function either way, so a non-manager cannot reach the queue by guessing
  -- an argument.
  with visible as (
    select r.*
      from staff_requests r
     where (v_mgmt or r.staff_id = auth.uid())
       and (v_status is null or r.status = v_status)
  )
  select
    -- `pending_first` is a sort key, not a field: strip it so the client sees
    -- exactly the row it is meant to render.
    coalesce(jsonb_agg(to_jsonb(x) - 'pending_first' order by x.pending_first, x.created_at desc), '[]'::jsonb),
    (select count(*) from visible)
  into v_rows, v_total
  from (
    select v.id, v.kind, v.status, v.from_date, v.to_date, v.amount_iqd, v.note,
           v.created_at, v.decided_at, v.decision_note,
           v.staff_id,
           s.display_name  as staff_name,
           s.role::text    as staff_role,
           d.display_name  as decided_by_name,
           (v.status <> 'pending') as pending_first
      from visible v
      join staff s on s.id = v.staff_id
      left join staff d on d.id = v.decided_by
     order by (v.status <> 'pending'), v.created_at desc
     limit v_lim offset v_off
  ) x;

  return jsonb_build_object(
    'requests', v_rows,
    'total',    v_total,
    'pending',  (select count(*) from staff_requests r
                  where r.status = 'pending' and (v_mgmt or r.staff_id = auth.uid())));
end $fn_staff_requests_page_0072$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
revoke all on function app.submit_staff_request(text, date, date, int, text) from public, anon;
grant execute on function app.submit_staff_request(text, date, date, int, text) to authenticated;

revoke all on function app.withdraw_staff_request(uuid) from public, anon;
grant execute on function app.withdraw_staff_request(uuid) to authenticated;

revoke all on function app.decide_staff_request(uuid, boolean, text) from public, anon;
grant execute on function app.decide_staff_request(uuid, boolean, text) to authenticated;

revoke all on function app.staff_requests_page(text, int, int) from public, anon;
grant execute on function app.staff_requests_page(text, int, int) to authenticated;
