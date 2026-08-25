import { describe, expect, it } from 'vitest';
import {
  analyzeMenuPosition,
  buildMenuSlots,
  type MenuSnapshotItem,
  MIN_TOTAL_ITEMS,
  spearman,
  spearmanP,
} from './menuPosition';

describe('spearman', () => {
  it('matches known vectors', () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 10);
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4, 5], [1, 3, 2, 5, 4])).toBeCloseTo(0.8, 10);
    // Ties take average ranks: y=[2,2,4,4,6,6] → [1.5,1.5,3.5,3.5,5.5,5.5]; ρ = 16/√280 ≈ 0.9562
    expect(spearman([1, 2, 3, 4, 5, 6], [2, 2, 4, 4, 6, 6])).toBeCloseTo(16 / Math.sqrt(280), 10);
    // Naive "sort and index" ranking would give a different, biased value.
    expect(spearman([1, 2, 3, 4, 5, 6], [2, 2, 4, 4, 6, 6])).not.toBeCloseTo(1, 2);
  });

  it('is 0 on degenerate input', () => {
    expect(spearman([1, 2], [2, 1])).toBe(0);
    expect(spearman([1, 2, 3], [7, 7, 7])).toBe(0);
    expect(spearman([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe('spearmanP', () => {
  it('is 1 below n = 4 and decreases with |ρ| and n', () => {
    expect(spearmanP(0.9, 3)).toBe(1);
    expect(spearmanP(0.5, 10)).toBeGreaterThan(spearmanP(0.8, 10));
    expect(spearmanP(0.8, 6)).toBeGreaterThan(spearmanP(0.8, 20));
    expect(spearmanP(-0.8, 20)).toBeCloseTo(spearmanP(0.8, 20), 12);
    expect(spearmanP(0, 30)).toBeCloseTo(1, 6);
    expect(spearmanP(0.99, 30)).toBeLessThan(0.001);
  });

  it('agrees with a known t-distribution value', () => {
    // ρ = 0.6, n = 12 → t = 0.6·√(10/0.64) = 2.372, df = 10 → two-sided p ≈ 0.0392
    expect(spearmanP(0.6, 12)).toBeCloseTo(0.0392, 3);
  });
});

const snapshot = (id: string, categoryId: string, sortOrder: number, priceIqd = 5000): MenuSnapshotItem => ({
  id,
  nameEn: id,
  nameAr: id,
  categoryId,
  categoryNameEn: categoryId,
  categoryNameAr: categoryId,
  sortOrder,
  priceIqd,
});

describe('buildMenuSlots', () => {
  it('ranks within each category by sort order then name', () => {
    const slots = buildMenuSlots([
      snapshot('c3', 'coffee', 30),
      snapshot('c1', 'coffee', 10),
      snapshot('f1', 'food', 5),
      snapshot('c2', 'coffee', 20),
      { ...snapshot('c2b', 'coffee', 20), nameEn: 'a-first' },
    ]);
    const coffee = slots.filter((s) => s.categoryId === 'coffee');
    expect(coffee.map((s) => [s.id, s.rank, s.categorySize])).toEqual([
      ['c1', 1, 4],
      ['c2b', 2, 4],
      ['c2', 3, 4],
      ['c3', 4, 4],
    ]);
    expect(slots.find((s) => s.id === 'f1')).toMatchObject({ rank: 1, categorySize: 1 });
  });
});

describe('analyzeMenuPosition', () => {
  const asOf = '2026-09-14';
  // 10 coffees in slot order; sales decline neatly with slot (with one tie).
  const coffee = Array.from({ length: 10 }, (_, i) => snapshot(`c${i + 1}`, 'coffee', (i + 1) * 10));
  const coffeeSales = coffee.map((c, i) => ({ id: c.id, qty: [90, 80, 70, 60, 50, 40, 40, 20, 10, 5][i]!, revenueIqd: 5000 * [90, 80, 70, 60, 50, 40, 40, 20, 10, 5][i]! }));

  it('reports no data below the pooled minimum', () => {
    const r = analyzeMenuPosition(buildMenuSlots(coffee.slice(0, 5)), coffeeSales.slice(0, 5), asOf);
    expect(r.hasData).toBe(false);
    expect(r.positionAsOf).toBe(asOf);
    expect(r.coverage.matchedItems).toBe(5);
    expect(5).toBeLessThan(MIN_TOTAL_ITEMS);
    expect(analyzeMenuPosition([], coffeeSales, asOf).hasData).toBe(false);
  });

  it('detects "top sells" with significance and a within-category ladder', () => {
    const r = analyzeMenuPosition(buildMenuSlots(coffee), coffeeSales, asOf);
    expect(r.hasData).toBe(true);
    expect(r.categories).toHaveLength(1);
    const cat = r.categories[0]!;
    expect(cat.rho).toBeLessThan(-0.95);
    expect(cat.significant).toBe(true);
    expect(cat.topThirdQty).toBe(240);
    expect(cat.bottomThirdQty).toBe(35);
    expect(cat.items.map((i) => i.salesRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cat.items[0]!.vsCategoryMedian).toBeCloseTo(90 / 45);
    expect(r.direction).toBe('top-sells');
    expect(r.significant).toBe(true);
    expect(r.coverage).toMatchObject({ matchedItems: 10, soldItems: 10, usableCategories: 1, revenueRatio: 1, reliable: true });
    expect(r.buriedWinners).toEqual([]);
    expect(r.squatters).toEqual([]);
  });

  it('names buried winners and squatters only on a material gap', () => {
    // Slot 8 outsells everything (buried winner); slot 2 barely sells (squatter).
    const qty = [50, 8, 45, 40, 35, 30, 25, 120, 15, 10];
    const sales = coffee.map((c, i) => ({ id: c.id, qty: qty[i]!, revenueIqd: qty[i]! * 5000 }));
    const r = analyzeMenuPosition(buildMenuSlots(coffee), sales, asOf);
    expect(r.buriedWinners.map((i) => i.id)).toEqual(['c8']);
    expect(r.buriedWinners[0]!.rankGap).toBe(1 - 8);
    expect(r.squatters.map((i) => i.id)).toEqual(['c2']);
  });

  it('leaves unmatched menu items out and small categories un-correlated', () => {
    const slots = buildMenuSlots([...coffee, snapshot('f1', 'food', 1), snapshot('f2', 'food', 2), snapshot('f3', 'food', 3)]);
    const r = analyzeMenuPosition(slots, [...coffeeSales, { id: 'f1', qty: 9, revenueIqd: 45000 }, { id: 'f2', qty: 3, revenueIqd: 15000 }], asOf);
    expect(r.coverage.matchedItems).toBe(12);
    expect(r.coverage.usableCategories).toBe(1); // food has 2 matched items < 4
    expect(r.categories[0]!.categoryId).toBe('coffee');
  });
});
