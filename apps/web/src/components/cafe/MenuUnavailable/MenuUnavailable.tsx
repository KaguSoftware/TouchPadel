'use client';

import { useEffect, useRef, useState } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { Loader } from '../brand/Loader';

/**
 * The menu stage when there is no menu to show. Two different situations, told apart
 * (F-43, 2026-11-01); the first Vercel deploy shipped a SILENT BLANK page here.
 *
 *   empty   the read worked and this branch has nothing on its menu yet. Said as a fact
 *           ("Nothing on the menu yet"), with no spinner and no retry: retrying would not
 *           change it. The live `menu_changed` broadcast fills the stage once items go up.
 *   error   the read failed. "The menu is taking a moment", and a Retry that really
 *           retries: a client read when the page has a Supabase client, a reload of the page
 *           (the server reads again) when it has none. Once a retry has not helped, or when
 *           the page cannot reach the menu at all, one more line explains what to do instead.
 */
export function MenuUnavailable({
  locale,
  status,
  retrying,
  canRefresh,
  onRetry,
}: {
  locale: Locale;
  status: 'empty' | 'error';
  retrying: boolean;
  /** false when the page has no Supabase client: Retry reloads instead, and the hint shows at once */
  canRefresh: boolean;
  onRetry(): void;
}) {
  const tr = makeT(locale);
  const [tried, setTried] = useState(false);
  // A retry "has not helped" once it finished and the stage is still here.
  const [stillDown, setStillDown] = useState(false);
  const wasRetrying = useRef(retrying);
  useEffect(() => {
    if (wasRetrying.current && !retrying && tried) setStillDown(true);
    wasRetrying.current = retrying;
  }, [retrying, tried]);

  if (status === 'empty') {
    return (
      <section className="tp-menu-unavailable" role="status" data-state="empty">
        <h2>{tr('cafe.menuEmpty.title')}</h2>
        <p>{tr('cafe.menuEmpty.body')}</p>
      </section>
    );
  }

  return (
    <section className="tp-menu-unavailable" role="status" data-state="error">
      <Loader size="md" tone="onLight" />
      <h2>{tr('cafe.menuUnavailable.title')}</h2>
      <p>{tr('cafe.menuUnavailable.body')}</p>
      <button
        type="button"
        className="tp-btn tp-btn--primary"
        disabled={retrying}
        onClick={() => {
          setTried(true);
          onRetry();
        }}
      >
        {retrying ? tr('common.loading') : tr('common.retry')}
      </button>
      {stillDown || !canRefresh ? (
        <p className="tp-menu-unavailable__hint">{tr('cafe.menuUnavailable.stillDown')}</p>
      ) : null}
    </section>
  );
}
