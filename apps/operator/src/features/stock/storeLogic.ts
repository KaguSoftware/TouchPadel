/**
 * The cafe store and the bakery store on the operator's Stock pages
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §2.8, §5.2): pure rules,
 * no React and no network, so the node test beside this file pins what a
 * manager sees.
 *
 * The server is the wall for every rule here (transfer_stock, log_stock,
 * receive_delivery, receive_purchase, start_count, submit_stock_count). These
 * mirror them so a form offers only what will be accepted and says why the
 * rest is held, before the manager types a whole delivery or move.
 */
import { STOCK_LOCATIONS, isStockLocation, otherStore, toBaseQty, type StockLocation } from '@touch/core/staff/stores';

export { STOCK_LOCATIONS, otherStore, type StockLocation };

/** A store off the wire, or null for anything this build does not know. */
export function storeOf(value: unknown): StockLocation | null {
  return isStockLocation(value) ? value : null;
}

// ---------------------------------------------------------------------------
// What each store holds (v_stock_by_location)
// ---------------------------------------------------------------------------

export interface StoreRow {
  ingredient_id: string;
  location: string;
  on_hand: number | string | null;
}

export interface StoreSplit {
  cafe: number;
  bakery: number;
}

/** One split per ingredient from the view's one-row-per-store shape. */
export function splitByStore(rows: readonly StoreRow[]): Map<string, StoreSplit> {
  const out = new Map<string, StoreSplit>();
  for (const r of rows) {
    const store = storeOf(r.location);
    if (!store) continue;
    const split = out.get(r.ingredient_id) ?? { cafe: 0, bakery: 0 };
    split[store] = Number(r.on_hand ?? 0) || 0;
    out.set(r.ingredient_id, split);
  }
  return out;
}

/**
 * Whether On hand prints the split under the venue total. Until the bakery
 * store holds anything, every figure is the cafe store's, and a second line
 * saying so on ninety rows is noise.
 */
export function splitWorthShowing(split: StoreSplit | undefined): boolean {
  return split !== undefined && split.bakery > 0;
}

/** True once any ingredient sits in the bakery store: the store filter earns its place. */
export function anyInBakery(splits: ReadonlyMap<string, StoreSplit>): boolean {
  for (const s of splits.values()) if (s.bakery > 0) return true;
  return false;
}

/** What one store holds of an ingredient (0 when the view has no row for it). */
export function heldAt(split: StoreSplit | undefined, store: StockLocation): number {
  return split ? split[store] : 0;
}

// ---------------------------------------------------------------------------
// Move stock (app.transfer_stock)
// ---------------------------------------------------------------------------

/** One control for the direction, so the two stores can never be the same one. */
export type Direction = 'cafe_to_bakery' | 'bakery_to_cafe';
export const DIRECTIONS: readonly Direction[] = ['cafe_to_bakery', 'bakery_to_cafe'];

export function directionStores(d: Direction): { from: StockLocation; to: StockLocation } {
  return d === 'cafe_to_bakery' ? { from: 'cafe', to: 'bakery' } : { from: 'bakery', to: 'cafe' };
}

export interface MoveLineDraft {
  key: string;
  ingredientId: string;
  qty: string;
  /** The ingredient's own unit, or packs of its pack size. */
  unit: 'base' | 'pack';
}

export interface MoveIngredient {
  id: string;
  unit: string;
  pack_size: number | null;
}

export function isBlankMoveLine(l: MoveLineDraft): boolean {
  return l.ingredientId === '' && l.qty.trim() === '';
}

/** The line's quantity in the base unit, as transfer_stock converts it, or null when it would refuse it. */
export function moveBaseQty(l: MoveLineDraft, ing: MoveIngredient | undefined): number | null {
  if (!ing || l.qty.trim() === '') return null;
  return toBaseQty(Number(l.qty), l.unit === 'pack' ? 'pack' : ing.unit, ing);
}

export type MoveLineProblem = 'ingredient' | 'qty' | 'repeat' | 'short' | null;

/**
 * What holds a started line, first problem only. `short` is the server's
 * TRANSFER_SHORT said early: the source store's batches hold less than the
 * line, and a move never makes stock from nothing.
 */
