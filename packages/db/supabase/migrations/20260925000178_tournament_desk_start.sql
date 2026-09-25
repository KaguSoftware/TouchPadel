-- 0178 tournament_desk_start — the court desk may start a tournament run: it
-- submits the plan, a manager accepts it, and a reopened plan goes back to
-- whoever started the run.
--
-- Feature: protocols and the staff phone, lane F
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.11, §2.18; plan #67).
-- Depends on: event_court_blocks (F: the tournament hooks its tests run
-- through), protocols_engine_tables and protocols_engine_rpcs (A, committed
-- as 0163 and 0164, whose bodies this re-issues).
-- Re-issues (§2.18): app.protocol_step_defs from 0163 and app.start_protocol
-- from 0164, each verbatim but for the lines below. Its commit carries the
-- @touch/core twin (packages/core/src/protocols/steps.ts: startableKinds and
-- the tournament plan's actors and assignment).
-- Re-runnable: create or replace; the template update is idempotent.
--
-- WHAT CHANGES.
--   * The tournament plan's actors become manager and court_desk, and the plan
--     is assigned to the run's starter, in all three variants. Unassigned, a
--     reopened plan (the owner sending feasibility back on a manager's run)
--     would belong to every holder of its actor roles: every court desk at the
--     venue would be told and would see it in To do, for a mgmt step whose
--     records the desk cannot read. Assigned (start_protocol stamps
--     assigned_to from the def), it goes back to the starter, and a manager or
--     the owner still covers it.
--   * start_protocol admits the court desk: court_desk joins the opening list
--     and the tournament starters. The rest is unchanged, so the desk's start
--     submits the plan in the same transaction; the plan's OK stays off, so it
--     waits for a manager (step_submitted to the venue's managers, or its
--     owners where there is none), and type 3 still needs its sponsor.
--   * The seeded templates' plan rows take the new actors: save_protocol_template
--     compares a built-in step's actors with the def. No version bump: no
--     owner-typed text changes, and a run takes a built-in step's actors from
--     the def anyway. A run started before this keeps its snapshot.
--
-- covered by packages/db/tests/tournament-desk-start.test.ts (and the engine's
-- protocols-engine*.test.ts against the re-issued bodies)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.protocol_step_defs — 0163 verbatim; the tournament plan (type 1 and
--    3, and type 2) takes actors ["manager", "court_desk"] and
--    assign_to_starter true.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_step_defs(p_kind text, p_variant text)
returns jsonb
language sql immutable parallel safe set search_path = public as $protocol_step_defs_0178$
  select case
    when p_kind = 'product_release' and p_variant is null then '[
      {"step_key": "propose", "name_en": "Proposal", "name_ar": "الاقتراح",
       "actor_roles": ["head_barista", "head_chef"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": [], "fixed": "first",
       "photo_folder": "proposals", "photos_min": 0, "photos_max": 6, "record_visibility": "run"},
      {"step_key": "test", "name_en": "Test", "name_ar": "التجربة",
       "actor_roles": ["head_barista", "head_chef"], "assign_to_starter": true,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": ["propose"], "fixed": null,
       "photo_folder": "tests", "photos_min": 1, "photos_max": 6, "record_visibility": "run"},
      {"step_key": "analysis", "name_en": "Price", "name_ar": "التسعير",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": true, "ok_fixed": true, "optional": false, "after": ["test"], "fixed": null,
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"},
      {"step_key": "marketing", "name_en": "Marketing", "name_ar": "التسويق",
       "actor_roles": ["marketing"], "assign_to_starter": false,
       "needs_owner_ok": true, "ok_fixed": false, "optional": false, "after": ["test"], "fixed": null,
       "photo_folder": "marketing", "photos_min": 0, "photos_max": 6, "record_visibility": "run"},
      {"step_key": "launch", "name_en": "Launch", "name_ar": "الإطلاق",
       "actor_roles": ["owner"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": true, "optional": false, "after": ["analysis", "marketing"], "fixed": "last",
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "run"}
    ]'::jsonb
    when p_kind = 'tournament' and p_variant in ('type1', 'type3') then '[
      {"step_key": "plan", "name_en": "Plan", "name_ar": "الخطة",
       "actor_roles": ["manager", "court_desk"], "assign_to_starter": true,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": [], "fixed": "first",
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"},
      {"step_key": "feasibility", "name_en": "Feasibility", "name_ar": "دراسة الجدوى",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": true, "ok_fixed": false, "optional": false, "after": ["plan"], "fixed": null,
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"},
      {"step_key": "marketing", "name_en": "Marketing", "name_ar": "التسويق",
       "actor_roles": ["marketing"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": true, "after": ["feasibility"], "fixed": null,
       "photo_folder": "marketing", "photos_min": 0, "photos_max": 6, "record_visibility": "run"},
      {"step_key": "courts", "name_en": "Courts", "name_ar": "حجز الملاعب",
       "actor_roles": ["court_desk"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": ["feasibility"], "fixed": null,
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "run"},
      {"step_key": "ready", "name_en": "Ready", "name_ar": "الجاهزية",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": ["courts", "marketing"], "fixed": "last",
       "photo_folder": "steps", "photos_min": 0, "photos_max": 6, "record_visibility": "run"}
    ]'::jsonb
    when p_kind = 'tournament' and p_variant = 'type2' then '[
      {"step_key": "plan", "name_en": "Plan", "name_ar": "الخطة",
       "actor_roles": ["manager", "court_desk"], "assign_to_starter": true,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": [], "fixed": "first",
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"},
      {"step_key": "marketing", "name_en": "Marketing", "name_ar": "التسويق",
       "actor_roles": ["marketing"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": true, "after": ["plan"], "fixed": null,
       "photo_folder": "marketing", "photos_min": 0, "photos_max": 6, "record_visibility": "run"},
      {"step_key": "courts", "name_en": "Courts", "name_ar": "حجز الملاعب",
       "actor_roles": ["court_desk"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": ["plan"], "fixed": null,
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "run"},
      {"step_key": "ready", "name_en": "Ready", "name_ar": "الجاهزية",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": ["courts", "marketing"], "fixed": "last",
       "photo_folder": "steps", "photos_min": 0, "photos_max": 6, "record_visibility": "run"}
    ]'::jsonb
    when p_kind = 'hiring' and p_variant is null then '[
      {"step_key": "open_position", "name_en": "Open position", "name_ar": "فتح الوظيفة",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": true, "ok_fixed": false, "optional": false, "after": [], "fixed": "first",
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"},
      {"step_key": "interviews", "name_en": "Interviews and pick", "name_ar": "المقابلات والاختيار",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": true, "ok_fixed": false, "optional": false, "after": ["open_position"], "fixed": null,
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"},
      {"step_key": "add_staff", "name_en": "Add staff", "name_ar": "إضافة الموظف",
       "actor_roles": ["owner"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": true, "optional": false, "after": ["interviews"], "fixed": "last",
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"}
    ]'::jsonb
    when p_kind = 'price_promo' and p_variant is null then '[
      {"step_key": "propose", "name_en": "Proposal", "name_ar": "الاقتراح",
       "actor_roles": ["manager", "marketing"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": [], "fixed": "first",
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "run"},
      {"step_key": "numbers", "name_en": "Numbers", "name_ar": "الأرقام",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": true, "ok_fixed": true, "optional": false, "after": ["propose"], "fixed": null,
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "mgmt"},
      {"step_key": "announce", "name_en": "Announce", "name_ar": "الإعلان",
       "actor_roles": ["marketing"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": true, "after": ["numbers"], "fixed": null,
       "photo_folder": "marketing", "photos_min": 0, "photos_max": 6, "record_visibility": "run"},
      {"step_key": "apply", "name_en": "Apply", "name_ar": "التطبيق",
       "actor_roles": ["manager"], "assign_to_starter": false,
       "needs_owner_ok": false, "ok_fixed": false, "optional": false, "after": ["numbers", "announce"], "fixed": "last",
       "photo_folder": null, "photos_min": 0, "photos_max": 0, "record_visibility": "run"}
    ]'::jsonb
  end
$protocol_step_defs_0178$;

comment on function app.protocol_step_defs(text, text) is
  'protocols_engine_tables (§2.6, §2.8), re-issued by tournament_desk_start (§2.11: the tournament plan is the manager''s or the court desk''s, assigned to the starter). Internal: the built-in steps of a kind (and tournament variant) in default order, as [{step_key, name_en, name_ar, actor_roles, assign_to_starter, needs_owner_ok, ok_fixed, optional, after, fixed, photo_folder, photos_min, photos_max, record_visibility}]. NULL for an unknown kind or variant.';

revoke all on function app.protocol_step_defs(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The seeded templates' plan rows follow the def.
-- ---------------------------------------------------------------------------
update protocol_template_steps
   set actor_roles = '{manager,court_desk}'
 where step_key = 'plan'
   and actor_roles is distinct from '{manager,court_desk}'::staff_role[]
   and template_id in (select id from protocol_templates where kind = 'tournament');

-- ---------------------------------------------------------------------------
-- 3. app.start_protocol — 0164 verbatim; court_desk joins the opening list
--    and the tournament starters.
-- ---------------------------------------------------------------------------
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
language plpgsql security definer set search_path = public as $start_protocol_0178$
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
  -- Every kind's starters before any argument is read: a guest or the till
  -- stops here.
  if not app.is_staff('head_barista','head_chef','manager','owner','marketing','court_desk') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_roles := case p_kind
               when 'product_release' then '{head_barista,head_chef,manager,owner}'::staff_role[]
               when 'tournament'      then '{manager,court_desk,owner}'::staff_role[]
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
end $start_protocol_0178$;

comment on function app.start_protocol(text, text, text, text, jsonb, jsonb, text[], uuid, text) is
  'protocols_engine_rpcs (§2.7), re-issued by tournament_desk_start (§2.11). Starts a run of the venue''s template for p_kind (tournament: p_variant) and submits step 1 from p_first_record in the same transaction. Starters by kind: product_release head_barista, head_chef, manager, owner; tournament court_desk, manager, owner (tournament_desk_start, #67); hiring manager, owner; price_promo manager, marketing, owner. The owner types both titles, anyone else at least one. Returns {run_id, status, first_step_id, submission_id, auto}. PROTOCOL_NOT_READY until the kind''s start hook exists. Idempotent on p_idempotency_key. Audit protocol.start, protocol.submit (+ protocol.auto).';

revoke all on function app.start_protocol(text, text, text, text, jsonb, jsonb, text[], uuid, text) from public, anon;
grant execute on function app.start_protocol(text, text, text, text, jsonb, jsonb, text[], uuid, text) to authenticated;
