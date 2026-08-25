import type { MetadataRoute } from 'next';
// Server-safe subpath import (the @touch/ui barrel pulls in the client
// ThemeProvider) — colors come from the cafe palette tokens, never hardcoded.
import { cafePalette } from '@touch/ui/tokens/palette';

/**
 * Web app manifest (App Router metadata route → served at /manifest.webmanifest,
 * linked from [locale]/layout metadata). Makes the cafe QR flow home-screen
 * installable. Icons are rendered from packages/ui/src/brand/cafe-mark.svg by
 * packages/ui/scripts/render-cafe-icons.mjs into public/brand/cafe/.
 * No service worker by design (web-slice §7).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Touch Cafe',
    short_name: 'Touch Cafe',
    description: 'Touch Cafe menu — browse in Arabic or English and order from your table.',
    lang: 'ar',
    dir: 'auto',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: cafePalette['--tp-bg'],
    theme_color: cafePalette['--tp-accent'],
    icons: [
      { src: '/brand/cafe/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/cafe/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/cafe/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
