/**
 * Shapes shared by the bench runner, the comparer and the two gate tests.
 *
 * Erasable TypeScript only (no enums, no namespaces, no parameter properties):
 * every file under bench/ is executed by `node --experimental-strip-types`,
 * which erases types and refuses anything that would need emitting code.
 */

/** How a row ended. `skipped` is a real outcome, not an absence — see compare.ts. */
export type Outcome = 'ok' | 'timeout' | 'skipped' | `error:${string}`;

/** Nearest-rank percentile summary of one row's samples (all in `unit`). */
export interface Summary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/** One asserted property measured alongside the timing (contention, exactly-once, …). */
export interface InvariantCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Invariants {
  ok: boolean;
  checks: InvariantCheck[];
}

/** One benchmarked row. `id` is the stable key the baseline is diffed on. */
export interface BenchRow {
  id: string;
  area: string;
  /** Callers in flight at once. 1 = serial. */
  concurrency: number;
  unit: 'ms';
  outcome: Outcome;
  /** Per-CALL wall time. Always present, even for a concurrent row. */
  perCall: Summary;
  /** Per-ROUND wall time (the whole Promise.all). Only for concurrency > 1. */
  perRound?: Summary;
  /** Postgres/HTTP error codes seen, counted. Empty on a clean row. */
  errors: Record<string, number>;
  invariants: Invariants;
  /** What the row was built to demonstrate, when that is not just "it is fast". */
  expect?: Outcome;
  /** Free-form measurement the row wants on the record (counts, wall clock, …). */
  notes?: Record<string, number | string>;
}

/** Where and on what the numbers were taken. Never compared — see compare.ts. */
export interface BenchMeta {
  sha: string;
  node: string;
  cli: string;
  os: string;
  cpu: string;
  cores: number;
  runner: string;
  startedAt: string;
  repeat: number;
}

/** What `run.ts` writes to `--out`. */
export interface BenchResults {
  meta: BenchMeta;
  rows: BenchRow[];
}

/** The committed `baseline.json`: only what compare.ts is allowed to read. */
export interface BaselineRow {
  p50: number;
  p95: number;
  outcome: Outcome;
  unit: 'ms';
  concurrency: number;
}

export interface Baseline {
  meta: BenchMeta;
  rows: Record<string, BaselineRow>;
}
