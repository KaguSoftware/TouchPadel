/**
 * The staff app's retry policy, set once on the QueryClient (main.tsx).
 *
 * It used to be `retry: 1` on every query, which retried EVERY error once —
 * FORBIDDEN, MATCH_NOT_FOUND, a missing RPC — so a refusal the server had
 * already made reached the screen a backoff later, and 33 `retry: false`
 * overrides across the features existed only to stop that. The one predicate
 * (`isRetryableError`, @touch/core/net/retry) now decides: a network failure,
 * a timeout, a 5xx or 429, a deadlock or a statement timeout is retried once;
 * a raised business code, any 4xx and any other SQLSTATE never are.
 *
 * Mutations never retry by themselves. A write that may have committed before
 * its answer was lost is only safe to repeat with an idempotency key, and the
 * keyed writes already have their own durable retry: `mutate()` hands them to
 * the queue (Electron) whose sync worker replays by key.
 */
import { isRetryableError } from '@touch/core';

/** One more go after the first failure, as before — but only for a failure worth one. */
export const QUERY_RETRY_LIMIT = 1;

/** The QueryClient's default `retry` for queries. */
export function queryRetry(failureCount: number, error: unknown): boolean {
  return failureCount < QUERY_RETRY_LIMIT && isRetryableError(error);
}

/** The QueryClient's default `retry` for mutations: never automatic (see the header). */
export const MUTATION_RETRY = false;
