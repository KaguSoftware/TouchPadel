import { describe, expect, it } from 'vitest';
import { buildMenuEngineering, type CostedMenuItem } from './menuMatrix';
import { buildOverview, DEFAULT_OVERVIEW_COPY_EN, type OverviewInput } from './overview';

const ref = (id: string, nameEn: string, nameAr: string) => ({ id, nameEn, nameAr });

const base: OverviewInput = {
  preset: '30d',
  kpis: {
    totalSalesIqd: 9_000_000,
    totalCovers: 600,
    avgSpendPerCoverIqd: 15000,
    sessions: 900,
    medianSeconds: 95,
    waiterCalls: 120,
    views: 4000,
    basketConversionPct: 35,
  },
  deltas: { totalSales: null, avgSpendPerCover: null, totalCovers: null, basketConversion: null, views: null, sessions: null },
  itemConversion: [],
  abandonedViews: [],
  bestSellers: [],
};

const nullDeltas = base.deltas;

describe('buildOverview — tone', () => {
  it('is neutral without any movement', () => {
    const o = buildOverview(base);
    expect(o.tone).toBe('neutral');
    expect(o.headline).toBe('In the last 30 days the picture is steady — no clear rise or fall.');
    expect(o.strengths).toEqual([]);
  });

  it('is good with two or more rising metrics and nothing falling', () => {
    const o = buildOverview({ ...base, deltas: { ...nullDeltas, totalSales: 12, views: 8, sessions: 3 } });
    expect(o.tone).toBe('good');
    expect(o.strengths).toEqual(['Sales up 12%.', 'Menu views up 8%.']);
    expect(o.headline).toMatch(/^Things look good in the last 30 days/);
  });

  it('is weak with two falling metrics', () => {
    const o = buildOverview({ ...base, preset: '7d', deltas: { ...nullDeltas, totalSales: -10, totalCovers: -6 } });
    expect(o.tone).toBe('weak');
    expect(o.watch).toEqual(['Sales down 10%.', 'Covers down 6%.']);
    expect(o.headline).toMatch(/^In the last 7 days some indicators slipped/);
  });

  it('is mixed on one up and one down, and small moves are ignored', () => {
    const o = buildOverview({ ...base, deltas: { ...nullDeltas, totalSales: 5, views: -5, sessions: 4 } });
    expect(o.tone).toBe('mixed');
    expect(o.strengths).toEqual(['Sales up 5%.']);
    expect(o.watch).toEqual(['Menu views down 5%.']);
  });
});

const costed: CostedMenuItem[] = [
  { ...ref('esp', 'Espresso', 'إسبريسو'), defaultPriceIqd: 3000, costIqd: 700 },
  { ...ref('cap', 'Cappuccino', 'كابتشينو'), defaultPriceIqd: 5000, costIqd: 1100 },
  { ...ref('bur', 'Burger', 'برغر'), defaultPriceIqd: 12000, costIqd: 4500 },
  { ...ref('kun', 'Kunafa', 'كنافة'), defaultPriceIqd: 9000, costIqd: 7000 },
  { ...ref('loss', 'Loss Leader', 'خاسر'), defaultPriceIqd: 2000, costIqd: 2500 },
];

const me = buildMenuEngineering(
  [
    { id: 'esp', qty: 200, revenueIqd: 600000 },
    { id: 'cap', qty: 150, revenueIqd: 750000 },
    { id: 'bur', qty: 20, revenueIqd: 240000 },
    { id: 'kun', qty: 30, revenueIqd: 270000 },
  ],
  costed,
);

