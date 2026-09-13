/**
 * 0090 — a claimed notification is not handed out again while its sender works.
 *
 * REPRO. app.claim_due_notifications (0024) only bumped `attempts`: the row
 * stayed `sent_at is null` until send-push stamped it after Expo answered. A
 * second send-push invocation started inside that window claimed the same row,
 * and the guest got the notification twice. At one call a minute that was rare;
 * 0090 nudges the sender from every booking and runs the sweep every 30 s, so
 * overlapping invocations became routine and the lease became load-bearing.
 *
 * Every row here is scheduled in the year 2000 and claimed with p_limit 1, so
 * the claim reaches it before anything else due in the shared database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, guestClient, appRpc } from './helpers';

const up = await stackAvailable();

interface ClaimedRow {
  id: number;
  attempts: number;
  claimed_at: string | null;
}

// Well past the 60 s lease, so clock drift between the test host and the
// database container cannot decide the outcome.
const LONG_AGO = () => new Date(Date.now() - 5 * 60_000).toISOString();

describe.skipIf(!up)('0090 push claim lease', () => {
  let svc: SupabaseClient;
  let guestId: string;
  const madeRows: number[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    const guest = await guestClient(svc, 'lease');
    const { data: me } = await guest.auth.getUser();
    guestId = me.user!.id;
    await guest.auth.signOut();
  });

  afterAll(async () => {
    if (madeRows.length > 0) {
      await svc.from('notification_outbox').delete().in('id', madeRows);
    }
  });

  async function queueRow(): Promise<number> {
    const { data, error } = await svc
      .from('notification_outbox')
      .insert({
        profile_id: guestId,
        kind: 'test',
        payload: { source: 'lease-test' },
        scheduled_for: '2000-01-01T00:00:00Z',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    madeRows.push(data!.id);
    return data!.id;
  }

  async function claimOne(): Promise<ClaimedRow[]> {
    const { data, error } = await appRpc(svc, 'claim_due_notifications', { p_limit: 1 });
    expect(error).toBeNull();
    return (data ?? []) as ClaimedRow[];
  }

  it('stamps claimed_at and hands the row to one claim only', async () => {
    const id = await queueRow();

    const first = await claimOne();
    expect(first.map((r) => r.id)).toEqual([id]);
    expect(first[0]!.attempts).toBe(1);
    expect(first[0]!.claimed_at).not.toBeNull();

    // The overlapping invocation: same row still unsent, but leased.
    const second = await claimOne();
    expect(second.map((r) => r.id)).not.toContain(id);

    const { data: row } = await svc.from('notification_outbox').select('attempts').eq('id', id).single();
    expect(row!.attempts).toBe(1);
  });

  it('releases the row once the lease has run out (the sender crashed)', async () => {
    const id = await queueRow();
    expect((await claimOne()).map((r) => r.id)).toEqual([id]);

    await svc.from('notification_outbox').update({ claimed_at: LONG_AGO() }).eq('id', id);

    const retry = await claimOne();
    expect(retry.map((r) => r.id)).toEqual([id]);
    expect(retry[0]!.attempts).toBe(2);
  });

  it('never re-claims a row that was sent, however old its lease', async () => {
    const id = await queueRow();
    expect((await claimOne()).map((r) => r.id)).toEqual([id]);

    await svc
      .from('notification_outbox')
      .update({ sent_at: new Date().toISOString(), claimed_at: LONG_AGO() })
      .eq('id', id);

    expect((await claimOne()).map((r) => r.id)).not.toContain(id);
  });
});
