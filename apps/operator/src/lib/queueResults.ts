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
 *      conflict/failed rows the cashier must see), and the all-results
 *      listeners a screen uses to retire a row it marked pending.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { touch, type MutationResult, type Unsub } from '../ipc/bridge';
import { QK, RESERVATION_LIST_KEYS } from './queryKeys';

/**
 * Query keys each mutation type invalidates on ANY terminal result. Every
 * entry is a registry key or family root from lib/queryKeys.ts — the screens
 * read through the same registry, so a renamed key fails typecheck here
 * instead of quietly invalidating nothing (the literals lived here until
 * 2026-09-20, mirrored by comment only).
 */
export const RESULT_INVALIDATIONS: Record<string, readonly QueryKey[]> = {
  'order.create': [QK.tab.all, QK.tabs],
  'order.add_items': [QK.tab.all, QK.tabs],
  'tab.open': [QK.tabs, QK.bookingBill.all, QK.bookingBillStates.all],
  'tab.settle': [QK.tab.all, QK.tabs, QK.day, QK.bookingBill.all, QK.bookingBillStates.all],
  'payment.record': [QK.tab.all, QK.tabs, QK.day, QK.bookingBill.all, QK.bookingBillStates.all],
  'ticket.status': [QK.tickets],
  'adjustment.apply': [QK.tab.all, QK.tabs],
  'reservation.create': RESERVATION_LIST_KEYS,
  // A move or extend re-prices the booking, so its bill moves with it (0106).
  // An open BookingDetail reads QK.reservation.one, so a late result refreshes it too.
  'reservation.update': [...RESERVATION_LIST_KEYS, QK.reservation.all, QK.bookingBill.all, QK.bookingBillStates.all],
  'waiter_call.action': [QK.waiterCalls],
  'stock.waste': [QK.stock.all],
  // Item 9 / C3 (0120). The desk keys are named unconditionally, as tab.settle
  // does: only mounted queries refetch. A void flips tickets too (0039).
  'tab.cancel': [QK.tabs, QK.tab.all, QK.bookingBill.all, QK.bookingBillStates.all],
  'tab.settle_zero': [QK.tab.all, QK.tabs, QK.day, QK.bookingBill.all, QK.bookingBillStates.all],
  'payment.refund': [QK.tab.all, QK.tabs, QK.day, QK.bookingBill.all, QK.bookingBillStates.all],
  'order_item.void': [QK.tab.all, QK.tabs, QK.day, QK.bookingBill.all, QK.bookingBillStates.all, QK.tickets],
};

const waiters = new Map<string, (r: MutationResult) => void>();
const terminalListeners = new Set<(r: MutationResult) => void>();
const resultListeners = new Set<(r: MutationResult) => void>();

/**
 * One terminal result, fanned out. Exported for the test; initQueueResults is
 * the only production caller.
 *
 * A result a waiter consumed is NOT re-announced to the failed-result
 * listeners: mutate() throws that refusal to its caller, who shows it beside
 * the control that was pressed. The listeners are for the later ones — the
 * write that was queued offline and refused minutes afterwards.
 */
export function dispatchResult(r: MutationResult, queryClient: Pick<QueryClient, 'invalidateQueries'>): void {
  for (const key of RESULT_INVALIDATIONS[r.mutationType] ?? []) {
    void queryClient.invalidateQueries({ queryKey: [...key] });
  }
  // Every result, acked included: a screen holding a pending localId matches
  // it here and retires the entry; one a waiter consumes never matches, as the
  // screen only marks pending once mutate() has resolved `queued`.
  for (const listener of resultListeners) listener(r);
  const waiter = waiters.get(r.localId);
  if (waiter) {
    waiter(r);
    return;
  }
  if (r.state === 'conflict' || r.state === 'failed') {
    for (const listener of terminalListeners) listener(r);
  }
}

/** Mounted once at app root (main.tsx). Idempotent per subscription handle. */
export function initQueueResults(queryClient: QueryClient): Unsub {
  return touch.onMutationResult((r) => dispatchResult(r, queryClient));
}

const CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * The upper-snake code in the replay function's JSON body — its `error`
 * (a code since 0115) or `code`. null when the body carries neither.
 */
export function serverErrorCode(serverResult: unknown): string | null {
  const body = (serverResult ?? {}) as Record<string, unknown>;
  if (typeof body.error === 'string' && CODE.test(body.error)) return body.error;
  if (typeof body.code === 'string' && CODE.test(body.code)) return body.code;
  return null;
}

/**
 * The code inside an error STRING: after the HTTP status the sync worker
 * prefixes ("400: TAB_NOT_EMPTY", sync-worker.ts markFailed), else leading
 * with its detail ("ITEM_UNAVAILABLE: sold out") or alone. The colon form is
 * tried first so "HTTP 503 gateway" yields null, not "HTTP".
 */
export function errorStringCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const after = text.match(/:\s*([A-Z][A-Z0-9_]+)(?![a-z])/);
  if (after) return after[1]!;
  const leading = text.match(/^([A-Z][A-Z0-9_]+)(?::|$)/);
  return leading ? leading[1]! : null;
}

/**
 * The machine code behind a refused result: the replay function's body code,
 * else the code inside the worker's error string. null when there is none —
 * the toast then says only that the write did not sync.
 */
export function resultErrorCode(r: MutationResult): string | null {
  return serverErrorCode(r.serverResult) ?? errorStringCode(r.error);
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

/**
 * Every terminal outcome, acked included, waiter or not. For a screen that
 * marked a row pending after mutate() resolved `queued`: the ack retires the
 * mark, a refusal retires it and lands the error where the synchronous one
 * would have. Match on localId; ignore the rest.
 */
export function onResult(cb: (r: MutationResult) => void): Unsub {
  resultListeners.add(cb);
  return () => resultListeners.delete(cb);
}
