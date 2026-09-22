/**
 * Pure statistics for the bench suite. No I/O, no stack, no clock — every
 * function here is total and deterministic, which is what lets
 * tests/bench-stats.test.ts run green on a machine with no Docker.
 *
 * Erasable TypeScript only (see types.ts).
 */
import type { Summary } from './types.ts';

/**
 * NEAREST-RANK percentile, never interpolated.
 *
 *     idx = min(n-1, max(0, ceil(p/100 * n) - 1))
 *
 * The rank is an index into the SORTED array, so the result is always a sample
 * that was actually measured. Interpolation (the "linear" method numpy defaults
 * to) invents a value between two observations; at n=60 that quietly turns a
 * p95 into a number no call ever took, and the 10 % regression rule then fires
 * on arithmetic rather than on a slowdown. Clamping at both ends makes p0 and
 * p100 the min and the max instead of an out-of-range index.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile: empty sample');
  const n = sorted.length;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sorted[idx]!;
}

/** n / min / p50 / p95 / max / mean over a copy of `samples` (input untouched). */
export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) throw new Error('summarize: empty sample');
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    n: sorted.length,
    min: sorted[0]!,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
  };
}

/**
 * Drop the first `count` samples as warmup.
 *
 * The first calls of a run pay for connection setup, an empty plan cache and a
 * cold shared_buffers — costs a nightly regression check must not read as a
 * slowdown. If the run is SHORTER than the warmup (a --repeat=1 smoke, or a row
 * that errored out early) we keep everything rather than return nothing: a row
 * with no samples cannot be summarised at all, and an empty row is a far worse
 * signal than a slightly pessimistic one.
 */
export function dropWarmup(samples: readonly number[], count: number): number[] {
  if (count <= 0) return [...samples];
  return samples.length > count ? samples.slice(count) : [...samples];
}

/**
 * Median of the per-repeat p95s — what `--repeat=N` feeds to the comparer.
 *
 * The TRUE median, not the nearest-rank p50 above: on an even count the two
 * middles are averaged. `percentile` refuses to interpolate because a p95 must
 * be a sample that was measured, but this folds N whole repeats into one
 * number and the nearest-rank form took the LOWER middle — so `--repeat=2` or
 * `4` systematically favoured the faster run, a bias in the direction that
 * hides a regression. The nightly runs 3, where the two agree.
 */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) throw new Error('medianOf: empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The relative part of the regression rule. */
export const REGRESSION_RATIO = 1.1;
/**
 * The absolute floor, in ms. Without it a row whose baseline p95 is 4 ms fails
 * on 4.5 ms — half a millisecond of scheduler noise on a shared CI runner. A
 * regression has to be BOTH more than 10 % and more than 10 ms to count.
 */
export const REGRESSION_FLOOR_MS = 10;

/**
 * The 10 % rule: `p95 > baseline * 1.10 AND (p95 - baseline) > 10 ms`.
 * p50 is informational and is never fed to this.
 */
export function isRegression(baselineP95: number, measuredP95: number): boolean {
  return (
    measuredP95 > baselineP95 * REGRESSION_RATIO && measuredP95 - baselineP95 > REGRESSION_FLOOR_MS
  );
}

/** Exit codes the comparer and the runner share. */
export const EXIT_CLEAN = 0;
export const EXIT_REGRESSION = 1;
export const EXIT_HARNESS = 2;
