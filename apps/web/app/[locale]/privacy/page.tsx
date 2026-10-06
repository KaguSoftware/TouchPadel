import type { Metadata, Viewport } from 'next';
import { makeT } from '@touch/i18n';
import { CURRENT_TERMS_VERSION } from '@touch/core';
import { LOCALES, requireLocale } from '@/lib/locales';
import { getCachedVenue } from '@/lib/menu.server';
import { getRequestNonce, getSiteMode } from '@/lib/site/mode.server';
import { SITE_THEME_COLOR } from '@/lib/site/themeColor';
import { SiteShell } from '@/components/site/SiteShell';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { PRIVACY_SECTIONS } from '@touch/i18n';

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
 * The contact block reads the venue phone from venue_settings_public.
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

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = requireLocale((await params).locale);
  const [venue, mode, nonce] = await Promise.all([
    getCachedVenue(),
    getSiteMode(),
    getRequestNonce(),
  ]);
  return (
    <SiteShell locale={locale} mode={mode} nonce={nonce} venue={venue} path="/privacy">
      <LegalDocument
        locale={locale}
        page="privacy"
        title="legal.privacy.title"
        intro="legal.privacy.intro"
        sections={PRIVACY_SECTIONS}
        venue={venue}
        version={CURRENT_TERMS_VERSION}
      />
    </SiteShell>
  );
}
