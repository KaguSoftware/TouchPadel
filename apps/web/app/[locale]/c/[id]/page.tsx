import type { Metadata, Viewport } from 'next';
import { makeT, type Locale } from '@touch/i18n';
import { otherLocale, requireLocale } from '@/lib/locales';
import { getCachedCoaching } from '@/lib/coaching.server';
import {
  coachBio,
  coachById,
  coachName,
  coachTypes,
  lessonPrice,
  lessonTypeLine,
  localText,
  type CoachingRead,
  type PublicCoach,
  type PublicCoaching,
} from '@/lib/coaching';
import { APP_HOME_URL, appCoachHref, coachLinkPath, parseCoachId } from '@/lib/site/coachLink';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { siteOgImage } from '@/lib/site/ogImage';
import { siteTokensBridgeCss } from '@/styles/site/tokens-bridge.css';
import { siteCoachLinkCss } from '@/styles/site/coachLink.css';
import { BrandLockup } from '@/components/site/brand/BrandLockup';
import { CoachPhoto } from '@/components/coaching/CoachPhoto';

/**
 * `/{locale}/c/<coachId>`: the coach link (docs/design/coaching/guest.md §4.12, §4.14.3). The
 * website's "Book in the app" and the app's share sheet hand it out. Where the app is installed
 * and the domain verified, the phone opens the app on the coach (`LINK_PATHS`) and this page is
 * never seen; everywhere else (a WhatsApp preview, a browser, Safari tapping a same-domain link)
 * it shows the coach and sends the visitor to the app to book. It never books.
 *
 * Built like the open-match invite (`m/[token]/page.tsx`): the lockup bar, a plain language link
 * (no cookie is set here), one card, the big "Open in the app" on `touchpadel://c/<id>`, and
 * "Don't have the app?" to the home page's app band. No automatic jump to the app: an unprompted
 * scheme jump strands Safari on an error page when the app is absent.
 *
 * The read is the `/coaching` page's own cached `coaching_public` (60 s): only active coaches who
 * accepted the public profile are in it (C-22, R61). An id that is no uuid, an unknown, paused,
 * retired or not-yet-public coach, and coaching switched off all read the same ("isn't taking
 * bookings online right now"), so the page never says which. Prices only where the branch shows
 * them (C-11; the parser drops the rest).
 *
 * Never indexed (`/coaching` is the indexed page), no referrer (the address names the coach), the
 * site's share image. Not in sitemap.ts; not disallowed in robots.ts either, since a crawler has
 * to fetch the page to read its `noindex`. A locale-less `/c/<id>` gets the proxy's 307.
 */
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

type CoachView =
  | { state: 'found'; coaching: PublicCoaching; coach: PublicCoach }
  | { state: 'missing' }
  | { state: 'error' };

function viewOf(read: CoachingRead, id: string | null): CoachView {
  if (read.status === 'error') return { state: 'error' };
  const coach = id && read.coaching ? coachById(read.coaching, id) : null;
  return coach && read.coaching
    ? { state: 'found', coaching: read.coaching, coach }
    : { state: 'missing' };
}

/** The coach, read only for an id that is one (the server is never asked about anything else). */
async function readCoach(id: string | null): Promise<CoachView> {
  if (!id) return { state: 'missing' };
  return viewOf(await getCachedCoaching(null), id);
}

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const tr = makeT(locale);
  const view = await readCoach(parseCoachId(segments.id));
  // "Lessons with Ali · Touch Padel" (the layout's title template); "Book a lesson" otherwise.
  const title =
    view.state === 'found'
      ? tr('coaching.web.link.metaTitle', { name: coachName(view.coach, locale) })
      : tr('coaching.web.link.title');
  const description = tr('coaching.web.metaDescription');
  const siteName = tr('seo.siteTitle');
  const image = siteOgImage(locale);
  return {
    title,
    description,
    robots: { index: false, follow: true },
    // The address names the coach; nothing on this page needs to pass it on.
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
    twitter: {
      card: 'summary_large_image',
      title: `${title} · ${siteName}`,
      description,
      images: [image],
    },
  };
}

