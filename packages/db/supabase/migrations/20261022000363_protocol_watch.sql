-- 0363 protocol_watch, 2026-10-22 (Majed: the owner gets a push for every
-- protocol status update, "ideally with an on/off setting", plus a reminder
-- when an approval has been waiting more than a few hours).
--
-- WHAT IT ADDS
--   1. The owner's status pushes. Until now the owner heard about a protocol
--      only when they had to act (a step needing their OK, their own launch or
--      add-staff step, a venue with no manager) or when they had started it.
--      Now every owner with "Protocol updates" on is told when:
--        - a step passes (step_passed: approved, or passed on submit by
--          someone who may decide it) while the protocol carries on;
--        - a protocol goes live (run_live), is scheduled (run_scheduled),
--          finishes (run_done), is stopped (run_stopped) or withdrawn
--          (run_withdrawn).
--      Not a second push for the same news: an owner already told about this
--      run in the same transaction (the starter's step_approved, the decider
--      who acted, the owners' review_ready at a release's day-30 review) is
--      skipped, and so is the caller (app.notify_staff). A release going from
--      live to done is its day-30 review, which review_ready already tells
--      the owners, so it sends nothing more.
--   2. The setting. staff_push_prefs.protocol_updates, one row per person
--      (no row = on: the owner asked for these pushes). Read and written by the
--      owner on the phone's Work alerts page through app.my_push_prefs and
--      app.set_my_push_prefs; no client grant on the table.
--   3. The approval reminder. app.protocol_remind_sweep (cron
--      tp_protocol_remind, every 15 minutes) reminds the deciders of a
--      submission still undecided 3 hours after it was sent
--      (decision_waiting, staff_decide), then once a day while it waits.
--      Same deciders as the first push (app.protocol_engine_decider_ids:
--      the owners for a step that needs their OK, else the venue's managers,
--      else the owners), never the sender. Only between 09:00 and 23:00 in
--      the branch's timezone: a reminder due at night waits for the morning.
--      Reminders are work, not news, so the setting above does not mute them.
--      protocol_submissions.reminded_at records the last one.
--   4. app.notify_staff, 0362 verbatim plus the five title keys above (no
--      new kind, no new route).
--
-- WHY DEFERRED TRIGGERS
--   A status changes in many bodies (decide_step, the engine's automatic pass,
--   stop_protocol, withdraw_protocol, cancel_schedule, the release launch and
--   review, the price-promo and tournament crons). Constraint triggers on
--   protocol_run_steps and protocol_runs see every one of them without
--   re-issuing any, and DEFERRABLE INITIALLY DEFERRED makes them fire at
--   commit, after the body has queued its own pushes, so the "already told"
--   check sees them. decide_step (0361) is not touched.
--
-- DEPLOY ORDER. send-push must know the five title keys before this reaches
-- hosted: an unknown title key is terminal there (send-push/index.ts). The
-- deploy workflow deploys send-push before it pushes migrations.
--
-- covered by packages/db/tests/protocol-watch.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. staff_push_prefs — a person's push settings. Not branch-scoped: the
--    setting is the person's, like their staff row.
-- ---------------------------------------------------------------------------
create table if not exists staff_push_prefs (
  staff_id          uuid primary key references staff(id) on delete cascade,
  protocol_updates  boolean not null default true,
  updated_at        timestamptz not null default now()
);

comment on table staff_push_prefs is
  'protocol_watch (0363). A staff member''s push settings, one row per person; no row means every setting at its default. protocol_updates: the owner''s status pushes for every protocol (step passed, live, scheduled, done, stopped, withdrawn), on by default. Written through app.set_my_push_prefs, read through app.my_push_prefs; no client grant.';
comment on column staff_push_prefs.protocol_updates is
  'protocol_watch (0363): true (default) = the owner is told whenever a protocol step passes or a protocol finishes, goes live, is scheduled, stopped or withdrawn. Approval reminders are not muted by it.';

alter table staff_push_prefs enable row level security;
revoke all on table staff_push_prefs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. protocol_submissions.reminded_at — the last approval reminder.
-- ---------------------------------------------------------------------------
alter table protocol_submissions add column if not exists reminded_at timestamptz;

comment on column protocol_submissions.reminded_at is
  'protocol_watch (0363): when app.protocol_remind_sweep last reminded the deciders of this undecided submission (decision_waiting); NULL until the first reminder.';

