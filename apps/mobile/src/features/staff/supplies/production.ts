/**
 * Production on the staff phone (build-contracts-2026-09-23 §2.16, §6.1): what
 * to make today, a batch, and what was made today. The head chef, the chef
 * assistant, the manager and the owner record; a batch takes its components
 * off the stock on the server (`record_batch`), exactly as the manager's
 * production does. Quantities only: no cost reaches the phone.
 *
 * PURE (vitest): no react-native, no supabase.
 */
import { parseTypedDate, westernDigits, type StaffRole } from '@touch/core';

/** Who records batches (§2.1 CHEFS + MGMT); the server guards the same list. */
export const PRODUCTION_ROLES: readonly StaffRole[] = ['head_chef', 'chef', 'manager', 'owner'];

export type StockUnit = 'g' | 'ml' | 'pc';

/** One row of `production_today`: an active prepared ingredient with an output recipe. */
export interface ProductionItem {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: StockUnit;
  on_hand: number;
  par_level: number | null;
  below_par: boolean;
  made_today: number;
  shelf_life_days: number | null;
}

/** One row of `production_log_today`: a batch recorded today. */
export interface ProductionLogRow {
  movement_id: string | number;
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  qty: number;
  unit: StockUnit;
  staff_name: string | null;
  at: string;
}

export interface BatchDraft {
  ingredientId: string | null;
  qty: string;
  /** Typed use-by day; blank means the item's shelf life decides. */
  expiry: string;
}

export type BatchField = 'item' | 'qty' | 'expiry';
export interface BatchIssue {
  field: BatchField;
  code: 'required' | 'invalid' | 'past';
}

/** `record_batch` takes a numeric; the server rounds nothing, so the phone keeps three places. */
const MAX_QTY = 1_000_000_000;

/**
 * A typed amount above 0, in either digit set, or null when it is not one.
 * The decimal mark is `.` or the Arabic `٫`; `٬` and a correctly grouped `,`
 * are thousands separators. Any other comma is refused rather than guessed:
 * "1,5" read as 15 or as 1.5 would deduct the wrong stock either way. Rounded
 * to three places, the precision the stock tables keep.
 */
export function parseQty(text: string): number | null {
  let raw = westernDigits(text).trim().replace(/\s/g, '').replace(/٬/g, '').replace(/٫/g, '.');
  if (raw.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) return null;
    raw = raw.replace(/,/g, '');
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(raw)) return null;
  const n = Math.round(Number(raw) * 1000) / 1000;
  return Number.isFinite(n) && n > 0 && n < MAX_QTY ? n : null;
}

/** Check a batch before it is sent; an empty list means it can go. `today` is `YYYY-MM-DD`. */
export function validateBatch(draft: BatchDraft, today: string): BatchIssue[] {
  const issues: BatchIssue[] = [];
  if (!draft.ingredientId) issues.push({ field: 'item', code: 'required' });
  if (!draft.qty.trim()) issues.push({ field: 'qty', code: 'required' });
  else if (parseQty(draft.qty) === null) issues.push({ field: 'qty', code: 'invalid' });
  if (draft.expiry.trim()) {
    const day = parseTypedDate(draft.expiry);
    if (!day) issues.push({ field: 'expiry', code: 'invalid' });
    else if (day < today) issues.push({ field: 'expiry', code: 'past' });
  }
  return issues;
}

export interface BatchArgs {
  p_ingredient_id: string;
  p_qty: number;
  p_expiry_date?: string;
  p_venue_id: string;
}

/** The `record_batch` arguments of a valid draft (the key is added by the caller). */
export function batchArgs(draft: BatchDraft, venueId: string): BatchArgs {
  const day = draft.expiry.trim() ? parseTypedDate(draft.expiry) : null;
  return {
    p_ingredient_id: draft.ingredientId as string,
    p_qty: parseQty(draft.qty) as number,
    ...(day ? { p_expiry_date: day } : {}),
    p_venue_id: venueId,
  };
}

/**
 * The intent a batch's idempotency key is kept under: the batch itself, so a
 * retry of the same batch replays the first answer and never deducts twice,
 * while a corrected amount is a new batch with a new key.
 */
export function batchIntent(args: BatchArgs): string {
  return `batch:${args.p_venue_id}:${args.p_ingredient_id}:${args.p_qty}:${args.p_expiry_date ?? ''}`;
}

/** Below par first, then the rest; the server's order, kept stable for a re-render. */
export function sortProduction(items: readonly ProductionItem[]): ProductionItem[] {
  return [...items].sort((a, b) => Number(b.below_par) - Number(a.below_par));
}
