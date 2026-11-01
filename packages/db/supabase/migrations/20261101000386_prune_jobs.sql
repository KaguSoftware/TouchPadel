-- 0386 prune_jobs — the three tables that only ever grew are pruned (launch
-- finding F-54, Majed 2026-11-01: "Prune them").
--
--   cron.job_run_details   pg_cron's run log: about 30,000 rows a day from the
--                          10 s, 30 s and 1 min jobs, never purged. Kept 7 days
--                          (0393's cron watcher reads only runs since its last
--                          look, every 5 minutes).
--   app.rpc_replays        app.claim_replay's idempotency keys (0049), one per
--                          queued money write. Kept 90 days: a station's queue
--                          replays within hours, and the key must outlive any
--                          replay of it (a key pruned and replayed again would
--                          apply twice).
--   public.sync_replays    the replay edge function's record (0021), the same
--                          rule: kept 90 days. It is append-only by trigger
--                          (sync_replays_ao, app.forbid_mutation); the trigger
--                          now lets a delete through only inside
--                          app.prune_replays, which raises the transaction-local
--                          app.replay_prune flag first. Clients still cannot
--                          update or delete (no grant), and every other delete
--                          or update still raises "sync_replays is append-only".
--
-- app.prune_housekeeping() does all three in batches of 50,000 (a first run on
-- a project that never pruned stays short; the next night takes the rest) and
-- returns the counts; cron tp_housekeeping_prune runs it daily at 04:45 UTC,
-- scheduled through app.ensure_cron (0385), so a missing pg_cron fails this
-- migration instead of passing with a NOTICE. A failure inside is reported to
-- the Monitoring page (app.monitor, 0393, when it exists) as a cron_failed
-- event; it is not re-raised, since a raise would roll the event back too.
--
-- covered by packages/db/tests/prune-jobs.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. sync_replays: append-only, except for the prune.
-- ---------------------------------------------------------------------------
create or replace function app.trg_sync_replays_append_only() returns trigger
language plpgsql set search_path = public as $trg_sync_replays_append_only_0386$
begin
  if tg_op = 'DELETE' and current_setting('app.replay_prune', true) = 'on' then
    return null;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $trg_sync_replays_append_only_0386$;

revoke all on function app.trg_sync_replays_append_only() from public, anon, authenticated;

drop trigger if exists sync_replays_ao on public.sync_replays;
create trigger sync_replays_ao
  before update or delete on public.sync_replays
  for each statement execute function app.trg_sync_replays_append_only();

-- ---------------------------------------------------------------------------
-- 2. The prune.
-- ---------------------------------------------------------------------------
create or replace function app.prune_housekeeping(
  p_cron_days   int default 7,
  p_replay_days int default 90,
  p_batch       int default 50000
) returns jsonb
language plpgsql security definer set search_path = public as $prune_housekeeping_0386$
declare
  v_cron   bigint := 0;
  v_rpc    bigint := 0;
  v_sync   bigint := 0;
  v_cutoff timestamptz;
begin
  if p_cron_days < 1 or p_replay_days < 30 or p_batch < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      hint = 'cron days >= 1, replay days >= 30, batch >= 1';
  end if;

  if to_regclass('cron.job_run_details') is not null then
    v_cutoff := now() - make_interval(days => p_cron_days);
    execute 'delete from cron.job_run_details
              where runid in (select runid from cron.job_run_details
                               where coalesce(end_time, start_time) < $1
                               order by runid
                               limit $2)'
      using v_cutoff, p_batch;
    get diagnostics v_cron = row_count;
  end if;

  v_cutoff := now() - make_interval(days => p_replay_days);
  delete from app.rpc_replays
   where idempotency_key in (select r.idempotency_key from app.rpc_replays r
                              where r.at < v_cutoff
                              order by r.at
                              limit p_batch);
  get diagnostics v_rpc = row_count;

  perform set_config('app.replay_prune', 'on', true);
  delete from sync_replays
   where id in (select s.id from sync_replays s
                 where s.replayed_at < v_cutoff
                 order by s.id
                 limit p_batch);
  get diagnostics v_sync = row_count;
  perform set_config('app.replay_prune', 'off', true);

  return jsonb_build_object('cron_job_run_details', v_cron, 'rpc_replays', v_rpc, 'sync_replays', v_sync);
exception when others then
  if to_regprocedure('app.monitor(text,text,text,text,jsonb)') is not null then
    execute 'select app.monitor($1, $2, $3, $4, $5)'
      using 'cron', 'error', 'cron_failed', 'prune_housekeeping: ' || sqlerrm,
            jsonb_build_object('sqlstate', sqlstate, 'job', 'tp_housekeeping_prune');
  end if;
  -- Not re-raised: a raise would roll the event back with everything else.
  return jsonb_build_object('error', sqlstate);
end $prune_housekeeping_0386$;

comment on function app.prune_housekeeping(int, int, int) is
  '0386 (F-54). Service role (cron tp_housekeeping_prune, daily 04:45 UTC): deletes, at most p_batch rows each, cron.job_run_details older than p_cron_days (7), app.rpc_replays and sync_replays older than p_replay_days (90, never under 30). Returns {cron_job_run_details, rpc_replays, sync_replays}. A failure is reported to the Monitoring page (app.monitor, cron_failed) and answered {error: sqlstate}, not raised, so the event is kept.';

revoke all on function app.prune_housekeeping(int, int, int) from public, anon, authenticated;
grant execute on function app.prune_housekeeping(int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The schedule: raises if it cannot be made (0385).
-- ---------------------------------------------------------------------------
do $housekeeping_cron_0386$
begin
  perform app.ensure_cron('tp_housekeeping_prune', '45 4 * * *', 'select app.prune_housekeeping();');
end $housekeeping_cron_0386$;
