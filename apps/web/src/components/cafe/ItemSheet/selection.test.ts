import { describe, expect, it } from 'vitest';
import type { MenuItem, MenuModifier, MenuModifierGroup } from '@/lib/menu';
import {
  chosenModifiers,
  clearSubtree,
  groupCount,
  groupSatisfied,
  pricePreview,
  toggleModifier,
} from './selection';

function mod(id: string, delta = 0, reveals: MenuModifierGroup[] = []): MenuModifier {
  return { id, name_en: id, name_ar: id, price_delta_iqd: delta, sort_order: 0, reveals };
}

function group(
  id: string,
  min: number,
  max: number,
  modifiers: MenuModifier[],
): MenuModifierGroup {
  return {
    id,
    name_en: id,
    name_ar: id,
    min_select: min,
    max_select: max,
    sort_order: 0,
    modifiers,
  };
}

/** Milk (radio, required) — "oat" reveals an Oat-style radio group. Extras: up to 2. */
const oatStyle = group('oat-style', 1, 1, [mod('creamy'), mod('barista')]);
const milk = group('milk', 1, 1, [mod('whole'), mod('oat', 250, [oatStyle])]);
const extras = group('extras', 0, 2, [mod('shot', 500), mod('syrup', 250), mod('cream', 100)]);

const item: MenuItem = {
  id: 'item-1',
  category_id: 'cat-1',
  name_en: 'Latte',
  name_ar: 'لاتيه',
  hook_en: 'smooth · milky',
  hook_ar: '',
  description_en: null,
  description_ar: null,
  highlight: 'none',
  sold_out: false,
  photo_path: null,
  photo_url: null,
  photo_blur: null,
  sort_order: 0,
  orderable: true,
  discountPct: 0,
  variants: [
    { id: 'v-s', name_en: 'S', name_ar: 'S', price_iqd: 1250, is_default: true, sort_order: 0 },
    { id: 'v-l', name_en: 'L', name_ar: 'L', price_iqd: 1750, is_default: false, sort_order: 1 },
  ],
  allergens: [],
  modifierGroups: [milk, extras],
  suggestedItemIds: [],
};

describe('modifier selection reducer', () => {
  it('radio groups replace the sibling choice', () => {
    const a = toggleModifier(item, milk, 'whole', []);
    expect(a).toEqual(['whole']);
    const b = toggleModifier(item, milk, 'oat', a);
    expect(b).toEqual(['oat']);
  });

  it('a second tap on a radio choice deselects it', () => {
    expect(toggleModifier(item, milk, 'oat', ['oat'])).toEqual([]);
  });

  it('checkbox groups stop at max_select', () => {
    const two = toggleModifier(item, extras, 'syrup', toggleModifier(item, extras, 'shot', []));
    expect(two).toEqual(['shot', 'syrup']);
    // cap is 2 — the third pick is ignored, nothing is evicted
    expect(toggleModifier(item, extras, 'cream', two)).toEqual(['shot', 'syrup']);
    // …but deselecting one frees a slot again
    const freed = toggleModifier(item, extras, 'syrup', two);
    expect(toggleModifier(item, extras, 'cream', freed)).toEqual(['shot', 'cream']);
  });

  it('deselecting a parent clears the picks its reveals exposed', () => {
    const withOat = toggleModifier(item, milk, 'oat', []);
    const withStyle = toggleModifier(item, oatStyle, 'barista', withOat);
    expect(withStyle).toEqual(['oat', 'barista']);
    expect(toggleModifier(item, milk, 'oat', withStyle)).toEqual([]);
  });

  it('switching the parent radio also clears the revealed picks', () => {
    const withStyle = toggleModifier(item, oatStyle, 'creamy', toggleModifier(item, milk, 'oat', []));
    expect(toggleModifier(item, milk, 'whole', withStyle)).toEqual(['whole']);
  });

  it('clearSubtree leaves unrelated picks alone', () => {
    expect(clearSubtree(item, ['shot', 'oat', 'creamy'], 'oat')).toEqual(['shot']);
  });

  it('counts and satisfaction follow min/max', () => {
    expect(groupCount(extras, ['shot', 'syrup', 'oat'])).toBe(2);
    expect(groupSatisfied(milk, [])).toBe(false);
    expect(groupSatisfied(milk, ['whole'])).toBe(true);
    expect(groupSatisfied(extras, [])).toBe(true);
  });

  it('chosenModifiers keeps pick order with qty 1', () => {
    expect(chosenModifiers(['oat', 'shot'])).toEqual([
      { modifierId: 'oat', qty: 1 },
      { modifierId: 'shot', qty: 1 },
    ]);
  });
});

describe('price preview', () => {
  it('sums the variant base and active modifier deltas', () => {
    expect(pricePreview(item, 'v-s', ['oat', 'shot'], 2)).toEqual({
      list: (1250 + 250 + 500) * 2,
      total: (1250 + 250 + 500) * 2,
      discountPct: 0,
    });
  });

  it('discounts the base only — modifiers are never discounted', () => {
    const featured: MenuItem = { ...item, discountPct: 15 };
    // applyPctDiscountIqd(1250, 15) = 1063 (parity table in basket.test.ts)
    expect(pricePreview(featured, 'v-s', ['shot'], 2)).toEqual({
      list: (1250 + 500) * 2,
      total: (1063 + 500) * 2,
      discountPct: 15,
    });
  });

  it('ignores picks whose group is no longer revealed', () => {
    // 'barista' belongs to the group revealed by 'oat'; without 'oat' it is inert
    expect(pricePreview(item, 'v-l', ['barista'], 1).total).toBe(1750);
  });

  it('returns zero for an unknown variant', () => {
    expect(pricePreview(item, 'nope', [], 1)).toEqual({ list: 0, total: 0, discountPct: 0 });
  });
});
