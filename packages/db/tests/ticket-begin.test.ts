/**
 * ticket-begin (docs/design/open-matches/money.md §5.3): a guest buys
 * open-match tickets.
 *
 *   * the pure half (supabase/functions/ticket-begin/logic.ts), no Deno: the
 *     body (count an integer, locale en or else ar), the refusal map with its
 *     HTTP statuses and the SQL detail passed through as `detail`, and the flow
 *     against fake ports: a pending attempt with a page answers at once, a new
 *     one is created at the gateway, a reused attempt past its window is asked
 *     about once and prepared again (still stale → RETRY_LATER), and a gateway
 *     failure is PROVIDER_UNAVAILABLE / RETRY_LATER / INTERNAL;
 *   * against the served function (skipped when the local edge runtime does
 *     not serve it yet): GET and a malformed body are BAD_REQUEST, the anon key
 *     is AUTH_REQUIRED, and a guest's call either reaches the SQL refusal with
 *     its detail (a provider configured) or is PROVIDER_UNAVAILABLE with
 *     nothing recorded (none configured, the default local stack).
 */
import { describe, expect, it } from 'vitest';
import {
  ANON_KEY,
  SUPABASE_URL,
  guestClient,
  serviceClient,
  stackAvailable,
} from './helpers';
import {
  TICKET_REFUSAL_STATUS,
  beginTickets,
  parseTicketBegin,
  refusalFor,
  type Gateway,
  type Prepared,
  type PreparedTicket,
  type TicketBeginPorts,
} from '../supabase/functions/ticket-begin/logic.ts';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const RQ = '11111111-1111-4111-8111-111111111111';
const RQ2 = '22222222-2222-4222-8222-222222222222';

function row(patch: Partial<PreparedTicket> = {}): PreparedTicket {
  return {
    request_id: RQ,
    status: 'created',
    provider: 'fake',
    sandbox: false,
    amount_iqd: 20_000,
    ticket_count: 2,
    unit_price_iqd: 10_000,
    deadline_at: new Date(NOW + 900_000).toISOString(),
    form_url: null,
    provider_payment_id: null,
    locale: 'en',
    reused: false,
    guest_phone: '+9647700000000',
    ...patch,
  };
}

function ports(prepares: Prepared[], gateway: Gateway = { formUrl: 'https://pay.example/p' }) {
  const calls = { prepare: 0, stale: [] as string[], gateway: [] as string[] };
  const p: TicketBeginPorts = {
    async prepare() {
      const next = prepares[Math.min(calls.prepare, prepares.length - 1)]!;
      calls.prepare++;
      return next;
    },
    async settleStale(r) {
      calls.stale.push(r.request_id);
    },
    async gateway(r) {
      calls.gateway.push(r.request_id);
      return gateway;
    },
    now: () => NOW,
  };
  return { p, calls };
}

