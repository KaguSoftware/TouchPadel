import type { MetadataRoute } from 'next';
import { t } from '@touch/i18n';
// Server-safe subpath imports (the @touch/ui barrel pulls in the client
// ThemeProvider) — colours come from the palette tokens, never hardcoded.
import { siteNightVars } from '@touch/ui/tokens/site';

/**
 * Web app manifest (App Router metadata route → served at /manifest.webmanifest,
 * linked from [locale]/layout metadata). Touch Padel's since 2026-09-23: the
 * site root is the Touch Padel landing, so an installed icon opens that, on the
 * night navy the site defaults to. The café menu is one long-press away as a
 * shortcut; `/menu` is locale-less on purpose, so proxy.ts sends it to the
 * guest's own language (cookie, then Accept-Language, then Arabic).
 *
 * Site icons are rendered by packages/ui/scripts/render-site-assets.mjs into
 * public/brand/site/, the café icons by render-cafe-icons.mjs into
 * public/brand/cafe/. No service worker by design (web-slice §7).
 */
export default function manifest(): MetadataRoute.Manifest {
  const navy = siteNightVars['--tp-site-page'];
  return {
    name: 'Touch Padel',
    short_name: 'Touch Padel',
    description: t('en', 'site.seo.description'),
    lang: 'en',
    dir: 'auto',
    start_url: '/',
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
        name: t('en', 'seo.menuTitle'),
        short_name: t('en', 'site.footer.menu'),
        url: '/menu',
        icons: [{ src: '/brand/cafe/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}
