/**
 * Touch Shop products (0144/0145) — the pure half of the Products screen.
 *
 * A product is a menu item in a shop section; each size is a variant with its
 * own `retail` stock row. The screen lists one row per size, so a racket in
 * three sizes shows three rows with three on-hand figures and three barcodes.
 */
import type { IngredientRow, OnHandRow, ShopCatalogue, ShopVariantRow, SupplierRow } from '../stockKeys';

export interface ProductLine {
  productId: string;
  sectionId: string;
  product: { name_en: string; name_ar: string; is_active: boolean };
  /** On sale now or before (see productLaunched). */
  launched: boolean;
  variant: ShopVariantRow;
  /** The size's own stock row; null = a size made in the menu editor, not tracked yet. */
  ingredientId: string | null;
  onHand: number | null;
  packCostIqd: number | null;
  lowStockThreshold: number | null;
  supplier: SupplierRow | null;
}

/** One row per size, products in their order, sizes in theirs. */
export function flattenCatalogue(
  catalogue: ShopCatalogue,
  ingredients: readonly IngredientRow[],
  onHand: readonly OnHandRow[],
  suppliers: readonly SupplierRow[],
): ProductLine[] {
  const stockOf = new Map(ingredients.filter((i) => i.variant_id).map((i) => [i.variant_id!, i]));
  const onHandOf = new Map(onHand.map((r) => [r.ingredient_id, r]));
  const supplierOf = new Map(suppliers.map((s) => [s.id, s]));
  const out: ProductLine[] = [];
  for (const p of catalogue.products) {
    const sizes = [...p.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order || a.name_en.localeCompare(b.name_en));
    for (const v of sizes) {
      const ing = stockOf.get(v.id) ?? null;
      out.push({
        productId: p.id,
        sectionId: p.category_id,
        product: { name_en: p.name_en, name_ar: p.name_ar, is_active: p.is_active },
        launched: productLaunched(p),
        variant: v,
        ingredientId: ing?.id ?? null,
        onHand: ing ? Number(onHandOf.get(ing.id)?.on_hand ?? 0) : null,
        packCostIqd: ing?.pack_cost_iqd ?? null,
        lowStockThreshold: ing?.low_stock_threshold ?? null,
        supplier: ing?.supplier_id ? (supplierOf.get(ing.supplier_id) ?? null) : null,
      });
    }
  }
  return out;
}

/**
 * Launched = on sale now or at some point: launched_at set, or switched on,
 * the same test app.upsert_variant's size lock makes (price_promo, #51). A
 * product never launched and switched off is a draft: its prices are still
 * the manager's own.
 */
export function productLaunched(p: { launched_at: string | null; is_active: boolean }): boolean {
  return p.launched_at !== null || p.is_active;
}

export interface ProductLock {
  /** The size prices are read-only and Add size is off: "Change the price". */
  priceLocked: boolean;
  /** A hidden draft: "Put on sale", a shop_launch change the owner approves. */
  putOnSale: boolean;
}

/**
 * What a size row offers a caller without `editLaunchedPrices` or
 * `launchDirectly` (a manager, build-contracts-2026-09-23 §5.5, #51, #53).
 * SKU, barcode, supplier, pack cost and the low-stock level stay editable
 * either way: upsert_retail_variant passes with the price unchanged.
 */
export function productLock(line: Pick<ProductLine, 'launched'>, caps: { editLaunchedPrices: boolean; launchDirectly: boolean }): ProductLock {
  return {
    priceLocked: !caps.editLaunchedPrices && line.launched,
    putOnSale: !caps.launchDirectly && !line.launched,
  };
}

/** Product or size name in either script, SKU or barcode. */
export function matchesProductLine(line: ProductLine, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const raw = query.trim();
  return (
    line.product.name_en.toLowerCase().includes(q) ||
    line.product.name_ar.includes(raw) ||
    line.variant.name_en.toLowerCase().includes(q) ||
    line.variant.name_ar.includes(raw) ||
    (line.variant.sku ?? '').toLowerCase().includes(q) ||
    (line.variant.barcode ?? '').includes(raw)
  );
}

/** Same shapes as the 0144 CHECKs, so the form refuses what the database would. */
export const SKU_RE = /^[A-Za-z0-9._/-]{1,64}$/;
export const BARCODE_RE = /^[A-Za-z0-9-]{4,64}$/;

export interface SizeDraft {
  nameEn: string;
  nameAr: string;
  price: string;
  sku: string;
  barcode: string;
  cost: string;
  low: string;
}

export type SizeProblem = 'names' | 'price' | 'sku' | 'barcode' | 'cost' | 'low';

const wholeIqd = (v: string) => /^\d{1,12}$/.test(v.trim());
const nonNegative = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

/** The first thing wrong with a size, or null. Blank optional fields are fine. */
export function sizeProblem(d: SizeDraft): SizeProblem | null {
  if (!d.nameEn.trim() || !d.nameAr.trim()) return 'names';
  if (!wholeIqd(d.price)) return 'price';
  if (d.sku.trim() && !SKU_RE.test(d.sku.trim())) return 'sku';
  if (d.barcode.trim() && !BARCODE_RE.test(d.barcode.trim())) return 'barcode';
  if (d.cost.trim() && !wholeIqd(d.cost)) return 'cost';
  if (d.low.trim() && !nonNegative(d.low)) return 'low';
  return null;
}

/** The upsert_retail_variant arguments for a size draft (strings in, typed values out). */
export function sizeArgs(d: SizeDraft, supplierId: string) {
  return {
    p_name_en: d.nameEn.trim(),
    p_name_ar: d.nameAr.trim(),
    p_price_iqd: Number(d.price.trim()),
    p_sku: d.sku.trim() || null,
    p_barcode: d.barcode.trim() || null,
    p_supplier_id: supplierId || null,
    p_pack_cost_iqd: d.cost.trim() ? Number(d.cost.trim()) : null,
    p_low_stock_threshold: d.low.trim() ? Number(d.low.trim()) : null,
  };
}
