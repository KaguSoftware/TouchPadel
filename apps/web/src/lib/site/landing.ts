import type { Locale } from '@touch/i18n';
import type { MenuCategory } from '@/lib/menu';

/** The café's category names as a phrase, and whether the menu has more than it names. */
export interface CafeCategories {
  list: string;
  more: boolean;
}

/**
 * Café category names for the landing's Touch Cafe hand-off. Real names from the live
 * menu, in the page's language, in menu order, only categories that carry at least one
 * item, and at most `limit` of them so the sentence stays a sentence.
 *
 * A cut list must not read as the whole menu (copy finding, 2026-09-24: "Coffee,
 * Smoothie, Tea, Fresh Juice, and Frappuccino." named five of thirteen sections). So
 * `more` says the menu goes on, and the page then says "… and more" (`site.cafe.bodyMore`).
 * English names drop their menu capitals inside the sentence ("coffee, tea"), and a cut
 * English list is joined without its own "and" ("coffee, tea, fresh juice and more");
 * Arabic joins with و either way (Intl.ListFormat). Null when the menu read failed or is
 * empty: the page then uses `site.cafe.bodyNoCategories`.
 */
export function cafeCategoryList(
  categories: readonly MenuCategory[],
  locale: Locale,
  limit = 5,
): CafeCategories | null {
  const names = [...categories]
    .filter((c) => c.items.length > 0)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => (locale === 'ar' ? c.name_ar : c.name_en).trim())
    .filter((name) => name.length > 0)
    // Every open branch's menu is one list here, and a copied branch repeats
    // its source's categories: name each once.
    .filter((name, i, all) => all.indexOf(name) === i);
  if (names.length === 0) return null;
  const shown = names
    .slice(0, limit)
    .map((name) => (locale === 'en' ? name.toLocaleLowerCase('en') : name));
  const more = names.length > shown.length;
  const type = more && locale === 'en' ? 'unit' : 'conjunction';
  return { list: new Intl.ListFormat(locale, { style: 'long', type }).format(shown), more };
}
