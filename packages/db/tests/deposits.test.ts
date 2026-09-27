/**
 * 0241/0242 — online deposits (Qi Card), the server state machine.
 *
 * Plan docs/design/payments/qi-deposit-plan-2026-09-20.md (§3, §10), contracts
 * docs/design/payments/build-contracts-2026-09-27.md. The edge functions are
 * the only callers of the service RPCs; here the service client stands in for
 * them, exactly as a webhook, a poll or the reconciler would call.
 *
 * The two rules everything below checks, one way or another:
 *   - no false positive: `succeeded` only for SUCCESS on exactly our amount in
 *     IQD, and only with the booking confirmed in the same transaction;
 *   - no false negative: a SUCCESS that arrives late (after failed or expired)
 *     is still honoured, booked when the slot is free and refunded when not.
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
  DEV_PINS,
  VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();

type Json = Record<string, unknown>;

describe.skipIf(!up)('0242 online deposits', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let desk: SupabaseClient;
  let courtId: string;
  let saved: Json;

  const svcRpc = async (fn: string, args: Json) => {
    const res = await svc.schema('app').rpc(fn, args).then(outcome);
    return res;
  };

  const uidOf = async (c: SupabaseClient) => {
    const { data } = await c.auth.getUser();
    return data.user!.id;
  };

  const hold = async (guest: SupabaseClient, slot = futureSlot()) => {
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return (res.data as { reservation_id: string }).reservation_id;
  };

  const setRules = async (patch: Json) => {
    const res = await appRpc(owner, 'set_deposit_settings', { p_patch: patch, p_venue_id: VENUE_A_ID }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return res.data as Json;
  };

  /** deposit-begin, minus the Qi call: prepare + mark_created. */
  const begin = async (guest: SupabaseClient, holdId: string) => {
    const guestId = await uidOf(guest);
    const prep = await svcRpc('deposit_prepare', {
      p_guest_id: guestId, p_hold_id: holdId, p_locale: 'en', p_provider: 'fake',
    });
    expect(prep.ok, prep.errorMessage).toBe(true);
    const row = prep.data as Json;
    if (row.status === 'created') {
      const created = await svcRpc('deposit_mark_created', {
        p_request_id: row.request_id,
        p_provider_payment_id: `pay-${crypto.randomUUID()}`,
        p_form_url: `http://127.0.0.1:54321/functions/v1/payments-fake?ref=${row.request_id}`,
        p_provider_status: 'CREATED',
        p_raw: {},
      });
      expect(created.ok, created.errorMessage).toBe(true);
    }
    return row as { id: string; request_id: string; amount_iqd: number; reused: boolean };
  };

  const apply = (requestId: string, status: string, amount: number | null = 20_000, extra: Json = {}) =>
    svcRpc('deposit_apply', {
      p_request_id: requestId,
      p_provider_payment_id: null,
      p_provider_status: status,
      p_amount: amount,
      p_currency: 'IQD',
      p_canceled: false,
      p_source: 'webhook',
      p_signature_ok: true,
      p_raw: { status },
      ...extra,
    });

  const payment = async (id: string) => {
    const { data } = await svc.from('booking_payments').select('*').eq('id', id).single();
    return data as Json;
  };
  const reservation = async (id: string) => {
    const { data } = await svc.from('reservations').select('*').eq('id', id).single();
    return data as Json;
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    desk = await signedInClient(SEED_STAFF.court_desk);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'D0242');
    // A court-specific rule outranks every all-courts rule (price_slot:
    // specificity first), so every slot here costs 40,000 whatever peak
    // pricing the seed carries for that hour.
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
    const { data: rule, error } = await svc
      .from('rate_rules')
      .insert({
        name: 'TEST deposit court', court_id: courtId, days_of_week: [0, 1, 2, 3, 4, 5, 6],
        start_time: '00:00', end_time: '23:59:59', priority: 1000, valid_from: yesterday,
        is_active: true, venue_id: VENUE_A_ID,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const { error: pErr } = await svc.from('rate_rule_prices').insert(
      [60, 90, 120].map((d) => ({ rule_id: (rule as Json).id, duration_min: d, price_iqd: 40_000 })),
    );
    if (pErr) throw new Error(pErr.message);
    const s = await appRpc(owner, 'deposit_settings', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect(s.ok, s.errorMessage).toBe(true);
    saved = s.data as Json;
  });

  afterAll(async () => {
    if (!owner || !saved) return;
    const { venue_id: _v, ...rules } = saved;
    await appRpc(owner, 'set_deposit_settings', { p_patch: rules, p_venue_id: VENUE_A_ID });
  });

  // ── settings ───────────────────────────────────────────────────────────────

  it('ships off: the quote says off and nothing can begin', async () => {
    await setRules({ deposit_mode: 'off' });
    const guest = await guestClient(svc, 'dep-off');
    const id = await hold(guest);
    const q = await appRpc(guest, 'deposit_quote', { p_hold_id: id }).then(outcome);
    expect(q.ok, q.errorMessage).toBe(true);
    expect(q.data).toMatchObject({ deposit_mode: 'off', deposit_iqd: 0, price_iqd: 40_000, rest_iqd: 40_000, active: null });

    const prep = await svcRpc('deposit_prepare', {
      p_guest_id: await uidOf(guest), p_hold_id: id, p_locale: 'en', p_provider: 'fake',
    });
    expect(prep.ok).toBe(false);
    expect(prep.errorMessage).toContain('DEPOSITS_OFF');
  });

  it('only the owner writes the rules; bad values are refused before anything changes', async () => {
    const m = await appRpc(manager, 'set_deposit_settings', { p_patch: { deposit_mode: 'optional' }, p_venue_id: VENUE_A_ID }).then(outcome);
    expect(m.ok).toBe(false);
    expect(m.errorMessage).toContain('FORBIDDEN');

    for (const bad of [
      { deposit_mode: 'sometimes' },
      { deposit_percent_bp: 50 },
      { deposit_window_seconds: 30 },
      { deposit_min_iqd: 5000, deposit_max_iqd: 1000 },
      { deposit_forfeit_no_show: 'yes' },
      { venue_name: 'x' },
    ]) {
      const r = await appRpc(owner, 'set_deposit_settings', { p_patch: bad, p_venue_id: VENUE_A_ID }).then(outcome);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.errorMessage).toContain('INVALID_ARGUMENT');
    }

    const after = await setRules({
      deposit_mode: 'optional', deposit_percent_bp: 5000, deposit_min_iqd: 10_000,
      deposit_max_iqd: null, deposit_window_seconds: 900, deposit_forfeit_no_show: true,
    });
    expect(after).toMatchObject({ deposit_mode: 'optional', deposit_percent_bp: 5000, deposit_max_iqd: null });

    // A manager reads them (the settings page is owner-only to write).
    const read = await appRpc(manager, 'deposit_settings', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect(read.ok, read.errorMessage).toBe(true);

    // A guest reads nothing.
    const guest = await guestClient(svc, 'dep-set-guest');
    const g = await appRpc(guest, 'deposit_settings', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect(g.ok).toBe(false);
  });

  it('the amount: percent rounded up to 250, held between min and max, never above the price', async () => {
    const guest = await guestClient(svc, 'dep-amount');
    const id = await hold(guest);
    const q = async () => (await appRpc(guest, 'deposit_quote', { p_hold_id: id }).then(outcome)).data as Json;

    await setRules({ deposit_mode: 'optional', deposit_percent_bp: 3333, deposit_min_iqd: 0, deposit_max_iqd: null });
    expect(await q()).toMatchObject({ deposit_iqd: 13_500, rest_iqd: 26_500 }); // 13,332 → 13,500

    await setRules({ deposit_percent_bp: 1000, deposit_min_iqd: 10_000 });
    expect(await q()).toMatchObject({ deposit_iqd: 10_000 }); // 4,000 → floor 10,000

    await setRules({ deposit_percent_bp: 10000, deposit_max_iqd: 25_000 });
    expect(await q()).toMatchObject({ deposit_iqd: 25_000, rest_iqd: 15_000 });

    await setRules({ deposit_max_iqd: null, deposit_min_iqd: 90_000, deposit_percent_bp: 5000 });
    expect(await q()).toMatchObject({ deposit_iqd: 40_000, rest_iqd: 0 }); // never above the price

    await setRules({ deposit_min_iqd: 10_000, deposit_percent_bp: 5000 });
    expect(await q()).toMatchObject({ deposit_mode: 'optional', deposit_iqd: 20_000, window_seconds: 900 });
  });

  // ── the happy path ─────────────────────────────────────────────────────────

  it('SUCCESS for our amount confirms the booking in the same step; the desk charges only the rest', async () => {
    await setRules({ deposit_mode: 'optional' });
    const guest = await guestClient(svc, 'dep-happy');
    const id = await hold(guest);
    const before = await reservation(id);

    const row = await begin(guest, id);
    expect(row.amount_iqd).toBe(20_000);
    const p0 = await payment(row.id);
    expect(p0.status).toBe('pending');
    expect(p0.sandbox).toBe(false);
    // The payment window owns the hold now.
    expect(new Date((await reservation(id)).hold_expires_at as string).getTime())
      .toBeGreaterThanOrEqual(new Date(before.hold_expires_at as string).getTime());

    // A double tap (or a second phone) gets the same attempt back.
    const again = await begin(guest, id);
    expect(again.request_id).toBe(row.request_id);
    expect(again.reused).toBe(true);

    // The quote shows the live attempt.
    const q = await appRpc(guest, 'deposit_quote', { p_hold_id: id }).then(outcome);
    expect((q.data as Json).active).toMatchObject({ request_id: row.request_id, status: 'pending' });

    const res = await apply(row.request_id, 'SUCCESS');
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.data).toMatchObject({ matched: true, status: 'succeeded', reservation_id: id });

    expect(await reservation(id)).toMatchObject({ kind: 'booking', status: 'confirmed', price_iqd: 40_000, hold_expires_at: null });
    expect((await payment(row.id)).status).toBe('succeeded');

    const status = await appRpc(guest, 'deposit_status', { p_request_id: row.request_id }).then(outcome);
    expect(status.ok, status.errorMessage).toBe(true);
    expect(status.data).toMatchObject({
      status: 'succeeded', amount_iqd: 20_000, price_iqd: 40_000, rest_iqd: 20_000, form_url: null,
      reservation: { id, kind: 'booking', status: 'confirmed' },
    });

    const mine = await appRpc(guest, 'my_reservations', { p_reservation_id: id }).then(outcome);
    expect(mine.ok, mine.errorMessage).toBe(true);
    expect((mine.data as Json[])[0]).toMatchObject({
      online_paid_iqd: 20_000, court_paid_iqd: 20_000, court_remaining_iqd: 20_000,
      payment_status: 'succeeded', payment_ref: row.request_id,
    });

    const bill = await appRpc(desk, 'booking_bill', { p_reservation_id: id }).then(outcome);
    expect(bill.ok, bill.errorMessage).toBe(true);
    expect(bill.data).toMatchObject({ online_paid_iqd: 20_000, court_paid_iqd: 20_000, court_remaining_iqd: 20_000, court_refund_due_iqd: 0 });
    expect((bill.data as Json).online_payments).toHaveLength(1);

    const states = await appRpc(desk, 'booking_bill_states', { p_reservation_ids: [id] }).then(outcome);
    expect((states.data as Json[])[0]).toMatchObject({ state: 'owed', due_iqd: 20_000 });

    // A replay changes nothing; a late non-terminal status is ignored.
    expect((await apply(row.request_id, 'SUCCESS')).data).toMatchObject({ status: 'succeeded' });
    expect((await apply(row.request_id, 'FORM_SHOWED')).data).toMatchObject({ status: 'succeeded' });
    expect((await payment(row.id)).status).toBe('succeeded');

    const { data: events } = await svc.from('booking_payment_events').select('source').eq('payment_id', row.id);
    expect((events ?? []).length).toBeGreaterThanOrEqual(4); // begin, created, 3 × webhook
  });

  it('the guest cannot read the tables, and another guest cannot read the payment', async () => {
    const guest = await guestClient(svc, 'dep-rls');
    const id = await hold(guest);
    const row = await begin(guest, id);

    const direct = await guest.from('booking_payments').select('id');
    expect(direct.data ?? []).toHaveLength(0);

    const stranger = await guestClient(svc, 'dep-rls-other');
    for (const ref of [row.request_id, crypto.randomUUID()]) {
      const r = await appRpc(stranger, 'deposit_status', { p_request_id: ref }).then(outcome);
      expect(r.ok).toBe(false);
      expect(r.errorMessage).toContain('PAYMENT_NOT_FOUND');
    }
    const q = await appRpc(stranger, 'deposit_quote', { p_hold_id: id }).then(outcome);
    expect(q.errorMessage).toContain('FORBIDDEN');

    const prep = await svcRpc('deposit_prepare', {
      p_guest_id: await uidOf(stranger), p_hold_id: id, p_locale: 'en', p_provider: 'fake',
    });
    expect(prep.errorMessage).toContain('FORBIDDEN');

    // The desk reads its branch's payments (the bill panel links to them).
    const d = await appRpc(desk, 'deposit_status', { p_request_id: row.request_id }).then(outcome);
    expect(d.ok, d.errorMessage).toBe(true);
  });

  // ── the false-positive guard ───────────────────────────────────────────────

  it('SUCCESS for another amount or currency is never a paid booking: it is refunded', async () => {
    const guest = await guestClient(svc, 'dep-mismatch');
    const id = await hold(guest);
    const row = await begin(guest, id);

    const res = await apply(row.request_id, 'SUCCESS', 19_999);
    expect(res.data).toMatchObject({ status: 'refund_pending' });
    expect(await payment(row.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'amount_mismatch', refund_amount_iqd: 20_000 });
    expect(await reservation(id)).toMatchObject({ kind: 'hold', status: 'pending' });

    const guest2 = await guestClient(svc, 'dep-currency');
    const id2 = await hold(guest2);
    const row2 = await begin(guest2, id2);
    const res2 = await apply(row2.request_id, 'SUCCESS', 20_000, { p_currency: 'USD' });
    expect(res2.data).toMatchObject({ status: 'refund_pending' });
  });

  it('an unknown payment is logged unmatched and changes nothing', async () => {
    const res = await apply(crypto.randomUUID(), 'SUCCESS', 20_000, { p_provider_payment_id: 'nobody' });
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.data).toMatchObject({ matched: false });
    const { data } = await svc.from('booking_payment_events').select('id').is('payment_id', null).eq('provider_status', 'SUCCESS');
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  // ── failures, retries, the attempt cap ─────────────────────────────────────

  it('a decline keeps the hold; the guest may try again (three attempts) or pay at the desk', async () => {
    const guest = await guestClient(svc, 'dep-decline');
    const id = await hold(guest);

    const a = await begin(guest, id);
    expect((await apply(a.request_id, 'FAILED')).data).toMatchObject({ status: 'failed' });
    expect(await payment(a.id)).toMatchObject({ status: 'failed', failure_code: 'declined' });
    expect(await reservation(id)).toMatchObject({ kind: 'hold', status: 'pending' });

    const b = await begin(guest, id);
    expect(b.request_id).not.toBe(a.request_id);
    expect((await apply(b.request_id, 'AUTHENTICATION_FAILED')).data).toMatchObject({ status: 'failed' });
    expect((await payment(b.id)).failure_code).toBe('auth_failed');

    const c = await begin(guest, id);
    expect((await apply(c.request_id, 'ERROR')).data).toMatchObject({ status: 'failed' });
    expect((await payment(c.id)).failure_code).toBe('bank_error');

    const st = await appRpc(guest, 'deposit_status', { p_request_id: c.request_id }).then(outcome);
    expect(st.data).toMatchObject({ attempts_left: 0, hold_live: true, deposit_mode: 'optional' });

    const fourth = await svcRpc('deposit_prepare', {
      p_guest_id: await uidOf(guest), p_hold_id: id, p_locale: 'en', p_provider: 'fake',
    });
    expect(fourth.errorMessage).toContain('TOO_MANY_ATTEMPTS');

    // Optional: confirm and pay everything at the desk.
    const conf = await appRpc(guest, 'confirm_booking', { p_hold_id: id }).then(outcome);
    expect(conf.ok, conf.errorMessage).toBe(true);
    expect(await reservation(id)).toMatchObject({ kind: 'booking', status: 'confirmed' });
  });

  it('a late SUCCESS after a decline is honoured, not lost', async () => {
    const guest = await guestClient(svc, 'dep-late-fail');
    const id = await hold(guest);
    const a = await begin(guest, id);
    await apply(a.request_id, 'FAILED');
    const res = await apply(a.request_id, 'SUCCESS');
    expect(res.data).toMatchObject({ status: 'succeeded', reservation_id: id });
    expect(await reservation(id)).toMatchObject({ kind: 'booking', status: 'confirmed' });
  });

  it('SUCCESS after the guest already confirmed at the desk counts as paid on that booking', async () => {
    const guest = await guestClient(svc, 'dep-both');
    const id = await hold(guest);
    const a = await begin(guest, id);
    const conf = await appRpc(guest, 'confirm_booking', { p_hold_id: id }).then(outcome);
    expect(conf.ok, conf.errorMessage).toBe(true);
    expect((await apply(a.request_id, 'SUCCESS')).data).toMatchObject({ status: 'succeeded' });
    const bill = await appRpc(desk, 'booking_bill', { p_reservation_id: id }).then(outcome);
    expect(bill.data).toMatchObject({ online_paid_iqd: 20_000, court_remaining_iqd: 20_000 });
  });

  // ── the window: expiry, the sweep, release ─────────────────────────────────

  it('an open payment keeps its hold: release answers payment_in_progress, the sweep skips it', async () => {
    const guest = await guestClient(svc, 'dep-window');
    const id = await hold(guest);
    const a = await begin(guest, id);

    const rel = await appRpc(guest, 'release_hold', { p_reservation_id: id }).then(outcome);
    expect(rel.ok, rel.errorMessage).toBe(true);
    expect(rel.data).toMatchObject({ released: false, payment_in_progress: true, status: 'pending' });

    // Even past its TTL, the hold waits for the payment's answer.
    await svc.from('reservations').update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', id);
    await svc.schema('app').rpc('expire_stale_holds', { p_court_id: courtId });
    expect(await reservation(id)).toMatchObject({ status: 'pending' });

    // EXPIRED ends it and gives the slot back.
    expect((await apply(a.request_id, 'EXPIRED')).data).toMatchObject({ status: 'expired' });
    expect(await reservation(id)).toMatchObject({ kind: 'hold', status: 'expired' });
  });

  it('a late SUCCESS on an expired attempt books the same slot again when it is free', async () => {
    const guest = await guestClient(svc, 'dep-late-free');
    const id = await hold(guest);
    const a = await begin(guest, id);
    await apply(a.request_id, 'EXPIRED');

    const res = await apply(a.request_id, 'SUCCESS');
    expect(res.data).toMatchObject({ status: 'succeeded' });
    const moved = (res.data as Json).reservation_id as string;
    expect(moved).not.toBe(id);
    const r = await reservation(moved);
    const h = await reservation(id);
    expect(r).toMatchObject({ kind: 'booking', status: 'confirmed', start_at: h.start_at, court_id: courtId, price_iqd: 40_000 });
    expect(await payment(a.id)).toMatchObject({ reservation_id: moved, hold_id: id });
  });

  it('a late SUCCESS whose slot someone else took is refunded (slot_lost)', async () => {
    const guest = await guestClient(svc, 'dep-late-taken');
    const slot = futureSlot();
    const id = await hold(guest, slot);
    const a = await begin(guest, id);
    await apply(a.request_id, 'EXPIRED');

    const other = await guestClient(svc, 'dep-late-thief');
    await hold(other, slot);

    const res = await apply(a.request_id, 'SUCCESS');
    expect(res.data).toMatchObject({ status: 'refund_pending' });
    expect(await payment(a.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'slot_lost' });
  });

  // ── after the booking: cancel, no-show, refunds ────────────────────────────

  const paidBooking = async (tag: string) => {
    const guest = await guestClient(svc, tag);
    const id = await hold(guest);
    const a = await begin(guest, id);
    await apply(a.request_id, 'SUCCESS');
    return { guest, id, pay: a };
  };

  it('a guest cancel refunds the deposit; a cancelled booking owes and counts nothing', async () => {
    const { guest, id, pay } = await paidBooking('dep-cancel-guest');
    const res = await appRpc(guest, 'cancel_reservation', { p_reservation_id: id }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(await payment(pay.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'guest_cancel', refund_amount_iqd: 20_000 });
    const bill = await appRpc(desk, 'booking_bill', { p_reservation_id: id }).then(outcome);
    expect(bill.data).toMatchObject({ online_paid_iqd: 0, court_paid_iqd: 0, court_refund_due_iqd: 0 });
  });

  it('a staff cancel refunds too, as staff_cancel', async () => {
    const { id, pay } = await paidBooking('dep-cancel-staff');
    const res = await appRpc(desk, 'cancel_reservation', { p_reservation_id: id, p_reason: 'court_closed' }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect((await payment(pay.id)).refund_reason).toBe('staff_cancel');
  });

  it('a no-show keeps the deposit by default, or refunds it when the owner says so', async () => {
    const kept = await paidBooking('dep-noshow-keep');
    await svc.from('reservations').update({ status: 'no_show' }).eq('id', kept.id);
    const p = await payment(kept.pay.id);
    expect(p.status).toBe('succeeded');
    expect(p.forfeited_at).not.toBeNull();

    await setRules({ deposit_forfeit_no_show: false });
    const back = await paidBooking('dep-noshow-refund');
    await svc.from('reservations').update({ status: 'no_show' }).eq('id', back.id);
    expect(await payment(back.pay.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'no_show' });
    await setRules({ deposit_forfeit_no_show: true });
  });

  it('refunds: Qi says yes → refunded; no → refund_failed, listed, retried, settled by hand with a PIN', async () => {
    const one = await paidBooking('dep-refund-ok');
    await appRpc(one.guest, 'cancel_reservation', { p_reservation_id: one.id });
    const ok = await svcRpc('deposit_refund_apply', {
      p_payment_id: one.pay.id, p_outcome: 'succeeded', p_provider_status: 'SUCCESS', p_refund_provider_id: 'rf-1', p_raw: {},
    });
    expect(ok.ok, ok.errorMessage).toBe(true);
    expect(await payment(one.pay.id)).toMatchObject({ status: 'refunded', refund_provider_id: 'rf-1' });
    const again = await svcRpc('deposit_refund_apply', {
      p_payment_id: one.pay.id, p_outcome: 'failed', p_provider_status: 'FAILED', p_refund_provider_id: null, p_raw: {},
    });
    expect(again.data).toMatchObject({ status: 'refunded', changed: false });

    const two = await paidBooking('dep-refund-no');
    await appRpc(two.guest, 'cancel_reservation', { p_reservation_id: two.id });
    await svcRpc('deposit_refund_apply', {
      p_payment_id: two.pay.id, p_outcome: 'failed', p_provider_status: '18', p_refund_provider_id: null, p_raw: {},
    });
    expect((await payment(two.pay.id)).status).toBe('refund_failed');

    const list = await appRpc(manager, 'deposit_attention', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect(list.ok, list.errorMessage).toBe(true);
    expect((list.data as Json[]).map((r) => r.id)).toContain(two.pay.id);

    const guestTry = await appRpc(two.guest, 'deposit_attention', { p_venue_id: VENUE_A_ID }).then(outcome);
    expect(guestTry.ok).toBe(false);

    const retry = await appRpc(manager, 'deposit_refund_retry', { p_payment_id: two.pay.id }).then(outcome);
    expect(retry.ok, retry.errorMessage).toBe(true);
    expect((await payment(two.pay.id)).status).toBe('refund_pending');
    const retryAgain = await appRpc(manager, 'deposit_refund_retry', { p_payment_id: two.pay.id }).then(outcome);
    expect(retryAgain.errorMessage).toContain('PAYMENT_STATE');

    const noNote = await appRpc(manager, 'deposit_refund_manual', {
      p_payment_id: two.pay.id, p_pin: DEV_PINS.manager, p_note: ' ',
    }).then(outcome);
    expect(noNote.errorMessage).toContain('REASON_REQUIRED');

    const wrongPin = await appRpc(manager, 'deposit_refund_manual', {
      p_payment_id: two.pay.id, p_pin: '000000', p_note: 'cash at the desk',
    }).then(outcome);
    expect(wrongPin.ok).toBe(false);

    const manual = await appRpc(manager, 'deposit_refund_manual', {
      p_payment_id: two.pay.id, p_pin: DEV_PINS.manager, p_note: 'cash at the desk',
    }).then(outcome);
    expect(manual.ok, manual.errorMessage).toBe(true);
    expect(await payment(two.pay.id)).toMatchObject({ status: 'refunded', refund_note: 'cash at the desk' });
  });

  it('a manager refunds part of a deposit (a price cut below it); the booking then owes the difference', async () => {
    const { id, pay } = await paidBooking('dep-partial');
    const tooMuch = await appRpc(manager, 'deposit_refund_request', { p_payment_id: pay.id, p_amount_iqd: 25_000 }).then(outcome);
    expect(tooMuch.errorMessage).toContain('REFUND_TOO_LARGE');
    const part = await appRpc(manager, 'deposit_refund_request', { p_payment_id: pay.id, p_amount_iqd: 5_000 }).then(outcome);
    expect(part.ok, part.errorMessage).toBe(true);
    const bill = await appRpc(desk, 'booking_bill', { p_reservation_id: id }).then(outcome);
    expect(bill.data).toMatchObject({ online_paid_iqd: 15_000, court_remaining_iqd: 25_000 });
  });

  // ── required mode, exemption, sandbox ──────────────────────────────────────

  it('required: a guest cannot confirm without paying; the exempt guest and the desk can', async () => {
    await setRules({ deposit_mode: 'required' });
    try {
      const guest = await guestClient(svc, 'dep-required');
      const id = await hold(guest);
      const q = await appRpc(guest, 'deposit_quote', { p_hold_id: id }).then(outcome);
      expect(q.data).toMatchObject({ deposit_mode: 'required' });
      const conf = await appRpc(guest, 'confirm_booking', { p_hold_id: id }).then(outcome);
      expect(conf.ok).toBe(false);
      expect(conf.errorMessage).toContain('DEPOSIT_REQUIRED');

      // The desk books for them without a deposit.
      const staffConf = await appRpc(desk, 'confirm_booking', { p_hold_id: id }).then(outcome);
      expect(staffConf.ok, staffConf.errorMessage).toBe(true);

      const friend = await guestClient(svc, 'dep-exempt');
      const flags = await appRpc(desk, 'set_customer_flags', {
        p_customer_id: await uidOf(friend), p_flags: [{ type: 'deposit_exempt', label: "owner's friend" }],
      }).then(outcome);
      expect(flags.ok, flags.errorMessage).toBe(true);
      const fid = await hold(friend);
      const fq = await appRpc(friend, 'deposit_quote', { p_hold_id: fid }).then(outcome);
      expect(fq.data).toMatchObject({ deposit_mode: 'optional' });
      const fconf = await appRpc(friend, 'confirm_booking', { p_hold_id: fid }).then(outcome);
      expect(fconf.ok, fconf.errorMessage).toBe(true);
    } finally {
      await setRules({ deposit_mode: 'optional' });
    }
  });

  it('the review account pays on the sandbox: stamped, and never counted as paid', async () => {
    const guest = await guestClient(svc, 'dep-sandbox');
    await svc.from('profiles').update({ payment_sandbox: true }).eq('id', await uidOf(guest));
    const id = await hold(guest);
    const a = await begin(guest, id);
    expect((await payment(a.id)).sandbox).toBe(true);
    await apply(a.request_id, 'SUCCESS');
    expect(await reservation(id)).toMatchObject({ kind: 'booking', status: 'confirmed' });
    const bill = await appRpc(desk, 'booking_bill', { p_reservation_id: id }).then(outcome);
    expect(bill.data).toMatchObject({ online_paid_iqd: 0, court_remaining_iqd: 40_000 });
  });

  // ── the reconciler ─────────────────────────────────────────────────────────

  it('the reconciler claims what is due once per lease: open past its deadline, and refunds', async () => {
    const guest = await guestClient(svc, 'dep-reconcile');
    const id = await hold(guest);
    const a = await begin(guest, id);
    await svc.from('booking_payments').update({ deadline_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', a.id);

    const refund = await paidBooking('dep-reconcile-refund');
    await appRpc(refund.guest, 'cancel_reservation', { p_reservation_id: refund.id });

    const due = await svcRpc('deposits_due_for_reconcile', { p_limit: 100 });
    expect(due.ok, due.errorMessage).toBe(true);
    const rows = due.data as Json[];
    expect(rows.find((r) => r.id === a.id)).toMatchObject({ action: 'check', request_id: a.request_id });
    expect(rows.find((r) => r.id === refund.pay.id)).toMatchObject({ action: 'refund', refund_amount_iqd: 20_000 });

    const second = await svcRpc('deposits_due_for_reconcile', { p_limit: 100 });
    expect((second.data as Json[]).map((r) => r.id)).not.toContain(a.id);

    // Three failed cancels at Qi give up; GIVE_UP expires it and frees the slot.
    for (let i = 1; i <= 3; i++) {
      expect((await svcRpc('deposit_note_cancel_attempt', { p_payment_id: a.id })).data).toBe(i);
    }
    const give = await svcRpc('deposit_apply', {
      p_request_id: a.request_id, p_provider_payment_id: null, p_provider_status: 'GIVE_UP',
      p_amount: null, p_currency: null, p_canceled: false, p_source: 'reconcile', p_signature_ok: null, p_raw: {},
    });
    expect(give.data).toMatchObject({ status: 'expired' });
    expect(await reservation(id)).toMatchObject({ status: 'expired' });
  });

  it('a canceled payment at Qi reads as expired, with failure_code cancelled', async () => {
    const guest = await guestClient(svc, 'dep-canceled');
    const id = await hold(guest);
    const a = await begin(guest, id);
    const res = await apply(a.request_id, 'CREATED', 20_000, { p_canceled: true, p_source: 'poll' });
    expect(res.data).toMatchObject({ status: 'expired' });
    expect((await payment(a.id)).failure_code).toBe('cancelled');
  });

  it('the event log is append-only', async () => {
    const { data } = await svc.from('booking_payment_events').select('id').limit(1).single();
    const upd = await svc.from('booking_payment_events').update({ note: 'x' }).eq('id', (data as Json).id);
    expect(upd.error?.message ?? '').toContain('append-only');
  });

  it('a guest cannot call the service functions', async () => {
    const guest = await guestClient(svc, 'dep-no-service');
    for (const [fn, args] of [
      ['deposit_prepare', { p_guest_id: crypto.randomUUID(), p_hold_id: crypto.randomUUID(), p_locale: 'en', p_provider: 'fake' }],
      ['deposit_apply', { p_request_id: crypto.randomUUID(), p_provider_payment_id: null, p_provider_status: 'SUCCESS', p_amount: 1, p_currency: 'IQD', p_canceled: false, p_source: 'webhook' }],
      ['deposits_due_for_reconcile', { p_limit: 1 }],
      ['deposit_refund_apply', { p_payment_id: crypto.randomUUID(), p_outcome: 'succeeded', p_provider_status: null, p_refund_provider_id: null }],
    ] as const) {
      const r = await guest.schema('app').rpc(fn, args as Json).then(outcome);
      expect(r.ok, fn).toBe(false);
    }
  });
});