export function moveLineProblem(
  l: MoveLineDraft,
  ing: MoveIngredient | undefined,
  ctx: { onHandAtSource: number; repeated: boolean },
): MoveLineProblem {
  if (isBlankMoveLine(l)) return null;
  if (!l.ingredientId || !ing) return 'ingredient';
  if (ctx.repeated) return 'repeat';
  const qty = moveBaseQty(l, ing);
  if (qty === null) return 'qty';
  if (qty > ctx.onHandAtSource) return 'short';
  return null;
}

/** transfer_stock's p_lines: base-unit lines carry no unit, pack lines say 'pack'. */
export function movePayload(lines: readonly MoveLineDraft[]): { ingredient_id: string; qty: number; unit?: 'pack' }[] {
  return lines
    .filter((l) => !isBlankMoveLine(l))
    .map((l) => (l.unit === 'pack' ? { ingredient_id: l.ingredientId, qty: Number(l.qty), unit: 'pack' as const } : { ingredient_id: l.ingredientId, qty: Number(l.qty) }));
}

/** Ingredients picked on more than one line: transfer_stock takes each once. */
export function repeatedIngredients(lines: readonly MoveLineDraft[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const l of lines) {
    if (!l.ingredientId) continue;
    if (seen.has(l.ingredientId)) twice.add(l.ingredientId);
    seen.add(l.ingredientId);
  }
  return twice;
}

/** TRANSFER_SHORT's detail is what the source store shows; a number, or null when it is not one. */
export function shortShows(detail: string | undefined): number | null {
  if (detail === undefined || detail.trim() === '') return null;
  const n = Number(detail);
  return Number.isFinite(n) ? n : null;
}

/** The Move stock page's first-day call-out: no move was ever recorded at the venue (§7.4, Q25). */
export function isFirstMoveDay(transferCount: number | undefined): boolean {
  return transferCount === 0;
}

// ---------------------------------------------------------------------------
// Adding stock: Goods in, the driver's purchases (V14, M5)
// ---------------------------------------------------------------------------

/** Shop (retail) stock lives in the cafe store only, so the bakery store is off while one is on the form. */
export function bakeryRefused(kinds: readonly (string | null | undefined)[]): boolean {
  return kinds.includes('retail');
}

export interface UnfinishedCount {
  id: string;
  location: string;
  source: string;
  started_at: string;
  staff?: { display_name: string } | null;
}

/**
 * A manager's count open at the store: receipts and moves into it are refused
 * (STORE_BEING_COUNTED) until it is finished or discarded. A phone count that
 * waits does not hold them.
 */
export function beingCounted(counts: readonly UnfinishedCount[] | undefined, store: StockLocation): boolean {
  return (counts ?? []).some((c) => c.source === 'operator' && c.location === store);
}

// ---------------------------------------------------------------------------
// Counts by store
// ---------------------------------------------------------------------------

/** Phone counts waiting for a manager, oldest first (the server returns them so). */
export function phoneCountsWaiting(counts: readonly UnfinishedCount[] | undefined): UnfinishedCount[] {
  return (counts ?? []).filter((c) => c.source === 'phone');
}

/** A count of the store is open or waiting: start_count refuses COUNT_IN_PROGRESS. */
export function phoneCountWaitingAt(counts: readonly UnfinishedCount[] | undefined, store: StockLocation): UnfinishedCount | null {
  return phoneCountsWaiting(counts).find((c) => c.location === store) ?? null;
}

/**
 * A phone count line's difference from what the records said when it was
 * sent. Blind on the phone; shown here because a manager decides whether to
 * apply it. Rounded to the 3 places the count lines store.
 */
