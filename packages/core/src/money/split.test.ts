import { describe, expect, it } from 'vitest';
import { MoneyError, iqd, sumIqd } from './iqd';
import { splitByItems, splitEvenly } from './split';

/** Deterministic PRNG (mulberry32) so property failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

describe('splitEvenly — largest remainder (plan override, NO 250 rounding)', () => {
  it('splits exactly: 10000 / 3', () => {
    expect(splitEvenly(iqd(10000), 3)).toEqual([3334, 3333, 3333]);
  });

  it('the first (total mod n) shares get the extra dinar', () => {
    expect(splitEvenly(iqd(10), 4)).toEqual([3, 3, 2, 2]); // 10 mod 4 = 2
    expect(splitEvenly(iqd(7), 3)).toEqual([3, 2, 2]);
  });

  it('is exact where the old 250-IQD scheme would have rounded', () => {
    // 25000 / 3: shares are NOT multiples of 250 and that is correct now.
    const shares = splitEvenly(iqd(25000), 3);
    expect(shares).toEqual([8334, 8333, 8333]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(25000);
  });

  it('handles n = 1, n > total, total = 0', () => {
    expect(splitEvenly(iqd(999), 1)).toEqual([999]);
    expect(splitEvenly(iqd(2), 5)).toEqual([1, 1, 0, 0, 0]);
    expect(splitEvenly(iqd(0), 3)).toEqual([0, 0, 0]);
  });

  it('rejects invalid n and non-integer totals', () => {
    expect(() => splitEvenly(iqd(1000), 0)).toThrowError(MoneyError);
    expect(() => splitEvenly(iqd(1000), -2)).toThrowError(MoneyError);
    expect(() => splitEvenly(iqd(1000), 2.5)).toThrowError(MoneyError);
    expect(() => splitEvenly(1000.5, 2)).toThrowError(MoneyError);
  });

  it('property: sum === total, shares differ by at most 1, big shares first', () => {
    const rand = mulberry32(20260824);
    for (let i = 0; i < 2000; i++) {
      const total = Math.floor(rand() * 1_000_000_000);
      const n = 1 + Math.floor(rand() * 60);
      const shares = splitEvenly(iqd(total), n);

      expect(shares).toHaveLength(n);
      // exact sum invariant — the contractual one
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      // fairness invariant
      const max = Math.max(...shares);
      const min = Math.min(...shares);
      expect(max - min).toBeLessThanOrEqual(1);
      // largest-remainder placement: exactly (total mod n) shares of base+1, leading
      const bigCount = shares.filter((s) => s === max).length;
      if (max !== min) {
        expect(bigCount).toBe(total % n);
        expect(shares.slice(0, bigCount).every((s) => s === max)).toBe(true);
      }
      // every share is a non-negative integer
      expect(shares.every((s) => Number.isSafeInteger(s) && s >= 0)).toBe(true);
    }
  });
});

describe('splitByItems', () => {
  it('sums each payer’s lines exactly (no rounding involved)', () => {
    const shares = splitByItems([
      [iqd(4000), iqd(1500)],
      [iqd(2500)],
      [],
    ]);
    expect(shares).toEqual([5500, 2500, 0]);
  });

  it('enforces the total when provided', () => {
    const byPayer = [[iqd(4000)], [iqd(6000)]];
    expect(splitByItems(byPayer, iqd(10000))).toEqual([4000, 6000]);
    try {
      splitByItems(byPayer, iqd(10001));
      expect.unreachable();
    } catch (e) {
      expect((e as MoneyError).code).toBe('SPLIT_MISMATCH');
    }
  });

  it('rejects an empty payer list and non-integer lines', () => {
    expect(() => splitByItems([])).toThrowError(MoneyError);
    expect(() => splitByItems([[10.5]])).toThrowError(MoneyError);
  });

  it('property: Σ shares === Σ all lines', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const payers = 1 + Math.floor(rand() * 6);
      const byPayer = Array.from({ length: payers }, () =>
        Array.from({ length: Math.floor(rand() * 5) }, () => iqd(Math.floor(rand() * 50_000))),
      );
      const total = sumIqd(byPayer.flat());
      const shares = splitByItems(byPayer, total);
      expect(sumIqd(shares)).toBe(total);
    }
  });
});
