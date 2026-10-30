/**
 * The café menu as the guest app shows it: to look at, never to order from. The rows are the
 * same anon-visible ones the web menu reads (`apps/web/src/lib/menu.ts`), cut down to what a
 * read-only list needs: names, the one-line hook, the photo, the sizes with their prices, and
 * whether the item can be had today. Ordering stays at the table's QR and the counter.
 *
 * PURE (vitest): nothing here imports react-native or expo.
 */
import type { Locale } from '@touch/i18n';

export type ServeTemp = 'none' | 'hot' | 'cold' | 'both';

export interface CategoryRow {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}

export interface VariantRow {
  id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}

export interface AllergenRow {
  code: string;
  label_en: string;
  label_ar: string;
}

export interface ItemRow {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  hook_en: string | null;
  hook_ar: string | null;
  description_en?: string | null;
  description_ar?: string | null;
  sold_out: boolean | null;
  serve_temp: string | null;
  photo_path: string | null;
  sort_order: number;
  menu_item_variants: VariantRow[] | null;
  menu_item_allergens?: { allergens: AllergenRow | null }[] | null;
}

export interface AvailabilityRow {
  item_id: string | null;
  orderable: boolean | null;
}

export interface MenuSize {
  id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
}

export interface MenuViewItem {
  id: string;
  name_en: string;
  name_ar: string;
  hook_en: string;
  hook_ar: string;
  description_en: string;
  description_ar: string;
  photo_path: string | null;
  serve_temp: ServeTemp;
  /** False when the manager marked it sold out or an ingredient ran out today. */
  available: boolean;
  /** In menu order. One size is the item's single price. */
  sizes: MenuSize[];
  allergens: AllergenRow[];
}

export interface MenuViewSection {
  id: string;
  name_en: string;
  name_ar: string;
  items: MenuViewItem[];
}

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

const asServeTemp = (v: string | null | undefined): ServeTemp =>
  v === 'hot' || v === 'cold' || v === 'both' ? v : 'none';

/**
 * Sections in menu order, each with its items in menu order. A category with nothing in it is
 * dropped (a heading over nothing reads as a fault), and so is an item with no size, which has
 * no price to show. A failed availability read greys nothing: only `sold_out` counts then.
 */
export function assembleMenu(
  categories: readonly CategoryRow[],
  items: readonly ItemRow[],
  availability: readonly AvailabilityRow[] = [],
): MenuViewSection[] {
  const orderable = new Map<string, boolean>();
  for (const row of availability) {
    if (row.item_id) orderable.set(row.item_id, row.orderable ?? true);
  }
  const byCategory = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = byCategory.get(item.category_id) ?? [];
    list.push(item);
    byCategory.set(item.category_id, list);
  }
  return [...categories]
    .sort(bySort)
    .map((c) => ({
      id: c.id,
      name_en: c.name_en,
      name_ar: c.name_ar,
      items: (byCategory.get(c.id) ?? [])
        .slice()
        .sort(bySort)
        .map((i) => ({
          id: i.id,
          name_en: i.name_en,
          name_ar: i.name_ar,
          hook_en: i.hook_en ?? '',
          hook_ar: i.hook_ar ?? '',
          description_en: i.description_en ?? '',
          description_ar: i.description_ar ?? '',
          photo_path: i.photo_path,
          serve_temp: asServeTemp(i.serve_temp),
          available: !(i.sold_out ?? false) && (orderable.get(i.id) ?? true),
          allergens: (i.menu_item_allergens ?? [])
            .map((l) => l.allergens)
            .filter((a): a is AllergenRow => a != null),
          sizes: (i.menu_item_variants ?? [])
            .slice()
            .sort(bySort)
            .map((v) => ({ id: v.id, name_en: v.name_en, name_ar: v.name_ar, price_iqd: v.price_iqd, is_default: v.is_default })),
        }))
        .filter((i) => i.sizes.length > 0),
    }))
    .filter((s) => s.items.length > 0);
}

/** The Arabic text in Arabic when there is one, else the English (and the reverse). */
export function pickText(en: string, ar: string, locale: Locale): string {
  return locale === 'ar' ? ar || en : en || ar;
}

/**
 * The public URL of a menu photo in the `menu-media` bucket, or null. Every segment is
 * URI-encoded, as on the web, so Arabic file names and spaces survive; a path that tries to
 * climb out of the bucket is never rendered.
 */
export function menuPhotoUrl(
  path: string | null | undefined,
  base: string | null | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): string | null {
  if (typeof path !== 'string') return null;
  const trimmed = path.replace(/^\/+/, '');
  if (trimmed === '' || trimmed.split('/').includes('..')) return null;
  if (typeof base !== 'string' || !/^https?:\/\//.test(base)) return null;
  const encoded = trimmed.split('/').map(encodeURIComponent).join('/');
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/menu-media/${encoded}`;
}
