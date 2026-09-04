import { describe, expect, it } from 'vitest';
import { applyPctDiscountIqd } from './discount';
import { MoneyError } from './iqd';
import {
  PROMO_CODE_ALPHABET,
  PROMO_CODE_LENGTH,
  isGeneratedPromoCode,
  normalizePromoCode,
  pickBestPromotion,
  promotionDiscountIqd,
} from './promotion';

/** Exact reference of the SQL: base - ((base * (100 - pct) + 50) / 100) on bigint. */
function sqlPercentReference(base: number, pct: number): number {
  return base - Number((BigInt(base) * BigInt(100 - pct) + 50n) / 100n);
}

describe('promotionDiscountIqd (twin of app.promotion_amount_iqd)', () => {
  it('percent: base minus the sanctioned discounted price, so the two add back up', () => {
    expect(promotionDiscountIqd(10_000, 'percent', 10)).toBe(1_000);
    expect(promotionDiscountIqd(1_250, 'percent', 15)).toBe(187); // 1250 - 1063
    expect(promotionDiscountIqd(999, 'percent', 10)).toBe(100); // 999 - 899
    for (const base of [0, 1, 5, 15, 250, 999, 1_250, 8_000, 12_500, 1_000_000]) {
      for (let pct = 1; pct <= 99; pct++) {
        const d = promotionDiscountIqd(base, 'percent', pct);
        expect(d).toBe(sqlPercentReference(base, pct));
        expect(d + applyPctDiscountIqd(base, pct)).toBe(base);
      }
    }
  });

  it('amount: capped at the base', () => {
    expect(promotionDiscountIqd(10_000, 'amount', 1_500)).toBe(1_500);
    expect(promotionDiscountIqd(1_000, 'amount', 1_500)).toBe(1_000);
    expect(promotionDiscountIqd(0, 'amount', 1_500)).toBe(0);
  });

  it('rejects a value outside its range or a bad type with a RangeError', () => {
    expect(() => promotionDiscountIqd(1_000, 'percent', 0)).toThrowError(RangeError);
    expect(() => promotionDiscountIqd(1_000, 'percent', 100)).toThrowError(RangeError);
    expect(() => promotionDiscountIqd(1_000, 'percent', 12.5)).toThrowError(RangeError);
    expect(() => promotionDiscountIqd(1_000, 'amount', 0)).toThrowError(RangeError);
    expect(() => promotionDiscountIqd(1_000, 'bogus' as never, 5)).toThrowError(RangeError);
  });

  it('rejects a non-integer or negative base with a MoneyError', () => {
    expect(() => promotionDiscountIqd(12.5, 'percent', 10)).toThrowError(MoneyError);
    expect(() => promotionDiscountIqd(-1, 'amount', 10)).toThrowError(MoneyError);
  });
});

describe('pickBestPromotion (twin of the eligible_promotions ordering)', () => {
  it('takes the largest amount, first-listed on a tie, and skips sub-1 amounts', () => {
    const list = [
      { promotionId: 'a', amountIqd: 1_000 },
      { promotionId: 'b', amountIqd: 1_500 },
      { promotionId: 'c', amountIqd: 1_500 },
      { promotionId: 'd', amountIqd: 0 },
    ];
    expect(pickBestPromotion(list)?.promotionId).toBe('b');
    expect(pickBestPromotion([list[3]!])).toBeNull();
    expect(pickBestPromotion([])).toBeNull();
  });
});

describe('promo codes', () => {
  it('alphabet has 32 unambiguous upper-case symbols', () => {
    expect(PROMO_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(PROMO_CODE_ALPHABET).size).toBe(32);
    for (const bad of ['0', 'O', '1', 'I']) expect(PROMO_CODE_ALPHABET).not.toContain(bad);
    expect(PROMO_CODE_ALPHABET).toBe(PROMO_CODE_ALPHABET.toUpperCase());
    expect(PROMO_CODE_LENGTH).toBe(8);
  });

  it('recognises a generated code and nothing else', () => {
    expect(isGeneratedPromoCode('ABCD2345')).toBe(true);
    expect(isGeneratedPromoCode('ABCD234')).toBe(false);
    expect(isGeneratedPromoCode('ABCD23450')).toBe(false);
    expect(isGeneratedPromoCode('ABCD234O')).toBe(false); // letter O
    expect(isGeneratedPromoCode('abcd2345')).toBe(false);
  });

  it('normalises typed codes the way the server does', () => {
    expect(normalizePromoCode('  padel10 ')).toBe('PADEL10');
    expect(normalizePromoCode('')).toBeNull();
    expect(normalizePromoCode('   ')).toBeNull();
    expect(normalizePromoCode(null)).toBeNull();
    expect(normalizePromoCode(undefined)).toBeNull();
  });
});
