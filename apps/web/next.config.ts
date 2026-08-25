import type { NextConfig } from 'next';

const MEDIA_PATH = '/storage/v1/object/public/menu-media/**';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
    qualities: [40, 75],
    imageSizes: [16, 32, 64, 96, 128, 160, 224, 320],
    // Storage paths are versioned (items/{id}/{version}.jpg) → cache 30 days.
    minimumCacheTTL: 2592000,
  },
  async redirects() {
    return [
      // Legacy /{locale}/menu alias → the cafe app root (web-slice §1).
      { source: '/:locale(en|ar)/menu', destination: '/:locale', permanent: true },
    ];
  },
};

export default nextConfig;
