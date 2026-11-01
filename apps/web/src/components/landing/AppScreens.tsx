'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** One thing the app will do, and the real app screen that shows it. */
export interface AppScreen {
  key: string;
  eyebrow: string;
  title: string;
  /** The screenshot, cut from the app's own store render (`/brand/app/*`), bare: the phone frame is drawn in CSS. */
  src: string;
  alt: string;
}

/** How long each screen stays up while the band flips through them on its own. */
export const APP_SCREEN_MS = 5000;

/** How long the last screen stays on after its time is up while the lines drain, last to first. */
export const APP_DRAIN_MS = 900;

/**
 * The app band's moving part: the three promises as a vertical tab list beside one
 * phone, and choosing a promise puts its screen on the phone. While the band is on
 * screen it flips through them by itself, round and round (after the last comes the
 * first again); picking one shows it and restarts the count from there, so the loop
 * carries on. Under reduced motion it never flips on its own.
 *
 * Each promise has an edge line that shows the time. While the band is flipping, the
 * picked promise's line fills over exactly one screen's time (`data-line="run"`, the same
 * time as the timer), and the lines before it stay full (`data-line="full"`), like a
 * story's progress. After the last screen's time is up it stays on screen while all the
 * lines drain together from the last back to the first (`data-line="drain"`, APP_DRAIN_MS),
 * then the first screen shows and fills in its full time. Otherwise (not flipping) the
 * picked line is simply full.
 *
 * `head` and `foot` are the server-rendered words above and below the list (title;
 * body, contact buttons and store badges), so the list sits between them in one column
 * and the phone gets the other. Without script the first screen shows and the rest of
 * the band is complete.
 */
export function AppScreens({
  screens,
  head,
  foot,
}: {
  screens: readonly AppScreen[];
  head: ReactNode;
  foot: ReactNode;
}) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [draining, setDraining] = useState(false);
  const last = screens.length - 1;

  // Flip only while the band is in view, and never under reduced motion.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(([entry]) => setAuto(entry?.isIntersecting ?? false), {
      threshold: 0.2,
    });
    io.observe(root);
    return () => io.disconnect();
  }, []);

  // One screen's time, then the next; after the last, the drain (below).
  useEffect(() => {
    if (!auto || draining) return;
    const id = window.setTimeout(() => {
      if (active === last) setDraining(true);
      else setActive(active + 1);
    }, APP_SCREEN_MS);
    return () => window.clearTimeout(id);
  }, [auto, draining, active, last]);

  // The drain over, the loop comes round to the first screen.
  useEffect(() => {
    if (!draining) return;
    const id = window.setTimeout(() => {
      setDraining(false);
      setActive(0);
    }, APP_DRAIN_MS);
    return () => window.clearTimeout(id);
  }, [draining]);

  // Out of view, the drain is dropped and the lines settle.
  useEffect(() => {
    if (!auto) setDraining(false);
  }, [auto]);

  // What the tab's edge line is doing: filling, full, or draining.
  const line = (i: number) =>
    draining ? 'drain' : i < active ? 'full' : i === active ? (auto ? 'run' : 'full') : undefined;

  // A pick changes `active`, which restarts the timer above from the picked screen (or stops a drain).
  const pick = (i: number, focus = false) => {
    setDraining(false);
    setActive(i);
    if (focus) tabRefs.current[i]?.focus();
  };

  // Arrow keys move along the list (vertical, so the same in both directions).
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = screens.length - 1;
    const next =
      e.key === 'ArrowDown'
        ? active === last
          ? 0
          : active + 1
        : e.key === 'ArrowUp'
          ? active === 0
            ? last
            : active - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    pick(next, true);
  };

  return (
    <div
      ref={rootRef}
      className="tp-appband__inner"
      style={{
        ['--tp-appband-ms' as string]: `${APP_SCREEN_MS}ms`,
        ['--tp-appband-drain' as string]: `${APP_DRAIN_MS}ms`,
        ['--tp-appband-n' as string]: screens.length,
      }}
    >
      <div className="tp-appband__copy">
        {head}
        <div className="tp-appband__tabs" data-reveal="" role="tablist" aria-orientation="vertical">
          {screens.map((screen, i) => (
            <button
              key={screen.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`app-tab-${screen.key}`}
              className="tp-appband__tab"
              aria-selected={i === active}
              data-line={line(i)}
              style={{ ['--tp-appband-i' as string]: i }}
              aria-controls="app-screen"
              tabIndex={i === active ? 0 : -1}
              onClick={() => pick(i)}
              onKeyDown={onKeyDown}
            >
              <span className="tp-appband__tab-eyebrow">{screen.eyebrow}</span>
              <span className="tp-appband__tab-title">{screen.title}</span>
            </button>
          ))}
        </div>
        {foot}
      </div>
      <div
        className="tp-appband__phone"
        data-reveal=""
        id="app-screen"
        role="tabpanel"
        aria-labelledby={`app-tab-${screens[active]?.key}`}
      >
        <div className="tp-appband__device">
          <div className="tp-appband__bezel">
        {screens.map((screen, i) => (
          // Already sized and encoded for this slot (720 px wide, webp, no frame: the frame is CSS); next/image would
          // only add a loader round-trip.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={screen.key}
            className="tp-appband__screen"
            src={screen.src}
            alt={screen.alt}
            width={720}
            height={1565}
            loading="lazy"
            decoding="async"
            data-on={i === active ? '' : undefined}
            aria-hidden={i === active ? undefined : true}
          />
        ))}
          </div>
        </div>
      </div>
    </div>
  );
}
