import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { makeT } from '@touch/i18n';
import { asLocale, otherLocale } from '@/lib/locales';

// Public site chrome (padel identity): header with logo + menu link + locale
// toggle, thin footer. The cafe /t subtree has its own chrome (cafe identity).
export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = asLocale((await params).locale);
  const tr = makeT(locale);
  const other = otherLocale(locale);
  return (
    <div className="tp-container">
      <header className="tp-header">
        <Link href={`/${locale}`} aria-label={tr('common.appName')}>
          <Image
            src="/brand/touch_padel_logo_transparent.png"
            alt={tr('common.appName')}
            width={120}
            height={48}
            className="tp-header__logo"
            priority
          />
        </Link>
        <span className="tp-header__spacer" />
        <nav>
          <Link href={`/${locale}/menu`}>{tr('cafe.menu')}</Link>
          {/* Locale toggle keeps the current path — the two public routes only. */}
          <Link href={`/${other}`} lang={other} dir={other === 'ar' ? 'rtl' : 'ltr'}>
            {other === 'ar' ? 'العربية' : 'English'}
          </Link>
        </nav>
      </header>
      {children}
      <footer className="tp-footer">
        <p>
          {tr('common.appName')} · {tr('landing.addressPlaceholder')}
        </p>
      </footer>
    </div>
  );
}
