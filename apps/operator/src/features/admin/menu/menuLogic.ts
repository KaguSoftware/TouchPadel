/**
 * Pure helpers for the menu editor (no React, no Supabase) so the arithmetic
 * and list rules are unit-testable without jsdom.
 */

export type MarginBand = 'good' | 'ok' | 'bad' | 'noCost';

/** Integer margin percent `(price − cost) / price`; null when unknown or price ≤ 0. */
export function marginPct(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (cost === null || cost === undefined) return null;
  if (price === null || price === undefined || price <= 0) return null;
  return Math.round(((price - cost) / price) * 100);
}

/** Colour band for the margin chip: ≥ 60 % good, ≥ 35 % ok, else bad. */
export function marginBand(pct: number | null): MarginBand {
  if (pct === null) return 'noCost';
  if (pct >= 60) return 'good';
  if (pct >= 35) return 'ok';
  return 'bad';
}

export interface PricedVariant {
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}

/** Price of the default variant (falls back to the first by sort order). */
export function defaultPrice(variants: readonly PricedVariant[]): number | null {
  if (variants.length === 0) return null;
  const chosen =
    variants.find((v) => v.is_default) ??
    [...variants].sort((a, b) => a.sort_order - b.sort_order)[0];
  return chosen ? chosen.price_iqd : null;
}

export interface Named {
  name_en: string;
  name_ar: string;
}

/** Case-insensitive substring match across both names; blank query matches all. */
export function matchesSearch(row: Named, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return row.name_en.toLowerCase().includes(q) || row.name_ar.toLowerCase().includes(q);
}

export interface Sortable {
  id: string;
  sort_order: number;
  name_en: string;
}

/** Deterministic display order: sort_order, then English name, then id. */
export function sortRows<T extends Sortable>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.name_en.localeCompare(b.name_en) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The COMPLETE id order after moving the row at `index` one step in
 * `direction`; empty when the move is not possible (already at an edge).
 *
 * Replaces the old `reorderPlan`, which returned a sparse list of
 * {id, sort_order} writes that the client then applied one row at a time
 * through `upsert_menu_item` / `upsert_menu_category` — re-sending each ENTIRE
 * row rebuilt from the local cache. If a colleague had edited an item since
 * this client last fetched, an up-arrow silently reverted their edit
 * (docs/design/operator-audit-2026-08-28.md H3).
 *
 * `app.reorder_menu_items` / `app.reorder_menu_categories` take this list and
 * assign sort_order = position in one statement, touching no other column.
 */
export function reorderedIds<T extends Sortable>(
  rows: readonly T[],
  index: number,
  direction: 'up' | 'down',
): string[] {
  const ordered = sortRows(rows);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= ordered.length || target < 0 || target >= ordered.length) return [];
  const next = [...ordered];
  next[index] = ordered[target]!;
  next[target] = ordered[index]!;
  return next.map((row) => row.id);
}

export const HOOK_MAX = 60;
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 400;

export type HookError = 'pair' | 'length' | null;

/** Hooks must be given in both languages or neither, each ≤ HOOK_MAX. */
export function hookError(hookEn: string, hookAr: string): HookError {
  const en = hookEn.trim();
  const ar = hookAr.trim();
  if ((en === '') !== (ar === '')) return 'pair';
  if (en.length > HOOK_MAX || ar.length > HOOK_MAX) return 'length';
  return null;
}

