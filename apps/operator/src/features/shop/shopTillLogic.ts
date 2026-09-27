/**
 * The Touch Shop till (0243–0246, docs/design/shop/shop-desk-2026-09-27.md):
 * pure rules, no React and no network, so the node test beside this file pins
 * what the shop desk sells and how the basket adds up.
 *
 * The shop sells from the till menu's own shop sections (menu_categories.kind
 * = 'shop'), read from the same cached menu the café till trades from, so the
 * shop keeps selling offline. The server is the wall: a shop sale opens a
 * 'shop' tab (open_tab), takes shop lines only (TAB_KIND_MISMATCH otherwise)
 * and is settled at this desk; nothing here is trusted for a price.
 */
import type { CategoryRow, TillMenu } from '../till/tillData';

/** One sellable size of one shop product. */
export interface ShopSize {
  variantId: string;
  itemId: string;
  categoryId: string;
  nameEn: string;
  nameAr: string;
  sizeEn: string;
  sizeAr: string;
  /** More than one size: the tile names the size too. */
  hasSizes: boolean;
  priceIqd: number;
  barcode: string | null;
  sku: string | null;
  /** The menu's availability (any size on the shelf, not sold out today). */
  orderable: boolean;
}

export interface ShopCatalogue {
  sections: CategoryRow[];
  sizes: ShopSize[];
}

/**
 * The shop's active sections in their own order, and every size of every
 * active product in them. A menu cached before 0144 carries no `kind` and so
 * no shop section: an empty catalogue, never the café's items.
 */
export function shopCatalogue(menu: Pick<TillMenu, 'categories' | 'items' | 'availability'> | undefined): ShopCatalogue {
  if (!menu) return { sections: [], sizes: [] };
  const sections = menu.categories
    .filter((c) => c.kind === 'shop' && c.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const order = new Map(sections.map((c, i) => [c.id, i]));
  const sizes: ShopSize[] = [];
  const items = menu.items
    .filter((i) => i.is_active && order.has(i.category_id))
    .sort((a, b) => order.get(a.category_id)! - order.get(b.category_id)! || a.sort_order - b.sort_order);
  for (const item of items) {
    const variants = [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);
    const orderable = menu.availability[item.id] ?? true;
    for (const v of variants) {
      sizes.push({
        variantId: v.id,
        itemId: item.id,
        categoryId: item.category_id,
        nameEn: item.name_en,
        nameAr: item.name_ar,
        sizeEn: v.name_en,
        sizeAr: v.name_ar,
        hasSizes: variants.length > 1,
        priceIqd: v.price_iqd,
        barcode: v.barcode ?? null,
        sku: v.sku ?? null,
        orderable: orderable && !item.sold_out,
      });
    }
  }
  return { sections, sizes };
}

/**
 * What a scanner or a typed code names: the size whose barcode matches, else
 * whose SKU matches (case-insensitive, as the server keeps SKUs unique).
 */
export function findSizeByCode(sizes: readonly ShopSize[], code: string): ShopSize | null {
  const wanted = code.trim();
  if (!wanted) return null;
  return (
    sizes.find((s) => s.barcode !== null && s.barcode === wanted) ??
    sizes.find((s) => s.sku !== null && s.sku.toLowerCase() === wanted.toLowerCase()) ??
    null
  );
}

/** A typed search: either name, the size, the SKU or the barcode, anywhere in it. */
export function matchesSearch(size: ShopSize, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [size.nameEn, size.nameAr, size.sizeEn, size.sizeAr, size.sku ?? '', size.barcode ?? '']
    .some((field) => field.toLowerCase().includes(q));
}

export interface ShopLine {
  variantId: string;
  qty: number;
}

/** One more of a size: the line grows, or a new one joins the end. */
export function addToBasket(basket: readonly ShopLine[], variantId: string, qty = 1): ShopLine[] {
  const at = basket.findIndex((l) => l.variantId === variantId);
  if (at === -1) return [...basket, { variantId, qty }];
  return basket.map((l, i) => (i === at ? { ...l, qty: l.qty + qty } : l));
}

/** A line's quantity set; zero or less removes it. */
export function setLineQty(basket: readonly ShopLine[], variantId: string, qty: number): ShopLine[] {
  if (qty <= 0) return basket.filter((l) => l.variantId !== variantId);
  return basket.map((l) => (l.variantId === variantId ? { ...l, qty } : l));
}

/**
 * The basket at the menu's prices: what the till shows before the sale is
 * sent. The server's total (tax, a discount) is what is charged.
 */
export function basketEstimate(basket: readonly ShopLine[], sizes: readonly ShopSize[]): number {
  const byId = new Map(sizes.map((s) => [s.variantId, s]));
  return basket.reduce((sum, l) => sum + (byId.get(l.variantId)?.priceIqd ?? 0) * l.qty, 0);
}

export function basketCount(basket: readonly ShopLine[]): number {
  return basket.reduce((n, l) => n + l.qty, 0);
}

/** order.add_items' items for a shop sale. */
export function saleItems(basket: readonly ShopLine[]): { variantId: string; qty: number; modifiers: [] }[] {
  return basket.filter((l) => l.qty > 0).map((l) => ({ variantId: l.variantId, qty: l.qty, modifiers: [] }));
}

/**
 * A shop sale's tab label (open_tab refuses a shop tab without one): the time
 * it was rung up, which is what the drawer log and the day close show.
 */
export function saleLabel(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}
