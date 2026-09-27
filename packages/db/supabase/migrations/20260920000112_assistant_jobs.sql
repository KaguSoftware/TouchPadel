-- ===========================================================================
-- 0112 — owner assistant: the job state machine.
--
-- docs/design/assistant/owner-assistant-plan-2026-09-20.md §2.7, §6.4 and
-- build-contracts-2026-09-20.md "Lane A · 0112 jobs helpers".
--
-- A job is a read over more rows than a chat turn may hold. The owner sees an
-- estimate first and accepts a mode; the assistant-job edge function then
-- moves the row through its states under the service role, and the owner may
-- cancel from the UI at any non-terminal state. Every move goes through
-- app.assistant_job_transition so an impossible sequence (done → running,
-- cancelled → accepted) is refused with INVALID_TRANSITION rather than written.
--
--   estimated ─→ accepted ─→ running ─→ reducing ─→ done
--       │            │          │  └────→ over_estimate ─→ running
--       │            │          └────→ failed
--       └────────────┴──────────┴──── cancelled   (also from reducing, over_estimate)
--
-- Terminal: done, failed, cancelled.
--
-- covered by packages/db/tests/assistant-jobs.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.assistant_job_allowed — the table of legal moves (definer-only)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_job_allowed(p_from text, p_to text)
returns boolean
language sql immutable parallel safe set search_path = public as $assistant_job_allowed_0112$
  select case p_from
           when 'estimated'     then p_to in ('accepted', 'cancelled')
           when 'accepted'      then p_to in ('running', 'cancelled')
           when 'running'       then p_to in ('reducing', 'over_estimate', 'failed', 'cancelled')
           when 'reducing'      then p_to in ('done', 'failed', 'cancelled')
           when 'over_estimate' then p_to in ('running', 'failed', 'cancelled')
           else false                      -- done, failed, cancelled are terminal
         end;
$assistant_job_allowed_0112$;

comment on function app.assistant_job_allowed(text, text) is
  '0112. True when a job may move from p_from to p_to. done, failed and cancelled are terminal.';

revoke all on function app.assistant_job_allowed(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.assistant_job_transition — service role only
-- ---------------------------------------------------------------------------
create or replace function app.assistant_job_transition(p_id uuid, p_status text, p_patch jsonb default null)
returns assistant_jobs
language plpgsql security definer set search_path = public as $assistant_job_transition_0112$
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
         finished_at  = case when p_status in ('done', 'failed', 'cancelled') then now() else j.finished_at end
   where j.id = p_id
  returning j.* into v_job;

  return v_job;
end $assistant_job_transition_0112$;

comment on function app.assistant_job_transition(uuid, text, jsonb) is
  '0112. Service role only. Moves a job to p_status if the state machine allows it (INVALID_TRANSITION otherwise), applies p_patch (mode, chunks_total, chunks_done, tokens, result, error, batch_id, estimate, message_id), stamps started_at on the first running and finished_at on a terminal state, and returns the row.';

revoke all on function app.assistant_job_transition(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function app.assistant_job_transition(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_job_cancel — the owner's button
-- ---------------------------------------------------------------------------
create or replace function app.assistant_job_cancel(p_id uuid)
returns assistant_jobs
language plpgsql security definer set search_path = public as $assistant_job_cancel_0112$
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
     set status = 'cancelled', finished_at = now()
   where j.id = p_id
  returning j.* into v_job;

  return v_job;
end $assistant_job_cancel_0112$;

comment on function app.assistant_job_cancel(uuid) is
  '0112. Owner-only. Moves any non-terminal job to cancelled and returns the row; a finished job answers INVALID_TRANSITION. The edge function cancels the provider batch afterwards when batch_id is set.';

revoke all on function app.assistant_job_cancel(uuid) from public, anon;
grant execute on function app.assistant_job_cancel(uuid) to authenticated;
