import type { Metadata, Viewport } from 'next';
import { makeT, type Locale } from '@touch/i18n';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { getCachedCoaching } from '@/lib/coaching.server';
import { coachingBranches, localText, type PublicCoaching } from '@/lib/coaching';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { siteOgImage } from '@/lib/site/ogImage';
import { getStoreLinks, type StoreLinks } from '@/lib/site/stores';
import { SiteShell } from '@/components/site/SiteShell';
import { WhatsAppButton } from '@/components/site/ContactButton';
import { StoreButtons } from '@/components/site/StoreButtons';
import { CoachingBranch } from '@/components/coaching/CoachingBranch';

/**
 * Coaching at Touch, `/{locale}/coaching` (docs/design/coaching/guest.md §4.14.2, C-11): the
 * coaches, the lesson types they teach, and the upcoming group sessions and courses with places
 * left, per branch when more than one branch has coaching on. Prices only where the branch's
 * `lesson_prices_public` switch is on (the parser drops the rest). Every "Book in the app" goes
 * to the coach's `/{locale}/c/<id>` link, which the app claims where it is installed.
 *
 * `empty` and `off` show the head and the landing's lessons ask (WhatsApp), so the footer link
 * never leads to a blank page; `error` adds a line above the same ask. While the app has no store
 * listing, the WhatsApp ask stays on the `ok` page too.
 *
 * Public and indexed (the coach link pages are not). Dynamic like every page under [locale] (the
 * layout's nonce, C11); the read is the 60 s `coaching`-tagged cache (coaching.server.ts).
 */
export const revalidate = 60;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/** The browser chrome follows the site mode (the same cookie the shell paints from). */
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: SITE_THEME_COLOR[await getSiteMode()] };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const tr = makeT(locale);
  const title = `${tr('coaching.web.metaTitle')} · ${tr('common.appName')}`;
  const description = tr('coaching.web.metaDescription');
  const og = siteOgImage(locale);
  return {
    title: { absolute: title },
    description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: `/${locale}/coaching`,
      languages: { en: '/en/coaching', ar: '/ar/coaching', 'x-default': '/ar/coaching' },
    },
    // Replaced whole (the layout's would otherwise describe the landing page).
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/${locale}/coaching`,
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      alternateLocale: locale === 'ar' ? 'en_US' : 'ar_IQ',
      siteName: tr('common.appName'),
      images: [{ url: og, width: 1200, height: 630, alt: tr('site.seo.ogAlt') }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: og, alt: tr('site.seo.ogAlt') }],
    },
  };
}

/** The landing's lessons ask: "We run lessons at Touch. Message us on WhatsApp…". */
function Ask({ locale, phone }: { locale: Locale; phone: string | null }) {
  const tr = makeT(locale);
  return (
    <div className="tp-coaching__ask">
      <p className="tp-coaching__ask-body">{tr('site.lessons.body')}</p>
      <WhatsAppButton
        locale={locale}
        phone={phone}
        message={tr('site.whatsapp.lesson')}
        label={tr('site.lessons.cta')}
        cue={tr('site.onWhatsApp')}
        onHome={false}
        className="tp-site-btn tp-site-btn--go tp-site-btn--lg"
      />
    </div>
  );
}

/** Every branch with a public coach, under its name when there are several. */
function Branches({ locale, coaching }: { locale: Locale; coaching: PublicCoaching }) {
  const branches = coachingBranches(coaching);
  if (branches.length === 1) {
    return (
      <CoachingBranch
        coaching={coaching}
        branch={branches[0]!}
        locale={locale}
        level={2}
        index={0}
      />
    );
  }
  return (
    <>
      {branches.map((branch, index) => (
        <section
          key={branch.venue_id}
          className="tp-coaching__branch"
          aria-labelledby={`coaching-branch-${index}`}
          data-branch={branch.venue_id}
        >
          <h2 id={`coaching-branch-${index}`} className="tp-coaching__branch-name">
            {localText(locale, branch.name_en, branch.name_ar)}
          </h2>
          <CoachingBranch
            coaching={coaching}
            branch={branch}
            locale={locale}
            level={3}
            index={index}
          />
        </section>
      ))}
    </>
  );
}

/** "Lessons are booked in the Touch Padel app", the way to it and the store badges. */
function AppBlock({
  locale,
  stores,
  phone,
}: {
  locale: Locale;
  stores: StoreLinks;
  phone: string | null;
}) {
  const tr = makeT(locale);
  const listed = Boolean(stores.appStore || stores.googlePlay);
  return (
    <div className="tp-coaching__app">
      <p className="tp-coaching__app-body">{tr('coaching.web.appBody')}</p>
      <div className="tp-coaching__ctas">
        <a className="tp-site-btn tp-site-btn--ghost tp-site-btn--lg" href={`/${locale}#app`}>
          {tr('coaching.web.getApp')}
        </a>
        {/* Until the app is in a store, a guest without it still has a way to book. */}
        {listed ? null : (
          <WhatsAppButton
            locale={locale}
            phone={phone}
            message={tr('site.whatsapp.lesson')}
            label={tr('site.lessons.cta')}
            cue={tr('site.onWhatsApp')}
            onHome={false}
            className="tp-site-btn tp-site-btn--go tp-site-btn--lg"
          />
        )}
      </div>
      <StoreButtons locale={locale} links={stores} />
    </div>
  );
}

export default async function CoachingPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const [read, venue, mode, nonce] = await Promise.all([
    getCachedCoaching(null),
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  const tr = makeT(locale);
  const phone = venue?.phone ?? null;
  // `ok` with no branch to put a coach under reads as `empty`: never a page of headings alone.
  const coaching =
    read.status === 'ok' && read.coaching && coachingBranches(read.coaching).length > 0
      ? read.coaching
      : null;

  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path="/coaching">
      <div className="tp-coaching" data-status={read.status}>
        <header className="tp-coaching__head">
          <div className="tp-coaching__title tp-fit">
            <h1 className="tp-display">
              <span className="tp-display__l1">{tr('coaching.web.titleOne')}</span>{' '}
              <span className="tp-display__l2">{tr('coaching.web.titleTwo')}</span>
            </h1>
          </div>
          <p className="tp-coaching__intro">{tr('coaching.web.intro')}</p>
        </header>
        {coaching ? (
          <>
            <Branches locale={locale} coaching={coaching} />
            <AppBlock locale={locale} stores={getStoreLinks()} phone={phone} />
          </>
        ) : (
          <>
            {read.status === 'error' ? (
              <p className="tp-coaching__error" role="status">
                {tr('coaching.web.error')}
              </p>
            ) : null}
            <Ask locale={locale} phone={phone} />
          </>
        )}
      </div>
    </SiteShell>
  );
}
