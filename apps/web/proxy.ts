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
 * Where the exchange LANDS: /{locale}/menu, the café menu, which reads the
 * `tp-table` cookie and holds the session (2026-09-23: the menu moved off the
 * site root when the landing page took `/{locale}`). A guest with no cookie
 * gets the same page as a walk-in.
 */
const MENU_URL = new RegExp(`^/(${LOCALES.join('|')})/menu/?$`);
/**
 * The token-less `/t` the exchange used to land on until 2026-09-23. Kept as
 * a 307 to `/menu` for bookmarks, installed shortcuts and anyone whose cookie
 * was set before the move (the cookie is `path: '/'`, so it binds the table on
 * the menu just the same). Locale-less `/t` is taken in one hop too.
 */
const TABLE_HOP_URL = new RegExp(`^(?:/(${LOCALES.join('|')}))?/t/?$`);

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
 * The exchange is a 307 to the token-less `/{locale}/menu`, carrying a
 * Set-Cookie. From then on the address bar reads `/{locale}/menu` and the
 * credential lives where page script cannot read it (but see the RSC-payload
 * residual in app/[locale]/menu/page.tsx).
 *
 * PRINTED QR CARDS ARE UNAFFECTED. The token is still in the QR code and still
 * arrives on that first request — this only changes where it lives afterwards.
 * (Security Layer 1 Block 4 · Web, and the Block 0 decision it depended on.)
 */
function exchangeTableToken(req: NextRequest, token: string, locale: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}/menu`;
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

    /**
     * `no-store` on the table session (the menu, the old `/t` hop and the
     * token URL), set HERE and not only in next.config.ts.
     *
     * TABLE_ROUTE_HEADERS declares it, but Next stamps its OWN Cache-Control on
     * a dynamic page route and that value wins over `headers()`. Measured on the
     * wire 2026-09-07: /en/t came back `no-cache, must-revalidate` — NOT the
     * `no-store` the header module declares and the Layer 1 box recorded as
     * "verified on the live route".
     *
     * The difference is not cosmetic. `no-cache` permits a shared cache to STORE
     * the response as long as it revalidates; only `no-store` forbids keeping a
     * copy. A table page is one guest's open tab, reached from a sticker on a
     * table that the next person will also scan — so a stored copy is one
     * guest's session served to another. Middleware runs after the route
     * handler, so setting it here is what actually reaches the browser.
     *
     * `/{locale}/menu` is the walk-in menu AND the table session: with the
     * cookie present its RSC payload carries the token, and which of the two a
     * given response is cannot be told from the URL. So every menu response is
     * treated as a session. The cost is bfcache: Back from the landing reloads
     * the menu instead of restoring it.
     */
    if (TABLE_URL.test(pathname) || TABLE_HOP_URL.test(pathname) || MENU_URL.test(pathname)) {
      res.headers.set('cache-control', 'no-store, no-cache, must-revalidate, private');
      res.headers.set('referrer-policy', 'no-referrer');
    }
    return res;
  };

  // ── locale-less by contract ───────────────────────────────────────────────
  // Apple and Google fetch the app-link association files at fixed paths; a
  // 307 to /ar/.well-known/… is a failed verification, not a redirect. They
  // are proxied and passed through rather than skipped by the matcher so the
  // envelope still applies (harmless on JSON) and nothing but Next internals
  // and real files is ever exempt from it. A `/.well-known/…` path that is
  // not a route lands in `[locale]`, where the page's requireLocale() 404s it.
  if (pathname.startsWith('/.well-known/')) {
    return withSecurity(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // ── the table-token exchange, before any locale handling ──────────────────
  const table = pathname.match(TABLE_URL);
  if (table) {
    const [, localeInPath, token] = table;
    return withSecurity(exchangeTableToken(req, token as string, localeInPath ?? negotiateLocale(req)));
  }

  // ── the old session URL, before locale handling ──────────────────────────
  // A 307 here rather than a next.config redirect: config redirects run before
  // this function, so their hop would carry no CSP (the M3 lesson). Not
  // permanent: a browser must never learn `/t` → `/menu` forever, in case the
  // session ever moves again.
  const hop = pathname.match(TABLE_HOP_URL);
  if (hop) {
    // A plain URL, not a nextUrl clone: the clone remembers a trailing slash
    // and would send `/ar/t/` to `/ar/menu/`. The query is carried over.
    const url = new URL(`/${hop[1] ?? negotiateLocale(req)}/menu${req.nextUrl.search}`, req.url);
    return withSecurity(NextResponse.redirect(url, 307));
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
  /**
   * Everything that is not a Next internal or a real file goes through here.
   *
   * The previous matcher, `/((?!_next|api|favicon.ico|.*\..*).*)`, was written
   * as "skip the things that obviously need no locale" and read as "skip API
   * routes and static files". What it actually skipped was every path that
   * BEGINS with `api` and every path containing a dot ANYWHERE — and the
   * `[locale]` segment accepts any first segment, so `/api/t` and `/x.y/t`
   * rendered the table page with the cookie's token in it and no CSP at all.
   * Measured on production 2026-09-13 (security-audit-2026-09-13.md M3); the
   * static headers still applied, the nonce policy did not.
   *
   * So the exclusions are now the two things a page route can never be:
   *   `_next/`   Next's own namespace (static chunks, the image optimizer,
   *              HMR in dev). Never a page.
   *   a dotted   `robots.txt`, `manifest.webmanifest`, `favicon.ico`, the
   *   LAST       fonts and icons under public/. Only the last segment is
   *   segment    tested, so `/x.y/t` is proxied and `/a.png` is not.
   *
   * There is no `api` exclusion because apps/web has no API routes; when one
   * is added it gets the envelope like everything else and opts out here by
   * name if it must. `/.well-known/*` is proxied too and passed through by
   * the function above rather than skipped here, so it keeps the headers.
   *
   * What the matcher cannot do is refuse a bad locale: a skipped path such as
   * `/_next/t` or `/xx/t/tok.x` still reaches `[locale]` with no proxy in
   * front of it. That refusal is requireLocale() in every page
   * (src/lib/locales.ts), which is why the two fixes ship together.
   *
   * The matcher must stay a literal: Next extracts it statically at build
   * time and ignores anything computed. src/lib/security/proxy.test.ts
   * compiles it with Next's own compiler and pins the paths above.
   */
  matcher: ['/((?!_next/|(?:.*/)?[^/]*\\.[^/]*$).*)'],
};
