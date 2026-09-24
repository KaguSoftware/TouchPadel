import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { makeT } from '@touch/i18n';
import { requireLocale } from '@/lib/locales';

/**
 * Every address under a locale that matches no page: `/en/nope`, `/ar/privacy/x`,
 * `/en/menu/x`, and `/fr`, which proxy.ts sends to `/ar/fr`. It exists only to throw
 * `notFound()`, so the visitor gets this segment's `not-found.tsx` (the 404 in the site
 * shell, in their language and mode, with the ways back) and a real 404 status.
 *
 * Without it such a URL matched nothing, and Next answered with its own bare page: white,
 * English, no `lang`, no way home (fix pass 2026-09-24). A segment's `not-found.tsx` only
 * renders for a `notFound()` thrown inside the tree; an unmatched URL throws nothing.
 *
 * Next ranks this catch-all below every real route, so it never shadows one (`/en/t/x`
 * is still the exchange, `/en/menu` still the menu). The locale is checked first, as on
 * every page, so a refused one 404s the same way.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  // "Out of bounds · Touch Padel"; Next adds `noindex` to every 404 itself.
  return { title: makeT(locale)('site.notFound.title') };
}

export default async function UnknownAddress({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  requireLocale((await params).locale);
  notFound();
}
