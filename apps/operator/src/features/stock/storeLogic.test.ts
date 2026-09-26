import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import {
  COST_SOURCES,
  MOVEMENT_TYPES,
  anyInBakery,
  bakeryRefused,
  beingCounted,
  costPerBaseUnit,
  countDifference,
  directionStores,
  heldAt,
  isBlankMoveLine,
  isFirstMoveDay,
  isMovementType,
  linesNeedingCost,
  moveBaseQty,
  moveLineProblem,
  movePayload,
  phoneCountWaitingAt,
  phoneCountsWaiting,
  readStaffLogs,
  repeatedIngredients,
  shortShows,
  splitByStore,
  splitWorthShowing,
  storeOf,
  transferNote,
  type MoveLineDraft,
  type UnfinishedCount,
} from './storeLogic';

// The cafe store and the bakery store on the operator (wave5-addendum-2026-09-25
// §2.8, §5.2): what each form offers, holds and sends, pinned without a screen.

const line = (over: Partial<MoveLineDraft>): MoveLineDraft => ({ key: 'k', ingredientId: 'flour', qty: '', unit: 'base', ...over });
const flour = { id: 'flour', unit: 'g', pack_size: 25_000 };
const salt = { id: 'salt', unit: 'g', pack_size: null };

describe('stores', () => {
  it('reads a store off the wire, and nothing it does not know', () => {
    expect(storeOf('cafe')).toBe('cafe');
    expect(storeOf('bakery')).toBe('bakery');
    expect(storeOf('garage')).toBeNull();
    expect(storeOf(null)).toBeNull();
  });

  it('splits the view’s one row per store into one split per ingredient', () => {
    const splits = splitByStore([
      { ingredient_id: 'flour', location: 'cafe', on_hand: '12000' },
      { ingredient_id: 'flour', location: 'bakery', on_hand: 3000 },
      { ingredient_id: 'milk', location: 'cafe', on_hand: 800 },
      { ingredient_id: 'milk', location: 'bakery', on_hand: 0 },
      { ingredient_id: 'odd', location: 'garage', on_hand: 5 },
    ]);
    expect(splits.get('flour')).toEqual({ cafe: 12000, bakery: 3000 });
    expect(splits.get('milk')).toEqual({ cafe: 800, bakery: 0 });
    expect(splits.has('odd')).toBe(false);
    expect(heldAt(splits.get('flour'), 'bakery')).toBe(3000);
    expect(heldAt(undefined, 'cafe')).toBe(0);
  });

  it('prints the split under the total only once the bakery store holds some', () => {
    expect(splitWorthShowing({ cafe: 800, bakery: 0 })).toBe(false);
    expect(splitWorthShowing({ cafe: 0, bakery: 5 })).toBe(true);
    expect(splitWorthShowing(undefined)).toBe(false);
    expect(anyInBakery(new Map([['m', { cafe: 1, bakery: 0 }]]))).toBe(false);
    expect(anyInBakery(new Map([['m', { cafe: 1, bakery: 0 }], ['f', { cafe: 0, bakery: 2 }]]))).toBe(true);
  });
});

describe('Move stock', () => {
  it('turns the one direction control into two different stores', () => {
    expect(directionStores('cafe_to_bakery')).toEqual({ from: 'cafe', to: 'bakery' });
    expect(directionStores('bakery_to_cafe')).toEqual({ from: 'bakery', to: 'cafe' });
  });

  it('converts packs as transfer_stock does, and refuses what it would refuse', () => {
    expect(moveBaseQty(line({ qty: '2' }), flour)).toBe(2);
    expect(moveBaseQty(line({ qty: '2', unit: 'pack' }), flour)).toBe(50_000);
    expect(moveBaseQty(line({ qty: '1', unit: 'pack' }), salt)).toBeNull();
    expect(moveBaseQty(line({ qty: '0' }), flour)).toBeNull();
    expect(moveBaseQty(line({ qty: '' }), flour)).toBeNull();
  });

  it('holds a line with the first thing wrong, and says early what TRANSFER_SHORT would', () => {
    const ok = { onHandAtSource: 30_000, repeated: false };
    expect(moveLineProblem(line({ ingredientId: '', qty: '' }), undefined, ok)).toBeNull();
    expect(moveLineProblem(line({ ingredientId: '', qty: '5' }), undefined, ok)).toBe('ingredient');
    expect(moveLineProblem(line({ qty: '5' }), flour, { ...ok, repeated: true })).toBe('repeat');
    expect(moveLineProblem(line({ qty: 'abc' }), flour, ok)).toBe('qty');
    expect(moveLineProblem(line({ qty: '2', unit: 'pack' }), flour, ok)).toBe('short');
    expect(moveLineProblem(line({ qty: '30000' }), flour, ok)).toBeNull();
    expect(moveLineProblem(line({ qty: '1', unit: 'pack' }), flour, ok)).toBeNull();
  });

  it('sends base-unit lines bare and pack lines as packs, blank lines left out', () => {
    expect(
      movePayload([line({ qty: '500' }), line({ key: 'b', ingredientId: 'sugar', qty: '2', unit: 'pack' }), line({ key: 'c', ingredientId: '', qty: '' })]),
    ).toEqual([
      { ingredient_id: 'flour', qty: 500 },
      { ingredient_id: 'sugar', qty: 2, unit: 'pack' },
    ]);
    expect(isBlankMoveLine(line({ ingredientId: '', qty: ' ' }))).toBe(true);
  });

  it('finds an ingredient picked twice: transfer_stock takes each once', () => {
    expect([...repeatedIngredients([line({}), line({ key: 'b' }), line({ key: 'c', ingredientId: 'salt' }), line({ key: 'd', ingredientId: '' })])]).toEqual(['flour']);
  });

  it('reads what the store shows off a TRANSFER_SHORT', () => {
    expect(shortShows('1200')).toBe(1200);
    expect(shortShows('0')).toBe(0);
    expect(shortShows(undefined)).toBeNull();
    expect(shortShows('n/a')).toBeNull();
  });

  it('shows the first-day call-out only while no move was ever recorded', () => {
    expect(isFirstMoveDay(0)).toBe(true);
    expect(isFirstMoveDay(3)).toBe(false);
    expect(isFirstMoveDay(undefined)).toBe(false);
  });
});

