import { NextResponse } from 'next/server';
import { isLocale, LOCALES } from '@/lib/locales';
import { buildManifest } from '@/lib/site/manifest';

/**
 * `/{locale}/manifest.webmanifest`: the web app manifest in the page's language (F-63), so a
 * guest who installs the Arabic site gets the Arabic name, description and shortcut. The
 * locale layout links it (`metadata.manifest`); src/lib/site/manifest.ts builds it.
 *
 * Built at build time for both locales (it reads nothing per request), and a foreign locale
 * is a 404. The last path segment is dotted, so proxy.ts does not see this request (the
 * matcher treats it as a file, like `/manifest.webmanifest`); a manifest needs no CSP.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale } = await ctx.params;
  if (!isLocale(locale)) return new NextResponse(null, { status: 404 });
  return NextResponse.json(buildManifest(locale), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8' },
  });
}
