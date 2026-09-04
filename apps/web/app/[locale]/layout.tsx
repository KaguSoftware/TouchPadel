import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
// Subpath imports: the @touch/ui barrel also exports the client-side
// ThemeProvider (React hooks), which a Server Component must not pull in.
import { themeCss } from '@touch/ui/theme';
import { cafePalette } from '@touch/ui/tokens/palette';
import { dirAttr, t } from '@touch/i18n';
import { asLocale, LOCALES } from '@/lib/locales';
import { cafeCss } from '@/styles/cafe';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

// The menu design sets Arabic in Cairo and every Latin string / price in
// Poppins; the 900 weight paints the hero word and the section headings.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Poppins:wght@500;600;700;800&display=swap';

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
// (@touch/ui + src/styles/cafe) are inlined server-side; free stand-in
// webfonts load from Google Fonts until the licensed brand faces arrive.
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
  // the tokens and cafe stylesheet are blocked and the page renders unstyled.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang={locale} dir={dir} data-theme="cafe">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* The display weights paint the hero word + section headings above the fold. */}
        <link rel="preload" as="style" href={FONTS_HREF} />
        <link href={FONTS_HREF} rel="stylesheet" />
        <style
          nonce={nonce}
          // Token stylesheet + cafe styles — logical properties only (RTL-safe).
          dangerouslySetInnerHTML={{ __html: `${themeCss}\n${cafeCss}` }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
