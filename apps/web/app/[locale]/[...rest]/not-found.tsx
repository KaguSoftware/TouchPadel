import { locale as rootLocale } from 'next/root-params';
import { makeT } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SiteShell } from '@/components/site/SiteShell';
import { LostCourt } from '@/components/site/LostCourt';

/**
 * The 404 a visitor actually meets: an address under a locale that matches no page
 * (`[...rest]/page.tsx` throws). "Out of bounds", in the full site shell (header, footer,
 * the visitor's mode), with the two ways back (home and the café menu) as plain links.
 *
 * It lives in the catch-all's segment, not in `[locale]`, so only this route's payload
 * carries the site sheet it brings; the segment-wide fallback (`../not-found.tsx`) stays
 * small because Next ships it inside every route, the café menu included.
 *
 * `path={null}`: the 404 is none of the site's pages, so the header links go home first
 * (`/en#club`, not a fragment this page does not have), the header is the solid one, no
 * footer link is marked current, and the language link goes to the other home.
 */
export default async function UnknownAddressNotFound() {
  const locale = asLocale((await rootLocale()) ?? '');
  const tr = makeT(locale);
  const [venue, mode, nonce] = await Promise.all([
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path={null}>
      <div className="tp-lost">
        <LostCourt />
        <div className="tp-lost__copy tp-fit">
          <h1 className="tp-display tp-lost__title">{tr('site.notFound.title')}</h1>
          <p className="tp-lost__body">{tr('site.notFound.body')}</p>
          <div className="tp-lost__actions">
            <a className="tp-site-btn tp-site-btn--go" href={`/${locale}`}>
              {tr('site.notFound.home')}
            </a>
            <a className="tp-site-btn tp-site-btn--ghost" href={`/${locale}/menu`}>
              {tr('site.notFound.menu')}
            </a>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
