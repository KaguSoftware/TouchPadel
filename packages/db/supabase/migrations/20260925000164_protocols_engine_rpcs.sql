-- 0164 protocols_engine_rpcs — the protocol engine: start, submit, decide, skip,
-- withdraw, stop, the owner's per-run edits and How it works, every read the
-- two apps make, and the hook dispatcher the kind lanes plug into.
--
-- Feature: protocols and the staff phone, lane A
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.7, §2.8, §2.21, §2.22;
-- plan §4.3-§4.7).
-- Depends on: protocols_engine_tables (A), staff_media_bucket (G:
-- app.claim_staff_media), staff_push (G: app.notify_staff,
-- app.staff_ids_with_roles).
-- Re-issues (§2.18): app.claim_staff_media and the staff_media_read policy
-- on storage.objects, both from 0159 (section 7).
-- Re-runnable: create or replace; the policy is dropped and created in one
-- guarded block.
--
-- THE ENGINE IN ONE PARAGRAPH. start_protocol snapshots the venue's template
-- into run rows and submits step 1 from p_first_record in the same
-- transaction. Every submission goes through the step's check hook (the
-- generic {note?} when there is none), claims its photos, runs the submit
-- hook, and either passes at once (the sender is one of the step's deciders:
-- decision 'auto') or waits for a decider. A pass runs the pass hook, then
-- either finishes the run (the terminal step: the kind's finish hook says
-- done, live or scheduled) or opens every waiting step whose dependencies are
-- met. A send-back reopens a step in a new round and puts every step that
-- waits for it back to waiting; a stop ends the run. Earlier rounds stay as
-- history.
--
-- HOOKS decouple the engine from the kinds (E product_release; F tournament,
-- hiring, price_promo). The engine calls app.protocol_<stage>_<kind>[_<key>]
-- only when it exists (to_regprocedure), in the caller's transaction, with
-- the caller's auth.uid(). A kind with no start hook is not ready:
-- start_protocol refuses it with PROTOCOL_NOT_READY. Owner-added steps
-- (step_key NULL) never reach a hook.
--
-- WHO MAY ACT on a step: its assignee when it has one, else a holder of one of
-- its actor roles at the venue. A manager may cover any step whose actors do
-- not include the owner, the owner any step; covering reaches an assigned
-- step too, so a run never waits on someone who has left (§2.7 "Who may
-- act"). WHO DECIDES: the owner when "Needs my OK" is on; otherwise a manager
-- at the venue or the owner. The lists ("To do", "Waiting on you") and the
-- pushes use the expected people only: an OK-off decision waits on the
-- venue's managers, and on the owners only where the venue has no active
-- manager (§2.21).
--
-- VISIBILITY. MGMT at the venue reads every run. Anyone else reads only runs
-- they are involved in (the starter, or an assignee or actor of any step):
-- every step's status and name, their own submissions, and the records and
-- photos of steps whose def says record_visibility = 'run'. A 'mgmt' step's
-- records, photos, decision notes and skip note, and the run's data (except
-- to the starter), come back as null or []. Owner-added steps of a hiring run
-- count as 'mgmt', as every built-in hiring step does. The staff-media
-- bucket follows the same rule (section 7): its read policy, re-issued here
-- from 0159, asks app.staff_media_visible, so a signed URL or a listing
-- shows no photo the reads above would hide.
--
-- LOCKS. Every write locks the run row first (FOR UPDATE), then the step, then
-- the submission, so two sends on one run are serialised and the opening rule
-- never runs on a half-written state.
--
-- covered by packages/db/tests/protocols-engine.test.ts,
-- protocols-engine-flow.test.ts and protocols-roles.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 1. Internal helpers. Definer, pinned search_path, revoked from every client
--    role: reached only from the RPCs below.
-- ===========================================================================

-- The def of one step: the §2.8 entry for a built-in step, the generic def
-- ({note?}, photos in `steps`, 0 to 6) for the owner's own.
create or replace function app.protocol_step_def(p_kind text, p_variant text, p_step_key text)
returns jsonb
language sql immutable parallel safe set search_path = public as $protocol_step_def_0164$
  select case
    when p_step_key is null then jsonb_build_object(
      'step_key', null, 'name_en', null, 'name_ar', null, 'actor_roles', null,
      'assign_to_starter', false, 'needs_owner_ok', null, 'ok_fixed', false, 'optional', null,
      'after', '[]'::jsonb, 'fixed', null,
      'photo_folder', 'steps', 'photos_min', 0, 'photos_max', 6,
      'record_visibility', case when p_kind = 'hiring' then 'mgmt' else 'run' end)
    else (select d
            from jsonb_array_elements(app.protocol_step_defs(p_kind, p_variant)) d
           where d->>'step_key' = p_step_key)
  end
$protocol_step_def_0164$;

comment on function app.protocol_step_def(text, text, text) is
  'protocols_engine_rpcs (§2.7). Internal: one step''s def, the app.protocol_step_defs entry of a built-in step, or for an owner-added step (NULL key) the generic def: note-only record, photos in steps, 0 to 6, record_visibility run (mgmt in a hiring run).';

revoke all on function app.protocol_step_def(text, text, text) from public, anon, authenticated;

-- Trimmed text, NULL when blank, TEXT_TOO_LONG (hint = the field) past the cap.
create or replace function app.protocol_engine_text(p_text text, p_cap int, p_hint text)
returns text
language plpgsql immutable set search_path = public as $protocol_engine_text_0164$
declare
  v text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if v is not null and length(v) > p_cap then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = p_hint;
  end if;
  return v;
end $protocol_engine_text_0164$;

comment on function app.protocol_engine_text(text, int, text) is
  'protocols_engine_rpcs (§2.1). Internal: trims a text argument, NULL when blank; raises TEXT_TOO_LONG with the field as hint past p_cap characters.';

revoke all on function app.protocol_engine_text(text, int, text) from public, anon, authenticated;

-- A role list the owner picked for their own step: a non-empty array of
-- distinct hireable roles (never the owner, never the retired prep).
create or replace function app.protocol_engine_roles(p_roles jsonb)
returns staff_role[]
language plpgsql stable set search_path = public as $protocol_engine_roles_0164$
declare
  c_hireable constant text[] := array['cashier','court_desk','manager','head_barista','barista',
                                      'head_chef','chef','driver','marketing'];
  v_roles text[];
begin
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' or jsonb_array_length(p_roles) = 0
     or exists (select 1 from jsonb_array_elements(p_roles) e where jsonb_typeof(e) <> 'string') then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'actor_roles';
  end if;
  v_roles := array(select jsonb_array_elements_text(p_roles));
  if exists (select 1 from unnest(v_roles) r where not (r = any(c_hireable)))
     or cardinality(v_roles) <> (select count(distinct r) from unnest(v_roles) r) then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'actor_roles';
  end if;
  return v_roles::staff_role[];
end $protocol_engine_roles_0164$;

comment on function app.protocol_engine_roles(jsonb) is
  'protocols_engine_rpcs (§2.7). Internal: parses an owner-added step''s actor_roles; INVALID_ROLE unless a non-empty array of distinct hireable roles (cashier, court_desk, manager, head_barista, barista, head_chef, chef, driver, marketing).';

revoke all on function app.protocol_engine_roles(jsonb) from public, anon, authenticated;

-- A checklist the owner typed: at most 12 lines, both languages, 200 each.
-- Returns [{text_en, text_ar}] trimmed.
create or replace function app.protocol_engine_items(p_items jsonb)
returns jsonb
language plpgsql immutable set search_path = public as $protocol_engine_items_0164$
declare
  v_el  jsonb;
  v_en  text;
  v_ar  text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_items is null or p_items = 'null'::jsonb then
    return v_out;
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if jsonb_array_length(p_items) > 12 then
    raise exception 'LIST_TOO_LONG' using errcode = 'P0001', hint = 'items';
  end if;
  for v_el in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_en := app.protocol_engine_text(v_el->>'text_en', 200, 'items');
    v_ar := app.protocol_engine_text(v_el->>'text_ar', 200, 'items');
    if v_en is null or v_ar is null then
      raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'items';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('text_en', v_en, 'text_ar', v_ar));
  end loop;
  return v_out;
end $protocol_engine_items_0164$;

comment on function app.protocol_engine_items(jsonb) is
  'protocols_engine_rpcs (§2.7). Internal: validates a checklist the owner typed, [{text_en, text_ar}], at most 12 lines (LIST_TOO_LONG), both languages (TEXT_BOTH_LANGUAGES_REQUIRED), 200 characters each (TEXT_TOO_LONG); returns it trimmed.';

revoke all on function app.protocol_engine_items(jsonb) from public, anon, authenticated;

-- May the caller act on a step? p_cover = false is the expected actor only
-- (To do); true adds the manager's and the owner's cover (the Send button).
create or replace function app.protocol_engine_actor(
  p_venue       uuid,
  p_actor_roles staff_role[],
  p_assigned_to uuid,
  p_cover       boolean
) returns boolean
language sql stable security definer set search_path = public as $protocol_engine_actor_0164$
  select coalesce(
       app.staff_role() is not null
       and p_venue = any(app.staff_venue_ids())
       and (   (p_assigned_to is not null and p_assigned_to = auth.uid())
            or (p_assigned_to is null and app.is_staff_at(p_venue, variadic p_actor_roles))
            or (p_cover and app.is_staff('owner'))
            or (p_cover and app.is_staff_at(p_venue, 'manager')
                and not ('owner' = any(p_actor_roles)))),
       false)
$protocol_engine_actor_0164$;

comment on function app.protocol_engine_actor(uuid, staff_role[], uuid, boolean) is
  'protocols_engine_rpcs (§2.7 "Who may act"). Internal: true when the caller is the step''s assignee, or (no assignee) holds an actor role at the venue; with p_cover also when the caller is the owner, or a manager at the venue on a step whose actors do not include the owner.';

revoke all on function app.protocol_engine_actor(uuid, staff_role[], uuid, boolean) from public, anon, authenticated;

-- Does the caller decide a step? p_expected = false is who MAY decide (the
-- owner with OK on; a manager at the venue or the owner with it off); true is
-- who the decision WAITS on (OK off: the venue's managers, or the owners where
-- the venue has no active manager), for the lists and the badges.
create or replace function app.protocol_engine_decider(p_venue uuid, p_needs_owner_ok boolean, p_expected boolean)
returns boolean
language sql stable security definer set search_path = public as $protocol_engine_decider_0164$
  select coalesce(case
    when p_needs_owner_ok then app.is_staff('owner') and p_venue = any(app.staff_venue_ids())
    when not p_expected then app.is_staff_at(p_venue, 'manager', 'owner')
    else app.is_staff_at(p_venue, 'manager')
         or (app.is_staff('owner') and p_venue = any(app.staff_venue_ids())
             and cardinality(app.staff_ids_with_roles(p_venue, '{manager}')) = 0)
  end, false)
$protocol_engine_decider_0164$;

comment on function app.protocol_engine_decider(uuid, boolean, boolean) is
  'protocols_engine_rpcs (§2.7 "Who decides"). Internal: with p_expected false, true when the caller may decide (the owner when needs_owner_ok; else a manager at the venue or the owner); with p_expected true, when the decision waits on the caller (OK off: the venue''s managers, the owners only where the venue has no active manager).';

revoke all on function app.protocol_engine_decider(uuid, boolean, boolean) from public, anon, authenticated;

-- Who is told a step opened: the assignee, else every active holder of an
-- actor role at the venue (owners count everywhere).
create or replace function app.protocol_engine_actor_ids(p_venue uuid, p_actor_roles staff_role[], p_assigned_to uuid)
returns uuid[]
language sql stable security definer set search_path = public as $protocol_engine_actor_ids_0164$
  select case when p_assigned_to is not null then array[p_assigned_to]
              else app.staff_ids_with_roles(p_venue, p_actor_roles) end
$protocol_engine_actor_ids_0164$;

comment on function app.protocol_engine_actor_ids(uuid, staff_role[], uuid) is
  'protocols_engine_rpcs (§2.21). Internal: the recipients of step_open, the step''s assignee or else the active holders of its actor roles at the venue.';

revoke all on function app.protocol_engine_actor_ids(uuid, staff_role[], uuid) from public, anon, authenticated;

-- Who is told a submission waits: the owners with OK on; else the venue's
-- managers, or the owners where there is none (§2.21).
create or replace function app.protocol_engine_decider_ids(p_venue uuid, p_needs_owner_ok boolean)
returns uuid[]
language sql stable security definer set search_path = public as $protocol_engine_decider_ids_0164$
  select case
    when p_needs_owner_ok then app.staff_ids_with_roles(p_venue, '{owner}')
    when cardinality(app.staff_ids_with_roles(p_venue, '{manager}')) > 0
      then app.staff_ids_with_roles(p_venue, '{manager}')
    else app.staff_ids_with_roles(p_venue, '{owner}')
  end
