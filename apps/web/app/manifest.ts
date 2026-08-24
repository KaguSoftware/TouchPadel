import type { MetadataRoute } from 'next';
// Server-safe subpath import (the @touch/ui barrel pulls in the client
// ThemeProvider) — colors come from the cafe palette tokens, never hardcoded.
import { cafePalette } from '@touch/ui/tokens/palette';

/**
 * Web app manifest (App Router metadata route → served at /manifest.webmanifest,
 * linked from [locale]/layout metadata). Makes the cafe QR flow home-screen
 * installable. Icons are generated from the brand wordmark
 * (public/brand/icon-{192,512}.png).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Touch Padel',
    short_name: 'Touch Padel',
    description: 'Padel courts and a specialty cafe — browse the menu and order from your table.',
    start_url: '/',
    display: 'standalone',
    background_color: cafePalette['--tp-bg'],
    theme_color: cafePalette['--tp-accent'],
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
