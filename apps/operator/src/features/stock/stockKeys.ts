/**
 * Stock query keys + fetchers — one key, one shape (lib/queries.ts doctrine),
 * feature-private under the ['stock', …] tree. Everything reads the 0017-0019
 * tables/views or report_stock (0068); every write is an app.* RPC from the
 * screens.
 *
 * ONE KEY, ONE SHAPE is load-bearing here: On hand used to cache
 * `['stock','expiring']` as bare `{batch_id}` rows while Expiry read the same
 * key expecting full batch rows, so opening Expiry after On hand crashed on a
 * missing expiry date. Every fetcher a key is used with now lives in this file.
 */
import { presetPeriod } from '../../components/kit';
import { appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';

export const SK = {
  onHand: ['stock', 'onHand'] as const,
  ingredients: ['stock', 'ingredients'] as const,
  ledger: (ingredientId: string) => ['stock', 'ledger', ingredientId] as const,
  recipes: (target: string, id: string) => ['stock', 'recipes', target, id] as const,
  openCount: ['stock', 'openCount'] as const,
  counts: ['stock', 'counts'] as const,
  variance: (countId: string) => ['stock', 'variance', countId] as const,
  margins: ['stock', 'margins'] as const,
  alerts: ['stock', 'alerts'] as const,
  summary: ['stock', 'summary'] as const,
  lastCount: ['stock', 'lastCount'] as const,
  alertCount: ['stock', 'alertCount'] as const,
  expiryWindow: ['stock', 'expiryWindow'] as const,
  movementCheck: (ingredientId: string) => ['stock', 'movementCheck', ingredientId] as const,
  suppliers: ['stock', 'suppliers'] as const,
  products: ['stock', 'products'] as const,
};

/** 0143: 'retail' = a Touch Shop size's own stock row (unit pc, one per variant). */
export type IngredientKind = 'purchased' | 'prepared' | 'retail';

export interface OnHandRow {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: 'g' | 'ml' | 'pc';
  kind: IngredientKind;
  on_hand: number;
  theoretical: number;
  par_level: number | null;
  low_stock_threshold: number | null;
  is_active: boolean;
}

export async function fetchOnHand(): Promise<OnHandRow[]> {
  const { data, error } = await supabase
    .from('v_ingredient_on_hand')
    .select('*')
    .order('name_en');
  if (error) throw error;
  return data as OnHandRow[];
}

export interface IngredientRow {
  id: string;
  kind: IngredientKind;
  name_en: string;
  name_ar: string;
  unit: 'g' | 'ml' | 'pc';
  pack_size: number | null;
  pack_cost_iqd: number | null;
  supplier_name: string | null;
  shelf_life_days: number | null;
  yield_percent: number;
  waste_allowance_percent: number;
  par_level: number | null;
  low_stock_threshold: number | null;
  is_active: boolean;
  /** 0144: the supplier record, beside the free-text supplier_name. */
  supplier_id?: string | null;
  /** 0144: the Touch Shop size this stock row belongs to (retail only). */
  variant_id?: string | null;
}

export async function fetchIngredients(): Promise<IngredientRow[]> {
  const { data, error } = await supabase.from('ingredients').select('*').order('name_en');
  if (error) throw error;
  return data as IngredientRow[];
}

export interface MovementRow {
  id: number;
  at: string;
  movement_type: string;
  qty_delta: number;
  unit_cost_iqd: number | null;
  reason_code: string | null;
  /** Null only on a line that sold past the batches on record (an overdraft). */
  batch_id: string | null;
  staff: { display_name: string } | null;
}

export const LEDGER_PAGE = 50;

/** Who made the movement travels with it — staff are named, never shown as ids. */
export const MOVEMENT_SELECT = 'id, at, movement_type, qty_delta, unit_cost_iqd, reason_code, batch_id, staff:staff_id(display_name)';

export async function fetchLedger(ingredientId: string, page = 0): Promise<MovementRow[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select(MOVEMENT_SELECT)
    .eq('ingredient_id', ingredientId)
    .order('at', { ascending: false })
    .range(page * LEDGER_PAGE, (page + 1) * LEDGER_PAGE - 1);
  if (error) throw error;
  return data as unknown as MovementRow[];
}

/** One batch in report_stock's expiring / expired lists (0068). */
export interface SummaryBatch {
  batchId: string;
  ingredientId: string;
  nameEn: string;
  nameAr: string;
  unit: string;
  qtyRemaining: number;
  expiryDate: string;
  daysLeft?: number;
  daysExpired?: number;
  /** Server-rounded value of what is left, at the batch's own cost. */
  valueIqd: number;
}

export interface StockSummary {
  stockValueIqd: number | null;
  expiringSoon: SummaryBatch[];
  expired: SummaryBatch[];
}

/**
 * report_stock (0068) is the one read that carries the stock value and each
 * batch's worth. Its figures here do not depend on the period, so today's is
 * passed only because the signature needs one.
 */
export async function fetchSummary(): Promise<StockSummary> {
  const today = presetPeriod('today');
  const raw = await appRpc<Partial<StockSummary> | null>('report_stock', { p_from: today.from, p_to: today.to, p_filters: {} });
  return {
    stockValueIqd: typeof raw?.stockValueIqd === 'number' ? raw.stockValueIqd : null,
    expiringSoon: Array.isArray(raw?.expiringSoon) ? raw.expiringSoon : [],
    expired: Array.isArray(raw?.expired) ? raw.expired : [],
  };
}

export interface CountRow {
  id: string;
  started_at: string;
  finalized_at: string | null;
}

/** The count in progress, if any (the server allows one at a time). */
export async function fetchOpenCount(): Promise<CountRow | null> {
  const { data, error } = await supabase.from('stock_counts').select('id, started_at, finalized_at').is('finalized_at', null).maybeSingle();
  if (error) throw error;
  return data as CountRow | null;
}

/** The most recently finished count, if any. */
export async function fetchLastCount(): Promise<CountRow | null> {
  const { data, error } = await supabase
    .from('stock_counts')
    .select('id, started_at, finalized_at')
    .not('finalized_at', 'is', null)
    .order('finalized_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as CountRow | null;
}

/** Alerts nobody has dismissed yet — a count, not the rows. */
export async function fetchAlertCount(): Promise<number> {
  const { count, error } = await supabase.from('manager_alerts').select('id', { count: 'exact', head: true }).is('acknowledged_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** The venue's "expiring soon" window in days (v_expiring_soon reads the same setting). */
export async function fetchExpiryWindow(): Promise<number | null> {
  const { data, error } = await supabase.from('venue_settings').select('expiring_soon_days').limit(1).maybeSingle();
  if (error) throw error;
  const days = (data as { expiring_soon_days: number | null } | null)?.expiring_soon_days;
  return typeof days === 'number' ? days : null;
}

// ---------------------------------------------------------------------------
// Touch Shop (0144/0145)
// ---------------------------------------------------------------------------

export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
}

/** Suppliers at the caller's venue(s); RLS shows them to managers and owners only. */
export async function fetchSuppliers(): Promise<SupplierRow[]> {
  const { data, error } = await supabase.from('suppliers').select('id, name, phone, notes, is_active').order('name');
  if (error) throw error;
  return data as SupplierRow[];
}

export interface ShopVariantRow {
  id: string;
  item_id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
  sku: string | null;
  barcode: string | null;
}

export interface ShopProductRow {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  /** When it first went on sale; null = a hidden draft never on sale (product_release). */
  launched_at: string | null;
  sort_order: number;
  menu_item_variants: ShopVariantRow[];
}

export interface ShopSectionRow {
  id: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
}

export interface ShopCatalogue {
  sections: ShopSectionRow[];
  products: ShopProductRow[];
}

/** Every shop section and its products with their sizes. */
export async function fetchShopCatalogue(): Promise<ShopCatalogue> {
  const { data: sections, error: sErr } = await supabase
    .from('menu_categories')
    .select('id, name_en, name_ar, is_active')
    .eq('kind', 'shop')
    .order('sort_order');
  if (sErr) throw sErr;
  const ids = (sections ?? []).map((s) => s.id);
  if (ids.length === 0) return { sections: [], products: [] };
  const { data: products, error: pErr } = await supabase
    .from('menu_items')
    .select('id, category_id, name_en, name_ar, is_active, launched_at, sort_order, menu_item_variants(id, item_id, name_en, name_ar, price_iqd, is_default, sort_order, sku, barcode)')
    .in('category_id', ids)
    .order('sort_order');
  if (pErr) throw pErr;
  return { sections: (sections ?? []) as ShopSectionRow[], products: (products ?? []) as unknown as ShopProductRow[] };
}
