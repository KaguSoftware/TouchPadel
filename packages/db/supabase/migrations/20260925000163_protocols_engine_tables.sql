-- 0163 protocols_engine_tables — the protocol engine's seven tables, the built-in
-- step catalogue, the two state machines, and the default templates.
--
-- Feature: protocols and the staff phone, lane A
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.6, §2.8; plan §4.1-§4.3).
-- Depends on: nothing. protocols_engine_rpcs (A) writes these tables; the
-- kind lanes (E product_release, F tournament / hiring / price_promo) plug in
-- through the hooks that file calls; marketing_staff (C) points campaigns at
-- protocol_runs.
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE SHAPE. A template (one per venue, kind and tournament variant) holds an
-- ordered list of steps and each step a checklist. Starting a run SNAPSHOTS
-- the template into protocol_run_steps and protocol_run_items, so an owner's
-- edit to How it works changes only the runs started after it. Every piece of
-- work on a step is a protocol_submissions row; a sent submission is never
-- edited, only withdrawn, superseded (by a send-back) or decided. Earlier
-- rounds stay, so the history of a send-back loop is the table itself.
--
-- BUILT-IN STEPS. A step with a step_key comes from app.protocol_step_defs
-- (the §2.8 catalogue): its actors, its "optional" flag, its dependencies and
-- its photo rules are fixed there; the owner may rename it, edit its
-- checklist and, where the def does not fix it, flip "Needs my OK". A step
-- with no step_key is the owner's own: free actors, free position, a note and
-- photos for a record.
--
-- WHO READS. Every table here carries a select policy for MGMT at the venue
-- and nothing else (the any-staff vs explicit-list rule, §2.1: records carry
-- prices, plans, candidate ids and free text about people). Everyone else
-- reads through the definer RPCs of protocols_engine_rpcs, which shape the
-- answer by involvement and by each step's record_visibility. No client
-- holds an insert, update or delete grant: every write is a definer RPC.
--
-- covered by packages/db/tests/protocols-engine.test.ts,
-- protocols-engine-flow.test.ts and protocols-roles.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists protocol_templates (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id),
  kind        text not null
              check (kind in ('product_release','tournament','hiring','price_promo')),
  variant     text check (variant in ('type1','type2','type3')),
  name_en     text not null check (coalesce(length(btrim(name_en)),0) > 0),
  name_ar     text not null check (coalesce(length(btrim(name_ar)),0) > 0),
  version     int not null default 1,
  updated_by  uuid references staff(id),
  updated_at  timestamptz not null default now(),
  constraint protocol_templates_variant_chk check ((kind = 'tournament') = (variant is not null)),
  constraint protocol_templates_venue_kind_key unique nulls not distinct (venue_id, kind, variant)
);

create table if not exists protocol_template_steps (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references protocol_templates(id) on delete cascade,
  position        int not null check (position >= 1),
  step_key        text,
  name_en         text not null check (coalesce(length(btrim(name_en)),0) > 0),
  name_ar         text not null check (coalesce(length(btrim(name_ar)),0) > 0),
  actor_roles     staff_role[] not null check (cardinality(actor_roles) >= 1),
  needs_owner_ok  boolean not null default false,
  optional        boolean not null default false,
  constraint protocol_template_steps_position_key unique (template_id, position) deferrable initially deferred,
  constraint protocol_template_steps_step_key_key unique (template_id, step_key)
);

create table if not exists protocol_template_items (
  id        uuid primary key default gen_random_uuid(),
  step_id   uuid not null references protocol_template_steps(id) on delete cascade,
  position  int not null,
  text_en   text not null check (coalesce(length(btrim(text_en)),0) > 0),
  text_ar   text not null check (coalesce(length(btrim(text_ar)),0) > 0),
  constraint protocol_template_items_position_key unique (step_id, position) deferrable initially deferred
);

