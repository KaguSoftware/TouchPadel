/**
 * F-11 (0396): the kitchen screen says which tickets it has drawn, so the
 * till can flag an order no kitchen screen has shown. Cloud tickets go to
 * app.kds_ack_tickets (it stamps tickets.kds_seen_at once); LAN tickets go
 * back to the till as a ticket.ack frame. Batched and debounced: a board that
 * redraws every five seconds sends each id once.
 */

/** Wait this long after a redraw before sending, so a burst of tickets is one call. */
export const ACK_DEBOUNCE_MS = 1_500;
/** At most this many ids per call (app.kds_ack_tickets takes 500; the LAN frame 200). */
export const ACK_BATCH = 200;
/** The sent-set is trimmed past this size (a long shift), oldest first. */
export const ACKED_CAP = 2_000;

/** The ids on screen that have not been sent yet, first ACK_BATCH of them. */
export function pendingAcks(shownIds: readonly string[], acked: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of shownIds) {
    if (acked.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length === ACK_BATCH) break;
  }
  return out;
}

/** Mark ids sent, keeping the set bounded (insertion order = oldest first). */
export function markAcked(acked: Set<string>, ids: readonly string[]): void {
  for (const id of ids) acked.add(id);
  while (acked.size > ACKED_CAP) {
    const first = acked.values().next().value;
    if (first === undefined) break;
    acked.delete(first);
  }
}
