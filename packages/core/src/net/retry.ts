/**
 * The one retry policy for every client (operator, mobile, web).
 *
 * A failed request is worth sending again only when the server never judged
 * it: the request did not arrive, the answer did not come back, the database
 * could not run it right now. Everything else is a decision, and asking again
 * gets the same answer after a delay the person sat through for nothing:
 *
 *   retry   network failures, timeouts and aborts, HTTP 429 and 5xx from an
 *           edge call (unless the 5xx names a decision, `NOT_CONFIGURED`),
 *           and the transient SQLSTATEs (deadlock, statement timeout, …)
 *   never   a raised `P0001` business code (FORBIDDEN, NOT_CANCELLABLE, …),
 *           any other SQLSTATE (a constraint, a permission, a missing
 *           function), and any 4xx
 *
 * Pure and duck-typed: it reads `name`, `message`, `code`, `pgCode`, `status`
 * and `context.status`, so it understands a raw PostgrestError object, the
 * operator's AppRpcError and EdgeError, mobile's edge errors, the auth and
 * functions clients' errors and a platform fetch failure without importing
 * any of them.
 */

/**
 * SQLSTATEs (and PostgREST codes) that mean "could not run it right now",
 * never "no". Mirrors RETRYABLE_SQLSTATES in
 * packages/db/supabase/functions/_shared/http.ts (the replay function's
 * transient list), plus PostgREST's schema-cache (PGRST002) and pool-timeout
 * (PGRST003) answers.
 *
 *   40001 serialization_failure      40P01 deadlock_detected
 *   55P03 lock_not_available         57014 query_canceled (statement_timeout)
 *   53300 too_many_connections       53400 configuration_limit_exceeded
 *   57P01/02/03 shutdown, cannot_connect_now        08xxx connection exceptions
 */
export const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set([
  '40001',
  '40P01',
  '55P03',
  '57014',
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
]);

/**
 * Codes that say "later", not "no": the operator's EdgeError for a 5xx
 * (`UPSTREAM`) and a 429 (`RATE_LIMITED`), the replay function's transient
 * answer (`RETRY_LATER`), and the client-side `TIMEOUT` / `NETWORK`.
 */
export const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  'UPSTREAM',
  'RATE_LIMITED',
  'RETRY_LATER',
  'TIMEOUT',
  'NETWORK',
]);

/**
 * Messages the platforms' fetch implementations produce when nothing came
 * back. Anchored at the start of the message, after the `TypeError: ` /
 * `FetchError: ` prefix postgrest-js and auth-js prepend when they wrap a
 * thrown fetch. (Moved here from apps/mobile/src/lib/network.ts, which now
 * reads this list.)
 */
const TRANSPORT_MESSAGES: readonly RegExp[] = [
  /^Network request failed/i, // React Native fetch (iOS + Android)
  /^fetch failed/i, // undici / node
  /^Failed to fetch/i, // Chromium (and Electron)
  /^NetworkError when attempting to fetch resource/i, // Firefox
  /^Load failed/i, // WebKit
  /^The network connection was lost/i, // NSURLErrorNetworkConnectionLost
  /^The request timed out/i, // NSURLErrorTimedOut
  /^The Internet connection appears to be offline/i, // NSURLErrorNotConnectedToInternet
  /^Could not connect to the server/i, // NSURLErrorCannotConnectToHost
  /^A server with the specified hostname could not be found/i, // NSURLErrorCannotFindHost
  /^Unable to resolve host/i, // Android
  /^Software caused connection abort/i, // Android
  /^Connection reset/i,
  /^socket hang up/i,
  // Node/undici prefix these with the syscall ("connect ECONNREFUSED …").
  /(?:^|\s)ECONN(?:REFUSED|RESET|ABORTED)\b/i,
  /(?:^|\s)ETIMEDOUT\b/i,
  /(?:^|\s)ENOTFOUND\b/i,
  /(?:^|\s)EAI_AGAIN\b/i,
  /^Request timed out/i, // RequestTimeoutError (./timeout.ts)
];

/**
 * Error names that mean the request was cut off before an answer. NOT
 * 'AbortError': an abort is retried (isRetryableError) but is not proof of a
 * dead connection — a screen that unmounted aborts too.
 */
const TRANSPORT_NAMES: ReadonlySet<string> = new Set([
  'TimeoutError',
  'AuthRetryableFetchError',
  'FunctionsFetchError',
]);

/** A raised app code read as a message: `SLOT_TAKEN`, `FORBIDDEN`. */
const BUSINESS_MESSAGE = /^[A-Z][A-Z0-9_]{3,}$/;
/** An upper-snake code field. */
const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;
/** A SQLSTATE (five characters, at least one digit) or a PostgREST code. */
const SQLSTATE = /^(?=[0-9A-Z]*\d)[0-9A-Z]{5}$|^PGRST\d{3}$/;
/** A gateway's text or HTML body for a 5xx, which carries no code at all. */
const GATEWAY_BODY = /\b50[0-4]\b|bad gateway|service unavailable|gateway time-?out|upstream connect error/i;

