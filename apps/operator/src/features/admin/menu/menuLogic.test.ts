import { describe, expect, it } from 'vitest';
import {
  countWithoutCost,
  defaultPrice,
  hookError,
  itemListView,
  lacksCost,
  marginBand,
  marginPct,
  matchesSearch,
  nextDayIso,
  nextSortOrder,
  orderableState,
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

describe('itemListView', () => {
  const items = [
    { id: 'tea', category_id: 'drinks', sort_order: 1, name_en: 'Tea', name_ar: 'شاي', is_active: true },
    { id: 'latte', category_id: 'drinks', sort_order: 0, name_en: 'Iced Latte', name_ar: 'لاتيه', is_active: true },
    { id: 'cake', category_id: 'sweets', sort_order: 0, name_en: 'Latte Cake', name_ar: 'كيك', is_active: true },
    { id: 'old', category_id: 'sweets', sort_order: 1, name_en: 'Old Latte', name_ar: 'قديم', is_active: false },
  ];
  const costs = new Map([['tea', 500]]);
  // sweets is listed BEFORE drinks, so mixed rows must follow that, not the ids.
  const categoryRank = new Map([['sweets', 0], ['drinks', 1]]);
  const base = { categoryId: 'drinks', search: '', noCostOnly: false, costs, categoryRank };

  it('shows the chosen category in its own order, reorderable', () => {
    const v = itemListView(items, base);
    expect(v.mode).toBe('category');
    expect(v.reorderable).toBe(true);
    expect(v.rows.map((i) => i.id)).toEqual(['latte', 'tea']);
  });

  it('searches every category, not only the chosen one, and turns reorder off', () => {
    const v = itemListView(items, { ...base, search: 'latte' });
    expect(v.mode).toBe('search');
    expect(v.reorderable).toBe(false);
    expect(v.rows.map((i) => i.id)).toEqual(['cake', 'old', 'latte']);
  });

  it('lists active items without a cost from every category', () => {
    const v = itemListView(items, { ...base, noCostOnly: true });
    expect(v.mode).toBe('noCost');
    expect(v.reorderable).toBe(false);
    // tea has a cost; old is inactive, which the count leaves out too.
    expect(v.rows.map((i) => i.id)).toEqual(['cake', 'latte']);
  });

  it('narrows the cost filter by the search', () => {
    expect(itemListView(items, { ...base, noCostOnly: true, search: 'cake' }).rows.map((i) => i.id)).toEqual(['cake']);
  });

  it('agrees with countWithoutCost', () => {
    expect(itemListView(items, { ...base, noCostOnly: true }).rows.length).toBe(countWithoutCost(items, costs));
    expect(lacksCost(items[0]!, costs)).toBe(false);
  });
});

describe('nextSortOrder', () => {
  it('puts a new row after the last one', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sort_order: 3 }, { sort_order: 7 }])).toBe(8);
  });
});

describe('orderableState', () => {
  const item = { is_active: true, sold_out: false, unavailable_on: null };
  it('is orderable when nothing stops it', () => {
    expect(orderableState(item, '2026-09-16', false)).toBe('orderable');
  });
  it('names the item switches ahead of stock', () => {
    expect(orderableState({ ...item, is_active: false, sold_out: true }, '2026-09-16', true)).toBe('inactive');
    expect(orderableState({ ...item, sold_out: true }, '2026-09-16', true)).toBe('soldOut');
    expect(orderableState({ ...item, unavailable_on: '2026-09-16' }, '2026-09-16', true)).toBe('offToday');
    expect(orderableState(item, '2026-09-16', true)).toBe('blocked');
  });
  it('does not call an item off today because of an old date', () => {
    // The badge that said "Off for today" whether or not the item was off.
    expect(orderableState({ ...item, unavailable_on: '2026-09-15' }, '2026-09-16', false)).toBe('orderable');
  });
});
