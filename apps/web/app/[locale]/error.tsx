'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { makeT } from '@touch/i18n';
import { asLocale } from '@/lib/locales';
import { Wordmark } from '@/components/cafe/brand/Wordmark';

/** Segment error boundary (client): brand header + retry. */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  const tr = makeT(asLocale(params?.locale ?? 'ar'));
  useEffect(() => {
    console.error('[cafe] route error:', error);
  }, [error]);
  return (
    <div className="tp-cafe" data-theme="cafe">
      <main className="tp-boot">
        <Wordmark tone="onLight" className="tp-wordmark--lg" />
        <p>{tr('errors.generic')}</p>
        <button type="button" className="tp-btn tp-btn--primary" onClick={() => reset()}>
          {tr('common.retry')}
        </button>
      </main>
    </div>
  );
}
