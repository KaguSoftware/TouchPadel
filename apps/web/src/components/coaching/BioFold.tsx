'use client';

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type TransitionEvent,
} from 'react';

/**
 * The coach card's "Bio" row: a `<details>` that slides open and shut (220 ms, the app's bio
 * fold) in every browser, phone and desktop alike. The slide is a grid row going between 0fr
 * and 1fr, so it needs no measured height and no newer CSS; the script only keeps `open` on
 * for the length of the slide. Without JS it is the plain `<details>`, which opens at once.
 */
export function BioFold({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => setReady(true), []);

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const toggle = (e: MouseEvent) => {
    const details = ref.current;
    if (!details) return;
    e.preventDefault();
    if (!details.open) {
      details.open = true;
      // One frame with the row still closed, so the transition has somewhere to start from.
      if (reduced()) setShown(true);
      else window.requestAnimationFrame(() => window.requestAnimationFrame(() => setShown(true)));
    } else {
      setShown(false);
      if (reduced()) details.open = false;
    }
  };

  // Shut for good only once the slide has finished, so the content does not vanish mid-way.
  const settled = (e: TransitionEvent) => {
    if (
      e.target === e.currentTarget &&
      e.propertyName === 'grid-template-rows' &&
      !shown &&
      ref.current
    ) {
      ref.current.open = false;
    }
  };

  return (
    <details
      ref={ref}
      className="tp-clink__fold"
      data-js={ready ? '' : undefined}
      data-shown={shown ? 'true' : 'false'}
    >
      <summary className="tp-clink__fold-row" onClick={toggle}>
        <span>{label}</span>
        <span className="tp-clink__chev" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M3.5 6 8 10.5 12.5 6" />
          </svg>
        </span>
      </summary>
      <div className="tp-clink__fold-body" onTransitionEnd={settled}>
        <div className="tp-clink__fold-inner">{children}</div>
      </div>
    </details>
  );
}
