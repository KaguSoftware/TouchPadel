/**
 * CONTRACTUAL concurrency suite — design-data.md §6.1, cases 1–7.
 * (Case 8 replay-idempotency-through-sync_replays and case 9 FEFO land with
 * Drops 2/3 — migrations 0011/0014/0017.)
 *
 * Runs against a live local stack (`pnpm db:start && pnpm db:reset`); skips
 * itself cleanly when the stack is unreachable.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  testIdemKey,
  outcome,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('booking concurrency (contractual acceptance suite)', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    await ensureTestRateRule(svc);
    desk = await signedInClient(SEED_STAFF.court_desk);
  });

  async function guests(n: number): Promise<SupabaseClient[]> {
    return Promise.all(Array.from({ length: n }, () => anonymousSessionClient()));
  }

  it('case 1: N=20 simultaneous hold_slot on one slot -> exactly 1 wins, 19 SLOT_TAKEN', async () => {
    const court = await createTestCourt(svc, 'C1');
    const slot = futureSlot();
    const clients = await guests(20);

    const results = await Promise.all(
      clients.map((c) =>
        appRpc(c, 'hold_slot', {
          p_court_id: court,
          p_start_at: slot.start.toISOString(),
          p_duration_min: 60,
          p_idempotency_key: testIdemKey('reservation.hold'),
        }).then(outcome),
      ),
    );

    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(19);
    for (const l of losses) expect(l.errorMessage).toContain('SLOT_TAKEN');

    // Exactly one live row occupies the slot.
    const { data } = await svc
      .from('reservations')
      .select('id')
      .eq('court_id', court)
      .in('status', ['pending', 'confirmed', 'arrived']);
    expect(data).toHaveLength(1);
  });

  it('case 2: hold vs direct desk booking race -> exactly one write survives', async () => {
    const court = await createTestCourt(svc, 'C2');
    const slot = futureSlot();
    const [guest] = await guests(1);

    const [holdRes, deskRes] = await Promise.all([
      appRpc(guest!, 'hold_slot', {
        p_court_id: court,
        p_start_at: slot.start.toISOString(),
        p_duration_min: 60,
      }).then(outcome),
      appRpc(desk, 'staff_create_reservation', {
        p_court_id: court,
        p_kind: 'booking',
        p_start_at: slot.start.toISOString(),
        p_end_at: slot.plus(60).toISOString(),
        p_guest_name: 'Walk-in Race',
      }).then(outcome),
    ]);

    const successes = [holdRes, deskRes].filter((r) => r.ok);
    const failures = [holdRes, deskRes].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.errorMessage).toContain('SLOT_TAKEN');
  });

  it('case 3: adjacent slots [18:00,19:00) + [19:00,20:00) both succeed (half-open ranges)', async () => {
    const court = await createTestCourt(svc, 'C3');
    const slot = futureSlot();
    const [a, b] = await guests(2);

    const [r1, r2] = await Promise.all([
      appRpc(a!, 'hold_slot', {
        p_court_id: court,
        p_start_at: slot.start.toISOString(),
        p_duration_min: 60,
      }).then(outcome),
      appRpc(b!, 'hold_slot', {
        p_court_id: court,
        p_start_at: slot.plus(60).toISOString(),
        p_duration_min: 60,
      }).then(outcome),
    ]);

    expect(r1.ok, r1.errorMessage).toBe(true);
    expect(r2.ok, r2.errorMessage).toBe(true);
  });

  it('case 4: expired-hold race — 10 concurrent hold_slot over a corpse -> exactly 1 wins', async () => {
    const court = await createTestCourt(svc, 'C4');
    const slot = futureSlot();

    // Plant an expired-but-not-swept hold directly (the pg_cron sweeper is off).
    const { error: plantErr } = await svc.from('reservations').insert({
      court_id: court,
      kind: 'hold',
      status: 'pending',
      start_at: slot.start.toISOString(),
      end_at: slot.plus(60).toISOString(),
      source: 'mobile',
      hold_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(plantErr).toBeNull();

    const clients = await guests(10);
    const results = await Promise.all(
      clients.map((c) =>
        appRpc(c, 'hold_slot', {
          p_court_id: court,
          p_start_at: slot.start.toISOString(),
          p_duration_min: 60,
        }).then(outcome),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(9);

    // The corpse was lazily expired by the winning transaction.
    const { data: corpse } = await svc
      .from('reservations')
      .select('status')
      .eq('court_id', court)
      .eq('kind', 'hold')
      .lt('hold_expires_at', new Date().toISOString());
    expect(corpse?.every((r) => (r as { status: string }).status === 'expired')).toBe(true);
  });

  it('case 5: confirm-vs-expire race -> confirms XOR fails HOLD_EXPIRED, never both/neither', async () => {
    const court = await createTestCourt(svc, 'C5');
    const slot = futureSlot();
    const [guest] = await guests(1);
    const {
      data: { user },
    } = await guest!.auth.getUser();

    // Hold on the knife's edge: expires ~150ms from now.
    const { data: hold, error } = await svc
      .from('reservations')
      .insert({
        court_id: court,
        kind: 'hold',
        status: 'pending',
        start_at: slot.start.toISOString(),
        end_at: slot.plus(60).toISOString(),
        source: 'mobile',
        guest_id: null, // anonymous session has no profile; confirm passes guest_name
        device_id: user?.id,
        hold_expires_at: new Date(Date.now() + 150).toISOString(),
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    const holdId = (hold as { id: string }).id;

    const [confirmRes, sweepRes] = await Promise.all([
      appRpc(desk, 'confirm_booking', { p_hold_id: holdId, p_guest_name: 'Race Guest' }).then(
        outcome,
      ),
      appRpc(desk, 'expire_stale_holds', {}).then(outcome),
    ]);
    expect(sweepRes.ok).toBe(true);

    const { data: final } = await svc
      .from('reservations')
      .select('kind,status')
      .eq('id', holdId)
      .single();
    const f = final as { kind: string; status: string };

    if (confirmRes.ok) {
      // Confirm won: it is a confirmed booking, and stays one.
      expect(f.kind).toBe('booking');
      expect(f.status).toBe('confirmed');
    } else {
      // Expiry won: confirm failed cleanly, booking was never created.
      expect(confirmRes.errorMessage).toContain('HOLD_EXPIRED');
      expect(f.kind).toBe('hold');
      expect(['pending', 'expired']).toContain(f.status);
    }
  });

  it('case 6: extend A into B concurrently with B creation -> exactly one succeeds', async () => {
    const court = await createTestCourt(svc, 'C6');
    const slot = futureSlot();

    const a = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: court,
      p_kind: 'booking',
      p_start_at: slot.start.toISOString(),
      p_end_at: slot.plus(60).toISOString(),
      p_guest_name: 'Booking A',
    }).then(outcome);
    expect(a.ok, a.errorMessage).toBe(true);
    const aId = (a.data as { reservation_id: string }).reservation_id;

    const [extendRes, bRes] = await Promise.all([
      appRpc(desk, 'extend_reservation', {
        p_reservation_id: aId,
        p_new_end_at: slot.plus(120).toISOString(),
      }).then(outcome),
      appRpc(desk, 'staff_create_reservation', {
        p_court_id: court,
        p_kind: 'booking',
        p_start_at: slot.plus(60).toISOString(),
        p_end_at: slot.plus(120).toISOString(),
        p_guest_name: 'Booking B',
      }).then(outcome),
    ]);

    const successes = [extendRes, bRes].filter((r) => r.ok);
    expect(successes).toHaveLength(1);
    expect([extendRes, bRes].find((r) => !r.ok)!.errorMessage).toContain('SLOT_TAKEN');
  });

  it('case 7: maintenance block vs guest booking race -> one write', async () => {
    const court = await createTestCourt(svc, 'C7');
    const slot = futureSlot();
    const [guest] = await guests(1);

    const [maintRes, holdRes] = await Promise.all([
      appRpc(desk, 'staff_create_reservation', {
        p_court_id: court,
        p_kind: 'maintenance',
        p_start_at: slot.start.toISOString(),
        p_end_at: slot.plus(120).toISOString(),
        p_notes: 'glass panel replacement',
      }).then(outcome),
      appRpc(guest!, 'hold_slot', {
        p_court_id: court,
        p_start_at: slot.plus(60).toISOString(),
        p_duration_min: 60,
      }).then(outcome),
    ]);

    const successes = [maintRes, holdRes].filter((r) => r.ok);
    const failures = [maintRes, holdRes].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.errorMessage).toContain('SLOT_TAKEN');
  });

  it('idempotency: same key replayed -> one row, second call returns duplicate', async () => {
    // Companion to case 1 (full replay machinery is case 8, Drop 3): the
    // key-shaped contract already holds at the reservations layer.
    const court = await createTestCourt(svc, 'C8');
    const slot = futureSlot();
    const [guest] = await guests(1);
    const key = testIdemKey('reservation.hold');

    const args = {
      p_court_id: court,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
      p_idempotency_key: key,
    };
    const first = await appRpc(guest!, 'hold_slot', args).then(outcome);
    const second = await appRpc(guest!, 'hold_slot', args).then(outcome);

    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);

    const { data } = await svc.from('reservations').select('id').eq('idempotency_key', key);
    expect(data).toHaveLength(1);
  });
});
