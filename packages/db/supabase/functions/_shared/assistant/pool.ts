/**
 * A small bounded worker pool for the live job path (assistant-job runLive,
 * plan §4.3; JOB_LIVE_CONCURRENCY in estimate.ts). Pure: no Deno, no I/O,
 * so tests/assistant-job-pool.test.ts runs it under vitest.
 *
 *   - At most `concurrency` runs are in flight; items launch in index order.
 *   - `shouldStop()` is asked before every launch (the job's launch cutoff,
 *     liveClock below, its over-estimate check and the monthly cap,
 *     budgetAllows below). Its first non-null answer stops new launches;
 *     runs already in flight finish, so their usage is still accounted.
 *   - The first thrown error also stops new launches; in-flight runs finish
 *     and the error is returned, never re-thrown (no unhandled rejection).
 *   - `results[i]` is item i's value. Because launches go in order and the
 *     pool waits for every in-flight run, the finished items are a prefix of
 *     the list when nothing threw: the reduce step keeps chunk order.
 */

export interface PoolOptions<T, R> {
  items: readonly T[];
  concurrency: number;
  run(item: T, index: number): Promise<R>;
  /** Asked before each launch: a reason stops new launches, null goes on. */
  shouldStop?: () => string | null;
}

export interface PoolResult<R> {
  /** By item index; undefined for an item that never ran or threw. */
  results: (R | undefined)[];
  /** Runs that returned. */
  done: number;
  /** Runs started. */
  launched: number;
  /** The first `shouldStop()` reason, when one stopped the pool. */
  stopped: string | null;
  /** The first error a run threw; `hasError` tells a thrown `undefined` from none. */
  error: unknown;
  hasError: boolean;
}

export async function runPool<T, R>(opts: PoolOptions<T, R>): Promise<PoolResult<R>> {
  const { items, run, shouldStop } = opts;
  const width = Math.max(1, Math.min(Math.floor(opts.concurrency) || 1, items.length));
  const out: PoolResult<R> = { results: new Array(items.length), done: 0, launched: 0, stopped: null, error: undefined, hasError: false };
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length && !out.stopped && !out.hasError) {
      const reason = shouldStop?.() ?? null;
      if (reason) {
        out.stopped = reason;
        return;
      }
      const i = next++;
      out.launched++;
      try {
        out.results[i] = await run(items[i]!, i);
        out.done++;
      } catch (e) {
        if (!out.hasError) {
          out.hasError = true;
          out.error = e;
        }
      }
    }
  };

  if (items.length) await Promise.all(Array.from({ length: width }, worker));
  return out;
}

/**
 * The live job's clock (assistant-job runLive). The request's AbortController
 * fires at `started + wallMs`; launching chunks up to that same moment meant
 * every chunk still streaming was aborted with it (ProviderError TIMEOUT), so
 * the job took the generic error path, threw the finished objects away and
 * left no time for the reduce. Instead:
 *
 *   - `extractBy`: extraction streams are cut here (their own signal), so
 *     LIVE_REDUCE_BUDGET_MS is left for the reduce on the job's model before
 *     the request's own abort; a chunk cut here counts as not done.
 *   - `launchBy`: no chunk launches after it, LIVE_CHUNK_BUDGET_MS before
 *     `extractBy`, so a chunk launched in time can finish (the quota RPC, the
 *     row read and one Sonnet call at effort low).
 *
 * Both are clamped to `started`, so a tiny wall launches nothing rather than
 * going negative.
 */
export const LIVE_CHUNK_BUDGET_MS = 12_000;
export const LIVE_REDUCE_BUDGET_MS = 15_000;

export interface LiveClock {
  launchBy: number;
  extractBy: number;
}

export function liveClock(started: number, wallMs: number): LiveClock {
  const extractBy = Math.max(started, started + wallMs - LIVE_REDUCE_BUDGET_MS);
  return { extractBy, launchBy: Math.max(started, extractBy - LIVE_CHUNK_BUDGET_MS) };
}

/**
 * The monthly cap with calls in flight. `app.llm_begin_request` (0207) refuses
 * when month-to-date `llm_usage.cost_micros` has reached the cap, but that
 * figure only grows when a call is recorded, after it ends; with
 * JOB_LIVE_CONCURRENCY calls in flight each begin() would pass on the same
 * figure and the month could end up to that many calls over. So after begin()
 * passes, a chunk starts only while the month plus the other calls of this
 * job not yet in that figure (`othersUnrecorded`, at `perCallMicros` each)
 * stays under the cap — the call itself may still cross it, exactly as a lone
 * sequential call could (begin()'s own rule). `reading` is begin()'s return
 * value; one without the two figures (an older body) allows, since begin()
 * already passed.
 */
export function budgetAllows(reading: unknown, othersUnrecorded: number, perCallMicros: number): boolean {
  const r = reading && typeof reading === 'object' ? (reading as Record<string, unknown>) : null;
  const month = Number(r?.month_cost_micros);
  const cap = Number(r?.monthly_cap_micros);
  if (r?.month_cost_micros == null || r?.monthly_cap_micros == null || !Number.isFinite(month) || !Number.isFinite(cap)) return true;
  return month + Math.max(0, othersUnrecorded) * Math.max(0, perCallMicros) < cap;
}

/**
 * Runs `task`s one after another in the order they were queued, each after the
 * previous one settled, so writes land in order (the job's chunks_done and
 * tokens only ever grow). A failed task is logged by `onError` and does not
 * stop the queue. `drain()` waits for everything queued so far.
 */
export function serialQueue(onError: (e: unknown) => void = () => {}) {
  let tail: Promise<void> = Promise.resolve();
  return {
    push(task: () => Promise<unknown>): Promise<void> {
      tail = tail.then(task).then(
        () => undefined,
        (e) => onError(e),
      );
      return tail;
    },
    drain(): Promise<void> {
      return tail;
    },
  };
}
