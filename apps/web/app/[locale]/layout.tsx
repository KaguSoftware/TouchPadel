import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
// Subpath imports: the @touch/ui barrel also exports the client-side
// ThemeProvider (React hooks), which a Server Component must not pull in.
import { themeCss } from '@touch/ui/theme';
import { FONT_BASE, PRELOAD_FACES } from '@touch/ui/fontFace';
import { siteNightVars } from '@touch/ui/tokens/site';
import { dirAttr, t } from '@touch/i18n';
import { asLocale, LOCALES } from '@/lib/locales';
import { siteOrigin } from '@/lib/site/origin';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/**
 * Anything but `en` and `ar` in the first segment is a 404, not Arabic.
 *
 * This declares it; `requireLocale()` in every page enforces it. Measured on
 * the 16.3.4 production build (2026-09-20), this flag alone changed nothing
 * at request time: the whole tree renders dynamically (the `headers()` read
 * below, C11), so no prerender entry exists for the runtime to check a
 * param against, and `/.well-known/t` still came back 200 with the table
 * page. (That 200 was measured before `requireLocale()` reached the pages. The
 * same path is a 404 today — re-measured on the same build 2026-09-21 — and
 * this line is still not the reason: the refusal comes from the page.) It
 * stays because it is the statement Next reads — the build refuses
 * it if generateStaticParams above ever stops covering `locale`, and it
 * becomes live for any route in this tree that is later made static (C11's
 * fix). The layout itself keeps coercing with `asLocale`: Next forbids
 * notFound() in a root layout, and the 404 the pages throw still needs a
 * `lang` and a `dir` to render in.
 */
export const dynamicParams = false;

export function generateViewport(): Viewport {
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    // Night is the site's default mode, so the browser chrome starts on its
    // deepest navy. The café menu sets its own blue (menu/page.tsx).
    themeColor: siteNightVars['--tp-site-page'],
  };
}

/**
 * Site-wide defaults: Touch Padel, not Touch Cafe (2026-09-23). The landing
 * page at `/{locale}` is Touch Padel's front door; the café menu moved to
 * `/{locale}/menu` and overrides title, icons, OG and theme colour itself.
 *
 * No `alternates` here on purpose: a canonical set in the layout is inherited
 * by every page that forgets its own, and the old `/{locale}` one told search
 * engines that the menu, the download page and the 404 were copies of the
 * site root. Each page sets its own canonical + hreflang.
 *
 * `openGraph` and `twitter` are replaced WHOLE by a page that sets either
 * (Next merges metadata shallowly), so a page that overrides them names its
 * own image.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const siteName = t(locale, 'seo.siteTitle');
  // The share card's longer line ("Touch Padel · Padel courts and café in
  // Iraq"); the document title default is the bare name.
  const title = t(locale, 'site.seo.title');
  const description = t(locale, 'site.seo.description');
  const ogImage = `/brand/site/og-touch-padel-${locale}.png`;
  return {
    // The one origin (src/lib/site/origin.ts): robots, the sitemap and the
    // JSON-LD read the same value, empty and unset env handled the same way.
    metadataBase: new URL(siteOrigin()),
    // The landing sits in this layout's own segment, so the template does not
    // apply to it (Next's rule): it gets `default`. A page below it with a
    // plain string title reads "<title> · Touch Padel".
    title: { default: siteName, template: `%s · ${siteName}` },
    description,
    applicationName: siteName,
    icons: {
      icon: [
        { url: '/brand/site/favicon.svg', type: 'image/svg+xml' },
        { url: '/brand/site/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/brand/site/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: '/brand/site/apple-icon-180.png',
    },
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: siteName, statusBarStyle: 'default' },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      alternateLocale: locale === 'ar' ? 'en_US' : 'ar_IQ',
      siteName,
      images: [{ url: ogImage, width: 1200, height: 630, alt: t(locale, 'site.seo.ogAlt') }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  };
}

/**
 * The few document-level rules every page needs whatever it renders, formerly supplied
 * by the café sheet's base module, which the layout used to inline everywhere: no body
 * margin, no mobile text inflation, `[hidden]` honoured.
 */
const DOCUMENT_CSS = `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { margin: 0; }
[hidden] { display: none !important; }`;

// Root layout at [locale] (proxy.ts guarantees the segment). dir flips per
// locale — full RTL for Arabic. `data-theme="cafe"` stays on <html>: the café
// menu and the staff download page render in it, and the site shell (landing,
// legal pages, 404, error) re-scopes its own subtree to the padel theme. Theme tokens
// (@touch/ui) are inlined server-side here, each page family inlines its own sheet, and themeCss opens
// with the brand family's @font-face rules, so the whole page — type included —
// arrives in the HTML with no render-blocking request behind it. The faces are
// served from this origin: a hosted stylesheet would put two DNS lookups and
// two TLS handshakes ahead of the first glyph, and this page is opened by a
// phone that has just scanned a table's QR code on venue wifi.
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  const dir = dirAttr(locale);
  // proxy.ts mints one nonce per request and passes it here on `x-nonce`.
  // Next stamps its OWN inline bootstrap scripts from the request's CSP header;
  // this inline <style> is ours, so it carries the nonce explicitly. Without it
  // the token stylesheet is blocked and the page renders unstyled.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang={locale} dir={dir} data-theme="cafe">
      <head>
        {/* The faces are declared in the stylesheet below, but a parser only
            discovers a @font-face url once it has laid out a glyph that wants
            it — one round trip after the HTML, on the slowest link this menu
            ever runs on. These start the faces the first screen leans on
            alongside the markup instead. crossOrigin is not decoration here: a
            font is always fetched in CORS mode, so a preload without it never
            matches the request that follows and the file comes down twice.
            Which faces are worth it is @touch/ui's call (PRELOAD_FACES) — a
            weight that starts appearing above the fold is one line there. */}
        {PRELOAD_FACES.map((face) => (
          <link
            key={face.file}
            rel="preload"
            as="font"
            type="font/woff2"
            href={`${FONT_BASE}/${face.file}.woff2`}
            crossOrigin="anonymous"
          />
        ))}
        <style
          nonce={nonce}
          // Theme tokens + the brand's @font-face rules, which every page needs, and the
          // document reset the café sheet used to supply to every page. The café sheet
          // is inlined by the café's own pages (CafeStyles), the site's by the site's
          // (SiteStyles), so neither ships where it is not used (perf finding P3).
          dangerouslySetInnerHTML={{ __html: `${themeCss}\n${DOCUMENT_CSS}` }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
