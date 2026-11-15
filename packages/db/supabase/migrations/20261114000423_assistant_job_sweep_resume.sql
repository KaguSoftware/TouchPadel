-- ===========================================================================
-- 0423 — assistant jobs: the stuck-job sweeper and the resume of a paused job
--        (design 2026-11-12, after the job runner rewrite of 2026-11-11).
--
-- Nothing recovered a stuck job: a live job whose function instance died stayed
-- 'accepted' or 'running' forever (the tick claims batch jobs only, 0405), a
-- death between 'reducing' and 'done' left 'reducing', a batch submit killed
-- before its id was saved left 'running' with batch_id NULL (invisible to the
-- nudge and the claim), a tick killed mid-job re-ran it every two minutes with
-- no limit (and a killed reduce billed each time), and estimates nobody
-- answered stayed 'estimated' for ever.
--
-- A. Two columns on assistant_jobs.
--    status_at    when the job entered its current status. Stamped by
--                 app.assistant_job_transition and app.assistant_job_cancel
--                 (both re-issued below) and by app.assistant_job_expire;
--                 default now() for a new estimate; backfilled from finished_at,
--                 started_at, created_at. started_at is stamped on the FIRST
--                 running only, so after a resume it no longer says how long the
--                 job has been in its state.
--    tick_lapses  how many times a tick took a job whose previous tick's lease
--                 had lapsed instead of being released (the previous tick died
--                 holding it). Written only by app.assistant_job_claim_tick
--                 (re-issued below); app.assistant_job_transition resets it on
--                 every move to 'running'.
--    Both are internal (not in app.assistant_readable_columns), like 0405's
--    tick_claimed_until.
--
-- B. app.assistant_job_transition (0112 no longer): the same allowlist, the
--    same table of moves (app.assistant_job_allowed, 0112, unchanged: the
--    resume is over_estimate → running, the sweeper's moves are running →
--    over_estimate, reducing → done and → failed, all legal since 0112), plus
--    status_at = now() on every move and tick_lapses = 0 on a move to running.
--    app.assistant_job_cancel (0112 no longer): + status_at.
--    app.assistant_job_claim_tick (0405 no longer): + tick_lapses + 1 when the
--    stamp it takes over had lapsed (not NULL).
--
-- C. app.assistant_job_stuck_reason(assistant_jobs) — internal; the one
--    predicate of a stuck job, ages on coalesce(status_at, created_at):
--      stalled_start   accepted, older than 10 minutes
--      stalled_live    running, live, older than 10 minutes (a live job runs
--                      inside one request: 50 s by its own clock, 400 s at most
--                      by the platform's)
--      stalled_submit  running, batch, batch_id NULL, older than 10 minutes
--      batch_overdue   running, batch, older than 26 hours (the vendor ends a
--                      batch at 24 hours; the tick has had two more)
--      lease_lapsing   running, batch, tick_lapses >= 3
--      stalled_reduce  reducing, older than 10 minutes
--    app.assistant_job_claim_stuck(p_seconds, p_limit) — service role; claims
--    the stuck jobs no tick holds, FOR UPDATE SKIP LOCKED, stamps the lease as
--    0405's claim does, and returns (job_id, reason, claimed_until). The
--    assistant-job tick calls it first and does the failing in the edge, where
--    the failed chat message, the Monitoring event and the vendor batch cancel
--    live (_shared/assistant/jobRunner.ts sweep). No model call anywhere.
--
-- D. app.assistant_job_expire() — internal; an estimate nobody pressed for 7
--    days, and a paused job nobody resumed or cancelled for 7 days, become
--    'cancelled' with error 'EXPIRED: …'. No money moves: an estimate has spent
--    nothing and a paused live job has no vendor batch.
--    app.assistant_job_tick_nudge (0113 no longer): expires first, then posts
--    the tick while a running batch job exists (0113's predicate, unchanged) OR
--    a stuck job waits (app.assistant_job_stuck_due()); until now no tick ran
--    at all without a batch in flight. Its catch-all also stores the error on
--    the Monitoring page (0402's rule for a cron body).
--
-- No new client grant, no new error code: INVALID_ARGUMENT exists. The four new
-- functions are service-role or internal, listed as excluded in
-- fixtures/assistant-coverage.json. app.setup_expected (0385) has no kind for
-- the two secrets the nudge reads, so they are not registered there.
--
-- covered by packages/db/tests/assistant-job-sweep.test.ts (one rolled-back
-- psql transaction), tests/assistant-jobs.test.ts (status_at, the allowlist)
-- and tests/assistant-job-runner.test.ts (the edge side, stackless).
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- A. Columns
-- ---------------------------------------------------------------------------
-- Nullable first: a metadata-only ADD COLUMN; the backfill touches a club's
-- few job rows; the default applies to new rows only.
alter table public.assistant_jobs
  add column if not exists status_at timestamptz;

update public.assistant_jobs j
   set status_at = coalesce(j.finished_at, j.started_at, j.created_at)
 where j.status_at is null;

alter table public.assistant_jobs
  alter column status_at set default now();

comment on column public.assistant_jobs.status_at is
  '0423. When the job entered its current status: stamped by app.assistant_job_transition, app.assistant_job_cancel and app.assistant_job_expire, default now(). The sweeper (app.assistant_job_stuck_reason) ages a job on it. Internal (not in app.assistant_readable_columns).';

-- A constant default: metadata only, no rewrite.
alter table public.assistant_jobs
  add column if not exists tick_lapses smallint not null default 0;

comment on column public.assistant_jobs.tick_lapses is
  '0423. How many times app.assistant_job_claim_tick took over a lease that had lapsed instead of being released (the tick holding it died). Reset to 0 on every move to running. Three lapses make the job stuck (lease_lapsing). Internal.';

-- ---------------------------------------------------------------------------
-- B. The state machine's writers, re-issued
-- ---------------------------------------------------------------------------
create or replace function app.assistant_job_transition(p_id uuid, p_status text, p_patch jsonb default null)
returns assistant_jobs
language plpgsql security definer set search_path = public as $assistant_job_transition_0423$
declare
  v_job   assistant_jobs%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_bad   text;
begin
  if p_id is null or p_status is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_id / p_status';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch', hint = 'an object';
  end if;
  select k into v_bad from jsonb_object_keys(v_patch) k
   where k not in ('mode', 'chunks_total', 'chunks_done', 'tokens', 'result', 'error', 'batch_id', 'estimate', 'message_id')
   limit 1;
  if v_bad is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch.' || v_bad,
      hint = 'mode, chunks_total, chunks_done, tokens, result, error, batch_id, estimate, message_id';
  end if;

  select * into v_job from assistant_jobs where id = p_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not app.assistant_job_allowed(v_job.status, p_status) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = v_job.status || ' -> ' || p_status;
  end if;

  update assistant_jobs j
     set status       = p_status,
         mode         = case when v_patch ? 'mode'         then v_patch ->> 'mode'                else j.mode end,
         chunks_total = case when v_patch ? 'chunks_total' then (v_patch ->> 'chunks_total')::int else j.chunks_total end,
         chunks_done  = case when v_patch ? 'chunks_done'  then (v_patch ->> 'chunks_done')::int  else j.chunks_done end,
         tokens       = case when v_patch ? 'tokens'       then v_patch -> 'tokens'               else j.tokens end,
         result       = case when v_patch ? 'result'       then v_patch -> 'result'               else j.result end,
         error        = case when v_patch ? 'error'        then v_patch ->> 'error'               else j.error end,
         batch_id     = case when v_patch ? 'batch_id'     then v_patch ->> 'batch_id'            else j.batch_id end,
         estimate     = case when v_patch ? 'estimate'     then v_patch -> 'estimate'             else j.estimate end,
         message_id   = case when v_patch ? 'message_id'   then (v_patch ->> 'message_id')::uuid  else j.message_id end,
         started_at   = case when p_status = 'running' and j.started_at is null then now() else j.started_at end,
         finished_at  = case when p_status in ('done', 'failed', 'cancelled') then now() else j.finished_at end,
         status_at    = now(),
         tick_lapses  = case when p_status = 'running' then 0 else j.tick_lapses end
   where j.id = p_id
  returning j.* into v_job;

  return v_job;
end $assistant_job_transition_0423$;

comment on function app.assistant_job_transition(uuid, text, jsonb) is
  '0423 (0112). Service role only. Moves a job to p_status if the state machine allows it (INVALID_TRANSITION otherwise), applies p_patch (mode, chunks_total, chunks_done, tokens, result, error, batch_id, estimate, message_id), stamps started_at on the first running, finished_at on a terminal state and status_at on every move, resets tick_lapses on a move to running, and returns the row.';

revoke all on function app.assistant_job_transition(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function app.assistant_job_transition(uuid, text, jsonb) to service_role;

create or replace function app.assistant_job_cancel(p_id uuid)
returns assistant_jobs
language plpgsql security definer set search_path = public as $assistant_job_cancel_0423$
declare
  v_job assistant_jobs%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_id';
  end if;

  select * into v_job from assistant_jobs where id = p_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.assistant_job_allowed(v_job.status, 'cancelled') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = v_job.status || ' -> cancelled';
  end if;

  update assistant_jobs j
     set status = 'cancelled', finished_at = now(), status_at = now()
   where j.id = p_id
  returning j.* into v_job;

  return v_job;
end $assistant_job_cancel_0423$;

comment on function app.assistant_job_cancel(uuid) is
  '0423 (0112). Owner-only. Moves any non-terminal job to cancelled (finished_at and status_at stamped) and returns the row; a finished job answers INVALID_TRANSITION. The edge function cancels the provider batch afterwards when batch_id is set.';

revoke all on function app.assistant_job_cancel(uuid) from public, anon;
grant execute on function app.assistant_job_cancel(uuid) to authenticated;

create or replace function app.assistant_job_claim_tick(p_seconds int default 120)
returns table (job_id uuid, claimed_until timestamptz)
language plpgsql security definer set search_path = public as $assistant_job_claim_tick_0423$
begin
  -- The claim must outlast the edge's 50 s wall (assistant-job WALL_MS) and
  -- never pin a job for long: 1..900 seconds.
  if p_seconds is null or p_seconds < 1 or p_seconds > 900 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seconds', hint = '1 to 900';
  end if;

  -- 0113's predicate (assistant_job_tick_nudge) plus "unclaimed or lapsed".
  -- SKIP LOCKED: a job another tick is claiming right now is skipped, never
  -- waited on; one whose claim committed meanwhile fails the re-checked WHERE.
  -- 0423: a stamp still there was never released, so the tick holding it died:
  -- counted in tick_lapses (three make the job stuck, lease_lapsing).
  return query
  with due as (
    select j.id
      from assistant_jobs j
     where j.status = 'running'
       and j.mode = 'batch'
       and j.batch_id is not null
       and (j.tick_claimed_until is null or j.tick_claimed_until <= now())
     order by j.id
       for update of j skip locked
  )
  update assistant_jobs j
     set tick_claimed_until = now() + make_interval(secs => p_seconds),
         tick_lapses        = case when j.tick_claimed_until is not null
                                   then least(j.tick_lapses + 1, 32767)::smallint
                                   else j.tick_lapses end
    from due
   where j.id = due.id
  returning j.id, j.tick_claimed_until;
end $assistant_job_claim_tick_0423$;

comment on function app.assistant_job_claim_tick(int) is
  '0423 (0405). Service role only. Claims the running batch jobs (status running, mode batch, batch_id set: 0113''s predicate) whose tick_claimed_until is NULL or lapsed, FOR UPDATE SKIP LOCKED, stamps tick_claimed_until = now() + p_seconds (1..900, default 120), adds 1 to tick_lapses when it takes over a lapsed stamp, and returns (job_id, claimed_until). Two concurrent ticks never get the same job. INVALID_ARGUMENT for p_seconds out of range.';

revoke all on function app.assistant_job_claim_tick(int) from public, anon, authenticated;
grant execute on function app.assistant_job_claim_tick(int) to service_role;

-- ---------------------------------------------------------------------------
-- C. The sweeper's predicate and claim
-- ---------------------------------------------------------------------------
-- plpgsql, not LANGUAGE sql: never inlined into a caller's plan.
create or replace function app.assistant_job_stuck_reason(p_job assistant_jobs)
returns text
language plpgsql stable set search_path = public as $assistant_job_stuck_reason_0423$
declare
  v_age interval := now() - coalesce(p_job.status_at, p_job.created_at);
begin
  if p_job.status = 'accepted' and v_age > interval '10 minutes' then
    return 'stalled_start';
  elsif p_job.status = 'running' and p_job.mode = 'live' and v_age > interval '10 minutes' then
    return 'stalled_live';
  elsif p_job.status = 'running' and p_job.mode = 'batch' and p_job.batch_id is null and v_age > interval '10 minutes' then
    return 'stalled_submit';
  elsif p_job.status = 'running' and p_job.mode = 'batch' and v_age > interval '26 hours' then
    return 'batch_overdue';
  elsif p_job.status = 'running' and p_job.mode = 'batch' and p_job.tick_lapses >= 3 then
    return 'lease_lapsing';
  elsif p_job.status = 'reducing' and v_age > interval '10 minutes' then
    return 'stalled_reduce';
  end if;
  return null;
end $assistant_job_stuck_reason_0423$;

comment on function app.assistant_job_stuck_reason(assistant_jobs) is
  '0423. Internal. Why a job is stuck, or NULL: stalled_start (accepted > 10 min), stalled_live (running live > 10 min), stalled_submit (running batch, no batch_id, > 10 min), batch_overdue (running batch > 26 h), lease_lapsing (running batch, tick_lapses >= 3), stalled_reduce (reducing > 10 min); ages on coalesce(status_at, created_at).';

revoke all on function app.assistant_job_stuck_reason(assistant_jobs) from public, anon, authenticated;

create or replace function app.assistant_job_claim_stuck(p_seconds int default 120, p_limit int default 10)
returns table (job_id uuid, reason text, claimed_until timestamptz)
language plpgsql security definer set search_path = public as $assistant_job_claim_stuck_0423$
begin
  if p_seconds is null or p_seconds < 1 or p_seconds > 900 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seconds', hint = '1 to 900';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_limit', hint = '1 to 100';
  end if;

  -- The partial index assistant_jobs_status_idx (0108) holds exactly these
  -- states. SKIP LOCKED, and the lease, as 0405's claim: two ticks never sweep
  -- one job, and a batch job swept here is not also polled by this minute's
  -- claim_tick (its lease is taken).
  return query
  with due as (
    select j.id, app.assistant_job_stuck_reason(j) as why
      from assistant_jobs j
     where j.status in ('accepted', 'running', 'reducing')
       and (j.tick_claimed_until is null or j.tick_claimed_until <= now())
       and app.assistant_job_stuck_reason(j) is not null
     order by coalesce(j.status_at, j.created_at), j.id
     limit p_limit
       for update of j skip locked
  )
  update assistant_jobs j
     set tick_claimed_until = now() + make_interval(secs => p_seconds)
    from due
   where j.id = due.id
  returning j.id, due.why, j.tick_claimed_until;
end $assistant_job_claim_stuck_0423$;

comment on function app.assistant_job_claim_stuck(int, int) is
  '0423. Service role only. Claims up to p_limit (1..100, default 10) stuck jobs (app.assistant_job_stuck_reason not NULL) whose tick_claimed_until is NULL or lapsed, oldest first, FOR UPDATE SKIP LOCKED; stamps tick_claimed_until = now() + p_seconds (1..900, default 120) and returns (job_id, reason, claimed_until). The assistant-job tick fails, pauses or finishes each in the edge. INVALID_ARGUMENT for an argument out of range.';

revoke all on function app.assistant_job_claim_stuck(int, int) from public, anon, authenticated;
grant execute on function app.assistant_job_claim_stuck(int, int) to service_role;

create or replace function app.assistant_job_stuck_due()
returns boolean
language plpgsql stable security definer set search_path = public as $assistant_job_stuck_due_0423$
begin
  return exists (
    select 1 from assistant_jobs j
     where j.status in ('accepted', 'running', 'reducing')
       and (j.tick_claimed_until is null or j.tick_claimed_until <= now())
       and app.assistant_job_stuck_reason(j) is not null);
end $assistant_job_stuck_due_0423$;

comment on function app.assistant_job_stuck_due() is
  '0423. Internal. Whether app.assistant_job_claim_stuck would claim a job now (the nudge''s second reason to post the tick).';

revoke all on function app.assistant_job_stuck_due() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. Expiry and the nudge
-- ---------------------------------------------------------------------------
create or replace function app.assistant_job_expire()
returns int
language plpgsql security definer set search_path = public as $assistant_job_expire_0423$
declare
  v_n int;
begin
  -- An estimate has spent nothing; a paused job is a live one (no vendor
  -- batch), its spend already recorded. Quiet: no chat message, no event.
  update assistant_jobs j
     set status      = 'cancelled',
         error       = case when j.status = 'estimated'
                            then 'EXPIRED: nobody chose how to run it within 7 days'
                            else 'EXPIRED: it waited paused for 7 days' end,
         finished_at = now(),
         status_at   = now()
   where j.status in ('estimated', 'over_estimate')
     and coalesce(j.status_at, j.created_at) < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $assistant_job_expire_0423$;

comment on function app.assistant_job_expire() is
  '0423. Internal (the nudge). An estimated or over_estimate (paused) job older than 7 days in that state becomes cancelled with error EXPIRED: …, finished_at and status_at stamped; returns how many.';

revoke all on function app.assistant_job_expire() from public, anon, authenticated;

create or replace function app.assistant_job_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $assistant_job_tick_nudge_0423$
declare
  v_base text;
  v_key  text;
begin
  begin
    perform app.assistant_job_expire();
    if not exists (select 1 from assistant_jobs
                    where status = 'running' and mode = 'batch' and batch_id is not null)
       and not app.assistant_job_stuck_due() then
      return;                                  -- nothing in flight, nothing stuck: no HTTP
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
    perform app.monitor('cron', 'error', 'assistant_job_tick_nudge_failed',
                        'assistant_job_tick_nudge failed: ' || sqlerrm,
                        jsonb_build_object('sqlstate', sqlstate));
  end;
end $assistant_job_tick_nudge_0423$;

comment on function app.assistant_job_tick_nudge() is
  '0423 (0113). Every minute: expires week-old estimates and paused jobs (app.assistant_job_expire), then asks the assistant-job edge function to tick while a batch job is running or a stuck job waits (app.assistant_job_stuck_due). Posts nothing otherwise. Silent without pg_net or the functions_base_url / service_role_key secrets; a caught error goes to the Monitoring page (app.monitor) and never raises.';

revoke all on function app.assistant_job_tick_nudge() from public, anon, authenticated;
