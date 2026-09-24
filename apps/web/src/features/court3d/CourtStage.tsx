'use client';

/**
 * The live court as a page element: the app's three.js court (courtCanvas.ts)
 * over its flat SVG court (CourtIllustration), with `children` riding the net.
 *
 * What a visitor sees, in order:
 *  1. SSR / no JS: the flat court, animated by CSS (still under reduced motion).
 *  2. After mount, if the tier allows (tier.ts: Save-Data and weak devices keep
 *     the flat court) and WebGL is there, three.js is fetched with a dynamic
 *     `import()` (never in the first-load chunk) once the stage comes within a
 *     screen of the viewport (an IntersectionObserver, rootMargin 100%): the court
 *     sits below a full-screen photo, and a visitor who books from the hero never
 *     pays for three.js (fix pass 2026-09-24). The canvas then draws its first
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
 * THE RALLY CAN BE PAUSED (WCAG 2.2.2, fix pass 2026-09-24). It starts on its own
 * and runs for as long as it is on screen beside the club's words, so with a
 * `pauseLabel` the stage carries a small switch at its inline-end foot (a button,
 * `aria-pressed`): pressed, the canvas holds its frame and the flat court's
 * keyframes stop; the choice is remembered for this visitor (localStorage, best
 * effort). It is drawn once JS runs, because only JS can honour it; without JS the
 * flat court plays under five seconds (three quarters of its 6.6 s loop) and then
 * holds, which needs no control. Under reduced motion nothing moves and the switch
 * is hidden.
 * Positions of the net are written straight to CSS variables on the overlay,
 * not through React state, because they change every frame while scrolling.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CourtIllustration } from './CourtIllustration';
import { canDrawWebGL, courtTierFor, readTierSignals } from './tier';
import type { CourtCanvas, NetPlacement } from './courtCanvas';

export interface CourtStageProps {
  /** Accessible name for the picture (from the catalogs). */
  label: string;
  className?: string;
  /** Pitch the camera as the stage scrolls out (the landing hero). */
  scrollLinked?: boolean;
  /** Rendered centred on the net tape, above the court. */
  children?: ReactNode;
  /** The pause switch's name (from the catalogs); without it no switch is drawn. */
  pauseLabel?: string;
}

type CourtState = 'flat' | 'live';

/** How long the net anchor glides from the flat court's net to the projected one. */
const SETTLE_MS = 320;

/** Where this visitor's pause choice is kept (per browser; never shared, never read back). */
export const COURT_PAUSED_KEY = 'tp-court-paused';

function readPaused(): boolean {
  try {
    return window.localStorage.getItem(COURT_PAUSED_KEY) === '1';
  } catch {
    return false; // storage blocked: the rally plays, and the switch still works
  }
}

function writePaused(paused: boolean): void {
  try {
    if (paused) window.localStorage.setItem(COURT_PAUSED_KEY, '1');
    else window.localStorage.removeItem(COURT_PAUSED_KEY);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

export function CourtStage({
  label,
  className,
  scrollLinked = false,
  children,
  pauseLabel,
}: CourtStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<CourtCanvas | null>(null);
  const pausedRef = useRef(false);
  const [court, setCourt] = useState<CourtState>('flat');
  const [settling, setSettling] = useState(false);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);

  // Mounted: the switch can work now, and the visitor's earlier choice applies.
  useEffect(() => {
    const saved = readPaused();
    pausedRef.current = saved;
    setPaused(saved);
    setReady(true);
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
    instanceRef.current?.setPaused(paused);
  }, [paused]);

  const togglePaused = () => {
    const next = !paused;
    writePaused(next);
    setPaused(next);
  };

  useEffect(() => {
    const host = hostRef.current;
    const netEl = netRef.current;
    if (!host) return;
    let cancelled = false;
    let instance: CourtCanvas | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let near: IntersectionObserver | null = null;

    const tier = courtTierFor(readTierSignals());
    if (tier === 'flat' || !canDrawWebGL()) return;

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
            tier,
            scrollLinked,
            paused: pausedRef.current,
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
        .then(() => {
          instanceRef.current = instance;
        })
        .catch(() => {
          // The flat court stays. A failed chunk or a renderer that cannot start
          // is not worth an error surface on a landing page.
          instance?.dispose();
          instance = null;
        });

    // Fetch three.js only once the stage is within a screen of the viewport.
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
      near?.disconnect();
      instanceRef.current = null;
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
      data-js={ready ? '' : undefined}
      data-paused={paused ? '' : undefined}
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
      {pauseLabel && ready ? (
        <button
          type="button"
          className="tp-court-stage__pause"
          aria-label={pauseLabel}
          aria-pressed={paused}
          onClick={togglePaused}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            {paused ? (
              <path d="M4.5 2.8v10.4L13 8z" />
            ) : (
              <path d="M4 2.5h2.8v11H4zM9.2 2.5H12v11H9.2z" />
            )}
          </svg>
        </button>
      ) : null}
    </div>
  );
}
