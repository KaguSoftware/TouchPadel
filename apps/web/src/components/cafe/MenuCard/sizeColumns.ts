import type { Locale } from '@touch/i18n';
import type { MenuCategory, MenuItem, MenuVariant } from '@/lib/menu';

/**
 * The design prices a section in COLUMNS ("MEDIUM  LARGE"), not per row, so the
 * headers belong to the category and every row has to line up under them.
 *
 * The columns are derived from the data rather than configured. A category's
 * grid is the size vocabulary its multi-size rows agree on - the most common
 * set of size names among items sold in more than one size:
 *
 *   Coffee            Medium+Large x6, Medium x4, Single+Double x1 -> MEDIUM, LARGE
 *   Specialty Coffee  Medium+Large x1, Medium x1                   -> MEDIUM, LARGE
 *   Signature         Large x4 (no multi-size row)                 -> LARGE
 *   Tea / Desserts    Regular x n                                  -> (no header)
 *
 * That is what lets Espresso - the single row sold as Single/Double - drop out
 * of the grid and print its sizes inline exactly as the design draws it, while
 * Cold Brew, which is simply Medium-only, still lines up under MEDIUM and
 * leaves the LARGE cell empty. Counting each size name independently cannot do
 * both: any threshold high enough to reject Single/Double also rejects the
 * Large that only V60 offers.
 *
 * Ordering is `sort_order`, which the menu keeps cheapest-first, so the cells
 * and the headers above them are always in the same order in both reading
 * directions. (Fixing the header to `direction: ltr`, as the static design file
 * does, only lines up in Arabic.)
 */

/** A single unnamed size ("Regular") is not a column - Tea and Desserts print no header. */
export const GENERIC_SIZE = 'Regular';

const named = (item: MenuItem): MenuVariant[] =>
  item.variants.filter((v) => v.name_en !== GENERIC_SIZE);

/** Distinct size names of a category, cheapest-first, generic size excluded. */
export function sizeColumns(category: MenuCategory): string[] {
  const sortOf = new Map<string, number>();
  for (const item of category.items) {
    for (const v of named(item)) {
      const prev = sortOf.get(v.name_en);
      sortOf.set(v.name_en, prev === undefined ? v.sort_order : Math.min(prev, v.sort_order));
    }
  }
  if (sortOf.size === 0) return [];

  const order = (names: string[]) =>
    [...names].sort((a, b) => (sortOf.get(a) ?? 0) - (sortOf.get(b) ?? 0) || a.localeCompare(b));

  // Candidate grids: the size-name set of every row sold in more than one size.
  const tally = new Map<string, { names: string[]; items: number }>();
  for (const item of category.items) {
    const names = named(item).map((v) => v.name_en);
    if (names.length < 2) continue;
    const key = order(names).join(' ');
    const prev = tally.get(key);
    if (prev) prev.items += 1;
    else tally.set(key, { names: order(names), items: 1 });
  }
  // No row offers a choice of sizes: the grid is simply every size in play
  // (Signature, priced LARGE only).
  if (tally.size === 0) return order([...sortOf.keys()]);

  const best = [...tally.values()].sort(
    (a, b) =>
      b.items - a.items || // the vocabulary most rows agree on
      b.names.length - a.names.length || // then the richer grid
      a.names.join().localeCompare(b.names.join()), // then stable
  )[0];
  return best ? best.names : [];
}

/**
 * The header labels. The design sets them in Latin caps even on the Arabic
 * page - they are the size scale, not prose - so the locale only decides
 * whether the labels are read out, not how they are spelled.
 */
export function sizeHeaders(category: MenuCategory, _locale: Locale): string[] {
  return sizeColumns(category).map((name) => name.toUpperCase());
}

export type PriceLayout =
  /** one cell per column, `null` where this item does not offer that size */
  | { kind: 'columns'; cells: (number | null)[] }
  /** the category prices a single unnamed size - one cell, sized to content */
  | { kind: 'single'; price: number }
  /** sizes outside the category's grid: printed inline under the name */
  | { kind: 'inline'; parts: { label: string; price: number }[] };

const cheapest = (variants: MenuVariant[]): MenuVariant | null =>
  variants.reduce<MenuVariant | null>(
    (min, v) => (min === null || v.price_iqd < min.price_iqd ? v : min),
    null,
  );

/** How one row's prices sit against its category's columns. */
export function priceLayout(item: MenuItem, columns: string[]): PriceLayout | null {
  if (item.variants.length === 0) return null;
  if (columns.length === 0) {
    const v = cheapest(item.variants);
    return v ? { kind: 'single', price: v.price_iqd } : null;
  }
  const byName = new Map(item.variants.map((v) => [v.name_en.toUpperCase(), v]));
  const offGrid = item.variants.filter((v) => !columns.includes(v.name_en.toUpperCase()));
  if (offGrid.length > 0) {
    return {
      kind: 'inline',
      parts: [...item.variants]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((v) => ({ label: v.name_en, price: v.price_iqd })),
    };
  }
  return { kind: 'columns', cells: columns.map((c) => byName.get(c)?.price_iqd ?? null) };
}
