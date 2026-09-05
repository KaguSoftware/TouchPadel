import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// Subpath imports: the @touch/ui barrel also exports the client-side
// ThemeProvider (React hooks), which a Server Component must not pull in.
import { themeCss } from '@touch/ui/theme';
import { FONT_BASE, PRELOAD_FACES } from '@touch/ui/fontFace';
import { cafePalette } from '@touch/ui/tokens/palette';
import { dirAttr, t } from '@touch/i18n';
import { asLocale, LOCALES } from '@/lib/locales';
import { cafeCss } from '@/styles/cafe';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export function generateViewport(): Viewport {
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: cafePalette['--tp-accent'],
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const title = t(locale, 'seo.siteTitle');
  const description = t(locale, 'seo.menuDescription');
  const cafeName = t(locale, 'common.cafeName');
  return {
    // Touch's real domain lands at DNS setup (SOW module 6 delivery).
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: title, template: `%s · ${cafeName}` },
    description,
    applicationName: cafeName,
    icons: {
      icon: [
        { url: '/brand/cafe/favicon.svg', type: 'image/svg+xml' },
        { url: '/brand/cafe/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/brand/cafe/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: '/brand/cafe/apple-icon-180.png',
    },
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: cafeName, statusBarStyle: 'default' },
    alternates: {
      canonical: `/${locale}`,
      languages: { en: '/en', ar: '/ar', 'x-default': '/ar' },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      alternateLocale: locale === 'ar' ? 'en_US' : 'ar_IQ',
      siteName: cafeName,
      images: [{ url: '/brand/cafe/og-1200x630.png', width: 1200, height: 630, alt: cafeName }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/brand/cafe/og-1200x630.png'] },
  };
}

// Root layout at [locale] (proxy.ts guarantees the segment). dir flips per
// locale — full RTL for Arabic. Touch Cafe theme tokens + the cafe stylesheet
// (@touch/ui + src/styles/cafe) are inlined server-side, and themeCss opens
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
          // Token stylesheet + cafe styles — logical properties only (RTL-safe).
          dangerouslySetInnerHTML={{ __html: `${themeCss}\n${cafeCss}` }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