export function countDifference(counted: number, theoretical: number): number {
  return Math.round((Number(counted) - Number(theoretical)) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Added by staff (log_stock's deliveries; price_logged_stock)
// ---------------------------------------------------------------------------

export const COST_SOURCES = ['none', 'last_batch', 'pack', 'entered'] as const;
export type CostSource = (typeof COST_SOURCES)[number];

export interface StaffLogLine {
  id: string;
  ingredient_id: string;
  qty_received: number;
  unit_cost_iqd: number;
  cost_source: CostSource;
  expiry_date: string | null;
}

export interface StaffLog {
  id: string;
  location: StockLocation;
  received_at: string;
  staffName: string | null;
  lines: StaffLogLine[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function costSourceOf(v: unknown): CostSource {
  return (COST_SOURCES as readonly unknown[]).includes(v) ? (v as CostSource) : 'entered';
}

/**
 * The deliveries a staff member logged, read defensively and ordered the way
 * the card lists them: any log with a line still needing a cost first, then
 * newest first. Duplicates (the two reads can meet) keep the first.
 */
export function readStaffLogs(rows: readonly unknown[]): StaffLog[] {
  const seen = new Set<string>();
  const logs: StaffLog[] = [];
  for (const r of rows) {
    if (!isObject(r) || typeof r.id !== 'string' || seen.has(r.id)) continue;
    seen.add(r.id);
    const staff = isObject(r.staff) ? r.staff : null;
    logs.push({
      id: r.id,
      location: storeOf(r.location) ?? 'cafe',
      received_at: typeof r.received_at === 'string' ? r.received_at : '',
      staffName: staff && typeof staff.display_name === 'string' ? staff.display_name : null,
      lines: (Array.isArray(r.delivery_lines) ? r.delivery_lines : [])
        .filter((l): l is Record<string, unknown> => isObject(l) && typeof l.id === 'string' && typeof l.ingredient_id === 'string')
        .map((l) => ({
          id: l.id as string,
          ingredient_id: l.ingredient_id as string,
          qty_received: Number(l.qty_received) || 0,
          unit_cost_iqd: Number(l.unit_cost_iqd) || 0,
          cost_source: costSourceOf(l.cost_source),
          expiry_date: typeof l.expiry_date === 'string' ? l.expiry_date : null,
        })),
    });
  }
  const needs = (l: StaffLog) => (l.lines.some((x) => x.cost_source === 'none') ? 0 : 1);
  return logs.sort((a, b) => needs(a) - needs(b) || b.received_at.localeCompare(a.received_at));
}

/** Lines still booked with no cost (cost_source 'none'): Setup and On hand nag about these. */
export function linesNeedingCost(logs: readonly StaffLog[]): number {
  return logs.reduce((n, l) => n + l.lines.filter((x) => x.cost_source === 'none').length, 0);
}

export function logNeedsCost(log: StaffLog): boolean {
  return log.lines.some((l) => l.cost_source === 'none');
}

/**
 * The cost per base unit price_logged_stock takes, from what the manager
 * typed: per base unit as typed, or a pack's price over its size. Rounded to
 * the 4 places the batch table stores. Null when the server would refuse it
 * (below 0, 1e9 or more, not a number, or a pack with no size).
 */
export function costPerBaseUnit(typed: string, per: 'unit' | 'pack', packSize: number | null): number | null {
  if (typed.trim() === '') return null;
  const n = Number(typed);
  if (!Number.isFinite(n) || n < 0) return null;
  let cost = n;
  if (per === 'pack') {
    if (!(packSize !== null && packSize > 0)) return null;
    cost = n / packSize;
  }
  const rounded = Math.round(cost * 10_000) / 10_000;
  return rounded < 1_000_000_000 ? rounded : null;
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/** Every movement type the ledger names in words, in the order the enum grew. */
export const MOVEMENT_TYPES = [
  'goods_in',
  'production_in',
  'sale_consumption',
  'production_consume',
  'waste_spill',
  'waste_spoilage',
  'void_after_send',
  'expired_writeoff',
  'count_adjustment',
  'refund_reversal',
  // A new item's test servings (product_release): the note is the run.
  'product_test',
  // stock_transfer_movement (wave 5): one half of a move between the stores.
  'transfer',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export function isMovementType(v: string): v is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(v);
}

/**
 * Where the other half of a move went. A move writes a minus at the store it
 * left and a plus at the store it went into, and there are two stores, so the
 * row's own store and sign say it: the ledger prints "To the bakery store"
 * rather than `transfer:<id>`.
 */
export function transferNote(qtyDelta: number, location: unknown): { dir: 'to' | 'from'; store: StockLocation } | null {
  const here = storeOf(location);
  if (!here || Number(qtyDelta) === 0) return null;
  return Number(qtyDelta) < 0 ? { dir: 'to', store: otherStore(here) } : { dir: 'from', store: otherStore(here) };
}
