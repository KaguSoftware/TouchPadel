/**
 * Court payments that went onto the station's queue (offline) and have not
 * been answered yet: tab id -> the envelope's localId (audit finding 22).
 *
 * Module-level, not component state: the desk closes and reopens a booking
 * while the internet is down, and a hold kept in the panel was lost with it,
 * so Cash and Card came back on the old due and the guest paid twice. The
 * entry goes when the queued settle's result lands (acked or refused; a
 * refusal is also toasted by the root). A station restart starts empty; the
 * queue itself still sends the payment.
 */
import { useSyncExternalStore } from 'react';
import { onResult } from '../../../lib/queueResults';

const held = new Map<string, string>();
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function listen(): void {
  if (unsubscribe) return;
  unsubscribe = onResult((r) => {
    for (const [tabId, localId] of held) {
      if (localId === r.localId) {
        held.delete(tabId);
        emit();
      }
    }
  });
}

/** A court payment for this tab is on the queue. */
export function holdQueuedSettle(tabId: string, localId: string): void {
  held.set(tabId, localId);
  listen();
  emit();
}

/** For tests. */
export function resetQueuedSettles(): void {
  held.clear();
  unsubscribe?.();
  unsubscribe = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a queued court payment for this tab waits for its answer. */
export function useQueuedSettleHeld(tabId: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => (tabId ? held.has(tabId) : false));
}
