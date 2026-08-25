'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { makeT, type Locale } from '@touch/i18n';

/**
 * First-scan coach mark for the bell (owner decision 8). Shown ONCE per
 * browser session (`sessionStorage`), only for a bound table with the bell
 * enabled and no overlay competing for the screen, and it disappears after 6 s
 * or on any tap.
 *
 * The spotlight is JS-MEASURED from the FAB's real rect (the FAB sits inside
 * safe-area insets, so a hard-coded position drifts across devices), and fed
 * to the scrim's radial mask through `--tp-spot-*` custom properties. The
 * arrow mirrors itself under RTL (tutorial.css.ts).
 */
const SEEN_KEY = 'tp-bell-tutorial-seen';
const AUTO_DISMISS_MS = 6_000;

export function hasSeenBellTutorial(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked — do not nag on every render
  }
}

function markSeen(): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function BellTutorial({
  locale,
  targetRef,
  onDismiss,
}: {
  locale: Locale;
  targetRef: React.RefObject<HTMLElement | null>;
  onDismiss(): void;
}) {
  const tr = makeT(locale);
  const [spot, setSpot] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSpot({
      '--tp-spot-x': `${rect.left + rect.width / 2}px`,
      '--tp-spot-y': `${rect.top + rect.height / 2}px`,
      '--tp-spot-r': `${Math.max(rect.width, rect.height) / 2 + 10}px`,
    } as CSSProperties);
  }, [targetRef]);

  // The auto-dismiss timer must be armed ONCE, on mount. Depending on
  // `onDismiss` would restart it on every parent render (the ticker, the waiter
  // cooldown and the dwell timer all re-render CafeApp well inside 6 s), and
  // the scrim would sit over the whole menu forever — the guest could not open
  // a single item. Keep the callback in a ref so identity churn cannot reach
  // the timer.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    markSeen();
    const timer = setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!spot) return null;

  return (
    <div className="tp-tutorial" style={spot} role="dialog" aria-label={tr('cafe.bellTutorial.title')}>
      <div className="tp-tutorial__scrim" onClick={onDismiss} />
      <svg className="tp-tutorial__arrow" viewBox="0 0 100 80" aria-hidden="true" focusable="false">
        <path d="M92 8 C 60 10, 26 28, 14 62" />
        <path d="M10 74 L14 60 L28 66" />
      </svg>
      <div className="tp-tutorial__card">
        <span className="tp-eyebrow">{tr('cafe.bellTutorial.eyebrow')}</span>
        <span className="tp-tutorial__title">{tr('cafe.bellTutorial.title')}</span>
        <button type="button" className="tp-btn tp-btn--primary" onClick={onDismiss}>
          {tr('cafe.bellTutorial.dismiss')}
        </button>
      </div>
    </div>
  );
}
