import type { Metadata } from 'next';
import { makeT } from '@touch/i18n';
import { asLocale, LOCALES } from '@/lib/locales';
import { getCachedCafeSettings, getCachedMenu, getCachedVenue } from '@/lib/menu.server';
import { CafeApp } from '@/components/cafe/CafeApp';

/**
 * Site root per locale = the cafe menu app WITHOUT a table (owner decision 7/9:
 * browse + basket work; "send" and "call waiter" ask for the table QR).
 * Static + ISR 60 s; must never read cookies/headers (that would force dynamic).
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
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  return { title: tr('seo.siteTitle'), description: tr('seo.menuDescription') };
}

export default async function CafeRootPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const [menuResult, settings, venue] = await Promise.all([
    getCachedMenu(),
    getCachedCafeSettings(),
    // Footer hours + phone and the hero strapline (web-slice §2).
    getCachedVenue(),
  ]);
  return (
    <CafeApp
      locale={locale}
      token={null}
      initialMenu={menuResult.categories}
      menuStatus={menuResult.status}
      settings={settings}
      venue={venue}
    />
  );
}
