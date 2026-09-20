import { describe, expect, it, vi } from 'vitest';
import { t, type MessageKey } from '@touch/i18n';
import { toCsvSections } from '../analytics/csv';
import type { DrillTransaction } from '../reports/reportPayloads';
import { DETAIL_COLUMNS, DRILLABLE_FIGURES, buildPanelExport, fetchAllTransactions, splitRange } from './exportAll';
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
  const sections = buildPanelExport({
    period: { from: '2026-08-22', to: '2026-09-20' },
    compare: 'previousPeriod',
    comparison: { from: '2026-07-23', to: '2026-08-21' },
    figures,
    transactions: [
      {
        figure: 'refunds',
        rows: [
          tx('r1', '2026-09-01T10:00:00Z'),
          tx('r2', '2026-09-02T10:00:00Z', {
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
    exportedAt: new Date('2026-09-20T12:00:00Z'),
    tr,
    locale: 'en',
  });

  it('writes the window, the comparison and the capped days first', () => {
    expect(sections[0]!.title).toBe('Management panel');
    expect(sections[0]!.rows).toEqual([
      ['Period from', '2026-08-22'],
      ['Period to', '2026-09-20'],
      ['Comparison', 'Previous period'],
      ['Compared with, from', '2026-07-23'],
      ['Compared with, to', '2026-08-21'],
      ['Exported at (UTC)', '2026-09-20T12:00:00.000Z'],
      ['More than 500 transactions on one day; the oldest of that day are not listed', 'Refunds · 2026-09-02'],
    ]);
  });

  it('writes every figure with its key, group and kind, raw numbers', () => {
    expect(sections[1]!.headers).toEqual(['Figure', 'Key', 'Group', 'Kind', 'Value', 'Previous', 'Change', 'Change %']);
    expect(sections[1]!.rows).toEqual([
      ['Revenue', 'revenue', 'Headline', 'IQD', 15000, 12000, 3000, 25],
      ['Average order value', 'avgOrderValue', 'Cafe', 'IQD', 357, null, null, null],
      ['Refunds', 'refunds', 'Discounts, refunds and waste', 'IQD', 5000, 4000, 1000, 25],
    ]);
  });

  it('writes every transaction with every server field and every detail fact in its own column', () => {
    const [headers, rows] = [sections[2]!.headers!, sections[2]!.rows];
    expect(headers.slice(0, 13)).toEqual(['Figure', 'Key', 'ID', 'When', 'When (ISO)', 'Record', 'Type', 'Description', 'Server label', 'By', 'Staff ID', 'Reference', 'Amount (IQD)']);
    expect(headers).toHaveLength(13 + DETAIL_COLUMNS.length);
    expect(rows).toHaveLength(2);
    const r1 = rows[0]!;
    expect(r1.slice(0, 3)).toEqual(['Refunds', 'refunds', 'r1']);
    expect(r1[4]).toBe('2026-09-01T10:00:00Z');
    expect(r1.slice(5, 13)).toEqual(['refund', 'Refund', 'Quality issue · Cash', 'refund · quality · cash', 'Dev', 'staff-1', 'tab-9', 5000]);
    const detail = Object.fromEntries(DETAIL_COLUMNS.map((c, i) => [c, r1[13 + i]]));
    expect(detail.reason).toBe('quality');
    expect(detail.method).toBe('cash');
    expect(detail.qty).toBeNull();
    const r2 = Object.fromEntries(DETAIL_COLUMNS.map((c, i) => [c, rows[1]![13 + i]]));
    expect(r2).toMatchObject({ movement: 'waste_spill', reason: 'spill', ingredientEn: 'Milk', ingredientAr: 'حليب', qty: 500, unit: 'ml' });
  });

  it('serialises as one file in three blocks', () => {
    const csv = toCsvSections(sections);
    expect(csv.startsWith('﻿Management panel\r\nPeriod from,2026-08-22')).toBe(true);
    expect(csv).toContain('\r\n\r\nFigures\r\nFigure,Key,Group,Kind,Value,Previous,Change,Change %\r\n');
    expect(csv).toContain('\r\n\r\nTransactions behind each figure\r\n');
    expect(csv).toContain('Refunds,refunds,r1,');
  });
});
