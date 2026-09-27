/**
 * `fake` payments provider — the local stand-in for Qi (plan §8). Loadable
 * only under `supabase functions serve` (index.ts refuses it anywhere else).
 *
 * The "payment page" is the payments-fake edge function: its buttons record
 * what the pretend bank decided (an event with note 'fake:outcome' in
 * booking_payment_events) and send deposit-webhook a Qi-shaped notification.
 * status() reads that decision back, so the webhook path, the poll path and
 * the reconciler all see the same pretend bank the way they would see Qi.
 */
import {
  PaymentProviderError,
  type CreatePaymentArgs,
  type GatewayPayment,
  type GatewayRefund,
  type PaymentProvider,
  type RefundArgs,
} from './types.ts';

export interface FakeRecord {
  requestId: string;
  paymentId: string | null;
  amountIqd: number;
  /** What the pretend bank decided last; null = nothing yet (CREATED). */
  outcome: string | null;
  canceled: boolean;
  createdAt: string;
}

/** Reads and writes the pretend bank's state (the edge function wires it to the service client). */
export interface FakeStore {
  byPaymentId(paymentId: string): Promise<FakeRecord | null>;
  byRequestId(requestId: string): Promise<FakeRecord | null>;
  setOutcome(requestId: string, outcome: string, canceled: boolean): Promise<void>;
}

export const FAKE_PAYMENT_PREFIX = 'fake-';

export function fakePaymentId(requestId: string): string {
  return `${FAKE_PAYMENT_PREFIX}${requestId}`;
}

export function fakeProvider(opts: { pageUrl: string; store: FakeStore }): PaymentProvider {
  const page = opts.pageUrl.replace(/\/+$/, '');

  const toPayment = (r: FakeRecord): GatewayPayment => {
    const paymentId = r.paymentId ?? fakePaymentId(r.requestId);
    const status = r.outcome ?? 'CREATED';
    return {
      requestId: r.requestId,
      paymentId,
      status,
      canceled: r.canceled,
      amount: r.amountIqd,
      currency: 'IQD',
      formUrl: `${page}?ref=${encodeURIComponent(r.requestId)}`,
      creationDate: r.createdAt,
      raw: { requestId: r.requestId, paymentId, status, canceled: r.canceled, amount: r.amountIqd, currency: 'IQD', fake: true },
    };
  };

  const notFound = (what: string) => new PaymentProviderError('fake', 'not_found', `fake: no payment ${what}`, 12, 403);

  return {
    name: 'fake',

    async create(args: CreatePaymentArgs): Promise<GatewayPayment> {
      const r = await opts.store.byRequestId(args.requestId);
      return toPayment(
        r ?? {
          requestId: args.requestId,
          paymentId: fakePaymentId(args.requestId),
          amountIqd: args.amountIqd,
          outcome: null,
          canceled: false,
          createdAt: new Date().toISOString().slice(0, 19),
        },
      );
    },

    async status(paymentId: string): Promise<GatewayPayment> {
      const r = await opts.store.byPaymentId(paymentId);
      if (!r) throw notFound(paymentId);
      return toPayment(r);
    },

    async statusByRequest(requestId: string): Promise<GatewayPayment> {
      const r = await opts.store.byRequestId(requestId);
      if (!r) throw notFound(requestId);
      return toPayment(r);
    },

    async cancel(paymentId: string): Promise<GatewayPayment> {
      const r = await opts.store.byPaymentId(paymentId);
      if (!r) throw notFound(paymentId);
      if (r.outcome === 'SUCCESS') {
        throw new PaymentProviderError('fake', 'refused', 'fake: a paid payment cannot be cancelled', 15, 403);
      }
      await opts.store.setOutcome(r.requestId, r.outcome ?? 'CREATED', true);
      return toPayment({ ...r, canceled: true });
    },

    async refund(args: RefundArgs): Promise<GatewayRefund> {
      const r = await opts.store.byPaymentId(args.paymentId);
      if (!r || r.outcome !== 'SUCCESS') {
        throw new PaymentProviderError('fake', 'refused', 'fake: the payment is not in refundable state', 18, 403);
      }
      return { refundId: `fake-refund-${args.refundRequestId}`, status: 'SUCCESS', raw: { fake: true, status: 'SUCCESS' } };
    },
  };
}

// ── the fake page's notifications (local stack only) ────────────────────────
// Signed with an HMAC of the service role key: both the page and the webhook
// function hold it, nothing outside the local stack does, and no key pair has
// to be committed.

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function signFakeNotification(secret: string, body: string): Promise<string> {
  return hmacHex(secret, `fake-payments:${body}`);
}

export async function verifyFakeSignature(secret: string, body: string, signature: string): Promise<boolean> {
  if (!secret || !signature) return false;
  const expected = await signFakeNotification(secret, body);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
