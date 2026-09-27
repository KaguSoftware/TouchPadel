/**
 * What of a gateway message we keep. Every message lands in
 * booking_payment_events.raw and in the function log; card data and the
 * guest's contact details never do (plan §4: same rule as sms/log.ts).
 *
 * Allow-list, not deny-list: a field the gateway adds tomorrow is dropped
 * until someone decides it is safe to keep.
 */
const KEEP_TOP = [
  'requestId', 'paymentId', 'status', 'canceled', 'amount', 'confirmedAmount', 'currency',
  'paymentType', 'creationDate', 'withoutAuthenticate', 'appChannel', 'refundId', 'error',
] as const;
const KEEP_DETAILS = ['resultCode', 'authDate', 'paymentSystem'] as const;
const KEEP_CANCEL = ['requestId', 'created', 'successfully', 'amount'] as const;

function pick(src: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function redactGatewayMessage(body: unknown): Record<string, unknown> {
  if (!isObject(body)) return {};
  const out = pick(body, KEEP_TOP);
  if (isObject(body.details)) out.details = pick(body.details, KEEP_DETAILS);
  if (Array.isArray(body.cancels)) {
    out.cancels = body.cancels.filter(isObject).slice(0, 10).map((c) => pick(c, KEEP_CANCEL));
  }
  if (isObject(body.additionalInfo)) {
    // Ours (reservation_id, request_id): ids only, no personal data.
    out.additionalInfo = Object.fromEntries(
      Object.entries(body.additionalInfo)
        .filter(([k, v]) => typeof v === 'string' && /^[a-z_]{1,40}$/.test(k))
        .slice(0, 10),
    );
  }
  return out;
}
