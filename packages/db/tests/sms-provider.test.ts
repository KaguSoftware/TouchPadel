/**
 * _shared/sms — the SMS vendor seam. PURE (no stack, no network): fetch is
 * stubbed. Three things are pinned so that swapping the vendor stays a
 * secrets change:
 *
 *   1. Selection: SMS_PROVIDER picks the adapter; anything unset, unknown or
 *      missing its keys degrades to `log` (spends nothing) with a warning.
 *   2. Contract: every adapter sends the vendor exactly the documented request
 *      (URL, auth, body shape), returns { id, channel, costIqd } on 2xx, and
 *      throws SmsProviderError carrying its name + the HTTP status otherwise.
 *      `sendSms` wraps any raw throw into SmsProviderError and stamps the
 *      adapter name on the result.
 *   3. Boundary: vendor hostnames and secret names appear ONLY under
 *      functions/_shared/sms/. Every other edge function must go through
 *      sendSms — the same rule the mobile reliability test applies to GoTrue.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendSms, smsFromEnv, SmsProviderError, SMS_PROVIDERS } from '../supabase/functions/_shared/sms/index.ts';
import { logProvider } from '../supabase/functions/_shared/sms/log.ts';
import { OTPIQ_SEND_URL, otpiqProvider } from '../supabase/functions/_shared/sms/otpiq.ts';
import { TWILIO_API_BASE, twilioProvider } from '../supabase/functions/_shared/sms/twilio.ts';

const envOf = (vars: Record<string, string | undefined>) => (name: string) => vars[name];
const ARGS = { to: '+9647701234567', body: 'Touch Padel: 123456\nرمز الدخول: 123456', code: '123456' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 1. selection ────────────────────────────────────────────────────────────
describe('smsFromEnv: SMS_PROVIDER picks the adapter, everything else is log', () => {
  it('unset, "log", mixed case and unknown all resolve to log', () => {
    expect(smsFromEnv(envOf({})).name).toBe('log');
    expect(smsFromEnv(envOf({ SMS_PROVIDER: 'log' })).name).toBe('log');
    expect(smsFromEnv(envOf({ SMS_PROVIDER: ' LOG ' })).name).toBe('log');
    expect(smsFromEnv(envOf({ SMS_PROVIDER: 'nexmo' })).name).toBe('log');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]![0]).toContain('unknown SMS_PROVIDER "nexmo"');
  });

  it('otpiq needs OTPIQ_API_KEY; twilio needs all three TWILIO_* secrets', () => {
    expect(smsFromEnv(envOf({ SMS_PROVIDER: 'otpiq' })).name).toBe('log');
    expect(smsFromEnv(envOf({ SMS_PROVIDER: 'otpiq', OTPIQ_API_KEY: 'sk_live_x' })).name).toBe('otpiq');
    expect(smsFromEnv(envOf({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' })).name).toBe('log');
    expect(
      smsFromEnv(envOf({ SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: 'TouchPadel' }))
        .name,
    ).toBe('twilio');
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('every listed adapter name is constructible', () => {
    const full = envOf({
      OTPIQ_API_KEY: 'k',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_FROM: 'TouchPadel',
    });
    for (const name of SMS_PROVIDERS) {
      expect(smsFromEnv((k) => (k === 'SMS_PROVIDER' ? name : full(k))).name).toBe(name);
    }
  });
});

// ── 2. contract: sendSms ────────────────────────────────────────────────────
describe('sendSms: one function, adapter name stamped, errors always SmsProviderError', () => {
  it('returns the adapter result plus its name', async () => {
    const sent = await sendSms(ARGS, envOf({}));
    expect(sent.provider).toBe('log');
    expect(sent.channel).toBe('log');
    expect(sent.costIqd).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps a raw throw (network down) into SmsProviderError with the adapter name', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const err = await sendSms(ARGS, envOf({ SMS_PROVIDER: 'otpiq', OTPIQ_API_KEY: 'k' })).catch((e) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.provider).toBe('otpiq');
    expect(err.status).toBeUndefined();
    expect(err.message).toBe('fetch failed');
  });

  it('passes an adapter SmsProviderError through untouched', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized, please use your project api key' }));
    const err = await sendSms(ARGS, envOf({ SMS_PROVIDER: 'otpiq', OTPIQ_API_KEY: 'k' })).catch((e) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.provider).toBe('otpiq');
    expect(err.status).toBe(401);
  });
});

// ── 2. contract: otpiq ──────────────────────────────────────────────────────
describe('otpiq adapter (docs.otpiq.com/api-reference/messaging/post)', () => {
  const ok = { message: 'SMS task created successfully', smsId: 'sms-0123456789abcdef01234567', remainingCredit: 14800, cost: 200, canCover: true, paymentType: 'prepaid' };

  it('sends the documented verification request and maps the response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ok));
    const res = await otpiqProvider({ apiKey: 'sk_live_k', senderId: 'TouchPadel' }).send(ARGS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OTPIQ_SEND_URL);
    expect(url).toBe('https://api.otpiq.com/api/sms');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_live_k');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      phoneNumber: '9647701234567', // digits, no '+'
      smsType: 'verification',
      verificationCode: '123456',
      provider: 'sms', // default routing: SMS only, no WhatsApp (owner decision 2026-09-12)
      senderId: 'TouchPadel',
    });
    expect(res).toEqual({ id: ok.smsId, channel: 'sms', costIqd: 200, remainingCredit: 14800 });
  });

  it('omits senderId when unset and reports the first channel of the routing string', async () => {
    for (const [routing, channel] of [
      ['sms', 'sms'],
      ['whatsapp-sms', 'whatsapp'],
      ['whatsapp', 'whatsapp'],
      ['telegram-sms', 'telegram'],
      ['auto', 'sms'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, ok));
      const res = await otpiqProvider({ apiKey: 'k', provider: routing }).send(ARGS);
      const body = JSON.parse((fetchMock.mock.lastCall as [string, RequestInit])[1].body as string);
      expect(body.provider).toBe(routing);
      expect(body).not.toHaveProperty('senderId');
      expect(res.channel).toBe(channel);
    }
  });

  it('never sends our body text: OTPIQ renders its own template around the code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ok));
    await otpiqProvider({ apiKey: 'k' }).send(ARGS);
    expect((fetchMock.mock.lastCall as [string, RequestInit])[1].body as string).not.toContain('Touch Padel');
  });

  it.each([
    [400, { error: 'SenderID not found' }, 'SenderID not found'],
    [400, { error: 'Insufficient credit, please add more credit', yourCredit: 100, requiredCredit: 200 }, 'Insufficient credit'],
    [401, { message: 'Unauthorized, please use your project api key' }, 'Unauthorized'],
    [429, { message: 'Rate limit exceeded. Please try again in 8 minutes.', waitMinutes: 8 }, 'Rate limit exceeded'],
    [500, { message: 'Internal server error' }, 'Internal server error'],
  ])('%i %j -> SmsProviderError(otpiq, status) carrying the vendor text', async (status, body, fragment) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
    const err = await otpiqProvider({ apiKey: 'k' }).send(ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.provider).toBe('otpiq');
    expect(err.status).toBe(status);
    expect(err.message).toContain(`otpiq ${status}`);
    expect(err.message).toContain(fragment);
  });

  it('a non-JSON error body still fails closed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }));
    const err = await otpiqProvider({ apiKey: 'k' }).send(ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.status).toBe(502);
    expect(err.message).toBe('otpiq 502: send failed');
  });
});

// ── 2. contract: twilio ─────────────────────────────────────────────────────
describe('twilio adapter', () => {
  const env = { accountSid: 'AC123', authToken: 'tok', from: 'TouchPadel' };

  it('posts the form-encoded message with basic auth to the account resource', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SM1', status: 'queued' }));
    const res = await twilioProvider(env).send(ARGS);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TWILIO_API_BASE}/Accounts/AC123/Messages.json`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('AC123:tok')}`);
    const form = init.body as URLSearchParams;
    expect(form.get('To')).toBe('+9647701234567');
    expect(form.get('From')).toBe('TouchPadel');
    expect(form.get('Body')).toBe(ARGS.body); // Twilio sends our bilingual text verbatim
    expect(res).toEqual({ id: 'SM1', channel: 'sms' });
  });

  it('a whatsapp: sender prefixes the recipient and reports the whatsapp channel', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { sid: 'SM2' }));
    const res = await twilioProvider({ ...env, from: 'whatsapp:+14155238886' }).send(ARGS);
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams;
    expect(form.get('To')).toBe('whatsapp:+9647701234567');
    expect(res.channel).toBe('whatsapp');
  });

  it('non-2xx -> SmsProviderError(twilio, status) with the Twilio error code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { code: 21211, message: "The 'To' number is not valid." }));
    const err = await twilioProvider(env).send(ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.provider).toBe('twilio');
    expect(err.status).toBe(400);
    expect(err.message).toBe("twilio 400 (21211): The 'To' number is not valid.");
  });
});

// ── 2. contract: log ────────────────────────────────────────────────────────
describe('log adapter', () => {
  it('spends nothing, calls no vendor, and prints the code ONLY locally', async () => {
    const local = await logProvider(true).send(ARGS);
    expect(local).toMatchObject({ channel: 'log', costIqd: 0 });
    expect(local.id).toMatch(/^log-\d+$/);
    expect(vi.mocked(console.log).mock.calls[0]![0]).toContain('code=123456');

    vi.mocked(console.log).mockClear();
    await logProvider(false).send(ARGS);
    const hosted = vi.mocked(console.log).mock.calls[0]![0] as string;
    expect(hosted).not.toContain('123456');
    expect(hosted).toContain('code=<redacted>');
    expect(hosted).not.toContain('+9647701234567'); // number truncated too
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is what a hosted deploy gets when SUPABASE_ENV=production and SMS_PROVIDER is unset', async () => {
    await sendSms(ARGS, envOf({ SUPABASE_ENV: 'production' }));
    expect(vi.mocked(console.log).mock.calls[0]![0]).toContain('code=<redacted>');
  });
});

// ── 3. boundary ─────────────────────────────────────────────────────────────
describe('boundary: only _shared/sms knows the vendors', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const FUNCTIONS = resolve(here, '../supabase/functions');
  const SEAM = 'functions/_shared/sms/';
  // Anything that would let a second file talk to a vendor directly.
  const VENDOR_TOKENS = ['api.otpiq.com', 'api.twilio.com', 'SMS_PROVIDER', 'OTPIQ_', 'TWILIO_', 'otpiqProvider', 'twilioProvider', 'logProvider'];

  // Comments may NAME a vendor or a secret (headers document them); code may not.
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : tsFiles(full);
      return name.endsWith('.ts') ? [full] : [];
    });
  }

  it.each(VENDOR_TOKENS)('"%s" appears only under _shared/sms', (token) => {
    const offenders = tsFiles(FUNCTIONS)
      .filter((f) => stripComments(readFileSync(f, 'utf8')).includes(token))
      .map((f) => 'functions/' + relative(FUNCTIONS, f))
      .filter((f) => !f.startsWith(SEAM));
    expect(offenders).toEqual([]);
  });

  it('the hook reaches the vendor through sendSms and nothing else', () => {
    const hook = readFileSync(join(FUNCTIONS, 'send-sms-otp/index.ts'), 'utf8');
    expect(hook).toContain("from '../_shared/sms/index.ts'");
    expect(hook).toMatch(/await sendSms\(/);
    expect(hook).not.toContain('smsFromEnv');
  });
});
