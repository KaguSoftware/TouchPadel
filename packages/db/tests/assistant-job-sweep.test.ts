/**
 * 0423 — the stuck-job sweeper's SQL (2026-11-12).
 *
 *   * app.assistant_job_stuck_reason: each stuck case at its boundary (an
 *     accepted, live or submitting job at 11 minutes is stuck, at 9 is not; a
 *     running batch at 27 hours, at 25 not; three lease lapses, two not; a
 *     reducing job at 11 minutes), and never an estimated, paused or finished
 *     job, whatever its age;
 *   * app.assistant_job_claim_stuck: claims exactly the stuck jobs whose lease
 *     is free, stamps the lease (a second claim gets none of them, and this
 *     minute's claim_tick skips a swept batch job), refuses arguments out of
 *     range, respects p_limit;
 *   * app.assistant_job_claim_tick counts a lapsed lease it takes over, not a
 *     released one; app.assistant_job_transition stamps status_at and resets
 *     tick_lapses on a move to running; app.assistant_job_cancel stamps it;
 *   * app.assistant_job_expire: an estimate or a paused job 8 days old becomes
 *     cancelled with EXPIRED, one 6 days old stays; app.assistant_job_tick_nudge
 *     runs it and never raises.
 *
 * ONE psql transaction, rolled back: the jobs are planted with backdated
 * status_at, which no client can write. Needs 0423 applied to the local stack;
 * without docker it skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { CONTAINER, dockerReachable, EXEC_TIMEOUT_MS } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

const SETUP = `
create temp table k(name text primary key, id uuid);
create or replace function pg_temp.mk(p_name text, p_status text, p_mode text, p_batch text, p_age interval, p_lapses int default 0) returns void
language plpgsql as $mk$
declare v uuid;
begin
  insert into assistant_jobs (conversation_id, status, plan, estimate, mode, batch_id, status_at, tick_lapses)
  values ((select id from assistant_conversations where title = 'sweep 0423 probe' limit 1), p_status,
          '{"question":"q","calls":[]}', '{"rows":1,"chunks":1}', p_mode, p_batch, now() - p_age, p_lapses)
  returning id into v;
  insert into k values (p_name, v);
end $mk$;
create or replace function pg_temp.out(p_label text, p_value jsonb) returns void language plpgsql as $o$
begin raise notice '%', p_label || E'\\t' || coalesce(p_value::text, 'null'); end $o$;
insert into assistant_conversations (owner_id, title)
  select id, 'sweep 0423 probe' from staff where role = 'owner' and is_active order by created_at limit 1;
select pg_temp.mk('accepted_11', 'accepted', 'live', null, '11 minutes');
select pg_temp.mk('accepted_9', 'accepted', 'live', null, '9 minutes');
select pg_temp.mk('live_11', 'running', 'live', null, '11 minutes');
select pg_temp.mk('live_9', 'running', 'live', null, '9 minutes');
select pg_temp.mk('submit_11', 'running', 'batch', null, '11 minutes');
select pg_temp.mk('submit_9', 'running', 'batch', null, '9 minutes');
select pg_temp.mk('batch_27h', 'running', 'batch', 'msgbatch_0423_a', '27 hours');
select pg_temp.mk('batch_25h', 'running', 'batch', 'msgbatch_0423_b', '25 hours');
select pg_temp.mk('lapses_3', 'running', 'batch', 'msgbatch_0423_c', '1 minute', 3);
select pg_temp.mk('lapses_2', 'running', 'batch', 'msgbatch_0423_d', '1 minute', 2);
select pg_temp.mk('reducing_11', 'reducing', 'live', null, '11 minutes');
select pg_temp.mk('reducing_9', 'reducing', 'batch', 'msgbatch_0423_e', '9 minutes');
select pg_temp.mk('estimated_8d', 'estimated', null, null, '8 days');
select pg_temp.mk('estimated_6d', 'estimated', null, null, '6 days');
select pg_temp.mk('paused_8d', 'over_estimate', 'live', null, '8 days');
select pg_temp.mk('paused_6d', 'over_estimate', 'live', null, '6 days');
select pg_temp.mk('done_old', 'done', 'live', null, '40 days');
select pg_temp.mk('failed_old', 'failed', 'batch', 'msgbatch_0423_f', '40 days');
select pg_temp.mk('held_live', 'running', 'live', null, '30 minutes');
update assistant_jobs set tick_claimed_until = now() + interval '5 minutes' where id = (select id from k where name = 'held_live');
-- The shared stack may hold other jobs: lease them for this transaction, so
-- only the planted ones can be claimed or expired (rolled back with everything else).
update assistant_jobs set tick_claimed_until = now() + interval '1 hour', status_at = now() where id not in (select id from k);
`;

const CHECKS = `
select pg_temp.out('reasons', (select jsonb_object_agg(k.name, app.assistant_job_stuck_reason(j)) from k join assistant_jobs j using (id)));
select pg_temp.out('due_before', to_jsonb(app.assistant_job_stuck_due()));
select pg_temp.out('limit_1', (select to_jsonb(count(*)) from app.assistant_job_claim_stuck(60, 1) c join k on k.id = c.job_id));
select pg_temp.out('claim', (select jsonb_object_agg(k.name, jsonb_build_object('reason', c.reason, 'leased', c.claimed_until > now() + interval '100 seconds'))
                               from app.assistant_job_claim_stuck(120, 100) c join k on k.id = c.job_id));
select pg_temp.out('claim_again', (select to_jsonb(count(*)) from app.assistant_job_claim_stuck(120, 100) c join k on k.id = c.job_id));
select pg_temp.out('due_after', to_jsonb(app.assistant_job_stuck_due()));
do $a$ begin perform app.assistant_job_claim_stuck(0, 1); exception when others then perform pg_temp.out('bad_seconds', to_jsonb(sqlerrm)); end $a$;
do $a$ begin perform app.assistant_job_claim_stuck(60, 0); exception when others then perform pg_temp.out('bad_limit', to_jsonb(sqlerrm)); end $a$;
select pg_temp.out('tick_claim', (select jsonb_agg(k.name order by k.name) from app.assistant_job_claim_tick(120) c join k on k.id = c.job_id));
update assistant_jobs set tick_claimed_until = now() - interval '1 second' where id = (select id from k where name = 'lapses_2');
select pg_temp.out('tick_claim_lapsed', (select jsonb_agg(k.name order by k.name) from app.assistant_job_claim_tick(120) c join k on k.id = c.job_id));
select pg_temp.out('lapses_2_now', (select jsonb_build_object('lapses', tick_lapses, 'reason', app.assistant_job_stuck_reason(j)) from assistant_jobs j where id = (select id from k where name = 'lapses_2')));
update assistant_jobs set tick_claimed_until = null where id = (select id from k where name = 'batch_25h');
select app.assistant_job_claim_tick(120);
select pg_temp.out('batch_25h_lapses', (select to_jsonb(tick_lapses) from assistant_jobs where id = (select id from k where name = 'batch_25h')));
select app.assistant_job_transition((select id from k where name = 'lapses_2'), 'over_estimate', null);
select pg_temp.out('move_paused', (select jsonb_build_object('status', status, 'lapses', tick_lapses) from assistant_jobs where id = (select id from k where name = 'lapses_2')));
select pg_temp.out('move_running', (select jsonb_build_object('status', j.status, 'fresh', j.status_at > now() - interval '5 seconds', 'lapses', j.tick_lapses)
  from app.assistant_job_transition((select id from k where name = 'lapses_2'), 'running', '{"mode":"batch"}') j));
select pg_temp.out('expired', to_jsonb(app.assistant_job_expire()));
select pg_temp.out('after_expire', (select jsonb_object_agg(k.name, jsonb_build_object('status', j.status, 'error', j.error, 'finished', j.finished_at is not null))
  from k join assistant_jobs j using (id) where k.name like 'estimated_%' or k.name like 'paused_%'));
select pg_temp.out('expire_again', to_jsonb(app.assistant_job_expire()));
select id as a9 from k where name = 'accepted_9' \\gset
select set_config('request.jwt.claims', json_build_object('sub', (select owner_id from assistant_conversations where title = 'sweep 0423 probe' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.out('cancel', (select jsonb_build_object('status', j.status, 'fresh', j.status_at > now() - interval '5 seconds') from app.assistant_job_cancel(:'a9') j));
reset role;
select app.assistant_job_tick_nudge();
select pg_temp.out('nudge', to_jsonb(true));
`;

/** Runs the script and reads the NOTICE lines psql prints on stderr. */
function results(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let text = '';
  try {
    text = psqlWithNotices(`begin;\n${SETUP}\n${CHECKS}\nrollback;\n`);
  } catch (e) {
    throw new Error(`0423 sweep script failed: ${(e as Error).message}`);
  }
  for (const line of text.split('\n')) {
    const m = /NOTICE:\s+([a-z_0-9]+)\t(.*)$/.exec(line);
    if (m) out[m[1]!] = JSON.parse(m[2]!);
  }
  return out;
}

