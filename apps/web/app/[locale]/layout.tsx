import type { ReactNode } from 'react';

const LOCALES = ['en', 'ar'] as const;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

// Root layout lives at [locale] (standard Next i18n pattern — middleware guarantees the
// segment). dir flips per locale: full RTL for Arabic (HANDOFF conventions).
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <html lang={locale} dir={dir}>
      {/*
        data-theme="padel": Padel 2026 identity (green #A5D06F / blue #3360AB) is the site
        default; the /t/* cafe subtree overrides to the Touch Cafe identity (HANDOFF brands).
        TODO(FE2): replace the raw attribute with the @touch/ui ThemeProvider + CSS-var
        tokens once packages/ui/src/theme lands (design-arch.md §1).
      */}
      <body data-theme="padel">{children}</body>
    </html>
  );
}
