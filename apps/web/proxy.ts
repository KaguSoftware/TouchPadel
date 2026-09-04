import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, TABLE_COOKIE, tableCookieOptions } from '@/lib/security/headers';

/**
 * Locale routing + the security envelope (Next 16 `proxy` convention —
 * replaces the deprecated `middleware.ts`). See
 * docs/design/cafe-rebuild/web-slice.md §1 and Security Layer 1 Block 4 · Web.
 *
 * Two things live here that cannot live in next.config.ts:
 *
 *  1. THE CSP NONCE. It must be unguessable and single-use, so it is generated
 *     per request. Next reads it back off the request\'s own CSP header and
 *     stamps it onto the inline bootstrap scripts it emits, which is what lets
 *     the policy refuse `unsafe-inline` for scripts.
 *
 *  2. THE TABLE-TOKEN COOKIE EXCHANGE. See exchangeTableToken() below.
 *
 * Precedence: path prefix → `tp-locale` cookie (set by the locale switcher, so
 * a guest who chose English keeps it on a re-scan of the locale-less printed
 * URL) → Accept-Language (first supported tag wins) → `ar` (owner decision:
 * Arabic is the default).
 */
const LOCALES = ['en', 'ar'] as const;
type AppLocale = (typeof LOCALES)[number];
const DEFAULT_LOCALE: AppLocale = 'ar';
export const LOCALE_COOKIE = 'tp-locale';

function asLocale(value: string | undefined | null): AppLocale | null {
  return value === 'en' || value === 'ar' ? value : null;
}

function fromAcceptLanguage(header: string): AppLocale | null {
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    if (tag === '') continue;
    for (const locale of LOCALES) {
      if (tag === locale || tag.startsWith(`${locale}-`)) return locale;
    }
  }
  return null;
}

export function negotiateLocale(req: NextRequest): AppLocale {
  return (
    asLocale(req.cookies.get(LOCALE_COOKIE)?.value) ??
    fromAcceptLanguage(req.headers.get('accept-language') ?? '') ??
    DEFAULT_LOCALE
  );
}

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Match a table URL and pull the token out, with or without a locale prefix:
 *   /t/{token}        the printed QR form (design-arch.md §6.2)
 *   /en/t/{token}     what a locale switch produces
 */
const TABLE_URL = new RegExp(`^(?:/(${LOCALES.join('|')}))?/t/([^/]+)/?$`);

/**
 * Move the table token out of the URL and into an HttpOnly cookie.
 *
 * The token is the table's bearer credential: whoever holds it can open a
 * session on that table and order to its tab. While it sat in the address bar
 * it was handed to every third party the page loads (via `Referer`), captured
 * by analytics as `$current_url`, written into browser history, and visible in
 * any screenshot or shared link — for the whole session, not just the first
 * request.
 *
 * The exchange is a 307 to the token-less `/t`, carrying a Set-Cookie. From
 * then on the address bar reads `/{locale}/t` and the credential lives where
 * page script cannot read it.
 *
 * PRINTED QR CARDS ARE UNAFFECTED. The token is still in the QR code and still
 * arrives on that first request — this only changes where it lives afterwards.
 * (Security Layer 1 Block 4 · Web, and the Block 0 decision it depended on.)
 */
function exchangeTableToken(req: NextRequest, token: string, locale: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}/t`;
  // The token was the only thing that ever needed to be here; anything else on
  // the query string (?analytics=off) is preserved by the clone.
  const res = NextResponse.redirect(url, 307);
  res.cookies.set(TABLE_COOKIE, token, tableCookieOptions(isDev));
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // A fresh nonce per request. randomUUID is available on the edge runtime and
  // is CSPRNG-backed; the dashes are stripped only for brevity in the header.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce, { isDev, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });

  /**
   * Next stamps the nonce onto its own inline scripts by reading it back from
   * the REQUEST headers, so the policy has to be set on the way in as well as
   * on the way out. `x-nonce` is the documented channel for a Server Component
   * that needs the same value (the layout uses it for its inline <style>).
   */
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const withSecurity = (res: NextResponse) => {
    res.headers.set('content-security-policy', csp);
    res.headers.set('x-nonce', nonce);
    return res;
  };

  // ── the table-token exchange, before any locale handling ──────────────────
  const table = pathname.match(TABLE_URL);
  if (table) {
    const [, localeInPath, token] = table;
    return withSecurity(exchangeTableToken(req, token as string, localeInPath ?? negotiateLocale(req)));
  }

  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) {
    return withSecurity(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  const locale = negotiateLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;

  // `/` and anything else without a locale → 307 to the negotiated locale.
  return withSecurity(NextResponse.redirect(url, 307));
}

export const config = {
  // Skip _next internals, API routes and static files (anything with a dot).
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
