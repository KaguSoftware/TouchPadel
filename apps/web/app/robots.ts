import type { MetadataRoute } from 'next';

// Public pages are indexable; table-bound ordering pages are not (tokens must
// never end up in a search index).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/t/', '/en/t/', '/ar/t/'] }],
  };
}
