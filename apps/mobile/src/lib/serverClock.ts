/**
 * The server's clock, for the screens whose cut-offs the server judges with
 * its own now(): the booking cancel window, the hold countdown (audit finding
 * 32). A phone set two hours fast showed "call the venue" for a booking the
 * server would still cancel for free, and dropped a live hold from the list.
 *
 * Every Supabase response carries an HTTP `Date` header; the client's fetch
 * (lib/supabase.ts) notes it, so the offset is fresh after any read and needs
 * no RPC of its own. The header has one-second resolution and the request
 * takes a moment, so an offset under SKEW_FLOOR_MS is treated as none (no
 * jitter on a phone whose clock is right). Screens that read a `serverNow`
 * from their own RPC keep using it (features/deposit/logic.ts serverNowMs).
 */

/** Below this the phone's clock is taken as right. */
export const SKEW_FLOOR_MS = 3_000;

let offsetMs = 0;

/** Pure: the offset a `Date` header implies, 0 when unreadable or within the floor. */
export function offsetFromDateHeader(dateHeader: string | null | undefined, receivedAtMs: number): number | null {
  const at = dateHeader ? Date.parse(dateHeader) : NaN;
  if (!Number.isFinite(at)) return null;
  const offset = at - receivedAtMs;
  return Math.abs(offset) < SKEW_FLOOR_MS ? 0 : offset;
}

/** Called with each response's `Date` header. */
export function noteServerDate(dateHeader: string | null | undefined, receivedAtMs: number = Date.now()): void {
  const offset = offsetFromDateHeader(dateHeader, receivedAtMs);
  if (offset !== null) offsetMs = offset;
}

/** Now, on the server's clock as last seen. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** For tests. */
export function resetServerClock(): void {
  offsetMs = 0;
}
