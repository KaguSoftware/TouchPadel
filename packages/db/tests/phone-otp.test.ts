/**
 * 0069 — phone OTP base (DORMANT scaffold, 2026-09-05) + the send-sms-otp
 * hook's pure halves.
 *
 * Pure block (no stack): Standard-Webhooks verification round-trips and
 * refuses a tampered body / stale timestamp / wrong key; the hook payload
 * parser; the SMS template stays inside ONE UCS-2 segment; and the phone
 * normaliser's edge-function copy agrees with @touch/core on a shared fixture
 * table (the SQL twin is exercised through the gate below).
 *
 * Stack block: the gate refuses everything while app.sms_limits.enabled is
 * false (the shipped default), then, enabled, enforces the prefix allow-list
 * and the per-phone cap; the result RPC stamps a queued row exactly once; no
 * client role can call either RPC; and GoTrue's test_otp number signs up a
 * phone-only user whose profile carries the phone and no name (the trigger
 * change). Limits are restored and every row this file writes is removed in
 * afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  anonClient,
  signedInClient,
  appRpc,
  SEED_STAFF,
} from './helpers';
import {
  phoneCanon as coreCanon,
  phoneDigits as coreDigits,
  toE164Iraq as coreE164,
} from '../../core/src/phone/iraq';
import { IRAQ_PHONE_FIXTURES } from '../../core/src/phone/iraq.fixtures';
import {
  e164FromGotrue,
  phoneCanon as fnCanon,
  phoneDigits as fnDigits,
  toE164Iraq as fnE164,
} from '../supabase/functions/_shared/phone';
import {
  hookError,
  parseHookPayload,
  renderTemplate,
  statusForRefusal,
  TEMPLATE_MAX_UNITS,
  templateUnits,
} from '../supabase/functions/send-sms-otp/otp';
import {
  secretKeyBytes,
  signStandardWebhook,
  verifyStandardWebhook,
} from '../supabase/functions/send-sms-otp/verify';

const up = await stackAvailable();

// ── pure: phone normaliser parity ───────────────────────────────────────────
describe('phone normaliser: edge-function copy agrees with @touch/core', () => {
  it.each(IRAQ_PHONE_FIXTURES)('$raw', ({ raw, digits, canon, e164 }) => {
    expect(fnDigits(raw)).toBe(digits);
    expect(coreDigits(raw)).toBe(digits);
    expect(fnCanon(raw)).toBe(canon);
    expect(coreCanon(raw)).toBe(canon);
    expect(fnE164(raw)).toBe(e164);
    expect(coreE164(raw)).toBe(e164);
  });

  it('e164FromGotrue re-adds the plus GoTrue strips', () => {
    expect(e164FromGotrue('9647701234567')).toBe('+9647701234567');
    expect(e164FromGotrue('')).toBeNull();
    expect(e164FromGotrue(undefined)).toBeNull();
  });
});

// ── pure: Standard Webhooks ─────────────────────────────────────────────────
describe('send-sms-otp verify.ts (Standard Webhooks)', () => {
  // 32 random-looking bytes, base64 — the shape the dashboard generates.
  const SECRET = 'v1,whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaskWfpF9wKuXxc=';
  const OTHER = 'v1,whsec_QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5';
  const body = JSON.stringify({
    user: { id: 'u1', phone: '9647701234567' },
    sms: { otp: '123456' },
  });

  it('decodes the secret with and without its prefixes', () => {
    expect(secretKeyBytes(SECRET)?.length).toBe(32);
    expect(secretKeyBytes('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaskWfpF9wKuXxc=')?.length).toBe(32);
    expect(secretKeyBytes('MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaskWfpF9wKuXxc=')?.length).toBe(32);
    expect(secretKeyBytes('')).toBeNull();
    expect(secretKeyBytes('v1,whsec_%%%')).toBeNull();
  });

  it('accepts a request it signed itself', async () => {
    const now = 1_800_000_000;
    const h = await signStandardWebhook(SECRET, body, { id: 'msg_1', timestampS: now });
    const out = await verifyStandardWebhook({
      secret: SECRET,
      headers: {
        id: h['webhook-id']!,
        timestamp: h['webhook-timestamp']!,
        signature: h['webhook-signature']!,
      },
      body,
      nowS: now + 10,
    });
    expect(out).toEqual({ ok: true });
  });

  it('accepts when OUR signature is one of several (key rotation)', async () => {
    const now = 1_800_000_000;
    const h = await signStandardWebhook(SECRET, body, { id: 'msg_1', timestampS: now });
    const out = await verifyStandardWebhook({
      secret: SECRET,
      headers: {
        id: 'msg_1',
        timestamp: String(now),
        signature: `v1,AAAA ${h['webhook-signature']}`,
      },
      body,
      nowS: now,
    });
    expect(out).toEqual({ ok: true });
  });

  it('refuses a tampered body, a wrong key, a stale timestamp, missing headers and no secret', async () => {
    const now = 1_800_000_000;
    const h = await signStandardWebhook(SECRET, body, { id: 'msg_1', timestampS: now });
    const headers = {
      id: h['webhook-id']!,
      timestamp: h['webhook-timestamp']!,
      signature: h['webhook-signature']!,
    };

    expect(
      await verifyStandardWebhook({
        secret: SECRET,
        headers,
        body: body.replace('123456', '654321'),
        nowS: now,
      }),
    ).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    expect(await verifyStandardWebhook({ secret: OTHER, headers, body, nowS: now })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
    expect(
      await verifyStandardWebhook({ secret: SECRET, headers, body, nowS: now + 6 * 60 }),
    ).toEqual({
      ok: false,
      reason: 'STALE_TIMESTAMP',
    });
    expect(
      await verifyStandardWebhook({
        secret: SECRET,
        headers: { ...headers, signature: null },
        body,
        nowS: now,
      }),
    ).toEqual({
      ok: false,
      reason: 'MISSING_HEADERS',
    });
    expect(
      await verifyStandardWebhook({
        secret: SECRET,
        headers: { ...headers, timestamp: 'soon' },
        body,
        nowS: now,
      }),
    ).toEqual({
      ok: false,
      reason: 'BAD_TIMESTAMP',
    });
    // Fail closed: an unset secret must never mean "accept everything".
    expect(await verifyStandardWebhook({ secret: undefined, headers, body, nowS: now })).toEqual({
      ok: false,
      reason: 'NO_SECRET',
    });
    expect(
      await verifyStandardWebhook({ secret: 'v1,whsec_%%%', headers, body, nowS: now }),
    ).toEqual({
      ok: false,
      reason: 'BAD_SECRET',
    });
  });
});

// ── pure: payload + template + error contract ───────────────────────────────
describe('send-sms-otp otp.ts', () => {
  it('parses the GoTrue Send SMS payload', () => {
    expect(
      parseHookPayload({ user: { id: 'u1', phone: '9647701234567' }, sms: { otp: '123456' } }),
    ).toEqual({
      ok: true,
      payload: {
        userId: 'u1',
        phoneE164: '+9647701234567',
        phoneCanon: '7701234567',
        otp: '123456',
        purpose: 'sms',
      },
    });
    expect(
      parseHookPayload({
        user: { id: 'u1', phone: '9647701234567' },
        sms: { otp: '123456', sms_type: 'phone_change' },
      }),
    ).toMatchObject({ ok: true, payload: { purpose: 'phone_change' } });
  });

  it('refuses a payload without a phone or a code', () => {
    expect(parseHookPayload({ user: { id: 'u1' }, sms: { otp: '123456' } })).toMatchObject({
      ok: false,
    });
    expect(parseHookPayload({ user: { id: 'u1', phone: '9647701234567' }, sms: {} })).toMatchObject(
      { ok: false },
    );
    expect(
      parseHookPayload({ user: { phone: '9647701234567' }, sms: { otp: 'abc' } }),
    ).toMatchObject({ ok: false });
    expect(parseHookPayload(null)).toMatchObject({ ok: false });
    expect(parseHookPayload('x')).toMatchObject({ ok: false });
  });

  it('keeps the bilingual template inside one UCS-2 segment (Arabic => 70 units)', () => {
    const text = renderTemplate('123456');
    expect(text).toContain('123456');
    expect(templateUnits(text)).toBeLessThanOrEqual(TEMPLATE_MAX_UNITS);
    // An 8-digit code (the longest GoTrue can be configured for) still fits.
    expect(templateUnits(renderTemplate('12345678'))).toBeLessThanOrEqual(TEMPLATE_MAX_UNITS);
  });

  it('speaks the hook error contract and maps refusals to 4xx', () => {
    expect(hookError(429, 'PHONE_RATE')).toEqual({
      error: { http_code: 429, message: 'PHONE_RATE' },
    });
    expect(statusForRefusal('PHONE_RATE')).toBe(429);
    expect(statusForRefusal('DAILY_CAP')).toBe(429);
    expect(statusForRefusal('SMS_DISABLED')).toBe(403);
    expect(statusForRefusal('PHONE_NOT_ALLOWED')).toBe(403);
    expect(statusForRefusal('???')).toBe(400);
  });
});

// ── stack: the gate, the result stamp, the grants, the trigger ──────────────
const TEST_NUMBER = '+9647700000001'; // config.toml [auth.sms.test_otp]
const TEST_CODE = '123456';
const GATE_PHONE = '+9647709990069';
const GATE_CANONS = ['7709990069', '995419010203'];

type Decision = { allowed: boolean; reason?: string; send_id: number };

describe.skipIf(!up)('0069 sms_send_gate / sms_send_result / phone sign-up (stack)', () => {
  let svc: SupabaseClient;
  const limits = () => svc.schema('app').from('sms_limits');
  const sends = () => svc.schema('app').from('sms_sends');

  const gate = async (phone: string, purpose = 'sms') => {
    const res = await appRpc(svc, 'sms_send_gate', {
      p_phone_e164: phone,
      p_user_id: null,
      p_purpose: purpose,
    });
    if (res.error) throw new Error(`sms_send_gate failed: ${res.error.message}`);
    return res.data as Decision;
  };

  const resetLimits = async () => {
    const { error } = await limits()
      .update({ enabled: false, per_phone_per_day: 5, daily_total: 500, allowed_prefixes: ['964'] })
      .eq('id', true);
    if (error) throw new Error(`sms_limits reset failed: ${error.message}`);
  };

  beforeAll(async () => {
    svc = serviceClient();
    await resetLimits();
    await sends().delete().in('phone_canon', GATE_CANONS);
  });

  afterAll(async () => {
    await resetLimits();
    await sends().delete().in('phone_canon', GATE_CANONS);
    // The test_otp user: find by phone and remove (cascades through profiles).
    const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) {
      if (u.phone === TEST_NUMBER.slice(1)) await svc.auth.admin.deleteUser(u.id);
    }
  });

  it('ships DISABLED: refuses every send and logs the refusal', async () => {
    const d = await gate(GATE_PHONE);
    expect(d).toMatchObject({ allowed: false, reason: 'SMS_DISABLED' });
    const { data } = await sends()
      .select('status, reason, phone_canon')
      .eq('id', d.send_id)
      .single();
    expect(data).toEqual({ status: 'refused', reason: 'SMS_DISABLED', phone_canon: '7709990069' });
  });

  it('enabled: allow-lists the country code, caps per phone, and refused rows do not count', async () => {
    await limits().update({ enabled: true, per_phone_per_day: 2 }).eq('id', true);

    expect(await gate('+995419010203')).toMatchObject({
      allowed: false,
      reason: 'PHONE_NOT_ALLOWED',
    });

    const a = await gate(GATE_PHONE);
    // Same number, another E.164 shape: one canonical phone. The gate takes
    // E.164 only (the hook's sole input — GoTrue hands it the verified number);
    // national shapes like "0770 999 0069" are the app's job (toE164Iraq) and
    // would fail the country-code allow-list here on their raw digits.
    const b = await gate('+964 (770) 999-0069');
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(await gate(GATE_PHONE)).toMatchObject({ allowed: false, reason: 'PHONE_RATE' });

    // A provider failure frees nothing (the attempt was made); a refusal never counted.
    const { data: rows } = await sends().select('status').eq('phone_canon', '7709990069');
    expect((rows ?? []).filter((r: { status: string }) => r.status === 'queued')).toHaveLength(2);
  });

  it('sms_send_result stamps a queued row once and refuses a second stamp / a bad status', async () => {
    const { data: queued } = await sends()
      .select('id')
      .eq('phone_canon', '7709990069')
      .eq('status', 'queued')
      .limit(1);
    const id = (queued as { id: number }[])[0]!.id;

    const ok = await appRpc(svc, 'sms_send_result', {
      p_send_id: id,
      p_status: 'sent',
      p_provider: 'log',
      p_channel: 'log',
      p_provider_msg_id: 'log-1',
      p_error: null,
      p_cost_iqd: 0,
    });
    expect(ok.error).toBeNull();
    const { data: row } = await sends()
      .select('status, provider, channel, provider_msg_id, cost_iqd')
      .eq('id', id)
      .single();
    expect(row).toEqual({
      status: 'sent',
      provider: 'log',
      channel: 'log',
      provider_msg_id: 'log-1',
      cost_iqd: 0,
    });

    const again = await appRpc(svc, 'sms_send_result', { p_send_id: id, p_status: 'failed' });
    expect(again.error?.message).toContain('SEND_NOT_FOUND');
    const bad = await appRpc(svc, 'sms_send_result', { p_send_id: id, p_status: 'queued' });
    expect(bad.error?.message).toContain('INVALID_STATUS');
  });

  it('daily cap: the project-wide ceiling refuses once reached', async () => {
    await limits().update({ enabled: true, per_phone_per_day: 50, daily_total: 1 }).eq('id', true);
    // Two sent/queued rows already exist for the gate phone from the case above.
    expect(await gate('+9647709990068')).toMatchObject({ allowed: false, reason: 'DAILY_CAP' });
    await sends().delete().eq('phone_canon', '7709990068');
  });

  it('no client role can call the gate or the stamp (service role only)', async () => {
    const anon = anonClient();
    const desk = await signedInClient(SEED_STAFF.court_desk);
    for (const c of [anon, desk]) {
      const g = await appRpc(c, 'sms_send_gate', { p_phone_e164: GATE_PHONE });
      expect(g.error).not.toBeNull();
      const r = await appRpc(c, 'sms_send_result', { p_send_id: 1, p_status: 'sent' });
      expect(r.error).not.toBeNull();
    }
  });

  it('refuses a number that has no digits', async () => {
    const res = await appRpc(svc, 'sms_send_gate', { p_phone_e164: 'call me' });
    expect(res.error?.message).toContain('INVALID_PHONE');
  });

  it('trigger: a GoTrue phone sign-up (test_otp) gets its phone on the profile and no name', async () => {
    const c = anonClient();
    const sent = await c.auth.signInWithOtp({ phone: TEST_NUMBER });
    expect(sent.error, sent.error?.message).toBeNull();
    const verified = await c.auth.verifyOtp({ phone: TEST_NUMBER, token: TEST_CODE, type: 'sms' });
    expect(verified.error, verified.error?.message).toBeNull();
    const user = verified.data.user!;
    expect(user.phone).toBe(TEST_NUMBER.slice(1));

    const { data: profile, error } = await svc
      .from('profiles')
      .select('full_name, phone, preferred_lang')
      .eq('id', user.id)
      .single();
    expect(error).toBeNull();
    expect(profile).toEqual({ full_name: '', phone: TEST_NUMBER, preferred_lang: 'en' });

    // test_otp never reaches the hook: no send row for this number.
    const { data: rows } = await sends().select('id').eq('phone_canon', '7700000001');
    expect(rows ?? []).toHaveLength(0);
  });
});
