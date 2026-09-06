import type { NextConfig } from 'next';
import { STATIC_SECURITY_HEADERS, TABLE_ROUTE_HEADERS } from './src/lib/security/headers';

const MEDIA_PATH = '/storage/v1/object/public/menu-media/**';

// Next 16 refuses to proxy images from private IPs (SSRF guard). The LOCAL
// Supabase stack IS a private IP, so dev and e2e would render every fixture
// photo as a 500. Only lift the guard when the configured Supabase URL is
// itself local — a hosted deployment can never take this branch.
const isLocalSupabase = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
);

/**
 * The single Supabase host this deployment may optimize images from. Falls back
 * to the known project ref so a build without the env var still renders the
 * menu rather than shipping broken images — but never to a wildcard.
 */
const supabaseImageHost = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return 'lczijabnorujcgmbuqlw.supabase.co';
  try {
    const { hostname } = new URL(raw);
    return /^(127\.0\.0\.1|localhost)$/.test(hostname) ? null : hostname;
  } catch {
    return 'lczijabnorujcgmbuqlw.supabase.co';
  }
})();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-tools indicator renders a full-viewport <nextjs-portal> that
  // intercepts pointer events over the bell FAB and times e2e clicks out
  // (guest cafe journey / bell-gate specs). Dev-only chrome; nothing in
  // production is affected.
  devIndicators: false,
  // Internal packages export raw .ts with no build step (HANDOFF conventions) —
  // Next must transpile them itself.
  transpilePackages: ['@touch/core', '@touch/db', '@touch/i18n', '@touch/ui'],
  images: {
    // Only the public `menu-media` bucket (0027/0031), on the ONE project this
    // deployment talks to, plus the local stack.
    //
    // The wildcard `*.supabase.co` that used to be here turned the Next image
    // optimizer into an open proxy: anyone could pass
    // /_next/image?url=https://<their-project>.supabase.co/... and have this
    // origin fetch, resize, cache and serve their bytes under the venue's own
    // domain and TLS certificate. That is a free CDN for whatever they like,
    // billed to this deployment, and it launders the content's origin.
    //
    // The host is derived from NEXT_PUBLIC_SUPABASE_URL so it follows the
    // deployment rather than being pinned to one ref in source — a hardcoded
    // ref silently stops working at handover, and the usual fix for that is to
    // put the wildcard back.
    remotePatterns: [
      ...(supabaseImageHost
        ? [{ protocol: 'https' as const, hostname: supabaseImageHost, pathname: MEDIA_PATH }]
        : []),
      { protocol: 'http', hostname: '127.0.0.1', port: '54321', pathname: MEDIA_PATH },
    ],
    // Next 16 requires every non-default quality to be listed: 40 = blurred
    // warm-up layers, 75 = full-res.
    // 55 = MenuCard thumbnails (66px). Missing from this list, Next 16 dev
    // logs a warning per image AND raises the dev-overlay issues badge, whose
    // <nextjs-portal> sits over the bell FAB and eats its clicks in e2e.
    qualities: [40, 55, 75],
    imageSizes: [16, 32, 64, 96, 128, 160, 224, 320],
    // Storage paths are versioned (items/{id}/{version}.jpg) → cache 30 days.
    minimumCacheTTL: 2592000,
    ...(isLocalSupabase ? { dangerouslyAllowLocalIP: true } : {}),
  },
  async headers() {
    return [
      {
        // Next's default for public/ is a revalidate-every-time no-cache, which
        // on a QR menu means every scanned table re-checks seven font files
        // before it can paint them, over the venue wifi the whole self-hosting
        // decision was made for. A week covers a guest's visit and every repeat
        // scan of the same table, and the month of stale-while-revalidate behind
        // it keeps a device that has been away painting from cache while the new
        // bytes come down in the background. Not `immutable`: the faces are
        // served under fixed stems with no content hash — Next adds none for
        // public/ — and a corrected cut lands as new bytes behind
        // LamaSans-Regular.woff2, which is the one thing `pnpm fonts:check`
        // exists to notice. `immutable` would pin the stale face for the whole
        // max-age with nothing able to bust it.
        source: '/fonts/lama/:file',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800, stale-while-revalidate=2592000',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Legacy /{locale}/menu alias → the cafe app root (web-slice §1).
      { source: '/:locale(en|ar)/menu', destination: '/:locale', permanent: true },
    ];
  },
};

export default nextConfig;
