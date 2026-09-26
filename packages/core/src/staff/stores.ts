/**
 * The venue's two stores, the cafe and the bakery, and who may do what with
 * them (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8).
 *
 * The rules live in the database (the stock_locations … stock_store_reads
 * migrations). This file mirrors them so the operator's Stock pages and the
 * staff phone only offer what the server accepts; the server stays the wall.
 * Each role list mirrors one RPC guard, and
 * packages/db/tests/staff-roles-parity.test.ts holds STOCK_LOCATIONS equal to
 * the `stock_location` enum.
 *
 * Pure: no supabase, no react.
 */
import type { StaffRole } from './roles';

/** Every value of the `stock_location` enum, in the enum's own order. */
export const STOCK_LOCATIONS = ['cafe', 'bakery'] as const;

export type StockLocation = (typeof STOCK_LOCATIONS)[number];

/** `ingredient_kind`: bought, made here (production), or shop stock. */
export type StockKind = 'purchased' | 'prepared' | 'retail';

const LOCATIONS: readonly string[] = STOCK_LOCATIONS;

/** True for a value of the `stock_location` enum this build knows. */
export function isStockLocation(value: unknown): value is StockLocation {
  return typeof value === 'string' && LOCATIONS.includes(value);
}

/** The store that is not this one. */
export function otherStore(location: StockLocation): StockLocation {
  return location === 'cafe' ? 'bakery' : 'cafe';
}

/** Move stock between the stores: app.transfer_stock's guard (MOVE). */
export const MOVE_ROLES: readonly StaffRole[] = ['waiter', 'manager', 'owner'];

/** Add stock to a store: app.log_stock's guard (LOG). */
export const LOG_ROLES: readonly StaffRole[] = ['head_barista', 'head_chef', 'cashier', 'court_desk', 'manager', 'owner'];

/** Count a store on the phone: app.submit_stock_count's guard (COUNT). */
export const COUNT_ROLES: readonly StaffRole[] = ['head_chef', 'chef', 'manager', 'owner'];

/** Read stock by quantity: app.staff_stock_view's guard (STOCK_VIEW). */
export const STOCK_VIEW_ROLES: readonly StaffRole[] = ['head_barista', 'head_chef', 'court_desk', 'waiter', 'manager', 'owner'];

/** What moves between the stores. Shop stock lives in the cafe only, so it never moves. */
export const MOVE_KINDS: readonly StockKind[] = ['purchased', 'prepared'];

const has = (list: readonly StaffRole[], role: StaffRole | null | undefined): boolean =>
  role != null && list.includes(role);

/**
 * A role's home store (app.staff_home_location): the bakery for the kitchen,
 * the cafe for everyone else. The default store for a log, a count, waste and
 * a product test.
 */
export function homeStore(role: StaffRole | null | undefined): StockLocation {
  return role === 'head_chef' || role === 'chef' ? 'bakery' : 'cafe';
}

/**
 * What a role may log (app.log_stock). The heads log what they buy, the desk
 * the shop's stock, the cashier and MGMT both. Prepared stock is never logged:
 * it comes from production.
 */
export function logKindsFor(role: StaffRole | null | undefined): readonly StockKind[] {
  if (!has(LOG_ROLES, role)) return [];
  if (role === 'head_barista' || role === 'head_chef') return ['purchased'];
  if (role === 'court_desk') return ['retail'];
  return ['purchased', 'retail'];
}

/**
 * The stores a role may log into, the default first. Shop stock goes to the
 * cafe only, for everyone (V14), and the desk logs nothing else. Pass the kind
 * of the line being logged; without it, the stores the role may use at all.
 */
export function logStoresFor(role: StaffRole | null | undefined, kind?: StockKind): readonly StockLocation[] {
  const kinds = logKindsFor(role);
  if (kinds.length === 0) return [];
  if (kind !== undefined && !kinds.includes(kind)) return [];
  if (kind === 'retail' || role === 'court_desk') return ['cafe'];
  const home = homeStore(role);
  return [home, otherStore(home)];
}

/** The stores a role may count (app.submit_stock_count): the kitchen the bakery only. */
export function countStoresFor(role: StaffRole | null | undefined): readonly StockLocation[] {
  if (!has(COUNT_ROLES, role)) return [];
  return role === 'head_chef' || role === 'chef' ? ['bakery'] : ['cafe', 'bakery'];
}

/** The kinds a store's count lists: shop stock is counted in the cafe only. */
export function countKindsFor(location: StockLocation): readonly StockKind[] {
  return location === 'cafe' ? ['purchased', 'prepared', 'retail'] : ['purchased', 'prepared'];
}

/** The kinds a role sees on the stock page (app.staff_stock_view). */
export function stockViewKindsFor(role: StaffRole | null | undefined): readonly StockKind[] {
  if (!has(STOCK_VIEW_ROLES, role)) return [];
  if (role === 'manager' || role === 'owner') return ['purchased', 'prepared', 'retail'];
  if (role === 'court_desk') return ['retail'];
  return ['purchased', 'prepared'];
}

/**
 * A line's quantity in the ingredient's base unit, as the server converts it:
 * the base unit as typed, or 'pack' times pack_size, rounded to 3 places.
 * Null when the server would refuse it: no quantity above 0, an unknown unit,
 * or a pack without a pack size.
 */
export function toBaseQty(
  qty: number,
  unit: string | null | undefined,
  ingredient: { unit: string; pack_size: number | null },
): number | null {
  if (!Number.isFinite(qty) || qty <= 0) return null;
  let base = qty;
  if (unit != null && unit !== '' && unit !== ingredient.unit) {
    if (unit !== 'pack' || !(ingredient.pack_size != null && ingredient.pack_size > 0)) return null;
    base = qty * ingredient.pack_size;
  }
  const rounded = Math.round(base * 1000) / 1000;
  return rounded > 0 && rounded < 1_000_000_000 ? rounded : null;
}
