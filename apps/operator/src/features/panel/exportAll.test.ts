import { describe, expect, it, vi } from 'vitest';
import { t, type MessageKey } from '@touch/i18n';
import { CSV_BOM, bundleEntries } from '../analytics/csv';
import type { DrillTransaction } from '../reports/reportPayloads';
import { DRILLABLE_FIGURES, buildPanelExport, fetchAllTransactions, splitRange } from './exportAll';
import { FIGURE_KEYS, mapFigures } from './figures';

// The export used to be the thirteen totals and nothing else. These pin that
// it now carries the window, every figure with its key and kind, and every
// transaction behind every figure with every server field — and that a
// figure the server caps at 500 rows is read in pieces until nothing is cut.

const tr = (key: MessageKey, params?: Record<string, string | number>) => t('en', key, params);

const tx = (id: string, at: string, extra: Partial<DrillTransaction> = {}): DrillTransaction => ({
  id,
  at,
  kind: 'refund',
  label: 'refund · quality · cash',
  amountIqd: 5000,
  staffName: 'Dev',
  staffId: 'staff-1',
  reference: 'tab-9',
  detail: { sub: 'refund', reason: 'quality', method: 'cash' },
  ...extra,
});

describe('DRILLABLE_FIGURES', () => {
  it('is every panel figure except the average, which the server cannot list', () => {
    expect(DRILLABLE_FIGURES).toEqual(FIGURE_KEYS.filter((k) => k !== 'avgOrderValue'));
    expect(DRILLABLE_FIGURES).toHaveLength(12);
  });
});

describe('splitRange', () => {
  it('halves a range on whole days with no gap and no overlap', () => {
    expect(splitRange({ from: '2026-09-01', to: '2026-09-30' })).toEqual([
      { from: '2026-09-01', to: '2026-09-15' },
      { from: '2026-09-16', to: '2026-09-30' },
    ]);
    expect(splitRange({ from: '2026-09-01', to: '2026-09-02' })).toEqual([
      { from: '2026-09-01', to: '2026-09-01' },
      { from: '2026-09-02', to: '2026-09-02' },
    ]);
  });
  it('refuses a single day', () => {
    expect(() => splitRange({ from: '2026-09-01', to: '2026-09-01' })).toThrow();
  });
});

describe('fetchAllTransactions', () => {
  it('takes one call when the server did not cap', async () => {
    const fetch = vi.fn().mockResolvedValue([tx('a', '2026-09-02T10:00:00Z')]);
    const out = await fetchAllTransactions('refunds', { from: '2026-09-01', to: '2026-09-30' }, fetch, 3);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.rows.map((r) => r.id)).toEqual(['a']);
    expect(out.cappedDays).toEqual([]);
  });

  it('splits a capped range until every piece is under the cap, keeping newest first', async () => {
    // Four rows over four days; a cap of 2 means the whole range and one half come back full.
    const all = [tx('d', '2026-09-04T10:00:00Z'), tx('c', '2026-09-03T10:00:00Z'), tx('b', '2026-09-02T10:00:00Z'), tx('a', '2026-09-01T10:00:00Z')];
    const fetch = vi.fn(async (_figure: string, range: { from: string; to: string }) =>
      all.filter((r) => r.at!.slice(0, 10) >= range.from && r.at!.slice(0, 10) <= range.to).slice(0, 2),
    );
    const out = await fetchAllTransactions('refunds', { from: '2026-09-01', to: '2026-09-04' }, fetch, 2);
    expect(out.rows.map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(out.cappedDays).toEqual([]);
    expect(fetch.mock.calls.map(([, r]) => `${r.from}..${r.to}`)).toEqual([
      '2026-09-01..2026-09-04',
      '2026-09-03..2026-09-04',
      '2026-09-01..2026-09-02',
      '2026-09-04..2026-09-04',
      '2026-09-03..2026-09-03',
      '2026-09-02..2026-09-02',
      '2026-09-01..2026-09-01',
    ]);
  });

  it('names a single day the server still capped instead of pretending it is complete', async () => {
    const fetch = vi.fn().mockResolvedValue([tx('x', '2026-09-01T10:00:00Z'), tx('y', '2026-09-01T09:00:00Z')]);
    const out = await fetchAllTransactions('orders', { from: '2026-09-01', to: '2026-09-01' }, fetch, 2);
    expect(out.cappedDays).toEqual(['2026-09-01']);
    expect(out.rows).toHaveLength(2);
  });

  it('lets a failed call fail the export', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    await expect(fetchAllTransactions('cash', { from: '2026-09-01', to: '2026-09-02' }, fetch)).rejects.toThrow('FORBIDDEN');
  });
});

