import type { Metadata, Viewport } from 'next';
import { makeT } from '@touch/i18n';
import { otherLocale, requireLocale } from '@/lib/locales';
import { appReturnHref, parsePaymentRef, payReturnPath } from '@/lib/site/payReturn';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { siteTokensBridgeCss } from '@/styles/site/tokens-bridge.css';
import { sitePayReturnCss } from '@/styles/site/payReturn.css';
import { BrandLockup } from '@/components/site/brand/BrandLockup';
import { OpenAppOnLoad } from '@/components/site/OpenAppOnLoad';

/**
 * `/{locale}/pay/return?ref=<request_id>`: where Qi's hosted payment page sends the
 * guest's browser once they are done there (qi-deposit-plan-2026-09-20.md §6, build
 * contracts 2026-09-27 §3 and §5). Its only job is to get the guest back into the app,
 * which asks the server how the payment went and shows that.
 *
 * IT NEVER SHOWS A RESULT. It does not know one: Qi's redirect proves only that the
 * browser left Qi, and a page that said "paid" because of a URL parameter would be the
 * exact false positive the whole design avoids. No string it renders may state or hint at
 * an outcome (page.test.tsx checks both languages).
 *
 * What it does:
 *  - reads `ref`, keeps it only if it is a UUID (`parsePaymentRef`);
 *  - with a ref, on a phone or tablet, jumps to `touchpadel://pay/return?ref=…` by itself
 *    (`OpenAppOnLoad`, after paint, `location.replace`);
 *  - shows the heading, a big "Open the app" button on the same link (Chrome on Android
 *    refuses a scheme jump nobody tapped for), and "Don't have the app?" to the app band
 *    on the home page (`/{locale}#app`: the app is not on the stores yet, and the band
 *    carries the store badges the day it is). Not `/download`: that is the staff till
 *    installer.
 *
 * `force-dynamic` (the ref is per request, and the build must never prerender one), never
 * indexed, and no cookie is SET here: the mode cookie is only read, so a guest in light
 * mode sees light. Without the site sheet, on purpose (payReturn.css.ts); the frame is a
 * `.tp-site` subtree so the tokens bridge paints the canvas in the same mode.
 *
 * Not in sitemap.ts, which lists public pages by hand. Not disallowed in robots.ts either:
 * a crawler has to fetch the page to read its `noindex`.
 */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  return {
    // "Back to the app · Touch Padel" (the layout's title template).
    title: makeT(locale)('site.payReturn.metaTitle'),
    robots: { index: false, follow: false },
    // The address carries a payment reference; nothing on this page needs to pass it on.
    referrer: 'no-referrer',
  };
}

export default async function PayReturnPage({ params, searchParams }: Props) {
  const locale = requireLocale((await params).locale);
  const [query, mode, nonce] = await Promise.all([searchParams, getSiteMode(), getRequestNonce()]);
  const ref = parsePaymentRef(query.ref);
  const appHref = appReturnHref(ref);
  const tr = makeT(locale);
  const other = otherLocale(locale);

  return (
    <div className="tp-site tp-payret" data-theme="padel" data-mode={mode}>
      <style
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: `${siteTokensBridgeCss}\n${sitePayReturnCss}` }}
      />
      <header className="tp-payret__bar">
        <a className="tp-payret__home" href={`/${locale}`} aria-label={tr('site.brandHome')}>
          <BrandLockup />
        </a>
        {/* A plain link, not the site's LanguageLink: that one remembers the choice in a
            cookie, and this page sets none. Same accessible name, visible word first. */}
        <a className="tp-payret__lang" href={payReturnPath(other, ref)} hrefLang={other}>
          <span lang={other}>{tr('site.nav.language')}</span>
          <span className="tp-payret__sr"> ({tr('site.nav.languageLabel')})</span>
        </a>
      </header>
      <main className="tp-payret__main">
        <h1 className="tp-payret__title">{tr('site.payReturn.title')}</h1>
        <p className="tp-payret__body">{tr('site.payReturn.body')}</p>
        <a className="tp-payret__open" href={appHref}>
          {tr('site.payReturn.open')}
        </a>
        <a className="tp-payret__get" href={`/${locale}#app`}>
          {tr('site.payReturn.noApp')}
        </a>
      </main>
      <footer className="tp-payret__foot">
        <a href={`/${locale}/support`}>{tr('site.footer.support')}</a>
      </footer>
      {ref && <OpenAppOnLoad href={appHref} />}
    </div>
  );
}
