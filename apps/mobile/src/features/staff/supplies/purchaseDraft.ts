/**
 * The purchase being recorded, kept between its three pages (shop and receipt,
 * items, review): each step is a screen of the staff stack, so the system's own
 * back button, edge swipe and slide work on every step, and what was typed has
 * to outlive each screen. A module store read with `useSyncExternalStore`: the
 * first step clears it when it opens, so nothing carries over from a purchase
 * that was left half done.
 *
 * Only what the driver changed is kept: `shopTyped` null follows the last shop
 * used, and `edited` null follows the shopping list's ticked lines.
 */
import { useSyncExternalStore } from 'react';
import type { AttachedPhoto } from '../../../components/PhotoButton';
import type { PurchaseLineDraft } from './logic';

export interface PurchaseDraftState {
  shopTyped: string | null;
  edited: PurchaseLineDraft[] | null;
  receipt: AttachedPhoto[];
}

const EMPTY: PurchaseDraftState = { shopTyped: null, edited: null, receipt: [] };

let state: PurchaseDraftState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePurchaseDraft(): PurchaseDraftState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function patchPurchaseDraft(patch: Partial<PurchaseDraftState>): void {
  state = { ...state, ...patch };
  emit();
}

export function resetPurchaseDraft(): void {
  state = EMPTY;
  emit();
}
