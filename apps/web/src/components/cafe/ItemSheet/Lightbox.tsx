'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { DOUBLE_TAP_MS } from './constants';
import {
  clampPan,
  clampScale,
  dismissOpacity,
  nextTapScale,
  pinchDistance,
  shouldDismiss,
  type Pan,
} from './zoom';

const ORIGIN: Pan = { x: 0, y: 0 };

/**
 * Full-screen photo viewer (UpperDeck ImageLightbox): pinch 1–5×, double-tap
 * 2.5×, panning clamped to the image bounds, drag-to-dismiss past 100 px with
 * the backdrop opacity tracking the drag. Pointer events only — no library.
 */
export function Lightbox({
  src,
  alt,
  closeLabel,
  onClose,
}: {
  src: string;
  alt: string;
  closeLabel: string;
  onClose(): void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, Pan>());
  const pinchBase = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ pointer: Pan; pan: Pan } | null>(null);
  const lastTap = useRef(0);

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Pan>(ORIGIN);
  const [drag, setDrag] = useState<Pan>(ORIGIN);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const size = () => {
    const r = rootRef.current?.getBoundingClientRect();
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchBase.current = { dist: pinchDistance(a as Pan, b as Pan), scale };
      panStart.current = null;
    } else if (pointers.current.size === 1) {
      panStart.current = { pointer: { x: e.clientX, y: e.clientY }, pan };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchBase.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = pinchDistance(a as Pan, b as Pan);
      if (pinchBase.current.dist > 0) {
        const next = clampScale((pinchBase.current.scale * dist) / pinchBase.current.dist);
        setScale(next);
        setPan((p) => clampPan(p, next, size()));
      }
      return;
    }

    const start = panStart.current;
    if (!start) return;
    const dx = e.clientX - start.pointer.x;
    const dy = e.clientY - start.pointer.y;
    if (scale > 1) {
      setPan(clampPan({ x: start.pan.x + dx, y: start.pan.y + dy }, scale, size()));
    } else {
      setDrag({ x: dx, y: dy });
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
    if (pointers.current.size === 1) {
      // 2 → 1 finger: re-seed the pan baseline so the image does not jump
      const [only] = [...pointers.current.values()];
      panStart.current = { pointer: only as Pan, pan };
      return;
    }
    if (pointers.current.size > 0) return;

    panStart.current = null;
    if (scale <= 1 && shouldDismiss(drag)) {
      onClose();
      return;
    }
    setDrag(ORIGIN);

    // double tap: two taps within 300 ms that barely moved
    if (Math.abs(drag.x) < 8 && Math.abs(drag.y) < 8) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        const next = nextTapScale(scale);
        setScale(next);
        setPan(next === 1 ? ORIGIN : (p) => clampPan(p, next, size()));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className="tp-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      style={{ opacity: dismissOpacity(drag) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div
        className="tp-lightbox__stage"
        style={{
          transform: `translate(${pan.x + drag.x}px, ${pan.y + drag.y}px) scale(${scale})`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- viewport-sized original, never resized */}
        <img src={src} alt={alt} draggable={false} />
      </div>
      <button type="button" className="tp-lightbox__close" onClick={onClose} aria-label={closeLabel}>
        ×
      </button>
    </div>
  );
}