/** The coach: photo, name, where they teach, bio, and the lesson types they teach. */
function CoachCard({
  locale,
  coaching,
  coach,
}: {
  locale: Locale;
  coaching: PublicCoaching;
  coach: PublicCoach;
}) {
  const tr = makeT(locale);
  const name = coachName(coach, locale);
  const bio = coachBio(coach, locale);
  const branches = coaching.branches
    .filter((b) => coach.venue_ids.includes(b.venue_id))
    .map((b) => localText(locale, b.name_en, b.name_ar));
  const types = coachTypes(coaching, coach);
  return (
    <>
      <CoachPhoto coach={coach} locale={locale} className="tp-clink__photo" sizes="8rem" />
      <p className="tp-clink__eyebrow">{tr('coaching.web.link.eyebrow')}</p>
      <h1 className="tp-clink__title">{name}</h1>
      {branches.length > 0 ? (
        <p className="tp-clink__at">
          {tr('coaching.web.link.at', { branches: branches.join(' · ') })}
        </p>
      ) : null}
      {bio ? <p className="tp-clink__bio">{bio}</p> : null}
      {types.length > 0 ? (
        <section className="tp-clink__types" aria-labelledby="clink-types">
          <h2 id="clink-types" className="tp-clink__h2">
            {tr('coaching.web.link.typesTitle')}
          </h2>
          <ul>
            {types.map(({ type, price_iqd }) => {
              const price = lessonPrice(type.kind, price_iqd, locale);
              return (
                <li key={type.id} className="tp-clink__type">
                  <span className="tp-clink__type-name">
                    {localText(locale, type.name_en, type.name_ar)}
                  </span>
                  <span className="tp-clink__type-line tp-num">{lessonTypeLine(type, locale)}</span>
                  {price ? <span className="tp-clink__type-price tp-num">{price}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export default async function CoachLinkPage({ params }: { params: Params }) {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const id = parseCoachId(segments.id);
  const [view, mode, nonce] = await Promise.all([readCoach(id), getSiteMode(), getRequestNonce()]);
  const tr = makeT(locale);
  const other = otherLocale(locale);
  // Not found reads the same for every reason, and its app link opens the app's home.
  const appHref = view.state === 'missing' ? APP_HOME_URL : appCoachHref(id);

  return (
    <div className="tp-site tp-clink" data-theme="padel" data-mode={mode} data-state={view.state}>
      <style
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: `${siteTokensBridgeCss}\n${siteCoachLinkCss}` }}
      />
      <header className="tp-clink__bar">
        <a className="tp-clink__home" href={`/${locale}`} aria-label={tr('site.brandHome')}>
          <BrandLockup />
        </a>
        {/* A plain link, not the site's LanguageLink: that one remembers the choice in a
            cookie, and this page sets none. Same accessible name, visible word first. */}
        <a className="tp-clink__lang" href={coachLinkPath(other, id)} hrefLang={other}>
          <span lang={other}>{tr('site.nav.language')}</span>
          <span className="tp-clink__sr"> ({tr('site.nav.languageLabel')})</span>
        </a>
      </header>
      <main className="tp-clink__main">
        {view.state === 'found' ? (
          <CoachCard locale={locale} coaching={view.coaching} coach={view.coach} />
        ) : (
          <>
            <p className="tp-clink__eyebrow">{tr('coaching.web.link.title')}</p>
            <h1 className="tp-clink__title">
              {view.state === 'error'
                ? tr('coaching.web.link.error')
                : tr('coaching.web.link.notFound')}
            </h1>
          </>
        )}
        <a className="tp-clink__open" href={appHref}>
          {tr('coaching.web.link.open')}
        </a>
        <a className="tp-clink__get" href={`/${locale}#app`}>
          {tr('coaching.web.link.noApp')}
        </a>
        <a className="tp-clink__all" href={`/${locale}/coaching`}>
          {tr('coaching.web.link.allCoaches')}
        </a>
      </main>
      <footer className="tp-clink__foot">
        <a href={`/${locale}/support`}>{tr('site.footer.support')}</a>
      </footer>
    </div>
  );
}
