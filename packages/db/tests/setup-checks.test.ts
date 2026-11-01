/**
 * 0385 setup_checks (F-55): a setup step never fails quietly.
 *
 *   * everything the migrations set up (buckets, storage and realtime
 *     policies, cron jobs, the 0384 pre-request hook) is registered and here;
 *   * a missing piece is listed by app.setup_missing and reported by
 *     app.setup_check (to the Monitoring page through app.monitor when 0393
 *     has landed);
 *   * app.ensure_cron schedules and registers a job, and raises SETUP_FAILED
 *     with what and why instead of a NOTICE.
 */
import { describe, it, expect } from 'vitest';
import { docker, scenario, Q, FX } from './psql-scenario';

describe.skipIf(!docker)('0385 setup checks', () => {
  it('nothing expected is missing now, and the registry covers every cron job', () => {
    const r = scenario([
      Q('missing', `select coalesce(jsonb_agg(m.kind || ':' || m.name), '[]') from app.setup_missing() m`),
      Q('unregistered', `select coalesce(jsonb_agg(j.jobname order by j.jobname), '[]') from cron.job j
                          where not exists (select 1 from app.setup_expected e where e.kind = 'cron_job' and e.name = j.jobname)`),
      Q('kinds', `select jsonb_object_agg(kind, n) from (select kind, count(*) n from app.setup_expected group by kind) x`),
      Q('check', `select to_jsonb(app.setup_check())`),
    ]);
    expect(r.missing?.data).toEqual([]);
    expect(r.unregistered?.data).toEqual([]);
    const kinds = r.kinds?.data as Record<string, number>;
    expect(kinds.bucket).toBeGreaterThanOrEqual(4);
    expect(kinds.cron_job).toBeGreaterThanOrEqual(28);
    expect(kinds.pgrst_hook).toBe(1);
    expect(r.check?.data).toBe(0);
  });

  it('a missing piece is listed and reported', () => {
    const r = scenario([
      FX(`insert into app.setup_expected (kind, name) values ('bucket', 'ldb-missing-bucket'), ('cron_job', 'tp_ldb_missing')`),
      Q('missing', `select jsonb_agg(m.kind || ':' || m.name order by m.kind) from app.setup_missing() m`),
      Q('check', `select to_jsonb(app.setup_check())`),
      Q('event', `select case when to_regclass('app.monitoring_events') is null then to_jsonb('no monitoring yet'::text)
                     else (select to_jsonb(count(*) > 0) from app.monitoring_events
                            where kind = 'setup_failed' and message like '%ldb-missing-bucket%') end`),
    ]);
    expect(r.missing?.data).toEqual(['bucket:ldb-missing-bucket', 'cron_job:tp_ldb_missing']);
    expect(r.check?.data).toBe(2);
    expect([true, 'no monitoring yet']).toContain(r.event?.data);
  });

  it('ensure_cron schedules and registers a job, and raises SETUP_FAILED when it cannot', () => {
    const r = scenario([
      Q('ok', `select to_jsonb(true) from (select app.ensure_cron('tp_ldb_probe', '13 3 * * *', 'select 1')) x`),
      Q('job', `select to_jsonb(exists (select 1 from cron.job where jobname = 'tp_ldb_probe' and schedule = '13 3 * * *'))`),
      Q('registered', `select to_jsonb(exists (select 1 from app.setup_expected where kind = 'cron_job' and name = 'tp_ldb_probe'))`),
      Q('bad', `select to_jsonb(true) from (select app.ensure_cron('tp_ldb_bad', 'not a schedule', 'select 1')) x`),
    ]);
    expect(r.ok).toMatchObject({ ok: true, data: true });
    expect(r.job?.data).toBe(true);
    expect(r.registered?.data).toBe(true);
    expect(r.bad).toMatchObject({ ok: false, code: 'SETUP_FAILED' });
    expect(r.bad?.detail).toMatch(/tp_ldb_bad/);
  });
});
