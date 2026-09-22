/**
 * Edge-function client (operator-slice.md §6). Functions run server-side with
 * the caller's JWT; PostHog/Groq keys never reach the renderer.
 *
 * - 30 s in-memory cache of SUCCESSFUL responses keyed by `cacheKey ?? fn + body`.
 * - Status → code map; one automatic retry on 5xx (never on 503 NOT_CONFIGURED).
 * - Throws `EdgeError`; lib/errors.ts maps it to `op.errors.EDGE_<code>`.
 */
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { parseSseChunk, parseSseData } from '../features/assistant/sse';

export type EdgeFunctionName =
  | 'analytics-posthog'
  | 'analytics-insights'
  | 'staff-admin'
  | 'desk-customer-create'
  | 'telegram-diagnose'
  | 'assistant-chat'
  | 'assistant-index'
  | 'assistant-job'
  | 'assistant-component';

export type EdgeErrorCode =
  'NOT_CONFIGURED' | 'FORBIDDEN' | 'AUTH_REQUIRED' | 'UPSTREAM' | 'RATE_LIMITED' | 'UNKNOWN';

export class EdgeError extends Error {
  readonly status: number;
  readonly code: EdgeErrorCode;
  /** Server-supplied detail (never shown raw to staff; for logs/debug). */
  readonly detail?: string;

  constructor(status: number, code: EdgeErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'EdgeError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const EDGE_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  expires: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

/** Drop cached responses; with a prefix only keys starting with it ("recheck"). */
export function invalidateEdgeCache(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** JSON with object keys sorted so equal bodies produce equal cache keys. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function bodyCode(body: unknown): string | undefined {
  if (body !== null && typeof body === 'object' && 'code' in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  // staff-admin / desk-customer-create answer `{ error: 'DUPLICATE_PHONE', message }`:
  // an upper-snake `error` IS the code (a prose `error` string is not).
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: unknown }).error;
    return typeof err === 'string' && /^[A-Z][A-Z0-9_]*$/.test(err) ? err : undefined;
  }
  return undefined;
}

function bodyMessage(body: unknown): string | undefined {
  if (body !== null && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown; reason?: unknown };
    for (const v of [b.message, b.error, b.reason]) if (typeof v === 'string') return v;
  }
  return undefined;
}

/** HTTP status (+ optional JSON body) → EdgeErrorCode. */
export function statusToEdgeCode(status: number, body?: unknown): EdgeErrorCode {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503 && bodyCode(body) === 'NOT_CONFIGURED') return 'NOT_CONFIGURED';
  if (status >= 500) return 'UPSTREAM';
  return 'UNKNOWN';
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export interface CallEdgeOptions {
  /** Override the cache key (default `${fn}:${stableStringify(body)}`). */
  cacheKey?: string;
  /** Cache TTL; 0 disables caching for this call. */
  ttlMs?: number;
  signal?: AbortSignal;
}

export function edgeCacheKey(fn: EdgeFunctionName, body: unknown): string {
  return `${fn}:${stableStringify(body)}`;
}

/** POST JSON to `/functions/v1/{fn}` with the staff JWT; resolves to the parsed JSON body. */
export async function callEdge<Req, Res>(
  fn: EdgeFunctionName,
  body: Req,
  opts: CallEdgeOptions = {},
): Promise<Res> {
  const key = opts.cacheKey ?? edgeCacheKey(fn, body);
  const ttl = opts.ttlMs ?? EDGE_CACHE_TTL_MS;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Res;
  if (hit) cache.delete(key);

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new EdgeError(401, 'AUTH_REQUIRED', 'no staff session');

  const url = `${supabaseUrl}/functions/v1/${fn}`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
    signal: opts.signal,
  };

  let retried = false;
  for (;;) {
    const res = await fetch(url, init);
    const payload = await parseBody(res);
    if (res.ok) {
      if (ttl > 0) cache.set(key, { expires: Date.now() + ttl, value: payload });
      return payload as Res;
    }
    const code = statusToEdgeCode(res.status, payload);
    if (res.status >= 500 && code !== 'NOT_CONFIGURED' && !retried) {
      retried = true;
      continue;
    }
    throw new EdgeError(
      res.status,
      code,
      bodyMessage(payload) ?? `edge ${fn} failed with ${res.status}`,
      bodyCode(payload),
    );
  }
}

// ---------------------------------------------------------------------------
// streamEdge — the assistant's `text/event-stream` door (contracts §Lane D)
// ---------------------------------------------------------------------------

export interface StreamEdgeOptions {
  /** Called once per SSE event, in order, with the JSON-parsed `data`. */
  onEvent: (name: string, data: unknown) => void;
  /** The Stop button: aborting rejects the fetch with an AbortError. */
  signal?: AbortSignal;
}

/**
 * POST to `/functions/v1/{fn}` and read the response as server-sent events.
 * Same JWT header and error mapping as `callEdge`: a non-2xx response is a
 * plain JSON body (the edge refuses auth and quota before it starts to stream)
 * and becomes an `EdgeError` through `statusToEdgeCode`. Never cached, never
 * retried: a stream that broke half-way already showed the owner half an
 * answer, and repeating a billed model call behind their back is not a retry.
 */
export async function streamEdge<Req>(fn: EdgeFunctionName, body: Req, opts: StreamEdgeOptions): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new EdgeError(401, 'AUTH_REQUIRED', 'no staff session');

  const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body ?? {}),
    signal: opts.signal,
  });

  if (!res.ok) {
    const payload = await parseBody(res);
    throw new EdgeError(
      res.status,
      statusToEdgeCode(res.status, payload),
      bodyMessage(payload) ?? `edge ${fn} failed with ${res.status}`,
      bodyCode(payload),
    );
  }

  const emit = (events: readonly { event: string; data: string }[]) => {
    for (const ev of events) opts.onEvent(ev.event, parseSseData(ev.data));
  };

  if (!res.body) {
    // A 2xx with no streaming body (a test double, or a proxy that buffered
    // the whole thing): treat the text as one chunk.
    const text = await res.text();
    emit(parseSseChunk(text.endsWith('\n\n') ? text : `${text}\n\n`).events);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    emit(parsed.events);
  }
  buffer += decoder.decode();
  // A final event the server did not terminate with a blank line still counts.
  if (buffer.trim() !== '') emit(parseSseChunk(`${buffer}\n\n`).events);
}
