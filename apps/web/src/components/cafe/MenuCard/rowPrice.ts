import type { MenuItem, MenuVariant } from '@/lib/menu';

/**
 * The menu prices ONE size per item, so a row prints exactly one number.
 *
 * Touch does not sell a drink in more than one size, which is why there are no
 * size headers over a section and no per-size price columns under them: every
 * row carries a single price cell of a fixed width at the end of the row, so
 * the numbers line up vertically down the whole section however long the names
 * beside them run.
 *
 * `menu_item_variants` still exists — it is what an order item points at, and
 * what carries the price — so an item normally has exactly one variant, and
 * the sheet's size picker (which hides itself below two) never appears.
 *
 * إيسبريسو is the one item that keeps two: a single or a double shot is a
 * choice about what goes in the cup, not a cup size. Its row still prints ONE
 * number so the column stays straight — the default, its Single — and its
 * sheet is the only one that asks. The same holds for a variant an operator
 * adds later: the row prints the default rather than widening the column back
 * into a price grid.
 */

/** The variant a row is priced at: the default one, else the cheapest. */
export function rowVariant(item: MenuItem): MenuVariant | null {
  if (item.variants.length === 0) return null;
  return (
    item.variants.find((v) => v.is_default) ??
    item.variants.reduce<MenuVariant | null>(
      (min, v) => (min === null || v.price_iqd < min.price_iqd ? v : min),
      null,
    )
  );
}

/** The single price a row prints, or `null` when the item has no variant. */
export function rowPrice(item: MenuItem): number | null {
  return rowVariant(item)?.price_iqd ?? null;
}
