import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  normalizeTimeout,
  startDeadline,
  timeoutFetch,
  withRequestTimeout,
} from './timeout';
import { isRetryableError } from './retry';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A fetch that never answers unless its signal aborts — the swallowed request. */
function hangingFetch() {
  const seen: (AbortSignal | undefined)[] = [];
  const fetchImpl = vi.fn((_input: unknown, init?: RequestInit) => {
    seen.push(init?.signal ?? undefined);
    return new Promise<Response>((_resolve, reject) => {
      // React Native rejects an abort with a plain AbortError, whatever the reason.
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen, calls: fetchImpl };
}

describe('RequestTimeoutError', () => {
  it('is a retryable TypeError named like the platform timeout', () => {
    const e = new RequestTimeoutError(15_000, 'hold_slot');
    expect(e).toBeInstanceOf(TypeError);
    expect(e.name).toBe('TimeoutError');
    expect(e.message).toBe('Request timed out after 15000 ms (hold_slot)');
    expect(isRetryableError(e)).toBe(true);
  });
});

describe('normalizeTimeout', () => {
  it('falls back only when the caller said nothing, and reads null/0/NaN as no deadline', () => {
    expect(normalizeTimeout(undefined, DEFAULT_REQUEST_TIMEOUT_MS)).toBe(15_000);
    expect(normalizeTimeout(60_000, DEFAULT_REQUEST_TIMEOUT_MS)).toBe(60_000);
    expect(normalizeTimeout(null, DEFAULT_REQUEST_TIMEOUT_MS)).toBeNull();
    expect(normalizeTimeout(0, DEFAULT_REQUEST_TIMEOUT_MS)).toBeNull();
    expect(normalizeTimeout(Number.NaN, DEFAULT_REQUEST_TIMEOUT_MS)).toBeNull();
    expect(normalizeTimeout(Number.POSITIVE_INFINITY, 1)).toBeNull();
  });
});

describe('startDeadline', () => {
  it('aborts its signal when it fires and says it timed out', () => {
    const d = startDeadline(1_000);
    expect(d.signal.aborted).toBe(false);
    vi.advanceTimersByTime(999);
    expect(d.timedOut()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(d.signal.aborted).toBe(true);
    expect(d.timedOut()).toBe(true);
  });

  it('follows a parent abort without calling it a timeout', () => {
    const parent = new AbortController();
    const d = startDeadline(1_000, parent.signal);
    parent.abort();
    expect(d.signal.aborted).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(d.timedOut()).toBe(false);
  });

  it('clear() stops the timer', () => {
    const d = startDeadline(1_000);
    d.clear();
    vi.advanceTimersByTime(5_000);
    expect(d.signal.aborted).toBe(false);
    expect(d.timedOut()).toBe(false);
  });
});

describe('withRequestTimeout', () => {
  it('rejects with RequestTimeoutError, not the platform AbortError', async () => {
    const { fetchImpl } = hangingFetch();
    const p = withRequestTimeout(2_000, (signal) => fetchImpl('https://x/rest/v1/rpc/hold_slot', { signal }), { what: 'hold_slot' });
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    const err = await caught;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect((err as Error).message).toContain('hold_slot');
  });

  it('releases the caller even when the call ignores its signal', async () => {
    const p = withRequestTimeout(1_000, () => new Promise<never>(() => {}));
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await caught).toBeInstanceOf(RequestTimeoutError);
  });

  it('passes a result and a real error straight through', async () => {
    await expect(withRequestTimeout(1_000, async () => 42)).resolves.toBe(42);
    await expect(withRequestTimeout(1_000, async () => Promise.reject(new Error('SLOT_TAKEN')))).rejects.toThrow('SLOT_TAKEN');
  });

  it('runs with no deadline when told null', async () => {
    let signal: AbortSignal | undefined = new AbortController().signal;
    await withRequestTimeout(null, async (s) => {
      signal = s;
    });
    expect(signal).toBeUndefined();
  });
});

describe('timeoutFetch', () => {
  it('gives an unsignalled request the deadline its URL calls for', async () => {
    const { fetchImpl, seen } = hangingFetch();
    const f = timeoutFetch(fetchImpl, (url) => (url.includes('/storage/') ? null : 5_000));
    const caught = f('https://p.supabase.co/rest/v1/courts?select=*').catch((e: unknown) => e);
    expect(seen[0]).toBeDefined();
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await caught;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect((err as Error).message).toBe('Request timed out after 5000 ms (/rest/v1/courts)');
  });

  it('leaves uploads (null) and a caller-owned signal alone', async () => {
    const { fetchImpl, seen } = hangingFetch();
    const f = timeoutFetch(fetchImpl, (url) => (url.includes('/storage/') ? null : 5_000));
    void f('https://p.supabase.co/storage/v1/object/staff-media/a.jpg', { method: 'POST' });
    expect(seen[0]).toBeUndefined();
    const own = new AbortController();
    void f('https://p.supabase.co/rest/v1/rpc/report_x', { signal: own.signal });
    expect(seen[1]).toBe(own.signal);
  });

  it('keeps the timer running after the headers so a stalled body is cut too', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = (async (_i: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const res = await timeoutFetch(fetchImpl, () => 1_000)('https://x/rest/v1/a');
    expect(res.status).toBe(200);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(true);
  });
});
