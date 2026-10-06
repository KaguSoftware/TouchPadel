import { describe, expect, it } from 'vitest';
import { mulberry32, randInt, roundSeed, seedFrom, shuffle } from './prng';

describe('seedFrom (FNV-1a 32-bit)', () => {
  it('matches the published FNV-1a vectors', () => {
    expect(seedFrom('')).toBe(0x811c9dc5);
    expect(seedFrom('a')).toBe(0xe40c292c);
    expect(seedFrom('foobar')).toBe(0xbf9cf968);
  });

  it('pins a tournament id', () => {
    expect(seedFrom('11111111-2222-3333-4444-555555555555')).toBe(2418761689);
    expect(seedFrom('00000000-0000-4000-8000-00000000000a')).toBe(4285565234);
  });

  it('is always an unsigned 32-bit integer', () => {
    for (const s of ['x', 'tournament', 'ض', '\u0000￿']) {
      const h = seedFrom(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('mulberry32', () => {
  it('pins the draws of seed 42', () => {
    const r = mulberry32(42);
    expect([r(), r(), r(), r(), r()]).toEqual([
      2581720956, 1925393290, 3661312704, 2876485805, 750819978,
    ]);
  });

  it('is the usual float mulberry32 times 2^32', () => {
    // The textbook form, kept here only to pin ours to it.
    const float = (seed: number) => {
      let a = seed;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    for (const seed of [0, 1, 42, 0xdeadbeef, 4285565234]) {
      const ours = mulberry32(seed);
      const theirs = float(seed);
      for (let i = 0; i < 50; i++) expect(ours() / 4294967296).toBe(theirs());
    }
  });

  it('repeats itself for the same seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
});

describe('roundSeed', () => {
  it('pins a round seed and differs per round', () => {
    expect(roundSeed(4285565234, 1)).toBe(seedFrom('4285565234:1'));
    const seeds = new Set(Array.from({ length: 30 }, (_, i) => roundSeed(4285565234, i + 1)));
    expect(seeds.size).toBe(30);
  });
});

describe('shuffle', () => {
  it('pins a shuffle and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(input, mulberry32(7))).toEqual([8, 7, 6, 4, 1, 3, 2, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps every item exactly once', () => {
    const input = Array.from({ length: 64 }, (_, i) => i);
    const out = shuffle(input, mulberry32(99));
    expect(out.slice().sort((x, y) => x - y)).toEqual(input);
  });

  it('handles the empty list and one item', () => {
    expect(shuffle([], mulberry32(1))).toEqual([]);
    expect(shuffle(['x'], mulberry32(1))).toEqual(['x']);
  });

  it('draws in range', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const d = randInt(r, 7);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(7);
    }
  });
});