$protocol_engine_decider_ids_0164$;

comment on function app.protocol_engine_decider_ids(uuid, boolean) is
  'protocols_engine_rpcs (§2.21). Internal: the recipients of step_submitted, the owners when needs_owner_ok, else the venue''s active managers, or the owners when the venue has none.';

revoke all on function app.protocol_engine_decider_ids(uuid, boolean) from public, anon, authenticated;

-- One protocol push through app.notify_staff, in the §2.21 shape:
-- {route, id, title_key, params: {step?: {en, ar}, title?}}. The title is the
-- run's (whichever language the starter typed), left out of a hiring run's
-- push. No record, figure or note ever reaches a lock screen.
create or replace function app.protocol_engine_notify(
  p_ids       uuid[],
  p_kind      text,
  p_title_key text,
  p_route     text,
  p_id        uuid,
  p_run_id    uuid,
  p_step_id   uuid
) returns int
language plpgsql security definer set search_path = public as $protocol_engine_notify_0164$
declare
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_params jsonb := '{}'::jsonb;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if p_step_id is not null then
    select * into v_step from protocol_run_steps where id = p_step_id;
    v_params := v_params || jsonb_build_object('step', jsonb_build_object('en', v_step.name_en, 'ar', v_step.name_ar));
  end if;
  if v_run.kind <> 'hiring' then
    v_params := v_params || jsonb_build_object(
      'title', coalesce(nullif(btrim(v_run.title_en), ''), v_run.title_ar));
  end if;
  return app.notify_staff(
    p_ids, p_kind,
    jsonb_build_object('route', p_route, 'id', p_id, 'title_key', p_title_key, 'params', v_params));
end $protocol_engine_notify_0164$;

comment on function app.protocol_engine_notify(uuid[], text, text, text, uuid, uuid, uuid) is
  'protocols_engine_rpcs (§2.21). Internal: queues one protocol push per recipient through app.notify_staff, payload {route, id, title_key, params: {step?: {en, ar}, title?}}; the run title is left out for hiring runs. Returns the rows queued.';

revoke all on function app.protocol_engine_notify(uuid[], text, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. The engine's moves. Called with the run row already locked.
-- ===========================================================================

-- The opening rule (§2.7): open every waiting step whose dependencies are all
-- passed or skipped and whose lower owner-added steps are too. An owner-added
-- step waits for every step below it; the terminal step waits for every other
-- step. Tells each opened step's actors. Returns the ids opened.
create or replace function app.protocol_engine_open(p_run_id uuid)
returns uuid[]
language plpgsql security definer set search_path = public as $protocol_engine_open_0164$
declare
  v_run    protocol_runs%rowtype;
  v_last   text;
  v_step   protocol_run_steps%rowtype;
  v_ready  boolean;
  v_opened uuid[] := '{}';
begin
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or v_run.status <> 'active' then
    return v_opened;
  end if;
  v_last := (select d->>'step_key'
               from jsonb_array_elements(app.protocol_step_defs(v_run.kind, v_run.variant)) d
              where d->>'fixed' = 'last');

  for v_step in
    select * from protocol_run_steps s
     where s.run_id = p_run_id and s.status = 'waiting'
     order by s.position
  loop
    if v_step.step_key is null then
      v_ready := not exists (select 1 from protocol_run_steps o
                              where o.run_id = p_run_id
                                and o.position < v_step.position
                                and o.status not in ('passed', 'skipped'));
    else
      v_ready := not exists (select 1 from protocol_run_steps o
                              where o.run_id = p_run_id
                                and (o.step_key = any(v_step.after_keys)
                                     or (o.step_key is null and o.position < v_step.position))
                                and o.status not in ('passed', 'skipped'));
    end if;
    if v_ready and coalesce(v_step.step_key = v_last, false) then
      v_ready := not exists (select 1 from protocol_run_steps o
                              where o.run_id = p_run_id
                                and o.id <> v_step.id
                                and o.status not in ('passed', 'skipped'));
    end if;

    if v_ready and app.protocol_step_allowed(v_step.status, 'open') then
      update protocol_run_steps set status = 'open', opened_at = now() where id = v_step.id;
      v_opened := v_opened || v_step.id;
      perform app.protocol_engine_notify(
        app.protocol_engine_actor_ids(v_run.venue_id, v_step.actor_roles, v_step.assigned_to),
        'staff_task', 'step_open', 'staff-step', v_step.id, p_run_id, v_step.id);
    end if;
  end loop;
  return v_opened;
end $protocol_engine_open_0164$;

comment on function app.protocol_engine_open(uuid) is
  'protocols_engine_rpcs (§2.7 "Opening"). Internal: opens every waiting step of an active run whose after_keys are all passed or skipped and whose lower owner-added steps are too (an owner-added step waits for every lower step; the terminal step for every other step), queues step_open for each, and returns the ids opened.';

revoke all on function app.protocol_engine_open(uuid) from public, anon, authenticated;

-- A pass (an approval or an automatic pass): the pass hook, the step to
-- passed, then the terminal step finishes the run (the finish hook's done,
-- live or scheduled; done without one) and any other step opens what it
-- unblocks. Returns the ids opened.
create or replace function app.protocol_engine_pass(
  p_run_id        uuid,
  p_step_id       uuid,
  p_submission_id uuid,
  p_decision_data jsonb
) returns uuid[]
language plpgsql security definer set search_path = public as $protocol_engine_pass_0164$
declare
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_hook   text;
  v_target text;
  v_now    text;
begin
  select * into v_run from protocol_runs where id = p_run_id;
  select * into v_step from protocol_run_steps where id = p_step_id;

  if v_step.step_key is not null then
    v_hook := format('protocol_pass_%s_%s', v_run.kind, v_step.step_key);
    if to_regprocedure(format('app.%I(uuid, uuid, jsonb)', v_hook)) is not null then
      execute format('select app.%I($1, $2, $3)', v_hook)
        using v_step.id, p_submission_id, coalesce(p_decision_data, '{}'::jsonb);
    end if;
  end if;

  if not app.protocol_step_allowed(v_step.status, 'passed') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', hint = v_step.status || ' -> passed';
  end if;
  update protocol_run_steps set status = 'passed', passed_at = now() where id = v_step.id;

  if coalesce(app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key)->>'fixed' = 'last', false) then
    v_target := 'done';
    v_hook := format('protocol_finish_%s', v_run.kind);
    if to_regprocedure(format('app.%I(uuid)', v_hook)) is not null then
      execute format('select app.%I($1)', v_hook) into v_target using v_run.id;
    end if;
    if v_target is null or v_target not in ('done', 'live', 'scheduled') then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', hint = 'finish: ' || coalesce(v_target, 'null');
    end if;
    -- A pass hook may already have moved the run (a launch goes live, an
    -- apply is done); the engine only completes what it has not.
    select status into v_now from protocol_runs where id = v_run.id;
    if v_now <> v_target then
      if not app.protocol_run_allowed(v_now, v_target) then
        raise exception 'INVALID_TRANSITION' using errcode = 'P0001', hint = v_now || ' -> ' || v_target;
      end if;
      update protocol_runs
         set status      = v_target,
             finished_at = case when v_target = 'done' then now() else finished_at end,
             live_at     = case when v_target = 'live' then coalesce(live_at, now()) else live_at end
       where id = v_run.id;
    end if;
    return '{}'::uuid[];
  end if;

  return app.protocol_engine_open(v_run.id);
end $protocol_engine_pass_0164$;

comment on function app.protocol_engine_pass(uuid, uuid, uuid, jsonb) is
  'protocols_engine_rpcs (§2.7). Internal: passes a step: its pass hook (protocol_pass_<kind>_<key>, with the decision data, or the record on an automatic pass), status passed, then for the terminal step the finish hook''s run status (done, live or scheduled; done without a hook), else the opening rule. Returns the step ids opened.';

