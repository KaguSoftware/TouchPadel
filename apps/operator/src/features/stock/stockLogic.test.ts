import { describe, expect, it } from 'vitest';
import {
  ALERT_ORDER,
  alertKind,
  countEntryState,
  isBelowPar,
  isBlankLine,
  isLow,
  isShort,
  lineProblem,
  marginFlag,
  matchesName,
  matchesOnHandFilter,
  needsCount,
  onHandStatus,
  parseOnHandFilter,
  unitCostFromPack,
  type DeliveryLineDraft,
} from './stockLogic';
import type { OnHandRow } from './stockKeys';

// The rules every stock screen shares. These pin what a manager SEES — which
// status a row wears, which lines block a delivery, which alerts group together.

const row = (over: Partial<OnHandRow> = {}): OnHandRow => ({
  ingredient_id: 'i1',
  name_en: 'Whole Milk',
  name_ar: 'حليب كامل الدسم',
  unit: 'ml',
  kind: 'purchased',
  on_hand: 5000,
  theoretical: 5000,
  par_level: 4000,
  low_stock_threshold: 1000,
  is_active: true,
  ...over,
});

describe('on hand status', () => {
  it('is low at or under the reorder point, and never low without one', () => {
    expect(isLow(row({ on_hand: 1000 }))).toBe(true);
    expect(isLow(row({ on_hand: 1001 }))).toBe(false);
    expect(isLow(row({ on_hand: 0, low_stock_threshold: null }))).toBe(false);
  });

  it('is below par only strictly under par', () => {
    expect(isBelowPar(row({ on_hand: 3999 }))).toBe(true);
    expect(isBelowPar(row({ on_hand: 4000 }))).toBe(false);
    expect(isBelowPar(row({ par_level: null, on_hand: 0 }))).toBe(false);
  });

  // on_hand sums live batches and cannot go negative; theoretical sums the
  // ledger and can. They part only when a sale drew more than was on record.
  it('needs a count when the shelf and the ledger disagree', () => {
    expect(needsCount(row({ on_hand: 0, theoretical: -100 }))).toBe(true);
    expect(needsCount(row())).toBe(false);
  });

  it('wears the single worst status: low, then count needed, then below par', () => {
    expect(onHandStatus(row({ on_hand: 500, theoretical: -20 }))).toBe('low');
    expect(onHandStatus(row({ on_hand: 3000, theoretical: 2800 }))).toBe('countNeeded');
    expect(onHandStatus(row({ on_hand: 3000, theoretical: 3000 }))).toBe('belowPar');
    expect(onHandStatus(row())).toBe('ok');
  });
});

describe('on hand filter', () => {
  it('accepts the links other screens use and opens everything for anything else', () => {
    expect(parseOnHandFilter('low')).toBe('low');
    expect(parseOnHandFilter('belowPar')).toBe('belowPar');
    expect(parseOnHandFilter('countNeeded')).toBe('countNeeded');
    expect(parseOnHandFilter('nonsense')).toBe('all');
    expect(parseOnHandFilter(undefined)).toBe('all');
  });

  it('narrows the table to exactly the rows the filter names', () => {
    const low = row({ on_hand: 10 });
    const fine = row();
    expect([low, fine].filter((r) => matchesOnHandFilter(r, 'low'))).toEqual([low]);
    expect([low, fine].filter((r) => matchesOnHandFilter(r, 'all'))).toEqual([low, fine]);
  });

  it('searches either language', () => {
    expect(matchesName(row(), 'milk')).toBe(true);
    expect(matchesName(row(), 'حليب')).toBe(true);
    expect(matchesName(row(), '  ')).toBe(true);
    expect(matchesName(row(), 'bread')).toBe(false);
  });
});

describe('goods in lines', () => {
  const blank: DeliveryLineDraft = { ingredientId: '', qtyExpected: '', qtyReceived: '', unitCostIqd: '', expiryDate: '' };
  const line = (over: Partial<DeliveryLineDraft>): DeliveryLineDraft => ({ ...blank, ...over });

  it('skips a line nothing was typed into, rather than calling it an error', () => {
    expect(isBlankLine(blank)).toBe(true);
    expect(lineProblem(blank)).toBeNull();
  });

  // The old screen dropped half-filled lines silently on submit.
  it('names the first thing missing from a started line', () => {
    expect(lineProblem(line({ qtyReceived: '5' }))).toBe('ingredient');
    expect(lineProblem(line({ ingredientId: 'i1' }))).toBe('received');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '0' }))).toBe('received');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '5' }))).toBe('cost');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '5', unitCostIqd: '2', qtyExpected: 'x' }))).toBe('ordered');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '5', unitCostIqd: '0' }))).toBeNull();
  });

  it('flags a short delivery only when both amounts are known', () => {
    expect(isShort({ qtyExpected: '10', qtyReceived: '8' })).toBe(true);
    expect(isShort({ qtyExpected: '', qtyReceived: '8' })).toBe(false);
    expect(isShort({ qtyExpected: '8', qtyReceived: '8' })).toBe(false);
  });

  it('prefills a per-unit cost from the pack price', () => {
    expect(unitCostFromPack(1000, 5000)).toBe(5);
    expect(unitCostFromPack(3, 1000)).toBe(333.3333);
    expect(unitCostFromPack(0, 5000)).toBeNull();
    expect(unitCostFromPack(null, 5000)).toBeNull();
  });
});

describe('count entries', () => {
  it('tells an empty box from a typo', () => {
    expect(countEntryState(undefined)).toBe('blank');
    expect(countEntryState(' ')).toBe('blank');
    expect(countEntryState('12.5')).toBe('ok');
    expect(countEntryState('0')).toBe('ok');
    expect(countEntryState('-1')).toBe('invalid');
    expect(countEntryState('abc')).toBe('invalid');
  });
});

describe('alerts', () => {
  // The server raises one kind for "about to expire" and "already expired".
  it('splits expired batches out of expiring soon', () => {
    expect(alertKind('expiring_soon', { expired: true })).toBe('expired');
    expect(alertKind('expiring_soon', {})).toBe('expiring_soon');
    expect(alertKind('negative_stock', {})).toBe('negative_stock');
    expect(alertKind('something_new', {})).toBeNull();
  });

  it('orders groups by what hurts most if ignored, and lists every kind once', () => {
    expect(ALERT_ORDER[0]).toBe('negative_stock');
    expect(new Set(ALERT_ORDER).size).toBe(ALERT_ORDER.length);
  });
});

describe('margins', () => {
  it('flags a loss before a thin margin', () => {
    expect(marginFlag({ margin_iqd: -100, margin_percent: -5 })).toBe('loss');
    expect(marginFlag({ margin_iqd: 500, margin_percent: 20 })).toBe('thin');
    expect(marginFlag({ margin_iqd: 500, margin_percent: 30 })).toBeNull();
    expect(marginFlag({ margin_iqd: 500, margin_percent: null })).toBeNull();
  });
});
