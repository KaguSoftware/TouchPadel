/**
 * _shared/payments — the card gateway seam (Qi Card). PURE (no stack, no
 * network): fetch is stubbed, keys are generated per run (nothing committed).
 *
 *   1. Webhook signatures: Qi's documented string (paymentId|amount.000|
 *      currency|creationDate|status, '-' for missing) verified with RSA-SHA256,
 *      PEM as SPKI or PKCS#1; any tampered field, a wrong key or no header fails.
 *   2. The Qi adapter sends exactly the documented request and maps Qi's error
 *      codes by what we do about them, including what the sandbox showed that
 *      the docs do not (code 5 "already used", 403 not-found, no formUrl on status).
 *   3. Selection fails closed: unset provider, missing secrets, `fake` off the
 *      local stack all refuse every call.
 *   4. Card data never survives redaction.
 *   5. Boundary: Qi's host, headers and secret names appear only under
 *      functions/_shared/payments/.
 */
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configuredProviderName,
  finishPaymentUrl,
  notificationUrl,
  paymentsFromEnv,
  PaymentProviderError,
  webhookKeyFromEnv,
} from '../supabase/functions/_shared/payments/index.ts';
import { kindForQiCode, qiPhone, qiProvider, QI_SANDBOX_BASE_URL } from '../supabase/functions/_shared/payments/qi.ts';
import { redactGatewayMessage } from '../supabase/functions/_shared/payments/redact.ts';
import {
  requestSignedString,
  signQiRequest,
  verifyQiWebhook,
  webhookSignedStrings,
} from '../supabase/functions/_shared/payments/verify.ts';
import { fakeProvider, signFakeNotification, verifyFakeSignature, type FakeStore } from '../supabase/functions/_shared/payments/fake.ts';

