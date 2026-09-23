import type { Metadata } from 'next';
import { makeT } from '@touch/i18n';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { LegalDocument, type LegalSection } from '@/components/legal/LegalDocument';

/**
 * Privacy policy for the Touch Padel app and this website — /{locale}/privacy.
 *
 * This is the App Store Connect "Privacy Policy URL" (apps/mobile/src/lib/legal.ts
 * links here too). Apple fetches it, so it is public, indexable and fully
 * server-rendered. The copy lives in @touch/i18n `legal.privacy` and must be
 * kept true to what the system does: the processor list follows the edge
 * functions and third-party calls, the retention section follows 0077
 * (account deletion) and the pg_cron purges, and the consent record follows
 * 0153. Bump CURRENT_TERMS_VERSION when a change needs a guest to agree again.
 *
 * The contact block reads the venue phone from venue_settings_public, so this
 * is ISR like the cafe root (60 s, same `menu` tag); it must never read
 * cookies or headers.
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
  const title = `${tr('legal.privacy.title')} · ${tr('common.appName')}`;
  const description = tr('legal.privacy.metaDescription');
  return {
    title: { absolute: title },
    description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: { en: '/en/privacy', ar: '/ar/privacy', 'x-default': '/ar/privacy' },
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
  { id: 'who', title: 'legal.privacy.who.title', blocks: [{ kind: 'p', key: 'legal.privacy.who.body' }] },
  {
    id: 'collect',
    title: 'legal.privacy.collect.title',
    blocks: [
      {
        kind: 'list',
        items: [
          { lead: 'legal.privacy.collect.accountLead', text: 'legal.privacy.collect.account' },
          { lead: 'legal.privacy.collect.codesLead', text: 'legal.privacy.collect.codes' },
          { lead: 'legal.privacy.collect.bookingsLead', text: 'legal.privacy.collect.bookings' },
          { lead: 'legal.privacy.collect.cafeLead', text: 'legal.privacy.collect.cafe' },
          { lead: 'legal.privacy.collect.pushLead', text: 'legal.privacy.collect.push' },
          { lead: 'legal.privacy.collect.providersLead', text: 'legal.privacy.collect.providers' },
          { lead: 'legal.privacy.collect.notesLead', text: 'legal.privacy.collect.notes' },
          { lead: 'legal.privacy.collect.consentLead', text: 'legal.privacy.collect.consent' },
          { lead: 'legal.privacy.collect.technicalLead', text: 'legal.privacy.collect.technical' },
        ],
      },
      { kind: 'p', key: 'legal.privacy.collect.notCollected' },
      { kind: 'p', key: 'legal.privacy.collect.website' },
    ],
  },
  {
    id: 'use',
    title: 'legal.privacy.use.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.use.lead' },
      {
        kind: 'list',
        items: [
          'legal.privacy.use.account',
          'legal.privacy.use.bookings',
          'legal.privacy.use.notify',
          'legal.privacy.use.rules',
          'legal.privacy.use.security',
          'legal.privacy.use.legal',
        ],
      },
      { kind: 'p', key: 'legal.privacy.use.never' },
    ],
  },
  {
    id: 'share',
    title: 'legal.privacy.share.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.share.staff' },
      { kind: 'p', key: 'legal.privacy.share.processorsLead' },
      {
        kind: 'list',
        items: [
          'legal.privacy.share.supabase',
          'legal.privacy.share.push',
          'legal.privacy.share.signIn',
          'legal.privacy.share.whatsapp',
          'legal.privacy.share.telegram',
          'legal.privacy.share.ai',
          'legal.privacy.share.vercel',
          'legal.privacy.share.posthog',
          'legal.privacy.share.kagu',
        ],
      },
      { kind: 'p', key: 'legal.privacy.share.authorities' },
      { kind: 'p', key: 'legal.privacy.share.noSale' },
    ],
  },
  { id: 'transfers', title: 'legal.privacy.transfers.title', blocks: [{ kind: 'p', key: 'legal.privacy.transfers.body' }] },
  {
    id: 'retention',
    title: 'legal.privacy.retention.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.retention.active' },
      { kind: 'p', key: 'legal.privacy.retention.deleted' },
      { kind: 'p', key: 'legal.privacy.retention.bookings' },
      { kind: 'p', key: 'legal.privacy.retention.cafe' },
      { kind: 'p', key: 'legal.privacy.retention.logs' },
      { kind: 'p', key: 'legal.privacy.retention.apple' },
    ],
  },
  {
    id: 'choices',
    title: 'legal.privacy.rights.title',
    blocks: [
      { kind: 'p', key: 'legal.privacy.rights.lead' },
      {
        kind: 'list',
        items: [
          'legal.privacy.rights.access',
          'legal.privacy.rights.edit',
          'legal.privacy.rights.delete',
          'legal.privacy.rights.object',
          'legal.privacy.rights.notifications',
          'legal.privacy.rights.language',
        ],
      },
      { kind: 'p', key: 'legal.privacy.rights.how' },
      { kind: 'link', to: 'delete-account', label: 'legal.privacy.rights.deleteLink' },
    ],
  },
  { id: 'cookies', title: 'legal.privacy.cookies.title', blocks: [{ kind: 'p', key: 'legal.privacy.cookies.body' }] },
  { id: 'security', title: 'legal.privacy.security.title', blocks: [{ kind: 'p', key: 'legal.privacy.security.body' }] },
  { id: 'children', title: 'legal.privacy.children.title', blocks: [{ kind: 'p', key: 'legal.privacy.children.body' }] },
  { id: 'changes', title: 'legal.privacy.changes.title', blocks: [{ kind: 'p', key: 'legal.privacy.changes.body' }] },
  {
    id: 'contact',
    title: 'legal.privacy.contactSection.title',
    blocks: [{ kind: 'p', key: 'legal.privacy.contactSection.body' }, { kind: 'entity' }, { kind: 'phone' }],
  },
];

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const venue = await getCachedVenue();
  return (
    <LegalDocument
      locale={locale}
      page="privacy"
      title="legal.privacy.title"
      intro="legal.privacy.intro"
      sections={SECTIONS}
      venue={venue}
      version={CURRENT_TERMS_VERSION}
    />
  );
}
