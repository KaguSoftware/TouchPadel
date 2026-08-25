'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  basketCount,
  basketDiscountTotal,
  basketFingerprint,
  basketSubtotal,
  basketTotal,
  clearDraft,
  fingerprintHash,
  loadDraft,
  mergeDrafts,
  newIdemKey,
  reconcile as reconcileLines,
  saveDraft,
  type BasketDraft,
  type BasketLine,
} from '@/lib/cafe/basket';
import type { CafeSettings, MenuCategory, MenuItem } from '@/lib/menu';

/**
 * The guest basket: a localStorage draft (v2 `{ v, lines, note, idemKey }`)
 * keyed `tp-basket-{tableId ?? 'walkin'}`. Browsing without a QR is a first
 * class flow (owner decision 7), so the walk-in draft FOLDS INTO the table
 * draft the moment the table binds and the walk-in key is dropped.
 *
 * The idempotency SALT is persisted with the draft: a guest who reloads mid
 * send must not create a second order when they retry. The key actually sent
 * is that salt plus a fingerprint of the basket, so a retry of the same basket
 * replays while a changed basket is a new order (see `idemKey` below).
 */
export type BasketToast = 'priceChanged' | 'removedUnavailable';

export interface UseBasket {
  lines: BasketLine[];
  note: string;
  count: number;
  subtotal: number;
  discountTotal: number;
  total: number;
  /** true once the draft has been read from storage (avoids a save-over-empty race) */
  ready: boolean;
  add(line: BasketLine): void;
  remove(key: string): void;
  setQty(key: string, qty: number): void;
  setNote(note: string): void;
  clear(): void;
  idemKey: { current(): string; reset(): void };
  /** re-snapshot against a fresh menu; returns which toasts to show */
  reconcile(menu: readonly MenuCategory[], settings?: CafeSettings): BasketToast[];
}

export function useBasket(
  tableId: string | null,
  /**
   * The current featured item. Re-pricing itself happens through
   * `reconcile()` (CafeApp calls it after every menu refresh); this argument
   * keeps the featured promo visible to the hook's callers and pins the
   * web-slice §2 signature.
   */
  featured: MenuItem | null,
): UseBasket {
  void featured;
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [note, setNoteState] = useState('');
  const [ready, setReady] = useState(false);
  const idemRef = useRef<string | null>(null);

  // ------------------------------------------------- load (and merge on bind)
  useEffect(() => {
    let draft: BasketDraft;
    if (tableId) {
      draft = mergeDrafts(loadDraft(null), loadDraft(tableId));
      clearDraft(null); // the walk-in draft has been absorbed
    } else {
      draft = loadDraft(null);
    }
    idemRef.current = draft.idemKey;
    setLines(draft.lines);
    setNoteState(draft.note);
    setReady(true);
  }, [tableId]);

  // ------------------------------------------------------------------ persist
  useEffect(() => {
    if (!ready) return;
    saveDraft(tableId, { lines, note, idemKey: idemRef.current });
  }, [ready, tableId, lines, note]);

  const add = useCallback((line: BasketLine) => setLines((prev) => [...prev, line]), []);

  const remove = useCallback(
    (key: string) => setLines((prev) => prev.filter((l) => l.key !== key)),
    [],
  );

  const setQty = useCallback((key: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) => (l.key === key ? { ...l, qty: Math.min(99, Math.trunc(qty)) } : l)),
    );
  }, []);

  const setNote = useCallback((next: string) => setNoteState(next.slice(0, 200)), []);

  const clear = useCallback(() => {
    idemRef.current = null;
    setLines([]);
    setNoteState('');
    clearDraft(tableId);
  }, [tableId]);

  const idemKey = useMemo(
    () => ({
      /**
       * Salt + fingerprint of the current basket.
       *
       * The salt alone used to BE the key, reset only on a successful submit.
       * So if a submit committed server-side but the response was lost, the
       * guest could add an item, send again with the same key, and get back
       * `duplicate: true` for the FIRST order — the added item was never
       * ordered and the guest was told it was. Folding the basket contents in
       * makes "retry of the same basket" (a real replay) and "send a changed
       * basket" (a new order) distinguishable server-side.
       */
      current(): string {
        idemRef.current ??= newIdemKey();
        return `${idemRef.current}:${fingerprintHash(basketFingerprint(lines, note))}`;
      },
      reset(): void {
        idemRef.current = null;
      },
    }),
    [lines, note],
  );

  const reconcile = useCallback(
    (menu: readonly MenuCategory[], settings?: CafeSettings): BasketToast[] => {
      const toasts: BasketToast[] = [];
      setLines((prev) => {
        if (prev.length === 0) return prev;
        const result = reconcileLines(prev, menu, settings);
        if (result.removed.length > 0) toasts.push('removedUnavailable');
        if (result.repriced.length > 0) toasts.push('priceChanged');
        return result.removed.length === 0 && result.repriced.length === 0 ? prev : result.lines;
      });
      return toasts;
    },
    [],
  );

  return {
    lines,
    note,
    count: basketCount(lines),
    subtotal: basketSubtotal(lines),
    discountTotal: basketDiscountTotal(lines),
    total: basketTotal(lines),
    ready,
    add,
    remove,
    setQty,
    setNote,
    clear,
    idemKey,
    reconcile,
  };
}
