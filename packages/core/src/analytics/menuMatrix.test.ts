import { describe, expect, it } from 'vitest';
import { MoneyError } from '../money/iqd';
import { buildMenuEngineering, type CostedMenuItem, menuEngineeringForModel, RELIABLE_COST_COVERAGE } from './menuMatrix';

const item = (id: string, nameEn: string, defaultPriceIqd: number, costIqd: number | null): CostedMenuItem => ({
  id,
  nameEn,
  nameAr: `${nameEn}-ar`,
  defaultPriceIqd,
  costIqd,
});

const items: CostedMenuItem[] = [
  item('esp', 'Espresso', 3000, 700),
  item('cap', 'Cappuccino', 5000, 1100),
  item('bur', 'Burger', 12000, 4500),
  item('kun', 'Kunafa', 9000, 7000),
  item('nuts', 'Mixed Nuts', 4000, null), // no cost entered
  item('loss', 'Loss Leader', 2000, 2500), // sold below cost
];

describe('buildMenuEngineering', () => {
  it('excludes un-costed items and reports coverage', () => {
    const me = buildMenuEngineering(
      [
        { id: 'esp', qty: 100, revenueIqd: 300000 },
        { id: 'nuts', qty: 50, revenueIqd: 200000 },
        { id: 'ghost', qty: 5, revenueIqd: 25000 }, // not on the menu at all
      ],
      items,
    );
    expect(me.hasData).toBe(true);
    expect(me.items.map((i) => i.id)).toEqual(['esp']);
    expect(me.coverage).toEqual({
      costedItems: 1,
      soldItems: 3,
      totalRevenueIqd: 525000,
      revenueRatio: 300000 / 525000,
      reliable: false,
    });
    expect(300000 / 525000).toBeLessThan(RELIABLE_COST_COVERAGE);
  });

  it('is empty (hasData false) when nothing sold has a cost', () => {
    const me = buildMenuEngineering([{ id: 'nuts', qty: 3, revenueIqd: 12000 }], items);
    expect(me.hasData).toBe(false);
    expect(me.items).toEqual([]);
    expect(me.coverage.soldItems).toBe(1);
    expect(me.coverage.totalRevenueIqd).toBe(12000);
  });

  it('uses the weighted-average margin axis and the 70 % popularity rule', () => {
    const me = buildMenuEngineering(
      [
        { id: 'esp', qty: 200, revenueIqd: 600000 }, // unit 3000, margin 2300
        { id: 'cap', qty: 150, revenueIqd: 750000 }, // unit 5000, margin 3900
        { id: 'bur', qty: 20, revenueIqd: 240000 }, // unit 12000, margin 7500
        { id: 'kun', qty: 30, revenueIqd: 270000 }, // unit 9000, margin 2000
      ],
      items,
    );
    const totalProfit = 200 * 2300 + 150 * 3900 + 20 * 7500 + 30 * 2000;
    const totalQty = 400;
    expect(me.totals).toEqual({ qty: 400, revenueIqd: 1860000, costIqd: 1860000 - totalProfit, profitIqd: totalProfit, marginPct: Math.round((totalProfit / 1860000) * 100) });
    expect(me.avgUnitMarginIqd).toBeCloseTo(totalProfit / totalQty); // 3182.5, well below the unweighted mean
    expect(me.popularityThreshold).toBeCloseTo(0.25 * 0.7);
    const q = Object.fromEntries(me.items.map((i) => [i.id, i.quadrant]));
    expect(q).toEqual({ esp: 'plowhorse', cap: 'star', bur: 'puzzle', kun: 'dog' });
    expect(me.counts).toEqual({ star: 1, plowhorse: 1, puzzle: 1, dog: 1 });
    // strongest profit first
    expect(me.items.map((i) => i.id)).toEqual(['cap', 'esp', 'bur', 'kun']);
    expect(me.coverage.reliable).toBe(true);
    // Integer money everywhere it represents a sum.
    for (const i of me.items) {
      expect(Number.isInteger(i.revenueIqd)).toBe(true);
      expect(Number.isInteger(i.profitIqd)).toBe(true);
      expect(Number.isInteger(i.unitCostIqd)).toBe(true);
    }
    expect(Number.isInteger(me.totals.profitIqd)).toBe(true);
  });

  it('flags items sold below cost with a negative, signed profit', () => {
    const me = buildMenuEngineering(
      [
        { id: 'loss', qty: 10, revenueIqd: 20000 },
        { id: 'esp', qty: 10, revenueIqd: 30000 },
      ],
      items,
    );
    const loss = me.items.find((i) => i.id === 'loss')!;
    expect(loss.losingMoney).toBe(true);
    expect(loss.profitIqd).toBe(-5000);
    expect(loss.unitMarginIqd).toBe(-500);
    expect(loss.marginPct).toBe(-25);
    expect(loss.profitShare).toBeLessThan(0);
  });

  it('takes the real selling price from revenue ÷ qty, list price only as fallback', () => {
    const me = buildMenuEngineering(
      [
        { id: 'cap', qty: 10, revenueIqd: 40000 }, // discounted to 4000
        { id: 'esp', qty: 10, revenueIqd: 0 }, // no revenue recorded → list price
      ],
      items,
    );
    expect(me.items.find((i) => i.id === 'cap')!.unitPriceIqd).toBe(4000);
    expect(me.items.find((i) => i.id === 'esp')).toMatchObject({ unitPriceIqd: 3000, revenueIqd: 30000 });
  });

  it('sums duplicate sold rows and drops zero-qty rows', () => {
    const me = buildMenuEngineering(
      [
        { id: 'esp', qty: 4, revenueIqd: 12000 },
        { id: 'esp', qty: 6, revenueIqd: 18000 },
        { id: 'cap', qty: 0, revenueIqd: 0 },
      ],
      items,
    );
    expect(me.items).toHaveLength(1);
    expect(me.items[0]).toMatchObject({ id: 'esp', qty: 10, revenueIqd: 30000 });
    expect(me.coverage.soldItems).toBe(1);
  });

  it('validates money and quantities at the boundary', () => {
    expect(() => buildMenuEngineering([{ id: 'esp', qty: 1, revenueIqd: 10.5 }], items)).toThrow(MoneyError);
    expect(() => buildMenuEngineering([{ id: 'esp', qty: 1.5, revenueIqd: 10 }], items)).toThrow(RangeError);
    expect(() => buildMenuEngineering([], [item('bad', 'Bad', 1000, -1)])).toThrow(MoneyError);
  });
});

describe('menuEngineeringForModel', () => {
  it('returns null without data and otherwise the head plus every problem item', () => {
    expect(menuEngineeringForModel(buildMenuEngineering([], items))).toBeNull();
    const me = buildMenuEngineering(
      [
        { id: 'esp', qty: 200, revenueIqd: 600000 },
        { id: 'cap', qty: 150, revenueIqd: 750000 },
        { id: 'bur', qty: 20, revenueIqd: 240000 },
        { id: 'kun', qty: 30, revenueIqd: 270000 },
        { id: 'loss', qty: 10, revenueIqd: 20000 },
      ],
      items,
    );
    const m = menuEngineeringForModel(me, 2, 'ar')!;
    // head = 2 best contributors; problems = plowhorse/dog/losing-money not already in head
    expect(m.items.map((i) => i.id)).toEqual(['cap', 'esp', 'kun', 'loss']);
    expect(m.items[0]!.name).toBe('Cappuccino-ar');
    expect(m.covered).toEqual({ items: 5, ofItems: 5, revenueSharePct: 100, reliable: true });
    expect(Number.isInteger(m.avgUnitMarginIqd)).toBe(true);
  });
});
