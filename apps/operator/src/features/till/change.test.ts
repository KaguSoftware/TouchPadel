import { describe, expect, it } from 'vitest';
import { MoneyError, splitEvenly } from '@touch/core';
import { computeChange } from './change';

describe('computeChange (@touch/core integration)', () => {
  it('computes exact change on overpayment', () => {
    const r = computeChange(17_500, 20_000);
    expect(r.sufficient).toBe(true);
    expect(r.changeIqd).toBe(2_500);
    expect(r.shortByIqd).toBe(0);
  });

  it('exact tender yields zero change', () => {
    const r = computeChange(25_000, 25_000);
    expect(r.sufficient).toBe(true);
    expect(r.changeIqd).toBe(0);
  });

  it('reports the shortfall when tendered is insufficient', () => {
    const r = computeChange(30_000, 20_000);
    expect(r.sufficient).toBe(false);
    expect(r.changeIqd).toBe(0);
    expect(r.shortByIqd).toBe(10_000);
  });

  it('rejects non-integer money (core invariant: no floats ever)', () => {
    expect(() => computeChange(100.5, 200)).toThrow(MoneyError);
    expect(() => computeChange(100, -1)).toThrow(MoneyError);
  });

  it('settling every split share sums exactly to the total', () => {
    const total = 100_001;
    const shares = splitEvenly(total, 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    // paying each share with exact cash produces zero change per share
    for (const share of shares) {
      expect(computeChange(share, share).changeIqd).toBe(0);
    }
  });
});
