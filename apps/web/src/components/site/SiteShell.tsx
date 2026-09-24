import type { ReactNode } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import type { SiteMode } from '@/lib/site/mode';
import { RevealObserver } from './Reveal';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SiteStyles } from './SiteStyles';

/**
 * The frame of every public Touch Padel page (the home page, the legal pages, the 404 for
 * an unknown address):
 * the site stylesheet, a skip link, the header, one `<main>`, the footer. The venue read
 * feeds the header's booking button and the footer's hours, address and contact.
 *
 * `data-theme="padel"` re-scopes every colour token inside (the document itself stays
 * `data-theme="cafe"` for the menu's sake), and `data-mode` picks night or light. The
 * server renders the mode from the cookie, so the first paint is already right.
 */
export function SiteShell({
  locale,
  mode,
  nonce,
  venue,
  path,
  children,
}: {
  locale: Locale;
  mode: SiteMode;
  nonce: string | undefined;
  venue: VenueOpeningHours | null;
  /**
   * The current page without its locale prefix: '' for home, '/privacy', …; null for a
   * page that is not one of the site's own (the 404): the header then links home first
   * and treats nothing as the current page, and the language link goes to the other
   * language's home instead of a path that does not exist there either.
   */
  path: string | null;
  children: ReactNode;
}) {
  const tr = makeT(locale);
  return (
    <>
      <SiteStyles nonce={nonce} />
      <div
        className="tp-site"
        data-theme="padel"
        data-mode={mode}
        data-page={path === '' ? 'home' : 'page'}
      >
        <a className="tp-site-skip" href="#main">
          {tr('site.skipToContent')}
        </a>
        <SiteHeader locale={locale} mode={mode} path={path} phone={venue?.phone ?? null} />
        <main id="main" className="tp-site-main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter locale={locale} venue={venue} path={path} />
        <RevealObserver />
      </div>
    </>
  );
}
