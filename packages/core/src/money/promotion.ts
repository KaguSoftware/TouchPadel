import { applyPctDiscountIqd } from './discount';
import { iqd, type IQD } from './iqd';

/**
 * Promotions (migration 0067) — the pure half of what the server does when it
 * picks and prices the single best promotion for a tab. Nothing here is a
 * pricing authority: `app.apply_best_promotion` writes the row and the till
 * renders what came back. These twins exist so a preview (and a test) can
 * show the same figure the server will stamp, bit-for-bit.
 */

export type PromotionType = 'percent' | 'amount';

/**
 * The discount a promotion takes off a base, in integer IQD — the TS twin of
 * SQL `app.promotion_amount_iqd(p_base, p_type, p_value)`:
 *
 *   percent: base - apply_pct_discount(base, pct)      (pct 1..99, half-up)
 *   amount:  min(value, base)                          (value >= 1)
 *
 * The percent branch is defined THROUGH `applyPctDiscountIqd` (twin of
 * `app.apply_pct_discount`, 0030) rather than as a rounding of its own, so the
 * discount and the discounted price always add back up to the base.
 */
export function promotionDiscountIqd(base: number, type: PromotionType, value: number): IQD {
  const b = iqd(base);
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`promotion value must be a whole number >= 1, got ${String(value)}`);
  }
  if (type === 'percent') {
    if (value > 99) throw new RangeError(`percent promotions are 1..99, got ${value}`);
    return iqd(b - applyPctDiscountIqd(b, value));
  }
  if (type === 'amount') {
    return iqd(Math.min(value, b));
  }
  throw new RangeError(`promotion type must be percent or amount, got ${String(type)}`);
}

export interface RankedPromotion {
  promotionId: string;
  amountIqd: number;
}

/**
 * The single best promotion from an eligible list: the largest `amountIqd`,
 * ties broken by list order (the server orders candidates by created_at, id
 * before ranking, so "first" is the oldest). Candidates below 1 IQD are not
 * promotions and are skipped; `null` when nothing qualifies. Twin of the
 * ordering in `app.eligible_promotions` (amountIqd desc, then input order).
 */
export function pickBestPromotion<T extends RankedPromotion>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const c of candidates) {
    if (!Number.isSafeInteger(c.amountIqd) || c.amountIqd < 1) continue;
    if (best === null || c.amountIqd > best.amountIqd) best = c;
  }
  return best;
}

/**
 * Code alphabet shared with `app.generate_promo_code`: upper-case, no 0/O/1/I,
 * exactly 32 symbols so a random byte modulo 32 is unbiased.
 */
export const PROMO_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PROMO_CODE_LENGTH = 8;

/** True for a code the server would have generated (8 symbols of the alphabet). */
export function isGeneratedPromoCode(code: string): boolean {
  if (typeof code !== 'string' || code.length !== PROMO_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!PROMO_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * What `app.upsert_promotion` does to a typed code before storing or matching
 * it: trim, upper-case; empty becomes null (which the RPC reads as "clear").
 */
export function normalizePromoCode(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = input.trim().toUpperCase();
  return s === '' ? null : s;
}