describe('buildPanelExport', () => {
  const figures = mapFigures({
    figures: [
      { key: 'revenue', value: 15000, previous: 12000, changeAbs: 3000, changePct: 25 },
      { key: 'refunds', value: 5000, previous: 4000, changeAbs: 1000, changePct: 25 },
      { key: 'avgOrderValue', value: 357 },
    ],
  });
  const bundle = buildPanelExport({
    period: { from: '2026-08-22', to: '2026-09-20' },
    compare: 'previousPeriod',
    comparison: { from: '2026-07-23', to: '2026-08-21' },
    figures,
    transactions: [
      {
        figure: 'refunds',
        rows: [
          tx('r1', new Date(2026, 8, 1, 10, 30).toISOString()),
          tx('r2', new Date(2026, 8, 2, 16, 5).toISOString(), {
            kind: 'waste',
            label: 'Milk · spill · 500 ml',
            staffName: null,
            staffId: null,
            reference: 'mv-1',
            detail: { sub: 'waste', movement: 'waste_spill', reason: 'spill', ingredientEn: 'Milk', ingredientAr: 'حليب', qty: 500, unit: 'ml' },
          }),
        ],
        cappedDays: ['2026-09-02'],
      },
    ],
    exportedAt: new Date(2026, 8, 20, 12, 0),
    tr,
    locale: 'en',
  });
  const [windowTable, figuresTable, transactionsTable] = bundle;

  it('is three tables, so three files — never three blocks of one sheet', () => {
    expect(bundle.map((t) => t.name)).toEqual(['window', 'figures', 'transactions']);
    // Every row of every table is exactly as wide as that table's headers;
    // that is what the old sectioned file could not promise.
    for (const table of bundle) {
      for (const row of table.rows) expect(row).toHaveLength(table.headers.length);
    }
  });

  it('writes the window, the comparison and the capped days first', () => {
    expect(windowTable!.headers).toEqual(['What', 'Value']);
    expect(windowTable!.rows).toEqual([
      ['Period from', '2026-08-22'],
      ['Period to', '2026-09-20'],
      ['Comparison', 'Previous period'],
      ['Compared with, from', '2026-07-23'],
      ['Compared with, to', '2026-08-21'],
      ['Exported', '2026-09-20 12:00'],
      ['More than 500 transactions on one day; the oldest of that day are not listed', 'Refunds · 2026-09-02'],
    ]);
  });

  it('writes every figure with its group and unit, raw numbers, the server key last', () => {
    expect(figuresTable!.headers).toEqual(['Figure', 'Group', 'Measured in', 'Value', 'Previous', 'Change', 'Change %', 'Server key']);
    expect(figuresTable!.rows).toEqual([
      ['Revenue', 'Headline', 'IQD', 15000, 12000, 3000, 25, 'revenue'],
      ['Average order value', 'Cafe', 'IQD', 357, null, null, null, 'avgOrderValue'],
      ['Refunds', 'Discounts, refunds and waste', 'IQD', 5000, 4000, 1000, 25, 'refunds'],
    ]);
  });

  it('writes a transaction as a date, a time and one worded fact per column', () => {
    expect(transactionsTable!.headers).toEqual([
      'Figure',
      'Date',
      'Time',
      'Type',
      'What',
      'Details',
      'Where',
      'Guest',
      'Reason',
      'Payment method',
      'Booking status',
      'Order source',
      'Quantity',
      'Unit',
      'Amount (IQD)',
      'By',
      'Reference',
      'Transaction id',
    ]);
    expect(transactionsTable!.rows).toHaveLength(2);
    expect(transactionsTable!.rows[0]).toEqual([
      'Refunds',
      '2026-09-01',
      '10:30',
      'Refund',
      null,
      'Quality issue · Cash',
      null,
      null,
      'Quality issue',
      'Cash',
      null,
      null,
      null,
      null,
      5000,
      'Dev',
      'tab-9',
      'r1',
    ]);
  });

  it('collapses the six name columns into one, in the reader’s language', () => {
    const waste = transactionsTable!.rows[1]!;
    expect(waste[4]).toBe('Milk');
    expect(waste[8]).toBe('Spill / waste');
    expect(waste[12]).toBe(500);
    expect(waste[13]).toBe('ml');
  });

  it('serialises as one uniform CSV per file', () => {
    const entries = bundleEntries(bundle);
    expect(entries.map((e) => e.name)).toEqual(['01-window.csv', '02-figures.csv', '03-transactions.csv']);
    expect(entries[1]!.text.startsWith(CSV_BOM + 'Figure,Group,Measured in,Value,Previous,Change,Change %,Server key\r\n')).toBe(true);
    // No blank lines, no title rows — nothing a spreadsheet would read as a second table.
    expect(entries[1]!.text).not.toContain('\r\n\r\n');
  });
});