describe('ticket-begin: the body', () => {
  it('count is an integer (its range is the SQL\'s); locale is en or else ar', () => {
    expect(parseTicketBegin({ count: 2, locale: 'en' })).toEqual({ ok: true, value: { count: 2, locale: 'en' } });
    expect(parseTicketBegin({ count: 1, locale: 'fr' })).toEqual({ ok: true, value: { count: 1, locale: 'ar' } });
    expect(parseTicketBegin({ count: 7 })).toEqual({ ok: true, value: { count: 7, locale: 'ar' } });
    for (const bad of [null, [], 'x', {}, { count: '2' }, { count: 1.5 }, { count: Number.NaN }, { count: null }]) {
      expect(parseTicketBegin(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('ticket-begin: refusals', () => {
  it('each SQL refusal keeps its money.md §5.3 status, and its detail when it has one', () => {
    expect(TICKET_REFUSAL_STATUS).toEqual({
      TICKET_COUNT_INVALID: 400, PHONE_REQUIRED: 400, INVALID_ARGUMENT: 400, AUTH_REQUIRED: 401,
      ACCOUNT_REQUIRED: 403, TERMS_REQUIRED: 403, MATCH_BANNED: 403, MATCHES_OFF: 409, TOO_MANY_ATTEMPTS: 429,
    });
    expect(refusalFor({ code: 'P0001', message: 'TICKET_COUNT_INVALID', details: 'wallet_limit' })).toEqual({
      status: 400, body: { error: 'TICKET_COUNT_INVALID', detail: 'wallet_limit' },
    });
    expect(refusalFor({ code: 'P0001', message: 'MATCHES_OFF', details: null })).toEqual({
      status: 409, body: { error: 'MATCHES_OFF' },
    });
    expect(refusalFor({ code: 'P0001', message: 'PHONE_REQUIRED', details: '' })).toEqual({
      status: 400, body: { error: 'PHONE_REQUIRED' },
    });
    // A retryable database error is RETRY_LATER; anything unknown is INTERNAL.
    expect(refusalFor({ code: '40001', message: 'could not serialize access' })).toEqual({
      status: 503, body: { error: 'RETRY_LATER' },
    });
    expect(refusalFor({ code: 'P0001', message: 'SOMETHING_ELSE' })).toEqual({ status: 500, body: { error: 'INTERNAL' } });
  });
});

describe('ticket-begin: the flow', () => {
  it('a new attempt is created at the gateway and answered with its page', async () => {
    const { p, calls } = ports([{ data: row() }]);
    const a = await beginTickets(p);
    expect(a).toEqual({
      status: 200,
      body: {
        request_id: RQ, form_url: 'https://pay.example/p', amount_iqd: 20_000, ticket_count: 2,
        unit_price_iqd: 10_000, deadline_at: row().deadline_at, status: 'pending', reused: false,
      },
    });
    expect(calls).toEqual({ prepare: 1, stale: [], gateway: [RQ] });
  });

  it('a double tap: the live pending attempt answers with its own page and count, no gateway call', async () => {
    const live = row({ status: 'pending', form_url: 'https://pay.example/live', reused: true, ticket_count: 3, amount_iqd: 30_000 });
    const { p, calls } = ports([{ data: live }]);
    const a = await beginTickets(p);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ form_url: 'https://pay.example/live', ticket_count: 3, reused: true });
    expect(calls.gateway).toEqual([]);
  });

  it('a reused attempt that never reached the gateway is created there (same request_id)', async () => {
    const { p, calls } = ports([{ data: row({ reused: true }) }]);
    expect((await beginTickets(p)).status).toBe(200);
    expect(calls.gateway).toEqual([RQ]);
  });

  it('a stale reused attempt is asked about once; a fresh one then goes ahead', async () => {
    const stale = row({ status: 'pending', form_url: 'https://pay.example/old', reused: true,
                        deadline_at: new Date(NOW - 1_000).toISOString() });
    const { p, calls } = ports([{ data: stale }, { data: row({ request_id: RQ2 }) }]);
    const a = await beginTickets(p);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ request_id: RQ2, form_url: 'https://pay.example/p' });
    expect(calls).toEqual({ prepare: 2, stale: [RQ], gateway: [RQ2] });
  });

  it('still the same stale attempt after asking: RETRY_LATER (the reconciler closes it)', async () => {
    const stale = row({ status: 'pending', form_url: 'https://pay.example/old', reused: true,
                        deadline_at: new Date(NOW - 1_000).toISOString() });
    const { p, calls } = ports([{ data: stale }, { data: stale }]);
    expect(await beginTickets(p)).toEqual({ status: 503, body: { error: 'RETRY_LATER' } });
    expect(calls.gateway).toEqual([]);
  });

  it('a refusal on either prepare is answered as the SQL said', async () => {
    const refused: Prepared = { error: { code: 'P0001', message: 'TOO_MANY_ATTEMPTS', details: null } };
    expect(await beginTickets(ports([refused]).p)).toEqual({ status: 429, body: { error: 'TOO_MANY_ATTEMPTS' } });
    const stale = row({ reused: true, deadline_at: new Date(NOW - 1).toISOString() });
    const banned: Prepared = { error: { code: 'P0001', message: 'MATCH_BANNED', details: null } };
    expect(await beginTickets(ports([{ data: stale }, banned]).p)).toEqual({ status: 403, body: { error: 'MATCH_BANNED' } });
  });

  it('a gateway failure is PROVIDER_UNAVAILABLE or RETRY_LATER (503), a bookkeeping one INTERNAL (500)', async () => {
    for (const [g, status] of [['PROVIDER_UNAVAILABLE', 503], ['RETRY_LATER', 503], ['INTERNAL', 500]] as const) {
      expect(await beginTickets(ports([{ data: row() }], { error: g }).p)).toEqual({ status, body: { error: g } });
    }
  });
});

// ── the served function ──────────────────────────────────────────────────────
const up = await stackAvailable();
const FN = `${SUPABASE_URL}/functions/v1/ticket-begin`;

async function call(init: RequestInit & { token?: string } = {}) {
  const res = await fetch(FN, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${init.token ?? ANON_KEY}`,
    },
    body: init.method === 'GET' ? undefined : (init.body ?? JSON.stringify({ count: 2, locale: 'en' })),
    signal: AbortSignal.timeout(15_000),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // not JSON (the runtime's own answer)
  }
  return { status: res.status, body };
}

/** The local runtime serves ticket-begin when the anon key gets our own AUTH_REQUIRED. */
const served = up && (await call().then((r) => r.status === 401 && r.body.error === 'AUTH_REQUIRED').catch(() => false));

describe.skipIf(!served)('ticket-begin: the served function', () => {
  it('GET and a malformed body are BAD_REQUEST; the anon key is AUTH_REQUIRED', async () => {
    expect(await call({ method: 'GET' })).toMatchObject({ status: 405, body: { error: 'BAD_REQUEST' } });
    expect(await call({ body: '{"count":"two"}' })).toMatchObject({ status: 400, body: { error: 'BAD_REQUEST' } });
    expect(await call({ body: 'not json' })).toMatchObject({ status: 400, body: { error: 'BAD_REQUEST' } });
    expect(await call()).toMatchObject({ status: 401, body: { error: 'AUTH_REQUIRED' } });
  });

  it('a guest reaches the SQL refusal with its detail, or PROVIDER_UNAVAILABLE with nothing recorded', async () => {
    const svc = serviceClient();
    const guest = await guestClient(svc, 'tb-served');
    const { data: s } = await guest.auth.getSession();
    const uid = s.session!.user.id;
    const r = await call({ token: s.session!.access_token, body: JSON.stringify({ count: 7, locale: 'en' }) });
    if (r.status === 503) {
      expect(r.body).toEqual({ error: 'PROVIDER_UNAVAILABLE' });
    } else {
      expect(r).toEqual({ status: 400, body: { error: 'TICKET_COUNT_INVALID', detail: 'p_count' } });
    }
    const { data } = await svc.from('booking_payments').select('id').eq('guest_id', uid);
    expect(data ?? []).toHaveLength(0);
  });
});
