'use client';

import { useState } from 'react';
import { flushSync } from 'react-dom';
import { siteModeCookie, type SiteMode } from '@/lib/site/mode';
import { MoonIcon, SunIcon } from './icons';

/**
 * Night ↔ light. The server already rendered the right mode from the `tp-site-mode`
 * cookie, so this only has to flip it: the `.tp-site` wrapper's `data-mode` (every
 * colour is a token under it, and the html/body ground follows through `:has`), the
 * cookie for the next page, and the browser chrome's theme colour.
 *
 * Labelled with what it WILL do ("Switch to light mode"), not with a state, and shows
 * the icon of the mode it switches TO. The label is also printed beside the icon; CSS
 * shows it only in the phone menu sheet, where the toggle is a labelled pill. No JS: the button does nothing and the page stays
 * in the server's mode, which is the brand's night.
 *
 * The page changes smoothly: where the browser has view transitions the whole page
 * cross-fades from the old mode to the new (base.css.ts, `tp-mode-shift`), and
 * elsewhere the grounds, inks and borders ease across for the same span. The button
 * is left out of the fade: its icon turns in as it swaps, after a click (not on load).
 * Under reduced motion the mode just changes.
 */
/** How long the fallback keeps the colour transitions on (matches base.css.ts). */
const MODE_SHIFT_MS = 420;
export function ThemeToggle({
  initialMode,
  labels,
  themeColors,
}: {
  initialMode: SiteMode;
  labels: { toNight: string; toLight: string };
  themeColors: Record<SiteMode, string>;
}) {
  const [mode, setMode] = useState<SiteMode>(initialMode);
  const [flipped, setFlipped] = useState(false);
  const next: SiteMode = mode === 'night' ? 'light' : 'night';

  function flip(event: React.MouseEvent<HTMLButtonElement>) {
    const site = event.currentTarget.closest<HTMLElement>('.tp-site');
    const apply = () => {
      site?.setAttribute('data-mode', next);
      for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
        meta.setAttribute('content', themeColors[next]);
      }
      flushSync(() => {
        setMode(next);
        setFlipped(true);
      });
    };
    document.cookie = siteModeCookie(next, window.location.protocol === 'https:');

    const root = document.documentElement;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => { finished?: Promise<unknown> } | undefined;
    };
    if (still) {
      apply();
    } else if (typeof doc.startViewTransition === 'function') {
      root.classList.add('tp-mode-shift');
      const done = () => root.classList.remove('tp-mode-shift');
      const transition = doc.startViewTransition(apply);
      if (transition?.finished) void transition.finished.then(done, done);
      else done();
    } else {
      // No view transitions: ease the colours instead, then take the transitions off so
      // they never slow a hover.
      root.classList.add('tp-mode-fade');
      apply();
      window.setTimeout(() => root.classList.remove('tp-mode-fade'), MODE_SHIFT_MS);
    }
  }

  const label = next === 'light' ? labels.toLight : labels.toNight;
  return (
    <button
      type="button"
      className="tp-site-iconbtn tp-theme-toggle"
      aria-label={label}
      title={label}
      data-mode-next={next}
      onClick={flip}
    >
      <span
        className="tp-theme-toggle__icon"
        data-turn={flipped ? '' : undefined}
        key={next}
        aria-hidden="true"
      >
        {next === 'light' ? <SunIcon /> : <MoonIcon />}
      </span>
      <span className="tp-theme-toggle__text" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
