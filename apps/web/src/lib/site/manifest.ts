import type { MetadataRoute } from 'next';
import { dirAttr, t, type Locale } from '@touch/i18n';
// Server-safe subpath import (the @touch/ui barrel pulls in the client
// ThemeProvider): colours come from the palette tokens, never hardcoded.
import { siteNightVars } from '@touch/ui/tokens/site';

/**
 * The web app manifest in one language (F-63, 2026-11-01). It was English only
 * (`lang: 'en'`, an English shortcut), so a guest installing the Arabic site got
 * an English name on their home screen. Each locale now has its own:
 *
 *   /en/manifest.webmanifest, /ar/manifest.webmanifest
 *     app/[locale]/manifest.webmanifest/route.ts, linked from the locale layout,
 *     so the Arabic pages hand the browser the Arabic manifest;
 *   /manifest.webmanifest
 *     app/manifest.ts, the address pages linked to before: the default locale's
 *     words (Arabic, the site's default) with the locale-less `/` and `/menu`,
 *     which proxy.ts sends to the guest's own language (cookie, then
 *     Accept-Language, then Arabic).
 *
 * Both languages share one `id`, so installing from /en and from /ar is the same
 * app, not two. The installed icon opens the language it was installed from
 * (`start_url`), on the night navy the site defaults to; the café menu is one
 * long-press away as a shortcut, in the same language.
 *
 * Site icons are rendered by packages/ui/scripts/render-site-assets.mjs into
 * public/brand/site/, the café icons by render-cafe-icons.mjs into
 * public/brand/cafe/. No service worker by design (web-slice §7).
 */
export const MANIFEST_ID = '/';

export function manifestPath(locale: Locale): string {
  return `/${locale}/manifest.webmanifest`;
}

export function buildManifest(
  locale: Locale,
  { negotiated = false }: { negotiated?: boolean } = {},
): MetadataRoute.Manifest {
  const navy = siteNightVars['--tp-site-page'];
  const name = t(locale, 'seo.siteTitle');
  const prefix = negotiated ? '' : `/${locale}`;
  return {
    id: MANIFEST_ID,
    name,
    short_name: name,
    description: t(locale, 'site.seo.description'),
    lang: locale,
    dir: dirAttr(locale),
    start_url: prefix || '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: navy,
    theme_color: navy,
    icons: [
      { src: '/brand/site/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/site/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/site/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: t(locale, 'seo.menuTitle'),
        short_name: t(locale, 'site.footer.menu'),
        url: `${prefix}/menu`,
        icons: [{ src: '/brand/cafe/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
