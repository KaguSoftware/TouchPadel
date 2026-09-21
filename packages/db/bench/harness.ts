/**
 * The measuring apparatus: timing, warmup, concurrency, invariant collection
 * and the JSON writer. Everything that is not a query lives here, so an area
 * file (bench/areas/*.ts) is only the calls it wants timed.
 *
 * Erasable TypeScript only (see types.ts) — this runs under
 * `node --experimental-strip-types`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, type as osType, release } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  BenchMeta,
  BenchResults,
  BenchRow,
  InvariantCheck,
  Invariants,
  Outcome,
  Summary,
} from './types.ts';
import { dropWarmup, summarize } from './stats.ts';

/** Drop the first 5 serial samples / first 2 concurrent rounds — see stats.ts. */
export const WARMUP_SERIAL = 5;
export const WARMUP_ROUNDS = 2;

/** Sample counts, kept here so run.ts and the areas cannot drift apart. */
export const SERIAL_SAMPLES = 60;
export const CONCURRENT_ROUNDS = 30;
export const ANALYTICS_SAMPLES = 20;
export const REPLAY_DRAIN = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Timing
// ─────────────────────────────────────────────────────────────────────────────

export interface Timed<T> {
  ms: number;
  value: T;
  error?: unknown;
}

/**
 * Wall time around one call, in ms, from performance.now().
 *
 * A REJECTION IS STILL A MEASUREMENT. A refused hold_slot under contention is
 * the exact thing the booking area is built to time, so a throw is caught, the
 * elapsed time is kept, and the error is handed back for the caller to classify.
 * Rethrowing here would silently drop 49 of the 50 samples in the contention row.
 */
export async function timeIt<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - t0, value };
  } catch (error) {
    return { ms: performance.now() - t0, value: undefined as T, error };
  }
}

/**
 * `n` calls back to back. Every sample is one call.
 *
 * `between` runs AFTER each call and is NOT timed — it is where a row puts the
 * bookkeeping a repeat needs (releasing the holds it just took, so the next
 * iteration is not measuring a quota refusal). Doing that inside `fn` would
 * fold a service-role DELETE into every sample.
 */
export async function runSerial<T>(
  n: number,
  fn: (i: number) => Promise<T>,
  between?: (i: number) => Promise<void>,
): Promise<Timed<T>[]> {
  const out: Timed<T>[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await timeIt(() => fn(i)));
    if (between) await between(i);
  }
  return out;
}

export interface Round<T> {
  /** Wall time of the whole Promise.all — what a till full of staff actually waits. */
  roundMs: number;
  calls: Timed<T>[];
}

/**
 * `rounds` rounds of `concurrency` callers, each round a single Promise.all —
 * the shape tests/concurrency.test.ts (~L49-78) uses to put N callers on one
 * slot at once. The rounds themselves are sequential: overlapping them would
 * measure the runner's event loop rather than the database's locks.
 *
 * `between` runs after each round, outside both the round clock and the call
 * clocks, for the same reason as in runSerial.
 */
