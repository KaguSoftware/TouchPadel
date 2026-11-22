/**
 * 0450 cron_load: the hosted box ran fifteen pg_cron jobs at second :00 of
 * every fifth minute, and 0386's nightly prune could not keep up with the run
 * log. The jobs are spread over different minutes (the ones the clock already
 * covers run less often), and the prune runs eight times a night. Every body
 * is unchanged; only cron.job moves.
 */
import { describe, expect, it } from 'vitest';
import { docker, scenario, Q } from './psql-scenario';

const EXPECTED: Record<string, string> = {
  tp_housekeeping_prune: '15,45 0-3 * * *',
  tp_assistant_index_sweep: '1-59/5 * * * *',
  tp_assistant_job_tick: '2-59/5 * * * *',
  tp_scan_sweep: '3-59/5 * * * *',
  tp_hold_strikes: '4-59/5 * * * *',
  tp_hold_sweep: '1-59/2 * * * *',
  tp_reward_voucher_sweep: '1-59/2 * * * *',
  tp_tournament_sweep: '1-59/2 * * * *',
  tp_degraded_sweep: '*/2 * * * *',
  tp_lesson_sweep: '*/2 * * * *',
  tp_checklist_sweep: '1-59/5 * * * *',
  tp_monitor_cron: '2-59/5 * * * *',
  tp_price_promo_apply: '3-59/5 * * * *',
  tp_reward_sweep: '4-59/5 * * * *',
  tp_protocol_tick: '*/5 * * * *',
  tp_shop_reward_sweep: '*/5 * * * *',
};

/** The minutes a five-field schedule's minute part fires on (only the forms used here). */
function minutes(schedule: string): number[] {
  const m = schedule.split(' ')[0]!;
  const all = Array.from({ length: 60 }, (_, i) => i);
  if (m === '*') return all;
  const step = /^(\*|(\d+)-(\d+))\/(\d+)$/.exec(m);
  if (step) {
    const from = step[2] ? Number(step[2]) : 0;
    const to = step[3] ? Number(step[3]) : 59;
    return all.filter((i) => i >= from && i <= to && (i - from) % Number(step[4]) === 0);
  }
  return m.split(',').map(Number);
}

describe.skipIf(!docker)('0450 cron load', () => {
  it('reschedules the sweeps and the prune, commands unchanged', () => {
    const r = scenario([
      Q('jobs', `select jsonb_object_agg(jobname, jsonb_build_object('schedule', schedule, 'command', command, 'active', active))
                   from cron.job where jobname = any (array[${Object.keys(EXPECTED).map((n) => `'${n}'`).join(', ')}])`),
    ]);
    expect(r.jobs?.ok, JSON.stringify(r.jobs)).toBe(true);
    const jobs = r.jobs!.data as Record<string, { schedule: string; command: string; active: boolean }>;
    expect(Object.keys(jobs).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [name, schedule] of Object.entries(EXPECTED)) {
      expect(jobs[name]!.schedule, name).toBe(schedule);
      expect(jobs[name]!.active, name).toBe(true);
    }
    expect(jobs.tp_housekeeping_prune!.command).toBe('select app.prune_housekeeping();');
    expect(jobs.tp_hold_strikes!.command).toBe('select app.hold_strikes_settle(null);');
  });

  it('starts at most five of these jobs in any one minute', () => {
    const perMinute = Array.from({ length: 60 }, () => 0);
    for (const [name, schedule] of Object.entries(EXPECTED)) {
      if (name === 'tp_housekeeping_prune') continue; // night hours only
      for (const m of minutes(schedule)) perMinute[m]! += 1;
    }
    expect(Math.max(...perMinute)).toBeLessThanOrEqual(5);
  });

  it('keeps minute 0 for the lesson sweep, which purges on the hour', () => {
    expect(minutes(EXPECTED.tp_lesson_sweep!)).toContain(0);
  });
});
