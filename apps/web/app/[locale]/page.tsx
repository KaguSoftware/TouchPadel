import type { Metadata, Viewport } from 'next';
import { makeT } from '@touch/i18n';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedMenu, getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { crossesMidnight, everyDayWindow, formatWindow } from '@/lib/site/hours';
import { cafeCategoryList } from '@/lib/site/landing';
import { siteOrigin } from '@/lib/site/origin';
import { buildLandingJsonLd, jsonLdString } from '@/lib/site/jsonLd';
import { getStoreLinks } from '@/lib/site/stores';
import { SiteShell } from '@/components/site/SiteShell';
import { Hero } from '@/components/landing/Hero';
import { Club } from '@/components/landing/Club';
import { Lessons } from '@/components/landing/Lessons';
import { Events } from '@/components/landing/Events';
import { CafeHandoff } from '@/components/landing/CafeHandoff';
import { AppBand } from '@/components/landing/AppBand';
import { Faq } from '@/components/landing/Faq';
import { Visit } from '@/components/landing/Visit';
import { PhotoGrade } from '@/components/landing/PhotoGrade';

/**
 * The Touch Padel home page, `/{locale}` (docs/design/web-site/contracts-2026-09-23.md
 * §0, Revision B): THE CLUB, not the app. A padel club and café in Durrat Karbala: the
 * courts and what playing there is, lessons, events (coming), Touch Cafe, the app in one
 * short band, the first-visit questions, and where to find it. Booking today is WhatsApp,
 * a call or walking in, so every booking button is a WhatsApp chat pre-filled in the
 * page's language, built from the one venue phone. It is also what Google's OAuth
 * consent screen lists as the app's home page, so the privacy policy is one click away
 * in the footer.
 *
 * Dynamic like every page here (the layout's nonce read, C11); it also reads the mode
 * cookie, so night or light is painted by the server. Live data, all through the cached
 * `menu`-tagged readers: the hours, phone and cancellation window
 * (venue_settings_public) and the café category names (the menu). Each read degrades on
 * its own: no venue → no hours line, no open pill and no WhatsApp or call buttons ("Plan
 * your visit" instead); no menu → the category-free café line.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

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
  const title = tr('site.seo.title');
  const description = tr('site.seo.description');
  const og = `/brand/site/og-touch-padel-${locale}.png`;
  return {
    title: { absolute: title },
    description,
    applicationName: tr('common.appName'),
    alternates: {
      canonical: `/${locale}`,
      languages: { en: '/en', ar: '/ar', 'x-default': '/ar' },
    },
    icons: {
      icon: [
        { url: '/brand/site/favicon.svg', type: 'image/svg+xml' },
        { url: '/brand/site/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/brand/site/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: '/brand/site/apple-icon-180.png',
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/${locale}`,
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
    robots: { index: true, follow: true },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const [venue, menu, mode, nonce] = await Promise.all([
    getCachedVenue(),
    getCachedMenu(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  const everyDay = everyDayWindow(venue);
  const hours = everyDay ? formatWindow(everyDay) : null;
  const phone = venue?.phone ?? null;
  // 4 h is what 0056 configured; the fallback when the venue read fails, as on /terms.
  const cancelHours = venue?.cancellation_window_hours ?? 4;
  const jsonLd = buildLandingJsonLd({ locale, origin: siteOrigin(), venue });

  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path="">
      <PhotoGrade />
      <Hero
        locale={locale}
        hours={hours}
        openingHours={venue?.opening_hours ?? null}
        closedDates={venue?.closed_dates ?? []}
        phone={phone}
      />
      <Club locale={locale} hours={hours} phone={phone} />
      <Lessons locale={locale} phone={phone} />
      <Events locale={locale} phone={phone} />
      <CafeHandoff locale={locale} categories={cafeCategoryList(menu.categories, locale)} />
      <AppBand locale={locale} stores={getStoreLinks()} />
      <Faq
        locale={locale}
        hours={hours}
        late={everyDay ? crossesMidnight(everyDay) : false}
        cancelHours={cancelHours}
      />
      <Visit locale={locale} venue={venue} />
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
      />
    </SiteShell>
  );
}