create table if not exists protocol_runs (
  id                uuid primary key default gen_random_uuid(),
  venue_id          uuid not null references venues(id),
  template_id       uuid not null references protocol_templates(id),
  template_version  int not null,
  kind              text not null
                    check (kind in ('product_release','tournament','hiring','price_promo')),
  variant           text,
  title_en          text,
  title_ar          text,
  status            text not null default 'active'
                    check (status in ('active','scheduled','live','done','stopped','withdrawn')),
  started_by        uuid not null references staff(id),
  started_at        timestamptz not null default now(),
  scheduled_for     timestamptz,
  live_at           timestamptz,
  finished_at       timestamptz,
  stop_reason       text,
  menu_item_id      uuid references menu_items(id) on delete set null,
  promotion_id      uuid references promotions(id) on delete set null,
  data              jsonb not null default '{}',
  photos_purged_at  timestamptz,
  constraint protocol_runs_title_chk
    check (coalesce(length(btrim(title_en)),0) > 0 or coalesce(length(btrim(title_ar)),0) > 0),
  constraint protocol_runs_scheduled_chk check (status <> 'scheduled' or scheduled_for is not null),
  constraint protocol_runs_finished_chk
    check ((status in ('done','stopped','withdrawn')) = (finished_at is not null)),
  constraint protocol_runs_stop_reason_chk
    check (status <> 'stopped' or coalesce(length(btrim(stop_reason)),0) > 0)
);

create table if not exists protocol_run_steps (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references protocol_runs(id) on delete cascade,
  position        int not null,
  step_key        text,
  name_en         text not null,
  name_ar         text not null,
  actor_roles     staff_role[] not null,
  assigned_to     uuid references staff(id),
  needs_owner_ok  boolean not null,
  optional        boolean not null,
  after_keys      text[] not null default '{}',
  status          text not null default 'waiting'
                  check (status in ('waiting','open','submitted','passed','skipped','stopped')),
  round           int not null default 1,
  opened_at       timestamptz,
  passed_at       timestamptz,
  skip_note       text,
  skipped_by      uuid references staff(id),
  skipped_at      timestamptz,
  constraint protocol_run_steps_skip_chk
    check (status <> 'skipped' or (skipped_by is not null and coalesce(length(btrim(skip_note)),0) > 0)),
  constraint protocol_run_steps_position_key unique (run_id, position) deferrable initially deferred
);

