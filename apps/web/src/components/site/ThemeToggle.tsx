'use client';

import { useState } from 'react';
import { siteModeCookie, type SiteMode } from '@/lib/site/mode';
import { MoonIcon, SunIcon } from './icons';

/**
 * Night ↔ light. The server already rendered the right mode from the `tp-site-mode`
 * cookie, so this only has to flip it: the `.tp-site` wrapper's `data-mode` (every
 * colour is a token under it, and the html/body ground follows through `:has`), the
 * cookie for the next page, and the browser chrome's theme colour.
 *
 * Labelled with what it WILL do ("Switch to light mode"), not with a state, and shows
 * the icon of the mode it switches TO. No JS: the button does nothing and the page stays
 * in the server's mode, which is the brand's night.
 */
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
  const next: SiteMode = mode === 'night' ? 'light' : 'night';

  function flip(event: React.MouseEvent<HTMLButtonElement>) {
    const site = event.currentTarget.closest<HTMLElement>('.tp-site');
    site?.setAttribute('data-mode', next);
    document.cookie = siteModeCookie(next, window.location.protocol === 'https:');
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.setAttribute('content', themeColors[next]);
    }
    setMode(next);
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
      {next === 'light' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
