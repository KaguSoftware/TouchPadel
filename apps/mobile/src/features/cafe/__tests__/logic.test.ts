import { describe, expect, it } from 'vitest';
import {
  assembleMenu,
  menuPhotoUrl,
  menuRowCount,
  MENU_MORE_ROWS,
  pickText,
  rowsToShow,
  shownSections,
  type ItemRow,
  type MenuViewSection,
} from '../logic';

const item = (over: Partial<ItemRow> & Pick<ItemRow, 'id' | 'category_id'>): ItemRow => ({
  name_en: over.id,
  name_ar: `${over.id}-ar`,
  hook_en: null,
  hook_ar: null,
  sold_out: false,
  serve_temp: null,
  photo_path: null,
  sort_order: 0,
  menu_item_variants: [
    { id: `${over.id}-v`, name_en: 'Regular', name_ar: 'عادي', price_iqd: 3000, is_default: true, sort_order: 0 },
  ],
  ...over,
});

describe('assembleMenu', () => {
  const categories = [
    { id: 'drinks', name_en: 'Drinks', name_ar: 'مشروبات', sort_order: 2 },
    { id: 'coffee', name_en: 'Coffee', name_ar: 'قهوة', sort_order: 1 },
    { id: 'empty', name_en: 'Empty', name_ar: 'فارغ', sort_order: 3 },
  ];

  it('orders sections and items by menu order and drops empty sections', () => {
    const menu = assembleMenu(categories, [
      item({ id: 'latte', category_id: 'coffee', sort_order: 2 }),
      item({ id: 'espresso', category_id: 'coffee', sort_order: 1 }),
      item({ id: 'water', category_id: 'drinks' }),
    ]);
    expect(menu.map((s) => s.id)).toEqual(['coffee', 'drinks']);
    expect(menu[0]!.items.map((i) => i.id)).toEqual(['espresso', 'latte']);
  });

  it('keeps sizes in menu order and drops an item with no size to price', () => {
    const menu = assembleMenu(categories, [
      item({
        id: 'latte',
        category_id: 'coffee',
        menu_item_variants: [
          { id: 'l', name_en: 'Large', name_ar: 'كبير', price_iqd: 5000, is_default: false, sort_order: 2 },
          { id: 's', name_en: 'Small', name_ar: 'صغير', price_iqd: 4000, is_default: true, sort_order: 1 },
        ],
      }),
      item({ id: 'ghost', category_id: 'coffee', menu_item_variants: [] }),
    ]);
    expect(menu[0]!.items.map((i) => i.id)).toEqual(['latte']);
    expect(menu[0]!.items[0]!.sizes.map((s) => s.price_iqd)).toEqual([4000, 5000]);
  });

  it('greys an item that is sold out or out of an ingredient, and nothing when availability failed', () => {
    const rows = [
      item({ id: 'a', category_id: 'coffee', sold_out: true }),
      item({ id: 'b', category_id: 'coffee' }),
      item({ id: 'c', category_id: 'coffee' }),
    ];
    const menu = assembleMenu(categories, rows, [{ item_id: 'b', orderable: false }]);
    expect(menu[0]!.items.map((i) => i.available)).toEqual([false, false, true]);
    const noAvailability = assembleMenu(categories, rows);
    expect(noAvailability[0]!.items.map((i) => i.available)).toEqual([false, true, true]);
  });

  it('reads an unknown serve temperature as none', () => {
    const menu = assembleMenu(categories, [
      item({ id: 'a', category_id: 'coffee', serve_temp: 'hot' }),
      item({ id: 'b', category_id: 'coffee', serve_temp: 'tepid' }),
    ]);
    expect(menu[0]!.items.map((i) => i.serve_temp)).toEqual(['hot', 'none']);
  });
});

describe('pickText', () => {
  it('takes the locale first and falls back to the other language', () => {
    expect(pickText('Latte', 'لاتيه', 'ar')).toBe('لاتيه');
    expect(pickText('Latte', '', 'ar')).toBe('Latte');
    expect(pickText('', 'لاتيه', 'en')).toBe('لاتيه');
  });
});

describe('menuPhotoUrl', () => {
  const base = 'https://x.supabase.co/';

  it('builds the public menu-media URL, each segment encoded', () => {
    expect(menuPhotoUrl('items/abc/1 café.jpg', base)).toBe(
      'https://x.supabase.co/storage/v1/object/public/menu-media/items/abc/1%20caf%C3%A9.jpg',
    );
  });

  it('renders nothing for no path, a climbing path, or no base', () => {
    expect(menuPhotoUrl(null, base)).toBeNull();
    expect(menuPhotoUrl('', base)).toBeNull();
    expect(menuPhotoUrl('items/../secrets.jpg', base)).toBeNull();
    expect(menuPhotoUrl('items/a.jpg', undefined)).toBeNull();
  });
});

describe('progressive menu rows', () => {
  const row = (id: string) => ({ id }) as unknown as MenuViewSection['items'][number];
  const sections: MenuViewSection[] = [
    { id: 'a', name_en: 'A', name_ar: 'A', items: [row('a1'), row('a2'), row('a3')] },
    { id: 'b', name_en: 'B', name_ar: 'B', items: [row('b1'), row('b2')] },
    { id: 'c', name_en: 'C', name_ar: 'C', items: [row('c1')] },
  ];

  it('counts every row', () => {
    expect(menuRowCount(sections)).toBe(6);
    expect(menuRowCount([])).toBe(0);
  });

  it('cuts the menu to the first rows, in order', () => {
    expect(shownSections(sections, 4).map((s) => [s.id, s.items.map((i) => i.id)])).toEqual([
      ['a', ['a1', 'a2', 'a3']],
      ['b', ['b1']],
    ]);
    expect(shownSections(sections, 3).map((s) => s.id)).toEqual(['a']);
    expect(shownSections(sections, 0)).toEqual([]);
    expect(shownSections(sections, 99)).toEqual(sections);
  });

  it('keeps a whole section as the same object, so rows do not rebuild', () => {
    expect(shownSections(sections, 4)[0]).toBe(sections[0]);
  });

  it('asks for every row through a section plus one batch', () => {
    expect(rowsToShow(sections, 'b')).toBe(5 + MENU_MORE_ROWS);
    expect(rowsToShow(sections, 'zz')).toBe(0);
  });
});