create table if not exists protocol_submissions (
  id            uuid primary key default gen_random_uuid(),
  run_step_id   uuid not null references protocol_run_steps(id) on delete cascade,
  run_id        uuid not null references protocol_runs(id) on delete cascade,
  round         int not null,
  submitted_by  uuid not null references staff(id),
  submitted_at  timestamptz not null default now(),
  record        jsonb not null,
  photos        text[] not null default '{}' check (cardinality(photos) <= 8),
  withdrawn_at  timestamptz,
  superseded_at timestamptz,
  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  decision      text check (decision in ('approve','auto','send_back','stop')),
  decision_note text,
  send_back_to  uuid references protocol_run_steps(id),
  -- Nobody decides their own submission; the automatic pass (the submitter is
  -- one of the step's deciders) is the one recorded exception.
  constraint protocol_submissions_decider_chk
    check (decision is null or (decided_by is not null and decided_at is not null
           and (decision = 'auto' or decided_by <> submitted_by))),
  constraint protocol_submissions_reason_chk
    check (decision is null or decision not in ('send_back','stop')
           or coalesce(length(btrim(decision_note)),0) > 0),
  constraint protocol_submissions_one_end_chk
    check (num_nonnulls(decision, withdrawn_at, superseded_at) <= 1)
);

create table if not exists protocol_run_items (
  id           uuid primary key default gen_random_uuid(),
  run_step_id  uuid not null references protocol_run_steps(id) on delete cascade,
  position     int not null,
  text_en      text not null,
  text_ar      text not null,
  done_by      uuid references staff(id),
  done_at      timestamptz,
  constraint protocol_run_items_done_chk check ((done_by is null) = (done_at is null))
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (new, empty tables: the header's waiver).
-- ---------------------------------------------------------------------------
create index if not exists protocol_runs_venue_status_idx   on protocol_runs (venue_id, status);
create index if not exists protocol_runs_started_by_idx     on protocol_runs (started_by);
create index if not exists protocol_run_steps_run_status_idx on protocol_run_steps (run_id, status);
create index if not exists protocol_run_steps_assigned_idx
  on protocol_run_steps (assigned_to) where assigned_to is not null;
create index if not exists protocol_submissions_step_round_idx on protocol_submissions (run_step_id, round);
create index if not exists protocol_submissions_submitted_by_idx on protocol_submissions (submitted_by);
-- One live submission per step and round: a withdrawn or superseded one no
-- longer counts, a decided one does (a new round follows a send-back).
create unique index if not exists protocol_submissions_live_key
  on protocol_submissions (run_step_id, round) where withdrawn_at is null and superseded_at is null;
create index if not exists protocol_run_items_step_idx      on protocol_run_items (run_step_id);
create index if not exists protocol_template_items_step_idx on protocol_template_items (step_id);

-- ---------------------------------------------------------------------------
-- 3. Comments.
-- ---------------------------------------------------------------------------
comment on table protocol_templates is
  'protocols_engine_tables (§2.6): one template per venue, kind and tournament variant, the steps a new run of that kind snapshots. Edited by the owner through app.save_protocol_template (How it works); seeded by app.protocol_seed_venue. Read by MGMT at the venue.';
comment on column protocol_templates.id is 'Template id.';
comment on column protocol_templates.venue_id is 'The venue the template belongs to; runs start from their venue''s template.';
comment on column protocol_templates.kind is 'product_release, tournament, hiring or price_promo.';
comment on column protocol_templates.variant is 'Tournament only: type1, type2 (community) or type3 (sponsor or client); NULL for every other kind.';
comment on column protocol_templates.name_en is 'Template name, English.';
comment on column protocol_templates.name_ar is 'Template name, Arabic.';
comment on column protocol_templates.version is 'Bumped by every save; runs record the version they started from, and a save with a stale version is refused TEMPLATE_CHANGED.';
comment on column protocol_templates.updated_by is 'The owner who saved it last; NULL for the seed.';
comment on column protocol_templates.updated_at is 'When it was last saved.';

comment on table protocol_template_steps is
  'protocols_engine_tables (§2.6): a template''s ordered steps. step_key names a built-in step of app.protocol_step_defs (fixed actors, optional flag and dependencies); NULL is the owner''s own step.';
comment on column protocol_template_steps.id is 'Template step id.';
comment on column protocol_template_steps.template_id is 'The template.';
comment on column protocol_template_steps.position is 'Order in the template, from 1. A built-in step comes after its dependencies; the first and last built-in steps keep their places.';
comment on column protocol_template_steps.step_key is 'The built-in step (app.protocol_step_defs), or NULL for a step the owner added.';
comment on column protocol_template_steps.name_en is 'Step name, English (the owner may rename a built-in step).';
comment on column protocol_template_steps.name_ar is 'Step name, Arabic.';
comment on column protocol_template_steps.actor_roles is 'Who does the step. Fixed for a built-in step; the owner''s pick among the hireable roles for their own.';
comment on column protocol_template_steps.needs_owner_ok is '"Needs my OK": the owner decides the step; off, a manager at the venue (or the owner) decides. Fixed where the def says ok_fixed.';
comment on column protocol_template_steps.optional is 'An optional step may be skipped with a reason by its decider. Fixed for a built-in step.';

comment on table protocol_template_items is
  'protocols_engine_tables (§2.6): a template step''s checklist, copied into each new run.';
comment on column protocol_template_items.id is 'Template item id.';
comment on column protocol_template_items.step_id is 'The template step.';
comment on column protocol_template_items.position is 'Order in the checklist, from 1.';
comment on column protocol_template_items.text_en is 'Checklist line, English.';
comment on column protocol_template_items.text_ar is 'Checklist line, Arabic.';

comment on table protocol_runs is
  'protocols_engine_tables (§2.6): one running protocol. Started by app.start_protocol, which snapshots the template and submits step 1 in the same transaction. Read by MGMT at the venue; everyone else through the definer reads, shaped by involvement.';
comment on column protocol_runs.id is 'Run id.';
comment on column protocol_runs.venue_id is 'The venue the run belongs to.';
comment on column protocol_runs.template_id is 'The template the run was started from.';
comment on column protocol_runs.template_version is 'The template version snapshotted at start; later template edits do not reach this run.';
comment on column protocol_runs.kind is 'product_release, tournament, hiring or price_promo.';
comment on column protocol_runs.variant is 'Tournament only: type1, type2 or type3.';
comment on column protocol_runs.title_en is 'Run title as the starter typed it in English (staff may type one language; the owner types both). At least one of the two is set.';
comment on column protocol_runs.title_ar is 'Run title as the starter typed it in Arabic.';
comment on column protocol_runs.status is 'active, scheduled (the last step passed for a date), live (a released item, until its day-30 review), done, stopped or withdrawn.';
comment on column protocol_runs.started_by is 'Who started the run.';
comment on column protocol_runs.started_at is 'When it was started.';
comment on column protocol_runs.scheduled_for is 'The launch or apply date while the run is scheduled.';
comment on column protocol_runs.live_at is 'When a released item went on sale.';
comment on column protocol_runs.finished_at is 'When the run reached done, stopped or withdrawn; NULL before.';
comment on column protocol_runs.stop_reason is 'Why the run was stopped (required when stopped).';
comment on column protocol_runs.menu_item_id is 'The item the run is about: a release''s draft item, a price change''s target.';
comment on column protocol_runs.promotion_id is 'The promotion a promotion change is about.';
comment on column protocol_runs.data is 'Kind-level fields written by the kind''s hooks (a tournament''s plan once it passes). Returned only to MGMT and the starter.';
comment on column protocol_runs.photos_purged_at is 'When a stopped or withdrawn run''s photos were removed from storage (90 days after it finished).';

comment on table protocol_run_steps is
  'protocols_engine_tables (§2.6): a run''s steps, snapshotted from the template at start. Status moves through app.protocol_step_allowed only.';
comment on column protocol_run_steps.id is 'Run step id.';
comment on column protocol_run_steps.run_id is 'The run.';
comment on column protocol_run_steps.position is 'Order in the run, from 1.';
comment on column protocol_run_steps.step_key is 'The built-in step, or NULL for an owner-added step.';
comment on column protocol_run_steps.name_en is 'Step name, English, as snapshotted.';
comment on column protocol_run_steps.name_ar is 'Step name, Arabic, as snapshotted.';
comment on column protocol_run_steps.actor_roles is 'Who does the step. A manager may cover a step whose actors do not include the owner; the owner may cover any step.';
comment on column protocol_run_steps.assigned_to is 'When set, only this person does the step (a release''s test is the proposer''s).';
comment on column protocol_run_steps.needs_owner_ok is 'The owner decides; off, a manager at the venue or the owner. Taken from the def on a step whose OK is fixed.';
comment on column protocol_run_steps.optional is 'May be skipped with a reason by its decider.';
comment on column protocol_run_steps.after_keys is 'The built-in steps this one waits for (from the def).';
comment on column protocol_run_steps.status is 'waiting, open, submitted, passed, skipped or stopped.';
comment on column protocol_run_steps.round is 'Starts at 1; a send-back to this step (or below it) starts a new round.';
comment on column protocol_run_steps.opened_at is 'When the step last opened.';
comment on column protocol_run_steps.passed_at is 'When the step passed.';
comment on column protocol_run_steps.skip_note is 'Why an optional step was skipped (required when skipped).';
comment on column protocol_run_steps.skipped_by is 'Who skipped it.';
comment on column protocol_run_steps.skipped_at is 'When it was skipped.';

comment on table protocol_submissions is
  'protocols_engine_tables (§2.6): one piece of work sent on a run step, and its decision. Never edited: withdrawn, superseded by a send-back, or decided once. Earlier rounds stay as history.';
comment on column protocol_submissions.id is 'Submission id.';
comment on column protocol_submissions.run_step_id is 'The run step.';
comment on column protocol_submissions.run_id is 'The run (denormalised for the run''s reads).';
comment on column protocol_submissions.round is 'The step''s round when it was sent.';
comment on column protocol_submissions.submitted_by is 'Who sent it (the actor, or a manager or owner covering).';
comment on column protocol_submissions.submitted_at is 'When it was sent.';
comment on column protocol_submissions.record is 'The step''s form, as the kind''s check hook normalised it (a note only for an owner-added step).';
comment on column protocol_submissions.photos is 'staff-media paths attached, claimed through app.claim_staff_media (at most 8).';
comment on column protocol_submissions.withdrawn_at is 'When the sender took it back before a decision.';
comment on column protocol_submissions.superseded_at is 'When a send-back to an earlier step set this undecided submission aside.';
comment on column protocol_submissions.decided_by is 'Who decided it (the sender for an automatic pass).';
comment on column protocol_submissions.decided_at is 'When it was decided.';
comment on column protocol_submissions.decision is 'approve, auto (the sender decides this step), send_back or stop.';
comment on column protocol_submissions.decision_note is 'The decider''s note; required for send_back and stop.';
comment on column protocol_submissions.send_back_to is 'The step a send_back reopened (this step or a passed step below it).';

comment on table protocol_run_items is
  'protocols_engine_tables (§2.6): a run step''s checklist, snapshotted from the template; the owner may change one run''s lists (app.edit_run_items).';
comment on column protocol_run_items.id is 'Run item id.';
comment on column protocol_run_items.run_step_id is 'The run step.';
comment on column protocol_run_items.position is 'Order in the checklist, from 1.';
comment on column protocol_run_items.text_en is 'Checklist line, English.';
comment on column protocol_run_items.text_ar is 'Checklist line, Arabic.';
comment on column protocol_run_items.done_by is 'Who ticked it; NULL while open.';
comment on column protocol_run_items.done_at is 'When it was ticked; NULL while open.';

-- ---------------------------------------------------------------------------
-- 4. RLS: select-only, MGMT at the venue. The children follow their parent by
--    an inline exists (0106/0136: every policy is planned for every caller,
--    so no definer helper). No write grant: every write is a definer RPC.
-- ---------------------------------------------------------------------------
alter table protocol_templates      enable row level security;
alter table protocol_template_steps enable row level security;
alter table protocol_template_items enable row level security;
alter table protocol_runs           enable row level security;
alter table protocol_run_steps      enable row level security;
alter table protocol_submissions    enable row level security;
alter table protocol_run_items      enable row level security;

drop policy if exists protocol_templates_mgmt_read on protocol_templates;
create policy protocol_templates_mgmt_read on protocol_templates
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists protocol_template_steps_mgmt_read on protocol_template_steps;
create policy protocol_template_steps_mgmt_read on protocol_template_steps
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from protocol_templates t
                      where t.id = protocol_template_steps.template_id
                        and t.venue_id = any(app.staff_venue_ids())));

drop policy if exists protocol_template_items_mgmt_read on protocol_template_items;
create policy protocol_template_items_mgmt_read on protocol_template_items
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from protocol_template_steps s
                       join protocol_templates t on t.id = s.template_id
                      where s.id = protocol_template_items.step_id
                        and t.venue_id = any(app.staff_venue_ids())));

