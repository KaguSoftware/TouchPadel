import type { Metadata } from 'next';
import { makeT } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { CafeApp } from '@/components/cafe/CafeApp';

// Cafe table-bound ordering (Touch Cafe identity). The token in the URL is a
// signed opaque blob (0014) — the client boot signs in anonymously and calls
// app.open_table_session; everything else is client-driven from there.
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
  return <CafeApp locale={asLocale(rawLocale)} token={token} />;
}
