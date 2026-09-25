/**
 * Stock on the staff phone (build-contracts-2026-09-23 §2.24.5, plan #68):
 * quantities only, never a cost, a price or a supplier. The head barista and
 * the head chef read the cafe's stock (bought-in and made-here ingredients),
 * the court desk the Touch Shop's, the manager and the owner all three.
 * Counting, waste and adjustments stay with management on the operator
 * (logging stock is parked, §0 P5).
 *
 * PURE (vitest): no react-native, no supabase.
 */
import type { StaffRole } from '@touch/core';
import type { StockUnit } from '../supplies/production';

export const STOCK_KINDS = ['purchased', 'prepared', 'retail'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export type StockFilter = 'all' | StockKind;

/** Who reads stock (the server's guard, §2.24.5). */
export const STOCK_ROLES: readonly StaffRole[] = [
  'head_barista',
  'head_chef',
  'court_desk',
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
