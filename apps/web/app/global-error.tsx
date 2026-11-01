'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { dirAttr, makeT, type Locale } from '@touch/i18n';
import { asLocale, DEFAULT_LOCALE } from '@/lib/locales';
import { DEFAULT_SITE_MODE, siteModeFromCookieString, type SiteMode } from '@/lib/site/mode';
import { globalErrorCss } from '@/styles/site/globalError.css';
import { LostCourt } from '@/components/site/LostCourt';
import { digestOf, ReportProblem } from '@/components/site/ReportProblem';
import { reportError } from '@/lib/monitoring';

/**
 * The global error page (F-43, 2026-11-01): what a guest sees when the root layout itself
 * (`app/[locale]/layout.tsx`) throws. Until now there was none, so Next's default English
 * page showed, unstyled, even at /ar.
 *
 * It REPLACES the root layout, so it brings its own `<html>` and `<body>`, its own sheet
 * (`globalErrorCss`: the padel tokens, the brand faces and the error screen's rules, since
 * none of the layout's inlined theme reaches it), its language and direction, and its title
 * (a React `<title>`: metadata exports are not supported here). It is the same screen as
 * the segment's error boundary (`[locale]/error.tsx`): "This page did not load.", Try again,
 * Back to Touch Padel, and "Report this problem".
 *
 * An error boundary gets no params. The locale is the first segment of the address, read in
 * the browser; the server pass, and any address without one, uses the site's default,
 * Arabic. The mode comes from the visitor's cookie the same way. The error is reported to
 * dev monitoring when the page opens.
 */
const subscribe = () => () => {};

function localeFromPath(): Locale {
  const first = window.location.pathname.split('/')[1] ?? '';
  return asLocale(first || DEFAULT_LOCALE);
}
const serverLocale = (): Locale => DEFAULT_LOCALE;
const readMode = (): SiteMode => siteModeFromCookieString(document.cookie);
const serverMode = (): SiteMode => DEFAULT_SITE_MODE;

export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: unknown;
  retry?: () => void;
  reset?: () => void;
}) {
  const locale = useSyncExternalStore(subscribe, localeFromPath, serverLocale);
  const mode = useSyncExternalStore(subscribe, readMode, serverMode);
  const tr = makeT(locale);
  useEffect(() => {
    console.error('[site] root layout error:', error);
    void reportError('web_error', error, { detail: { where: 'global', digest: digestOf(error) } });
  }, [error]);
  const again = retry ?? reset;

  return (
    <html lang={locale} dir={dirAttr(locale)} data-theme="padel" data-mode={mode}>
      <head>
        <title>{tr('site.error.title')}</title>
        <meta name="robots" content="noindex" />
        <style dangerouslySetInnerHTML={{ __html: globalErrorCss }} />
      </head>
      <body>
        <div className="tp-lost-page" data-theme="padel" data-mode={mode}>
          <main className="tp-lost tp-lost--bare">
            <LostCourt />
            <div className="tp-lost__copy">
              <h1 className="tp-lost__title tp-lost__title--sized">{tr('site.error.title')}</h1>
              <p className="tp-lost__body">{tr('site.error.body')}</p>
              <div className="tp-lost__actions">
                <button
                  type="button"
                  className="tp-lost__btn tp-lost__btn--go"
                  onClick={() => (again ? again() : window.location.reload())}
                >
                  {tr('site.error.retry')}
                </button>
                <a className="tp-lost__btn" href={`/${locale}`}>
                  {tr('site.error.home')}
                </a>
                <ReportProblem locale={locale} error={error} where="global" />
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
