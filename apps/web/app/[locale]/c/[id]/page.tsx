import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { requireLocale } from '@/lib/locales';
import { COACH_LEVELS_BY_TYPE } from '@touch/core/coaching';
import { getCachedCoaching } from '@/lib/coaching.server';
import {
  coachBio,
  coachByRef,
  coachName,
  coachTypes,
  LESSON_KINDS,
  lessonPrice,
  lessonTypeLine,
  localText,
  type CoachingRead,
  type PublicCoach,
  type PublicCoaching,
} from '@/lib/coaching';
import { APP_HOME_URL, appCoachHref, parseCoachRef } from '@/lib/site/coachLink';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { siteOgImage } from '@/lib/site/ogImage';
import { siteCoachLinkCss } from '@/styles/site/coachLink.css';
import { SiteShell } from '@/components/site/SiteShell';
import { BioFold } from '@/components/coaching/BioFold';
import { CoachPhoto } from '@/components/coaching/CoachPhoto';
import { APP_TILE_CROP, nameLines, priceParts } from '@/components/coaching/CoachingBranch';
import { CourtPattern } from '@/components/site/brand/CourtPattern';

/**
 * `/{locale}/c/<slug>` (0337: `/c/omar-karim`) or `/{locale}/c/<coachId>`: the coach link (docs/design/coaching/guest.md §4.12, §4.14.3). The
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
 * accepted the public profile are in it (C-22, R61). A segment that is neither an id nor a slug, an unknown, paused,
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

function viewOf(read: CoachingRead, ref: string | null): CoachView {
  if (read.status === 'error') return { state: 'error' };
  const coach = ref && read.coaching ? coachByRef(read.coaching, ref) : null;
  return coach && read.coaching
    ? { state: 'found', coaching: read.coaching, coach }
    : { state: 'missing' };
}

/**
 * The coach, read only for a segment that is an id or a slug (the server is never asked about
 * anything else).
 */
async function readCoach(ref: string | null): Promise<CoachView> {
  if (!ref) return { state: 'missing' };
  return viewOf(await getCachedCoaching(null), ref);
}

export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const tr = makeT(locale);
  const view = await readCoach(parseCoachRef(segments.id));
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

/**
 * The coach: the photo tile (or the initial on the court lines), the name card with where they
 * teach and the bio, and the lessons they teach as cards. The sheet puts the tile and the card
 * in one column and the lessons beside them from 48rem; on a phone the tile runs edge to edge
 * and the card rides up over it.
 */
