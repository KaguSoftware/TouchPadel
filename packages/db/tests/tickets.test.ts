/**
 * 0259 ticket_purchase — open-match tickets, the money side
 * (docs/design/open-matches/money.md §5, §9, §10; build contracts R3, R7, R8,
 * R13, R23, R25).
 *
 * Two harnesses, as the deposit and store suites:
 *   * the service client stands in for the edge functions (ticket-begin's
 *     prepare, deposit_apply from a webhook, a poll or the reconciler) and the
 *     staff and guests call their RPCs over HTTP, committed, exactly as the
 *     apps will; a ticket purchase made here is a real one, so the ledger
 *     invariants (T1–T12, assertTicketLedger) are checked after every case;
 *   * the states that need a match (a ticket in use, held by a request,
 *     forfeited) are planted in ONE rolled-back psql transaction
 *     (stores-harness scenario): nothing writes matches before 0260.
 *
 * Restorable (R13) is app.match_marks_open, lane DB's, from 0260. Until it
 * exists the scenario plants a stand-in with the same answers for its
 * fixtures (not sandbox, marked, day not closed), inside the rolled-back
 * transaction only; once 0260 lands the real one answers.
 *
 * Not here, because their other half does not exist yet: the join side of the
 * cash-out race is played by a raw psql session holding the ticket (0260's
 * ticket_pick takes the same lock); DF-20 "after the sweep" is
 * matches-sweep.test.ts's (0263, the chain-wide run), and the deletion's own
 * half matches-account-deletion.test.ts's (0264);
 * the tickets_refunded push row is asserted by Guest's suite with 0261
 * (match_notify); before it, a refund only loses its push.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEV_PINS,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
  appRpc,
  assertTicketLedger,
  createTestCourt,
  guestClient,
  serviceClient,
  shapedGuest,
  signedInClient,
  stackAvailable,
} from './helpers';
import { KEEP, MK, Q, T, X, dockerReachable, ok, psql, psqlSession, refused, scenario, waitForSleeper, type Results } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;
const TERMS = '2026-09-23';

/** An RPC result with the refusal's code and detail kept apart. */
interface Res {
  ok: boolean;
  code?: string;
  detail?: string | null;
  data?: unknown;
}
async function rpcOf(c: SupabaseClient, fn: string, args: Json): Promise<Res> {
  const { data, error } = await appRpc(c, fn, args);
  if (error) return { ok: false, code: error.message, detail: (error as { details?: string | null }).details ?? null };
  return { ok: true, data };
}

