/**
 * lesson-begin (docs/design/coaching/money.md §6.7; build contracts §1.11,
 * R3, R50, R67): a guest pays for a held lesson place online.
 *
 *   * the pure half (supabase/functions/lesson-begin/logic.ts), no Deno: the
 *     body (enrolment_id a uuid, locale en or else ar), the refusal map with
 *     its HTTP statuses and the SQL detail passed through as `detail`
 *     (LESSON_NOT_PAYABLE's booked | cancelled | expired | desk | free,
 *     TERMS_REQUIRED's lessons), the 200 body against
 *     COACHING_SHAPES['lesson-begin'], and the flow against fake ports: a
 *     pending attempt with a page answers at once, a new one is created at the
 *     gateway, a reused attempt past its window is asked about once and
 *     prepared again (still stale → RETRY_LATER), and a gateway failure is
 *     PROVIDER_UNAVAILABLE / RETRY_LATER / INTERNAL;
 *   * against the served function (skipped when the local edge runtime does
 *     not serve it yet): GET and a malformed body are BAD_REQUEST, the anon key
 *     is AUTH_REQUIRED, and a guest's call for an enrolment that is not theirs
 *     is ENROLMENT_NOT_FOUND (a provider configured) or PROVIDER_UNAVAILABLE
 *     with nothing recorded (none configured, the default local stack).
 */
import { describe, expect, it } from 'vitest';
import { ANON_KEY, SUPABASE_URL, guestClient, serviceClient, stackAvailable } from './helpers';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';
import {
  LESSON_REFUSAL_STATUS,
  beginLesson,
  parseLessonBegin,
  refusalFor,
  type Gateway,
  type LessonBeginPorts,
  type Prepared,
  type PreparedLesson,
} from '../supabase/functions/lesson-begin/logic.ts';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const RQ = '11111111-1111-4111-8111-111111111111';
const RQ2 = '22222222-2222-4222-8222-222222222222';
const EN = '33333333-3333-4333-8333-333333333333';
const LS = '44444444-4444-4444-8444-444444444444';

function row(patch: Partial<PreparedLesson> = {}): PreparedLesson {
  return {
    request_id: RQ,
    status: 'created',
    provider: 'fake',
    sandbox: false,
    amount_iqd: 40_000,
    deadline_at: new Date(NOW + 900_000).toISOString(),
    form_url: null,
    provider_payment_id: null,
    locale: 'en',
    reused: false,
    enrolment_id: EN,
    lesson_id: LS,
    course_id: null,
    guest_phone: '+9647700000000',
    ...patch,
  };
}

