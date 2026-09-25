import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import {
  STOCK_ROLES,
  filterStock,
  stockFilters,
  stockKindArg,
  stockKindsFor,
  stockState,
  type StockItem,
} from '../logic';

const row = (over: Partial<StockItem> = {}): StockItem => ({
  ingredient_id: 'i1',
  kind: 'purchased',
  name_en: 'Milk',
  name_ar: 'حليب',
  unit: 'ml',
  pack_size: 1000,
  on_hand: 5000,
  par_level: 4000,
  low_stock_threshold: 1000,
  low: false,
  below_par: false,
  next_expiry: null,
  product: null,
  ...over,
});

describe('who sees which stock (#68, the server’s kinds)', () => {
  it('gives the heads the cafe, the desk the shop and management all of it', () => {
    expect(stockKindsFor('head_barista')).toEqual(['purchased', 'prepared']);
    expect(stockKindsFor('head_chef')).toEqual(['purchased', 'prepared']);
    expect(stockKindsFor('court_desk')).toEqual(['retail']);
    expect(stockKindsFor('manager')).toEqual(['purchased', 'prepared', 'retail']);
    expect(stockKindsFor('owner')).toEqual(['purchased', 'prepared', 'retail']);
  });

  it('gives every other role nothing, and keeps them off the page', () => {
    for (const role of STAFF_ROLES) {
      expect(stockKindsFor(role).length > 0, role).toBe(STOCK_ROLES.includes(role));
    }
  });

  it('offers filters only when there is more than one kind to choose', () => {
    expect(stockFilters('court_desk')).toEqual([]);
    expect(stockFilters('head_chef')).toEqual(['all', 'purchased', 'prepared']);
    expect(stockFilters('owner')).toEqual(['all', 'purchased', 'prepared', 'retail']);
    expect(stockKindArg('all')).toBeNull();
    expect(stockKindArg('retail')).toBe('retail');
  });
});

describe('a row’s one word', () => {
  it('says out, low, below par, or nothing, in that order', () => {
    expect(stockState(row({ on_hand: 0, low: true, below_par: true }))).toBe('out');
    expect(stockState(row({ low: true, below_par: true }))).toBe('low');
    expect(stockState(row({ below_par: true }))).toBe('belowPar');
    expect(stockState(row())).toBe('ok');
  });
});

describe('search', () => {
  it('matches either name and the shop product a row backs', () => {
    const items = [
      row(),
      row({
        ingredient_id: 'i2',
        kind: 'retail',
        name_en: 'Grip tape stock',
        name_ar: 'شريط',
        product: { menu_item_id: 'm', name_en: 'Overgrip', name_ar: 'غريب', size_name_en: null, size_name_ar: null },
      }),
    ];
    expect(filterStock(items, 'حليب').map((i) => i.ingredient_id)).toEqual(['i1']);
    expect(filterStock(items, 'overgrip').map((i) => i.ingredient_id)).toEqual(['i2']);
    expect(filterStock(items, '  ').length).toBe(2);
  });

  it('never carries a money key: the row type has none to show', () => {
    const keys = Object.keys(row()).concat(Object.keys(row().product ?? {}));
    expect(keys.filter((k) => k.endsWith('_iqd') || k.startsWith('cost') || k.startsWith('supplier'))).toEqual([]);
  });
});
