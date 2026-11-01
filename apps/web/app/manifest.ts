import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE } from '@/lib/locales';
import { buildManifest } from '@/lib/site/manifest';

/**
 * `/manifest.webmanifest` (App Router metadata route). Since F-63 (2026-11-01) every page
 * links its own language's manifest (`/{locale}/manifest.webmanifest`,
 * app/[locale]/manifest.webmanifest/route.ts); this one stays for whatever still asks for
 * the old address: the default locale's words, with locale-less links that proxy.ts sends
 * to the guest's own language. src/lib/site/manifest.ts holds the shape.
 */
export default function manifest(): MetadataRoute.Manifest {
  return buildManifest(DEFAULT_LOCALE, { negotiated: true });
}
