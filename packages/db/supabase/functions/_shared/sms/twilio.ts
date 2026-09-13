/**
 * Twilio Programmable Messaging adapter.
 *
 * Iraq caveats (twilio.com/en-us/guidelines/iq/sms, read 2026-09-05): Zain and
 * Korek do not support numeric sender ids; Asiacell requires the alphanumeric
 * sender id to be PRE-REGISTERED (since 2026-07-01); two-way SMS is not
 * supported. So TWILIO_FROM must be the registered alphanumeric sender id
 * ("TouchPadel"), not a Twilio number, or delivery is best-effort at most.
 * WhatsApp via Twilio: set TWILIO_FROM to "whatsapp:+1…" (a WhatsApp sender)
 * — the recipient is then prefixed the same way.
 *
 * Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM.
 */
import { SmsProviderError, type SmsChannel, type SmsProvider, type SmsSendArgs, type SmsSendResult } from './types.ts';

export const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export function twilioProvider(env: {
  accountSid: string;
  authToken: string;
  from: string;
}): SmsProvider {
  const channel: SmsChannel = env.from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
  return {
    name: 'twilio',
    async send(args: SmsSendArgs): Promise<SmsSendResult> {
      const to = channel === 'whatsapp' ? `whatsapp:${args.to}` : args.to;
      const form = new URLSearchParams({ To: to, From: env.from, Body: args.body });
      const res = await fetch(`${TWILIO_API_BASE}/Accounts/${encodeURIComponent(env.accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${env.accountSid}:${env.authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
      if (!res.ok) {
        throw new SmsProviderError('twilio', `twilio ${res.status}${data.code ? ` (${data.code})` : ''}: ${data.message ?? 'send failed'}`, res.status);
      }
      return { id: data.sid, channel };
    },
  };
}
