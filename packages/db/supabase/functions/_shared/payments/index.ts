/**
 * paymentsFromEnv — the single door to the payment gateway (see ./types.ts
 * for the contract). Callers pass an env getter rather than reading Deno.env
 * here, so the module stays pure and runs under vitest.
 *
 * Selection from secrets (docs/client/qi-card-activation.md):
 *   PAYMENTS_PROVIDER unset       → misconfigured: every call refused, nothing
 *                                   charged; the app offers pay-at-the-desk
 *   PAYMENTS_PROVIDER=qi          → Qi with QI_BASE_URL, QI_TERMINAL_ID,
 *                                   QI_USERNAME, QI_PASSWORD (+ optional
 *                                   QI_SIGNING_PRIVATE_KEY_PEM); a missing one
 *                                   → misconfigured, reason logged
 *     a sandbox payment (profiles.payment_sandbox, the store review account)
 *                                 → Qi's sandbox with QI_SANDBOX_TERMINAL_ID,
 *                                   QI_SANDBOX_USERNAME, QI_SANDBOX_PASSWORD
 *                                   (QI_SANDBOX_BASE_URL defaults to Qi's)
 *   PAYMENTS_PROVIDER=fake        → the local stand-in, ONLY under
 *                                   `supabase functions serve`
 *   anything else                 → misconfigured
 *
 * Webhook keys: QI_WEBHOOK_PUBLIC_KEY_PEM (and QI_SANDBOX_WEBHOOK_PUBLIC_KEY_PEM),
 * read through webhookKeyFromEnv. Without a key a webhook is only a hint to
 * go and ask Qi (deposit-webhook explains why that is still safe).
 */
import { isLocalRuntime } from '../http.ts';
import { fakeProvider, type FakeStore } from './fake.ts';
import { QI_SANDBOX_BASE_URL, qiProvider } from './qi.ts';
import { PaymentProviderError, type PaymentProvider } from './types.ts';

export type { CreatePaymentArgs, GatewayPayment, GatewayRefund, PaymentProvider, RefundArgs } from './types.ts';
export { PaymentProviderError } from './types.ts';
export type { FakeStore, FakeRecord } from './fake.ts';
export { FAKE_PAYMENT_PREFIX, fakePaymentId, signFakeNotification, verifyFakeSignature } from './fake.ts';
export { redactGatewayMessage } from './redact.ts';
export { verifyQiWebhook } from './verify.ts';

export type EnvGetter = (name: string) => string | undefined;

