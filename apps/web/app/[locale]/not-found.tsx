import { locale as rootLocale } from 'next/root-params';
import { makeT } from '@touch/i18n';
import { asLocale, otherLocale } from '@/lib/locales';
import { getSiteMode } from '@/lib/site/mode.server';
import { siteLostCss, siteLostFrameCss } from '@/styles/site/lost.css';
import { BrandLockup } from '@/components/site/brand/BrandLockup';
import { LostCourt } from '@/components/site/LostCourt';

/**
 * The segment's fallback 404: what a `notFound()` thrown by a page in `[locale]` renders
 * (a refused locale, `requireLocale()`). An address that matches no route at all never
 * lands here: `[...rest]/page.tsx` catches it and its own `not-found.tsx` renders the 404
 * in the full site shell.
 *
 * Kept as light as the error boundary on purpose (perf finding P1, 2026-09-24). Next
 * serialises a segment's not-found element into the RSC payload of EVERY route under
 * it, the café menu's included, so the shell this file used to render (the whole site
 * sheet, the header's client components, a venue read) rode along on every table
 * guest's menu load. Now it is the lost sheet plus a bare frame (the lockup linking
 * home, one row of plain links), no client component and no data read beyond the mode
 * cookie, which the pages under it read anyway.
 *
 * `not-found` receives no params in Next 16, but the locale IS this app's root
 * parameter (the root layout lives at app/[locale]), and `next/root-params` hands it to
 * any Server Component. A refused first segment reads as Arabic, the default, exactly as
 * the layout's `asLocale` already set the document's `lang` and `dir`.
 */
export default async function LocaleNotFound() {
  const locale = asLocale((await rootLocale()) ?? '');
  const other = otherLocale(locale);
  const tr = makeT(locale);
  const mode = await getSiteMode();
  return (
    <div className="tp-lost-page" data-theme="padel" data-mode={mode}>
      <style dangerouslySetInnerHTML={{ __html: `${siteLostCss}\n${siteLostFrameCss}` }} />
      <header className="tp-lost-bar">
        <a className="tp-lost-bar__home" href={`/${locale}`} aria-label={tr('site.brandHome')}>
          <BrandLockup />
        </a>
      </header>
      <main className="tp-lost tp-lost--bare">
        <LostCourt />
        <div className="tp-lost__copy">
          <h1 className="tp-lost__title tp-lost__title--sized">{tr('site.notFound.title')}</h1>
          <p className="tp-lost__body">{tr('site.notFound.body')}</p>
          <div className="tp-lost__actions">
            <a className="tp-lost__btn tp-lost__btn--go" href={`/${locale}`}>
              {tr('site.notFound.home')}
            </a>
            <a className="tp-lost__btn" href={`/${locale}/menu`}>
              {tr('site.notFound.menu')}
            </a>
          </div>
        </div>
      </main>
      <footer className="tp-lost-foot">
        <a href={`/${locale}/support`}>{tr('site.footer.support')}</a>
        <a href={`/${locale}/privacy`}>{tr('site.footer.privacy')}</a>
        <a href={`/${other}`} hrefLang={other} lang={other}>
          {tr('site.nav.language')}
        </a>
      </footer>
    </div>
  );
}