const envOf = (vars: Record<string, string | undefined>) => (name: string) => vars[name];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ── 1. webhook signatures ─────────────────────────────────────────────────────
describe('Qi webhook signature', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const pkcs1 = pair.publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();

  // Qi's own example payload (developers-gate.qi.iq, "Webhook Verification").
  const payload = {
    requestId: '20250113-212519-073',
    paymentId: 'b91e8d70-1ab7-4275-85a2-61f7dbb31410',
    status: 'SUCCESS',
    amount: 10000,
    currency: 'IQD',
    creationDate: '2025-01-13T21:25:19',
  };
  const sign = (data: string) => createSign('sha256').update(data).end().sign(pair.privateKey).toString('base64');

  it('rebuilds the exact string Qi documents', () => {
    expect(webhookSignedStrings(payload)[0]).toBe(
      'b91e8d70-1ab7-4275-85a2-61f7dbb31410|10000.000|IQD|2025-01-13T21:25:19|SUCCESS',
    );
    // A JSON 20000.000 parses to 20000 and signs as "20000.000", as in Qi's reference code.
    expect(webhookSignedStrings(JSON.parse('{"amount":20000.000,"paymentId":"p"}'))[0]).toBe('p|20000.000|-|-|-');
    expect(webhookSignedStrings({})[0]).toBe('-|-|-|-|-');
  });

  it('verifies a genuine signature, with the key as SPKI or PKCS#1 PEM, pasted with \\n escapes too', async () => {
    const signature = sign(webhookSignedStrings(payload)[0]!);
    expect(await verifyQiWebhook({ publicKeyPem: spki, signature, payload })).toEqual({ ok: true });
    expect(await verifyQiWebhook({ publicKeyPem: pkcs1, signature, payload })).toEqual({ ok: true });
    expect(await verifyQiWebhook({ publicKeyPem: spki.replace(/\n/g, '\\n'), signature, payload })).toEqual({ ok: true });
  });

  it.each([
    ['amount', { amount: 1 }],
    ['status', { status: 'FAILED' }],
    ['paymentId', { paymentId: 'someone-else' }],
    ['currency', { currency: 'USD' }],
    ['creationDate', { creationDate: '2025-01-13T21:25:20' }],
  ])('refuses a tampered %s', async (_f, change) => {
    const signature = sign(webhookSignedStrings(payload)[0]!);
    const verdict = await verifyQiWebhook({ publicKeyPem: spki, signature, payload: { ...payload, ...change } });
    expect(verdict).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('refuses the wrong key, no header, no key, and garbage', async () => {
    const signature = sign(webhookSignedStrings(payload)[0]!);
    expect(await verifyQiWebhook({ publicKeyPem: other, signature, payload })).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(await verifyQiWebhook({ publicKeyPem: spki, signature: null, payload })).toMatchObject({ reason: 'no_signature' });
    expect(await verifyQiWebhook({ publicKeyPem: '', signature, payload })).toMatchObject({ reason: 'no_key' });
    expect(await verifyQiWebhook({ publicKeyPem: 'not a key', signature, payload })).toMatchObject({ reason: 'bad_key' });
    expect(await verifyQiWebhook({ publicKeyPem: spki, signature: '%%%', payload })).toMatchObject({ ok: false });
  });

  it('signs our own requests (signature-based auth) so Qi can verify them', async () => {
    const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const data = requestSignedString(['012345', '6b3d1423-644e-4ec7-92dd-b837e62294e4', 10, 'IQD', true, null, null, null]);
    expect(data).toBe('012345|6b3d1423-644e-4ec7-92dd-b837e62294e4|10.000|IQD|true|-|-|-'); // Qi's own example
    const sig = await signQiRequest(privatePem, data);
    const { createVerify } = await import('node:crypto');
    expect(createVerify('sha256').update(data).end().verify(pair.publicKey, Buffer.from(sig, 'base64'))).toBe(true);
  });
});

// ── 2. the Qi adapter ─────────────────────────────────────────────────────────
describe('Qi adapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const qi = qiProvider({
    baseUrl: 'https://qi.example/api/v1/',
    terminalId: '237984',
    username: 'merchant',
    password: 's3cret',
  });
  const created = {
    requestId: 'r-1', paymentId: 'p-1', status: 'CREATED', canceled: false, amount: 20000, currency: 'IQD',
    creationDate: '2026-09-27T14:30:23', formUrl: 'https://qi.example/api/v1/payment/p-1',
    additionalInfo: { reservation_id: 'x' },
  };

  it('create sends the documented request and returns the hosted page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, created));
    const p = await qi.create({
      requestId: 'r-1', amountIqd: 20000, locale: 'ar',
      finishPaymentUrl: 'https://site/ar/pay/return?ref=r-1', notificationUrl: 'https://fn/deposit-webhook',
      customer: { phone: '+9647701234567', accountId: 'guest-1' }, additionalInfo: { reservation_id: 'x' },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://qi.example/api/v1/payment');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('merchant:s3cret').toString('base64')}`,
      'X-Terminal-Id': '237984',
      'Content-Type': 'application/json',
    });
    expect(init.headers['X-Signature']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      requestId: 'r-1', amount: 20000, currency: 'IQD', locale: 'ar_IQ',
      finishPaymentUrl: 'https://site/ar/pay/return?ref=r-1', notificationUrl: 'https://fn/deposit-webhook',
      customerInfo: { phone: '009647701234567', accountId: 'guest-1' },
      additionalInfo: { reservation_id: 'x' }, appChannel: false,
    });
    expect(p).toMatchObject({ paymentId: 'p-1', status: 'CREATED', formUrl: created.formUrl, amount: 20000, canceled: false });
  });

  it('status, status-by-request, cancel and refund hit the documented paths', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { ...created, formUrl: undefined, amount: 20000.0 })));
    const s = await qi.status('p-1');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://qi.example/api/v1/payment/p-1/status');
    // The status object has no formUrl; the create response's shape is rebuilt.
    expect(s.formUrl).toBe('https://qi.example/api/v1/payment/p-1');
    await qi.statusByRequest('r-1');
    expect(fetchMock.mock.calls[1]![0]).toBe('https://qi.example/api/v1/payment/status/by/request/r-1');
    await qi.cancel('p-1', 'c-1');
    expect(fetchMock.mock.calls[2]![0]).toBe('https://qi.example/api/v1/payment/p-1/cancel');
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ requestId: 'c-1' });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { refundId: 'rf-1', status: 'SUCCESS', amount: 20000, currency: 'IQD', paymentId: 'p-1' }));
    const r = await qi.refund({ paymentId: 'p-1', refundRequestId: 'rr-1', amountIqd: 20000, message: 'guest_cancel' });
    expect(fetchMock.mock.calls[3]![0]).toBe('https://qi.example/api/v1/payment/p-1/refund');
    expect(JSON.parse(fetchMock.mock.calls[3]![1].body)).toEqual({ requestId: 'rr-1', amount: 20000, message: 'guest_cancel' });
    expect(r).toMatchObject({ refundId: 'rf-1', status: 'SUCCESS' });
  });

  it('reads confirmedAmount first, and a cancelled payment as canceled', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...created, status: 'CREATED', canceled: true, amount: 20000, confirmedAmount: 0 }));
    expect(await qi.status('p-1')).toMatchObject({ canceled: true, amount: 0 });
  });

  it.each([
    [403, { error: { code: 5, description: 'RequestId r-1 was already used.' } }, 'already_used'], // the sandbox, 2026-09-27
    [400, { error: { code: 10, description: 'PAYMENT_ALREADY_EXISTS' } }, 'already_used'],
    [403, { error: { code: 12, description: 'Payment with provided requestId not found.' } }, 'not_found'],
    [401, { error: { code: 27, description: 'Authentication required: Incorrect credentials' } }, 'config'],
    [403, { error: { code: 18, description: 'The payment is not in refundable state.' } }, 'refused'],
    [500, { error: { code: 23, description: 'INTERNAL_SYSTEM_ERROR' } }, 'transport'],
    [502, 'bad gateway', 'transport'],
  ])('HTTP %i %j → %s', async (status, body, kind) => {
    fetchMock.mockResolvedValue(
      typeof body === 'string' ? new Response(body, { status }) : jsonResponse(status, body),
    );
    const err = await qi.status('p-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).kind).toBe(kind);
  });

  it('a network failure or a 200 without a paymentId is a transport error, never an outcome', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(((await qi.status('p-1').catch((e) => e)) as PaymentProviderError).kind).toBe('transport');
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'SUCCESS' }));
    expect(((await qi.status('p-1').catch((e) => e)) as PaymentProviderError).kind).toBe('transport');
  });

  it('times out', async () => {
    const slow = qiProvider({ baseUrl: 'https://qi.example', terminalId: 't', username: 'u', password: 'p', timeoutMs: 20 });
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const err = (await slow.status('p').catch((e) => e)) as PaymentProviderError;
    expect(err.kind).toBe('transport');
    expect(err.message).toContain('timeout');
  });

  it('signs every call when a signing key is configured', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signed = qiProvider({
      baseUrl: 'https://qi.example', terminalId: '012345', username: 'u', password: 'p',
      signingKeyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    });
    fetchMock.mockResolvedValue(jsonResponse(200, created));
    await signed.create({
      requestId: 'r-1', amountIqd: 10, locale: 'en', finishPaymentUrl: 'https://a', notificationUrl: 'https://b',
      customer: {}, additionalInfo: {},
    });
    expect(typeof fetchMock.mock.calls[0]![1].headers['X-Signature']).toBe('string');
  });

  it('small helpers', () => {
    expect(qiPhone('+964 770 123 4567')).toBe('009647701234567');
    expect(qiPhone(null)).toBeUndefined();
    expect(kindForQiCode(undefined, '', 401)).toBe('config');
  });
});

