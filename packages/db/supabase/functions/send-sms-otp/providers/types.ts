/**
 * send-sms-otp — the provider seam. One adapter per vendor, all the same
 * shape, chosen by the SMS_PROVIDER secret (providers/index.ts). Swapping the
 * Iraq SMS vendor is a one-file change here and a `supabase secrets set`.
 */
export type SmsChannel = 'sms' | 'whatsapp' | 'telegram' | 'log';

export interface SmsSendArgs {
  /** E.164 with '+'. */
  to: string;
  /** Rendered message (already ≤ 70 UTF-16 units). */
  body: string;
  /** The bare code, for vendors whose verification endpoint takes the code rather than a body. */
  code: string;
}

export interface SmsSendResult {
  /** Vendor message id, when the vendor returns one. */
  id?: string;
  /** Channel actually used (vendors with fallback report the one that delivered). */
  channel?: SmsChannel;
  /** Cost as the vendor reports it, in IQD when known. */
  costIqd?: number;
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
