import { describe, expect, it } from 'vitest';
import type { MenuCategory, MenuItem, MenuVariant } from '@/lib/menu';
import { priceLayout, sizeColumns, sizeHeaders } from './sizeColumns';

/**
 * The design prices a section in columns, so this mapping decides which number
 * lands under which size header. Getting it wrong misprices the menu, so the
 * cases below are the real sections from the approved design.
 */

const variant = (name_en: string, price: number, sort: number): MenuVariant => ({
  id: `${name_en}-${price}`,
  name_en,
  name_ar: name_en,
  price_iqd: price,
  is_default: sort === 1,
  sort_order: sort,
});

const item = (name: string, variants: MenuVariant[]): MenuItem => ({
  id: name,
  category_id: 'c',
  name_en: name,
  name_ar: name,
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

const category = (items: MenuItem[]): MenuCategory => ({
  id: 'c',
  name_en: 'c',
  name_ar: 'c',
  sort_order: 1,
  serve_temp: 'none',
  photo_path: null,
  photo_url: null,
  photo_blur: null,
  items,
});

const MED = (p: number) => variant('Medium', p, 1);
const LRG = (p: number) => variant('Large', p, 2);
const REG = (p: number) => variant('Regular', p, 1);
const SINGLE = variant('Single', 2000, 1);
const DOUBLE = variant('Double', 3000, 2);

describe('sizeColumns', () => {
  it('Coffee prints MEDIUM then LARGE, cheapest column first', () => {
    const coffee = category([
      item('Espresso', [SINGLE, DOUBLE]),
      item('Americano', [MED(3000)]),
      item('Latte', [MED(3000), LRG(4000)]),
      item('Mocha', [MED(4000), LRG(5000)]),
      item('Cortado', [MED(3000)]),
    ]);
    expect(sizeColumns(coffee)).toEqual(['Medium', 'Large']);
    expect(sizeHeaders(coffee, 'ar')).toEqual(['MEDIUM', 'LARGE']);
  });

  it('keeps a size the only multi-size row offers', () => {
    // Specialty Coffee: V60 is Medium+Large, Cold Brew is Medium-only. LARGE is
    // a real column even though exactly one item is sold in it.
    const specialty = category([
      item('V60', [MED(5000), LRG(7000)]),
      item('Cold Brew', [MED(5000)]),
    ]);
    expect(sizeColumns(specialty)).toEqual(['Medium', 'Large']);
  });

  it('keeps an odd size pair out of the grid the rest of the section agrees on', () => {
    // Espresso's Single/Double must not become two extra columns in Coffee.
    const coffee = category([
      item('Espresso', [SINGLE, DOUBLE]),
      item('Latte', [MED(3000), LRG(4000)]),
      item('Mocha', [MED(4000), LRG(5000)]),
    ]);
    expect(sizeColumns(coffee)).toEqual(['Medium', 'Large']);
  });

  it('an unnamed single size is not a column at all', () => {
    // Tea / Desserts: one price, no header row in the design.
    const tea = category([item('Iraqi Tea', [REG(1000)]), item('Karak', [REG(2000)])]);
    expect(sizeColumns(tea)).toEqual([]);
  });

  it('a named single size still gets its header', () => {
    // Signature is priced LARGE only, and the design prints that header.
    const signature = category([
      item('Court Energy', [LRG(5000)]),
      item('Taj Special', [LRG(5000)]),
    ]);
    expect(sizeColumns(signature)).toEqual(['Large']);
  });
});

describe('priceLayout', () => {
  const columns = ['MEDIUM', 'LARGE'];

  it('puts each price under its own header', () => {
    expect(priceLayout(item('Latte', [MED(3000), LRG(4000)]), columns)).toEqual({
      kind: 'columns',
      cells: [3000, 4000],
    });
  });

  it('leaves a hole where an item does not offer the size', () => {
    // Americano is medium-only: the LARGE cell must be blank, not shifted.
    expect(priceLayout(item('Americano', [MED(3000)]), columns)).toEqual({
      kind: 'columns',
      cells: [3000, null],
    });
  });

  it('never lets a cheaper size land under LARGE', () => {
    // Variants arriving in any order must still map by name, not by position.
    expect(priceLayout(item('Mocha', [LRG(5000), MED(4000)]), columns)).toEqual({
      kind: 'columns',
      cells: [4000, 5000],
    });
  });

  it('prints off-grid sizes inline instead of guessing a column', () => {
    expect(priceLayout(item('Espresso', [SINGLE, DOUBLE]), columns)).toEqual({
      kind: 'inline',
      parts: [
        { label: 'Single', price: 2000 },
        { label: 'Double', price: 3000 },
      ],
    });
  });

  it('prices a headerless section from its single size', () => {
    expect(priceLayout(item('Cheesecake', [REG(4000)]), [])).toEqual({
      kind: 'single',
      price: 4000,
    });
  });

  it('has nothing to lay out when an item has no variants', () => {
    expect(priceLayout(item('Ghost', []), columns)).toBeNull();
  });
});