function psqlWithNotices(sql: string): string {
  // stderr carries the NOTICE lines; merge it into what we read.
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'sh', '-c', 'psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt 2>&1'], {
    input: sql,
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

describe.skipIf(!docker)('0423 the stuck-job sweeper (one rolled-back transaction)', () => {
  const r = docker ? results() : {};

  it('names each stuck case at its boundary, and never an estimated, paused or finished job', () => {
    expect(r.reasons).toEqual({
      accepted_11: 'stalled_start',
      accepted_9: null,
      live_11: 'stalled_live',
      live_9: null,
      submit_11: 'stalled_submit',
      submit_9: null,
      batch_27h: 'batch_overdue',
      batch_25h: null,
      lapses_3: 'lease_lapsing',
      lapses_2: null,
      reducing_11: 'stalled_reduce',
      reducing_9: null,
      estimated_8d: null,
      estimated_6d: null,
      paused_8d: null,
      paused_6d: null,
      done_old: null,
      failed_old: null,
      held_live: 'stalled_live', // stuck, but its lease is held: not claimed
    });
    expect(r.due_before).toBe(true);
  });

  it('claims the stuck jobs whose lease is free, leases them, and a second claim gets none; p_limit holds', () => {
    expect(r.limit_1).toBe(1);
    // the limit_1 claim took the oldest stuck job (batch_27h), so this claim holds the other five
    expect(r.claim).toEqual({
      accepted_11: { reason: 'stalled_start', leased: true },
      live_11: { reason: 'stalled_live', leased: true },
      submit_11: { reason: 'stalled_submit', leased: true },
      lapses_3: { reason: 'lease_lapsing', leased: true },
      reducing_11: { reason: 'stalled_reduce', leased: true },
    });
    expect(r.claim_again).toBe(0);
    expect(r.due_after).toBe(false);
    expect(r.bad_seconds).toBe('INVALID_ARGUMENT');
    expect(r.bad_limit).toBe('INVALID_ARGUMENT');
  });

  it("the batch claim skips a swept job (its lease is taken) and counts only a lapsed lease it takes over", () => {
    expect(r.tick_claim).toEqual(['batch_25h', 'lapses_2']);
    expect(r.tick_claim_lapsed).toEqual(['lapses_2']);
    expect(r.lapses_2_now).toEqual({ lapses: 3, reason: 'lease_lapsing' });
    expect(r.batch_25h_lapses).toBe(0); // released before it was claimed again
  });

  it('every move stamps status_at; a move to running resets the lapses; the cancel stamps it too', () => {
    expect(r.move_paused).toEqual({ status: 'over_estimate', lapses: 3 }); // kept on a move elsewhere
    expect(r.move_running).toEqual({ status: 'running', fresh: true, lapses: 0 });
    expect(r.cancel).toEqual({ status: 'cancelled', fresh: true });
  });

  it('expires an estimate and a paused job after 7 days, quietly, once; the nudge never raises', () => {
    expect(r.expired).toBe(2);
    expect(r.after_expire).toEqual({
      estimated_8d: { status: 'cancelled', error: 'EXPIRED: nobody chose how to run it within 7 days', finished: true },
      estimated_6d: { status: 'estimated', error: null, finished: false },
      paused_8d: { status: 'cancelled', error: 'EXPIRED: it waited paused for 7 days', finished: true },
      paused_6d: { status: 'over_estimate', error: null, finished: false },
    });
    expect(r.expire_again).toBe(0);
    expect(r.nudge).toBe(true);
  });
});