drop policy if exists protocol_runs_mgmt_read on protocol_runs;
create policy protocol_runs_mgmt_read on protocol_runs
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists protocol_run_steps_mgmt_read on protocol_run_steps;
create policy protocol_run_steps_mgmt_read on protocol_run_steps
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from protocol_runs r
                      where r.id = protocol_run_steps.run_id
                        and r.venue_id = any(app.staff_venue_ids())));

drop policy if exists protocol_submissions_mgmt_read on protocol_submissions;
create policy protocol_submissions_mgmt_read on protocol_submissions
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from protocol_runs r
                      where r.id = protocol_submissions.run_id
                        and r.venue_id = any(app.staff_venue_ids())));

drop policy if exists protocol_run_items_mgmt_read on protocol_run_items;
create policy protocol_run_items_mgmt_read on protocol_run_items
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from protocol_run_steps s
                       join protocol_runs r on r.id = s.run_id
                      where s.id = protocol_run_items.run_step_id
                        and r.venue_id = any(app.staff_venue_ids())));

grant select on protocol_templates, protocol_template_steps, protocol_template_items,
                protocol_runs, protocol_run_steps, protocol_submissions, protocol_run_items
  to authenticated;
grant all on protocol_templates, protocol_template_steps, protocol_template_items,
             protocol_runs, protocol_run_steps, protocol_submissions, protocol_run_items
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.protocol_step_defs — the built-in step catalogue (§2.8), one array
--    per kind and variant, in default order. Each entry:
--      step_key, name_en, name_ar       the default names (the owner may rename)
--      actor_roles                      fixed
--      assign_to_starter                the run assigns the step to its starter
--      needs_owner_ok, ok_fixed         the default OK, and whether it is fixed
--                                       (the two price steps, always on, #58;
--                                       the two owner-only steps, where the
--                                       owner is the actor)
--      optional                         fixed
--      after                            the built-in steps it waits for
--      fixed                            'first', 'last' or null
--      photo_folder, photos_min, photos_max   staff-media folder and count
--      record_visibility                'run' (everyone involved) or 'mgmt'
--    Type 2 tournaments drop feasibility, and their marketing and courts come
--    after plan (Q3: every OK off). NULL for an unknown kind or variant.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_step_defs(p_kind text, p_variant text)
returns jsonb
language sql immutable parallel safe set search_path = public as $protocol_step_defs_0163$
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
       "actor_roles": ["manager"], "assign_to_starter": false,
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
       "actor_roles": ["manager"], "assign_to_starter": false,
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
$protocol_step_defs_0163$;