describe('buildOverview — profit lines', () => {
  it('lead each group when cost data exists', () => {
    const o = buildOverview({
      ...base,
      deltas: { ...nullDeltas, totalSales: 12, views: 8 },
      bestSellers: [{ ...ref('esp', 'Espresso', 'إسبريسو'), qty: 200, revenueIqd: 600000 }],
      menuEngineering: me,
    });
    expect(o.tone).toBe('good');
    expect(o.strengths[0]).toMatch(/^Gross margin \d+% — [\d,]+ IQD gross profit\.$/);
    expect(o.strengths).toHaveLength(4); // margin + 2 metrics + best seller
    // plowhorse (Espresso) is the top watch line; puzzle (Burger) the top push line
    expect(o.watch[0]).toMatch(/^Espresso sells a lot but earns little/);
    expect(o.push[0]).toMatch(/^Burger earns [\d,]+ IQD per unit but sells little \(20\)/);
    // The best-seller push line is a fact and always appears (even when the plowhorse line
    // already names the item); the dedupe only guards the derived item lines.
    expect(o.push[1]).toBe('Espresso sells strongly — keep it featured on the menu and in suggestions.');
    expect(o.push).toHaveLength(2);
  });

  it('never calls a period good while something sells below cost', () => {
    const withLoss = buildMenuEngineering(
      [
        { id: 'esp', qty: 200, revenueIqd: 600000 },
        { id: 'loss', qty: 10, revenueIqd: 20000 },
      ],
      costed,
    );
    const o = buildOverview({ ...base, deltas: { ...nullDeltas, totalSales: 12, views: 8 }, menuEngineering: withLoss });
    expect(o.tone).toBe('mixed');
    expect(o.watch[0]).toBe('Loss Leader sells below cost (-500 IQD per unit) — 5,000 IQD lost over the period; fix the price or portion cost now.');
  });

  it('says nothing about margin without cost data', () => {
    const o = buildOverview({ ...base, menuEngineering: buildMenuEngineering([{ id: 'x', qty: 1, revenueIqd: 1000 }], costed) });
    expect(o.strengths.join(' ')).not.toMatch(/margin/i);
  });
});

describe('buildOverview — items and copy', () => {
  const input: OverviewInput = {
    ...base,
    itemConversion: [
      { ...ref('cap', 'Cappuccino', 'كابتشينو'), views: 100, carts: 10, sold: 60, convPct: 60 },
      { ...ref('dead', 'Dead Item', 'راكد'), views: 40, carts: 0, sold: 0, convPct: 0 },
      { ...ref('thin', 'Thin', 'رقيق'), views: 3, carts: 0, sold: 0, convPct: 0 },
    ],
    abandonedViews: [
      { ...ref('ab', 'Abandoned', 'متروك'), b5to10: 1, b10to20: 1, b20plus: 3, total: 5 },
      { ...ref('cap', 'Cappuccino', 'كابتشينو'), b5to10: 5, b10to20: 0, b20plus: 0, total: 5 },
    ],
    bestSellers: [{ ...ref('esp', 'Espresso', 'إسبريسو'), qty: 200, revenueIqd: 600000 }],
  };

  it('pushes winners and high-intent items, watches abandoned and dead items, without double mentions', () => {
    const o = buildOverview(input);
    expect(o.strengths).toEqual(['Best seller: Espresso (200 sold, 600,000 IQD).']);
    expect(o.push).toEqual([
      'Espresso sells strongly — keep it featured on the menu and in suggestions.',
      'Cappuccino converts when seen (about 6 sales per 10 views) — try moving it higher on the menu.',
    ]);
    expect(o.watch).toEqual([
      'Abandoned gets looked at but not ordered (5 times); 3 people read it for 20 s+ and gave up — the description or price may be the issue.',
      'Dead Item was viewed 40 times but never sold — review how it is presented.',
    ]);
  });

  it('renders Arabic names when the copy locale is ar', () => {
    const o = buildOverview(input, { ...DEFAULT_OVERVIEW_COPY_EN, locale: 'ar' });
    expect(o.strengths[0]).toBe('Best seller: إسبريسو (200 sold, 600,000 IQD).');
  });

  it('does not judge "never sold" when the period has no item sales at all', () => {
    const o = buildOverview({ ...input, bestSellers: [], itemConversion: input.itemConversion.map((r) => ({ ...r, sold: 0, convPct: 0 })) });
    expect(o.watch.some((l) => l.includes('never sold'))).toBe(false);
  });
});
