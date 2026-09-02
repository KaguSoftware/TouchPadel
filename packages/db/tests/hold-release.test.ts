/**
 * 0058 — app.release_hold, and the device bug that asked for it.
 *
 * REPRO (mobile, 2026-09-01). Tap three different times on Availability and
 * back out of Review each time: three live holds. The 0048/C1 cap
 * (venue_settings.max_live_holds_per_guest) then refuses the fourth tap with
 * HOLD_QUOTA_EXCEEDED, and app.cancel_reservation cannot help — its
 * cancellation_window_hours guard raises CANCELLATION_WINDOW on a hold for
 * tonight. The guest was locked out of booking for the rest of hold_ttl_seconds
 * and three slots stayed dark for everyone else.
 *
 * The last case here is that exact sequence, end to end.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  outcome,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0058 release_hold', () => {
  let svc: SupabaseClient;
  let courtId: string;

  const hold = async (guest: SupabaseClient) => {
    const slot = futureSlot();
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return (res.data as { reservation_id: string }).reservation_id;
  };

  const statusOf = async (id: string) => {
    const { data } = await svc.from('reservations').select('kind, status').eq('id', id).single();
    return data as { kind: string; status: string };
  };

  beforeAll(async () => {
    svc = serviceClient();
    await signedInClient(SEED_STAFF.owner); // seeds the staff session the fixtures expect
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'R0058');
  });

  it('a guest releases an own hold: expired, audited, slot free again', async () => {
    const guest = await guestClient(svc, 'r58-own');
    const id = await hold(guest);

    const res = await appRpc(guest, 'release_hold', { p_reservation_id: id }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.data).toMatchObject({ reservation_id: id, status: 'expired', released: true });

    // 'expired', not 'cancelled': an abandoned hold is not a cancelled BOOKING
    // and must not read as one in desk history or analytics.
    expect(await statusOf(id)).toMatchObject({ kind: 'hold', status: 'expired' });

    // The audit action is what separates a deliberate hand-back from the sweep.
    const { data } = await svc
      .from('audit_log')
      .select('action')
      .eq('entity', 'reservations')
      .eq('entity_id', id)
      .eq('action', 'reservation.release');
    expect(data ?? []).toHaveLength(1);
  });

  it('is idempotent — a second release answers instead of raising', async () => {
    const guest = await guestClient(svc, 'r58-twice');
    const id = await hold(guest);

    await appRpc(guest, 'release_hold', { p_reservation_id: id });
    const again = await appRpc(guest, 'release_hold', { p_reservation_id: id }).then(outcome);

    // The client releases on unmount, which races the countdown and the cron
    // sweep; a second attempt must not surface as an error to the guest.
    expect(again.ok, again.errorMessage).toBe(true);
    expect(again.data).toMatchObject({ status: 'expired', released: false });
  });

  it('refuses another account (FORBIDDEN) and leaves the hold standing', async () => {
    const owner = await guestClient(svc, 'r58-owner');
    const stranger = await guestClient(svc, 'r58-stranger');
    const id = await hold(owner);

    const res = await appRpc(stranger, 'release_hold', { p_reservation_id: id }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('FORBIDDEN');
    expect(await statusOf(id)).toMatchObject({ status: 'pending' });
  });

  it('refuses an anonymous session (ACCOUNT_REQUIRED)', async () => {
    const anon = await anonymousSessionClient();
    const res = await appRpc(anon, 'release_hold', {
      p_reservation_id: '00000000-0000-0000-0000-000000000000',
    }).then(outcome);
    expect(res.ok).toBe(false);
    // Refused on identity, BEFORE the argument is looked at — the shape
    // scripts/check-rpc-authz.mjs asserts across every client-callable RPC.
    expect(res.errorMessage).toContain('ACCOUNT_REQUIRED');
  });

  it('is not a way around the cancellation window (NOT_A_HOLD)', async () => {
    const guest = await guestClient(svc, 'r58-confirmed');
    const id = await hold(guest);
    const confirmed = await appRpc(guest, 'confirm_booking', { p_hold_id: id }).then(outcome);
    expect(confirmed.ok, confirmed.errorMessage).toBe(true);

    const res = await appRpc(guest, 'release_hold', { p_reservation_id: id }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('NOT_A_HOLD');
    expect(await statusOf(id)).toMatchObject({ kind: 'booking', status: 'confirmed' });
  });

  it('THE REPRO: releasing a hold frees a slot of the per-account quota', async () => {
    const { data: vs } = await svc
      .from('venue_settings')
      .select('max_live_holds_per_guest')
      .single();
    const cap = (vs as { max_live_holds_per_guest: number }).max_live_holds_per_guest;
    expect(cap).toBeGreaterThan(0);

    const guest = await guestClient(svc, 'r58-quota');
    const ids: string[] = [];
    for (let i = 0; i < cap; i++) ids.push(await hold(guest));

    // Where the phone was stuck: nothing more could be booked at all.
    const blocked = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: futureSlot().start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(blocked.ok).toBe(false);
    expect(blocked.errorMessage).toContain('HOLD_QUOTA_EXCEEDED');

    // Backing out of Review now does this, so the guest is never stuck.
    const released = await appRpc(guest, 'release_hold', {
      p_reservation_id: ids[0],
    }).then(outcome);
    expect(released.ok, released.errorMessage).toBe(true);

    await expect(hold(guest)).resolves.toBeTruthy();
  });

  it('the released slot is bookable by somebody else immediately', async () => {
    const first = await guestClient(svc, 'r58-first');
    const second = await guestClient(svc, 'r58-second');
    const slot = futureSlot();
    const args = {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    };

    const mine = await appRpc(first, 'hold_slot', args).then(outcome);
    expect(mine.ok, mine.errorMessage).toBe(true);

    // Held: the exclusion constraint keeps everyone else out.
    const taken = await appRpc(second, 'hold_slot', args).then(outcome);
    expect(taken.ok).toBe(false);
    expect(taken.errorMessage).toContain('SLOT_TAKEN');

    await appRpc(first, 'release_hold', {
      p_reservation_id: (mine.data as { reservation_id: string }).reservation_id,
    });

    // 'expired' leaves the constraint's predicate, so the slot is free at once —
    // no waiting for hold_ttl_seconds or the pg_cron sweep.
    const now = await appRpc(second, 'hold_slot', args).then(outcome);
    expect(now.ok, now.errorMessage).toBe(true);
  });
});
