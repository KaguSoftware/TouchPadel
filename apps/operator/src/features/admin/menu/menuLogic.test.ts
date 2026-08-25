import { describe, expect, it } from 'vitest';
import {
  countWithoutCost,
  defaultPrice,
  hookError,
  marginBand,
  marginPct,
  matchesSearch,
  nextDayIso,
  reorderPlan,
  sortRows,
} from './menuLogic';

describe('marginPct / marginBand', () => {
  it('computes an integer percent of price', () => {
    expect(marginPct(10_000, 4_000)).toBe(60);
    expect(marginPct(3_000, 2_000)).toBe(33);
  });
  it('is null without a cost or a positive price', () => {
    expect(marginPct(10_000, null)).toBeNull();
    expect(marginPct(0, 100)).toBeNull();
    expect(marginPct(null, 100)).toBeNull();
  });
  it('bands at 60 / 35', () => {
    expect(marginBand(60)).toBe('good');
    expect(marginBand(59)).toBe('ok');
    expect(marginBand(35)).toBe('ok');
    expect(marginBand(34)).toBe('bad');
    expect(marginBand(-20)).toBe('bad');
    expect(marginBand(null)).toBe('noCost');
  });
});

describe('defaultPrice', () => {
  it('prefers the default variant, else the first by sort order', () => {
    expect(
      defaultPrice([
        { price_iqd: 5, is_default: false, sort_order: 1 },
        { price_iqd: 7, is_default: true, sort_order: 2 },
      ]),
    ).toBe(7);
    expect(
      defaultPrice([
        { price_iqd: 5, is_default: false, sort_order: 2 },
        { price_iqd: 9, is_default: false, sort_order: 1 },
      ]),
    ).toBe(9);
    expect(defaultPrice([])).toBeNull();
  });
});

describe('matchesSearch', () => {
  const row = { name_en: 'Iced Latte', name_ar: 'لاتيه مثلج' };
  it('matches either language, case-insensitively', () => {
    expect(matchesSearch(row, 'latte')).toBe(true);
    expect(matchesSearch(row, 'مثلج')).toBe(true);
    expect(matchesSearch(row, 'mocha')).toBe(false);
    expect(matchesSearch(row, '   ')).toBe(true);
  });
});

describe('sortRows / reorderPlan', () => {
  const rows = [
    { id: 'c', sort_order: 2, name_en: 'C' },
    { id: 'a', sort_order: 0, name_en: 'A' },
    { id: 'b', sort_order: 1, name_en: 'B' },
  ];
  it('sorts by sort_order then name', () => {
    expect(sortRows(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('swaps two distinct sort orders', () => {
    expect(reorderPlan(rows, 1, 'up')).toEqual([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 1 },
    ]);
    expect(reorderPlan(rows, 1, 'down')).toEqual([
      { id: 'b', sort_order: 2 },
      { id: 'c', sort_order: 1 },
    ]);
  });
  it('renumbers when the list has ties', () => {
    const tied = [
      { id: 'a', sort_order: 0, name_en: 'A' },
      { id: 'b', sort_order: 0, name_en: 'B' },
      { id: 'c', sort_order: 0, name_en: 'C' },
    ];
    expect(reorderPlan(tied, 2, 'up')).toEqual([
      { id: 'c', sort_order: 1 },
      { id: 'b', sort_order: 2 },
    ]);
  });
  it('does nothing at the edges', () => {
    expect(reorderPlan(rows, 0, 'up')).toEqual([]);
    expect(reorderPlan(rows, 2, 'down')).toEqual([]);
  });
});

describe('hookError', () => {
  it('requires both or neither', () => {
    expect(hookError('', '')).toBeNull();
    expect(hookError('sweet', 'حلو')).toBeNull();
    expect(hookError('sweet', '')).toBe('pair');
    expect(hookError('', '  حلو')).toBe('pair');
  });
  it('limits length to 60', () => {
    expect(hookError('x'.repeat(61), 'y')).toBe('length');
    expect(hookError('x'.repeat(60), 'y')).toBeNull();
  });
});

describe('nextDayIso', () => {
  it('rolls over month ends', () => {
    expect(nextDayIso('2026-08-31')).toBe('2026-09-01');
    expect(nextDayIso('2026-12-31')).toBe('2027-01-01');
  });
});

describe('countWithoutCost', () => {
  it('counts only active items lacking a cost row', () => {
    const costs = new Map([['a', 100]]);
    expect(
      countWithoutCost(
        [
          { id: 'a', is_active: true },
          { id: 'b', is_active: true },
          { id: 'c', is_active: false },
        ],
        costs,
      ),
    ).toBe(1);
  });
});
