import { describe, expect, it } from 'vitest';
import {
  basketCount,
  basketTotal,
  buildLine,
  lineTotal,
  toOrderPayload,
  violatedGroup,
} from './basket';
import type { MenuItem } from '../menu';

/** Cappuccino-like fixture: two sizes, milk group (0..1), extra-shot group (0..2). */
const item: MenuItem = {
  id: 'item-1',
  category_id: 'cat-1',
  name_en: 'Cappuccino',
  name_ar: 'كابتشينو',
  description_en: null,
  description_ar: null,
  photo_path: null,
  sort_order: 1,
  orderable: true,
  suggestedItemIds: [],
  variants: [
    { id: 'v-s', name_en: 'Small', name_ar: 'صغير', price_iqd: 4000, is_default: true, sort_order: 1 },
    { id: 'v-l', name_en: 'Large', name_ar: 'كبير', price_iqd: 5500, is_default: false, sort_order: 2 },
  ],
  allergens: [],
  modifierGroups: [
    {
      id: 'g-milk',
      name_en: 'Milk Type',
      name_ar: 'نوع الحليب',
      min_select: 0,
      max_select: 1,
      sort_order: 1,
      modifiers: [
        { id: 'm-whole', name_en: 'Whole', name_ar: 'كامل', price_delta_iqd: 0, sort_order: 1 },
        { id: 'm-oat', name_en: 'Oat', name_ar: 'شوفان', price_delta_iqd: 1000, sort_order: 2 },
      ],
    },
    {
      id: 'g-shot',
      name_en: 'Extra Shot',
      name_ar: 'جرعة إضافية',
      min_select: 0,
      max_select: 2,
      sort_order: 2,
      modifiers: [
        { id: 'm-shot', name_en: 'Extra Shot', name_ar: 'جرعة', price_delta_iqd: 1000, sort_order: 1 },
      ],
    },
  ],
};

describe('buildLine / lineTotal', () => {
  it('prices (unit + Σ modifier deltas × mqty) × qty, mirroring app.add_order_items', () => {
    // Large 5500 + oat 1000 + double shot (1000 × 2) = 8500; × qty 2 = 17000
    const line = buildLine(
      item,
      'v-l',
      2,
      [
        { modifierId: 'm-oat', qty: 1 },
        { modifierId: 'm-shot', qty: 2 },
      ],
      '  extra hot  ',
    );
    expect(lineTotal(line)).toBe(17_000);
    expect(line.notes).toBe('extra hot');
    expect(line.unit_price_iqd).toBe(5500);
  });

  it('a plain default-size line is unit × qty', () => {
    const line = buildLine(item, 'v-s', 3, [], null);
    expect(lineTotal(line)).toBe(12_000);
  });

  it('rejects unknown variants/modifiers and bad quantities', () => {
    expect(() => buildLine(item, 'v-x', 1, [], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 0, [], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 100, [], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 1, [{ modifierId: 'nope', qty: 1 }], null)).toThrow();
    expect(() => buildLine(item, 'v-s', 1, [{ modifierId: 'm-shot', qty: 10 }], null)).toThrow();
  });
});

describe('basketTotal / basketCount', () => {
  it('sums line totals with integer IQD arithmetic', () => {
    const a = buildLine(item, 'v-s', 1, [], null); // 4000
    const b = buildLine(item, 'v-l', 2, [{ modifierId: 'm-oat', qty: 1 }], null); // (5500+1000)*2
    expect(basketTotal([a, b])).toBe(4000 + 13_000);
    expect(basketCount([a, b])).toBe(3);
  });

  it('empty basket totals zero', () => {
    expect(basketTotal([])).toBe(0);
    expect(basketCount([])).toBe(0);
  });
});

describe('violatedGroup', () => {
  it('accepts selections inside every group min/max', () => {
    expect(violatedGroup(item.modifierGroups, [{ modifierId: 'm-oat' }])).toBeNull();
    expect(violatedGroup(item.modifierGroups, [])).toBeNull();
  });

  it('flags a group over max (distinct choices count)', () => {
    const over = violatedGroup(item.modifierGroups, [
      { modifierId: 'm-whole' },
      { modifierId: 'm-oat' },
    ]);
    expect(over?.id).toBe('g-milk');
  });

  it('flags a group under min', () => {
    const milk = item.modifierGroups[0]!;
    const groups = [{ ...milk, min_select: 1 }];
    expect(violatedGroup(groups, [])?.id).toBe('g-milk');
    expect(violatedGroup(groups, [{ modifierId: 'm-whole' }])).toBeNull();
  });
});

describe('toOrderPayload', () => {
  it('carries ids and quantities only — never prices', () => {
    const line = buildLine(item, 'v-l', 1, [{ modifierId: 'm-shot', qty: 2 }], 'no sugar');
    const payload = (toOrderPayload([line]) as Record<string, unknown>[])[0]!;
    expect(payload).toEqual({
      variant_id: 'v-l',
      qty: 1,
      notes: 'no sugar',
      modifiers: [{ modifier_id: 'm-shot', qty: 2 }],
    });
    expect(JSON.stringify(payload)).not.toContain('price');
    expect(JSON.stringify(payload)).not.toContain('5500');
  });

  it('omits empty notes', () => {
    const line = buildLine(item, 'v-s', 1, [], '   ');
    const payload = (toOrderPayload([line]) as Record<string, unknown>[])[0]!;
    expect('notes' in payload).toBe(false);
  });
});
