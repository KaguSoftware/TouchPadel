import type { Metadata, Viewport } from 'next';
import { makeT } from '@touch/i18n';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { SiteShell } from '@/components/site/SiteShell';
import { LegalDocument, type LegalSection } from '@/components/legal/LegalDocument';

/**
 * Terms of Service — /{locale}/terms.
 *
 * The agreement the app's consent checkbox points at (sign-up and the
 * accept-terms gate record CURRENT_TERMS_VERSION through app.accept_terms,
 * migration 0153). The booking rules here must agree with the app: the
 * free-cancellation window is venue_settings.cancellation_window_hours, read
 * live ({cancelHours}) — the value app.cancel_reservation enforces — and the
 * support page links to #bookings for the full rules. Bump
 * CURRENT_TERMS_VERSION when a change needs a guest to agree again.
 *
 * Rendered inside the site's SiteShell (header, footer, night or light) since 2026-09-23.
 * Like every page under [locale] it is dynamic (the layout reads the nonce, C11), and it
 * reads the `tp-site-mode` cookie so the server paints the visitor's mode with no flash.
 * The venue read is still the 60 s `menu`-tagged cache; `revalidate` is kept for the day
 * C11 is fixed, when this page will have to choose between ISR and the server-painted mode.
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
  const title = `${tr('legal.terms.title')} · ${tr('common.appName')}`;
  const description = tr('legal.terms.metaDescription');
  return {
    title: { absolute: title },
    description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: `/${locale}/terms`,
      languages: { en: '/en/terms', ar: '/ar/terms', 'x-default': '/ar/terms' },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      siteName: tr('common.appName'),
    },
  };
}

const SECTIONS: LegalSection[] = [
  { id: 'who', title: 'legal.terms.who.title', blocks: [{ kind: 'p', key: 'legal.terms.who.body' }] },
  {
    id: 'accounts',
    title: 'legal.terms.accounts.title',
    blocks: [
      {
        kind: 'list',
        items: [
          'legal.terms.accounts.age',
          'legal.terms.accounts.accurate',
          'legal.terms.accounts.secure',
          'legal.terms.accounts.desk',
        ],
      },
    ],
  },
  {
    id: 'bookings',
    title: 'legal.terms.bookings.title',
    blocks: [
      {
        kind: 'list',
        items: [
          'legal.terms.bookings.confirm',
          'legal.terms.bookings.price',
          'legal.terms.bookings.cancel',
          'legal.terms.bookings.noShow',
          'legal.terms.bookings.time',
          'legal.terms.bookings.venueCancel',
        ],
      },
    ],
  },
  {
    id: 'cafe',
    title: 'legal.terms.cafe.title',
    blocks: [{ kind: 'list', items: ['legal.terms.cafe.order', 'legal.terms.cafe.allergens', 'legal.terms.cafe.pay'] }],
  },
  {
    id: 'venue',
    title: 'legal.terms.venue.title',
    blocks: [
      { kind: 'p', key: 'legal.terms.venue.risk' },
      {
        kind: 'list',
        items: [
          'legal.terms.venue.rules',
          'legal.terms.venue.minors',
          'legal.terms.venue.damage',
          'legal.terms.venue.belongings',
          'legal.terms.venue.conduct',
        ],
      },
    ],
  },
  {
    id: 'app',
    title: 'legal.terms.app.title',
    blocks: [{ kind: 'list', items: ['legal.terms.app.use', 'legal.terms.app.availability', 'legal.terms.app.ip'] }],
  },
  { id: 'messages', title: 'legal.terms.messages.title', blocks: [{ kind: 'p', key: 'legal.terms.messages.body' }] },
  {
    id: 'liability',
    title: 'legal.terms.liability.title',
    blocks: [
      { kind: 'p', key: 'legal.terms.liability.care' },
      { kind: 'p', key: 'legal.terms.liability.limit' },
      { kind: 'p', key: 'legal.terms.liability.notExcluded' },
    ],
  },
  { id: 'ending', title: 'legal.terms.ending.title', blocks: [{ kind: 'p', key: 'legal.terms.ending.body' }] },
  { id: 'changes', title: 'legal.terms.changes.title', blocks: [{ kind: 'p', key: 'legal.terms.changes.body' }] },
  {
    id: 'law',
    title: 'legal.terms.law.title',
    blocks: [
      { kind: 'p', key: 'legal.terms.law.body' },
      { kind: 'p', key: 'legal.terms.law.language' },
    ],
  },
  {
    id: 'contact',
    title: 'legal.terms.contactSection.title',
    blocks: [{ kind: 'p', key: 'legal.terms.contactSection.body' }, { kind: 'entity' }, { kind: 'phone' }],
  },
];

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const [venue, mode, nonce] = await Promise.all([
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path="/terms">
      <LegalDocument
        locale={locale}
        page="terms"
        title="legal.terms.title"
        intro="legal.terms.intro"
        sections={SECTIONS}
        venue={venue}
        version={CURRENT_TERMS_VERSION}
      />
    </SiteShell>
  );
}
