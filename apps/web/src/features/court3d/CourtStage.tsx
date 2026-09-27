'use client';

/**
 * The live court as a page element: the app's three.js court (courtCanvas.ts)
 * over its flat SVG court (CourtIllustration), with `children` riding the net.
 *
 * What a visitor sees, in order:
 *  1. SSR / no JS: the flat court, animated by CSS (still under reduced motion).
 *  2. After mount, if the browser has WebGL (webgl.ts, the only gate: every
 *     browser that can draw it gets the full court), three.js arrives through a
 *     dynamic `import()`, never in the first-load chunk. The chunk is fetched
 *     once the page is idle (requestIdleCallback; skipped under Save-Data, whose
 *     visitors fetch it only on the way to the court), and the canvas is created
 *     once the stage comes within a screen of the viewport (an
 *     IntersectionObserver, rootMargin 100%). The canvas then draws its first
 *     frame behind the flat court.
 *  3. That first frame cross-fades the canvas in over 260 ms
 *     (--tp-site-dur-base); the flat court fades out and stops animating.
 * Any failure on the way (no WebGL, the chunk fails to load, the renderer
 * throws) leaves step 1 in place. Nothing is ever blank.
 *
 * The component fills its parent: the caller sets the size and aspect. The
 * visual layer is one `role="img"` with the caller's label; the overlay with
 * the children is a sibling, so they stay interactive and in tab order.
 *
 * The rally loops for as long as it is on screen, with or without JS; there is no
 * pause switch. Under reduced motion nothing moves.
 * Positions of the net are written straight to CSS variables on the overlay,
 * not through React state, because they change every frame while scrolling.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CourtIllustration } from './CourtIllustration';
import { canDrawWebGL } from './webgl';
import type { CourtCanvas, NetPlacement } from './courtCanvas';

export interface CourtStageProps {
  /** Accessible name for the picture (from the catalogs). */
  label: string;
  className?: string;
  /** Sway the camera as the stage's section scrolls past (the club section). */
  scrollLinked?: boolean;
  /** Rendered centred on the net tape, above the court. */
  children?: ReactNode;
}

type CourtState = 'flat' | 'live';

/** How long the net anchor glides from the flat court's net to the projected one. */
const SETTLE_MS = 320;

/** How long after mount an idle-less browser waits before fetching three.js. */
const PREFETCH_FALLBACK_MS = 1500;

export function CourtStage({
  label,
  className,
  scrollLinked = false,
  children,
}: CourtStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<HTMLDivElement>(null);
  const [court, setCourt] = useState<CourtState>('flat');
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const netEl = netRef.current;
    if (!host) return;
    let cancelled = false;
    let instance: CourtCanvas | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let near: IntersectionObserver | null = null;

    if (!canDrawWebGL()) return;

    const placeNet = (net: NetPlacement) => {
      const el = netRef.current ?? netEl;
      if (!el) return;
      el.style.setProperty('--tp-court-net-dx', `${net.dx}px`);
      el.style.setProperty('--tp-court-net-dy', `${net.dy}px`);
      el.style.setProperty('--tp-court-net-w', `${net.width}px`);
    };

    const load = () =>
      import('./courtCanvas')
        .then(({ createCourtCanvas }) => {
          if (cancelled) return;
          instance = createCourtCanvas({
            host,
            scrollLinked,
            // The section drives the move: on a desktop the court's box is sticky,
            // and a sticky box's own rect hardly moves while the page scrolls.
            scrollRoot: host.closest('section') ?? host,
            canvasClassName: 'tp-court-stage__canvas',
            onNet: placeNet,
            onFirstFrame: () => {
              if (cancelled) return;
              setSettling(true);
              setCourt('live');
              settleTimer = setTimeout(() => setSettling(false), SETTLE_MS);
            },
          });
        })
        .catch(() => {
          // The flat court stays. A failed chunk or a renderer that cannot start
          // is not worth an error surface on a landing page.
          instance?.dispose();
          instance = null;
        });

    // Fetch the chunk while the page is idle, so the court is ready to draw by the
    // time the visitor reaches it. Only the download: nothing is created until the
    // stage is near. Save-Data asked us not to spend their bundle ahead of need.
    const saveData =
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const prefetch = () => {
      if (!cancelled) void import('./courtCanvas').catch(() => undefined);
    };
    let idleId: number | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    if (!saveData) {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(prefetch, { timeout: 4000 });
      } else {
        idleTimer = setTimeout(prefetch, PREFETCH_FALLBACK_MS);
      }
    }

    // Create the canvas once the stage is within a screen of the viewport.
    if (typeof IntersectionObserver === 'function') {
      near = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          near?.disconnect();
          near = null;
          void load();
        },
        { rootMargin: '100% 0px' },
      );
      near.observe(host);
    } else {
      void load();
    }

    return () => {
      cancelled = true;
      if (idleId !== null) window.cancelIdleCallback?.(idleId);
      if (idleTimer !== null) clearTimeout(idleTimer);
      near?.disconnect();
      if (settleTimer !== null) clearTimeout(settleTimer);
      instance?.dispose();
      instance = null;
      const el = netEl;
      el?.style.removeProperty('--tp-court-net-dx');
      el?.style.removeProperty('--tp-court-net-dy');
      el?.style.removeProperty('--tp-court-net-w');
      setCourt('flat');
    };
  }, [scrollLinked]);

  return (
    <div
      className={['tp-court-stage', className].filter(Boolean).join(' ')}
      data-court={court}
      data-net={settling ? 'settling' : undefined}
    >
      <div className="tp-court-stage__visual" role="img" aria-label={label}>
        <CourtIllustration className="tp-court-stage__flat" />
        <div className="tp-court-stage__gl" ref={hostRef} />
      </div>
      {children !== undefined && children !== null ? (
        <div className="tp-court-stage__overlay">
          <div className="tp-court-stage__net" ref={netRef}>
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}
