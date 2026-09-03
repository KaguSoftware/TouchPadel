/**
 * queueResults — the renderer's receiving end of the durable write path.
 *
 * The main-process sync worker pushes every terminal outcome (acked / conflict
 * / failed) over touch:mutation-result. One subscription, mounted at app root,
 * fans it out three ways:
 *   1. invalidates the TanStack queries that mutation type touches, so online
 *      the screens behave exactly as the old await-then-invalidate code did;
 *   2. resolves any awaitResult() waiter (mutate() uses this for the inline
 *      server echo — tab ids, change due);
 *   3. notifies terminal-result listeners (the root banner/toast for
 *      conflict/failed rows the cashier must see).
 */
import type { QueryClient } from '@tanstack/react-query';
import { touch, type MutationResult, type Unsub } from '../ipc/bridge';

/** Query keys each mutation type invalidates on ANY terminal result. */
export const RESULT_INVALIDATIONS: Record<string, readonly (readonly string[])[]> = {
  'order.create': [['tab'], ['tabs']],
  'order.add_items': [['tab'], ['tabs']],
  'tab.open': [['tabs']],
  'tab.settle': [['tab'], ['tabs'], ['day']],
  'payment.record': [['tab'], ['tabs'], ['day']],
  'ticket.status': [['tickets']],
  'adjustment.apply': [['tab'], ['tabs']],
  'reservation.create': [['reservations'], ['reservationsWeek']],
  'reservation.update': [['reservations'], ['reservationsWeek']],
  'waiter_call.action': [['waiterCalls']],
  'stock.waste': [['stock']],
};

const waiters = new Map<string, (r: MutationResult) => void>();
const terminalListeners = new Set<(r: MutationResult) => void>();

/** Mounted once at app root (main.tsx). Idempotent per subscription handle. */
export function initQueueResults(queryClient: QueryClient): Unsub {
  return touch.onMutationResult((r) => {
    for (const key of RESULT_INVALIDATIONS[r.mutationType] ?? []) {
      void queryClient.invalidateQueries({ queryKey: [...key] });
    }
    const waiter = waiters.get(r.localId);
    if (waiter) waiter(r);
    if (r.state === 'conflict' || r.state === 'failed') {
      for (const listener of terminalListeners) listener(r);
    }
  });
}

/**
 * Resolve when the queued mutation reaches a terminal state, or null after
 * timeoutMs (the write is safely queued; the server just hasn't answered).
 */
export function awaitResult(localId: string, timeoutMs: number): Promise<MutationResult | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(localId);
      resolve(null);
    }, timeoutMs);
    waiters.set(localId, (r) => {
      clearTimeout(timer);
      waiters.delete(localId);
      resolve(r);
    });
  });
}

/** Conflict/failed outcomes only — the ones a person must look at. */
export function onFailedResult(cb: (r: MutationResult) => void): Unsub {
  terminalListeners.add(cb);
  return () => terminalListeners.delete(cb);
}