type Loose = Record<string, unknown>;

const asObject = (err: unknown): Loose | null =>
  err !== null && typeof err === 'object' ? (err as Loose) : null;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Best-effort message for Error instances, PostgREST error objects and strings. */
export function errorMessage(err: unknown): string | null {
  if (typeof err === 'string') return err;
  const o = asObject(err);
  return o && typeof o.message === 'string' ? o.message : null;
}

/** The error's `name`, or the `Name` of a `Name: message` wrapper postgrest-js wrote. */
function nameOf(err: unknown): string | null {
  const o = asObject(err);
  const own = o ? str(o.name) : null;
  if (own && own !== 'Error') return own;
  const m = errorMessage(err);
  const wrapped = m ? /^([A-Za-z]*Error):\s/.exec(m) : null;
  return wrapped?.[1] ?? own;
}

/**
 * True when the request never reached, or never came back from, the server
 * (offline, DNS, reset, timeout). The display rule for "no connection".
 */
export function isTransportFailure(err: unknown): boolean {
  if (!err) return false;
  const o = asObject(err);
  if (o) {
    const name = str(o.name);
    if (name && TRANSPORT_NAMES.has(name)) return true;
    // auth-js reports a failed fetch as an Auth*Error carrying status 0. Any
    // other object with a zero status says nothing about connectivity.
    if (o.status === 0 && name?.startsWith('Auth')) return true;
  }
  const raw = errorMessage(err);
  if (!raw) return false;
  const message = raw.replace(/^[A-Za-z]*Error:\s*/, '').trim();
  return TRANSPORT_MESSAGES.some((re) => re.test(message));
}

/** An aborted request: a DOM/RN AbortError, or postgrest-js's `AbortError: …` wrapper of one. */
export function isAbortFailure(err: unknown): boolean {
  const o = asObject(err);
  if (o && o.code === 'ABORT_ERR') return true;
  return nameOf(err) === 'AbortError';
}

/** A client-side timeout: RequestTimeoutError, a platform TimeoutError, or postgrest-js's wrapper of one. */
export function isTimeoutFailure(err: unknown): boolean {
  return nameOf(err) === 'TimeoutError';
}

/** The HTTP status an error carries, when it carries one (0 = no response, read as none). */
function httpStatusOf(o: Loose): number | null {
  if (typeof o.status === 'number' && o.status > 0) return o.status;
  const ctx = asObject(o.context);
  if (ctx && typeof ctx.status === 'number' && ctx.status > 0) return ctx.status;
  return null;
}

/**
 * Whether sending the same request again could get a different answer. The
 * default `retry` predicate of every QueryClient, and the guard on every
 * automatic mutation retry (which additionally needs an idempotency key).
 */
export function isRetryableError(err: unknown): boolean {
  if (err == null) return false;
  if (isTimeoutFailure(err) || isAbortFailure(err) || isTransportFailure(err)) return true;

  const o = asObject(err) ?? {};
  // A relay failure in front of an edge function: the function never ran.
  if (o.name === 'FunctionsRelayError') return true;

  // The SQLSTATE: the operator's AppRpcError keeps it as `pgCode`; a raw
  // PostgrestError carries it as `code`.
  const sqlstate = [str(o.pgCode), str(o.code)].find((c) => c !== null && SQLSTATE.test(c)) ?? null;
  if (sqlstate && RETRYABLE_SQLSTATES.has(sqlstate)) return true;
  if (sqlstate === 'P0001') return false;

  // The operator's EdgeError carries the HTTP class as `kind` and, as `code`,
  // the error catalogue's name for the refusal: the server's own code, or
  // `EDGE_<kind>` when the body named none. `EDGE_<kind>` only restates the
  // class, so it is read through `kind`, never as a decision of its own.
  const rawCode = str(o.code);
  const code = rawCode !== null && rawCode.startsWith('EDGE_') ? null : rawCode;
  const kind = str(o.kind);
  if (code && TRANSIENT_CODES.has(code)) return true;
  // A code that names a decision (FORBIDDEN, NOT_CONFIGURED, DEGRADED_LOCKOUT),
  // or an edge class that is one. 'UNKNOWN' is the operator's "no code came
  // back", which decides nothing.
  const decided =
    (code !== null && code !== 'UNKNOWN' && !SQLSTATE.test(code) && UPPER_SNAKE.test(code)) ||
    (kind !== null && kind !== 'UNKNOWN' && !TRANSIENT_CODES.has(kind) && UPPER_SNAKE.test(kind));

  const status = httpStatusOf(o);
  if (status !== null) {
    if (status === 429) return true;
    if (status >= 500) return !decided;
    return false; // 4xx (and anything else that answered): the server decided
  }
  if (decided || sqlstate) return false;

  const message = errorMessage(err)?.trim() ?? '';
  if (TRANSIENT_CODES.has(message)) return true;
  if (BUSINESS_MESSAGE.test(message)) return false;
  // postgrest-js hands a gateway's non-JSON 5xx body back as `{ message: body }`.
  return code === null && GATEWAY_BODY.test(message);
}
