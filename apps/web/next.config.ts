import type { NextConfig } from 'next';

const MEDIA_PATH = '/storage/v1/object/public/menu-media/**';

// Next 16 refuses to proxy images from private IPs (SSRF guard). The LOCAL
// Supabase stack IS a private IP, so dev and e2e would render every fixture
// photo as a 500. Only lift the guard when the configured Supabase URL is
// itself local — a hosted deployment can never take this branch.
const isLocalSupabase = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
);

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
    // Only the public `menu-media` bucket (0027/0031) — staging, any Supabase
    // project (Touch's production at handover), and the local stack.
    remotePatterns: [
      { protocol: 'https', hostname: 'lczijabnorujcgmbuqlw.supabase.co', pathname: MEDIA_PATH },
      { protocol: 'https', hostname: '*.supabase.co', pathname: MEDIA_PATH },
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
  async redirects() {
    return [
      // Legacy /{locale}/menu alias → the cafe app root (web-slice §1).
      { source: '/:locale(en|ar)/menu', destination: '/:locale', permanent: true },
    ];
  },
};

export default nextConfig;
