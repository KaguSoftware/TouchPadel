/**
 * The edge functions' shared request layer (supabase/functions/_shared/http.ts),
 * pure, no stack: body caps, the error shapes a caller may see, the handler
 * wrapper, fetch deadlines and the small checks that used to be copied per
 * function (2026-10-01 hardening).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  constantTimeEqual,
  errorResponse,
  fetchWithTimeout,
  handle,
  isAbortError,
  isLocalRuntime,
  isUuid,
  pgErrorBody,
  readJsonBody,
  readTextCapped,
} from '../supabase/functions/_shared/http.ts';
import { phoneDigits as deskPhoneDigits } from '../supabase/functions/desk-customer-create/phone';
import { phoneDigits as sharedPhoneDigits } from '../supabase/functions/_shared/phone';
import { constantTimeEqual as otpConstantTimeEqual } from '../supabase/functions/send-sms-otp/verify';
import { isLocalRuntime as paymentsIsLocal } from '../supabase/functions/_shared/payments/index.ts';
import { isLocalRuntime as smsIsLocal } from '../supabase/functions/_shared/sms/index.ts';
import { scrubToken } from '../supabase/functions/_shared/telegramApi.ts';

const post = (body: string | null, headers: Record<string, string> = {}) =>
  new Request('http://edge.test/fn', { method: 'POST', body, headers });

describe('readJsonBody', () => {
  it('reads a JSON object and hands back the raw text', async () => {
    const r = await readJsonBody(post('{"a":1}'), { maxBytes: 100 });
    expect(r).toMatchObject({ ok: true, value: { a: 1 }, raw: '{"a":1}' });
  });

  it('refuses a body over the cap with 413 PAYLOAD_TOO_LARGE', async () => {
    const r = await readJsonBody(post(JSON.stringify({ text: 'x'.repeat(200) })), { maxBytes: 100 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too_large');
    expect(r.response.status).toBe(413);
    expect(await r.response.json()).toEqual({ error: 'PAYLOAD_TOO_LARGE' });
  });

  it('refuses on a declared Content-Length before reading anything', async () => {
    const req = post('{}', { 'content-length': '999999' });
    expect(await readTextCapped(req, 100)).toBeNull();
  });

  it('counts bytes, not UTF-16 units (Arabic text is two bytes a letter)', async () => {
    const arabic = 'م'.repeat(60); // 120 bytes
    expect(await readTextCapped(post(arabic), 100)).toBeNull();
    expect(await readTextCapped(post(arabic), 120)).toBe(arabic);
  });

  it.each(['not json', '[1,2]', 'null', '"text"', '42', ''])('answers 400 BAD_REQUEST for %j', async (body) => {
    const r = await readJsonBody(post(body), { maxBytes: 100 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_json');
    expect(r.response.status).toBe(400);
    expect(await r.response.json()).toEqual({ error: 'BAD_REQUEST' });
  });

  it("keeps a function's own refusal for bad JSON, and reads an empty body as {} when allowed", async () => {
    const own = await readJsonBody(post('nope'), { maxBytes: 100, badJson: () => errorResponse('INVALID_REQUEST', 400) });
    expect(own.ok).toBe(false);
    if (!own.ok) expect(await own.response.json()).toEqual({ error: 'INVALID_REQUEST' });
    expect(await readJsonBody(post(''), { maxBytes: 100, allowEmpty: true })).toMatchObject({ ok: true, value: {} });
  });
});

describe('what a caller may see of an error', () => {
  it('errorResponse carries a code and an optional detail code, nothing else', async () => {
    expect(await errorResponse('INTERNAL', 500).json()).toEqual({ error: 'INTERNAL' });
    expect(await errorResponse('UPSTREAM', 502, 'TIMEOUT').json()).toEqual({ error: 'UPSTREAM', detail: 'TIMEOUT' });
  });

  it('pgErrorBody keeps a P0001 refusal exactly as it was', () => {
    expect(pgErrorBody({ code: 'P0001', message: 'ROLE_RETIRED' }, 'test')).toEqual({
      status: 400,
      body: { error: 'ROLE_RETIRED', message: 'ROLE_RETIRED' },
    });
    expect(pgErrorBody({ code: 'P0001', message: 'FORBIDDEN' }, 'test').status).toBe(403);
  });

  it('pgErrorBody never hands back raw Postgres text, and logs it instead', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = 'duplicate key value violates unique constraint "profiles_phone_key" Key (phone)=(07701234567)';
    const out = pgErrorBody({ code: '23505', message: raw, details: 'Key (phone)=(07701234567) already exists.' }, 'test');
    expect(out).toEqual({ status: 409, body: { error: 'DUPLICATE', message: 'DUPLICATE' } });
    expect(JSON.stringify(out)).not.toContain('07701234567');
    expect(String(spy.mock.calls[0]?.[1])).toContain('profiles_phone_key');
    spy.mockRestore();
  });

  it('handle() turns a throw into a JSON 500 INTERNAL and logs the real message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await handle('test', () => {
      throw new Error('connection to 10.0.0.5 refused; password=hunter2');
    })(post('{}'));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'INTERNAL' });
    expect(text).not.toContain('hunter2');
    expect(spy.mock.calls[0]?.[0]).toBe('[test]');
    expect(String(spy.mock.calls[0]?.[1])).toContain('hunter2');
    spy.mockRestore();
  });

  it('handle() answers with the caller-specific fallback when one is given (Telegram, GoTrue: always 200)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await handle(
      'test',
      async () => {
        throw new Error('boom');
      },
      () => new Response(JSON.stringify({ ok: false, error: 'INTERNAL' }), { status: 200 }),
    )(post('{}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'INTERNAL' });
    spy.mockRestore();
  });

  it('handle() passes a normal answer through untouched', async () => {
    const res = await handle('test', () => new Response('ok', { status: 201 }))(post(null));
    expect(res.status).toBe(201);
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aborts a stalled call at its deadline', async () => {
    vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      }));
    const err = await fetchWithTimeout('https://vendor.test', {}, 20).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
  });

  it("still honours the caller's own signal", async () => {
    const seen: AbortSignal[] = [];
    vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) => {
      seen.push(init.signal!);
      return Promise.resolve(new Response('{}'));
    });
    const ctrl = new AbortController();
    await fetchWithTimeout('https://vendor.test', { signal: ctrl.signal }, 10_000);
    ctrl.abort();
    expect(seen[0]?.aborted).toBe(true);
  });

  it('passes method, headers and body through', async () => {
    const calls: Array<[unknown, RequestInit]> = [];
    vi.stubGlobal('fetch', (input: unknown, init: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(new Response('{}'));
    });
    await fetchWithTimeout('https://vendor.test/x', { method: 'POST', headers: { A: 'b' }, body: 'hi' }, 1000);
    expect(calls[0]?.[0]).toBe('https://vendor.test/x');
    expect(calls[0]?.[1]).toMatchObject({ method: 'POST', headers: { A: 'b' }, body: 'hi' });
    expect(calls[0]?.[1].signal).toBeDefined();
  });
});

describe('the one copy of each small check', () => {
  it('isUuid', () => {
    expect(isUuid('7f1d6a3e-0c4b-4a7e-9a55-2b1e0e7c9d10')).toBe(true);
    expect(isUuid('7F1D6A3E-0C4B-4A7E-9A55-2B1E0E7C9D10')).toBe(true);
    for (const bad of ['', 'abc', '7f1d6a3e0c4b4a7e9a552b1e0e7c9d10', null, 42, undefined]) expect(isUuid(bad)).toBe(false);
  });

  it('constantTimeEqual', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true);
    expect(constantTimeEqual('secret', 'secreT')).toBe(false);
    expect(constantTimeEqual('secret', 'secret2')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    expect(otpConstantTimeEqual).toBe(constantTimeEqual);
  });

  it('isLocalRuntime is shared by the payment and SMS seams', () => {
    const env = (url: string) => (name: string) => (name === 'SUPABASE_URL' ? url : undefined);
    expect(isLocalRuntime(env('http://kong:8000'))).toBe(true);
    expect(isLocalRuntime(env('https://abc.supabase.co'))).toBe(false);
    expect(paymentsIsLocal).toBe(isLocalRuntime);
    expect(smsIsLocal).toBe(isLocalRuntime);
  });

  it('phoneDigits: the desk function uses the shared copy (one rule, the SQL app.phone_digits rule)', () => {
    expect(deskPhoneDigits).toBe(sharedPhoneDigits);
    expect(sharedPhoneDigits('+964 ٧٧٠ ۱۲۳ 4567')).toBe('9647701234567');
  });

  it('a Telegram error never carries the bot token', () => {
    const token = '123456:AAE-secret_token';
    const msg = `error sending request for url (https://api.telegram.org/bot${token}/sendMessage): timed out`;
    expect(scrubToken(msg, token)).not.toContain(token);
    expect(scrubToken(msg, token)).toContain('bot<token>/sendMessage');
    expect(scrubToken('no token here', '')).toBe('no token here');
  });
});
