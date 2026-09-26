import { describe, expect, it } from 'vitest';
import { findByBarcode, orderSections, shopVariantIds, splitBasket } from './basketSplit';

const menu = {
  categories: [
    { id: 'c-coffee', kind: 'cafe' as const },
    { id: 'c-rackets', kind: 'shop' as const },
    { id: 'c-old' }, // a cached menu from before 0144 carries no kind
  ],
  items: [
    { category_id: 'c-coffee', is_active: true, menu_item_variants: [{ id: 'v-latte', barcode: null }] },
    {
      category_id: 'c-rackets',
      is_active: true,
      menu_item_variants: [
        { id: 'v-rkt-m', barcode: '6291041500213' },
        { id: 'v-rkt-l', barcode: '6291041500220' },
      ],
    },
    { category_id: 'c-old', is_active: true, menu_item_variants: [{ id: 'v-tea' }] },
  ],
};

describe('shopVariantIds', () => {
  it('collects the variants of shop sections only', () => {
    expect([...shopVariantIds(menu)].sort()).toEqual(['v-rkt-l', 'v-rkt-m']);
    expect(shopVariantIds(undefined).size).toBe(0);
  });
});

describe('splitBasket', () => {
  it('splits café lines from shop lines, keeping basket order', () => {
    const lines = [{ variantId: 'v-rkt-m' }, { variantId: 'v-latte' }, { variantId: 'v-tea' }, { variantId: 'v-rkt-l' }];
    const { cafe, shop } = splitBasket(lines, shopVariantIds(menu));
    expect(cafe.map((l) => l.variantId)).toEqual(['v-latte', 'v-tea']);
    expect(shop.map((l) => l.variantId)).toEqual(['v-rkt-m', 'v-rkt-l']);
  });

  it('leaves a café-only basket whole', () => {
    const { cafe, shop } = splitBasket([{ variantId: 'v-latte' }], shopVariantIds(menu));
    expect(cafe).toHaveLength(1);
    expect(shop).toHaveLength(0);
  });
});

describe('orderSections', () => {
  it('puts shop sections after café ones, keeping each group in order', () => {
    expect(orderSections(menu.categories).map((c) => c.id)).toEqual(['c-coffee', 'c-old', 'c-rackets']);
  });
});

describe('findByBarcode', () => {
  it('finds the variant and its item by exact barcode', () => {
    const hit = findByBarcode(menu.items, ' 6291041500220 ');
    expect(hit?.variant.id).toBe('v-rkt-l');
    expect(hit?.item.category_id).toBe('c-rackets');
  });

  it('skips inactive items and unknown codes', () => {
    const items = [{ ...menu.items[1]!, is_active: false }];
    expect(findByBarcode(items, '6291041500213')).toBeNull();
    expect(findByBarcode(menu.items, '000')).toBeNull();
    expect(findByBarcode(menu.items, '')).toBeNull();
  });
});
