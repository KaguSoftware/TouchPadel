/**
 * send-sms-otp — GoTrue's Send SMS hook (phone OTP scaffold, 2026-09-05;
 * design note docs/design/phone-otp-2026-09-05.md).
 *
 * GoTrue POSTs here instead of talking to a built-in SMS vendor whenever it
 * needs to deliver a one-time code (sign-in / sign-up by phone, a phone change,
 * reauthentication). This function is the venue's SPEND GATE: it decides
 * whether a message may go out at all, and only then hands the code to the
 * configured vendor.
 *
 *   POST (from GoTrue only)  { user: { id, phone, ... }, sms: { otp, sms_type? } }
 *     -> 200 {}                                   sent (or `log` provider)
 *     -> 401 { error: { http_code: 401, message: 'UNAUTHORIZED' } }   bad / missing Standard-Webhooks signature
 *     -> 400 { error: { http_code: 400, message: 'BAD_REQUEST' } }
 *     -> 403 { error: { http_code: 403, message: 'SMS_DISABLED' | 'PHONE_NOT_ALLOWED' } }
 *     -> 429 { error: { http_code: 429, message: 'PHONE_RATE' | 'DAILY_CAP' } }
 *     -> 500 { error: { http_code: 500, message: 'SMS_SEND_FAILED' } }
 *   The message string is what GoTrue relays to the app as the auth error, so
 *   the app can map it (features/auth/phoneOtp.ts).
 *
 * WHY verify_jwt = false. GoTrue calls with no Supabase JWT; authenticity is
 * the Standard-Webhooks HMAC over the raw body (verify.ts), keyed by
 * SEND_SMS_HOOK_SECRET — the same value entered under Auth -> Hooks in the
 * dashboard (or [auth.hook.send_sms].secrets locally). Fail closed: an unset
 * secret answers 401 to everything.
 *
 * WHY a DB gate (app.sms_send_gate, 0069) and not just GoTrue's rate limits:
 * every OTP is paid; GoTrue cannot express "Iraqi mobiles only", "five a day
 * per number", or "stop now". The gate ships DISABLED, so this function
 * refuses every send until the runbook flips app.sms_limits.enabled.
 *
 * THE VENDOR IS BEHIND ONE FUNCTION. This file never names a vendor: it calls
 * `sendSms()` from _shared/sms, the single seam every edge function uses to
 * text a guest. Swapping vendors is a secrets change (SMS_PROVIDER + keys),
 * not an edit here — see _shared/sms/types.ts for the contract and recipe.
 *
 * Secrets: SEND_SMS_HOOK_SECRET, SMS_PROVIDER (log | twilio | otpiq) and the
 * chosen vendor's keys — see supabase/functions/.env.example.
 */
import { json } from '../_shared/http.ts';
import { sendSms, SmsProviderError } from '../_shared/sms/index.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { hookError, parseHookPayload, renderTemplate, statusForRefusal } from './otp.ts';
import { headersOf, verifyStandardWebhook } from './verify.ts';

const env = (name: string) => Deno.env.get(name);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(hookError(405, 'METHOD_NOT_ALLOWED'), 405);

  const raw = await req.text();
  const verified = await verifyStandardWebhook({
    secret: Deno.env.get('SEND_SMS_HOOK_SECRET'),
    headers: headersOf(req.headers),
    body: raw,
  });
  if (!verified.ok) {
    console.warn(`[send-sms-otp] refused: ${verified.reason}`);
    return json(hookError(401, 'UNAUTHORIZED'), 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(hookError(400, 'BAD_REQUEST'), 400);
  }
  const parsed = parseHookPayload(parsedJson);
  if (!parsed.ok) {
    console.warn(`[send-sms-otp] bad payload: ${parsed.reason}`);
    return json(hookError(400, 'BAD_REQUEST'), 400);
  }
  const { payload } = parsed;

  const service = createServiceClient();
  const gate = await service.schema('app').rpc('sms_send_gate', {
    p_phone_e164: payload.phoneE164,
    p_user_id: payload.userId,
    p_purpose: payload.purpose,
  });
  if (gate.error) {
    console.error(`[send-sms-otp] sms_send_gate failed: ${gate.error.message}`);
    return json(hookError(500, 'SMS_SEND_FAILED'), 500);
  }
  const decision = gate.data as { allowed: boolean; reason?: string; send_id: number };
  if (!decision.allowed) {
    const reason = decision.reason ?? 'SMS_DISABLED';
    console.warn(`[send-sms-otp] refused ${reason} for ${payload.phoneE164.slice(0, 7)}…`);
    return json(hookError(statusForRefusal(reason), reason), statusForRefusal(reason));
  }

  try {
    const result = await sendSms(
      { to: payload.phoneE164, body: renderTemplate(payload.otp), code: payload.otp },
      env,
    );
    await service.schema('app').rpc('sms_send_result', {
      p_send_id: decision.send_id,
      p_status: 'sent',
      p_provider: result.provider,
      p_channel: result.channel ?? null,
      p_provider_msg_id: result.id ?? null,
      p_error: null,
      p_cost_iqd: result.costIqd ?? null,
    });
    if (typeof result.remainingCredit === 'number') {
      console.log(`[send-sms-otp] ${result.provider} remaining credit ${result.remainingCredit}`);
    }
    return json({}, 200);
  } catch (error) {
    // sendSms only ever rejects with SmsProviderError; the fallback covers a
    // throw from the stamp RPC client itself.
    const failure =
      error instanceof SmsProviderError
        ? error
        : new SmsProviderError('unknown', error instanceof Error ? error.message : String(error));
    console.error(`[send-sms-otp] ${failure.provider} send failed: ${failure.message}`);
    await service.schema('app').rpc('sms_send_result', {
      p_send_id: decision.send_id,
      p_status: 'failed',
      p_provider: failure.provider,
      p_channel: null,
      p_provider_msg_id: null,
      p_error: failure.message.slice(0, 500),
      p_cost_iqd: null,
    });
    return json(hookError(500, 'SMS_SEND_FAILED'), 500);
  }
});
