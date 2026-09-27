import type { Locale } from '@touch/i18n';
import type { MenuCategory } from '@/lib/menu';

/** One row on the landing's drawn phone: a real item's name and list price. */
export interface CafePhoneRow {
  id: string;
  name: string;
  priceIqd: number;
}

/** What the drawn phone in the Touch Cafe section shows: one real menu section. */
export interface CafePhoneMenu {
  section: string;
  rows: CafePhoneRow[];
}

/**
 * The live menu section the Touch Cafe hand-off's third step ("Order from your phone")
 * draws on its phone: the first section in menu order with at least two orderable items
 * that carry a price, cut to `limit`, in the page's language. A row's price is its default
 * variant's (else its first variant's) list price, as the menu lists it. Null when the
 * menu read failed or no section qualifies: the phone then shows the café's mark.
 */
export function cafePhoneMenu(
  categories: readonly MenuCategory[],
  locale: Locale,
  limit = 3,
): CafePhoneMenu | null {
  const pick = (en: string, ar: string) => (locale === 'ar' ? ar : en).trim();
  for (const c of [...categories].sort((a, b) => a.sort_order - b.sort_order)) {
    const rows: CafePhoneRow[] = [...c.items]
      .filter((i) => i.orderable && !i.sold_out)
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((i) => {
        const variants = [...i.variants].sort((a, b) => a.sort_order - b.sort_order);
        const variant = variants.find((v) => v.is_default) ?? variants[0];
        const name = pick(i.name_en, i.name_ar);
        return variant && name ? [{ id: i.id, name, priceIqd: variant.price_iqd }] : [];
      });
    const section = pick(c.name_en, c.name_ar);
    if (section && rows.length >= 2) return { section, rows: rows.slice(0, limit) };
  }
  return null;
}
