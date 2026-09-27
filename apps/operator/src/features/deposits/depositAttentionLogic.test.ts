import { describe, expect, it } from 'vitest';
import type { DepositAttentionRow } from './depositApi';
import { attentionActions, attentionAmount, attentionKindOf, attentionSince, knownRefundReason, showAttentionPanel, sortAttention } from './depositAttentionLogic';

function row(over: Partial<DepositAttentionRow> = {}): DepositAttentionRow {
  return {
    id: 'p1',
    request_id: 'r1',
    reservation_id: 'res1',
    guest_name: 'Sara',
    guest_phone: '+9647700000000',
    amount_iqd: 20000,
    refund_amount_iqd: 20000,
    status: 'refund_failed',
    refund_reason: 'guest_cancel',
    refund_requested_at: '2026-09-25T10:00:00Z',
    refund_attempts: 3,
    succeeded_at: '2026-09-24T09:00:00Z',
    sandbox: false,
    court_name_en: 'Court 1',
    court_name_ar: 'ملعب 1',
    start_at: '2026-09-26T17:00:00Z',
    ...over,
  };
}

describe('attentionKindOf / attentionActions', () => {
  it('a failed refund can be retried or settled another way', () => {
    expect(attentionKindOf(row())).toBe('refundFailed');
    expect(attentionActions(row())).toEqual({ retry: true, settle: true, refund: false });
  });

  it('a slow refund cannot be retried (the server says PAYMENT_STATE), only settled', () => {
    const r = row({ status: 'refund_pending' });
    expect(attentionKindOf(r)).toBe('refundSlow');
    expect(attentionActions(r)).toEqual({ retry: false, settle: true, refund: false });
  });

  it('a paid deposit on a booking that is no longer on is refunded to the guest', () => {
    const r = row({ status: 'succeeded', refund_amount_iqd: null, refund_requested_at: null, refund_reason: null });
    expect(attentionKindOf(r)).toBe('paidNotLive');
    expect(attentionActions(r)).toEqual({ retry: false, settle: false, refund: true });
  });
});

describe('attentionAmount / attentionSince', () => {
  it('quotes the refund when one was asked for, else what was paid', () => {
    expect(attentionAmount(row({ refund_amount_iqd: 5000 }))).toBe(5000);
    expect(attentionAmount(row({ refund_amount_iqd: null }))).toBe(20000);
    expect(attentionAmount(row({ status: 'succeeded', refund_amount_iqd: 5000 }))).toBe(20000);
  });

  it('dates a refund from its request and a paid row from its payment', () => {
    expect(attentionSince(row())).toBe('2026-09-25T10:00:00Z');
    expect(attentionSince(row({ refund_requested_at: null }))).toBe('2026-09-24T09:00:00Z');
    expect(attentionSince(row({ status: 'succeeded' }))).toBe('2026-09-24T09:00:00Z');
  });
});

describe('knownRefundReason', () => {
  it('names only reasons the catalog has words for', () => {
    expect(knownRefundReason('no_show')).toBe('no_show');
    expect(knownRefundReason('something_new')).toBeNull();
    expect(knownRefundReason(null)).toBeNull();
  });
});

describe('sortAttention', () => {
  it('failed refunds first, then paid-not-live, then slow; oldest first within each', () => {
    const rows = [
      row({ id: 'slow', status: 'refund_pending', refund_requested_at: '2026-09-20T00:00:00Z' }),
      row({ id: 'failedNew', refund_requested_at: '2026-09-26T00:00:00Z' }),
      row({ id: 'paid', status: 'succeeded', succeeded_at: '2026-09-21T00:00:00Z' }),
      row({ id: 'failedOld', refund_requested_at: '2026-09-22T00:00:00Z' }),
    ];
    expect(sortAttention(rows).map((r) => r.id)).toEqual(['failedOld', 'failedNew', 'paid', 'slow']);
  });
});

describe('showAttentionPanel', () => {
  it('a waiting row always shows', () => {
    expect(showAttentionPanel({ rows: 1, mode: 'off', hideWhenEmpty: true })).toBe(true);
    expect(showAttentionPanel({ rows: 2, mode: null, hideWhenEmpty: false })).toBe(true);
  });

  it('an empty list shows only on the home, and only once deposits are on', () => {
    expect(showAttentionPanel({ rows: 0, mode: 'optional', hideWhenEmpty: false })).toBe(true);
    expect(showAttentionPanel({ rows: 0, mode: 'off', hideWhenEmpty: false })).toBe(false);
    expect(showAttentionPanel({ rows: 0, mode: 'required', hideWhenEmpty: true })).toBe(false);
    // Settings unreadable (an older server): say nothing rather than an error about a feature that is not there.
    expect(showAttentionPanel({ rows: null, mode: null, hideWhenEmpty: false })).toBe(false);
  });
});
