import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './supabase';
import {
  EDGE_CACHE_TTL_MS,
  EdgeError,
  callEdge,
  invalidateEdgeCache,
  stableStringify,
  statusToEdgeCode,
  streamEdge,
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

  it('never retries an uncached call: a 502 may come after the write committed', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(502, {})));
    vi.stubGlobal('fetch', fetchMock);
    const err = await callEdge('staff-admin', { action: 'create' }, { ttlMs: 0 }).catch((e: unknown) => e);
    expect((err as EdgeError).code).toBe('UPSTREAM');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an uncached call when asked to', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(502, {}))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await callEdge('telegram-diagnose', { action: 'diagnose' }, { ttlMs: 0, retry: true })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

// ---------------------------------------------------------------------------
// streamEdge
// ---------------------------------------------------------------------------

/** A Response whose body arrives in the given chunks, split wherever the test says. */
function sse(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamEdge', () => {
  it('POSTs with the staff JWT and emits every event in order, whatever the chunk boundaries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sse([
        'event: message_start\ndata: {"conversation_id":"c1"}\n\nevent: del',
        'ta\ndata: {"text":"Hel',
        'lo"}\n\nevent: delta\ndata: {"text":" there"}\n\n',
        'event: done\ndata: {"message_id":"m1","stop_reason":"end_turn"}',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const seen: [string, unknown][] = [];

    await streamEdge('assistant-chat', { text: 'hi' }, { onEvent: (name, data) => seen.push([name, data]) });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/assistant-chat$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1');
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream');
    expect(init.body).toBe(JSON.stringify({ text: 'hi' }));
    expect(seen).toEqual([
      ['message_start', { conversation_id: 'c1' }],
      ['delta', { text: 'Hello' }],
      ['delta', { text: ' there' }],
      ['done', { message_id: 'm1', stop_reason: 'end_turn' }],
    ]);
  });

  it('maps a pre-stream JSON refusal through statusToEdgeCode', async () => {
    for (const [status, body, code] of [
      [401, {}, 'AUTH_REQUIRED'],
      [403, { code: 'FORBIDDEN', message: 'owner only' }, 'FORBIDDEN'],
      [429, { code: 'LLM_MONTHLY_CAP' }, 'RATE_LIMITED'],
      [503, { code: 'NOT_CONFIGURED' }, 'NOT_CONFIGURED'],
      [502, {}, 'UPSTREAM'],
    ] as const) {
      const fetchMock = vi.fn().mockResolvedValue(json(status, body));
      vi.stubGlobal('fetch', fetchMock);
      const onEvent = vi.fn();
      const err = await streamEdge('assistant-chat', {}, { onEvent }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EdgeError);
      expect((err as EdgeError).code).toBe(code);
      expect((err as EdgeError).status).toBe(status);
      expect(onEvent).not.toHaveBeenCalled();
      // Never retried: one billed request per press.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    const refused = await streamEdge('assistant-chat', {}, { onEvent: vi.fn() }).catch((e: unknown) => e);
    expect((refused as EdgeError).detail).toBeUndefined();
  });

  it('never caches: two identical calls are two fetches', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(sse(['event: done\ndata: {}\n\n'])));
    vi.stubGlobal('fetch', fetchMock);
    await streamEdge('assistant-chat', { a: 1 }, { onEvent: vi.fn() });
    await streamEdge('assistant-chat', { a: 1 }, { onEvent: vi.fn() });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes the abort signal through to fetch and throws AUTH_REQUIRED without a session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([]));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await streamEdge('assistant-chat', {}, { onEvent: vi.fn(), signal: controller.signal });
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal).toBe(controller.signal);

    stubSession(null);
    const err = await streamEdge('assistant-chat', {}, { onEvent: vi.fn() }).catch((e: unknown) => e);
    expect((err as EdgeError).code).toBe('AUTH_REQUIRED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
