import { NextResponse, type NextRequest } from 'next/server';
import { isLocale } from '@/lib/locales';
import { TABLE_COOKIE, tableCookieOptions } from '@/lib/security/headers';

/**
 * Fallback for `/{locale}/t/{token}` — defence in depth behind proxy.ts.
 *
 * proxy.ts normally performs the token→cookie exchange before routing, so this
 * handler is not reached in practice. It exists because the proxy has a
 * `matcher` and matchers are edited: if a future change excludes this path,
 * the token would silently start living in the address bar again and nothing
 * would fail. So the exchange is implemented twice, and this copy is the one
 * that keeps working when the first is bypassed. It does the same thing — set
 * the cookie, 307 to the token-less route — and never renders the menu with a
 * token in the URL.
 *
 * A ROUTE HANDLER, NOT A PAGE (2026-09-20). Until now this was `page.tsx`
 * calling `cookies().set()` during render, with a `loading.tsx` beside it.
 * Next 16 refuses the former ("Cookies can only be modified in a Server
 * Action or Route Handler", E1180 — security-audit-2026-09-13.md L1), and the
 * latter opened a Suspense boundary that flushed a 200 shell before the page
 * ran, so both the redirect and a 404 arrived as streamed client-side
 * fallbacks under a 200 status. Measured on the production build: a proxy
 * bypass (`/en/t/tok.x`, a dotted last segment the matcher skips) rendered
 * the error boundary with no cookie and no redirect — the second copy of the
 * exchange did not exist. A route handler is where Next lets a response set a
 * cookie, and it has no shell to flush, so the status codes are real.
 *
 * The locale is refused rather than coerced: `/xx/t/{token}` is a 404, not
 * an Arabic exchange (requireLocale() does the same for the pages; a handler
 * returns the status itself).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ locale: string; token: string }> },
): Promise<NextResponse> {
  const { locale, token } = await ctx.params;
  if (!isLocale(locale)) return new NextResponse(null, { status: 404 });

  const url = req.nextUrl.clone();
  url.pathname = `/${locale}/t`;
  const res = NextResponse.redirect(url, 307);
  res.cookies.set(TABLE_COOKIE, token, tableCookieOptions(process.env.NODE_ENV !== 'production'));
  // The one request whose URL carries the credential: never stored, never
  // referred. next.config.ts declares the same for this path; a redirect the
  // handler owns outright is where the values are known to reach the wire.
  res.headers.set('cache-control', 'no-store, no-cache, must-revalidate, private');
  res.headers.set('referrer-policy', 'no-referrer');
  return res;
}
