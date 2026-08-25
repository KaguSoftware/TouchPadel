'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared chrome for every cafe bottom sheet (ItemSheet / BasketSheet /
 * QrRequiredSheet): backdrop, `role="dialog" aria-modal`, Escape to close,
 * backdrop click to close, a focus trap and focus restore on unmount.
 *
 * Lives beside ItemSheet because it is a sheet primitive, not a hook: the
 * shell agent's `useSheetDrag` (hooks/cafe) can replace `drag.ts` without
 * touching this.
 */
export function SheetShell({
  label,
  onClose,
  className,
  style,
  backdropStyle,
  sheetRef,
  children,
}: {
  label: string;
  onClose(): void;
  className?: string;
  style?: CSSProperties;
  backdropStyle?: CSSProperties;
  /** the caller may own the ref (drag transforms, scroll probes) */
  sheetRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = sheetRef ?? ownRef;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // focus in, focus back out
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (restore && typeof restore.focus === 'function') restore.focus({ preventScroll: true });
    };
  }, [ref]);

  // Escape + Tab trap
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const nodes = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      const first = nodes[0] as HTMLElement;
      const last = nodes[nodes.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [ref]);

  return (
    <>
      <div
        className="tp-sheet-backdrop"
        style={backdropStyle}
        onClick={() => closeRef.current()}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className={className}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
