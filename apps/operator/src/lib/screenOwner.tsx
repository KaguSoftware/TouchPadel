/**
 * Who owns the whole screen right now — the one thing the macOS window-drag
 * strip has to ask before it claims the top edge.
 *
 * The strip (`WindowDragStrip`, routes/__root.tsx) is a fixed band across the
 * top of EVERY screen, and Chromium hands macOS a draggable region computed
 * from its painted box — ignoring `pointer-events`, ignoring z-order, ignoring
 * whatever paints over it. That is deliberate and load-bearing: it is what lets
 * the strip overlay the rail without swallowing the rail's clicks.
 *
 * It cuts the other way for an overlay that runs to `insetBlock: 0`. Its own
 * header sits inside the band, so the OS eats those clicks and the buttons go
 * dead — the assistant drawer's close button being the one that started this.
 * Raising the overlay's z-index does NOT fix it; only not painting the strip
 * does.
 *
 * So an overlay that owns the screen says so with `useOwnsScreen()`, and the
 * strip stands down while any of them is up. The window cannot be dragged by
 * its top edge in that state, which is what a native modal sheet does too — the
 * traffic lights keep working regardless, since macOS draws those itself.
 *
 * A count, not a boolean: overlays legitimately stack (a Modal opened from the
 * assistant drawer), and the strip may only come back when the last one goes.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ScreenOwnerValue {
  /** True while at least one full-screen overlay is mounted. */
  owned: boolean;
  claim: () => () => void;
}

const ScreenOwnerContext = createContext<ScreenOwnerValue | null>(null);

export function ScreenOwnerProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  // The claim identity must not change with the count, or every consumer's
  // effect would tear down and re-run on each other overlay's open — which
  // double-counts. A ref keeps it stable for the life of the provider.
  const claim = useRef(() => {
    setCount((n) => n + 1);
    let released = false;
    return () => {
      // Idempotent: React may run a cleanup twice (StrictMode, and a remount
      // during a transition), and a double decrement would let the strip back
      // while an overlay is still up.
      if (released) return;
      released = true;
      setCount((n) => Math.max(0, n - 1));
    };
  }).current;

  const value = useMemo(() => ({ owned: count > 0, claim }), [count, claim]);
  return <ScreenOwnerContext.Provider value={value}>{children}</ScreenOwnerContext.Provider>;
}

/**
 * Declares that this component owns the whole screen while it is mounted, so
 * the window-drag strip stands down and the component's own top edge stays
 * clickable. Call it unconditionally from a component that only renders when
 * its overlay is open — mount IS the claim.
 *
 * Outside the provider it does nothing: the pre-auth screens and the unit tests
 * that render an overlay on its own have no strip to stand down.
 */
export function useOwnsScreen(): void {
  const ctx = useContext(ScreenOwnerContext);
  const claim = ctx?.claim;
  useEffect(() => claim?.(), [claim]);
}

/**
 * The same claim as a component, for an overlay whose visibility is an early
 * `return null` AFTER its hooks — `useOwnsScreen()` up with the other hooks
 * would claim while the overlay is hidden and strand the strip. Rendering this
 * inside the visible branch ties the claim to what is actually on screen.
 */
export function ScreenOwnerClaim() {
  useOwnsScreen();
  return null;
}

/** Whether any overlay currently owns the screen. For the drag strip only. */
export function useScreenOwned(): boolean {
  return useContext(ScreenOwnerContext)?.owned ?? false;
}
