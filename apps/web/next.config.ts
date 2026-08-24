import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Internal packages export raw .ts with no build step (HANDOFF conventions) —
  // Next must transpile them itself.
  transpilePackages: ['@touch/core', '@touch/i18n', '@touch/ui'],
};

export default nextConfig;
