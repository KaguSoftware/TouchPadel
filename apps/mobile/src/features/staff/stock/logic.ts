/**
 * Stock on the staff phone (build-contracts-2026-09-23 §2.24.5, plan #68):
 * quantities only, never a cost, a price or a supplier. The head barista, the
 * head chef and the waiter read the bought-in and made-here stock, the court
 * desk the Touch Shop's, the manager and the owner all three.
 *
 * Wave 5 (wave5-addendum-2026-09-25 §2.8.5, §5.3): the venue has two stores,
 * the cafe and the bakery. Each row carries `by_location`, and the page reads
 * one store at a time (`byStore`). The waiter joins the readers, so Hasan sees
 * what he moves. Adding, moving and counting are their own pages
 * (features/staff/stores).
 *
 * PURE (vitest): no react-native, no supabase.
 */
import type { StaffRole } from '@touch/core';
import type { StockLocation } from '@touch/core/staff/stores';
import type { StockUnit } from '../supplies/production';

export const STOCK_KINDS = ['purchased', 'prepared', 'retail'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export type StockFilter = 'all' | StockKind;

/** Who reads stock (the server's guard, §2.24.5; the waiter joins in wave 5, STOCK_VIEW). */
export const STOCK_ROLES: readonly StaffRole[] = [
  'head_barista',
  'head_chef',
  'court_desk',
  'waiter',
  'manager',
  'owner',
];

/** The kinds a role sees, as `staff_stock_view` decides them. */
export function stockKindsFor(role: StaffRole): readonly StockKind[] {
  switch (role) {
    case 'manager':
    case 'owner':
      return STOCK_KINDS;
    case 'head_barista':
    case 'head_chef':
    case 'waiter':
      return ['purchased', 'prepared'];
    case 'court_desk':
      return ['retail'];
    default:
      return [];
  }
}

/** The filter chips a role gets: none for a single kind, else "All" and each kind. */
export function stockFilters(role: StaffRole): StockFilter[] {
  const kinds = stockKindsFor(role);
  return kinds.length > 1 ? ['all', ...kinds] : [];
}

/** `p_kind` for a filter: null asks for every kind the caller may see. */
export function stockKindArg(filter: StockFilter): StockKind | null {
  return filter === 'all' ? null : filter;
}

/** The shop product and size a retail ingredient backs. */
export interface StockProduct {
  menu_item_id: string;
  name_en: string;
  name_ar: string;
  size_name_en: string | null;
  size_name_ar: string | null;
}

/** One row of `staff_stock_view`. */
export interface StockItem {
  ingredient_id: string;
  kind: StockKind;
  name_en: string;
  name_ar: string;
  unit: StockUnit;
  pack_size: number | null;
  on_hand: number;
  par_level: number | null;
  low_stock_threshold: number | null;
  low: boolean;
  below_par: boolean;
  next_expiry: string | null;
  product: StockProduct | null;
  /**
   * `on_hand` split by store (wave 5, 0204); the two sum to `on_hand`. Absent
   * from a server older than the stores, when the page shows one list.
   */
  by_location?: Record<StockLocation, number>;
}

export interface StockView {
  as_of: string;
  items: StockItem[];
}

export type StockState = 'out' | 'low' | 'belowPar' | 'ok';

/** The one word a row carries: out of stock, running low, below par, or nothing to say. */
export function stockState(item: Pick<StockItem, 'on_hand' | 'low' | 'below_par'>): StockState {
  if (item.on_hand <= 0) return 'out';
  if (item.low) return 'low';
  if (item.below_par) return 'belowPar';
  return 'ok';
}

/** Rows whose name (either language) or shop product matches the typed text. */
export function filterStock(items: readonly StockItem[], query: string): StockItem[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...items];
  return items.filter((i) =>
    [i.name_en, i.name_ar, i.product?.name_en, i.product?.name_ar]
      .filter((s): s is string => typeof s === 'string')
      .some((s) => s.toLocaleLowerCase().includes(q)),
  );
}

// ── By store (wave 5) ────────────────────────────────────────────────────────

/**
 * Whether the page splits by store for this role: every reader of bought-in
 * or made-here stock. The desk reads shop stock only, which is kept in the
 * cafe only (V14), so it gets its one list and no tabs.
 */
export function showsStores(role: StaffRole): boolean {
  return stockKindsFor(role).some((k) => k !== 'retail');
}

/** One row as one store sees it: what is here, and what the other store holds. */
export interface StoreRow {
  item: StockItem;
  here: number;
  other: number;
}

/**
 * The rows for one store: what is in it first, in the server's order (low
 * first, then by name), then the items it has none of, which the other store
 * may hold. Null when the server sent no split (an older server), so the page
 * keeps its one list.
 */
export function byStore(
  items: readonly StockItem[],
  store: StockLocation,
): { here: StoreRow[]; notHere: StoreRow[] } | null {
  if (items.length > 0 && items.some((i) => !i.by_location)) return null;
  const other: StockLocation = store === 'cafe' ? 'bakery' : 'cafe';
  const rows = items.map((item) => ({
    item,
    here: item.by_location?.[store] ?? 0,
    other: item.by_location?.[other] ?? 0,
  }));
  return { here: rows.filter((r) => r.here > 0), notHere: rows.filter((r) => r.here <= 0) };
}
