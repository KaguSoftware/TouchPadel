/**
 * PURE gate for bench/stats.ts — no stack, no Docker, no clock. It runs on
 * every machine and in every CI job, because the arithmetic is the part of the
 * bench suite that decides whether a nightly run is a regression, and that
 * decision must not depend on a database being up.
 *
 * Arrays here are hand-made so the expected index can be read off by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  percentile,
  summarize,
  dropWarmup,
  medianOf,
  isRegression,
  REGRESSION_RATIO,
  REGRESSION_FLOOR_MS,
  EXIT_CLEAN,
  EXIT_REGRESSION,
  EXIT_HARNESS,
} from '../bench/stats.ts';

/** 1..n ascending — already sorted, so the index maths is visible. */
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('nearest-rank percentile', () => {
  it('n=1: every percentile is the single sample', () => {
    expect(percentile([5], 0)).toBe(5);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([5], 100)).toBe(5);
  });

  it('n=2: p50 is the lower sample, p95 the upper (never their average)', () => {
    // Interpolation would give 15 for p50 and 19.5 for p95 — values no call took.
    expect(percentile([10, 20], 50)).toBe(10);
    expect(percentile([10, 20], 95)).toBe(20);
  });

  it('n=20: ceil(p/100*n)-1 indexes the sorted array', () => {
    const s = range(20);
    expect(percentile(s, 50)).toBe(10); // ceil(10)-1 = 9 -> s[9] = 10
    expect(percentile(s, 95)).toBe(19); // ceil(19)-1 = 18 -> s[18] = 19
  });

  it('n=60 (the serial sample count): p50=30, p95=57', () => {
    const s = range(60);
    expect(percentile(s, 50)).toBe(30); // ceil(30)-1 = 29
    expect(percentile(s, 95)).toBe(57); // ceil(57)-1 = 56
  });

  it('clamps at both ends: p0 is the min, p100 is the max', () => {
    const s = range(20);
    expect(percentile(s, 0)).toBe(1); // max(0, ceil(0)-1) = 0
    expect(percentile(s, 100)).toBe(20); // min(n-1, ceil(20)-1) = 19
  });

  it('every returned value is a sample that was actually measured', () => {
    const s = [3, 7, 11, 19, 23];
    for (const p of [0, 10, 25, 50, 75, 90, 95, 99, 100]) {
      expect(s).toContain(percentile(s, p));
    }
  });

  it('refuses an empty sample rather than inventing a number', () => {
    expect(() => percentile([], 95)).toThrow(/empty sample/);
    expect(() => summarize([])).toThrow(/empty sample/);
    expect(() => medianOf([])).toThrow(/empty sample/);
  });
});

describe('summarize', () => {
  it('reports n/min/p50/p95/max/mean and sorts an unsorted input', () => {
    const s = summarize([20, 5, 15, 10]); // sorted: 5,10,15,20
    expect(s).toEqual({ n: 4, min: 5, p50: 10, p95: 20, max: 20, mean: 12.5 });
  });

  it('does not mutate the caller-supplied array', () => {
    const input = [3, 1, 2];
    summarize(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('warmup trimming', () => {
  it('drops the first 5 of 60 serial samples', () => {
    const trimmed = dropWarmup(range(60), 5);
    expect(trimmed).toHaveLength(55);
    expect(trimmed[0]).toBe(6);
  });

  it('drops the first 2 of 30 concurrent rounds', () => {
    const trimmed = dropWarmup(range(30), 2);
    expect(trimmed).toHaveLength(28);
    expect(trimmed[0]).toBe(3);
  });

  it('keeps everything when the run is no longer than the warmup', () => {
    // A --repeat=1 smoke, or a row that errored out early: a pessimistic row
    // beats an empty one, which could not be summarised at all.
    expect(dropWarmup(range(5), 5)).toHaveLength(5);
    expect(dropWarmup(range(3), 5)).toHaveLength(3);
    expect(dropWarmup(range(10), 0)).toHaveLength(10);
  });
});

describe('the 10 % regression rule with an absolute floor', () => {
  it('exposes the two thresholds it is built from', () => {
    expect(REGRESSION_RATIO).toBe(1.1);
    expect(REGRESSION_FLOOR_MS).toBe(10);
  });

  it('4.0 -> 4.5 ms passes: over 10 %, but half a millisecond is runner noise', () => {
    expect(isRegression(4.0, 4.5)).toBe(false);
  });

  it('100 -> 111 ms fails: over 10 % AND over the 10 ms floor', () => {
    expect(isRegression(100, 111)).toBe(true);
  });

  it('100 -> 109 ms passes: under 10 %', () => {
    expect(isRegression(100, 109)).toBe(false);
  });

  it('exactly 10 % or exactly 10 ms is not a regression (strict >)', () => {
    expect(isRegression(100, 110)).toBe(false); // exactly the ratio
    expect(isRegression(50, 60)).toBe(false); // exactly the floor
  });

  it('a faster run is never a regression', () => {
    expect(isRegression(100, 40)).toBe(false);
    expect(isRegression(100, 100)).toBe(false);
  });

  it('a big row needs both halves: 500 -> 551 fails, 500 -> 549 passes', () => {
    expect(isRegression(500, 551)).toBe(true);
    expect(isRegression(500, 549)).toBe(false);
  });
});

describe('median of the per-repeat p95s', () => {
  it('--repeat=3 takes the middle p95, not the worst', () => {
    expect(medianOf([120, 95, 400])).toBe(120);
  });

  it('nearest-rank on an even count takes the lower middle', () => {
    expect(medianOf([10, 20, 30, 40])).toBe(20);
  });

  it('--repeat=1 is the single value', () => {
    expect(medianOf([42])).toBe(42);
  });
});

describe('exit-code mapping', () => {
  it('0 clean, 1 regression or invariant, 2 harness error', () => {
    expect(EXIT_CLEAN).toBe(0);
    expect(EXIT_REGRESSION).toBe(1);
    expect(EXIT_HARNESS).toBe(2);
  });
});