revoke all on function app.protocol_engine_pass(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- One submission on an open step, for start_protocol (step 1) and submit_step.
create or replace function app.protocol_engine_submit(
  p_run_id  uuid,
  p_step_id uuid,
  p_record  jsonb,
  p_photos  text[]
) returns jsonb
language plpgsql security definer set search_path = public as $protocol_engine_submit_0164$
declare
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_def    jsonb;
  v_photos text[];
  v_record jsonb;
  v_hook   text;
  v_bad    text;
  v_note   text;
  v_sub    uuid;
  v_auto   boolean;
  v_opened uuid[] := '{}';
begin
  select * into v_run from protocol_runs where id = p_run_id;
  select * into v_step from protocol_run_steps where id = p_step_id;
  v_def := app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key);

  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'record';
  end if;

  -- Photos: each path once, in the order sent, within the def's count (a step
  -- with no folder takes none). Ownership and folder are claim_staff_media's.
  if p_photos is not null and array_position(p_photos, null) is not null then
    raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
  end if;
  v_photos := coalesce(array(select u.x
                               from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as u(x, o)
                              group by u.x
                              order by min(u.o)), '{}'::text[]);
  if cardinality(v_photos) < coalesce((v_def->>'photos_min')::int, 0)
     or cardinality(v_photos) > coalesce((v_def->>'photos_max')::int, 0) then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'photos';
  end if;

  -- The record: the kind's check hook for a built-in step, else the generic
  -- {note?} (owner-added steps always; a built-in step whose kind has not
  -- landed its hook yet).
  v_hook := case when v_step.step_key is not null
                 then format('protocol_check_%s_%s', v_run.kind, v_step.step_key) end;
  if v_hook is not null and to_regprocedure(format('app.%I(uuid, jsonb, text[])', v_hook)) is not null then
    execute format('select app.%I($1, $2, $3)', v_hook) into v_record using v_step.id, p_record, v_photos;
    if v_record is null or jsonb_typeof(v_record) <> 'object' then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'record';
    end if;
  else
    select k into v_bad from jsonb_object_keys(p_record) k where k <> 'note' limit 1;
    if v_bad is not null then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = v_bad;
    end if;
    if p_record ? 'note' and jsonb_typeof(p_record->'note') not in ('string', 'null') then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'note';
    end if;
    v_note := app.protocol_engine_text(p_record->>'note', 2000, 'note');
    v_record := case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end;
  end if;

  insert into protocol_submissions (run_step_id, run_id, round, submitted_by, record, photos)
  values (v_step.id, v_run.id, v_step.round, auth.uid(), v_record, v_photos)
  returning id into v_sub;

  -- Claimed once the row that names them exists (§2.3). A resubmission may
  -- re-claim the photos of this step's withdrawn, superseded or sent-back
  -- submission, or of one from an earlier round (section 7).
  if cardinality(v_photos) > 0 then
    perform app.claim_staff_media(v_photos, v_run.venue_id, array[v_def->>'photo_folder'],
                                  'protocol_submission:' || v_sub::text);
  end if;

  if v_step.step_key is not null then
    v_hook := format('protocol_submit_%s_%s', v_run.kind, v_step.step_key);
    if to_regprocedure(format('app.%I(uuid)', v_hook)) is not null then
      execute format('select app.%I($1)', v_hook) using v_sub;
    end if;
  end if;

  if not app.protocol_step_allowed(v_step.status, 'submitted') then
    raise exception 'STEP_NOT_OPEN' using errcode = 'P0001';
  end if;
  update protocol_run_steps set status = 'submitted' where id = v_step.id;

  perform app.write_audit('protocol.submit', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('run_step_id', v_step.id, 'submission_id', v_sub, 'step_key', v_step.step_key,
                       'round', v_step.round, 'photos', cardinality(v_photos)));

  -- The sender decides this step: it passes now, and the record is the
  -- decision data (a manager's own proposal carries its category, §2.8).
  v_auto := app.protocol_engine_decider(v_run.venue_id, v_step.needs_owner_ok, false);
  if v_auto then
    update protocol_submissions
       set decision = 'auto', decided_by = auth.uid(), decided_at = now()
     where id = v_sub;
    perform app.write_audit('protocol.auto', 'protocol_run', v_run.id::text, null,
      jsonb_build_object('run_step_id', v_step.id, 'submission_id', v_sub, 'step_key', v_step.step_key));
    v_opened := app.protocol_engine_pass(v_run.id, v_step.id, v_sub, v_record);
  else
    perform app.protocol_engine_notify(
      app.protocol_engine_decider_ids(v_run.venue_id, v_step.needs_owner_ok),
      'staff_decide', 'step_submitted', 'staff-step', v_step.id, v_run.id, v_step.id);
  end if;

  return jsonb_build_object(
    'submission_id',   v_sub,
    'auto',            v_auto,
    'step_status',     (select s.status from protocol_run_steps s where s.id = v_step.id),
    'run_status',      (select r.status from protocol_runs r where r.id = v_run.id),
    'opened_step_ids', to_jsonb(v_opened));
end $protocol_engine_submit_0164$;

comment on function app.protocol_engine_submit(uuid, uuid, jsonb, text[]) is
  'protocols_engine_rpcs (§2.7). Internal: one submission on an open step: photo count (RECORD_INVALID hint photos), the check hook or the generic {note?}, the row, app.claim_staff_media, the submit hook, status submitted, audit protocol.submit; then an automatic pass (protocol.auto) when the sender decides the step, else step_submitted to the deciders. Returns {submission_id, auto, step_status, run_status, opened_step_ids}.';

revoke all on function app.protocol_engine_submit(uuid, uuid, jsonb, text[]) from public, anon, authenticated;

-- The kind's stop hook, when it has one (a run stopped or withdrawn).
create or replace function app.protocol_engine_stop_hook(p_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_engine_stop_hook_0164$
declare
  v_hook text;
begin
  select format('protocol_stop_%s', r.kind) into v_hook from protocol_runs r where r.id = p_run_id;
  if v_hook is not null and to_regprocedure(format('app.%I(uuid)', v_hook)) is not null then
    execute format('select app.%I($1)', v_hook) using p_run_id;
  end if;
end $protocol_engine_stop_hook_0164$;

comment on function app.protocol_engine_stop_hook(uuid) is
  'protocols_engine_rpcs (§2.7). Internal: runs protocol_stop_<kind> for a run that was stopped or withdrawn, when the kind has one.';

revoke all on function app.protocol_engine_stop_hook(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Read helpers: the shared JSON shapes (§2.7), shaped for the caller.
-- ===========================================================================

create or replace function app.protocol_engine_involved(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public as $protocol_engine_involved_0164$
  select coalesce((
    select r.started_by = auth.uid()
        or exists (select 1 from protocol_run_steps s
                    where s.run_id = r.id
                      and (   (s.assigned_to is not null and s.assigned_to = auth.uid())
                           or (s.assigned_to is null and app.is_staff_at(r.venue_id, variadic s.actor_roles))))
      from protocol_runs r
     where r.id = p_run_id), false)
$protocol_engine_involved_0164$;

comment on function app.protocol_engine_involved(uuid) is
  'protocols_engine_rpcs (§2.7 "Visibility"). Internal: true when the caller started the run, or is an assignee of one of its steps, or holds an actor role of an unassigned step at the run''s venue.';

revoke all on function app.protocol_engine_involved(uuid) from public, anon, authenticated;

create or replace function app.protocol_engine_waiting_on_me(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public as $protocol_engine_waiting_on_me_0164$
  select coalesce((
    select r.status = 'active'
       and (exists (select 1 from protocol_run_steps s
                     where s.run_id = r.id and s.status = 'open'
                       and app.protocol_engine_actor(r.venue_id, s.actor_roles, s.assigned_to, false))
            or exists (select 1
                         from protocol_submissions sub
                         join protocol_run_steps s on s.id = sub.run_step_id
                        where sub.run_id = r.id
                          and s.status = 'submitted'
                          and sub.decision is null and sub.withdrawn_at is null and sub.superseded_at is null
                          and sub.submitted_by <> auth.uid()
                          and app.protocol_engine_decider(r.venue_id, s.needs_owner_ok, true)))
      from protocol_runs r
     where r.id = p_run_id), false)
$protocol_engine_waiting_on_me_0164$;

comment on function app.protocol_engine_waiting_on_me(uuid) is
  'protocols_engine_rpcs (§2.7). Internal: true when an active run has an open step the caller is expected to do, or a pending submission whose decision waits on the caller (not their own).';

revoke all on function app.protocol_engine_waiting_on_me(uuid) from public, anon, authenticated;

-- RunRow.
create or replace function app.protocol_engine_run_row(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $protocol_engine_run_row_0164$
  select jsonb_build_object(
           'id',              r.id,
           'kind',            r.kind,
           'variant',         r.variant,
           'title_en',        r.title_en,
           'title_ar',        r.title_ar,
           'status',          r.status,
           'started_by',      r.started_by,
           'started_by_name', (select st.display_name from staff st where st.id = r.started_by),
           'started_at',      r.started_at,
           'finished_at',     r.finished_at,
           'scheduled_for',   r.scheduled_for,
           'live_at',         r.live_at,
           'menu_item_id',    r.menu_item_id,
           'promotion_id',    r.promotion_id,
           'current_steps',   coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', s.id, 'position', s.position, 'step_key', s.step_key,
                      'name_en', s.name_en, 'name_ar', s.name_ar, 'status', s.status, 'round', s.round)
                    order by s.position)
               from protocol_run_steps s
              where s.run_id = r.id and s.status in ('open', 'submitted')), '[]'::jsonb),
           'waiting_on_me',   app.protocol_engine_waiting_on_me(r.id))
    from protocol_runs r
   where r.id = p_run_id
$protocol_engine_run_row_0164$;

comment on function app.protocol_engine_run_row(uuid) is
  'protocols_engine_rpcs (§2.7). Internal: a run as RunRow {id, kind, variant, title_en, title_ar, status, started_by, started_by_name, started_at, finished_at, scheduled_for, live_at, menu_item_id, promotion_id, current_steps: [StepBrief], waiting_on_me}.';

revoke all on function app.protocol_engine_run_row(uuid) from public, anon, authenticated;

-- StepRow. p_full = MGMT at the venue; otherwise a 'mgmt' step's records,
-- photos, decision notes and skip note are hidden, except on the caller's own
-- submissions.
create or replace function app.protocol_engine_step_row(p_step_id uuid, p_full boolean)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_engine_step_row_0164$
declare
  v_step protocol_run_steps%rowtype;
  v_run  protocol_runs%rowtype;
  v_show boolean;
begin
  select * into v_step from protocol_run_steps where id = p_step_id;
  if not found then
    return null;
  end if;
  select * into v_run from protocol_runs where id = v_step.run_id;
  v_show := p_full
            or coalesce(app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key)->>'record_visibility',
                        'run') = 'run';

  return jsonb_build_object(
    'id',               v_step.id,
    'position',         v_step.position,
    'step_key',         v_step.step_key,
    'name_en',          v_step.name_en,
    'name_ar',          v_step.name_ar,
    'status',           v_step.status,
    'round',            v_step.round,
    'actor_roles',      to_jsonb(v_step.actor_roles),
    'assigned_to',      v_step.assigned_to,
    'assigned_to_name', (select st.display_name from staff st where st.id = v_step.assigned_to),
    'needs_owner_ok',   v_step.needs_owner_ok,
    'optional',         v_step.optional,
    'after_keys',       to_jsonb(v_step.after_keys),
    'opened_at',        v_step.opened_at,
    'passed_at',        v_step.passed_at,
    'skip_note',        case when v_show then v_step.skip_note end,
    'skipped_by_name',  (select st.display_name from staff st where st.id = v_step.skipped_by),
    'skipped_at',       v_step.skipped_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'position', i.position, 'text_en', i.text_en, 'text_ar', i.text_ar,
               'done_by', i.done_by,
               'done_by_name', (select st.display_name from staff st where st.id = i.done_by),
               'done_at', i.done_at)
             order by i.position, i.id)
        from protocol_run_items i
       where i.run_step_id = v_step.id), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',                sub.id,
               'round',             sub.round,
               'submitted_by',      sub.submitted_by,
               'submitted_by_name', (select st.display_name from staff st where st.id = sub.submitted_by),
               'submitted_at',      sub.submitted_at,
               'record',            case when v_show or sub.submitted_by = auth.uid() then sub.record end,
               'photos',            case when v_show or sub.submitted_by = auth.uid()
                                         then to_jsonb(sub.photos) else '[]'::jsonb end,
               'withdrawn_at',      sub.withdrawn_at,
               'superseded_at',     sub.superseded_at,
               'decision',          sub.decision,
               'decided_by',        sub.decided_by,
               'decided_by_name',   (select st.display_name from staff st where st.id = sub.decided_by),
               'decided_at',        sub.decided_at,
               'decision_note',     case when v_show or sub.submitted_by = auth.uid() then sub.decision_note end,
               'send_back_to',      sub.send_back_to)
             order by sub.submitted_at, sub.id)
        from protocol_submissions sub
       where sub.run_step_id = v_step.id), '[]'::jsonb));
end $protocol_engine_step_row_0164$;

comment on function app.protocol_engine_step_row(uuid, boolean) is
  'protocols_engine_rpcs (§2.7). Internal: a run step as StepRow (StepBrief + actors, assignee, flags, times, skip, items: [ItemRow], submissions: [SubmissionRow]). Without p_full, a step whose def says record_visibility mgmt returns other people''s records and decision notes as null, their photos as [] and its skip note as null.';

revoke all on function app.protocol_engine_step_row(uuid, boolean) from public, anon, authenticated;

-- Can: what the caller may do on the run, and on one step of it when given.
create or replace function app.protocol_engine_can(p_run_id uuid, p_step_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_engine_can_0164$
declare
  v_run      protocol_runs%rowtype;
  v_step     protocol_run_steps%rowtype;
  v_last     protocol_run_steps%rowtype;
  v_sub      protocol_submissions%rowtype;
  v_has_step boolean := false;
  v_active   boolean;
  v_owner    boolean := app.is_staff('owner');
  v_may      boolean := false;
  v_decider  boolean := false;
  v_withdraw uuid;
  v_decide   uuid;
  v_targets  jsonb := '[]'::jsonb;
begin
  select * into v_run from protocol_runs where id = p_run_id;
  v_active := v_run.status = 'active';
  select s.* into v_last
    from protocol_run_steps s
   where s.run_id = v_run.id
     and s.step_key = (select d->>'step_key'
                         from jsonb_array_elements(app.protocol_step_defs(v_run.kind, v_run.variant)) d
                        where d->>'fixed' = 'last');

  if p_step_id is not null then
    select * into v_step from protocol_run_steps where id = p_step_id and run_id = v_run.id;
    v_has_step := found;
  end if;

  if v_has_step then
    v_may := app.protocol_engine_actor(v_run.venue_id, v_step.actor_roles, v_step.assigned_to, true);
    v_decider := app.protocol_engine_decider(v_run.venue_id, v_step.needs_owner_ok, false);
    select sub.* into v_sub
      from protocol_submissions sub
     where sub.run_step_id = v_step.id
       and sub.decision is null and sub.withdrawn_at is null and sub.superseded_at is null
     order by sub.submitted_at desc
     limit 1;
    if found and v_active then
      if v_sub.submitted_by = auth.uid() then
        v_withdraw := v_sub.id;
      end if;
      if v_step.status = 'submitted' and v_decider and v_sub.submitted_by <> auth.uid() then
        v_decide := v_sub.id;
        v_targets := coalesce((
          select jsonb_agg(s.id order by s.position)
            from protocol_run_steps s
           where s.run_id = v_run.id
             and (s.id = v_step.id or (s.status = 'passed' and s.position < v_step.position))), '[]'::jsonb);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'submit',                 coalesce(v_has_step and v_active and v_step.status = 'open' and v_may, false),
    'withdraw_submission_id', v_withdraw,
    'decide_submission_id',   v_decide,
    'send_back_targets',      v_targets,
    'skip',                   coalesce(v_has_step and v_active and v_step.optional
                                       and v_step.status in ('waiting', 'open') and v_decider, false),
    'tick',                   coalesce(v_has_step and v_active and v_step.status = 'open' and v_may, false),
    'edit_items',             coalesce(v_owner and v_active
                                       and (not v_has_step or v_step.status in ('waiting', 'open', 'submitted')), false),
    'add_step',               coalesce(v_owner and v_active and v_last.status = 'waiting', false),
    'stop',                   coalesce(app.is_staff_at(v_run.venue_id, 'manager', 'owner')
                                       and v_run.status in ('active', 'scheduled'), false),
    'withdraw_run',           coalesce(v_run.started_by = auth.uid() and v_active
                                       and not exists (select 1 from protocol_submissions sub
                                                        where sub.run_id = v_run.id and sub.decision is not null), false),
    'cancel_schedule',        coalesce(v_run.status = 'scheduled' and v_last.id is not null
                                       and app.protocol_engine_actor(v_run.venue_id, v_last.actor_roles,
                                                                     v_last.assigned_to, true), false));
end $protocol_engine_can_0164$;

