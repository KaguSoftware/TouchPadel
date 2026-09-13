/**
 * _shared/sms — the ONE seam between this codebase and whichever vendor
 * delivers a text (SMS / WhatsApp / Telegram). Every edge function that needs
 * to text a guest calls `sendSms()` from ./index.ts and nothing else; no other
 * file knows a vendor's hostname, secret names or payload shape (enforced by
 * packages/db/tests/sms-provider.test.ts).
 *
 * Swapping the vendor:
 *   - to an adapter that already exists here: `supabase secrets set
 *     SMS_PROVIDER=<name>` plus that vendor's keys. No code, no deploy.
 *   - to a new vendor: one new file implementing SmsProvider, one branch in
 *     smsFromEnv (index.ts), its secret names in functions/.env.example, and
 *     the contract test runs against it with a mocked fetch.
 *
 * What the interface guarantees and what it does not: every adapter delivers
 * `code` to `to`, reports the vendor's message id / channel / cost when known,
 * and throws SmsProviderError on any failure. The WORDING of the message is
 * per vendor: Twilio sends `body` verbatim; OTPIQ's verification type wraps
 * the code in the vendor's own template and ignores `body`.
 */
export type SmsChannel = 'sms' | 'whatsapp' | 'telegram' | 'log';

export interface SmsSendArgs {
  /** E.164 with '+'. */
  to: string;
  /** Rendered message (already ≤ 70 UTF-16 units). Vendors with their own template ignore it. */
  body: string;
  /** The bare code, for vendors whose verification endpoint takes the code rather than a body. */
  code: string;
}

export interface SmsSendResult {
  /** Vendor message id, when the vendor returns one. */
  id?: string;
  /** Channel actually used (vendors with fallback report the one they will try first). */
  channel?: SmsChannel;
  /** Cost as the vendor reports it, in IQD when known. */
  costIqd?: number;
  /** Prepaid balance after this send, when the vendor reports it (the low-credit signal). */
  remainingCredit?: number;
}

export interface SmsProvider {
  readonly name: string;
  send(args: SmsSendArgs): Promise<SmsSendResult>;
}

export class SmsProviderError extends Error {
  readonly provider: string;
  readonly status?: number;
  constructor(provider: string, message: string, status?: number) {
    super(message);
    this.name = 'SmsProviderError';
    this.provider = provider;
    this.status = status;
  }
}