function CoachCard({
  locale,
  coaching,
  coach,
  dock,
}: {
  locale: Locale;
  coaching: PublicCoaching;
  coach: PublicCoach;
  /** The open button and the quiet links, the foot of the name card (pinned on a phone). */
  dock: ReactNode;
}) {
  const tr = makeT(locale);
  const name = coachName(coach, locale);
  const bio = coachBio(coach, locale);
  const branches = coaching.branches
    .filter((b) => coach.venue_ids.includes(b.venue_id))
    .map((b) => localText(locale, b.name_en, b.name_ar));
  const types = coachTypes(coaching, coach);
  // The lessons by kind. Two neighbouring kinds with a single lesson each sit side by side on
  // a wide screen; any other kind takes the row (one lesson stretches, several wrap).
  const groups = LESSON_KINDS.map((kind) => ({
    kind,
    items: types.filter(({ type }) => type.kind === kind),
  })).filter((g) => g.items.length > 0);
  const blocks: (typeof groups)[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i]!;
    const next = groups[i + 1];
    if (g.items.length === 1 && next && next.items.length === 1) {
      blocks.push([g, next]);
      i += 1;
    } else {
      blocks.push([g]);
    }
  }
  const card = ({ type, price_iqd }: (typeof types)[number]) => {
    const price = lessonPrice(type.kind, price_iqd, locale);
    const description = localText(locale, type.description_en, type.description_ar).trim();
    const [first, rest] = nameLines(localText(locale, type.name_en, type.name_ar));
    return (
      <li key={type.id} className="tp-clink__type">
        <div className="tp-clink__band">
          <span className="tp-clink__kind" aria-hidden="true">
            {tr(`coaching.web.kind.${type.kind}`)}
          </span>
          <span className="tp-clink__type-name">
            {first}
            {rest ? (
              <>
                <br />
                {rest}
              </>
            ) : null}
          </span>
        </div>
        <div className="tp-clink__type-body">
          <span className="tp-clink__type-line tp-num">{lessonTypeLine(type, locale)}</span>
          {description ? <span className="tp-clink__type-desc">{description}</span> : null}
          {price ? <span className="tp-clink__type-price tp-num">{priceParts(price)}</span> : null}
        </div>
      </li>
    );
  };
  return (
    <>
      <div className="tp-clink__profile">
        <CoachPhoto
          coach={coach}
          locale={locale}
          className="tp-clink__photo"
          sizes="(min-width: 48rem) 22rem, 100vw"
          backdrop={<CourtPattern band={1.1} crop={APP_TILE_CROP} className="tp-clink__pattern" />}
        />
        <div className="tp-clink__sheet">
          <div className="tp-clink__card">
            <h1 className="tp-clink__title">{name}</h1>
            {branches.length > 0 ? (
              <p className="tp-clink__at">
                {tr('coaching.web.link.at', { branches: branches.join(' · ') })}
              </p>
            ) : null}
            {/* The app's level meter: the levels the coach teaches (none listed is every level),
              and "Taking bookings" while a private lesson can be booked. */}
            <div className="tp-clink__levels">
              <p className="tp-clink__levels-head">
                <span className="tp-clink__levels-title">{tr('coachShowcase.levelsTitle')}</span>
                {types.some(({ type }) => type.kind === 'private') ? (
                  <span className="tp-clink__taking">{tr('coaching.guest.coach.taking')}</span>
                ) : null}
              </p>
              <ul className="tp-clink__level-list">
                {COACH_LEVELS_BY_TYPE.map((level) => (
                  <li
                    key={level}
                    className="tp-clink__level"
                    data-on={
                      coach.levels.length === 0 || coach.levels.includes(level) ? 'true' : 'false'
                    }
                  >
                    {tr(`coachShowcase.levels.${level}`)}
                  </li>
                ))}
              </ul>
            </div>
            {bio ? (
              <BioFold label={tr('coaching.guest.coach.bio')}>
                <p className="tp-clink__bio">{bio}</p>
              </BioFold>
            ) : null}
          </div>
          {dock}
        </div>
      </div>
      {types.length > 0 ? (
        <section className="tp-clink__types" aria-labelledby="clink-types">
          <h2 id="clink-types" className="tp-clink__h2">
            {tr('coaching.web.link.typesTitle')}
          </h2>
          {blocks.map((block) =>
            block.length === 2 ? (
              <div key={block[0]!.kind} className="tp-clink__pair">
                {block.map((g, i) => (
                  <h3 key={g.kind} className="tp-clink__kind-label" data-slot={i === 0 ? 'a' : 'b'}>
                    {tr(`coaching.web.kind.${g.kind}`)}
                  </h3>
                ))}
                {block.map((g, i) => (
                  <ul
                    key={g.kind}
                    className="tp-clink__cards"
                    data-kind={g.kind}
                    data-count={1}
                    data-slot={i === 0 ? 'a' : 'b'}
                  >
                    {g.items.map(card)}
                  </ul>
                ))}
              </div>
            ) : (
              <div key={block[0]!.kind} className="tp-clink__group">
                <h3 className="tp-clink__kind-label" data-slot="flow">
                  {tr(`coaching.web.kind.${block[0]!.kind}`)}
                </h3>
                <ul
                  className="tp-clink__cards"
                  data-kind={block[0]!.kind}
                  data-count={block[0]!.items.length}
                  data-slot="flow"
                >
                  {block[0]!.items.map(card)}
                </ul>
              </div>
            ),
          )}
        </section>
      ) : null}
    </>
  );
}

export default async function CoachLinkPage({ params }: { params: Params }) {
  const segments = await params;
  const locale = requireLocale(segments.locale);
  const ref = parseCoachRef(segments.id);
  const [view, venue, mode, nonce] = await Promise.all([
    readCoach(ref),
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  const tr = makeT(locale);
  // Not found reads the same for every reason, and its app link opens the app's home.
  // The app opens on the id, which every app build reads.
  const appHref =
    view.state === 'found'
      ? appCoachHref(view.coach.id)
      : view.state === 'missing'
        ? APP_HOME_URL
        : appCoachHref(ref);

  // On a phone the dock is pinned to the foot of the screen; from 48rem it is the foot of the
  // coach's name card.
  const dock = (
    <div className="tp-clink__dock">
      <a className="tp-clink__open" href={appHref}>
        {tr('coaching.web.link.open')}
      </a>
      <div className="tp-clink__ways">
        <a className="tp-clink__get" href={`/${locale}#app`}>
          {tr('coaching.web.link.noApp')}
        </a>
      </div>
    </div>
  );

  return (
    <SiteShell
      locale={locale}
      mode={mode}
      nonce={nonce}
      venue={venue}
      // A segment that names no coach switches language to the coaches page, as before.
      path={ref ? `/c/${ref}` : '/coaching'}
    >
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: siteCoachLinkCss }} />
      <div className="tp-clink" data-theme="padel" data-mode={mode} data-state={view.state}>
        <div className="tp-clink__main">
          {view.state === 'found' ? (
            <CoachCard locale={locale} coaching={view.coaching} coach={view.coach} dock={dock} />
          ) : (
            <>
              <p className="tp-clink__eyebrow">{tr('coaching.web.link.title')}</p>
              <h1 className="tp-clink__title">
                {view.state === 'error'
                  ? tr('coaching.web.link.error')
                  : tr('coaching.web.link.notFound')}
              </h1>
              {dock}
            </>
          )}
        </div>
      </div>
    </SiteShell>
  );
}
