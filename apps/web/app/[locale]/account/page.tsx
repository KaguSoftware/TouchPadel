import type { Metadata, Viewport } from 'next';
import { makeT } from '@touch/i18n';
import { requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { safeReturnPath } from '@/lib/account/account';
import { SiteShell } from '@/components/site/SiteShell';
import { AccountApp } from '@/components/account/AccountApp';

/**
 * `/{locale}/account`: the member's own account on the web (loyalty build contracts §5, plan
 * §5.2). Sign in with the app's phone or email and password; then the rotating member QR the
 * till scans, the points, the tier, the history and the rewards.
 *
 * The session is the account client's own `sb-tp-account` cookie, read in the browser only:
 * the server renders the shell and the heading, and `AccountApp` is the client island, so the
 * page adds no `cookies()` read anywhere (C11), and a guest's café table session is never
 * touched. `?return=` (the café's "Sign in to earn points" chip) is checked to be a path on
 * this site before the island sees it.
 *
 * Never indexed (a personal page with nothing for a search engine), no referrer. Not in
 * sitemap.ts; not disallowed in robots.ts either, since a crawler has to fetch the page to
 * read its `noindex`.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const tr = makeT(locale);
  return {
    title: tr('loyalty.web.account.metaTitle'),
    description: tr('loyalty.web.account.metaDescription'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const locale = requireLocale((await params).locale);
  const tr = makeT(locale);
  const returnTo = safeReturnPath((await searchParams).return);
  const [venue, mode, nonce] = await Promise.all([
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path="/account">
      <div className="tp-acct">
        <header className="tp-acct__header">
          <p className="tp-acct__eyebrow">{tr('loyalty.web.account.eyebrow')}</p>
          <h1 className="tp-acct__title">{tr('loyalty.web.account.title')}</h1>
          <p className="tp-acct__intro">{tr('loyalty.web.account.intro')}</p>
        </header>
        <AccountApp locale={locale} returnTo={returnTo} />
      </div>
    </SiteShell>
  );
}
