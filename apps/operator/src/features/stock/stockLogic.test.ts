import { describe, expect, it } from 'vitest';
import {
  ALERT_ORDER,
  alertKind,
  countEntryState,
  isBelowPar,
  isBlankLine,
  isLow,
  isOut,
  isPastExpiry,
  isShort,
  lineProblem,
  marginFlag,
  matchesName,
  matchesOnHandFilter,
  needsCount,
  onHandStatus,
  parseOnHandFilter,
  stockLevel,
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

  it('is out of stock at zero, reorder point or not', () => {
    expect(isOut(row({ on_hand: 0 }))).toBe(true);
    expect(isOut(row({ on_hand: 0, low_stock_threshold: null }))).toBe(true);
    expect(isOut(row({ on_hand: 1 }))).toBe(false);
  });

  // The three predicates all fire on an empty shelf. Whatever counts rows has
  // to ask for the rung, or one ingredient is reported three times over.
  it('puts a row on one rung of the ladder only', () => {
    const empty = row({ on_hand: 0 });
    expect(isOut(empty) && isLow(empty) && isBelowPar(empty)).toBe(true);
    expect(stockLevel(empty)).toBe('out');
    expect(stockLevel(row({ on_hand: 800 }))).toBe('low');
    expect(stockLevel(row({ on_hand: 3000 }))).toBe('belowPar');
    expect(stockLevel(row())).toBe('ok');
    expect(stockLevel(row({ on_hand: 0, low_stock_threshold: null, par_level: null }))).toBe('out');
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

  // A row sold past its records is nearly always at zero, so "count needed"
  // may not outrank the level: it would hide every empty shelf behind a
  // bookkeeping note. The table prints the recorded figure beside the badge.
  it('wears its level as the status, and "count needed" only when the level is fine', () => {
    expect(onHandStatus(row({ on_hand: 0, theoretical: -20 }))).toBe('out');
    expect(onHandStatus(row({ on_hand: 0, low_stock_threshold: null, par_level: null }))).toBe('out');
    expect(onHandStatus(row({ on_hand: 500, theoretical: -20 }))).toBe('low');
    expect(onHandStatus(row({ on_hand: 3000, theoretical: 2800 }))).toBe('belowPar');
    expect(onHandStatus(row({ on_hand: 5000, theoretical: 4800 }))).toBe('countNeeded');
    expect(onHandStatus(row())).toBe('ok');
  });
});

describe('on hand filter', () => {
  it('accepts the links other screens use and opens everything for anything else', () => {
    expect(parseOnHandFilter('out')).toBe('out');
    expect(parseOnHandFilter('low')).toBe('low');
    expect(parseOnHandFilter('belowPar')).toBe('belowPar');
    expect(parseOnHandFilter('countNeeded')).toBe('countNeeded');
    expect(parseOnHandFilter('nonsense')).toBe('all');
    expect(parseOnHandFilter(undefined)).toBe('all');
  });

  it('narrows the table to exactly the rows the filter names', () => {
    const out = row({ on_hand: 0 });
    const low = row({ on_hand: 10 });
    const under = row({ on_hand: 3000 });
    const fine = row();
    const all = [out, low, under, fine];
    expect(all.filter((r) => matchesOnHandFilter(r, 'out'))).toEqual([out]);
    expect(all.filter((r) => matchesOnHandFilter(r, 'low'))).toEqual([low]);
    expect(all.filter((r) => matchesOnHandFilter(r, 'belowPar'))).toEqual([under]);
    expect(all.filter((r) => matchesOnHandFilter(r, 'all'))).toEqual(all);
  });

  // What the manager was reading as "54 out of stock, 49 below par": the same
  // shelves, counted twice. Every row belongs to exactly one level filter.
  it('counts each row under one level, so the attention list adds up', () => {
    const rows = [row({ on_hand: 0 }), row({ on_hand: 0 }), row({ on_hand: 10 }), row({ on_hand: 3000 }), row()];
    const counts = (['out', 'low', 'belowPar'] as const).map((f) => rows.filter((r) => matchesOnHandFilter(r, f)).length);
    expect(counts).toEqual([2, 1, 1]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(rows.length - 1);
  });

  it('searches either language', () => {
    expect(matchesName(row(), 'milk')).toBe(true);
    expect(matchesName(row(), 'حليب')).toBe(true);
    expect(matchesName(row(), '  ')).toBe(true);
    expect(matchesName(row(), 'bread')).toBe(false);
  });
});

describe('goods in lines', () => {
  const TODAY = '2026-09-23';
  const blank: DeliveryLineDraft = { ingredientId: '', qtyExpected: '', qtyReceived: '', unitCostIqd: '', expiryDate: '' };
  const line = (over: Partial<DeliveryLineDraft>): DeliveryLineDraft => ({ ...blank, ...over });

  it('skips a line nothing was typed into, rather than calling it an error', () => {
    expect(isBlankLine(blank)).toBe(true);
    expect(lineProblem(blank, TODAY)).toBeNull();
  });

  // The old screen dropped half-filled lines silently on submit.
  it('names the first thing missing from a started line', () => {
    expect(lineProblem(line({ qtyReceived: '5' }), TODAY)).toBe('ingredient');
    expect(lineProblem(line({ ingredientId: 'i1' }), TODAY)).toBe('received');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '0' }), TODAY)).toBe('received');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '5' }), TODAY)).toBe('cost');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '5', unitCostIqd: '2', qtyExpected: 'x' }), TODAY)).toBe('ordered');
    expect(lineProblem(line({ ingredientId: 'i1', qtyReceived: '5', unitCostIqd: '0' }), TODAY)).toBeNull();
  });

  // Stock that expired before it arrived cannot go on the shelf, so the line
  // holds the Record button rather than booking a dead batch.
  it('refuses an expiry date already behind us, and lets today through', () => {
    const good = { ingredientId: 'i1', qtyReceived: '5', unitCostIqd: '2' };
    expect(lineProblem(line({ ...good, expiryDate: '2026-09-22' }), TODAY)).toBe('expiry');
    expect(lineProblem(line({ ...good, expiryDate: TODAY }), TODAY)).toBeNull();
    expect(lineProblem(line({ ...good, expiryDate: '2026-12-01' }), TODAY)).toBeNull();
    expect(lineProblem(line({ ...good, expiryDate: '' }), TODAY)).toBeNull();
  });

  it('reads a blank expiry box as "no expiry", not as a past one', () => {
    expect(isPastExpiry('', TODAY)).toBe(false);
    expect(isPastExpiry('  ', TODAY)).toBe(false);
    expect(isPastExpiry('2020-01-01', TODAY)).toBe(true);
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

  // Same idea for an empty shelf (migration 0151): one server kind, two
  // meanings, and "Running low" is the wrong thing to say about a shelf with
  // nothing on it.
  it('splits an empty shelf out of running low', () => {
    expect(alertKind('low_stock', { out: true })).toBe('out_of_stock');
    expect(alertKind('low_stock', {})).toBe('low_stock');
    expect(alertKind('low_stock', { out: false })).toBe('low_stock');
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
