-- 0176 hiring — the hiring protocol's candidates, its hooks, and the deletion of
-- candidate data 90 days after the decision.
--
-- Feature: protocols and the staff phone, lane F
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.12, §2.8, §2.19, §2.22;
-- plan §5.3).
-- Depends on: protocols_engine_rpcs (A: the engine that calls the hooks below,
-- app.protocol_engine_text).
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists; the cron job upserts by name.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE FLOW. A manager opens a position (the owner approves it), records the
-- candidates while the interviews step is open, and submits the pick (the
-- owner approves it). The owner then creates the account on the Staff page
-- and submits add_staff with the new staff id; the run is done and the new
-- account belongs to the run's venue.
--
-- CANDIDATES ARE PERSONAL DATA. hiring_candidates holds names, phone numbers
-- and interview briefs of people who are not staff and never agreed to more
-- than being considered. So: MGMT at the venue reads them, nobody else; they
-- never reach the owner assistant (no app.assistant_readable_columns row and
-- no index trigger: what the assistant reads goes to the LLM); no push, audit
-- payload or step record carries a name or a phone; and 90 days after the
-- decision app.hiring_purge_due deletes them and overwrites the free text a
-- decider could have typed a name into (decision notes, skip notes, the stop
-- reason, the note of an owner-added step) with a fixed marker.
--
-- covered by packages/db/tests/hiring.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. hiring_candidates.
-- ---------------------------------------------------------------------------
create table if not exists hiring_candidates (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references venues(id),
  run_id           uuid not null references protocol_runs(id) on delete cascade,
  candidate_name   text not null check (coalesce(length(btrim(candidate_name)),0) between 1 and 80),
  candidate_phone  text not null check (coalesce(length(btrim(candidate_phone)),0) between 1 and 32),
  brief            text not null default '' check (length(brief) <= 1000),
  interview_at     timestamptz,
  picked           boolean not null default false,
  pick_reason      text check (pick_reason is null or length(pick_reason) <= 1000),
  created_by       uuid not null references staff(id),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  purge_after      timestamptz
);

-- One pick per run; the purge reads by purge_after.
create unique index if not exists hiring_candidates_one_pick_key on hiring_candidates (run_id) where picked;
create index if not exists hiring_candidates_purge_idx on hiring_candidates (purge_after) where purge_after is not null;

comment on table hiring_candidates is
  'hiring (§2.12): the candidates of one hiring run. Personal data of people who are not staff: read by MGMT at the venue only, never by the owner assistant, and deleted by app.hiring_purge_due 90 days after the decision. Written through app.save_hiring_candidate and app.delete_hiring_candidate while the interviews step is open.';
comment on column hiring_candidates.id is 'Candidate id.';
comment on column hiring_candidates.venue_id is 'The run''s venue.';
comment on column hiring_candidates.run_id is 'The hiring run.';
comment on column hiring_candidates.candidate_name is 'The candidate''s name as the manager typed it (1-80).';
comment on column hiring_candidates.candidate_phone is 'The candidate''s phone number (at most 32).';
comment on column hiring_candidates.brief is 'The manager''s notes on the candidate (at most 1000).';
comment on column hiring_candidates.interview_at is 'When the interview is or was.';
comment on column hiring_candidates.picked is 'The candidate the run picked; at most one per run. Follows the approved interviews record.';
comment on column hiring_candidates.pick_reason is 'Why this candidate (at most 1000).';
comment on column hiring_candidates.created_by is 'Who added the candidate.';
comment on column hiring_candidates.created_at is 'When the candidate was added.';
comment on column hiring_candidates.decided_at is 'When the pick was approved, or the run stopped.';
comment on column hiring_candidates.purge_after is 'When app.hiring_purge_due deletes the row: 90 days after decided_at.';

alter table hiring_candidates enable row level security;

drop policy if exists hiring_candidates_mgmt_read on hiring_candidates;
create policy hiring_candidates_mgmt_read on hiring_candidates
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on hiring_candidates to authenticated;
grant all on hiring_candidates to service_role;

