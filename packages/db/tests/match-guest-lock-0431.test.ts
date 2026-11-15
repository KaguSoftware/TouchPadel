/**
 * 0431 match_guest_lock — one guest's open-match seats across branches.
 *
 * While matches are paid at the desk (0370), app.ticket_pick locks no ticket
 * rows, so two joins by one guest at two branches at once both passed the
 * cross-branch time-clash check (R41). ticket_pick now takes a per-guest
 * advisory lock in that mode: a second session cannot take the same guest's
 * key until the first commits. Two real sessions: one holds ticket_pick open
 * in a transaction, the other tries the key. Nothing is written.
 */
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { docker, psql } from './psql-scenario';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function holdOpen(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt']);
    let err = '';
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))));
    p.stdin.end(sql);
  });
}

describe.skipIf(!docker)('0431 one guest, one seat lock across branches', () => {
  it('ticket_pick at the desk holds the guest until commit', async () => {
    expect(psql('select app.match_pay_at_desk();')).toBe('t');
    const guest = psql('select gen_random_uuid();');
    const key = `hashtextextended('app.matches:guest:' || '${guest}', 0)`;

    const first = holdOpen(`begin; select app.ticket_pick('${guest}'::uuid, 2, false); select pg_sleep(3); rollback;`);
    await new Promise((r) => setTimeout(r, 1500));
    expect(psql(`select pg_try_advisory_xact_lock(${key});`)).toBe('f');
    await first;
    expect(psql(`select pg_try_advisory_xact_lock(${key});`)).toBe('t');
  }, 15_000);
});