describe.skipIf(!up)('0259 open-match tickets', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let desk: SupabaseClient;
  let cashier: SupabaseClient;
  let savedEnabled: boolean;
  let savedPrice: number;
  const touched = new Set<string>();

  const svcRpc = (fn: string, args: Json) => rpcOf(svc, fn, args);

  const settings = async (patch: Json) => {
    const r = await rpcOf(owner, 'set_match_settings', { p_patch: patch, p_venue_id: VENUE_A_ID });
    expect(r.ok, r.code).toBe(true);
  };

  /** A guest who may buy: an account, a phone, the terms accepted. */
  const newGuest = async (tag: string, terms = true) => {
    const client = await guestClient(svc, tag);
    const { data } = await client.auth.getUser();
    const id = data.user!.id;
    if (terms) {
      const t = await rpcOf(client, 'accept_terms', { p_version: TERMS });
      expect(t.ok, t.code).toBe(true);
    }
    touched.add(id);
    return { client, id };
  };

  const prepare = (guestId: string | null, count: number | null, provider = 'fake') =>
    svcRpc('ticket_payment_prepare', { p_guest_id: guestId, p_count: count, p_locale: 'en', p_provider: provider });

  /** ticket-begin minus the gateway: prepare + deposit_mark_created. */
  const begin = async (guestId: string, count: number) => {
    const p = await prepare(guestId, count);
    expect(p.ok, `${p.code} ${p.detail}`).toBe(true);
    const row = p.data as { id: string; request_id: string; status: string; amount_iqd: number; reused: boolean };
    if (row.status === 'created') {
      const m = await svcRpc('deposit_mark_created', {
        p_request_id: row.request_id,
        p_provider_payment_id: `fake-${row.request_id}`,
        p_form_url: `http://127.0.0.1:54321/functions/v1/payments-fake?ref=${row.request_id}`,
        p_provider_status: 'CREATED',
        p_raw: {},
      });
      expect(m.ok, m.code).toBe(true);
    }
    return row;
  };

  const apply = (requestId: string, status: string, amount: number | null, extra: Json = {}) =>
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

  /** A paid purchase of `count` tickets (the fake bank says SUCCESS for the amount). */
  const buy = async (guestId: string, count: number) => {
    const row = await begin(guestId, count);
    const a = await apply(row.request_id, 'SUCCESS', row.amount_iqd);
    expect(a.ok, a.code).toBe(true);
    expect(a.data).toMatchObject({ status: 'succeeded', purpose: 'ticket', ticket_count: count, reservation_id: null });
    return row;
  };

  const payment = async (id: string) => {
    const { data } = await svc.from('booking_payments').select('*').eq('id', id).single();
    return data as Json;
  };
  const ticketsOf = async (guestId: string) => {
    const { data } = await svc.from('match_tickets').select('*').eq('guest_id', guestId).order('id');
    return (data ?? []) as Json[];
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    desk = await signedInClient(SEED_STAFF.court_desk);
    cashier = await signedInClient(SEED_STAFF.cashier);
    const s = await rpcOf(owner, 'match_settings', { p_venue_id: VENUE_A_ID });
    expect(s.ok, s.code).toBe(true);
    savedEnabled = (s.data as Json).matches_enabled as boolean;
    savedPrice = Number((s.data as Json).match_ticket_price_iqd);
    await settings({ matches_enabled: true, match_ticket_price_iqd: 10_000 });
  });

  afterAll(async () => {
    if (!owner || savedEnabled === undefined) return;
    await settings({ matches_enabled: savedEnabled, match_ticket_price_iqd: savedPrice });
  });

  // money.md §9: the ledger holds after every case, for every guest it touched.
  afterEach(async () => {
    for (const id of touched) expect(await assertTicketLedger(svc, id), `ledger of ${id}`).toEqual([]);
    touched.clear();
  });

  // ── prepare: every refusal, in order ──────────────────────────────────────

  it('prepare refuses in the contract order (money.md §5.2)', async () => {
    expect(await prepare(null, 1)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', detail: 'p_guest_id' });
    const g = await newGuest('tk-refuse');
    expect(await prepare(g.id, 1, 'visa')).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', detail: 'p_provider' });
    expect(await prepare(crypto.randomUUID(), 1)).toMatchObject({ ok: false, code: 'ACCOUNT_REQUIRED' });
    for (const n of [0, 4, null]) {
      expect(await prepare(g.id, n), String(n)).toMatchObject({ ok: false, code: 'TICKET_COUNT_INVALID', detail: 'p_count' });
    }

    // R10: switched off at every open branch stops new purchases; a bad count
    // is still judged first.
    await settings({ matches_enabled: false });
    try {
      expect(await prepare(g.id, 1)).toMatchObject({ ok: false, code: 'MATCHES_OFF' });
      expect(await prepare(g.id, 5)).toMatchObject({ ok: false, code: 'TICKET_COUNT_INVALID' });
    } finally {
      await settings({ matches_enabled: true });
    }

    // No phone (an Apple sign-up that never gave one) comes before the terms.
    const noPhone = await shapedGuest(svc, 'tk-nophone', { user_metadata: { full_name: 'No Phone' } });
    touched.add(noPhone.id);
    expect(await prepare(noPhone.id, 1)).toMatchObject({ ok: false, code: 'PHONE_REQUIRED' });

    const noTerms = await newGuest('tk-noterms', false);
    expect(await prepare(noTerms.id, 1)).toMatchObject({ ok: false, code: 'TERMS_REQUIRED' });
    // (A version below platform_settings.match_terms_version: the scenario
    // below pins prepare to app.match_terms_ok, the one definition.)

    const banned = await newGuest('tk-banned');
    const flag = await svc.from('customer_flags').insert({
      customer_id: banned.id, type: 'match_ban', label: 'conduct', created_by: SEED_STAFF_IDS.manager,
    });
    expect(flag.error?.message ?? null).toBeNull();
    expect(await prepare(banned.id, 1)).toMatchObject({ ok: false, code: 'MATCH_BANNED' });

    // Nothing was recorded for any refusal.
    const { data: rows } = await svc.from('booking_payments').select('id')
      .in('guest_id', [g.id, noPhone.id, noTerms.id, banned.id]);
    expect(rows ?? []).toHaveLength(0);
  });

  it('the wallet cap (MD-6): at most 3 × max_filling_matches_per_guest unused tickets', async () => {
    const g = await newGuest('tk-wallet');
    const bought = [await buy(g.id, 3), await buy(g.id, 3), await buy(g.id, 3)];
    expect(await prepare(g.id, 1)).toMatchObject({ ok: false, code: 'TICKET_COUNT_INVALID', detail: 'wallet_limit' });
    const w = await rpcOf(g.client, 'my_tickets', {});
    expect(w.data).toMatchObject({ available: 9, max_available: 9 });

    // A cash-out makes room again.
    const co = await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: bought[0]!.id });
    expect(co.ok, co.code).toBe(true);
    const again = await prepare(g.id, 3);
    expect(again.ok, again.code).toBe(true);
  });

  it('three failed or expired attempts in 24 hours refuse the next (MD-7); FAILED and EXPIRED leave no ticket', async () => {
    const g = await newGuest('tk-attempts');
    const a = await begin(g.id, 1);
    expect((await apply(a.request_id, 'FAILED', null)).data).toMatchObject({ status: 'failed' });
    const b = await begin(g.id, 1);
    expect(b.request_id).not.toBe(a.request_id);
    expect((await apply(b.request_id, 'EXPIRED', null)).data).toMatchObject({ status: 'expired' });
    const c = await begin(g.id, 2);
    expect((await apply(c.request_id, 'AUTHENTICATION_FAILED', null)).data).toMatchObject({ status: 'failed' });
    expect(await ticketsOf(g.id)).toHaveLength(0);

    const st = await rpcOf(g.client, 'deposit_status', { p_request_id: c.request_id });
    expect(st.data).toMatchObject({ purpose: 'ticket', status: 'failed', failure_code: 'auth_failed', attempts_left: 0 });
    expect(await prepare(g.id, 1)).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });
  });

  // ── the purchase ───────────────────────────────────────────────────────────

  it('SUCCESS creates the tickets at the unit price; a double tap and two taps at once get one attempt; a replay moves nothing', async () => {
    const g = await newGuest('tk-happy');
    const row = await begin(g.id, 2);
    expect(row).toMatchObject({ status: 'created', amount_iqd: 20_000, reused: false });
    expect(await payment(row.id)).toMatchObject({
      purpose: 'ticket', venue_id: null, hold_id: null, reservation_id: null, ticket_count: 2,
      quoted_price_iqd: 10_000, amount_iqd: 20_000, status: 'pending', sandbox: false,
    });

    // A double tap hands the live attempt back, whatever count it asks for.
    const again = await prepare(g.id, 3);
    expect(again.data).toMatchObject({ request_id: row.request_id, reused: true, ticket_count: 2, status: 'pending' });

    const a = await apply(row.request_id, 'SUCCESS', 20_000);
    expect(a.data).toMatchObject({ matched: true, status: 'succeeded', purpose: 'ticket', ticket_count: 2 });
    const t = await ticketsOf(g.id);
    expect(t).toHaveLength(2);
    for (const x of t) {
      expect(x).toMatchObject({ status: 'available', price_iqd: 10_000, sandbox: false, purchase_payment_id: row.id });
    }
    const { data: ev } = await svc.from('match_ticket_events').select('type, payment_id').eq('guest_id', g.id);
    expect(ev).toEqual([
      { type: 'bought', payment_id: row.id },
      { type: 'bought', payment_id: row.id },
    ]);

    // Replays (the webhook twice, a poll, a late non-terminal status) change nothing.
    expect((await apply(row.request_id, 'SUCCESS', 20_000)).data).toMatchObject({ status: 'succeeded' });
    expect((await apply(row.request_id, 'FORM_SHOWED', null, { p_source: 'poll' })).data).toMatchObject({ status: 'succeeded' });
    expect(await ticketsOf(g.id)).toHaveLength(2);

    // Two taps at the same moment: one row, the same attempt for both.
    const h = await newGuest('tk-race');
    const [x, y] = await Promise.all([prepare(h.id, 1), prepare(h.id, 2)]);
    expect(x.ok && y.ok, `${x.code} ${y.code}`).toBe(true);
    expect((x.data as Json).request_id).toBe((y.data as Json).request_id);
    expect([(x.data as Json).reused, (y.data as Json).reused].filter(Boolean)).toHaveLength(1);
    const { data: rows } = await svc.from('booking_payments').select('id').eq('guest_id', h.id);
    expect(rows ?? []).toHaveLength(1);
  });

  it('a late SUCCESS after expired or failed still creates the tickets (MD-2)', async () => {
    const g = await newGuest('tk-late');
    const a = await begin(g.id, 1);
    await apply(a.request_id, 'EXPIRED', null);
    expect(await ticketsOf(g.id)).toHaveLength(0);
    expect((await apply(a.request_id, 'SUCCESS', 10_000)).data).toMatchObject({ status: 'succeeded' });

    const b = await begin(g.id, 2);
    await apply(b.request_id, 'FAILED', null);
    expect((await apply(b.request_id, 'SUCCESS', 20_000)).data).toMatchObject({ status: 'succeeded' });
    expect((await ticketsOf(g.id)).map((t) => t.status)).toEqual(['available', 'available', 'available']);
    // Two attempts that both succeeded are two purchases, never duplicate_success.
    expect((await payment(a.id)).status).toBe('succeeded');
    expect((await payment(b.id)).status).toBe('succeeded');
  });

  it('SUCCESS for another amount or currency creates no ticket: the whole row is refunded', async () => {
    const g = await newGuest('tk-mismatch');
    const a = await begin(g.id, 2);
    expect((await apply(a.request_id, 'SUCCESS', 19_999)).data).toMatchObject({ status: 'refund_pending' });
    expect(await payment(a.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'amount_mismatch', refund_amount_iqd: 20_000 });
    const b = await begin(g.id, 1);
    expect((await apply(b.request_id, 'SUCCESS', 10_000, { p_currency: 'USD' })).data).toMatchObject({ status: 'refund_pending' });
    expect(await ticketsOf(g.id)).toHaveLength(0);
    const st = await rpcOf(g.client, 'deposit_status', { p_request_id: a.request_id });
    expect(st.data).toMatchObject({ status: 'refund_pending', refund_reason: 'amount_mismatch', tickets: { from_this_purchase: 0 } });
  });

  it('a payer who deleted the account while paying is refunded (situation 4); one hard-deleted gets no ticket at all', async () => {
    const g = await newGuest('tk-deleted-paying');
    const a = await begin(g.id, 2);
    const del = await rpcOf(g.client, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.ok, del.code).toBe(true);
    expect((await apply(a.request_id, 'SUCCESS', 20_000)).data).toMatchObject({ status: 'refund_pending' });
    expect(await payment(a.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'account_deleted', refund_amount_iqd: 20_000 });
    const t = await ticketsOf(g.id);
    expect(t.map((x) => x.status)).toEqual(['cashed_out', 'cashed_out']);
    // A deleted account buys nothing more.
    expect(await prepare(g.id, 1)).toMatchObject({ ok: false, code: 'ACCOUNT_REQUIRED' });

    // An admin hard delete drops the profile (guest_id SET NULL): nobody to
    // hold a ticket, so the money goes straight back.
    const h = await newGuest('tk-gone');
    touched.delete(h.id);
    const b = await begin(h.id, 1);
    const gone = await svc.auth.admin.deleteUser(h.id);
    expect(gone.error).toBeNull();
    expect(await payment(b.id)).toMatchObject({ guest_id: null });
    expect((await apply(b.request_id, 'SUCCESS', 10_000)).data).toMatchObject({ status: 'refund_pending' });
    expect(await payment(b.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'account_deleted' });
    const { data: none } = await svc.from('match_tickets').select('id').eq('purchase_payment_id', b.id);
    expect(none ?? []).toHaveLength(0);
  });

  // ── reads ──────────────────────────────────────────────────────────────────

  it('deposit_status: the ticket shape for its guest; staff and other guests read PAYMENT_NOT_FOUND', async () => {
    const g = await newGuest('tk-status');
    const row = await buy(g.id, 2);
    const st = await rpcOf(g.client, 'deposit_status', { p_request_id: row.request_id });
    expect(st.ok, st.code).toBe(true);
    expect(st.data).toMatchObject({
      request_id: row.request_id, purpose: 'ticket', status: 'succeeded', failure_code: null,
      amount_iqd: 20_000, ticket_count: 2, unit_price_iqd: 10_000, price_iqd: 20_000, rest_iqd: 0,
      form_url: null, refund_reason: null, sandbox: false, deposit_mode: null, attempts_left: 3,
      hold_live: false, reservation: null,
      tickets: { from_this_purchase: 2, available: 2, reserved: 0, in_use: 0 },
    });
    // Staff read tickets through guest_tickets, never by the ref (its branch is NULL).
    for (const staff of [desk, manager, owner]) {
      expect(await rpcOf(staff, 'deposit_status', { p_request_id: row.request_id })).toMatchObject({
        ok: false, code: 'PAYMENT_NOT_FOUND',
      });
    }
    const other = await newGuest('tk-status-other');
    expect(await rpcOf(other.client, 'deposit_status', { p_request_id: row.request_id })).toMatchObject({
      ok: false, code: 'PAYMENT_NOT_FOUND',
    });
  });

  it('my_tickets (the phone) and guest_tickets (the desk) read one wallet', async () => {
    const g = await newGuest('tk-wallet-read');
    const bought = await buy(g.id, 2);
    const live = await begin(g.id, 1); // a purchase in progress

    const mine = await rpcOf(g.client, 'my_tickets', {});
    expect(mine.ok, mine.code).toBe(true);
    const w = mine.data as Json;
    expect(w).toMatchObject({
      price_iqd: 10_000, max_available: 9, sandbox: false, available: 2, reserved: 0, in_use: 0,
      pending: { request_id: live.request_id, status: 'pending', ticket_count: 1, amount_iqd: 10_000 },
    });
    expect((w.pending as Json).form_url).toMatch(/payments-fake/);
    expect(w.tickets).toHaveLength(2);
    expect((w.tickets as Json[])[0]).toMatchObject({
      status: 'available', price_iqd: 10_000, sandbox: false, purchase_payment_id: bought.id, match: null,
      forfeited_at: null, cashed_out_at: null,
    });
    expect(w.purchases).toEqual([
      expect.objectContaining({
        payment_id: bought.id, request_id: bought.request_id, status: 'succeeded', ticket_count: 2,
        unit_price_iqd: 10_000, amount_iqd: 20_000, refund_reason: null, sandbox: false,
      }),
    ]);
    expect(Object.keys(w).sort()).toEqual([
      'available', 'in_use', 'max_available', 'pending', 'price_iqd', 'purchases', 'reserved', 'sandbox',
      'server_now', 'tickets',
    ]);

    const d = await rpcOf(desk, 'guest_tickets', { p_customer_id: g.id });
    expect(d.ok, d.code).toBe(true);
    const s = d.data as Json;
    expect(s).toMatchObject({ customer_id: g.id, available: 2, forfeited: 0, cashed_out: 0 });
    expect(s.pending).not.toHaveProperty('form_url');
    expect((s.tickets as Json[])[0]).toHaveProperty('forfeited_venue_id', null);
    expect((s.purchases as Json[])[0]).toMatchObject({
      payment_id: bought.id,
      tickets: { available: 2, reserved: 0, in_use: 0, forfeited: 0, cashed_out: 0 },
      cashout: { allowed: true, reason: null, tickets: 2, amount_iqd: 20_000, until_at: null },
    });
    // The desk's wallet is the phone's plus the desk fields, never different.
    for (const k of ['price_iqd', 'max_available', 'available', 'reserved', 'in_use']) expect(s[k]).toEqual(w[k]);

    expect(await rpcOf(g.client, 'guest_tickets', { p_customer_id: g.id })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await rpcOf(cashier, 'guest_tickets', { p_customer_id: g.id })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await rpcOf(desk, 'guest_tickets', { p_customer_id: crypto.randomUUID() })).toMatchObject({
      ok: false, code: 'CUSTOMER_NOT_FOUND',
    });
  });

  // ── cash-out ───────────────────────────────────────────────────────────────

  it('cash-out: every unused ticket, one refund of the price paid; a second press is a duplicate', async () => {
    const g = await newGuest('tk-cashout');
    const row = await buy(g.id, 2);

    expect(await rpcOf(desk, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: row.id })).toMatchObject({
      ok: false, code: 'FORBIDDEN',
    });
    expect(await rpcOf(manager, 'ticket_cashout', { p_customer_id: null, p_purchase_payment_id: row.id })).toMatchObject({
      ok: false, code: 'INVALID_ARGUMENT', detail: 'p_customer_id',
    });
    const other = await newGuest('tk-cashout-other');
    expect(await rpcOf(manager, 'ticket_cashout', { p_customer_id: other.id, p_purchase_payment_id: row.id })).toMatchObject({
      ok: false, code: 'PAYMENT_NOT_FOUND',
    });

    const co = await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: row.id });
    expect(co.ok, co.code).toBe(true);
    expect(co.data).toEqual({
      duplicate: false, payment_id: row.id, tickets_cashed_out: 2, refund_amount_iqd: 20_000, status: 'refund_pending',
    });
    expect(await payment(row.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'ticket_cashout', refund_amount_iqd: 20_000 });
    for (const t of await ticketsOf(g.id)) {
      expect(t).toMatchObject({ status: 'cashed_out', cashout_payment_id: row.id });
      expect(t.cashed_out_at).not.toBeNull();
    }
    const { data: ev } = await svc.from('match_ticket_events').select('type, code, actor_staff_id, payment_id, venue_id')
      .eq('guest_id', g.id).eq('type', 'cashed_out');
    expect(ev).toHaveLength(2);
    for (const e of ev ?? []) {
      expect(e).toMatchObject({ code: 'ticket_cashout', actor_staff_id: SEED_STAFF_IDS.manager, payment_id: row.id, venue_id: VENUE_A_ID });
    }
    const { data: audit } = await svc.from('audit_log').select('after').eq('action', 'ticket.cashout').eq('entity_id', row.id);
    expect(audit).toHaveLength(1);
    expect((audit![0] as Json).after).toMatchObject({ customer_id: g.id, payment_id: row.id, tickets: 2, amount_iqd: 20_000 });

    const dup = await rpcOf(owner, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: row.id });
    expect(dup.data).toEqual({
      duplicate: true, payment_id: row.id, tickets_cashed_out: 2, refund_amount_iqd: 20_000, status: 'refund_pending',
    });
    const s = (await rpcOf(desk, 'guest_tickets', { p_customer_id: g.id })).data as Json;
    expect((s.purchases as Json[])[0]).toMatchObject({ cashout: { allowed: false, reason: 'done' } });
    expect(s).toMatchObject({ available: 0, cashed_out: 2 });

    // A purchase refunded as someone else's money is not cashed out again.
    const m = await begin(g.id, 1);
    await apply(m.request_id, 'SUCCESS', 1);
    expect(await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: m.id })).toMatchObject({
      ok: false, code: 'PAYMENT_STATE', detail: 'refund_pending',
    });
  });

  it('DF-21: a price change never touches bought tickets; cash-out returns the price paid', async () => {
    const g = await newGuest('tk-price');
    const old = await buy(g.id, 1);
    await settings({ match_ticket_price_iqd: 12_500 });
    try {
      const fresh = await buy(g.id, 2);
      expect(await payment(fresh.id)).toMatchObject({ quoted_price_iqd: 12_500, amount_iqd: 25_000 });
      const w = (await rpcOf(g.client, 'my_tickets', {})).data as Json;
      expect(w.price_iqd).toBe(12_500);
      expect((w.tickets as Json[]).map((t) => t.price_iqd)).toEqual(expect.arrayContaining([10_000, 12_500, 12_500]));
      const co = await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: old.id });
      expect(co.data).toMatchObject({ refund_amount_iqd: 10_000, tickets_cashed_out: 1 });
    } finally {
      await settings({ match_ticket_price_iqd: 10_000 });
    }
  });

  // ── refunds of a purchase ──────────────────────────────────────────────────

  it('refunds: Qi says yes → refunded; no → refund_failed at every branch, retried, settled by hand only from refund_failed', async () => {
    const g = await newGuest('tk-refund');
    const one = await buy(g.id, 1);
    const two = await buy(g.id, 1);

    // A purchase goes back only by a cash-out.
    expect(await rpcOf(manager, 'deposit_refund_request', { p_payment_id: one.id })).toMatchObject({
      ok: false, code: 'PAYMENT_STATE', detail: 'ticket',
    });

    await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: one.id });
    const yes = await svcRpc('deposit_refund_apply', {
      p_payment_id: one.id, p_outcome: 'succeeded', p_provider_status: 'SUCCESS', p_refund_provider_id: 'rf-t1', p_raw: {},
    });
    // Before 0261 there is no match_notify: the push is lost, the money write is not.
    expect(yes.ok, yes.code).toBe(true);
    expect(yes.data).toMatchObject({ status: 'refunded', changed: true });
    expect(await payment(one.id)).toMatchObject({ status: 'refunded', refund_provider_id: 'rf-t1' });
    const { data: audit } = await svc.from('audit_log').select('action').eq('entity_id', one.id).eq('action', 'ticket.refunded');
    expect(audit).toHaveLength(1);

    await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: two.id });
    await svcRpc('deposit_refund_apply', {
      p_payment_id: two.id, p_outcome: 'failed', p_provider_status: '18', p_refund_provider_id: null, p_raw: {},
    });
    expect((await payment(two.id)).status).toBe('refund_failed');
    const list = await rpcOf(manager, 'deposit_attention', { p_venue_id: VENUE_A_ID });
    expect((list.data as Json[]).find((i) => i.id === two.id)).toMatchObject({
      purpose: 'ticket', ticket_count: 1, customer_id: g.id, status: 'refund_failed', reservation_id: null,
    });

    expect((await rpcOf(manager, 'deposit_refund_retry', { p_payment_id: two.id })).data).toMatchObject({ status: 'refund_pending' });
    // R23: never while Qi may still pay it.
    expect(await rpcOf(manager, 'deposit_refund_manual', {
      p_payment_id: two.id, p_pin: DEV_PINS.manager, p_note: 'cash at the desk',
    })).toMatchObject({ ok: false, code: 'PAYMENT_STATE', detail: 'refund_pending' });
    await svcRpc('deposit_refund_apply', {
      p_payment_id: two.id, p_outcome: 'failed', p_provider_status: '18', p_refund_provider_id: null, p_raw: {},
    });
    const manual = await rpcOf(manager, 'deposit_refund_manual', {
      p_payment_id: two.id, p_pin: DEV_PINS.manager, p_note: 'cash at the desk',
    });
    expect(manual.ok, manual.code).toBe(true);
    expect(await payment(two.id)).toMatchObject({ status: 'refunded', refund_reason: 'ticket_cashout', refund_note: 'cash at the desk' });
    // The tickets stay cashed out in every case.
    expect((await ticketsOf(g.id)).map((t) => t.status)).toEqual(['cashed_out', 'cashed_out']);
  });

  // ── DF-20 ──────────────────────────────────────────────────────────────────

  it.skipIf(!docker)('DF-20: a deleted guest\'s unused tickets are refunded, one refund per purchase; a held ticket waits for the next call', async () => {
    const g = await newGuest('tk-df20');
    const a = await buy(g.id, 2);
    const b = await buy(g.id, 1);
    const live = await begin(g.id, 1); // still paying: caught at its SUCCESS instead

    // Another body holds one of a's tickets (0260's pick takes the same lock).
    const [held] = (await ticketsOf(g.id)).filter((t) => t.purchase_payment_id === a.id);
    const session = psqlSession(`set application_name = 'tk-df20-held';
begin;
select 1 from match_tickets where id = '${held!.id}' for update;
select pg_sleep(6);
rollback;`);
    await waitForSleeper('tk-df20-held');
    // The deletion refunds at once (0264): b only; a is left for the next call, without
    // waiting. The 30-second sweep (0263, tp_match_sweep) runs the same refunds
    // chain-wide, so once the lock is gone it may take a first: the counts are 0 or 1,
    // the payments say who is refunded.
    const del = await rpcOf(g.client, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.ok, del.code).toBe(true);
    const first = await svcRpc('ticket_refund_deleted', { p_guest_id: g.id });
    expect(first.data).toBe(0); // a is still held, b is done
    expect((await payment(a.id)).status).toBe('succeeded');
    expect(await payment(b.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'account_deleted', refund_amount_iqd: 10_000 });
    await session;

    const second = await svcRpc('ticket_refund_deleted', { p_guest_id: g.id });
    expect([0, 1]).toContain(second.data);
    expect(await payment(a.id)).toMatchObject({ status: 'refund_pending', refund_reason: 'account_deleted', refund_amount_iqd: 20_000 });
    expect((await payment(live.id)).status).toBe('pending'); // never in the queue (R13)
    expect((await svcRpc('ticket_refund_deleted', { p_guest_id: g.id })).data).toBe(0);
    expect((await svcRpc('ticket_refund_deleted', {})).ok).toBe(true);

    const { data: ev } = await svc.from('match_ticket_events').select('code, actor_staff_id, venue_id')
      .eq('guest_id', g.id).eq('type', 'cashed_out');
    expect(ev).toHaveLength(3);
    for (const e of ev ?? []) expect(e).toEqual({ code: 'account_deleted', actor_staff_id: null, venue_id: null });

    // Its late SUCCESS: tickets created and cashed straight out.
    expect((await apply(live.request_id, 'SUCCESS', 10_000)).data).toMatchObject({ status: 'refund_pending' });
    expect(await payment(live.id)).toMatchObject({ refund_reason: 'account_deleted' });
  }, 30_000);

  // ── sandbox ────────────────────────────────────────────────────────────────

  it('sandbox (DF-19): the review account\'s tickets carry the flag; the flip is refused while tickets or an attempt are live (C20)', async () => {
    const g = await newGuest('tk-sandbox');
    expect((await svc.from('profiles').update({ payment_sandbox: true }).eq('id', g.id)).error).toBeNull();
    const row = await buy(g.id, 1);
    expect(await payment(row.id)).toMatchObject({ sandbox: true });
    expect((await ticketsOf(g.id))[0]).toMatchObject({ sandbox: true });
    expect(((await rpcOf(g.client, 'my_tickets', {})).data as Json).sandbox).toBe(true);

    const flip = await svc.from('profiles').update({ payment_sandbox: false }).eq('id', g.id);
    expect(flip.error?.message).toBe('INVALID_TRANSITION');
    expect((flip.error as { details?: string } | null)?.details).toBe('live_tickets');

    await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: row.id });
    // A live attempt holds the flag too.
    await begin(g.id, 1);
    expect((await svc.from('profiles').update({ payment_sandbox: false }).eq('id', g.id)).error?.message).toBe('INVALID_TRANSITION');

    // Nothing live on a fresh profile: the flag moves freely.
    const h = await newGuest('tk-sandbox-free');
    expect((await svc.from('profiles').update({ payment_sandbox: true }).eq('id', h.id)).error).toBeNull();
    expect((await svc.from('profiles').update({ payment_sandbox: false }).eq('id', h.id)).error).toBeNull();
  });

  // ── walls ──────────────────────────────────────────────────────────────────

  it('a guest cannot read the ticket tables or call the service functions', async () => {
    const g = await newGuest('tk-walls');
    const row = await buy(g.id, 1);
    for (const table of ['match_tickets', 'match_ticket_events']) {
      const r = await g.client.from(table).select('id');
      expect(r.error?.message ?? '', table).toMatch(/permission denied/);
    }
    const bp = await g.client.from('booking_payments').select('id');
    expect(bp.data ?? []).toHaveLength(0);
    for (const [fn, args] of [
      ['ticket_payment_prepare', { p_guest_id: g.id, p_count: 1, p_locale: 'en', p_provider: 'fake' }],
      ['ticket_settle_success', { p_payment_id: row.id }],
      ['tickets_cash_out', { p_payment_id: row.id, p_reason: 'ticket_cashout', p_staff_id: null }],
      ['ticket_refund_deleted', { p_guest_id: g.id }],
      ['ticket_wallet', { p_guest_id: g.id, p_staff: true }],
      ['ticket_cashout_block', { p_payment_id: row.id }],
      ['ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: row.id }],
    ] as const) {
      const r = await rpcOf(g.client, fn, args as Json);
      expect(r.ok, fn).toBe(false);
    }
    expect((await ticketsOf(g.id)).map((t) => t.status)).toEqual(['available']);
  });

  // ── the cash-out racing a join (conc-D17, C15) ─────────────────────────────

  it.skipIf(!docker)('a cash-out racing a join never lets both happen: the cash-out waits and sees the ticket in use', async () => {
    const g = await newGuest('tk-race-join');
    const row = await buy(g.id, 1);
    const [ticket] = await ticketsOf(g.id);
    const court = await createTestCourt(svc, 'M258 race');
    const matchId = crypto.randomUUID();
    const seatId = crypto.randomUUID();
    const token = crypto.randomUUID().replaceAll('-', '').slice(0, 22);
    // The join: the ticket locked first (as 0260's ticket_pick does), then a
    // seat and the move to in_use, committed three seconds later.
    const join = psqlSession(`set application_name = 'tk-cashout-join';
begin;
select set_config('request.jwt.claims', '', true);
select 1 from match_tickets where id = '${ticket!.id}' and status = 'available' for update;
insert into matches (id, venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                     price_iqd, shares_iqd, price_court_id, fill_deadline_at, share_token, organiser_id, organised_by)
values ('${matchId}', '${VENUE_A_ID}', 'filling', date_trunc('hour', now()) + interval '5 days',
        date_trunc('hour', now()) + interval '5 days 90 minutes', 90, 'public', 'open', 'open',
        40000, '{10000,10000,10000,10000}', '${court}', date_trunc('hour', now()) + interval '4 days',
        '${token}', '${g.id}', 'guest');
insert into match_seats (id, venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd)
values ('${seatId}', '${VENUE_A_ID}', '${matchId}', 1, 'account', '${g.id}', '${ticket!.id}', 10000);
update match_tickets set status = 'in_use', seat_id = '${seatId}', updated_at = now() where id = '${ticket!.id}';
select pg_sleep(3);
commit;`);
    await waitForSleeper('tk-cashout-join');
    const co = await rpcOf(manager, 'ticket_cashout', { p_customer_id: g.id, p_purchase_payment_id: row.id });
    await join;
    try {
      expect(co).toMatchObject({ ok: false, code: 'TICKET_IN_USE' });
      expect(JSON.parse(String(co.detail))).toMatchObject({ reason: 'in_use', count: 1 });
      expect((await payment(row.id)).status).toBe('succeeded');
      expect((await ticketsOf(g.id))[0]).toMatchObject({ status: 'in_use', seat_id: seatId });
    } finally {
      // The stand-in join wrote no events: put the ticket back as it was.
      psql(`select set_config('request.jwt.claims', '', false);
update match_tickets set status = 'available', seat_id = null where id = '${ticket!.id}';
delete from match_seats where id = '${seatId}';
delete from matches where id = '${matchId}';`);
    }
  }, 30_000);
});

