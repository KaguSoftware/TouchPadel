import { describe, it, expect } from 'vitest';
import { dayCloseCsv, deriveDayCloseState, varianceMagnitude, varianceSign, type CsvLabels } from './dayCloseLogic';

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
  };
  const summary = {
    day_session_id: 'd1', business_date: '2026-09-03', status: 'closed', opening_float_iqd: 50000,
    cash_payments_iqd: 120000, card_payments_iqd: 80000, cash_expected_iqd: 170000, cash_counted_iqd: 168000,
    cash_variance_iqd: -2000, card_expected_iqd: 80000, card_terminal_batch_iqd: 80000,
    discounts_iqd: 15000, adjustment_count: 2, authorizer_names: ['Dev Manager', 'Dev Owner'],
    voided_lines_iqd: 4000, voided_line_count: 1, refunds_iqd: 0, refund_count: 0, waste_cost_iqd: 2500,
  };
  const close = {
    day_session_id: 'd1', business_date: '2026-09-03', cash_expected_iqd: 170000, cash_counted_iqd: 168000,
    cash_variance_iqd: -2000, card_expected_iqd: 80000, card_terminal_batch_iqd: 80000,
  };

  it('lays out server figures, the summary with authorisers, then each adjustment', () => {
    const { headers, rows } = dayCloseCsv(labels, close, summary, [
      { adjustment_id: 'a1', tab_id: 't1', kind: 'discount', value: 10, amount_iqd: 5000, reason_code: 'comp', created_at: '', applied_by_name: 'Sara', authorized_by_name: 'Dev Manager' },
    ], (names) => names.join(', '));
    expect(headers).toEqual(['Figure', 'Value', 'Count', 'Authorised by']);
    expect(rows).toContainEqual(['Cash expected', 170000, null, null]);
    expect(rows).toContainEqual(['Variance', -2000, null, null]);
    expect(rows).toContainEqual(['Discounts', 15000, 2, 'Dev Manager, Dev Owner']);
    expect(rows[rows.length - 1]).toEqual(['discount (comp)', 5000, 1, 'Dev Manager']);
  });

  it('exports what it has before the close (no close figures yet)', () => {
    const { rows } = dayCloseCsv(labels, null, summary, [], (n) => n.join(', '));
    expect(rows.some((r) => r[0] === 'Cash expected')).toBe(false);
    expect(rows.some((r) => r[0] === 'Cash in')).toBe(true);
  });
});
