/**
 * Transport-failure classification — the ONE place in this app that decides
 * whether an error means "the request never reached, or never came back from,
 * the server".
 *
 * Consumers:
 *   - features/booking/errors.ts (and the other errors modules) render
 *     `errors.network` ONLY for these;
 *   - lib/queryClient.ts retries by `isRetryableError` (@touch/core), which
 *     counts these, timeouts, server faults and transient SQLSTATEs — never a
 *     decision the server made.
 *
 * Everything else — a PostgREST 4xx, an RLS denial, schema drift after a deploy,
 * an app.* business code — is not a connection problem and must never be
 * labelled "No connection. Check your internet". The previous classifier was
 * `/network|fetch|timeout|abort/i` over the whole message, which also matched a
 * `statement timeout`, any PostgREST hint that mentioned fetch, and an aborted
 * transaction — so real server errors on the phone read as "no internet".
 *
 * The list of platform messages lives in @touch/core (net/retry.ts,
 * `isTransportFailure`) so the staff app and the café read a dead connection
 * the same way. NOT 'AbortError': an abort means "nobody is waiting for this
 * response any more" (TanStack aborts on unmount), not "no connection". A
 * request that missed its deadline (lib/supabase.ts gives every one a deadline)
 * throws RequestTimeoutError, named 'TimeoutError', which IS one.
 *
 * Pure: no RN / supabase imports (unit-tested under node).
 */
import { isTransportFailure } from '@touch/core';

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
  return isTransportFailure(err);
}