// ── the cash-out rule (R13) with matches, in one rolled-back transaction ──────

/** Planting helpers (the 0258 suite's), and 0260's marks window stood in for. */
const SETUP = String.raw`
create function pg_temp.m(p jsonb default '{}') returns uuid language plpgsql as $f$
declare
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days';
  r matches;
  v uuid;
begin
  r := jsonb_populate_record(null::matches, jsonb_build_object(
         'venue_id', pg_temp.var('venue'), 'status', 'filling',
         'start_at', v_start, 'end_at', v_start + interval '90 minutes', 'duration_min', 90,
         'visibility', 'public', 'join_policy', 'open', 'category', 'open',
         'price_iqd', 40000, 'shares_iqd', jsonb_build_array(10000, 10000, 10000, 10000),
         'price_court_id', pg_temp.var('court'), 'fill_deadline_at', v_start - interval '2 hours',
         'share_token', substr(md5(random()::text), 1, 22), 'organiser_id', pg_temp.var('g1'),
         'organised_by', 'guest', 'sandbox', false) || p);
  insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                       price_iqd, shares_iqd, price_court_id, fill_deadline_at, share_token, organiser_id,
                       organised_by, reservation_id, sandbox, ended_at, ended_reason)
  values (r.venue_id, r.status, r.start_at, r.end_at, r.duration_min, r.visibility, r.join_policy, r.category,
          r.price_iqd, r.shares_iqd, r.price_court_id, r.fill_deadline_at, r.share_token, r.organiser_id,
          r.organised_by, r.reservation_id, r.sandbox, r.ended_at, r.ended_reason)
  returning id into v;
  return v;
end $f$;

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

-- A ticket purchase as 0259 records it (venue NULL), and its tickets.
create function pg_temp.p(p jsonb default '{}') returns uuid language plpgsql as $f$
declare r booking_payments; v uuid;
begin
  r := jsonb_populate_record(null::booking_payments, jsonb_build_object(
         'purpose', 'ticket', 'provider', 'fake', 'sandbox', false, 'request_id', gen_random_uuid(),
         'amount_iqd', 20000, 'quoted_price_iqd', 10000, 'ticket_count', 2, 'status', 'succeeded',
         'succeeded_at', now(), 'deadline_at', now() + interval '15 minutes') || p);
  insert into booking_payments (venue_id, reservation_id, hold_id, guest_id, purpose, provider, sandbox, request_id,
                                amount_iqd, quoted_price_iqd, ticket_count, status, succeeded_at, deadline_at,
                                refund_reason, refund_amount_iqd, refund_requested_at)
  values (null, null, null, r.guest_id, r.purpose, r.provider, r.sandbox, r.request_id,
          r.amount_iqd, r.quoted_price_iqd, r.ticket_count, r.status, r.succeeded_at, r.deadline_at,
          r.refund_reason, r.refund_amount_iqd, r.refund_requested_at)
  returning id into v;
  return v;
end $f$;

create function pg_temp.tk(p_pay text, p_guest text) returns uuid language sql as $f$
  insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox)
  values (pg_temp.var(p_guest)::uuid, 'available', 10000, pg_temp.var(p_pay)::uuid, false)
  returning id
$f$;

-- An account seat carrying a ticket.
create function pg_temp.seat(p_match text, p_guest text, p_ticket text, p_status text) returns uuid
language sql as $f$
  insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, ticket_id, share_iqd, status, marked_at)
  values (pg_temp.var('venue')::uuid, pg_temp.var(p_match)::uuid, 1, 'account', pg_temp.var(p_guest)::uuid,
          pg_temp.var(p_ticket)::uuid, 10000, p_status,
          case when p_status in ('attended', 'no_show') then now() end)
  returning id
$f$;

-- prepare with a given terms version; NULL when TERMS_REQUIRED refused it.
create function pg_temp.try_prepare(p_guest uuid, p_version text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  update profiles set terms_version = p_version where id = p_guest;
  begin
    v := app.ticket_payment_prepare(p_guest, 1, 'en', 'fake');
  exception when others then
    if sqlerrm <> 'TERMS_REQUIRED' then raise; end if;
    return null;
  end;
  -- End the attempt (the scenario rolls it back anyway) so the next version is
  -- judged afresh rather than handed back as the live one.
  update booking_payments set status = 'expired', expired_at = now() where id = (v->>'id')::uuid;
  return v;
end $f$;

do $stub$
begin
  if to_regprocedure('app.match_marks_open(uuid)') is null then
    execute $d$
      create function app.match_marks_open(p_match_id uuid) returns boolean
      language sql stable security definer set search_path = public as $b$
        select coalesce((select not m.sandbox and m.status in ('booked', 'played', 'no_show')
                                and m.start_at > now() - interval '1 day'
                           from matches m where m.id = p_match_id), false)
      $b$ $d$;
  end if;
end $stub$;
`;

