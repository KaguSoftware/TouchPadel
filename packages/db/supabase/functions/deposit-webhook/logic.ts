/**
 * deposit-webhook, the pure half (no Deno, no npm:, no database): what a
 * notification says, which payment row it may speak for, and what may be
 * applied from its body. tests/deposit-webhook.test.ts runs it under vitest.
 *
 * Qi signs ONLY `paymentId|amount|currency|creationDate|status`
 * (_shared/payments/verify.ts). Everything else in the body — requestId,
 * confirmedAmount, canceled — is unsigned, so:
 *   - the row is found by the SIGNED paymentId first; the unsigned requestId
 *     is only a fallback for a row that has no payment id yet, and a row it
 *     finds that already carries a DIFFERENT payment id is refused;
 *   - when Qi's status call gives no answer, the body is applied only for a
 *     row that already carries the signed paymentId, and only with the signed
 *     `amount`, never `confirmedAmount`.
 */

import { isUuid } from '../_shared/http.ts';

/** What one notification claims. `amount` is the signed field; `confirmedAmount` is never read. */
export interface WebhookFacts {
  /** Unsigned: our id for the attempt, a hint for finding the row. */
  requestId: string | null;
  /** Signed. */
  paymentId: string | null;
  /** Signed. */
  status: string | null;
  /** Signed: the `amount` field, a finite number, else null. */
  amount: number | null;
  /** Signed. */
  currency: string | null;
  /** Unsigned; deposit_apply weighs it with the signed status. */
  canceled: boolean;
}

export function webhookFacts(payload: Record<string, unknown>): WebhookFacts {
  return {
    requestId: isUuid(payload.requestId) ? payload.requestId : null,
    paymentId: typeof payload.paymentId === 'string' && payload.paymentId.trim() ? payload.paymentId : null,
    status: typeof payload.status === 'string' && payload.status ? payload.status : null,
    amount: typeof payload.amount === 'number' && Number.isFinite(payload.amount) ? payload.amount : null,
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    canceled: payload.canceled === true,
  };
}

/** The two columns of a booking_payments row the match needs. */
export interface RowKeys {
  request_id: string;
  provider_payment_id: string | null;
}

export type WebhookMatch<R extends RowKeys> =
  | { row: R; by: 'payment_id' | 'request_id' }
  | { row: null; reason: 'no_row' }
  | { row: null; reason: 'payment_id_mismatch'; conflicting: R };

/**
 * The row a notification speaks for. `byPaymentId` is the row whose
 * provider_payment_id equals the notification's paymentId (looked up first);
 * `byRequestId` the row with its requestId, read only when the first is null.
 */
export function matchWebhookRow<R extends RowKeys>(
  facts: Pick<WebhookFacts, 'paymentId'>,
  byPaymentId: R | null,
  byRequestId: R | null,
): WebhookMatch<R> {
  if (byPaymentId) return { row: byPaymentId, by: 'payment_id' };
  if (!byRequestId) return { row: null, reason: 'no_row' };
  // The requestId is unsigned: a row it names that already belongs to another
  // payment is not this notification's row, whatever the body says.
  if (facts.paymentId && byRequestId.provider_payment_id && byRequestId.provider_payment_id !== facts.paymentId) {
    return { row: null, reason: 'payment_id_mismatch', conflicting: byRequestId };
  }
  return { row: byRequestId, by: 'request_id' };
}

/** What deposit_apply is handed when the body itself is applied. */
export interface BodyAnswer {
  paymentId: string;
  status: string;
  amount: number | null;
  currency: string | null;
  canceled: boolean;
}

/**
 * The fallback (Qi's status call gave no answer): the body is Qi's word only
 * when its signature verified AND the row already carries the signed
 * paymentId. A row found through the unsigned requestId (no payment id yet)
 * waits for Qi's status call, the poll or the reconciler instead. The amount
 * is the signed `amount`, never `confirmedAmount`.
 */
export function bodyAnswer<R extends RowKeys>(
  facts: WebhookFacts,
  match: WebhookMatch<R>,
  signatureOk: boolean | null,
): BodyAnswer | null {
  if (signatureOk !== true || !('by' in match) || match.by !== 'payment_id') return null;
  if (!facts.status || !facts.paymentId) return null;
  return {
    paymentId: facts.paymentId,
    status: facts.status,
    amount: facts.amount,
    currency: facts.currency,
    canceled: facts.canceled,
  };
}

/** One key's verdict: true verified, false a key is set and did not verify, null no key set. */
export type KeyVerdict = boolean | null;

/**
 * Before any database access, over both keys: true when either verified;
 * false when at least one key is set and none verified (refused, 401, no
 * event row); null when no key is set at all (the notification is then only
 * a hint to go and ask Qi, header of index.ts). So with only the live key
 * set, a sandbox payment's notification is refused too: it cannot be
 * verified, and the poll and the reconciler still settle that payment.
 */
export function anyKeyVerdict(live: KeyVerdict, sandbox: KeyVerdict): KeyVerdict {
  if (live === true || sandbox === true) return true;
  if (live === false || sandbox === false) return false;
  return null;
}

/**
 * After the lookup: the verdict of the key for the row's own environment.
 * false (the other environment's key verified it, this one did not) is a
 * refusal; null (this environment has no key) leaves the notification a hint.
 */
export function rowKeyVerdict(row: { sandbox: boolean } | null, live: KeyVerdict, sandbox: KeyVerdict): KeyVerdict {
  if (!row) return anyKeyVerdict(live, sandbox);
  return row.sandbox ? sandbox : live;
}
