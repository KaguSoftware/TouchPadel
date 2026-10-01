/**
 * deposit-webhook, the pure half (supabase/functions/deposit-webhook/logic.ts),
 * no stack. Qi signs only `paymentId|amount|currency|creationDate|status`
 * (_shared/payments/verify.ts), so:
 *   - the row is looked up by the SIGNED paymentId first; the unsigned
 *     requestId only finds a row that has no payment id yet, and a row it
 *     names that belongs to another payment is refused;
 *   - when Qi's status call fails, the body is applied only for the row that
 *     already carries the signed paymentId, and with the signed `amount`,
 *     never the unsigned `confirmedAmount`;
 *   - a bad signature is refused before any database access.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  anyKeyVerdict,
  bodyAnswer,
  matchWebhookRow,
  rowKeyVerdict,
  webhookFacts,
} from '../supabase/functions/deposit-webhook/logic.ts';

const REQ_A = '0b9c4f3e-1a2b-4c5d-8e9f-0a1b2c3d4e5f';
const REQ_B = '6f5e4d3c-2b1a-4f9e-8d7c-6b5a4f3e2d1c';
const row = (request_id: string, provider_payment_id: string | null, sandbox = false) => ({ request_id, provider_payment_id, sandbox });

const payload = (over: Record<string, unknown> = {}) => ({
  requestId: REQ_A,
  paymentId: 'pay-1',
  status: 'SUCCESS',
  amount: 25000,
  confirmedAmount: 25000,
  currency: 'IQD',
  creationDate: '2026-10-01T10:00:00',
  canceled: false,
  ...over,
});

describe('webhookFacts', () => {
  it('reads the signed fields, and never confirmedAmount', () => {
    const f = webhookFacts(payload({ amount: 25000, confirmedAmount: 999999 }));
    expect(f).toEqual({ requestId: REQ_A, paymentId: 'pay-1', status: 'SUCCESS', amount: 25000, currency: 'IQD', canceled: false });
  });

  it('has no amount when the signed amount is missing, even if confirmedAmount is there', () => {
    expect(webhookFacts(payload({ amount: undefined, confirmedAmount: 25000 })).amount).toBeNull();
    expect(webhookFacts(payload({ amount: '25000' })).amount).toBeNull();
    expect(webhookFacts(payload({ amount: Number.NaN })).amount).toBeNull();
  });

  it('drops a requestId that is not a uuid and an empty paymentId', () => {
    const f = webhookFacts(payload({ requestId: 'x; drop table', paymentId: '  ' }));
    expect(f.requestId).toBeNull();
    expect(f.paymentId).toBeNull();
  });
});

describe('matchWebhookRow: the signed paymentId first', () => {
  it('takes the row that already carries the signed paymentId, whatever requestId says', () => {
    const byPayment = row(REQ_B, 'pay-1');
    expect(matchWebhookRow({ paymentId: 'pay-1' }, byPayment, null)).toEqual({ row: byPayment, by: 'payment_id' });
  });

  it('falls back to the requestId row only while it has no payment id yet', () => {
    const fresh = row(REQ_A, null);
    expect(matchWebhookRow({ paymentId: 'pay-1' }, null, fresh)).toEqual({ row: fresh, by: 'request_id' });
  });

  it('refuses a requestId row that already belongs to a DIFFERENT payment', () => {
    const other = row(REQ_A, 'pay-9');
    expect(matchWebhookRow({ paymentId: 'pay-1' }, null, other)).toEqual({
      row: null,
      reason: 'payment_id_mismatch',
      conflicting: other,
    });
  });

  it('accepts the requestId row whose payment id is the signed one (the same payment)', () => {
    const same = row(REQ_A, 'pay-1');
    expect(matchWebhookRow({ paymentId: 'pay-1' }, null, same)).toEqual({ row: same, by: 'request_id' });
  });

  it('no row at all is unmatched', () => {
    expect(matchWebhookRow({ paymentId: 'pay-1' }, null, null)).toEqual({ row: null, reason: 'no_row' });
  });
});

describe('bodyAnswer: the fallback when Qi’s status call gives no answer', () => {
  const facts = webhookFacts(payload({ amount: 25000, confirmedAmount: 1 }));

  it('applies a verified body to the row that carries its paymentId, with the signed amount', () => {
    const m = matchWebhookRow(facts, row(REQ_A, 'pay-1'), null);
    expect(bodyAnswer(facts, m, true)).toEqual({ paymentId: 'pay-1', status: 'SUCCESS', amount: 25000, currency: 'IQD', canceled: false });
  });

  it('never applies an unverified body (no key set, or the fake HMAC absent)', () => {
    const m = matchWebhookRow(facts, row(REQ_A, 'pay-1'), null);
    expect(bodyAnswer(facts, m, null)).toBeNull();
    expect(bodyAnswer(facts, m, false)).toBeNull();
  });

  it('never applies a body to a row found only through the unsigned requestId', () => {
    // A genuine signed SUCCESS for some other payment, replayed with our requestId:
    // the row has no payment id yet, so the signature binds the body to nothing here.
    const m = matchWebhookRow(facts, null, row(REQ_A, null));
    expect(bodyAnswer(facts, m, true)).toBeNull();
  });

  it('never applies a body on a mismatch or with no row', () => {
    expect(bodyAnswer(facts, matchWebhookRow(facts, null, row(REQ_A, 'pay-9')), true)).toBeNull();
    expect(bodyAnswer(facts, matchWebhookRow(facts, null, null), true)).toBeNull();
  });

  it('needs a status and a paymentId', () => {
    const noStatus = webhookFacts(payload({ status: '' }));
    expect(bodyAnswer(noStatus, matchWebhookRow(noStatus, row(REQ_A, 'pay-1'), null), true)).toBeNull();
  });
});

describe('signature verdicts', () => {
  it('before the lookup: a set key that did not verify refuses, unless the other verified', () => {
    expect(anyKeyVerdict(false, null)).toBe(false);
    expect(anyKeyVerdict(null, false)).toBe(false);
    expect(anyKeyVerdict(false, false)).toBe(false);
    expect(anyKeyVerdict(false, true)).toBe(true);
    expect(anyKeyVerdict(true, null)).toBe(true);
    expect(anyKeyVerdict(null, null)).toBeNull(); // no key at all: only a hint to ask Qi
  });

  it("after the lookup: the row's own environment's key decides", () => {
    expect(rowKeyVerdict(row(REQ_A, 'pay-1', false), true, false)).toBe(true);
    expect(rowKeyVerdict(row(REQ_A, 'pay-1', true), true, false)).toBe(false); // live key signed a sandbox payment
    expect(rowKeyVerdict(row(REQ_A, 'pay-1', true), true, null)).toBeNull(); // sandbox key unset: a hint
    expect(rowKeyVerdict(null, null, true)).toBe(true);
  });
});

describe('deposit-webhook/index.ts wiring', () => {
  // Code only: the header comment names the fields it explains.
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/functions/deposit-webhook/index.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  it('verifies the signature before any database access, and refuses without an event row', () => {
    const refusal = src.indexOf("json({ error: 'UNAUTHORIZED' }, 401)");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(src.indexOf('createServiceClient()'));
    expect(refusal).toBeLessThan(src.indexOf('loadPayment('));
    expect(src.slice(0, refusal)).not.toMatch(/deposit_log_event/);
  });

  it('looks up by paymentId before requestId, caps the body, and never reads confirmedAmount', () => {
    expect(src.indexOf('loadPayment(service, { paymentId')).toBeLessThan(src.indexOf('loadPayment(service, { requestId'));
    expect(src).toMatch(/readJsonBody\(req, \{ maxBytes: MAX_BODY \}\)/);
    expect(src).not.toMatch(/confirmedAmount/);
  });
});
