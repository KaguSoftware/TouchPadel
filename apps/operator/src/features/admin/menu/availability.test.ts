import { describe, it, expect } from 'vitest';
import { stockBlockFor, todayIso, type StockBlockData } from './availability';

// `blockedByStock` is a READ-ONLY state the server decides. The helper must
// (1) never call an item blocked when one of its own flags explains the
// greying, and (2) name the out-of-stock ingredient from the item's recipe.

const data: StockBlockData = {
  availability: [
    { item_id: 'latte', orderable: false },
    { item_id: 'tea', orderable: true },
    { item_id: 'cake', orderable: false },
  ],
  recipeLines: [
    { variant_id: 'latte-r', ingredient_id: 'milk' },
    { variant_id: 'latte-r', ingredient_id: 'beans' },
    { variant_id: 'cake-s', ingredient_id: 'flour' },
  ],
  onHand: [
    { ingredient_id: 'milk', name_en: 'Milk', name_ar: 'حليب', on_hand: 0 },
    { ingredient_id: 'beans', name_en: 'Beans', name_ar: 'بن', on_hand: 400 },
    { ingredient_id: 'flour', name_en: 'Flour', name_ar: 'طحين', on_hand: 200 },
  ],
};

const latte = { id: 'latte', is_active: true, sold_out: false, unavailable_on: null, menu_item_variants: [{ id: 'latte-r' }] };

describe('stockBlockFor', () => {
  it('names the ingredient that is out when the server greyed the item', () => {
    const b = stockBlockFor(latte, data, '2026-09-03');
    expect(b.blocked).toBe(true);
    expect(b.ingredients.map((i) => i.name_en)).toEqual(['Milk']);
  });

  it('is not a stock block when the item is orderable', () => {
    expect(stockBlockFor({ ...latte, id: 'tea', menu_item_variants: [] }, data, '2026-09-03').blocked).toBe(false);
  });

  it('is not a stock block when sold out, off today or inactive explain the greying', () => {
    expect(stockBlockFor({ ...latte, sold_out: true }, data, '2026-09-03').blocked).toBe(false);
    expect(stockBlockFor({ ...latte, unavailable_on: '2026-09-03' }, data, '2026-09-03').blocked).toBe(false);
    expect(stockBlockFor({ ...latte, is_active: false }, data, '2026-09-03').blocked).toBe(false);
    // Off on another day does not explain today's greying.
    expect(stockBlockFor({ ...latte, unavailable_on: '2026-09-01' }, data, '2026-09-03').blocked).toBe(true);
  });

  it('reports blocked with no names when the cause is outside the direct recipe (prepared expansion)', () => {
    const b = stockBlockFor({ ...latte, id: 'cake', menu_item_variants: [{ id: 'cake-s' }] }, data, '2026-09-03');
    expect(b.blocked).toBe(true);
    expect(b.ingredients).toEqual([]);
  });

  it('is never blocked before the availability data has loaded', () => {
    expect(stockBlockFor(latte, undefined, '2026-09-03').blocked).toBe(false);
  });
});

describe('todayIso', () => {
  it('formats the station calendar date', () => {
    expect(todayIso(new Date(2026, 8, 3, 23, 59))).toBe('2026-09-03');
  });
});
