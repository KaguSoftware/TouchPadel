/**
 * OTPIQ adapter (otpiq.com — Iraqi aggregator with direct Zain / Asiacell /
 * Korek routes and WhatsApp / Telegram channels with SMS fallback).
 *
 * Written from the vendor's public client libraries (YadaCoder/otpiq,
 * Rstacode/otpiq) as of 2026-09-05, NOT from a signed contract — RE-VERIFY the
 * request shape against the account's API docs at activation
 * (docs/client/phone-otp-activation.md). What those libraries agree on:
 *   POST https://api.otpiq.com/api/sms
 *   Authorization: Bearer <OTPIQ_API_KEY>
 *   { phoneNumber: "9647701234567",          // digits, no '+'
 *     smsType: "verification",
 *     verificationCode: "123456",
 *     provider: "auto" | "sms" | "whatsapp" | "telegram" | "whatsapp-sms" | "whatsapp-telegram-sms",
 *     senderId?: "TouchPadel" }              // optional, must be approved on the account
 *   -> { smsId, cost, remainingCredit, message, ... }
 * The verification type renders the vendor's own template around the code, so
 * our bilingual body is not sent — OTPIQ's WhatsApp/Telegram templates are the
 * vendor's. (smsType "custom" would carry our text but always goes over SMS
 * and needs an approved senderId.)
 *
 * Secrets: OTPIQ_API_KEY; optional OTPIQ_PROVIDER (default "whatsapp-sms"),
 * OTPIQ_SENDER_ID.
 */
import { SmsProviderError, type SmsChannel, type SmsProvider, type SmsSendArgs, type SmsSendResult } from './types.ts';

export function otpiqProvider(env: { apiKey: string; provider?: string; senderId?: string }): SmsProvider {
  const routing = env.provider?.trim() || 'whatsapp-sms';
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
      const res = await fetch('https://api.otpiq.com/api/sms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        smsId?: string;
        cost?: number;
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
      };
    },
  };
}
