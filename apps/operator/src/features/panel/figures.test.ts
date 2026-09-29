import { describe, expect, it } from 'vitest';
import { ALL_FIGURE_KEYS, FIGURE_KEYS, FIGURES, ONLINE_FIGURE_KEYS, figuresIn, figuresToCsvRows, hasOnlineFigures, mapFigures, panelIsEmpty } from './figures';

describe('figure metadata', () => {
  it('covers the twelve panel figures, each in exactly one group', () => {
    expect(FIGURE_KEYS).toHaveLength(13);
    const all = [...figuresIn('headline'), ...figuresIn('padel'), ...figuresIn('cafe'), ...figuresIn('losses')].map((f) => f.key);
    expect([...all].sort()).toEqual([...FIGURE_KEYS].sort());
  });
  it('lists money given away or thrown out as its own group, not under the cafe', () => {
    expect(figuresIn('losses').map((f) => f.key)).toEqual(['discounts', 'refunds', 'waste']);
    expect(figuresIn('cafe').map((f) => f.key)).toEqual(['cafeRevenue', 'cafeNet', 'orders', 'avgOrderValue']);
  });
  it('inverts the figures where a rise is bad', () => {
    expect(FIGURES.refunds.invert).toBe(true);
    expect(FIGURES.waste.invert).toBe(true);
    expect(FIGURES.noShows.invert).toBe(true);
    expect(FIGURES.revenue.invert).toBeUndefined();
  });
});

describe('mapFigures', () => {
  it('keeps known keys and drops unknown or malformed entries', () => {
    const m = mapFigures({
      figures: [
        { key: 'revenue', value: 100, previous: 80, changeAbs: 20, changePct: 25 },
        { key: 'mystery', value: 1 },
        { key: 'cash', value: null },
      ],
    });
    expect([...m.keys()]).toEqual(['revenue', 'cash']);
    expect(m.get('revenue')?.changePct).toBe(25);
  });
  it('tolerates a missing result', () => {
    expect(mapFigures(null).size).toBe(0);
    expect(mapFigures({ figures: null }).size).toBe(0);
  });
});

describe('panelIsEmpty', () => {
  it('is empty with no figures or only nulls and zeros', () => {
    expect(panelIsEmpty(null)).toBe(true);
    expect(panelIsEmpty({ figures: [] })).toBe(true);
    expect(panelIsEmpty({ figures: [{ key: 'revenue', value: 0 }, { key: 'orders', value: null }] })).toBe(true);
  });
  it('is not empty once any figure has a value', () => {
    expect(panelIsEmpty({ figures: [{ key: 'revenue', value: 0 }, { key: 'orders', value: 3 }] })).toBe(false);
  });
});

describe('figuresToCsvRows', () => {
  it('emits raw numbers in panel order: the label first, the server key last', () => {
    const m = mapFigures({
      figures: [
        { key: 'orders', value: 3, previous: 2, changeAbs: 1, changePct: 50 },
        { key: 'revenue', value: 100 },
      ],
    });
    expect(figuresToCsvRows(m, (k) => k.toUpperCase())).toEqual([
      ['REVENUE', 'headline', 'money', 100, null, null, null, 'revenue'],
      ['ORDERS', 'cafe', 'count', 3, 2, 1, 50, 'orders'],
    ]);
  });
  it('lets the screen word the group and the kind', () => {
    const m = mapFigures({ figures: [{ key: 'waste', value: 7 }] });
    expect(figuresToCsvRows(m, (k) => k, (g) => `G:${g}`, (k) => `K:${k}`)).toEqual([['waste', 'G:losses', 'K:money', 7, null, null, null, 'waste']]);
  });
});

// Open matches (operator.md §5.19): panel_headline's seven online keys (0265).
describe('the online group', () => {
  it('holds the seven keys in panel order, after the thirteen, each in the online group', () => {
    expect(ONLINE_FIGURE_KEYS).toEqual(['onlineDeposits', 'depositForfeits', 'ticketSales', 'ticketRefunds', 'ticketForfeits', 'ticketLiability', 'matchWrittenOff']);
    expect(figuresIn('online').map((f) => f.key)).toEqual([...ONLINE_FIGURE_KEYS]);
    expect(ALL_FIGURE_KEYS).toEqual([...FIGURE_KEYS, ...ONLINE_FIGURE_KEYS]);
    // The thirteen stay the thirteen: the export drills only those.
    expect(FIGURE_KEYS).toHaveLength(13);
  });
  it('inverts refunds and written-off shares only, and marks the chain-wide figures', () => {
    expect(ONLINE_FIGURE_KEYS.filter((k) => FIGURES[k].invert)).toEqual(['ticketRefunds', 'matchWrittenOff']);
    expect(ONLINE_FIGURE_KEYS.filter((k) => FIGURES[k].chainWide)).toEqual(['ticketSales', 'ticketRefunds', 'ticketLiability']);
  });
  it('opens the courts report for tickets and match shares, revenue for deposits', () => {
    expect(ONLINE_FIGURE_KEYS.map((k) => FIGURES[k].report)).toEqual([
      '/reports/revenue',
      '/reports/revenue',
      '/reports/courts',
      '/reports/courts',
      '/reports/courts',
      '/reports/courts',
      '/reports/courts',
    ]);
  });
  it('is mapped, exported and detected like any other figure', () => {
    const m = mapFigures({ figures: [{ key: 'ticketSales', value: 80000 }, { key: 'revenue', value: 100 }] });
    expect([...m.keys()]).toEqual(['ticketSales', 'revenue']);
    expect(hasOnlineFigures(m)).toBe(true);
    expect(hasOnlineFigures(mapFigures({ figures: [{ key: 'revenue', value: 100 }] }))).toBe(false);
    expect(figuresToCsvRows(m, (k) => k).map((r) => r[0])).toEqual(['revenue', 'ticketSales']);
  });
});
