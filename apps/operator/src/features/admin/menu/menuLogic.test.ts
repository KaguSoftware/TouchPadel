import { describe, expect, it } from 'vitest';
import {
  countWithoutCost,
  defaultPrice,
  hookError,
  marginBand,
  marginPct,
  matchesSearch,
  nextDayIso,
  reorderedIds,
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

describe('sortRows / reorderedIds', () => {
  const rows = [
    { id: 'c', sort_order: 2, name_en: 'C' },
    { id: 'a', sort_order: 0, name_en: 'A' },
    { id: 'b', sort_order: 1, name_en: 'B' },
  ];
  it('sorts by sort_order then name', () => {
    expect(sortRows(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  // reorderedIds replaced reorderPlan, which returned a SPARSE list of
  // {id, sort_order} writes that the client then applied one row at a time
  // through upsert_menu_item — re-sending each whole row rebuilt from its own
  // cache, so an up-arrow could silently revert a colleague's edit (audit H3).
  // The server now takes the complete ordering and assigns positions itself.
  it('returns the complete new ordering, not a sparse diff', () => {
    expect(reorderedIds(rows, 1, 'up')).toEqual(['b', 'a', 'c']);
    expect(reorderedIds(rows, 1, 'down')).toEqual(['a', 'c', 'b']);
  });

  it('works when every row shares a sort order, as a fresh menu does', () => {
    // The old swap-two-values path was a no-op here and needed a special case;
    // positions come from the array now, so ties are not a special case at all.
    const tied = [
      { id: 'a', sort_order: 0, name_en: 'A' },
      { id: 'b', sort_order: 0, name_en: 'B' },
      { id: 'c', sort_order: 0, name_en: 'C' },
    ];
    expect(reorderedIds(tied, 2, 'up')).toEqual(['a', 'c', 'b']);
  });

  it('orders from the SORTED view, not the input order', () => {
    // rows is given as c, a, b — index 0 must mean 'a'.
    expect(reorderedIds(rows, 0, 'down')).toEqual(['b', 'a', 'c']);
  });

  it('does nothing at the edges', () => {
    expect(reorderedIds(rows, 0, 'up')).toEqual([]);
    expect(reorderedIds(rows, 2, 'down')).toEqual([]);
  });

  it('does nothing for an out-of-range index', () => {
    expect(reorderedIds(rows, -1, 'down')).toEqual([]);
    expect(reorderedIds(rows, 99, 'up')).toEqual([]);
  });

  it('keeps every id exactly once', () => {
    const out = reorderedIds(rows, 1, 'up');
    expect([...out].sort()).toEqual(['a', 'b', 'c']);
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
