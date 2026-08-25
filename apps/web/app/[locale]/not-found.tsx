import Link from 'next/link';
import { t } from '@touch/i18n';
import { Wordmark } from '@/components/cafe/brand/Wordmark';

/**
 * 404 inside the locale segment. `not-found` receives no params in Next 16,
 * so it shows both languages (short copy) and links to each menu root.
 */
export default function LocaleNotFound() {
  return (
    <div className="tp-cafe" data-theme="cafe">
      <main className="tp-boot">
        <Wordmark tone="onLight" className="tp-wordmark--lg" />
        <p lang="ar" dir="rtl">
          {t('ar', 'errors.notFound')}
        </p>
        <p lang="en" dir="ltr">
          {t('en', 'errors.notFound')}
        </p>
        <div className="tp-row">
          <Link className="tp-btn tp-btn--primary" href="/ar" lang="ar">
            {t('ar', 'cafe.browseMenu')}
          </Link>
          <Link className="tp-btn tp-btn--ghost" href="/en" lang="en">
            {t('en', 'cafe.browseMenu')}
          </Link>
        </div>
      </main>
    </div>
  );
}
