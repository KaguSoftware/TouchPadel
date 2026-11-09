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
import { computeTabTotals, type TaxContext, type TotalsInput } from '../till/tabTotals';

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

/**
 * What a sale on the server owes, worked out in one place: `total` is the whole
 * bill, which is what settle_tab compares p_expected_total_iqd with (0106), and
 * `due` is what is still to pay after the payments so far. It is the till's
 * mirror of app.compute_tab_totals (till/tabTotals.ts), so tax and discounts
 * count. The raw tabs.total_iqd column is stamped only by a settle, so it is
 * null on a sale that has never been paid. Sending the due as the expected
 * total made every second part payment fail with TOTAL_CHANGED.
 */
export function saleOwed(detail: TotalsInput, tax: TaxContext | null): { total: number; due: number } {
  const t = computeTabTotals(detail, tax, 0);
  return { total: t.total, due: t.due };
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

// ---------------------------------------------------------------------------
// F-56: a sale recorded offline (or settled slowly) keeps its member and
// prints its receipt.
// ---------------------------------------------------------------------------

/** A line as the receipt and the offline tab hold it: a name, how many, and what it comes to. */
export interface ReceiptLine {
  name: string;
  qty: number;
  /** Unit price at the cached menu's price. */
  priceIqd: number;
  categoryId: string | null;
  /** The stamped line total, when the server already priced it (a sale taken up again). */
  lineTotalIqd?: number;
}

/** The basket as receipt lines (and offline tab lines): what was sold, named for the guest. */
export function saleReceiptLines(
  basket: readonly ShopLine[],
  sizes: readonly ShopSize[],
  nameOf: (s: ShopSize) => string,
): ReceiptLine[] {
  const byId = new Map(sizes.map((s) => [s.variantId, s]));
  return basket
    .filter((l) => l.qty > 0)
    .map((l) => {
      const s = byId.get(l.variantId);
      return { name: s ? nameOf(s) : l.variantId, qty: l.qty, priceIqd: s?.priceIqd ?? 0, categoryId: s?.categoryId ?? null };
    });
}

/**
 * The member on an offline sale (F-56): set_tab_customer queued against the
 * sale's tab.open key, BEFORE its settle, so the replay attaches the member
 * first and the points are earned when the payment lands. Used to be skipped
 * offline ("the sale goes without"), and the guest simply earned nothing.
 */
export function memberQueueCall(customerId: string, tabIdemKey: string): {
  fn: 'set_tab_customer';
  args: { p_customer_id: string };
  opts: { tabIdemKey: string };
} {
  return { fn: 'set_tab_customer', args: { p_customer_id: customerId }, opts: { tabIdemKey } };
}

/**
 * What a local receipt prints (F-56): the lines as sold, the total the cashier
 * charged and the payment, in the shapes BillView renders. Ids are local: the
 * server has not answered yet, which the receipt says in words.
 */
export interface LocalReceipt {
  lines: readonly ReceiptLine[];
  totalIqd: number;
  method: 'cash' | 'card';
}

export function localReceiptBill(r: LocalReceipt): {
  orders: {
    id: string;
    status: string;
    order_items: {
      id: string;
      qty: number;
      line_total_iqd: number;
      voided: boolean;
      menu_item: { name_en: string; name_ar: string };
      variant: null;
      order_item_modifiers: [];
    }[];
  }[];
  totals: { subtotal: number; discount: number; tax: number; court: number; total: number; paid: number; due: number };
  payments: { id: string; method: string; amount_iqd: number }[];
} {
  const lineTotal = (l: ReceiptLine) => l.lineTotalIqd ?? l.priceIqd * l.qty;
  const subtotal = r.lines.reduce((s, l) => s + lineTotal(l), 0);
  return {
    orders: [
      {
        id: 'local',
        status: 'open',
        order_items: r.lines.map((l, i) => ({
          id: `local-${i}`,
          qty: l.qty,
          line_total_iqd: lineTotal(l),
          voided: false,
          menu_item: { name_en: l.name, name_ar: l.name },
          variant: null,
          order_item_modifiers: [],
        })),
      },
    ],
    // What was charged is the total; anything between it and the lines (tax,
    // a discount) shows as the difference the server will confirm.
    totals: {
      subtotal,
      discount: Math.max(subtotal - r.totalIqd, 0),
      tax: Math.max(r.totalIqd - subtotal, 0),
      court: 0,
      total: r.totalIqd,
      paid: r.totalIqd,
      due: 0,
    },
    payments: [{ id: 'local-payment', method: r.method, amount_iqd: r.totalIqd }],
  };
}

/** A server tab's live lines as receipt lines — for an unfinished sale taken up again. */
export function detailReceiptLines(
  orders: readonly {
    status: string;
    order_items?: readonly {
      qty: number;
      line_total_iqd: number;
      voided: boolean;
      menu_item: { name_en: string; name_ar: string; category_id?: string } | null;
      variant?: { name_en: string; name_ar: string } | null;
    }[];
  }[],
  locale: 'en' | 'ar',
): ReceiptLine[] {
  const pick = (n: { name_en: string; name_ar: string } | null | undefined) => (n ? (locale === 'ar' ? n.name_ar || n.name_en : n.name_en) : '');
  return orders
    .filter((o) => o.status !== 'voided')
    .flatMap((o) => (o.order_items ?? []).filter((i) => !i.voided))
    .map((i) => {
      const name = [pick(i.menu_item), pick(i.variant)].filter(Boolean).join(' · ') || '—';
      // Unit price from the stamped line total: what the guest was charged for it.
      return {
        name,
        qty: i.qty,
        priceIqd: i.qty > 0 ? Math.round(i.line_total_iqd / i.qty) : i.line_total_iqd,
        categoryId: i.menu_item?.category_id ?? null,
        lineTotalIqd: i.line_total_iqd,
      };
    });
}
