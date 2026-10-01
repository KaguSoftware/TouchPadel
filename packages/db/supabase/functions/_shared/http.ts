/**
 * HTTP + error-mapping helpers shared by edge functions.
 *
 * The RPCs (packages/db/supabase/migrations) raise business errors as errcode
 * P0001 with a MESSAGE CODE ('SLOT_TAKEN', 'FORBIDDEN', ...) — PostgREST hands
 * these back as { code: 'P0001', message: '<CODE>', details, hint }. Raw
 * constraint slips (an RPC that didn't map 23P01 itself) surface with the
 * SQLSTATE as `code`. Both shapes are mapped here so till/replay clients see
 * one stable contract.
 *
 * It is also the one request layer every function goes through (2026-10-01
 * hardening): readJsonBody caps every body, errorResponse / pgErrorBody never
 * hand a caller raw database, vendor or exception text (the real message goes
 * to logError), fetchWithTimeout puts a deadline on every outbound call, and
 * handle() wraps each Deno.serve handler so a throw becomes a JSON 500. Plus
 * the small checks that used to be copied per function: isUuid,
 * constantTimeEqual, isLocalRuntime.
 *
 * PURE: no `Deno.*`, no `npm:` specifier, no supabase-js. The Node test suite
 * imports this module (tests/replay-transport.test.ts, tests/edge-http.test.ts),
 * and so do the pure assistant and payment modules. The caller-JWT client needs
 * supabase-js, so it is ./supabase.ts `callerClient`.
 */

// Record<string,string>, not HeadersInit: this module is also typechecked by the
// Node test suite (tests/replay-transport.test.ts), which has no DOM lib.
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export interface PgError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface MappedError {
  status: number;
  /** Stable machine code, e.g. 'SLOT_TAKEN', 'FORBIDDEN', 'EXCLUSION_CONFLICT'. */
  code: string;
  message: string;
  details?: string | null;
}

/** Exclusion-constraint conflict — replayed booking collides with a live one. */
export function isExclusionConflict(err: PgError): boolean {
  return err.code === '23P01' || err.message === 'SLOT_TAKEN';
}

const MESSAGE_CODE_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  PIN_INVALID: 403,
  PIN_LOCKED: 423,
  SLOT_TAKEN: 409,
  HOLD_EXPIRED: 409,
  DEGRADED_LOCKOUT: 503,
  COURT_NOT_FOUND: 404,
  RESERVATION_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
};

/**
 * Transient failures: the write was NOT judged, the server merely could not run
 * it right now. A queued till mutation that hits one of these must be retried
 * later, never recorded as a terminal outcome — recording it as a conflict is
 * exactly how a settle or a discount got lost (PHASE-2 criticals, C1).
 *
 *   40001 serialization_failure      40P01 deadlock_detected
 *   55P03 lock_not_available         57014 query_canceled (statement_timeout)
 *   53300 too_many_connections       53400 configuration_limit_exceeded
 *   57P01/02/03 admin/crash shutdown, cannot_connect_now
 *   08xxx connection exceptions      PGRST000/001 PostgREST could not reach or pool the database
 */
const RETRYABLE_SQLSTATES = new Set([
  '40001', '40P01', '55P03', '57014', '53300', '53400', '57P01', '57P02', '57P03',
  '08000', '08001', '08003', '08004', '08006', '08007', 'PGRST000', 'PGRST001',
]);

export function isRetryablePgError(err: PgError): boolean {
  const code = (err.code ?? '').toUpperCase();
  return RETRYABLE_SQLSTATES.has(code);
}

export function mapPgError(err: PgError): MappedError {
  const message = err.message ?? 'unknown database error';

  if (isExclusionConflict(err)) {
    return { status: 409, code: 'SLOT_TAKEN', message, details: err.details };
  }
  // Transient: 503 so a queue client releases the row and tries again later.
  if (isRetryablePgError(err)) {
    return { status: 503, code: 'RETRY_LATER', message, details: err.details };
  }
  // P0001 = our RAISE EXCEPTION convention; the message IS the machine code.
  if (err.code === 'P0001') {
    return {
      status: MESSAGE_CODE_STATUS[message] ?? 400,
      code: message,
      message,
      details: err.details,
    };
  }
  if (err.code === '23505') {
    return { status: 409, code: 'DUPLICATE', message, details: err.details };
  }
  // PGRST202: no such function — a mutation type whose RPC has not landed yet.
  if (err.code === 'PGRST202') {
    return { status: 501, code: 'RPC_NOT_DEPLOYED', message, details: err.details };
  }
  return { status: 500, code: err.code ?? 'INTERNAL', message, details: err.details };
}