comment on function app.protocol_engine_can(uuid, uuid) is
  'protocols_engine_rpcs (§2.7). Internal: the caller''s Can on a run, and on one of its steps when p_step_id is given: {submit, withdraw_submission_id, decide_submission_id, send_back_targets, skip, tick, edit_items, add_step, stop, withdraw_run, cancel_schedule}. Buttons follow it; the RPCs check again.';

revoke all on function app.protocol_engine_can(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 4. Starting and working a run.
-- ===========================================================================

create or replace function app.start_protocol(
  p_kind            text,
  p_variant         text   default null,
  p_title_en        text   default null,
  p_title_ar        text   default null,
  p_data            jsonb  default '{}',
  p_first_record    jsonb  default null,
  p_photos          text[] default '{}',
  p_venue_id        uuid   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $start_protocol_0164$
declare
  v_roles    staff_role[];
  v_venue    uuid;
  v_replay   jsonb;
  v_tpl      protocol_templates%rowtype;
  v_title_en text;
  v_title_ar text;
  v_run_id   uuid;
  v_first    protocol_run_steps%rowtype;
  v_data     jsonb;
  v_res      jsonb;
  v_result   jsonb;
begin
  -- Every kind's starters before any argument is read: a guest, the till or
  -- the desk stops here.
  if not app.is_staff('head_barista','head_chef','manager','owner','marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_roles := case p_kind
               when 'product_release' then '{head_barista,head_chef,manager,owner}'::staff_role[]
               when 'tournament'      then '{manager,owner}'::staff_role[]
               when 'hiring'          then '{manager,owner}'::staff_role[]
               when 'price_promo'     then '{manager,marketing,owner}'::staff_role[]
             end;
  if v_roles is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if not app.is_staff(variadic v_roles) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, variadic v_roles) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'start_protocol');
  if v_replay is not null then
    return v_replay;
  end if;

  if (p_kind = 'tournament') <> (p_variant is not null)
     or (p_variant is not null and p_variant not in ('type1', 'type2', 'type3')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'variant';
  end if;

  -- The owner types both titles (#19); anyone else may type one language (Q10).
  v_title_en := app.protocol_engine_text(p_title_en, 120, 'title');
  v_title_ar := app.protocol_engine_text(p_title_ar, 120, 'title');
  if app.is_staff('owner') and (v_title_en is null or v_title_ar is null) then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'title';
  end if;
  if v_title_en is null and v_title_ar is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'title';
  end if;

  -- Step 1 is submitted in this transaction, so its record is required.
  if p_first_record is null then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'record';
  end if;

  select * into v_tpl
    from protocol_templates t
   where t.venue_id = v_venue and t.kind = p_kind and t.variant is not distinct from p_variant;
  if not found then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if to_regprocedure(format('app.%I(uuid, jsonb)', 'protocol_start_' || p_kind)) is null then
    raise exception 'PROTOCOL_NOT_READY' using errcode = 'P0001';
  end if;

  insert into protocol_runs (venue_id, template_id, template_version, kind, variant, title_en, title_ar, started_by)
  values (v_venue, v_tpl.id, v_tpl.version, p_kind, p_variant, v_title_en, v_title_ar, auth.uid())
  returning id into v_run_id;

  -- The snapshot. A built-in step takes its actors, its optional flag and its
  -- dependencies from the def, and its OK from the def where the def fixes it
  -- (#58): a template row written around save_protocol_template cannot switch
  -- the owner's OK off a price step.
  insert into protocol_run_steps
    (run_id, position, step_key, name_en, name_ar, actor_roles, assigned_to, needs_owner_ok, optional, after_keys)
  select v_run_id,
         ts.position,
         ts.step_key,
         ts.name_en,
         ts.name_ar,
         case when d.def is null then ts.actor_roles
              else array(select jsonb_array_elements_text(d.def->'actor_roles'))::staff_role[] end,
         case when coalesce((d.def->>'assign_to_starter')::boolean, false) then auth.uid() end,
         case when coalesce((d.def->>'ok_fixed')::boolean, false) then (d.def->>'needs_owner_ok')::boolean
              else ts.needs_owner_ok end,
         case when d.def is null then ts.optional else (d.def->>'optional')::boolean end,
         case when d.def is null then '{}'::text[]
              else array(select jsonb_array_elements_text(d.def->'after')) end
    from protocol_template_steps ts
    left join lateral (select x as def
                         from jsonb_array_elements(app.protocol_step_defs(p_kind, p_variant)) x
                        where ts.step_key is not null and x->>'step_key' = ts.step_key) d on true
   where ts.template_id = v_tpl.id;

  insert into protocol_run_items (run_step_id, position, text_en, text_ar)
  select rs.id, ti.position, ti.text_en, ti.text_ar
    from protocol_template_steps ts
    join protocol_run_steps rs on rs.run_id = v_run_id and rs.position = ts.position
    join protocol_template_items ti on ti.step_id = ts.id
   where ts.template_id = v_tpl.id;

  -- The kind's start hook: in v1 it takes data = {} and only says the kind is
  -- ready; step 1's own check and submit hooks carry the first record.
  execute format('select app.%I($1, $2)', 'protocol_start_' || p_kind)
    into v_data using v_run_id, coalesce(p_data, '{}'::jsonb);
  if v_data is not null and jsonb_typeof(v_data) <> 'object' then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'data';
  end if;
  update protocol_runs set data = coalesce(v_data, '{}'::jsonb) where id = v_run_id;

  perform app.write_audit('protocol.start', 'protocol_run', v_run_id::text, null,
    jsonb_build_object('kind', p_kind, 'variant', p_variant, 'template_id', v_tpl.id,
                       'template_version', v_tpl.version));

  select * into v_first from protocol_run_steps where run_id = v_run_id order by position limit 1;
  if not app.protocol_engine_actor(v_venue, v_first.actor_roles, v_first.assigned_to, true) then
    raise exception 'NOT_STEP_ACTOR' using errcode = 'P0001';
  end if;
  update protocol_run_steps set status = 'open', opened_at = now() where id = v_first.id;
  v_res := app.protocol_engine_submit(v_run_id, v_first.id, p_first_record, p_photos);

  v_result := jsonb_build_object(
    'run_id',        v_run_id,
    'status',        (select r.status from protocol_runs r where r.id = v_run_id),
    'first_step_id', v_first.id,
    'submission_id', v_res->'submission_id',
    'auto',          v_res->'auto');
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $start_protocol_0164$;

comment on function app.start_protocol(text, text, text, text, jsonb, jsonb, text[], uuid, text) is
  'protocols_engine_rpcs (§2.7). Starts a run of the venue''s template for p_kind (tournament: p_variant) and submits step 1 from p_first_record in the same transaction. Starters by kind: product_release head_barista, head_chef, manager, owner; tournament and hiring manager, owner; price_promo manager, marketing, owner. The owner types both titles, anyone else at least one. Returns {run_id, status, first_step_id, submission_id, auto}. PROTOCOL_NOT_READY until the kind''s start hook exists. Idempotent on p_idempotency_key. Audit protocol.start, protocol.submit (+ protocol.auto).';

revoke all on function app.start_protocol(text, text, text, text, jsonb, jsonb, text[], uuid, text) from public, anon;
grant execute on function app.start_protocol(text, text, text, text, jsonb, jsonb, text[], uuid, text) to authenticated;

create or replace function app.submit_step(
  p_run_step_id     uuid,
  p_record          jsonb,
  p_photos          text[] default '{}',
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_step_0164$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_replay jsonb;
  v_result jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'submit_step');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_step from protocol_run_steps where id = p_run_step_id for update;
  if v_run.status <> 'active' then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;
  if v_step.status <> 'open' then
    raise exception 'STEP_NOT_OPEN' using errcode = 'P0001';
  end if;
  if not app.protocol_engine_actor(v_run.venue_id, v_step.actor_roles, v_step.assigned_to, true) then
    raise exception 'NOT_STEP_ACTOR' using errcode = 'P0001';
  end if;

  v_result := app.protocol_engine_submit(v_run.id, v_step.id, p_record, p_photos);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $submit_step_0164$;

comment on function app.submit_step(uuid, jsonb, text[], text) is
  'protocols_engine_rpcs (§2.7). Any active staff member who may act on the open step (its assignee or actor, or a manager or owner covering): sends its record and photos. Passes at once when the sender decides the step. Returns {submission_id, auto, step_status, run_status, opened_step_ids}. PROTOCOL_NOT_FOUND, PROTOCOL_CLOSED, STEP_NOT_OPEN, NOT_STEP_ACTOR, RECORD_INVALID, PHOTO_PATH_INVALID, TEXT_TOO_LONG and the check hook''s codes. Idempotent on p_idempotency_key. Audit protocol.submit (+ protocol.auto).';

revoke all on function app.submit_step(uuid, jsonb, text[], text) from public, anon;
grant execute on function app.submit_step(uuid, jsonb, text[], text) to authenticated;

create or replace function app.withdraw_step(p_submission_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $withdraw_step_0164$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_sub    protocol_submissions%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select x.run_id into v_run_id from protocol_submissions x where x.id = p_submission_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  select * into v_step
    from protocol_run_steps
   where id = (select x.run_step_id from protocol_submissions x where x.id = p_submission_id)
   for update;
  select * into v_sub from protocol_submissions where id = p_submission_id for update;

  if v_sub.submitted_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_sub.decision is not null or v_sub.withdrawn_at is not null or v_sub.superseded_at is not null
     or not app.protocol_step_allowed(v_step.status, 'open') then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if v_run.status <> 'active' then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;

  update protocol_submissions set withdrawn_at = now() where id = v_sub.id;
  update protocol_run_steps set status = 'open' where id = v_step.id;

  perform app.write_audit('protocol.withdraw', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('run_step_id', v_step.id, 'submission_id', v_sub.id));

  return jsonb_build_object('step_status', 'open');
end $withdraw_step_0164$;

comment on function app.withdraw_step(uuid) is
  'protocols_engine_rpcs (§2.7). The sender takes back an undecided submission; the step reopens. FORBIDDEN for anyone else, SUBMISSION_DECIDED once decided, withdrawn or superseded. Returns {step_status}. Audit protocol.withdraw.';

revoke all on function app.withdraw_step(uuid) from public, anon;
grant execute on function app.withdraw_step(uuid) to authenticated;

create or replace function app.decide_step(
  p_submission_id uuid,
  p_decision      text,
  p_note          text  default null,
  p_send_back_to  uuid  default null,
  p_data          jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $decide_step_0164$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_sub    protocol_submissions%rowtype;
  v_target protocol_run_steps%rowtype;
  v_note   text;
  v_last   text;
  v_reset  uuid[];
  v_opened uuid[] := '{}';
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select x.run_id into v_run_id from protocol_submissions x where x.id = p_submission_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  select * into v_step
    from protocol_run_steps
   where id = (select x.run_step_id from protocol_submissions x where x.id = p_submission_id)
   for update;
  select * into v_sub from protocol_submissions where id = p_submission_id for update;

  if v_run.status <> 'active' then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;
  if v_sub.decision is not null or v_sub.withdrawn_at is not null or v_sub.superseded_at is not null
     or v_step.status <> 'submitted' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if not app.protocol_engine_decider(v_run.venue_id, v_step.needs_owner_ok, false) then
    raise exception 'NOT_DECIDER' using errcode = 'P0001';
  end if;
  if v_sub.submitted_by = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if p_decision is null or p_decision not in ('approve', 'send_back', 'stop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'decision';
  end if;
  v_note := app.protocol_engine_text(p_note, 1000, 'note');
  if p_decision in ('send_back', 'stop') and v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_data is not null and jsonb_typeof(p_data) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'data';
  end if;

  if p_decision = 'approve' then
    -- No override (#42): the figures on record stay the sender's.
    update protocol_submissions
       set decision = 'approve', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = v_sub.id;
    v_opened := app.protocol_engine_pass(v_run.id, v_step.id, v_sub.id, coalesce(p_data, '{}'::jsonb));
    perform app.protocol_engine_notify(array[v_sub.submitted_by, v_run.started_by],
      'staff_decided', 'step_approved', 'staff-step', v_step.id, v_run.id, v_step.id);

  elsif p_decision = 'send_back' then
    if p_send_back_to is null or p_send_back_to = v_step.id then
      v_target := v_step;
    else
      select * into v_target
        from protocol_run_steps
       where id = p_send_back_to and run_id = v_run.id
       for update;
      if not found or v_target.status <> 'passed' or v_target.position >= v_step.position then
        raise exception 'SEND_BACK_TARGET_INVALID' using errcode = 'P0001';
      end if;
    end if;

    update protocol_submissions
       set decision = 'send_back', decided_by = auth.uid(), decided_at = now(),
           decision_note = v_note, send_back_to = v_target.id
     where id = v_sub.id;

    -- What goes back to waiting: every step that waits for the target by the
    -- opening rule, and what waits for those in turn (a built-in step through
    -- its after_keys; any step above an owner-added one, and an owner-added
    -- step above any step; the terminal step, which waits for all), plus the
    -- sent-back step itself when the target is another. A step that does not
    -- wait for the target keeps its state, so the order of two parallel
    -- steps (the swaps §2.8 allows) never changes what a send-back undoes.
    v_last := (select d->>'step_key'
                 from jsonb_array_elements(app.protocol_step_defs(v_run.kind, v_run.variant)) d
                where d->>'fixed' = 'last');
    v_reset := array(
      with recursive dep(id) as (
        select v_target.id
        union
        select s.id
          from dep
          join protocol_run_steps t on t.id = dep.id
          join protocol_run_steps s on s.run_id = t.run_id and s.id <> t.id
         where (s.step_key is not null and t.step_key is not null and t.step_key = any(s.after_keys))
            or ((s.step_key is null or t.step_key is null) and s.position > t.position)
            or s.step_key = v_last)
      select dep.id from dep where dep.id <> v_target.id
      union
      select v_step.id where v_step.id <> v_target.id);

    -- One that already holds a decided submission this round starts the
    -- next round, so its next send never meets that one; undecided
    -- submissions are set aside.
    update protocol_run_steps s
       set round = s.round + case when exists (select 1 from protocol_submissions x
                                                where x.run_step_id = s.id and x.round = s.round
                                                  and x.decision is not null
                                                  and x.withdrawn_at is null and x.superseded_at is null)
                                  then 1 else 0 end,
           status = 'waiting',
           passed_at = null
     where s.id = any(v_reset)
       and app.protocol_step_allowed(s.status, 'waiting');
    update protocol_submissions x
       set superseded_at = now()
     where x.run_id = v_run.id
       and x.decision is null and x.withdrawn_at is null and x.superseded_at is null
       and x.run_step_id = any(v_reset);

    -- The target reopens in a new round; earlier rounds stay as history.
    update protocol_run_steps
       set status = 'open', round = round + 1, opened_at = now(), passed_at = null
     where id = v_target.id;
    v_opened := app.protocol_engine_open(v_run.id);

    perform app.protocol_engine_notify(array[v_sub.submitted_by, v_run.started_by],
      'staff_decided', 'step_sent_back', 'staff-step', v_step.id, v_run.id, v_step.id);
    if v_target.id <> v_step.id then
      perform app.protocol_engine_notify(
        app.protocol_engine_actor_ids(v_run.venue_id, v_target.actor_roles, v_target.assigned_to),
        'staff_task', 'step_open', 'staff-step', v_target.id, v_run.id, v_target.id);
    end if;

  else
    update protocol_submissions
       set decision = 'stop', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = v_sub.id;
    update protocol_run_steps set status = 'stopped' where id = v_step.id;
    update protocol_runs
       set status = 'stopped', stop_reason = v_note, finished_at = now()
     where id = v_run.id;
    perform app.protocol_engine_stop_hook(v_run.id);
    perform app.protocol_engine_notify(array[v_sub.submitted_by, v_run.started_by],
      'staff_decided', 'step_stopped', 'staff-step', v_step.id, v_run.id, v_step.id);
  end if;

  perform app.write_audit('protocol.decide', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('run_step_id', v_step.id, 'submission_id', v_sub.id, 'decision', p_decision,
                       'send_back_to', case when p_decision = 'send_back' then v_target.id end));

  return jsonb_build_object(
    'submission_id',   v_sub.id,
    'decision',        p_decision,
    'step_status',     (select s.status from protocol_run_steps s where s.id = v_step.id),
    'run_status',      (select r.status from protocol_runs r where r.id = v_run.id),
    'opened_step_ids', to_jsonb(v_opened));
end $decide_step_0164$;

comment on function app.decide_step(uuid, text, text, uuid, jsonb) is
  'protocols_engine_rpcs (§2.7). A decider (the owner when the step needs the owner''s OK, else a manager at the venue or the owner), never on their own submission: approve (p_data is the pass hook''s decision data; no override of the figures), send_back to the step itself or a passed step below it (a new round; every step that waits for it by the opening rule goes back to waiting, and so does the sent-back step), or stop (the run stops). A reason is required to send back or stop. Returns {submission_id, decision, step_status, run_status, opened_step_ids}. Audit protocol.decide.';

revoke all on function app.decide_step(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function app.decide_step(uuid, text, text, uuid, jsonb) to authenticated;

create or replace function app.skip_step(p_run_step_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $skip_step_0164$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_note   text;
  v_opened uuid[];
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  select * into v_step from protocol_run_steps where id = p_run_step_id for update;

  if v_run.status <> 'active' then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;
  if not app.protocol_engine_decider(v_run.venue_id, v_step.needs_owner_ok, false) then
    raise exception 'NOT_DECIDER' using errcode = 'P0001';
  end if;
  if not v_step.optional then
    raise exception 'STEP_NOT_OPTIONAL' using errcode = 'P0001';
  end if;
  if not app.protocol_step_allowed(v_step.status, 'skipped') then
    raise exception 'STEP_CLOSED' using errcode = 'P0001';
  end if;
  v_note := app.protocol_engine_text(p_note, 1000, 'note');
  if v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  update protocol_run_steps
     set status = 'skipped', skip_note = v_note, skipped_by = auth.uid(), skipped_at = now()
   where id = v_step.id;
  v_opened := app.protocol_engine_open(v_run.id);

  perform app.write_audit('protocol.skip', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('run_step_id', v_step.id, 'step_key', v_step.step_key));

  return jsonb_build_object('step_status', 'skipped', 'opened_step_ids', to_jsonb(v_opened));
end $skip_step_0164$;

comment on function app.skip_step(uuid, text) is
  'protocols_engine_rpcs (§2.7). The step''s decider skips an optional step that is waiting or open, with a reason; the steps it unblocked open. NOT_DECIDER, STEP_NOT_OPTIONAL, STEP_CLOSED, REASON_REQUIRED. Returns {step_status, opened_step_ids}. Audit protocol.skip.';

revoke all on function app.skip_step(uuid, text) from public, anon;
grant execute on function app.skip_step(uuid, text) to authenticated;

create or replace function app.tick_run_item(p_item_id uuid, p_done boolean)
returns jsonb
language plpgsql security definer set search_path = public as $tick_run_item_0164$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_item   protocol_run_items%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select s.run_id into v_run_id
    from protocol_run_items i
    join protocol_run_steps s on s.id = i.run_step_id
   where i.id = p_item_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  select * into v_step
    from protocol_run_steps
   where id = (select i.run_step_id from protocol_run_items i where i.id = p_item_id)
   for update;
  select * into v_item from protocol_run_items where id = p_item_id for update;

  if v_run.status <> 'active' or v_step.status <> 'open' then
    raise exception 'STEP_NOT_OPEN' using errcode = 'P0001';
  end if;
  if not app.protocol_engine_actor(v_run.venue_id, v_step.actor_roles, v_step.assigned_to, true) then
    raise exception 'NOT_STEP_ACTOR' using errcode = 'P0001';
  end if;
  if p_done is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'done';
  end if;

  -- The row keeps who ticked it and when (no audit row, PROPOSAL); a repeat
  -- tick keeps the first.
  update protocol_run_items
     set done_by = case when p_done then coalesce(done_by, auth.uid()) end,
         done_at = case when p_done then coalesce(done_at, now()) end
   where id = v_item.id
   returning * into v_item;

  return jsonb_build_object(
    'id', v_item.id, 'position', v_item.position, 'text_en', v_item.text_en, 'text_ar', v_item.text_ar,
    'done_by', v_item.done_by,
    'done_by_name', (select st.display_name from staff st where st.id = v_item.done_by),
    'done_at', v_item.done_at);
end $tick_run_item_0164$;

comment on function app.tick_run_item(uuid, boolean) is
  'protocols_engine_rpcs (§2.7). Whoever may act on the open step ticks (p_done true) or unticks one of its checklist lines; the row keeps who and when. STEP_NOT_OPEN, NOT_STEP_ACTOR, PROTOCOL_NOT_FOUND. Returns the ItemRow.';

revoke all on function app.tick_run_item(uuid, boolean) from public, anon;
grant execute on function app.tick_run_item(uuid, boolean) to authenticated;

create or replace function app.withdraw_protocol(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $withdraw_protocol_0164$
declare
  v_run protocol_runs%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  if v_run.started_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Only before the first decision; an automatic pass counts as one.
  if not app.protocol_run_allowed(v_run.status, 'withdrawn')
     or exists (select 1 from protocol_submissions x where x.run_id = v_run.id and x.decision is not null) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;

  update protocol_submissions
     set withdrawn_at = now()
   where run_id = v_run.id
     and decision is null and withdrawn_at is null and superseded_at is null;
  update protocol_run_steps set status = 'open' where run_id = v_run.id and status = 'submitted';
  update protocol_runs set status = 'withdrawn', finished_at = now() where id = v_run.id;
  perform app.protocol_engine_stop_hook(v_run.id);

  perform app.write_audit('protocol.withdraw_run', 'protocol_run', v_run.id::text,
    jsonb_build_object('status', v_run.status), jsonb_build_object('status', 'withdrawn'));

  return jsonb_build_object('run_status', 'withdrawn');
end $withdraw_protocol_0164$;

comment on function app.withdraw_protocol(uuid) is
  'protocols_engine_rpcs (§2.7). The starter withdraws their run before any decision (an automatic pass counts): pending submissions are withdrawn and the kind''s stop hook runs. FORBIDDEN for anyone else; INVALID_TRANSITION after a decision or once finished. Returns {run_status}. Audit protocol.withdraw_run.';

revoke all on function app.withdraw_protocol(uuid) from public, anon;
grant execute on function app.withdraw_protocol(uuid) to authenticated;

create or replace function app.stop_protocol(p_run_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $stop_protocol_0164$
declare
  v_run  protocol_runs%rowtype;
  v_note text;
  v_ids  uuid[];
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  v_note := app.protocol_engine_text(p_note, 1000, 'note');
  if v_note is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if not app.protocol_run_allowed(v_run.status, 'stopped') then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;

  update protocol_runs
     set status = 'stopped', stop_reason = v_note, finished_at = now()
   where id = v_run.id;
  perform app.protocol_engine_stop_hook(v_run.id);

  -- The starter and whoever had a step open.
  v_ids := array[v_run.started_by] || coalesce((
             select array_agg(distinct x)
               from protocol_run_steps s,
                    unnest(app.protocol_engine_actor_ids(v_run.venue_id, s.actor_roles, s.assigned_to)) x
              where s.run_id = v_run.id and s.status = 'open'), '{}'::uuid[]);
  perform app.protocol_engine_notify(v_ids, 'staff_decided', 'run_stopped', 'staff-run', v_run.id, v_run.id, null);

  perform app.write_audit('protocol.stop', 'protocol_run', v_run.id::text,
    jsonb_build_object('status', v_run.status), jsonb_build_object('status', 'stopped'));

  return jsonb_build_object('run_status', 'stopped');
end $stop_protocol_0164$;

comment on function app.stop_protocol(uuid, text) is
  'protocols_engine_rpcs (§2.7). MGMT at the run''s venue (PROPOSAL) stops an active or scheduled run with a reason; the kind''s stop hook runs and the starter and the actors of open steps get run_stopped. REASON_REQUIRED, PROTOCOL_CLOSED. Returns {run_status}. Audit protocol.stop.';

revoke all on function app.stop_protocol(uuid, text) from public, anon;
grant execute on function app.stop_protocol(uuid, text) to authenticated;

create or replace function app.cancel_schedule(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $cancel_schedule_0164$
declare
  v_run  protocol_runs%rowtype;
  v_last protocol_run_steps%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  if v_run.status <> 'scheduled' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;

  select s.* into v_last
    from protocol_run_steps s
   where s.run_id = v_run.id
     and s.step_key = (select d->>'step_key'
                         from jsonb_array_elements(app.protocol_step_defs(v_run.kind, v_run.variant)) d
                        where d->>'fixed' = 'last')
   for update;
  if not found or not app.protocol_step_allowed(v_last.status, 'open') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if not app.protocol_engine_actor(v_run.venue_id, v_last.actor_roles, v_last.assigned_to, true) then
    raise exception 'NOT_STEP_ACTOR' using errcode = 'P0001';
  end if;

  update protocol_runs set status = 'active', scheduled_for = null where id = v_run.id;
  update protocol_run_steps
     set status = 'open', round = round + 1, opened_at = now(), passed_at = null
   where id = v_last.id;

  perform app.write_audit('protocol.unschedule', 'protocol_run', v_run.id::text,
    jsonb_build_object('status', 'scheduled'),
    jsonb_build_object('status', 'active', 'run_step_id', v_last.id));

  return jsonb_build_object('run_status', 'active', 'reopened_step_id', v_last.id);
end $cancel_schedule_0164$;

comment on function app.cancel_schedule(uuid) is
  'protocols_engine_rpcs (§2.7). Whoever may act on the terminal step (launch, apply) cancels a scheduled run''s date: the run goes back to active and that step reopens in a new round. INVALID_TRANSITION unless scheduled; NOT_STEP_ACTOR. Returns {run_status, reopened_step_id}. Audit protocol.unschedule.';

revoke all on function app.cancel_schedule(uuid) from public, anon;
grant execute on function app.cancel_schedule(uuid) to authenticated;

-- ===========================================================================
-- 5. The owner's edits: one running protocol (Q11), and How it works.
-- ===========================================================================

create or replace function app.edit_run_items(p_run_step_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $edit_run_items_0164$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_el     jsonb;
  v_pos    bigint;
  v_id     uuid;
  v_en     text;
  v_ar     text;
  v_keep   uuid[] := '{}';
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select s.run_id into v_run_id from protocol_run_steps s where s.id = p_run_step_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  select * into v_step from protocol_run_steps where id = p_run_step_id for update;

  if v_run.status <> 'active' then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;
  if v_step.status not in ('waiting', 'open', 'submitted') then
    raise exception 'STEP_CLOSED' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if jsonb_array_length(p_items) > 12 then
    raise exception 'LIST_TOO_LONG' using errcode = 'P0001', hint = 'items';
  end if;

  -- Validate everything before writing anything.
  for v_el in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_en := app.protocol_engine_text(v_el->>'text_en', 200, 'items');
    v_ar := app.protocol_engine_text(v_el->>'text_ar', 200, 'items');
    if v_en is null or v_ar is null then
      raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'items';
    end if;
    if v_el->>'id' is not null then
      if not (v_el->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
         or not exists (select 1 from protocol_run_items i
                         where i.id = (v_el->>'id')::uuid and i.run_step_id = v_step.id)
         or (v_el->>'id')::uuid = any(v_keep) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
      end if;
      v_keep := v_keep || (v_el->>'id')::uuid;
    end if;
  end loop;

  -- A kept line keeps its tick; a line left out goes.
  delete from protocol_run_items i
   where i.run_step_id = v_step.id and not (i.id = any(v_keep));

  for v_el, v_pos in select e, o from jsonb_array_elements(p_items) with ordinality as x(e, o) loop
    v_en := app.protocol_engine_text(v_el->>'text_en', 200, 'items');
    v_ar := app.protocol_engine_text(v_el->>'text_ar', 200, 'items');
    v_id := (v_el->>'id')::uuid;
    if v_id is not null then
      update protocol_run_items
         set position = v_pos, text_en = v_en, text_ar = v_ar
       where id = v_id;
    else
      insert into protocol_run_items (run_step_id, position, text_en, text_ar)
      values (v_step.id, v_pos, v_en, v_ar);
    end if;
  end loop;

  perform app.write_audit('protocol.run.edit_items', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('run_step_id', v_step.id, 'items', jsonb_array_length(p_items)));

  return app.protocol_engine_step_row(v_step.id, true);
end $edit_run_items_0164$;

comment on function app.edit_run_items(uuid, jsonb) is
  'protocols_engine_rpcs (§2.7). Owner only (Q11): replaces one run step''s checklist with p_items [{id|null, text_en, text_ar}], at most 12; a kept id keeps its tick. PROTOCOL_CLOSED, STEP_CLOSED (passed, skipped or stopped), LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED. Returns the StepRow. Audit protocol.run.edit_items.';

revoke all on function app.edit_run_items(uuid, jsonb) from public, anon;
grant execute on function app.edit_run_items(uuid, jsonb) to authenticated;

create or replace function app.add_run_step(p_run_id uuid, p_after_run_step_id uuid, p_step jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $add_run_step_0164$
declare
  v_run    protocol_runs%rowtype;
  v_after  protocol_run_steps%rowtype;
  v_last   protocol_run_steps%rowtype;
  v_block  protocol_run_steps%rowtype;
  v_en     text;
  v_ar     text;
  v_roles  staff_role[];
  v_items  jsonb;
  v_id     uuid;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  if v_run.status <> 'active' then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;

  -- The new step goes right after p_after_run_step_id and below the terminal
  -- step, which must still be waiting (it waits for every other step).
  select * into v_after from protocol_run_steps where id = p_after_run_step_id and run_id = v_run.id;
  select s.* into v_last
    from protocol_run_steps s
   where s.run_id = v_run.id
     and s.step_key = (select d->>'step_key'
                         from jsonb_array_elements(app.protocol_step_defs(v_run.kind, v_run.variant)) d
                        where d->>'fixed' = 'last');
  if v_after.id is null or v_last.id is null or v_after.position >= v_last.position
     or v_last.status <> 'waiting' then
    raise exception 'PROTOCOL_ORDER_INVALID' using errcode = 'P0001';
  end if;
  -- Every step above it must still be waiting: the opening rule makes each
  -- of them wait for an owner-added step below it, and the engine never
  -- takes back a step that is open, sent, passed or skipped. Right below the
  -- terminal step is always a place while that step waits. The hint names
  -- the lowest step in the way.
  select s.* into v_block
    from protocol_run_steps s
   where s.run_id = v_run.id
     and s.position > v_after.position
     and s.id <> v_last.id
     and s.status <> 'waiting'
   order by s.position
   limit 1;
  if found then
    raise exception 'PROTOCOL_ORDER_INVALID' using errcode = 'P0001', hint = v_block.id::text;
  end if;

  if p_step is null or jsonb_typeof(p_step) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'step';
  end if;
  v_en := app.protocol_engine_text(p_step->>'name_en', 120, 'name');
  v_ar := app.protocol_engine_text(p_step->>'name_ar', 120, 'name');
  if v_en is null or v_ar is null then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'name';
  end if;
  v_roles := app.protocol_engine_roles(p_step->'actor_roles');
  if coalesce(jsonb_typeof(p_step->'needs_owner_ok'), 'null') not in ('boolean', 'null') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'needs_owner_ok';
  end if;
  if coalesce(jsonb_typeof(p_step->'optional'), 'null') not in ('boolean', 'null') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'optional';
  end if;
  v_items := app.protocol_engine_items(p_step->'items');

  update protocol_run_steps
     set position = position + 1
   where run_id = v_run.id and position > v_after.position;
  insert into protocol_run_steps
    (run_id, position, step_key, name_en, name_ar, actor_roles, needs_owner_ok, optional, after_keys)
  values
    (v_run.id, v_after.position + 1, null, v_en, v_ar, v_roles,
     coalesce((p_step->>'needs_owner_ok')::boolean, false),
     coalesce((p_step->>'optional')::boolean, false),
     '{}')
  returning id into v_id;
  insert into protocol_run_items (run_step_id, position, text_en, text_ar)
  select v_id, x.o, x.e->>'text_en', x.e->>'text_ar'
    from jsonb_array_elements(v_items) with ordinality as x(e, o);

  perform app.protocol_engine_open(v_run.id);

  perform app.write_audit('protocol.run.add_step', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('run_step_id', v_id, 'position', v_after.position + 1));

  return app.protocol_engine_step_row(v_id, true);
end $add_run_step_0164$;

comment on function app.add_run_step(uuid, uuid, jsonb) is
  'protocols_engine_rpcs (§2.7). Owner only (Q11): adds an owner step to one active run, right after p_after_run_step_id and below the terminal step, where every step above it (the terminal step included) is still waiting (else PROTOCOL_ORDER_INVALID, hint the lowest step in the way), from p_step {name_en, name_ar, actor_roles, needs_owner_ok, optional, items}. PROTOCOL_CLOSED, PROTOCOL_ORDER_INVALID, INVALID_ROLE, LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED. Returns the StepRow. Audit protocol.run.add_step.';

revoke all on function app.add_run_step(uuid, uuid, jsonb) from public, anon;
grant execute on function app.add_run_step(uuid, uuid, jsonb) to authenticated;

create or replace function app.save_protocol_template(
  p_template_id      uuid,
  p_expected_version int,
  p_name_en          text,
  p_name_ar          text,
  p_steps            jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $save_protocol_template_0164$
declare
  v_tpl     protocol_templates%rowtype;
  v_defs    jsonb;
  v_def     jsonb;
  v_el      jsonb;
  v_pos     bigint;
  v_key     text;
  v_seen    text[] := '{}';
  v_en      text;
  v_ar      text;
  v_ok      boolean;
  v_roles   staff_role[];
  v_rows    jsonb := '[]'::jsonb;
  v_n       int;
  v_after   text;
  v_step_id uuid;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_tpl from protocol_templates where id = p_template_id for update;
  if not found or not (v_tpl.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_tpl.venue_id::text, true);
  if p_expected_version is distinct from v_tpl.version then
    raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
  end if;

  v_en := app.protocol_engine_text(p_name_en, 120, 'name');
  v_ar := app.protocol_engine_text(p_name_ar, 120, 'name');
  if v_en is null or v_ar is null then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'name';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'steps';
  end if;
  v_n := jsonb_array_length(p_steps);
  if v_n > 20 then
    raise exception 'LIST_TOO_LONG' using errcode = 'P0001', hint = 'steps';
  end if;
  v_defs := app.protocol_step_defs(v_tpl.kind, v_tpl.variant);

  for v_el, v_pos in select e, o from jsonb_array_elements(p_steps) with ordinality as x(e, o) loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'steps';
    end if;
    if coalesce(jsonb_typeof(v_el->'needs_owner_ok'), 'null') not in ('boolean', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'needs_owner_ok';
    end if;
    if coalesce(jsonb_typeof(v_el->'optional'), 'null') not in ('boolean', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'optional';
    end if;
    v_key := v_el->>'step_key';
    v_en := app.protocol_engine_text(v_el->>'name_en', 120, 'steps');
    v_ar := app.protocol_engine_text(v_el->>'name_ar', 120, 'steps');
    if v_en is null or v_ar is null then
      raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'steps';
    end if;

    if v_key is not null then
      -- A built-in step: present once, its actors and optional flag as the
      -- def says, its OK as the def says where the def fixes it (#58).
      select d into v_def from jsonb_array_elements(v_defs) d where d->>'step_key' = v_key;
      if v_def is null or v_key = any(v_seen) then
        raise exception 'PROTOCOL_STEP_FIXED' using errcode = 'P0001', hint = 'step_key';
      end if;
      v_seen := v_seen || v_key;
      if jsonb_typeof(v_el->'actor_roles') = 'array'
         and (select coalesce(array_agg(r order by r), '{}') from jsonb_array_elements_text(v_el->'actor_roles') r)
             is distinct from
             (select coalesce(array_agg(r order by r), '{}') from jsonb_array_elements_text(v_def->'actor_roles') r) then
        raise exception 'PROTOCOL_STEP_FIXED' using errcode = 'P0001', hint = 'actor_roles';
      end if;
      if jsonb_typeof(v_el->'optional') = 'boolean'
         and (v_el->>'optional')::boolean <> (v_def->>'optional')::boolean then
        raise exception 'PROTOCOL_STEP_FIXED' using errcode = 'P0001', hint = 'optional';
      end if;
      v_ok := coalesce((v_el->>'needs_owner_ok')::boolean, (v_def->>'needs_owner_ok')::boolean);
      if (v_def->>'ok_fixed')::boolean and v_ok <> (v_def->>'needs_owner_ok')::boolean then
        raise exception 'PROTOCOL_STEP_FIXED' using errcode = 'P0001', hint = 'needs_owner_ok';
      end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'position', v_pos, 'step_key', v_key, 'name_en', v_en, 'name_ar', v_ar,
        'actor_roles', v_def->'actor_roles', 'needs_owner_ok', v_ok,
        'optional', (v_def->>'optional')::boolean,
        'items', app.protocol_engine_items(v_el->'items')));
    else
      v_roles := app.protocol_engine_roles(v_el->'actor_roles');
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'position', v_pos, 'step_key', null, 'name_en', v_en, 'name_ar', v_ar,
        'actor_roles', to_jsonb(v_roles),
        'needs_owner_ok', coalesce((v_el->>'needs_owner_ok')::boolean, false),
        'optional', coalesce((v_el->>'optional')::boolean, false),
        'items', app.protocol_engine_items(v_el->'items')));
    end if;
  end loop;

  -- Every built-in step present.
  if exists (select 1 from jsonb_array_elements(v_defs) d where not ((d->>'step_key') = any(v_seen))) then
    raise exception 'PROTOCOL_STEP_FIXED' using errcode = 'P0001', hint = 'step_key';
  end if;

  -- Order where it matters (Q7): the first first, the last last, every
  -- built-in step after its dependencies. Owner steps move freely between.
  for v_def in select d from jsonb_array_elements(v_defs) d loop
    v_pos := (select (r->>'position')::bigint from jsonb_array_elements(v_rows) r
               where r->>'step_key' = v_def->>'step_key');
    if (v_def->>'fixed' = 'first' and v_pos <> 1)
       or (v_def->>'fixed' = 'last' and v_pos <> v_n) then
      raise exception 'PROTOCOL_ORDER_INVALID' using errcode = 'P0001', hint = v_def->>'step_key';
    end if;
    for v_after in select jsonb_array_elements_text(v_def->'after') loop
      if (select (r->>'position')::bigint from jsonb_array_elements(v_rows) r where r->>'step_key' = v_after)
         >= v_pos then
        raise exception 'PROTOCOL_ORDER_INVALID' using errcode = 'P0001', hint = v_def->>'step_key';
      end if;
    end loop;
  end loop;

  -- Write: the list is replaced as a whole. Runs keep their snapshot.
  delete from protocol_template_steps where template_id = v_tpl.id;
  for v_el in select r from jsonb_array_elements(v_rows) r loop
    insert into protocol_template_steps
      (template_id, position, step_key, name_en, name_ar, actor_roles, needs_owner_ok, optional)
    values
      (v_tpl.id, (v_el->>'position')::int, v_el->>'step_key', v_el->>'name_en', v_el->>'name_ar',
       array(select jsonb_array_elements_text(v_el->'actor_roles'))::staff_role[],
       (v_el->>'needs_owner_ok')::boolean, (v_el->>'optional')::boolean)
    returning id into v_step_id;
    insert into protocol_template_items (step_id, position, text_en, text_ar)
    select v_step_id, x.o, x.e->>'text_en', x.e->>'text_ar'
      from jsonb_array_elements(v_el->'items') with ordinality as x(e, o);
  end loop;

  update protocol_templates
     set name_en = app.protocol_engine_text(p_name_en, 120, 'name'),
         name_ar = app.protocol_engine_text(p_name_ar, 120, 'name'),
         version = version + 1,
         updated_by = auth.uid(),
         updated_at = now()
   where id = v_tpl.id
   returning * into v_tpl;

  perform app.write_audit('protocol.template.save', 'protocol_template', v_tpl.id::text,
    jsonb_build_object('version', v_tpl.version - 1),
    jsonb_build_object('version', v_tpl.version, 'steps', v_n));

  return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version);
end $save_protocol_template_0164$;

comment on function app.save_protocol_template(uuid, int, text, text, jsonb) is
  'protocols_engine_rpcs (§2.7). Owner only (How it works): replaces a template''s name and ordered steps [{step_key|null, name_en, name_ar, needs_owner_ok, optional, actor_roles, items}] and bumps its version; running protocols keep their snapshot. Built-in steps stay present once with their actors and optional flag, and their OK where the def fixes it (PROTOCOL_STEP_FIXED); dependencies, first and last hold (PROTOCOL_ORDER_INVALID); owner steps take hireable actors (INVALID_ROLE); at most 20 steps and 12 lines a step (LIST_TOO_LONG); both languages; TEMPLATE_CHANGED on a stale version. Returns {template_id, version}. Audit protocol.template.save.';

revoke all on function app.save_protocol_template(uuid, int, text, text, jsonb) from public, anon;
grant execute on function app.save_protocol_template(uuid, int, text, text, jsonb) to authenticated;

-- ===========================================================================
-- 6. Reads.
-- ===========================================================================

create or replace function app.protocol_template_detail(p_template_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_template_detail_0164$
declare
  v_tpl protocol_templates%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_tpl from protocol_templates where id = p_template_id;
  if not found or not app.is_staff_at(v_tpl.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_tpl.id, 'kind', v_tpl.kind, 'variant', v_tpl.variant,
      'name_en', v_tpl.name_en, 'name_ar', v_tpl.name_ar, 'version', v_tpl.version,
      'updated_at', v_tpl.updated_at,
      'updated_by_name', (select st.display_name from staff st where st.id = v_tpl.updated_by)),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'position', ts.position, 'step_key', ts.step_key,
               'name_en', ts.name_en, 'name_ar', ts.name_ar,
               'actor_roles', to_jsonb(ts.actor_roles),
               'needs_owner_ok', ts.needs_owner_ok, 'optional', ts.optional,
               'items', coalesce((select jsonb_agg(jsonb_build_object('text_en', ti.text_en, 'text_ar', ti.text_ar)
                                                   order by ti.position)
                                    from protocol_template_items ti where ti.step_id = ts.id), '[]'::jsonb))
             order by ts.position)
        from protocol_template_steps ts
       where ts.template_id = v_tpl.id), '[]'::jsonb),
    'defs', app.protocol_step_defs(v_tpl.kind, v_tpl.variant));
end $protocol_template_detail_0164$;

comment on function app.protocol_template_detail(uuid) is
  'protocols_engine_rpcs (§2.7). MGMT at the template''s venue: {template: {id, kind, variant, name_en, name_ar, version, updated_at, updated_by_name}, steps: [{position, step_key, name_en, name_ar, actor_roles, needs_owner_ok, optional, items: [{text_en, text_ar}]}], defs} for How it works. PROTOCOL_NOT_FOUND.';

revoke all on function app.protocol_template_detail(uuid) from public, anon;
grant execute on function app.protocol_template_detail(uuid) to authenticated;

create or replace function app.protocols_overview(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocols_overview_0164$
declare
  v_venue uuid;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return jsonb_build_object('templates', coalesce((
    select jsonb_agg(jsonb_build_object(
             'template_id',   t.id,
             'kind',          t.kind,
             'variant',       t.variant,
             'name_en',       t.name_en,
             'name_ar',       t.name_ar,
             'version',       t.version,
             'running',       (select count(*) from protocol_runs r
                                where r.template_id = t.id and r.status in ('active', 'scheduled', 'live')),
             'waiting_on_me', (select count(*) from protocol_runs r
                                where r.template_id = t.id and r.status = 'active'
                                  and app.protocol_engine_waiting_on_me(r.id)),
             'finished_30d',  (select count(*) from protocol_runs r
                                where r.template_id = t.id and r.status in ('done', 'stopped', 'withdrawn')
                                  and r.finished_at > now() - interval '30 days'))
           order by array_position(array['product_release', 'tournament', 'hiring', 'price_promo'], t.kind),
                    t.variant nulls first)
      from protocol_templates t
     where t.venue_id = v_venue), '[]'::jsonb));
end $protocols_overview_0164$;

comment on function app.protocols_overview(uuid) is
  'protocols_engine_rpcs (§2.7). MGMT at the venue: {templates: [{template_id, kind, variant, name_en, name_ar, version, running, waiting_on_me, finished_30d}]} for the Protocols cards; running counts active, scheduled and live runs.';

revoke all on function app.protocols_overview(uuid) from public, anon;
grant execute on function app.protocols_overview(uuid) to authenticated;

create or replace function app.protocol_runs_page(
  p_venue_id uuid default null,
  p_filter   text default 'waiting',
  p_kind     text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_runs_page_0164$
declare
  v_venue  uuid;
  v_filter text := coalesce(p_filter, 'waiting');
  v_mgmt   boolean;
  v_limit  int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_ids    uuid[];
  v_total  int;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_filter not in ('waiting', 'active', 'finished', 'mine') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'filter';
  end if;
  if p_kind is not null and p_kind not in ('product_release', 'tournament', 'hiring', 'price_promo') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  v_mgmt := app.is_staff_at(v_venue, 'manager', 'owner');

  -- MGMT sees every run at the venue; anyone else the runs they are in.
  with runs as (
    select r.id, coalesce(r.finished_at, r.started_at) as at
      from protocol_runs r
     where r.venue_id = v_venue
       and (p_kind is null or r.kind = p_kind)
       and (v_mgmt or app.protocol_engine_involved(r.id))
       and case v_filter
             when 'waiting'  then app.protocol_engine_waiting_on_me(r.id)
             when 'active'   then r.status in ('active', 'scheduled', 'live')
             when 'finished' then r.status in ('done', 'stopped', 'withdrawn')
             when 'mine'     then r.started_by = auth.uid()
           end)
  select (select count(*) from runs),
         array(select x.id from runs x order by x.at desc, x.id limit v_limit offset v_offset)
    into v_total, v_ids;

  return jsonb_build_object(
    'runs', coalesce((select jsonb_agg(app.protocol_engine_run_row(u.id) order by u.o)
                        from unnest(v_ids) with ordinality as u(id, o)), '[]'::jsonb),
    'total', v_total);
end $protocol_runs_page_0164$;

comment on function app.protocol_runs_page(uuid, text, text, int, int) is
  'protocols_engine_rpcs (§2.7). Any active staff member at the venue: {runs: [RunRow], total}, newest first. MGMT see every run, anyone else only the runs they are involved in. p_filter waiting (waiting on the caller), active (active, scheduled, live), finished (done, stopped, withdrawn) or mine (started by the caller); INVALID_ARGUMENT otherwise.';

revoke all on function app.protocol_runs_page(uuid, text, text, int, int) from public, anon;
grant execute on function app.protocol_runs_page(uuid, text, text, int, int) to authenticated;

create or replace function app.protocol_run_detail(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_run_detail_0164$
declare
  v_run  protocol_runs%rowtype;
  v_mgmt boolean;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_mgmt := app.is_staff_at(v_run.venue_id, 'manager', 'owner');
  -- Nobody outside the run learns it exists.
  if not v_mgmt and not app.protocol_engine_involved(v_run.id) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'run', app.protocol_engine_run_row(v_run.id) || jsonb_build_object(
             'template_name_en', (select t.name_en from protocol_templates t where t.id = v_run.template_id),
             'template_name_ar', (select t.name_ar from protocol_templates t where t.id = v_run.template_id),
             'data', case when v_mgmt or v_run.started_by = auth.uid() then v_run.data end),
    'steps', coalesce((select jsonb_agg(app.protocol_engine_step_row(s.id, v_mgmt) order by s.position)
                         from protocol_run_steps s where s.run_id = v_run.id), '[]'::jsonb),
    'can', app.protocol_engine_can(v_run.id, null));
end $protocol_run_detail_0164$;

comment on function app.protocol_run_detail(uuid) is
  'protocols_engine_rpcs (§2.7). MGMT at the venue, or anyone involved in the run: {run: RunRow + {template_name_en, template_name_ar, data}, steps: [StepRow], can: Can}, shaped by visibility (the run''s data to MGMT and the starter only; a mgmt step''s records to MGMT only). PROTOCOL_NOT_FOUND for anyone else.';

revoke all on function app.protocol_run_detail(uuid) from public, anon;
grant execute on function app.protocol_run_detail(uuid) to authenticated;

create or replace function app.protocol_step_detail(p_run_step_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocol_step_detail_0164$
declare
  v_step protocol_run_steps%rowtype;
  v_run  protocol_runs%rowtype;
  v_mgmt boolean;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_step from protocol_run_steps where id = p_run_step_id;
  select * into v_run from protocol_runs where id = v_step.run_id;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_mgmt := app.is_staff_at(v_run.venue_id, 'manager', 'owner');
  if not v_mgmt and not app.protocol_engine_involved(v_run.id) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'run', app.protocol_engine_run_row(v_run.id) || jsonb_build_object(
             'data', case when v_mgmt or v_run.started_by = auth.uid() then v_run.data end),
    'step', app.protocol_engine_step_row(v_step.id, v_mgmt),
    'can', app.protocol_engine_can(v_run.id, v_step.id),
    'def', app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key));
end $protocol_step_detail_0164$;

comment on function app.protocol_step_detail(uuid) is
  'protocols_engine_rpcs (§2.7). MGMT at the venue, or anyone involved in the run: {run: RunRow + {data}, step: StepRow, can: Can, def} for one step''s form and decision, shaped by visibility. PROTOCOL_NOT_FOUND for anyone else.';

revoke all on function app.protocol_step_detail(uuid) from public, anon;
grant execute on function app.protocol_step_detail(uuid) to authenticated;

create or replace function app.my_protocol_work(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_protocol_work_0164$
declare
  v_venue    uuid;
  v_todo     jsonb;
  v_waiting  jsonb;
  v_decided  jsonb;
  v_decide   jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- To do: open steps the caller is expected to do (no cover).
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_step_id', s.id, 'run_id', r.id, 'kind', r.kind, 'variant', r.variant,
           'title_en', r.title_en, 'title_ar', r.title_ar, 'step_key', s.step_key,
           'name_en', s.name_en, 'name_ar', s.name_ar, 'opened_at', s.opened_at, 'round', s.round)
         order by s.opened_at, s.id), '[]'::jsonb)
    into v_todo
    from protocol_run_steps s
    join protocol_runs r on r.id = s.run_id
   where r.venue_id = v_venue and r.status = 'active' and s.status = 'open'
     and app.protocol_engine_actor(r.venue_id, s.actor_roles, s.assigned_to, false);

  -- Waiting: the caller's pending submissions.
  select coalesce(jsonb_agg(jsonb_build_object(
           'submission_id', sub.id, 'run_step_id', s.id, 'run_id', r.id, 'kind', r.kind,
           'title_en', r.title_en, 'title_ar', r.title_ar, 'name_en', s.name_en, 'name_ar', s.name_ar,
           'submitted_at', sub.submitted_at)
         order by sub.submitted_at, sub.id), '[]'::jsonb)
    into v_waiting
    from protocol_submissions sub
    join protocol_run_steps s on s.id = sub.run_step_id
    join protocol_runs r on r.id = sub.run_id
   where sub.submitted_by = auth.uid()
     and sub.decision is null and sub.withdrawn_at is null and sub.superseded_at is null
     and r.venue_id = v_venue and r.status = 'active';

  -- Decided: decisions on the caller's submissions in the last seven days
  -- (an automatic pass is not someone else's decision).
  select coalesce(jsonb_agg(jsonb_build_object(
           'submission_id', sub.id, 'run_step_id', s.id, 'run_id', r.id, 'kind', r.kind,
           'title_en', r.title_en, 'title_ar', r.title_ar, 'name_en', s.name_en, 'name_ar', s.name_ar,
           'submitted_at', sub.submitted_at, 'decision', sub.decision, 'decision_note', sub.decision_note,
           'decided_at', sub.decided_at,
           'decided_by_name', (select st.display_name from staff st where st.id = sub.decided_by))
         order by sub.decided_at desc, sub.id), '[]'::jsonb)
    into v_decided
    from protocol_submissions sub
    join protocol_run_steps s on s.id = sub.run_step_id
    join protocol_runs r on r.id = sub.run_id
   where sub.submitted_by = auth.uid()
     and sub.decision in ('approve', 'send_back', 'stop')
     and sub.decided_at > now() - interval '7 days'
     and r.venue_id = v_venue;

  -- To decide: pending submissions whose decision waits on the caller.
  select coalesce(jsonb_agg(jsonb_build_object(
           'submission_id', sub.id, 'run_step_id', s.id, 'run_id', r.id, 'kind', r.kind,
           'title_en', r.title_en, 'title_ar', r.title_ar, 'name_en', s.name_en, 'name_ar', s.name_ar,
           'submitted_by_name', (select st.display_name from staff st where st.id = sub.submitted_by),
           'submitted_at', sub.submitted_at, 'needs_owner_ok', s.needs_owner_ok)
         order by sub.submitted_at, sub.id), '[]'::jsonb)
    into v_decide
    from protocol_submissions sub
    join protocol_run_steps s on s.id = sub.run_step_id
    join protocol_runs r on r.id = sub.run_id
   where r.venue_id = v_venue and r.status = 'active' and s.status = 'submitted'
     and sub.decision is null and sub.withdrawn_at is null and sub.superseded_at is null
     and sub.submitted_by <> auth.uid()
     and app.protocol_engine_decider(r.venue_id, s.needs_owner_ok, true);

  return jsonb_build_object(
    'todo',      v_todo,
    'waiting',   v_waiting,
    'decided',   v_decided,
    'to_decide', v_decide,
    'counts',    jsonb_build_object('todo', jsonb_array_length(v_todo),
                                    'waiting', jsonb_array_length(v_waiting),
                                    'to_decide', jsonb_array_length(v_decide)));
end $my_protocol_work_0164$;

comment on function app.my_protocol_work(uuid) is
  'protocols_engine_rpcs (§2.7). Any active staff member at the venue: {todo, waiting, decided (7 days), to_decide, counts: {todo, waiting, to_decide}}: the open steps they are expected to do, their pending submissions, the decisions on their submissions, and the submissions whose decision waits on them.';

revoke all on function app.my_protocol_work(uuid) from public, anon;
grant execute on function app.my_protocol_work(uuid) to authenticated;

create or replace function app.protocols_waiting_count(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $protocols_waiting_count_0164$
declare
  v_venue uuid;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'to_decide', (select count(*)
                    from protocol_submissions sub
                    join protocol_run_steps s on s.id = sub.run_step_id
                    join protocol_runs r on r.id = sub.run_id
                   where r.venue_id = v_venue and r.status = 'active' and s.status = 'submitted'
                     and sub.decision is null and sub.withdrawn_at is null and sub.superseded_at is null
                     and sub.submitted_by <> auth.uid()
                     and app.protocol_engine_decider(r.venue_id, s.needs_owner_ok, true)),
    'todo',      (select count(*)
                    from protocol_run_steps s
                    join protocol_runs r on r.id = s.run_id
                   where r.venue_id = v_venue and r.status = 'active' and s.status = 'open'
                     and app.protocol_engine_actor(r.venue_id, s.actor_roles, s.assigned_to, false)));
end $protocols_waiting_count_0164$;

comment on function app.protocols_waiting_count(uuid) is
  'protocols_engine_rpcs (§2.7). Any active staff member at the venue: {to_decide, todo}, the counts of my_protocol_work for the badges (/ops, Observe, the rail).';

revoke all on function app.protocols_waiting_count(uuid) from public, anon;
grant execute on function app.protocols_waiting_count(uuid) to authenticated;

-- ===========================================================================
-- 7. The staff-media bucket follows the engine. Two objects of
--    staff_media_bucket (0159) are re-issued here, their one owner from now
--    on (§2.18): app.claim_staff_media, and the staff_media_read policy.
-- ===========================================================================

-- app.claim_staff_media, the 0159 body with one more re-claim case: a
-- submission from an earlier round of the same run step. A send-back to a
-- passed step below, or cancel_schedule, reopens a step whose approved or
-- automatic submission keeps its decision (the one-end CHECK), so without
-- this its photos could never be sent again. The engine bumps round every
-- time it reopens a step that holds a decided submission.
create or replace function app.claim_staff_media(
  p_paths   text[],
  p_venue   uuid,
  p_folders text[],
  p_used_by text
) returns void
language plpgsql security definer set search_path = public as $claim_staff_media_0164$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_path text;
  v_row  staff_media_uploads%rowtype;
  v_ok   boolean;
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return;
  end if;
  if coalesce(btrim(p_used_by), '') = '' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'used_by';
  end if;

  -- Sorted, so two claims of overlapping paths lock them in the same order.
  for v_path in select distinct x from unnest(p_paths) as x order by 1 loop
    if v_path is null then
      raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;

    select * into v_row from staff_media_uploads where path = v_path for update;
    if not found
       or v_row.venue_id is distinct from p_venue
       or not (v_row.folder = any(coalesce(p_folders, '{}'::text[]))) then
      raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;

    if v_row.used_by is null then
      v_ok := v_row.uploader = auth.uid();
    elsif v_row.used_by = p_used_by then
      continue;                                   -- already this record's
    else
      v_ok := false;
      -- Nested, so the query below is only planned once its table exists.
      if v_row.used_by ~ c_sub and p_used_by ~ c_sub
         and to_regclass('public.protocol_submissions') is not null then
        v_ok := exists (
                  select 1
                    from protocol_submissions e
                    join protocol_submissions n
                      on n.run_step_id = e.run_step_id
                   where e.id = split_part(v_row.used_by, ':', 2)::uuid
                     and n.id = split_part(p_used_by, ':', 2)::uuid
                     and n.id <> e.id
                     and (e.withdrawn_at is not null
                          or e.superseded_at is not null
                          or e.decision = 'send_back'
                          or e.round < n.round));
      end if;
    end if;

    if not coalesce(v_ok, false) then
      raise exception 'PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;

    update staff_media_uploads
       set used_at = now(), used_by = p_used_by
     where path = v_path;
  end loop;
end $claim_staff_media_0164$;

comment on function app.claim_staff_media(text[], uuid, text[], text) is
  'staff_media_bucket (§2.3), re-issued by protocols_engine_rpcs. Internal: marks each path used by p_used_by (<kind>:<id>). PHOTO_PATH_INVALID unless the path is a slot at p_venue in one of p_folders that is unused and the caller''s, already this record''s, or (a resubmission) claimed by a protocol submission of the same run step that was withdrawn, superseded or sent back, or belongs to an earlier round. Called by the recording RPCs after the row that names the photos exists.';

revoke all on function app.claim_staff_media(text[], uuid, text[], text) from public, anon, authenticated;

-- app.staff_media_visible — may the caller read this staff-media photo? The
-- staff_media_read policy below asks it for every object, so it answers the
-- way the reads of section 6 do, and never raises (the policy sits beside
-- menu-media's on storage.objects, and a menu-media name must pass through):
--   * nobody outside the path's venue, and no guest;
--   * the uploader, and MGMT at the venue: always;
--   * a protocol submission's photo: the sender of a submission of that step
--     that names it, or anyone involved in the run when the step's record is
--     'run' (a 'mgmt' step's photos, an owner-added step of a hiring run's
--     included, stay MGMT's);
--   * a marketing note's photo: marketing at the venue (marketing_notes_for);
--   * anything else (a receipt, a campaign draft's images, an unclaimed
--     slot, a kind this function does not know): the uploader and MGMT only.
-- A lane that claims photos under a new <kind> extends this function.
create or replace function app.staff_media_visible(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $staff_media_visible_0164$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_up   staff_media_uploads%rowtype;
  v_step protocol_run_steps%rowtype;
  v_run  protocol_runs%rowtype;
begin
  if not app.is_staff_media_path(p_name) or app.staff_role() is null then
    return false;
  end if;
  select * into v_up from staff_media_uploads where path = p_name;
  if not found or not (v_up.venue_id = any(app.staff_venue_ids())) then
    return false;
  end if;
  if v_up.uploader = auth.uid() or app.is_staff_at(v_up.venue_id, 'manager', 'owner') then
    return true;
  end if;

  if v_up.used_by ~ c_sub then
    select s.* into v_step
      from protocol_submissions x
      join protocol_run_steps s on s.id = x.run_step_id
     where x.id = split_part(v_up.used_by, ':', 2)::uuid;
    if not found then
      return false;
    end if;
    select * into v_run from protocol_runs where id = v_step.run_id;
    return exists (select 1 from protocol_submissions x
                    where x.run_step_id = v_step.id
                      and x.submitted_by = auth.uid()
                      and p_name = any(x.photos))
        or (coalesce(app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key)->>'record_visibility',
                     'run') = 'run'
            and app.protocol_engine_involved(v_run.id));
  end if;

  if v_up.used_by ~ '^marketing_note:' then
    return app.is_staff_at(v_up.venue_id, 'marketing');
  end if;
  return false;
end $staff_media_visible_0164$;

comment on function app.staff_media_visible(text) is
  'protocols_engine_rpcs (§2.3, §2.7 "Visibility"). True when the caller may read a staff-media photo: its uploader and MGMT at its venue always; a protocol submission''s photo also its step''s sender and, on a step whose record is run-visible, anyone involved in the run; a marketing note''s photo also marketing at the venue; nothing else to anyone else. False for a guest, another venue and any name that is not a staff-media path; never raises. The staff_media_read storage policy evaluates it as the reading role, hence the authenticated grant.';

revoke all on function app.staff_media_visible(text) from public, anon;
grant execute on function app.staff_media_visible(text) to authenticated, service_role;

-- The read policy, re-issued in 0062's guarded shape: dropped and created in
-- one block, so a refusal for privilege keeps the old policy and says so. On
-- hosted, assert after the push that staff_media_read names
-- app.staff_media_visible (§1.6 step 3).
do $storage_0164$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema absent - skipping the staff_media_read re-issue';
    return;
  end if;
  begin
    drop policy if exists staff_media_read on storage.objects;
    create policy staff_media_read on storage.objects
      for select to authenticated
      using (bucket_id = 'staff-media' and app.staff_media_visible(name));
  exception when insufficient_privilege then
    raise notice 'cannot recreate staff_media_read as % (%) - replace it via Dashboard > Storage > Policies with: bucket_id = ''staff-media'' and app.staff_media_visible(name)',
      current_user, sqlerrm;
  end;
end $storage_0164$;
