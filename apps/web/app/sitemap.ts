import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/locales';
import { siteOrigin } from '@/lib/site/origin';

/**
 * `/sitemap.xml` (2026-09-23): every public page in both languages, each with
 * its hreflang pair and an `x-default` on the Arabic one (Arabic is the default
 * locale, proxy.ts). Table URLs are never listed (robots.ts disallows them).
 *
 * The paths are listed by hand rather than walked from `app/`: a page earns a
 * place here by being public, and `download` (staff only, noindex) is not.
 *
 * No `lastModified`: nothing here knows when a page's content last changed,
 * and a build timestamp would tell crawlers every page changed on every deploy.
 * The origin is `siteOrigin()` (src/lib/site/origin.ts), the one the layout and
 * the JSON-LD use too.
 */

/** Locale-relative paths ('' is the landing). */
const PAGES: ReadonlyArray<{ path: string; priority: number }> = [
  { path: '', priority: 1 },
  { path: '/menu', priority: 0.8 },
  { path: '/support', priority: 0.5 },
  { path: '/privacy', priority: 0.3 },
  { path: '/terms', priority: 0.3 },
  { path: '/delete-account', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return PAGES.flatMap(({ path, priority }) => {
    const url = (locale: string) => `${origin}/${locale}${path}`;
    const languages = {
      en: url('en'),
      ar: url('ar'),
      'x-default': url(DEFAULT_LOCALE),
    };
    return LOCALES.map((locale) => ({
      url: url(locale),
      priority,
      alternates: { languages },
    }));
  });
}
