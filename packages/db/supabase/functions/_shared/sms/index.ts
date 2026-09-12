/**
 * sendSms — the single door to the SMS / WhatsApp vendor (see ./types.ts for
 * the contract and the swap recipe). Callers pass an env getter rather than
 * reading Deno.env here so the module stays pure and runs under vitest.
 *
 * Provider selection from secrets. Unknown / unset => `log` (spends nothing),
 * with one console line per call so a hosted deploy that forgot SMS_PROVIDER is
 * visible in the function log rather than silently "working".
 */
import { logProvider } from './log.ts';
import { otpiqProvider } from './otpiq.ts';
import { twilioProvider } from './twilio.ts';
import { SmsProviderError, type SmsProvider, type SmsSendArgs, type SmsSendResult } from './types.ts';

export type { SmsChannel, SmsProvider, SmsSendArgs, SmsSendResult } from './types.ts';
export { SmsProviderError } from './types.ts';

export type EnvGetter = (name: string) => string | undefined;

/** Known adapter names, i.e. the legal values of SMS_PROVIDER. */
export const SMS_PROVIDERS = ['log', 'twilio', 'otpiq'] as const;

export interface SmsSent extends SmsSendResult {
  /** Which adapter delivered — what the send log stamps. */
  provider: string;
}

/**
 * Send one text through the configured vendor. Resolves with the vendor's
 * result plus the adapter name; rejects with SmsProviderError (never a raw
 * error) so a caller can stamp `error.provider` without knowing the adapter.
 */
export async function sendSms(args: SmsSendArgs, get: EnvGetter): Promise<SmsSent> {
  const provider = smsFromEnv(get);
  try {
    const result = await provider.send(args);
    return { ...result, provider: provider.name };
  } catch (error) {
    if (error instanceof SmsProviderError) throw error;
    throw new SmsProviderError(provider.name, error instanceof Error ? error.message : String(error));
  }
}

/** The adapter SMS_PROVIDER names, built from secrets. Exported for the contract test and for callers that only need the name. */
export function smsFromEnv(get: EnvGetter): SmsProvider {
  const name = (get('SMS_PROVIDER') ?? '').trim().toLowerCase();
  // `supabase functions serve` sets no SUPABASE_ENV; hosted sets "production".
  const isLocal = !get('SUPABASE_ENV') || get('SUPABASE_ENV') === 'local';

  if (name === 'twilio') {
    const accountSid = get('TWILIO_ACCOUNT_SID') ?? '';
    const authToken = get('TWILIO_AUTH_TOKEN') ?? '';
    const from = get('TWILIO_FROM') ?? '';
    if (accountSid && authToken && from) return twilioProvider({ accountSid, authToken, from });
    console.warn('[sms] SMS_PROVIDER=twilio but TWILIO_* secrets are incomplete; using log');
    return logProvider(isLocal);
  }
  if (name === 'otpiq') {
    const apiKey = get('OTPIQ_API_KEY') ?? '';
    if (apiKey) {
      return otpiqProvider({ apiKey, provider: get('OTPIQ_PROVIDER'), senderId: get('OTPIQ_SENDER_ID') });
    }
    console.warn('[sms] SMS_PROVIDER=otpiq but OTPIQ_API_KEY is unset; using log');
    return logProvider(isLocal);
  }
  if (name && name !== 'log') {
    console.warn(`[sms] unknown SMS_PROVIDER "${name}"; using log`);
  }
  return logProvider(isLocal);
}
