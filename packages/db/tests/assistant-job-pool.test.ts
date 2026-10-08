/**
 * The live job's worker pool and its ordered progress queue
 * (_shared/assistant/pool.ts, assistant-job runLive, 2026-10-08):
 * bounded concurrency, results by chunk index, launches stop on a reason or
 * the first error while in-flight runs finish, and progress writes land in
 * order so chunks_done never steps back.
 */
import { describe, expect, it } from 'vitest';
import {
  budgetAllows,
  LIVE_CHUNK_BUDGET_MS,
  LIVE_REDUCE_BUDGET_MS,
  liveClock,
  runPool,
  serialQueue,
} from '../supabase/functions/_shared/assistant/pool.ts';

/** A promise the test settles by hand. */
function gate<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runPool', () => {
  it('never runs more than `concurrency` at once and keeps results by index', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const r = await runPool({
      items,
      concurrency: 4,
      run: async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // later items finish first: the results must still be by index
        await new Promise((res) => setTimeout(res, (10 - n) * 2));
        inFlight--;
        return n * 10;
      },
    });
    expect(peak).toBe(4);
    expect(r.results).toEqual(items.map((n) => n * 10));
    expect(r).toMatchObject({ done: 10, launched: 10, stopped: null, hasError: false });
  });

  it('launches in index order', async () => {
    const started: number[] = [];
    await runPool({ items: [0, 1, 2, 3, 4, 5], concurrency: 3, run: async (n) => void started.push(n) });
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('a stop reason halts new launches; the in-flight runs finish and are kept, and the finished items are a prefix', async () => {
    const gates = Array.from({ length: 8 }, () => gate());
    let stop = false;
    const p = runPool({
      items: [0, 1, 2, 3, 4, 5, 6, 7],
      concurrency: 3,
      shouldStop: () => (stop ? 'over_estimate' : null),
      run: async (n) => {
        await gates[n]!.promise;
        return `chunk ${n + 1}`;
      },
    });
    await tick();
    gates[0]!.resolve(); // item 0 finishes; item 3 launches
    await tick();
    stop = true; // e.g. spend just passed the estimate
    gates[1]!.resolve();
    gates[2]!.resolve();
    gates[3]!.resolve();
    const r = await p;
    expect(r.stopped).toBe('over_estimate');
    expect(r.launched).toBe(4);
    expect(r.done).toBe(4);
    expect(r.results.filter((x) => x !== undefined)).toEqual(['chunk 1', 'chunk 2', 'chunk 3', 'chunk 4']);
  });

  it('the first error stops new launches, in-flight runs still finish, and the error is returned, not thrown', async () => {
    const first = new Error('LLM_DAILY_QUOTA');
    const ran: number[] = [];
    const slow = gate();
    const r = await runPool({
      items: [0, 1, 2, 3, 4, 5],
      concurrency: 3,
      run: async (n) => {
        ran.push(n);
        if (n === 0) {
          await slow.promise; // in flight while the others fail
          return n;
        }
        if (n === 1) throw first;
        await tick();
        slow.resolve();
        throw new Error('later');
      },
    });
    expect(r.hasError).toBe(true);
    expect(r.error).toBe(first); // the first, not a later one
    expect(ran).toEqual([0, 1, 2]); // nothing launched after the error
    expect(r.launched).toBe(3);
    expect(r.results[0]).toBe(0); // the in-flight run finished and is kept
    expect(r.done).toBe(1);
  });

  it('a stop reason before the first launch runs nothing', async () => {
    let calls = 0;
    const r = await runPool({ items: [1, 2], concurrency: 4, shouldStop: () => 'wall', run: async () => void calls++ });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ stopped: 'wall', launched: 0, done: 0 });
  });

  it('empty input and odd widths are safe', async () => {
    expect((await runPool({ items: [], concurrency: 4, run: async () => 1 })).done).toBe(0);
    expect((await runPool({ items: [1, 2, 3], concurrency: 0, run: async (n) => n })).results).toEqual([1, 2, 3]);
    expect((await runPool({ items: [1, 2], concurrency: 99, run: async (n) => n })).results).toEqual([1, 2]);
  });
});

describe('serialQueue', () => {
  it('runs writes one after another in push order, and a write reads the latest figure when its turn comes', async () => {
    const stored: number[] = [];
    let inFlight = 0;
    let peak = 0;
    let finished = 0;
    const q = serialQueue();
    const write = (read: () => number) =>
      q.push(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        const v = read();
        await new Promise((r) => setTimeout(r, Math.random() * 3));
        stored.push(v);
        inFlight--;
      });
    for (let i = 0; i < 6; i++) {
      finished++;
      write(() => finished);
    }
    await q.drain();
    expect(peak).toBe(1);
    // never steps back
    for (let i = 1; i < stored.length; i++) expect(stored[i]!).toBeGreaterThanOrEqual(stored[i - 1]!);
    expect(stored.at(-1)).toBe(6);
  });

  it('a failed write is reported and the queue goes on', async () => {
    const errors: unknown[] = [];
    const done: string[] = [];
    const q = serialQueue((e) => errors.push(e));
    q.push(async () => {
      throw new Error('patch failed');
    });
    q.push(async () => void done.push('next'));
    await q.drain();
    expect(errors).toHaveLength(1);
    expect(done).toEqual(['next']);
  });

  it('drain waits for writes queued so far (a transition after it sees them all)', async () => {
    const q = serialQueue();
    const order: string[] = [];
    const g = gate();
    q.push(async () => {
      await g.promise;
      order.push('progress');
    });
    const drained = q.drain().then(() => order.push('transition'));
    await tick();
    expect(order).toEqual([]);
    g.resolve();
    await drained;
    expect(order).toEqual(['progress', 'transition']);
  });
});

