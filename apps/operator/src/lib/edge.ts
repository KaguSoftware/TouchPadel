/**
 * Edge-function client (operator-slice.md §6). Functions run server-side with
 * the caller's JWT; PostHog/Groq keys never reach the renderer.
 *
 * - 30 s in-memory cache of SUCCESSFUL responses keyed by `cacheKey ?? fn + body`.
 * - Status → code map; one automatic retry on 5xx (never on 503 NOT_CONFIGURED).
 * - Throws `EdgeError`; lib/errors.ts maps it to `op.errors.EDGE_<code>`.
 */
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

export type EdgeFunctionName = 'analytics-posthog' | 'analytics-insights';

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