// ── 3. selection ──────────────────────────────────────────────────────────────
describe('paymentsFromEnv: fails closed', () => {
  const QI = { QI_BASE_URL: 'https://qi.example', QI_TERMINAL_ID: 't', QI_USERNAME: 'u', QI_PASSWORD: 'p' };
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('the provider new payments are recorded with', () => {
    expect(configuredProviderName(envOf({}))).toBeNull();
    expect(configuredProviderName(envOf({ PAYMENTS_PROVIDER: 'qi' }))).toBe('qi');
    expect(configuredProviderName(envOf({ PAYMENTS_PROVIDER: 'fake', SUPABASE_URL: 'http://kong:8000' }))).toBe('fake');
    expect(configuredProviderName(envOf({ PAYMENTS_PROVIDER: 'fake', SUPABASE_URL: 'https://x.supabase.co' }))).toBeNull();
    expect(configuredProviderName(envOf({ PAYMENTS_PROVIDER: 'stripe' }))).toBeNull();
  });

  it.each([
    ['qi, a secret missing', { PAYMENTS_PROVIDER: 'qi', ...QI, QI_PASSWORD: '' }, 'qi', false],
    ['qi over http', { ...QI, QI_BASE_URL: 'http://qi.example' }, 'qi', false],
    ['sandbox without its secrets', QI, 'qi', true],
    ['fake on hosted', { SUPABASE_URL: 'https://x.supabase.co' }, 'fake', false],
    ['an unknown provider', QI, 'paypal', false],
  ])('%s → every call refused as config', async (_n, env, provider, sandbox) => {
    const spy = quiet();
    const p = paymentsFromEnv(envOf(env), { provider, sandbox });
    const err = (await p.create({} as never).catch((e) => e)) as PaymentProviderError;
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect(err.kind).toBe('config');
    spy.mockRestore();
  });

  it('builds Qi for production, and the sandbox (default host) for a sandbox payment', () => {
    expect(paymentsFromEnv(envOf(QI), { provider: 'qi', sandbox: false }).name).toBe('qi');
    const sb = paymentsFromEnv(
      envOf({ QI_SANDBOX_TERMINAL_ID: '237984', QI_SANDBOX_USERNAME: 'u', QI_SANDBOX_PASSWORD: 'p' }),
      { provider: 'qi', sandbox: true },
    );
    expect(sb.name).toBe('qi');
    expect(QI_SANDBOX_BASE_URL).toBe('https://uat-sandbox-3ds-api.qi.iq/api/v1');
  });

  it('URLs: the site return page per locale, the webhook on this project', () => {
    expect(finishPaymentUrl(envOf({}), 'ar', 'r-1')).toBe('https://www.touch-padel.com/ar/pay/return?ref=r-1');
    expect(finishPaymentUrl(envOf({ PAYMENTS_SITE_URL: 'http://localhost:3000/' }), 'en', 'r-1')).toBe(
      'http://localhost:3000/en/pay/return?ref=r-1',
    );
    expect(notificationUrl(envOf({ SUPABASE_URL: 'https://abc.supabase.co' }))).toBe(
      'https://abc.supabase.co/functions/v1/deposit-webhook',
    );
    expect(webhookKeyFromEnv(envOf({ QI_WEBHOOK_PUBLIC_KEY_PEM: ' k ' }), false)).toBe('k');
    expect(webhookKeyFromEnv(envOf({}), true)).toBeNull();
  });
});