-- ---------------------------------------------------------------------------
-- 2. Record helpers for the hiring check hooks and the candidate form.
--    Internal. The hint is the field the form marks.
-- ---------------------------------------------------------------------------

-- A text field: trimmed, NULL when blank; RECORD_INVALID when it is not a
-- string or is required and blank; TEXT_TOO_LONG past the cap.
create or replace function app.hiring_text(p_value jsonb, p_cap int, p_required boolean, p_hint text)
returns text
language plpgsql immutable set search_path = public as $hiring_text_0176$
declare
  v text;
begin
  if p_value is not null and p_value <> 'null'::jsonb then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
    end if;
    v := app.protocol_engine_text(p_value #>> '{}', p_cap, p_hint);
  end if;
  if v is null and p_required then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end $hiring_text_0176$;

comment on function app.hiring_text(jsonb, int, boolean, text) is
  'hiring (§2.12). Internal: a hiring record''s text field, trimmed and NULL when blank; RECORD_INVALID (hint p_hint) when not a string or required and blank, TEXT_TOO_LONG past p_cap.';

revoke all on function app.hiring_text(jsonb, int, boolean, text) from public, anon, authenticated;

-- A non-negative whole number of IQD, or NULL when absent.
create or replace function app.hiring_iqd(p_value jsonb, p_hint text)
returns bigint
language plpgsql immutable set search_path = public as $hiring_iqd_0176$
declare
  v numeric;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  v := (p_value #>> '{}')::numeric;
  if v <> trunc(v) or v < 0 or v > 9007199254740991 then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = p_hint;
  end if;
  return v::bigint;
end $hiring_iqd_0176$;

comment on function app.hiring_iqd(jsonb, text) is
  'hiring (§2.12). Internal: an optional amount of IQD, a whole number >= 0; RECORD_INVALID (hint p_hint) otherwise.';

revoke all on function app.hiring_iqd(jsonb, text) from public, anon, authenticated;

-- RECORD_INVALID naming the first key of p_record (with a value) that is not
-- taken.
create or replace function app.hiring_only_keys(p_record jsonb, p_allowed text[])
returns void
language plpgsql immutable set search_path = public as $hiring_only_keys_0176$
declare
  v_bad text;
begin
  select e.k into v_bad
    from jsonb_each(p_record) as e(k, v)
   where e.v <> 'null'::jsonb and not (e.k = any(p_allowed))
   order by e.k
   limit 1;
  if v_bad is not null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = v_bad;
  end if;
end $hiring_only_keys_0176$;

comment on function app.hiring_only_keys(jsonb, text[]) is
  'hiring (§2.12). Internal: RECORD_INVALID (hint = the key) when p_record carries a key outside p_allowed with a non-null value.';

revoke all on function app.hiring_only_keys(jsonb, text[]) from public, anon, authenticated;

-- The role the run's approved open_position named.
create or replace function app.hiring_position_role(p_run_id uuid)
returns text
language sql stable security definer set search_path = public as $hiring_position_role_0176$
  select x.record->>'role'
    from protocol_submissions x
    join protocol_run_steps s on s.id = x.run_step_id
   where s.run_id = p_run_id and s.step_key = 'open_position'
     and x.decision in ('approve', 'auto')
   order by x.decided_at desc, x.id
   limit 1
$hiring_position_role_0176$;

comment on function app.hiring_position_role(uuid) is
  'hiring (§2.12). Internal: the role of the run''s approved open_position record, NULL before it passes.';

revoke all on function app.hiring_position_role(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The hiring hooks (§2.7, §2.8, §2.12). Internal.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_start_hiring(p_run_id uuid, p_data jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_start_hiring_0176$
begin
  if p_data is not null and p_data <> '{}'::jsonb then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'data';
  end if;
  return '{}'::jsonb;
end $protocol_start_hiring_0176$;

comment on function app.protocol_start_hiring(uuid, jsonb) is
  'hiring (§2.7). Internal start hook: marks hiring ready; takes data {} (RECORD_INVALID hint data otherwise) and keeps nothing.';

revoke all on function app.protocol_start_hiring(uuid, jsonb) from public, anon, authenticated;

-- The position: a hireable role (never the retired prep), why, the hours, a
-- start date, and an optional pay range.
create or replace function app.protocol_check_hiring_open_position(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_hiring_open_position_0176$
declare
  v_start date;
  v_min   bigint;
  v_max   bigint;
begin
  perform app.hiring_only_keys(p_record, array['role', 'why', 'hours', 'start_date', 'pay_min_iqd', 'pay_max_iqd']);

  if p_record->>'role' = 'prep' then
    raise exception 'ROLE_RETIRED' using errcode = 'P0001', hint = 'role';
  end if;
  if jsonb_typeof(p_record->'role') is distinct from 'string'
     or p_record->>'role' not in ('cashier', 'court_desk', 'manager', 'head_barista', 'barista',
                                  'head_chef', 'chef', 'driver', 'marketing') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'role';
  end if;

  if jsonb_typeof(p_record->'start_date') is distinct from 'string'
     or p_record->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'start_date';
  end if;
  begin
    v_start := (p_record->>'start_date')::date;
  exception when others then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'start_date';
  end;

  v_min := app.hiring_iqd(p_record->'pay_min_iqd', 'pay_min_iqd');
  v_max := app.hiring_iqd(p_record->'pay_max_iqd', 'pay_max_iqd');
  if v_min is not null and v_max is not null and v_min > v_max then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'pay_max_iqd';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'role',        p_record->>'role',
    'why',         app.hiring_text(p_record->'why', 2000, true, 'why'),
    'hours',       app.hiring_text(p_record->'hours', 300, true, 'hours'),
    'start_date',  v_start,
    'pay_min_iqd', v_min,
    'pay_max_iqd', v_max));
end $protocol_check_hiring_open_position_0176$;

comment on function app.protocol_check_hiring_open_position(uuid, jsonb, text[]) is
  'hiring (§2.8). Internal check hook: open_position {role (hireable; ROLE_RETIRED for prep), why, hours (<= 300), start_date (YYYY-MM-DD), pay_min_iqd?, pay_max_iqd? (min <= max)}. RECORD_INVALID and TEXT_TOO_LONG with the field as hint.';

revoke all on function app.protocol_check_hiring_open_position(uuid, jsonb, text[]) from public, anon, authenticated;

-- The pick: candidates of this run, and the one picked among them. Ids only:
-- the record never carries a name.
create or replace function app.protocol_check_hiring_interviews(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_hiring_interviews_0176$
declare
  v_run_id uuid;
  v_ids    uuid[];
  v_pick   uuid;
begin
  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  perform app.hiring_only_keys(p_record, array['candidate_ids', 'picked_id']);

  if jsonb_typeof(p_record->'candidate_ids') is distinct from 'array'
     or jsonb_array_length(p_record->'candidate_ids') = 0
     or exists (select 1 from jsonb_array_elements(p_record->'candidate_ids') x where jsonb_typeof(x) <> 'string') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'candidate_ids';
  end if;
  begin
    v_ids := array(select x::uuid from jsonb_array_elements_text(p_record->'candidate_ids') x);
  exception when others then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'candidate_ids';
  end;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or (select count(*) from hiring_candidates c where c.id = any(v_ids) and c.run_id = v_run_id) <> cardinality(v_ids) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'candidate_ids';
  end if;

  begin
    v_pick := case when jsonb_typeof(p_record->'picked_id') = 'string' then (p_record->>'picked_id')::uuid end;
  exception when others then
    v_pick := null;
  end;
  if v_pick is null or not (v_pick = any(v_ids)) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'picked_id';
  end if;

  return jsonb_build_object('candidate_ids', to_jsonb(v_ids), 'picked_id', v_pick);
end $protocol_check_hiring_interviews_0176$;

comment on function app.protocol_check_hiring_interviews(uuid, jsonb, text[]) is
  'hiring (§2.8). Internal check hook: interviews {candidate_ids (at least one, distinct, candidates of this run), picked_id (one of them)}. RECORD_INVALID hint candidate_ids or picked_id.';

revoke all on function app.protocol_check_hiring_interviews(uuid, jsonb, text[]) from public, anon, authenticated;

-- The new account: active, created after the run started, never prep, and in
-- the role the position named.
create or replace function app.protocol_check_hiring_add_staff(p_run_step_id uuid, p_record jsonb, p_photos text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_check_hiring_add_staff_0176$
declare
  v_run   protocol_runs%rowtype;
  v_id    uuid;
  v_staff staff%rowtype;
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  perform app.hiring_only_keys(p_record, array['staff_id']);

  begin
    v_id := case when jsonb_typeof(p_record->'staff_id') = 'string' then (p_record->>'staff_id')::uuid end;
  exception when others then
    v_id := null;
  end;
  select * into v_staff from staff where id = v_id;
  if v_id is null or not found or not v_staff.is_active or v_staff.created_at <= v_run.started_at then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'staff_id';
  end if;
  if v_staff.role = 'prep' then
    raise exception 'ROLE_RETIRED' using errcode = 'P0001', hint = 'staff_id';
  end if;
  if v_staff.role::text is distinct from app.hiring_position_role(v_run.id) then
    raise exception 'HIRE_ROLE_MISMATCH' using errcode = 'P0001', hint = 'staff_id';
  end if;

  return jsonb_build_object('staff_id', v_id);
end $protocol_check_hiring_add_staff_0176$;

comment on function app.protocol_check_hiring_add_staff(uuid, jsonb, text[]) is
  'hiring (§2.12). Internal check hook: add_staff {staff_id}: an active staff account created after the run started (RECORD_INVALID hint staff_id), never prep (ROLE_RETIRED), in the role of the approved open_position (HIRE_ROLE_MISMATCH).';

revoke all on function app.protocol_check_hiring_add_staff(uuid, jsonb, text[]) from public, anon, authenticated;

-- The pick is approved: the picked flag follows the record, and the 90 days
-- start for every candidate of the run.
create or replace function app.protocol_pass_hiring_interviews(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb)
returns void
language plpgsql security definer set search_path = public as $protocol_pass_hiring_interviews_0176$
declare
  v_run_id uuid;
  v_pick   uuid;
begin
  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  select (x.record->>'picked_id')::uuid into v_pick from protocol_submissions x where x.id = p_submission_id;

  -- Unpicked first, so the one-pick index never sees two.
  update hiring_candidates set picked = false where run_id = v_run_id and picked and id is distinct from v_pick;
  update hiring_candidates set picked = true where run_id = v_run_id and id = v_pick and not picked;
  update hiring_candidates
     set decided_at = now(), purge_after = now() + interval '90 days'
   where run_id = v_run_id;
end $protocol_pass_hiring_interviews_0176$;

comment on function app.protocol_pass_hiring_interviews(uuid, uuid, jsonb) is
  'hiring (§2.12). Internal pass hook: marks the record''s picked_id as the run''s one pick, and sets decided_at = now() and purge_after = now() + 90 days on every candidate of the run.';

revoke all on function app.protocol_pass_hiring_interviews(uuid, uuid, jsonb) from public, anon, authenticated;

-- The account is added: it belongs to the run's venue (the 0123 trigger filed
-- it at the default venue).
create or replace function app.protocol_pass_hiring_add_staff(p_run_step_id uuid, p_submission_id uuid, p_decision_data jsonb)
returns void
language plpgsql security definer set search_path = public as $protocol_pass_hiring_add_staff_0176$
declare
  v_run   protocol_runs%rowtype;
  v_staff staff%rowtype;
begin
  select r.* into v_run
    from protocol_runs r
    join protocol_run_steps s on s.run_id = r.id
   where s.id = p_run_step_id;
  select st.* into v_staff
    from staff st
   where st.id = (select (x.record->>'staff_id')::uuid from protocol_submissions x where x.id = p_submission_id);

  delete from staff_venues where staff_id = v_staff.id and venue_id <> v_run.venue_id;
  insert into staff_venues (staff_id, venue_id, role, created_by)
  values (v_staff.id, v_run.venue_id, v_staff.role, auth.uid())
  on conflict (staff_id, venue_id) do update set role = excluded.role;

  perform app.write_audit('protocol.hiring.complete', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('staff_id', v_staff.id, 'role', v_staff.role));
end $protocol_pass_hiring_add_staff_0176$;

comment on function app.protocol_pass_hiring_add_staff(uuid, uuid, jsonb) is
  'hiring (§2.12). Internal pass hook: files the new staff member at the run''s venue only (staff_venues), audit protocol.hiring.complete (ids and role only).';

revoke all on function app.protocol_pass_hiring_add_staff(uuid, uuid, jsonb) from public, anon, authenticated;

-- A stopped or withdrawn run: its candidates are deleted 90 days on too.
create or replace function app.protocol_stop_hiring(p_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_stop_hiring_0176$
begin
  update hiring_candidates
     set decided_at = coalesce(decided_at, now()), purge_after = now() + interval '90 days'
   where run_id = p_run_id and purge_after is null;
end $protocol_stop_hiring_0176$;

comment on function app.protocol_stop_hiring(uuid) is
  'hiring (§2.12). Internal stop hook: sets purge_after = now() + 90 days (and decided_at) on the run''s candidates that have none.';

revoke all on function app.protocol_stop_hiring(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The candidate RPCs. MGMT at the run's venue; writes only while the
--    interviews step is open.
-- ---------------------------------------------------------------------------
create or replace function app.hiring_candidates(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $hiring_candidates_0176$
declare
  v_run protocol_runs%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) or v_run.kind <> 'hiring'
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'candidate_name', c.candidate_name, 'candidate_phone', c.candidate_phone,
               'brief', c.brief, 'interview_at', c.interview_at, 'picked', c.picked, 'pick_reason', c.pick_reason)
             order by c.created_at, c.id)
        from hiring_candidates c
       where c.run_id = v_run.id), '[]'::jsonb),
    'purged', v_run.data ? 'candidates_purged_at');
end $hiring_candidates_0176$;

comment on function app.hiring_candidates(uuid) is
  'hiring (§2.12). MGMT at the run''s venue: {candidates: [{id, candidate_name, candidate_phone, brief, interview_at, picked, pick_reason}], purged} for one hiring run; purged is true once app.hiring_purge_due deleted its candidates. PROTOCOL_NOT_FOUND.';

revoke all on function app.hiring_candidates(uuid) from public, anon;
grant execute on function app.hiring_candidates(uuid) to authenticated;

-- Adds (p_id NULL) or replaces a candidate: the form sends every field.
-- Marking one picked unmarks the run's other pick.
create or replace function app.save_hiring_candidate(
  p_run_id          uuid,
  p_candidate       jsonb,
  p_id              uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $save_hiring_candidate_0176$
declare
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_replay jsonb;
  v_name   text;
  v_phone  text;
  v_brief  text;
  v_at     timestamptz;
  v_picked boolean;
  v_reason text;
  v_id     uuid;
  v_result jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) or v_run.kind <> 'hiring'
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'save_hiring_candidate');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_step from protocol_run_steps where run_id = v_run.id and step_key = 'interviews' for update;
  if v_run.status <> 'active' or not found or v_step.status <> 'open' then
    raise exception 'STEP_NOT_OPEN' using errcode = 'P0001';
  end if;

  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'candidate';
  end if;
  perform app.hiring_only_keys(p_candidate,
    array['candidate_name', 'candidate_phone', 'brief', 'interview_at', 'picked', 'pick_reason']);
  v_name  := app.hiring_text(p_candidate->'candidate_name', 80, true, 'candidate_name');
  v_phone := app.hiring_text(p_candidate->'candidate_phone', 32, true, 'candidate_phone');
  if v_phone !~ '^[0-9+() -]+$' or v_phone !~ '[0-9]' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'candidate_phone';
  end if;
  v_brief  := coalesce(app.hiring_text(p_candidate->'brief', 1000, false, 'brief'), '');
  v_reason := app.hiring_text(p_candidate->'pick_reason', 1000, false, 'pick_reason');
  if p_candidate ? 'interview_at' and p_candidate->'interview_at' <> 'null'::jsonb then
    if jsonb_typeof(p_candidate->'interview_at') <> 'string' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'interview_at';
    end if;
    begin
      v_at := (p_candidate->>'interview_at')::timestamptz;
    exception when others then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'interview_at';
    end;
    if not isfinite(v_at) then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'interview_at';
    end if;
  end if;
  if coalesce(jsonb_typeof(p_candidate->'picked'), 'null') not in ('boolean', 'null') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'picked';
  end if;
  v_picked := coalesce((p_candidate->>'picked')::boolean, false);

  if p_id is null then
    insert into hiring_candidates (venue_id, run_id, candidate_name, candidate_phone, brief, interview_at,
                                   pick_reason, created_by)
    values (v_run.venue_id, v_run.id, v_name, v_phone, v_brief, v_at, v_reason, auth.uid())
    returning id into v_id;
  else
    select c.id into v_id from hiring_candidates c where c.id = p_id and c.run_id = v_run.id for update;
    if not found then
      raise exception 'CANDIDATE_NOT_FOUND' using errcode = 'P0001';
    end if;
    update hiring_candidates
       set candidate_name = v_name, candidate_phone = v_phone, brief = v_brief,
           interview_at = v_at, pick_reason = v_reason
     where id = v_id;
  end if;
  -- The one pick: unmark the other first.
  if v_picked then
    update hiring_candidates set picked = false where run_id = v_run.id and picked and id <> v_id;
  end if;
  update hiring_candidates set picked = v_picked where id = v_id and picked <> v_picked;

  perform app.write_audit('protocol.hiring.candidate_save', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('candidate_id', v_id, 'created', p_id is null, 'picked', v_picked));

  v_result := jsonb_build_object('id', v_id);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $save_hiring_candidate_0176$;