-- ---------------------------------------------------------------------------
-- 3. app.notify_staff — 0362 verbatim, plus step_passed, run_done,
--    run_withdrawn, run_scheduled and decision_waiting after plan_changes.
-- ---------------------------------------------------------------------------
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0363$
declare
  c_kinds      constant text[] := array['staff_task', 'staff_decide', 'staff_decided', 'staff_info'];
  c_title_keys constant text[] := array[
    'step_open', 'step_submitted', 'step_approved', 'step_sent_back', 'step_stopped',
    'run_stopped', 'run_live', 'launch_not_ready', 'apply_not_ready', 'review_ready',
    'request_submitted', 'request_approved', 'request_rejected', 'shopping_new',
    'purchase_to_receive', 'idea_submitted', 'idea_started', 'idea_declined',
    'teaching_new', 'recipe_change_submitted', 'recipe_change_approved',
    'recipe_change_declined', 'shopping_to_approve', 'shopping_declined',
    'marketing_request_new', 'marketing_request_answered', 'deduction_proposed',
    'deduction_approved', 'deduction_declined', 'deduction_recorded',
    'incident_reported', 'incident_reviewed', 'content_submitted', 'content_approved',
    'content_changes', 'content_declined', 'waiter_call_new', 'match_report_new',
    'loyalty_gift', 'screenshot_taken', 'shop_price_changed', 'checklist_due',
    'checklist_overdue', 'reward_unlocked', 'plan_submitted', 'plan_approved',
    'plan_changes', 'step_passed', 'run_done', 'run_withdrawn', 'run_scheduled',
    'decision_waiting'];
  c_routes     constant text[] := array[
    'staff', 'staff-step', 'staff-run', 'staff-request', 'staff-shopping',
    'staff-checklist', 'staff-notes', 'staff-rewards'];
  v_payload jsonb;
  v_dedupe  text := nullif(btrim(p_dedupe), '');
  v_count   int;
begin
  if p_kind is null or not (p_kind = any(c_kinds)) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if not coalesce(p_payload->>'title_key' = any(c_title_keys), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'title_key';
  end if;
  if not coalesce(p_payload->>'route' = any(c_routes), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'route';
  end if;
  -- The shape is closed, so no caller can put money, a phone number or a
  -- candidate name on a lock screen by adding a key.
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('route', 'id', 'title_key', 'params', 'dedupe')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if p_payload ? 'params' and p_payload->'params' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'params') <> 'object'
       or exists (select 1 from jsonb_object_keys(p_payload->'params') k
                   where k not in ('step', 'title', 'name')) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
    end if;
  end if;

  v_payload := (p_payload - 'dedupe')
            || case when v_dedupe is null then '{}'::jsonb
                    else jsonb_build_object('dedupe', v_dedupe) end;

  insert into notification_outbox (profile_id, kind, payload)
  select s.id, p_kind, v_payload
    from staff s
    join profiles p on p.id = s.id
   where s.id = any(coalesce(p_staff_ids, '{}'::uuid[]))
     and s.is_active
     and s.id is distinct from auth.uid()
     and (v_dedupe is null
          or not exists (select 1 from notification_outbox o
                          where o.profile_id = s.id
                            and o.payload->>'dedupe' = v_dedupe
                            and o.created_at > now() - interval '15 minutes'));
  get diagnostics v_count = row_count;

  perform app.push_nudge();
  return v_count;
end $notify_staff_0363$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1), staff_push_keys_wave5, match_guest_rpcs (0261, match_report_new), loyalty_earn_redeem (0308, loyalty_gift), staff_screenshot_report (0313, screenshot_taken), shop_price_watch (0322, shop_price_changed), checklist_schedules (0323, checklist_due and checklist_overdue), reward_wages (0333, reward_unlocked and the route staff-rewards), marketing_plan (0362, plan_submitted, plan_approved and plan_changes) and protocol_watch (0363, step_passed, run_done, run_withdrawn, run_scheduled and decision_waiting). Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.protocol_watch_ids — the owners to tell about a run's news: active
--    owners (every venue) with protocol_updates on, minus anyone this
--    transaction has already queued a staff push about the run or one of its
--    steps (outbox rows share the transaction's now()).
-- ---------------------------------------------------------------------------
create or replace function app.protocol_watch_ids(p_venue uuid, p_run_id uuid)
returns uuid[]
language sql stable security definer set search_path = public as $protocol_watch_ids_0363$
  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[])
    from unnest(app.staff_ids_with_roles(p_venue, '{owner}')) x(id)
   where coalesce((select pp.protocol_updates from staff_push_prefs pp where pp.staff_id = x.id), true)
     and not exists (
           select 1
             from notification_outbox o
            where o.profile_id = x.id
              and o.created_at = now()
              and o.kind in ('staff_task', 'staff_decide', 'staff_decided', 'staff_info')
              and o.payload->>'id' in (select s.id::text from protocol_run_steps s where s.run_id = p_run_id
                                       union all
                                       select p_run_id::text))
