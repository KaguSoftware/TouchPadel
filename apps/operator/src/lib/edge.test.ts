import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './supabase';
import {
  EDGE_CACHE_TTL_MS,
  EdgeError,
  callEdge,
  invalidateEdgeCache,
  stableStringify,
  statusToEdgeCode,
} from './edge';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubSession(token: string | null) {
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: token ? { access_token: token } : null },
    error: null,
  } as never);
}

beforeEach(() => {
  invalidateEdgeCache();
  stubSession('jwt-1');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('statusToEdgeCode', () => {
  it('maps the documented statuses', () => {
    expect(statusToEdgeCode(401)).toBe('AUTH_REQUIRED');
    expect(statusToEdgeCode(403)).toBe('FORBIDDEN');
    expect(statusToEdgeCode(429)).toBe('RATE_LIMITED');
    expect(statusToEdgeCode(503, { code: 'NOT_CONFIGURED' })).toBe('NOT_CONFIGURED');
    expect(statusToEdgeCode(503)).toBe('UPSTREAM');
    expect(statusToEdgeCode(502)).toBe('UPSTREAM');
    expect(statusToEdgeCode(500)).toBe('UPSTREAM');
    expect(statusToEdgeCode(400)).toBe('UNKNOWN');
    expect(statusToEdgeCode(404)).toBe('UNKNOWN');
  });
});

describe('stableStringify', () => {
  it('is key-order independent and drops undefined', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }),
    );
  });
});

describe('callEdge', () => {
  it('POSTs JSON with the staff JWT and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, n: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await callEdge<{ q: number }, { ok: boolean; n: number }>('analytics-posthog', {
      q: 1,
    });

    expect(res).toEqual({ ok: true, n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/analytics-posthog$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    expect(init.body).toBe(JSON.stringify({ q: 1 }));
  });

  it('caches successful responses for 30 s, then refetches', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { v: 1 }))
      .mockResolvedValueOnce(json(200, { v: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await callEdge('analytics-insights', { a: 1 })).toEqual({ v: 1 });
    vi.advanceTimersByTime(EDGE_CACHE_TTL_MS - 1_000);
    expect(await callEdge('analytics-insights', { a: 1 })).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(await callEdge('analytics-insights', { a: 1 })).toEqual({ v: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateEdgeCache(prefix) only drops matching keys', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(200, { ok: 1 })));
    vi.stubGlobal('fetch', fetchMock);

    await callEdge('analytics-insights', { a: 1 });
    await callEdge('analytics-posthog', { a: 1 });
    invalidateEdgeCache('analytics-insights');
    await callEdge('analytics-insights', { a: 1 });
    await callEdge('analytics-posthog', { a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries exactly once on 5xx, then surfaces UPSTREAM', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(502, { message: 'bad gateway' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await callEdge('analytics-posthog', { x: 1 })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    invalidateEdgeCache();
    const failing = vi.fn().mockImplementation(() => Promise.resolve(json(500, {})));
    vi.stubGlobal('fetch', failing);
    const err = await callEdge('analytics-posthog', { x: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EdgeError);
    expect((err as EdgeError).code).toBe('UPSTREAM');
    expect((err as EdgeError).status).toBe(500);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('does not retry 503 NOT_CONFIGURED and never caches failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(503, { code: 'NOT_CONFIGURED' }))
      .mockResolvedValueOnce(json(200, { configured: true }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await callEdge('analytics-posthog', { y: 1 }).catch((e: unknown) => e);
    expect((err as EdgeError).code).toBe('NOT_CONFIGURED');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await callEdge('analytics-posthog', { y: 1 })).toEqual({ configured: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps 401/403/429 without retrying', async () => {
    for (const [status, code] of [
      [401, 'AUTH_REQUIRED'],
      [403, 'FORBIDDEN'],
      [429, 'RATE_LIMITED'],
    ] as const) {
      invalidateEdgeCache();
      const fetchMock = vi.fn().mockResolvedValue(json(status, {}));
      vi.stubGlobal('fetch', fetchMock);
      const err = await callEdge('analytics-insights', { status }).catch((e: unknown) => e);
      expect((err as EdgeError).code).toBe(code);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('throws AUTH_REQUIRED before fetching when there is no session', async () => {
    stubSession(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const err = await callEdge('analytics-insights', {}).catch((e: unknown) => e);
    expect((err as EdgeError).code).toBe('AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
