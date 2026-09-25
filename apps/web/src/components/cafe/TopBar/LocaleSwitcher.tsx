'use client';

import { useEffect, useState } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { hrefForLocale, LOCALE_COOKIE, otherLocale } from '@/lib/locales';

/**
 * Locale switch as a real `<a>` — a FULL navigation, not a client transition:
 * `<html lang/dir>` is rendered by the server layout, so React cannot flip the
 * document direction on its own.
 *
 * The href preserves the current path AND query, and rewrites a leading
 * /en|/ar or prefixes a locale-less printed `/t/{token}` URL. Path + search
 * are read from `window.location` (not `useSearchParams`, which would need a
 * Suspense boundary around the top bar).
 *
 * The click also writes the `tp-locale` cookie so a re-scan of the printed,
 * locale-less QR keeps the guest's choice (web-slice §0).
 *
 * It is drawn as a globe + the TARGET language's two-letter code (AR on the
 * English page, EN on the Arabic one) rather than the language's own name: the
 * top bar has to seat the table chip, this and the basket either side of a
 * 175 px lockup, and a spelled-out "العربية" is what used to push the controls
 * over the wordmark. The name it replaces is still the accessible name.
 *
 * The visible code is a Latin abbreviation, so `dir` is NOT flipped here — the
 * icon and the code keep the page's own order; `lang`/`hrefLang` still declare
 * where the link goes (the aria-label IS in the target language).
 */
export function LocaleSwitcher({
  locale,
}: {
  locale: Locale;
  /** Unused since 2026-09-23 (see the default below); TopBar still passes it. */
  token?: string | null;
}) {
  const other = otherLocale(locale);
  // SSR-safe default; refined to the live URL (with its query) after mount.
  // This switch only renders on the café menu, so the default is the menu in
  // the other language, table or no table: since 2026-09-23 a bound guest's
  // token lives in the `tp-table` cookie, which /{other}/menu reads, so it is
  // never written into server-rendered HTML here (the old `/t/{token}` default
  // was). Before hydration a click still lands on the menu, not the landing.
  const [href, setHref] = useState(() => `/${other}/menu`);

  useEffect(() => {
    setHref(hrefForLocale(window.location.pathname, window.location.search, other));
  }, [other]);

  const remember = () => {
    try {
      document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* cookies blocked — the path prefix still carries the choice */
    }
  };

  const label = makeT(locale)('cafe.localeSwitch');

  return (
    <a
      href={href}
      lang={other}
      hrefLang={other}
      className="tp-locale-switch"
      aria-label={label}
      title={label}
      onClick={remember}
    >
      <svg
        className="tp-locale-switch__globe"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.7 2.9 2.7 15.1 0 18-2.7-2.9-2.7-15.1 0-18Z" />
      </svg>
      <span className="tp-locale-switch__code" aria-hidden="true">
        {other.toUpperCase()}
      </span>
    </a>
  );
}
