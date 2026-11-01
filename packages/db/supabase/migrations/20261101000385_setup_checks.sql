-- 0385 setup_checks — a setup step never fails quietly (launch finding F-55,
-- Majed 2026-11-01: "Setup failures must error clearly and report to the
-- monitoring panel").
--
-- Buckets, storage policies, realtime policies and every cron schedule were
-- created by DO blocks that answered a failure (pg_cron absent, storage not
-- writable, realtime.messages missing) with a NOTICE and carried on, so any of
-- them could be missing on hosted with every migration "green".
--
--   app.setup_expected      what the migrations set up: 4 buckets, the
--                           storage.objects and realtime.messages policies,
--                           every tp_* cron job (by name) and the PostgREST
--                           pre-request hook of 0384. Seeded here from what
--                           0001-0384 create; a later migration registers its
--                           own (app.ensure_cron does it for a cron job,
--                           app.expect_setup for anything else).
--   app.setup_missing()     the expected pieces that are not there now.
--   app.ensure_cron(name, schedule, command)
--                           the cron block from here on: schedules the job and
--                           RAISES SETUP_FAILED (P0001, detail saying what and
--                           why) when pg_cron is absent or the job did not
--                           land, and registers it in app.setup_expected.
--   app.setup_check()       reports every missing piece to the Monitoring page
--                           as one setup_failed event (source db, level error)
--                           through app.monitor (0393, the monitoring
--                           contract). Cron tp_setup_check runs it every hour.
--                           app.monitor lands after this file (0393): the call
--                           is made only when the function exists, so this
--                           migration applies in ordinal order either way.
--
-- AT MIGRATION TIME the check below RAISES SETUP_FAILED listing every missing
-- piece, so a hosted project missing a bucket, policy, cron job or the hook
-- fails its `supabase db push` loudly instead of passing with a NOTICE. (A
-- monitoring event written inside a failing migration would roll back with it;
-- the hourly tp_setup_check is the reporter, the failed deploy is the error.)
-- The older DO blocks are history and are not edited; this check covers what
-- they were meant to create.
--
-- covered by packages/db/tests/setup-checks.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The registry.
-- ---------------------------------------------------------------------------
create table if not exists app.setup_expected (
  kind       text not null,
  name       text not null,
  added_at   timestamptz not null default now(),
  primary key (kind, name),
  constraint setup_expected_kind_chk
    check (kind in ('bucket', 'storage_policy', 'realtime_policy', 'cron_job', 'pgrst_hook'))
);

comment on table app.setup_expected is
  '0385 (F-55). Setup the migrations create and that must exist: buckets, storage.objects and realtime.messages policies, cron jobs (by jobname), the PostgREST pre-request hook. Read by app.setup_missing; written by migrations (app.ensure_cron, app.expect_setup).';

alter table app.setup_expected enable row level security;
revoke all on table app.setup_expected from public, anon, authenticated;

insert into app.setup_expected (kind, name) values
  ('bucket', 'avatars'),
  ('bucket', 'menu-media'),
  ('bucket', 'staff-media'),
  ('bucket', 'venue-files'),
  ('realtime_policy', 'touchpadel_rt_checklists'),
  ('realtime_policy', 'touchpadel_rt_courts'),
  ('realtime_policy', 'touchpadel_rt_guest_session'),
  ('realtime_policy', 'touchpadel_rt_menu'),
  ('realtime_policy', 'touchpadel_rt_ranks'),
  ('realtime_policy', 'touchpadel_rt_staff_topics'),
  ('storage_policy', 'avatars_delete'),
  ('storage_policy', 'avatars_insert'),
  ('storage_policy', 'avatars_read'),
  ('storage_policy', 'menu_media_public_read'),
  ('storage_policy', 'menu_media_staff_delete'),
  ('storage_policy', 'menu_media_staff_insert'),
  ('storage_policy', 'menu_media_staff_update'),
  ('storage_policy', 'staff_media_delete'),
  ('storage_policy', 'staff_media_insert'),
  ('storage_policy', 'staff_media_read'),
  ('storage_policy', 'venue_files_delete'),
  ('storage_policy', 'venue_files_insert'),
  ('storage_policy', 'venue_files_read'),
  ('cron_job', 'tp_assistant_cache_fill'),
  ('cron_job', 'tp_assistant_index_prune'),
  ('cron_job', 'tp_assistant_index_sweep'),
  ('cron_job', 'tp_assistant_job_tick'),
  ('cron_job', 'tp_assistant_prewarm'),
  ('cron_job', 'tp_checklist_sweep'),
  ('cron_job', 'tp_coach_statements'),
  ('cron_job', 'tp_degraded_sweep'),
  ('cron_job', 'tp_deposit_sweep'),
  ('cron_job', 'tp_expiry_flagging'),
  ('cron_job', 'tp_hiring_purge'),
  ('cron_job', 'tp_hold_strikes'),
  ('cron_job', 'tp_hold_sweep'),
  ('cron_job', 'tp_incident_purge'),
  ('cron_job', 'tp_lesson_sweep'),
  ('cron_job', 'tp_loyalty_nightly'),
  ('cron_job', 'tp_match_sweep'),
  ('cron_job', 'tp_price_promo_apply'),
  ('cron_job', 'tp_protocol_remind'),
  ('cron_job', 'tp_protocol_tick'),
  ('cron_job', 'tp_push_sweep'),
  ('cron_job', 'tp_release_review'),
  ('cron_job', 'tp_reward_sweep'),
  ('cron_job', 'tp_scan_sweep'),
  ('cron_job', 'tp_shop_reward_sweep'),
  ('cron_job', 'tp_telegram_prune'),
  ('cron_job', 'tp_telegram_sweep'),
  ('cron_job', 'tp_tournament_sweep'),
  ('pgrst_hook', 'app.pre_request')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. What is missing now.
-- ---------------------------------------------------------------------------
create or replace function app.setup_missing()
returns table (kind text, name text)
language plpgsql stable security definer set search_path = public as $setup_missing_0385$
declare
  e       record;
  v_found boolean;
begin
  for e in select x.kind, x.name from app.setup_expected x order by x.kind, x.name loop
    v_found := false;
    if e.kind = 'bucket' then
      if to_regclass('storage.buckets') is not null then
        execute 'select exists (select 1 from storage.buckets where id = $1)' into v_found using e.name;
      end if;
    elsif e.kind = 'storage_policy' then
      v_found := exists (select 1 from pg_policies p
                          where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = e.name);
    elsif e.kind = 'realtime_policy' then
      v_found := exists (select 1 from pg_policies p
                          where p.schemaname = 'realtime' and p.tablename = 'messages' and p.policyname = e.name);
    elsif e.kind = 'cron_job' then
      if to_regclass('cron.job') is not null then
        execute 'select exists (select 1 from cron.job where jobname = $1)' into v_found using e.name;
      end if;
    elsif e.kind = 'pgrst_hook' then
      v_found := exists (select 1 from pg_roles r, unnest(r.rolconfig) c
                          where r.rolname = 'authenticator'
                            and c = 'pgrst.db_pre_request=' || e.name);
    end if;
    if not v_found then
      kind := e.kind;
      name := e.name;
      return next;
    end if;
  end loop;
end $setup_missing_0385$;

comment on function app.setup_missing() is
  '0385 (F-55). Every app.setup_expected piece that is not there now: a bucket, a storage.objects or realtime.messages policy, a cron job (paused or not), the authenticator role''s pgrst.db_pre_request.';

revoke all on function app.setup_missing() from public, anon, authenticated;
grant execute on function app.setup_missing() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Registering setup, and the cron block from here on.
-- ---------------------------------------------------------------------------
create or replace function app.expect_setup(p_kind text, p_name text)
returns void
language sql security definer set search_path = public as $expect_setup_0385$
  insert into app.setup_expected (kind, name) values (p_kind, p_name) on conflict do nothing;
$expect_setup_0385$;

comment on function app.expect_setup(text, text) is
  '0385 (F-55). For migrations: registers a piece of setup (bucket, storage_policy, realtime_policy, cron_job, pgrst_hook) that app.setup_missing must find from now on.';

revoke all on function app.expect_setup(text, text) from public, anon, authenticated;

create or replace function app.ensure_cron(p_name text, p_schedule text, p_command text)
returns void
language plpgsql security definer set search_path = public as $ensure_cron_0385$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'SETUP_FAILED' using errcode = 'P0001',
      detail = format('pg_cron is not installed, so cron job %s (%s) cannot be scheduled', p_name, p_schedule),
      hint = 'enable pg_cron (Database > Extensions) and push again';
  end if;
  begin
    perform cron.schedule(p_name, p_schedule, p_command);
  exception when others then
    raise exception 'SETUP_FAILED' using errcode = 'P0001',
      detail = format('cron job %s (%s) was not scheduled: %s', p_name, p_schedule, sqlerrm);
  end;
  if not exists (select 1 from cron.job j where j.jobname = p_name and j.schedule = p_schedule) then
    raise exception 'SETUP_FAILED' using errcode = 'P0001',
      detail = format('cron job %s (%s) is not in cron.job after scheduling', p_name, p_schedule);
  end if;
  perform app.expect_setup('cron_job', p_name);
end $ensure_cron_0385$;

comment on function app.ensure_cron(text, text, text) is
  '0385 (F-55). For migrations: schedules (or reschedules) cron job p_name and raises SETUP_FAILED, with what and why in the detail, when pg_cron is absent or the job is not in cron.job afterwards; registers it in app.setup_expected.';

revoke all on function app.ensure_cron(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The report: one setup_failed event on the Monitoring page.
-- ---------------------------------------------------------------------------
create or replace function app.setup_check() returns int
language plpgsql security definer set search_path = public as $setup_check_0385$
declare
  v_missing text[];
begin
  select coalesce(array_agg(m.kind || ':' || m.name order by m.kind, m.name), '{}')
    into v_missing
    from app.setup_missing() m;
  if cardinality(v_missing) > 0
     and to_regprocedure('app.monitor(text,text,text,text,jsonb)') is not null then
    execute 'select app.monitor($1, $2, $3, $4, $5)'
      using 'db', 'error', 'setup_failed',
            'Setup is missing: ' || array_to_string(v_missing, ', '),
            jsonb_build_object('missing', to_jsonb(v_missing), 'check', 'app.setup_check');
  end if;
  return cardinality(v_missing);
end $setup_check_0385$;

comment on function app.setup_check() is
  '0385 (F-55). Service role (cron tp_setup_check, hourly): reports every app.setup_missing piece as one setup_failed event (source db, level error) through app.monitor when that exists (0393); returns how many are missing.';

revoke all on function app.setup_check() from public, anon, authenticated;
grant execute on function app.setup_check() to service_role;

do $setup_check_cron_0385$
begin
  perform app.ensure_cron('tp_setup_check', '17 * * * *', 'select app.setup_check();');
end $setup_check_cron_0385$;

-- ---------------------------------------------------------------------------
-- 5. Now: everything 0001-0384 set up must be here, or this push fails.
-- ---------------------------------------------------------------------------
do $setup_verify_0385$
declare
  v_missing text;
begin
  select string_agg(m.kind || ':' || m.name, ', ' order by m.kind, m.name)
    into v_missing
    from app.setup_missing() m;
  if v_missing is not null then
    raise exception 'SETUP_FAILED' using errcode = 'P0001',
      detail = 'missing setup: ' || v_missing,
      hint = 'create each piece (Dashboard or a migration) and push again; app.setup_missing() lists them';
  end if;
end $setup_verify_0385$;
