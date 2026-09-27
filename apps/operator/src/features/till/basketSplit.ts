/**
 * Touch Shop (0146): one order is either kitchen work or a shelf sale. The
 * server refuses a basket that mixes café and shop lines (MIXED_BASKET), so the
 * till splits the basket and sends each part as its own order. Pure, so the
 * split is tested without a screen.
 */

export type MenuKind = 'cafe' | 'shop';

interface KindedMenu {
  categories: readonly { id: string; kind?: MenuKind | null }[];
  items: readonly { category_id: string; menu_item_variants: readonly { id: string }[] }[];
}

/** Every variant id that sits in a shop section. A category without `kind` (an old cached menu) is café. */
export function shopVariantIds(menu: KindedMenu | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  if (!menu) return out;
  const shopCats = new Set(menu.categories.filter((c) => c.kind === 'shop').map((c) => c.id));
  if (shopCats.size === 0) return out;
  for (const item of menu.items) {
    if (!shopCats.has(item.category_id)) continue;
    for (const v of item.menu_item_variants) out.add(v.id);
  }
  return out;
}

/** The basket's café part and shop part, each in basket order. */
export function splitBasket<T extends { variantId: string }>(
  lines: readonly T[],
  shopVariants: ReadonlySet<string>,
): { cafe: T[]; shop: T[] } {
  const cafe: T[] = [];
  const shop: T[] = [];
  for (const l of lines) (shopVariants.has(l.variantId) ? shop : cafe).push(l);
  return { cafe, shop };
}

/** Café sections first, then shop sections, each keeping its own sort order. */
export function orderSections<C extends { kind?: MenuKind | null }>(categories: readonly C[]): C[] {
  return [...categories.filter((c) => c.kind !== 'shop'), ...categories.filter((c) => c.kind === 'shop')];
}

/** The active variant carrying this barcode, with its item, or null. */
export function findByBarcode<
  I extends { is_active: boolean; menu_item_variants: readonly { id: string; barcode?: string | null }[] },
>(items: readonly I[], code: string): { item: I; variant: I['menu_item_variants'][number] } | null {
  const wanted = code.trim();
  if (!wanted) return null;
  for (const item of items) {
    if (!item.is_active) continue;
    const variant = item.menu_item_variants.find((v) => v.barcode === wanted);
    if (variant) return { item, variant };
  }
  return null;
}
