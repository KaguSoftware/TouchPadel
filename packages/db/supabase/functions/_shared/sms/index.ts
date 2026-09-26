/**
 * sendSms — the single door to the SMS / WhatsApp vendor (see ./types.ts for
 * the contract and the swap recipe). Callers pass an env getter rather than
 * reading Deno.env here so the module stays pure and runs under vitest.
 *
 * Provider selection from secrets: see smsFromEnv. Unset => `log` (spends
 * nothing); a named vendor with missing secrets, or an unknown name, fails
 * every send loudly rather than falling back to `log`.
 */
import { logProvider } from './log.ts';
import { otpiqProvider } from './otpiq.ts';
import { twilioProvider } from './twilio.ts';
import { whatsappProvider } from './whatsapp.ts';
import { SmsProviderError, type SmsLang, type SmsProvider, type SmsSendArgs, type SmsSendResult } from './types.ts';

export type { SmsChannel, SmsLang, SmsProvider, SmsSendArgs, SmsSendResult } from './types.ts';
export { SmsProviderError } from './types.ts';

export type EnvGetter = (name: string) => string | undefined;

/** Known adapter names, i.e. the legal values of SMS_PROVIDER. */
export const SMS_PROVIDERS = ['log', 'twilio', 'otpiq', 'whatsapp'] as const;

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

/**
 * True only when this clearly runs under `supabase functions serve`: the
 * platform URL points at the local gateway. Anything else, including a
 * missing URL, counts as HOSTED so the log adapter redacts the code.
 * (Supabase injects no environment-name variable on hosted, so the URL is the
 * signal both runtimes share.)
 */
export function isLocalRuntime(get: EnvGetter): boolean {
  const url = (get('SUPABASE_URL') ?? '').trim();
  return /^http:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?(\/|$)/.test(url);
}

/**
 * An adapter that refuses every send. Used when SMS_PROVIDER names a vendor
 * whose secrets are incomplete, or names no known vendor: the send log then
 * shows `failed` with the reason, instead of a silent "sent" through `log`
 * while no guest receives anything. This is what makes a vendor swap safe to
 * do with one command: a typo is loud on the very first code.
 */
function misconfigured(name: string, reason: string): SmsProvider {
  console.error(`[sms] SMS_PROVIDER=${name} is misconfigured: ${reason}`);
  return {
    name,
    send(): Promise<SmsSendResult> {
      return Promise.reject(new SmsProviderError(name, `misconfigured: ${reason}`));
    },
  };
}

/**
 * The adapter SMS_PROVIDER names, built from secrets. Exported for the
 * contract test and for callers that only need the name.
 *   unset or "log"          -> log (spends nothing; the shipped default)
 *   a known name, keys set  -> that vendor
 *   a known name, keys gone -> misconfigured (every send fails, reason logged)
 *   an unknown name         -> misconfigured
 * Only the chosen vendor's secrets are read, so the next vendor's secrets can
 * sit on the project in advance and the swap is `secrets set SMS_PROVIDER=…`.
 */
export function smsFromEnv(get: EnvGetter): SmsProvider {
  const name = (get('SMS_PROVIDER') ?? '').trim().toLowerCase();
  const has = (key: string) => (get(key) ?? '').trim() !== '';
  const missing = (keys: string[]) => keys.filter((k) => !has(k));

  if (name === '' || name === 'log') return logProvider(isLocalRuntime(get));

  if (name === 'otpiq') {
    const gone = missing(['OTPIQ_API_KEY']);
    if (gone.length) return misconfigured(name, `missing ${gone.join(', ')}`);
    return otpiqProvider({ apiKey: get('OTPIQ_API_KEY')!.trim(), provider: get('OTPIQ_PROVIDER'), senderId: get('OTPIQ_SENDER_ID') });
  }
  if (name === 'whatsapp') {
    const gone = missing(['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']);
    if (gone.length) return misconfigured(name, `missing ${gone.join(', ')}`);
    const defaultLang = get('WHATSAPP_DEFAULT_LANG')?.trim();
    return whatsappProvider({
      accessToken: get('WHATSAPP_ACCESS_TOKEN')!.trim(),
      phoneNumberId: get('WHATSAPP_PHONE_NUMBER_ID')!.trim(),
      templateName: get('WHATSAPP_TEMPLATE_NAME')?.trim() || 'touch_otp',
      langCodes: { en: get('WHATSAPP_TEMPLATE_LANG_EN'), ar: get('WHATSAPP_TEMPLATE_LANG_AR') },
      defaultLang: defaultLang === 'en' || defaultLang === 'ar' ? (defaultLang as SmsLang) : undefined,
      graphVersion: get('WHATSAPP_GRAPH_VERSION'),
    });
  }
  if (name === 'twilio') {
    const gone = missing(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']);
    if (gone.length) return misconfigured(name, `missing ${gone.join(', ')}`);
    return twilioProvider({
      accountSid: get('TWILIO_ACCOUNT_SID')!.trim(),
      authToken: get('TWILIO_AUTH_TOKEN')!.trim(),
      from: get('TWILIO_FROM')!.trim(),
    });
  }
  return misconfigured(name, `unknown provider (expected one of ${SMS_PROVIDERS.join(', ')})`);
}
