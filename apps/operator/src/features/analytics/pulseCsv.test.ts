import { describe, expect, it } from 'vitest';
import { pulseCsvRows } from './pulseCsv';

describe('pulseCsvRows', () => {
  it('writes value, previous and the change the way the panel CSV does', () => {
    expect(pulseCsvRows([{ label: 'Orders', value: 120, previous: 100 }])).toEqual([['Orders', 120, 100, 20, 20]]);
    expect(pulseCsvRows([{ label: 'Refunds', value: 1000, previous: 3000 }])).toEqual([['Refunds', 1000, 3000, -2000, -66.7]]);
  });

  it('leaves the change empty without a baseline, and the percentage empty over a zero baseline', () => {
    expect(pulseCsvRows([{ label: 'Waste', value: 500, previous: null }])).toEqual([['Waste', 500, null, null, null]]);
    expect(pulseCsvRows([{ label: 'Waste', value: 500, previous: 0 }])).toEqual([['Waste', 500, 0, 500, null]]);
    expect(pulseCsvRows([{ label: 'Views', value: null, previous: 10 }])).toEqual([['Views', null, 10, null, null]]);
  });
});
