/**
 * 0088 — a cancelled booking has to say WHO cancelled it.
 *
 * REPRO (mobile, 2026-09-11). Open My reservations > Cancelled. Every row
 * wears the same grey CANCELLED badge, whether the guest tapped Cancel booking
 * themselves or the desk took the court back — a maintenance closure, an
 * untangled double booking, a weekly series called off. The guest finds a game
 * they expected to play sitting under that badge and cannot tell which
 * happened, because `reservations` stored `cancelled_at` and a reason nobody
 * is obliged to fill in, and never the actor.
 *
 * These are the assertions that keep the actor recorded. It comes from the
 * staff check app.cancel_reservation ALREADY makes to choose which policy to
 * apply, so the two can never drift apart: whoever the RPC let through is
 * whoever it writes down.
 *
 * NULL is a real answer and is tested as one. A no-show stamps cancelled_at
 * (0075) but was cancelled by nobody, and a cancellation from before this
 * column existed has no actor to recover — both must stay null so the app can
 * fall back to wording that claims nothing rather than guess.
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
  cancelled_by: string | null;
}

describe.skipIf(!up)('0088 cancelled_by names the actor', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let courtId: string;
  const madeReservations: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, `CB${Date.now() % 100000}`);
  });

  afterAll(async () => {
    if (madeReservations.length > 0) {
      await svc
        .from('notification_outbox')
        .delete()
        .in('payload->>reservation_id', madeReservations);
      await svc.from('reservations').delete().in('id', madeReservations);
    }
    await svc.from('courts').delete().eq('id', courtId);
    await desk.auth.signOut();
  });

  /**
   * A confirmed booking owned by a fresh guest account, with that guest's own
   * client handed back — the guest path is half of what is under test, and it
   * can only be exercised by the account that owns the row.
   *
   * futureSlot() lands 7+ days out, which clears cancellation_window_hours by
   * a wide margin: a guest cancel that failed on the window would look exactly
   * like one that failed to stamp.
   */
  async function confirmedBooking(tag: string) {
    const guest = await guestClient(svc, tag);
    const start = futureSlot().start;
    const held = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(held.ok, held.errorMessage).toBe(true);
    const id = (held.data as { reservation_id: string }).reservation_id;

    const confirmed = await appRpc(guest, 'confirm_booking', { p_hold_id: id }).then(outcome);
    expect(confirmed.ok, confirmed.errorMessage).toBe(true);
    madeReservations.push(id);
    return { id, guest, start };
  }

  const rowOf = async (id: string) => {
    const { data } = await svc
      .from('reservations')
      .select('status, cancelled_at, cancelled_by')
      .eq('id', id)
      .single();
    return data as ReservationRow;
  };

  it('stamps a guest cancelling their own booking as the guest', async () => {
    const b = await confirmedBooking('cb-guest');
    expect((await rowOf(b.id)).cancelled_by).toBeNull();

    const res = await appRpc(b.guest, 'cancel_reservation', { p_reservation_id: b.id }).then(
      outcome,
    );
    expect(res.ok, res.errorMessage).toBe(true);
    // Returned as well as stored: the app refetches, but the caller should not
    // have to in order to know what it just did.
    expect((res.data as { cancelled_by?: string }).cancelled_by).toBe('guest');

    const after = await rowOf(b.id);
    expect(after.status).toBe('cancelled');
    expect(after.cancelled_at).not.toBeNull();
    expect(after.cancelled_by).toBe('guest');
    await b.guest.auth.signOut();
  });

  it('stamps the desk cancelling a guest booking as staff', async () => {
    const b = await confirmedBooking('cb-desk');

    const res = await appRpc(desk, 'cancel_reservation', {
      p_reservation_id: b.id,
      p_reason: 'court_maintenance',
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect((res.data as { cancelled_by?: string }).cancelled_by).toBe('staff');

    const after = await rowOf(b.id);
    expect(after.status).toBe('cancelled');
    expect(after.cancelled_by).toBe('staff');
    await b.guest.auth.signOut();
  });

  /**
   * The point of the whole column: the guest has to be able to READ it on
   * their own row. It arrives through the table grant and the
   * reservations_guest_read policy (0008), neither of which this migration
   * touches — which is exactly why it is worth proving rather than assuming.
   */
  it('is readable by the guest whose booking it is', async () => {
    const b = await confirmedBooking('cb-read');
    await appRpc(desk, 'cancel_reservation', {
      p_reservation_id: b.id,
      p_reason: 'court_maintenance',
    });

    const { data, error } = await b.guest
      .from('reservations')
      .select('status, cancelled_by')
      .eq('id', b.id)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ status: 'cancelled', cancelled_by: 'staff' });
    await b.guest.auth.signOut();
  });

  /**
   * A no-show is an ENDING, not a cancellation. 0075 stamps cancelled_at on
   * one so the row looks ended to every reader, and this is the assertion that
   * stops that bookkeeping from being read as "somebody cancelled it": nobody
   * did, and a caption saying the venue cancelled the booking would be a
   * different — and false — accusation about the same event.
   */
  it('leaves a no-show with no actor at all', async () => {
    const b = await confirmedBooking('cb-noshow');
    await b.guest.auth.signOut();

    // 0071/SEC-11 refuses a no_show before start_at: both endings leave the
    // exclusion set, and marking a FUTURE booking would free a court for
    // resale. So the booking has to have started, which is also the only state
    // in which a venue can know somebody failed to turn up.
    const newStart = new Date(Date.now() - 2 * 3_600_000);
    const { error: backdateErr } = await svc
      .from('reservations')
      .update({
        start_at: newStart.toISOString(),
        end_at: new Date(newStart.getTime() + 60 * 60_000).toISOString(),
      })
      .eq('id', b.id);
    expect(backdateErr).toBeNull();

    const res = await appRpc(desk, 'mark_reservation', {
      p_reservation_id: b.id,
      p_status: 'no_show',
      p_reason: 'guest_no_show',
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);

    const after = await rowOf(b.id);
    expect(after.status).toBe('no_show');
    // Ended, and the row says so...
    expect(after.cancelled_at).not.toBeNull();
    // ...but nobody cancelled it.
    expect(after.cancelled_by).toBeNull();
  });

  /**
   * The refusals must not write. A cancel that the policy turns away has to
   * leave the booking exactly as it was — an actor stamped on a booking that
   * is still live would be worse than no column at all, because every reader
   * downstream keys off `status` and would find the two disagreeing.
   */
  it('writes nothing when the cancel is refused', async () => {
    const b = await confirmedBooking('cb-refused');
    const stranger = await guestClient(svc, 'cb-stranger');

    const res = await appRpc(stranger, 'cancel_reservation', { p_reservation_id: b.id }).then(
      outcome,
    );
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('FORBIDDEN');

    const after = await rowOf(b.id);
    expect(after.status).toBe('confirmed');
    expect(after.cancelled_by).toBeNull();
    await stranger.auth.signOut();
    await b.guest.auth.signOut();
  });
});