/**
 * SQLSTATE classes whose failure is a property of the statement and its input:
 * the same bytes fail the same way on every retry (feature not supported,
 * cardinality, data exception, integrity, transaction state, routine and
 * cursor errors, authorization, syntax and access rule, WITH CHECK OPTION,
 * program limit, PL/pgSQL). Everything else at 5xx (connection, resources,
 * operator intervention, system and internal errors, PostgREST's own PGRST
 * codes, and no code at all: the request never reached Postgres) is the
 * server failing, not the write being judged.
 */
const DETERMINISTIC_SQLSTATE = /^(0A|21|22|23|25|26|27|28|2B|2D|2F|34|38|39|3B|3D|3F|42|44|54|P0)[0-9A-Z]{3}$/;

/**
 * replay (the till's durable queue): true when a refused write must NOT be
 * recorded in sync_replays. The till's sync worker retries every answer ≥ 500
 * (apps/operator-shell/src/main/sync-worker.ts); a sync_replays row written
 * before such an answer turns that retry into a 'duplicate' of a 'conflict', a
 * permanent refusal for a write the server never judged. So every ≥ 500 that
 * is not a deterministic SQLSTATE is answered without a record: 503
 * RETRY_LATER (the transient SQLSTATEs), 501 RPC_NOT_DEPLOYED (a till updated
 * ahead of its migration), 503 DEGRADED_LOCKOUT, and a transport-ish 500. A
 * 4xx refusal, and a 500 whose SQLSTATE is deterministic, keep their record.
 */
export function isUnjudgedReplayError(err: PgError): boolean {
  const mapped = mapPgError(err);
  if (mapped.status < 500) return false;
  if (mapped.code === 'RETRY_LATER' || mapped.code === 'RPC_NOT_DEPLOYED' || mapped.code === 'DEGRADED_LOCKOUT') return true;
  return !DETERMINISTIC_SQLSTATE.test((err.code ?? '').toUpperCase());
}

// ---------------------------------------------------------------------------
// What a caller may see of an error
// ---------------------------------------------------------------------------

/**
 * A refusal or a failure as a client sees it: a stable machine code, the HTTP
 * status and, when useful, a stable detail code. Never raw error text: log the
 * real message with logError() and answer with this.
 */
export function errorResponse(code: string, status: number, detail?: string, headers: Record<string, string> = {}): Response {
  return json(detail === undefined ? { error: code } : { error: code, detail }, status, headers);
}

/** The text of anything thrown or handed back as an error, for a server-side log line only. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown; details?: unknown };
    const parts = [e.code, e.message, e.details].filter((p): p is string => typeof p === 'string' && p !== '');
    if (parts.length) return parts.join(' | ');
  }
  return String(err);
}

/** console.error under a function tag: where the real message of a hidden error goes. */
export function logError(where: string, err: unknown, ...context: unknown[]): void {
  console.error(`[${where}]`, errorMessage(err), ...context);
}

/**
 * A database error as the caller may see it: mapPgError's code and status, with
 * `message` equal to the code. For a P0001 refusal that is exactly what it
 * always was (the message IS the code); for anything else it replaces the raw
 * Postgres / PostgREST text, which is logged instead.
 */
export function pgErrorBody(err: PgError, where: string): { status: number; body: { error: string; message: string } } {
  const mapped = mapPgError(err);
  if (err.code !== 'P0001') logError(where, err);
  return { status: mapped.status, body: { error: mapped.code, message: mapped.code } };
}

