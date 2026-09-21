import { describe, it, expect } from 'vitest';
import {
  closeBlock,
  dayCloseCsv,
  deriveDayCloseState,
  describeAdjustmentKind,
  knownReason,
  queueErrorCode,
  queueWriteKey,
  varianceMagnitude,
  varianceSign,
  unpaidPlayedRows,
  type CsvLabels,
  QUEUE_WRITE_KEY,
} from './dayCloseLogic';
import { MUTATION_TYPES } from '@touch/core/schemas/mutations';

const base = { dayLoaded: true, dayOpen: true, openTabCount: 0, queuedCount: 0, busy: false, closed: false, error: null };

describe('deriveDayCloseState', () => {
  it('walks the spec states in precedence order', () => {
    expect(deriveDayCloseState({ ...base, dayLoaded: false })).toBe('loading');
    expect(deriveDayCloseState({ ...base, dayOpen: false })).toBe('noOpenDay');
    expect(deriveDayCloseState(base)).toBe('ready');
    expect(deriveDayCloseState({ ...base, busy: true })).toBe('busy');
    expect(deriveDayCloseState({ ...base, closed: true })).toBe('closed');
  });

  it('blocks on open tabs before anything else the manager could fix later', () => {
    // The day CANNOT close while a tab is open on the floor (spec 06.22). The
    // block must show even while a server error from a previous attempt is set.
    expect(deriveDayCloseState({ ...base, openTabCount: 2, error: new Error('DAY_OPEN_TABS') })).toBe('blockedByOpenTabs');
    expect(deriveDayCloseState({ ...base, openTabCount: 1, queuedCount: 3 })).toBe('blockedByOpenTabs');
  });

  it('blocks on unsynced queue rows', () => {
    expect(deriveDayCloseState({ ...base, queuedCount: 1 })).toBe('blockedByUnsyncedQueue');
  });

  it('shows an error only when nothing else explains it', () => {
    expect(deriveDayCloseState({ ...base, error: new Error('x') })).toBe('error');
  });

  it('closed wins over everything, including a stale error', () => {
    expect(deriveDayCloseState({ ...base, closed: true, error: new Error('x'), openTabCount: 1 })).toBe('closed');
  });
});

describe('variance wording', () => {
  it('names the sign of the server variance and shows its magnitude', () => {
    expect(varianceSign(2500)).toBe('over');
    expect(varianceSign(-2500)).toBe('short');
    expect(varianceSign(0)).toBe('exact');
    expect(varianceMagnitude(-2500)).toBe(2500);
    expect(varianceMagnitude(2500)).toBe(2500);
  });
});

describe('dayCloseCsv', () => {
  const labels: CsvLabels = {
    figure: 'Figure', value: 'Value', count: 'Count', authorisers: 'Authorised by',
    cashExpected: 'Cash expected', cashCounted: 'Cash counted', variance: 'Variance',
    cardExpected: 'Card expected', cardBatch: 'Card batch', discounts: 'Discounts', voids: 'Voids',
    refunds: 'Refunds', waste: 'Waste', openingFloat: 'Float', cashPayments: 'Cash in', cardPayments: 'Card in',
    deskCash: 'Desk cash', deskCard: 'Desk card',
  };
  const summary = {
    day_session_id: 'd1', business_date: '2026-09-03', status: 'closed', opening_float_iqd: 50000,
    cash_payments_iqd: 120000, card_payments_iqd: 80000, cash_expected_iqd: 170000, cash_counted_iqd: 168000,
    cash_variance_iqd: -2000, card_expected_iqd: 80000, card_terminal_batch_iqd: 80000,
    discounts_iqd: 15000, adjustment_count: 2, authorizer_names: ['Dev Manager', 'Dev Owner'],
    voided_lines_iqd: 4000, voided_line_count: 1, refunds_iqd: 0, refund_count: 0, waste_cost_iqd: 2500,
    desk_cash_iqd: 30000, desk_card_iqd: 0,
  };
  const close = {
    day_session_id: 'd1', business_date: '2026-09-03', cash_expected_iqd: 170000, cash_counted_iqd: 168000,
    cash_variance_iqd: -2000, card_expected_iqd: 80000, card_terminal_batch_iqd: 80000,
  };

  it('lays out server figures, the summary with authorisers, then each adjustment', () => {
    const { headers, rows } = dayCloseCsv(labels, close, summary, [
      { adjustment_id: 'a1', tab_id: 't1', kind: 'discount', value: 10, amount_iqd: 5000, reason_code: 'comp', created_at: '', applied_by_name: 'Sara', authorized_by_name: 'Dev Manager' },
    ], (names) => names.join(', '), (adj) => `words for ${adj.kind}`);
    expect(headers).toEqual(['Figure', 'Value', 'Count', 'Authorised by']);
    expect(rows).toContainEqual(['Cash expected', 170000, null, null]);
    expect(rows).toContainEqual(['Variance', -2000, null, null]);
    expect(rows).toContainEqual(['Discounts', 15000, 2, 'Dev Manager, Dev Owner']);
    // The adjustment line carries the screen's words, not the enum.
    expect(rows[rows.length - 1]).toEqual(['words for discount', 5000, 1, 'Dev Manager']);
  });

  it('lists the court desk’s cash and card right after the totals they are part of', () => {
    const { rows } = dayCloseCsv(labels, null, summary, [], (n) => n.join(', '), () => '');
    const names = rows.map((r) => r[0]);
    expect(rows).toContainEqual(['Desk cash', 30000, null, null]);
    expect(rows).toContainEqual(['Desk card', 0, null, null]);
    expect(names.indexOf('Desk cash')).toBe(names.indexOf('Cash in') + 1);
    expect(names.indexOf('Desk card')).toBe(names.indexOf('Card in') + 1);
  });

  it('leaves the desk lines out when the server did not send them', () => {
    const older = { ...summary, desk_cash_iqd: undefined, desk_card_iqd: undefined };
    const { rows } = dayCloseCsv(labels, null, older, [], (n) => n.join(', '), () => '');
    expect(rows.some((r) => r[0] === 'Desk cash' || r[0] === 'Desk card')).toBe(false);
  });

  it('exports what it has before the close (no close figures yet)', () => {
    const { rows } = dayCloseCsv(labels, null, summary, [], (n) => n.join(', '), () => '');
    expect(rows.some((r) => r[0] === 'Cash expected')).toBe(false);
    expect(rows.some((r) => r[0] === 'Cash in')).toBe(true);
  });
});

