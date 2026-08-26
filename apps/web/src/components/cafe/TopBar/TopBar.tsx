'use client';

import type { Locale } from '@touch/i18n';
import { Wordmark } from '../brand/Wordmark';
import { BeanPattern } from '../brand/BeanPattern';
import { TableChip } from './TableChip';
import { LocaleSwitcher } from './LocaleSwitcher';
import { BasketButton } from './BasketButton';
import type { TableSession, TableSessionState } from '@/hooks/cafe/useTableSession';

/**
 * Solid Touch Blue bar with the wordmark, the table chip, the locale switch
 * and the basket. It ends FLAT: the bar and the hero below it are one
 * continuous blue field, closed by the hero's single swoosh (brand p01/p07).
 * The bar is sticky, not fixed: it belongs to the app shell, above the single
 * scroller.
 *
 * The bean layer here and the hero's are the SAME field: `.tp-beans` is
 * viewport-anchored (`background-attachment: fixed`, topbar.css.ts), so both
 * resolve the tile against the viewport rather than their own box and the
 * pattern runs continuously across the seam. The bar cannot simply share the
 * hero's layer — it lives outside the scroller, which clips its children.
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
  return (
    <header className="tp-cafe__topbar">
      <BeanPattern tone="white" />
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
    </header>
  );
}
