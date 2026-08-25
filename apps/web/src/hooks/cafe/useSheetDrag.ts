'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * Drag-to-close for a bottom sheet, ARMED ON THE HEADER ONLY (iOS: arming the
 * whole sheet fights the inner scroller and makes a long item sheet unusable —
 * the header carries `touch-action: none` in sheet.css.ts).
 *
 * Signature per web-slice §2: pass the header ref; listeners are attached
 * natively (non-passive, so the drag can pre-empt the scroller). Pointer
 * events cover mouse + touch + pen. A gesture is only ADOPTED after `intent`
 * px of downward movement, and only closes past `threshold` px on release.
 * `handlers` is also returned for a header that prefers React props.
 */
export interface SheetDragOptions {
  threshold?: number;
  intent?: number;
}

export interface UseSheetDrag {
  /** spread onto the sheet root */
  style: CSSProperties;
  /** optional: spread onto the header instead of passing a ref */
  handlers: {
    onPointerDown(e: React.PointerEvent): void;
    onPointerMove(e: React.PointerEvent): void;
    onPointerUp(e: React.PointerEvent): void;
    onPointerCancel(e: React.PointerEvent): void;
  };
  dragging: boolean;
}

export function useSheetDrag(
  headerRef: React.RefObject<HTMLElement | null> | null,
  onClose: () => void,
  { threshold = 80, intent = 8 }: SheetDragOptions = {},
): UseSheetDrag {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const offsetRef = useRef(0);
  const active = useRef(false);
  const adopted = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const begin = useCallback((clientY: number) => {
    active.current = true;
    adopted.current = false;
    startY.current = clientY;
    offsetRef.current = 0;
    setOffset(0);
  }, []);

  const move = useCallback(
    (clientY: number, capture?: () => void) => {
      if (!active.current) return;
      const dy = clientY - startY.current;
      if (!adopted.current) {
        if (dy < intent) return; // upward, or below the intent gate
        adopted.current = true;
        setDragging(true);
        capture?.();
      }
      const next = dy > 0 ? dy : 0;
      offsetRef.current = next;
      setOffset(next);
    },
    [intent],
  );

  const end = useCallback(
    (commit: boolean) => {
      if (!active.current) return;
      const wasAdopted = adopted.current;
      active.current = false;
      adopted.current = false;
      setDragging(false);
      const travelled = offsetRef.current;
      offsetRef.current = 0;
      setOffset(0);
      if (commit && wasAdopted && travelled >= threshold) closeRef.current();
    },
    [threshold],
  );

  // ------------------------------------------------- native header listeners
  useEffect(() => {
    const el = headerRef?.current;
    if (!el) return;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      begin(e.clientY);
    };
    const onMove = (e: PointerEvent) =>
      move(e.clientY, () => el.setPointerCapture?.(e.pointerId));
    const up = (e: PointerEvent) => {
      el.releasePointerCapture?.(e.pointerId);
      end(true);
    };
    const cancel = () => end(false);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [headerRef, begin, move, end]);

  // A sheet unmounted mid-drag must not leave state armed.
  useEffect(
    () => () => {
      active.current = false;
      adopted.current = false;
    },
    [],
  );

  return {
    style: {
      translate: offset > 0 ? `0 ${offset}px` : undefined,
      transition: dragging ? 'none' : undefined,
      // Mid-drag the sheet must not also run its slide-up entry animation.
      animation: dragging ? 'none' : undefined,
    },
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        begin(e.clientY);
      },
      onPointerMove: (e) => move(e.clientY, () => e.currentTarget.setPointerCapture?.(e.pointerId)),
      onPointerUp: (e) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        end(true);
      },
      onPointerCancel: () => end(false),
    },
    dragging,
  };
}
