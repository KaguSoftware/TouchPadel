import { NextResponse, type NextRequest } from 'next/server';

/**
 * Locale routing (Next 16 `proxy` convention — replaces the deprecated
 * `middleware.ts`). See docs/design/cafe-rebuild/web-slice.md §1.
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

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return NextResponse.next();

  const locale = negotiateLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;

  if (pathname.startsWith('/t/')) {
    // Printed QR URLs are locale-less: /t/{token} (design-arch.md §6.2). REWRITE — never
    // redirect — so the printed URL stays verbatim in the address bar and on reload.
    return NextResponse.rewrite(url);
  }
  // `/` and anything else without a locale → 307 to the negotiated locale.
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Skip _next internals, API routes and static files (anything with a dot).
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
