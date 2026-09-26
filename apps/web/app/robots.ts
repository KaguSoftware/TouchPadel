import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site/origin';

/**
 * Public pages are indexable, the café menu included (2026-09-23: it is public
 * content and the table token never enters its URL). The table paths are not:
 *
 *   /t/{token}, /{locale}/t/{token}   the printed QR form; the one request whose
 *                                     URL carries the table's credential
 *   /{locale}/t                       the old session URL, now a 307 to /menu
 *
 * Robots rules match by PREFIX, so `/en/t/` alone never covered `/en/t`. But
 * a bare `/en/t` would also prefix `/en/terms` and hide the Terms of Service
 * from search, so the token-less hop is listed with the end anchor `$`
 * (RFC 9309 §2.2.3; Google and Bing honour it). A crawler that ignores `$`
 * reads `/en/t$` as a literal path, which blocks nothing, and meets the hop's
 * own `noindex` + 307 instead.
 *
 * The origin is `siteOrigin()` (src/lib/site/origin.ts): NEXT_PUBLIC_SITE_URL
 * (www.touch-padel.com in production; the vercel.app URL on previews), with the
 * production host as the fallback: a sitemap must never advertise localhost.
 */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/t/', '/t$', '/en/t/', '/en/t$', '/ar/t/', '/ar/t$'],
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
