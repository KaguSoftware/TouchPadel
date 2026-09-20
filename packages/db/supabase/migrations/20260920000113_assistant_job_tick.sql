-- 0113_assistant_job_tick — the minute tick that finishes BATCH jobs
-- (docs/design/assistant/owner-assistant-plan-2026-09-20.md §4.3, §6.4).
--
-- A batch job hands its chunks to the vendor's Batch API and returns. Nothing
-- in the venue is waiting on it, so nothing would ever collect the results
-- without a clock: this schedules one. app.assistant_job_tick_nudge posts
-- {action:'tick'} to the assistant-job function through pg_net, but ONLY while
-- a running batch job exists — a venue that never presses "Run as batch" makes
-- no HTTP call at all. Guarded exactly like app.assistant_index_nudge (0110):
-- silent without pg_net, without the two secrets, or without pg_cron.
--
-- No table, no index, no rewrite: a function and a cron row.

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.assistant_job_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $assistant_job_tick_nudge_0113$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from assistant_jobs
                    where status = 'running' and mode = 'batch' and batch_id is not null) then
      return;                                  -- nothing in flight: no HTTP
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/assistant-job',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'assistant_job_tick_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $assistant_job_tick_nudge_0113$;

comment on function app.assistant_job_tick_nudge() is
  '0113. Every minute while a batch job is running: asks the assistant-job edge function to poll the vendor batch and finish the job. Posts nothing when no batch job is in flight. Silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.assistant_job_tick_nudge() from public, anon, authenticated;

do $assistant_cron_0113$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - assistant job tick skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_assistant_job_tick not scheduled';
    return;
  end if;

  -- cron.schedule upserts by job name (0021).
  perform cron.schedule('tp_assistant_job_tick', '* * * * *', 'select app.assistant_job_tick_nudge();');
end $assistant_cron_0113$;
