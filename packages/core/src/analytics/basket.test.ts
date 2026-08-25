import { describe, expect, it } from 'vitest';
import { rankPairs, tallyBaskets } from './basket';

describe('rankPairs', () => {
  it('reports confidence from the rarer side and computes lift when orders are known', () => {
    const [pair] = rankPairs([{ a: 'latte', b: 'kahi', count: 6, aCount: 30, bCount: 8, orders: 100 }]);
    expect(pair).toEqual({ a: 'kahi', b: 'latte', count: 6, confidencePct: 75, lift: (6 * 100) / (8 * 30) });
  });

  it('drops lone co-orders and self pairs, sorts by count then confidence', () => {
    const pairs = rankPairs([
      { a: 'x', b: 'y', count: 1, aCount: 5, bCount: 5 },
      { a: 'x', b: 'x', count: 9, aCount: 9, bCount: 9 },
      { a: 'p', b: 'q', count: 3, aCount: 3, bCount: 10 },
      { a: 'r', b: 's', count: 3, aCount: 6, bCount: 10 },
      { a: 't', b: 'u', count: 5, aCount: 50, bCount: 50 },
    ]);
    expect(pairs.map((p) => [p.a, p.b, p.confidencePct, p.lift])).toEqual([
      ['t', 'u', 10, null],
      ['p', 'q', 100, null],
      ['r', 's', 50, null],
    ]);
    expect(rankPairs([{ a: 'p', b: 'q', count: 3, aCount: 3, bCount: 10 }], 0)).toEqual([]);
  });

  it('never divides by a solo count smaller than the pair count', () => {
    expect(rankPairs([{ a: 'p', b: 'q', count: 4, aCount: 0, bCount: 2 }])[0]?.confidencePct).toBe(100);
  });

  it('rejects non-integer counts', () => {
    expect(() => rankPairs([{ a: 'p', b: 'q', count: 2.5, aCount: 3, bCount: 3 }])).toThrow(RangeError);
  });
});

describe('tallyBaskets', () => {
  it('counts distinct items per basket, singles included in orders and solo', () => {
    const t = tallyBaskets([
      ['a', 'b', 'b'],
      ['a', 'c'],
      ['b'],
      [],
      ['a', 'b', 'c'],
    ]);
    expect(t.orders).toBe(4);
    expect([...t.solo.entries()].sort()).toEqual([
      ['a', 3],
      ['b', 3],
      ['c', 2],
    ]);
    const ab = t.pairs.find((p) => p.a === 'a' && p.b === 'b');
    expect(ab).toEqual({ a: 'a', b: 'b', count: 2, aCount: 3, bCount: 3, orders: 4 });
    expect(t.pairs.find((p) => p.a === 'b' && p.b === 'c')?.count).toBe(1);
  });

  it('applies the keep filter before tallying', () => {
    const t = tallyBaskets([['a', 'x'], ['x']], (id) => id !== 'x');
    expect(t.orders).toBe(1);
    expect(t.pairs).toEqual([]);
    expect(t.solo.get('x')).toBeUndefined();
  });
});
