/**
 * The venue's stores, the cafe, the bakery and (0245) the Touch Shop's own
 * store, and who may do what with them
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8;
 * docs/design/shop/shop-desk-2026-09-27.md).
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
export const STOCK_LOCATIONS = ['cafe', 'bakery', 'shop'] as const;

export type StockLocation = (typeof STOCK_LOCATIONS)[number];

/** `ingredient_kind`: bought, made here (production), or shop stock. */
export type StockKind = 'purchased' | 'prepared' | 'retail';

const LOCATIONS: readonly string[] = STOCK_LOCATIONS;

/** True for a value of the `stock_location` enum this build knows. */
export function isStockLocation(value: unknown): value is StockLocation {
  return typeof value === 'string' && LOCATIONS.includes(value);
}

/**
 * The stores stock moves between (app.transfer_stock): the cafe and the
 * bakery. Nothing moves in or out of the shop store (0245).
 */
export const MOVABLE_STORES: readonly StockLocation[] = ['cafe', 'bakery'];

/** The other movable store: cafe and bakery swap; the shop store has no other. */
export function otherStore(location: StockLocation): StockLocation {
  if (location === 'shop') return 'shop';
  return location === 'cafe' ? 'bakery' : 'cafe';
}

/** Move stock between the stores: app.transfer_stock's guard (MOVE). */
export const MOVE_ROLES: readonly StaffRole[] = ['waiter', 'manager', 'owner'];

/** Add stock to a store: app.log_stock's guard (LOG). */
export const LOG_ROLES: readonly StaffRole[] = ['head_barista', 'head_chef', 'cashier', 'shop_staff', 'manager', 'owner'];

/** Count a store on the phone: app.submit_stock_count's guard (COUNT). */
export const COUNT_ROLES: readonly StaffRole[] = ['head_chef', 'chef', 'shop_staff', 'manager', 'owner'];

/** Read stock by quantity: app.staff_stock_view's guard (STOCK_VIEW). */
export const STOCK_VIEW_ROLES: readonly StaffRole[] = ['head_barista', 'head_chef', 'shop_staff', 'waiter', 'manager', 'owner'];

/** What moves between the stores. Shop stock lives in the shop store only, so it never moves. */
export const MOVE_KINDS: readonly StockKind[] = ['purchased', 'prepared'];

const has = (list: readonly StaffRole[], role: StaffRole | null | undefined): boolean =>
  role != null && list.includes(role);

/**
 * A role's home store (app.staff_home_location): the bakery for the kitchen,
 * the shop store for the shop assistant, the cafe for everyone else. The
 * default store for a log, a count, waste and a product test.
 */
export function homeStore(role: StaffRole | null | undefined): StockLocation {
  if (role === 'head_chef' || role === 'chef') return 'bakery';
  if (role === 'shop_staff') return 'shop';
  return 'cafe';
}

/**
 * What a role may log (app.log_stock). The heads and the cashier log what they
 * buy, the shop assistant the shop's stock, MGMT both. Prepared stock is never
 * logged: it comes from production.
 */
export function logKindsFor(role: StaffRole | null | undefined): readonly StockKind[] {
  if (!has(LOG_ROLES, role)) return [];
  if (role === 'head_barista' || role === 'head_chef' || role === 'cashier') return ['purchased'];
  if (role === 'shop_staff') return ['retail'];
  return ['purchased', 'retail'];
}

/**
 * The stores a role may log into, the default first. Shop stock goes to the
 * shop store only and nothing else goes there (0245); the shop assistant logs
 * nothing else. Pass the kind of the line being logged; without it, the stores
 * the role may use at all.
 */
export function logStoresFor(role: StaffRole | null | undefined, kind?: StockKind): readonly StockLocation[] {
  const kinds = logKindsFor(role);
  if (kinds.length === 0) return [];
  if (kind !== undefined && !kinds.includes(kind)) return [];
  if (kind === 'retail' || role === 'shop_staff') return ['shop'];
  const home = homeStore(role);
  const stores: StockLocation[] = [home, otherStore(home)];
  if (kind === undefined && kinds.includes('retail')) stores.push('shop');
  return stores;
}

/**
 * The stores a role may count (app.submit_stock_count): the kitchen the
 * bakery only, the shop assistant the shop store only, MGMT all three.
 */
export function countStoresFor(role: StaffRole | null | undefined): readonly StockLocation[] {
  if (!has(COUNT_ROLES, role)) return [];
  if (role === 'head_chef' || role === 'chef') return ['bakery'];
  if (role === 'shop_staff') return ['shop'];
  return ['cafe', 'bakery', 'shop'];
}

/** The kinds a store's count lists: the shop store holds shop stock only, and only it does (0245). */
export function countKindsFor(location: StockLocation): readonly StockKind[] {
  return location === 'shop' ? ['retail'] : ['purchased', 'prepared'];
}

/** The kinds a role sees on the stock page (app.staff_stock_view). */
export function stockViewKindsFor(role: StaffRole | null | undefined): readonly StockKind[] {
  if (!has(STOCK_VIEW_ROLES, role)) return [];
  if (role === 'manager' || role === 'owner') return ['purchased', 'prepared', 'retail'];
  if (role === 'shop_staff') return ['retail'];
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
