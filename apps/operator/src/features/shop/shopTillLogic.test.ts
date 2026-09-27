import { describe, expect, it } from 'vitest';
import type { TillMenu } from '../till/tillData';
import {
  addToBasket,
  basketCount,
  basketEstimate,
  findSizeByCode,
  matchesSearch,
  saleItems,
  saleLabel,
  setLineQty,
  shopCatalogue,
} from './shopTillLogic';

const cat = (id: string, kind: 'cafe' | 'shop' | undefined, sort: number, is_active = true) => ({
  id, name_en: id, name_ar: id, sort_order: sort, is_active, tax_group: null, ...(kind ? { kind } : {}),
});
const v = (id: string, item_id: string, price: number, sort: number, extra: Record<string, unknown> = {}) => ({
  id, item_id, name_en: `${id} size`, name_ar: `${id} مقاس`, price_iqd: price, is_default: sort === 0, sort_order: sort, ...extra,
});
const item = (id: string, category_id: string, variants: ReturnType<typeof v>[], extra: Record<string, unknown> = {}) => ({
  id, category_id, name_en: id, name_ar: id, is_active: true, sold_out: false, unavailable_on: null, sort_order: 0,
  menu_item_variants: variants, menu_item_modifier_groups: [], ...extra,
});

const MENU = {
  categories: [cat('drinks', 'cafe', 0), cat('balls', 'shop', 2), cat('rackets', 'shop', 1), cat('old', 'shop', 3, false), cat('legacy', undefined, 4)],
  items: [
    item('latte', 'drinks', [v('latte-r', 'latte', 3000, 0)]),
    item('racket', 'rackets', [v('rk-pro', 'racket', 380000, 1, { sku: 'RKT-PRO', barcode: '6291001' }), v('rk-beg', 'racket', 120000, 0, { sku: 'RKT-BEG', barcode: '6291000' })]),
    item('tube', 'balls', [v('tube-3', 'tube', 15000, 0, { sku: 'BALL-3', barcode: '6292000' })]),
    item('hidden', 'balls', [v('h-1', 'hidden', 1, 0)], { is_active: false }),
    item('gone', 'old', [v('g-1', 'gone', 1, 0)]),
    item('cap', 'legacy', [v('cap-1', 'cap', 1, 0)]),
  ],
  availability: { tube: false },
} as unknown as Pick<TillMenu, 'categories' | 'items' | 'availability'>;

describe('shopCatalogue', () => {
  it('sells the active shop sections in their order, and nothing of the café', () => {
    const c = shopCatalogue(MENU);
    expect(c.sections.map((s) => s.id)).toEqual(['rackets', 'balls']);
    expect(c.sizes.map((s) => s.variantId)).toEqual(['rk-beg', 'rk-pro', 'tube-3']);
    expect(c.sizes.find((s) => s.variantId === 'latte-r')).toBeUndefined();
    expect(c.sizes.find((s) => s.variantId === 'cap-1')).toBeUndefined();
  });
  it('names the size only where a product has several, and greys what is off the shelf', () => {
    const c = shopCatalogue(MENU);
    expect(c.sizes.find((s) => s.variantId === 'rk-pro')!.hasSizes).toBe(true);
    expect(c.sizes.find((s) => s.variantId === 'tube-3')!.hasSizes).toBe(false);
    expect(c.sizes.find((s) => s.variantId === 'tube-3')!.orderable).toBe(false);
    expect(c.sizes.find((s) => s.variantId === 'rk-beg')!.orderable).toBe(true);
  });
  it('is empty with no menu', () => {
    expect(shopCatalogue(undefined)).toEqual({ sections: [], sizes: [] });
  });
});

describe('finding a size', () => {
  const { sizes } = shopCatalogue(MENU);
  it('knows a size by its barcode, then by its SKU in any case', () => {
    expect(findSizeByCode(sizes, '6291001')?.variantId).toBe('rk-pro');
    expect(findSizeByCode(sizes, ' ball-3 ')?.variantId).toBe('tube-3');
    expect(findSizeByCode(sizes, '999')).toBeNull();
    expect(findSizeByCode(sizes, '   ')).toBeNull();
  });
  it('searches the names, the size, the SKU and the barcode', () => {
    const tube = sizes.find((s) => s.variantId === 'tube-3')!;
    expect(matchesSearch(tube, 'TUBE')).toBe(true);
    expect(matchesSearch(tube, 'مقاس')).toBe(true);
    expect(matchesSearch(tube, 'ball-')).toBe(true);
    expect(matchesSearch(tube, '6292')).toBe(true);
    expect(matchesSearch(tube, 'racket')).toBe(false);
    expect(matchesSearch(tube, '')).toBe(true);
  });
});

describe('the basket', () => {
  const { sizes } = shopCatalogue(MENU);
  it('adds up by size, sets a quantity and removes at zero', () => {
    let b = addToBasket([], 'tube-3');
    b = addToBasket(b, 'rk-beg');
    b = addToBasket(b, 'tube-3', 2);
    expect(b).toEqual([{ variantId: 'tube-3', qty: 3 }, { variantId: 'rk-beg', qty: 1 }]);
    expect(basketCount(b)).toBe(4);
    expect(basketEstimate(b, sizes)).toBe(3 * 15000 + 120000);
    b = setLineQty(b, 'tube-3', 1);
    expect(basketEstimate(b, sizes)).toBe(15000 + 120000);
    b = setLineQty(b, 'rk-beg', 0);
    expect(b).toEqual([{ variantId: 'tube-3', qty: 1 }]);
  });
  it('sends plain shop lines, with no modifiers', () => {
    expect(saleItems([{ variantId: 'tube-3', qty: 2 }, { variantId: 'x', qty: 0 }])).toEqual([
      { variantId: 'tube-3', qty: 2, modifiers: [] },
    ]);
  });
  it('labels a sale with the time it was rung up', () => {
    expect(saleLabel(new Date(2026, 8, 27, 9, 5, 7))).toBe('09:05:07');
  });
});