const GUEST = (name: string) =>
  KEEP(name, `insert into auth.users (id, email, raw_user_meta_data, aud, role)
              values (gen_random_uuid(), 'm258-${name}-' || gen_random_uuid() || '@test.touch.local',
                      '{"full_name":"Test ${name}"}', 'authenticated', 'authenticated') returning id`);

describe.skipIf(!docker)('0259 the cash-out rule (R13) and the wallet with matches', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('m258', [
      SETUP,
      GUEST('g1'), GUEST('g2'), GUEST('g3'), GUEST('g4'), GUEST('g5'),
      KEEP('court', `insert into courts (name_en, name_ar, venue_id) values ('M258 court', 'ملعب ٢٥٨', {{venue}}) returning id`),
      // m1 filling; m3 booked (a court booking); m4 a review-account match, played.
      KEEP('m1', `select pg_temp.m()`),
      KEEP('res3', `insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source)
                    values ({{venue}}, {{court}}, 'booking', 'confirmed', date_trunc('hour', now()) + interval '3 days',
                            date_trunc('hour', now()) + interval '3 days 90 minutes', 'Open match', 'desk') returning id`),
      KEEP('m3', `select pg_temp.m(jsonb_build_object('status', 'booked', 'reservation_id', {{res3}}))`),
      KEEP('m4', `select pg_temp.m(jsonb_build_object('status', 'played', 'sandbox', true, 'ended_at', now()))`),

      // A (g1): one ticket in m1, one unused.
      KEEP('pa', `select pg_temp.p(jsonb_build_object('guest_id', {{g1}}))`),
      KEEP('ta1', `select pg_temp.tk('pa', 'g1')`),
      KEEP('ta2', `select pg_temp.tk('pa', 'g1')`),
      KEEP('sa1', `select pg_temp.seat('m1', 'g1', 'ta1', 'in')`),
      X(`update match_tickets set status = 'in_use', seat_id = {{sa1}} where id = {{ta1}}`),
      // B (g2): its only ticket held by a pending request on m1.
      KEEP('pb', `select pg_temp.p(jsonb_build_object('guest_id', {{g2}}, 'ticket_count', 1, 'amount_iqd', 10000))`),
      KEEP('tb1', `select pg_temp.tk('pb', 'g2')`),
      KEEP('rq', `insert into match_requests (venue_id, match_id, guest_id, seats_requested) values ({{venue}}, {{m1}}, {{g2}}, 1) returning id`),
      X(`update match_tickets set status = 'reserved', request_id = {{rq}} where id = {{tb1}}`),
      // C (g3): a no-show in booked m3 (its day still open: restorable), one unused.
      KEEP('pc', `select pg_temp.p(jsonb_build_object('guest_id', {{g3}}))`),
      KEEP('tc1', `select pg_temp.tk('pc', 'g3')`),
      KEEP('tc2', `select pg_temp.tk('pc', 'g3')`),
      KEEP('sc1', `select pg_temp.seat('m3', 'g3', 'tc1', 'no_show')`),
      X(`update match_tickets set status = 'forfeited', forfeited_at = now(), forfeited_venue_id = {{venue}},
                                  forfeited_seat_id = {{sc1}} where id = {{tc1}}`),
      // D (g4): its only ticket forfeited for good (the marks window is shut).
      KEEP('pd', `select pg_temp.p(jsonb_build_object('guest_id', {{g4}}, 'ticket_count', 1, 'amount_iqd', 10000))`),
      KEEP('td1', `select pg_temp.tk('pd', 'g4')`),
      KEEP('sd1', `select pg_temp.seat('m4', 'g4', 'td1', 'no_show')`),
      X(`update match_tickets set status = 'forfeited', forfeited_at = now(), forfeited_venue_id = {{venue}},
                                  forfeited_seat_id = {{sd1}} where id = {{td1}}`),
      // E (g5): Qi paid the wrong amount; refunded, no tickets.
      KEEP('pe', `select pg_temp.p(jsonb_build_object('guest_id', {{g5}}, 'status', 'refund_pending',
                                                      'refund_reason', 'amount_mismatch', 'refund_amount_iqd', 20000,
                                                      'refund_requested_at', now()))`),
      Q('times', `select jsonb_build_object(
                    'm1_end', (select end_at + interval '3 hours' from matches where id = {{m1}}),
                    'm1_deadline', (select fill_deadline_at from matches where id = {{m1}}),
                    'm3_end', (select end_at + interval '3 hours' from matches where id = {{m3}}))`),

      // The desk's view and the manager's cash-out, per purchase.
      T('co_a', 'manager', `select app.ticket_cashout({{g1}}, {{pa}})`),
      T('co_b', 'manager', `select app.ticket_cashout({{g2}}, {{pb}})`),
      T('co_c', 'owner', `select app.ticket_cashout({{g3}}, {{pc}})`),
      T('co_d', 'manager', `select app.ticket_cashout({{g4}}, {{pd}})`),
      T('co_e', 'manager', `select app.ticket_cashout({{g5}}, {{pe}})`),
      T('gt_a', 'desk', `select app.guest_tickets({{g1}})`),
      T('gt_b', 'desk', `select app.guest_tickets({{g2}})`),
      T('gt_c', 'manager', `select app.guest_tickets({{g3}})`),
      T('gt_d', 'desk', `select app.guest_tickets({{g4}})`),
      T('gt_e', 'desk', `select app.guest_tickets({{g5}})`),
      T('my_a', 'g1', `select app.my_tickets()`),
      T('my_c', 'g3', `select app.my_tickets()`),
      Q('pa_after', `select to_jsonb(status) from booking_payments where id = {{pa}}`),

      // DF-20 skips a purchase that is blocked, and takes it once it is free.
      X(`update profiles set deleted_at = now() where id in ({{g1}}, {{g3}})`),
      Q('rd_blocked', `select to_jsonb(app.ticket_refund_deleted({{g1}}) + app.ticket_refund_deleted({{g3}}))`),
      X(`update match_tickets set status = 'available', seat_id = null where id = {{ta1}}`),
      X(`update match_seats set status = 'left', ended_at = now(), end_reason = 'left' where id = {{sa1}}`),
      Q('rd_free', `select to_jsonb(app.ticket_refund_deleted({{g1}}))`),
      Q('pa_refund', `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
                        from booking_payments where id = {{pa}}`),
      Q('pc_after', `select to_jsonb(status) from booking_payments where id = {{pc}}`),

      // A ticket refund that failed is every branch's to settle: a manager of
      // another (preparing) branch sees it and retries it.
      KEEP('v2', `insert into venues (slug, name_en, name_ar, is_active, status)
                  values ('m258-branch-two', 'M258 Two', 'فرع ٢٥٨', false, 'preparing') returning id`),
      MK('mgr2', 'manager'),
      X(`update staff_venues set venue_id = {{v2}} where staff_id = {{mgr2}}`),
      KEEP('pf', `select pg_temp.p(jsonb_build_object('guest_id', {{g5}}, 'status', 'refund_failed',
                                                      'refund_reason', 'ticket_cashout', 'refund_amount_iqd', 20000,
                                                      'refund_requested_at', now() - interval '1 day'))`),
      T('att_a', 'manager', `select app.deposit_attention({{venue}})`),
      T('att_v2', 'mgr2', `select app.deposit_attention({{v2}})`),
      T('retry_v2', 'mgr2', `select app.deposit_refund_retry({{pf}})`),
      Q('ids', `select jsonb_build_object('pa', {{pa}}, 'pc', {{pc}}, 'pf', {{pf}}, 'm1', {{m1}}, 'm3', {{m3}}, 'g1', {{g1}})`),

      // The terms test is app.match_terms_ok (0257), the one definition
      // match_eligibility (0260) reads too: prepare refuses exactly when it is
      // false (a version compared as (date, revision), .10 above .9).
      X(`update venue_settings set matches_enabled = true where venue_id = {{venue}}`),
      X(`update platform_settings set match_terms_version = '2026-10-01.9' where id`),
      X(`update profiles set phone = '+9647700000000' where id = {{g2}}`),
      Q('terms', `select jsonb_agg(jsonb_build_object(
                    'v', v, 'ok', app.match_terms_ok(v),
                    'prepare', (select case when x is null then 'refused' else 'ok' end
                                  from (select pg_temp.try_prepare({{g2}}, v) as x) y)) order by v)
                    from unnest(array['2026-09-23', '2026-10-01', '2026-10-01.9', '2026-10-01.10']) v`),
    ]);
  });

  const block = (label: string) => {
    const o = r[label]!;
    expect(o.ok, `${label} should be refused`).toBe(false);
    expect(o.code).toBe('TICKET_IN_USE');
    return JSON.parse(String(o.detail)) as { reason: string; count: number; until_at: string | null };
  };
  const at = (v: unknown) => new Date(String(v)).getTime();
  const purchase = (label: string) => (ok<Json>(r, label).purchases as Json[])[0]!;

  it('TICKET_IN_USE says what blocks and until when: in use, reserved, restorable (R13)', () => {
    const times = ok<Json>(r, 'times');
    const a = block('co_a');
    expect(a).toMatchObject({ reason: 'in_use', count: 1 });
    expect(at(a.until_at)).toBe(at(times.m1_end));
    const b = block('co_b');
    expect(b).toMatchObject({ reason: 'reserved', count: 1 });
    expect(at(b.until_at)).toBe(at(times.m1_deadline));
    const c = block('co_c');
    expect(c).toMatchObject({ reason: 'restorable', count: 1 });
    expect(at(c.until_at)).toBe(at(times.m3_end));
    // Nothing moved on a refusal.
    expect(ok(r, 'pa_after')).toBe('succeeded');
  });

  it('a forfeit whose marks are closed does not block, and leaves nothing unused; a refunded purchase is PAYMENT_STATE', () => {
    expect(refused(r, 'co_d')).toBe('NO_UNUSED_TICKETS');
    expect(r.co_e).toMatchObject({ ok: false, code: 'PAYMENT_STATE', detail: 'refund_pending' });
  });

  it('guest_tickets carries the same answer per purchase, so the desk never computes it', () => {
    const times = ok<Json>(r, 'times');
    const a = purchase('gt_a');
    expect(a).toMatchObject({
      tickets: { available: 1, in_use: 1, reserved: 0, forfeited: 0, cashed_out: 0 },
      cashout: { allowed: false, reason: 'in_use', tickets: 1, amount_iqd: 10_000 },
    });
    expect(at((a.cashout as Json).until_at)).toBe(at(times.m1_end));
    expect(purchase('gt_b')).toMatchObject({ cashout: { allowed: false, reason: 'reserved', tickets: 0, amount_iqd: 0 } });
    expect(purchase('gt_c')).toMatchObject({ cashout: { allowed: false, reason: 'restorable', tickets: 1 } });
    expect(purchase('gt_d')).toMatchObject({ cashout: { allowed: false, reason: 'none_unused', until_at: null } });
    expect(purchase('gt_e')).toMatchObject({ status: 'refund_pending', cashout: { allowed: false, reason: 'not_succeeded' } });
    expect(ok<Json>(r, 'gt_d')).toMatchObject({ forfeited: 1, available: 0 });
    const forfeited = (ok<Json>(r, 'gt_c').tickets as Json[]).find((t) => t.status === 'forfeited')!;
    expect(forfeited.forfeited_venue_id).toBeTruthy();
  });

  it('my_tickets names the match of a ticket in use or forfeited, never a name', () => {
    const ids = ok<Record<string, string>>(r, 'ids');
    const a = ok<Json>(r, 'my_a');
    expect(a).toMatchObject({ available: 1, in_use: 1, reserved: 0 });
    const inUse = (a.tickets as Json[]).find((t) => t.status === 'in_use')!;
    expect(inUse.match).toMatchObject({ match_id: ids.m1, status: 'filling' });
    expect(Object.keys(inUse.match as Json).sort()).toEqual(['match_id', 'start_at', 'status', 'venue_id']);
    const c = ok<Json>(r, 'my_c');
    const lost = (c.tickets as Json[]).find((t) => t.status === 'forfeited')!;
    expect(lost.match).toMatchObject({ match_id: ids.m3, status: 'booked' });
    expect(lost).not.toHaveProperty('forfeited_venue_id');
    expect(JSON.stringify(a)).not.toMatch(/full_name|given_name|phone|Test g/);
  });

  it('DF-20 leaves a blocked purchase alone and refunds it once it is free (R13)', () => {
    expect(ok(r, 'rd_blocked')).toBe(0);
    expect(ok(r, 'rd_free')).toBe(1);
    expect(ok(r, 'pa_refund')).toEqual({ status: 'refund_pending', reason: 'account_deleted', amount: 20_000 });
    expect(ok(r, 'pc_after')).toBe('succeeded'); // still restorable
  });

  it("prepare's terms test is app.match_terms_ok, answer for answer", () => {
    expect(ok<Json[]>(r, 'terms')).toEqual([
      { v: '2026-09-23', ok: false, prepare: 'refused' },
      { v: '2026-10-01', ok: false, prepare: 'refused' },
      { v: '2026-10-01.10', ok: true, prepare: 'ok' },
      { v: '2026-10-01.9', ok: true, prepare: 'ok' },
    ]);
  });

  it('a failed ticket refund is listed and retried at any branch (chain money)', () => {
    const ids = ok<Record<string, string>>(r, 'ids');
    expect(ok<Json[]>(r, 'att_a').map((i) => i.id)).toContain(ids.pf);
    expect(ok<Json[]>(r, 'att_v2').map((i) => i.id)).toContain(ids.pf);
    expect(ok<Json>(r, 'retry_v2')).toMatchObject({ status: 'refund_pending' });
  });
});