$protocol_watch_ids_0363$;

comment on function app.protocol_watch_ids(uuid, uuid) is
  'protocol_watch (0363). Internal: the owners to tell about a protocol run''s news: active owners (app.staff_ids_with_roles, every venue) whose staff_push_prefs.protocol_updates is on (no row = on), minus any owner this transaction already queued a staff push about the run or one of its steps.';

revoke all on function app.protocol_watch_ids(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The two watch triggers, fired at commit.
-- ---------------------------------------------------------------------------

-- A step passed while its run carries on. The step that finishes a run is
-- told by the run's own news instead (the run is no longer active by commit).
create or replace function app.trg_protocol_step_watch()
returns trigger
language plpgsql security definer set search_path = public as $trg_protocol_step_watch_0363$
declare
  v_run  protocol_runs%rowtype;
  v_now  text;
begin
  select s.status into v_now from protocol_run_steps s where s.id = new.id;
  if v_now is distinct from 'passed' then
    return null;
  end if;
  select * into v_run from protocol_runs where id = new.run_id;
  if not found or v_run.status <> 'active' then
    return null;
  end if;
  perform app.protocol_engine_notify(
    app.protocol_watch_ids(v_run.venue_id, v_run.id),
    'staff_info', 'step_passed', 'staff-step', new.id, v_run.id, new.id);
  return null;
end $trg_protocol_step_watch_0363$;

comment on function app.trg_protocol_step_watch() is
  'protocol_watch (0363). Deferred constraint trigger on protocol_run_steps (status to passed): at commit, while the step is still passed and its run still active, queues staff_info / step_passed (route staff-step) to app.protocol_watch_ids.';

revoke all on function app.trg_protocol_step_watch() from public, anon, authenticated;

drop trigger if exists protocol_run_steps_watch on protocol_run_steps;
create constraint trigger protocol_run_steps_watch
  after update of status on protocol_run_steps
  deferrable initially deferred
  for each row
  when (new.status = 'passed' and old.status is distinct from 'passed')
  execute function app.trg_protocol_step_watch();

-- A run went live, was scheduled, finished, stopped or was withdrawn.
create or replace function app.trg_protocol_run_watch()
returns trigger
language plpgsql security definer set search_path = public as $trg_protocol_run_watch_0363$
declare
  v_now text;
  v_key text;
begin
  select r.status into v_now from protocol_runs r where r.id = new.id;
  -- Moved on again in the same transaction: the later change tells.
  if v_now is distinct from new.status then
    return null;
  end if;
  -- A release from live to done is its day-30 review: review_ready tells.
  if new.status = 'done' and old.status = 'live' then
    return null;
  end if;
  v_key := case new.status
             when 'live'      then 'run_live'
             when 'scheduled' then 'run_scheduled'
             when 'done'      then 'run_done'
             when 'stopped'   then 'run_stopped'
             when 'withdrawn' then 'run_withdrawn'
           end;
  if v_key is null then
    return null;
  end if;
  perform app.protocol_engine_notify(
    app.protocol_watch_ids(new.venue_id, new.id),
    'staff_info', v_key, 'staff-run', new.id, new.id, null);
  return null;
end $trg_protocol_run_watch_0363$;

comment on function app.trg_protocol_run_watch() is
  'protocol_watch (0363). Deferred constraint trigger on protocol_runs (status changed): at commit, while the run still holds that status, queues staff_info / run_live, run_scheduled, run_done, run_stopped or run_withdrawn (route staff-run) to app.protocol_watch_ids; nothing for active, and nothing for live to done (the day-30 review, told by review_ready).';

revoke all on function app.trg_protocol_run_watch() from public, anon, authenticated;

drop trigger if exists protocol_runs_watch on protocol_runs;
create constraint trigger protocol_runs_watch
  after update of status on protocol_runs
  deferrable initially deferred
  for each row
  when (new.status is distinct from old.status)
  execute function app.trg_protocol_run_watch();

-- ---------------------------------------------------------------------------
-- 6. The owner's setting.
-- ---------------------------------------------------------------------------
create or replace function app.my_push_prefs()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_push_prefs_0363$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'protocol_updates',
    coalesce((select pp.protocol_updates from staff_push_prefs pp where pp.staff_id = auth.uid()), true));
end $my_push_prefs_0363$;

comment on function app.my_push_prefs() is
  'protocol_watch (0363). The owner, about themselves: {protocol_updates} (true when they have no row). FORBIDDEN for anyone else.';

revoke all on function app.my_push_prefs() from public, anon;
grant execute on function app.my_push_prefs() to authenticated;

