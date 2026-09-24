'use client';

import type { ReactNode } from 'react';
import type { Locale } from '@touch/i18n';
import { LOCALE_COOKIE } from '@/lib/locales';

/**
 * The language switch: a plain link to the same page in the other language, which also
 * remembers the choice in `tp-locale` (the cookie proxy.ts reads before Accept-Language
 * when someone types the bare domain). Same cookie shape as the café's LocaleSwitcher.
 * Without JS it is still a working link; only the memory is lost.
 *
 * Its accessible name STARTS with the word on screen ("العربية", then "(Read this page in
 * Arabic)" for screen readers only), so a speech-input user who says "click العربية" or
 * "click English" hits it (WCAG 2.5.3, Label in Name). An `aria-label` would replace the
 * visible word instead, which is what this used to do.
 */
export function LanguageLink({
  href,
  target,
  label,
  className,
  children,
}: {
  href: string;
  target: Locale;
  /**
   * In the PAGE's language, naming the target ("Read this page in Arabic" on /en). Read
   * by screen readers after the visible word, never instead of it.
   */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const remember = () => {
    try {
      document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* cookies blocked: the path prefix still carries the choice */
    }
  };
  return (
    <a href={href} hrefLang={target} className={className} onClick={remember}>
      {/* The visible word is in the target language ("العربية"), and says so. */}
      <span lang={target}>{children}</span>
      <span className="tp-site-sr"> ({label})</span>
    </a>
  );
}
