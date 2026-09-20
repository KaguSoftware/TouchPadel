import type { Metadata } from 'next';
import { makeT } from '@touch/i18n';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { LegalDocument, type LegalSection } from '@/components/legal/LegalDocument';

/**
 * Support page for the Touch Padel app — /{locale}/support.
 *
 * This is the App Store Connect "Support URL" (apps/mobile/src/lib/legal.ts links
 * here too). Public, indexable, fully server-rendered. Copy lives in
 * @touch/i18n `legal.support`.
 *
 * Contact = the venue phone and opening hours from venue_settings_public (no
 * email anywhere), so this is ISR like the cafe root (60 s, same `menu` tag);
 * it must never read cookies or headers.
 */
export const revalidate = 60;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
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
  const venue = await getCachedVenue();
  return (
    <LegalDocument
      locale={locale}
      page="support"
      title="legal.support.title"
      intro="legal.support.intro"
      sections={SECTIONS}
      venue={venue}
    />
  );
}
