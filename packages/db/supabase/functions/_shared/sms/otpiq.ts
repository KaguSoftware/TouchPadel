/**
 * OTPIQ adapter (otpiq.com — Iraqi aggregator with direct Zain / Asiacell /
 * Korek routes and WhatsApp / Telegram channels with SMS fallback).
 *
 * Contract checked against the vendor's published API reference
 * (docs.otpiq.com/api-reference/messaging/post, read 2026-09-12):
 *   POST https://api.otpiq.com/api/sms
 *   Authorization: Bearer <OTPIQ_API_KEY>            ("sk_live_…")
 *   { phoneNumber: "9647701234567",                  // 10–15 digits, no '+'
 *     smsType: "verification",
 *     verificationCode: "123456",                    // 1–20 chars
 *     provider: "auto" | "sms" | "whatsapp" | "telegram"
 *             | "whatsapp-sms" | "telegram-sms" | "whatsapp-telegram-sms",
 *     senderId?: "TouchPadel" }                      // ≤ 11 chars, approved on the account
 *   200 -> { message, smsId: "sms-<24 hex>", remainingCredit, cost (IQD), canCover, paymentType }
 *   400 -> { error: "<validation | insufficient credit | sender id | trial mode>" }
 *   401 -> { message: "Unauthorized, please use your project api key" }
 *   429 -> { message: "Rate limit exceeded…", waitMinutes, maxRequests, timeWindowMinutes }
 *   500 -> { message: "Internal server error" }
 * The verification type renders the vendor's own template around the code, so
 * our bilingual `body` is NOT sent — OTPIQ's WhatsApp/Telegram templates are
 * the vendor's. (smsType "custom" carries our text via `customMessage` but
 * always goes over SMS and needs an approved senderId.)
 *
 * Vendor-side anti-fraud (per-phone and per-IP OTP caps, configurable in the
 * OTPIQ dashboard "Limits" tab) answers 429 — surfaced here as
 * SmsProviderError status 429, which the hook stamps `failed`.
 *
 * Secrets: OTPIQ_API_KEY; optional OTPIQ_PROVIDER (default "sms" — owner's
 * decision 2026-09-12: SMS only, no WhatsApp; "whatsapp-sms" would try WhatsApp
 * first and fall back to SMS), OTPIQ_SENDER_ID.
 */
import { SmsProviderError, type SmsChannel, type SmsProvider, type SmsSendArgs, type SmsSendResult } from './types.ts';

export const OTPIQ_SEND_URL = 'https://api.otpiq.com/api/sms';

export function otpiqProvider(env: { apiKey: string; provider?: string; senderId?: string }): SmsProvider {
  const routing = env.provider?.trim() || 'sms';
  return {
    name: 'otpiq',
    async send(args: SmsSendArgs): Promise<SmsSendResult> {
      const body: Record<string, unknown> = {
        phoneNumber: args.to.replace(/^\+/, ''),
        smsType: 'verification',
        verificationCode: args.code,
        provider: routing,
      };
      if (env.senderId) body.senderId = env.senderId;
      const res = await fetch(OTPIQ_SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        smsId?: string;
        cost?: number;
        remainingCredit?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new SmsProviderError('otpiq', `otpiq ${res.status}: ${data.error ?? data.message ?? 'send failed'}`, res.status);
      }
      // The channel that actually delivered is only known from trackSms later;
      // record the first channel of the routing string.
      const first = routing.split('-')[0] as SmsChannel;
      const channel: SmsChannel = first === 'whatsapp' || first === 'telegram' ? first : 'sms';
      return {
        id: data.smsId,
        channel,
        costIqd: typeof data.cost === 'number' ? Math.round(data.cost) : undefined,
        remainingCredit: typeof data.remainingCredit === 'number' ? data.remainingCredit : undefined,
      };
    },
  };
}
