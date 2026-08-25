'use client';

import { useEffect, useState } from 'react';
import { makeT, dirAttr, type Locale } from '@touch/i18n';
import { hrefForLocale, LOCALE_COOKIE, otherLocale } from '@/lib/locales';

/**
 * Locale switch as a real `<a>` — a FULL navigation, not a client transition:
 * `<html lang/dir>` is rendered by the server layout, so React cannot flip the
 * document direction on its own.
 *
 * The href preserves the current path AND query, and rewrites a leading
 * /en|/ar or prefixes a locale-less printed `/t/{token}` URL. Path + search
 * are read from `window.location` (not `useSearchParams`, which would opt the
 * statically rendered `/{locale}` page out of SSR).
 *
 * The click also writes the `tp-locale` cookie so a re-scan of the printed,
 * locale-less QR keeps the guest's choice (web-slice §0).
 */
export function LocaleSwitcher({ locale, token }: { locale: Locale; token: string | null }) {
  const other = otherLocale(locale);
  // SSR-safe default; refined to the live URL (with its query) after mount.
  const [href, setHref] = useState(() => (token ? `/${other}/t/${token}` : `/${other}`));

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

  return (
    <a
      href={href}
      lang={other}
      dir={dirAttr(other)}
      hrefLang={other}
      className="tp-locale-switch"
      onClick={remember}
    >
      {makeT(locale)('cafe.localeSwitch')}
    </a>
  );
}