export async function runConcurrent<T>(
  rounds: number,
  concurrency: number,
  fn: (round: number, caller: number) => Promise<T>,
  between?: (round: number) => Promise<void>,
): Promise<Round<T>[]> {
  const out: Round<T>[] = [];
  for (let r = 0; r < rounds; r++) {
    const t0 = performance.now();
    const calls = await Promise.all(
      Array.from({ length: concurrency }, (_, c) => timeIt(() => fn(r, c))),
    );
    out.push({ roundMs: performance.now() - t0, calls });
    if (between) await between(r);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The code a row records for one failure.
 *
 * Postgres hands a PostgREST client a `code` (P0001 for `raise exception`,
 * 57014 for a statement timeout, 40001/40P01 for serialization and deadlock),
 * and the RPC's own name for the refusal is in the message. Both matter: the
 * booking contention invariant has to see P0001 AND SLOT_TAKEN, and has to
 * distinguish a legitimate loss from a deadlock that happens to have lost too.
 */
export function errorCode(error: unknown): string {
  if (error == null) return 'none';
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' && e.code ? e.code : 'unknown';
  const message = typeof e.message === 'string' ? e.message : String(error);
  // The app's own refusals are all P0001 with the code as the message; keeping
  // the message makes `errors` readable without opening the row's raw samples.
  const head = message.split(/[\s:(]/)[0] ?? '';
  return code === 'P0001' && head ? `P0001/${head}` : code;
}

/** A statement timeout, however it reached us (PostgREST code or bare message). */
export function isTimeout(error: unknown): boolean {
  if (error == null) return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === '57014') return true;
  const message = typeof e.message === 'string' ? e.message : String(error);
  return /statement timeout|57014|canceling statement/i.test(message);
}

/** Tally of codes, in the `errors` shape a row carries. */
export function tally(codes: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of codes) out[c] = (out[c] ?? 0) + 1;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collector for the asserted properties a row carries alongside its timing.
 *
 * A bench row that is fast and WRONG is worse than a slow one, so every
 * property the suite claims (exactly one winner under contention, exactly-once
 * replay) is recorded as a named check with the numbers that decided it.
 * compare.ts fails the run on `ok: false` regardless of the p95.
 */
export function invariants(): {
  check: (name: string, ok: boolean, detail: string) => void;
  done: () => Invariants;
} {
  const checks: InvariantCheck[] = [];
  return {
    check: (name, ok, detail) => {
      checks.push({ name, ok, detail });
    },
    done: () => ({ ok: checks.every((c) => c.ok), checks }),
  };
}

/** The `invariants` value for a row that asserts nothing beyond "it ran". */
export const NO_INVARIANTS: Invariants = { ok: true, checks: [] };

// ─────────────────────────────────────────────────────────────────────────────
// Row construction
// ─────────────────────────────────────────────────────────────────────────────

export interface RowInput {
  id: string;
  area: string;
  concurrency: number;
  /** Per-call samples, BEFORE warmup trimming. */
  callSamples: number[];
  /** Per-round samples, BEFORE warmup trimming. Omit for a serial row. */
  roundSamples?: number[];
  outcome: Outcome;
  errors?: Record<string, number>;
  invariants?: Invariants;
  expect?: Outcome;
  notes?: Record<string, number | string>;
  /** Warmup to drop from callSamples; defaults by concurrency. */
  warmupCalls?: number;
}

/**
 * Assemble one row, trimming warmup and summarising.
 *
 * A row with NO samples at all still produces a row — with a zeroed summary —
 * rather than being dropped. compare.ts treats a missing row id as a failure,
 * and an unreachable functions runtime or a refused RPC must surface as
 * `outcome: 'skipped'` / `'error:…'` on a row that is present, not as a hole the
 * comparer reads as "somebody deleted this benchmark".
 */
export function makeRow(input: RowInput): BenchRow {
  const zero: Summary = { n: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  const warmupCalls =
    input.warmupCalls ??
    (input.concurrency > 1 ? input.concurrency * WARMUP_ROUNDS : WARMUP_SERIAL);
  const calls = dropWarmup(input.callSamples, warmupCalls);
  const row: BenchRow = {
    id: input.id,
    area: input.area,
    concurrency: input.concurrency,
    unit: 'ms',
    outcome: input.outcome,
    perCall: calls.length > 0 ? summarize(calls) : zero,
    errors: input.errors ?? {},
    invariants: input.invariants ?? NO_INVARIANTS,
  };
  if (input.roundSamples && input.roundSamples.length > 0) {
    const rounds = dropWarmup(input.roundSamples, WARMUP_ROUNDS);
    row.perRound = rounds.length > 0 ? summarize(rounds) : zero;
  }
  if (input.expect) row.expect = input.expect;
  if (input.notes) row.notes = input.notes;
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run metadata
// ─────────────────────────────────────────────────────────────────────────────

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function cliVersion(): string {
  try {
    // `supabase --version` from packages/db, never from the repo root
    // (packages/db/CLAUDE.md). cwd is already packages/db when run.ts runs.
    return (
      execFileSync('npx', ['supabase', '--version'], { encoding: 'utf8', shell: true })
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /^\d+\.\d+\.\d+$/.test(l)) ?? 'unknown'
    );
  } catch {
    return 'unknown';
  }
}

/**
 * Where and on what the numbers were taken. NEVER compared (compare.ts ignores
 * `meta` entirely): a laptop and a GitHub runner differ by more than 10 % on
 * every row, so comparing them would make the rule meaningless. It is recorded
 * so a surprising baseline can be traced to the machine that produced it — which
 * is exactly why the committed baseline has to come from the CI runner.
 */
export function collectMeta(repeat: number): BenchMeta {
  const cpu = cpus();
  return {
    sha: gitSha(),
    node: process.version,
    cli: cliVersion(),
    os: `${osType()} ${release()} (${Math.round(totalmem() / 1024 ** 3)} GB)`,
    cpu: cpu[0]?.model?.trim() ?? 'unknown',
    cores: cpu.length,
    runner: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    startedAt: new Date().toISOString(),
    repeat,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

/** Write `results.json` under `outDir`, creating it. Returns the path written. */
export function writeResults(outDir: string, results: BenchResults): string {
  const path = join(outDir, 'results.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  return path;
}

/** Fixed-width summary table — what a run prints and what a reviewer reads. */
export function formatTable(rows: readonly BenchRow[]): string {
  const head = ['row', 'n', 'conc', 'p50 ms', 'p95 ms', 'outcome', 'inv'];
  const body = rows.map((r) => [
    r.id,
    String(r.perCall.n),
    String(r.concurrency),
    r.perCall.p50.toFixed(1),
    r.perCall.p95.toFixed(1),
    r.outcome,
    r.invariants.checks.length === 0 ? '-' : r.invariants.ok ? 'ok' : 'FAIL',
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n');
}
