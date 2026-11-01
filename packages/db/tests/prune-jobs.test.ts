/**
 * 0386 prune_jobs (F-54): cron.job_run_details, app.rpc_replays and
 * sync_replays are pruned daily (7, 90 and 90 days) by
 * app.prune_housekeeping (cron tp_housekeeping_prune). sync_replays stays
 * append-only for everything but the prune.
 */
import { describe, it, expect } from 'vitest';
import { docker, scenario, Q, FX } from './psql-scenario';

describe.skipIf(!docker)('0386 prune jobs', () => {
  it('prunes old rows, keeps recent ones, and is scheduled', () => {
    const r = scenario([
      FX(`insert into app.rpc_replays (idempotency_key, fn, caller, result, at) values
            ('ldb-old', 'x', gen_random_uuid(), '{}', now() - interval '120 days'),
            ('ldb-new', 'x', gen_random_uuid(), '{}', now() - interval '10 days')`),
      FX(`insert into sync_replays (device_id, idempotency_key, entity, replayed_at, result) values
            ('LDB', 'ldb-sync-old', 'tab', now() - interval '120 days', 'applied'),
            ('LDB', 'ldb-sync-new', 'tab', now() - interval '10 days', 'applied')`),
      FX(`insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
            values (0, -424242, 0, 'postgres', 'postgres', 'select 1', 'succeeded', 'ldb', now() - interval '30 days', now() - interval '30 days'),
                   (0, -424243, 0, 'postgres', 'postgres', 'select 1', 'succeeded', 'ldb', now() - interval '1 day', now() - interval '1 day')`),
      Q('prune', `select app.prune_housekeeping()`),
      Q('rpc', `select jsonb_agg(idempotency_key order by idempotency_key) from app.rpc_replays where idempotency_key like 'ldb-%'`),
      Q('sync', `select jsonb_agg(idempotency_key order by idempotency_key) from sync_replays where idempotency_key like 'ldb-sync-%'`),
      Q('cron', `select jsonb_agg(runid order by runid) from cron.job_run_details where runid in (-424242, -424243)`),
      Q('scheduled', `select to_jsonb(schedule) from cron.job where jobname = 'tp_housekeeping_prune'`),
      Q('appendOnly', `delete from sync_replays where idempotency_key = 'ldb-sync-new' returning to_jsonb(id)`),
      Q('tooShort', `select app.prune_housekeeping(7, 1)`),
    ]);
    expect(r.prune?.ok, JSON.stringify(r.prune)).toBe(true);
    expect((r.prune?.data as Record<string, number>).rpc_replays).toBeGreaterThanOrEqual(1);
    expect(r.rpc?.data).toEqual(['ldb-new']);
    expect(r.sync?.data).toEqual(['ldb-sync-new']);
    expect(r.cron?.data).toEqual([-424243]);
    expect(r.scheduled?.data).toBe('45 4 * * *');
    expect(r.appendOnly).toMatchObject({ ok: false, code: 'sync_replays is append-only' });
    expect(r.tooShort).toMatchObject({ ok: true, data: { error: 'P0001' } });
  });
});