/** ISO date (YYYY-MM-DD) of the day after `isoDate`, in UTC arithmetic. */
export function nextDayIso(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Number of active items that have no cost row. */
export function countWithoutCost(
  items: readonly { id: string; is_active: boolean }[],
  costs: ReadonlyMap<string, number>,
): number {
  return items.filter((i) => lacksCost(i, costs)).length;
}

/** Whether an item counts as "without a cost": active and no cost row (unknown, never 0). */
export function lacksCost(item: { id: string; is_active: boolean }, costs: ReadonlyMap<string, number>): boolean {
  return item.is_active && !costs.has(item.id);
}

export type ItemListMode = 'category' | 'search' | 'noCost';

export interface ListableItem extends Sortable, Named {
  category_id: string;
  is_active: boolean;
}

/**
 * The rows the item list shows, and whether they can be reordered.
 *
 * Reordering is a within-one-category operation, so it is only offered on the
 * plain category view. A search looks through EVERY category (searching from
 * the wrong category used to find nothing and print "1 of 1"), and the
 * "without a cost" view gathers items from every category too; both show the
 * category name on each row and turn the arrows off. The cost filter narrows
 * first, then the search within it.
 */
export function itemListView<T extends ListableItem>(
  items: readonly T[],
  opts: {
    categoryId: string | null;
    search: string;
    noCostOnly: boolean;
    costs: ReadonlyMap<string, number>;
    /** Category id → its position in the category list, so mixed rows keep the menu's order. */
    categoryRank: ReadonlyMap<string, number>;
  },
): { rows: T[]; mode: ItemListMode; reorderable: boolean } {
  const searching = opts.search.trim() !== '';
  if (opts.noCostOnly) {
    const rows = items.filter((i) => lacksCost(i, opts.costs) && matchesSearch(i, opts.search));
    return { rows: sortAcrossCategories(rows, opts.categoryRank), mode: 'noCost', reorderable: false };
  }
  if (searching) {
    const rows = items.filter((i) => matchesSearch(i, opts.search));
    return { rows: sortAcrossCategories(rows, opts.categoryRank), mode: 'search', reorderable: false };
  }
  return { rows: sortRows(items.filter((i) => i.category_id === opts.categoryId)), mode: 'category', reorderable: true };
}

/** Rows from several categories: grouped by category, then the category's own order. */
function sortAcrossCategories<T extends ListableItem>(rows: readonly T[], rank: ReadonlyMap<string, number>): T[] {
  const r = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort(
    (a, b) =>
      r(a.category_id) - r(b.category_id) ||
      a.sort_order - b.sort_order ||
      a.name_en.localeCompare(b.name_en) ||
      a.id.localeCompare(b.id),
  );
}

/** The sort_order that puts a NEW row at the end of `rows`. */
export function nextSortOrder(rows: readonly { sort_order: number }[]): number {
  return rows.length === 0 ? 0 : Math.max(...rows.map((r) => r.sort_order)) + 1;
}

export type OrderableState = 'orderable' | 'inactive' | 'soldOut' | 'offToday' | 'blocked';

/**
 * Can a guest order this item right now, and if not, the first reason. Same
 * precedence as the server's `menu_item_availability`: the item's own switches
 * explain the greying before stock does. `offToday` reads the flag against the
 * station date, exactly as the item list's badge does.
 */
export function orderableState(
  item: { is_active: boolean; sold_out: boolean; unavailable_on: string | null },
  todayIso: string,
  blockedByStock: boolean,
): OrderableState {
  if (!item.is_active) return 'inactive';
  if (item.sold_out) return 'soldOut';
  if (item.unavailable_on === todayIso) return 'offToday';
  if (blockedByStock) return 'blocked';
  return 'orderable';
}

/* ---------- product release and the manager locks (build-contracts-2026-09-23 §2.9, §2.13, §5.5) ---------- */

export type CategoryKind = 'cafe' | 'shop';

/** Run statuses after which a released item is an ordinary menu item. */
const RELEASE_OVER: readonly string[] = ['live', 'done'];

export interface ReleaseState {
  is_active: boolean;
  launched_at: string | null;
  release_run_id: string | null;
  release_run: { status: string } | null;
}

/**
 * Still in its product release: the run is neither live nor done. The server
 * then refuses a price change, a new size and the switch-on for everyone, the
 * owner included (ITEM_IN_RELEASE): the price step sets the prices and the
 * owner's Launch puts it on sale. A run this station cannot read counts as
 * unfinished; the server is the wall either way.
 */
export function inRelease(item: ReleaseState): boolean {
  return item.release_run_id !== null && !RELEASE_OVER.includes(item.release_run?.status ?? '');
}

/**
 * Not a draft: on sale once, or on sale now. The server's size lock reads the
 * same test (`launched_at is not null or is_active`), and every item that
 * existed when product_release landed counts as launched.
 */
export function everOnSale(item: Pick<ReleaseState, 'is_active' | 'launched_at'>): boolean {
  return item.launched_at !== null || item.is_active;
}

/** Why the sizes are read-only: the release sets them, or a price change does. */
export type PricesLock = 'inRelease' | 'onSale';
/** Why the Active switch cannot be switched on from this form. */
export type SwitchLock = 'inRelease' | 'ownerLaunches' | 'putOnSale' | 'savedHidden';

export interface ItemLocks {
  prices: PricesLock | null;
  switchOn: SwitchLock | null;
}

/**
 * What the item form locks, and why, mirroring upsert_menu_item and
 * upsert_variant; `item` null is a new item in a category of `kind`.
 *  - In release: prices and the switch, for everyone.
 *  - On sale, without editLaunchedPrices: prices, which change through a
 *    price change. The switch works as before, so a launched item a manager
 *    switched off is switched back on as today.
 *  - A draft, without launchDirectly: prices stay editable (the draft
 *    exception). A café draft goes on sale when the owner launches it, a shop
 *    draft through Put on sale (a shop_launch change), and a new shop product
 *    is saved hidden. A new café item never opens the form: its button is
 *    "Propose a new item" (newItemMode).
 */
export function itemLocks(
  item: ReleaseState | null,
  kind: CategoryKind,
  caps: { editLaunchedPrices: boolean; launchDirectly: boolean },
): ItemLocks {
  if (item === null) {
    if (caps.launchDirectly) return { prices: null, switchOn: null };
    return { prices: null, switchOn: kind === 'shop' ? 'savedHidden' : 'ownerLaunches' };
  }
  if (inRelease(item)) return { prices: 'inRelease', switchOn: 'inRelease' };
  if (everOnSale(item)) return { prices: caps.editLaunchedPrices ? null : 'onSale', switchOn: null };
  if (caps.launchDirectly) return { prices: null, switchOn: null };
  return { prices: null, switchOn: kind === 'shop' ? 'putOnSale' : 'ownerLaunches' };
}

/**
 * The page's add button. Without launchDirectly a new café item starts as a
 * product release (ITEM_VIA_RELEASE, #52); a shop product is still created
 * here, saved hidden.
 */
export function newItemMode(kind: CategoryKind | undefined, launchDirectly: boolean): 'create' | 'propose' {
  return !launchDirectly && kind === 'cafe' ? 'propose' : 'create';
}

/** A run title as its starter typed it: staff may type one language, so fall back to the other. */
export function runTitle(
  locale: 'en' | 'ar',
  run: { title_en: string | null; title_ar: string | null } | null,
): string | null {
  if (!run) return null;
  const en = run.title_en?.trim() || null;
  const ar = run.title_ar?.trim() || null;
  return locale === 'ar' ? (ar ?? en) : (en ?? ar);
}
