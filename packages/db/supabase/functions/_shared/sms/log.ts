/**
 * `log` provider — sends nothing. The default when SMS_PROVIDER is unset or
 * unknown, so a misconfigured deploy can never spend money; the caller still
 * gets a result (channel 'log', cost 0) so the flow is observable end to end.
 * The code is logged ONLY under `supabase functions serve` (no SUPABASE_ENV)
 * — never on hosted, where the function log is readable by every dashboard
 * member.
 */
import type { SmsProvider, SmsSendArgs, SmsSendResult } from './types.ts';

export function logProvider(isLocal: boolean): SmsProvider {
  return {
    name: 'log',
    send(args: SmsSendArgs): Promise<SmsSendResult> {
      if (isLocal) {
        console.log(`[sms] (log provider) to=${args.to} code=${args.code}`);
      } else {
        console.log(`[sms] (log provider) to=${args.to.slice(0, 6)}… code=<redacted>`);
      }
      return Promise.resolve({ id: `log-${Date.now()}`, channel: 'log', costIqd: 0 });
    },
  };
}
