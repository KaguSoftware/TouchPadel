import {
  DEFAULT_CAFE_SETTINGS,
  type CafeSettings,
  type MenuCategory,
  type MenuItem,
  type VenueOpeningHours,
} from '@/lib/menu';
import type { MenuResult } from '@/lib/menu.server';

/**
 * Fixtures for the jsdom page smoke renders (`*.test.tsx`).
 *
 * The names are deliberately invented rather than borrowed from the real menu:
 * `SECTION_ART` in `components/cafe/MenuStage/sectionArt.tsx` is keyed by
 * `name_en`, so a real name ("Coffee") would make the section band print the
 * design's own Latin word and the assertion would stop testing the fixture.
 * An unknown category falls back to `name_en.toUpperCase()` in English and to
 * `name_ar` in Arabic — which is exactly the language switch under test.
 *
 * Everything is exported as a NAMED const rather than reached for by index:
 * `noUncheckedIndexedAccess` is on repo-wide (tsconfig.base.json), so
 * `MENU_FIXTURE[0].items[0]` would not typecheck without a non-null assertion.
 */
const item = (
  over: Partial<MenuItem> & Pick<MenuItem, 'id' | 'category_id' | 'name_en' | 'name_ar'>,
): MenuItem => ({
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
  variants: [
    {
      id: `${over.id}-v1`,
      name_en: 'Regular',
      name_ar: 'عادي',
      price_iqd: 3000,
      is_default: true,
      sort_order: 1,
    },
  ],
  allergens: [],
  modifierGroups: [],
  suggestedItemIds: [],
  ...over,
});

export const FLAT_WHITE: MenuItem = item({
  id: 'item-flat',
  category_id: 'cat-sips',
  name_en: 'Fixture Flat White',
  name_ar: 'فلات وايت التجربة',
});

export const ICED_TEA: MenuItem = item({
  id: 'item-iced',
  category_id: 'cat-sips',
  name_en: 'Fixture Iced Tea',
  name_ar: 'شاي مثلج التجربة',
  sort_order: 2,
  serve_temp: 'cold',
});

export const CAKE: MenuItem = item({
  id: 'item-cake',
  category_id: 'cat-bites',
  name_en: 'Fixture Cake',
  name_ar: 'كيك التجربة',
});

/** A row that must render but must NOT be a button (no sheet behind it). */
export const SOLD_OUT_ITEM: MenuItem = item({
  id: 'item-gone',
  category_id: 'cat-bites',
  name_en: 'Fixture Sold Out',
  name_ar: 'نفد التجربة',
  sort_order: 2,
  sold_out: true,
  orderable: false,
});

export const SIPS: MenuCategory = {
  id: 'cat-sips',
  name_en: 'Fixture Sips',
  name_ar: 'مشروبات التجربة',
  sort_order: 1,
  serve_temp: 'none',
  photo_path: null,
  photo_url: null,
  photo_blur: null,
  items: [FLAT_WHITE, ICED_TEA],
};

export const BITES: MenuCategory = {
  id: 'cat-bites',
  name_en: 'Fixture Bites',
  name_ar: 'أكلات التجربة',
  sort_order: 2,
  serve_temp: 'none',
  photo_path: null,
  photo_url: null,
  photo_blur: null,
  items: [CAKE, SOLD_OUT_ITEM],
};

/** Two categories, four items — enough for section bands, rows and a scroll spy. */
export const MENU_FIXTURE: MenuCategory[] = [SIPS, BITES];

export const SETTINGS_FIXTURE: CafeSettings = {
  ...DEFAULT_CAFE_SETTINGS,
  ticker_en: [],
  ticker_ar: [],
  // The bell coach mark is opt-in state the smoke renders must not trip over.
  bell_tutorial_enabled: false,
};

export const VENUE_PHONE = '+964 770 000 0000';

export const VENUE_FIXTURE: VenueOpeningHours = {
  venue_name: 'Fixture Padel',
  opening_hours: {
    mon: [['09:00', '23:00']],
    tue: [['09:00', '23:00']],
    wed: [['09:00', '23:00']],
    thu: [['09:00', '23:00']],
    fri: [['09:00', '23:00']],
    sat: [['09:00', '23:00']],
    sun: [['09:00', '23:00']],
  },
  closed_dates: [],
  phone: VENUE_PHONE,
};

export const MENU_OK: MenuResult = { status: 'ok', categories: MENU_FIXTURE };
export const MENU_ERROR: MenuResult = { status: 'error', categories: [] };

/**
 * What the mocked `@/lib/menu.server` hands back, as MUTABLE state.
 *
 * The three reads are mocked with plain functions that close over this object
 * rather than with `vi.fn()` implementations, because `restoreMocks: true`
 * (vitest.config.ts) wipes a `vi.fn()`'s implementation after every test while
 * a module factory only ever runs once — the second test in a file would then
 * get `undefined` back from `getCachedMenu()`. Reassigning a field here is
 * immune to that; `resetServerData()` runs in `beforeEach`.
 */
export const serverData: {
  menu: MenuResult;
  settings: CafeSettings;
  venue: VenueOpeningHours | null;
} = { menu: MENU_OK, settings: SETTINGS_FIXTURE, venue: VENUE_FIXTURE };

export function resetServerData(): void {
  serverData.menu = MENU_OK;
  serverData.settings = SETTINGS_FIXTURE;
  serverData.venue = VENUE_FIXTURE;
}
