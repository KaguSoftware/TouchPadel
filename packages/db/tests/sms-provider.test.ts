/**
 * _shared/sms — the SMS vendor seam. PURE (no stack, no network): fetch is
 * stubbed. Three things are pinned so that swapping the vendor stays a
 * secrets change:
 *
 *   1. Selection: SMS_PROVIDER picks the adapter. Unset or "log" is `log`
 *      (spends nothing). A known vendor with missing secrets, or an unknown
 *      name, FAILS every send with the reason, never a silent `log`, so a
 *      one-command swap with a typo is loud on the first code. The next
 *      vendor's secrets may sit on the project in advance: only the chosen
 *      vendor's are read.
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
import { isLocalRuntime, sendSms, smsFromEnv, SmsProviderError, SMS_PROVIDERS } from '../supabase/functions/_shared/sms/index.ts';
import { logProvider } from '../supabase/functions/_shared/sms/log.ts';
import { OTPIQ_SEND_URL, otpiqProvider } from '../supabase/functions/_shared/sms/otpiq.ts';
import { TWILIO_API_BASE, twilioProvider } from '../supabase/functions/_shared/sms/twilio.ts';
import { WHATSAPP_GRAPH_BASE, whatsappProvider } from '../supabase/functions/_shared/sms/whatsapp.ts';

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
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 1. selection ────────────────────────────────────────────────────────────
const FULL = {
  OTPIQ_API_KEY: 'sk_live_x',
  WHATSAPP_ACCESS_TOKEN: 'EAAG',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  TWILIO_ACCOUNT_SID: 'AC1',
  TWILIO_AUTH_TOKEN: 't',
  TWILIO_FROM: 'TouchPadel',
};

async function failure(env: Record<string, string | undefined>) {
  const err = await sendSms(ARGS, envOf(env)).catch((e) => e);
  expect(err).toBeInstanceOf(SmsProviderError);
  expect(fetchMock).not.toHaveBeenCalled();
  return err as SmsProviderError;
}

describe('smsFromEnv: SMS_PROVIDER picks the adapter; misconfiguration fails loudly', () => {
  it('unset, empty and "log" in any case resolve to log', () => {
    expect(smsFromEnv(envOf({})).name).toBe('log');
    expect(smsFromEnv(envOf({ SMS_PROVIDER: '' })).name).toBe('log');
    expect(smsFromEnv(envOf({ SMS_PROVIDER: ' LOG ' })).name).toBe('log');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('every listed adapter name is constructible when its secrets are set', () => {
    for (const name of SMS_PROVIDERS) {
      expect(smsFromEnv(envOf({ ...FULL, SMS_PROVIDER: name.toUpperCase() })).name).toBe(name);
    }
  });

  it('an unknown name fails every send and names the legal values (a swap typo)', async () => {
    const err = await failure({ ...FULL, SMS_PROVIDER: 'whatsap' });
    expect(err.provider).toBe('whatsap');
    expect(err.message).toBe('misconfigured: unknown provider (expected one of log, twilio, otpiq, whatsapp)');
    expect(vi.mocked(console.error).mock.calls[0]![0]).toContain('SMS_PROVIDER=whatsap is misconfigured');
  });

  it.each([
    ['otpiq', {}, 'missing OTPIQ_API_KEY'],
    ['otpiq', { OTPIQ_API_KEY: '   ' }, 'missing OTPIQ_API_KEY'],
    ['whatsapp', { WHATSAPP_ACCESS_TOKEN: 'EAAG' }, 'missing WHATSAPP_PHONE_NUMBER_ID'],
    ['whatsapp', {}, 'missing WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID'],
    ['twilio', { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't' }, 'missing TWILIO_FROM'],
  ])('%s with %j fails every send: "%s"', async (name, secrets, reason) => {
    const err = await failure({ SMS_PROVIDER: name, ...secrets });
    expect(err.provider).toBe(name); // the send log stamps the vendor that was meant
    expect(err.message).toBe(`misconfigured: ${reason}`);
    expect(err.message).not.toMatch(/EAAG|sk_live/); // names of secrets, never values
  });

  it('staged secrets for the NEXT vendor are ignored until SMS_PROVIDER names it (the one-command swap)', async () => {
    const staged = { SMS_PROVIDER: 'otpiq', OTPIQ_API_KEY: 'sk_live_x', WHATSAPP_ACCESS_TOKEN: 'EAAG', WHATSAPP_PHONE_NUMBER_ID: '123' };
    expect(smsFromEnv(envOf(staged)).name).toBe('otpiq');
    expect(smsFromEnv(envOf({ ...staged, SMS_PROVIDER: 'whatsapp' })).name).toBe('whatsapp');
    // and a half-staged next vendor does not disturb the current one
    expect(smsFromEnv(envOf({ SMS_PROVIDER: 'otpiq', OTPIQ_API_KEY: 'k', WHATSAPP_ACCESS_TOKEN: 'EAAG' })).name).toBe('otpiq');
  });
});

describe('isLocalRuntime: only the local gateway URL counts as local', () => {
  it.each([
    ['http://kong:8000', true],
    ['http://127.0.0.1:54321', true],
    ['http://localhost:54321/', true],
    ['http://host.docker.internal:54321', true],
    ['https://lczijabnorujcgmbuqlw.supabase.co', false],
    ['http://kong.evil.example', false],
    ['', false],
    [undefined, false],
  ])('SUPABASE_URL=%s -> %s', (url, local) => {
    expect(isLocalRuntime(envOf({ SUPABASE_URL: url }))).toBe(local);
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

// ── 2. contract: whatsapp (Meta Cloud API) ──────────────────────────────────
describe('whatsapp adapter (Meta Cloud API authentication template)', () => {
  const env = { accessToken: 'EAAG…', phoneNumberId: '123456789012345', templateName: 'touch_otp' };
  const ok = {
    messaging_product: 'whatsapp',
    contacts: [{ input: '9647701234567', wa_id: '9647701234567' }],
    messages: [{ id: 'wamid.HBgNOTY0NzcwMTIzNDU2NxUCABEYEjQ0QTA0', message_status: 'accepted' }],
  };

  it('posts the documented template request and maps the message id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, ok));
    const res = await whatsappProvider(env).send({ ...ARGS, lang: 'en' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WHATSAPP_GRAPH_BASE}/v26.0/123456789012345/messages`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer EAAG…');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '9647701234567', // digits, no '+'
      type: 'template',
      template: {
        name: 'touch_otp',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
        ],
      },
    });
    expect(res).toEqual({ id: ok.messages[0]!.id, channel: 'whatsapp' });
    expect(init.body as string).not.toContain('Touch Padel'); // Meta's template text, not ours
  });

  it('picks the template language from lang, falls back to the default (ar), honours code overrides and version', async () => {
    const langOf = () => JSON.parse((fetchMock.mock.lastCall as [string, RequestInit])[1].body as string).template.language.code;
    fetchMock.mockResolvedValue(jsonResponse(200, ok));
    await whatsappProvider(env).send(ARGS);
    expect(langOf()).toBe('ar');
    await whatsappProvider({ ...env, defaultLang: 'en' }).send(ARGS);
    expect(langOf()).toBe('en');
    await whatsappProvider({ ...env, langCodes: { en: 'en_US' } }).send({ ...ARGS, lang: 'en' });
    expect(langOf()).toBe('en_US');
    await whatsappProvider({ ...env, graphVersion: 'v27.0' }).send(ARGS);
    expect((fetchMock.mock.lastCall as [string, RequestInit])[0]).toContain('/v27.0/');
  });

  it.each([
    [401, { error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, fbtrace_id: 'A' } }, '(190)', 'Session has expired'],
    [400, { error: { message: '(#131026) Message Undeliverable', type: 'OAuthException', code: 131026, error_data: { messaging_product: 'whatsapp', details: 'Message Undeliverable.' }, fbtrace_id: 'B' } }, '(131026)', 'Message Undeliverable.'],
    [400, { error: { message: '(#132001) Template name does not exist in the translation', code: 132001, error_subcode: 2494010, fbtrace_id: 'C' } }, '(132001/2494010)', 'Template name does not exist'],
    [429, { error: { message: '(#130429) Rate limit hit', code: 130429, fbtrace_id: 'D' } }, '(130429)', 'Rate limit hit'],
  ])('%i -> SmsProviderError(whatsapp, status) with the Meta code and detail', async (status, body, codeFragment, textFragment) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
    const err = await whatsappProvider(env).send(ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.provider).toBe('whatsapp');
    expect(err.status).toBe(status);
    expect(err.message).toContain(`whatsapp ${status} ${codeFragment}`);
    expect(err.message).toContain(textFragment);
  });

  it('a non-JSON error body still fails closed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }));
    const err = await whatsappProvider(env).send(ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err.message).toBe('whatsapp 504 (no code): send failed');
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

  it('redacts on hosted when SMS_PROVIDER is unset (hosted injects no environment name, only its URL)', async () => {
    await sendSms(ARGS, envOf({ SUPABASE_URL: 'https://lczijabnorujcgmbuqlw.supabase.co' }));
    expect(vi.mocked(console.log).mock.calls[0]![0]).toContain('code=<redacted>');
    vi.mocked(console.log).mockClear();
    await sendSms(ARGS, envOf({}));
    expect(vi.mocked(console.log).mock.calls[0]![0]).toContain('code=<redacted>'); // no URL: fail safe
    vi.mocked(console.log).mockClear();
    await sendSms(ARGS, envOf({ SUPABASE_URL: 'http://kong:8000' }));
    expect(vi.mocked(console.log).mock.calls[0]![0]).toContain('code=123456');
  });
});

// ── 3. boundary ─────────────────────────────────────────────────────────────
describe('boundary: only _shared/sms knows the vendors', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const FUNCTIONS = resolve(here, '../supabase/functions');
  const SEAM = 'functions/_shared/sms/';
  // Anything that would let a second file talk to a vendor directly.
  const VENDOR_TOKENS = [
    'api.otpiq.com', 'api.twilio.com', 'graph.facebook.com',
    'SMS_PROVIDER', 'OTPIQ_', 'TWILIO_', 'WHATSAPP_',
    'otpiqProvider', 'twilioProvider', 'whatsappProvider', 'logProvider',
  ];

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