comment on function app.protocol_step_defs(text, text) is
  'protocols_engine_tables (§2.6, §2.8). Internal: the built-in steps of a kind (and tournament variant) in default order, as [{step_key, name_en, name_ar, actor_roles, assign_to_starter, needs_owner_ok, ok_fixed, optional, after, fixed, photo_folder, photos_min, photos_max, record_visibility}]. NULL for an unknown kind or variant.';

revoke all on function app.protocol_step_defs(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The two state machines (the 0112 transition-table shape). Every status
--    write in protocols_engine_rpcs goes through one of these.
--
--   step:  waiting → open → submitted → passed
--             │        │  ↖──────┘ │ (withdraw, send back to itself)
--             │        │           ├→ stopped   (a stop decision)
--             └────────┴→ skipped  └→ waiting   (a send-back below it)
--          open → waiting, passed → open | waiting   (send-backs)
--
--   run:   active → scheduled | live | done | stopped | withdrawn
--          scheduled → active (cancelled, or not ready on the date) | live | done | stopped
--          live → done (the day-30 review)
-- ---------------------------------------------------------------------------
create or replace function app.protocol_step_allowed(p_from text, p_to text)
returns boolean
language sql immutable parallel safe set search_path = public as $protocol_step_allowed_0163$
  select case p_from
           when 'waiting'   then p_to in ('open', 'skipped')
           when 'open'      then p_to in ('submitted', 'skipped', 'waiting')
           when 'submitted' then p_to in ('open', 'passed', 'stopped', 'waiting')
           when 'passed'    then p_to in ('open', 'waiting')
           else false                      -- skipped and stopped are terminal
         end;
$protocol_step_allowed_0163$;

comment on function app.protocol_step_allowed(text, text) is
  'protocols_engine_tables (§2.6). Internal: true when a run step may move from p_from to p_to. skipped and stopped are terminal; passed leaves only through a send-back.';

revoke all on function app.protocol_step_allowed(text, text) from public, anon, authenticated;

create or replace function app.protocol_run_allowed(p_from text, p_to text)
returns boolean
language sql immutable parallel safe set search_path = public as $protocol_run_allowed_0163$
  select case p_from
           when 'active'    then p_to in ('scheduled', 'live', 'done', 'stopped', 'withdrawn')
           when 'scheduled' then p_to in ('active', 'live', 'done', 'stopped')
           when 'live'      then p_to = 'done'
           else false                      -- done, stopped and withdrawn are terminal
         end;
$protocol_run_allowed_0163$;

comment on function app.protocol_run_allowed(text, text) is
  'protocols_engine_tables (§2.6). Internal: true when a run may move from p_from to p_to. done, stopped and withdrawn are terminal.';

revoke all on function app.protocol_run_allowed(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.protocol_seed_venue — the default templates of one venue: the four
--    kinds, three tournament variants, each with the built-in steps of its
--    def and no checklist. A template that exists is left as it is, so this
--    is safe to run again. Venue creation calls it (the PHASE-2-PLAN.md:25
--    copy rule; slice 2 owns that call).
-- ---------------------------------------------------------------------------
create or replace function app.protocol_seed_venue(p_venue uuid)
returns void
language plpgsql security definer set search_path = public as $protocol_seed_venue_0163$
declare
  v_t  record;
  v_id uuid;
begin
  if p_venue is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'venue';
  end if;

  for v_t in
    select *
      from (values
        ('product_release', null::text, 'New item', 'صنف جديد'),
        ('tournament', 'type1', 'Tournament, type 1', 'بطولة، النوع 1'),
        ('tournament', 'type2', 'Tournament, type 2 (community)', 'بطولة، النوع 2 (مجتمعية)'),
        ('tournament', 'type3', 'Tournament, type 3 (sponsor or client)', 'بطولة، النوع 3 (راعٍ أو عميل)'),
        ('hiring', null::text, 'Hiring', 'توظيف'),
        ('price_promo', null::text, 'Price or promo change', 'تغيير سعر أو عرض')
      ) as t(kind, variant, name_en, name_ar)
  loop
    v_id := null;
    insert into protocol_templates (venue_id, kind, variant, name_en, name_ar)
    values (p_venue, v_t.kind, v_t.variant, v_t.name_en, v_t.name_ar)
    on conflict do nothing
    returning id into v_id;

    if v_id is not null then
      insert into protocol_template_steps
        (template_id, position, step_key, name_en, name_ar, actor_roles, needs_owner_ok, optional)
      select v_id,
             d.ord,
             d.def->>'step_key',
             d.def->>'name_en',
             d.def->>'name_ar',
             array(select jsonb_array_elements_text(d.def->'actor_roles'))::staff_role[],
             (d.def->>'needs_owner_ok')::boolean,
             (d.def->>'optional')::boolean
        from jsonb_array_elements(app.protocol_step_defs(v_t.kind, v_t.variant)) with ordinality as d(def, ord);
    end if;
  end loop;
end $protocol_seed_venue_0163$;

comment on function app.protocol_seed_venue(uuid) is
  'protocols_engine_tables (§2.6). Internal: writes a venue''s default templates (product_release, tournament type1-3, hiring, price_promo) with the built-in steps of app.protocol_step_defs, EN and AR, no checklist. Existing templates are kept. Run for every active venue by this migration; venue creation calls it.';

revoke all on function app.protocol_seed_venue(uuid) from public, anon, authenticated;

select app.protocol_seed_venue(v.id) from venues v where v.is_active;

-- ---------------------------------------------------------------------------
-- 8. Owner assistant: the seven tables join the table_read allowlist (the
--    0144 statement, limited to this migration's tables, §1.5; never the
--    all-table catch-up). jsonb columns (data) are not default reads.
--
--    Left out: the free text a decider may type a candidate's name into
--    (decision_note, skip_note, stop_reason, and the records, where an
--    owner-added step's note lives). A hiring run keeps them for 90 days
--    before hiring_purge_due overwrites them (§2.12), and anything
--    assistant_table_read returns goes to the LLM. A column cannot be left
--    out for hiring runs only, so it is left out for every run.
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('protocol_templates', 'protocol_template_steps', 'protocol_template_items',
                        'protocol_runs', 'protocol_run_steps', 'protocol_submissions',
                        'protocol_run_items')
   and (c.table_name, c.column_name) not in (('protocol_submissions', 'decision_note'),
                                             ('protocol_submissions', 'record'),
                                             ('protocol_run_steps', 'skip_note'),
                                             ('protocol_runs', 'stop_reason'))
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
