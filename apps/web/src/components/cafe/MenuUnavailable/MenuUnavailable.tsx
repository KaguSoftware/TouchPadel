'use client';

import { makeT, type Locale } from '@touch/i18n';
import { Loader } from '../brand/Loader';

/**
 * Explicit empty/error state for the menu stage. The first Vercel deploy
 * shipped a SILENT BLANK page when the read model failed — the menu must
 * always say what happened and offer a real client-side retry.
 */
export function MenuUnavailable({
  locale,
  retrying,
  onRetry,
}: {
  locale: Locale;
  retrying: boolean;
  onRetry(): void;
}) {
  const tr = makeT(locale);
  return (
    <section className="tp-menu-unavailable" role="status">
      <Loader size="md" tone="onLight" />
      <h2>{tr('cafe.menuUnavailable.title')}</h2>
      <p>{tr('cafe.menuUnavailable.body')}</p>
      <button type="button" className="tp-btn tp-btn--primary" disabled={retrying} onClick={onRetry}>
        {retrying ? tr('common.loading') : tr('common.retry')}
      </button>
    </section>
  );
}