// ---------------------------------------------------------------------------
// The live clock (review 2026-10-08): launching up to the same instant the
// request's AbortController fires aborted every chunk still streaming, so the
// job took the generic error path instead of TIMEOUT "re-run as batch" and the
// reduce had no time. The cutoff and the extraction cut now sit inside it.
// ---------------------------------------------------------------------------
describe('liveClock', () => {
  const WALL = 50_000; // assistant-job WALL_MS

  it('cuts extraction a reduce budget before the abort and stops launching a chunk budget before that', () => {
    const c = liveClock(1_000, WALL);
    expect(c.extractBy).toBe(1_000 + WALL - LIVE_REDUCE_BUDGET_MS);
    expect(c.launchBy).toBe(c.extractBy - LIVE_CHUNK_BUDGET_MS);
    expect(c.launchBy).toBeLessThan(c.extractBy);
    expect(c.extractBy).toBeLessThan(1_000 + WALL);
    // a real window to launch in at the shipped wall
    expect(c.launchBy - 1_000).toBeGreaterThanOrEqual(15_000);
  });

  it('a wall shorter than the budgets launches nothing and never goes before the start', () => {
    expect(liveClock(500, 10_000)).toEqual({ extractBy: 500, launchBy: 500 });
  });

  it('with a fake clock the pool launches nothing at or after launchBy, and every launched chunk finishes', async () => {
    let now = 0;
    const clock = liveClock(0, WALL);
    const launchedAt: number[] = [];
    const r = await runPool({
      items: Array.from({ length: 40 }, (_, i) => i),
      concurrency: 4,
      shouldStop: () => (now >= clock.launchBy ? 'wall' : null),
      run: async (i) => {
        launchedAt.push(now);
        await tick();
        now += 2_500; // each chunk moves the clock on
        return i;
      },
    });
    expect(r.stopped).toBe('wall');
    expect(r.hasError).toBe(false);
    expect(r.launched).toBeLessThan(40);
    expect(r.done).toBe(r.launched); // in-flight chunks were let finish, none aborted
    for (const t of launchedAt) expect(t).toBeLessThan(clock.launchBy);
    expect(r.results.slice(0, r.launched)).toEqual(Array.from({ length: r.launched }, (_, i) => i));
  });

  it('a chunk cut on its own signal counts as not done, not as the error (the runLive pattern)', async () => {
    const cut = new AbortController();
    const g = gate();
    const running = runPool({
      items: [0, 1],
      concurrency: 2,
      run: async (i) => {
        try {
          if (i === 1) await new Promise((_, rej) => cut.signal.addEventListener('abort', () => rej(new Error('aborted'))));
          else await g.promise;
          return i;
        } catch (e) {
          if (cut.signal.aborted) return null; // cut by the clock
          throw e;
        }
      },
    });
    await tick();
    cut.abort();
    g.resolve();
    const r = await running;
    expect(r.hasError).toBe(false);
    expect(r.results).toEqual([0, null]);
    // runLive keeps `!= null`: one object of two, so the job ends in TIMEOUT "re-run as batch"
    expect(r.results.filter((o) => o != null)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The monthly cap with calls in flight (review 2026-10-08): begin()'s
// month-to-date figure only grows when a call is recorded, so four chunks could
// all pass on the same figure. budgetAllows counts this job's unrecorded calls.
// ---------------------------------------------------------------------------
describe('budgetAllows', () => {
  const reading = (month: number, cap: number) => ({ month_cost_micros: month, monthly_cap_micros: cap, requests_today: 3, daily_limit: 200 });

  it('a lone call starts while the month is under the cap, as begin() rules (it may cross it itself)', () => {
    expect(budgetAllows(reading(999_999, 1_000_000), 0, 50_000)).toBe(true);
    expect(budgetAllows(reading(1_000_000, 1_000_000), 0, 50_000)).toBe(false);
  });

  it('counts the other calls in flight at the per-call price', () => {
    // $0.05 left, each chunk about $0.02: with 2 others in flight there is $0.01 left for this one
    expect(budgetAllows(reading(950_000, 1_000_000), 2, 20_000)).toBe(true);
    expect(budgetAllows(reading(950_000, 1_000_000), 3, 20_000)).toBe(false);
  });

  it('the review scenario: four chunks on $0.05 left at $0.05 a chunk start one, not four', () => {
    const r = reading(950_000, 1_000_000);
    let unrecorded = 0;
    let started = 0;
    for (let i = 0; i < 4; i++) {
      if (!budgetAllows(r, unrecorded, 50_000)) break;
      unrecorded++;
      started++;
    }
    expect(started).toBe(1);
  });

  it('a reading without the figures (an older begin body) or nonsense allows: begin() already passed', () => {
    expect(budgetAllows(null, 3, 50_000)).toBe(true);
    expect(budgetAllows({ requests_today: 1 }, 3, 50_000)).toBe(true);
    expect(budgetAllows({ month_cost_micros: 'x', monthly_cap_micros: 5 }, 3, 50_000)).toBe(true);
  });

  it('negative inputs never loosen the rule', () => {
    expect(budgetAllows(reading(1_000_000, 1_000_000), -5, -1)).toBe(false);
  });
});
