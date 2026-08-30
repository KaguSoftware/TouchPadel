'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { DRAG_CLOSE_PX, DRAG_FADE_PX, DRAG_INTENT_PX } from './constants';

/**
 * Header-only drag-to-close (UpperDeck ItemModal L337-396): the gesture is
 * armed on the sheet HEADER only, never the body, so horizontal rails, the
 * textarea and the scrolling body are never hijacked. Direction intent is
 * resolved after 8 px; > 80 px downward closes.
 *
 * The maths is pure and exported for tests; the hook is a thin pointer-event
 * binding on top of it.
 */

export type DragIntent = 'pending' | 'vertical' | 'horizontal';

/** Which axis the gesture committed to, once it has travelled far enough. */
export function resolveIntent(dx: number, dy: number, intentPx: number = DRAG_INTENT_PX): DragIntent {
  if (Math.abs(dx) < intentPx && Math.abs(dy) < intentPx) return 'pending';
  return Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
}

/** Downward-only translation (an upward pull rubber-bands to a quarter). */
export function dragOffset(dy: number): number {
  return dy >= 0 ? dy : dy / 4;
}

export function shouldClose(dy: number, threshold: number = DRAG_CLOSE_PX): boolean {
  return dy >= threshold;
}

/** Backdrop opacity tracks the drag: 1 at rest, floor 0.2 at the fade span. */
export function backdropOpacity(dy: number, span: number = DRAG_FADE_PX): number {
  if (dy <= 0) return 1;
  return Math.max(0.2, 1 - dy / span);
}

export interface SheetDrag {
  /** current translation in px (0 at rest) */
  offset: number;
  dragging: boolean;
  /** style for the sheet element */
  style: { translate: string; transition?: string };
  /** style for the backdrop element */
  backdropStyle: { opacity: number };
}

/**
 * Binds pointer events to `headerRef`. The header must carry
 * `touch-action: none` (sheet.css) or the browser scrolls instead.
 */
export function useSheetDrag(
  headerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { threshold?: number; intent?: number } = {},
): SheetDrag {
  const { threshold = DRAG_CLOSE_PX, intent = DRAG_INTENT_PX } = options;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  /**
   * The header node as of the last render, so the binding effect re-runs when
   * it appears. A ref's `.current` is neither a render nor a dependency, so a
   * sheet that returns null on its first render (QrRequiredSheet, and any sheet
   * mounted before its content exists) bound to nothing and stayed unbound for
   * the life of the component — the drag silently did nothing.
   */
  const [header, setHeader] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (headerRef.current !== header) setHeader(headerRef.current);
  });

  /**
   * Start every opening at rest. A sheet that closes by swipe keeps the offset
   * it was released at, so the exit can carry on from there — but the sheets
   * that stay mounted between openings (the basket, the QR notice) would then
   * REOPEN still pushed down by that old offset. The header remounting is the
   * signal that a new opening has begun.
   */
  useEffect(() => {
    if (header) setOffset(0);
  }, [header]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let mode: DragIntent = 'pending';

    const reset = () => {
      pointerId = null;
      mode = 'pending';
      setDragging(false);
      setOffset(0);
    };

    const onDown = (e: PointerEvent) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      mode = 'pending';
    };

    const onMove = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (mode === 'pending') {
        mode = resolveIntent(dx, dy, intent);
        if (mode === 'pending') return;
        if (mode === 'horizontal') {
          pointerId = null;
          return;
        }
        setDragging(true);
        // capture only once the gesture is ours — taps on header buttons still fire
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      }
      if (mode !== 'vertical') return;
      e.preventDefault();
      setOffset(dragOffset(dy));
    };

    const onUp = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      const dy = e.clientY - startY;
      const closing = mode === 'vertical' && shouldClose(dy, threshold);
      if (closing) {
        // Leave the offset where the finger let go. Resetting first snapped the
        // sheet back to the top and only then played the exit, so a long swipe
        // appeared to bounce up before falling away. The sheet keeps its
        // transform and the exit carries on from there.
        pointerId = null;
        mode = 'pending';
        setDragging(false);
        closeRef.current();
        return;
      }
      // Not far enough — spring back to rest and stay open.
      reset();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [headerRef, header, threshold, intent]);

  return {
    offset,
    dragging,
    style: {
      translate: `0 ${offset}px`,
      ...(dragging ? {} : { transition: 'translate var(--tp-dur-fast) var(--tp-ease-out)' }),
    },
    backdropStyle: { opacity: backdropOpacity(offset) },
  };
}
