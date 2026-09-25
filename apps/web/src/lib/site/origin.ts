/**
 * The site's public origin, ONE answer for every place that needs an absolute URL: the
 * layout's `metadataBase`, robots.txt, the sitemap and the landing's JSON-LD.
 *
 * `NEXT_PUBLIC_SITE_URL` when it is set and not empty (`||`, not `??`: .env.example ships
 * it empty, and an empty origin gave the JSON-LD relative URLs, which schema.org readers
 * reject), else the production host. Production answers on www: the apex 308s to
 * `https://www.touch-padel.com` (measured 2026-09-24), so that is the fallback, never
 * localhost, which a sitemap or a share card must never advertise.
 */
export const PRODUCTION_ORIGIN = 'https://www.touch-padel.com';

export function siteOrigin(env: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string {
  return (env?.trim() || PRODUCTION_ORIGIN).replace(/\/+$/, '');
}
