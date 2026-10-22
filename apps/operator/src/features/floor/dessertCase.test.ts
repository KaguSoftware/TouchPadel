import { describe, expect, it } from 'vitest';
import { dessertShape, isDessertCategory, listDesserts, withAvailability, type RawDessertCategory, type RawDessertItem } from './dessertCase';

const cat = (p: Partial<RawDessertCategory>): RawDessertCategory => ({ id: 'c', name_en: 'Desserts', name_ar: 'الحلويات', kind: 'cafe', is_active: true, ...p });
const item = (p: Partial<RawDessertItem>): RawDessertItem => ({ id: 'i', category_id: 'c', name_en: 'Donut', name_ar: 'دونات', sort_order: 1, ...p });

describe('isDessertCategory', () => {
  it('takes the cafe dessert section by its English or Arabic name', () => {
    expect(isDessertCategory(cat({}))).toBe(true);
    expect(isDessertCategory(cat({ name_en: 'Sweet things' }))).toBe(true);
    expect(isDessertCategory(cat({ name_en: 'Section 5', name_ar: 'الحلويات' }))).toBe(true);
  });
  it('leaves out inactive sections, the shop and every other section', () => {
    expect(isDessertCategory(cat({ is_active: false }))).toBe(false);
    expect(isDessertCategory(cat({ kind: 'shop' }))).toBe(false);
    expect(isDessertCategory(cat({ name_en: 'Coffee', name_ar: 'قهوة' }))).toBe(false);
  });
});

describe('dessertShape', () => {
  it("draws the venue's eight desserts each as what it is", () => {
    const menu = ['Donut', 'Cookies', 'Cheesecake', 'Mosaic Cake', 'San Sebastian', 'Brownies', 'Tiramisu', 'Carrot Cake'];
    expect(menu.map(dessertShape)).toEqual(['donut', 'cookie', 'cheesecake', 'mosaic', 'basque', 'cup', 'tiramisu', 'carrot']);
  });
  it('reads the longer word first', () => {
    expect(dessertShape('San Sebastian Cheesecake')).toBe('basque');
    expect(dessertShape('Chocolate Cupcake')).toBe('cake');
  });
  it('knows the fixture menu, and falls back to a round cake', () => {
    expect(dessertShape('Kunafa')).toBe('tray');
    expect(dessertShape('Fruit Salad')).toBe('bowl');
    expect(dessertShape('Chocolate Brownie')).toBe('cup');
    expect(dessertShape('Something new')).toBe('cake');
  });
});

describe('listDesserts + withAvailability', () => {
  const cats = [cat({ id: 'd' }), cat({ id: 'k', name_en: 'Coffee', name_ar: 'قهوة' })];
  const items = [
    item({ id: 'b', category_id: 'd', name_en: 'Brownies', sort_order: 2 }),
    item({ id: 'a', category_id: 'd', name_en: 'Donut', sort_order: 1 }),
    item({ id: 'x', category_id: 'k', name_en: 'Latte', sort_order: 1 }),
  ];

  it('keeps only the dessert section, in menu order', () => {
    expect(listDesserts(cats, items).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('is one yes/no per dessert, and no row means not on show', () => {
    const list = listDesserts(cats, items);
    const shown = withAvailability(list, [
      { item_id: 'a', orderable: true },
      { item_id: 'x', orderable: true },
    ]);
    expect(shown.map((d) => [d.id, d.available])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(withAvailability(list, [{ item_id: 'b', orderable: null }])[1]!.available).toBe(false);
  });
});
