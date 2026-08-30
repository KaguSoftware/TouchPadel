'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

/**
 * Longest the shell will wait for the exit animation's `animationend` before
 * unmounting anyway. Comfortably past --tp-dur-base (250ms).
 */
const EXIT_FALLBACK_MS = 400;

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
 *
 * Closing is deferred so the exit animation can play: every caller unmounts the
 * sheet the moment its `open`/`item` prop clears, which would rip the node out
 * before a single frame of it ran. A close request instead flips `data-closing`
 * (sheet.css) and only calls the caller's `onClose` when that animation ends,
 * so the sheet slides back down the way it slid up. The timer is a fallback for
 * when no animationend arrives — reduced motion collapses the animation to 1ms,
 * and a backgrounded tab may not fire the event at all.
 */
export function SheetShell({
  label,
  onClose,
  className,
  style,
  backdropStyle,
  sheetRef,
  dragged = false,
  closeRef: exposeCloseRef,
  children,
}: {
  label: string;
  onClose(): void;
  className?: string;
  style?: CSSProperties;
  backdropStyle?: CSSProperties;
  /** the caller may own the ref (drag transforms, scroll probes) */
  sheetRef?: RefObject<HTMLDivElement | null>;
  /**
   * True when the close came from the drag gesture. The pointer has already
   * carried the sheet down, so it fades out from there instead of replaying the
   * slide from the top.
   */
  dragged?: boolean;
  /**
   * Receives the shell's deferred close. A sheet with its own close affordances
   * (an X, a CTA, a drag handle) calls this instead of its `onClose` prop so
   * those paths play the exit too, rather than unmounting on the spot.
   */
  closeRef?: RefObject<(() => void) | null>;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const ref = sheetRef ?? ownRef;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  /**
   * True for the first painted frame only. The backdrop's blur is a transition
   * between two declared states, so it needs a frame at blur(0) to transition
   * FROM — mounting straight into the blurred state would just paint it sharp.
   */
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntering(false));
    return () => cancelAnimationFrame(raf);
  }, []);

  /** Play the exit, then let the caller unmount us. Idempotent. */
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    // The shell stays mounted for the exit, so the page behind it is still
    // marked inert (and dimmed) and the backdrop still covers the topbar and
    // the FABs. This attribute lets the shell drop both the moment the close
    // begins, for every sheet, without each one plumbing a flag up to CafeApp.
    document.documentElement.setAttribute('data-sheet-closing', 'true');
  }, []);

  // Whatever ends the sheet — the animation, the fallback, or an unmount from
  // elsewhere — the flag must not outlive it.
  useEffect(
    () => () => {
      document.documentElement.removeAttribute('data-sheet-closing');
    },
    [],
  );

  // hand the deferred close back to the sheet's own affordances
  useEffect(() => {
    if (!exposeCloseRef) return;
    exposeCloseRef.current = requestClose;
    return () => {
      exposeCloseRef.current = null;
    };
  }, [exposeCloseRef, requestClose]);

  useEffect(() => {
    if (!closing) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      closeRef.current();
    };
    const node = ref.current;
    // animationend bubbles: the sold-out stamp, the scroll hint and the loader
    // all animate inside the sheet, so only the sheet's OWN exit counts.
    const onEnd = (e: AnimationEvent) => {
      if (e.target === node) finish();
    };
    node?.addEventListener('animationend', onEnd);
    // Fallback: reduced motion collapses the animation to 1ms and a hidden tab
    // may never fire animationend, so never strand the sheet on screen.
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      node?.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer);
    };
  }, [closing, ref]);

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
        requestClose();
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
  }, [ref, requestClose]);

  return (
    <>
      <div
        className="tp-sheet-backdrop"
        data-entering={entering ? 'true' : undefined}
        data-closing={closing ? 'true' : undefined}
        // The drag tracks the backdrop's opacity inline, and an inline style
        // beats an animated property in the cascade — leaving it on would pin
        // the backdrop and the exit fade (with its blur) could never run. The
        // drag is over by the time we are closing, so the style is dropped.
        style={closing ? undefined : backdropStyle}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className={className}
        style={style}
        data-closing={closing ? 'true' : undefined}
        data-dragged={closing && dragged ? 'true' : undefined}
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
