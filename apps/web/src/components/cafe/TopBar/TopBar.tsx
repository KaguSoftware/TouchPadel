'use client';

import type { Locale } from '@touch/i18n';
import { makeT } from '@touch/i18n';
import { Wordmark } from '../brand/Wordmark';
import { Swoosh } from '../brand/Swoosh';
import { TableChip } from './TableChip';
import { LocaleSwitcher } from './LocaleSwitcher';
import { BasketButton } from './BasketButton';
import type { TableSession, TableSessionState } from '@/hooks/cafe/useTableSession';

/**
 * Solid Touch Blue bar with the wordmark, the table chip, the locale switch
 * and the basket — closed underneath by the white swoosh band (brand p01/p07).
 * The bar is sticky, not fixed: it belongs to the app shell, above the single
 * scroller.
 */
export function TopBar({
  locale,
  token,
  sessionState,
  session,
  basketCount,
  basketTotal,
  onOpenBasket,
  onNeedsRescan,
}: {
  locale: Locale;
  token: string | null;
  sessionState: TableSessionState;
  session: TableSession | null;
  basketCount: number;
  basketTotal: number;
  onOpenBasket(): void;
  onNeedsRescan(): void;
}) {
  const tr = makeT(locale);
  return (
    <header className="tp-cafe__topbar">
      <div className="tp-container tp-cafe__topbar-inner">
        <Wordmark tone="onBlue" />
        <TableChip
          locale={locale}
          state={sessionState}
          session={session}
          onNeedsRescan={onNeedsRescan}
        />
        <span className="tp-header__spacer" />
        <LocaleSwitcher locale={locale} token={token} />
        <BasketButton
          locale={locale}
          count={basketCount}
          total={basketTotal}
          onOpen={onOpenBasket}
        />
      </div>
      <div className="tp-topbar__band" aria-hidden="true">
        <Swoosh />
      </div>
      {/* SOW module 3/6: ordering is NOT paying — the notice is persistent. */}
      <div className="tp-paynotice">{tr('cafe.payAtDesk')}</div>
    </header>
  );
}