comment on function app.save_hiring_candidate(uuid, jsonb, uuid, text) is
  'hiring (§2.12). MGMT at the run''s venue while its interviews step is open: adds a candidate (p_id NULL) or replaces one from p_candidate {candidate_name (1-80), candidate_phone (<= 32, digits), brief? (<= 1000), interview_at?, picked?, pick_reason? (<= 1000)}; a pick unmarks the run''s other. Returns {id}. PROTOCOL_NOT_FOUND, STEP_NOT_OPEN, CANDIDATE_NOT_FOUND, RECORD_INVALID, TEXT_TOO_LONG. Idempotent on p_idempotency_key. Audit protocol.hiring.candidate_save (ids only).';

revoke all on function app.save_hiring_candidate(uuid, jsonb, uuid, text) from public, anon;
grant execute on function app.save_hiring_candidate(uuid, jsonb, uuid, text) to authenticated;

create or replace function app.delete_hiring_candidate(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $delete_hiring_candidate_0176$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select c.run_id into v_run_id from hiring_candidates c where c.id = p_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  -- No cross-venue oracle: a candidate elsewhere is as missing as a deleted one.
  if not found or not (v_run.venue_id = any(app.staff_venue_ids()))
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  select * into v_step from protocol_run_steps where run_id = v_run.id and step_key = 'interviews' for update;
  if v_run.status <> 'active' or not found or v_step.status <> 'open' then
    raise exception 'STEP_NOT_OPEN' using errcode = 'P0001';
  end if;

  delete from hiring_candidates where id = p_id;
  perform app.write_audit('protocol.hiring.candidate_delete', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('candidate_id', p_id));
end $delete_hiring_candidate_0176$;

comment on function app.delete_hiring_candidate(uuid) is
  'hiring (§2.12). MGMT at the run''s venue while its interviews step is open: deletes one candidate. CANDIDATE_NOT_FOUND (a candidate at another venue included), STEP_NOT_OPEN. Audit protocol.hiring.candidate_delete (ids only).';

revoke all on function app.delete_hiring_candidate(uuid) from public, anon;
grant execute on function app.delete_hiring_candidate(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.hiring_purge_due — the daily deletion (cron, as the database owner;
--    the audit shows System). Candidates past purge_after are deleted, and on
--    each of their runs every free text a decider could have typed a name
--    into is overwritten with the marker (never NULL: the reason CHECKs of
--    protocols_engine_tables would refuse a send-back or stop row without
--    one and roll the purge back), and the note of an owner-added step's
--    record is removed. The run's data records when, so hiring_candidates
--    can say the list was deleted rather than empty.
-- ---------------------------------------------------------------------------
create or replace function app.hiring_purge_due()
returns jsonb
language plpgsql security definer set search_path = public as $hiring_purge_due_0176$
declare
  c_marker     constant text := '[deleted after 90 days]';
  v_run        record;
  v_candidates int := 0;
  v_runs       int := 0;
  v_notes      int;
  v_skips      int;
  v_stops      int;
  v_records    int;
begin
  for v_run in
    select c.run_id, count(*)::int as n
      from hiring_candidates c
     where c.purge_after <= now()
     group by c.run_id
     order by c.run_id
  loop
    delete from hiring_candidates where run_id = v_run.run_id and purge_after <= now();

    update protocol_submissions
       set decision_note = c_marker
     where run_id = v_run.run_id and decision_note is not null and decision_note <> c_marker;
    get diagnostics v_notes = row_count;
    update protocol_run_steps
       set skip_note = c_marker
     where run_id = v_run.run_id and skip_note is not null and skip_note <> c_marker;
    get diagnostics v_skips = row_count;
    update protocol_runs
       set stop_reason = c_marker
     where id = v_run.run_id and stop_reason is not null and stop_reason <> c_marker;
    get diagnostics v_stops = row_count;
    update protocol_submissions x
       set record = x.record - 'note'
      from protocol_run_steps s
     where s.id = x.run_step_id and s.step_key is null
       and x.run_id = v_run.run_id and x.record ? 'note';
    get diagnostics v_records = row_count;
    update protocol_runs
       set data = data || jsonb_build_object('candidates_purged_at', now())
     where id = v_run.run_id;

    perform app.write_audit('protocol.hiring.purge', 'protocol_run', v_run.run_id::text, null,
      jsonb_build_object('candidates', v_run.n, 'decision_notes', v_notes, 'skip_notes', v_skips,
                         'stop_reason', v_stops, 'step_notes', v_records));
    v_candidates := v_candidates + v_run.n;
    v_runs := v_runs + 1;
  end loop;

  return jsonb_build_object('candidates', v_candidates, 'runs', v_runs);
end $hiring_purge_due_0176$;

comment on function app.hiring_purge_due() is
  'hiring (§2.12, §2.19). Internal, cron tp_hiring_purge: deletes hiring candidates past purge_after and, on each of their runs, overwrites decision notes, skip notes and the stop reason with ''[deleted after 90 days]'' and removes the note of owner-added steps'' records; records candidates_purged_at in the run''s data. Audit protocol.hiring.purge per run (counts only). Returns {candidates, runs}.';

revoke all on function app.hiring_purge_due() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The daily purge job, in its own guarded block (0021 shape; cron.schedule
--    upserts by name).
-- ---------------------------------------------------------------------------
do $hiring_cron_0176$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - hiring purge skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_hiring_purge not scheduled';
    return;
  end if;

  -- Daily at 03:40 (UTC on the database clock): after the day's decisions,
  -- before the morning.
  perform cron.schedule('tp_hiring_purge', '40 3 * * *', 'select app.hiring_purge_due();');
end $hiring_cron_0176$;
