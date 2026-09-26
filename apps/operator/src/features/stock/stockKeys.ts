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
import type { StockLocation, StoreRow, UnfinishedCount } from './storeLogic';

export const SK = {
  onHand: ['stock', 'onHand'] as const,
  ingredients: ['stock', 'ingredients'] as const,
  ledger: (ingredientId: string) => ['stock', 'ledger', ingredientId] as const,
  recipes: (target: string, id: string) => ['stock', 'recipes', target, id] as const,
  /** The manager's open count at one store (wave 5: one count per store). */
  openCount: (location: StockLocation) => ['stock', 'openCount', location] as const,
  /** Every count not yet applied, both stores, operator and phone (wave 5). */
  unfinishedCounts: ['stock', 'unfinishedCounts'] as const,
  /** One count's lines: what the records said and what was counted. */
  countLines: (countId: string) => ['stock', 'countLines', countId] as const,
  /** The last finished count of one store (the Counts tab's "Last count"). */
  lastCountAt: (location: StockLocation) => ['stock', 'lastCount', location] as const,
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
  // Wave 5, the two stores (wave5-addendum-2026-09-25 §2.8, §5.2).
  byStore: ['stock', 'byStore'] as const,
  transfers: ['stock', 'transfers'] as const,
  transferCount: ['stock', 'transferCount'] as const,
  staffLogs: ['stock', 'staffLogs'] as const,
  needsCost: ['stock', 'needsCost'] as const,
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
  /** The store the movement is at (wave 5); absent on a pre-wave-5 read. */
  location?: string | null;
}

export const LEDGER_PAGE = 50;

/** Who made the movement travels with it — staff are named, never shown as ids. */
export const MOVEMENT_SELECT = 'id, at, movement_type, qty_delta, unit_cost_iqd, reason_code, batch_id, location, staff:staff_id(display_name)';

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
  /** The store the batch is in (report_stock since stock_counts_by_location). */
  location?: string | null;
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
  location?: string;
  source?: string;
}

/**
 * The manager's count in progress at one store, if any. Since wave 5 a count
 * is per store, and a phone count waits beside it as its own row, so this
 * reads the operator's own at that store only (§5.2); `maybeSingle` holds
 * because the server allows one open or waiting count per store.
 */
export async function fetchOpenCount(location: StockLocation): Promise<CountRow | null> {
  const { data, error } = await supabase
    .from('stock_counts')
    .select('id, started_at, finalized_at, location, source')
    .is('finalized_at', null)
    .eq('source', 'operator')
    .eq('location', location)
    .maybeSingle();
  if (error) throw error;
  return data as CountRow | null;
}

/**
 * Every count not applied yet, both stores: the manager's open ones and the
 * phone's waiting ones, oldest first, with who started or sent each. A
 * manager's open count holds deliveries and moves into its store
 * (STORE_BEING_COUNTED); a waiting phone count is the Counts badge.
 */
export async function fetchUnfinishedCounts(): Promise<UnfinishedCount[]> {
  const { data, error } = await supabase
    .from('stock_counts')
    .select('id, location, source, started_at, staff:counted_by(display_name)')
    .is('finalized_at', null)
    .order('started_at');
  if (error) throw error;
  return data as unknown as UnfinishedCount[];
}

export interface CountLineRow {
  ingredient_id: string;
  theoretical_qty: number;
  counted_qty: number;
}

/** One count's lines. An open count's counted_qty is the snapshot until finished; a phone count's is what was counted. */
export async function fetchCountLines(countId: string): Promise<CountLineRow[]> {
  const { data, error } = await supabase.from('stock_count_lines').select('ingredient_id, theoretical_qty, counted_qty').eq('count_id', countId);
  if (error) throw error;
  return data as CountLineRow[];
}

/** The most recently finished count, if any: of the venue, or of one store (wave 5). */
export async function fetchLastCount(location?: StockLocation): Promise<CountRow | null> {
  let q = supabase.from('stock_counts').select('id, started_at, finalized_at').not('finalized_at', 'is', null);
  if (location) q = q.eq('location', location);
  const { data, error } = await q.order('finalized_at', { ascending: false }).limit(1).maybeSingle();
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

// ---------------------------------------------------------------------------
// The two stores (wave5-addendum-2026-09-25 §2.8, §5.2)
// ---------------------------------------------------------------------------

/** What each store holds, one row per ingredient and store (v_stock_by_location, MGMT). */
export async function fetchByStore(): Promise<StoreRow[]> {
  const { data, error } = await supabase.from('v_stock_by_location').select('ingredient_id, location, on_hand').order('ingredient_id');
  if (error) throw error;
  return data as StoreRow[];
}

export interface TransferRow {
  id: string;
  from_location: StockLocation;
  to_location: StockLocation;
  moved_at: string;
  staff: { display_name: string } | null;
  stock_transfer_lines: { ingredient_id: string; qty: number }[];
}

/** How far back Move stock lists the moves. */
export const RECENT_MOVE_DAYS = 30;

/** The moves of the last 30 days, newest first, here and from the waiter's phone. */
export async function fetchTransfers(): Promise<TransferRow[]> {
  const since = new Date(Date.now() - RECENT_MOVE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('stock_transfers')
    .select('id, from_location, to_location, moved_at, staff:moved_by(display_name), stock_transfer_lines(ingredient_id, qty)')
    .gte('moved_at', since)
    .order('moved_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as unknown as TransferRow[];
}

/** How many moves the venue ever recorded: none means Move stock's first-day call-out. */
export async function fetchTransferCount(): Promise<number> {
  const { count, error } = await supabase.from('stock_transfers').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

/** How far back "Added by staff" lists what staff logged; older ones stay while a line needs a cost. */
export const STAFF_LOG_DAYS = 14;

const STAFF_LOG_SELECT = 'id, location, received_at, staff:received_by(display_name), delivery_lines(id, ingredient_id, qty_received, unit_cost_iqd, cost_source, expiry_date)';

/**
 * What staff added on the phone (log_stock: deliveries with source
 * 'staff_log'): the last 14 days whole, and anything older with a line still
 * booked at no cost, which only shows the lines that need one. Read as
 * returned; readStaffLogs (storeLogic.ts) orders and reads it.
 */
export async function fetchStaffLogs(): Promise<unknown[]> {
  const since = new Date(Date.now() - STAFF_LOG_DAYS * 86_400_000).toISOString();
  const recent = supabase
    .from('deliveries')
    .select(STAFF_LOG_SELECT)
    .eq('source', 'staff_log')
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(100);
  const older = supabase
    .from('deliveries')
    .select(STAFF_LOG_SELECT.replace('delivery_lines(', 'delivery_lines!inner('))
    .eq('source', 'staff_log')
    .eq('delivery_lines.cost_source', 'none')
    .lt('received_at', since)
    .order('received_at', { ascending: false })
    .limit(100);
  const [a, b] = await Promise.all([recent, older]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return [...(a.data ?? []), ...(b.data ?? [])];
}

/** Staff-logged lines still booked at no cost (cost_source 'none'): a count, not the rows. */
export async function fetchNeedsCostCount(): Promise<number> {
  const { count, error } = await supabase.from('delivery_lines').select('id', { count: 'exact', head: true }).eq('cost_source', 'none');
  if (error) throw error;
  return count ?? 0;
}
