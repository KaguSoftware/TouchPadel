/**
 * Pure rules the stock screens share. No React, no network — so the tests pin
 * the behaviour a manager sees without rendering a screen.
 */
import type { OnHandRow } from './stockKeys';

// ---------------------------------------------------------------------------
// On hand
// ---------------------------------------------------------------------------

/**
 * Nothing left on the shelf. Worse than low, and true whether or not the
 * ingredient has a reorder point — "none" is not a threshold question.
 */
export function isOut(r: Pick<OnHandRow, 'on_hand'>): boolean {
  return Number(r.on_hand) <= 0;
}

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

export type StockLevel = 'out' | 'low' | 'belowPar' | 'ok';

/**
 * How much is left, as ONE rung of a ladder. The three predicates above all
 * fire together on an empty shelf — nothing is out without also being low and
 * below par — so anything that counts rows has to ask this, not the
 * predicates, or the same ingredient is reported two or three times over
 * ("54 out of stock" beside "49 below par", all of them the same shelves).
 */
export function stockLevel(r: OnHandRow): StockLevel {
  if (isOut(r)) return 'out';
  if (isLow(r)) return 'low';
  if (isBelowPar(r)) return 'belowPar';
  return 'ok';
}

export type OnHandStatus = StockLevel | 'countNeeded';

/**
 * The single status a row wears. How much is left comes first; "count needed"
 * is a different question (the shelf and the ledger disagree), so it only
 * takes the badge when the amount itself is fine. On a row that is out or low
 * the table prints the recorded figure beside the badge instead, which is
 * where that signal belongs — a row sold past its records is almost always at
 * zero, so ranking "count needed" above "out of stock" would hide the empty
 * shelf behind a bookkeeping note.
 */
export function onHandStatus(r: OnHandRow): OnHandStatus {
  const level = stockLevel(r);
  if (level !== 'ok') return level;
  return needsCount(r) ? 'countNeeded' : 'ok';
}

export type OnHandFilter = 'all' | 'out' | 'low' | 'belowPar' | 'countNeeded';

/**
 * `?filter=` values On hand accepts. The Today screen links `low` and
 * `belowPar`; anything unknown opens the full list rather than an empty one.
 */
export function parseOnHandFilter(value: unknown): OnHandFilter {
  return value === 'out' || value === 'low' || value === 'belowPar' || value === 'countNeeded' ? value : 'all';
}

/**
 * The rows behind a count on the "Needs attention" list. The three level
 * filters are exclusive, so every row is shown by exactly one of them and the
 * counts add up; `countNeeded` cuts across them and can name a row the level
 * filters put elsewhere.
 */
export function matchesOnHandFilter(r: OnHandRow, filter: OnHandFilter): boolean {
  switch (filter) {
    case 'out':
    case 'low':
    case 'belowPar':
      return stockLevel(r) === filter;
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

export type LineProblem = 'ingredient' | 'received' | 'cost' | 'ordered' | 'expiry' | null;

/**
 * What is missing from a started line, first problem only. The old screen
 * dropped half-filled lines silently when the delivery was recorded, so a
 * line with no cost simply never reached stock.
 *
 * `today` is the venue's calendar date (YYYY-MM-DD), compared as a string
 * because both sides are plain dates — a batch that expires today is still
 * good today, one that expired yesterday cannot be put on the shelf.
 */
export function lineProblem(l: DeliveryLineDraft, today: string): LineProblem {
  if (isBlankLine(l)) return null;
  if (!l.ingredientId) return 'ingredient';
  const received = parseQty(l.qtyReceived);
  if (received === null || received <= 0) return 'received';
  const cost = parseQty(l.unitCostIqd);
  if (cost === null || cost < 0) return 'cost';
  const expected = parseQty(l.qtyExpected);
  if (l.qtyExpected.trim() !== '' && (expected === null || expected < 0)) return 'ordered';
  if (isPastExpiry(l.expiryDate, today)) return 'expiry';
  return null;
}

/** An expiry date already behind us. A blank box is not a problem: it means "no expiry", or the ingredient's shelf life. */
export function isPastExpiry(expiryDate: string, today: string): boolean {
  return expiryDate.trim() !== '' && expiryDate < today;
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

export type AlertKind = 'low_stock' | 'out_of_stock' | 'negative_stock' | 'expiring_soon' | 'expired' | 'replay_conflict';

/**
 * Two server kinds carry two meanings each, in their payload, and staff act on
 * each pair differently — so the screen splits them into their own groups:
 * `expiring_soon` covers batches about to expire and batches already past it
 * (`expired`), and `low_stock` covers a shelf running down and a shelf that has
 * emptied (`out`, 0151).
 */
export function alertKind(kind: string, payload: { expired?: unknown; out?: unknown }): AlertKind | null {
  if (kind === 'expiring_soon') return payload.expired === true ? 'expired' : 'expiring_soon';
  if (kind === 'low_stock') return payload.out === true ? 'out_of_stock' : 'low_stock';
  if (kind === 'negative_stock' || kind === 'replay_conflict') return kind;
  return null;
}

/** Order the alert groups by what hurts most if ignored. */
export const ALERT_ORDER: readonly AlertKind[] = ['negative_stock', 'out_of_stock', 'expired', 'low_stock', 'expiring_soon', 'replay_conflict'];

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
