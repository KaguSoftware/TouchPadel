import type { Metadata, Viewport } from 'next';
import { makeT } from '@touch/i18n';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { SiteShell } from '@/components/site/SiteShell';
import { LegalDocument, type LegalSection } from '@/components/legal/LegalDocument';

/**
 * Support page for the Touch Padel app — /{locale}/support.
 *
 * This is the App Store Connect "Support URL" (apps/mobile/src/lib/legal.ts links
 * here too). Public, indexable, fully server-rendered. Copy lives in
 * @touch/i18n `legal.support`.
 *
 * Contact = the venue phone and opening hours from venue_settings_public (no
 * email anywhere).
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
  const title = `${tr('legal.support.title')} · ${tr('common.appName')}`;
  const description = tr('legal.support.metaDescription');
  return {
    title: { absolute: title },
    description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: `/${locale}/support`,
      languages: { en: '/en/support', ar: '/ar/support', 'x-default': '/ar/support' },
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
  { id: 'about', title: 'legal.support.about.title', blocks: [{ kind: 'p', key: 'legal.support.about.body' }] },
  {
    id: 'booking',
    title: 'legal.support.booking.title',
    blocks: [
      {
        kind: 'list',
        items: [
          'legal.support.booking.choose',
          'legal.support.booking.find',
          'legal.support.booking.pay',
          'legal.support.booking.notify',
        ],
      },
    ],
  },
  {
    id: 'cancel',
    title: 'legal.support.cancel.title',
    blocks: [
      {
        kind: 'list',
        items: ['legal.support.cancel.free', 'legal.support.cancel.late', 'legal.support.cancel.noShow'],
      },
      { kind: 'link', to: 'terms', hash: 'bookings', label: 'legal.support.cancel.more' },
    ],
  },
  {
    id: 'account',
    title: 'legal.support.account.title',
    blocks: [
      {
        kind: 'list',
        items: [
          { lead: 'legal.support.account.forgotLead', text: 'legal.support.account.forgot' },
          { lead: 'legal.support.account.noCodeLead', text: 'legal.support.account.noCode' },
          { lead: 'legal.support.account.phoneLead', text: 'legal.support.account.phone' },
          { lead: 'legal.support.account.socialLead', text: 'legal.support.account.social' },
        ],
      },
    ],
  },
  {
    id: 'delete',
    title: 'legal.support.delete.title',
    blocks: [
      { kind: 'p', key: 'legal.support.delete.how' },
      { kind: 'p', key: 'legal.support.delete.what' },
      { kind: 'p', key: 'legal.support.delete.desk' },
      { kind: 'link', to: 'delete-account', label: 'legal.support.delete.web' },
      { kind: 'link', to: 'privacy', hash: 'retention', label: 'legal.support.delete.more' },
    ],
  },
  {
    id: 'contact',
    title: 'legal.support.contactSection.title',
    blocks: [{ kind: 'p', key: 'legal.support.contactSection.body' }, { kind: 'phone' }, { kind: 'hours' }],
  },
];

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const [venue, mode, nonce] = await Promise.all([
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path="/support">
      <LegalDocument
        locale={locale}
        page="support"
        title="legal.support.title"
        intro="legal.support.intro"
        sections={SECTIONS}
        venue={venue}
      />
    </SiteShell>
  );
}