// ── 4. redaction, and the fake ────────────────────────────────────────────────
describe('redaction', () => {
  it('keeps the state, drops card data and personal details', () => {
    const kept = redactGatewayMessage({
      requestId: 'r', paymentId: 'p', status: 'SUCCESS', amount: 3000, confirmedAmount: 3000, currency: 'IQD',
      details: { resultCode: '00', rrn: '505700009817', authId: '123456', maskedPan: '521372******8582', paymentSystem: 'MASTER_CARD' },
      customerInfo: { phone: '009647700000000', email: 'a@b.c' },
      additionalInfo: { reservation_id: 'x', 'Bad Key': 'y' },
      somethingNew: 'dropped',
    });
    expect(kept).toEqual({
      requestId: 'r', paymentId: 'p', status: 'SUCCESS', amount: 3000, confirmedAmount: 3000, currency: 'IQD',
      details: { resultCode: '00', paymentSystem: 'MASTER_CARD' },
      additionalInfo: { reservation_id: 'x' },
    });
    expect(JSON.stringify(kept)).not.toMatch(/5213|505700|123456|0096477/);
  });
});

describe('fake provider (local stack)', () => {
  const records = new Map<string, { outcome: string | null; canceled: boolean }>();
  const store: FakeStore = {
    byRequestId: async (id) => (records.has(id) ? { requestId: id, paymentId: `fake-${id}`, amountIqd: 20000, createdAt: 'x', ...records.get(id)! } : null),
    byPaymentId: async (pid) => store.byRequestId(pid.replace(/^fake-/, '')),
    setOutcome: async (id, outcome, canceled) => void records.set(id, { outcome, canceled }),
  };
  const fake = fakeProvider({ pageUrl: 'http://127.0.0.1:54321/functions/v1/payments-fake', store });

  it('reports what its page decided; cancels and refunds like Qi', async () => {
    records.set('r-1', { outcome: null, canceled: false });
    expect(await fake.status('fake-r-1')).toMatchObject({ status: 'CREATED', canceled: false, amount: 20000 });
    expect((await fake.create({ requestId: 'r-1' } as never)).formUrl).toBe('http://127.0.0.1:54321/functions/v1/payments-fake?ref=r-1');
    await expect(fake.refund({ paymentId: 'fake-r-1', refundRequestId: 'x', amountIqd: 1 })).rejects.toMatchObject({ kind: 'refused' });
    await fake.cancel('fake-r-1', 'c');
    expect(await fake.status('fake-r-1')).toMatchObject({ canceled: true });
    await store.setOutcome('r-1', 'SUCCESS', false);
    expect((await fake.refund({ paymentId: 'fake-r-1', refundRequestId: 'x', amountIqd: 1 })).status).toBe('SUCCESS');
    await expect(fake.statusByRequest('nope')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('its notifications are signed with an HMAC only the local stack holds', async () => {
    const sig = await signFakeNotification('service-key', '{"a":1}');
    expect(await verifyFakeSignature('service-key', '{"a":1}', sig)).toBe(true);
    expect(await verifyFakeSignature('service-key', '{"a":2}', sig)).toBe(false);
    expect(await verifyFakeSignature('other', '{"a":1}', sig)).toBe(false);
    expect(await verifyFakeSignature('', '{"a":1}', sig)).toBe(false);
  });
});

// ── 5. boundary ───────────────────────────────────────────────────────────────
describe('boundary: only _shared/payments knows the gateway', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const FUNCTIONS = resolve(here, '../supabase/functions');
  const SEAM = 'functions/_shared/payments/';
  // X-Signature is not listed: it is a common header name (the webhook reads
  // Qi's through the seam's verifyQiWebhook). QI_ as a word start: IRAQI_… is not Qi.
  const TOKENS: Array<[string, RegExp]> = [
    ['qi.iq', /qi\.iq/],
    ['X-Terminal-Id', /X-Terminal-Id/],
    ['QI_ secrets', /\bQI_[A-Z]/],
    ['PAYMENTS_PROVIDER', /PAYMENTS_PROVIDER/],
    ['qiProvider', /qiProvider/],
    ['fakeProvider', /fakeProvider\(/],
  ];
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : tsFiles(full);
      return name.endsWith('.ts') ? [full] : [];
    });
  }

  it.each(TOKENS)('"%s" appears only under _shared/payments', (_name, token) => {
    const offenders = tsFiles(FUNCTIONS)
      .filter((f) => token.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => 'functions/' + relative(FUNCTIONS, f).split(sep).join('/'))
      .filter((f) => !f.startsWith(SEAM));
    expect(offenders).toEqual([]);
  });

  it('the payment functions reach the gateway through the seam', () => {
    // ticket-begin (0259, open-match tickets) and lesson-begin (0281, lessons) share deposit-begin's gateway half.
    for (const fn of ['deposit-begin', 'deposit-status', 'deposit-webhook', 'deposit-reconcile', 'payments-fake', 'ticket-begin', 'lesson-begin']) {
      const src = readFileSync(join(FUNCTIONS, fn, 'index.ts'), 'utf8');
      expect(src, fn).toMatch(/from '\.\.\/_shared\/(payments\/index|deposits)\.ts'/);
      expect(src, fn).not.toMatch(/_shared\/payments\/(qi|fake|verify|redact)\.ts/);
    }
  });
});