create or replace function app.set_my_push_prefs(p_protocol_updates boolean)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_push_prefs_0363$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_protocol_updates is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'protocol_updates';
  end if;
  insert into staff_push_prefs (staff_id, protocol_updates, updated_at)
  values (auth.uid(), p_protocol_updates, now())
  on conflict (staff_id) do update
    set protocol_updates = excluded.protocol_updates,
        updated_at       = excluded.updated_at;
  perform app.write_audit('staff.push_prefs', 'staff', auth.uid()::text, null,
    jsonb_build_object('protocol_updates', p_protocol_updates));
  return jsonb_build_object('protocol_updates', p_protocol_updates);
end $set_my_push_prefs_0363$;

comment on function app.set_my_push_prefs(boolean) is
  'protocol_watch (0363). The owner turns their protocol status pushes on or off (staff_push_prefs.protocol_updates); state-idempotent. Audit staff.push_prefs. Returns {protocol_updates}. FORBIDDEN for anyone else; INVALID_ARGUMENT for NULL.';

revoke all on function app.set_my_push_prefs(boolean) from public, anon;
grant execute on function app.set_my_push_prefs(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.protocol_remind_sweep — internal, cron tp_protocol_remind.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_remind_sweep()
returns int
language plpgsql security definer set search_path = public as $protocol_remind_sweep_0363$
declare
  c_first  constant interval := interval '3 hours';
  c_repeat constant interval := interval '24 hours';
  v_venue  record;
  v_sub    record;
  v_to     uuid[];
  v_n      int := 0;
begin
  for v_venue in
    select v.id, coalesce(v.timezone, 'Asia/Baghdad') as tz
      from venues v
     where v.status <> 'closed'
     order by v.id
  loop
    -- Not at night: a reminder due then waits for the morning.
    continue when extract(hour from now() at time zone v_venue.tz) not between 9 and 22;
    begin
      perform set_config('app.venue_id', v_venue.id::text, true);
      for v_sub in
        select x.id, x.submitted_by, x.reminded_at, s.id as step_id, s.needs_owner_ok, r.id as run_id
          from protocol_submissions x
          join protocol_run_steps s on s.id = x.run_step_id
          join protocol_runs r on r.id = x.run_id
         where r.venue_id = v_venue.id
           and r.status = 'active'
           and s.status = 'submitted'
           and x.round = s.round
           and x.decision is null
           and x.withdrawn_at is null
           and x.superseded_at is null
           and ((x.reminded_at is null and now() >= x.submitted_at + c_first)
                or now() >= x.reminded_at + c_repeat)
         order by x.submitted_at, x.id
      loop
        update protocol_submissions
           set reminded_at = now()
         where id = v_sub.id
           and reminded_at is not distinct from v_sub.reminded_at;
        -- Another sweep stamped it first.
        continue when not found;

        select coalesce(array_agg(d.id), '{}'::uuid[]) into v_to
          from unnest(app.protocol_engine_decider_ids(v_venue.id, v_sub.needs_owner_ok)) d(id)
         where d.id <> v_sub.submitted_by;
        v_n := v_n + app.protocol_engine_notify(
          v_to, 'staff_decide', 'decision_waiting', 'staff-step', v_sub.step_id, v_sub.run_id, v_sub.step_id);
      end loop;
    exception when others then
      raise warning 'protocol_remind_sweep venue %: % (%)', v_venue.id, sqlerrm, sqlstate;
    end;
  end loop;
  return v_n;
end $protocol_remind_sweep_0363$;

comment on function app.protocol_remind_sweep() is
  'protocol_watch (0363). Internal, service role (cron tp_protocol_remind, every 15 minutes). For every branch that is not closed, between 09:00 and 23:00 in its timezone, in its own exception block with app.venue_id set: every undecided submission of the current round on a submitted step of an active run, 3 hours after it was sent and then every 24 hours, stamps reminded_at and queues staff_decide / decision_waiting (route staff-step, the step''s name and the run''s title) to app.protocol_engine_decider_ids minus the sender. Returns the pushes queued.';

revoke all on function app.protocol_remind_sweep() from public, anon, authenticated;
grant execute on function app.protocol_remind_sweep() to service_role;

-- tp_protocol_remind: every 15 minutes, its own transaction. Guarded like
-- 0323's tp_checklist_sweep. After a hosted push, cron.job must have the row
-- (packages/db/CLAUDE.md).
do $protocol_remind_cron_0363$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_protocol_remind not scheduled';
    return;
  end if;
  perform cron.schedule('tp_protocol_remind', '*/15 * * * *', 'select app.protocol_remind_sweep();');
end $protocol_remind_cron_0363$;