describe('adding stock and counts', () => {
  const counts: UnfinishedCount[] = [
    { id: 'op', location: 'bakery', source: 'operator', started_at: '2026-09-26T07:00:00Z' },
    { id: 'ph', location: 'cafe', source: 'phone', started_at: '2026-09-26T06:00:00Z', staff: { display_name: 'Tiba' } },
  ];

  it('keeps shop stock out of the bakery store (V14)', () => {
    expect(bakeryRefused(['purchased', 'retail'])).toBe(true);
    expect(bakeryRefused(['purchased', undefined, null])).toBe(false);
  });

  it('holds a store only for a manager’s open count, never for a waiting phone count (M5)', () => {
    expect(beingCounted(counts, 'bakery')).toBe(true);
    expect(beingCounted(counts, 'cafe')).toBe(false);
    expect(beingCounted(undefined, 'cafe')).toBe(false);
  });

  it('finds the phone counts waiting, and the one holding a store’s Start', () => {
    expect(phoneCountsWaiting(counts).map((c) => c.id)).toEqual(['ph']);
    expect(phoneCountWaitingAt(counts, 'cafe')?.id).toBe('ph');
    expect(phoneCountWaitingAt(counts, 'bakery')).toBeNull();
  });

  it('works out a phone count line’s difference to the 3 places the lines keep', () => {
    expect(countDifference(4800, 5000)).toBe(-200);
    expect(countDifference(0.3, 0.1)).toBe(0.2);
    expect(countDifference(10, 10)).toBe(0);
  });
});

describe('Added by staff', () => {
  const log = (id: string, at: string, sources: string[]) => ({
    id,
    location: 'bakery',
    received_at: at,
    staff: { display_name: 'Rusul' },
    delivery_lines: sources.map((s, i) => ({ id: `${id}-${i}`, ingredient_id: 'flour', qty_received: '5000', unit_cost_iqd: s === 'none' ? 0 : 2.5, cost_source: s, expiry_date: null })),
  });

  it('lists the logs needing a cost first, then newest first, once each', () => {
    const logs = readStaffLogs([
      log('new', '2026-09-26T09:00:00Z', ['last_batch']),
      log('old', '2026-09-20T09:00:00Z', ['pack', 'none']),
      log('mid', '2026-09-24T09:00:00Z', ['entered']),
      log('new', '2026-09-26T09:00:00Z', ['last_batch']),
      { nope: true },
    ]);
    expect(logs.map((l) => l.id)).toEqual(['old', 'new', 'mid']);
    expect(logs[0]).toMatchObject({ location: 'bakery', staffName: 'Rusul' });
    expect(logs[0]!.lines[1]).toMatchObject({ qty_received: 5000, cost_source: 'none' });
    expect(linesNeedingCost(logs)).toBe(1);
  });

  it('reads a cost source it does not know as a cost a manager set', () => {
    expect(COST_SOURCES).toContain('none');
    expect(readStaffLogs([log('x', '2026-09-26T09:00:00Z', ['mystery'])])[0]!.lines[0]!.cost_source).toBe('entered');
  });

  it('turns a typed cost into the cost per base unit price_logged_stock takes', () => {
    expect(costPerBaseUnit('2.5', 'unit', null)).toBe(2.5);
    expect(costPerBaseUnit('0', 'unit', null)).toBe(0);
    expect(costPerBaseUnit('15000', 'pack', 1000)).toBe(15);
    expect(costPerBaseUnit('10000', 'pack', 3)).toBe(3333.3333);
    expect(costPerBaseUnit('15000', 'pack', null)).toBeNull();
    expect(costPerBaseUnit('', 'unit', null)).toBeNull();
    expect(costPerBaseUnit('-1', 'unit', null)).toBeNull();
    expect(costPerBaseUnit('1000000000', 'unit', null)).toBeNull();
  });
});

describe('the ledger', () => {
  it('names every movement type, the move between stores included, in both languages', () => {
    expect(MOVEMENT_TYPES).toContain('transfer');
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      for (const type of MOVEMENT_TYPES) {
        const key = `op.stock.movement.${type}`;
        expect(t(key as never), `${locale} ${type}`).not.toBe(key);
      }
    }
    expect(isMovementType('transfer')).toBe(true);
    expect(isMovementType('teleport')).toBe(false);
  });

  it('says where the other half of a move went, from the row’s own store and sign', () => {
    expect(transferNote(-500, 'cafe')).toEqual({ dir: 'to', store: 'bakery' });
    expect(transferNote(500, 'bakery')).toEqual({ dir: 'from', store: 'cafe' });
    expect(transferNote(500, null)).toBeNull();
    expect(transferNote(0, 'cafe')).toBeNull();
  });
});
