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

export interface SortUpdate {
  id: string;
  sort_order: number;
}

/**
 * Plan the writes for moving the row at `index` one step in `direction`.
 * When neighbouring sort orders are distinct the two rows simply swap values
 * (two writes). When the list has ties (fresh menus are all `0`) a swap would
 * be a no-op, so every row is renumbered to its new position instead.
 */
export function reorderPlan<T extends Sortable>(
  rows: readonly T[],
  index: number,
  direction: 'up' | 'down',
): SortUpdate[] {
  const ordered = sortRows(rows);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= ordered.length || target < 0 || target >= ordered.length) return [];
  const a = ordered[index]!;
  const b = ordered[target]!;
  const strictlyIncreasing = ordered.every(
    (row, i) => i === 0 || ordered[i - 1]!.sort_order < row.sort_order,
  );
  if (strictlyIncreasing) {
    return [
      { id: a.id, sort_order: b.sort_order },
      { id: b.id, sort_order: a.sort_order },
    ];
  }
  const next = [...ordered];
  next[index] = b;
  next[target] = a;
  return next
    .map((row, i) => ({ id: row.id, sort_order: i }))
    .filter((u) => ordered.find((r) => r.id === u.id)!.sort_order !== u.sort_order);
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
  return items.filter((i) => i.is_active && !costs.has(i.id)).length;
}
