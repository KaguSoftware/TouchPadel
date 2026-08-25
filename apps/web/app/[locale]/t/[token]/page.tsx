import type { Metadata } from 'next';
import { makeT } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { getCachedCafeSettings, getCachedMenu, getCachedVenue } from '@/lib/menu.server';
import { CafeApp } from '@/components/cafe/CafeApp';

// Cafe table-bound ordering (Touch Cafe identity). The token in the URL is a
// signed opaque blob (0014) — the client boot signs in anonymously and calls
// app.open_table_session in the background; the menu itself is server-rendered
// from the shared cached read model first, so nothing is blank meanwhile.
// Table URLs are never indexed.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  return {
    title: tr('seo.tableTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function TableSessionPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale: rawLocale, token } = await params;
  const [menuResult, settings, venue] = await Promise.all([
    getCachedMenu(),
    getCachedCafeSettings(),
    // Footer hours + phone and the hero strapline (web-slice §2).
    getCachedVenue(),
  ]);
  return (
    <CafeApp
      locale={asLocale(rawLocale)}
      token={token}
      initialMenu={menuResult.categories}
      menuStatus={menuResult.status}
      settings={settings}
      venue={venue}
    />
  );
}
