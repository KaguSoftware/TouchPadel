/**
 * 0075 — marking a no-show must actually END the booking.
 *
 * REPRO (operator, 2026-09-07). Mark a guest as a no-show at the desk. The
 * status flips and the slot frees, but the booking still looks live everywhere
 * that matters: nothing is stamped on the row to say it ended, the guest is
 * never told, and the "your game is in 3 hours" reminder is still sitting in
 * the outbox waiting to fire for a booking the desk has written off. From the
 * customer's phone it looks like nothing happened at all.
 *
 * These are the assertions that keep that fixed. A no-show is still NOT a
 * cancellation — the reports count the two separately and a venue acts on its
 * no-show rate — so the status stays `no_show`; it is the terminal bookkeeping
 * and the notification that were missing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  outcome,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

interface ReservationRow {
  status: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

describe.skipIf(!up)('0075 no-show terminates the booking', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let courtId: string;
  const madeReservations: string[] = [];
  const madeProfiles: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, `NS${Date.now() % 100000}`);
  });

  afterAll(async () => {
    if (madeReservations.length > 0) {
      await svc.from('notification_outbox').delete().in('payload->>reservation_id', madeReservations);
      await svc.from('reservations').delete().in('id', madeReservations);
    }
    if (madeProfiles.length > 0) {
      await svc.from('profiles').update({ expo_push_token: null }).in('id', madeProfiles);
    }
    await svc.from('courts').delete().eq('id', courtId);
    await desk.auth.signOut();
  });

  /**
   * A confirmed booking for a guest whose phone CAN receive a push — the whole
   * point is what reaches that phone, and enqueue_reservation_push is a no-op
   * for a profile with no expo_push_token.
   */
  async function confirmedBooking(tag: string) {
    const guest = await guestClient(svc, tag);
    const { data: me } = await guest.auth.getUser();
    const guestId = me.user!.id;
    madeProfiles.push(guestId);
    await svc.from('profiles').update({ expo_push_token: `ExponentPushToken[t-${tag}]` }).eq('id', guestId);

    // futureSlot() walks forward day by day, so every booking here is well
    // over 3 hours out and confirm_booking always schedules a reminder — which
    // is the row two of these tests are about.
    const start = futureSlot().start;
    const held = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(held.ok, held.errorMessage).toBe(true);
    const holdId = (held.data as { reservation_id: string }).reservation_id;

    const confirmed = await appRpc(guest, 'confirm_booking', { p_hold_id: holdId }).then(outcome);
    expect(confirmed.ok, confirmed.errorMessage).toBe(true);
    madeReservations.push(holdId);
    await guest.auth.signOut();
    return { id: holdId, guestId, start };
  }

  const rowOf = async (id: string) => {
    const { data } = await svc
      .from('reservations')
      .select('status, cancelled_at, cancellation_reason')
      .eq('id', id)
      .single();
    return data as ReservationRow;
  };

  const outboxOf = async (id: string, kind?: string) => {
    let q = svc.from('notification_outbox').select('kind, sent_at').eq('payload->>reservation_id', id);
    if (kind) q = q.eq('kind', kind);
    const { data } = await q;
    return (data ?? []) as { kind: string; sent_at: string | null }[];
  };

  it('stamps the booking as ended, with the reason the desk gave', async () => {
    const b = await confirmedBooking('ns-stamp');
    const before = await rowOf(b.id);
    expect(before.status).toBe('confirmed');
    expect(before.cancelled_at).toBeNull();

    const res = await appRpc(desk, 'mark_reservation', {
      p_reservation_id: b.id,
      p_status: 'no_show',
      p_reason: 'guest_no_show',
    });
    expect(res.error).toBeNull();

    const after = await rowOf(b.id);
    // Still a no-show, not a cancellation: the reports count them apart.
    expect(after.status).toBe('no_show');
    // ...but it is over, and the row now says so and says why.
    expect(after.cancelled_at).not.toBeNull();
    expect(after.cancellation_reason).toBe('guest_no_show');
  });

  it('voids the pending 3-hour reminder instead of nudging a guest who is gone', async () => {
    const b = await confirmedBooking('ns-reminder');
    // confirm_booking scheduled it, because the slot is more than 3h out.
    expect((await outboxOf(b.id, 'booking_reminder')).length).toBe(1);

    await appRpc(desk, 'mark_reservation', { p_reservation_id: b.id, p_status: 'no_show', p_reason: 'guest_no_show' });

    const reminders = await outboxOf(b.id, 'booking_reminder');
    expect(reminders.filter((r) => r.sent_at === null)).toEqual([]);
  });

  it('tells the guest, so the booking does not just change meaning on their phone', async () => {
    const b = await confirmedBooking('ns-push');
    await appRpc(desk, 'mark_reservation', { p_reservation_id: b.id, p_status: 'no_show', p_reason: 'guest_no_show' });

    const notices = await outboxOf(b.id, 'booking_no_show');
    expect(notices.length).toBe(1);
    expect(notices[0]!.sent_at).toBeNull(); // queued for the sender, not sent here
  });

  it('frees the slot the moment it is marked', async () => {
    const b = await confirmedBooking('ns-slot');
    await appRpc(desk, 'mark_reservation', { p_reservation_id: b.id, p_status: 'no_show', p_reason: 'guest_no_show' });

    // The desk rebooks the same court and time immediately: a no-show that
    // still held the exclusion range would raise here.
    const { data, error } = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: b.start.toISOString(),
        end_at: new Date(b.start.getTime() + 60 * 60_000).toISOString(),
        guest_name: 'Walk-in after no-show',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    madeReservations.push((data as { id: string }).id);
  });

  it('completed also ends the booking, but explains nothing — there is nothing to explain', async () => {
    const b = await confirmedBooking('ns-completed');
    await appRpc(desk, 'mark_reservation', { p_reservation_id: b.id, p_status: 'completed', p_reason: 'staff_op' });

    const after = await rowOf(b.id);
    expect(after.status).toBe('completed');
    expect(after.cancelled_at).not.toBeNull();
    expect(after.cancellation_reason).toBeNull();
    // The happy path must not push a "your booking was closed" notice.
    expect(await outboxOf(b.id, 'booking_no_show')).toEqual([]);
  });

  it('arrived is not an ending and stamps nothing', async () => {
    const b = await confirmedBooking('ns-arrived');
    await appRpc(desk, 'mark_reservation', { p_reservation_id: b.id, p_status: 'arrived', p_reason: 'staff_op' });

    const after = await rowOf(b.id);
    expect(after.status).toBe('arrived');
    expect(after.cancelled_at).toBeNull();
    // The guest is still coming: their reminder stays exactly where it was.
    expect((await outboxOf(b.id, 'booking_reminder')).length).toBe(1);
  });

  it('a no-show cannot be marked twice, and the transition set is unchanged', async () => {
    const b = await confirmedBooking('ns-twice');
    await appRpc(desk, 'mark_reservation', { p_reservation_id: b.id, p_status: 'no_show', p_reason: 'guest_no_show' });

    const again = outcome(
      await appRpc(desk, 'mark_reservation', { p_reservation_id: b.id, p_status: 'no_show', p_reason: 'guest_no_show' }),
    );
    expect(again.errorMessage).toContain('INVALID_TRANSITION');

    // Exactly one notice, not one per attempt.
    expect((await outboxOf(b.id, 'booking_no_show')).length).toBe(1);
  });
});
