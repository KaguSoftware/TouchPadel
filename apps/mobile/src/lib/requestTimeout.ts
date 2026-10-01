/**
 * The deadline one Supabase request gets (lib/supabase.ts wires it into the
 * client's fetch). Nothing timed out before, so a request the network
 * swallowed — a captive portal, a socket that died while the phone slept —
 * held its spinner, or a booking step, forever.
 *
 *   REST, RPC, auth   15 s
 *   edge functions    30 s: deposit-begin and ticket-begin wait on the
 *                     payment provider
 *   storage           none: a photo on a slow link takes as long as it takes
 *
 * A miss rejects with RequestTimeoutError (@touch/core): a transport failure
 * for lib/network.ts ("No connection"), retryable for the query client.
 *
 * Pure: no RN / supabase imports (unit-tested under node).
 */
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@touch/core';

export const EDGE_REQUEST_TIMEOUT_MS = 30_000;

export function requestTimeoutMs(url: string): number | null {
  if (url.includes('/storage/v1/')) return null;
  if (url.includes('/functions/v1/')) return EDGE_REQUEST_TIMEOUT_MS;
  return DEFAULT_REQUEST_TIMEOUT_MS;
}