/**
 * CORS for browser callers (the operator renderer, a browser tab, Expo web).
 * The local stack's Kong answers the preflight itself; the hosted gateway hands
 * it to the function, so without this every hosted call from a page died in the
 * browser as a fetch TypeError ("No connection"). `*` is safe: callers
 * authenticate with a bearer token, never a cookie. The allowed headers are
 * what the clients send: lib/edge.ts (authorization, apikey, content-type) and
 * supabase-js `functions.invoke` (x-client-info).
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  // A fetch()ed response has immutable headers, so copy rather than set.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * The wrapper every Deno.serve handler goes through: a CORS preflight is
 * answered 204 before the handler runs, every answer carries CORS_HEADERS, and
 * anything thrown becomes a JSON 500 `{ error: 'INTERNAL' }`, or the function's
 * own `onError` answer for the callers that must always see 200 (Telegram,
 * GoTrue's hook, pg_net), and the real message goes to the log, never to the
 * caller.
 */
export function handle(
  name: string,
  fn: (req: Request) => Response | Promise<Response>,
  onError?: (req: Request) => Response,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    try {
      return withCors(await fn(req));
    } catch (err) {
      logError(name, err);
      return withCors(onError ? onError(req) : errorResponse('INTERNAL', 500));
    }
  };
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const KB = 1024;

export type BodyRead<T> =
  | { ok: true; value: T; raw: string }
  | { ok: false; reason: 'too_large' | 'bad_json'; response: Response };

/**
 * The request body as text, or null when it is (or declares itself) larger
 * than `maxBytes`. Reads the stream incrementally and stops at the cap, so an
 * oversized body is never buffered whole.
 */
export async function readTextCapped(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(chunk);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * The request body as a JSON object, capped at `maxBytes`.
 *   over the cap               → { ok: false, reason: 'too_large' }, 413 PAYLOAD_TOO_LARGE
 *   not JSON, or not an object → { ok: false, reason: 'bad_json' },  400 BAD_REQUEST
 * Each function keeps its own historical refusal for bad JSON through
 * `badJson` (the clients branch on those codes); `allowEmpty` reads an empty
 * body as `{}`.
 */
export async function readJsonBody<T extends object = Record<string, unknown>>(
  req: Request,
  opts: { maxBytes: number; allowEmpty?: boolean; badJson?: () => Response; tooLarge?: () => Response },
): Promise<BodyRead<T>> {
  const raw = await readTextCapped(req, opts.maxBytes);
  if (raw === null) {
    return { ok: false, reason: 'too_large', response: opts.tooLarge ? opts.tooLarge() : errorResponse('PAYLOAD_TOO_LARGE', 413) };
  }
  if (opts.allowEmpty && raw.trim() === '') return { ok: true, value: {} as T, raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'bad_json', response: opts.badJson ? opts.badJson() : errorResponse('BAD_REQUEST', 400) };
  }
  return { ok: true, value: parsed as T, raw };
}

// ---------------------------------------------------------------------------
// Outbound calls
// ---------------------------------------------------------------------------

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Both signals, as one: aborted as soon as either is. */
function eitherSignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const any = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === 'function') return any.call(AbortSignal, [a, b]);
  const ctrl = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * fetch with a deadline. The timeout covers the reply body too (an aborted
 * signal errors the body stream), so a stalled vendor can never hold an
 * invocation past its lease. A caller's own `init.signal` still applies.
 * `impl` lets a pure module keep its injected fetch.
 */
export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  ms: number = DEFAULT_FETCH_TIMEOUT_MS,
  impl?: FetchImpl,
): Promise<Response> {
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(ms)));
  const signal = init.signal ? eitherSignal(init.signal, timeout) : timeout;
  return (impl ?? fetch)(input, { ...init, signal });
}

/** True for the abort a timeout or a cancelled signal raises, whichever runtime threw it. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

// ---------------------------------------------------------------------------
// Small checks
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A canonical 8-4-4-4-12 hex uuid, any case. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/**
 * Compare two secrets without an early exit on the first differing character.
 * Different lengths answer false at once: only the length can leak, never the
 * content.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type EnvGetter = (name: string) => string | undefined;

/**
 * True only when this clearly runs under `supabase functions serve`: the
 * platform URL points at the local gateway. Anything else, including a missing
 * URL, counts as HOSTED. (Supabase injects no environment-name variable on
 * hosted, so the URL is the signal both runtimes share.)
 */
export function isLocalRuntime(get: EnvGetter): boolean {
  const url = (get('SUPABASE_URL') ?? '').trim();
  return /^http:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?(\/|$)/.test(url);
}
