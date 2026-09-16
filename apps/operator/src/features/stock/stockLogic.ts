/**
 * Pure rules the stock screens share. No React, no network — so the tests pin
 * the behaviour a manager sees without rendering a screen.
 */
import type { OnHandRow } from './stockKeys';

// ---------------------------------------------------------------------------
// On hand
// ---------------------------------------------------------------------------

/** At or under the reorder point (the ingredient's low-stock threshold). */
export function isLow(r: Pick<OnHandRow, 'on_hand' | 'low_stock_threshold'>): boolean {
  return r.low_stock_threshold !== null && r.on_hand <= r.low_stock_threshold;
}

/** Under the amount the venue likes to keep. */
export function isBelowPar(r: Pick<OnHandRow, 'on_hand' | 'par_level'>): boolean {
  return r.par_level !== null && r.on_hand < r.par_level;
}

/**
 * The ledger total and the shelf disagree. `on_hand` sums the live batches and
 * can never go below zero; `theoretical` sums every movement, including a sale
 * that drew more than the batches held. The two only part when stock was sold
 * past what was on record, and only a count puts them back together.
 */
export function needsCount(r: Pick<OnHandRow, 'on_hand' | 'theoretical'>): boolean {
  return Number(r.on_hand) !== Number(r.theoretical);
}

export type OnHandStatus = 'low' | 'belowPar' | 'countNeeded' | 'ok';

/** One status per row, worst first: a row that is low is also below par. */
export function onHandStatus(r: OnHandRow): OnHandStatus {
  if (isLow(r)) return 'low';
  if (needsCount(r)) return 'countNeeded';
  if (isBelowPar(r)) return 'belowPar';
  return 'ok';
}

export type OnHandFilter = 'all' | 'low' | 'belowPar' | 'countNeeded';

/**
 * `?filter=` values On hand accepts. The Today screen links `low` and
 * `belowPar`; anything unknown opens the full list rather than an empty one.
 */
export function parseOnHandFilter(value: unknown): OnHandFilter {
  return value === 'low' || value === 'belowPar' || value === 'countNeeded' ? value : 'all';
}

export function matchesOnHandFilter(r: OnHandRow, filter: OnHandFilter): boolean {
  switch (filter) {
    case 'low':
      return isLow(r);
    case 'belowPar':
      return isBelowPar(r);
    case 'countNeeded':
      return needsCount(r);
    default:
      return true;
  }
}

/** Case-insensitive match on either name — staff search in whichever language they think in. */
export function matchesName(r: { name_en: string; name_ar: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || r.name_en.toLowerCase().includes(q) || r.name_ar.includes(query.trim());
}

// ---------------------------------------------------------------------------
// Goods in
// ---------------------------------------------------------------------------

export interface DeliveryLineDraft {
  ingredientId: string;
  qtyExpected: string;
  qtyReceived: string;
  unitCostIqd: string;
  expiryDate: string;
}

/** A number the user typed, or null when the box is empty or not a number. */
export function parseQty(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The line has nothing typed into it yet — it is skipped, not an error. */
export function isBlankLine(l: DeliveryLineDraft): boolean {
  return !l.ingredientId && l.qtyExpected.trim() === '' && l.qtyReceived.trim() === '' && l.unitCostIqd.trim() === '' && !l.expiryDate;
}

export type LineProblem = 'ingredient' | 'received' | 'cost' | 'ordered' | null;

/**
 * What is missing from a started line, first problem only. The old screen
 * dropped half-filled lines silently when the delivery was recorded, so a
 * line with no cost simply never reached stock.
 */
export function lineProblem(l: DeliveryLineDraft): LineProblem {
  if (isBlankLine(l)) return null;
  if (!l.ingredientId) return 'ingredient';
  const received = parseQty(l.qtyReceived);
  if (received === null || received <= 0) return 'received';
  const cost = parseQty(l.unitCostIqd);
  if (cost === null || cost < 0) return 'cost';
  const expected = parseQty(l.qtyExpected);
  if (l.qtyExpected.trim() !== '' && (expected === null || expected < 0)) return 'ordered';
  return null;
}

/** Received below what was ordered. */
export function isShort(l: Pick<DeliveryLineDraft, 'qtyExpected' | 'qtyReceived'>): boolean {
  const expected = parseQty(l.qtyExpected);
  const received = parseQty(l.qtyReceived);
  return expected !== null && received !== null && received < expected;
}

/**
 * The cost of one base unit from the ingredient's pack price, to prefill the
 * cost box. Staff read pack prices off an invoice, not prices per gram.
 * Rounded to 4 places, the precision the batch table stores.
 */
export function unitCostFromPack(packSize: number | null, packCostIqd: number | null): number | null {
  if (packSize === null || packCostIqd === null || packSize <= 0) return null;
  return Math.round((packCostIqd / packSize) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Counts and alerts
// ---------------------------------------------------------------------------

/** What a count entry box holds: nothing yet, a usable number, or a typo. */
export function countEntryState(v: string | undefined): 'blank' | 'ok' | 'invalid' {
  if (v === undefined || v.trim() === '') return 'blank';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? 'ok' : 'invalid';
}

export type AlertKind = 'low_stock' | 'negative_stock' | 'expiring_soon' | 'expired' | 'replay_conflict';

/**
 * The server raises one `expiring_soon` kind for both batches about to expire
 * and batches already past it (payload `expired`). Staff act on those
 * differently, so the screen splits them.
 */
export function alertKind(kind: string, payload: { expired?: unknown }): AlertKind | null {
  if (kind === 'expiring_soon') return payload.expired === true ? 'expired' : 'expiring_soon';
  if (kind === 'low_stock' || kind === 'negative_stock' || kind === 'replay_conflict') return kind;
  return null;
}

/** Order the alert groups by what hurts most if ignored. */
export const ALERT_ORDER: readonly AlertKind[] = ['negative_stock', 'expired', 'low_stock', 'expiring_soon', 'replay_conflict'];

// ---------------------------------------------------------------------------
// Margins
// ---------------------------------------------------------------------------

/** Below this gross margin a menu item is flagged as thin. */
export const THIN_MARGIN_PERCENT = 30;

export type MarginFlag = 'loss' | 'thin' | null;

export function marginFlag(r: { margin_iqd: number; margin_percent: number | null }): MarginFlag {
  if (r.margin_iqd < 0) return 'loss';
  if (r.margin_percent !== null && r.margin_percent < THIN_MARGIN_PERCENT) return 'thin';
  return null;
}
