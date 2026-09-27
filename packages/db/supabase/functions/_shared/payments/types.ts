/**
 * _shared/payments — the ONE seam between this codebase and the card payment
 * gateway (Qi Card). The deposit edge functions call `paymentsFromEnv()` from
 * ./index.ts and nothing else; no other file knows the gateway's hostname,
 * headers, secret names or field names (packages/db/tests/payments-provider.test.ts
 * enforces it).
 *
 * Plan: docs/design/payments/qi-deposit-plan-2026-09-20.md §4.
 * Activation (the secrets to set): docs/client/qi-card-activation.md.
 *
 * What the interface guarantees: every call either resolves with the gateway's
 * payment object as it stands, or throws PaymentProviderError saying whether it
 * is worth retrying. Nothing here ever decides that a payment succeeded or
 * failed: the database (app.deposit_apply) does, from the object returned.
 */

/** The app's two languages. */
export type PaymentLocale = 'en' | 'ar';

export interface CreatePaymentArgs {
  /** Ours, a UUID, unique per terminal and never reused (booking_payments.request_id). */
  requestId: string;
  /** Whole dinars. */
  amountIqd: number;
  locale: PaymentLocale;
  /** Where the gateway sends the guest's browser when the payment page is done. */
  finishPaymentUrl: string;
  /** Where the gateway POSTs status changes (deposit-webhook). */
  notificationUrl: string;
  customer: { phone?: string | null; name?: string | null; accountId?: string | null };
  /** Echoed back by the gateway; shown in its merchant dashboard. */
  additionalInfo: Record<string, string>;
}

/** The gateway's payment object, reduced to what the state machine reads. */
export interface GatewayPayment {
  requestId: string | null;
  paymentId: string;
  /** Raw status string (SUCCESS, FAILED, CREATED, AUTHENTICATION_FAILED, …). */
  status: string;
  canceled: boolean;
  /** The amount the gateway reports (confirmedAmount when present). */
  amount: number | null;
  currency: string | null;
  formUrl: string | null;
  creationDate: string | null;
  /** The object as received, card data removed (./redact.ts). */
  raw: Record<string, unknown>;
}

export interface RefundArgs {
  paymentId: string;
  /** Ours, minted once per refund (booking_payments.refund_request_id). */
  refundRequestId: string;
  amountIqd: number;
  message?: string;
}

export interface GatewayRefund {
  refundId: string | null;
  /** SUCCESS | FAILED | anything else = still processing. */
  status: string;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: 'qi' | 'fake' | string;
  create(args: CreatePaymentArgs): Promise<GatewayPayment>;
  /** requestId: the payment's own, when known (signature-based auth signs it). */
  status(paymentId: string, requestId?: string | null): Promise<GatewayPayment>;
  statusByRequest(requestId: string): Promise<GatewayPayment>;
  cancel(paymentId: string, cancelRequestId: string): Promise<GatewayPayment>;
  refund(args: RefundArgs): Promise<GatewayRefund>;
}

/**
 * Why a gateway call did not give an answer.
 *   kind 'transport'      no answer (timeout, DNS, 5xx): retry later, assume nothing
 *   kind 'already_used'   our requestId exists at the gateway: look it up instead
 *   kind 'not_found'      the gateway has no such payment / request
 *   kind 'refused'        a definite no (not refundable, cannot cancel, bad state)
 *   kind 'config'         credentials / terminal wrong, or the adapter is not set up
 */
export type PaymentErrorKind = 'transport' | 'already_used' | 'not_found' | 'refused' | 'config';

export class PaymentProviderError extends Error {
  readonly provider: string;
  readonly kind: PaymentErrorKind;
  /** The gateway's numeric error code, when it sent one. */
  readonly code?: number;
  readonly status?: number;
  constructor(provider: string, kind: PaymentErrorKind, message: string, code?: number, status?: number) {
    super(message);
    this.name = 'PaymentProviderError';
    this.provider = provider;
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}