function ports(prepares: Prepared[], gateway: Gateway = { formUrl: 'https://pay.example/p' }) {
  const calls = { prepare: 0, stale: [] as string[], gateway: [] as string[] };
  const p: LessonBeginPorts = {
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

describe('lesson-begin: the body', () => {
  it('enrolment_id is a uuid; locale is en or else ar', () => {
    expect(parseLessonBegin({ enrolment_id: EN, locale: 'en' })).toEqual({
      ok: true,
      value: { enrolment_id: EN, locale: 'en' },
    });
    expect(parseLessonBegin({ enrolment_id: EN, locale: 'fr' })).toEqual({
      ok: true,
      value: { enrolment_id: EN, locale: 'ar' },
    });
    expect(parseLessonBegin({ enrolment_id: EN.toUpperCase() })).toEqual({
      ok: true,
      value: { enrolment_id: EN.toUpperCase(), locale: 'ar' },
    });
    for (const bad of [
      null,
      [],
      'x',
      {},
      { enrolment_id: 'not-a-uuid' },
      { enrolment_id: 7 },
      { enrolment_id: null },
      { enrolment_id: `${EN}x` },
      { lesson_id: EN },
    ]) {
      expect(parseLessonBegin(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('lesson-begin: refusals', () => {
  it('each SQL refusal keeps its money.md §6.7 status, and its detail when it has one', () => {
    expect(LESSON_REFUSAL_STATUS).toEqual({
      INVALID_ARGUMENT: 400,
      PHONE_REQUIRED: 400,
      AUTH_REQUIRED: 401,
      ACCOUNT_REQUIRED: 403,
      TERMS_REQUIRED: 403,
      ENROLMENT_NOT_FOUND: 404,
      LESSON_NOT_PAYABLE: 409,
      ONLINE_PAYMENT_OFF: 409,
      COACHING_OFF: 409,
      TOO_MANY_ATTEMPTS: 429,
      DEGRADED_LOCKOUT: 503,
    });
    for (const detail of ['booked', 'cancelled', 'expired', 'desk', 'free']) {
      expect(refusalFor({ code: 'P0001', message: 'LESSON_NOT_PAYABLE', details: detail })).toEqual(
        {
          status: 409,
          body: { error: 'LESSON_NOT_PAYABLE', detail },
        },
      );
    }
    expect(refusalFor({ code: 'P0001', message: 'TERMS_REQUIRED', details: 'lessons' })).toEqual({
      status: 403,
      body: { error: 'TERMS_REQUIRED', detail: 'lessons' },
    });
    expect(refusalFor({ code: 'P0001', message: 'ENROLMENT_NOT_FOUND', details: null })).toEqual({
      status: 404,
      body: { error: 'ENROLMENT_NOT_FOUND' },
    });
    expect(refusalFor({ code: 'P0001', message: 'PHONE_REQUIRED', details: '' })).toEqual({
      status: 400,
      body: { error: 'PHONE_REQUIRED' },
    });
    expect(refusalFor({ code: 'P0001', message: 'DEGRADED_LOCKOUT' })).toEqual({
      status: 503,
      body: { error: 'DEGRADED_LOCKOUT' },
    });
    // A retryable database error is RETRY_LATER; anything unknown is INTERNAL.
    expect(refusalFor({ code: '40001', message: 'could not serialize access' })).toEqual({
      status: 503,
      body: { error: 'RETRY_LATER' },
    });
    expect(refusalFor({ code: '55P03', message: 'lock timeout' })).toEqual({
      status: 503,
      body: { error: 'RETRY_LATER' },
    });
    expect(refusalFor({ code: 'P0001', message: 'SOMETHING_ELSE' })).toEqual({
      status: 500,
      body: { error: 'INTERNAL' },
    });
  });
});

describe('lesson-begin: the flow', () => {
  it('a new attempt is created at the gateway and answered with its page (the shapes.ts keys)', async () => {
    const { p, calls } = ports([{ data: row() }]);
    const a = await beginLesson(p);
    expect(a).toEqual({
      status: 200,
      body: {
        request_id: RQ,
        form_url: 'https://pay.example/p',
        amount_iqd: 40_000,
        deadline_at: row().deadline_at,
        status: 'pending',
        reused: false,
        enrolment_id: EN,
      },
    });
    expect(missingKeys(a.body, COACHING_SHAPES['lesson-begin'])).toEqual([]);
    expect(calls).toEqual({ prepare: 1, stale: [], gateway: [RQ] });
  });

  it('a double tap: the live pending attempt answers with its own page, no gateway call', async () => {
    const live = row({ status: 'pending', form_url: 'https://pay.example/live', reused: true });
    const { p, calls } = ports([{ data: live }]);
    const a = await beginLesson(p);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({
      form_url: 'https://pay.example/live',
      reused: true,
      enrolment_id: EN,
    });
    expect(calls.gateway).toEqual([]);
  });

  it('a reused attempt that never reached the gateway is created there (same request_id)', async () => {
    const { p, calls } = ports([{ data: row({ reused: true }) }]);
    expect((await beginLesson(p)).status).toBe(200);
    expect(calls.gateway).toEqual([RQ]);
  });

  it('a stale reused attempt is asked about once; a fresh one then goes ahead', async () => {
    const stale = row({
      status: 'pending',
      form_url: 'https://pay.example/old',
      reused: true,
      deadline_at: new Date(NOW - 1_000).toISOString(),
    });
    const { p, calls } = ports([{ data: stale }, { data: row({ request_id: RQ2 }) }]);
    const a = await beginLesson(p);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ request_id: RQ2, form_url: 'https://pay.example/p' });
    expect(calls).toEqual({ prepare: 2, stale: [RQ], gateway: [RQ2] });
  });

  it('still the same stale attempt after asking: RETRY_LATER (the reconciler closes it)', async () => {
    const stale = row({
      status: 'pending',
      form_url: 'https://pay.example/old',
      reused: true,
      deadline_at: new Date(NOW - 1_000).toISOString(),
    });
    const { p, calls } = ports([{ data: stale }, { data: stale }]);
    expect(await beginLesson(p)).toEqual({ status: 503, body: { error: 'RETRY_LATER' } });
    expect(calls.gateway).toEqual([]);
  });

  it('a refusal on either prepare is answered as the SQL said, with its detail', async () => {
    const refused: Prepared = {
      error: { code: 'P0001', message: 'TOO_MANY_ATTEMPTS', details: null },
    };
    expect(await beginLesson(ports([refused]).p)).toEqual({
      status: 429,
      body: { error: 'TOO_MANY_ATTEMPTS' },
    });
    // After the stale attempt was asked about, the hold had lapsed: the second prepare says so.
    const stale = row({ reused: true, deadline_at: new Date(NOW - 1).toISOString() });
    const lapsed: Prepared = {
      error: { code: 'P0001', message: 'LESSON_NOT_PAYABLE', details: 'expired' },
    };
    expect(await beginLesson(ports([{ data: stale }, lapsed]).p)).toEqual({
      status: 409,
      body: { error: 'LESSON_NOT_PAYABLE', detail: 'expired' },
    });
  });

  it('a gateway failure is PROVIDER_UNAVAILABLE or RETRY_LATER (503), a bookkeeping one INTERNAL (500)', async () => {
    for (const [g, status] of [
      ['PROVIDER_UNAVAILABLE', 503],
      ['RETRY_LATER', 503],
      ['INTERNAL', 500],
    ] as const) {
      expect(await beginLesson(ports([{ data: row() }], { error: g }).p)).toEqual({
        status,
        body: { error: g },
      });
    }
  });
});

// ── the served function ──────────────────────────────────────────────────────
const up = await stackAvailable();
const FN = `${SUPABASE_URL}/functions/v1/lesson-begin`;

async function call(init: RequestInit & { token?: string } = {}) {
  const res = await fetch(FN, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${init.token ?? ANON_KEY}`,
    },
    body:
      init.method === 'GET'
        ? undefined
        : (init.body ?? JSON.stringify({ enrolment_id: EN, locale: 'en' })),
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

/** The local runtime serves lesson-begin when the anon key gets our own AUTH_REQUIRED. */
const served =
  up &&
  (await call()
    .then((r) => r.status === 401 && r.body.error === 'AUTH_REQUIRED')
    .catch(() => false));

describe.skipIf(!served)('lesson-begin: the served function', () => {
  it('GET and a malformed body are BAD_REQUEST; the anon key is AUTH_REQUIRED', async () => {
    expect(await call({ method: 'GET' })).toMatchObject({
      status: 405,
      body: { error: 'BAD_REQUEST' },
    });
    expect(await call({ body: '{"enrolment_id":"nope"}' })).toMatchObject({
      status: 400,
      body: { error: 'BAD_REQUEST' },
    });
    expect(await call({ body: 'not json' })).toMatchObject({
      status: 400,
      body: { error: 'BAD_REQUEST' },
    });
    expect(await call()).toMatchObject({ status: 401, body: { error: 'AUTH_REQUIRED' } });
  });

  it("a guest's call for an enrolment that is not theirs: ENROLMENT_NOT_FOUND, or PROVIDER_UNAVAILABLE, nothing recorded", async () => {
    const svc = serviceClient();
    const guest = await guestClient(svc, 'lb-served');
    const { data: s } = await guest.auth.getSession();
    const uid = s.session!.user.id;
    const r = await call({
      token: s.session!.access_token,
      body: JSON.stringify({ enrolment_id: EN, locale: 'en' }),
    });
    if (r.status === 503) {
      expect(r.body).toEqual({ error: 'PROVIDER_UNAVAILABLE' });
    } else {
      expect(r).toEqual({ status: 404, body: { error: 'ENROLMENT_NOT_FOUND' } });
    }
    const { data } = await svc.from('booking_payments').select('id').eq('guest_id', uid);
    expect(data ?? []).toHaveLength(0);
  });
});
