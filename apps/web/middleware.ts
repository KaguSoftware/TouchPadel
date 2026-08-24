import { NextResponse, type NextRequest } from 'next/server';

const LOCALES = ['en', 'ar'] as const;
type AppLocale = (typeof LOCALES)[number];
const DEFAULT_LOCALE: AppLocale = 'en';

// Minimal Accept-Language negotiation: first supported tag in header order wins.
// TODO(FE2): swap for the @touch/i18n locale matcher + a locale cookie override.
function negotiateLocale(req: NextRequest): AppLocale {
  const header = req.headers.get('accept-language') ?? '';
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    for (const locale of LOCALES) {
      if (tag === locale || tag.startsWith(`${locale}-`)) return locale;
    }
  }
  return DEFAULT_LOCALE;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) {
    // TODO(W2): table-token cookie exchange for /{locale}/t/* — verify the JWS with the
    // baked-in ES256 public key before the page even renders (design-arch.md §4, §6.2).
    return NextResponse.next();
  }

  const locale = negotiateLocale(req);
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;

  if (pathname.startsWith('/t/')) {
    // Printed QR URLs are locale-less: /t/{token} (design-arch.md §6.2). REWRITE — never
    // redirect — so the printed URL stays verbatim in the address bar and on reload.
    return NextResponse.rewrite(url);
  }
  return NextResponse.redirect(url);
}

export const config = {
  // Skip _next internals, API routes and static files (anything with a dot).
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
