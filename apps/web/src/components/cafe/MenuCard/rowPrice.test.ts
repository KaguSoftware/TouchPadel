import { describe, expect, it } from 'vitest';
import type { MenuItem, MenuVariant } from '@/lib/menu';
import { rowPrice, rowVariant } from './rowPrice';

/**
 * A row prints one number. The menu sells one size, so in practice that is the
 * item's only variant — the rest of these cases guard the row against an
 * operator-added second variant reopening the old price grid.
 */

const variant = (name_en: string, price: number, sort: number, is_default = sort === 1): MenuVariant => ({
  id: `${name_en}-${price}`,
  name_en,
  name_ar: name_en,
  price_iqd: price,
  is_default,
  sort_order: sort,
});

const item = (variants: MenuVariant[]): MenuItem => ({
  id: 'i',
  category_id: 'c',
  name_en: 'i',
  name_ar: 'i',
  hook_en: '',
  hook_ar: '',
  description_en: null,
  description_ar: null,
  highlight: 'none',
  sold_out: false,
  serve_temp: 'none',
  photo_path: null,
  photo_url: null,
  photo_blur: null,
  sort_order: 1,
  orderable: true,
  discountPct: 0,
  variants,
  allergens: [],
  modifierGroups: [],
  suggestedItemIds: [],
});

describe('rowPrice', () => {
  it('prices the row at the item’s only variant', () => {
    expect(rowPrice(item([variant('Regular', 3000, 1)]))).toBe(3000);
  });

  it('prices the row at the default variant, not the first listed', () => {
    const v = [variant('Small', 3000, 1, false), variant('Regular', 4000, 2, true)];
    expect(rowPrice(item(v))).toBe(4000);
  });

  it('falls back to the cheapest variant when none is flagged default', () => {
    const v = [variant('B', 5000, 1, false), variant('A', 3500, 2, false)];
    expect(rowPrice(item(v))).toBe(3500);
  });

  it('prints nothing for an item with no variant', () => {
    expect(rowVariant(item([]))).toBeNull();
    expect(rowPrice(item([]))).toBeNull();
  });
});
