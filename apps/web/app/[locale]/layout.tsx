import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Subpath import: the @touch/ui barrel also exports the client-side
// ThemeProvider (React hooks), which a Server Component must not pull in.
import { themeCss } from '@touch/ui/theme';
import { dirAttr, t } from '@touch/i18n';
import { asLocale, LOCALES } from '@/lib/locales';
import { appCss } from '@/styles/app-css';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = asLocale((await params).locale);
  const title = t(locale, 'seo.siteTitle');
  const description = t(locale, 'seo.siteDescription');
  return {
    // Touch's real domain lands at DNS setup (SOW module 6 delivery).
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: title, template: `%s · ${t(locale, 'common.appName')}` },
    description,
    icons: {
      icon: '/brand/touch_padel_logo_transparent.png',
      apple: '/brand/icon-192.png',
    },
    manifest: '/manifest.webmanifest',
    alternates: {
      languages: { en: '/en', ar: '/ar' },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      locale: locale === 'ar' ? 'ar_IQ' : 'en_US',
      siteName: t(locale, 'common.appName'),
      images: [{ url: '/brand/touch_padel_logo_transparent.png' }],
    },
  };
}

// Root layout at [locale] (middleware guarantees the segment). dir flips per
// locale — full RTL for Arabic. Theme tokens (@touch/ui) are inlined
// server-side; free stand-in webfonts load from Google Fonts until the
// licensed brand faces (Next Art / Frutiger LT Arabic) arrive.
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
    <html lang={locale} dir={dir} data-theme="padel">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <style
          // Token stylesheet + app styles — logical properties only (RTL-safe).
          dangerouslySetInnerHTML={{ __html: `${themeCss}\n${appCss}` }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