describe('plain words for stored codes', () => {
  it('names the adjustment kind and reads a percentage from basis points', () => {
    expect(describeAdjustmentKind({ kind: 'discount_percent', value: 1000 })).toEqual({ kind: 'percent', percent: 10 });
    expect(describeAdjustmentKind({ kind: 'discount_percent', value: 750 })).toEqual({ kind: 'percent', percent: 7.5 });
    expect(describeAdjustmentKind({ kind: 'discount_amount', value: 1500 })).toEqual({ kind: 'amount', percent: null });
    expect(describeAdjustmentKind({ kind: 'price_override', value: 9000 })).toEqual({ kind: 'override', percent: null });
    expect(describeAdjustmentKind({ kind: 'something_new', value: 1 })).toEqual({ kind: 'other', percent: null });
  });

  it('recognises the reason codes staff pick from and nothing else', () => {
    expect(knownReason('comp')).toBe('comp');
    expect(knownReason('customer_request')).toBe('customer_request');
    expect(knownReason('replay-test')).toBeNull();
    expect(knownReason(null)).toBeNull();
  });

  it('maps queue mutation types to a word, with a fallback for new ones', () => {
    expect(queueWriteKey('payment.record')).toBe('payment');
    expect(queueWriteKey('order.add_items')).toBe('order');
    expect(queueWriteKey('reservation.update')).toBe('booking');
    expect(queueWriteKey('future.thing')).toBe('other');
  });

  it('has a word for EVERY queued mutation type — the sixth copy of the contract (item 9)', () => {
    expect(Object.keys(QUEUE_WRITE_KEY).sort()).toEqual([...MUTATION_TYPES].sort());
  });

  it('pulls the error code off a queue row error, leading or after the worker’s HTTP status', () => {
    expect(queueErrorCode('ITEM_UNAVAILABLE: the item is sold out')).toBe('ITEM_UNAVAILABLE');
    // sync-worker.ts markFailed stores `${status}: ${detail}`; the code sits after the status.
    expect(queueErrorCode('400: TAB_NOT_EMPTY')).toBe('TAB_NOT_EMPTY');
    expect(queueErrorCode('400: the server said no')).toBeNull();
    expect(queueErrorCode('network down')).toBeNull();
    expect(queueErrorCode(null)).toBeNull();
  });
});

describe('closeBlock', () => {
  it('names the first step still holding the close, tabs before sync before the count', () => {
    expect(closeBlock('blockedByOpenTabs', null)).toBe('openTabs');
    expect(closeBlock('blockedByUnsyncedQueue', 100000)).toBe('unsynced');
    expect(closeBlock('ready', null)).toBe('noCount');
    expect(closeBlock('ready', 125000)).toBeNull();
  });

  it('treats a count of zero as a count, not as missing', () => {
    expect(closeBlock('ready', 0)).toBeNull();
  });
});

describe('played today, not paid', () => {
  const row = {
    reservation_id: 'r1', guest_name: 'Ali', status: 'completed', start_at: '2026-09-17T18:00:00Z', end_at: '2026-09-17T19:30:00Z',
    court_name_en: 'Court 1', court_name_ar: 'الملعب 1', price_iqd: 30000, remaining_iqd: 30000, live_tab_id: null,
  };

  it('reads the RPC payload as rows', () => {
    expect(unpaidPlayedRows([row])).toEqual([row]);
  });

  it('reads anything that is not a list of bookings as nothing to warn about', () => {
    expect(unpaidPlayedRows(null)).toEqual([]);
    expect(unpaidPlayedRows({ error: 'x' })).toEqual([]);
    expect(unpaidPlayedRows([null, { guest_name: 'no id' }, row])).toEqual([row]);
  });

  it('never holds the close: unpaid bookings are not an input to the state or the block', () => {
    // A warning, not a block (decided 2026-09-17). The state machine has no
    // input for them, so a ready day with unpaid bookings stays ready.
    expect(deriveDayCloseState(base)).toBe('ready');
    expect(closeBlock('ready', 125000)).toBeNull();
  });
});
