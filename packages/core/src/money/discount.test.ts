import { describe, expect, it } from 'vitest';
import { applyPctDiscountIqd } from './discount';
import { MoneyError } from './iqd';

/** Exact reference of the SQL expression `(list * (100 - pct) + 50) / 100` on bigint. */
function sqlReference(list: number, pct: number): number {
  return Number((BigInt(list) * BigInt(100 - pct) + 50n) / 100n);
}

describe('applyPctDiscountIqd (twin of app.apply_pct_discount)', () => {
  it('matches the fixture prices from the design doc', () => {
    expect(applyPctDiscountIqd(1250, 15)).toBe(1063); // 1062.5 -> 1063
    expect(applyPctDiscountIqd(999, 10)).toBe(899); // 899.1 -> 899
    expect(applyPctDiscountIqd(8000, 15)).toBe(6800); // Kahi fixture: exact
  });

  it('0 % is the identity', () => {
    expect(applyPctDiscountIqd(0, 0)).toBe(0);
    expect(applyPctDiscountIqd(1, 0)).toBe(1);
    expect(applyPctDiscountIqd(1250, 0)).toBe(1250);
    expect(applyPctDiscountIqd(123_456_789, 0)).toBe(123_456_789);
  });

  it('99 % leaves one percent, rounded half-up', () => {
    expect(applyPctDiscountIqd(1000, 99)).toBe(10);
    expect(applyPctDiscountIqd(1250, 99)).toBe(13); // 12.5 -> 13
    expect(applyPctDiscountIqd(1, 99)).toBe(0); // 0.01 -> 0
    expect(applyPctDiscountIqd(50, 99)).toBe(1); // 0.5 -> 1
  });

  it('rounds half-up on the .5 boundary and down below it', () => {
    expect(applyPctDiscountIqd(5, 10)).toBe(5); // 4.5 -> 5
    expect(applyPctDiscountIqd(15, 10)).toBe(14); // 13.5 -> 14
    expect(applyPctDiscountIqd(1, 50)).toBe(1); // 0.5 -> 1
    expect(applyPctDiscountIqd(3, 50)).toBe(2); // 1.5 -> 2
    expect(applyPctDiscountIqd(4, 10)).toBe(4); // 3.6 -> 4
    expect(applyPctDiscountIqd(3, 10)).toBe(3); // 2.7 -> 3
    expect(applyPctDiscountIqd(7, 30)).toBe(5); // 4.9 -> 5
    expect(applyPctDiscountIqd(1, 40)).toBe(1); // 0.6 -> 1
    expect(applyPctDiscountIqd(1, 60)).toBe(0); // 0.4 -> 0
  });

  it('rejects pct outside 0..99 or non-integer with a RangeError', () => {
    expect(() => applyPctDiscountIqd(1000, -1)).toThrowError(RangeError);
    expect(() => applyPctDiscountIqd(1000, 100)).toThrowError(RangeError);
    expect(() => applyPctDiscountIqd(1000, 15.5)).toThrowError(RangeError);
    expect(() => applyPctDiscountIqd(1000, Number.NaN)).toThrowError(RangeError);
    expect(() => applyPctDiscountIqd(1000, Number.POSITIVE_INFINITY)).toThrowError(RangeError);
  });

  it('rejects a non-integer, negative or unsafe list price with a MoneyError', () => {
    expect(() => applyPctDiscountIqd(12.5, 10)).toThrowError(MoneyError);
    expect(() => applyPctDiscountIqd(-100, 10)).toThrowError(MoneyError);
    expect(() => applyPctDiscountIqd(Number.NaN, 10)).toThrowError(MoneyError);
    expect(() => applyPctDiscountIqd(2 ** 53, 10)).toThrowError(MoneyError);
    // list itself is safe, but list * (100 - pct) is not
    expect(() => applyPctDiscountIqd(Number.MAX_SAFE_INTEGER, 1)).toThrowError(MoneyError);
  });

  it('property: equals the bigint SQL expression, is integer IQD and never exceeds list', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const lists = [0, 1, 5, 15, 250, 999, 1250, 8000, 12_500, 1_000_000];
    for (const list of lists) {
      for (let pct = 0; pct <= 99; pct++) {
        expect(applyPctDiscountIqd(list, pct)).toBe(sqlReference(list, pct));
      }
    }
    for (let i = 0; i < 500; i++) {
      const list = Math.floor(rand() * 5_000_000);
      const pct = Math.floor(rand() * 100);
      const unit = applyPctDiscountIqd(list, pct);
      expect(Number.isSafeInteger(unit)).toBe(true);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThanOrEqual(list);
      expect(unit).toBe(sqlReference(list, pct));
    }
  });
});