/** Legal values of PAYMENTS_PROVIDER, i.e. booking_payments.provider. */
export const PAYMENT_PROVIDERS = ['qi', 'fake'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/** The platform URL points at the local gateway (one copy for every function: ../http.ts). */
export { isLocalRuntime };

/** The provider name new payments are recorded with, or null when none is usable. */
export function configuredProviderName(get: EnvGetter): PaymentProviderName | null {
  const name = (get('PAYMENTS_PROVIDER') ?? '').trim().toLowerCase();
  if (name === 'qi') return 'qi';
  if (name === 'fake' && isLocalRuntime(get)) return 'fake';
  return null;
}

function misconfigured(name: string, reason: string): PaymentProvider {
  console.error(`[payments] ${name} is misconfigured: ${reason}`);
  const refuse = () => Promise.reject(new PaymentProviderError(name, 'config', `misconfigured: ${reason}`));
  return { name, create: refuse, status: refuse, statusByRequest: refuse, cancel: refuse, refund: refuse };
}

/**
 * The adapter for one payment: `provider` is the row's (booking_payments.provider),
 * so a payment is always finished by the gateway it began on.
 */
export function paymentsFromEnv(
  get: EnvGetter,
  opts: { provider: string; sandbox: boolean; fakeStore?: FakeStore; fakePageUrl?: string },
): PaymentProvider {
  const has = (k: string) => (get(k) ?? '').trim() !== '';
  const val = (k: string) => (get(k) ?? '').trim();

  if (opts.provider === 'fake') {
    if (!isLocalRuntime(get)) return misconfigured('fake', 'the fake provider only runs on the local stack');
    if (!opts.fakeStore || !opts.fakePageUrl) return misconfigured('fake', 'no fake store wired');
    return fakeProvider({ pageUrl: opts.fakePageUrl, store: opts.fakeStore });
  }

  if (opts.provider === 'qi') {
    const signingKeyPem = has('QI_SIGNING_PRIVATE_KEY_PEM') ? val('QI_SIGNING_PRIVATE_KEY_PEM') : null;
    if (opts.sandbox) {
      const gone = ['QI_SANDBOX_TERMINAL_ID', 'QI_SANDBOX_USERNAME', 'QI_SANDBOX_PASSWORD'].filter((k) => !has(k));
      if (gone.length) return misconfigured('qi-sandbox', `missing ${gone.join(', ')}`);
      return qiProvider({
        baseUrl: has('QI_SANDBOX_BASE_URL') ? val('QI_SANDBOX_BASE_URL') : QI_SANDBOX_BASE_URL,
        terminalId: val('QI_SANDBOX_TERMINAL_ID'),
        username: val('QI_SANDBOX_USERNAME'),
        password: val('QI_SANDBOX_PASSWORD'),
        label: 'qi-sandbox',
      });
    }
    const gone = ['QI_BASE_URL', 'QI_TERMINAL_ID', 'QI_USERNAME', 'QI_PASSWORD'].filter((k) => !has(k));
    if (gone.length) return misconfigured('qi', `missing ${gone.join(', ')}`);
    if (!/^https:\/\//.test(val('QI_BASE_URL'))) return misconfigured('qi', 'QI_BASE_URL must be https');
    return qiProvider({
      baseUrl: val('QI_BASE_URL'),
      terminalId: val('QI_TERMINAL_ID'),
      username: val('QI_USERNAME'),
      password: val('QI_PASSWORD'),
      signingKeyPem,
      label: 'qi',
    });
  }

  return misconfigured(opts.provider || '(unset)', `unknown provider (expected one of ${PAYMENT_PROVIDERS.join(', ')})`);
}

/** Qi's webhook public key for a payment (prod or sandbox), or null when not set. */
export function webhookKeyFromEnv(get: EnvGetter, sandbox: boolean): string | null {
  const v = (get(sandbox ? 'QI_SANDBOX_WEBHOOK_PUBLIC_KEY_PEM' : 'QI_WEBHOOK_PUBLIC_KEY_PEM') ?? '').trim();
  return v || null;
}

/**
 * Where Qi sends the guest's browser when the payment page is done: the
 * website's return page, which opens the app (apps/web /{locale}/pay/return).
 * PAYMENTS_SITE_URL overrides the origin (local runs, a preview site).
 */
export function finishPaymentUrl(get: EnvGetter, locale: 'en' | 'ar', requestId: string): string {
  const origin = ((get('PAYMENTS_SITE_URL') ?? '').trim() || 'https://www.touch-padel.com').replace(/\/+$/, '');
  return `${origin}/${locale}/pay/return?ref=${encodeURIComponent(requestId)}`;
}

/** Where Qi POSTs status changes: this project's deposit-webhook function. */
export function notificationUrl(get: EnvGetter): string {
  const override = (get('PAYMENTS_FUNCTIONS_URL') ?? '').trim();
  const base = override || `${(get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '')}/functions/v1`;
  return `${base.replace(/\/+$/, '')}/deposit-webhook`;
}

/** The public URL of the local fake payment page (the phone must reach it). */
export function fakePageUrl(get: EnvGetter): string {
  const override = (get('PAYMENTS_FAKE_PAGE_URL') ?? '').trim();
  return override || 'http://127.0.0.1:54321/functions/v1/payments-fake';
}
