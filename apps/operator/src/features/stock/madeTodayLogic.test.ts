import { describe, expect, it } from 'vitest';
import { readMade } from './madeTodayLogic';

// "Made today" on Waste and production (WasteAndProduction.tsx).

describe('readMade', () => {
  it('reads the batches, the bigint movement id arriving as a number', () => {
    const rows = readMade({
      rows: [{ movement_id: 186, ingredient_id: 'g', name_en: 'Garlic Sauce', name_ar: 'صوص الثوم', qty: 500, unit: 'ml', staff_name: 'Dev Chef', at: '2026-09-25T03:45:15Z' }],
    });
    expect(rows).toEqual([{ movement_id: 186, name_en: 'Garlic Sauce', name_ar: 'صوص الثوم', qty: 500, unit: 'ml', staff_name: 'Dev Chef', at: '2026-09-25T03:45:15Z' }]);
  });

  it('keeps a string id, and reads a bad field as its safe default', () => {
    const [row] = readMade({ rows: [{ movement_id: '9007199254740993', name_en: 7, qty: 'x', staff_name: 3, at: 'yesterday-ish' }] });
    expect(row).toEqual({ movement_id: '9007199254740993', name_en: '', name_ar: '', qty: 0, unit: '', staff_name: null, at: '' });
  });

  it('reads anything that is not the RPC payload as nothing, and drops a row without an id', () => {
    for (const bad of [null, undefined, 'x', [], { rows: 'no' }]) expect(readMade(bad)).toEqual([]);
    expect(readMade({ rows: [null, 5, [], { name_en: 'no id' }, { movement_id: null }] })).toEqual([]);
  });
});
