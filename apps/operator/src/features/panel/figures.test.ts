import { describe, expect, it } from 'vitest';
import { FIGURE_KEYS, FIGURES, figuresIn, figuresToCsvRows, mapFigures, panelIsEmpty } from './figures';

describe('figure metadata', () => {
  it('covers the twelve panel figures, each in exactly one group', () => {
    expect(FIGURE_KEYS).toHaveLength(12);
    const all = [...figuresIn('headline'), ...figuresIn('padel'), ...figuresIn('cafe')].map((f) => f.key);
    expect([...all].sort()).toEqual([...FIGURE_KEYS].sort());
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
  it('emits raw numbers in panel order with the localised label first', () => {
    const m = mapFigures({
      figures: [
        { key: 'orders', value: 3, previous: 2, changeAbs: 1, changePct: 50 },
        { key: 'revenue', value: 100 },
      ],
    });
    expect(figuresToCsvRows(m, (k) => k.toUpperCase())).toEqual([
      ['REVENUE', 100, null, null, null],
      ['ORDERS', 3, 2, 1, 50],
    ]);
  });
});
