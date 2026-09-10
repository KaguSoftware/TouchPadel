/**
 * Provider selection from secrets. Unknown / unset => `log` (spends nothing),
 * with one console line so a hosted deploy that forgot SMS_PROVIDER is visible
 * in the function log rather than silently "working".
 */
import { logProvider } from './log.ts';
import { otpiqProvider } from './otpiq.ts';
import { twilioProvider } from './twilio.ts';
import type { SmsProvider } from './types.ts';

export function providerFromEnv(get: (name: string) => string | undefined): SmsProvider {
  const name = (get('SMS_PROVIDER') ?? '').trim().toLowerCase();
  // `supabase functions serve` sets no SUPABASE_ENV; hosted sets "production".
  const isLocal = !get('SUPABASE_ENV') || get('SUPABASE_ENV') === 'local';

  if (name === 'twilio') {
    const accountSid = get('TWILIO_ACCOUNT_SID') ?? '';
    const authToken = get('TWILIO_AUTH_TOKEN') ?? '';
    const from = get('TWILIO_FROM') ?? '';
    if (accountSid && authToken && from) return twilioProvider({ accountSid, authToken, from });
    console.warn(
      '[send-sms-otp] SMS_PROVIDER=twilio but TWILIO_* secrets are incomplete; using log',
    );
    return logProvider(isLocal);
  }
  if (name === 'otpiq') {
    const apiKey = get('OTPIQ_API_KEY') ?? '';
    if (apiKey) {
      return otpiqProvider({
        apiKey,
        provider: get('OTPIQ_PROVIDER'),
        senderId: get('OTPIQ_SENDER_ID'),
      });
    }
    console.warn('[send-sms-otp] SMS_PROVIDER=otpiq but OTPIQ_API_KEY is unset; using log');
    return logProvider(isLocal);
  }
  if (name && name !== 'log') {
    console.warn(`[send-sms-otp] unknown SMS_PROVIDER "${name}"; using log`);
  }
  return logProvider(isLocal);
}
