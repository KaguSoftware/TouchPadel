/**
 * Transport-failure classification — the ONE place that decides whether an
 * error means "the request never reached, or never came back from, the server".
 *
 * Consumers:
 *   - lib/queryClient.ts   retries ONLY transport failures (an RPC decision is final);
 *   - features/booking/errors.ts   renders `errors.network` ONLY for these.
 *
 * Everything else — a PostgREST 4xx, an RLS denial, schema drift after a deploy,
 * an app.* business code — is not a connection problem and must never be
 * labelled "No connection. Check your internet". The previous classifier was
 * `/network|fetch|timeout|abort/i` over the whole message, which also matched a
 * `statement timeout`, any PostgREST hint that mentioned fetch, and an aborted
 * transaction — so real server errors on the phone read as "no internet".
 *
 * Pure: no RN / supabase imports (unit-tested under node).
 */

/**
 * Messages the platforms' fetch implementations produce when nothing came back.
 * Anchored at the start of the message, after the `TypeError: ` / `FetchError: `
 * prefix postgrest-js and gotrue-js prepend when they wrap a thrown fetch.
 */
const TRANSPORT_MESSAGES: readonly RegExp[] = [
  /^Network request failed/i, // React Native fetch (iOS + Android)
  /^fetch failed/i, // undici / node
  /^Failed to fetch/i, // Chromium
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
  /^Request timed out/i,
];

/**
 * Error names that mean the request was cut off client-side. NOT 'AbortError':
 * TanStack Query aborts its signal on unmount / superseded refetch, so an
 * abort means "nobody is waiting for this response any more", not "no
 * connection" — it must never render the offline message. Nothing in this app
 * aborts fetches as a timeout; a runtime timeout throws 'TimeoutError'.
 */
const TRANSPORT_NAMES = new Set(['TimeoutError', 'AuthRetryableFetchError']);

/** Best-effort message extraction for Error instances, PostgREST error objects and strings. */
export function errorMessageOf(err: unknown): string | null {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    return typeof m === 'string' ? m : null;
  }
  return null;
}

/** True when the failure is a transport failure (offline, DNS, reset, timeout). */
export function isTransportError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const { name, status } = err as { name?: unknown; status?: unknown };
    if (typeof name === 'string' && TRANSPORT_NAMES.has(name)) return true;
    // gotrue-js reports a failed fetch as an Auth*Error carrying status 0. Any
    // other object with a zero status says nothing about connectivity.
    if (status === 0 && typeof name === 'string' && name.startsWith('Auth')) return true;
  }
  const raw = errorMessageOf(err);
  if (!raw) return false;
  const message = raw.replace(/^[A-Za-z]*Error:\s*/, '').trim();
  return TRANSPORT_MESSAGES.some((re) => re.test(message));
}
