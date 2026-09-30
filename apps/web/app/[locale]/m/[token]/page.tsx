import type { Metadata, Viewport } from 'next';
import { countPhrase, makeT, type Locale } from '@touch/i18n';
import { otherLocale, requireLocale } from '@/lib/locales';
import {
  appMatchHref,
  inviteOgImage,
  inviteWhen,
  matchInvitePath,
  parseMatchToken,
  type MatchInvite,
} from '@/lib/site/matchInvite';
import { readMatchInvite } from '@/lib/site/matchInvite.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { siteTokensBridgeCss } from '@/styles/site/tokens-bridge.css';
import { siteMatchInviteCss } from '@/styles/site/matchInvite.css';
import { BrandLockup } from '@/components/site/brand/BrandLockup';

/**
 * `/{locale}/m/<token>`: the open-match invite (docs/design/open-matches/guest.md §4.20,
 * OM-32). A player shares this link from the app. Where the app is installed and the
 * domain verified, the phone opens the app on it (`LINK_PATHS`, universal links) and this
 * page is never seen; everywhere else, a WhatsApp preview or a browser, it shows what the
 * match is and sends the visitor to the app to join. It never joins, and it never asks
 * anyone to sign in here.
 *
 * DF-9 and GD-4: no names, no price, no ids. It shows the day and time in the branch's
 * timezone, the branch, the category, the seats left and whether the organiser approves
 * each player, which is all `app.match_invite` answers (`parseMatchInvite` keeps nothing
 * else). A match nobody can join, an unknown token among them, is `closed`: the page
 * cannot tell a gone match from one that never existed, by design.
 *
 * Built like the payment return page (`pay/return/page.tsx`): the lockup bar, a plain
 * language link (no cookie is set here), the big "Open in the app" on
 * `touchpadel://m/<token>` (still useful on Android until the Play fingerprints are
 * published), and "Don't have the app?" to the home page's app band with the store badges.
 * No automatic jump to the app: unlike a payment return, the visitor may well not have the
 * app, and an unprompted scheme jump strands Safari on an error page.
 *
 * `force-dynamic` (the seats change with every join), never indexed, no referrer (the
 * address is the invite), and a static share image per locale. Not in sitemap.ts; not
 * disallowed in robots.ts either, since a crawler has to fetch the page to read its
 * `noindex`. A locale-less `/m/<token>` gets the proxy's 307 to `/{locale}/m/<token>`.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; token: string }>;

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const tr = makeT(locale);
  // "Open match invite · Touch Padel" (the layout's title template).
  const title = tr('matches.web.metaTitle');
  const description = tr('matches.web.metaDescription');
  const siteName = tr('seo.siteTitle');
  const image = inviteOgImage(locale);
  return {
    title,
    description,
    robots: { index: false, follow: false },
    // The address is the invite; nothing on this page needs to pass it on.
    referrer: 'no-referrer',
    // Replaced whole (the layout's would otherwise describe the landing page).
    openGraph: {
      title: `${title} · ${siteName}`,
      description,
      type: 'website',
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      siteName,
      images: [{ url: image, width: 1200, height: 630, alt: tr('site.seo.ogAlt') }],
    },
    twitter: { card: 'summary_large_image', title: `${title} · ${siteName}`, description, images: [image] },
  };
}

/** The heading and the match's lines for each state of the read. */
function InviteBody({ locale, invite }: { locale: Locale; invite: MatchInvite }) {
  const tr = makeT(locale);
  if (invite.status === 'closed') {
    return <h1 className="tp-minv__title">{tr('matches.web.closed')}</h1>;
  }
  const when =
    invite.status === 'error' ? null : inviteWhen(invite.card.startAt, invite.card.timezone, locale);
  if (invite.status === 'error' || !when) {
    return <h1 className="tp-minv__title">{tr('matches.web.error')}</h1>;
  }
  const { card } = invite;
  const approveKey = card.category === 'women' ? 'matches.web.approveF' : 'matches.web.approve';
  return (
    <>
      <h1 className="tp-minv__title">{tr('matches.web.when', when)}</h1>
      <ul className="tp-minv__facts">
        <li>{(locale === 'ar' && card.venue.name_ar) || card.venue.name_en}</li>
        <li>{tr(`matches.web.category.${card.category}`)}</li>
      </ul>
      <p className="tp-minv__status">
        {invite.status === 'open'
          ? countPhrase('matches.count.seatsLeft', card.seatsLeft, locale)
          : tr('matches.web.full')}
      </p>
      {invite.status === 'open' && card.approve && <p className="tp-minv__note">{tr(approveKey)}</p>}
    </>
  );
}

export default async function MatchInvitePage({ params }: { params: Params }) {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const token = parseMatchToken(segments.token);
  const [invite, mode, nonce] = await Promise.all([
    // A token that is no token is never sent: the server would answer `closed` anyway.
    token ? readMatchInvite(token) : Promise.resolve<MatchInvite>({ status: 'closed' }),
    getSiteMode(),
    getRequestNonce(),
  ]);
  const tr = makeT(locale);
  const other = otherLocale(locale);

  return (
    <div className="tp-site tp-minv" data-theme="padel" data-mode={mode}>
      <style
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: `${siteTokensBridgeCss}\n${siteMatchInviteCss}` }}
      />
      <header className="tp-minv__bar">
        <a className="tp-minv__home" href={`/${locale}`} aria-label={tr('site.brandHome')}>
          <BrandLockup />
        </a>
        {/* A plain link, not the site's LanguageLink: that one remembers the choice in a
            cookie, and this page sets none. Same accessible name, visible word first. */}
        <a className="tp-minv__lang" href={matchInvitePath(other, token)} hrefLang={other}>
          <span lang={other}>{tr('site.nav.language')}</span>
          <span className="tp-minv__sr"> ({tr('site.nav.languageLabel')})</span>
        </a>
      </header>
      <main className="tp-minv__main">
        <p className="tp-minv__eyebrow">{tr('matches.web.eyebrow')}</p>
        <InviteBody locale={locale} invite={invite} />
        <a className="tp-minv__open" href={appMatchHref(token)}>
          {tr('matches.web.open')}
        </a>
        <a className="tp-minv__get" href={`/${locale}#app`}>
          {tr('matches.web.noApp')}
        </a>
      </main>
      <footer className="tp-minv__foot">
        <a href={`/${locale}/support`}>{tr('site.footer.support')}</a>
      </footer>
    </div>
  );
}
