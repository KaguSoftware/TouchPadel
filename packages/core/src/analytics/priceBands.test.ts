import { describe, expect, it } from 'vitest';
import { MoneyError } from '../money/iqd';
import { bandOf, buildPriceBands, PRICE_BAND_EDGES_IQD, priceBandBounds } from './priceBands';

describe('bandOf / priceBandBounds', () => {
  it('matches the SQL bands <3000 / 3000–5999 / 6000–9999 / ≥10000', () => {
    expect(PRICE_BAND_EDGES_IQD).toEqual([3000, 6000, 10000]);
    expect(bandOf(0)).toBe(0);
    expect(bandOf(2999)).toBe(0);
    expect(bandOf(3000)).toBe(1);
    expect(bandOf(5999)).toBe(1);
    expect(bandOf(6000)).toBe(2);
    expect(bandOf(9999)).toBe(2);
    expect(bandOf(10000)).toBe(3);
    expect(bandOf(250000)).toBe(3);
    expect(priceBandBounds()).toEqual([
      { band: 0, minIqd: 0, maxIqd: 3000 },
      { band: 1, minIqd: 3000, maxIqd: 6000 },
      { band: 2, minIqd: 6000, maxIqd: 10000 },
      { band: 3, minIqd: 10000, maxIqd: null },
    ]);
  });

  it('supports custom edges', () => {
    expect(bandOf(7000, [5000, 10000])).toBe(1);
    expect(priceBandBounds([5000])).toHaveLength(2);
  });
});

describe('buildPriceBands', () => {
  const prices = new Map<string, number>([
    ['esp', 2500],
    ['cap', 5000],
    ['bur', 12000],
    ['kun', 8000],
  ]);

  it('always returns 4 bands, bands every item once, and caps conversion at 100 %', () => {
    const bands = buildPriceBands(
      [
        { id: 'esp', priceIqd: 2500, views: 20 },
        { id: 'esp', priceIqd: 2500, views: 5 },
        { id: 'cap', priceIqd: 5000, views: 100 },
        { id: 'bur', priceIqd: 12000, views: 80 },
      ],
      [
        { id: 'esp', qty: 60, revenueIqd: 150000 }, // staple: sells far more than it is viewed
        { id: 'cap', qty: 30, revenueIqd: 150000 },
        { id: 'kun', qty: 4, revenueIqd: 32000 }, // sold, never viewed → still banded by menu price
      ],
      prices,
    );
    expect(bands).toHaveLength(4);
    expect(bands.map((b) => b.band)).toEqual([0, 1, 2, 3]);
    expect(bands[0]).toMatchObject({ views: 25, sold: 60, revenueIqd: 150000, convPctCapped: 100, soldWithoutView: 35 });
    expect(bands[1]).toMatchObject({ views: 100, sold: 30, revenueIqd: 150000, convPctCapped: 30, soldWithoutView: 0 });
    expect(bands[2]).toMatchObject({ views: 0, sold: 4, revenueIqd: 32000, convPctCapped: 0, soldWithoutView: 4 });
    expect(bands[3]).toMatchObject({ views: 80, sold: 0, revenueIqd: 0, convPctCapped: 0, soldWithoutView: 0 });
    expect(bands[0]!.items).toEqual([{ id: 'esp', nameEn: '', nameAr: '', priceIqd: 2500, views: 25, sold: 60, revenueIqd: 150000 }]);
    expect(bands[2]!.items[0]).toMatchObject({ id: 'kun', sold: 4 });
  });

  it('resolves the price menu → view event → revenue ÷ qty, and skips the unbandable', () => {
    const bands = buildPriceBands(
      [
        { id: 'cap', priceIqd: 99999, views: 10 }, // menu price wins over the event price
        { id: 'offmenu', priceIqd: 7000, views: 10 }, // event price used
        { id: 'mystery', priceIqd: null, views: 10 }, // no price anywhere → dropped
      ],
      [
        { id: 'offmenu', qty: 2, revenueIqd: 14000 },
        { id: 'soldonly', qty: 3, revenueIqd: 33000 }, // 11000 each → top band
        { id: 'free', qty: 3, revenueIqd: 0 }, // no price derivable → dropped
      ],
      prices,
    );
    expect(bands[1]!.views).toBe(10);
    expect(bands[2]).toMatchObject({ views: 10, sold: 2 });
    expect(bands[3]).toMatchObject({ views: 0, sold: 3, revenueIqd: 33000 });
    const total = bands.reduce((s, b) => s + b.views, 0);
    expect(total).toBe(20);
    expect(bands.flatMap((b) => b.items).map((i) => i.id).sort()).toEqual(['cap', 'offmenu', 'soldonly']);
  });

  it('applies the exclusion filter and names', () => {
    const names = new Map([['cap', { id: 'cap', nameEn: 'Cappuccino', nameAr: 'كابتشينو' }]]);
    const bands = buildPriceBands(
      [
        { id: 'cap', priceIqd: null, views: 10 },
        { id: 'esp', priceIqd: null, views: 10 },
      ],
      [{ id: 'esp', qty: 5, revenueIqd: 12500 }],
      prices,
      (id) => id !== 'esp',
      { names },
    );
    expect(bands[0]).toMatchObject({ views: 0, sold: 0, items: [] });
    expect(bands[1]!.items[0]).toMatchObject({ nameEn: 'Cappuccino', nameAr: 'كابتشينو' });
  });

  it('validates money at the boundary', () => {
    expect(() => buildPriceBands([], [{ id: 'esp', qty: 1, revenueIqd: 1.5 }], prices)).toThrow(MoneyError);
    expect(() => buildPriceBands([{ id: 'esp', priceIqd: -1, views: 1 }], [], prices)).toThrow(MoneyError);
  });
});
